// One-off seed script — NOT part of the global defaultCorrespondenceTemplates
// list (correspondenceTemplateService.js), because this is CHK Immigration
// Services' own real retainer wording (their specific refund/termination
// terms, fee structure, $200/hr and $500 admin-fee figures) — seeding it to
// every agency on CaseDesk the way the generic CICC precedents are seeded
// would hand one agency's proprietary contract language to every other
// tenant. This script only ever touches the one agency it matches by name.
//
// Source: retainer PDF uploaded 2026-08-08, generated for client Priyanka
// Sharma (PNP case) — genericized here by replacing every client/RCIC/
// agency-specific value with the same {{merge.field}} placeholders
// correspondenceTemplateService.js already resolves (renderCorrespondenceHtml),
// and generalizing the one PNP-specific sentence to {{case.caseType}} so this
// works as the agency's general-purpose retainer, not just a PNP one.
//
// Run with: node prisma/seed/seedChkRetainerTemplate.js
// Requires DATABASE_URL and a working Prisma Client — this sandbox has
// neither network access to the database nor a matching query-engine
// binary, so this could not be executed from here. Run it from an
// environment that already runs your other prisma/migrate commands.

import prisma from "../../src/services/prisma/client.js";
import { ensureDefaultCorrespondenceTemplates } from "../../src/services/correspondenceTemplateService.js";

const AGENCY_NAME_MATCH = "CHK Immigration";

const contentHtml = `
<div style="text-align:center;margin-bottom:24px;">
  <img src="{{agency.logoUrl}}" alt="{{agency.name}}" style="max-height:80px;max-width:280px;display:inline-block;" />
  <h2 style="margin:10px 0 0;">{{agency.name}}</h2>
</div>

<p style="text-align:right;color:#64748b;">RCIC Membership Number: {{consultant.licenseNumber}}<br/>Client File Number: {{case.fileNumber}}</p>

<h1 style="text-align:center;">RETAINER AGREEMENT</h1>

<p>This Retainer Agreement is made on {{current.longDate}}, between Regulated Canadian Immigration Consultant (RCIC) <strong>{{consultant.fullName}}</strong> (the &ldquo;RCIC&rdquo;), located at {{agency.address}}, and Client <strong>{{client.fullName}}</strong> (the &ldquo;Client&rdquo;), located at {{client.address}}.</p>

<p><strong>WHEREAS</strong> the RCIC and the Client wish to enter into a written agreement which contains the agreed upon terms and conditions upon which the RCIC will provide his/her services to the Client;</p>
<p><strong>AND WHEREAS</strong> the RCIC is a member of the College of Immigration and Citizenship Consultants (the &ldquo;College&rdquo;), the regulator in Canada for immigration consultants;</p>
<p><strong>IN CONSIDERATION</strong> of the mutual covenants contained in this Agreement, the parties agree as follows:</p>

<h2>1. Definitions</h2>
<p>The terms &ldquo;Client&rdquo;, &ldquo;College&rdquo;, &ldquo;Disbursement&rdquo; and &ldquo;RCIC&rdquo; shall have the meaning given to such terms in the Retainer Agreement Regulation of the College.</p>

<h2>2. RCIC Responsibilities and Commitments</h2>
<p>The Client/Designate asked the RCIC, and the RCIC has agreed, to act for the Client in the matter of the application(s) for {{case.caseType}}.</p>
<p>Client: {{client.fullName}} &mdash; DOB: {{client.dateOfBirth}}</p>
<p>In consideration of the fees paid and the matter stated above, the RCIC agrees to do the following:</p>
<ol>
  <li>Offer professional services for the benefit of the Client by providing accurate advice, complete assistance, and guidance in the preparation of the file to be presented to the Canadian and, where applicable, provincial immigration authorities. The RCIC will also counsel the Client throughout the application process on any factors which may increase the likelihood of a successful application.</li>
  <li>The RCIC will act with all due diligence and as effectively as possible to ensure the application is handled correctly.</li>
  <li>The RCIC will take all necessary precautions to maintain the confidentiality of the Client&rsquo;s file and information.</li>
  <li>The RCIC may, in some circumstances after reviewing the information and documents provided, advise the Client that their prospects of success are not favourable and ask them if they wish to proceed or terminate this agreement in accordance with the fees section below.</li>
  <li>The RCIC will keep the Client informed about the status of the application and forward copies of correspondence received or sent on behalf of the Client&rsquo;s application.</li>
</ol>

<h2>3. Client Responsibilities and Commitments</h2>
<ol>
  <li>The Client must provide the RCIC all information and documents required by the Canadian immigration authorities within the required time frame.</li>
  <li>The Client must respond to all requests made by the RCIC to provide necessary information and documents, within the time frame specified by the RCIC or at least 10 days before the deadline set by the relevant Canadian immigration authority.</li>
  <li>The Client should inform the RCIC of any changes that may occur during the application process, whether professional, family status, or financial.</li>
  <li>If the Client communicates with or is contacted by Canadian immigration, or another relevant body, the Client shall immediately inform the RCIC with a precise statement, and forward the correspondence or documents to the RCIC, if applicable.</li>
  <li>The Client agrees that no further services will be done or offered by the RCIC if the governmental and relevant service fees are not paid by the Client.</li>
</ol>

<h2>4. Billing Method</h2>
<p>{{agreement.billingMethod}}</p>

<h2>5. Payment Terms and Conditions</h2>
<table style="width:100%;border-collapse:collapse;" border="1" cellpadding="6">
  <tbody>
    <tr><td>Professional Fees</td><td>{{agreement.professionalFees}}</td></tr>
    <tr><td>Government Fees (Biometrics, Permits, etc.)</td><td>{{agreement.governmentFees}}</td></tr>
    <tr><td>Administrative Fees</td><td>{{agreement.administrativeFees}}</td></tr>
    <tr><td>Courier Fees</td><td>{{agreement.courierFees}}</td></tr>
    <tr><td>Applicable Taxes (professional fees)</td><td>{{agreement.taxes}}</td></tr>
    <tr><td><strong>Total</strong></td><td><strong>{{agreement.totalFees}}</strong></td></tr>
  </tbody>
</table>
<ol>
  <li>An additional 3.9% will be charged for online payments.</li>
  <li>The Client also agrees that, in addition to the above, the Client shall pay any expenses or disbursements incurred on behalf of their application, including bank transfer charges, courier, document translation, telephone charges, and other sundry expenses.</li>
  <li>The Client agrees that the applicable government fee is to be paid separately and is not part of the professional fee.</li>
  <li>The RCIC will bill the Client for the services provided throughout the process.</li>
  <li>The total professional fees are considered earned by the RCIC when the application is submitted.</li>
</ol>

<h2>6. Payment Schedule</h2>
<table style="width:100%;border-collapse:collapse;" border="1" cellpadding="6">
  <thead><tr><th>Description</th><th>Amount</th><th>Due on</th></tr></thead>
  <tbody>{{agreement.paymentScheduleRows}}</tbody>
</table>
<p>Amounts are paid in cash or by e-transfer (to the account below) in Canadian dollars.</p>
<p>Beneficiary Name: {{agency.name}}<br/>Email: {{agency.email}}</p>

<h2>7. Refund Policy</h2>
<p>The Client acknowledges that the granting of a visa or status, and the time required to process the application, is at the sole discretion of the government and not the RCIC.</p>
<p>If the application is denied because of an error or omission on the part of the RCIC or professional staff, the RCIC will refund all professional fees collected.</p>
<p>The Client agrees that fees paid are for the services indicated above, and any refund is strictly limited to the amount of fees paid. Unused fees will be refunded by bank transfer as soon as possible.</p>
<p>If the Client decides to terminate this agreement prior to submission of the immigration application, the Client will be billed for time and expenses incurred up to the time of termination &mdash; $500.00 administrative fee for opening and closing the file, plus $200.00 per hour of work &mdash; and any balance will be refunded to the Client by bank transfer within 30 working days.</p>

<h2>8. Dispute Resolution Related to the Code of Professional Ethics</h2>
<p>In the event of a dispute related to the Code of Professional Ethics, the Client and RCIC are to make every effort to resolve the matter between the two parties. If a resolution cannot be reached, the Client is to present the complaint in writing to the RCIC and allow the RCIC 30 days to respond. If the dispute is still unresolved, the Client may follow the complaint and discipline procedure outlined by the College on their website: <a href="https://college-ic.ca/protecting-the-public/complaints-process/make-a-complaint">college-ic.ca/protecting-the-public/complaints-process/make-a-complaint</a>.</p>
<p>College of Immigration and Citizenship Consultants (CICC)<br/>5500 North Service Rd., Suite 1002, Burlington, ON, L7L 6W6<br/>Toll-free: 1-877-836-7543</p>

<h2>9. Confidentiality</h2>
<p>All information and documentation reviewed by the RCIC, required by IRCC and other governing bodies, and used for the preparation of the application, will not be divulged to any third party other than agents and employees, without prior consent, except as demanded by law. The RCIC and all agents and employees of the RCIC are bound by the confidentiality requirements of Articles 8.1 and 8.5 of the Code of Professional Ethics. The Client agrees to the use of electronic communication and storage of confidential information. The RCIC will use best efforts to maintain a high degree of security for electronic communication and information storage.</p>

<h2>10. Force Majeure</h2>
<p>The RCIC&rsquo;s failure to perform any term of this Retainer Agreement, as a result of conditions beyond his/her control such as, but not limited to, governmental restrictions or subsequent legislation, war, strikes, or acts of God, shall not be deemed a breach of this Agreement.</p>

<h2>11. Change Policy</h2>
<p>The Client acknowledges that if the RCIC is asked to act on the Client&rsquo;s behalf on matters other than those outlined above, or because of a material change in the Client&rsquo;s circumstances, or because of material facts not disclosed at the outset, or because of a change in government legislation regarding the processing of immigration or citizenship-related applications, this Agreement can be modified accordingly.</p>

<h2>12. Termination of Agreement</h2>
<p>12.1 This Agreement will terminate automatically after a final determination from the Provincial or Federal immigration authority, as applicable, or if:</p>
<ol>
  <li>The Client doesn&rsquo;t provide the RCIC the required documents within the time frame.</li>
  <li>The Client doesn&rsquo;t provide the relevant information or documents required by the Federal or provincial immigration authorities.</li>
  <li>The Client issues false declarations regarding their immigration application.</li>
  <li>The Client fails to pay the necessary fees as stated in this agreement.</li>
  <li>The Client neglects or omits to co-operate with the RCIC.</li>
  <li>The RCIC terminates this agreement by giving 30 days&rsquo; written notice if the Client is in default of its terms.</li>
</ol>
<p>12.2 This Agreement is considered terminated if material changes occur to the Client&rsquo;s application or eligibility that make it impossible to proceed with the services detailed in Section 2.</p>

<h2>13. Discharge or Withdrawal of Representation</h2>
<p>13.1 The Client may discharge representation and terminate this Agreement in writing, at which time any outstanding fees or Disbursements owed will be settled between the parties accordingly.</p>
<p>13.2 Pursuant to Article 11 of the Code of Professional Ethics, the RCIC may withdraw representation and terminate this Agreement in writing, provided withdrawal does not cause prejudice to the Client, at which time any outstanding fees or Disbursements owed will be settled between the parties accordingly.</p>

<h2>14. Governing Law</h2>
<p>This Agreement shall be governed by the laws in effect in the Province of Ontario and the federal laws of Canada applicable therein. Except for disputes pursuant to Section 8, any dispute with respect to this Agreement shall be decided by a court of competent jurisdiction within the Province of Ontario.</p>

<h2>15. Miscellaneous</h2>
<p>15.1 The Client expressly authorizes the RCIC to act on their behalf to the extent of the specific functions which the RCIC was retained to perform, as per Section 2.</p>
<p>15.2 This Agreement constitutes the entire agreement between the parties with respect to its subject matter and supersedes all prior agreements, understandings, warranties, representations, negotiations, and discussions, whether oral or written, except as specifically set forth herein.</p>
<p>15.3 This Agreement shall be binding upon the parties and their respective heirs, administrators, successors, and permitted assigns.</p>
<p>15.4 This Agreement may only be altered or amended in writing, executed by the parties.</p>
<p>15.5 The provisions of this Agreement are severable. If any provision is held unenforceable by a court of competent jurisdiction, that provision shall be severed and the remaining provisions shall remain in full force and effect.</p>
<p>15.6 Headings in this Agreement are for convenience only and are not to be construed as additions to or limitations of its covenants and agreements.</p>
<p>15.7 Each party shall do and execute, or cause to be done or executed, all further things, acts, deeds, documents, and assurances as may be necessary or reasonably required to carry out the intent of this Agreement.</p>
<p>15.8 The Client acknowledges having had sufficient time to review this Agreement and the opportunity to obtain independent legal advice and translation prior to signing. If the Client did not seek independent legal advice, they did so voluntarily without undue pressure, and agree that failing to obtain such advice is not a defense to the enforcement of obligations created by this Agreement.</p>
<p>15.9 The Client acknowledges receipt of a copy of this Agreement and agrees to be bound by its terms.</p>
<p>15.10 The Client acknowledges having requested that this Agreement be written in the English language; Les parties reconnaissent qu&rsquo;elles ont exig&eacute; que ce qui pr&eacute;c&egrave;de soit r&eacute;dig&eacute; en anglais.</p>

<h2>16. Contact Information</h2>
<p><strong>Client</strong><br/>Name: {{client.fullName}}<br/>Address: {{client.address}}<br/>Tel: {{client.phone}}<br/>E-mail: {{client.email}}</p>
<p><strong>RCIC</strong><br/>Name: {{consultant.fullName}}<br/>Address: {{agency.address}}<br/>Tel: {{consultant.phone}}<br/>E-mail: {{consultant.email}}</p>

<h2>17. Attachments</h2>
<ul><li>Use of Representative Form [IMM 5476]</li></ul>

<p>IN WITNESS THEREOF this Agreement has been duly executed by the parties hereto on the date first above written.</p>

<h2>Signatures</h2>
<p>Client: __________________________ &nbsp; Date: _______________</p>
<p>Consultant: _______________________ &nbsp; Date: _______________</p>
`.trim();

async function main() {
  const agency = await prisma.agency.findFirst({ where: { name: { contains: AGENCY_NAME_MATCH, mode: "insensitive" } } });
  if (!agency) throw new Error(`No agency found matching "${AGENCY_NAME_MATCH}" — refusing to run against an ambiguous or missing agency.`);
  const duplicates = await prisma.agency.count({ where: { name: { contains: AGENCY_NAME_MATCH, mode: "insensitive" } } });
  if (duplicates > 1) throw new Error(`Multiple agencies match "${AGENCY_NAME_MATCH}" — narrow AGENCY_NAME_MATCH before running.`);

  // Guarantee the generic CICC default (currently the general-purpose
  // fallback) exists before demoting it, and so the well-known slug below
  // is stable to look up.
  await ensureDefaultCorrespondenceTemplates(agency.id);
  await prisma.correspondenceTemplate.updateMany({
    where: { agencyId: agency.id, slug: "immigration-service-agreement" },
    data: { isSystemDefault: false },
  });

  const title = "CHK Immigration Retainer Agreement";
  const slug = "chk-immigration-retainer-agreement";
  const existing = await prisma.correspondenceTemplate.findFirst({ where: { agencyId: agency.id, slug } });
  if (existing) {
    console.log(`Template "${title}" already exists for ${agency.name} (id ${existing.id}) — leaving it as-is. Delete it first if you want to reseed from the PDF.`);
    return;
  }

  const created = await prisma.correspondenceTemplate.create({
    data: {
      agencyId: agency.id,
      slug,
      title,
      kind: "Agreement",
      category: "Client Agreements",
      description: "CHK Immigration's own retainer agreement, extracted from the agency's real (signed) template and genericized with merge fields — now the general-purpose system default.",
      contentHtml,
      caseTags: ["general"],
      isSystemDefault: true,
      versions: { create: { agencyId: agency.id, versionNumber: 1, title, kind: "Agreement", category: "Client Agreements", description: "Seeded from uploaded PDF", contentHtml, caseTags: ["general"] } },
    },
  });
  console.log(`Created "${created.title}" (id ${created.id}) for ${agency.name} and demoted the generic CICC default to non-system-default.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
