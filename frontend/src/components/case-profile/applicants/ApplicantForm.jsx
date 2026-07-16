import { Check, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { getProfileOption } from "./applicantProfileOptions";

const inputClassName = "mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-300 focus:border-sky-300 focus:ring-4 focus:ring-sky-100";

function Field({ label, detail, children }) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      {children}
      {detail ? <span className="mt-1.5 block text-xs text-slate-400">{detail}</span> : null}
    </label>
  );
}

export function createApplicantDraft(profileType, currentCaseId) {
  return {
    profileType,
    givenNames: "",
    familyName: "",
    dateOfBirth: "",
    relationship: "",
    uci: "",
    applicationNumber: "",
    communicationEmail: "",
    loginUsername: "",
    password: "",
    caseIds: currentCaseId ? [currentCaseId] : [],
  };
}

export function createApplicantEditDraft(applicant) {
  return {
    id: applicant.id,
    profileType: applicant.profileType,
    givenNames: applicant.givenNames || "",
    familyName: applicant.familyName || "",
    dateOfBirth: applicant.dateOfBirth ? String(applicant.dateOfBirth).slice(0, 10) : "",
    relationship: applicant.relationship || "",
    uci: applicant.uci || "",
    applicationNumber: applicant.applicationNumber || "",
    communicationEmail: applicant.communicationEmail || "",
    loginUsername: applicant.loginUsername || "",
    password: "",
    caseIds: (applicant.caseAccesses || []).map((access) => access.caseId),
  };
}

export default function ApplicantForm({ draft, setDraft, cases, currentCaseId, saving, error, onCancel, onSubmit }) {
  const [showPassword, setShowPassword] = useState(false);
  const profileOption = getProfileOption(draft.profileType);
  const ProfileIcon = profileOption.icon;
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  function toggleCase(caseId) {
    if (caseId === currentCaseId) return;
    setDraft((current) => ({
      ...current,
      caseIds: current.caseIds.includes(caseId)
        ? current.caseIds.filter((id) => id !== caseId)
        : [...current.caseIds, caseId],
    }));
  }

  return (
    <form onSubmit={onSubmit} className="rounded-[1.75rem] border border-slate-200/80 bg-slate-50/75 p-4 sm:p-5">
      <div className="flex items-center gap-3 border-b border-slate-200/70 pb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white"><ProfileIcon className="h-4 w-4" /></div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{draft.id ? "Edit immigration profile" : "New immigration profile"}</p>
          <h3 className="text-base font-semibold text-slate-950">{draft.id ? `Update ${profileOption.label}` : `Add ${profileOption.label}`}</h3>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Given Name(s)"><input required value={draft.givenNames} onChange={(event) => update("givenNames", event.target.value)} className={inputClassName} /></Field>
        <Field label="Family Name"><input required value={draft.familyName} onChange={(event) => update("familyName", event.target.value)} className={inputClassName} /></Field>
        <Field label="Date of Birth"><input type="date" value={draft.dateOfBirth} onChange={(event) => update("dateOfBirth", event.target.value)} className={inputClassName} /></Field>
        <Field label="Relationship"><input value={draft.relationship} onChange={(event) => update("relationship", event.target.value)} placeholder="e.g. Spouse, dependant" className={inputClassName} /></Field>
        <Field label="UCI (Unique Client Identifier)"><input value={draft.uci} onChange={(event) => update("uci", event.target.value)} className={inputClassName} /></Field>
        <Field label="Application Number (IRCC)"><input value={draft.applicationNumber} onChange={(event) => update("applicationNumber", event.target.value)} className={inputClassName} /></Field>
        <Field label="Communication Email"><input type="email" value={draft.communicationEmail} onChange={(event) => update("communicationEmail", event.target.value)} className={inputClassName} /></Field>
        <Field label="Login Username or Email" detail="Username/Email must be unique"><input value={draft.loginUsername} onChange={(event) => update("loginUsername", event.target.value)} autoComplete="off" className={inputClassName} /></Field>
        <Field label={draft.id ? "New password (optional)" : "Password (optional)"} detail={draft.id ? "Leave blank to keep the current password" : "Password is shared with Applicant"}>
          <div className="relative">
            <input type={showPassword ? "text" : "password"} value={draft.password} onChange={(event) => update("password", event.target.value)} autoComplete="new-password" className={`${inputClassName} pr-11`} />
            <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-2.5 top-[18px] flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
      </div>

      <fieldset className="mt-6">
        <legend className="text-sm font-semibold text-slate-950">What case(s) should this applicant have access to?</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {cases.map((caseItem) => {
            const selected = draft.caseIds.includes(caseItem.id);
            const locked = caseItem.id === currentCaseId;
            return (
              <button key={caseItem.id} type="button" onClick={() => toggleCase(caseItem.id)} className={`flex items-center justify-between rounded-2xl border px-3.5 py-3 text-left transition ${selected ? "border-slate-950 bg-slate-950 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{caseItem.reference}</span>
                  <span className={`block truncate text-xs ${selected ? "text-slate-300" : "text-slate-400"}`}>{caseItem.caseType}</span>
                </span>
                <span className={`ml-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-white bg-white text-slate-950" : "border-slate-300"}`}>{selected ? <Check className="h-3 w-3" /> : null}</span>
                {locked ? <span className="sr-only">Current case, required</span> : null}
              </button>
            );
          })}
        </div>
      </fieldset>

      {error ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

      <div className="mt-6 flex items-center justify-end gap-2 border-t border-slate-200/70 pt-4">
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-full px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-950">Cancel</button>
        <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(15,23,42,0.2)] transition hover:bg-slate-800 disabled:opacity-60">
          {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null} {draft.id ? "Save changes" : `Add ${profileOption.label}`}
        </button>
      </div>
    </form>
  );
}
