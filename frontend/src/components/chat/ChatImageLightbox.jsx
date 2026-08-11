import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// A full-screen tap-to-expand view for an image attachment. Documents
// don't get an equivalent inline preview in this pass — tapping one
// downloads it instead, matching how WhatsApp itself treats non-image
// attachments; richer inline preview could reuse documentPreview.js later.
export default function ChatImageLightbox({ attachment, fileUrl, onClose }) {
  const reduceMotion = useReducedMotion();
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {attachment ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
          className="fixed inset-0 z-[600] flex items-center justify-center bg-slate-950/90 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close image"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          <motion.img
            initial={reduceMotion ? false : { scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { scale: 0.96, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
            src={fileUrl}
            alt={attachment.originalFilename || "Attachment"}
            className="max-h-[88vh] max-w-full rounded-2xl object-contain shadow-2xl"
          />
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
