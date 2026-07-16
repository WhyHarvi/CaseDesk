import { CheckCircle2, FileText, Plus, Save, Trash2, X } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const yesNo = ["", "Yes", "No"];
const marital = ["", "Single", "Married", "Common-law", "Separated", "Divorced", "Widowed"];
const fieldClass = "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400";

export const collectionConfigs = {
  dependants: {
    title: "Dependants & Children",
    description: "Record accompanying and non-accompanying dependent children and other dependants.",
    singular: "dependant",
    listKey: "dependants",
    fields: [
      ["uci", "Unique Client Identifier (UCI)"],
      ["familyName", "Family Name", "text", "As shown on passport/travel document"],
      ["givenNames", "Given Name(s)", "text", "As shown on passport/travel document"],
      ["gender", "Gender", "select", "", ["", "Female", "Male", "Non-binary", "Another gender", "Prefer not to say"]],
      ["dateOfBirth", "Date of Birth", "date"],
      ["maritalStatus", "Marital Status", "select", "", marital],
      ["relationship", "Relationship to Principal Applicant"],
      ["countryOfBirth", "Country of Birth"],
      ["citizenships", "Citizenship(s)"],
      ["countryOfResidence", "Country of Residence"],
      ["presentAddress", "Present Address", "textarea"],
      ["presentOccupation", "Present Occupation"],
      ["financiallyReliant", "Is the dependant financially reliant on you?", "select", "", yesNo],
      ["statusInCanada", "Status in Canada"],
      ["accompanyingCanada", "Will the dependant accompany you to Canada?", "select", "", yesNo],
      ["nonAccompanyingReason", "Reason the dependant is not accompanying", "textarea", "", null, ["accompanyingCanada", "No"]],
      ["communicationEmail", "Communication Email", "email"],
    ],
  },
  identity: {
    title: "Identity & Permits",
    description: "Passports, visas, biometrics, study permits, work permits, and other identity documents.",
    singular: "document",
    listKey: "documents",
    gateKey: "provideDetails",
    gateLabel: "Would you like to provide identity and permit document details?",
    fields: [
      ["documentType", "Document Type", "select", "", ["", "Passport", "Visa", "Biometrics", "Study Permit", "Work Permit", "Visitor Record", "National Identity Document", "Other"]],
      ["documentNumber", "Document Number"],
      ["issuingCountry", "Issuing Country"],
      ["issueDate", "Issue Date", "date"],
      ["expiryDate", "Expiry Date", "date"],
    ],
  },
  siblings: {
    title: "Sibling Details",
    description: "Record biological, adopted, half-, and step-siblings relevant to the application.",
    singular: "sibling",
    listKey: "siblings",
    fields: [
      ["familyName", "Family Name", "text", "As shown on passport/travel document"],
      ["givenNames", "Given Name(s)", "text", "As shown on passport/travel document"],
      ["gender", "Gender", "select", "", ["", "Female", "Male", "Non-binary", "Another gender", "Prefer not to say"]],
      ["dateOfBirth", "Date of Birth", "date"],
      ["maritalStatus", "Marital Status", "select", "", marital],
      ["presentOccupation", "Present Occupation"],
      ["presentAddress", "Present Address", "textarea", "If deceased, give city/town, country and date of death"],
      ["countryOfBirth", "Country of Birth"],
      ["countryOfResidence", "Country of Residence"],
      ["citizenships", "Citizenship(s)"],
      ["statusInCanada", "Status in Canada"],
      ["canadianCityProvince", "City and Province of Residence", "text", "Complete if living in Canada"],
      ["relationship", "Relationship"],
      ["accompanyingCanada", "Will your sibling accompany you to Canada?", "select", "", yesNo],
      ["communicationEmail", "Communication Email", "email"],
    ],
  },
  activity: {
    title: "Activity History",
    description: "Personal history since age 18 or the past 10 years. Include all periods without gaps.",
    singular: "activity",
    listKey: "entries",
    fields: [
      ["startDate", "Start Date", "date"],
      ["endDate", "End Date", "date", 'Leave blank if "Ongoing"'],
      ["activityType", "Activity Type", "select", "", ["", "Work", "Education", "Business", "Unemployment", "Training", "Travel", "Retired", "Detention", "Other"]],
      ["city", "City/Town"],
      ["country", "Country or Territory"],
      ["provinceState", "Province/State"],
      ["status", "Status in country or territory"],
    ],
  },
  address: {
    title: "Address History",
    description: "List every address since age 18 or during the past 10 years without date gaps or P.O. boxes.",
    singular: "address",
    listKey: "entries",
    fields: [
      ["startDate", "Start Date", "date"],
      ["endDate", "End Date", "date", 'Leave blank if "Ongoing"'],
      ["unit", "Apt. Unit"],
      ["streetNumber", "Street Number"],
      ["streetName", "Street Name"],
      ["city", "City / Town"],
      ["province", "District/Province"],
      ["postalCode", "Postal code / Zip code"],
      ["country", "Country"],
      ["residenceType", "Type of Residence", "select", "", ["", "Owned", "Rented", "With family", "Employer-provided", "Student residence", "Other"]],
    ],
  },
  travel: {
    title: "Travel History",
    description: "Travel outside the country of citizenship or current residence since age 18 or during the last 10 years.",
    singular: "trip",
    listKey: "entries",
    gateKey: "hasTravelled",
    gateLabel: "Since age 18 or during the past 10 years, have you travelled outside your country of citizenship or current residence?",
    fields: [
      ["entryDate", "Entry Date", "date"],
      ["exitDate", "Exit Date", "date", "Leave blank if still in country"],
      ["country", "Country or Territory Visited"],
      ["entryCity", "City entered through"],
      ["visaRequired", "Was a visa required?", "select", "", yesNo],
      ["purpose", "Purpose of Travel"],
      ["reasonDetails", "Details of reason for trip", "textarea", "Summary of 40 characters or fewer", null, null, 40],
      ["overstayed", "Stayed beyond the period allowed?", "select", "", yesNo],
      ["overstayDetails", "If yes, provide details", "textarea", "", null, ["overstayed", "Yes"]],
    ],
  },
};

export const parentFields = (parent) => [
  ["familyName", parent === "mother" ? "Family Name at birth" : "Family Name", "text", "As shown on passport/travel document"],
  ["givenNames", "Given Name(s)", "text", "As shown on passport/travel document"],
  ["dateOfBirth", "Date of Birth", "date"],
  ["maritalStatus", "Marital Status", "select", "", marital],
  ["presentOccupation", "Present Occupation"],
  ["presentAddress", "Present Address", "textarea", "If deceased, give city/town, country and date of death"],
  ["cityOfBirth", "City/Town of Birth"],
  ["countryOfBirth", "Country of Birth"],
  ["countryOfResidence", "Country of Residence"],
  ["citizenships", "Citizenship(s)"],
  ["accompanyingCanada", `Will your ${parent} accompany you to Canada?`, "select", "", yesNo],
  ["deceased", `Is your ${parent} deceased?`, "select", "", yesNo],
  ["communicationEmail", "Communication Email", "email"],
  ["dateOfDeath", "Date of Death", "date", "", null, ["deceased", "Yes"]],
  ["relationshipCategory", "Relationship category", "select", "", ["", "Biological parent", "Adoptive parent", "Step-parent", "Legal guardian", "Other"]],
  ["dateOfMarriage", "Date of Marriage", "date"],
  ["placeOfMarriage", "Place of Marriage"],
];

const blankFrom = (fields) => Object.fromEntries(fields.map(([key]) => [key, ""]));
const meaningful = (record) => Object.values(record || {}).some((value) => String(value || "").trim());

function Field({ field, values, onChange }) {
  const [key, label, type = "text", detail, options, condition, maxLength] = field;
  if (condition && values[condition[0]] !== condition[1]) return null;
  return <label className={`block ${type === "textarea" ? "md:col-span-2" : ""}`}><span className="block text-sm font-semibold leading-5 text-slate-800">{label}</span>{detail ? <span className="mt-1 block text-xs leading-5 text-slate-500">{detail}</span> : null}{type === "select" ? <select value={values[key] || ""} onChange={(event) => onChange(key, event.target.value)} className={fieldClass}>{options.map((option) => <option key={option || "empty"} value={option}>{option || "Select"}</option>)}</select> : type === "textarea" ? <textarea rows={3} maxLength={maxLength} value={values[key] || ""} onChange={(event) => onChange(key, event.target.value)} className={fieldClass} /> : <input type={type} value={values[key] || ""} onChange={(event) => onChange(key, event.target.value)} className={fieldClass} />}</label>;
}

function Launcher({ title, description, count, complete, onOpen }) {
  const hasData = count > 0;
  return <div className="space-y-4"><section className="rounded-[1.35rem] bg-[linear-gradient(135deg,#f8fafc,#eef2f7)] px-4 py-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Client Information Form</p><h4 className="mt-2 text-lg font-semibold text-slate-950">{title}</h4><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p></div>{hasData ? <button type="button" onClick={onOpen} className="inline-flex w-fit rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white">Edit Details</button> : null}</div></section>{hasData ? <section className="rounded-[1.35rem] bg-slate-50 p-4"><div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-slate-950">{count} {count === 1 ? "record" : "records"} saved</p><p className="mt-1 text-xs text-slate-500">Open the form to review or add more information.</p></div>{complete === "Yes" ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Complete</span> : null}</div></section> : <div className="flex min-h-[220px] items-center justify-center rounded-[1.35rem] bg-slate-50 px-5 py-8 text-center"><div><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm"><Plus className="h-4 w-4" /></div><h4 className="mt-3 text-sm font-semibold text-slate-950">No details added yet</h4><p className="mx-auto mt-2 max-w-md text-sm text-slate-500">Add the first record and save partial information at any time.</p><button type="button" onClick={onOpen} className="mt-4 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Add Details</button></div></div>}</div>;
}

export function RepeatableProfileQuestionnaire({ kind, initialData = {}, saving, error, onSave }) {
  const config = collectionConfigs[kind];
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const [complete, setComplete] = useState("No");
  const [gate, setGate] = useState("");
  useEffect(() => { setEntries((initialData[config.listKey] || []).map((entry) => ({ ...blankFrom(config.fields), ...entry }))); setComplete(initialData.complete || "No"); setGate(config.gateKey ? initialData[config.gateKey] || "" : ""); }, [initialData, config]);
  const update = (index, key, value) => setEntries((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  const count = (initialData[config.listKey] || []).length;
  const overlay = open && typeof document !== "undefined" ? createPortal(<div className="fixed inset-0 z-[290] bg-slate-950/24 p-3 backdrop-blur-md"><motion.form initial={{ opacity: 0, y: 16, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} onSubmit={async (event) => { event.preventDefault(); const saved = gate === "No" ? [] : entries.filter(meaningful); await onSave(config.gateKey ? { [config.gateKey]: gate, [config.listKey]: saved } : { [config.listKey]: saved, complete }); setOpen(false); }} className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-[0_28px_80px_rgba(15,23,42,0.26)]"><header className="flex items-start justify-between border-b border-slate-100 px-5 py-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Client Information Form</p><h2 className="mt-1 text-xl font-semibold text-slate-950">{config.title}</h2><p className="mt-1 max-w-3xl text-sm text-slate-500">{config.description}</p></div><button type="button" onClick={() => setOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200"><X className="h-4 w-4" /></button></header><main className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-5">{error ? <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}{config.gateKey ? <section className="mb-4 rounded-[1.5rem] bg-white p-4 ring-1 ring-slate-100"><label className="text-sm font-semibold text-slate-800">{config.gateLabel}<select value={gate} onChange={(event) => { setGate(event.target.value); if (event.target.value === "No") setEntries([]); }} className={`${fieldClass} max-w-xs`}><option value="">Select</option><option>Yes</option><option>No</option></select></label></section> : null}{!config.gateKey || gate === "Yes" ? <div className="space-y-4">{entries.map((entry, index) => <section key={index} className="rounded-[1.5rem] bg-white p-4 ring-1 ring-slate-100"><div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-semibold capitalize text-slate-950">{index === 0 ? `Most recent ${config.singular}` : `${config.singular} ${index + 1}`}</h3><button type="button" onClick={() => setEntries((items) => items.filter((_, itemIndex) => itemIndex !== index))} className="text-rose-500"><Trash2 className="h-4 w-4" /></button></div><div className="grid gap-4 md:grid-cols-2">{config.fields.map((field) => <Field key={field[0]} field={field} values={entry} onChange={(key, value) => update(index, key, value)} />)}</div></section>)}<button type="button" onClick={() => { setEntries((items) => [...items, blankFrom(config.fields)]); if (config.gateKey) setGate("Yes"); setComplete("No"); }} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200"><Plus className="h-4 w-4" />Add {config.singular}</button></div> : null}</main><footer className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">{!config.gateKey ? <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={complete === "Yes"} onChange={(event) => setComplete(event.target.checked ? "Yes" : "No")} />Complete</label> : <span className="text-xs text-slate-500"><FileText className="mr-1 inline h-4 w-4" />Partial details can be saved.</span>}<div className="flex gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold">Cancel</button><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"><Save className="h-4 w-4" />{saving ? "Saving" : "Save details"}</button></div></footer></motion.form></div>, document.body) : null;
  return <><Launcher title={config.title} description={config.description} count={count} complete={initialData.complete} onOpen={() => setOpen(true)} />{overlay}</>;
}

export function ParentsProfileQuestionnaire({ initialData = {}, saving, error, onSave }) {
  const [open, setOpen] = useState(false);
  const [mother, setMother] = useState({}); const [father, setFather] = useState({}); const [complete, setComplete] = useState("No");
  useEffect(() => { setMother({ ...blankFrom(parentFields("mother")), ...(initialData.mother || {}) }); setFather({ ...blankFrom(parentFields("father")), ...(initialData.father || {}) }); setComplete(initialData.complete || "No"); }, [initialData]);
  const count = [initialData.mother, initialData.father].filter(meaningful).length;
  const renderParent = (name, values, setter) => <section className="rounded-[1.5rem] bg-white p-4 ring-1 ring-slate-100"><p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{name} Details</p><div className="grid gap-4 md:grid-cols-2">{parentFields(name).map((field) => <Field key={field[0]} field={field} values={values} onChange={(key, value) => setter((current) => ({ ...current, [key]: value }))} />)}</div></section>;
  const overlay = open && typeof document !== "undefined" ? createPortal(<div className="fixed inset-0 z-[290] bg-slate-950/24 p-3 backdrop-blur-md"><motion.form initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} onSubmit={async (event) => { event.preventDefault(); await onSave({ mother, father, complete }); setOpen(false); }} className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-[0_28px_80px_rgba(15,23,42,0.26)]"><header className="flex items-start justify-between border-b border-slate-100 px-5 py-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Client Information Form</p><h2 className="mt-1 text-xl font-semibold text-slate-950">Parent Details</h2></div><button type="button" onClick={() => setOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200"><X className="h-4 w-4" /></button></header><main className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50/60 p-5">{error ? <div className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}{renderParent("mother", mother, setMother)}{renderParent("father", father, setFather)}</main><footer className="flex items-center justify-between border-t border-slate-100 px-5 py-4"><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={complete === "Yes"} onChange={(event) => setComplete(event.target.checked ? "Yes" : "No")} />Complete</label><div className="flex gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded-full border px-4 py-2.5 text-sm font-semibold">Cancel</button><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white"><Save className="h-4 w-4" />{saving ? "Saving" : "Save details"}</button></div></footer></motion.form></div>, document.body) : null;
  return <><Launcher title="Parent Details" description="Capture relevant mother and father information for the application." count={count} complete={initialData.complete} onOpen={() => setOpen(true)} />{overlay}</>;
}
