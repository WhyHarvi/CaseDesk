// Shared by caseController and paymentScheduleService — kept in its own
// module so neither has to import the other just for this constant.
export const CASE_STAGES = ["Lead", "Consultation", "Retainer Pending", "Documents Pending", "Reviewing Documents", "Application Preparing", "Submitted", "Decision Received", "Closed"];
