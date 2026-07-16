export async function nextClientNumber(tx, agencyId, now = new Date()) {
  const sequence = await tx.agencyClientSequence.upsert({
    where: { agencyId },
    create: { agencyId, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
    select: { nextValue: true },
  });
  const value = sequence.nextValue - 1;
  return `CL-${now.getUTCFullYear()}-${String(value).padStart(6, "0")}`;
}
