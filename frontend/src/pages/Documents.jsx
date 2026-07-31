import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  FileArchive,
  FileBadge2,
  Filter,
  Grid2X2,
  List,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../services/api";

const defaultFormState = {
  clientId: "",
  caseId: "",
  documentName: "",
  status: "Requested",
  notes: "",
  clientInstructions: "",
  receivedAt: "",
  reviewedAt: "",
};

const tabOptions = ["All Documents", "Recent", "Pending", "Verified", "Archived"];
const viewOptions = ["table", "grid"];
const pageSize = 8;

const cardClassName =
  "rounded-[30px] border border-white/80 bg-white/90 shadow-[0_22px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl";
const inputClassName =
  "h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white focus:ring-4 focus:ring-slate-100";

function parseDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value, options = {}) {
  const parsed = parseDate(value);

  if (!parsed) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  }).format(parsed);
}

function formatDateForInput(value) {
  const parsed = parseDate(value);

  if (!parsed) {
    return "";
  }

  const localDate = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function formatDelta(current, previous) {
  if (!previous) {
    return { value: "No change", positive: null };
  }

  const diff = current - previous;

  if (diff === 0) {
    return { value: "No change", positive: null };
  }

  const percentage = Math.round((Math.abs(diff) / previous) * 100);
  return {
    value: `${diff > 0 ? "+" : "-"}${percentage}% from last month`,
    positive: diff > 0,
  };
}

function normalizeStatus(status) {
  if (status === "Finalized" || status === "Approved") {
    return "Verified";
  }

  if (status === "NotRequired") {
    return "Archived";
  }

  return "Pending";
}

function getStatusStyles(status) {
  if (status === "Verified") {
    return "bg-emerald-50 text-emerald-700";
  }

  if (status === "Archived") {
    return "bg-violet-50 text-violet-700";
  }

  return "bg-amber-50 text-amber-700";
}

function getTypeMeta(name) {
  const value = (name || "").toLowerCase();

  if (value.includes("passport") || value.includes("birth") || value.includes("photo") || value.includes("identity")) {
    return { label: "Identity", className: "bg-sky-50 text-sky-700" };
  }

  if (
    value.includes("bank") ||
    value.includes("fund") ||
    value.includes("financial") ||
    value.includes("tax") ||
    value.includes("pay")
  ) {
    return { label: "Financial", className: "bg-emerald-50 text-emerald-700" };
  }

  if (value.includes("police") || value.includes("clearance") || value.includes("legal")) {
    return { label: "Legal", className: "bg-fuchsia-50 text-fuchsia-700" };
  }

  if (value.includes("education") || value.includes("transcript") || value.includes("degree")) {
    return { label: "Education", className: "bg-orange-50 text-orange-700" };
  }

  return { label: "Supporting", className: "bg-slate-100 text-slate-700" };
}

function getFileMeta(name) {
  const extension = (name?.split(".").pop() || "").toLowerCase();

  if (["png", "jpg", "jpeg", "gif", "webp"].includes(extension)) {
    return {
      label: extension || "img",
      iconWrap: "bg-emerald-50 text-emerald-600",
      icon: "image",
    };
  }

  return {
    label: extension || "pdf",
    iconWrap: "bg-rose-50 text-rose-600",
    icon: "file",
  };
}

function getInitials(name) {
  return (name || "NA")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function getDocumentTimestamp(item) {
  return item.reviewedAt || item.receivedAt || item.updatedAt || item.createdAt || null;
}

function getUploadedLabel(item) {
  const timestamp = getDocumentTimestamp(item);

  if (!timestamp) {
    return "Not available";
  }

  return formatDate(timestamp, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function matchesTab(item, tab) {
  if (tab === "All Documents") {
    return true;
  }

  if (tab === "Recent") {
    const timestamp = parseDate(getDocumentTimestamp(item));

    if (!timestamp) {
      return false;
    }

    const diff = Date.now() - timestamp.getTime();
    return diff <= 1000 * 60 * 60 * 24 * 14;
  }

  if (tab === "Pending") {
    return item.uiStatus === "Pending";
  }

  if (tab === "Verified") {
    return item.uiStatus === "Verified";
  }

  return item.uiStatus === "Archived";
}

function DocumentFormModal({
  formState,
  onChange,
  onSubmit,
  onCancel,
  saving,
  formError,
  clients,
  cases,
  isEditing,
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 px-4 py-8 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[32px] border border-white/80 bg-white p-6 shadow-[0_30px_90px_rgba(15,23,42,0.18)] sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-950">{isEditing ? "Edit document" : "New document"}</h2>
            <p className="mt-1 text-sm text-slate-500">
              Track client documents, review dates, and notes from one place.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Client</span>
            <select name="clientId" value={formState.clientId} onChange={onChange} className={inputClassName}>
              <option value="">No client selected</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.fullName}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Case</span>
            <select name="caseId" value={formState.caseId} onChange={onChange} className={inputClassName}>
              <option value="">No case selected</option>
              {cases.map((item) => (
                <option key={item.id} value={item.id}>
                  {(item.client?.fullName || "Unknown client") + " • " + item.caseType}
                </option>
              ))}
            </select>
          </label>

          <label className="block md:col-span-2">
            <span className="mb-2 block text-sm font-medium text-slate-700">Document name</span>
            <input
              required
              name="documentName"
              value={formState.documentName}
              onChange={onChange}
              className={inputClassName}
              placeholder="Enter document name"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Status</span>
            <select name="status" value={formState.status} onChange={onChange} className={inputClassName}>
              {(isEditing ? ["Requested", "Uploaded", "UnderReview", "ChangesRequested", "Approved", "Finalized", "NotRequired"] : ["Requested"]).map((status) => (
                <option key={status} value={status}>
                  {status === "NotRequired" ? "Not Required" : status === "UnderReview" ? "Under Review" : status === "ChangesRequested" ? "Changes Requested" : status}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Received date</span>
            <input
              type="date"
              name="receivedAt"
              value={formState.receivedAt}
              onChange={onChange}
              className={inputClassName}
            />
          </label>

          {formState.status === "Finalized" ? <p className="self-center rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">This document was finalized through the case review workflow.</p> : null}

          <label className="block md:col-span-2">
            <span className="mb-2 block text-sm font-medium text-slate-700">Client instructions</span>
            <textarea
              name="clientInstructions"
              rows="3"
              value={formState.clientInstructions}
              onChange={onChange}
              className="w-full rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-amber-300 focus:bg-white focus:ring-4 focus:ring-amber-100"
              placeholder="Explain what is needed or why a replacement is required. This is visible to the client."
            />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-2 block text-sm font-medium text-slate-700">Internal notes</span>
            <textarea
              name="notes"
              rows="4"
              value={formState.notes}
              onChange={onChange}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white focus:ring-4 focus:ring-slate-100"
              placeholder="Client emailed a clear scan for review."
            />
          </label>

          {formError ? <div className="md:col-span-2 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{formError}</div> : null}

          <div className="md:col-span-2 flex flex-wrap items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : isEditing ? "Save changes" : "Create document"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-5 py-3 text-sm font-medium text-slate-600 transition hover:text-slate-900"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SummaryCard({ icon, iconClassName, label, value, delta }) {
  return (
    <div className={`${cardClassName} p-4 sm:p-5`}>
      <div className="flex items-start gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${iconClassName}`}>{icon}</div>
        <div>
          <p className="text-[1.65rem] font-semibold leading-none text-slate-950">{value}</p>
          <p className="mt-1.5 text-sm text-slate-500">{label}</p>
        </div>
      </div>
      <p
        className={`mt-4 text-xs font-medium ${
          delta.positive === null ? "text-slate-400" : delta.positive ? "text-emerald-600" : "text-rose-500"
        }`}
      >
        {delta.value}
      </p>
    </div>
  );
}

function DocumentRow({ item, highlighted, onEdit, onDelete, deletingId }) {
  const typeMeta = getTypeMeta(item.documentName);
  const fileMeta = getFileMeta(item.documentName);

  return (
    <tr id={`document-row-${item.id}`} className={`border-t border-slate-100 text-sm text-slate-700 ${highlighted ? "ring-4 ring-inset ring-sky-200/80" : ""}`}>
      <td className="px-4 py-5 align-top">
        <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-300" />
      </td>
      <td className="px-4 py-5 align-top">
        <div className="flex items-start gap-4">
          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${fileMeta.iconWrap}`}>
            <FileBadge2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{item.documentName}</p>
            <p className="mt-1 truncate text-slate-400">{item.fileName}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-5 align-top">
        <p className="font-medium text-slate-800">{item.caseLabel}</p>
        <p className="mt-1 text-slate-400">{item.clientLabel}</p>
      </td>
      <td className="px-4 py-5 align-top">
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${typeMeta.className}`}>{typeMeta.label}</span>
      </td>
      <td className="px-4 py-5 align-top">
        <p className="font-medium text-slate-800">{item.uploadedDate}</p>
        <p className="mt-1 text-slate-400">{item.uploadedTime}</p>
      </td>
      <td className="px-4 py-5 align-top">
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${getStatusStyles(item.uiStatus)}`}>{item.uiStatus}</span>
      </td>
      <td className="px-4 py-5 align-top">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onEdit(item.raw)}
            className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:text-slate-900"
            aria-label={`Edit ${item.documentName}`}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(item.raw)}
            disabled={deletingId === item.id}
            className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={`Delete ${item.documentName}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button type="button" className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:text-slate-900">
            <Ellipsis className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function DocumentGridCard({ item, highlighted, onEdit, onDelete, deletingId }) {
  const typeMeta = getTypeMeta(item.documentName);
  const fileMeta = getFileMeta(item.documentName);

  return (
    <div id={`document-row-${item.id}`} className={`${cardClassName} p-5 ${highlighted ? "ring-4 ring-sky-200/80" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${fileMeta.iconWrap}`}>
          <FileBadge2 className="h-5 w-5" />
        </div>
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${getStatusStyles(item.uiStatus)}`}>{item.uiStatus}</span>
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-900">{item.documentName}</h3>
      <p className="mt-1 text-sm text-slate-400">{item.fileName}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${typeMeta.className}`}>{typeMeta.label}</span>
        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{item.caseLabel}</span>
      </div>
      <div className="mt-5 space-y-2 text-sm text-slate-500">
        <p>{item.clientLabel}</p>
        <p>{item.uploadedDate}</p>
      </div>
      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onEdit(item.raw)}
          className="inline-flex flex-1 items-center justify-center rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:text-slate-900"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(item.raw)}
          disabled={deletingId === item.id}
          className="inline-flex flex-1 items-center justify-center rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-rose-600 transition hover:border-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default function Documents() {
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get("highlight") || "";
  const [documents, setDocuments] = useState([]);
  const [clients, setClients] = useState([]);
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingDocument, setEditingDocument] = useState(null);
  const [formState, setFormState] = useState(defaultFormState);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [activeTab, setActiveTab] = useState("All Documents");
  const [view, setView] = useState("table");
  const [page, setPage] = useState(1);

  const isEditing = Boolean(editingDocument);

  async function loadDocuments() {
    try {
      setLoading(true);
      const response = await api.get("/client-documents");
      setDocuments(response.data.data || []);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load documents.");
    } finally {
      setLoading(false);
    }
  }

  async function loadOptions() {
    try {
      const [clientsResponse, casesResponse] = await Promise.all([api.get("/clients"), api.get("/cases")]);
      setClients(clientsResponse.data.data || []);
      setCases(casesResponse.data.data || []);
    } catch (requestError) {
      setClients([]);
      setCases([]);
    }
  }

  useEffect(() => {
    loadDocuments();
    loadOptions();
  }, []);

  const documentRows = useMemo(
    () =>
      [...documents]
        .map((item) => {
          const timestamp = getDocumentTimestamp(item);
          const parsedTimestamp = parseDate(timestamp);
          const clientLabel = item.client?.fullName || "No client selected";
          const caseLabel = item.case?.caseNumber || item.case?.referenceNumber || item.case?.caseType || "No case selected";

          return {
            id: item.id,
            raw: item,
            documentName: item.documentName || "Untitled document",
            fileName: item.documentName || "document.pdf",
            clientLabel,
            caseLabel,
            uploadedDate: getUploadedLabel(item),
            uploadedTime: parsedTimestamp
              ? new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(parsedTimestamp)
              : "No time",
            uploadedAt: parsedTimestamp?.getTime() || 0,
            uiStatus: normalizeStatus(item.status),
          };
        })
        .sort((a, b) => b.uploadedAt - a.uploadedAt || a.documentName.localeCompare(b.documentName)),
    [documents]
  );

  const summary = useMemo(() => {
    const total = documentRows.length;
    const verified = documentRows.filter((item) => item.uiStatus === "Verified").length;
    const pending = documentRows.filter((item) => item.uiStatus === "Pending").length;
    const archived = documentRows.filter((item) => item.uiStatus === "Archived").length;

    const recentCutoff = Date.now() - 1000 * 60 * 60 * 24 * 30;
    const currentWindow = documentRows.filter((item) => item.uploadedAt >= recentCutoff);
    const previousWindow = documentRows.filter(
      (item) => item.uploadedAt < recentCutoff && item.uploadedAt >= recentCutoff - 1000 * 60 * 60 * 24 * 30
    );

    const currentVerified = currentWindow.filter((item) => item.uiStatus === "Verified").length;
    const previousVerified = previousWindow.filter((item) => item.uiStatus === "Verified").length;
    const currentPending = currentWindow.filter((item) => item.uiStatus === "Pending").length;
    const previousPending = previousWindow.filter((item) => item.uiStatus === "Pending").length;
    const currentArchived = currentWindow.filter((item) => item.uiStatus === "Archived").length;
    const previousArchived = previousWindow.filter((item) => item.uiStatus === "Archived").length;

    return {
      total,
      verified,
      pending,
      archived,
      totalDelta: formatDelta(currentWindow.length, previousWindow.length),
      verifiedDelta: formatDelta(currentVerified, previousVerified),
      pendingDelta: formatDelta(currentPending, previousPending),
      archivedDelta: formatDelta(currentArchived, previousArchived),
    };
  }, [documentRows]);

  const filteredDocuments = useMemo(() => {
    return documentRows.filter((item) => {
      if (!matchesTab(item, activeTab)) {
        return false;
      }
      return true;
    });
  }, [activeTab, documentRows]);

  const totalPages = Math.max(1, Math.ceil(filteredDocuments.length / pageSize));

  useEffect(() => {
    if (!highlightId) return;
    const index = filteredDocuments.findIndex((item) => item.id === highlightId);
    if (index === -1) return;
    const targetPage = Math.floor(index / pageSize) + 1;
    setPage((current) => (current === targetPage ? current : targetPage));
  }, [highlightId, filteredDocuments]);

  useEffect(() => {
    if (!highlightId || loading) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`document-row-${highlightId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightId, loading, page]);

  const paginatedDocuments = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredDocuments.slice(start, start + pageSize);
  }, [filteredDocuments, page]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, view]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  function resetForm() {
    setFormState(defaultFormState);
    setEditingDocument(null);
    setFormError("");
    setShowForm(false);
  }

  function openCreateForm() {
    setEditingDocument(null);
    setFormState(defaultFormState);
    setFormError("");
    setShowForm(true);
  }

  function openEditForm(item) {
    setEditingDocument(item);
    setFormState({
      clientId: item.client?.id || "",
      caseId: item.case?.id || "",
      documentName: item.documentName || "",
      status: item.status || "Requested",
      notes: item.notes || "",
      clientInstructions: item.clientInstructions || "",
      receivedAt: formatDateForInput(item.receivedAt),
      reviewedAt: formatDateForInput(item.reviewedAt),
    });
    setFormError("");
    setShowForm(true);
  }

  function handleInputChange(event) {
    const { name, value } = event.target;
    setFormState((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      setSaving(true);
      setFormError("");

      const payload = {
        ...formState,
        clientId: formState.clientId || "",
        caseId: formState.caseId || "",
        notes: formState.notes.trim(),
        clientInstructions: formState.clientInstructions.trim(),
      };

      const requestedStatus = payload.status;
      delete payload.status;
      delete payload.reviewedAt;

      if (!payload.clientId) {
        delete payload.clientId;
      }

      if (!payload.caseId) {
        delete payload.caseId;
      }

      if (!payload.notes) {
        delete payload.notes;
      }

      if (!payload.clientInstructions) {
        payload.clientInstructions = null;
      }

      if (!payload.receivedAt) {
        delete payload.receivedAt;
      }

      if (!payload.reviewedAt) {
        delete payload.reviewedAt;
      }

      if (isEditing) {
        await api.patch(`/client-documents/${editingDocument.id}`, payload);
        if (requestedStatus !== editingDocument.status) await api.post(`/client-documents/${editingDocument.id}/status`, { status: requestedStatus });
      } else {
        payload.status = "Requested";
        await api.post("/client-documents", payload);
      }

      await loadDocuments();
      resetForm();
    } catch (requestError) {
      setFormError(requestError.response?.data?.message || "Unable to save document.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item) {
    const confirmed = window.confirm(`Delete the document record "${item.documentName}"?`);

    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(item.id);
      await api.delete(`/client-documents/${item.id}`);
      setDocuments((current) => current.filter((entry) => entry.id !== item.id));

      if (editingDocument?.id === item.id) {
        resetForm();
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to delete document.");
    } finally {
      setDeletingId("");
    }
  }

  const visibleStart = filteredDocuments.length ? (page - 1) * pageSize + 1 : 0;
  const visibleEnd = Math.min(page * pageSize, filteredDocuments.length);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1).slice(0, 5);

  return (
    <>
      <section className="space-y-6">
        <div className={`${cardClassName} overflow-hidden p-4 sm:p-6 lg:p-8`}>
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">Documents</h1>
                <p className="mt-3 text-base text-slate-500">Manage, organize, and share documents securely</p>
              </div>

              <div className="flex flex-wrap items-center gap-3 lg:justify-end">
                <button
                  type="button"
                  onClick={openCreateForm}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-[0_12px_30px_rgba(15,23,42,0.05)] transition hover:text-slate-900"
                >
                  <Upload className="h-4 w-4" />
                  Upload
                </button>

                <button
                  type="button"
                  onClick={openCreateForm}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.12)] transition hover:bg-slate-800"
                >
                  <Plus className="h-4 w-4" />
                  New Document
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                icon={<FileBadge2 className="h-5 w-5" />}
                iconClassName="bg-sky-50 text-sky-600"
                label="Total Documents"
                value={summary.total}
                delta={summary.totalDelta}
              />
              <SummaryCard
                icon={<ShieldCheck className="h-5 w-5" />}
                iconClassName="bg-emerald-50 text-emerald-600"
                label="Verified"
                value={summary.verified}
                delta={summary.verifiedDelta}
              />
              <SummaryCard
                icon={<CheckCircle2 className="h-5 w-5" />}
                iconClassName="bg-amber-50 text-amber-600"
                label="Pending Review"
                value={summary.pending}
                delta={summary.pendingDelta}
              />
              <SummaryCard
                icon={<FileArchive className="h-5 w-5" />}
                iconClassName="bg-violet-50 text-violet-600"
                label="Archived"
                value={summary.archived}
                delta={summary.archivedDelta}
              />
            </div>

            <div className={`${cardClassName} overflow-hidden p-4 sm:p-5`}>
              {error ? <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2">
                  {tabOptions.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm transition ${
                        activeTab === tab ? "bg-slate-950 font-semibold text-white" : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      {tab}
                      {tab === "All Documents" ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            activeTab === tab ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {summary.total}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:text-slate-900"
                  >
                    <Filter className="h-4 w-4" />
                    Filters
                  </button>

                  <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1">
                    {viewOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setView(option)}
                        className={`inline-flex h-10 w-10 items-center justify-center rounded-xl transition ${
                          view === option ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-900"
                        }`}
                        aria-label={option === "table" ? "Table view" : "Grid view"}
                      >
                        {option === "table" ? <List className="h-4 w-4" /> : <Grid2X2 className="h-4 w-4" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="h-36 animate-pulse rounded-[24px] bg-slate-100" />
                  ))}
                </div>
              ) : paginatedDocuments.length ? (
                <>
                  {view === "table" ? (
                    <div className="mt-6 overflow-x-auto">
                      <table className="min-w-full">
                        <thead>
                          <tr className="text-left text-sm font-medium text-slate-400">
                            <th className="px-4 py-4">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-300"
                              />
                            </th>
                            <th className="px-4 py-4">Document Name</th>
                            <th className="px-4 py-4">Case / Client</th>
                            <th className="px-4 py-4">Type</th>
                            <th className="px-4 py-4">Uploaded</th>
                            <th className="px-4 py-4">Status</th>
                            <th className="px-4 py-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedDocuments.map((item) => (
                            <DocumentRow
                              key={item.id}
                              item={item}
                              highlighted={item.id === highlightId}
                              onEdit={openEditForm}
                              onDelete={handleDelete}
                              deletingId={deletingId}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {paginatedDocuments.map((item) => (
                        <DocumentGridCard
                          key={item.id}
                          item={item}
                          highlighted={item.id === highlightId}
                          onEdit={openEditForm}
                          onDelete={handleDelete}
                          deletingId={deletingId}
                        />
                      ))}
                    </div>
                  )}

                  <div className="mt-6 flex flex-col gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-slate-500">
                      Showing {visibleStart} to {visibleEnd} of {filteredDocuments.length} documents
                    </p>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                        disabled={page === 1}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>

                      {pageNumbers.map((pageNumber) => (
                        <button
                          key={pageNumber}
                          type="button"
                          onClick={() => setPage(pageNumber)}
                          className={`inline-flex h-10 min-w-[2.5rem] items-center justify-center rounded-xl px-3 text-sm font-medium transition ${
                            page === pageNumber ? "bg-slate-950 text-white" : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          {pageNumber}
                        </button>
                      ))}

                      <button
                        type="button"
                        onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                        disabled={page === totalPages}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="mt-6 rounded-[24px] border border-dashed border-slate-200 bg-slate-50/80 px-6 py-12 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-white text-slate-500 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                    <FileBadge2 className="h-7 w-7" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-slate-900">No documents found</h3>
                  <p className="mt-2 text-sm text-slate-500">
                    Try a different search or create a new document record to get started.
                  </p>
                  <button
                    type="button"
                    onClick={openCreateForm}
                    className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    <Plus className="h-4 w-4" />
                    New Document
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {showForm ? (
        <DocumentFormModal
          formState={formState}
          onChange={handleInputChange}
          onSubmit={handleSubmit}
          onCancel={resetForm}
          saving={saving}
          formError={formError}
          clients={clients}
          cases={cases}
          isEditing={isEditing}
        />
      ) : null}
    </>
  );
}
