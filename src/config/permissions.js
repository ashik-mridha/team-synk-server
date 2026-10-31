import { Role } from './constants.js';

/**
 * The single permission map. Routes and services ask `can(role, action)`; nothing else in the
 * codebase compares roles directly for baseline access. (Hierarchy rules that depend on the
 * target, such as "admins cannot touch owners", live next to the operation in workspace.service.)
 */
export const Action = Object.freeze({
  WORKSPACE_READ: 'workspace:read',
  MEMBER_ADD: 'member:add',
  MEMBER_REMOVE: 'member:remove',
  MEMBER_ROLE: 'member:role',
  INVITE_MANAGE: 'invite:manage',
  PROJECT_CREATE: 'project:create',
  TASK_CREATE: 'task:create',
  TASK_UPDATE: 'task:update',
  TASK_DELETE: 'task:delete',
  COMMENT_CREATE: 'comment:create',
  ANALYTICS_READ: 'analytics:read',
});

const READ_ONLY = [Action.WORKSPACE_READ, Action.ANALYTICS_READ];
const CONTRIBUTE = [
  ...READ_ONLY,
  Action.PROJECT_CREATE,
  Action.TASK_CREATE,
  Action.TASK_UPDATE,
  Action.TASK_DELETE,
  Action.COMMENT_CREATE,
];
const MANAGE = [
  ...CONTRIBUTE,
  Action.MEMBER_ADD,
  Action.MEMBER_REMOVE,
  Action.MEMBER_ROLE,
  Action.INVITE_MANAGE,
];

const PERMISSIONS = {
  [Role.OWNER]: new Set(MANAGE),
  [Role.ADMIN]: new Set(MANAGE),
  [Role.MEMBER]: new Set(CONTRIBUTE),
  [Role.VIEWER]: new Set(READ_ONLY),
};

export function can(role, action) {
  return PERMISSIONS[role]?.has(action) ?? false;
}
