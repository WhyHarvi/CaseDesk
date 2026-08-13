import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getCaseEasyReportRows,
  getCaseEasyReportSummary,
} from "../../api/caseEasyImportApi";
import Select from "../ui/Select";

const LINK_OPTIONS = [
  ["", "All link states"],
  ["linked", "Linked"],
  ["unlinked", "Unlinked"],
  ["ambiguous", "Ambiguous"],
  ["standalone", "Standalone companies"],
  ["aggregate", "Aggregate rows"],
  ["source_only", "Source-only rows"],
];

function prettyHeader(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function ReportRow({ row }) {
  const [expanded, setExpanded] = useState(false);
  const standalone =
    row.linkStatus === "unlinked" && row.importStatus === "reviewed";
  const aggregate = row.linkStatus === "aggregate";
  const sourceOnly = row.linkStatus === "source_only";
  const displayStatus = standalone
    ? "Standalone company"
    : aggregate
      ? "Aggregate"
      : sourceOnly
        ? "Source-only"
      : prettyHeader(row.linkStatus);
  const statusClass = row.linkStatus === "linked"
    ? "bg-emerald-50 text-emerald-700"
    : aggregate
      ? "bg-violet-50 text-violet-700"
    : sourceOnly
      ? "bg-slate-100 text-slate-600"
    : standalone
      ? "bg-sky-50 text-sky-700"
      : "bg-amber-50 text-amber-700";
  const clientName = row.linkedContact
    ? [row.linkedContact.firstName, row.linkedContact.lastName]
        .filter(Boolean)
        .join(" ")
    : null;
  return (
    <article className={`rounded-2xl border bg-white ${row.linkStatus === "linked" || sourceOnly ? "border-slate-200" : aggregate ? "border-violet-200" : standalone ? "border-sky-200" : "border-amber-200"}`}>
      <div className="flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={() => setExpanded((value) => !value)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-slate-900">
                {row.fullName || row.companyName || row.clientIdentifier || row.caseNumber || row.caseType || "Unidentified report row"}
              </p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass}`}>
                {displayStatus}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">
              {[
                row.caseNumber,
                row.clientIdentifier,
                row.caseType,
                clientName && `Mapped to ${clientName}`,
              ].filter(Boolean).join(" · ") || "No identity fields in this row"}
            </p>
          </div>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${expanded ? "rotate-180" : ""}`} />
        </button>
        {row.linkedContact?.convertedClientId ? (
          <Link
            to={`/app/clients/${row.linkedContact.convertedClientId}`}
            className="hidden items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 sm:inline-flex"
          >
            Client <ExternalLink className="h-3 w-3" />
          </Link>
        ) : null}
      </div>
      {expanded ? (
        <div className="border-t border-slate-100 px-4 py-4">
          {row.linkReason ? (
            <p className={`mb-3 flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${standalone ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-800"}`}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {row.linkReason}
            </p>
          ) : null}
          <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(row.rawData || {}).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</dt>
                <dd className="mt-1 break-words text-xs text-slate-700">{value === null || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </article>
  );
}

export default function CaseEasyReportsBrowser() {
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [reportType, setReportType] = useState("");
  const [linkStatus, setLinkStatus] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [nextSummary, result] = await Promise.all([
        getCaseEasyReportSummary(),
        getCaseEasyReportRows({
          reportType: reportType || undefined,
          linkStatus: linkStatus || undefined,
          page,
          limit: 25,
        }),
      ]);
      setSummary(nextSummary);
      setRows(result.rows);
      setPagination(result.pagination);
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not load imported reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [reportType, linkStatus, page]);

  function changeFilter(setter, value) {
    setter(value);
    setPage(1);
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          ["Report rows", summary?.reportTypes.reduce((sum, item) => sum + item.count, 0) || 0],
          ["Linked", summary?.linkStatuses.linked || 0],
          ["Needs matching", (summary?.linkStatuses.unlinked || 0) + (summary?.linkStatuses.ambiguous || 0)],
          ["Standalone companies", summary?.linkStatuses.standalone || 0],
          ["Aggregate rows", summary?.linkStatuses.aggregate || 0],
          ["Source-only rows", summary?.linkStatuses.sourceOnly || 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={reportType} onChange={(event) => changeFilter(setReportType, event.target.value)} className="w-56">
          <option value="">All report types</option>
          {(summary?.reportTypes || []).map((item) => (
            <option key={item.type} value={item.type}>{item.label} ({item.count})</option>
          ))}
        </Select>
        <Select value={linkStatus} onChange={(event) => changeFilter(setLinkStatus, event.target.value)} className="w-44">
          {LINK_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {error ? <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {loading ? (
        <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : rows.length ? (
        <div className="space-y-2">{rows.map((row) => <ReportRow key={row.id} row={row} />)}</div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center">
          <BarChart3 className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No imported report rows</p>
          <p className="mt-1 text-xs text-slate-500">Import Client Listing first from Settings → Case Easy Import.</p>
        </div>
      )}

      {pagination.total ? (
        <div className="flex items-center justify-end gap-2">
          <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="inline-flex h-9 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 disabled:opacity-40">
            <ChevronLeft className="h-3.5 w-3.5" /> Previous
          </button>
          <span className="text-xs text-slate-500">Page {pagination.page} of {pagination.pages}</span>
          <button type="button" disabled={page >= pagination.pages} onClick={() => setPage((value) => value + 1)} className="inline-flex h-9 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 disabled:opacity-40">
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
