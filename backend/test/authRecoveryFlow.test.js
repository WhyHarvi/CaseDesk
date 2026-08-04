import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  establishAuthLinkSession,
  linkErrorMessage,
  readLinkParameters,
} from "../../frontend/src/services/authLinkSession.js";

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

test("both portal onboarding/reset and public forgot-password pages use the shared recovery handoff", async () => {
  const [acceptInvite, resetPassword, portalController] = await Promise.all([
    readFile(new URL("../../frontend/src/pages/AcceptInvite.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/ResetPassword.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/portalController.js", import.meta.url), "utf8"),
  ]);
  assert.match(acceptInvite, /await establishAuthLinkSession\(\)/);
  assert.match(resetPassword, /establishAuthLinkSession\(\)/);
  assert.match(resetPassword, /Request a new reset link/);
  assert.match(portalController, /type: kind/);
  assert.match(portalController, /auth\/accept-invite/);
});

