import { useMemo } from "react";
import { formatStudyIntake, studyIntakeValue } from "../../utils/studyIntake";

export default function StudyIntakeSelect({ value, onChange, required = false, className = "" }) {
  const selectedValue = studyIntakeValue(value);
  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 7 }, (_, index) => currentYear - 1 + index);
  }, []);
  const standardValues = new Set(years.flatMap((year) => Array.from({ length: 12 }, (_, month) => `${year}-${String(month + 1).padStart(2, "0")}`)));

  return (
    <select
      required={required}
      name="studyIntakeMonth"
      value={selectedValue}
      onChange={onChange}
      className={className}
    >
      <option value="">Not decided</option>
      {selectedValue && !standardValues.has(selectedValue) ? <option value={selectedValue}>{formatStudyIntake(selectedValue)}</option> : null}
      {years.map((year) => (
        <optgroup key={year} label={String(year)}>
          {Array.from({ length: 12 }, (_, month) => {
            const option = `${year}-${String(month + 1).padStart(2, "0")}`;
            return <option key={option} value={option}>{formatStudyIntake(option)}</option>;
          })}
        </optgroup>
      ))}
    </select>
  );
}
