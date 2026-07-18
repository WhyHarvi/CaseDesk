import { ChevronDown } from "lucide-react";

export default function Select({ value, onChange, children, className = "", ariaLabel, required = false }) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <select
        value={value}
        onChange={onChange}
        aria-label={ariaLabel}
        required={required}
        className="w-full cursor-pointer appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-3.5 pr-9 text-sm font-medium text-slate-700 shadow-sm outline-none transition hover:border-slate-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </span>
  );
}
