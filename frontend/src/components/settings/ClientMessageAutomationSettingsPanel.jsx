import { AlarmClock, CalendarCheck2, CalendarSync, CalendarX2, ClipboardList, Loader2, MessageSquareText } from "lucide-react";
import { useEffect, useState } from "react";
import { getBookingSettings, updateBookingSettings } from "../../api/bookingApi";

const EVENTS = [
  { key: "booked", title: "Appointment booked", description: "Confirmation with the appointment date, time, format, and manage link.", icon: CalendarCheck2 },
  { key: "reminder", title: "Appointment reminder", description: "Sent at the reminder times configured under Scheduling.", icon: AlarmClock },
  { key: "rescheduled", title: "Appointment rescheduled", description: "Updated appointment details and calendar invitation.", icon: CalendarSync },
  { key: "cancelled", title: "Appointment cancelled", description: "Confirmation that the appointment was cancelled.", icon: CalendarX2 },
];

function Switch({ checked, disabled, label, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors disabled:cursor-wait disabled:opacity-60 ${checked ? "bg-emerald-500" : "bg-slate-300"}`}
    >
      <span className={`absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-all ${checked ? "left-[20px]" : "left-[2px]"}`} />
    </button>
  );
}

export default function ClientMessageAutomationSettingsPanel() {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getBookingSettings()
      .then((data) => { if (active) setSettings(data.settings); })
      .catch((reason) => { if (active) setError(reason.response?.data?.message || "Client message settings could not be loaded."); });
    return () => { active = false; };
  }, []);

  async function saveEvent(key, channel, enabled) {
    const savingKey = `${key}:${channel}`;
    setSaving(savingKey);
    setError("");
    setNotice("");
    try {
      if (key === "pre-consultation") {
        const updated = await updateBookingSettings({
          [channel === "email" ? "preConsultationEmailEnabled" : "preConsultationSmsEnabled"]: enabled,
        });
        setSettings(updated);
      } else {
        const channelKey = channel === "email" ? "emailEnabled" : "smsEnabled";
        const messageTemplates = {
          ...(settings.messageTemplates || {}),
          [key]: { ...(settings.messageTemplates?.[key] || {}), [channelKey]: enabled },
        };
        const updated = await updateBookingSettings({ messageTemplates });
        setSettings(updated);
      }
      setNotice(`${channel === "email" ? "Email" : "SMS"} for ${key === "pre-consultation" ? "the pre-consultation questionnaire" : EVENTS.find((event) => event.key === key)?.title.toLowerCase()} ${enabled ? "enabled" : "disabled"}.`);
    } catch (reason) {
      setError(reason.response?.data?.message || "The message automation could not be updated.");
    } finally {
      setSaving("");
    }
  }

  const rows = settings ? [
    ...EVENTS.map((event) => {
      const template = settings.messageTemplates?.[event.key] || {};
      return {
        ...event,
        emailEnabled: typeof template.emailEnabled === "boolean" ? template.emailEnabled : template.enabled !== false,
        smsEnabled: typeof template.smsEnabled === "boolean" ? template.smsEnabled : template.enabled !== false,
      };
    }),
    {
      key: "pre-consultation",
      title: "Pre-consultation questionnaire",
      description: "Email and text the immigration questionnaire after booking. Staff can still send it manually when this is off.",
      icon: ClipboardList,
      emailEnabled: settings.preConsultationEmailEnabled === true,
      smsEnabled: settings.preConsultationSmsEnabled === true,
    },
  ] : [];

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-5 py-5 sm:px-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600"><MessageSquareText className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-950">Automatic client messages</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Choose email and SMS separately for each appointment event. SMS is delivered through the Twilio connection under Phone &amp; SMS.</p>
          </div>
        </div>
      </header>

      {error ? <p className="mx-5 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 sm:mx-6">{error}</p> : null}
      {notice ? <p className="mx-5 mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 sm:mx-6">{notice}</p> : null}

      {!settings ? (
        <div className="flex items-center gap-2 px-6 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading message events…</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((event) => {
            const Icon = event.icon;
            const enabled = event.emailEnabled || event.smsEnabled;
            return (
              <div key={event.key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${enabled ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}><Icon className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500">{event.description}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:w-[230px]">
                  {[{ key: "email", label: "Email", checked: event.emailEnabled }, { key: "sms", label: "SMS", checked: event.smsEnabled }].map((channel) => {
                    const isSaving = saving === `${event.key}:${channel.key}`;
                    return (
                      <div key={channel.key} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <span className="text-xs font-semibold text-slate-600">{channel.label}</span>
                        {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : null}
                        <Switch checked={channel.checked} disabled={Boolean(saving)} label={`${event.title} ${channel.label}`} onChange={(next) => saveEvent(event.key, channel.key, next)} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <footer className="border-t border-slate-100 bg-slate-50/70 px-5 py-3 text-xs leading-5 text-slate-500 sm:px-6">Secure payment-link email and SMS remain enabled so clients are not left without a way to complete payment. Internal staff notifications are unaffected.</footer>
    </section>
  );
}
