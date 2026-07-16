import { ArrowUpRight, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

export function QuickActionLink({ href, icon: Icon, label, disabled = false, onClick }) {
  const sharedClassName =
    "inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition";

  if (disabled) {
    return (
      <button type="button" disabled className={`${sharedClassName} cursor-not-allowed opacity-50`}>
        <Icon className="h-4 w-4" />
        {label}
      </button>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${sharedClassName} hover:border-slate-300 hover:text-slate-950`}>
        <Icon className="h-4 w-4" />
        {label}
      </button>
    );
  }

  return (
    <a href={href} className={`${sharedClassName} hover:border-slate-300 hover:text-slate-950`}>
      <Icon className="h-4 w-4" />
      {label}
    </a>
  );
}

function ActionPill({ icon: Icon, label, onClick, active = false, hasMenu = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition ${
        active
          ? "border-slate-300 bg-slate-950 text-white shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
          : "border-slate-200/80 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-950"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      {hasMenu ? <ChevronDown className={`h-4 w-4 transition ${active ? "rotate-180" : ""}`} /> : null}
    </button>
  );
}

export function SimpleActionPill({ icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200/80 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}

export function ExpandingPillMenu({ icon: Icon, label, items, isOpen, onOpen, onClose, onToggle, onSelect }) {
  const triggerRef = useRef(null);
  const closeTimeoutRef = useRef(null);
  const [menuPosition, setMenuPosition] = useState(null);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !triggerRef.current) {
      return;
    }

    function updateMenuPosition() {
      if (!triggerRef.current) {
        return;
      }

      const rect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 220;
      const viewportPadding = 12;
      const preferredLeft = rect.left;
      const maxLeft = window.innerWidth - menuWidth - viewportPadding;

      setMenuPosition({
        top: rect.bottom + 10,
        left: Math.max(viewportPadding, Math.min(preferredLeft, maxLeft)),
      });
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen]);

  function clearCloseTimeout() {
    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }

  function handleOpen() {
    clearCloseTimeout();
    onOpen();
  }

  function handleCloseSoon() {
    clearCloseTimeout();
    closeTimeoutRef.current = window.setTimeout(() => {
      onClose();
    }, 120);
  }

  return (
    <div
      ref={triggerRef}
      className="relative shrink-0 overflow-visible"
      onMouseEnter={handleOpen}
      onMouseLeave={handleCloseSoon}
    >
      <ActionPill icon={Icon} label={label} active={isOpen} hasMenu onClick={onToggle} />
      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {isOpen && menuPosition ? (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.96 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  onMouseEnter={handleOpen}
                  onMouseLeave={handleCloseSoon}
                  className="fixed z-[160] w-[220px] overflow-visible rounded-[1.45rem] border border-slate-200/90 bg-white/96 p-2 shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl"
                  style={{
                    top: `${menuPosition.top}px`,
                    left: `${menuPosition.left}px`,
                  }}
                >
                  <div className="space-y-1">
                    {items.map((item) => (
                      <motion.button
                        key={item}
                        type="button"
                        whileHover={{ x: 2 }}
                        onClick={() => {
                          onSelect?.(item);
                          onClose();
                        }}
                        className="flex w-full items-center justify-between rounded-[1rem] px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:text-slate-950"
                      >
                        <span>{item}</span>
                        <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body
          )
        : null}
    </div>
  );
}
