import { ArrowUpRight, Check, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "../ui/field";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";

const EMPTY_PLAN = {
  key: "",
  name: "",
  description: "",
  visibility: "public",
  isActive: true,
  trialDays: 0,
  isDefaultForNewWorkspaces: false,
  prices: [{ currency: "CAD", billingInterval: "monthly", amount: "" }],
  featureKeys: [],
  limits: [],
  reason: "",
};

function draftFromPlan(plan) {
  if (!plan) return { ...EMPTY_PLAN, prices: [...EMPTY_PLAN.prices] };
  return {
    key: plan.key,
    name: plan.name,
    description: plan.description || "",
    visibility: plan.visibility,
    isActive: plan.isActive,
    trialDays: plan.trialDays || 0,
    isDefaultForNewWorkspaces: plan.isDefaultForNewWorkspaces === true,
    prices: plan.prices.length
      ? plan.prices.map((price) => ({
          currency: price.currency,
          billingInterval: price.billingInterval,
          amount: String(price.amount),
          isActive: price.isActive,
        }))
      : [],
    featureKeys: [...plan.featureKeys],
    limits: plan.limits.map((limit) => ({
      key: limit.key,
      value: limit.value === null ? "" : String(limit.value),
      isUnlimited: limit.isUnlimited,
    })),
    reason: "",
  };
}

function priceLabel(plan) {
  const monthly = plan.prices.find((price) => price.currency === "CAD" && price.billingInterval === "monthly" && price.isActive);
  if (monthly) return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(monthly.amount) + "/month";
  const activePrice = plan.prices.find((price) => price.isActive);
  if (!activePrice) return plan.trialDays > 0 ? `${plan.trialDays}-day demo` : "Custom pricing";
  return `${activePrice.currency} ${Number(activePrice.amount).toLocaleString()} · ${activePrice.billingInterval}`;
}

export default function CommercialPlanManager({ catalog, busy, onSave }) {
  const [open, setOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [draft, setDraft] = useState(EMPTY_PLAN);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!open) return;
    const fresh = selectedPlan ? catalog?.plans?.find((plan) => plan.id === selectedPlan.id) : null;
    setDraft(draftFromPlan(fresh));
  }, [catalog, open, selectedPlan]);

  const features = useMemo(
    () => (catalog?.modules || []).flatMap((module) => module.features.map((feature) => ({ ...feature, moduleName: module.name }))),
    [catalog],
  );
  const limits = useMemo(
    () => (catalog?.modules || []).flatMap((module) => module.limits.map((limit) => ({ ...limit, moduleName: module.name }))),
    [catalog],
  );
  const configuredLimits = new Map(draft.limits.map((limit) => [limit.key, limit]));
  const canSave = draft.name.trim() && (!selectedPlan || draft.reason.trim().length >= 3) && (selectedPlan || (draft.key.trim() && draft.reason.trim().length >= 3));
  const plans = catalog?.plans || [];
  const activePlanCount = plans.filter((plan) => plan.isActive).length;

  function startCreate() {
    setSaveError("");
    setSelectedPlan(null);
    setDraft(draftFromPlan(null));
    setOpen(true);
  }

  function startEdit(plan) {
    setSaveError("");
    setSelectedPlan(plan);
    setDraft(draftFromPlan(plan));
    setOpen(true);
  }

  function toggleFeature(key, enabled) {
    setDraft((current) => ({
      ...current,
      featureKeys: enabled
        ? [...new Set([...current.featureKeys, key])]
        : current.featureKeys.filter((featureKey) => featureKey !== key),
    }));
  }

  function toggleLimit(definition, enabled) {
    setDraft((current) => ({
      ...current,
      limits: enabled
        ? [...current.limits, { key: definition.key, value: "0", isUnlimited: false }]
        : current.limits.filter((limit) => limit.key !== definition.key),
    }));
  }

  function updateLimit(key, change) {
    setDraft((current) => ({
      ...current,
      limits: current.limits.map((limit) => (limit.key === key ? { ...limit, ...change } : limit)),
    }));
  }

  function updatePrice(index, change) {
    setDraft((current) => ({
      ...current,
      prices: current.prices.map((price, priceIndex) => (priceIndex === index ? { ...price, ...change } : price)),
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaveError("");
    const result = await onSave(selectedPlan?.id || null, {
      ...draft,
      key: draft.key.trim(),
      name: draft.name.trim(),
      description: draft.description.trim(),
      trialDays: Number(draft.trialDays),
      isDefaultForNewWorkspaces: draft.isDefaultForNewWorkspaces,
      reason: draft.reason.trim(),
      prices: draft.prices.map((price) => ({ ...price, amount: price.amount === "" ? Number.NaN : Number(price.amount) })),
      limits: draft.limits.map((limit) => ({ ...limit, value: limit.isUnlimited ? null : Number(limit.value) })),
    });
    if (result.ok) setOpen(false);
    else setSaveError(result.message);
  }

  return (
    <section className="mb-8 bg-white px-[clamp(1rem,2.5vw,3rem)] pb-[clamp(1rem,2.5vw,3rem)] font-['Helvetica_Neue',Helvetica,Arial,sans-serif] text-slate-950">
      <header className="grid gap-8 border-y border-slate-300 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:py-12">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-[#002FA7]">Plan catalog</p>
          <h2 className="mt-3 text-4xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-6xl">Pricing and access,<br />in one catalog.</h2>
          <p className="mt-5 max-w-xl text-sm leading-6 text-slate-600">Define reusable prices, feature grants, and limits. Customer-specific access stays in Customer workspaces.</p>
        </div>
        <div className="flex items-end justify-between gap-8 lg:block lg:text-right">
          <div>
            <p className="text-7xl font-semibold leading-none tracking-[-0.08em] text-[#002FA7] tabular-nums">{String(plans.length).padStart(2, "0")}</p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{activePlanCount} active</p>
          </div>
          <Button type="button" onClick={startCreate} className="h-12 rounded-none bg-[#002FA7] px-5 text-white hover:bg-[#002FA7]/85 lg:mt-7">
            <Plus data-icon="inline-start" />
            New plan
          </Button>
        </div>
      </header>

      <div className="hidden grid-cols-[72px_minmax(260px,1fr)_190px_230px_150px] gap-5 border-b border-slate-300 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 2xl:grid">
        <span>No.</span><span>Plan</span><span>Price</span><span>Configuration</span><span className="text-right">Action</span>
      </div>
      <div>
        {plans.map((plan, index) => (
          <article key={plan.id} className="group grid min-w-0 gap-5 border-b border-slate-300 py-7 transition-colors hover:bg-[#F7F7F8] 2xl:grid-cols-[72px_minmax(260px,1fr)_190px_230px_150px] 2xl:items-center">
            <p className="text-3xl font-semibold tracking-[-0.06em] text-slate-300 tabular-nums">{String(index + 1).padStart(2, "0")}</p>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="text-2xl font-semibold tracking-[-0.035em] text-slate-950">{plan.name}</h3>
                <span className={`text-xs font-semibold ${plan.isActive ? "text-[#002FA7]" : "text-slate-400"}`}>{plan.isActive ? "Active" : "Inactive"}</span>
                {plan.isDefaultForNewWorkspaces ? <span className="text-xs font-semibold text-emerald-700">New-workspace default</span> : null}
              </div>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">{plan.description || "No customer-facing description."}</p>
            </div>
            <p className="min-w-0 break-words text-xl font-semibold tracking-[-0.03em] text-slate-950 tabular-nums">{priceLabel(plan)}</p>
            <dl className="grid grid-cols-3 gap-3 text-xs">
              <div><dt className="text-slate-500">Features</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{plan.featureKeys.length}</dd></div>
              <div><dt className="text-slate-500">Limits</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{plan.limits.length}</dd></div>
              <div><dt className="text-slate-500">Customers</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{plan._count?.subscriptions || 0}</dd></div>
            </dl>
            <button type="button" onClick={() => startEdit(plan)} className="flex min-h-11 items-center justify-between border-b border-slate-400 text-sm font-semibold text-slate-950 transition group-hover:border-[#002FA7] group-hover:text-[#002FA7] 2xl:justify-end 2xl:gap-3" aria-label={`${plan.isLegacy ? "View" : "Edit"} ${plan.name}`}>
              {plan.isLegacy ? "View plan" : "Edit plan"}
              {plan.isLegacy ? <Check className="size-4" aria-hidden="true" /> : <ArrowUpRight className="size-4" aria-hidden="true" />}
            </button>
          </article>
        ))}
        {!plans.length ? <p className="border-b border-slate-300 py-12 text-sm text-slate-500">No subscription plans yet.</p> : null}
      </div>

      <Dialog open={open} onOpenChange={(nextOpen) => { if (!busy) setOpen(nextOpen); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-none bg-white p-0 font-['Helvetica_Neue',Helvetica,Arial,sans-serif] shadow-none ring-0 sm:max-w-6xl" showCloseButton={!busy}>
          <DialogHeader className="border-b border-slate-300 px-6 py-8 pr-20 sm:px-10">
            <p className="text-sm font-semibold text-[#002FA7]">{selectedPlan ? "Plan settings" : "New plan"}</p>
            <DialogTitle className="mt-2 text-3xl font-semibold leading-none tracking-[-0.045em] sm:text-5xl">{selectedPlan ? selectedPlan.name : "Create subscription plan"}</DialogTitle>
            <DialogDescription className="mt-3 max-w-2xl leading-6 text-slate-600">
              {selectedPlan?.isLegacy
                ? "Legacy Full Access protects existing customers during commercial rollout and cannot be changed."
                : "Changes affect every workspace assigned to this plan. A reason is retained in the commercial audit trail."}
            </DialogDescription>
          </DialogHeader>

          <form className="px-6 sm:px-10" onSubmit={submit}>
            {saveError ? <Alert variant="destructive" className="mt-6 rounded-none border-x-0 border-r-0 border-l-4 shadow-none"><AlertDescription>{saveError}</AlertDescription></Alert> : null}
            {selectedPlan && !selectedPlan.isLegacy && selectedPlan._count?.subscriptions > 0 ? (
              <Alert className="mt-6 rounded-none border-x-0 border-r-0 border-l-4 border-l-[#002FA7] shadow-none">
                <AlertDescription>
                  Saving this plan changes resolved access for {selectedPlan._count.subscriptions} customer workspace{selectedPlan._count.subscriptions === 1 ? "" : "s"}.
                </AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup className="grid gap-8 border-t border-slate-300 py-8 md:grid-cols-2">
              <Field className="md:col-span-2 md:grid md:grid-cols-[180px_minmax(0,1fr)] md:items-end">
                <FieldLabel htmlFor="commercial-plan-name">Plan name</FieldLabel>
                <Input id="commercial-plan-name" value={draft.name} required disabled={selectedPlan?.isLegacy} maxLength={120} className="h-14 rounded-none border-x-0 border-t-0 border-b-slate-400 bg-transparent px-0 text-2xl font-semibold tracking-[-0.03em] shadow-none focus-visible:border-[#002FA7] focus-visible:ring-0" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel htmlFor="commercial-plan-key">Stable key</FieldLabel>
                <Input id="commercial-plan-key" value={draft.key} required disabled={Boolean(selectedPlan)} maxLength={80} placeholder="growth_plus" className="h-11 rounded-none border-x-0 border-t-0 border-b-slate-300 bg-transparent px-0 shadow-none focus-visible:border-[#002FA7] focus-visible:ring-0" onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") }))} />
                <FieldDescription>The key cannot change after creation.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="commercial-plan-visibility">Visibility</FieldLabel>
                <select id="commercial-plan-visibility" value={draft.visibility} disabled={selectedPlan?.isLegacy} onChange={(event) => setDraft((current) => ({ ...current, visibility: event.target.value }))} className="min-h-11 w-full rounded-none border-x-0 border-t-0 border-b border-slate-300 bg-transparent px-0 text-sm outline-none focus:border-[#002FA7]">
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                  <option value="internal">Internal</option>
                </select>
              </Field>
              <Field>
                <FieldLabel htmlFor="commercial-plan-trial-days">Trial duration</FieldLabel>
                <Input id="commercial-plan-trial-days" type="number" min="0" max="365" step="1" required value={draft.trialDays} disabled={selectedPlan?.isLegacy} className="h-11 rounded-none border-x-0 border-t-0 border-b-slate-300 bg-transparent px-0 shadow-none focus-visible:border-[#002FA7] focus-visible:ring-0" onChange={(event) => setDraft((current) => ({ ...current, trialDays: event.target.value }))} />
                <FieldDescription>Days of access when assigned with Trialing status. Use 0 for no trial.</FieldDescription>
              </Field>
              <Field className="md:col-span-2">
                <FieldLabel htmlFor="commercial-plan-description">Description</FieldLabel>
                <Textarea id="commercial-plan-description" value={draft.description} disabled={selectedPlan?.isLegacy} maxLength={500} className="min-h-28 rounded-none border-x-0 border-t-0 border-b-slate-300 bg-transparent px-0 shadow-none focus-visible:border-[#002FA7] focus-visible:ring-0" onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
              </Field>
              <Field orientation="horizontal" data-disabled={selectedPlan?.isLegacy || undefined} className="border-y border-slate-200 py-4 md:col-span-2">
                <div className="min-w-0 flex-1">
                  <FieldLabel htmlFor="commercial-plan-active">Available for assignment</FieldLabel>
                  <FieldDescription>Inactive plans remain on existing subscriptions but cannot be newly assigned.</FieldDescription>
                </div>
                <Switch id="commercial-plan-active" checked={draft.isActive} disabled={selectedPlan?.isLegacy} onCheckedChange={(isActive) => setDraft((current) => ({ ...current, isActive }))} />
              </Field>
              <Field orientation="horizontal" data-disabled={selectedPlan?.isLegacy || undefined} className="border-b border-slate-200 pb-4 md:col-span-2">
                <div className="min-w-0 flex-1">
                  <FieldLabel htmlFor="commercial-plan-workspace-default">Default for new workspaces</FieldLabel>
                  <FieldDescription>Every newly registered agency receives this plan atomically. Set another plan as default to replace it.</FieldDescription>
                </div>
                <Switch id="commercial-plan-workspace-default" checked={draft.isDefaultForNewWorkspaces} disabled={selectedPlan?.isLegacy || selectedPlan?.isDefaultForNewWorkspaces} onCheckedChange={(isDefaultForNewWorkspaces) => setDraft((current) => ({ ...current, isDefaultForNewWorkspaces, isActive: isDefaultForNewWorkspaces ? true : current.isActive }))} />
              </Field>
            </FieldGroup>

            <FieldSet aria-label="Prices" disabled={selectedPlan?.isLegacy} className="grid gap-6 border-t border-slate-300 py-8 md:grid-cols-[180px_minmax(0,1fr)]">
              <div>
                <h3 className="text-2xl font-semibold tracking-[-0.03em]">Prices</h3>
                <FieldDescription>Each currency and billing-cycle combination must be unique.</FieldDescription>
              </div>
              <div>
                <Button type="button" variant="outline" className="mb-5 rounded-none border-x-0 border-t-0 px-0 text-[#002FA7] hover:bg-transparent" onClick={() => setDraft((current) => ({ ...current, prices: [...current.prices, { currency: "CAD", billingInterval: "monthly", amount: "" }] }))}>
                  <Plus data-icon="inline-start" />
                  Add price
                </Button>
              <div className="border-t border-slate-300">
                {draft.prices.map((price, index) => (
                  <div key={`${index}-${price.currency}-${price.billingInterval}`} className="grid gap-4 border-b border-slate-300 py-5 sm:grid-cols-[110px_150px_minmax(0,1fr)_auto]">
                    <Field>
                      <FieldLabel htmlFor={`plan-price-currency-${index}`}>Currency</FieldLabel>
                      <Input id={`plan-price-currency-${index}`} value={price.currency} required maxLength={3} className="rounded-none border-x-0 border-t-0 bg-transparent px-0 shadow-none focus-visible:border-[#002FA7] focus-visible:ring-0" onChange={(event) => updatePrice(index, { currency: event.target.value.toUpperCase() })} />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`plan-price-cycle-${index}`}>Billing cycle</FieldLabel>
                      <select id={`plan-price-cycle-${index}`} value={price.billingInterval} onChange={(event) => updatePrice(index, { billingInterval: event.target.value })} className="min-h-8 w-full rounded-none border-x-0 border-t-0 border-b border-slate-300 bg-transparent px-0 text-sm outline-none focus:border-[#002FA7]">
                        <option value="monthly">Monthly</option>
                        <option value="annual">Annual</option>
                        <option value="custom">Custom</option>
                      </select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`plan-price-amount-${index}`}>Amount</FieldLabel>
                      <Input id={`plan-price-amount-${index}`} type="number" min="0" step="0.01" required value={price.amount} className="rounded-none border-x-0 border-t-0 bg-transparent px-0 shadow-none focus-visible:border-[#002FA7] focus-visible:ring-0" onChange={(event) => updatePrice(index, { amount: event.target.value })} />
                    </Field>
                    <Button type="button" variant="ghost" size="icon-lg" className="self-end rounded-none" aria-label={`Remove ${price.currency} ${price.billingInterval} price`} onClick={() => setDraft((current) => ({ ...current, prices: current.prices.filter((_, priceIndex) => priceIndex !== index) }))}>
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                {!draft.prices.length ? <p className="text-sm text-slate-500">No fixed prices. This plan will use negotiated pricing.</p> : null}
              </div>
              </div>
            </FieldSet>

            <FieldSet aria-label="Included features" disabled={selectedPlan?.isLegacy} className="grid gap-6 border-t border-slate-300 py-8 md:grid-cols-[180px_minmax(0,1fr)]">
              <div>
                <h3 className="text-2xl font-semibold tracking-[-0.03em]">Included features</h3>
                <FieldDescription>Workspace overrides can still enable or disable individual features after assignment.</FieldDescription>
              </div>
              <div className="grid border-t border-slate-300 md:grid-cols-2">
                {features.map((feature) => (
                  <Field key={feature.key} orientation="horizontal" className="border-b border-slate-300 py-4 md:odd:pr-5 md:even:border-l md:even:border-l-slate-300 md:even:pl-5">
                    <div className="min-w-0 flex-1">
                      <FieldLabel htmlFor={`plan-feature-${feature.key}`}>{feature.name}</FieldLabel>
                      <FieldDescription>{feature.moduleName}</FieldDescription>
                    </div>
                    <Switch id={`plan-feature-${feature.key}`} checked={draft.featureKeys.includes(feature.key)} onCheckedChange={(enabled) => toggleFeature(feature.key, enabled)} />
                  </Field>
                ))}
              </div>
            </FieldSet>

            <FieldSet aria-label="Plan limits" disabled={selectedPlan?.isLegacy} className="grid gap-6 border-t border-slate-300 py-8 md:grid-cols-[180px_minmax(0,1fr)]">
              <div>
                <h3 className="text-2xl font-semibold tracking-[-0.03em]">Plan limits</h3>
                <FieldDescription>Omitted limits are unavailable. Unlimited is stored explicitly.</FieldDescription>
              </div>
              <div className="border-t border-slate-300">
                {limits.map((definition) => {
                  const configured = configuredLimits.get(definition.key);
                  return (
                    <div key={definition.key} className="grid items-end gap-4 border-b border-slate-300 py-5 md:grid-cols-[minmax(200px,1fr)_110px_minmax(140px,220px)]">
                      <Field orientation="horizontal">
                        <div className="min-w-0 flex-1">
                          <FieldLabel htmlFor={`plan-limit-${definition.key}`}>{definition.name}</FieldLabel>
                          <FieldDescription>{definition.moduleName}{definition.unit ? ` · ${definition.unit}` : ""}</FieldDescription>
                        </div>
                        <Switch id={`plan-limit-${definition.key}`} checked={Boolean(configured)} onCheckedChange={(enabled) => toggleLimit(definition, enabled)} />
                      </Field>
                      <Field orientation="horizontal" data-disabled={!configured || undefined}>
                        <FieldLabel htmlFor={`plan-limit-unlimited-${definition.key}`}>Unlimited</FieldLabel>
                        <Switch id={`plan-limit-unlimited-${definition.key}`} checked={configured?.isUnlimited || false} disabled={!configured} onCheckedChange={(isUnlimited) => updateLimit(definition.key, { isUnlimited })} />
                      </Field>
                      <Field data-disabled={!configured || configured?.isUnlimited || undefined}>
                        <FieldLabel htmlFor={`plan-limit-value-${definition.key}`}>Value</FieldLabel>
                        <Input id={`plan-limit-value-${definition.key}`} type="number" min="0" step={definition.valueType === "integer" ? "1" : "0.01"} required={Boolean(configured && !configured.isUnlimited)} disabled={!configured || configured.isUnlimited} value={configured?.value ?? ""} className="rounded-none border-x-0 border-t-0 bg-transparent px-0 shadow-none focus-visible:border-[#002FA7] focus-visible:ring-0" onChange={(event) => updateLimit(definition.key, { value: event.target.value })} />
                      </Field>
                    </div>
                  );
                })}
              </div>
            </FieldSet>

            {!selectedPlan?.isLegacy ? (
              <div className="grid gap-6 border-t border-slate-300 py-8 md:grid-cols-[180px_minmax(0,1fr)]">
                <h3 className="text-2xl font-semibold tracking-[-0.03em]">Audit</h3>
                <Field data-invalid={draft.reason.length > 0 && draft.reason.trim().length < 3 || undefined}>
                  <FieldLabel htmlFor="commercial-plan-reason">Change reason</FieldLabel>
                  <Textarea id="commercial-plan-reason" value={draft.reason} required minLength={3} maxLength={500} aria-invalid={draft.reason.length > 0 && draft.reason.trim().length < 3 || undefined} placeholder="Pricing decision, agreement, or rollout reason" className="min-h-24 rounded-none border-x-0 border-t-0 border-b-slate-300 bg-transparent px-0 shadow-none focus-visible:border-[#002FA7] focus-visible:ring-0" onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))} />
                  <FieldDescription>This reason is retained with the before-and-after catalog snapshot.</FieldDescription>
                </Field>
              </div>
            ) : null}

            <DialogFooter className="sticky bottom-0 -mx-6 border-t border-slate-300 bg-white px-6 py-5 sm:-mx-10 sm:px-10">
              <Button type="button" variant="outline" className="h-11 rounded-none" onClick={() => setOpen(false)} disabled={busy}>Close</Button>
              {!selectedPlan?.isLegacy ? <Button type="submit" className="h-11 rounded-none bg-[#002FA7] px-6 text-white hover:bg-[#002FA7]/85" disabled={busy || !canSave}>{busy ? "Saving…" : selectedPlan ? "Save plan" : "Create plan"}</Button> : null}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
