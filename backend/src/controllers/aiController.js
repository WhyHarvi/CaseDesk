import { askCaseDeskAI, checkCaseDeskAI } from "../services/ollama.service.js";
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

  const result = await askCaseDeskAI(messages, {
    currentPath,
    role: req.auth?.role,
    agencyId: req.auth?.agencyId,
    userId: req.auth?.userId,
  });

  res.json({
    success: true,
    message: result.content,
    model: result.model,
  });
}

export async function getCaseDeskAIStatus(_req, res) {
  const status = await checkCaseDeskAI();
  res.status(status.available ? 200 : 503).json({
    success: status.available,
    ...status,
  });
}
