import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("the Cases page KPI cards are clickable and filter the list to exactly what they're showing, reusing the same predicates the counts themselves are computed from", async () => {
  const page = await source("../../frontend/src/pages/Cases.jsx");

  // StatCard is a real button with an active/pressed state, not a static
  // <article> — keyboard/click accessible, visually indicates which filter
  // (if any) is currently applied.
  const statCard = page.slice(page.indexOf("function StatCard("), page.indexOf("function KpiSkeleton()"));
  assert.match(statCard, /function StatCard\(\{ icon: Icon, label, value, helper, accent, active, onClick \}\)/);
  assert.match(statCard, /<button\s*\n\s*type="button"\s*\n\s*onClick=\{onClick\}\s*\n\s*aria-pressed=\{active\}/);

  // The quick-filter state and its predicate reuse isActiveCase/
  // isReadyForSubmission/urgent — the exact same functions the KPI counts
  // themselves are derived from, so the list shown can never drift from
  // the number on the card.
  assert.match(page, /const \[quickFilter, setQuickFilter\] = useState\("all"\);/);
  assert.match(
    page,
    /const matchesQuickFilter =\s*\n\s*quickFilter === "all" \|\|\s*\n\s*\(quickFilter === "active" && isActiveCase\(caseItem\)\) \|\|\s*\n\s*\(quickFilter === "readyForSubmission" && isReadyForSubmission\(caseItem\)\) \|\|\s*\n\s*\(quickFilter === "needsAttention" && caseItem\.urgent\);/,
  );
  assert.match(page, /matchesIntake &&\s*\n\s*matchesQuickFilter/);
  assert.match(page, /\}, \[enrichedCases, filters, searchQuery, quickFilter\]\);/);

  // Each card toggles its own quick filter on/off (clicking twice clears
  // back to "all") except Total Cases, which always just clears to "all".
  assert.match(page, /active=\{quickFilter === "all"\}\s*\n\s*onClick=\{\(\) => setQuickFilter\("all"\)\}/);
  assert.match(
    page,
    /active=\{quickFilter === "active"\}\s*\n\s*onClick=\{\(\) => setQuickFilter\(\(current\) => \(current === "active" \? "all" : "active"\)\)\}/,
  );
  assert.match(
    page,
    /active=\{quickFilter === "readyForSubmission"\}\s*\n\s*onClick=\{\(\) => setQuickFilter\(\(current\) => \(current === "readyForSubmission" \? "all" : "readyForSubmission"\)\)\}/,
  );
  assert.match(
    page,
    /active=\{quickFilter === "needsAttention"\}\s*\n\s*onClick=\{\(\) => setQuickFilter\(\(current\) => \(current === "needsAttention" \? "all" : "needsAttention"\)\)\}/,
  );
});
