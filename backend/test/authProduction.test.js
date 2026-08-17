import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { errorHandler } from "../src/middleware/errorHandler.js";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("public agency registration is rate limited and never accepts a password", async () => {
  const [routes, controller] = await Promise.all([
    source("../src/routes/onboardingRoutes.js"),
    source("../src/controllers/onboardingController.js"),
  ]);
  assert.match(routes, /register-agency[\s\S]*rateLimit/);
  assert.match(controller, /acceptTerms/);
  assert.match(controller, /inviteAuthUser/);
  const registrationSection = controller.slice(controller.indexOf("export async function registerAgency"), controller.indexOf("export async function getOnboardingStatus"));
  assert.doesNotMatch(registrationSection, /password|createAuthUser/);
});

test("invited identities cannot enter the application before setup", async () => {
  const middleware = await source("../src/middleware/authMiddleware.js");
  assert.match(middleware, /appUser\.status === "invited"/);
  assert.match(middleware, /ACCOUNT_SETUP_REQUIRED/);
  assert.match(middleware, /agency\.onboardingStatus !== "active"/);
  assert.match(middleware, /agency\.accessStatus === "blocked"/);
});

test("agency onboarding activation updates identity and tenant state atomically", async () => {
  const controller = await source("../src/controllers/onboardingController.js");
  assert.match(controller, /updateAuthenticatedUser\(req\.accessToken/);
  assert.match(controller, /prisma\.\$transaction/);
  assert.match(controller, /onboardingStatus: "active"/);
  assert.match(controller, /status: "completed"/);
});

test("consultants use secure invitations instead of temporary passwords", async () => {
  const controller = await source("../src/controllers/adminConsultantController.js");
  assert.match(controller, /generateAuthLink/);
  assert.match(controller, /status: "invited"/);
  const createSection = controller.slice(controller.indexOf("export async function createConsultant"), controller.indexOf("export async function listConsultants"));
  assert.doesNotMatch(createSection, /temporaryPassword|createAuthUser/);
  assert.doesNotMatch(controller, /temporaryPassword/);
  assert.match(controller, /sendAccountAccessEmail/);
  assert.match(controller, /INVITATION_RATE_LIMITED/);
  assert.match(controller, /INVITATION_REDIRECT_NOT_CONFIGURED/);
  assert.match(controller, /generateAuthLink/);
  assert.match(controller, /manualInvitationLink/);
});

test("safe operational auth errors are not replaced with a generic 500 message", async () => {
  const [http, handler] = await Promise.all([
    source("../src/utils/http.js"),
    source("../src/middleware/errorHandler.js"),
  ]);
  assert.match(http, /error\.expose = true/);
  assert.match(handler, /err\.expose !== true/);
});

test("internal Prisma errors never expose query details to the UI", () => {
  let statusCode;
  let payload;
  errorHandler(
    {
      name: "PrismaClientValidationError",
      code: "P2022",
      message: "Invalid prisma.client.findMany invocation with secret schema details",
    },
    { requestId: "request-1" },
    {
      status(value) {
        statusCode = value;
        return this;
      },
      json(value) {
        payload = value;
        return value;
      },
    },
    () => {},
  );

  assert.equal(statusCode, 500);
  assert.equal(payload.message, "An unexpected error occurred.");
  assert.equal(payload.code, "INTERNAL_ERROR");
  assert.doesNotMatch(JSON.stringify(payload), /prisma|findMany|P2022/i);
});

test("client portal members use the same secure invitation activation", async () => {
  const controller = await source("../src/controllers/portalController.js");
  const createSection = controller.slice(controller.indexOf("export async function createPortalAccount"), controller.indexOf("export async function sendPortalAccessLink"));
  assert.match(createSection, /generateAuthLink/);
  assert.match(createSection, /sendAccountAccessEmail/);
  assert.match(createSection, /status: "invited"/);
  assert.doesNotMatch(createSection, /temporaryPassword|createAuthUser/);
});

// A deliberate, explicitly-chosen second option — not a regression of the
// guard above. Direct access matters for clients who won't complete an
// email-link accept-invite flow; the trade-off (a real password sitting in
// an inbox, versus a single-use link) is accepted knowingly here, scoped to
// its own function, gated the same way as every other portal-access action.
test("issuing a temporary portal password is a distinct, explicitly-gated action, not the default onboarding path", async () => {
  const [controller, routes] = await Promise.all([
    source("../src/controllers/portalController.js"),
    source("../src/routes/clientRoutes.js"),
  ]);
  const section = controller.slice(controller.indexOf("export async function sendPortalTemporaryPassword"), controller.indexOf("export async function getPortalAccountStatus"));
  assert.match(section, /requirePortalCapability|hasPortalCapability\(req, "manageClientPortal"\)/);
  assert.match(section, /generateTemporaryPassword\(\)/);
  assert.match(section, /createAuthUser\(\{ email, password, fullName, mustChangePassword: false \}\)/);
  assert.match(section, /updateAuthUser\(existingAuthUserId, \{ password \}\)/);
  assert.match(section, /status: "active"/);
  assert.match(section, /kind: "temporaryPassword"/);
  assert.match(routes, /"\/:clientId\/portal-account\/temporary-password"/);
  assert.match(routes, /requirePortalCapability\("manageClientPortal"\)/);
});

test("onboarding PII is protected from direct Supabase access", async () => {
  const migration = await source("../prisma/migrations/20260715120000_add_agency_onboarding/migration.sql");
  assert.match(migration, /ALTER TABLE "onboarding_requests" ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]*onboarding_requests/);
  assert.match(migration, /"agency_id" TEXT/);
  assert.match(migration, /"auth_user_id" UUID/);
});
