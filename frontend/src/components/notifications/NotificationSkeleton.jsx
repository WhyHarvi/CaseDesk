export default function NotificationSkeleton() {
  return (
    <div className="space-y-2.5">
      {[0, 1, 2, 3].map((key) => (
        <div key={key} className="flex items-start gap-3 rounded-[1.35rem] border border-white/60 bg-white/60 p-3.5">
          <div className="h-10 w-10 animate-pulse rounded-[0.85rem] bg-slate-200/80" />
          <div className="flex-1 space-y-2 py-0.5">
            <div className="h-3 w-2/3 animate-pulse rounded-full bg-slate-200/80" />
            <div className="h-3 w-full animate-pulse rounded-full bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
