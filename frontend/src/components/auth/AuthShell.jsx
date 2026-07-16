import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import logo from "../../assets/logo.png";

export const fieldClass = "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100";

export function AuthShell({ title, description, children, backTo, compact = false }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f3f6f9] px-5 py-10 text-slate-950">
      <div className="pointer-events-none absolute -left-32 -top-40 h-96 w-96 rounded-full bg-sky-200/35 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-44 -right-28 h-[28rem] w-[28rem] rounded-full bg-indigo-200/30 blur-3xl" />
      <section className={`relative w-full ${compact ? "max-w-md" : "max-w-2xl"} rounded-[2rem] border border-white/90 bg-white/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,.10)] backdrop-blur-xl sm:p-10`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3"><img src={logo} alt="CaseDesk" className="h-11 w-11 rounded-[14px] object-cover shadow-sm" /><span className="font-semibold tracking-tight">CaseDesk</span></div>
          {backTo && <Link to={backTo} className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Back</Link>}
        </div>
        <div className="mt-9"><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1><p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">{description}</p></div>
        {children}
      </section>
    </main>
  );
}

export function FormField({ label, children, hint }) {
  return <label className="block"><span className="text-sm font-medium text-slate-700">{label}</span>{children}{hint && <span className="mt-1.5 block text-xs text-slate-400">{hint}</span>}</label>;
}

export function FormMessage({ error, children }) {
  return <div role={error ? "alert" : "status"} className={`rounded-2xl px-4 py-3 text-sm ${error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{children}</div>;
}
