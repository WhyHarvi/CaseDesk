export function leadAccessWhere(req) {
  if (req.auth.role === "admin") return {};
  if (req.auth.role === "consultant") return { ownerUserId: req.auth.userId };
  if (req.auth.role === "frontdesk") {
    return { OR: [{ ownerUserId: req.auth.userId }, { nextActionOwnerId: req.auth.userId }] };
  }
  return { id: "__denied__" };
}

export function canCreateLead(req) {
  return ["admin", "consultant", "frontdesk"].includes(req.auth.role);
}
