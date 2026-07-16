import { ChevronDown, LoaderCircle, Plus, UserRound, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../../services/api";
import ApplicantCard from "./ApplicantCard";
import ApplicantForm, { createApplicantDraft, createApplicantEditDraft } from "./ApplicantForm";
import { applicantProfileOptions } from "./applicantProfileOptions";

export default function ApplicantsOverlay({ caseItem, onClose }) {
  const [applicants, setApplicants] = useState([]);
  const [availableCases, setAvailableCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const menuRef = useRef(null);

  async function loadApplicants() {
    try {
      setLoading(true);
      const response = await api.get(`/cases/${caseItem.id}/applicants`);
      setApplicants(response.data.data || []);
      setAvailableCases(response.data.availableCases || []);
      setLoadError("");
    } catch (error) {
      setLoadError(error.response?.data?.message || "Applicants could not load.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadApplicants();
  }, [caseItem.id]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        if (draft) setDraft(null);
        else if (removeTarget) setRemoveTarget(null);
        else onClose();
      }
    }
    function handlePointerDown(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [draft, removeTarget, onClose]);

  function startProfile(profileType) {
    setDraft(createApplicantDraft(profileType, caseItem.id));
    setFormError("");
    setMenuOpen(false);
  }

  async function submitApplicant(event) {
    event.preventDefault();
    try {
      setSaving(true);
      setFormError("");
      if (draft.id) await api.patch(`/cases/${caseItem.id}/applicants/${draft.id}`, draft);
      else await api.post(`/cases/${caseItem.id}/applicants`, draft);
      setDraft(null);
      await loadApplicants();
    } catch (error) {
      setFormError(error.response?.data?.message || "Applicant could not be added.");
    } finally {
      setSaving(false);
    }
  }

  async function removeApplicant() {
    try {
      setSaving(true);
      setFormError("");
      await api.delete(`/cases/${caseItem.id}/applicants/${removeTarget.id}`);
      setRemoveTarget(null);
      await loadApplicants();
    } catch (error) {
      setFormError(error.response?.data?.message || "Applicant could not be removed.");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[180] flex justify-end bg-slate-950/25 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.section initial={{ x: 80, opacity: 0.8 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 80, opacity: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} className="flex h-full w-full max-w-5xl flex-col border-l border-white/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))] shadow-[-24px_0_80px_rgba(15,23,42,0.16)]">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200/70 bg-white/80 px-5 py-4 backdrop-blur-xl sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_10px_25px_rgba(15,23,42,0.18)]"><UserRound className="h-5 w-5" /></div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Case profile</p>
              <h2 className="truncate text-xl font-semibold tracking-tight text-slate-950">Applicants</h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div ref={menuRef} className="relative">
              <button type="button" onClick={() => setMenuOpen((current) => !current)} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(15,23,42,0.18)] transition hover:bg-slate-800">
                <Plus className="h-4 w-4" /> Add profile <ChevronDown className={`h-4 w-4 transition ${menuOpen ? "rotate-180" : ""}`} />
              </button>
              <AnimatePresence>
                {menuOpen ? (
                  <motion.div initial={{ opacity: 0, y: -5, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5, scale: 0.98 }} className="absolute right-0 top-[calc(100%+10px)] z-20 w-[310px] rounded-[1.5rem] border border-slate-200/90 bg-white p-2 shadow-[0_20px_55px_rgba(15,23,42,0.16)]">
                    {applicantProfileOptions.map((option) => {
                      const Icon = option.icon;
                      return (
                        <button key={option.value} type="button" onClick={() => startProfile(option.value)} className="flex w-full items-start gap-3 rounded-[1.1rem] px-3 py-3 text-left transition hover:bg-slate-50">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><Icon className="h-4 w-4" /></span>
                          <span><span className="block text-sm font-semibold text-slate-900">Add {option.label}</span><span className="mt-0.5 block text-xs leading-5 text-slate-400">{option.description}</span></span>
                        </button>
                      );
                    })}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
            <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950" aria-label="Close applicants"><X className="h-4 w-4" /></button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          <div className="mx-auto max-w-4xl">
            {draft ? (
              <div className="mb-6">
                <ApplicantForm draft={draft} setDraft={setDraft} cases={availableCases} currentCaseId={caseItem.id} saving={saving} error={formError} onCancel={() => { setDraft(null); setFormError(""); }} onSubmit={submitApplicant} />
              </div>
            ) : null}

            {loading && !applicants.length ? (
              <div className="flex min-h-64 items-center justify-center"><LoaderCircle className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : loadError ? (
              <div className="rounded-[1.5rem] bg-rose-50 px-5 py-4 text-sm font-medium text-rose-700">{loadError}</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-end justify-between gap-4 px-1">
                  <div><h3 className="text-sm font-semibold text-slate-950">People on this case</h3><p className="mt-1 text-xs text-slate-400">{applicants.length} {applicants.length === 1 ? "profile" : "profiles"} connected</p></div>
                </div>
                {applicants.map((applicant) => <ApplicantCard key={applicant.id} applicant={applicant} onEdit={(item) => { setDraft(createApplicantEditDraft(item)); setFormError(""); }} onRemove={(item) => { setRemoveTarget(item); setFormError(""); }} />)}
              </div>
            )}
          </div>
        </div>
      </motion.section>
      {removeTarget ? (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
          <button type="button" className="absolute inset-0" onClick={() => !saving && setRemoveTarget(null)} aria-label="Cancel applicant removal" />
          <section className="relative w-full max-w-md rounded-[1.75rem] border border-white/80 bg-white p-6 shadow-[0_30px_90px_rgba(15,23,42,0.3)]">
            <h3 className="text-lg font-semibold text-slate-950">Remove {removeTarget.fullName}?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">This removes the profile from this case. Connections to any other cases are preserved.</p>
            {formError ? <p className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{formError}</p> : null}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => { setRemoveTarget(null); setFormError(""); }} className="rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">Keep profile</button>
              <button type="button" disabled={saving} onClick={removeApplicant} className="rounded-full bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Removing…" : "Remove from case"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </motion.div>,
    document.body,
  );
}
