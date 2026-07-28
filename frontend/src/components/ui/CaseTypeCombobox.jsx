import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  const [panelRect, setPanelRect] = useState(null);
  const containerRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onClickOutside(event) {
      if (containerRef.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      setOpen(false);
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

  // Positioned via getBoundingClientRect + portaled to document.body (the
  // same pattern CaseActionsMenu already uses in Cases.jsx) instead of
  // position: absolute inside the form. The form's card sections each get
  // their own stacking context from backdrop-blur-xl, so an in-place
  // absolute panel from an earlier card gets painted over by a later
  // sibling card regardless of its own z-index — confirmed as the cause of
  // the dropdown appearing "behind" the next section.
  useEffect(() => {
    if (!open) return undefined;
    function updatePanelRect() {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPanelRect({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    }
    updatePanelRect();
    window.addEventListener("resize", updatePanelRect);
    window.addEventListener("scroll", updatePanelRect, true);
    return () => {
      window.removeEventListener("resize", updatePanelRect);
      window.removeEventListener("scroll", updatePanelRect, true);
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

      {open && panelRect && (matches.list.length > 0 || matches.isNew) && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[200] max-h-56 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.14)]"
              style={{ top: `${panelRect.top}px`, left: `${panelRect.left}px`, width: `${panelRect.width}px` }}
            >
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
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
