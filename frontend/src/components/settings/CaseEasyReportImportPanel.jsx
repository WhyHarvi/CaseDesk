import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  UploadCloud,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import api from "../../services/api";
import Select from "../ui/Select";
import { syncCaseEasyNotes } from "../../api/caseEasyImportApi";

const REPORT_TYPES = [
  ["", "Auto-detect report"],
  ["client_listing", "Client Listing — import this first"],
  ["case_types", "Case Types"],
  ["payment_requests", "Payment Requests"],
  ["invoices", "Invoices"],
  ["payments", "Payments"],
  ["receipts", "Receipts"],
  ["account_receivables", "Account Receivables"],
  ["retainer_balances", "Retainer Balances"],
  ["trust_balances", "Trust Balances"],
  ["reminders", "Reminders"],
  ["time_entries", "Time Entries"],
  ["trust_account_entries", "Trust Account Entries"],
  ["activity_tracker", "Activity Tracker"],
  ["case_information", "Case Information Report"],
  ["employers_applications", "Employers Applications"],
  ["e_signatures", "E-Signatures"],
];

function validReportFile(file) {
  const name = file?.name?.toLowerCase() || "";
  return name.endsWith(".xlsx") || name.endsWith(".csv");
}

export default function CaseEasyReportImportPanel() {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [reportType, setReportType] = useState("");
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncError, setSyncError] = useState("");

  async function runNoteSync() {
    setSyncing(true);
    setSyncError("");
    setSyncResult(null);
    try {
      setSyncResult(await syncCaseEasyNotes());
    } catch (reason) {
      setSyncError(reason.response?.data?.message || "Notes could not be synced.");
    } finally {
      setSyncing(false);
    }
  }

  function chooseFile(nextFile) {
    setPreview(null);
    setResult(null);
    setError("");
    if (!nextFile) return;
    if (!validReportFile(nextFile)) {
      setError("Choose a Case Easy .xlsx or .csv report export.");
      return;
    }
    setFile(nextFile);
  }

  function formData() {
    const data = new FormData();
    data.append("file", file);
    if (reportType) data.append("reportType", reportType);
    return data;
  }

  async function submit(mode) {
    if (!file) return;
    setBusy(mode);
    setError("");
    try {
      const response = await api.post(
        `/case-easy-import/reports/${mode === "preview" ? "preview" : "upload"}`,
        formData(),
        { timeout: 300_000 },
      );
      if (mode === "preview") {
        setPreview(response.data.data);
        setResult(null);
      } else {
        setResult(response.data.data);
        setPreview(null);
      }
    } catch (reason) {
      setError(reason.response?.data?.message || "The report could not be imported.");
    } finally {
      setBusy("");
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError("");
  }

  return (
    <section className="rounded-[2rem] border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
          <BarChart3 className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-lg font-semibold text-slate-950">Case Easy reports</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            Import case-type summaries plus client, billing, trust, activity, time, milestone, employer, and e-signature reports. CaseDesk keeps every source column and maps client-specific rows to the matching staged and converted client.
          </p>
        </div>
      </div>

      {result ? (
        <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            {result.reportLabel} imported
          </p>
          <p className="mt-1 text-sm text-emerald-700">
            All {result.stats.stored} source rows verified · {result.stats.created} added, {result.stats.updated} updated · {result.stats.aggregate || 0} aggregate, {result.stats.source_only || 0} source-only, {result.stats.linked} linked, {result.stats.standalone || 0} standalone companies, {result.stats.unlinked} unlinked, {result.stats.ambiguous} ambiguous.
            {result.notesCreated ? ` ${result.notesCreated} note${result.notesCreated === 1 ? "" : "s"} added from Activity Tracker content.` : ""}
          </p>
          <button type="button" onClick={reset} className="mt-3 rounded-full border border-emerald-200 bg-white px-3.5 py-2 text-xs font-semibold text-emerald-800">
            Import another report
          </button>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <label className="block max-w-sm text-sm font-medium text-slate-700">
            Report type
            <Select
              value={reportType}
              onChange={(event) => {
                setReportType(event.target.value);
                setPreview(null);
              }}
              className="mt-2 w-full"
            >
              {REPORT_TYPES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
            <span className="mt-1 block text-xs text-slate-400">
              Start with Client Listing; it supplies Case Easy&apos;s stable Client Identifier.
            </span>
          </label>

          {file ? (
            <div className="flex max-w-2xl items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <FileSpreadsheet className="h-5 w-5 shrink-0 text-emerald-600" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{file.name}</span>
              <button type="button" onClick={reset} className="rounded-full p-1.5 text-slate-400 hover:bg-white hover:text-slate-700" aria-label="Remove report">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex min-h-32 w-full max-w-2xl flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-5 text-center transition hover:border-violet-300 hover:bg-violet-50/40"
            >
              <UploadCloud className="h-6 w-6 text-slate-400" />
              <span className="mt-2 text-sm font-medium text-slate-700">Choose an Excel or CSV report export</span>
              <span className="mt-1 text-xs text-slate-400">.xlsx or .csv · up to 20 MB</span>
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={(event) => {
              chooseFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />

          {error ? (
            <div className="flex max-w-2xl items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!file || Boolean(busy)}
              onClick={() => submit("preview")}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Check report
            </button>
            {preview ? (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => submit("upload")}
                className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                Import {preview.rowCount} row{preview.rowCount === 1 ? "" : "s"}
              </button>
            ) : null}
          </div>

          {preview ? (
            <div className="max-w-2xl rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">{preview.reportLabel}</p>
              <p className="mt-1 text-xs text-slate-500">
                {preview.rowCount} row{preview.rowCount === 1 ? "" : "s"} recognized. Nothing has been stored yet.
              </p>
              {preview.warnings?.map((warning) => (
                <p key={warning.code} className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {warning.message}
                </p>
              ))}
              {preview.preview.length ? (
                <div className="mt-3 space-y-1.5">
                  {preview.preview.map((row) => (
                    <div key={row.sourceRowKey} className="rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                      {row.fullName || row.clientIdentifier || row.caseNumber || `Source row ${row.rowNumber}`}
                      {row.caseNumber ? ` · ${row.caseNumber}` : ""}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-6 border-t border-slate-100 pt-5">
        <p className="text-sm font-semibold text-slate-900">Sync notes from imported data</p>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
          Adds real notes to converted clients/cases from any imported Case Easy data that hasn&apos;t been turned into a note yet — an already-converted case&apos;s last recorded note, or newly-linked Activity Tracker rows. Safe to run any time; already-synced notes are never duplicated.
        </p>
        {syncResult ? (
          <p className="mt-2 text-xs font-medium text-emerald-700">
            {syncResult.created
              ? `${syncResult.created} note${syncResult.created === 1 ? "" : "s"} added (${syncResult.lastNoteStats.created} from converted cases, ${syncResult.activityStats.created} from Activity Tracker).`
              : "Nothing new to sync — every available note is already in CaseDesk."}
          </p>
        ) : null}
        {syncError ? <p className="mt-2 text-xs font-medium text-rose-600">{syncError}</p> : null}
        <button
          type="button"
          disabled={syncing}
          onClick={runNoteSync}
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {syncing ? "Syncing…" : "Sync notes now"}
        </button>
      </div>
    </section>
  );
}
