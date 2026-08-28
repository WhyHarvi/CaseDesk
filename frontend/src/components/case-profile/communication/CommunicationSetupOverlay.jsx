import { ArrowUpRight, Mail, MessageSquareText, PhoneCall, Settings2, Smartphone, X } from "lucide-react";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

const channels = {
  Email: { label: "email", title: "Workspace email", icon: Mail, section: "agency-email" },
  Call: { label: "calls", title: "Phone & SMS", icon: PhoneCall, section: "agency-phone" },
  Sms: { label: "SMS", title: "Phone & SMS", icon: Smartphone, section: "agency-phone" },
  Chat: { label: "secure chat", title: "Communication", icon: MessageSquareText, section: "communication-controls" },
};

export default function CommunicationSetupOverlay({ channel, reason, detail, caseItem, role, onClose }) {
  const config = channels[channel] || channels.Email;
  const Icon = config.icon;
  const isAdmin = role === "admin";
  const missingContact = reason === "contact";
  const permissionMissing = reason === "permission";

  return createPortal(
    <div className="fixed inset-0 z-[480] flex justify-end bg-slate-950/20 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="communication-setup-title">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close setup guidance" />
      <motion.section initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 330, damping: 34 }} className="relative flex h-full w-full max-w-md flex-col overflow-hidden border-l border-slate-200 bg-white shadow-[-24px_0_70px_rgba(15,23,42,0.18)]">
        <div className="p-6">
          <div className="flex items-start justify-between gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700"><Icon className="h-5 w-5" /></span><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:text-slate-900"><X className="h-4 w-4" /></button></div>
          <h3 id="communication-setup-title" className="mt-5 text-xl font-semibold tracking-tight text-slate-950">{missingContact ? `Add the client’s ${channel === "Email" ? "email" : "phone number"}` : permissionMissing ? `${config.title} access is restricted` : `Connect ${config.title}`}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {missingContact
              ? `${caseItem.client?.fullName || "This client"} does not have the contact detail needed for ${config.label}. Add it to the client record, then return here to contact them through CaseDesk.`
              : permissionMissing
                ? `Your account does not currently have permission to use ${config.label}. Ask a workspace administrator to update your communication permissions.`
                : isAdmin
                  ? `${config.label.charAt(0).toUpperCase() + config.label.slice(1)} is not connected for this agency. Complete the setup in Settings, then return here to contact the client.`
                  : `${config.label.charAt(0).toUpperCase() + config.label.slice(1)} is not connected for this agency. Ask a workspace administrator to complete the setup in Settings.`}
          </p>
          {detail && !missingContact ? <p className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">{detail}</p> : null}
        </div>
        <div className="mt-auto flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/75 p-4">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-200">Close</button>
          {missingContact ? <Link to={`/app/clients/${caseItem.client?.id}`} onClick={onClose} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Open client profile <ArrowUpRight className="h-4 w-4" /></Link> : isAdmin && !permissionMissing ? <Link to={`/app/settings?section=${config.section}`} onClick={onClose} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white"><Settings2 className="h-4 w-4" /> Open Settings</Link> : null}
        </div>
      </motion.section>
    </div>,
    document.body,
  );
}
