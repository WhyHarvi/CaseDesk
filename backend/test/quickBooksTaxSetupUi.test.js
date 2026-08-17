import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("an empty QuickBooks tax-code list explains the real setup gap and can recover in place", async () => {
  const [service, controller, api, ui] = await Promise.all([
    readFile(new URL("src/services/quickbooksService.js", root), "utf8"),
    readFile(new URL("src/controllers/quickbooksController.js", root), "utf8"),
    readFile(new URL("../frontend/src/api/quickbooksApi.js", root), "utf8"),
    readFile(new URL("../frontend/src/components/settings/QuickBooksMappingCard.jsx", root), "utf8"),
  ]);

  assert.match(service, /getQuickBooksSalesTaxStatus/);
  assert.match(service, /TaxPrefs\?\.UsingSalesTax/);
  assert.match(controller, /meta: taxStatus/);
  assert.match(api, /usingSalesTax: response\.data\.meta\?\.usingSalesTax/);
  assert.match(ui, /Sales tax is turned off in the connected QuickBooks company/);
  assert.match(ui, /All apps → Sales Tax → Overview/);
  assert.match(ui, /Check again/);
  assert.match(ui, /disabled=\{saving \|\| checking \|\| !taxCodes\.length\}/);
});
