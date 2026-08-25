import { useMemo, useState } from "react";
import {
  SlidersHorizontal,
  X,
  ChevronDown,
} from "lucide-react";
import { formatStudyIntake, isStudyPermitCaseType, studyIntakeValue } from "../../utils/studyIntake";
import { buildCaseTypeFilterOptions } from "../../utils/caseTypes";
import { CASE_STAGES } from "../../constants/caseStages";

const STAGES = CASE_STAGES;

const STATUSES = ["Active", "Ready", "Submitted", "Closed", "On Hold"];
const PRIORITIES = ["Normal", "High", "Urgent"];

function SelectControl({ label, value, onChange, children }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </span>

      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full appearance-none rounded-2xl border border-slate-200 bg-white/90 px-4 pr-10 text-sm font-semibold text-slate-700 shadow-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
        >
          {children}
        </select>

        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
    </label>
  );
}

export default function CasesCommandBar({
  cases = [],
  searchQuery,
  setSearchQuery,
  filters,
  setFilters,
  studyIntakeOptions = [],
  caseTypeOptions = [],
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);

  const staffOptions = useMemo(() => {
    const staffById = new Map();
    cases.forEach((item) => {
      [item.assignedUser, item.caseWorker].filter(Boolean).forEach((staff) => {
        if (staff.id && staff.fullName) staffById.set(staff.id, staff);
      });
    });

    return [...staffById.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [cases]);

  const visibleStudyIntakes = useMemo(() => [...new Set([
    ...studyIntakeOptions,
    ...cases.map((item) => studyIntakeValue(item.studyIntakeMonth)).filter(Boolean),
  ])].sort(), [cases, studyIntakeOptions]);
  const visibleCaseTypes = useMemo(() => buildCaseTypeFilterOptions(cases, caseTypeOptions), [cases, caseTypeOptions]);

  const activeFilters = Object.entries(filters || {}).filter(
    ([, value]) => value && value !== "all"
  );

  const updateFilter = (key, value) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
      ...(key === "intake" && value !== "all" ? { caseType: "all" } : {}),
      ...(key === "caseType" && value !== "all" && !isStudyPermitCaseType(value) ? { intake: "all" } : {}),
    }));
  };

  const clearFilters = () => {
    setFilters({
      caseType: "all",
      stage: "all",
      status: "all",
      staff: "all",
      priority: "all",
      intake: "all",
    });
  };

  return (
    <section>
      <div className="rounded-[28px] border border-white/70 bg-white/80 p-3 shadow-lg shadow-slate-200/50 backdrop-blur-xl">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search cases, clients, file numbers..."
              className="h-12 w-full rounded-[20px] border border-slate-200 bg-white px-4 pr-12 text-sm font-semibold text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
            />

            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex shrink-0 gap-3">
            <button
              type="button"
              onClick={() => setFiltersOpen((prev) => !prev)}
              className={[
                "inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-[20px] border px-5 text-sm font-bold shadow-sm transition-all duration-300 ease-out lg:flex-none",
                filtersOpen
                  ? "border-slate-950 bg-slate-950 text-white shadow-lg shadow-slate-300/40"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              ].join(" ")}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {activeFilters.length > 0 ? (
                <span
                  className={[
                    "ml-1 rounded-full px-2 py-0.5 text-[11px] font-black transition-colors duration-300",
                    filtersOpen ? "bg-white text-slate-950" : "bg-slate-950 text-white",
                  ].join(" ")}
                >
                  {activeFilters.length}
                </span>
              ) : null}
            </button>
          </div>
        </div>
      </div>

      {filtersOpen ? (
        <div className="mt-3 rounded-[28px] border border-white/70 bg-white/75 p-4 shadow-md shadow-slate-200/40 backdrop-blur-xl">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-7">
            <SelectControl
              label="Case Type"
              value={filters.caseType}
              onChange={(value) => updateFilter("caseType", value)}
            >
              <option value="all">All Case Types</option>
              {visibleCaseTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </SelectControl>

            <SelectControl
              label="Academic Intake"
              value={filters.intake}
              onChange={(value) => updateFilter("intake", value)}
            >
              <option value="all">All Intakes</option>
              <option value="missing">Intake Not Set</option>
              <option value="past">Past Intakes</option>
              {visibleStudyIntakes.map((value) => (
                <option key={value} value={value}>
                  {formatStudyIntake(value)}
                </option>
              ))}
            </SelectControl>

            <SelectControl
              label="Stage"
              value={filters.stage}
              onChange={(value) => updateFilter("stage", value)}
            >
              <option value="all">All Stages</option>
              {STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </SelectControl>

            <SelectControl
              label="Status"
              value={filters.status}
              onChange={(value) => updateFilter("status", value)}
            >
              <option value="all">All Statuses</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </SelectControl>

            <SelectControl
              label="Staff"
              value={filters.staff}
              onChange={(value) => updateFilter("staff", value)}
            >
              <option value="all">All Staff</option>
              {staffOptions.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.fullName}
                </option>
              ))}
            </SelectControl>

            <SelectControl
              label="Priority"
              value={filters.priority}
              onChange={(value) => updateFilter("priority", value)}
            >
              <option value="all">All Priorities</option>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </SelectControl>

            <div className="flex items-end">
              <button
                type="button"
                onClick={clearFilters}
                className="h-11 w-full rounded-2xl bg-slate-100 text-sm font-bold text-slate-700 transition hover:bg-slate-200"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
