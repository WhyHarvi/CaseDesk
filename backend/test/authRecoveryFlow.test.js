import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  establishAuthLinkSession,
  linkErrorMessage,
  readLinkParameters,
} from "../../frontend/src/services/authLinkSession.js";
import { normalizeSupabaseAuthCallback } from "../../frontend/src/services/supabase.js";
import { accountAccessEmailContent } from "../src/services/accountAccessMailService.js";
import {
  DEFAULT_PUBLIC_APP_URL,
  normalizeAuthActionLink,
  publicAppUrl,
} from "../src/utils/publicAppUrl.js";

function browserLocation(suffix) {
  const url = new URL(suffix, "https://app.example.com");
  return { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash };
}

function browserHistory() {
  return {
    state: null,
    replacement: "",
    replaceState(_state, _title, value) { this.replacement = value; },
  };
}

test("production onboarding links never use a localhost application origin", () => {
  assert.equal(
    publicAppUrl({ NODE_ENV: "production", PUBLIC_APP_URL: "http://localhost:5173" }),
    DEFAULT_PUBLIC_APP_URL,
  );
  assert.equal(
    publicAppUrl({ NODE_ENV: "production", FRONTEND_URL: "http://127.0.0.1:5173" }),
    DEFAULT_PUBLIC_APP_URL,
  );
  assert.equal(
    publicAppUrl({ NODE_ENV: "production", PUBLIC_APP_URL: "https://workspace.example.com/app/" }),
    "https://workspace.example.com",
  );
});

test("Supabase onboarding action links are forced back to the canonical application route", () => {
  const normalized = normalizeAuthActionLink(
    "https://auth.example.com/auth/v1/verify?token=secret&type=invite&redirect_to=http%3A%2F%2Flocalhost%3A5173",
    "https://casedesk.chkimmigration.ca/auth/accept-invite",
  );
  const parsed = new URL(normalized);
  assert.equal(parsed.searchParams.get("token"), "secret");
  assert.equal(parsed.searchParams.get("redirect_to"), "https://casedesk.chkimmigration.ca/auth/accept-invite");
});

test("recovery links parse Supabase errors into a useful expired-link message", () => {
  const parameters = readLinkParameters(browserLocation("/auth/reset-password#error=access_denied&error_code=otp_expired"));
  assert.equal(parameters.errorCode, "otp_expired");
  assert.match(linkErrorMessage(parameters), /already been used or has expired/i);
});

test("hash-token recovery links explicitly establish the emailed user's session", async () => {
  const location = browserLocation("/auth/reset-password#access_token=access-1&refresh_token=refresh-1&type=recovery");
  const history = browserHistory();
  let received;
  const client = {
    auth: {
      async setSession(tokens) {
        received = tokens;
        return { data: { session: { user: { id: "client-user" } } }, error: null };
      },
    },
  };

  const session = await establishAuthLinkSession({ client, location, history });
  assert.deepEqual(received, { access_token: "access-1", refresh_token: "refresh-1" });
  assert.equal(session.user.id, "client-user");
  assert.equal(history.replacement, "/auth/reset-password");
});

test("PKCE recovery links exchange the code before showing the password form", async () => {
  const location = browserLocation("/auth/reset-password?code=recovery-code");
  const history = browserHistory();
  const client = {
    auth: {
      async exchangeCodeForSession(code) {
        assert.equal(code, "recovery-code");
        return { data: { session: { user: { id: "client-user" } } }, error: null };
      },
    },
  };

  const session = await establishAuthLinkSession({ client, location, history });
  assert.equal(session.user.id, "client-user");
  assert.equal(history.replacement, "/auth/reset-password");
});

test("opening the reset route without an emailed link never reuses another signed-in account", async () => {
  let authCalled = false;
  const client = { auth: { async getSession() { authCalled = true; return { data: { session: { user: { id: "staff-user" } } } }; } } };
  await assert.rejects(
    establishAuthLinkSession({ client, location: browserLocation("/auth/reset-password"), history: browserHistory(), timeoutMs: 1 }),
    /Open the newest secure link/i,
  );
  assert.equal(authCalled, false);
});

test("Supabase Site URL fallbacks are handed to the portal onboarding route", () => {
  const location = browserLocation("/#access_token=access-1&refresh_token=refresh-1&type=recovery");
  const history = browserHistory();

  assert.equal(normalizeSupabaseAuthCallback({ location, history }), true);
  assert.equal(
    history.replacement,
    "/auth/accept-invite#access_token=access-1&refresh_token=refresh-1&type=recovery",
  );
  assert.equal(
    normalizeSupabaseAuthCallback({ location: browserLocation("/"), history: browserHistory() }),
    false,
  );
});

test("account recovery mail carries the workspace brand and system contact details", () => {
  const content = accountAccessEmailContent({
    agency: { name: "CHK Immigration", phone: "+1 647 555 0110" },
    fullName: "Client Name",
    actionLink: "https://app.example.com/recovery-link",
    kind: "reset",
    audience: "client",
    supportEmail: "hello@chkimmigration.ca",
    brandImageUrl: "cid:workspace-avatar@casedesk",
  });

  assert.match(content.subject, /CHK Immigration/);
  assert.match(content.html, /cid:workspace-avatar@casedesk/);
  assert.match(content.html, /tel:\+16475550110/);
  assert.match(content.html, /hello@chkimmigration\.ca/);
  assert.match(content.text, /\+1 647 555 0110 · hello@chkimmigration\.ca/);
});

test("both portal onboarding/reset and public forgot-password pages use the shared recovery handoff", async () => {
  const [acceptInvite, resetPassword, portalController, supabaseService, portalAccessCard, login, authController, authRoutes] = await Promise.all([
    readFile(new URL("../../frontend/src/pages/AcceptInvite.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/ResetPassword.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/portalController.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/services/supabase.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/components/clients/PortalAccessCard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/Login.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/authController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/authRoutes.js", import.meta.url), "utf8"),
  ]);
  assert.match(acceptInvite, /await establishAuthLinkSession\(\)/);
  assert.match(resetPassword, /establishAuthLinkSession\(\)/);
  assert.match(resetPassword, /Request a new reset link/);
  assert.match(portalController, /type: kind/);
  assert.match(portalController, /auth\/accept-invite/);
  assert.match(portalController, /const isOnboarding =/);
  assert.match(supabaseService, /detectSessionInUrl: false/);
  assert.match(portalAccessCard, /Copy sign-in page/);
  assert.doesNotMatch(portalAccessCard, /Copy portal link/);
  assert.match(login, /api\.post\("\/auth\/forgot-password"/);
  assert.doesNotMatch(login, /resetPasswordForEmail/);
  assert.match(authController, /type: "recovery"/);
  assert.match(authController, /sendAccountAccessEmail/);
  assert.match(authController, /PASSWORD_RECOVERY_RESPONSE/);
  assert.match(authRoutes, /"\/forgot-password"/);
  assert.match(authRoutes, /identity: \(req\) => `email:/);
});
