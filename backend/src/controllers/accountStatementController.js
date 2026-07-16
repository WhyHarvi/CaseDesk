import prisma from "../services/prisma/client.js";
import { clientAccessWhere } from "../middleware/authorization.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { buildAccountStatement, createStatementGeneration } from "../services/accountStatementService.js";
import { generateAccountStatementPdf } from "../services/accountStatementPdfService.js";

async function getScopedClient(req) {
  const client = await prisma.client.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, ...clientAccessWhere(req) },
    select: { id: true, fullName: true },
  });
  if (!client) throw createHttpError(404, "Client not found");
  return client;
}

async function getAvailableOptions(req, client) {
  const [agency, cases, paymentCurrencies] = await Promise.all([
    prisma.agency.findUnique({ where: { id: req.auth.agencyId }, select: { defaultCurrency: true, locale: true, timezone: true } }),
    prisma.case.findMany({ where: { agencyId: req.auth.agencyId, clientId: client.id }, orderBy: [{ createdAt: "asc" }], select: { id: true, caseType: true, stage: true, status: true } }),
    prisma.payment.findMany({ where: { agencyId: req.auth.agencyId, clientId: client.id }, distinct: ["currency"], select: { currency: true } }),
  ]);
  const currencies = [...new Set([agency?.defaultCurrency || "CAD", ...paymentCurrencies.map((item) => item.currency)])];
  return { agency, cases, currencies };
}

export async function getAccountStatementOptions(req, res) {
  const client = await getScopedClient(req);
  const options = await getAvailableOptions(req, client);
  res.json({ data: { client, cases: options.cases, currencies: options.currencies, defaultCurrency: options.agency?.defaultCurrency || "CAD" } });
}

export async function generateAccountStatement(req, res) {
  const client = await getScopedClient(req);
  const options = await getAvailableOptions(req, client);
  const caseId = req.body.caseId || null;
  if (caseId && !options.cases.some((item) => item.id === caseId)) throw createHttpError(400, "Selected case is unavailable");
  const currency = String(req.body.currency || options.agency?.defaultCurrency || "CAD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw createHttpError(400, "Choose a valid currency");

  const generation = await createStatementGeneration({
    agencyId: req.auth.agencyId,
    clientId: client.id,
    generatedById: req.auth.userId,
    caseId,
    from: req.body.from || null,
    to: req.body.to || null,
    currency,
    timezone: options.agency?.timezone,
  });
  const statement = await buildAccountStatement({ agencyId: req.auth.agencyId, clientId: client.id, generation });
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: client.id, caseId, action: "statement.account_generated", details: `${statement.statementNumber} generated`, entityType: "account_statement", entityId: generation.id, metadata: { from: req.body.from || null, to: req.body.to || null, currency } });
  res.status(201).json({ data: statement });
}

export async function getGeneratedAccountStatement(req, res) {
  const client = await getScopedClient(req);
  const generation = await prisma.accountStatementGeneration.findFirst({ where: { id: req.params.statementId, clientId: client.id, agencyId: req.auth.agencyId } });
  if (!generation) throw createHttpError(404, "Statement not found");
  const statement = await buildAccountStatement({ agencyId: req.auth.agencyId, clientId: client.id, generation });
  if (req.query.format !== "pdf") return res.json({ data: statement });

  const pdf = await generateAccountStatementPdf(statement);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${statement.statementNumber}.pdf"`);
  res.setHeader("Content-Length", pdf.length);
  res.send(pdf);
}
