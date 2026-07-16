import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(controller, /inviteAuthUser/);
  assert.match(controller, /status: "invited"/);
  const createSection = controller.slice(controller.indexOf("export async function createConsultant"), controller.indexOf("export async function listConsultants"));
  assert.doesNotMatch(createSection, /temporaryPassword|createAuthUser/);
  assert.doesNotMatch(controller, /temporaryPassword/);
  assert.match(controller, /sendPasswordRecovery/);
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

test("client portal members use the same secure invitation activation", async () => {
  const controller = await source("../src/controllers/portalController.js");
  const createSection = controller.slice(controller.indexOf("export async function createPortalAccount"), controller.indexOf("export async function portalMe"));
  assert.match(createSection, /inviteAuthUser/);
  assert.match(createSection, /status: "invited"/);
  assert.doesNotMatch(createSection, /temporaryPassword|createAuthUser/);
});

test("onboarding PII is protected from direct Supabase access", async () => {
  const migration = await source("../prisma/migrations/20260715120000_add_agency_onboarding/migration.sql");
  assert.match(migration, /ALTER TABLE "onboarding_requests" ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]*onboarding_requests/);
  assert.match(migration, /"agency_id" TEXT/);
  assert.match(migration, /"auth_user_id" UUID/);
});
