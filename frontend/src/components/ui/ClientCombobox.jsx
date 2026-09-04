import { Check, Search, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Live client search-as-you-type, resolving to a real Client record — the
 * object-picking sibling of CaseTypeCombobox.jsx's free-text pattern. Unlike
 * that component, typed text can never itself become the value: selecting a
 * row is the only way to produce a result, since the caller's `clientId`
 * field must always be a real id. Portaled + positioned the same way
 * (getBoundingClientRect + createPortal to document.body) to escape the
 * backdrop-blur stacking contexts that trap an in-place absolute panel.
 */
export function useClientMatches(enabled, query, search, { debounceMs = 300 } = {}) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) { setResults([]); setLoading(false); return undefined; }
    setLoading(true);
    // No debounce for an empty query — that's the initial "browse" search
    // firing on focus, not a keystroke.
    const timer = setTimeout(() => {
      search(query)
        .then((clients) => setResults(clients || []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, query ? debounceMs : 0);
    return () => clearTimeout(timer);
  }, [enabled, query, search, debounceMs]);

  return { results, loading };
}

function clientLine(client) {
  return [client.clientNumber ? `#${client.clientNumber}` : null, client.email, client.phone, client.secondaryPhone].filter(Boolean).join(" · ");
}

export default function ClientCombobox({
  selected,
  onSelect,
  onClear,
  search,
  placeholder = "Search by name, email, phone, or client #",
  emptyHint = "No matching clients.",
  inputClassName = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition hover:border-slate-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-100",
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [panelRect, setPanelRect] = useState(null);
  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const { results, loading } = useClientMatches(open, query, search);

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

  function selectClient(client) {
    onSelect(client);
    setQuery("");
    setOpen(false);
  }

  if (selected) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white"><Check className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{selected.fullName}</p>
          <p className="truncate text-xs text-slate-500">{clientLine(selected) || "No email or phone on file"}</p>
        </div>
        <button type="button" onClick={onClear} className="shrink-0 text-xs font-semibold text-sky-700 hover:text-sky-900">Change</button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          className={`${inputClassName} pl-9`}
        />
      </div>

      {open && panelRect && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[405] max-h-64 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.14)]"
              style={{ top: `${panelRect.top}px`, left: `${panelRect.left}px`, width: `${panelRect.width}px` }}
            >
              {loading ? (
                <div className="px-3 py-3 text-xs text-slate-400">Searching…</div>
              ) : results.length ? (
                results.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => selectClient(client)}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition hover:bg-slate-100"
                  >
                    <User className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{client.fullName}</p>
                      {clientLine(client) ? <p className="truncate text-xs text-slate-400">{clientLine(client)}</p> : null}
                    </div>
                  </button>
                ))
              ) : (
                <div className="px-3 py-3 text-xs leading-5 text-slate-400">{query ? emptyHint : "Start typing to search."}</div>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
