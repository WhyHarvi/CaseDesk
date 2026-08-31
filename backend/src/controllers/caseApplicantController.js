import { randomBytes, scryptSync } from "node:crypto";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { caseAccessWhere } from "../middleware/authorization.js";
import { recheckUnmatchedCommunicationsForUci } from "../services/uciCommunicationMatchingService.js";
import { logger } from "../services/logger.js";

const PROFILE_TYPES = new Set([
  "Applicant",
  "Advisor",
  "Representative",
  "Other Immigration Profile",
]);

function getImmigrationProfileModel() {
  if (!prisma.immigrationProfile) {
    throw createHttpError(
      503,
      "Applicant profiles were just installed. Restart the CaseDesk backend once to load the updated database client.",
    );
  }

  return prisma.immigrationProfile;
}

function clean(value, maxLength = 250) {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result ? result.slice(0, maxLength) : null;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw createHttpError(400, "Enter a valid date of birth");
  return date;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function splitClientName(fullName = "") {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    givenNames: parts.slice(0, -1).join(" ") || parts[0] || "",
    familyName: parts.length > 1 ? parts.at(-1) : "",
  };
}

function formatCaseReference(item, index) {
  const familyName = item.client?.fullName?.trim().split(/\s+/).at(-1) || "Case";
  return `${String(index + 1).padStart(5, "0")}-${familyName}`;
}

function applicantFields(body, existing = null) {
  const profileType = clean(body.profileType ?? existing?.profileType, 60) || "Applicant";
  const givenNames = clean(body.givenNames ?? existing?.givenNames, 150);
  const familyName = clean(body.familyName ?? existing?.familyName, 150);
  const loginUsername = clean(body.loginUsername ?? existing?.loginUsername, 250);

  if (!PROFILE_TYPES.has(profileType)) throw createHttpError(400, "Select a valid immigration profile type");
  if (!givenNames) throw createHttpError(400, "Given name is required");
  if (!familyName) throw createHttpError(400, "Family name is required");

  const data = {
    profileType,
    givenNames,
    familyName,
    dateOfBirth: parseDate(body.dateOfBirth ?? existing?.dateOfBirth),
    relationship: clean(body.relationship ?? existing?.relationship, 150),
    uci: clean(body.uci ?? existing?.uci, 40),
    applicationNumber: clean(body.applicationNumber ?? existing?.applicationNumber, 80),
    communicationEmail: clean(body.communicationEmail ?? existing?.communicationEmail, 250),
    loginUsername,
    loginUsernameNormalized: loginUsername?.toLowerCase() || null,
  };
  const password = clean(body.password, 500);
  if (password) data.passwordHash = hashPassword(password);
  return data;
}

function requestedAccessibleCaseIds(body, currentCaseId, agencyCases, fallbackCaseIds = []) {
  const agencyCaseIds = new Set(agencyCases.map((item) => item.id));
  const requested = Array.isArray(body.caseIds)
    ? body.caseIds.map((value) => clean(value, 80)).filter(Boolean)
    : fallbackCaseIds.filter((caseId) => agencyCaseIds.has(caseId));
  const caseIds = [...new Set([currentCaseId, ...requested])];
  if (caseIds.some((id) => !agencyCaseIds.has(id))) {
    throw createHttpError(400, "One or more selected cases are unavailable");
  }
  return { caseIds, accessibleIds: agencyCaseIds };
}

async function findScopedProfile(req, caseId, profileId) {
  const profile = await getImmigrationProfileModel().findFirst({
    where: {
      id: profileId,
      agencyId: req.auth.agencyId,
      caseAccesses: { some: { caseId } },
    },
    include: { caseAccesses: { select: { caseId: true } } },
  });
  if (!profile) throw createHttpError(404, "Applicant profile not found");
  return profile;
}

// ImmigrationProfile.uci is the only live UCI write path in this codebase
// (Client.uci is dead — nothing writes it). Setting or changing it here is
// the one place that can make a previously-unmatched IRCC message
// resolvable, so it explicitly triggers a targeted recheck instead of
// waiting for the next hourly UCI-matching pass — this is a real equality
// lookup against the newly-written UCI value, not a heuristic.
async function triggerUciRecheckIfChanged(agencyId, uci) {
  if (!uci) return;
  try {
    await recheckUnmatchedCommunicationsForUci(agencyId, uci);
  } catch (error) {
    logger.warn("uci_match.applicant_recheck_failed", { agencyId, reason: error.message });
  }
}

async function getCaseContext(req, caseId) {
  const agencyId = req.auth.agencyId;
  const accessWhere = caseAccessWhere(req);
  const [caseItem, agencyCases] = await Promise.all([
    prisma.case.findFirst({
      where: { id: caseId, agencyId, ...accessWhere },
      include: { client: true },
    }),
    prisma.case.findMany({
      where: { agencyId, ...accessWhere },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        caseType: true,
        stage: true,
        status: true,
        client: { select: { fullName: true } },
      },
    }),
  ]);

  if (!caseItem) throw createHttpError(404, "Case not found");

  return {
    caseItem,
    agencyCases: agencyCases.map((item, index) => ({
      ...item,
      reference: formatCaseReference(item, index),
    })),
  };
}

export async function listCaseApplicants(req, res) {
  const agencyId = req.user.agencyId;
  const { caseItem, agencyCases } = await getCaseContext(req, req.params.id);
  const profiles = await getImmigrationProfileModel().findMany({
    where: {
      agencyId,
      caseAccesses: { some: { caseId: caseItem.id } },
    },
    orderBy: [{ createdAt: "asc" }],
    include: {
      caseAccesses: {
        orderBy: { createdAt: "asc" },
        select: { caseId: true },
      },
    },
  });

  const referenceById = new Map(agencyCases.map((item) => [item.id, item.reference]));
  const primaryName = splitClientName(caseItem.client.fullName);
  const currentReference = referenceById.get(caseItem.id);

  res.json({
    data: [
      {
        id: `primary-${caseItem.client.id}`,
        profileType: "Applicant",
        ...primaryName,
        fullName: caseItem.client.fullName,
        dateOfBirth: caseItem.client.dateOfBirth,
        relationship: "Principal Applicant",
        communicationEmail: caseItem.client.email,
        isPrimary: true,
        passwordConfigured: false,
        caseAccesses: [{ caseId: caseItem.id, reference: currentReference }],
      },
      ...profiles.map(({ passwordHash, loginUsernameNormalized, ...profile }) => ({
        ...profile,
        fullName: `${profile.givenNames} ${profile.familyName}`.trim(),
        passwordConfigured: Boolean(passwordHash),
        caseAccesses: profile.caseAccesses
          .filter((access) => referenceById.has(access.caseId))
          .map((access) => ({
            ...access,
            reference: referenceById.get(access.caseId),
          })),
      })),
    ],
    availableCases: agencyCases,
  });
}

export async function createCaseApplicant(req, res) {
  const agencyId = req.user.agencyId;
  const caseId = req.params.id;
  const { caseItem, agencyCases } = await getCaseContext(req, caseId);
  const data = applicantFields(req.body);
  const { caseIds } = requestedAccessibleCaseIds(req.body, caseId, agencyCases);

  try {
    const profile = await getImmigrationProfileModel().create({
      data: {
        agencyId,
        ...data,
        caseAccesses: {
          create: caseIds.map((selectedCaseId) => ({ agencyId, caseId: selectedCaseId })),
        },
      },
      include: { caseAccesses: { select: { caseId: true } } },
    });

    await recordActivity({
      agencyId,
      userId: req.user.id,
      clientId: caseItem.clientId,
      caseId,
      action: "case.applicant.created",
      details: `${data.profileType} profile added for ${data.givenNames} ${data.familyName}`,
    });
    // A brand-new applicant profile has no "previous" UCI to compare
    // against — any UCI present here is newly set.
    await triggerUciRecheckIfChanged(agencyId, data.uci);

    const { passwordHash, loginUsernameNormalized, ...safeProfile } = profile;
    res.status(201).json({ data: { ...safeProfile, passwordConfigured: Boolean(passwordHash) } });
  } catch (error) {
    if (error?.code === "P2002") {
      throw createHttpError(409, "Username or email must be unique");
    }
    throw error;
  }
}

export async function updateCaseApplicant(req, res) {
  const agencyId = req.auth.agencyId;
  const caseId = req.params.id;
  const { caseItem, agencyCases } = await getCaseContext(req, caseId);
  const existing = await findScopedProfile(req, caseId, req.params.applicantId);
  const data = applicantFields(req.body, existing);
  const { caseIds: selectedCaseIds, accessibleIds } = requestedAccessibleCaseIds(
    req.body,
    caseId,
    agencyCases,
    existing.caseAccesses.map((access) => access.caseId),
  );
  const inaccessibleExistingIds = existing.caseAccesses
    .map((access) => access.caseId)
    .filter((existingCaseId) => !accessibleIds.has(existingCaseId));
  const finalCaseIds = [...new Set([...selectedCaseIds, ...inaccessibleExistingIds])];
  const uciChanged = Boolean(data.uci) && data.uci !== existing.uci;

  try {
    const profile = await prisma.$transaction(async (tx) => {
      await tx.immigrationProfileCaseAccess.deleteMany({
        where: { agencyId, profileId: existing.id, caseId: { notIn: finalCaseIds } },
      });
      await tx.immigrationProfileCaseAccess.createMany({
        data: finalCaseIds.map((selectedCaseId) => ({ agencyId, profileId: existing.id, caseId: selectedCaseId })),
        skipDuplicates: true,
      });
      return tx.immigrationProfile.update({
        where: { id: existing.id },
        data,
        include: { caseAccesses: { select: { caseId: true } } },
      });
    });

    await recordActivity({
      agencyId,
      userId: req.auth.userId,
      clientId: caseItem.clientId,
      caseId,
      action: "case.applicant.updated",
      details: `${profile.profileType} profile updated for ${profile.givenNames} ${profile.familyName}`,
    });
    if (uciChanged) await triggerUciRecheckIfChanged(agencyId, data.uci);
    const { passwordHash, loginUsernameNormalized, ...safeProfile } = profile;
    res.json({
      data: {
        ...safeProfile,
        caseAccesses: safeProfile.caseAccesses.filter((access) => accessibleIds.has(access.caseId)),
        passwordConfigured: Boolean(passwordHash),
      },
    });
  } catch (error) {
    if (error?.code === "P2002") throw createHttpError(409, "Username or email must be unique");
    throw error;
  }
}

export async function removeCaseApplicant(req, res) {
  const agencyId = req.auth.agencyId;
  const caseId = req.params.id;
  const { caseItem } = await getCaseContext(req, caseId);
  const existing = await findScopedProfile(req, caseId, req.params.applicantId);
  const name = `${existing.givenNames} ${existing.familyName}`.trim();

  await prisma.$transaction(async (tx) => {
    if (existing.caseAccesses.length === 1) {
      await tx.immigrationProfile.delete({ where: { id: existing.id } });
    } else {
      await tx.immigrationProfileCaseAccess.delete({
        where: { profileId_caseId: { profileId: existing.id, caseId } },
      });
    }
  });

  await recordActivity({
    agencyId,
    userId: req.auth.userId,
    clientId: caseItem.clientId,
    caseId,
    action: "case.applicant.removed",
    details: `${existing.profileType} profile for ${name} removed from this case`,
  });
  res.status(204).send();
}
