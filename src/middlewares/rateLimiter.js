import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { sendError } from '../utils/response.js';

/** General API limiter. Auth endpoints are limited by Better Auth itself (see config/auth.js). */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.API_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    sendError(res, 429, 'RATE_LIMITED', 'Too many requests, please try again later');
  },
});
