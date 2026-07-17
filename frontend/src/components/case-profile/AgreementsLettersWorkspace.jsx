import {
  BookOpenText,
  ChevronRight,
  ExternalLink,
  FilePenLine,
  FileSignature,
  History,
  Library,
  Mail,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import DOMPurify from "dompurify";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";

const statusStyles = {
  Draft: "bg-slate-100 text-slate-600",
  ReadyToIssue: "bg-sky-50 text-sky-700",
  Issued: "bg-violet-50 text-violet-700",
  Signed: "bg-amber-50 text-amber-800",
  Finalized: "bg-emerald-50 text-emerald-700",
};
const inputClass =
  "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100/60";

function correspondenceStatusOptions(item) {
  if (item.correspondenceStatus === "Finalized") return [["Finalized", "Finalized"]];
  if (item.correspondenceStatus === "Signed") return [["Signed", "Signed by client"], ["Finalized", "Finalize"]];
  if (item.correspondenceStatus === "Issued") {
    return item.correspondenceKind === "Agreement"
      ? [["Issued", "Awaiting client signature"]]
      : [["Issued", "Issued"], ["Finalized", "Finalize"]];
  }
  return [["Draft", "Draft"], ["ReadyToIssue", "Ready to Issue"], ["Issued", item.correspondenceKind === "Agreement" ? "Send for signature" : "Issue"]];
}

function formatDate(value) {
  if (!value) return "Not issued";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not issued"
    : date.toLocaleString("en-CA", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function TemplatePreviewOverlay({
  template,
  saving,
  error,
  onClose,
  onCreateDraft,
  onEdit,
  onVersions,
  onDelete,
}) {
  const missing = template.preview?.missing || [];
  return createPortal(
    <div className="fixed inset-0 z-[410] flex items-center justify-center bg-slate-950/25 p-3 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close template preview"
      />
      <motion.section
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_34px_100px_rgba(15,23,42,0.28)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${template.kind === "Agreement" ? "bg-indigo-50 text-indigo-700" : "bg-sky-50 text-sky-700"}`}
              >
                {template.kind}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {template.category} · Version {template.versionNumber}
              </span>
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
              {template.title}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              {template.description}
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
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <main className="scrollbar-hidden min-h-0 overflow-y-auto bg-[#eaebee] p-5">
            <article className="mx-auto min-h-[54rem] max-w-[48rem] bg-white px-10 py-12 shadow-[0_12px_35px_rgba(15,23,42,0.12)]">
              <div
                className="prose prose-slate max-w-none text-sm leading-6 [&_h1]:text-2xl [&_h2]:mt-6 [&_h2]:text-base [&_mark]:rounded [&_mark]:bg-amber-100 [&_mark]:px-1 [&_mark]:text-amber-900"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(
                    template.preview?.html || template.contentHtml,
                  ),
                }}
              />
            </article>
          </main>
          <aside className="border-l border-slate-100 bg-white p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Autofill review
            </p>
            <div
              className={`mt-3 rounded-2xl p-4 ${missing.length ? "bg-amber-50" : "bg-emerald-50"}`}
            >
              <p
                className={`text-lg font-semibold ${missing.length ? "text-amber-800" : "text-emerald-700"}`}
              >
                {missing.length}
              </p>
              <p
                className={`mt-1 text-xs font-semibold ${missing.length ? "text-amber-700" : "text-emerald-700"}`}
              >
                {missing.length
                  ? "placeholders need correction"
                  : "core fields populated"}
              </p>
            </div>
            {missing.length ? (
              <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
                Review the highlighted areas directly in the document.
              </p>
            ) : null}
            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={onEdit}
                className="flex w-full items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2.5 text-left text-xs font-semibold text-slate-700"
              >
                <Pencil className="h-3.5 w-3.5" />
                Correct template
              </button>
              <button
                type="button"
                onClick={onVersions}
                className="flex w-full items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2.5 text-left text-xs font-semibold text-slate-700"
              >
                <History className="h-3.5 w-3.5" />
                Template versions
              </button>
              {template.sourceUrl ? (
                <a
                  href={template.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Official guidance
                </a>
              ) : null}
              <button
                type="button"
                onClick={onDelete}
                className="flex w-full items-center gap-2 rounded-2xl border border-rose-100 px-3 py-2.5 text-left text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove template
              </button>
            </div>
            <p className="mt-5 rounded-2xl bg-slate-50 p-3 text-[10px] leading-4 text-slate-500">
              This is an editable precedent. The consultant must review scope,
              facts, fees, legal obligations, and missing fields before issue.
            </p>
          </aside>
        </div>
        {error ? (
          <p className="mx-5 mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </p>
        ) : null}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
          <p className="text-xs text-slate-400">
            A case-specific editable copy will be created; the precedent remains
            unchanged.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onCreateDraft}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              <FilePenLine className="h-4 w-4" />
              {saving ? "Creating…" : "Create editable draft"}
            </button>
          </div>
        </footer>
      </motion.section>
    </div>,
    document.body,
  );
}

function TemplateEditorOverlay({ template, saving, error, onClose, onSave }) {
  const [values, setValues] = useState({
    title: template.title,
    category: template.category,
    description: template.description || "",
    contentHtml: template.contentHtml,
    caseTags: template.caseTags.join(", "),
  });
  return createPortal(
    <div className="fixed inset-0 z-[430] flex items-center justify-center bg-slate-950/25 p-3 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close template editor"
      />
      <motion.form
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            ...values,
            caseTags: values.caseTags
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          });
        }}
        className="relative flex h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_34px_100px_rgba(15,23,42,0.3)]"
      >
        <header className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-600">
              Workspace precedent · Version {template.versionNumber}
            </p>
            <h2 className="mt-1 text-xl font-semibold">Correct template</h2>
            <p className="mt-1 text-sm text-slate-500">
              Saving creates a new immutable template version. Existing case
              drafts are not changed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="grid min-h-0 flex-1 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="scrollbar-hidden overflow-y-auto border-r border-slate-100 bg-slate-50/70 p-4">
            <label className="block text-xs font-semibold text-slate-700">
              Title
              <input
                required
                value={values.title}
                onChange={(event) =>
                  setValues((value) => ({
                    ...value,
                    title: event.target.value,
                  }))
                }
                className={inputClass}
              />
            </label>
            <label className="mt-4 block text-xs font-semibold text-slate-700">
              Category
              <input
                value={values.category}
                onChange={(event) =>
                  setValues((value) => ({
                    ...value,
                    category: event.target.value,
                  }))
                }
                className={inputClass}
              />
            </label>
            <label className="mt-4 block text-xs font-semibold text-slate-700">
              Case tags
              <input
                value={values.caseTags}
                onChange={(event) =>
                  setValues((value) => ({
                    ...value,
                    caseTags: event.target.value,
                  }))
                }
                className={inputClass}
                placeholder="visitor, study, general"
              />
            </label>
            <label className="mt-4 block text-xs font-semibold text-slate-700">
              Description
              <textarea
                rows={4}
                value={values.description}
                onChange={(event) =>
                  setValues((value) => ({
                    ...value,
                    description: event.target.value,
                  }))
                }
                className={`${inputClass} resize-none`}
              />
            </label>
          </aside>
          <main className="scrollbar-hidden min-h-0 overflow-y-auto bg-[#eaebee] p-5">
            <div
              contentEditable
              suppressContentEditableWarning
              onInput={(event) =>
                setValues((value) => ({
                  ...value,
                  contentHtml: event.currentTarget.innerHTML,
                }))
              }
              className="mx-auto min-h-[54rem] max-w-[48rem] bg-white px-10 py-12 text-sm leading-6 shadow-[0_12px_35px_rgba(15,23,42,0.12)] outline-none [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(values.contentHtml),
              }}
            />
          </main>
        </div>
        {error ? (
          <p className="mx-5 mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </p>
        ) : null}
        <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              saving || !values.title.trim() || !values.contentHtml.trim()
            }
            className="rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save new version"}
          </button>
        </footer>
      </motion.form>
    </div>,
    document.body,
  );
}

function CustomDraftOverlay({ saving, error, onClose, onCreate, agreementOnly = false }) {
  const [values, setValues] = useState({ kind: agreementOnly ? "Agreement" : "Letter", title: "" });
  return createPortal(
    <div className="fixed inset-0 z-[420] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close custom document form"
      />
      <motion.form
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(values);
        }}
        className="relative w-full max-w-lg overflow-hidden rounded-[1.8rem] border border-white/80 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.26)]"
      >
        <div className="px-6 pb-5 pt-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-600">
            CaseDesk Writer
          </p>
          <h3 className="mt-1 text-xl font-semibold">
            Write a custom document
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Workspace and client details will be placed into an editable letterhead
            or agreement shell.
          </p>
          {agreementOnly ? (
            <div className="mt-5 inline-flex rounded-full bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700">Agreement requiring client signature</div>
          ) : (
            <div className="mt-5 grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
              {["Letter", "Agreement"].map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setValues((value) => ({ ...value, kind }))}
                className={`rounded-xl px-3 py-2 text-sm font-semibold ${values.kind === kind ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
              >
                {kind}
              </button>
              ))}
            </div>
          )}
          <label className="mt-5 block text-sm font-semibold text-slate-700">
            Document title
            <input
              autoFocus
              required
              value={values.title}
              onChange={(event) =>
                setValues((value) => ({ ...value, title: event.target.value }))
              }
              placeholder={
                values.kind === "Letter"
                  ? "Client update letter"
                  : "Custom service agreement"
              }
              className={inputClass}
            />
          </label>
          {error ? (
            <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50/70 p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !values.title.trim()}
            className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Creating…" : "Open Writer"}
          </button>
        </div>
      </motion.form>
    </div>,
    document.body,
  );
}

function VersionOverlay({
  template,
  versions,
  loading,
  saving,
  error,
  onClose,
  onRestore,
}) {
  return createPortal(
    <div className="fixed inset-0 z-[440] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close template versions"
      />
      <motion.section
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative flex max-h-[82dvh] w-full max-w-2xl flex-col overflow-hidden rounded-[1.8rem] border border-white/80 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">
              Immutable precedent history
            </p>
            <h3 className="mt-1 text-lg font-semibold">{template.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <main className="scrollbar-hidden min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50/60 p-4">
          {error ? (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          ) : null}
          {loading
            ? Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  className="h-20 animate-pulse rounded-2xl bg-white"
                />
              ))
            : versions.map((version, index) => (
                <div
                  key={version.id}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-white p-4"
                >
                  <div>
                    <p className="text-sm font-semibold">
                      Version {version.versionNumber}
                      {index === 0 ? " · Latest" : ""}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDate(version.createdAt)} ·{" "}
                      {version.createdBy?.fullName || "System default"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRestore(version)}
                    disabled={saving || index === 0}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-35"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restore
                  </button>
                </div>
              ))}
        </main>
      </motion.section>
    </div>,
    document.body,
  );
}

function TemplateCatalogOverlay({
  templates,
  view,
  kind,
  search,
  onViewChange,
  onKindChange,
  onSearchChange,
  onSelect,
  onCustom,
  onClose,
  agreementOnly = false,
}) {
  return createPortal(
    <div className="fixed inset-0 z-[390] flex items-center justify-center bg-slate-950/25 p-3 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close agreement and letter templates"
      />
      <motion.section
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.985 }}
        className="relative flex h-[88dvh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_34px_100px_rgba(15,23,42,0.28)]"
      >
        <header className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-600">
              Add correspondence
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
              Choose a template or start from scratch
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Templates are autofilled for this client before opening in Writer.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCustom}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
            >
              <FilePenLine className="h-4 w-4" />
              Write custom
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 md:flex-row md:items-center">
          <div className="flex rounded-full bg-slate-100 p-1">
            {[
              ["suggested", "Suggested"],
              ["templates", "All Templates"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => onViewChange(id)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold ${view === id ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search agreements and letters"
              className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-sky-300"
            />
          </label>
          {agreementOnly ? (
            <span className="inline-flex h-9 items-center rounded-full bg-indigo-50 px-4 text-xs font-semibold text-indigo-700">Agreements only</span>
          ) : (
            <select
              value={kind}
              onChange={(event) => onKindChange(event.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600"
            >
              <option>All</option>
              <option>Agreement</option>
              <option>Letter</option>
            </select>
          )}
        </div>
        <main className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onSelect(template)}
                className="group flex min-h-44 flex-col rounded-[1.4rem] border border-slate-100 bg-white p-4 text-left shadow-[0_8px_25px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-[0_15px_35px_rgba(15,23,42,0.09)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-2xl ${template.kind === "Agreement" ? "bg-indigo-50 text-indigo-600" : "bg-sky-50 text-sky-600"}`}
                  >
                    {template.kind === "Agreement" ? (
                      <FileSignature className="h-5 w-5" />
                    ) : (
                      <Mail className="h-5 w-5" />
                    )}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${template.preview?.missing?.length ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}
                  >
                    {template.preview?.missing?.length || 0} corrections
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-900">
                  {template.title}
                </p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                  {template.description}
                </p>
                <div className="mt-auto flex items-center justify-between pt-3">
                  <span className="text-[10px] font-semibold text-slate-400">
                    {template.category} · v{template.versionNumber}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 group-hover:text-slate-800">
                    Preview <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </button>
            ))}
          </div>
          {!templates.length ? (
            <div className="px-6 py-16 text-center">
              <Library className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold">
                No matching templates
              </p>
            </div>
          ) : null}
        </main>
      </motion.section>
    </div>,
    document.body,
  );
}

function DeleteCorrespondenceOverlay({
  target,
  saving,
  error,
  onClose,
  onDelete,
}) {
  const isTemplate = target.type === "template";
  return createPortal(
    <div className="fixed inset-0 z-[470] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Cancel deletion"
      />
      <motion.section
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full max-w-md overflow-hidden rounded-[1.8rem] border border-white/80 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.26)]"
      >
        <div className="px-6 pb-5 pt-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
            <Trash2 className="h-5 w-5" />
          </span>
          <h3 className="mt-4 text-xl font-semibold text-slate-950">
            Remove {isTemplate ? "template" : "document"}?
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            <strong className="text-slate-700">{target.item.title}</strong>{" "}
            {isTemplate
              ? "will disappear from the template chooser. Existing case drafts remain unchanged."
              : "and its saved working and client-issued copies will be permanently deleted."}
          </p>
          {error ? (
            <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50/70 p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Removing…" : "Remove"}
          </button>
        </div>
      </motion.section>
    </div>,
    document.body,
  );
}

export default function AgreementsLettersWorkspace({ caseItem, eSignMode = false }) {
  const readOnly = Boolean(caseItem.archivedAt || caseItem.deletedAt);
  const [templates, setTemplates] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("drafts");
  const [catalogView, setCatalogView] = useState("suggested");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [kind, setKind] = useState(eSignMode ? "Agreement" : "All");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [versionTarget, setVersionTarget] = useState(null);
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function load() {
    try {
      setLoading(true);
      setError("");
      const [templateResponse, documentResponse] = await Promise.all([
        api.get(`/correspondence/templates?caseId=${caseItem.id}`),
        api.get(`/correspondence/case/${caseItem.id}`),
      ]);
      setTemplates(templateResponse.data.data || []);
      setDocuments(documentResponse.data.data || []);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to load agreements and letters.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [caseItem.id]);
  useEffect(() => {
    if (eSignMode) setKind("Agreement");
  }, [eSignMode]);
  useEffect(() => {
    let channel;
    const refresh = (event) => {
      if (!event?.data || event.data.caseId === caseItem.id) load();
    };
    try {
      channel = new BroadcastChannel("casedesk-documents");
      channel.addEventListener("message", refresh);
    } catch {
      /* BroadcastChannel is optional. */
    }
    const visible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      channel?.close();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [caseItem.id]);

  const counts = useMemo(
    () => ({
      agreements: documents.filter(
        (item) => item.correspondenceKind === "Agreement",
      ).length,
      letters: documents.filter((item) => item.correspondenceKind === "Letter")
        .length,
      drafts: documents.filter(
        (item) =>
          !["Issued", "Signed", "Finalized"].includes(
            item.correspondenceStatus,
          ),
      ).length,
      issued: documents.filter((item) =>
        ["Issued", "Signed", "Finalized"].includes(item.correspondenceStatus),
      ).length,
    }),
    [documents],
  );
  const eSignCounts = useMemo(() => {
    const agreements = documents.filter((item) => item.correspondenceKind === "Agreement");
    return {
      drafts: agreements.filter((item) => ["Draft", "ReadyToIssue"].includes(item.correspondenceStatus)).length,
      awaiting: agreements.filter((item) => item.correspondenceStatus === "Issued").length,
      signed: agreements.filter((item) => item.correspondenceStatus === "Signed").length,
      finalized: agreements.filter((item) => item.correspondenceStatus === "Finalized").length,
    };
  }, [documents]);
  const visibleTemplates = useMemo(
    () =>
      templates.filter(
        (item) =>
          (catalogView !== "suggested" || item.suggested) &&
          (kind === "All" || item.kind === kind) &&
          (!search.trim() ||
            `${item.title} ${item.category} ${item.description || ""}`
              .toLowerCase()
              .includes(search.trim().toLowerCase())),
      ),
    [templates, catalogView, kind, search],
  );
  const visibleDocuments = useMemo(
    () =>
      documents.filter(
        (item) =>
          (view === "issued"
            ? ["Issued", "Signed", "Finalized"].includes(
                item.correspondenceStatus,
              )
            : !["Issued", "Signed", "Finalized"].includes(
                item.correspondenceStatus,
              )) &&
          (kind === "All" || item.correspondenceKind === kind) &&
          (!search.trim() ||
            item.title.toLowerCase().includes(search.trim().toLowerCase())),
      ),
    [documents, view, kind, search],
  );

  const writerUrl = (documentItem) =>
    `/cases/${caseItem.id}/documents/${documentItem.id}/edit`;
  const openWriter = (documentItem) =>
    window.open(writerUrl(documentItem), "_blank", "noopener,noreferrer");
  const createDraft = async (template) => {
    const writerWindow = window.open("about:blank", "_blank");
    try {
      setSaving(true);
      setError("");
      const response = await api.post(
        `/correspondence/templates/${template.id}/create-draft`,
        { caseId: caseItem.id },
      );
      setDocuments((current) => [response.data.data, ...current]);
      setPreview(null);
      setCatalogOpen(false);
      if (writerWindow)
        writerWindow.location.replace(writerUrl(response.data.data));
      else window.location.assign(writerUrl(response.data.data));
    } catch (requestError) {
      writerWindow?.close();
      setError(
        requestError.response?.data?.message || "Unable to create the draft.",
      );
    } finally {
      setSaving(false);
    }
  };
  const createCustom = async (values) => {
    const writerWindow = window.open("about:blank", "_blank");
    try {
      setSaving(true);
      setError("");
      const response = await api.post("/correspondence/drafts/custom", {
        caseId: caseItem.id,
        ...values,
      });
      setDocuments((current) => [response.data.data, ...current]);
      setCustomOpen(false);
      setCatalogOpen(false);
      if (writerWindow)
        writerWindow.location.replace(writerUrl(response.data.data));
      else window.location.assign(writerUrl(response.data.data));
    } catch (requestError) {
      writerWindow?.close();
      setError(
        requestError.response?.data?.message ||
          "Unable to create the custom document.",
      );
    } finally {
      setSaving(false);
    }
  };
  const saveTemplate = async (values) => {
    try {
      setSaving(true);
      setError("");
      const response = await api.patch(
        `/correspondence/templates/${editing.id}`,
        values,
      );
      const updated = response.data.data;
      const refreshed = await api.get(
        `/correspondence/templates?caseId=${caseItem.id}`,
      );
      setTemplates(refreshed.data.data || []);
      setEditing(null);
      setPreview((current) =>
        current?.id === updated.id
          ? (refreshed.data.data || []).find((item) => item.id === updated.id)
          : current,
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to update the template.",
      );
    } finally {
      setSaving(false);
    }
  };
  const showVersions = async (template) => {
    try {
      setVersionTarget(template);
      setVersionsLoading(true);
      setError("");
      const response = await api.get(
        `/correspondence/templates/${template.id}/versions`,
      );
      setVersions(response.data.data || []);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to load template versions.",
      );
    } finally {
      setVersionsLoading(false);
    }
  };
  const restoreVersion = async (version) => {
    try {
      setSaving(true);
      setError("");
      await api.post(
        `/correspondence/templates/${versionTarget.id}/versions/${version.id}/restore`,
      );
      setVersionTarget(null);
      await load();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to restore the template version.",
      );
    } finally {
      setSaving(false);
    }
  };
  const updateStatus = async (item, status) => {
    try {
      setSaving(true);
      setError("");
      const response = await api.patch(
        `/correspondence/documents/${item.id}/status`,
        { status },
      );
      setDocuments((current) =>
        current.map((entry) =>
          entry.id === item.id ? response.data.data : entry,
        ),
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to update issue status.",
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!deleteTarget) return;
    try {
      setSaving(true);
      setError("");
      if (deleteTarget.type === "template") {
        await api.delete(`/correspondence/templates/${deleteTarget.item.id}`);
        setTemplates((current) =>
          current.filter((item) => item.id !== deleteTarget.item.id),
        );
        if (preview?.id === deleteTarget.item.id) setPreview(null);
      } else {
        await api.delete(`/correspondence/documents/${deleteTarget.item.id}`);
        setDocuments((current) =>
          current.filter((item) => item.id !== deleteTarget.item.id),
        );
      }
      setDeleteTarget(null);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message || "Unable to remove this item.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-[1.65rem] border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
      <header className="border-b border-slate-100 bg-[linear-gradient(135deg,#ffffff,#f8fafc)] px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-600">
              Client correspondence
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
              {eSignMode ? "E-Sign Centre" : "Agreements & Letters"}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              {eSignMode
                ? "Create agreements, send them to the client portal, monitor signatures, and finalize completed records."
                : "Choose a case-aware precedent, review autofilled workspace and client details, then make final corrections in CaseDesk Writer."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={readOnly}
              onClick={() => {
                setCatalogView("suggested");
                setKind(eSignMode ? "Agreement" : "All");
                setSearch("");
                setCatalogOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
              {eSignMode ? "Create agreement" : "Add"}
            </button>
          </div>
        </div>
        {documents.length ? (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(eSignMode ? [
              ["Drafts", eSignCounts.drafts, FilePenLine, "text-slate-700"],
              ["Awaiting", eSignCounts.awaiting, Send, "text-violet-600"],
              ["Signed", eSignCounts.signed, FileSignature, "text-amber-700"],
              ["Finalized", eSignCounts.finalized, FileSignature, "text-emerald-600"],
            ] : [
              [
                "Agreements",
                counts.agreements,
                FileSignature,
                "text-indigo-600",
              ],
              ["Letters", counts.letters, Mail, "text-sky-600"],
              ["Drafts", counts.drafts, FilePenLine, "text-slate-700"],
              ["Issued", counts.issued, Send, "text-emerald-600"],
            ]).map(([label, value, Icon, color]) => (
              <div
                key={label}
                className="rounded-2xl border border-white bg-white px-3 py-2.5 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <p className={`text-lg font-semibold ${color}`}>{value}</p>
                  <Icon className={`h-4 w-4 ${color}`} />
                </div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  {label}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </header>
      {documents.length ? (
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="scrollbar-hidden flex overflow-x-auto rounded-full bg-slate-100 p-1">
              {[
                ["drafts", "Drafts"],
                ["issued", "Issued"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setView(id)}
                  className={`relative shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold ${view === id ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 gap-2">
              <label className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={"Search case documents"}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-sky-300"
                />
              </label>
              {!eSignMode ? (
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value)}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600"
                >
                  <option>All</option>
                  <option>Agreement</option>
                  <option>Letter</option>
                </select>
              ) : null}
            </div>
          </div>
          {error &&
          !preview &&
          !editing &&
          !customOpen &&
          !versionTarget &&
          !deleteTarget ? (
            <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      {loading ? (
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="h-40 animate-pulse rounded-2xl bg-slate-100"
            />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {visibleDocuments.map((item) => (
            <article
              key={item.id}
              className="group flex flex-col gap-3 px-4 py-4 transition hover:bg-slate-50/70 sm:flex-row sm:items-center"
            >
              <button
                type="button"
                onClick={() => openWriter(item)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${item.correspondenceKind === "Agreement" ? "bg-indigo-50 text-indigo-600" : "bg-sky-50 text-sky-600"}`}
                >
                  {item.correspondenceKind === "Agreement" ? (
                    <FileSignature className="h-5 w-5" />
                  ) : (
                    <Mail className="h-5 w-5" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-900">
                    {item.title}
                  </span>
                  <span className="mt-1 block truncate text-xs text-slate-500">
                    {item.correspondenceTemplate?.title ||
                      `Custom ${item.correspondenceKind}`}{" "}
                    · {item._count?.versions || 0} saved version
                    {item._count?.versions === 1 ? "" : "s"}
                  </span>
                  <span className="mt-1 block text-[10px] text-slate-400">
                    Updated by {item.updatedBy?.fullName || "Staff"} ·{" "}
                    {formatDate(item.updatedAt)}
                  </span>
                </span>
              </button>
              <div className="flex items-center gap-2 pl-14 sm:pl-0">
                <select
                  value={item.correspondenceStatus || "Draft"}
                  onChange={(event) => updateStatus(item, event.target.value)}
                  disabled={saving || readOnly}
                  className={`h-8 rounded-full border-0 px-3 text-[10px] font-semibold outline-none ${statusStyles[item.correspondenceStatus || "Draft"]}`}
                >
                  {correspondenceStatusOptions(item).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => openWriter(item)}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
                >
                  {["Issued", "Signed", "Finalized"].includes(item.correspondenceStatus) ? "View" : "Edit"}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                {!readOnly && !["Issued", "Signed", "Finalized"].includes(item.correspondenceStatus) ? <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setDeleteTarget({ type: "document", item });
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                  aria-label={`Delete ${item.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button> : null}
              </div>
            </article>
          ))}
          {!visibleDocuments.length ? (
            <div className="px-6 py-14 text-center">
              <BookOpenText className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-800">
                No {view} correspondence
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Choose a precedent or write a custom document.
              </p>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => {
                  setCatalogView("suggested");
                  setKind(eSignMode ? "Agreement" : "All");
                  setSearch("");
                  setCatalogOpen(true);
                }}
                className="mt-5 inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-950 text-white shadow-[0_12px_28px_rgba(15,23,42,0.2)] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Add an agreement or letter"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          ) : null}
        </div>
      )}
      <AnimatePresence>
        {catalogOpen ? (
          <TemplateCatalogOverlay
            templates={visibleTemplates}
            view={catalogView}
            kind={kind}
            search={search}
            onViewChange={setCatalogView}
            onKindChange={setKind}
            onSearchChange={setSearch}
            onSelect={(template) => {
              setError("");
              setPreview(template);
            }}
            onCustom={() => {
              setError("");
              setCustomOpen(true);
            }}
            onClose={() => {
              setCatalogOpen(false);
              setError("");
            }}
            agreementOnly={eSignMode}
          />
        ) : null}
        {preview ? (
          <TemplatePreviewOverlay
            template={preview}
            saving={saving}
            error={error}
            onClose={() => {
              setPreview(null);
              setError("");
            }}
            onCreateDraft={() => createDraft(preview)}
            onEdit={() => setEditing(preview)}
            onVersions={() => showVersions(preview)}
            onDelete={() => {
              setError("");
              setDeleteTarget({ type: "template", item: preview });
            }}
          />
        ) : null}
        {editing ? (
          <TemplateEditorOverlay
            template={editing}
            saving={saving}
            error={error}
            onClose={() => {
              setEditing(null);
              setError("");
            }}
            onSave={saveTemplate}
          />
        ) : null}
        {customOpen ? (
          <CustomDraftOverlay
            saving={saving}
            error={error}
            onClose={() => {
              setCustomOpen(false);
              setError("");
            }}
            onCreate={createCustom}
            agreementOnly={eSignMode}
          />
        ) : null}
        {versionTarget ? (
          <VersionOverlay
            template={versionTarget}
            versions={versions}
            loading={versionsLoading}
            saving={saving}
            error={error}
            onClose={() => {
              setVersionTarget(null);
              setVersions([]);
              setError("");
            }}
            onRestore={restoreVersion}
          />
        ) : null}
        {deleteTarget ? (
          <DeleteCorrespondenceOverlay
            target={deleteTarget}
            saving={saving}
            error={error}
            onClose={() => {
              setDeleteTarget(null);
              setError("");
            }}
            onDelete={deleteSelected}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
}
