import { useCallback, useEffect, useRef, useState } from "react";
import { Briefcase, DollarSign, FileCheck, Pause, Play, TrendingUp, UserRound } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { useAuth } from "../../auth/AuthContext";
import api from "../../services/api";
import { onNovaCelebrate } from "../../utils/novaCelebrate";

const STORAGE_KEY = "casedesk:nova-pet-position";
const PAUSE_STORAGE_PREFIX = "casedesk:nova-movement-paused:";
const PAUSE_CHANNEL_PREFIX = "casedesk:nova-movement:";
const PAUSE_SYNC_INTERVAL_MS = 5_000;
const PET_WIDTH = 112;
const PET_HEIGHT = 104;
const EDGE_GAP = 16;
const DRAG_THRESHOLD = 6;
const FLING_SPEED_PX_MS = 1.5;
const HEADSTAND_HOLD_MS = 1600;
const CELEBRATION_HOLD_MS = 2600;
// Fired by api.js's mutate() after a handful of specific successful
// mutations, regardless of which page/component triggered them (see
// novaCelebrate.js). "coin" is a dedicated pose for payments; the rest
// reuse an existing autonomous-rotation activity — its message just gets
// overridden by the celebration's own line for the duration.
const CELEBRATIONS = Object.freeze({
  client_created: { activity: "wave", message: "New client! Welcome aboard." },
  lead_converted: { activity: "dance", message: "Lead converted!" },
  appointment_booked: { activity: "nod", message: "Appointment booked." },
  case_submitted: { activity: "dance", message: "Case submitted!" },
  payment_received: { activity: "coin", message: "Payment received!" },
});
const IDLE_QUIPS = [
  "Chasing a sunbeam…",
  "Did someone say treats?",
  "Keeping an eye on things.",
  "Purr-fectly on standby.",
  "Watching the cursor go by.",
  "Just supervising.",
];

// Same convention as NovaChatPresentation.jsx's own copy of this — explicit
// context sent to the backend rather than it re-parsing the path itself.
function entityFromPath(path) {
  const client = /^\/app\/clients\/([^/]+)/.exec(String(path || ""));
  if (client) return { entityType: "client", entityId: client[1] };
  const caseMatch = /^\/app\/cases\/([^/]+)/.exec(String(path || ""));
  if (caseMatch) return { entityType: "case", entityId: caseMatch[1] };
  return null;
}

// Persona is presentation-only, driven entirely by the backend's own
// `persona` field on the fetched insight (aiInsightService.js) — the icon
// is just one more presentation detail layered on that same string, never
// a second, independent guess at what page this is.
const PERSONA_ICONS = Object.freeze({
  "Client assistant": UserRound,
  "Case assistant": Briefcase,
  "Document reviewer": FileCheck,
  "Lead analyst": TrendingUp,
  "Collections assistant": DollarSign,
});

const SEEN_INSIGHT_KEY = "casedesk:nova-seen-insight";

function greeting(firstName) {
  return firstName ? `Hi, ${firstName}!` : "Hi, I’m Nova";
}

function homePosition() {
  if (typeof window === "undefined") return { x: EDGE_GAP, y: EDGE_GAP };
  return { x: Math.max(EDGE_GAP, window.innerWidth - 270), y: Math.max(EDGE_GAP, window.innerHeight - PET_HEIGHT - 22) };
}

function clampPosition(position) {
  if (typeof window === "undefined") return position;
  return {
    x: Math.min(Math.max(EDGE_GAP, position.x), Math.max(EDGE_GAP, window.innerWidth - PET_WIDTH - EDGE_GAP)),
    y: Math.min(Math.max(EDGE_GAP, position.y), Math.max(EDGE_GAP, window.innerHeight - PET_HEIGHT - EDGE_GAP)),
  };
}

function savedPosition() {
  if (typeof window === "undefined") return homePosition();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) return clampPosition(parsed);
  } catch {
    // A corrupt preference should never keep the assistant from appearing.
  }
  return homePosition();
}

function savedPausePreference(userId) {
  if (typeof window === "undefined" || !userId) return false;
  try { return window.localStorage.getItem(`${PAUSE_STORAGE_PREFIX}${userId}`) === "true"; } catch { return false; }
}

// Exported so NovaChatPresentation.jsx's in-chat companion can render the
// same character (scaled down) instead of duplicating this artwork — it's
// visibly the same Nova, just anchored inside the open conversation
// instead of wandering the screen.
export function NovaCatArt({ activity }) {
  return (
    <svg viewBox="0 0 132 108" className="h-[104px] w-28 overflow-visible drop-shadow-[0_10px_12px_rgba(30,41,59,0.24)]" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="nova-pet-coat" x1="28" y1="20" x2="101" y2="92" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7387A2" />
          <stop offset="0.55" stopColor="#43566F" />
          <stop offset="1" stopColor="#26364C" />
        </linearGradient>
        <linearGradient id="nova-pet-cream" x1="45" y1="50" x2="70" y2="96" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F7FAFD" />
          <stop offset="1" stopColor="#C8D9EA" />
        </linearGradient>
        <radialGradient id="nova-yarn" cx="0" cy="0" r="1" gradientTransform="translate(112 86) rotate(90) scale(13)">
          <stop stopColor="#9DC8F0" />
          <stop offset="1" stopColor="#527CAF" />
        </radialGradient>
        <radialGradient id="nova-coin" cx="0" cy="0" r="1" gradientTransform="translate(34 84) rotate(90) scale(9)">
          <stop stopColor="#FDE68A" />
          <stop offset="1" stopColor="#D97706" />
        </radialGradient>
      </defs>

      {activity === "sleep" ? (
        <>
          <ellipse className="nova-pet-shadow" cx="66" cy="98" rx="49" ry="6" fill="#0F172A" opacity="0.11" />
          <g className="nova-pet-sleeping">
            <path className="nova-pet-sleep-tail" d="M95 73C120 74 124 89 110 97C99 103 85 98 81 90" stroke="url(#nova-pet-coat)" strokeWidth="11" strokeLinecap="round" />
            <ellipse cx="76" cy="74" rx="38" ry="25" fill="url(#nova-pet-coat)" transform="rotate(-3 76 74)" />
            <path d="M56 82C69 90 89 91 102 81C94 95 69 99 55 88Z" fill="url(#nova-pet-cream)" opacity="0.36" />

            <g className="nova-pet-sleep-head">
              <path d="M20 64L24 43L38 58" fill="#43566F" />
              <path d="M51 58L58 41L65 65" fill="#43566F" />
              <path d="M24 57L27 48L34 58" fill="#E5A9B9" opacity="0.78" />
              <path d="M54 57L58 47L62 61" fill="#E5A9B9" opacity="0.78" />
              <ellipse cx="41" cy="72" rx="24" ry="20" fill="url(#nova-pet-coat)" transform="rotate(5 41 72)" />
              <path d="M27 69C31 73 36 73 40 69M45 70C49 74 54 74 58 70" stroke="#DCE8F4" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M38 77L41.5 80L45 77L41.5 75.5L38 77Z" fill="#F0A9BB" />
              <path d="M41.5 80C40 82 38 83 36 82M41.5 80C43 83 46 83 48 82" stroke="#DFEBF5" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M33 77L12 74M33 81L13 85M49 77L66 73M49 81L65 85" stroke="#C5D7E8" strokeWidth="1.35" strokeLinecap="round" opacity="0.84" />
            </g>

            <g className="nova-pet-sleep-paws">
              <g transform="translate(61 90) rotate(-7)">
                <ellipse rx="8.5" ry="6.2" fill="#D4E1EE" stroke="#40546D" strokeWidth="1" />
                <ellipse cy="1.5" rx="3.2" ry="2.5" fill="#E8A9BA" opacity="0.88" />
                <circle cx="-3.8" cy="-2" r="1.25" fill="#E8A9BA" />
                <circle cy="-3" r="1.25" fill="#E8A9BA" />
                <circle cx="3.8" cy="-2" r="1.25" fill="#E8A9BA" />
              </g>
              <g transform="translate(77 92) rotate(7)">
                <ellipse rx="8.5" ry="6.2" fill="#C5D7E8" stroke="#33455D" strokeWidth="1" />
                <ellipse cy="1.5" rx="3.2" ry="2.5" fill="#E8A9BA" opacity="0.88" />
                <circle cx="-3.8" cy="-2" r="1.25" fill="#E8A9BA" />
                <circle cy="-3" r="1.25" fill="#E8A9BA" />
                <circle cx="3.8" cy="-2" r="1.25" fill="#E8A9BA" />
              </g>
            </g>
          </g>
          <g className="nova-pet-snores" fill="none" stroke="#527CAF" strokeLinecap="round" strokeLinejoin="round">
            <path className="nova-pet-snore nova-pet-snore-one" d="M71 37H80L72 46H82" strokeWidth="2.5" />
            <path className="nova-pet-snore nova-pet-snore-two" d="M88 21H96L89 29H98" strokeWidth="2" />
            <path className="nova-pet-snore nova-pet-snore-three" d="M104 9H110L105 15H112" strokeWidth="1.6" />
          </g>
        </>
      ) : (
        <>
          <ellipse className="nova-pet-shadow" cx="66" cy="98" rx="43" ry="7" fill="#0F172A" opacity="0.12" />
          <g className="nova-pet-body">
            <path className="nova-pet-tail" d="M94 72C121 76 127 48 112 39C102 33 96 42 104 48C111 53 111 61 103 64" stroke="url(#nova-pet-coat)" strokeWidth="11" strokeLinecap="round" />
            <ellipse cx="72" cy="73" rx="34" ry="24" fill="url(#nova-pet-coat)" />
            <path d="M56 67C55 79 58 91 65 97C72 91 76 78 73 65" fill="url(#nova-pet-cream)" opacity="0.94" />
            <path className="nova-pet-leg nova-pet-leg-back" d="M85 77C91 81 93 91 89 98H76L77 79" fill="#33455D" />
            <path className="nova-pet-leg nova-pet-leg-front" d="M48 73C43 80 42 91 46 98H60L60 75" fill="#40546D" />
            <ellipse cx="48" cy="98" rx="9" ry="3.5" fill="#D4E1EE" />
            <ellipse cx="87" cy="98" rx="9" ry="3.5" fill="#D4E1EE" />

            <g className="nova-pet-head">
              <path d="M30 43L31 14L49 31" fill="#43566F" />
              <path d="M70 42L68 14L52 31" fill="#43566F" />
              <path d="M34 31L35 20L43 30" fill="#E5A9B9" opacity="0.8" />
              <path d="M65 31L64 20L57 30" fill="#E5A9B9" opacity="0.8" />
              <ellipse cx="50" cy="48" rx="25" ry="22" fill="url(#nova-pet-coat)" />
              <path d="M36 43C40 40 44 40 47 43M54 43C58 40 62 40 65 43" stroke="#DCE8F4" strokeWidth="2.5" strokeLinecap="round" />
              <ellipse cx="41" cy="46" rx="3" ry="3.8" fill="#A9DAFF" />
              <ellipse cx="60" cy="46" rx="3" ry="3.8" fill="#A9DAFF" />
              <circle cx="41" cy="46" r="1.25" fill="#111827" />
              <circle cx="60" cy="46" r="1.25" fill="#111827" />
              <circle cx="40" cy="44.5" r="0.7" fill="white" />
              <circle cx="59" cy="44.5" r="0.7" fill="white" />
              <path d="M47 53L50.5 56L54 53L50.5 51.4L47 53Z" fill="#F0A9BB" />
              <path d="M50.5 56C49 59 46 59.5 44 58M50.5 56C52 59 55 59.5 57 58" stroke="#DFEBF5" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M43 54L18 50M43 58L17 60M58 54L82 50M58 58L83 60" stroke="#C5D7E8" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
              <path d="M32 65C42 70 58 70 69 64" stroke="#78A9DE" strokeWidth="4" strokeLinecap="round" />
              <path d="M51 66L54 71L60 72L56 76L57 82L51 79L46 82L47 76L43 72L49 71L51 66Z" fill="#E8F3FC" stroke="#6489B5" strokeWidth="1.2" />
            </g>
          </g>
        </>
      )}

      {activity === "yarn" ? (
        <g className="nova-pet-yarn">
          <path d="M95 84C100 78 103 77 109 82" stroke="#6489B5" strokeWidth="2" strokeLinecap="round" />
          <circle cx="113" cy="88" r="13" fill="url(#nova-yarn)" />
          <path d="M103 84C110 83 117 88 122 94M105 94C110 87 116 82 121 82M108 78C112 84 115 93 116 100" stroke="#D9EAFA" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
        </g>
      ) : null}

      {activity === "nap" ? (
        <g className="nova-pet-dream" fill="#527CAF">
          <path d="M91 34H103L92 47H105" stroke="#527CAF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="110" cy="25" r="3.5" opacity="0.65" />
          <circle cx="119" cy="16" r="2.3" opacity="0.4" />
        </g>
      ) : null}

      {activity === "coin" ? (
        <g className="nova-pet-coin">
          <circle cx="34" cy="84" r="9" fill="url(#nova-coin)" stroke="#B45309" strokeWidth="1.5" />
          <path d="M30 84H38M34 80V88" stroke="#FEF3C7" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      ) : null}

      {activity === "think" ? (
        <g className="nova-pet-think" fill="#527CAF">
          <circle cx="88" cy="30" r="2.6" opacity="0.9" />
          <circle cx="97" cy="24" r="2.2" opacity="0.65" />
          <circle cx="105" cy="19" r="1.8" opacity="0.4" />
        </g>
      ) : null}
    </svg>
  );
}

export default function NovaCatMascot({ onActivate, firstName = "", currentPath = "" }) {
  const { appUser } = useAuth();
  const userId = appUser?.id || "";
  const reduceMotion = useReducedMotion();
  const [position, setPosition] = useState(savedPosition);
  const [activity, setActivity] = useState("idle");
  const [direction, setDirection] = useState("right");
  const [dragging, setDragging] = useState(false);
  const [paused, setPaused] = useState(() => savedPausePreference(userId));
  const [idleQuip, setIdleQuip] = useState("");
  const [celebration, setCelebration] = useState(null);
  const [insight, setInsight] = useState(null);
  const persona = insight?.persona && insight.persona !== "Nova" ? insight.persona : "";
  const PersonaIcon = PERSONA_ICONS[persona];
  const positionRef = useRef(position);
  const petRef = useRef(null);
  const pointerRef = useRef(null);
  const suppressClickRef = useRef(false);
  const velocityRef = useRef(null);
  const flingRef = useRef(false);
  const headstandTimerRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const celebrateTimerRef = useRef(null);
  const pauseChannelRef = useRef(null);

  const applyPausePreference = useCallback((next) => {
    const value = Boolean(next);
    if (value && petRef.current) {
      const bounds = petRef.current.getBoundingClientRect();
      const frozen = clampPosition({ x: bounds.left, y: bounds.top });
      positionRef.current = frozen;
      setPosition(frozen);
    }
    setPaused(value);
    if (value) {
      window.clearTimeout(celebrateTimerRef.current);
      setCelebration(null);
      setActivity("idle");
    }
    if (userId) {
      try { window.localStorage.setItem(`${PAUSE_STORAGE_PREFIX}${userId}`, String(value)); } catch { /* private-mode storage */ }
    }
  }, [userId]);

  const refreshPausePreference = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await api.get("/ai/preferences", { cache: false });
      applyPausePreference(Boolean(response.data?.data?.novaMovementPaused));
    } catch {
      // Keep the last locally cached preference while offline. A later poll
      // or focus event will reconcile it with the account again.
    }
  }, [applyPausePreference, userId]);

  const setAccountPausePreference = useCallback((next) => {
    const value = Boolean(next);
    applyPausePreference(value);
    pauseChannelRef.current?.postMessage({ type: "nova-movement", paused: value });
    api.patch("/ai/preferences", { novaMovementPaused: value }).catch(() => void refreshPausePreference());
  }, [applyPausePreference, refreshPausePreference]);

  useEffect(() => {
    if (!userId) return undefined;
    const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(`${PAUSE_CHANNEL_PREFIX}${userId}`) : null;
    pauseChannelRef.current = channel;
    if (channel) {
      channel.onmessage = (event) => {
        if (event.data?.type === "nova-movement" && typeof event.data.paused === "boolean") applyPausePreference(event.data.paused);
      };
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "hidden") void refreshPausePreference();
    };
    void refreshPausePreference();
    const interval = window.setInterval(refreshWhenVisible, PAUSE_SYNC_INTERVAL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      channel?.close();
      if (pauseChannelRef.current === channel) pauseChannelRef.current = null;
    };
  }, [applyPausePreference, refreshPausePreference, userId]);

  const updatePosition = useCallback((next, { persist = false } = {}) => {
    const clamped = clampPosition(next);
    positionRef.current = clamped;
    setPosition(clamped);
    if (persist && typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clamped));
  }, []);

  useEffect(() => {
    const handleResize = () => updatePosition(positionRef.current, { persist: true });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updatePosition]);

  useEffect(() => () => {
    window.clearTimeout(headstandTimerRef.current);
    window.clearTimeout(noticeTimerRef.current);
    window.clearTimeout(celebrateTimerRef.current);
  }, []);

  useEffect(() => {
    return onNovaCelebrate((event) => {
      const config = CELEBRATIONS[event.detail?.type];
      if (!config || reduceMotion || paused) return;
      setCelebration(config);
      setActivity(config.activity);
      window.clearTimeout(celebrateTimerRef.current);
      celebrateTimerRef.current = window.setTimeout(() => {
        setCelebration(null);
        setActivity("idle");
      }, CELEBRATION_HOLD_MS);
    });
  }, [paused, reduceMotion]);

  useEffect(() => {
    let active = true;
    const entity = entityFromPath(currentPath);
    api.get("/ai/proactive-insight", { params: { path: currentPath, ...(entity || {}) } })
      .then((response) => {
        if (!active) return;
        const next = response.data?.insight || null;
        setInsight(next);
        if (!next) return;
        // Don't nag: an insight already shown once (same id — the backend
        // bakes the underlying fact into it, so it only changes when the
        // real situation does) just joins the ambient quip rotation below
        // instead of forcing itself into the bubble and a notice pose on
        // every single page visit.
        let lastSeenId = "";
        try { lastSeenId = window.localStorage.getItem(SEEN_INSIGHT_KEY) || ""; } catch { /* private-mode storage */ }
        if (next.id === lastSeenId) return;
        setIdleQuip(next.message);
        if (!reduceMotion && !paused && (next.severity === "attention" || next.severity === "urgent")) {
          setActivity("nod");
          window.clearTimeout(noticeTimerRef.current);
          noticeTimerRef.current = window.setTimeout(() => setActivity("idle"), 1800);
        }
        try { window.localStorage.setItem(SEEN_INSIGHT_KEY, next.id); } catch { /* private-mode storage */ }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [currentPath, paused, reduceMotion]);

  useEffect(() => {
    if (reduceMotion || paused) {
      setActivity("idle");
      return undefined;
    }
    const greetTimer = window.setTimeout(() => setActivity("wave"), 700);
    const settleTimer = window.setTimeout(() => setActivity("idle"), 2500);
    return () => {
      window.clearTimeout(greetTimer);
      window.clearTimeout(settleTimer);
    };
  }, [paused, reduceMotion]);

  useEffect(() => {
    if (reduceMotion || paused) {
      setActivity("idle");
      return undefined;
    }
    // handlePointerDown already resets to idle the instant a drag starts,
    // and a fast-enough flick can set "headstand" mid-drag — this effect
    // must not stomp either by forcing idle again here. It only needs to
    // stop scheduling new autonomous activity while dragging; the cleanup
    // below (re-running on the dragging flip) already cancels any pending
    // scheduled activity.
    if (dragging) return undefined;

    let cancelled = false;
    let timer;
    let activityTimer;

    function scheduleNextActivity() {
      const wait = 10000 + Math.random() * 9000;
      timer = window.setTimeout(() => {
        const roll = Math.random();
        let duration = 5200;
        if (roll < 0.35) {
          const minX = EDGE_GAP;
          const maxX = Math.max(minX, window.innerWidth - PET_WIDTH - EDGE_GAP);
          const targetX = minX + Math.random() * (maxX - minX);
          setDirection(targetX < positionRef.current.x ? "left" : "right");
          setActivity("walk");
          updatePosition({ x: targetX, y: Math.max(EDGE_GAP, window.innerHeight - PET_HEIGHT - 22) });
          duration = 4200;
        } else if (roll < 0.55) {
          setActivity("yarn");
        } else if (roll < 0.68) {
          setActivity("stretch");
        } else if (roll < 0.78) {
          setActivity("nap");
        } else if (roll < 0.88) {
          setActivity("nod");
          duration = 2400;
        } else if (roll < 0.96) {
          setActivity("dance");
          duration = 3200;
        } else {
          setActivity("wave");
          duration = 2400;
        }
        activityTimer = window.setTimeout(() => {
          setActivity("idle");
          updatePosition(positionRef.current, { persist: true });
          if (!cancelled) scheduleNextActivity();
        }, duration);
      }, wait);
    }

    scheduleNextActivity();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(activityTimer);
    };
  }, [dragging, paused, reduceMotion, updatePosition]);

  useEffect(() => {
    if (activity !== "idle" || reduceMotion || paused) return undefined;
    const timer = window.setInterval(() => {
      setIdleQuip((current) => {
        const pool = [insight?.message, persona, ...IDLE_QUIPS].filter((quip) => quip && quip !== current);
        return pool[Math.floor(Math.random() * pool.length)] || current;
      });
    }, 8000 + Math.random() * 4000);
    return () => window.clearInterval(timer);
  }, [activity, paused, reduceMotion, insight, persona]);

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: positionRef.current, moved: false };
    velocityRef.current = { x: event.clientX, y: event.clientY, t: event.timeStamp };
    flingRef.current = false;
    setActivity("idle");
  }

  function handlePointerMove(event) {
    const drag = pointerRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    suppressClickRef.current = true;
    setDragging(true);
    setDirection(dx < 0 ? "left" : "right");
    updatePosition({ x: drag.origin.x + dx, y: drag.origin.y + dy });

    // A hard, fast flick (well past an ordinary drag) flips Nova into a
    // headstand mid-air as immediate feedback — a playful easter egg, not
    // how normal dragging is meant to feel.
    const last = velocityRef.current;
    const elapsed = event.timeStamp - (last?.t ?? event.timeStamp);
    if (last && elapsed > 0) {
      const speed = Math.hypot(event.clientX - last.x, event.clientY - last.y) / elapsed;
      if (!reduceMotion && speed > FLING_SPEED_PX_MS) {
        flingRef.current = true;
        setActivity("headstand");
      }
    }
    velocityRef.current = { x: event.clientX, y: event.clientY, t: event.timeStamp };
  }

  function finishDrag(event) {
    const drag = pointerRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pointerRef.current = null;
    setDragging(false);
    if (drag.moved) {
      updatePosition(positionRef.current, { persist: true });
      window.requestAnimationFrame(() => { suppressClickRef.current = false; });
    }
    if (flingRef.current) {
      flingRef.current = false;
      window.clearTimeout(headstandTimerRef.current);
      headstandTimerRef.current = window.setTimeout(() => setActivity("idle"), HEADSTAND_HOLD_MS);
    }
  }

  function handleClick(event) {
    if (suppressClickRef.current) {
      event.preventDefault();
      return;
    }
    onActivate();
  }

  function handleKeyDown(event) {
    const offsets = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] };
    if (event.key === "Home") {
      event.preventDefault();
      updatePosition(homePosition(), { persist: true });
      return;
    }
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    if (!paused) setAccountPausePreference(true);
    if (offset[0]) setDirection(offset[0] < 0 ? "left" : "right");
    updatePosition({ x: positionRef.current.x + offset[0], y: positionRef.current.y + offset[1] }, { persist: true });
  }

  const activityLabel = celebration?.message || {
    idle: idleQuip || greeting(firstName),
    walk: "Nova is exploring",
    yarn: "Found my yarn!",
    stretch: "Big stretch!",
    nap: "Quick catnap…",
    nod: "Mhm, mhm!",
    dance: "Dance break!",
    wave: greeting(firstName),
    headstand: "Whoa, upside down!",
    coin: "Ka-ching!",
    sleep: "Nova is sleeping…",
  }[activity];

  const displayedActivity = paused ? "sleep" : activity;
  const displayedActivityLabel = paused ? "Nova is sleeping…" : activityLabel;

  return (
    <div
      ref={petRef}
      className={`nova-pet fixed left-0 top-0 z-0 pointer-events-none ${dragging ? "is-dragging" : ""} is-${displayedActivity}`}
      style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
      data-activity={displayedActivity}
    >
      <div className="nova-pet-bubble pointer-events-none absolute bottom-[94px] left-1/2 w-max max-w-[210px] -translate-x-1/2 text-center rounded-2xl border border-brand-100 bg-white/95 px-3 py-1.5 text-xs font-semibold text-brand-800 opacity-0 shadow-lg transition-opacity">
        {displayedActivityLabel}
      </div>
      <div className="group relative pointer-events-auto">
        <button
          type="button"
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          aria-label="Ask Nova for help. Drag to move Nova, use arrow keys to reposition, or press Home to return Nova to the corner."
          className="nova-pet-button relative flex h-[104px] w-28 cursor-grab touch-none items-end justify-center rounded-[2rem] outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 active:cursor-grabbing"
        >
          <span className={`block transition-transform ${direction === "left" ? "-scale-x-100" : "scale-x-100"}`}>
            <NovaCatArt activity={displayedActivity} />
          </span>
        </button>
        <button
          type="button"
          onClick={() => setAccountPausePreference(!paused)}
          aria-label={paused ? "Resume Nova’s playful movement" : "Pause Nova’s playful movement"}
          aria-pressed={paused}
          className="nova-pet-pause absolute -right-1 top-0 flex h-9 w-9 items-center justify-center rounded-full border border-brand-100 bg-white text-brand-700 opacity-0 shadow-md transition hover:bg-brand-50 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 group-hover:opacity-100"
        >
          {paused ? <Play className="h-4 w-4 fill-current" aria-hidden="true" /> : <Pause className="h-4 w-4 fill-current" aria-hidden="true" />}
        </button>
        {PersonaIcon ? (
          <span
            title={persona}
            className="pointer-events-none absolute -left-1 top-0 flex h-7 w-7 items-center justify-center rounded-full border border-brand-100 bg-white text-brand-700 shadow-md"
          >
            <PersonaIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        ) : null}
      </div>
    </div>
  );
}
