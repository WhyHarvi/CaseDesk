import { Device } from "@twilio/voice-sdk";
import { CheckCircle2, CircleAlert, Clock3, Loader2, Phone, PhoneIncoming, PhoneOff, UserRoundSearch, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import api from "../../services/api";

const SoftphoneContext = createContext(null);

function normalizeE164(value) {
  const digits = String(value || "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function formatNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return value || "";
}

function CallerName({ from, onDone }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const digits = String(from || "").replace(/\D/g, "");
    if (!digits) return undefined;
    let active = true;
    setBusy(true);
    api
      .get(`/twilio-calls/address-book?search=${encodeURIComponent(digits)}`, { cache: false })
      .then((response) => {
        if (!active) return;
        const data = response.data?.data || {};
        const client = (data.clients || []).find((row) => String(row.phone || "").replace(/\D/g, "") === digits);
        const lead = (data.leads || []).find((row) => String(row.phone || "").replace(/\D/g, "") === digits);
        const matched = client?.fullName || lead?.fullName || "";
        if (matched) setName(matched);
        onDone?.(matched);
      })
      .catch(() => {})
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [from, onDone]);
  if (name) return <p className="truncate text-base font-semibold text-slate-950">{name}</p>;
  if (busy) return <p className="h-5 w-32 animate-pulse rounded-full bg-slate-200" />;
  return null;
}

const OUTCOMES = [
  ["COMPLETED", "Completed"],
  ["FOLLOW_UP_REQUIRED", "Follow-up required"],
  ["NO_ANSWER", "No answer"],
  ["BUSY", "Busy"],
  ["VOICEMAIL", "Voicemail left"],
  ["WRONG_NUMBER", "Wrong number"],
  ["NOT_INTERESTED", "Not interested"],
  ["OTHER", "Other"],
];

const input = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100";

// Bottom-right, same corner as the global dialpad (z-[390]) and chat widget
// (z-[410]) — but stacked above both (z-[420]) and offset high enough
// (bottom-24) to clear their ~80px collapsed footprint, instead of hiding
// underneath them (the original bug) or living on the left over page
// content (tried once, was in the way of whatever the page was showing).
const FLOATING_CALL_CARD_POSITION = "fixed bottom-24 right-5 z-[420] w-[calc(100%-2.5rem)] max-w-sm";

function toLocalDateTimeInput(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SoftphoneProvider({ children }) {
  const { appUser } = useAuth();
  const deviceRef = useRef(null);
  const tokenRefreshInFlight = useRef(false);
  const dialContextRef = useRef({}); // record context passed to dial(), read back when the call ends
  const callStartedAtRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | registering | ready | error | unconfigured
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState(false);
  const [incoming, setIncoming] = useState(null); // { call, from }
  const [active, setActive] = useState(null); // { call, number, direction, leadId?, leadName? }
  const [muted, setMuted] = useState(false);
  // { number, callSid, durationSeconds, leadId, leadName, clientId, clientName }
  // set when an OUTBOUND call we placed ends — the trigger for the follow-up
  // popup. Incoming calls never set it: their activity is recorded server-side
  // and the user only ever gets this popup for calls we placed.
  const [endedCall, setEndedCall] = useState(null);
  const ringContextRef = useRef(null);
  const ringTimerRef = useRef(null);

  const stopRingtone = useCallback(() => {
    if (ringTimerRef.current) {
      window.clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
    const context = ringContextRef.current;
    ringContextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }, []);

  // Synthesizes the incoming-call ring instead of bundling an audio asset —
  // 440Hz + 480Hz is the actual North American ring-tone frequency pair,
  // played 2s on / 2s off, repeating until the call is accepted, declined,
  // or the caller hangs up first.
  const playRingtone = useCallback(() => {
    stopRingtone();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    let context;
    try {
      context = new AudioContextClass();
    } catch {
      return;
    }
    ringContextRef.current = context;
    const ringCycle = () => {
      if (ringContextRef.current !== context || context.state === "closed") return;
      if (context.state === "suspended") void context.resume().catch(() => {});
      const startAt = context.currentTime + 0.02;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.11, startAt + 0.06);
      gain.gain.setValueAtTime(0.11, startAt + 1.85);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 2);
      gain.connect(context.destination);
      [440, 480].forEach((frequency) => {
        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start(startAt);
        oscillator.stop(startAt + 2);
      });
      ringTimerRef.current = window.setTimeout(ringCycle, 4000);
    };
    ringCycle();
  }, [stopRingtone]);

  const refreshToken = useCallback(async (device) => {
    if (tokenRefreshInFlight.current || !device) return;
    tokenRefreshInFlight.current = true;
    try {
      const response = await api.post("/twilio-calls/token");
      device.updateToken(response.data?.data?.token);
    } catch {
      // Token refresh is best-effort — the device will re-register on the next
      // page load if the old token fully expires.
    } finally {
      tokenRefreshInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!appUser?.id) return undefined;
    let disposed = false;
    let device = null;
    setStatus("registering");
    setError("");

    api
      .post("/twilio-calls/token")
      .then((response) => {
        if (disposed) return null;
        const token = response.data?.data?.token;
        if (!token) return null;
        device = new Device(token, { logLevel: 1, allowIncomingWhileBusy: true });
        deviceRef.current = device;
        device.on("registered", () => { if (!disposed) { setRegistered(true); setStatus("ready"); } });
        device.on("unregistered", () => { if (!disposed) setRegistered(false); });
        device.on("error", (deviceError) => {
          if (disposed) return;
          const message = deviceError?.message || String(deviceError || "Softphone error");
          if (!message.toLowerCase().includes("token") || status !== "ready") {
            setError(message);
          }
        });
        device.on("tokenWillExpire", (target) => void refreshToken(target));
        device.on("incoming", (call) => {
          if (disposed) return;
          const from = call.parameters?.From || call.customParameters?.From || "";
          setIncoming({ call, from });
          playRingtone();
          call.on("cancel", () => { stopRingtone(); setIncoming((current) => (current?.call === call ? null : current)); });
          call.on("reject", () => { stopRingtone(); setIncoming((current) => (current?.call === call ? null : current)); });
          call.on("disconnect", () => {
            stopRingtone();
            setIncoming((current) => (current?.call === call ? null : current));
            setActive((current) => (current?.call === call ? null : current));
            setMuted(false);
          });
        });
        return device.register();
      })
      .then(() => {
        if (disposed) return;
      })
      .catch((reason) => {
        if (disposed) return;
        const message = reason?.response?.data?.message || reason?.message || "The softphone could not be started.";
        const unconfigured = reason?.response?.status === 409;
        setError(message);
        setStatus(unconfigured ? "unconfigured" : "error");
      });

    return () => {
      disposed = true;
      deviceRef.current = null;
      stopRingtone();
      if (device) {
        device.removeAllListeners();
        device.destroy();
      }
    };
  }, [appUser?.id, refreshToken, playRingtone, stopRingtone]);

  const dial = useCallback(async (number, context = {}) => {
    const target = normalizeE164(number);
    if (!target) throw new Error("Enter a phone number to call.");
    const device = deviceRef.current;
    if (!device || !registered) throw new Error("The softphone is not registered. Check the Twilio connection in Settings.");
    if (active) throw new Error("A call is already in progress. Hang up first.");
    // The record ids ride as custom params to the TwiML Application, which
    // forwards them to the status callbacks so the session links to the
    // lead/client even before (or without) the outcome popup being saved.
    const call = await device.connect({
      params: {
        To: target,
        ...(context.leadId ? { leadId: context.leadId } : {}),
        ...(context.clientId ? { clientId: context.clientId } : {}),
      },
    });
    dialContextRef.current = context || {};
    callStartedAtRef.current = Date.now();
    setActive({ call, number: target, direction: "OUTBOUND", ...(context || {}) });
    setMuted(false);
    const finish = (showPopup) => {
      const durationSeconds = callStartedAtRef.current ? Math.max(1, Math.round((Date.now() - callStartedAtRef.current) / 1000)) : 1;
      callStartedAtRef.current = null;
      setActive((current) => (current?.call === call ? null : current));
      setMuted(false);
      if (showPopup) {
        setEndedCall({ number: target, callSid: call.parameters?.CallSid || "", durationSeconds, ...dialContextRef.current });
        dialContextRef.current = {};
      }
    };
    call.on("disconnect", () => finish(true));
    call.on("cancel", () => finish(false));
    return call;
  }, [active, registered]);

  const accept = useCallback(() => {
    setIncoming((current) => {
      if (!current) return null;
      stopRingtone();
      current.call.accept();
      setActive({ call: current.call, number: current.from, direction: "INBOUND" });
      setMuted(false);
      return null;
    });
  }, [stopRingtone]);

  const reject = useCallback(() => {
    setIncoming((current) => {
      if (!current) return null;
      stopRingtone();
      current.call.reject();
      return null;
    });
  }, [stopRingtone]);

  const hangup = useCallback(() => {
    stopRingtone();
    if (active?.call) active.call.disconnect();
    if (incoming?.call) incoming.call.disconnect();
    setActive(null);
    setIncoming(null);
    setMuted(false);
  }, [active, incoming, stopRingtone]);

  const toggleMute = useCallback(() => {
    if (!active?.call) return;
    const next = !muted;
    try { active.call.mute(next); } catch { /* muted state is cosmetic if the call rejects it */ }
    setMuted(next);
  }, [active, muted]);

  const value = useMemo(
    () => ({
      status,
      error,
      registered,
      incoming,
      active,
      muted,
      dial,
      accept,
      reject,
      hangup,
      toggleMute,
      normalizeE164,
    }),
    [status, error, registered, incoming, active, muted, dial, accept, reject, hangup, toggleMute],
  );

  return (
    <SoftphoneContext.Provider value={value}>
      {children}
      {incoming ? (
        <IncomingCallCard key={incoming.call?.parameters?.CallSid || incoming.from} incoming={incoming} onAccept={accept} onReject={reject} />
      ) : null}
      {endedCall && !active && !incoming ? <EndedCallCard ended={endedCall} onClose={() => setEndedCall(null)} /> : null}
    </SoftphoneContext.Provider>
  );
}

function IncomingCallCard({ incoming, onAccept, onReject }) {
  const [callerName, setCallerName] = useState("");
  const from = incoming.from;
  return (
    <aside className={`${FLOATING_CALL_CARD_POSITION} overflow-hidden rounded-3xl border border-emerald-200/80 bg-white/95 shadow-[0_24px_80px_rgba(5,150,105,0.24)] backdrop-blur-xl`} role="dialog" aria-modal="true" aria-label="Incoming call">
      <div className="h-1 bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-400" />
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/40" />
            <PhoneIncoming className="relative h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-600">Incoming call · Twilio</p>
            {callerName ? <p className="mt-1 truncate text-base font-semibold text-slate-950">{callerName}</p> : <CallerName from={from} onDone={setCallerName} />}
            <p className="mt-0.5 truncate text-sm text-slate-500">{formatNumber(from) || "Private number"}</p>
          </div>
          <button type="button" onClick={onReject} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200" aria-label="Decline call"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onAccept} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(5,150,105,0.28)] transition hover:bg-emerald-500 active:scale-[0.98]"><Phone className="h-4 w-4" />Accept</button>
          <button type="button" onClick={onReject} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-rose-600 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(225,29,72,0.28)] transition hover:bg-rose-500 active:scale-[0.98]"><PhoneOff className="h-4 w-4" />Decline</button>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-2xl bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800"><UserRoundSearch className="h-4 w-4 shrink-0" />Answering will ring your microphone and speaker through the browser.</div>
      </div>
    </aside>
  );
}

function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

// Shown when a call WE placed ends — the user captures the call outcome and
// note here. Details are autofilled from the just-ended call; saving routes
// through the same outcome path as the Calls page drawer. Incoming calls
// never render this (their activity is recorded server-side automatically).
function EndedCallCard({ ended, onClose }) {
  const { appUser } = useAuth();
  const [outcome, setOutcome] = useState("COMPLETED");
  const [notes, setNotes] = useState("");
  const [addFollowUp, setAddFollowUp] = useState(false);
  const [dueAt, setDueAt] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 60 * 60 * 1000)));
  const [assignedUserId, setAssignedUserId] = useState(appUser?.id || "");
  const [description, setDescription] = useState("Follow up after call");
  const [staff, setStaff] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!addFollowUp) return undefined;
    let active = true;
    api
      .get("/twilio-calls/staff", { cache: false })
      .then((response) => {
        if (!active) return;
        const people = response.data?.data || [];
        setStaff(people);
        setAssignedUserId((current) => current || people[0]?.id || "");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [addFollowUp]);

  const contactName = ended.leadName || ended.clientName || formatNumber(ended.number) || "Unknown contact";
  const canSave = Boolean(ended.callSid) && !busy;

  const save = async () => {
    try {
      setBusy(true);
      setError("");
      await api.post("/twilio-calls/outcome", {
        providerCallId: ended.callSid,
        leadId: ended.leadId,
        clientId: ended.clientId,
        remoteNumber: ended.number,
        durationSeconds: ended.durationSeconds,
        outcome,
        notes,
        ...(addFollowUp ? { nextFollowUp: { dueAt: new Date(dueAt).toISOString(), description, assignedUserId } } : {}),
      });
      setSaved(true);
      window.setTimeout(onClose, 900);
    } catch (reason) {
      setError(reason?.response?.data?.message || reason?.message || "The outcome could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className={`${FLOATING_CALL_CARD_POSITION} overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-[0_24px_80px_rgba(15,23,42,0.22)] backdrop-blur-xl`} role="dialog" aria-modal="true" aria-label="Call ended — record outcome">
      <div className="h-1 bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-400" />
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white"><PhoneOff className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Call ended · you called</p>
            <p className="mt-1 truncate text-base font-semibold text-slate-950">{contactName}</p>
            <p className="mt-0.5 truncate text-xs text-slate-500">{formatNumber(ended.number)}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
        </div>

        <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Duration</p><p className="mt-1 flex items-center gap-1.5 text-sm font-semibold tabular-nums text-slate-800"><Clock3 className="h-3.5 w-3.5 text-slate-400" />{formatDuration(ended.durationSeconds)}</p></div>

        <div className="mt-3">
          <label className="text-xs font-semibold text-slate-600">Outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value)} className={`${input} mt-1.5`}>{OUTCOMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="mt-3 block text-xs font-semibold text-slate-600">Note<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100" placeholder="What happened on the call? Next steps, questions asked…" /></label>
        </div>

        {/* Follow-ups are a lead concept — client calls record the outcome on the call and the client's communication thread instead. */}
        {ended.leadId ? (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
            <label className="flex items-center gap-2.5 text-xs font-semibold text-slate-700"><input type="checkbox" checked={addFollowUp} onChange={(event) => setAddFollowUp(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-sky-600" />Create a follow-up</label>
            {addFollowUp ? (
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <label className="text-[11px] font-semibold text-slate-500">Due<input required type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className={`${input} mt-1 h-9 text-xs`} /></label>
                <label className="text-[11px] font-semibold text-slate-500">Assigned to<select required value={assignedUserId} onChange={(event) => setAssignedUserId(event.target.value)} className={`${input} mt-1 h-9 text-xs`}><option value="">Select</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></label>
                <label className="text-[11px] font-semibold text-slate-500 sm:col-span-2">Instruction<input required value={description} onChange={(event) => setDescription(event.target.value)} className={`${input} mt-1 h-9 text-xs`} /></label>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="mt-3 flex items-start gap-1.5 rounded-2xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p> : null}
        {saved ? <p className="mt-3 flex items-center gap-1.5 rounded-2xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Outcome saved to the lead.</p> : null}

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="inline-flex h-10 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 transition hover:bg-slate-50">Dismiss</button>
          <button type="button" disabled={!canSave} onClick={save} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.28)] transition hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save</button>
        </div>
      </div>
    </aside>
  );
}

export function useSoftphone() {
  const value = useContext(SoftphoneContext);
  if (!value) throw new Error("useSoftphone must be used inside SoftphoneProvider");
  return value;
}
