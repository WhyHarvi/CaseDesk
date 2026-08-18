import {
  activateIncentivePlan,
  createIncentivePlan,
  deleteIncentivePlan,
  getIncentivePlan,
  listIncentivePlans,
  applyPlanToLegacyInvoices,
  previewLegacyInvoicePlanApplication,
  updateIncentivePlan,
} from "../services/incentivePlanService.js";

export async function list(req, res) {
  const data = await listIncentivePlans(req.auth.agencyId, { includeInactive: req.query.includeInactive !== "false" });
  res.json({ data });
}

export async function get(req, res) {
  const data = await getIncentivePlan(req.auth.agencyId, req.params.id);
  res.json({ data });
}

export async function create(req, res) {
  const data = await createIncentivePlan(req.auth.agencyId, req.auth.userId, req.body || {});
  res.status(201).json({ data });
}

export async function update(req, res) {
  const data = await updateIncentivePlan(req.auth.agencyId, req.params.id, req.body || {});
  res.json({ data });
}

export async function activate(req, res) {
  const data = await activateIncentivePlan(req.auth.agencyId, req.params.id);
  res.json({ data });
}

export async function remove(req, res) {
  await deleteIncentivePlan(req.auth.agencyId, req.params.id);
  res.status(204).end();
}

export async function previewLegacyInvoices(req, res) {
  const data = await previewLegacyInvoicePlanApplication(req.auth.agencyId, req.params.id);
  res.json({ data });
}

export async function applyLegacyInvoices(req, res) {
  const data = await applyPlanToLegacyInvoices(req.auth.agencyId, req.params.id, req.auth.userId);
  res.json({ data });
}
