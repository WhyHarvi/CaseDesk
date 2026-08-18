import { uniqueDocumentNames } from "../utils/documentNames.js";

const common = {
  identity: [
    "Passport or travel document bio page",
    "Passport pages with visas, stamps, and markings",
    "Digital photo meeting IRCC specifications",
  ],
  temporary: [
    "Proof of current immigration status, if applicable",
    "Proof of funds and financial support",
    "Purpose of travel or letter of explanation",
    "Family information documents, if applicable",
    "Certified translations, if applicable",
  ],
  permanentResidence: [
    "Birth certificate or equivalent identity record",
    "Civil status documents",
    "Police certificates",
    "Immigration medical examination confirmation",
    "Digital permanent residence photo",
    "Proof of payment of application fees",
    "Certified translations, if applicable",
  ],
  economic: [
    "Language test results",
    "Education credentials",
    "Educational Credential Assessment, if applicable",
    "Employment reference letters",
    "Proof of work experience",
    "Proof of settlement funds, if applicable",
  ],
  citizenship: [
    "Colour copies of passport or travel documents",
    "Canadian immigration status documents",
    "Citizenship photos",
    "Proof of payment receipt",
    "Certified translations, if applicable",
  ],
  representative: [
    "Use of a Representative authorization, if applicable",
  ],
};

const sources = {
  common: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/common-supporting-documents.html",
  forms: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides.html",
  visitor: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/guide-5256-applying-visitor-visa-temporary-resident-visa.html",
  study: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/guide-5269-applying-study-permit-outside-canada.html",
  work: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/guide-5487-applying-work-permit-outside-canada.html",
  expressEntry: "https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/documents.html",
  sponsorship: "https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/family-sponsorship/spouse-partner-children/apply.html",
  prCard: "https://www.canada.ca/en/immigration-refugees-citizenship/services/permanent-residents/card/apply.html",
  refugee: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5745.html",
  rehabilitation: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/application-rehabilitation-inadmissible-persons-criminal-activity.html",
  citizenshipProof: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/application-citizenship-certificate-adults-minors.html",
};

export const GLOBAL_CASE_TYPE_PROGRAMS = [
  {
    id: "visitor-visa",
    title: "Visitor Visa (TRV)",
    category: "Temporary residence",
    aliases: ["Temporary Resident Visa", "Tourist Visa"],
    sourceUrl: sources.visitor,
    base: ["identity", "temporary", "representative"],
    documents: ["Travel itinerary", "Invitation letter, if invited", "Proof of ties to home country", "Employment or study evidence", "Host status and financial documents, if applicable"],
  },
  {
    id: "visitor-extension",
    title: "Visitor Record / Extension",
    category: "Temporary residence",
    aliases: ["Visitor Visa Extension", "Extend Visitor Status"],
    sourceUrl: sources.forms,
    base: ["identity", "temporary", "representative"],
    documents: ["Current visitor record or status document", "Entry stamp or proof of entry", "Explanation for requested extension", "Planned departure evidence"],
  },
  {
    id: "study-permit",
    title: "Study Permit",
    category: "Temporary residence",
    aliases: ["Student Visa"],
    sourceUrl: sources.study,
    base: ["identity", "temporary", "representative"],
    documents: ["Letter of acceptance from a designated learning institution", "Provincial or territorial attestation letter, or exemption evidence", "Proof of tuition payment", "Study plan or statement of purpose", "Education transcripts and certificates", "Custodianship declaration, if applicable", "Immigration medical examination, if applicable"],
  },
  {
    id: "study-permit-extension",
    title: "Study Permit Extension",
    category: "Temporary residence",
    aliases: ["Extend Study Permit"],
    sourceUrl: sources.forms,
    base: ["identity", "temporary", "representative"],
    documents: ["Current study permit", "Letter of enrolment", "Academic transcripts", "Updated letter of acceptance, if applicable", "Proof of tuition payment", "Explanation for extension"],
  },
  {
    id: "work-permit",
    title: "Work Permit",
    category: "Temporary residence",
    aliases: ["Employer-specific Work Permit", "Open Work Permit"],
    sourceUrl: sources.work,
    base: ["identity", "temporary", "representative"],
    documents: ["Employment offer or contract", "LMIA decision letter or exemption evidence, if applicable", "Offer of employment number, if applicable", "Proof of qualifications for the position", "Resume or curriculum vitae", "Immigration medical examination, if applicable"],
  },
  {
    id: "work-permit-extension",
    title: "Work Permit Extension",
    category: "Temporary residence",
    aliases: ["Extend Work Permit"],
    sourceUrl: sources.forms,
    base: ["identity", "temporary", "representative"],
    documents: ["Current work permit", "Employment offer or contract", "Recent pay statements", "LMIA or exemption evidence, if applicable", "Proof of maintained employment", "Explanation for extension"],
  },
  {
    id: "pgwp",
    title: "Post-Graduation Work Permit (PGWP)",
    category: "Temporary residence",
    aliases: ["PGWP", "Post Graduation Work Permit"],
    sourceUrl: sources.forms,
    base: ["identity", "representative"],
    documents: ["Current study permit", "Official program completion letter", "Final transcript", "Degree, diploma, or certificate, if available", "Proof of full-time study and authorized leave, if applicable", "Language test results, if required for the program level"],
  },
  {
    id: "super-visa",
    title: "Super Visa",
    category: "Temporary residence",
    aliases: ["Parents and Grandparents Super Visa"],
    sourceUrl: sources.visitor,
    base: ["identity", "temporary", "representative"],
    documents: ["Invitation letter from child or grandchild", "Proof of relationship to host", "Host proof of Canadian citizenship or permanent residence", "Host minimum income evidence", "Private medical insurance policy", "Immigration medical examination confirmation"],
  },
  {
    id: "eta",
    title: "Electronic Travel Authorization (eTA)",
    category: "Temporary residence",
    aliases: ["eTA"],
    sourceUrl: sources.forms,
    base: [],
    documents: ["Valid passport bio page", "Travel details", "Supporting records for any prior refusal or admissibility disclosure, if applicable"],
  },
  {
    id: "cec",
    title: "Canadian Experience Class",
    category: "Express Entry",
    aliases: ["CEC"],
    sourceUrl: sources.expressEntry,
    base: ["identity", "permanentResidence", "economic", "representative"],
    documents: ["Canadian work permits", "Canadian employment records and pay statements", "Notices of Assessment or tax slips, if available", "Proof of relationship to a Canadian relative, if claimed"],
  },
  {
    id: "fsw",
    title: "Federal Skilled Worker Program",
    category: "Express Entry",
    aliases: ["Federal Skilled Worker", "FSWP"],
    sourceUrl: sources.expressEntry,
    base: ["identity", "permanentResidence", "economic", "representative"],
    documents: ["Proof of foreign skilled work experience", "Proof of arranged employment, if claimed", "Proof of relationship to a Canadian relative, if claimed"],
  },
  {
    id: "fst",
    title: "Federal Skilled Trades Program",
    category: "Express Entry",
    aliases: ["Federal Skilled Trades", "FSTP"],
    sourceUrl: sources.expressEntry,
    base: ["identity", "permanentResidence", "economic", "representative"],
    documents: ["Certificate of qualification in a skilled trade, if applicable", "Qualifying job offer, if applicable", "Trade employment reference letters", "Trade licences or apprenticeship records"],
  },
  {
    id: "pnp",
    title: "Provincial Nominee Program",
    category: "Economic immigration",
    aliases: ["Provincial Nominee Programs", "PNP"],
    sourceUrl: sources.forms,
    base: ["identity", "permanentResidence", "economic", "representative"],
    documents: ["Provincial nomination certificate", "Provincial application approval or correspondence", "Proof of intention to reside in nominating province", "Provincial settlement plan, if applicable"],
  },
  {
    id: "atlantic-immigration",
    title: "Atlantic Immigration Program",
    category: "Economic immigration",
    aliases: ["AIP"],
    sourceUrl: sources.forms,
    base: ["identity", "permanentResidence", "economic", "representative"],
    documents: ["Provincial endorsement certificate", "Offer of employment from a designated employer", "Settlement plan", "Proof of qualifying work experience or international graduate status"],
  },
  {
    id: "rural-community-pilot",
    title: "Rural Community Immigration Pilot",
    category: "Economic immigration",
    aliases: ["RCIP"],
    sourceUrl: sources.forms,
    base: ["identity", "permanentResidence", "economic", "representative"],
    documents: ["Community recommendation certificate", "Offer of employment from a designated employer", "Proof of qualifying work experience or exemption", "Proof of settlement funds"],
  },
  {
    id: "francophone-community-pilot",
    title: "Francophone Community Immigration Pilot",
    category: "Economic immigration",
    aliases: ["FCIP"],
    sourceUrl: sources.forms,
    base: ["identity", "permanentResidence", "economic", "representative"],
    documents: ["Community recommendation certificate", "Offer of employment from a designated employer", "French language test results", "Proof of qualifying work experience or exemption", "Proof of settlement funds"],
  },
  {
    id: "quebec-skilled-worker",
    title: "Quebec-Selected Skilled Worker",
    category: "Economic immigration",
    aliases: ["Quebec Skilled Worker", "QSW"],
    sourceUrl: sources.forms,
    base: ["identity", "permanentResidence", "economic", "representative"],
    documents: ["Quebec Selection Certificate (CSQ)", "Proof of intention to reside in Quebec", "Quebec application correspondence"],
  },
  {
    id: "start-up-visa",
    title: "Start-up Business Class",
    category: "Business immigration",
    aliases: ["Start-up Business", "Start-up Visa", "SUV"],
    sourceUrl: sources.forms,
    base: ["identity", "permanentResidence", "economic", "representative"],
    documents: ["Commitment certificate from designated organization", "Letter of support from designated organization", "Business ownership and voting-right evidence", "Business plan and supporting venture documents", "Proof of settlement funds"],
  },
  {
    id: "trp-holder-pr",
    title: "Temporary Resident Permit Holder Class",
    category: "Permanent residence",
    aliases: ["Permit Holder Class", "TRP Holder Class"],
    sourceUrl: sources.forms,
    base: ["identity", "permanentResidence", "representative"],
    documents: ["Current and previous temporary resident permits", "Proof of continuous residence in Canada", "Records relating to the original inadmissibility, if applicable"],
  },
  {
    id: "pr-card",
    title: "Permanent Resident Card / Travel Document",
    category: "Permanent resident documents",
    aliases: ["Permanent Resident Card", "PR Card", "PRTD"],
    sourceUrl: sources.prCard,
    base: ["representative"],
    documents: ["Current or expired PR card, if available", "Confirmation of Permanent Residence or Record of Landing", "Passport used when becoming a permanent resident", "Proof of residency obligation", "PR card photos", "Payment receipt", "Proof of urgent travel, if applicable"],
  },
  {
    id: "spouse-sponsorship",
    title: "Spouse, Partner or Conjugal Sponsorship",
    category: "Family sponsorship",
    aliases: ["Spouse/Common-Law/Conjugal Partner Sponsorship", "Spousal Sponsorship"],
    sourceUrl: sources.sponsorship,
    base: ["identity", "permanentResidence", "representative"],
    documents: ["Sponsor proof of Canadian status", "Marriage certificate or common-law evidence", "Relationship photographs", "Proof of communication", "Proof of visits, travel, and cohabitation", "Sponsor employment and income evidence, if applicable", "Country-specific civil documents"],
  },
  {
    id: "dependent-child-sponsorship",
    title: "Dependent or Adopted Child Sponsorship",
    category: "Family sponsorship",
    aliases: ["Dependant Child/Adopted Child Sponsorship", "Dependent Child Sponsorship"],
    sourceUrl: sources.sponsorship,
    base: ["identity", "permanentResidence", "representative"],
    documents: ["Sponsor proof of Canadian status", "Child birth certificate", "Proof of parent-child relationship", "Custody documents", "Other parent consent and identity, if applicable", "Adoption records, if applicable", "Country-specific civil documents"],
  },
  {
    id: "parents-grandparents-sponsorship",
    title: "Parents and Grandparents Sponsorship",
    category: "Family sponsorship",
    aliases: ["Parents/Grandparents/Orphaned Relatives/Other Relatives", "PGP"],
    sourceUrl: sources.forms,
    base: ["identity", "permanentResidence", "representative"],
    documents: ["Invitation to apply", "Sponsor proof of Canadian status", "Proof of relationship", "Sponsor Notices of Assessment", "Financial evaluation and income evidence", "Co-signer documents, if applicable", "Country-specific civil documents"],
  },
  {
    id: "in-canada-refugee-claim",
    title: "In-Canada Refugee Claim",
    category: "Refugee and protection",
    aliases: ["In Canada – Refugee Claim", "Refugee Protection Claim"],
    sourceUrl: sources.refugee,
    base: ["identity", "representative"],
    documents: ["Basis of Claim narrative and supporting evidence", "Evidence of risk, threats, or persecution", "Family identity documents", "Travel and entry documents", "Country condition evidence", "Police, medical, or witness records, if applicable"],
  },
  {
    id: "protected-person-pr",
    title: "Protected Person – Permanent Residence",
    category: "Refugee and protection",
    aliases: ["In Canada – Protected Person", "Protected Person"],
    sourceUrl: sources.forms,
    base: ["identity", "permanentResidence", "representative"],
    documents: ["Notice of Decision or Verification of Status", "Protected person status evidence", "Family identity and relationship documents", "Documents for overseas dependants, if applicable"],
  },
  {
    id: "outside-canada-refugee",
    title: "Outside-Canada Refugee Resettlement",
    category: "Refugee and protection",
    aliases: ["Outside Canada – Refugee", "Refugee Resettlement"],
    sourceUrl: sources.forms,
    base: ["identity", "representative"],
    documents: ["Refugee recognition or registration documents", "Identity and family documents", "Refugee narrative and supporting evidence", "Sponsorship undertaking or referral documents", "Settlement plan, if applicable"],
  },
  {
    id: "humanitarian-compassionate",
    title: "Humanitarian and Compassionate Considerations",
    category: "Humanitarian",
    aliases: ["In Canada - Humanitarian & Compassionate Considerations", "H&C"],
    sourceUrl: sources.forms,
    base: ["identity", "permanentResidence", "representative"],
    documents: ["Evidence of establishment in Canada", "Evidence of hardship on return", "Best interests of affected children evidence", "Family and community ties", "Letters of support", "Medical or psychological evidence, if applicable", "Financial and tax records"],
  },
  {
    id: "citizenship-grant",
    title: "Canadian Citizenship Grant",
    category: "Citizenship",
    aliases: ["Citizenship Grant", "Adult Citizenship"],
    sourceUrl: sources.forms,
    base: ["citizenship", "representative"],
    documents: ["Permanent resident card or Confirmation of Permanent Residence", "Physical presence calculation", "Language evidence, if required", "Tax filing evidence", "Name-change documents, if applicable"],
  },
  {
    id: "citizenship-certificate",
    title: "Citizenship Certificate / Proof",
    category: "Citizenship",
    aliases: ["Citizenship Certificate (Proof of Citizenship)", "Proof of Citizenship"],
    sourceUrl: sources.citizenshipProof,
    base: ["representative"],
    documents: ["Applicant birth certificate", "Parent's Canadian citizenship evidence", "Parent's birth certificate, if applicable", "Government-issued identity documents", "Citizenship photos", "Name-change or relationship documents, if applicable", "Payment receipt"],
  },
  {
    id: "citizenship-renunciation",
    title: "Citizenship Renunciation",
    category: "Citizenship",
    aliases: ["Citizenship Renunciation"],
    sourceUrl: sources.forms,
    base: ["representative"],
    documents: ["Canadian citizenship certificate", "Canadian passport, if available", "Proof of another citizenship or assurance of citizenship", "Government-issued identity", "Citizenship photos", "Payment receipt"],
  },
  {
    id: "citizenship-resumption",
    title: "Citizenship Resumption",
    category: "Citizenship",
    aliases: ["Citizenship Resumption"],
    sourceUrl: sources.forms,
    base: ["citizenship", "representative"],
    documents: ["Proof of former Canadian citizenship", "Proof citizenship was renounced or lost", "Permanent resident status evidence", "Physical presence evidence", "Tax filing evidence, if required"],
  },
  {
    id: "citizenship-adopted",
    title: "Citizenship for Adopted Person",
    category: "Citizenship",
    aliases: ["Citizenship for Adopted Children", "Adopted Person Citizenship"],
    sourceUrl: sources.forms,
    base: ["representative"],
    documents: ["Adoption order and supporting adoption records", "Adopted person's birth certificate", "Canadian parent's citizenship evidence", "Proof of parent-child relationship", "Government-issued identity documents", "Citizenship photos"],
  },
  {
    id: "criminal-rehabilitation",
    title: "Criminal Rehabilitation",
    category: "Admissibility",
    aliases: ["Rehabilitation", "Criminal Inadmissibility"],
    sourceUrl: sources.rehabilitation,
    base: ["identity", "representative"],
    documents: ["Court judgments and charge records", "Police certificates and criminal record checks", "Proof all sentences, fines, and probation were completed", "Detailed statement of circumstances", "Evidence of rehabilitation", "Employment and community reference letters", "Record suspension documents, if applicable"],
  },
];

function uniqueDocuments(program) {
  const documents = [
    ...program.base.flatMap((key) => common[key] || []),
    ...program.documents,
  ];

  return uniqueDocumentNames(documents);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function slugify(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildDocumentProgramCatalog(agencyTemplates = []) {
  const catalog = GLOBAL_CASE_TYPE_PROGRAMS.map((program) => ({
    id: program.id,
    title: program.title,
    category: program.category,
    aliases: program.aliases || [],
    sourceUrl: program.sourceUrl || sources.common,
    sourceLabel: "IRCC program guidance",
    isAgencyTemplate: false,
    documents: uniqueDocuments(program),
  }));

  const matchedTemplateIds = new Set();

  for (const program of catalog) {
    const names = new Set([program.title, ...program.aliases].map(normalize));
    const matching = agencyTemplates.filter((template) => names.has(normalize(template.caseType)));

    if (matching.length) {
      matching.forEach((template) => matchedTemplateIds.add(template.id));
      program.documents = uniqueDocumentNames([
        ...program.documents,
        ...matching.map((template) => template.documentName),
      ]);
      program.agencyDocumentCount = matching.length;
    }
  }

  const customGroups = new Map();
  agencyTemplates
    .filter((template) => !matchedTemplateIds.has(template.id))
    .forEach((template) => {
      const key = template.caseType.trim();
      if (!customGroups.has(key)) customGroups.set(key, []);
      customGroups.get(key).push(template.documentName);
    });

  for (const [caseType, documents] of customGroups) {
    catalog.push({
      id: `agency-${slugify(caseType)}`,
      title: caseType,
      category: "Agency templates",
      aliases: [],
      sourceUrl: null,
      sourceLabel: "Agency template",
      isAgencyTemplate: true,
      documents: uniqueDocumentNames(documents),
    });
  }

  return catalog.sort((left, right) =>
    left.category.localeCompare(right.category) || left.title.localeCompare(right.title),
  );
}

export default buildDocumentProgramCatalog;
