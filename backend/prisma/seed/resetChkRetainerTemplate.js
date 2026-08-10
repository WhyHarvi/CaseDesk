// Restores CHK Immigration Services' retainer template back to its
// original content (see chkRetainerTemplateContent.js) — undoing any edits
// made since through the Settings > Correspondence Templates editor or the
// Writer. This does NOT touch any retainer documents already drafted on
// individual cases (WrittenDocument rows) — those keep whatever content
// they were created or saved with. Only the reusable template itself is
// reset, so the next case that starts a retainer from this template will
// get the original wording again.
//
// Creates the template from scratch if it somehow doesn't exist yet
// (delegating to the same logic as seedChkRetainerTemplate.js), so this is
// always safe to run regardless of current state.
//
// Run with: node prisma/seed/resetChkRetainerTemplate.js
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

  await ensureDefaultCorrespondenceTemplates(agency.id);
  await prisma.correspondenceTemplate.updateMany({
    where: { agencyId: agency.id, slug: "immigration-service-agreement" },
    data: { isSystemDefault: false, isRetainerTemplate: false },
  });

  const existing = await prisma.correspondenceTemplate.findFirst({ where: { agencyId: agency.id, slug: TEMPLATE_SLUG } });

  const fields = {
    title: TEMPLATE_TITLE,
    kind: "Agreement",
    category: "Client Agreements",
    description: TEMPLATE_DESCRIPTION,
    contentHtml: TEMPLATE_CONTENT_HTML,
    caseTags: TEMPLATE_CASE_TAGS,
    isSystemDefault: true,
    isRetainerTemplate: TEMPLATE_IS_RETAINER,
    isActive: true,
  };

  if (!existing) {
    const created = await prisma.correspondenceTemplate.create({
      data: {
        agencyId: agency.id,
        slug: TEMPLATE_SLUG,
        ...fields,
        versions: { create: { agencyId: agency.id, versionNumber: 1, title: fields.title, kind: fields.kind, category: fields.category, description: "Seeded from uploaded PDF", contentHtml: fields.contentHtml, caseTags: fields.caseTags } },
      },
    });
    console.log(`Template didn't exist — created "${created.title}" (id ${created.id}) for ${agency.name} fresh from the original content.`);
    return;
  }

  const versionNumber = existing.versionNumber + 1;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.correspondenceTemplateVersion.create({
      data: {
        agencyId: agency.id,
        correspondenceTemplateId: existing.id,
        versionNumber,
        title: fields.title,
        kind: fields.kind,
        category: fields.category,
        description: "Reset to original content extracted from the uploaded PDF",
        contentHtml: fields.contentHtml,
        caseTags: fields.caseTags,
      },
    });
    return tx.correspondenceTemplate.update({
      where: { id: existing.id },
      data: { ...fields, versionNumber },
    });
  });
  console.log(`Restored "${updated.title}" (id ${updated.id}) for ${agency.name} to its original content — now version ${updated.versionNumber}.`);
  console.log("Note: retainer documents already drafted on individual cases were not changed — only the reusable template.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
