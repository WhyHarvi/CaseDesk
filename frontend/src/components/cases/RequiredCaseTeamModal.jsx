import { BriefcaseBusiness, Loader2, ShieldCheck, UserRoundCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { registerRequiredCaseTeamPrompt } from "../../services/caseRequiredTeamGate";

function cancelledError() {
  const error = new Error("Case creation cancelled.");
  error.code = "CASE_TEAM_CANCELLED";
  return error;
}

export default function RequiredCaseTeamModal() {
  const [pending, setPending] = useState(null);
  const [rcicUserId, setRcicUserId] = useState("");
  const [caseWorkerUserId, setCaseWorkerUserId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => registerRequiredCaseTeamPrompt((request) => new Promise((resolve, reject) => {
    const options = request.options || {};
    const existingOwner = String(request.payload?.assignedUserId || "");
    const ownerIsRcic = (options.rcicUsers || []).some((user) => user.id === existingOwner);
    setPending({ request, resolve, reject });
    setRcicUserId(ownerIsRcic ? existingOwner : (options.rcicUsers || []).length === 1 ? options.rcicUsers[0].id : "");
    setCaseWorkerUserId((options.caseWorkerUsers || []).length === 1 ? options.caseWorkerUsers[0].id : "");
    setError("");
  })), []);

  const options = pending?.request?.options || {};
  const caseType = pending?.request?.payload?.caseType || "New case";
  const clientName = pending?.request?.clientName || "Client";
  const missing = options.missing || [];
  const ready = options.ready !== false && !missing.length;
  const selectedRcic = useMemo(() => (options.rcicUsers || []).find((user) => user.id === rcicUserId), [options.rcicUsers, rcicUserId]);
  const selectedCaseWorker = useMemo(() => (options.caseWorkerUsers || []).find((user) => user.id === caseWorkerUserId), [options.caseWorkerUsers, caseWorkerUserId]);

  if (!pending) return null;

  function cancel() {
    pending.reject(cancelledError());
    setPending(null);
    setError("");
  }

  function submit(event) {
    event.preventDefault();
    if (!ready) {
      setError(`Set up at least one active ${missing.join(" and ")} team member before creating a case.`);
      return;
    }
    if (!rcicUserId) {
      setError("Choose the RCIC responsible for this case.");
      return;
    }
    if (!caseWorkerUserId) {
      setError("Choose the Case Worker responsible for this case.");
      return;
    }
    pending.resolve({ rcicUserId, caseWorkerUserId });
    setPending(null);
    setError("");
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[850] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <button type="button" onClick={cancel} className="absolute inset-0 cursor-default" aria-label="Cancel case creation" />
      <form onSubmit={submit} className="relative z-10 w-full max-w-xl overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_32px_110px_rgba(15,23,42,0.32)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 ring-1 ring-violet-100">
              <BriefcaseBusiness className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-600">Required case team</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">Assign RCIC and Case Worker</h2>
              <p className="mt-1 truncate text-sm text-slate-500">{clientName} · {caseType}</p>
            </div>
          </div>
          <button type="button" onClick={cancel} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <main className="space-y-5 px-6 py-6">
          {!ready ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
              <strong>Team setup required.</strong> No active {missing.join(" / ")} candidate is available. An administrator must assign the corresponding team role to a staff member before a new case can be created.
            </div>
          ) : null}

          <label className="block rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
            <span className="flex items-center gap-2 text-sm font-semibold text-violet-950">
              <ShieldCheck className="h-4 w-4 text-violet-600" /> RCIC <span className="text-rose-500">*</span>
            </span>
            <span className="mt-1 block text-xs leading-5 text-violet-700">The regulated representative responsible for the immigration file. This person becomes the primary case owner in CaseDesk.</span>
            <select
              value={rcicUserId}
              onChange={(event) => { setRcicUserId(event.target.value); setError(""); }}
              disabled={!ready}
              className="mt-3 h-12 w-full rounded-xl border border-violet-200 bg-white px-4 text-sm font-medium text-slate-900 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100 disabled:bg-slate-100"
            >
              <option value="">Choose RCIC</option>
              {(options.rcicUsers || []).map((user) => <option key={user.id} value={user.id}>{user.fullName}{user.licenseNumber ? ` · ${user.licenseNumber}` : ""}</option>)}
            </select>
            {selectedRcic ? <span className="mt-2 block text-xs text-violet-700">Selected: {selectedRcic.fullName}</span> : null}
          </label>

          <label className="block rounded-2xl border border-sky-100 bg-sky-50/60 p-4">
            <span className="flex items-center gap-2 text-sm font-semibold text-sky-950">
              <UserRoundCheck className="h-4 w-4 text-sky-600" /> Case Worker <span className="text-rose-500">*</span>
            </span>
            <span className="mt-1 block text-xs leading-5 text-sky-700">The person doing the day-to-day file work. They receive case collaboration access automatically.</span>
            <select
              value={caseWorkerUserId}
              onChange={(event) => { setCaseWorkerUserId(event.target.value); setError(""); }}
              disabled={!ready}
              className="mt-3 h-12 w-full rounded-xl border border-sky-200 bg-white px-4 text-sm font-medium text-slate-900 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 disabled:bg-slate-100"
            >
              <option value="">Choose Case Worker</option>
              {(options.caseWorkerUsers || []).map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
            </select>
            {selectedCaseWorker ? <span className="mt-2 block text-xs text-sky-700">Selected: {selectedCaseWorker.fullName}</span> : null}
          </label>

          <p className="rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
            RCIC and Case Worker are mandatory on every new case. The same person may hold both roles only if that staff member is eligible for both roles.
          </p>

          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div> : null}
        </main>

        <footer className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <button type="button" onClick={cancel} className="h-11 rounded-xl px-5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100">Cancel</button>
          <button type="submit" disabled={!ready} className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
            {ready ? <UserRoundCheck className="h-4 w-4" /> : <Loader2 className="h-4 w-4" />}
            Continue creating case
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
