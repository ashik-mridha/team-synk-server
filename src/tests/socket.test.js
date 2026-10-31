import http from 'http';
import { io as connect } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, signUp, startTestApp } from './helpers.js';

let ctx;
let server;
let url;
let cookies;
let ids;
let workspaceId;
let project;
const sockets = [];

const call = (method, path, who, body) => api(ctx.app, method, path, cookies[who], body);

function open(who) {
  const socket = connect(url, {
    transports: ['websocket'],
    extraHeaders: who ? { Cookie: cookies[who] } : {},
    reconnection: false,
  });
  sockets.push(socket);
  return socket;
}

const connected = (socket) =>
  new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });

const emitAck = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

const nextEvent = (socket, event, timeout = 3000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

beforeAll(async () => {
  ctx = await startTestApp();
  const { initSockets } = await import('../sockets/index.js');
  server = http.createServer(ctx.app);
  initSockets(server);
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await ctx.stop();
});

afterEach(() => {
  sockets.splice(0).forEach((s) => s.disconnect());
});

beforeEach(async () => {
  await ctx.reset();
  cookies = {};
  for (const [key, name] of [
    ['owner', 'Olivia Owner'],
    ['member', 'Mia Member'],
    ['outsider', 'Otto Outsider'],
  ]) {
    cookies[key] = (await signUp(ctx.app, name, `${key}@example.com`)).cookie;
  }
  workspaceId = (await call('post', '/workspaces', 'owner', { name: 'Team Phoenix' })).body.data
    .workspace.id;
  const res = await call('post', `/workspaces/${workspaceId}/members`, 'owner', {
    email: 'member@example.com',
    role: 'member',
  });
  ids = Object.fromEntries(res.body.data.members.map((m) => [m.email.split('@')[0], m.userId]));
  project = (await call('post', `/workspaces/${workspaceId}/projects`, 'owner', { name: 'Web' }))
    .body.data.project;
});

describe('socket authentication and rooms', () => {
  it('rejects a connection without a Better Auth session', async () => {
    await expect(connected(open(null))).rejects.toThrow('UNAUTHORIZED');
  });

  it('rejects a forged cookie', async () => {
    cookies.fake = 'better-auth.session_token=forged.value';
    await expect(connected(open('fake'))).rejects.toThrow('UNAUTHORIZED');
  });

  it('lets members join a project room but refuses outsiders', async () => {
    const member = await connected(open('member'));
    const outsider = await connected(open('outsider'));

    expect((await emitAck(member, 'project:join', project.id)).ok).toBe(true);
    expect(await emitAck(outsider, 'project:join', project.id)).toMatchObject({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(await emitAck(outsider, 'workspace:join', workspaceId)).toMatchObject({ ok: false });
    expect((await emitAck(member, 'project:join', 'not-an-id')).ok).toBe(false);
  });

  it('never delivers events to a socket that did not join the room', async () => {
    const owner = await connected(open('owner'));
    await emitAck(owner, 'project:join', project.id);
    const outsider = await connected(open('outsider'));
    let leaked = false;
    outsider.on('task:created', () => {
      leaked = true;
    });

    const event = nextEvent(owner, 'task:created');
    await call('post', `/projects/${project.id}/tasks`, 'owner', { title: 'Private' });
    await event;
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(leaked).toBe(false);
  });
});

describe('real-time events', () => {
  it('broadcasts a move after the write, with version and mutation id', async () => {
    const task = (await call('post', `/projects/${project.id}/tasks`, 'owner', { title: 'Card' }))
      .body.data.task;
    const watcher = await connected(open('member'));
    await emitAck(watcher, 'project:join', project.id);

    const event = nextEvent(watcher, 'task:updated');
    await call('post', `/tasks/${task.id}/move`, 'owner', { status: 'done' }).set(
      'x-client-mutation-id',
      'mutation-1',
    );
    const payload = await event;

    expect(payload.clientMutationId).toBe('mutation-1');
    expect(payload.task.status).toBe('done');
    expect(payload.task.updatedAt).toBeTruthy();
    // Emitted only after the DB write: the stored document already matches the event.
    const stored = await ctx.db.collection('tasks').findOne({ title: 'Card' });
    expect(stored.status).toBe('done');
    expect(stored.order).toBe(payload.task.order);
  });

  it('does not emit anything when the request is rejected', async () => {
    const watcher = await connected(open('member'));
    await emitAck(watcher, 'project:join', project.id);
    let received = false;
    watcher.on('task:created', () => {
      received = true;
    });

    const res = await call('post', `/projects/${project.id}/tasks`, 'owner', { title: '' });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(res.status).toBe(422);
    expect(received).toBe(false);
  });

  it('broadcasts created tasks, deletions and comments', async () => {
    const watcher = await connected(open('member'));
    await emitAck(watcher, 'project:join', project.id);

    const created = nextEvent(watcher, 'task:created');
    const task = (await call('post', `/projects/${project.id}/tasks`, 'owner', { title: 'Live' }))
      .body.data.task;
    expect((await created).task.id).toBe(task.id);

    const commented = nextEvent(watcher, 'comment:created');
    await call('post', `/tasks/${task.id}/comments`, 'owner', { body: 'hello' });
    expect((await commented).taskId).toBe(task.id);

    const deleted = nextEvent(watcher, 'task:deleted');
    await call('delete', `/tasks/${task.id}`, 'owner');
    expect((await deleted).id).toBe(task.id);
  });

  it('pushes a notification to the mentioned user only', async () => {
    const task = (await call('post', `/projects/${project.id}/tasks`, 'owner', { title: 'Ping' }))
      .body.data.task;
    const member = await connected(open('member'));
    const owner = await connected(open('owner'));
    let ownerGotOne = false;
    owner.on('notification:new', () => {
      ownerGotOne = true;
    });

    const pushed = nextEvent(member, 'notification:new');
    await call('post', `/tasks/${task.id}/comments`, 'owner', {
      body: 'hey @Mia',
      mentions: [ids.member],
    });
    const { notification } = await pushed;
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(notification.type).toBe('mention');
    expect(ownerGotOne).toBe(false);
  });
});

describe('presence', () => {
  it('lists who has the board open, what they view, and clears on disconnect', async () => {
    const owner = await connected(open('owner'));
    await emitAck(owner, 'project:join', project.id);
    const member = await connected(open('member'));

    const update = nextEvent(owner, 'presence:update');
    const ack = await emitAck(member, 'project:join', project.id);
    expect(ack.users.map((u) => u.name).sort()).toEqual(['Mia Member', 'Olivia Owner']);
    expect((await update).users).toHaveLength(2);

    const viewing = nextEvent(owner, 'presence:update');
    member.emit('task:viewing', 'task-123');
    expect((await viewing).users.find((u) => u.name === 'Mia Member').viewing).toBe('task-123');

    const left = nextEvent(owner, 'presence:update');
    member.disconnect();
    expect((await left).users.map((u) => u.name)).toEqual(['Olivia Owner']);
  });

  it('relays typing indicators to others on the board only', async () => {
    const owner = await connected(open('owner'));
    await emitAck(owner, 'project:join', project.id);
    const member = await connected(open('member'));
    await emitAck(member, 'project:join', project.id);

    const typing = nextEvent(owner, 'comment:typing');
    member.emit('comment:typing', { taskId: 'abc', typing: true });
    const payload = await typing;

    expect(payload).toMatchObject({ taskId: 'abc', typing: true, user: { name: 'Mia Member' } });
    // The identity is the session's, even if a client tried to send its own.
    expect(payload.user.id).toBe(ids.member);
  });
});
