import { Camera, CheckCircle2, ImageOff, Loader2, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import api from "../../services/api";
import { captureCurrentPageForSupport, clearSupportCapture, latestSupportCapture } from "../../services/supportCapture";

function captureState() {
  return latestSupportCapture() || {
    pagePath: window.location.pathname,
    errorCode: "",
    errorMessage: "",
    diagnostics: { browser: navigator.userAgent, viewport: `${window.innerWidth}x${window.innerHeight}`, occurredAt: new Date().toISOString() },
    blob: null,
  };
}

export default function SupportDeskPanel({ compact = false }) {
  const descriptionRef = useRef(null);
  const [capture, setCapture] = useState(captureState);
  const [description, setDescription] = useState("");
  const [summary, setSummary] = useState("");
  const [tickets, setTickets] = useState([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const previewUrl = capture.blob ? URL.createObjectURL(capture.blob) : "";

  useEffect(() => {
    api.getFresh("/support/tickets").then((response) => setTickets(response.data.data || [])).catch(() => {});
    const update = () => setCapture(captureState());
    window.addEventListener("casedesk:support-captured", update);
    return () => window.removeEventListener("casedesk:support-captured", update);
  }, []);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function recapture() {
    setBusy("capture");
    setCapture(await captureCurrentPageForSupport());
    setBusy("");
  }

  async function diagnose() {
    if (!description.trim()) {
      setNotice("Describe what happened first. Nova summarizes your written report and does not inspect the screenshot.");
      descriptionRef.current?.focus();
      return;
    }
    setBusy("diagnose");
    setNotice("");
    try {
      const response = await api.post("/support/diagnose", {
        description,
        pagePath: capture.pagePath,
        errorCode: capture.errorCode,
        errorMessage: capture.errorMessage,
      });
      setSummary(response.data.data.summary || "");
    } catch (error) {
      setNotice(error.response?.data?.message || "Nova could not summarize this report. You can still send your own description.");
    } finally {
      setBusy("");
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!description.trim()) return;
    setBusy("submit");
    setNotice("");
    try {
      const form = new FormData();
      form.append("description", description.trim());
      form.append("novaSummary", summary.trim());
      form.append("pagePath", capture.pagePath || "");
      form.append("errorCode", capture.errorCode || "");
      form.append("errorMessage", capture.errorMessage || "");
      form.append("diagnostics", JSON.stringify(capture.diagnostics || {}));
      if (capture.blob) form.append("screenshot", capture.blob, "casedesk-error.jpg");
      const response = await api.post("/support/tickets", form, { timeout: 60_000 });
      const ticket = response.data.data;
      setTickets((current) => [ticket, ...current]);
      setDescription("");
      setSummary("");
      clearSupportCapture();
      setCapture(captureState());
      setNotice(ticket.deliveryStatus === "Delivered" ? `${ticket.ticketNumber} was sent to CaseDesk support.` : `${ticket.ticketNumber} was saved. Email delivery is pending.`);
    } catch (error) {
      setNotice(error.response?.data?.message || "The support report could not be submitted.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className={`min-h-0 flex-1 overflow-y-auto ${compact ? "px-3 py-4" : "px-4 py-5 sm:px-6"}`}>
      <div className="mx-auto max-w-3xl">
        <form onSubmit={submit} className={compact ? "space-y-4" : "space-y-5"}>
          <div>
            <label className="text-sm font-semibold text-slate-800" htmlFor="support-description">What happened?</label>
            <textarea ref={descriptionRef} id="support-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={compact ? 4 : 5} className="mt-2 w-full resize-y rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100" placeholder="Tell us what you were doing, what you expected, and what happened instead." />
          </div>

          <div className="border-y border-slate-200 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">Page capture</p>
                <p className="mt-1 text-xs text-slate-500">Inputs and drawing areas are blurred. Review the image before sending.</p>
              </div>
              <button type="button" onClick={recapture} disabled={Boolean(busy)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-50"><Camera className="h-4 w-4" />Capture current page</button>
            </div>
            {previewUrl ? <img src={previewUrl} alt="Automatic support screenshot preview" className={`${compact ? "max-h-44" : "max-h-72"} mt-3 w-full rounded-lg border border-slate-200 object-contain object-top`} /> : <div className="mt-3 flex h-28 items-center justify-center gap-2 border border-dashed border-slate-200 text-xs text-slate-400"><ImageOff className="h-4 w-4" />No screenshot available</div>}
            {previewUrl ? <button type="button" onClick={() => { clearSupportCapture(); setCapture({ ...capture, blob: null }); }} className="mt-2 text-xs font-semibold text-rose-600">Remove screenshot</button> : null}
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="text-sm font-semibold text-slate-800" htmlFor="support-summary">Nova summary</label>
              <button type="button" onClick={diagnose} disabled={Boolean(busy)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-50 px-3 text-xs font-semibold text-brand-700 disabled:opacity-50">{busy === "diagnose" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Summarize with Nova</button>
            </div>
            <textarea id="support-summary" value={summary} onChange={(event) => setSummary(event.target.value)} rows={compact ? 4 : 5} className="mt-2 w-full resize-y rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100" placeholder="Nova can prepare this, or leave it blank and send your report directly." />
          </div>

          {capture.errorCode ? <div className="rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800"><strong>Detected:</strong> {capture.errorCode}{capture.errorMessage ? ` · ${capture.errorMessage}` : ""}</div> : null}
          {notice ? <div className="rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-800">{notice}</div> : null}
          <div className="flex justify-end"><button type="submit" disabled={!description.trim() || Boolean(busy)} className="inline-flex h-11 items-center gap-2 rounded-lg bg-sky-600 px-5 text-sm font-semibold text-white disabled:opacity-50">{busy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send report</button></div>
        </form>

        {tickets.length ? <section className="mt-8 border-t border-slate-200 pt-5"><h3 className="text-sm font-semibold text-slate-800">Recent reports</h3><div className="mt-3 divide-y divide-slate-100">{tickets.slice(0, 10).map((ticket) => <div key={ticket.id} className="flex items-start gap-3 py-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><div className="min-w-0"><p className="text-xs font-semibold text-slate-800">{ticket.ticketNumber}</p><p className="mt-1 truncate text-xs text-slate-500">{ticket.description || ticket.pagePath}</p></div><span className="ml-auto shrink-0 text-[10px] font-semibold text-slate-400">{ticket.deliveryStatus}</span></div>)}</div></section> : null}
      </div>
    </div>
  );
}
