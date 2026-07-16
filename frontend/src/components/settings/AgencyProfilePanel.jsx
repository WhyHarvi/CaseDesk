import { Building2, Globe2, Landmark, MapPin, PhoneCall, Mail, Clock3, Coins } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../auth/AuthContext";
import api from "../../services/api";

const emptyForm = {
  name: "",
  legalName: "",
  email: "",
  phone: "",
  website: "",
  address: "",
  city: "",
  province: "",
  country: "",
  postalCode: "",
  timezone: "",
  defaultCurrency: "",
  businessNumber: "",
  taxNumber: "",
};

function formFromAgency(agency) {
  return Object.fromEntries(Object.keys(emptyForm).map((key) => [key, agency?.[key] || ""]));
}

function Field({ label, children, hint }) {
  return (
    <label className="block text-sm font-semibold text-slate-800">
      {label}
      {children}
      {hint ? <span className="mt-1 block text-xs font-normal text-slate-400">{hint}</span> : null}
    </label>
  );
}

function TextInput(props) {
  return (
    <input
      {...props}
      className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal outline-none transition focus:border-slate-500"
    />
  );
}

export default function AgencyProfilePanel() {
  const { refreshIdentity } = useAuth();
  const [agency, setAgency] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return ["America/Toronto", "America/Vancouver", "America/New_York", "Europe/London", "Asia/Kolkata"];
    }
  }, []);

  const currencies = useMemo(() => {
    try {
      return Intl.supportedValuesOf("currency");
    } catch {
      return ["CAD", "USD", "EUR", "GBP", "INR", "AUD"];
    }
  }, []);

  useEffect(() => {
    let active = true;
    api
      .get("/settings/agency-profile")
      .then((response) => {
        if (!active) return;
        setAgency(response.data.data);
        setForm(formFromAgency(response.data.data));
      })
      .catch((reason) => {
        if (active) setError(reason.response?.data?.message || "The agency profile could not be loaded.");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  function closeEditor() {
    if (saving) return;
    setForm(formFromAgency(agency));
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
  }, [editing, saving, agency]);

  async function saveProfile(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await api.patch("/settings/agency-profile", form);
      setAgency(response.data.data);
      setForm(formFromAgency(response.data.data));
      setNotice("Agency profile updated successfully.");
      setEditing(false);
      await refreshIdentity();
    } catch (reason) {
      setError(reason.response?.data?.message || "The agency profile could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  function set(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  const initials = (agency?.name || "CaseDesk")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const location = [agency?.address, agency?.city, agency?.province, agency?.postalCode, agency?.country]
    .filter(Boolean)
    .join(", ");

  const stats = [
    { label: "team members", value: agency?.stats?.teamMembers || 0 },
    { label: "clients", value: agency?.stats?.clients || 0 },
    { label: "active cases", value: agency?.stats?.activeCases || 0 },
  ];

  const detailGroups = [
    {
      title: "Contact",
      rows: [
        { icon: Mail, label: "Public Email", value: agency?.email },
        { icon: PhoneCall, label: "Phone Number", value: agency?.phone },
        { icon: Globe2, label: "Website", value: agency?.website },
      ],
    },
    {
      title: "Location",
      rows: [{ icon: MapPin, label: "Office Address", value: location }],
    },
    {
      title: "Regional",
      rows: [
        { icon: Clock3, label: "Timezone", value: agency?.timezone },
        { icon: Coins, label: "Currency", value: agency?.defaultCurrency },
      ],
    },
    {
      title: "Legal",
      rows: [
        { icon: Landmark, label: "Legal Name", value: agency?.legalName },
        { icon: Landmark, label: "Business Number", value: agency?.businessNumber },
        { icon: Landmark, label: "Tax Number", value: agency?.taxNumber },
      ],
    },
  ];

  if (loading) {
    return (
      <div className="mx-auto max-w-[935px] space-y-8">
        <div className="flex items-center gap-8">
          <div className="h-32 w-32 animate-pulse rounded-full bg-slate-100 sm:h-40 sm:w-40" />
          <div className="flex-1 space-y-3">
            <div className="h-6 w-52 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-4 w-72 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-4 w-40 animate-pulse rounded-lg bg-slate-100" />
          </div>
        </div>
        <div className="h-64 animate-pulse rounded-[24px] bg-slate-50" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[935px]">
      {error && !editing ? (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</div>
      ) : null}

      <header className="grid gap-8 border-b border-slate-200 pb-10 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-10 lg:grid-cols-[290px_minmax(0,1fr)]">
        <div className="flex justify-center sm:pt-2">
          <div className="flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-slate-900 to-slate-600 text-3xl font-semibold text-white shadow-[0_20px_45px_rgba(15,23,42,0.22)] ring-4 ring-white sm:h-40 sm:w-40">
            {initials}
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="truncate text-xl font-normal text-slate-950">{agency?.name || "Your agency"}</h2>
            <button
              type="button"
              disabled={loading || Boolean(error && !agency)}
              onClick={() => setEditing(true)}
              className="h-9 rounded-lg bg-slate-100 px-5 text-sm font-semibold text-slate-900 transition hover:bg-slate-200 disabled:opacity-50"
            >
              Edit profile
            </button>
          </div>

          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm text-slate-700 sm:text-base">
            {stats.map((item) => (
              <span key={item.label}>
                <strong className="font-semibold text-slate-950">{item.value}</strong> {item.label}
              </span>
            ))}
          </div>

          <div className="mt-7 text-sm leading-6">
            <p className="font-semibold text-slate-950">{agency?.legalName || agency?.name}</p>
            <p className="text-slate-600">{[agency?.city, agency?.province, agency?.country].filter(Boolean).join(", ") || "Add your office location"}</p>
            <p className="mt-1 text-slate-500">
              {agency?.email}
              {agency?.phone ? ` · ${agency.phone}` : ""}
            </p>
            {agency?.website ? (
              <a
                href={agency.website.startsWith("http") ? agency.website : `https://${agency.website}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block font-medium text-sky-600 hover:text-sky-700"
              >
                {agency.website}
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex justify-center border-b border-slate-200">
        <div className="-mb-px border-t border-slate-950 px-5 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-950">
          Agency details
        </div>
      </div>

      <section className="mt-8 space-y-6">
        {detailGroups.map((group) => (
          <div key={group.title}>
            <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-400">{group.title}</p>
            <div className="overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-[0_12px_35px_rgba(15,23,42,0.04)]">
              {group.rows.map((row) => {
                const Icon = row.icon;
                return (
                  <div
                    key={row.label}
                    className="grid min-h-[60px] grid-cols-1 gap-1 border-b border-slate-100 px-5 py-4 transition duration-200 last:border-b-0 hover:bg-slate-50/80 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center sm:gap-6"
                  >
                    <div className="flex items-center gap-2.5 text-[14px] font-medium text-slate-500">
                      <Icon className="h-4 w-4 text-slate-400" />
                      {row.label}
                    </div>
                    <div className={`text-[14px] font-medium sm:text-[15px] ${row.value ? "text-slate-950" : "text-slate-400"}`}>
                      {row.value || "Not set"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {editing
        ? createPortal(
            <div
              className="fixed inset-0 z-[9999] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
              role="presentation"
              onMouseDown={closeEditor}
            >
              <form
                onSubmit={saveProfile}
                onMouseDown={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="edit-agency-title"
                className="flex max-h-[94dvh] w-full max-w-[640px] flex-col overflow-hidden rounded-t-[24px] bg-white shadow-[0_30px_100px_rgba(15,23,42,0.35)] sm:max-h-[88vh] sm:rounded-[20px]"
              >
                <div className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-slate-200 px-5">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={closeEditor}
                    className="justify-self-start text-sm text-slate-600 transition hover:text-slate-950 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <h3 id="edit-agency-title" className="font-semibold text-slate-950">
                    Edit agency profile
                  </h3>
                  <button disabled={saving} className="justify-self-end text-sm font-semibold text-sky-600 disabled:opacity-50">
                    {saving ? "Saving…" : "Done"}
                  </button>
                </div>

                <div className="min-h-0 overflow-y-auto overscroll-contain">
                  <div className="flex items-center gap-4 bg-slate-50 px-6 py-5">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-900 to-slate-600 font-semibold text-white">
                      <Building2 className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-950">{agency?.name}</p>
                      <p className="text-xs text-slate-500">These details appear on invoices, documents, and client communication.</p>
                    </div>
                  </div>

                  <div className="space-y-5 p-6">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field label="Agency name">
                        <TextInput value={form.name} maxLength={160} required onChange={set("name")} placeholder="Maple Leaf Immigration" />
                      </Field>
                      <Field label="Legal name">
                        <TextInput value={form.legalName} maxLength={200} onChange={set("legalName")} placeholder="Maple Leaf Immigration Inc." />
                      </Field>
                      <Field label="Public email">
                        <TextInput type="email" value={form.email} maxLength={254} required onChange={set("email")} placeholder="hello@agency.com" />
                      </Field>
                      <Field label="Phone">
                        <TextInput value={form.phone} maxLength={40} onChange={set("phone")} placeholder="+1 (416) 555-0199" />
                      </Field>
                    </div>

                    <Field label="Website">
                      <TextInput value={form.website} maxLength={200} onChange={set("website")} placeholder="www.agency.com" />
                    </Field>

                    <Field label="Office address">
                      <TextInput value={form.address} maxLength={200} onChange={set("address")} placeholder="100 King Street West, Suite 500" />
                    </Field>

                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field label="City">
                        <TextInput value={form.city} maxLength={100} onChange={set("city")} placeholder="Toronto" />
                      </Field>
                      <Field label="Province / State">
                        <TextInput value={form.province} maxLength={100} onChange={set("province")} placeholder="Ontario" />
                      </Field>
                      <Field label="Country">
                        <TextInput value={form.country} maxLength={80} onChange={set("country")} placeholder="Canada" />
                      </Field>
                      <Field label="Postal code">
                        <TextInput value={form.postalCode} maxLength={24} onChange={set("postalCode")} placeholder="M5X 1A9" />
                      </Field>
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field label="Timezone">
                        <TextInput list="agency-timezones" value={form.timezone} onChange={set("timezone")} placeholder="America/Toronto" />
                        <datalist id="agency-timezones">
                          {timezones.map((zone) => (
                            <option key={zone} value={zone} />
                          ))}
                        </datalist>
                      </Field>
                      <Field label="Currency" hint="3-letter ISO code.">
                        <TextInput list="agency-currencies" value={form.defaultCurrency} maxLength={3} onChange={set("defaultCurrency")} placeholder="CAD" />
                        <datalist id="agency-currencies">
                          {currencies.map((code) => (
                            <option key={code} value={code} />
                          ))}
                        </datalist>
                      </Field>
                      <Field label="Business number">
                        <TextInput value={form.businessNumber} maxLength={60} onChange={set("businessNumber")} placeholder="123456789 RC0001" />
                      </Field>
                      <Field label="Tax number">
                        <TextInput value={form.taxNumber} maxLength={60} onChange={set("taxNumber")} placeholder="123456789 RT0001" />
                      </Field>
                    </div>

                    {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
                  </div>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
