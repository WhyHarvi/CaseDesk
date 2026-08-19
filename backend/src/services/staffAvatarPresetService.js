import { readFile } from "node:fs/promises";
import { createHttpError } from "../utils/http.js";

export const STAFF_AVATAR_PRESETS = Array.from({ length: 12 }, (_, index) => `avatar-${index + 1}`);

export function normalizeAvatarPreset(value, { required = false } = {}) {
  const preset = String(value || "").trim();
  if (!preset && !required) return null;
  if (!STAFF_AVATAR_PRESETS.includes(preset)) {
    throw createHttpError(400, "Choose a valid professional avatar.", "INVALID_AVATAR_PRESET");
  }
  return preset;
}

export function defaultAvatarPreset(userId) {
  let hash = 0;
  for (const character of String(userId || "")) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return STAFF_AVATAR_PRESETS[hash % STAFF_AVATAR_PRESETS.length];
}

export function resolvedAvatarPreset(user) {
  return normalizeAvatarPreset(user?.avatarPreset) || defaultAvatarPreset(user?.id);
}

export async function avatarPresetBuffer(preset) {
  const safePreset = normalizeAvatarPreset(preset, { required: true });
  return readFile(new URL(`../../assets/staff-avatars/${safePreset}.png`, import.meta.url));
}
