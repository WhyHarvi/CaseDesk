import { PrismaClient } from "@prisma/client";
import { clearDashboardCache } from "../dashboardCache.js";

const globalForPrisma = globalThis;

const cachedPrisma = globalForPrisma.prisma;

export function runtimeDatabaseUrl({
  raw = process.env.DATABASE_URL,
  override = process.env.PRISMA_CONNECTION_LIMIT,
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const configuredLimit = Number(url.searchParams.get("connection_limit"));
    const overrideLimit = Number(override);
    const connectionLimit =
      Number.isFinite(overrideLimit) && overrideLimit > 0
        ? overrideLimit
        : Number.isFinite(configuredLimit) && configuredLimit > 0
          ? configuredLimit
          : nodeEnv === "production" ? 5 : 1;
    url.searchParams.set("connection_limit", String(connectionLimit));
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", "20");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

const hasRuntimeField = (client, modelName, fieldName) =>
  Boolean(
    client?._runtimeDataModel?.models?.[modelName]?.fields?.some(
      (field) => field.name === fieldName,
    ),
  );

// Only reuse the development singleton when it matches the current schema.
// Checking only model delegates is insufficient: a cached client can know the
// model but still be missing relations added by a later migration/generate.
const shouldReusePrisma =
  cachedPrisma &&
  cachedPrisma.caseAssessment &&
  cachedPrisma.sharedLibraryDocument &&
  cachedPrisma.writtenDocument &&
  cachedPrisma.caseForm &&
  cachedPrisma.appointment &&
  cachedPrisma.communicationMessage &&
  cachedPrisma.communicationOutbox &&
  cachedPrisma.agencyMailSettings &&
  cachedPrisma.agencyMicrosoftMailboxConnection &&
  cachedPrisma.agencyOomaSettings &&
  cachedPrisma.notification &&
  cachedPrisma.notificationPreference &&
  cachedPrisma.notificationDelivery &&
  cachedPrisma.questionnaireAssignment &&
  hasRuntimeField(cachedPrisma, "SharedLibraryDocument", "clientDocuments") &&
  hasRuntimeField(
    cachedPrisma,
    "ClientDocument",
    "sourceSharedLibraryDocument",
  ) &&
  hasRuntimeField(cachedPrisma, "ClientDocument", "writtenDocument") &&
  hasRuntimeField(cachedPrisma, "Case", "caseForms") &&
  hasRuntimeField(cachedPrisma, "CaseForm", "versions") &&
  hasRuntimeField(cachedPrisma, "Case", "appointments") &&
  hasRuntimeField(cachedPrisma, "Appointment", "assignedTo") &&
  hasRuntimeField(cachedPrisma, "Case", "communicationMessages") &&
  hasRuntimeField(cachedPrisma, "CommunicationMessage", "conversation") &&
  hasRuntimeField(cachedPrisma, "CommunicationMessage", "deliveryEvents") &&
  hasRuntimeField(cachedPrisma, "Agency", "mailSettings") &&
  hasRuntimeField(cachedPrisma, "Agency", "oomaSettings") &&
  hasRuntimeField(cachedPrisma, "User", "receivedNotifications") &&
  hasRuntimeField(cachedPrisma, "FollowUp", "createdBy") &&
  hasRuntimeField(cachedPrisma, "FollowUp", "document") &&
  hasRuntimeField(cachedPrisma, "FollowUp", "caseInvoice");

if (cachedPrisma && !shouldReusePrisma) {
  void cachedPrisma.$disconnect().catch(() => {});
}

const basePrisma =
  (shouldReusePrisma ? cachedPrisma : null) ||
  new PrismaClient({
    datasourceUrl: runtimeDatabaseUrl(),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = basePrisma;
}

// Soft-deleted cases are hidden from every direct case read unless the caller
// mentions deletedAt itself (pass `deletedAt: undefined` to opt out entirely).
// Nested reads (e.g. client include { cases }) are NOT intercepted here and
// must filter deletedAt explicitly.
//
// The check has to walk into AND/OR/NOT, not just the top level: a caller
// can legitimately specify `deletedAt` nested inside `where.AND[0]` (e.g.
// caseController.js's trash-view query) rather than as a direct sibling key.
// A shallow check misses that, injects `deletedAt: null` anyway, and
// produces a self-contradictory query (`deletedAt IS NOT NULL` AND
// `deletedAt IS NULL`) that always returns zero rows — this is exactly what
// made the Trash view always appear empty regardless of how many cases were
// actually soft-deleted.
function whereSpecifiesDeletedAt(where) {
  if (!where || typeof where !== "object") return false;
  if (Object.hasOwn(where, "deletedAt") || Object.hasOwn(where, "deleted_at")) return true;
  for (const key of ["AND", "OR", "NOT"]) {
    const value = where[key];
    if (!value) continue;
    const clauses = Array.isArray(value) ? value : [value];
    if (clauses.some(whereSpecifiesDeletedAt)) return true;
  }
  return false;
}

const hideDeleted = ({ args, query }) => {
  const where = args.where || {};
  if (!whereSpecifiesDeletedAt(where)) {
    args = { ...args, where: { ...where, deletedAt: null } };
  }
  return query(args);
};

// dashboardController.js's Priority Work / stats queries read cases,
// client documents, workflow steps, follow-ups, and clients — and rely on
// every mutation of those models to invalidate the 5-minute dashboard
// cache. Relying on each controller to remember that call is exactly how
// this went stale before (caseController.js and clientDocumentController.js
// both mutated data feeding the dashboard without ever invalidating it).
// Hooking writes here instead means new mutation code paths stay correct
// automatically. This clears every agency's cached dashboard rather than
// just the affected one — reliably extracting the right agencyId from an
// arbitrary update/delete `where` isn't possible, and the cache is a
// 5-minute read optimization, not a correctness guarantee, so the extra
// cache misses this causes elsewhere are cheap.
const invalidateDashboardCacheOnWrite = async ({ args, query }) => {
  const result = await query(args);
  clearDashboardCache();
  return result;
};

const dashboardCacheWriteHooks = {
  create: invalidateDashboardCacheOnWrite,
  update: invalidateDashboardCacheOnWrite,
  updateMany: invalidateDashboardCacheOnWrite,
  upsert: invalidateDashboardCacheOnWrite,
  delete: invalidateDashboardCacheOnWrite,
  deleteMany: invalidateDashboardCacheOnWrite,
};

const prisma = basePrisma.$extends({
  query: {
    case: {
      findMany: hideDeleted,
      findFirst: hideDeleted,
      findFirstOrThrow: hideDeleted,
      count: hideDeleted,
      aggregate: hideDeleted,
      groupBy: hideDeleted,
      ...dashboardCacheWriteHooks,
    },
    clientDocument: dashboardCacheWriteHooks,
    caseWorkflowStep: dashboardCacheWriteHooks,
    followUp: dashboardCacheWriteHooks,
    client: dashboardCacheWriteHooks,
  },
});

export default prisma;
