import { createCaseInvoice, listCaseInvoices, recordCashPayment } from "../services/caseInvoiceService.js";

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
