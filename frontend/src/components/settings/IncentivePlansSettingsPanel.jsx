import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Loader2, Plus, Sparkles, Trash2, Wallet2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getCaseRoles } from "../../api/caseRoleApi";
import { activateIncentivePlan, createIncentivePlan, deleteIncentivePlan, getIncentivePlans, updateIncentivePlan } from "../../api/incentivePlanApi";

const card = "rounded-[1.4rem] border border-white/70 bg-white/80 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur-xl";
const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

const formulaLabels = {
  FLAT_PER_PAYMENT: "Flat amount per payment",
  PERCENT_OF_PAYMENT: "Percent of each payment",
  TIERED_PERCENT_OF_REVENUE: "Tiered percent of cumulative revenue",
};

function blankShare() {
  return { attributionKind: "CASE_ROLE", caseRoleId: "", sharePercent: "" };
}

function blankTier() {
  return { minCumulativeAmount: "", rate: "" };
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
      <p className="text-[11px] font-medium text-slate-500">Tiers — rate applied depends on the case's cumulative collected revenue after the payment</p>
      {tiers.map((tier, index) => (
        <div key={index} className="flex items-center gap-2">
          <input type="number" min="0" step="0.01" value={tier.minCumulativeAmount} onChange={(event) => update(index, "minCumulativeAmount", event.target.value)} placeholder="Starts at $" className={inputClass} />
          <input type="number" min="0" max="100" step="0.01" value={tier.rate} onChange={(event) => update(index, "rate", event.target.value)} placeholder="Rate %" className={inputClass} />
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
        <p className="text-[11px] font-medium text-slate-500">Who gets credited, and how the payout splits between them</p>
        <span className={`text-xs font-semibold ${Math.abs(total - 100) < 0.01 ? "text-emerald-600" : "text-rose-600"}`}>{total.toFixed(2)}% of 100%</span>
      </div>
      {roleShares.map((share, index) => (
        <div key={index} className="flex items-center gap-2">
          <select value={share.attributionKind} onChange={(event) => update(index, "attributionKind", event.target.value)} className={inputClass}>
            <option value="CASE_ROLE">Case role…</option>
            <option value="LEAD_OWNER">Lead owner</option>
            <option value="LEAD_CONVERTER">Lead converter</option>
          </select>
          {share.attributionKind === "CASE_ROLE" ? (
            <select value={share.caseRoleId} onChange={(event) => update(index, "caseRoleId", event.target.value)} className={inputClass}>
              <option value="">Choose a role</option>
              {caseRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          ) : null}
          <input type="number" min="0" max="100" step="0.01" value={share.sharePercent} onChange={(event) => update(index, "sharePercent", event.target.value)} placeholder="Share %" className={`${inputClass} max-w-28`} />
          <button type="button" onClick={() => onChange(roleShares.filter((_, i) => i !== index))} disabled={roleShares.length <= 1} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"><X className="h-4 w-4" /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...roleShares, blankShare()])} className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700"><Plus className="h-3.5 w-3.5" /> Add share</button>
    </div>
  );
}

function PlanFormFields({ draft, setDraft, caseRoles }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[11px] font-medium text-slate-500">Plan name
          <input required value={draft.name} onChange={(event) => setDraft((c) => ({ ...c, name: event.target.value }))} placeholder="e.g. Study Permit consultants" className={`mt-1.5 ${inputClass}`} />
        </label>
        <label className="block text-[11px] font-medium text-slate-500">Case type (blank = agency-wide fallback)
          <input value={draft.caseType} onChange={(event) => setDraft((c) => ({ ...c, caseType: event.target.value }))} placeholder="e.g. Study Permit" className={`mt-1.5 ${inputClass}`} />
        </label>
      </div>
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
      <RoleShareEditor roleShares={draft.roleShares} caseRoles={caseRoles} onChange={(roleShares) => setDraft((c) => ({ ...c, roleShares }))} />
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
  const [error, setError] = useState("");

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
                ) : null}
                <button type="button" onClick={remove} className="flex h-9 items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-4 text-xs font-semibold text-rose-700">
                  <Trash2 className="h-3.5 w-3.5" /> Delete plan
                </button>
              </div>
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
            <p className="text-xs text-slate-500">Formulas that turn collected payments into incentive credit, split across whoever's attributed on a case. Edit the numbers anytime.</p>
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
