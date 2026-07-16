import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function LeadFilterMenu({ label, value, options, onChange, icon: Icon, allLabel }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 220 });
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const selected = options.find((option) => option.value === value);
  const active = Boolean(value);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => !rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target) && setOpen(false);
    const escape = (event) => event.key === "Escape" && setOpen(false);
    const closeForResize = () => setOpen(false);
    const closeForPageScroll = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", closeForResize);
    window.addEventListener("scroll", closeForPageScroll, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("resize", closeForResize);
      window.removeEventListener("scroll", closeForPageScroll, true);
    };
  }, [open]);

  function toggle() {
    if (!open) {
      const rect = rootRef.current.getBoundingClientRect();
      const width = Math.max(rect.width, 220);
      const estimatedHeight = Math.min(options.length, 6) * 42 + 62;
      const openAbove = window.innerHeight - rect.bottom < estimatedHeight + 12;
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: openAbove ? Math.max(12, rect.top - estimatedHeight - 7) : rect.bottom + 7,
        width,
      });
    }
    setOpen((current) => !current);
  }

  function choose(nextValue) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={[
          "group inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium shadow-sm transition duration-200",
          active
            ? "border-brand-200 bg-brand-50/90 text-brand-800 shadow-brand-100/70"
            : "border-slate-200/80 bg-white/85 text-slate-700 hover:border-brand-200 hover:bg-white",
        ].join(" ")}
      >
        <Icon className={[
          "h-3.5 w-3.5 shrink-0",
          active ? "text-brand-600" : "text-slate-400",
        ].join(" ")} />
        <span className="text-slate-500">{label}</span>
        <span className={active ? "max-w-[120px] truncate font-semibold text-brand-800" : "max-w-[120px] truncate font-semibold text-slate-700"}>{selected?.label || allLabel}</span>
        <ChevronDown className={["h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform", open ? "rotate-180" : ""].join(" ")} />
      </button>

      {open ? createPortal(
        <div ref={menuRef} style={{ left: position.left, top: position.top, width: position.width }} className="fixed z-[600] overflow-hidden rounded-2xl border border-slate-200 bg-white/98 p-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.20)] backdrop-blur-xl">
          <button type="button" onClick={() => choose("")} className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-600 transition hover:bg-slate-100">
            {allLabel}
            {!value ? <Check className="h-4 w-4 text-brand-600" /> : null}
          </button>
          <div className="my-1 h-px bg-slate-100" />
          <div className="max-h-64 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
            {options.map((option) => (
              <button key={option.value} type="button" onClick={() => choose(option.value)} className={["flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition", value === option.value ? "bg-brand-50 font-semibold text-brand-800" : "font-medium text-slate-700 hover:bg-slate-100"].join(" ")}>
                <span className="truncate">{option.label}</span>
                {value === option.value ? <Check className="h-4 w-4 shrink-0 text-brand-600" /> : null}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
