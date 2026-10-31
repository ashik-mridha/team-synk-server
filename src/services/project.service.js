import { TaskStatus } from '../config/constants.js';
import { Activity, Project, Task } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { withId } from '../utils/serialize.js';
import { findUsersByIds } from './workspace.service.js';

function deriveKey(name) {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  const initials = words.map((w) => w[0]).join('');
  const key = initials.length >= 2 ? initials : (words[0] ?? 'PRJ').padEnd(3, 'X').slice(0, 3);
  return key.slice(0, 5);
}

export function listProjects(workspace) {
  return Project.find({ workspace: workspace._id, deletedAt: null }).sort({ createdAt: 1 });
}

const KEY_SUFFIXES = ['', 'A', 'B', 'C', 'D', 'E'];

export async function createProject(workspace, user, { name, key, color }) {
  const base = key ?? deriveKey(name);
  // An explicit key must be used as-is; a derived key gets a letter suffix on collision.
  for (const suffix of key ? [''] : KEY_SUFFIXES) {
    try {
      const project = await Project.create({
        workspace: workspace._id,
        name,
        key: base.slice(0, 5 - suffix.length) + suffix,
        color,
        createdBy: user.id,
      });
      await Activity.create({
        workspace: workspace._id,
        project: project._id,
        actor: user.id,
        type: 'project.created',
        meta: { name },
      });
      return project;
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }
  }
  throw AppError.conflict('A project with that key already exists');
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Full-text match first; falls back to prefix matching so partial words ("pric") still hit. */
export async function searchWorkspace(workspace, query) {
  const active = { workspace: workspace._id, deletedAt: null, archivedAt: null };
  const prefix = new RegExp(`(^|[\\s\\-_])${escapeRegex(query)}`, 'i');

  const projects = await Project.find({ workspace: workspace._id, deletedAt: null, name: prefix })
    .limit(5)
    .lean();

  let tasks = await Task.find({ ...active, $text: { $search: query } })
    .sort({ updatedAt: -1 })
    .limit(8)
    .lean();
  if (tasks.length === 0) {
    tasks = await Task.find({ ...active, title: prefix })
      .sort({ updatedAt: -1 })
      .limit(8)
      .lean();
  }
  return { projects: projects.map(withId), tasks: tasks.map(withId) };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function startOfWeek(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

export async function workspaceAnalytics(workspace) {
  const match = { workspace: workspace._id, deletedAt: null, archivedAt: null };
  const weeks = 8;
  const since = new Date(startOfWeek(new Date()).getTime() - (weeks - 1) * WEEK_MS);

  const [byStatus, byPriority, overdue, workload, completed, cycle] = await Promise.all([
    Task.aggregate([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Task.aggregate([{ $match: match }, { $group: { _id: '$priority', n: { $sum: 1 } } }]),
    Task.countDocuments({
      ...match,
      status: { $ne: TaskStatus.DONE },
      dueDate: { $lt: new Date(), $ne: null },
    }),
    Task.aggregate([
      { $match: { ...match, status: { $ne: TaskStatus.DONE }, assignee: { $ne: null } } },
      { $group: { _id: '$assignee', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
    Task.aggregate([
      { $match: { ...match, status: TaskStatus.DONE, completedAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateTrunc: { date: '$completedAt', unit: 'week', startOfWeek: 'monday' } },
          n: { $sum: 1 },
        },
      },
    ]),
    Task.aggregate([
      { $match: { ...match, status: TaskStatus.DONE, completedAt: { $ne: null } } },
      {
        $group: {
          _id: null,
          avgMs: { $avg: { $max: [0, { $subtract: ['$completedAt', '$createdAt'] }] } },
        },
      },
    ]),
  ]);

  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const weeklyCounts = new Map(completed.map((r) => [startOfWeek(r._id).getTime(), r.n]));
  const users = await findUsersByIds(workload.map((w) => w._id));

  return {
    byStatus: { todo: 0, 'in-progress': 0, done: 0, ...toMap(byStatus) },
    byPriority: { low: 0, medium: 0, high: 0, ...toMap(byPriority) },
    overdue,
    workload: workload.map((w) => ({
      userId: w._id,
      name: users.get(w._id)?.name ?? 'Unknown user',
      count: w.n,
    })),
    completedPerWeek: Array.from({ length: weeks }, (_, i) => {
      const week = new Date(since.getTime() + i * WEEK_MS);
      return { week: week.toISOString(), count: weeklyCounts.get(week.getTime()) ?? 0 };
    }),
    avgCycleTimeDays: cycle[0] ? Math.round((cycle[0].avgMs / 86_400_000) * 10) / 10 : null,
  };
}

/** Resolves a human-readable id (WEB-42) to its project and task ids for deep links. */
export async function resolveTask(workspace, { key, number }) {
  const project = await Project.findOne({ workspace: workspace._id, key, deletedAt: null }).lean();
  const task =
    project &&
    (await Task.findOne({ project: project._id, number, deletedAt: null }).select('_id').lean());
  if (!task) throw AppError.notFound('Task not found');
  return { projectId: String(project._id), taskId: String(task._id) };
}
