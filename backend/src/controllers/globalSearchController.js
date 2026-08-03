import {
  caseAccessWhere,
  clientAccessWhere,
  relatedRecordAccessWhere,
} from "../middleware/authorization.js";
import { leadAccessWhere } from "../modules/leads/lead.permissions.js";
import prisma from "../services/prisma/client.js";

const RESULT_LIMIT = 6;

const clean = (value, max = 120) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);

const excerpt = (value, max = 150) => {
  const normalized = clean(value, 2_000);
  return normalized.length > max
    ? `${normalized.slice(0, max - 1).trimEnd()}…`
    : normalized;
};

const join = (...values) => values.filter(Boolean).join(" · ");

async function searchLeads(req, query, digits) {
  const leads = await prisma.lead.findMany({
    where: {
      agencyId: req.auth.agencyId,
      deletedAt: null,
      AND: [
        leadAccessWhere(req),
        {
          OR: [
            { leadNumber: { contains: query, mode: "insensitive" } },
            { firstName: { contains: query, mode: "insensitive" } },
            { lastName: { contains: query, mode: "insensitive" } },
            { emailNormalized: { contains: query.toLowerCase() } },
            ...(digits.length >= 3
              ? [{ phoneNormalized: { contains: digits } }]
              : []),
          ],
        },
      ],
    },
    include: {
      originalSource: { select: { name: true } },
      owner: { select: { fullName: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: RESULT_LIMIT,
  });

  return leads.map((lead) => ({
    id: lead.id,
    type: "lead",
    title:
      [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
      lead.leadNumber,
    subtitle: join(
      lead.leadNumber,
      lead.originalSource?.name,
      lead.owner?.fullName,
    ),
    meta: join(lead.stage, lead.status),
    url: `/leads?search=${encodeURIComponent(lead.leadNumber)}`,
  }));
}

async function searchInternalRecords(req, query, digits) {
  const agencyId = req.auth.agencyId;
  const clientSearch = {
    OR: [
      { fullName: { contains: query, mode: "insensitive" } },
      { clientNumber: { contains: query, mode: "insensitive" } },
      { email: { contains: query, mode: "insensitive" } },
      { phone: { contains: query, mode: "insensitive" } },
      ...(digits.length >= 3
        ? [{ phoneNormalized: { contains: digits } }]
        : []),
    ],
  };
  const caseSearch = {
    OR: [
      { caseType: { contains: query, mode: "insensitive" } },
      { stage: { contains: query, mode: "insensitive" } },
      { status: { contains: query, mode: "insensitive" } },
      { nextAction: { contains: query, mode: "insensitive" } },
      { client: { fullName: { contains: query, mode: "insensitive" } } },
      { client: { clientNumber: { contains: query, mode: "insensitive" } } },
    ],
  };
  const documentSearch = {
    OR: [
      { documentName: { contains: query, mode: "insensitive" } },
      { originalFilename: { contains: query, mode: "insensitive" } },
      { notes: { contains: query, mode: "insensitive" } },
      { client: { fullName: { contains: query, mode: "insensitive" } } },
      { case: { caseType: { contains: query, mode: "insensitive" } } },
    ],
  };
  const writtenDocumentSearch = {
    OR: [
      { title: { contains: query, mode: "insensitive" } },
      { client: { fullName: { contains: query, mode: "insensitive" } } },
      { case: { caseType: { contains: query, mode: "insensitive" } } },
    ],
  };
  const noteSearch = {
    OR: [
      { content: { contains: query, mode: "insensitive" } },
      { client: { fullName: { contains: query, mode: "insensitive" } } },
      { case: { caseType: { contains: query, mode: "insensitive" } } },
      { user: { fullName: { contains: query, mode: "insensitive" } } },
    ],
  };

  const [clients, cases, clientDocuments, writtenDocuments, notes] =
    await Promise.all([
      prisma.client.findMany({
        where: {
          agencyId,
          deletedAt: null,
          AND: [clientAccessWhere(req), clientSearch],
        },
        select: {
          id: true,
          fullName: true,
          clientNumber: true,
          email: true,
          phone: true,
          status: true,
          archivedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: RESULT_LIMIT,
      }),
      prisma.case.findMany({
        where: {
          agencyId,
          deletedAt: null,
          AND: [caseAccessWhere(req), caseSearch],
        },
        select: {
          id: true,
          caseType: true,
          stage: true,
          status: true,
          priority: true,
          client: {
            select: { id: true, fullName: true, clientNumber: true },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: RESULT_LIMIT,
      }),
      prisma.clientDocument.findMany({
        where: {
          agencyId,
          AND: [
            relatedRecordAccessWhere(req),
            documentSearch,
            { OR: [{ caseId: null }, { case: { deletedAt: null } }] },
          ],
        },
        select: {
          id: true,
          documentName: true,
          originalFilename: true,
          status: true,
          visibility: true,
          caseId: true,
          clientId: true,
          updatedAt: true,
          client: { select: { fullName: true } },
          case: { select: { caseType: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: RESULT_LIMIT,
      }),
      prisma.writtenDocument.findMany({
        where: {
          agencyId,
          AND: [
            relatedRecordAccessWhere(req),
            writtenDocumentSearch,
            { case: { deletedAt: null } },
          ],
        },
        select: {
          id: true,
          title: true,
          status: true,
          caseId: true,
          updatedAt: true,
          client: { select: { fullName: true } },
          case: { select: { caseType: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: RESULT_LIMIT,
      }),
      prisma.note.findMany({
        where: {
          agencyId,
          deletedAt: null,
          AND: [
            relatedRecordAccessWhere(req),
            noteSearch,
            { OR: [{ clientId: { not: null } }, { caseId: { not: null } }] },
            { OR: [{ caseId: null }, { case: { deletedAt: null } }] },
          ],
        },
        select: {
          id: true,
          content: true,
          clientId: true,
          caseId: true,
          updatedAt: true,
          client: { select: { fullName: true } },
          case: { select: { caseType: true } },
          user: { select: { fullName: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: RESULT_LIMIT,
      }),
    ]);

  const documents = [
    ...clientDocuments.map((document) => ({
      id: document.id,
      type: "document",
      title: document.documentName || document.originalFilename || "Document",
      subtitle: join(document.client?.fullName, document.case?.caseType),
      meta: join(document.status, document.visibility),
      url: document.caseId
        ? `/app/cases/${document.caseId}?tab=documents`
        : `/app/clients/${document.clientId}`,
      updatedAt: document.updatedAt,
    })),
    ...writtenDocuments.map((document) => ({
      id: `written-${document.id}`,
      type: "document",
      title: document.title,
      subtitle: join(document.client?.fullName, document.case?.caseType),
      meta: join(document.status, "Written document"),
      url: `/app/cases/${document.caseId}?tab=agreements-letters`,
      updatedAt: document.updatedAt,
    })),
  ]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, RESULT_LIMIT)
    .map(({ updatedAt, ...document }) => document);

  return {
    clients: clients.map((client) => ({
      id: client.id,
      type: "client",
      title: client.fullName,
      subtitle: join(client.clientNumber, client.email || client.phone),
      meta: client.archivedAt ? "Archived" : client.status,
      url: `/app/clients/${client.id}`,
    })),
    cases: cases.map((caseItem) => ({
      id: caseItem.id,
      type: "case",
      title: caseItem.caseType,
      subtitle: join(caseItem.client.fullName, caseItem.client.clientNumber),
      meta: join(caseItem.stage, caseItem.status, caseItem.priority),
      url: `/app/cases/${caseItem.id}`,
    })),
    documents,
    notes: notes.map((note) => ({
      id: note.id,
      type: "note",
      title: note.case?.caseType
        ? `Note · ${note.case.caseType}`
        : `Note · ${note.client?.fullName || "Client profile"}`,
      subtitle: join(note.client?.fullName, note.user?.fullName),
      snippet: excerpt(note.content),
      meta: "Private note",
      url: note.caseId
        ? `/app/cases/${note.caseId}?overlay=notes&note=${note.id}`
        : `/app/clients/${note.clientId}?note=${note.id}`,
    })),
  };
}

export async function globalSearch(req, res) {
  const query = clean(req.query.q);
  if (query.length < 2) {
    return res.json({
      data: {
        query,
        groups: [],
        total: 0,
        minimumCharacters: 2,
      },
    });
  }

  const digits = query.replace(/\D/g, "");
  const leadResults = await searchLeads(req, query, digits);
  const internal =
    req.auth.role === "frontdesk"
      ? { clients: [], cases: [], documents: [], notes: [] }
      : await searchInternalRecords(req, query, digits);
  const groups = [
    ...(req.auth.role === "frontdesk"
      ? [{ id: "leads", label: "Leads", items: leadResults }]
      : [
          { id: "clients", label: "Clients", items: internal.clients },
          { id: "cases", label: "Cases", items: internal.cases },
          { id: "documents", label: "Documents", items: internal.documents },
          { id: "notes", label: "Notes", items: internal.notes },
          { id: "leads", label: "Leads", items: leadResults },
        ]),
  ].filter((group) => group.items.length);

  return res.json({
    data: {
      query,
      groups,
      total: groups.reduce((total, group) => total + group.items.length, 0),
      minimumCharacters: 2,
    },
  });
}
