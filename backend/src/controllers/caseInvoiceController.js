import { createCaseInvoice, getCaseInvoicePdf, listCaseInvoices, recordCashPayment, recordManualPayment } from "../services/caseInvoiceService.js";

export async function listInvoices(req, res) {
  const data = await listCaseInvoices(req.auth.agencyId, req.params.id);
  res.json({ data });
}

export async function createInvoice(req, res) {
  const data = await createCaseInvoice(req.auth.agencyId, {
    caseId: req.params.id,
    paymentType: req.body?.paymentType,
    description: req.body?.description,
    amount: req.body?.amount,
    dueDate: req.body?.dueDate,
    actorUserId: req.auth.userId,
  });
  res.status(201).json({ data });
}

export async function downloadInvoicePdf(req, res) {
  const { buffer, filename } = await getCaseInvoicePdf(req.auth.agencyId, { caseId: req.params.id, invoiceId: req.params.invoiceId });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.length);
  res.send(buffer);
}

export async function createCashPayment(req, res) {
  const data = await recordCashPayment(req.auth.agencyId, {
    caseId: req.params.id,
    invoiceId: req.params.invoiceId,
    amount: req.body?.amount,
    note: req.body?.note,
    actorUserId: req.auth.userId,
  });
  res.json({ data });
}

export async function createManualPayment(req, res) {
  const data = await recordManualPayment(req.auth.agencyId, {
    caseId: req.params.id,
    invoiceId: req.params.invoiceId,
    amount: req.body?.amount,
    method: req.body?.method,
    transactionReference: req.body?.transactionReference,
    paymentDate: req.body?.paymentDate,
    note: req.body?.note,
    idempotencyKey: req.body?.idempotencyKey,
    actorUserId: req.auth.userId,
  });
  res.json({ data });
}
