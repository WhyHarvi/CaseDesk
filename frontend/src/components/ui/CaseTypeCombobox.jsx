import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { caseTypeMatchesQuery, canonicalCaseType } from "../../utils/caseTypes";

/**
 * Searchable controlled input backed by CaseDesk's global immigration
 * catalog plus services deliberately configured by the agency.
 */
export default function CaseTypeCombobox({ value, onChange, options, aliases = {}, name = "caseType", required = false, placeholder = "Study Permit" }) {
  const [open, setOpen] = useState(false);
  const [panelRect, setPanelRect] = useState(null);
  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);

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
    const list = query ? options.filter((option) =>
      caseTypeMatchesQuery(option, query)
      || Object.entries(aliases).some(([alias, label]) => label === option && alias.includes(query)),
    ) : options;
    const canonicalValue = aliases[query] || canonicalCaseType(value);
    const isExactExistingMatch = options.some((option) => option.toLowerCase() === canonicalValue.toLowerCase());
    return { list, isNew: Boolean(query) && !isExactExistingMatch };
  }, [aliases, options, value]);

  useEffect(() => {
    const message = value.trim() && matches.isNew
      ? "Choose a case type from the global or agency list. Ask an administrator to configure a genuinely new service."
      : "";
    inputRef.current?.setCustomValidity(message);
  }, [matches.isNew, value]);

  function select(option) {
    onChange({ target: { name, value: option } });
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        required={required}
        name={name}
        value={value}
        onChange={(event) => { onChange(event); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          const canonical = aliases[value.trim().toLowerCase()] || canonicalCaseType(value);
          const option = options.find((item) => item.toLowerCase() === canonical.toLowerCase());
          if (option && option !== value) onChange({ target: { name, value: option } });
        }}
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
                  Choose the closest global case type. An administrator can configure a genuinely new agency service in Settings.
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
