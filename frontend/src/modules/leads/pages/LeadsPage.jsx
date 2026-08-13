import { ArrowDownUp, CalendarRange, ChevronLeft, ChevronRight, CircleDot, CirclePlus, ClipboardCheck, FilterX, Layers3, Loader2, Megaphone, Search, SlidersHorizontal, UserRoundSearch } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../../../services/api";
import { useAuth } from "../../../auth/AuthContext";
import QuickAddLeadSheet from "../components/QuickAddLeadSheet";
import LeadFilterMenu from "../components/LeadFilterMenu";
import LeadDetailSheet from "../components/LeadDetailSheet";
import LeadTransferApprovalDrawer from "../components/LeadTransferApprovalDrawer";
import BulkReassignLeadsModal from "../components/BulkReassignLeadsModal";
import { formatDueDate, humanize, initials, leadName, LEAD_STAGES, LEAD_STATUSES, PAYMENT_READY_VALUES, RETAINER_READY_VALUES, statusTone } from "../leadPresentation";

function ListSkeleton() {
  return <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-[72px] animate-pulse rounded-xl bg-slate-100" />)}</div>;
}

function SelectAllCheckbox({ checked, indeterminate, onChange }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200" aria-label="Select all leads on this page" />;
}

const SEGMENT_COPY = {
  STANDARD: {
    eyebrow: "Lead management",
    title: "Leads",
    description: "Every inquiry, one owner, one next action.",
    emptyTitle: "No leads yet",
    emptyDescription: "Capture the first inquiry with Quick Add.",
  },
  IMPORT_REVIEW: {
    eyebrow: "Needs cleanup before it rejoins the pipeline",
    title: "Import Review",
    description: "Bulk-imported leads awaiting contact and cleanup. Fix a record, then promote it back into the active pipeline.",
    emptyTitle: "Nothing left to review",
    emptyDescription: "Every imported lead has been promoted back into the active pipeline.",
  },
};

export default function LeadsPage({ segment = "STANDARD" }) {
  const { role } = useAuth();
  const copy = SEGMENT_COPY[segment] || SEGMENT_COPY.STANDARD;
  const [params, setParams] = useSearchParams();
  const [leads, setLeads] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 25, total: 0 });
  const [sources, setSources] = useState([]);
  const [staff, setStaff] = useState([]);
  const [immigrationInterests, setImmigrationInterests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchDraft, setSearchDraft] = useState(params.get("search") || "");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [supportingDataError, setSupportingDataError] = useState("");
  const [selectedLead, setSelectedLead] = useState(null);
  const requestedLeadId = params.get("lead") || "";
  const canBulkPromote = segment === "IMPORT_REVIEW";
  const canBulkReassign = segment === "STANDARD" && role === "admin";
  const canBulkSelect = canBulkPromote || canBulkReassign;
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkPromoting, setBulkPromoting] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [transferRequests, setTransferRequests] = useState([]);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [transferBusyId, setTransferBusyId] = useState("");
  const [transferDrawerOpen, setTransferDrawerOpen] = useState(false);

  // segment is a route-level prop (which sidebar page you're on), not a
  // user-toggleable filter, so it rides along on every fetch without ever
  // going into the URL's own searchParams.
  const queryString = useMemo(() => {
    const merged = new URLSearchParams(params);
    if (segment !== "STANDARD") merged.set("segment", segment);
    return merged.toString();
  }, [params, segment]);
  const updateParams = useCallback((changes) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
      if (!("page" in changes)) next.delete("page");
      return next;
    });
  }, [setParams]);

  const loadLeads = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get(`/leads${queryString ? `?${queryString}` : ""}`);
      setLeads(response.data.data);
      setMeta(response.data.meta);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Leads could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => { loadLeads(); }, [loadLeads]);
  // Selection is page/filter-scoped — leaving it around after the visible
  // set changes would let someone "promote" a lead they can no longer see.
  useEffect(() => { setSelectedIds(new Set()); setBulkResult(null); }, [leads]);
  useEffect(() => {
    if (!requestedLeadId || selectedLead?.id === requestedLeadId) return;
    let active = true;
    api.get(`/leads/${encodeURIComponent(requestedLeadId)}`)
      .then((response) => {
        if (active) setSelectedLead(response.data.data);
      })
      .catch(() => {
        if (active) {
          setParams((current) => {
            const next = new URLSearchParams(current);
            next.delete("lead");
            return next;
          }, { replace: true });
        }
      });
    return () => {
      active = false;
    };
  }, [requestedLeadId, selectedLead?.id, setParams]);
  useEffect(() => {
    Promise.all([api.get("/leads/sources"), api.get("/leads/staff")])
      .then(([sourceResponse, staffResponse]) => {
        setSources(sourceResponse.data.data);
        setStaff(staffResponse.data.data);
        setSupportingDataError("");
      })
      .catch((requestError) => setSupportingDataError(requestError.response?.data?.message || "Lead sources and employees could not be loaded."));
  }, []);

  const loadTransferRequests = useCallback(async () => {
    if (role !== "admin" || segment !== "STANDARD") return;
    try {
      setTransferLoading(true);
      const response = await api.get("/leads/transfer-requests?status=PENDING");
      setTransferRequests(response.data.data || []);
      setTransferError("");
    } catch (requestError) {
      setTransferError(requestError.response?.data?.message || "Lead transfer approvals could not be loaded.");
    } finally {
      setTransferLoading(false);
    }
  }, [role, segment]);

  useEffect(() => {
    loadTransferRequests();
    if (role !== "admin" || segment !== "STANDARD") return undefined;
    const interval = window.setInterval(loadTransferRequests, 30_000);
    window.addEventListener("focus", loadTransferRequests);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", loadTransferRequests);
    };
  }, [loadTransferRequests, role, segment]);
  useEffect(() => {
    api
      .get("/leads/immigration-interests")
      .then((response) => setImmigrationInterests(response.data.data || []))
      .catch(() => setImmigrationInterests([]));
  }, []);

  const pageCount = Math.max(Math.ceil(meta.total / meta.limit), 1);
  const hasFilters = ["search", "status", "stage", "sourceId", "month"].some((key) => params.get(key));
  const range = useMemo(() => meta.total ? `${(meta.page - 1) * meta.limit + 1}–${Math.min(meta.page * meta.limit, meta.total)} of ${meta.total}` : "0 leads", [meta]);

  // Last 18 months plus the current one — comfortably covers both imported
  // historical data and normal day-to-day use without a bare date input
  // that would look inconsistent next to the other dropdown filters.
  const monthOptions = useMemo(() => {
    const options = [];
    const cursor = new Date();
    cursor.setDate(1);
    for (let i = 0; i < 19; i++) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth() + 1;
      options.push({ value: `${year}-${String(month).padStart(2, "0")}`, label: cursor.toLocaleDateString("en-CA", { month: "long", year: "numeric" }) });
      cursor.setMonth(cursor.getMonth() - 1);
    }
    return options;
  }, []);

  const monthWise = (params.get("sortBy") || "createdAt") === "inquiryDate";
  const groupedLeads = useMemo(() => {
    if (!monthWise) return [{ key: null, label: null, items: leads }];
    const groups = [];
    let current = null;
    for (const lead of leads) {
      const date = new Date(lead.inquiryDate);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      if (!current || current.key !== key) {
        current = { key, label: date.toLocaleDateString("en-CA", { month: "long", year: "numeric" }), items: [] };
        groups.push(current);
      }
      current.items.push(lead);
    }
    return groups;
  }, [leads, monthWise]);

  function submitSearch(event) {
    event.preventDefault();
    updateParams({ search: searchDraft.trim() });
  }

  function clearFilters() {
    setSearchDraft("");
    setParams({});
  }

  function toggleSelected(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((current) => (current.size === leads.length ? new Set() : new Set(leads.map((lead) => lead.id))));
  }

  async function promoteSelected() {
    if (!selectedIds.size) return;
    try {
      setBulkPromoting(true);
      setBulkResult(null);
      const response = await api.post("/leads/promote-bulk", { leadIds: [...selectedIds] });
      setBulkResult(response.data.data);
      setSelectedIds(new Set());
      loadLeads();
    } catch (requestError) {
      setBulkResult({ promoted: [], skipped: [], error: requestError.response?.data?.message || "Leads could not be promoted." });
    } finally {
      setBulkPromoting(false);
    }
  }

  function handleReassigned(result) {
    setReassignModalOpen(false);
    setBulkResult({ reassigned: result.reassigned, skipped: result.skipped });
    setSelectedIds(new Set());
    loadLeads();
  }

  async function reviewTransfer(request, decision) {
    try {
      setTransferBusyId(request.id);
      setTransferError("");
      const response = await api.post(`/leads/transfer-requests/${request.id}/${decision}`);
      setTransferRequests((current) => current.filter((item) => item.id !== request.id));
      if (decision === "approve") {
        const updatedLead = response.data.data?.lead;
        if (updatedLead) setSelectedLead((current) => current?.id === updatedLead.id ? { ...current, ...updatedLead } : current);
        await loadLeads();
      }
    } catch (requestError) {
      setTransferError(requestError.response?.data?.message || `Transfer could not be ${decision === "approve" ? "approved" : "rejected"}.`);
      await loadTransferRequests();
    } finally {
      setTransferBusyId("");
    }
  }

  return (
    <section className="space-y-5 pb-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">{copy.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-slate-950">{copy.title}</h1>
          <p className="mt-1.5 max-w-xl text-sm text-slate-500">{copy.description}</p>
        </div>
        {segment === "STANDARD" ? <div className="flex flex-wrap items-center gap-2">{role === "admin" ? <button type="button" onClick={() => setTransferDrawerOpen(true)} className="relative inline-flex h-11 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:text-brand-700"><ClipboardCheck className="h-4 w-4" />Transfers{transferLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : transferRequests.length ? <span className="min-w-5 rounded-full bg-brand-600 px-1.5 py-0.5 text-center text-[10px] font-bold text-white">{transferRequests.length}</span> : null}</button> : null}<button type="button" disabled={Boolean(supportingDataError) || !sources.length || !staff.length} onClick={() => setQuickAddOpen(true)} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-brand-600 px-5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(73,104,149,0.24)] transition hover:-translate-y-0.5 hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"><CirclePlus className="h-4 w-4" />Quick add</button></div> : null}
      </header>

      {supportingDataError ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{supportingDataError} Refresh the page before adding a lead.</div> : null}

      <div className="overflow-visible rounded-3xl border border-white/80 bg-white/80 shadow-[0_18px_55px_rgba(28,45,74,0.10)] backdrop-blur-xl">
        <div className="rounded-t-3xl border-b border-slate-200/70 bg-gradient-to-b from-white/90 to-slate-50/75 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <form onSubmit={submitSearch} className="relative min-w-[260px] flex-1">
              <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
              <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} className="h-11 w-full rounded-2xl border border-slate-200/90 bg-white/90 pl-11 pr-24 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-100" placeholder="Search name, lead number, phone, or email" />
              <button type="submit" className="absolute right-1.5 top-1.5 h-8 rounded-xl bg-slate-900 px-3.5 text-xs font-semibold text-white transition hover:bg-slate-700">Search</button>
            </form>
            <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-nowrap">
              <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400"><SlidersHorizontal className="h-3.5 w-3.5" />Filters</span>
              <LeadFilterMenu label="Status" value={params.get("status") || ""} options={LEAD_STATUSES.map((item) => ({ value: item, label: humanize(item) }))} onChange={(status) => updateParams({ status })} icon={CircleDot} allLabel="All except converted" />
              <LeadFilterMenu label="Stage" value={params.get("stage") || ""} options={LEAD_STAGES.map((item) => ({ value: item, label: humanize(item) }))} onChange={(stage) => updateParams({ stage })} icon={Layers3} allLabel="All stages" />
              <LeadFilterMenu label="Source" value={params.get("sourceId") || ""} options={sources.map((source) => ({ value: source.id, label: source.name }))} onChange={(sourceId) => updateParams({ sourceId })} icon={Megaphone} allLabel="All sources" />
              <LeadFilterMenu label="Month" value={params.get("month") || ""} options={monthOptions} onChange={(month) => updateParams({ month })} icon={CalendarRange} allLabel="All time" />
              <LeadFilterMenu label="Sort" value={`${params.get("sortBy") || "createdAt"}:${params.get("sortDirection") || "desc"}`} options={[{ value: "createdAt:desc", label: "Newest first" }, { value: "createdAt:asc", label: "Oldest first" }, { value: "nextActionAt:asc", label: "Next action" }, { value: "leadNumber:asc", label: "Lead number" }, { value: "inquiryDate:desc", label: "Month wise (newest)" }, { value: "inquiryDate:asc", label: "Month wise (oldest)" }]} onChange={(value) => { const [sortBy, sortDirection] = value.split(":"); updateParams({ sortBy, sortDirection }); }} icon={ArrowDownUp} allLabel="Newest first" />
              {hasFilters ? <button type="button" onClick={clearFilters} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"><FilterX className="h-3.5 w-3.5" />Reset</button> : null}
            </div>
          </div>
        </div>

        {canBulkSelect && selectedIds.size > 0 ? (
          <div className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3">
            <p className="text-sm font-semibold text-brand-900">{selectedIds.size} lead{selectedIds.size === 1 ? "" : "s"} selected</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setSelectedIds(new Set())} className="text-xs font-semibold text-brand-700 hover:underline">Clear</button>
              {canBulkPromote ? <button type="button" disabled={bulkPromoting} onClick={promoteSelected} className="inline-flex h-9 items-center justify-center rounded-full bg-brand-600 px-4 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60">{bulkPromoting ? "Promoting…" : `Promote ${selectedIds.size} to pipeline`}</button> : null}
              {canBulkReassign ? <button type="button" onClick={() => setReassignModalOpen(true)} className="inline-flex h-9 items-center justify-center rounded-full bg-brand-600 px-4 text-xs font-semibold text-white transition hover:bg-brand-700">{`Reassign ${selectedIds.size} lead${selectedIds.size === 1 ? "" : "s"}`}</button> : null}
            </div>
          </div>
        ) : null}
        {bulkResult ? (
          <div className={`mx-4 mt-4 rounded-xl border px-4 py-3 text-sm ${bulkResult.error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
            {bulkResult.error ? bulkResult.error : bulkResult.reassigned ? (
              <>
                <p className="font-semibold">{bulkResult.reassigned.length} lead{bulkResult.reassigned.length === 1 ? "" : "s"} reassigned.</p>
                {bulkResult.skipped.length ? <p className="mt-1 text-xs text-emerald-800">{bulkResult.skipped.length} skipped (see below for reasons).</p> : null}
              </>
            ) : (
              <>
                <p className="font-semibold">{bulkResult.promoted.length} lead{bulkResult.promoted.length === 1 ? "" : "s"} promoted to the active pipeline.</p>
                {bulkResult.skipped.length ? <p className="mt-1 text-xs text-emerald-800">{bulkResult.skipped.length} skipped (already promoted or no longer accessible).</p> : null}
              </>
            )}
            <button type="button" onClick={() => setBulkResult(null)} className="mt-1.5 text-xs font-semibold underline">Dismiss</button>
          </div>
        ) : null}

        {error ? <div className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><p>{error}</p><button type="button" onClick={loadLeads} className="mt-2 font-semibold">Try again</button></div> : null}
        {loading ? <ListSkeleton /> : !leads.length ? (
          <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><UserRoundSearch className="h-5 w-5" /></div><h2 className="mt-4 text-base font-semibold text-slate-900">{hasFilters ? "No matching leads" : copy.emptyTitle}</h2><p className="mt-1 max-w-sm text-sm text-slate-500">{hasFilters ? "Adjust or clear the filters to see more results." : copy.emptyDescription}</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead><tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{canBulkSelect ? <th className="w-10 px-5 py-3"><SelectAllCheckbox checked={selectedIds.size > 0 && selectedIds.size === leads.length} indeterminate={selectedIds.size > 0 && selectedIds.size < leads.length} onChange={toggleSelectAll} /></th> : null}<th className="px-5 py-3">Lead</th><th className="px-4 py-3">Source and interest</th><th className="px-4 py-3">Progress</th><th className="px-4 py-3">Owner</th><th className="px-4 py-3">Next action</th></tr></thead>
              <tbody>{groupedLeads.map((group) => (
                <Fragment key={group.key ?? "all"}>
                  {group.label ? <tr><td colSpan={canBulkSelect ? 6 : 5} className="bg-slate-100/80 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{group.label} · {group.items.length} lead{group.items.length === 1 ? "" : "s"}</td></tr> : null}
                  {group.items.map((lead) => { const due = formatDueDate(lead.nextActionAt); const blockedOnConversion = lead.status === "OPEN" && lead.stage === "READY_TO_CONVERT" && !(RETAINER_READY_VALUES.includes(lead.retainerStatus) && PAYMENT_READY_VALUES.includes(lead.initialPaymentStatus)); return <tr key={lead.id} role="button" tabIndex={0} onClick={() => setSelectedLead(lead)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedLead(lead); } }} className="cursor-pointer border-b border-slate-100 text-sm outline-none transition last:border-0 hover:bg-brand-50/45 focus:bg-brand-50/70">
                    {canBulkSelect ? <td className="px-5 py-4" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedIds.has(lead.id)} onChange={() => toggleSelected(lead.id)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200" aria-label={`Select ${leadName(lead)}`} /></td> : null}
                    <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{initials(lead)}</div><div><p className="font-semibold text-slate-900">{leadName(lead)}</p><p className="mt-0.5 text-xs text-slate-400">{lead.leadNumber} · {lead.phone}</p></div></div></td>
                    <td className="px-4 py-4"><p className="font-medium text-slate-700">{lead.originalSource?.name || "Unknown source"}</p><p className="mt-0.5 max-w-[190px] truncate text-xs text-slate-400">{lead.immigrationInterest || "Interest not specified"}</p></td>
                    <td className="px-4 py-4"><div className="flex items-center gap-2"><span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${statusTone[lead.status] || statusTone.ARCHIVED}`}>{humanize(lead.status)}</span><span className="text-xs font-medium text-slate-600">{humanize(lead.stage)}</span>{blockedOnConversion ? <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-100" title="Ready to Convert, but retainer or payment isn't confirmed yet">Blocked</span> : null}</div><p className="mt-1.5 text-xs text-slate-400">{humanize(lead.temperature)} · {humanize(lead.priority)}</p></td>
                    <td className="px-4 py-4"><p className="text-slate-700">{lead.owner?.fullName || "Unassigned"}</p></td>
                    <td className="px-4 py-4"><p className="max-w-[190px] truncate font-medium text-slate-700">{lead.nextActionDescription || "No next action"}</p><p className={`mt-0.5 text-xs ${due.overdue && lead.status === "OPEN" ? "font-semibold text-rose-600" : "text-slate-400"}`}>{due.overdue && lead.status === "OPEN" ? "Overdue · " : ""}{due.label}</p></td>
                  </tr>; })}
                </Fragment>
              ))}</tbody>
            </table>
          </div>
        )}

        <footer className="flex items-center justify-between rounded-b-3xl border-t border-slate-200/80 bg-slate-50/60 px-4 py-3 text-sm text-slate-500">
          <span>{range}</span><div className="flex items-center gap-2"><button type="button" disabled={meta.page <= 1 || loading} onClick={() => updateParams({ page: String(meta.page - 1) })} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button><span className="min-w-20 text-center text-xs font-medium">Page {meta.page} of {pageCount}</span><button type="button" disabled={meta.page >= pageCount || loading} onClick={() => updateParams({ page: String(meta.page + 1) })} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button></div>
        </footer>
      </div>

      <QuickAddLeadSheet open={quickAddOpen} sources={sources} staff={staff} immigrationInterests={immigrationInterests} onClose={() => setQuickAddOpen(false)} onCreated={() => { setQuickAddOpen(false); setParams({}); loadLeads(); }} />
      <LeadTransferApprovalDrawer open={transferDrawerOpen} requests={transferRequests} loading={transferLoading} error={transferError} busyId={transferBusyId} onClose={() => setTransferDrawerOpen(false)} onReload={loadTransferRequests} onReview={reviewTransfer} />
      <BulkReassignLeadsModal open={reassignModalOpen} leadCount={selectedIds.size} leadIds={[...selectedIds]} staff={staff} onClose={() => setReassignModalOpen(false)} onDone={handleReassigned} />
      {selectedLead ? <LeadDetailSheet lead={selectedLead} staff={staff} onClose={() => {
        setSelectedLead(null);
        if (requestedLeadId) {
          setParams((current) => {
            const next = new URLSearchParams(current);
            next.delete("lead");
            return next;
          }, { replace: true });
        }
      }} onChanged={loadLeads} /> : null}
    </section>
  );
}
