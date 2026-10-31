/**
 * In-memory presence per project: which users have the board open (across tabs) and which task
 * each is viewing. Entries disappear when their last socket disconnects, so a crashed tab
 * cannot leave a ghost behind (Socket.io's ping/pong detects dead connections).
 */
const projects = new Map();

export function addPresence(projectId, user, socketId) {
  const users = projects.get(projectId) ?? new Map();
  const entry = users.get(user.id) ?? { user, sockets: new Set(), viewing: null };
  entry.sockets.add(socketId);
  users.set(user.id, entry);
  projects.set(projectId, users);
}

export function removePresence(projectId, userId, socketId) {
  const users = projects.get(projectId);
  const entry = users?.get(userId);
  if (!entry) return;
  entry.sockets.delete(socketId);
  if (entry.sockets.size === 0) users.delete(userId);
  if (users.size === 0) projects.delete(projectId);
}

export function setViewing(projectId, userId, taskId) {
  const entry = projects.get(projectId)?.get(userId);
  if (entry) entry.viewing = taskId;
}

export function listPresence(projectId) {
  return [...(projects.get(projectId)?.values() ?? [])].map(({ user, viewing }) => ({
    userId: user.id,
    name: user.name,
    image: user.image,
    viewing,
  }));
}
