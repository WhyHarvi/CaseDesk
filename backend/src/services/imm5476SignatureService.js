import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import prisma from "./prisma/client.js";
import { DOCUMENT_BUCKET, downloadStorageFile, removeStorageFile, uploadStorageFile } from "./supabaseStorage.js";
import { createHttpError } from "../utils/http.js";
import { APPLICANT_SIGNATURE, readFieldValue, REPRESENTATIVE_SIGNATURE, signatureAnnotation } from "./imm5476SignatureFields.js";

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// The backend owns the source PDF and the annotation operation. The client
// submits only its drawing points, so it cannot replace names, purpose,
// representative details, or any other field on the form.
export async function createSignedImm5476Copy({ request, applicantStrokes, applicantSignatureImage, actorUserId, signerIp, signerUserAgent }) {
  const form = await prisma.caseForm.findUnique({ where: { id: request.caseFormId } });
  if (!form?.storageKey || form.storageKey !== request.sourceStorageKey || (request.sourceFileHash && form.fileHash !== request.sourceFileHash)) {
    throw createHttpError(409, "This IMM 5476 changed after it was sent. Ask your consultant to review it and send a new signature request.");
  }
  const source = await downloadStorageFile(DOCUMENT_BUCKET, request.sourceStorageKey, { allowMissing: true });
  if (!source) throw createHttpError(409, "The filled IMM 5476 copy is not available. Ask your consultant to resend the signature request.");

  const task = pdfjs.getDocument({ data: new Uint8Array(source), enableXfa: true });
  let signedBuffer;
  try {
    const document = await task.promise;
    // The applicant signs whatever date the representative's signature
    // already carries (stamped when the filled PDF was generated/sent), not
    // whatever day the applicant happens to get around to signing — the two
    // signature dates on a IMM 5476 should read the same day.
    const representativeSignedDate = String((await readFieldValue(document, REPRESENTATIVE_SIGNATURE.dateFieldId)) || "").trim();
    const signedDate = representativeSignedDate || new Date().toISOString().slice(0, 10);
    document.annotationStorage.setValue("547R", { value: true });
    document.annotationStorage.setValue(REPRESENTATIVE_SIGNATURE.dateFieldId, { value: signedDate });
    document.annotationStorage.setValue(APPLICANT_SIGNATURE.dateFieldId, { value: signedDate });
    document.annotationStorage.setValue(`pdfjs_internal_editor_casedesk-representative-${randomUUID()}`, signatureAnnotation(request.representativeSignatureStrokes, REPRESENTATIVE_SIGNATURE, request.representativeNameSnapshot));
    document.annotationStorage.setValue(`pdfjs_internal_editor_casedesk-applicant-${randomUUID()}`, signatureAnnotation(applicantStrokes, APPLICANT_SIGNATURE, request.applicantNameSnapshot));
    signedBuffer = Buffer.from(await document.saveDocument());
  } catch (error) {
    throw createHttpError(500, `The signed IMM 5476 could not be generated: ${error.message}`);
  } finally {
    await task.destroy().catch(() => {});
  }

  const baseName = String(form.originalFilename || "IMM5476.pdf").replace(/\.pdf$/i, "");
  const originalFilename = `${baseName}-client-signed.pdf`;
  const storageKey = path.posix.join(form.agencyId, form.caseId, "forms", `${randomUUID()}.pdf`);
  const fileHash = hashBuffer(signedBuffer);
  await uploadStorageFile(DOCUMENT_BUCKET, storageKey, signedBuffer, "application/pdf");

  try {
    return await prisma.$transaction(async (tx) => {
      let latest = await tx.caseFormVersion.aggregate({ where: { caseFormId: form.id }, _max: { versionNumber: true } });
      if (!latest._max.versionNumber) {
        await tx.caseFormVersion.create({
          data: {
            agencyId: form.agencyId,
            caseFormId: form.id,
            versionNumber: 1,
            source: "BrowserSave",
            copyType: form.currentCopyType || "Filled",
            language: form.language || "English",
            sourceRevision: form.sourceRevision,
            fileHash: form.fileHash || hashBuffer(source),
            officialUrl: form.officialUrl,
            mappingVersion: form.mappingVersion,
            storageKey: form.storageKey,
            originalFilename: form.originalFilename || "IMM5476.pdf",
            mimeType: form.mimeType || "application/pdf",
            fileSize: form.fileSize || source.length,
            sourceDownloadedAt: form.sourceDownloadedAt,
            createdById: form.uploadedById || actorUserId,
          },
        });
        latest = { _max: { versionNumber: 1 } };
      }
      const versionNumber = latest._max.versionNumber + 1;
      await tx.caseFormVersion.create({
        data: {
          agencyId: form.agencyId,
          caseFormId: form.id,
          versionNumber,
          source: "Generated",
          copyType: "ClientSigned",
          language: form.language || "English",
          sourceRevision: form.sourceRevision,
          fileHash,
          officialUrl: form.officialUrl,
          mappingVersion: form.mappingVersion,
          storageKey,
          originalFilename,
          mimeType: "application/pdf",
          fileSize: signedBuffer.length,
          createdById: actorUserId,
        },
      });
      const signedForm = await tx.caseForm.update({
        where: { id: form.id },
        data: { storageKey, originalFilename, mimeType: "application/pdf", fileSize: signedBuffer.length, fileHash, uploadedById: actorUserId, currentCopyType: "ClientSigned", status: "Signed" },
      });
      const signedAt = new Date();
      const signatureRequest = await tx.caseFormSignatureRequest.update({
        where: { id: request.id },
        data: { status: "Signed", applicantSignatureImage, applicantSignatureStrokes: applicantStrokes, consentedAt: signedAt, signedAt, signerIp, signerUserAgent },
      });
      return { signedForm, signatureRequest };
    });
  } catch (error) {
    await removeStorageFile(DOCUMENT_BUCKET, storageKey);
    throw error;
  }
}
