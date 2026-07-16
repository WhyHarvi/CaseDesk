import { Download, FileText, LoaderCircle, Printer, RefreshCw, X } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";
import StatementFilters from "./StatementFilters";
import StatementPreview from "./StatementPreview";

export default function StatementOfAccountOverlay({ clientId, initialCaseId = "", onClose }) {
  const [options, setOptions] = useState({ cases: [], currencies: ["CAD"], defaultCurrency: "CAD" });
  const [filters, setFilters] = useState({ periodMode: "all", from: "", to: "", caseId: initialCaseId, currency: "CAD" });
  const [statement, setStatement] = useState(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.get(`/clients/${clientId}/statements/account/options`).then((response) => {
      if (!active) return;
      const next = response.data.data;
      setOptions(next);
      setFilters((current) => ({ ...current, currency: next.defaultCurrency || next.currencies?.[0] || "CAD" }));
      setError("");
    }).catch((requestError) => {
      if (active) setError(requestError.response?.data?.message || "Statement options could not load.");
    }).finally(() => { if (active) setLoadingOptions(false); });
    return () => { active = false; };
  }, [clientId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", handleKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", handleKeyDown); };
  }, [onClose]);

  async function generate(event) {
    event?.preventDefault();
    try {
      setGenerating(true);
      setError("");
      const response = await api.post(`/clients/${clientId}/statements/account`, {
        caseId: filters.caseId || null,
        currency: filters.currency,
        from: filters.periodMode === "custom" ? filters.from : null,
        to: filters.periodMode === "custom" ? filters.to : null,
      });
      setStatement(response.data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Statement could not be generated.");
    } finally {
      setGenerating(false);
    }
  }

  async function downloadPdf() {
    if (!statement) return;
    try {
      setDownloading(true);
      setError("");
      const response = await api.get(`/clients/${clientId}/statements/account/${statement.id}?format=pdf`, { responseType: "blob", timeout: 30000 });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${statement.statementNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "PDF could not be downloaded.");
    } finally {
      setDownloading(false);
    }
  }

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[190] flex justify-end bg-slate-950/30 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.section initial={{ x: 90, opacity: 0.8 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 90, opacity: 0 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} className="flex h-full w-full max-w-6xl flex-col border-l border-white/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.99),rgba(241,245,249,0.99))] shadow-[-24px_0_80px_rgba(15,23,42,0.18)]">
        <header className="statement-no-print flex shrink-0 items-center justify-between gap-4 border-b border-slate-200/70 bg-white/85 px-5 py-4 backdrop-blur-xl sm:px-7">
          <div className="flex min-w-0 items-center gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_10px_25px_rgba(15,23,42,0.18)]"><FileText className="h-5 w-5" /></div><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Billing</p><h2 className="text-xl font-semibold tracking-tight text-slate-950">Statement of Account</h2></div></div>
          <div className="flex items-center gap-2">{statement ? <><button type="button" onClick={generate} disabled={generating} className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 sm:inline-flex"><RefreshCw className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} /> Regenerate</button><button type="button" onClick={() => window.print()} className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 sm:inline-flex"><Printer className="h-4 w-4" /> Print</button><button type="button" onClick={downloadPdf} disabled={downloading} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(15,23,42,0.18)] disabled:opacity-50">{downloading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF</button></> : null}<button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950" aria-label="Close statement"><X className="h-4 w-4" /></button></div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          <div className="mx-auto max-w-5xl space-y-5">
            {loadingOptions ? <div className="flex min-h-64 items-center justify-center"><LoaderCircle className="h-6 w-6 animate-spin text-slate-400" /></div> : <><StatementFilters filters={filters} setFilters={setFilters} options={options} generating={generating} error={error} onGenerate={generate} />{statement ? <StatementPreview statement={statement} /> : !error ? <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white/50 px-6 py-12 text-center"><FileText className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-800">Choose the period and case</p><p className="mt-1 text-sm text-slate-400">The preview will use saved billing records only.</p></div> : null}</>}
          </div>
        </div>
      </motion.section>
    </motion.div>,
    document.body,
  );
}
