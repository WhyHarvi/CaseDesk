import { FileSpreadsheet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getCaseEasyReportsForCase } from "../../api/caseEasyImportApi";
import { formatCurrency } from "./caseProfileUtils";
import { LedgerRow, PAYMENT_REPORT_TYPES, parseAmount } from "../case-easy/caseEasyLedgerShared";

export default function CaseEasyHistoricalLedgerCard({ caseId, hasCaseEasyOrigin }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hasCaseEasyOrigin) { setLoading(false); return; }
    let active = true;
    getCaseEasyReportsForCase(caseId)
      .then((data) => { if (active) setRows((data || []).filter((row) => PAYMENT_REPORT_TYPES.has(row.reportType))); })
      .catch(() => { if (active) setRows([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [caseId, hasCaseEasyOrigin]);

  const total = useMemo(
    () => rows.reduce((sum, row) => sum + (parseAmount(row.rawData || {}) || 0), 0),
    [rows],
  );

  if (!hasCaseEasyOrigin || (!loading && !rows.length)) return null;

  return (
    <section aria-labelledby="billing-case-easy-heading" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-3 border-b border-slate-100 pb-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
          <FileSpreadsheet className="h-4 w-4" />
        </span>
        <div>
          <h3 id="billing-case-easy-heading" className="text-base font-semibold text-slate-950">Historical ledger review — Case Easy</h3>
          <p className="text-sm text-slate-600">
            Imported from Case Easy for reference. Historical entries only — not included in the totals above and not connected to QuickBooks or any invoice/payment record.
          </p>
        </div>
      </div>
      {loading ? (
        <p className="text-sm text-slate-400">Loading imported history…</p>
      ) : (
        <>
          <p className="mb-2 text-xs font-semibold text-slate-500">{rows.length} imported row{rows.length === 1 ? "" : "s"}{total ? ` · ${formatCurrency(total)} total (historical, not owed)` : ""}</p>
          <div className="space-y-1.5">
            {rows.map((row) => <LedgerRow key={row.id} row={row} />)}
          </div>
        </>
      )}
    </section>
  );
}
