// A lead can temporarily share a Client/Case profile before formal conversion.
// These helpers only attach records through an existing appointment relationship;
// contact details alone are deliberately not enough to make this consequential link.
export async function linkLeadSoftProfile(db, { agencyId, leadId = null, clientId, caseId = null }) {
  if (!agencyId || !clientId) return null;

  const candidates = await db.lead.findMany({
    where: {
      agencyId,
      status: "OPEN",
      ...(leadId ? { id: leadId } : {}),
      OR: [
        { earlyClientId: clientId },
        { appointments: { some: { clientId } } },
      ],
    },
    select: {
      id: true,
      earlyClientId: true,
      earlyCaseId: true,
      appointments: { where: { clientId }, select: { id: true }, take: 1 },
    },
    take: 2,
  });
  if (candidates.length !== 1) return null;

  const lead = candidates[0];
  if (lead.earlyClientId && lead.earlyClientId !== clientId) return null;
  if (!lead.earlyClientId && !lead.appointments.length) return null;
  if (lead.earlyCaseId && caseId && lead.earlyCaseId !== caseId) return null;

  if (caseId) {
    const ownedCase = await db.case.findFirst({
      where: { id: caseId, agencyId, clientId, deletedAt: null },
      select: { id: true },
    });
    if (!ownedCase) return null;
  }

  const alreadyOwned = await db.lead.findFirst({
    where: {
      agencyId,
      id: { not: lead.id },
      OR: [
        { earlyClientId: clientId },
        { convertedClientId: clientId },
        ...(caseId ? [{ earlyCaseId: caseId }, { convertedCaseId: caseId }] : []),
      ],
    },
    select: { id: true },
  });
  if (alreadyOwned) return null;

  const data = {
    ...(!lead.earlyClientId ? { earlyClientId: clientId } : {}),
    ...(caseId && !lead.earlyCaseId ? { earlyCaseId: caseId } : {}),
  };
  if (!Object.keys(data).length) return lead;

  return db.lead.update({
    where: { id: lead.id },
    data: { ...data, version: { increment: 1 } },
    select: { id: true, earlyClientId: true, earlyCaseId: true },
  });
}
