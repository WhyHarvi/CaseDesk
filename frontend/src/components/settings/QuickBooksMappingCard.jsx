import { AnimatePresence, motion } from "framer-motion";
import { Banknote, Check, ChevronDown, Landmark, Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createQuickBooksItem,
  getQuickBooksAccounts,
  getQuickBooksItems,
  getQuickBooksMapping,
  updateQuickBooksMapping,
} from "../../api/quickbooksApi";
import Select from "../ui/Select";

const card = "rounded-[1.4rem] border border-white/70 bg-white/80 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur-xl";

const SLOTS = {
  fee: {
    field: "feeItemId",
    nameField: "feeItemName",
    label: "Professional fees",
    hint: "Consultation and service fees. Posts to income.",
    icon: Banknote,
    tint: "bg-emerald-50 text-emerald-600",
    accountClassification: "Revenue",
    accountHint: "income",
  },
  disbursement: {
    field: "disbursementItemId",
    nameField: "disbursementItemName",
    label: "Government fee disbursements",
    hint: "IRCC and third-party fees held for the client. Posts to liability.",
    icon: Landmark,
    tint: "bg-indigo-50 text-indigo-600",
    accountClassification: "Liability",
    accountHint: "liability",
  },
};

function ItemPicker({ slotKey, mapping, items, accounts, onSaved }) {
  const slot = SLOTS[slotKey];
  const Icon = slot.icon;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", accountId: "" });
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const searchRef = useRef(null);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const [position, setPosition] = useState(null);

  const selectedId = mapping[slot.field];
  const selectedName = mapping[slot.nameField];
  const relevantAccounts = useMemo(
    () => accounts.filter((account) => account.classification === slot.accountClassification),
    [accounts, slot.accountClassification],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.name.toLowerCase().includes(q) || (item.incomeAccountName || "").toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      setCreating(false);
      setCreateError("");
      window.setTimeout(() => searchRef.current?.focus(), 40);
    } else {
      setPosition(null);
    }
  }, [open]);

  // Rendered via portal below (see return), so its screen position has to be
  // computed from the trigger button rather than relying on CSS `absolute`
  // positioning — the settings cards each set backdrop-blur, which creates a
  // stacking context that would otherwise trap the dropdown under whichever
  // sibling card comes later in the DOM.
  useEffect(() => {
    if (!open) return undefined;
    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 320);
      const left = Math.min(rect.left, window.innerWidth - width - 12);
      setPosition({ top: rect.bottom + 8, left: Math.max(12, left), width });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onClickOutside(event) {
      const insideTrigger = containerRef.current?.contains(event.target);
      const insideDropdown = dropdownRef.current?.contains(event.target);
      if (!insideTrigger && !insideDropdown) setOpen(false);
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

  async function choose(item) {
    setOpen(false);
    setSaving(true);
    setError("");
    try {
      await updateQuickBooksMapping({ [slot.field]: item.id });
      onSaved({ [slot.field]: item.id, [slot.nameField]: item.name });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not save that mapping.");
    } finally {
      setSaving(false);
    }
  }

  async function submitCreate(event) {
    event.preventDefault();
    if (!newItem.name.trim() || !newItem.accountId) return;
    setCreateBusy(true);
    setCreateError("");
    try {
      const item = await createQuickBooksItem({ name: newItem.name.trim(), incomeAccountId: newItem.accountId });
      await choose(item);
      setNewItem({ name: "", accountId: "" });
      setCreating(false);
    } catch (reason) {
      setCreateError(reason.response?.data?.message || "QuickBooks could not create that item.");
    } finally {
      setCreateBusy(false);
    }
  }

  function onSearchKeyDown(event) {
    if (creating) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (event.key === "Enter" && filtered[highlight]) { event.preventDefault(); choose(filtered[highlight]); }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${slot.tint}`}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{slot.label}</p>
          <p className="text-xs text-slate-500">{slot.hint}</p>

          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={`mt-2.5 flex w-full items-center justify-between gap-2 rounded-2xl border px-3.5 py-2.5 text-left text-sm transition ${
              open ? "border-sky-400 ring-2 ring-sky-100" : "border-slate-200/80 bg-white/70 hover:border-slate-300 hover:bg-white"
            }`}
          >
            {selectedId ? (
              <span className="min-w-0 truncate">
                <span className="font-medium text-slate-900">{selectedName}</span>
              </span>
            ) : (
              <span className="text-slate-400">Choose a QuickBooks item…</span>
            )}
            <span className="flex shrink-0 items-center gap-1.5">
              <AnimatePresence mode="wait">
                {saving ? (
                  <motion.span key="saving" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                    <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  </motion.span>
                ) : saved ? (
                  <motion.span key="saved" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ type: "spring", stiffness: 420, damping: 20 }}>
                    <Check className="h-4 w-4 text-emerald-600" />
                  </motion.span>
                ) : (
                  <motion.span key="chevron" animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.18 }}>
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </button>
          {error ? <p className="mt-1.5 text-xs text-rose-600">{error}</p> : null}
        </div>
      </div>

      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {open && position ? (
            <motion.div
              ref={dropdownRef}
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              style={{ position: "fixed", top: position.top, left: position.left, width: position.width }}
              className="z-[9999] overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_20px_50px_rgba(15,23,42,0.18)] backdrop-blur-xl"
            >
            {creating ? (
              <form onSubmit={submitCreate} className="p-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700">New QuickBooks item</p>
                  <button type="button" onClick={() => setCreating(false)} className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input
                  autoFocus
                  value={newItem.name}
                  onChange={(event) => setNewItem((c) => ({ ...c, name: event.target.value }))}
                  placeholder="Item name"
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
                />
                <Select
                  value={newItem.accountId}
                  onChange={(event) => setNewItem((c) => ({ ...c, accountId: event.target.value }))}
                  className="mt-2 w-full"
                  ariaLabel={`${slot.accountHint} account`}
                >
                  <option value="">Choose the {slot.accountHint} account…</option>
                  {relevantAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </Select>
                {createError ? <p className="mt-1.5 text-xs text-rose-600">{createError}</p> : null}
                <button
                  type="submit"
                  disabled={createBusy || !newItem.name.trim() || !newItem.accountId}
                  className="mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-950 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {createBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create and use
                </button>
              </form>
            ) : (
              <>
                <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
                  <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => { setQuery(event.target.value); setHighlight(0); }}
                    onKeyDown={onSearchKeyDown}
                    placeholder="Search QuickBooks items…"
                    className="w-full border-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
                  />
                </div>
                <div className="max-h-[240px] overflow-y-auto p-1.5">
                  {filtered.length ? (
                    filtered.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        onMouseEnter={() => setHighlight(index)}
                        onClick={() => choose(item)}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition ${
                          index === highlight ? "bg-sky-50 text-sky-900" : "text-slate-700"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{item.name}</span>
                          {item.incomeAccountName ? <span className="block truncate text-xs text-slate-400">{item.incomeAccountName}</span> : null}
                        </span>
                        {selectedId === item.id ? <Check className="h-4 w-4 shrink-0 text-sky-600" /> : null}
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-4 text-center text-sm text-slate-400">No items match “{query}”.</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 border-t border-slate-100 px-3.5 py-2.5 text-left text-sm font-medium text-sky-700 transition hover:bg-sky-50/60"
                >
                  <Plus className="h-4 w-4" /> Create a new item…
                </button>
              </>
            )}
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

export default function QuickBooksMappingCard() {
  const [items, setItems] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([getQuickBooksItems(), getQuickBooksAccounts(), getQuickBooksMapping()])
      .then(([itemRows, accountRows, mappingRow]) => {
        if (!active) return;
        setItems(itemRows);
        setAccounts(accountRows);
        setMapping(mappingRow);
      })
      .catch((reason) => active && setError(reason.response?.data?.message || "QuickBooks items could not be loaded."))
      .finally(() => {});
    return () => { active = false; };
  }, []);

  const loading = items === null || accounts === null || mapping === null;
  const bothMapped = mapping && mapping.feeItemId && mapping.disbursementItemId;

  return (
    <section className={card}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Payment account mapping</h3>
          <p className="mt-0.5 text-xs text-slate-500">Tell CaseDesk which QuickBooks item every invoice line should use.</p>
        </div>
        {!loading ? (
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${bothMapped ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            {bothMapped ? "Ready" : "Setup needed"}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading your QuickBooks items…</div>
      ) : error ? (
        <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      ) : (
        <div className="mt-5 space-y-6">
          <ItemPicker slotKey="fee" mapping={mapping} items={items} accounts={accounts} onSaved={(patch) => setMapping((m) => ({ ...m, ...patch }))} />
          <ItemPicker slotKey="disbursement" mapping={mapping} items={items} accounts={accounts} onSaved={(patch) => setMapping((m) => ({ ...m, ...patch }))} />
        </div>
      )}
    </section>
  );
}
