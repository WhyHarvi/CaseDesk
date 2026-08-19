import { createCaseRole, deleteCaseRole, listCaseRoles, updateCaseRole } from "../services/caseRoleService.js";

export async function list(req, res) {
  const data = await listCaseRoles(req.auth.agencyId, { includeInactive: req.query.includeInactive === "true" });
  res.json({ data });
}

export async function create(req, res) {
  const data = await createCaseRole(req.auth.agencyId, req.body || {});
  res.status(201).json({ data });
}

export async function update(req, res) {
  const data = await updateCaseRole(req.auth.agencyId, req.params.id, req.body || {});
  res.json({ data });
}

export async function remove(req, res) {
  await deleteCaseRole(req.auth.agencyId, req.params.id);
  res.status(204).end();
}
