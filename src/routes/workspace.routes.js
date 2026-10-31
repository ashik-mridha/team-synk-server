import { Router } from 'express';
import { Action } from '../config/permissions.js';
import * as workspaces from '../controllers/workspace.controller.js';
import { loadWorkspace } from '../middlewares/access.js';
import { requirePermission } from '../middlewares/permission.js';
import { validate } from '../middlewares/validate.js';
import {
  addMemberSchema,
  changeRoleSchema,
  createInviteSchema,
  createProjectSchema,
  createWorkspaceSchema,
  resolveSchema,
  searchSchema,
} from '../validators/workspace.validators.js';

export const workspaceRouter = Router();

workspaceRouter.get('/', workspaces.list);
workspaceRouter.post('/', validate(createWorkspaceSchema), workspaces.create);

const scoped = Router({ mergeParams: true });
scoped.use(loadWorkspace);
scoped.get('/', workspaces.get);
scoped.get('/members', workspaces.listMembers);
scoped.post('/members', validate(addMemberSchema), workspaces.addMember);
scoped.patch('/members/:userId/role', validate(changeRoleSchema), workspaces.changeRole);
scoped.delete('/members/:userId', workspaces.removeMember);
scoped.get('/invites', requirePermission(Action.INVITE_MANAGE), workspaces.listInvites);
scoped.post(
  '/invites',
  requirePermission(Action.INVITE_MANAGE),
  validate(createInviteSchema),
  workspaces.createInvite,
);
scoped.delete(
  '/invites/:inviteId',
  requirePermission(Action.INVITE_MANAGE),
  workspaces.revokeInvite,
);
scoped.post('/favorites/:projectId', workspaces.toggleFavorite);
scoped.get('/projects', workspaces.listProjects);
scoped.post(
  '/projects',
  requirePermission(Action.PROJECT_CREATE),
  validate(createProjectSchema),
  workspaces.createProject,
);
scoped.get('/search', validate(searchSchema, 'query'), workspaces.search);
scoped.get('/resolve', validate(resolveSchema, 'query'), workspaces.resolve);
scoped.get('/analytics', requirePermission(Action.ANALYTICS_READ), workspaces.analytics);

workspaceRouter.use('/:workspaceId', scoped);
