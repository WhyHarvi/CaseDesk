import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import prisma from "../services/prisma/client.js";
import { DOCUMENT_BUCKET, downloadStorageFile, removeStorageFile, uploadStorageFile } from "../services/supabaseStorage.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { assertFormUnlocked, requireFormPermission } from "../services/formPermissions.js";
import { recordFormAudit } from "../utils/formAudit.js";
import { stampPdfFormValues, stampXfaPdfFormValues } from "../services/pdfFormRenderService.js";
import { resolveSignatureFillFraction } from "../services/imm5476SignatureFields.js";
import { caseFormAccessWhere } from "../services/caseFormAccessService.js";

const include = { uploadedBy: { select: { id: true, fullName: true } }, lockedBy: { select: { id: true, fullName: true } }, _count: { select: { versions: true, reviewComments: true } } };

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// "Generate filled PDF" — the last step of the checklist flow. Stamps the
// live CaseFormFieldValue rows into the real source PDF via pdf-lib and
// versions the result into the same CaseFormVersion history every other
// upload/import/browser-save flow uses, so it shows up in Download
// Application alongside everything else without any special-casing there.
export async function generateFilledCaseFormPdf(req, res) {
  await requireFormPermission(req, "canEdit");
  const existing = await prisma.caseForm.findFirst({ where: caseFormAccessWhere(req, { id: req.params.id }) });
  if (!existing) throw createHttpError(404, "Case form not found");
  assertFormUnlocked(existing);
  if (!existing.sourceAgencyFormTemplateId) throw createHttpError(409, "This form isn't linked to a mapped template — nothing to generate from");
  if (!existing.storageKey) throw createHttpError(409, "This form doesn't have a source file to stamp values into");

  const isImm5476 = String(existing.formNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "") === "IMM5476";
  const [schema, values, sourceBuffer, representativeUser, agency] = await Promise.all([
    prisma.formTemplateFieldSchema.findMany({ where: { agencyFormTemplateId: existing.sourceAgencyFormTemplateId } }),
    prisma.caseFormFieldValue.findMany({ where: { caseFormId: existing.id } }),
    downloadStorageFile(DOCUMENT_BUCKET, existing.storageKey, { allowMissing: true }),
    isImm5476 && existing.representativeUserId
      ? prisma.user.findUnique({ where: { id: existing.representativeUserId }, select: { fullName: true, formSignatureImage: true, formSignatureStrokes: true } })
      : null,
    isImm5476 ? prisma.agency.findUnique({ where: { id: req.user.agencyId }, select: { governmentFormSignatureScale: true } }) : null,
  ]);
  if (!sourceBuffer) throw createHttpError(404, "The stored source file for this form was not found");

  const valuesByKey = new Map(values.map((row) => [row.fieldKey, row]));
  const missingRequired = schema.filter((field) => field.isRequired && !valuesByKey.get(field.fieldKey)?.value);
  if (missingRequired.length) {
    throw createHttpError(409, `${missingRequired.length} required field${missingRequired.length === 1 ? " is" : "s are"} still missing — complete the checklist before generating`);
  }

  const fields = schema.map((field) => ({ fieldKey: field.fieldKey, fieldType: field.fieldType, value: valuesByKey.get(field.fieldKey)?.value ?? null }));
  // The representative signs by preparing and sending the form — stamp their
  // saved signature + today's date into Section B right away rather than
  // leaving it blank until the applicant also signs in Section E.
  const representativeSignature = representativeUser?.formSignatureImage && Array.isArray(representativeUser.formSignatureStrokes) && representativeUser.formSignatureStrokes.length
    ? { strokes: representativeUser.formSignatureStrokes, name: representativeUser.fullName, fillFraction: resolveSignatureFillFraction(agency?.governmentFormSignatureScale) }
    : null;
  const filledBuffer = isImm5476
    ? await stampXfaPdfFormValues(sourceBuffer, fields, { "547R": true }, representativeSignature)
    : await stampPdfFormValues(sourceBuffer, fields);
  const fileHash = hashBuffer(filledBuffer);
  const baseName = (existing.originalFilename || `${existing.title}.pdf`).replace(/\.pdf$/i, "");
  const originalFilename = `${baseName}-filled.pdf`;
  const storageKey = path.posix.join(req.user.agencyId, existing.caseId, "forms", `${randomUUID()}.pdf`);
  await uploadStorageFile(DOCUMENT_BUCKET, storageKey, filledBuffer, "application/pdf");

  try {
    const data = await prisma.$transaction(async (tx) => {
      const latest = await tx.caseFormVersion.aggregate({ where: { caseFormId: existing.id }, _max: { versionNumber: true } });
      const versionNumber = (latest._max.versionNumber || 0) + 1;
      await tx.caseFormVersion.create({
        data: {
          agencyId: req.user.agencyId,
          caseFormId: existing.id,
          versionNumber,
          source: "Generated",
          copyType: "Filled",
          language: existing.language || "English",
          sourceRevision: existing.sourceRevision,
          fileHash,
          officialUrl: existing.officialUrl,
          mappingVersion: existing.mappingVersion,
          storageKey,
          originalFilename,
          mimeType: "application/pdf",
          fileSize: filledBuffer.length,
          createdById: req.user.id,
        },
      });
      return tx.caseForm.update({
        where: { id: existing.id },
        data: { storageKey, originalFilename, mimeType: "application/pdf", fileSize: filledBuffer.length, fileHash, uploadedById: req.user.id, currentCopyType: "Filled", status: "ReadyForReview" },
        include,
      });
    });
    const filledCount = fields.filter((field) => field.value).length;
    await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: existing.clientId, caseId: existing.caseId, action: "case_form.generated", details: `${existing.title} generated from the field checklist as version ${data._count.versions}` });
    await recordFormAudit({ form: data, event: "FilledCopySaved", details: `Generated from ${filledCount} checklist fields`, metadata: { fieldCount: filledCount }, userId: req.user.id });
    res.json({ data });
  } catch (error) {
    await removeStorageFile(DOCUMENT_BUCKET, storageKey);
    throw error;
  }
}
