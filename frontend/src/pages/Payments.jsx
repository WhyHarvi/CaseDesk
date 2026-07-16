import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  Download,
  HandCoins,
  Info,
  MoreHorizontal,
  Plus,
  ShieldAlert,
  TrendingUp,
  Wallet,
} from "lucide-react";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const KPI_ITEMS = [
  {
    label: "Total Collected",
    amount: 0,
    trend: "0%",
    trendLabel: "no payment data yet",
    trendDirection: "neutral",
    icon: HandCoins,
    iconWrap: "bg-emerald-50 text-emerald-500 ring-emerald-100",
  },
  {
    label: "Outstanding Balance",
    amount: 0,
    trend: "0%",
    trendLabel: "no balance data yet",
    trendDirection: "neutral",
    icon: Wallet,
    iconWrap: "bg-amber-50 text-amber-500 ring-amber-100",
  },
  {
    label: "Paid This Month",
    amount: 0,
    trend: "0%",
    trendLabel: "no monthly payments yet",
    trendDirection: "neutral",
    icon: TrendingUp,
    iconWrap: "bg-blue-50 text-blue-500 ring-blue-100",
  },
  {
    label: "Overdue Invoices",
    amount: 0,
    trend: "0%",
    trendLabel: "no overdue invoices yet",
    trendDirection: "neutral",
    icon: ShieldAlert,
    iconWrap: "bg-violet-50 text-violet-500 ring-violet-100",
  },
];

const COLLECTIONS_TREND_DATA = [];

const PAYMENT_STATUS_DATA = [];

const PAYMENTS_BY_METHOD_DATA = [];

const UPCOMING_ITEMS = [];

const OUTSTANDING_BY_CASE_TYPE = [];

const RECENT_PAYMENTS = [];

const surfaceClass =
  "rounded-[30px] border border-white/80 bg-white/90 shadow-[0_22px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl";

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function buildConicGradient(items) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) {
    return "#E2E8F0 0% 100%";
  }
  let offset = 0;

  return items
    .map((item) => {
      const start = (offset / total) * 100;
      offset += item.value;
      const end = (offset / total) * 100;
      return `${item.color} ${start}% ${end}%`;
    })
    .join(", ");
}

function getAvatarClass(initials) {
  const map = {
    HS: "bg-rose-50 text-rose-500 ring-rose-100",
    SK: "bg-violet-50 text-violet-500 ring-violet-100",
    AG: "bg-amber-50 text-amber-600 ring-amber-100",
    RP: "bg-blue-50 text-blue-500 ring-blue-100",
    AR: "bg-purple-50 text-purple-500 ring-purple-100",
  };

  return map[initials] || "bg-slate-100 text-slate-500 ring-slate-200";
}

function getStatusClass(status) {
  const map = {
    Paid: "bg-emerald-50 text-emerald-600 ring-emerald-100",
    Partial: "bg-amber-50 text-amber-600 ring-amber-100",
    Overdue: "bg-rose-50 text-rose-600 ring-rose-100",
    "Due Soon": "bg-amber-50 text-amber-600 ring-amber-100",
    Upcoming: "bg-slate-100 text-slate-500 ring-slate-200",
  };

  return map[status] || "bg-slate-100 text-slate-600 ring-slate-200";
}

function PaymentsHeader() {
  return (
    <div className={cx(surfaceClass, "overflow-hidden p-4 sm:p-6 lg:p-8")}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">Payments</h1>
          <p className="mt-3 max-w-2xl text-base text-slate-500">
            Track collections, monitor outstanding balances, and manage payments.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-[0_12px_30px_rgba(15,23,42,0.05)] transition hover:text-slate-900"
          >
            <Download className="h-4 w-4" />
            Export
          </button>

          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.12)] transition hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            Record Payment
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ item }) {
  const Icon = item.icon;
  const trendIsUp = item.trendDirection === "up";
  const TrendIcon = trendIsUp ? ArrowUpRight : ArrowDownRight;
  const isNeutral = item.trendDirection === "neutral";

  return (
    <article className={cx(surfaceClass, "min-w-0 p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_64px_rgba(15,23,42,0.09)]")}> 
      <div className="flex min-w-0 items-center gap-3.5">
        <div className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-full ring-1", item.iconWrap)}>
          <Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold leading-4 text-slate-500">{item.label}</p>
          <p className="mt-1.5 truncate text-[21px] font-semibold leading-7 tracking-[-0.035em] text-slate-950">
            {money.format(item.amount)}
          </p>
          <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] font-semibold">
            <span className={cx("inline-flex items-center gap-0.5", isNeutral ? "text-slate-400" : trendIsUp ? "text-emerald-500" : "text-rose-500")}>
              {!isNeutral ? <TrendIcon className="h-3.5 w-3.5" /> : null}
              {item.trend}
            </span>
            <span className="truncate font-medium text-slate-500">{item.trendLabel}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function ChartHeader({ title, withFilter = false }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <h2 className="truncate text-[15px] font-semibold tracking-[-0.018em] text-slate-950">{title}</h2>
        <Info className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </div>

      {withFilter && (
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
        >
          This Year
          <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function CollectionsTrendCard() {
  if (!COLLECTIONS_TREND_DATA.length) {
    return (
      <section className={cx(surfaceClass, "min-h-[286px] min-w-0 overflow-hidden p-4 sm:p-5 xl:col-span-5")}>
        <ChartHeader title="Collections Trend" withFilter />
        <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-sm text-slate-500">
          No collection trend data yet.
        </div>
      </section>
    );
  }
  const chartWidth = 520;
  const chartHeight = 142;
  const maxValue = 40;
  const yTicks = [40, 30, 20, 10, 0];
  const points = COLLECTIONS_TREND_DATA.map((item, index) => {
    const x = (index / (COLLECTIONS_TREND_DATA.length - 1 || 1)) * chartWidth;
    const y = chartHeight - (item.value / maxValue) * chartHeight;
    return { ...item, x, y };
  });
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const areaPath = `${linePath} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`;

  return (
    <section className={cx(surfaceClass, "min-h-[286px] min-w-0 overflow-hidden p-4 sm:p-5 xl:col-span-5")}> 
      <ChartHeader title="Collections Trend" withFilter />

      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <p className="text-[25px] font-semibold leading-8 tracking-[-0.04em] text-slate-950">$128,540.00</p>
          <p className="mt-1 text-[12px] font-medium text-slate-500">Total collected (YTD)</p>
        </div>
        <div className="hidden rounded-full bg-emerald-50 px-3 py-1 text-[12px] font-semibold text-emerald-600 ring-1 ring-emerald-100 sm:block">
          +$13.8K this month
        </div>
      </div>

      <div className="mt-3 min-w-0 overflow-hidden">
        <div className="grid grid-cols-[38px_minmax(0,1fr)] gap-2">
          <div className="flex h-[164px] flex-col justify-between pt-1 text-[11px] font-medium text-slate-500">
            {yTicks.map((tick) => (
              <span key={tick}>${tick}K</span>
            ))}
          </div>

          <div className="min-w-0">
            <svg viewBox={`0 0 ${chartWidth} 164`} className="h-[164px] w-full overflow-visible">
              <defs>
                <linearGradient id="collectionsAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22C55E" stopOpacity="0.24" />
                  <stop offset="100%" stopColor="#22C55E" stopOpacity="0" />
                </linearGradient>
              </defs>

              {yTicks.map((tick) => {
                const y = chartHeight - (tick / maxValue) * chartHeight;
                return (
                  <line
                    key={tick}
                    x1="0"
                    y1={y}
                    x2={chartWidth}
                    y2={y}
                    stroke="#E2E8F0"
                    strokeDasharray="4 7"
                  />
                );
              })}

              <path d={areaPath} fill="url(#collectionsAreaGradient)" />
              <path d={linePath} fill="none" stroke="#22C55E" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.2" />

              {points.map((point, index) => (
                <circle
                  key={point.month}
                  cx={point.x}
                  cy={point.y}
                  r={index === points.length - 1 ? 5 : 3.6}
                  fill="#fff"
                  stroke="#22C55E"
                  strokeWidth="2.4"
                />
              ))}
            </svg>

            <div className="-mt-1 grid grid-cols-8 text-center text-[11px] font-medium text-slate-500">
              {COLLECTIONS_TREND_DATA.map((item) => (
                <span key={item.month}>{item.month}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PaymentStatusCard() {
  const total = PAYMENT_STATUS_DATA.reduce((sum, item) => sum + item.value, 0);

  return (
    <section className={cx(surfaceClass, "min-h-[286px] min-w-0 p-4 sm:p-5 xl:col-span-4")}> 
      <ChartHeader title="Payment Status" />

      <div className="mt-5 grid min-h-[202px] items-center gap-5 sm:grid-cols-[170px_minmax(0,1fr)] xl:grid-cols-1 2xl:grid-cols-[170px_minmax(0,1fr)]">
        <div className="relative mx-auto h-[166px] w-[166px] shrink-0">
          <div
            className="absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.55)]"
            style={{ background: `conic-gradient(${buildConicGradient(PAYMENT_STATUS_DATA)})` }}
          />
          <div className="absolute inset-[22px] flex flex-col items-center justify-center rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(226,232,240,0.9)]">
            <span className="text-[12px] font-medium text-slate-500">Total</span>
            <span className="mt-1 text-[25px] font-semibold tracking-[-0.04em] text-slate-950">{total}</span>
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          {PAYMENT_STATUS_DATA.length ? PAYMENT_STATUS_DATA.map((item) => (
            <div key={item.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="truncate text-[12px] font-medium text-slate-600">{item.name}</span>
              </div>
              <span className="text-[12px] font-semibold tabular-nums text-slate-700">
                {item.value} ({item.percent})
              </span>
            </div>
          )) : <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">No payment status data yet.</div>}
        </div>
      </div>
    </section>
  );
}

function PaymentsByMethodCard() {
  if (!PAYMENTS_BY_METHOD_DATA.length) {
    return (
      <section className={cx(surfaceClass, "min-h-[286px] min-w-0 overflow-hidden p-4 sm:p-5 xl:col-span-3")}>
        <ChartHeader title="Payments by Method" withFilter />
        <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-sm text-slate-500">
          No payment method data yet.
        </div>
      </section>
    );
  }
  const maxValue = 70;
  const yTicks = [60, 40, 20, 0];

  return (
    <section className={cx(surfaceClass, "min-h-[286px] min-w-0 overflow-hidden p-4 sm:p-5 xl:col-span-3")}> 
      <ChartHeader title="Payments by Method" withFilter />

      <div className="mt-4 grid grid-cols-[36px_minmax(0,1fr)] gap-2">
        <div className="flex h-[194px] flex-col justify-between pt-1 text-[11px] font-medium text-slate-500">
          {yTicks.map((tick) => (
            <span key={tick}>${tick}K</span>
          ))}
        </div>

        <div className="relative h-[194px] min-w-0">
          {yTicks.map((tick) => (
            <div
              key={tick}
              className="absolute left-0 right-0 border-t border-dashed border-slate-200"
              style={{ top: `${(1 - tick / maxValue) * 100}%` }}
            />
          ))}

          <div className="relative z-[1] flex h-full items-end justify-between gap-2 px-1">
            {PAYMENTS_BY_METHOD_DATA.map((item) => (
              <div key={item.method} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
                <span className="whitespace-nowrap text-[11px] font-semibold text-slate-700">${item.amount}K</span>
                <div className="flex h-[124px] w-full items-end justify-center rounded-t-xl bg-slate-50/70">
                  <div
                    className="w-[22px] rounded-t-[9px] shadow-[0_10px_22px_rgba(15,23,42,0.12)]"
                    style={{
                      height: `${(item.amount / maxValue) * 100}%`,
                      background: `linear-gradient(180deg, ${item.color} 0%, ${item.color}CC 100%)`,
                    }}
                  />
                </div>
                <div className="h-8 text-center text-[10.5px] font-medium leading-4 text-slate-500">
                  {item.method.split("\n").map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function UpcomingOverduePanel() {
  return (
    <aside className={cx(surfaceClass, "min-w-0 p-4 sm:p-5 xl:min-h-[418px]")}> 
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-slate-950">Upcoming / Overdue</h2>
        <button type="button" className="text-[12px] font-semibold text-blue-600 transition hover:text-blue-700">
          View all
        </button>
      </div>

      <div className="space-y-1">
        {UPCOMING_ITEMS.length ? UPCOMING_ITEMS.map((item) => (
          <div key={item.caseId} className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 rounded-[18px] px-1 py-2.5 transition hover:bg-slate-50/80">
            <div className={cx("flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-semibold ring-1", getAvatarClass(item.initials))}>
              {item.initials}
            </div>

            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-slate-900">{item.name}</p>
              <p className="mt-0.5 truncate text-[12px] font-medium text-slate-500">{item.caseId}</p>
            </div>

            <div className="min-w-[106px] text-right">
              <p className="whitespace-nowrap text-[11px] font-medium text-slate-500">{item.dueDate}</p>
              <p className={cx("mt-1 text-[12px] font-semibold", item.tone === "danger" ? "text-rose-500" : item.tone === "warning" ? "text-amber-500" : "text-slate-600")}>
                {money.format(item.amount)}
              </p>
              <span className={cx("mt-1.5 inline-flex h-6 items-center rounded-full px-2.5 text-[10.5px] font-semibold ring-1", getStatusClass(item.status))}>
                {item.status}
              </span>
            </div>
          </div>
        )) : <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">No upcoming or overdue items yet.</div>}
      </div>
    </aside>
  );
}

function OutstandingCaseTypeCard() {
  const total = OUTSTANDING_BY_CASE_TYPE.reduce((sum, item) => sum + item.value, 0);

  return (
    <section className={cx(surfaceClass, "min-w-0 p-4 sm:p-5")}> 
      <ChartHeader title="Outstanding by Case Type" />

      <div className="mt-5 grid items-center gap-5 sm:grid-cols-[168px_minmax(0,1fr)] xl:grid-cols-1 2xl:grid-cols-[168px_minmax(0,1fr)]">
        <div className="relative mx-auto h-[160px] w-[160px]">
          <div
            className="absolute inset-0 rounded-full"
            style={{ background: `conic-gradient(${buildConicGradient(OUTSTANDING_BY_CASE_TYPE)})` }}
          />
          <div className="absolute inset-[25px] flex flex-col items-center justify-center rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(226,232,240,0.9)]">
            <span className="text-[12px] font-medium text-slate-500">Total</span>
            <span className="mt-1 text-[21px] font-semibold tracking-[-0.035em] text-slate-950">$41,285</span>
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          {OUTSTANDING_BY_CASE_TYPE.length ? OUTSTANDING_BY_CASE_TYPE.map((item) => (
            <div key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="truncate text-[12px] font-medium text-slate-600">{item.label}</span>
              </div>
              <span className="text-[12px] font-semibold tabular-nums text-slate-700">
                {money.format(item.value)} ({item.percent})
              </span>
            </div>
          )) : <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">No case type balance data yet.</div>}
        </div>
      </div>
    </section>
  );
}

function PaymentInsightsCard() {
  return (
    <section className={cx(surfaceClass, "min-w-0 p-4 sm:p-5")}> 
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 ring-1 ring-emerald-100">
          <ArrowUpRight className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.018em] text-slate-950">Payment Insights</h2>
          <p className="mt-3 text-[13px] leading-5 text-slate-500">
            Collections are up <span className="font-semibold text-emerald-600">12%</span> compared to last month.
          </p>
          <p className="mt-2 text-[13px] leading-5 text-slate-500">
            Average time to collect: <span className="font-semibold text-emerald-600">18 days</span>
          </p>
        </div>
      </div>
    </section>
  );
}

function MethodPill({ method }) {
  const map = {
    "Bank Transfer": "bg-emerald-50 text-emerald-600 ring-emerald-100",
    "Credit Card": "bg-blue-50 text-blue-600 ring-blue-100",
    ACH: "bg-amber-50 text-amber-600 ring-amber-100",
    Cash: "bg-violet-50 text-violet-600 ring-violet-100",
  };

  return (
    <span className={cx("inline-flex h-7 items-center rounded-full px-3 text-[11px] font-semibold ring-1", map[method] || "bg-slate-100 text-slate-600 ring-slate-200")}>
      {method}
    </span>
  );
}

function RecentPaymentsCard() {
  return (
    <section className={cx(surfaceClass, "min-w-0 overflow-hidden p-4 sm:p-5")}> 
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-slate-950">Recent Payments</h2>
        <button type="button" className="text-[12px] font-semibold text-blue-600 transition hover:text-blue-700">
          View all payments
        </button>
      </div>

      <div className="overflow-x-auto rounded-[18px] border border-slate-200/70">
        <table className="min-w-[820px] w-full border-separate border-spacing-0 text-left">
          <thead>
            <tr className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-[0.02em] text-slate-500">
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Case ID</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Method</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {RECENT_PAYMENTS.length ? RECENT_PAYMENTS.map((payment) => (
              <tr key={payment.caseId} className="border-t border-slate-100 text-[13px] text-slate-700 transition hover:bg-slate-50/70">
                <td className="border-t border-slate-100 px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <span className={cx("flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold ring-1", getAvatarClass(payment.initials))}>
                      {payment.initials}
                    </span>
                    <span className="font-semibold text-slate-900">{payment.client}</span>
                  </div>
                </td>
                <td className="border-t border-slate-100 px-4 py-3.5 font-medium text-slate-600">{payment.caseId}</td>
                <td className="border-t border-slate-100 px-4 py-3.5 font-semibold text-slate-900">{money.format(payment.amount)}</td>
                <td className="border-t border-slate-100 px-4 py-3.5 font-medium text-slate-600">{payment.date}</td>
                <td className="border-t border-slate-100 px-4 py-3.5"><MethodPill method={payment.method} /></td>
                <td className="border-t border-slate-100 px-4 py-3.5">
                  <span className={cx("inline-flex h-7 items-center rounded-full px-3 text-[11px] font-semibold ring-1", getStatusClass(payment.status))}>
                    {payment.status}
                  </span>
                </td>
                <td className="border-t border-slate-100 px-4 py-3.5 text-right">
                  <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            )) : (
              <tr className="text-[13px] text-slate-500">
                <td colSpan="7" className="border-t border-slate-100 px-4 py-8 text-center">
                  No recent payments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function Payments() {
  return (
    <main className="min-w-0 px-3 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex w-full max-w-[1680px] min-w-0 flex-col gap-5">
        <PaymentsHeader />

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_370px] 2xl:grid-cols-[minmax(0,1fr)_390px]">
          <section className="min-w-0 space-y-4">
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {KPI_ITEMS.map((item) => (
                <MetricCard key={item.label} item={item} />
              ))}
            </div>

            <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-12">
              <CollectionsTrendCard />
              <PaymentStatusCard />
              <PaymentsByMethodCard />
            </div>
          </section>

          <UpcomingOverduePanel />
        </div>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_370px] 2xl:grid-cols-[minmax(0,1fr)_390px]">
          <RecentPaymentsCard />

          <aside className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-1">
            <OutstandingCaseTypeCard />
            <PaymentInsightsCard />
          </aside>
        </div>
      </div>
    </main>
  );
}
