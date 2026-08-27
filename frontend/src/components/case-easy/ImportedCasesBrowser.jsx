import { ArchiveRestore, ChevronLeft, ChevronRight, ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getImportedCases } from "../../api/caseEasyImportApi";

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

// Every real CaseDesk case a Case Easy conversion has ever produced — the
// one place to confirm none of this historical data quietly went active,
// and to jump to a specific client if one turns out to need real work again.
export default function ImportedCasesBrowser() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, pages: 1 });

  async function load(term, requestedPage = page) {
    setLoading(true);
    setError("");
    try {
      const result = await getImportedCases({ search: term || undefined, page: requestedPage, limit: 25 });
      setCases(result.data || []);
      setPagination(result.pagination || { page: 1, limit: 25, total: result.data?.length || 0, pages: 1 });
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not load imported cases.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => load(search, page), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page]);

  const activeCount = cases.filter((item) => !item.archivedAt).length;

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
        Cases converted from Case Easy land here Closed and archived by default — historical reference on the client's
        profile, not active work. {activeCount > 0 ? (
          <strong className="font-semibold">On this page, {activeCount} imported case{activeCount === 1 ? "" : "s"} {activeCount === 1 ? "is" : "are"} currently not archived — worth a look.</strong>
        ) : "None on this page are currently active."}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder="Search client name, client number, or case type"
            className="h-10 w-full rounded-full border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
          />
        </label>
        <button
          type="button"
          onClick={() => load(search, page)}
          disabled={loading}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{pagination.total} total</span>
      </div>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      {loading && !cases.length ? (
        <div className="flex items-center justify-center rounded-3xl border border-slate-200 bg-white p-16 text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading imported cases…
        </div>
      ) : cases.length ? (
        <div className="space-y-3">
          <div className="space-y-2">{cases.map((item) => (
            <div key={item.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition hover:border-slate-300 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-slate-950">{item.client?.fullName || "Unknown client"}</p>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{item.client?.clientNumber}</span>
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">{item.caseType}</span>
                  {item.archivedAt ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      <ArchiveRestore className="h-3 w-3" /> Archived
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      Not archived — {item.status}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {item.stage} · {item.status} <span className="mx-1.5 text-slate-300">•</span>
                  Case Easy status: {item.caseEasyImportCases?.[0]?.status || "—"} <span className="mx-1.5 text-slate-300">•</span>
                  Updated {formatDate(item.updatedAt)}
                </p>
              </div>
              <Link
                to={`/app/clients/${item.client?.id}`}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
              >
                View client <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          ))}</div>
          {pagination.pages > 1 ? (
            <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
              <span>Page {pagination.page} of {pagination.pages}</span>
              <div className="flex gap-2">
                <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)} className="inline-flex h-9 items-center gap-1 rounded-full border border-slate-200 px-3 font-semibold text-slate-700 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /> Previous</button>
                <button type="button" disabled={page >= pagination.pages || loading} onClick={() => setPage((current) => current + 1)} className="inline-flex h-9 items-center gap-1 rounded-full border border-slate-200 px-3 font-semibold text-slate-700 disabled:opacity-40">Next <ChevronRight className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-3xl border border-slate-200 bg-white p-16 text-center text-sm text-slate-500">
          No cases have been converted from Case Easy yet.
        </div>
      )}
    </div>
  );
}
