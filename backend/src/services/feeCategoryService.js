import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { listQuickBooksItems } from "./quickbooksService.js";

export const DEFAULT_FEE_CATEGORIES = [
  { code: "fees", name: "Professional fees", description: "Legal and immigration professional services.", kind: "Professional", sortOrder: 10 },
  { code: "disbursement", name: "Government fee disbursements", description: "Government, IRCC and third-party disbursements.", kind: "Government", sortOrder: 20 },
  { code: "consultation", name: "Consultation fees", description: "Initial and follow-up consultation charges.", kind: "Consultation", sortOrder: 30 },
  { code: "other", name: "Other fees", description: "Other client charges configured by the agency.", kind: "Other", sortOrder: 40 },
];

function legacyMapping(settings, code) {
  if (code === "fees") return { qboItemId: settings?.feeItemId || null, qboItemName: settings?.feeItemName || null };
  if (code === "disbursement") return { qboItemId: settings?.disbursementItemId || null, qboItemName: settings?.disbursementItemName || null };
  if (code === "consultation") return { qboItemId: settings?.consultFeeItemId || null, qboItemName: settings?.consultFeeItemName || null };
  return { qboItemId: null, qboItemName: null };
}

export async function ensureFeeCategories(agencyId) {
  const [settings, existing] = await Promise.all([
    prisma.agencyQuickBooksSettings.findUnique({ where: { agencyId } }),
    prisma.agencyFeeCategory.findMany({ where: { agencyId, code: { in: DEFAULT_FEE_CATEGORIES.map((category) => category.code) } } }),
  ]);
  const byCode = new Map(existing.map((category) => [category.code, category]));
  const missing = DEFAULT_FEE_CATEGORIES.filter((category) => !byCode.has(category.code));
  if (missing.length) {
    await prisma.agencyFeeCategory.createMany({
      data: missing.map((category) => ({ agencyId, ...category, ...legacyMapping(settings, category.code), isSystem: true, isActive: true })),
      skipDuplicates: true,
    });
  }
  await Promise.all(DEFAULT_FEE_CATEGORIES.flatMap((category) => {
    const current = byCode.get(category.code);
    const mapping = legacyMapping(settings, category.code);
    if (!current || !mapping.qboItemId || (current.qboItemId === mapping.qboItemId && current.qboItemName === mapping.qboItemName)) return [];
    return [prisma.agencyFeeCategory.update({ where: { id: current.id }, data: mapping })];
  }));
}

export async function listFeeCategories(agencyId, { includeInactive = false } = {}) {
  await ensureFeeCategories(agencyId);
  return prisma.agencyFeeCategory.findMany({
    where: { agencyId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function requireFeeCategory(agencyId, code, { requireMapping = false } = {}) {
  await ensureFeeCategories(agencyId);
  const category = await prisma.agencyFeeCategory.findFirst({ where: { agencyId, code: String(code || ""), isActive: true } });
  if (!category) throw createHttpError(400, "Choose a valid active fee category.", "VALIDATION_ERROR");
  if (requireMapping && !category.qboItemId) {
    throw createHttpError(409, `Map a QuickBooks item for ${category.name} in Settings before invoicing.`, "QBO_MAPPING_REQUIRED");
  }
  return category;
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function validateQuickBooksItem(agencyId, itemId) {
  if (!itemId) return null;
  const items = await listQuickBooksItems(agencyId);
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) throw createHttpError(400, "That item was not found in your QuickBooks company.", "VALIDATION_ERROR");
  return item;
}

export async function createFeeCategory(agencyId, values) {
  const name = String(values?.name || "").trim().slice(0, 100);
  const code = normalizeCode(values?.code || name);
  const kind = String(values?.kind || "Other").trim().slice(0, 40) || "Other";
  if (!name || !code) throw createHttpError(400, "Enter a fee category name.", "VALIDATION_ERROR");
  const itemId = String(values?.qboItemId || "").trim() || null;
  const item = await validateQuickBooksItem(agencyId, itemId);
  try {
    return await prisma.agencyFeeCategory.create({
      data: {
        agencyId,
        code,
        name,
        kind,
        description: String(values?.description || "").trim().slice(0, 300) || null,
        qboItemId: item?.id || null,
        qboItemName: item?.name || null,
        isActive: true,
        sortOrder: Number.isInteger(values?.sortOrder) ? values.sortOrder : 100,
      },
    });
  } catch (error) {
    if (error?.code === "P2002") throw createHttpError(409, "A fee category with this name or code already exists.", "DUPLICATE");
    throw error;
  }
}

export async function updateFeeCategory(agencyId, id, values) {
  const current = await prisma.agencyFeeCategory.findFirst({ where: { id, agencyId } });
  if (!current) throw createHttpError(404, "Fee category not found.", "NOT_FOUND");
  const data = {};
  if (values?.name !== undefined) {
    data.name = String(values.name || "").trim().slice(0, 100);
    if (!data.name) throw createHttpError(400, "Enter a fee category name.", "VALIDATION_ERROR");
  }
  if (values?.description !== undefined) data.description = String(values.description || "").trim().slice(0, 300) || null;
  if (values?.kind !== undefined) data.kind = String(values.kind || "Other").trim().slice(0, 40) || "Other";
  if (typeof values?.isActive === "boolean") data.isActive = values.isActive;
  if (Number.isInteger(values?.sortOrder)) data.sortOrder = values.sortOrder;
  if (values?.qboItemId !== undefined) {
    const itemId = String(values.qboItemId || "").trim() || null;
    const item = await validateQuickBooksItem(agencyId, itemId);
    data.qboItemId = item?.id || null;
    data.qboItemName = item?.name || null;
  }
  return prisma.agencyFeeCategory.update({ where: { id }, data });
}

export async function deleteFeeCategory(agencyId, id) {
  const current = await prisma.agencyFeeCategory.findFirst({ where: { id, agencyId } });
  if (!current) throw createHttpError(404, "Fee category not found.", "NOT_FOUND");
  if (current.isSystem) throw createHttpError(409, "Built-in fee categories can be hidden but not deleted.", "SYSTEM_CATEGORY");
  const [invoiceCount, templateCount, installmentCount] = await Promise.all([
    prisma.caseInvoice.count({ where: { agencyId, paymentType: current.code } }),
    prisma.paymentScheduleTemplateInstallment.count({ where: { template: { agencyId }, paymentType: current.code } }),
    prisma.casePaymentInstallment.count({ where: { agencyId, paymentType: current.code } }),
  ]);
  if (invoiceCount + templateCount + installmentCount > 0) {
    throw createHttpError(409, "This category is already used in billing records. Hide it instead so history remains accurate.", "CATEGORY_IN_USE");
  }
  await prisma.agencyFeeCategory.delete({ where: { id } });
}

export async function syncBuiltInFeeCategoryMapping(agencyId, code, itemId, itemName) {
  await ensureFeeCategories(agencyId);
  return prisma.agencyFeeCategory.update({
    where: { agencyId_code: { agencyId, code } },
    data: { qboItemId: itemId || null, qboItemName: itemName || null },
  });
}
