import * as service from "./lead.routing.service.js";

export async function listLeadRoutingRules(req, res) {
  res.json({ data: await service.listLeadRoutingRules(req) });
}

export async function createLeadRoutingRule(req, res) {
  res.status(201).json({ data: await service.createLeadRoutingRule(req) });
}

export async function updateLeadRoutingRule(req, res) {
  res.json({ data: await service.updateLeadRoutingRule(req) });
}

export async function deleteLeadRoutingRule(req, res) {
  res.json({ data: await service.deleteLeadRoutingRule(req) });
}

export async function listLeadRoutingBacklog(req, res) {
  res.json({ data: await service.listLeadRoutingBacklog(req) });
}

export async function reviewLeadRoutingBacklog(req, res) {
  res.json({ data: await service.reviewLeadRoutingBacklog(req) });
}
