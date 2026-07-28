import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  Minus,
  Plus,
  Save,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";

function downloadBytes(bytes, filename, type = "application/pdf") {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function XfaPdfPreviewOverlay({
  item,
  blob,
  autofill,
  readOnly = false,
  onSaveToCase,
  onClose,
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const pdfViewerRef = useRef(null);
  const pdfDocumentRef = useRef(null);
  const loadingTaskRef = useRef(null);
  const changeCounterRef = useRef(0);
  const saveCaseCopyRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [pureXfa, setPureXfa] = useState(false);
  const [filledCount, setFilledCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savingToCase, setSavingToCase] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [autosaveLabel, setAutosaveLabel] = useState("All changes saved");
  const [saveDialog, setSaveDialog] = useState(null);
  const [closeConfirm, setCloseConfirm] = useState(false);

  useEffect(() => {
    let active = true;
    let eventBus;
    async function initialize() {
      try {
        setLoading(true);
        const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
        globalThis.pdfjsLib = pdfjs;
        const viewerModule = await import("pdfjs-dist/web/pdf_viewer.mjs");
        if (!active) return;
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        eventBus = new viewerModule.EventBus();
        const linkService = new viewerModule.PDFLinkService({ eventBus });
        const pdfViewer = new viewerModule.PDFViewer({
          container: containerRef.current,
          viewer: viewerRef.current,
          eventBus,
          linkService,
          annotationMode: readOnly
            ? pdfjs.AnnotationMode.ENABLE
            : pdfjs.AnnotationMode.ENABLE_FORMS,
          textLayerMode: 1,
          enableScripting: false,
        });
        pdfViewerRef.current = pdfViewer;
        linkService.setViewer(pdfViewer);
        eventBus.on("pagesinit", () => {
          pdfViewer.currentScaleValue = "page-width";
          setLoading(false);
        });
        eventBus.on("pagechanging", ({ pageNumber }) => setPage(pageNumber));
        const loadingTask = pdfjs.getDocument({
          data: new Uint8Array(await blob.arrayBuffer()),
          enableXfa: true,
        });
        loadingTaskRef.current = loadingTask;
        const pdfDocument = await loadingTask.promise;
        if (!active) {
          await loadingTask.destroy();
          return;
        }
        pdfDocumentRef.current = pdfDocument;
        setPageCount(pdfDocument.numPages);
        setPureXfa(Boolean(pdfDocument.isPureXfa));
        let applied = 0;
        for (const [id, value] of Object.entries(autofill?.values || {})) {
          if (value === "" || value === null || value === undefined) continue;
          pdfDocument.annotationStorage.setValue(id, { value: String(value) });
          applied += 1;
        }
        pdfDocument.annotationStorage.resetModified();
        pdfDocument.annotationStorage.onSetModified = readOnly
          ? null
          : () => {
              if (!active) return;
              changeCounterRef.current += 1;
              setDirty(true);
              setAutosaveLabel("Unsaved changes");
            };
        setFilledCount(applied);
        pdfViewer.setDocument(pdfDocument);
        linkService.setDocument(pdfDocument);
      } catch (viewerError) {
        if (active) {
          setError(
            viewerError.message ||
              "This form could not be rendered in CaseDesk.",
          );
          setLoading(false);
        }
      }
    }
    initialize();
    return () => {
      active = false;
      if (pdfDocumentRef.current?.annotationStorage)
        pdfDocumentRef.current.annotationStorage.onSetModified = null;
      pdfViewerRef.current?.cleanup?.();
      loadingTaskRef.current?.destroy?.();
      pdfViewerRef.current = null;
      pdfDocumentRef.current = null;
    };
  }, [blob, readOnly]);

  function changePage(offset) {
    const viewer = pdfViewerRef.current;
    if (!viewer) return;
    viewer.currentPageNumber = Math.max(
      1,
      Math.min(pageCount, viewer.currentPageNumber + offset),
    );
  }

  function zoom(direction) {
    const viewer = pdfViewerRef.current;
    if (!viewer) return;
    if (direction > 0) viewer.increaseScale({ steps: 1 });
    else viewer.decreaseScale({ steps: 1 });
  }

  async function saveFilledCopy() {
    const pdfDocument = pdfDocumentRef.current;
    if (!pdfDocument) return;
    try {
      setSaving(true);
      setError("");
      const bytes = await pdfDocument.saveDocument();
      const base = String(
        item.originalFilename || item.formNumber || item.title || "form",
      ).replace(/\.pdf$/i, "");
      downloadBytes(bytes, `${base}-CaseDesk-filled.pdf`);
    } catch (saveError) {
      setError(saveError.message || "Unable to save the filled form copy.");
    } finally {
      setSaving(false);
    }
  }

  function defaultCopyFilename(copyType) {
    const base = String(
      item.originalFilename || item.formNumber || item.title || "form",
    )
      .replace(/\.pdf$/i, "")
      .replace(/-CaseDesk-(filled|working)$/i, "");
    return `${base}-CaseDesk-${copyType === "Working" ? "working" : "filled"}.pdf`;
  }

  async function saveCaseCopy(copyType, filename, automatic = false) {
    const pdfDocument = pdfDocumentRef.current;
    if (!pdfDocument || !onSaveToCase) return;
    const changeVersion = changeCounterRef.current;
    try {
      setSavingToCase(true);
      setError("");
      setSavedMessage("");
      if (automatic) setAutosaveLabel("Autosaving…");
      const bytes = await pdfDocument.saveDocument();
      await onSaveToCase(
        new Blob([bytes], { type: "application/pdf" }),
        filename || defaultCopyFilename(copyType),
        copyType,
      );
      if (changeCounterRef.current === changeVersion) setDirty(false);
      setAutosaveLabel(
        automatic
          ? `Autosaved ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
          : "All changes saved",
      );
      if (!automatic)
        setSavedMessage(
          `${copyType} copy saved to CaseDesk as a new immutable version.`,
        );
      setSaveDialog(null);
      return true;
    } catch (saveError) {
      setDirty(true);
      setAutosaveLabel("Autosave failed");
      if (!automatic)
        setError(
          saveError.response?.data?.message ||
            saveError.message ||
            "Unable to save the form to CaseDesk.",
        );
      return false;
    } finally {
      setSavingToCase(false);
    }
  }

  saveCaseCopyRef.current = saveCaseCopy;

  useEffect(() => {
    if (readOnly || !dirty || savingToCase || loading || !onSaveToCase)
      return undefined;
    const timer = window.setTimeout(
      () =>
        saveCaseCopyRef.current?.(
          "Working",
          defaultCopyFilename("Working"),
          true,
        ),
      4000,
    );
    return () => window.clearTimeout(timer);
  }, [dirty, loading, onSaveToCase, readOnly, savingToCase]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function requestClose() {
    if (dirty) setCloseConfirm(true);
    else onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-[420] flex flex-col bg-[#e8eaed]">
      <header className="flex min-h-[58px] flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 shadow-sm backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close form viewer"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950">
              {item.formNumber ? `${item.formNumber} · ` : ""}
              {item.title}
            </p>
            <p
              className={`truncate text-[10px] font-medium ${dirty ? "text-amber-600" : autosaveLabel === "Autosave failed" ? "text-rose-600" : "text-slate-400"}`}
            >
              {readOnly
                ? "Finalized read-only copy"
                : pureXfa
                  ? "Interactive XFA browser workspace"
                  : "Secure PDF browser workspace"}
              {autofill?.mappingVersion ? ` · ${autofill.mappingVersion}` : ""}
              {readOnly ? " · Locked" : ` · ${autosaveLabel}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-1">
          <button
            type="button"
            onClick={() => changePage(-1)}
            disabled={page <= 1}
            className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white disabled:opacity-30"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[4.5rem] text-center text-[11px] font-semibold text-slate-600">
            {page} / {pageCount || "—"}
          </span>
          <button
            type="button"
            onClick={() => changePage(1)}
            disabled={page >= pageCount}
            className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white disabled:opacity-30"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <button
            type="button"
            onClick={() => zoom(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => zoom(1)}
            className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              downloadBytes(
                blob,
                item.originalFilename || `${item.formNumber || item.title}.pdf`,
              )
            }
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
          >
            <Download className="h-3.5 w-3.5" />
            Original
          </button>
          <button
            type="button"
            onClick={saveFilledCopy}
            disabled={saving || loading || Boolean(error)}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40"
          >
            <FileDown className="h-3.5 w-3.5" />
            {saving ? "Preparing…" : "Download Filled"}
          </button>
          {!readOnly ? (
            <button
              type="button"
              onClick={() =>
                setSaveDialog({
                  filename: defaultCopyFilename("Filled"),
                  copyType: "Filled",
                })
              }
              disabled={savingToCase || loading || Boolean(error)}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" />
              {savingToCase ? "Saving…" : "Save As"}
            </button>
          ) : null}
        </div>
      </header>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] leading-5 text-amber-900">
        <span className="inline-flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Browser editing is a CaseDesk working copy. Open the saved PDF in
            desktop Adobe Acrobat Reader to validate fields, generate barcodes,
            sign, and perform the final submission review.
          </span>
        </span>
        {filledCount ? (
          <span className="shrink-0 rounded-full bg-white/80 px-2.5 py-0.5 font-semibold text-amber-800">
            {filledCount} fields prefilled
          </span>
        ) : null}
      </div>
      {autofill?.warnings?.length ? (
        <div className="border-b border-sky-100 bg-sky-50 px-4 py-2 text-[11px] text-sky-800">
          {autofill.warnings.join(" ")}
        </div>
      ) : null}
      {savedMessage ? (
        <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-[11px] font-semibold text-emerald-700">
          {savedMessage}
        </div>
      ) : null}
      {error ? (
        <div className="m-4 rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm text-rose-700">
          {error}
          <button
            type="button"
            onClick={() =>
              downloadBytes(blob, item.originalFilename || "form.pdf")
            }
            className="ml-3 font-semibold underline"
          >
            Download original
          </button>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {loading ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-[#e8eaed]">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center"
            >
              <span className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
              <p className="mt-3 text-xs font-semibold text-slate-500">
                Rendering interactive form…
              </p>
            </motion.div>
          </div>
        ) : null}
        <div ref={containerRef} className="absolute inset-0 overflow-auto">
          <div ref={viewerRef} className="pdfViewer" />
        </div>
      </div>
      {saveDialog ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-slate-950/25 p-4 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0"
            onClick={() => setSaveDialog(null)}
            aria-label="Cancel Save As"
          />
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="relative w-full max-w-md rounded-[1.8rem] border border-white bg-white p-6 shadow-[0_28px_80px_rgba(15,23,42,0.28)]"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-600">
              Save As
            </p>
            <h3 className="mt-1 text-lg font-semibold text-slate-950">
              Save a CaseDesk form copy
            </h3>
            <div className="mt-5 space-y-4">
              <label className="block text-xs font-semibold text-slate-700">
                Copy type
                <select
                  value={saveDialog.copyType}
                  onChange={(event) =>
                    setSaveDialog((current) => ({
                      ...current,
                      copyType: event.target.value,
                      filename: defaultCopyFilename(event.target.value),
                    }))
                  }
                  className="select-field mt-2 w-full"
                >
                  <option value="Working">Working Copy</option>
                  <option value="Filled">Filled Copy</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                Filename
                <input
                  autoFocus
                  value={saveDialog.filename}
                  onChange={(event) =>
                    setSaveDialog((current) => ({
                      ...current,
                      filename: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-sky-400"
                />
              </label>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSaveDialog(null)}
                disabled={savingToCase}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  saveCaseCopy(saveDialog.copyType, saveDialog.filename)
                }
                disabled={savingToCase || !saveDialog.filename.trim()}
                className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {savingToCase ? "Saving…" : "Save Copy"}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
      {closeConfirm ? (
        <div className="absolute inset-0 z-30 grid place-items-center bg-slate-950/25 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md rounded-[1.8rem] border border-white bg-white p-6 shadow-[0_28px_80px_rgba(15,23,42,0.28)]"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-lg font-semibold text-slate-950">
              Unsaved form changes
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Save a Working copy before closing, or discard only the browser
              changes made since the last autosave.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setCloseConfirm(false)}
                className="rounded-full px-4 py-2.5 text-sm font-semibold text-slate-600"
              >
                Continue Editing
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-600"
              >
                Discard Changes
              </button>
              <button
                type="button"
                disabled={savingToCase}
                onClick={async () => {
                  const saved = await saveCaseCopy(
                    "Working",
                    defaultCopyFilename("Working"),
                  );
                  if (saved) onClose();
                }}
                className="rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {savingToCase ? "Saving…" : "Save Draft & Close"}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
