import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { generateTemporaryPassword } from "../src/utils/temporaryPassword.js";
import { accountAccessEmailContent } from "../src/services/accountAccessMailService.js";

test("generateTemporaryPassword produces a 10-character password with every character class and no visually ambiguous characters", () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const password = generateTemporaryPassword();
    assert.equal(password.length, 10);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[a-z]/);
    assert.match(password, /[0-9]/);
    assert.doesNotMatch(password, /[0O1Il]/);
  }
});

test("generateTemporaryPassword does not repeat", () => {
  const passwords = new Set(Array.from({ length: 200 }, () => generateTemporaryPassword()));
  assert.equal(passwords.size, 200);
});

test("a temporary-password email shows the password and a plain sign-in link, not a one-time action link", () => {
  const content = accountAccessEmailContent({
    agency: { name: "CHK Immigration" },
    fullName: "Kamaldeep Singh",
    password: "Xy7kPq3mTz",
    loginUrl: "https://app.casedesk.example/login",
    kind: "temporaryPassword",
    audience: "client",
  });

  assert.match(content.subject, /Your CHK Immigration client portal access/);
  assert.match(content.html, /Temporary password/);
  assert.match(content.html, /Xy7kPq3mTz/);
  assert.match(content.html, /https:\/\/app\.casedesk\.example\/login/);
  assert.match(content.html, /Sign in/);
  assert.doesNotMatch(content.html, /use this link only once/);
  assert.match(content.text, /Temporary password: Xy7kPq3mTz/);
  assert.match(content.text, /https:\/\/app\.casedesk\.example\/login/);
});

test("client onboarding email explains the seven-day link lifetime", () => {
  const content = accountAccessEmailContent({
    agency: { name: "CHK Immigration" },
    fullName: "Kamaldeep Singh",
    actionLink: "https://app.casedesk.example/auth/accept-invite?token=abc",
    kind: "onboarding",
    audience: "client",
    linkValidityDays: 7,
  });

  assert.match(content.html, /Set up my account/);
  assert.match(content.html, /used only once/);
  assert.doesNotMatch(content.html, /Temporary password/);
  assert.match(content.text, /https:\/\/app\.casedesk\.example\/auth\/accept-invite\?token=abc/);
  assert.match(content.text, /valid for seven days/i);
});

test("Supabase-backed staff invitations do not claim the client seven-day lifetime", () => {
  const content = accountAccessEmailContent({
    agency: { name: "CHK Immigration" },
    fullName: "Staff Member",
    actionLink: "https://auth.example.com/verify?token=abc",
    kind: "onboarding",
    audience: "staff",
  });

  assert.match(content.text, /use this link only once/i);
  assert.doesNotMatch(content.text, /seven days/i);
});

test("resetting an existing portal password also activates its Supabase identity", async () => {
  const controller = await readFile(new URL("../src/controllers/portalController.js", import.meta.url), "utf8");
  const temporaryPasswordSection = controller.slice(
    controller.indexOf("export async function sendPortalTemporaryPassword"),
    controller.indexOf("export async function getPortalAccountStatus"),
  );

  assert.match(temporaryPasswordSection, /updateAuthUser\(existingAuthUserId,[\s\S]*?password/);
  assert.match(temporaryPasswordSection, /email_confirm:\s*true/);
  assert.match(temporaryPasswordSection, /ban_duration:\s*"none"/);
});
