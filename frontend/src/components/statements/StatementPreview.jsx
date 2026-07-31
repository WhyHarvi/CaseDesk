function formatMoney(statement, value) {
  return new Intl.NumberFormat(statement.agency.locale || "en-CA", { style: "currency", currency: statement.currency }).format(Number(value || 0));
}

function formatDate(statement, value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(statement.agency.locale || "en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: statement.agency.timezone || "America/Toronto" }).format(new Date(value));
}

function optional(values) {
  return values.filter(Boolean);
}

export default function StatementPreview({ statement }) {
  const closing = statement.summary.closingBalance;
  const period = statement.period.from || statement.period.to ? `${statement.period.from ? formatDate(statement, statement.period.from) : "Beginning"} – ${statement.period.to ? formatDate(statement, statement.period.to) : "Present"}` : "All transactions";
  const summary = [
    ["Opening", statement.summary.openingBalance], ["Charges", statement.summary.totalCharges],
    ["Payments", -statement.summary.totalPayments], ["Credits", -statement.summary.totalCredits],
    ["Refunds", statement.summary.totalRefunds], ["Adjustments", statement.summary.totalAdjustments],
  ];

  return (
    <article className="statement-print-root statement-print-card overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.08)]">
      <div className="p-6 sm:p-8">
        <div className="flex flex-col gap-6 border-b border-slate-200 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">{statement.agency.logoUrl ? <img src={statement.agency.logoUrl} alt="" className="h-12 w-12 rounded-xl object-contain" /> : null}<div><h3 className="text-base font-semibold text-slate-950">{statement.agency.legalName || statement.agency.name}</h3>{optional([statement.agency.address, statement.agency.phone, statement.agency.email, statement.agency.website]).map((line) => <p key={line} className="mt-0.5 text-xs text-slate-500">{line}</p>)}</div></div>
          <div className="sm:text-right"><h2 className="text-2xl font-semibold tracking-tight text-slate-950">Statement of Account</h2><p className="mt-1 text-xs text-slate-400">{statement.statementNumber}</p></div>
        </div>

        <div className="grid gap-6 border-b border-slate-200 py-6 sm:grid-cols-2">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Bill to</p><p className="mt-2 text-sm font-semibold text-slate-900">{statement.client.fullName}</p>{optional([statement.client.address, statement.client.email, statement.client.phone]).map((line) => <p key={line} className="mt-1 text-xs text-slate-500">{line}</p>)}<p className="mt-1 text-xs text-slate-500">Client ID: {statement.client.id}</p></div>
          <dl className="grid grid-cols-2 gap-4 text-xs"><div><dt className="font-bold uppercase tracking-wide text-slate-400">Generated</dt><dd className="mt-1 text-slate-700">{formatDate(statement, statement.generatedAt)}</dd></div><div><dt className="font-bold uppercase tracking-wide text-slate-400">Currency</dt><dd className="mt-1 text-slate-700">{statement.currency}</dd></div><div><dt className="font-bold uppercase tracking-wide text-slate-400">Period</dt><dd className="mt-1 text-slate-700">{period}</dd></div><div><dt className="font-bold uppercase tracking-wide text-slate-400">Source</dt><dd className="mt-1 text-slate-700">{statement.case?.caseType || "All billing"}</dd></div></dl>
        </div>

        <div className="grid grid-cols-2 gap-2 py-6 sm:grid-cols-3 lg:grid-cols-6">{summary.map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 px-3 py-3"><p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1.5 text-sm font-semibold text-slate-900">{formatMoney(statement, value)}</p></div>)}</div>

        {statement.syncWarning ? <p className="mb-5 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">{statement.syncWarning}</p> : null}

        <div className="overflow-x-auto"><table className="w-full min-w-[820px] border-collapse text-left text-xs"><thead><tr className="border-y border-slate-200 bg-slate-50 text-[9px] uppercase tracking-wide text-slate-400"><th className="px-2 py-3">Date</th><th className="px-2 py-3">Reference</th><th className="px-2 py-3">Type / Description</th><th className="px-2 py-3">File</th><th className="px-2 py-3 text-right">Charge</th><th className="px-2 py-3 text-right">Payment / Credit</th><th className="px-2 py-3 text-right">Refund</th><th className="px-2 py-3 text-right">Balance</th></tr></thead><tbody>{statement.transactions.length ? statement.transactions.map((item) => <tr key={item.id} className="border-b border-slate-100 align-top"><td className="whitespace-nowrap px-2 py-3 text-slate-500">{formatDate(statement, item.date)}</td><td className="px-2 py-3 font-medium text-slate-700">{item.reference}</td><td className="px-2 py-3"><span className="font-semibold text-slate-800">{item.type}</span><span className="mt-0.5 block text-slate-400">{item.description}</span></td><td className="px-2 py-3 text-slate-500">{item.caseReference || ""}</td><td className="px-2 py-3 text-right text-slate-700">{item.charge ? formatMoney(statement, item.charge) : ""}</td><td className="px-2 py-3 text-right text-emerald-700">{item.paymentOrCredit ? formatMoney(statement, item.paymentOrCredit) : ""}</td><td className="px-2 py-3 text-right text-rose-700">{item.refund ? formatMoney(statement, item.refund) : ""}</td><td className="px-2 py-3 text-right font-semibold text-slate-900">{formatMoney(statement, item.runningBalance)}</td></tr>) : <tr><td colSpan="8" className="px-4 py-10 text-center text-sm text-slate-400">No transactions for the selected period.</td></tr>}</tbody></table></div>

        <div className="mt-6 flex justify-end"><div className="w-full max-w-xs rounded-2xl bg-slate-950 px-5 py-4 text-white"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{closing < 0 ? "Credit Balance" : "Account Balance"}</p><p className="mt-1 text-2xl font-semibold">{formatMoney(statement, Math.abs(closing))}</p>{closing === 0 ? <p className="mt-1 text-xs text-slate-300">This account currently has no outstanding balance.</p> : null}</div></div>
        {closing > 0 && statement.agency.paymentInstructions ? <div className="mt-6"><p className="text-xs font-semibold text-slate-900">Payment instructions</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-500">{statement.agency.paymentInstructions}</p></div> : null}
        <p className="mt-8 border-t border-slate-200 pt-5 text-center text-[10px] leading-4 text-slate-400">This statement summarizes the transactions recorded on your account for the period shown above. Please contact our office if you have questions or believe any information is incorrect.</p>
      </div>
    </article>
  );
}
