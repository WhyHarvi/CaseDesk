export function createHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  // Messages created by the application are intentionally safe for clients.
  // Unexpected dependency/database errors remain hidden by the error handler.
  error.expose = true;
  return error;
}

export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
