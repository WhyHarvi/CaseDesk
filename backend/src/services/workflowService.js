import prisma from "./prisma/client.js";
import { GLOBAL_CASE_TYPE_PROGRAMS } from "./documentProgramCatalog.js";
import { CASE_STAGES } from "../constants/caseStages.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { logger } from "./logger.js";

export const WORKFLOW_AUTO_COMPLETE_EVENTS = Object.freeze({
  RETAINER_SIGNED: "RetainerSigned",
  PAYMENT_CONFIRMED: "PaymentConfirmed",
  RETAINER_AND_PAYMENT_CONFIRMED: "RetainerAndPaymentConfirmed",
  QUESTIONNAIRE_SUBMITTED: "QuestionnaireSubmitted",
  FORM_SIGNED: "FormSigned",
  FORM_FINALIZED: "FormFinalized",
  DOCUMENT_FINALIZED: "DocumentFinalized",
  APPLICATION_SUBMITTED: "ApplicationSubmitted",
  DECISION_RECORDED: "DecisionRecorded",
  CASE_CLOSED: "CaseClosed",
});

export const WORKFLOW_EVENT_LABELS = Object.freeze({
  [WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_SIGNED]: "retainer is signed",
  [WORKFLOW_AUTO_COMPLETE_EVENTS.PAYMENT_CONFIRMED]: "payment is confirmed",
  [WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_AND_PAYMENT_CONFIRMED]: "retainer is signed and initial payment is confirmed",
  [WORKFLOW_AUTO_COMPLETE_EVENTS.QUESTIONNAIRE_SUBMITTED]: "questionnaire is submitted",
  [WORKFLOW_AUTO_COMPLETE_EVENTS.FORM_SIGNED]: "case form is signed",
  [WORKFLOW_AUTO_COMPLETE_EVENTS.FORM_FINALIZED]: "case form is finalized",
  [WORKFLOW_AUTO_COMPLETE_EVENTS.DOCUMENT_FINALIZED]: "client document is finalized",
  [WORKFLOW_AUTO_COMPLETE_EVENTS.APPLICATION_SUBMITTED]: "application is submitted",
  [WORKFLOW_AUTO_COMPLETE_EVENTS.DECISION_RECORDED]: "decision is recorded",
  [WORKFLOW_AUTO_COMPLETE_EVENTS.CASE_CLOSED]: "case is closed",
});

const ACTIVITY_WORKFLOW_EVENTS = Object.freeze({
  "correspondence.portal_signed": WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_SIGNED,
  "lead.retainer_signed": WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_SIGNED,
  "payment.approved": WORKFLOW_AUTO_COMPLETE_EVENTS.PAYMENT_CONFIRMED,
  "invoice.manual_payment_recorded": WORKFLOW_AUTO_COMPLETE_EVENTS.PAYMENT_CONFIRMED,
  "invoice.paid": WORKFLOW_AUTO_COMPLETE_EVENTS.PAYMENT_CONFIRMED,
  "questionnaire.portal_submitted": WORKFLOW_AUTO_COMPLETE_EVENTS.QUESTIONNAIRE_SUBMITTED,
  "questionnaire.reviewed": WORKFLOW_AUTO_COMPLETE_EVENTS.QUESTIONNAIRE_SUBMITTED,
  "case_form.portal_signed": WORKFLOW_AUTO_COMPLETE_EVENTS.FORM_SIGNED,
  "case_form.finalized": WORKFLOW_AUTO_COMPLETE_EVENTS.FORM_FINALIZED,
  "client_document.finalized": WORKFLOW_AUTO_COMPLETE_EVENTS.DOCUMENT_FINALIZED,
  "case.submitted": WORKFLOW_AUTO_COMPLETE_EVENTS.APPLICATION_SUBMITTED,
  "case.decision_approved": WORKFLOW_AUTO_COMPLETE_EVENTS.DECISION_RECORDED,
  "case.decision_refused": WORKFLOW_AUTO_COMPLETE_EVENTS.DECISION_RECORDED,
  "case.closed": WORKFLOW_AUTO_COMPLETE_EVENTS.CASE_CLOSED,
});

export function workflowEventForActivityAction(action) {
  return ACTIVITY_WORKFLOW_EVENTS[String(action || "")] || null;
}

function builtInStepAutomation(title) {
  if (title === "Retainer Agreement") return { autoCompleteTrigger: "Event", autoCompleteEvent: WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_AND_PAYMENT_CONFIRMED };
  if (title === "Assessment Questionnaire") return { autoCompleteTrigger: "Event", autoCompleteEvent: WORKFLOW_AUTO_COMPLETE_EVENTS.QUESTIONNAIRE_SUBMITTED };
  if (title === "Submit to IRCC" || title === "Submit to ESDC") return { autoCompleteTrigger: "Event", autoCompleteEvent: WORKFLOW_AUTO_COMPLETE_EVENTS.APPLICATION_SUBMITTED };
  if (title === "Decision") return { autoCompleteTrigger: "Event", autoCompleteEvent: WORKFLOW_AUTO_COMPLETE_EVENTS.DECISION_RECORDED };
  if (title === "Invoice and Close") return { autoCompleteTrigger: "Event", autoCompleteEvent: WORKFLOW_AUTO_COMPLETE_EVENTS.CASE_CLOSED };
  if (title === "Initial Consultation" || title === "Consultation") return { autoCompleteTrigger: "Stage", autoCompleteStage: "Retainer Pending" };
  if (title.startsWith("Document Request")) return { autoCompleteTrigger: "Stage", autoCompleteStage: "Reviewing Documents" };
  if (title === "Document Review") return { autoCompleteTrigger: "Stage", autoCompleteStage: "Application Preparing" };
  if (title === "Immigration Forms") return { autoCompleteTrigger: "Stage", autoCompleteStage: "Application Under Review" };
  if (["Client Review and Signature", "RCIC Review", "Application Package Review"].includes(title)) return { autoCompleteTrigger: "Stage", autoCompleteStage: "Submitted" };
  if (title === "School Application Support") return { autoCompleteTrigger: "Stage", autoCompleteStage: "Offer Letter Application Submitted" };
  if (title === "Letter of Acceptance (LOA)") return { autoCompleteTrigger: "Stage", autoCompleteStage: "Offer Letter Received" };
  return {};
}

function workflowStep(title, description, priority = "Normal") {
  return {
    title,
    description,
    priority,
    ...builtInStepAutomation(title),
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

function capitalizeFirstLetter(value) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "";
}

export const ADDITIONAL_CASE_TYPE_ALIASES = [
  {
    caseType: "Spousal Open Work Permit",
    aliases: ["SOWP", "Spousal OWP", "Spousal Open WP", "Spouse Open Work Permit", "Spousal Open Wok Permit"],
  },
  {
    caseType: "PR Card Renewal",
    aliases: ["Permanent Resident Card Renewal"],
  },
  {
    caseType: "Indian Passport Renewal",
    aliases: ["India Passport Renewal"],
  },
  {
    caseType: "Canadian Passport Renewal",
    aliases: ["Canada Passport Renewal"],
  },
  {
    caseType: "OCI Card Application",
    aliases: ["OCI Application", "OCI Card Apply", "Overseas Citizen of India Card Application"],
  },
];

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
  const additionalType = ADDITIONAL_CASE_TYPE_ALIASES.find((item) =>
    [item.caseType, ...item.aliases].some((label) => normalizeCaseType(label) === normalized),
  );
  if (additionalType) return additionalType.caseType;
  const globalType = GLOBAL_CASE_TYPE_PROGRAMS.find((item) =>
    [item.title, ...(item.aliases || [])].some((label) => normalizeCaseType(label) === normalized),
  );
  if (globalType) return globalType.title;
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => getTemplateCaseTypeKeys(item).includes(normalized));
  return template?.caseType || capitalizeFirstLetter(trimmed);
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
      existingStep.isRequired === true &&
      normalizeNullableString(existingStep.autoCompleteTrigger) === normalizeNullableString(step.autoCompleteTrigger) &&
      normalizeNullableString(existingStep.autoCompleteStage) === normalizeNullableString(step.autoCompleteStage) &&
      normalizeNullableString(existingStep.autoCompleteEvent) === normalizeNullableString(step.autoCompleteEvent)
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
      autoCompleteTrigger: step.autoCompleteTrigger || null,
      autoCompleteStage: step.autoCompleteStage || null,
      autoCompleteEvent: step.autoCompleteEvent || null,
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
            autoCompleteTrigger: step.autoCompleteTrigger || null,
            autoCompleteStage: step.autoCompleteStage || null,
            autoCompleteEvent: step.autoCompleteEvent || null,
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

async function syncCaseWorkflowAutomationFromTemplate(db, { agencyId, caseId, template }) {
  if (!template?.id || !template.steps?.length) return [];

  const caseSteps = await db.caseWorkflowStep.findMany({
    where: { agencyId, caseId, templateId: template.id, isStandaloneTask: false },
  });
  const templateById = new Map(template.steps.map((step) => [step.id, step]));
  const templateByTitle = new Map(template.steps.map((step) => [normalizeCaseType(step.title), step]));
  const changedStepIds = [];

  for (const caseStep of caseSteps) {
    const templateStep = templateById.get(caseStep.templateStepId) || templateByTitle.get(normalizeCaseType(caseStep.title));
    if (!templateStep) continue;
    const nextTrigger = templateStep.autoCompleteTrigger || null;
    const nextStage = templateStep.autoCompleteStage || null;
    const nextEvent = templateStep.autoCompleteEvent || null;
    if (
      caseStep.templateStepId === templateStep.id &&
      caseStep.autoCompleteTrigger === nextTrigger &&
      caseStep.autoCompleteStage === nextStage &&
      caseStep.autoCompleteEvent === nextEvent
    ) continue;

    await db.caseWorkflowStep.update({
      where: { id: caseStep.id },
      data: {
        templateStepId: templateStep.id,
        autoCompleteTrigger: nextTrigger,
        autoCompleteStage: nextStage,
        autoCompleteEvent: nextEvent,
      },
    });
    changedStepIds.push(caseStep.id);
  }

  return changedStepIds;
}

export async function assignDefaultWorkflowToCase(db = prisma, { agencyId, caseId, caseType }) {
  const template = await findWorkflowTemplateForCaseType(db, { agencyId, caseType });
  const existingCount = await db.caseWorkflowStep.count({
    where: {
      agencyId,
      caseId,
      isStandaloneTask: false,
    },
  });

  if (existingCount > 0) {
    const assignedTemplateId = await db.caseWorkflowStep.findFirst({
      where: { agencyId, caseId, isStandaloneTask: false, templateId: { not: null } },
      select: { templateId: true },
    });
    const assignedTemplate = assignedTemplateId?.templateId === template?.id
      ? template
      : assignedTemplateId?.templateId
        ? await db.workflowTemplate.findFirst({
            where: { id: assignedTemplateId.templateId, agencyId },
            include: { steps: { orderBy: { sortOrder: "asc" } } },
          })
        : null;
    const automationUpdatedStepIds = await syncCaseWorkflowAutomationFromTemplate(db, {
      agencyId,
      caseId,
      template: assignedTemplate,
    });
    return { createdCount: 0, template: assignedTemplate, automationUpdatedStepIds };
  }

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
    autoCompleteTrigger: step.autoCompleteTrigger,
    autoCompleteStage: step.autoCompleteStage,
    autoCompleteEvent: step.autoCompleteEvent,
  }));

  const result = await db.caseWorkflowStep.createMany({
    data: steps,
  });

  return { createdCount: result.count, template, automationUpdatedStepIds: [] };
}

// Mirrors paymentScheduleService's evaluateStageTriggers exactly — a
// workflow milestone configured with a Stage trigger auto-completes the
// moment the case's stage crosses that point, the same way a payment
// installment auto-invoices. Only ever moves a step from Pending to
// Completed; a step someone already completed (or reopened) manually is
// never touched, and there is deliberately no reverse trigger — moving a
// case backward never un-completes a milestone.
export async function evaluateWorkflowStepStageTriggers(agencyId, caseId, oldStage, newStage, { actorUserId, clientId = null } = {}) {
  const newIndex = CASE_STAGES.indexOf(newStage);
  const oldIndex = oldStage ? CASE_STAGES.indexOf(oldStage) : -1;
  if (newIndex === -1 || newIndex <= oldIndex) return [];

  const candidates = await prisma.caseWorkflowStep.findMany({
    where: { agencyId, caseId, isActive: true, isStandaloneTask: false, status: "Pending", autoCompleteTrigger: "Stage" },
  });
  const due = candidates.filter((step) => {
    const stageIndex = CASE_STAGES.indexOf(step.autoCompleteStage);
    return stageIndex > oldIndex && stageIndex <= newIndex;
  });
  if (!due.length) return [];

  const completed = [];
  for (const step of due) {
    const completedAt = new Date();
    const claimed = await prisma.caseWorkflowStep.updateMany({
      where: { id: step.id, status: "Pending" },
      data: { status: "Completed", completedAt },
    });
    if (claimed.count !== 1) continue;
    completed.push({ ...step, status: "Completed", completedAt });
    await recordActivity({
      agencyId,
      userId: actorUserId,
      clientId,
      caseId,
      action: "workflow_step.auto_completed",
      details: `${step.title} auto-completed — case reached ${step.autoCompleteStage}`,
      entityType: "caseWorkflowStep",
      entityId: step.id,
      metadata: { autoCompleteTrigger: "Stage", autoCompleteStage: step.autoCompleteStage },
    }).catch((error) => {
      logger.warn("workflow_step.auto_complete_activity_failed", { agencyId, caseId, stepId: step.id, reason: error.message });
    });
  }

  return completed;
}

export async function evaluateWorkflowStepEventTriggers(
  agencyId,
  caseId,
  eventName,
  { actorUserId = null, clientId = null, occurredAt = new Date(), sourceAction = null, db = prisma, activityRecorder = recordActivity } = {},
) {
  if (!Object.values(WORKFLOW_AUTO_COMPLETE_EVENTS).includes(eventName)) return [];

  const candidateEvents = [eventName];
  if ([WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_SIGNED, WORKFLOW_AUTO_COMPLETE_EVENTS.PAYMENT_CONFIRMED].includes(eventName)) {
    candidateEvents.push(WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_AND_PAYMENT_CONFIRMED);
  }
  let candidates = await db.caseWorkflowStep.findMany({
    where: {
      agencyId,
      caseId,
      isActive: true,
      isStandaloneTask: false,
      status: "Pending",
      autoCompleteTrigger: "Event",
      autoCompleteEvent: { in: candidateEvents },
    },
  });
  if (candidates.some((step) => step.autoCompleteEvent === WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_AND_PAYMENT_CONFIRMED)) {
    const evidence = await db.activityLog.findMany({
      where: {
        agencyId,
        caseId,
        action: {
          in: Object.entries(ACTIVITY_WORKFLOW_EVENTS)
            .filter(([, mappedEvent]) => [WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_SIGNED, WORKFLOW_AUTO_COMPLETE_EVENTS.PAYMENT_CONFIRMED].includes(mappedEvent))
            .map(([action]) => action),
        },
      },
      select: { action: true },
    });
    const observed = new Set(evidence.map((item) => ACTIVITY_WORKFLOW_EVENTS[item.action]));
    const compoundSatisfied = observed.has(WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_SIGNED) && observed.has(WORKFLOW_AUTO_COMPLETE_EVENTS.PAYMENT_CONFIRMED);
    if (!compoundSatisfied) {
      candidates = candidates.filter((step) => step.autoCompleteEvent !== WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_AND_PAYMENT_CONFIRMED);
    }
  }
  const completed = [];

  for (const step of candidates) {
    const completedAt = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
    const claimed = await db.caseWorkflowStep.updateMany({
      where: { id: step.id, status: "Pending" },
      data: { status: "Completed", completedAt },
    });
    if (claimed.count !== 1) continue;
    completed.push({ ...step, status: "Completed", completedAt });
    await activityRecorder({
      agencyId,
      userId: actorUserId,
      clientId,
      caseId,
      action: "workflow_step.auto_completed",
      details: `${step.title} auto-completed — ${WORKFLOW_EVENT_LABELS[step.autoCompleteEvent]}`,
      entityType: "caseWorkflowStep",
      entityId: step.id,
      metadata: { autoCompleteTrigger: "Event", autoCompleteEvent: step.autoCompleteEvent, sourceAction },
    }).catch((error) => {
      logger.warn("workflow_step.auto_complete_activity_failed", { agencyId, caseId, stepId: step.id, reason: error.message });
    });
  }

  return completed;
}

// When automation is first added to an already-assigned workflow, reconcile
// only those newly configured steps against durable history. Limiting this to
// changed trigger metadata preserves the hybrid/manual override: reopening a
// step by hand will not be undone merely by viewing the case again.
export async function reconcileNewWorkflowAutomation(
  agencyId,
  caseId,
  stepIds,
  { actorUserId = null, clientId = null, db = prisma, activityRecorder = recordActivity } = {},
) {
  if (!stepIds?.length) return [];
  const [caseItem, candidates, activities, stageHistory] = await Promise.all([
    db.case.findFirst({ where: { id: caseId, agencyId }, select: { stage: true, clientId: true } }),
    db.caseWorkflowStep.findMany({
      where: { id: { in: stepIds }, agencyId, caseId, isActive: true, isStandaloneTask: false, status: "Pending" },
    }),
    db.activityLog.findMany({
      where: { agencyId, caseId, action: { in: Object.keys(ACTIVITY_WORKFLOW_EVENTS) } },
      orderBy: { createdAt: "asc" },
      select: { action: true, createdAt: true },
    }),
    db.caseStageHistory.findMany({
      where: { agencyId, caseId },
      orderBy: { createdAt: "asc" },
      select: { newStage: true, createdAt: true },
    }),
  ]);
  if (!caseItem) return [];

  const completed = [];
  for (const step of candidates) {
    let evidence = null;
    if (step.autoCompleteTrigger === "Event" && step.autoCompleteEvent) {
      if (step.autoCompleteEvent === WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_AND_PAYMENT_CONFIRMED) {
        const signed = activities.find((activity) => ACTIVITY_WORKFLOW_EVENTS[activity.action] === WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_SIGNED);
        const paid = activities.find((activity) => ACTIVITY_WORKFLOW_EVENTS[activity.action] === WORKFLOW_AUTO_COMPLETE_EVENTS.PAYMENT_CONFIRMED);
        evidence = signed && paid ? (signed.createdAt > paid.createdAt ? signed : paid) : null;
      } else {
        evidence = activities.find((activity) => ACTIVITY_WORKFLOW_EVENTS[activity.action] === step.autoCompleteEvent) || null;
      }
    } else if (step.autoCompleteTrigger === "Stage" && step.autoCompleteStage) {
      const targetIndex = CASE_STAGES.indexOf(step.autoCompleteStage);
      const currentIndex = CASE_STAGES.indexOf(caseItem.stage);
      if (targetIndex !== -1 && currentIndex >= targetIndex) {
        evidence = stageHistory.find((entry) => CASE_STAGES.indexOf(entry.newStage) >= targetIndex) || { createdAt: new Date(), action: "case.current_stage" };
      }
    }
    if (!evidence) continue;

    const eventName = step.autoCompleteEvent;
    const completedAt = evidence.createdAt;
    const claimed = await db.caseWorkflowStep.updateMany({
      where: { id: step.id, status: "Pending" },
      data: { status: "Completed", completedAt },
    });
    if (claimed.count !== 1) continue;
    completed.push({ ...step, status: "Completed", completedAt });
    const reason = step.autoCompleteTrigger === "Event"
      ? WORKFLOW_EVENT_LABELS[eventName]
      : `case reached ${step.autoCompleteStage}`;
    await activityRecorder({
      agencyId,
      userId: actorUserId,
      clientId: clientId || caseItem.clientId,
      caseId,
      action: "workflow_step.auto_completed",
      details: `${step.title} auto-completed — ${reason}`,
      entityType: "caseWorkflowStep",
      entityId: step.id,
      metadata: {
        autoCompleteTrigger: step.autoCompleteTrigger,
        autoCompleteStage: step.autoCompleteStage,
        autoCompleteEvent: eventName,
        sourceAction: evidence.action || null,
        reconciled: true,
      },
    }).catch((error) => {
      logger.warn("workflow_step.auto_complete_activity_failed", { agencyId, caseId, stepId: step.id, reason: error.message });
    });
  }

  return completed;
}
