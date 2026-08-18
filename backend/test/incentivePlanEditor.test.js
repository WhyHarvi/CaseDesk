import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the incentive plan editor starts complete and explains the calculation", async () => {
  const panel = await readFile(new URL("../../frontend/src/components/settings/IncentivePlansSettingsPanel.jsx", import.meta.url), "utf8");

  assert.match(panel, /sharePercent: "100"/);
  assert.match(panel, /minCumulativeAmount: "0"/);
  assert.match(panel, /Name and scope/);
  assert.match(panel, /Calculate the incentive pool/);
  assert.match(panel, /Split the pool/);
  assert.match(panel, /Example when \{money\.format\(collected\)\} is collected/);
  assert.match(panel, /Split the incentive pool, not the client payment/);
  assert.match(panel, /A case-role share is credited only when someone holds that role on the case/);
});
