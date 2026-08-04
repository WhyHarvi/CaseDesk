import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  defaultPortalAccess,
  hasPortalCapability,
  hasPortalPageAccess,
  normalizePortalAccess,
  portalDataScope,
  requirePortalPage,
} from "../src/services/portalAccessService.js";
import {
  caseAccessWhere,
  clientAccessWhere,
} from "../src/middleware/authorization.js";
import { leadAccessWhere } from "../src/modules/leads/lead.permissions.js";

const source = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("role defaults preserve current consultant and front-desk workspace access", () => {
  const consultant = defaultPortalAccess("consultant");
  const frontdesk = defaultPortalAccess("frontdesk");
  assert.equal(consultant.pages.cases, true);
  assert.equal(consultant.data.clients, "assigned");
  assert.equal(consultant.capabilities.internalNotes, true);
  assert.equal(frontdesk.pages.leads, true);
  assert.equal(frontdesk.pages.clients, false);
  assert.equal(frontdesk.data.leads, "all");
  assert.equal(frontdesk.capabilities.financialData, false);
});

test("saved portal access overrides role defaults without accepting unknown values", () => {
  const access = normalizePortalAccess("frontdesk", {
    pages: { clients: true, madeUp: true },
    caseTabs: { profile: true },
    data: { clients: "assigned", cases: "everything" },
    capabilities: { internalNotes: true },
  });
  assert.equal(access.pages.clients, true);
  assert.equal(access.pages.madeUp, undefined);
  assert.equal(access.caseTabs.profile, true);
  assert.equal(access.data.clients, "assigned");
  assert.equal(access.data.cases, "none");
  assert.equal(access.capabilities.internalNotes, true);
});

test("page middleware and data scopes enforce the membership policy", () => {
  const req = {
    auth: {
      role: "frontdesk",
      userId: "staff-1",
      permissions: {
        portalAccess: normalizePortalAccess("frontdesk", {
          pages: { clients: true },
          data: { clients: "assigned", cases: "assigned" },
        }),
      },
    },
  };
  assert.equal(hasPortalPageAccess(req, "clients"), true);
  assert.equal(hasPortalCapability(req, "financialData"), false);
  assert.equal(portalDataScope(req, "clients"), "assigned");
  assert.deepEqual(clientAccessWhere(req).OR[0], { assignedUserId: "staff-1" });
  assert.ok(Array.isArray(caseAccessWhere(req).OR));
  assert.deepEqual(leadAccessWhere(req), {});

  let nextCalled = false;
  requirePortalPage("clients")(req, {}, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  let status;
  requirePortalPage("payments")(
    req,
    {
      status(value) {
        status = value;
        return this;
      },
      json(value) {
        return value;
      },
    },
    () => {},
  );
  assert.equal(status, 403);
});

test("Portal Access is admin-only and wired to both UI and server routes", async () => {
  const [adminRoutes, settings, panel, appRoutes, sidebar, server] =
    await Promise.all([
      source("../src/routes/adminRoutes.js"),
      source("../../frontend/src/pages/Settings.jsx"),
      source(
        "../../frontend/src/components/settings/PortalAccessSettingsPanel.jsx",
      ),
      source("../../frontend/src/routes/AppRoutes.jsx"),
      source("../../frontend/src/components/layout/Sidebar.jsx"),
      source("../src/server.js"),
    ]);
  assert.match(adminRoutes, /router\.use\(requireRole\("admin"\)\)/);
  assert.match(adminRoutes, /"\/portal-access"/);
  assert.match(adminRoutes, /"\/team-members\/:id\/portal-access"/);
  assert.match(settings, /id: "portal-access"/);
  assert.match(settings, /isAdmin && activeSection === "portal-access"/);
  assert.match(panel, /Workspace pages/);
  assert.match(panel, /Case workspace tabs/);
  assert.match(panel, /Which records they can see/);
  assert.match(appRoutes, /PortalAccessRoute page=\{page\}/);
  assert.match(sidebar, /access\.pages\[item\.accessKey\]/);
  assert.match(server, /requirePortalPage\("clients"\)/);
  assert.match(server, /requirePortalCapability\("financialData"\)/);
});
