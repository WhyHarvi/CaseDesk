import { BarChart3, ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getCaseEasyReportsForClient } from "../../api/caseEasyImportApi";

const REPORT_LABELS = {
  payment_requests: "Payment Requests",
  invoices: "Invoices",
  payments: "Payments",
  receipts: "Receipts",
  account_receivables: "Account Receivables",
  retainer_balances: "Retainer Balances",
  client_listing: "Client Listing",
  trust_balances: "Trust Balances",
  reminders: "Reminders",
  time_entries: "Time Entries",
  trust_account_entries: "Trust Account Entries",
  activity_tracker: "Activity Tracker",
  case_information: "Case Information",
  employers_applications: "Employer Applications",
  e_signatures: "E-Signatures",
};

export default function CaseEasyReportsCard({ clientId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());

  useEffect(() => {
    let active = true;
    setLoading(true);
    getCaseEasyReportsForClient(clientId)
      .then((data) => {
        if (active) setRows(data || []);
      })
      .catch(() => {
        if (active) setRows([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  const groups = useMemo(() => {
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.reportType)) grouped.set(row.reportType, []);
      grouped.get(row.reportType).push(row);
    }
    return [...grouped.entries()];
  }, [rows]);

  if (!loading && !rows.length) return null;

  return (
    <article className="rounded-[1.9rem] border border-slate-200/90 bg-white p-6 shadow-[0_14px_38px_rgba(15,23,42,0.07)]">
      <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center justify-between gap-4 text-left">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-950">Case Easy report history</h3>
            <p className="mt-1 text-sm text-slate-500">
              {loading ? "Loading imported report data…" : `${rows.length} imported row${rows.length === 1 ? "" : "s"} mapped to this client.`}
            </p>
          </div>
        </div>
        {!loading ? <ChevronDown className={`h-4 w-4 text-slate-400 transition ${expanded ? "rotate-180" : ""}`} /> : null}
      </button>

      {expanded && !loading ? (
        <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
          {groups.map(([type, items]) => (
            <section key={type} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-slate-800">{REPORT_LABELS[type] || type}</h4>
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500">{items.length}</span>
              </div>
              <div className="mt-2 space-y-1.5">
                {(expandedGroups.has(type) ? items : items.slice(0, 6)).map((row) => (
                  <details key={row.id} className="rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                    <summary className="cursor-pointer font-medium">
                      {[row.caseNumber, row.caseType, row.caseStatus].filter(Boolean).join(" · ") || row.fullName || row.clientIdentifier || "Imported report row"}
                    </summary>
                    <dl className="mt-2 grid gap-x-3 gap-y-2 border-t border-slate-100 pt-2 sm:grid-cols-2">
                      {Object.entries(row.rawData || {}).map(([label, value]) => (
                        <div key={label} className="min-w-0">
                          <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</dt>
                          <dd className="mt-0.5 break-words text-xs text-slate-700">{value === null || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ))}
                {items.length > 6 ? (
                  <button
                    type="button"
                    onClick={() => setExpandedGroups((current) => {
                      const next = new Set(current);
                      if (next.has(type)) next.delete(type); else next.add(type);
                      return next;
                    })}
                    className="px-2 text-[11px] font-semibold text-sky-700 hover:underline"
                  >
                    {expandedGroups.has(type) ? "Show fewer" : `Show all ${items.length} rows`}
                  </button>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </article>
  );
}
