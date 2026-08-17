import prisma from "../services/prisma/client.js";
import { clientAccessWhere } from "../middleware/authorization.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { buildAccountStatement, buildClientBillingLedger, createStatementGeneration } from "../services/accountStatementService.js";
import { generateAccountStatementPdf } from "../services/accountStatementPdfService.js";
import { listFeeCategories } from "../services/feeCategoryService.js";
import {
  assertManualPaymentReferenceAvailable,
  createCaseInvoice,
  recordManualPayment as recordCaseInvoiceManualPayment,
  validateManualPaymentInput,
} from "../services/caseInvoiceService.js";
import { recordWalkInManualPayment, updatePaidAppointmentPaymentDetails } from "../services/bookingPaymentHoldService.js";
import { normalizeContact } from "../services/contactDuplicateService.js";
import { notifyInvoiceCreated } from "../services/paymentNotificationService.js";
import { approvePaymentApproval, submitPaymentApproval } from "../services/paymentApprovalService.js";
import { applyLocalCashToInvoice } from "../services/paymentApprovalLedgerService.js";

async function getScopedClient(req) {
  const client = await prisma.client.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, ...clientAccessWhere(req) },
    select: { id: true, fullName: true, email: true, emailNormalized: true, phone: true, phoneNormalized: true, qbCustomerId: true },
  });
  if (!client) throw createHttpError(404, "Client not found");
  return client;
}

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase() || null;
}

function normalizedPhone(value) {
  if (!value) return null;
  try {
    return normalizeContact({ phone: value }).phoneNormalized;
  } catch {
    return null;
  }
}

function clientAppointmentContactWhere(client) {
  const email = normalizedEmail(client.emailNormalized || client.email);
  const phone = normalizedPhone(client.phoneNormalized || client.phone);
  const phoneValues = [...new Set([client.phone, client.phoneNormalized, phone].filter(Boolean))];
  return [
    { clientId: client.id },
    ...(email ? [{ clientId: null, guestEmailNormalized: email }] : []),
    ...(phoneValues.length ? [{ clientId: null, guestPhone: { in: phoneValues } }] : []),
  ];
}

function appointmentContactMatchesClient(appointment, client) {
  const clientEmail = normalizedEmail(client.emailNormalized || client.email);
  const clientPhone = normalizedPhone(client.phoneNormalized || client.phone);
  const guestEmail = normalizedEmail(appointment.guestEmailNormalized || appointment.guestEmail);
  const guestPhone = normalizedPhone(appointment.guestPhone);
  return Boolean(
    (clientEmail && clientEmail === guestEmail)
    || (clientPhone && clientPhone === guestPhone),
  );
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

export async function getClientBillingOverview(req, res) {
  const client = await getScopedClient(req);
  const options = await getAvailableOptions(req, client);
  const currency = String(req.query.currency || options.agency?.defaultCurrency || "CAD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw createHttpError(400, "Choose a valid currency");
  const caseReferences = Object.fromEntries(options.cases.map((item) => [item.id, item.caseType]));
  const ledger = await buildClientBillingLedger({
    agencyId: req.auth.agencyId,
    client,
    currency,
    defaultCurrency: options.agency?.defaultCurrency || "CAD",
    caseReferences,
  });
  res.json({
    data: {
      client: { id: client.id, fullName: client.fullName },
      currency,
      summary: ledger.summary,
      transactions: [...ledger.transactions].reverse(),
      syncWarning: ledger.syncWarning,
      sourceCounts: ledger.sourceCounts,
      refreshedAt: new Date(),
    },
  });
}

export async function getClientManualBillingOptions(req, res) {
  const client = await getScopedClient(req);
  const [categories, cases, invoices, appointments, bookingSettings] = await Promise.all([
    listFeeCategories(req.auth.agencyId),
    prisma.case.findMany({
      where: { agencyId: req.auth.agencyId, clientId: client.id, deletedAt: null },
      select: { id: true, caseType: true, stage: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.caseInvoice.findMany({
      where: { agencyId: req.auth.agencyId, clientId: client.id, balance: { gt: 0 }, status: { notIn: ["Void", "Voided"] } },
      select: {
        id: true, caseId: true, description: true, paymentType: true, qbInvoiceNumber: true,
        amount: true, balance: true, status: true, dueDate: true,
        paymentApprovals: { where: { status: "Approved", method: "Cash" }, orderBy: { paymentDate: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.appointment.findMany({
      where: {
        agencyId: req.auth.agencyId,
        OR: clientAppointmentContactWhere(client),
        status: { in: ["Scheduled", "Completed", "NoShow", "Cancelled"] },
      },
      select: {
        id: true,
        clientId: true,
        subject: true,
        startsAt: true,
        status: true,
        isFreeConsultation: true,
        guestEmail: true,
        guestEmailNormalized: true,
        guestPhone: true,
        caseId: true,
        case: { select: { caseType: true } },
        sessionType: { select: { name: true } },
        paymentHold: { select: { id: true, status: true, amount: true, paymentMethod: true, manualPaymentReference: true, paidAt: true } },
      },
      orderBy: { startsAt: "desc" },
      take: 100,
    }),
    prisma.bookingSettings.findUnique({ where: { agencyId: req.auth.agencyId }, select: { consultFeeAmount: true } }),
  ]);
  const visibleAppointments = appointments.filter((item) => {
    if (item.paymentHold?.status === "Refunded") return false;
    if (item.paymentHold?.status !== "Paid") return true;
    return item.paymentHold.paymentMethod === "ETransfer" && !item.paymentHold.manualPaymentReference;
  });
  res.json({
    data: {
      client: { id: client.id, fullName: client.fullName },
      categories: categories.map((item) => ({ id: item.id, code: item.code, name: item.name, kind: item.kind, description: item.description, mapped: Boolean(item.qboItemId) })),
      cases,
      invoices: invoices.map(applyLocalCashToInvoice).filter((item) => Number(item.balance) > 0),
      appointments: visibleAppointments.map(({ guestEmail, guestEmailNormalized, guestPhone, ...item }) => ({
        ...item,
        identityMatched: !item.clientId && appointmentContactMatchesClient({ guestEmail, guestEmailNormalized, guestPhone }, client),
      })),
      consultationFee: Number(bookingSettings?.consultFeeAmount || 0),
      approvalRequiredForEntries: req.auth.role === "frontdesk",
      cashStoredInCaseDesk: true,
      today: new Date().toISOString().slice(0, 10),
    },
  });
}

export async function createClientManualBillingEntry(req, res) {
  const client = await getScopedClient(req);
  const entryType = String(req.body?.entryType || "");
  const commonPayment = {
    method: req.body?.method,
    transactionReference: req.body?.transactionReference,
    paymentDate: req.body?.paymentDate,
    note: req.body?.note,
    actorUserId: req.auth.userId,
  };

  // Cash is the one method CaseDesk can't independently verify against a
  // bank reference, so it always goes through administrator review — for
  // every entry type, any role — before anything is marked paid or sent to
  // QuickBooks. For a consultation payment specifically (already tied to a
  // fixed, pre-agreed fee, unlike a new case charge frontdesk could type in
  // any amount for) any other method has a checkable reference and posts
  // immediately even for frontdesk. Case billing (a new charge, or payment
  // against an existing invoice) is untouched: frontdesk still needs
  // administrator review there regardless of method.
  const isAppointmentPayment = ["appointment_payment", "appointment_payment_details"].includes(entryType);
  if (req.body?.method === "Cash" || (req.auth.role === "frontdesk" && !isAppointmentPayment)) {
    const approval = await submitPaymentApproval(req.auth.agencyId, {
      entryType,
      clientId: client.id,
      appointmentId: req.body?.appointmentId,
      invoiceId: req.body?.invoiceId,
      caseId: req.body?.caseId,
      paymentType: req.body?.paymentType,
      description: req.body?.description,
      chargeAmount: req.body?.chargeAmount,
      amount: req.body?.amount,
      method: req.body?.method,
      transactionReference: req.body?.transactionReference,
      paymentDate: req.body?.paymentDate,
      note: req.body?.note,
      idempotencyKey: req.body?.idempotencyKey,
      overrideFreeConsultation: req.body?.overrideFreeConsultation === true,
      actorUserId: req.auth.userId,
      sourceRole: req.auth.role,
    });
    if (req.auth.role !== "frontdesk") {
      const approved = await approvePaymentApproval(req.auth.agencyId, approval.id, req.auth.userId);
      return res.json({ data: { entryType, paymentRecorded: true, approvalRequired: false, approval: approved } });
    }
    return res.status(202).json({ data: {
      entryType,
      paymentRecorded: false,
      approvalRequired: true,
      approval,
      message: "Payment submitted for administrator approval.",
    } });
  }

  if (entryType === "invoice_payment") {
    const invoice = await prisma.caseInvoice.findFirst({
      where: { id: req.body?.invoiceId, agencyId: req.auth.agencyId, clientId: client.id },
      select: { id: true, caseId: true },
    });
    if (!invoice) throw createHttpError(404, "Invoice not found for this client.", "NOT_FOUND");
    const updated = await recordCaseInvoiceManualPayment(req.auth.agencyId, {
      ...commonPayment,
      caseId: invoice.caseId,
      invoiceId: invoice.id,
      amount: req.body?.amount,
      idempotencyKey: req.body?.idempotencyKey,
      actorRole: req.auth.role,
    });
    return res.json({ data: { entryType, paymentRecorded: true, invoice: updated } });
  }

  if (entryType === "appointment_payment") {
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: req.body?.appointmentId,
        agencyId: req.auth.agencyId,
        OR: clientAppointmentContactWhere(client),
      },
      select: {
        id: true,
        clientId: true,
        guestEmail: true,
        guestEmailNormalized: true,
        guestPhone: true,
        paymentHold: { select: { status: true } },
      },
    });
    if (!appointment) throw createHttpError(404, "Appointment not found for this client.", "NOT_FOUND");
    if (!appointment.clientId) {
      if (!appointmentContactMatchesClient(appointment, client)) {
        throw createHttpError(409, "This guest appointment does not match the client's email or phone.", "CONTACT_MISMATCH");
      }
      await prisma.$transaction([
        prisma.appointment.update({ where: { id: appointment.id }, data: { clientId: client.id } }),
        prisma.bookingPaymentHold.updateMany({ where: { appointmentId: appointment.id, clientId: null }, data: { clientId: client.id } }),
      ]);
      await recordActivity({
        agencyId: req.auth.agencyId,
        userId: req.auth.userId,
        clientId: client.id,
        action: "appointment.client_linked_for_billing",
        details: `Appointment linked to ${client.fullName} after its email or phone matched.`,
        entityType: "appointment",
        entityId: appointment.id,
      }).catch(() => {});
    }
    const hold = appointment.paymentHold?.status === "Paid"
      ? await updatePaidAppointmentPaymentDetails(req.auth.agencyId, { ...commonPayment, appointmentId: appointment.id })
      : await recordWalkInManualPayment(req.auth.agencyId, {
          ...commonPayment,
          appointmentId: appointment.id,
          overrideFreeConsultation: req.body?.overrideFreeConsultation === true,
          actorRole: req.auth.role,
        });
    return res.json({ data: { entryType, paymentRecorded: true, appointmentId: appointment.id, paymentHold: hold } });
  }

  if (entryType === "new_charge_payment") {
    const caseItem = await prisma.case.findFirst({
      where: { id: req.body?.caseId, agencyId: req.auth.agencyId, clientId: client.id, deletedAt: null },
      select: { id: true },
    });
    if (!caseItem) throw createHttpError(404, "Choose one of this client's active cases.", "NOT_FOUND");
    const operationKey = String(req.body?.idempotencyKey || "").trim().replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 200);
    if (!operationKey) throw createHttpError(400, "This billing form has expired. Close it and try again.", "VALIDATION_ERROR");
    const chargeAmount = Number(req.body?.chargeAmount);
    const receivedAmount = Number(req.body?.amount);
    if (!Number.isFinite(chargeAmount) || chargeAmount <= 0 || chargeAmount > 1_000_000) {
      throw createHttpError(400, "Enter a total charge between $0.01 and $1,000,000.", "VALIDATION_ERROR");
    }
    if (!Number.isFinite(receivedAmount) || receivedAmount <= 0 || receivedAmount > chargeAmount) {
      throw createHttpError(400, "The amount received must be greater than $0 and cannot exceed the charge.", "VALIDATION_ERROR");
    }
    const validatedPayment = validateManualPaymentInput({
      amount: receivedAmount,
      method: commonPayment.method,
      transactionReference: commonPayment.transactionReference,
      paymentDate: commonPayment.paymentDate,
    });
    const existingInvoice = await prisma.caseInvoice.findUnique({
      where: { agencyId_creationIdempotencyKey: { agencyId: req.auth.agencyId, creationIdempotencyKey: operationKey } },
    });
    if (existingInvoice?.lastPaymentIdempotencyKey === operationKey) {
      return res.json({ data: { entryType, paymentRecorded: true, invoice: existingInvoice, reused: true } });
    }
    await assertManualPaymentReferenceAvailable(req.auth.agencyId, validatedPayment.paymentReference);
    const invoice = await createCaseInvoice(req.auth.agencyId, {
      caseId: caseItem.id,
      paymentType: req.body?.paymentType,
      description: req.body?.description,
      amount: chargeAmount,
      dueDate: req.body?.paymentDate || undefined,
      actorUserId: req.auth.userId,
      idempotencyKey: operationKey,
      notifyClient: false,
    });
    try {
      const updated = await recordCaseInvoiceManualPayment(req.auth.agencyId, {
        ...commonPayment,
        caseId: caseItem.id,
        invoiceId: invoice.id,
        amount: receivedAmount,
        idempotencyKey: operationKey,
        actorRole: req.auth.role,
      });
      if (!existingInvoice && Number(updated.balance) > 0) {
        await notifyInvoiceCreated({
          agencyId: req.auth.agencyId,
          invoice: { ...updated, amount: updated.balance },
          actorUserId: req.auth.userId,
        }).catch(() => {});
      }
      return res.status(201).json({ data: { entryType, paymentRecorded: true, invoice: updated } });
    } catch (error) {
      return res.status(201).json({
        data: {
          entryType,
          paymentRecorded: false,
          invoice,
          paymentWarning: `The charge was created, but the payment still needs to be recorded: ${error.message}`,
        },
      });
    }
  }

  throw createHttpError(400, "Choose an existing charge, appointment, or new case charge.", "VALIDATION_ERROR");
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
