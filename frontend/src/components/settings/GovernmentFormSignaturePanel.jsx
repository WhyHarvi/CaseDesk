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
  // `loadError` is page-level (nothing rendered yet to act on, so it belongs
  // at the top). `actionError`/`actionNotice` belong to the single Save
  // action below and are rendered right next to it, not at the top of the
  // page — a save failure should be visible without scrolling back up.
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [profile, setProfile] = useState({ licenseNumber: "", representativeType: "Paid", membershipBody: "College of Immigration and Citizenship Consultants (CICC)", membershipProvince: "", formOfficePhone: "", formOfficeEmail: "" });
  // The shared agency office contact, shown as placeholder text so it's
  // obvious what appears on the form when these two fields are left blank —
  // every representative gets the same office phone/email by default.
  const [officeContact, setOfficeContact] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get("/account/form-signature"),
      api.get("/account/agency-office-contact").catch(() => null),
    ])
      .then(([signatureResponse, officeResponse]) => {
        if (!active) return;
        setData(signatureResponse.data.data);
        setProfile({
          licenseNumber: signatureResponse.data.data.licenseNumber || "",
          representativeType: signatureResponse.data.data.representativeType || "Paid",
          membershipBody: signatureResponse.data.data.membershipBody || "",
          membershipProvince: signatureResponse.data.data.membershipProvince || "",
          formOfficePhone: signatureResponse.data.data.formOfficePhone || "",
          formOfficeEmail: signatureResponse.data.data.formOfficeEmail || "",
        });
        setOfficeContact(officeResponse?.data?.data || null);
      })
      .catch((reason) => { if (active) setLoadError(reason.response?.data?.message || "Your government-form signature could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  // One save action instead of two. Credentials and signature used to be
  // separate saves, and the backend requires a saved licence number before
  // it will accept a signature — so someone who typed everything in and only
  // clicked "Save signature" would hit a rejection that looked unrelated to
  // what they'd just filled in. Saving both together, in the right order,
  // removes that failure mode entirely rather than just explaining it better.
  async function saveAll() {
    const licenseNumber = profile.licenseNumber.trim();
    if (!licenseNumber) { setActionError("Add a licence / membership ID before saving."); return; }
    setSaving(true);
    setActionError("");
    setActionNotice("");
    try {
      const profileResponse = await api.patch("/account/form-representative-profile", profile);
      setData(profileResponse.data.data);
      setProfile((current) => ({
        ...current,
        licenseNumber: profileResponse.data.data.licenseNumber || "",
        formOfficePhone: profileResponse.data.data.formOfficePhone || "",
        formOfficeEmail: profileResponse.data.data.formOfficeEmail || "",
      }));
    } catch (reason) {
      setActionError(reason.response?.data?.message || "Your representative credentials could not be saved.");
      setSaving(false);
      return;
    }
    const includesSignature = Boolean(signatureImage);
    if (includesSignature) {
      try {
        const signatureResponse = await api.put("/account/form-signature", { signatureImage, signatureStrokes });
        setData(signatureResponse.data.data);
        setSignatureImage("");
        setSignatureStrokes([]);
      } catch (reason) {
        setActionError(reason.response?.data?.message || "Your credentials saved, but the signature could not be saved.");
        setSaving(false);
        return;
      }
    }
    setActionNotice(includesSignature ? "Your credentials and signature are ready for government forms." : "Your representative credentials are ready for government forms.");
    setSaving(false);
  }

  async function remove() {
    setSaving(true);
    setActionError("");
    setActionNotice("");
    try {
      await api.delete("/account/form-signature");
      setData((current) => ({ ...current, hasSignature: false, signatureImage: null, updatedAt: new Date().toISOString() }));
      setSignatureImage("");
      setSignatureStrokes([]);
      setActionNotice("Your saved government-form signature was removed.");
    } catch (reason) {
      setActionError(reason.response?.data?.message || "Your signature could not be removed.");
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

      {loadError ? <p className="mt-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</p> : null}

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
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">1</span>
            <p className="text-sm font-semibold text-slate-900">Representative credentials</p>
          </div>
          <p className="mt-1 pl-[34px] text-xs leading-5 text-slate-500">CaseDesk fills the IMM 5476 dropdown and representative section from these fields. Fill them in, then draw your signature below — one Save at the bottom covers both.</p>
          <div className="mt-4 grid gap-4 pl-[34px] sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">Licence / membership ID<input value={profile.licenseNumber} onChange={(event) => setProfile((current) => ({ ...current, licenseNumber: event.target.value }))} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-violet-300" /></label>
            <label className="text-xs font-semibold text-slate-700">Representative type<select value={profile.representativeType} onChange={(event) => setProfile((current) => ({ ...current, representativeType: event.target.value }))} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-violet-300"><option>Paid</option><option>Unpaid</option></select></label>
            <label className="text-xs font-semibold text-slate-700">Membership body<input value={profile.membershipBody} onChange={(event) => setProfile((current) => ({ ...current, membershipBody: event.target.value }))} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-violet-300" /></label>
            <label className="text-xs font-semibold text-slate-700">Province / territory (if applicable)<input value={profile.membershipProvince} onChange={(event) => setProfile((current) => ({ ...current, membershipProvince: event.target.value }))} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-violet-300" /></label>
          </div>

          <div className="mt-5 border-t border-slate-100 pl-[34px] pt-4">
            <p className="text-xs font-semibold text-slate-700">Office phone &amp; email for this form</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {officeContact
                ? <>Leave these blank to use your agency's office contact — <span className="font-medium text-slate-700">{officeContact.phone || "no office phone on file"}</span> · <span className="font-medium text-slate-700">{officeContact.email || "no office email on file"}</span>. Every representative shows the same office contact unless overridden here.</>
                : "Leave these blank to use your agency's office contact. Every representative shows the same office contact unless overridden here."}
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-700">Office phone (optional)
                <input value={profile.formOfficePhone} onChange={(event) => setProfile((current) => ({ ...current, formOfficePhone: event.target.value }))} placeholder={officeContact?.phone || "Use agency office phone"} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-normal outline-none focus:border-violet-300" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Office email (optional)
                <input value={profile.formOfficeEmail} onChange={(event) => setProfile((current) => ({ ...current, formOfficeEmail: event.target.value }))} placeholder={officeContact?.email || "Use agency office email"} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-normal outline-none focus:border-violet-300" />
              </label>
            </div>
          </div>
        </section>
      ) : null}

      {data ? (
        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">2</span>
            <p className="text-sm font-semibold text-slate-900">{data.hasSignature ? "Replace signature" : "Draw signature"}</p>
          </div>
          <div className="pl-[34px]">
            <SignaturePad key={`${data.updatedAt || "new"}-${data.hasSignature}`} disabled={saving} onChange={setSignatureImage} onStrokesChange={setSignatureStrokes} />
            <p className="mt-4 text-xs leading-5 text-slate-500">By saving this signature, you confirm it is yours and may be applied only when you are explicitly selected as the representative on a government form. The completed form still requires review before submission.</p>
          </div>

          {actionError ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{actionError}</p> : null}
          {actionNotice ? <p className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />{actionNotice}</p> : null}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {data.hasSignature ? <button type="button" disabled={saving} onClick={remove} className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 px-4 py-2.5 text-xs font-semibold text-rose-600 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />Remove saved signature</button> : null}
            <button type="button" disabled={saving || !profile.licenseNumber.trim()} onClick={saveAll} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSignature className="h-3.5 w-3.5" />}{saving ? "Saving…" : signatureImage ? "Save credentials & signature" : "Save credentials"}</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
