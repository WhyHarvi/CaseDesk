import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Ellipsis,
  ExternalLink,
  FilePenLine,
  FilePlus2,
  Folder,
  FolderOpen,
  Link2,
  ListChecks,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";
import { deduplicateDocuments, normalizeDocumentName } from "./documentNames";
import { buildDocumentPreview, releaseDocumentPreview } from "./documentPreview";

const myDocumentMarker = "[MY_DOCUMENT]";
const acceptedDocumentTypes = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.txt";
const documentPageSize = 10;
const sharedLibraryCategories = ["Templates", "IRCC Guides", "Checklists", "Letters & Agreements", "Sample Affidavits", "Internal Precedents", "General"];
const documentStatusOptions = [
  { value: "Requested", label: "Requested", message: "Waiting for client upload", requiresFile: false, pill: "border-slate-200 bg-slate-100/90 text-slate-700", dot: "bg-slate-400", icon: "bg-slate-100 text-slate-600" },
  { value: "Uploaded", label: "Uploaded", message: "Ready for initial review", requiresFile: true, pill: "border-sky-200 bg-sky-50 text-sky-700", dot: "bg-sky-500", icon: "bg-sky-50 text-sky-600" },
  { value: "UnderReview", label: "Under Review", message: "Review is currently in progress", requiresFile: true, pill: "border-violet-200 bg-violet-50 text-violet-700", dot: "bg-violet-500", icon: "bg-violet-50 text-violet-600" },
  { value: "ChangesRequested", label: "Changes Requested", message: "Waiting for a corrected document", requiresFile: true, pill: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-500", icon: "bg-amber-50 text-amber-600" },
  { value: "Approved", label: "Approved", message: "Approved and ready to finalize", requiresFile: true, pill: "border-teal-200 bg-teal-50 text-teal-700", dot: "bg-teal-500", icon: "bg-teal-50 text-teal-600" },
  { value: "Finalized", label: "Finalized", message: "Reviewed and finalized", requiresFile: true, pill: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", icon: "bg-emerald-50 text-emerald-600" },
  { value: "NotRequired", label: "Not Required", message: "Removed from this case", requiresFile: false, pill: "border-zinc-200 bg-zinc-100 text-zinc-600", dot: "bg-zinc-400", icon: "bg-zinc-100 text-zinc-500" },
];

function documentStatusMeta(status) {
  return documentStatusOptions.find((option) => option.value === status) || documentStatusOptions[0];
}

function formatFileSize(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function formatDocumentDate(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function DocumentStatusPicker({ documentItem, value, onChange, disabled, compact = false }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 300, maxHeight: 420 });
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const activeStatus = documentStatusMeta(value);

  useEffect(() => {
    if (!open) return undefined;
    function placeMenu() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(310, window.innerWidth - 24);
      const maxHeight = Math.min(420, window.innerHeight - 24);
      const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
      const top = window.innerHeight - rect.bottom >= Math.min(390, maxHeight)
        ? rect.bottom + 8
        : Math.max(12, rect.top - maxHeight - 8);
      setPosition({ top, left, width, maxHeight });
    }
    function closeFromOutside(event) {
      if (!buttonRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    }
    function closeFromKeyboard(event) {
      if (event.key === "Escape") setOpen(false);
    }
    placeMenu();
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [open]);

  return (
    <>
      <button ref={buttonRef} type="button" onClick={() => setOpen((current) => !current)} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} className={`inline-flex items-center justify-between gap-2 rounded-full border font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(15,23,42,0.04)] transition hover:brightness-[0.98] disabled:opacity-50 ${activeStatus.pill} ${compact ? "min-w-[9.5rem] px-3 py-1.5 text-xs" : "min-w-[10.5rem] px-3.5 py-2 text-xs"}`}>
        <span className="flex min-w-0 items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_3px_rgba(255,255,255,0.65)] ${activeStatus.dot}`} /><span className="truncate">{disabled ? "Updating…" : activeStatus.label}</span></span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? createPortal(
        <motion.div ref={menuRef} role="listbox" aria-label="Document status" initial={{ opacity: 0, y: -5, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }} style={{ position: "fixed", top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }} className="z-[390] overflow-y-auto rounded-[1.35rem] border border-white/90 bg-white/90 p-2 shadow-[0_22px_70px_rgba(15,23,42,0.24)] ring-1 ring-slate-900/5 backdrop-blur-2xl">
          <div className="px-3 pb-2 pt-1.5"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Document status</p><p className="mt-0.5 text-xs text-slate-500">Choose the current review stage.</p></div>
          <div className="space-y-1">
            {documentStatusOptions.map((option) => {
              const selected = option.value === value;
              const unavailable = option.requiresFile && !documentItem.storageKey;
              return <button key={option.value} type="button" role="option" aria-selected={selected} disabled={unavailable} onClick={() => { setOpen(false); onChange(option.value); }} className={`flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition ${selected ? "bg-slate-950 text-white shadow-sm" : "text-slate-700 hover:bg-slate-100/80"} disabled:cursor-not-allowed disabled:opacity-40`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${selected ? "bg-white/15 text-white" : option.icon}`}><span className={`h-2.5 w-2.5 rounded-full ${selected ? "bg-white" : option.dot}`} /></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{option.label}</span><span className={`mt-0.5 block truncate text-[10px] ${selected ? "text-white/65" : "text-slate-400"}`}>{unavailable ? "Upload a file to enable" : option.message}</span></span>{selected ? <Check className="h-4 w-4 shrink-0" /> : null}</button>;
            })}
          </div>
        </motion.div>,
        document.body,
      ) : null}
    </>
  );
}

function isMyDocument(documentItem) {
  return documentItem.visibility === "Internal" || String(documentItem.notes || "").startsWith(myDocumentMarker);
}

function normalize(value) {
  return normalizeDocumentName(value);
}

function findMatchingProgram(programs, values) {
  const candidates = values.map(normalize).filter(Boolean);
  if (!candidates.length) return null;

  return programs.find((program) => {
    const names = [program.title, ...(program.aliases || [])].map(normalize);
    return candidates.some((candidate) => names.includes(candidate));
  }) || programs.find((program) => {
    const names = [program.title, ...(program.aliases || [])].map(normalize);
    return candidates.some((candidate) => names.some((name) => name.includes(candidate) || candidate.includes(name)));
  });
}

const collectionOptions = [
  { id: "checklist", icon: ListChecks, title: "Checklist", description: "Start from a program and customize every item." },
  { id: "individual", icon: FilePlus2, title: "One document", description: "Request a single client document." },
  { id: "link", icon: Link2, title: "Upload link", description: "Share a secure upload destination." },
];

function ChecklistBuilder({
  programs,
  programsLoading,
  programsError,
  caseType,
  assignments,
  existingDocuments,
  onSelectionChange,
}) {
  const [search, setSearch] = useState("");
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [selectedNames, setSelectedNames] = useState(new Set());
  const [customDocuments, setCustomDocuments] = useState([]);
  const [customName, setCustomName] = useState("");

  const matchingProgram = useMemo(
    () => findMatchingProgram(programs, [assignments.at(-1)?.applicationType, caseType]),
    [assignments, caseType, programs],
  );
  const selectedProgram = programs.find((program) => program.id === selectedProgramId) || null;
  const existingNames = useMemo(
    () => new Set(existingDocuments.filter((document) => !isMyDocument(document) && document.status !== "NotRequired").map((document) => normalize(document.documentName))),
    [existingDocuments],
  );
  const unassignedNames = useMemo(
    () => new Set(existingDocuments.filter((document) => !isMyDocument(document) && document.status === "NotRequired").map((document) => normalize(document.documentName))),
    [existingDocuments],
  );
  const visiblePrograms = useMemo(() => {
    const query = normalize(search);
    if (!query) return programs;
    return programs.filter((program) =>
      [program.title, program.category, ...(program.aliases || [])]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [programs, search]);
  const checklistDocuments = useMemo(
    () => [...new Set([...(selectedProgram?.documents || []), ...customDocuments])],
    [customDocuments, selectedProgram],
  );
  const selectedDocuments = useMemo(
    () => checklistDocuments.filter((name) => selectedNames.has(name)),
    [checklistDocuments, selectedNames],
  );
  const newSelectedCount = useMemo(
    () => selectedDocuments.filter((name) => !existingNames.has(normalize(name))).length,
    [existingNames, selectedDocuments],
  );

  useEffect(() => {
    if (!selectedProgramId && matchingProgram) {
      setSelectedProgramId(matchingProgram.id);
      setSelectedNames(new Set(matchingProgram.documents));
    }
  }, [matchingProgram, selectedProgramId]);

  useEffect(() => {
    onSelectionChange({
      documents: selectedDocuments,
      programId: selectedProgram?.id || null,
      programName: selectedProgram?.title || "Custom checklist",
      newSelectedCount,
    });
  }, [newSelectedCount, onSelectionChange, selectedDocuments, selectedProgram]);

  function chooseProgram(program) {
    setSelectedProgramId(program.id);
    setSelectedNames(new Set(program.documents));
    setCustomDocuments([]);
    setCustomName("");
  }

  function toggleDocument(name) {
    setSelectedNames((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function addCustomDocument() {
    const name = customName.trim();
    if (!name || checklistDocuments.some((item) => normalize(item) === normalize(name))) return;
    setCustomDocuments((current) => [...current, name]);
    setSelectedNames((current) => new Set([...current, name]));
    setCustomName("");
  }

  function removeCustomDocument(name) {
    setCustomDocuments((current) => current.filter((item) => item !== name));
    setSelectedNames((current) => {
      const next = new Set(current);
      next.delete(name);
      return next;
    });
  }

  return (
    <div className="grid min-h-[30rem] overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="border-b border-slate-200 bg-slate-50/80 p-3 lg:border-r lg:border-b-0">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search programs"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-9 pl-9 text-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
          />
          {search ? (
            <button type="button" onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>

        {matchingProgram && !search ? (
          <button type="button" onClick={() => chooseProgram(matchingProgram)} className="mt-3 flex w-full items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-left text-xs font-semibold text-sky-800 ring-1 ring-sky-100">
            <Sparkles className="h-3.5 w-3.5" />
            Suggested for this case
          </button>
        ) : null}

        <div className="mt-3 max-h-[24rem] space-y-1 overflow-y-auto pr-1">
          {programsLoading ? <div className="space-y-2 px-1 py-2">{Array.from({ length: 6 }, (_, index) => <div key={index} className="animate-pulse rounded-xl bg-white p-3"><span className="block h-3 w-3/4 rounded bg-slate-100" /><span className="mt-2 block h-2 w-1/2 rounded bg-slate-100" /></div>)}</div> : null}
          {!programsLoading && programsError ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{programsError}</p> : null}
          {!programsLoading && !visiblePrograms.length ? <p className="px-3 py-8 text-center text-xs text-slate-500">No program matches “{search}”.</p> : null}
          {visiblePrograms.map((program) => {
            const active = program.id === selectedProgramId;
            return (
              <button
                key={program.id}
                type="button"
                onClick={() => chooseProgram(program)}
                className={`w-full rounded-xl px-3 py-2.5 text-left transition ${active ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white/70 hover:text-slate-950"}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="text-xs font-semibold leading-4">{program.title}</span>
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${active ? "bg-slate-950 text-white" : "border border-slate-300"}`}>
                    {active ? <Check className="h-2.5 w-2.5" /> : null}
                  </span>
                </span>
                <span className="mt-1 block text-[10px] text-slate-400">{program.category} · {program.documents.length} items</span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="min-w-0 p-4 sm:p-5">
        {selectedProgram ? (
          <motion.div key={selectedProgram.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Recommended starter checklist</p>
                <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">{selectedProgram.title}</h3>
                <p className="mt-1 text-xs text-slate-500">{selectedNames.size} selected · {newSelectedCount} new for this case</p>
              </div>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setSelectedNames(new Set(checklistDocuments))} className="rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">Select all</button>
                <button type="button" onClick={() => setSelectedNames(new Set())} className="rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">Clear</button>
              </div>
            </div>

            <div className="mt-4 grid max-h-[18rem] gap-2 overflow-y-auto pr-1 md:grid-cols-2">
              {checklistDocuments.map((name) => {
                const selected = selectedNames.has(name);
                const existing = existingNames.has(normalize(name));
                const unassigned = unassignedNames.has(normalize(name));
                const custom = customDocuments.includes(name);
                return (
                  <div key={name} className={`group flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-2 transition ${selected ? "border-sky-200 bg-sky-50/70" : "border-slate-100 bg-slate-50/70 text-slate-400"}`}>
                    <button type="button" onClick={() => toggleDocument(name)} aria-label={`${selected ? "Remove" : "Add"} ${name}`} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition ${selected ? "bg-sky-500 text-white shadow-sm" : "border border-slate-300 bg-white"}`}>
                      {selected ? <Check className="h-3.5 w-3.5" /> : null}
                    </button>
                    <button type="button" onClick={() => toggleDocument(name)} className="min-w-0 flex-1 text-left">
                      <span className="block text-xs font-medium leading-4">{name}</span>
                      {existing ? <span className="mt-0.5 block text-[10px] font-semibold text-emerald-600">Already on case</span> : null}
                      {unassigned ? <span className="mt-0.5 block text-[10px] font-semibold text-amber-600">Will be reassigned</span> : null}
                    </button>
                    {custom ? (
                      <button type="button" onClick={() => removeCustomDocument(name)} aria-label={`Delete ${name}`} className="text-slate-300 opacity-0 transition hover:text-rose-500 group-hover:opacity-100">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex gap-2">
              <input
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCustomDocument();
                  }
                }}
                placeholder="Add a custom document"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              />
              <button type="button" onClick={addCustomDocument} disabled={!customName.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-3.5 text-xs font-semibold text-white disabled:opacity-40">
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50/80 px-3 py-2 text-[11px] leading-4 text-amber-900">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              <p>
                Review against the applicant’s personalized IRCC checklist and country-specific instructions.
                {selectedProgram.sourceUrl ? (
                  <> <a href={selectedProgram.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline decoration-amber-300 underline-offset-2">Open IRCC guidance <ExternalLink className="h-3 w-3" /></a></>
                ) : null}
              </p>
            </div>
          </motion.div>
        ) : (
          <div className="flex min-h-[28rem] flex-col items-center justify-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><Search className="h-5 w-5" /></span>
            <h3 className="mt-4 text-sm font-semibold text-slate-900">Choose an immigration program</h3>
            <p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">Search on the left to load its recommended documents, then tailor the checklist for this client.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function RequestDocumentsOverlay({
  programs,
  programsLoading,
  programsError,
  caseType,
  assignments,
  existingDocuments,
  saving,
  error,
  onClose,
  onCreateChecklist,
  onCreateIndividual,
}) {
  const [method, setMethod] = useState("checklist");
  const [documentName, setDocumentName] = useState("");
  const [copied, setCopied] = useState(false);
  const [checklistSelection, setChecklistSelection] = useState({ documents: [], programId: null, programName: "Custom checklist", newSelectedCount: 0 });
  const uploadLink = `${window.location.origin}/upload/client-documents/${Date.now().toString(36)}`;

  return createPortal(
    <div className="fixed inset-0 z-[310] bg-slate-950/24 p-3 backdrop-blur-md">
      <motion.div initial={{ opacity: 0, y: 16, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-[0_28px_80px_rgba(15,23,42,0.26)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Collect client files</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">Request Documents</h2>
            <p className="mt-1 text-sm text-slate-500">Build the right request for this application.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 hover:bg-slate-50"><X className="h-4 w-4" /></button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-4 sm:p-5">
          {error ? <div className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
          <div className="mb-4 grid gap-2 sm:grid-cols-3">
            {collectionOptions.map(({ id, icon: Icon, title, description }) => (
              <button key={id} type="button" onClick={() => setMethod(id)} className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition ${method === id ? "border-slate-300 bg-white shadow-sm" : "border-transparent bg-white/55 hover:bg-white"}`}>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${method === id ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-500"}`}><Icon className="h-4 w-4" /></span>
                <span><span className="block text-xs font-semibold text-slate-950">{title}</span><span className="mt-0.5 block text-[10px] leading-4 text-slate-500">{description}</span></span>
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {method === "checklist" ? (
              <motion.div key="checklist" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
                <ChecklistBuilder
                  programs={programs}
                  programsLoading={programsLoading}
                  programsError={programsError}
                  caseType={caseType}
                  assignments={assignments}
                  existingDocuments={existingDocuments}
                  onSelectionChange={setChecklistSelection}
                />
              </motion.div>
            ) : method === "individual" ? (
              <motion.label key="individual" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="block rounded-[1.5rem] border border-slate-200 bg-white p-5">
                <span className="text-sm font-semibold text-slate-800">Document name</span>
                <input autoFocus value={documentName} onChange={(event) => setDocumentName(event.target.value)} placeholder="e.g. Updated passport" className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100" />
              </motion.label>
            ) : (
              <motion.section key="link" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="rounded-[1.5rem] border border-slate-200 bg-white p-5">
                <p className="text-sm font-semibold text-slate-950">Secure upload link</p>
                <div className="mt-3 flex gap-2"><input readOnly value={uploadLink} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600" /><button type="button" onClick={async () => { await navigator.clipboard?.writeText(uploadLink); setCopied(true); }} className="rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">{copied ? "Copied" : "Copy"}</button></div>
              </motion.section>
            )}
          </AnimatePresence>
        </main>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
          <p className="hidden text-xs text-slate-400 sm:block">Every checklist can be tailored before it is assigned.</p>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">Cancel</button>
            {method !== "link" ? (
              <button
                type="button"
                disabled={saving || (method === "individual" && !documentName.trim()) || (method === "checklist" && checklistSelection.newSelectedCount === 0)}
                onClick={() => method === "checklist" ? onCreateChecklist(checklistSelection) : onCreateIndividual(documentName.trim())}
                className="rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {saving ? "Creating…" : method === "checklist" ? `Add ${checklistSelection.newSelectedCount || ""} Documents`.replace("  ", " ") : "Request Document"}
              </button>
            ) : null}
          </div>
        </footer>
      </motion.div>
    </div>,
    document.body,
  );
}

function ConfirmAssignmentChange({ documentItems, targetStatus, saving, error, onClose, onConfirm }) {
  const reassigning = targetStatus === "Requested";
  const hasFileHistory = documentItems.some((item) => item.storageKey);
  const isBulk = documentItems.length > 1;
  const title = reassigning
    ? `Reassign ${isBulk ? `${documentItems.length} documents` : "this document"}?`
    : hasFileHistory
      ? `Mark ${isBulk ? `${documentItems.length} documents` : "this document"} as not required?`
      : `Unassign ${isBulk ? `${documentItems.length} documents` : "this document"}?`;

  return createPortal(
    <div className="fixed inset-0 z-[330] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-sm">
      <motion.div initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="w-full max-w-sm rounded-[1.6rem] border border-white/80 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.24)]">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Document assignment</p><h3 className="mt-1 text-lg font-semibold text-slate-950">{title}</h3></div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-900"><X className="h-3.5 w-3.5" /></button>
        </div>
        <p className="mt-4 text-sm font-semibold text-slate-800">{documentItems[0].documentName}{isBulk ? <span className="font-medium text-slate-400"> + {documentItems.length - 1} more</span> : null}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{reassigning ? "These requirements will return to Client Documents as missing." : hasFileHistory ? "Uploaded-file history will be preserved. These requirements can be reassigned later." : "The selection will move to Unassigned Documents and can be restored at any time."}</p>
        {error ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={saving} className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Updating…" : reassigning ? "Reassign" : hasFileHistory ? "Mark Not Required" : "Unassign"}</button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

function SpreadsheetPreview({ sheets }) {
  const [activeSheet, setActiveSheet] = useState(0);
  const sheet = sheets[activeSheet] || { name: "Sheet", rows: [] };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-white shadow-sm">
      {sheets.length > 1 ? <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 pt-2">{sheets.map((item, index) => <button key={`${item.name}-${index}`} type="button" onClick={() => setActiveSheet(index)} className={`min-w-max rounded-t-lg px-3 py-2 text-xs font-semibold ${activeSheet === index ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{item.name}</button>)}</div> : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-xs">
          <tbody>{sheet.rows.map((row, rowIndex) => <tr key={rowIndex} className={rowIndex === 0 ? "bg-slate-50 font-semibold text-slate-800" : "text-slate-600"}>{row.map((cell, columnIndex) => <td key={columnIndex} className="max-w-[24rem] whitespace-pre-wrap border border-slate-200 px-3 py-2 align-top">{String(cell ?? "")}</td>)}</tr>)}</tbody>
        </table>
        {!sheet.rows.length ? <p className="p-8 text-center text-sm text-slate-500">This worksheet is empty.</p> : null}
      </div>
    </div>
  );
}

function DocumentPreviewOverlay({ preview, onClose, onDownload, onChangeStatus, onDelete, onEdit, onAddToCase, editLabel = "Edit document", onPrevious, onNext, positionLabel, error, statusUpdating }) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const canChangeStatus = !preview.shared && !isMyDocument(preview.documentItem);
  let content;
  if (preview.kind === "frame") content = <iframe title={preview.name} src={preview.url} className="h-full w-full rounded-xl bg-white shadow-sm" />;
  else if (preview.kind === "image") content = <div className="flex h-full items-center justify-center overflow-auto rounded-xl bg-[linear-gradient(45deg,#e2e8f0_25%,transparent_25%),linear-gradient(-45deg,#e2e8f0_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e2e8f0_75%),linear-gradient(-45deg,transparent_75%,#e2e8f0_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px]"><img src={preview.url} alt={preview.name} className="max-h-full max-w-full object-contain" /></div>;
  else if (preview.kind === "html") content = <div className="h-full overflow-auto rounded-xl bg-white p-6 shadow-sm sm:p-10"><article className="mx-auto max-w-4xl text-sm leading-7 text-slate-800 [&_a]:text-sky-700 [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:my-4 [&_h2]:text-xl [&_h2]:font-semibold [&_img]:max-w-full [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:p-2" dangerouslySetInnerHTML={{ __html: preview.html }} /></div>;
  else if (preview.kind === "spreadsheet") content = <SpreadsheetPreview sheets={preview.sheets || []} />;
  else if (preview.kind === "text") content = <pre className="h-full overflow-auto whitespace-pre-wrap rounded-xl bg-white p-5 font-mono text-xs leading-6 text-slate-700 shadow-sm">{preview.text}</pre>;
  else content = <div className="flex h-full flex-col items-center justify-center rounded-xl bg-white text-center"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><FilePlus2 className="h-5 w-5" /></span><p className="mt-4 text-sm font-semibold text-slate-900">Preview is not available for this file type</p><p className="mt-1 text-xs text-slate-500">Legacy DOC, XLS, and presentation files currently require their native application.</p><button type="button" onClick={onDownload} className="mt-4 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white">Download Document</button></div>;

  return createPortal(
    <div className="fixed inset-0 z-[340] bg-slate-950/35 p-3 backdrop-blur-md">
      <motion.div initial={{ opacity: 0, y: 12, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-[1.8rem] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.3)]">
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3"><div className="flex shrink-0 gap-1"><button type="button" onClick={onPrevious} disabled={!onPrevious} aria-label="Previous document" className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button><button type="button" onClick={onNext} disabled={!onNext} aria-label="Next document" className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button></div><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-950">{preview.name}</p><p className="mt-0.5 text-[11px] text-slate-400">{positionLabel || "Secure document preview"}</p></div></div>
          <div className="flex items-center gap-2">
            {canChangeStatus ? <DocumentStatusPicker documentItem={preview.documentItem} value={preview.documentItem.status} onChange={onChangeStatus} disabled={statusUpdating} /> : null}
            <div className="relative"><button type="button" onClick={() => setActionsOpen((current) => !current)} aria-label="Document actions" className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"><Ellipsis className="h-4 w-4" /></button>{actionsOpen ? <motion.div initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="absolute right-0 top-11 z-30 w-52 overflow-hidden rounded-2xl border border-white/80 bg-white/95 p-1.5 shadow-[0_18px_55px_rgba(15,23,42,0.2)] backdrop-blur-xl">{onAddToCase ? <button type="button" onClick={() => { setActionsOpen(false); onAddToCase(); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-sky-700 hover:bg-sky-50"><Plus className="h-3.5 w-3.5" />Add to this case</button> : null}{onEdit ? <button type="button" onClick={() => { setActionsOpen(false); onEdit(); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"><FilePenLine className="h-3.5 w-3.5" />{editLabel}</button> : null}<button type="button" onClick={() => { setActionsOpen(false); onDownload(); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"><Download className="h-3.5 w-3.5" />Download</button>{onDelete ? <button type="button" onClick={() => { setActionsOpen(false); onDelete(); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" />Delete document</button> : null}</motion.div> : null}</div>
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600"><X className="h-4 w-4" /></button>
          </div>
        </header>
        {error ? <p className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-[11px] font-medium text-rose-700">{error}</p> : null}
        {preview.warning ? <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-[11px] text-amber-800">{preview.warning}</p> : null}
        <main className="min-h-0 flex-1 bg-slate-100 p-3">
          {content}
        </main>
      </motion.div>
    </div>,
    document.body,
  );
}

function DeleteDocumentDialog({ documentItem, saving, error, onClose, onConfirm }) {
  const documentItems = Array.isArray(documentItem) ? documentItem : [documentItem];
  const bulk = documentItems.length > 1;
  return createPortal(<div className="fixed inset-0 z-[360] flex items-center justify-center bg-slate-950/20 p-4 backdrop-blur-md"><button type="button" onClick={onClose} className="absolute inset-0 cursor-default" aria-label="Cancel delete" /><motion.section initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="relative w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/95 shadow-[0_30px_90px_rgba(15,23,42,0.24)] backdrop-blur-xl"><div className="px-6 pb-5 pt-6 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600 ring-8 ring-rose-50/50"><Trash2 className="h-5 w-5" /></span><p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-500">Delete {bulk ? "documents" : "document"}</p><h3 className="mt-2 text-lg font-semibold text-slate-950">{bulk ? `Delete ${documentItems.length} selected documents?` : `Delete “${documentItems[0].documentName}”?`}</h3><p className="mt-2 text-sm leading-6 text-slate-500">This permanently removes the selected {bulk ? "document records and their stored files" : "document record and its stored file"} from CaseDesk.</p>{error ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}</div><div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50/70 p-4"><button type="button" onClick={onClose} disabled={saving} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Keep {bulk ? "them" : "it"}</button><button type="button" onClick={onConfirm} disabled={saving} className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Deleting…" : `Delete ${bulk ? `${documentItems.length} Documents` : "Document"}`}</button></div></motion.section></div>, document.body);
}

function SharedLibraryUploadDialog({ saving, error, onClose, onUpload }) {
  const [file, setFile] = useState(null); const [title, setTitle] = useState(""); const [category, setCategory] = useState("Templates"); const [description, setDescription] = useState("");
  return createPortal(<div className="fixed inset-0 z-[360] flex items-center justify-center bg-slate-950/20 p-4 backdrop-blur-md"><button type="button" onClick={onClose} className="absolute inset-0 cursor-default" aria-label="Cancel shared library upload" /><motion.form initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} onSubmit={(event) => { event.preventDefault(); onUpload({ file, title: title.trim(), category, description: description.trim() }); }} className="relative w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/95 shadow-[0_30px_90px_rgba(15,23,42,0.24)] backdrop-blur-xl"><div className="flex items-start justify-between px-6 pb-4 pt-6"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-600">Workspace shared library</p><h3 className="mt-1 text-lg font-semibold text-slate-950">Add reusable resource</h3><p className="mt-1 text-sm text-slate-500">Use client-safe templates, guides, and precedents with personal information removed.</p></div><button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100"><X className="h-4 w-4" /></button></div><div className="space-y-4 px-6 pb-6"><label className="block rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center"><input required type="file" accept={acceptedDocumentTypes} onChange={(event) => { const selected = event.target.files?.[0] || null; setFile(selected); if (selected && !title) setTitle(selected.name.replace(/\.[^.]+$/, "")); }} className="hidden" /><UploadCloud className="mx-auto h-6 w-6 text-slate-400" /><span className="mt-2 block text-sm font-semibold text-slate-700">{file?.name || "Choose a file"}</span><span className="mt-1 block text-xs text-slate-400">PDF, Word, Excel, PowerPoint, images, or text · 25 MB max</span></label><label className="block"><span className="text-sm font-semibold text-slate-800">Library title</span><input required value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400" /></label><div className="grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-semibold text-slate-800">Category</span><select value={category} onChange={(event) => setCategory(event.target.value)} className="select-field mt-2 w-full"><option>Templates</option><option>IRCC Guides</option><option>Checklists</option><option>Letters & Agreements</option><option>Sample Affidavits</option><option>Internal Precedents</option><option>General</option></select></label><label><span className="text-sm font-semibold text-slate-800">Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none" placeholder="Optional note" /></label></div>{error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}</div><div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50/70 p-4"><button type="button" onClick={onClose} disabled={saving} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">Cancel</button><button type="submit" disabled={saving || !file || !title.trim()} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Uploading…" : "Add to Library"}</button></div></motion.form></div>, document.body);
}

function SharedLibraryEditDialog({ item, saving, error, onClose, onSave }) {
  const [title, setTitle] = useState(item.title);
  const [category, setCategory] = useState(item.category || "General");
  const [description, setDescription] = useState(item.description || "");
  return createPortal(<div className="fixed inset-0 z-[380] flex items-center justify-center bg-slate-950/20 p-4 backdrop-blur-md"><button type="button" onClick={onClose} className="absolute inset-0" aria-label="Cancel editing" /><motion.form initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} onSubmit={(event) => { event.preventDefault(); onSave({ title: title.trim(), category, description: description.trim() }); }} className="relative w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/95 shadow-[0_30px_90px_rgba(15,23,42,0.24)]"><div className="flex items-start justify-between px-6 pb-4 pt-6"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-600">Shared Library</p><h3 className="mt-1 text-lg font-semibold text-slate-950">Edit resource details</h3><p className="mt-1 text-sm text-slate-500">The stored file remains unchanged.</p></div><button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100"><X className="h-4 w-4" /></button></div><div className="space-y-4 px-6 pb-6"><label className="block text-sm font-semibold text-slate-800">Title<input required value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-sky-400" /></label><label className="block text-sm font-semibold text-slate-800">Category<select value={category} onChange={(event) => setCategory(event.target.value)} className="select-field mt-2 w-full">{sharedLibraryCategories.map((value) => <option key={value}>{value}</option>)}</select></label><label className="block text-sm font-semibold text-slate-800">Description<textarea rows="3" value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-sky-400" /></label>{error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}</div><div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50/70 p-4"><button type="button" onClick={onClose} disabled={saving} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold">Cancel</button><button type="submit" disabled={saving || !title.trim()} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save Changes"}</button></div></motion.form></div>, document.body);
}

function SharedLibraryDeleteDialog({ item, saving, error, onClose, onDelete }) {
  const usageCount = item._count?.clientDocuments || 0;
  return createPortal(<div className="fixed inset-0 z-[390] flex items-center justify-center bg-slate-950/20 p-4 backdrop-blur-md"><button type="button" onClick={onClose} className="absolute inset-0" aria-label="Cancel delete" /><motion.div initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="relative w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/95 shadow-[0_30px_90px_rgba(15,23,42,0.24)]"><div className="px-6 pb-5 pt-6 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600"><Trash2 className="h-5 w-5" /></span><p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-500">Delete shared resource</p><h3 className="mt-2 text-lg font-semibold">Delete “{item.title}”?</h3>{usageCount ? <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">This resource is used by {usageCount} case document{usageCount === 1 ? "" : "s"}. Remove those usages before deleting it.</p> : <p className="mt-2 text-sm leading-6 text-slate-500">This permanently removes the workspace resource and stored file.</p>}{error ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}</div><div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50/70 p-4"><button type="button" onClick={onClose} disabled={saving} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold">Keep Resource</button><button type="button" onClick={onDelete} disabled={saving || usageCount > 0} className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{saving ? "Deleting…" : "Delete Resource"}</button></div></motion.div></div>, document.body);
}

function SharedLibraryAddDialog({ item, saving, error, onClose, onAdd }) {
  const [mode, setMode] = useState("MyDocuments");
  const options = [
    { id: "MyDocuments", title: "Copy to My Documents", description: "Creates a private case copy that staff can open, edit, and organize." },
    { id: "ClientRequirement", title: "Add as client requirement", description: "Adds one requested item to the client checklist without attaching the library file." },
  ];
  return createPortal(<div className="fixed inset-0 z-[390] flex items-center justify-center bg-slate-950/20 p-4 backdrop-blur-md"><button type="button" onClick={onClose} className="absolute inset-0" aria-label="Cancel" /><motion.div initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="relative w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/95 shadow-[0_30px_90px_rgba(15,23,42,0.24)]"><div className="flex items-start justify-between px-6 pb-4 pt-6"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-600">Add to this case</p><h3 className="mt-1 text-lg font-semibold">{item.title}</h3><p className="mt-1 text-sm text-slate-500">Choose how this workspace resource should be used.</p></div><button type="button" onClick={onClose}><X className="h-4 w-4" /></button></div><div className="space-y-2 px-6 pb-6">{options.map((option) => <button key={option.id} type="button" onClick={() => setMode(option.id)} className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition ${mode === option.id ? "border-sky-200 bg-sky-50/70 ring-1 ring-sky-100" : "border-slate-200 hover:bg-slate-50"}`}><span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full ${mode === option.id ? "bg-sky-500 text-white" : "border border-slate-300"}`}>{mode === option.id ? <Check className="h-3.5 w-3.5" /> : null}</span><span><span className="block text-sm font-semibold text-slate-900">{option.title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span></span></button>)}{error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}</div><div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50/70 p-4"><button type="button" onClick={onClose} disabled={saving} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold">Cancel</button><button type="button" onClick={() => onAdd(mode)} disabled={saving} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Adding…" : "Add to Case"}</button></div></motion.div></div>, document.body);
}

function DocumentRow({ document, uploading, updating, selectable, selected, internal, fileBusy, deletable, statusUpdating, onToggleSelected, onUpload, onView, onChangeStatus, onRequestUnassign, onReassign, onDelete }) {
  const fileInput = useRef(null);
  const [dragging, setDragging] = useState(false);
  const received = Boolean(document.storageKey);
  const unassigned = document.status === "NotRequired";
  const hasFile = Boolean(document.storageKey);
  const statusMeta = documentStatusMeta(document.status);
  const metadata = [
    document.originalFilename,
    formatFileSize(document.fileSize),
    document.uploadedBy?.fullName ? `Uploaded by ${document.uploadedBy.fullName}` : "",
    formatDocumentDate(document.receivedAt || document.updatedAt || document.createdAt),
  ].filter(Boolean).join(" · ");
  const acceptsDrop = !internal && !unassigned && !hasFile && !updating && uploading === undefined;

  return (
    <div
      role={hasFile ? "button" : undefined}
      tabIndex={hasFile ? 0 : undefined}
      onClick={hasFile ? () => onView(document) : undefined}
      onKeyDown={hasFile ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onView(document); } } : undefined}
      onDragEnter={acceptsDrop ? (event) => { event.preventDefault(); setDragging(true); } : undefined}
      onDragOver={acceptsDrop ? (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragging(true); } : undefined}
      onDragLeave={acceptsDrop ? (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); } : undefined}
      onDrop={acceptsDrop ? (event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) onUpload(document, file); } : undefined}
      className={`relative grid grid-cols-[1fr_auto] items-center gap-4 border-b border-slate-100 px-4 py-3 transition last:border-b-0 ${hasFile ? "cursor-pointer hover:bg-slate-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400" : ""} ${dragging ? "bg-sky-50 ring-2 ring-inset ring-sky-300" : ""}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {selectable ? <button type="button" onClick={(event) => { event.stopPropagation(); onToggleSelected(document.id); }} aria-label={`${selected ? "Deselect" : "Select"} ${document.documentName}`} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition ${selected ? "bg-sky-500 text-white" : "border border-slate-300 bg-white hover:border-sky-400"}`}>{selected ? <Check className="h-3.5 w-3.5" /> : null}</button> : null}
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${received ? "bg-emerald-50 text-emerald-600" : unassigned ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-400"}`}>{received ? <CheckCircle2 className="h-4 w-4" /> : unassigned ? <RotateCcw className="h-4 w-4" /> : <FilePlus2 className="h-4 w-4" />}</span>
          <div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-slate-900">{document.documentName}</p>{document.status === "ChangesRequested" ? <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-amber-100">Changes requested</span> : null}</div><p className={`mt-0.5 text-xs ${document.status === "ChangesRequested" ? "font-medium text-amber-600" : "text-slate-500"}`}>{internal ? "Internal staff document" : statusMeta.message}</p>{metadata ? <p className="mt-1 truncate text-[10px] text-slate-400">{metadata}</p> : null}</div>
        </div>
        {uploading !== undefined ? <div className="mt-2 ml-10"><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><motion.div animate={{ width: `${uploading}%` }} className="h-full rounded-full bg-sky-500" /></div><p className="mt-1 text-[10px] font-semibold text-slate-400">Uploading {uploading}%</p></div> : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
        <input ref={fileInput} type="file" accept={acceptedDocumentTypes} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(document, file); event.target.value = ""; }} />
        {internal ? (
          <>{hasFile ? <span className="text-[11px] font-semibold text-slate-400">Click to open</span> : <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading !== undefined} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"><UploadCloud className="h-3.5 w-3.5" />Attach File</button>}</>
        ) : unassigned ? (
          <button type="button" onClick={() => onReassign(document)} disabled={updating} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />{updating ? "Restoring…" : "Reassign"}</button>
        ) : (
          <>
            {!hasFile ? <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading !== undefined || updating} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"><UploadCloud className="h-3.5 w-3.5" />Upload</button> : null}
            <DocumentStatusPicker documentItem={document} value={document.status} onChange={(status) => onChangeStatus(document, status)} disabled={statusUpdating || updating} compact />
          </>
        )}
        {deletable ? <button type="button" onClick={() => onDelete(document)} disabled={updating || fileBusy || uploading !== undefined} aria-label={`Delete ${document.documentName}`} title="Delete document" className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button> : null}
      </div>
      {dragging ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-sky-50/90 text-xs font-semibold text-sky-700 backdrop-blur-[1px]"><UploadCloud className="mr-2 h-4 w-4" />Drop to upload for “{document.documentName}”</div> : null}
    </div>
  );
}

function DocumentPagination({ page, pageCount, total, onChange }) {
  if (pageCount <= 1) return null;
  const start = (page - 1) * documentPageSize + 1;
  const end = Math.min(page * documentPageSize, total);

  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
      <p className="text-[11px] font-medium text-slate-500">Showing {start}–{end} of {total}</p>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onChange(page - 1)} disabled={page === 1} aria-label="Previous document page" className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 disabled:opacity-35"><ChevronLeft className="h-4 w-4" /></button>
        <span className="min-w-[4.5rem] text-center text-xs font-semibold text-slate-700">{page} of {pageCount}</span>
        <button type="button" onClick={() => onChange(page + 1)} disabled={page === pageCount} aria-label="Next document page" className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 disabled:opacity-35"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

export default function DocumentsWorkspace({ caseId, caseType, documents, assignments, saving, error, onCreateDocuments, onMarkReceived, onUpdateAssignment, onUploadMyDocument, onRefreshDocuments, onDeleteDocument, onChangeDocumentStatus }) {
  const [requestOpen, setRequestOpen] = useState(false);
  const [openFolder, setOpenFolder] = useState(() => {
    const stored = localStorage.getItem(`casedesk:documents-folder:${caseId}`);
    return ["client", "mine", "shared", "finalized", "unassigned"].includes(stored) ? stored : "client";
  });
  const [folderPage, setFolderPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("newest");
  const [uploading, setUploading] = useState({});
  const [programs, setPrograms] = useState([]);
  const [programsLoading, setProgramsLoading] = useState(true);
  const [programsError, setProgramsError] = useState("");
  const [confirmAssignment, setConfirmAssignment] = useState(null);
  const [assignmentUpdatingId, setAssignmentUpdatingId] = useState("");
  const [selectedDocumentIds, setSelectedDocumentIds] = useState(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [myDocumentUploading, setMyDocumentUploading] = useState(false);
  const [myDocumentProgress, setMyDocumentProgress] = useState(0);
  const [fileBusyId, setFileBusyId] = useState("");
  const [fileActionError, setFileActionError] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingId, setDeletingId] = useState("");
  const [statusUpdatingId, setStatusUpdatingId] = useState("");
  const [sharedDocuments, setSharedDocuments] = useState([]);
  const [sharedLoading, setSharedLoading] = useState(true);
  const [sharedError, setSharedError] = useState("");
  const [sharedUploadOpen, setSharedUploadOpen] = useState(false);
  const [sharedSaving, setSharedSaving] = useState(false);
  const [sharedBusyId, setSharedBusyId] = useState("");
  const [sharedCanManage, setSharedCanManage] = useState(false);
  const [sharedEditTarget, setSharedEditTarget] = useState(null);
  const [sharedDeleteTarget, setSharedDeleteTarget] = useState(null);
  const [sharedAddTarget, setSharedAddTarget] = useState(null);
  const [sharedActionError, setSharedActionError] = useState("");
  const [writtenDocuments, setWrittenDocuments] = useState([]);
  const myDocumentInput = useRef(null);
  const myDocuments = useMemo(
    () => documents.filter(isMyDocument),
    [documents],
  );
  const unfiledDrafts = useMemo(
    () => writtenDocuments.filter((item) => !item.clientDocument),
    [writtenDocuments],
  );
  const myFolderItems = useMemo(
    () => [...unfiledDrafts.map((item) => ({ id: `draft-${item.id}`, draft: item })), ...myDocuments],
    [myDocuments, unfiledDrafts],
  );
  const clientDocs = useMemo(
    () => deduplicateDocuments(documents.filter((item) => !isMyDocument(item) && item.status !== "NotRequired" && item.status !== "Finalized")),
    [documents],
  );
  const unassignedDocuments = useMemo(
    () => deduplicateDocuments(documents.filter((item) => !isMyDocument(item) && item.status === "NotRequired")),
    [documents],
  );
  const finalizedDocuments = useMemo(
    () => deduplicateDocuments(documents.filter((item) => !isMyDocument(item) && item.status === "Finalized")),
    [documents],
  );
  const receivedCount = clientDocs.filter((item) => item.storageKey).length;
  const folders = [
    { id: "client", title: "Client Documents", subtitle: `${clientDocs.length} requested files`, detail: `${receivedCount} of ${clientDocs.length} received`, count: clientDocs.length },
    { id: "mine", title: "My Documents", subtitle: "Private working files and drafts", count: myFolderItems.length },
    { id: "shared", title: "Shared Library", subtitle: "Workspace templates and reusable resources", count: sharedDocuments.length },
    { id: "finalized", title: "Finalized Documents", subtitle: "Reviewed and ready", count: finalizedDocuments.length },
    { id: "unassigned", title: "Unassigned Documents", subtitle: "Requirements removed from this case", count: unassignedDocuments.length },
  ];
  const availableSharedCategories = useMemo(() => [...new Set(sharedDocuments.map((item) => item.category).filter(Boolean))].sort(), [sharedDocuments]);
  const rawFolderDocuments = openFolder === "client"
    ? clientDocs
    : openFolder === "mine"
      ? myFolderItems
      : openFolder === "shared"
        ? sharedDocuments
    : openFolder === "finalized"
      ? finalizedDocuments
      : openFolder === "unassigned"
        ? unassignedDocuments
        : [];
  const currentFolderDocuments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const statusFilteringAvailable = ["client", "finalized", "unassigned"].includes(openFolder);
    const filtered = rawFolderDocuments.filter((item) => {
      const draft = item.draft;
      const searchable = draft
        ? `${draft.title} ${draft.status || "draft"}`
        : `${item.documentName || item.title || ""} ${item.originalFilename || ""} ${item.description || ""} ${item.category || ""} ${item.uploadedBy?.fullName || ""}`;
      if (query && !searchable.toLowerCase().includes(query)) return false;
      if (statusFilteringAvailable && statusFilter !== "all" && item.status !== statusFilter) return false;
      if (openFolder === "shared" && categoryFilter !== "all" && item.category !== categoryFilter) return false;
      return true;
    });
    return [...filtered].sort((left, right) => {
      const leftName = left.draft?.title || left.documentName || left.title || "";
      const rightName = right.draft?.title || right.documentName || right.title || "";
      const leftDate = new Date(left.draft?.updatedAt || left.updatedAt || left.createdAt || 0).getTime();
      const rightDate = new Date(right.draft?.updatedAt || right.updatedAt || right.createdAt || 0).getTime();
      if (sortOrder === "oldest") return leftDate - rightDate;
      if (sortOrder === "name") return leftName.localeCompare(rightName);
      if (sortOrder === "status") return String(left.status || left.draft?.status || "").localeCompare(String(right.status || right.draft?.status || "")) || leftName.localeCompare(rightName);
      return rightDate - leftDate;
    });
  }, [categoryFilter, openFolder, rawFolderDocuments, searchQuery, sortOrder, statusFilter]);
  const folderPageCount = Math.max(1, Math.ceil(currentFolderDocuments.length / documentPageSize));
  const currentFolderPage = Math.min(folderPage, folderPageCount);
  const paginatedFolderDocuments = currentFolderDocuments.slice((currentFolderPage - 1) * documentPageSize, currentFolderPage * documentPageSize);
  const actionDocuments = ["client", "finalized", "unassigned"].includes(openFolder) ? paginatedFolderDocuments : [];
  const selectedDocuments = actionDocuments.filter((document) => selectedDocumentIds.has(document.id));
  const allVisibleSelected = actionDocuments.length > 0 && selectedDocuments.length === actionDocuments.length;
  const previewableDocuments = currentFolderDocuments.filter((item) => !item.draft && item.storageKey);
  const previewIndex = preview ? previewableDocuments.findIndex((item) => item.id === preview.documentItem?.id) : -1;
  const filteredEmptyMessage = searchQuery.trim() || statusFilter !== "all" || categoryFilter !== "all" ? "No documents match the current search and filters." : null;

  useEffect(() => {
    let active = true;
    async function loadPrograms() {
      try {
        setProgramsLoading(true);
        const response = await api.get("/document-templates/catalog");
        if (active) {
          setPrograms(response.data.data || []);
          setProgramsError("");
        }
      } catch (requestError) {
        if (active) setProgramsError(requestError.response?.data?.message || "Program checklists could not load.");
      } finally {
        if (active) setProgramsLoading(false);
      }
    }
    loadPrograms();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadWrittenDocuments() {
      try {
        const response = await api.get(`/written-documents?caseId=${caseId}`);
        if (active) setWrittenDocuments(response.data.data || []);
      } catch (requestError) {
        if (active) setFileActionError(requestError.response?.data?.message || "Unable to load written document drafts.");
      }
    }
    loadWrittenDocuments();
    window.addEventListener("focus", loadWrittenDocuments);
    let channel;
    try {
      channel = new BroadcastChannel("casedesk-documents");
      channel.onmessage = (event) => { if (!event.data?.caseId || event.data.caseId === caseId) loadWrittenDocuments(); };
    } catch {
      // Focus refresh remains available.
    }
    return () => { active = false; window.removeEventListener("focus", loadWrittenDocuments); channel?.close(); };
  }, [caseId]);

  useEffect(() => {
    let active = true;
    api.get("/shared-library").then((response) => { if (active) { setSharedDocuments(response.data.data || []); setSharedCanManage(Boolean(response.data.meta?.canManage)); setSharedError(""); } }).catch((requestError) => { if (active) setSharedError(requestError.response?.data?.message || "Shared library could not load."); }).finally(() => { if (active) setSharedLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setSelectedDocumentIds(new Set());
    setFolderPage(1);
    setStatusFilter("all");
    setCategoryFilter("all");
    if (openFolder) localStorage.setItem(`casedesk:documents-folder:${caseId}`, openFolder);
  }, [caseId, openFolder]);

  useEffect(() => {
    setFolderPage(1);
    setSelectedDocumentIds(new Set());
  }, [categoryFilter, searchQuery, sortOrder, statusFilter]);

  useEffect(() => {
    if (folderPage > folderPageCount) setFolderPage(folderPageCount);
  }, [folderPage, folderPageCount]);

  useEffect(() => {
    setSelectedDocumentIds(new Set());
  }, [folderPage]);

  useEffect(() => {
    const refresh = () => onRefreshDocuments?.();
    window.addEventListener("focus", refresh);
    let channel;
    try {
      channel = new BroadcastChannel("casedesk-documents");
      channel.onmessage = (event) => { if (!event.data?.caseId || event.data.caseId === caseId) refresh(); };
    } catch {
      // Focus refresh remains available when BroadcastChannel is unsupported.
    }
    return () => { window.removeEventListener("focus", refresh); channel?.close(); };
  }, [caseId, onRefreshDocuments]);

  async function upload(document, file) {
    if (file.size > 25 * 1024 * 1024) {
      setFileActionError("Files must be 25 MB or smaller.");
      return;
    }
    setFileActionError("");
    setUploading((current) => ({ ...current, [document.id]: 1 }));
    try {
      await onMarkReceived(document.id, file, (progress) => setUploading((current) => ({ ...current, [document.id]: progress })));
    } catch {
      // The shared workspace error banner displays the upload failure.
    } finally {
      setUploading((current) => { const next = { ...current }; delete next[document.id]; return next; });
    }
  }

  async function uploadMyDocument(file) {
    if (file.size > 25 * 1024 * 1024) {
      setFileActionError("Files must be 25 MB or smaller.");
      return;
    }
    try {
      setFileActionError("");
      setMyDocumentUploading(true);
      setMyDocumentProgress(1);
      await onUploadMyDocument(file, setMyDocumentProgress);
      setOpenFolder("mine");
    } catch {
      // The workspace error banner displays the API failure.
    } finally {
      setMyDocumentUploading(false);
      setMyDocumentProgress(0);
    }
  }

  async function fetchDocumentBlob(documentItem, download = false) {
    const response = await api.get(`/client-documents/${documentItem.id}/file${download ? "?download=1" : ""}`, { responseType: "blob", timeout: 60000 });
    return response.data;
  }

  async function viewDocument(documentItem) {
    setFileBusyId(documentItem.id);
    setFileActionError("");
    setPreviewError("");
    try {
      const blob = await fetchDocumentBlob(documentItem);
      const rendered = await buildDocumentPreview(blob, documentItem);
      releaseDocumentPreview(preview);
      setPreview({ ...rendered, documentItem, name: documentItem.originalFilename || documentItem.documentName });
    } catch (requestError) {
      const message = requestError.response?.data?.message || requestError.message || "Unable to preview this document.";
      setFileActionError(message);
      if (preview) setPreviewError(message);
    } finally {
      setFileBusyId("");
    }
  }

  async function downloadDocument(documentItem) {
    setFileBusyId(documentItem.id);
    setFileActionError("");
    try {
      const blob = await fetchDocumentBlob(documentItem, true);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = documentItem.originalFilename || documentItem.documentName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (requestError) {
      const message = requestError.response?.data?.message || "Unable to download this document.";
      setFileActionError(message);
      if (preview) setPreviewError(message);
    } finally {
      setFileBusyId("");
    }
  }

  async function uploadSharedDocument({ file, title, category, description }) {
    try {
      setSharedSaving(true); setSharedError("");
      const formData = new FormData(); formData.append("file", file); formData.append("title", title); formData.append("category", category); formData.append("description", description);
      const response = await api.post("/shared-library/upload", formData, { timeout: 60000 });
      setSharedDocuments((current) => [response.data.data, ...current]); setSharedUploadOpen(false); setOpenFolder("shared");
    } catch (requestError) { setSharedError(requestError.response?.data?.message || "Unable to add this resource to the shared library."); throw requestError; } finally { setSharedSaving(false); }
  }

  async function fetchSharedBlob(item, download = false) {
    const response = await api.get(`/shared-library/${item.id}/file${download ? "?download=1" : ""}`, { responseType: "blob", timeout: 60000 });
    return response.data;
  }

  async function viewSharedDocument(item) {
    try { setSharedBusyId(item.id); setSharedError(""); setPreviewError(""); const blob = await fetchSharedBlob(item); const rendered = await buildDocumentPreview(blob, item); releaseDocumentPreview(preview); setPreview({ ...rendered, documentItem: item, shared: true, name: item.originalFilename || item.title }); } catch (requestError) { setSharedError(requestError.response?.data?.message || "Unable to preview this shared resource."); } finally { setSharedBusyId(""); }
  }

  async function downloadSharedDocument(item) {
    try { setSharedBusyId(item.id); const blob = await fetchSharedBlob(item, true); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = item.originalFilename || item.title; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (requestError) { const message = requestError.response?.data?.message || "Unable to download this shared resource."; setSharedError(message); if (preview) setPreviewError(message); } finally { setSharedBusyId(""); }
  }

  async function deleteSharedDocument(item) {
    try { setSharedBusyId(item.id); setSharedActionError(""); await api.delete(`/shared-library/${item.id}`); setSharedDocuments((current) => current.filter((entry) => entry.id !== item.id)); setSharedDeleteTarget(null); if (preview?.shared && preview.documentItem.id === item.id) closePreview(); } catch (requestError) { setSharedActionError(requestError.response?.data?.message || "Unable to delete this shared resource."); } finally { setSharedBusyId(""); }
  }

  async function editSharedDocument(changes) {
    try {
      setSharedSaving(true); setSharedActionError("");
      const response = await api.patch(`/shared-library/${sharedEditTarget.id}`, changes);
      const updated = response.data.data;
      setSharedDocuments((current) => current.map((item) => item.id === updated.id ? updated : item));
      setPreview((current) => current?.shared && current.documentItem.id === updated.id ? { ...current, documentItem: updated, name: updated.originalFilename || updated.title } : current);
      setSharedEditTarget(null);
    } catch (requestError) { setSharedActionError(requestError.response?.data?.message || "Unable to update this shared resource."); } finally { setSharedSaving(false); }
  }

  async function addSharedDocumentToCase(mode) {
    try {
      setSharedSaving(true); setSharedActionError("");
      await api.post(`/shared-library/${sharedAddTarget.id}/add-to-case`, { caseId, mode });
      setSharedDocuments((current) => current.map((item) => item.id === sharedAddTarget.id ? { ...item, _count: { ...item._count, clientDocuments: (item._count?.clientDocuments || 0) + 1 } } : item));
      await onRefreshDocuments?.();
      setSharedAddTarget(null);
      closePreview();
      setOpenFolder(mode === "MyDocuments" ? "mine" : "client");
    } catch (requestError) { setSharedActionError(requestError.response?.data?.message || "Unable to add this resource to the case."); } finally { setSharedSaving(false); }
  }

  function closePreview() {
    releaseDocumentPreview(preview);
    setPreview(null);
    setPreviewError("");
  }

  function navigatePreview(offset) {
    const target = previewableDocuments[previewIndex + offset];
    if (!target) return;
    if (openFolder === "shared") viewSharedDocument(target);
    else viewDocument(target);
  }

  async function reassign(document) {
    try {
      setAssignmentUpdatingId(document.id);
      await onUpdateAssignment(document.id, "Requested");
      setOpenFolder("client");
    } catch {
      // The parent stores the API error, which stays visible in this workspace.
    } finally {
      setAssignmentUpdatingId("");
    }
  }

  async function changeDocumentStatus(documentItem, status) {
    if (status === documentItem.status) return documentItem;
    try {
      setStatusUpdatingId(documentItem.id);
      setFileActionError("");
      setPreviewError("");
      const updated = await onChangeDocumentStatus(documentItem.id, status);
      setPreview((current) => current?.documentItem?.id === updated.id ? { ...current, documentItem: updated } : current);
      if (status === "Finalized") setOpenFolder("finalized");
      else if (status === "NotRequired") setOpenFolder("unassigned");
      else if (["finalized", "unassigned"].includes(openFolder)) setOpenFolder("client");
      return updated;
    } catch (requestError) {
      const message = requestError.response?.data?.message || "Unable to update document status.";
      setFileActionError(message);
      if (preview?.documentItem?.id === documentItem.id) setPreviewError(message);
      return null;
    } finally {
      setStatusUpdatingId("");
    }
  }

  function toggleSelected(documentId) {
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedDocumentIds(allVisibleSelected ? new Set() : new Set(actionDocuments.map((document) => document.id)));
  }

  function requestSingleUnassign(documentItem) {
    setConfirmAssignment({ documentItems: [documentItem], targetStatus: "NotRequired" });
  }

  function requestBulkChange() {
    if (!selectedDocuments.length) return;
    setConfirmAssignment({
      documentItems: selectedDocuments,
      targetStatus: openFolder === "unassigned" ? "Requested" : "NotRequired",
    });
  }

  async function confirmAssignmentChange() {
    if (!confirmAssignment) return;
    const ids = confirmAssignment.documentItems.map((document) => document.id);
    const isBulk = ids.length > 1;
    try {
      if (isBulk) setBulkUpdating(true);
      else setAssignmentUpdatingId(ids[0]);
      await onUpdateAssignment(ids, confirmAssignment.targetStatus);
      if (confirmAssignment.targetStatus === "Requested") setOpenFolder("client");
      setSelectedDocumentIds(new Set());
      setConfirmAssignment(null);
    } catch {
      // Keep the confirmation open so staff can see the error and retry safely.
    } finally {
      setAssignmentUpdatingId("");
      setBulkUpdating(false);
    }
  }

  function renderDocumentRows(items, emptyMessage) {
    return (
      <div>
        {items.map((document) => (
          <DocumentRow
            key={document.id}
            document={document}
            uploading={uploading[document.id]}
            updating={bulkUpdating || assignmentUpdatingId === document.id}
            selectable
            selected={selectedDocumentIds.has(document.id)}
            onToggleSelected={toggleSelected}
            onUpload={upload}
            onView={viewDocument}
            fileBusy={fileBusyId === document.id}
            deletable={openFolder === "unassigned" || openFolder === "finalized"}
            statusUpdating={statusUpdatingId === document.id}
            onChangeStatus={changeDocumentStatus}
            onRequestUnassign={requestSingleUnassign}
            onReassign={reassign}
            onDelete={setDeleteTarget}
          />
        ))}
        {!items.length ? <p className="p-8 text-center text-sm text-slate-500">{emptyMessage}</p> : null}
      </div>
    );
  }

  function renderMyDocuments(items) {
    return (
      <div>
        {items.map((document) => document.draft ? <button key={document.id} type="button" onClick={() => window.open(`/cases/${caseId}/documents/${document.draft.id}/edit`, "_blank", "noopener,noreferrer")} className="flex w-full items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50"><span className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><FilePenLine className="h-4 w-4" /></span><span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900">{document.draft.title}</span><span className="mt-0.5 block text-xs text-slate-500">Autosaved draft · Updated {new Date(document.draft.updatedAt).toLocaleString()}</span></span></span><span className="rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700">Continue writing</span></button> : <DocumentRow key={document.id} document={document} internal fileBusy={fileBusyId === document.id} onUpload={upload} onView={viewDocument} />)}
        {!items.length && filteredEmptyMessage ? <p className="p-8 text-center text-sm text-slate-500">{filteredEmptyMessage}</p> : null}{!myFolderItems.length && !filteredEmptyMessage ? <div className="flex flex-col items-center px-5 py-10 text-center"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><UploadCloud className="h-5 w-5" /></span><p className="mt-3 text-sm font-semibold text-slate-800">No internal documents yet</p><p className="mt-1 text-xs text-slate-500">Upload working files, drafts, or supporting material for this case.</p><button type="button" onClick={() => myDocumentInput.current?.click()} className="mt-4 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white">Upload Document</button></div> : null}
      </div>
    );
  }

  function renderSharedLibrary(items) {
    if (sharedLoading) return <div className="divide-y divide-slate-100">{Array.from({ length: 5 }, (_, index) => <div key={index} className="flex animate-pulse items-center gap-3 px-4 py-4"><span className="h-9 w-9 rounded-xl bg-slate-100" /><span className="flex-1"><span className="block h-3 w-1/3 rounded bg-slate-100" /><span className="mt-2 block h-2.5 w-2/3 rounded bg-slate-100" /></span></div>)}</div>;
    return <div>{sharedError ? <p className="m-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{sharedError}</p> : null}{items.map((item) => <div key={item.id} role="button" tabIndex={0} onClick={() => viewSharedDocument(item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); viewSharedDocument(item); } }} className="grid cursor-pointer grid-cols-[1fr_auto] items-center gap-4 border-b border-slate-100 px-4 py-3 transition hover:bg-slate-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400 last:border-b-0"><div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600"><FolderOpen className="h-4 w-4" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.title}</p><p className="mt-0.5 truncate text-xs text-slate-500">{item.category} · {item.description || item.originalFilename}</p><p className="mt-1 truncate text-[10px] text-slate-400">{item.originalFilename} · {formatFileSize(item.fileSize)} · Added by {item.uploadedBy?.fullName || "Staff"} · {formatDocumentDate(item.updatedAt || item.createdAt)}</p></div></div>{item._count?.clientDocuments ? <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-violet-700">Used in {item._count.clientDocuments}</span> : <span className="text-[10px] font-semibold text-slate-400">Click to open</span>}</div>)}{!items.length && filteredEmptyMessage ? <p className="p-8 text-center text-sm text-slate-500">{filteredEmptyMessage}</p> : null}{!sharedDocuments.length && !filteredEmptyMessage ? <div className="flex flex-col items-center px-5 py-10 text-center"><FolderOpen className="h-7 w-7 text-sky-400" /><p className="mt-3 text-sm font-semibold text-slate-800">Build your workspace knowledge library</p><p className="mt-1 max-w-md text-xs leading-5 text-slate-500">Add reusable templates, guides, checklists, client-safe precedents, and standard letters.</p>{sharedCanManage ? <button type="button" onClick={() => setSharedUploadOpen(true)} className="mt-4 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white">Add Resource</button> : null}</div> : null}</div>;
  }

  return (
    <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-[#eef0f3] shadow-[0_24px_70px_rgba(15,23,42,0.13)]">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur-xl">
        <div className="flex gap-2"><span className="h-3 w-3 rounded-full bg-[#ff5f57]" /><span className="h-3 w-3 rounded-full bg-[#febc2e]" /><span className="h-3 w-3 rounded-full bg-[#28c840]" /></div>
        <p className="text-xs font-semibold text-slate-500">Case Documents</p>
        <button type="button" onClick={() => setRequestOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />Request Documents</button>
      </header>
      <main className="p-4">
        <input ref={myDocumentInput} type="file" accept={acceptedDocumentTypes} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadMyDocument(file); event.target.value = ""; }} />
        {error || fileActionError ? <div className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{fileActionError || error}</div> : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {folders.map((folder) => {
            const active = openFolder === folder.id;
            const FolderIcon = active ? FolderOpen : Folder;
            return (
              <motion.button key={folder.id} layout type="button" onClick={() => setOpenFolder(active ? "" : folder.id)} whileHover={{ y: -2 }} whileTap={{ scale: 0.985 }} className={`rounded-[1.25rem] border p-4 text-left transition ${active ? "border-sky-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.1)]" : "border-white/70 bg-white/70 hover:bg-white"}`}>
                <div className="flex items-start justify-between"><FolderIcon className={`h-9 w-9 ${active ? "text-sky-500" : "text-sky-400"}`} /><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">{folder.count}</span></div>
                <h3 className="mt-3 text-sm font-semibold text-slate-950">{folder.title}</h3><p className="mt-1 text-[11px] leading-4 text-slate-500">{folder.subtitle}</p>{folder.detail ? <p className="mt-2 text-[11px] font-semibold text-sky-700">{folder.detail}</p> : null}
              </motion.button>
            );
          })}
        </div>
        <AnimatePresence mode="wait">
          {openFolder ? (
            <motion.section key={openFolder} initial={{ opacity: 0, y: 8, height: 0 }} animate={{ opacity: 1, y: 0, height: "auto" }} exit={{ opacity: 0, y: -5, height: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} className="mt-4 overflow-hidden rounded-[1.25rem] border border-white/80 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <div><p className="text-sm font-semibold text-slate-950">{folders.find((folder) => folder.id === openFolder)?.title}</p><p className="mt-0.5 text-xs text-slate-500">{openFolder === "mine" ? "Internal working files stay separate from client requests." : "Only the requirements assigned to this case appear here."}</p></div>
                <div className="flex items-center gap-2">
                  {actionDocuments.length ? <button type="button" onClick={toggleSelectAll} disabled={bulkUpdating} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">{allVisibleSelected ? "Clear page" : "Select page"}</button> : null}
                  {openFolder === "client" ? <button type="button" onClick={() => setRequestOpen(true)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">Add document</button> : null}
                  {openFolder === "mine" ? <><button type="button" onClick={() => window.open(`/cases/${caseId}/documents/new`, "_blank", "noopener,noreferrer")} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"><FilePenLine className="h-3.5 w-3.5" />New Written Document</button><button type="button" onClick={() => myDocumentInput.current?.click()} disabled={myDocumentUploading} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><UploadCloud className="h-3.5 w-3.5" />{myDocumentUploading ? `Uploading ${myDocumentProgress}%` : "Upload Document"}</button></> : null}
                  {openFolder === "shared" && sharedCanManage ? <button type="button" onClick={() => setSharedUploadOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />Add Resource</button> : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/45 px-4 py-2.5">
                <label className="relative min-w-[13rem] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={`Search ${folders.find((folder) => folder.id === openFolder)?.title.toLowerCase() || "documents"}`} className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-xs text-slate-700 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100" />{searchQuery ? <button type="button" onClick={() => setSearchQuery("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button> : null}</label>
                {["client", "finalized", "unassigned"].includes(openFolder) ? <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="select-field h-9 py-0 text-xs"><option value="all">All statuses</option>{documentStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : null}
                {openFolder === "shared" ? <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="select-field h-9 py-0 text-xs"><option value="all">All categories</option>{availableSharedCategories.map((category) => <option key={category}>{category}</option>)}</select> : null}
                <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="select-field h-9 py-0 text-xs"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option><option value="status">Status</option></select>
                <span className="px-1 text-[10px] font-semibold text-slate-400">{currentFolderDocuments.length} shown</span>
              </div>
              <AnimatePresence initial={false}>
                {selectedDocuments.length ? (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden border-b border-sky-100 bg-sky-50/70">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                      <p className="text-xs font-semibold text-sky-900">{selectedDocuments.length} selected</p>
                      <div className="flex gap-2"><button type="button" onClick={() => setSelectedDocumentIds(new Set())} disabled={bulkUpdating} className="rounded-full px-3 py-1.5 text-xs font-semibold text-sky-700 disabled:opacity-50">Clear</button>{openFolder === "unassigned" || openFolder === "finalized" ? <button type="button" onClick={() => setDeleteTarget(selectedDocuments)} disabled={bulkUpdating} aria-label="Delete selected documents" title="Delete selected" className="flex h-8 w-8 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /></button> : null}<button type="button" onClick={requestBulkChange} disabled={bulkUpdating} className="rounded-full bg-slate-950 px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{openFolder === "unassigned" ? "Reassign selected" : openFolder === "finalized" ? "Mark not required" : "Unassign selected"}</button></div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
              {openFolder === "client" ? renderDocumentRows(paginatedFolderDocuments, filteredEmptyMessage || "No documents are currently assigned.") : openFolder === "mine" ? renderMyDocuments(paginatedFolderDocuments) : openFolder === "shared" ? renderSharedLibrary(paginatedFolderDocuments) : openFolder === "finalized" ? renderDocumentRows(paginatedFolderDocuments, filteredEmptyMessage || "No finalized documents yet.") : openFolder === "unassigned" ? renderDocumentRows(paginatedFolderDocuments, filteredEmptyMessage || "No unassigned documents.") : <p className="p-8 text-center text-sm text-slate-500">This folder is ready for documents.</p>}
              <DocumentPagination page={currentFolderPage} pageCount={folderPageCount} total={currentFolderDocuments.length} onChange={setFolderPage} />
            </motion.section>
          ) : null}
        </AnimatePresence>
      </main>
      {requestOpen ? (
        <RequestDocumentsOverlay
          programs={programs}
          programsLoading={programsLoading}
          programsError={programsError}
          caseType={caseType}
          assignments={assignments}
          existingDocuments={documents}
          saving={saving}
          error={error}
          onClose={() => setRequestOpen(false)}
          onCreateChecklist={async ({ documents: names, programId, programName }) => { await onCreateDocuments(names, { programId, programName }); setRequestOpen(false); setOpenFolder("client"); }}
          onCreateIndividual={async (name) => { await onCreateDocuments([name], { programName: "Individual request" }); setRequestOpen(false); setOpenFolder("client"); }}
        />
      ) : null}
      {confirmAssignment ? <ConfirmAssignmentChange documentItems={confirmAssignment.documentItems} targetStatus={confirmAssignment.targetStatus} saving={bulkUpdating || assignmentUpdatingId === confirmAssignment.documentItems[0]?.id} error={error} onClose={() => setConfirmAssignment(null)} onConfirm={confirmAssignmentChange} /> : null}
      {preview ? <DocumentPreviewOverlay preview={preview} onClose={closePreview} onDownload={() => preview.shared ? downloadSharedDocument(preview.documentItem) : downloadDocument(preview.documentItem)} statusUpdating={statusUpdatingId === preview.documentItem?.id} onChangeStatus={(status) => changeDocumentStatus(preview.documentItem, status)} onPrevious={previewIndex > 0 ? () => navigatePreview(-1) : undefined} onNext={previewIndex >= 0 && previewIndex < previewableDocuments.length - 1 ? () => navigatePreview(1) : undefined} positionLabel={previewIndex >= 0 ? `${previewIndex + 1} of ${previewableDocuments.length} · Secure document preview` : "Secure document preview"} error={previewError} onAddToCase={preview.shared ? () => { setSharedActionError(""); setSharedAddTarget(preview.documentItem); } : undefined} editLabel={preview.shared ? "Edit resource" : "Edit document"} onEdit={preview.shared ? (sharedCanManage ? () => { setSharedActionError(""); setSharedEditTarget(preview.documentItem); } : undefined) : preview.documentItem?.writtenDocument ? () => window.open(`/cases/${caseId}/documents/${preview.documentItem.writtenDocument.id}/edit`, "_blank", "noopener,noreferrer") : undefined} onDelete={preview.shared ? (sharedCanManage ? () => { setSharedActionError(""); setSharedDeleteTarget(preview.documentItem); } : undefined) : () => { const target = preview.documentItem; closePreview(); setDeleteTarget(target); }} /> : null}
      {deleteTarget ? <DeleteDocumentDialog documentItem={deleteTarget} saving={Boolean(deletingId)} error={error} onClose={() => setDeleteTarget(null)} onConfirm={async () => { const targets = Array.isArray(deleteTarget) ? deleteTarget : [deleteTarget]; try { setDeletingId(targets.length > 1 ? "bulk" : targets[0].id); await Promise.all(targets.map((item) => onDeleteDocument(item.id))); setSelectedDocumentIds(new Set()); setDeleteTarget(null); } finally { setDeletingId(""); } }} /> : null}
      {sharedUploadOpen ? <SharedLibraryUploadDialog saving={sharedSaving} error={sharedError} onClose={() => setSharedUploadOpen(false)} onUpload={uploadSharedDocument} /> : null}
      {sharedEditTarget ? <SharedLibraryEditDialog item={sharedEditTarget} saving={sharedSaving} error={sharedActionError} onClose={() => setSharedEditTarget(null)} onSave={editSharedDocument} /> : null}
      {sharedDeleteTarget ? <SharedLibraryDeleteDialog item={sharedDeleteTarget} saving={sharedBusyId === sharedDeleteTarget.id} error={sharedActionError} onClose={() => setSharedDeleteTarget(null)} onDelete={() => deleteSharedDocument(sharedDeleteTarget)} /> : null}
      {sharedAddTarget ? <SharedLibraryAddDialog item={sharedAddTarget} saving={sharedSaving} error={sharedActionError} onClose={() => setSharedAddTarget(null)} onAdd={addSharedDocumentToCase} /> : null}
    </div>
  );
}
