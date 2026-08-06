import {
  AlertCircle,
  Ban,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileWarning,
  FilterX,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import AppointmentProfileOverlay from "../components/appointments/AppointmentProfileOverlay";
import { fadingHighlightClass, useFadingHighlight } from "../hooks/useFadingHighlight";
import api from "../services/api";

const recoveryDelaysMs = [1_000, 2_500, 5_000, 10_000, 30_000];
const completionOutcomes = [
  "Client contacted",
  "No answer",
  "Documents received",
  "Payment promised",
  "New follow-up required",
  "Other",
];
const followUpTypes = ["General follow-up", "Client call", "Document request", "Payment reminder", "Case review"];
const leadFollowUpTypes = ["PHONE_CALL", "EMAIL", "SMS", "WHATSAPP", "MEETING", "DOCUMENT_REQUEST", "OTHER"];
const priorities = ["High", "Medium", "Low"];
const views = [
  ["my_open", "My Open"],
  ["team_open", "Team Open"],
  ["unassigned", "Unassigned"],
  ["all", "All"],
];
const fieldClass = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100 disabled:bg-slate-50 disabled:text-slate-400";
const areaClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100";

function emptyForm(userId = "") {
  return {
    clientId: "",
    caseId: "",
    originalCaseId: "",
    documentId: "",
    caseInvoiceId: "",
    assignedUserId: userId,
    followUpType: "General follow-up",
    title: "",
    description: "",
    dueAt: "",
    reminderAt: "",
    expiresAt: "",
    priority: "Medium",
    notificationChannels: ["in_app"],
    notifyClient: false,
    overrideReason: "",
  };
}

function localInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nextLeadFollowUpForm(item, userId = "") {
  return {
    assignedUserId: item?.assignedUserId || userId,
    type: "PHONE_CALL",
    description: "",
    dueAt: localInput(new Date(Date.now() + 24 * 60 * 60_000)),
  };
}

function dateTime(value, timezone) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "America/Toronto",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function initials(value) {
  return String(value || "Client").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function sourceName(item) {
  return item.source === "lead" ? `Lead ${item.lead?.leadNumber || ""}`.trim() : item.case?.caseType || "Client follow-up";
}

function statusTone(status) {
  if (status === "Overdue") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "Completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "Cancelled") return "border-slate-200 bg-slate-100 text-slate-600";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function priorityTone(priority) {
  if (priority === "High") return "bg-rose-50 text-rose-700";
  if (priority === "Low") return "bg-slate-100 text-slate-600";
  return "bg-amber-50 text-amber-700";
}

function csvValue(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  const tone = toast.type === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700";
  return <div className={`fixed right-5 top-5 z-[90] flex max-w-sm items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-medium shadow-xl ${tone}`}><span>{toast.message}</span><button type="button" onClick={onClose} aria-label="Dismiss"><X className="h-4 w-4" /></button></div>;
}

function Modal({ title, children, onClose, onSubmit, submitLabel, saving, danger = false }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-sm">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close" />
      <form onSubmit={onSubmit} className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between"><h2 className="text-xl font-semibold text-slate-950">{title}</h2><button type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="mt-5">{children}</div>
        <div className="mt-6 grid grid-cols-2 gap-3"><button type="button" onClick={onClose} className="h-11 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700">Keep open</button><button type="submit" disabled={saving} className={`h-11 rounded-xl text-sm font-semibold text-white disabled:opacity-60 ${danger ? "bg-rose-600" : "bg-slate-950"}`}>{saving ? "Saving…" : submitLabel}</button></div>
      </form>
    </div>
  );
}

function Drawer({ form, setForm, options, editing, onClose, onSubmit, saving, error }) {
  const cases = form.clientId ? options.cases.filter((item) => item.client?.id === form.clientId) : [];
  const documents = options.documents.filter((item) => (!form.clientId || item.clientId === form.clientId) && (!form.caseId || !item.caseId || item.caseId === form.caseId));
  const invoices = options.invoices.filter((item) => (!form.clientId || item.clientId === form.clientId) && (!form.caseId || item.caseId === form.caseId));
  const selectedCase = options.cases.find((item) => item.id === form.caseId);
  const change = (event) => {
    const { name, value, checked, type } = event.target;
    setForm((current) => {
      if (name === "clientId") return { ...current, clientId: value, caseId: "", documentId: "", caseInvoiceId: "", overrideReason: "" };
      if (name === "caseId") {
        const item = options.cases.find((entry) => entry.id === value);
        return { ...current, caseId: value, clientId: item?.client?.id || current.clientId, documentId: "", caseInvoiceId: "", overrideReason: "" };
      }
      return { ...current, [name]: type === "checkbox" ? checked : value };
    });
  };
  const toggleChannel = (channel) => setForm((current) => ({
    ...current,
    notificationChannels: current.notificationChannels.includes(channel)
      ? current.notificationChannels.filter((item) => item !== channel)
      : [...current.notificationChannels, channel],
  }));
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-slate-950/20 backdrop-blur-sm">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close" />
      <aside className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><p className="text-xs font-bold uppercase tracking-wide text-sky-700">Case workflow</p><h2 className="mt-1 text-xl font-semibold text-slate-950">{editing ? "Edit follow-up" : "New follow-up"}</h2></div><button type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <form id="follow-up-form" onSubmit={onSubmit} className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Client {editing?.appointmentId ? null : <b className="text-rose-500">*</b>}</span><select required={!editing?.appointmentId} name="clientId" value={form.clientId} onChange={change} className={fieldClass}><option value="">{editing?.appointmentId ? "Appointment visitor (not yet a client)" : "Select client"}</option>{options.clients.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Case</span><select name="caseId" value={form.caseId} onChange={change} disabled={!form.clientId} className={fieldClass}><option value="">No linked case</option>{cases.map((item) => <option key={item.id} value={item.id}>{item.caseType}{item.archivedAt ? " · Archived" : ""}</option>)}</select></label>
          {selectedCase?.archivedAt && (!editing || form.originalCaseId !== form.caseId) ? <label className="block rounded-2xl border border-amber-200 bg-amber-50 p-4"><span className="mb-2 block text-sm font-semibold text-amber-900">Archived-case override reason <b className="text-rose-500">*</b></span><textarea required name="overrideReason" value={form.overrideReason} onChange={change} rows={2} className={areaClass} placeholder="Explain why new work is required on this archived case." /></label> : null}
          <div className="grid gap-4 sm:grid-cols-2"><label><span className="mb-2 block text-sm font-medium text-slate-700">Document</span><select name="documentId" value={form.documentId} onChange={change} className={fieldClass}><option value="">No linked document</option>{documents.map((item) => <option key={item.id} value={item.id}>{item.documentName} · {item.status}</option>)}</select></label><label><span className="mb-2 block text-sm font-medium text-slate-700">Invoice</span><select name="caseInvoiceId" value={form.caseInvoiceId} onChange={change} className={fieldClass}><option value="">No linked invoice</option>{invoices.map((item) => <option key={item.id} value={item.id}>{item.description} · {item.status}</option>)}</select></label></div>
          <div className="grid gap-4 sm:grid-cols-2"><label><span className="mb-2 block text-sm font-medium text-slate-700">Type</span><select name="followUpType" value={form.followUpType} onChange={change} className={fieldClass}>{followUpTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label><span className="mb-2 block text-sm font-medium text-slate-700">Priority</span><select name="priority" value={form.priority} onChange={change} className={fieldClass}>{priorities.map((item) => <option key={item}>{item}</option>)}</select></label></div>
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Title <b className="text-rose-500">*</b></span><input required name="title" value={form.title} onChange={change} className={fieldClass} placeholder="What needs to happen next?" /></label>
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Notes</span><textarea name="description" value={form.description} onChange={change} rows={4} className={areaClass} placeholder="Add useful context for the assignee." /></label>
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Assigned staff</span><select name="assignedUserId" value={form.assignedUserId} onChange={change} className={fieldClass}><option value="">Unassigned</option>{options.users.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>
          <div className="grid gap-4 sm:grid-cols-2"><label><span className="mb-2 block text-sm font-medium text-slate-700">Due</span><input type="datetime-local" name="dueAt" value={form.dueAt} onChange={change} className={fieldClass} /></label><label><span className="mb-2 block text-sm font-medium text-slate-700">Staff reminder</span><input type="datetime-local" name="reminderAt" value={form.reminderAt} onChange={change} className={fieldClass} /></label></div>
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Expires</span><input type="datetime-local" name="expiresAt" value={form.expiresAt} onChange={change} className={fieldClass} /></label>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><label className="flex items-center gap-3 text-sm font-semibold text-slate-800"><input type="checkbox" name="notifyClient" checked={form.notifyClient} onChange={change} className="h-4 w-4 rounded border-slate-300" />Notify the client</label><div className="mt-3 flex flex-wrap gap-4">{[["in_app", "Portal"], ["email", "Email"], ["sms", "SMS"]].map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={form.notificationChannels.includes(value)} onChange={() => toggleChannel(value)} disabled={!form.notifyClient && value !== "in_app"} className="h-4 w-4 rounded border-slate-300" />{label}</label>)}</div><p className="mt-3 text-xs leading-5 text-slate-500">Direct email is sent only when recorded email consent exists. SMS uses the existing consent controls.</p></div>
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        </form>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 px-6 py-5"><button type="button" onClick={onClose} className="h-11 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700">Cancel</button><button type="submit" form="follow-up-form" disabled={saving} className="h-11 rounded-xl bg-slate-950 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Saving…" : editing ? "Save changes" : "Create follow-up"}</button></div>
      </aside>
    </div>
  );
}

function FollowUpCard({ item, timezone, highlighted, onEdit, onComplete, onCancel, onAppointment }) {
  const name = item.client?.fullName || item.case?.client?.fullName || "Unknown client";
  const actor = item.status === "Completed" ? item.completedBy : item.status === "Cancelled" ? item.cancelledBy : null;
  const reason = item.status === "Completed" ? item.completionOutcome : item.status === "Cancelled" ? item.cancellationReason : null;
  return (
    <article id={`followup-row-${item.id}`} className={`rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:border-sky-200 hover:shadow-md ${fadingHighlightClass(highlighted)}`}>
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center">
        <div className="flex min-w-0 flex-1 gap-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sm font-bold text-sky-700">{initials(name)}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-950">{item.title}</h3><span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusTone(item.status)}`}>{item.status}</span><span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">{item.source === "lead" ? "Lead" : "Case"}</span></div><p className="mt-1 text-sm text-slate-600">{name} · {sourceName(item)}</p>{item.description ? <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-500">{item.description}</p> : null}<div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500"><span className={`rounded-md px-2 py-1 font-semibold ${priorityTone(item.priority)}`}>{item.priority}</span><span className="rounded-md bg-slate-100 px-2 py-1">{item.followUpType}</span>{item.document ? <span className="rounded-md bg-violet-50 px-2 py-1 text-violet-700">Document: {item.document.documentName}</span> : null}{item.caseInvoice ? <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">Invoice: {item.caseInvoice.description}</span> : null}</div>{reason ? <p className="mt-3 text-xs text-slate-500"><b>{item.status === "Completed" ? "Outcome" : "Cancellation"}:</b> {reason}{actor?.fullName ? ` · ${actor.fullName}` : ""}</p> : null}</div></div>
        <div className="grid shrink-0 gap-3 sm:grid-cols-2 xl:w-[430px]"><div className="rounded-2xl bg-slate-50 p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Due</p><p className={`mt-1 text-sm font-semibold ${item.status === "Overdue" ? "text-rose-700" : "text-slate-800"}`}>{dateTime(item.dueDate, timezone)}</p><p className="mt-1 text-xs text-slate-500">{item.assignedUser?.fullName || "Unassigned"}</p></div><div className="flex flex-wrap content-center justify-end gap-2"><Link to={item.openUrl} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-700"><ExternalLink className="h-3.5 w-3.5" />Open</Link>{item.appointment ? <button type="button" onClick={() => onAppointment(item.appointment.id)} className="h-9 rounded-xl border border-violet-200 px-3 text-xs font-semibold text-violet-700">Appointment</button> : null}{item.canEdit && !["Completed", "Cancelled"].includes(item.status) ? <><button type="button" onClick={() => onComplete(item)} className="h-9 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white">Complete</button>{item.source === "case" ? <button type="button" onClick={() => onEdit(item)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600" aria-label="Edit"><Pencil className="h-4 w-4" /></button> : null}<button type="button" onClick={() => onCancel(item)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-rose-200 text-rose-600" aria-label="Cancel"><Ban className="h-4 w-4" /></button></> : null}</div></div>
      </div>
    </article>
  );
}

export default function FollowUps() {
  const { appUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 25, total: 0, uniqueClients: 0, summary: {} });
  const [options, setOptions] = useState({ clients: [], cases: [], users: [], documents: [], invoices: [], timezone: "America/Toronto" });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(() => emptyForm(appUser?.id));
  const [formError, setFormError] = useState("");
  const [action, setAction] = useState(null);
  const [actionValue, setActionValue] = useState("");
  const [nextLeadFollowUp, setNextLeadFollowUp] = useState(() => nextLeadFollowUpForm(null, appUser?.id));
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [appointmentId, setAppointmentId] = useState(null);
  const recoveryTimerRef = useRef(null);
  const recoveryAttemptRef = useRef(0);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const highlightId = searchParams.get("highlight") || "";
  const view = searchParams.get("view") || "my_open";
  const page = Math.max(Number(searchParams.get("page")) || 1, 1);

  const setQuery = useCallback((patch, resetPage = true) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(patch).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
      if (resetPage) next.delete("page");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (searchInput !== (searchParams.get("search") || "")) setQuery({ search: searchInput.trim() });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput, searchParams, setQuery]);

  const load = useCallback(async ({ quiet = false, recovery = false } = {}) => {
    const generation = ++generationRef.current;
    if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current);
    try {
      quiet || recovery ? setRefreshing(true) : setLoading(true);
      const get = quiet || recovery ? api.getFresh : api.get;
      const params = Object.fromEntries(searchParams.entries());
      params.view = params.view || "my_open";
      params.page = params.page || 1;
      params.limit = 25;
      const [listResponse, optionsResponse] = await Promise.all([
        get("/follow-ups/combined", { params }),
        get("/follow-ups/options"),
      ]);
      if (!mountedRef.current || generation !== generationRef.current) return;
      setItems(listResponse.data.data || []);
      setMeta(listResponse.data.meta || {});
      setOptions(optionsResponse.data.data || {});
      setError("");
      recoveryAttemptRef.current = 0;
    } catch (requestError) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      const delay = recoveryDelaysMs[Math.min(recoveryAttemptRef.current, recoveryDelaysMs.length - 1)];
      recoveryAttemptRef.current += 1;
      setError(`${requestError.response?.data?.message || "Unable to load follow-ups."} Retrying automatically…`);
      recoveryTimerRef.current = window.setTimeout(() => void load({ quiet: true, recovery: true }), delay);
    } finally {
      if (mountedRef.current && generation === generationRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [searchParams]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => { mountedRef.current = false; if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current); };
  }, [load]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const activeHighlightId = useFadingHighlight(highlightId, { domIdPrefix: "followup-row-", ready: !loading, deps: [items] });
  const summary = meta.summary || {};
  const selectedCase = options.cases?.find((item) => item.id === form.caseId);

  function openCreate() {
    setForm(emptyForm(appUser?.id));
    setFormError("");
    setDrawer("create");
  }

  function openEdit(item) {
    setForm({
      clientId: item.clientId || item.client?.id || item.case?.client?.id || "",
      caseId: item.caseId || item.case?.id || "",
      originalCaseId: item.caseId || item.case?.id || "",
      documentId: item.documentId || "",
      caseInvoiceId: item.caseInvoiceId || "",
      assignedUserId: item.assignedUserId || "",
      followUpType: item.followUpType || "General follow-up",
      title: item.title || "",
      description: item.description || "",
      dueAt: localInput(item.dueDate),
      reminderAt: localInput(item.reminderAt),
      expiresAt: localInput(item.expiresAt),
      priority: item.priority || "Medium",
      notificationChannels: item.notificationChannels?.length ? item.notificationChannels : ["in_app"],
      notifyClient: Boolean(item.notifyClient),
      overrideReason: "",
    });
    setFormError("");
    setDrawer(item);
  }

  async function saveFollowUp(event) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        clientId: form.clientId,
        caseId: form.caseId || null,
        documentId: form.documentId || null,
        caseInvoiceId: form.caseInvoiceId || null,
        assignedUserId: form.assignedUserId || null,
        followUpType: form.followUpType,
        title: form.title.trim(),
        description: form.description.trim() || null,
        dueDate: iso(form.dueAt),
        reminderAt: iso(form.reminderAt),
        expiresAt: iso(form.expiresAt),
        priority: form.priority,
        notificationChannels: form.notificationChannels,
        notifyClient: form.notifyClient,
        ...(selectedCase?.archivedAt && (drawer === "create" || form.originalCaseId !== form.caseId) ? { overrideReason: form.overrideReason.trim() } : {}),
      };
      if (drawer === "create") await api.post("/follow-ups", payload);
      else await api.patch(`/follow-ups/${drawer.id}`, payload);
      setDrawer(null);
      await load({ quiet: true });
      setToast({ type: "success", message: `Follow-up ${drawer === "create" ? "created" : "updated"}.` });
    } catch (requestError) {
      setFormError(requestError.response?.data?.message || "Unable to save follow-up.");
    } finally { setSaving(false); }
  }

  async function submitAction(event) {
    event.preventDefault();
    if (!actionValue.trim()) return;
    setSaving(true);
    try {
      if (action.kind === "complete") {
        if (action.item.source === "lead") {
          await api.patch(`/leads/${action.item.leadId}/follow-ups/${action.item.id}`, {
            status: "COMPLETED",
            completionOutcome: actionValue,
            ...(action.item.requiresNextFollowUp
              ? {
                  nextFollowUp: {
                    ...nextLeadFollowUp,
                    dueAt: iso(nextLeadFollowUp.dueAt),
                  },
                }
              : {}),
          });
        } else {
          await api.patch(`/follow-ups/${action.item.id}`, { status: "Completed", completionOutcome: actionValue });
        }
      } else if (action.item.source === "lead") {
        await api.patch(`/leads/${action.item.leadId}/follow-ups/${action.item.id}`, {
          status: "CANCELLED",
          completionOutcome: actionValue.trim(),
          ...(action.item.requiresNextFollowUp
            ? { nextFollowUp: { ...nextLeadFollowUp, dueAt: iso(nextLeadFollowUp.dueAt) } }
            : {}),
        });
      } else {
        await api.patch(`/follow-ups/${action.item.id}/cancel`, { cancellationReason: actionValue.trim() });
      }
      setAction(null);
      setActionValue("");
      await load({ quiet: true });
      setToast({ type: "success", message: action.kind === "complete" ? "Follow-up completed." : "Follow-up cancelled." });
    } catch (requestError) {
      // A case follow-up update is committed before its auxiliary notification
      // cleanup runs. Older/backlogged deployments can therefore return a 500
      // after the requested state was saved. Re-read the record before telling
      // staff the action failed, so they never retry an already-completed item.
      if (action.item.source === "case" && requestError.response?.status >= 500) {
        try {
          const response = await api.getFresh(`/follow-ups/${action.item.id}`);
          const expectedStatus = action.kind === "complete" ? "Completed" : "Cancelled";
          if (response.data?.data?.status === expectedStatus) {
            setAction(null);
            setActionValue("");
            await load({ quiet: true });
            setToast({
              type: "success",
              message: action.kind === "complete" ? "Follow-up completed." : "Follow-up cancelled.",
            });
            return;
          }
        } catch {
          // Keep the original server error if reconciliation cannot confirm
          // that the requested workflow state was saved.
        }
      }
      setToast({ type: "error", message: requestError.response?.data?.message || "Unable to update follow-up." });
    } finally { setSaving(false); }
  }

  function exportCsv() {
    const rows = [["Source", "Client or lead", "Case / lead", "Title", "Status", "Priority", "Due", "Assigned", "Outcome / reason", "Created by", "Completed / cancelled by"]];
    items.forEach((item) => rows.push([
      item.source,
      item.client?.fullName,
      sourceName(item),
      item.title,
      item.status,
      item.priority,
      dateTime(item.dueDate, meta.timezone),
      item.assignedUser?.fullName,
      item.completionOutcome || item.cancellationReason,
      item.createdBy?.fullName,
      item.completedBy?.fullName || item.cancelledBy?.fullName,
    ]));
    const blob = new Blob([rows.map((row) => row.map(csvValue).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `follow-ups-page-${page}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const filtersActive = ["status", "source", "assignedUserId", "priority", "type", "from", "to", "search"].some((key) => searchParams.get(key));
  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <section className="min-h-[calc(100vh-32px)] bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,.12),transparent_28%),linear-gradient(180deg,#f8fbff,#eef4fb)] px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-[1660px] space-y-5">
          <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-wide text-sky-700">Shared work queue</p><h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Follow-ups</h1><p className="mt-2 text-sm text-slate-600">Lead and case follow-ups in one accountable queue.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={openCreate} className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white"><Plus className="h-4 w-4" />New follow-up</button><button type="button" onClick={exportCsv} disabled={!items.length} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-50"><Download className="h-4 w-4" />Export page</button><button type="button" onClick={() => load({ quiet: true })} className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700" aria-label="Refresh"><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /></button></div></header>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[[CalendarClock, "Due today", summary.dueToday || 0, "bg-sky-50 text-sky-700"], [AlertCircle, "Overdue", summary.overdue || 0, "bg-rose-50 text-rose-700"], [ClipboardCheck, "Pending", summary.pending || 0, "bg-amber-50 text-amber-700"], [CheckCircle2, "Completed this week", summary.completedThisWeek || 0, "bg-emerald-50 text-emerald-700"], [FileWarning, "Clients missing docs", summary.missingDocumentClients || 0, "bg-violet-50 text-violet-700"]].map(([Icon, label, value, tone]) => <div key={label} className="rounded-2xl border border-white bg-white/90 p-4 shadow-sm"><div className="flex items-center gap-3"><span className={`rounded-xl p-2 ${tone}`}><Icon className="h-5 w-5" /></span><div><p className="text-xs font-semibold text-slate-500">{label}</p><p className="text-2xl font-semibold text-slate-950">{value}</p></div></div></div>)}</div>

          <section className="rounded-3xl border border-white bg-white/90 p-4 shadow-sm">
            <div className="flex flex-wrap gap-2">{views.map(([value, label]) => <button key={value} type="button" onClick={() => setQuery({ view: value })} className={`rounded-full px-4 py-2 text-sm font-semibold ${view === value ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-700"}`}>{label}</button>)}</div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6"><label className="relative xl:col-span-2"><Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search client, lead, case, title…" className={`${fieldClass} pl-10`} /></label><select value={searchParams.get("status") || ""} onChange={(event) => setQuery({ status: event.target.value })} className={fieldClass}><option value="">Any status</option>{["Pending", "Overdue", "Completed", "Cancelled"].map((item) => <option key={item}>{item}</option>)}</select><select value={searchParams.get("source") || ""} onChange={(event) => setQuery({ source: event.target.value })} className={fieldClass}><option value="">Leads + cases</option><option value="lead">Leads only</option><option value="case">Cases only</option></select><select value={searchParams.get("assignedUserId") || ""} onChange={(event) => setQuery({ assignedUserId: event.target.value })} className={fieldClass}><option value="">Any assignee</option>{options.users?.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select><select value={searchParams.get("priority") || ""} onChange={(event) => setQuery({ priority: event.target.value })} className={fieldClass}><option value="">Any priority</option>{priorities.map((item) => <option key={item}>{item}</option>)}</select></div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5"><select value={searchParams.get("type") || ""} onChange={(event) => setQuery({ type: event.target.value })} className={fieldClass}><option value="">Any type</option>{followUpTypes.map((item) => <option key={item}>{item}</option>)}</select><input type="date" value={searchParams.get("from")?.slice(0, 10) || ""} onChange={(event) => setQuery({ from: event.target.value ? new Date(`${event.target.value}T00:00:00`).toISOString() : "" })} className={fieldClass} aria-label="Due from" /><input type="date" value={searchParams.get("to")?.slice(0, 10) || ""} onChange={(event) => setQuery({ to: event.target.value ? new Date(`${event.target.value}T23:59:59.999`).toISOString() : "" })} className={fieldClass} aria-label="Due to" /><select value={searchParams.get("sort") || "dueDate"} onChange={(event) => setQuery({ sort: event.target.value })} className={fieldClass}><option value="dueDate">Sort: due date</option><option value="priority">Sort: priority</option><option value="client">Sort: client</option><option value="createdAt">Sort: created</option></select>{filtersActive ? <button type="button" onClick={() => { setSearchInput(""); setSearchParams({ view }); }} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600"><FilterX className="h-4 w-4" />Clear filters</button> : <div />}</div>
          </section>

          {error ? <div className="flex items-center justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span>{error}</span><button type="button" onClick={() => { recoveryAttemptRef.current = 0; void load({ quiet: true, recovery: true }); }} className="rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-semibold">Retry now</button></div> : null}

          <main><div className="mb-3 flex items-center justify-between px-1"><div><h2 className="text-lg font-semibold text-slate-950">Queue</h2><p className="text-sm text-slate-500">{meta.total || 0} follow-ups · {meta.uniqueClients || 0} unique clients/leads</p></div></div><div className="space-y-3">{loading ? Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-3xl bg-white/80" />) : items.length ? items.map((item) => <FollowUpCard key={`${item.source}-${item.id}`} item={item} timezone={meta.timezone || options.timezone} highlighted={item.id === activeHighlightId} onEdit={openEdit} onComplete={(entry) => { setAction({ kind: "complete", item: entry }); setActionValue(""); setNextLeadFollowUp(nextLeadFollowUpForm(entry, appUser?.id)); }} onCancel={(entry) => { setAction({ kind: "cancel", item: entry }); setActionValue(""); setNextLeadFollowUp(nextLeadFollowUpForm(entry, appUser?.id)); }} onAppointment={setAppointmentId} />) : <div className="rounded-3xl border border-dashed border-slate-300 bg-white/80 p-12 text-center text-sm text-slate-500">No follow-ups match this view.</div>}</div>{meta.total > meta.limit ? <div className="mt-5 flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm"><p className="text-sm text-slate-500">Page {page} of {Math.max(1, Math.ceil(meta.total / meta.limit))}</p><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setQuery({ page: String(page - 1) }, false)} className="flex h-9 items-center gap-1 rounded-xl border border-slate-200 px-3 text-sm font-semibold disabled:opacity-40"><ChevronLeft className="h-4 w-4" />Previous</button><button type="button" disabled={!meta.hasMore} onClick={() => setQuery({ page: String(page + 1) }, false)} className="flex h-9 items-center gap-1 rounded-xl border border-slate-200 px-3 text-sm font-semibold disabled:opacity-40">Next<ChevronRight className="h-4 w-4" /></button></div></div> : null}</main>
        </div>
      </section>

      {drawer ? <Drawer form={form} setForm={setForm} options={options} editing={drawer === "create" ? null : drawer} onClose={() => setDrawer(null)} onSubmit={saveFollowUp} saving={saving} error={formError} /> : null}
      {action?.kind === "complete" ? <Modal title={`Complete “${action.item.title}”`} onClose={() => setAction(null)} onSubmit={submitAction} submitLabel="Complete follow-up" saving={saving}><div className="space-y-4"><label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Outcome <b className="text-rose-500">*</b></span><select required value={actionValue} onChange={(event) => setActionValue(event.target.value)} className={fieldClass}><option value="">Select outcome</option>{completionOutcomes.map((item) => <option key={item}>{item}</option>)}</select></label>{action.item.requiresNextFollowUp ? <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-4"><div><p className="text-sm font-semibold text-amber-950">Add the lead’s next action</p><p className="mt-1 text-xs leading-5 text-amber-800">Open leads must always have an assigned next follow-up.</p></div><label className="block text-sm font-medium text-slate-700">Assigned to<select required value={nextLeadFollowUp.assignedUserId} onChange={(event) => setNextLeadFollowUp((current) => ({ ...current, assignedUserId: event.target.value }))} className={fieldClass}><option value="">Select staff</option>{options.users.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label><label className="block text-sm font-medium text-slate-700">Type<select required value={nextLeadFollowUp.type} onChange={(event) => setNextLeadFollowUp((current) => ({ ...current, type: event.target.value }))} className={fieldClass}>{leadFollowUpTypes.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ").toLowerCase()}</option>)}</select></label><label className="block text-sm font-medium text-slate-700">Due<input required type="datetime-local" value={nextLeadFollowUp.dueAt} onChange={(event) => setNextLeadFollowUp((current) => ({ ...current, dueAt: event.target.value }))} className={fieldClass} /></label><label className="block text-sm font-medium text-slate-700">Instruction<textarea required maxLength={1000} value={nextLeadFollowUp.description} onChange={(event) => setNextLeadFollowUp((current) => ({ ...current, description: event.target.value }))} rows={3} className={areaClass} placeholder="What needs to happen next?" /></label></div> : null}</div></Modal> : null}
      {action?.kind === "cancel" ? <Modal title={`Cancel “${action.item.title}”`} onClose={() => setAction(null)} onSubmit={submitAction} submitLabel="Cancel follow-up" saving={saving} danger><div className="space-y-4"><label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Reason <b className="text-rose-500">*</b></span><textarea required maxLength={500} value={actionValue} onChange={(event) => setActionValue(event.target.value)} rows={4} className={areaClass} placeholder="Record why this follow-up is being cancelled." /></label>{action.item.source === "lead" && action.item.requiresNextFollowUp ? <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-4"><div><p className="text-sm font-semibold text-amber-950">Add the lead’s next action</p><p className="mt-1 text-xs leading-5 text-amber-800">Cancelling the last action cannot leave an open lead without follow-up.</p></div><label className="block text-sm font-medium text-slate-700">Assigned to<select required value={nextLeadFollowUp.assignedUserId} onChange={(event) => setNextLeadFollowUp((current) => ({ ...current, assignedUserId: event.target.value }))} className={fieldClass}><option value="">Select staff</option>{options.users.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label><label className="block text-sm font-medium text-slate-700">Type<select required value={nextLeadFollowUp.type} onChange={(event) => setNextLeadFollowUp((current) => ({ ...current, type: event.target.value }))} className={fieldClass}>{leadFollowUpTypes.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ").toLowerCase()}</option>)}</select></label><label className="block text-sm font-medium text-slate-700">Due<input required type="datetime-local" value={nextLeadFollowUp.dueAt} onChange={(event) => setNextLeadFollowUp((current) => ({ ...current, dueAt: event.target.value }))} className={fieldClass} /></label><label className="block text-sm font-medium text-slate-700">Instruction<textarea required maxLength={1000} value={nextLeadFollowUp.description} onChange={(event) => setNextLeadFollowUp((current) => ({ ...current, description: event.target.value }))} rows={3} className={areaClass} placeholder="What needs to happen next?" /></label></div> : null}</div></Modal> : null}
      {appointmentId ? <AppointmentProfileOverlay appointmentId={appointmentId} onClose={() => setAppointmentId(null)} onChanged={() => load({ quiet: true })} /> : null}
    </>
  );
}
