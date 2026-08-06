import { ArrowUpRight, Check, Copy, Loader2, Mail, ShieldCheck, ShieldOff, Smartphone, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";

const statusTone = {
  active: "bg-emerald-50 text-emerald-700",
  invited: "bg-sky-50 text-sky-700",
  disabled: "bg-slate-100 text-slate-500",
};

export function usePortalAccess(clientId) {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    if (!clientId) return undefined;
    setLoading(true);
    return api
      .get(`/clients/${clientId}/portal-account`)
      .then(({ data }) => { setAccount(data.data); setError(""); })
      .catch((reason) => setError(reason.response?.data?.message || "Portal access could not be checked."))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { load(); }, [load]);
  return { account, loading, error, reload: load };
}

function InviteDialog({ clientId, clientEmail, clientName, onClose, onInvited, reload }) {
  const [email, setEmail] = useState(clientEmail || "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [manualLink, setManualLink] = useState("");
  const [copied, setCopied] = useState(false);

  async function invite(event) {
    event.preventDefault();
    setSending(true);
    setError("");
    try {
      const { data } = await api.post(`/clients/${clientId}/portal-account`, { email });
      reload();
      if (data.manualInvitationLink) {
        setManualLink(data.manualInvitationLink);
      } else {
        onInvited(data.message || "Portal invitation sent.");
      }
    } catch (reason) {
      setError(reason.response?.data?.message || "The portal invitation could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/25 px-5 py-10 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) onClose(); }}>
      {manualLink ? (
        <section role="dialog" aria-modal="true" aria-labelledby="portal-invite-title" className="w-full max-w-md rounded-[1.8rem] border border-white bg-white p-6 shadow-2xl sm:p-7">
          <div className="flex items-start justify-between">
            <div>
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white"><Smartphone className="h-5 w-5" /></div>
              <h2 id="portal-invite-title" className="text-xl font-semibold tracking-tight text-slate-950">Account created</h2>
              <p className="mt-1.5 text-sm leading-6 text-slate-500">Email delivery is temporarily unavailable. Send this one-time setup link directly to {clientName || "the client"}.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-5 break-all rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-600">{manualLink}</div>
          <button type="button" onClick={async () => { await navigator.clipboard.writeText(manualLink); setCopied(true); }} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy secure link"}</button>
          <p className="mt-4 text-center text-xs leading-5 text-slate-400">Treat this link like a password. Share it only with the intended client.</p>
        </section>
      ) : (
        <form onSubmit={invite} role="dialog" aria-modal="true" aria-labelledby="portal-invite-title" className="w-full max-w-md rounded-[1.8rem] border border-white bg-white p-6 shadow-2xl sm:p-7">
          <div className="flex items-start justify-between">
            <div>
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white"><Smartphone className="h-5 w-5" /></div>
              <h2 id="portal-invite-title" className="text-xl font-semibold tracking-tight text-slate-950">Invite to client portal</h2>
              <p className="mt-1.5 text-sm leading-6 text-slate-500">{clientName || "This client"} will receive a secure link to set a password and open their portal.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
          <label className="mt-5 block text-sm font-medium text-slate-700">
            Portal login email
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="client@email.com" className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100" />
          </label>
          {error ? <p className="mt-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</p> : null}
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-full px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-100">Cancel</button>
            <button disabled={sending} className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{sending ? "Sending…" : "Send invitation"}</button>
          </div>
        </form>
      )}
    </div>,
    document.body,
  );
}

function ManageAccessDialog({ clientId, account, clientName, onClose, onChanged }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const revoking = account.status !== "disabled";

  async function apply() {
    setSaving(true);
    setError("");
    try {
      const { data } = await api.post(`/clients/${clientId}/portal-account/access`, { active: !revoking });
      onChanged(data.message || (revoking ? "Portal access revoked." : "Portal access restored."));
    } catch (reason) {
      setError(reason.response?.data?.message || "Portal access could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/25 px-5 py-10 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="manage-access-title" className="w-full max-w-md rounded-[1.8rem] border border-white bg-white p-6 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between">
          <div>
            <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-2xl ${revoking ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"}`}>
              {revoking ? <ShieldOff className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
            </div>
            <h2 id="manage-access-title" className="text-xl font-semibold tracking-tight text-slate-950">
              {revoking ? "Revoke portal access?" : "Restore portal access?"}
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-slate-500">
              {revoking
                ? `${clientName || "This client"} (${account.email}) will be signed out and unable to open the portal until access is restored. Their data stays intact.`
                : `${clientName || "This client"} (${account.email}) will be able to sign in to the portal again with their existing credentials.`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        {error ? <p className="mt-4 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={onClose} className="h-10 rounded-full px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-100">Cancel</button>
          <button
            type="button"
            disabled={saving}
            onClick={apply}
            className={`inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold text-white transition disabled:opacity-60 ${revoking ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? "Updating…" : revoking ? "Revoke access" : "Restore access"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default function PortalAccessCard({ clientId, clientEmail, clientName, openCaseCount = null }) {
  const { account, loading, error, reload } = usePortalAccess(clientId);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [sendLinkError, setSendLinkError] = useState("");

  const portalUrl = `${window.location.origin}/client-portal`;
  const isActive = account?.hasAccess && account.status === "active";
  const linkLabel = !account?.hasAccess ? "Send onboarding link" : isActive ? "Send reset link" : "Resend onboarding link";

  async function copyPortalLink() {
    await navigator.clipboard.writeText(portalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function sendLink() {
    setSendingLink(true);
    setSendLinkError("");
    setNotice("");
    try {
      const { data } = await api.post(`/clients/${clientId}/portal-account/send-link`);
      setNotice(data.message || "Link emailed.");
      reload();
    } catch (reason) {
      setSendLinkError(reason.response?.data?.message || "The link could not be sent.");
    } finally {
      setSendingLink(false);
    }
  }

  return (
    <article id="client-portal-access" className="scroll-mt-24 rounded-[1.9rem] border border-white/80 bg-white/88 px-5 py-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Portal</p>
          <h3 className="mt-1 text-base font-semibold text-slate-950">Client access</h3>
          {loading ? (
            <div className="mt-2 h-4 w-40 animate-pulse rounded bg-slate-100" />
          ) : account?.hasAccess ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <span className="truncate">{account.email}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${statusTone[account.status] || "bg-slate-100 text-slate-500"}`}>{account.status}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">Access not configured</p>
          )}
        </div>
        <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
          <ShieldCheck className="h-4 w-4" />
        </div>
      </div>

      <div className="mt-4 space-y-2 text-sm text-slate-600">
        {account?.hasAccess
          ? account.status === "disabled"
            ? <p>Portal access is currently revoked. Restore it to let this client sign in again.</p>
            : account.status === "invited"
              ? <p>Onboarding is pending. Resend the secure onboarding link so this client can set a password and activate access.</p>
              : <p>This client can sign in to see their case status, documents, and payments.</p>
          : <p>Invite this client so they can follow their file and upload documents.</p>}
        {openCaseCount !== null ? <p>{openCaseCount} open {openCaseCount === 1 ? "file" : "files"} linked</p> : null}
      </div>

      {notice ? <p className="mt-3 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-700">{notice}</p> : null}
      {error && !loading ? <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">{error}</p> : null}
      {sendLinkError ? <p className="mt-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{sendLinkError}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {account?.hasAccess ? (
          <>
            <button
              type="button"
              onClick={() => { setNotice(""); setManageOpen(true); }}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white transition ${account.status === "disabled" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-950 hover:bg-slate-800"}`}
            >
              {account.status === "disabled" ? "Restore access" : "Manage access"}
              <ArrowUpRight className="h-4 w-4" />
            </button>
            {isActive ? (
              <button type="button" onClick={copyPortalLink} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950">
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                {copied ? "Link copied" : "Copy sign-in page"}
              </button>
            ) : null}
          </>
        ) : (
          <button type="button" disabled={loading} onClick={() => { setNotice(""); setInviteOpen(true); }} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
            Invite to portal
            <ArrowUpRight className="h-4 w-4" />
          </button>
        )}
        {!loading && account?.status !== "disabled" ? (
          <button type="button" disabled={sendingLink} onClick={sendLink} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:opacity-50">
            {sendingLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            {sendingLink ? "Sending…" : linkLabel}
          </button>
        ) : null}
      </div>

      {inviteOpen ? (
        <InviteDialog
          clientId={clientId}
          clientEmail={clientEmail}
          clientName={clientName}
          onClose={() => setInviteOpen(false)}
          onInvited={(message) => { setInviteOpen(false); setNotice(message); reload(); }}
          reload={reload}
        />
      ) : null}
      {manageOpen && account?.hasAccess ? (
        <ManageAccessDialog
          clientId={clientId}
          account={account}
          clientName={clientName}
          onClose={() => setManageOpen(false)}
          onChanged={(message) => { setManageOpen(false); setNotice(message); reload(); }}
        />
      ) : null}
    </article>
  );
}

export function PortalAccessButton({ clientId, clientEmail, clientName }) {
  const { account, loading, reload } = usePortalAccess(clientId);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 2400);
    return () => clearTimeout(timer);
  }, [notice]);

  if (loading) return null;

  return (
    <>
      {account?.hasAccess ? (
        <span className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          <ShieldCheck className="h-4 w-4" />
          Portal active
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
        >
          <ShieldCheck className="h-4 w-4" />
          Invite to portal
        </button>
      )}
      {notice ? <span className="inline-flex items-center rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</span> : null}
      {inviteOpen ? (
        <InviteDialog
          clientId={clientId}
          clientEmail={clientEmail}
          clientName={clientName}
          onClose={() => setInviteOpen(false)}
          onInvited={(message) => { setInviteOpen(false); setNotice(message); reload(); }}
          reload={reload}
        />
      ) : null}
    </>
  );
}
