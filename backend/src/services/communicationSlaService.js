import prisma from "./prisma/client.js";

const DEFAULT_FIRST_RESPONSE_MINUTES = 240;

export async function getAgencyCommunicationSla(agencyId) {
  return prisma.communicationSlaPolicy.findUnique({ where: { agencyId } });
}

function addTargetMinutes(policy, receivedAt, minutes) {
  if (policy?.businessHoursOnly) {
    const timezone = policy.timezone || "America/Toronto";
    const [startHour, startMinute] = (policy.businessHoursStart || "09:00")
      .split(":")
      .map(Number);
    const [endHour, endMinute] = (policy.businessHoursEnd || "17:00")
      .split(":")
      .map(Number);
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    let counted = 0;
    let candidate = new Date(receivedAt.getTime());
    for (let step = 0; step < 259_200 && counted < minutes; step += 1) {
      candidate = new Date(candidate.getTime() + 60_000);
      const parts = Object.fromEntries(
        formatter
          .formatToParts(candidate)
          .map((part) => [part.type, part.value]),
      );
      const localMinute = Number(parts.hour) * 60 + Number(parts.minute);
      if (
        !["Sat", "Sun"].includes(parts.weekday) &&
        localMinute >= start &&
        localMinute < end
      )
        counted += 1;
    }
    return candidate;
  }
  return new Date(receivedAt.getTime() + minutes * 60_000);
}

export async function communicationResponseDueAt(
  agencyId,
  receivedAt = new Date(),
) {
  const policy = await getAgencyCommunicationSla(agencyId);
  const minutes = Math.max(
    policy?.firstResponseMinutes || DEFAULT_FIRST_RESPONSE_MINUTES,
    1,
  );
  return addTargetMinutes(policy, receivedAt, minutes);
}

export async function communicationResolutionDueAt(
  agencyId,
  openedAt = new Date(),
) {
  const policy = await getAgencyCommunicationSla(agencyId);
  const minutes = Math.max((policy?.resolutionHours || 48) * 60, 60);
  return addTargetMinutes(policy, openedAt, minutes);
}
