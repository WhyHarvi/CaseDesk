import { Loader2, MessageCircle, MessagesSquare } from "lucide-react";
import { useEffect, useState } from "react";
import api from "../../services/api";
import ConversationOverlay from "../case-profile/communication/ConversationOverlay";

function relativeTime(value) {
  if (!value) return "No messages yet";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export default function ClientCommunicationCard({ clientId, initialConversationId = null }) {
  const [conversations, setConversations] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [inbox, providers] = await Promise.all([
        api.get(`/communications/inbox?scope=all&channel=Chat&clientId=${encodeURIComponent(clientId)}&limit=20`),
        api.get("/communications/providers"),
      ]);
      const rows = inbox.data.data || [];
      setConversations(rows);
      if (initialConversationId && rows.some((item) => item.id === initialConversationId)) setSelectedId(initialConversationId);
      setPermissions(providers.data.meta?.permissions || {});
      setError("");
    } catch (reason) {
      setError(reason.response?.data?.message || "Client conversations could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [clientId]);

  return (
    <>
      <section id="client-communications" className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-panel backdrop-blur scroll-mt-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-100 text-sky-700"><MessagesSquare className="h-4 w-4" /></div>
            <div>
              <h3 className="text-lg font-semibold text-slate-950">Client chat</h3>
              <p className="mt-1 text-sm text-slate-500">Portal conversations, including messages sent before a case is opened.</p>
            </div>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{conversations.length}</span>
        </div>

        {loading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div> : null}
        {error ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
        {!loading && !error && !conversations.length ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
            <MessageCircle className="mx-auto h-5 w-5 text-slate-400" />
            <p className="mt-2 text-sm font-medium text-slate-700">No portal chat yet</p>
            <p className="mt-1 text-xs text-slate-500">When this client writes from the portal, the conversation will appear here.</p>
          </div>
        ) : null}
        {!loading && conversations.length ? (
          <div className="mt-5 divide-y divide-slate-100">
            {conversations.map((item) => {
              const last = item.messages?.[0];
              return (
                <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className="flex w-full items-center gap-3 py-3.5 text-left transition first:pt-0 last:pb-0 hover:opacity-75">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700"><MessageCircle className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">{item.subject || item.case?.caseType || "General inquiry"}</span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">{last?.bodyText || "Open conversation"}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[10px] text-slate-400">{relativeTime(item.lastMessageAt)}</span>
                    {item.unreadCount ? <span className="mt-1 inline-flex min-w-5 justify-center rounded-full bg-sky-600 px-1.5 py-0.5 text-[9px] font-bold text-white">{item.unreadCount}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      {selectedId ? (
        <ConversationOverlay
          conversationId={selectedId}
          permissions={permissions}
          onClose={() => setSelectedId(null)}
          onReply={() => {}}
          onChanged={load}
        />
      ) : null}
    </>
  );
}
