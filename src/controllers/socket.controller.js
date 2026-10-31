import { issueSocketTicket } from '../services/socket-ticket.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const createSocketTicket = asyncHandler(async (req, res) => {
  sendSuccess(res, await issueSocketTicket(req.user.id));
});
