import prisma from "./prisma/client.js";
import { extractPdfFormFields, isPdfMimeType } from "./pdfFormFieldExtractionService.js";
import { guessFieldMapping } from "./formFieldLabelHeuristics.js";

// Builds/refreshes the reusable field map for an AgencyFormTemplate. Called
// once when a template is uploaded and again whenever it's replaced with a
// new file — never per-case. A human's label/owner/source/condition edits
// on an existing field survive a re-extraction; only the structural facts
// (type/page/order) refresh, and fields the new PDF no longer has are
// removed. Silently does nothing for a non-PDF or non-fillable upload —
// CaseDesk's form library also holds plain scanned documents, and that's
// fine; they just never get a checklist.
export async function regenerateFieldSchemaFromBuffer({ agencyId, agencyFormTemplateId, buffer, mimeType }) {
  if (!isPdfMimeType(mimeType)) return { extracted: 0 };
  const extracted = await extractPdfFormFields(buffer);
  if (!extracted.length) return { extracted: 0 };

  const existing = await prisma.formTemplateFieldSchema.findMany({ where: { agencyFormTemplateId } });
  const existingByKey = new Map(existing.map((row) => [row.fieldKey, row]));
  const extractedKeys = new Set(extracted.map((field) => field.fieldKey));

  await prisma.$transaction(async (tx) => {
    for (const field of extracted) {
      const prior = existingByKey.get(field.fieldKey);
      if (prior) {
        await tx.formTemplateFieldSchema.update({
          where: { id: prior.id },
          data: { fieldType: field.fieldType, page: field.page, sortIndex: field.sortIndex },
        });
        continue;
      }
      const guess = guessFieldMapping(field.fieldKey);
      await tx.formTemplateFieldSchema.create({
        data: {
          agencyId,
          agencyFormTemplateId,
          fieldKey: field.fieldKey,
          fieldType: field.fieldType,
          page: field.page,
          sortIndex: field.sortIndex,
          label: guess.label,
          owner: guess.owner,
          sourcePath: guess.sourcePath,
          fillableBy: guess.fillableBy,
        },
      });
    }
    const stale = existing.filter((row) => !extractedKeys.has(row.fieldKey));
    if (stale.length) {
      await tx.formTemplateFieldSchema.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
    }
  });

  return { extracted: extracted.length };
}

export function listFieldSchema(agencyFormTemplateId) {
  return prisma.formTemplateFieldSchema.findMany({
    where: { agencyFormTemplateId },
    orderBy: [{ page: "asc" }, { sortIndex: "asc" }],
  });
}

export async function updateFieldSchema({ id, agencyId, patch }) {
  const existing = await prisma.formTemplateFieldSchema.findFirst({ where: { id, agencyId } });
  if (!existing) return null;
  return prisma.formTemplateFieldSchema.update({ where: { id }, data: patch });
}
