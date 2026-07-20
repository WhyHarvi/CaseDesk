import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Layers, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createScheduleTemplate, deleteScheduleTemplate, getScheduleTemplates, updateScheduleTemplate } from "../../api/paymentScheduleApi";
import InstallmentListEditor, { blankInstallment } from "../payments/InstallmentListEditor";

const card = "rounded-[1.4rem] border border-white/70 bg-white/80 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur-xl";
const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

function TemplateRow({ template, onSaved, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(template.name);
  const [installments, setInstallments] = useState(template.installments.map((row) => ({ ...row, amount: String(row.amount) })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const updated = await updateScheduleTemplate(template.id, { name, installments });
      onSaved(updated);
      setOpen(false);
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not save this template.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${template.name}"? This won't affect cases already using it.`)) return;
    try {
      await deleteScheduleTemplate(template.id);
      onDeleted(template.id);
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not delete this template.");
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/70">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{template.name}</p>
          <p className="text-xs text-slate-400">{template.caseType} · {template.installments.length} installment{template.installments.length === 1 ? "" : "s"}</p>
        </div>
        <motion.span animate={{ rotate: open ? 180 : 0 }}><ChevronDown className="h-4 w-4 text-slate-400" /></motion.span>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-3 border-t border-slate-100 p-4">
              <label className="block text-[11px] font-medium text-slate-500">Template name
                <input value={name} onChange={(event) => setName(event.target.value)} className={`mt-1.5 ${inputClass}`} />
              </label>
              <InstallmentListEditor installments={installments} onChange={setInstallments} />
              {error ? <p className="text-xs text-rose-600">{error}</p> : null}
              <div className="flex items-center gap-2">
                <button type="button" onClick={save} disabled={saving} className="flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-50">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                </button>
                <button type="button" onClick={remove} className="flex h-9 items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-4 text-xs font-semibold text-rose-700">
                  <Trash2 className="h-3.5 w-3.5" /> Delete template
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function PaymentScheduleTemplatesCard() {
  const [templates, setTemplates] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: "", caseType: "", installments: [blankInstallment()] });
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");

  async function load() {
    try {
      setTemplates(await getScheduleTemplates());
    } catch {
      setError("Payment schedule templates could not be loaded.");
    }
  }

  useEffect(() => { load(); }, []);

  async function submitCreate(event) {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError("");
    try {
      const created = await createScheduleTemplate(newTemplate);
      setTemplates((current) => [...(current || []), created]);
      setCreating(false);
      setNewTemplate({ name: "", caseType: "", installments: [blankInstallment()] });
    } catch (reason) {
      setCreateError(reason.response?.data?.message || "Could not create this template.");
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-fuchsia-50 text-fuchsia-600"><Layers className="h-4 w-4" /></span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Payment schedule templates</h3>
            <p className="text-xs text-slate-500">Reusable installment plans per case type — always editable per case.</p>
          </div>
        </div>
        <button type="button" onClick={() => setCreating((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white">
          <Plus className="h-3.5 w-3.5" /> New template
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

      <AnimatePresence>
        {creating ? (
          <motion.form
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            onSubmit={submitCreate}
            className="mt-4 space-y-3 overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[11px] font-medium text-slate-500">Template name
                <input required value={newTemplate.name} onChange={(event) => setNewTemplate((c) => ({ ...c, name: event.target.value }))} placeholder="Standard Express Entry retainer" className={`mt-1.5 ${inputClass}`} />
              </label>
              <label className="block text-[11px] font-medium text-slate-500">Case type
                <input required value={newTemplate.caseType} onChange={(event) => setNewTemplate((c) => ({ ...c, caseType: event.target.value }))} placeholder="Express Entry" className={`mt-1.5 ${inputClass}`} />
              </label>
            </div>
            <InstallmentListEditor installments={newTemplate.installments} onChange={(installments) => setNewTemplate((c) => ({ ...c, installments }))} />
            {createError ? <p className="text-xs text-rose-600">{createError}</p> : null}
            <button type="submit" disabled={createBusy} className="flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-50">
              {createBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create template
            </button>
          </motion.form>
        ) : null}
      </AnimatePresence>

      <div className="mt-4 space-y-2.5">
        {templates === null ? (
          <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
        ) : templates.length === 0 ? (
          <p className="text-sm text-slate-400">No templates yet — create one above, or build custom schedules per case.</p>
        ) : (
          templates.map((template) => (
            <TemplateRow
              key={template.id}
              template={template}
              onSaved={(updated) => setTemplates((current) => current.map((item) => (item.id === updated.id ? updated : item)))}
              onDeleted={(id) => setTemplates((current) => current.filter((item) => item.id !== id))}
            />
          ))
        )}
      </div>
    </section>
  );
}
