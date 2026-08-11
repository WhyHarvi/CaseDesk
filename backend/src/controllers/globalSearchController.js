import {
  caseAccessWhere,
  clientAccessWhere,
  relatedRecordAccessWhere,
} from "../middleware/authorization.js";
import { leadAccessWhere } from "../modules/leads/lead.permissions.js";
import { logger } from "../services/logger.js";
import prisma from "../services/prisma/client.js";
import {
  hasPortalCapability,
  hasPortalCaseTabAccess,
  hasPortalPageAccess,
} from "../services/portalAccessService.js";
import { createHttpError } from "../utils/http.js";

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

const skippedSearch = () => ({
  items: [],
  attempted: false,
  failed: false,
  source: null,
});

async function guardedSearch(req, source, operation) {
  try {
    return {
      items: await operation(),
      attempted: true,
      failed: false,
      source,
    };
  } catch (error) {
    // A single model being unavailable must not take down every other search
    // group. Keep the diagnostic server-side without including the query or
    // Prisma's detailed validation message in the API response.
    logger.warn("global_search.source_failed", {
      requestId: req.requestId,
      agencyId: req.auth.agencyId,
      userId: req.auth.userId,
      source,
      code: clean(error?.code, 80) || undefined,
      errorType: clean(error?.name, 80) || undefined,
    });
    return {
      items: [],
      attempted: true,
      failed: true,
      source,
    };
  }
}

const searchWhenAllowed = (allowed, req, source, operation) =>
  allowed
    ? guardedSearch(req, source, operation)
    : Promise.resolve(skippedSearch());

async function searchLeads(req, query, digits) {
  // Deliberately not filtered to leadSegmentWhere("STANDARD") — a person
  // searching by name has no way to know a lead landed in the bulk-import
  // review queue instead of the normal pipeline, and "search can't find
  // someone who's actually in the system" is a worse experience than
  // surfacing them clearly labeled as Import Review.
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

  return leads.map((lead) => {
    const inReview = lead.pipelineSegment === "IMPORT_REVIEW";
    // The Leads list and Import Review list are two different routes, each
    // hardcoded to one segment — a link into the wrong one silently shows
    // no results, so which page a result opens depends on where the lead
    // actually lives, not just its lead number.
    const listPath = inReview ? "/leads/review" : "/leads";

    return {
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
      meta: join(inReview ? "Import Review" : null, lead.stage, lead.status),
      url: `${listPath}?search=${encodeURIComponent(lead.leadNumber)}`,
    };
  });
}

async function searchInternalRecords(req, query, digits, access) {
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

  const searchResults = await Promise.all([
    searchWhenAllowed(access.clients, req, "clients", () =>
      prisma.client.findMany({
        where: {
          agencyId,
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
    ),
    searchWhenAllowed(access.cases, req, "cases", () =>
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
    ),
    searchWhenAllowed(access.documents, req, "clientDocuments", () =>
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
    ),
    searchWhenAllowed(access.documents, req, "writtenDocuments", () =>
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
    ),
    searchWhenAllowed(access.notes, req, "notes", () =>
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
    ),
  ]);

  const [
    clientsResult,
    casesResult,
    clientDocumentsResult,
    writtenDocumentsResult,
    notesResult,
  ] = searchResults;
  const clients = clientsResult.items;
  const cases = casesResult.items;
  const clientDocuments = clientDocumentsResult.items;
  const writtenDocuments = writtenDocumentsResult.items;
  const notes = notesResult.items;

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
    attemptedSources: searchResults.filter((result) => result.attempted).length,
    failedSources: searchResults
      .filter((result) => result.failed)
      .map((result) => result.source),
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
  const canSearchLeads = hasPortalPageAccess(req, "leads");
  const canSearchClients = hasPortalPageAccess(req, "clients");
  const canSearchCases = hasPortalPageAccess(req, "cases");
  const canSearchDocuments =
    hasPortalPageAccess(req, "documents") ||
    hasPortalCaseTabAccess(req, "documents");
  const canSearchNotes =
    hasPortalCapability(req, "internalNotes") &&
    (canSearchClients || canSearchCases);
  const [leadSearch, internal] = await Promise.all([
    searchWhenAllowed(canSearchLeads, req, "leads", () =>
      searchLeads(req, query, digits),
    ),
    canSearchClients || canSearchCases || canSearchDocuments || canSearchNotes
      ? searchInternalRecords(req, query, digits, {
          clients: canSearchClients,
          cases: canSearchCases,
          documents: canSearchDocuments,
          notes: canSearchNotes,
        })
      : Promise.resolve({
          clients: [],
          cases: [],
          documents: [],
          notes: [],
          attemptedSources: 0,
          failedSources: [],
        }),
  ]);
  const leadResults = leadSearch.items;
  const attemptedSources =
    internal.attemptedSources + (leadSearch.attempted ? 1 : 0);
  const failedSources = [
    ...internal.failedSources,
    ...(leadSearch.failed ? [leadSearch.source] : []),
  ];
  if (attemptedSources > 0 && failedSources.length === attemptedSources) {
    throw createHttpError(
      503,
      "Search is temporarily unavailable. Please try again.",
      "SEARCH_UNAVAILABLE",
    );
  }
  const groups = [
    ...(canSearchClients
      ? [{ id: "clients", label: "Clients", items: internal.clients }]
      : []),
    ...(canSearchCases
      ? [{ id: "cases", label: "Cases", items: internal.cases }]
      : []),
    ...(canSearchDocuments
      ? [{ id: "documents", label: "Documents", items: internal.documents }]
      : []),
    ...(canSearchNotes
      ? [{ id: "notes", label: "Notes", items: internal.notes }]
      : []),
    ...(canSearchLeads
      ? [{ id: "leads", label: "Leads", items: leadResults }]
      : []),
  ].filter((group) => group.items.length);

  return res.json({
    data: {
      query,
      groups,
      total: groups.reduce((total, group) => total + group.items.length, 0),
      minimumCharacters: 2,
      partial: failedSources.length > 0,
      warning:
        failedSources.length > 0
          ? "Some permitted record types could not be searched. Other available results are shown."
          : null,
    },
  });
}
