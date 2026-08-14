import prisma from "./prisma/client.js";
import { resolveSourcePath } from "./formDataSourceRegistry.js";
import { createHttpError } from "../utils/http.js";

const representativeSelect = { fullName: true, email: true, phone: true, licenseNumber: true, representativeType: true, membershipBody: true, membershipProvince: true };

function irccApplicantName(client) {
  if (!client) return client;
  const familyName = String(client.familyName || "").trim();
  const givenNames = String(client.givenNames || "").trim();
  if (!familyName && givenNames) return { ...client, familyName: givenNames, givenNames: null };
  const tokens = String(client.fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!familyName && !givenNames && tokens.length === 1) return { ...client, familyName: tokens[0], givenNames: null };
  return client;
}

function isImm5476(caseForm) {
  return String(caseForm?.formNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "") === "IMM5476";
}

// The data a CaseForm's fields resolve against. "representative" is
// whichever admin or consultant is picked on CaseForm.representativeUserId
// — falling back to the case's assigned consultant only when nothing has
// been explicitly chosen yet, never hardcoded to either.
export async function buildFieldContext(caseForm) {
  const [caseItem, client, agency, applicantProfile] = await Promise.all([
    prisma.case.findUnique({ where: { id: caseForm.caseId }, select: { caseType: true, applicationNumber: true, stage: true, assignedUserId: true } }),
    prisma.client.findUnique({ where: { id: caseForm.clientId }, select: { fullName: true, familyName: true, givenNames: true, dateOfBirth: true, email: true, phone: true, uci: true, address: true, clientNumber: true } }),
    prisma.agency.findUnique({ where: { id: caseForm.agencyId }, select: { name: true, address: true, addressUnit: true, city: true, province: true, country: true, postalCode: true, phone: true, faxNumber: true, email: true } }),
    caseForm.applicantProfileId
      ? prisma.immigrationProfile.findUnique({
          where: { id: caseForm.applicantProfileId },
          select: { givenNames: true, familyName: true, dateOfBirth: true, communicationEmail: true, uci: true, applicationNumber: true },
        })
      : null,
  ]);
  const representativeId = caseForm.representativeUserId || (isImm5476(caseForm) ? null : caseItem?.assignedUserId) || null;
  const representative = representativeId
    ? await prisma.user.findUnique({ where: { id: representativeId }, select: representativeSelect })
    : null;
  // A case can have multiple applicants (principal applicant + dependents,
  // each with their own copy of a form like IMM 5476). CaseForm.applicantProfileId
  // picks which one "client.*" fields resolve from — the extra ImmigrationProfile
  // record if one is chosen, otherwise the case's own Client (the default/principal
  // applicant) exactly as before.
  const applicantAsClient = applicantProfile
    ? {
        fullName: `${applicantProfile.givenNames} ${applicantProfile.familyName}`.trim(),
        familyName: applicantProfile.familyName,
        givenNames: applicantProfile.givenNames,
        dateOfBirth: applicantProfile.dateOfBirth,
        email: applicantProfile.communicationEmail,
        phone: null,
        uci: applicantProfile.uci,
        address: null,
        clientNumber: applicantProfile.applicationNumber,
      }
    : null;
  return { case: caseItem, client: irccApplicantName(applicantAsClient || client), representative, agency };
}

// requiredWhen: { fieldKey, equals } | { fieldKey, in: [...] } — evaluated
// against this CaseForm's own field values, so e.g. IMM 5476's Section B
// only appears once the "purpose" field is answered "appointing".
function evaluateCondition(condition, valuesByKey) {
  const requiredWhen = condition?.requiredWhen;
  if (!requiredWhen?.fieldKey) return true;
  const actual = valuesByKey.get(requiredWhen.fieldKey)?.value ?? null;
  if (Array.isArray(requiredWhen.in)) return requiredWhen.in.includes(actual);
  if (requiredWhen.equals !== undefined) return actual === requiredWhen.equals;
  return true;
}

// Only ever populates fields that are still Unset (or refreshes a value it
// filled last time) — a value a human already typed, on either side, is
// never silently overwritten. Returns null if this CaseForm isn't linked to
// a mapped agency template (nothing to fill against).
export async function autofillCaseForm({ caseFormId, agencyId }) {
  const caseForm = await prisma.caseForm.findFirst({ where: { id: caseFormId, agencyId } });
  if (!caseForm) return null;
  if (isImm5476(caseForm) && !caseForm.representativeUserId) {
    throw createHttpError(409, "Select a licensed representative before auto-filling IMM 5476");
  }
  if (!caseForm.sourceAgencyFormTemplateId) return { available: false, filled: 0, total: 0 };

  const schema = await prisma.formTemplateFieldSchema.findMany({ where: { agencyFormTemplateId: caseForm.sourceAgencyFormTemplateId } });
  if (!schema.length) return { available: false, filled: 0, total: 0 };

  const context = await buildFieldContext(caseForm);
  const existing = await prisma.caseFormFieldValue.findMany({ where: { caseFormId } });
  const existingByKey = new Map(existing.map((row) => [row.fieldKey, row]));

  let filled = 0;
  await prisma.$transaction(async (tx) => {
    for (const field of schema) {
      if (!field.sourcePath) continue;
      const prior = existingByKey.get(field.fieldKey);
      if (prior && prior.status !== "Unset" && prior.status !== "AutoFilled") continue;
      const value = resolveSourcePath(field.sourcePath, context);
      if (value === null) continue;
      if (prior) {
        await tx.caseFormFieldValue.update({ where: { id: prior.id }, data: { value, status: "AutoFilled", filledAt: new Date(), filledById: null } });
      } else {
        await tx.caseFormFieldValue.create({ data: { agencyId, caseFormId, fieldKey: field.fieldKey, value, status: "AutoFilled", filledAt: new Date() } });
      }
      filled += 1;
    }
  });
  return { available: true, filled, total: schema.length };
}

// Full checklist state: schema + live values + which fields are actually
// applicable right now given §6-style conditions, plus a completeness
// count scoped to required fields (so "9 of 13" means something).
export async function getCaseFormChecklist({ caseFormId, agencyId }) {
  const caseForm = await prisma.caseForm.findFirst({ where: { id: caseFormId, agencyId } });
  if (!caseForm) return null;
  if (!caseForm.sourceAgencyFormTemplateId) {
    return { available: false, representativeUserId: caseForm.representativeUserId, applicantProfileId: caseForm.applicantProfileId, reason: "This form isn't linked to a mapped template. Add it from the agency form library to get the auto-fill checklist.", fields: [], progress: { complete: 0, total: 0 } };
  }

  const [schema, values] = await Promise.all([
    prisma.formTemplateFieldSchema.findMany({ where: { agencyFormTemplateId: caseForm.sourceAgencyFormTemplateId }, orderBy: [{ page: "asc" }, { sortIndex: "asc" }] }),
    prisma.caseFormFieldValue.findMany({ where: { caseFormId } }),
  ]);
  if (!schema.length) {
    return { available: false, representativeUserId: caseForm.representativeUserId, applicantProfileId: caseForm.applicantProfileId, reason: "This template has no mapped fields yet — map it from the agency form library first.", fields: [], progress: { complete: 0, total: 0 } };
  }

  const valuesByKey = new Map(values.map((row) => [row.fieldKey, row]));
  const fields = schema
    .filter((field) => evaluateCondition(field.condition, valuesByKey))
    .map((field) => {
      const value = valuesByKey.get(field.fieldKey);
      return {
        id: field.id,
        fieldKey: field.fieldKey,
        fieldType: field.fieldType,
        page: field.page,
        section: field.section,
        label: field.label,
        helpText: field.helpText,
        owner: field.owner,
        sourcePath: field.sourcePath,
        isRequired: field.isRequired,
        fillableBy: field.fillableBy,
        value: value?.value ?? null,
        status: value?.status || "Unset",
        filledById: value?.filledById || null,
        filledAt: value?.filledAt || null,
      };
    });

  const requiredFields = fields.filter((field) => field.isRequired);
  return {
    available: true,
    representativeUserId: caseForm.representativeUserId,
    applicantProfileId: caseForm.applicantProfileId,
    fields,
    progress: {
      complete: requiredFields.filter((field) => field.status !== "Unset").length,
      total: requiredFields.length,
      filledOfAll: fields.filter((field) => field.status !== "Unset").length,
      totalAll: fields.length,
    },
  };
}

// Every field is editable regardless of how it got its value — calling
// this on an Auto-filled field just re-labels it Consultant/Client Entered
// and "pins" it so a future autofill run leaves it alone.
export async function setCaseFormFieldValue({ caseFormId, agencyId, fieldKey, value, status, filledById = null }) {
  const trimmed = value === null || value === undefined || value === "" ? null : String(value);
  return prisma.caseFormFieldValue.upsert({
    where: { caseFormId_fieldKey: { caseFormId, fieldKey } },
    update: { value: trimmed, status, filledById, filledAt: new Date() },
    create: { agencyId, caseFormId, fieldKey, value: trimmed, status, filledById, filledAt: new Date() },
  });
}
