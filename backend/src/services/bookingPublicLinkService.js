import { randomBytes } from "node:crypto";
import prisma from "./prisma/client.js";

export function bookingSlugBase(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42) || "book";
}

export async function generatePublicBookingSlug(agencyId, db = prisma, { forceSuffix = false } = {}) {
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
    select: { name: true, legalName: true },
  });
  const base = bookingSlugBase(agency?.legalName || agency?.name);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = !forceSuffix && attempt === 0 ? base : `${base}-${randomBytes(2).toString("hex")}`;
    const collision = await db.bookingSettings.findFirst({
      where: { publicSlug: candidate, agencyId: { not: agencyId } },
      select: { id: true },
    });
    if (!collision) return candidate;
  }

  return `${base}-${randomBytes(4).toString("hex")}`;
}
