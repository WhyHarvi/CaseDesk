import {
  createCrudController,
  fieldParsers,
  recordActivity,
} from "../utils/prismaCrud.js";
import { createHttpError } from "../utils/http.js";
import prisma from "../services/prisma/client.js";
import {
  caseAccessWhere,
  clientAccessWhere,
} from "../middleware/authorization.js";
import {
  assertNoContactDuplicate,
  lockAgencyContactIntake,
  normalizeContact,
  normalizeContactMatchInput,
} from "../services/contactDuplicateService.js";
import { nextClientNumber } from "../services/clientNumberService.js";
import { notifyUsers } from "../services/notificationService.js";
import { syncClientToQuickBooks } from "../services/clientQuickBooksSyncService.js";
import { TERMINAL_CASE_STATUSES } from "./caseController.js";
import {
  hasPortalCapability,
  hasPortalPageAccess,
  portalDataScope,
} from "../services/portalAccessService.js";
import {
  normalizeMaritalStatus,
  syncClientMaritalStatus,
} from "../services/clientProfileSyncService.js";
import { calculateCrsScore } from "./caseAssessmentController.js";

const include = {
  assignedUser: {
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
    },
  },
  // take: 1 is enough to answer "did this client come from a Case Easy
  // conversion" — the UI only needs a boolean, not the actual staging rows.
  caseEasyImportContacts: { select: { id: true }, take: 1 },
  cases: {
    where: { deletedAt: null },
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
      payments: {
        select: {
          totalFee: true,
          paidAmount: true,
          balance: true,
          status: true,
        },
      },
    },
  },
};

function scopedInclude(req) {
  return {
    ...include,
    cases: {
      ...include.cases,
      where: { ...caseAccessWhere(req), deletedAt: null },
    },
  };
}

const clientIdentitySelect = {
  id: true,
  clientNumber: true,
  fullName: true,
  familyName: true,
  givenNames: true,
  phone: true,
  email: true,
  dateOfBirth: true,
  maritalStatus: true,
  address: true,
  preferredLanguage: true,
  identificationType: true,
  identificationNumber: true,
  identificationCountry: true,
  identificationExpiryDate: true,
  status: true,
  archivedAt: true,
  qbCustomerId: true,
  qbSyncStatus: true,
  qbSyncError: true,
  qbSyncedAt: true,
  createdAt: true,
  updatedAt: true,
  caseEasyImportContacts: { select: { id: true }, take: 1 },
};

const fields = {
  fullName: fieldParsers.stringField,
  familyName: fieldParsers.stringField,
  givenNames: fieldParsers.stringField,
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
    ...(req.query.assignedUserId
      ? { assignedUserId: req.query.assignedUserId }
      : {}),
  }),
  activityEntity: "client",
});

function isOpenCase(item) {
  return !TERMINAL_CASE_STATUSES.has(item.status) && item.stage !== "Closed";
}

// Orders the full case list (open first, then most-recently-updated) for
// display — this does NOT filter anything out, so closed cases stay
// visible in the list. Picking the actually-active case is a separate
// step (see activeCase below) — conflating the two is what previously let
// a closed case get shown as "Active case" whenever it was the client's
// only case.
function sortCasesForPrimary(cases) {
  return [...cases].sort((left, right) => {
    const leftIsOpen = isOpenCase(left);
    const rightIsOpen = isOpenCase(right);

    if (leftIsOpen !== rightIsOpen) {
      return leftIsOpen ? -1 : 1;
    }

    return (
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
  });
}

function buildPaymentSummary(payments) {
  const totals = payments.reduce(
    (summary, payment) => ({
      totalFee: summary.totalFee + Number(payment.totalFee || 0),
      paidAmount: summary.paidAmount + Number(payment.paidAmount || 0),
      balance: summary.balance + Number(payment.balance || 0),
    }),
    { totalFee: 0, paidAmount: 0, balance: 0 },
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

function buildNextAction({
  activeCase,
  documents,
  followUps,
  paymentSummary,
  client,
}) {
  const openFollowUps = [...followUps]
    .filter((followUp) => !["Completed", "Cancelled"].includes(followUp.status))
    .sort((left, right) => {
      if (!left.dueDate && !right.dueDate) {
        return (
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime()
        );
      }

      if (!left.dueDate) {
        return 1;
      }

      if (!right.dueDate) {
        return -1;
      }

      return (
        new Date(left.dueDate).getTime() - new Date(right.dueDate).getTime()
      );
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
    label: activeCase?.nextAction || dueFollowUp?.title || null,
    reason,
    dueDate: dueFollowUp?.dueDate || null,
    assignedUser:
      dueFollowUp?.assignedUser ||
      activeCase?.assignedUser ||
      client.assignedUser ||
      null,
    stage: activeCase?.stage || null,
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

  const hasWholeClientAccess = portalDataScope(req, "clients") === "all";
  const canAccessInternalNotes = hasPortalCapability(req, "internalNotes");
  const canAccessFinancialData = hasPortalCapability(req, "financialData");
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
      assignedUser: {
        select: { id: true, fullName: true, email: true, role: true },
      },
    },
  });
  const accessibleCaseIds = accessibleCases.map((caseItem) => caseItem.id);
  // caseId: { in: accessibleCaseIds } never matches a NULL caseId in SQL —
  // that silently hid every profile-level (no-case) note/document/payment/
  // follow-up from non-admin viewers, not just ones tied to an
  // inaccessible case.
  const relatedWhere = hasWholeClientAccess
    ? { agencyId, clientId }
    : {
        agencyId,
        clientId,
        OR: [{ caseId: null }, { caseId: { in: accessibleCaseIds } }],
      };

  const [
    documents,
    followUps,
    payments,
    notes,
    activityLogs,
    caseInvoices,
    bookingPayments,
  ] = await Promise.all([
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
    canAccessFinancialData
      ? prisma.payment.findMany({
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
        })
      : Promise.resolve([]),
    canAccessInternalNotes
      ? prisma.note.findMany({
          where: { ...relatedWhere, deletedAt: null },
          orderBy: [{ createdAt: "desc" }],
          select: {
            id: true,
            caseId: true,
            appointmentId: true,
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
            appointment: {
              select: {
                id: true,
                subject: true,
                startsAt: true,
                status: true,
              },
            },
          },
        })
      : Promise.resolve([]),
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
    canAccessFinancialData
      ? prisma.caseInvoice.findMany({
          where: {
            agencyId,
            clientId,
            ...(hasWholeClientAccess
              ? {}
              : { caseId: { in: accessibleCaseIds } }),
          },
          orderBy: { updatedAt: "desc" },
          select: {
            amount: true,
            balance: true,
            status: true,
            updatedAt: true,
            createdAt: true,
            refunds: { where: { status: "Completed" }, select: { amount: true } },
          },
        })
      : Promise.resolve([]),
    canAccessFinancialData
      ? prisma.bookingPaymentHold.findMany({
          where: {
            agencyId,
            OR: [{ clientId }, { appointment: { clientId } }],
          },
          orderBy: { updatedAt: "desc" },
          select: {
            amount: true,
            status: true,
            paidAt: true,
            updatedAt: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const sortedCases = sortCasesForPrimary(accessibleCases);
  // The client's genuinely active case, or null — never a closed/cancelled
  // one. Previously this just took sortedCases[0], which is only sorted to
  // *prefer* open cases, not filtered to exclude closed ones, so a client
  // whose only case was closed still had it shown as "Active case".
  const activeCase = sortedCases.find(isOpenCase) || null;
  const modernPaymentRecords = [
    ...caseInvoices
      .filter((row) => !["Void", "Voided"].includes(row.status))
      .map((row) => {
        const refundedAmount = (row.refunds || []).reduce((sum, refund) => sum + Number(refund.amount), 0);
        return {
          totalFee: row.amount,
          paidAmount: Math.max(0, Number(row.amount) - Number(row.balance) - refundedAmount),
          balance: row.balance,
          status: row.status,
          updatedAt: row.updatedAt,
          createdAt: row.createdAt,
        };
      }),
    ...bookingPayments
      .filter(
        (row) =>
          !["Expired", "Cancelled", "Void", "Voided"].includes(row.status),
      )
      .map((row) => ({
        totalFee: row.amount,
        paidAmount: row.status === "Paid" ? row.amount : 0,
        balance: ["Paid", "Refunded"].includes(row.status) ? 0 : row.amount,
        status: row.status,
        updatedAt: row.paidAt || row.updatedAt,
        createdAt: row.createdAt,
      })),
  ];
  const paymentSummary = buildPaymentSummary([
    ...modernPaymentRecords,
    ...payments,
  ]);
  const nextAction = buildNextAction({
    activeCase,
    documents,
    followUps,
    paymentSummary,
    client,
  });

  res.json({
    data: {
      client,
      cases: sortedCases,
      activeCase,
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

export async function listClientAppointments(req, res) {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const scope = ["upcoming", "history", "all"].includes(String(req.query.scope))
    ? String(req.query.scope)
    : "all";
  const status = String(req.query.status || "");
  if (
    status &&
    !["Scheduled", "Completed", "Cancelled", "NoShow"].includes(status)
  ) {
    throw createHttpError(
      400,
      "Choose a valid appointment status.",
      "VALIDATION_ERROR",
    );
  }
  const search = String(req.query.search || "")
    .trim()
    .slice(0, 180);
  const now = new Date();
  const conditions = [];
  if (scope === "history")
    conditions.push({
      OR: [{ status: { not: "Scheduled" } }, { endsAt: { lt: now } }],
    });
  if (search)
    conditions.push({
      OR: [
        { subject: { contains: search, mode: "insensitive" } },
        { purpose: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { assignedTo: { fullName: { contains: search, mode: "insensitive" } } },
        { case: { caseType: { contains: search, mode: "insensitive" } } },
      ],
    });
  const where = {
    agencyId: req.auth.agencyId,
    clientId: req.params.id,
    ...(scope === "upcoming"
      ? { status: "Scheduled", endsAt: { gte: now } }
      : {}),
    ...(status ? { status } : {}),
    ...(conditions.length ? { AND: conditions } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      select: {
        id: true,
        subject: true,
        purpose: true,
        description: true,
        startsAt: true,
        endsAt: true,
        status: true,
        meetingMode: true,
        location: true,
        source: true,
        referenceCode: true,
        assignedTo: { select: { id: true, fullName: true } },
        case: { select: { id: true, caseType: true, stage: true } },
        sessionType: { select: { id: true, name: true } },
        _count: {
          select: {
            notes: { where: { deletedAt: null } },
            followUps: true,
          },
        },
      },
      orderBy:
        scope === "upcoming" ? { startsAt: "asc" } : { startsAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.appointment.count({ where }),
  ]);
  res.json({
    data,
    meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  });
}

export async function listClients(req, res) {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const search = String(req.query.search || "")
    .trim()
    .slice(0, 200);
  const searchDigits = search.replace(/\D/g, "");
  const searchFields = search
    ? ["fullName", "email", "emailNormalized", "phone", "clientNumber"].map(
        (field) => ({
          [field]: { contains: search, mode: "insensitive" },
        }),
      )
    : [];
  if (searchDigits.length >= 7)
    searchFields.push({ phoneNormalized: { contains: searchDigits } });
  const where = {
    agencyId: req.auth.agencyId,
    ...clientAccessWhere(req),
    ...(req.query.status ? { status: req.query.status } : {}),
    ...(req.query.assignedUserId
      ? { assignedUserId: req.query.assignedUserId }
      : {}),
    ...(req.query.includeArchived === "true" ? {} : { archivedAt: null }),
    ...(searchFields.length ? { OR: searchFields } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.client.findMany({
      where,
      include: scopedInclude(req),
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.client.count({ where }),
  ]);
  const clientIds = data.map((client) => client.id);
  const [caseInvoices, bookingPayments, legacyPayments] = clientIds.length
    ? await Promise.all([
        prisma.caseInvoice.findMany({
          where: { agencyId: req.auth.agencyId, clientId: { in: clientIds } },
          select: { clientId: true, amount: true, balance: true, status: true, refunds: { where: { status: "Completed" }, select: { amount: true } } },
        }),
        prisma.bookingPaymentHold.findMany({
          where: { agencyId: req.auth.agencyId, clientId: { in: clientIds } },
          select: { clientId: true, amount: true, status: true },
        }),
        prisma.payment.findMany({
          where: { agencyId: req.auth.agencyId, clientId: { in: clientIds } },
          select: {
            clientId: true,
            totalFee: true,
            paidAmount: true,
            balance: true,
            status: true,
          },
        }),
      ])
    : [[], [], []];
  const summaries = new Map(
    clientIds.map((id) => [
      id,
      { totalCharges: 0, totalCollected: 0, totalRefunds: 0, balance: 0 },
    ]),
  );
  for (const row of caseInvoices) {
    if (["Void", "Voided"].includes(row.status)) continue;
    const summary = summaries.get(row.clientId);
    const refunded = (row.refunds || []).reduce((sum, refund) => sum + Number(refund.amount), 0);
    summary.totalCharges += Number(row.amount);
    summary.totalCollected += Math.max(
      0,
      Number(row.amount) - Number(row.balance),
    );
    summary.totalRefunds += refunded;
    summary.balance += Number(row.balance);
  }
  for (const row of bookingPayments) {
    if (
      !row.clientId ||
      ["Expired", "Cancelled", "Voided", "Void"].includes(row.status)
    )
      continue;
    const summary = summaries.get(row.clientId);
    summary.totalCharges += Number(row.amount);
    if (["Paid", "Refunded"].includes(row.status))
      summary.totalCollected += Number(row.amount);
    if (row.status === "Refunded") summary.totalRefunds += Number(row.amount);
    if (!["Paid", "Refunded"].includes(row.status))
      summary.balance += Number(row.amount);
  }
  for (const row of legacyPayments) {
    const summary = summaries.get(row.clientId);
    summary.totalCharges += Number(row.totalFee);
    summary.totalCollected += Number(row.paidAmount);
    summary.balance += Number(row.balance);
  }
  const enriched = data.map((client) => {
    const summary = summaries.get(client.id);
    return {
      ...client,
      billingSummary: {
        ...summary,
        netCollected: Math.max(
          0,
          summary.totalCollected - summary.totalRefunds,
        ),
      },
    };
  });
  res.json({ data: enriched, meta: { page, limit, total } });
}

// Case Easy import data was never checked here — of this agency's 3,793+
// imported contacts, only a couple have actually been converted into real
// Client records, so a person could already be sitting in that staged data
// and still sail through this duplicate check with nothing found, because
// it only ever looked at the Client table. No normalized phone/email column
// exists on the import table (unlike Client), so phone matching is a
// contains() on the digit-only last 7 digits — the same approximation
// caseEasySearchService.js already uses for this same data, confirmed
// against real records to be digit-contiguous in the vast majority of
// cases. Scoped to hasPortalPageAccess("caseEasyImport") since the
// import/book actions this powers require that same access anyway.
async function findCaseEasyContactMatches(req, email, phoneDigits) {
  if (!hasPortalPageAccess(req, "caseEasyImport")) return [];
  const conditions = [
    ...(email ? [{ email: { equals: email, mode: "insensitive" } }] : []),
    ...(phoneDigits.length >= 7 ? [{ phone: { contains: phoneDigits.slice(-7) } }] : []),
  ];
  if (!conditions.length) return [];

  const contacts = await prisma.caseEasyImportContact.findMany({
    where: {
      agencyId: req.auth.agencyId,
      importStatus: { not: "converted" },
      OR: conditions,
    },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, clientIdentifier: true, recordType: true },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
  return contacts.map((contact) => ({
    id: contact.id,
    fullName: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.clientIdentifier || "Imported contact",
    email: contact.email,
    phone: contact.phone,
    clientIdentifier: contact.clientIdentifier,
    recordType: contact.recordType,
  }));
}

export async function findClientContactMatches(req, res) {
  const rawEmail = String(req.query.email || "").slice(0, 320).trim().toLowerCase();
  const rawPhone = String(req.query.phone || "").slice(0, 40);
  const { phoneNormalized, emailNormalized } = normalizeContactMatchInput({
    phone: rawPhone,
    email: rawEmail,
  });
  const contact = [
    ...(phoneNormalized ? [{ phoneNormalized }] : []),
    ...(emailNormalized ? [{ emailNormalized }] : []),
  ];
  if (!contact.length) return res.json({ data: { clients: [], caseEasyContacts: [] } });

  const [clients, caseEasyContacts] = await Promise.all([
    prisma.client.findMany({
      where: {
        agencyId: req.auth.agencyId,
        AND: [clientAccessWhere(req), { OR: contact }],
      },
      select: {
        id: true,
        clientNumber: true,
        fullName: true,
        email: true,
        emailNormalized: true,
        phone: true,
        phoneNormalized: true,
        status: true,
        archivedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    findCaseEasyContactMatches(req, rawEmail, rawPhone.replace(/\D/g, "")),
  ]);
  res.json({
    data: {
      clients: clients.map((client) => ({
        ...client,
        matchedBy: [
          client.emailNormalized === emailNormalized ? "email" : null,
          client.phoneNormalized === phoneNormalized ? "phone" : null,
        ].filter(Boolean),
        canBookAppointment: !client.archivedAt,
      })),
      caseEasyContacts,
    },
  });
}

export function clientPayload(body, existing = null) {
  const structuredNameProvided =
    Object.hasOwn(body, "givenNames") || Object.hasOwn(body, "familyName");
  const legacyFullNameProvided =
    !structuredNameProvided && Object.hasOwn(body, "fullName");
  const namePart = (field, label) => {
    const value = Object.hasOwn(body, field)
      ? String(body[field] || "").trim().replace(/\s+/g, " ") || null
      : legacyFullNameProvided
        ? null
        : existing?.[field] || null;
    if (value && value.length > 200)
      throw createHttpError(
        400,
        `${label} must be 200 characters or fewer.`,
        "VALIDATION_ERROR",
      );
    return value;
  };
  const givenNames = namePart("givenNames", "Given name(s)");
  const familyName = namePart("familyName", "Family name");
  if (structuredNameProvided && !givenNames && !familyName)
    throw createHttpError(
      400,
      "Enter at least a given name or family name.",
      "VALIDATION_ERROR",
    );
  const fullName = structuredNameProvided
    ? [givenNames, familyName].filter(Boolean).join(" ")
    : String(body.fullName ?? existing?.fullName ?? "").trim().replace(/\s+/g, " ");
  if (!fullName || fullName.length > 200)
    throw createHttpError(
      400,
      "Full name is required and must be 200 characters or fewer.",
      "VALIDATION_ERROR",
    );
  const contact = normalizeContact({
    phone: Object.hasOwn(body, "phone") ? body.phone : existing?.phone,
    email: Object.hasOwn(body, "email") ? body.email : existing?.email,
  });
  const status = body.status ?? existing?.status ?? "Lead";
  if (!CLIENT_STATUSES.includes(status))
    throw createHttpError(400, "Client status is invalid.", "VALIDATION_ERROR");
  const hasDateOfBirth = Object.hasOwn(body, "dateOfBirth");
  const rawDate = hasDateOfBirth ? String(body.dateOfBirth || "").trim() : null;
  let dateOfBirth = hasDateOfBirth ? null : existing?.dateOfBirth || null;
  if (rawDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      throw createHttpError(400, "Date of birth must use YYYY-MM-DD format.", "VALIDATION_ERROR");
    }
    const [year, month, day] = rawDate.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
      throw createHttpError(400, "Date of birth must be a real calendar date.", "VALIDATION_ERROR");
    }
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (parsed.getTime() > today) throw createHttpError(400, "Date of birth cannot be in the future.", "VALIDATION_ERROR");
    if (year < 1900) throw createHttpError(400, "Date of birth must be from 1900 onward.", "VALIDATION_ERROR");
    dateOfBirth = parsed;
  }
  const address = Object.hasOwn(body, "address")
    ? String(body.address || "").trim() || null
    : existing?.address || null;
  const maritalStatus = Object.hasOwn(body, "maritalStatus")
    ? normalizeMaritalStatus(body.maritalStatus)
    : existing?.maritalStatus || null;
  if (
    Object.hasOwn(body, "maritalStatus") &&
    String(body.maritalStatus || "").trim() &&
    !maritalStatus
  ) {
    throw createHttpError(400, "Marital status is invalid.", "VALIDATION_ERROR");
  }
  const text = (field, max) => {
    const value = Object.hasOwn(body, field)
      ? String(body[field] || "").trim() || null
      : existing?.[field] || null;
    if (value && value.length > max)
      throw createHttpError(
        400,
        `${field} must be ${max} characters or fewer.`,
        "VALIDATION_ERROR",
      );
    return value;
  };
  const rawExpiry = Object.hasOwn(body, "identificationExpiryDate")
    ? body.identificationExpiryDate
    : existing?.identificationExpiryDate;
  const identificationExpiryDate = rawExpiry ? new Date(rawExpiry) : null;
  if (
    identificationExpiryDate &&
    Number.isNaN(identificationExpiryDate.getTime())
  )
    throw createHttpError(
      400,
      "Identification expiry date is invalid.",
      "VALIDATION_ERROR",
    );
  return {
    fullName,
    familyName,
    givenNames,
    ...contact,
    dateOfBirth,
    maritalStatus,
    address,
    status,
    preferredLanguage: text("preferredLanguage", 100),
    identificationType: text("identificationType", 100),
    identificationNumber: text("identificationNumber", 150),
    identificationCountry: text("identificationCountry", 100),
    identificationExpiryDate,
  };
}

export async function createClient(req, res) {
  req.body = { ...(req.body || {}) };
  const idempotencyKey = String(req.body.idempotencyKey || "").trim().replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 200) || null;
  if (idempotencyKey) {
    const existing = await prisma.client.findUnique({
      where: { agencyId_creationIdempotencyKey: { agencyId: req.auth.agencyId, creationIdempotencyKey: idempotencyKey } },
      include: scopedInclude(req),
    });
    if (existing) return res.json({ data: existing, reused: true });
  }
  // A standalone client profile has no work owner yet. Consultants may not
  // assign it to another staff member, while administrators can still make
  // an explicit Client Access assignment when one is actually required.
  if (req.auth.role === "consultant" && req.body.assignedUserId)
    req.body.assignedUserId = req.auth.userId;
  await validateAssignedUser(req);
  const payload = clientPayload(req.body);
  payload.assignedUserId = req.body.assignedUserId || null;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockAgencyContactIntake(tx, req.auth.agencyId);
      if (idempotencyKey) {
        const existing = await tx.client.findUnique({
          where: { agencyId_creationIdempotencyKey: { agencyId: req.auth.agencyId, creationIdempotencyKey: idempotencyKey } },
          include: scopedInclude(req),
        });
        if (existing) return { data: existing, reused: true };
      }
      await assertNoContactDuplicate(tx, {
        agencyId: req.auth.agencyId,
        ...payload,
      });
      const clientNumber = await nextClientNumber(tx, req.auth.agencyId);
      const data = await tx.client.create({
        data: { ...payload, clientNumber, agencyId: req.auth.agencyId, creationIdempotencyKey: idempotencyKey },
        include: scopedInclude(req),
      });
      return { data, reused: false };
    });
    const { data, reused } = result;
    if (!reused) await recordActivity({
      agencyId: req.auth.agencyId,
      userId: req.auth.userId,
      clientId: data.id,
      action: "client.created",
      details: `${data.fullName} created`,
    });
    if (!reused && data.assignedUserId)
      await notifyUsers({
        agencyId: req.auth.agencyId,
        recipientIds: [data.assignedUserId],
        actorUserId: req.auth.userId,
        type: "client.assigned",
        category: "cases",
        title: `Client assigned: ${data.fullName}`,
        entityType: "client",
        entityId: data.id,
        actionUrl: `/app/clients/${data.id}`,
        dedupeKey: `client:${data.id}:assigned:${data.assignedUserId}`,
      });
    const qbResult = reused ? null : await syncClientToQuickBooks(
      req.auth.agencyId,
      data.id,
    ).catch(() => null);
    if (qbResult)
      Object.assign(data, {
        qbCustomerId: qbResult.qbCustomerId,
        qbSyncStatus: qbResult.qbSyncStatus,
        qbSyncError: qbResult.qbSyncError,
        qbSyncedAt: qbResult.qbSyncedAt,
      });
    res.status(reused ? 200 : 201).json({ data, reused });
  } catch (error) {
    if (error?.code === "P2002")
      throw createHttpError(
        409,
        "A client with this phone number or email address already exists.",
        "DUPLICATE_CLIENT",
      );
    throw error;
  }
}
export async function updateClient(req, res) {
  req.body = { ...(req.body || {}) };
  if (
    req.auth.role === "consultant" &&
    Object.hasOwn(req.body, "assignedUserId")
  )
    req.body.assignedUserId = req.auth.userId;
  await validateAssignedUser(req);
  const existing = await prisma.client.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      ...clientAccessWhere(req),
    },
  });
  if (!existing) throw createHttpError(404, "Client not found.", "NOT_FOUND");
  const payload = clientPayload(req.body, existing);
  payload.assignedUserId = Object.hasOwn(req.body, "assignedUserId")
    ? req.body.assignedUserId || null
    : existing.assignedUserId;
  try {
    const data = await prisma.$transaction(async (tx) => {
      await lockAgencyContactIntake(tx, req.auth.agencyId);
      const contactChanged =
        payload.phoneNormalized !== existing.phoneNormalized ||
        payload.emailNormalized !== existing.emailNormalized;
      if (contactChanged)
        await assertNoContactDuplicate(tx, {
          agencyId: req.auth.agencyId,
          ...payload,
          excludeClientId: existing.id,
        });
      const updatedClient = await tx.client.update({
        where: { id: existing.id },
        data: payload,
        include: scopedInclude(req),
      });
      if (Object.hasOwn(req.body, "maritalStatus")) {
        await syncClientMaritalStatus(tx, {
          agencyId: req.auth.agencyId,
          clientId: existing.id,
          maritalStatus: payload.maritalStatus,
          updateClient: false,
          assessmentPatch: (nextFormData) => {
            const { score, breakdown } = calculateCrsScore(nextFormData);
            return { crsScore: score, crsBreakdown: breakdown };
          },
        });
      }
      return updatedClient;
    });
    await recordActivity({
      agencyId: req.auth.agencyId,
      userId: req.auth.userId,
      clientId: data.id,
      action: "client.updated",
      details: `${data.fullName} updated`,
    });
    if (data.assignedUserId && data.assignedUserId !== existing.assignedUserId)
      await notifyUsers({
        agencyId: req.auth.agencyId,
        recipientIds: [data.assignedUserId],
        actorUserId: req.auth.userId,
        type: "client.reassigned",
        category: "cases",
        title: `Client reassigned: ${data.fullName}`,
        entityType: "client",
        entityId: data.id,
        actionUrl: `/app/clients/${data.id}`,
        dedupeKey: `client:${data.id}:assigned:${data.assignedUserId}:${data.updatedAt.toISOString()}`,
      });
    const contactChanged = ["fullName", "email", "phone", "address"].some(
      (field) =>
        Object.hasOwn(payload, field) && payload[field] !== existing[field],
    );
    if (contactChanged) {
      const qbResult = await syncClientToQuickBooks(
        req.auth.agencyId,
        data.id,
      ).catch(() => null);
      if (qbResult)
        Object.assign(data, {
          qbCustomerId: qbResult.qbCustomerId,
          qbSyncStatus: qbResult.qbSyncStatus,
          qbSyncError: qbResult.qbSyncError,
          qbSyncedAt: qbResult.qbSyncedAt,
        });
    }
    res.json({ data });
  } catch (error) {
    if (error?.code === "P2002")
      throw createHttpError(
        409,
        "A client with this phone number or email address already exists.",
        "DUPLICATE_CLIENT",
      );
    throw error;
  }
}

export async function syncClientQuickBooks(req, res) {
  const existing = await prisma.client.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      ...clientAccessWhere(req),
    },
    select: { id: true },
  });
  if (!existing) throw createHttpError(404, "Client not found.", "NOT_FOUND");
  const result = await syncClientToQuickBooks(req.auth.agencyId, existing.id);
  if (!result)
    throw createHttpError(
      409,
      "QuickBooks is not connected for this workspace.",
      "QBO_NOT_CONNECTED",
    );
  if (result.qbSyncStatus === "error")
    throw createHttpError(
      502,
      result.qbSyncError || "QuickBooks sync failed.",
      "QBO_SYNC_FAILED",
    );
  res.json({
    data: {
      qbCustomerId: result.qbCustomerId,
      qbSyncStatus: result.qbSyncStatus,
      qbSyncError: result.qbSyncError,
      qbSyncedAt: result.qbSyncedAt,
    },
  });
}

export async function closeClient(req, res) {
  const existing = await prisma.client.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      ...clientAccessWhere(req),
    },
    select: { id: true, fullName: true },
  });
  if (!existing) throw createHttpError(404, "Client not found.", "NOT_FOUND");
  const openCases = await prisma.case.count({
    where: {
      agencyId: req.auth.agencyId,
      clientId: existing.id,
      status: { notIn: ["Closed", "Cancelled", "Completed", "Inactive"] },
    },
  });
  if (openCases)
    throw createHttpError(
      409,
      "Close or complete the client’s active cases before closing the client.",
      "CLIENT_HAS_OPEN_CASES",
    );
  const data = await prisma.client.update({
    where: { id: existing.id },
    data: { status: "Closed" },
    include: scopedInclude(req),
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: data.id,
    action: "client.closed",
    details: `${data.fullName} closed`,
  });
  res.json({ data });
}

async function getArchiveImpact(agencyId, clientId) {
  const where = { agencyId, clientId };
  const [cases, documents, payments, notes, followUps, activity] =
    await Promise.all([
      prisma.case.count({ where }),
      prisma.clientDocument.count({ where }),
      prisma.payment.count({ where }),
      prisma.note.count({ where }),
      prisma.followUp.count({ where }),
      prisma.activityLog.count({ where }),
    ]);
  return {
    cases,
    documents,
    payments,
    notes,
    followUps,
    activity,
    totalHistory: cases + documents + payments + notes + followUps + activity,
  };
}

export async function getClientArchiveImpact(req, res) {
  const client = await prisma.client.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      ...clientAccessWhere(req),
    },
    select: { id: true, fullName: true, clientNumber: true, archivedAt: true },
  });
  if (!client) throw createHttpError(404, "Client not found.", "NOT_FOUND");
  res.json({
    data: {
      client,
      impact: await getArchiveImpact(req.auth.agencyId, client.id),
    },
  });
}

export async function archiveClient(req, res) {
  const existing = await prisma.client.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      ...clientAccessWhere(req),
    },
    select: { id: true, fullName: true, archivedAt: true },
  });
  if (!existing) throw createHttpError(404, "Client not found.", "NOT_FOUND");
  if (existing.archivedAt)
    throw createHttpError(
      409,
      "Client is already archived.",
      "CLIENT_ALREADY_ARCHIVED",
    );
  const openCases = await prisma.case.count({
    where: {
      agencyId: req.auth.agencyId,
      clientId: existing.id,
      status: { notIn: ["Closed", "Cancelled", "Completed", "Inactive"] },
    },
  });
  if (openCases)
    throw createHttpError(
      409,
      "Close or complete the client’s active cases before archiving the client.",
      "CLIENT_HAS_OPEN_CASES",
    );
  const data = await prisma.client.update({
    where: { id: existing.id },
    data: { archivedAt: new Date(), status: "Inactive" },
    include: scopedInclude(req),
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: data.id,
    action: "client.archived",
    details: `${data.fullName} archived; history retained`,
  });
  res.json({ data });
}

async function validateAssignedUser(req) {
  if (!req.body.assignedUserId) return;
  const user = await prisma.user.findFirst({
    where: {
      id: req.body.assignedUserId,
      agencyId: req.auth.agencyId,
      status: "active",
      memberships: {
        some: {
          agencyId: req.auth.agencyId,
          role: { in: ["admin", "consultant", "frontdesk"] },
          isActive: true,
        },
      },
    },
    select: { id: true },
  });
  if (!user)
    throw createHttpError(
      400,
      "Assigned user was not found.",
      "VALIDATION_ERROR",
    );
}

export default controller;
