import assert from "node:assert/strict";
import test from "node:test";
import { validateManualPaymentInput } from "../src/services/caseInvoiceService.js";

test("professional payment validation runs before an invoice can be created", () => {
  const paymentDate = new Date().toISOString().slice(0, 10);
  assert.throws(
    () => validateManualPaymentInput({ amount: 100, method: "ETransfer", transactionReference: "", paymentDate }),
    /transaction number/i,
  );
  assert.throws(
    () => validateManualPaymentInput({ amount: 100, method: "Card", transactionReference: "", paymentDate }),
    /Cash or E-transfer/i,
  );
  assert.throws(
    () => validateManualPaymentInput({ amount: 0, method: "Cash", paymentDate }),
    /greater than \$0/i,
  );
  assert.throws(
    () => validateManualPaymentInput({ amount: 100, method: "Cash", paymentDate: "not-a-date" }),
    /valid payment date/i,
  );

  const valid = validateManualPaymentInput({
    amount: 250,
    method: "ETransfer",
    transactionReference: " TXN-123 ",
    paymentDate,
  });
  assert.equal(valid.numericAmount, 250);
  assert.equal(valid.paymentReference, "TXN-123");
  assert.equal(valid.transactionDate.qboDate, paymentDate);
});
