import { CheckCircle2, CircleAlert } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const ToastContext = createContext(null);

export function ClientPortalToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const showToast = useCallback((message, tone = "success") => {
    clearTimeout(timerRef.current);
    setToast({ id: Date.now(), message, tone });
    timerRef.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast
        ? createPortal(
            <div className="pointer-events-none fixed inset-x-0 top-4 z-[300] flex justify-center px-4" role="status" aria-live="polite">
              <div
                key={toast.id}
                className={[
                  "pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-medium shadow-[0_18px_45px_rgba(15,23,42,0.18)] backdrop-blur-xl",
                  "animate-[portal-toast-in_.25s_ease-out]",
                  toast.tone === "error"
                    ? "border-rose-200/80 bg-rose-50/95 text-rose-700"
                    : "border-emerald-200/80 bg-emerald-50/95 text-emerald-800",
                ].join(" ")}
              >
                {toast.tone === "error" ? <CircleAlert className="h-[18px] w-[18px] shrink-0" /> : <CheckCircle2 className="h-[18px] w-[18px] shrink-0" />}
                <span>{toast.message}</span>
              </div>
              <style>{`@keyframes portal-toast-in { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

export function usePortalToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("usePortalToast must be used inside ClientPortalToastProvider");
  return value;
}
