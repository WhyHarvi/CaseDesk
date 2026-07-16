import { CheckCircle2, Download, Eye, Loader2, PenLine, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { downloadPortalAgreementFile, getPortalAgreementView, signPortalAgreement, portalErrorMessage } from "../../api/clientPortalApi";
import { usePortalToast } from "./ClientPortalToast";
import { formatPortalDate } from "./ClientStatusCard";

const STATUS_TONE = {
  "Awaiting your signature": "bg-amber-100/90 text-amber-800",
  Signed: "bg-emerald-100/90 text-emerald-800",
  Finalized: "bg-emerald-100/90 text-emerald-800",
};

function useSheetChrome(onClose, busy = false) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, busy]);
}

function AgreementViewerSheet({ agreement, onClose, onSign }) {
  const { showToast } = usePortalToast();
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  useSheetChrome(onClose);

  useEffect(() => {
    let active = true;
    getPortalAgreementView(agreement.id)
      .then((data) => active && setView(data))
      .catch((reason) => active && setError(portalErrorMessage(reason, "The document could not be loaded.")))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [agreement.id]);

  async function download() {
    setDownloading(true);
    try {
      await downloadPortalAgreementFile(agreement.id, `${agreement.title}.html`);
    } catch {
      showToast("The file could not be downloaded.", "error");
    } finally {
      setDownloading(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[250] flex flex-col bg-slate-950/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="agreement-viewer-title">
      <div className="mx-auto flex h-full w-full max-w-[760px] flex-col overflow-hidden bg-[#f1f5f9] sm:my-4 sm:h-[calc(100%-2rem)] sm:rounded-[1.75rem] sm:shadow-[0_30px_100px_rgba(15,23,42,0.35)]">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/95 px-4 py-3 pt-[max(env(safe-area-inset-top),0.75rem)] backdrop-blur sm:pt-3">
          <div className="min-w-0">
            <h2 id="agreement-viewer-title" className="truncate text-[15px] font-semibold leading-5 text-slate-950">{agreement.title}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{view?.status || agreement.status}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" disabled={downloading || loading} onClick={download} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 active:scale-95 disabled:opacity-50" aria-label="Download document">
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            </button>
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 active:scale-95" aria-label="Close viewer">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <p className="max-w-sm text-sm leading-6 text-slate-500">{error}</p>
            </div>
          ) : (
            <iframe
              title={agreement.title}
              sandbox=""
              srcDoc={view.html}
              className="h-full w-full border-0 bg-white"
            />
          )}
        </div>

        <footer className="shrink-0 border-t border-slate-200/80 bg-white/95 px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur">
          {view?.awaitingSignature ? (
            <button
              type="button"
              onClick={onSign}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.22)] transition-all duration-200 hover:bg-slate-800 active:scale-[0.98]"
            >
              <PenLine className="h-4 w-4" />
              Sign this document
            </button>
          ) : (
            <p className="flex items-center justify-center gap-2 py-1.5 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {view?.signature?.signerName
                ? `Signed by ${view.signature.signerName}${view.signature.signedAt ? ` on ${formatPortalDate(view.signature.signedAt)}` : ""}`
                : view?.status || "No action needed"}
            </p>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function SignSheet({ agreement, onClose, onSigned, onViewDocument }) {
  const [fullName, setFullName] = useState("");
  const [consent, setConsent] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState("");
  useSheetChrome(onClose, signing);

  async function sign(event) {
    event.preventDefault();
    setSigning(true);
    setError("");
    try {
      const result = await signPortalAgreement(agreement.id, { fullName, consent });
      onSigned(result.message);
    } catch (reason) {
      setError(portalErrorMessage(reason, "The document could not be signed. Please try again."));
    } finally {
      setSigning(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[260] flex items-end justify-center bg-slate-950/35 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="sign-sheet-title">
      <button type="button" className="absolute inset-0" onClick={() => !signing && onClose()} aria-label="Close signing" />
      <form onSubmit={sign} className="relative flex max-h-[94dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-[1.75rem] bg-white shadow-[0_-20px_70px_rgba(15,23,42,0.3)] sm:rounded-[1.75rem]">
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Electronic signature</p>
            <h2 id="sign-sheet-title" className="mt-1 truncate text-[17px] font-semibold tracking-tight text-slate-950">{agreement.title}</h2>
          </div>
          <button type="button" disabled={signing} onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 active:scale-95" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <button
            type="button"
            disabled={signing}
            onClick={onViewDocument}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:border-slate-300 active:scale-[0.98]"
          >
            <Eye className="h-4 w-4" />
            Read the document first
          </button>

          <label className="block text-sm font-semibold text-slate-800">
            Type your full legal name
            <input
              value={fullName}
              required
              maxLength={160}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="e.g. Rajdeep Singh"
              className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-[15px] outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
            />
          </label>
          {fullName.trim() ? (
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-center">
              <p className="font-[cursive] text-2xl text-slate-800">{fullName.trim()}</p>
              <p className="mt-1 text-[11px] text-slate-400">Signature preview — this will be stamped on the document</p>
            </div>
          ) : null}

          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3.5 text-[13px] leading-5 text-slate-600">
            <input type="checkbox" checked={consent} required onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-sky-600 focus:ring-sky-200" />
            I have read this document and agree that typing my name here is my electronic signature, legally equivalent to my handwritten signature.
          </label>

          {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
        </div>

        <footer className="border-t border-slate-100 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <button
            disabled={signing || !fullName.trim() || !consent}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.22)] transition-all duration-200 hover:bg-slate-800 active:scale-[0.98] disabled:opacity-40"
          >
            {signing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
            {signing ? "Signing…" : "Sign document"}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

export default function ClientAgreementCard({ agreement, onChanged }) {
  const { showToast } = usePortalToast();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);

  return (
    <article className="rounded-3xl border border-white/70 bg-white/75 p-5 shadow-[0_14px_40px_rgba(28,45,74,0.08)] backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <div className={["flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", agreement.awaitingSignature ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"].join(" ")}>
          {agreement.awaitingSignature ? <PenLine className="h-[18px] w-[18px]" /> : <CheckCircle2 className="h-[18px] w-[18px]" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[15px] font-semibold leading-5 text-slate-900">{agreement.title}</h3>
            <span className={["shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold", STATUS_TONE[agreement.status] || "bg-slate-100 text-slate-500"].join(" ")}>
              {agreement.status}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-slate-500">
            {agreement.kind || "Document"}{agreement.issuedAt ? ` · Sent ${formatPortalDate(agreement.issuedAt)}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setViewerOpen(true)}
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/80 text-sm font-semibold text-slate-700 transition-all duration-200 hover:border-slate-300 active:scale-[0.98]"
        >
          <Eye className="h-4 w-4" />
          {agreement.awaitingSignature ? "Read" : "View"}
        </button>
        {agreement.awaitingSignature ? (
          <button
            type="button"
            onClick={() => setSignOpen(true)}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.2)] transition-all duration-200 hover:bg-slate-800 active:scale-[0.98]"
          >
            <PenLine className="h-4 w-4" />
            Sign now
          </button>
        ) : null}
      </div>

      {viewerOpen ? (
        <AgreementViewerSheet
          agreement={agreement}
          onClose={() => setViewerOpen(false)}
          onSign={() => {
            setViewerOpen(false);
            setSignOpen(true);
          }}
        />
      ) : null}

      {signOpen ? (
        <SignSheet
          agreement={agreement}
          onClose={() => setSignOpen(false)}
          onViewDocument={() => {
            setSignOpen(false);
            setViewerOpen(true);
          }}
          onSigned={async (message) => {
            setSignOpen(false);
            showToast(message || "Signed. Thank you!");
            await onChanged?.();
            setViewerOpen(true);
          }}
        />
      ) : null}
    </article>
  );
}
