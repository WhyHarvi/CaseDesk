import { ArrowLeftRight, BatteryFull, Circle, Clipboard, Delete, Grid3x3, Keyboard, Loader2, Mic, MicOff, Phone, PhoneCall, PhoneOff, Search, StickyNote, Wifi, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import useAnyCurtainOpen from "../../hooks/useAnyCurtainOpen";
import useDebouncedAutosave from "../../hooks/useDebouncedAutosave";
import api from "../../services/api";
import Select from "../ui/Select";
import { useSoftphone } from "./SoftphoneProvider";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const LETTERS = { 2: "ABC", 3: "DEF", 4: "GHI", 5: "JKL", 6: "MNO", 7: "PQRS", 8: "TUV", 9: "WXYZ" };
const DTMF = {
  1: [697, 1209], 2: [697, 1336], 3: [697, 1477],
  4: [770, 1209], 5: [770, 1336], 6: [770, 1477],
  7: [852, 1209], 8: [852, 1336], 9: [852, 1477],
  "*": [941, 1209], 0: [941, 1336], "#": [941, 1477],
};
const phoneMatchKey = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

export function openGlobalDialpad(number = "", context = {}) {
  window.dispatchEvent(new CustomEvent("casedesk:open-dialpad", { detail: { number, context } }));
}

export default function GlobalDialpad() {
  const location = useLocation();
  const curtainOpen = useAnyCurtainOpen();
  const { dial, active, status, muted, toggleMute, hangup, sendDigits, outboundNumbers, selectedOutboundNumber, selectOutboundNumber } = useSoftphone();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [dialContext, setDialContext] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [online, setOnline] = useState(() => navigator.onLine);
  const [battery, setBattery] = useState(null);
  const [callSeconds, setCallSeconds] = useState(0);
  const [showCallKeypad, setShowCallKeypad] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferNotice, setTransferNotice] = useState("");
  const [transferError, setTransferError] = useState("");
  const [recordingSid, setRecordingSid] = useState("");
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingError, setRecordingError] = useState("");
  const [showCallNotes, setShowCallNotes] = useState(false);
  const [linkedRecord, setLinkedRecord] = useState(null); // { type: "lead" | "client", id, name } | null
  const [linkedRecordLoading, setLinkedRecordLoading] = useState(false);
  const [callNoteText, setCallNoteText] = useState("");
  const [callNoteId, setCallNoteId] = useState("");
  const [callNoteSavedText, setCallNoteSavedText] = useState("");
  const [callNoteSaving, setCallNoteSaving] = useState(false);
  const [callNoteError, setCallNoteError] = useState("");
  const panelRef = useRef(null);
  const audioRef = useRef(null);
  const deleteHoldTimerRef = useRef(null);
  const deleteHoldTriggeredRef = useRef(false);
  const zeroHoldTimerRef = useRef(null);
  const zeroHoldTriggeredRef = useRef(false);

  const close = useCallback(() => setOpen(false), []);
  const digits = number.replace(/\D/g, "");
  const canCall = status === "ready" && digits.length >= 7 && !active && !busy;
  const time = useMemo(() => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(now), [now]);
  const display = useMemo(() => {
    if (!digits) return "";
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
  }, [digits]);
  const activeNumber = useMemo(() => {
    const value = String(active?.number || "");
    const valueDigits = value.replace(/\D/g, "");
    if (valueDigits.length === 11 && valueDigits.startsWith("1")) return `+1 (${valueDigits.slice(1, 4)}) ${valueDigits.slice(4, 7)}-${valueDigits.slice(7)}`;
    if (valueDigits.length === 10) return `(${valueDigits.slice(0, 3)}) ${valueDigits.slice(3, 6)}-${valueDigits.slice(6)}`;
    return value || "Connecting…";
  }, [active?.number]);
  const callTime = `${String(Math.floor(callSeconds / 60)).padStart(2, "0")}:${String(callSeconds % 60).padStart(2, "0")}`;
  const callConnected = active?.phase === "connected" && Boolean(active?.connectedAt);
  const callStatusLabel = callConnected
    ? "Call in progress"
    : active?.phase === "ringing"
      ? "Ringing…"
      : "Connecting…";

  const startCall = useCallback(async () => {
    if (!canCall) return;
    try {
      setBusy(true);
      setError("");
      await dial(number, dialContext);
      // Stay open (rather than collapsing back to the pill) so placing a
      // call flows straight into the in-call screen below — the "active
      // call should also be visible" ask, not just reachable by re-opening.
      setNumber("");
      setDialContext({});
    } catch (reason) {
      setError(reason?.message || "The call could not be placed.");
    } finally {
      setBusy(false);
    }
  }, [canCall, dial, dialContext, number]);

  const warmAudio = useCallback(() => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      const existing = audioRef.current;
      let context = existing && existing.state !== "closed" ? existing : null;
      if (!context) {
        try { context = new AudioContext({ latencyHint: "interactive" }); }
        catch { context = new AudioContext(); }
      }
      audioRef.current = context;
      if (context.state === "suspended") void context.resume().catch(() => {});
      return context;
    } catch {
      return null;
    }
  }, []);

  const playTone = useCallback((key) => {
    const frequencies = DTMF[key];
    if (!frequencies) return;
    try {
      const context = warmAudio();
      if (!context) return;
      const startAt = context.currentTime + 0.004;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.045, startAt);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.11);
      gain.connect(context.destination);
      frequencies.forEach((frequency) => {
        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.12);
      });
    } catch { /* Audio feedback is optional when the browser blocks it. */ }
  }, [warmAudio]);

  const pressKey = useCallback((key) => {
    playTone(key);
    setNumber((current) => current.length < 20 ? current + key : current);
  }, [playTone]);

  // Standard phone-dialer behavior: a quick tap on 0 enters "0"; holding it
  // enters "+" instead (never both) — decided at release/threshold like the
  // delete key's hold-to-clear below, not on press, so a tap doesn't add "0"
  // before a hold has a chance to turn it into "+".
  const startZeroHold = useCallback(() => {
    zeroHoldTriggeredRef.current = false;
    if (zeroHoldTimerRef.current) window.clearTimeout(zeroHoldTimerRef.current);
    zeroHoldTimerRef.current = window.setTimeout(() => {
      zeroHoldTriggeredRef.current = true;
      zeroHoldTimerRef.current = null;
      playTone("0");
      setNumber((current) => (current.length < 20 ? `${current}+` : current));
    }, 550);
  }, [playTone]);

  const stopZeroHold = useCallback(() => {
    if (!zeroHoldTimerRef.current) return;
    window.clearTimeout(zeroHoldTimerRef.current);
    zeroHoldTimerRef.current = null;
  }, []);

  const releaseZero = useCallback(() => {
    stopZeroHold();
    if (zeroHoldTriggeredRef.current) {
      zeroHoldTriggeredRef.current = false;
      return;
    }
    pressKey("0");
  }, [pressKey, stopZeroHold]);

  // Sends a DTMF tone into the live call (e.g. for an IVR menu) instead of
  // building up the number-to-dial — the in-call keypad is a different mode
  // from the pre-call dial screen, even though it reuses the same key grid.
  const sendCallDigit = useCallback((key) => {
    playTone(key);
    sendDigits(key);
  }, [playTone, sendDigits]);

  const startTransfer = useCallback(async (targetId, targetName) => {
    try {
      setTransferring(true);
      setTransferError("");
      setTransferNotice("");
      const callSid = active?.callSid || "";
      await api.post("/twilio-calls/transfer", { to: targetId, callSid });
      setTransferOpen(false);
      setTransferNotice(`Transferred to ${targetName}.`);
    } catch (reason) {
      setTransferError(reason?.response?.data?.message || reason?.message || "The transfer could not be completed.");
    } finally {
      setTransferring(false);
    }
  }, [active]);

  // Recording is off by default — this is the opt-in the person on the call
  // controls per call. Starting only captures audio from this point on, not
  // retroactively, so toggling it mid-call is expected, not a limitation.
  const toggleRecording = useCallback(async () => {
    const callSid = active?.callSid || "";
    if (!callSid) {
      setRecordingError("The call is still connecting. Try recording again in a moment.");
      return;
    }
    try {
      setRecordingBusy(true);
      setRecordingError("");
      if (recordingSid) {
        await api.post("/twilio-calls/recording/stop", { callSid, recordingSid });
        setRecordingSid("");
      } else {
        const response = await api.post("/twilio-calls/recording/start", { callSid });
        setRecordingSid(response.data?.data?.recordingSid || "");
      }
    } catch (reason) {
      setRecordingError(reason?.response?.data?.message || reason?.message || "The recording could not be updated.");
    } finally {
      setRecordingBusy(false);
    }
  }, [active, recordingSid]);

  // Who to save call notes against. A call placed from a Lead/Client record
  // already carries that id in context; an inbound call doesn't, so it's
  // resolved the same way the caller-name lookup already works — by
  // matching the remote number against the address book. Re-resolves per
  // call (keyed on callSid) rather than once, since a new call may be with
  // someone different.
  useEffect(() => {
    if (!active) { setLinkedRecord(null); setLinkedRecordLoading(false); return undefined; }
    if (active.leadId) { setLinkedRecord({ type: "lead", id: active.leadId, name: active.leadName || "" }); setLinkedRecordLoading(false); return undefined; }
    if (active.clientId) { setLinkedRecord({ type: "client", id: active.clientId, name: active.clientName || "" }); setLinkedRecordLoading(false); return undefined; }
    const digits = String(active.number || "").replace(/\D/g, "");
    if (!digits) { setLinkedRecord(null); setLinkedRecordLoading(false); return undefined; }
    let cancelled = false;
    const matchKey = phoneMatchKey(digits);
    setLinkedRecord(null);
    setLinkedRecordLoading(true);
    api.get(`/twilio-calls/address-book?search=${encodeURIComponent(matchKey)}`, { cache: false })
      .then((response) => {
        if (cancelled) return;
        const data = response.data?.data || {};
        const client = (data.clients || []).find((row) => phoneMatchKey(row.phoneNormalized || row.phone) === matchKey);
        const lead = (data.leads || []).find((row) => phoneMatchKey(row.phoneNormalized || row.phone) === matchKey);
        if (client) setLinkedRecord({ type: "client", id: client.id, name: client.fullName || "" });
        else if (lead) setLinkedRecord({ type: "lead", id: lead.id, name: lead.fullName || "" });
        else setLinkedRecord(null);
      })
      .catch(() => { if (!cancelled) setLinkedRecord(null); })
      .finally(() => { if (!cancelled) setLinkedRecordLoading(false); });
    return () => { cancelled = true; };
  }, [active?.callSid, active?.clientId, active?.leadId, active?.number]);

  const callNoteTarget = useMemo(() => {
    if (linkedRecord) return linkedRecord;
    if (!linkedRecordLoading && active?.callSid) return { type: "call", id: active.callSid, name: activeNumber };
    return null;
  }, [active?.callSid, activeNumber, linkedRecord, linkedRecordLoading]);

  // Saves straight to the lead's activity feed or the client's Notes — the
  // same endpoints and shapes LeadDetailSheet.jsx / ClientProfile.jsx
  // already use — so a note taken here shows up in the normal place, not a
  // call-specific side channel only visible from the phone. Autosaving to
  // the server (not just local state) is also what makes the draft survive
  // a refresh: nothing about it depends on the call itself still existing.
  const saveCallNote = useCallback(async () => {
    if (!callNoteTarget) return;
    const content = callNoteText.trim();
    if (!content) return;
    try {
      setCallNoteSaving(true);
      setCallNoteError("");
      const response = callNoteTarget.type === "lead"
        ? callNoteId
          ? await api.patch(`/leads/${callNoteTarget.id}/activities/${callNoteId}/note`, { description: content })
          : await api.post(`/leads/${callNoteTarget.id}/activities`, { activityType: "INTERNAL_NOTE", direction: "INTERNAL", channel: "SYSTEM", title: "Call note", description: content })
        : callNoteTarget.type === "client"
          ? callNoteId
            ? await api.patch(`/notes/${callNoteId}`, { clientId: callNoteTarget.id, content })
            : await api.post("/notes", { clientId: callNoteTarget.id, content })
          : await api.put("/twilio-calls/active-note", {
            callSid: active?.callSid,
            direction: active?.direction,
            remoteNumber: active?.number,
            notes: content,
          });
      setCallNoteId(response.data.data.id);
      setCallNoteSavedText(content);
    } catch (reason) {
      setCallNoteError(reason?.response?.data?.message || reason?.message || "The note could not be saved.");
    } finally {
      setCallNoteSaving(false);
    }
  }, [active?.callSid, active?.direction, active?.number, callNoteTarget, callNoteText, callNoteId]);

  useDebouncedAutosave({
    value: callNoteText,
    savedValue: callNoteSavedText,
    enabled: showCallNotes && Boolean(callNoteTarget) && !callNoteSaving,
    delay: 2000,
    onSave: saveCallNote,
  });

  // Collapses the panel back to the small idle pill the moment a call ends
  // (not on mount, and not if the panel was just opened to dial and never
  // connected — only a genuine active-to-inactive transition) so the
  // full-height dial screen doesn't sit open competing for the same corner
  // right when the call-outcome popup needs to appear.
  const wasActiveRef = useRef(false);
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = Boolean(active);
    if (active) return;
    setShowCallKeypad(false);
    setTransferOpen(false);
    setTransferNotice("");
    setTransferError("");
    setRecordingSid("");
    setRecordingError("");
    setShowCallNotes(false);
    setCallNoteText("");
    setCallNoteId("");
    setCallNoteSavedText("");
    setCallNoteError("");
    if (wasActive) setOpen(false);
  }, [active]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    const updateNetwork = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    let batteryManager;
    const updateBattery = () => setBattery(batteryManager ? Math.round(batteryManager.level * 100) : null);
    if (navigator.getBattery) navigator.getBattery().then((value) => {
      batteryManager = value;
      updateBattery();
      batteryManager.addEventListener("levelchange", updateBattery);
    }).catch(() => {});
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
      batteryManager?.removeEventListener("levelchange", updateBattery);
    };
  }, []);

  useEffect(() => {
    setCallSeconds(0);
    if (!callConnected) return undefined;
    const updateDuration = () => setCallSeconds(Math.max(0, Math.floor((Date.now() - Number(active.connectedAt)) / 1000)));
    updateDuration();
    const timer = window.setInterval(updateDuration, 1000);
    return () => window.clearInterval(timer);
  }, [active?.callSid, active?.connectedAt, callConnected]);

  useEffect(() => {
    const handleOpen = (event) => {
      warmAudio();
      const nextNumber = String(event.detail?.number || "").replace(/[^\d+*#]/g, "");
      if (nextNumber) setNumber(nextNumber);
      setDialContext(event.detail?.context || {});
      setError("");
      setOpen(true);
    };
    window.addEventListener("casedesk:open-dialpad", handleOpen);
    return () => window.removeEventListener("casedesk:open-dialpad", handleOpen);
  }, [warmAudio]);

  useEffect(() => {
    const handleKey = (event) => {
      const target = event.target;
      const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
      if (!open && !editing && event.key.toLowerCase() === "d" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        warmAudio();
        setOpen(true);
        return;
      }
      if (!open || editing) return;
      if (/^[0-9*#]$/.test(event.key)) {
        event.preventDefault();
        if (active) { if (showCallKeypad) sendCallDigit(event.key); }
        else pressKey(event.key);
      } else if (event.key === "Backspace" && !active) {
        event.preventDefault();
        setNumber((current) => current.slice(0, -1));
      } else if (event.key === "Escape" || event.key.toLowerCase() === "d") {
        event.preventDefault();
        close();
      } else if (event.key === "Enter" && canCall) {
        event.preventDefault();
        void startCall();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [active, canCall, close, open, pressKey, sendCallDigit, showCallKeypad, startCall, warmAudio]);

  useEffect(() => () => {
    const context = audioRef.current;
    if (context && context.state !== "closed") void context.close().catch(() => {});
    if (deleteHoldTimerRef.current) window.clearTimeout(deleteHoldTimerRef.current);
  }, []);

  useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("casedesk:phone-float-state", { detail: { open, active: Boolean(active) } }));
  }, [active, open]);

  const paste = async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error("Clipboard access is unavailable.");
      const value = String(await navigator.clipboard.readText()).replace(/[^\d+*#]/g, "").slice(0, 20);
      if (!value) {
        setError("Copy a phone number, then tap Paste number.");
        return;
      }
      setNumber(value);
      setError("");
    } catch {
      setError("Clipboard access was blocked. Allow clipboard access and try again.");
    }
  };

  const startDeleteHold = (event) => {
    if (event.button !== 0) return;
    deleteHoldTriggeredRef.current = false;
    if (deleteHoldTimerRef.current) window.clearTimeout(deleteHoldTimerRef.current);
    deleteHoldTimerRef.current = window.setTimeout(() => {
      deleteHoldTriggeredRef.current = true;
      deleteHoldTimerRef.current = null;
      setNumber("");
      setError("");
    }, 550);
  };

  const stopDeleteHold = () => {
    if (!deleteHoldTimerRef.current) return;
    window.clearTimeout(deleteHoldTimerRef.current);
    deleteHoldTimerRef.current = null;
  };

  const deleteDigit = () => {
    if (deleteHoldTriggeredRef.current) {
      deleteHoldTriggeredRef.current = false;
      return;
    }
    setNumber((current) => current.slice(0, -1));
    setError("");
  };

  // Hidden on the Chats page itself — same reasoning FloatingChatWidget
  // already applies there for the same reason (redundant with the page you're
  // already on). Also hidden behind any open curtain (client/case/appointment
  // side panels etc.) — their z-index values were never coordinated with
  // this button's, so it could otherwise float visibly on top of one. Never
  // hidden mid-call, though: navigating to Chats, or opening a curtain, while
  // on a live call must not strand the hang-up/mute controls.
  if ((location.pathname === "/app/chats" || curtainOpen) && !active) return null;

  if (!open) {
    return (
      <button type="button" onPointerDown={warmAudio} onClick={() => setOpen(true)} aria-label={active ? `${callStatusLabel} with ${activeNumber}${callConnected ? `, ${callTime}` : ""}` : "Open dialpad"} aria-keyshortcuts="D" className={`fixed bottom-6 right-6 z-[390] flex h-14 items-center rounded-full border border-white/10 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-1 active:translate-y-0 active:scale-95 max-sm:right-4 ${active ? "w-[19rem] max-w-[calc(100vw-2rem)] gap-3 bg-black px-3 shadow-[0_18px_45px_rgba(0,0,0,0.35)] hover:bg-zinc-900" : "w-14 justify-center bg-[#34c759] p-0 shadow-[0_10px_24px_rgba(15,23,42,0.2)] hover:bg-[#2fb350]"}`}>
        <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${active ? "bg-[#34c759]" : "bg-white/15"}`}>
          {active ? <span className="absolute inset-0 animate-ping rounded-full bg-[#34c759]/35" style={{ animationDuration: "2.2s" }} /> : null}
          <Phone className="relative h-4 w-4 fill-current" />
        </span>
        {active ? (
          <>
            <span className="min-w-0 flex-1 text-left"><span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-[#34c759]">{callStatusLabel}</span><span className="block truncate text-xs font-medium text-white">{activeNumber}</span></span>
            {callConnected ? <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-white">{callTime}</span> : null}
          </>
        ) : null}
      </button>
    );
  }

  return (
    <aside ref={panelRef} tabIndex={-1} role="dialog" aria-label="Phone dialpad" className="fixed bottom-6 right-6 z-[390] h-[min(48rem,calc(100vh-3rem))] w-[calc(100%-2rem)] max-w-[23rem] overflow-y-auto rounded-[3rem] border-[6px] border-zinc-800 bg-black text-white shadow-[0_32px_100px_rgba(0,0,0,0.55)] outline-none max-sm:bottom-24 max-sm:right-4 max-sm:h-[calc(100vh-7rem)]">
      <div className="relative flex min-h-full flex-col px-5 pb-5 pt-3">
        <div className="flex h-6 items-start justify-between px-2 text-[10px] font-semibold">
          <span className="pt-0.5 tabular-nums">{time}</span>
          <span className="absolute left-1/2 top-2 h-6 w-24 -translate-x-1/2 rounded-full bg-zinc-950 ring-1 ring-white/5" aria-hidden="true" />
          <span className={`flex items-center gap-1 pt-0.5 ${online ? "text-white" : "text-red-400"}`} title={online ? "Network online" : "Network offline"}>{online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}{battery == null ? null : <><span className="text-[8px] tabular-nums">{battery}%</span><BatteryFull className="h-3.5 w-3.5" /></>}</span>
        </div>
        <button
          type="button"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
          onClick={close}
          aria-label="Minimize phone"
          title="Minimize phone"
          className="pointer-events-auto absolute right-4 top-10 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-zinc-300 shadow-lg ring-1 ring-white/10 transition hover:bg-zinc-700 hover:text-white active:scale-90"
        >
          <X className="h-4 w-4" />
        </button>

        {active ? (
        <div className="flex min-h-0 flex-1 flex-col items-center px-2 pb-4 pt-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#34c759]">
            {callConnected ? `${active.direction === "INBOUND" ? "Incoming call" : "Call connected"} · ${callTime}` : callStatusLabel}
          </p>
          <p className="mt-3 w-full truncate text-[1.7rem] font-light tracking-[-0.02em] text-white">{activeNumber}</p>
          {recordingSid ? (
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-red-400">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" style={{ animation: "pulse 1.6s ease-in-out infinite" }} />Recording
            </span>
          ) : null}

          {transferNotice ? <p className="mt-4 w-full rounded-2xl bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-400">{transferNotice}</p> : null}
          {transferError ? <p className="mt-4 w-full rounded-2xl bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-400">{transferError}</p> : null}
          {recordingError ? <p className="mt-4 w-full rounded-2xl bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-400">{recordingError}</p> : null}

          {showCallKeypad ? (
            <>
              <div className="mx-auto mt-8 grid max-w-[18rem] grid-cols-3 gap-x-5 gap-y-4">
                {KEYS.map((key) => (
                  <button key={key} type="button" onPointerDown={(event) => { if (event.button === 0) sendCallDigit(key); }} onClick={(event) => { if (event.detail === 0) sendCallDigit(key); }} className="mx-auto flex h-[4.35rem] w-[4.35rem] touch-manipulation items-center justify-center rounded-full bg-[#333336] text-[1.85rem] font-normal text-white transition duration-150 hover:bg-[#4a4a4e] active:scale-90 active:bg-[#737377]">
                    {key}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setShowCallKeypad(false)} className="mt-6 text-xs font-medium text-[#0a84ff] hover:text-[#5eafff]">Hide keypad</button>
            </>
          ) : showCallNotes ? (
            <div className="mt-6 flex w-full max-w-[19rem] min-h-0 flex-1 flex-col text-left">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  {linkedRecordLoading
                    ? "Finding CRM record…"
                    : linkedRecord
                      ? `Note for ${linkedRecord.type}${linkedRecord.name ? ` · ${linkedRecord.name}` : ""}`
                      : `Note for call · ${activeNumber}`}
                </p>
                <button type="button" onClick={() => setShowCallNotes(false)} className="shrink-0 text-xs font-medium text-[#0a84ff] hover:text-[#5eafff]">Done</button>
              </div>
              <textarea
                autoFocus
                value={callNoteText}
                onChange={(event) => setCallNoteText(event.target.value)}
                placeholder="Jot down what's said on this call — saves automatically as you type."
                className="mt-3 h-36 w-full flex-1 resize-none rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-[#0a84ff]/50"
              />
              <p className="mt-2 text-[10px] text-zinc-500">
                {callNoteError ? <span role="alert" className="text-red-400">{callNoteError}</span> : linkedRecordLoading ? "Finding the matching Lead or Client…" : !callNoteTarget ? "The call is connecting. Your note will save when it connects." : callNoteSaving ? "Saving…" : callNoteSavedText && callNoteSavedText === callNoteText.trim() ? "Saved" : callNoteSavedText ? "Unsaved changes" : "Not saved yet"}
              </p>
            </div>
          ) : (
            <div className="mx-auto mt-10 grid w-full max-w-[18rem] grid-cols-3 gap-x-6 gap-y-6">
              <CallActionButton icon={muted ? MicOff : Mic} label={muted ? "Unmute" : "Mute"} active={muted} onClick={toggleMute} />
              <CallActionButton icon={recordingBusy ? Loader2 : Circle} label={recordingSid ? "Stop recording" : "Record"} active={Boolean(recordingSid)} tone="record" onClick={toggleRecording} disabled={recordingBusy} spin={recordingBusy} fill={!recordingBusy} />
              <CallActionButton icon={StickyNote} label="Notes" onClick={() => setShowCallNotes(true)} />
              <CallActionButton icon={Grid3x3} label="Keypad" onClick={() => setShowCallKeypad(true)} />
              <CallActionButton icon={ArrowLeftRight} label="Transfer" onClick={() => setTransferOpen(true)} disabled={transferring} />
            </div>
          )}

          <button type="button" onClick={hangup} aria-label="End call" className="mx-auto mb-1 mt-auto flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#ff3b30] text-white shadow-[0_12px_30px_rgba(255,59,48,0.32)] transition hover:bg-[#ff5147] active:scale-90">
            <PhoneOff className="h-6 w-6 fill-current" />
          </button>
        </div>
        ) : (
        <>
        <div className="flex h-32 shrink-0 translate-y-2 flex-col items-center justify-end px-2 pb-4 text-center">
          <p className={`w-full truncate font-light tracking-[-0.04em] ${display ? "text-[2rem] text-white" : "text-xl text-zinc-500"}`}>{display || "Enter a number"}</p>
          <button type="button" onClick={paste} className="mt-1 text-xs font-medium text-[#0a84ff] hover:text-[#5eafff] disabled:opacity-40">Paste number</button>
        </div>
        {error ? <p className="mb-2 rounded-xl bg-red-500/15 px-3 py-2 text-center text-xs font-medium text-red-400">{error}</p> : null}

        {outboundNumbers.length ? (
          <div className="mx-auto mb-3 flex w-full max-w-[18rem] items-center justify-between gap-3 rounded-2xl bg-white/5 px-3 py-2 ring-1 ring-white/10">
            <label htmlFor="dialpad-caller-id" className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Calling from</label>
            <Select
              id="dialpad-caller-id"
              value={selectedOutboundNumber}
              onChange={(event) => selectOutboundNumber(event.target.value)}
              ariaLabel="Calling from number"
              disabled={outboundNumbers.length < 2}
              className="min-w-0 flex-1"
              selectClassName="h-11 border-white/10 bg-zinc-900 py-2 text-right font-mono text-xs tabular-nums text-white shadow-none hover:border-white/20 focus:border-[#0a84ff] focus:ring-[#0a84ff]/20 disabled:bg-zinc-900 disabled:text-zinc-300"
            >
              {outboundNumbers.map((line) => (
                <option key={line.phoneNumber} value={line.phoneNumber}>
                  {line.label} · {line.phoneNumber}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        <div className="mx-auto grid max-w-[18rem] grid-cols-3 gap-x-5 gap-y-4">
          {KEYS.map((key) => key === "0" ? (
            <button
              key={key}
              type="button"
              onPointerDown={(event) => { if (event.button === 0) startZeroHold(); }}
              onPointerUp={(event) => { if (event.button === 0) releaseZero(); }}
              onPointerCancel={stopZeroHold}
              onPointerLeave={stopZeroHold}
              onClick={(event) => { if (event.detail === 0) pressKey("0"); }}
              onContextMenu={(event) => event.preventDefault()}
              className="mx-auto flex h-[4.35rem] w-[4.35rem] touch-manipulation flex-col items-center justify-center rounded-full bg-[#333336] text-white transition duration-150 hover:bg-[#4a4a4e] active:scale-90 active:bg-[#737377]"
            >
              <span className="text-[1.85rem] font-normal leading-7">0</span>
              <span className="min-h-2.5 text-[8px] font-semibold tracking-[0.22em] text-white">+</span>
            </button>
          ) : (
            <button key={key} type="button" onPointerDown={(event) => { if (event.button === 0) pressKey(key); }} onClick={(event) => { if (event.detail === 0) pressKey(key); }} className="mx-auto flex h-[4.35rem] w-[4.35rem] touch-manipulation flex-col items-center justify-center rounded-full bg-[#333336] text-white transition duration-150 hover:bg-[#4a4a4e] active:scale-90 active:bg-[#737377]"><span className="text-[1.85rem] font-normal leading-7">{key}</span><span className="min-h-2.5 text-[8px] font-semibold tracking-[0.22em] text-white">{LETTERS[key] || " "}</span></button>
          ))}
        </div>

        <div className="mx-auto mt-4 grid max-w-[17rem] grid-cols-3 items-center">
          <button type="button" onClick={paste} aria-label="Paste number" className="mx-auto flex h-12 w-12 flex-col items-center justify-center text-zinc-400 transition hover:text-white disabled:opacity-30"><Clipboard className="h-4 w-4" /><span className="mt-1 text-[9px]">Paste</span></button>
          <button type="button" disabled={!canCall} onClick={startCall} aria-label="Call" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#34c759] text-white shadow-[0_12px_30px_rgba(52,199,89,0.28)] transition hover:bg-[#42d866] active:scale-90 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:shadow-none">{busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <PhoneCall className="h-6 w-6 fill-current" />}</button>
          <button type="button" disabled={!number} onPointerDown={startDeleteHold} onPointerUp={stopDeleteHold} onPointerCancel={stopDeleteHold} onPointerLeave={stopDeleteHold} onClick={deleteDigit} onContextMenu={(event) => event.preventDefault()} aria-label="Delete digit; hold to clear number" title="Delete digit · Hold to clear" className="mx-auto flex h-12 w-12 touch-manipulation items-center justify-center text-zinc-300 transition hover:text-white disabled:opacity-0"><Delete className="h-6 w-6" /></button>
        </div>

        {status !== "ready" ? <p className="mt-3 text-center text-[10px] font-medium text-amber-400">Softphone is not ready to place calls</p> : <p className="mt-3 flex items-center justify-center gap-1.5 text-[9px] text-zinc-600"><Keyboard className="h-3 w-3" />Type · Enter to call · Esc to close</p>}
        </>
        )}
        <div className="mx-auto mt-auto h-1 w-28 shrink-0 rounded-full bg-white" aria-hidden="true" />
      </div>
      {transferOpen ? <TransferPicker busy={transferring} submitError={transferError} onClose={() => setTransferOpen(false)} onPick={startTransfer} /> : null}
    </aside>
  );
}

function CallActionButton({ icon: Icon, label, onClick, active = false, disabled = false, tone = "light", spin = false, fill = false }) {
  const activeClass = tone === "record" ? "bg-red-500 text-white" : "bg-white text-black";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="mx-auto flex flex-col items-center gap-1.5 disabled:opacity-40">
      <span className={`flex h-14 w-14 items-center justify-center rounded-full transition ${active ? activeClass : "bg-white/12 text-white hover:bg-white/20"}`}>
        <Icon className={`h-5 w-5 ${spin ? "animate-spin" : ""} ${fill ? "fill-current" : ""}`} />
      </span>
      <span className="text-[10px] font-medium text-zinc-300">{label}</span>
    </button>
  );
}

function TransferPicker({ busy, submitError, onClose, onPick }) {
  const { appUser } = useAuth();
  const [staff, setStaff] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api
      .get("/twilio-calls/staff", { cache: false })
      .then((response) => { if (active) setStaff(response.data?.data || []); })
      .catch((reason) => { if (active) setError(reason?.response?.data?.message || "Team members could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const needle = search.trim().toLowerCase();
  const options = staff.filter((person) => person.id !== appUser?.id && (!needle || person.fullName?.toLowerCase().includes(needle) || person.role?.toLowerCase().includes(needle)));

  return (
    <div className="absolute inset-0 z-30 flex flex-col rounded-[2.5rem] bg-zinc-900/98 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-5 py-4 pt-8">
        <p className="text-sm font-semibold text-white">Transfer to a team member</p>
        <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-zinc-300 hover:bg-white/20" aria-label="Close transfer picker"><X className="h-4 w-4" /></button>
      </div>
      {/* This overlay covers the whole in-call screen, including the spot
          where the parent renders transferError — a failed transfer attempt
          was previously invisible because the picker stayed open right on
          top of it. Shown here instead, inside the overlay itself. */}
      {submitError ? <p className="mx-5 mt-3 rounded-xl bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-400">{submitError}</p> : null}
      <div className="relative px-5 py-3">
        <Search className="absolute left-8 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-[#0a84ff]/50" placeholder="Search by name or role" />
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {error ? <p className="px-3 py-2 text-xs text-red-400">{error}</p> : null}
        {loading ? (
          <div className="space-y-2 p-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-12 animate-pulse rounded-xl bg-white/5" />)}</div>
        ) : !options.length ? (
          <p className="px-3 py-6 text-center text-xs text-zinc-500">{staff.length ? "No matching team members." : "No other team members available."}</p>
        ) : options.map((person) => (
          <button key={person.id} type="button" disabled={busy} onClick={() => onPick(person.id, person.fullName)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/10 disabled:opacity-50">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0a84ff]/20 text-[11px] font-bold uppercase text-[#5eafff]">{person.fullName?.slice(0, 1) || "?"}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-white">{person.fullName}</span><span className="block text-xs capitalize text-zinc-500">{person.role}</span></span>
            {busy ? <Loader2 className="h-4 w-4 animate-spin text-[#5eafff]" /> : <ArrowLeftRight className="h-4 w-4 text-[#5eafff]" />}
          </button>
        ))}
      </div>
    </div>
  );
}
