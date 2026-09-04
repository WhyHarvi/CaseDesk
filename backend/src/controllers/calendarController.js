import prisma from "../services/prisma/client.js";
import { normalizeContactMatchInput } from "../services/contactDuplicateService.js";
import { createHttpError } from "../utils/http.js";

const MAX_CALENDAR_RANGE_MS = 93 * 24 * 60 * 60_000;

const calendarInclude = {
  client: { select: { id: true, fullName: true, email: true, phone: true, secondaryPhone: true } },
  case: { select: { id: true, caseType: true } },
  assignedTo: { select: { id: true, fullName: true, zoomHostMapping: { select: { status: true } } } },
  sessionType: { select: { id: true, name: true, durationMinutes: true, allowedMeetingModes: true } },
  paymentHold: {
    select: {
      id: true,
      status: true,
      amount: true,
      qbInvoiceNumber: true,
      qbInvoiceLink: true,
      paidAt: true,
      expiresAt: true,
      paymentMethod: true,
      manualPaymentReference: true,
      paymentError: true,
    },
  },
  paymentApprovals: {
    where: { status: { in: ["Pending", "Processing", "Failed"] } },
    select: { id: true, status: true, method: true, amount: true, transactionReference: true, processingError: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
};

function calendarContactMatch(item) {
  const normalized = normalizeContactMatchInput({
    email: item.guestEmail,
    phone: item.guestPhone,
  });
  if (!normalized.emailNormalized && !normalized.phoneNormalized) return null;
  return { appointmentId: item.id, ...normalized };
}

export async function listCalendarAppointments(req, res) {
  const from = new Date(String(req.query.from || ""));
  const to = new Date(String(req.query.to || ""));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw createHttpError(400, "A valid from/to range is required.", "VALIDATION_ERROR");
  }
  if (to.getTime() - from.getTime() > MAX_CALENDAR_RANGE_MS) {
    throw createHttpError(400, "Range cannot exceed 93 days.", "VALIDATION_ERROR");
  }

  const data = await prisma.appointment.findMany({
    where: {
      agencyId: req.auth.agencyId,
      startsAt: { lt: to },
      endsAt: { gt: from },
    },
    include: calendarInclude,
    orderBy: { startsAt: "asc" },
  });

  // Guest contact values predate the normalized contact fields and can be
  // free-form. Contact matching is enrichment only: one malformed legacy
  // phone/email must never make the whole shared calendar return HTTP 500.
  const unlinkedContacts = data
    .filter((item) => !item.clientId && (item.guestEmail || item.guestPhone))
    .map(calendarContactMatch)
    .filter(Boolean);

  const contactWhere = [
    ...new Set(unlinkedContacts.map((item) => item.emailNormalized).filter(Boolean)),
  ].map((emailNormalized) => ({ emailNormalized }));
  contactWhere.push(...[
    ...new Set(unlinkedContacts.map((item) => item.phoneNormalized).filter(Boolean)),
  ].flatMap((phoneNormalized) => [{ phoneNormalized }, { secondaryPhoneNormalized: phoneNormalized }]));

  const matchingClients = contactWhere.length ? await prisma.client.findMany({
    where: { agencyId: req.auth.agencyId, OR: contactWhere },
    select: { id: true, fullName: true, email: true, phone: true, secondaryPhone: true, emailNormalized: true, phoneNormalized: true, secondaryPhoneNormalized: true },
  }) : [];
  const contactByAppointment = new Map(unlinkedContacts.map((item) => [item.appointmentId, item]));

  res.json({
    data: data.map((item) => {
      if (item.clientId) return item;
      const contact = contactByAppointment.get(item.id);
      const candidates = matchingClients.filter((client) =>
        (contact?.emailNormalized && client.emailNormalized === contact.emailNormalized)
        || (contact?.phoneNormalized && [client.phoneNormalized, client.secondaryPhoneNormalized].includes(contact.phoneNormalized)));
      const matchedClient = candidates.length === 1 ? candidates[0] : null;
      if (!matchedClient) return item;
      const { emailNormalized: _emailNormalized, phoneNormalized: _phoneNormalized, secondaryPhoneNormalized: _secondaryPhoneNormalized, ...safeClient } = matchedClient;
      return { ...item, matchedClient: safeClient };
    }),
  });
}
