import {
  BookUser,
  CheckCircle2,
  Clipboard,
  Delete,
  History,
  Keyboard,
  Loader2,
  Phone,
  PhoneCall,
  PhoneOff,
  RefreshCw,
  Search,
  Settings2,
  UserRoundPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useSoftphone } from "../components/calls/SoftphoneProvider";
import { openGlobalDialpad } from "../components/calls/GlobalDialpad";
import api from "../services/api";
import { CallHistorySection } from "./OomaCallsPage";

const panel = "overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/90 shadow-[0_18px_50px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70 backdrop-blur-xl";
const input = "h-11 w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100/70";

const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

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

const KEY_LETTERS = { 2: "ABC", 3: "DEF", 4: "GHI", 5: "JKL", 6: "MNO", 7: "PQRS", 8: "TUV", 9: "WXYZ" };

function Dialpad({ initialNumber = "", open, onClose }) {
  const { dial, active, status } = useSoftphone();
  const [number, setNumber] = useState(initialNumber);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const panelRef = useRef(null);

  useEffect(() => {
    if (initialNumber) setNumber(initialNumber);
  }, [initialNumber]);

  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.focus();
    const handleKeyDown = (event) => {
      const target = event.target;
      const isEditing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
      if (isEditing) return;
      if (/^[0-9*#]$/.test(event.key)) {
        event.preventDefault();
        setError("");
        setNumber((current) => (current.length < 20 ? `${current}${event.key}` : current));
      } else if (event.key === "Backspace") {
        event.preventDefault();
        setError("");
        setNumber((current) => current.slice(0, -1));
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

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

  useEffect(() => {
    if (!open) return undefined;
    const handleCallShortcut = (event) => {
      const target = event.target;
      const isEditing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
      if (event.key === "Enter" && !isEditing && canCall) {
        event.preventDefault();
        void startCall();
      }
    };
    window.addEventListener("keydown", handleCallShortcut);
    return () => window.removeEventListener("keydown", handleCallShortcut);
  }, [open, canCall, number]);

  if (!open) return null;

  return (
    <aside ref={panelRef} tabIndex={-1} className="fixed bottom-24 right-4 z-[80] w-[calc(100%-2rem)] max-w-[21rem] outline-none sm:bottom-6 sm:right-24" role="dialog" aria-modal="false" aria-label="Phone dialpad">
      <div className="relative w-full overflow-hidden rounded-[2rem] border border-slate-200/80 bg-gradient-to-b from-white via-sky-50/60 to-slate-50 shadow-[0_28px_80px_rgba(15,23,42,0.2)] backdrop-blur-xl">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-sky-200/40 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-indigo-200/30 blur-3xl" aria-hidden="true" />

        <div className="relative p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-600">Browser phone</p>
              <h3 className="mt-0.5 text-lg font-semibold tracking-[-0.02em] text-slate-950">New call</h3>
            </div>
            <div className="flex items-center gap-2">{active ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/70 bg-emerald-50/90 px-3 py-1.5 text-xs font-semibold text-emerald-700"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />On a call</span>
            ) : null}<button type="button" onClick={onClose} aria-label="Close dialpad" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-slate-500 shadow-sm transition hover:bg-white hover:text-slate-900"><X className="h-4 w-4" /></button></div>
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
          <div className="mt-4 grid grid-cols-3 gap-x-2 gap-y-2">
            {KEYPAD.map((key) => {
              const letters = KEY_LETTERS[key];
              const subtitle = key === "0" ? "+" : letters || "";
              return (
                <button
                  key={key}
                  type="button"
                  disabled={active}
                  onClick={() => press(key)}
                  className="group relative mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/80 bg-white/90 shadow-[0_5px_15px_rgba(15,23,42,0.07)] transition-all duration-150 hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_10px_24px_rgba(14,165,233,0.18)] active:translate-y-0 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
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
          <div className="mt-4 grid grid-cols-3 gap-x-2">
            <button
              type="button"
              disabled={active}
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

          <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] font-medium text-slate-400"><Keyboard className="h-3.5 w-3.5" />Type digits · Enter to call · Esc to close</div>
          {!canCall && status !== "ready" && !active ? (
            <p className="mt-4 rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-2.5 text-xs leading-5 text-amber-800">
              The softphone is not ready to place calls. {status === "unconfigured" ? "Connect Twilio calling in Settings first." : "Wait for the softphone to register."}
            </p>
          ) : !canCall && digitsCount > 0 && digitsCount < 7 && !active ? (
            <p className="mt-4 text-center text-xs font-medium text-slate-400">Enter {7 - digitsCount} more digit{7 - digitsCount === 1 ? "" : "s"} to enable calling</p>
          ) : null}
        </div>
      </div>
    </aside>
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
  const total = clients.length + leads.length;
  const withPhone = (row) => String(row.phone || "").replace(/\D/g, "").length >= 7;

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
    <div className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-slate-50 sm:px-6">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${kind === "Client" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"}`} aria-hidden="true">{kind.slice(0, 1)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{row.fullName || reference}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{kind} · {reference || ""}{phone ? ` · ${short}` : ""}</p>
      </div>
      {onCall ? (
        <button type="button" onClick={onCall} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#007AFF] px-4 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(0,122,255,0.22)] transition hover:bg-[#0873df] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"><Phone className="h-3.5 w-3.5" aria-hidden="true" />Call</button>
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
        {[["history", "History", History], ["address-book", "Address book", BookUser]].map(([value, label, Icon]) => (
          <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:flex-none ${tab === value ? "bg-white text-slate-950 shadow-[0_2px_8px_rgba(15,23,42,0.12)]" : "text-slate-500 hover:text-slate-900"}`}><Icon className="h-4 w-4" aria-hidden="true" />{label}</button>
        ))}
      </nav>

      <div>{tab === "history" ? <CallHistorySection provider="TWILIO" /> : <AddressBook onPick={pickFromAddressBook} />}</div>

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
