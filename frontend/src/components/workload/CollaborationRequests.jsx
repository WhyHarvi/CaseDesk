import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Handshake, Loader2, Search, X } from "lucide-react";
import { Link } from "react-router-dom";
import api from "../../services/api";

const glass = "rounded-[1.6rem] border border-white/70 bg-white/70 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl";
const spring = { type: "spring", stiffness: 320, damping: 30 };
function cx(...classes) { return classes.filter(Boolean).join(" "); }

const ROLE_LABEL = { primary: "Take ownership", supporting: "Support", reviewer: "Review" };
const STATUS_TONE = {
  Pending: "bg-amber-50 text-amber-700 ring-amber-100",
  Approved: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  Declined: "bg-rose-50 text-rose-700 ring-rose-100",
  Withdrawn: "bg-slate-100 text-slate-500 ring-slate-200",
};

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(new Date(value));
}

function RequestForm({ item, onSubmit, onCancel }) {
  const [role, setRole] = useState("supporting");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="overflow-hidden"
    >
      <div className="mt-3 space-y-2.5 rounded-2xl border border-sky-100 bg-sky-50/50 p-3.5" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2">
          {["supporting", "reviewer", "primary"].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRole(value)}
              className={cx("h-7 rounded-full px-3 text-[11px] font-semibold transition", role === value ? "bg-slate-950 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}
            >
              {ROLE_LABEL[value]}
            </button>
          ))}
        </div>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Why this case? (optional, admin sees this)"
          rows={2}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onSubmit(item.id, role, note);
              } catch (requestError) {
                setError(requestError.response?.data?.message || "Couldn't send that request.");
                setBusy(false);
              }
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-sky-600 px-3.5 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Handshake className="h-3.5 w-3.5" />}
            Send request
          </button>
          <button type="button" onClick={onCancel} className="text-xs font-semibold text-slate-400 hover:text-slate-600">Cancel</button>
          {error ? <span className="text-[11px] text-rose-600">{error}</span> : null}
        </div>
      </div>
    </motion.div>
  );
}

function OpenCaseRow({ item, requesting, onToggleForm, onSubmit }) {
  return (
    <div className="rounded-2xl border border-slate-100 p-3.5 transition hover:border-sky-200 hover:bg-sky-50/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{item.client?.fullName || "Unnamed client"}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{item.caseType} · {item.stage} · owned by {item.owner?.fullName || "Unassigned"}</p>
          <p className="mt-1 text-[11px] text-slate-400">Last touched {formatDate(item.updatedAt)}{item.collaboratorCount ? ` · ${item.collaboratorCount} collaborator${item.collaboratorCount === 1 ? "" : "s"}` : ""}</p>
        </div>
        <div className="shrink-0 text-right">
          {item.hasPendingRequest ? (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-100">Request pending</span>
          ) : (
            <button type="button" onClick={() => onToggleForm(item.id)} className="inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 transition hover:border-sky-300 hover:text-sky-700">
              Request to join
            </button>
          )}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {requesting ? <RequestForm item={item} onSubmit={onSubmit} onCancel={() => onToggleForm(null)} /> : null}
      </AnimatePresence>
    </div>
  );
}

// Consultant self-service ask to join a case (Team Workload plan Phase 4).
// Browse tab shows cases this person doesn't already have access to,
// oldest-touched first — a lightly loaded consultant looking for work
// should see what's going stale, not whatever was edited five minutes ago.
export default function CollaborationRequests() {
  const [tab, setTab] = useState("browse");
  const [openCases, setOpenCases] = useState(null);
  const [myRequests, setMyRequests] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [caseType, setCaseType] = useState("");
  const [openFormId, setOpenFormId] = useState(null);
  const [toast, setToast] = useState("");

  async function reload() {
    setLoading(true);
    const [casesRes, requestsRes] = await Promise.all([
      api.get("/consultants/me/open-cases"),
      api.get("/consultants/me/collaboration-requests"),
    ]);
    setOpenCases(casesRes.data.data);
    setMyRequests(requestsRes.data.data);
    setLoading(false);
  }

  useEffect(() => { reload(); }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const caseTypes = useMemo(() => [...new Set((openCases || []).map((item) => item.caseType))].sort(), [openCases]);
  const visibleCases = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (openCases || []).filter((item) => {
      if (caseType && item.caseType !== caseType) return false;
      if (!needle) return true;
      return [item.client?.fullName, item.caseType, item.owner?.fullName].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [openCases, query, caseType]);

  const pendingCount = (myRequests || []).filter((item) => item.status === "Pending").length;

  async function submitRequest(caseId, requestedRole, note) {
    await api.post("/consultants/me/collaboration-requests", { caseId, requestedRole, note });
    setOpenFormId(null);
    setToast("Request sent to your admin team.");
    reload();
  }

  async function withdraw(id) {
    await api.delete(`/consultants/me/collaboration-requests/${id}`);
    reload();
  }

  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={spring} className={cx(glass, "min-w-0 overflow-hidden p-5 sm:p-6")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-50 text-sky-600 ring-1 ring-sky-100">
            <Handshake className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-950">Pick up more work</h2>
            <p className="text-xs text-slate-500">Ask to join a case an admin owns — they'll grant or decline it.</p>
          </div>
        </div>
        <div className="flex gap-1 rounded-full bg-slate-100 p-1">
          <button type="button" onClick={() => setTab("browse")} className={cx("h-8 rounded-full px-3.5 text-xs font-semibold transition", tab === "browse" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>Browse cases</button>
          <button type="button" onClick={() => setTab("mine")} className={cx("h-8 rounded-full px-3.5 text-xs font-semibold transition", tab === "mine" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>
            My requests{pendingCount ? ` (${pendingCount})` : ""}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {toast ? (
          <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
            {toast}
          </motion.p>
        ) : null}
      </AnimatePresence>

      {loading ? (
        <div className="flex h-32 items-center justify-center text-sm text-slate-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…</div>
      ) : tab === "browse" ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <label className="relative flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search cases" className="w-full rounded-full border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
            </label>
            {caseTypes.length ? (
              <select value={caseType} onChange={(event) => setCaseType(event.target.value)} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 outline-none focus:border-sky-400">
                <option value="">All case types</option>
                {caseTypes.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            ) : null}
          </div>
          {!visibleCases.length ? (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">
              {openCases?.length ? "No cases match your search." : "You already have access to every open case — nothing to browse."}
            </p>
          ) : (
            <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
              {visibleCases.map((item) => (
                <OpenCaseRow key={item.id} item={item} requesting={openFormId === item.id} onToggleForm={setOpenFormId} onSubmit={submitRequest} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {!myRequests?.length ? (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">You haven't requested to join any cases yet.</p>
          ) : (
            myRequests.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 p-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link to={`/app/cases/${item.case?.id}`} className="truncate text-sm font-semibold text-slate-900 hover:underline">{item.case?.client?.fullName || "Case"}</Link>
                    <span className={cx("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1", STATUS_TONE[item.status])}>{item.status}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{item.case?.caseType} · asked to {ROLE_LABEL[item.requestedRole] || item.requestedRole} · {formatDate(item.createdAt)}</p>
                  {item.note ? <p className="mt-1 text-xs italic text-slate-500">"{item.note}"</p> : null}
                  {item.reviewNote ? <p className="mt-1 text-xs text-slate-500">Admin note: {item.reviewNote}</p> : null}
                </div>
                {item.status === "Pending" ? (
                  <button type="button" onClick={() => withdraw(item.id)} className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-500 transition hover:border-rose-200 hover:text-rose-600">
                    <X className="h-3 w-3" /> Withdraw
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}
    </motion.section>
  );
}
