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
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => interchangeableWords.get(word) || word)
    .join(" ");
  if (passportIdentityNames.has(normalized)) return "passport identity page";
  if (paymentReceiptNames.has(normalized)) return "application fee payment receipt";
  return normalized;
}

const statusPriority = {
  Finalized: 7,
  Approved: 6,
  UnderReview: 5,
  Uploaded: 4,
  ChangesRequested: 3,
  Requested: 2,
  NotRequired: 1,
};

export function deduplicateDocuments(documents) {
  const byNormalizedName = new Map();

  for (const document of documents) {
    const key = normalizeDocumentName(document.documentName);
    const current = byNormalizedName.get(key);
    if (!current || (statusPriority[document.status] || 0) > (statusPriority[current.status] || 0)) {
      byNormalizedName.set(key, document);
    }
  }

  return [...byNormalizedName.values()];
}
