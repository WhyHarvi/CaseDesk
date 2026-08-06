import prisma from "./prisma/client.js";

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export async function queueDirectFollowUpEmail({ followUp, milestone, scheduledKey }) {
  const email = normalizedEmail(followUp.client?.email);
  if (!email) return { queued: false, reason: "missing_email" };

  const [preference, consent, agency] = await Promise.all([
    prisma.communicationPreference.findUnique({
      where: { clientId: followUp.clientId },
      select: { agencyId: true, doNotContact: true, allowEmail: true },
    }),
    prisma.communicationConsent.findFirst({
      where: {
        agencyId: followUp.agencyId,
        clientId: followUp.clientId,
        channel: "Email",
        address: email,
        status: "Consented",
      },
      select: { id: true },
    }),
    prisma.agency.findUnique({
      where: { id: followUp.agencyId },
      select: { timezone: true },
    }),
  ]);
  if (preference?.agencyId === followUp.agencyId && (preference.doNotContact || !preference.allowEmail)) {
    return { queued: false, reason: "email_disabled" };
  }
  if (!consent) return { queued: false, reason: "email_consent_required" };

  const idempotencyKey = `follow-up:${followUp.id}:${milestone}:client-email:${scheduledKey}`.slice(0, 200);
  const prior = await prisma.communicationMessage.findUnique({
    where: { agencyId_idempotencyKey: { agencyId: followUp.agencyId, idempotencyKey } },
    select: { id: true, status: true },
  });
  if (prior) return { queued: false, duplicate: true, messageId: prior.id };

  const actor = await prisma.user.findFirst({
    where: {
      agencyId: followUp.agencyId,
      status: "active",
      ...(followUp.assignedUserId ? { id: followUp.assignedUserId } : {}),
      memberships: { some: { agencyId: followUp.agencyId, isActive: true } },
    },
    select: { id: true },
  }) || await prisma.user.findFirst({
    where: {
      agencyId: followUp.agencyId,
      status: "active",
      memberships: { some: { agencyId: followUp.agencyId, isActive: true, role: "admin" } },
    },
    select: { id: true },
  });
  if (!actor) return { queued: false, reason: "missing_sender" };

  const dueText = followUp.dueDate
    ? `Due ${new Intl.DateTimeFormat("en-CA", {
        timeZone: agency?.timezone || "America/Toronto",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(followUp.dueDate))}`
    : "";
  const subject = milestone === "overdue" ? `Reminder overdue: ${followUp.title}` : followUp.title;
  const bodyText = [followUp.description || followUp.title, dueText].filter(Boolean).join("\n\n");
  const bodyHtml = `<p>${escapeHtml(followUp.description || followUp.title)}</p>${dueText ? `<p>${escapeHtml(dueText)}</p>` : ""}`;
  try {
    const message = await prisma.$transaction(async (tx) => {
      let conversation = await tx.communicationConversation.findFirst({
        where: {
          agencyId: followUp.agencyId,
          clientId: followUp.clientId,
          caseId: followUp.caseId || null,
          channel: "Email",
          deletedAt: null,
        },
        orderBy: { lastMessageAt: "desc" },
      });
      const now = new Date();
      if (!conversation) {
        conversation = await tx.communicationConversation.create({
          data: {
            agencyId: followUp.agencyId,
            clientId: followUp.clientId,
            caseId: followUp.caseId || null,
            channel: "Email",
            subject,
            provider: "SMTP",
            assignedToId: followUp.assignedUserId || actor.id,
            state: "WaitingOnClient",
            lastMessageAt: now,
            lastOutboundAt: now,
            createdById: actor.id,
          },
        });
      } else {
        await tx.communicationConversation.update({
          where: { id: conversation.id },
          data: {
            state: "WaitingOnClient",
            subject: conversation.subject || subject,
            lastMessageAt: now,
            lastOutboundAt: now,
            isArchived: false,
          },
        });
      }
      const created = await tx.communicationMessage.create({
        data: {
          agencyId: followUp.agencyId,
          clientId: followUp.clientId,
          caseId: followUp.caseId || null,
          conversationId: conversation.id,
          channel: "Email",
          direction: "Outbound",
          status: "Queued",
          senderUserId: null,
          recipients: [email],
          subject,
          bodyText,
          bodyHtml,
          provider: "SMTP",
          idempotencyKey,
          metadata: { followUpId: followUp.id, milestone, automated: true },
        },
      });
      await tx.communicationOutbox.create({
        data: {
          agencyId: followUp.agencyId,
          messageId: created.id,
          payload: {
            messageId: created.id,
            recipients: [email],
            cc: [],
            bcc: [],
            subject,
            bodyText,
            bodyHtml,
          },
        },
      });
      await tx.communicationDeliveryEvent.create({
        data: {
          agencyId: followUp.agencyId,
          messageId: created.id,
          type: "Queued",
          details: "Automated follow-up reminder queued for provider delivery",
        },
      });
      return created;
    });
    return { queued: true, messageId: message.id };
  } catch (error) {
    if (error?.code === "P2002") return { queued: false, duplicate: true };
    throw error;
  }
}
