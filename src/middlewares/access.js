import mongoose from 'mongoose';
import { Comment, Project, Task, Workspace } from '../models/index.js';
import { findMember, touchActive } from '../services/workspace.service.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Resolves a workspace and the caller's membership. Non-members get a 404 so ids cannot be probed
 * (IDOR): every nested resource is looked up first, then authorised against its own workspace.
 */
async function resolveWorkspace(req, workspaceId) {
  const workspace = mongoose.isValidObjectId(workspaceId)
    ? await Workspace.findById(workspaceId)
    : null;
  const membership = workspace && findMember(workspace, req.user.id);
  if (!workspace || !membership) throw AppError.notFound('Workspace not found');
  req.workspace = workspace;
  req.membership = membership;
  touchActive(workspace, req.user.id);
}

export const loadWorkspace = asyncHandler(async (req, _res, next) => {
  await resolveWorkspace(req, req.params.workspaceId);
  next();
});

export const loadProject = asyncHandler(async (req, _res, next) => {
  const { projectId } = req.params;
  const project = mongoose.isValidObjectId(projectId)
    ? await Project.findOne({ _id: projectId, deletedAt: null })
    : null;
  if (!project) throw AppError.notFound('Project not found');
  await resolveWorkspace(req, String(project.workspace));
  req.project = project;
  next();
});

export const loadTask = asyncHandler(async (req, _res, next) => {
  const { taskId } = req.params;
  const task = mongoose.isValidObjectId(taskId) ? await Task.findById(taskId) : null;
  // A soft-deleted task is only reachable for restore.
  if (!task || (task.deletedAt && !req.path.endsWith('/restore'))) {
    throw AppError.notFound('Task not found');
  }
  await resolveWorkspace(req, String(task.workspace));
  req.task = task;
  next();
});

export const loadComment = asyncHandler(async (req, _res, next) => {
  const { commentId } = req.params;
  const comment = mongoose.isValidObjectId(commentId) ? await Comment.findById(commentId) : null;
  if (!comment) throw AppError.notFound('Comment not found');
  await resolveWorkspace(req, String(comment.workspace));
  req.comment = comment;
  next();
});
