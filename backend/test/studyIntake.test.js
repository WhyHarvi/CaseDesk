import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatStudyIntakeMonth, isStudyPermitCaseType, normalizeStudyIntakeMonth, stageRequiresStudyIntake, studyIntakeKey } from "../src/utils/studyIntake.js";
import { isStudyPermitCaseType as isFrontendStudyPermitCaseType } from "../../frontend/src/utils/studyIntake.js";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("academic intake helpers normalize month values without timezone drift", () => {
  const supportedStudyCaseTypes = [
    " Study   Permit ",
    "Study Permit with Spouse",
    "Spouse + Study Permit",
    "Study Permit Extension",
    "Study-Permit / Spouse OWP",
    "Study",
  ];
  for (const caseType of supportedStudyCaseTypes) {
    assert.equal(isStudyPermitCaseType(caseType), true, `backend should include ${caseType}`);
    assert.equal(isFrontendStudyPermitCaseType(caseType), true, `frontend should include ${caseType}`);
  }
  for (const caseType of ["Work Permit", "Study Abroad Consultation", "Spousal Sponsorship"]) {
    assert.equal(isStudyPermitCaseType(caseType), false, `backend should exclude ${caseType}`);
    assert.equal(isFrontendStudyPermitCaseType(caseType), false, `frontend should exclude ${caseType}`);
  }
  assert.equal(studyIntakeKey(normalizeStudyIntakeMonth("2027-09-28")), "2027-09");
  assert.equal(formatStudyIntakeMonth("2027-09-01"), "September 2027");
  assert.equal(stageRequiresStudyIntake("Retainer Pending"), false);
  assert.equal(stageRequiresStudyIntake("Documents Pending"), true);
  assert.equal(stageRequiresStudyIntake("Submitted"), true);
});

test("case storage, filtering, audit history, and routes include academic intake", async () => {
  const [schema, migration, controller, routes] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260808182000_study_permit_intake/migration.sql"),
    source("../src/controllers/caseController.js"),
    source("../src/routes/caseRoutes.js"),
  ]);

  assert.match(schema, /studyIntakeMonth\s+DateTime\?/);
  assert.match(schema, /@@index\(\[agencyId, studyIntakeMonth\]\)/);
  assert.match(migration, /ADD COLUMN "study_intake_month" DATE/);
  assert.match(controller, /studyIntakeMonth: fieldParsers\.dateField/);
  assert.match(controller, /STUDY_INTAKE_REQUIRED/);
  assert.match(controller, /Intake changed from/);
  assert.match(controller, /studyIntakeFilterWhere\(req\.query\.studyIntake\)/);
  assert.match(controller, /caseType: \{ contains: "Study Permit", mode: "insensitive" \}/);
  assert.match(controller, /caseType: \{ contains: "Study-Permit", mode: "insensitive" \}/);
  assert.match(controller, /export async function listStudyIntakes[\s\S]*AND: \[[\s\S]*caseAccessWhere\(req\)/);
  assert.match(routes, /router\.get\("\/study-intakes", asyncHandler\(listStudyIntakes\)\)/);
});

test("case and lead user interfaces expose the selector, badges, search, and filter", async () => {
  const [casesPage, commandBar, profileSummary, conversionSheet] = await Promise.all([
    source("../../frontend/src/pages/Cases.jsx"),
    source("../../frontend/src/components/cases/CasesCommandBar.jsx"),
    source("../../frontend/src/components/case-profile/CaseProfileSummary.jsx"),
    source("../../frontend/src/modules/leads/components/ConvertLeadSheet.jsx"),
  ]);

  assert.match(casesPage, /<StudyIntakeSelect/);
  assert.match(casesPage, /<StudyIntakeBadge value=\{item\.studyIntakeMonth\}/);
  assert.match(casesPage, /formatStudyIntake\(caseItem\.studyIntakeMonth\)/);
  assert.match(commandBar, /label="Academic Intake"/);
  assert.match(commandBar, /Intake Not Set/);
  assert.match(commandBar, /Past Intakes/);
  assert.match(commandBar, /isStudyPermitCaseType\(value\)/);
  assert.match(commandBar, /\.\.\.cases\.map\(\(item\) => String\(item\.caseType/);
  assert.match(profileSummary, /<StudyIntakeBadge value=\{caseItem\.studyIntakeMonth\}/);
  assert.match(conversionSheet, /studyIntakeMonth/);
  assert.match(conversionSheet, /<StudyIntakeSelect/);
});
