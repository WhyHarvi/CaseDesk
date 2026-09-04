import prisma from "./prisma/client.js";

const sources = {
  code: { sourceName: "CICC Code of Professional Conduct, sections 23–24", sourceUrl: "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2022-128/page-2.html" },
  serviceGuide: { sourceName: "CICC Guide for Developing Your Service Agreement (2024)", sourceUrl: "https://www.college-ic.ca/ICCRC/Assets/Documents/Guides/SERVICE_AGREEMENT_GUIDE_EN.pdf" },
  invitation: { sourceName: "IRCC Letter of invitation for visitors to Canada", sourceUrl: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/letter-invitation.html" },
  businessInvitation: { sourceName: "IRCC Letter of invitation for business visitors", sourceUrl: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/business/bring-business-guests/letter-invitation.html" },
  supporting: { sourceName: "IRCC Supporting documents guidance", sourceUrl: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/common-supporting-documents.html" },
  webform: { sourceName: "IRCC Web form guidance", sourceUrl: "https://www.canada.ca/en/immigration-refugees-citizenship/corporate/contact-ircc/web-form.html" },
};

const letterShell = (subject, body) => `<p>{{current.longDate}}</p><p><strong>{{agency.name}}</strong><br>{{agency.address}}<br>{{agency.phone}} · {{agency.email}}</p><p>{{client.fullName}}<br>{{client.address}}<br>{{client.email}}</p><p><strong>Re: ${subject} — {{case.caseType}}</strong></p><p>Dear {{client.fullName}},</p>${body}<p>Sincerely,</p><p><strong>{{consultant.fullName}}</strong><br>{{agency.name}}<br>{{consultant.email}}</p>`;
const agreementShell = (title, body) => `<h1>${title}</h1><p><strong>Agreement date:</strong> {{current.longDate}}</p><p>This agreement is between <strong>{{client.fullName}}</strong> (“Client”), of {{client.address}}, telephone {{client.phone}}, email {{client.email}}, and <strong>{{consultant.fullName}}</strong> of <strong>{{agency.name}}</strong> (“Consultant”), at {{agency.address}}, telephone {{agency.phone}}, email {{consultant.email}}.</p>${body}<h2>Signatures</h2><p>Client: __________________________ &nbsp; Date: _______________</p><p>Consultant: _______________________ &nbsp; Date: _______________</p>`;
const t = (slug, title, kind, category, description, caseTags, contentHtml, source = {}) => ({ slug, title, kind, category, description, caseTags, contentHtml, ...source });

export const defaultCorrespondenceTemplates = [
  t("initial-consultation-agreement", "Initial Consultation Agreement", "Agreement", "Client Agreements", "Written terms for an initial paid or pro-bono consultation.", ["general"], agreementShell("Initial Consultation Agreement", `<p><strong>Consultant registration number:</strong> {{consultant.licenseNumber}}</p><h2>Purpose and scope</h2><p>The consultation concerns {{case.caseType}}. Its scope is: {{agreement.consultationScope}}.</p><h2>Consultation fee</h2><p>{{agreement.consultationFee}}</p><h2>Regulator</h2><p>The Consultant is regulated by the College of Immigration and Citizenship Consultants. Information about the College and its complaints process is available at college-ic.ca.</p><h2>No continuing retainer</h2><p>This consultation does not authorize ongoing representation unless the parties sign a separate service agreement.</p>`), sources.code),
  t("immigration-service-agreement", "Immigration Service Agreement", "Agreement", "Client Agreements", "Comprehensive editable service agreement precedent aligned to CICC Code section 24.", ["general"], agreementShell("Immigration and Citizenship Consulting Service Agreement", `<p><strong>Consultant registration number:</strong> {{consultant.licenseNumber}}</p><h2>1. Preliminary advice and client instructions</h2><p>{{agreement.preliminaryAdvice}}</p><p>The Client instructs the Consultant to assist with {{case.caseType}}.</p><h2>2. Scope of services</h2><p>{{agreement.services}}</p><p>Estimated service period: {{agreement.timeframe}}. Persons likely to assist: {{agreement.assistants}}.</p><h2>3. Professional service standard</h2><p>The Consultant will endeavour to provide quality immigration or citizenship consulting services and adequately supervise persons assisting with the services. The Consultant will provide timely written case-status information and obtain interpreter or translator assistance when necessary.</p><h2>4. Client responsibilities</h2><p>The Client will provide complete, accurate and timely information, review drafts, meet deadlines, and immediately report changes in circumstances. The Consultant does not guarantee an outcome.</p><h2>5. Fees, taxes and disbursements</h2><p>Professional fees: {{agreement.fees}}. Estimated disbursements: {{agreement.disbursements}}. Applicable taxes: {{agreement.taxes}}. Payment terms and interest: {{agreement.paymentTerms}}. Advance payment and refund policy: {{agreement.refundPolicy}}. Additional costs may include government fees, medical examinations, police certificates, translations, courier charges and third-party professional fees.</p><h2>6. Conflicts</h2><p>{{agreement.conflictDisclosure}}</p><h2>7. Documents, confidentiality and records</h2><p>Original documents will be returned as soon as their purpose has been achieved. Client information will be kept confidential and safeguarded, subject to lawful disclosure and the College’s regulatory authority.</p><h2>8. Complaints and regulator</h2><p>Agency complaint procedure: {{agreement.complaintProcedure}}. The College regulates licensees and accepts regulatory complaints. The Client acknowledges receipt of the applicable Code of Professional Conduct.</p><h2>9. Incapacity, termination and file transfer</h2><p>If the Consultant cannot continue, the agency’s continuity plan is: {{agreement.continuityPlan}}. Either party may terminate in writing, subject to professional obligations, payment reconciliation, return of property and reasonable transfer of the file.</p><h2>10. Language and amendments</h2><p>Services will be provided in {{agreement.serviceLanguage}}. Amendments must be agreed to in writing.</p>`), { ...sources.serviceGuide, isRetainerTemplate: true }),
  t("limited-scope-service-agreement", "Limited-Scope Service Agreement", "Agreement", "Client Agreements", "A service agreement for a defined review, form, or submission task.", ["general"], agreementShell("Limited-Scope Service Agreement", `<p><strong>Consultant registration number:</strong> {{consultant.licenseNumber}}</p><h2>Defined service</h2><p>The Consultant is retained only to: {{agreement.services}}.</p><h2>Excluded services</h2><p>{{agreement.excludedServices}}</p><p>The Client remains responsible for all excluded work, deadlines and submissions. Fees: {{agreement.fees}}. Disbursements and taxes: {{agreement.disbursements}} / {{agreement.taxes}}.</p><h2>Professional and administrative terms</h2><p>Confidentiality, complaint handling, document return, status communication, payment, refund, termination and continuity terms from the agency’s approved service-agreement policy apply: {{agreement.standardTerms}}</p>`), sources.code),
  t("additional-services-amendment", "Additional Services / Retainer Amendment", "Agreement", "Client Agreements", "Written amendment when scope, fees or services change.", ["general"], agreementShell("Amendment to Service Agreement", `<p>This amendment modifies the service agreement dated {{agreement.originalAgreementDate}}.</p><h2>Changes</h2><p>Additional or revised services: {{agreement.services}}.</p><p>Revised fees, taxes and disbursements: {{agreement.fees}}; {{agreement.taxes}}; {{agreement.disbursements}}.</p><p>Revised delivery estimate: {{agreement.timeframe}}.</p><p>All unchanged terms remain in force. The parties agree to these changes in writing.</p>`), sources.code),
  t("joint-retainer-conflict-consent", "Joint Retainer and Conflict Consent", "Agreement", "Client Agreements", "Consent and instructions where the agency represents related clients.", ["sponsorship", "family", "business"], agreementShell("Joint Retainer and Conflict Consent", `<p>The jointly represented clients are: {{agreement.jointClients}}.</p><h2>Common interest</h2><p>{{agreement.commonInterest}}</p><h2>Information sharing</h2><p>Information material to the joint matter may be shared among jointly represented clients. No jointly represented client should expect material information to be withheld from another.</p><h2>Potential conflict</h2><p>{{agreement.conflictDisclosure}}</p><p>If an unresolvable conflict develops, the Consultant may be required to stop acting for one or all clients. Each client confirms informed consent and may obtain independent legal advice.</p>`), sources.code),
  t("risk-acknowledgement", "Client Risk Acknowledgement", "Agreement", "Acknowledgements", "Written acknowledgement where a client proceeds despite identified risks.", ["general"], agreementShell("Acknowledgement of Risk and Client Instructions", `<p>The Consultant has provided the following written opinion and reasons: {{agreement.preliminaryAdvice}}</p><p>Risks identified: {{agreement.risks}}</p><p>Alternatives discussed: {{agreement.alternatives}}</p><p>Despite this advice, the Client instructs the Consultant to: {{agreement.clientInstructions}}.</p><p>The Client acknowledges that no outcome is guaranteed and confirms the instructions above.</p>`), sources.code),
  t("termination-file-closing-agreement", "Termination and File Transfer Acknowledgement", "Agreement", "Client Agreements", "Documents termination instructions, balances and file delivery.", ["general"], agreementShell("Termination and File Transfer Acknowledgement", `<p>The service agreement ends effective {{agreement.terminationDate}}.</p><p>Reason and instructions: {{agreement.terminationReason}}.</p><p>Outstanding deadlines or consequences: {{agreement.risks}}.</p><p>Final account/refund: {{agreement.finalAccount}}.</p><p>The file and client property will be delivered to: {{agreement.fileRecipient}}.</p>`), sources.code),
  t("welcome-onboarding-letter", "Welcome and Onboarding Letter", "Letter", "Client Care", "Introduces the case team, communication process and next steps.", ["general"], letterShell("Welcome to {{agency.name}}", `<p>Thank you for retaining our agency for your immigration matter. Your file has been opened for {{case.caseType}}.</p><p>Your primary consultant is {{consultant.fullName}}. Please use your CaseDesk portal for questionnaires, documents and updates.</p><h2>Immediate next steps</h2><p>{{letter.nextSteps}}</p><p>Please notify us immediately of changes to your address, family composition, employment, immigration status or contact information.</p>`)),
  t("document-request-letter", "Document Request Letter", "Letter", "Client Care", "Requests outstanding application documents from the client.", ["general"], letterShell("Documents required for your application", `<p>To continue preparing your application, please provide the following:</p><p>{{letter.documentList}}</p><p><strong>Requested by:</strong> {{letter.deadline}}</p><p>Upload clear, complete colour copies through CaseDesk. Tell us promptly if a document is unavailable or requires additional time.</p>`), sources.supporting),
  t("missing-information-letter", "Missing Information Follow-up", "Letter", "Client Care", "Requests unanswered or inconsistent case information.", ["general"], letterShell("Information needed to continue", `<p>Our review identified the following missing or unclear information:</p><p>{{letter.missingInformation}}</p><p>Please respond by {{letter.deadline}}. Incomplete or inconsistent information can delay preparation and may affect the application.</p>`)),
  t("application-submitted-letter", "Application Submitted Confirmation", "Letter", "Case Updates", "Confirms submission and explains post-submission responsibilities.", ["general"], letterShell("Application submitted", `<p>We confirm that your {{case.caseType}} application was submitted on {{case.submittedAt}}.</p><p>Application number: {{case.applicationNumber}}. UCI: {{client.uci}}.</p><p>Keep passports and status documents valid, monitor messages, and notify us immediately of material changes. Processing times are estimates and no outcome is guaranteed.</p>`)),
  t("case-status-update-letter", "Case Status Update", "Letter", "Case Updates", "Provides a concise written status update and upcoming actions.", ["general"], letterShell("Status update", `<p>Current case stage: <strong>{{case.stage}}</strong>.</p><p>Latest update: {{letter.statusUpdate}}</p><p>Next action: {{case.nextAction}}</p><p>Items required from you: {{letter.clientAction}}</p>`)),
  t("biometrics-medical-instruction-letter", "Biometrics / Medical Instructions", "Letter", "Case Updates", "Explains a biometrics or medical request and deadline.", ["general"], letterShell("Biometrics or medical examination instructions", `<p>IRCC has issued instructions concerning {{letter.requestType}}.</p><p><strong>Deadline:</strong> {{letter.deadline}}</p><p><strong>Instructions:</strong> {{letter.instructions}}</p><p>Send confirmation through CaseDesk immediately after completion.</p>`)),
  t("additional-document-request-letter", "Additional Document Request (ADR) Letter", "Letter", "IRCC Responses", "Explains an IRCC request and organizes the client response.", ["general"], letterShell("IRCC additional document request", `<p>IRCC requested additional information or documents. The response deadline is {{letter.deadline}}.</p><p>Items requested:</p><p>{{letter.documentList}}</p><p>Our response plan: {{letter.responsePlan}}</p>`)),
  t("procedural-fairness-response-cover", "Procedural Fairness Response Cover Letter", "Letter", "IRCC Responses", "Structured representative cover letter for a procedural fairness response.", ["general"], letterShell("Response to procedural fairness letter", `<p><strong>Application number:</strong> {{case.applicationNumber}}<br><strong>UCI:</strong> {{client.uci}}</p><h2>Issue raised</h2><p>{{letter.issueRaised}}</p><h2>Relevant facts and response</h2><p>{{letter.responseSubmissions}}</p><h2>Supporting evidence</h2><p>{{letter.documentList}}</p><h2>Request</h2><p>We respectfully request that the enclosed response and evidence be considered before a decision is made.</p>`)),
  t("ircc-webform-cover-letter", "IRCC Webform Submission Cover", "Letter", "IRCC Responses", "Cover note for an application update or document submission through the IRCC webform.", ["general"], letterShell("IRCC webform submission", `<p><strong>Application number:</strong> {{case.applicationNumber}}<br><strong>UCI:</strong> {{client.uci}}</p><p>Submission purpose: {{letter.webformPurpose}}</p><p>Documents attached: {{letter.documentList}}</p><p>Please add this information to the application record.</p>`), sources.webform),
  t("approval-next-steps-letter", "Approval and Next Steps Letter", "Letter", "Decisions", "Explains an approval and immediate compliance or travel steps.", ["general"], letterShell("Approval and next steps", `<p>We are pleased to confirm the approval received on {{case.decisionAt}}.</p><p>Approved document or status: {{letter.approvedDocument}}</p><p>Important validity dates and conditions: {{letter.conditions}}</p><p>Next steps: {{letter.nextSteps}}</p>`)),
  t("refusal-options-letter", "Refusal and Options Letter", "Letter", "Decisions", "Communicates a refusal without promising a remedy and records follow-up options.", ["general"], letterShell("Decision received — review of next steps", `<p>IRCC refused the application on {{case.decisionAt}}. The stated reasons are: {{letter.refusalReasons}}</p><p>Potential next steps for discussion may include reconsideration, a new application, obtaining the file record, or legal advice regarding review rights, depending on deadlines and circumstances.</p><p>Consultation deadline and recommended action: {{letter.nextSteps}}</p>`)),
  t("file-closing-letter", "File Closing Letter", "Letter", "Client Care", "Confirms completion or termination and identifies retained records.", ["general"], letterShell("File closing", `<p>Our work on this matter concluded on {{letter.closingDate}} because {{letter.closingReason}}.</p><p>Final documents delivered: {{letter.documentList}}</p><p>Outstanding client actions or deadlines: {{letter.clientAction}}</p><p>Thank you for the opportunity to assist you.</p>`)),
  t("visitor-invitation-letter", "Visitor Visa Invitation Letter", "Letter", "Temporary Residence", "IRCC-aligned invitation letter precedent for a family member or friend.", ["visitor", "temporary resident", "trv"], letterShell("Invitation to visit Canada", `<p>I, {{inviter.fullName}}, born {{inviter.dateOfBirth}}, residing at {{inviter.address}} in Canada, invite {{client.fullName}}, born {{client.dateOfBirth}}, residing at {{client.address}}, to visit Canada.</p><p>Relationship: {{inviter.relationship}}. Purpose: {{travel.purpose}}. Intended stay: {{travel.arrivalDate}} to {{travel.departureDate}}.</p><p>The visitor will stay at {{travel.accommodation}} and expenses will be paid by {{travel.payer}}. The visitor intends to leave Canada on {{travel.departureDate}}.</p><p>Inviter telephone/email: {{inviter.phone}} / {{inviter.email}}. Occupation: {{inviter.occupation}}. Canadian status: {{inviter.canadianStatus}}. Supporting status evidence and family details are attached.</p>`), sources.invitation),
  t("super-visa-support-letter", "Super Visa Invitation and Financial Support", "Letter", "Temporary Residence", "Invitation and financial-support precedent for a parent or grandparent super visa.", ["super visa", "parent", "grandparent", "visitor"], letterShell("Invitation and financial support for Super Visa", `<p>I, {{inviter.fullName}}, invite my {{inviter.relationship}}, {{client.fullName}}, to Canada from {{travel.arrivalDate}} to {{travel.departureDate}}.</p><p>I promise financial support for the duration of the visit, including {{travel.supportDetails}}.</p><p>Family-size calculation: {{inviter.familySizeDetails}}. Accommodation: {{travel.accommodation}}.</p><p>My Canadian status, income evidence and the applicant’s medical insurance evidence are enclosed.</p>`), sources.invitation),
  t("business-visitor-invitation", "Business Visitor Invitation Letter", "Letter", "Temporary Residence", "Company invitation letter with IRCC business-visitor information fields.", ["business visitor", "visitor", "work"], letterShell("Business visitor invitation", `<p>{{inviter.companyName}} invites {{client.fullName}}, {{inviter.inviteePosition}} at {{inviter.inviteeCompany}}, to Canada for {{travel.purpose}} from {{travel.arrivalDate}} to {{travel.departureDate}}.</p><p>Business relationship and project context: {{inviter.businessRelationship}}.</p><p>Facilities to be visited: {{inviter.facilities}}. Expenses covered: {{travel.supportDetails}}.</p><p>Inviting company: {{inviter.companyName}}, {{inviter.companyAddress}}, incorporated {{inviter.incorporationDate}}, business: {{inviter.businessDescription}}, website {{inviter.website}}.</p>`), sources.businessInvitation),
  t("temporary-resident-purpose-letter", "Purpose of Travel / Letter of Explanation", "Letter", "Temporary Residence", "Applicant explanation for temporary purpose, funds, ties and departure plan.", ["visitor", "study", "work", "temporary resident", "permit"], letterShell("Letter of explanation and temporary purpose", `<h2>Purpose and proposed activities</h2><p>{{travel.purpose}}</p><h2>Dates, destination and accommodation</h2><p>{{travel.arrivalDate}} to {{travel.departureDate}}; {{travel.destination}}; {{travel.accommodation}}.</p><h2>Funding</h2><p>{{travel.funds}}</p><h2>Home-country ties and departure plan</h2><p>{{travel.homeTies}}</p><p>{{travel.returnPlan}}</p><h2>Prior history or issues requiring explanation</h2><p>{{travel.additionalExplanation}}</p>`)),
  t("study-plan-letter", "Study Plan / Statement of Purpose", "Letter", "Study", "Structured study-purpose precedent for a study permit application.", ["study", "student"], letterShell("Study plan", `<h2>Academic and professional background</h2><p>{{study.background}}</p><h2>Program and institution</h2><p>{{study.programDetails}}</p><h2>Why this program and Canada</h2><p>{{study.programRationale}}</p><h2>Funding</h2><p>{{travel.funds}}</p><h2>Career relevance and return plan</h2><p>{{study.careerPlan}}</p><p>{{travel.returnPlan}}</p>`)),
  t("work-permit-employer-support", "Employer Support Letter", "Letter", "Work", "Employer support precedent for a work permit submission.", ["work", "lmia", "employer"], letterShell("Employment and work permit support", `<p>{{employer.name}} confirms its offer of employment to {{client.fullName}} as {{employment.jobTitle}} at {{employment.location}}.</p><p>Proposed start date: {{employment.startDate}}. Wage/hours: {{employment.compensation}}. Duties: {{employment.duties}}.</p><p>LMIA or exemption basis: {{employment.authorizationBasis}}.</p><p>The employer confirms the offer remains available and will comply with applicable employment and immigration obligations.</p>`)),
  t("employment-reference-request", "Employment Reference Request", "Letter", "Permanent Residence", "Instructions to an employer for a detailed immigration employment letter.", ["express entry", "permanent resident", "pnp", "cec", "fsw", "work"], letterShell("Employment reference required", `<p>Please ask {{employment.employerName}} to provide a signed letter on company letterhead confirming:</p><ul><li>job title and dates;</li><li>hours per week and full-time/part-time status;</li><li>salary and benefits;</li><li>detailed duties and responsibilities;</li><li>work location; and</li><li>the signer’s name, title and contact information.</li></ul><p>The letter should be supported by available contracts, pay evidence or tax records.</p>`), sources.supporting),
  t("sponsorship-evidence-request", "Sponsorship Relationship Evidence Request", "Letter", "Family Sponsorship", "Organizes relationship, sponsor and family-class evidence.", ["sponsorship", "spouse", "partner", "family", "parent", "child"], letterShell("Family sponsorship evidence required", `<p>Please provide the following sponsor and applicant evidence:</p><p>{{letter.documentList}}</p><h2>Relationship narrative</h2><p>Please describe how the relationship developed, important dates, cohabitation, family involvement, communication and future plans. Address any periods of separation or inconsistencies.</p><p>Deadline: {{letter.deadline}}</p>`)),
  t("citizenship-evidence-request", "Citizenship Evidence Request", "Letter", "Citizenship", "Requests physical-presence, identity, language and tax evidence.", ["citizenship"], letterShell("Citizenship application evidence", `<p>Please provide identity documents, travel documents, physical-presence records, language evidence if applicable, tax information and any requested prohibitions information.</p><p>Specific outstanding items: {{letter.documentList}}</p><p>Review period and deadline: {{letter.deadline}}</p>`)),
  t("humanitarian-narrative-instructions", "Humanitarian Narrative Instructions", "Letter", "Humanitarian", "Client instructions for establishment, hardship and best-interests evidence.", ["humanitarian", "compassionate", "h&c"], letterShell("Humanitarian and compassionate narrative", `<p>Please prepare a detailed chronological narrative addressing:</p><ul><li>establishment in Canada;</li><li>family and community relationships;</li><li>hardship on return;</li><li>medical or country circumstances;</li><li>the best interests of affected children; and</li><li>supporting evidence for each important fact.</li></ul><p>Questions requiring special attention: {{letter.missingInformation}}</p>`)),
  t("refugee-narrative-instructions", "Refugee Claim Narrative Instructions", "Letter", "Refugee Protection", "Chronology and evidence instructions for a refugee or protection narrative.", ["refugee", "protected person", "asylum"], letterShell("Claim narrative and evidence instructions", `<p>Please provide a complete, truthful chronology of feared harm, relevant incidents, actors, dates, locations, attempts to seek protection, internal relocation considerations, travel and prior claims.</p><p>Identify supporting records and witnesses. Do not guess; clearly identify approximate dates and explain missing evidence.</p><p>Outstanding questions: {{letter.missingInformation}}</p>`)),
];

export async function ensureDefaultCorrespondenceTemplates(agencyId) {
  const existing = new Set((await prisma.correspondenceTemplate.findMany({ where: { agencyId }, select: { slug: true } })).map((item) => item.slug));
  for (const item of defaultCorrespondenceTemplates) {
    if (existing.has(item.slug)) continue;
    try {
      await prisma.correspondenceTemplate.create({ data: { agencyId, ...item, isSystemDefault: true, versions: { create: { agencyId, versionNumber: 1, title: item.title, kind: item.kind, category: item.category, description: item.description, contentHtml: item.contentHtml, caseTags: item.caseTags } } } });
    } catch (error) {
      // Two case screens can seed the same new agency concurrently. The unique
      // agency/slug key makes the second create harmless.
      if (error.code !== "P2002") throw error;
    }
  }
}

export function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function missingPlaceholderText(key) {
  const label = key.split(".").at(-1).replace(/([a-z])([A-Z])/g, "$1 $2");
  return `[Add ${label}]`;
}

export async function getCorrespondenceContext(agencyId, caseId, userId) {
  const [agency, caseItem, user] = await Promise.all([
    prisma.agency.findUnique({ where: { id: agencyId } }),
    prisma.case.findFirst({ where: { id: caseId, agencyId }, include: { client: true, assignedUser: true } }),
    prisma.user.findFirst({ where: { id: userId, agencyId } }),
  ]);
  if (!caseItem) return null;
  const consultant = caseItem.assignedUser || user;
  return { agency, caseItem, client: caseItem.client, consultant };
}

// Keys here render as an empty string when unset instead of the usual
// "[Add X]" <mark> placeholder — because they're only ever used inside an
// HTML attribute (an <img src="">), where a literal "[Add Logo Url]" mark
// tag would produce broken markup rather than a visibly-missing field.
const RAW_ATTRIBUTE_KEYS = new Set(["agency.logoUrl"]);

// Agency.logoUrl is not a real, writable field — the workspace-profile
// picture is uploaded to Supabase Storage and referenced via
// avatarStorageKey, normally served only through an authenticated route.
// Retainer/agreement HTML can be opened with no CaseDesk session at all
// (a downloaded file, or a sandboxed portal viewer), so we instead build an
// absolute URL to the unauthenticated public logo endpoint whenever the
// agency has uploaded a workspace picture.
function agencyLogoUrl(agency) {
  if (!agency?.avatarStorageKey) return null;
  const base = String(process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, "");
  return `${base}/api/public/agency/${agency.id}/logo`;
}

export function renderCorrespondenceHtml(contentHtml, context) {
  const { agency, caseItem, client, consultant } = context;
  const values = {
    "agency.name": agency?.name, "agency.address": agency?.address, "agency.phone": agency?.phone, "agency.email": agency?.email, "agency.logoUrl": agencyLogoUrl(agency),
    "client.fullName": client?.fullName, "client.address": client?.address, "client.phone": client?.phone, "client.secondaryPhone": client?.secondaryPhone, "client.email": client?.email, "client.dateOfBirth": client?.dateOfBirth ? new Date(client.dateOfBirth).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }) : null,
    "consultant.fullName": consultant?.fullName, "consultant.email": consultant?.email, "consultant.phone": consultant?.phone, "consultant.licenseNumber": consultant?.licenseNumber,
    // The agency's designated owner/signing authority (Settings > Workspace
    // Profile) — a fixed identity independent of whichever staff member is
    // assigned to this particular case, for documents (like a retainer)
    // that should always show the same signing RCIC. Falls back to the
    // assigned consultant when the agency hasn't set an owner yet, so a
    // template using {{owner.*}} doesn't just show "[Add Full Name]"
    // forever on agencies that haven't configured this.
    "owner.fullName": agency?.ownerFullName || consultant?.fullName, "owner.licenseNumber": agency?.ownerLicenseNumber || consultant?.licenseNumber, "owner.phone": agency?.ownerPhone || consultant?.phone, "owner.email": agency?.ownerEmail || consultant?.email,
    "case.caseType": caseItem.caseType, "case.stage": caseItem.stage, "case.nextAction": caseItem.nextAction, "case.submittedAt": caseItem.submittedAt ? new Date(caseItem.submittedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }) : null, "case.decisionAt": caseItem.decisionAt ? new Date(caseItem.decisionAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }) : null,
    "current.longDate": new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }),
  };
  const missing = [];
  const html = String(contentHtml || "").replace(/\{\{([a-zA-Z0-9.]+)\}\}/g, (_, key) => {
    const value = values[key];
    if (value !== undefined && value !== null && String(value).trim()) return escapeHtml(value);
    if (RAW_ATTRIBUTE_KEYS.has(key)) return "";
    missing.push(key);
    const label = key.split(".").at(-1).replace(/([a-z])([A-Z])/g, "$1 $2");
    return `<mark data-casedesk-missing="${escapeHtml(key)}">[Add ${escapeHtml(label)}]</mark>`;
  });
  return { html, missing: [...new Set(missing)] };
}

// Fills in a merge field that's still showing its "[Add X]" placeholder
// after the document was already created — e.g. once a case's payment
// schedule exists, filling {{agreement.totalFees}} into a retainer that
// was drafted before the schedule did. Only ever touches a field that's
// still unresolved, so it never overwrites something staff already typed
// over the placeholder.
//
// Matches on the placeholder's literal "[Add X]" bracket text rather than
// requiring its <mark data-casedesk-missing> wrapper to still be there:
// the Writer's TipTap schema has no mark/highlight extension registered,
// so the moment this document is opened there the <mark> tag itself is
// dropped as an unrecognized node — only the bracket text survives. Text
// matching keeps this working whether the document has ever been opened in
// the Writer or not.
//
// A key can legitimately appear more than once in a template (e.g. a
// running total shown in two different tables) — every occurrence of the
// same still-blank placeholder gets the same value.
export function applyResolvedMergeValues(html, values) {
  let result = html;
  const filled = [];
  for (const [key, value] of Object.entries(values || {})) {
    if (value === undefined || value === null || !String(value).trim()) continue;
    const placeholder = missingPlaceholderText(key);
    const markPattern = new RegExp(`<mark data-casedesk-missing="${escapeRegExp(key)}">${escapeRegExp(placeholder)}</mark>`, "g");
    const textPattern = new RegExp(escapeRegExp(placeholder), "g");
    const escaped = escapeHtml(value);
    if (markPattern.test(result)) {
      result = result.replace(markPattern, escaped);
      filled.push(key);
    } else if (textPattern.test(result)) {
      result = result.replace(textPattern, escaped);
      filled.push(key);
    }
  }
  return { html: result, filled };
}

export function templateMatchesCase(template, caseType) {
  const normalized = String(caseType || "").toLowerCase();
  if (!normalized) return template.caseTags.includes("general");
  return template.caseTags.includes("general") || template.caseTags.some((tag) => normalized.includes(String(tag).toLowerCase()) || String(tag).toLowerCase().includes(normalized));
}
