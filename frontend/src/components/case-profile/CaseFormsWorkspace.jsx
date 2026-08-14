import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  Ellipsis,
  ExternalLink,
  FileCheck2,
  FilePlus2,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ScrollText,
  Sparkles,
  Trash2,
  UploadCloud,
  LockKeyhole,
  UnlockKeyhole,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";
import XfaPdfPreviewOverlay from "./XfaPdfPreviewOverlay";
import { buildCaseFormAutofill } from "./formAutofillMappings";
import FormFieldChecklistOverlay from "./FormFieldChecklistOverlay";
import FormFieldMappingOverlay from "./FormFieldMappingOverlay";

const acceptedTypes = ".pdf,.doc,.docx,.txt,.rtf";
const statuses = [
  ["Assigned", "Assigned", "bg-slate-100 text-slate-700"],
  ["InformationMissing", "Information Missing", "bg-rose-50 text-rose-700"],
  ["ReadyToFill", "Ready to Fill", "bg-cyan-50 text-cyan-700"],
  ["InProgress", "In Progress", "bg-sky-50 text-sky-700"],
  ["ReadyForReview", "Ready for Review", "bg-violet-50 text-violet-700"],
  ["ChangesRequested", "Changes Requested", "bg-amber-50 text-amber-800"],
  ["Approved", "Approved", "bg-teal-50 text-teal-700"],
  ["SignatureRequired", "Signature Required", "bg-fuchsia-50 text-fuchsia-700"],
  ["Signed", "Signed", "bg-indigo-50 text-indigo-700"],
  ["Finalized", "Finalized", "bg-emerald-50 text-emerald-700"],
  ["NotRequired", "Not Required", "bg-zinc-100 text-zinc-600"],
];

const requirementStyle = {
  Required: "bg-rose-50 text-rose-700",
  Conditional: "bg-amber-50 text-amber-700",
  Optional: "bg-slate-100 text-slate-600",
};
const versionStatusStyle = {
  Unverified: ["Unverified", "bg-slate-100 text-slate-600"],
  Current: ["Current version", "bg-emerald-50 text-emerald-700"],
  UpdateAvailable: ["Update available", "bg-sky-50 text-sky-700"],
  UnsupportedRevision: ["Mapping review needed", "bg-rose-50 text-rose-700"],
  SourceUnavailable: ["Source unavailable", "bg-amber-50 text-amber-800"],
  PortalOnly: ["Portal only", "bg-violet-50 text-violet-700"],
};

function formatVersionDate(value) {
  if (!value) return "Not checked";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not checked"
    : date.toLocaleString("en-CA", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function FormActions({
  item,
  onUpload,
  onDownload,
  onOpenOfficial,
  onCheckVersion,
  onShowVersions,
  onImportLatest,
  onReviewComments,
  onAudit,
  onSaveTemplate,
  onUnlock,
  permissions,
  onDelete,
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect)
        setPosition({
          top: Math.min(rect.bottom + 7, window.innerHeight - 190),
          left: Math.max(12, rect.right - 210),
        });
    };
    const outside = (event) => {
      if (
        !buttonRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      )
        setOpen(false);
    };
    place();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  const action = (handler) => () => {
    setOpen(false);
    handler();
  };
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`More options for ${item.title}`}
        className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <Ellipsis className="h-4 w-4" />
      </button>
      {open
        ? createPortal(
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: -5, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              style={{
                position: "fixed",
                top: position.top,
                left: position.left,
                width: 224,
              }}
              className="z-[405] max-h-[min(32rem,calc(100vh-24px))] overflow-y-auto rounded-2xl border border-white/90 bg-white/95 p-1.5 shadow-[0_18px_55px_rgba(15,23,42,0.22)] ring-1 ring-slate-900/5 backdrop-blur-xl"
            >
              {item.source === "Catalog" ? (
                <button
                  type="button"
                  onClick={action(onCheckVersion)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-slate-400" />
                  Check official version
                </button>
              ) : null}
              {["UpdateAvailable", "UnsupportedRevision"].includes(
                item.versionStatus,
              ) ? (
                <button
                  type="button"
                  onClick={action(onImportLatest)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-sky-700 hover:bg-sky-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  Import latest revision
                </button>
              ) : null}
              <button
                type="button"
                onClick={action(onShowVersions)}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Clock3 className="h-3.5 w-3.5 text-slate-400" />
                Version history
              </button>
              <button
                type="button"
                onClick={action(onReviewComments)}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <MessageSquareText className="h-3.5 w-3.5 text-slate-400" />
                Review comments
                {item._count?.reviewComments ? (
                  <span className="ml-auto rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] text-amber-700">
                    {item._count.reviewComments}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={action(onAudit)}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <ScrollText className="h-3.5 w-3.5 text-slate-400" />
                Audit history
              </button>
              <div className="my-1 border-t border-slate-100" />
              {!item.lockedAt && permissions.canEdit ? (
                <>
                  <button
                    type="button"
                    onClick={action(() => onUpload("Working"))}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <UploadCloud className="h-3.5 w-3.5 text-slate-400" />
                    Upload working copy
                  </button>
                  <button
                    type="button"
                    onClick={action(() => onUpload("Filled"))}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <FileCheck2 className="h-3.5 w-3.5 text-slate-400" />
                    Upload filled copy
                  </button>
                  <button
                    type="button"
                    onClick={action(() => onUpload("ClientSigned"))}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <Check className="h-3.5 w-3.5 text-slate-400" />
                    Upload client-signed copy
                  </button>
                </>
              ) : null}
              {item.storageKey ? (
                <button
                  type="button"
                  onClick={action(onDownload)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <Download className="h-3.5 w-3.5 text-slate-400" />
                  Download current copy
                </button>
              ) : null}
              {item.officialUrl ? (
                <button
                  type="button"
                  onClick={action(onOpenOfficial)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                  Open official source
                </button>
              ) : null}
              {item.storageKey &&
              !item.sourceAgencyFormTemplateId &&
              permissions.canManageTemplates ? (
                <button
                  type="button"
                  onClick={action(onSaveTemplate)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-violet-700 hover:bg-violet-50"
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                  Save as workspace template
                </button>
              ) : null}
              {item.lockedAt && permissions.canUnlock ? (
                <button
                  type="button"
                  onClick={action(onUnlock)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-amber-700 hover:bg-amber-50"
                >
                  <UnlockKeyhole className="h-3.5 w-3.5" />
                  Unlock finalized form
                </button>
              ) : null}
              <div className="my-1 border-t border-slate-100" />
              {permissions.canDelete ? (
                <button
                  type="button"
                  onClick={action(onDelete)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove from case
                </button>
              ) : null}
            </motion.div>,
            document.body,
          )
        : null}
    </>
  );
}

function formatSize(value) {
  if (!value) return "";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function AddFormsOverlay({
  catalog,
  templates,
  assigned,
  saving,
  error,
  onClose,
  onAssign,
  onAssignTemplates,
  onCreateCustom,
  onOpenFieldMapping,
  canManageTemplates,
}) {
  const [mode, setMode] = useState("suggested");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [selectedTemplates, setSelectedTemplates] = useState(new Set());
  const [custom, setCustom] = useState({
    title: "",
    formNumber: "",
    requirement: "Required",
    language: "English",
    sourceRevision: "",
    selectionReason: "",
    category: "General",
    saveAsTemplate: false,
  });
  const [file, setFile] = useState(null);
  const assignedCatalogIds = useMemo(
    () => new Set(assigned.map((item) => item.catalogId).filter(Boolean)),
    [assigned],
  );
  const visible = useMemo(
    () =>
      (catalog?.forms || []).filter((item) => {
        if (mode === "suggested" && !item.suggested) return false;
        const value = `${item.number} ${item.title}`.toLowerCase();
        return !search.trim() || value.includes(search.trim().toLowerCase());
      }),
    [catalog, mode, search],
  );
  const visibleTemplates = useMemo(
    () =>
      (templates || []).filter(
        (item) =>
          !search.trim() ||
          `${item.formNumber || ""} ${item.title} ${item.category}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
      ),
    [templates, search],
  );

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close forms"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white/95 shadow-[0_35px_100px_rgba(15,23,42,0.28)]"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-600">
              Case forms
            </p>
            <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
              Add forms to this case
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Use CaseDesk suggestions, browse every form, or add a consultant
              form.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 pt-4">
          <div className="grid grid-cols-2 rounded-2xl bg-slate-100 p-1 sm:grid-cols-4">
            {[
              ["suggested", "Suggested"],
              ["catalog", "All Forms"],
              ["library", "Workspace Library"],
              ["custom", "Custom Form"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={`relative rounded-xl px-3 py-2 text-xs font-semibold transition ${mode === id ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {mode === "custom" ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-700">
                Form title
                <input
                  autoFocus
                  value={custom.title}
                  onChange={(event) =>
                    setCustom((value) => ({
                      ...value,
                      title: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-sky-400"
                  placeholder="Client consent form"
                />
              </label>
              <label className="text-xs font-semibold text-slate-700">
                Form number{" "}
                <span className="font-normal text-slate-400">(optional)</span>
                <input
                  value={custom.formNumber}
                  onChange={(event) =>
                    setCustom((value) => ({
                      ...value,
                      formNumber: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-sky-400"
                  placeholder="FORM 001"
                />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-xs font-semibold text-slate-700">
                Requirement
                <select
                  value={custom.requirement}
                  onChange={(event) =>
                    setCustom((value) => ({
                      ...value,
                      requirement: event.target.value,
                    }))
                  }
                  className="select-field mt-2 w-full"
                >
                  <option>Required</option>
                  <option>Conditional</option>
                  <option>Optional</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                Language
                <select
                  value={custom.language}
                  onChange={(event) =>
                    setCustom((value) => ({
                      ...value,
                      language: event.target.value,
                    }))
                  }
                  className="select-field mt-2 w-full"
                >
                  <option>English</option>
                  <option>French</option>
                  <option>Bilingual</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                Revision{" "}
                <span className="font-normal text-slate-400">(optional)</span>
                <input
                  value={custom.sourceRevision}
                  onChange={(event) =>
                    setCustom((value) => ({
                      ...value,
                      sourceRevision: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-sky-400"
                  placeholder="2026-07"
                />
              </label>
            </div>
            <label className="block text-xs font-semibold text-slate-700">
              Why this form is needed
              <textarea
                rows="2"
                value={custom.selectionReason}
                onChange={(event) =>
                  setCustom((value) => ({
                    ...value,
                    selectionReason: event.target.value,
                  }))
                }
                className="mt-2 w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-sky-400"
                placeholder="Added by consultant"
              />
            </label>
            {canManageTemplates ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Library category
                  <input
                    value={custom.category}
                    onChange={(event) =>
                      setCustom((value) => ({
                        ...value,
                        category: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-sky-400"
                    placeholder="Consent & Retainers"
                  />
                </label>
                <label
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${file ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-55"}`}
                >
                  <input
                    type="checkbox"
                    disabled={!file}
                    checked={custom.saveAsTemplate && Boolean(file)}
                    onChange={(event) =>
                      setCustom((value) => ({
                        ...value,
                        saveAsTemplate: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span>
                    <span className="block text-xs font-semibold text-slate-700">
                      Save to workspace library
                    </span>
                    <span className="mt-0.5 block text-[10px] text-slate-400">
                      Reusable across multiple cases
                    </span>
                  </span>
                </label>
              </div>
            ) : null}
            <label
              className={`flex cursor-pointer items-center gap-4 rounded-2xl border border-dashed p-4 transition ${file ? "border-emerald-200 bg-emerald-50/70" : "border-slate-300 bg-slate-50 hover:border-sky-300"}`}
            >
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${file ? "bg-emerald-100 text-emerald-700" : "bg-white text-sky-600"}`}
              >
                <UploadCloud className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-800">
                  {file ? file.name : "Upload a custom form template"}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Optional · PDF, Word, RTF or text · up to 25 MB
                </span>
              </span>
              <input
                type="file"
                accept={acceptedTypes}
                className="hidden"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </label>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
            <label className="relative block">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by form number or title"
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-sky-300 focus:bg-white"
              />
            </label>
            <div className="mt-3 max-h-[48vh] overflow-y-auto rounded-2xl border border-slate-100">
              {mode === "library"
                ? visibleTemplates.map((item) => {
                    const checked = selectedTemplates.has(item.id);
                    const alreadyAssigned = assigned.some(
                      (form) => form.sourceAgencyFormTemplateId === item.id,
                    );
                    return (
                      <div
                        key={item.id}
                        className={`flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0 ${alreadyAssigned ? "bg-slate-50 opacity-55" : checked ? "bg-violet-50" : "hover:bg-slate-50"}`}
                      >
                        <button
                          type="button"
                          disabled={alreadyAssigned}
                          onClick={() =>
                            setSelectedTemplates((current) => {
                              const next = new Set(current);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            })
                          }
                          className="flex min-w-0 flex-1 items-start gap-3 text-left"
                        >
                          <span
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300 bg-white"}`}
                          >
                            {checked ? <Check className="h-3 w-3" /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-bold text-violet-700">
                                {item.formNumber || item.category}
                              </span>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-600">
                                v{item.currentVersion}
                              </span>
                              {alreadyAssigned ? (
                                <span className="text-[10px] font-semibold text-emerald-600">
                                  Assigned
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-1 block text-sm font-semibold text-slate-900">
                              {item.title}
                            </span>
                            <span className="mt-1 block text-xs text-slate-500">
                              {item.category} · {item._count?.caseForms || 0}{" "}
                              active use{item._count?.caseForms === 1 ? "" : "s"}{" "}
                              · {item._count?.versions || 1} version
                              {item._count?.versions === 1 ? "" : "s"}
                            </span>
                          </span>
                        </button>
                        {canManageTemplates ? (
                          <button
                            type="button"
                            onClick={() => onOpenFieldMapping(item)}
                            className="mt-0.5 shrink-0 rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-violet-700 hover:bg-violet-50"
                          >
                            Field mapping
                          </button>
                        ) : null}
                      </div>
                    );
                  })
                : visible.map((item) => {
                    const alreadyAssigned = assignedCatalogIds.has(item.id);
                    const checked = selected.has(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={alreadyAssigned}
                        onClick={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          })
                        }
                        className={`flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0 ${alreadyAssigned ? "bg-slate-50 opacity-55" : checked ? "bg-sky-50" : "hover:bg-slate-50"}`}
                      >
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 bg-white"}`}
                        >
                          {checked ? <Check className="h-3 w-3" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-sky-700">
                              {item.number}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${requirementStyle[item.requirement]}`}
                            >
                              {item.requirement}
                            </span>
                            {alreadyAssigned ? (
                              <span className="text-[10px] font-semibold text-emerald-600">
                                Assigned
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-1 block text-sm font-semibold text-slate-900">
                            {item.title}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-slate-500">
                            {item.reason}
                          </span>
                        </span>
                      </button>
                    );
                  })}
              {!(mode === "library" ? visibleTemplates : visible).length ? (
                <div className="px-6 py-10 text-center">
                  <Sparkles className="mx-auto h-6 w-6 text-slate-300" />
                  <p className="mt-2 text-sm font-semibold text-slate-700">
                    No matching forms
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {mode === "library"
                      ? "Save a custom form to the workspace library first."
                      : "Browse all forms or add a custom form."}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        )}
        {error ? (
          <p className="mx-6 mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-5 py-4">
          <p className="text-[10px] leading-4 text-slate-400">
            Confirm current requirements against the official application
            package before submission.
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                saving ||
                (mode === "custom"
                  ? !custom.title.trim()
                  : mode === "library"
                    ? !selectedTemplates.size
                    : !selected.size)
              }
              onClick={() =>
                mode === "custom"
                  ? onCreateCustom(custom, file)
                  : mode === "library"
                    ? onAssignTemplates([...selectedTemplates])
                    : onAssign([...selected])
              }
              className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              {saving
                ? "Saving…"
                : mode === "custom"
                  ? custom.saveAsTemplate
                    ? "Save & Add Template"
                    : "Add Custom Form"
                  : mode === "library"
                    ? `Add ${selectedTemplates.size || ""} Template${selectedTemplates.size === 1 ? "" : "s"}`
                    : `Assign ${selected.size || ""} Form${selected.size === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

function VersionHistoryOverlay({
  item,
  versions,
  loading,
  savingId,
  error,
  onClose,
  onRestore,
  onDownload,
}) {
  return createPortal(
    <div className="fixed inset-0 z-[415] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close version history"
      />
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.25)]"
      >
        <header className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-600">
              Immutable history
            </p>
            <h3 className="mt-1 text-lg font-semibold text-slate-950">
              {item.formNumber || item.title} versions
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Restoring creates a new version; it never deletes later history.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? (
            <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          ) : null}
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  className="h-20 animate-pulse rounded-2xl bg-slate-100"
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {versions.map((version, index) => (
                <div
                  key={version.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${index === 0 ? "border-emerald-200 bg-emerald-50/40" : "border-slate-100 bg-slate-50/60"}`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        Version {version.versionNumber}
                      </span>
                      {index === 0 ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">
                          Latest history entry
                        </span>
                      ) : null}
                      <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-semibold text-slate-500 ring-1 ring-slate-200">
                        {String(version.source).replace(
                          /([a-z])([A-Z])/g,
                          "$1 $2",
                        )}
                      </span>
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-semibold text-sky-700">
                        {String(version.copyType).replace(
                          /([a-z])([A-Z])/g,
                          "$1 $2",
                        )}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {version.originalFilename} ·{" "}
                      {formatSize(version.fileSize)} · {version.language}
                      {version.sourceRevision
                        ? ` · Rev ${version.sourceRevision}`
                        : ""}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-400">
                      SHA-256 {version.fileHash.slice(0, 12)}… ·{" "}
                      {formatVersionDate(version.createdAt)} ·{" "}
                      {version.createdBy?.fullName || "Staff"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onDownload(version)}
                      className="rounded-full px-3 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-white"
                    >
                      Download
                    </button>
                    <button
                      type="button"
                      onClick={() => onRestore(version)}
                      disabled={savingId === version.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-semibold text-slate-700 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" />
                      {savingId === version.id ? "Restoring…" : "Restore"}
                    </button>
                  </div>
                </div>
              ))}
              {!versions.length ? (
                <p className="py-10 text-center text-sm text-slate-500">
                  No stored versions yet.
                </p>
              ) : null}
            </div>
          )}
        </main>
      </motion.div>
    </div>,
    document.body,
  );
}

function ImportUpdateOverlay({ item, saving, error, onClose, onConfirm }) {
  const unsupported = item.versionStatus === "UnsupportedRevision";
  return createPortal(
    <div className="fixed inset-0 z-[416] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Cancel form update"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-md rounded-[1.8rem] border border-white bg-white p-6 shadow-[0_28px_80px_rgba(15,23,42,0.25)]"
      >
        <span
          className={`flex h-11 w-11 items-center justify-center rounded-2xl ${unsupported ? "bg-rose-50 text-rose-600" : "bg-sky-50 text-sky-600"}`}
        >
          <RefreshCw className="h-5 w-5" />
        </span>
        <h3 className="mt-4 text-lg font-semibold text-slate-950">
          Import the latest official revision?
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          The current file remains in version history. The new official file
          becomes the working copy as a separate immutable version.
        </p>
        {item.availableRevision ? (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
            Available revision: {item.availableRevision}
          </p>
        ) : null}
        {unsupported ? (
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
            This revision does not yet have a verified CaseDesk autofill
            mapping. It can be stored and reviewed, but autofill will remain
            disabled.
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </p>
        ) : null}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
          >
            Keep Current
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Importing…" : "Import Revision"}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

const readinessMeta = {
  ready: {
    label: "Ready",
    icon: CheckCircle2,
    dot: "bg-emerald-500",
    card: "bg-emerald-50 text-emerald-700",
  },
  missing: {
    label: "Missing",
    icon: AlertCircle,
    dot: "bg-rose-500",
    card: "bg-rose-50 text-rose-700",
  },
  review: {
    label: "Review",
    icon: CircleHelp,
    dot: "bg-amber-500",
    card: "bg-amber-50 text-amber-800",
  },
  conditional: {
    label: "Conditional",
    icon: CircleHelp,
    dot: "bg-violet-500",
    card: "bg-violet-50 text-violet-700",
  },
};

function MissingInformationOverlay({
  item,
  readiness,
  onClose,
  onOpenProfileSection,
  onEditClient,
  onOpenAssessment,
}) {
  const [filter, setFilter] = useState(
    readiness.analysis?.missing
      ? "missing"
      : readiness.analysis?.review
        ? "review"
        : "ready",
  );
  const fields = readiness.fields.filter((entry) => entry.status === filter);
  return createPortal(
    <div className="fixed inset-0 z-[420] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close form readiness"
      />
      <motion.section
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.28)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-600">
              Form readiness
            </p>
            <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
              {item.formNumber ? `${item.formNumber} · ` : ""}
              {item.title}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Resolve missing details in Profile before applying autofill.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="grid grid-cols-2 gap-2 border-b border-slate-100 px-6 py-4 sm:grid-cols-4">
          {Object.entries(readinessMeta).map(([key, meta]) => {
            const Icon = meta.icon;
            const count = readiness.analysis?.[key] || 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-2xl px-3 py-3 text-left transition ${filter === key ? `${meta.card} ring-1 ring-current/10` : "bg-slate-50 text-slate-500 hover:bg-slate-100"}`}
              >
                <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em]">
                  <Icon className="h-3.5 w-3.5" />
                  {meta.label}
                </span>
                <span className="mt-2 block text-xl font-semibold">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-5">
          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
            {fields.map((entry) => (
              <div
                key={entry.key}
                className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center"
              >
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${readinessMeta[entry.status].dot}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    {entry.label}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-500">
                    {entry.note ||
                      (entry.value
                        ? entry.value
                        : entry.profileTab
                          ? `Add this under ${entry.profileTab.toLowerCase()}.`
                          : "Add this information to continue.")}
                  </p>
                </div>
                {entry.status !== "ready" ? (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      if (entry.clientField) onEditClient?.();
                      else if (entry.assessmentOverlay) onOpenAssessment?.();
                      else
                        onOpenProfileSection?.(
                          entry.profileTab,
                          entry.profileView,
                        );
                    }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-950 px-3 py-2 text-[11px] font-semibold text-white"
                  >
                    {entry.clientField
                      ? "Edit Client"
                      : entry.assessmentOverlay
                        ? "Update Assessment"
                        : "Open Profile"}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
                    Available
                  </span>
                )}
              </div>
            ))}
            {!fields.length ? (
              <div className="px-6 py-10 text-center">
                <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-500" />
                <p className="mt-2 text-sm font-semibold text-slate-800">
                  Nothing in this category
                </p>
              </div>
            ) : null}
          </div>
        </main>
        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          <p className="text-xs text-slate-500">
            Mapping {readiness.mappingVersion || "not configured"}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white"
          >
            Done
          </button>
        </footer>
      </motion.section>
    </div>,
    document.body,
  );
}

function ReviewCommentsOverlay({
  item,
  comments,
  loading,
  saving,
  error,
  onClose,
  onCreate,
  onResolve,
  onDelete,
  canEdit,
}) {
  const [draft, setDraft] = useState({
    pageNumber: "",
    fieldName: "",
    comment: "",
  });
  const openCount = comments.filter((comment) => !comment.resolvedAt).length;
  return createPortal(
    <div className="fixed inset-0 z-[420] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close review comments"
      />
      <motion.section
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.28)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-600">
              Form review
            </p>
            <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
              Review comments
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {item.formNumber ? `${item.formNumber} · ` : ""}
              {item.title} · {openCount} open
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-5">
          {canEdit ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                try {
                  await onCreate(draft);
                  setDraft({ pageNumber: "", fieldName: "", comment: "" });
                } catch {
                  // Keep the draft visible beside the inline error.
                }
              }}
              className="rounded-2xl border border-slate-100 bg-white p-4"
            >
              <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                <label className="text-xs font-semibold text-slate-700">
                  Page{" "}
                  <span className="font-normal text-slate-400">(optional)</span>
                  <input
                    type="number"
                    min="1"
                    max="999"
                    value={draft.pageNumber}
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        pageNumber: event.target.value,
                      }))
                    }
                    className="mt-2 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-violet-300"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Field or section{" "}
                  <span className="font-normal text-slate-400">(optional)</span>
                  <input
                    value={draft.fieldName}
                    maxLength="160"
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        fieldName: event.target.value,
                      }))
                    }
                    placeholder="Passport expiry date"
                    className="mt-2 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-violet-300"
                  />
                </label>
              </div>
              <label className="mt-3 block text-xs font-semibold text-slate-700">
                Comment
                <textarea
                  required
                  rows="3"
                  maxLength="4000"
                  value={draft.comment}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      comment: event.target.value,
                    }))
                  }
                  placeholder="Describe the correction or information needed…"
                  className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-violet-300"
                />
              </label>
              {error ? (
                <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {error}
                </p>
              ) : null}
              <div className="mt-3 flex justify-end">
                <button
                  type="submit"
                  disabled={saving || !draft.comment.trim()}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-45"
                >
                  <Send className="h-3.5 w-3.5" />
                  {saving ? "Adding…" : "Add comment"}
                </button>
              </div>
            </form>
          ) : null}
          <div className="mt-4 space-y-3">
            {loading
              ? Array.from({ length: 3 }, (_, index) => (
                  <div
                    key={index}
                    className="h-24 animate-pulse rounded-2xl bg-white"
                  />
                ))
              : comments.map((comment) => (
                  <article
                    key={comment.id}
                    className={`rounded-2xl border p-4 ${comment.resolvedAt ? "border-slate-100 bg-white/70 opacity-70" : "border-amber-100 bg-white"}`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${comment.resolvedAt ? "bg-emerald-500" : "bg-amber-500"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                          {comment.pageNumber ? (
                            <span>Page {comment.pageNumber}</span>
                          ) : null}
                          {comment.fieldName ? (
                            <span>· {comment.fieldName}</span>
                          ) : null}
                          <span>
                            · {comment.createdBy?.fullName || "Staff"}
                          </span>
                        </div>
                        <p
                          className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${comment.resolvedAt ? "text-slate-500 line-through decoration-slate-300" : "text-slate-800"}`}
                        >
                          {comment.comment}
                        </p>
                        {comment.resolvedAt ? (
                          <p className="mt-2 text-[10px] font-semibold text-emerald-600">
                            Resolved by{" "}
                            {comment.resolvedBy?.fullName || "staff"}
                          </p>
                        ) : null}
                      </div>
                      {canEdit ? (
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              onResolve(comment, Boolean(comment.resolvedAt))
                            }
                            disabled={saving}
                            title={comment.resolvedAt ? "Reopen" : "Resolve"}
                            className={`flex h-8 w-8 items-center justify-center rounded-full ${comment.resolvedAt ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}
                          >
                            {comment.resolvedAt ? (
                              <RotateCcw className="h-3.5 w-3.5" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(comment)}
                            disabled={saving}
                            title="Delete comment"
                            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
            {!loading && !comments.length ? (
              <div className="rounded-2xl bg-white px-6 py-10 text-center">
                <MessageSquareText className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  No review comments yet
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Add a page or field reference when requesting a correction.
                </p>
              </div>
            ) : null}
          </div>
        </main>
        <footer className="flex justify-end border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white"
          >
            Done
          </button>
        </footer>
      </motion.section>
    </div>,
    document.body,
  );
}

function FormAuditOverlay({ item, events, loading, error, onClose }) {
  const labels = {
    Assigned: "Form assigned",
    OfficialRevisionImported: "Official revision imported",
    AutofillApplied: "Autofill applied",
    WorkingCopySaved: "Working copy saved",
    FilledCopySaved: "Filled copy saved",
    ClientSignedCopyUploaded: "Client-signed copy uploaded",
    ReviewCommentAdded: "Review comment added",
    ReadyForReview: "Ready for review",
    ChangesRequested: "Changes requested",
    Approved: "Form approved",
    SignatureRequired: "Signature required",
    Signed: "Form signed",
    Finalized: "Form finalized",
    Unlocked: "Form unlocked",
    VersionRestored: "Version restored",
    RevisionStatusChanged: "Revision status changed",
    Deleted: "Form deleted",
  };
  return createPortal(
    <div className="fixed inset-0 z-[420] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close form audit history"
      />
      <motion.section
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.28)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-600">
              Immutable timeline
            </p>
            <h3 className="mt-1 text-xl font-semibold text-slate-950">
              Form audit history
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {item.formNumber ? `${item.formNumber} · ` : ""}
              {item.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-5">
          {error ? (
            <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          ) : null}
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  key={index}
                  className="h-20 animate-pulse rounded-2xl bg-white"
                />
              ))}
            </div>
          ) : (
            <div className="relative space-y-3 before:absolute before:bottom-4 before:left-[0.7rem] before:top-4 before:w-px before:bg-slate-200">
              {events.map((event) => (
                <article
                  key={event.id}
                  className="relative flex gap-4 rounded-2xl border border-slate-100 bg-white p-4"
                >
                  <span className="relative z-10 mt-1 h-3 w-3 shrink-0 rounded-full border-[3px] border-white bg-sky-500 ring-1 ring-sky-100" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {labels[event.event] ||
                          String(event.event).replace(
                            /([a-z])([A-Z])/g,
                            "$1 $2",
                          )}
                      </p>
                      <time className="text-[10px] font-medium text-slate-400">
                        {formatVersionDate(event.createdAt)}
                      </time>
                    </div>
                    {event.details ? (
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {event.details}
                      </p>
                    ) : null}
                    <p className="mt-2 text-[10px] font-semibold text-slate-400">
                      {event.user?.fullName || "CaseDesk background service"}
                    </p>
                  </div>
                </article>
              ))}
              {!events.length ? (
                <div className="rounded-2xl bg-white px-6 py-10 text-center">
                  <ScrollText className="mx-auto h-7 w-7 text-slate-300" />
                  <p className="mt-2 text-sm font-semibold text-slate-700">
                    No audit events yet
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </main>
        <footer className="flex justify-end border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white"
          >
            Done
          </button>
        </footer>
      </motion.section>
    </div>,
    document.body,
  );
}

function PackageSummary({ forms, caseItem, assessment }) {
  const metrics = useMemo(() => {
    const active = forms.filter((item) => item.status !== "NotRequired");
    const required = active.filter((item) => item.requirement === "Required");
    const completedStatuses = new Set(["Approved", "Signed", "Finalized"]);
    const completed = active.filter((item) =>
      completedStatuses.has(item.status),
    );
    const completedRequired = required.filter((item) =>
      completedStatuses.has(item.status),
    );
    const information = active.filter((item) => {
      if (item.status === "InformationMissing") return true;
      return Boolean(
        buildCaseFormAutofill(item, caseItem, assessment).analysis?.missing,
      );
    });
    const signatures = active.filter(
      (item) => item.status === "SignatureRequired",
    );
    const optional = active.filter((item) =>
      ["Optional", "Conditional"].includes(item.requirement),
    );
    const outdated = active.filter((item) =>
      ["UpdateAvailable", "UnsupportedRevision"].includes(item.versionStatus),
    );
    return {
      required: required.length,
      completed: completed.length,
      information: information.length,
      signatures: signatures.length,
      optional: optional.length,
      outdated: outdated.length,
      percent: required.length
        ? Math.round((completedRequired.length / required.length) * 100)
        : active.length
          ? 0
          : 100,
    };
  }, [forms, caseItem, assessment]);
  const cards = [
    ["Required", metrics.required, "text-slate-700"],
    ["Completed", metrics.completed, "text-emerald-700"],
    ["Need information", metrics.information, "text-rose-700"],
    ["Need signature", metrics.signatures, "text-fuchsia-700"],
    ["Optional / conditional", metrics.optional, "text-amber-700"],
    ["Outdated", metrics.outdated, "text-sky-700"],
  ];
  return (
    <section className="border-b border-slate-100 bg-[linear-gradient(135deg,#f8fafc,#f1f5f9)] px-4 py-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex shrink-0 items-center gap-3">
          <div
            className="relative grid h-16 w-16 place-items-center rounded-full"
            style={{
              background: `conic-gradient(#0f172a ${metrics.percent}%, #e2e8f0 0)`,
            }}
          >
            <div className="grid h-12 w-12 place-items-center rounded-full bg-white text-sm font-semibold text-slate-950">
              {metrics.percent}%
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Package progress
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {metrics.completed} form{metrics.completed === 1 ? "" : "s"}{" "}
              complete
            </p>
          </div>
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {cards.map(([label, value, color]) => (
            <div
              key={label}
              className="rounded-2xl border border-white bg-white/80 px-3 py-2.5 shadow-sm"
            >
              <p className={`text-lg font-semibold ${color}`}>{value}</p>
              <p
                className="mt-0.5 truncate text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400"
                title={label}
              >
                {label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function CaseFormsWorkspace({
  caseId,
  caseItem,
  assessment,
  onCountChange,
  onOpenProfileSection,
  onEditClient,
  onOpenAssessment,
}) {
  const [forms, setForms] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [permissions, setPermissions] = useState({
    canAssign: false,
    canEdit: false,
    canReview: false,
    canApprove: false,
    canFinalize: false,
    canDelete: false,
    canUnlock: false,
    canManageTemplates: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [versionNotice, setVersionNotice] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [pdfPreview, setPdfPreview] = useState(null);
  const [versionTarget, setVersionTarget] = useState(null);
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionActionError, setVersionActionError] = useState("");
  const [restoreBusyId, setRestoreBusyId] = useState("");
  const [updateTarget, setUpdateTarget] = useState(null);
  const [readinessTarget, setReadinessTarget] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewComments, setReviewComments] = useState([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [checklistTarget, setChecklistTarget] = useState(null);
  const [mappingTarget, setMappingTarget] = useState(null);
  const [auditTarget, setAuditTarget] = useState(null);
  const [auditEvents, setAuditEvents] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [search, setSearch] = useState("");
  const [agencyProfile, setAgencyProfile] = useState(null);
  const uploadInput = useRef(null);
  const uploadTarget = useRef(null);

  function representativeFor(item) {
    const normalizedNumber = String(item?.formNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    // IMM 5476 is a legal appointment. Never silently substitute the case
    // assignee: staff must explicitly choose a licensed representative.
    if (normalizedNumber === "IMM5476") return item?.representativeUser || null;
    return item?.representativeUser || caseItem?.assignedUser || null;
  }

  async function load() {
    try {
      setLoading(true);
      setError("");
      const [formsResponse, catalogResponse, templateResponse, agencyResponse] =
        await Promise.all([
          api.get(`/case-forms?caseId=${caseId}`),
          api.get(`/case-forms/catalog?caseId=${caseId}`),
          api.get("/form-templates?limit=100"),
          api.get("/settings/agency-profile").catch(() => null),
        ]);
      setForms(formsResponse.data.data || []);
      setPermissions(formsResponse.data.meta?.permissions || {});
      setCatalog(catalogResponse.data.data || null);
      setTemplates(templateResponse.data.data || []);
      setAgencyProfile(agencyResponse?.data?.data || null);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message || "Unable to load case forms.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [caseId]);
  useEffect(() => {
    onCountChange?.(
      forms.filter((item) => item.status !== "NotRequired").length,
    );
  }, [forms, onCountChange]);

  const visible = useMemo(
    () =>
      forms.filter(
        (item) =>
          !search.trim() ||
          `${item.formNumber || ""} ${item.title} ${item.status}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
      ),
    [forms, search],
  );

  const templatesById = useMemo(
    () => new Map((templates || []).map((entry) => [entry.id, entry])),
    [templates],
  );
  function isImm5476Form(item) {
    return String(item?.formNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "") === "IMM5476";
  }
  // The checklist pill promises pdf-lib-based auto-fill, which only works
  // when the source template actually has mapped AcroForm fields (some real
  // government PDFs — e.g. dynamic XFA forms — have none; pdf-lib can't
  // read or write them at all). Hide the pill rather than send someone into
  // an overlay that can only ever say "nothing to fill". If the template
  // hasn't loaded yet, default to showing it rather than hiding something
  // that might actually work.
  function hasMappedFields(item) {
    if (!item.sourceAgencyFormTemplateId) return false;
    const template = templatesById.get(item.sourceAgencyFormTemplateId);
    if (!template) return true;
    return (template._count?.fieldSchemas ?? 1) > 0;
  }

  async function assign(catalogIds) {
    try {
      setSaving(true);
      setError("");
      const response = await api.post("/case-forms/assign", {
        caseId,
        catalogIds,
      });
      const returned = response.data.data || [];
      setForms((current) => [
        ...returned,
        ...current.filter(
          (item) => !returned.some((entry) => entry.id === item.id),
        ),
      ]);
      setAddOpen(false);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message || "Unable to assign forms.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function createCustom(values, file) {
    try {
      setSaving(true);
      setError("");
      if (values.saveAsTemplate && file) {
        const templateBody = new FormData();
        [
          "title",
          "formNumber",
          "language",
          "sourceRevision",
          "category",
        ].forEach((key) => templateBody.append(key, values[key] || ""));
        templateBody.append("description", values.selectionReason || "");
        templateBody.append("file", file);
        const templateResponse = await api.post(
          "/form-templates/upload",
          templateBody,
          { timeout: 60000 },
        );
        const template = templateResponse.data.data;
        const assignedResponse = await api.post(
          `/form-templates/${template.id}/add-to-case`,
          { caseId, requirement: values.requirement },
        );
        setTemplates((current) => [template, ...current]);
        setForms((current) => [assignedResponse.data.data, ...current]);
        setAddOpen(false);
        setVersionNotice(
          `${template.title} saved to the workspace library and added to this case.`,
        );
        return;
      }
      const body = new FormData();
      body.append("caseId", caseId);
      Object.entries(values)
        .filter(([, value]) => typeof value !== "boolean")
        .forEach(([key, value]) => body.append(key, value));
      if (file) body.append("file", file);
      const response = await api.post("/case-forms/custom", body, {
        timeout: 60000,
      });
      setForms((current) => [response.data.data, ...current]);
      setAddOpen(false);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to add the custom form.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function assignTemplates(templateIds) {
    try {
      setSaving(true);
      setError("");
      const responses = await Promise.all(
        templateIds.map((id) =>
          api.post(`/form-templates/${id}/add-to-case`, { caseId }),
        ),
      );
      const added = responses.map((response) => response.data.data);
      setForms((current) => [...added, ...current]);
      setTemplates((current) =>
        current.map((template) =>
          templateIds.includes(template.id)
            ? {
                ...template,
                _count: {
                  ...template._count,
                  caseForms: (template._count?.caseForms || 0) + 1,
                },
              }
            : template,
        ),
      );
      setAddOpen(false);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to add the selected workspace templates.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveAsAgencyTemplate(item) {
    try {
      setBusyId(item.id);
      setError("");
      const response = await api.post(
        `/form-templates/from-case-form/${item.id}`,
        { category: "General" },
      );
      const template = response.data.data;
      setTemplates((current) => [template, ...current]);
      setVersionNotice(
        `${item.title} is now available in the workspace form library.`,
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to save this form as a workspace template.",
      );
    } finally {
      setBusyId("");
    }
  }

  async function update(item, changes) {
    try {
      setBusyId(item.id);
      setError("");
      const response = await api.patch(`/case-forms/${item.id}`, changes);
      setForms((current) =>
        current.map((entry) =>
          entry.id === item.id ? response.data.data : entry,
        ),
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message || "Unable to update the form.",
      );
    } finally {
      setBusyId("");
    }
  }

  async function finalize(item) {
    try {
      setBusyId(item.id);
      setError("");
      const response = await api.post(`/case-forms/${item.id}/finalize`);
      setForms((current) =>
        current.map((entry) =>
          entry.id === item.id ? response.data.data : entry,
        ),
      );
      setVersionNotice(
        `${item.formNumber || item.title} finalized and locked.`,
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message || "Unable to finalize this form.",
      );
    } finally {
      setBusyId("");
    }
  }

  async function unlock(item) {
    try {
      setBusyId(item.id);
      setError("");
      const response = await api.post(`/case-forms/${item.id}/unlock`);
      setForms((current) =>
        current.map((entry) =>
          entry.id === item.id ? response.data.data : entry,
        ),
      );
      setVersionNotice(
        `${item.formNumber || item.title} unlocked for changes.`,
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message || "Unable to unlock this form.",
      );
    } finally {
      setBusyId("");
    }
  }

  async function importOfficial(item, confirmReplace = false) {
    try {
      setBusyId(item.id);
      setError("");
      setVersionActionError("");
      const response = await api.post(
        `/case-forms/${item.id}/import`,
        { confirmReplace },
        { timeout: 60000 },
      );
      setForms((current) =>
        current.map((entry) =>
          entry.id === item.id ? response.data.data : entry,
        ),
      );
      setUpdateTarget(null);
      setVersionNotice(
        response.data.meta?.unchanged
          ? "The stored file already matches the latest official version."
          : `${item.formNumber || item.title} imported as a new immutable version.`,
      );
    } catch (requestError) {
      const message =
        requestError.response?.data?.message ||
        "Unable to import this official form. Open the IRCC source instead.";
      setError(message);
      setVersionActionError(message);
    } finally {
      setBusyId("");
    }
  }

  async function checkVersion(item) {
    try {
      setBusyId(item.id);
      setError("");
      setVersionNotice("");
      const response = await api.post(
        `/case-forms/${item.id}/check-version`,
        {},
        { timeout: 60000 },
      );
      setForms((current) =>
        current.map((entry) =>
          entry.id === item.id ? response.data.data : entry,
        ),
      );
      setVersionNotice(
        response.data.meta?.message || "Official version check complete.",
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to check the official form version.",
      );
    } finally {
      setBusyId("");
    }
  }

  async function showVersions(item) {
    try {
      setVersionTarget(item);
      setVersionsLoading(true);
      setVersionActionError("");
      const response = await api.get(`/case-forms/${item.id}/versions`);
      setVersions(response.data.data || []);
    } catch (requestError) {
      setVersionActionError(
        requestError.response?.data?.message ||
          "Unable to load version history.",
      );
    } finally {
      setVersionsLoading(false);
    }
  }

  async function showReviewComments(item) {
    try {
      setReviewTarget(item);
      setReviewLoading(true);
      setReviewError("");
      const response = await api.get(`/case-forms/${item.id}/review-comments`);
      setReviewComments(response.data.data || []);
    } catch (requestError) {
      setReviewError(
        requestError.response?.data?.message ||
          "Unable to load review comments.",
      );
    } finally {
      setReviewLoading(false);
    }
  }

  async function showAudit(item) {
    try {
      setAuditTarget(item);
      setAuditLoading(true);
      setAuditError("");
      const response = await api.get(`/case-forms/${item.id}/audit`);
      setAuditEvents(response.data.data || []);
    } catch (requestError) {
      setAuditError(
        requestError.response?.data?.message ||
          "Unable to load form audit history.",
      );
    } finally {
      setAuditLoading(false);
    }
  }

  async function createReviewComment(values) {
    if (!reviewTarget) return;
    try {
      setReviewSaving(true);
      setReviewError("");
      const response = await api.post(
        `/case-forms/${reviewTarget.id}/review-comments`,
        values,
      );
      setReviewComments((current) => [response.data.data, ...current]);
      setForms((current) =>
        current.map((entry) =>
          entry.id === reviewTarget.id
            ? {
                ...entry,
                _count: {
                  ...entry._count,
                  reviewComments: (entry._count?.reviewComments || 0) + 1,
                },
              }
            : entry,
        ),
      );
    } catch (requestError) {
      setReviewError(
        requestError.response?.data?.message ||
          "Unable to add the review comment.",
      );
      throw requestError;
    } finally {
      setReviewSaving(false);
    }
  }

  async function resolveReviewComment(comment, currentlyResolved) {
    if (!reviewTarget) return;
    try {
      setReviewSaving(true);
      setReviewError("");
      const response = await api.patch(
        `/case-forms/${reviewTarget.id}/review-comments/${comment.id}`,
        { resolved: !currentlyResolved },
      );
      setReviewComments((current) =>
        current.map((entry) =>
          entry.id === comment.id ? response.data.data : entry,
        ),
      );
    } catch (requestError) {
      setReviewError(
        requestError.response?.data?.message ||
          "Unable to update the review comment.",
      );
    } finally {
      setReviewSaving(false);
    }
  }

  async function deleteReviewComment(comment) {
    if (!reviewTarget) return;
    try {
      setReviewSaving(true);
      setReviewError("");
      await api.delete(
        `/case-forms/${reviewTarget.id}/review-comments/${comment.id}`,
      );
      setReviewComments((current) =>
        current.filter((entry) => entry.id !== comment.id),
      );
      setForms((current) =>
        current.map((entry) =>
          entry.id === reviewTarget.id
            ? {
                ...entry,
                _count: {
                  ...entry._count,
                  reviewComments: Math.max(
                    (entry._count?.reviewComments || 1) - 1,
                    0,
                  ),
                },
              }
            : entry,
        ),
      );
    } catch (requestError) {
      setReviewError(
        requestError.response?.data?.message ||
          "Unable to delete the review comment.",
      );
    } finally {
      setReviewSaving(false);
    }
  }

  async function restoreVersion(version) {
    if (!versionTarget) return;
    try {
      setRestoreBusyId(version.id);
      setVersionActionError("");
      const response = await api.post(
        `/case-forms/${versionTarget.id}/versions/${version.id}/restore`,
      );
      const updated = response.data.data;
      setForms((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      setVersionTarget(updated);
      const history = await api.get(`/case-forms/${updated.id}/versions`);
      setVersions(history.data.data || []);
      setVersionNotice(
        `${updated.formNumber || updated.title} restored from version ${version.versionNumber}.`,
      );
    } catch (requestError) {
      setVersionActionError(
        requestError.response?.data?.message ||
          "Unable to restore this form version.",
      );
    } finally {
      setRestoreBusyId("");
    }
  }

  async function downloadVersion(version) {
    if (!versionTarget) return;
    try {
      setVersionActionError("");
      const response = await api.get(
        `/case-forms/${versionTarget.id}/versions/${version.id}/file?download=1`,
        { responseType: "blob", timeout: 60000 },
      );
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = version.originalFilename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (requestError) {
      setVersionActionError(
        requestError.response?.data?.message ||
          "Unable to download this form version.",
      );
    }
  }

  async function upload(item, file, copyType = "Working") {
    try {
      setBusyId(item.id);
      setError("");
      const body = new FormData();
      body.append("file", file);
      body.append("copyType", copyType);
      const response = await api.post(`/case-forms/${item.id}/upload`, body, {
        timeout: 60000,
      });
      setForms((current) =>
        current.map((entry) =>
          entry.id === item.id ? response.data.data : entry,
        ),
      );
      setVersionNotice(
        `${copyType.replace(/([a-z])([A-Z])/g, "$1 $2")} copy saved as a new version.`,
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message || "Unable to upload this form.",
      );
    } finally {
      setBusyId("");
    }
  }

  async function saveBrowserCopy(item, blob, filename, copyType) {
    const body = new FormData();
    body.append(
      "file",
      new File([blob], filename, { type: blob.type || "application/pdf" }),
    );
    body.append("copyType", copyType);
    const response = await api.post(`/case-forms/${item.id}/copies`, body, {
      timeout: 60000,
    });
    const updated = response.data.data;
    setForms((current) =>
      current.map((entry) => (entry.id === updated.id ? updated : entry)),
    );
    setVersionNotice(
      `${copyType} copy saved to CaseDesk as version ${updated._count?.versions || ""}.`,
    );
    return updated;
  }

  async function openStored(item, download = false) {
    const likelyPdf =
      item.mimeType === "application/pdf" ||
      String(item.originalFilename || "")
        .toLowerCase()
        .endsWith(".pdf");
    const previewWindow =
      download || likelyPdf ? null : window.open("about:blank", "_blank");
    if (previewWindow) {
      previewWindow.opener = null;
      previewWindow.document.title = `Opening ${item.formNumber || item.title}…`;
      previewWindow.document.body.innerHTML =
        '<div style="display:grid;min-height:100vh;place-items:center;margin:0;background:#f8fafc;color:#475569;font:500 14px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">Loading secure form…</div>';
    }
    try {
      setBusyId(item.id);
      setError("");
      const response = await api.get(
        `/case-forms/${item.id}/file${download ? "?download=1" : ""}`,
        { responseType: "blob", timeout: 60000 },
      );
      const isPdf = response.data.type === "application/pdf" || likelyPdf;
      if (!download && isPdf) {
        previewWindow?.close();
        const autofill = buildCaseFormAutofill(item, caseItem, assessment, {
          representative: representativeFor(item),
          agency: agencyProfile,
        });
        setPdfPreview({ item, blob: response.data, autofill });
        if (
          !item.lockedAt &&
          permissions.canEdit &&
          Object.keys(autofill.values || {}).length
        )
          api
            .post(`/case-forms/${item.id}/audit/autofill`, {
              fieldCount: Object.keys(autofill.values).length,
              mappingVersion: autofill.mappingVersion,
            })
            .catch(() => {});
      } else {
        const url = URL.createObjectURL(response.data);
        if (download) {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = item.originalFilename || item.title;
          anchor.click();
        } else if (previewWindow) {
          previewWindow.location.replace(url);
        } else {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = item.originalFilename || item.title;
          anchor.click();
          setError(
            "Your browser prevented a preview tab, so the form was downloaded instead.",
          );
        }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (requestError) {
      previewWindow?.close();
      setError(
        requestError.response?.data?.message || "Unable to open this form.",
      );
    } finally {
      setBusyId("");
    }
  }

  async function remove(item) {
    try {
      setBusyId(item.id);
      setError("");
      await api.delete(`/case-forms/${item.id}`);
      setForms((current) => current.filter((entry) => entry.id !== item.id));
      setDeleteTarget(null);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message || "Unable to remove this form.",
      );
    } finally {
      setBusyId("");
    }
  }

  return (
    <div>
      <input
        ref={uploadInput}
        type="file"
        accept={acceptedTypes}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && uploadTarget.current?.item)
            upload(
              uploadTarget.current.item,
              file,
              uploadTarget.current.copyType,
            );
          event.target.value = "";
          uploadTarget.current = null;
        }}
      />
      {!loading ? (
        <PackageSummary
          forms={forms}
          caseItem={caseItem}
          assessment={assessment}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/50 px-4 py-3">
        <label className="relative min-w-[14rem] flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search assigned forms"
            className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-sky-300"
          />
        </label>
        <span className="text-[10px] font-semibold text-slate-400">
          Rules reviewed {catalog?.verifiedAt || "—"}
        </span>
        {permissions.canAssign ? (
          <button
            type="button"
            onClick={() => {
              setError("");
              setAddOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            Add Forms
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="m-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      ) : null}
      {versionNotice ? (
        <div className="mx-3 mt-3 flex items-start justify-between gap-3 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2.5 text-xs text-sky-800">
          <p>{versionNotice}</p>
          <button
            type="button"
            onClick={() => setVersionNotice("")}
            aria-label="Dismiss version notice"
            className="text-sky-500 hover:text-sky-800"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      {loading ? (
        <div className="divide-y divide-slate-100">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex animate-pulse gap-3 px-4 py-4">
              <span className="h-10 w-10 rounded-xl bg-slate-100" />
              <span className="flex-1">
                <span className="block h-3 w-1/3 rounded bg-slate-100" />
                <span className="mt-2 block h-2.5 w-2/3 rounded bg-slate-100" />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div>
          {visible.map((item) => {
            const status =
              statuses.find(([value]) => value === item.status) || statuses[0];
            const versionMeta =
              versionStatusStyle[item.versionStatus] ||
              versionStatusStyle.Unverified;
            const readiness = buildCaseFormAutofill(item, caseItem, assessment);
            const permittedStatuses = statuses.filter(
              ([value]) =>
                value === item.status ||
                (value === "Finalized"
                  ? permissions.canFinalize
                  : ["Approved", "SignatureRequired", "Signed"].includes(value)
                    ? permissions.canApprove
                    : ["ReadyForReview", "ChangesRequested"].includes(value)
                      ? permissions.canReview
                      : permissions.canEdit),
            );
            return (
              <div
                key={item.id}
                className="group flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 hover:bg-slate-50/70"
              >
                <button
                  type="button"
                  onClick={() =>
                    item.storageKey
                      ? openStored(item)
                      : item.officialUrl
                        ? window.open(
                            item.officialUrl,
                            "_blank",
                            "noopener,noreferrer",
                          )
                        : null
                  }
                  className="flex min-w-[15rem] flex-1 items-center gap-3 text-left"
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${item.storageKey ? "bg-emerald-50 text-emerald-600" : item.source === "Catalog" ? "bg-sky-50 text-sky-600" : "bg-violet-50 text-violet-600"}`}
                  >
                    <FileCheck2 className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {item.title}
                      </span>
                      {item.formNumber ? (
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                          {item.formNumber}
                        </span>
                      ) : null}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${versionMeta[1]}`}
                      >
                        {versionMeta[0]}
                      </span>
                      {item.lockedAt ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-semibold text-amber-700">
                          <LockKeyhole className="h-3 w-3" />
                          Locked
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block truncate text-[10px] text-slate-400">
                      {item.storageKey
                        ? `${item.originalFilename} · ${formatSize(item.fileSize)} · ${item.uploadedBy?.fullName || "Staff"}`
                        : item.selectionReason || "Waiting for a form file"}
                    </span>
                    <span className="mt-1 block truncate text-[10px] text-slate-400">
                      {String(item.currentCopyType || "Original").replace(
                        /([a-z])([A-Z])/g,
                        "$1 $2",
                      )}{" "}
                      copy · {item.language || "English"}
                      {item.sourceRevision
                        ? ` · Revision ${item.sourceRevision}`
                        : ""}
                      {item._count?.versions
                        ? ` · ${item._count.versions} version${item._count.versions === 1 ? "" : "s"}`
                        : ""}
                      {item.fileHash
                        ? ` · SHA-256 ${item.fileHash.slice(0, 8)}…`
                        : ""}
                    </span>
                  </span>
                </button>
                {readiness.analysis ? (
                  <button
                    type="button"
                    onClick={() => setReadinessTarget({ item, readiness })}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${readiness.analysis.missing ? "bg-rose-50 text-rose-700 hover:bg-rose-100" : readiness.analysis.review || readiness.analysis.conditional ? "bg-amber-50 text-amber-800 hover:bg-amber-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
                  >
                    {readiness.analysis.ready} ready
                    {readiness.analysis.missing
                      ? ` · ${readiness.analysis.missing} missing`
                      : ""}
                    {readiness.analysis.review
                      ? ` · ${readiness.analysis.review} review`
                      : ""}
                    {readiness.analysis.conditional
                      ? ` · ${readiness.analysis.conditional} conditional`
                      : ""}
                  </button>
                ) : null}
                {hasMappedFields(item) || isImm5476Form(item) ? (
                  <button
                    type="button"
                    onClick={() => setChecklistTarget(item)}
                    className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-violet-700 transition hover:bg-violet-100"
                  >
                    <Sparkles className="h-3 w-3" />
                    {isImm5476Form(item)
                      ? item.representativeUserId
                        ? "Change representative"
                        : "Select representative"
                      : "Auto-fill checklist"}
                  </button>
                ) : null}
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${requirementStyle[item.requirement]}`}
                >
                  {item.requirement}
                </span>
                <select
                  value={item.status}
                  disabled={busyId === item.id || Boolean(item.lockedAt)}
                  onChange={(event) =>
                    event.target.value === "Finalized"
                      ? finalize(item)
                      : update(item, { status: event.target.value })
                  }
                  className={`h-8 rounded-full border-0 px-3 text-[10px] font-semibold outline-none ring-1 ring-inset ring-black/5 ${status[2]}`}
                >
                  {permittedStatuses.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {!item.storageKey &&
                item.source === "Catalog" &&
                item.importable !== false &&
                permissions.canEdit ? (
                  <button
                    type="button"
                    onClick={() => importOfficial(item)}
                    disabled={busyId === item.id}
                    className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-[10px] font-semibold text-sky-700 disabled:opacity-50"
                  >
                    {busyId === item.id ? "Importing…" : "Import"}
                  </button>
                ) : null}
                <FormActions
                  item={item}
                  onCheckVersion={() => checkVersion(item)}
                  onShowVersions={() => showVersions(item)}
                  onImportLatest={() => {
                    setVersionActionError("");
                    setUpdateTarget(item);
                  }}
                  onReviewComments={() => showReviewComments(item)}
                  onAudit={() => showAudit(item)}
                  onSaveTemplate={() => saveAsAgencyTemplate(item)}
                  onUnlock={() => unlock(item)}
                  permissions={permissions}
                  onUpload={(copyType) => {
                    uploadTarget.current = { item, copyType };
                    uploadInput.current?.click();
                  }}
                  onDownload={() => openStored(item, true)}
                  onOpenOfficial={() =>
                    window.open(
                      item.officialUrl,
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                  onDelete={() => setDeleteTarget(item)}
                />
              </div>
            );
          })}
          {!visible.length ? (
            <div className="px-6 py-12 text-center">
              <FileCheck2 className="mx-auto h-8 w-8 text-sky-300" />
              <p className="mt-3 text-sm font-semibold text-slate-800">
                {forms.length
                  ? "No forms match your search"
                  : "No forms assigned yet"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Add suggested IRCC forms or upload a consultant-created form.
              </p>
              {!forms.length && permissions.canAssign ? (
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="mt-4 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white"
                >
                  Add Forms
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      <AnimatePresence>
        {addOpen ? (
          <AddFormsOverlay
            catalog={catalog}
            templates={templates}
            assigned={forms}
            saving={saving}
            error={error}
            onClose={() => setAddOpen(false)}
            onAssign={assign}
            onAssignTemplates={assignTemplates}
            onCreateCustom={createCustom}
            onOpenFieldMapping={setMappingTarget}
            canManageTemplates={permissions.canManageTemplates}
          />
        ) : null}
      </AnimatePresence>
      {pdfPreview ? (
        <XfaPdfPreviewOverlay
          item={pdfPreview.item}
          blob={pdfPreview.blob}
          autofill={
            pdfPreview.autofill ||
            buildCaseFormAutofill(pdfPreview.item, caseItem, assessment, {
              representative: representativeFor(pdfPreview.item),
              agency: agencyProfile,
            })
          }
          readOnly={Boolean(pdfPreview.item.lockedAt) || !permissions.canEdit}
          onSaveToCase={
            pdfPreview.item.lockedAt || !permissions.canEdit
              ? null
              : (blob, filename, copyType) =>
                  saveBrowserCopy(pdfPreview.item, blob, filename, copyType)
          }
          onClose={() => setPdfPreview(null)}
        />
      ) : null}
      {versionTarget ? (
        <VersionHistoryOverlay
          item={versionTarget}
          versions={versions}
          loading={versionsLoading}
          savingId={restoreBusyId}
          error={versionActionError}
          onClose={() => {
            setVersionTarget(null);
            setVersions([]);
            setVersionActionError("");
          }}
          onRestore={restoreVersion}
          onDownload={downloadVersion}
        />
      ) : null}
      {updateTarget ? (
        <ImportUpdateOverlay
          item={updateTarget}
          saving={busyId === updateTarget.id}
          error={versionActionError}
          onClose={() => {
            setUpdateTarget(null);
            setVersionActionError("");
          }}
          onConfirm={() => importOfficial(updateTarget, true)}
        />
      ) : null}
      {readinessTarget ? (
        <MissingInformationOverlay
          item={readinessTarget.item}
          readiness={readinessTarget.readiness}
          onClose={() => setReadinessTarget(null)}
          onOpenProfileSection={onOpenProfileSection}
          onEditClient={onEditClient}
          onOpenAssessment={onOpenAssessment}
        />
      ) : null}
      {reviewTarget ? (
        <ReviewCommentsOverlay
          item={reviewTarget}
          comments={reviewComments}
          loading={reviewLoading}
          saving={reviewSaving}
          error={reviewError}
          onClose={() => {
            setReviewTarget(null);
            setReviewComments([]);
            setReviewError("");
          }}
          onCreate={createReviewComment}
          onResolve={resolveReviewComment}
          onDelete={deleteReviewComment}
          canEdit={permissions.canReview && !reviewTarget.lockedAt}
        />
      ) : null}
      {checklistTarget ? (
        <FormFieldChecklistOverlay
          item={checklistTarget}
          caseId={caseId}
          onClose={() => setChecklistTarget(null)}
          onFormChanged={load}
        />
      ) : null}
      {mappingTarget ? (
        <FormFieldMappingOverlay
          template={mappingTarget}
          onClose={() => setMappingTarget(null)}
        />
      ) : null}
      {auditTarget ? (
        <FormAuditOverlay
          item={auditTarget}
          events={auditEvents}
          loading={auditLoading}
          error={auditError}
          onClose={() => {
            setAuditTarget(null);
            setAuditEvents([]);
            setAuditError("");
          }}
        />
      ) : null}
      {deleteTarget
        ? createPortal(
            <div className="fixed inset-0 z-[410] flex items-center justify-center bg-slate-950/20 p-4 backdrop-blur-sm">
              <button
                type="button"
                className="absolute inset-0"
                onClick={() => setDeleteTarget(null)}
                aria-label="Cancel removal"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative w-full max-w-sm rounded-[1.75rem] border border-white bg-white p-6 shadow-2xl"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
                  <Trash2 className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-slate-950">
                  Remove this form?
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  “{deleteTarget.title}” and its stored case copy will be
                  permanently removed.
                </p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(null)}
                    className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
                  >
                    Keep Form
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(deleteTarget)}
                    disabled={busyId === deleteTarget.id}
                    className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busyId === deleteTarget.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              </motion.div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
