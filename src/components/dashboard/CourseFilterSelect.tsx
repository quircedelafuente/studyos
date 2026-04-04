import {
  courseCategoryTotals,
  type CourseFilterMode,
} from "@/lib/blackboard-api";

export function CourseFilterSelect({
  id,
  value,
  onChange,
  catTotals,
  allCoursesLength,
  className,
}: {
  id: string;
  value: CourseFilterMode;
  onChange: (mode: CourseFilterMode) => void;
  catTotals: ReturnType<typeof courseCategoryTotals>;
  allCoursesLength: number;
  className?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as CourseFilterMode)}
      className={
        className ??
        "min-w-0 rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2 py-1.5 text-sm text-[var(--ink)] outline-none sm:min-w-[14rem]"
      }
    >
      <option value="__auto__">
        Semestre actual —{" "}
        {catTotals.Q2 > 0 ? `Q2 (${catTotals.Q2})` : `Q1 (${catTotals.Q1})`}
      </option>
      {catTotals.Q1 > 0 ? (
        <option value="Q1">Solo Q1 ({catTotals.Q1})</option>
      ) : null}
      {catTotals.Q2 > 0 ? (
        <option value="Q2">Solo Q2 ({catTotals.Q2})</option>
      ) : null}
      {catTotals.ANNUAL > 0 ? (
        <option value="ANNUAL">Annual ({catTotals.ANNUAL})</option>
      ) : null}
      <option value="__all__">Todos los cursos ({allCoursesLength})</option>
    </select>
  );
}
