import prisma from "./prisma/client.js";
import { createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";
import { logger } from "./logger.js";
import { AVATAR_BUCKET, downloadStorageFile } from "./supabaseStorage.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const COPY = {
  client: {
    onboarding: {
      subject: (agencyName) => `Set up your ${agencyName} client portal account`,
      intro: "You've been invited to the client portal, where you can track your case, upload documents, and see your payments.",
    },
    reset: {
      subject: (agencyName) => `Reset your ${agencyName} client portal password`,
      intro: "Use the link below to set a new password for your client portal account.",
    },
    retainer: {
      subject: (agencyName) => `Sign your retainer agreement — ${agencyName}`,
      intro: "Your consultation is booked. Please review and sign your retainer agreement to secure your appointment.",
    },
    temporaryPassword: {
      subject: (agencyName) => `Your ${agencyName} client portal access`,
      intro: "A staff member set up direct access to your client portal. Sign in with the temporary password below, then change it anytime from your account.",
    },
  },
  staff: {
    onboarding: {
      subject: (agencyName) => `Set up your CaseDesk account for ${agencyName}`,
      intro: "You've been invited to join your team's CaseDesk workspace.",
    },
    reset: {
      subject: () => "Reset your CaseDesk password",
      intro: "Use the link below to set a new password for your CaseDesk account.",
    },
  },
};

function safeWebUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value));
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function senderAddress(from) {
  if (from && typeof from === "object") return String(from.address || "").trim();
  const value = String(from || "").trim();
  return value.match(/<([^>]+)>/)?.[1]?.trim() || value;
}

function initials(value) {
  return String(value || "CaseDesk")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "CD";
}

export function accountAccessEmailContent({
  agency,
  fullName,
  actionLink,
  password,
  loginUrl,
  kind,
  audience = "client",
  supportEmail,
  brandImageUrl = null,
}) {
  const agencyName = agency?.legalName || agency?.name || "CaseDesk";
  const contactName = fullName || "there";
  const copy = COPY[audience]?.[kind] || COPY.client[kind];
  const subject = copy.subject(agencyName);
  const isTemporaryPassword = kind === "temporaryPassword";
  const buttonLabel = kind === "onboarding" ? "Set up my account" : kind === "retainer" ? "Review and sign" : isTemporaryPassword ? "Sign in" : "Reset my password";
  const phone = String(agency?.phone || "").trim();
  const email = String(supportEmail || agency?.email || "").trim();
  const phoneHref = phone.replace(/[^\d+]/g, "");
  const brandMark = brandImageUrl
    ? `<img src="${escapeHtml(brandImageUrl)}" width="48" height="48" alt="${escapeHtml(agencyName)}" style="display:block;width:48px;height:48px;border-radius:50%;background:#ffffff;object-fit:cover">`
    : `<span style="display:inline-flex;width:48px;height:48px;border-radius:50%;align-items:center;justify-content:center;background:#ffffff;color:#0f172a;font-size:15px;font-weight:800">${escapeHtml(initials(agencyName))}</span>`;
  const helpItems = [
    phone ? `<a href="tel:${escapeHtml(phoneHref)}" style="color:#334155;text-decoration:none">${escapeHtml(phone)}</a>` : null,
    email ? `<a href="mailto:${escapeHtml(email)}" style="color:#334155;text-decoration:none">${escapeHtml(email)}</a>` : null,
  ].filter(Boolean);
  const helpHtml = helpItems.length
    ? `<p style="margin:8px 0 0;color:#64748b;font-size:12px;line-height:1.6">Need help? ${helpItems.join(" &nbsp;·&nbsp; ")}</p>`
    : "";
  // A temporary password isn't a one-time link — it's a credential that sits
  // in this inbox until the client signs in and changes it. Shown as a
  // monospace block instead of the usual click-through button, with a
  // matching disclaimer (no "use this link only once" line, since there is
  // no link).
  const bodyHtml = isTemporaryPassword
    ? `<tr><td style="padding:18px 34px 0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px"><tr><td style="padding:16px 20px"><p style="margin:0 0 6px;color:#64748b;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Temporary password</p><p style="margin:0;color:#0f172a;font-size:20px;font-weight:750;letter-spacing:.04em;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">${escapeHtml(password)}</p></td></tr></table></td></tr>
      <tr><td style="padding:18px 34px 0"><a href="${escapeHtml(loginUrl)}" style="display:inline-block;border-radius:999px;background:#0f172a;color:#ffffff;text-decoration:none;padding:14px 22px;font-size:14px;font-weight:750">${escapeHtml(buttonLabel)} &nbsp;→</a></td></tr>
      <tr><td style="padding:28px 34px 34px"><p style="margin:0;color:#64748b;font-size:13px;line-height:1.6">You can change this password anytime once you're signed in. If you did not request this message, contact your case team.</p></td></tr>`
    : `<tr><td style="padding:18px 34px 0"><a href="${escapeHtml(actionLink)}" style="display:inline-block;border-radius:999px;background:#0f172a;color:#ffffff;text-decoration:none;padding:14px 22px;font-size:14px;font-weight:750">${escapeHtml(buttonLabel)} &nbsp;→</a></td></tr>
      <tr><td style="padding:28px 34px 34px"><p style="margin:0;color:#64748b;font-size:13px;line-height:1.6">For your security, use this link only once. If you did not request this message, you can safely ignore it.</p></td></tr>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f1f5f9"><tr><td align="center" style="padding:38px 14px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:28px;overflow:hidden;box-shadow:0 18px 55px rgba(15,23,42,.09)">
      <tr><td style="padding:23px 34px;background:#0f172a"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-right:14px">${brandMark}</td><td><p style="margin:0;color:#94a3b8;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">Secure account access</p><p style="margin:5px 0 0;color:#ffffff;font-size:18px;font-weight:750;letter-spacing:-.01em">${escapeHtml(agencyName)}</p></td></tr></table></td></tr>
      <tr><td style="padding:36px 34px 10px">
        <h1 style="margin:0;color:#0f172a;font-size:24px;line-height:1.3;letter-spacing:-.03em;font-weight:750">${escapeHtml(subject)}</h1>
        <p style="margin:14px 0 0;color:#475569;font-size:16px;line-height:1.65">Hi ${escapeHtml(contactName)},<br>${escapeHtml(copy.intro)}</p>
      </td></tr>
      ${bodyHtml}
      <tr><td style="padding:23px 34px;background:#f8fafc;border-top:1px solid #e2e8f0"><p style="margin:0;color:#334155;font-size:13px;font-weight:700">${escapeHtml(agencyName)}</p>${helpHtml}</td></tr>
    </table>
    <p style="margin:18px 0 0;color:#94a3b8;font-size:11px">Sent securely by CaseDesk</p>
  </td></tr></table>
</body></html>`;

  const agencyContact = [phone, email].filter(Boolean).join(" · ");
  const text = isTemporaryPassword
    ? [
        subject,
        "",
        `Hi ${contactName},`,
        copy.intro,
        "",
        `Temporary password: ${password}`,
        loginUrl,
        "",
        "You can change this password anytime once you're signed in. If you did not request this message, contact your case team.",
        "",
        agencyName,
        agencyContact || null,
      ].filter((line) => line !== null).join("\n")
    : [
        subject,
        "",
        `Hi ${contactName},`,
        copy.intro,
        "",
        actionLink,
        "",
        "For your security, use this link only once. If you did not request this message, you can safely ignore it.",
        "",
        agencyName,
        agencyContact || null,
      ].filter((line) => line !== null).join("\n");

  return { subject, html, text };
}

// Sent by staff (directly, or via an admin-triggered invite/reset) — a
// delivery path that doesn't depend on Supabase's own invite-email sending
// (which has a much stricter, separate rate limit from the agency's own
// connected mailbox and can silently fail). generateAuthLink() only ever
// returns a link; nothing is emailed unless this function does it, via the
// agency's own mail config.
export async function sendAccountAccessEmail({ agencyId, email, fullName, actionLink, password, loginUrl, kind, audience = "client" }) {
  const [agency, config] = await Promise.all([
    prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true, legalName: true, phone: true, email: true, logoUrl: true, avatarStorageKey: true, avatarMimeType: true } }),
    resolveAgencyMailConfig(agencyId),
  ]);
  let avatarBuffer = null;
  if (agency?.avatarStorageKey) {
    try {
      const downloaded = await downloadStorageFile(AVATAR_BUCKET, agency.avatarStorageKey, { allowMissing: true });
      // Keep enough headroom below Microsoft Graph's small-attachment limit.
      if (downloaded?.length && downloaded.length <= 2 * 1024 * 1024) avatarBuffer = downloaded;
      else if (downloaded?.length) logger.warn("account_access.avatar_too_large", { agencyId, bytes: downloaded.length });
    } catch (error) {
      logger.warn("account_access.avatar_unavailable", { agencyId, reason: error.message });
    }
  }
  const avatarCid = avatarBuffer ? `workspace-avatar-account-access-${agencyId}@casedesk` : null;
  const content = accountAccessEmailContent({
    agency,
    fullName,
    actionLink,
    password,
    loginUrl,
    kind,
    audience,
    supportEmail: senderAddress(config.from) || agency?.email,
    brandImageUrl: avatarCid ? `cid:${avatarCid}` : safeWebUrl(agency?.logoUrl),
  });
  const transport = createMailTransport(config);
  return transport.sendMail({
    from: config.from,
    to: email,
    subject: content.subject,
    text: content.text,
    html: content.html,
    attachments: avatarBuffer ? [{
      filename: `workspace-avatar.${agency.avatarMimeType === "image/jpeg" ? "jpg" : agency.avatarMimeType === "image/webp" ? "webp" : "png"}`,
      content: avatarBuffer,
      contentType: agency.avatarMimeType || "image/png",
      cid: avatarCid,
      contentDisposition: "inline",
    }] : [],
  });
}
