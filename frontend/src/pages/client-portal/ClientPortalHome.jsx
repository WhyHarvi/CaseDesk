import { ArrowRight, CircleAlert, Clock3, FileText, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import ClientPortalHeader from "../../components/client-portal/ClientPortalHeader";
import ClientPortalSkeleton from "../../components/client-portal/ClientPortalSkeleton";
import ClientStatusCard from "../../components/client-portal/ClientStatusCard";
import ClientNextActionCard from "../../components/client-portal/ClientNextActionCard";
import ClientDocumentCard from "../../components/client-portal/ClientDocumentCard";
import ClientPaymentCard from "../../components/client-portal/ClientPaymentCard";
import ClientTimeline from "../../components/client-portal/ClientTimeline";
import { usePortalData } from "../../components/client-portal/ClientPortalLayout";
import usePortalFreeAppointmentOffer from "../../components/client-portal/usePortalFreeAppointmentOffer";

function SectionHeading({ title, to = null, linkLabel = "View all" }) {
  return (
    <div className="mb-3 flex items-center justify-between px-1">
      <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{title}</h2>
      {to ? (
        <Link to={to} className="inline-flex items-center gap-1 text-[13px] font-semibold text-sky-700 transition hover:text-sky-800">
          {linkLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

export default function ClientPortalHome() {
  const { overview, loading, error, refresh } = usePortalData();
  const freeBookingOffer = usePortalFreeAppointmentOffer(overview?.booking);

  if (loading) return <ClientPortalSkeleton rows={4} />;

  if (error || !overview) {
    return (
      <div className="pt-16">
        <div className="flex flex-col items-center rounded-3xl border border-white/70 bg-white/75 px-6 py-10 text-center backdrop-blur-xl">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-500"><CircleAlert className="h-6 w-6" /></div>
          <h2 className="mt-4 text-base font-semibold text-slate-900">We couldn't load your portal</h2>
          <p className="mt-1.5 max-w-xs text-sm leading-6 text-slate-500">{error || "Something went wrong."}</p>
          <button type="button" onClick={() => refresh()} className="mt-5 h-11 rounded-2xl bg-slate-950 px-6 text-sm font-semibold text-white transition active:scale-[0.98]">Try again</button>
        </div>
      </div>
    );
  }

  const attentionDocuments = overview.documents.filter((item) => ["Required", "Needs Changes"].includes(item.status));
  const previewDocuments = attentionDocuments.slice(0, 4);

  return (
    <div className="space-y-5">
      <ClientPortalHeader
        title={`Hi, ${overview.client.firstName}`}
        subtitle={overview.case?.caseType || "Welcome to your portal"}
        client={overview.client}
        agency={overview.agency}
      />

      <ClientNextActionCard nextAction={overview.nextAction} />
      {freeBookingOffer ? (
        <Link
          to="/client-portal/appointments"
          className="group flex items-center gap-3.5 rounded-3xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/95 via-white/90 to-sky-50/80 p-5 shadow-[0_16px_45px_rgba(16,185,129,0.1)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:shadow-[0_20px_50px_rgba(16,185,129,0.14)] active:scale-[0.99]"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-[0_10px_24px_rgba(5,150,105,0.24)]">
            <Sparkles className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-950">Free appointment available</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-700">
                <Clock3 className="h-3 w-3" /> 15 minutes only
              </span>
            </span>
            <span className="mt-1 block text-[13px] leading-5 text-slate-500">
              {freeBookingOffer.sessionName} is complimentary. Choose an available time to book.
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-emerald-700 transition group-hover:translate-x-0.5" />
        </Link>
      ) : null}
      <ClientStatusCard caseInfo={overview.case} />

      <section>
        <SectionHeading title="Documents we still need" to="/client-portal/documents" />
        {previewDocuments.length ? (
          <div className="space-y-3">
            {previewDocuments.map((document) => (
              <ClientDocumentCard key={document.id} document={document} onUploaded={() => refresh({ silent: true })} />
            ))}
            {attentionDocuments.length > previewDocuments.length ? (
              <Link to="/client-portal/documents" className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/70 text-sm font-semibold text-slate-700 backdrop-blur transition active:scale-[0.98]">
                View all documents
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-3xl border border-white/70 bg-white/75 p-5 backdrop-blur-xl">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><FileText className="h-[18px] w-[18px]" /></div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Nothing to upload right now</p>
              <p className="mt-0.5 text-[13px] text-slate-500">
                {overview.documents.length
                  ? "All requested documents are in. We'll let you know if anything else is needed."
                  : "Your document checklist will appear here once your consultant prepares it."}
              </p>
            </div>
          </div>
        )}
      </section>

      <ClientPaymentCard payment={overview.payment} compact />

      <section className="rounded-3xl border border-white/70 bg-white/75 p-5 backdrop-blur-xl">
        <SectionHeading title="Recent updates" />
        <ClientTimeline timeline={overview.timeline} limit={5} />
      </section>
    </div>
  );
}
