import { FileSpreadsheet } from "lucide-react";

export default function CaseEasyOriginBadge() {
  return (
    <span title="This client was imported from Case Easy" className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold text-indigo-700 ring-1 ring-inset ring-indigo-200">
      <FileSpreadsheet className="h-3 w-3" />
      Case Easy
    </span>
  );
}
