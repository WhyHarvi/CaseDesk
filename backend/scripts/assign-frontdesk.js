// Retired: a case-wide Frontdesk assignment cannot prove who processed an
// individual payment and can misattribute both workload and incentive credit.
// Use PAYMENT_PROCESSOR attribution, which resolves from the authenticated
// payment event, instead of reviving this bulk mutation.
console.error("assign-frontdesk.js is retired. Configure the plan to use Payment processor attribution.");
process.exitCode = 1;
