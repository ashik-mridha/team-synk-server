/**
 * Handle to the Socket.io server so REST services can broadcast after a successful DB write.
 * Every helper is a no-op until initSockets() runs (for example in unit tests without sockets).
 */
let io = null;

export function setIo(instance) {
  io = instance;
}

export const projectRoom = (projectId) => `project:${projectId}`;
export const workspaceRoom = (workspaceId) => `workspace:${workspaceId}`;
export const userRoom = (userId) => `user:${userId}`;

export function emitToProject(projectId, event, payload) {
  io?.to(projectRoom(String(projectId))).emit(event, payload);
}

export function emitToWorkspace(workspaceId, event, payload) {
  io?.to(workspaceRoom(String(workspaceId))).emit(event, payload);
}

export function emitToUser(userId, event, payload) {
  io?.to(userRoom(userId)).emit(event, payload);
}
