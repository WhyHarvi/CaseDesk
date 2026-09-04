import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";
import { clientNameParts, composePersonFullName } from "../../utils/personName";
import { maritalStatusOptions } from "../case-profile/applicantProfileOptions";

const defaultFormState = {
  givenNames: "",
  familyName: "",
  email: "",
  phone: "",
  secondaryPhone: "",
  dateOfBirth: "",
  maritalStatus: "",
  address: "",
  preferredLanguage: "",
  identificationType: "",
  identificationNumber: "",
  identificationCountry: "",
  identificationExpiryDate: "",
  status: "Active",
  assignedUserId: "",
};

function formatDateForInput(value) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function clientToFormState(client) {
  const names = clientNameParts(client);
  return {
    givenNames: names.givenNames,
    familyName: names.familyName,
    email: client.email || "",
    phone: client.phone || "",
    secondaryPhone: client.secondaryPhone || "",
    dateOfBirth: formatDateForInput(client.dateOfBirth),
    maritalStatus: client.maritalStatus || "",
    address: client.address || "",
    preferredLanguage: client.preferredLanguage || "",
    identificationType: client.identificationType || "",
    identificationNumber: client.identificationNumber || "",
    identificationCountry: client.identificationCountry || "",
    identificationExpiryDate: formatDateForInput(client.identificationExpiryDate),
    status: client.status || "Active",
    assignedUserId: client.assignedUser?.id || "",
  };
}

// Shared by the /clients list page (create + edit) and anywhere else that
// needs to edit core client identity/contact info without sending staff
// all the way to the Clients list to do it — e.g. Case Profile, which
// previously had no path to set fields like date of birth at all once a
// case already existed.
export default function ClientEditDrawer({ client, onClose, onSaved }) {
  const isEditing = Boolean(client);
  const [formState, setFormState] = useState(defaultFormState);
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEditing);
  const [formError, setFormError] = useState("");
  const [nameNeedsReview, setNameNeedsReview] = useState(false);

  useEffect(() => {
    api.get("/leads/staff").then((response) => setUsers(response.data.data || [])).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    if (!isEditing) return;
    let active = true;
    // The caller may only have a partial client object on hand (e.g. Case
    // Profile's case-detail endpoint doesn't select every client field) —
    // fetch the authoritative full record so saving never silently blanks
    // out a field this drawer never actually loaded.
    api.get(`/clients/${client.id}`)
      .then((response) => {
        if (!active) return;
        const loadedClient = response.data.data.client;
        setFormState(clientToFormState(loadedClient));
        setNameNeedsReview(clientNameParts(loadedClient).needsReview);
      })
      .catch((reason) => { if (active) setFormError(reason.response?.data?.message || "Could not load this client's full details."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isEditing, client?.id]);

  function handleInputChange(event) {
    const { name, value } = event.target;
    setFormState((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      setSaving(true);
      setFormError("");

      if (!formState.givenNames.trim() && !formState.familyName.trim()) {
        setFormError("Enter at least a given name or family name.");
        return;
      }

      const payload = {
        ...formState,
        givenNames: formState.givenNames.trim(),
        familyName: formState.familyName.trim(),
        email: formState.email.trim(),
        phone: formState.phone.trim(),
        secondaryPhone: formState.secondaryPhone.trim(),
        address: formState.address.trim(),
        assignedUserId: formState.assignedUserId || "",
      };
      delete payload.fullName;
      if (!payload.email) delete payload.email;
      if (!payload.phone && !isEditing) delete payload.phone;
      if (!payload.address) delete payload.address;
      ["dateOfBirth", "identificationExpiryDate"].forEach((field) => {
        if (!payload[field]) delete payload[field];
      });

      const response = isEditing
        ? await api.patch(`/clients/${client.id}`, payload)
        : await api.post("/clients", payload);
      onSaved?.(response.data.data);
    } catch (requestError) {
      setFormError(requestError.response?.data?.message || "Unable to save client.");
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[400] flex justify-end bg-slate-950/30 backdrop-blur-sm">
      <button type="button" onClick={onClose} className="absolute inset-0 cursor-default" aria-label="Close drawer" />

      <aside className="relative flex h-full w-full max-w-[720px] flex-col overflow-hidden border-l border-white/70 bg-gradient-to-br from-white via-slate-50 to-sky-50 shadow-[0_32px_120px_rgba(15,23,42,0.28)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.08),transparent_32%)]" />

        <div className="relative border-b border-slate-200/70 px-6 py-5 sm:px-8">
          <div className="flex items-start justify-between gap-5">
            <div>
              <div className="inline-flex items-center rounded-full border border-sky-200/70 bg-sky-50/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                Client intake
              </div>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">
                {isEditing ? "Edit client profile" : "Add new client"}
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                Save the core client details first. Case, documents, payments, and follow-ups can be handled from the client profile.
              </p>
            </div>
            <button type="button" onClick={onClose} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white/80 text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-white hover:text-slate-900">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <form className="relative flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : (
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6 sm:px-8">
            <section className="rounded-[1.75rem] border border-white/80 bg-white/75 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">Client details</h3>
                  <p className="mt-1 text-sm text-slate-500">Basic identity and contact information.</p>
                </div>
                <div className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500 sm:block">At least one name required</div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Given name(s)</span>
                  <input name="givenNames" value={formState.givenNames} onChange={handleInputChange} className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100" placeholder="As shown on passport" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Family name</span>
                  <input name="familyName" value={formState.familyName} onChange={handleInputChange} className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100" placeholder="Leave blank only if none" />
                </label>
                <div className={`md:col-span-2 rounded-2xl px-4 py-3 text-xs leading-5 ${nameNeedsReview ? "border border-amber-200 bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-500"}`}>
                  {nameNeedsReview ? "These name parts were suggested from the old Full name. Verify them against the passport before saving. " : "Enter names exactly as shown on the passport. At least one name is required. "}
                  <span className="font-semibold">CRM display name: {composePersonFullName(formState.givenNames, formState.familyName) || "—"}</span>
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
                  <input type="email" name="email" value={formState.email} onChange={handleInputChange} className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100" placeholder="client@example.com" />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Primary phone</span>
                  <input type="tel" name="phone" value={formState.phone} onChange={handleInputChange} className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100" placeholder="+1 416 555 0100" />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Secondary phone <span className="font-normal text-slate-400">(optional)</span></span>
                  <input type="tel" name="secondaryPhone" value={formState.secondaryPhone} onChange={handleInputChange} className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100" placeholder="Backup or alternate number" />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Date of birth</span>
                  <input type="date" name="dateOfBirth" value={formState.dateOfBirth} onChange={handleInputChange} className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100" />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Marital status</span>
                  <select name="maritalStatus" value={formState.maritalStatus} onChange={handleInputChange} className="select-field h-12 w-full py-0">
                    {maritalStatusOptions.map((maritalStatus) => <option key={maritalStatus || "not-set"} value={maritalStatus}>{maritalStatus || "Not set"}</option>)}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Status</span>
                  <select name="status" value={formState.status} onChange={handleInputChange} className="select-field h-12 w-full py-0">
                    {["Active", "Inactive", "Closed"].map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </label>

                <label className="block md:col-span-2">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Preferred language</span>
                  <input name="preferredLanguage" value={formState.preferredLanguage} onChange={handleInputChange} maxLength={100} className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100" placeholder="English, French..." />
                </label>

                <label className="block md:col-span-2">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Address</span>
                  <textarea name="address" rows="3" value={formState.address} onChange={handleInputChange} className="w-full resize-none rounded-2xl border border-slate-200/90 bg-white/90 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100" placeholder="Toronto, ON" />
                </label>
              </div>
            </section>

            <section className="rounded-[1.75rem] border border-white/80 bg-white/75 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
              <div className="mb-5">
                <h3 className="text-sm font-semibold text-slate-950">Identification</h3>
                <p className="mt-1 text-sm text-slate-500">Record the primary identity document used for the file.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Document type</span><input name="identificationType" value={formState.identificationType} onChange={handleInputChange} maxLength={100} className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" placeholder="Passport" /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Document number</span><input name="identificationNumber" value={formState.identificationNumber} onChange={handleInputChange} maxLength={150} autoComplete="off" className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Issuing country</span><input name="identificationCountry" value={formState.identificationCountry} onChange={handleInputChange} maxLength={100} className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Expiry date</span><input type="date" name="identificationExpiryDate" value={formState.identificationExpiryDate} onChange={handleInputChange} className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" /></label>
              </div>
            </section>

            <section className="rounded-[1.75rem] border border-white/80 bg-white/75 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
              <div className="mb-5">
                <h3 className="text-sm font-semibold text-slate-950">Client access</h3>
                <p className="mt-1 text-sm text-slate-500">Clients without a case stay unassigned by default. An assigned case automatically gives its team access, or you can add a direct profile assignment here.</p>
              </div>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Direct profile access</span>
                <select name="assignedUserId" value={formState.assignedUserId} onChange={handleInputChange} className="select-field h-12 w-full py-0">
                  <option value="">No direct assignment</option>
                  {users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
                </select>
              </label>
            </section>

            {formError ? <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{formError}</div> : null}
          </div>
          )}

          <div className="relative border-t border-slate-200/80 bg-white/85 px-6 py-4 shadow-[0_-18px_45px_rgba(15,23,42,0.06)] backdrop-blur-xl sm:px-8">
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={onClose} className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950">Cancel</button>
              <button type="submit" disabled={saving || loading} className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-6 text-sm font-semibold text-white shadow-[0_18px_42px_rgba(15,23,42,0.24)] transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60">
                {saving ? "Saving..." : isEditing ? "Save changes" : "Create client"}
              </button>
            </div>
          </div>
        </form>
      </aside>
    </div>,
    document.body,
  );
}
