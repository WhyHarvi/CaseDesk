import prisma from "./prisma/client.js";

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
    return await prisma.communicationAuditEvent.create({
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
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("Failed to write communication audit event", error);
    }
    return null;
  }
}

