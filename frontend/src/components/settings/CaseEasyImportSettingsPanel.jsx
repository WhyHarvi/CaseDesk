import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, UploadCloud, X } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../services/api";
import Select from "../ui/Select";
import CaseEasyReportImportPanel from "./CaseEasyReportImportPanel";

function isExcelFile(file) {
  return Boolean(file) && file.name.toLowerCase().endsWith(".xlsx");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Single drop zone for both files — the backend auto-detects which is the
// Contacts export and which is the Cases export from their columns (see
// classifyWorkbookHeaders), so the user doesn't need to know or label
// which slot is which. Just drop both files in together.
function DropZone({ files, onAdd, onRemove, error }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  function handleFiles(fileList) {
    const picked = [...fileList];
    onAdd(picked);
  }

  return (
    <div>
      <div
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => { event.preventDefault(); setDragOver(false); handleFiles(event.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition ${
          dragOver ? "border-sky-400 bg-sky-50" : error ? "border-rose-200 bg-rose-50/50" : "border-slate-200 bg-slate-50 hover:border-slate-300"
        }`}
      >
        <input ref={inputRef} type="file" accept=".xlsx" multiple className="hidden" onChange={(event) => { handleFiles(event.target.files); event.target.value = ""; }} />
        <UploadCloud className="h-7 w-7 text-slate-400" />
        <p className="text-sm text-slate-600">Drag and drop your Contacts and/or Cases export files here, or click to browse</p>
        <p className="text-xs text-slate-400">Import just one export, or both together — .xlsx only</p>
      </div>
      {error ? <p className="mt-1.5 text-xs font-medium text-rose-600">{error}</p> : null}

      {files.length > 0 ? (
        <p className="mt-1.5 text-xs font-medium text-slate-400">
          {files.length === 1
            ? "Importing just this file is fine — anything it can't link yet (e.g. a case with no matching contact) will link automatically once you later import the other export."
            : "Both files ready."}
        </p>
      ) : null}

      {files.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {files.map((file, index) => (
            <div key={`${file.name}-${index}`} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{file.name}</span>
              <span className="shrink-0 text-xs text-slate-400">{formatBytes(file.size)}</span>
              <button type="button" onClick={() => onRemove(index)} className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Remove ${file.name}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ErrorList({ errors }) {
  if (!errors.length) return null;
  return (
    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800"><AlertTriangle className="h-3.5 w-3.5" /> {errors.length} parse error{errors.length === 1 ? "" : "s"} — these rows will still import with the affected field left blank</p>
      <ul className="mt-1.5 space-y-0.5 text-xs text-amber-700">
        {errors.slice(0, 8).map((error, index) => (
          <li key={index}>[{error.sheet} row {error.row}] {error.field}: {error.message}</li>
        ))}
        {errors.length > 8 ? <li>…and {errors.length - 8} more</li> : null}
      </ul>
    </div>
  );
}

function PreviewTable({ title, rows, columns }) {
  if (!rows.length) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{title} (first {rows.length})</p>
      <div className="mt-1.5 overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>{columns.map((col) => <th key={col} className="whitespace-nowrap px-3 py-2 font-semibold">{col}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map((col) => <td key={col} className="whitespace-nowrap px-3 py-2 text-slate-700">{row[col] ?? "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CaseEasyImportSettingsPanel() {
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState("");
  const [prospectOrClient, setProspectOrClient] = useState("client");

  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const canSubmit = files.length >= 1;

  function addFiles(picked) {
    setPreview(null);
    setFileError("");
    const nonExcel = picked.filter((file) => !isExcelFile(file));
    if (nonExcel.length) {
      setFileError(`${nonExcel.map((file) => file.name).join(", ")} isn't an .xlsx file.`);
    }
    const excelFiles = picked.filter(isExcelFile);
    setFiles((current) => {
      const merged = [...current, ...excelFiles];
      if (merged.length > 2) {
        setFileError("Only two files are needed — a Contacts export and a Cases export. Remove one first.");
        return current;
      }
      return merged;
    });
  }

  function removeFile(index) {
    setFiles((current) => current.filter((_, i) => i !== index));
    setPreview(null);
    setFileError("");
  }

  function buildFormData() {
    const formData = new FormData();
    for (const file of files) formData.append("files", file);
    formData.append("prospectOrClient", prospectOrClient);
    return formData;
  }

  async function runPreview() {
    setPreviewing(true);
    setError("");
    setResult(null);
    try {
      const response = await api.post("/case-easy-import/preview", buildFormData(), { timeout: 300000 });
      setPreview(response.data.data);
    } catch (reason) {
      setError(reason.response?.data?.message || "The files could not be read. Confirm they're real Case Easy Excel exports.");
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmImport() {
    setImporting(true);
    setError("");
    try {
      const response = await api.post("/case-easy-import/upload", buildFormData(), { timeout: 300000 });
      setResult(response.data.data);
      setPreview(null);
    } catch (reason) {
      setError(reason.response?.data?.message || "The import failed.");
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setFiles([]);
    setFileError("");
    setPreview(null);
    setResult(null);
    setError("");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          <UploadCloud className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Case Easy Import</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Bring in a backup of client/case data exported from Case Easy. Nothing here touches your real clients or
            cases — it lands in a separate staging area you review and convert one record at a time from{" "}
            <Link to="/app/case-easy-import" className="font-semibold text-sky-700 hover:underline">Case Easy Client Data</Link>.
          </p>
        </div>
      </div>

      {result ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Import complete</p>
          <p className="mt-1.5 text-sm text-emerald-700">
            {result.stats.contactsCreated} contact{result.stats.contactsCreated === 1 ? "" : "s"} added, {result.stats.casesCreated} case{result.stats.casesCreated === 1 ? "" : "s"} added, {result.stats.casesLinked} linked.
            {Object.values(result.stats.needsReview).reduce((sum, n) => sum + n, 0) > 0 ? " Some cases need manual review before converting." : ""}
          </p>
          <div className="mt-3 flex gap-2">
            <Link to="/app/case-easy-import" className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800">
              Review imported data
            </Link>
            <button type="button" onClick={reset} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300">
              Import another file
            </button>
          </div>
        </div>
      ) : (
        <>
          <DropZone files={files} onAdd={addFiles} onRemove={removeFile} error={fileError} />

          <label className="block max-w-xs text-sm font-medium text-slate-700">
            Case Easy tab the Cases file came from
            <Select className="mt-2 w-full" value={prospectOrClient} onChange={(event) => { setProspectOrClient(event.target.value); setPreview(null); }}>
              <option value="client">Clients</option>
              <option value="prospect">Prospects</option>
            </Select>
            <span className="mt-1 block text-xs text-slate-400">Only used if the Cases file has no Prospect/Client column of its own.</span>
          </label>

          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div> : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canSubmit || previewing}
              onClick={runPreview}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {previewing ? "Checking files…" : "Check files"}
            </button>
            {preview ? (
              <button
                type="button"
                disabled={importing}
                onClick={confirmImport}
                className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                {importing ? "Importing…" : `Import ${[
                  preview.contactRowCount !== null && `${preview.contactRowCount} contact${preview.contactRowCount === 1 ? "" : "s"}`,
                  preview.caseRowCount !== null && `${preview.caseRowCount} case${preview.caseRowCount === 1 ? "" : "s"}`,
                ].filter(Boolean).join(", ")}`}
              </button>
            ) : null}
          </div>

          {preview ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
              <p className="text-sm font-semibold text-slate-900">Preview — nothing has been stored yet</p>
              <p className="mt-1 text-xs text-slate-500">
                {[
                  preview.contactsFileName && `${preview.contactsFileName} detected as the Contacts export (${preview.contactRowCount} row${preview.contactRowCount === 1 ? "" : "s"})`,
                  preview.casesFileName && `${preview.casesFileName} detected as the Cases export (${preview.caseRowCount} row${preview.caseRowCount === 1 ? "" : "s"})`,
                ].filter(Boolean).map((text, index) => <span key={index} className="font-medium text-slate-700">{index > 0 ? " · " : ""}{text}</span>)}
              </p>
              {preview.casesFileName ? (
                <p className="mt-1 text-xs text-slate-500">
                  {preview.toggleHeaderFound ? "Found a Prospect/Client column in the file — using it instead of the tab selection above." : `No Prospect/Client column found — every case in this file will be treated as "${prospectOrClient}".`}
                </p>
              ) : null}
              <ErrorList errors={preview.errors} />
              <PreviewTable title="Sample contacts" rows={preview.contactPreview} columns={["firstName", "lastName", "email", "phone", "maritalStatus", "uci"]} />
              <PreviewTable title="Sample cases" rows={preview.casePreview} columns={["caseNumber", "caseType", "status", "firstName", "lastName", "email", "assignees"]} />
            </div>
          ) : null}
        </>
      )}
      <CaseEasyReportImportPanel />
    </div>
  );
}
