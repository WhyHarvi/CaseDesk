import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { formatCurrency, formatDate } from "../case-profile/caseProfileUtils";

// The billing-relevant subset of Case Easy's report types — the rest
// (reminders, trust balances, e-signatures, etc.) belong on the client
// profile's general Case Easy history card, not here.
export const PAYMENT_REPORT_TYPES = new Set([
  "payment_requests",
  "invoices",
  "payments",
  "receipts",
  "account_receivables",
  "retainer_balances",
]);

export const REPORT_LABELS = {
  payment_requests: "Payment request",
  invoices: "Invoice",
  payments: "Payment",
  receipts: "Receipt",
  account_receivables: "Outstanding invoice",
  retainer_balances: "Retainer balance",
};

const AMOUNT_FIELDS = ["Amount", "Balance", "Grand Total", "Paid"];
const DATE_FIELDS = ["Payment Date", "Invoice Date", "Created Date", "Created", "Entry Date", "Transaction Date"];
const STATUS_FIELDS = ["Status", "Method", "Currency"];

export function parseAmount(raw) {
  for (const field of AMOUNT_FIELDS) {
    const value = raw[field];
    if (value === null || value === undefined || value === "") continue;
    const numeric = Number(String(value).replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function parseRowDate(raw) {
  for (const field of DATE_FIELDS) {
    const value = raw[field];
    if (!value) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function rowSummaryLine(raw) {
  return STATUS_FIELDS.map((field) => raw[field]).filter(Boolean).join(" · ");
}

export function LedgerRow({ row }) {
  const [expanded, setExpanded] = useState(false);
  const raw = row.rawData || {};
  const amount = parseAmount(raw);
  const rowDate = parseRowDate(raw);

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">
            {REPORT_LABELS[row.reportType] || row.reportType}
            {rowSummaryLine(raw) ? <span className="font-normal text-slate-500"> · {rowSummaryLine(raw)}</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">{rowDate ? formatDate(rowDate) : "Date not recorded"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {amount !== null ? <span className="text-sm font-semibold tabular-nums text-slate-700">{formatCurrency(amount)}</span> : null}
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>
      {expanded ? (
        <dl className="grid gap-x-3 gap-y-1.5 border-t border-slate-100 px-3.5 py-2.5 text-xs sm:grid-cols-2">
          {Object.entries(raw).map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</dt>
              <dd className="mt-0.5 break-words text-slate-700">{value === null || value === "" ? "—" : String(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
