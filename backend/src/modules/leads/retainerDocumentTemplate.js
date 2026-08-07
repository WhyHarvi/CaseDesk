// The retainer's own document design — deliberately separate from
// clientPortalController.js's generic agreementDocumentHtml() (used for
// every other letter/agreement in the correspondence system). A retainer is
// the one document type auto-issued with no staff drafting step, so instead
// of relying on staff-editable {{placeholder}} template content, the whole
// letterhead/body/terms are generated here from real data.

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function monogram(name) {
  return String(name || "CD").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "CD";
}

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CAD`;
}

const STYLE = `
  .retainer { --paper: #fbfaf5; --ink: #1b1e24; --ink-soft: #565f6c; --ink-faint: #8b8f7c; --line: #ddd7c4; --accent: #1e3a5c; --accent-deep: #142943; --accent-soft: #e9eef3; --accent-soft-line: #c9d6e2;
    font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif; color: var(--ink); background: var(--paper);
    max-width: 800px; margin: 0 auto; padding: clamp(1.75rem, 5vw, 3.5rem) clamp(1.25rem, 5vw, 3rem); box-sizing: border-box; }
  .retainer * { box-sizing: border-box; }
  .retainer .letterhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 1.25rem; padding-bottom: 1.25rem; border-bottom: 2px solid var(--accent); flex-wrap: wrap; }
  .retainer .brand { display: flex; align-items: center; gap: 0.85rem; }
  .retainer .mark { width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(155deg, var(--accent) 0%, var(--accent-deep) 100%); color: #f3f6f9; display: flex; align-items: center; justify-content: center; font-family: -apple-system,Helvetica,Arial,sans-serif; font-weight: 800; font-size: 0.92rem; flex-shrink: 0; overflow: hidden; }
  .retainer .mark img { width: 100%; height: 100%; object-fit: cover; }
  .retainer .brand-name { font-family: -apple-system,Helvetica,Arial,sans-serif; font-size: 1rem; font-weight: 800; letter-spacing: -0.01em; line-height: 1.25; }
  .retainer .brand-tag { font-family: -apple-system,Helvetica,Arial,sans-serif; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase; color: var(--accent); margin-top: 0.15rem; }
  .retainer .letterhead-contact { text-align: right; font-family: -apple-system,Helvetica,Arial,sans-serif; font-size: 0.74rem; line-height: 1.6; color: var(--ink-soft); }
  .retainer .doc-meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.9rem; margin-top: 1.4rem; font-family: -apple-system,Helvetica,Arial,sans-serif; font-size: 0.72rem; color: var(--ink-soft); }
  .retainer .doc-meta .k { display: block; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-faint); font-size: 0.64rem; margin-bottom: 0.2rem; }
  .retainer .doc-meta .v { color: var(--ink); font-weight: 600; }
  .retainer .title-block { text-align: center; margin: 2.1rem 0 1.75rem; }
  .retainer .title-block .kicker { font-family: -apple-system,Helvetica,Arial,sans-serif; font-size: 0.68rem; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent); }
  .retainer .title-block h1 { margin: 0.5rem 0 0; font-size: clamp(1.35rem, 3vw, 1.7rem); font-weight: 400; }
  .retainer .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; margin: 1.75rem 0; padding: 1.2rem 1.35rem; background: var(--accent-soft); border: 1px solid var(--accent-soft-line); border-radius: 8px; }
  .retainer .parties .k { font-family: -apple-system,Helvetica,Arial,sans-serif; font-size: 0.64rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }
  .retainer .parties .name { margin-top: 0.3rem; font-size: 1rem; }
  .retainer .parties .meta { margin-top: 0.2rem; font-family: -apple-system,Helvetica,Arial,sans-serif; font-size: 0.75rem; color: var(--ink-soft); line-height: 1.6; }
  .retainer p.body-p { line-height: 1.75; font-size: 0.96rem; margin: 0 0 1rem; }
  .retainer h2.section { font-family: -apple-system,Helvetica,Arial,sans-serif; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); margin: 1.85rem 0 0.7rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--line); }
  .retainer .fee-line { display: flex; justify-content: space-between; padding: 0.6rem 0; border-bottom: 1px solid var(--line); font-size: 0.94rem; }
  .retainer .fee-line .amt { font-variant-numeric: tabular-nums; font-weight: 700; }
  .retainer .regulator { margin-top: 1.4rem; padding: 0.95rem 1.15rem; border-left: 3px solid var(--accent); background: var(--accent-soft); font-family: -apple-system,Helvetica,Arial,sans-serif; font-size: 0.8rem; line-height: 1.65; color: var(--ink-soft); }
  .retainer .effective-note { margin-top: 2rem; font-size: 0.94rem; font-style: italic; color: var(--ink-soft); }
  .retainer .doc-footer { margin-top: 2.25rem; padding-top: 0.9rem; border-top: 1px solid var(--line); font-family: -apple-system,Helvetica,Arial,sans-serif; font-size: 0.68rem; color: var(--ink-faint); display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
`;

// data: { agency, agencyLogoDataUri, consultant, client, fileNumber, matter, consultationFee }
export function renderRetainerDocumentHtml(data) {
  const { agency, agencyLogoDataUri, consultant, client, fileNumber, matter, consultationFee } = data;
  const agencyName = agency?.legalName || agency?.name || "CaseDesk";
  const consultantName = consultant?.fullName || "Your consultant";
  const dateLabel = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
  const contactLine = [agency?.address, agency?.city, agency?.province, agency?.postalCode].filter(Boolean).join(", ");
  const feeAmount = money(consultationFee);

  return `<div class="retainer"><style>${STYLE}</style>
    <header class="letterhead">
      <div class="brand">
        <div class="mark">${agencyLogoDataUri ? `<img src="${escapeHtml(agencyLogoDataUri)}" alt="${escapeHtml(agencyName)}" />` : escapeHtml(monogram(agencyName))}</div>
        <div>
          <div class="brand-name">${escapeHtml(agencyName)}</div>
          <div class="brand-tag">Immigration Consultancy</div>
        </div>
      </div>
      <div class="letterhead-contact">
        ${contactLine ? `${escapeHtml(contactLine)}<br>` : ""}
        ${[agency?.phone, agency?.email].filter(Boolean).map(escapeHtml).join(" &nbsp;·&nbsp; ")}
      </div>
    </header>

    <div class="doc-meta">
      <div><span class="k">Date</span><span class="v">${escapeHtml(dateLabel)}</span></div>
      <div><span class="k">File No.</span><span class="v">${escapeHtml(fileNumber || "—")}</span></div>
      <div><span class="k">Matter</span><span class="v">${escapeHtml(matter || "Initial Consultation")}</span></div>
      <div><span class="k">Consultation fee</span><span class="v">${escapeHtml(feeAmount)}</span></div>
    </div>

    <div class="title-block">
      <p class="kicker">Retainer Agreement</p>
      <h1>Engagement for Immigration Consulting Services</h1>
    </div>

    <div class="parties">
      <div class="party">
        <p class="k">Attending Consultant</p>
        <p class="name">${escapeHtml(consultantName)}</p>
        <p class="meta">${consultant?.licenseNumber ? `CICC Licence ${escapeHtml(consultant.licenseNumber)}<br>` : ""}${escapeHtml(agencyName)}</p>
      </div>
      <div class="party">
        <p class="k">Client</p>
        <p class="name">${escapeHtml(client?.fullName || "")}</p>
        <p class="meta">${[client?.email, client?.phone].filter(Boolean).map(escapeHtml).join("<br>")}</p>
      </div>
    </div>

    <p class="body-p">Dear ${escapeHtml((client?.fullName || "").split(/\s+/)[0] || "Client")},</p>
    <p class="body-p">Thank you for confirming your consultation with ${escapeHtml(agencyName)}. This letter sets out the terms on which we are retained to advise you, following our discussion of your ${escapeHtml(matter || "matter")}.</p>

    <h2 class="section">1. Scope of Services</h2>
    <p class="body-p">${escapeHtml(agencyName)} will provide advice and assistance in connection with your ${escapeHtml(matter || "immigration matter")}, including an assessment of your eligibility, guidance on required documentation, and preparation support as agreed during your consultation. This engagement does not extend to matters outside this scope unless confirmed separately in writing.</p>

    <h2 class="section">2. Consultation Fee</h2>
    <div class="fee-line"><span>Initial consultation fee</span><span class="amt">${escapeHtml(feeAmount)}</span></div>
    <p class="body-p" style="margin-top:0.85rem">Payment is due at the time this retainer is signed. Government fees, translations, courier charges, and other disbursements are billed separately as they are incurred, with your advance approval.</p>

    <h2 class="section">3. Client Responsibilities</h2>
    <p class="body-p">You agree to provide complete and accurate information, respond to requests in a timely manner, and promptly report any change in your circumstances that may affect your matter. ${escapeHtml(agencyName)} does not guarantee a particular outcome.</p>

    <h2 class="section">4. Confidentiality &amp; Records</h2>
    <p class="body-p">Your information is kept confidential and safeguarded at all times, subject to lawful disclosure requirements and the College's regulatory authority. Original documents are returned once their purpose has been served.</p>

    <h2 class="section">5. Termination</h2>
    <p class="body-p">Either party may terminate this engagement in writing, subject to professional obligations, reconciliation of fees owed, and the orderly transfer of your file.</p>

    <div class="regulator"><strong>Regulatory notice.</strong> ${escapeHtml(consultantName)} is regulated by the College of Immigration and Citizenship Consultants (CICC). Information about the College and its complaints process is available at college-ic.ca.</div>

    <p class="effective-note">This retainer is issued on behalf of ${escapeHtml(agencyName)} by ${escapeHtml(consultantName)} and becomes effective upon your electronic signature below.</p>

    <div class="doc-footer"><span>${escapeHtml(agencyName)}${fileNumber ? ` · ${escapeHtml(fileNumber)}` : ""}</span><span>Page 1 of 1</span></div>
  </div>`;
}

// Standalone document wrapper — used in place of clientPortalController.js's
// agreementDocumentHtml() for retainers specifically, since the markup above
// is already a fully self-styled fragment (its own <style> block) rather
// than plain content meant to sit inside that shared wrapper's own page
// chrome. Used for both the initial unsigned file and, via
// applyAgreementSignature's renderDocument override, the signed one.
export function wrapRetainerDocument({ title, contentHtml }) {
  return [
    '<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(title)}</title>`,
    '<style>body{margin:0;background:#eeece3;padding:1.5rem 0;} img{max-width:100%;} table{max-width:100%;}</style>',
    "</head><body>",
    contentHtml || "",
    "</body></html>",
  ].join("");
}
