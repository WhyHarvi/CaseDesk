import {
  BookUser,
  CheckCircle2,
  Clipboard,
  Delete,
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
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useSoftphone } from "../components/calls/SoftphoneProvider";
import api from "../services/api";
import { CallHistorySection } from "./OomaCallsPage";

const panel = "rounded-3xl border border-slate-200/80 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.07)]";
const input = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100";

const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

function ProviderPill() {
  const { status, error } = useSoftphone();
  if (status === "ready") {
    return <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />Softphone ready</span>;
  }
  if (status === "registering") {
    return <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700"><Loader2 className="h-3.5 w-3.5 animate-spin" />Connecting softphone…</span>;
  }
  if (status === "unconfigured") {
    return <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"><PhoneOff className="h-3.5 w-3.5" />Calling not set up</span>;
  }
  return <span title={error || "Softphone unavailable"} className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700"><PhoneOff className="h-3.5 w-3.5" />Softphone offline</span>;
}

const KEY_LETTERS = { 2: "ABC", 3: "DEF", 4: "GHI", 5: "JKL", 6: "MNO", 7: "PQRS", 8: "TUV", 9: "WXYZ" };

function Dialpad({ initialNumber = "" }) {
  const { dial, active, status } = useSoftphone();
  const [number, setNumber] = useState(initialNumber);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const display = useMemo(() => {
    const digits = number.replace(/\D/g, "");
    if (!digits) return "";
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 11)}${digits.length > 11 ? ` ext ${digits.slice(11)}` : ""}`;
  }, [number]);

  const press = (key) => {
    setError("");
    setNumber((current) => (current.length < 20 ? `${current}${key}` : current));
  };

  const startCall = async () => {
    try {
      setError("");
      setNotice("");
      setBusy(true);
      await dial(number);
      setNotice(`Calling ${display || number}…`);
    } catch (reason) {
      setError(reason?.message || "The call could not be placed.");
    } finally {
      setBusy(false);
    }
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const digits = String(text || "").replace(/[^\d+]/g, "");
      if (digits) { setNumber(digits); setError(""); }
    } catch { /* clipboard unavailable */ }
  };

  const canCall = status === "ready" && number.replace(/\D/g, "").length >= 7 && !active && !busy;
  const digitsCount = number.replace(/\D/g, "").length;

  return (
    <div className="mx-auto grid w-full max-w-3xl items-center gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <div className="relative w-full overflow-hidden rounded-[2rem] border border-slate-200/80 bg-gradient-to-b from-white via-sky-50/40 to-slate-50 shadow-[0_18px_55px_rgba(15,23,42,0.08)]">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-sky-200/40 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-indigo-200/30 blur-3xl" aria-hidden="true" />

        <div className="relative p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-600">Dialpad</p>
              <h3 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-slate-950">Place a call</h3>
            </div>
            {active ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/70 bg-emerald-50/90 px-3 py-1.5 text-xs font-semibold text-emerald-700"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />On a call</span>
            ) : null}
          </div>

          {/* Number display */}
          <div className="relative mt-4 overflow-hidden rounded-[1.35rem] border border-slate-700/60 bg-slate-950 shadow-[inset_0_2px_12px_rgba(0,0,0,0.55),0_16px_40px_rgba(15,23,42,0.25)]">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-500/10 via-transparent to-indigo-500/10" aria-hidden="true" />
            <div className="relative flex h-12 items-center justify-end px-4">
              {display ? (
                <span key={number} style={{ animation: "dialpop 0.12s ease-out" }} className="truncate font-mono text-2xl font-semibold tracking-[0.08em] text-white tabular-nums">{display}</span>
              ) : (
                <span className="flex items-center gap-2 text-sm font-sans font-normal tracking-normal text-slate-400"><span className="inline-block h-4 w-0.5 animate-pulse rounded-full bg-sky-400" />Enter a number</span>
              )}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-sky-400/50 to-transparent" aria-hidden="true" />
          </div>
          {notice ? <p className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />{notice}</p> : null}
          {error ? <p className="mt-2.5 text-sm font-medium text-rose-600">{error}</p> : null}

          {/* Keypad */}
          <div className="mt-4 grid grid-cols-3 gap-x-2 gap-y-3">
            {KEYPAD.map((key) => {
              const letters = KEY_LETTERS[key];
              const subtitle = key === "0" ? "+" : letters || "";
              return (
                <button
                  key={key}
                  type="button"
                  disabled={active}
                  onClick={() => press(key)}
                  className="group relative mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/80 bg-white/85 shadow-[0_6px_18px_rgba(15,23,42,0.07),inset_0_1px_0_rgba(255,255,255,0.95)] backdrop-blur-xl transition-all duration-150 hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_12px_30px_rgba(14,165,233,0.2),inset_0_1px_0_rgba(255,255,255,0.95)] active:translate-y-0 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="flex flex-col items-center leading-none">
                    <span className="text-xl font-semibold text-slate-900 transition-colors duration-150 group-active:text-sky-600">{key}</span>
                    <span className={`mt-0.5 text-[8px] font-bold uppercase tracking-[0.16em] ${subtitle ? "text-slate-400" : "text-transparent"}`}>{subtitle || "·"}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Action row */}
          <div className="mt-5 grid grid-cols-3 gap-x-2">
            <button
              type="button"
              disabled={active || !number}
              onClick={paste}
              aria-label="Paste number"
              className="group mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/80 bg-white/85 text-slate-500 shadow-[0_6px_18px_rgba(15,23,42,0.07),inset_0_1px_0_rgba(255,255,255,0.95)] backdrop-blur-xl transition-all duration-150 hover:-translate-y-0.5 hover:text-sky-600 hover:shadow-[0_12px_30px_rgba(14,165,233,0.18)] active:translate-y-0 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Clipboard className="h-5 w-5" />
            </button>

            <button
              type="button"
              disabled={!canCall && !busy && !active}
              onClick={startCall}
              aria-label={busy ? "Calling…" : "Call"}
              className={`relative mx-auto flex h-14 w-14 items-center justify-center overflow-hidden rounded-full transition-all duration-200 active:scale-90 disabled:cursor-not-allowed ${
                canCall || busy
                  ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-[0_14px_36px_rgba(5,150,105,0.42)] hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(5,150,105,0.52)]"
                  : "bg-slate-200/80 text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
              }`}
            >
              {canCall ? <span className="absolute inset-0 animate-ping rounded-full bg-emerald-300/40" style={{ animationDuration: "2.6s" }} aria-hidden="true" /> : null}
              <span className="relative">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <PhoneCall className="h-5 w-5" />}</span>
            </button>

            <button
              type="button"
              disabled={active || !number}
              onClick={() => { setNumber((current) => current.slice(0, -1)); setError(""); }}
              aria-label="Delete digit"
              className="group mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/80 bg-white/85 text-slate-500 shadow-[0_6px_18px_rgba(15,23,42,0.07),inset_0_1px_0_rgba(255,255,255,0.95)] backdrop-blur-xl transition-all duration-150 hover:-translate-y-0.5 hover:text-rose-500 hover:shadow-[0_12px_30px_rgba(225,29,72,0.14)] active:translate-y-0 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Delete className="h-5 w-5" />
            </button>
          </div>

          {!canCall && status !== "ready" && !active ? (
            <p className="mt-4 rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-2.5 text-xs leading-5 text-amber-800">
              The softphone is not ready to place calls. {status === "unconfigured" ? "Connect Twilio calling in Settings first." : "Wait for the softphone to register."}
            </p>
          ) : !canCall && digitsCount > 0 && digitsCount < 7 && !active ? (
            <p className="mt-4 text-center text-xs font-medium text-slate-400">Enter {7 - digitsCount} more digit{7 - digitsCount === 1 ? "" : "s"} to enable calling</p>
          ) : null}
        </div>
      </div>

      {/* Quick tips */}
      <div className="relative w-full max-w-md overflow-hidden rounded-[2.25rem] border border-slate-800/70 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 p-6 text-white shadow-[0_18px_55px_rgba(15,23,42,0.25)]">
        <div className="pointer-events-none absolute -right-14 -top-16 h-48 w-48 rounded-full bg-sky-500/20 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-16 -left-14 h-48 w-48 rounded-full bg-indigo-500/20 blur-3xl" aria-hidden="true" />
        <div className="relative">
          <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-emerald-400 backdrop-blur"><PhoneCall className="h-4 w-4" /></span><h3 className="text-sm font-semibold">Quick tips</h3></div>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
            <li className="flex gap-2.5"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />Calls are placed through your Twilio number and appear in History automatically.</li>
            <li className="flex gap-2.5"><BookUser className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />Use the Address book tab to find a client or lead and call them with one tap.</li>
            <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />North American 10-digit numbers are dialed as +1 automatically.</li>
            <li className="flex gap-2.5"><RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />Answered calls are recorded if recording is enabled on your Twilio account.</li>
          </ul>
        </div>
      </div>
    </div>
  );
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
  const withPhone = (row) => String(row.phone || "").replace(/\D/g, "").length >= 7;

  return (
    <div className={panel}>
      <div className="border-b border-slate-200 p-5 sm:p-6">
        <div className="flex items-center gap-2"><BookUser className="h-4 w-4 text-sky-600" /><h3 className="text-sm font-semibold text-slate-900">Address book</h3></div>
        <p className="mt-1 text-xs leading-5 text-slate-500">Clients and open leads with phone numbers. New clients and leads appear here automatically.</p>
        <div className="relative mt-4"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className={`${input} pl-9`} placeholder="Search by name, number, or reference" /></div>
      </div>

      {error ? <div className="m-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="space-y-3 p-5">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-2xl bg-slate-100" />)}</div> : (
        <div className="max-h-[32rem] overflow-y-auto">
          {!clients.length && !leads.length ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 text-sky-600"><UserRoundPlus className="h-6 w-6" /></div>
              <p className="mt-4 text-base font-semibold text-slate-900">{search ? "No matching contacts" : "No contacts with phone numbers yet"}</p>
              <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">{search ? "Try a different name or number." : "Contacts with phone numbers will appear here as clients and leads are added."}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {clients.map((client) => (
                <ContactRow key={`c:${client.id}`} row={client} kind="Client" reference={client.clientNumber} onCall={withPhone(client) ? () => onPick(client.phone, client.fullName) : null} />
              ))}
              {leads.map((lead) => (
                <ContactRow key={`l:${lead.id}`} row={lead} kind="Lead" reference={lead.leadNumber} onCall={withPhone(lead) ? () => onPick(lead.phone, lead.fullName) : null} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContactRow({ row, kind, reference, onCall }) {
  const phone = String(row.phone || "");
  const short = phone.length > 12 ? `${phone.slice(0, 2)} ${phone.slice(2)}` : phone;
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-sky-50/40 sm:px-6">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase ${kind === "Client" ? "bg-indigo-50 text-indigo-600" : "bg-emerald-50 text-emerald-600"}`}>{kind.slice(0, 1)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{row.fullName || reference}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{kind} · {reference || ""}{phone ? ` · ${short}` : ""}</p>
      </div>
      {onCall ? (
        <button type="button" onClick={onCall} className="inline-flex h-9 items-center gap-2 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white transition hover:bg-slate-800 active:scale-[0.97]"><Phone className="h-3.5 w-3.5" />Call</button>
      ) : (
        <span className="text-[11px] font-semibold text-slate-400">No phone</span>
      )}
    </div>
  );
}

export default function CallsPage() {
  const { role } = useAuth();
  const { status, dial } = useSoftphone();
  const [tab, setTab] = useState("history");
  const [dialpadNumber, setDialpadNumber] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");

  const pickFromAddressBook = (number, name) => {
    setDialpadNumber(String(number || "").replace(/[^\d+]/g, ""));
    setTab("dialpad");
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
    <section className="space-y-6 pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-600"><PhoneCall className="h-4 w-4" />Twilio calling</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">Call center</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Call clients and leads straight from your browser. Incoming calls ring this workspace, and every call lands in one shared history.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProviderPill />
          {role === "admin" ? (
            <>
              <button type="button" disabled={syncing} onClick={syncHistory} className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />Sync history</button>
              <Link to="/app/settings?section=agency-phone" className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"><Settings2 className="h-4 w-4" />Settings</Link>
            </>
          ) : null}
        </div>
      </header>

      {syncNotice ? <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">{syncNotice}</div> : null}

      <div className="flex flex-wrap gap-1 rounded-2xl bg-slate-100 p-1 sm:w-fit">
        {[["history", "History", History], ["dialpad", "Dialpad", PhoneCall], ["address-book", "Address book", BookUser]].map(([value, label, Icon]) => (
          <button key={value} type="button" onClick={() => setTab(value)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${tab === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}><Icon className="h-4 w-4" />{label}</button>
        ))}
      </div>

      {tab === "history" ? <CallHistorySection /> : null}
      {tab === "dialpad" ? (
        <div className="flex items-center justify-center lg:min-h-[calc(100vh-19rem)]">
          <Dialpad initialNumber={dialpadNumber} />
        </div>
      ) : null}
      {tab === "address-book" ? <AddressBook onPick={pickFromAddressBook} /> : null}

      {status !== "ready" ? (
        <div className="flex items-start gap-3 rounded-3xl border border-amber-200 bg-amber-50/70 px-5 py-4 text-sm leading-6 text-amber-900">
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
