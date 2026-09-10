import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import prisma from "./prisma/client.js";
import { DOCUMENT_BUCKET, downloadStorageFile, removeStorageFile, uploadStorageFile } from "./supabaseStorage.js";
import { createHttpError } from "../utils/http.js";
import { APPLICANT_SIGNATURE, applyFieldValues, hasInkAnnotationInRect, readFieldValue, REPRESENTATIVE_SIGNATURE, resolveSignatureFillFraction, signatureAnnotation } from "./imm5476SignatureFields.js";

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// The backend owns the source PDF and the annotation operation. The client
// submits only its drawing points, so it cannot replace names, purpose,
// representative details, or any other field on the form.
export async function createSignedImm5476Copy({ request, applicantStrokes, applicantSignatureImage, actorUserId, signerIp, signerUserAgent }) {
  const form = await prisma.caseForm.findUnique({ where: { id: request.caseFormId } });
  if (!form?.storageKey) {
    throw createHttpError(409, "This IMM 5476 changed after it was sent. Ask your consultant to review it and send a new signature request.");
  }
  // A request created while resigning (form.currentCopyType already
  // "ClientSigned") intentionally points sourceStorageKey at the last
  // pre-signature copy (not necessarily "Filled" — see the matching comment
  // in sendFormSignatureRequest), not at form.storageKey. So "has the form
  // changed since this request was sent" has to compare against that same
  // version here, not against form.storageKey, or every resend would look
  // stale.
  const currentSource = form.currentCopyType === "ClientSigned"
    ? await prisma.caseFormVersion.findFirst({
        where: { caseFormId: form.id, copyType: { notIn: ["ClientSigned", "Finalized"] } },
        orderBy: { versionNumber: "desc" },
        select: { storageKey: true, fileHash: true },
      })
    : { storageKey: form.storageKey, fileHash: form.fileHash };
  if (!currentSource?.storageKey || currentSource.storageKey !== request.sourceStorageKey || (request.sourceFileHash && currentSource.fileHash !== request.sourceFileHash)) {
    throw createHttpError(409, "This IMM 5476 changed after it was sent. Ask your consultant to review it and send a new signature request.");
  }
  const source = await downloadStorageFile(DOCUMENT_BUCKET, request.sourceStorageKey, { allowMissing: true });
  if (!source) throw createHttpError(409, "The filled IMM 5476 copy is not available. Ask your consultant to resend the signature request.");
  const agency = await prisma.agency.findUnique({ where: { id: form.agencyId }, select: { governmentFormSignatureScale: true } });
  const fillFraction = resolveSignatureFillFraction(agency?.governmentFormSignatureScale);

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
    // Explicitly clears any stale sibling radio widgets (e.g. from an
    // earlier autofill) rather than only touching 547R — this copy becomes
    // ClientSigned and is never re-stamped again, so it has to be correct
    // here or it stays wrong forever.
    await applyFieldValues(document, [["547R", true]]);
    document.annotationStorage.setValue(REPRESENTATIVE_SIGNATURE.dateFieldId, { value: signedDate });
    document.annotationStorage.setValue(APPLICANT_SIGNATURE.dateFieldId, { value: signedDate });
    // The representative's signature is already baked into this source PDF
    // from when the filled copy was generated/sent — re-adding it here
    // unconditionally on every client-signing pass drew a second overlapping
    // ink annotation in the same box. Only stamp what isn't already there.
    if (!(await hasInkAnnotationInRect(document, REPRESENTATIVE_SIGNATURE))) {
      document.annotationStorage.setValue(`pdfjs_internal_editor_casedesk-representative-${randomUUID()}`, signatureAnnotation(request.representativeSignatureStrokes, REPRESENTATIVE_SIGNATURE, request.representativeNameSnapshot, fillFraction));
    }
    if (!(await hasInkAnnotationInRect(document, APPLICANT_SIGNATURE))) {
      document.annotationStorage.setValue(`pdfjs_internal_editor_casedesk-applicant-${randomUUID()}`, signatureAnnotation(applicantStrokes, APPLICANT_SIGNATURE, request.applicantNameSnapshot, fillFraction));
    }
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

// Adjusting a signature's size/placement after the fact — for either the
// representative or the applicant, and whether or not the form has already
// been client-signed. A signed copy's ink is baked into the actual stored
// PDF bytes (not re-derived on every view the way an unsigned copy is), so
// there's no "just change a scale field" option once signed — the only way
// to move/resize what's already on the page is to re-stamp both signatures
// fresh from the last pre-signature copy, using each signature's own
// current (or just-adjusted) scale, and version the result in as the new
// current copy. Both signatures are always re-stamped together (never
// conditionally skipped the way createSignedImm5476Copy does) because the
// source here is guaranteed to be the clean, pre-signature copy — neither
// mark exists on it yet.
export async function regenerateSignedImm5476Copy({ form, target, scaleX, scaleY, actorUserId, include }) {
  const request = await prisma.caseFormSignatureRequest.findFirst({
    where: { caseFormId: form.id, status: "Signed" },
    orderBy: { signedAt: "desc" },
  });
  if (!request?.applicantSignatureStrokes) {
    throw createHttpError(409, "No signed client signature was found on this form to adjust.");
  }
  const lastUnsigned = await prisma.caseFormVersion.findFirst({
    where: { caseFormId: form.id, copyType: { notIn: ["ClientSigned", "Finalized"] } },
    orderBy: { versionNumber: "desc" },
    select: { storageKey: true },
  });
  if (!lastUnsigned) throw createHttpError(409, "The original filled copy of this form is no longer available.");
  const source = await downloadStorageFile(DOCUMENT_BUCKET, lastUnsigned.storageKey, { allowMissing: true });
  if (!source) throw createHttpError(409, "The filled IMM 5476 copy is not available.");

  const agency = await prisma.agency.findUnique({ where: { id: form.agencyId }, select: { governmentFormSignatureScale: true } });
  const representativeFraction = {
    x: resolveSignatureFillFraction(target === "representative" ? scaleX : (form.signatureScaleX ?? form.signatureScale ?? agency?.governmentFormSignatureScale)),
    y: resolveSignatureFillFraction(target === "representative" ? scaleY : (form.signatureScaleY ?? form.signatureScale ?? agency?.governmentFormSignatureScale)),
  };
  const applicantFraction = {
    x: resolveSignatureFillFraction(target === "applicant" ? scaleX : (form.applicantSignatureScaleX ?? agency?.governmentFormSignatureScale)),
    y: resolveSignatureFillFraction(target === "applicant" ? scaleY : (form.applicantSignatureScaleY ?? agency?.governmentFormSignatureScale)),
  };

  const task = pdfjs.getDocument({ data: new Uint8Array(source), enableXfa: true });
  let signedBuffer;
  try {
    const document = await task.promise;
    // Adjusting a box's size doesn't re-date the signature — keep whatever
    // day it was actually signed on, not today.
    const signedDate = (request.signedAt || request.consentedAt || new Date()).toISOString().slice(0, 10);
    await applyFieldValues(document, [["547R", true]]);
    document.annotationStorage.setValue(REPRESENTATIVE_SIGNATURE.dateFieldId, { value: signedDate });
    document.annotationStorage.setValue(APPLICANT_SIGNATURE.dateFieldId, { value: signedDate });
    document.annotationStorage.setValue(
      `pdfjs_internal_editor_casedesk-representative-${randomUUID()}`,
      signatureAnnotation(request.representativeSignatureStrokes, REPRESENTATIVE_SIGNATURE, request.representativeNameSnapshot, representativeFraction),
    );
    document.annotationStorage.setValue(
      `pdfjs_internal_editor_casedesk-applicant-${randomUUID()}`,
      signatureAnnotation(request.applicantSignatureStrokes, APPLICANT_SIGNATURE, request.applicantNameSnapshot, applicantFraction),
    );
    signedBuffer = Buffer.from(await document.saveDocument());
  } catch (error) {
    throw createHttpError(500, `The signed IMM 5476 could not be regenerated: ${error.message}`);
  } finally {
    await task.destroy().catch(() => {});
  }

  const baseName = String(form.originalFilename || "IMM5476.pdf").replace(/\.pdf$/i, "").replace(/-client-signed$/i, "");
  const originalFilename = `${baseName}-client-signed.pdf`;
  const storageKey = path.posix.join(form.agencyId, form.caseId, "forms", `${randomUUID()}.pdf`);
  const fileHash = hashBuffer(signedBuffer);
  await uploadStorageFile(DOCUMENT_BUCKET, storageKey, signedBuffer, "application/pdf");

  try {
    return await prisma.$transaction(async (tx) => {
      const latest = await tx.caseFormVersion.aggregate({ where: { caseFormId: form.id }, _max: { versionNumber: true } });
      const versionNumber = (latest._max.versionNumber || 0) + 1;
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
      return tx.caseForm.update({
        where: { id: form.id },
        data: {
          storageKey,
          originalFilename,
          mimeType: "application/pdf",
          fileSize: signedBuffer.length,
          fileHash,
          uploadedById: actorUserId,
          ...(target === "representative" ? { signatureScaleX: scaleX, signatureScaleY: scaleY } : { applicantSignatureScaleX: scaleX, applicantSignatureScaleY: scaleY }),
        },
        ...(include ? { include } : {}),
      });
    });
  } catch (error) {
    await removeStorageFile(DOCUMENT_BUCKET, storageKey);
    throw error;
  }
}
