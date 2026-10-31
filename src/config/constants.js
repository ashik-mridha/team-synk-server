/** Global role stored on the Better Auth user document. */
export const GlobalRole = Object.freeze({ USER: 'user', ADMIN: 'admin' });

/** Workspace-level roles, stored in `workspaces.members[].role`. */
export const Role = Object.freeze({
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  VIEWER: 'viewer',
});

export const Priority = Object.freeze({ LOW: 'low', MEDIUM: 'medium', HIGH: 'high' });

export const TaskStatus = Object.freeze({
  TODO: 'todo',
  IN_PROGRESS: 'in-progress',
  DONE: 'done',
});

export const NotificationType = Object.freeze({
  MENTION: 'mention',
  ASSIGNED: 'assigned',
  COMMENT: 'comment',
});

/** Collections Better Auth manages itself (singular names). */
export const AUTH_COLLECTIONS = Object.freeze(['user', 'session', 'account', 'verification']);

/** Real-time event names shared by the server (and mirrored on the client). */
export const SocketEvent = Object.freeze({
  TASK_CREATED: 'task:created',
  TASK_UPDATED: 'task:updated',
  TASK_DELETED: 'task:deleted',
  COMMENT_CREATED: 'comment:created',
  COMMENT_UPDATED: 'comment:updated',
  PRESENCE: 'presence:update',
  TYPING: 'comment:typing',
  NOTIFICATION: 'notification:new',
  MEMBERS_CHANGED: 'members:changed',
});
