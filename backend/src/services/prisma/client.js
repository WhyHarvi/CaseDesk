import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

const cachedPrisma = globalForPrisma.prisma;

function runtimeDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const configuredLimit = Number(url.searchParams.get("connection_limit"));
    const overrideLimit = Number(process.env.PRISMA_CONNECTION_LIMIT);
    const connectionLimit =
      Number.isFinite(overrideLimit) && overrideLimit > 0
        ? overrideLimit
        : Number.isFinite(configuredLimit) && configuredLimit > 1
          ? configuredLimit
          : 5;
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
  cachedPrisma.agencyOomaSettings &&
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
  hasRuntimeField(cachedPrisma, "Agency", "oomaSettings");

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
const hideDeleted = ({ args, query }) => {
  const where = args.where || {};
  if (!Object.hasOwn(where, "deletedAt") && !Object.hasOwn(where, "deleted_at")) {
    args = { ...args, where: { ...where, deletedAt: null } };
  }
  return query(args);
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
    },
  },
});

export default prisma;
