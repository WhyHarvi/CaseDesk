import { Check, Loader2, Sparkles, X } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";

const glass = "rounded-[1.9rem] border border-white/80 bg-white/95 shadow-[0_30px_90px_rgba(15,23,42,0.28)]";
const OWNERS = ["Client", "Representative", "Case", "Manual"];
const FILLABLE = ["Consultant", "Client", "Both"];

// The one-time "teach the engine this form" screen — every field pdf-lib
// found in the uploaded PDF, with a best-guess label/owner/source already
// applied. An admin confirms or corrects each row; the result is reused by
// every case that attaches this template afterward, never re-done per case.
export default function FormFieldMappingOverlay({ template, onClose }) {
  const [fields, setFields] = useState([]);
  const [sourcePaths, setSourcePaths] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingKey, setSavingKey] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const response = await api.get(`/form-templates/${template.id}/field-schema`);
        if (!active) return;
        setFields(response.data.data || []);
        setSourcePaths(response.data.meta?.sourcePaths || []);
      } catch (requestError) {
        if (active) setError(requestError.response?.data?.message || "Unable to load this template's fields.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [template.id]);

  async function patchField(fieldId, patch) {
    try {
      setSavingKey(fieldId);
      const response = await api.patch(`/form-templates/${template.id}/field-schema/${fieldId}`, patch);
      setFields((current) => current.map((field) => (field.id === fieldId ? response.data.data : field)));
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to save this field.");
    } finally {
      setSavingKey("");
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[430] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-md">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close field mapping" />
      <motion.section
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className={`relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden ${glass}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-600">
              <Sparkles className="h-3 w-3" />
              Field mapping
            </p>
            <h3 className="mt-1 truncate text-xl font-semibold tracking-tight text-slate-950">{template.title}</h3>
            <p className="mt-1 text-sm text-slate-500">Confirm labels and where each field's value should come from — done once, reused on every case.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">
            <X className="h-4 w-4" />
          </button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60">
          {loading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-2xl bg-white" />)}
            </div>
          ) : !fields.length ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-semibold text-slate-700">No fillable fields found</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">
                This file doesn't have a real PDF form (AcroForm) inside it, so there's nothing to map — it can still be attached to cases as a plain document.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 bg-white">
              {fields.map((field) => (
                <div key={field.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-start">
                  <div className="min-w-0 space-y-2">
                    <input
                      defaultValue={field.label}
                      onBlur={(event) => { if (event.target.value.trim() && event.target.value !== field.label) patchField(field.id, { label: event.target.value.trim() }); }}
                      className="h-9 w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-violet-300"
                    />
                    <p className="truncate font-mono text-[10px] text-slate-400">{field.fieldKey}{field.page ? ` · page ${field.page}` : ""}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={field.owner}
                      onChange={(event) => patchField(field.id, { owner: event.target.value, sourcePath: event.target.value === "Manual" ? null : field.sourcePath })}
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-violet-300"
                    >
                      {OWNERS.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
                    </select>
                    {field.owner !== "Manual" ? (
                      <select
                        value={field.sourcePath || ""}
                        onChange={(event) => patchField(field.id, { sourcePath: event.target.value || null })}
                        className="h-9 max-w-[11rem] rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-violet-300"
                      >
                        <option value="">Not mapped</option>
                        {sourcePaths.map((path) => <option key={path} value={path}>{path}</option>)}
                      </select>
                    ) : null}
                    <select
                      value={field.fillableBy}
                      onChange={(event) => patchField(field.id, { fillableBy: event.target.value })}
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-violet-300"
                      title="Who can fill this in"
                    >
                      {FILLABLE.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <label className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600">
                      <input type="checkbox" checked={field.isRequired} onChange={(event) => patchField(field.id, { isRequired: event.target.checked })} className="h-3.5 w-3.5 rounded border-slate-300" />
                      Required
                    </label>
                    {savingKey === field.id ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : <Check className="h-4 w-4 text-transparent" />}
                  </div>
                </div>
              ))}
            </div>
          )}
          {error ? <p className="mx-5 my-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
        </main>

        <footer className="flex justify-end border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-full bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white">Done</button>
        </footer>
      </motion.section>
    </div>,
    document.body,
  );
}
