import { FileText, FileUp, Loader2, Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import { uploadPortalDocument, portalErrorMessage } from "../../api/clientPortalApi";
import { usePortalToast } from "./ClientPortalToast";
import { formatPortalDate } from "./ClientStatusCard";

export const DOCUMENT_STATUS_TONE = {
  Required: "bg-amber-100/90 text-amber-800",
  Uploaded: "bg-sky-100/90 text-sky-800",
  "Under Review": "bg-indigo-100/90 text-indigo-800",
  Accepted: "bg-emerald-100/90 text-emerald-800",
  "Needs Changes": "bg-rose-100/90 text-rose-700",
  "Not Required": "bg-slate-100 text-slate-500",
};

const UPLOADABLE = new Set(["Required", "Needs Changes", "Uploaded", "Under Review"]);
const ACCEPTED_TYPES = ".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf";

export default function ClientDocumentCard({ document, onUploaded }) {
  const { showToast } = usePortalToast();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const canUpload = UPLOADABLE.has(document.status);
  const primaryUpload = ["Required", "Needs Changes"].includes(document.status);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setError("Files must be 25 MB or smaller.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      await uploadPortalDocument(document.id, file);
      showToast(`${document.name} uploaded. We'll review it shortly.`);
      await onUploaded?.();
    } catch (reason) {
      setError(portalErrorMessage(reason, "The file could not be uploaded. Please try again."));
    } finally {
      setUploading(false);
    }
  }

  return (
    <article className="rounded-3xl border border-white/70 bg-white/75 p-5 shadow-[0_14px_40px_rgba(28,45,74,0.08)] backdrop-blur-xl transition-all duration-200">
      <div className="flex items-start gap-3 p-0.5">
        <div className={["flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", primaryUpload ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"].join(" ")}>
          <FileText className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[15px] font-semibold leading-5 text-slate-900">{document.name}</h3>
            <span className={["shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors duration-300", DOCUMENT_STATUS_TONE[document.status] || DOCUMENT_STATUS_TONE.Required].join(" ")}>
              {document.status}
            </span>
          </div>
          {document.description ? <p className="mt-1 text-[13px] leading-5 text-slate-500">{document.description}</p> : null}
          {document.uploadedFileName ? (
            <p className="mt-2 flex items-center gap-1.5 truncate text-xs text-slate-500">
              <Paperclip className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{document.uploadedFileName}</span>
            </p>
          ) : null}
          {document.updatedAt ? <p className="mt-1.5 text-[11px] text-slate-400">Updated {formatPortalDate(document.updatedAt)}</p> : null}
        </div>
      </div>

      {error ? <p className="mt-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">{error}</p> : null}

      {canUpload ? (
        <>
          <input ref={inputRef} type="file" accept={ACCEPTED_TYPES} className="hidden" onChange={handleFile} />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className={[
              "mt-3.5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold transition-all duration-200 active:scale-[0.98] disabled:opacity-60",
              primaryUpload
                ? "bg-slate-950 text-white shadow-[0_10px_24px_rgba(15,23,42,0.2)] hover:bg-slate-800"
                : "border border-slate-200 bg-white/80 text-slate-700 hover:border-slate-300",
            ].join(" ")}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            {uploading ? "Uploading…" : document.uploadedFileName ? "Replace file" : "Upload now"}
          </button>
        </>
      ) : null}
    </article>
  );
}
