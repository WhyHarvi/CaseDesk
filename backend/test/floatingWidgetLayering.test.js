import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

// Real bug: the two persistent bottom-right widgets (GlobalDialpad z-390,
// FloatingChatWidget and the active Twilio call overlay must remain ordered.
//
// A second panel found during this fix (CallsPage.jsx's local "Dialpad"
// function, colliding with FloatingChatWidget at the same corner) turned
// out to be dead code — never instantiated as JSX anywhere — so it was
// removed instead of re-layered; there was nothing real to fix there.
test("floating widgets near the bottom-right corner stay correctly layered", async () => {
  const [globalDialpad, chatWidget, softphoneProvider, callsPage] = await Promise.all([
    source("../../frontend/src/components/calls/GlobalDialpad.jsx"),
    source("../../frontend/src/components/chat/FloatingChatWidget.jsx"),
    source("../../frontend/src/components/calls/SoftphoneProvider.jsx"),
    source("../../frontend/src/pages/CallsPage.jsx"),
  ]);

  assert.match(globalDialpad, /z-\[390\]/);
  assert.match(chatWidget, /z-\[410\]/);
  assert.match(softphoneProvider, /z-\[420\]/);

  // The dead local Dialpad function (and the KEYPAD/KEY_LETTERS constants
  // and icon imports it alone used) is gone — GlobalDialpad, opened via
  // openGlobalDialpad(), is the one real dialpad this page uses.
  assert.doesNotMatch(callsPage, /function Dialpad\(/);
  assert.doesNotMatch(callsPage, /aria-label="Phone dialpad"/);
  assert.match(callsPage, /openGlobalDialpad\(\)/);
});

// The actual reported bug: GlobalDialpad/FloatingChatWidget are `fixed
// bottom-6` (a ~56px/h-14 collapsed footprint starting 24px off the bottom
// edge) on every page, but the default page layout only reserved 32px
// (py-8) of bottom padding for its own scrollable content — so real,
// normal-flow content that reaches the bottom of a long page (the
// Dashboard's Appointment Registry Previous/Next pager, any bottom-aligned
// form action, etc.) rendered directly underneath the floating widgets
// with no way to reach it. This isn't a z-index fight — normal content
// always loses to a `position: fixed` element regardless of z-index — so
// the fix is reserving enough space, not layering.
test("the default page layout reserves enough bottom space that normal scrolled content never lands underneath the floating call/chat widgets", async () => {
  const layout = await source("../../frontend/src/layouts/MainLayout.jsx");
  assert.match(layout, /px-6 pt-8 pb-28/);
  assert.doesNotMatch(layout, /px-6 py-8/);
});

// GlobalDialpad is hidden on the Chats page — same reasoning
// FloatingChatWidget already applies there (location.pathname ===
// "/app/chats" — the full page already covers what the floating version
// does). But never mid-call: navigating to Chats during a live call must
// not strand the hang-up/mute controls, so the hide is conditioned on
// !active, not applied unconditionally.
test("GlobalDialpad hides on the Chats page like FloatingChatWidget already does, but never while a call is actually active", async () => {
  const [globalDialpad, chatWidget] = await Promise.all([
    source("../../frontend/src/components/calls/GlobalDialpad.jsx"),
    source("../../frontend/src/components/chat/FloatingChatWidget.jsx"),
  ]);
  assert.match(chatWidget, /location\.pathname === "\/app\/chats"/);

  assert.match(globalDialpad, /import \{ useLocation \} from "react-router-dom";/);
  assert.match(globalDialpad, /if \(\(location\.pathname === "\/app\/chats" \|\| curtainOpen\) && !active\) return null;/);
});

// Real bug: curtain z-index values across the app span 60-9999, never
// coordinated with these two floating buttons' 390/410 range — so a curtain
// sitting anywhere below ~390-410 let the dialpad/chat button visibly float
// on top of it. Rather than retrofitting the ~80 individual curtain
// components to opt in, useAnyCurtainOpen detects the shared root class
// combo ("fixed inset-0") every one of them uses — new curtains are covered
// automatically, with zero changes needed anywhere else.
//
// First version of this fix only checked document.body's DIRECT children,
// on the assumption every curtain portals there (most do). ClientDrawer and
// CaseFormFrawer (the "Add client"/"Create case" curtains, among others)
// instead render their "fixed inset-0" root inline in the normal React
// tree — so that version never caught them. Fixed by searching the whole
// document (observer subtree: true) instead of just body's direct children.
test("the phone and chat floating buttons hide behind any open curtain, whether it portals to document.body or renders inline deep in the tree", async () => {
  const [hook, globalDialpad, chatWidget] = await Promise.all([
    source("../../frontend/src/hooks/useAnyCurtainOpen.js"),
    source("../../frontend/src/components/calls/GlobalDialpad.jsx"),
    source("../../frontend/src/components/chat/FloatingChatWidget.jsx"),
  ]);

  assert.match(hook, /const CURTAIN_SELECTOR = "\.fixed\.inset-0";/);
  assert.doesNotMatch(hook, /:scope >/);
  assert.match(hook, /document\.querySelector\(CURTAIN_SELECTOR\)/);
  assert.match(hook, /new MutationObserver\(update\)/);
  assert.match(hook, /observer\.observe\(document\.body, \{ childList: true, subtree: true \}\)/);
  assert.match(hook, /export default function useAnyCurtainOpen\(\)/);

  assert.match(globalDialpad, /import useAnyCurtainOpen from "\.\.\/\.\.\/hooks\/useAnyCurtainOpen";/);
  assert.match(globalDialpad, /const curtainOpen = useAnyCurtainOpen\(\);/);
  // Never hidden mid-call — same guarantee the Chats-page hide already had.
  assert.match(globalDialpad, /if \(\(location\.pathname === "\/app\/chats" \|\| curtainOpen\) && !active\) return null;/);

  assert.match(chatWidget, /import useAnyCurtainOpen from "\.\.\/\.\.\/hooks\/useAnyCurtainOpen";/);
  assert.match(chatWidget, /const curtainOpen = useAnyCurtainOpen\(\);/);
  // Never hidden while the person already has a conversation open in it —
  // same "don't yank away active engagement" principle as the dialpad's
  // active-call exemption above.
  assert.match(chatWidget, /location\.pathname === "\/app\/chats" \|\| \(curtainOpen && !open\)\) return null;/);

  // The specific regression: confirm ClientDrawer/CaseFormDrawer really do
  // render their curtain inline (not via createPortal) — proving why the
  // direct-children-only version of the selector missed them, and why
  // subtree:true stays load-bearing rather than an unexplained option.
  const [clientsPage, casesPage] = await Promise.all([
    source("../../frontend/src/pages/Clients.jsx"),
    source("../../frontend/src/pages/Cases.jsx"),
  ]);
  assert.match(clientsPage, /fixed inset-0 z-50 flex justify-end bg-slate-950\/30/);
  assert.match(casesPage, /fixed inset-0 z-50 flex justify-end bg-slate-950\/30/);
});
