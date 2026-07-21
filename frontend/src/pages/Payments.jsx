import {
  Banknote,
  CalendarClock,
  ExternalLink,
  HandCoins,
  Landmark,
  Loader2,
  Search,
  ShieldAlert,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getPaymentsOverview, getPaymentsOverviewSummary } from "../api/paymentsOverviewApi";

const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 });

const surfaceClass = "rounded-[30px] border border-white/80 bg-white/90 shadow-[0_22px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl";

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

const STATUS_LABEL = { Open: "Open", PartiallyPaid: "Partially paid", Paid: "Paid", Overdue: "Overdue", Voided: "Voided" };
const STATUS_TONE = {
  Open: "bg-slate-100 text-slate-600 ring-slate-200",
  PartiallyPaid: "bg-amber-50 text-amber-600 ring-amber-100",
  Paid: "bg-emerald-50 text-emerald-600 ring-emerald-100",
  Overdue: "bg-rose-50 text-rose-600 ring-rose-100",
  Voided: "bg-slate-100 text-slate-400 ring-slate-200",
};
const SOURCE_LABEL = { case_invoice: "Case invoice", booking_payment: "Consultation booking", legacy_payment: "Legacy retainer" };
const SOURCE_ICON = { case_invoice: Banknote, booking_payment: CalendarClock, legacy_payment: Landmark };

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function KpiCard({ label, amount, icon: Icon, tint }) {
  return (
    <article className={cx(surfaceClass, "min-w-0 p-4")}>
      <div className="flex min-w-0 items-center gap-3.5">
        <div className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-full ring-1", tint)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold leading-4 text-slate-500">{label}</p>
          <p className="mt-1.5 truncate text-[21px] font-semibold leading-7 tracking-[-0.035em] text-slate-950">
            {typeof amount === "number" ? money.format(amount) : amount}
          </p>
        </div>
      </div>
    </article>
  );
}

export default function Payments() {
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getPaymentsOverviewSummary().catch(() => null).then((data) => data && setSummary(data));
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getPaymentsOverview({ status, source, query, from, to, page, pageSize })
      .then((data) => {
        if (!active) return;
        setRows(data.rows);
        setTotal(data.total);
      })
      .catch((reason) => active && setError(reason.response?.data?.message || "Payments could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [status, source, query, from, to, page]);

  useEffect(() => { setPage(1); }, [status, source, query, from, to]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const kpis = useMemo(() => ([
    { label: "Total Collected", amount: summary?.totalCollected ?? 0, icon: HandCoins, tint: "bg-emerald-50 text-emerald-500 ring-emerald-100" },
    { label: "Outstanding Balance", amount: summary?.outstandingBalance ?? 0, icon: Wallet, tint: "bg-amber-50 text-amber-500 ring-amber-100" },
    { label: "Paid This Month", amount: summary?.paidThisMonth ?? 0, icon: TrendingUp, tint: "bg-blue-50 text-blue-500 ring-blue-100" },
    { label: "Overdue Invoices", amount: String(summary?.overdueCount ?? 0), icon: ShieldAlert, tint: "bg-violet-50 text-violet-500 ring-violet-100" },
  ]), [summary]);

  return (
    <main className="min-w-0 px-3 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex w-full max-w-[1680px] min-w-0 flex-col gap-5">
        <div className={cx(surfaceClass, "overflow-hidden p-4 sm:p-6 lg:p-8")}>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">Payments</h1>
          <p className="mt-3 max-w-2xl text-base text-slate-500">
            Every case invoice, consultation booking payment, and legacy retainer record across the agency, in one place.
          </p>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((item) => <KpiCard key={item.label} {...item} />)}
        </div>

        <section className={cx(surfaceClass, "min-w-0 overflow-hidden p-4 sm:p-5")}>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search client or invoice #…"
                className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-3.5 text-sm shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
            </div>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 shadow-sm outline-none focus:border-sky-400">
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={source} onChange={(event) => setSource(event.target.value)} className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 shadow-sm outline-none focus:border-sky-400">
              <option value="">All types</option>
              {Object.entries(SOURCE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700 shadow-sm outline-none focus:border-sky-400" />
            <span className="text-xs text-slate-400">to</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700 shadow-sm outline-none focus:border-sky-400" />
          </div>

          <div className="mt-4 overflow-x-auto rounded-[18px] border border-slate-200/70">
            <table className="min-w-[900px] w-full border-separate border-spacing-0 text-left">
              <thead>
                <tr className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-[0.02em] text-slate-500">
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Case</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Balance</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="7" className="border-t border-slate-100 px-4 py-10 text-center text-sm text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                ) : error ? (
                  <tr><td colSpan="7" className="border-t border-slate-100 px-4 py-8 text-center text-sm text-rose-600">{error}</td></tr>
                ) : rows?.length ? (
                  rows.map((row) => {
                    const Icon = SOURCE_ICON[row.source] || Banknote;
                    return (
                      <tr key={row.id} className="border-t border-slate-100 text-[13px] text-slate-700 transition hover:bg-slate-50/70">
                        <td className="border-t border-slate-100 px-4 py-3.5">
                          <p className="font-semibold text-slate-900">{row.clientName}</p>
                          <p className="mt-0.5 truncate text-xs text-slate-400">{row.description}</p>
                        </td>
                        <td className="border-t border-slate-100 px-4 py-3.5">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500"><Icon className="h-3.5 w-3.5" /> {row.type}</span>
                        </td>
                        <td className="border-t border-slate-100 px-4 py-3.5">
                          {row.caseId ? (
                            <Link to={`/app/cases/${row.caseId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900">
                              {row.caseType || "View case"} <ExternalLink className="h-3 w-3" />
                            </Link>
                          ) : <span className="text-xs text-slate-400">—</span>}
                        </td>
                        <td className="border-t border-slate-100 px-4 py-3.5 font-semibold text-slate-900">{money.format(row.amount)}</td>
                        <td className="border-t border-slate-100 px-4 py-3.5 text-slate-600">{row.balance > 0 ? money.format(row.balance) : <span className="text-emerald-600">Paid in full</span>}</td>
                        <td className="border-t border-slate-100 px-4 py-3.5 text-slate-500">{formatDate(row.createdAt)}</td>
                        <td className="border-t border-slate-100 px-4 py-3.5">
                          <span className={cx("inline-flex h-7 items-center rounded-full px-3 text-[11px] font-semibold ring-1", STATUS_TONE[row.status] || STATUS_TONE.Open)}>
                            {STATUS_LABEL[row.status] || row.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr><td colSpan="7" className="border-t border-slate-100 px-4 py-10 text-center text-sm text-slate-400">No payments match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {!loading && total > 0 ? (
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>{total} record{total === 1 ? "" : "s"} · page {page} of {pageCount}</span>
              <div className="flex gap-2">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40">Previous</button>
                <button type="button" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40">Next</button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
