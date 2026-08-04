import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  caseAccessWhere,
  clientAccessWhere,
  requireRole,
} from "../src/middleware/authorization.js";

const auth = (role, userId = "user-a", agencyId = "agency-a") => ({
  auth: { role, userId, agencyId },
});

test("admin can access clients in their agency while every query remains agency scoped", () => {
  assert.deepEqual(clientAccessWhere(auth("admin")), {});
  assert.equal(auth("admin").auth.agencyId, "agency-a");
});

test("admin cannot access another agency because identity scope is membership-derived", async () => {
  const source = await readFile(
    new URL("../src/middleware/authMiddleware.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /membership\.agencyId/);
  assert.doesNotMatch(source, /x-agency-id|req\.body\.agencyId/);
});

test("consultant client scope includes directly assigned clients and assigned cases", () => {
  const where = JSON.stringify(
    clientAccessWhere(auth("consultant", "consultant-1")),
  );
  assert.match(where, /assignedUserId/);
  assert.match(where, /assignments/);
  assert.match(where, /consultant-1/);
});

test("consultant cannot access an unassigned client because scope contains only their user id", () => {
  const where = JSON.stringify(
    clientAccessWhere(auth("consultant", "consultant-1")),
  );
  assert.doesNotMatch(where, /consultant-2/);
});

test("client can access their own application through their portal link", () => {
  const where = JSON.stringify(
    caseAccessWhere(auth("client", "client-user-1")),
  );
  assert.match(where, /portalUsers/);
  assert.match(where, /client-user-1/);
});

test("client cannot access another client because no foreign portal user is in scope", () => {
  const where = JSON.stringify(
    clientAccessWhere(auth("client", "client-user-1")),
  );
  assert.doesNotMatch(where, /client-user-2/);
});

test("client cannot access internal CRM role middleware", () => {
  let status;
  const res = {
    status(value) {
      status = value;
      return this;
    },
    json() {},
  };
  requireRole("admin", "consultant")(auth("client"), res, () =>
    assert.fail("client was admitted"),
  );
  assert.equal(status, 403);
});

test("inactive membership is rejected by authentication middleware", async () => {
  const source = await readFile(
    new URL("../src/middleware/authMiddleware.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /where: \{ isActive: true \}/);
  assert.match(source, /ACCOUNT_INACTIVE/);
});

test("frontend-provided agency_id is ignored", async () => {
  const source = await readFile(
    new URL("../src/utils/prismaCrud.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /agencyId: req\.user\.agencyId/);
  assert.doesNotMatch(source, /body\.agencyId/);
});

test("consultant cannot create another admin", () => {
  let status;
  const res = {
    status(value) {
      status = value;
      return this;
    },
    json() {},
  };
  requireRole("admin")(auth("consultant"), res, () =>
    assert.fail("consultant was admitted"),
  );
  assert.equal(status, 403);
});

test("follow-ups use the internal staff picker without opening the admin user directory", async () => {
  const source = await readFile(
    new URL("../../frontend/src/pages/FollowUps.jsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /api\.get\("\/leads\/staff"\)/);
  assert.doesNotMatch(source, /api\.get\("\/users"\)/);
});

test("consultants have personal settings without receiving admin settings controls", async () => {
  const [routes, sidebar, settings] = await Promise.all([
    readFile(
      new URL("../../frontend/src/routes/AppRoutes.jsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../../frontend/src/components/layout/Sidebar.jsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../../frontend/src/pages/Settings.jsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(
    routes,
    /path="\/app\/settings"[\s\S]*<Internal allowFrontdesk>/,
  );
  assert.match(sidebar, /memberNavigation[\s\S]*label: "Settings"/);
  assert.match(settings, /const consultantSettingsItems/);
  assert.match(
    settings,
    /isAdmin \? adminSettingsItems : consultantSettingsItems/,
  );
});

test("consultant self-service profile updates remain user-owned and validate avatar files", async () => {
  const [routes, controller, upload, migration, authMiddleware] =
    await Promise.all([
      readFile(
        new URL("../src/routes/consultantRoutes.js", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/controllers/consultantProfileController.js",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../src/middleware/profileAvatarUpload.js", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../prisma/migrations/20260715150000_add_user_avatar/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../src/middleware/authMiddleware.js", import.meta.url),
        "utf8",
      ),
    ]);
  assert.match(routes, /router\.patch\("\/me\/profile"/);
  assert.match(routes, /router\.use\(requireRole\("consultant"\)\)/);
  assert.match(
    controller,
    /id: req\.auth\.userId, agencyId: req\.auth\.agencyId/,
  );
  assert.match(controller, /detectedImage\(req\.file\.buffer\)/);
  assert.match(upload, /fileSize: 5 \* 1024 \* 1024/);
  assert.match(migration, /avatar_storage_key/);
  assert.match(controller, /PROFILE_MIGRATION_REQUIRED/);
  assert.doesNotMatch(authMiddleware, /avatarStorageKey/);
});

test("RLS blocks cross-agency reads and updates", async () => {
  const sql = await readFile(
    new URL(
      "../prisma/migrations/20260714121000_add_auth_authorization_foundation/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /clients_read[\s\S]*agency_id" = current_agency_id\(\)/);
  assert.match(
    sql,
    /clients_update_staff[\s\S]*WITH CHECK \("agency_id" = current_agency_id\(\)\)/,
  );
  assert.match(sql, /cases_read[\s\S]*agency_id" = current_agency_id\(\)/);
});
