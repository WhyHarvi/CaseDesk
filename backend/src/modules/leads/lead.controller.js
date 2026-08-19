import * as service from "./lead.service.js";
import { syncClientToQuickBooks } from "../../services/clientQuickBooksSyncService.js";
import { evaluateCaseTimelineLegs } from "../../services/incentiveTimelineService.js";
import { logger } from "../../services/logger.js";
import { getLeadDashboard as loadLeadDashboard, getLeadDashboardDrilldown as loadLeadDashboardDrilldown } from "./lead.dashboard.service.js";
import { getAgeingReport as loadAgeingReport, getConversionTrendReport as loadConversionTrendReport, getEmployeeReport as loadEmployeeReport, getFunnelReport as loadFunnelReport, getLostReport as loadLostReport, getResponseTimeReport as loadResponseTimeReport, getSourceReport as loadSourceReport, getWorkloadReport as loadWorkloadReport } from "./lead.report.service.js";
import { requestStaleLeadOutreachForAgency } from "./lead.staleOutreach.service.js";

export async function getLeadDashboard(req, res) {
  res.json({ data: await loadLeadDashboard(req) });
}

export async function getLeadDashboardDrilldown(req, res) {
  res.json({ data: await loadLeadDashboardDrilldown(req) });
}

export async function getFunnelReport(req, res) {
  res.json({ data: await loadFunnelReport(req) });
}

export async function getSourceReport(req, res) {
  res.json({ data: await loadSourceReport(req) });
}

export async function getEmployeeReport(req, res) {
  res.json({ data: await loadEmployeeReport(req) });
}

export async function getLostReport(req, res) {
  res.json({ data: await loadLostReport(req) });
}

export async function getResponseTimeReport(req, res) {
  res.json({ data: await loadResponseTimeReport(req) });
}

export async function getAgeingReport(req, res) {
  res.json({ data: await loadAgeingReport(req) });
}

export async function getConversionTrendReport(req, res) {
  res.json({ data: await loadConversionTrendReport(req) });
}

export async function getWorkloadReport(req, res) {
  res.json({ data: await loadWorkloadReport(req) });
}

export async function createLead(req, res) {
  res.status(201).json({ data: await service.createLead(req) });
}

export async function listLeads(req, res) {
  res.json(await service.listLeads(req));
}

export async function getLead(req, res) {
  res.json({ data: await service.getLead(req) });
}

export async function updateLeadDetails(req, res) {
  res.json({ data: await service.updateLeadDetails(req) });
}

export async function listLeadSources(req, res) {
  res.json({ data: await service.listLeadSources(req) });
}

export async function listLeadStaff(req, res) {
  res.json({ data: await service.listLeadStaff(req) });
}

export async function requestLeadTransfer(req, res) {
  res.status(202).json({ data: await service.requestLeadTransfer(req) });
}

export async function listLeadTransferRequests(req, res) {
  res.json({ data: await service.listLeadTransferRequests(req) });
}

export async function approveLeadTransferRequest(req, res) {
  res.json({ data: await service.approveLeadTransferRequest(req) });
}

export async function rejectLeadTransferRequest(req, res) {
  res.json({ data: await service.rejectLeadTransferRequest(req) });
}

export async function listLeadImmigrationInterests(req, res) {
  res.json({ data: await service.listLeadImmigrationInterests(req) });
}

export async function getLeadSettings(req, res) {
  res.json({ data: await service.getLeadSettings(req) });
}

export async function updateLeadSettings(req, res) {
  res.json({ data: await service.updateLeadSettings(req) });
}

export async function getStaleLeadOutreachOverview(req, res) {
  res.json({ data: await service.getStaleLeadOutreachOverview(req) });
}

export async function runStaleLeadOutreach(req, res) {
  const accepted = requestStaleLeadOutreachForAgency(req.auth.agencyId);
  res.status(202).json({ data: { accepted, message: accepted ? "Outreach run started." : "An outreach run is already in progress." } });
}

export async function qualifyLead(req, res) {
  res.json({ data: await service.qualifyLead(req) });
}

export async function listConsultations(req, res) {
  res.json({ data: await service.listConsultations(req) });
}

export async function createConsultation(req, res) {
  res.status(201).json({ data: await service.createConsultation(req) });
}

export async function updateConsultation(req, res) {
  res.json({ data: await service.updateConsultation(req) });
}

export async function updateCommercialStatus(req, res) {
  res.json({ data: await service.updateCommercialStatus(req) });
}

export async function createClientForPayment(req, res) {
  res.status(201).json({ data: await service.createClientForPayment(req) });
}

export async function convertLead(req, res) {
  const result = await service.convertLead(req);
  // Fired after the transaction commits — an external QuickBooks call has no
  // place inside a DB transaction, and syncClientToQuickBooks never throws.
  await syncClientToQuickBooks(req.auth.agencyId, result.client.id).catch(() => null);
  // Best-effort: this is the one hook point for LEAD_CREATED/LEAD_STAGE_REACHED
  // timeline legs, since plan resolution needs caseType, which doesn't exist
  // until this case does. See incentiveTimelineService.js's module doc.
  await evaluateCaseTimelineLegs(req.auth.agencyId, result.case.id).catch((error) => {
    logger.warn("lead.timeline_bonus_evaluation_failed", { caseId: result.case.id, reason: error.message });
  });
  res.status(201).json({ data: result });
}

export async function recordLeadActivity(req, res) {
  res.status(201).json({ data: await service.recordLeadActivity(req) });
}

export async function updateLeadNote(req, res) {
  res.json({ data: await service.updateLeadNote(req) });
}

export async function createLeadFollowUp(req, res) {
  res.status(201).json({ data: await service.createLeadFollowUp(req) });
}

export async function updateLeadFollowUp(req, res) {
  res.json({ data: await service.updateLeadFollowUp(req) });
}

export async function assignLead(req, res) {
  res.json({ data: await service.assignLead(req) });
}

export async function moveLeadToNurture(req, res) {
  res.json({ data: await service.moveLeadToNurture(req) });
}

export async function markLeadLost(req, res) {
  res.json({ data: await service.markLeadLost(req) });
}

export async function reactivateLead(req, res) {
  res.json({ data: await service.reactivateLead(req) });
}

export async function promoteLeadToPipeline(req, res) {
  res.json({ data: await service.promoteLeadToPipeline(req) });
}

export async function bulkPromoteLeadsToPipeline(req, res) {
  res.json({ data: await service.bulkPromoteLeadsToPipeline(req) });
}

export async function bulkReassignLeads(req, res) {
  res.json({ data: await service.bulkReassignLeads(req) });
}

export async function changeLeadStage(req, res) {
  res.json({ data: await service.changeLeadStage(req) });
}

export async function changeLeadPriority(req, res) {
  res.json({ data: await service.changeLeadPriority(req) });
}
