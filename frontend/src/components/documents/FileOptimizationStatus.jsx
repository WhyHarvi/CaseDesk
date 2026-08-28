import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

export const MAX_SOURCE_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_STORED_FILE_BYTES = 3.5 * 1024 * 1024;

export function formatUploadSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function beginOptimizedUpload(file, setStatus) {
  setStatus({ stage: "uploading", progress: 1, originalSize: file.size, fileName: file.name });
  return {
    timeout: 300_000,
    onUploadProgress(event) {
      const total = event.total || file.size;
      const progress = total ? Math.min(100, Math.round((event.loaded / total) * 100)) : 1;
      setStatus({
        stage: progress >= 100 ? "optimizing" : "uploading",
        progress,
        originalSize: file.size,
        fileName: file.name,
      });
    },
  };
}

export function uploadFileError(file) {
  if (file?.size > MAX_SOURCE_FILE_BYTES) {
    return `${file.name} is ${formatUploadSize(file.size)}. CaseDesk can optimize source files up to 25 MB.`;
  }
  return "";
}

export default function FileOptimizationStatus({ status, className = "" }) {
  if (!status) return null;
  const complete = status.stage === "complete";
  const optimizing = status.stage === "optimizing";
  const barWidth = complete ? 100 : optimizing ? 86 : Math.max(6, Math.round((status.progress || 0) * 0.72));
  const label = complete ? "Ready" : optimizing ? "Optimizing file" : `Uploading ${status.progress || 0}%`;

  return (
    <div className={`rounded-2xl border border-blue-100 bg-white p-3 shadow-[0_8px_24px_rgba(37,99,235,0.08)] ${className}`} role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          {complete ? <CheckCircle2 className="h-4 w-4" /> : optimizing ? <ShieldCheck className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-xs font-semibold text-slate-800">{label}</p>
            <p className="shrink-0 text-[10px] font-semibold text-slate-400">
              {formatUploadSize(status.originalSize)} → max 3.5 MB
            </p>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-50">
            <div
              className={`h-full rounded-full bg-blue-600 transition-[width] duration-200 ${optimizing ? "animate-pulse" : ""}`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
          <p className="mt-1.5 text-[10px] leading-4 text-slate-500">
            {complete
              ? `Saved at ${formatUploadSize(status.finalSize)}.`
              : optimizing
                ? "Reducing file size while preserving readable quality. Fillable PDF fields are protected."
                : "Sending the original securely. Optimization begins automatically when upload finishes."}
          </p>
        </div>
      </div>
    </div>
  );
}
