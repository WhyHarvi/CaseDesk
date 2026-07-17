import { ChevronDown, FileText, PenLine } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getPortalAgreements } from "../../api/clientPortalApi";
import ClientPortalHeader from "../../components/client-portal/ClientPortalHeader";
import ClientPortalSkeleton from "../../components/client-portal/ClientPortalSkeleton";
import ClientPortalEmptyState from "../../components/client-portal/ClientPortalEmptyState";
import ClientAgreementCard from "../../components/client-portal/ClientAgreementCard";
import ClientDocumentCard, { DOCUMENT_STATUS_TONE } from "../../components/client-portal/ClientDocumentCard";
import { usePortalData } from "../../components/client-portal/ClientPortalLayout";

const GROUPS = [
  { status: "Required", title: "Documents we still need", copy: "Upload these so your file can keep moving.", defaultOpen: true },
  { status: "Needs Changes", title: "Needs your attention", copy: "Your consultant asked for changes to these files.", defaultOpen: true },
  { status: "Uploaded", title: "Uploaded and waiting for review", copy: "We received these and will review them soon.", defaultOpen: true },
  { status: "Under Review", title: "Being reviewed", copy: "Your consultant is reviewing these documents.", defaultOpen: false },
  { status: "Accepted", title: "Accepted documents", copy: "Nothing more to do for these.", defaultOpen: false },
  { status: "Not Required", title: "Not required", copy: "These are not needed for your application.", defaultOpen: false },
];

function DocumentGroup({ group, documents, onUploaded }) {
  const [open, setOpen] = useState(group.defaultOpen);
  if (!documents.length) return null;

  return (
    <section className="overflow-hidden rounded-3xl border border-white/70 bg-white/60 backdrop-blur-xl">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition active:scale-[0.995]"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-slate-900">{group.title}</h2>
            <span className={["rounded-full px-2 py-0.5 text-[10px] font-bold", DOCUMENT_STATUS_TONE[group.status]].join(" ")}>{documents.length}</span>
          </div>
          <p className="mt-0.5 text-[12px] text-slate-500">{group.copy}</p>
        </div>
        <ChevronDown className={["h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300", open ? "rotate-180" : ""].join(" ")} />
      </button>
      <div className={["grid transition-[grid-template-rows] duration-300 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"].join(" ")}>
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-3 px-3 pb-3">
            {documents.map((document) => (
              <ClientDocumentCard key={document.id} document={document} onUploaded={onUploaded} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function ClientPortalDocuments() {
  const { overview, loading, error, refresh } = usePortalData();
  const [agreements, setAgreements] = useState([]);

  const loadAgreements = useCallback(
    () => getPortalAgreements().then(setAgreements).catch(() => {}),
    [],
  );
  useEffect(() => { loadAgreements(); }, [loadAgreements]);

  if (loading) return <ClientPortalSkeleton rows={4} />;
  if (error || !overview) {
    return (
      <div className="pt-16">
        <ClientPortalEmptyState
          icon={FileText}
          title="We couldn't load your documents"
          copy={error || "Something went wrong."}
          action={<button type="button" onClick={() => refresh()} className="mt-5 h-11 rounded-2xl bg-slate-950 px-6 text-sm font-semibold text-white transition active:scale-[0.98]">Try again</button>}
        />
      </div>
    );
  }

  const documents = overview.documents;
  const onUploaded = () => refresh({ silent: true });

  return (
    <div className="space-y-4">
      <ClientPortalHeader
        title="Documents"
        subtitle="Upload files and track their review status"
        client={overview.client}
        agency={overview.agency}
      />

      {agreements.length ? (
        <section>
          <div className="mb-3 flex items-center gap-2 px-1">
            <PenLine className="h-4 w-4 text-amber-600" />
            <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">For your signature</h2>
          </div>
          <div className="space-y-3">
            {agreements.map((agreement) => (
              <ClientAgreementCard
                key={agreement.id}
                agreement={agreement}
                onChanged={async () => {
                  await loadAgreements();
                  refresh({ silent: true });
                }}
              />
            ))}
          </div>
        </section>
      ) : null}

      {documents.length ? (
        GROUPS.map((group) => (
          <DocumentGroup
            key={group.status}
            group={group}
            documents={documents.filter((item) => item.status === group.status)}
            onUploaded={onUploaded}
          />
        ))
      ) : (
        <ClientPortalEmptyState
          icon={FileText}
          title="No documents requested yet"
          copy="When your consultant prepares your document checklist, every item will appear here with clear upload instructions."
        />
      )}
    </div>
  );
}
