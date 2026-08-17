import api from "../services/api";

export async function getQuickBooksStatus() {
  const response = await api.get("/quickbooks/status", { cache: false });
  return response.data.data;
}

export async function startQuickBooksConnect() {
  const response = await api.post("/quickbooks/connect");
  return response.data.data;
}

export async function disconnectQuickBooks() {
  const response = await api.post("/quickbooks/disconnect");
  return response.data.data;
}

export async function getQuickBooksItems() {
  const response = await api.get("/quickbooks/items", { cache: false });
  return response.data.data;
}

export async function getQuickBooksAccounts() {
  const response = await api.get("/quickbooks/accounts", { cache: false });
  return response.data.data;
}

export async function getQuickBooksTaxCodes() {
  const response = await api.get("/quickbooks/tax-codes", { cache: false });
  return {
    taxCodes: response.data.data,
    usingSalesTax: response.data.meta?.usingSalesTax ?? null,
  };
}

export async function createQuickBooksItem(values) {
  const response = await api.post("/quickbooks/items", values);
  return response.data.data;
}

export async function getQuickBooksMapping() {
  const response = await api.get("/quickbooks/mapping", { cache: false });
  return response.data.data;
}

export async function updateQuickBooksMapping(values) {
  const response = await api.put("/quickbooks/mapping", values);
  return response.data.data;
}
