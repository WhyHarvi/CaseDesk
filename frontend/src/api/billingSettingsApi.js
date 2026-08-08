import api from "../services/api";

export async function getBillingSettings() {
  const response = await api.get("/billing-settings", { cache: false });
  return response.data.data;
}

export async function updateBillingTaxSettings(values) {
  const response = await api.patch("/billing-settings", values);
  return response.data.data;
}

export async function updateRetainerSignature(signatureImage) {
  const response = await api.put("/billing-settings/retainer-signature", { signatureImage });
  return response.data.data;
}

export async function deleteRetainerSignature() {
  const response = await api.delete("/billing-settings/retainer-signature");
  return response.data.data;
}
