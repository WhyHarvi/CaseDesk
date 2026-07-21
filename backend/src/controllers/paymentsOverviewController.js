import { getPaymentsSummary, listAgencyPayments } from "../services/paymentsOverviewService.js";

export async function getPaymentsList(req, res) {
  const { status, source, query, from, to, page, pageSize } = req.query;
  const data = await listAgencyPayments(req.auth.agencyId, {
    status: status || undefined,
    source: source || undefined,
    query: query || undefined,
    from: from || undefined,
    to: to || undefined,
    page: page ? Number(page) : 1,
    pageSize: pageSize ? Math.min(Number(pageSize), 100) : 25,
  });
  res.json({ data });
}

export async function getPaymentsSummaryOverview(req, res) {
  const data = await getPaymentsSummary(req.auth.agencyId);
  res.json({ data });
}
