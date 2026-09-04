import {
  BarChart3,
  BookUser,
  History,
  Loader2,
  Phone,
  PhoneCall,
  PhoneOff,
  RefreshCw,
  Search,
  Settings2,
  UserRoundPlus,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useSoftphone } from "../components/calls/SoftphoneProvider";
import { openGlobalDialpad } from "../components/calls/GlobalDialpad";
import api from "../services/api";
import { CallHistorySection, CallPerformanceSection } from "./CallHistoryPage";

const panel = "overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/90 shadow-[0_18px_50px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70 backdrop-blur-xl";
const input = "h-11 w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100/70";

function ProviderPill() {
  const { status, error } = useSoftphone();
  if (status === "ready") {
    return <span role="status" className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200"><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />Softphone ready</span>;
  }
  if (status === "registering") {
    return <span role="status" className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Connecting softphone…</span>;
  }
  if (status === "unconfigured") {
    return <span role="status" className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200"><PhoneOff className="h-3.5 w-3.5" aria-hidden="true" />Calling not set up</span>;
  }
  return <span role="status" title={error || "Softphone unavailable"} className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200"><PhoneOff className="h-3.5 w-3.5" aria-hidden="true" />Softphone offline</span>;
}

function AddressBook({ onPick }) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState({ clients: [], leads: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (term) => {
    try {
      setLoading(true);
      setError("");
      const response = await api.get(`/twilio-calls/address-book?search=${encodeURIComponent(term.trim())}`, { cache: false });
      setRows(response.data?.data || { clients: [], leads: [] });
    } catch (reason) {
      setError(reason?.response?.data?.message || "The address book could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(search), 250);
    return () => window.clearTimeout(timer);
  }, [search, load]);

  const clients = rows.clients || [];
  const leads = rows.leads || [];
  const total = clients.length + leads.length;

  return (
    <div className={panel}>
      <div className="grid gap-5 border-b border-slate-200 p-5 md:grid-cols-[minmax(0,1fr)_minmax(18rem,28rem)] md:items-end md:p-6">
        <div>
          <div className="flex items-center gap-2"><BookUser className="h-4 w-4 text-blue-700" aria-hidden="true" /><h2 className="text-base font-semibold text-slate-950">Address book</h2>{!loading ? <span className="text-xs font-medium tabular-nums text-slate-400">{total}</span> : null}</div>
          <p className="mt-1 text-sm leading-6 text-slate-500">Clients and open leads with a phone number.</p>
        </div>
        <label className="block text-xs font-semibold text-slate-600">
          Search contacts
          <span className="relative mt-2 block"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} className={`${input} pl-10`} placeholder="Name, number, or reference" /></span>
        </label>
      </div>

      {error ? <div className="m-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="space-y-3 p-5">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-2xl bg-slate-100" />)}</div> : (
        <div className="max-h-[36rem] overflow-y-auto">
          {!clients.length && !leads.length ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 text-sky-600"><UserRoundPlus className="h-6 w-6" /></div>
              <p className="mt-4 text-base font-semibold text-slate-900">{search ? "No matching contacts" : "No contacts with phone numbers yet"}</p>
              <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">{search ? "Try a different name or number." : "Contacts with phone numbers will appear here as clients and leads are added."}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {clients.map((client) => (
                <ContactRow key={`c:${client.id}`} row={client} kind="Client" reference={client.clientNumber} onCall={(phone) => onPick(phone, client.fullName)} />
              ))}
              {leads.map((lead) => (
                <ContactRow key={`l:${lead.id}`} row={lead} kind="Lead" reference={lead.leadNumber} onCall={(phone) => onPick(phone, lead.fullName)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContactRow({ row, kind, reference, onCall }) {
  const phones = [
    { label: "Primary", value: String(row.phone || "") },
    { label: "Secondary", value: String(row.secondaryPhone || "") },
  ].filter((phone) => phone.value.replace(/\D/g, "").length >= 7);
  return (
    <div className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-slate-50 sm:px-6">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${kind === "Client" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"}`} aria-hidden="true">{kind.slice(0, 1)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{row.fullName || reference}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{kind} · {reference || ""}{phones.length ? ` · ${phones.map((phone) => `${phone.label}: ${phone.value}`).join(" · ")}` : ""}</p>
      </div>
      {phones.length ? (
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {phones.map((phone) => (
            <button key={phone.label} type="button" onClick={() => onCall(phone.value)} aria-label={`Call ${row.fullName || reference} on ${phone.label.toLowerCase()} phone`} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#007AFF] px-4 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(0,122,255,0.22)] transition hover:bg-[#0873df] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"><Phone className="h-3.5 w-3.5" aria-hidden="true" />{phones.length > 1 ? phone.label : "Call"}</button>
          ))}
        </div>
      ) : (
        <span className="text-[11px] font-semibold text-slate-400">No phone</span>
      )}
    </div>
  );
}

export default function CallsPage() {
  const { role } = useAuth();
  const { status } = useSoftphone();
  const [tab, setTab] = useState("history");
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");

  const pickFromAddressBook = (number) => {
    openGlobalDialpad(String(number || "").replace(/[^\d+]/g, ""));
  };

  const syncHistory = async () => {
    try {
      setSyncing(true);
      setSyncNotice("");
      const response = await api.post("/twilio-calls/sync");
      const data = response.data?.data || {};
      setSyncNotice(data.reason === "voice_not_configured" ? "Calling is not configured yet — nothing to sync." : `Synced ${data.synced || 0} calls from Twilio.`);
    } catch (reason) {
      setSyncNotice(reason?.response?.data?.message || "The Twilio history sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="relative space-y-5 pb-24">
      <header className="relative overflow-hidden rounded-[2rem] border border-white/80 bg-gradient-to-br from-white via-white to-blue-50/70 shadow-[0_22px_60px_rgba(15,23,42,0.09)] ring-1 ring-slate-200/60">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-blue-100/70 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-6 px-5 py-6 sm:px-7 sm:py-7 lg:flex-row lg:items-center lg:justify-between">
          <div>
          <p className="text-xs font-semibold text-blue-800">Calls</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">Call center</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Place browser calls, find contacts, and review your team’s shared Twilio history.</p>
          </div>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div><p className="mb-1.5 text-[11px] font-medium text-slate-400">Browser phone</p><ProviderPill /></div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => openGlobalDialpad()} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#007AFF] px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(0,122,255,0.28)] transition hover:bg-[#0873df] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"><PhoneCall className="h-4 w-4" aria-hidden="true" />New call <kbd className="rounded-md border border-white/30 bg-white/10 px-1.5 py-0.5 text-[9px]">D</kbd></button>
              {role === "admin" ? (
                <>
                  <button type="button" disabled={syncing} onClick={syncHistory} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-4 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />Sync</button>
                  <Link to="/app/settings?section=agency-phone" aria-label="Calling settings" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 shadow-sm transition hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"><Settings2 className="h-4 w-4" aria-hidden="true" /></Link>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {syncNotice ? <div role="status" className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 shadow-sm">{syncNotice}</div> : null}

      <nav className="flex w-full rounded-2xl bg-slate-200/70 p-1.5 sm:w-fit" aria-label="Call center views">
        {[["history", "History", History], ["address-book", "Address book", BookUser], ...(["admin", "frontdesk"].includes(role) ? [["performance", "Team performance", BarChart3]] : [])].map(([value, label, Icon]) => (
          <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:flex-none ${tab === value ? "bg-white text-slate-950 shadow-[0_2px_8px_rgba(15,23,42,0.12)]" : "text-slate-500 hover:text-slate-900"}`}><Icon className="h-4 w-4" aria-hidden="true" />{label}</button>
        ))}
      </nav>

      <div>{tab === "history" ? <CallHistorySection provider="TWILIO" /> : tab === "performance" && ["admin", "frontdesk"].includes(role) ? <CallPerformanceSection /> : <AddressBook onPick={pickFromAddressBook} />}</div>

      {status !== "ready" ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/90 px-5 py-4 text-sm leading-6 text-amber-950 shadow-sm">
          <PhoneOff className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1">Calling from the browser is not available right now. {status === "unconfigured" ? (
            <>An admin needs to connect Twilio calling in <Link to="/app/settings?section=agency-phone" className="font-semibold underline">Settings → Connect Twilio</Link> (API key + phone number).</>
          ) : (
            "History still works — incoming and outgoing calls made through Twilio appear here."
          )}</p>
        </div>
      ) : null}

    </section>
  );
}
