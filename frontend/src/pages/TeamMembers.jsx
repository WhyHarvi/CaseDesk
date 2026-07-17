import { Check, Copy, KeyRound, Plus, ShieldOff, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import { fieldClass, FormField, FormMessage } from "../components/auth/AuthShell";

const ROLE_OPTIONS = [
  { value: "consultant", label: "Consultant" },
  { value: "frontdesk", label: "Front Desk" },
];

const ROLE_FILTERS = [
  { value: "", label: "All members" },
  { value: "consultant", label: "Consultants" },
  { value: "frontdesk", label: "Front Desk" },
];

const roleBadge = {
  consultant: "bg-sky-50 text-sky-700",
  frontdesk: "bg-violet-50 text-violet-700",
};

const statusBadge = {
  active: "bg-emerald-50 text-emerald-700",
  invited: "bg-sky-50 text-sky-700",
  disabled: "bg-slate-100 text-slate-500",
};

const knownErrors = {
  INVITATION_RATE_LIMITED: "The invitation email limit was reached. Wait a few minutes and try again — when possible a secure link is generated so you can send it directly.",
  INVITATION_REDIRECT_NOT_CONFIGURED: "The invitation callback URL is not configured in the authentication provider. Configure it before inviting more members.",
  AUTH_INVITATION_FAILED: "The invitation could not be sent right now. Please try again shortly.",
  ACCOUNT_EXISTS: "An account with this email already exists.",
  AUTH_ACCOUNT_EXISTS: "An authentication account with this email already exists.",
  ROLE_CHANGE_NOT_ALLOWED: "Roles cannot be changed after creation. Invite a new account with the desired role instead.",
};

function apiError(reason, fallback) {
  const code = reason.response?.data?.code;
  if (code === "ACTIVE_ASSIGNMENTS") return reason.response?.data?.message || "Reassign this member's open work before disabling the account.";
  return knownErrors[code] || reason.response?.data?.message || fallback;
}

const emptyForm = {
  role: "consultant",
  fullName: "",
  email: "",
  phone: "",
  jobTitle: "",
  employeeId: "",
  specializations: "",
  masteryLevel: "",
  maximumActiveCases: 20,
};

function formFromMember(member) {
  const profile = member.consultantProfiles?.[0];
  return {
    role: member.role,
    fullName: member.fullName || "",
    email: member.email || "",
    phone: member.phone || "",
    jobTitle: member.jobTitle || "",
    employeeId: profile?.employeeId || "",
    specializations: (profile?.specializations || []).join(", "),
    masteryLevel: profile?.masteryLevel || "",
    maximumActiveCases: profile?.maximumActiveCases ?? 20,
  };
}

function memberPayload(form, { creating = false } = {}) {
  return {
    role: form.role,
    fullName: form.fullName,
    ...(creating ? { email: form.email } : {}),
    phone: form.phone,
    jobTitle: form.jobTitle,
    ...(form.role === "consultant"
      ? {
          employeeId: form.employeeId,
          specializations: form.specializations.split(",").map((item) => item.trim()).filter(Boolean),
          masteryLevel: form.masteryLevel,
          maximumActiveCases: Number(form.maximumActiveCases),
        }
      : {}),
  };
}

function MemberFormFields({ form, update, creating }) {
  return (
    <>
      <div className="sm:col-span-2">
        <FormField label="Role" hint={creating ? undefined : "Roles cannot be changed after creation."}>
          <select className={fieldClass} value={form.role} onChange={update("role")} disabled={!creating}>
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <FormField label="Full name">
          <input className={fieldClass} value={form.fullName} onChange={update("fullName")} autoComplete="name" required />
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <FormField label="Work email">
          <input className={fieldClass} value={form.email} onChange={update("email")} type="email" autoComplete="email" required disabled={!creating} />
        </FormField>
      </div>
      <FormField label="Phone" hint="Optional">
        <input className={fieldClass} value={form.phone} onChange={update("phone")} autoComplete="tel" />
      </FormField>
      <FormField label="Job title" hint="Optional">
        <input className={fieldClass} value={form.jobTitle} onChange={update("jobTitle")} placeholder={form.role === "frontdesk" ? "Front Desk Coordinator" : "Immigration Consultant"} />
      </FormField>
      {form.role === "consultant" ? (
        <>
          <FormField label="Employee ID" hint="Optional">
            <input className={fieldClass} value={form.employeeId} onChange={update("employeeId")} />
          </FormField>
          <FormField label="Active case capacity">
            <input className={fieldClass} value={form.maximumActiveCases} onChange={update("maximumActiveCases")} type="number" min="1" max="500" required />
          </FormField>
          <FormField label="Mastery level" hint="Optional">
            <input className={fieldClass} value={form.masteryLevel} onChange={update("masteryLevel")} placeholder="Senior" />
          </FormField>
          <FormField label="Specializations" hint="Comma separated">
            <input className={fieldClass} value={form.specializations} onChange={update("specializations")} placeholder="Express Entry, Work Permits" />
          </FormField>
        </>
      ) : null}
    </>
  );
}

export default function TeamMembers() {
  const [items, setItems] = useState([]);
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState(emptyForm);
  const [manualLink, setManualLink] = useState("");
  const [copied, setCopied] = useState(false);

  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [modalError, setModalError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return api
      .get(`/admin/team-members${roleFilter ? `?role=${roleFilter}` : ""}`)
      .then(({ data }) => { setItems(data.data); setError(""); })
      .catch((reason) => setError(apiError(reason, "Team members could not be loaded.")))
      .finally(() => setLoading(false));
  }, [roleFilter]);
  useEffect(() => { load(); }, [load]);

  const updateForm = (setter) => (field) => (event) => setter((current) => ({ ...current, [field]: event.target.value }));
  const updateInvite = updateForm(setInviteForm);
  const updateEdit = updateForm(setEditForm);

  function openInvite() {
    setInviteForm(emptyForm);
    setModalError("");
    setManualLink("");
    setCopied(false);
    setInviteOpen(true);
  }

  function openEdit(member) {
    setEditing(member);
    setEditForm(formFromMember(member));
    setModalError("");
    setNotice("");
  }

  async function invite(event) {
    event.preventDefault();
    setSaving(true);
    setModalError("");
    try {
      const { data } = await api.post("/admin/team-members", memberPayload(inviteForm, { creating: true }));
      await load();
      if (data.manualInvitationLink) {
        setManualLink(data.manualInvitationLink);
      } else {
        setInviteOpen(false);
        setNotice(data.message || "Team member invitation sent.");
      }
    } catch (reason) {
      setModalError(apiError(reason, "The team member could not be invited."));
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    setSaving(true);
    setModalError("");
    try {
      const { data } = await api.patch(`/admin/team-members/${editing.id}`, memberPayload(editForm));
      await load();
      setEditing(null);
      setNotice(data.message || `${data.data.fullName} updated.`);
    } catch (reason) {
      setModalError(apiError(reason, "The team member could not be updated."));
    } finally {
      setSaving(false);
    }
  }

  async function disableMember() {
    if (!window.confirm(`Disable ${editing.fullName}? They will immediately lose access to CaseDesk.`)) return;
    setSaving(true);
    setModalError("");
    try {
      const { data } = await api.post(`/admin/team-members/${editing.id}/disable`);
      await load();
      setEditing(null);
      setNotice(data.message || "Team member disabled.");
    } catch (reason) {
      setModalError(apiError(reason, "The team member could not be disabled."));
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword() {
    setSaving(true);
    setModalError("");
    try {
      const { data } = await api.post(`/admin/team-members/${editing.id}/reset-password`);
      setNotice(data.message || "Password recovery email sent.");
      setEditing(null);
    } catch (reason) {
      setModalError(apiError(reason, "The password recovery email could not be sent."));
    } finally {
      setSaving(false);
    }
  }

  return <section>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Team Members</h1>
        <p className="mt-2 text-slate-500">Invite consultants, front desk, and other team members, and manage their access to your workspace.</p>
      </div>
      <button onClick={openInvite} className="flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-200 transition hover:-translate-y-0.5 hover:bg-slate-800"><Plus className="h-4 w-4" /> Invite member</button>
    </div>

    <div className="mt-6 flex flex-wrap gap-2">
      {ROLE_FILTERS.map((filter) => (
        <button
          key={filter.value}
          type="button"
          onClick={() => setRoleFilter(filter.value)}
          className={`h-10 rounded-full px-4 text-sm font-semibold transition ${roleFilter === filter.value ? "bg-slate-950 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
        >
          {filter.label}
        </button>
      ))}
    </div>

    {notice ? <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</div> : null}
    {error ? <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div> : null}

    <div className="mt-8 grid gap-4 md:grid-cols-2">
      {items.map((item) => {
        const profile = item.consultantProfiles?.[0];
        return (
          <button key={item.id} type="button" onClick={() => openEdit(item)} className="rounded-3xl border border-white bg-white/80 p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate font-semibold">{item.fullName}</h2>
                <p className="mt-1 truncate text-sm text-slate-500">{item.email}</p>
              </div>
              <div className="flex h-fit shrink-0 items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${roleBadge[item.role] || "bg-slate-100 text-slate-600"}`}>{item.role === "frontdesk" ? "Front Desk" : "Consultant"}</span>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge[item.status] || "bg-slate-100 text-slate-500"}`}>{item.status}</span>
              </div>
            </div>
            <p className="mt-5 text-sm text-slate-600">{item.jobTitle || (item.role === "frontdesk" ? "Front Desk" : "Consultant")}{item.phone ? ` · ${item.phone}` : ""}</p>
            {item.role === "consultant" ? (
              <>
                <p className="mt-2 text-sm text-slate-600">Capacity: {profile?.maximumActiveCases ?? 20} active cases{profile?.masteryLevel ? ` · ${profile.masteryLevel}` : ""}</p>
                <p className="mt-2 text-sm text-slate-500">{profile?.specializations?.length ? profile.specializations.join(" · ") : "No specializations set"}</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Handles reception, lead intake, and scheduling.</p>
            )}
          </button>
        );
      })}
    </div>

    {loading ? <div className="mt-8 grid gap-4 md:grid-cols-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-3xl bg-slate-100" />)}</div> : null}
    {!loading && !items.length && !error ? (
      <div className="mt-8 rounded-3xl border border-dashed border-slate-200 bg-white/60 px-6 py-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><UserRound className="h-5 w-5" /></div>
        <p className="mt-4 font-medium text-slate-700">No team members yet</p>
        <p className="mt-1 text-sm text-slate-400">Invite your first team member when you’re ready.</p>
      </div>
    ) : null}

    {inviteOpen ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/25 px-5 py-10 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setInviteOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="invite-title" className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[2rem] border border-white bg-white p-6 shadow-2xl sm:p-8">
          <div className="flex items-start justify-between">
            <div>
              <h2 id="invite-title" className="text-2xl font-semibold tracking-tight">{manualLink ? "Member created" : "Invite team member"}</h2>
              <p className="mt-2 text-sm text-slate-500">{manualLink ? "Email delivery is temporarily limited. Send this one-time setup link directly to the new member." : "They’ll receive a secure link to create their password."}</p>
            </div>
            <button onClick={() => { setInviteOpen(false); setManualLink(""); setCopied(false); }} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
          {manualLink ? (
            <div className="mt-7">
              <div className="break-all rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-600">{manualLink}</div>
              <button onClick={async () => { await navigator.clipboard.writeText(manualLink); setCopied(true); }} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy secure link"}</button>
              <p className="mt-4 text-center text-xs leading-5 text-slate-400">Treat this link like a password. Share it only with the intended team member.</p>
            </div>
          ) : (
            <form onSubmit={invite} className="mt-7 grid gap-5 sm:grid-cols-2">
              <MemberFormFields form={inviteForm} update={updateInvite} creating />
              {modalError ? <div className="sm:col-span-2"><FormMessage error>{modalError}</FormMessage></div> : null}
              <button type="button" onClick={() => setInviteOpen(false)} className="rounded-2xl px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-100">Cancel</button>
              <button disabled={saving} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{saving ? "Sending…" : "Send invitation"}</button>
            </form>
          )}
        </section>
      </div>
    ) : null}

    {editing ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/25 px-5 py-10 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditing(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="edit-member-title" className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[2rem] border border-white bg-white p-6 shadow-2xl sm:p-8">
          <div className="flex items-start justify-between">
            <div>
              <h2 id="edit-member-title" className="text-2xl font-semibold tracking-tight">Edit team member</h2>
              <p className="mt-2 text-sm text-slate-500">{editing.email}</p>
            </div>
            <button onClick={() => setEditing(null)} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={saveEdit} className="mt-7 grid gap-5 sm:grid-cols-2">
            <MemberFormFields form={editForm} update={updateEdit} creating={false} />
            {modalError ? <div className="sm:col-span-2"><FormMessage error>{modalError}</FormMessage></div> : null}
            <button type="button" onClick={() => setEditing(null)} className="rounded-2xl px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-100">Cancel</button>
            <button disabled={saving} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{saving ? "Saving…" : "Save changes"}</button>
          </form>
          <div className="mt-6 flex flex-col gap-2 border-t border-slate-100 pt-5 sm:flex-row">
            <button type="button" disabled={saving} onClick={resetPassword} className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"><KeyRound className="h-4 w-4" />Send password reset</button>
            {editing.status !== "disabled" ? (
              <button type="button" disabled={saving} onClick={disableMember} className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-rose-200 px-4 py-3 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"><ShieldOff className="h-4 w-4" />Disable member</button>
            ) : null}
          </div>
        </section>
      </div>
    ) : null}
  </section>;
}
