import api from "../services/api";

export async function getFeeCategories({ includeInactive = false } = {}) {
  const response = await api.get("/fee-categories", { params: { includeInactive }, cache: false });
  return response.data.data;
}

export async function createFeeCategory(values) {
  const response = await api.post("/fee-categories", values);
  return response.data.data;
}

export async function updateFeeCategory(id, values) {
  const response = await api.patch(`/fee-categories/${id}`, values);
  return response.data.data;
}

export async function deleteFeeCategory(id) {
  await api.delete(`/fee-categories/${id}`);
}
