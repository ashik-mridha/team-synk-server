import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getSession } from '../utils/session.js';

/** Requires a valid Better Auth session; attaches `req.user` and `req.session`. */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const result = await getSession(req.headers);
  if (!result) throw AppError.unauthorized();

  req.user = result.user;
  req.session = result.session;
  next();
});
