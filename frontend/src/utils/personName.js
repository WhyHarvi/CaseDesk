export function composePersonFullName(givenNames, familyName) {
  return [givenNames, familyName]
    .map((value) => String(value || "").trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join(" ");
}

// Older client records only have fullName. Suggest a split in the editor,
// but keep needsReview=true so staff know to verify it against identity
// documents before saving the structured fields used by government forms.
export function clientNameParts(client = {}) {
  const givenNames = String(client.givenNames || "").trim();
  const familyName = String(client.familyName || "").trim();
  if (givenNames || familyName) {
    return { givenNames, familyName, needsReview: false };
  }

  const parts = String(client.fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { givenNames: "", familyName: "", needsReview: false };
  if (parts.length === 1) return { givenNames: parts[0], familyName: "", needsReview: true };
  return {
    givenNames: parts.slice(0, -1).join(" "),
    familyName: parts.at(-1),
    needsReview: true,
  };
}
