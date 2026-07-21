// Field-level conditional logic and validation rules (the "condition" and
// "validation" function families named in the parent redesign plan) are
// deliberately NOT implemented here — they need domain input this phase
// doesn't have. A consequence, accepted for Phase 1: conditional detail
// fields (e.g. "refusalDetails", only relevant when "refusedCanadaApplication"
// is "Yes") count toward a section's total field count even when correctly
// left blank, so a fully-and-correctly-filled section can still read
// "in_progress" rather than "complete". This is a known, named limitation,
// not a bug — Phase 1's job is proving the mechanism against real data,
// not delivering exact completion percentages.
//
// Similarly, this deliberately does NOT try to encode the different
// gate-flag semantics found in real data (hasTravelled / hasMoreSiblings /
// provideDetails) into the completion decision — their polarity is
// inconsistent in real stored data and guessing at rules we can't verify
// is worse than not having them. The gate value is passed through in the
// result for visibility, never used to drive status.

function isFilled(value) {
  return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null && value !== "";
}

function countFilledKnownFields(raw, knownFields) {
  const filled = knownFields.filter((field) => isFilled(raw[field])).length;
  return { filled, total: knownFields.length };
}

function statusFromRatio(filled, total) {
  if (total === 0) return "not_started";
  if (filled === 0) return "not_started";
  if (filled >= total) return "complete";
  return "in_progress";
}

function completeFlagStatus(completeFlag) {
  if (completeFlag === "Yes") return "complete";
  if (completeFlag === "No") return null; // explicit "not yet" — fall through to inference
  return undefined; // no explicit flag at all
}

function calculateFlatStatus(adaptedSection, knownFields) {
  if (knownFields) {
    const { filled, total } = countFilledKnownFields(adaptedSection.raw, knownFields);
    return { status: statusFromRatio(filled, total), filledCount: filled, totalCount: total };
  }
  // No dedicated field catalog exists for this section today (applicantDetails'
  // CRS inputs, spouseDetails) — count whatever keys are actually present
  // rather than guessing an exhaustive field list. Never claims "complete"
  // without a known field list to verify against.
  const presentKeys = Object.keys(adaptedSection.raw).filter((key) => isFilled(adaptedSection.raw[key]));
  const totalKeys = Object.keys(adaptedSection.raw).length;
  return {
    status: presentKeys.length > 0 ? "in_progress" : "not_started",
    filledCount: presentKeys.length,
    totalCount: totalKeys,
  };
}

function calculateCollectionStatus(adaptedSection) {
  const flagStatus = completeFlagStatus(adaptedSection.complete);
  const inferred = adaptedSection.entryCount > 0 ? "in_progress" : "not_started";
  return {
    status: flagStatus === undefined || flagStatus === null ? inferred : flagStatus,
    filledCount: adaptedSection.entryCount,
    totalCount: adaptedSection.entryCount,
  };
}

function calculatePairedEntitiesStatus(adaptedSection, knownFields) {
  const flagStatus = completeFlagStatus(adaptedSection.complete);
  if (flagStatus === "complete") {
    const { filled, total } = countFilledKnownFields(adaptedSection.pairs.father, knownFields || []);
    const mother = countFilledKnownFields(adaptedSection.pairs.mother, knownFields || []);
    return { status: "complete", filledCount: filled + mother.filled, totalCount: total + mother.total };
  }
  if (!knownFields) return { status: "not_started", filledCount: 0, totalCount: 0 };
  const father = countFilledKnownFields(adaptedSection.pairs.father, knownFields);
  const mother = countFilledKnownFields(adaptedSection.pairs.mother, knownFields);
  const filled = father.filled + mother.filled;
  const total = father.total + mother.total;
  return { status: statusFromRatio(filled, total), filledCount: filled, totalCount: total };
}

/**
 * Calculates a section's status from its already-adapted legacy data
 * (see legacyFormDataAdapter.js) and its resolved requirement level.
 * requirementLevel === "not_applicable" short-circuits to that status —
 * UNLESS the section already has real stored data, in which case the
 * data wins and stays visible (a case type reclassification, or a
 * section that later became not-applicable, must never make previously
 * saved information disappear).
 */
export function calculateSectionStatus({ sectionKey, adaptedSection, knownFields, requirementLevel }) {
  const computed = adaptedSection.kind === "flat"
    ? calculateFlatStatus(adaptedSection, knownFields)
    : adaptedSection.kind === "collection"
      ? calculateCollectionStatus(adaptedSection)
      : calculatePairedEntitiesStatus(adaptedSection, knownFields);

  if (requirementLevel === "not_applicable" && computed.filledCount === 0) {
    return { sectionKey, status: "not_applicable", filledCount: 0, totalCount: computed.totalCount };
  }

  return { sectionKey, ...computed };
}
