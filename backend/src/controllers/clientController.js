import { createCrudController, fieldParsers, recordActivity } from "../utils/prismaCrud.js";
import { createHttpError } from "../utils/http.js";
import prisma from "../services/prisma/client.js";
import { caseAccessWhere, clientAccessWhere } from "../middleware/authorization.js";
import { assertNoContactDuplicate, lockAgencyContactIntake, normalizeContact } from "../services/contactDuplicateService.js";
import { nextClientNumber } from "../services/clientNumberService.js";

const include = {
  assignedUser: {
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
    },
  },
  cases: {
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      caseType: true,
      stage: true,
      status: true,
      nextAction: true,
      priority: true,
      updatedAt: true,
      clientDocuments: { select: { status: true } },
      followUps: { select: { status: true, dueDate: true } },
      payments: { select: { totalFee: true, paidAmount: true, balance: true, status: true } },
    },
  },
};

function scopedInclude(req) {
  return {
    ...include,
    cases: {
      ...include.cases,
      where: caseAccessWhere(req),
    },
  };
}

const clientIdentitySelect = {
  id: true,
  clientNumber: true,
  fullName: true,
  phone: true,
  email: true,
  dateOfBirth: true,
  address: true,
  preferredLanguage: true,
  identificationType: true,
  identificationNumber: true,
  identificationCountry: true,
  identificationExpiryDate: true,
  status: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
};

const fields = {
  fullName: fieldParsers.stringField,
  phone: fieldParsers.stringField,
  email: fieldParsers.stringField,
  dateOfBirth: fieldParsers.dateField,
  address: fieldParsers.stringField,
  status: fieldParsers.enumField(["Lead", "Active", "Inactive", "Closed"]),
  assignedUserId: fieldParsers.relationField,
};

const CLIENT_STATUSES = ["Lead", "Active", "Inactive", "Closed"];

const controller = createCrudController({
  model: "client",
  label: "Client",
  createFields: fields,
  updateFields: fields,
  include,
  buildAccessWhere: clientAccessWhere,
  buildListWhere: (req) => ({
    ...(req.query.status ? { status: req.query.status } : {}),
    ...(req.query.assignedUserId ? { assignedUserId: req.query.assignedUserId } : {}),
  }),
  activityEntity: "client",
});

function sortCasesForPrimary(cases) {
  return [...cases].sort((left, right) => {
    const leftIsOpen = left.status !== "Closed" && left.stage !== "Closed";
    const rightIsOpen = right.status !== "Closed" && right.stage !== "Closed";

    if (leftIsOpen !== rightIsOpen) {
      return leftIsOpen ? -1 : 1;
    }

    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

function buildPaymentSummary(payments) {
  const totals = payments.reduce(
    (summary, payment) => ({
      totalFee: summary.totalFee + Number(payment.totalFee || 0),
      paidAmount: summary.paidAmount + Number(payment.paidAmount || 0),
      balance: summary.balance + Number(payment.balance || 0),
    }),
    { totalFee: 0, paidAmount: 0, balance: 0 }
  );

  let status = "Unpaid";

  if (payments.some((payment) => payment.status === "Refunded")) {
    status = "Refunded";
  } else if (totals.balance <= 0 && totals.totalFee > 0) {
    status = "Paid";
  } else if (totals.paidAmount > 0) {
    status = "Partial";
  }

  return {
    ...totals,
    status,
    lastPaymentDate: payments[0]?.updatedAt || payments[0]?.createdAt || null,
    notes: payments[0]?.notes || null,
  };
}

function buildNextAction({ primaryCase, documents, followUps, paymentSummary, client }) {
  const openFollowUps = [...followUps]
    .filter((followUp) => followUp.status !== "Completed")
    .sort((left, right) => {
      if (!left.dueDate && !right.dueDate) {
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      }

      if (!left.dueDate) {
        return 1;
      }

      if (!right.dueDate) {
        return -1;
      }

      return new Date(left.dueDate).getTime() - new Date(right.dueDate).getTime();
    });

  const dueFollowUp = openFollowUps[0] || null;
  const blockingDocument =
    documents.find((document) => document.status === "Requested") ||
    documents.find((document) => document.status === "ChangesRequested");

  let reason = null;

  if (blockingDocument) {
    reason = `${blockingDocument.documentName} is ${blockingDocument.status.toLowerCase()}`;
  } else if (paymentSummary.balance > 0) {
    reason = "Outstanding payment balance";
  } else if (dueFollowUp?.title) {
    reason = dueFollowUp.title;
  }

  return {
    label: primaryCase?.nextAction || dueFollowUp?.title || null,
    reason,
    dueDate: dueFollowUp?.dueDate || null,
    assignedUser:
      dueFollowUp?.assignedUser ||
      primaryCase?.assignedUser ||
      client.assignedUser ||
      null,
    stage: primaryCase?.stage || null,
  };
}

export async function getClientById(req, res) {
  const agencyId = req.user.agencyId;
  const clientId = req.params.id;

  const client = await prisma.client.findFirst({
    where: {
      id: clientId,
      agencyId,
      ...clientAccessWhere(req),
    },
    select: {
      ...clientIdentitySelect,
      assignedUser: {
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
        },
      },
    },
  });

  if (!client) {
    throw createHttpError(404, "Client not found");
  }

  const hasWholeClientAccess = req.auth.role === "admin";
  const accessibleCases = await prisma.case.findMany({
    where: { agencyId, clientId, ...caseAccessWhere(req) },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      caseType: true,
      stage: true,
      status: true,
      priority: true,
      nextAction: true,
      submittedAt: true,
      decisionAt: true,
      createdAt: true,
      updatedAt: true,
      assignedUser: { select: { id: true, fullName: true, email: true, role: true } },
    },
  });
  const accessibleCaseIds = accessibleCases.map((caseItem) => caseItem.id);
  const relatedWhere = hasWholeClientAccess
    ? { agencyId, clientId }
    : { agencyId, clientId, caseId: { in: accessibleCaseIds } };

  const [documents, followUps, payments, notes, activityLogs] = await Promise.all([
    prisma.clientDocument.findMany({
      where: relatedWhere,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        caseId: true,
        documentName: true,
        status: true,
        notes: true,
        receivedAt: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.followUp.findMany({
      where: relatedWhere,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        caseId: true,
        title: true,
        description: true,
        dueDate: true,
        status: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
        assignedUser: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    }),
    prisma.payment.findMany({
      where: relatedWhere,
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        caseId: true,
        totalFee: true,
        paidAmount: true,
        balance: true,
        status: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.note.findMany({
      where: relatedWhere,
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        caseId: true,
        content: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    }),
    prisma.activityLog.findMany({
      where: relatedWhere,
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        caseId: true,
        action: true,
        details: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    }),
  ]);

  const sortedCases = sortCasesForPrimary(accessibleCases);
  const primaryCase = sortedCases[0] || null;
  const paymentSummary = buildPaymentSummary(payments);
  const nextAction = buildNextAction({
    primaryCase,
    documents,
    followUps,
    paymentSummary,
    client,
  });

  res.json({
    data: {
      client,
      cases: sortedCases,
      primaryCase,
      documents,
      followUps,
      payments,
      paymentSummary,
      notes,
      activityLogs,
      nextAction,
    },
  });
}

export async function listClients(req, res) {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const search = String(req.query.search || "").trim().slice(0, 200);
  const searchDigits = search.replace(/\D/g, "");
  const searchFields = search ? ["fullName", "email", "emailNormalized", "phone", "clientNumber"].map((field) => ({
    [field]: { contains: search, mode: "insensitive" },
  })) : [];
  if (searchDigits.length >= 7) searchFields.push({ phoneNormalized: { contains: searchDigits } });
  const where = {
    agencyId: req.auth.agencyId,
    ...clientAccessWhere(req),
    ...(req.query.status ? { status: req.query.status } : {}),
    ...(req.query.assignedUserId ? { assignedUserId: req.query.assignedUserId } : {}),
    ...(req.query.includeArchived === "true" ? {} : { archivedAt: null }),
    ...(searchFields.length ? { OR: searchFields } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.client.findMany({ where, include: scopedInclude(req), orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.client.count({ where }),
  ]);
  res.json({ data, meta: { page, limit, total } });
}

function clientPayload(body, existing = null) {
  const fullName = String(body.fullName ?? existing?.fullName ?? "").trim();
  if (!fullName || fullName.length > 200) throw createHttpError(400, "Full name is required and must be 200 characters or fewer.", "VALIDATION_ERROR");
  const contact = normalizeContact({
    phone: Object.hasOwn(body, "phone") ? body.phone : existing?.phone,
    email: Object.hasOwn(body, "email") ? body.email : existing?.email,
  });
  const status = body.status ?? existing?.status ?? "Lead";
  if (!CLIENT_STATUSES.includes(status)) throw createHttpError(400, "Client status is invalid.", "VALIDATION_ERROR");
  const rawDate = Object.hasOwn(body, "dateOfBirth") ? body.dateOfBirth : existing?.dateOfBirth;
  const dateOfBirth = rawDate ? new Date(rawDate) : null;
  if (dateOfBirth && Number.isNaN(dateOfBirth.getTime())) throw createHttpError(400, "Date of birth is invalid.", "VALIDATION_ERROR");
  const address = Object.hasOwn(body, "address") ? String(body.address || "").trim() || null : existing?.address || null;
  const text = (field, max) => {
    const value = Object.hasOwn(body, field) ? String(body[field] || "").trim() || null : existing?.[field] || null;
    if (value && value.length > max) throw createHttpError(400, `${field} must be ${max} characters or fewer.`, "VALIDATION_ERROR");
    return value;
  };
  const rawExpiry = Object.hasOwn(body, "identificationExpiryDate") ? body.identificationExpiryDate : existing?.identificationExpiryDate;
  const identificationExpiryDate = rawExpiry ? new Date(rawExpiry) : null;
  if (identificationExpiryDate && Number.isNaN(identificationExpiryDate.getTime())) throw createHttpError(400, "Identification expiry date is invalid.", "VALIDATION_ERROR");
  return {
    fullName, ...contact, dateOfBirth, address, status,
    preferredLanguage: text("preferredLanguage", 100),
    identificationType: text("identificationType", 100),
    identificationNumber: text("identificationNumber", 150),
    identificationCountry: text("identificationCountry", 100),
    identificationExpiryDate,
  };
}

export async function createClient(req, res) {
  req.body = { ...(req.body || {}) };
  if (req.auth.role === "consultant") req.body.assignedUserId = req.auth.userId;
  await validateAssignedUser(req);
  const payload = clientPayload(req.body);
  payload.assignedUserId = req.body.assignedUserId || null;
  try {
    const data = await prisma.$transaction(async (tx) => {
      await lockAgencyContactIntake(tx, req.auth.agencyId);
      await assertNoContactDuplicate(tx, { agencyId: req.auth.agencyId, ...payload });
      const clientNumber = await nextClientNumber(tx, req.auth.agencyId);
      return tx.client.create({ data: { ...payload, clientNumber, agencyId: req.auth.agencyId }, include: scopedInclude(req) });
    });
    await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: data.id, action: "client.created", details: `${data.fullName} created` });
    res.status(201).json({ data });
  } catch (error) {
    if (error?.code === "P2002") throw createHttpError(409, "A client with this phone number or email address already exists.", "DUPLICATE_CLIENT");
    throw error;
  }
}
export async function updateClient(req, res) {
  req.body = { ...(req.body || {}) };
  if (req.auth.role === "consultant" && Object.hasOwn(req.body, "assignedUserId")) req.body.assignedUserId = req.auth.userId;
  await validateAssignedUser(req);
  const existing = await prisma.client.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, ...clientAccessWhere(req) },
  });
  if (!existing) throw createHttpError(404, "Client not found.", "NOT_FOUND");
  const payload = clientPayload(req.body, existing);
  payload.assignedUserId = Object.hasOwn(req.body, "assignedUserId") ? req.body.assignedUserId || null : existing.assignedUserId;
  try {
    const data = await prisma.$transaction(async (tx) => {
      await lockAgencyContactIntake(tx, req.auth.agencyId);
      await assertNoContactDuplicate(tx, { agencyId: req.auth.agencyId, ...payload, excludeClientId: existing.id });
      return tx.client.update({ where: { id: existing.id }, data: payload, include: scopedInclude(req) });
    });
    await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: data.id, action: "client.updated", details: `${data.fullName} updated` });
    res.json({ data });
  } catch (error) {
    if (error?.code === "P2002") throw createHttpError(409, "A client with this phone number or email address already exists.", "DUPLICATE_CLIENT");
    throw error;
  }
}

export async function closeClient(req, res) {
  const existing = await prisma.client.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, ...clientAccessWhere(req) },
    select: { id: true, fullName: true },
  });
  if (!existing) throw createHttpError(404, "Client not found.", "NOT_FOUND");
  const openCases = await prisma.case.count({ where: { agencyId: req.auth.agencyId, clientId: existing.id, status: { notIn: ["Closed", "Cancelled", "Completed", "Inactive"] } } });
  if (openCases) throw createHttpError(409, "Close or complete the client’s active cases before closing the client.", "CLIENT_HAS_OPEN_CASES");
  const data = await prisma.client.update({ where: { id: existing.id }, data: { status: "Closed" }, include: scopedInclude(req) });
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: data.id, action: "client.closed", details: `${data.fullName} closed` });
  res.json({ data });
}

async function getArchiveImpact(agencyId, clientId) {
  const where = { agencyId, clientId };
  const [cases, documents, payments, notes, followUps, activity] = await Promise.all([
    prisma.case.count({ where }),
    prisma.clientDocument.count({ where }),
    prisma.payment.count({ where }),
    prisma.note.count({ where }),
    prisma.followUp.count({ where }),
    prisma.activityLog.count({ where }),
  ]);
  return { cases, documents, payments, notes, followUps, activity, totalHistory: cases + documents + payments + notes + followUps + activity };
}

export async function getClientArchiveImpact(req, res) {
  const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId, ...clientAccessWhere(req) }, select: { id: true, fullName: true, clientNumber: true, archivedAt: true } });
  if (!client) throw createHttpError(404, "Client not found.", "NOT_FOUND");
  res.json({ data: { client, impact: await getArchiveImpact(req.auth.agencyId, client.id) } });
}

export async function archiveClient(req, res) {
  const existing = await prisma.client.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId, ...clientAccessWhere(req) }, select: { id: true, fullName: true, archivedAt: true } });
  if (!existing) throw createHttpError(404, "Client not found.", "NOT_FOUND");
  if (existing.archivedAt) throw createHttpError(409, "Client is already archived.", "CLIENT_ALREADY_ARCHIVED");
  const openCases = await prisma.case.count({ where: { agencyId: req.auth.agencyId, clientId: existing.id, status: { notIn: ["Closed", "Cancelled", "Completed", "Inactive"] } } });
  if (openCases) throw createHttpError(409, "Close or complete the client’s active cases before archiving the client.", "CLIENT_HAS_OPEN_CASES");
  const data = await prisma.client.update({ where: { id: existing.id }, data: { archivedAt: new Date(), status: "Inactive" }, include: scopedInclude(req) });
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: data.id, action: "client.archived", details: `${data.fullName} archived; history retained` });
  res.json({ data });
}

async function validateAssignedUser(req) {
  if (!req.body.assignedUserId) return;
  const user = await prisma.user.findFirst({ where: { id: req.body.assignedUserId, agencyId: req.auth.agencyId, status: "active", memberships: { some: { agencyId: req.auth.agencyId, role: { in: ["admin", "consultant"] }, isActive: true } } }, select: { id: true } });
  if (!user) throw createHttpError(400, "Assigned user was not found.", "VALIDATION_ERROR");
}

export default controller;
