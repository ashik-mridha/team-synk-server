import * as taskService from '../services/task.service.js';
import * as workspaceService from '../services/workspace.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

/** Lets the sender recognise (and ignore) the socket echo of its own mutation. */
const metaOf = (req) => ({ clientMutationId: req.get('x-client-mutation-id') });

export const getProject = asyncHandler(async (req, res) => {
  // Members ride along so the board needs one round trip fewer before it can render.
  const members = await workspaceService.listMembers(req.workspace);
  sendSuccess(res, { project: req.project, role: req.membership.role, members });
});

export const listTasks = asyncHandler(async (req, res) => {
  sendSuccess(res, { tasks: await taskService.listTasks(req.project, req.valid?.query) });
});

export const createTask = asyncHandler(async (req, res) => {
  const task = await taskService.createTask(
    req.workspace,
    req.project,
    req.user,
    req.body,
    metaOf(req),
  );
  sendSuccess(res, { task }, 201);
});

export const updateTask = asyncHandler(async (req, res) => {
  const task = await taskService.updateTask(
    req.workspace,
    req.task,
    req.user,
    req.body,
    metaOf(req),
  );
  sendSuccess(res, { task });
});

export const moveTask = asyncHandler(async (req, res) => {
  const result = await taskService.moveTask(
    req.workspace,
    req.task,
    req.user,
    req.body,
    metaOf(req),
  );
  sendSuccess(res, result);
});

export const deleteTask = asyncHandler(async (req, res) => {
  await taskService.deleteTask(req.task, metaOf(req));
  sendSuccess(res, { deleted: true });
});

export const restoreTask = asyncHandler(async (req, res) => {
  sendSuccess(res, { task: await taskService.restoreTask(req.task, metaOf(req)) });
});

export const listComments = asyncHandler(async (req, res) => {
  sendSuccess(res, { comments: await taskService.listComments(req.task) });
});

export const createComment = asyncHandler(async (req, res) => {
  const comment = await taskService.createComment(
    req.workspace,
    req.task,
    req.user,
    req.body,
    metaOf(req),
  );
  sendSuccess(res, { comment }, 201);
});

export const reactToComment = asyncHandler(async (req, res) => {
  const comment = await taskService.toggleReaction(req.comment, req.user.id, req.body.emoji);
  sendSuccess(res, { comment });
});

export const listActivity = asyncHandler(async (req, res) => {
  sendSuccess(res, { activity: await taskService.listActivity(req.task) });
});
