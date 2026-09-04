import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("the playful Nova cat opens the existing Nova conversation without blocking CRM work", async () => {
  const [widget, mascot, novaChat, styles] = await Promise.all([
    source("../../frontend/src/components/chat/FloatingChatWidget.jsx"),
    source("../../frontend/src/components/chat/NovaCatMascot.jsx"),
    source("../../frontend/src/hooks/useNovaChat.js"),
    source("../../frontend/src/index.css"),
  ]);

  assert.match(widget, /import NovaCatMascot from "\.\/NovaCatMascot";/);
  assert.match(widget, /!open && !incomingPreview \? <NovaCatMascot/);
  assert.match(widget, /function openNovaFromMascot\(\)[\s\S]*setOpen\(true\);[\s\S]*selectConversation\(novaItem\);/);

  assert.match(mascot, /<button/);
  assert.match(mascot, /aria-label="Ask Nova for help\./);
  assert.match(mascot, /onClick=\{handleClick\}/);
  assert.doesNotMatch(mascot, /<img/);

  assert.match(mascot, /onPointerMove=\{handlePointerMove\}/);
  assert.match(mascot, /DRAG_THRESHOLD = 6/);
  assert.match(mascot, /ArrowLeft/);
  assert.match(mascot, /event\.key === "Home"/);
  assert.match(mascot, /Pause Nova’s playful movement/);
  assert.match(mascot, /activity === "yarn"/);
  assert.match(mascot, /activity === "nap"/);
  assert.match(mascot, /useReducedMotion\(\)/);
  assert.match(mascot, /window\.localStorage\.setItem\(STORAGE_KEY/);

  assert.match(novaChat, /Hi, I’m Nova\. How can I help you\?/);
  assert.match(styles, /\.nova-pet \{[\s\S]*transition: transform 4\.2s/);
  assert.match(styles, /@keyframes nova-pet-yarn-roll/);
  assert.match(styles, /@keyframes nova-pet-stretch/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("the cat is only ever mounted in the staff app, never the client portal", async () => {
  const [mainLayout, portalLayout] = await Promise.all([
    source("../../frontend/src/layouts/MainLayout.jsx"),
    source("../../frontend/src/components/client-portal/ClientPortalLayout.jsx"),
  ]);
  assert.match(mainLayout, /<FloatingChatWidget \/>/);
  assert.doesNotMatch(portalLayout, /FloatingChatWidget|NovaCatMascot/);
});

test("the cat waves hello by name, drops in random idle quips, nods, dances, and flips into a headstand on a fast fling", async () => {
  const [widget, mascot, styles] = await Promise.all([
    source("../../frontend/src/components/chat/FloatingChatWidget.jsx"),
    source("../../frontend/src/components/chat/NovaCatMascot.jsx"),
    source("../../frontend/src/index.css"),
  ]);

  // The greeting is personalized with the signed-in staff member's own
  // first name, falling back to the full name's first word (firstName is
  // optional on User — mainly populated for government forms) rather than
  // a hardcoded generic name.
  assert.match(widget, /const novaFirstName = appUser\?\.firstName \|\| appUser\?\.fullName\?\.split\(" "\)\[0\] \|\| "";/);
  assert.match(widget, /<NovaCatMascot key=\{location\.pathname\} onActivate=\{openNovaFromMascot\} firstName=\{novaFirstName\} currentPath=\{location\.pathname\} \/>/);
  assert.match(mascot, /function greeting\(firstName\) \{\s*\n\s*return firstName \? `Hi, \$\{firstName\}!` : "Hi, I’m Nova";/);
  assert.match(mascot, /wave: greeting\(firstName\),/);
  assert.match(mascot, /window\.setTimeout\(\(\) => setActivity\("wave"\), 700\);/);

  // Idle isn't a single fixed string any more — it rotates through a real
  // pool of quips instead of one hardcoded line always showing.
  assert.match(mascot, /const IDLE_QUIPS = \[/);
  assert.match(mascot, /idle: idleQuip \|\| greeting\(firstName\),/);
  assert.match(mascot, /if \(activity !== "idle" \|\| reduceMotion \|\| paused\) return undefined;/);

  // Nod and dance are two more entries in the same random activity
  // rotation walk/yarn/stretch/nap already use, not a separate system.
  assert.match(mascot, /setActivity\("nod"\);/);
  assert.match(mascot, /setActivity\("dance"\);/);
  assert.match(styles, /\.nova-pet\[data-activity="nod"\] \.nova-pet-head \{[\s\S]*animation: nova-pet-nod/);
  assert.match(styles, /\.nova-pet\[data-activity="dance"\] \.nova-pet-body \{[\s\S]*animation: nova-pet-dance/);

  // A hard, fast drag (not an ordinary drag) flips the cat into a
  // headstand — velocity is measured between consecutive pointermove
  // events, gated on reduced-motion, and distinct from the drag-threshold
  // check that merely starts a drag.
  assert.match(mascot, /const FLING_SPEED_PX_MS = 1\.5;/);
  assert.match(mascot, /const speed = Math\.hypot\(event\.clientX - last\.x, event\.clientY - last\.y\) \/ elapsed;\s*\n\s*if \(!reduceMotion && speed > FLING_SPEED_PX_MS\) \{/);
  assert.match(mascot, /headstandTimerRef\.current = window\.setTimeout\(\(\) => setActivity\("idle"\), HEADSTAND_HOLD_MS\);/);
  // Headstand must win visually over the plain "you're dragging me" style
  // even while still mid-drag, which needs a more specific selector than
  // source order alone to guarantee.
  assert.match(styles, /\.nova-pet\.is-dragging\[data-activity="headstand"\] \.nova-pet-body,\s*\n\.nova-pet\[data-activity="headstand"\] \.nova-pet-body \{/);
  assert.match(styles, /@keyframes nova-pet-headstand/);

  // The autonomous-activity scheduler must not stomp a mid-drag headstand
  // (or the idle reset handlePointerDown already applied) back to idle —
  // it only stops scheduling *new* activity while dragging.
  const schedulerStart = mascot.indexOf('useEffect(() => {\n    if (reduceMotion || paused) {');
  const schedulerGuard = mascot.slice(schedulerStart, mascot.indexOf("let cancelled = false;", schedulerStart));
  assert.match(schedulerGuard, /if \(dragging\) return undefined;/);
  assert.doesNotMatch(schedulerGuard, /if \(reduceMotion \|\| paused \|\| dragging\)/);
});

test("the cat and the chat panel share one entity-aware insight fetch — explicit context, no path re-parsing on the backend", async () => {
  const [insightService, widget, mascot, presentation] = await Promise.all([
    source("../src/services/aiInsightService.js"),
    source("../../frontend/src/components/chat/FloatingChatWidget.jsx"),
    source("../../frontend/src/components/chat/NovaCatMascot.jsx"),
    source("../../frontend/src/components/chat/NovaChatPresentation.jsx"),
  ]);

  // Both the cat and the chat panel resolve entityType/entityId on the
  // frontend from the same two routes and send them explicitly, rather
  // than the backend re-parsing req.query.path itself.
  assert.match(mascot, /function entityFromPath\(path\) \{\s*\n\s*const client = \/\^\\\/app\\\/clients\\\/\(\[\^\/\]\+\)\/\.exec\(String\(path \|\| ""\)\);/);
  assert.match(presentation, /function entityFromPath\(path\) \{\s*\n\s*const client = \/\^\\\/app\\\/clients\\\/\(\[\^\/\]\+\)\/\.exec\(String\(path \|\| ""\)\);/);
  assert.match(mascot, /api\.get\("\/ai\/proactive-insight", \{ params: \{ path: currentPath, \.\.\.\(entity \|\| \{\}\) \} \}\)/);
  assert.match(presentation, /api\s*\n?\s*\.get\("\/ai\/proactive-insight", \{ params: \{ path: currentPath, \.\.\.\(entityFromPath\(currentPath\) \|\| \{\}\) \} \}\)/);

  // The backend verifies tenant + access before ever running the
  // priority-chain checks — see aiInsightService.test.js for the behavioral
  // coverage of that; this just confirms the entity path actually exists
  // and the ENTITY_TYPES allowlist keeps the query param honest.
  assert.match(insightService, /async function resolveEntityNovaInsight\(req, \{ entityType, entityId, db, now \}\) \{/);
  assert.match(insightService, /if \(entityType !== "client" && entityType !== "case"\) return null;/);

  // Persona comes from the backend's response, not a second frontend guess
  // at what page/entity this is — the mascot only maps that string to an
  // icon and (for the panel) a suggested prompt.
  assert.doesNotMatch(mascot, /PAGE_PERSONAS|personaForPath/);
  assert.match(mascot, /const persona = insight\?\.persona && insight\.persona !== "Nova" \? insight\.persona : "";/);
  assert.match(mascot, /"Client assistant": UserRound,/);
  assert.match(mascot, /"Collections assistant": DollarSign,/);

  // Don't nag: an insight already shown once (tracked by its stable id in
  // localStorage) just joins the ambient idle-quip rotation instead of
  // forcing itself into the bubble and a notice pose on every page visit —
  // only a genuinely new/changed insight (a different id) does that.
  assert.match(mascot, /let lastSeenId = "";/);
  assert.match(mascot, /if \(next\.id === lastSeenId\) return;/);
  assert.match(mascot, /window\.localStorage\.setItem\(SEEN_INSIGHT_KEY, next\.id\);/);
  // A new attention/urgent insight gets a brief "nod" (noticing) pose, not
  // a permanent one — it's on its own short revert timer, independent of
  // the drag-fling headstand's.
  assert.match(mascot, /if \(!reduceMotion && \(next\.severity === "attention" \|\| next\.severity === "urgent"\)\) \{\s*\n\s*setActivity\("nod"\);/);
  assert.match(mascot, /noticeTimerRef\.current = window\.setTimeout\(\(\) => setActivity\("idle"\), 1800\);/);
  assert.match(mascot, /const pool = \[insight\?\.message, persona, \.\.\.IDLE_QUIPS\]\.filter\(\(quip\) => quip && quip !== current\);/);

  // The chat panel fetches once (gated on actually being visible, so it
  // isn't duplicated with the cat's own fetch — the two are never mounted
  // at the same time anyway) and both NovaProactiveInsight and
  // NovaSuggestions read off that single result.
  assert.match(widget, /const novaPanelVisible = view === "thread" && Boolean\(selectedId\) && activeDetail\?\.kind === "ai" && novaMessages\.length === 1;/);
  assert.match(widget, /const novaInsight = useNovaProactiveInsight\(location\.pathname, \{ enabled: novaPanelVisible \}\);/);
  assert.match(widget, /<NovaProactiveInsight insight=\{novaInsight\} compact \/>/);
  assert.match(widget, /<NovaSuggestions onSelect=\{setDraft\} currentPath=\{location\.pathname\} persona=\{novaInsight\?\.persona\} compact \/>/);

  // The insight is plain text with a structured action now (never markdown
  // to parse), and persona changes the suggested prompt but nothing about
  // which actions are available.
  assert.match(presentation, /export function NovaProactiveInsight\(\{ insight, compact = false \}\) \{/);
  assert.match(presentation, /<Link to=\{insight\.action\.href\}/);
  assert.match(presentation, /const PERSONA_SUGGESTIONS = Object\.freeze\(\{/);
  assert.match(presentation, /"Collections assistant": "Which clients have outstanding balances\?",/);
});

test("the cat celebrates specific real events (new client, lead converted, appointment booked, case submitted, payment received) via one shared funnel, not scattered per-form hooks", async () => {
  const [celebrateUtil, apiClient, mascot] = await Promise.all([
    source("../../frontend/src/utils/novaCelebrate.js"),
    source("../../frontend/src/services/api.js"),
    source("../../frontend/src/components/chat/NovaCatMascot.jsx"),
  ]);

  // A dependency-free window CustomEvent pub/sub — same convention
  // FloatingChatWidget already uses for "casedesk:phone-float-state" — so
  // api.js's transport layer can fire it without importing React.
  assert.match(celebrateUtil, /const EVENT_NAME = "casedesk:nova-celebrate";/);
  assert.match(celebrateUtil, /export function celebrateNova\(type\) \{/);
  assert.match(celebrateUtil, /export function onNovaCelebrate\(handler\) \{/);

  // Every mutation in the app funnels through api.js's mutate() regardless
  // of which component issued it, so that's the one place this needs to be
  // recognized — not five separate form components, which is fragile (the
  // client-create call alone already exists in two different components).
  assert.match(apiClient, /import { celebrateNova } from "\.\.\/utils\/novaCelebrate";/);
  assert.match(apiClient, /function celebrationForMutation\(method, url, lifecycleTarget, response\) \{/);
  assert.match(apiClient, /if \(method === "post" && path === "\/clients"\) return "client_created";/);
  assert.match(apiClient, /if \(method === "post" && \/\^\\\/leads\\\/\[\^\/\]\+\\\/convert\$\/\.test\(path\)\) return "lead_converted";/);
  assert.match(apiClient, /if \(method === "post" && path === "\/appointments"\) return "appointment_booked";/);
  assert.match(apiClient, /manual-payment\$\/\.test\(path\)\)\) return "payment_received";/);
  // Only an actual Submitted transition counts, not an unrelated edit to an
  // already-submitted case that happens to still carry stage: "Submitted"
  // in its payload — mutateCaseLifecycle's no-op branch returns a plain
  // case-patch response with no .lifecycle key, so that's what gates it.
  assert.match(apiClient, /if \(lifecycleTarget\?\.stage === "Submitted" && response\?\.data\?\.lifecycle\) return "case_submitted";/);
  assert.match(apiClient, /const celebration = celebrationForMutation\(method, url, lifecycleTarget, response\);\s*\n\s*if \(celebration\) celebrateNova\(celebration\);/);

  // The cat listens globally (it's mounted once at the layout level) and
  // reacts with a specific pose + message per type — four reuse an
  // existing autonomous-rotation activity (message overridden for the
  // duration via `celebration` state), payment gets its own dedicated pose.
  assert.match(mascot, /import { onNovaCelebrate } from "\.\.\/\.\.\/utils\/novaCelebrate";/);
  assert.match(mascot, /const CELEBRATIONS = Object\.freeze\(\{/);
  assert.match(mascot, /client_created: \{ activity: "wave", message: "New client! Welcome aboard\." \},/);
  assert.match(mascot, /lead_converted: \{ activity: "dance", message: "Lead converted!" \},/);
  assert.match(mascot, /appointment_booked: \{ activity: "nod", message: "Appointment booked\." \},/);
  assert.match(mascot, /case_submitted: \{ activity: "dance", message: "Case submitted!" \},/);
  assert.match(mascot, /payment_received: \{ activity: "coin", message: "Payment received!" \},/);
  assert.match(mascot, /return onNovaCelebrate\(\(event\) => \{/);
  assert.match(mascot, /const config = CELEBRATIONS\[event\.detail\?\.type\];/);
  assert.match(mascot, /celebrateTimerRef\.current = window\.setTimeout\(\(\) => \{\s*\n\s*setCelebration\(null\);\s*\n\s*setActivity\("idle"\);\s*\n\s*\}, CELEBRATION_HOLD_MS\);/);
  assert.match(mascot, /const activityLabel = celebration\?\.message \|\| \{/);
  assert.match(mascot, /activity === "coin"/);
  assert.match(mascot, /className="nova-pet-coin"/);
});
