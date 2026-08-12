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
    // Not awaited — notifyUsers() does preference lookups and delivery
    // dispatch that measured ~1.5s on a real request. The audit event
    // itself (the DB write above) is already durable at this point; every
    // caller of recordCommunicationAudit was blocking its own response on
    // this notification finishing, which made ordinary sends/edits/deletes
    // across email, SMS, calls, and chat all feel slow for no reason.
    dispatchCommunicationAuditNotification(event).catch((error) => {
      if (process.env.NODE_ENV !== "test") console.error("Failed to create communication notification", error);
    });
    return event;
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("Failed to write communication audit event", error);
    }
    return null;
  }
}
