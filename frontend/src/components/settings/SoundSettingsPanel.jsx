import {
  Check,
  CircleAlert,
  Headphones,
  Loader2,
  Play,
  Speaker,
  Square,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Select from "../ui/Select";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { Separator } from "../ui/separator";
import { Slider } from "../ui/slider";
import { Switch } from "../ui/switch";
import { cn } from "../../lib/utils";
import { playNotificationSound } from "../../utils/chatSounds";
import {
  getSoundPreferences,
  NOTIFICATION_SOUNDS,
  RINGTONES,
  startConfiguredRingtone,
  subscribeToSoundPreferences,
  updateSoundPreferences,
} from "../../utils/soundPreferences";

function PreferenceGroup({ children }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      {children}
    </div>
  );
}

function PreferenceRow({ children, className }) {
  return (
    <div className={cn("grid gap-4 px-5 py-4 sm:grid-cols-[minmax(180px,0.8fr)_minmax(280px,1.2fr)] sm:items-center", className)}>
      {children}
    </div>
  );
}

function PreferenceCopy({ label, description, htmlFor }) {
  return (
    <div className="min-w-0">
      <FieldLabel htmlFor={htmlFor} className="text-sm font-medium text-foreground">{label}</FieldLabel>
      {description ? <FieldDescription className="mt-1">{description}</FieldDescription> : null}
    </div>
  );
}

function VolumeControl({ id, label, value, onChange, disabled = false }) {
  return (
    <Field data-disabled={disabled || undefined}>
      <div className="flex items-center gap-3">
        <Volume2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Slider
          id={id}
          aria-label={label}
          value={[value]}
          min={0}
          max={100}
          step={5}
          disabled={disabled}
          onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
        />
        <output htmlFor={id} className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
          {value}%
        </output>
      </div>
    </Field>
  );
}

export default function SoundSettingsPanel() {
  const [preferences, setPreferences] = useState(getSoundPreferences);
  const [outputs, setOutputs] = useState([]);
  const [deviceMessage, setDeviceMessage] = useState(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [testingRingtone, setTestingRingtone] = useState(false);
  const [saved, setSaved] = useState(false);
  const ringtonePreviewRef = useRef(null);
  const previewTimerRef = useRef(null);
  const savedTimerRef = useRef(null);

  const supportsOutputRouting =
    typeof Audio !== "undefined" && typeof Audio.prototype?.setSinkId === "function";

  const save = useCallback((patch) => {
    const next = updateSoundPreferences(patch);
    setPreferences(next);
    setSaved(true);
    window.clearTimeout(savedTimerRef.current);
    savedTimerRef.current = window.setTimeout(() => setSaved(false), 1800);
  }, []);

  const readOutputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    const nextOutputs = devices.filter(
      (device) =>
        device.kind === "audiooutput" &&
        device.deviceId !== "default" &&
        device.deviceId !== "communications",
    );
    setOutputs(nextOutputs);
    return nextOutputs;
  }, []);

  useEffect(() => {
    void readOutputs().catch(() => {});
    const mediaDevices = navigator.mediaDevices;
    mediaDevices?.addEventListener?.("devicechange", readOutputs);
    const unsubscribe = subscribeToSoundPreferences(setPreferences);
    return () => {
      mediaDevices?.removeEventListener?.("devicechange", readOutputs);
      unsubscribe();
      ringtonePreviewRef.current?.stop();
      window.clearTimeout(previewTimerRef.current);
      window.clearTimeout(savedTimerRef.current);
    };
  }, [readOutputs]);

  const chooseOutput = async () => {
    if (!navigator.mediaDevices || !supportsOutputRouting) return;
    setLoadingDevices(true);
    setDeviceMessage(null);
    try {
      if (typeof navigator.mediaDevices.selectAudioOutput === "function") {
        const device = await navigator.mediaDevices.selectAudioOutput();
        save({
          additionalOutputId: device.deviceId,
          additionalOutputLabel: device.label || "Selected speaker",
        });
        setDeviceMessage({
          title: "Speaker selected",
          description: "Use Test ringtone to confirm that both outputs ring.",
        });
      } else {
        let available = await readOutputs();
        const hasLabels = available.some((device) => device.label);
        if (!hasLabels && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((track) => track.stop());
          available = await readOutputs();
        }
        setDeviceMessage({
          title: available.length ? "Speakers found" : "No separate speaker found",
          description: available.length
            ? "Choose the system speaker from the Additional output menu."
            : "Connect a USB or Bluetooth audio device, then try again.",
        });
      }
    } catch (error) {
      setDeviceMessage({
        title: error?.name === "NotAllowedError" ? "Audio access is blocked" : "Speakers could not be opened",
        description:
          error?.name === "NotAllowedError"
            ? "Open this site’s permissions from the lock icon in the browser address bar, allow microphone access, then select Choose speaker again."
            : "Check that the speaker is connected, then try again.",
      });
    } finally {
      setLoadingDevices(false);
    }
  };

  const stopRingtonePreview = useCallback(() => {
    ringtonePreviewRef.current?.stop();
    ringtonePreviewRef.current = null;
    window.clearTimeout(previewTimerRef.current);
    setTestingRingtone(false);
  }, []);

  const testRingtone = () => {
    if (testingRingtone) {
      stopRingtonePreview();
      return;
    }
    ringtonePreviewRef.current = startConfiguredRingtone({ loop: true });
    setTestingRingtone(true);
    previewTimerRef.current = window.setTimeout(stopRingtonePreview, 8000);
  };

  const selectedOutputPresent = outputs.some(
    (device) => device.deviceId === preferences.additionalOutputId,
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Sound</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Manage call and notification sounds on this computer.
          </p>
        </div>
        <p className={cn("flex h-6 items-center gap-1.5 text-sm text-muted-foreground transition-opacity", saved ? "opacity-100" : "opacity-0")} aria-live="polite">
          <Check className="size-4" aria-hidden="true" /> Saved
        </p>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="incoming-calls-heading">
        <h3 id="incoming-calls-heading" className="text-base font-semibold text-foreground">Incoming calls</h3>
        <PreferenceGroup>
          <PreferenceRow>
            <PreferenceCopy label="Ringtone" description="Sound used for incoming calls." htmlFor="ringtone" />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Select
                id="ringtone"
                value={preferences.ringtoneId}
                onChange={(event) => save({ ringtoneId: event.target.value })}
                className="w-full sm:max-w-xs"
                disabled={!RINGTONES.length}
              >
                {RINGTONES.length ? RINGTONES.map((ringtone) => (
                  <option key={ringtone.id} value={ringtone.id}>{ringtone.label}</option>
                )) : <option value="">No ringtones found</option>}
              </Select>
              <Button type="button" variant="outline" size="lg" className="h-11" disabled={!RINGTONES.length} onClick={testRingtone}>
                {testingRingtone ? <Square data-icon="inline-start" /> : <Play data-icon="inline-start" />}
                {testingRingtone ? "Stop" : "Test"}
              </Button>
            </div>
          </PreferenceRow>
          <Separator />
          <PreferenceRow>
            <PreferenceCopy label="Ringtone volume" description="Does not change the volume of a connected call." htmlFor="ringtone-volume" />
            <VolumeControl
              id="ringtone-volume"
              label="Ringtone volume"
              value={preferences.ringtoneVolume}
              onChange={(ringtoneVolume) => save({ ringtoneVolume })}
            />
          </PreferenceRow>
        </PreferenceGroup>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="ringtone-output-heading">
        <h3 id="ringtone-output-heading" className="text-base font-semibold text-foreground">Ringtone output</h3>
        <PreferenceGroup>
          <PreferenceRow>
            <PreferenceCopy label="Default output" description="The output currently used by your browser." />
            <div className="flex items-center gap-2 text-sm text-foreground sm:justify-end">
              <Headphones className="size-4 text-muted-foreground" aria-hidden="true" /> Current browser output
            </div>
          </PreferenceRow>
          <Separator />
          <PreferenceRow>
            <PreferenceCopy label="Additional output" description="Also play the ringtone through a second speaker." htmlFor="additional-output" />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Select
                id="additional-output"
                value={preferences.additionalOutputId}
                disabled={!supportsOutputRouting}
                onChange={(event) => {
                  const selected = outputs.find((device) => device.deviceId === event.target.value);
                  save({
                    additionalOutputId: event.target.value,
                    additionalOutputLabel: selected?.label || "",
                  });
                }}
                className="w-full sm:max-w-xs"
              >
                <option value="">Off</option>
                {preferences.additionalOutputId && !selectedOutputPresent ? (
                  <option value={preferences.additionalOutputId}>
                    {preferences.additionalOutputLabel || "Previously selected speaker"}
                  </option>
                ) : null}
                {outputs.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Audio output ${index + 1}`}
                  </option>
                ))}
              </Select>
              <Button type="button" variant="outline" size="lg" className="h-11" disabled={loadingDevices || !supportsOutputRouting} onClick={chooseOutput}>
                {loadingDevices ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Speaker data-icon="inline-start" />}
                Choose speaker
              </Button>
            </div>
          </PreferenceRow>
        </PreferenceGroup>
        {!supportsOutputRouting ? (
          <Alert>
            <CircleAlert aria-hidden="true" />
            <AlertTitle>Additional output is not supported</AlertTitle>
            <AlertDescription>Use the latest Chrome or Edge to send the ringtone to a second speaker.</AlertDescription>
          </Alert>
        ) : null}
        {deviceMessage ? (
          <Alert>
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{deviceMessage.title}</AlertTitle>
            <AlertDescription>{deviceMessage.description}</AlertDescription>
          </Alert>
        ) : null}
        <p className="text-xs leading-5 text-muted-foreground">
          Call audio stays on the default output. USB and Bluetooth headsets provide the most reliable separate-speaker option.
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="notification-sounds-heading">
        <h3 id="notification-sounds-heading" className="text-base font-semibold text-foreground">Notification sounds</h3>
        <PreferenceGroup>
          <PreferenceRow>
            <PreferenceCopy label="Play notification sounds" description="Play a sound for new messages and alerts." htmlFor="notification-sounds" />
            <div className="flex justify-end">
              <Switch
                id="notification-sounds"
                checked={preferences.notificationSoundsEnabled}
                onCheckedChange={(checked) => save({ notificationSoundsEnabled: Boolean(checked) })}
                aria-label="Play notification sounds"
              />
            </div>
          </PreferenceRow>
          <Separator />
          <PreferenceRow className={cn(!preferences.notificationSoundsEnabled && "opacity-50")}>
            <PreferenceCopy label="Notification sound" description="Sound used for messages and alerts." htmlFor="notification-sound" />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Select
                id="notification-sound"
                value={preferences.notificationSoundId}
                disabled={!preferences.notificationSoundsEnabled}
                onChange={(event) => save({ notificationSoundId: event.target.value })}
                className="w-full sm:max-w-xs"
              >
                {NOTIFICATION_SOUNDS.map((sound) => (
                  <option key={sound.id} value={sound.id}>{sound.label}</option>
                ))}
              </Select>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11"
                disabled={!preferences.notificationSoundsEnabled || preferences.notificationVolume === 0}
                onClick={playNotificationSound}
              >
                <Play data-icon="inline-start" /> Test
              </Button>
            </div>
          </PreferenceRow>
          <Separator />
          <PreferenceRow className={cn(!preferences.notificationSoundsEnabled && "opacity-50")}>
            <PreferenceCopy label="Notification volume" htmlFor="notification-volume" />
            <VolumeControl
              id="notification-volume"
              label="Notification volume"
              value={preferences.notificationVolume}
              disabled={!preferences.notificationSoundsEnabled}
              onChange={(notificationVolume) => save({ notificationVolume })}
            />
          </PreferenceRow>
        </PreferenceGroup>
      </section>
    </div>
  );
}
