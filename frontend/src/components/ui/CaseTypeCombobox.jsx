import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Case type is free text (Case.caseType has no enum) but several other
 * systems — document checklists, workflow templates — match against it by
 * exact string equality. A plain text input lets "Study Permit" and
 * "study permit" silently become two different, unlinked case types. This
 * surfaces the agency's known case types (in use on a case, or configured
 * as a document/workflow template — see GET /cases/case-types) as you
 * type, so picking an existing one is the easy default, while still
 * allowing a genuinely new case type to be typed freely.
 */
export default function CaseTypeCombobox({ value, onChange, options, name = "caseType", required = false, placeholder = "Study Permit" }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onClickOutside(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const matches = useMemo(() => {
    const query = value.trim().toLowerCase();
    const list = query ? options.filter((option) => option.toLowerCase().includes(query)) : options;
    const isExactExistingMatch = options.some((option) => option.toLowerCase() === query);
    return { list, isNew: Boolean(query) && !isExactExistingMatch };
  }, [options, value]);

  function select(option) {
    onChange({ target: { name, value: option } });
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        required={required}
        name={name}
        value={value}
        onChange={(event) => { onChange(event); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
      />

      {open && (matches.list.length > 0 || matches.isNew) ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-56 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.14)]">
          {matches.list.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => select(option)}
              className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              {option}
            </button>
          ))}
          {matches.isNew ? (
            <div className="mt-0.5 border-t border-slate-100 px-3 py-2 text-xs text-slate-400">
              "{value.trim()}" is a new case type — no existing document or workflow checklist will apply to it yet.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
