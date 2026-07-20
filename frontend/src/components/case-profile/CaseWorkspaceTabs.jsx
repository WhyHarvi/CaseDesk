import {
  Baby,
  ChevronDown,
  CheckCircle2,
  FileText,
  HeartHandshake,
  History,
  IdCard,
  MapPin,
  Plane,
  Plus,
  Save,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import {
  formatCurrency,
  formatDate,
  getPaymentStatusStyles,
} from "./caseProfileUtils";
import RemindersWorkspace from "./RemindersWorkspace";
import QuestionnaireCatalog from "./QuestionnaireCatalog";
import ProfileQuestionnaireSection from "./ProfileQuestionnaireSection";
import {
  ParentsProfileQuestionnaire,
  RepeatableProfileQuestionnaire,
} from "./ProfileCollectionQuestionnaire";
import DocumentsWorkspace from "./DocumentsWorkspace";
import CaseFormsWorkspace from "./CaseFormsWorkspace";
import TasksWorkspace from "./TasksWorkspace";
import AgreementsLettersWorkspace from "./AgreementsLettersWorkspace";
import AppointmentsWorkspace from "./AppointmentsWorkspace";
import CaseBillingWorkspace from "./CaseBillingWorkspace";
const CommunicationWorkspace = lazy(() => import("./CommunicationWorkspace"));

const caseWorkspaceTabs = [
  "PROFILE",
  "REMINDERS",
  "QUESTIONNAIRES",
  "DOCUMENTS",
  "FORMS",
  "TASKS",
  "AGREEMENTS & LETTERS",
  "APPOINTMENTS",
  "COMMUNICATION",
  "BILLING",
];

const workspaceTabSlugs = {
  PROFILE: "profile",
  REMINDERS: "reminders",
  QUESTIONNAIRES: "questionnaires",
  DOCUMENTS: "documents",
  FORMS: "forms",
  TASKS: "tasks",
  "AGREEMENTS & LETTERS": "agreements-letters",
  APPOINTMENTS: "appointments",
  COMMUNICATION: "communication",
  BILLING: "billing",
};

const workspaceTabFromSlug = (slug) =>
  caseWorkspaceTabs.find((tab) => workspaceTabSlugs[tab] === slug) ||
  caseWorkspaceTabs[0];

const profileDetailTabs = [
  { label: "APPLICANT DETAILS", icon: UserRound },
  { label: "SPOUSE DETAILS", icon: HeartHandshake },
  { label: "CHILDREN", icon: Baby },
  { label: "SIBLING DETAILS", icon: UserPlus },
  { label: "PARENT DETAILS", icon: Users },
  { label: "ACTIVITY HISTORY", icon: History },
  { label: "ADDRESS HISTORY", icon: MapPin },
  { label: "TRAVEL HISTORY", icon: Plane },
  { label: "IDENTITY & PERMITS", icon: IdCard },
  { label: "CANADIAN STATUS", icon: IdCard },
  { label: "BACKGROUND & ADMISSIBILITY", icon: FileText },
  { label: "RELATIONSHIP & SPONSORSHIP", icon: HeartHandshake },
  { label: "PROGRAM DETAILS", icon: FileText },
  { label: "HUMANITARIAN & CITIZENSHIP", icon: Users },
  { label: "REHABILITATION", icon: History },
  { label: "REFUGEE & PROTECTION", icon: FileText },
];

const applicantDetailViews = [
  "Overview",
  "Work",
  "Education",
  "Language Tests",
];
const spouseDetailViews = ["Work", "Education", "Language Tests"];
const languageAbilities = ["Speaking", "Listening", "Reading", "Writing"];
const yesNoOptions = ["", "Yes", "No"];
const officialLanguagePriorityOptions = [
  "",
  "First official language",
  "Second official language",
];
const languageTestOptions = [
  "",
  "IELTS",
  "CELPIP-G",
  "PTE Core",
  "TEF Canada",
  "TCF Canada",
];
const employmentTypeOptions = ["", "Full-time", "Part-time", "Self-employed"];
const nocTeerOptions = [
  "",
  "TEER 0",
  "TEER 1",
  "TEER 2",
  "TEER 3",
  "TEER 4",
  "TEER 5",
];
const credentialOptions = [
  "",
  "Secondary/high school diploma",
  "Certificate",
  "Diploma",
  "Bachelor's degree",
  "Master's degree",
  "Doctoral degree",
  "Trade/apprenticeship credential",
  "Other",
];
const workHistoryFields = [
  { key: "startDate", label: "Start Date", type: "date" },
  {
    key: "endDate",
    label: 'End Date (leave blank if "Ongoing")',
    type: "date",
  },
  { key: "jobTitle", label: "What was the Job Title, Occupation or Activity?" },
  { key: "employerName", label: "Name of Company, Employer or Facility" },
  { key: "address", label: "What's the address?" },
  { key: "city", label: "City/Town of Employer or Facility" },
  { key: "country", label: "Country of Employer or Facility" },
  {
    key: "provinceState",
    label: "Province/State",
    detail: "Required for Canada/US",
  },
  {
    key: "nocTeer",
    label: "Job NOC/TEER Category",
    detail:
      "The official IRCC classification that matches the actual work performed.",
    type: "select",
    options: nocTeerOptions,
  },
  {
    key: "employmentType",
    label: "Was this job full-time or part-time?",
    type: "select",
    options: employmentTypeOptions,
  },
  {
    key: "averageWeeklyHours",
    label: "Average Weekly Hours Worked",
    type: "number",
  },
  {
    key: "monthlyGrossSalary",
    label: "Monthly gross salary/income",
    type: "number",
  },
  {
    key: "fullTimeStudent",
    label: "Was the job done while you were a full-time student?",
    type: "select",
    options: yesNoOptions,
  },
  {
    key: "validWorkPermit",
    label: "Were you employed legally under a valid work permit?",
    type: "select",
    options: yesNoOptions,
  },
  {
    key: "paidPosition",
    label: "Was your position paid?",
    type: "select",
    options: yesNoOptions,
  },
  {
    key: "workPermitType",
    label: "What type of work permit did you hold during this period?",
  },
];
const blankWorkHistoryEntry = workHistoryFields.reduce(
  (entry, field) => ({ ...entry, [field.key]: "" }),
  {},
);
const educationHistoryFields = [
  { key: "startDate", label: "Start Date", type: "date" },
  {
    key: "endDate",
    label: 'End Date (leave blank if "Ongoing")',
    type: "date",
  },
  { key: "institutionName", label: "Name of Institution" },
  { key: "city", label: "City/Town of Institution" },
  { key: "country", label: "Country of Institution" },
  {
    key: "provinceState",
    label: "Province/State",
    detail: "Required for Canada/US",
  },
  {
    key: "credentialType",
    label: "What type of credential was issued?",
    type: "select",
    options: credentialOptions,
  },
  { key: "fieldOfStudy", label: "Field of Study" },
  { key: "degreeDiplomaAwarded", label: "Degree/Diploma Awarded" },
  {
    key: "ecaCompleted",
    label: "Educational Credential Assessment Completed (ECA)",
    type: "select",
    options: yesNoOptions,
  },
  {
    key: "ecaCompletedDate",
    label: "Date of Educational Credential Assessment Completed (ECA)",
    type: "date",
  },
];
const educationYearFields = [
  {
    key: "elementaryYears",
    label: "Total number of years of Elementary/primary school",
    type: "number",
  },
  {
    key: "secondaryYears",
    label: "Total number of years of Secondary/high school",
    type: "number",
  },
  {
    key: "universityCollegeYears",
    label: "Total number of years of University/college",
    type: "number",
  },
  {
    key: "tradeSchoolYears",
    label:
      "Total number of years of Trade school or other post secondary school",
    type: "number",
  },
  {
    key: "combinedEducationYears",
    label: "Total combined number of years of education completed",
    detail:
      "Combine the total number of years spent at primary, secondary, and post-secondary education.",
    type: "number",
  },
];
const blankEducationHistoryEntry = educationHistoryFields.reduce(
  (entry, field) => ({ ...entry, [field.key]: "" }),
  {},
);
const blankEducationYearSummary = educationYearFields.reduce(
  (entry, field) => ({ ...entry, [field.key]: "" }),
  {},
);
const languageExamDetailFields = [
  {
    key: "officialLanguagePriority",
    label:
      "Please indicate whether this test score is for your first or second official language",
    detail:
      "Your first official language is the language you are most proficient in and is used to calculate most CRS points.",
    type: "select",
    options: officialLanguagePriorityOptions,
  },
  {
    key: "testType",
    label: "What type of test did you complete?",
    type: "select",
    options: languageTestOptions,
  },
  { key: "examDate", label: "Date of Exam", type: "date" },
  { key: "expiryDate", label: "Expiry Date", type: "date" },
];
const languageExamScoreFields = [
  { key: "listening", label: "Listening", type: "number" },
  { key: "reading", label: "Reading", type: "number" },
  { key: "writing", label: "Writing", type: "number" },
  { key: "speaking", label: "Speaking", type: "number" },
];
const blankLanguageExamEntry = [
  ...languageExamDetailFields,
  ...languageExamScoreFields,
].reduce((entry, field) => ({ ...entry, [field.key]: "" }), {});

function CompactMetric({ label, value, detail }) {
  return (
    <div className="rounded-[1.15rem] bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold text-slate-950">{value}</p>
      {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
    </div>
  );
}

function QuietList({ items, emptyMessage, renderItem }) {
  if (!items.length) {
    return (
      <div className="rounded-[1.25rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-[1.25rem] border border-slate-100">
      {items.map(renderItem)}
    </div>
  );
}

function DetailField({ label, value }) {
  const displayValue = value === 0 ? "0" : value || "Not set";

  return (
    <div className="rounded-[1.05rem] bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-slate-900">
        {displayValue}
      </p>
    </div>
  );
}

function QuestionnaireField({ label, value, detail }) {
  const displayValue = value === 0 ? "0" : value || "Not captured yet";

  return (
    <div className="rounded-[1.05rem] bg-white px-4 py-3 ring-1 ring-slate-100">
      <p className="text-sm font-semibold leading-5 text-slate-800">{label}</p>
      {detail ? (
        <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
      ) : null}
      <p className="mt-3 text-sm font-semibold text-slate-950">
        {displayValue}
      </p>
    </div>
  );
}

function hasMeaningfulWorkExperience(value) {
  const normalized = String(value || "").toLowerCase();
  return Boolean(normalized) && !normalized.includes("none");
}

function hasMeaningfulWorkHistoryEntry(entry) {
  return Object.values(entry || {}).some((value) => String(value || "").trim());
}

function hasMeaningfulEducationHistoryEntry(entry) {
  return Object.values(entry || {}).some((value) => String(value || "").trim());
}

function hasMeaningfulLanguageExamEntry(entry) {
  return Object.values(entry || {}).some((value) => String(value || "").trim());
}

function buildLanguageExamEntriesFromCrs(languageAnswers = {}) {
  const entries = [];

  if (languageAnswers.firstLanguageTest) {
    entries.push({
      ...blankLanguageExamEntry,
      officialLanguagePriority: "First official language",
      testType: languageAnswers.firstLanguageTest,
      listening: languageAnswers.firstLanguageListeningClb || "",
      reading: languageAnswers.firstLanguageReadingClb || "",
      writing: languageAnswers.firstLanguageWritingClb || "",
      speaking: languageAnswers.firstLanguageSpeakingClb || "",
    });
  }

  if (
    languageAnswers.secondLanguageTest &&
    languageAnswers.secondLanguageTest !== "Not applicable"
  ) {
    entries.push({
      ...blankLanguageExamEntry,
      officialLanguagePriority: "Second official language",
      testType: languageAnswers.secondLanguageTest,
      listening: languageAnswers.secondLanguageListeningClb || "",
      reading: languageAnswers.secondLanguageReadingClb || "",
      writing: languageAnswers.secondLanguageWritingClb || "",
      speaking: languageAnswers.secondLanguageSpeakingClb || "",
    });
  }

  return entries;
}

function WorkHistoryInput({ field, value, onChange }) {
  const inputClassName =
    "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400";

  return (
    <label className="block">
      <span className="block text-sm font-semibold leading-5 text-slate-800">
        {field.label}
      </span>
      {field.detail ? (
        <span className="mt-1 block text-xs leading-5 text-slate-500">
          {field.detail}
        </span>
      ) : null}
      {field.type === "select" ? (
        <select
          value={value || ""}
          onChange={(event) => onChange(field.key, event.target.value)}
          className={inputClassName}
        >
          {(field.options || [""]).map((option) => (
            <option key={option || "empty"} value={option}>
              {option || "Select"}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.type || "text"}
          value={value || ""}
          onChange={(event) => onChange(field.key, event.target.value)}
          className={inputClassName}
        />
      )}
    </label>
  );
}

function WorkHistoryOverlay({
  initialEntry,
  initialEntries,
  initialMeta,
  saving,
  error,
  onClose,
  onSave,
}) {
  const [entries, setEntries] = useState(() => {
    const sourceEntries =
      Array.isArray(initialEntries) && initialEntries.length
        ? initialEntries
        : initialEntry
          ? [initialEntry]
          : [];
    const normalizedEntries = sourceEntries.map((entry) => ({
      ...blankWorkHistoryEntry,
      ...(entry || {}),
    }));

    return normalizedEntries.length
      ? normalizedEntries
      : [{ ...blankWorkHistoryEntry }];
  });
  const [meta, setMeta] = useState(() => ({
    hasWorkExperience: initialMeta?.hasWorkExperience || "",
    moreWorkHistory: initialMeta?.moreWorkHistory || "",
    workHistoryComplete: initialMeta?.workHistoryComplete || "",
  }));
  const [confirmingDeleteIndex, setConfirmingDeleteIndex] = useState(null);
  const shouldShowWorkHistoryDetails = meta.hasWorkExperience === "Yes";

  function updateEntry(entryIndex, fieldName, value) {
    setEntries((current) =>
      current.map((entry, index) =>
        index === entryIndex
          ? {
              ...entry,
              [fieldName]: value,
            }
          : entry,
      ),
    );
  }

  function addWorkEntry() {
    setConfirmingDeleteIndex(null);
    setEntries((current) => [...current, { ...blankWorkHistoryEntry }]);
    setMeta((current) => ({
      ...current,
      hasWorkExperience: "Yes",
      moreWorkHistory: "Yes",
      workHistoryComplete: "",
    }));
  }

  function deleteWorkEntry(entryIndex) {
    setEntries((current) => {
      const nextEntries = current.filter((_, index) => index !== entryIndex);
      return nextEntries.length ? nextEntries : [{ ...blankWorkHistoryEntry }];
    });
    setConfirmingDeleteIndex(null);
    setMeta((current) => ({
      ...current,
      workHistoryComplete: "",
    }));
  }

  function updateMeta(fieldName, value) {
    if (fieldName === "hasWorkExperience" && value === "No") {
      setEntries([{ ...blankWorkHistoryEntry }]);
      setMeta((current) => ({
        ...current,
        hasWorkExperience: value,
        moreWorkHistory: "No",
      }));
      return;
    }

    setMeta((current) => ({
      ...current,
      [fieldName]: value,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const savedEntries =
      meta.hasWorkExperience === "Yes"
        ? entries.filter(hasMeaningfulWorkHistoryEntry)
        : [];

    onSave({
      entry: savedEntries[0] || { ...blankWorkHistoryEntry },
      entries: savedEntries,
      meta: {
        ...meta,
        moreWorkHistory: savedEntries.length > 1 ? "Yes" : "No",
      },
    });
  }

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[290] bg-slate-950/24 p-3 backdrop-blur-md">
      <motion.form
        initial={{ opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.99 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onSubmit={handleSubmit}
        className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.26)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Client Information Form
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">
              Add Work History
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Save partial information anytime. The main Work tab will show
              whatever has been entered.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Close work history form"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {error ? (
            <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="space-y-5">
            <section className="rounded-[1.5rem] bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                1.0 Work History
              </p>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Provide the details of work experience since the age of 18, or
                the past 10 years, whichever is most recent. Start with the most
                recent information.
              </p>
              <label className="mt-4 block">
                <span className="block text-sm font-semibold text-slate-800">
                  1. Do you have any work experience since turning 18, or within
                  the past 10 years, whichever is more recent?
                </span>
                <select
                  value={meta.hasWorkExperience}
                  onChange={(event) =>
                    updateMeta("hasWorkExperience", event.target.value)
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400 md:max-w-xs"
                >
                  {yesNoOptions.map((option) => (
                    <option key={option || "empty"} value={option}>
                      {option || "Select"}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            {shouldShowWorkHistoryDetails ? (
              <section className="space-y-3">
                {entries.map((entry, entryIndex) => (
                  <div
                    key={`work-entry-${entryIndex}`}
                    className="rounded-[1.5rem] border border-slate-100 bg-white px-4 py-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          1.1 Enter Details About Work History
                        </p>
                        <h3 className="mt-1 text-sm font-semibold text-slate-950">
                          {entryIndex === 0
                            ? "Most recent work entry"
                            : `Additional work entry ${entryIndex + 1}`}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
                          {entryIndex + 1} of {entries.length}
                        </span>
                        {confirmingDeleteIndex === entryIndex ? (
                          <div className="flex items-center gap-1 rounded-full bg-rose-50 px-1.5 py-1 ring-1 ring-rose-100">
                            <span className="px-2 text-xs font-semibold text-rose-700">
                              Delete?
                            </span>
                            <button
                              type="button"
                              onClick={() => setConfirmingDeleteIndex(null)}
                              disabled={saving}
                              className="rounded-full px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteWorkEntry(entryIndex)}
                              disabled={saving}
                              className="rounded-full bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteIndex(entryIndex)}
                            disabled={saving}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-rose-50 text-rose-500 transition hover:bg-rose-100 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label={`Delete work entry ${entryIndex + 1}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      {workHistoryFields.map((field) => (
                        <WorkHistoryInput
                          key={field.key}
                          field={field}
                          value={entry[field.key]}
                          onChange={(fieldName, value) =>
                            updateEntry(entryIndex, fieldName, value)
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            ) : meta.hasWorkExperience === "No" ? (
              <section className="rounded-[1.5rem] bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                No work-history details are needed because the applicant
                answered No. Save to record this answer.
              </section>
            ) : null}

            <section className="rounded-[1.5rem] bg-slate-50 px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {shouldShowWorkHistoryDetails ? (
                  <button
                    type="button"
                    onClick={addWorkEntry}
                    className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 transition hover:bg-slate-950 hover:text-white hover:ring-slate-950"
                  >
                    <Plus className="h-4 w-4" />
                    Add another work entry
                  </button>
                ) : null}
                <label className="flex w-fit cursor-pointer items-center gap-3 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 transition hover:ring-slate-300">
                  <input
                    type="checkbox"
                    checked={meta.workHistoryComplete === "Yes"}
                    onChange={(event) =>
                      updateMeta(
                        "workHistoryComplete",
                        event.target.checked ? "Yes" : "No",
                      )
                    }
                    className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-400"
                  />
                  <span className="inline-flex items-center gap-2">
                    <CheckCircle2
                      className={`h-4 w-4 ${meta.workHistoryComplete === "Yes" ? "text-emerald-600" : "text-slate-300"}`}
                    />
                    Work history complete
                  </span>
                </label>
              </div>
            </section>
          </div>
        </main>

        <footer className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <FileText className="h-4 w-4" />
            <span>Partial work history can be saved and completed later.</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {meta.workHistoryComplete === "Yes" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "Saving" : "Save Work History"}
            </button>
          </div>
        </footer>
      </motion.form>
    </div>,
    document.body,
  );
}

function EducationHistoryOverlay({
  initialEntries,
  initialMeta,
  initialYearSummary,
  saving,
  error,
  onClose,
  onSave,
}) {
  const [entries, setEntries] = useState(() => {
    const sourceEntries =
      Array.isArray(initialEntries) && initialEntries.length
        ? initialEntries
        : [];
    const normalizedEntries = sourceEntries.map((entry) => ({
      ...blankEducationHistoryEntry,
      ...(entry || {}),
    }));

    return normalizedEntries.length
      ? normalizedEntries
      : [{ ...blankEducationHistoryEntry }];
  });
  const [yearSummary, setYearSummary] = useState(() => ({
    ...blankEducationYearSummary,
    ...(initialYearSummary || {}),
  }));
  const [meta, setMeta] = useState(() => ({
    hasEducation: initialMeta?.hasEducation || "",
    moreEducation: initialMeta?.moreEducation || "",
    educationHistoryComplete: initialMeta?.educationHistoryComplete || "",
  }));
  const [confirmingDeleteIndex, setConfirmingDeleteIndex] = useState(null);
  const shouldShowEducationDetails = meta.hasEducation === "Yes";

  function updateEntry(entryIndex, fieldName, value) {
    setEntries((current) =>
      current.map((entry, index) =>
        index === entryIndex
          ? {
              ...entry,
              [fieldName]: value,
            }
          : entry,
      ),
    );
  }

  function updateYearSummary(fieldName, value) {
    setYearSummary((current) => ({
      ...current,
      [fieldName]: value,
    }));
  }

  function addEducationEntry() {
    setConfirmingDeleteIndex(null);
    setEntries((current) => [...current, { ...blankEducationHistoryEntry }]);
    setMeta((current) => ({
      ...current,
      hasEducation: "Yes",
      moreEducation: "Yes",
      educationHistoryComplete: "",
    }));
  }

  function deleteEducationEntry(entryIndex) {
    setEntries((current) => {
      const nextEntries = current.filter((_, index) => index !== entryIndex);
      return nextEntries.length
        ? nextEntries
        : [{ ...blankEducationHistoryEntry }];
    });
    setConfirmingDeleteIndex(null);
    setMeta((current) => ({
      ...current,
      educationHistoryComplete: "",
    }));
  }

  function updateMeta(fieldName, value) {
    if (fieldName === "hasEducation" && value === "No") {
      setEntries([{ ...blankEducationHistoryEntry }]);
      setYearSummary({ ...blankEducationYearSummary });
      setMeta((current) => ({
        ...current,
        hasEducation: value,
        moreEducation: "No",
      }));
      return;
    }

    setMeta((current) => ({
      ...current,
      [fieldName]: value,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const savedEntries =
      meta.hasEducation === "Yes"
        ? entries.filter(hasMeaningfulEducationHistoryEntry)
        : [];

    onSave({
      entries: savedEntries,
      yearSummary:
        meta.hasEducation === "Yes"
          ? yearSummary
          : { ...blankEducationYearSummary },
      meta: {
        ...meta,
        moreEducation: savedEntries.length > 1 ? "Yes" : "No",
      },
    });
  }

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[290] bg-slate-950/24 p-3 backdrop-blur-md">
      <motion.form
        initial={{ opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.99 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onSubmit={handleSubmit}
        className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.26)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Client Information Form
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">
              Add Education History
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Save secondary and post-secondary education details. Some fields
              can be completed later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Close education history form"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {error ? (
            <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="space-y-5">
            <section className="rounded-[1.5rem] bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                1.0 Education History
              </p>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Give full details of all secondary and post-secondary education,
                including university, college and apprenticeship training.
              </p>
              <label className="mt-4 block">
                <span className="block text-sm font-semibold text-slate-800">
                  1. Do you have any secondary and/or post-secondary education?
                </span>
                <select
                  value={meta.hasEducation}
                  onChange={(event) =>
                    updateMeta("hasEducation", event.target.value)
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400 md:max-w-xs"
                >
                  {yesNoOptions.map((option) => (
                    <option key={option || "empty"} value={option}>
                      {option || "Select"}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            {shouldShowEducationDetails ? (
              <>
                <section className="space-y-3">
                  {entries.map((entry, entryIndex) => (
                    <div
                      key={`education-entry-${entryIndex}`}
                      className="rounded-[1.5rem] border border-slate-100 bg-white px-4 py-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            1.1 Education Details
                          </p>
                          <h3 className="mt-1 text-sm font-semibold text-slate-950">
                            {entryIndex === 0
                              ? "Most recent education"
                              : `Additional education ${entryIndex + 1}`}
                          </h3>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
                            {entryIndex + 1} of {entries.length}
                          </span>
                          {confirmingDeleteIndex === entryIndex ? (
                            <div className="flex items-center gap-1 rounded-full bg-rose-50 px-1.5 py-1 ring-1 ring-rose-100">
                              <span className="px-2 text-xs font-semibold text-rose-700">
                                Delete?
                              </span>
                              <button
                                type="button"
                                onClick={() => setConfirmingDeleteIndex(null)}
                                disabled={saving}
                                className="rounded-full px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteEducationEntry(entryIndex)}
                                disabled={saving}
                                className="rounded-full bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Delete
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmingDeleteIndex(entryIndex)
                              }
                              disabled={saving}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-rose-50 text-rose-500 transition hover:bg-rose-100 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                              aria-label={`Delete education entry ${entryIndex + 1}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        {educationHistoryFields.map((field) => {
                          if (
                            field.key === "ecaCompletedDate" &&
                            entry.ecaCompleted !== "Yes"
                          ) {
                            return null;
                          }

                          return (
                            <WorkHistoryInput
                              key={field.key}
                              field={field}
                              value={entry[field.key]}
                              onChange={(fieldName, value) =>
                                updateEntry(entryIndex, fieldName, value)
                              }
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>

                <section className="rounded-[1.5rem] border border-slate-100 bg-white px-4 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    1.2 Years Completed
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-slate-950">
                    Indicate the total number of years successfully completed
                    for each level of education.
                  </h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {educationYearFields.map((field) => (
                      <WorkHistoryInput
                        key={field.key}
                        field={field}
                        value={yearSummary[field.key]}
                        onChange={updateYearSummary}
                      />
                    ))}
                  </div>
                </section>
              </>
            ) : meta.hasEducation === "No" ? (
              <section className="rounded-[1.5rem] bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                No education details are needed because the applicant answered
                No. Save to record this answer.
              </section>
            ) : null}

            <section className="rounded-[1.5rem] bg-slate-50 px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {shouldShowEducationDetails ? (
                  <button
                    type="button"
                    onClick={addEducationEntry}
                    className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 transition hover:bg-slate-950 hover:text-white hover:ring-slate-950"
                  >
                    <Plus className="h-4 w-4" />
                    Add another education
                  </button>
                ) : null}
                <label className="flex w-fit cursor-pointer items-center gap-3 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 transition hover:ring-slate-300">
                  <input
                    type="checkbox"
                    checked={meta.educationHistoryComplete === "Yes"}
                    onChange={(event) =>
                      updateMeta(
                        "educationHistoryComplete",
                        event.target.checked ? "Yes" : "No",
                      )
                    }
                    className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-400"
                  />
                  <span className="inline-flex items-center gap-2">
                    <CheckCircle2
                      className={`h-4 w-4 ${meta.educationHistoryComplete === "Yes" ? "text-emerald-600" : "text-slate-300"}`}
                    />
                    Education history complete
                  </span>
                </label>
              </div>
            </section>
          </div>
        </main>

        <footer className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <FileText className="h-4 w-4" />
            <span>
              Partial education history can be saved and completed later.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {meta.educationHistoryComplete === "Yes" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "Saving" : "Save Education History"}
            </button>
          </div>
        </footer>
      </motion.form>
    </div>,
    document.body,
  );
}

function LanguageExamsOverlay({
  initialEntries,
  initialMeta,
  saving,
  error,
  onClose,
  onSave,
}) {
  const [entries, setEntries] = useState(() => {
    const sourceEntries =
      Array.isArray(initialEntries) && initialEntries.length
        ? initialEntries
        : [];
    const normalizedEntries = sourceEntries.map((entry) => ({
      ...blankLanguageExamEntry,
      ...(entry || {}),
    }));

    return normalizedEntries.length
      ? normalizedEntries
      : [{ ...blankLanguageExamEntry }];
  });
  const [meta, setMeta] = useState(() => ({
    languageExamsComplete: initialMeta?.languageExamsComplete || "",
  }));
  const [confirmingDeleteIndex, setConfirmingDeleteIndex] = useState(null);

  function updateEntry(entryIndex, fieldName, value) {
    setEntries((current) =>
      current.map((entry, index) =>
        index === entryIndex
          ? {
              ...entry,
              [fieldName]: value,
            }
          : entry,
      ),
    );
  }

  function addLanguageExamEntry() {
    setConfirmingDeleteIndex(null);
    setEntries((current) => [...current, { ...blankLanguageExamEntry }]);
    setMeta((current) => ({
      ...current,
      languageExamsComplete: "",
    }));
  }

  function deleteLanguageExamEntry(entryIndex) {
    setEntries((current) => {
      const nextEntries = current.filter((_, index) => index !== entryIndex);
      return nextEntries.length ? nextEntries : [{ ...blankLanguageExamEntry }];
    });
    setConfirmingDeleteIndex(null);
    setMeta((current) => ({
      ...current,
      languageExamsComplete: "",
    }));
  }

  function updateMeta(fieldName, value) {
    setMeta((current) => ({
      ...current,
      [fieldName]: value,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const savedEntries = entries.filter(hasMeaningfulLanguageExamEntry);

    onSave({
      entries: savedEntries,
      meta: {
        ...meta,
        moreLanguageExams: savedEntries.length > 1 ? "Yes" : "No",
      },
    });
  }

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[290] bg-slate-950/24 p-3 backdrop-blur-md">
      <motion.form
        initial={{ opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.99 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onSubmit={handleSubmit}
        className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.26)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Client Information Form
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">
              Add Language Exams
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Add current IELTS, CELPIP, PTE Core, TEF, or TCF scores. These
              scores can also update CRS language inputs.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Close language exams form"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {error ? (
            <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="space-y-5">
            <section className="rounded-[1.5rem] bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                1.0 Language Exams
              </p>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                If you have completed a valid language proficiency test and the
                results have not expired, provide your most recent scores.
              </p>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Accepted tests: International English Language Testing System
                (IELTS), Canadian English Language Proficiency Index Program
                (CELPIP), Pearson Test of English (PTE Core), Test d'evaluation
                de francais (TEF), and Test de connaissance du francais (TCF).
              </p>
            </section>

            <section className="space-y-3">
              {entries.map((entry, entryIndex) => (
                <div
                  key={`language-exam-entry-${entryIndex}`}
                  className="rounded-[1.5rem] border border-slate-100 bg-white px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        1.1 Exam Details
                      </p>
                      <h3 className="mt-1 text-sm font-semibold text-slate-950">
                        {entryIndex === 0
                          ? "Most recent language exam"
                          : `Additional language exam ${entryIndex + 1}`}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
                        {entryIndex + 1} of {entries.length}
                      </span>
                      {confirmingDeleteIndex === entryIndex ? (
                        <div className="flex items-center gap-1 rounded-full bg-rose-50 px-1.5 py-1 ring-1 ring-rose-100">
                          <span className="px-2 text-xs font-semibold text-rose-700">
                            Delete?
                          </span>
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteIndex(null)}
                            disabled={saving}
                            className="rounded-full px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteLanguageExamEntry(entryIndex)}
                            disabled={saving}
                            className="rounded-full bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteIndex(entryIndex)}
                          disabled={saving}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-rose-50 text-rose-500 transition hover:bg-rose-100 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`Delete language exam ${entryIndex + 1}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {languageExamDetailFields.map((field) => (
                      <WorkHistoryInput
                        key={field.key}
                        field={field}
                        value={entry[field.key]}
                        onChange={(fieldName, value) =>
                          updateEntry(entryIndex, fieldName, value)
                        }
                      />
                    ))}
                  </div>

                  <section className="mt-4 rounded-[1.25rem] bg-slate-50 px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      1.2{" "}
                      {entry.testType
                        ? `${entry.testType} Scores`
                        : "Language Scores"}
                    </p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      {languageExamScoreFields.map((field) => (
                        <WorkHistoryInput
                          key={field.key}
                          field={field}
                          value={entry[field.key]}
                          onChange={(fieldName, value) =>
                            updateEntry(entryIndex, fieldName, value)
                          }
                        />
                      ))}
                    </div>
                  </section>
                </div>
              ))}
            </section>

            <section className="rounded-[1.5rem] bg-slate-50 px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={addLanguageExamEntry}
                  className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 transition hover:bg-slate-950 hover:text-white hover:ring-slate-950"
                >
                  <Plus className="h-4 w-4" />
                  Add another language exam
                </button>
                <label className="flex w-fit cursor-pointer items-center gap-3 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 transition hover:ring-slate-300">
                  <input
                    type="checkbox"
                    checked={meta.languageExamsComplete === "Yes"}
                    onChange={(event) =>
                      updateMeta(
                        "languageExamsComplete",
                        event.target.checked ? "Yes" : "No",
                      )
                    }
                    className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-400"
                  />
                  <span className="inline-flex items-center gap-2">
                    <CheckCircle2
                      className={`h-4 w-4 ${meta.languageExamsComplete === "Yes" ? "text-emerald-600" : "text-slate-300"}`}
                    />
                    Language exams complete
                  </span>
                </label>
              </div>
            </section>
          </div>
        </main>

        <footer className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <FileText className="h-4 w-4" />
            <span>
              Save language exams to update the language-test history and CRS
              language inputs.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {meta.languageExamsComplete === "Yes" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "Saving" : "Save Language Exams"}
            </button>
          </div>
        </footer>
      </motion.form>
    </div>,
    document.body,
  );
}

function EmptyProfileDetail({ title, description }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-[1.35rem] bg-slate-50 px-5 py-8 text-center">
      <div>
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
          <Plus className="h-4 w-4" />
        </div>
        <h4 className="mt-3 text-sm font-semibold text-slate-950">{title}</h4>
        <p className="mt-2 max-w-md text-sm text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function ScoreGauge({ score }) {
  const normalizedScore = Number(score || 0);
  const percent = Math.min(100, Math.round((normalizedScore / 1200) * 100));
  const color =
    normalizedScore >= 470
      ? "#16a34a"
      : normalizedScore >= 350
        ? "#d97706"
        : "#dc2626";

  return (
    <div
      className="grid h-24 w-24 shrink-0 place-items-center rounded-full"
      style={{
        background: `conic-gradient(${color} ${percent}%, #e2e8f0 0)`,
      }}
    >
      <div className="grid h-16 w-16 place-items-center rounded-full bg-white">
        <span className="text-xl font-semibold text-slate-950">
          {normalizedScore}
        </span>
      </div>
    </div>
  );
}

function EvaluationScorecards({ clientName, assessment, onConductAssessment }) {
  const hasScore =
    assessment?.crsScore !== null && assessment?.crsScore !== undefined;

  return (
    <section className="rounded-[1.45rem] bg-[linear-gradient(135deg,#f8fafc,#eef2f7)] px-4 py-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-4">
          {hasScore ? <ScoreGauge score={assessment.crsScore} /> : null}
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Evaluation Scorecards
            </p>
            <h3 className="mt-2 truncate text-lg font-semibold tracking-tight text-slate-950">
              {(clientName || "Applicant").toUpperCase()}
            </h3>
            {hasScore ? (
              <p className="mt-1 text-sm text-slate-500">
                Estimated CRS score generated from the latest saved assessment.
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-500">
                No scorecards generated yet. Please click the Conduct Assessment
                button to get started.
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onConductAssessment}
          className="inline-flex w-fit items-center justify-center rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(15,23,42,0.16)] transition hover:bg-slate-800"
        >
          {hasScore ? "Update Assessment" : "Conduct Assessment"}
        </button>
      </div>
    </section>
  );
}

function ProfileDetailsGrid({
  caseItem,
  activityLogs,
  assessment,
  profileSectionRequest,
  onSaveProfileQuestionnaire,
  savingProfileQuestionnaire,
  profileQuestionnaireError,
  onSaveWorkHistory,
  savingWorkHistory,
  workHistoryError,
  onSaveEducationHistory,
  savingEducationHistory,
  educationHistoryError,
  onSaveLanguageExams,
  savingLanguageExams,
  languageExamsError,
  onSaveDependants,
  savingDependants,
  dependantsError,
  onSaveSiblings,
  savingSiblings,
  siblingsError,
  onSaveParents,
  savingParents,
  parentsError,
  onSaveActivityHistory,
  savingActivityHistory,
  activityHistoryError,
  onSaveAddressHistory,
  savingAddressHistory,
  addressHistoryError,
  onSaveTravelHistory,
  savingTravelHistory,
  travelHistoryError,
  onSaveIdentityPermits,
  savingIdentityPermits,
  identityPermitsError,
  onSaveSpouseDetails,
  savingSpouseDetails,
  spouseDetailsError,
}) {
  const [activeDetailTab, setActiveDetailTab] = useState(
    profileDetailTabs[0].label,
  );
  const [activeApplicantView, setActiveApplicantView] = useState(
    applicantDetailViews[0],
  );
  const [activeSpouseView, setActiveSpouseView] = useState(
    spouseDetailViews[0],
  );
  const [applicantMenuOpen, setApplicantMenuOpen] = useState(true);
  const [spouseMenuOpen, setSpouseMenuOpen] = useState(false);
  const [workHistoryOverlayOpen, setWorkHistoryOverlayOpen] = useState(false);
  const [educationHistoryOverlayOpen, setEducationHistoryOverlayOpen] =
    useState(false);
  const [languageExamsOverlayOpen, setLanguageExamsOverlayOpen] =
    useState(false);
  const [spouseWorkOverlayOpen, setSpouseWorkOverlayOpen] = useState(false);
  const [spouseEducationOverlayOpen, setSpouseEducationOverlayOpen] =
    useState(false);
  const [spouseLanguageOverlayOpen, setSpouseLanguageOverlayOpen] =
    useState(false);
  useEffect(() => {
    if (!profileSectionRequest?.tab) return;
    setActiveDetailTab(profileSectionRequest.tab);
    if (profileSectionRequest.tab === "APPLICANT DETAILS")
      setActiveApplicantView(profileSectionRequest.view || "Overview");
    if (
      profileSectionRequest.tab === "SPOUSE DETAILS" &&
      profileSectionRequest.view
    )
      setActiveSpouseView(profileSectionRequest.view);
  }, [profileSectionRequest]);
  const activeConfig =
    profileDetailTabs.find((tab) => tab.label === activeDetailTab) ||
    profileDetailTabs[0];
  const ActiveIcon = activeConfig.icon;
  const detailHeading =
    activeDetailTab === "APPLICANT DETAILS"
      ? activeApplicantView
      : activeDetailTab === "SPOUSE DETAILS"
        ? activeSpouseView
        : activeDetailTab;
  const client = caseItem.client || {};
  const assessmentForm = assessment?.formData || {};
  const profileAnswers = assessmentForm.profile || {};
  const workAnswers = assessmentForm.work || {};
  const educationAnswers = assessmentForm.education || {};
  const languageAnswers = assessmentForm.language || {};
  const spouseAnswers = assessmentForm.spouse || {};
  const languageExamAnswers = assessmentForm.languageExams || {};
  const breakdown = assessment?.crsBreakdown || {};
  const savedWorkHistory =
    workAnswers.workHistoryEntries ||
    workAnswers.workHistory ||
    assessmentForm.workHistory?.entries ||
    [];
  const workHistoryEntries = Array.isArray(savedWorkHistory)
    ? savedWorkHistory
    : [];
  const primaryWorkHistory = workHistoryEntries[0] || {};
  const savedEducationHistory =
    educationAnswers.educationHistoryEntries ||
    educationAnswers.educationHistory ||
    assessmentForm.educationHistory?.entries ||
    [];
  const educationHistoryEntries = Array.isArray(savedEducationHistory)
    ? savedEducationHistory
    : [];
  const educationYearSummary =
    educationAnswers.yearSummary ||
    assessmentForm.educationHistory?.yearSummary ||
    {};
  const savedLanguageExams =
    languageExamAnswers.languageExamEntries || languageExamAnswers.exams || [];
  const hasSavedLanguageExamRecord =
    Array.isArray(languageExamAnswers.languageExamEntries) ||
    Boolean(
      languageExamAnswers.languageExamsComplete ||
      languageExamAnswers.moreLanguageExams,
    );
  const languageExamEntries =
    Array.isArray(savedLanguageExams) &&
    (savedLanguageExams.length || hasSavedLanguageExamRecord)
      ? savedLanguageExams
      : buildLanguageExamEntriesFromCrs(languageAnswers);
  const spouseWorkEntries = Array.isArray(spouseAnswers.workHistoryEntries)
    ? spouseAnswers.workHistoryEntries
    : [];
  const spouseEducationEntries = Array.isArray(
    spouseAnswers.educationHistoryEntries,
  )
    ? spouseAnswers.educationHistoryEntries
    : [];
  const spouseEducationYearSummary = spouseAnswers.educationYearSummary || {};
  const spouseLanguageEntries = Array.isArray(spouseAnswers.languageExamEntries)
    ? spouseAnswers.languageExamEntries
    : spouseAnswers.spouseLanguageTest &&
        spouseAnswers.spouseLanguageTest !== "Not applicable"
      ? [
          {
            ...blankLanguageExamEntry,
            officialLanguagePriority: "First official language",
            testType: spouseAnswers.spouseLanguageTest,
            listening: spouseAnswers.spouseLanguageListeningClb || "",
            reading: spouseAnswers.spouseLanguageReadingClb || "",
            writing: spouseAnswers.spouseLanguageWritingClb || "",
            speaking: spouseAnswers.spouseLanguageSpeakingClb || "",
          },
        ]
      : [];

  function valueWithClb(rawValue, clbValue) {
    if (!rawValue) {
      return "Not set";
    }

    return clbValue ? `${rawValue} -> CLB ${clbValue}` : rawValue;
  }

  function renderLanguageAbilityGrid(prefix, clbValues = []) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {languageAbilities.map((ability, index) => (
          <DetailField
            key={`${prefix}${ability}`}
            label={ability}
            value={valueWithClb(
              languageAnswers[`${prefix}${ability}Clb`],
              clbValues[index],
            )}
          />
        ))}
      </div>
    );
  }

  function renderSpouseLanguageAbilityGrid(clbValues = []) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {languageAbilities.map((ability, index) => (
          <DetailField
            key={`spouseLanguage${ability}`}
            label={ability}
            value={valueWithClb(
              spouseAnswers[`spouseLanguage${ability}Clb`],
              clbValues[index],
            )}
          />
        ))}
      </div>
    );
  }

  function hasCurrentSpouseForProfile() {
    const normalized = String(profileAnswers.maritalStatus || "").toLowerCase();
    return normalized === "married" || normalized.includes("common-law");
  }

  function hasScoredSpouseForProfile() {
    return (
      hasCurrentSpouseForProfile() &&
      profileAnswers.spouseAccompany === "Yes" &&
      profileAnswers.spouseCanadianCitizenPr !== "Yes"
    );
  }

  function renderApplicantDetailContent() {
    if (activeApplicantView === "Work") {
      const hasAnyWorkExperience =
        workAnswers.hasWorkExperience ||
        (workHistoryEntries.length ? "Yes" : null) ||
        (hasMeaningfulWorkExperience(
          workAnswers.canadianSkilledExperienceYears,
        ) ||
        hasMeaningfulWorkExperience(workAnswers.foreignSkilledExperienceYears)
          ? "Yes"
          : "");
      const shouldShowWorkHistoryDetails = hasAnyWorkExperience === "Yes";

      if (!workHistoryEntries.length && !workAnswers.hasWorkExperience) {
        return (
          <div className="space-y-4">
            <section className="rounded-[1.35rem] bg-[linear-gradient(135deg,#f8fafc,#eef2f7)] px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Client Information Form
              </p>
              <h4 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">
                1.0 Work History
              </h4>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                Provide the details of work experience since the age of 18, or
                the past 10 years, whichever is most recent.
              </p>
            </section>

            <div className="flex min-h-[220px] items-center justify-center rounded-[1.35rem] bg-slate-50 px-5 py-8 text-center">
              <div>
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
                  <Plus className="h-4 w-4" />
                </div>
                <h4 className="mt-3 text-sm font-semibold text-slate-950">
                  No work history added yet
                </h4>
                <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                  Start with the most recent role. You can save even if the form
                  is not complete.
                </p>
                <button
                  type="button"
                  onClick={() => setWorkHistoryOverlayOpen(true)}
                  className="mt-4 inline-flex items-center justify-center rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Add Work History
                </button>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="space-y-4">
          <section className="rounded-[1.35rem] bg-[linear-gradient(135deg,#f8fafc,#eef2f7)] px-4 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Client Information Form
                </p>
                <h4 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">
                  1.0 Work History
                </h4>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                  Partial details are saved here and can be completed later.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWorkHistoryOverlayOpen(true)}
                className="inline-flex w-fit items-center justify-center rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                {workHistoryEntries.length
                  ? "Edit Work History"
                  : "Add Work History"}
              </button>
            </div>
          </section>

          <div className="grid gap-3 md:grid-cols-3">
            <DetailField
              label="Canadian skilled work"
              value={workAnswers.canadianSkilledExperienceYears}
            />
            <DetailField
              label="Foreign skilled work"
              value={workAnswers.foreignSkilledExperienceYears}
            />
            <DetailField
              label="Canadian work points"
              value={breakdown.coreHumanCapital?.canadianExperience}
            />
          </div>

          <section className="rounded-[1.35rem] bg-slate-50 px-4 py-4">
            <QuestionnaireField
              label="1. Do you have any work experience since turning 18, or within the past 10 years, whichever is more recent?"
              value={hasAnyWorkExperience}
            />
          </section>

          {shouldShowWorkHistoryDetails ? (
            <section className="rounded-[1.35rem] bg-slate-50 px-4 py-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    1.1 Enter Details About Work History
                  </p>
                  <h4 className="mt-2 text-base font-semibold text-slate-950">
                    Saved work entries
                  </h4>
                </div>
                <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-100">
                  {workHistoryEntries.length
                    ? `${workHistoryEntries.length} saved`
                    : "No saved entries"}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {(workHistoryEntries.length
                  ? workHistoryEntries
                  : [primaryWorkHistory]
                ).map((entry, entryIndex) => (
                  <div
                    key={`saved-work-entry-${entryIndex}`}
                    className="rounded-[1.2rem] bg-white px-3 py-3 ring-1 ring-slate-100"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h5 className="text-sm font-semibold text-slate-950">
                        {entryIndex === 0
                          ? "Most recent work entry"
                          : `Additional work entry ${entryIndex + 1}`}
                      </h5>
                      <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                        {entryIndex + 1}
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {workHistoryFields.map((field) => (
                        <QuestionnaireField
                          key={`${entryIndex}-${field.key}`}
                          label={field.label}
                          detail={field.detail}
                          value={entry[field.key]}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-100">
                  {workHistoryEntries.length > 1
                    ? `${workHistoryEntries.length} work entries`
                    : "Single work entry"}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${
                    workAnswers.workHistoryComplete === "Yes"
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                      : "bg-white text-slate-500 ring-slate-100"
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {workAnswers.workHistoryComplete === "Yes"
                    ? "Work history complete"
                    : "Work history not marked complete"}
                </span>
              </div>
            </section>
          ) : (
            <section className="rounded-[1.35rem] bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
              No detailed work-history entries are required because the
              applicant answered No.
            </section>
          )}
        </div>
      );
    }

    if (activeApplicantView === "Education") {
      const hasAnyEducation =
        educationAnswers.hasEducation ||
        (educationHistoryEntries.length ? "Yes" : "");
      const shouldShowEducationDetails = hasAnyEducation === "Yes";

      if (!educationHistoryEntries.length && !educationAnswers.hasEducation) {
        return (
          <div className="space-y-4">
            <section className="rounded-[1.35rem] bg-[linear-gradient(135deg,#f8fafc,#eef2f7)] px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Client Information Form
              </p>
              <h4 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">
                1.0 Education History
              </h4>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                Record secondary and post-secondary education, including
                university, college and apprenticeship training.
              </p>
            </section>

            <div className="flex min-h-[220px] items-center justify-center rounded-[1.35rem] bg-slate-50 px-5 py-8 text-center">
              <div>
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
                  <Plus className="h-4 w-4" />
                </div>
                <h4 className="mt-3 text-sm font-semibold text-slate-950">
                  No education history added yet
                </h4>
                <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                  Start with the most recent education record. You can save
                  partial information.
                </p>
                <button
                  type="button"
                  onClick={() => setEducationHistoryOverlayOpen(true)}
                  className="mt-4 inline-flex items-center justify-center rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Add Education History
                </button>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="space-y-4">
          <section className="rounded-[1.35rem] bg-[linear-gradient(135deg,#f8fafc,#eef2f7)] px-4 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Client Information Form
                </p>
                <h4 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">
                  1.0 Education History
                </h4>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                  Partial details are saved here and can be completed later.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEducationHistoryOverlayOpen(true)}
                className="inline-flex w-fit items-center justify-center rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                {educationHistoryEntries.length
                  ? "Edit Education History"
                  : "Add Education History"}
              </button>
            </div>
          </section>

          <div className="grid gap-3 md:grid-cols-3">
            <DetailField
              label="Highest education"
              value={profileAnswers.highestEducation}
            />
            <DetailField
              label="Canadian education"
              value={profileAnswers.educationInCanada}
            />
            <DetailField
              label="Education points"
              value={breakdown.coreHumanCapital?.education}
            />
          </div>

          <section className="rounded-[1.35rem] bg-slate-50 px-4 py-4">
            <QuestionnaireField
              label="1. Do you have any secondary and/or post-secondary education?"
              value={hasAnyEducation}
            />
          </section>

          {shouldShowEducationDetails ? (
            <>
              <section className="rounded-[1.35rem] bg-slate-50 px-4 py-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      1.1 Education Details
                    </p>
                    <h4 className="mt-2 text-base font-semibold text-slate-950">
                      Saved education entries
                    </h4>
                  </div>
                  <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-100">
                    {educationHistoryEntries.length
                      ? `${educationHistoryEntries.length} saved`
                      : "No saved entries"}
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {(educationHistoryEntries.length
                    ? educationHistoryEntries
                    : [blankEducationHistoryEntry]
                  ).map((entry, entryIndex) => (
                    <div
                      key={`saved-education-entry-${entryIndex}`}
                      className="rounded-[1.2rem] bg-white px-3 py-3 ring-1 ring-slate-100"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h5 className="text-sm font-semibold text-slate-950">
                          {entryIndex === 0
                            ? "Most recent education"
                            : `Additional education ${entryIndex + 1}`}
                        </h5>
                        <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                          {entryIndex + 1}
                        </span>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {educationHistoryFields.map((field) => (
                          <QuestionnaireField
                            key={`${entryIndex}-${field.key}`}
                            label={field.label}
                            detail={field.detail}
                            value={entry[field.key]}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[1.35rem] bg-slate-50 px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  1.2 Years Completed
                </p>
                <h4 className="mt-2 text-base font-semibold text-slate-950">
                  Education years summary
                </h4>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {educationYearFields.map((field) => (
                    <QuestionnaireField
                      key={field.key}
                      label={field.label}
                      detail={field.detail}
                      value={educationYearSummary[field.key]}
                    />
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-100">
                    {educationHistoryEntries.length > 1
                      ? `${educationHistoryEntries.length} education entries`
                      : "Single education entry"}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${
                      educationAnswers.educationHistoryComplete === "Yes"
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                        : "bg-white text-slate-500 ring-slate-100"
                    }`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {educationAnswers.educationHistoryComplete === "Yes"
                      ? "Education history complete"
                      : "Education history not marked complete"}
                  </span>
                </div>
              </section>
            </>
          ) : (
            <section className="rounded-[1.35rem] bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
              No detailed education-history entries are required because the
              applicant answered No.
            </section>
          )}
        </div>
      );
    }

    if (activeApplicantView === "Language Tests") {
      const firstLanguageClbs =
        breakdown.languageAbilities?.firstOfficialLanguage || [];
      const secondLanguageClbs =
        breakdown.languageAbilities?.secondOfficialLanguage || [];

      if (
        !languageExamEntries.length &&
        !languageExamAnswers.languageExamsComplete
      ) {
        return (
          <div className="space-y-4">
            <section className="rounded-[1.35rem] bg-[linear-gradient(135deg,#f8fafc,#eef2f7)] px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Client Information Form
              </p>
              <h4 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">
                1.0 Language Exams
              </h4>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                Record IELTS, CELPIP, PTE Core, TEF, or TCF scores for CRS and
                application review.
              </p>
            </section>

            <div className="flex min-h-[220px] items-center justify-center rounded-[1.35rem] bg-slate-50 px-5 py-8 text-center">
              <div>
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
                  <Plus className="h-4 w-4" />
                </div>
                <h4 className="mt-3 text-sm font-semibold text-slate-950">
                  No language exams added yet
                </h4>
                <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                  Add the most recent valid language exam. You can save partial
                  information.
                </p>
                <button
                  type="button"
                  onClick={() => setLanguageExamsOverlayOpen(true)}
                  className="mt-4 inline-flex items-center justify-center rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Add Language Exams
                </button>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="space-y-4">
          <section className="rounded-[1.35rem] bg-[linear-gradient(135deg,#f8fafc,#eef2f7)] px-4 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Client Information Form
                </p>
                <h4 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">
                  1.0 Language Exams
                </h4>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                  Valid exam scores are saved here and can feed the CRS language
                  calculation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLanguageExamsOverlayOpen(true)}
                className="inline-flex w-fit items-center justify-center rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                {languageExamEntries.length
                  ? "Edit Language Exams"
                  : "Add Language Exams"}
              </button>
            </div>
          </section>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <DetailField
              label="First language test"
              value={languageAnswers.firstLanguageTest}
            />
            <DetailField
              label="First language points"
              value={breakdown.coreHumanCapital?.firstLanguage}
            />
            <DetailField
              label="Second language test"
              value={languageAnswers.secondLanguageTest}
            />
            <DetailField
              label="Second language points"
              value={breakdown.coreHumanCapital?.secondLanguage}
            />
          </div>

          {languageExamEntries.length ? (
            <section className="rounded-[1.35rem] bg-slate-50 px-4 py-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    1.1 Exam Details
                  </p>
                  <h4 className="mt-2 text-base font-semibold text-slate-950">
                    Saved language exams
                  </h4>
                </div>
                <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-100">
                  {languageExamEntries.length} saved
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {languageExamEntries.map((entry, entryIndex) => (
                  <div
                    key={`saved-language-exam-${entryIndex}`}
                    className="rounded-[1.2rem] bg-white px-3 py-3 ring-1 ring-slate-100"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h5 className="text-sm font-semibold text-slate-950">
                        {entry.officialLanguagePriority ||
                          `Language exam ${entryIndex + 1}`}
                      </h5>
                      <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                        {entry.testType || "Test not set"}
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {languageExamDetailFields.map((field) => (
                        <QuestionnaireField
                          key={`${entryIndex}-${field.key}`}
                          label={field.label}
                          detail={field.detail}
                          value={entry[field.key]}
                        />
                      ))}
                    </div>
                    <div className="mt-3 rounded-[1.05rem] bg-slate-50 px-3 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        1.2{" "}
                        {entry.testType
                          ? `${entry.testType} Scores`
                          : "Language Scores"}
                      </p>
                      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        {languageExamScoreFields.map((field) => (
                          <QuestionnaireField
                            key={`${entryIndex}-${field.key}`}
                            label={field.label}
                            value={entry[field.key]}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-100">
                  {languageExamEntries.length > 1
                    ? `${languageExamEntries.length} language exams`
                    : "Single language exam"}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${
                    languageExamAnswers.languageExamsComplete === "Yes"
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                      : "bg-white text-slate-500 ring-slate-100"
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {languageExamAnswers.languageExamsComplete === "Yes"
                    ? "Language exams complete"
                    : "Language exams not marked complete"}
                </span>
              </div>
            </section>
          ) : (
            <section className="rounded-[1.35rem] bg-slate-50 px-4 py-4 text-sm text-slate-500">
              No language exam entries are saved.
            </section>
          )}

          <section className="rounded-[1.2rem] bg-slate-50 px-3 py-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              First language scores
            </h4>
            <div className="mt-3">
              {renderLanguageAbilityGrid("firstLanguage", firstLanguageClbs)}
            </div>
          </section>
          {languageAnswers.secondLanguageTest &&
          languageAnswers.secondLanguageTest !== "Not applicable" ? (
            <section className="rounded-[1.2rem] bg-slate-50 px-3 py-3">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Second language scores
              </h4>
              <div className="mt-3">
                {renderLanguageAbilityGrid(
                  "secondLanguage",
                  secondLanguageClbs,
                )}
              </div>
            </section>
          ) : null}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <DetailField label="Full name" value={client.fullName} />
          <DetailField label="Email" value={client.email} />
          <DetailField label="Mobile no." value={client.phone} />
          <DetailField
            label="Date of birth"
            value={formatDate(client.dateOfBirth)}
          />
          <DetailField label="Client status" value={client.status} />
          <DetailField
            label="Assigned staff"
            value={caseItem.assignedUser?.fullName || "Unassigned"}
          />
          <DetailField label="Case type" value={caseItem.caseType} />
          <DetailField
            label="Case stage"
            value={caseItem.stage || caseItem.status}
          />
          <DetailField
            label="Next action"
            value={caseItem.nextAction || "No action set"}
          />
        </div>
        <ProfileQuestionnaireSection
          sectionId="applicantIdentity"
          initialData={
            assessmentForm.profileQuestionnaires?.applicantIdentity || {}
          }
          saving={savingProfileQuestionnaire}
          error={profileQuestionnaireError}
          onSave={(values) =>
            onSaveProfileQuestionnaire("applicantIdentity", values)
          }
        />
      </div>
    );
  }

  function renderSpouseDetailContent() {
    const spouseIsScored = hasScoredSpouseForProfile();
    const spouseLanguageClbs =
      breakdown.languageAbilities?.spouseFirstOfficialLanguage || [];
    const spouseHeaderCopy = spouseIsScored
      ? "Spouse factors are included in the CRS estimate when the spouse accompanies the applicant."
      : "Spouse factor scoring is inactive unless the spouse is accompanying and is not a Canadian citizen or permanent resident.";

    if (activeSpouseView === "Work") {
      return (
        <div className="space-y-4">
          <section className="rounded-[1.35rem] bg-[linear-gradient(135deg,#f8fafc,#eef2f7)] px-4 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Spouse details
                </p>
                <h4 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">
                  Work
                </h4>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                  {spouseHeaderCopy}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSpouseWorkOverlayOpen(true)}
                className="inline-flex w-fit shrink-0 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
              >
                {spouseWorkEntries.length ? "Edit Work" : "Add Work"}
              </button>
            </div>
          </section>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <DetailField
              label="Marital status"
              value={profileAnswers.maritalStatus}
            />
            <DetailField
              label="Spouse accompanying"
              value={profileAnswers.spouseAccompany}
            />
            <DetailField
              label="Spouse work points"
              value={breakdown.spouseFactors?.canadianExperience}
            />
            <DetailField
              label="Saved work records"
              value={spouseWorkEntries.length}
            />
          </div>

          <section className="rounded-[1.35rem] bg-slate-50 px-4 py-4">
            <div className="grid gap-3 md:grid-cols-2">
              <QuestionnaireField
                label="Skilled work experience in Canada in the last 10 years"
                value={spouseAnswers.spouseCanadianWorkYears}
              />
              <QuestionnaireField
                label="Citizen or permanent resident of Canada?"
                value={profileAnswers.spouseCanadianCitizenPr}
              />
            </div>
          </section>
        </div>
      );
    }

    if (activeSpouseView === "Education") {
      return (
        <div className="space-y-4">
          <section className="rounded-[1.35rem] bg-[linear-gradient(135deg,#f8fafc,#eef2f7)] px-4 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Spouse details
                </p>
                <h4 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">
                  Education
                </h4>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                  {spouseHeaderCopy}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSpouseEducationOverlayOpen(true)}
                className="inline-flex w-fit shrink-0 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
              >
                {spouseEducationEntries.length
                  ? "Edit Education"
                  : "Add Education"}
              </button>
            </div>
          </section>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <DetailField
              label="Spouse education"
              value={spouseAnswers.spouseEducation}
            />
            <DetailField
              label="Spouse education points"
              value={breakdown.spouseFactors?.education}
            />
            <DetailField
              label="Total spouse factors"
              value={breakdown.spouseFactors?.total}
            />
            <DetailField
              label="Saved education records"
              value={spouseEducationEntries.length}
            />
          </div>

          <section className="rounded-[1.35rem] bg-slate-50 px-4 py-4">
            <QuestionnaireField
              label="Highest education for spouse/common-law partner"
              value={spouseAnswers.spouseEducation}
            />
          </section>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <section className="rounded-[1.35rem] bg-[linear-gradient(135deg,#f8fafc,#eef2f7)] px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Spouse details
              </p>
              <h4 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">
                Language Tests
              </h4>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                {spouseHeaderCopy}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSpouseLanguageOverlayOpen(true)}
              className="inline-flex w-fit shrink-0 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
            >
              {spouseLanguageEntries.length ? "Edit Tests" : "Add Tests"}
            </button>
          </div>
        </section>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DetailField
            label="Spouse language test"
            value={spouseAnswers.spouseLanguageTest}
          />
          <DetailField
            label="Spouse language points"
            value={breakdown.spouseFactors?.firstLanguage}
          />
          <DetailField
            label="Total spouse factors"
            value={breakdown.spouseFactors?.total}
          />
          <DetailField
            label="Saved language tests"
            value={spouseLanguageEntries.length}
          />
        </div>

        {spouseAnswers.spouseLanguageTest &&
        spouseAnswers.spouseLanguageTest !== "Not applicable" ? (
          <section className="rounded-[1.2rem] bg-slate-50 px-3 py-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Spouse first official language scores
            </h4>
            <div className="mt-3">
              {renderSpouseLanguageAbilityGrid(spouseLanguageClbs)}
            </div>
          </section>
        ) : (
          <section className="rounded-[1.35rem] bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No spouse language test has been recorded yet.
          </section>
        )}
      </div>
    );
  }

  function renderDetailContent() {
    if (activeDetailTab === "APPLICANT DETAILS") {
      return (
        <AnimatePresence mode="wait">
          <motion.div
            key={activeApplicantView}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            {renderApplicantDetailContent()}
          </motion.div>
        </AnimatePresence>
      );
    }

    if (activeDetailTab === "SPOUSE DETAILS") {
      return (
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSpouseView}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            {renderSpouseDetailContent()}
          </motion.div>
        </AnimatePresence>
      );
    }

    if (activeDetailTab === "ACTIVITY HISTORY") {
      return (
        <RepeatableProfileQuestionnaire
          kind="activity"
          initialData={assessmentForm.activityHistory || {}}
          saving={savingActivityHistory}
          error={activityHistoryError}
          onSave={onSaveActivityHistory}
        />
      );
    }

    if (activeDetailTab === "ADDRESS HISTORY") {
      return (
        <RepeatableProfileQuestionnaire
          kind="address"
          initialData={assessmentForm.addressHistory || {}}
          saving={savingAddressHistory}
          error={addressHistoryError}
          onSave={onSaveAddressHistory}
        />
      );
    }

    if (activeDetailTab === "TRAVEL HISTORY")
      return (
        <RepeatableProfileQuestionnaire
          kind="travel"
          initialData={assessmentForm.travelHistory || {}}
          saving={savingTravelHistory}
          error={travelHistoryError}
          onSave={onSaveTravelHistory}
        />
      );

    if (activeDetailTab === "SIBLING DETAILS")
      return (
        <RepeatableProfileQuestionnaire
          kind="siblings"
          initialData={assessmentForm.siblings || {}}
          saving={savingSiblings}
          error={siblingsError}
          onSave={onSaveSiblings}
        />
      );

    if (activeDetailTab === "PARENT DETAILS")
      return (
        <ParentsProfileQuestionnaire
          initialData={assessmentForm.parents || {}}
          saving={savingParents}
          error={parentsError}
          onSave={onSaveParents}
        />
      );

    if (activeDetailTab === "CHILDREN")
      return (
        <RepeatableProfileQuestionnaire
          kind="dependants"
          initialData={assessmentForm.dependantsAndChildren || {}}
          saving={savingDependants}
          error={dependantsError}
          onSave={onSaveDependants}
        />
      );

    if (activeDetailTab === "IDENTITY & PERMITS")
      return (
        <RepeatableProfileQuestionnaire
          kind="identity"
          initialData={assessmentForm.identityPermits || {}}
          saving={savingIdentityPermits}
          error={identityPermitsError}
          onSave={onSaveIdentityPermits}
        />
      );

    const profileSectionByTab = {
      "CANADIAN STATUS": "canadianStatus",
      "BACKGROUND & ADMISSIBILITY": "background",
      "RELATIONSHIP & SPONSORSHIP": "sponsorship",
      "PROGRAM DETAILS": "programDetails",
      "HUMANITARIAN & CITIZENSHIP": "humanitarianCitizenship",
      REHABILITATION: "rehabilitation",
      "REFUGEE & PROTECTION": "refugeeProtection",
    };
    const profileSectionId = profileSectionByTab[activeDetailTab];
    if (profileSectionId)
      return (
        <ProfileQuestionnaireSection
          sectionId={profileSectionId}
          initialData={
            assessmentForm.profileQuestionnaires?.[profileSectionId] || {}
          }
          saving={savingProfileQuestionnaire}
          error={profileQuestionnaireError}
          onSave={(values) =>
            onSaveProfileQuestionnaire(profileSectionId, values)
          }
        />
      );

    const emptyCopy = {
      CHILDREN:
        "No children recorded yet. Add dependants once family composition is collected.",
      "SIBLING DETAILS": "No sibling details recorded yet.",
      "PARENT DETAILS": "No parent details recorded yet.",
      "TRAVEL HISTORY":
        "No travel history recorded yet. This will support application background and eligibility review.",
    };

    return (
      <EmptyProfileDetail
        title={activeDetailTab}
        description={emptyCopy[activeDetailTab] || "No details recorded yet."}
      />
    );
  }

  return (
    <section className="overflow-hidden rounded-[1.45rem] border border-slate-100 bg-white">
      {spouseWorkOverlayOpen ? (
        <WorkHistoryOverlay
          initialEntries={spouseWorkEntries}
          initialMeta={{
            hasWorkExperience: spouseAnswers.hasWorkExperience,
            moreWorkHistory: spouseAnswers.moreWorkHistory,
            workHistoryComplete: spouseAnswers.workHistoryComplete,
          }}
          saving={savingSpouseDetails}
          error={spouseDetailsError}
          onClose={() => setSpouseWorkOverlayOpen(false)}
          onSave={async (payload) => {
            await onSaveSpouseDetails("work", payload);
            setSpouseWorkOverlayOpen(false);
          }}
        />
      ) : null}
      {spouseEducationOverlayOpen ? (
        <EducationHistoryOverlay
          initialEntries={spouseEducationEntries}
          initialMeta={{
            hasEducation: spouseAnswers.hasEducation,
            moreEducation: spouseAnswers.moreEducation,
            educationHistoryComplete: spouseAnswers.educationHistoryComplete,
          }}
          initialYearSummary={spouseEducationYearSummary}
          saving={savingSpouseDetails}
          error={spouseDetailsError}
          onClose={() => setSpouseEducationOverlayOpen(false)}
          onSave={async (payload) => {
            await onSaveSpouseDetails("education", payload);
            setSpouseEducationOverlayOpen(false);
          }}
        />
      ) : null}
      {spouseLanguageOverlayOpen ? (
        <LanguageExamsOverlay
          initialEntries={spouseLanguageEntries}
          initialMeta={{
            moreLanguageExams: spouseAnswers.moreLanguageExams,
            languageExamsComplete: spouseAnswers.languageExamsComplete,
          }}
          saving={savingSpouseDetails}
          error={spouseDetailsError}
          onClose={() => setSpouseLanguageOverlayOpen(false)}
          onSave={async (payload) => {
            await onSaveSpouseDetails("language", payload);
            setSpouseLanguageOverlayOpen(false);
          }}
        />
      ) : null}
      {workHistoryOverlayOpen ? (
        <WorkHistoryOverlay
          initialEntry={primaryWorkHistory}
          initialEntries={workHistoryEntries}
          initialMeta={{
            hasWorkExperience: workAnswers.hasWorkExperience,
            moreWorkHistory: workAnswers.moreWorkHistory,
            workHistoryComplete: workAnswers.workHistoryComplete,
          }}
          saving={savingWorkHistory}
          error={workHistoryError}
          onClose={() => setWorkHistoryOverlayOpen(false)}
          onSave={async (payload) => {
            try {
              await onSaveWorkHistory(payload);
              setWorkHistoryOverlayOpen(false);
            } catch {
              // Keep the overlay open so the inline error remains visible.
            }
          }}
        />
      ) : null}

      {educationHistoryOverlayOpen ? (
        <EducationHistoryOverlay
          initialEntries={educationHistoryEntries}
          initialYearSummary={educationYearSummary}
          initialMeta={{
            hasEducation: educationAnswers.hasEducation,
            moreEducation: educationAnswers.moreEducation,
            educationHistoryComplete: educationAnswers.educationHistoryComplete,
          }}
          saving={savingEducationHistory}
          error={educationHistoryError}
          onClose={() => setEducationHistoryOverlayOpen(false)}
          onSave={async (payload) => {
            try {
              await onSaveEducationHistory(payload);
              setEducationHistoryOverlayOpen(false);
            } catch {
              // Keep the overlay open so the inline error remains visible.
            }
          }}
        />
      ) : null}

      {languageExamsOverlayOpen ? (
        <LanguageExamsOverlay
          initialEntries={languageExamEntries}
          initialMeta={{
            languageExamsComplete: languageExamAnswers.languageExamsComplete,
          }}
          saving={savingLanguageExams}
          error={languageExamsError}
          onClose={() => setLanguageExamsOverlayOpen(false)}
          onSave={async (payload) => {
            try {
              await onSaveLanguageExams(payload);
              setLanguageExamsOverlayOpen(false);
            } catch {
              // Keep the overlay open so the inline error remains visible.
            }
          }}
        />
      ) : null}

      <div className="grid min-h-[360px] lg:grid-cols-[320px_1fr]">
        <aside className="border-b border-slate-100 bg-slate-50/80 p-2 lg:border-b-0 lg:border-r">
          <div className="scrollbar-hidden flex gap-1 overflow-x-auto lg:block lg:space-y-1 lg:overflow-visible">
            {profileDetailTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeDetailTab === tab.label;
              const isApplicantTab = tab.label === "APPLICANT DETAILS";
              const isSpouseTab = tab.label === "SPOUSE DETAILS";
              const isApplicantMenuOpen =
                isApplicantTab && isActive && applicantMenuOpen;
              const isSpouseMenuOpen =
                isSpouseTab && isActive && spouseMenuOpen;

              return (
                <div key={tab.label} className="min-w-max lg:min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (isApplicantTab) {
                        if (isActive) {
                          setApplicantMenuOpen((isOpen) => !isOpen);
                        } else {
                          setActiveDetailTab(tab.label);
                          setApplicantMenuOpen(true);
                          setSpouseMenuOpen(false);
                        }
                        return;
                      }

                      if (isSpouseTab) {
                        if (isActive) {
                          setSpouseMenuOpen((isOpen) => !isOpen);
                        } else {
                          setActiveDetailTab(tab.label);
                          setSpouseMenuOpen(true);
                          setApplicantMenuOpen(false);
                        }
                        return;
                      }

                      setActiveDetailTab(tab.label);
                      setApplicantMenuOpen(false);
                      setSpouseMenuOpen(false);
                    }}
                    className={`flex min-w-max items-center gap-2 rounded-[1rem] px-3 py-2.5 text-left text-xs font-semibold tracking-[0.06em] transition lg:w-full lg:min-w-0 ${
                      isActive
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-slate-500 hover:bg-white/70 hover:text-slate-800"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 whitespace-nowrap">
                      {tab.label}
                    </span>
                    {isApplicantTab || isSpouseTab ? (
                      <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 transition ${
                          isApplicantMenuOpen || isSpouseMenuOpen
                            ? "rotate-180 text-slate-700"
                            : "text-slate-400"
                        }`}
                      />
                    ) : null}
                  </button>

                  {isApplicantTab ? (
                    <AnimatePresence initial={false}>
                      {isApplicantMenuOpen ? (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{
                            duration: 0.18,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                          className="overflow-hidden"
                        >
                          <div className="ml-3 mt-1 space-y-1 border-l border-slate-200 pl-2">
                            {applicantDetailViews.map((view) => {
                              const isViewActive = activeApplicantView === view;

                              return (
                                <button
                                  key={view}
                                  type="button"
                                  onClick={() => {
                                    setActiveDetailTab("APPLICANT DETAILS");
                                    setActiveApplicantView(view);
                                    setApplicantMenuOpen(true);
                                  }}
                                  className={`flex w-full items-center rounded-[0.85rem] px-3 py-2 text-left text-xs font-semibold transition ${
                                    isViewActive
                                      ? "bg-slate-950 text-white shadow-sm"
                                      : "text-slate-500 hover:bg-white hover:text-slate-900"
                                  }`}
                                >
                                  {view}
                                </button>
                              );
                            })}
                          </div>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  ) : null}

                  {isSpouseTab ? (
                    <AnimatePresence initial={false}>
                      {isSpouseMenuOpen ? (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{
                            duration: 0.18,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                          className="overflow-hidden"
                        >
                          <div className="ml-3 mt-1 space-y-1 border-l border-slate-200 pl-2">
                            {spouseDetailViews.map((view) => {
                              const isViewActive = activeSpouseView === view;

                              return (
                                <button
                                  key={view}
                                  type="button"
                                  onClick={() => {
                                    setActiveDetailTab("SPOUSE DETAILS");
                                    setActiveSpouseView(view);
                                    setSpouseMenuOpen(true);
                                  }}
                                  className={`flex w-full items-center rounded-[0.85rem] px-3 py-2 text-left text-xs font-semibold transition ${
                                    isViewActive
                                      ? "bg-slate-950 text-white shadow-sm"
                                      : "text-slate-500 hover:bg-white hover:text-slate-900"
                                  }`}
                                >
                                  {view}
                                </button>
                              );
                            })}
                          </div>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  ) : null}
                </div>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0 p-4">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-white">
              <ActiveIcon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Profile details
              </p>
              <h3 className="text-base font-semibold text-slate-950">
                {detailHeading}
              </h3>
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeDetailTab}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              {renderDetailContent()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </section>
  );
}

function CaseWorkspacePanel({
  activeTab,
  caseItem,
  documents,
  followUps,
  notes,
  activityLogs,
  workflowSteps,
  paymentSummary,
  outstandingDocuments,
  assessment,
  onConductAssessment,
  onCreateReminder,
  savingReminder,
  reminderError,
  onAssignQuestionnaire,
  onUpdateQuestionnaire,
  savingQuestionnaire,
  questionnaireError,
  onCreateCaseDocuments,
  onMarkCaseDocumentReceived,
  onUpdateCaseDocumentAssignment,
  onUploadMyCaseDocument,
  onRefreshCaseDocuments,
  onDeleteCaseDocument,
  onFinalizeCaseDocument,
  onChangeCaseDocumentStatus,
  savingCaseDocuments,
  caseDocumentsError,
  onOpenProfile,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  profileSectionRequest,
  onSaveProfileQuestionnaire,
  savingProfileQuestionnaire,
  profileQuestionnaireError,
  onSaveWorkHistory,
  savingWorkHistory,
  workHistoryError,
  onSaveEducationHistory,
  savingEducationHistory,
  educationHistoryError,
  onSaveLanguageExams,
  savingLanguageExams,
  languageExamsError,
  onSaveDependants,
  savingDependants,
  dependantsError,
  onSaveSiblings,
  savingSiblings,
  siblingsError,
  onSaveParents,
  savingParents,
  parentsError,
  onSaveActivityHistory,
  savingActivityHistory,
  activityHistoryError,
  onSaveAddressHistory,
  savingAddressHistory,
  addressHistoryError,
  onSaveTravelHistory,
  savingTravelHistory,
  travelHistoryError,
  onSaveIdentityPermits,
  savingIdentityPermits,
  identityPermitsError,
  onSaveSpouseDetails,
  savingSpouseDetails,
  spouseDetailsError,
}) {
  const activeWorkflowSteps = workflowSteps.filter(
    (step) => step.isActive !== false,
  );
  const receivedDocuments = documents.filter((document) =>
    Boolean(document.storageKey),
  );
  if (activeTab === "PROFILE") {
    return (
      <div className="space-y-4">
        <EvaluationScorecards
          clientName={caseItem.client?.fullName}
          assessment={assessment}
          onConductAssessment={onConductAssessment}
        />
        <ProfileDetailsGrid
          caseItem={caseItem}
          activityLogs={activityLogs}
          assessment={assessment}
          profileSectionRequest={profileSectionRequest}
          onSaveProfileQuestionnaire={onSaveProfileQuestionnaire}
          savingProfileQuestionnaire={savingProfileQuestionnaire}
          profileQuestionnaireError={profileQuestionnaireError}
          onSaveWorkHistory={onSaveWorkHistory}
          savingWorkHistory={savingWorkHistory}
          workHistoryError={workHistoryError}
          onSaveEducationHistory={onSaveEducationHistory}
          savingEducationHistory={savingEducationHistory}
          educationHistoryError={educationHistoryError}
          onSaveLanguageExams={onSaveLanguageExams}
          savingLanguageExams={savingLanguageExams}
          languageExamsError={languageExamsError}
          onSaveDependants={onSaveDependants}
          savingDependants={savingDependants}
          dependantsError={dependantsError}
          onSaveSiblings={onSaveSiblings}
          savingSiblings={savingSiblings}
          siblingsError={siblingsError}
          onSaveParents={onSaveParents}
          savingParents={savingParents}
          parentsError={parentsError}
          onSaveActivityHistory={onSaveActivityHistory}
          savingActivityHistory={savingActivityHistory}
          activityHistoryError={activityHistoryError}
          onSaveAddressHistory={onSaveAddressHistory}
          savingAddressHistory={savingAddressHistory}
          addressHistoryError={addressHistoryError}
          onSaveTravelHistory={onSaveTravelHistory}
          savingTravelHistory={savingTravelHistory}
          travelHistoryError={travelHistoryError}
          onSaveIdentityPermits={onSaveIdentityPermits}
          savingIdentityPermits={savingIdentityPermits}
          identityPermitsError={identityPermitsError}
          onSaveSpouseDetails={onSaveSpouseDetails}
          savingSpouseDetails={savingSpouseDetails}
          spouseDetailsError={spouseDetailsError}
        />
      </div>
    );
  }

  if (activeTab === "REMINDERS") {
    return (
      <RemindersWorkspace
        reminders={followUps}
        saving={savingReminder}
        error={reminderError}
        onCreate={onCreateReminder}
      />
    );
  }

  if (activeTab === "QUESTIONNAIRES") {
    return (
      <QuestionnaireCatalog
        assignments={assessment?.formData?.questionnaireAssignments || []}
        profileData={assessment?.formData || {}}
        applicant={caseItem.client || {}}
        saving={savingQuestionnaire}
        error={questionnaireError}
        onAssign={onAssignQuestionnaire}
        onUpdate={onUpdateQuestionnaire}
        onOpenProfile={onOpenProfile}
      />
    );
  }

  if (activeTab === "DOCUMENTS") {
    return (
      <DocumentsWorkspace
        caseId={caseItem.id}
        caseType={caseItem.caseType}
        documents={documents}
        assignments={assessment?.formData?.questionnaireAssignments || []}
        saving={savingCaseDocuments}
        error={caseDocumentsError}
        onCreateDocuments={onCreateCaseDocuments}
        onMarkReceived={onMarkCaseDocumentReceived}
        onUpdateAssignment={onUpdateCaseDocumentAssignment}
        onUploadMyDocument={onUploadMyCaseDocument}
        onRefreshDocuments={onRefreshCaseDocuments}
        onDeleteDocument={onDeleteCaseDocument}
        onChangeDocumentStatus={onChangeCaseDocumentStatus}
      />
    );
  }

  if (activeTab === "FORMS") {
    return (
      <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <div className="flex items-center justify-between border-b border-slate-100 bg-white/90 px-5 py-4 backdrop-blur-xl">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-600">
              Application package
            </p>
            <h2 className="mt-1 text-base font-semibold tracking-tight text-slate-950">
              Case Forms
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Assign, import, complete, and review official or
              consultant-created forms.
            </p>
          </div>
        </div>
        <CaseFormsWorkspace
          caseId={caseItem.id}
          caseItem={caseItem}
          assessment={assessment}
          onOpenProfileSection={onOpenProfile}
        />
      </div>
    );
  }

  if (activeTab === "TASKS") {
    return (
      <TasksWorkspace
        tasks={activeWorkflowSteps.filter((step) => step.isStandaloneTask)}
        caseItem={caseItem}
        onCreate={onCreateTask}
        onUpdate={onUpdateTask}
        onDelete={onDeleteTask}
      />
    );
  }

  if (activeTab === "COMMUNICATION") {
    return (
      <Suspense
        fallback={
          <div className="space-y-3">
            {Array.from({ length: 5 }, (_, index) => (
              <div
                key={index}
                className="h-20 animate-pulse rounded-2xl bg-slate-100"
              />
            ))}
          </div>
        }
      >
        <CommunicationWorkspace caseItem={caseItem} />
      </Suspense>
    );
  }

  if (activeTab === "BILLING") {
    return (
      <div className="space-y-6">
        <div className="grid gap-3 md:grid-cols-4">
          <CompactMetric
            label="Total Fee"
            value={formatCurrency(paymentSummary.totalFee)}
          />
          <CompactMetric
            label="Paid"
            value={formatCurrency(paymentSummary.paidAmount)}
          />
          <CompactMetric
            label="Balance"
            value={formatCurrency(paymentSummary.balance)}
          />
          <div className="rounded-[1.15rem] bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Status
            </p>
            <span
              className={`mt-2 inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${getPaymentStatusStyles(paymentSummary.status)}`}
            >
              {paymentSummary.status}
            </span>
          </div>
        </div>
        <CaseBillingWorkspace caseItem={caseItem} />
      </div>
    );
  }

  if (activeTab === "AGREEMENTS & LETTERS") {
    return <AgreementsLettersWorkspace caseItem={caseItem} />;
  }

  if (activeTab === "APPOINTMENTS") {
    return <AppointmentsWorkspace caseItem={caseItem} />;
  }

  const placeholderCopy = {
    QUESTIONNAIRES:
      "Questionnaire builder and applicant answers will live here.",
  };

  return (
    <div className="flex min-h-[180px] items-center justify-center rounded-[1.5rem] bg-slate-50 px-5 py-8 text-center">
      <div>
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
          <FileText className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-slate-950">
          {activeTab}
        </h3>
        <p className="mt-2 max-w-md text-sm text-slate-500">
          {placeholderCopy[activeTab] ||
            "This workspace module will live here."}
        </p>
      </div>
    </div>
  );
}

export default function CaseWorkspaceTabs({
  caseItem,
  documents,
  followUps,
  notes,
  activityLogs,
  workflowSteps,
  paymentSummary,
  outstandingDocuments,
  assessment,
  onConductAssessment,
  onCreateReminder,
  savingReminder,
  reminderError,
  onAssignQuestionnaire,
  onUpdateQuestionnaire,
  savingQuestionnaire,
  questionnaireError,
  onCreateCaseDocuments,
  onMarkCaseDocumentReceived,
  onUpdateCaseDocumentAssignment,
  onUploadMyCaseDocument,
  onRefreshCaseDocuments,
  onDeleteCaseDocument,
  onFinalizeCaseDocument,
  onChangeCaseDocumentStatus,
  savingCaseDocuments,
  caseDocumentsError,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onSaveProfileQuestionnaire,
  savingProfileQuestionnaire,
  profileQuestionnaireError,
  onSaveWorkHistory,
  savingWorkHistory,
  workHistoryError,
  onSaveEducationHistory,
  savingEducationHistory,
  educationHistoryError,
  onSaveLanguageExams,
  savingLanguageExams,
  languageExamsError,
  onSaveDependants,
  savingDependants,
  dependantsError,
  onSaveSiblings,
  savingSiblings,
  siblingsError,
  onSaveParents,
  savingParents,
  parentsError,
  onSaveActivityHistory,
  savingActivityHistory,
  activityHistoryError,
  onSaveAddressHistory,
  savingAddressHistory,
  addressHistoryError,
  onSaveTravelHistory,
  savingTravelHistory,
  travelHistoryError,
  onSaveIdentityPermits,
  savingIdentityPermits,
  identityPermitsError,
  onSaveSpouseDetails,
  savingSpouseDetails,
  spouseDetailsError,
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() =>
    workspaceTabFromSlug(searchParams.get("tab")),
  );
  const [profileSectionRequest, setProfileSectionRequest] = useState(null);
  const workspaceContentRef = useRef(null);

  const selectWorkspaceTab = (tab) => {
    setActiveTab(tab);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (tab === caseWorkspaceTabs[0]) next.delete("tab");
        else next.set("tab", workspaceTabSlugs[tab]);
        return next;
      },
      { replace: true },
    );
  };

  const openProfileSection = (tab = "APPLICANT DETAILS", view = null) => {
    setProfileSectionRequest({ tab, view, requestId: Date.now() });
    selectWorkspaceTab("PROFILE");
  };

  useEffect(() => {
    const tabFromUrl = workspaceTabFromSlug(searchParams.get("tab"));
    if (tabFromUrl !== activeTab) setActiveTab(tabFromUrl);
  }, [searchParams]);

  useEffect(() => {
    workspaceContentRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [activeTab]);

  return (
    <article className="flex h-[calc(100dvh-7rem)] min-h-[36rem] max-h-[56rem] flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white/88 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="relative z-10 shrink-0 border-b border-slate-200/70 bg-slate-100/90 px-2 pt-2 shadow-[0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-xl">
        <div className="scrollbar-hidden flex gap-1 overflow-x-auto pb-0.5">
          {caseWorkspaceTabs.map((tab) => {
            const isActive = activeTab === tab;

            return (
              <button
                key={tab}
                type="button"
                onClick={() => selectWorkspaceTab(tab)}
                className={`relative min-w-max rounded-t-[1rem] px-4 py-2.5 text-[11px] font-semibold tracking-[0.08em] transition ${
                  isActive
                    ? "bg-white text-slate-950 shadow-[0_-1px_0_rgba(255,255,255,0.9),0_10px_28px_rgba(15,23,42,0.08)]"
                    : "text-slate-500 hover:bg-white/50 hover:text-slate-800"
                }`}
              >
                {tab}
                {isActive ? (
                  <span className="absolute inset-x-0 -bottom-1 h-1 bg-white" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div
        ref={workspaceContentRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white px-5 py-5 [scrollbar-gutter:stable]"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            className="min-h-full"
            initial={{ opacity: 0, y: 10, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.995 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <CaseWorkspacePanel
              activeTab={activeTab}
              caseItem={caseItem}
              profileSectionRequest={profileSectionRequest}
              documents={documents}
              followUps={followUps}
              notes={notes}
              activityLogs={activityLogs}
              workflowSteps={workflowSteps}
              paymentSummary={paymentSummary}
              outstandingDocuments={outstandingDocuments}
              assessment={assessment}
              onConductAssessment={onConductAssessment}
              onCreateReminder={onCreateReminder}
              savingReminder={savingReminder}
              reminderError={reminderError}
              onAssignQuestionnaire={onAssignQuestionnaire}
              onUpdateQuestionnaire={onUpdateQuestionnaire}
              savingQuestionnaire={savingQuestionnaire}
              questionnaireError={questionnaireError}
              onCreateCaseDocuments={onCreateCaseDocuments}
              onMarkCaseDocumentReceived={onMarkCaseDocumentReceived}
              onUpdateCaseDocumentAssignment={onUpdateCaseDocumentAssignment}
              onUploadMyCaseDocument={onUploadMyCaseDocument}
              onRefreshCaseDocuments={onRefreshCaseDocuments}
              onDeleteCaseDocument={onDeleteCaseDocument}
              onFinalizeCaseDocument={onFinalizeCaseDocument}
              onChangeCaseDocumentStatus={onChangeCaseDocumentStatus}
              savingCaseDocuments={savingCaseDocuments}
              caseDocumentsError={caseDocumentsError}
              onCreateTask={onCreateTask}
              onUpdateTask={onUpdateTask}
              onDeleteTask={onDeleteTask}
              onOpenProfile={openProfileSection}
              onSaveProfileQuestionnaire={onSaveProfileQuestionnaire}
              savingProfileQuestionnaire={savingProfileQuestionnaire}
              profileQuestionnaireError={profileQuestionnaireError}
              onSaveWorkHistory={onSaveWorkHistory}
              savingWorkHistory={savingWorkHistory}
              workHistoryError={workHistoryError}
              onSaveEducationHistory={onSaveEducationHistory}
              savingEducationHistory={savingEducationHistory}
              educationHistoryError={educationHistoryError}
              onSaveLanguageExams={onSaveLanguageExams}
              savingLanguageExams={savingLanguageExams}
              languageExamsError={languageExamsError}
              onSaveDependants={onSaveDependants}
              savingDependants={savingDependants}
              dependantsError={dependantsError}
              onSaveSiblings={onSaveSiblings}
              savingSiblings={savingSiblings}
              siblingsError={siblingsError}
              onSaveParents={onSaveParents}
              savingParents={savingParents}
              parentsError={parentsError}
              onSaveActivityHistory={onSaveActivityHistory}
              savingActivityHistory={savingActivityHistory}
              activityHistoryError={activityHistoryError}
              onSaveAddressHistory={onSaveAddressHistory}
              savingAddressHistory={savingAddressHistory}
              addressHistoryError={addressHistoryError}
              onSaveTravelHistory={onSaveTravelHistory}
              savingTravelHistory={savingTravelHistory}
              travelHistoryError={travelHistoryError}
              onSaveIdentityPermits={onSaveIdentityPermits}
              savingIdentityPermits={savingIdentityPermits}
              identityPermitsError={identityPermitsError}
              onSaveSpouseDetails={onSaveSpouseDetails}
              savingSpouseDetails={savingSpouseDetails}
              spouseDetailsError={spouseDetailsError}
            />
          </motion.div>
        </AnimatePresence>
      </div>
    </article>
  );
}
