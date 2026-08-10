import { BadgeCheck, Check, Download, FileText, ListChecks, LoaderCircle, Package, X } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";
import { isMyDocument } from "./DocumentsWorkspace";

const FINALIZED_STATUS = "Finalized";

function formatFileSize(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function triggerFileDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function uniqueZipEntryName(usedNames, base) {
  const original = String(base || "File").trim() || "File";
  let name = original;
  let suffix = 2;
  while (usedNames.has(name.toLowerCase())) {
    const dot = original.lastIndexOf(".");
    name = dot > 0 ? `${original.slice(0, dot)} (${suffix})${original.slice(dot)}` : `${original} (${suffix})`;
    suffix += 1;
  }
  usedNames.add(name.toLowerCase());
  return name;
}

function SelectToggle({ selected, onToggle, label }) {
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onToggle(); }}
      aria-label={`${selected ? "Deselect" : "Select"} ${label}`}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition ${selected ? "bg-sky-500 text-white" : "border border-slate-300 bg-white hover:border-sky-400"}`}
    >
      {selected ? <Check className="h-3.5 w-3.5" /> : null}
    </button>
  );
}

function ItemRow({ item, selected, onToggle, busy, onDownload }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
      <SelectToggle selected={selected} onToggle={onToggle} label={item.name} />
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><FileText className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {item.status ? <span className={item.status === FINALIZED_STATUS ? "font-semibold text-emerald-600" : ""}>{item.status}</span> : null}
          {item.status && (item.fileLabel || item.fileSize) ? " · " : ""}
          {item.fileLabel}
          {item.fileSize ? ` · ${formatFileSize(item.fileSize)}` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onDownload(item)}
        disabled={busy}
        aria-label={`Download ${item.name}`}
        title="Download"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-sky-50 hover:text-sky-600 disabled:opacity-40"
      >
        {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export default function DownloadApplicationOverlay({ caseItem, documents, canAccessForms = true, canAccessDocuments = true, onClose }) {
  const [forms, setForms] = useState([]);
  const [formsLoading, setFormsLoading] = useState(canAccessForms);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [busyKey, setBusyKey] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (!canAccessForms) return;
    let active = true;
    (async () => {
      try {
        setFormsLoading(true);
        const response = await api.get(`/case-forms?caseId=${caseItem.id}`);
        if (active) setForms(response.data.data || []);
      } catch (requestError) {
        if (active) setLoadError(requestError.response?.data?.message || "Unable to load this case's forms.");
      } finally {
        if (active) setFormsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [caseItem.id, canAccessForms]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const formItems = useMemo(
    () => forms
      .filter((form) => form.storageKey && form.status !== "NotRequired")
      .map((form) => ({
        key: `form:${form.id}`,
        type: "form",
        id: form.id,
        name: form.title || form.formNumber || "Form",
        status: form.status,
        fileLabel: form.formNumber || "",
        fileSize: form.fileSize,
        filename: form.originalFilename || form.title,
        url: `/case-forms/${form.id}/file?download=1`,
      })),
    [forms],
  );

  const documentItems = useMemo(
    () => (documents || [])
      .filter((item) => item.storageKey && item.status !== "NotRequired" && !isMyDocument(item))
      .map((item) => ({
        key: `doc:${item.id}`,
        type: "document",
        id: item.id,
        name: item.documentName,
        status: item.status,
        fileLabel: item.originalFilename || "",
        fileSize: item.fileSize,
        filename: item.originalFilename || item.documentName,
        url: `/client-documents/${item.id}/file?download=1`,
      })),
    [documents],
  );

  const allItems = useMemo(() => [...formItems, ...documentItems], [formItems, documentItems]);
  const finalizedKeys = useMemo(() => new Set(allItems.filter((item) => item.status === FINALIZED_STATUS).map((item) => item.key)), [allItems]);
  const selectedItems = useMemo(() => allItems.filter((item) => selected.has(item.key)), [allItems, selected]);

  function toggleItem(key) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(allItems.map((item) => item.key)));
  }

  function selectFinalized() {
    setSelected(new Set(finalizedKeys));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function fetchItemBlob(item) {
    const response = await api.get(item.url, { responseType: "blob", timeout: 60000 });
    return response.data;
  }

  async function downloadSingle(item) {
    setActionError("");
    setBusyKey(item.key);
    try {
      const blob = await fetchItemBlob(item);
      triggerFileDownload(blob, item.filename);
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || `Unable to download "${item.name}".`);
    } finally {
      setBusyKey("");
    }
  }

  async function downloadBundle(items) {
    if (!items.length) return;
    setActionError("");
    setBulkBusy(true);
    try {
      if (items.length === 1) {
        const [item] = items;
        const blob = await fetchItemBlob(item);
        triggerFileDownload(blob, item.filename);
        return;
      }

      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const usedNames = new Set();
      let failures = 0;
      for (const item of items) {
        try {
          const blob = await fetchItemBlob(item);
          const buffer = await blob.arrayBuffer();
          zip.file(uniqueZipEntryName(usedNames, item.filename), buffer);
        } catch {
          failures += 1;
        }
      }
      if (!Object.keys(zip.files).length) {
        setActionError("None of the selected files could be downloaded. Try again in a moment.");
        return;
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const safeClientName = String(caseItem.client?.fullName || "Client").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Client";
      triggerFileDownload(zipBlob, `${safeClientName} - Application Package.zip`);
      if (failures) setActionError(`${failures} file${failures === 1 ? "" : "s"} could not be included and ${failures === 1 ? "was" : "were"} skipped.`);
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || "Unable to download the application package.");
    } finally {
      setBulkBusy(false);
    }
  }

  const loading = formsLoading;
  const nothingToShow = !loading && !allItems.length;

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[180] flex justify-end bg-slate-950/25 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.section initial={{ x: 70, opacity: 0.85 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 70, opacity: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} className="flex h-full w-full max-w-xl flex-col border-l border-white/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))] shadow-[-24px_0_80px_rgba(15,23,42,0.16)]">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200/70 bg-white/80 px-5 py-4 backdrop-blur-xl sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_10px_25px_rgba(15,23,42,0.18)]"><Package className="h-5 w-5" /></div>
            <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{caseItem.caseType || "Case profile"}</p><h2 className="truncate text-xl font-semibold tracking-tight text-slate-950">Download Application</h2></div>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950" aria-label="Close download application"><X className="h-4 w-4" /></button>
        </header>

        {allItems.length ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200/70 bg-white/60 px-5 py-3 sm:px-7">
            <button type="button" onClick={selectAll} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300"><ListChecks className="h-3.5 w-3.5" /> Select all</button>
            <button type="button" onClick={selectFinalized} disabled={!finalizedKeys.size} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"><BadgeCheck className="h-3.5 w-3.5" /> Select finalized</button>
            {selected.size ? <button type="button" onClick={clearSelection} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Clear ({selected.size})</button> : null}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          {loadError ? <p className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{loadError}</p> : null}
          {loading ? (
            <div className="flex min-h-64 items-center justify-center"><LoaderCircle className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : nothingToShow ? (
            <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white/55 px-6 py-12 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm"><Package className="h-5 w-5" /></div>
              <h3 className="mt-4 text-sm font-semibold text-slate-900">No files to download yet</h3>
              <p className="mt-1 text-sm text-slate-400">Forms filled in on the Forms tab and documents uploaded on the Documents tab will appear here.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {canAccessForms ? (
                <div>
                  <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Forms {formItems.length ? `(${formItems.length})` : ""}</p>
                  <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80">
                    {formItems.length
                      ? formItems.map((item) => <ItemRow key={item.key} item={item} selected={selected.has(item.key)} onToggle={() => toggleItem(item.key)} busy={busyKey === item.key} onDownload={downloadSingle} />)
                      : <p className="px-4 py-4 text-sm text-slate-400">No filed forms yet.</p>}
                  </div>
                </div>
              ) : null}

              {canAccessDocuments ? (
                <div>
                  <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Documents {documentItems.length ? `(${documentItems.length})` : ""}</p>
                  <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80">
                    {documentItems.length
                      ? documentItems.map((item) => <ItemRow key={item.key} item={item} selected={selected.has(item.key)} onToggle={() => toggleItem(item.key)} busy={busyKey === item.key} onDownload={downloadSingle} />)
                      : <p className="px-4 py-4 text-sm text-slate-400">No uploaded client documents yet.</p>}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {allItems.length ? (
          <footer className="flex shrink-0 flex-col gap-3 border-t border-slate-200/70 bg-white/75 px-5 py-4 backdrop-blur-xl sm:px-7">
            {actionError ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{actionError}</p> : null}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-400">{allItems.length} file{allItems.length === 1 ? "" : "s"} available</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadBundle(selectedItems)}
                  disabled={bulkBusy || !selectedItems.length}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {bulkBusy && selectedItems.length ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Download selected {selectedItems.length ? `(${selectedItems.length})` : ""}
                </button>
                <button
                  type="button"
                  onClick={() => downloadBundle(allItems)}
                  disabled={bulkBusy}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {bulkBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
                  Download all as ZIP
                </button>
              </div>
            </div>
          </footer>
        ) : null}
      </motion.section>
    </motion.div>,
    document.body,
  );
}
