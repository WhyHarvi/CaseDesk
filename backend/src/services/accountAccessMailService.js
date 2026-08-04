import prisma from "./prisma/client.js";
import { createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";

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

// Sent by staff (directly, or via an admin-triggered invite/reset) — a
// delivery path that doesn't depend on Supabase's own invite-email sending
// (which has a much stricter, separate rate limit from the agency's own
// connected mailbox and can silently fail). generateAuthLink() only ever
// returns a link; nothing is emailed unless this function does it, via the
// agency's own mail config.
export async function sendAccountAccessEmail({ agencyId, email, fullName, actionLink, kind, audience = "client" }) {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true, legalName: true, phone: true, email: true } });
  const agencyName = agency?.legalName || agency?.name || "CaseDesk";
  const contactName = fullName || "there";
  const copy = COPY[audience]?.[kind] || COPY.client[kind];
  const subject = copy.subject(agencyName);
  const intro = copy.intro;
  const buttonLabel = kind === "onboarding" ? "Set up my account" : "Reset my password";
  const agencyContact = [agency?.phone, agency?.email].filter(Boolean).join(" · ");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f1f5f9"><tr><td align="center" style="padding:38px 14px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:28px;overflow:hidden;box-shadow:0 18px 55px rgba(15,23,42,.09)">
      <tr><td style="padding:24px 34px;background:#0f172a"><p style="margin:0;color:#ffffff;font-size:18px;font-weight:750;letter-spacing:-.01em">${escapeHtml(agencyName)}</p></td></tr>
      <tr><td style="padding:36px 34px 10px">
        <h1 style="margin:0;color:#0f172a;font-size:24px;line-height:1.3;letter-spacing:-.03em;font-weight:750">${escapeHtml(subject)}</h1>
        <p style="margin:14px 0 0;color:#475569;font-size:16px;line-height:1.65">Hi ${escapeHtml(contactName)},<br>${escapeHtml(intro)}</p>
      </td></tr>
      <tr><td style="padding:18px 34px 0"><a href="${escapeHtml(actionLink)}" style="display:inline-block;border-radius:999px;background:#0f172a;color:#ffffff;text-decoration:none;padding:14px 22px;font-size:14px;font-weight:750">${escapeHtml(buttonLabel)} &nbsp;→</a></td></tr>
      <tr><td style="padding:28px 34px 34px"><p style="margin:0;color:#64748b;font-size:13px;line-height:1.6">If you weren't expecting this, you can safely ignore it.</p></td></tr>
      <tr><td style="padding:23px 34px;background:#f8fafc;border-top:1px solid #e2e8f0"><p style="margin:0;color:#334155;font-size:13px;font-weight:700">${escapeHtml(agencyName)}</p>${agencyContact ? `<p style="margin:6px 0 0;color:#64748b;font-size:12px;line-height:1.5">${escapeHtml(agencyContact)}</p>` : ""}</td></tr>
    </table>
    <p style="margin:18px 0 0;color:#94a3b8;font-size:11px">Sent securely by CaseDesk</p>
  </td></tr></table>
</body></html>`;

  const text = [subject, "", `Hi ${contactName},`, intro, "", actionLink, "", agencyName, agencyContact || null].filter(Boolean).join("\n");

  const config = await resolveAgencyMailConfig(agencyId);
  const transport = createMailTransport(config);
  await transport.sendMail({ from: config.from, to: email, subject, text, html });
}
