import { notifyUsers } from "./notificationService.js";

export async function notifyCaseAssignment({ agencyId, caseItem, clientName, actorUserId = null, source = "CaseDesk" }) {
  if (!caseItem?.id || !caseItem.assignedUserId) return [];
  return notifyUsers({
    agencyId,
    recipientIds: [caseItem.assignedUserId],
    actorUserId,
    type: "case.assigned",
    category: "cases",
    title: "Case assigned to you",
    body: `${clientName || "A client"} · ${caseItem.caseType}${source ? ` · ${source}` : ""}`,
    severity: "info",
    attentionLevel: "action_required",
    entityType: "case",
    entityId: caseItem.id,
    actionUrl: `/app/cases/${encodeURIComponent(caseItem.id)}`,
    destinationKey: "cases",
    dedupeKey: `case:${caseItem.id}:assigned:${caseItem.assignedUserId}:${new Date(caseItem.updatedAt || caseItem.createdAt || 0).toISOString()}`,
    channels: ["in_app"],
  });
}
