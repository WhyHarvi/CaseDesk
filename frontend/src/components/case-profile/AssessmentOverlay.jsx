import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Award, BriefcaseBusiness, CheckCircle2, FileText, GraduationCap, Languages, Save, UsersRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { maritalStatusOptions } from "./applicantProfileOptions";

const assessmentSections = [
  {
    id: "profile",
    number: "1",
    title: "Profile & Education",
    icon: GraduationCap,
  },
  {
    id: "language",
    number: "2",
    title: "Language Tests",
    icon: Languages,
  },
  {
    id: "work",
    number: "3",
    title: "Work Experience",
    icon: BriefcaseBusiness,
  },
  {
    id: "additional",
    number: "4",
    title: "Additional Points",
    icon: Award,
  },
  {
    id: "spouse",
    number: "5",
    title: "Spouse Factors",
    icon: UsersRound,
  },
];

const yesNoOptions = ["", "Yes", "No"];
const ageOptions = ["", ...Array.from({ length: 49 }, (_, index) => String(index + 17)), "66 or older"];
const yearOptions = ["", "None or less than a year", "1 year", "2 years", "3 years", "4 years", "5 years or more"];
const foreignYearOptions = ["", "None or less than a year", "1 year", "2 years", "3 years or more"];
const educationLevelOptions = [
  "",
  "None, or less than secondary (high school)",
  "Secondary diploma (high school graduation)",
  "One-year program at a university, college, trade or technical school, or other institute",
  "Two-year program at a university, college, trade or technical school, or other institute",
  "Bachelor's degree OR a three or more year program",
  "Two or more certificates, diplomas or degrees. One must be for a program of three or more years",
  "Master's degree or professional degree",
  "Doctoral level university degree (PhD)",
];
const canadianEducationCredentialOptions = [
  "",
  "Secondary (high school) or less",
  "One- or two-year diploma or certificate",
  "Degree, diploma or certificate of three years or longer OR a Master's, professional or doctoral degree",
];
const languageTestOptions = ["", "CELPIP-G", "IELTS", "PTE Core", "TEF Canada", "TCF Canada"];
const secondLanguageTestOptions = [...languageTestOptions, "Not applicable"];
const jobOfferTeerOptions = [
  "",
  "NOC TEER 0 Major group 00",
  "NOC TEER 1, 2 or 3, or any TEER 0 other than Major group 00",
  "NOC TEER 4 or 5",
];
const languageAbilityNames = ["Speaking", "Listening", "Reading", "Writing"];
const firstLanguageFieldNames = languageAbilityNames.map((ability) => `firstLanguage${ability}Clb`);
const secondLanguageFieldNames = languageAbilityNames.map((ability) => `secondLanguage${ability}Clb`);
const spouseLanguageFieldNames = languageAbilityNames.map((ability) => `spouseLanguage${ability}Clb`);

function isYes(value) {
  return value === true || value === "Yes" || value === "yes";
}

function hasCurrentSpouse(profile = {}) {
  const normalized = String(profile.maritalStatus || "").toLowerCase();
  return normalized === "married" || normalized.includes("common-law");
}

function hasScoredSpouse(profile = {}) {
  return hasCurrentSpouse(profile) && isYes(profile.spouseAccompany) && !isYes(profile.spouseCanadianCitizenPr);
}

function hasLanguageTestResult(value) {
  return Boolean(value) && value !== "Not applicable";
}

function languageAbilityFields(prefix, labelPrefix, showIf) {
  return languageAbilityNames.map((ability) => ({
    name: `${prefix}${ability}Clb`,
    label: `${labelPrefix} - ${ability} test score`,
    help: "Enter the raw score from the test result. CaseDesk converts it to CLB/NCLC for CRS.",
    type: "number",
    step: "0.5",
    min: "0",
    inputMode: "decimal",
    showIf,
  }));
}

const profileGroups = [
  {
    title: "1. Profile",
    fields: [
      { name: "maritalStatus", label: "1. What is your marital status?", type: "select", options: maritalStatusOptions },
      { name: "spouseCanadianCitizenPr", label: "2.i Is your spouse or common-law partner a citizen or permanent resident of Canada?", type: "select", options: yesNoOptions, showIf: ({ profile }) => hasCurrentSpouse(profile) },
      { name: "spouseAccompany", label: "2.ii Will your spouse or common-law partner come with you to Canada?", type: "select", options: yesNoOptions, showIf: ({ profile }) => hasCurrentSpouse(profile) && !isYes(profile.spouseCanadianCitizenPr) },
      { name: "age", label: "3. How old are you?", help: "Use current age, or age on invitation date if the applicant has already been invited.", type: "select", options: ageOptions },
    ],
  },
  {
    title: "2. Education",
    fields: [
      {
        name: "highestEducation",
        label: "4. What is your level of education?",
        help: "Use the highest credential with a Canadian credential or valid ECA.",
        type: "select",
        options: educationLevelOptions,
      },
      { name: "educationInCanada", label: "4b. Have you earned a Canadian degree, diploma or certificate?", type: "select", options: yesNoOptions },
      {
        name: "canadianEducationCredentialLevel",
        label: "4c. Choose the best answer to describe the Canadian credential.",
        type: "select",
        options: canadianEducationCredentialOptions,
        showIf: ({ profile }) => isYes(profile.educationInCanada),
      },
    ],
  },
];

const languageGroups = [
  {
    title: "3. Official Languages",
    fields: [
      { name: "approvedLanguageTest", label: "5.i Are your language test results less than two years old?", type: "select", options: yesNoOptions },
      { name: "firstLanguageTest", label: "5.ii Which test did you take for your first official language?", type: "select", options: languageTestOptions, showIf: ({ language }) => isYes(language.approvedLanguageTest) },
      ...languageAbilityFields("firstLanguage", "First official language", ({ language }) => isYes(language.approvedLanguageTest)),
      {
        name: "secondLanguageTest",
        label: "5.iii Do you have other language results?",
        type: "select",
        options: secondLanguageTestOptions,
        showIf: ({ language }) => isYes(language.approvedLanguageTest),
      },
      ...languageAbilityFields(
        "secondLanguage",
        "Second official language",
        ({ language }) => isYes(language.approvedLanguageTest) && hasLanguageTestResult(language.secondLanguageTest)
      ),
    ],
  },
];

const workGroups = [
  {
    title: "6. Work Experience",
    fields: [
      { name: "canadianSkilledExperienceYears", label: "6.i Skilled work experience in Canada in the last 10 years", type: "select", options: yearOptions },
      { name: "foreignSkilledExperienceYears", label: "6.ii Foreign skilled work experience in the last 10 years", type: "select", options: foreignYearOptions },
    ],
  },
  {
    title: "7. Certificate of Qualification",
    fields: [
      { name: "certificateOfQualification", label: "Do you have a certificate of qualification from a Canadian province, territory or federal body?", type: "select", options: yesNoOptions },
    ],
  },
  {
    title: "8. Job Offer",
    fields: [
      { name: "validJobOffer", label: "Do you have a valid job offer supported by an LMIA, if needed?", type: "select", options: yesNoOptions },
      { name: "jobOfferTeer", label: "8a. Which NOC TEER is the job offer?", type: "select", options: jobOfferTeerOptions, showIf: ({ work }) => isYes(work.validJobOffer) },
    ],
  },
];

const additionalGroups = [
  {
    title: "9. Provincial Nomination",
    fields: [
      { name: "nominationCertificate", label: "Do you have a nomination certificate from a province or territory?", type: "select", options: yesNoOptions },
    ],
  },
  {
    title: "10. Sibling in Canada",
    fields: [
      { name: "siblingInCanada", label: "Do you or an accompanying spouse/common-law partner have a brother or sister in Canada who is a citizen or permanent resident?", type: "select", options: yesNoOptions },
    ],
  },
];

const spouseGroups = [
  {
    title: "11. Spouse Education",
    showIf: ({ profile }) => hasScoredSpouse(profile),
    fields: [
      { name: "spouseEducation", label: "Highest education for your spouse/common-law partner", type: "select", options: educationLevelOptions },
    ],
  },
  {
    title: "12. Spouse Canadian Work Experience",
    showIf: ({ profile }) => hasScoredSpouse(profile),
    fields: [
      { name: "spouseCanadianWorkYears", label: "Skilled work experience in Canada in the last 10 years", type: "select", options: yearOptions },
    ],
  },
  {
    title: "13. Spouse Language",
    showIf: ({ profile }) => hasScoredSpouse(profile),
    fields: [
      { name: "spouseLanguageTest", label: "Did your spouse/common-law partner take a language test?", type: "select", options: secondLanguageTestOptions },
      ...languageAbilityFields("spouseLanguage", "Spouse first official language", ({ spouse }) => hasLanguageTestResult(spouse.spouseLanguageTest)),
    ],
  },
];

function getSectionGroups(sectionId) {
  if (sectionId === "language") {
    return languageGroups;
  }

  if (sectionId === "work") {
    return workGroups;
  }

  if (sectionId === "additional") {
    return additionalGroups;
  }

  if (sectionId === "spouse") {
    return spouseGroups;
  }

  return profileGroups;
}

function isGroupVisible(group, formData) {
  return typeof group.showIf === "function" ? group.showIf(formData) : true;
}

function isFieldVisible(field, formData) {
  return typeof field.showIf === "function" ? field.showIf(formData) : true;
}

function getVisibleSectionGroups(sectionId, formData) {
  return getSectionGroups(sectionId)
    .filter((group) => isGroupVisible(group, formData))
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) => isFieldVisible(field, formData)),
    }))
    .filter((group) => group.fields.length);
}

function removeFields(sectionData, fieldNames) {
  const next = { ...sectionData };

  for (const fieldName of fieldNames) {
    delete next[fieldName];
  }

  return next;
}

function pickFields(source = {}, fieldNames = []) {
  return fieldNames.reduce((result, fieldName) => {
    if (source[fieldName] !== undefined) {
      result[fieldName] = source[fieldName];
    }

    return result;
  }, {});
}

function normalizeDependentAnswers(formData, changedSectionId, changedFieldName, changedValue) {
  const next = {
    ...formData,
    [changedSectionId]: {
      ...(formData[changedSectionId] || {}),
      [changedFieldName]: changedValue,
    },
  };

  if (changedSectionId === "profile") {
    if (changedFieldName === "maritalStatus" && !hasCurrentSpouse(next.profile)) {
      next.profile = removeFields(next.profile, [
        "spouseCanadianCitizenPr",
        "spouseAccompany",
      ]);
      next.spouse = {};
    }

    if (changedFieldName === "educationInCanada" && !isYes(changedValue)) {
      next.profile = removeFields(next.profile, ["canadianEducationCredentialLevel"]);
    }

    if (changedFieldName === "spouseCanadianCitizenPr" && isYes(changedValue)) {
      next.profile = removeFields(next.profile, ["spouseAccompany"]);
      next.spouse = {};
    }

    if (changedFieldName === "spouseAccompany" && !isYes(changedValue)) {
      next.spouse = {};
    }
  }

  if (changedSectionId === "language") {
    if (changedFieldName === "approvedLanguageTest" && !isYes(changedValue)) {
      next.language = {
        approvedLanguageTest: changedValue,
      };
    }

    if (changedFieldName === "secondLanguageTest" && !hasLanguageTestResult(changedValue)) {
      next.language = removeFields(next.language, ["secondLanguageClb", ...secondLanguageFieldNames]);
    }
  }

  if (changedSectionId === "work" && changedFieldName === "validJobOffer" && !isYes(changedValue)) {
    next.work = removeFields(next.work, ["jobOfferTeer"]);
  }

  if (changedSectionId === "spouse" && changedFieldName === "spouseLanguageTest" && !hasLanguageTestResult(changedValue)) {
    next.spouse = removeFields(next.spouse, ["spouseLanguageClb", ...spouseLanguageFieldNames]);
  }

  return next;
}

function sanitizeFormDataForVisibility(formData) {
  return assessmentSections.reduce((result, section) => {
    const sectionData = formData[section.id] || {};
    const visibleFieldNames = new Set(
      getVisibleSectionGroups(section.id, formData).flatMap((group) => group.fields.map((field) => field.name))
    );

    result[section.id] = Object.fromEntries(
      Object.entries(sectionData).filter(([fieldName]) => visibleFieldNames.has(fieldName))
    );

    return result;
  }, {});
}

function getVisibleAssessmentSections(formData) {
  return assessmentSections.filter((section) => section.id !== "spouse" || hasScoredSpouse(formData.profile));
}

function calculateAgeOption(dateOfBirth) {
  if (!dateOfBirth) {
    return "";
  }

  const birthDate = new Date(dateOfBirth);

  if (Number.isNaN(birthDate.getTime())) {
    return "";
  }

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();

  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }

  return age >= 66 ? "66 or older" : String(age);
}

function buildDefaultFormData(caseItem) {
  return {
    profile: {
      age: calculateAgeOption(caseItem?.client?.dateOfBirth),
    },
    language: {},
    work: {},
    additional: {},
    spouse: {},
  };
}

function mergeFormData(defaults, saved) {
  const legacyProfile = saved?.profile || {};
  const profileFieldNames = [
    "maritalStatus",
    "spouseCanadianCitizenPr",
    "spouseAccompany",
    "age",
    "highestEducation",
    "educationInCanada",
    "canadianEducationCredentialLevel",
  ];
  const languageFieldNames = [
    "approvedLanguageTest",
    "firstLanguageTest",
    "firstOfficialLanguage",
    "firstLanguageClb",
    ...firstLanguageFieldNames,
    "secondLanguageTest",
    "secondOfficialLanguage",
    "secondLanguageClb",
    ...secondLanguageFieldNames,
  ];
  const workFieldNames = [
    "canadianSkilledExperienceYears",
    "foreignSkilledExperienceYears",
    "certificateOfQualification",
    "validJobOffer",
    "jobOfferTeer",
  ];
  const additionalFieldNames = ["nominationCertificate", "siblingInCanada"];
  const spouseFieldNames = ["spouseEducation", "spouseCanadianWorkYears", "spouseLanguageTest", "spouseLanguageClb", ...spouseLanguageFieldNames];

  return {
    profile: {
      ...defaults.profile,
      ...pickFields(legacyProfile, profileFieldNames),
      ...(saved?.profile ? pickFields(saved.profile, profileFieldNames) : {}),
    },
    language: {
      ...defaults.language,
      ...pickFields(legacyProfile, languageFieldNames),
      ...(saved?.language || {}),
    },
    work: {
      ...defaults.work,
      ...pickFields(legacyProfile, workFieldNames),
      ...(saved?.jobOffer || {}),
      ...(saved?.work || {}),
    },
    additional: {
      ...defaults.additional,
      ...pickFields(legacyProfile, additionalFieldNames),
      ...(saved?.additional || {}),
    },
    spouse: {
      ...defaults.spouse,
      ...pickFields(legacyProfile, spouseFieldNames),
      ...(saved?.spouse || {}),
    },
  };
}

function AssessmentField({ sectionId, field, value, onChange }) {
  const sharedClassName =
    "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400";

  function handleChange(event) {
    if (field.type === "file") {
      onChange(sectionId, field.name, event.target.files?.[0]?.name || "");
      return;
    }

    onChange(sectionId, field.name, event.target.value);
  }

  return (
    <label className="block">
      <span className="block text-sm font-semibold text-slate-800">{field.label}</span>
      {field.help ? <span className="mt-1 block text-xs leading-5 text-slate-500">{field.help}</span> : null}

      {field.type === "textarea" ? (
        <textarea value={value || ""} onChange={handleChange} className={`${sharedClassName} min-h-[94px] resize-none`} />
      ) : field.type === "select" ? (
        <select value={value || ""} onChange={handleChange} className="select-field mt-2 w-full">
          {(field.options || [""]).map((option) => (
            <option key={option || "empty"} value={option}>
              {option || "Select"}
            </option>
          ))}
        </select>
      ) : field.type === "file" ? (
        <div className="mt-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3">
          <input type="file" accept="application/pdf" onChange={handleChange} className="text-sm text-slate-600" />
          {value ? <p className="mt-2 text-xs font-semibold text-slate-600">{value}</p> : null}
        </div>
      ) : (
        <input
          type={field.type || "text"}
          value={value || ""}
          onChange={handleChange}
          className={sharedClassName}
          step={field.step}
          min={field.min}
          max={field.max}
          inputMode={field.inputMode}
        />
      )}
    </label>
  );
}

function ScorePreview({ assessment }) {
  const score = Number(assessment?.crsScore || 0);
  const percent = Math.min(100, Math.round((score / 1200) * 100));
  const stroke = score >= 470 ? "#16a34a" : score >= 350 ? "#d97706" : "#dc2626";

  return (
    <div className="rounded-[1.5rem] bg-slate-50 px-4 py-4">
      <div className="flex items-center gap-4">
        <div
          className="grid h-20 w-20 min-w-20 shrink-0 aspect-square place-items-center rounded-full"
          style={{
            background: `conic-gradient(${stroke} ${percent}%, #e2e8f0 0)`,
          }}
        >
          <div className="grid h-14 w-14 min-w-14 shrink-0 aspect-square place-items-center rounded-full bg-white">
            <span className="text-lg font-semibold text-slate-950">{score || "-"}</span>
          </div>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Estimated CRS</p>
          <p className="mt-1 text-sm text-slate-600">Saved score appears here after assessment is submitted.</p>
        </div>
      </div>
    </div>
  );
}

export default function AssessmentOverlay({ caseItem, assessment, saving, error, onClose, onSave }) {
  const [activeSection, setActiveSection] = useState("profile");
  const [formData, setFormData] = useState(() => mergeFormData(buildDefaultFormData(caseItem), assessment?.formData));
  const [declaredComplete, setDeclaredComplete] = useState(Boolean(assessment?.declaredComplete));

  useEffect(() => {
    setFormData(mergeFormData(buildDefaultFormData(caseItem), assessment?.formData));
    setDeclaredComplete(Boolean(assessment?.declaredComplete));
  }, [assessment, caseItem]);

  function updateField(sectionId, fieldName, value) {
    setFormData((current) => normalizeDependentAnswers(current, sectionId, fieldName, value));
  }

  const visibleSections = getVisibleAssessmentSections(formData);
  const activeSectionIndex = Math.max(0, visibleSections.findIndex((section) => section.id === activeSection));
  const activeConfig = visibleSections[activeSectionIndex] || visibleSections[0] || assessmentSections[0];
  const activeSectionId = activeConfig.id;
  const ActiveIcon = activeConfig.icon;
  const isFirstSection = activeSectionIndex === 0;
  const isLastSection = activeSectionIndex === visibleSections.length - 1;
  const previousSection = visibleSections[activeSectionIndex - 1];
  const nextSection = visibleSections[activeSectionIndex + 1];
  const visibleGroups = getVisibleSectionGroups(activeSectionId, formData);

  useEffect(() => {
    if (!visibleSections.some((section) => section.id === activeSection)) {
      setActiveSection(visibleSections[visibleSections.length - 1]?.id || "profile");
    }
  }, [activeSection, formData, visibleSections]);

  function handlePreviousStep() {
    if (previousSection) {
      setActiveSection(previousSection.id);
    }
  }

  function handleNextStep() {
    if (nextSection) {
      setActiveSection(nextSection.id);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (!isLastSection) {
      handleNextStep();
      return;
    }

    onSave({ formData: sanitizeFormDataForVisibility(formData), declaredComplete });
  }

  return (
    <div className="fixed inset-0 z-[280] bg-slate-950/24 p-3 backdrop-blur-md">
      <motion.form
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.99 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onSubmit={handleSubmit}
        className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.26)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">CRS Assessment</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">Conduct CRS Assessment</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Focused on the Canada.ca Express Entry CRS calculator inputs, with irrelevant spouse and language questions hidden automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Close assessment"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[300px_1fr]">
          <aside className="min-h-0 overflow-y-auto border-b border-slate-100 bg-slate-50/80 p-4 lg:border-b-0 lg:border-r">
            <ScorePreview assessment={assessment} />
            <div className="mt-4 space-y-2">
              {visibleSections.map((section) => {
                const Icon = section.icon;
                const isActive = activeSectionId === section.id;

                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    className={`flex w-full items-center gap-3 rounded-[1.25rem] px-3 py-3 text-left transition ${
                      isActive ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:bg-white/70 hover:text-slate-800"
                    }`}
                  >
                    <span className={`grid h-8 w-8 place-items-center rounded-full ${isActive ? "bg-slate-950 text-white" : "bg-white text-slate-500"}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block text-xs font-semibold uppercase tracking-[0.16em]">Section {section.number}</span>
                      <span className="mt-0.5 block text-sm font-semibold">{section.title}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto px-5 py-5">
            {error ? <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

            <AnimatePresence mode="wait">
              <motion.div
                key={activeSectionId}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-6"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-full bg-slate-950 text-white">
                    <ActiveIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">CRS Assessment</p>
                    <h3 className="text-lg font-semibold text-slate-950">
                      {activeConfig.number}. {activeConfig.title}
                    </h3>
                  </div>
                </div>

                {visibleGroups.map((group) => (
                  <section key={group.title} className="rounded-[1.5rem] border border-slate-100 bg-white px-4 py-4">
                    <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-400">{group.title}</h4>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      {group.fields.map((field) => (
                        <AssessmentField
                          key={field.name}
                          sectionId={activeSectionId}
                          field={field}
                          value={formData[activeSectionId]?.[field.name]}
                          onChange={updateField}
                        />
                      ))}
                    </div>
                  </section>
                ))}

                {!visibleGroups.length ? (
                  <section className="rounded-[1.5rem] bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    This section is not needed based on the answers already entered.
                  </section>
                ) : null}

                {isLastSection ? (
                  <section className="rounded-[1.5rem] bg-slate-50 px-4 py-4">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={declaredComplete}
                        onChange={(event) => setDeclaredComplete(event.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-slate-300"
                      />
                      <span>
                        <span className="block text-sm font-semibold text-slate-950">Declaration</span>
                        <span className="mt-1 block text-sm text-slate-500">
                          I declare that the information provided is true and complete to the best of my knowledge.
                        </span>
                      </span>
                    </label>
                  </section>
                ) : null}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        <footer className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <FileText className="h-4 w-4" />
            <span>Move through each CRS step. Save appears on the final page.</span>
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
            {!isFirstSection ? (
              <button
                type="button"
                onClick={handlePreviousStep}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            ) : null}
            {!isLastSection ? (
              <button
                type="button"
                onClick={handleNextStep}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {declaredComplete ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {saving ? "Saving" : "Save Assessment"}
              </button>
            )}
          </div>
        </footer>
      </motion.form>
    </div>
  );
}
