export function sendSuccess(res, data, statusCode = 200) {
  const body = { success: true, data, error: null };
  return res.status(statusCode).json(body);
}
export function sendError(res, statusCode, code, message, details = null) {
  const body = { success: false, data: null, error: { code, message, details } };
  return res.status(statusCode).json(body);
}
