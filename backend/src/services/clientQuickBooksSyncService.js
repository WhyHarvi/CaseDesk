import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { adminRecipientIds, notifyUsers } from "./notificationService.js";
import {
  createQuickBooksCustomer,
  findQuickBooksCustomerByEmail,
  getQuickBooksCustomer,
  isQuickBooksDuplicateNameError,
  quickBooksConfigured,
  updateQuickBooksCustomer,
} from "./quickbooksService.js";

function customerFields(client, { includeDisplayName = true } = {}) {
  return {
    ...(includeDisplayName ? { displayName: client.fullName } : {}),
    email: client.email || null,
    phone: client.phone || null,
    alternatePhone: client.secondaryPhone || null,
    addressLine1: client.address || null,
  };
}

function sameEmail(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function collisionSafeDisplayName(client) {
  const suffix = ` (${client.clientNumber})`;
  return `${String(client.fullName || "Client").trim().slice(0, Math.max(1, 100 - suffix.length))}${suffix}`;
}

async function updateKnownCustomer(agencyId, customer, client) {
  const fields = customerFields(client);
  try {
    return await updateQuickBooksCustomer(agencyId, { id: customer.id, syncToken: customer.syncToken, ...fields });
  } catch (error) {
    // DisplayName is globally unique in a QBO company. Contact identity is
    // the exact email match; a same-name customer must not prevent the link
    // from being repaired or cause us to create yet another duplicate.
    if (isQuickBooksDuplicateNameError(error)) {
      try {
        return await updateQuickBooksCustomer(agencyId, {
          id: customer.id,
          syncToken: customer.syncToken,
          ...fields,
          displayName: collisionSafeDisplayName(client),
        });
      } catch (retryError) {
        if (!isQuickBooksDuplicateNameError(retryError)) throw retryError;
        return updateQuickBooksCustomer(agencyId, {
          id: customer.id,
          syncToken: customer.syncToken,
          ...customerFields(client, { includeDisplayName: false }),
        });
      }
    }
    throw error;
  }
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
        // If the cached id now resolves to another person's email (common
        // after reconnecting to a different QBO company or importing stale
        // data), never overwrite that record. Prefer the exact email match;
        // if none exists, create a new customer below.
        if (!client.email || sameEmail(existing.email, client.email)) {
          const updated = await updateKnownCustomer(agencyId, existing, client);
          return persistSuccess(clientId, updated.id);
        }
        logger.warn("quickbooks.client_link_email_mismatch", {
          agencyId,
          clientId,
          linkedCustomerId: existing.id,
        });
      }
      // The linked QuickBooks customer is gone (deleted/deactivated there) —
      // or belongs to another contact — fall through to exact-email repair.
    }

    const matched = client.email ? await findQuickBooksCustomerByEmail(agencyId, client.email) : null;
    if (matched) {
      // Exact email is the durable identity signal. If the canonical name
      // collides, update this same customer with a client-number suffix;
      // never create another customer just to obtain a unique name.
      const updated = await updateKnownCustomer(agencyId, matched, client);
      return persistSuccess(clientId, updated.id);
    }

    try {
      const created = await createQuickBooksCustomer(agencyId, fields);
      return persistSuccess(clientId, created.id);
    } catch (error) {
      // QBO enforces globally-unique DisplayName; retry once with the
      // client number appended so a same-name collision never blocks sync.
      if (isQuickBooksDuplicateNameError(error)) {
        const raced = client.email ? await findQuickBooksCustomerByEmail(agencyId, client.email) : null;
        if (raced) {
          const updated = await updateKnownCustomer(agencyId, raced, client);
          return persistSuccess(clientId, updated.id);
        }
        try {
          const created = await createQuickBooksCustomer(agencyId, { ...fields, displayName: `${fields.displayName} (${client.clientNumber})` });
          return persistSuccess(clientId, created.id);
        } catch (retryError) {
          if (!isQuickBooksDuplicateNameError(retryError) || !client.email) throw retryError;
          const concurrent = await findQuickBooksCustomerByEmail(agencyId, client.email);
          if (!concurrent) throw retryError;
          const updated = await updateKnownCustomer(agencyId, concurrent, client);
          return persistSuccess(clientId, updated.id);
        }
      }
      throw error;
    }
  } catch (error) {
    logger.warn("quickbooks.client_sync_failed", { agencyId, clientId, reason: error.message });
    return persistFailure(agencyId, clientId, error.message || "QuickBooks sync failed.");
  }
}
