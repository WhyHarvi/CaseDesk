import { AlertCircle, LockKeyhole, MessageSquareText } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../services/api";
import ChatThread from "../components/chat/ChatThread";
import ChatComposer from "../components/chat/ChatComposer";
import ChatImageLightbox from "../components/chat/ChatImageLightbox";
import { useCaseRealtimeChat } from "../hooks/useCaseRealtimeChat";

const RECONCILE_POLL_MS = 45_000;
const FALLBACK_POLL_MS = 10_000;

function attachmentFileUrl(token, messageId, attachmentId) {
  // No Authorization header needed here — the token in the path is the
  // whole auth story for this anonymous, no-login surface, so a plain URL
  // works directly as an <img src> (unlike the authenticated portal and
  // staff surfaces, which need a fetched blob to carry a Bearer header).
  const base = api.defaults.baseURL?.replace(/\/$/, "") || "/api";
  return `${base}/client-communication/${token}/messages/${messageId}/attachments/${attachmentId}/file`;
}

export default function ClientChatPortal() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const response = await api.get(`/client-communication/${token}`);
      setData(response.data.data);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Secure chat could not be opened.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const fetchRealtimeConfig = useCallback(
    () => api.get(`/client-communication/${token}`).then((response) => response.data.data.realtime),
    [token],
  );
  useCaseRealtimeChat({
    fetchConfig: fetchRealtimeConfig,
    enabled: Boolean(data?.realtime?.configured),
    onMessage: () => load({ silent: true }),
  });

  useEffect(() => {
    const intervalMs = data?.realtime?.configured ? RECONCILE_POLL_MS : FALLBACK_POLL_MS;
    const timer = setInterval(() => void load({ silent: true }), intervalMs);
    return () => clearInterval(timer);
  }, [data?.realtime?.configured, load]);

  useEffect(() => {
    if (!data || document.visibilityState !== "visible") return;
    api.post(`/client-communication/${token}/messages/read`).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, data?.messages?.length]);

  const resolveFileUrl = useCallback(
    (attachment, message) => attachmentFileUrl(token, message.id, attachment.id),
    [token],
  );

  async function submit(event) {
    event?.preventDefault();
    const bodyText = message.trim();
    if (!bodyText) return;
    try {
      setSending(true);
      setError("");
      await api.post(`/client-communication/${token}/messages`, {
        bodyText,
        clientMessageId: crypto.randomUUID(),
      });
      setMessage("");
      await load({ silent: true });
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Your message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  async function attachFile(file) {
    try {
      setSending(true);
      setError("");
      const created = await api
        .post(`/client-communication/${token}/messages`, {
          bodyText: "",
          hasAttachment: true,
          clientMessageId: crypto.randomUUID(),
        })
        .then((response) => response.data.data);
      const form = new FormData();
      form.append("file", file);
      await api.post(`/client-communication/${token}/messages/${created.id}/attachments`, form, { timeout: 60_000 });
      await load({ silent: true });
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Your file could not be sent.");
    } finally {
      setSending(false);
    }
  }

  function handleAttachmentTap(attachment, message) {
    const url = attachmentFileUrl(token, message.id, attachment.id);
    if ((attachment.mimeType || "").startsWith("image/")) {
      setLightbox({ attachment, url });
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = `${url}?download=1`;
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  const messages = useMemo(() => data?.messages || [], [data?.messages]);

  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f3f5f8]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
      </div>
    );
  if (!data)
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f3f5f8] p-4">
        <section className="w-full max-w-md rounded-[2rem] border border-white bg-white p-7 text-center shadow-[0_30px_90px_rgba(15,23,42,.15)]">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
            <AlertCircle className="h-5 w-5" />
          </span>
          <h1 className="mt-4 text-xl font-semibold">Chat unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{error}</p>
        </section>
      </div>
    );
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,#e0f2fe,transparent_34%),radial-gradient(circle_at_bottom_right,#ede9fe,transparent_35%),#f3f5f8] p-3 sm:p-6">
      <section className="flex h-[min(880px,calc(100dvh-24px))] w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white/95 shadow-[0_35px_100px_rgba(15,23,42,.18)] backdrop-blur-xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
              <MessageSquareText className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{data.agency.name}</p>
              <p className="mt-0.5 truncate text-xs text-slate-500">Secure case chat · {data.case.caseType}</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-2 text-[10px] font-semibold text-emerald-700">
            <LockKeyhole className="h-3.5 w-3.5" />
            Private
          </span>
        </header>
        <div className="border-b border-slate-100 bg-sky-50/60 px-5 py-3 text-xs leading-5 text-sky-800 sm:px-6">
          Hello {data.client.fullName}. Messages here become part of your case
          record. For emergencies or filing deadlines, call your consultant directly.
        </div>
        {error ? (
          <p className="mx-4 mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p>
        ) : null}

        <ChatThread
          messages={messages}
          mineDirection="Inbound"
          loading={false}
          className="min-h-0 flex-1 bg-slate-50/60 p-4 sm:p-6"
          mineBubbleClassName="rounded-br-lg bg-slate-950 text-white"
          theirBubbleClassName="rounded-bl-lg border border-slate-200 bg-white text-slate-800"
          attachmentFileUrl={resolveFileUrl}
          onAttachmentTap={handleAttachmentTap}
          senderLabelFor={(item) => item.senderUser?.fullName || data.agency.name}
          emptyState={
            <>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
                <MessageSquareText className="h-5 w-5" />
              </span>
              <h2 className="mt-4 text-sm font-semibold">Start a secure conversation</h2>
              <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">
                Ask a case-related question or send an update to your consultant.
              </p>
            </>
          }
        />

        <div className="border-t border-slate-100 bg-white p-4 sm:p-5">
          <ChatComposer
            value={message}
            onChange={setMessage}
            onSend={submit}
            onAttach={attachFile}
            sending={sending}
            placeholder="Write a message…"
            accentClassName="bg-slate-950"
          />
          <p className="mt-2 text-center text-[9px] text-slate-400">
            Access expires{" "}
            {new Date(data.expiresAt).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
      </section>
      <ChatImageLightbox attachment={lightbox?.attachment} fileUrl={lightbox?.url} onClose={() => setLightbox(null)} />
    </main>
  );
}
