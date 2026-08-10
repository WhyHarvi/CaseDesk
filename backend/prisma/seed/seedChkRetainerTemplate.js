// One-off seed script — NOT part of the global defaultCorrespondenceTemplates
// list (correspondenceTemplateService.js), because this is CHK Immigration
// Services' own real retainer wording (their specific refund/termination
// terms, fee structure, $200/hr and $500 admin-fee figures) — seeding it to
// every agency on CaseDesk the way the generic CICC precedents are seeded
// would hand one agency's proprietary contract language to every other
// tenant. This script only ever touches the one agency it matches by name.
//
// Creates the template if it doesn't exist yet. If it already exists, this
// leaves it untouched (edits made through the Settings template editor are
// preserved) — use resetChkRetainerTemplate.js in this same folder to
// deliberately overwrite it back to the original content below.
//
// Run with: node prisma/seed/seedChkRetainerTemplate.js
// Requires DATABASE_URL and a working Prisma Client — this sandbox has
// neither network access to the database nor a matching query-engine
// binary, so this could not be executed from here. Run it from an
// environment that already runs your other prisma/migrate commands.

import prisma from "../../src/services/prisma/client.js";
import { ensureDefaultCorrespondenceTemplates } from "../../src/services/correspondenceTemplateService.js";
import {
  AGENCY_NAME_MATCH,
  TEMPLATE_TITLE,
  TEMPLATE_SLUG,
  TEMPLATE_DESCRIPTION,
  TEMPLATE_CASE_TAGS,
  TEMPLATE_CONTENT_HTML,
  TEMPLATE_IS_RETAINER,
} from "./chkRetainerTemplateContent.js";

async function main() {
  const agency = await prisma.agency.findFirst({ where: { name: { contains: AGENCY_NAME_MATCH, mode: "insensitive" } } });
  if (!agency) throw new Error(`No agency found matching "${AGENCY_NAME_MATCH}" — refusing to run against an ambiguous or missing agency.`);
  const duplicates = await prisma.agency.count({ where: { name: { contains: AGENCY_NAME_MATCH, mode: "insensitive" } } });
  if (duplicates > 1) throw new Error(`Multiple agencies match "${AGENCY_NAME_MATCH}" — narrow AGENCY_NAME_MATCH before running.`);

  // Guarantee the generic CICC default (currently the general-purpose
  // fallback) exists before demoting it, and so the well-known slug below
  // is stable to look up.
  await ensureDefaultCorrespondenceTemplates(agency.id);
  await prisma.correspondenceTemplate.updateMany({
    where: { agencyId: agency.id, slug: "immigration-service-agreement" },
    data: { isSystemDefault: false, isRetainerTemplate: false },
  });

  const existing = await prisma.correspondenceTemplate.findFirst({ where: { agencyId: agency.id, slug: TEMPLATE_SLUG } });
  if (existing) {
    console.log(`Template "${TEMPLATE_TITLE}" already exists for ${agency.name} (id ${existing.id}) — leaving it as-is. Run resetChkRetainerTemplate.js if you want to restore the original content.`);
    return;
  }

  const created = await prisma.correspondenceTemplate.create({
    data: {
      agencyId: agency.id,
      slug: TEMPLATE_SLUG,
      title: TEMPLATE_TITLE,
      kind: "Agreement",
      category: "Client Agreements",
      description: TEMPLATE_DESCRIPTION,
      contentHtml: TEMPLATE_CONTENT_HTML,
      caseTags: TEMPLATE_CASE_TAGS,
      isSystemDefault: true,
      isRetainerTemplate: TEMPLATE_IS_RETAINER,
      versions: { create: { agencyId: agency.id, versionNumber: 1, title: TEMPLATE_TITLE, kind: "Agreement", category: "Client Agreements", description: "Seeded from uploaded PDF", contentHtml: TEMPLATE_CONTENT_HTML, caseTags: TEMPLATE_CASE_TAGS } },
    },
  });
  console.log(`Created "${created.title}" (id ${created.id}) for ${agency.name} and demoted the generic CICC default to non-system-default.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
