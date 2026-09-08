import { useSyncExternalStore } from "react";

const STORAGE_KEY = "casedesk:nova-cat-visible";

function readStoredVisibility() {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

let visible = readStoredVisibility();
const listeners = new Set();

function publish(next) {
  const value = Boolean(next);
  if (visible === value) return;
  visible = value;
  listeners.forEach((listener) => listener());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) publish(event.newValue !== "false");
  });
}

export function setNovaCatVisible(next) {
  const value = Boolean(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // The preference remains active for this session when storage is unavailable.
  }
  publish(value);
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return visible;
}

export function useNovaCatVisibility() {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
