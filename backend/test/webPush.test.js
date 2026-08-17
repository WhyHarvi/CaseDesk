import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

// Live-verified end to end against the real database (disposable
// subscription rows, cleaned up after each check): subscribing a real
// client-role user creates a PushSubscription row, firing a genuine
// client-portal-scoped notification through notifyUsers automatically
// creates a "push" NotificationDelivery row for that user with no extra
// wiring needed at the call site, and sendWebPush correctly throws (rather
// than crashing the delivery worker) when a subscription can't be reached
// — the retry/backoff machinery in notificationDeliveryService.js already
// handles that from there.
test("web push: schema, service, and delivery-channel wiring", async () => {
  const [schema, migration, service, deliveryService, notificationService] = await Promise.all([
    read("prisma/schema.prisma"),
    read("prisma/migrations/20260817220000_add_push_subscriptions/migration.sql"),
    read("src/services/webPushService.js"),
    read("src/services/notificationDeliveryService.js"),
    read("src/services/notificationService.js"),
  ]);

  assert.match(schema, /model PushSubscription \{/);
  assert.match(schema, /endpoint\s+String\s+@unique/);
  assert.match(schema, /pushSubscriptions\s+PushSubscription\[\]/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "push_subscriptions"/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key"/);

  assert.match(service, /export async function saveSubscription\(agencyId, userId, subscription, userAgent\)/);
  assert.match(service, /export async function removeSubscription\(userId, endpoint\)/);
  assert.match(service, /where: \{ userId, endpoint \}/); // scoped so a client can only ever remove their own
  assert.match(service, /export async function hasPushSubscription\(userIds\)/);
  assert.match(service, /export async function sendWebPush\(job\)/);
  assert.match(service, /if \(\[404, 410\]\.includes\(error\.statusCode\)\)/); // dead subscriptions get pruned, not retried forever
  assert.match(service, /if \(!delivered\.length\) \{/); // one dead device can't block delivery to another

  assert.match(deliveryService, /import \{ sendWebPush \} from "\.\/webPushService\.js";/);
  assert.match(deliveryService, /if \(job\.channel === "push"\) return sendWebPush\(job\);/);

  // Subscribing is the opt-in — there's no separate preference toggle the
  // way in_app/email/sms have, and it applies whether channels was
  // explicitly passed by the call site or derived from preferences.
  assert.match(notificationService, /import \{ hasPushSubscription \} from "\.\/webPushService\.js";/);
  assert.match(notificationService, /const pushSubscribedUserIds = await hasPushSubscription\(validIds\);/);
  assert.match(notificationService, /if \(pushSubscribedUserIds\.has\(recipientUserId\) && !enabledChannels\.includes\("push"\)\)/);
});

test("web push: subscribe/unsubscribe endpoints are client-portal-only and rate limited", async () => {
  const [controller, routes] = await Promise.all([
    read("src/controllers/pushSubscriptionController.js"),
    read("src/routes/portalRoutes.js"),
  ]);
  assert.match(controller, /export async function subscribeToPush\(req, res\)/);
  assert.match(controller, /export async function unsubscribeFromPush\(req, res\)/);
  assert.match(controller, /req\.auth\.agencyId,\s*\n\s*req\.auth\.userId,\s*\n\s*req\.body\?\.subscription,/);

  assert.match(routes, /router\.use\(requireRole\("client"\)\)/);
  assert.match(routes, /router\.post\("\/push\/subscribe", rateLimit\(\{ windowMs: 60_000, max: 10 \}\), asyncHandler\(subscribeToPush\)\)/);
  assert.match(routes, /router\.post\("\/push\/unsubscribe", rateLimit\(\{ windowMs: 60_000, max: 10 \}\), asyncHandler\(unsubscribeFromPush\)\)/);
});

test("PWA: manifest, service worker, and icons exist for the client portal", async () => {
  const [manifest, sw, html, main] = await Promise.all([
    read("../frontend/public/manifest.webmanifest"),
    read("../frontend/public/sw.js"),
    read("../frontend/index.html"),
    read("../frontend/src/main.jsx"),
  ]);
  const manifestJson = JSON.parse(manifest);
  assert.equal(manifestJson.start_url, "/client-portal");
  assert.equal(manifestJson.display, "standalone");
  assert.ok(manifestJson.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifestJson.icons.some((icon) => icon.sizes === "512x512"));

  assert.match(sw, /self\.addEventListener\("push", \(event\) => \{/);
  assert.match(sw, /self\.registration\.showNotification\(title, options\)/);
  assert.match(sw, /self\.addEventListener\("notificationclick", \(event\) => \{/);

  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
  assert.match(html, /<meta name="theme-color" content="#313d54" \/>/);
  assert.match(main, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
});

test("install prompt: Android gets a real beforeinstallprompt trigger, iOS gets manual instructions, and push only offers once installed", async () => {
  const [prompt, layout, settingsPanel, settingsPage] = await Promise.all([
    read("../frontend/src/components/client-portal/InstallAppPrompt.jsx"),
    read("../frontend/src/components/client-portal/ClientPortalLayout.jsx"),
    read("../frontend/src/components/client-portal/PortalNotificationsSettingsPanel.jsx"),
    read("../frontend/src/pages/client-portal/ClientPortalAccountSettings.jsx"),
  ]);

  // Android/Chrome: a real, capturable native prompt.
  assert.match(prompt, /window\.addEventListener\("beforeinstallprompt", onBeforeInstallPrompt\)/);
  assert.match(prompt, /await deferredPrompt\.prompt\(\)/);
  // iOS: Safari exposes no such event — the only thing that can be shown
  // is manual instructions, never a programmatic trigger.
  assert.match(prompt, /function isIos\(\)/);
  assert.doesNotMatch(prompt, /iOS[\s\S]{0,80}\.prompt\(\)/);
  assert.match(prompt, /Add to Home Screen/);
  // Notifications require the site to already be running installed
  // (standalone) — this is an iOS platform rule, not a UX choice, and the
  // banner's own gating (`needsNotifications = installed && ...`) is what
  // enforces the ordering.
  assert.match(prompt, /const needsNotifications = installed && pushConfigured && notificationPermission === "default";/);
  assert.match(prompt, /function isStandalone\(\)/);
  assert.match(prompt, /navigator\.standalone === true/);

  assert.match(layout, /<InstallAppPrompt \/>/);
  assert.match(settingsPage, /<PortalNotificationsSettingsPanel \/>/);
  assert.match(settingsPanel, /disabled=\{busy \|\| permission === "denied"\}/); // no way to reprompt once the browser itself blocked it
});
