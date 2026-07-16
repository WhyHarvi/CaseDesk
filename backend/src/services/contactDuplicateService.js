import { normalizeEmail, normalizePhone } from "../modules/leads/lead.validation.js";
import { createHttpError } from "../utils/http.js";

export function normalizeContact({ phone, email }) {
  const cleanPhone = phone === undefined || phone === null ? null : String(phone).trim() || null;
  const cleanEmail = email === undefined || email === null ? null : String(email).trim() || null;
  return {
    phone: cleanPhone,
    phoneNormalized: cleanPhone ? normalizePhone(cleanPhone) : null,
    email: cleanEmail,
    emailNormalized: cleanEmail ? normalizeEmail(cleanEmail) : null,
  };
}

function contactWhere(phoneNormalized, emailNormalized) {
  const OR = [
    ...(phoneNormalized ? [{ phoneNormalized }] : []),
    ...(emailNormalized ? [{ emailNormalized }] : []),
  ];
  return OR.length ? { OR } : null;
}

export async function lockAgencyContactIntake(tx, agencyId) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`contact-intake:${agencyId}`}))::text AS lock_status`;
}

export async function assertNoContactDuplicate(tx, {
  agencyId,
  phoneNormalized,
  emailNormalized,
  excludeClientId = null,
  excludeLeadId = null,
}) {
  const contact = contactWhere(phoneNormalized, emailNormalized);
  if (!contact) return;

  const [client, lead] = await Promise.all([
    tx.client.findFirst({
      where: {
        agencyId,
        ...contact,
        ...(excludeClientId ? { id: { not: excludeClientId } } : {}),
      },
      select: { id: true, fullName: true, phoneNormalized: true, emailNormalized: true },
    }),
    tx.lead.findFirst({
      where: {
        agencyId,
        deletedAt: null,
        status: { notIn: ["DUPLICATE", "ARCHIVED"] },
        ...contact,
        ...(excludeLeadId ? { id: { not: excludeLeadId } } : {}),
      },
      select: { id: true, leadNumber: true, firstName: true, lastName: true, phoneNormalized: true, emailNormalized: true },
    }),
  ]);

  if (client) {
    const field = phoneNormalized && client.phoneNormalized === phoneNormalized ? "phone number" : "email address";
    throw createHttpError(409, `A client named ${client.fullName} already uses this ${field}. Open the existing client instead.`, "DUPLICATE_CLIENT");
  }
  if (lead) {
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.leadNumber;
    const field = phoneNormalized && lead.phoneNormalized === phoneNormalized ? "phone number" : "email address";
    throw createHttpError(409, `Lead ${lead.leadNumber} (${name}) already uses this ${field}. Continue from the existing lead instead.`, "DUPLICATE_LEAD");
  }
}
