import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../config/auth.js';

/**
 * Resolves the Better Auth session from Node-style request headers (Express `req.headers`
 * or Socket.io `socket.handshake.headers`). Returns `{ user, session }` or null.
 */
export function getSession(nodeHeaders) {
  return auth.api.getSession({ headers: fromNodeHeaders(nodeHeaders) });
}
