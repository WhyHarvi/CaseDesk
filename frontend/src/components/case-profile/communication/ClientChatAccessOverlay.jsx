import {
  Check,
  Copy,
  Link2,
  Loader2,
  Mail,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../../services/api";

export default function ClientChatAccessOverlay({
  caseItem,
  onClose,
  onEmailLink,
}) {
  const [access, setAccess] = useState(null);
  const [url, setUrl] = useState("");
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .get(`/communications/case/${caseItem.id}/chat-access`)
      .then((response) => {
        if (active) setAccess(response.data.data);
      })
      .catch((requestError) => {
        if (active)
          setError(
            requestError.response?.data?.message ||
              "Secure chat access could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [caseItem.id]);
  const generate = async () => {
    try {
      setBusy(true);
      setError("");
      setNotice("");
      const response = await api.post(
        `/communications/case/${caseItem.id}/chat-access`,
        { expiresInDays: Number(days) },
      );
      setAccess(response.data.data);
      setUrl(response.data.data.url);
      setNotice(
        "A new private chat link is ready. Any previous link has been revoked.",
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "A secure chat link could not be created.",
      );
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Secure chat link copied.");
    } catch {
      setError("The link could not be copied. Select and copy it manually.");
    }
  };
  const revoke = async () => {
    try {
      setBusy(true);
      setError("");
      await api.delete(`/communications/case/${caseItem.id}/chat-access`);
      setAccess(null);
      setUrl("");
      setConfirmRevoke(false);
      setNotice("Client chat access was revoked immediately.");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Chat access could not be revoked.",
      );
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <div className="fixed inset-0 z-[480] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close client chat access"
      />
      <motion.section
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full max-w-xl overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_35px_100px_rgba(15,23,42,.27)]"
      >
        <header className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-600">
              Client portal
            </p>
            <h2 className="mt-1 text-xl font-semibold">Secure chat access</h2>
            <p className="mt-1 text-sm text-slate-500">
              {caseItem.client?.fullName} · {caseItem.caseType}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <main className="space-y-4 p-6">
          {loading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              {notice ? (
                <p className="flex items-start gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  <Check className="mt-0.5 h-4 w-4 shrink-0" />
                  {notice}
                </p>
              ) : null}
              {error ? (
                <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </p>
              ) : null}
              <section className="rounded-3xl border border-violet-100 bg-violet-50/60 p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-violet-700">
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-violet-950">
                      Private, revocable access
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-violet-800">
                      The link acts like a password. Send it only to the client,
                      and revoke it if it is shared with the wrong person.
                    </p>
                  </div>
                </div>
              </section>
              {access ? (
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                        <MessageSquareText className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold">
                          Chat access is active
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Expires{" "}
                          {new Date(access.expiresAt).toLocaleString("en-CA", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </p>
                        {access.lastUsedAt ? (
                          <p className="mt-1 text-[10px] text-slate-400">
                            Last opened{" "}
                            {new Date(access.lastUsedAt).toLocaleString(
                              "en-CA",
                            )}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {url ? (
                    <div className="mt-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
                      <input
                        readOnly
                        value={url}
                        className="min-w-0 flex-1 bg-transparent px-2 text-xs text-slate-600 outline-none"
                      />
                      <button
                        type="button"
                        onClick={copy}
                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                      For security, an existing link cannot be displayed again.
                      Generate a new one if the client needs it.
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    {url ? (
                      <button
                        type="button"
                        onClick={() => onEmailLink(url)}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3.5 py-2 text-xs font-semibold"
                      >
                        <Mail className="h-3.5 w-3.5" />
                        Email link
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={generate}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3.5 py-2 text-xs font-semibold"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      New link
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        confirmRevoke ? void revoke() : setConfirmRevoke(true)
                      }
                      className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold ${confirmRevoke ? "bg-rose-600 text-white" : "bg-rose-50 text-rose-700"}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {confirmRevoke ? "Revoke now?" : "Revoke"}
                    </button>
                  </div>
                </section>
              ) : (
                <section className="rounded-3xl border border-dashed border-slate-200 p-6 text-center">
                  <Link2 className="mx-auto h-7 w-7 text-slate-300" />
                  <h3 className="mt-3 text-sm font-semibold">
                    No active client chat link
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Create one when the client is ready to use secure chat.
                  </p>
                  <div className="mx-auto mt-4 flex max-w-xs items-center gap-2">
                    <select
                      value={days}
                      onChange={(event) => setDays(event.target.value)}
                      className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold"
                    >
                      <option value="7">7 days</option>
                      <option value="30">30 days</option>
                      <option value="90">90 days</option>
                      <option value="365">1 year</option>
                    </select>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={generate}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-xs font-semibold text-white"
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Link2 className="h-3.5 w-3.5" />
                      )}
                      Create link
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </motion.section>
    </div>,
    document.body,
  );
}
