import { Check, Loader2, PenTool, Percent, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import SignaturePad from "../client-portal/SignaturePad";
import { deleteRetainerSignature, getBillingSettings, updateBillingTaxSettings, updateRetainerSignature } from "../../api/billingSettingsApi";

const card = "rounded-[1.4rem] border border-white/70 bg-white/80 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur-xl";
const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

function formatDateTime(value) {
  if (!value) return null;
  return new Date(value).toLocaleString("en-CA", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// Fix 6.1 — one single agency-wide signature (the agency's confirmed
// decision, not per-admin), captured here once and auto-applied to every
// retainer the instant a client signs (Fix 6.2). Reuses SignaturePad.jsx —
// the exact same canvas component the client portal already uses to
// capture a client's signature.
export default function BillingSignatureSettingsCard() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [redrawing, setRedrawing] = useState(false);
  const [pendingImage, setPendingImage] = useState("");
  const [saving, setSaving] = useState(false);
  const [taxRate, setTaxRate] = useState("13");
  const [savingTax, setSavingTax] = useState(false);
  const [taxError, setTaxError] = useState("");

  async function load() {
    try {
      const data = await getBillingSettings();
      setSettings(data);
      setTaxRate(String(data.taxRatePercent ?? 13));
    } catch {
      setError("Billing settings could not be loaded.");
    }
  }

  useEffect(() => { load(); }, []);

  async function saveSignature() {
    setSaving(true);
    setError("");
    try {
      const data = await updateRetainerSignature(pendingImage);
      setSettings(data);
      setRedrawing(false);
      setPendingImage("");
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not save the signature.");
    } finally {
      setSaving(false);
    }
  }

  async function removeSignature() {
    if (!window.confirm("Remove the agency's stored signature? Future retainers will stop at \"Signed\" until a new one is captured.")) return;
    setSaving(true);
    setError("");
    try {
      const data = await deleteRetainerSignature();
      setSettings(data);
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not remove the signature.");
    } finally {
      setSaving(false);
    }
  }

  async function saveTaxRate(event) {
    event.preventDefault();
    setSavingTax(true);
    setTaxError("");
    try {
      const data = await updateBillingTaxSettings({ taxRatePercent: Number(taxRate) });
      setSettings(data);
    } catch (reason) {
      setTaxError(reason.response?.data?.message || "Could not save the tax rate.");
    } finally {
      setSavingTax(false);
    }
  }

  return (
    <section className={card}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><PenTool className="h-4 w-4" /></span>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Retainer countersignature</h3>
          <p className="text-xs text-slate-500">One agency-wide signature, auto-applied the instant a client signs a retainer.</p>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

      {settings === null ? (
        <div className="mt-4 h-24 animate-pulse rounded-2xl bg-slate-100" />
      ) : redrawing ? (
        <div className="mt-4">
          <SignaturePad onChange={setPendingImage} disabled={saving} />
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={saveSignature} disabled={saving || !pendingImage} className="flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-50">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save signature
            </button>
            <button type="button" onClick={() => { setRedrawing(false); setPendingImage(""); }} disabled={saving} className="h-9 rounded-full px-4 text-xs font-semibold text-slate-500 hover:bg-slate-100">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          {settings.hasRetainerSignature ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <img src={settings.retainerSignatureImage} alt="Agency retainer signature" className="h-20 w-auto object-contain" />
              <p className="mt-2 text-xs text-slate-500">
                {settings.retainerSignatureUpdatedBy ? `Last updated by ${settings.retainerSignatureUpdatedBy}` : "Last updated"}
                {settings.retainerSignatureUpdatedAt ? ` on ${formatDateTime(settings.retainerSignatureUpdatedAt)}` : ""}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={() => setRedrawing(true)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  <RotateCcw className="h-3.5 w-3.5" /> Redraw
                </button>
                <button type="button" onClick={removeSignature} disabled={saving} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 disabled:opacity-50">
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-4 text-center">
              <p className="text-sm font-semibold text-slate-700">No signature captured yet</p>
              <p className="mt-1 text-xs text-slate-500">Retainers will stay at "Signed" (no auto-countersignature) until one is added.</p>
              <button type="button" onClick={() => setRedrawing(true)} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white">
                <PenTool className="h-3.5 w-3.5" /> Draw signature
              </button>
            </div>
          )}
        </div>
      )}

      <form onSubmit={saveTaxRate} className="mt-5 border-t border-slate-100 pt-4">
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
          <Percent className="h-3.5 w-3.5" /> Ontario HST rate applied to professional &amp; consultation fees
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <input type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} className={`${inputClass} max-w-[140px]`} />
          <span className="text-sm text-slate-400">%</span>
          <button type="submit" disabled={savingTax} className="flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-50">
            {savingTax ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
          </button>
        </div>
        {taxError ? <p className="mt-2 text-xs text-rose-600">{taxError}</p> : null}
        <p className="mt-2 text-[11px] text-slate-400">Never applied to government fees, disbursements, or biometrics — those are pass-through costs.</p>
      </form>
    </section>
  );
}
