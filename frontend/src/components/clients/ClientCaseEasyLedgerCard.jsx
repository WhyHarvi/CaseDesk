import { FileSpreadsheet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getCaseEasyReportsForClient } from "../../api/caseEasyImportApi";
import { formatCurrency } from "../case-profile/caseProfileUtils";
import { LedgerRow, PAYMENT_REPORT_TYPES, parseAmount } from "../case-easy/caseEasyLedgerShared";

// The client-scoped sibling of CaseEasyHistoricalLedgerCard — shows
// imported payment/invoice history against the CLIENT directly, so it's
// visible even before any of the client's cases has been converted (Case
// Easy report rows link to a client via contact/email/phone matching,
// independent of case conversion — see resolveCaseEasyReportLinks).
export default function ClientCaseEasyLedgerCard({ clientId, hasCaseEasyOrigin }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hasCaseEasyOrigin) { setLoading(false); return; }
    let active = true;
    getCaseEasyReportsForClient(clientId)
      .then((data) => { if (active) setRows((data || []).filter((row) => PAYMENT_REPORT_TYPES.has(row.reportType))); })
      .catch(() => { if (active) setRows([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [clientId, hasCaseEasyOrigin]);

  const total = useMemo(
    () => rows.reduce((sum, row) => sum + (parseAmount(row.rawData || {}) || 0), 0),
    [rows],
  );

  if (!hasCaseEasyOrigin || (!loading && !rows.length)) return null;

  return (
    <article className="rounded-[1.9rem] border border-slate-200/90 bg-white p-6 shadow-[0_14px_38px_rgba(15,23,42,0.07)]">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          <FileSpreadsheet className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-950">Historical ledger review — Case Easy</h3>
          <p className="mt-1 text-sm text-slate-500">
            Imported for reference. Not included in real totals and not connected to QuickBooks or any invoice/payment record.
          </p>
        </div>
      </div>
      {loading ? (
        <p className="mt-4 text-sm text-slate-400">Loading imported history…</p>
      ) : (
        <>
          <p className="mt-4 mb-2 text-xs font-semibold text-slate-500">{rows.length} imported row{rows.length === 1 ? "" : "s"}{total ? ` · ${formatCurrency(total)} total (historical, not owed)` : ""}</p>
          <div className="space-y-1.5">
            {rows.map((row) => <LedgerRow key={row.id} row={row} />)}
          </div>
        </>
      )}
    </article>
  );
}
