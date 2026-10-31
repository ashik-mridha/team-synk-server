import { isProd } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { sendError } from '../utils/response.js';
export const notFoundHandler = (req, _res, next) => {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
};
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof AppError) {
    sendError(res, err.statusCode, err.code, err.message, err.details ?? null);
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    sendError(res, 400, 'INVALID_JSON', 'Malformed JSON body');
    return;
  }
  logger.error({ err, path: req.originalUrl }, 'Unhandled error');
  const message = isProd
    ? 'Something went wrong'
    : err instanceof Error
      ? err.message
      : 'Unknown error';
  // The request id lets a user report an error that can be found in the logs.
  sendError(res, 500, 'INTERNAL_ERROR', message, { requestId: req.id });
};
