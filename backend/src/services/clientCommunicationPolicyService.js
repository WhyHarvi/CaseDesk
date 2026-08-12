import prisma from "./prisma/client.js";

export const defaultClientCommunicationPolicy = Object.freeze({
  communicationEnabled: true,
  preferredChannel: null,
  language: "English",
  timezone: "America/Toronto",
  quietHoursStart: null,
  quietHoursEnd: null,
  allowEmail: true,
  allowSms: true,
  allowChat: true,
  allowCalls: true,
});

export async function getAgencyClientCommunicationPolicy(agencyId, db = prisma) {
  const [policy, agency] = await Promise.all([
    db.agencyClientCommunicationPolicy.findUnique({ where: { agencyId } }),
    db.agency.findUnique({
      where: { id: agencyId },
      select: { timezone: true },
    }),
  ]);
  return {
    ...defaultClientCommunicationPolicy,
    timezone: agency?.timezone || defaultClientCommunicationPolicy.timezone,
    ...(policy || {}),
  };
}

export async function getEffectiveClientCommunicationPreference({
  agencyId,
  clientId,
  db = prisma,
}) {
  const [policy, preference] = await Promise.all([
    getAgencyClientCommunicationPolicy(agencyId, db),
    db.communicationPreference.findUnique({ where: { clientId } }),
  ]);
  const clientPreference = preference?.agencyId === agencyId ? preference : null;
  const enabled = policy.communicationEnabled !== false;
  const allowed = (policyValue, clientValue) =>
    enabled && policyValue !== false && clientValue !== false;
  const allowEmail = allowed(policy.allowEmail, clientPreference?.allowEmail);
  const allowSms = allowed(policy.allowSms, clientPreference?.allowSms);
  const allowChat = allowed(policy.allowChat, clientPreference?.allowChat);
  const allowCalls = allowed(policy.allowCalls, clientPreference?.allowCalls);
  const permittedChannels = {
    Email: allowEmail,
    Sms: allowSms,
    Chat: allowChat,
    Call: allowCalls,
  };
  const clientPreferredChannel = clientPreference?.preferredChannel || null;
  const policyPreferredChannel = policy.preferredChannel || null;
  const configuredPreference = {
    clientId,
    preferredChannel:
      clientPreference?.preferredChannel ?? policy.preferredChannel,
    language: clientPreference?.language || policy.language,
    timezone: clientPreference?.timezone || policy.timezone,
    quietHoursStart:
      clientPreference?.quietHoursStart ?? policy.quietHoursStart,
    quietHoursEnd: clientPreference?.quietHoursEnd ?? policy.quietHoursEnd,
    allowEmail: clientPreference?.allowEmail !== false,
    allowSms: clientPreference?.allowSms !== false,
    allowChat: clientPreference?.allowChat !== false,
    allowCalls: clientPreference?.allowCalls !== false,
    doNotContact: clientPreference?.doNotContact === true,
    notes: clientPreference?.notes || null,
  };

  return {
    clientId,
    preferredChannel:
      (clientPreferredChannel && permittedChannels[clientPreferredChannel]
        ? clientPreferredChannel
        : null) ||
      (policyPreferredChannel && permittedChannels[policyPreferredChannel]
        ? policyPreferredChannel
        : null),
    language: clientPreference?.language || policy.language,
    timezone: clientPreference?.timezone || policy.timezone,
    quietHoursStart:
      clientPreference?.quietHoursStart ?? policy.quietHoursStart,
    quietHoursEnd: clientPreference?.quietHoursEnd ?? policy.quietHoursEnd,
    allowEmail,
    allowSms,
    allowChat,
    allowCalls,
    doNotContact: clientPreference?.doNotContact === true,
    notes: clientPreference?.notes || null,
    hasClientOverride: Boolean(clientPreference),
    configuredPreference,
    globalPolicy: policy,
  };
}

export async function assertClientCommunicationAllowed({
  agencyId,
  clientId,
  channel,
  db = prisma,
}) {
  const preference = await getEffectiveClientCommunicationPreference({
    agencyId,
    clientId,
    db,
  });
  const field = {
    Email: "allowEmail",
    Sms: "allowSms",
    Chat: "allowChat",
    Call: "allowCalls",
  }[channel];
  return {
    allowed:
      !preference.doNotContact && Boolean(field && preference[field] === true),
    preference,
  };
}
