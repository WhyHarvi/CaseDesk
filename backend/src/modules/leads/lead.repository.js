import { createHttpError } from "../../utils/http.js";
import { leadAccessWhere } from "./lead.permissions.js";

export async function requireLead(prisma, req, id) {
  const lead = await prisma.lead.findFirst({
    where: { id, agencyId: req.auth.agencyId, deletedAt: null, ...leadAccessWhere(req) },
  });
  if (!lead) throw createHttpError(404, "Lead not found.", "LEAD_NOT_FOUND");
  return lead;
}

export async function nextLeadNumber(tx, agencyId, now = new Date()) {
  const sequence = await tx.agencyLeadSequence.upsert({
    where: { agencyId },
    create: { agencyId, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
    select: { nextValue: true },
  });
  const value = sequence.nextValue - 1;
  return `LD-${now.getUTCFullYear()}-${String(value).padStart(6, "0")}`;
}
