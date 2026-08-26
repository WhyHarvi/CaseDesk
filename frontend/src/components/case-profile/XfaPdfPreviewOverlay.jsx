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

const SIGNATURE_ANNOTATION_ID = "pdfjs_internal_editor_casedesk-resizable-representative";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function signatureAnnotation(pdfjs, editor, scales) {
  const [left, bottom, right, top] = editor.rect;
  const paddingX = 8;
  const paddingY = 4;
  const boxWidth = Math.max(1, right - left - paddingX * 2);
  const boxHeight = Math.max(1, top - bottom - paddingY * 2);
  const targetWidth = boxWidth * scales.x;
  const targetHeight = boxHeight * scales.y;
  const containedLeft = left + paddingX + (boxWidth - targetWidth) / 2;
  const containedTop = top - paddingY - (boxHeight - targetHeight) / 2;
  const allPoints = editor.strokes.flat();
  const xs = allPoints.map(([x]) => x);
  const ys = allPoints.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scaleX = targetWidth / Math.max(maxX - minX, 0.02);
  const scaleY = targetHeight / Math.max(maxY - minY, 0.02);
  const points = editor.strokes.map((stroke) => stroke.flatMap(([x, y]) => [containedLeft + (x - minX) * scaleX, containedTop - (y - minY) * scaleY]));
  const lines = points.map((stroke) => {
    const line = [];
    for (let index = 0; index < stroke.length; index += 2) line.push(Number.NaN, Number.NaN, Number.NaN, Number.NaN, stroke[index], stroke[index + 1]);
    return line;
  });
  return { annotationType: pdfjs.AnnotationEditorType.INK, pageIndex: editor.pageIndex, rect: editor.rect, rotation: 0, color: [15, 23, 42], thickness: 1.2, opacity: 1, paths: { lines, points }, date: new Date().toISOString(), user: editor.signerName };
}

function SignatureResizeLayer({ editor, pageSize, scales, onScales, onCommit }) {
  const dragRef = useRef(null);
  const [left, bottom, right, top] = editor.rect;
  const innerLeft = left + 8;
  const innerBottom = bottom + 4;
  const innerRight = right - 8;
  const innerTop = top - 4;
  const field = {
    left: `${(innerLeft / pageSize.width) * 100}%`,
    top: `${((pageSize.height - innerTop) / pageSize.height) * 100}%`,
    width: `${((innerRight - innerLeft) / pageSize.width) * 100}%`,
    height: `${((innerTop - innerBottom) / pageSize.height) * 100}%`,
  };
  const points = editor.strokes.flat();
  const minX = Math.min(...points.map(([x]) => x));
  const maxX = Math.max(...points.map(([x]) => x));
  const minY = Math.min(...points.map(([, y]) => y));
  const maxY = Math.max(...points.map(([, y]) => y));
  const width = Math.max(maxX - minX, 0.02);
  const height = Math.max(maxY - minY, 0.02);

  useEffect(() => {
    const move = (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      const horizontal = drag.xDirection === 0 ? 0 : ((event.clientX - drag.x) * drag.xDirection * 2) / Math.max(drag.width, 1);
      const vertical = drag.yDirection === 0 ? 0 : ((event.clientY - drag.y) * drag.yDirection * 2) / Math.max(drag.height, 1);
      let nextX = drag.xDirection === 0 ? drag.scales.x : clamp(drag.scales.x + horizontal, editor.minScale, editor.maxScale);
      let nextY = drag.yDirection === 0 ? drag.scales.y : clamp(drag.scales.y + vertical, editor.minScale, editor.maxScale);
      if (event.shiftKey && drag.xDirection !== 0 && drag.yDirection !== 0) {
        const change = Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical;
        nextX = clamp(drag.scales.x + change, editor.minScale, editor.maxScale);
        nextY = clamp(drag.scales.y + change, editor.minScale, editor.maxScale);
      }
      onScales({ x: nextX, y: nextY });
    };
    const up = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      onCommit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [editor.maxScale, editor.minScale, onCommit, onScales]);

  const begin = (event, xDirection, yDirection) => {
    event.preventDefault();
    event.stopPropagation();
    const box = event.currentTarget.parentElement.getBoundingClientRect();
    dragRef.current = { x: event.clientX, y: event.clientY, width: box.width, height: box.height, scales, xDirection, yDirection };
  };
  const handles = [
    { position: "-left-1.5 -top-1.5", x: -1, y: -1, cursor: "cursor-nwse-resize", label: "Resize signature from top left" },
    { position: "left-1/2 -top-1.5 -translate-x-1/2", x: 0, y: -1, cursor: "cursor-ns-resize", label: "Resize signature height from top" },
    { position: "-right-1.5 -top-1.5", x: 1, y: -1, cursor: "cursor-nesw-resize", label: "Resize signature from top right" },
    { position: "-left-1.5 top-1/2 -translate-y-1/2", x: -1, y: 0, cursor: "cursor-ew-resize", label: "Resize signature width from left" },
    { position: "-right-1.5 top-1/2 -translate-y-1/2", x: 1, y: 0, cursor: "cursor-ew-resize", label: "Resize signature width from right" },
    { position: "-bottom-1.5 -left-1.5", x: -1, y: 1, cursor: "cursor-nesw-resize", label: "Resize signature from bottom left" },
    { position: "-bottom-1.5 left-1/2 -translate-x-1/2", x: 0, y: 1, cursor: "cursor-ns-resize", label: "Resize signature height from bottom" },
    { position: "-bottom-1.5 -right-1.5", x: 1, y: 1, cursor: "cursor-nwse-resize", label: "Resize signature from bottom right" },
  ];
  return (
    <div className="pointer-events-none absolute z-30" style={field}>
      <div
        className="pointer-events-auto absolute border-2 border-sky-500 bg-sky-50/10 shadow-[0_0_0_1px_rgba(255,255,255,0.9)]"
        style={{ left: `${(1 - scales.x) * 50}%`, top: `${(1 - scales.y) * 50}%`, width: `${scales.x * 100}%`, height: `${scales.y * 100}%` }}
        aria-label={`Resizable signature, ${Math.round(scales.x * 100)} percent wide and ${Math.round(scales.y * 100)} percent high`}
      >
        <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          {editor.strokes.map((stroke, index) => <polyline key={index} points={stroke.map(([x, y]) => `${x - minX},${y - minY}`).join(" ")} fill="none" stroke="#0f172a" strokeWidth={Math.max(width, height) / 180} strokeLinecap="round" strokeLinejoin="round" />)}
        </svg>
        <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-950 px-2 py-1 text-[10px] font-semibold tabular-nums text-white shadow-lg">W {Math.round(scales.x * 100)}% · H {Math.round(scales.y * 100)}%</span>
        {handles.map(({ position, x, y, cursor, label }) => (
          <button key={position} type="button" aria-label={label} onPointerDown={(event) => begin(event, x, y)} className={`absolute h-3 w-3 touch-none rounded-[2px] border border-white bg-sky-600 shadow ${position} ${cursor}`} />
        ))}
      </div>
    </div>
  );
}

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
  signatureEditor = null,
  readOnly = false,
  onSaveToCase,
  onSignatureTransformChange,
  onClose,
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const pdfViewerRef = useRef(null);
  const pdfDocumentRef = useRef(null);
  const loadingTaskRef = useRef(null);
  const pdfjsRef = useRef(null);
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
  const [signaturePageElement, setSignaturePageElement] = useState(null);
  const [signaturePageSize, setSignaturePageSize] = useState(null);
  const [signatureScales, setSignatureScales] = useState({ x: signatureEditor?.scaleX || 0.8, y: signatureEditor?.scaleY || 0.8 });
  const [signatureSizeStatus, setSignatureSizeStatus] = useState("");
  const signatureScalesRef = useRef({ x: signatureEditor?.scaleX || 0.8, y: signatureEditor?.scaleY || 0.8 });

  function changeSignatureScales(value) {
    signatureScalesRef.current = value;
    setSignatureScales(value);
  }

  async function commitSignatureTransform() {
    if (!onSignatureTransformChange) return;
    try {
      setSignatureSizeStatus("Saving size…");
      await onSignatureTransformChange(signatureScalesRef.current);
      setSignatureSizeStatus("Size saved");
    } catch (saveError) {
      setSignatureSizeStatus("");
      setError(saveError.response?.data?.message || saveError.message || "The signature size could not be saved.");
    }
  }

  useEffect(() => {
    let active = true;
    let eventBus;
    async function initialize() {
      try {
        setLoading(true);
        const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
        pdfjsRef.current = pdfjs;
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
        eventBus.on("pagerendered", async ({ pageNumber }) => {
          if (!signatureEditor || pageNumber !== signatureEditor.pageIndex + 1) return;
          const pageView = pdfViewer.getPageView(signatureEditor.pageIndex);
          const pdfPage = await pdfDocumentRef.current?.getPage(pageNumber);
          if (!active || !pageView?.div || !pdfPage) return;
          const [, , width, height] = pdfPage.view;
          setSignaturePageSize({ width, height });
          setSignaturePageElement(pageView.div);
        });
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
          pdfDocument.annotationStorage.setValue(id, {
            value: typeof value === "boolean" ? value : String(value),
          });
          applied += 1;
        }
        if (signatureEditor) {
          pdfDocument.annotationStorage.setValue(SIGNATURE_ANNOTATION_ID, signatureAnnotation(pdfjs, signatureEditor, signatureScalesRef.current));
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
      pdfjsRef.current = null;
      setSignaturePageElement(null);
      setSignaturePageSize(null);
    };
  }, [blob, readOnly, signatureEditor]);

  useEffect(() => {
    if (!signatureEditor || !pdfDocumentRef.current || !pdfjsRef.current) return;
    pdfDocumentRef.current.annotationStorage.setValue(
      SIGNATURE_ANNOTATION_ID,
      signatureAnnotation(pdfjsRef.current, signatureEditor, signatureScales),
    );
  }, [signatureEditor, signatureScales]);

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
      // IMM 5476 in CaseDesk is the appointment workflow. Preserve the
      // first "I am" choice even if a PDF viewer interaction cleared it.
      if (autofill?.values?.["547R"] === true) pdfDocument.annotationStorage.setValue("547R", { value: true });
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
      if (autofill?.values?.["547R"] === true) pdfDocument.annotationStorage.setValue("547R", { value: true });
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
      {signatureEditor ? (
        <div className="flex items-center justify-between gap-3 border-b border-sky-100 bg-sky-50 px-4 py-2 text-[11px] text-sky-900">
          <span><strong>Resize signature:</strong> drag side handles for width, top or bottom handles for height, or a corner for both. Hold Shift on a corner to keep proportions.</span>
          <span className="shrink-0 font-semibold tabular-nums text-sky-700">{signatureSizeStatus || `W ${Math.round(signatureScales.x * 100)}% · H ${Math.round(signatureScales.y * 100)}%`}</span>
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
        {signatureEditor && signaturePageElement && signaturePageSize
          ? createPortal(
              <SignatureResizeLayer
                editor={signatureEditor}
                pageSize={signaturePageSize}
                scales={signatureScales}
                onScales={changeSignatureScales}
                onCommit={commitSignatureTransform}
              />,
              signaturePageElement,
            )
          : null}
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
