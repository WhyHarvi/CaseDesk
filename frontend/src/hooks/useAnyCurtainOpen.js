import { useEffect, useState } from "react";

// Every slide-over/side-panel "curtain" in this app shares one root class
// combo, "fixed inset-0", regardless of which page or feature it belongs to
// — but NOT all of them portal to document.body. Most do (AppointmentProfile
// Overlay, ClientEditDrawer, etc.), but ClientDrawer/CaseFormDrawer (the
// "Add client"/"Create case" curtains, among others) render that root div
// inline in the normal React tree instead — so this has to search the whole
// document, not just body's direct children, or those specific curtains are
// invisible to it. Their z-index values are all over the place (60 through
// 9999, uncoordinated with the floating phone/chat buttons' 390-410 range)
// — that gap is exactly why those buttons can end up visually floating on
// top of a curtain that happens to sit lower in that range. Detecting the
// shared class combo here means every curtain — present and future,
// portaled or not — is covered for free, with zero changes needed in any
// individual curtain component.
const CURTAIN_SELECTOR = ".fixed.inset-0";

function anyCurtainOpen() {
  if (typeof document === "undefined") return false;
  return document.querySelector(CURTAIN_SELECTOR) !== null;
}

export default function useAnyCurtainOpen() {
  const [open, setOpen] = useState(anyCurtainOpen);

  useEffect(() => {
    const update = () => setOpen(anyCurtainOpen());
    update();
    // subtree: true because inline (non-portaled) curtains can mount
    // anywhere in the tree, not just as a direct child of body.
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return open;
}
