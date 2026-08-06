import { createHash } from "node:crypto";
import prisma from "../services/prisma/client.js";
import { logger } from "../services/logger.js";

export function rateLimit({ windowMs = 60_000, max = 10, identity: customIdentity } = {}) {
  return async (req, res, next) => {
    const now = Date.now();
    const actor = typeof customIdentity === "function"
      ? String(customIdentity(req) || "anonymous")
      : `${req.ip}:${req.auth?.userId || "anonymous"}`;
    const identity = `${actor}:${req.baseUrl}:${req.route?.path || req.path}`;
    const key = createHash("sha256").update(identity).digest("hex");
    try {
      const resetAt = new Date(now + windowMs);
      const rows = await prisma.$queryRaw`
        INSERT INTO "api_rate_limit_buckets" ("key", "count", "reset_at", "updated_at") VALUES (${key}, 1, ${resetAt}, NOW())
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE WHEN "api_rate_limit_buckets"."reset_at" <= NOW() THEN 1 ELSE "api_rate_limit_buckets"."count" + 1 END,
          "reset_at" = CASE WHEN "api_rate_limit_buckets"."reset_at" <= NOW() THEN ${resetAt} ELSE "api_rate_limit_buckets"."reset_at" END,
          "updated_at" = NOW()
        RETURNING "count", "reset_at"`;
      const current = rows[0];
      if (Math.random() < 0.01) void prisma.apiRateLimitBucket.deleteMany({ where: { resetAt: { lt: new Date(now - 24 * 60 * 60_000) } } }).catch(() => {});
      if (current.count <= max) return next();
      res.set("Retry-After", String(Math.max(1, Math.ceil((new Date(current.reset_at).getTime() - now) / 1000))));
      logger.warn("http.rate_limited", { requestId: req.requestId, path: req.path, key });
      return res.status(429).json({ success: false, message: "Too many attempts. Please try again shortly.", code: "RATE_LIMITED" });
    } catch (error) {
      logger.error("rate_limit.storage_failed", { requestId: req.requestId, error: error.message });
      return res.status(503).json({ success: false, message: "Request protection is temporarily unavailable.", code: "RATE_LIMIT_UNAVAILABLE" });
    }
  };
}

export default rateLimit;
