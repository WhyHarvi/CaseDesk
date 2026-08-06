import { logger } from "../services/logger.js";

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.originalUrl}`,
    code: "NOT_FOUND",
  });
}

export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || (err.name === "MulterError" ? 400 : 500);
  const isProduction = process.env.NODE_ENV === "production";
  const hideInternalMessage = statusCode >= 500 && err.expose !== true && isProduction;

  if (process.env.NODE_ENV !== "test") {
    // Keep logging simple for the MVP scaffold.
    logger.error("http.error", { requestId: req.requestId, statusCode, code: err.code, error: err.message, stack: statusCode >= 500 ? err.stack : undefined });
  }

  res.status(statusCode).json({
    success: false,
    message: hideInternalMessage ? "An unexpected error occurred." : err.message || "Request failed.",
    code: err.code || (statusCode === 401 ? "UNAUTHENTICATED" : statusCode === 403 ? "FORBIDDEN" : statusCode === 404 ? "NOT_FOUND" : statusCode === 400 ? "VALIDATION_ERROR" : "INTERNAL_ERROR"),
    ...(!isProduction && statusCode >= 500 ? { requestId: req.requestId } : {}),
  });
}

export default errorHandler;
