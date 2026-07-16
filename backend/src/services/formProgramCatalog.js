const formsRoot = "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides";

const form = (id, number, title, programs, options = {}) => ({
  id,
  number,
  title,
  programs,
  requirement: options.requirement || "Required",
  reason: options.reason || "Required by the selected application package",
  officialUrl: options.officialUrl || `${formsRoot}/${number.toLowerCase().replace(/\s+/g, "")}.html`,
  revision: options.revision || null,
  mappingVersion: options.mappingVersion || null,
  language: options.language || "English",
  condition: options.condition || null,
  importable: options.importable !== false,
});

const temporaryOutside = ["visitor-visa", "study-permit", "work-permit", "super-visa"];
const economicPr = ["cec", "fsw", "fst", "pnp", "atlantic-immigration", "rural-community-pilot", "francophone-community-pilot", "start-up-visa"];
const sponsorship = ["spouse-sponsorship", "dependent-child-sponsorship", "parents-grandparents-sponsorship"];
const immigrationPrograms = [...temporaryOutside, "visitor-extension", "study-permit-extension", "work-permit-extension", "pgwp", ...economicPr, ...sponsorship, "trp-holder-pr", "in-canada-refugee-claim", "outside-canada-refugee", "protected-person-pr", "humanitarian-compassionate", "criminal-rehabilitation"];

export const officialFormCatalog = [
  form("imm-5257", "IMM 5257", "Application for Temporary Resident Visa", ["visitor-visa", "super-visa"]),
  form("imm-5484", "IMM 5484", "Document Checklist for a Temporary Resident Visa", ["visitor-visa", "super-visa"]),
  form("imm-5708", "IMM 5708", "Application to Change Conditions, Extend Stay or Remain in Canada as a Visitor", ["visitor-extension"]),
  form("imm-5558", "IMM 5558", "Document Checklist for Visitor Status", ["visitor-extension"], { requirement: "Optional", reason: "Checklist for an in-Canada visitor extension package" }),
  form("imm-1294", "IMM 1294", "Application for a Study Permit Made Outside Canada", ["study-permit"], { revision: "2024-10", mappingVersion: "IMM1294.ENU.10-2024.v1" }),
  form("imm-5483", "IMM 5483", "Document Checklist for a Study Permit", ["study-permit"]),
  form("imm-5709", "IMM 5709", "Application to Extend a Study Permit or Remain in Canada as a Student", ["study-permit-extension"]),
  form("imm-5555", "IMM 5555", "Document Checklist for a Study Permit Extension", ["study-permit-extension"], { requirement: "Optional", reason: "Checklist for an in-Canada study permit extension" }),
  form("imm-1295", "IMM 1295", "Application for a Work Permit Made Outside Canada", ["work-permit"]),
  form("imm-5488", "IMM 5488", "Document Checklist for a Work Permit Outside Canada", ["work-permit"]),
  form("imm-5710", "IMM 5710", "Application to Extend or Change Conditions as a Worker", ["work-permit-extension", "pgwp"]),
  form("imm-5556", "IMM 5556", "Document Checklist for Workers in Canada", ["work-permit-extension", "pgwp"], { requirement: "Optional", reason: "Checklist for an in-Canada work permit application" }),
  form("imm-5707", "IMM 5707", "Family Information", temporaryOutside, { requirement: "Conditional", reason: "May be required based on age, family composition and visa-office instructions" }),
  form("imm-5409", "IMM 5409", "Statutory Declaration of Common-Law Union", immigrationPrograms, { requirement: "Conditional", condition: "commonLaw", reason: "Required when the application relies on a common-law relationship" }),
  form("imm-5646", "IMM 5646", "Custodianship Declaration", ["study-permit"], { requirement: "Conditional", condition: "minor", reason: "May be required for a minor studying in Canada" }),
  form("imm-5476", "IMM 5476", "Use of a Representative", immigrationPrograms, { requirement: "Conditional", condition: "represented", reason: "Required when appointing or changing an authorized representative" }),
  form("imm-5475", "IMM 5475", "Authority to Release Personal Information to a Designated Individual", immigrationPrograms, { requirement: "Optional", reason: "Only when the applicant designates another person to receive case information" }),
  form("imm-0008", "IMM 0008", "Generic Application Form for Canada", [...economicPr, ...sponsorship, "trp-holder-pr", "outside-canada-refugee", "protected-person-pr", "humanitarian-compassionate"]),
  form("imm-5669", "IMM 5669", "Schedule A – Background/Declaration", [...economicPr, ...sponsorship, "trp-holder-pr", "protected-person-pr", "humanitarian-compassionate"]),
  form("imm-5406", "IMM 5406", "Additional Family Information", [...economicPr, ...sponsorship, "trp-holder-pr", "protected-person-pr", "humanitarian-compassionate"]),
  form("imm-5562", "IMM 5562", "Supplementary Information – Your Travels", economicPr, { requirement: "Conditional", reason: "Required when requested by the applicable permanent-residence package" }),
  form("imm-1344", "IMM 1344", "Application to Sponsor, Sponsorship Agreement and Undertaking", sponsorship),
  form("imm-5532", "IMM 5532", "Relationship Information and Sponsorship Evaluation", ["spouse-sponsorship"]),
  form("imm-5533", "IMM 5533", "Document Checklist – Spouse or Common-Law Partner", ["spouse-sponsorship"]),
  form("imm-5768", "IMM 5768", "Financial Evaluation for Parents and Grandparents Sponsorship", ["parents-grandparents-sponsorship"]),
  form("imm-5771", "IMM 5771", "Document Checklist – Parents and Grandparents", ["parents-grandparents-sponsorship"]),
  form("imm-5280", "IMM 5280", "Document Checklist – Humanitarian and Compassionate Considerations", ["humanitarian-compassionate"]),
  form("imm-5283", "IMM 5283", "Supplementary Information – Humanitarian and Compassionate Considerations", ["humanitarian-compassionate"]),
  form("imm-5286", "IMM 5286", "Document Checklist – Protected Persons and Convention Refugees", ["protected-person-pr"]),
  form("imm-0008-sch12", "IMM 0008 SCH12", "Schedule 12 – Additional Information for Refugee Claimants Inside Canada", ["in-canada-refugee-claim"]),
  form("imm-0175", "IMM 0175", "Authorization for a Representative to Submit a Refugee Claim", ["in-canada-refugee-claim"]),
  form("irb-boc", "IRB BOC", "Basis of Claim Form", ["in-canada-refugee-claim"], { officialUrl: "https://www.canada.ca/en/immigration-refugees-citizenship/services/asylum/in-canada/start-online.html", importable: false, reason: "Mandatory for each claimant; obtain the current form through the IRB/IRCC claim instructions" }),
  form("imm-0008-sch2", "IMM 0008 SCH2", "Schedule 2 – Refugees Outside Canada", ["outside-canada-refugee"]),
  form("imm-1444", "IMM 1444", "Application for Criminal Rehabilitation", ["criminal-rehabilitation"]),
  form("imm-5507", "IMM 5507", "Document Checklist – Criminal Rehabilitation", ["criminal-rehabilitation"]),
  form("cit-0002", "CIT 0002", "Application for Canadian Citizenship – Adults", ["citizenship-grant"], { condition: "adult" }),
  form("cit-0003", "CIT 0003", "Application for Canadian Citizenship – Minors", ["citizenship-grant"], { requirement: "Conditional", condition: "minor", reason: "Used when the citizenship applicant is under 18" }),
  form("cit-0007", "CIT 0007", "Document Checklist – Citizenship Grant for Adults", ["citizenship-grant"], { condition: "adult" }),
  form("cit-0008", "CIT 0008", "Document Checklist – Citizenship Grant for Minors", ["citizenship-grant"], { requirement: "Conditional", condition: "minor", reason: "Checklist for a citizenship applicant under 18" }),
  form("cit-0001", "CIT 0001", "Application for a Citizenship Certificate", ["citizenship-certificate"]),
  form("cit-0014", "CIT 0014", "Document Checklist – Citizenship Certificate", ["citizenship-certificate"]),
  form("cit-0302", "CIT 0302", "Application to Renounce Canadian Citizenship", ["citizenship-renunciation"]),
  form("cit-0301", "CIT 0301", "Application to Resume Canadian Citizenship", ["citizenship-resumption"]),
  form("cit-0012", "CIT 0012", "Adoptee's Application for Canadian Citizenship", ["citizenship-adopted"]),
];

const programAliases = {
  "visitor-visa": ["visitor visa", "temporary resident visa", "trv"],
  "visitor-extension": ["visitor visa extension", "visitor record", "extend visitor"],
  "study-permit": ["study permit"],
  "study-permit-extension": ["study permit extension", "extend study permit"],
  "work-permit": ["work permit"],
  "work-permit-extension": ["work permit extension", "extend work permit"],
  pgwp: ["post-graduation work permit", "post graduation work permit", "pgwp"],
  "super-visa": ["super visa"],
  cec: ["canadian experience class", "cec"],
  fsw: ["federal skilled worker", "fsw"],
  fst: ["federal skilled trades", "fst"],
  pnp: ["provincial nominee", "pnp"],
  "start-up-visa": ["start-up", "startup"],
  "spouse-sponsorship": ["spouse", "common-law", "conjugal", "spousal sponsorship"],
  "dependent-child-sponsorship": ["dependent child", "dependant child", "adopted child"],
  "parents-grandparents-sponsorship": ["parents", "grandparents", "pgp"],
  "protected-person-pr": ["protected person"],
  "in-canada-refugee-claim": ["in canada refugee claim", "refugee protection claim", "asylum claim"],
  "outside-canada-refugee": ["outside canada refugee", "refugee resettlement"],
  "humanitarian-compassionate": ["humanitarian", "compassionate", "h&c"],
  "citizenship-grant": ["citizenship grant", "canadian citizenship"],
  "citizenship-certificate": ["citizenship certificate", "proof of citizenship"],
  "citizenship-renunciation": ["citizenship renunciation"],
  "citizenship-resumption": ["citizenship resumption"],
  "citizenship-adopted": ["citizenship for adopted"],
  "criminal-rehabilitation": ["criminal rehabilitation", "rehabilitation"],
};

const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function resolveProgramId(caseItem, assessment) {
  const assignments = Array.isArray(assessment?.formData?.questionnaireAssignments) ? assessment.formData.questionnaireAssignments : [];
  const values = [assignments.at(-1)?.applicationType, assignments.at(-1)?.name, caseItem?.caseType].map(normalize).filter(Boolean);
  let best = null;
  for (const [programId, aliases] of Object.entries(programAliases)) {
    for (const alias of aliases) {
      const normalizedAlias = normalize(alias);
      if (values.some((value) => value === normalizedAlias)) return programId;
      if (!best && values.some((value) => value.includes(normalizedAlias) || normalizedAlias.includes(value))) best = programId;
    }
  }
  return best;
}

function flattenValues(value, output = []) {
  if (Array.isArray(value)) value.forEach((item) => flattenValues(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => flattenValues(item, output));
  else if (value !== null && value !== undefined) output.push(normalize(value));
  return output;
}

function conditionApplies(condition, caseItem, assessment) {
  if (!condition) return true;
  if (condition === "represented") return true;
  if (condition === "minor") {
    const birthDate = caseItem?.client?.dateOfBirth ? new Date(caseItem.client.dateOfBirth) : null;
    if (!birthDate || Number.isNaN(birthDate.getTime())) return false;
    const age = new Date().getUTCFullYear() - birthDate.getUTCFullYear();
    return age < 18;
  }
  if (condition === "adult") {
    const birthDate = caseItem?.client?.dateOfBirth ? new Date(caseItem.client.dateOfBirth) : null;
    if (!birthDate || Number.isNaN(birthDate.getTime())) return true;
    const age = new Date().getUTCFullYear() - birthDate.getUTCFullYear();
    return age >= 18;
  }
  if (condition === "commonLaw") return flattenValues(assessment?.formData).some((value) => value.includes("common law"));
  return false;
}

export function buildCaseFormCatalog(caseItem, assessment) {
  const programId = resolveProgramId(caseItem, assessment);
  return {
    programId,
    verifiedAt: "2026-07-12",
    sourceUrl: formsRoot,
    forms: officialFormCatalog.map((entry) => ({
      ...entry,
      suggested: Boolean(programId && entry.programs.includes(programId) && entry.requirement !== "Optional" && conditionApplies(entry.condition, caseItem, assessment)),
      programMatch: Boolean(programId && entry.programs.includes(programId)),
    })),
  };
}

export function getOfficialForm(catalogId) {
  return officialFormCatalog.find((entry) => entry.id === catalogId) || null;
}
