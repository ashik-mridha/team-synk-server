import { SocketEvent } from '../config/constants.js';
import { Notification } from '../models/index.js';
import { emitToUser } from '../sockets/io.js';
import { withId } from '../utils/serialize.js';

/** Persists notifications first, then pushes each one to its recipient's socket room. */
export async function notify(items) {
  if (items.length === 0) return;
  const created = await Notification.insertMany(items);
  for (const doc of created) {
    emitToUser(doc.user, SocketEvent.NOTIFICATION, { notification: doc.toJSON() });
  }
}

export async function listNotifications(userId, { unread, limit }) {
  const filter = { user: userId, ...(unread === '1' && { read: false }) };
  const [items, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({ user: userId, read: false }),
  ]);
  return { notifications: items.map(withId), unreadCount };
}

export async function markRead(userId, { ids, all }) {
  if (!all && !ids?.length) return Notification.countDocuments({ user: userId, read: false });
  const filter = { user: userId, read: false, ...(!all && { _id: { $in: ids } }) };
  await Notification.updateMany(filter, { read: true });
  return Notification.countDocuments({ user: userId, read: false });
}
