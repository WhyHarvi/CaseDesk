import prisma from "./prisma/client.js";
import { recordCommunicationAudit } from "./communicationAudit.js";

const text = (value, max = 300) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value) => (Array.isArray(value) ? value : []);

function matches(rule, context) {
  const conditions = object(rule.conditions);
  if (
    conditions.caseType &&
    text(conditions.caseType).toLowerCase() !==
      text(context.caseItem?.caseType).toLowerCase()
  )
    return false;
  if (conditions.containsText) {
    const haystack =
      `${context.message.subject || ""} ${context.message.bodyText || ""}`.toLowerCase();
    if (!haystack.includes(text(conditions.containsText).toLowerCase()))
      return false;
  }
  if (
    conditions.senderContains &&
    !text(context.message.senderAddress)
      .toLowerCase()
      .includes(text(conditions.senderContains).toLowerCase())
  )
    return false;
  return true;
}

export async function applyCommunicationAutomations({
  agencyId,
  trigger,
  message,
  conversation,
  caseItem,
  client,
}) {
  const rules = await prisma.communicationAutomationRule.findMany({
    where: {
      agencyId,
      trigger,
      isActive: true,
      OR: [{ channel: null }, { channel: message.channel }],
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  let applied = 0;
  for (const rule of rules) {
    if (!matches(rule, { message, conversation, caseItem, client })) continue;
    const actions = object(rule.actions);
    const tags = [
      ...new Set([
        ...array(conversation.tags),
        ...array(actions.addTags)
          .map((item) => text(item, 40))
          .filter(Boolean),
      ]),
    ].slice(0, 20);
    const assignedTo = actions.assignToUserId
      ? await prisma.user.findFirst({
          where: { id: text(actions.assignToUserId, 80), agencyId },
          select: { id: true },
        })
      : null;
    await prisma.$transaction(async (tx) => {
      await tx.communicationConversation.update({
        where: { id: conversation.id },
        data: {
          ...(assignedTo ? { assignedToId: assignedTo.id } : {}),
          ...(["Low", "Normal", "High", "Urgent"].includes(actions.priority)
            ? { priority: actions.priority }
            : {}),
          ...(tags.length ? { tags } : {}),
        },
      });
      if (actions.createFollowUp === true || actions.followUpTitle) {
        const dueMinutes = Math.min(
          Math.max(Number(actions.followUpDueMinutes) || 240, 5),
          525_600,
        );
        await tx.followUp.create({
          data: {
            agencyId,
            clientId: client.id,
            caseId: caseItem?.id || null,
            assignedUserId: assignedTo?.id || conversation.assignedToId,
            title:
              text(actions.followUpTitle, 200) ||
              `Respond to ${message.channel.toLowerCase()} from ${client.fullName}`,
            description: `Created automatically by communication rule: ${rule.name}`,
            dueDate: new Date(Date.now() + dueMinutes * 60_000),
            status: "Pending",
          },
        });
      }
      await tx.communicationAutomationRule.update({
        where: { id: rule.id },
        data: { lastRunAt: new Date(), runCount: { increment: 1 } },
      });
    });
    await recordCommunicationAudit({
      agencyId,
      conversationId: conversation.id,
      messageId: message.id,
      action: "communication.automation_applied",
      details: `Automation applied: ${rule.name}`,
      metadata: { ruleId: rule.id, trigger },
    });
    applied += 1;
  }
  return applied;
}
