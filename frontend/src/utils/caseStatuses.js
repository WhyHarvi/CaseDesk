export const CASE_STATUSES = [
  "Open",
  "Active",
  "On Hold",
  "Completed",
  "Closed",
  "Cancelled",
  "Inactive",
];

export function buildCaseStatusFilterOptions(cases = [], selectedStatus = "all") {
  const availableStatuses = new Set(
    cases.map((caseItem) => caseItem.status).filter(Boolean),
  );
  if (selectedStatus && selectedStatus !== "all") {
    availableStatuses.add(selectedStatus);
  }

  const knownStatuses = CASE_STATUSES.filter((status) => availableStatuses.has(status));
  const unknownStatuses = [...availableStatuses]
    .filter((status) => !CASE_STATUSES.includes(status))
    .sort((a, b) => a.localeCompare(b));

  return [...knownStatuses, ...unknownStatuses];
}
