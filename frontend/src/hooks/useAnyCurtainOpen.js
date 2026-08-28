import { useEffect, useState } from "react";

// Every slide-over/side-panel "curtain" in this app shares one root class
// combo, "fixed inset-0", regardless of which page or feature it belongs to
// — but NOT all of them portal to document.body (ClientDrawer/CaseFormDrawer,
// the "Add client"/"Create case" curtains among others, render that root div
// inline in the normal React tree instead), and NOT all of them are actually
// mounted/unmounted when opened/closed. Sidebar's mobile-nav backdrop, for
// one, is always in the DOM with that exact class combo and toggles purely
// via opacity-0/opacity-100 — matching by DOM presence alone made this
// permanently "true" the moment that backdrop existed at all, hiding both
// floating buttons everywhere, always. checkVisibility() is what actually
// tells the two states apart. Their z-index values are all over the place
// (60 through 9999, uncoordinated with the floating phone/chat buttons'
// 390-410 range) — that gap is exactly why those buttons can end up
// visually floating on top of a curtain that happens to sit lower in that
// range. Detecting the shared class combo here means every curtain —
// present and future, portaled or not — is covered for free, with zero
// changes needed in any individual curtain component.
const CURTAIN_SELECTOR = ".fixed.inset-0";

function isVisible(node) {
  if (typeof node.checkVisibility === "function") {
    return node.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  }
  // Older browsers without checkVisibility (Safari < 17.4): at least catch
  // the common "always mounted, toggled via opacity" pattern by hand.
  const style = window.getComputedStyle(node);
  return style.opacity !== "0" && style.visibility !== "hidden" && style.display !== "none";
}

function anyCurtainOpen() {
  if (typeof document === "undefined") return false;
  return Array.from(document.querySelectorAll(CURTAIN_SELECTOR)).some(isVisible);
}

export default function useAnyCurtainOpen() {
  const [open, setOpen] = useState(anyCurtainOpen);

  useEffect(() => {
    const update = () => setOpen(anyCurtainOpen());
    update();
    // attributes+subtree on document.body can fire on any class/style
    // change anywhere in the app, not just curtain-related ones — coalesce
    // to at most one evaluation per animation frame regardless of how many
    // mutations land in a given batch.
    let frame = null;
    const scheduleUpdate = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        update();
      });
    };
    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, {
      // subtree: true — inline (non-portaled) curtains can mount anywhere in
      // the tree, not just as a direct child of body.
      childList: true,
      subtree: true,
      // A curtain that stays mounted and toggles visibility via className
      // (like Sidebar's mobile backdrop) only ever fires an attribute
      // mutation, never a childList one — without this, opening/closing it
      // would never re-evaluate.
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return open;
}
