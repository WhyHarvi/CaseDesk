import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

// Real bug: the two persistent bottom-right widgets (GlobalDialpad z-390,
// FloatingChatWidget z-410) sat above IncomingOomaCallAlert (a real,
// always-mounted incoming-call notification), which was still at its old
// z-[70] — so its dismiss/"Open call record" buttons became invisible and
// unclickable underneath the persistent widgets. This guards the layering
// order so a future change to any one of these doesn't silently re-bury it.
//
// A second panel found during this fix (CallsPage.jsx's local "Dialpad"
// function, colliding with FloatingChatWidget at the same corner) turned
// out to be dead code — never instantiated as JSX anywhere — so it was
// removed instead of re-layered; there was nothing real to fix there.
test("floating widgets near the bottom-right corner stay correctly layered — the incoming-call alert never sits below the persistent chat/call widgets", async () => {
  const [globalDialpad, chatWidget, softphoneProvider, oomaAlert, callsPage] = await Promise.all([
    source("../../frontend/src/components/calls/GlobalDialpad.jsx"),
    source("../../frontend/src/components/chat/FloatingChatWidget.jsx"),
    source("../../frontend/src/components/calls/SoftphoneProvider.jsx"),
    source("../../frontend/src/components/communications/IncomingOomaCallAlert.jsx"),
    source("../../frontend/src/pages/CallsPage.jsx"),
  ]);

  assert.match(globalDialpad, /z-\[390\]/);
  assert.match(chatWidget, /z-\[410\]/);
  assert.match(softphoneProvider, /z-\[420\]/);

  assert.match(oomaAlert, /bottom-5 right-5 z-\[425\]/);
  assert.doesNotMatch(oomaAlert, /z-\[70\]/);

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
  assert.match(globalDialpad, /if \(location\.pathname === "\/app\/chats" && !active\) return null;/);
});
