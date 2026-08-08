import prisma from "./prisma/client.js";

function workflowStep(title, description, priority = "Normal") {
  return {
    title,
    description,
    priority,
  };
}

export const DEFAULT_WORKFLOW_TEMPLATES = [
  {
    caseType: "Canadian Citizenship",
    name: "Canadian Citizenship Workflow",
    description: "Default milestones for a Canadian citizenship application.",
    aliases: ["Citizenship"],
    steps: [
      workflowStep("Retainer Agreement", "Service agreement issued; client signs and pays.", "High"),
      workflowStep("Document Request", "PR card, travel history, tax records, photographs, language evidence.", "High"),
      workflowStep("Immigration Forms", "Citizenship application forms completed by representative."),
      workflowStep("Client Review and Signature", "Client reviews and signs the application package.", "High"),
      workflowStep("Submit to IRCC", "Application submitted; government fees paid.", "Urgent"),
      workflowStep("Acknowledgement of Receipt", "AoR received from IRCC and shared with client."),
      workflowStep("Citizenship Knowledge Test", "Client notified of test date; preparation materials shared.", "High"),
      workflowStep("Test Result", "Pass or fail communicated; next steps confirmed with client."),
      workflowStep("Oath of Citizenship", "Notice to appear for oath issued; client attends ceremony.", "High"),
      workflowStep("Certificate of Citizenship", "Client confirmed as Canadian citizen; certificate obtained."),
    ],
  },
  {
    caseType: "General Consultation",
    name: "General Consultation Workflow",
    description: "Default milestones for consultation-only matters.",
    aliases: ["Consultation", "General"],
    steps: [
      workflowStep("Prospect Created", "Lead captured in CRM; initial contact information recorded."),
      workflowStep("Book Meeting", "Consultation appointment scheduled; confirmation sent to client.", "High"),
      workflowStep("Review Documents and Prepare", "Representative reviews any documents provided prior to the meeting."),
      workflowStep("Consultation", "Meeting held; eligibility assessed; immigration options discussed.", "High"),
      workflowStep("Follow-up Letter", "Written summary of advice and recommended pathway provided to client."),
      workflowStep("Invoice and Close", "Consultation fee invoiced; matter closed or converted to a full-service retainer."),
    ],
  },
  {
    caseType: "LMIA - Employer Service",
    name: "LMIA - Employer Service Workflow",
    description: "Default milestones for employer-side LMIA files.",
    aliases: ["LMIA"],
    steps: [
      workflowStep("Retainer Agreement", "Employer signs service agreement and pays retainer.", "High"),
      workflowStep(
        "Document Request",
        "Business registration, financial statements, payroll records, job description, recruitment records.",
        "High"
      ),
      workflowStep("Document Review", "All employer documents reviewed for completeness.", "High"),
      workflowStep("Information for Job Advertisements", "Employer provides position details for compliant advertising."),
      workflowStep("Post Job Advertisements", "Ads placed on required platforms; monitoring period begins.", "High"),
      workflowStep("Monitor Responses", "Track applicants; document recruitment efforts as required by ESDC."),
      workflowStep("Immigration Forms", "ESDC application forms prepared using employer-provided data."),
      workflowStep("Submit to ESDC", "LMIA application submitted; government fees paid.", "Urgent"),
      workflowStep("ESDC Response", "Approval or refusal received; LMIA number issued if approved.", "High"),
    ],
  },
  {
    caseType: "PR - Express Entry - PNP",
    name: "PR - Express Entry - PNP Workflow",
    description: "Default milestones for permanent residence, Express Entry, and PNP files.",
    aliases: ["Express Entry", "PNP", "PR", "Permanent Residence"],
    steps: [
      workflowStep("Initial Consultation", "Discuss eligibility options and strategy with client.", "High"),
      workflowStep("Assessment Questionnaire", "Client completes eligibility questionnaire; representative scores CRS or provincial criteria."),
      workflowStep("Retainer Agreement", "Service agreement and deposit invoice issued; client signs and pays.", "High"),
      workflowStep(
        "Document Request",
        "Customised checklist issued: ID, language test results, ECA, employment records, financial documents.",
        "High"
      ),
      workflowStep("Document Review", "Case manager verifies all documents for completeness, language, and accuracy.", "High"),
      workflowStep("Immigration Forms", "Required IMM forms completed; client reviews and signs."),
      workflowStep("ITA or Provincial Nomination", "Express Entry draw invitation or PNP notification received and confirmed with client.", "High"),
      workflowStep("RCIC Review", "Licensed representative performs final review of the complete application package.", "High"),
      workflowStep("Submit to IRCC", "Application uploaded to IRCC portal; government fees paid.", "Urgent"),
      workflowStep("Biometrics or Medical", "Client attends biometrics appointment or completes medical exam as directed by IRCC."),
      workflowStep("IRCC Correspondence", "Respond to any additional IRCC requests such as ADR or procedural fairness letters.", "High"),
      workflowStep("Decision", "IRCC decision communicated to client; CoPR or refusal letter provided.", "High"),
    ],
  },
  {
    caseType: "Spousal and Family Sponsorship",
    name: "Spousal and Family Sponsorship Workflow",
    description: "Default milestones for spousal and family sponsorship files.",
    aliases: ["Spousal Sponsorship", "Family Sponsorship"],
    steps: [
      workflowStep("Initial Consultation", "Assess sponsor eligibility and applicant relationship documentation.", "High"),
      workflowStep("Retainer Agreement", "Service agreement and deposit invoice issued; client signs and pays.", "High"),
      workflowStep("Document Request - Sponsor", "Proof of citizenship or PR status, income and NOA, relationship evidence.", "High"),
      workflowStep("Document Request - Applicant", "Passport, police certificates, medical records, relationship evidence.", "High"),
      workflowStep("Immigration Forms", "Sponsorship and PR application forms completed; both parties review and sign."),
      workflowStep("Application Package Review", "RCIC reviews complete package for accuracy and completeness.", "High"),
      workflowStep("Submit to IRCC", "Sponsorship and PR application submitted; government fees paid.", "Urgent"),
      workflowStep("Acknowledgement of Receipt", "Acknowledgement of receipt confirmed; processing communications managed."),
      workflowStep("Biometrics or Medical", "Instructions issued to applicant as directed by IRCC."),
      workflowStep("IRCC Correspondence", "Respond to any additional IRCC requests.", "High"),
      workflowStep("Decision", "Approval or refusal communicated; CoPR issued if approved.", "High"),
    ],
  },
  {
    caseType: "Study Permit",
    name: "Study Permit Workflow",
    description: "Default milestones for a study permit application.",
    aliases: ["Study"],
    steps: [
      workflowStep("Initial Consultation", "Assess eligibility; identify designated learning institutions and suitable programs.", "High"),
      workflowStep("Assessment Questionnaire", "Client completes intake form including academic history and proof of funding."),
      workflowStep("Retainer Agreement", "Service agreement and deposit invoice issued; client signs and pays.", "High"),
      workflowStep("School Application Support", "Assist client with DLI application; track acceptance status."),
      workflowStep("Letter of Acceptance (LOA)", "Confirm preliminary and official LOA from institution.", "High"),
      workflowStep("Document Request", "Passport, financial proof, academic transcripts, language test results, photographs.", "High"),
      workflowStep("Document Review", "Review all documents for completeness and accuracy.", "High"),
      workflowStep("Immigration Forms", "Study permit application forms completed; client reviews and signs."),
      workflowStep("Submit to IRCC", "Application uploaded to IRCC portal; government fees paid.", "Urgent"),
      workflowStep("Biometrics (if required)", "Biometric request instructions issued to client."),
      workflowStep("IRCC Correspondence", "Respond to any additional IRCC requests.", "High"),
      workflowStep("Decision", "Approval or refusal communicated; entry instructions prepared if approved.", "High"),
    ],
  },
  {
    caseType: "Visitor Visa - TRV",
    name: "Visitor Visa - TRV Workflow",
    description: "Default milestones for visitor visa and temporary resident visa files.",
    aliases: ["Visitor Visa", "TRV"],
    steps: [
      workflowStep("Initial Consultation", "Assess travel purpose and eligibility.", "High"),
      workflowStep("Assessment Questionnaire", "Client completes intake form with travel history and ties to home country."),
      workflowStep("Retainer Agreement", "Service agreement and deposit invoice issued; client signs and pays.", "High"),
      workflowStep(
        "Document Request",
        "Passport, financial statements, employment letter, travel itinerary, ties to home country evidence.",
        "High"
      ),
      workflowStep("Document Review", "Representative reviews documents for adequacy.", "High"),
      workflowStep("Immigration Forms", "TRV application forms completed; client reviews and signs."),
      workflowStep("Submit to IRCC", "Application submitted online; government fees paid.", "Urgent"),
      workflowStep("Biometrics (if required)", "Biometric instructions issued to client."),
      workflowStep("IRCC Correspondence", "Respond to any additional IRCC requests.", "High"),
      workflowStep("Decision", "Approval or refusal communicated; visa instructions provided if approved.", "High"),
    ],
  },
  {
    caseType: "Work permit / Open Work permit",
    name: "Work permit / Open Work permit Workflow",
    description: "Default milestones for work permit, open work permit, and PGWP files.",
    aliases: ["Work Permit", "Open Work Permit", "PGWP", "Post-Graduation Work Permit"],
    steps: [
      workflowStep("Initial Consultation", "Assess client and employer eligibility; determine applicable permit stream.", "High"),
      workflowStep("Assessment Questionnaire", "Client and employer complete intake questionnaires."),
      workflowStep("Retainer Agreement", "Service agreement and deposit invoice issued; client signs and pays.", "High"),
      workflowStep("Document Request - Applicant", "Passport, work history, qualifications, photos, financial documents.", "High"),
      workflowStep(
        "Document Request - Employer",
        "Offer of employment, business registration, payroll records; LMIA or ESDC number if LMIA-exempt.",
        "High"
      ),
      workflowStep("LMIA (if required)", "Post job ads, monitor applications, prepare ESDC submission, await decision.", "High"),
      workflowStep("Immigration Forms", "Work permit application forms completed; client reviews and signs."),
      workflowStep("Biometrics or Medical", "Biometric or medical instructions issued to client as applicable."),
      workflowStep("Submit to IRCC", "Application submitted online; government fees paid.", "Urgent"),
      workflowStep("IRCC Correspondence", "Respond to any additional IRCC information requests.", "High"),
      workflowStep("Decision", "Approval or refusal communicated; entry package prepared if approved.", "High"),
    ],
  },
];

export function normalizeCaseType(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeNullableString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

export function getTemplateCaseTypeKeys(template) {
  return [template.caseType, ...(template.aliases || [])].map(normalizeCaseType);
}

// Case types are stored as text because agencies can add their own services,
// but known aliases should always collapse to the curated display label. This
// keeps dropdowns, workflow matching, and document templates on one value.
export function canonicalCaseType(value) {
  const trimmed = String(value || "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const normalized = normalizeCaseType(trimmed);
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => getTemplateCaseTypeKeys(item).includes(normalized));
  return template?.caseType || trimmed;
}

export function canonicalCaseTypeLabels(value) {
  const canonical = canonicalCaseType(value);
  if (!canonical) return [];
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => normalizeCaseType(item.caseType) === normalizeCaseType(canonical));
  return template ? [template.caseType, ...(template.aliases || [])] : [canonical];
}

function templateMatchesCaseType(template, caseType) {
  return getTemplateCaseTypeKeys(template).includes(normalizeCaseType(caseType));
}

function templateStepsAreCurrent(existingSteps, desiredSteps) {
  if (existingSteps.length !== desiredSteps.length) {
    return false;
  }

  return desiredSteps.every((step, index) => {
    const existingStep = existingSteps[index];

    return (
      existingStep &&
      existingStep.title === step.title &&
      normalizeNullableString(existingStep.description) === normalizeNullableString(step.description) &&
      existingStep.priority === (step.priority || "Normal") &&
      existingStep.sortOrder === index + 1 &&
      existingStep.isRequired === true
    );
  });
}

async function replaceTemplateSteps(db, { agencyId, templateId, steps }) {
  await db.workflowTemplateStep.deleteMany({
    where: {
      agencyId,
      templateId,
    },
  });

  await db.workflowTemplateStep.createMany({
    data: steps.map((step, index) => ({
      agencyId,
      templateId,
      title: step.title,
      description: normalizeNullableString(step.description),
      priority: step.priority || "Normal",
      sortOrder: index + 1,
      isRequired: true,
    })),
  });
}

export function getDefaultWorkflowTemplates() {
  return DEFAULT_WORKFLOW_TEMPLATES;
}

export async function ensureDefaultWorkflowTemplates(db = prisma, agencyId) {
  const existingTemplates = await db.workflowTemplate.findMany({
    where: { agencyId, isDefault: true },
    select: {
      id: true,
      caseType: true,
      name: true,
      description: true,
      steps: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  const syncedTemplateIds = new Set();

  for (const template of DEFAULT_WORKFLOW_TEMPLATES) {
    const existingTemplate =
      existingTemplates.find(
        (item) => !syncedTemplateIds.has(item.id) && normalizeCaseType(item.name) === normalizeCaseType(template.name)
      ) ||
      existingTemplates.find((item) => !syncedTemplateIds.has(item.id) && templateMatchesCaseType(template, item.caseType));

    if (existingTemplate) {
      syncedTemplateIds.add(existingTemplate.id);

      if (
        existingTemplate.caseType !== template.caseType ||
        existingTemplate.name !== template.name ||
        normalizeNullableString(existingTemplate.description) !== normalizeNullableString(template.description)
      ) {
        await db.workflowTemplate.update({
          where: { id: existingTemplate.id },
          data: {
            caseType: template.caseType,
            name: template.name,
            description: template.description,
          },
        });
      }

      if (!templateStepsAreCurrent(existingTemplate.steps, template.steps)) {
        await replaceTemplateSteps(db, {
          agencyId,
          templateId: existingTemplate.id,
          steps: template.steps,
        });
      }

      continue;
    }

    const createdTemplate = await db.workflowTemplate.create({
      data: {
        agencyId,
        caseType: template.caseType,
        name: template.name,
        description: template.description,
        isDefault: true,
        steps: {
          create: template.steps.map((step, index) => ({
            agencyId,
            title: step.title,
            description: normalizeNullableString(step.description),
            priority: step.priority,
            sortOrder: index + 1,
            isRequired: true,
          })),
        },
      },
    });

    syncedTemplateIds.add(createdTemplate.id);
  }

  await db.workflowTemplate.deleteMany({
    where: {
      agencyId,
      isDefault: true,
      id: {
        notIn: [...syncedTemplateIds],
      },
    },
  });
}

export async function findWorkflowTemplateForCaseType(db = prisma, { agencyId, caseType }) {
  await ensureDefaultWorkflowTemplates(db, agencyId);

  const templates = await db.workflowTemplate.findMany({
    where: {
      agencyId,
      isDefault: true,
    },
    include: {
      steps: {
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ caseType: "asc" }, { createdAt: "asc" }],
  });

  const normalizedCaseType = normalizeCaseType(caseType);
  return (
    templates.find((template) => normalizeCaseType(template.caseType) === normalizedCaseType) ||
    DEFAULT_WORKFLOW_TEMPLATES.map((defaultTemplate) => ({
      defaultTemplate,
      template: templates.find((template) => normalizeCaseType(template.caseType) === normalizeCaseType(defaultTemplate.caseType)),
    })).find(({ defaultTemplate, template }) => template && templateMatchesCaseType(defaultTemplate, normalizedCaseType))?.template ||
    templates.find((template) => normalizeCaseType(template.caseType) === "general consultation") ||
    null
  );
}

export async function assignDefaultWorkflowToCase(db = prisma, { agencyId, caseId, caseType }) {
  const existingCount = await db.caseWorkflowStep.count({
    where: {
      agencyId,
      caseId,
    },
  });

  if (existingCount > 0) {
    return { createdCount: 0, template: null };
  }

  const template = await findWorkflowTemplateForCaseType(db, { agencyId, caseType });

  if (!template?.steps?.length) {
    return { createdCount: 0, template };
  }

  const steps = template.steps.map((step, index) => ({
    agencyId,
    caseId,
    templateId: template.id,
    templateStepId: step.id,
    title: step.title,
    description: step.description,
    priority: step.priority,
    sortOrder: index + 1,
    isActive: true,
    status: "Pending",
  }));

  const result = await db.caseWorkflowStep.createMany({
    data: steps,
  });

  return { createdCount: result.count, template };
}
