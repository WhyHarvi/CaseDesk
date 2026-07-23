import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CASE_EASY_REPORT_DEFINITIONS,
  detectCaseEasyReportType,
  mapCaseEasyReportRows,
} from "../src/services/caseEasyReportImportService.js";

const source = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("all supported client-linked Case Easy reports are catalogued", () => {
  assert.deepEqual(Object.keys(CASE_EASY_REPORT_DEFINITIONS), [
    "payment_requests",
    "invoices",
    "payments",
    "receipts",
    "account_receivables",
    "retainer_balances",
    "client_listing",
    "trust_balances",
    "reminders",
    "time_entries",
    "trust_account_entries",
    "activity_tracker",
    "case_information",
    "employers_applications",
    "e_signatures",
  ]);
  for (const excluded of [
    "case_types",
    "cicc_annual_report",
    "caseeasy_pay",
    "audit_history",
  ]) {
    assert.equal(CASE_EASY_REPORT_DEFINITIONS[excluded], undefined);
  }
  for (const [type, definition] of Object.entries(
    CASE_EASY_REPORT_DEFINITIONS,
  )) {
    assert.equal(
      detectCaseEasyReportType(definition.signatures).type,
      type,
      `${definition.label} should be independently detectable`,
    );
  }
});

test("Client Listing is detected and preserves its source columns", () => {
  const headers = [
    "Case Number",
    "Unique Client Identifier (UCI)",
    "Client Identifier",
    "Full Name",
    "Email",
    "Case Type",
    "Case Status",
    "Trust Balance",
    "Currency",
    "Trust Account",
    "Created Date",
  ];
  assert.equal(detectCaseEasyReportType(headers).type, "client_listing");
  const mapped = mapCaseEasyReportRows(
    {
      headers,
      rows: [
        {
          rowNumber: 2,
          raw: {
            "Case Number": "00002-Perry",
            "Client Identifier": "KP-2",
            "Full Name": "Katy Perry",
            Email: "katy@example.com",
            "Trust Balance": "2500.00",
            Currency: "CAD",
            "Trust Account": "General Trust",
            "Created Date": "2026-01-01",
          },
        },
      ],
    },
  );
  assert.equal(mapped.reportType, "client_listing");
  assert.equal(mapped.rows[0].clientIdentifier, "KP-2");
  assert.equal(mapped.rows[0].caseNumber, "00002-Perry");
  assert.equal(mapped.rows[0].rawData["Trust Balance"], "2500.00");
  assert.equal(mapped.rows[0].rawData["Trust Account"], "General Trust");
  assert.equal(mapped.rows[0].sourceRowKey.length, 64);
});

test("report detection distinguishes milestone and financial exports", () => {
  assert.equal(
    detectCaseEasyReportType([
      "Case Number",
      "Foreign national arrival date",
      "Resubmission date",
      "Extension submission date",
      "Deferral received date",
    ]).type,
    "case_information",
  );
  assert.equal(
    detectCaseEasyReportType([
      "Case Number",
      "Transaction Number",
      "Payment Date",
      "Method",
      "Amount",
    ]).type,
    "payments",
  );
});

test("report staging prefers stable identifiers and follows conversion links", async () => {
  const [service, schema, migration, controller] = await Promise.all([
    source("../src/services/caseEasyReportImportService.js"),
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260723120000_case_easy_reports/migration.sql"),
    source("../src/controllers/caseEasyImportController.js"),
  ]);
  assert.match(schema, /model CaseEasyImportReportRow/);
  assert.match(schema, /clientIdentifier\s+String\?/);
  assert.match(migration, /foreign_national_arrival_date/);
  assert.match(migration, /case_easy_import_report_rows/);
  assert.match(service, /contactsByIdentifier/);
  assert.match(service, /casesByNumber/);
  assert.match(service, /backfillClientIdentifiers/);
  assert.match(service, /applyCaseInformationMilestones/);
  assert.match(controller, /linkedClientId: client\.id/);
  assert.match(controller, /linkedCaseId: newCase\.id/);
});

test("report upload, browser, and client history are connected", async () => {
  const [routes, settings, browser, clientCard] = await Promise.all([
    source("../src/routes/caseEasyImportRoutes.js"),
    source("../../frontend/src/components/settings/CaseEasyReportImportPanel.jsx"),
    source("../../frontend/src/components/case-easy/CaseEasyReportsBrowser.jsx"),
    source("../../frontend/src/components/clients/CaseEasyReportsCard.jsx"),
  ]);
  assert.match(routes, /"\/reports\/preview"/);
  assert.match(routes, /"\/reports\/upload"/);
  assert.match(routes, /"\/clients\/:clientId\/reports"/);
  assert.match(settings, /Client Listing — import this first/);
  assert.match(browser, /row\.rawData/);
  assert.match(clientCard, /Case Easy report history/);
});
