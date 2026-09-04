// Best-guess label/owner/source for a raw PDF field name, shown to the
// admin on the import/mapping screen as a starting point — never applied
// silently to a field a human has already confirmed (see
// formFieldMappingService.regenerateFieldSchemaFromBuffer).

const RULES = [
  { test: /family.?name|surname/i, label: "Family name", owner: "Client", sourcePath: "client.familyName" },
  { test: /given.?name/i, label: "Given name(s)", owner: "Client", sourcePath: "client.givenNames" },
  { test: /full.?name|legal.?name/i, label: "Full name", owner: "Client", sourcePath: "client.fullName" },
  { test: /date.?of.?birth|\bdob\b/i, label: "Date of birth", owner: "Client", sourcePath: "client.dateOfBirth" },
  { test: /\buci\b|unique.?client/i, label: "Unique Client Identifier (UCI)", owner: "Client", sourcePath: "client.uci" },
  { test: /application.?(number|no)/i, label: "Application number", owner: "Case", sourcePath: "case.applicationNumber" },
  { test: /type.?of.?application/i, label: "Type of application", owner: "Case", sourcePath: "case.caseType" },
  { test: /e-?mail/i, label: "Email address", owner: "Client", sourcePath: "client.email" },
  { test: /fax/i, label: "Fax number", owner: "Representative", sourcePath: "agency.faxNumber" },
  { test: /(secondary|alternate|alternative|backup).*(phone|telephone)|(phone|telephone).*(secondary|alternate|alternative|backup)/i, label: "Secondary telephone number", owner: "Client", sourcePath: "client.secondaryPhone" },
  { test: /phone|telephone/i, label: "Telephone number", owner: "Client", sourcePath: "client.phone" },
  { test: /firm|organi[sz]ation/i, label: "Name of firm or organization", owner: "Representative", sourcePath: "agency.name" },
  { test: /membership|licen[cs]e|rcic|cicc/i, label: "Membership / license number", owner: "Representative", sourcePath: "representative.licenseNumber" },
  { test: /province|territory/i, label: "Province / territory", owner: "Representative", sourcePath: "representative.membershipProvince" },
  { test: /postal.?code|zip/i, label: "Postal code", owner: "Representative", sourcePath: "agency.postalCode" },
  { test: /city|town/i, label: "City / town", owner: "Representative", sourcePath: "agency.city" },
  { test: /street|address|apt|unit/i, label: "Mailing address", owner: "Representative", sourcePath: "agency.address" },
  { test: /representative.*name/i, label: "Representative's name", owner: "Representative", sourcePath: "representative.fullName" },
  { test: /signature/i, label: "Signature", owner: "Manual", sourcePath: null, fillableBy: "Both" },
  { test: /date/i, label: "Date", owner: "Manual", sourcePath: null },
];

function humanizeFieldKey(fieldKey) {
  const last = String(fieldKey).split(/[.[\]]/).filter(Boolean).pop() || fieldKey;
  return last
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase()) || fieldKey;
}

export function guessFieldMapping(fieldKey) {
  const rule = RULES.find((candidate) => candidate.test.test(fieldKey));
  const owner = rule?.owner || "Manual";
  return {
    label: rule?.label || humanizeFieldKey(fieldKey),
    owner,
    sourcePath: rule?.sourcePath || null,
    fillableBy: rule?.fillableBy || (owner === "Client" ? "Both" : "Consultant"),
  };
}
