import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { SocketEvent } from '../config/constants.js';
import { allowedOrigins } from '../config/cors.js';
import { Project, Workspace } from '../models/index.js';
import { consumeSocketTicket } from '../services/socket-ticket.service.js';
import { findMember } from '../services/workspace.service.js';
import { logger } from '../utils/logger.js';
import { getSession } from '../utils/session.js';
import { projectRoom, setIo, userRoom, workspaceRoom } from './io.js';
import { addPresence, listPresence, removePresence, setViewing } from './presence.js';

async function membershipFor(workspaceId, userId) {
  if (!mongoose.isValidObjectId(workspaceId)) return null;
  const workspace = await Workspace.findById(workspaceId).lean();
  return workspace && findMember(workspace, userId) ? workspace : null;
}

function broadcastPresence(io, projectId) {
  io.to(projectRoom(projectId)).emit(SocketEvent.PRESENCE, {
    projectId,
    users: listPresence(projectId),
  });
}

export function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
  });
  setIo(io);

  // Identity comes only from the server: a one-time ticket issued to an authenticated REST caller
  // (works across sites), or the Better Auth session cookie when it reaches the socket host.
  // A user id sent by the client is never read.
  io.use(async (socket, next) => {
    try {
      const ticket = socket.handshake.auth?.ticket;
      if (ticket) {
        const user = await consumeSocketTicket(ticket);
        if (!user) return next(new Error('UNAUTHORIZED'));
        socket.data.user = user;
        return next();
      }
      const result = await getSession(socket.handshake.headers);
      if (!result) return next(new Error('UNAUTHORIZED'));
      const { id, name, image } = result.user;
      socket.data.user = { id, name, image: image ?? null };
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;
    socket.join(userRoom(user.id));
    logger.debug({ id: socket.id, user: user.id }, 'Socket connected');

    socket.on('workspace:join', async (workspaceId, ack) => {
      const workspace = await membershipFor(workspaceId, user.id).catch(() => null);
      if (!workspace) return ack?.({ ok: false, error: 'FORBIDDEN' });
      socket.join(workspaceRoom(workspaceId));
      ack?.({ ok: true });
    });

    socket.on('project:join', async (projectId, ack) => {
      try {
        const project = mongoose.isValidObjectId(projectId)
          ? await Project.findOne({ _id: projectId, deletedAt: null }).lean()
          : null;
        const workspace = project && (await membershipFor(String(project.workspace), user.id));
        if (!workspace) return ack?.({ ok: false, error: 'FORBIDDEN' });

        // A socket follows one board at a time.
        if (socket.data.projectId && socket.data.projectId !== projectId) leaveProject(socket);
        socket.join(projectRoom(projectId));
        socket.join(workspaceRoom(String(project.workspace)));
        socket.data.projectId = projectId;
        addPresence(projectId, user, socket.id);
        broadcastPresence(io, projectId);
        ack?.({ ok: true, users: listPresence(projectId) });
      } catch (err) {
        logger.error({ err }, 'project:join failed');
        ack?.({ ok: false, error: 'INTERNAL_ERROR' });
      }
    });

    function leaveProject(target) {
      const { projectId } = target.data;
      if (!projectId) return;
      target.leave(projectRoom(projectId));
      removePresence(projectId, user.id, target.id);
      target.data.projectId = null;
      broadcastPresence(io, projectId);
    }

    socket.on('project:leave', () => leaveProject(socket));

    socket.on('task:viewing', (taskId) => {
      const { projectId } = socket.data;
      if (!projectId) return;
      setViewing(projectId, user.id, typeof taskId === 'string' ? taskId : null);
      broadcastPresence(io, projectId);
    });

    socket.on(SocketEvent.TYPING, ({ taskId, typing } = {}) => {
      const { projectId } = socket.data;
      if (!projectId || typeof taskId !== 'string') return;
      socket.to(projectRoom(projectId)).emit(SocketEvent.TYPING, {
        taskId,
        typing: Boolean(typing),
        user: { id: user.id, name: user.name },
      });
    });

    socket.on('disconnect', () => {
      const { projectId } = socket.data;
      if (projectId) {
        removePresence(projectId, user.id, socket.id);
        broadcastPresence(io, projectId);
      }
      logger.debug({ id: socket.id }, 'Socket disconnected');
    });
  });

  return io;
}
