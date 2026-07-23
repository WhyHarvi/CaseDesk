import { BookOpen, FileStack, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";
import Select from "../ui/Select";

function groupByCaseType(templates) {
  const groups = new Map();
  for (const template of templates) {
    if (!groups.has(template.caseType)) groups.set(template.caseType, []);
    groups.get(template.caseType).push(template);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function CatalogBrowser({ catalog, loading, onImport, importingId, onClose }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((program) => [program.title, program.category, ...(program.aliases || [])].join(" ").toLowerCase().includes(q));
  }, [catalog, query]);

  return createPortal(
    <div className="fixed inset-0 z-[260] bg-slate-950/24 p-3 backdrop-blur-md" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="mx-auto flex h-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.26)]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Starter checklists</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Browse IRCC program checklists</h2>
            <p className="mt-1 max-w-xl text-sm text-slate-500">Import a program's common document list as a starting point, then edit it freely below.</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-slate-100 px-5 py-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400"
            placeholder="Search programs (e.g. Study Permit, Express Entry)"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-3">{[0, 1, 2].map((key) => <div key={key} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}</div>
          ) : (
            <div className="space-y-3">
              {filtered.map((program) => (
                <div key={program.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{program.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{program.category} · {program.documents.length} documents{program.agencyDocumentCount ? ` · ${program.agencyDocumentCount} already in your checklist` : ""}</p>
                    </div>
                    <button
                      type="button"
                      disabled={importingId === program.id}
                      onClick={() => onImport(program)}
                      className="shrink-0 rounded-full bg-slate-950 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {importingId === program.id ? "Importing…" : "Import checklist"}
                    </button>
                  </div>
                  <p className="mt-2 truncate text-xs text-slate-400">{program.documents.join(", ")}</p>
                </div>
              ))}
              {filtered.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">No programs match your search.</p> : null}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function DocumentTemplatesSettingsPanel() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [newCaseType, setNewCaseType] = useState("");
  const [newDocuments, setNewDocuments] = useState({}); // caseType -> draft name
  const [savingKey, setSavingKey] = useState("");

  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [importingId, setImportingId] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/document-templates");
      setTemplates(data.data);
    } catch (reason) {
      setError(reason.response?.data?.message || "Document templates could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const groups = useMemo(() => groupByCaseType(templates), [templates]);

  async function addDocument(caseType) {
    const documentName = (newDocuments[caseType] || "").trim();
    if (!documentName) return;
    setSavingKey(`add-${caseType}`);
    try {
      const { data } = await api.post("/document-templates", { caseType, documentName, isRequired: true });
      setTemplates((current) => [...current, data.data]);
      setNewDocuments((current) => ({ ...current, [caseType]: "" }));
    } catch (reason) {
      setError(reason.response?.data?.message || "The document could not be added.");
    } finally {
      setSavingKey("");
    }
  }

  async function addCaseType(event) {
    event.preventDefault();
    const caseType = newCaseType.trim();
    if (!caseType) return;
    setSavingKey("new-case-type");
    try {
      const { data } = await api.post("/document-templates", { caseType, documentName: "Passport", isRequired: true });
      setTemplates((current) => [...current, data.data]);
      setNewCaseType("");
      setNotice(`${caseType} checklist created — add more documents below.`);
    } catch (reason) {
      setError(reason.response?.data?.message || "The case type could not be added.");
    } finally {
      setSavingKey("");
    }
  }

  async function toggleRequired(template) {
    setSavingKey(template.id);
    try {
      const { data } = await api.patch(`/document-templates/${template.id}`, { isRequired: !template.isRequired });
      setTemplates((current) => current.map((item) => (item.id === template.id ? data.data : item)));
    } catch (reason) {
      setError(reason.response?.data?.message || "The document could not be updated.");
    } finally {
      setSavingKey("");
    }
  }

  async function removeDocument(template) {
    setSavingKey(template.id);
    try {
      await api.delete(`/document-templates/${template.id}`);
      setTemplates((current) => current.filter((item) => item.id !== template.id));
    } catch (reason) {
      setError(reason.response?.data?.message || "The document could not be removed.");
    } finally {
      setSavingKey("");
    }
  }

  async function openCatalog() {
    setCatalogOpen(true);
    if (catalog.length) return;
    setCatalogLoading(true);
    try {
      const { data } = await api.get("/document-templates/catalog");
      setCatalog(data.data);
    } catch (reason) {
      setError(reason.response?.data?.message || "The starter checklist catalog could not be loaded.");
    } finally {
      setCatalogLoading(false);
    }
  }

  async function importProgram(program) {
    setImportingId(program.id);
    try {
      const existingNames = new Set(templates.filter((t) => t.caseType === program.title).map((t) => t.documentName));
      const toCreate = program.documents.filter((name) => !existingNames.has(name));
      const created = await Promise.all(toCreate.map((documentName) => api.post("/document-templates", { caseType: program.title, documentName, isRequired: true })));
      setTemplates((current) => [...current, ...created.map((response) => response.data.data)]);
      setNotice(`Imported ${toCreate.length} document${toCreate.length === 1 ? "" : "s"} into ${program.title}.`);
      setCatalogOpen(false);
    } catch (reason) {
      setError(reason.response?.data?.message || "The checklist could not be imported.");
    } finally {
      setImportingId("");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <FileStack className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Document Templates</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Set the document checklist each case type starts with. These drive the required-documents list on every
              new case of that type.
            </p>
          </div>
        </div>
        <button type="button" onClick={openCatalog} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950">
          <BookOpen className="h-4 w-4" />
          Browse starter checklists
        </button>
      </div>

      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</div> : null}
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div> : null}

      <form onSubmit={addCaseType} className="flex flex-wrap items-end gap-3 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-4">
        <label className="flex-1 text-sm font-medium text-slate-700">
          Add a case type
          <input
            value={newCaseType}
            onChange={(event) => setNewCaseType(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400"
            placeholder="e.g. Spousal Sponsorship"
          />
        </label>
        <button type="submit" disabled={savingKey === "new-case-type" || !newCaseType.trim()} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
          <Plus className="h-4 w-4" />
          Create checklist
        </button>
      </form>

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((key) => <div key={key} className="h-24 animate-pulse rounded-3xl bg-slate-100" />)}</div>
      ) : groups.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
          No document checklists yet — add a case type above or import a starter checklist.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(([caseType, docs]) => (
            <div key={caseType} className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-3">
                <h3 className="font-semibold text-slate-950">{caseType}</h3>
                <p className="mt-0.5 text-xs text-slate-500">{docs.length} document{docs.length === 1 ? "" : "s"}</p>
              </div>
              <div className="divide-y divide-slate-100">
                {docs.map((template) => (
                  <div key={template.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="min-w-0 truncate text-sm font-medium text-slate-800">{template.documentName}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <Select
                        value={template.isRequired ? "required" : "optional"}
                        onChange={() => toggleRequired(template)}
                        selectClassName="text-xs py-1.5"
                        className="shrink-0"
                      >
                        <option value="required">Required</option>
                        <option value="optional">Optional</option>
                      </Select>
                      <button
                        type="button"
                        disabled={savingKey === template.id}
                        onClick={() => removeDocument(template)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label={`Remove ${template.documentName}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 px-5 py-3">
                <input
                  value={newDocuments[caseType] || ""}
                  onChange={(event) => setNewDocuments((current) => ({ ...current, [caseType]: event.target.value }))}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addDocument(caseType); } }}
                  className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                  placeholder="Add a document"
                />
                <button
                  type="button"
                  disabled={savingKey === `add-${caseType}` || !(newDocuments[caseType] || "").trim()}
                  onClick={() => addDocument(caseType)}
                  className="shrink-0 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Add
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {catalogOpen ? (
        <CatalogBrowser catalog={catalog} loading={catalogLoading} importingId={importingId} onImport={importProgram} onClose={() => setCatalogOpen(false)} />
      ) : null}
    </div>
  );
}
