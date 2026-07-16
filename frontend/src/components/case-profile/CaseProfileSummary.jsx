import {
  ArrowUpRight,
  BriefcaseBusiness,
  Clock3,
  History,
  Mail,
  MessageSquareText,
  Pencil,
  Phone,
  ShieldCheck,
  Smartphone,
  UserRound,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import PortalAccessCard from "../clients/PortalAccessCard";
import { ExpandingPillMenu, QuickActionLink, SimpleActionPill } from "./CaseProfileActions";
import { caseOptionItems, formatCurrency, getInitials, getStageStyles } from "./caseProfileUtils";

export function CaseProfileTopSection({ caseItem, paymentSummary, outstandingDocuments, onContactClient }) {
  return (
    <section className="grid gap-4 xl:grid-cols-[1.55fr_0.72fr]">
      <article className="rounded-[1.9rem] border border-white/80 bg-white/88 px-5 py-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#0f172a,#475569)] text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.16)]">
                {getInitials(caseItem.client?.fullName)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-xl font-semibold tracking-tight text-slate-950">
                    {caseItem.client?.fullName || "Unknown client"}
                  </h2>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${getStageStyles(caseItem.stage || caseItem.status)}`}>
                    {caseItem.stage || caseItem.status || "Open"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {caseItem.client?.phone || "No mobile"} <span className="mx-1.5 text-slate-300">•</span>
                  {caseItem.caseType || "No case type"} <span className="mx-1.5 text-slate-300">•</span>
                  {caseItem.assignedUser?.fullName || "Unassigned"}
                </p>
              </div>
            </div>

            <div className="mt-3 space-y-1.5 text-sm text-slate-600">
              <p>
                <span className="font-medium text-slate-900">Email:</span> {caseItem.client?.email || "No email on file"}
              </p>
              <p>
                <span className="font-medium text-slate-900">Client:</span>{" "}
                {caseItem.client?.id ? (
                  <Link to={`/clients/${caseItem.client.id}`} className="text-slate-900 underline decoration-slate-300 underline-offset-4 transition hover:decoration-slate-900">
                    Open client profile
                  </Link>
                ) : (
                  "Client profile unavailable"
                )}
              </p>
              <p>
                <span className="font-medium text-slate-900">Next:</span> {caseItem.nextAction || "No action set"}
              </p>
              <p>
                <span className="font-medium text-slate-900">Payments:</span> {formatCurrency(paymentSummary.balance)} balance
                <span className="text-slate-400"> • {paymentSummary.status}</span>
                <span className="text-slate-400"> • {outstandingDocuments.length ? `${outstandingDocuments.length} docs pending` : "Docs complete"}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:max-w-[42%] lg:justify-end">
            <QuickActionLink
              icon={Mail}
              label="Mail"
              onClick={() => onContactClient("Email")}
            />
            <QuickActionLink
              icon={Phone}
              label="Call"
              onClick={() => onContactClient("Call")}
            />
            <QuickActionLink
              icon={Smartphone}
              label="SMS"
              onClick={() => onContactClient("Sms")}
            />
            <QuickActionLink icon={MessageSquareText} label="CaseDesk chat" onClick={() => onContactClient("Chat")} />
          </div>
        </div>
      </article>

      {caseItem.client?.id ? (
        <PortalAccessCard
          clientId={caseItem.client.id}
          clientEmail={caseItem.client?.email}
          clientName={caseItem.client?.fullName}
        />
      ) : (
        <article className="rounded-[1.9rem] border border-white/80 bg-white/88 px-5 py-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Portal</p>
          <h3 className="mt-1 text-base font-semibold text-slate-950">Client access</h3>
          <p className="mt-1 text-sm text-slate-500">Link a client to this case to manage portal access.</p>
        </article>
      )}
    </section>
  );
}

export function CaseProfileToolbar({ activeToolbarTray, setActiveToolbarTray, onOpenWorkflow, onOpenApplicants, onOpenNotes, onOpenActivities, onOpenStatement }) {
  return (
    <section className="overflow-visible">
      <div className="overflow-x-auto overflow-y-visible pb-3">
        <div className="flex min-w-max items-start gap-2 overflow-visible">
          <ExpandingPillMenu
            icon={BriefcaseBusiness}
            label="Case options"
            items={caseOptionItems}
            isOpen={activeToolbarTray === "case-options"}
            onOpen={() => setActiveToolbarTray("case-options")}
            onClose={() => setActiveToolbarTray("")}
            onToggle={() => setActiveToolbarTray((current) => (current === "case-options" ? "" : "case-options"))}
            onSelect={(item) => {
              if (item === "Applicants") onOpenApplicants();
            }}
          />
          <SimpleActionPill icon={UserRound} label="Applicants" onClick={onOpenApplicants} />
          <SimpleActionPill icon={Pencil} label="Notes" onClick={onOpenNotes} />
          <SimpleActionPill icon={History} label="Activities" onClick={onOpenActivities} />
          <SimpleActionPill icon={Wallet} label="Statement of account" onClick={onOpenStatement} />
          <SimpleActionPill icon={Clock3} label="Time entries" />
          <SimpleActionPill icon={BriefcaseBusiness} label="Workflow" onClick={onOpenWorkflow} />
        </div>
      </div>
    </section>
  );
}
