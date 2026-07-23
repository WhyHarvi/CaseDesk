import "dotenv/config";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import prisma from "../src/services/prisma/client.js";
import { parseCsv } from "../src/modules/leads/lead.csv.js";
import { readSheetRowsFromWorkbook } from "../src/services/caseEasyImportService.js";
import {
  CASE_EASY_REPORT_DEFINITIONS,
  importCaseEasyReport,
} from "../src/services/caseEasyReportImportService.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const flagValue = (name) => {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
};

const agencyId = flagValue("--agency-id");
const reportPath = flagValue("--file");
const reportType = flagValue("--report-type");

if (!agencyId || !reportPath) {
  console.error(
    "Usage: node scripts/importCaseEasyReport.js --agency-id=<id> --file=<report.xlsx|report.csv> [--report-type=<type>] [--apply]",
  );
  console.error(
    `Supported report types: ${Object.keys(CASE_EASY_REPORT_DEFINITIONS).join(", ")}`,
  );
  process.exit(1);
}
if (reportType && !CASE_EASY_REPORT_DEFINITIONS[reportType]) {
  console.error(`Unknown report type: ${reportType}`);
  process.exit(1);
}

async function loadSheet(path) {
  if (path.toLowerCase().endsWith(".csv")) {
    const parsed = parseCsv(await readFile(path, "utf8"));
    return {
      headers: parsed.headers,
      rows: parsed.rows.map((raw, index) => ({ rowNumber: index + 2, raw })),
    };
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return readSheetRowsFromWorkbook(workbook, path);
}

async function run() {
  const result = await importCaseEasyReport({
    agencyId,
    sheet: await loadSheet(reportPath),
    reportType,
    apply,
  });
  console.log(
    `${result.reportLabel}: ${result.rowCount} row(s) parsed${apply ? "" : " (DRY RUN)"}.`,
  );
  if (apply) {
    console.log(
      `Created ${result.stats.created}, updated ${result.stats.updated}; linked ${result.stats.linked}, unlinked ${result.stats.unlinked}, ambiguous ${result.stats.ambiguous}.`,
    );
  } else {
    console.log("Re-run with --apply to store and link these report rows.");
  }
  if (result.errors.length) {
    for (const error of result.errors) {
      console.log(`[row ${error.row}] ${error.field}: ${error.message}`);
    }
  }
}

run()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
