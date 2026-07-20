import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { adminRecipientIds, notifyUsers } from "./notificationService.js";
import {
  createQuickBooksCustomer,
  findQuickBooksCustomerByEmail,
  getQuickBooksCustomer,
  quickBooksConfigured,
  updateQuickBooksCustomer,
} from "./quickbooksService.js";

function customerFields(client) {
  return {
    displayName: client.fullName,
    email: client.email || null,
    phone: client.phone || null,
    addressLine1: client.address || null,
  };
}

async function persistSuccess(clientId, customerId) {
  return prisma.client.update({
    where: { id: clientId },
    data: { qbCustomerId: customerId, qbSyncStatus: "synced", qbSyncError: null, qbSyncedAt: new Date() },
  });
}

async function persistFailure(agencyId, clientId, message) {
  const client = await prisma.client.update({
    where: { id: clientId },
    data: { qbSyncStatus: "error", qbSyncError: String(message).slice(0, 500), qbSyncedAt: new Date() },
  });
  const recipients = await adminRecipientIds(agencyId);
  if (recipients.length) {
    await notifyUsers({
      agencyId,
      recipientIds: recipients,
      type: "quickbooks.sync_failed",
      category: "cases",
      title: "QuickBooks sync failed",
      body: `${client.fullName} could not be synced to QuickBooks: ${message}`,
      severity: "warning",
      entityType: "client",
      entityId: clientId,
      actionUrl: `/app/clients/${clientId}`,
      dedupeKey: `quickbooks-sync-failed:client:${clientId}`,
    }).catch(() => {});
  }
  return client;
}

/**
 * Creates or updates this client's QuickBooks Customer record, matching by
 * email when no link exists yet to avoid duplicate customers. Never throws —
 * a QuickBooks outage or missing connection must not block CaseDesk's own
 * write. Callers should fire this after their own transaction commits.
 */
export async function syncClientToQuickBooks(agencyId, clientId) {
  if (!quickBooksConfigured()) return null;
  const settings = await prisma.agencyQuickBooksSettings.findUnique({ where: { agencyId }, select: { status: true } });
  if (!settings || settings.status !== "connected") return null;

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client || client.agencyId !== agencyId) return null;

  try {
    const fields = customerFields(client);

    if (client.qbCustomerId) {
      const existing = await getQuickBooksCustomer(agencyId, client.qbCustomerId);
      if (existing) {
        const updated = await updateQuickBooksCustomer(agencyId, { id: existing.id, syncToken: existing.syncToken, ...fields });
        return persistSuccess(clientId, updated.id);
      }
      // The linked QuickBooks customer is gone (deleted/deactivated there) —
      // fall through and treat this as a fresh link.
    }

    const matched = client.email ? await findQuickBooksCustomerByEmail(agencyId, client.email) : null;
    if (matched) {
      const updated = await updateQuickBooksCustomer(agencyId, { id: matched.id, syncToken: matched.syncToken, ...fields });
      return persistSuccess(clientId, updated.id);
    }

    try {
      const created = await createQuickBooksCustomer(agencyId, fields);
      return persistSuccess(clientId, created.id);
    } catch (error) {
      // QBO enforces globally-unique DisplayName; retry once with the
      // client number appended so a same-name collision never blocks sync.
      if (String(error.message || "").toLowerCase().includes("duplicate name")) {
        const created = await createQuickBooksCustomer(agencyId, { ...fields, displayName: `${fields.displayName} (${client.clientNumber})` });
        return persistSuccess(clientId, created.id);
      }
      throw error;
    }
  } catch (error) {
    logger.warn("quickbooks.client_sync_failed", { agencyId, clientId, reason: error.message });
    return persistFailure(agencyId, clientId, error.message || "QuickBooks sync failed.");
  }
}
