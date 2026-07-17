import {
  Building2,
  CreditCard,
  Bell,
  FileText,
  History,
  Lock,
  Mail,
  MessagesSquare,
  PhoneCall,
  ShieldCheck,
  UserRound,
  Users,
  Workflow,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import api from "../services/api";
import AgencyMailSettingsPanel from "../components/settings/AgencyMailSettingsPanel";
import AgencyProfilePanel from "../components/settings/AgencyProfilePanel";
import AgencyOomaSettingsPanel from "../components/settings/AgencyOomaSettingsPanel";
import CommunicationSettingsPanel from "../components/settings/CommunicationSettingsPanel";

const adminSettingsItems = [
  {
    id: "agency-profile",
    label: "Workspace Profile",
    icon: Building2,
    title: "Workspace Profile",
    subtitle:
      "Update your workspace identity, contact details, and regional settings.",
  },
  {
    id: "agency-email",
    label: "Workspace Email",
    icon: Mail,
    title: "Workspace Email",
    subtitle: "Connect the mailbox used to send client communication.",
  },
  {
    id: "agency-phone",
    label: "Phone & SMS",
    icon: PhoneCall,
    title: "Workspace Phone & SMS",
    subtitle: "Connect Ooma Enterprise for client calls and text messages.",
  },
  {
    id: "communication-controls",
    label: "Communication",
    icon: MessagesSquare,
    title: "Communication Controls",
    subtitle:
      "Manage team permissions, retention, and sensitive client communication.",
  },
  {
    id: "users-roles",
    label: "Users & Roles",
    icon: Users,
    title: "Users & Roles",
    subtitle: "Manage team access, permissions, and role-based controls.",
  },
  {
    id: "case-workflow",
    label: "Case Workflow",
    icon: Workflow,
    title: "Case Workflow",
    subtitle:
      "Configure intake stages, review steps, and operational workflows.",
  },
  {
    id: "document-templates",
    label: "Document Templates",
    icon: FileText,
    title: "Document Templates",
    subtitle:
      "Organize reusable templates for case documents and workspace forms.",
  },
  {
    id: "payments-fees",
    label: "Payments & Fees",
    icon: CreditCard,
    title: "Payments & Fees",
    subtitle: "Set defaults for billing, invoices, and fee preferences.",
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    title: "Notifications",
    subtitle: "Control reminders, alerts, and communication preferences.",
  },
  {
    id: "security",
    label: "Security",
    icon: Lock,
    title: "Security",
    subtitle:
      "Review authentication, password, and account protection settings.",
  },
  {
    id: "activity-logs",
    label: "Activity Logs",
    icon: History,
    title: "Activity Logs",
    subtitle: "Review recent system activity, changes, and audit history.",
  },
];

const consultantSettingsItems = [
  {
    id: "personal-profile",
    label: "My Profile",
    icon: UserRound,
    title: "My Profile",
    subtitle: "Review the account and workspace details attached to your login.",
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    title: "Notifications",
    subtitle: "Control your personal reminders and alert preferences.",
  },
  {
    id: "security",
    label: "Security",
    icon: Lock,
    title: "Security",
    subtitle: "Manage your password and protect your CaseDesk account.",
  },
];

function PlaceholderPanel({ item }) {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
            {item.title}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            {item.subtitle}
          </p>
        </div>
      </div>

      <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10">
        <p className="text-sm font-medium text-slate-700">
          No configuration added yet.
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Use this section to manually test your own settings data once it is
          connected.
        </p>
      </div>
    </div>
  );
}

function PersonalProfilePanel({ user, agency }) {
  const { refreshIdentity } = useAuth();
  const [profile, setProfile] = useState({
    fullName: user?.fullName || "",
    email: user?.email || "",
    phone: user?.phone || "",
    jobTitle: user?.jobTitle || "",
    specializations: [],
    hasAvatar: Boolean(user?.hasAvatar),
    stats: { clients: 0, activeCases: 0, openFollowUps: 0 },
  });
  const [form, setForm] = useState({ phone: user?.phone || "", jobTitle: user?.jobTitle || "", specializations: "" });
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarPreview, setAvatarPreview] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    async function load() {
      try {
        const response = await api.get("/consultants/me/profile");
        if (!active) return;
        const data = response.data.data;
        setProfile(data);
        setForm({ phone: data.phone || "", jobTitle: data.jobTitle || "", specializations: data.specializations.join(", ") });
        if (data.hasAvatar) {
          const avatarResponse = await api.get("/consultants/me/avatar", { responseType: "blob" });
          if (!active) return;
          objectUrl = URL.createObjectURL(avatarResponse.data);
          setAvatarUrl(objectUrl);
        }
      } catch (reason) {
        if (active) setError(reason.response?.data?.message || "Your profile could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  function selectAvatar(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Profile images must be 5 MB or smaller.");
      return;
    }
    setAvatarFile(file);
    setError("");
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(String(reader.result || ""));
    reader.readAsDataURL(file);
  }

  function closeEditor() {
    if (saving) return;
    setForm({
      phone: profile.phone || "",
      jobTitle: profile.jobTitle || "",
      specializations: (profile.specializations || []).join(", "),
    });
    setAvatarFile(null);
    setAvatarPreview("");
    setError("");
    setEditing(false);
  }

  useEffect(() => {
    if (!editing) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") closeEditor();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [editing, saving, profile]);

  async function saveProfile(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const data = new FormData();
      data.append("phone", form.phone);
      data.append("jobTitle", form.jobTitle);
      data.append("specializations", JSON.stringify(form.specializations.split(",").map((item) => item.trim()).filter(Boolean)));
      if (avatarFile) data.append("avatar", avatarFile);
      const response = await api.patch("/consultants/me/profile", data);
      setProfile(response.data.data);
      if (avatarPreview) setAvatarUrl(avatarPreview);
      setAvatarFile(null);
      setAvatarPreview("");
      setNotice("Profile updated successfully.");
      setEditing(false);
      await refreshIdentity();
    } catch (reason) {
      setError(reason.response?.data?.message || "Your profile could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  async function removeAvatar() {
    setSaving(true);
    setError("");
    try {
      await api.delete("/consultants/me/avatar");
      setAvatarFile(null);
      setAvatarPreview("");
      setAvatarUrl("");
      setProfile((current) => ({ ...current, hasAvatar: false }));
      setNotice("Profile image removed.");
      await refreshIdentity();
    } catch (reason) {
      setError(reason.response?.data?.message || "The profile image could not be removed.");
    } finally {
      setSaving(false);
    }
  }

  const displayedAvatar = avatarPreview || avatarUrl;
  const initials = (profile.fullName || "Consultant").split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  const stats = [
    { label: "clients", value: profile.stats?.clients || 0 },
    { label: "active cases", value: profile.stats?.activeCases || 0 },
    { label: "follow-ups", value: profile.stats?.openFollowUps || 0 },
  ];

  return (
    <div className="mx-auto max-w-[935px]">
      {error ? <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div> : null}
      {notice ? <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</div> : null}

      <header className="grid gap-8 border-b border-slate-200 pb-10 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-10 lg:grid-cols-[290px_minmax(0,1fr)]">
        <div className="flex justify-center sm:pt-2">
          <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-3xl font-semibold text-slate-700 shadow-[0_20px_45px_rgba(15,23,42,0.15)] ring-4 ring-white sm:h-40 sm:w-40">
            {displayedAvatar ? <img src={displayedAvatar} alt={`${profile.fullName} profile`} className="h-full w-full rounded-full object-cover" /> : initials}
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="truncate text-xl font-normal text-slate-950">{profile.fullName || "Consultant"}</h2>
            <button type="button" disabled={loading} onClick={() => setEditing(true)} className="h-9 rounded-lg bg-slate-100 px-5 text-sm font-semibold text-slate-900 transition hover:bg-slate-200 disabled:opacity-50">Edit profile</button>
          </div>

          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm text-slate-700 sm:text-base">
            {stats.map((item) => <span key={item.label}><strong className="font-semibold text-slate-950">{item.value}</strong> {item.label}</span>)}
          </div>

          <div className="mt-7 text-sm leading-6">
            <p className="font-semibold text-slate-950">{profile.jobTitle || "Immigration Consultant"}</p>
            <p className="text-slate-600">{agency?.name || "CaseDesk agency"}</p>
            <p className="mt-1 text-slate-500">{profile.email}{profile.phone ? ` · ${profile.phone}` : ""}</p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {profile.specializations?.length ? profile.specializations.map((specialty) => <span key={specialty} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">{specialty}</span>) : <span className="text-sm text-slate-400">Add specialties to complete your profile.</span>}
          </div>
        </div>
      </header>

      <div className="flex justify-center border-b border-slate-200">
        <div className="-mb-px border-t border-slate-950 px-5 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-950">Profile details</div>
      </div>

      <section className="mt-8 overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-[0_12px_35px_rgba(15,23,42,0.04)]">
        {[
          { icon: UserRound, label: "Professional title", value: profile.jobTitle },
          { icon: PhoneCall, label: "Phone", value: profile.phone },
          { icon: Mail, label: "Email", value: profile.email },
        ].map((row) => {
          const RowIcon = row.icon;
          return (
            <div
              key={row.label}
              className="grid min-h-[60px] grid-cols-1 gap-1 border-b border-slate-100 px-5 py-4 transition duration-200 last:border-b-0 hover:bg-slate-50/80 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center sm:gap-6"
            >
              <div className="flex items-center gap-2.5 text-[14px] font-medium text-slate-500">
                <RowIcon className="h-4 w-4 text-slate-400" />
                {row.label}
              </div>
              <div className={`text-[14px] font-medium sm:text-[15px] ${row.value ? "text-slate-950" : "text-slate-400"}`}>
                {row.value || "Not added"}
              </div>
            </div>
          );
        })}
        <div className="grid grid-cols-1 gap-1 border-t border-slate-100 px-5 py-4 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center sm:gap-6">
          <div className="flex items-center gap-2.5 text-[14px] font-medium text-slate-500">
            <ShieldCheck className="h-4 w-4 text-slate-400" />
            Specialties
          </div>
          <div className="flex flex-wrap gap-2">
            {profile.specializations?.length ? (
              profile.specializations.map((specialty) => (
                <span key={specialty} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                  {specialty}
                </span>
              ))
            ) : (
              <span className="text-[14px] font-medium text-slate-400">None listed</span>
            )}
          </div>
        </div>
      </section>

      {editing ? createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" role="presentation" onMouseDown={closeEditor}>
          <form onSubmit={saveProfile} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="edit-profile-title" className="flex max-h-[94dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[24px] bg-white shadow-[0_30px_100px_rgba(15,23,42,0.35)] sm:max-h-[88vh] sm:rounded-[20px]">
            <div className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-slate-200 px-5">
              <button type="button" disabled={saving} onClick={closeEditor} className="justify-self-start text-sm text-slate-600 transition hover:text-slate-950 disabled:opacity-50">Cancel</button>
              <h3 id="edit-profile-title" className="font-semibold text-slate-950">Edit profile</h3>
              <button disabled={saving} className="justify-self-end text-sm font-semibold text-sky-600 disabled:opacity-50">{saving ? "Saving…" : "Done"}</button>
            </div>

            <div className="min-h-0 overflow-y-auto overscroll-contain">
            <div className="flex items-center gap-4 bg-slate-50 px-6 py-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 font-semibold text-slate-700">{displayedAvatar ? <img src={displayedAvatar} alt="Profile preview" className="h-full w-full object-cover" /> : initials}</div>
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-950">{profile.fullName}</p><label className="cursor-pointer text-sm font-semibold text-sky-600">Change profile photo<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={selectAvatar} /></label></div>
              {displayedAvatar ? <button type="button" disabled={saving} onClick={removeAvatar} className="ml-auto text-xs font-semibold text-rose-600">Remove</button> : null}
            </div>

            <div className="space-y-5 p-6">
              <label className="block text-sm font-semibold text-slate-800">Phone<input value={form.phone} maxLength={40} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Add your phone number" className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal outline-none focus:border-slate-500" /></label>
              <label className="block text-sm font-semibold text-slate-800">Professional title<input value={form.jobTitle} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, jobTitle: event.target.value }))} placeholder="Senior Immigration Consultant" className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal outline-none focus:border-slate-500" /></label>
              <label className="block text-sm font-semibold text-slate-800">Specialties<textarea value={form.specializations} rows={3} onChange={(event) => setForm((current) => ({ ...current, specializations: event.target.value }))} placeholder="Express Entry, Work Permits, Family Sponsorship" className="mt-2 w-full resize-none rounded-lg border border-slate-300 px-3 py-3 text-sm font-normal outline-none focus:border-slate-500" /><span className="mt-1 block text-xs font-normal text-slate-400">Separate each specialty with a comma.</span></label>
              <div className="rounded-lg border border-slate-200 px-4 py-3 text-xs leading-5 text-slate-500">Your name and sign-in email are managed by an administrator. Profile images can be JPG, PNG, or WebP up to 5 MB.</div>
              {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
            </div>
            </div>
          </form>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function FrontdeskProfilePanel({ user, agency }) {
  const initials = (user?.fullName || "Front Desk").split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="mx-auto max-w-[935px]">
      <header className="grid gap-8 border-b border-slate-200 pb-10 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-10 lg:grid-cols-[290px_minmax(0,1fr)]">
        <div className="flex justify-center sm:pt-2">
          <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-3xl font-semibold text-slate-700 shadow-[0_20px_45px_rgba(15,23,42,0.15)] ring-4 ring-white sm:h-40 sm:w-40">
            {initials}
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="truncate text-xl font-normal text-slate-950">{user?.fullName || "Front Desk"}</h2>
            <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">Front Desk</span>
          </div>
          <div className="mt-7 text-sm leading-6">
            <p className="font-semibold text-slate-950">{user?.jobTitle || "Front Desk"}</p>
            <p className="text-slate-600">{agency?.name || "CaseDesk agency"}</p>
            <p className="mt-1 text-slate-500">{user?.email}{user?.phone ? ` · ${user.phone}` : ""}</p>
          </div>
        </div>
      </header>

      <div className="flex justify-center border-b border-slate-200">
        <div className="-mb-px border-t border-slate-950 px-5 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-950">Profile details</div>
      </div>

      <section className="mt-8 overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-[0_12px_35px_rgba(15,23,42,0.04)]">
        {[
          { icon: UserRound, label: "Job title", value: user?.jobTitle },
          { icon: PhoneCall, label: "Phone", value: user?.phone },
          { icon: Mail, label: "Email", value: user?.email },
        ].map((row) => {
          const RowIcon = row.icon;
          return (
            <div key={row.label} className="grid min-h-[60px] grid-cols-1 gap-1 border-b border-slate-100 px-5 py-4 transition duration-200 last:border-b-0 hover:bg-slate-50/80 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center sm:gap-6">
              <div className="flex items-center gap-2.5 text-[14px] font-medium text-slate-500"><RowIcon className="h-4 w-4 text-slate-400" />{row.label}</div>
              <div className={`text-[14px] font-medium sm:text-[15px] ${row.value ? "text-slate-950" : "text-slate-400"}`}>{row.value || "Not added"}</div>
            </div>
          );
        })}
      </section>
      <p className="mt-4 rounded-lg border border-slate-200 px-4 py-3 text-xs leading-5 text-slate-500">Your profile details are managed by a workspace administrator. Contact them to update your name, contact information, or job title.</p>
    </div>
  );
}

function SecurityPanel() {
  const navigate = useNavigate();

  return (
    <div className="space-y-7">
      <div className="flex items-start gap-4 border-b border-slate-200/80 pb-7">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
          <Lock className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Security</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Update your password and keep your account secure.</p>
        </div>
      </div>
      <section className="flex flex-col gap-5 rounded-3xl border border-slate-200 bg-slate-50/70 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold text-slate-950">Password</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">Use at least 10 characters and a password unique to CaseDesk.</p>
        </div>
        <button type="button" onClick={() => navigate("/change-password")} className="h-11 shrink-0 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800">
          Change password
        </button>
      </section>
    </div>
  );
}

export default function Settings() {
  const { role, appUser, agency } = useAuth();
  const isAdmin = role === "admin";
  const settingsItems = isAdmin ? adminSettingsItems : consultantSettingsItems;
  const defaultSection = isAdmin ? "agency-profile" : "personal-profile";
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const [activeSection, setActiveSection] = useState(() => settingsItems.some((item) => item.id === requestedSection) ? requestedSection : defaultSection);

  useEffect(() => {
    if (requestedSection && settingsItems.some((item) => item.id === requestedSection)) {
      setActiveSection(requestedSection);
    } else if (!settingsItems.some((item) => item.id === activeSection)) {
      setActiveSection(defaultSection);
    }
  }, [activeSection, defaultSection, requestedSection, settingsItems]);

  function selectSection(section) {
    setActiveSection(section);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("section", section);
      return next;
    }, { replace: true });
  }

  const activeItem =
    settingsItems.find((item) => item.id === activeSection) || settingsItems[0];

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent">
      <div className="flex-shrink-0 px-6 pb-5 pt-6">
        <h1 className="text-[34px] font-semibold leading-[40px] tracking-[-0.035em] text-slate-950">
          Settings
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-6 text-slate-500">
          {isAdmin ? "Manage your agency, team, workflow, and system preferences." : "Manage your profile, notifications, and account security."}
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden border-y border-slate-200/80 bg-white/75 shadow-[0_24px_70px_rgba(15,23,42,0.07)] backdrop-blur-xl lg:grid-cols-[286px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 border-r border-slate-200/80 bg-slate-50/70 p-3 lg:block">
          <div className="flex h-full min-h-0 flex-col">
            <div className="px-3 pb-3 pt-2">
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                {isAdmin ? "Admin Settings" : "Personal Settings"}
              </p>
            </div>

            <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {settingsItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === activeSection;

                return (
                  <motion.button
                    key={item.id}
                    type="button"
                    onClick={() => selectSection(item.id)}
                    whileTap={{ scale: 0.985 }}
                    className={`group relative flex h-[46px] w-full items-center gap-3 rounded-[14px] px-3 text-left text-[14px] font-medium transition-all duration-200 ${
                      isActive
                        ? "bg-white text-slate-950 shadow-[0_8px_22px_rgba(15,23,42,0.08)]"
                        : "text-slate-600 hover:bg-white/70 hover:text-slate-950"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors ${
                        isActive
                          ? "bg-slate-950 text-white"
                          : "bg-white text-slate-500 group-hover:text-slate-900"
                      }`}
                    >
                      <Icon className="h-[17px] w-[17px]" />
                    </span>

                    <span className="truncate">{item.label}</span>
                  </motion.button>
                );
              })}
            </nav>
          </div>
        </aside>

        <div className="border-b border-slate-200/80 bg-slate-50/70 p-3 lg:hidden">
          <div className="flex gap-2 overflow-x-auto">
            {settingsItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === activeSection;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectSection(item.id)}
                  className={`flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-[13px] font-medium ${
                    isActive
                      ? "bg-slate-950 text-white"
                      : "bg-white text-slate-600"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <main className="min-h-0 min-w-0 overflow-hidden bg-white">
          <div className="scrollbar-hidden h-full min-h-0 overflow-y-auto px-5 py-6 sm:px-7 lg:px-9 lg:py-8">
            <div className="mx-auto max-w-[980px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeSection}
                  initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  {!isAdmin && activeSection === "personal-profile" ? (
                    role === "frontdesk" ? <FrontdeskProfilePanel user={appUser} agency={agency} /> : <PersonalProfilePanel user={appUser} agency={agency} />
                  ) : !isAdmin && activeSection === "security" ? (
                    <SecurityPanel />
                  ) : activeSection === "agency-profile" ? (
                    <AgencyProfilePanel />
                  ) : activeSection === "agency-email" ? (
                    <AgencyMailSettingsPanel />
                  ) : activeSection === "agency-phone" ? (
                    <AgencyOomaSettingsPanel />
                  ) : activeSection === "communication-controls" ? (
                    <CommunicationSettingsPanel />
                  ) : (
                    <PlaceholderPanel item={activeItem} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}
