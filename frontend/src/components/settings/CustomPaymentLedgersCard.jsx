import { BookOpen, Check, Loader2, Pencil, Plus, WalletCards, X } from "lucide-react";
import { useEffect, useState } from "react";
import api from "../../services/api";

const COLORS = ["#6366F1", "#0A84FF", "#34C759", "#F59E0B", "#EC4899", "#8B5CF6", "#14B8A6", "#64748B"];
const emptyForm = { name: "", description: "", color: COLORS[0], caseTypes: [], paymentMethods: [], isActive: true };
const card = "rounded-[1.4rem] border border-white/70 bg-white/80 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur-xl";
const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

function ToggleChip({ selected, onClick, children }) {
  return <button type="button" onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold transition ${selected ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>{selected ? <Check className="h-3 w-3" /> : null}{children}</button>;
}

export default function CustomPaymentLedgersCard() {
  const [data, setData] = useState({ ledgers: [], caseTypes: [], paymentMethods: [] });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = () => api.get("/payments-overview/custom-ledgers", { cache: false }).then((response) => setData(response.data.data)).catch((reason) => setError(reason.response?.data?.message || "Custom ledgers could not be loaded.")).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const toggle = (key, value) => setForm((current) => ({ ...current, [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value] }));
  const begin = (ledger = null) => { setEditing(ledger?.id || "new"); setForm(ledger ? { name: ledger.name, description: ledger.description || "", color: ledger.color, caseTypes: ledger.caseTypes, paymentMethods: ledger.paymentMethods, isActive: ledger.isActive } : emptyForm); setError(""); setNotice(""); };

  async function save(event) {
    event.preventDefault();
    try {
      setSaving(true); setError(""); setNotice("");
      if (editing === "new") await api.post("/payments-overview/custom-ledgers", form);
      else await api.patch(`/payments-overview/custom-ledgers/${editing}`, form);
      setEditing(null); setForm(emptyForm); setNotice("Custom ledger saved."); await load();
    } catch (reason) { setError(reason.response?.data?.message || "The custom ledger could not be saved."); }
    finally { setSaving(false); }
  }

  async function setActive(ledger, isActive) {
    try { setError(""); await api.patch(`/payments-overview/custom-ledgers/${ledger.id}`, { ...ledger, isActive }); await load(); }
    catch (reason) { setError(reason.response?.data?.message || "The ledger status could not be changed."); }
  }

  return (
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><BookOpen className="h-5 w-5" /></span><div><h3 className="text-sm font-semibold text-slate-950">Custom payment ledgers</h3><p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">Create money-holding ledgers for selected case types and payment methods. Rules apply only to new payments; existing payment ownership is never changed.</p></div></div>
        {!editing ? <button type="button" onClick={() => begin()} className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white transition hover:bg-slate-800"><Plus className="h-4 w-4" />Create ledger</button> : null}
      </div>
      {notice ? <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p> : null}
      {error ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {loading ? <div className="mt-5 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading ledgers…</div> : null}

      {!loading && data.ledgers.length ? <div className="mt-5 grid gap-3 lg:grid-cols-2">{data.ledgers.map((ledger) => <article key={ledger.id} className={`rounded-3xl border bg-white p-4 transition ${ledger.isActive ? "border-slate-200" : "border-slate-100 opacity-65"}`}><div className="flex items-start gap-3"><span style={{ backgroundColor: `${ledger.color}18`, color: ledger.color }} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"><WalletCards className="h-4.5 w-4.5" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h4 className="truncate text-sm font-semibold text-slate-900">{ledger.name}</h4><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${ledger.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{ledger.isActive ? "Active" : "Paused"}</span></div><p className="mt-1 text-xs text-slate-500">{ledger.description || "Case-specific payment ledger"}</p><p className="mt-3 text-xl font-semibold tabular-nums text-slate-950">{money.format(Number(ledger.balance || 0))}</p><p className="text-[10px] font-medium text-slate-400">Current balance · {ledger._count?.cashTransactions || 0} owned transaction{ledger._count?.cashTransactions === 1 ? "" : "s"}</p><div className="mt-3 flex flex-wrap gap-1.5">{ledger.caseTypes.map((item) => <span key={item} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{item}</span>)}{ledger.paymentMethods.map((item) => <span key={item} style={{ color: ledger.color, backgroundColor: `${ledger.color}12` }} className="rounded-full px-2 py-1 text-[10px] font-semibold">{item}</span>)}</div></div><div className="flex gap-1"><button type="button" onClick={() => begin(ledger)} aria-label={`Edit ${ledger.name}`} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-900"><Pencil className="h-3.5 w-3.5" /></button><button type="button" onClick={() => setActive(ledger, !ledger.isActive)} className="h-8 rounded-full bg-slate-100 px-2.5 text-[10px] font-semibold text-slate-600">{ledger.isActive ? "Pause" : "Enable"}</button></div></div></article>)}</div> : null}
      {!loading && !data.ledgers.length && !editing ? <div className="mt-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50/60 px-5 py-8 text-center"><WalletCards className="mx-auto h-6 w-6 text-slate-400" /><p className="mt-2 text-sm font-semibold text-slate-800">No custom ledgers yet</p><p className="mt-1 text-xs text-slate-500">Create one to group payments automatically by case type and method.</p></div> : null}

      {editing ? <form onSubmit={save} className="mt-5 rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 to-white p-5"><div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-slate-900">{editing === "new" ? "New custom ledger" : "Edit custom ledger"}</h4><button type="button" onClick={() => setEditing(null)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-500"><X className="h-4 w-4" /></button></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Ledger name<input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Study Permit Payments" className="mt-1.5 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" /></label><label className="text-xs font-semibold text-slate-700">Description<input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="What this ledger tracks" className="mt-1.5 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100" /></label></div><div className="mt-4"><p className="text-xs font-semibold text-slate-700">Case types</p><div className="mt-2 flex flex-wrap gap-2">{data.caseTypes.map((item) => <ToggleChip key={item} selected={form.caseTypes.includes(item)} onClick={() => toggle("caseTypes", item)}>{item}</ToggleChip>)}</div></div><div className="mt-4"><p className="text-xs font-semibold text-slate-700">Accepted payment methods</p><div className="mt-2 flex flex-wrap gap-2">{data.paymentMethods.map((item) => <ToggleChip key={item} selected={form.paymentMethods.includes(item)} onClick={() => toggle("paymentMethods", item)}>{item === "ETransfer" ? "E-transfer" : item}</ToggleChip>)}</div></div><div className="mt-4 flex items-center justify-between gap-4"><div><p className="text-xs font-semibold text-slate-700">Ledger colour</p><div className="mt-2 flex gap-2">{COLORS.map((color) => <button key={color} type="button" onClick={() => setForm((current) => ({ ...current, color }))} aria-label={`Use ${color}`} style={{ backgroundColor: color }} className={`h-7 w-7 rounded-full transition ${form.color === color ? "ring-2 ring-offset-2" : "hover:scale-110"}`} />)}</div></div><button type="submit" disabled={saving || !form.name || !form.caseTypes.length || !form.paymentMethods.length} className="inline-flex h-11 items-center gap-2 rounded-full bg-indigo-600 px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(79,70,229,0.25)] disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{saving ? "Saving…" : "Save ledger"}</button></div></form> : null}
    </section>
  );
}
