import { Device } from "@twilio/voice-sdk";
import { CheckCircle2, CircleAlert, Clock3, Loader2, Phone, PhoneIncoming, PhoneOff, UserRoundSearch, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import api from "../../services/api";
import { startConfiguredRingtone } from "../../utils/soundPreferences";

const SoftphoneContext = createContext(null);

// Twilio Client identities can be registered from more than one browser
// tab/window at once (every open CaseDesk tab runs this same provider), and
// dialing an identity with multiple simultaneous registrations is exactly
// what was causing inbound calls to fail fast as "busy" a few seconds in —
// not every registered tab handled the incoming notification the same way.
// The fix is structural: only ONE tab per logged-in user ever actually
// registers a Twilio Device (the "leader", decided via the Web Locks API,
// which hands leadership to the next open tab automatically and instantly
// if the leader tab closes — no polling/heartbeat needed). Every other tab
// ("followers") mirrors the leader's call state over a BroadcastChannel and
// relays user actions (answer, hang up, dial, mute, DTMF) back to the
// leader to actually execute — so incoming calls still ring, and can still
// be answered, no matter which of the user's open tabs they're looking at.
//
// The one thing this can't fix: a call's actual audio lives in whichever
// tab is hosting it (the leader) — closing THAT specific tab mid-call still
// ends the call. Leadership only prevents the registration conflict that
// was dropping calls before they were even answered.
const LOCK_NAME = "casedesk-softphone-device";
const CHANNEL_NAME = "casedesk-softphone";
const ACTION_TIMEOUT_MS = 12_000;

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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

// A Call's own "error" event — distinct from the Device-level one already
// handled below — fires when accept() itself fails, most commonly because
// the browser denied microphone access (Twilio SDK error 31401). Without
// this, that failure was completely silent: no dequeue request ever
// reached the backend, and the ring UI just vanished with no explanation.
function describeCallError(callError) {
  const code = callError?.code;
  if (code === 31401 || code === 31402) {
    return "The call couldn't connect: this browser denied microphone access. Check the site's microphone permission and try again.";
  }
  const detail = callError?.message || callError?.causes?.[0] || String(callError || "");
  return `The call couldn't connect${code ? ` (Twilio error ${code})` : ""}${detail ? `: ${detail}` : "."}`;
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
        const client = (data.clients || []).find((row) => [row.phone, row.secondaryPhone].some((phone) => String(phone || "").replace(/\D/g, "") === digits));
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
  const isLeaderRef = useRef(false);
  const deviceRef = useRef(null);
  const incomingCallRef = useRef(null); // real Twilio Call — leader tab only
  const activeCallRef = useRef(null); // real Twilio Call — leader tab only
  const tokenRefreshInFlight = useRef(false);
  const dialContextRef = useRef({}); // record context passed to dial(), read back when the call ends
  const callStartedAtRef = useRef(null);
  const channelRef = useRef(null);
  const pendingActionsRef = useRef(new Map()); // requestId -> { resolve, reject, timer } — follower tabs awaiting the leader's reply
  const ringtonePlaybackRef = useRef(null);

  const [status, setStatus] = useState("idle"); // idle | registering | ready | error | unconfigured
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState(false);
  const [incoming, setIncoming] = useState(null); // { from, callSid }
  const [active, setActive] = useState(null); // { callSid, number, direction, phase, connectedAt, leadId?, leadName?, clientId?, clientName? }
  const [muted, setMuted] = useState(false);
  const [outboundNumbers, setOutboundNumbers] = useState([]);
  const [selectedOutboundNumber, setSelectedOutboundNumber] = useState("");
  // { number, callSid, durationSeconds, leadId, leadName, clientId, clientName }
  // set when an OUTBOUND call we placed ends — the trigger for the follow-up
  // popup. Incoming calls never set it: their activity is recorded server-side
  // and the user only ever gets this popup for calls we placed.
  const [endedCall, setEndedCall] = useState(null);
  // Set when an incoming call's own "error" event fires — most commonly a
  // failed call.accept() (e.g. the browser denied microphone access), which
  // otherwise disappears with zero signal: no dequeue request ever reaches
  // the backend, the caller just hears nothing happen, and the ring UI here
  // simply vanishes with no explanation. Auto-clears itself; see the effect
  // below.
  const [connectError, setConnectError] = useState("");

  // Mirrors the state above for synchronous reads inside callbacks (avoids
  // stale-closure bugs across the many interdependent handlers below) and is
  // exactly what gets broadcast to follower tabs whenever it changes.
  const stateRef = useRef({ status: "idle", error: "", registered: false, incoming: null, active: null, muted: false, outboundNumbers: [], connectError: "" });

  const broadcast = useCallback((message) => {
    channelRef.current?.postMessage(message);
  }, []);

  // Applies a partial state update locally (always) and, only when this tab
  // is the leader and the change originated here (not a message we just
  // received FROM the leader), broadcasts the full merged state so every
  // follower tab stays in sync.
  const applyState = useCallback((partial, { fromRemote = false } = {}) => {
    stateRef.current = { ...stateRef.current, ...partial };
    if ("status" in partial) setStatus(partial.status);
    if ("error" in partial) setError(partial.error);
    if ("registered" in partial) setRegistered(partial.registered);
    if ("incoming" in partial) setIncoming(partial.incoming);
    if ("active" in partial) setActive(partial.active);
    if ("muted" in partial) setMuted(partial.muted);
    if ("outboundNumbers" in partial) setOutboundNumbers(partial.outboundNumbers);
    if ("connectError" in partial) setConnectError(partial.connectError);
    if (!fromRemote && isLeaderRef.current) broadcast({ type: "state", state: stateRef.current });
  }, [broadcast]);

  const stopRingtone = useCallback(() => {
    ringtonePlaybackRef.current?.stop();
    ringtonePlaybackRef.current = null;
  }, []);

  // Every open tab (leader and followers alike) plays the configured incoming
  // ringtone, triggered by the ring-start/ring-stop broadcast below, so the
  // ring is audible regardless of which tab owns the Twilio Device.
  const playRingtone = useCallback(() => {
    stopRingtone();
    ringtonePlaybackRef.current = startConfiguredRingtone({ loop: true });
  }, [stopRingtone]);

  const refreshToken = useCallback(async (device) => {
    if (tokenRefreshInFlight.current || !device) return;
    tokenRefreshInFlight.current = true;
    try {
      const response = await api.post("/twilio-calls/token");
      const tokenData = response.data?.data || {};
      device.updateToken(tokenData.token);
      applyState({ outboundNumbers: tokenData.outboundNumbers || [] });
    } catch {
      // Token refresh is best-effort — the device will re-register on the next
      // page load if the old token fully expires.
    } finally {
      tokenRefreshInFlight.current = false;
    }
  }, [applyState]);

  useEffect(() => {
    if (!outboundNumbers.length) {
      setSelectedOutboundNumber("");
      return;
    }
    const storageKey = `casedesk:outbound-number:${appUser?.id || "user"}`;
    const stored = window.localStorage.getItem(storageKey) || "";
    setSelectedOutboundNumber((current) => {
      if (outboundNumbers.some((line) => line.phoneNumber === current)) return current;
      if (outboundNumbers.some((line) => line.phoneNumber === stored)) return stored;
      return outboundNumbers.find((line) => line.isDefault)?.phoneNumber || outboundNumbers[0].phoneNumber;
    });
  }, [appUser?.id, outboundNumbers]);

  const selectOutboundNumber = useCallback((phoneNumber) => {
    if (!outboundNumbers.some((line) => line.phoneNumber === phoneNumber)) return;
    setSelectedOutboundNumber(phoneNumber);
    window.localStorage.setItem(`casedesk:outbound-number:${appUser?.id || "user"}`, phoneNumber);
  }, [appUser?.id, outboundNumbers]);

  // ---- Leader-only real Twilio Voice SDK operations --------------------
  // These touch deviceRef/incomingCallRef/activeCallRef directly and must
  // only ever run in the tab that holds the lock. Follower tabs never call
  // these — they call sendAction() instead, which the leader's message
  // handler below routes back into this exact set of functions.

  const performDial = useCallback(async (numberValue, context = {}) => {
    const target = normalizeE164(numberValue);
    if (!target) throw new Error("Enter a phone number to call.");
    const device = deviceRef.current;
    if (!device || !stateRef.current.registered) throw new Error("The softphone is not registered. Check the Twilio connection in Settings.");
    if (stateRef.current.active) throw new Error("A call is already in progress. Hang up first.");
    // The record ids ride as custom params to the TwiML Application, which
    // forwards them to the status callbacks so the session links to the
    // lead/client even before (or without) the outcome popup being saved.
    const { outboundCallerId, ...recordContext } = context || {};
    const call = await device.connect({
      params: {
        To: target,
        ...(outboundCallerId ? { CallerId: outboundCallerId } : {}),
        ...(recordContext.leadId ? { leadId: recordContext.leadId } : {}),
        ...(recordContext.clientId ? { clientId: recordContext.clientId } : {}),
      },
    });
    activeCallRef.current = call;
    dialContextRef.current = recordContext;
    applyState({ active: { callSid: call.parameters?.CallSid || "", number: target, direction: "OUTBOUND", phase: "dialing", connectedAt: null, outboundCallerId, ...recordContext }, muted: false });
    let finished = false;
    const finish = (showPopup) => {
      if (finished) return;
      finished = true;
      const durationSeconds = callStartedAtRef.current ? Math.max(0, Math.round((Date.now() - callStartedAtRef.current) / 1000)) : 0;
      callStartedAtRef.current = null;
      activeCallRef.current = null;
      applyState({ active: null, muted: false });
      if (showPopup) {
        const payload = { number: target, callSid: call.parameters?.CallSid || "", durationSeconds, ...dialContextRef.current };
        setEndedCall(payload);
        broadcast({ type: "ended-call", ended: payload });
        dialContextRef.current = {};
      }
    };
    call.on("disconnect", () => finish(true));
    call.on("cancel", () => finish(false));
    call.on("ringing", () => {
      if (activeCallRef.current === call && stateRef.current.active) {
        applyState({ active: { ...stateRef.current.active, phase: "ringing" } });
      }
    });
    // For an outbound call, Twilio doesn't hand back the real CallSid until
    // the callee actually picks up — call.parameters.CallSid right after
    // connect() is reliably still empty, so the "active" state set above
    // stores callSid: "". Transfer (and recording) send that empty string
    // straight to the backend, which correctly rejects it as "No active
    // call to transfer." The "accept" event is the guaranteed point
    // call.parameters is populated, so backfill callSid here.
    call.on("accept", () => {
      const resolvedCallSid = call.parameters?.CallSid || "";
      if (activeCallRef.current === call && stateRef.current.active) {
        const connectedAt = Date.now();
        callStartedAtRef.current = connectedAt;
        applyState({ active: { ...stateRef.current.active, callSid: resolvedCallSid || stateRef.current.active.callSid, phase: "connected", connectedAt } });
      }
    });
  }, [applyState, broadcast]);

  const performAccept = useCallback(() => {
    const call = incomingCallRef.current;
    if (!call) return;
    stopRingtone();
    broadcast({ type: "ring-stop" });
    // Reuse the callSid already resolved when "incoming" fired (it already
    // preferred the ParentCallSid custom parameter over call.parameters —
    // see that handler's comment) rather than re-deriving it here.
    const callSid = stateRef.current.incoming?.callSid || call.parameters?.CallSid || "";
    activeCallRef.current = call;
    incomingCallRef.current = null;
    applyState({ incoming: null, active: { callSid, number: stateRef.current.incoming?.from || "", direction: "INBOUND", phase: "connecting", connectedAt: null }, muted: false });
    call.accept();
  }, [applyState, broadcast, stopRingtone]);

  const performReject = useCallback(() => {
    const call = incomingCallRef.current;
    if (!call) return;
    stopRingtone();
    broadcast({ type: "ring-stop" });
    call.reject();
    incomingCallRef.current = null;
    applyState({ incoming: null });
  }, [applyState, broadcast, stopRingtone]);

  const performHangup = useCallback(() => {
    stopRingtone();
    broadcast({ type: "ring-stop" });
    if (activeCallRef.current) activeCallRef.current.disconnect();
    if (incomingCallRef.current) incomingCallRef.current.disconnect();
    activeCallRef.current = null;
    incomingCallRef.current = null;
    applyState({ active: null, incoming: null, muted: false });
  }, [applyState, broadcast, stopRingtone]);

  const performToggleMute = useCallback(() => {
    if (!activeCallRef.current) return;
    const next = !stateRef.current.muted;
    try { activeCallRef.current.mute(next); } catch { /* muted state is cosmetic if the call rejects it */ }
    applyState({ muted: next });
  }, [applyState]);

  const performSendDigits = useCallback((key) => {
    try { activeCallRef.current?.sendDigits(key); } catch { /* DTMF is best-effort */ }
  }, []);

  // ---- Follower-tab action relay ----------------------------------------
  // Posts an action to the channel and awaits the leader's action-result
  // reply, so dial()/etc. keep behaving like the async functions callers
  // already expect (throwing on failure) even when this tab isn't the one
  // actually holding the Twilio connection.
  const sendAction = useCallback((action, payload) => new Promise((resolve, reject) => {
    const requestId = randomId();
    const timer = window.setTimeout(() => {
      pendingActionsRef.current.delete(requestId);
      reject(new Error("The tab handling calls isn't responding. Try again or reload."));
    }, ACTION_TIMEOUT_MS);
    pendingActionsRef.current.set(requestId, { resolve, reject, timer });
    broadcast({ type: "action", requestId, action, payload });
  }), [broadcast]);

  useEffect(() => {
    if (!appUser?.id) return undefined;
    let disposed = false;
    let device = null;
    let releaseLock;
    const lockHoldPromise = new Promise((resolve) => { releaseLock = resolve; });

    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === "state") {
        applyState(message.state, { fromRemote: true });
        return;
      }
      if (message.type === "ring-start") { playRingtone(); return; }
      if (message.type === "ring-stop") { stopRingtone(); return; }
      if (message.type === "ended-call") { setEndedCall(message.ended); return; }
      if (message.type === "ended-call-resolved") { setEndedCall(null); return; }
      if (message.type === "request-state") {
        if (isLeaderRef.current) broadcast({ type: "state", state: stateRef.current });
        return;
      }
      if (message.type === "action-result") {
        const pending = pendingActionsRef.current.get(message.requestId);
        if (!pending) return;
        window.clearTimeout(pending.timer);
        pendingActionsRef.current.delete(message.requestId);
        if (message.ok) pending.resolve();
        else pending.reject(new Error(message.message || "The action could not be completed."));
        return;
      }
      if (message.type === "action" && isLeaderRef.current) {
        (async () => {
          try {
            if (message.action === "dial") await performDial(message.payload?.number, message.payload?.context || {});
            else if (message.action === "accept") performAccept();
            else if (message.action === "reject") performReject();
            else if (message.action === "hangup") performHangup();
            else if (message.action === "toggleMute") performToggleMute();
            else if (message.action === "sendDigits") performSendDigits(message.payload?.key);
            broadcast({ type: "action-result", requestId: message.requestId, ok: true });
          } catch (reason) {
            broadcast({ type: "action-result", requestId: message.requestId, ok: false, message: reason?.message || "The action could not be completed." });
          }
        })();
      }
    };
    // A brand-new tab (e.g. opened after a call was already placed
    // elsewhere) needs to catch up immediately rather than waiting for the
    // next unrelated state change — ask whichever tab is currently leader
    // (if any) to resend its full state.
    channel.postMessage({ type: "request-state" });

    const runAsLeader = async () => {
      if (disposed) return;
      isLeaderRef.current = true;
      applyState({ status: "registering", error: "" });
      try {
        const response = await api.post("/twilio-calls/token");
        if (disposed) return;
        const tokenData = response.data?.data || {};
        const token = tokenData.token;
        if (!token) return;
        applyState({ outboundNumbers: tokenData.outboundNumbers || [] });
        device = new Device(token, { logLevel: 1, allowIncomingWhileBusy: true });
        deviceRef.current = device;
        device.on("registered", () => { if (!disposed) applyState({ registered: true, status: "ready" }); });
        // A network blip, laptop sleep/wake, or wifi/VPN switch can drop the
        // SDK's registration after it was already "ready" — without also
        // moving status off "ready" here, the dial button (gated only on
        // status, not registered) stayed clickable and calling threw "The
        // softphone is not registered" instead of the button simply
        // disabling. The SDK re-fires "registered" on its own once it
        // reconnects, which flips status back to "ready" via the handler
        // above — this only covers the gap in between.
        device.on("unregistered", () => { if (!disposed) applyState({ registered: false, status: "registering" }); });
        device.on("error", (deviceError) => {
          if (disposed) return;
          const message = deviceError?.message || String(deviceError || "Softphone error");
          if (!message.toLowerCase().includes("token") || stateRef.current.status !== "ready") applyState({ error: message });
        });
        device.on("tokenWillExpire", (target) => void refreshToken(target));
        device.on("incoming", (call) => {
          if (disposed) return;
          incomingCallRef.current = call;
          // Listeners attach immediately regardless of how "from"/callSid
          // get resolved below, so a cancel/hangup that arrives mid-lookup
          // still cleans up correctly even though the ring UI never showed.
          const clearIncoming = () => {
            stopRingtone();
            broadcast({ type: "ring-stop" });
            incomingCallRef.current = null;
            applyState({ incoming: null });
          };
          call.on("cancel", clearIncoming);
          call.on("reject", clearIncoming);
          call.on("accept", () => {
            if (activeCallRef.current !== call || !stateRef.current.active) return;
            applyState({ active: { ...stateRef.current.active, phase: "connected", connectedAt: Date.now() } });
          });
          call.on("disconnect", () => {
            stopRingtone();
            broadcast({ type: "ring-stop" });
            incomingCallRef.current = null;
            activeCallRef.current = null;
            applyState({ incoming: null, active: null, muted: false });
          });
          // Fires when accept() itself fails (see describeCallError above) —
          // "disconnect" isn't guaranteed to fire on its own in that case,
          // so state is cleaned up here too rather than assuming it will.
          call.on("error", (callError) => {
            console.error("softphone.call_error", callError);
            stopRingtone();
            broadcast({ type: "ring-stop" });
            incomingCallRef.current = null;
            if (activeCallRef.current === call) activeCallRef.current = null;
            applyState({ incoming: null, active: null, muted: false, connectError: describeCallError(callError) });
          });

          const showIncoming = (from, callSid) => {
            // Superseded (this call was already answered/canceled, or a
            // newer incoming call arrived) while resolving who's calling.
            if (incomingCallRef.current !== call) return;
            applyState({ incoming: { from, callSid } });
            playRingtone();
            broadcast({ type: "ring-start" });
          };

          const dispatchedCallSid = call.parameters?.CallSid || "";
          const customFrom = call.customParameters?.get?.("CallerNumber") || "";
          const customParentSid = call.customParameters?.get?.("ParentCallSid") || "";
          if (customFrom || customParentSid) {
            // Nested <Dial><Client><Parameter> already carries this
            // synchronously — an internal-line call, or the caller's own
            // <Dial> still directly containing this <Client> (neither
            // routes through the queue-dispatch flow below).
            showIncoming(customFrom || call.parameters?.From || call.customParameters?.get?.("From") || "", customParentSid || dispatchedCallSid);
            return;
          }
          // A queue-dispatched ring (see twilioCallService.js's
          // dispatchRingAttempts): this call was never nested inside the
          // caller's own <Dial>, so there's no <Parameter> to read — and
          // critically, call.parameters.CallSid here is this ring attempt's
          // OWN leg, not the caller's. Using it directly for "Accept" would
          // send transfer/recording/outcome the wrong call id, so the ring
          // UI (and Accept) waits for the real caller number and parent
          // call id to come back from the backend first rather than
          // showing something that would answer wrong if tapped instantly.
          api.get(`/twilio-calls/incoming-context/${encodeURIComponent(dispatchedCallSid)}`).then((response) => {
            const context = response.data?.data;
            showIncoming(context?.callerNumber || call.parameters?.From || "", context?.parentCallSid || dispatchedCallSid);
          }).catch(() => {
            showIncoming(call.parameters?.From || "", dispatchedCallSid);
          });
        });
        await device.register();
      } catch (reason) {
        if (disposed) return;
        const message = reason?.response?.data?.message || reason?.message || "The softphone could not be started.";
        const unconfigured = reason?.response?.status === 409;
        applyState({ error: message, status: unconfigured ? "unconfigured" : "error" });
      }
    };

    if (typeof navigator.locks?.request === "function") {
      navigator.locks.request(`${LOCK_NAME}-${appUser.id}`, { mode: "exclusive" }, async () => {
        await runAsLeader();
        // Held until this tab unmounts (or closes) — the browser then hands
        // the lock to the next open tab's pending request automatically.
        await lockHoldPromise;
      }).catch(() => {});
    } else {
      // Web Locks unavailable (very old browser / insecure context) — no
      // cross-tab coordination possible, so fall back to every tab
      // registering its own Device, same as before this fix.
      void runAsLeader();
    }

    return () => {
      disposed = true;
      isLeaderRef.current = false;
      stopRingtone();
      channel.close();
      channelRef.current = null;
      for (const pending of pendingActionsRef.current.values()) {
        window.clearTimeout(pending.timer);
        pending.reject(new Error("This tab closed."));
      }
      pendingActionsRef.current.clear();
      deviceRef.current = null;
      incomingCallRef.current = null;
      activeCallRef.current = null;
      if (device) {
        device.removeAllListeners();
        device.destroy();
      }
      releaseLock?.();
    };
  }, [appUser?.id, refreshToken, playRingtone, stopRingtone, applyState, broadcast, performDial, performAccept, performReject, performHangup, performToggleMute, performSendDigits]);

  const dial = useCallback(async (number, context = {}) => {
    const outboundCallerId = selectedOutboundNumber || outboundNumbers.find((line) => line.isDefault)?.phoneNumber || outboundNumbers[0]?.phoneNumber || "";
    const dialContext = { ...context, ...(outboundCallerId ? { outboundCallerId } : {}) };
    if (isLeaderRef.current) { await performDial(number, dialContext); return; }
    await sendAction("dial", { number, context: dialContext });
  }, [outboundNumbers, performDial, selectedOutboundNumber, sendAction]);

  const accept = useCallback(() => {
    if (isLeaderRef.current) { performAccept(); return; }
    void sendAction("accept", {});
  }, [performAccept, sendAction]);

  const reject = useCallback(() => {
    if (isLeaderRef.current) { performReject(); return; }
    void sendAction("reject", {});
  }, [performReject, sendAction]);

  const hangup = useCallback(() => {
    if (isLeaderRef.current) { performHangup(); return; }
    void sendAction("hangup", {});
  }, [performHangup, sendAction]);

  const toggleMute = useCallback(() => {
    if (isLeaderRef.current) { performToggleMute(); return; }
    void sendAction("toggleMute", {});
  }, [performToggleMute, sendAction]);

  const sendDigits = useCallback((key) => {
    if (isLeaderRef.current) { performSendDigits(key); return; }
    void sendAction("sendDigits", { key });
  }, [performSendDigits, sendAction]);

  const closeEndedCall = useCallback(() => {
    setEndedCall(null);
    broadcast({ type: "ended-call-resolved" });
  }, [broadcast]);

  useEffect(() => {
    if (!connectError) return undefined;
    const timer = setTimeout(() => applyState({ connectError: "" }), 8_000);
    return () => clearTimeout(timer);
  }, [connectError, applyState]);

  const value = useMemo(
    () => ({
      status,
      error,
      registered,
      incoming,
      active,
      muted,
      outboundNumbers,
      selectedOutboundNumber,
      selectOutboundNumber,
      connectError,
      dial,
      accept,
      reject,
      hangup,
      toggleMute,
      sendDigits,
      normalizeE164,
    }),
    [status, error, registered, incoming, active, muted, outboundNumbers, selectedOutboundNumber, selectOutboundNumber, connectError, dial, accept, reject, hangup, toggleMute, sendDigits],
  );

  return (
    <SoftphoneContext.Provider value={value}>
      {children}
      {incoming ? (
        <IncomingCallCard key={incoming.callSid || incoming.from} incoming={incoming} onAccept={accept} onReject={reject} />
      ) : null}
      {endedCall && !active && !incoming ? <EndedCallCard ended={endedCall} onClose={closeEndedCall} /> : null}
      {connectError ? <ConnectErrorBanner message={connectError} onClose={() => applyState({ connectError: "" })} /> : null}
    </SoftphoneContext.Provider>
  );
}

function ConnectErrorBanner({ message, onClose }) {
  return (
    <aside className={`${FLOATING_CALL_CARD_POSITION} overflow-hidden rounded-3xl border border-rose-200 bg-white/95 shadow-[0_24px_80px_rgba(190,18,60,0.22)] backdrop-blur-xl`} role="alert" aria-label="Call connection failed">
      <div className="h-1 bg-rose-500" />
      <div className="flex items-start gap-3 p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600"><CircleAlert className="h-4.5 w-4.5" /></span>
        <p className="flex-1 text-sm leading-5 text-slate-700">{message}</p>
        <button type="button" onClick={onClose} aria-label="Dismiss" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
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
