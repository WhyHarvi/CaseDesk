import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const controller = readFileSync(
  new URL("../src/controllers/accountSettingsController.js", import.meta.url),
  "utf8",
);
const routes = readFileSync(
  new URL("../src/routes/accountSettingsRoutes.js", import.meta.url),
  "utf8",
);
const server = readFileSync(
  new URL("../src/server.js", import.meta.url),
  "utf8",
);
const settings = readFileSync(
  new URL("../../frontend/src/pages/Settings.jsx", import.meta.url),
  "utf8",
);
const portalRoutes = readFileSync(
  new URL("../../frontend/src/routes/AppRoutes.jsx", import.meta.url),
  "utf8",
);

test("account security and activity APIs are authenticated for every supported role", () => {
  assert.match(
    server,
    /app\.use\("\/api\/account", requireAuth, accountSettingsRoutes\)/,
  );
  assert.match(routes, /router\.get\("\/security"/);
  assert.match(routes, /router\.get\("\/activity"/);
  assert.doesNotMatch(routes, /requireRole/);
});

test("workspace activity is available only to administrators", () => {
  assert.match(
    controller,
    /req\.auth\.role === "admin" && requestedScope === "workspace"/,
  );
  assert.match(
    controller,
    /scope === "mine" \? \[\{ userId: req\.auth\.userId \}\]/,
  );
  assert.match(controller, /canViewWorkspace: req\.auth\.role === "admin"/);
});

test("staff and client settings expose security and activity without placeholders", () => {
  assert.match(settings, /<SecuritySettingsPanel \/>/);
  assert.match(settings, /<ActivityLogsSettingsPanel \/>/);
  assert.match(
    settings,
    /const consultantSettingsItems[\s\S]*id: "activity-logs"/,
  );
  assert.match(
    portalRoutes,
    /path="settings"[\s\S]*ClientPortalAccountSettings/,
  );
});
