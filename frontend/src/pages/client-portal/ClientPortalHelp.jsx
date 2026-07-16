import { ChevronDown, CircleHelp, Mail, MapPin, Phone, UserRound } from "lucide-react";
import { useState } from "react";
import ClientPortalHeader from "../../components/client-portal/ClientPortalHeader";
import ClientPortalSkeleton, { GlassCard } from "../../components/client-portal/ClientPortalSkeleton";
import ClientPortalEmptyState from "../../components/client-portal/ClientPortalEmptyState";
import { usePortalData } from "../../components/client-portal/ClientPortalLayout";

const FAQS = [
  {
    question: "How do I upload documents?",
    answer: "Open the Documents tab, find the item marked \"Required\" or \"Needs Changes\", and tap \"Upload now\". You can upload PDF, JPG, or PNG files up to 25 MB.",
  },
  {
    question: "What happens after I upload?",
    answer: "Your agency is notified and will review the file. Its status changes to \"Uploaded\", then \"Accepted\" once approved — or \"Needs Changes\" if something has to be fixed.",
  },
  {
    question: "How do I know if my document is accepted?",
    answer: "Check the Documents tab any time. Accepted files show a green \"Accepted\" badge, and the update also appears in your Recent updates on the home screen.",
  },
  {
    question: "Who do I contact for urgent questions?",
    answer: "Call or email your agency using the contact details on this page. Mention your name and application type so they can help you faster.",
  },
];

function FaqCard({ faq }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-3xl border border-white/70 bg-white/75 backdrop-blur-xl">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition active:scale-[0.995]">
        <span className="text-sm font-semibold text-slate-900">{faq.question}</span>
        <ChevronDown className={["h-[18px] w-[18px] shrink-0 text-slate-400 transition-transform duration-300", open ? "rotate-180" : ""].join(" ")} />
      </button>
      <div className={["grid transition-[grid-template-rows] duration-300 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"].join(" ")}>
        <div className="min-h-0 overflow-hidden">
          <p className="px-5 pb-4 text-sm leading-6 text-slate-500">{faq.answer}</p>
        </div>
      </div>
    </div>
  );
}

function ContactRow({ icon: Icon, label, value, href = null }) {
  if (!value) return null;
  const content = (
    <div className="flex items-center gap-3.5 px-5 py-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-700"><Icon className="h-[18px] w-[18px]" /></div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
        <p className="mt-0.5 break-words text-sm font-semibold text-slate-900">{value}</p>
      </div>
    </div>
  );
  return href ? (
    <a href={href} className="block border-b border-slate-100 transition last:border-0 hover:bg-white/60 active:scale-[0.995]">{content}</a>
  ) : (
    <div className="border-b border-slate-100 last:border-0">{content}</div>
  );
}

export default function ClientPortalHelp() {
  const { overview, loading, error } = usePortalData();

  if (loading) return <ClientPortalSkeleton rows={3} />;
  if (error || !overview) {
    return (
      <div className="pt-16">
        <ClientPortalEmptyState icon={CircleHelp} title="We couldn't load this page" copy={error || "Something went wrong."} />
      </div>
    );
  }

  const { agency, case: caseInfo, client } = overview;

  return (
    <div className="space-y-4">
      <ClientPortalHeader title="Help" subtitle="Contact your agency any time" client={client} agency={agency} />

      <GlassCard className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-[15px] font-semibold text-slate-900">Contact your consultant</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">The team at {agency.name} is here to help with your application.</p>
        </div>
        <ContactRow icon={UserRound} label="Your consultant" value={caseInfo?.consultantName || `${agency.name} team`} />
        <ContactRow icon={Mail} label="Email" value={agency.email} href={agency.email ? `mailto:${agency.email}` : null} />
        <ContactRow icon={Phone} label="Phone" value={agency.phone} href={agency.phone ? `tel:${agency.phone}` : null} />
        <ContactRow icon={MapPin} label="Office address" value={agency.address} />
      </GlassCard>

      <section>
        <h2 className="mb-3 px-1 text-[15px] font-semibold tracking-tight text-slate-900">Common questions</h2>
        <div className="space-y-3">
          {FAQS.map((faq) => <FaqCard key={faq.question} faq={faq} />)}
        </div>
      </section>
    </div>
  );
}
