import { createHash, randomBytes } from 'crypto';
import { AuthUser, SocketTicket } from '../models/index.js';

const TICKET_TTL_MS = 30_000;
const hash = (ticket) => createHash('sha256').update(ticket).digest('hex');

/** Issues a one-time ticket for the already-authenticated REST caller. Only its hash is stored. */
export async function issueSocketTicket(userId) {
  const ticket = randomBytes(32).toString('base64url');
  await SocketTicket.create({
    tokenHash: hash(ticket),
    user: userId,
    expiresAt: new Date(Date.now() + TICKET_TTL_MS),
  });
  return { ticket, expiresInSeconds: TICKET_TTL_MS / 1000 };
}

/**
 * Atomically consumes a ticket (so it can never be replayed) and returns the user it was issued
 * to, read from the database. Nothing about identity comes from the client.
 */
export async function consumeSocketTicket(ticket) {
  if (typeof ticket !== 'string' || ticket.length > 200) return null;
  const doc = await SocketTicket.findOneAndDelete({
    tokenHash: hash(ticket),
    expiresAt: { $gt: new Date() },
  });
  if (!doc) return null;
  const user = await AuthUser.findById(doc.user).lean();
  if (!user) return null;
  return { id: String(user._id), name: user.name, image: user.image ?? null };
}
