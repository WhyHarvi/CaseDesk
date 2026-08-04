import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { syncQuestionnaireAssignments } from "../services/questionnaireAssignmentService.js";
import { clientRecipientIds, notifyUsers } from "../services/notificationService.js";
import {
  formDataWithMaritalStatus,
  normalizeMaritalStatus,
  syncClientMaritalStatus,
} from "../services/clientProfileSyncService.js";

async function findScopedCase(req) {
  const data = await prisma.case.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.user.agencyId,
    },
    select: {
      id: true,
      clientId: true,
      caseType: true,
      client: {
        select: { maritalStatus: true },
      },
    },
  });

  if (!data) {
    throw createHttpError(404, "Case not found");
  }

  return data;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function yes(value) {
  return value === true || value === "Yes" || value === "yes" || value === "true";
}

function isMarriedOrCommonLaw(value) {
  const normalized = String(value || "").toLowerCase();
  return normalized === "married" || normalized.includes("common-law");
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integerFromValue(value) {
  if (typeof value === "number") {
    return Math.trunc(value);
  }

  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function yearsFromValue(value) {
  if (typeof value === "number") {
    return value;
  }

  const normalized = String(value || "").toLowerCase();

  if (!normalized || normalized.includes("none")) {
    return 0;
  }

  if (normalized.includes("5")) {
    return 5;
  }

  const match = normalized.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function calculateAge(dateOfBirth) {
  if (!dateOfBirth) {
    return null;
  }

  const birthDate = new Date(dateOfBirth);

  if (Number.isNaN(birthDate.getTime())) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();

  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }

  return age;
}

function ageFromProfile(profile) {
  const explicitAge = integerFromValue(profile.age);
  return explicitAge > 0 ? explicitAge : calculateAge(profile.dateOfBirth);
}

const LANGUAGE_ABILITIES = ["Speaking", "Listening", "Reading", "Writing"];

const AGE_POINTS = {
  withSpouse: {
    18: 90,
    19: 95,
    20: 100,
    21: 100,
    22: 100,
    23: 100,
    24: 100,
    25: 100,
    26: 100,
    27: 100,
    28: 100,
    29: 100,
    30: 95,
    31: 90,
    32: 85,
    33: 80,
    34: 75,
    35: 70,
    36: 65,
    37: 60,
    38: 55,
    39: 50,
    40: 45,
    41: 35,
    42: 25,
    43: 15,
    44: 5,
  },
  withoutSpouse: {
    18: 99,
    19: 105,
    20: 110,
    21: 110,
    22: 110,
    23: 110,
    24: 110,
    25: 110,
    26: 110,
    27: 110,
    28: 110,
    29: 110,
    30: 105,
    31: 99,
    32: 94,
    33: 88,
    34: 83,
    35: 77,
    36: 72,
    37: 66,
    38: 61,
    39: 55,
    40: 50,
    41: 39,
    42: 28,
    43: 17,
    44: 6,
  },
};

const EDUCATION_POINTS = {
  withSpouse: {
    none: 0,
    secondary: 28,
    oneYear: 84,
    twoYear: 91,
    bachelor: 112,
    twoOrMore: 119,
    masters: 126,
    doctoral: 140,
  },
  withoutSpouse: {
    none: 0,
    secondary: 30,
    oneYear: 90,
    twoYear: 98,
    bachelor: 120,
    twoOrMore: 128,
    masters: 135,
    doctoral: 150,
  },
  spouse: {
    none: 0,
    secondary: 2,
    oneYear: 6,
    twoYear: 7,
    bachelor: 8,
    twoOrMore: 9,
    masters: 10,
    doctoral: 10,
  },
};

function scoreAge(age, spouseAccompanying) {
  if (age === null || age < 18 || age > 44) {
    return 0;
  }

  return AGE_POINTS[spouseAccompanying ? "withSpouse" : "withoutSpouse"][age] ?? 0;
}

function educationLevel(value, profile = {}) {
  const normalized = String(value || "").toLowerCase();

  if (!normalized || normalized.includes("less than secondary") || normalized === "none") {
    return "none";
  }

  if (normalized.includes("doctor") || normalized.includes("ph.d") || normalized.includes("phd")) {
    return "doctoral";
  }

  if (normalized.includes("master") || normalized.includes("professional")) {
    return "masters";
  }

  if (normalized.includes("two or more") || yes(profile.secondPostSecondaryCredential)) {
    return "twoOrMore";
  }

  if (normalized.includes("bachelor") || normalized.includes("three")) {
    return "bachelor";
  }

  if (normalized.includes("two-year") || normalized.includes("2-year")) {
    return "twoYear";
  }

  if (normalized.includes("one-year") || normalized.includes("1-year")) {
    return "oneYear";
  }

  if (normalized.includes("secondary") || normalized.includes("high school")) {
    return "secondary";
  }

  return "none";
}

function scoreEducation(level, spouseAccompanying) {
  return EDUCATION_POINTS[spouseAccompanying ? "withSpouse" : "withoutSpouse"][level] ?? 0;
}

function scoreSpouseEducation(level) {
  return EDUCATION_POINTS.spouse[level] ?? 0;
}

function normalizedClb(value) {
  const clb = Math.trunc(numberValue(value));
  return Math.min(10, Math.max(0, clb));
}

function scoreByMinimum(value, thresholds) {
  const score = numberValue(value);

  for (const [minimum, clb] of thresholds) {
    if (score >= minimum) {
      return clb;
    }
  }

  return 0;
}

const LANGUAGE_TEST_THRESHOLDS = {
  celpip: {
    Speaking: [[10, 10], [9, 9], [8, 8], [7, 7], [6, 6], [5, 5], [4, 4]],
    Listening: [[10, 10], [9, 9], [8, 8], [7, 7], [6, 6], [5, 5], [4, 4]],
    Reading: [[10, 10], [9, 9], [8, 8], [7, 7], [6, 6], [5, 5], [4, 4]],
    Writing: [[10, 10], [9, 9], [8, 8], [7, 7], [6, 6], [5, 5], [4, 4]],
  },
  ielts: {
    Speaking: [[7.5, 10], [7, 9], [6.5, 8], [6, 7], [5.5, 6], [5, 5], [4, 4]],
    Listening: [[8.5, 10], [8, 9], [7.5, 8], [6, 7], [5.5, 6], [5, 5], [4.5, 4]],
    Reading: [[8, 10], [7, 9], [6.5, 8], [6, 7], [5, 6], [4, 5], [3.5, 4]],
    Writing: [[7.5, 10], [7, 9], [6.5, 8], [6, 7], [5.5, 6], [5, 5], [4, 4]],
  },
  pte: {
    Speaking: [[89, 10], [84, 9], [76, 8], [68, 7], [59, 6], [51, 5], [42, 4]],
    Listening: [[89, 10], [82, 9], [71, 8], [60, 7], [50, 6], [39, 5], [28, 4]],
    Reading: [[88, 10], [78, 9], [69, 8], [60, 7], [51, 6], [42, 5], [33, 4]],
    Writing: [[90, 10], [88, 9], [79, 8], [69, 7], [60, 6], [51, 5], [41, 4]],
  },
  tef: {
    Speaking: [[393, 10], [371, 9], [349, 8], [310, 7], [271, 6], [226, 5], [181, 4]],
    Listening: [[316, 10], [298, 9], [280, 8], [249, 7], [217, 6], [181, 5], [145, 4]],
    Reading: [[263, 10], [248, 9], [233, 8], [207, 7], [181, 6], [151, 5], [121, 4]],
    Writing: [[393, 10], [371, 9], [349, 8], [310, 7], [271, 6], [226, 5], [181, 4]],
  },
  tcf: {
    Speaking: [[16, 10], [14, 9], [12, 8], [10, 7], [7, 6], [6, 5], [4, 4]],
    Listening: [[549, 10], [523, 9], [503, 8], [458, 7], [398, 6], [369, 5], [331, 4]],
    Reading: [[549, 10], [524, 9], [499, 8], [453, 7], [406, 6], [375, 5], [342, 4]],
    Writing: [[16, 10], [14, 9], [12, 8], [10, 7], [7, 6], [6, 5], [4, 4]],
  },
};

function languageTestKey(value) {
  const normalized = String(value || "").toLowerCase();

  if (normalized.includes("celpip")) {
    return "celpip";
  }

  if (normalized.includes("ielts")) {
    return "ielts";
  }

  if (normalized.includes("pte")) {
    return "pte";
  }

  if (normalized.includes("tef")) {
    return "tef";
  }

  if (normalized.includes("tcf")) {
    return "tcf";
  }

  return "";
}

function convertLanguageScoreToClb(testName, ability, rawScore) {
  const thresholds = LANGUAGE_TEST_THRESHOLDS[languageTestKey(testName)]?.[ability];
  return thresholds ? scoreByMinimum(rawScore, thresholds) : normalizedClb(rawScore);
}

function getLanguageAbilities(profile, prefix, fallbackField, testField) {
  const fallback = normalizedClb(profile[fallbackField]);
  const testName = profile[testField];

  return LANGUAGE_ABILITIES.map((ability) => {
    const fieldValue = profile[`${prefix}${ability}Clb`];
    return fieldValue === undefined || fieldValue === null || fieldValue === ""
      ? fallback
      : convertLanguageScoreToClb(testName, ability, fieldValue);
  });
}

function allAtLeast(abilities, minimum) {
  return abilities.every((level) => level >= minimum);
}

function hasLanguageScore(abilities) {
  return abilities.some((level) => level > 0);
}

function scoreFirstLanguageAbility(level, spouseAccompanying) {
  if (level >= 10) {
    return spouseAccompanying ? 32 : 34;
  }

  if (level === 9) {
    return spouseAccompanying ? 29 : 31;
  }

  if (level === 8) {
    return spouseAccompanying ? 22 : 23;
  }

  if (level === 7) {
    return spouseAccompanying ? 16 : 17;
  }

  if (level === 6) {
    return spouseAccompanying ? 8 : 9;
  }

  if (level >= 4) {
    return 6;
  }

  return 0;
}

function scoreFirstLanguage(abilities, spouseAccompanying) {
  return abilities.reduce((total, level) => total + scoreFirstLanguageAbility(level, spouseAccompanying), 0);
}

function scoreSecondLanguageAbility(level) {
  if (level >= 9) {
    return 6;
  }

  if (level >= 7) {
    return 3;
  }

  if (level >= 5) {
    return 1;
  }

  return 0;
}

function scoreSecondLanguage(abilities, spouseAccompanying) {
  const maximum = spouseAccompanying ? 22 : 24;
  return Math.min(maximum, abilities.reduce((total, level) => total + scoreSecondLanguageAbility(level), 0));
}

function scoreSpouseLanguage(abilities) {
  return Math.min(
    20,
    abilities.reduce((total, level) => {
      if (level >= 9) {
        return total + 5;
      }

      if (level >= 7) {
        return total + 3;
      }

      if (level >= 5) {
        return total + 1;
      }

      return total;
    }, 0)
  );
}

function scoreCanadianExperience(years, spouseAccompanying) {
  const experienceYears = yearsFromValue(years);
  const points = spouseAccompanying
    ? { 1: 35, 2: 46, 3: 56, 4: 63, 5: 70 }
    : { 1: 40, 2: 53, 3: 64, 4: 72, 5: 80 };

  return points[Math.min(5, experienceYears)] ?? 0;
}

function scoreSpouseCanadianExperience(years) {
  const experienceYears = yearsFromValue(years);
  const points = { 1: 5, 2: 7, 3: 8, 4: 9, 5: 10 };
  return points[Math.min(5, experienceYears)] ?? 0;
}

function hasPostSecondaryCredential(level) {
  return ["oneYear", "twoYear", "bachelor", "twoOrMore", "masters", "doctoral"].includes(level);
}

function hasAdvancedCredential(level) {
  return ["twoOrMore", "masters", "doctoral"].includes(level);
}

function scoreEducationLanguageTransferability(level, firstLanguageAbilities) {
  if (!hasPostSecondaryCredential(level)) {
    return 0;
  }

  if (allAtLeast(firstLanguageAbilities, 9)) {
    return hasAdvancedCredential(level) ? 50 : 25;
  }

  if (allAtLeast(firstLanguageAbilities, 7)) {
    return hasAdvancedCredential(level) ? 25 : 13;
  }

  return 0;
}

function scoreEducationCanadianWorkTransferability(level, canadianYears) {
  if (!hasPostSecondaryCredential(level) || canadianYears < 1) {
    return 0;
  }

  if (canadianYears >= 2) {
    return hasAdvancedCredential(level) ? 50 : 25;
  }

  return hasAdvancedCredential(level) ? 25 : 13;
}

function scoreForeignLanguageTransferability(foreignYears, firstLanguageAbilities) {
  if (foreignYears < 1) {
    return 0;
  }

  if (allAtLeast(firstLanguageAbilities, 9)) {
    return foreignYears >= 3 ? 50 : 25;
  }

  if (allAtLeast(firstLanguageAbilities, 7)) {
    return foreignYears >= 3 ? 25 : 13;
  }

  return 0;
}

function scoreForeignCanadianWorkTransferability(foreignYears, canadianYears) {
  if (foreignYears < 1 || canadianYears < 1) {
    return 0;
  }

  if (foreignYears >= 3) {
    return canadianYears >= 2 ? 50 : 25;
  }

  return canadianYears >= 2 ? 25 : 13;
}

function scoreCertificateTransferability(profile, firstLanguageAbilities) {
  if (!yes(profile.certificateOfQualification)) {
    return 0;
  }

  if (allAtLeast(firstLanguageAbilities, 7)) {
    return 50;
  }

  if (allAtLeast(firstLanguageAbilities, 5)) {
    return 25;
  }

  return 0;
}

function scoreCanadianEducation(profile, level) {
  if (!yes(profile.educationInCanada)) {
    return 0;
  }

  const credentialLength = String(profile.canadianEducationCredentialLevel || "").toLowerCase();

  if (credentialLength.includes("secondary")) {
    return 0;
  }

  if (credentialLength.includes("three") || credentialLength.includes("master") || credentialLength.includes("doctor")) {
    return 30;
  }

  if (credentialLength.includes("one") || credentialLength.includes("two")) {
    return 15;
  }

  if (["bachelor", "twoOrMore", "masters", "doctoral"].includes(level)) {
    return 30;
  }

  return hasPostSecondaryCredential(level) ? 15 : 0;
}

function languageNameIsFrench(value) {
  return String(value || "").toLowerCase().includes("french");
}

function languageFromTest(value) {
  const normalized = String(value || "").toLowerCase();

  if (normalized.includes("tef") || normalized.includes("tcf")) {
    return "French";
  }

  if (normalized.includes("celpip") || normalized.includes("ielts") || normalized.includes("pte")) {
    return "English";
  }

  return "";
}

function hasLanguageTestResult(value) {
  const normalized = String(value || "").toLowerCase();
  return Boolean(normalized) && normalized !== "not applicable" && normalized !== "no";
}

function scoreFrenchLanguage(profile, firstLanguageAbilities, secondLanguageAbilities) {
  const firstOfficialLanguage = profile.firstOfficialLanguage || languageFromTest(profile.firstLanguageTest);
  const secondOfficialLanguage = profile.secondOfficialLanguage || languageFromTest(profile.secondLanguageTest);
  const firstIsFrench = languageNameIsFrench(firstOfficialLanguage);
  const secondIsFrench = languageNameIsFrench(secondOfficialLanguage);

  if (!firstIsFrench && !secondIsFrench) {
    return 0;
  }

  const frenchAbilities = firstIsFrench ? firstLanguageAbilities : secondLanguageAbilities;
  const englishAbilities = firstIsFrench ? secondLanguageAbilities : firstLanguageAbilities;

  if (!allAtLeast(frenchAbilities, 7)) {
    return 0;
  }

  if (allAtLeast(englishAbilities, 5)) {
    return 50;
  }

  if (!hasLanguageScore(englishAbilities) || englishAbilities.every((level) => level <= 4)) {
    return 25;
  }

  return 0;
}

export function calculateCrsScore(formData) {
  const profile = {
    ...asObject(formData.profile),
    ...asObject(formData.language),
    ...asObject(formData.work),
    ...asObject(formData.additional),
    ...asObject(formData.spouse),
  };
  const jobOffer = {
    ...asObject(formData.jobOffer),
    ...asObject(formData.work),
  };
  const hasCurrentSpouse = isMarriedOrCommonLaw(profile.maritalStatus);
  const spouseAccompanying = hasCurrentSpouse && yes(profile.spouseAccompany) && !yes(profile.spouseCanadianCitizenPr);
  const age = ageFromProfile(profile);
  const ageScore = scoreAge(age, spouseAccompanying);
  const highestEducation = profile.highestEducation || (yes(profile.postSecondaryEducation) ? profile.highestEducation : "");
  const highestEducationLevel = educationLevel(highestEducation, profile);
  const educationScore = scoreEducation(highestEducationLevel, spouseAccompanying);
  const hasApprovedLanguageTest = yes(profile.approvedLanguageTest);
  const firstLanguageAbilities = hasApprovedLanguageTest
    ? getLanguageAbilities(profile, "firstLanguage", "firstLanguageClb", "firstLanguageTest")
    : [0, 0, 0, 0];
  const secondLanguageAbilities = hasApprovedLanguageTest
    ? getLanguageAbilities(profile, "secondLanguage", "secondLanguageClb", "secondLanguageTest")
    : [0, 0, 0, 0];
  const firstLanguageScore = scoreFirstLanguage(firstLanguageAbilities, spouseAccompanying);
  const secondLanguageScore = hasLanguageScore(secondLanguageAbilities)
    ? scoreSecondLanguage(secondLanguageAbilities, spouseAccompanying)
    : 0;
  const canadianYears = yearsFromValue(profile.canadianSkilledExperienceYears);
  const foreignYears = yearsFromValue(profile.foreignSkilledExperienceYears);
  const canadianExperienceScore = scoreCanadianExperience(canadianYears, spouseAccompanying);
  const spouseEducationLevel = educationLevel(profile.spouseEducation);
  const spouseEducationScore = spouseAccompanying ? scoreSpouseEducation(spouseEducationLevel) : 0;
  const spouseLanguageAbilities = spouseAccompanying && hasLanguageTestResult(profile.spouseLanguageTest)
    ? getLanguageAbilities(profile, "spouseLanguage", "spouseLanguageClb", "spouseLanguageTest")
    : [0, 0, 0, 0];
  const spouseLanguageScore = spouseAccompanying ? scoreSpouseLanguage(spouseLanguageAbilities) : 0;
  const spouseCanadianExperienceScore = spouseAccompanying ? scoreSpouseCanadianExperience(profile.spouseCanadianWorkYears) : 0;
  const spouseFactorsScore = Math.min(40, spouseEducationScore + spouseLanguageScore + spouseCanadianExperienceScore);

  const educationLanguageTransferability = scoreEducationLanguageTransferability(highestEducationLevel, firstLanguageAbilities);
  const educationCanadianWorkTransferability = scoreEducationCanadianWorkTransferability(highestEducationLevel, canadianYears);
  const educationTransferabilityScore = Math.min(50, educationLanguageTransferability + educationCanadianWorkTransferability);
  const foreignLanguageTransferability = scoreForeignLanguageTransferability(foreignYears, firstLanguageAbilities);
  const foreignCanadianWorkTransferability = scoreForeignCanadianWorkTransferability(foreignYears, canadianYears);
  const foreignWorkTransferabilityScore = Math.min(50, foreignLanguageTransferability + foreignCanadianWorkTransferability);
  const certificateTransferability = scoreCertificateTransferability(profile, firstLanguageAbilities);
  const transferabilityScore = Math.min(
    100,
    educationTransferabilityScore + foreignWorkTransferabilityScore + certificateTransferability
  );

  const nominationScore = yes(profile.nominationCertificate) ? 600 : 0;
  const siblingScore = yes(profile.siblingInCanada) ? 15 : 0;
  const canadianEducationScore = scoreCanadianEducation(profile, highestEducationLevel);
  const frenchScore = scoreFrenchLanguage(profile, firstLanguageAbilities, secondLanguageAbilities);
  const jobOfferScore = 0;
  const additionalScore = Math.min(
    600,
    nominationScore + siblingScore + canadianEducationScore + frenchScore + jobOfferScore
  );

  const coreHumanCapitalScore = ageScore + educationScore + firstLanguageScore + secondLanguageScore + canadianExperienceScore;
  const totalScore = Math.min(1200, coreHumanCapitalScore + spouseFactorsScore + transferabilityScore + additionalScore);

  return {
    score: totalScore,
    breakdown: {
      age,
      spouseAccompanying,
      languageAbilities: {
        firstOfficialLanguage: firstLanguageAbilities,
        secondOfficialLanguage: secondLanguageAbilities,
        spouseFirstOfficialLanguage: spouseLanguageAbilities,
      },
      coreHumanCapital: {
        total: coreHumanCapitalScore,
        age: ageScore,
        education: educationScore,
        firstLanguage: firstLanguageScore,
        secondLanguage: secondLanguageScore,
        canadianExperience: canadianExperienceScore,
      },
      spouseFactors: {
        total: spouseFactorsScore,
        education: spouseEducationScore,
        firstLanguage: spouseLanguageScore,
        canadianExperience: spouseCanadianExperienceScore,
      },
      transferability: {
        total: transferabilityScore,
        education: {
          total: educationTransferabilityScore,
          language: educationLanguageTransferability,
          canadianWork: educationCanadianWorkTransferability,
        },
        foreignWork: {
          total: foreignWorkTransferabilityScore,
          language: foreignLanguageTransferability,
          canadianWork: foreignCanadianWorkTransferability,
        },
        certificate: certificateTransferability,
      },
      additional: {
        total: additionalScore,
        provincialNomination: nominationScore,
        jobOffer: jobOfferScore,
        jobOfferPolicy: yes(jobOffer.validJobOffer) ? "CRS job-offer points were removed by IRCC on March 25, 2025." : null,
        siblingInCanada: siblingScore,
        canadianEducation: canadianEducationScore,
        frenchLanguage: frenchScore,
      },
      note: "Estimated CRS score for planning. Final CRS depends on official IRCC rules and verified language, education, work, and family details.",
    },
  };
}

function emptyAssessment(scopedCase) {
  return {
    id: null,
    agencyId: null,
    clientId: scopedCase.clientId,
    caseId: scopedCase.id,
    userId: null,
    formData: scopedCase.client?.maritalStatus
      ? formDataWithMaritalStatus({}, scopedCase.client.maritalStatus)
      : {},
    crsScore: null,
    crsBreakdown: null,
    declaredComplete: false,
    declaredAt: null,
    createdAt: null,
    updatedAt: null,
  };
}

export async function getCaseAssessment(req, res) {
  const scopedCase = await findScopedCase(req);
  const data = await prisma.caseAssessment.findFirst({
    where: {
      agencyId: req.user.agencyId,
      caseId: scopedCase.id,
    },
  });

  if (!data) {
    res.json({ data: emptyAssessment(scopedCase) });
    return;
  }

  res.json({
    data: scopedCase.client?.maritalStatus
      ? {
          ...data,
          formData: formDataWithMaritalStatus(
            data.formData,
            scopedCase.client.maritalStatus,
          ),
        }
      : data,
  });
}

export async function saveCaseAssessment(req, res) {
  const scopedCase = await findScopedCase(req);
  const requestedFormData = asObject(req.body.formData);
  const declaredComplete = Boolean(req.body.declaredComplete);
  const submittedProfile = asObject(requestedFormData.profile);
  const submittedMaritalStatus = Object.hasOwn(submittedProfile, "maritalStatus")
    ? normalizeMaritalStatus(submittedProfile.maritalStatus)
    : undefined;
  if (
    Object.hasOwn(submittedProfile, "maritalStatus") &&
    String(submittedProfile.maritalStatus || "").trim() &&
    !submittedMaritalStatus
  ) {
    throw createHttpError(400, "Marital status is invalid.");
  }
  const canonicalMaritalStatus = submittedMaritalStatus !== undefined
    ? submittedMaritalStatus
    : scopedCase.client?.maritalStatus;
  const formData = canonicalMaritalStatus
    ? formDataWithMaritalStatus(requestedFormData, canonicalMaritalStatus)
    : requestedFormData;
  const { score, breakdown } = calculateCrsScore(formData);

  const data = await prisma.$transaction(async (tx) => {
    const assessment = await tx.caseAssessment.upsert({
      where: {
        agencyId_caseId: {
          agencyId: req.user.agencyId,
          caseId: scopedCase.id,
        },
      },
      create: {
        agencyId: req.user.agencyId,
        clientId: scopedCase.clientId,
        caseId: scopedCase.id,
        userId: req.user.id,
        formData,
        crsScore: score,
        crsBreakdown: breakdown,
        declaredComplete,
        declaredAt: declaredComplete ? new Date() : null,
      },
      update: {
        userId: req.user.id,
        formData,
        crsScore: score,
        crsBreakdown: breakdown,
        declaredComplete,
        declaredAt: declaredComplete ? new Date() : null,
      },
    });

    if (submittedMaritalStatus !== undefined) {
      await syncClientMaritalStatus(tx, {
        agencyId: req.user.agencyId,
        clientId: scopedCase.clientId,
        maritalStatus: submittedMaritalStatus,
        excludeAssessmentId: assessment.id,
        assessmentPatch: (nextFormData) => {
          const nextScore = calculateCrsScore(nextFormData);
          return {
            crsScore: nextScore.score,
            crsBreakdown: nextScore.breakdown,
          };
        },
      });
    }

    return assessment;
  });

  const questionnaireSync = await syncQuestionnaireAssignments({
    assessmentId: data.id,
    agencyId: req.user.agencyId,
    caseId: scopedCase.id,
    clientId: scopedCase.clientId,
    formData,
  });
  const sharedQuestionnaireChanges = questionnaireSync.changes.filter(
    ({ current }) => current.sharing === "Shared",
  );
  const clientUsers = sharedQuestionnaireChanges.length
    ? await clientRecipientIds(req.user.agencyId, scopedCase.clientId)
    : [];
  if (sharedQuestionnaireChanges.length) {
    const newlyAssigned = sharedQuestionnaireChanges.filter(({ previous }) => !previous).length;
    const reopened = sharedQuestionnaireChanges.filter(
      ({ previous, current }) => previous?.locked && !current.locked,
    ).length;
    const attentionRequired = newlyAssigned > 0 || reopened > 0;
    await notifyUsers({
      agencyId: req.user.agencyId,
      recipientIds: clientUsers,
      actorUserId: req.user.id,
      type: attentionRequired ? "questionnaire.assigned" : "questionnaire.updated",
      category: "questionnaires",
      title: attentionRequired
        ? `${sharedQuestionnaireChanges.length} questionnaire ${sharedQuestionnaireChanges.length === 1 ? "item needs" : "items need"} your attention`
        : "Your questionnaires were updated",
      body: "Open Questionnaires to review the latest sections and due dates.",
      severity: attentionRequired ? "warning" : "info",
      attentionLevel: attentionRequired ? "action_required" : "update",
      entityType: "questionnaire_collection",
      entityId: scopedCase.id,
      actionUrl: "/client-portal/questionnaires",
      dedupeKey: `case:${scopedCase.id}:questionnaire-collection`,
      aggregate: true,
    });
  }

  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: scopedCase.clientId,
    caseId: scopedCase.id,
    action: "assessment.saved",
    details: `Assessment saved with estimated CRS ${score}`,
  });

  res.json({ data });
}
