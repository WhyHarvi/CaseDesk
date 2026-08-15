import prisma from "./prisma/client.js";

// "Send the remaining fields to the client" — a lighter-weight cousin of
// QuestionnaireAssignment, scoped to one CaseForm's still-missing
// Client-owned fields instead of a whole questionnaire, and a plain
// first-class table rather than a JSON-mirrored one.
export async function createClientRequest({ agencyId, caseFormId, caseId, clientId, fieldKeys, message, dueAt }) {
  return prisma.caseFormClientRequest.create({
    data: {
      agencyId,
      caseFormId,
      caseId,
      clientId,
      requestedFieldKeys: fieldKeys,
      message: message || null,
      dueAt: dueAt || null,
      status: "Sent",
    },
  });
}

export async function listClientRequestsForForm({ caseFormId, agencyId }) {
  return prisma.caseFormClientRequest.findMany({
    where: { caseFormId, agencyId },
    orderBy: { sentAt: "desc" },
    include: { reviewedBy: { select: { id: true, fullName: true } } },
  });
}

// Idempotent: submitting an already-submitted/reviewed request just
// returns it unchanged rather than erroring — the client's portal can
// retry safely.
export async function submitClientRequest({ id, clientId, answers }) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.caseFormClientRequest.findFirst({ where: { id, clientId } });
    if (!request) return null;
    if (request.status === "Submitted" || request.status === "Reviewed") return request;

    const keys = Array.isArray(request.requestedFieldKeys) ? request.requestedFieldKeys : [];
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(answers || {}, key)) continue;
      const raw = answers[key];
      const value = raw === null || raw === undefined || raw === "" ? null : String(raw);
      await tx.caseFormFieldValue.upsert({
        where: { caseFormId_fieldKey: { caseFormId: request.caseFormId, fieldKey: key } },
        update: { value, status: "ClientEntered", filledAt: new Date(), filledById: null },
        create: { agencyId: request.agencyId, caseFormId: request.caseFormId, fieldKey: key, value, status: "ClientEntered", filledAt: new Date() },
      });
    }
    return tx.caseFormClientRequest.update({ where: { id: request.id }, data: { status: "Submitted", submittedAt: new Date() } });
  });
}

export async function reviewClientRequest({ id, agencyId, caseFormId, reviewedById }) {
  const request = await prisma.caseFormClientRequest.findFirst({ where: { id, agencyId, caseFormId } });
  if (!request) return null;
  return prisma.caseFormClientRequest.update({ where: { id: request.id }, data: { status: "Reviewed", reviewedAt: new Date(), reviewedById } });
}
