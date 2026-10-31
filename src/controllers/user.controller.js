import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const getMe = asyncHandler(async (req, res) => {
  sendSuccess(res, { user: req.user });
});
