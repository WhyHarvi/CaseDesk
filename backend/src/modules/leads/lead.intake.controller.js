import * as service from "./lead.intake.service.js";

export async function listForms(req, res) { res.json({ data: await service.listIntakeForms(req) }); }
export async function createForm(req, res) { res.status(201).json({ data: await service.createIntakeForm(req) }); }
export async function updateForm(req, res) { res.json({ data: await service.updateIntakeForm(req) }); }
export async function getPublicForm(req, res) { res.json({ data: await service.getPublicIntake(req.params.token) }); }
export async function submitPublicForm(req, res) { res.status(202).json({ data: await service.submitPublicIntake(req) }); }
export async function previewImport(req, res) { res.status(201).json({ data: await service.previewImport(req) }); }
export async function listImports(req, res) { res.json({ data: await service.listImports(req) }); }
export async function getImport(req, res) { res.json({ data: await service.getImport(req) }); }
export async function commitImport(req, res) { res.status(202).json({ data: await service.commitImport(req) }); }
export async function listEvents(req, res) { res.json({ data: await service.listIncomingEvents(req) }); }
export async function getOperations(req, res) { res.json({ data: await service.getIntakeOperations(req) }); }
export async function retryEvent(req, res) { res.json({ data: await service.retryIncomingEvent(req) }); }
