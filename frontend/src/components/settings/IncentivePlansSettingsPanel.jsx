import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Calculator, Check, ChevronDown, History, Loader2, Plus, PowerOff, Sparkles, Trash2, Wallet2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getCaseRoles } from "../../api/caseRoleApi";
import { activateIncentivePlan, applyPlanToLegacyInvoices, createIncentivePlan, deactivateIncentivePlan, deleteIncentivePlan, getIncentivePlans, previewLegacyInvoicePlanApplication, updateIncentivePlan } from "../../api/incentivePlanApi";

const card = "rounded-[1.4rem] border border-white/70 bg-white/80 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur-xl";
const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

const formulaLabels = {
  FLAT_PER_PAYMENT: "Flat amount per payment",
  PERCENT_OF_PAYMENT: "Percent of each payment",
  TIERED_PERCENT_OF_REVENUE: "Tiered percent of cumulative revenue",
};

function blankShare() {
  return { attributionKind: "CASE_ROLE", caseRoleId: "", sharePercent: "100" };
}

function blankTier() {
  return { minCumulativeAmount: "0", rate: "" };
}

function blankDraft() {
  return { name: "", caseType: "", formulaType: "PERCENT_OF_PAYMENT", flatAmount: "", percentRate: "", tiers: [blankTier()], roleShares: [blankShare()] };
}

function shareTotal(roleShares) {
  return roleShares.reduce((sum, share) => sum + (Number(share.sharePercent) || 0), 0);
}

function TierEditor({ tiers, onChange }) {
  function update(index, key, value) {
    onChange(tiers.map((tier, i) => (i === index ? { ...tier, [key]: value } : tier)));
  }
  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-semibold text-slate-700">Revenue tiers</p>
        <p className="mt-0.5 text-[11px] leading-4 text-slate-500">The payment uses the rate for the case&apos;s total collected revenue after that payment. Keep the first tier at $0 so every collection qualifies.</p>
      </div>
      {tiers.map((tier, index) => (
        <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <label className="text-[11px] font-medium text-slate-500">Collected revenue starts at
            <span className="relative mt-1.5 block"><span className="pointer-events-none absolute left-3 top-2.5 text-sm text-slate-400">$</span><input aria-label={`Tier ${index + 1} starting revenue`} type="number" min="0" step="0.01" value={tier.minCumulativeAmount} onChange={(event) => update(index, "minCumulativeAmount", event.target.value)} className={`${inputClass} pl-7`} /></span>
          </label>
          <label className="text-[11px] font-medium text-slate-500">Incentive rate
            <span className="relative mt-1.5 block"><input aria-label={`Tier ${index + 1} incentive rate`} type="number" min="0" max="100" step="0.01" value={tier.rate} onChange={(event) => update(index, "rate", event.target.value)} placeholder="5" className={`${inputClass} pr-8`} /><span className="pointer-events-none absolute right-3 top-2.5 text-sm text-slate-400">%</span></span>
          </label>
          <button type="button" onClick={() => onChange(tiers.filter((_, i) => i !== index))} disabled={tiers.length <= 1} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"><X className="h-4 w-4" /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...tiers, blankTier()])} className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700"><Plus className="h-3.5 w-3.5" /> Add tier</button>
    </div>
  );
}

function RoleShareEditor({ roleShares, caseRoles, onChange }) {
  const total = shareTotal(roleShares);
  function update(index, key, value) {
    onChange(roleShares.map((share, i) => (i === index ? { ...share, [key]: value } : share)));
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div><p className="text-xs font-semibold text-slate-700">Credit recipients</p><p className="mt-0.5 text-[11px] text-slate-500">Split the incentive pool, not the client payment. Shares must total 100%.</p></div>
        <span className={`shrink-0 text-xs font-semibold ${Math.abs(total - 100) < 0.01 ? "text-emerald-600" : "text-rose-600"}`}>{total.toFixed(2)}% allocated</span>
      </div>
      {roleShares.map((share, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_110px_auto] sm:items-end">
          <label className="text-[11px] font-medium text-slate-500">Credit based on
          <select value={share.attributionKind} onChange={(event) => update(index, "attributionKind", event.target.value)} className={`mt-1.5 ${inputClass}`}>
            <option value="CASE_ROLE">Global team role</option>
            <option value="LEAD_OWNER">Lead owner</option>
            <option value="LEAD_CONVERTER">Lead converter</option>
          </select>
          </label>
          {share.attributionKind === "CASE_ROLE" ? (
            <label className="text-[11px] font-medium text-slate-500">Incentive role
            <select value={share.caseRoleId} onChange={(event) => update(index, "caseRoleId", event.target.value)} className={`mt-1.5 ${inputClass}`}>
              <option value="">Select role</option>
              {caseRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
            </label>
          ) : <span className="hidden sm:block" />}
          <label className="text-[11px] font-medium text-slate-500">Pool share
            <span className="relative mt-1.5 block"><input type="number" min="0" max="100" step="0.01" value={share.sharePercent} onChange={(event) => update(index, "sharePercent", event.target.value)} className={`${inputClass} pr-8`} /><span className="pointer-events-none absolute right-3 top-2.5 text-sm text-slate-400">%</span></span>
          </label>
          <button type="button" onClick={() => onChange(roleShares.filter((_, i) => i !== index))} disabled={roleShares.length <= 1} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"><X className="h-4 w-4" /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...roleShares, blankShare()])} className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700"><Plus className="h-3.5 w-3.5" /> Add share</button>
    </div>
  );
}

function incentivePoolExample(draft, collected = 1000) {
  if (draft.formulaType === "FLAT_PER_PAYMENT") return Number(draft.flatAmount) || 0;
  if (draft.formulaType === "PERCENT_OF_PAYMENT") return collected * (Number(draft.percentRate) || 0) / 100;
  const tier = [...draft.tiers]
    .filter((item) => Number(item.minCumulativeAmount) <= collected && Number(item.rate) > 0)
    .sort((left, right) => Number(right.minCumulativeAmount) - Number(left.minCumulativeAmount))[0];
  return collected * (Number(tier?.rate) || 0) / 100;
}

function PlanExample({ draft, caseRoles }) {
  const collected = 1000;
  const pool = incentivePoolExample(draft, collected);
  const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
  const recipientName = (share) => share.attributionKind === "LEAD_OWNER"
    ? "Lead owner"
    : share.attributionKind === "LEAD_CONVERTER"
      ? "Lead converter"
      : caseRoles.find((role) => role.id === share.caseRoleId)?.name || "Select a case role";
  return (
    <div className="border-t border-slate-200 pt-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-700"><Calculator className="h-4 w-4 text-emerald-600" /> Example when {money.format(collected)} is collected</div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-slate-600">{money.format(collected)} payment</span><ArrowRight className="h-3.5 w-3.5 text-slate-300" /><span className="font-semibold text-emerald-700">{money.format(pool)} incentive pool</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        {draft.roleShares.map((share, index) => <span key={index}>{recipientName(share)}: <strong className="text-slate-700">{money.format(pool * (Number(share.sharePercent) || 0) / 100)}</strong></span>)}
      </div>
      <p className="mt-2 text-[11px] leading-4 text-slate-400">Credit is created only when money is collected. Assign roles once in Team Members; matching case owners and collaborators are credited automatically.</p>
    </div>
  );
}

function PlanFormFields({ draft, setDraft, caseRoles }) {
  return (
    <div className="space-y-5">
      <section>
        <div className="mb-3 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">1</span><div><p className="text-xs font-semibold text-slate-800">Name and scope</p><p className="text-[11px] text-slate-500">Leave case type blank to make this the fallback for every case without a more specific plan.</p></div></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[11px] font-medium text-slate-500">Plan name
          <input required value={draft.name} onChange={(event) => setDraft((c) => ({ ...c, name: event.target.value }))} placeholder="e.g. Study Permit consultants" className={`mt-1.5 ${inputClass}`} />
        </label>
        <label className="block text-[11px] font-medium text-slate-500">Case type (blank = agency-wide fallback)
          <input value={draft.caseType} onChange={(event) => setDraft((c) => ({ ...c, caseType: event.target.value }))} placeholder="e.g. Study Permit" className={`mt-1.5 ${inputClass}`} />
        </label>
      </div>
      </section>
      <section className="border-t border-slate-200 pt-4">
      <div className="mb-3 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">2</span><div><p className="text-xs font-semibold text-slate-800">Calculate the incentive pool</p><p className="text-[11px] text-slate-500">This determines the total credit created by each collected payment.</p></div></div>
      <label className="block text-[11px] font-medium text-slate-500">Formula
        <select value={draft.formulaType} onChange={(event) => setDraft((c) => ({ ...c, formulaType: event.target.value }))} className={`mt-1.5 ${inputClass}`}>
          {Object.entries(formulaLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {draft.formulaType === "FLAT_PER_PAYMENT" ? (
        <label className="block text-[11px] font-medium text-slate-500">Flat amount per qualifying payment
          <input type="number" min="0" step="0.01" value={draft.flatAmount} onChange={(event) => setDraft((c) => ({ ...c, flatAmount: event.target.value }))} placeholder="$" className={`mt-1.5 ${inputClass}`} />
        </label>
      ) : draft.formulaType === "PERCENT_OF_PAYMENT" ? (
        <label className="block text-[11px] font-medium text-slate-500">Percent of each payment collected
          <input type="number" min="0" max="100" step="0.01" value={draft.percentRate} onChange={(event) => setDraft((c) => ({ ...c, percentRate: event.target.value }))} placeholder="%" className={`mt-1.5 ${inputClass}`} />
        </label>
      ) : (
        <TierEditor tiers={draft.tiers} onChange={(tiers) => setDraft((c) => ({ ...c, tiers }))} />
      )}
      </section>
      <section className="border-t border-slate-200 pt-4">
      <div className="mb-3 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">3</span><div><p className="text-xs font-semibold text-slate-800">Split the pool</p><p className="text-[11px] text-slate-500">Choose global team roles, lead owner, or lead converter as recipients.</p></div></div>
      <RoleShareEditor roleShares={draft.roleShares} caseRoles={caseRoles} onChange={(roleShares) => setDraft((c) => ({ ...c, roleShares }))} />
      </section>
      <PlanExample draft={draft} caseRoles={caseRoles} />
    </div>
  );
}

function draftFromPlan(plan) {
  return {
    name: plan.name,
    caseType: plan.caseType || "",
    formulaType: plan.formulaType,
    flatAmount: plan.flatAmount ?? "",
    percentRate: plan.percentRate ?? "",
    tiers: plan.tiers.length ? plan.tiers.map((tier) => ({ minCumulativeAmount: tier.minCumulativeAmount, rate: tier.rate })) : [blankTier()],
    roleShares: plan.roleShares.map((share) => ({ attributionKind: share.attributionKind, caseRoleId: share.caseRoleId || "", sharePercent: share.sharePercent })),
  };
}

function PlanRow({ plan, caseRoles, onSaved, onActivated, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => draftFromPlan(plan));
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [legacyPreview, setLegacyPreview] = useState(null);
  const [legacyLoading, setLegacyLoading] = useState(false);
  const [legacyApplying, setLegacyApplying] = useState(false);
  const [legacyResult, setLegacyResult] = useState(null);
  const [error, setError] = useState("");

  async function loadLegacyPreview() {
    if (legacyPreview) return setLegacyPreview(null);
    setLegacyLoading(true);
    setLegacyResult(null);
    setError("");
    try {
      setLegacyPreview(await previewLegacyInvoicePlanApplication(plan.id));
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not check old invoices.");
    } finally {
      setLegacyLoading(false);
    }
  }

  async function applyLegacyPlan() {
    setLegacyApplying(true);
    setError("");
    try {
      const result = await applyPlanToLegacyInvoices(plan.id);
      setLegacyResult(result);
      setLegacyPreview(await previewLegacyInvoicePlanApplication(plan.id));
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not apply this plan to old invoices.");
    } finally {
      setLegacyApplying(false);
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const updated = await updateIncentivePlan(plan.id, draft);
      onSaved(updated);
      setOpen(false);
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not save this plan.");
    } finally {
      setSaving(false);
    }
  }

  async function activate() {
    setActivating(true);
    setError("");
    try {
      await activateIncentivePlan(plan.id);
      // Activating this plan may have deactivated a different plan sharing
      // the same case-type scope — refetch the whole list rather than
      // trying to guess which other row(s) changed from this response alone.
      await onActivated();
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not activate this plan.");
    } finally {
      setActivating(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${plan.name}"?`)) return;
    try {
      await deleteIncentivePlan(plan.id);
      onDeleted(plan.id);
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not delete this plan — deactivate it instead if it has history.");
    }
  }

  async function deactivate() {
    if (!confirmingDeactivate) return setConfirmingDeactivate(true);
    setDeactivating(true);
    setError("");
    try {
      await deactivateIncentivePlan(plan.id);
      setLegacyPreview(null);
      await onActivated();
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not deactivate this plan.");
    } finally {
      setDeactivating(false);
      setConfirmingDeactivate(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/70">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
            {plan.name}
            {plan.isActive ? <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Active</span> : <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">Draft</span>}
          </p>
          <p className="text-xs text-slate-400">{plan.caseType || "All case types"} · {formulaLabels[plan.formulaType]}</p>
        </div>
        <motion.span animate={{ rotate: open ? 180 : 0 }}><ChevronDown className="h-4 w-4 text-slate-400" /></motion.span>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-3 border-t border-slate-100 p-4">
              <PlanFormFields draft={draft} setDraft={setDraft} caseRoles={caseRoles} />
              {error ? <p className="text-xs text-rose-600">{error}</p> : null}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={save} disabled={saving} className="flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-50">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                </button>
                {!plan.isActive ? (
                  <button type="button" onClick={activate} disabled={activating} className="flex h-9 items-center gap-1.5 rounded-full bg-emerald-600 px-4 text-xs font-semibold text-white disabled:opacity-50">
                    {activating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Activate
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={loadLegacyPreview} disabled={legacyLoading || deactivating} className="flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 disabled:opacity-50">
                      {legacyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />} Apply to old invoices
                    </button>
                    <button type="button" onClick={deactivate} onBlur={() => setConfirmingDeactivate(false)} disabled={deactivating} className={`flex h-9 items-center gap-1.5 rounded-full border px-4 text-xs font-semibold disabled:opacity-50 ${confirmingDeactivate ? "border-amber-600 bg-amber-600 text-white" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                      {deactivating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PowerOff className="h-3.5 w-3.5" />} {confirmingDeactivate ? "Confirm deactivate" : "Deactivate"}
                    </button>
                  </>
                )}
                <button type="button" onClick={remove} className="flex h-9 items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-4 text-xs font-semibold text-rose-700">
                  <Trash2 className="h-3.5 w-3.5" /> Delete plan
                </button>
              </div>
              {legacyPreview ? (
                <div className="border-t border-slate-200 pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-900">Eligible outstanding invoices</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{legacyPreview.count} invoice{legacyPreview.count === 1 ? "" : "s"} · {new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(legacyPreview.outstandingTotal)} outstanding. Only payments collected after applying this plan will create incentive credit.</p>
                    </div>
                    {legacyPreview.count > 0 ? <button type="button" onClick={applyLegacyPlan} disabled={legacyApplying} className="flex h-9 items-center gap-1.5 rounded-full bg-emerald-600 px-4 text-xs font-semibold text-white disabled:opacity-50">{legacyApplying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Apply to {legacyPreview.count}</button> : null}
                  </div>
                  {legacyPreview.invoices?.length ? <div className="mt-3 divide-y divide-slate-100 border-y border-slate-100">{legacyPreview.invoices.slice(0, 5).map((invoice) => <div key={invoice.id} className="flex items-center justify-between gap-3 py-2 text-xs"><span className="min-w-0 truncate text-slate-600">{invoice.case.client.fullName} · {invoice.case.caseType}</span><span className="shrink-0 font-semibold tabular-nums text-slate-800">{new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(invoice.balance)}</span></div>)}{legacyPreview.count > 5 ? <p className="py-2 text-xs text-slate-500">And {legacyPreview.count - 5} more eligible invoices</p> : null}</div> : null}
                  {legacyResult ? <p className="mt-3 text-xs font-semibold text-emerald-700">Applied to {legacyResult.applied} invoice{legacyResult.applied === 1 ? "" : "s"}{legacyResult.skipped ? `; ${legacyResult.skipped} changed before confirmation and were skipped` : ""}{legacyResult.skippedNoRecipients ? `; ${legacyResult.skippedNoRecipients} had no eligible Case Worker, RCIC, lead owner, or converter` : ""}.</p> : null}
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function IncentivePlansSettingsPanel() {
  const [plans, setPlans] = useState(null);
  const [caseRoles, setCaseRoles] = useState([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newPlan, setNewPlan] = useState(blankDraft());
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");

  async function load() {
    try {
      const [planList, roleList] = await Promise.all([getIncentivePlans(), getCaseRoles()]);
      setPlans(planList);
      setCaseRoles(roleList);
    } catch {
      setError("Incentive plans could not be loaded.");
    }
  }

  useEffect(() => { load(); }, []);

  async function submitCreate(event) {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError("");
    try {
      const created = await createIncentivePlan(newPlan);
      setPlans((current) => [...(current || []), created]);
      setCreating(false);
      setNewPlan(blankDraft());
    } catch (reason) {
      setCreateError(reason.response?.data?.message || "Could not create this plan.");
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Wallet2 className="h-4 w-4" /></span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Incentive plans</h3>
            <p className="text-xs text-slate-500">Decide how collected payments create incentive credit and who receives it.</p>
          </div>
        </div>
        <button type="button" onClick={() => setCreating((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white">
          <Plus className="h-3.5 w-3.5" /> New plan
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
            <PlanFormFields draft={newPlan} setDraft={setNewPlan} caseRoles={caseRoles} />
            {createError ? <p className="text-xs text-rose-600">{createError}</p> : null}
            <button type="submit" disabled={createBusy} className="flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-50">
              {createBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create plan
            </button>
          </motion.form>
        ) : null}
      </AnimatePresence>

      <div className="mt-4 space-y-2.5">
        {plans === null ? (
          <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
        ) : plans.length === 0 ? (
          <p className="text-sm text-slate-400">No incentive plans yet — create one above. A plan stays a draft until you activate it.</p>
        ) : (
          plans.map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              caseRoles={caseRoles}
              onSaved={(updated) => setPlans((current) => current.map((item) => (item.id === updated.id ? updated : item)))}
              onActivated={load}
              onDeleted={(id) => setPlans((current) => current.filter((item) => item.id !== id))}
            />
          ))
        )}
      </div>
    </section>
  );
}
