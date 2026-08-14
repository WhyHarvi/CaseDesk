import { CheckCircle2, FileSignature, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import SignaturePad from "../client-portal/SignaturePad";
import api from "../../services/api";

export default function GovernmentFormSignaturePanel() {
  const [data, setData] = useState(null);
  const [signatureImage, setSignatureImage] = useState("");
  const [signatureStrokes, setSignatureStrokes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [profile, setProfile] = useState({ licenseNumber: "", representativeType: "Paid", membershipBody: "College of Immigration and Citizenship Consultants (CICC)", membershipProvince: "" });

  useEffect(() => {
    let active = true;
    api.get("/account/form-signature")
      .then((response) => { if (active) { setData(response.data.data); setProfile({ licenseNumber: response.data.data.licenseNumber || "", representativeType: response.data.data.representativeType || "Paid", membershipBody: response.data.data.membershipBody || "", membershipProvince: response.data.data.membershipProvince || "" }); } })
      .catch((reason) => { if (active) setError(reason.response?.data?.message || "Your government-form signature could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await api.put("/account/form-signature", { signatureImage, signatureStrokes });
      setData(response.data.data);
      setSignatureImage("");
      setSignatureStrokes([]);
      setNotice("Your personal government-form signature is ready.");
    } catch (reason) {
      setError(reason.response?.data?.message || "Your signature could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await api.patch("/account/form-representative-profile", profile);
      setData(response.data.data);
      setProfile((current) => ({ ...current, licenseNumber: response.data.data.licenseNumber || "" }));
      setNotice("Your representative credentials are ready for government forms.");
    } catch (reason) {
      setError(reason.response?.data?.message || "Your representative credentials could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError("");
    try {
      await api.delete("/account/form-signature");
      setData((current) => ({ ...current, hasSignature: false, signatureImage: null, updatedAt: new Date().toISOString() }));
      setSignatureImage("");
      setSignatureStrokes([]);
      setNotice("Your saved government-form signature was removed.");
    } catch (reason) {
      setError(reason.response?.data?.message || "Your signature could not be removed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading signature…</div>;

  return (
    <div className="pb-10">
      <header className="flex items-start gap-3 border-b border-slate-100 pb-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-700"><FileSignature className="h-5 w-5" /></span>
        <div>
          <h2 className="text-[24px] font-semibold tracking-[-0.035em] text-slate-950">Government-form signature</h2>
          <p className="mt-1 max-w-2xl text-[14px] leading-6 text-slate-500">Your own drawn signature for IMM 5476 and other government forms. It is never shared with another representative profile.</p>
        </div>
      </header>

      {error ? <p className="mt-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {notice ? <p className="mt-5 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />{notice}</p> : null}

      {data ? (
        <section className="mt-6 rounded-3xl border border-slate-200 bg-slate-50/60 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-sm font-semibold text-slate-950">{data.fullName}</p><p className="mt-1 text-xs text-slate-500">{data.licenseNumber ? `Licence ${data.licenseNumber}` : "Add credentials to appear in the representative dropdown"}</p></div>
            {data.hasSignature ? <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Signature saved</span> : <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Signature needed</span>}
          </div>
          {data.signatureImage ? <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4"><img src={data.signatureImage} alt="Your saved government-form signature" className="h-24 max-w-full object-contain" /></div> : null}
        </section>
      ) : null}

      {data ? (
        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-semibold text-slate-900">Representative profile</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">CaseDesk fills the IMM 5476 dropdown and representative section from these profile fields. They are not retyped per form.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">Licence / membership ID<input value={profile.licenseNumber} onChange={(event) => setProfile((current) => ({ ...current, licenseNumber: event.target.value }))} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-violet-300" /></label>
            <label className="text-xs font-semibold text-slate-700">Representative type<select value={profile.representativeType} onChange={(event) => setProfile((current) => ({ ...current, representativeType: event.target.value }))} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-violet-300"><option>Paid</option><option>Unpaid</option></select></label>
            <label className="text-xs font-semibold text-slate-700">Membership body<input value={profile.membershipBody} onChange={(event) => setProfile((current) => ({ ...current, membershipBody: event.target.value }))} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-violet-300" /></label>
            <label className="text-xs font-semibold text-slate-700">Province / territory (if applicable)<input value={profile.membershipProvince} onChange={(event) => setProfile((current) => ({ ...current, membershipProvince: event.target.value }))} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-violet-300" /></label>
          </div>
          <div className="mt-4 flex justify-end"><button type="button" disabled={saving || !profile.licenseNumber.trim()} onClick={saveProfile} className="rounded-full border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-700 disabled:opacity-40">Save credentials</button></div>
        </section>
      ) : null}

      {data ? (
        <section className="mt-6">
          <p className="mb-2 text-sm font-semibold text-slate-800">{data.hasSignature ? "Replace signature" : "Draw signature"}</p>
          <SignaturePad key={`${data.updatedAt || "new"}-${data.hasSignature}`} disabled={saving} onChange={setSignatureImage} onStrokesChange={setSignatureStrokes} />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {data.hasSignature ? <button type="button" disabled={saving} onClick={remove} className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 px-4 py-2.5 text-xs font-semibold text-rose-600 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />Remove saved signature</button> : null}
            <button type="button" disabled={saving || !signatureImage} onClick={save} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSignature className="h-3.5 w-3.5" />}{data.hasSignature ? "Save replacement" : "Save signature"}</button>
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-500">By saving this signature, you confirm it is yours and may be applied only when you are explicitly selected as the representative on a government form. The completed form still requires review before submission.</p>
        </section>
      ) : null}
    </div>
  );
}
