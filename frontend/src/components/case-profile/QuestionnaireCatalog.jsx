import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronRight,
  Eye,
  FilePlus2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const categories = [
  {
    id: "temporary-in-canada",
    title: "Temporary Resident - Stay in Canada longer",
    description:
      "Already in Canada and applying to extend visitor, study, or work status, including PGWP.",
    options: [
      "Visitor Visa Extension",
      "Study Permit Extension",
      "Work Permit Extension",
      "Post-Graduation Work Permit (PGWP)",
    ],
    modules: [
      "Applicant details",
      "Current Canadian status",
      "Identity & travel documents",
      "Address history",
      "Background declarations",
    ],
  },
  {
    id: "temporary-to-canada",
    title: "Temporary Resident - Come to Canada temporarily",
    description:
      "Outside Canada and applying to visit, study, work, obtain a Super Visa, or request an eTA.",
    options: [
      "Visitor Visa (TRV)",
      "Study Permit",
      "Work Permit",
      "Super Visa",
      "Electronic Travel Authorization (eTA)",
    ],
    modules: [
      "Applicant details",
      "Identity & travel documents",
      "Family information",
      "Travel history",
      "Funds & purpose of travel",
      "Background declarations",
    ],
  },
  {
    id: "permanent-resident",
    title: "Permanent Resident",
    description:
      "Permanent residence pathways outside Quebec, including Express Entry and other federal programs.",
    options: [
      "Provincial Nominee Programs",
      "Canadian Experience Class",
      "Federal Skilled Worker",
      "Federal Skilled Trades",
      "Start-up Business",
      "Start-up Visa Optional Open Work Permit",
      "Permit Holder Class",
      "Permanent Resident Card",
    ],
    modules: [
      "Applicant details",
      "Identity & travel documents",
      "Family information",
      "Work history",
      "Education history",
      "Language tests",
      "Address history",
      "Personal history",
      "Travel history",
      "Background declarations",
    ],
  },
  {
    id: "family-sponsorship",
    title: "Family Sponsorship",
    description:
      "Sponsor a spouse or partner, child, parents or grandparents, or another eligible relative.",
    options: [
      "Spouse/Common-Law/Conjugal Partner Sponsorship",
      "Dependant Child/Adopted Child Sponsorship",
      "Parents/Grandparents/Orphaned Relatives/Other Relatives",
    ],
    modules: [
      "Sponsor details",
      "Applicant details",
      "Relationship history",
      "Family information",
      "Identity & travel documents",
      "Address history",
      "Personal history",
      "Travel history",
      "Background declarations",
    ],
  },
  {
    id: "refugee-humanitarian",
    title: "Refugee and Humanitarian",
    description:
      "Refugee claims and protected-person applications from inside or outside Canada.",
    options: [
      "In Canada – Refugee Claim",
      "In Canada – Protected Person",
      "Outside Canada – Refugee",
    ],
    modules: [
      "Applicant details",
      "Family information",
      "Identity & travel documents",
      "Residence & travel history",
      "Claim narrative",
      "Risk and protection history",
      "Background declarations",
    ],
  },
  {
    id: "humanitarian-compassionate",
    title: "Humanitarian & Compassionate",
    description:
      "Applications based on exceptional humanitarian and compassionate circumstances.",
    options: ["In Canada - Humanitarian & Compassionate Considerations"],
    modules: [
      "Applicant details",
      "Family information",
      "Canadian establishment",
      "Hardship narrative",
      "Best interests of children",
      "Personal history",
      "Background declarations",
    ],
  },
  {
    id: "citizenship",
    title: "Citizenship",
    description:
      "Citizenship grant, proof, renunciation, resumption, and adopted-child applications.",
    options: [
      "Citizenship Grant",
      "Citizenship Certificate (Proof of Citizenship)",
      "Citizenship Renunciation",
      "Citizenship Resumption",
      "Citizenship for Adopted Children",
    ],
    modules: [
      "Applicant details",
      "Identity documents",
      "Immigration status",
      "Address history",
      "Physical presence",
      "Travel history",
      "Tax history",
      "Prohibitions",
    ],
  },
  {
    id: "admissibility",
    title: "Admissibility & Rehabilitation",
    description:
      "Applications addressing criminal or other inadmissibility concerns.",
    options: ["Criminal Rehabilitation"],
    modules: [
      "Applicant details",
      "Identity & travel documents",
      "Address history",
      "Personal history",
      "Offence details",
      "Court and sentence details",
      "Rehabilitation narrative",
    ],
  },
  {
    id: "other",
    title: "Other",
    description: "Custom questionnaires that do not support form autofill.",
    options: ["Custom Questionnaire"],
    modules: ["Custom questions"],
  },
];

function CatalogueOverlay({ saving, error, onClose, onAssign }) {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [search, setSearch] = useState("");
  const visible = useMemo(
    () =>
      categories.filter((category) =>
        `${category.title} ${category.description} ${category.options.join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [search],
  );
  return typeof document === "undefined"
    ? null
    : createPortal(
        <div className="fixed inset-0 z-[300] bg-slate-950/24 p-3 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.26)]"
          >
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div className="flex items-start gap-3">
                {selectedCategory ? (
                  <button
                    type="button"
                    onClick={() => setSelectedCategory(null)}
                    className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                ) : null}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    English questionnaires
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-950">
                    {selectedCategory
                      ? selectedCategory.title
                      : "Choose a questionnaire"}
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm text-slate-500">
                    {selectedCategory
                      ? "Select the application type to assign to this case."
                      : "Choose the immigration application category that matches the client’s case."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-5 py-5">
              {error ? (
                <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}
              <AnimatePresence mode="wait">
                {!selectedCategory ? (
                  <motion.div
                    key="categories"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                  >
                    <label className="relative mb-4 block">
                      <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                      <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search categories or application types"
                        className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm outline-none focus:border-slate-400"
                      />
                    </label>
                    <div className="grid gap-3 md:grid-cols-2">
                      {visible.map((category) => (
                        <button
                          key={category.id}
                          type="button"
                          onClick={() => setSelectedCategory(category)}
                          className="group flex items-start justify-between gap-4 rounded-[1.35rem] border border-slate-100 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-md"
                        >
                          <div>
                            <h3 className="text-sm font-semibold text-slate-950">
                              {category.title}
                            </h3>
                            <p className="mt-1 text-xs leading-5 text-slate-500">
                              {category.description}
                            </p>
                            <span className="mt-3 inline-flex rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                              {category.options.length}{" "}
                              {category.options.length === 1
                                ? "option"
                                : "options"}
                            </span>
                          </div>
                          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-700" />
                        </button>
                      ))}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="options"
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 8 }}
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      {selectedCategory.options.map((option) => (
                        <button
                          key={option}
                          type="button"
                          disabled={saving}
                          onClick={() =>
                            onAssign({
                              categoryId: selectedCategory.id,
                              categoryTitle: selectedCategory.title,
                              applicationType: option,
                              modules: selectedCategory.modules,
                              autofill: selectedCategory.id !== "other",
                            })
                          }
                          className="flex items-center justify-between gap-3 rounded-[1.25rem] border border-slate-100 bg-white p-4 text-left transition hover:border-slate-300 hover:shadow-sm disabled:opacity-60"
                        >
                          <div>
                            <p className="text-sm font-semibold text-slate-950">
                              {option}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {selectedCategory.modules.length} assigned
                              information sections
                            </p>
                          </div>
                          <Plus className="h-4 w-4 text-slate-400" />
                        </button>
                      ))}
                    </div>
                    <section className="mt-5 rounded-[1.35rem] bg-white p-4 ring-1 ring-slate-100">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Information assigned to this category
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedCategory.modules.map((module) => (
                          <span
                            key={module}
                            className="rounded-full bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600"
                          >
                            {module}
                          </span>
                        ))}
                      </div>
                    </section>
                  </motion.div>
                )}
              </AnimatePresence>
            </main>
          </motion.div>
        </div>,
        document.body,
      );
}

function hasObjectData(value) {
  return (
    value &&
    typeof value === "object" &&
    Object.values(value).some((item) =>
      Array.isArray(item)
        ? item.length
        : item && typeof item === "object"
          ? hasObjectData(item)
          : String(item || "").trim(),
    )
  );
}
function moduleIsMapped(module, profileData) {
  const name = module.toLowerCase();
  const application = profileData.profileQuestionnaires || {};
  if (name.includes("applicant")) return hasObjectData(profileData.profile);
  if (name.includes("work history")) return hasObjectData(profileData.work);
  if (name.includes("education")) return hasObjectData(profileData.education);
  if (name.includes("language")) return hasObjectData(profileData.language);
  if (name.includes("family"))
    return (
      hasObjectData(profileData.spouse) ||
      hasObjectData(profileData.dependantsAndChildren) ||
      hasObjectData(profileData.siblings)
    );
  if (name.includes("identity") || name.includes("travel documents"))
    return hasObjectData(profileData.identityPermits);
  if (name.includes("address") || name.includes("residence"))
    return hasObjectData(profileData.addressHistory);
  if (name.includes("personal history"))
    return hasObjectData(profileData.activityHistory);
  if (name.includes("travel history"))
    return hasObjectData(profileData.travelHistory);
  if (
    name.includes("current canadian status") ||
    name.includes("immigration status")
  )
    return hasObjectData(application.canadianStatus);
  if (name.includes("background")) return hasObjectData(application.background);
  if (name.includes("sponsor") || name.includes("relationship"))
    return hasObjectData(application.sponsorship);
  if (
    name.includes("funds") ||
    name.includes("purpose") ||
    name.includes("business")
  )
    return hasObjectData(application.programDetails);
  if (
    name.includes("humanitarian") ||
    name.includes("hardship") ||
    name.includes("establishment") ||
    name.includes("best interests") ||
    name.includes("physical presence") ||
    name.includes("tax") ||
    name.includes("prohibitions")
  )
    return hasObjectData(application.humanitarianCitizenship);
  if (
    name.includes("offence") ||
    name.includes("court") ||
    name.includes("rehabilitation")
  )
    return hasObjectData(application.rehabilitation);
  if (name.includes("claim narrative") || name.includes("risk and protection"))
    return hasObjectData(application.refugeeProtection);
  return false;
}

function displayDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-CA", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

function AssignmentActionsMenu({
  index,
  assignment,
  isOpen,
  onToggle,
  onAction,
}) {
  const buttonRef = useRef(null);
  const [position, setPosition] = useState(null);
  const options = [
    "View",
    "Edit",
    "Manage Sections",
    "Assign",
    "Rename",
    "Lock",
    "Due Date",
    "Share",
    "Delete",
  ];

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) {
      setPosition(null);
      return;
    }
    const placeMenu = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 208;
      const estimatedHeight = 344;
      const padding = 12;
      const left = Math.min(
        Math.max(padding, rect.right - width),
        window.innerWidth - width - padding,
      );
      const roomBelow = window.innerHeight - rect.bottom;
      const top =
        roomBelow >= estimatedHeight + padding
          ? rect.bottom + 8
          : Math.max(padding, rect.top - estimatedHeight - 8);
      setPosition({ top, left });
    };
    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onToggle(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen, onToggle]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => onToggle(isOpen ? null : index)}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
        aria-label={`More actions for ${assignment.name || assignment.applicationType}`}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {isOpen && position && typeof document !== "undefined"
        ? createPortal(
            <>
              <button
                type="button"
                onClick={() => onToggle(null)}
                className="fixed inset-0 z-[340] cursor-default bg-transparent"
                aria-label="Close questionnaire actions"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                className="fixed z-[350] w-[208px] overflow-hidden rounded-2xl border border-white/80 bg-white/95 p-2 shadow-[0_20px_50px_rgba(15,23,42,0.18)] backdrop-blur-xl"
                style={{ top: position.top, left: position.left }}
              >
                {options.map((option, optionIndex) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onAction(index, option)}
                    className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-[13px] font-medium transition hover:bg-slate-100/80 ${option === "Delete" ? "mt-1 border-t border-slate-100 pt-2.5 text-rose-600" : "text-slate-700"}`}
                  >
                    {option === "Lock" && assignment.locked ? "Unlock" : option}
                    {optionIndex === 0 ? (
                      <span className="ml-auto text-[10px] text-slate-300">
                        ↵
                      </span>
                    ) : null}
                  </button>
                ))}
              </motion.div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}

function AssignmentView({ assignment, profileData, onClose, onOpenProfile }) {
  return typeof document === "undefined"
    ? null
    : createPortal(
        <div className="fixed inset-0 z-[300] bg-slate-950/24 p-3 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-[0_28px_80px_rgba(15,23,42,0.26)]"
          >
            <header className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {assignment.categoryTitle}
                </p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">
                  {assignment.name || assignment.applicationType}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-5">
              <div className="space-y-3">
                {assignment.modules.map((module) => {
                  const mapped = moduleIsMapped(module, profileData);
                  return (
                    <div
                      key={module}
                      className="flex items-center justify-between rounded-xl bg-white px-4 py-3 ring-1 ring-slate-100"
                    >
                      <span className="text-sm font-semibold text-slate-800">
                        {module}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${mapped ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
                      >
                        {mapped ? "Profile mapped" : "Details needed"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </main>
            <footer className="flex justify-end border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={onOpenProfile}
                className="rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white"
              >
                Open questionnaire data
              </button>
            </footer>
          </motion.div>
        </div>,
        document.body,
      );
}

function DeleteQuestionnaireDialog({ assignment, deleting, onCancel, onConfirm }) {
  return typeof document === "undefined"
    ? null
    : createPortal(
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-950/20 p-4 backdrop-blur-md">
          <button type="button" onClick={onCancel} className="absolute inset-0 cursor-default" aria-label="Cancel delete" />
          <motion.section
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/95 shadow-[0_30px_90px_rgba(15,23,42,0.24)] backdrop-blur-xl"
          >
            <div className="px-6 pb-5 pt-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600 ring-8 ring-rose-50/50">
                <Trash2 className="h-5 w-5" />
              </div>
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-500">Remove questionnaire</p>
              <h3 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">Delete “{assignment.name || assignment.applicationType}”?</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">This removes the assignment from the case. Information already saved in the client profile will remain available.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50/70 p-4">
              <button type="button" onClick={onCancel} disabled={deleting} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">Keep it</button>
              <button type="button" onClick={onConfirm} disabled={deleting} className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(225,29,72,0.22)] transition hover:bg-rose-700 disabled:opacity-50">{deleting ? "Deleting…" : "Delete Questionnaire"}</button>
            </div>
          </motion.section>
        </div>,
        document.body,
      );
}

function AssignmentFieldDialog({ mode, assignment, saving, onCancel, onSave }) {
  const isRename = mode === "rename";
  const [value, setValue] = useState(isRename ? assignment.name || assignment.applicationType : assignment.dueDate?.slice?.(0, 10) || "");
  const Icon = isRename ? Pencil : CalendarClock;
  return typeof document === "undefined" ? null : createPortal(
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-950/20 p-4 backdrop-blur-md">
      <button type="button" onClick={onCancel} className="absolute inset-0 cursor-default" aria-label="Close action sheet" />
      <motion.form initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} onSubmit={async (event) => { event.preventDefault(); await onSave(value); }} className="relative w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/95 shadow-[0_30px_90px_rgba(15,23,42,0.24)] backdrop-blur-xl">
        <div className="px-6 pb-5 pt-6">
          <div className="flex items-start gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700"><Icon className="h-5 w-5" /></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Questionnaire settings</p><h3 className="mt-1 text-lg font-semibold text-slate-950">{isRename ? "Rename questionnaire" : "Set due date"}</h3><p className="mt-1 text-sm leading-6 text-slate-500">{isRename ? "Choose a clear name that staff and the client will recognize." : "Choose when the client should complete this questionnaire."}</p></div></div>
          <label className="mt-5 block"><span className="text-sm font-semibold text-slate-800">{isRename ? "Questionnaire name" : "Due date"}</span><input autoFocus required={isRename} type={isRename ? "text" : "date"} value={value} onChange={(event) => setValue(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100" /></label>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50/70 p-4"><button type="button" onClick={onCancel} disabled={saving} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">Cancel</button><button type="submit" disabled={saving || (isRename && !value.trim())} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)] transition hover:bg-slate-800 disabled:opacity-50">{saving ? "Saving…" : isRename ? "Save Name" : "Save Due Date"}</button></div>
      </motion.form>
    </div>, document.body);
}

export default function QuestionnaireCatalog({
  assignments = [],
  profileData = {},
  applicant = {},
  saving,
  error,
  onAssign,
  onUpdate,
  onOpenProfile,
}) {
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [fieldTarget, setFieldTarget] = useState(null);
  const runOption = async (index, action) => {
    const item = assignments[index];
    setMenuIndex(null);
    if (action === "View" || action === "Manage Sections") {
      setViewing(item);
      return;
    }
    if (action === "Edit") {
      setViewing(item);
      return;
    }
    if (action === "Assign") {
      await onUpdate(index, {
        assignedTo: applicant.fullName || "Principal Applicant",
      });
      return;
    }
    if (action === "Rename") {
      setFieldTarget({ mode: "rename", assignment: item, index });
      return;
    }
    if (action === "Lock") {
      await onUpdate(index, { locked: !item.locked });
      return;
    }
    if (action === "Due Date") {
      setFieldTarget({ mode: "dueDate", assignment: item, index });
      return;
    }
    if (action === "Share") {
      await onUpdate(index, {
        sharing: item.sharing === "Shared" ? "Private" : "Shared",
      });
      return;
    }
    if (action === "Delete") setDeleteTarget({ assignment: item, index });
  };
  return (
    <div className="space-y-4">
      <section className="rounded-[1.5rem] bg-[linear-gradient(135deg,#f8fafc,#eef2f7)] px-5 py-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Important
            </p>
            <h3 className="mt-2 text-lg font-semibold text-slate-950">
              Application questionnaires
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Gather the information required to complete the client’s
              immigration forms. Profile answers are reused where available.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOverlayOpen(true)}
            className="inline-flex w-fit items-center gap-1.5 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" /> Add questionnaire
          </button>
        </div>
      </section>
      {assignments.length ? (
        <section className="overflow-visible rounded-[1.35rem] border border-slate-100 bg-white">
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[1.8fr_1.25fr_.75fr_.75fr_.85fr_1fr] gap-4 border-b border-slate-100 bg-slate-50/80 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                <span>Principal Applicant</span>
                <span>Type</span>
                <span>Sharing</span>
                <span>Status</span>
                <span>Last Updated</span>
                <span>Action</span>
              </div>
              {assignments.map((assignment, index) => {
                const mapped = assignment.modules.filter((module) =>
                  moduleIsMapped(module, profileData),
                ).length;
                return (
                  <div
                    key={assignment.id || `${assignment.categoryId}-${index}`}
                    className="grid grid-cols-[1.8fr_1.25fr_.75fr_.75fr_.85fr_1fr] items-center gap-4 border-b border-slate-100 px-4 py-4 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                        Principal Applicant
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-950">
                        {applicant.fullName || "Not assigned"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {applicant.email || "No email"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {assignment.name || assignment.applicationType}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Due: {displayDate(assignment.dueDate)}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-slate-600">
                      {assignment.sharing || "Private"}
                    </span>
                    <span
                      className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${assignment.locked ? "bg-slate-100 text-slate-700" : "bg-emerald-50 text-emerald-700"}`}
                    >
                      {assignment.locked
                        ? "Locked"
                        : `${mapped}/${assignment.modules.length}`}
                    </span>
                    <span className="text-xs text-slate-500">
                      {displayDate(
                        assignment.updatedAt || assignment.assignedAt,
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setViewing(assignment)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        <Eye className="h-3.5 w-3.5" /> View
                      </button>
                      <AssignmentActionsMenu
                        index={index}
                        assignment={assignment}
                        isOpen={menuIndex === index}
                        onToggle={setMenuIndex}
                        onAction={runOption}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : (
        <div className="flex min-h-[200px] items-center justify-center rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 text-center">
          <div>
            <FilePlus2 className="mx-auto h-7 w-7 text-slate-300" />
            <h3 className="mt-3 text-sm font-semibold text-slate-950">
              No questionnaires assigned
            </h3>
            <button
              type="button"
              onClick={() => setOverlayOpen(true)}
              className="mt-4 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Add questionnaire
            </button>
          </div>
        </div>
      )}
      {overlayOpen ? (
        <CatalogueOverlay
          saving={saving}
          error={error}
          onClose={() => setOverlayOpen(false)}
          onAssign={async (assignment) => {
            await onAssign(assignment);
            setOverlayOpen(false);
          }}
        />
      ) : null}
      {viewing ? (
        <AssignmentView
          assignment={viewing}
          profileData={profileData}
          onClose={() => setViewing(null)}
          onOpenProfile={() => {
            setViewing(null);
            onOpenProfile();
          }}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteQuestionnaireDialog
          assignment={deleteTarget.assignment}
          deleting={saving}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await onUpdate(deleteTarget.index, null, true);
            setDeleteTarget(null);
          }}
        />
      ) : null}
      {fieldTarget ? (
        <AssignmentFieldDialog
          mode={fieldTarget.mode}
          assignment={fieldTarget.assignment}
          saving={saving}
          onCancel={() => setFieldTarget(null)}
          onSave={async (value) => {
            await onUpdate(fieldTarget.index, fieldTarget.mode === "rename" ? { name: value.trim() } : { dueDate: value });
            setFieldTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}
