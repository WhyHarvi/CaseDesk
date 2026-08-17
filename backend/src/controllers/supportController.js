import { createSupportTicket, listUserSupportTickets } from "../services/supportTicketService.js";
import { summarizeSupportIssue } from "../services/ollama.service.js";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";

const clean = (value, max) => String(value || "").trim().slice(0, max);

export async function diagnoseSupportIssue(req, res) {
  const description = clean(req.body?.description, 5000);
  if (!description) throw createHttpError(400, "Describe what happened before asking Nova to summarize it.", "SUPPORT_DESCRIPTION_REQUIRED");
  const context = {
    description,
    pagePath: clean(req.body?.pagePath, 500),
    errorCode: clean(req.body?.errorCode, 120),
    errorMessage: clean(req.body?.errorMessage, 1000),
  };
  try {
    const summary = await summarizeSupportIssue(context);
    return res.json({ data: { summary, source: "Nova" } });
  } catch {
    const summary = [`Problem: ${description}`, context.pagePath ? `Page: ${context.pagePath}` : null, context.errorCode ? `Detected error: ${context.errorCode}${context.errorMessage ? ` · ${context.errorMessage}` : ""}` : null].filter(Boolean).join("\n");
    return res.json({ data: { summary, source: "Basic summary" } });
  }
}

export async function submitSupportTicket(req, res) {
  if (!clean(req.body?.description, 5000)) throw createHttpError(400, "Describe the problem before sending the report.", "SUPPORT_DESCRIPTION_REQUIRED");
  const agency = await prisma.agency.findUnique({ where: { id: req.auth.agencyId }, select: { name: true } });
  const data = await createSupportTicket({
    agencyId: req.auth.agencyId,
    user: { id: req.auth.userId, fullName: req.user.fullName, email: req.user.email, agencyName: agency?.name },
    values: req.body,
    screenshot: req.file || null,
  });
  res.status(201).json({ data });
}

export async function listSupportTickets(req, res) {
  res.json({ data: await listUserSupportTickets(req.auth.agencyId, req.auth.userId) });
}
