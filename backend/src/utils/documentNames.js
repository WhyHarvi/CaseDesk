const interchangeableWords = new Map([
  ["certificates", "certificate"],
  ["copies", "copy"],
  ["degrees", "degree"],
  ["diplomas", "diploma"],
  ["documents", "document"],
  ["fees", "fee"],
  ["forms", "form"],
  ["letters", "letter"],
  ["pages", "page"],
  ["passports", "passport"],
  ["permits", "permit"],
  ["photos", "photo"],
  ["receipts", "receipt"],
  ["records", "record"],
  ["results", "result"],
  ["statements", "statement"],
  ["transcripts", "transcript"],
  ["translations", "translation"],
  ["visas", "visa"],
]);

const passportIdentityNames = new Set([
  "passport",
  "passport bio page",
  "passport biographical page",
  "passport identity page",
  "passport information page",
  "passport or travel document",
  "passport or travel document bio page",
  "valid passport bio page",
  "valid passport information page",
]);

const paymentReceiptNames = new Set([
  "application fee payment receipt",
  "payment receipt",
  "proof of application fee payment",
  "proof of payment of application fee",
  "proof of payment receipt",
]);

export function normalizeDocumentName(value) {
  const words = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => interchangeableWords.get(word) || word);

  const normalized = words.join(" ");
  if (passportIdentityNames.has(normalized)) return "passport identity page";
  if (paymentReceiptNames.has(normalized)) return "application fee payment receipt";
  return normalized;
}

export function uniqueDocumentNames(values) {
  const byNormalizedName = new Map();

  for (const value of values) {
    const documentName = String(value || "").trim().replace(/\s+/g, " ");
    const normalizedName = normalizeDocumentName(documentName);
    if (documentName && normalizedName && !byNormalizedName.has(normalizedName)) {
      byNormalizedName.set(normalizedName, documentName);
    }
  }

  return [...byNormalizedName.values()];
}
