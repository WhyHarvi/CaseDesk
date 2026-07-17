import prisma from "./prisma/client.js";
import { dispatchCommunicationAuditNotification } from "./notificationService.js";

export async function recordCommunicationAudit({
  agencyId,
  userId = null,
  conversationId = null,
  messageId = null,
  action,
  details = null,
  metadata = {},
}) {
  try {
    const event = await prisma.communicationAuditEvent.create({
      data: {
        agencyId,
        userId,
        conversationId,
        messageId,
        action,
        details,
        metadata,
      },
    });
    try {
      await dispatchCommunicationAuditNotification(event);
    } catch (error) {
      if (process.env.NODE_ENV !== "test") console.error("Failed to create communication notification", error);
    }
    return event;
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("Failed to write communication audit event", error);
    }
    return null;
  }
}
