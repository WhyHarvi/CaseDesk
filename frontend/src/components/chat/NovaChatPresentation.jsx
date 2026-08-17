import { Fragment, useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Link } from "react-router-dom";
import api from "../../services/api";
import { useTypewriter } from "../../hooks/useTypewriter";

// Nova's identity is a restrained, faceted star crossing an orbital ring.
// It is an abstract product logo—no face, mascot, or letter monogram—and
// uses only CaseDesk's established navy and blue palette.
export function NovaAssistantAvatar({ compact = false, pulse = false, className = "" }) {
  const sizeClass = className || (compact ? "h-7 w-7" : "h-8 w-8");

  return (
    <span
      className={`relative flex shrink-0 overflow-hidden rounded-full shadow-[0_5px_18px_rgba(49,61,84,0.3)] ring-1 ring-inset ring-white/20 ${sizeClass} ${pulse ? "animate-[nova-pulse_1.8s_ease-in-out_infinite] motion-reduce:animate-none" : ""}`}
    >
      <svg viewBox="0 0 64 64" className="h-full w-full" fill="none" aria-hidden="true">
        <circle cx="32" cy="32" r="32" fill="#313D54" />
        <circle cx="32" cy="32" r="24" fill="#364864" />
        <ellipse cx="32" cy="32" rx="25" ry="10" transform="rotate(-27 32 32)" stroke="#7F9FC9" strokeWidth="2" opacity="0.9" />
        <circle cx="53.5" cy="20.5" r="2.7" fill="#CDDCEC" />
        <path d="M32 8L36.8 27.2L32 32L27.2 27.2L32 8Z" fill="#E7EEF7" />
        <path d="M56 32L36.8 36.8L32 32L36.8 27.2L56 32Z" fill="#A8C0DD" />
        <path d="M32 56L27.2 36.8L32 32L36.8 36.8L32 56Z" fill="#7F9FC9" />
        <path d="M8 32L27.2 27.2L32 32L27.2 36.8L8 32Z" fill="white" />
        <circle cx="32" cy="32" r="3.5" fill="#496895" />
      </svg>
    </span>
  );
}

const DEFAULT_SUGGESTIONS = [
  "How do I change appointment hours?",
  "How do I request access to a case?",
  "Where do I transfer a lead?",
];

// Checked in order, most specific path first (e.g. a client/case profile
// before the plain list route it's nested under) — the first match wins.
// Mirrors the route vocabulary ollama.service.js's NAVIGATION_CONTEXT
// already teaches Nova, so every suggestion here is something it can
// actually answer well, not a guess at what might be useful.
const PATH_SUGGESTIONS = [
  { test: (path) => /^\/leads\/review/.test(path), suggestions: ["How do I promote a lead to the pipeline?", "What does 'needs review' mean here?", "How do I bulk import leads?"] },
  { test: (path) => /^\/leads/.test(path), suggestions: ["Where do I transfer a lead?", "How do I set up auto-assignment rules?", "How do I bulk reassign leads?"] },
  { test: (path) => /^\/app\/clients\/[^/]+/.test(path), suggestions: ["How do I edit this client's details?", "Where do I see this client's cases?", "How do I archive this client?"] },
  { test: (path) => /^\/app\/clients/.test(path), suggestions: ["How do I add a new client?", "How do I search for a client?"] },
  { test: (path) => /^\/app\/cases\/[^/]+/.test(path), suggestions: ["How do I upload a document to this case?", "How do I request access to this case?", "How do I change the case stage?"] },
  { test: (path) => /^\/app\/cases/.test(path), suggestions: ["How do I create a new case?", "How do I filter cases by stage?"] },
  { test: (path) => /^\/app\/calendar/.test(path), suggestions: ["How do I change appointment hours?", "How do I book a consultation?", "Where do no-shows get recorded?"] },
  { test: (path) => /^\/app\/payments/.test(path), suggestions: ["Where do I see a client's payment history?", "How do I record a manual payment?"] },
  { test: (path) => /^\/app\/workload/.test(path), suggestions: ["How do I see who's overloaded?", "Where do I reassign work?"] },
  { test: (path) => /^\/app\/team-members/.test(path), suggestions: ["How do I add a new staff member?", "How do I change someone's role?"] },
  { test: (path) => /^\/app\/documents/.test(path), suggestions: ["How do I review a pending document?", "Where do document templates come from?"] },
  { test: (path) => /^\/app\/follow-ups/.test(path), suggestions: ["How do I mark a follow-up complete?", "Where do overdue follow-ups show up?"] },
  { test: (path) => /^\/app\/case-easy-import/.test(path), suggestions: ["How do I import Case Easy data?", "How do I convert an imported contact?"] },
  { test: (path) => /^\/app\/settings/.test(path), suggestions: ["Where do I connect QuickBooks?", "How do I set up auto-assignment rules?"] },
  { test: (path) => /^\/app\/dashboard/.test(path), suggestions: ["What does the overdue count mean?", "Where do I check team workload?"] },
  { test: (path) => /^\/calls/.test(path), suggestions: ["How do I see missed calls?", "Where do call recordings show up?"] },
];

export function novaSuggestionsForPath(path) {
  return PATH_SUGGESTIONS.find((entry) => entry.test(String(path || "")))?.suggestions || DEFAULT_SUGGESTIONS;
}

function inlineContent(text) {
  const tokens = String(text || "").split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]\n]+\]\(\/[A-Za-z0-9?&=_/.:%-]+\)|\/(?:app(?:\/[A-Za-z0-9?&=_/.:%-]+)?|leads(?:\/[A-Za-z0-9?&=_/.:%-]*)?|calls(?:\/[A-Za-z0-9?&=_/.:%-]*)?|lead-(?:dashboard|reports)(?:\/[A-Za-z0-9?&=_/.:%-]*)?))/g);
  return tokens.map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**")) {
      return <strong key={index} className="font-semibold text-slate-950">{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("`") && token.endsWith("`")) {
      return <code key={index} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[12px] font-semibold text-brand-800">{token.slice(1, -1)}</code>;
    }
    const markdownLink = token.match(/^\[([^\]]+)\]\((\/[A-Za-z0-9?&=_/.:%-]+)\)$/);
    if (markdownLink) {
      return <Link key={index} to={markdownLink[2]} className="font-semibold text-brand-700 underline decoration-brand-200 underline-offset-2 hover:text-brand-900">{markdownLink[1]}</Link>;
    }
    if (/^\/(?:app(?:\/|$)|leads(?:\/|$)|calls(?:\/|$)|lead-(?:dashboard|reports)(?:\/|$))/.test(token)) {
      return <Link key={index} to={token} className="font-semibold text-brand-700 underline decoration-brand-200 underline-offset-2 hover:text-brand-900">{token}</Link>;
    }
    return <Fragment key={index}>{token}</Fragment>;
  });
}

// animate: true reveals the reply with a brief typewriter effect (only ever
// passed for a message that just arrived — see ChatMessageBubble's isNew —
// never for history already on screen). Reveals raw markdown progressively,
// so a bold/link token can flash its raw ** or /app/ text for an instant
// before it completes and snaps to formatted — the same tradeoff every
// streaming chat UI with markdown makes.
export function NovaMessageContent({ text, animate = false }) {
  const revealed = useTypewriter(text, animate);
  const lines = revealed.split("\n");
  return (
    <div className="space-y-2 text-[14px] leading-6 text-slate-700">
      {lines.map((line, index) => {
        const numbered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
        const bullet = line.match(/^\s*[-•]\s+(.+)$/);
        if (!line.trim()) return <div key={index} className="h-1" />;
        if (numbered) {
          return (
            <div key={index} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-50 text-[10px] font-bold text-brand-700">{numbered[1]}</span>
              <p className="min-w-0 flex-1">{inlineContent(numbered[2])}</p>
            </div>
          );
        }
        if (bullet) {
          return (
            <div key={index} className="flex items-start gap-2.5">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
              <p className="min-w-0 flex-1">{inlineContent(bullet[1])}</p>
            </div>
          );
        }
        return <p key={index}>{inlineContent(line)}</p>;
      })}
    </div>
  );
}

// Modeled on the "thinking" state in Claude's own chat UI: a slow-breathing
// glow on the avatar and a soft shimmer sweeping across the label — no
// bouncing dots. Reasoning reads as continuous, quiet work, not a cartoon
// "..." — and there's nothing here to fake progress with, so it never
// implies a finish line the way a progress bar would.
export function NovaThinkingIndicator() {
  return (
    <div className="flex items-end gap-2">
      <NovaAssistantAvatar compact pulse />
      <div className="flex items-center rounded-3xl rounded-bl-lg border border-brand-100 bg-white px-4 py-3 shadow-sm">
        <span className="bg-gradient-to-r from-slate-400 via-brand-700 to-slate-400 bg-[length:200%_auto] bg-clip-text text-[11px] font-semibold text-transparent animate-[nova-shimmer_1.8s_linear_infinite] motion-reduce:animate-none">
          Nova is thinking
        </span>
      </div>
    </div>
  );
}

// An unprompted, verified opening line shown before the user asks anything —
// e.g. "You have 3 overdue follow-ups" on the Follow-ups page. Backed by the
// same live, access-scoped counts as a direct question (never a guess), and
// silent (renders nothing) on a page with nothing worth flagging, so it
// never becomes noise the user learns to ignore.
export function NovaProactiveInsight({ currentPath, compact = false }) {
  const [insight, setInsight] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    setInsight(null);
    setDismissed(false);
    api
      .get("/ai/proactive-insight", { params: { path: currentPath } })
      .then((response) => { if (active) setInsight(response.data?.insight || null); })
      .catch(() => {});
    return () => { active = false; };
  }, [currentPath]);

  if (!insight || dismissed) return null;
  return (
    <div className={`mb-2 flex items-start gap-2 rounded-2xl border border-brand-100 bg-brand-50/80 py-2.5 pl-3 pr-2 text-[12px] leading-5 text-brand-900 ${compact ? "mx-3" : "mx-4"}`}>
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />
      <div className="min-w-0 flex-1">{inlineContent(insight)}</div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-full p-0.5 text-brand-400 transition hover:bg-brand-100 hover:text-brand-700"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function NovaSuggestions({ onSelect, currentPath, compact = false }) {
  const suggestions = novaSuggestionsForPath(currentPath);
  return (
    <div className={`flex gap-2 overflow-x-auto ${compact ? "px-3 pb-2" : "px-4 pb-3"}`}>
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onSelect(suggestion)}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-brand-100 bg-brand-50/80 px-3 text-[11px] font-semibold text-brand-800 transition hover:border-brand-200 hover:bg-brand-100"
        >
          <Sparkles className="h-3 w-3" />
          {suggestion}
        </button>
      ))}
    </div>
  );
}
