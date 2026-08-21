import { AlertTriangle, CheckCircle2, Loader2, Wand2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import api from "../../services/api";

const card = "rounded-[1.4rem] border border-white/70 bg-white/80 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur-xl";

// One-click retroactive fix for cases whose RCIC/Case Worker team was never
// completed — existing cases from before Collaboration required a team, or
// ones an automated path (bulk Case Easy import, a public booking) couldn't
// fully resolve on its own. Safe to click more than once: a second run only
// ever looks at each case's current coverage.
export default function CaseTeamBackfillPanel() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);

  async function run() {
    setRunning(true);
    setError("");
    setReport(null);
    try {
      const response = await api.post("/cases/collaboration-backfill");
      setReport(response.data.data);
    } catch (reason) {
      setError(reason.response?.data?.message || "The backfill could not run.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600"><Wand2 className="h-4 w-4" /></span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Apply RCIC and Case Worker to existing cases</h3>
            <p className="text-xs text-slate-500">Assigns the required team to every case that's missing one, using the same default an automated case would get — the sole eligible RCIC or Case Worker already in the system, or the case's current owner if they qualify.</p>
          </div>
        </div>
        <button type="button" onClick={run} disabled={running} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          {running ? "Running…" : "Run backfill"}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

      {report ? (
        <div className="mt-4 space-y-3">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> {report.fixedCount} case{report.fixedCount === 1 ? "" : "s"} fixed automatically.
          </p>
          {report.stillNeedsReviewCount ? (
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-amber-700">
                <AlertTriangle className="h-4 w-4" /> {report.stillNeedsReviewCount} case{report.stillNeedsReviewCount === 1 ? "" : "s"} still need a manual pick — no unambiguous default was available.
              </p>
              <ul className="mt-2 space-y-1.5">
                {report.stillNeedsReview.map((item) => (
                  <li key={item.caseId} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs">
                    <span className="truncate text-slate-700">{item.clientName || "Client"} · {item.caseType} — missing {item.missing.join(", ")}</span>
                    <Link to={`/app/cases/${item.caseId}`} className="shrink-0 font-semibold text-sky-600 hover:underline">Open case</Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
