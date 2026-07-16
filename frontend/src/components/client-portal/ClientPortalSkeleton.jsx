export function GlassCard({ children, className = "", onClick = undefined }) {
  const Tag = onClick ? "button" : "section";
  return (
    <Tag
      {...(onClick ? { type: "button", onClick } : {})}
      className={[
        "block w-full rounded-3xl border border-white/70 bg-white/75 text-left shadow-[0_16px_45px_rgba(28,45,74,0.09)] backdrop-blur-xl transition-all duration-200",
        onClick ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_20px_55px_rgba(28,45,74,0.13)] active:scale-[0.99]" : "",
        className,
      ].join(" ")}
    >
      {children}
    </Tag>
  );
}

export default function ClientPortalSkeleton({ rows = 4 }) {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="flex items-center justify-between py-4">
        <div className="space-y-2">
          <div className="h-3 w-24 animate-pulse rounded-full bg-slate-200/80" />
          <div className="h-7 w-44 animate-pulse rounded-2xl bg-slate-200/80" />
        </div>
        <div className="h-11 w-11 animate-pulse rounded-full bg-slate-200/80" />
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="animate-pulse rounded-3xl border border-white/70 bg-white/60 p-5 backdrop-blur-xl">
          <div className="h-4 w-1/3 rounded-full bg-slate-200/80" />
          <div className="mt-3 h-3 w-2/3 rounded-full bg-slate-200/70" />
          <div className="mt-2 h-3 w-1/2 rounded-full bg-slate-200/60" />
        </div>
      ))}
    </div>
  );
}
