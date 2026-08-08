import { formatStudyIntake, studyIntakeIsPast, studyIntakeValue } from "../../utils/studyIntake";

export default function StudyIntakeBadge({ value }) {
  const key = studyIntakeValue(value);
  const tone = !key
    ? "bg-amber-50 text-amber-700 ring-amber-200"
    : studyIntakeIsPast(key)
      ? "bg-slate-100 text-slate-600 ring-slate-200"
      : "bg-violet-50 text-violet-700 ring-violet-200";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ring-1 ring-inset ${tone}`}>
      {key ? `${formatStudyIntake(key, { short: true })} intake` : "Intake not set"}
    </span>
  );
}
