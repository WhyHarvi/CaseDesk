import { createFeeCategory, deleteFeeCategory, listFeeCategories, updateFeeCategory } from "../services/feeCategoryService.js";

export async function list(req, res) {
  const data = await listFeeCategories(req.auth.agencyId, { includeInactive: req.query.includeInactive === "true" });
  res.json({ data });
}

export async function create(req, res) {
  const data = await createFeeCategory(req.auth.agencyId, req.body || {});
  res.status(201).json({ data });
}

export async function update(req, res) {
  const data = await updateFeeCategory(req.auth.agencyId, req.params.id, req.body || {});
  res.json({ data });
}

export async function remove(req, res) {
  await deleteFeeCategory(req.auth.agencyId, req.params.id);
  res.status(204).end();
}
