import {
  AlertCircle,
  CheckCheck,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  Send,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../services/api";

const when = (value) =>
  new Date(value).toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function ClientChatPortal() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);

  const load = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const response = await api.get(`/client-communication/${token}`);
      setData(response.data.data);
      setError("");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Secure chat could not be opened.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages?.length]);
  useEffect(() => {
    if (!data?.realtime?.configured) {
      const timer = setInterval(() => void load({ silent: true }), 10_000);
      return () => clearInterval(timer);
    }
    let client;
    let live;
    let active = true;
    import("@supabase/supabase-js")
      .then(({ createClient }) => {
        if (!active) return;
        const config = data.realtime;
        client = createClient(config.url, config.anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        client.realtime.setAuth(config.token);
        live = client
          .channel(config.topic, { config: { private: true } })
          .on(
            "broadcast",
            { event: "message" },
            () => void load({ silent: true }),
          )
          .subscribe();
      })
      .catch(() => {});
    return () => {
      active = false;
      if (client && live) void client.removeChannel(live);
    };
  }, [data?.realtime?.token, token]);

  const submit = async (event) => {
    event.preventDefault();
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
      setError(
        requestError.response?.data?.message ||
          "Your message could not be sent.",
      );
    } finally {
      setSending(false);
    }
  };

  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f3f5f8]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
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
              <p className="truncate text-base font-semibold">
                {data.agency.name}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                Secure case chat · {data.case.caseType}
              </p>
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
          <p className="mx-4 mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-xs text-rose-700">
            {error}
          </p>
        ) : null}
        <div className="scrollbar-hidden min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-4 sm:p-6">
          {data.messages.length ? (
            data.messages.map((item) => {
              const client = item.direction === "Inbound";
              return (
                <article
                  key={item.id}
                  className={`flex ${client ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[86%] rounded-[1.35rem] px-4 py-3 shadow-sm ${client ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-800"}`}
                  >
                    <p className="whitespace-pre-wrap text-sm leading-6">
                      {item.bodyText}
                    </p>
                    <p
                      className={`mt-2 flex items-center gap-1 text-[9px] ${client ? "text-slate-400" : "text-slate-400"}`}
                    >
                      {client
                        ? "You"
                        : item.senderUser?.fullName || data.agency.name}{" "}
                      · {when(item.occurredAt)}
                      {!client ? <CheckCheck className="h-3 w-3" /> : null}
                    </p>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="flex h-full min-h-52 flex-col items-center justify-center text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
                <MessageSquareText className="h-5 w-5" />
              </span>
              <h2 className="mt-4 text-sm font-semibold">
                Start a secure conversation
              </h2>
              <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">
                Ask a case-related question or send an update to your
                consultant.
              </p>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <form
          onSubmit={submit}
          className="border-t border-slate-100 bg-white p-4 sm:p-5"
        >
          <div className="flex items-end gap-2 rounded-[1.4rem] border border-slate-200 bg-slate-50 p-2 focus-within:border-sky-300 focus-within:ring-4 focus-within:ring-sky-50">
            <textarea
              required
              rows={2}
              maxLength={5000}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              className="max-h-36 min-h-12 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-base leading-6 outline-none"
              placeholder="Write a message…"
            />
            <button
              type="submit"
              disabled={sending || !message.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white disabled:opacity-40"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
          <p className="mt-2 text-center text-[9px] text-slate-400">
            Access expires{" "}
            {new Date(data.expiresAt).toLocaleDateString("en-CA", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </form>
      </section>
    </main>
  );
}
