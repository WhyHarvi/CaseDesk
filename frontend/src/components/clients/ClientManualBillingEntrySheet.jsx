import { AnimatePresence, motion } from "framer-motion";
import { Banknote, CalendarDays, Check, ClipboardCheck, FilePlus2, Loader2, ReceiptText, WalletCards, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClientManualBillingEntry, getClientManualBillingOptions } from "../../api/clientBillingApi";

const newKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const today = () => new Date().toISOString().slice(0, 10);
const money = (value) => Number(value || 0).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
const shortDate = (value) => new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });

const fieldClass = "mt-1.5 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";
const PAYMENT_METHODS = [["ETransfer", "E-transfer"], ["Cash", "Cash"]];
const visiblePaymentMethod = (value) => PAYMENT_METHODS.some(([method]) => method === value) ? value : "ETransfer";

export default function ClientManualBillingEntrySheet({ open, clientId, clientName, initialMode = "", initialPaymentType = "", initialCaseId = "", initialInvoiceId = "", restrictCaseId = "", includeAppointments = true, fixedMethod = "", onClose, onSaved }) {
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [confirmPaidOverride, setConfirmPaidOverride] = useState(false);
  const [submittedApproval, setSubmittedApproval] = useState(null);
  // A direct (no-approval-needed) success used to just silently close the
  // sheet — no confirmation at all that the payment actually went through.
  // That ambiguity is exactly how the same $100 e-transfer for one
  // appointment ended up recorded three times: nothing on screen ever told
  // frontdesk it had already worked. This mirrors submittedApproval's own
  // "Done" confirmation screen for the direct-success case instead.
  const [recordedConfirmation, setRecordedConfirmation] = useState(null);
  const [mode, setMode] = useState("existing");
  const [targetKind, setTargetKind] = useState("invoice");
  const [form, setForm] = useState({ invoiceId: "", appointmentId: "", caseId: "", paymentType: "", description: "", chargeAmount: "", amount: "", method: "ETransfer", transactionReference: "", paymentDate: today(), note: "", idempotencyKey: newKey(), customLedgerId: "" });

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setOptions(null);
    setError("");
    setWarning("");
    setConfirmPaidOverride(false);
    setSubmittedApproval(null);
    setRecordedConfirmation(null);
    getClientManualBillingOptions(clientId)
      .then((result) => {
        if (!active) return;
        const scopedResult = restrictCaseId ? {
          ...result,
          cases: (result.cases || []).filter((item) => item.id === restrictCaseId),
          invoices: (result.invoices || []).filter((item) => item.caseId === restrictCaseId),
          appointments: includeAppointments ? (result.appointments || []).filter((item) => item.caseId === restrictCaseId) : [],
        } : { ...result, appointments: includeAppointments ? result.appointments || [] : [] };
        setOptions(scopedResult);
        const firstInvoice = scopedResult.invoices?.find((item) => item.id === initialInvoiceId) || scopedResult.invoices?.[0];
        const firstAppointment = scopedResult.appointments?.find((item) => item.paymentHold?.status !== "Paid" || !item.paymentHold?.manualPaymentReference);
        const requestedCategory = scopedResult.categories?.find((item) => item.code === initialPaymentType);
        const firstCategory = initialPaymentType
          ? ((fixedMethod === "Cash" || requestedCategory?.mapped) ? requestedCategory : null)
          : fixedMethod === "Cash" ? scopedResult.categories?.[0] : scopedResult.categories?.find((item) => item.mapped);
        const requestedCase = scopedResult.cases?.find((item) => item.id === (restrictCaseId || initialCaseId));
        const nextKind = firstInvoice ? "invoice" : "appointment";
        setTargetKind(nextKind);
        setMode(initialMode === "new" && scopedResult.cases?.length ? "new" : firstInvoice || firstAppointment ? "existing" : "new");
        if (initialMode === "new" && initialPaymentType && fixedMethod !== "Cash" && !requestedCategory?.mapped) {
          setError("Professional fees must be mapped to a QuickBooks item in Settings before this charge can be created.");
        }
        setForm({
          invoiceId: firstInvoice?.id || "",
          appointmentId: firstAppointment?.id || "",
          caseId: requestedCase?.id || scopedResult.cases?.[0]?.id || "",
          paymentType: firstCategory?.code || "",
          description: "",
          chargeAmount: "",
          amount: firstInvoice ? String(Number(firstInvoice.balance)) : firstAppointment?.paymentHold?.amount ? String(Number(firstAppointment.paymentHold.amount)) : String(Number(result.consultationFee || 0) || ""),
          method: fixedMethod || visiblePaymentMethod(firstAppointment?.paymentHold?.paymentMethod),
          transactionReference: firstAppointment?.paymentHold?.manualPaymentReference || "",
          paymentDate: scopedResult.today || today(),
          note: "",
          idempotencyKey: newKey(),
          customLedgerId: "",
        });
      })
      .catch((reason) => { if (active) setError(reason.response?.data?.message || "Payment options could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, clientId, initialMode, initialPaymentType, initialCaseId, initialInvoiceId, restrictCaseId, includeAppointments, fixedMethod, loadAttempt]);

  const availableAppointments = useMemo(() => (options?.appointments || []).filter((item) => item.paymentHold?.status !== "Paid" || (item.paymentHold?.paymentMethod === "ETransfer" && !item.paymentHold?.manualPaymentReference)), [options]);
  const selectedInvoice = options?.invoices?.find((item) => item.id === form.invoiceId);
  const selectedAppointment = availableAppointments.find((item) => item.id === form.appointmentId);
  const repairingAppointment = selectedAppointment?.paymentHold?.status === "Paid";
  // Mirrors createClientManualBillingEntry's own gating: Cash always needs
  // review; a frontdesk-submitted consultation payment (a fixed, pre-agreed
  // fee) no longer does — only case billing (a new charge, or a payment
  // against an existing invoice, where frontdesk could type in any amount)
  // still requires it for every method.
  const isAppointmentPaymentEntry = mode !== "new" && targetKind === "appointment";
  const requiresApproval = form.method === "Cash" || Boolean(options?.approvalRequiredForEntries && !isAppointmentPaymentEntry);
  // Ledger tagging only means anything for case billing — a custom ledger
  // is matched off a case's caseType, and appointments (consultation holds)
  // were never wired to one.
  const showLedgerPicker = !isAppointmentPaymentEntry && Boolean(options?.ledgers?.length);
  const selectedLedger = options?.ledgers?.find((item) => item.id === form.customLedgerId);

  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); }

  function chooseTargetKind(kind) {
    setTargetKind(kind);
    setError("");
    setConfirmPaidOverride(false);
    if (kind === "invoice") {
      const item = options?.invoices?.[0];
      setForm((current) => ({ ...current, invoiceId: item?.id || "", amount: item ? String(Number(item.balance)) : "", transactionReference: "", method: fixedMethod || "ETransfer", customLedgerId: "", idempotencyKey: newKey() }));
    } else {
      const item = availableAppointments[0];
      setForm((current) => ({ ...current, appointmentId: item?.id || "", amount: item?.paymentHold?.amount ? String(Number(item.paymentHold.amount)) : String(Number(options?.consultationFee || 0) || ""), transactionReference: item?.paymentHold?.manualPaymentReference || "", method: fixedMethod || visiblePaymentMethod(item?.paymentHold?.paymentMethod), customLedgerId: "", idempotencyKey: newKey() }));
    }
  }

  function chooseInvoice(id) {
    const item = options?.invoices?.find((row) => row.id === id);
    setForm((current) => ({ ...current, invoiceId: id, amount: item ? String(Number(item.balance)) : "", idempotencyKey: newKey() }));
  }

  function chooseAppointment(id) {
    const item = availableAppointments.find((row) => row.id === id);
    setForm((current) => ({ ...current, appointmentId: id, amount: item?.paymentHold?.amount ? String(Number(item.paymentHold.amount)) : String(Number(options?.consultationFee || 0) || ""), method: fixedMethod || visiblePaymentMethod(item?.paymentHold?.paymentMethod), transactionReference: item?.paymentHold?.manualPaymentReference || "", paymentDate: item?.paymentHold?.paidAt?.slice?.(0, 10) || current.paymentDate, idempotencyKey: newKey() }));
    setConfirmPaidOverride(false);
  }

  async function submit(event) {
    event.preventDefault();
    if (form.method !== "Cash" && !form.transactionReference.trim()) { setError("Enter the e-transfer transaction number."); return; }
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
        customLedgerId: showLedgerPicker && form.customLedgerId ? form.customLedgerId : undefined,
      });
      await onSaved?.(result);
      if (result.approvalRequired) {
        setSubmittedApproval(result.approval);
        setWarning(result.message || "Request sent successfully. Do not submit this payment again. You will receive a notification when an administrator approves or rejects it.");
      } else if (result.paymentRecorded && !repairingAppointment) {
        const methodLabel = form.method === "ETransfer" ? "e-transfer" : form.method.toLowerCase();
        setRecordedConfirmation({ amount: money(Number(form.amount) || 0), method: methodLabel });
        setWarning(`${money(Number(form.amount) || 0)} ${methodLabel} payment recorded and applied in QuickBooks.`);
      } else if (result.paymentWarning) {
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
              <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white"><WalletCards className="h-4 w-4" /></span><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{clientName}</p><h2 className="truncate text-lg font-semibold text-slate-950">{fixedMethod === "Cash" ? "Record cash payment" : "Record manual payment"}</h2></div></div>
              <button type="button" onClick={onClose} disabled={saving} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </header>

            {loading ? <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> : (
              <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
                <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-200/60 p-1">
                    <button type="button" disabled={!options?.invoices?.length && !availableAppointments.length} onClick={() => { setMode("existing"); setWarning(""); }} className={`h-10 rounded-xl text-xs font-semibold transition disabled:opacity-40 ${mode === "existing" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>Existing charge</button>
                    <button type="button" disabled={!options?.cases?.length} onClick={() => { setMode("new"); setWarning(""); setError(""); }} className={`h-10 rounded-xl text-xs font-semibold transition disabled:opacity-40 ${mode === "new" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>New charge + payment</button>
                  </div>

                  {mode === "existing" ? (
                    <section className="rounded-[1.5rem] border border-white bg-white p-4 shadow-sm">
                      <p className="text-xs font-semibold text-slate-800">Apply payment to</p>
                      <div className={`mt-3 grid gap-2 ${includeAppointments ? "grid-cols-2" : "grid-cols-1"}`}>
                        <button type="button" disabled={!options?.invoices?.length} onClick={() => chooseTargetKind("invoice")} className={`flex h-11 items-center justify-center gap-2 rounded-2xl border text-xs font-semibold transition disabled:opacity-40 ${targetKind === "invoice" ? "border-sky-300 bg-sky-50 text-sky-800" : "border-slate-200 text-slate-600"}`}><ReceiptText className="h-4 w-4" /> Case invoice</button>
                        {includeAppointments ? <button type="button" disabled={!availableAppointments.length} onClick={() => chooseTargetKind("appointment")} className={`flex h-11 items-center justify-center gap-2 rounded-2xl border text-xs font-semibold transition disabled:opacity-40 ${targetKind === "appointment" ? "border-sky-300 bg-sky-50 text-sky-800" : "border-slate-200 text-slate-600"}`}><CalendarDays className="h-4 w-4" /> Appointment</button> : null}
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
                      <label className="block text-xs font-medium text-slate-600">Agency fee category<select required value={form.paymentType} onChange={(event) => { update("paymentType", event.target.value); setError(""); }} className={fieldClass}><option value="">Choose fee category</option>{(options?.categories || []).map((item) => <option key={item.code} value={item.code} disabled={form.method !== "Cash" && !item.mapped}>{item.name}{item.mapped || form.method === "Cash" ? "" : " · needs QuickBooks mapping"}</option>)}</select></label>
                      <label className="block text-xs font-medium text-slate-600">Description<input required maxLength={500} value={form.description} onChange={(event) => update("description", event.target.value)} className={fieldClass} placeholder="What this charge is for" /></label>
                      <label className="block text-xs font-medium text-slate-600">Charge before tax<input required type="number" min="0.01" max="1000000" step="0.01" value={form.chargeAmount} onChange={(event) => { const value = event.target.value; setForm((current) => ({ ...current, chargeAmount: value })); }} className={fieldClass} /><span className="mt-2 block text-[11px] leading-4 text-slate-400">CaseDesk adds the agency tax rate for professional and consultation categories. Enter the actual total received below.</span></label>
                    </section>
                  )}

                  <section className="space-y-4 rounded-[1.5rem] border border-white bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2"><Banknote className="h-4 w-4 text-emerald-600" /><p className="text-xs font-semibold text-slate-800">Payment details</p></div>
                    {!repairingAppointment ? <label className="block text-xs font-medium text-slate-600">Amount received<input required type="number" min="0.01" step="0.01" max={selectedInvoice ? Number(selectedInvoice.balance) : mode === "new" ? form.chargeAmount || undefined : undefined} value={form.amount} onChange={(event) => update("amount", event.target.value)} className={fieldClass} /></label> : null}
                    {showLedgerPicker ? (
                      <label className="block text-xs font-medium text-slate-600">Ledger
                        <select value={form.customLedgerId} onChange={(event) => { const value = event.target.value; setForm((current) => ({ ...current, customLedgerId: value, method: value ? "Cash" : (fixedMethod || "ETransfer") })); setError(""); }} className={fieldClass}>
                          <option value="">Auto-detect (recommended)</option>
                          {options.ledgers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                        <span className="mt-2 block text-[11px] leading-4 text-slate-400">{form.customLedgerId ? "Filing this under a specific ledger keeps it off QuickBooks entirely — recorded in CaseDesk only." : "Left on Auto-detect, CaseDesk matches the ledger from the case type and payment method — no QuickBooks change either way."}</span>
                      </label>
                    ) : null}
                    {fixedMethod || form.customLedgerId ? <div className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-violet-50 text-xs font-semibold text-violet-700"><Banknote className="h-4 w-4" />Cash · CaseDesk only</div> : <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">{PAYMENT_METHODS.map(([value, label]) => <button key={value} type="button" onClick={() => { update("method", value); setError(""); }} className={`h-10 rounded-xl px-1 text-[11px] font-semibold transition ${form.method === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>)}</div>}
                    <p className={`rounded-2xl px-3.5 py-3 text-xs leading-5 ${form.method === "Cash" ? "bg-violet-50 text-violet-700" : requiresApproval ? "bg-amber-50 text-amber-700" : "bg-sky-50 text-sky-700"}`}>{form.customLedgerId ? `Filed under ${selectedLedger?.name || "the selected ledger"} — recorded in CaseDesk only, never sent to QuickBooks.` : form.method === "Cash" ? "Cash is recorded in the CaseDesk Cash ledger and never sent to QuickBooks." : requiresApproval ? "Frontdesk entries are submitted to an administrator. QuickBooks is updated only after approval." : "This payment is applied and recorded in QuickBooks immediately when you save."}</p>
                    <label className="block text-xs font-medium text-slate-600">{form.method === "Cash" ? "Receipt / reference (optional)" : "E-transfer transaction number *"}<input required={form.method !== "Cash"} maxLength={100} value={form.transactionReference} onChange={(event) => update("transactionReference", event.target.value)} className={fieldClass} placeholder={form.method === "Cash" ? "Receipt or internal reference" : "Enter the e-transfer transaction number"} /></label>
                    <label className="block text-xs font-medium text-slate-600">Payment date<input required type="date" max={options?.today || today()} value={form.paymentDate} onChange={(event) => update("paymentDate", event.target.value)} className={fieldClass} /></label>
                    <label className="block text-xs font-medium text-slate-600">Internal note (optional)<textarea rows="3" maxLength={500} value={form.note} onChange={(event) => update("note", event.target.value)} className="mt-1.5 w-full resize-none rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100" placeholder="Deposit details or context for staff" /></label>
                  </section>

                  {warning ? <div className={`rounded-2xl border p-4 text-xs leading-5 ${submittedApproval || recordedConfirmation ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{submittedApproval ? <strong className="mb-1 flex items-center gap-1.5 text-sm"><ClipboardCheck className="h-4 w-4" /> Sent for approval</strong> : recordedConfirmation ? <strong className="mb-1 flex items-center gap-1.5 text-sm"><Check className="h-4 w-4" /> Payment sent</strong> : null}{warning}{submittedApproval ? <span className="mt-1 block">The administrator will review it in Payments → Payment approvals.</span> : null}</div> : null}
                  {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs leading-5 text-rose-700">{error}{!options && !loading ? <button type="button" onClick={() => setLoadAttempt((value) => value + 1)} className="mt-3 flex h-9 items-center justify-center rounded-full border border-rose-200 bg-white px-4 font-semibold text-rose-700">Try again</button> : null}</div> : null}
                </div>
                <footer className="border-t border-white bg-white/85 p-4">{submittedApproval || recordedConfirmation ? <button type="button" onClick={onClose} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white"><Check className="h-4 w-4" />Done</button> : <button type="submit" disabled={saving || loading || (mode === "existing" && targetKind === "invoice" && !form.invoiceId) || (mode === "existing" && targetKind === "appointment" && (!form.appointmentId || (selectedAppointment?.isFreeConsultation && !confirmPaidOverride)))} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-45">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{saving ? "Saving payment…" : requiresApproval ? "Submit for approval" : repairingAppointment ? "Save missing payment details" : selectedAppointment?.isFreeConsultation ? "Convert and record payment" : "Record payment"}</button>}</footer>
              </form>
            )}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
