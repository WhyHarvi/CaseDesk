import { AlertTriangle, CheckCircle2, FilePlus2, Send, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { registerCaseLifecyclePrompt } from "../../services/caseLifecycleGate";

function dateValue(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function cancelledError() {
  const error = new Error("Case lifecycle update cancelled.");
  error.code = "CASE_LIFECYCLE_CANCELLED";
  return error;
}

export default function CaseLifecycleModal() {
  const [pending, setPending] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => registerCaseLifecyclePrompt((request) => new Promise((resolve, reject) => {
    const decision = request.current?.decision || null;
    setPending({ request, resolve, reject });
    setForm({
      submittedAt: dateValue(request.payload?.submittedAt || request.current?.submittedAt) || new Date().toISOString().slice(0, 10),
      decisionAt: dateValue(request.payload?.decisionAt || request.current?.decisionAt || decision?.decisionDate) || new Date().toISOString().slice(0, 10),
      decisionOutcome: decision?.decisionOutcome || "",
      permitExpiryAt: dateValue(decision?.permitExpiryDate),
      refusalResolution: decision?.refusalResolution || "",
      newCaseType: "",
    });
    setError("");
  })), []);

  const isDecision = pending?.request?.stage === "Decision Received";
  const currentCaseType = pending?.request?.current?.caseType || pending?.request?.payload?.caseType || "Current case";
  const newCaseOptions = useMemo(
    () => (pending?.request?.caseTypes || []).filter((type) => String(type).trim().toLowerCase() !== String(currentCaseType).trim().toLowerCase()),
    [pending?.request?.caseTypes, currentCaseType],
  );

  if (!pending || !form) return null;

  function update(name, value) {
    setForm((current) => {
      const next = { ...current, [name]: value };
      if (name === "decisionOutcome") {
        if (value === "APPROVED") {
          next.refusalResolution = "";
          next.newCaseType = "";
        } else if (value === "REFUSED") {
          next.permitExpiryAt = "";
        }
      }
      if (name === "refusalResolution" && value !== "NEW_CASE") next.newCaseType = "";
      return next;
    });
    setError("");
  }

  function cancel() {
    pending.reject(cancelledError());
    setPending(null);
    setForm(null);
    setError("");
  }

  function submit(event) {
    event.preventDefault();
    if (!form.submittedAt) {
      setError("Submitted date is required.");
      return;
    }
    if (isDecision) {
      if (!form.decisionOutcome) {
        setError("Choose Approved or Refused.");
        return;
      }
      if (!form.decisionAt) {
        setError("Decision date is required.");
        return;
      }
      if (form.decisionAt < form.submittedAt) {
        setError("Decision date cannot be earlier than the submitted date.");
        return;
      }
      if (form.decisionOutcome === "APPROVED") {
        if (!form.permitExpiryAt) {
          setError("Permit / status expiry date is required for an approval.");
          return;
        }
        if (form.permitExpiryAt < form.decisionAt) {
          setError("Permit / status expiry cannot be earlier than the decision date.");
          return;
        }
      }
      if (form.decisionOutcome === "REFUSED") {
        if (!form.refusalResolution) {
          setError("Choose what happens after the refusal.");
          return;
        }
        if (form.refusalResolution === "NEW_CASE" && !form.newCaseType) {
          setError("Choose the new case type.");
          return;
        }
      }
    }

    pending.resolve({
      submittedAt: form.submittedAt,
      ...(isDecision ? {
        decisionAt: form.decisionAt,
        decisionOutcome: form.decisionOutcome,
        permitExpiryAt: form.decisionOutcome === "APPROVED" ? form.permitExpiryAt : null,
        refusalResolution: form.decisionOutcome === "REFUSED" ? form.refusalResolution : null,
        newCaseType: form.decisionOutcome === "REFUSED" && form.refusalResolution === "NEW_CASE" ? form.newCaseType : null,
      } : {}),
    });
    setPending(null);
    setForm(null);
    setError("");
  }

  return createPortal(
    <div className="fixed inset-0 z-[800] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <button type="button" className="absolute inset-0 cursor-default" onClick={cancel} aria-label="Cancel lifecycle update" />
      <form onSubmit={submit} className="relative z-10 max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[2rem] border border-white/80 bg-white p-6 shadow-[0_28px_100px_rgba(15,23,42,0.30)] sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600">
              {isDecision ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
              Application lifecycle
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
              {isDecision ? "Record immigration decision" : "Mark application submitted"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{currentCaseType}</p>
          </div>
          <button type="button" onClick={cancel} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900" aria-label="Close">
            <XCircle className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 space-y-5">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Submitted date <span className="text-rose-500">*</span></span>
            <input type="date" required value={form.submittedAt} onChange={(event) => update("submittedAt", event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-brand-300 focus:ring-4 focus:ring-brand-100" />
          </label>

          {isDecision ? (
            <>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Decision date <span className="text-rose-500">*</span></span>
                <input type="date" required value={form.decisionAt} onChange={(event) => update("decisionAt", event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-brand-300 focus:ring-4 focus:ring-brand-100" />
              </label>

              <div>
                <span className="mb-2 block text-sm font-semibold text-slate-700">IRCC decision <span className="text-rose-500">*</span></span>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button type="button" onClick={() => update("decisionOutcome", "APPROVED")} className={`rounded-2xl border p-4 text-left transition ${form.decisionOutcome === "APPROVED" ? "border-emerald-300 bg-emerald-50 ring-2 ring-emerald-100" : "border-slate-200 hover:border-emerald-200"}`}>
                    <div className="flex items-center gap-2 font-semibold text-slate-900"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Approved</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Application was approved. Record the new permit/status expiry.</p>
                  </button>
                  <button type="button" onClick={() => update("decisionOutcome", "REFUSED")} className={`rounded-2xl border p-4 text-left transition ${form.decisionOutcome === "REFUSED" ? "border-rose-300 bg-rose-50 ring-2 ring-rose-100" : "border-slate-200 hover:border-rose-200"}`}>
                    <div className="flex items-center gap-2 font-semibold text-slate-900"><XCircle className="h-4 w-4 text-rose-600" />Refused</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Application was refused. Decide whether to open another file or close this matter.</p>
                  </button>
                </div>
              </div>

              {form.decisionOutcome === "APPROVED" ? (
                <label className="block rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                  <span className="mb-2 block text-sm font-semibold text-emerald-900">Permit / status expiry date <span className="text-rose-500">*</span></span>
                  <input type="date" required value={form.permitExpiryAt} onChange={(event) => update("permitExpiryAt", event.target.value)} className="h-12 w-full rounded-xl border border-emerald-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
                  <span className="mt-2 block text-xs leading-5 text-emerald-800">This becomes the new source for the Leads → Permit expiry outreach queue.</span>
                </label>
              ) : null}

              {form.decisionOutcome === "REFUSED" ? (
                <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                    <div>
                      <p className="text-sm font-semibold text-rose-900">Refusal review</p>
                      <p className="mt-1 text-xs leading-5 text-rose-700">Choose the next file action. The refused case remains part of the permanent audit history.</p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2">
                    <button type="button" onClick={() => update("refusalResolution", "NEW_CASE")} className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${form.refusalResolution === "NEW_CASE" ? "border-brand-300 bg-white ring-2 ring-brand-100" : "border-rose-100 bg-white/70"}`}>
                      <FilePlus2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                      <span><strong className="block text-sm text-slate-900">Start another case</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">Reuse the client profile, case information, assessment data and linked applicants in a new case type.</span></span>
                    </button>
                    <button type="button" onClick={() => update("refusalResolution", "CLOSE_FILE")} className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${form.refusalResolution === "CLOSE_FILE" ? "border-slate-400 bg-white ring-2 ring-slate-100" : "border-rose-100 bg-white/70"}`}>
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
                      <span><strong className="block text-sm text-slate-900">Close file permanently</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">Close this matter without creating a successor case. History stays retained.</span></span>
                    </button>
                  </div>

                  {form.refusalResolution === "NEW_CASE" ? (
                    <label className="mt-4 block">
                      <span className="mb-2 block text-sm font-semibold text-slate-700">New case type <span className="text-rose-500">*</span></span>
                      <select required value={form.newCaseType} onChange={(event) => update("newCaseType", event.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-brand-300 focus:ring-4 focus:ring-brand-100">
                        <option value="">Choose case type</option>
                        {newCaseOptions.map((type) => <option key={type} value={type}>{type}</option>)}
                      </select>
                      {!newCaseOptions.length ? <span className="mt-2 block text-xs text-rose-600">No other configured case types are available.</span> : null}
                    </label>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-800">
              The submitted date becomes part of the permanent case timeline. A decision cannot be recorded later without it.
            </div>
          )}
        </div>

        {error ? <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div> : null}

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-5">
          <button type="button" onClick={cancel} className="h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">Cancel</button>
          <button type="submit" className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800">
            {isDecision ? "Record decision" : "Mark submitted"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
