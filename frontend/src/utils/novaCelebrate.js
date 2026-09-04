// A tiny, framework-free pub/sub over a window CustomEvent — same pattern
// FloatingChatWidget already uses for "casedesk:phone-float-state" to react
// to something that happened elsewhere in the app. api.js's mutate() fires
// this after a handful of specific successful mutations (new client, lead
// converted, appointment booked, manual payment, case submitted); the cat
// (mounted once at the layout level, so it hears this regardless of which
// page triggered it) reacts to it. Dependency-free on purpose so api.js's
// transport layer can call it without importing React.
const EVENT_NAME = "casedesk:nova-celebrate";

export function celebrateNova(type) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { type } }));
}

export function onNovaCelebrate(handler) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
