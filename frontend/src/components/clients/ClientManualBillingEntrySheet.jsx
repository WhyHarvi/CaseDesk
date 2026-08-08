import { AnimatePresence, motion } from "framer-motion";
import { Banknote, CalendarDays, Check, FilePlus2, Loader2, ReceiptText, WalletCards, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClientManualBillingEntry, getClientManualBillingOptions } from "../../api/clientBillingApi";

const newKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const today = () => new Date().toISOString().slice(0, 10);
const money = (value) => Number(value || 0).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
const shortDate = (value) => new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });

const fieldClass = "mt-1.5 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";

export default function ClientManualBillingEntrySheet({ open, clientId, clientName, initialMode = "", initialPaymentType = "", initialCaseId = "", onClose, onSaved }) {
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [confirmPaidOverride, setConfirmPaidOverride] = useState(false);
  const [mode, setMode] = useState("existing");
  const [targetKind, setTargetKind] = useState("invoice");
  const [form, setForm] = useState({ invoiceId: "", appointmentId: "", caseId: "", paymentType: "", description: "", chargeAmount: "", amount: "", method: "ETransfer", transactionReference: "", paymentDate: today(), note: "", idempotencyKey: newKey() });

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setOptions(null);
    setError("");
    setWarning("");
    setConfirmPaidOverride(false);
    getClientManualBillingOptions(clientId)
      .then((result) => {
        if (!active) return;
        setOptions(result);
        const firstInvoice = result.invoices?.[0];
        const firstAppointment = result.appointments?.find((item) => item.paymentHold?.status !== "Paid" || !item.paymentHold?.manualPaymentReference);
        const requestedCategory = result.categories?.find((item) => item.code === initialPaymentType);
        const firstCategory = initialPaymentType
          ? (requestedCategory?.mapped ? requestedCategory : null)
          : result.categories?.find((item) => item.mapped);
        const requestedCase = result.cases?.find((item) => item.id === initialCaseId);
        const nextKind = firstInvoice ? "invoice" : "appointment";
        setTargetKind(nextKind);
        setMode(initialMode === "new" && result.cases?.length ? "new" : firstInvoice || firstAppointment ? "existing" : "new");
        if (initialMode === "new" && initialPaymentType && !requestedCategory?.mapped) {
          setError("Professional fees must be mapped to a QuickBooks item in Settings before this charge can be created.");
        }
        setForm({
          invoiceId: firstInvoice?.id || "",
          appointmentId: firstAppointment?.id || "",
          caseId: requestedCase?.id || result.cases?.[0]?.id || "",
          paymentType: firstCategory?.code || "",
          description: "",
          chargeAmount: "",
          amount: firstInvoice ? String(Number(firstInvoice.balance)) : firstAppointment?.paymentHold?.amount ? String(Number(firstAppointment.paymentHold.amount)) : String(Number(result.consultationFee || 0) || ""),
          method: firstAppointment?.paymentHold?.paymentMethod || "ETransfer",
          transactionReference: firstAppointment?.paymentHold?.manualPaymentReference || "",
          paymentDate: result.today || today(),
          note: "",
          idempotencyKey: newKey(),
        });
      })
      .catch((reason) => { if (active) setError(reason.response?.data?.message || "Payment options could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, clientId, initialMode, initialPaymentType, initialCaseId, loadAttempt]);

  const availableAppointments = useMemo(() => (options?.appointments || []).filter((item) => item.paymentHold?.status !== "Paid" || (item.paymentHold?.paymentMethod === "ETransfer" && !item.paymentHold?.manualPaymentReference)), [options]);
  const selectedInvoice = options?.invoices?.find((item) => item.id === form.invoiceId);
  const selectedAppointment = availableAppointments.find((item) => item.id === form.appointmentId);
  const repairingAppointment = selectedAppointment?.paymentHold?.status === "Paid";

  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); }

  function chooseTargetKind(kind) {
    setTargetKind(kind);
    setError("");
    setConfirmPaidOverride(false);
    if (kind === "invoice") {
      const item = options?.invoices?.[0];
      setForm((current) => ({ ...current, invoiceId: item?.id || "", amount: item ? String(Number(item.balance)) : "", transactionReference: "", method: "ETransfer", idempotencyKey: newKey() }));
    } else {
      const item = availableAppointments[0];
      setForm((current) => ({ ...current, appointmentId: item?.id || "", amount: item?.paymentHold?.amount ? String(Number(item.paymentHold.amount)) : String(Number(options?.consultationFee || 0) || ""), transactionReference: item?.paymentHold?.manualPaymentReference || "", method: item?.paymentHold?.paymentMethod || "ETransfer", idempotencyKey: newKey() }));
    }
  }

  function chooseInvoice(id) {
    const item = options?.invoices?.find((row) => row.id === id);
    setForm((current) => ({ ...current, invoiceId: id, amount: item ? String(Number(item.balance)) : "", idempotencyKey: newKey() }));
  }

  function chooseAppointment(id) {
    const item = availableAppointments.find((row) => row.id === id);
    setForm((current) => ({ ...current, appointmentId: id, amount: item?.paymentHold?.amount ? String(Number(item.paymentHold.amount)) : String(Number(options?.consultationFee || 0) || ""), method: item?.paymentHold?.paymentMethod || "ETransfer", transactionReference: item?.paymentHold?.manualPaymentReference || "", paymentDate: item?.paymentHold?.paidAt?.slice?.(0, 10) || current.paymentDate, idempotencyKey: newKey() }));
    setConfirmPaidOverride(false);
  }

  async function submit(event) {
    event.preventDefault();
    if (form.method === "ETransfer" && !form.transactionReference.trim()) { setError("Enter the e-transfer transaction number."); return; }
    if (selectedAppointment?.isFreeConsultation && !confirmPaidOverride) { setError("Confirm that this free appointment should be converted to paid."); return; }
    setSaving(true);
    setError("");
    setWarning("");
    try {
      const entryType = mode === "new" ? "new_charge_payment" : targetKind === "appointment" ? "appointment_payment" : "invoice_payment";
      const result = await createClientManualBillingEntry(clientId, {
        entryType,
        invoiceId: form.invoiceId || undefined,
        appointmentId: form.appointmentId || undefined,
        caseId: form.caseId || undefined,
        paymentType: form.paymentType || undefined,
        description: form.description.trim() || undefined,
        chargeAmount: form.chargeAmount ? Number(form.chargeAmount) : undefined,
        amount: repairingAppointment ? undefined : Number(form.amount),
        method: form.method,
        transactionReference: form.transactionReference.trim() || undefined,
        paymentDate: form.paymentDate,
        note: form.note.trim() || undefined,
        idempotencyKey: form.idempotencyKey,
        overrideFreeConsultation: Boolean(selectedAppointment?.isFreeConsultation && confirmPaidOverride),
      });
      await onSaved?.(result);
      if (result.paymentWarning) {
        const createdInvoice = result.invoice;
        setOptions((current) => current ? {
          ...current,
          invoices: [createdInvoice, ...(current.invoices || []).filter((item) => item.id !== createdInvoice.id)],
        } : current);
        setMode("existing");
        setTargetKind("invoice");
        setWarning(`${result.paymentWarning} The invoice was created only once; retry below to apply the payment to that invoice.`);
        setForm((current) => ({
          ...current,
          invoiceId: createdInvoice.id,
          amount: current.amount,
        }));
      } else {
        onClose();
      }
    } catch (reason) {
      setError(reason.response?.data?.message || "The payment entry could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[500] flex justify-end bg-slate-950/25 backdrop-blur-[3px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
          <motion.aside initial={{ x: 70, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 70, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 35 }} className="flex h-full w-full max-w-[500px] flex-col overflow-hidden border-l border-white/70 bg-[#f8fafc]/95 shadow-[-30px_0_90px_rgba(15,23,42,0.22)] backdrop-blur-2xl">
            <header className="flex items-center justify-between border-b border-white bg-white/80 px-6 py-4">
              <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white"><WalletCards className="h-4 w-4" /></span><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{clientName}</p><h2 className="truncate text-lg font-semibold text-slate-950">Record manual payment</h2></div></div>
              <button type="button" onClick={onClose} disabled={saving} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </header>

            {loading ? <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> : (
              <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
                <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-200/60 p-1">
                    <button type="button" onClick={() => { setMode("existing"); setWarning(""); }} className={`h-10 rounded-xl text-xs font-semibold transition ${mode === "existing" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>Existing charge</button>
                    <button type="button" disabled={!options?.cases?.length} onClick={() => { setMode("new"); setWarning(""); setError(""); }} className={`h-10 rounded-xl text-xs font-semibold transition disabled:opacity-40 ${mode === "new" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>New charge + payment</button>
                  </div>

                  {mode === "existing" ? (
                    <section className="rounded-[1.5rem] border border-white bg-white p-4 shadow-sm">
                      <p className="text-xs font-semibold text-slate-800">Apply payment to</p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button type="button" disabled={!options?.invoices?.length} onClick={() => chooseTargetKind("invoice")} className={`flex h-11 items-center justify-center gap-2 rounded-2xl border text-xs font-semibold transition disabled:opacity-40 ${targetKind === "invoice" ? "border-sky-300 bg-sky-50 text-sky-800" : "border-slate-200 text-slate-600"}`}><ReceiptText className="h-4 w-4" /> Case invoice</button>
                        <button type="button" disabled={!availableAppointments.length} onClick={() => chooseTargetKind("appointment")} className={`flex h-11 items-center justify-center gap-2 rounded-2xl border text-xs font-semibold transition disabled:opacity-40 ${targetKind === "appointment" ? "border-sky-300 bg-sky-50 text-sky-800" : "border-slate-200 text-slate-600"}`}><CalendarDays className="h-4 w-4" /> Appointment</button>
                      </div>
                      {targetKind === "invoice" ? <label className="mt-4 block text-xs font-medium text-slate-600">Outstanding invoice<select required value={form.invoiceId} onChange={(event) => chooseInvoice(event.target.value)} className={fieldClass}><option value="">Choose invoice</option>{(options?.invoices || []).map((item) => <option key={item.id} value={item.id}>{item.qbInvoiceNumber ? `#${item.qbInvoiceNumber} · ` : ""}{item.description} · {money(item.balance)}</option>)}</select></label> : <label className="mt-4 block text-xs font-medium text-slate-600">Appointment<select required value={form.appointmentId} onChange={(event) => chooseAppointment(event.target.value)} className={fieldClass}><option value="">Choose appointment</option>{availableAppointments.map((item) => <option key={item.id} value={item.id}>{shortDate(item.startsAt)} · {item.subject || item.sessionType?.name || "Consultation"}{item.isFreeConsultation ? " · currently free" : item.paymentHold?.status === "Paid" ? " · add missing transaction #" : ""}{item.identityMatched ? " · matched by contact" : ""}</option>)}</select></label>}
                      {repairingAppointment ? <p className="mt-3 rounded-2xl bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-800">This appointment is already paid. Saving will attach the missing payment method and transaction number to the existing QuickBooks payment—no second charge will be created.</p> : null}
                      {selectedAppointment?.identityMatched ? <p className="mt-3 rounded-2xl bg-sky-50 px-3.5 py-3 text-xs leading-5 text-sky-800">This older guest appointment matches the client's email or phone. It will be linked to this profile when you save the payment.</p> : null}
                      {selectedAppointment?.isFreeConsultation ? <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-900"><input type="checkbox" checked={confirmPaidOverride} onChange={(event) => { setConfirmPaidOverride(event.target.checked); setError(""); }} className="mt-1 h-4 w-4 rounded border-amber-300 text-slate-950 focus:ring-amber-300" /><span><strong className="block font-semibold">Convert this free appointment to paid</strong>This creates the consultation invoice and records the payment in QuickBooks. It cannot happen without this confirmation.</span></label> : null}
                    </section>
                  ) : (
                    <section className="space-y-4 rounded-[1.5rem] border border-white bg-white p-4 shadow-sm">
                      <div className="flex items-center gap-2"><FilePlus2 className="h-4 w-4 text-sky-600" /><p className="text-xs font-semibold text-slate-800">Create the charge first, then apply this payment</p></div>
                      <label className="block text-xs font-medium text-slate-600">Case<select required value={form.caseId} onChange={(event) => update("caseId", event.target.value)} className={fieldClass}><option value="">Choose case</option>{(options?.cases || []).map((item) => <option key={item.id} value={item.id}>{item.caseType} · {item.stage || item.status}</option>)}</select></label>
                      <label className="block text-xs font-medium text-slate-600">Agency fee category<select required value={form.paymentType} onChange={(event) => { update("paymentType", event.target.value); setError(""); }} className={fieldClass}><option value="">Choose fee category</option>{(options?.categories || []).map((item) => <option key={item.code} value={item.code} disabled={!item.mapped}>{item.name}{item.mapped ? "" : " · needs QuickBooks mapping"}</option>)}</select></label>
                      <label className="block text-xs font-medium text-slate-600">Description<input required maxLength={500} value={form.description} onChange={(event) => update("description", event.target.value)} className={fieldClass} placeholder="What this charge is for" /></label>
                      <label className="block text-xs font-medium text-slate-600">Total charge<input required type="number" min="0.01" max="1000000" step="0.01" value={form.chargeAmount} onChange={(event) => { const value = event.target.value; setForm((current) => ({ ...current, chargeAmount: value, amount: current.amount || value })); }} className={fieldClass} /></label>
                    </section>
                  )}

                  <section className="space-y-4 rounded-[1.5rem] border border-white bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2"><Banknote className="h-4 w-4 text-emerald-600" /><p className="text-xs font-semibold text-slate-800">Payment details</p></div>
                    {!repairingAppointment ? <label className="block text-xs font-medium text-slate-600">Amount received<input required type="number" min="0.01" step="0.01" max={selectedInvoice ? Number(selectedInvoice.balance) : mode === "new" ? form.chargeAmount || undefined : undefined} value={form.amount} onChange={(event) => update("amount", event.target.value)} className={fieldClass} /></label> : null}
                    <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">{[["ETransfer", "E-transfer"], ["Cash", "Cash"]].map(([value, label]) => <button key={value} type="button" onClick={() => { update("method", value); setError(""); }} className={`h-10 rounded-xl text-xs font-semibold transition ${form.method === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>)}</div>
                    <label className="block text-xs font-medium text-slate-600">{form.method === "ETransfer" ? "Transaction number *" : "Receipt / reference (optional)"}<input required={form.method === "ETransfer"} maxLength={100} value={form.transactionReference} onChange={(event) => update("transactionReference", event.target.value)} className={fieldClass} placeholder={form.method === "ETransfer" ? "Enter bank transaction number" : "Receipt or internal reference"} /></label>
                    <label className="block text-xs font-medium text-slate-600">Payment date<input required type="date" max={options?.today || today()} value={form.paymentDate} onChange={(event) => update("paymentDate", event.target.value)} className={fieldClass} /></label>
                    <label className="block text-xs font-medium text-slate-600">Internal note (optional)<textarea rows="3" maxLength={500} value={form.note} onChange={(event) => update("note", event.target.value)} className="mt-1.5 w-full resize-none rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100" placeholder="Deposit details or context for staff" /></label>
                  </section>

                  {warning ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800">{warning}</div> : null}
                  {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs leading-5 text-rose-700">{error}{!options && !loading ? <button type="button" onClick={() => setLoadAttempt((value) => value + 1)} className="mt-3 flex h-9 items-center justify-center rounded-full border border-rose-200 bg-white px-4 font-semibold text-rose-700">Try again</button> : null}</div> : null}
                </div>
                <footer className="border-t border-white bg-white/85 p-4"><button type="submit" disabled={saving || loading || (mode === "existing" && targetKind === "invoice" && !form.invoiceId) || (mode === "existing" && targetKind === "appointment" && (!form.appointmentId || (selectedAppointment?.isFreeConsultation && !confirmPaidOverride)))} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-45">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{saving ? "Saving payment…" : repairingAppointment ? "Save missing payment details" : selectedAppointment?.isFreeConsultation ? "Convert and record payment" : "Record payment"}</button></footer>
              </form>
            )}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
