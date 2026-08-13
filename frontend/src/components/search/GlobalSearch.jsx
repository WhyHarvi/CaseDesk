import {
  BriefcaseBusiness,
  FileText,
  LoaderCircle,
  Search,
  StickyNote,
  UserRound,
  UsersRound,
  Database,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import api from "../../services/api";

const groupIcons = {
  clients: UserRound,
  cases: BriefcaseBusiness,
  documents: FileText,
  notes: StickyNote,
  leads: UsersRound,
  caseEasy: Database,
};

function Highlight({ children, query }) {
  const value = String(children || "");
  const normalized = query.trim();
  if (!normalized) return value;
  const index = value.toLowerCase().indexOf(normalized.toLowerCase());
  if (index < 0) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark className="rounded bg-sky-100 px-0.5 text-inherit">
        {value.slice(index, index + normalized.length)}
      </mark>
      {value.slice(index + normalized.length)}
    </>
  );
}

export default function GlobalSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const { role } = useAuth();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState(null);

  const flatResults = useMemo(
    () =>
      groups.flatMap((group) =>
        group.items.map((item) => ({
          ...item,
          groupId: group.id,
          groupLabel: group.label,
        })),
      ),
    [groups],
  );
  const indexByKey = useMemo(
    () =>
      new Map(
        flatResults.map((item, index) => [
          `${item.groupId}:${item.id}`,
          index,
        ]),
      ),
    [flatResults],
  );

  function updatePosition() {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gutter = 12;
    const viewportWidth = window.innerWidth;
    const left = Math.max(gutter, Math.min(rect.left, viewportWidth - gutter));
    const availableWidth = Math.max(240, viewportWidth - left - gutter);
    const width = Math.min(
      Math.max(280, rect.width),
      availableWidth,
    );
    const top = rect.bottom + 8;
    setPosition({
      left,
      top,
      width,
      maxHeight: Math.max(240, window.innerHeight - top - 16),
    });
  }

  function closeSearch({ clear = false } = {}) {
    setOpen(false);
    setActiveIndex(-1);
    if (clear) {
      setQuery("");
      setGroups([]);
      setError("");
      setWarning("");
    }
  }

  function openResult(item) {
    if (!item?.url) return;
    closeSearch({ clear: true });
    navigate(item.url);
  }

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const update = () => updatePosition();
    const closeOnOutsidePointer = (event) => {
      if (
        rootRef.current?.contains(event.target) ||
        panelRef.current?.contains(event.target)
      ) {
        return;
      }
      closeSearch();
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

  useEffect(() => {
    const focusSearch = (event) => {
      const target = event.target;
      const isTyping =
        target instanceof HTMLElement &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.isContentEditable);
      const isShortcut =
        (!isTyping && event.key === "/") ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k");
      if (!isShortcut) return;
      event.preventDefault();
      setOpen(true);
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    closeSearch({ clear: true });
  }, [location.pathname]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setGroups([]);
      setError("");
      setWarning("");
      setLoading(false);
      setActiveIndex(-1);
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setLoading(true);
        setError("");
        setWarning("");
        const response = await api.request({
          method: "get",
          url: "/search",
          params: { q: normalized },
          signal: controller.signal,
        });
        const nextGroups = response.data.data?.groups || [];
        setGroups(nextGroups);
        setWarning(response.data.data?.warning || "");
        setActiveIndex(nextGroups.some((group) => group.items.length) ? 0 : -1);
      } catch (requestError) {
        if (
          requestError.code === "ERR_CANCELED" ||
          requestError.name === "CanceledError"
        ) {
          return;
        }
        setGroups([]);
        setWarning("");
        setActiveIndex(-1);
        setError(
          requestError.response?.data?.message ||
            "Search is temporarily unavailable.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 280);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      inputRef.current?.blur();
      return;
    }
    if (!flatResults.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current + 1) % flatResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(
        (current) => (current <= 0 ? flatResults.length - 1 : current - 1),
      );
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      openResult(flatResults[activeIndex]);
    }
  }

  const overlay =
    open && position && typeof document !== "undefined"
      ? createPortal(
          <section
            ref={panelRef}
            id="global-search-results"
            role="listbox"
            aria-label="Global search results"
            className="fixed z-[1000] overflow-hidden rounded-[1.35rem] border border-white/90 bg-white/96 shadow-[0_28px_90px_rgba(15,23,42,0.24)] ring-1 ring-slate-950/5 backdrop-blur-2xl"
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
          >
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/75 px-4 py-2.5 text-[11px] text-slate-500">
              <span>
                {query.trim().length < 2
                  ? "Type at least 2 characters"
                  : loading
                    ? "Searching CaseDesk…"
                    : flatResults.length
                      ? `${flatResults.length} result${flatResults.length === 1 ? "" : "s"}`
                      : "Search CaseDesk"}
              </span>
              <span className="hidden sm:inline">
                ↑↓ navigate · Enter open · Esc close
              </span>
            </div>

            <div
              className="overflow-y-auto overscroll-contain p-2"
              style={{ maxHeight: Math.max(190, position.maxHeight - 42) }}
            >
              {warning ? (
                <div className="m-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {warning}
                </div>
              ) : null}
              {loading && !flatResults.length ? (
                <div className="flex min-h-40 flex-col items-center justify-center text-slate-400">
                  <LoaderCircle className="h-6 w-6 animate-spin" />
                  <p className="mt-3 text-sm">Finding matching records…</p>
                </div>
              ) : error ? (
                <div className="m-2 rounded-2xl bg-rose-50 px-4 py-5 text-center text-sm text-rose-700">
                  {error}
                </div>
              ) : query.trim().length < 2 ? (
                <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                    <Search className="h-4 w-4" />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-slate-800">
                    Search your workspace
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {role === "frontdesk"
                      ? "Find leads and Case Easy imports by name, number, phone, or email."
                      : "Find clients, cases, documents, notes, leads, and Case Easy imports."}
                  </p>
                </div>
              ) : !flatResults.length ? (
                <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                    <Search className="h-4 w-4" />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-slate-800">
                    No matching records
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Try a client name, file number, case type, or document name.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {groups.map((group) => {
                    const Icon = groupIcons[group.id] || Search;
                    return (
                      <div key={group.id}>
                        <div className="flex items-center gap-2 px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          <Icon className="h-3.5 w-3.5" />
                          {group.label}
                        </div>
                        <div className="space-y-1">
                          {group.items.map((item) => {
                            const index = indexByKey.get(
                              `${group.id}:${item.id}`,
                            );
                            const active = index === activeIndex;
                            return (
                              <button
                                key={`${group.id}:${item.id}`}
                                type="button"
                                role="option"
                                aria-selected={active}
                                onMouseEnter={() => setActiveIndex(index)}
                                onClick={() => openResult(item)}
                                className={`flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition ${
                                  active
                                    ? "bg-sky-50 text-slate-950"
                                    : "text-slate-700 hover:bg-slate-50"
                                }`}
                              >
                                <span
                                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                                    active
                                      ? "bg-white text-sky-600 shadow-sm"
                                      : "bg-slate-100 text-slate-500"
                                  }`}
                                >
                                  <Icon className="h-4 w-4" />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold">
                                    <Highlight query={query}>
                                      {item.title}
                                    </Highlight>
                                  </span>
                                  {item.subtitle ? (
                                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                                      <Highlight query={query}>
                                        {item.subtitle}
                                      </Highlight>
                                    </span>
                                  ) : null}
                                  {item.snippet ? (
                                    <span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-500">
                                      <Highlight query={query}>
                                        {item.snippet}
                                      </Highlight>
                                    </span>
                                  ) : null}
                                </span>
                                {item.meta ? (
                                  <span className="mt-1 hidden max-w-32 shrink-0 truncate rounded-full bg-white/80 px-2 py-1 text-[10px] font-medium text-slate-500 sm:block">
                                    {item.meta}
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>,
          document.body,
        )
      : null;

  return (
    <>
      <div
        ref={rootRef}
        className="flex h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/80 px-5 shadow-sm backdrop-blur-sm transition-all duration-200 focus-within:border-sky-300 focus-within:ring-2 focus-within:ring-sky-200"
      >
        {loading ? (
          <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-sky-500" />
        ) : (
          <Search className="h-5 w-5 shrink-0 text-slate-400" />
        )}
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-controls="global-search-results"
          aria-expanded={open}
          aria-autocomplete="list"
          value={query}
          onFocus={() => {
            setOpen(true);
            updatePosition();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            role === "frontdesk"
              ? "Search assigned leads…"
              : "Search clients, cases, documents, notes…"
          }
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-base text-slate-700 outline-none placeholder:text-slate-400"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setGroups([]);
              setError("");
              setWarning("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span className="hidden rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-400 sm:inline-flex">
            /
          </span>
        )}
      </div>
      {overlay}
    </>
  );
}
