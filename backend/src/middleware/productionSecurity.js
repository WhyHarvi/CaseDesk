import { randomUUID } from "node:crypto";
import { logger } from "../services/logger.js";

export function requestContext(req, res, next) {
  req.requestId = String(req.get("x-request-id") || randomUUID()).slice(0, 100);
  res.set("X-Request-Id", req.requestId);
  const started = performance.now();
  res.on("finish", () => logger.info("http.request", { requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(performance.now() - started), agencyId: req.auth?.agencyId, userId: req.auth?.userId }));
  next();
}

export function secureHeaders(req, res, next) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Resource-Policy": "same-site",
    "Cache-Control": "no-store",
  });
  if (process.env.NODE_ENV === "production") res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}
