import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  FileDown,
  Loader2,
  Send,
  Sparkles,
  UserRoundCheck,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";

const glass = "rounded-[1.9rem] border border-white/80 bg-white/95 shadow-[0_30px_90px_rgba(15,23,42,0.28)]";

// Who a field belongs to — shown as a permanent badge everywhere it
// appears, so "whose details go here" is never something a consultant has
// to remember. Matches the taxonomy from the design plan: Client fields
// come from the client record, Representative fields from whoever is
// picked below, Case fields from the case itself, Manual fields (like
// signatures or the top purpose selector) are always typed by a person.
const OWNER_META = {
  Client: { label: "Client", tone: "bg-sky-50 text-sky-700" },
  Representative: { label: "Representative", tone: "bg-violet-50 text-violet-700" },
  Case: { label: "Case", tone: "bg-amber-50 text-amber-800" },
  Manual: { label: "Manual", tone: "bg-slate-100 text-slate-600" },
};

const STATUS_META = {
  Unset: { label: "Missing", tone: "bg-rose-50 text-rose-700" },
  AutoFilled: { label: "Auto-filled", tone: "bg-emerald-50 text-emerald-700" },
  ConsultantEntered: { label: "You filled", tone: "bg-sky-50 text-sky-700" },
  ClientEntered: { label: "Client filled", tone: "bg-violet-50 text-violet-700" },
};

function FieldRow({ field, onSave, saving }) {
  const [draft, setDraft] = useState(field.value || "");
  useEffect(() => setDraft(field.value || ""), [field.value]);
  const statusMeta = STATUS_META[field.status] || STATUS_META.Unset;
  const ownerMeta = OWNER_META[field.owner] || OWNER_META.Manual;
  const dirty = draft !== (field.value || "");

  return (
    <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3.5 last:border-b-0 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 sm:w-60 sm:shrink-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-semibold text-slate-900">{field.label}</p>
          {field.isRequired ? <span className="text-rose-500">*</span> : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${ownerMeta.tone}`}>{ownerMeta.label}</span>
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${statusMeta.tone}`}>{statusMeta.label}</span>
        </div>
        {field.helpText ? <p className="mt-1 text-[10px] leading-4 text-slate-400">{field.helpText}</p> : null}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {field.fieldType === "Checkbox" ? (
          <button
            type="button"
            onClick={() => onSave(field.fieldKey, draft === "true" ? "false" : "true")}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition ${draft === "true" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-300"}`}
          >
            <Check className="h-4 w-4" />
          </button>
        ) : (
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => { if (dirty) onSave(field.fieldKey, draft); }}
            placeholder="Not filled in yet"
            className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-300 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
          />
        )}
        {saving === field.fieldKey ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" /> : null}
      </div>
    </div>
  );
}

export default function FormFieldChecklistOverlay({ item, caseId, onClose, onFormChanged, onOpenForm }) {
  const [checklist, setChecklist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingKey, setSavingKey] = useState("");
  const [autofilling, setAutofilling] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [representatives, setRepresentatives] = useState([]);
  const [applicants, setApplicants] = useState([]);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendSelection, setSendSelection] = useState(new Set());
  const [sendMessage, setSendMessage] = useState("");
  const [sendDueAt, setSendDueAt] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureMessage, setSignatureMessage] = useState("");
  const [signatureSending, setSignatureSending] = useState(false);
  const [representativeSaving, setRepresentativeSaving] = useState(false);
  const [currentItem, setCurrentItem] = useState(item);

  const isImm5476 = String(item.formNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "") === "IMM5476";

  async function load() {
    try {
      setLoading(true);
      setError("");
      const [checklistResponse, repsResponse, applicantsResponse] = await Promise.all([
        api.get(`/case-forms/${item.id}/checklist`),
        api.get("/case-forms/representative-options"),
        caseId ? api.get(`/cases/${caseId}/applicants`).catch(() => null) : Promise.resolve(null),
      ]);
      setChecklist(checklistResponse.data.data);
      setRepresentatives(repsResponse.data.data || []);
      setApplicants(applicantsResponse?.data?.data || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load the field checklist.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCurrentItem(item);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const sections = useMemo(() => {
    if (!checklist?.fields) return [];
    const groups = new Map();
    for (const field of checklist.fields) {
      const key = field.section || "Fields";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(field);
    }
    return [...groups.entries()];
  }, [checklist]);

  const sendableFields = useMemo(
    () => (checklist?.fields || []).filter((field) => field.fillableBy !== "Consultant" && field.fieldType !== "Signature" && field.status === "Unset"),
    [checklist],
  );

  async function saveField(fieldKey, value) {
    try {
      setSavingKey(fieldKey);
      const response = await api.patch(`/case-forms/${item.id}/checklist/fields/${encodeURIComponent(fieldKey)}`, { value });
      setChecklist((current) => ({
        ...current,
        fields: current.fields.map((field) => (field.fieldKey === fieldKey ? { ...field, value: response.data.data.value, status: response.data.data.status } : field)),
      }));
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to save this field.");
    } finally {
      setSavingKey("");
    }
  }

  async function runAutofill() {
    try {
      setAutofilling(true);
      setError("");
      await api.post(`/case-forms/${item.id}/checklist/autofill`);
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to run auto-fill.");
    } finally {
      setAutofilling(false);
    }
  }

  async function changeRepresentative(representativeUserId) {
    try {
      setRepresentativeSaving(true);
      setError("");
      const response = await api.patch(`/case-forms/${item.id}/representative`, { representativeUserId: representativeUserId || null });
      setCurrentItem((current) => ({ ...current, ...response.data.data }));
      await onFormChanged?.(response.data.data);
      await load();
      setNotice(representativeUserId ? "Representative selected. Open the form to apply their latest saved information." : "Representative removed from this form.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to set the representative.");
    } finally {
      setRepresentativeSaving(false);
    }
  }

  async function changeApplicant(applicantProfileId) {
    try {
      setError("");
      await api.patch(`/case-forms/${item.id}/applicant`, { applicantProfileId: applicantProfileId || null });
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to set the applicant.");
    }
  }

  async function generatePdf() {
    try {
      setGenerating(true);
      setError("");
      await api.post(`/case-forms/${item.id}/generate-pdf`);
      setNotice("Filled PDF generated — find it under Download Application.");
      onFormChanged?.();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to generate the filled PDF yet.");
    } finally {
      setGenerating(false);
    }
  }

  async function sendToClient() {
    try {
      setSending(true);
      setError("");
      await api.post(`/case-forms/${item.id}/client-requests`, {
        fieldKeys: [...sendSelection],
        message: sendMessage.trim() || undefined,
        dueAt: sendDueAt || undefined,
      });
      setSendOpen(false);
      setSendSelection(new Set());
      setSendMessage("");
      setSendDueAt("");
      setNotice("Sent to the client portal for them to complete.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to send this to the client.");
    } finally {
      setSending(false);
    }
  }

  async function sendSignatureRequest() {
    try {
      setSignatureSending(true);
      setError("");
      await api.post(`/case-forms/${item.id}/signature-requests`, {
        submissionChannel: "PortalOrSecureAccount",
        message: signatureMessage.trim() || undefined,
      });
      setSignatureOpen(false);
      setSignatureMessage("");
      setNotice("Secure draw-only signature request sent to the client portal.");
      onFormChanged?.();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to send the signature request.");
    } finally {
      setSignatureSending(false);
    }
  }

  const progress = checklist?.progress;

  return createPortal(
    <div className="fixed inset-0 z-[425] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-md">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close checklist" />
      <motion.section
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className={`relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden ${glass}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-600">
              <Sparkles className="h-3 w-3" />
              {isImm5476 ? "IMM 5476 setup" : "Auto-fill checklist"}
            </p>
            <h3 className="mt-1 truncate text-xl font-semibold tracking-tight text-slate-950">
              {item.formNumber ? `${item.formNumber} · ` : ""}
              {item.title}
            </h3>
            {progress && !isImm5476 ? (
              <p className="mt-1 text-sm text-slate-500">
                {progress.complete} of {progress.total} required fields complete
                {progress.totalAll > progress.total ? ` · ${progress.filledOfAll} of ${progress.totalAll} fields total` : ""}
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">
            <X className="h-4 w-4" />
          </button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60">
          {!loading && checklist ? (
            <div className="border-b border-slate-100 bg-white px-5 py-4">
              <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Representative on this form</label>
              <div className="relative mt-1.5 max-w-sm">
                <UserRoundCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select
                  value={checklist.representativeUserId || ""}
                  disabled={representativeSaving}
                  onChange={(event) => changeRepresentative(event.target.value)}
                  className="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-white py-0 pl-9 pr-9 text-sm font-medium text-slate-700 outline-none transition hover:border-slate-300 focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
                >
                  <option value="">{isImm5476 ? "Select a licensed representative" : "Case's assigned consultant (default)"}</option>
                  {representatives.map((user) => (
                    <option key={user.id} value={user.id}>{user.fullName} · {user.licenseNumber}{user.hasFormSignature ? " · signature saved" : " · signature needed"}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">This list is built from active staff profiles with a licence number. IMM 5476 never falls back to an unlicensed case assignee.</p>
            </div>
          ) : null}
          {loading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-2xl bg-white" />)}
            </div>
          ) : checklist?.available === false ? (
            <div className="px-6 py-14 text-center">
              {isImm5476 ? <CheckCircle2 className="mx-auto h-7 w-7 text-violet-500" /> : <AlertCircle className="mx-auto h-7 w-7 text-slate-300" />}
              <p className="mt-3 text-sm font-semibold text-slate-700">{isImm5476 ? (checklist.representativeUserId ? "Representative selected" : "Choose a representative") : "Checklist not available"}</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">{isImm5476
                ? checklist.representativeUserId
                  ? `${representatives.find((user) => user.id === checklist.representativeUserId)?.fullName || "The selected representative"} will be applied automatically when you open IMM 5476.`
                  : "Select an active licensed representative above. Their saved profile information will be applied when you open IMM 5476."
                : checklist.reason}</p>
            </div>
          ) : (
            <>
              {applicants.filter((applicant) => !applicant.isPrimary).length ? (
                <div className="border-b border-slate-100 bg-white px-5 py-4">
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Applicant this copy is for</label>
                  <div className="relative mt-1.5 max-w-sm">
                    <select
                      value={checklist.applicantProfileId || ""}
                      onChange={(event) => changeApplicant(event.target.value)}
                      className="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-white py-0 pl-3.5 pr-9 text-sm font-medium text-slate-700 outline-none transition hover:border-slate-300 focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
                    >
                      <option value="">{applicants.find((applicant) => applicant.isPrimary)?.fullName || "Principal applicant"} (default)</option>
                      {applicants.filter((applicant) => !applicant.isPrimary).map((applicant) => (
                        <option key={applicant.id} value={applicant.id}>{applicant.fullName} · {applicant.relationship || applicant.profileType}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-400">This case has more than one applicant — pick who the Client fields below belong to on this copy of the form.</p>
                </div>
              ) : null}

              {sections.map(([section, fields]) => (
                <div key={section} className="bg-white">
                  <p className="border-b border-slate-100 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{section}</p>
                  {fields.map((field) => (
                    <FieldRow key={field.fieldKey} field={field} onSave={saveField} saving={savingKey} />
                  ))}
                </div>
              ))}
            </>
          )}

          {error ? <p className="mx-5 my-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
          {notice ? <p className="mx-5 my-3 flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{notice}</p> : null}

          {sendOpen ? (
            <div className="mx-5 my-4 rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
              <p className="text-sm font-semibold text-slate-900">Send missing fields to the client</p>
              <p className="mt-1 text-xs text-slate-500">They'll see only these fields in their portal, in plain language.</p>
              <div className="mt-3 max-h-40 space-y-1.5 overflow-y-auto">
                {sendableFields.map((field) => (
                  <label key={field.fieldKey} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={sendSelection.has(field.fieldKey)}
                      onChange={() =>
                        setSendSelection((current) => {
                          const next = new Set(current);
                          if (next.has(field.fieldKey)) next.delete(field.fieldKey);
                          else next.add(field.fieldKey);
                          return next;
                        })
                      }
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {field.label}
                  </label>
                ))}
                {!sendableFields.length ? <p className="px-3 py-2 text-xs text-slate-400">Nothing left to send — every client-fillable field already has a value.</p> : null}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <input
                  value={sendMessage}
                  onChange={(event) => setSendMessage(event.target.value)}
                  placeholder="Optional note to the client"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-300"
                />
                <input
                  type="date"
                  value={sendDueAt}
                  onChange={(event) => setSendDueAt(event.target.value)}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-300"
                />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setSendOpen(false)} className="rounded-full px-4 py-2 text-xs font-semibold text-slate-600">Cancel</button>
                <button
                  type="button"
                  disabled={sending || !sendSelection.size}
                  onClick={sendToClient}
                  className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                  {sending ? "Sending…" : `Send ${sendSelection.size || ""}`}
                </button>
              </div>
            </div>
          ) : null}

          {signatureOpen ? (
            <div className="mx-5 my-4 rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
              <p className="text-sm font-semibold text-slate-900">Request the applicant's signature</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">The selected representative's saved signature is snapshotted now. The client sees only the declaration, consent checkbox and drawing pad; no PDF fields are editable.</p>
              <textarea value={signatureMessage} onChange={(event) => setSignatureMessage(event.target.value)} rows={3} placeholder="Optional note to the client" className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-300" />
              <p className="mt-2 text-[11px] leading-4 text-amber-700">Use this electronic flow only when the completed form will be submitted through an IRCC portal or secure account. Outside those channels, collect a wet signature.</p>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setSignatureOpen(false)} className="rounded-full px-4 py-2 text-xs font-semibold text-slate-600">Cancel</button>
                <button type="button" disabled={signatureSending || !checklist?.representativeUserId} onClick={sendSignatureRequest} className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"><Send className="h-3.5 w-3.5" />{signatureSending ? "Sending…" : "Send signature request"}</button>
              </div>
            </div>
          ) : null}
        </main>

        {isImm5476 && checklist?.available === false ? (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4">
            <button type="button" onClick={onClose} className="rounded-full bg-slate-950 px-5 py-2.5 text-xs font-semibold text-white">Done</button>
            {onOpenForm ? (
              <button
                type="button"
                onClick={() => onOpenForm(currentItem)}
                disabled={representativeSaving || !checklist?.representativeUserId || !currentItem?.storageKey}
                className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                <FileDown className="h-3.5 w-3.5" />
                Open form
              </button>
            ) : null}
          </footer>
        ) : <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={runAutofill}
            disabled={autofilling || checklist?.available === false}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-40"
          >
            <Sparkles className="h-3.5 w-3.5 text-violet-500" />
            {autofilling ? "Filling…" : "Run auto-fill"}
          </button>
          <div className="flex items-center gap-2">
            {!sendOpen ? (
              <button
                type="button"
                onClick={() => setSendOpen(true)}
                disabled={checklist?.available === false}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" />
                Send to client
              </button>
            ) : null}
            {isImm5476 && !signatureOpen ? (
              <button type="button" onClick={() => setSignatureOpen(true)} disabled={checklist?.available === false || !checklist?.representativeUserId} className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-4 py-2.5 text-xs font-semibold text-violet-700 disabled:opacity-40"><UserRoundCheck className="h-3.5 w-3.5" />Request signature</button>
            ) : null}
            <button
              type="button"
              onClick={generatePdf}
              disabled={generating || checklist?.available === false || (progress && progress.complete < progress.total)}
              title={progress && progress.complete < progress.total ? "Complete every required field first" : "Generate the filled PDF"}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              <FileDown className="h-3.5 w-3.5" />
              {generating ? "Generating…" : "Generate filled PDF"}
            </button>
          </div>
        </footer>}
      </motion.section>
    </div>,
    document.body,
  );
}
