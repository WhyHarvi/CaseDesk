import { randomBytes } from "node:crypto";
import prisma from "./prisma/client.js";

export const DEFAULT_BOOKING_PUBLIC_ORIGIN = "https://casedesk.chkimmigration.ca";

function validPublicOrigin(value) {
  try {
    const parsed = new URL(String(value || "").split(",")[0].trim());
    const hostname = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== "https:" ||
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".localhost")
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Client-facing booking links must never inherit a localhost FRONTEND_URL.
 * BOOKING_PUBLIC_ORIGIN can override the canonical CHK domain for another
 * deployment without coupling CORS/application URLs to outbound messages.
 */
export function bookingPublicOrigin(environment = process.env) {
  return validPublicOrigin(environment.BOOKING_PUBLIC_ORIGIN) || DEFAULT_BOOKING_PUBLIC_ORIGIN;
}

export function publicBookingPageUrl(settings, { offerToken = null, environment = process.env } = {}) {
  const slug = settings?.publicSlug || settings?.publicToken;
  if (!slug) return null;
  const url = new URL(`/b/${encodeURIComponent(slug)}`, bookingPublicOrigin(environment));
  if (offerToken) url.searchParams.set("offer", offerToken);
  return url.toString();
}

export function publicBookingManageUrl(settings, manageToken, { environment = process.env } = {}) {
  if (!manageToken) return null;
  const publicPageUrl = publicBookingPageUrl(settings, { environment });
  if (publicPageUrl) {
    const url = new URL(publicPageUrl);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/manage/${encodeURIComponent(manageToken)}`;
    return url.toString();
  }
  return new URL(`/book/manage/${encodeURIComponent(manageToken)}`, bookingPublicOrigin(environment)).toString();
}

// The retainer signing page isn't a "booking" page (no slug/settings lookup
// needed) — just a document tied directly to the same manageToken already
// emailed/texted to the guest for managing their appointment.
export function publicRetainerSignUrl(manageToken, { environment = process.env } = {}) {
  if (!manageToken) return null;
  return new URL(`/retainer/${encodeURIComponent(manageToken)}`, bookingPublicOrigin(environment)).toString();
}

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
