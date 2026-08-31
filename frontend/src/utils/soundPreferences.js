import {
  NOTIFICATION_SOUND_ASSETS,
  RINGTONE_ASSETS,
} from "virtual:casedesk-sound-assets";

export const SOUND_PREFERENCES_KEY = "casedesk:sound-preferences:v1";
export const SOUND_PREFERENCES_EVENT = "casedesk:sound-preferences-changed";

function soundLabel(fileName) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export const RINGTONES = RINGTONE_ASSETS.map((asset) => ({
  ...asset,
  label: soundLabel(asset.fileName),
}));

export const NOTIFICATION_SOUNDS = [
  { id: "default", label: "Default", src: "" },
  ...NOTIFICATION_SOUND_ASSETS.map((asset) => ({
    ...asset,
    label: soundLabel(asset.fileName),
  })),
];

export const DEFAULT_SOUND_PREFERENCES = Object.freeze({
  ringtoneId: RINGTONES[0]?.id || "",
  ringtoneVolume: 80,
  additionalOutputId: "",
  additionalOutputLabel: "",
  notificationSoundsEnabled: true,
  notificationSoundId: "default",
  notificationVolume: 55,
});

function clampVolume(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(100, Math.max(0, Math.round(numeric)))
    : fallback;
}

function normalizePreferences(value = {}) {
  const ringtoneId = RINGTONES.some((ringtone) => ringtone.id === value.ringtoneId)
    ? value.ringtoneId
    : DEFAULT_SOUND_PREFERENCES.ringtoneId;
  return {
    ringtoneId,
    ringtoneVolume: clampVolume(value.ringtoneVolume, DEFAULT_SOUND_PREFERENCES.ringtoneVolume),
    additionalOutputId: String(value.additionalOutputId || ""),
    additionalOutputLabel: String(value.additionalOutputLabel || ""),
    notificationSoundsEnabled: value.notificationSoundsEnabled !== false,
    notificationSoundId: NOTIFICATION_SOUNDS.some((sound) => sound.id === value.notificationSoundId)
      ? value.notificationSoundId
      : DEFAULT_SOUND_PREFERENCES.notificationSoundId,
    notificationVolume: clampVolume(value.notificationVolume, DEFAULT_SOUND_PREFERENCES.notificationVolume),
  };
}

export function getSoundPreferences() {
  if (typeof window === "undefined") return { ...DEFAULT_SOUND_PREFERENCES };
  try {
    const stored = JSON.parse(window.localStorage.getItem(SOUND_PREFERENCES_KEY) || "{}");
    return normalizePreferences(stored);
  } catch {
    return { ...DEFAULT_SOUND_PREFERENCES };
  }
}

export function updateSoundPreferences(patch) {
  const next = normalizePreferences({ ...getSoundPreferences(), ...patch });
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SOUND_PREFERENCES_KEY, JSON.stringify(next));
    } catch {
      // Restricted storage should not prevent sound controls from working
      // for the current interaction.
    }
    window.dispatchEvent(new CustomEvent(SOUND_PREFERENCES_EVENT, { detail: next }));
  }
  return next;
}

export function subscribeToSoundPreferences(listener) {
  if (typeof window === "undefined") return () => {};
  const onPreferenceChange = (event) => listener(event.detail || getSoundPreferences());
  const onStorage = (event) => {
    if (event.key === SOUND_PREFERENCES_KEY) listener(getSoundPreferences());
  };
  window.addEventListener(SOUND_PREFERENCES_EVENT, onPreferenceChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SOUND_PREFERENCES_EVENT, onPreferenceChange);
    window.removeEventListener("storage", onStorage);
  };
}

function selectedRingtone(preferences) {
  return RINGTONES.find((ringtone) => ringtone.id === preferences.ringtoneId) || RINGTONES[0];
}

export function startConfiguredRingtone({ loop = true } = {}) {
  const preferences = getSoundPreferences();
  const ringtone = selectedRingtone(preferences);
  const activeAudio = new Set();
  let stopped = false;

  const stop = () => {
    stopped = true;
    for (const audio of activeAudio) {
      audio.pause();
      audio.currentTime = 0;
    }
    activeAudio.clear();
  };

  if (!ringtone) return { stop() {} };

  const createPlayer = () => {
    const audio = new Audio(ringtone.src);
    audio.loop = loop;
    audio.preload = "auto";
    audio.volume = preferences.ringtoneVolume / 100;
    activeAudio.add(audio);
    return audio;
  };

  const defaultAudio = createPlayer();
  void defaultAudio.play().catch(() => activeAudio.delete(defaultAudio));

  if (preferences.additionalOutputId && typeof defaultAudio.setSinkId === "function") {
    const additionalAudio = createPlayer();
    void additionalAudio
      .setSinkId(preferences.additionalOutputId)
      .then(() => {
        if (stopped) return;
        return additionalAudio.play();
      })
      .catch(() => activeAudio.delete(additionalAudio));
  }

  return { stop };
}

export function playConfiguredNotificationSound() {
  const preferences = getSoundPreferences();
  if (!preferences.notificationSoundsEnabled || preferences.notificationVolume <= 0) return false;
  const sound = NOTIFICATION_SOUNDS.find((item) => item.id === preferences.notificationSoundId);
  if (!sound?.src) return false;
  const audio = new Audio(sound.src);
  audio.preload = "auto";
  audio.volume = preferences.notificationVolume / 100;
  void audio.play().catch(() => {});
  return true;
}
