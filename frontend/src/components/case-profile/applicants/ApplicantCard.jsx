import { Check, KeyRound, Mail, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { formatDate, getInitials } from "../caseProfileUtils";

function Detail({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium text-slate-800">{value || "Not set"}</dd>
    </div>
  );
}

export default function ApplicantCard({ applicant, onEdit, onRemove }) {
  return (
    <article className="overflow-hidden rounded-[1.75rem] border border-white/90 bg-white/85 shadow-[0_16px_50px_rgba(15,23,42,0.07)] backdrop-blur-xl">
      <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(145deg,#0f172a,#64748b)] text-sm font-bold text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)]">
            {getInitials(applicant.fullName)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold tracking-tight text-slate-950">{applicant.fullName}</h3>
              {applicant.isPrimary ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-950 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                  <Check className="h-3 w-3" /> Primary
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-sm text-slate-500">{applicant.profileType}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {!applicant.isPrimary ? (
            <>
              <button type="button" onClick={() => onEdit(applicant)} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"><Pencil className="h-3.5 w-3.5" /> Edit</button>
              <button type="button" onClick={() => onRemove(applicant)} className="inline-flex items-center gap-1.5 rounded-full border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-100"><Trash2 className="h-3.5 w-3.5" /> Remove</button>
            </>
          ) : null}
          {applicant.communicationEmail ? (
            <a href={`mailto:${applicant.communicationEmail}`} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-950">
              <Mail className="h-3.5 w-3.5" /> Email
            </a>
          ) : null}
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold ${applicant.loginUsername ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {applicant.loginUsername ? <ShieldCheck className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />}
            {applicant.loginUsername ? "Portal configured" : "No portal login"}
          </span>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-5 px-5 py-5 sm:grid-cols-2 xl:grid-cols-4">
        <Detail label="Given name(s)" value={applicant.givenNames} />
        <Detail label="Family name" value={applicant.familyName} />
        <Detail label="Date of birth" value={applicant.dateOfBirth ? formatDate(applicant.dateOfBirth) : null} />
        <Detail label="Relationship" value={applicant.relationship} />
        <Detail label="UCI" value={applicant.uci} />
        <Detail label="Application number (IRCC)" value={applicant.applicationNumber} />
        <Detail label="Communication email" value={applicant.communicationEmail} />
        <Detail label="Login username or email" value={applicant.loginUsername} />
      </dl>

      <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Case access</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {applicant.caseAccesses?.map((access) => (
            <span key={access.caseId} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
              {access.reference}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}
