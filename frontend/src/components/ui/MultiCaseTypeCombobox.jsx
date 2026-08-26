import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { caseTypeMatchesQuery, canonicalCaseType } from "../../utils/caseTypes";

/**
 * Multi-select sibling of CaseTypeCombobox — same searchable, portal-
 * positioned panel, but toggles membership in a String[] instead of
 * replacing a single value. Unlike CaseTypeCombobox (which blocks
 * submitting anything outside the known catalog, since a Case's caseType
 * drives workflow/document logic), this deliberately allows adding a typed
 * value that isn't in `options` — real advice covers pathways a fixed
 * catalog snapshot can't always anticipate, and the backend independently
 * canonicalizes/cleans whatever comes through rather than rejecting it.
 */
export default function MultiCaseTypeCombobox({ value = [], onChange, options = [], aliases = {}, placeholder = "Search or add a category…" }) {
  const [query, setQuery] = useState("");
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
    const needle = query.trim().toLowerCase();
    const list = (needle ? options.filter((option) =>
      caseTypeMatchesQuery(option, needle)
      || Object.entries(aliases).some(([alias, label]) => label === option && alias.includes(needle)),
    ) : options).filter((option) => !value.includes(option));
    const canonicalQuery = query.trim() ? (aliases[needle] || canonicalCaseType(query)) : "";
    const alreadyListed = canonicalQuery && (list.some((option) => option.toLowerCase() === canonicalQuery.toLowerCase()) || value.some((option) => option.toLowerCase() === canonicalQuery.toLowerCase()));
    return { list, canonicalQuery, canAdd: Boolean(canonicalQuery) && !alreadyListed };
  }, [aliases, options, query, value]);

  function add(option) {
    if (!value.includes(option)) onChange([...value, option]);
    setQuery("");
    inputRef.current?.focus();
  }

  function remove(option) {
    onChange(value.filter((item) => item !== option));
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-2.5 py-1.5 focus-within:border-sky-300 focus-within:ring-4 focus-within:ring-sky-100">
        {value.map((option) => (
          <span key={option} className="inline-flex items-center gap-1 rounded-full bg-slate-950 px-2.5 py-1 text-xs font-semibold text-white">
            {option}
            <button type="button" onClick={() => remove(option)} aria-label={`Remove ${option}`} className="rounded-full p-0.5 hover:bg-white/20"><X className="h-3 w-3" /></button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches.canAdd) { event.preventDefault(); add(matches.canonicalQuery); }
            else if (event.key === "Backspace" && !query && value.length) remove(value[value.length - 1]);
          }}
          placeholder={value.length ? "" : placeholder}
          autoComplete="off"
          className="h-7 min-w-[10rem] flex-1 border-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
        />
      </div>

      {open && panelRect && (matches.list.length > 0 || matches.canAdd) && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              // z-[700]: this combobox is used inside AppointmentProfileOverlay's
              // z-[650] curtain (unlike CaseTypeCombobox's z-[200], which only
              // ever runs outside a high-z overlay) — anything lower renders the
              // list behind the curtain itself, invisible even though it's in the DOM.
              className="fixed z-[700] max-h-56 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.14)]"
              style={{ top: `${panelRect.top}px`, left: `${panelRect.left}px`, width: `${panelRect.width}px` }}
            >
              {matches.list.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => add(option)}
                  className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  {option}
                </button>
              ))}
              {matches.canAdd ? (
                <button
                  type="button"
                  onClick={() => add(matches.canonicalQuery)}
                  className="flex w-full items-center gap-1.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-sky-700 transition hover:bg-sky-50"
                >
                  Add "{matches.canonicalQuery}"
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
