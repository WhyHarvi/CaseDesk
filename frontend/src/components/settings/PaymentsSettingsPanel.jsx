import { AlertTriangle, Banknote, CheckCircle2, CreditCard, Landmark, Link2, Loader2, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../../services/api";
import PaymentCommunicationSettingsCard from "./PaymentCommunicationSettingsCard";
import PaymentScheduleTemplatesCard from "./PaymentScheduleTemplatesCard";
import QuickBooksMappingCard from "./QuickBooksMappingCard";
import BillingSignatureSettingsCard from "./BillingSignatureSettingsCard";
import CustomPaymentLedgersCard from "./CustomPaymentLedgersCard";

const card = "rounded-[1.4rem] border border-white/70 bg-white/80 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur-xl";

export default function PaymentsSettingsPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  async function load() {
    try {
      const response = await api.get("/quickbooks/status", { cache: false });
      setStatus(response.data.data);
    } catch (reason) {
      setError(reason.response?.data?.message || "QuickBooks status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const result = searchParams.get("qbo");
    if (!result) return;
    if (result === "connected") setNotice("QuickBooks is connected. Your books and CaseDesk are now linked.");
    else if (result === "denied") setError("The connection was cancelled inside QuickBooks.");
    else setError(searchParams.get("message") || "The QuickBooks connection could not be completed. Try again.");
    const next = new URLSearchParams(searchParams);
    next.delete("qbo");
    next.delete("message");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  async function connect() {
    setWorking(true);
    setError("");
    try {
      const response = await api.post("/quickbooks/connect");
      window.location.href = response.data.data.url;
    } catch (reason) {
      setError(reason.response?.data?.message || "The connection could not be started.");
      setWorking(false);
    }
  }

  async function disconnect() {
    setWorking(true);
    setError("");
    try {
      await api.post("/quickbooks/disconnect");
      setConfirmDisconnect(false);
      setNotice("QuickBooks has been disconnected.");
      await load();
    } catch (reason) {
      setError(reason.response?.data?.message || "QuickBooks could not be disconnected.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return <div className={`${card} flex items-center gap-2 text-sm text-slate-500`}><Loader2 className="h-4 w-4 animate-spin" /> Checking QuickBooks connection…</div>;
  }

  const connected = status?.connected;

  return (
    <div className="space-y-5">
      {notice ? <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</p> : null}
      {error ? <p className="flex items-center gap-2 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</p> : null}

      <section className={card}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${connected ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
              <Landmark className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-slate-950">QuickBooks Online</h3>
              {connected ? (
                <>
                  <p className="mt-0.5 text-sm text-slate-600">
                    Connected to <span className="font-semibold">{status.companyName || "your company"}</span>
                    {status.environment === "sandbox" ? <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Sandbox</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Since {new Date(status.connectedAt).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}
                    {status.refreshTokenExpiresAt ? ` · reauthorize by ${new Date(status.refreshTokenExpiresAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}` : ""}
                  </p>
                </>
              ) : status?.status === "error" ? (
                <p className="mt-0.5 text-sm text-rose-600">Connection needs attention — {status.lastError || "reconnect to continue"}.</p>
              ) : (
                <p className="mt-0.5 text-sm text-slate-500">QuickBooks handles invoices and approved electronic payments. CaseDesk keeps cash records and the staff payment-approval trail.</p>
              )}
            </div>
          </div>

          {connected ? (
            confirmDisconnect ? (
              <span className="flex items-center gap-2">
                <button type="button" disabled={working} onClick={disconnect} className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-60">
                  {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />} Confirm disconnect
                </button>
                <button type="button" disabled={working} onClick={() => setConfirmDisconnect(false)} className="rounded-full px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Keep</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDisconnect(true)} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">
                <Unplug className="h-4 w-4" /> Disconnect
              </button>
            )
          ) : (
            <button
              type="button"
              disabled={working || !status?.configured}
              onClick={connect}
              className="inline-flex items-center gap-2 rounded-full bg-[#2CA01C] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(44,160,28,0.35)] transition hover:brightness-110 disabled:opacity-50"
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {status?.status === "error" ? "Reconnect QuickBooks" : "Connect QuickBooks"}
            </button>
          )}
        </div>

        {!status?.configured ? (
          <p className="mt-4 rounded-2xl border border-dashed border-amber-200 bg-amber-50/60 px-4 py-3 text-xs leading-5 text-amber-800">
            The server is missing Intuit app credentials (QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI). Create a free app at developer.intuit.com and add the keys to the backend environment to enable this button.
          </p>
        ) : null}
      </section>

      {connected ? <QuickBooksMappingCard /> : null}
      <CustomPaymentLedgersCard />

      <section className={card}>
        <h3 className="text-sm font-semibold text-slate-900">How payments flow once connected</h3>
        <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
          <p className="flex items-start gap-2.5"><Banknote className="mt-1 h-4 w-4 shrink-0 text-slate-400" /><span><span className="font-medium text-slate-800">Interac e-transfers</span> should be recorded against the matching CaseDesk invoice using the bank transaction number. CaseDesk then records the payment in QuickBooks and keeps the reference in the client billing trail.</span></p>
          <p className="flex items-start gap-2.5"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-slate-400" /><span><span className="font-medium text-slate-800">Cash</span> stays in CaseDesk and is never posted to QuickBooks. Frontdesk submissions require administrator approval before they count as received.</span></p>
          <p className="flex items-start gap-2.5"><CreditCard className="mt-1 h-4 w-4 shrink-0 text-slate-400" /><span><span className="font-medium text-slate-800">Cards</span> — if your QuickBooks company has QuickBooks Payments turned on, every invoice automatically gets a "Pay now" link shown to the client. Nothing to configure here.</span></p>
        </div>
      </section>

      <section>
        <h3 className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Retainer &amp; tax</h3>
        <BillingSignatureSettingsCard />
      </section>

      <section>
        <h3 className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Payment schedules</h3>
        <PaymentScheduleTemplatesCard />
      </section>

      <section>
        <h3 className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Client payment communication</h3>
        <PaymentCommunicationSettingsCard />
      </section>
    </div>
  );
}
