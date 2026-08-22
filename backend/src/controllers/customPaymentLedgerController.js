import { createCustomPaymentLedger, listCustomPaymentLedgers, updateCustomPaymentLedger } from "../services/customPaymentLedgerService.js";

export async function list(req, res) { res.json({ data: await listCustomPaymentLedgers(req.auth.agencyId) }); }
export async function create(req, res) { res.status(201).json({ data: await createCustomPaymentLedger(req.auth.agencyId, req.auth.userId, req.body) }); }
export async function update(req, res) { res.json({ data: await updateCustomPaymentLedger(req.auth.agencyId, req.params.id, req.body) }); }
