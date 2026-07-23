import "dotenv/config";
import ExcelJS from "exceljs";
import prisma from "../src/services/prisma/client.js";
import { importCaseEasyExports } from "../src/services/caseEasyImportService.js";

// Case Easy staging import — see docs/production/case-easy-import-prompt.md.
// Dry-run by default (parses + previews only); pass --apply to write.
// Safe to re-run: rows are upserted against a natural key (there is no
// shared external ID in Case Easy's exports), and the join/assignee/
// record-type resolution pass re-runs over the agency's whole staging set
// every time, not just the current batch, so a later import that adds the
// missing contact for a previously-unlinked case will resolve it.
//
// The same parsing/upsert/resolution logic backs the Settings → Case Easy
// Import upload flow (src/controllers/caseEasyImportController.js) via
// src/services/caseEasyImportService.js — this script is just a thin CLI
// wrapper around it for local/offline imports.

const args = process.argv.slice(2);
const apply = args.includes("--apply");
function flagValue(name) {
  const prefix = `${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

const agencyId = flagValue("--agency-id");
const contactsPath = flagValue("--contacts");
const casesPath = flagValue("--cases");
const prospectOrClientOverride = flagValue("--prospect-or-client");

if (!agencyId || !contactsPath || !casesPath) {
  console.error("Usage: node scripts/importCaseEasyData.js --agency-id=<id> --contacts=<path.xlsx> --cases=<path.xlsx> [--prospect-or-client=client|prospect] [--apply]");
  process.exit(1);
}
if (prospectOrClientOverride && !["client", "prospect"].includes(prospectOrClientOverride)) {
  console.error('--prospect-or-client must be "client" or "prospect"');
  process.exit(1);
}

async function loadWorkbook(path) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbook;
}

async function run() {
  const contactsWorkbook = await loadWorkbook(contactsPath);
  const casesWorkbook = await loadWorkbook(casesPath);

  const result = await importCaseEasyExports({ agencyId, contactsWorkbook, casesWorkbook, prospectOrClientOverride, apply });
  if (apply) {
    const { refreshCaseEasyReportProductionLinks } = await import(
      "../src/services/caseEasyReportImportService.js"
    );
    await refreshCaseEasyReportProductionLinks(agencyId);
  }

  console.log(`Batch ${result.importBatchId}${apply ? "" : " (DRY RUN — pass --apply to write)"}`);
  console.log(`Parsed ${result.contactRowCount} contact rows, ${result.caseRowCount} case rows.`);

  console.log("\n--- Summary ---");
  if (apply) {
    const stats = result.stats;
    console.log(`Contacts: ${stats.contactsCreated} created, ${stats.contactsUpdated} updated${stats.contactsSkippedConverted ? `, ${stats.contactsSkippedConverted} already converted (untouched)` : ""}`);
    console.log(`Cases: ${stats.casesCreated} created, ${stats.casesUpdated} updated, ${stats.casesLinked} linked to a contact${stats.casesSkippedConverted ? `, ${stats.casesSkippedConverted} already converted (untouched)` : ""}`);
    const reviewTotal = Object.values(stats.needsReview).reduce((sum, count) => sum + count, 0);
    console.log(`Needs review: ${reviewTotal} case(s)${reviewTotal ? ` (${Object.entries(stats.needsReview).map(([reason, count]) => `${reason}: ${count}`).join(", ")})` : ""}`);
  } else {
    console.log("Dry run: no rows written. Re-run with --apply to import, link, and resolve.");
  }
  if (result.errors.length) {
    console.log(`\nParse errors (${result.errors.length}):`);
    for (const error of result.errors) console.log(`  [${error.sheet} row ${error.row}] ${error.field}: ${error.message}`);
  } else {
    console.log("\nNo parse errors.");
  }

  await prisma.$disconnect();
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
