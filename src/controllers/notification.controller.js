import * as notificationService from '../services/notification.service.js';
import * as workspaceService from '../services/workspace.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const list = asyncHandler(async (req, res) => {
  sendSuccess(res, await notificationService.listNotifications(req.user.id, req.valid.query));
});

export const markRead = asyncHandler(async (req, res) => {
  sendSuccess(res, { unreadCount: await notificationService.markRead(req.user.id, req.body) });
});

/** Public: lets the invite page show what is being joined before the visitor signs in. */
export const previewInvite = asyncHandler(async (req, res) => {
  sendSuccess(res, await workspaceService.previewInvite(req.params.token));
});

export const acceptInvite = asyncHandler(async (req, res) => {
  const workspace = await workspaceService.acceptInvite(req.params.token, req.user);
  sendSuccess(res, { workspace });
});
