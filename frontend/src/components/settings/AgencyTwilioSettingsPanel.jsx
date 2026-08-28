import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  Phone,
  PhoneCall,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import api from "../../services/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { FieldLegend, FieldSet } from "../ui/field";

const inputClass =
  "mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100/70 disabled:bg-slate-100 disabled:text-slate-400";

const settingsCard =
  "rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6";

const blank = {
  configured: false,
  canManage: true,
  secureStorageReady: true,
  accountSid: "",
  fromNumber: "",
  messagingServiceSid: "",
  hasAuthToken: false,
  sendReady: false,
  apiKeySid: "",
  hasApiKeySecret: false,
  callsEnabled: false,
  voiceNumber: "",
  twimlAppSid: "",
  voiceReady: false,
  lastVerifiedAt: null,
  lastVerifiedStatus: null,
  lastVerifiedMessage: null,
  lastSmsTestedAt: null,
  lastSmsTestStatus: null,
  lastSmsTestMessage: null,
  lastCallTestedAt: null,
  lastCallTestStatus: null,
  lastCallTestMessage: null,
};

const errorMessage = (reason, fallback) => reason?.response?.data?.message || fallback;

function StatusNotice({ type = "success", children }) {
  const failed = type === "error";
  const Icon = failed ? AlertCircle : CheckCircle2;
  return (
    <div
      className={`flex items-start gap-3 rounded-3xl border px-5 py-4 text-sm leading-6 ${
        failed ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      {children}
    </div>
  );
}

function ConnectionBadge({ connected, pendingLabel = "Not connected" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
        connected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"
      }`}
    >
      {connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
      {connected ? "Connected" : pendingLabel}
    </span>
  );
}

function StaffAssignmentPicker({ staff, selectedIds, assignedElsewhere = new Map(), onToggle, disabled = false }) {
  const selected = new Set(selectedIds || []);
  return (
    <FieldSet className="gap-2">
      <FieldLegend variant="label" className="mb-1">Staff using this number</FieldLegend>
      <div data-slot="checkbox-group" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {staff.map((person) => {
          const otherLine = assignedElsewhere.get(person.id);
          const unavailable = Boolean(otherLine) && !selected.has(person.id);
          return (
            <label key={person.id} className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${selected.has(person.id) ? "border-sky-300 bg-sky-50 text-sky-950" : "border-slate-200 bg-white text-slate-700"} ${unavailable ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-sky-200"}`} title={unavailable ? `Already assigned to ${otherLine.phoneNumber}` : ""}>
              <input type="checkbox" checked={selected.has(person.id)} disabled={disabled || unavailable} onChange={() => onToggle(person.id)} className="size-4 rounded border-slate-300 text-sky-600" />
              <span className="min-w-0 truncate font-medium">{person.fullName}</span>
            </label>
          );
        })}
      </div>
      {!staff.length ? <p className="text-xs text-slate-500">No active staff members are available.</p> : null}
    </FieldSet>
  );
}

export default function AgencyTwilioSettingsPanel() {
  const [form, setForm] = useState(blank);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [accountSidInput, setAccountSidInput] = useState("");
  const [authTokenInput, setAuthTokenInput] = useState("");
  const [fromNumberInput, setFromNumberInput] = useState("");
  const [messagingServiceSidInput, setMessagingServiceSidInput] = useState("");
  const [testNumber, setTestNumber] = useState("");
  const [apiKeySidInput, setApiKeySidInput] = useState("");
  const [apiKeySecretInput, setApiKeySecretInput] = useState("");
  const [voiceNumberInput, setVoiceNumberInput] = useState("");
  const [callsEnabledInput, setCallsEnabledInput] = useState(false);
  const [numbers, setNumbers] = useState([]);
  const [numbersLoading, setNumbersLoading] = useState(false);
  const [lines, setLines] = useState([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [staff, setStaff] = useState([]);
  const [addLabel, setAddLabel] = useState("Frontdesk");
  const [addRouting, setAddRouting] = useState("FRONTDESK");
  const [addAssignedUserIds, setAddAssignedUserIds] = useState([]);
  const [addingSid, setAddingSid] = useState("");
  const [assignmentOpenLineId, setAssignmentOpenLineId] = useState("");
  const [updatingLineId, setUpdatingLineId] = useState("");
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [voiceTesting, setVoiceTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  // Each action group gets its own notice/error pair, rendered right below
  // that group's own button, instead of one shared banner at the top of the
  // panel that scrolls out of view once the Voice section (further down)
  // is where the actual click happened.
  const [credentialsNotice, setCredentialsNotice] = useState("");
  const [credentialsError, setCredentialsError] = useState("");
  const [voiceNotice, setVoiceNotice] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [linesNotice, setLinesNotice] = useState("");
  const [linesError, setLinesError] = useState("");
  const [voiceTestNotice, setVoiceTestNotice] = useState("");
  const [voiceTestError, setVoiceTestError] = useState("");
  const [loadError, setLoadError] = useState("");

  const mergeSettings = (data) => {
    setForm((current) => ({ ...current, ...data }));
    if (!data?.configured) {
      setEditing(true);
      setFromNumberInput(data?.fromNumber || "");
      setMessagingServiceSidInput(data?.messagingServiceSid || "");
    }
  };

  useEffect(() => {
    let active = true;
    api
      .get("/settings/twilio")
      .then((response) => {
        if (active) {
          mergeSettings(response.data.data);
          if (response.data.data?.configured) {
            void loadLines();
            void loadStaff();
          }
        }
      })
      .catch((reason) => {
        if (active) setLoadError(errorMessage(reason, "Twilio settings could not be loaded."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const saveCredentials = async (event) => {
    event.preventDefault();
    try {
      setSaving(true);
      setCredentialsError("");
      setCredentialsNotice("");
      const response = await api.put("/settings/twilio", {
        accountSid: accountSidInput || form.accountSid,
        authToken: authTokenInput,
        fromNumber: fromNumberInput,
        messagingServiceSid: messagingServiceSidInput,
      });
      mergeSettings(response.data.data);
      setEditing(false);
      setAccountSidInput("");
      setAuthTokenInput("");
      setCredentialsNotice("Twilio credentials saved. Verify them, then add a phone number or Messaging Service when you have one.");
    } catch (reason) {
      setCredentialsError(errorMessage(reason, "Twilio settings could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const verify = async () => {
    try {
      setVerifying(true);
      setCredentialsError("");
      setCredentialsNotice("");
      const response = await api.post("/settings/twilio/verify");
      mergeSettings(response.data.data);
      setCredentialsNotice("Twilio confirmed these credentials are valid.");
    } catch (reason) {
      if (reason?.response?.data?.data) mergeSettings(reason.response.data.data);
      setCredentialsError(errorMessage(reason, "Twilio credentials could not be verified."));
    } finally {
      setVerifying(false);
    }
  };

  const test = async () => {
    try {
      setTesting(true);
      setCredentialsError("");
      setCredentialsNotice("");
      const response = await api.post("/settings/twilio/test-sms", { to: testNumber });
      mergeSettings(response.data.data);
      setCredentialsNotice("Twilio accepted the test message. Confirm the phone received the text.");
    } catch (reason) {
      if (reason?.response?.data?.data) mergeSettings(reason.response.data.data);
      setCredentialsError(errorMessage(reason, "The Twilio test message failed."));
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    try {
      setDisconnecting(true);
      setCredentialsError("");
      await api.delete("/settings/twilio");
      setForm(blank);
      setEditing(true);
      setCredentialsNotice("Twilio has been disconnected. Calls and outbound texts are unavailable until it is reconnected.");
    } catch (reason) {
      setCredentialsError(errorMessage(reason, "Twilio could not be disconnected."));
    } finally {
      setDisconnecting(false);
    }
  };

  const saveVoice = async (event) => {
    event.preventDefault();
    try {
      setVoiceSaving(true);
      setVoiceError("");
      setVoiceNotice("");
      const response = await api.put("/settings/twilio", {
        apiKeySid: apiKeySidInput || form.apiKeySid,
        apiKeySecret: apiKeySecretInput,
        callsEnabled: callsEnabledInput,
        voiceNumber: voiceNumberInput || form.voiceNumber || form.fromNumber,
      });
      mergeSettings(response.data.data);
      setApiKeySidInput("");
      setApiKeySecretInput("");
      setVoiceNotice("Voice settings saved. Choose the number to answer and call from to finish setup.");
    } catch (reason) {
      setVoiceError(errorMessage(reason, "Voice settings could not be saved."));
    } finally {
      setVoiceSaving(false);
    }
  };

  const loadLines = async () => {
    try {
      setLinesLoading(true);
      setLinesError("");
      const response = await api.get("/twilio-calls/lines");
      setLines(response.data.data || []);
    } catch (reason) {
      setLinesError(errorMessage(reason, "Voice lines could not be loaded."));
    } finally {
      setLinesLoading(false);
    }
  };

  const loadStaff = async () => {
    try {
      const response = await api.get("/twilio-calls/staff");
      setStaff(response.data.data || []);
    } catch (reason) {
      setLinesError(errorMessage(reason, "Team members could not be loaded for direct-line assignment."));
    }
  };

  const loadNumbers = async () => {
    try {
      setNumbersLoading(true);
      setLinesError("");
      const response = await api.get("/twilio-calls/numbers");
      setNumbers(response.data.data || []);
    } catch (reason) {
      setLinesError(errorMessage(reason, "Twilio numbers could not be loaded."));
    } finally {
      setNumbersLoading(false);
    }
  };

  const addLine = async (numberSid) => {
    try {
      setAddingSid(numberSid);
      setLinesError("");
      setLinesNotice("");
      const response = await api.post("/twilio-calls/lines", {
        numberSid,
        label: addLabel,
        routing: addRouting,
        assignedUserIds: addRouting === "DIRECT" ? addAssignedUserIds : [],
      });
      const data = response.data.data;
      mergeSettings({ ...form, callsEnabled: true, voiceNumber: data.line.phoneNumber, twimlAppSid: data.twimlAppSid, lastCallTestStatus: "Connected" });
      setLinesNotice(`${data.line.label} line is live on ${data.line.phoneNumber}.`);
      setNumbers((current) => current.filter((item) => item.sid !== numberSid));
      setAddAssignedUserIds([]);
      await loadLines();
    } catch (reason) {
      setLinesError(errorMessage(reason, "The number could not be configured as a line."));
    } finally {
      setAddingSid("");
    }
  };

  const toggleLine = async (line, enabled) => {
    try {
      setUpdatingLineId(line.id);
      setLinesError("");
      await api.patch(`/twilio-calls/lines/${line.id}`, { enabled });
      await loadLines();
    } catch (reason) {
      setLinesError(errorMessage(reason, "The line could not be updated."));
    } finally {
      setUpdatingLineId("");
    }
  };

  const routeLine = async (line, routing) => {
    try {
      setUpdatingLineId(line.id);
      setLinesError("");
      setLinesNotice("");
      await api.patch(`/twilio-calls/lines/${line.id}`, {
        routing,
        assignedUserIds: routing === "DIRECT" ? line.assignedUserIds : [],
      });
      const routingLabel = routing === "FRONTDESK" ? "frontdesk staff" : routing === "INTERNAL" ? "the full team as an internal line" : "all staff";
      setLinesNotice(`${line.phoneNumber} now rings ${routingLabel}.`);
      await loadLines();
    } catch (reason) {
      setLinesError(errorMessage(reason, "The line routing could not be updated."));
    } finally {
      setUpdatingLineId("");
    }
  };

  const toggleLineAssignee = async (line, userId) => {
    const current = line.assignedUserIds || [];
    const next = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
    try {
      setUpdatingLineId(line.id);
      setLinesError("");
      setLinesNotice("");
      await api.patch(`/twilio-calls/lines/${line.id}`, {
        routing: next.length ? "DIRECT" : "STAFF",
        assignedUserIds: next,
      });
      setLinesNotice(next.length ? `${next.length} staff member${next.length === 1 ? "" : "s"} can now receive and place calls on ${line.phoneNumber}.` : `${line.phoneNumber} now rings all staff.`);
      await loadLines();
    } catch (reason) {
      setLinesError(errorMessage(reason, "The staff assignments could not be updated."));
    } finally {
      setUpdatingLineId("");
    }
  };

  const removeLine = async (line) => {
    try {
      setLinesError("");
      setLinesNotice("");
      await api.delete(`/twilio-calls/lines/${line.id}`);
      setLinesNotice(`${line.label} line removed.`);
      await loadLines();
    } catch (reason) {
      setLinesError(errorMessage(reason, "The line could not be removed."));
    }
  };

  const testVoice = async () => {
    try {
      setVoiceTesting(true);
      setVoiceTestError("");
      setVoiceTestNotice("");
      const response = await api.post("/twilio-calls/test");
      mergeSettings({ ...form, ...response.data.data });
      setVoiceTestNotice("Voice is ready — the browser softphone can place and receive calls.");
    } catch (reason) {
      if (reason?.response?.data?.data) mergeSettings({ ...form, ...reason.response.data.data });
      setVoiceTestError(errorMessage(reason, "The voice test failed."));
    } finally {
      setVoiceTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-[2rem] border border-slate-200 bg-white p-5">
        <div className="h-40 animate-pulse rounded-3xl bg-slate-100" />
      </div>
    );
  }

  const verified = form.lastVerifiedStatus === "Connected";
  const testConnected = form.lastSmsTestStatus === "Connected";
  const voiceReady = form.voiceReady;
  const voiceConnected = form.lastCallTestStatus === "Connected";
  const assignedLineByUserId = new Map(lines.flatMap((line) => (line.assignedUserIds || []).map((userId) => [userId, line])));
  const toggleNewLineAssignee = (userId) => setAddAssignedUserIds((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]);

  return (
    <div className="flex flex-col gap-6">
        <header className="border-b border-slate-200 pb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-700">
            <MessageSquareText className="h-5 w-5" />
          </div>
          <p className="mt-5 text-[12px] font-semibold uppercase tracking-[0.17em] text-sky-600">Phone &amp; messaging</p>
          <h2 className="mt-1.5 text-[30px] font-semibold leading-tight tracking-[-0.04em] text-slate-950 sm:text-[34px]">
            Connect Twilio
          </h2>
          <p className="mt-2 max-w-2xl text-[15px] leading-6 text-slate-600">
            Send client texts and handle calls through one Twilio connection.
          </p>
        </header>

        {!form.canManage ? <StatusNotice type="error">Only a workspace administrator can change this connection.</StatusNotice> : null}
        {!form.secureStorageReady ? (
          <StatusNotice type="error">Secure integration storage is unavailable. Configure the server encryption key first.</StatusNotice>
        ) : null}
        {loadError ? <StatusNotice type="error">{loadError}</StatusNotice> : null}

        <section className={settingsCard}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-500">Account</p>
                <h3 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-slate-950">Twilio credentials</h3>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                  Add your Account SID and Auth Token from the Twilio Console. A phone number is not required to save or verify
                  these.
                </p>
              </div>
            </div>
            <ConnectionBadge connected={verified} pendingLabel={form.configured ? form.lastVerifiedStatus || "Not verified" : "Not connected"} />
          </div>

          {editing || !form.configured ? (
            <form onSubmit={saveCredentials} className="mt-5 rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold text-slate-800">
                  Account SID
                  <input
                    required
                    value={accountSidInput || (editing ? form.accountSid : "")}
                    onChange={(event) => setAccountSidInput(event.target.value.trim())}
                    className={inputClass}
                    placeholder="AC..."
                    autoComplete="off"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-800">
                  Auth Token
                  <input
                    required={!form.hasAuthToken}
                    type="password"
                    value={authTokenInput}
                    onChange={(event) => setAuthTokenInput(event.target.value.trim())}
                    className={inputClass}
                    placeholder={form.hasAuthToken ? "Saved — leave blank to keep it" : "Paste the Auth Token"}
                    autoComplete="off"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-800">
                  Phone number <span className="font-normal text-slate-400">(optional — add later)</span>
                  <input
                    value={fromNumberInput}
                    onChange={(event) => setFromNumberInput(event.target.value)}
                    className={inputClass}
                    placeholder="+1 416 555 0100"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-800">
                  Messaging Service SID <span className="font-normal text-slate-400">(optional — add later)</span>
                  <input
                    value={messagingServiceSidInput}
                    onChange={(event) => setMessagingServiceSidInput(event.target.value.trim())}
                    className={inputClass}
                    placeholder="MG..."
                    autoComplete="off"
                  />
                </label>
              </div>
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs leading-5 text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Your Auth Token is encrypted and hidden after it is saved.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                {form.configured ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setAccountSidInput("");
                      setAuthTokenInput("");
                    }}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={saving || !form.canManage || !form.secureStorageReady}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  {saving ? "Saving…" : "Save connection"}
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-950">Account {form.accountSid}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {form.fromNumber || form.messagingServiceSid
                      ? `Sending from ${form.fromNumber || form.messagingServiceSid}`
                      : "No phone number or Messaging Service SID yet"}
                  </p>
                  {form.lastVerifiedMessage ? <p className="mt-1 text-xs text-slate-500">{form.lastVerifiedMessage}</p> : null}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={verifying || !form.canManage}
                    onClick={verify}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                    {verifying ? "Verifying…" : "Verify credentials"}
                  </button>
                  <button type="button" onClick={() => setEditing(true)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
                    Update
                  </button>
                  <button
                    type="button"
                    disabled={disconnecting}
                    onClick={disconnect}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-rose-100 bg-rose-50/80 text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
                    aria-label="Disconnect Twilio"
                  >
                    {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  value={testNumber}
                  onChange={(event) => setTestNumber(event.target.value)}
                  disabled={!form.sendReady}
                  className="h-11 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3.5 text-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100/70 disabled:bg-slate-100 disabled:text-slate-400"
                  placeholder={form.sendReady ? "Test phone: +1 416 555 0100" : "Add a phone number or Messaging Service SID first"}
                />
                <button
                  type="button"
                  disabled={testing || !testNumber.trim() || !form.canManage || !form.sendReady}
                  onClick={test}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(14,165,233,0.2)] transition-all duration-200 hover:bg-sky-500 active:scale-[0.98] disabled:opacity-50"
                >
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {testing ? "Sending…" : "Send test text"}
                </button>
              </div>
              {!form.sendReady ? (
                <p className="mt-2 text-xs text-slate-500">Add a Twilio phone number or Messaging Service SID above to send a test.</p>
              ) : !testConnected && form.lastSmsTestMessage ? (
                <p className="mt-2 text-xs text-slate-500">{form.lastSmsTestMessage}</p>
              ) : null}
            </div>
          )}
          {credentialsNotice ? <div className="mt-4"><StatusNotice>{credentialsNotice}</StatusNotice></div> : null}
          {credentialsError ? <div className="mt-4"><StatusNotice type="error">{credentialsError}</StatusNotice></div> : null}
        </section>

        <section className={settingsCard}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                <PhoneCall className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-500">Voice</p>
                <h3 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-slate-950">Calling from the browser</h3>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                  Let staff call clients from the Call center (dialpad, address book, incoming calls ringing the
                  workspace) using a Twilio API Key and a Voice-capable phone number.
                </p>
              </div>
            </div>
            <ConnectionBadge connected={voiceReady} pendingLabel={form.callsEnabled ? "Almost ready" : "Calling off"} />
          </div>

          {!form.configured ? (
            <p className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Save the Twilio Account SID and Auth Token above first — the API Key and number live on the same account.
            </p>
          ) : (
            <div className="mt-5 space-y-4">
              <form onSubmit={saveVoice} className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-800">
                    API Key SID
                    <input
                      value={apiKeySidInput || (form.apiKeySid || "")}
                      onChange={(event) => setApiKeySidInput(event.target.value.trim())}
                      className={inputClass}
                      placeholder="SK..."
                      autoComplete="off"
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-800">
                    API Key Secret
                    <input
                      type="password"
                      value={apiKeySecretInput}
                      onChange={(event) => setApiKeySecretInput(event.target.value.trim())}
                      className={inputClass}
                      placeholder={form.hasApiKeySecret ? "Saved — leave blank to keep it" : "Paste the API Key Secret"}
                      autoComplete="off"
                    />
                  </label>
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <label className="flex items-center gap-3 text-sm font-semibold text-slate-800">
                    <input type="checkbox" checked={callsEnabledInput} onChange={(event) => setCallsEnabledInput(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-sky-600" />
                    Enable calling for this workspace
                  </label>
                  <button
                    type="submit"
                    disabled={voiceSaving || !form.canManage}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50"
                  >
                    {voiceSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                    {voiceSaving ? "Saving…" : "Save voice settings"}
                  </button>
                </div>
                {voiceNotice ? <div className="mt-4"><StatusNotice>{voiceNotice}</StatusNotice></div> : null}
                {voiceError ? <div className="mt-4"><StatusNotice type="error">{voiceError}</StatusNotice></div> : null}
              </form>

              {!form.callsEnabled ? (
                <p className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  Enable calling and save to continue to the number setup.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Voice lines</p>
                        <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">
                          Assign a shared number to one or more staff members. Everyone assigned receives its calls and uses it automatically for outbound caller ID.
                        </p>
                      </div>
                      <button type="button" disabled={numbersLoading || linesLoading || !form.canManage} onClick={loadNumbers} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
                        <RefreshCw className={`h-3.5 w-3.5 ${numbersLoading ? "animate-spin" : ""}`} />Load my numbers
                      </button>
                    </div>
                    {linesNotice ? <div className="mt-3"><StatusNotice>{linesNotice}</StatusNotice></div> : null}
                    {linesError ? <div className="mt-3"><StatusNotice type="error">{linesError}</StatusNotice></div> : null}

                    {lines.length ? (
                      <div className="mt-4 flex flex-col gap-3">
                        {lines.map((line) => {
                          const assignedElsewhere = new Map([...assignedLineByUserId].filter(([, assignedLine]) => assignedLine.id !== line.id));
                          const assignmentOpen = assignmentOpenLineId === line.id;
                          const lineBusy = updatingLineId === line.id;
                          const routingLabel = line.routing === "FRONTDESK" ? "Frontdesk" : line.routing === "INTERNAL" ? "Internal" : line.routing === "DIRECT" ? `${line.assignedUserIds?.length || 0} assigned` : "All staff";
                          return (
                            <Card key={line.id} size="sm" className="gap-3 rounded-2xl bg-white py-4 shadow-none ring-slate-200">
                              <CardHeader className="gap-2 px-4 sm:grid-cols-[1fr_auto]">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <CardTitle>{line.label}</CardTitle>
                                    <Badge variant={line.routing === "DIRECT" ? "default" : "secondary"}>{routingLabel}</Badge>
                                    {line.isPrimary ? <Badge variant="outline">Primary</Badge> : null}
                                    {!line.enabled ? <Badge variant="outline">Paused</Badge> : null}
                                  </div>
                                  <CardDescription className="mt-1 font-medium tabular-nums text-slate-600">{line.phoneNumber}</CardDescription>
                                </div>
                                <CardAction className="flex flex-wrap items-center justify-end gap-2">
                                  <select value={line.routing} disabled={lineBusy} onChange={(event) => routeLine(line, event.target.value)} className="h-8 rounded-xl border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-sky-300" aria-label={`Route ${line.phoneNumber}`}>
                                    <option value="FRONTDESK">Frontdesk</option>
                                    <option value="STAFF">All staff</option>
                                    {line.routing === "DIRECT" ? <option value="DIRECT">Assigned staff</option> : null}
                                    <option value="INTERNAL">Internal line</option>
                                  </select>
                                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                                    <input type="checkbox" checked={line.enabled} disabled={lineBusy} onChange={(event) => toggleLine(line, event.target.checked)} className="size-4 rounded border-slate-300 text-sky-600" />Active
                                  </label>
                                  <Button type="button" variant="destructive" size="icon-sm" disabled={lineBusy} onClick={() => removeLine(line)} aria-label={`Remove ${line.label} line`}><Trash2 /></Button>
                                </CardAction>
                              </CardHeader>
                              <CardContent className="flex flex-col gap-3 px-4">
                                <div className="flex flex-wrap items-center gap-2">
                                  {line.assignedUsers?.map((person) => <Badge key={person.id} variant="outline">{person.fullName}</Badge>)}
                                  <Button type="button" variant="outline" size="sm" onClick={() => setAssignmentOpenLineId(assignmentOpen ? "" : line.id)}>
                                    <UsersRound data-icon="inline-start" />{assignmentOpen ? "Done" : line.assignedUserIds?.length ? "Manage staff" : "Assign staff"}
                                  </Button>
                                </div>
                                {assignmentOpen ? <StaffAssignmentPicker staff={staff} selectedIds={line.assignedUserIds} assignedElsewhere={assignedElsewhere} disabled={lineBusy} onToggle={(userId) => toggleLineAssignee(line, userId)} /> : null}
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    ) : null}

                    {numbers.length ? (
                      <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4">
                        <div className="grid gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200 sm:grid-cols-2">
                          <label className="text-xs font-semibold text-slate-700">Line label<input value={addLabel} onChange={(event) => setAddLabel(event.target.value)} className="mt-1.5 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 outline-none focus:border-sky-300" placeholder="e.g. Reception" /></label>
                          <label className="text-xs font-semibold text-slate-700">Routing<select value={addRouting} onChange={(event) => { setAddRouting(event.target.value); if (event.target.value !== "DIRECT") setAddAssignedUserIds([]); }} className="mt-1.5 h-9 w-full rounded-xl border border-slate-200 bg-white px-2 text-xs font-medium text-slate-900 outline-none focus:border-sky-300"><option value="FRONTDESK">Frontdesk</option><option value="STAFF">All staff</option><option value="DIRECT">Assigned staff</option><option value="INTERNAL">Internal line</option></select></label>
                          {addRouting === "DIRECT" ? <div className="sm:col-span-2"><StaffAssignmentPicker staff={staff} selectedIds={addAssignedUserIds} assignedElsewhere={assignedLineByUserId} onToggle={toggleNewLineAssignee} /></div> : null}
                        </div>
                        <p className="text-xs font-semibold text-slate-500">Available Twilio numbers</p>
                        {numbers.map((item) => (
                          <div key={item.sid} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 sm:flex-row sm:items-center">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-slate-900">{item.phoneNumber}</p>
                              <p className="truncate text-xs text-slate-500">{item.friendlyName || item.sid}</p>
                            </div>
                            <Button type="button" disabled={addingSid === item.sid || (addRouting === "DIRECT" && !addAssignedUserIds.length)} onClick={() => addLine(item.sid)}>
                              {addingSid === item.sid ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Phone data-icon="inline-start" />}Add this number
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : !lines.length && !linesLoading ? (
                      <p className="mt-3 text-xs text-slate-500">No lines yet and no free numbers loaded. Load my numbers to configure the frontdesk, office, and internal lines.</p>
                    ) : null}

                    {form.twimlAppSid ? (
                      <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-slate-500">Calling from <span className="font-semibold text-emerald-700">{form.voiceNumber}</span> · TwiML Application <span className="font-mono">{form.twimlAppSid}</span></p>
                        <button
                          type="button"
                          disabled={voiceTesting || !form.canManage}
                          onClick={testVoice}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:opacity-50"
                        >
                          {voiceTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          {voiceTesting ? "Testing…" : "Test voice"}
                        </button>
                      </div>
                    ) : null}
                    {voiceConnected && form.lastCallTestMessage ? <p className="text-xs text-slate-500">{form.lastCallTestMessage}</p> : null}
                    {voiceTestNotice ? <div className="mt-3"><StatusNotice>{voiceTestNotice}</StatusNotice></div> : null}
                    {voiceTestError ? <div className="mt-3"><StatusNotice type="error">{voiceTestError}</StatusNotice></div> : null}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
    </div>
  );
}
