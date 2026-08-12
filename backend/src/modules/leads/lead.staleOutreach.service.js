import prisma from "../../services/prisma/client.js";
import { createMailTransport, resolveAgencyMailConfig } from "../../services/agencyMailService.js";
import { sendAgencyOomaSms } from "../../services/agencyOomaService.js";
import { publicBookingPageUrl } from "../../services/bookingPublicLinkService.js";
import { logger } from "../../services/logger.js";

const OUTREACH_KIND = "stale_outreach";
const FINAL_DELIVERY_STATUSES = new Set(["sent", "skipped"]);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function publicAgencyLogoUrl(agency) {
  if (!agency?.avatarStorageKey) return null;
  const base = String(process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, "");
  return `${base}/api/public/agency/${agency.id}/logo`;
}

export function staleLeadCutoff(days, now = new Date()) {
  return new Date(now.getTime() - Math.max(Number(days) || 14, 1) * 86_400_000);
}

export function staleLeadWhere(settings, now = new Date()) {
  const cutoff = staleLeadCutoff(settings?.staleOutreachDays, now);
  const availableChannels = [];
  if (settings?.staleOutreachEmailEnabled) availableChannels.push({ email: { not: null } });
  if (settings?.staleOutreachSmsEnabled) availableChannels.push({ phone: { not: null } });
  return {
    agencyId: settings.agencyId,
    deletedAt: null,
    status: "OPEN",
    stage: { in: ["NEW", "ASSIGNED", "CONTACTING", "CONNECTED", "QUALIFIED"] },
    pipelineSegment: "STANDARD",
    consentGiven: true,
    OR: [
      { lastContactAt: { lte: cutoff } },
      { lastContactAt: null, inquiryDate: { lte: cutoff } },
    ],
    ...(availableChannels.length ? { AND: [{ OR: availableChannels }, { OR: [{ nextActionAt: null }, { nextActionAt: { lte: now } }] }] } : { id: "__no_enabled_outreach_channel__" }),
    followUps: { none: { status: "PENDING", dueAt: { gt: now } } },
    consultations: { none: { status: { in: ["SCHEDULED", "CONFIRMED"] }, startAt: { gt: now } } },
    messageDeliveries: { none: { kind: OUTREACH_KIND } },
  };
}

export function staleOutreachContent({ agencyName, firstName, bookingUrl }) {
  const greeting = firstName || "there";
  const subject = `A quick check-in from ${agencyName}`;
  const sms = `Hi ${greeting}, this is ${agencyName}. Our team is currently managing a high volume of active files. If you still need immigration support, the quickest way to receive dedicated guidance is to book a consultation: ${bookingUrl} If you have already made arrangements, no action is needed.`;
  const text = [
    `Hi ${greeting},`,
    "",
    "We wanted to check in regarding your immigration inquiry.",
    "",
    "Our team is currently managing a high volume of active files. If you still need support, the quickest way to receive dedicated time and guidance from our team is to book a consultation using the link below:",
    "",
    bookingUrl,
    "",
    "If you have already made other arrangements or no longer require assistance, no action is needed.",
    "",
    "Warm regards,",
    agencyName,
  ].join("\n");
  return { greeting, subject, sms, text };
}

function staleOutreachHtml({ agencyName, content, bookingUrl, agency, logoUrl }) {
  const brand = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="48" height="48" alt="${escapeHtml(agencyName)}" style="display:block;width:48px;height:48px;border-radius:50%;object-fit:cover;background:#fff">`
    : `<div style="width:48px;height:48px;border-radius:50%;background:#0f172a;color:#fff;line-height:48px;text-align:center;font-size:18px;font-weight:750">${escapeHtml(agencyName.slice(0, 1))}</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f1f5f9"><tr><td align="center" style="padding:38px 14px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:570px;background:#fff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden">
<tr><td style="padding:30px 34px 14px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="padding-right:14px">${brand}</td><td><p style="margin:0;color:#0f172a;font-size:15px;font-weight:750">${escapeHtml(agencyName)}</p><p style="margin:5px 0 0;color:#64748b;font-size:12px">Immigration support</p></td></tr></table></td></tr>
<tr><td style="padding:10px 34px 34px"><h1 style="margin:0;color:#0f172a;font-size:24px;line-height:1.3;letter-spacing:-.02em">A quick check-in</h1><p style="margin:16px 0 0;color:#475569;font-size:15px;line-height:1.7">Hi ${escapeHtml(content.greeting)},</p><p style="margin:12px 0 0;color:#475569;font-size:15px;line-height:1.7">We wanted to check in regarding your immigration inquiry.</p><p style="margin:12px 0 0;color:#475569;font-size:15px;line-height:1.7">Our team is currently managing a high volume of active files. If you still need support, the quickest way to receive dedicated time and guidance from our team is to book a consultation.</p><a href="${escapeHtml(bookingUrl)}" style="display:inline-block;margin-top:22px;border-radius:999px;background:#0f172a;color:#fff;text-decoration:none;padding:14px 23px;font-size:14px;font-weight:750">Book a consultation &nbsp;→</a><p style="margin:22px 0 0;color:#64748b;font-size:13px;line-height:1.6">If you have already made other arrangements or no longer require assistance, no action is needed.</p></td></tr>
<tr><td style="padding:18px 34px;background:#f8fafc;border-top:1px solid #e2e8f0"><p style="margin:0;color:#334155;font-size:13px;font-weight:700">${escapeHtml(agencyName)}</p>${agency?.phone || agency?.email ? `<p style="margin:6px 0 0;color:#64748b;font-size:12px">${escapeHtml([agency.phone, agency.email].filter(Boolean).join(" · "))}</p>` : ""}</td></tr>
</table></td></tr></table></body></html>`;
}

async function prepareDeliveries(db, settings, lead, content) {
  const channels = [];
  if (settings.staleOutreachEmailEnabled && lead.email) channels.push({ channel: "email", recipient: lead.email, subject: content.subject, body: content.text });
  if (settings.staleOutreachSmsEnabled && lead.phone) channels.push({ channel: "sms", recipient: lead.phone, subject: null, body: content.sms });
  return Promise.all(channels.map(({ channel, recipient, subject, body }) => db.leadMessageDelivery.upsert({
    where: { agencyId_dedupeKey: { agencyId: lead.agencyId, dedupeKey: `lead-stale-outreach:${lead.id}:${channel}` } },
    create: {
      agencyId: lead.agencyId,
      leadId: lead.id,
      kind: OUTREACH_KIND,
      channel,
      recipient,
      status: "pending",
      dedupeKey: `lead-stale-outreach:${lead.id}:${channel}`,
      subject,
      body,
      sourceChannel: "AUTOMATED_STALE_LEAD",
      payload: { automated: true, staleAfterDays: settings.staleOutreachDays },
    },
    update: {},
  })));
}

async function deliverPrepared({ db, delivery, lead, agency, content, bookingUrl, sendSms, resolveMailConfig, makeMailTransport }) {
  if (FINAL_DELIVERY_STATUSES.has(delivery.status) || delivery.status === "sending") return delivery;
  const claimed = await db.leadMessageDelivery.updateMany({
    where: { id: delivery.id, status: delivery.status },
    data: { status: "sending", attempts: { increment: 1 }, lastError: null },
  });
  if (!claimed.count) return delivery;
  try {
    let provider;
    let providerId = null;
    if (delivery.channel === "sms") {
      const result = await sendSms({ agencyId: lead.agencyId, to: delivery.recipient, body: content.sms, idempotencyKey: delivery.dedupeKey });
      provider = result?.provider || "Ooma";
      providerId = result?.id ? String(result.id) : null;
    } else {
      const config = await resolveMailConfig(lead.agencyId);
      const transport = makeMailTransport(config);
      const result = await transport.sendMail({
        from: config.from,
        to: delivery.recipient,
        subject: content.subject,
        text: content.text,
        html: staleOutreachHtml({ agencyName: agency.legalName || agency.name, content, bookingUrl, agency, logoUrl: publicAgencyLogoUrl(agency) }),
      });
      provider = "Agency email";
      providerId = result?.messageId ? String(result.messageId) : null;
    }
    const sentAt = new Date();
    const sent = await db.leadMessageDelivery.update({ where: { id: delivery.id }, data: { status: "sent", sentAt, failedAt: null, provider, providerId, lastError: null } });
    try {
      await db.$transaction(async (tx) => {
        await tx.leadActivity.create({ data: { agencyId: lead.agencyId, leadId: lead.id, activityType: delivery.channel === "email" ? "EMAIL_SENT" : "SMS_SENT", direction: "OUTBOUND", channel: delivery.channel === "email" ? "EMAIL" : "SMS", title: "Automated consultation check-in sent", description: delivery.body, externalId: delivery.id, metadata: { deliveryId: delivery.id, automated: true, kind: OUTREACH_KIND } } });
        await tx.lead.updateMany({ where: { id: lead.id, firstContactAt: null }, data: { firstContactAt: sentAt } });
        await tx.lead.update({ where: { id: lead.id }, data: { lastContactAt: sentAt, version: { increment: 1 } } });
      });
    } catch (auditError) {
      // Provider acceptance is the source of truth. Keep the delivery sent so
      // an activity-log failure can never cause a duplicate email or SMS.
      logger.warn("lead.stale_outreach_audit_failed", { agencyId: lead.agencyId, leadId: lead.id, deliveryId: delivery.id, reason: auditError.message });
    }
    return sent;
  } catch (error) {
    const failed = await db.leadMessageDelivery.update({ where: { id: delivery.id }, data: { status: "failed", failedAt: new Date(), lastError: String(error?.message || "Outreach delivery failed").slice(0, 1000) } });
    logger.warn("lead.stale_outreach_delivery_failed", { agencyId: lead.agencyId, leadId: lead.id, channel: delivery.channel, reason: error.message });
    return failed;
  }
}

export async function sendStaleLeadOutreach(settings, lead, dependencies = {}) {
  const db = dependencies.db || prisma;
  const now = dependencies.now || new Date();
  const sendSms = dependencies.sendSms || sendAgencyOomaSms;
  const resolveMailConfig = dependencies.resolveMailConfig || resolveAgencyMailConfig;
  const makeMailTransport = dependencies.makeMailTransport || createMailTransport;
  const stillEligible = await db.lead.findFirst({ where: { ...staleLeadWhere(settings, now), id: lead.id }, select: { id: true } });
  if (!stillEligible) return { sent: 0, failed: 0, skipped: 1 };
  const [agency, bookingSettings] = await Promise.all([
    db.agency.findUnique({ where: { id: lead.agencyId }, select: { id: true, name: true, legalName: true, phone: true, email: true, avatarStorageKey: true } }),
    db.bookingSettings.findUnique({ where: { agencyId: lead.agencyId } }),
  ]);
  const bookingUrl = bookingSettings ? publicBookingPageUrl(bookingSettings) : null;
  const agencyName = agency?.legalName || agency?.name || "Our team";
  const content = staleOutreachContent({ agencyName, firstName: lead.firstName, bookingUrl: bookingUrl || "Booking link unavailable" });
  const deliveries = await prepareDeliveries(db, settings, lead, content);
  if (!agency || !bookingUrl) {
    const reason = !agency ? "The agency profile is unavailable." : "Public booking settings are unavailable, so a consultation link could not be generated.";
    await Promise.all(deliveries.filter((delivery) => delivery.status === "pending").map((delivery) => db.leadMessageDelivery.update({ where: { id: delivery.id }, data: { status: "skipped", lastError: reason } })));
    return { sent: 0, failed: 0, skipped: deliveries.length || 1 };
  }
  const results = [];
  for (const delivery of deliveries) results.push(await deliverPrepared({ db, delivery, lead, agency, content, bookingUrl, sendSms, resolveMailConfig, makeMailTransport }));
  return {
    sent: results.filter((item) => item?.status === "sent").length,
    failed: results.filter((item) => item?.status === "failed").length,
    skipped: results.filter((item) => item?.status === "skipped").length,
  };
}

async function resumePendingStaleOutreach(db, now, agencyId = null) {
  await db.leadMessageDelivery.updateMany({
    where: { ...(agencyId ? { agencyId } : {}), kind: OUTREACH_KIND, status: "sending", updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
    data: { status: "pending", lastError: "Recovered after an interrupted outreach delivery." },
  });
  const pending = await db.leadMessageDelivery.findMany({
    where: { ...(agencyId ? { agencyId } : {}), kind: OUTREACH_KIND, OR: [{ status: "pending" }, { status: "failed", attempts: { lt: 3 } }] },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { lead: true },
  });
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const delivery of pending) {
    const lead = delivery.lead;
    const settings = await db.leadSettings.findUnique({ where: { agencyId: delivery.agencyId } });
    const liveLead = settings?.staleOutreachEnabled && lead ? await db.lead.findFirst({
      where: {
        id: lead.id,
        agencyId: delivery.agencyId,
        deletedAt: null,
        status: "OPEN",
        stage: { in: ["NEW", "ASSIGNED", "CONTACTING", "CONNECTED", "QUALIFIED"] },
        pipelineSegment: "STANDARD",
        consentGiven: true,
        OR: [{ nextActionAt: null }, { nextActionAt: { lte: now } }],
        followUps: { none: { status: "PENDING", dueAt: { gt: now } } },
        consultations: { none: { status: { in: ["SCHEDULED", "CONFIRMED"] }, startAt: { gt: now } } },
      },
      select: { id: true },
    }) : null;
    if (!liveLead) {
      await db.leadMessageDelivery.update({ where: { id: delivery.id }, data: { status: "skipped", lastError: "The lead became ineligible before delivery." } });
      skipped += 1;
      continue;
    }
    const [agency, bookingSettings] = await Promise.all([
      db.agency.findUnique({ where: { id: delivery.agencyId }, select: { id: true, name: true, legalName: true, phone: true, email: true, avatarStorageKey: true } }),
      db.bookingSettings.findUnique({ where: { agencyId: delivery.agencyId } }),
    ]);
    const bookingUrl = bookingSettings ? publicBookingPageUrl(bookingSettings) : null;
    if (!agency || !bookingUrl) {
      await db.leadMessageDelivery.update({ where: { id: delivery.id }, data: { status: "skipped", lastError: "The agency profile or public booking link is unavailable." } });
      skipped += 1;
      continue;
    }
    const generated = staleOutreachContent({ agencyName: agency.legalName || agency.name || "Our team", firstName: lead.firstName, bookingUrl });
    const content = { ...generated, subject: delivery.subject || generated.subject, text: delivery.channel === "email" ? delivery.body || generated.text : generated.text, sms: delivery.channel === "sms" ? delivery.body || generated.sms : generated.sms };
    const result = await deliverPrepared({ db, delivery, lead, agency, content, bookingUrl, sendSms: sendAgencyOomaSms, resolveMailConfig: resolveAgencyMailConfig, makeMailTransport: createMailTransport });
    if (result?.status === "sent") sent += 1;
    else if (result?.status === "failed") failed += 1;
    else skipped += 1;
  }
  return { sent, failed, skipped };
}

export async function runStaleLeadOutreachPass(db = prisma, now = new Date()) {
  const resumed = await resumePendingStaleOutreach(db, now);
  const settingsRows = await db.leadSettings.findMany({ where: { staleOutreachEnabled: true }, take: 100 });
  const totals = { agencies: settingsRows.length, leads: 0, ...resumed };
  for (const settings of settingsRows) {
    const result = await runStaleLeadOutreachForAgency(settings.agencyId, db, now, settings);
    totals.leads += result.leads;
    totals.sent += result.sent;
    totals.failed += result.failed;
    totals.skipped += result.skipped;
  }
  return totals;
}

export async function runStaleLeadOutreachForAgency(agencyId, db = prisma, now = new Date(), knownSettings = null) {
  const settings = knownSettings || await db.leadSettings.findUnique({ where: { agencyId } });
  if (!settings?.staleOutreachEnabled) return { agencies: 0, leads: 0, sent: 0, failed: 0, skipped: 0 };
  const resumed = knownSettings ? { sent: 0, failed: 0, skipped: 0 } : await resumePendingStaleOutreach(db, now, agencyId);
  const leads = await db.lead.findMany({ where: staleLeadWhere(settings, now), orderBy: [{ lastContactAt: "asc" }, { inquiryDate: "asc" }], take: 100 });
  const totals = { agencies: 1, leads: 0, ...resumed };
  for (const lead of leads) {
    const result = await sendStaleLeadOutreach(settings, lead, { db, now });
    totals.leads += 1;
    totals.sent += result.sent;
    totals.failed += result.failed;
    totals.skipped += result.skipped;
  }
  await db.leadSettings.update({ where: { id: settings.id }, data: { staleOutreachLastRunAt: now } });
  return totals;
}

const requestedAgencyRuns = new Set();

export function requestStaleLeadOutreachForAgency(agencyId) {
  if (requestedAgencyRuns.has(agencyId)) return false;
  requestedAgencyRuns.add(agencyId);
  void runStaleLeadOutreachForAgency(agencyId)
    .then((result) => logger.info("lead.stale_outreach_manual_run_completed", { agencyId, ...result }))
    .catch((error) => logger.warn("lead.stale_outreach_manual_run_failed", { agencyId, reason: error.message }))
    .finally(() => requestedAgencyRuns.delete(agencyId));
  return true;
}

export async function staleLeadOutreachOverview(agencyId, db = prisma, now = new Date()) {
  const settings = await db.leadSettings.findUnique({ where: { agencyId } }) || {
    agencyId,
    welcomeEmailEnabled: true,
    staleOutreachEnabled: false,
    staleOutreachDays: 14,
    staleOutreachEmailEnabled: true,
    staleOutreachSmsEnabled: true,
    staleOutreachLastRunAt: null,
  };
  const [eligible, grouped, recent] = await Promise.all([
    db.lead.count({ where: staleLeadWhere(settings, now) }),
    db.leadMessageDelivery.groupBy({ by: ["status"], where: { agencyId, kind: OUTREACH_KIND }, _count: { _all: true } }),
    db.leadMessageDelivery.findMany({
      where: { agencyId, kind: OUTREACH_KIND },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, leadId: true, channel: true, recipient: true, status: true, sentAt: true, failedAt: true, lastError: true, createdAt: true, lead: { select: { leadNumber: true, firstName: true, lastName: true } } },
    }),
  ]);
  return { eligible, counts: Object.fromEntries(grouped.map((item) => [item.status, item._count._all])), recent, settings };
}
