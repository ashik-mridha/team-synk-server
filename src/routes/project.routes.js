import { Router } from 'express';
import { Action } from '../config/permissions.js';
import * as projects from '../controllers/project.controller.js';
import { loadComment, loadProject, loadTask } from '../middlewares/access.js';
import { requirePermission } from '../middlewares/permission.js';
import { validate } from '../middlewares/validate.js';
import {
  createCommentSchema,
  createTaskSchema,
  listTasksQuerySchema,
  moveTaskSchema,
  reactionSchema,
  updateTaskSchema,
} from '../validators/workspace.validators.js';

export const projectRouter = Router();

projectRouter.get('/projects/:projectId', loadProject, projects.getProject);
projectRouter.get(
  '/projects/:projectId/tasks',
  loadProject,
  validate(listTasksQuerySchema, 'query'),
  projects.listTasks,
);
projectRouter.post(
  '/projects/:projectId/tasks',
  loadProject,
  requirePermission(Action.TASK_CREATE),
  validate(createTaskSchema),
  projects.createTask,
);

projectRouter.patch(
  '/tasks/:taskId',
  loadTask,
  requirePermission(Action.TASK_UPDATE),
  validate(updateTaskSchema),
  projects.updateTask,
);
projectRouter.post(
  '/tasks/:taskId/move',
  loadTask,
  requirePermission(Action.TASK_UPDATE),
  validate(moveTaskSchema),
  projects.moveTask,
);
projectRouter.delete(
  '/tasks/:taskId',
  loadTask,
  requirePermission(Action.TASK_DELETE),
  projects.deleteTask,
);
projectRouter.post(
  '/tasks/:taskId/restore',
  loadTask,
  requirePermission(Action.TASK_DELETE),
  projects.restoreTask,
);

projectRouter.get('/tasks/:taskId/comments', loadTask, projects.listComments);
projectRouter.post(
  '/tasks/:taskId/comments',
  loadTask,
  requirePermission(Action.COMMENT_CREATE),
  validate(createCommentSchema),
  projects.createComment,
);
projectRouter.get('/tasks/:taskId/activity', loadTask, projects.listActivity);
projectRouter.post(
  '/comments/:commentId/reactions',
  loadComment,
  requirePermission(Action.COMMENT_CREATE),
  validate(reactionSchema),
  projects.reactToComment,
);
