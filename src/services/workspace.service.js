import { createHash, randomBytes } from 'crypto';
import mongoose from 'mongoose';
import { Role, SocketEvent } from '../config/constants.js';
import { Action, can } from '../config/permissions.js';
import { Activity, AuthUser, Invite, Workspace } from '../models/index.js';
import { emitToWorkspace } from '../sockets/io.js';
import { AppError } from '../utils/AppError.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Roles that may be handed out through an invite or by an admin. Owners are promoted explicitly. */
const ADMIN_GRANTABLE = [Role.MEMBER, Role.VIEWER];

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function slugify(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base || 'workspace'}-${randomBytes(3).toString('hex')}`;
}

export function listWorkspaces(userId) {
  return Workspace.find({ 'members.userId': userId }).sort({ createdAt: 1 });
}

/** The creator becomes the workspace owner. */
export function createWorkspace(user, { name }) {
  return Workspace.create({
    name,
    slug: slugify(name),
    createdBy: user.id,
    members: [{ userId: user.id, role: Role.OWNER }],
  });
}

export function findMember(workspace, userId) {
  return workspace.members.find((m) => m.userId === userId);
}

function countOwners(workspace) {
  return workspace.members.filter((m) => m.role === Role.OWNER).length;
}

export async function findUsersByIds(ids) {
  const objectIds = ids.filter((id) => mongoose.isValidObjectId(id));
  const users = await AuthUser.find({ _id: { $in: objectIds } }).lean();
  return new Map(users.map((u) => [String(u._id), u]));
}

export async function listMembers(workspace) {
  const users = await findUsersByIds(workspace.members.map((m) => m.userId));
  return workspace.members.map((m) => {
    const user = users.get(m.userId);
    return {
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      lastActiveAt: m.lastActiveAt,
      name: user?.name ?? 'Unknown user',
      email: user?.email ?? '',
      image: user?.image ?? null,
    };
  });
}

function logActivity(workspace, actorId, type, meta) {
  return Activity.create({ workspace: workspace._id, actor: actorId, type, meta });
}

function notifyMembersChanged(workspace) {
  emitToWorkspace(workspace._id, SocketEvent.MEMBERS_CHANGED, {
    workspaceId: String(workspace._id),
  });
}

/**
 * Role rules (enforced here, never only in the UI):
 * - The role needs the member:role permission; nobody changes their own role.
 * - Admins may only move plain members/viewers between member and viewer.
 * - Only owners promote to admin/owner, demote admins/owners, or transfer ownership.
 * - The last owner can never be demoted or removed.
 */
export function assertCanChangeRole(workspace, actor, target, newRole) {
  if (!can(actor.role, Action.MEMBER_ROLE))
    throw AppError.forbidden('Your role cannot change roles');
  if (actor.userId === target.userId) throw AppError.forbidden('You cannot change your own role');
  if (
    actor.role === Role.ADMIN &&
    (!ADMIN_GRANTABLE.includes(target.role) || !ADMIN_GRANTABLE.includes(newRole))
  ) {
    throw AppError.forbidden('Only an owner can promote members or change admins and owners');
  }
  if (target.role === Role.OWNER && newRole !== Role.OWNER && countOwners(workspace) <= 1) {
    throw new AppError(409, 'LAST_OWNER', 'A workspace must keep at least one owner');
  }
}

export async function changeMemberRole(workspace, actor, targetUserId, newRole) {
  const target = findMember(workspace, targetUserId);
  if (!target) throw AppError.notFound('Member not found');
  assertCanChangeRole(workspace, actor, { ...target.toObject(), userId: targetUserId }, newRole);

  const previous = target.role;
  target.role = newRole;
  await workspace.save();
  await logActivity(workspace, actor.userId, 'member.role_changed', {
    userId: targetUserId,
    from: previous,
    to: newRole,
  });
  notifyMembersChanged(workspace);
}

export async function removeMember(workspace, actor, targetUserId) {
  const target = findMember(workspace, targetUserId);
  if (!target) throw AppError.notFound('Member not found');

  const isSelf = actor.userId === targetUserId;
  if (!isSelf) {
    if (!can(actor.role, Action.MEMBER_REMOVE)) {
      throw AppError.forbidden('Your role cannot remove other members');
    }
    if (actor.role === Role.ADMIN && !ADMIN_GRANTABLE.includes(target.role)) {
      throw AppError.forbidden('Only an owner can remove admins and owners');
    }
  }
  if (target.role === Role.OWNER && countOwners(workspace) <= 1) {
    throw new AppError(409, 'LAST_OWNER', 'A workspace must keep at least one owner');
  }

  workspace.members = workspace.members.filter((m) => m.userId !== targetUserId);
  await workspace.save();
  await logActivity(workspace, actor.userId, 'member.removed', { userId: targetUserId });
  notifyMembersChanged(workspace);
}

function assertCanGrant(actor, role) {
  if (role === Role.OWNER)
    throw AppError.badRequest('Promote someone to owner from the members list');
  if (actor.role !== Role.OWNER && !ADMIN_GRANTABLE.includes(role)) {
    throw AppError.forbidden('Only an owner can add admins');
  }
}

/** Adds an already-registered user by email. */
export async function addMember(workspace, actor, { email, role }) {
  if (!can(actor.role, Action.MEMBER_ADD)) throw AppError.forbidden('Your role cannot add people');
  assertCanGrant(actor, role);

  const user = await AuthUser.findOne({ email }).lean();
  if (!user) throw AppError.notFound('No registered user has that email yet');
  const userId = String(user._id);
  if (findMember(workspace, userId)) throw AppError.conflict('Already a member of this workspace');

  workspace.members.push({ userId, role });
  await workspace.save();
  await logActivity(workspace, actor.userId, 'member.added', { userId, role });
  notifyMembersChanged(workspace);
}

/** Records when a member was last seen; at most one write per member per five minutes. */
export function touchActive(workspace, userId) {
  const member = findMember(workspace, userId);
  const stale = !member?.lastActiveAt || Date.now() - member.lastActiveAt.getTime() > 5 * 60_000;
  if (!stale) return;
  Workspace.updateOne(
    { _id: workspace._id, 'members.userId': userId },
    { $set: { 'members.$.lastActiveAt': new Date() } },
  ).catch(() => undefined);
}

export async function toggleFavorite(workspace, userId, projectId) {
  const member = findMember(workspace, userId);
  const index = member.favorites.findIndex((id) => String(id) === projectId);
  if (index === -1) member.favorites.push(projectId);
  else member.favorites.splice(index, 1);
  await workspace.save();
  return member.favorites.map(String);
}

// ---- Invites: random token, only its SHA-256 is stored, expiring, single use -----------------

export async function createInvite(workspace, actor, { email, role }) {
  if (!can(actor.role, Action.INVITE_MANAGE))
    throw AppError.forbidden('Your role cannot invite people');
  assertCanGrant(actor, role);

  const token = randomBytes(32).toString('base64url');
  const invite = await Invite.create({
    workspace: workspace._id,
    email: email ?? null,
    role,
    tokenHash: hashToken(token),
    invitedBy: actor.userId,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  await logActivity(workspace, actor.userId, 'invite.created', { role, email: email ?? null });
  const safeInvite = invite.toJSON();
  delete safeInvite.tokenHash;
  return { invite: safeInvite, token };
}

export async function listInvites(workspace) {
  return Invite.find({
    workspace: workspace._id,
    status: 'pending',
    expiresAt: { $gt: new Date() },
  })
    .select('-tokenHash')
    .sort({ createdAt: -1 });
}

export async function revokeInvite(workspace, actor, inviteId) {
  if (!can(actor.role, Action.INVITE_MANAGE))
    throw AppError.forbidden('Your role cannot revoke invites');
  const invite = mongoose.isValidObjectId(inviteId)
    ? await Invite.findOne({ _id: inviteId, workspace: workspace._id, status: 'pending' })
    : null;
  if (!invite) throw AppError.notFound('Invite not found');
  invite.status = 'revoked';
  await invite.save();
  await logActivity(workspace, actor.userId, 'invite.revoked', { inviteId });
}

async function findUsableInvite(token) {
  const invite = await Invite.findOne({ tokenHash: hashToken(token), status: 'pending' });
  if (!invite || invite.expiresAt < new Date()) {
    throw new AppError(404, 'INVITE_INVALID', 'This invite link is invalid or has expired');
  }
  return invite;
}

export async function previewInvite(token) {
  const invite = await findUsableInvite(token);
  const workspace = await Workspace.findById(invite.workspace).lean();
  if (!workspace)
    throw new AppError(404, 'INVITE_INVALID', 'This invite link is invalid or has expired');
  return { workspaceName: workspace.name, role: invite.role, email: invite.email };
}

export async function acceptInvite(token, user) {
  const invite = await findUsableInvite(token);
  if (invite.email && invite.email !== user.email.toLowerCase()) {
    throw AppError.forbidden('This invite was sent to a different email address');
  }
  const workspace = await Workspace.findById(invite.workspace);
  if (!workspace)
    throw new AppError(404, 'INVITE_INVALID', 'This invite link is invalid or has expired');

  // Single use: claim the invite atomically before touching membership.
  const claimed = await Invite.findOneAndUpdate(
    { _id: invite._id, status: 'pending' },
    { status: 'accepted' },
  );
  if (!claimed)
    throw new AppError(404, 'INVITE_INVALID', 'This invite link is invalid or has expired');

  if (!findMember(workspace, user.id)) {
    workspace.members.push({ userId: user.id, role: invite.role });
    await workspace.save();
    await logActivity(workspace, user.id, 'member.joined', { via: 'invite', role: invite.role });
    notifyMembersChanged(workspace);
  }
  return workspace;
}
