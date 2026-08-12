// Short send/receive chimes for the Chats page, synthesized on the fly via
// the Web Audio API rather than bundling Apple's actual (copyrighted)
// Messages.app sound assets — these are original tones in the same spirit
// (a quick rising whoosh for send, a bright two-note chime for receive).
let audioContext = null;
let unlockAttached = false;

function ensureContext() {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioContext) {
    try {
      audioContext = new Ctx();
    } catch {
      return null;
    }
  }
  return audioContext;
}

async function resumeIfNeeded(ctx) {
  if (!ctx || ctx.state !== "suspended") return;
  try {
    await ctx.resume();
  } catch {
    // Autoplay policy blocked it (no user gesture yet) — the unlock
    // listener below will catch the next real interaction instead.
  }
}

// Browsers keep a fresh AudioContext suspended until a real user gesture
// unlocks it. A received message plays its chime from a realtime/poll
// callback, which is never itself a gesture — so without this, the very
// first incoming message (before the user has clicked or typed anything)
// would silently fail to play. Unlocking eagerly on the page's first
// interaction, anywhere, fixes that.
function attachUnlockListener() {
  if (unlockAttached || typeof document === "undefined") return;
  unlockAttached = true;
  const unlock = () => {
    const ctx = ensureContext();
    if (ctx) void resumeIfNeeded(ctx);
  };
  document.addEventListener("pointerdown", unlock, { once: true, passive: true });
  document.addEventListener("keydown", unlock, { once: true });
}
attachUnlockListener();

function tone(ctx, { frequency, glideTo, startTime, duration, gain = 0.15 }) {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startTime);
  if (glideTo) oscillator.frequency.exponentialRampToValueAtTime(glideTo, startTime + duration);
  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.008);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}

async function playTones(specs) {
  const ctx = ensureContext();
  if (!ctx) return;
  await resumeIfNeeded(ctx);
  if (ctx.state !== "running") return; // still locked — nothing audible to schedule
  const now = ctx.currentTime;
  for (const spec of specs) {
    tone(ctx, { ...spec, startTime: now + (spec.delay || 0) });
  }
}

export function playSentSound() {
  playTones([{ frequency: 640, glideTo: 1040, duration: 0.1, gain: 0.13 }]).catch(() => {});
}

export function playReceivedSound() {
  playTones([
    { frequency: 880, duration: 0.09, gain: 0.14 },
    { frequency: 1318.5, duration: 0.16, gain: 0.15, delay: 0.08 },
  ]).catch(() => {});
}
