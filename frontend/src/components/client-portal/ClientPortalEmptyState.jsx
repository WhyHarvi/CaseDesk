export default function ClientPortalEmptyState({ icon: Icon, title, copy, action = null }) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-slate-300/80 bg-white/55 px-6 py-10 text-center backdrop-blur-xl">
      {Icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200/70 p-3.5 text-slate-500">
          <Icon className="h-6 w-6" />
        </div>
      ) : null}
      <h3 className="mt-4 text-[15px] font-semibold text-slate-900">{title}</h3>
      {copy ? <p className="mt-1.5 max-w-xs text-sm leading-6 text-slate-500">{copy}</p> : null}
      {action}
    </div>
  );
}
