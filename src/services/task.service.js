import { NotificationType, SocketEvent, TaskStatus } from '../config/constants.js';
import { Activity, Comment, Project, Task } from '../models/index.js';
import { emitToProject } from '../sockets/io.js';
import { AppError } from '../utils/AppError.js';
import { withId } from '../utils/serialize.js';
import { notify } from './notification.service.js';
import { findMember } from './workspace.service.js';

const ORDER_STEP = 1024;
/** Below this gap between two neighbours the column is renumbered. */
const MIN_GAP = 1e-6;

const ACTIVE = { deletedAt: null, archivedAt: null };

export async function listTasks(project, { since } = {}) {
  // With `since` the client is catching up after a reconnect, so deleted/archived rows are included
  // (flagged) and it can drop them locally.
  const filter = since
    ? { project: project._id, updatedAt: { $gt: since } }
    : { project: project._id, ...ACTIVE };
  const tasks = await Task.find(filter).sort({ order: 1 }).lean();
  return tasks.map(withId);
}

function assertAssignee(workspace, assignee) {
  if (assignee && !findMember(workspace, assignee)) {
    throw AppError.badRequest('Assignee must be a member of this workspace');
  }
}

async function lastOrder(projectId, status) {
  const last = await Task.findOne({ project: projectId, status, ...ACTIVE })
    .sort({ order: -1 })
    .select('order')
    .lean();
  return last?.order ?? 0;
}

/** Broadcast only after the write succeeded; the payload carries the version (`updatedAt`). */
function broadcast(event, task, extra = {}) {
  emitToProject(task.project, event, { task: task.toJSON(), ...extra });
}

function link(project, task) {
  return `/dashboard/projects/${project._id}?task=${task._id}`;
}

async function notifyAssigned(workspace, project, task, actor) {
  if (!task.assignee || task.assignee === actor.id) return;
  await notify([
    {
      user: task.assignee,
      workspace: workspace._id,
      type: NotificationType.ASSIGNED,
      title: `${actor.name} assigned you ${project.key}-${task.number}: ${task.title}`,
      link: link(project, task),
      actor: actor.id,
    },
  ]);
}

export async function createTask(workspace, project, user, input, meta = {}) {
  assertAssignee(workspace, input.assignee);
  const status = input.status ?? TaskStatus.TODO;
  const { counter } = await Project.findByIdAndUpdate(
    project._id,
    { $inc: { counter: 1 } },
    { returnDocument: 'after' },
  );
  const task = await Task.create({
    ...input,
    status,
    order: (await lastOrder(project._id, status)) + ORDER_STEP,
    completedAt: status === TaskStatus.DONE ? new Date() : null,
    workspace: workspace._id,
    project: project._id,
    number: counter,
    createdBy: user.id,
  });
  await Activity.create({
    workspace: workspace._id,
    project: project._id,
    task: task._id,
    actor: user.id,
    type: 'task.created',
    meta: { title: task.title },
  });
  await notifyAssigned(workspace, project, task, user);
  broadcast(SocketEvent.TASK_CREATED, task, { clientMutationId: meta.clientMutationId });
  return task;
}

const TRACKED_FIELDS = ['title', 'priority', 'assignee', 'dueDate'];

export async function updateTask(workspace, task, user, input, meta = {}) {
  assertAssignee(workspace, input.assignee);
  const project = await Project.findById(task.project).lean();
  const before = Object.fromEntries(TRACKED_FIELDS.map((f) => [f, task[f]]));
  const previousStatus = task.status;

  task.set(input);
  if (input.status && input.status !== previousStatus) {
    task.order = (await lastOrder(task.project, input.status)) + ORDER_STEP;
    task.completedAt = input.status === TaskStatus.DONE ? new Date() : null;
  }
  await task.save();

  const activities = [];
  if (input.status && input.status !== previousStatus) {
    activities.push({
      type: 'task.status_changed',
      meta: { from: previousStatus, to: input.status },
    });
  }
  for (const field of TRACKED_FIELDS) {
    if (field in input && String(before[field] ?? '') !== String(task[field] ?? '')) {
      activities.push({
        type: 'task.updated',
        meta: { field, from: before[field] ?? null, to: task[field] ?? null },
      });
    }
  }
  if (activities.length) {
    await Activity.insertMany(
      activities.map((a) => ({
        ...a,
        workspace: workspace._id,
        project: task.project,
        task: task._id,
        actor: user.id,
      })),
    );
  }
  if ('assignee' in input && input.assignee !== before.assignee) {
    await notifyAssigned(workspace, project, task, user);
  }
  broadcast(SocketEvent.TASK_UPDATED, task, { clientMutationId: meta.clientMutationId });
  return task;
}

/** Renumbers a column 1024, 2048, ... in its current order (only when gaps get too small). */
async function rebalance(projectId, status) {
  const tasks = await Task.find({ project: projectId, status, ...ACTIVE })
    .sort({ order: 1 })
    .select('_id')
    .lean();
  await Task.bulkWrite(
    tasks.map((t, i) => ({
      updateOne: { filter: { _id: t._id }, update: { $set: { order: (i + 1) * ORDER_STEP } } },
    })),
  );
}

async function neighbour(task, status, id) {
  if (!id || String(task._id) === id) return null;
  return Task.findOne({ _id: id, project: task.project, status, ...ACTIVE })
    .select('order')
    .lean();
}

/**
 * Moves one card: only that document is rewritten, using a fractional `order` between its new
 * neighbours. Re-sending the same request yields the same position (idempotent).
 */
export async function moveTask(workspace, task, user, { status, afterId, beforeId }, meta = {}) {
  const previousStatus = task.status;
  let prev = await neighbour(task, status, afterId);
  let next = await neighbour(task, status, beforeId);
  let rebalanced = false;

  if (prev && next && next.order - prev.order <= MIN_GAP) {
    await rebalance(task.project, status);
    [prev, next] = await Promise.all([
      neighbour(task, status, afterId),
      neighbour(task, status, beforeId),
    ]);
    rebalanced = true;
  }

  let order;
  if (prev && next) order = (prev.order + next.order) / 2;
  else if (prev) order = prev.order + ORDER_STEP;
  else if (next) order = next.order - ORDER_STEP;
  else order = (await lastOrder(task.project, status)) + ORDER_STEP;

  task.status = status;
  task.order = order;
  if (status !== previousStatus) task.completedAt = status === TaskStatus.DONE ? new Date() : null;
  await task.save();

  if (status !== previousStatus) {
    await Activity.create({
      workspace: workspace._id,
      project: task.project,
      task: task._id,
      actor: user.id,
      type: 'task.status_changed',
      meta: { from: previousStatus, to: status },
    });
  }
  broadcast(SocketEvent.TASK_UPDATED, task, {
    clientMutationId: meta.clientMutationId,
    rebalanced,
  });
  return { task, rebalanced };
}

export async function deleteTask(task, meta = {}) {
  task.deletedAt = new Date();
  await task.save();
  emitToProject(task.project, SocketEvent.TASK_DELETED, {
    id: String(task._id),
    projectId: String(task.project),
    updatedAt: task.updatedAt,
    clientMutationId: meta.clientMutationId,
  });
}

export async function restoreTask(task, meta = {}) {
  task.deletedAt = null;
  await task.save();
  broadcast(SocketEvent.TASK_UPDATED, task, { clientMutationId: meta.clientMutationId });
  return task;
}

// ---- Comments, reactions, activity -----------------------------------------------------------

export async function listComments(task) {
  const comments = await Comment.find({ task: task._id }).sort({ createdAt: 1 }).lean();
  return comments.map((c) =>
    withId({ ...c, reactions: Object.fromEntries(Object.entries(c.reactions ?? {})) }),
  );
}

export async function createComment(workspace, task, user, { body, mentions }, meta = {}) {
  const project = await Project.findById(task.project).lean();
  // Only real workspace members can be mentioned; never the author.
  const mentioned = [...new Set(mentions)].filter(
    (id) => id !== user.id && findMember(workspace, id),
  );
  const comment = await Comment.create({
    task: task._id,
    workspace: workspace._id,
    author: user.id,
    body,
    mentions: mentioned,
  });
  await Task.updateOne({ _id: task._id }, { $inc: { commentCount: 1 } });

  const where = `${project.key}-${task.number}`;
  const items = mentioned.map((id) => ({
    user: id,
    workspace: workspace._id,
    type: NotificationType.MENTION,
    title: `${user.name} mentioned you in ${where}: ${task.title}`,
    link: link(project, task),
    actor: user.id,
  }));
  if (task.assignee && task.assignee !== user.id && !mentioned.includes(task.assignee)) {
    items.push({
      user: task.assignee,
      workspace: workspace._id,
      type: NotificationType.COMMENT,
      title: `${user.name} commented on ${where}: ${task.title}`,
      link: link(project, task),
      actor: user.id,
    });
  }
  await notify(items);

  const dto = comment.toJSON();
  emitToProject(task.project, SocketEvent.COMMENT_CREATED, {
    comment: dto,
    taskId: String(task._id),
    clientMutationId: meta.clientMutationId,
  });
  return dto;
}

export async function toggleReaction(comment, userId, emoji) {
  const users = comment.reactions.get(emoji) ?? [];
  const next = users.includes(userId) ? users.filter((id) => id !== userId) : [...users, userId];
  if (next.length) comment.reactions.set(emoji, next);
  else comment.reactions.delete(emoji);
  await comment.save();
  const task = await Task.findById(comment.task).select('project').lean();
  const dto = comment.toJSON();
  emitToProject(task.project, SocketEvent.COMMENT_UPDATED, {
    comment: dto,
    taskId: String(comment.task),
  });
  return dto;
}

export async function listActivity(task) {
  const items = await Activity.find({ task: task._id }).sort({ createdAt: 1 }).limit(200).lean();
  return items.map(withId);
}
