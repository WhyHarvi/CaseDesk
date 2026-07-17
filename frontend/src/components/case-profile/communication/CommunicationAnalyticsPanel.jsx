import {
  AlertTriangle,
  Clock3,
  Inbox,
  Loader2,
  MessageSquareText,
  Send,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import api from "../../../services/api";

const channelColors = {
  Email: "bg-blue-500",
  Sms: "bg-emerald-500",
  Chat: "bg-violet-500",
  Call: "bg-amber-500",
};
const formatResponse = (minutes) =>
  minutes == null
    ? "No replies yet"
    : minutes < 60
      ? `${minutes} min`
      : `${(minutes / 60).toFixed(minutes < 600 ? 1 : 0)} hr`;

export default function CommunicationAnalyticsPanel({ caseId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get(`/communications/analytics?caseId=${encodeURIComponent(caseId)}`)
      .then((response) => {
        if (active) {
          setData(response.data.data);
          setError("");
        }
      })
      .catch((requestError) => {
        if (active)
          setError(
            requestError.response?.data?.message ||
              "Communication insights could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [caseId]);

  const maxDaily = useMemo(
    () => Math.max(1, ...(data?.dailyVolume || []).map((item) => item.count)),
    [data],
  );
  if (loading)
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  if (error)
    return (
      <p className="m-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error}
      </p>
    );
  const cards = [
    {
      label: "Messages",
      value: data.total,
      icon: MessageSquareText,
      tone: "bg-sky-50 text-sky-700",
    },
    {
      label: "Open threads",
      value: data.openConversations,
      icon: Inbox,
      tone: "bg-violet-50 text-violet-700",
    },
    {
      label: "First response",
      value: formatResponse(data.averageFirstResponseMinutes),
      icon: Clock3,
      tone: "bg-emerald-50 text-emerald-700",
    },
    {
      label: "Past response target",
      value: data.overdue,
      icon: AlertTriangle,
      tone: data.overdue
        ? "bg-rose-50 text-rose-700"
        : "bg-slate-50 text-slate-600",
    },
  ];
  return (
    <div className="space-y-4 bg-slate-50/50 p-4 sm:p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, tone }) => (
          <article
            key={label}
            className="rounded-3xl border border-white bg-white p-4 shadow-sm"
          >
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-2xl ${tone}`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <p className="mt-4 text-2xl font-semibold tracking-tight">
              {value}
            </p>
            <p className="mt-1 text-xs font-medium text-slate-500">{label}</p>
          </article>
        ))}
      </div>
      {data.resolutionOverdue ? (
        <p className="rounded-2xl bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
          {data.resolutionOverdue} open conversation
          {data.resolutionOverdue === 1 ? " is" : "s are"} past the workspace
          resolution target.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(15rem,0.8fr)]">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">30-day activity</h3>
              <p className="mt-1 text-xs text-slate-400">
                Inbound and outbound volume
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-semibold text-slate-500">
              Live case data
            </span>
          </div>
          <div className="mt-6 flex h-36 items-end gap-1.5">
            {(data.dailyVolume || []).length ? (
              data.dailyVolume.map((item) => (
                <div
                  key={item.day}
                  className="group relative flex min-w-1 flex-1 items-end"
                >
                  <span
                    className="w-full rounded-t-md bg-sky-400/80 transition hover:bg-sky-500"
                    style={{
                      height: `${Math.max(8, (item.count / maxDaily) * 100)}%`,
                    }}
                  />
                  <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-2 py-1 text-[9px] text-white group-hover:block">
                    {item.day} · {item.count}
                  </span>
                </div>
              ))
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                Activity will appear after communication begins.
              </div>
            )}
          </div>
        </section>
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold">Channel mix</h3>
              <p className="mt-1 text-xs text-slate-400">
                Where conversations happen
              </p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              <Send className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-5 space-y-4">
            {Object.entries(channelColors).map(([channel, color]) => {
              const count = data.byChannel?.[channel] || 0;
              const percent = data.total
                ? Math.round((count / data.total) * 100)
                : 0;
              return (
                <div key={channel}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold">
                      {channel === "Sms" ? "SMS" : channel}
                    </span>
                    <span className="text-slate-400">
                      {count} · {percent}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${color}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {data.deliveryRate != null ? (
            <p className="mt-5 rounded-2xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
              <span className="font-semibold text-slate-900">
                {data.deliveryRate}%
              </span>{" "}
              provider acceptance/delivery rate
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
