import { askCaseDeskAI, checkCaseDeskAI, extractCaseDeskIntent } from "../services/ollama.service.js";
import { resolveCaseDeskAIInsight, resolveProactiveNovaInsight } from "../services/aiInsightService.js";
import { shouldExtractCaseDeskIntent } from "../services/aiIntentService.js";
import { logger } from "../services/logger.js";
import { createHttpError } from "../utils/http.js";

function messagesFromRequest(body) {
  if (Array.isArray(body?.messages)) return body.messages;
  if (body?.message) return [{ role: "user", content: body.message }];
  return [];
}

export async function chatWithCaseDeskAI(req, res) {
  const currentPath = typeof req.body?.currentPath === "string"
    ? req.body.currentPath.slice(0, 300)
    : "";
  const messages = messagesFromRequest(req.body);
  if (!messages.length) {
    throw createHttpError(400, "Message is required.", "AI_MESSAGE_REQUIRED");
  }

  let insight = await resolveCaseDeskAIInsight(req, messages);
  if (!insight && shouldExtractCaseDeskIntent(messages)) {
    try {
      const structuredIntent = await extractCaseDeskIntent(messages, {
        currentPath,
        role: req.auth?.role,
      });
      if (structuredIntent) {
        insight = await resolveCaseDeskAIInsight(req, messages, { structuredIntent });
      }
    } catch (error) {
      logger.warn("ai.intent_extraction_failed", {
        requestId: req.requestId,
        agencyId: req.auth?.agencyId,
        userId: req.auth?.userId,
        code: error.code,
        reason: error.message,
      });
    }
  }
  if (insight?.answer) {
    return res.json({
      success: true,
      message: insight.answer,
      model: "CaseDesk live data",
    });
  }

  const result = await askCaseDeskAI(messages, {
    currentPath,
    role: req.auth?.role,
    agencyId: req.auth?.agencyId,
    userId: req.auth?.userId,
    liveContext: insight?.liveContext,
  });

  res.json({
    success: true,
    message: result.content,
    model: result.model,
  });
}

const ENTITY_TYPES = new Set(["client", "case"]);

export async function getCaseDeskProactiveInsight(req, res) {
  const currentPath = typeof req.query?.path === "string" ? req.query.path.slice(0, 300) : "";
  const entityType = ENTITY_TYPES.has(req.query?.entityType) ? req.query.entityType : "";
  const entityId = entityType && typeof req.query?.entityId === "string" ? req.query.entityId.slice(0, 100) : "";
  const insight = await resolveProactiveNovaInsight(req, { currentPath, entityType, entityId });
  res.json({ success: true, insight: insight || null });
}

export async function getCaseDeskAIStatus(_req, res) {
  const status = await checkCaseDeskAI();
  res.status(status.available ? 200 : 503).json({
    success: status.available,
    ...status,
  });
}
