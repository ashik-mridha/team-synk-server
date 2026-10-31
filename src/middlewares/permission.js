import { can } from '../config/permissions.js';
import { AppError } from '../utils/AppError.js';

/** Route guard: requires `req.membership` (set by access.js) to be allowed to perform `action`. */
export function requirePermission(action) {
  return (req, _res, next) => {
    if (!req.membership || !can(req.membership.role, action)) {
      return next(AppError.forbidden('Your role does not allow this action'));
    }
    next();
  };
}
