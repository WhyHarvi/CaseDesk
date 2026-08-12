import prisma from "../../services/prisma/client.js";

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// Lead payment state is a projection of posted financial records. This is
// intentionally the only path that writes PARTIAL/PAID/REFUNDED after the
// manual commercial-status form stopped accepting those values.
export async function syncLeadInitialPaymentFromEvidence(agencyId, { clientId = null, caseId = null } = {}) {
  if (!clientId && !caseId) return [];
  const leads = await prisma.lead.findMany({
    where: {
      agencyId,
      status: "OPEN",
      OR: [
        ...(clientId ? [{ earlyClientId: clientId }, { convertedClientId: clientId }] : []),
        ...(caseId ? [{ earlyCaseId: caseId }, { convertedCaseId: caseId }] : []),
      ],
    },
    select: { id: true, leadNumber: true, retainerStatus: true, initialPaymentStatus: true, stage: true, ownerUserId: true, earlyCaseId: true, convertedCaseId: true },
  });
  const updates = [];
  for (const lead of leads) {
    const caseIds = [caseId, lead.earlyCaseId, lead.convertedCaseId].filter(Boolean);
    const invoices = await prisma.caseInvoice.findMany({
      where: { agencyId, caseId: { in: [...new Set(caseIds)] }, status: { notIn: ["Void", "Voided"] } },
      include: { refunds: { where: { status: "Completed" } } },
    });
    const charged = money(invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0));
    const collected = money(invoices.reduce((sum, invoice) => sum + Math.max(0, Number(invoice.amount) - Number(invoice.balance)), 0));
    const refunded = money(invoices.flatMap((invoice) => invoice.refunds).reduce((sum, refund) => sum + Number(refund.amount), 0));
    const netCollected = money(collected - refunded);
    if (charged <= 0 || (collected <= 0 && refunded <= 0)) continue;
    const status = refunded > 0 && netCollected <= 0
      ? "REFUNDED"
      : netCollected >= charged - 0.01
        ? "PAID"
        : "PARTIAL";
    if (status === lead.initialPaymentStatus) continue;
    const ready = ["SIGNED", "NOT_REQUIRED"].includes(lead.retainerStatus) && status === "PAID";
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.lead.update({
        where: { id: lead.id },
        data: {
          initialPaymentStatus: status,
          ...(ready ? { stage: "READY_TO_CONVERT", nextActionType: "REVIEW_CONVERSION", nextActionDescription: "Review the lead and convert to a client", nextActionAt: new Date(Date.now() + 24 * 60 * 60_000), nextActionOwnerId: lead.ownerUserId } : {}),
          version: { increment: 1 },
        },
      });
      await tx.leadActivity.create({
        data: {
          agencyId,
          leadId: lead.id,
          activityType: status === "REFUNDED" ? "INTERNAL_NOTE" : "PAYMENT_RECEIVED",
          direction: "INTERNAL",
          channel: "SYSTEM",
          outcome: status,
          title: `Initial payment ${status.toLowerCase()}`,
          description: `Derived from posted invoices and transactions. Charged $${charged.toFixed(2)}, collected $${collected.toFixed(2)}, refunded $${refunded.toFixed(2)}.`,
          metadata: { previousStatus: lead.initialPaymentStatus, status, source: "financial_evidence" },
        },
      });
      if (ready && lead.stage !== "READY_TO_CONVERT") {
        await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, previousStage: lead.stage, newStage: "READY_TO_CONVERT", reason: "Payment confirmed from financial evidence" } });
      }
      return row;
    });
    updates.push(updated);
  }
  return updates;
}

export async function syncLeadConsultationPaymentFromEvidence(agencyId, appointmentId, financialStatus) {
  const paymentStatus = financialStatus === "Refunded" ? "REFUNDED" : financialStatus === "Paid" ? "PAID" : null;
  if (!paymentStatus || !appointmentId) return 0;
  const result = await prisma.leadConsultation.updateMany({
    where: { agencyId, appointmentId, paymentStatus: { not: paymentStatus } },
    data: { paymentStatus },
  });
  return result.count;
}
