import { useRef, useState } from "react";
import { ImageUp, RotateCcw } from "lucide-react";

const MAX_DIMENSION = 1000;

// Reads a chosen image file, downscales it if needed, and normalizes it to
// a PNG data URL — the backend only accepts PNG (see
// clientPortalController.js's drawnSignatureImage), and phone photos are
// often several MB, well past the 400KB stored-signature limit.
function fileToPngDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That file couldn't be read."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't a readable image."));
      img.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function SignatureImageUpload({ disabled = false, onChange }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      const dataUrl = await fileToPngDataUrl(file);
      setPreview(dataUrl);
      onChange?.(dataUrl);
    } catch (reason) {
      setError(reason.message || "That image couldn't be used.");
    }
  }

  function clear() {
    setPreview("");
    setError("");
    onChange?.("");
  }

  return (
    <div>
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-4">
        <p className="text-xs font-semibold text-slate-800">Background requirements for this photo</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Use a <span className="font-medium text-slate-700">plain white or transparent background</span> — a photo of your signature on lined, textured, or shadowed paper won't map cleanly onto the form.
          Sign on a blank white page, crop tightly around the signature, and photograph it straight-on in good light. PNG or JPG, up to 8&nbsp;MB.
        </p>
      </div>

      {preview ? (
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          <img src={preview} alt="Uploaded signature preview" className="h-16 max-w-[220px] object-contain" />
          <div className="ml-auto flex items-center gap-2">
            <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-40">Choose different file</button>
            <button type="button" disabled={disabled} onClick={clear} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />Remove</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="mt-3 flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-8 text-sm text-slate-500 transition hover:border-violet-300 hover:bg-violet-50/40 disabled:opacity-40"
        >
          <ImageUp className="h-5 w-5 text-slate-400" />
          Upload a photo of your signature
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleFile} />
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
