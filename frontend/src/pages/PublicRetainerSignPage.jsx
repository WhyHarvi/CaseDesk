import { motion } from "framer-motion";
import { CheckCircle2, Eye, Loader2, PenLine } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getManagedRetainer, signManagedRetainer } from "../api/bookingApi";
import SignaturePad from "../components/client-portal/SignaturePad";

function Shell({ children }) {
  return (
    <main className="flex min-h-[100dvh] w-full flex-col items-center justify-center bg-slate-50 px-4 py-6 sm:px-6">
      <div className="w-full max-w-2xl">
        <div className="mb-5 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Electronic signature</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Your retainer agreement</h1>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white"
        >
          {children}
        </motion.div>
        <p className="mt-5 text-center text-xs text-slate-400">Powered by CaseDesk</p>
      </div>
    </main>
  );
}

export default function PublicRetainerSignPage() {
  const { manageToken } = useParams();
  const [view, setView] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showDocument, setShowDocument] = useState(false);

  const [fullName, setFullName] = useState("");
  const [signatureImage, setSignatureImage] = useState("");
  const [consent, setConsent] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState("");
  const [signedMessage, setSignedMessage] = useState("");

  useEffect(() => {
    let active = true;
    getManagedRetainer(manageToken)
      .then((data) => { if (active) setView(data); })
      .catch((reason) => { if (active) setLoadError(reason.response?.data?.message || "This retainer link is not valid."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [manageToken]);

  async function sign(event) {
    event.preventDefault();
    setSigning(true);
    setSignError("");
    try {
      const result = await signManagedRetainer(manageToken, {
        fullName,
        consent,
        signatureMethod: "drawn",
        signatureImage,
      });
      setSignedMessage(result.message || "Signed. Thank you!");
    } catch (reason) {
      setSignError(reason.response?.data?.message || "The document could not be signed. Please try again.");
    } finally {
      setSigning(false);
    }
  }

  if (loading) {
    return <Shell><div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div></Shell>;
  }

  if (loadError) {
    return <Shell><div className="flex h-64 flex-col items-center justify-center gap-2 px-6 text-center"><p className="text-sm font-semibold text-slate-800">This link isn't available</p><p className="max-w-sm text-sm text-slate-500">{loadError}</p></div></Shell>;
  }

  const alreadySigned = !view.awaitingSignature || Boolean(signedMessage);

  return (
    <Shell>
      <header className="border-b border-slate-100 px-6 py-5">
        <h2 className="text-lg font-semibold tracking-tight text-slate-950">{view.title}</h2>
        <p className="mt-1 text-sm text-slate-500">{view.status}</p>
      </header>

      {alreadySigned ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <CheckCircle2 className="h-9 w-9 text-emerald-600" />
          <p className="text-base font-semibold text-slate-900">
            {signedMessage || (view.signature?.signerName ? `Signed by ${view.signature.signerName}` : "This document has already been signed")}
          </p>
          <p className="max-w-sm text-sm text-slate-500">Thank you — your consultant has been notified and will be in touch about next steps.</p>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setShowDocument((current) => !current)}
            className="flex w-full items-center justify-center gap-2 border-b border-slate-100 px-6 py-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <Eye className="h-4 w-4" />
            {showDocument ? "Hide the document" : "Read the document first"}
          </button>
          {showDocument ? (
            <iframe title={view.title} sandbox="" srcDoc={view.html} className="h-[420px] w-full border-0 border-b border-slate-100 bg-white" />
          ) : null}

          <form onSubmit={sign} className="space-y-4 px-6 py-6">
            <label className="block text-sm font-semibold text-slate-800">
              Type your full legal name
              <input
                value={fullName}
                required
                maxLength={160}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="e.g. Rajdeep Singh"
                className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
              />
            </label>

            <div>
              <p className="text-sm font-semibold text-slate-800">Draw your signature</p>
              <p className="mt-0.5 text-xs text-slate-500">Retainers are signed with your finger or stylus — typed signatures aren't accepted for this document.</p>
              <div className="mt-2"><SignaturePad disabled={signing} onChange={setSignatureImage} /></div>
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3.5 text-[13px] leading-5 text-slate-600">
              <input type="checkbox" checked={consent} required onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-sky-600 focus:ring-sky-200" />
              I have read this document and agree that the signature I provide is my electronic signature, legally equivalent to my handwritten signature.
            </label>

            {signError ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{signError}</p> : null}

            <button
              disabled={signing || !fullName.trim() || !consent || !signatureImage}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.22)] transition-all duration-200 hover:bg-slate-800 active:scale-[0.98] disabled:opacity-40"
            >
              {signing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
              {signing ? "Signing…" : "Sign document"}
            </button>
          </form>
        </>
      )}
    </Shell>
  );
}
