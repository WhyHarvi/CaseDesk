// Whitelisted dot-paths a FormTemplateFieldSchema.sourcePath is allowed to
// resolve against. Deliberately a fixed lookup table, not an arbitrary
// object-path walk — a bad or malicious mapping can never reach a field
// that isn't explicitly listed here, and every path a consultant can pick
// in the mapping UI comes from this same list.

function formatDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10); // YYYY-MM-DD, matches every IRCC form's requested format
}

const REGISTRY = {
  "client.fullName": (ctx) => ctx.client?.fullName,
  "client.familyName": (ctx) => ctx.client?.familyName,
  "client.givenNames": (ctx) => ctx.client?.givenNames,
  "client.dateOfBirth": (ctx) => formatDate(ctx.client?.dateOfBirth),
  "client.email": (ctx) => ctx.client?.email,
  "client.phone": (ctx) => ctx.client?.phone,
  "client.uci": (ctx) => ctx.client?.uci,
  "client.address": (ctx) => ctx.client?.address,
  "client.clientNumber": (ctx) => ctx.client?.clientNumber,

  "case.caseType": (ctx) => ctx.case?.caseType,
  "case.applicationNumber": (ctx) => ctx.case?.applicationNumber,
  "case.stage": (ctx) => ctx.case?.stage,

  // "representative" — whichever staff user (admin or consultant) was
  // picked as CaseForm.representativeUserId, resolved by the caller before
  // this registry runs. Never Case.assignedUserId directly; that's just
  // the default when no explicit pick has been made yet.
  "representative.fullName": (ctx) => ctx.representative?.fullName,
  "representative.email": (ctx) => ctx.representative?.email,
  "representative.phone": (ctx) => ctx.representative?.phone,
  "representative.licenseNumber": (ctx) => ctx.representative?.licenseNumber,
  "representative.representativeType": (ctx) => ctx.representative?.representativeType,
  "representative.membershipBody": (ctx) => ctx.representative?.membershipBody,
  "representative.membershipProvince": (ctx) => ctx.representative?.membershipProvince,

  // Representative's firm/mailing-address block always comes from Agency
  // settings, never a per-case override — see Workspace Profile settings.
  "agency.name": (ctx) => ctx.agency?.name,
  "agency.address": (ctx) => ctx.agency?.address,
  "agency.addressUnit": (ctx) => ctx.agency?.addressUnit,
  "agency.city": (ctx) => ctx.agency?.city,
  "agency.province": (ctx) => ctx.agency?.province,
  "agency.country": (ctx) => ctx.agency?.country,
  "agency.postalCode": (ctx) => ctx.agency?.postalCode,
  "agency.phone": (ctx) => ctx.agency?.phone,
  "agency.faxNumber": (ctx) => ctx.agency?.faxNumber,
  "agency.email": (ctx) => ctx.agency?.email,
};

export const FORM_DATA_SOURCE_PATHS = Object.keys(REGISTRY);

export function resolveSourcePath(sourcePath, context) {
  const resolver = REGISTRY[sourcePath];
  if (!resolver) return null;
  const value = resolver(context || {});
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}
