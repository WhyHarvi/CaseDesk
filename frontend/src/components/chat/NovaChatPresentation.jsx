import { Fragment } from "react";
import { Bot, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

export const NOVA_SUGGESTIONS = [
  "How do I change appointment hours?",
  "How do I request access to a case?",
  "Where do I transfer a lead?",
];

function inlineContent(text) {
  const tokens = String(text || "").split(/(\*\*[^*]+\*\*|`[^`]+`|\/app\/[A-Za-z0-9?&=_/:%-]+)/g);
  return tokens.map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**")) {
      return <strong key={index} className="font-semibold text-slate-950">{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("`") && token.endsWith("`")) {
      return <code key={index} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[12px] font-semibold text-sky-800">{token.slice(1, -1)}</code>;
    }
    if (token.startsWith("/app/")) {
      return <Link key={index} to={token} className="font-semibold text-sky-700 underline decoration-sky-200 underline-offset-2 hover:text-sky-900">{token}</Link>;
    }
    return <Fragment key={index}>{token}</Fragment>;
  });
}

export function NovaMessageContent({ text }) {
  const lines = String(text || "").split("\n");
  return (
    <div className="space-y-2 text-[14px] leading-6 text-slate-700">
      {lines.map((line, index) => {
        const numbered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
        const bullet = line.match(/^\s*[-•]\s+(.+)$/);
        if (!line.trim()) return <div key={index} className="h-1" />;
        if (numbered) {
          return (
            <div key={index} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan-50 text-[10px] font-bold text-cyan-700">{numbered[1]}</span>
              <p className="min-w-0 flex-1">{inlineContent(numbered[2])}</p>
            </div>
          );
        }
        if (bullet) {
          return (
            <div key={index} className="flex items-start gap-2.5">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" />
              <p className="min-w-0 flex-1">{inlineContent(bullet[1])}</p>
            </div>
          );
        }
        return <p key={index}>{inlineContent(line)}</p>;
      })}
    </div>
  );
}

export function NovaAssistantAvatar({ compact = false }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-sky-700 text-white shadow-sm ${compact ? "h-7 w-7" : "h-8 w-8"}`}>
      <Bot className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
    </span>
  );
}

export function NovaSuggestions({ onSelect, compact = false }) {
  return (
    <div className={`flex gap-2 overflow-x-auto ${compact ? "px-3 pb-2" : "px-4 pb-3"}`}>
      {NOVA_SUGGESTIONS.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onSelect(suggestion)}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-cyan-100 bg-cyan-50/80 px-3 text-[11px] font-semibold text-cyan-800 transition hover:border-cyan-200 hover:bg-cyan-100"
        >
          <Sparkles className="h-3 w-3" />
          {suggestion}
        </button>
      ))}
    </div>
  );
}
