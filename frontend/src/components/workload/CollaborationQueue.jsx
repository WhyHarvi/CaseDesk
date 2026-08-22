import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Handshake, Loader2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Avatar } from "./workloadVisuals";
import api from "../../services/api";

const glass = "rounded-[1.6rem] border border-white/70 bg-white/70 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl";
const spring = { type: "spring", stiffness: 320, damping: 30 };
function cx(...classes) { return classes.filter(Boolean).join(" "); }

const ROLE_LABEL = { primary: "primary owner", supporting: "supporting", reviewer: "reviewer" };

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(new Date(value));
}

function DeclineForm({ onConfirm, onCancel, busy }) {
  const [note, setNote] = useState("");
  return (
    <div className="mt-2 flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Reason (optional)" className="h-8 flex-1 rounded-full border border-slate-200 px-3 text-xs outline-none focus:border-rose-300" />
      <button type="button" disabled={busy} onClick={() => onConfirm(note)} className="h-8 shrink-0 rounded-full bg-rose-600 px-3 text-xs font-semibold text-white disabled:opacity-60">Confirm</button>
      <button type="button" onClick={onCancel} className="text-xs font-semibold text-slate-400 hover:text-slate-600">Cancel</button>
    </div>
  );
}

// Admin-side queue for the consultant self-service "request to join a
// case" workflow — only pending requests need attention here, so it
// disappears entirely once the queue is empty rather than sitting around
// as another permanently-quiet card.
export default function CollaborationQueue({ onGranted }) {
  const [requests, setRequests] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [decliningId, setDecliningId] = useState(null);

  async function reload() {
    const response = await api.get("/cases/access-requests/review");
    setRequests(response.data.data);
  }

  useEffect(() => { reload(); }, []);

  async function approve(item) {
    setBusyId(item.id);
    try {
      await api.post(`/cases/${item.case.id}/access-requests/${item.id}/approve`);
      await reload();
      onGranted?.();
    } finally {
      setBusyId(null);
    }
  }

  async function decline(item, reviewNote) {
    setBusyId(item.id);
    try {
      await api.post(`/cases/${item.case.id}/access-requests/${item.id}/decline`, { reviewNote });
      setDecliningId(null);
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  if (requests === null) return null;
  if (!requests.length) return null;

  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={spring} className={cx(glass, "min-w-0 overflow-hidden p-5 sm:p-6")}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-100">
          <Handshake className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-950">Case access requests</h2>
          <p className="text-xs text-slate-500">{requests.length} consultant{requests.length === 1 ? "" : "s"} asking to join a case</p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <AnimatePresence initial={false}>
          {requests.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              className="rounded-2xl border border-slate-100 p-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <Avatar id={item.requestedBy.id} fullName={item.requestedBy.fullName} size={30} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {item.requestedBy.fullName} wants to be <span className="font-semibold">{ROLE_LABEL[item.requestedRole] || item.requestedRole}</span> on{" "}
                      <Link to={`/app/cases/${item.case?.id}`} className="text-sky-700 hover:underline">{item.case?.client?.fullName || "this case"}</Link>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{item.case?.caseType} · currently owned by {item.case?.owner?.fullName || "Unassigned"} · asked {formatDate(item.createdAt)}</p>
                    {item.note ? <p className="mt-1 text-xs italic text-slate-500">"{item.note}"</p> : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => approve(item)}
                    className="flex h-8 items-center gap-1 rounded-full bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {busyId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Grant
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecliningId(decliningId === item.id ? null : item.id)}
                    className="flex h-8 items-center gap-1 rounded-full border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:text-rose-600"
                  >
                    <X className="h-3.5 w-3.5" /> Decline
                  </button>
                </div>
              </div>
              {decliningId === item.id ? <DeclineForm busy={busyId === item.id} onCancel={() => setDecliningId(null)} onConfirm={(note) => decline(item, note)} /> : null}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
