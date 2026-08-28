import { useEffect, useState } from "react";

// Every slide-over/side-panel "curtain" in this app follows the same
// convention regardless of which page or feature it belongs to: portaled
// straight to document.body as a direct child, root class "fixed inset-0".
// Their z-index values are all over the place (60 through 9999, uncoordinated
// with the floating phone/chat buttons' 390-420 range) — that gap is exactly
// why those buttons can end up visually floating on top of a curtain that
// happens to sit lower in that range. Detecting the shared DOM pattern here
// means every curtain — present and future — is covered for free, with zero
// changes needed in any individual curtain component.
const CURTAIN_SELECTOR = ":scope > .fixed.inset-0";

function anyCurtainOpen() {
  if (typeof document === "undefined") return false;
  return document.body.querySelector(CURTAIN_SELECTOR) !== null;
}

export default function useAnyCurtainOpen() {
  const [open, setOpen] = useState(anyCurtainOpen);

  useEffect(() => {
    const update = () => setOpen(anyCurtainOpen());
    update();
    // Portals mount/unmount as direct children of body, so a shallow
    // childList observation (no subtree) catches every curtain opening or
    // closing anywhere in the app.
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, []);

  return open;
}
