import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  Music,
  Phone,
  PhoneCall,
  RefreshCw,
  Send,
  ShieldCheck,
  Star,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Field, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

const inputClass =
  "mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100/70 disabled:bg-slate-100 disabled:text-slate-400";

const settingsCard =
  "rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6";

// The Web Speech API has no gender field on a voice — only a name and a
// lang code — so matching the selected Polly voice's gender means guessing
// from common voice names shipped by Chrome/Safari/Edge/Firefox.
const FEMALE_VOICE_HINTS = ["female", "samantha", "victoria", "karen", "moira", "tessa", "fiona", "zira", "susan", "hazel", "aria", "jenny", "sara", "amy", "emma", "joanna", "salli", "kendra", "allison", "ava", "susan"];
const MALE_VOICE_HINTS = ["male", "alex", "daniel", "fred", "david", "mark", "guy", "ryan", "matthew", "joey", "stephen", "tom", "eric", "christopher"];

// Picks a browser voice that at least matches the selected Polly voice's
// gender and is English — not the exact voice (no browser ships Polly's
// voices), just a closer approximation than whatever the browser defaults
// to regardless of what was picked below.
function matchingBrowserVoice(voices, gender) {
  const english = voices.filter((voice) => voice.lang?.toLowerCase().startsWith("en"));
  if (!english.length) return null;
  const hints = gender === "male" ? MALE_VOICE_HINTS : gender === "female" ? FEMALE_VOICE_HINTS : null;
  const matched = hints ? english.find((voice) => hints.some((hint) => voice.name.toLowerCase().includes(hint))) : null;
  return matched || english.find((voice) => voice.lang?.toLowerCase() === "en-us") || english[0];
}

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
  voiceGreetingText: "",
  voicemailGreetingText: "",
  whileWaitingGreetingText: "",
  ttsVoice: "",
  availableTtsVoices: [],
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

// Type-to-search, click-to-add multi-select — mirrors MultiCaseTypeCombobox's
// chip pattern (same visual language elsewhere in the app) rather than a
// checkbox grid, so assigning people to a shared line reads the same way as
// every other "pick some people/tags" control in CaseDesk.
function StaffAssignCombobox({ staff, value = [], assignedElsewhere = new Map(), onAdd, onRemove, disabled = false, placeholder = "Search team members…" }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [panelRect, setPanelRect] = useState(null);
  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onClickOutside(event) {
      if (containerRef.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function updatePanelRect() {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPanelRect({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    }
    updatePanelRect();
    window.addEventListener("resize", updatePanelRect);
    window.addEventListener("scroll", updatePanelRect, true);
    return () => {
      window.removeEventListener("resize", updatePanelRect);
      window.removeEventListener("scroll", updatePanelRect, true);
    };
  }, [open]);

  const selected = new Set(value);
  const assignedPeople = value.map((id) => staff.find((person) => person.id === id)).filter(Boolean);
  const needle = query.trim().toLowerCase();
  const matches = staff.filter((person) => !selected.has(person.id) && (!needle || person.fullName.toLowerCase().includes(needle)));

  return (
    <div ref={containerRef} className="relative">
      <div className={`flex min-h-10 flex-wrap items-center gap-1.5 rounded-2xl border px-2.5 py-1.5 transition ${disabled ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white focus-within:border-sky-300 focus-within:ring-4 focus-within:ring-sky-100"}`}>
        {assignedPeople.map((person) => (
          <span key={person.id} className="inline-flex items-center gap-1 rounded-full bg-slate-950 px-2.5 py-1 text-xs font-semibold text-white">
            {person.fullName}
            {!disabled ? (
              <button type="button" onClick={() => onRemove(person.id)} aria-label={`Remove ${person.fullName}`} className="rounded-full p-0.5 hover:bg-white/20">
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        ))}
        {!disabled ? (
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !query && assignedPeople.length) onRemove(assignedPeople[assignedPeople.length - 1].id);
            }}
            placeholder={assignedPeople.length ? "" : placeholder}
            autoComplete="off"
            className="h-7 min-w-[10rem] flex-1 border-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
        ) : null}
      </div>
      {!staff.length ? <p className="mt-1.5 text-xs text-slate-500">No active staff members are available.</p> : null}

      {open && !disabled && panelRect && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[700] max-h-56 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.14)]"
              style={{ top: `${panelRect.top}px`, left: `${panelRect.left}px`, width: `${panelRect.width}px` }}
            >
              {matches.length ? (
                matches.map((person) => {
                  const otherLine = assignedElsewhere.get(person.id);
                  return (
                    <button
                      key={person.id}
                      type="button"
                      disabled={Boolean(otherLine)}
                      onClick={() => { onAdd(person.id); setQuery(""); inputRef.current?.focus(); }}
                      className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
                    >
                      {person.fullName}
                      {otherLine ? <span className="text-xs font-normal text-slate-400">On {otherLine.phoneNumber}</span> : null}
                    </button>
                  );
                })
              ) : (
                <p className="px-3 py-2 text-sm text-slate-400">No matching team members.</p>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
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
  const [voiceGreetingInput, setVoiceGreetingInput] = useState("");
  const [voicemailGreetingInput, setVoicemailGreetingInput] = useState("");
  const [whileWaitingGreetingInput, setWhileWaitingGreetingInput] = useState("");
  const [ttsVoiceInput, setTtsVoiceInput] = useState("");
  const [numbers, setNumbers] = useState([]);
  const [numbersLoading, setNumbersLoading] = useState(false);
  const [lines, setLines] = useState([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [staff, setStaff] = useState([]);
  const [addLabel, setAddLabel] = useState("Frontdesk");
  const [addRouting, setAddRouting] = useState("FRONTDESK");
  const [addAssignedUserIds, setAddAssignedUserIds] = useState([]);
  const [addingSid, setAddingSid] = useState("");
  // Tracks which line the admin has explicitly switched to "Specific staff"
  // mode for, independent of what's actually saved server-side — picking
  // that segment should reveal the combobox immediately, before anyone is
  // assigned yet (the server only accepts DIRECT once at least one person is
  // attached, so the first save happens on the first add, not the click).
  const [directPinnedLineId, setDirectPinnedLineId] = useState("");
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
  const [greetingsSaving, setGreetingsSaving] = useState(false);
  const [greetingsNotice, setGreetingsNotice] = useState("");
  const [greetingsError, setGreetingsError] = useState("");
  const [previewingField, setPreviewingField] = useState("");
  const [browserVoices, setBrowserVoices] = useState([]);
  const [tuneFile, setTuneFile] = useState(null);
  const [tuneUrl, setTuneUrl] = useState("");
  const [tuneUploading, setTuneUploading] = useState(false);
  const [tuneRemoving, setTuneRemoving] = useState(false);
  const [tuneNotice, setTuneNotice] = useState("");
  const [tuneError, setTuneError] = useState("");
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

  // The select needs a real initial value (unlike the text fields above,
  // which fall back to form.* inline at render time) — sync it once the
  // saved voice loads, but only before the admin has touched the picker.
  useEffect(() => {
    if (form.ttsVoice && !ttsVoiceInput) setTtsVoiceInput(form.ttsVoice);
  }, [form.ttsVoice, ttsVoiceInput]);

  const saveGreetings = async (event) => {
    event.preventDefault();
    try {
      setGreetingsSaving(true);
      setGreetingsError("");
      setGreetingsNotice("");
      const response = await api.put("/settings/twilio", {
        voiceGreetingText: voiceGreetingInput || form.voiceGreetingText,
        voicemailGreetingText: voicemailGreetingInput || form.voicemailGreetingText,
        whileWaitingGreetingText: whileWaitingGreetingInput || form.whileWaitingGreetingText,
        ttsVoice: ttsVoiceInput || form.ttsVoice,
      });
      mergeSettings(response.data.data);
      setGreetingsNotice("Greetings saved.");
    } catch (reason) {
      setGreetingsError(errorMessage(reason, "Greetings could not be saved."));
    } finally {
      setGreetingsSaving(false);
    }
  };

  // Chrome loads voices asynchronously — getVoices() returns [] until
  // voiceschanged fires once, sometimes after the component's already
  // mounted. Firefox/Safari have them ready synchronously; calling
  // getVoices() again here is a harmless no-op there.
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return undefined;
    const loadVoices = () => setBrowserVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  // Approximate only — the browser's own speech voices, not the Amazon
  // Polly voice Twilio actually renders on a real call. There's no API to
  // synthesize Twilio's exact <Say> audio outside of placing a call, so
  // this is a quick "does the wording read naturally, in a similar voice"
  // check, not a byte-accurate preview of what callers will hear.
  const previewGreeting = (field, text) => {
    if (!text?.trim() || typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.trim());
    const selectedVoiceId = ttsVoiceInput || form.ttsVoice;
    const selectedVoice = (form.availableTtsVoices || []).find((voice) => voice.id === selectedVoiceId);
    const browserVoice = matchingBrowserVoice(browserVoices, selectedVoice?.gender);
    if (browserVoice) utterance.voice = browserVoice;
    setPreviewingField(field);
    utterance.onend = () => setPreviewingField("");
    utterance.onerror = () => setPreviewingField("");
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    if (!form.hasCustomTune) {
      setTuneUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return "";
      });
      return undefined;
    }
    let active = true;
    api.get("/settings/twilio/tune", { responseType: "blob" }).then((response) => {
      if (active) setTuneUrl(URL.createObjectURL(response.data));
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, [form.hasCustomTune]);

  useEffect(() => () => { if (tuneUrl) URL.revokeObjectURL(tuneUrl); }, [tuneUrl]);

  const uploadTune = async (event) => {
    event.preventDefault();
    if (!tuneFile) return;
    try {
      setTuneUploading(true);
      setTuneError("");
      setTuneNotice("");
      const payload = new FormData();
      payload.append("file", tuneFile);
      const response = await api.post("/settings/twilio/tune", payload);
      mergeSettings(response.data.data);
      setTuneFile(null);
      setTuneNotice("Tune uploaded. Callers will hear it while staff are being rung.");
    } catch (reason) {
      setTuneError(errorMessage(reason, "The tune could not be uploaded."));
    } finally {
      setTuneUploading(false);
    }
  };

  const removeTune = async () => {
    try {
      setTuneRemoving(true);
      setTuneError("");
      setTuneNotice("");
      await api.delete("/settings/twilio/tune");
      mergeSettings({ hasCustomTune: false, customTuneFilename: "", customTuneUploadedAt: null });
      setTuneNotice("Tune removed.");
    } catch (reason) {
      setTuneError(errorMessage(reason, "The tune could not be removed."));
    } finally {
      setTuneRemoving(false);
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

  const setPrimaryLine = async (line) => {
    try {
      setUpdatingLineId(line.id);
      setLinesError("");
      setLinesNotice("");
      await api.post(`/twilio-calls/lines/${line.id}/primary`);
      setLinesNotice(`${line.phoneNumber} is now the default calling number.`);
      await loadLines();
    } catch (reason) {
      setLinesError(errorMessage(reason, "This line could not be set as the default."));
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
  const addNewLineAssignee = (userId) => setAddAssignedUserIds((current) => (current.includes(userId) ? current : [...current, userId]));
  const removeNewLineAssignee = (userId) => setAddAssignedUserIds((current) => current.filter((id) => id !== userId));

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
                          Choose who receives inbound calls on each number, then select one default outbound caller ID. Assigning specific teammates does not change the number they call from.
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
                          const lineBusy = updatingLineId === line.id;
                          // Picking "Specific staff" reveals the combobox right away, even
                          // before the server has anything saved as DIRECT yet — it only
                          // switches over once the first person is actually added.
                          const displayedMode = directPinnedLineId === line.id ? "DIRECT" : line.routing;
                          const onModeChange = (next) => {
                            if (!next || next === displayedMode) return;
                            if (next === "DIRECT") {
                              setDirectPinnedLineId(line.id);
                              return;
                            }
                            setDirectPinnedLineId((current) => (current === line.id ? "" : current));
                            routeLine(line, next);
                          };
                          // The segmented control above already shows the routing type, so a
                          // badge repeating "Frontdesk"/"All staff"/"Internal" would just be
                          // noise next to a title that's often named the same thing. The one
                          // case worth a badge is DIRECT, where the assignee count isn't
                          // visible anywhere else on the card.
                          const routingLabel = line.routing === "DIRECT" ? `${line.assignedUserIds?.length || 0} assigned` : null;
                          return (
                            <Card key={line.id} size="sm" className="gap-3 rounded-2xl bg-white py-4 shadow-none ring-slate-200">
                              <CardHeader className="gap-2 px-4 sm:grid-cols-[1fr_auto]">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <CardTitle>{line.label}</CardTitle>
                                    {routingLabel ? <Badge variant="default">{routingLabel}</Badge> : null}
                                    {line.isPrimary ? (
                                      <Badge variant="outline" className="gap-1"><Star className="h-3 w-3 fill-current" />Default</Badge>
                                    ) : null}
                                    {!line.enabled ? <Badge variant="outline">Paused</Badge> : null}
                                  </div>
                                  <CardDescription className="mt-1 font-medium tabular-nums text-slate-600">{line.phoneNumber}</CardDescription>
                                </div>
                                <CardAction className="flex flex-wrap items-center justify-end gap-2">
                                  {!line.isPrimary ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      disabled={lineBusy || !line.enabled}
                                      onClick={() => setPrimaryLine(line)}
                                      title={line.enabled ? "Use this number as the default outbound caller ID" : "Enable this line first"}
                                    >
                                      Set as default
                                    </Button>
                                  ) : null}
                                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                                    <input type="checkbox" checked={line.enabled} disabled={lineBusy} onChange={(event) => toggleLine(line, event.target.checked)} className="size-4 rounded border-slate-300 text-sky-600" />Active
                                  </label>
                                  <Button type="button" variant="destructive" size="icon-sm" disabled={lineBusy} onClick={() => removeLine(line)} aria-label={`Remove ${line.label} line`}><Trash2 /></Button>
                                </CardAction>
                              </CardHeader>
                              <CardContent className="flex flex-col gap-3 px-4">
                                <ToggleGroup
                                  value={[displayedMode]}
                                  onValueChange={(next) => onModeChange(next[0])}
                                  variant="outline"
                                  size="sm"
                                  spacing={0}
                                  disabled={lineBusy}
                                  aria-label={`Who rings on ${line.phoneNumber}`}
                                >
                                  <ToggleGroupItem value="FRONTDESK">Frontdesk</ToggleGroupItem>
                                  <ToggleGroupItem value="STAFF">All staff</ToggleGroupItem>
                                  <ToggleGroupItem value="DIRECT">Specific staff</ToggleGroupItem>
                                  <ToggleGroupItem value="INTERNAL">Internal</ToggleGroupItem>
                                </ToggleGroup>
                                {displayedMode === "DIRECT" ? (
                                  <StaffAssignCombobox
                                    staff={staff}
                                    value={line.assignedUserIds}
                                    assignedElsewhere={assignedElsewhere}
                                    disabled={lineBusy}
                                    onAdd={(userId) => toggleLineAssignee(line, userId)}
                                    onRemove={(userId) => toggleLineAssignee(line, userId)}
                                  />
                                ) : null}
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    ) : null}

                    {numbers.length ? (
                      <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4">
                        <div className="grid gap-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200 sm:grid-cols-2">
                          <Field>
                            <FieldLabel htmlFor="new-voice-line-label">Line label</FieldLabel>
                            <Input id="new-voice-line-label" value={addLabel} onChange={(event) => setAddLabel(event.target.value)} placeholder="e.g. Reception" />
                          </Field>
                          <Field>
                            <FieldLabel>Who rings</FieldLabel>
                            <ToggleGroup
                              value={[addRouting]}
                              onValueChange={(next) => {
                                const value = next[0];
                                if (!value) return;
                                setAddRouting(value);
                                if (value !== "DIRECT") setAddAssignedUserIds([]);
                              }}
                              variant="outline"
                              size="sm"
                              spacing={0}
                              aria-label="Routing for the new line"
                            >
                              <ToggleGroupItem value="FRONTDESK">Frontdesk</ToggleGroupItem>
                              <ToggleGroupItem value="STAFF">All staff</ToggleGroupItem>
                              <ToggleGroupItem value="DIRECT">Specific staff</ToggleGroupItem>
                              <ToggleGroupItem value="INTERNAL">Internal</ToggleGroupItem>
                            </ToggleGroup>
                          </Field>
                          {addRouting === "DIRECT" ? (
                            <div className="sm:col-span-2">
                              <StaffAssignCombobox staff={staff} value={addAssignedUserIds} assignedElsewhere={assignedLineByUserId} onAdd={addNewLineAssignee} onRemove={removeNewLineAssignee} />
                            </div>
                          ) : null}
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

        {form.configured && form.callsEnabled ? (
          <section className={settingsCard}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                  <MessageSquareText className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-500">Greetings</p>
                  <h3 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-slate-950">What callers hear</h3>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                    What CaseDesk says while connecting a call, and if no one picks up and the caller is offered
                    voicemail. Leave either blank to skip it and go straight to ringing or a plain recording tone.
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={saveGreetings} className="mt-5 space-y-4">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-semibold text-slate-800" htmlFor="voice-greeting-input">While connecting your call</label>
                  <button
                    type="button"
                    onClick={() => previewGreeting("voice", voiceGreetingInput || form.voiceGreetingText)}
                    disabled={!(voiceGreetingInput || form.voiceGreetingText)?.trim()}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                  >
                    <Volume2 className={`h-3.5 w-3.5 ${previewingField === "voice" ? "animate-pulse text-sky-600" : ""}`} />
                    {previewingField === "voice" ? "Playing…" : "Preview"}
                  </button>
                </div>
                <textarea
                  id="voice-greeting-input"
                  rows={3}
                  maxLength={300}
                  value={voiceGreetingInput || (form.voiceGreetingText ?? "")}
                  onChange={(event) => setVoiceGreetingInput(event.target.value)}
                  className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100/70"
                  placeholder="Thank you for calling. Please hold while we connect you with our team."
                />
              </div>
              <div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-semibold text-slate-800" htmlFor="voicemail-greeting-input">If no one answers, before voicemail</label>
                  <button
                    type="button"
                    onClick={() => previewGreeting("voicemail", voicemailGreetingInput || form.voicemailGreetingText)}
                    disabled={!(voicemailGreetingInput || form.voicemailGreetingText)?.trim()}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                  >
                    <Volume2 className={`h-3.5 w-3.5 ${previewingField === "voicemail" ? "animate-pulse text-sky-600" : ""}`} />
                    {previewingField === "voicemail" ? "Playing…" : "Preview"}
                  </button>
                </div>
                <textarea
                  id="voicemail-greeting-input"
                  rows={3}
                  maxLength={300}
                  value={voicemailGreetingInput || (form.voicemailGreetingText ?? "")}
                  onChange={(event) => setVoicemailGreetingInput(event.target.value)}
                  className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100/70"
                  placeholder="We're unable to take your call right now. Please leave your name, number, and a brief message after the tone."
                />
              </div>
              <div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-semibold text-slate-800" htmlFor="while-waiting-greeting-input">While waiting to connect</label>
                  <button
                    type="button"
                    onClick={() => previewGreeting("waiting", whileWaitingGreetingInput || form.whileWaitingGreetingText)}
                    disabled={!(whileWaitingGreetingInput || form.whileWaitingGreetingText)?.trim()}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                  >
                    <Volume2 className={`h-3.5 w-3.5 ${previewingField === "waiting" ? "animate-pulse text-sky-600" : ""}`} />
                    {previewingField === "waiting" ? "Playing…" : "Preview"}
                  </button>
                </div>
                <textarea
                  id="while-waiting-greeting-input"
                  rows={3}
                  maxLength={300}
                  value={whileWaitingGreetingInput || (form.whileWaitingGreetingText ?? "")}
                  onChange={(event) => setWhileWaitingGreetingInput(event.target.value)}
                  className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100/70"
                  placeholder="Thanks for your patience — a member of our team will be with you shortly."
                />
                <p className="mt-1.5 text-xs text-slate-400">
                  Repeats on a loop while staff are being rung. If a custom tune is uploaded below, the tune plays
                  first — this joins in partway through, rather than interrupting it immediately.
                </p>
              </div>
              <p className="text-xs text-slate-400">
                Preview plays through your browser's own voice, as a quick check that the wording reads naturally — it
                won't sound exactly like the voice below, which is what callers actually hear.
              </p>
              <label className="block text-sm font-semibold text-slate-800">
                Greeting voice
                <select
                  value={ttsVoiceInput || form.ttsVoice}
                  onChange={(event) => setTtsVoiceInput(event.target.value)}
                  className={inputClass}
                >
                  {(form.availableTtsVoices || []).map((voice) => (
                    <option key={voice.id} value={voice.id}>{voice.label}</option>
                  ))}
                </select>
              </label>
              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  disabled={greetingsSaving || !form.canManage}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50"
                >
                  {greetingsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
                  {greetingsSaving ? "Saving…" : "Save greetings"}
                </button>
              </div>
              {greetingsNotice ? <StatusNotice>{greetingsNotice}</StatusNotice> : null}
              {greetingsError ? <StatusNotice type="error">{greetingsError}</StatusNotice> : null}
            </form>

            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50/60 p-4">
              <div className="flex items-center gap-2">
                <Music className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-semibold text-slate-900">Custom tune</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Upload your own audio — a jingle or hold music, 20 seconds or less. It plays first; the "While waiting
                to connect" message above joins in partway through, then both repeat on a loop while staff are being
                rung. Keeping it short matters: Twilio can't cut a track off mid-play, so a longer one delays the
                fallback to voicemail when nobody answers.
              </p>
              {form.hasCustomTune ? (
                <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{form.customTuneFilename || "Custom tune"}</p>
                    {tuneUrl ? <audio controls src={tuneUrl} className="mt-2 h-9 w-full max-w-xs" /> : null}
                  </div>
                  <button
                    type="button"
                    disabled={tuneRemoving || !form.canManage}
                    onClick={removeTune}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                  >
                    {tuneRemoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Remove
                  </button>
                </div>
              ) : (
                <form onSubmit={uploadTune} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(event) => setTuneFile(event.target.files?.[0] || null)}
                    className="block w-full flex-1 text-sm text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-800"
                  />
                  <button
                    type="submit"
                    disabled={!tuneFile || tuneUploading || !form.canManage}
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {tuneUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {tuneUploading ? "Uploading…" : "Upload"}
                  </button>
                </form>
              )}
              {tuneNotice ? <div className="mt-3"><StatusNotice>{tuneNotice}</StatusNotice></div> : null}
              {tuneError ? <div className="mt-3"><StatusNotice type="error">{tuneError}</StatusNotice></div> : null}
            </div>
          </section>
        ) : null}
    </div>
  );
}
