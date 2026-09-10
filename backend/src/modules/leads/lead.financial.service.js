import prisma from "../../services/prisma/client.js";
import { logger } from "../../services/logger.js";
import { convertLeadCore } from "./lead.service.js";
import { linkLeadSoftProfile } from "./lead.softProfile.service.js";

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// Lead payment state is a projection of posted financial records. This is
// intentionally the only path that writes PARTIAL/PAID/REFUNDED after the
// manual commercial-status form stopped accepting those values.
export async function syncLeadInitialPaymentFromEvidence(agencyId, { leadId = null, clientId = null, caseId = null } = {}) {
  if (!leadId && !clientId && !caseId) return [];
  const leads = await prisma.lead.findMany({
    where: {
      agencyId,
      status: "OPEN",
      OR: [
        ...(leadId ? [{ id: leadId }] : []),
        ...(clientId ? [{ earlyClientId: clientId }, { convertedClientId: clientId }] : []),
        ...(clientId ? [{ appointments: { some: { clientId } } }] : []),
        ...(caseId ? [{ earlyCaseId: caseId }, { convertedCaseId: caseId }] : []),
      ],
    },
    select: {
      id: true,
      leadNumber: true,
      retainerStatus: true,
      initialPaymentStatus: true,
      stage: true,
      ownerUserId: true,
      earlyClientId: true,
      earlyCaseId: true,
      convertedCaseId: true,
      createdAt: true,
      appointments: {
        where: { clientId: { not: null } },
        select: { clientId: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
  });
  const updates = [];
  for (const originalLead of leads) {
    let lead = originalLead;
    const resolvedClientId = lead.earlyClientId || clientId || lead.appointments[0]?.clientId || null;
    let resolvedCaseId = lead.earlyCaseId || caseId || lead.convertedCaseId || null;

    // Historical appointments sometimes created a Client, followed by a
    // separately-created paid Case, without filling the lead's early links.
    // Recover only from the appointment-linked client and its own posted
    // invoice; never infer this relationship from matching contact text.
    if (!resolvedCaseId && resolvedClientId) {
      const paidInvoice = await prisma.caseInvoice.findFirst({
        where: {
          agencyId,
          clientId: resolvedClientId,
          createdAt: { gte: lead.createdAt },
          status: { notIn: ["Void", "Voided"] },
          OR: [
            { lastPaymentAt: { not: null } },
            { status: "Paid" },
            { balance: 0 },
          ],
        },
        orderBy: [{ lastPaymentAt: "desc" }, { createdAt: "desc" }],
        select: { caseId: true },
      });
      resolvedCaseId = paidInvoice?.caseId || null;
    }

    if (resolvedClientId) {
      const linked = await linkLeadSoftProfile(prisma, {
        agencyId,
        leadId: lead.id,
        clientId: resolvedClientId,
        caseId: resolvedCaseId,
      });
      if (linked) lead = { ...lead, ...linked };
    }

    const caseIds = [resolvedCaseId, lead.earlyCaseId, lead.convertedCaseId].filter(Boolean);
    if (!caseIds.length) continue;
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
    const ready = ["SIGNED", "NOT_REQUIRED"].includes(lead.retainerStatus) && status === "PAID";
    const statusChanged = status !== lead.initialPaymentStatus;
    const workflowChanged = ready && lead.stage !== "READY_TO_CONVERT";
    let updated = lead;
    if (statusChanged || workflowChanged) updated = await prisma.$transaction(async (tx) => {
      const row = await tx.lead.update({
        where: { id: lead.id },
        data: {
          ...(statusChanged ? { initialPaymentStatus: status } : {}),
          ...(ready ? { stage: "READY_TO_CONVERT", nextActionType: "REVIEW_CONVERSION", nextActionDescription: "Review the lead and convert to a client", nextActionAt: new Date(Date.now() + 24 * 60 * 60_000), nextActionOwnerId: lead.ownerUserId } : {}),
          version: { increment: 1 },
        },
      });
      if (statusChanged) await tx.leadActivity.create({
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
      if (workflowChanged) {
        await tx.leadStageHistory.create({ data: { agencyId, leadId: lead.id, previousStage: lead.stage, newStage: "READY_TO_CONVERT", reason: "Payment confirmed from financial evidence" } });
      }
      return row;
    });
    if (statusChanged || workflowChanged) updates.push(updated);

    // An early client/case already exists to hold this lead's retainer —
    // once the retainer AND the initial payment are both genuinely ready,
    // there's nothing left for a human to decide that convertLeadCore
    // can't derive on its own (see its own defaults, mirroring
    // ConvertLeadSheet.jsx). Best-effort and outside this transaction on
    // purpose: the payment-status update above is the safety-critical
    // fact and must land regardless of whether auto-conversion succeeds.
    if (ready && lead.earlyClientId && lead.earlyCaseId) {
      await convertLeadCore(agencyId, lead.id, { actorId: lead.ownerUserId }).catch((error) => {
        logger.warn("lead.auto_conversion_failed", { agencyId, leadId: lead.id, reason: error.message });
      });
    }
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
