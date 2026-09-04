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

// Intake forms call this while a person is still typing. A complete valid
// contact value is normalized exactly like createClient; incomplete values
// are ignored instead of turning ordinary keystrokes into validation errors.
export function normalizeContactMatchInput({ phone, secondaryPhone, email }) {
  let phoneNormalized = null;
  let secondaryPhoneNormalized = null;
  let emailNormalized = null;
  if (String(phone || "").trim()) {
    try { phoneNormalized = normalizeContact({ phone }).phoneNormalized; }
    catch { phoneNormalized = null; }
  }
  if (String(secondaryPhone || "").trim()) {
    try { secondaryPhoneNormalized = normalizeContact({ phone: secondaryPhone }).phoneNormalized; }
    catch { secondaryPhoneNormalized = null; }
  }
  if (String(email || "").trim()) {
    try { emailNormalized = normalizeContact({ email }).emailNormalized; }
    catch { emailNormalized = null; }
  }
  return { phoneNormalized, secondaryPhoneNormalized, emailNormalized };
}

function clientContactWhere(phoneNormalized, secondaryPhoneNormalized, emailNormalized) {
  const phones = [...new Set([phoneNormalized, secondaryPhoneNormalized].filter(Boolean))];
  const OR = [
    ...phones.flatMap((normalized) => [
      { phoneNormalized: normalized },
      { secondaryPhoneNormalized: normalized },
    ]),
    ...(emailNormalized ? [{ emailNormalized }] : []),
  ];
  return OR.length ? { OR } : null;
}

function leadContactWhere(phoneNormalized, secondaryPhoneNormalized, emailNormalized) {
  const phones = [...new Set([phoneNormalized, secondaryPhoneNormalized].filter(Boolean))];
  const OR = [
    ...phones.map((normalized) => ({ phoneNormalized: normalized })),
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
  secondaryPhoneNormalized,
  emailNormalized,
  excludeClientId = null,
  excludeLeadId = null,
}) {
  const clientContact = clientContactWhere(phoneNormalized, secondaryPhoneNormalized, emailNormalized);
  const leadContact = leadContactWhere(phoneNormalized, secondaryPhoneNormalized, emailNormalized);
  if (!clientContact && !leadContact) return;

  const [client, lead] = await Promise.all([
    tx.client.findFirst({
      where: {
        agencyId,
        ...clientContact,
        ...(excludeClientId ? { id: { not: excludeClientId } } : {}),
      },
      select: { id: true, fullName: true, phoneNormalized: true, secondaryPhoneNormalized: true, emailNormalized: true },
    }),
    tx.lead.findFirst({
      where: {
        agencyId,
        deletedAt: null,
        status: { notIn: ["DUPLICATE", "ARCHIVED"] },
        // A converted lead and its resulting Client deliberately share the
        // same contact details. When editing that Client, exclude only the
        // lead already linked to it while continuing to catch every other
        // active lead with the same phone or email.
        AND: [
          leadContact,
          ...(excludeClientId
            ? [
                {
                  OR: [
                    { convertedClientId: null },
                    { convertedClientId: { not: excludeClientId } },
                  ],
                },
                // A retainer requested/signed before formal conversion
                // creates a real Client (and Case) early, via earlyClientId
                // — the lead itself stays open, working its own pipeline,
                // never getting convertedClientId set at all. Without this
                // gate, editing that early client's contact info makes the
                // lead look like a stranger's duplicate record instead of
                // its own source lead.
                {
                  OR: [
                    { earlyClientId: null },
                    { earlyClientId: { not: excludeClientId } },
                  ],
                },
                // "Save as client" links the appointment to both records
                // without formally converting the lead. That appointment is
                // still authoritative proof that this is the same person.
                { appointments: { none: { clientId: excludeClientId } } },
              ]
            : []),
        ],
        ...(excludeLeadId ? { id: { not: excludeLeadId } } : {}),
      },
      select: { id: true, leadNumber: true, firstName: true, lastName: true, phoneNormalized: true, emailNormalized: true },
    }),
  ]);

  if (client) {
    const submittedPhones = new Set([phoneNormalized, secondaryPhoneNormalized].filter(Boolean));
    const field = submittedPhones.has(client.phoneNormalized) || submittedPhones.has(client.secondaryPhoneNormalized) ? "phone number" : "email address";
    throw createHttpError(409, `A client named ${client.fullName} already uses this ${field}. Open the existing client instead.`, "DUPLICATE_CLIENT");
  }
  if (lead) {
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.leadNumber;
    const field = [phoneNormalized, secondaryPhoneNormalized].filter(Boolean).includes(lead.phoneNormalized) ? "phone number" : "email address";
    throw createHttpError(409, `Lead ${lead.leadNumber} (${name}) already uses this ${field}. Continue from the existing lead instead.`, "DUPLICATE_LEAD");
  }
}
