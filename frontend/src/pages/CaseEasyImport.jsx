import { AlertTriangle, BarChart3, ChevronDown, ExternalLink, Loader2, RefreshCw, Search, UploadCloud, UserCheck, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api from "../services/api";
import {
  bulkConvertCaseEasyImportContacts,
  convertCaseEasyImportContact,
  getCaseEasyImportContact,
  getCaseEasyImportContacts,
  getUnlinkedCaseEasyImportCases,
} from "../api/caseEasyImportApi";
import Select from "../components/ui/Select";
import CaseEasyReportsBrowser from "../components/case-easy/CaseEasyReportsBrowser";
import CaseEasyImportSettingsPanel from "../components/settings/CaseEasyImportSettingsPanel";
import { caseStagesForType } from "../constants/caseStages";

const RECORD_TYPE_FILTERS = [
  { value: "", label: "All" },
  { value: "client", label: "Clients" },
  { value: "prospect", label: "Prospects" },
  { value: "undetermined", label: "Needs type review" },
];
const IMPORT_STATUS_FILTERS = [
  { value: "", label: "Any status" },
  { value: "imported", label: "Imported" },
  { value: "reviewed", label: "Reviewed" },
  { value: "converted", label: "Converted" },
];
const CASE_STATUSES = ["Open", "Active", "On Hold", "Completed", "Closed", "Cancelled", "Inactive"];

const REVIEW_REASON_LABEL = {
  unlinked_contact: "Couldn't match a contact",
  assignee_mismatch: "Assignee needs review",
  conflicting_toggle: "Conflicting Prospect/Client toggle",
};

const CASE_RAW_FIELDS = [
  ["Applicant ID Key", "applicantIdKey"],
  ["Client Identifier", "clientIdentifier"],
  ["Company Name", "companyName"],
  ["Status", "status"],
  ["Case Type", "caseType"],
  ["NOC/TEER", "nocTeer"],
  ["Job Title", "jobTitle"],
  ["Assignees", "assignees"],
  ["Referral Source", "referralSource"],
  ["Category", "category"],
  ["Tags", "tags"],
  ["Office Location", "officeLocation"],
  ["Opened", "opened"],
  ["Approved", "approved"],
  ["Submitted", "submitted"],
  ["Refused", "refused"],
  ["Created", "sourceCreated"],
  ["Other Contacts", "otherContacts"],
  ["Primary Address", "primaryAddress"],
  ["Phone", "phone"],
  ["Other Emails", "otherEmails"],
  ["Email", "email"],
  ["Modified", "modified"],
  ["Last Note", "lastNote"],
  ["Last Note Date", "lastNoteDate"],
  ["Prospect / Client", "prospectOrClient"],
  ["Foreign national arrival", "foreignNationalArrivalDate"],
  ["Resubmission", "resubmissionDate"],
  ["Extension submission", "extensionSubmissionDate"],
  ["Instructions sent", "instructionsSentDate"],
  ["Returned", "returnedDate"],
  ["Deferral received", "deferralReceivedDate"],
];

function fmtDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function PageHeader({ view, onViewChange, needsReviewTotal, totalContacts }) {
  return (
    <>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Data migration</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Case Easy Client Data</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Backup data imported from Case Easy. Nothing here becomes a real CaseDesk record until you explicitly convert it.
          {needsReviewTotal > 0 ? ` ${needsReviewTotal} record${needsReviewTotal === 1 ? "" : "s"} need manual review.` : ""}
        </p>
      </div>
      <div className="inline-flex w-fit rounded-full border border-slate-200 bg-white p-1 shadow-sm">
        <button type="button" onClick={() => onViewChange("import")} className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${view === "import" ? "bg-slate-950 text-white" : "text-slate-600 hover:text-slate-950"}`}>
          <UploadCloud className="h-4 w-4" /> Import files
        </button>
        <button type="button" onClick={() => onViewChange("contacts")} className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${view === "contacts" ? "bg-slate-950 text-white" : "text-slate-600 hover:text-slate-950"}`}>
          <UsersRound className="h-4 w-4" /> Clients & cases
          {totalContacts != null ? (
            <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${view === "contacts" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>
              {totalContacts}
            </span>
          ) : null}
        </button>
        <button type="button" onClick={() => onViewChange("reports")} className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${view === "reports" ? "bg-slate-950 text-white" : "text-slate-600 hover:text-slate-950"}`}>
          <BarChart3 className="h-4 w-4" /> Reports
        </button>
      </div>
    </>
  );
}

function CaseBadge({ kase }) {
  if (kase.importStatus === "converted") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Converted</span>;
  }
  if (kase.needsReviewReason) {
    const labels = (kase.needsReviewReasons?.length
      ? kase.needsReviewReasons
      : [kase.needsReviewReason]
    ).map((reason) => REVIEW_REASON_LABEL[reason] || "Needs review");
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
        <AlertTriangle className="h-3 w-3" /> {labels.join(" · ")}
      </span>
    );
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Linked</span>;
}

function ContactRow({ contact, expanded, onToggle, onConvert, selected, onToggleSelect }) {
  const needsReviewCount = contact.linkedCases.filter((kase) => kase.needsReviewReason && kase.importStatus !== "converted").length;
  const converted = contact.importStatus === "converted";
  // A contact converted in an earlier import can still gain new cases from
  // a later Cases file — resolveLinks links them to the contact right away,
  // but they aren't real Cases yet until pulled in here too.
  const pendingCases = contact.linkedCases.filter((kase) => kase.importStatus !== "converted");

  return (
    <div className={`rounded-3xl border bg-white shadow-sm ${selected ? "border-sky-300 ring-2 ring-sky-100" : "border-slate-200"}`}>
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
        {!converted ? (
          <input
            type="checkbox"
            checked={Boolean(selected)}
            onChange={(event) => { event.stopPropagation(); onToggleSelect(contact.id); }}
            onClick={(event) => event.stopPropagation()}
            className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 sm:mt-0"
            aria-label={`Select ${contact.firstName} ${contact.lastName} for bulk convert`}
          />
        ) : (
          <span className="hidden h-4 w-4 shrink-0 sm:block" />
        )}
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
          <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-slate-950">{contact.firstName} {contact.lastName}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${contact.recordType === "client" ? "bg-sky-50 text-sky-700" : contact.recordType === "prospect" ? "bg-violet-50 text-violet-700" : "bg-amber-50 text-amber-700"}`}>
              {contact.recordType || "undetermined"}
            </span>
            {converted ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Converted</span> : null}
            {needsReviewCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                <AlertTriangle className="h-3 w-3" /> {needsReviewCount} case{needsReviewCount === 1 ? "" : "s"} need review
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-sm text-slate-500">{contact.email || "No email"} · {contact.linkedCases.length} case{contact.linkedCases.length === 1 ? "" : "s"}</p>
          </div>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {converted ? (
            <>
              <Link to={`/app/clients/${contact.convertedClientId}`} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950" onClick={(event) => event.stopPropagation()}>
                View client <ExternalLink className="h-3 w-3" />
              </Link>
              {pendingCases.length > 0 ? (
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); onConvert(contact); }}
                  className="rounded-full bg-slate-950 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
                >
                  Import {pendingCases.length} new case{pendingCases.length === 1 ? "" : "s"}
                </button>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onConvert(contact); }}
              className="rounded-full bg-slate-950 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
            >
              Convert to CaseDesk Client
            </button>
          )}
        </div>
      </div>

      {expanded ? (
        <div className="space-y-2 border-t border-slate-100 px-5 py-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-500 sm:grid-cols-3">
            <div><dt className="font-semibold text-slate-400">Phone</dt><dd className="text-slate-700">{contact.phone || "—"}</dd></div>
            <div><dt className="font-semibold text-slate-400">UCI</dt><dd className="text-slate-700">{contact.uci || "—"}</dd></div>
            <div><dt className="font-semibold text-slate-400">Marital status</dt><dd className="text-slate-700">{contact.maritalStatus || "—"}</dd></div>
            <div><dt className="font-semibold text-slate-400">Country of residence</dt><dd className="text-slate-700">{contact.countryOfResidence || "—"}</dd></div>
            <div><dt className="font-semibold text-slate-400">NOC/TEER</dt><dd className="text-slate-700">{contact.nocTeer || "—"}</dd></div>
            <div><dt className="font-semibold text-slate-400">Referral source</dt><dd className="text-slate-700">{contact.referralSource || "—"}</dd></div>
            <div><dt className="font-semibold text-slate-400">Client Identifier</dt><dd className="text-slate-700">{contact.clientIdentifier || "—"}</dd></div>
            <div><dt className="font-semibold text-slate-400">Date of birth</dt><dd className="text-slate-700">{fmtDate(contact.dateOfBirth)}</dd></div>
          </dl>

          {contact.linkedCases.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {contact.linkedCases.map((kase) => (
                <div key={kase.id} className="rounded-2xl bg-slate-50 px-3.5 py-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800">{kase.caseNumber || "(no case number)"} · {kase.caseType || "Unknown type"}</span>
                    <CaseBadge kase={kase} />
                  </div>
                  <p className="mt-1 text-slate-500">
                    Status: {kase.status || "—"} · Assignees: {kase.assignees || "—"}
                    {kase.resolvedAssignee ? ` (matched: ${kase.resolvedAssignee.fullName})` : ""}
                  </p>
                  {kase.companyName || kase.category || kase.tags || kase.officeLocation ? (
                    <p className="mt-1 text-slate-400">
                      No CaseDesk field for: {[kase.companyName && `Company "${kase.companyName}"`, kase.category && `Category "${kase.category}"`, kase.tags && `Tags "${kase.tags}"`, kase.officeLocation && `Office "${kase.officeLocation}"`].filter(Boolean).join(", ")}
                    </p>
                  ) : null}
                  <details className="mt-2">
                    <summary className="cursor-pointer font-semibold text-slate-500">View all raw Case Easy fields</summary>
                    <dl className="mt-2 grid gap-x-4 gap-y-2 rounded-xl bg-white p-3 sm:grid-cols-2 lg:grid-cols-3">
                      {CASE_RAW_FIELDS.map(([label, field]) => (
                        <div key={field} className="min-w-0">
                          <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</dt>
                          <dd className="mt-0.5 break-words text-xs text-slate-700">
                            {field.toLowerCase().includes("date") || ["opened", "approved", "submitted", "refused", "modified", "sourceCreated"].includes(field)
                              ? fmtDate(kase[field])
                              : kase[field] || "—"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-400">No linked cases — this contact will convert as a prospect with no case.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ConversionModal({ contact, staff, onClose, onConverted }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [clientForm, setClientForm] = useState(null);
  const [caseForms, setCaseForms] = useState([]);
  const alreadyConverted = detail?.importStatus === "converted";

  useEffect(() => {
    let active = true;
    getCaseEasyImportContact(contact.id).then(({ contact: full, suggestedCases }) => {
      if (!active) return;
      setDetail(full);
      setClientForm({
        fullName: `${full.firstName || ""} ${full.lastName || ""}`.trim(),
        email: full.email || "",
        phone: full.phone || "",
        dateOfBirth: full.dateOfBirth ? full.dateOfBirth.slice(0, 10) : "",
        address: full.linkedCases.find((kase) => kase.primaryAddress)?.primaryAddress || "",
        preferredLanguage: "",
      });
      setCaseForms(full.linkedCases.map((kase) => {
        const suggested = suggestedCases.find((s) => s.caseEasyImportCaseId === kase.id) || {};
        return {
          caseEasyImportCaseId: kase.id,
          caseNumber: kase.caseNumber,
          include: kase.importStatus !== "converted",
          alreadyConverted: kase.importStatus === "converted",
          caseType: kase.caseType || "",
          stage: suggested.stage || "Lead",
          status: suggested.status || "Open",
          statusRecognized: suggested.recognized !== false,
          archived: suggested.archived || false,
          priority: "Normal",
          assignedUserId: kase.resolvedAssigneeUserId || "",
          nextAction: "Review imported Case Easy file",
          uci: kase.reportRows?.[0]?.uci || full.uci || "",
          maritalStatus: full.maritalStatus || "",
        };
      }));
      setLoading(false);
    }).catch((reason) => {
      if (active) { setError(reason.response?.data?.message || "Could not load this contact."); setLoading(false); }
    });
    return () => { active = false; };
  }, [contact.id]);

  function updateCaseForm(index, patch) {
    setCaseForms((current) => current.map((form, i) => {
      if (i !== index) return form;
      const next = { ...form, ...patch };
      if (
        Object.hasOwn(patch, "caseType") &&
        !caseStagesForType(next.caseType).includes(next.stage)
      ) {
        next.stage = "Retainer Pending";
      }
      return next;
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        client: clientForm,
        cases: caseForms.filter((form) => form.include && !form.alreadyConverted).map((form) => ({
          caseEasyImportCaseId: form.caseEasyImportCaseId,
          caseType: form.caseType,
          stage: form.stage,
          status: form.status,
          priority: form.priority,
          assignedUserId: form.assignedUserId || null,
          nextAction: form.nextAction || null,
          archived: form.archived,
          uci: form.uci || null,
          maritalStatus: form.maritalStatus || null,
        })),
      };
      const result = await convertCaseEasyImportContact(contact.id, payload);
      onConverted(result);
    } catch (reason) {
      setError(reason.response?.data?.message || "Conversion failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[260] bg-slate-950/24 p-3 backdrop-blur-md" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <form onSubmit={submit} className="mx-auto flex h-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.26)]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{alreadyConverted ? "Import new cases" : "Review before converting"}</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">{contact.firstName} {contact.lastName}</h2>
            <p className="mt-1 max-w-xl text-sm text-slate-500">
              {alreadyConverted
                ? "This contact is already a CaseDesk client. These cases arrived later and haven't been added yet — review and attach them to the existing client."
                : "Case Easy's export is often incomplete — fill in anything missing before this becomes a real CaseDesk client."}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-950 disabled:opacity-60" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-3">{[0, 1].map((key) => <div key={key} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}</div>
          ) : (
            <>
              {error ? <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

              {!alreadyConverted ? (
                <>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Client</h3>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-medium text-slate-700">
                      Full name
                      <input required value={clientForm.fullName} onChange={(event) => setClientForm((c) => ({ ...c, fullName: event.target.value }))} className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-slate-400" />
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      Email
                      <input type="email" value={clientForm.email} onChange={(event) => setClientForm((c) => ({ ...c, email: event.target.value }))} className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-slate-400" />
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      Phone
                      <input value={clientForm.phone} onChange={(event) => setClientForm((c) => ({ ...c, phone: event.target.value }))} className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-slate-400" />
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      Date of birth
                      <input type="date" value={clientForm.dateOfBirth} onChange={(event) => setClientForm((c) => ({ ...c, dateOfBirth: event.target.value }))} className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-slate-400" />
                    </label>
                    <label className="text-sm font-medium text-slate-700 sm:col-span-2">
                      Address
                      <input value={clientForm.address} onChange={(event) => setClientForm((c) => ({ ...c, address: event.target.value }))} className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-slate-400" />
                    </label>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl bg-sky-50 px-4 py-3 text-sm text-sky-700">
                  Client details are already set on the existing CaseDesk client and won't be changed here.
                </div>
              )}

              {caseForms.length > 0 ? (
                <div className="mt-6 space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Cases</h3>
                  {caseForms.map((form, index) => (
                    <div key={form.caseEasyImportCaseId} className={`rounded-2xl border px-4 py-3 ${form.alreadyConverted ? "border-slate-100 bg-slate-50 opacity-60" : "border-slate-200 bg-white"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-800">{form.caseNumber || "(no case number)"}</p>
                        {form.alreadyConverted ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Already converted</span>
                        ) : (
                          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                            <input type="checkbox" checked={form.include} onChange={(event) => updateCaseForm(index, { include: event.target.checked })} />
                            Include in conversion
                          </label>
                        )}
                      </div>
                      {!form.alreadyConverted && form.include ? (
                        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                          {!form.statusRecognized ? (
                            <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:col-span-2">
                              Case Easy status was not recognized. Confirm the CaseDesk stage and status before converting.
                            </div>
                          ) : null}
                          <label className="text-xs font-medium text-slate-600">
                            Case type
                            <input required value={form.caseType} onChange={(event) => updateCaseForm(index, { caseType: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400" />
                          </label>
                          <label className="text-xs font-medium text-slate-600">
                            Assignee
                            <Select className="mt-1 w-full" value={form.assignedUserId} onChange={(event) => updateCaseForm(index, { assignedUserId: event.target.value })}>
                              <option value="">Unassigned</option>
                              {staff.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}
                            </Select>
                          </label>
                          <label className="text-xs font-medium text-slate-600">
                            Stage
                            <Select value={form.stage} onChange={(event) => updateCaseForm(index, { stage: event.target.value })} className="mt-1 w-full">
                              {caseStagesForType(form.caseType).map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                            </Select>
                          </label>
                          <label className="text-xs font-medium text-slate-600">
                            Status
                            <Select value={form.status} onChange={(event) => updateCaseForm(index, { status: event.target.value })} className="mt-1 w-full">
                              {CASE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                            </Select>
                          </label>
                          <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                            Next action
                            <input required value={form.nextAction} onChange={(event) => updateCaseForm(index, { nextAction: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400" />
                          </label>
                          <label className="text-xs font-medium text-slate-600">
                            UCI
                            <input value={form.uci} onChange={(event) => updateCaseForm(index, { uci: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400" />
                          </label>
                          <label className="text-xs font-medium text-slate-600">
                            Marital status
                            <input value={form.maritalStatus} onChange={(event) => updateCaseForm(index, { maritalStatus: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400" />
                          </label>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-60">
            Cancel
          </button>
          <button type="submit" disabled={saving || loading} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
            {saving ? (alreadyConverted ? "Importing…" : "Converting…") : alreadyConverted ? "Import cases" : "Convert to CaseDesk Client"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function CaseEasyImport() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [contacts, setContacts] = useState([]);
  const [unlinkedCases, setUnlinkedCases] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [recordType, setRecordType] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [convertingContact, setConvertingContact] = useState(null);
  const [notice, setNotice] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkConverting, setBulkConverting] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkError, setBulkError] = useState("");
  const [view, setView] = useState("contacts");
  const [searchInput, setSearchInput] = useState(
    searchParams.get("search") || "",
  );
  const search = searchParams.get("search") || "";

  useEffect(() => {
    const requestedView = searchParams.get("view");
    if (["import", "contacts", "reports"].includes(requestedView)) {
      setView(requestedView);
    }
    const requestedContact = searchParams.get("contact");
    if (requestedContact) {
      setExpandedId(requestedContact);
      setRecordType("");
      setImportStatus("");
    }
  }, [searchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const normalized = searchInput.trim();
      if (normalized === search) return;
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (normalized) next.set("search", normalized);
        else next.delete("search");
        next.set("view", "contacts");
        next.delete("contact");
        return next;
      }, { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, search, setSearchParams]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [data, unlinked] = await Promise.all([
        getCaseEasyImportContacts({
          recordType: recordType || undefined,
          importStatus: importStatus || undefined,
          search: search || undefined,
        }),
        getUnlinkedCaseEasyImportCases({ search: search || undefined }),
      ]);
      setContacts(data);
      setUnlinkedCases(unlinked);
    } catch (reason) {
      setError(reason.response?.data?.message || "Could not load Case Easy import data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [recordType, importStatus, search]);
  // Selection is scoped to whatever's currently visible — changing a filter
  // implicitly changes the working set, so stale ids from a previous filter
  // shouldn't silently carry into the next bulk convert.
  useEffect(() => { setSelectedIds(new Set()); }, [recordType, importStatus, search]);

  const convertibleContacts = useMemo(() => contacts.filter((contact) => contact.importStatus !== "converted"), [contacts]);
  const allVisibleSelected = convertibleContacts.length > 0 && convertibleContacts.every((contact) => selectedIds.has(contact.id));

  function toggleSelect(contactId) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((current) => {
      if (allVisibleSelected) return new Set();
      return new Set(convertibleContacts.map((contact) => contact.id));
    });
  }

  async function runBulkConvert() {
    if (!selectedIds.size) return;
    if (
      !window.confirm(
        `Convert ${selectedIds.size} selected contact${selectedIds.size === 1 ? "" : "s"} to CaseDesk clients? Every linked case will use CaseDesk's suggested stage/status automatically — review individual records afterward if anything looks off.`,
      )
    ) {
      return;
    }
    setBulkConverting(true);
    setBulkError("");
    setBulkResult(null);
    try {
      const idsToConvert = [...selectedIds];
      // The backend caps a single call at 200 to keep each transaction batch
      // bounded — chunk larger selections client-side rather than raising
      // that cap, so one huge selection can't tie up a single request.
      const chunkSize = 100;
      const combined = { requested: 0, converted: 0, skippedDuplicate: 0, alreadyConverted: 0, failed: 0, results: [] };
      for (let index = 0; index < idsToConvert.length; index += chunkSize) {
        const chunk = idsToConvert.slice(index, index + chunkSize);
        const result = await bulkConvertCaseEasyImportContacts(chunk);
        combined.requested += result.requested;
        combined.converted += result.converted;
        combined.skippedDuplicate += result.skippedDuplicate;
        combined.alreadyConverted += result.alreadyConverted;
        combined.failed += result.failed;
        combined.results.push(...result.results);
      }
      setBulkResult(combined);
      setSelectedIds(new Set());
      load();
    } catch (reason) {
      setBulkError(reason.response?.data?.message || "Bulk conversion failed.");
    } finally {
      setBulkConverting(false);
    }
  }
  // /leads/staff includes front desk (valid for lead ownership), but a case
  // can only ever be assigned to an admin or consultant (validateCaseAssignee
  // in caseController.js) — filtering here keeps front desk from ever being
  // picked or auto-matched as a case assignee during conversion.
  useEffect(() => { api.get("/leads/staff").then((response) => setStaff((response.data.data || []).filter((person) => ["admin", "consultant"].includes(person.role)))).catch(() => {}); }, []);

  const needsReviewTotal = useMemo(
    () => unlinkedCases.length + contacts.reduce((sum, contact) => sum + contact.linkedCases.filter((kase) => kase.needsReviewReason && kase.importStatus !== "converted").length, 0),
    [contacts, unlinkedCases],
  );

  if (view === "import") {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6 px-1 py-1">
        <PageHeader view={view} onViewChange={setView} needsReviewTotal={needsReviewTotal} totalContacts={contacts.length} />
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <CaseEasyImportSettingsPanel />
        </section>
      </div>
    );
  }

  if (view === "reports") {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6 px-1 py-1">
        <PageHeader view={view} onViewChange={setView} needsReviewTotal={needsReviewTotal} totalContacts={contacts.length} />
        <CaseEasyReportsBrowser />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-1 py-1">
      <PageHeader view={view} onViewChange={setView} needsReviewTotal={needsReviewTotal} totalContacts={contacts.length} />

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search name, client/case number, email, or phone"
            className="h-10 w-full rounded-full border border-slate-200 bg-white pl-10 pr-10 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
          />
          {searchInput ? (
            <button type="button" onClick={() => setSearchInput("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Clear Case Easy search">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
        <Select value={recordType} onChange={(event) => setRecordType(event.target.value)} className="w-40">
          {RECORD_TYPE_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        <Select value={importStatus} onChange={(event) => setImportStatus(event.target.value)} className="w-44">
          {IMPORT_STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
        <p className="text-xs font-medium text-slate-500">
          {loading ? "Loading…" : `${contacts.length} contact${contacts.length === 1 ? "" : "s"}${recordType || importStatus || search ? " matching filters" : ""}`}
        </p>
      </div>

      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</div> : null}
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div> : null}

      {!loading && unlinkedCases.length ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <h2 className="text-sm font-semibold text-amber-950">Cases without a matched contact</h2>
              <p className="mt-1 text-xs leading-5 text-amber-800">
                These rows remain safely staged, but cannot be converted until a matching Contacts export or Client Listing identifier resolves them.
              </p>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {unlinkedCases.map((kase) => (
              <div key={kase.id} className="rounded-2xl border border-amber-200/80 bg-white px-3.5 py-3">
                <p className="text-sm font-semibold text-slate-900">{kase.caseNumber || "(no case number)"} · {kase.caseType || "Unknown type"}</p>
                <p className="mt-1 text-xs text-slate-500">{[kase.firstName, kase.lastName].filter(Boolean).join(" ") || "No applicant name"} · {kase.email || "No email"}</p>
                <p className="mt-1 text-[11px] font-medium text-amber-700">
                  {(kase.needsReviewReasons?.length ? kase.needsReviewReasons : [kase.needsReviewReason])
                    .filter(Boolean)
                    .map((reason) => REVIEW_REASON_LABEL[reason] || "Needs review")
                    .join(" · ") || "Contact match required"}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {bulkError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{bulkError}</div> : null}
      {bulkResult ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Bulk convert results</h2>
              <p className="mt-1 text-xs text-slate-500">
                {bulkResult.converted} converted · {bulkResult.skippedDuplicate} skipped as likely duplicates · {bulkResult.alreadyConverted} already converted · {bulkResult.failed} failed, of {bulkResult.requested} selected.
              </p>
            </div>
            <button type="button" onClick={() => setBulkResult(null)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Dismiss results">
              <X className="h-4 w-4" />
            </button>
          </div>
          {bulkResult.skippedDuplicate || bulkResult.failed ? (
            <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto rounded-2xl bg-slate-50 p-3">
              {bulkResult.results.filter((row) => row.status === "skipped_duplicate" || row.status === "failed").map((row) => (
                <p key={row.contactId} className="text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">{row.name}</span> — {row.status === "skipped_duplicate" ? "possible duplicate: " : "failed: "}
                  {row.message}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((key) => <div key={key} className="h-20 animate-pulse rounded-3xl bg-slate-100" />)}</div>
      ) : contacts.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
          No imported Case Easy contacts match this filter. Run the import script to bring data in.
        </div>
      ) : (
        <>
          {convertibleContacts.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-2.5">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} className="h-4 w-4 rounded border-slate-300" />
                Select all {convertibleContacts.length} unconverted contact{convertibleContacts.length === 1 ? "" : "s"} shown
              </label>
              {selectedIds.size > 0 ? (
                <>
                  <span className="text-xs text-slate-400">{selectedIds.size} selected</span>
                  <button
                    type="button"
                    onClick={runBulkConvert}
                    disabled={bulkConverting}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {bulkConverting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
                    {bulkConverting ? "Converting…" : `Convert ${selectedIds.size} selected`}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-3">
            {contacts.map((contact) => (
              <ContactRow
                key={contact.id}
                contact={contact}
                expanded={expandedId === contact.id}
                onToggle={() => setExpandedId((current) => (current === contact.id ? null : contact.id))}
                onConvert={setConvertingContact}
                selected={selectedIds.has(contact.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        </>
      )}

      {convertingContact ? (
        <ConversionModal
          contact={convertingContact}
          staff={staff}
          onClose={() => setConvertingContact(null)}
          onConverted={(result) => {
            setConvertingContact(null);
            setNotice(`${result.client.fullName} — ${result.cases.length} case${result.cases.length === 1 ? "" : "s"} added.`);
            load();
          }}
        />
      ) : null}
    </div>
  );
}
