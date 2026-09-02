import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, Voicemail } from "lucide-react";
import api from "../../services/api";

// Twilio's recording media URL requires the account's own credentials to
// fetch — a browser-issued <audio src> request carries no Authorization
// header, so it can't be pointed at that URL directly. This fetches the
// bytes through CaseDesk's own authenticated proxy instead (see
// callHistoryController.js's streamCallRecording) and hands the browser a
// local blob URL, so a caller's voicemail plays in place with one click
// rather than opening (and likely failing to load) a raw Twilio link.

// A lead or client can easily have several voicemails in their call
// history — only one should ever be audible at a time, so starting one
// pauses whichever other CallRecordingPlayer on the page was already
// playing, tracked here rather than through per-instance state.
let activeAudioEl = null;

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function CallRecordingPlayer({ callId, isVoicemail = false, compact = false }) {
  const [audioUrl, setAudioUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(null);

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  useEffect(() => () => { if (activeAudioEl === audioRef.current) activeAudioEl = null; }, []);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      if (activeAudioEl && activeAudioEl !== el) activeAudioEl.pause();
      activeAudioEl = el;
      el.play();
    } else {
      el.pause();
    }
  };

  const handleClick = async () => {
    if (audioUrl) {
      toggle();
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const response = await api.get(`/call-history/${callId}/recording`, { responseType: "blob" });
      setAudioUrl(URL.createObjectURL(response.data));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const idleLabel = isVoicemail ? "Play voicemail" : "Play recording";
  const buttonLabel = loading ? "Loading…" : error ? "Couldn't load — retry" : audioUrl ? formatTime(playing ? progress : duration) : idleLabel;
  const buttonSize = compact ? "h-7 px-2.5 text-[10px]" : "h-9 px-4 text-xs";

  return (
    <div className="inline-flex items-center gap-2">
      {audioUrl ? (
        <audio
          ref={audioRef}
          src={audioUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
          className="hidden"
        />
      ) : null}
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={`inline-flex items-center gap-1.5 rounded-full border font-semibold transition disabled:opacity-60 ${buttonSize} ${
          error ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : audioUrl ? (
          playing ? <Pause className="h-3.5 w-3.5 shrink-0" /> : <Play className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Voicemail className="h-3.5 w-3.5 shrink-0" />
        )}
        {buttonLabel}
      </button>
      {audioUrl && duration ? (
        <div className={`h-1 overflow-hidden rounded-full bg-slate-200 ${compact ? "w-10" : "w-16"}`}>
          <div className="h-full bg-slate-950 transition-[width]" style={{ width: `${Math.min(100, (progress / duration) * 100)}%` }} />
        </div>
      ) : null}
    </div>
  );
}
