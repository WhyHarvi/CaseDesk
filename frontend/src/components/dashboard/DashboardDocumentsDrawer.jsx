import { ChevronDown, FileClock } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DashboardDrawer from "./DashboardDrawer";

function groupByCase(documents) {
  const groups = new Map();
  for (const doc of documents) {
    const key = doc.case?.id || `client-${doc.client.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        caseId: doc.case?.id || null,
        caseType: doc.case?.caseType || "General documents",
        clientName: doc.client?.fullName || "Unknown client",
        docs: [],
      });
    }
    groups.get(key).docs.push(doc);
  }
  return [...groups.values()];
}

function DocumentGroup({ group, expanded, onToggle, onNavigate }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white/80">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition hover:bg-amber-50/40"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{group.clientName}</p>
          <p className="truncate text-xs text-slate-500">{group.caseType}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">{group.docs.length} doc{group.docs.length === 1 ? "" : "s"}</span>
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>
      {expanded ? (
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {group.docs.map((doc) => (
            <Link
              key={doc.id}
              to={group.caseId ? `/app/cases/${group.caseId}?tab=documents&highlight=${doc.id}` : `/app/documents?highlight=${doc.id}`}
              onClick={onNavigate}
              className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm transition hover:bg-amber-50/30"
            >
              <span className="min-w-0 truncate font-medium text-slate-800">{doc.documentName}</span>
              <span className="whitespace-nowrap text-[11px] text-slate-400">{doc.status}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function DashboardDocumentsDrawer({ open, onClose, dashboard }) {
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  const documents = dashboard?.documentActions || [];
  const groups = useMemo(() => groupByCase(documents), [documents]);

  function toggle(key) {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <DashboardDrawer
      open={open}
      onClose={onClose}
      title="Pending documents"
      subtitle="Grouped by case — open one to see what's still outstanding."
      icon={FileClock}
    >
      {groups.length ? (
        <div className="space-y-2">
          {groups.map((group) => (
            <DocumentGroup
              key={group.key}
              group={group}
              expanded={expandedKeys.has(group.key)}
              onToggle={() => toggle(group.key)}
              onNavigate={onClose}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-500">No documents are awaiting action.</div>
      )}
    </DashboardDrawer>
  );
}
