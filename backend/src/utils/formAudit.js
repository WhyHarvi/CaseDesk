import prisma from "../services/prisma/client.js";

export async function recordFormAudit({ form, event, details = null, metadata = null, userId = null }) {
  if (!form?.agencyId || !form?.caseId || !form?.clientId || !form?.title) return;
  try {
    await prisma.caseFormAuditEvent.create({ data: { agencyId: form.agencyId, caseFormId: form.id || null, caseId: form.caseId, clientId: form.clientId, formTitle: form.title, formNumber: form.formNumber || null, event, details, metadata, userId } });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") console.error("Failed to write form audit event", error);
  }
}
