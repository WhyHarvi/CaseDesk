import { BatteryFull, Clipboard, Delete, Keyboard, Loader2, Phone, PhoneCall, Wifi, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSoftphone } from "./SoftphoneProvider";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const LETTERS = { 2: "ABC", 3: "DEF", 4: "GHI", 5: "JKL", 6: "MNO", 7: "PQRS", 8: "TUV", 9: "WXYZ" };
const DTMF = {
  1: [697, 1209], 2: [697, 1336], 3: [697, 1477],
  4: [770, 1209], 5: [770, 1336], 6: [770, 1477],
  7: [852, 1209], 8: [852, 1336], 9: [852, 1477],
  "*": [941, 1209], 0: [941, 1336], "#": [941, 1477],
};

export function openGlobalDialpad(number = "") {
  window.dispatchEvent(new CustomEvent("casedesk:open-dialpad", { detail: { number } }));
}

export default function GlobalDialpad() {
  const { dial, active, status } = useSoftphone();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [online, setOnline] = useState(() => navigator.onLine);
  const [battery, setBattery] = useState(null);
  const [callSeconds, setCallSeconds] = useState(0);
  const panelRef = useRef(null);
  const audioRef = useRef(null);
  const deleteHoldTimerRef = useRef(null);
  const deleteHoldTriggeredRef = useRef(false);

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

  const startCall = useCallback(async () => {
    if (!canCall) return;
    try {
      setBusy(true);
      setError("");
      await dial(number);
      setOpen(false);
    } catch (reason) {
      setError(reason?.message || "The call could not be placed.");
    } finally {
      setBusy(false);
    }
  }, [canCall, dial, number]);

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
    if (!active) return undefined;
    const timer = window.setInterval(() => setCallSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active?.call]);

  useEffect(() => {
    const handleOpen = (event) => {
      warmAudio();
      const nextNumber = String(event.detail?.number || "").replace(/[^\d+*#]/g, "");
      if (nextNumber) setNumber(nextNumber);
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
        pressKey(event.key);
      } else if (event.key === "Backspace") {
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
  }, [canCall, close, open, pressKey, startCall, warmAudio]);

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

  if (!open) {
    return (
      <button type="button" onPointerDown={warmAudio} onClick={() => setOpen(true)} aria-label={active ? `Active call with ${activeNumber}, ${callTime}` : "Open dialpad"} aria-keyshortcuts="D" className={`fixed bottom-6 right-6 z-[390] flex h-14 items-center rounded-full border border-white/10 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-1 active:translate-y-0 active:scale-95 max-sm:right-4 ${active ? "w-[19rem] max-w-[calc(100vw-2rem)] gap-3 bg-black px-3 shadow-[0_18px_45px_rgba(0,0,0,0.35)] hover:bg-zinc-900" : "w-14 justify-center bg-[#34c759] p-0 shadow-[0_10px_24px_rgba(15,23,42,0.2)] hover:bg-[#2fb350]"}`}>
        <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${active ? "bg-[#34c759]" : "bg-white/15"}`}>
          {active ? <span className="absolute inset-0 animate-ping rounded-full bg-[#34c759]/35" style={{ animationDuration: "2.2s" }} /> : null}
          <Phone className="relative h-4 w-4 fill-current" />
        </span>
        {active ? (
          <>
            <span className="min-w-0 flex-1 text-left"><span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-[#34c759]">Call in progress</span><span className="block truncate text-xs font-medium text-white">{activeNumber}</span></span>
            <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-white">{callTime}</span>
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

        <div className="flex h-32 shrink-0 translate-y-2 flex-col items-center justify-end px-2 pb-4 text-center">
          <p className={`w-full truncate font-light tracking-[-0.04em] ${display ? "text-[2rem] text-white" : "text-xl text-zinc-500"}`}>{display || "Enter a number"}</p>
          <button type="button" disabled={Boolean(active)} onClick={paste} className="mt-1 text-xs font-medium text-[#0a84ff] hover:text-[#5eafff] disabled:opacity-40">Paste number</button>
        </div>
        {error ? <p className="mb-2 rounded-xl bg-red-500/15 px-3 py-2 text-center text-xs font-medium text-red-400">{error}</p> : null}

        <div className="mx-auto grid max-w-[18rem] grid-cols-3 gap-x-5 gap-y-4">
          {KEYS.map((key) => <button key={key} type="button" disabled={Boolean(active)} onPointerDown={(event) => { if (event.button === 0) pressKey(key); }} onClick={(event) => { if (event.detail === 0) pressKey(key); }} className="mx-auto flex h-[4.35rem] w-[4.35rem] touch-manipulation flex-col items-center justify-center rounded-full bg-[#333336] text-white transition duration-150 hover:bg-[#4a4a4e] active:scale-90 active:bg-[#737377] disabled:opacity-40"><span className="text-[1.85rem] font-normal leading-7">{key}</span><span className="min-h-2.5 text-[8px] font-semibold tracking-[0.22em] text-white">{key === "0" ? "+" : LETTERS[key] || " "}</span></button>)}
        </div>

        <div className="mx-auto mt-4 grid max-w-[17rem] grid-cols-3 items-center">
          <button type="button" disabled={Boolean(active)} onClick={paste} aria-label="Paste number" className="mx-auto flex h-12 w-12 flex-col items-center justify-center text-zinc-400 transition hover:text-white disabled:opacity-30"><Clipboard className="h-4 w-4" /><span className="mt-1 text-[9px]">Paste</span></button>
          <button type="button" disabled={!canCall} onClick={startCall} aria-label="Call" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#34c759] text-white shadow-[0_12px_30px_rgba(52,199,89,0.28)] transition hover:bg-[#42d866] active:scale-90 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:shadow-none">{busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <PhoneCall className="h-6 w-6 fill-current" />}</button>
          <button type="button" disabled={Boolean(active) || !number} onPointerDown={startDeleteHold} onPointerUp={stopDeleteHold} onPointerCancel={stopDeleteHold} onPointerLeave={stopDeleteHold} onClick={deleteDigit} onContextMenu={(event) => event.preventDefault()} aria-label="Delete digit; hold to clear number" title="Delete digit · Hold to clear" className="mx-auto flex h-12 w-12 touch-manipulation items-center justify-center text-zinc-300 transition hover:text-white disabled:opacity-0"><Delete className="h-6 w-6" /></button>
        </div>

        {status !== "ready" && !active ? <p className="mt-3 text-center text-[10px] font-medium text-amber-400">Softphone is not ready to place calls</p> : <p className="mt-3 flex items-center justify-center gap-1.5 text-[9px] text-zinc-600"><Keyboard className="h-3 w-3" />Type · Enter to call · Esc to close</p>}
        <div className="mx-auto mt-auto h-1 w-28 shrink-0 rounded-full bg-white" aria-hidden="true" />
      </div>
    </aside>
  );
}
