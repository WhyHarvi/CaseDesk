import { motion } from "framer-motion";
import { Banknote, Calendar, Landmark, Lock, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { CASE_STAGES } from "../../constants/caseStages";
import { getFeeCategories } from "../../api/feeCategoryApi";
import Select from "../ui/Select";

// Labels matched to CaseBillingWorkspace.jsx's PAYMENT_TYPE_META — the
// manual "Add invoice" form already used clear terms here; this editor's
// generic "Fees" / "Disbursement" labels made the government-fee option
// easy to miss or mistake for a professional fee.
const PAYMENT_TYPES = [
  { value: "fees", label: "Professional fees", icon: Banknote, kind: "Professional" },
  { value: "disbursement", label: "Govt. fee disbursement", icon: Landmark, kind: "Government" },
];
export const TAXABLE_KINDS = new Set(["Professional", "Consultation"]);

let nextTempId = 1;
export function blankInstallment() {
  return {
    tempId: `new-${nextTempId++}`,
    label: "",
    paymentType: "fees",
    amount: "",
    triggerType: "Stage",
    triggerStage: CASE_STAGES[0],
    triggerDaysAfterSigning: 0,
  };
}

const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

/**
 * Editable list of {label, paymentType, amount, triggerType, triggerStage |
 * triggerDaysAfterSigning} rows. `lockedIds` (set of installment.id, not
 * tempId) marks rows that are already invoiced/void — shown read-only with
 * a lock badge instead of being removable.
 */
export default function InstallmentListEditor({ installments, onChange, lockedIds = new Set() }) {
  const [paymentTypes, setPaymentTypes] = useState(PAYMENT_TYPES);

  useEffect(() => {
    getFeeCategories({ includeInactive: true })
      .then((rows) => setPaymentTypes(rows.map((category) => ({ value: category.code, label: category.name, active: category.isActive, kind: category.kind }))))
      .catch(() => {});
  }, []);
  function updateRow(index, patch) {
    onChange(installments.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function removeRow(index) {
    onChange(installments.filter((_, i) => i !== index));
  }
  function addRow() {
    onChange([...installments, blankInstallment()]);
  }

  return (
    <div className="space-y-2.5">
      {installments.map((row, index) => {
        const locked = row.id && lockedIds.has(row.id);
        return (
          <motion.div
            layout
            key={row.id || row.tempId}
            className={`rounded-2xl border p-3.5 ${locked ? "border-slate-200 bg-slate-50/70" : "border-slate-200/80 bg-white/80"}`}
          >
            <div className="flex items-start gap-2.5">
              <div className="grid flex-1 gap-2.5 sm:grid-cols-[1.6fr_1fr_1fr]">
                <label className="block text-[11px] font-medium text-slate-500">Label
                  <input
                    disabled={locked}
                    value={row.label}
                    onChange={(event) => updateRow(index, { label: event.target.value })}
                    placeholder="e.g. Signing installment"
                    className={`mt-1 ${inputClass} disabled:bg-slate-100 disabled:text-slate-500`}
                  />
                </label>
                <label className="block text-[11px] font-medium text-slate-500">Payment type
                  <Select disabled={locked} value={row.paymentType} onChange={(event) => updateRow(index, { paymentType: event.target.value })} className="mt-1 w-full">
                    {paymentTypes.filter((type) => type.active !== false || type.value === row.paymentType).map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </Select>
                  {(() => {
                    const kind = paymentTypes.find((type) => type.value === row.paymentType)?.kind;
                    if (!kind) return null;
                    return (
                      <span className={`mt-1 inline-block text-[10px] font-semibold ${TAXABLE_KINDS.has(kind) ? "text-amber-600" : "text-slate-400"}`}>
                        {TAXABLE_KINDS.has(kind) ? "Taxable (HST applies)" : "Not taxed"}
                      </span>
                    );
                  })()}
                </label>
                <label className="block text-[11px] font-medium text-slate-500">Amount (CAD)
                  <input
                    disabled={locked}
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={row.amount}
                    onChange={(event) => updateRow(index, { amount: event.target.value })}
                    className={`mt-1 ${inputClass} disabled:bg-slate-100 disabled:text-slate-500`}
                  />
                </label>
              </div>
              {locked ? (
                <span className="mt-5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-500" title="Already invoiced or voided">
                  <Lock className="h-3.5 w-3.5" />
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  aria-label="Remove installment"
                  className="mt-5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <div className="flex rounded-full border border-slate-200 bg-slate-50 p-0.5">
                {["Stage", "Date"].map((type) => (
                  <button
                    key={type}
                    type="button"
                    disabled={locked}
                    onClick={() => updateRow(index, { triggerType: type })}
                    className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${row.triggerType === type ? "bg-slate-950 text-white" : "text-slate-500"} disabled:opacity-60`}
                  >
                    {type === "Stage" ? "On stage" : "Days after signing"}
                  </button>
                ))}
              </div>
              {row.triggerType === "Stage" ? (
                <Select disabled={locked} value={row.triggerStage} onChange={(event) => updateRow(index, { triggerStage: event.target.value })} className="w-auto">
                  {CASE_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                </Select>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Calendar className="h-3.5 w-3.5" />
                  <input
                    disabled={locked}
                    type="number"
                    min="0"
                    max="3650"
                    value={row.triggerDaysAfterSigning}
                    onChange={(event) => updateRow(index, { triggerDaysAfterSigning: event.target.value })}
                    className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs outline-none focus:border-sky-400"
                  />
                  days after signing
                </span>
              )}
            </div>
          </motion.div>
        );
      })}

      <button
        type="button"
        onClick={addRow}
        className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-slate-300 py-2.5 text-xs font-semibold text-slate-500 transition hover:border-slate-400 hover:text-slate-700"
      >
        <Plus className="h-3.5 w-3.5" /> Add installment
      </button>
    </div>
  );
}
