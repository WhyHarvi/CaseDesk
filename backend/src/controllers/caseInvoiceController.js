import { randomUUID } from "node:crypto";
import { ACCOUNTING_PROVIDERS, createCaseInvoice, describeInvoiceRefundRequest, getCaseInvoicePdf, listCaseInvoices, recordCashPayment, recordManualPayment, requestCaseInvoiceRefund } from "../services/caseInvoiceService.js";
import { approvePaymentApproval, submitPaymentApproval } from "../services/paymentApprovalService.js";

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
    actorRole: req.auth.role,
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
    actorRole: req.auth.role,
  });
  res.json({ data });
}

// Cash refunds are real money leaving the office with no external system
// (like QuickBooks) double-checking the transaction, so — unlike QuickBooks
// refunds, which already require a human to complete them inside QuickBooks —
// they go through the same payment-approval queue used for incoming cash.
// An admin submitting their own refund is auto-approved in the same request
// (still fully audited via the approval record); an accountant's request
// waits in the approvals queue for an admin. QuickBooks refunds are
// unaffected and keep the direct "tracked request" path.
export async function createInvoiceRefund(req, res) {
  const { invoice, numericAmount, refundReason } = await describeInvoiceRefundRequest(req.auth.agencyId, {
    caseId: req.params.id,
    invoiceId: req.params.invoiceId,
    amount: req.body?.amount,
    reason: req.body?.reason,
  });

  if (invoice.accountingProvider === ACCOUNTING_PROVIDERS.CASH) {
    const approval = await submitPaymentApproval(req.auth.agencyId, {
      entryType: "invoice_refund",
      caseId: invoice.caseId,
      caseInvoiceId: invoice.id,
      clientId: invoice.clientId,
      amount: numericAmount,
      description: refundReason,
      method: "Cash",
      paymentDate: new Date().toISOString().slice(0, 10),
      idempotencyKey: `refund-${invoice.id}-${randomUUID()}`,
      actorUserId: req.auth.userId,
      sourceRole: req.auth.role,
    });
    if (req.auth.role === "admin") {
      const approved = await approvePaymentApproval(req.auth.agencyId, approval.id, req.auth.userId);
      res.status(201).json({ data: { ...approved.result, approvalRequired: false, approval: approved } });
      return;
    }
    res.status(202).json({ data: { approvalRequired: true, approval } });
    return;
  }

  const data = await requestCaseInvoiceRefund(req.auth.agencyId, {
    caseId: req.params.id,
    invoiceId: req.params.invoiceId,
    amount: req.body?.amount,
    reason: req.body?.reason,
    actorUserId: req.auth.userId,
  });
  res.status(201).json({ data });
}
