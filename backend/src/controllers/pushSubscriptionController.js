import { pushEnabled, removeSubscription, saveSubscription } from "../services/webPushService.js";
import { createHttpError } from "../utils/http.js";

export async function subscribeToPush(req, res) {
  if (!pushEnabled()) throw createHttpError(503, "Push notifications are not configured.", "PUSH_NOT_CONFIGURED");
  const subscription = await saveSubscription(
    req.auth.agencyId,
    req.auth.userId,
    req.body?.subscription,
    req.header("user-agent"),
  );
  res.json({ success: true, data: { id: subscription.id } });
}

export async function unsubscribeFromPush(req, res) {
  await removeSubscription(req.auth.userId, req.body?.endpoint);
  res.json({ success: true });
}
