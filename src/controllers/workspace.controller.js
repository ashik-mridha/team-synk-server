import { CLIENT_URL } from '../config/clientUrl.js';
import * as projectService from '../services/project.service.js';
import * as workspaceService from '../services/workspace.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

/** The caller's membership as `{ userId, role }` for the rule checks in the service. */
const actorOf = (req) => ({ userId: req.user.id, role: req.membership.role });

const membersPayload = async (req) => ({
  members: await workspaceService.listMembers(req.workspace),
  currentUserId: req.user.id,
  role: req.membership.role,
});

export const list = asyncHandler(async (req, res) => {
  const workspaces = await workspaceService.listWorkspaces(req.user.id);
  sendSuccess(res, { workspaces });
});

export const create = asyncHandler(async (req, res) => {
  const workspace = await workspaceService.createWorkspace(req.user, req.body);
  sendSuccess(res, { workspace }, 201);
});

export const get = asyncHandler(async (req, res) => {
  sendSuccess(res, {
    workspace: req.workspace,
    role: req.membership.role,
    favorites: req.membership.favorites.map(String),
  });
});

export const listMembers = asyncHandler(async (req, res) => {
  sendSuccess(res, await membersPayload(req));
});

export const addMember = asyncHandler(async (req, res) => {
  await workspaceService.addMember(req.workspace, actorOf(req), req.body);
  sendSuccess(res, await membersPayload(req), 201);
});

export const changeRole = asyncHandler(async (req, res) => {
  await workspaceService.changeMemberRole(
    req.workspace,
    actorOf(req),
    req.params.userId,
    req.body.role,
  );
  sendSuccess(res, await membersPayload(req));
});

export const removeMember = asyncHandler(async (req, res) => {
  await workspaceService.removeMember(req.workspace, actorOf(req), req.params.userId);
  sendSuccess(res, await membersPayload(req));
});

export const listInvites = asyncHandler(async (req, res) => {
  sendSuccess(res, { invites: await workspaceService.listInvites(req.workspace) });
});

export const createInvite = asyncHandler(async (req, res) => {
  const { invite, token } = await workspaceService.createInvite(
    req.workspace,
    actorOf(req),
    req.body,
  );
  // The raw token is shown exactly once; only its hash is stored.
  sendSuccess(res, { invite, link: `${CLIENT_URL}/invite/${token}` }, 201);
});

export const revokeInvite = asyncHandler(async (req, res) => {
  await workspaceService.revokeInvite(req.workspace, actorOf(req), req.params.inviteId);
  sendSuccess(res, { revoked: true });
});

export const toggleFavorite = asyncHandler(async (req, res) => {
  const favorites = await workspaceService.toggleFavorite(
    req.workspace,
    req.user.id,
    req.params.projectId,
  );
  sendSuccess(res, { favorites });
});

export const listProjects = asyncHandler(async (req, res) => {
  sendSuccess(res, { projects: await projectService.listProjects(req.workspace) });
});

export const createProject = asyncHandler(async (req, res) => {
  const project = await projectService.createProject(req.workspace, req.user, req.body);
  sendSuccess(res, { project }, 201);
});

export const search = asyncHandler(async (req, res) => {
  sendSuccess(res, await projectService.searchWorkspace(req.workspace, req.valid.query.q));
});

export const analytics = asyncHandler(async (req, res) => {
  sendSuccess(res, await projectService.workspaceAnalytics(req.workspace));
});

export const resolve = asyncHandler(async (req, res) => {
  sendSuccess(res, await projectService.resolveTask(req.workspace, req.valid.query));
});
