import { AppError } from '../utils/AppError.js';
export function validate(schema, target = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return next(new AppError(422, 'VALIDATION_ERROR', 'Invalid request data', details));
    }
    // req.query is read-only in Express 5, so parsed query/params live on req.valid.
    if (target === 'body') req.body = result.data;
    else req.valid = { ...req.valid, [target]: result.data };
    next();
  };
}
