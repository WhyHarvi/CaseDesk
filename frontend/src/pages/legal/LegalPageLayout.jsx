import { Link } from "react-router-dom";

export default function LegalPageLayout({ title, lastUpdated, children }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-5">
          <Link to="/login" aria-label="CaseDesk sign in" className="flex items-center gap-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2">
            <img src="/favicon_logo.png" alt="" className="h-9 w-9 rounded-xl" />
            <span>
              <span className="block text-sm font-semibold text-slate-900">CaseDesk</span>
              <span className="block text-xs text-slate-500">by CHK Immigration Services Inc.</span>
            </span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">Last updated: {lastUpdated}</p>

        <div className="prose-legal mt-8 space-y-6 text-[15px] leading-7 text-slate-700">
          {children}
        </div>

        <nav aria-label="Legal and account links" className="mt-12 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-200 pt-6 text-sm">
          <Link to="/legal/privacy" className="font-medium text-sky-700 hover:underline">Privacy Policy</Link>
          <Link to="/legal/terms" className="font-medium text-sky-700 hover:underline">Terms of Service</Link>
          <Link to="/login" className="font-medium text-slate-500 hover:underline">Back to sign in</Link>
        </nav>
      </main>
    </div>
  );
}
