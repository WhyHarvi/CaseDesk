import {
  requireConsultFeeItem,
  resolveOrCreateQuickBooksCustomer,
} from "./src/services/bookingPaymentHoldService.js";
import {
  createQuickBooksConsultationInvoice,
  createQuickBooksReceivePayment,
  voidQuickBooksInvoice,
  deleteQuickBooksPayment,
  getQuickBooksInvoice,
  findOrCreateQuickBooksPaymentMethod,
  qboRequest,
} from "./src/services/quickbooksService.js";

const AGENCY_ID = "8afe0d4e-7a0c-44d4-9163-a70ac2ed6e8e";
const DEMO_NAME = "DEMO PAYMENT — void ordering test (safe to delete)";
const DEMO_EMAIL = "demo-payment-void-test@caseworkdesk.invalid";

function log(section, msg) {
  console.log(`\n[${section}] ${msg}`);
}

async function safeCleanupPayment(label, paymentId) {
  if (!paymentId) return;
  try {
    await deleteQuickBooksPayment(AGENCY_ID, { id: paymentId });
    log("cleanup", `${label}: payment ${paymentId} deleted OK`);
  } catch (error) {
    log("cleanup", `${label}: payment ${paymentId} delete FAILED — ${error.message} (needs manual cleanup in QuickBooks)`);
  }
}

async function safeCleanupVoid(label, invoiceId, syncToken) {
  if (!invoiceId) return;
  try {
    await voidQuickBooksInvoice(AGENCY_ID, { id: invoiceId, syncToken });
    log("cleanup", `${label}: invoice ${invoiceId} voided OK`);
  } catch (error) {
    log("cleanup", `${label}: invoice ${invoiceId} void FAILED — ${error.message} (already voided, or needs manual cleanup)`);
  }
}

const results = {};

console.log("=".repeat(70));
console.log("DEMO PAYMENT — void-ordering experiment against real CHK QuickBooks");
console.log("Tiny amounts ($1.00), clearly labeled, fully cleaned up at the end.");
console.log("=".repeat(70));

log("setup", "Resolving demo customer + consultation fee item...");
const customerId = await resolveOrCreateQuickBooksCustomer(AGENCY_ID, {
  name: DEMO_NAME,
  email: DEMO_EMAIL,
  phone: null,
});
const itemId = await requireConsultFeeItem(AGENCY_ID);
const paymentMethod = await findOrCreateQuickBooksPaymentMethod(AGENCY_ID, "Cash");
log("setup", `customerId=${customerId} itemId=${itemId} paymentMethodId=${paymentMethod.id}`);

// ---------------------------------------------------------------------
// Experiment A: PAY first, then attempt to VOID the now-paid invoice.
// This is the exact real-world race: does CaseDesk's attemptVoid succeed
// against an invoice whose card payment posted right around the same time?
// ---------------------------------------------------------------------
let invoiceA = null;
let paymentA = null;
try {
  log("A", "Creating invoice A...");
  invoiceA = await createQuickBooksConsultationInvoice(AGENCY_ID, {
    customerId,
    itemId,
    description: `${DEMO_NAME} — A (pay then void)`,
    amount: 1,
  });
  log("A", `invoice ${invoiceA.id} created, balance=${invoiceA.balance}`);

  log("A", "Applying a payment against invoice A...");
  paymentA = await createQuickBooksReceivePayment(AGENCY_ID, {
    customerId,
    invoiceId: invoiceA.id,
    amount: 1,
    paymentMethodId: paymentMethod.id,
    privateNote: DEMO_NAME,
  });
  log("A", `payment ${paymentA.id} applied`);

  const afterPay = await getQuickBooksInvoice(AGENCY_ID, invoiceA.id);
  log("A", `invoice ${invoiceA.id} balance after payment: ${afterPay.balance}`);

  log("A", "Attempting to VOID the now-paid invoice...");
  try {
    await voidQuickBooksInvoice(AGENCY_ID, { id: afterPay.id, syncToken: afterPay.syncToken });
    results.voidPaidInvoice = "SUCCEEDED — QuickBooks allowed voiding an invoice with a payment already applied";
    log("A", "RESULT: void SUCCEEDED against a paid invoice");
  } catch (error) {
    results.voidPaidInvoice = `REJECTED — ${error.message}`;
    log("A", `RESULT: void REJECTED — ${error.message}`);
  }
} finally {
  const finalA = invoiceA ? await getQuickBooksInvoice(AGENCY_ID, invoiceA.id).catch(() => null) : null;
  if (finalA && !finalA.isVoided) {
    // Void didn't happen (either it failed, or we never got that far) —
    // clean up: delete the payment first if any, then void.
    await safeCleanupPayment("A", paymentA?.id);
    const refreshed = await getQuickBooksInvoice(AGENCY_ID, invoiceA.id).catch(() => finalA);
    await safeCleanupVoid("A", invoiceA?.id, refreshed?.syncToken);
  } else if (finalA?.isVoided && paymentA) {
    // Void succeeded while the payment record might still exist — try to
    // remove the orphaned payment too, best-effort.
    await safeCleanupPayment("A", paymentA.id);
  }
}

// ---------------------------------------------------------------------
// Experiment B: VOID first (unpaid), then attempt to apply a PAYMENT
// against the now-voided invoice.
// ---------------------------------------------------------------------
let invoiceB = null;
let paymentB = null;
try {
  log("B", "Creating invoice B...");
  invoiceB = await createQuickBooksConsultationInvoice(AGENCY_ID, {
    customerId,
    itemId,
    description: `${DEMO_NAME} — B (void then pay)`,
    amount: 1,
  });
  log("B", `invoice ${invoiceB.id} created`);

  log("B", "Voiding invoice B while still unpaid...");
  await voidQuickBooksInvoice(AGENCY_ID, { id: invoiceB.id, syncToken: invoiceB.syncToken });
  log("B", "invoice B voided");

  log("B", "Attempting to apply a payment against the now-voided invoice...");
  try {
    paymentB = await createQuickBooksReceivePayment(AGENCY_ID, {
      customerId,
      invoiceId: invoiceB.id,
      amount: 1,
      paymentMethodId: paymentMethod.id,
      privateNote: DEMO_NAME,
    });
    results.payVoidedInvoice = "SUCCEEDED — QuickBooks allowed applying a payment to a voided invoice";
    log("B", `RESULT: payment SUCCEEDED against a voided invoice (payment ${paymentB.id})`);
  } catch (error) {
    results.payVoidedInvoice = `REJECTED — ${error.message}`;
    log("B", `RESULT: payment REJECTED — ${error.message}`);
  }
} finally {
  await safeCleanupPayment("B", paymentB?.id);
}

// ---------------------------------------------------------------------
// Best-effort: deactivate the demo customer so it doesn't linger as an
// active-looking entry in the QuickBooks customer list.
// ---------------------------------------------------------------------
try {
  const customerPayload = await qboRequest(AGENCY_ID, { path: `/customer/${customerId}` });
  const customer = customerPayload.Customer;
  await qboRequest(AGENCY_ID, {
    method: "POST",
    path: "/customer",
    body: { Id: customer.Id, SyncToken: customer.SyncToken, sparse: true, Active: false },
  });
  log("cleanup", `demo customer ${customerId} deactivated`);
} catch (error) {
  log("cleanup", `demo customer ${customerId} deactivation FAILED — ${error.message} (harmless, clearly named, safe to ignore or deactivate manually)`);
}

console.log("\n" + "=".repeat(70));
console.log("SUMMARY");
console.log("=".repeat(70));
console.log("Void a PAID invoice:      ", results.voidPaidInvoice);
console.log("Pay a VOIDED invoice:     ", results.payVoidedInvoice);
