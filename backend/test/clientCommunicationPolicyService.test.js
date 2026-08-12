import assert from "node:assert/strict";
import test from "node:test";
import {
  assertClientCommunicationAllowed,
  getAgencyClientCommunicationPolicy,
  getEffectiveClientCommunicationPreference,
} from "../src/services/clientCommunicationPolicyService.js";

function fakeDb({ policy = null, preference = null, agencyTimezone = "America/Toronto" } = {}) {
  return {
    agencyClientCommunicationPolicy: {
      findUnique: async () => policy,
    },
    agency: {
      findUnique: async () => ({ timezone: agencyTimezone }),
    },
    communicationPreference: {
      findUnique: async () => preference,
    },
  };
}

test("the agency client policy defaults to the workspace timezone", async () => {
  const policy = await getAgencyClientCommunicationPolicy(
    "agency-1",
    fakeDb({ agencyTimezone: "America/Vancouver" }),
  );
  assert.equal(policy.timezone, "America/Vancouver");
  assert.equal(policy.communicationEnabled, true);
  assert.equal(policy.allowEmail, true);
});

test("a global channel restriction applies even when a client allows that channel", async () => {
  const preference = await getEffectiveClientCommunicationPreference({
    agencyId: "agency-1",
    clientId: "client-1",
    db: fakeDb({
      policy: {
        agencyId: "agency-1",
        communicationEnabled: true,
        allowEmail: false,
        allowSms: true,
        allowChat: true,
        allowCalls: true,
        preferredChannel: "Email",
        language: "English",
        timezone: "America/Toronto",
        quietHoursStart: null,
        quietHoursEnd: null,
      },
      preference: {
        agencyId: "agency-1",
        clientId: "client-1",
        allowEmail: true,
        allowSms: true,
        allowChat: true,
        allowCalls: true,
        preferredChannel: "Email",
        language: "Punjabi",
        timezone: "America/Toronto",
        quietHoursStart: null,
        quietHoursEnd: null,
        doNotContact: false,
      },
    }),
  });
  assert.equal(preference.allowEmail, false);
  assert.equal(preference.preferredChannel, null);
  assert.equal(preference.language, "Punjabi");
  assert.equal(preference.hasClientOverride, true);
});

test("a client opt-out remains blocked under an enabled global policy", async () => {
  const preference = await getEffectiveClientCommunicationPreference({
    agencyId: "agency-1",
    clientId: "client-1",
    db: fakeDb({
      policy: {
        agencyId: "agency-1",
        communicationEnabled: true,
        allowEmail: true,
        allowSms: true,
        allowChat: true,
        allowCalls: true,
        language: "English",
        timezone: "America/Toronto",
      },
      preference: {
        agencyId: "agency-1",
        clientId: "client-1",
        allowEmail: false,
        allowSms: true,
        allowChat: true,
        allowCalls: true,
        doNotContact: true,
      },
    }),
  });
  assert.equal(preference.allowEmail, false);
  assert.equal(preference.doNotContact, true);
});

test("the global master control disables every client communication channel", async () => {
  const preference = await getEffectiveClientCommunicationPreference({
    agencyId: "agency-1",
    clientId: "client-1",
    db: fakeDb({
      policy: {
        agencyId: "agency-1",
        communicationEnabled: false,
        allowEmail: true,
        allowSms: true,
        allowChat: true,
        allowCalls: true,
        language: "English",
        timezone: "America/Toronto",
      },
    }),
  });
  assert.deepEqual(
    [
      preference.allowEmail,
      preference.allowSms,
      preference.allowChat,
      preference.allowCalls,
    ],
    [false, false, false, false],
  );
});

test("the shared enforcement helper blocks a globally disabled channel", async () => {
  const result = await assertClientCommunicationAllowed({
    agencyId: "agency-1",
    clientId: "client-1",
    channel: "Sms",
    db: fakeDb({
      policy: {
        agencyId: "agency-1",
        communicationEnabled: true,
        allowEmail: true,
        allowSms: false,
        allowChat: true,
        allowCalls: true,
        language: "English",
        timezone: "America/Toronto",
      },
    }),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.preference.allowSms, false);
});
