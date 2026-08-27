import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bookingClientMessageEnabled } from "../src/services/bookingNotificationService.js";
import { automaticPreConsultationIntakeEnabled } from "../src/services/preConsultationIntakeService.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("automatic pre-consultation delivery fails closed unless explicitly enabled", () => {
  assert.equal(automaticPreConsultationIntakeEnabled({}), false);
  assert.equal(automaticPreConsultationIntakeEnabled({ agency: { bookingSettings: {} } }), false);
  assert.equal(automaticPreConsultationIntakeEnabled({ agency: { bookingSettings: { preConsultationEmailEnabled: false, preConsultationSmsEnabled: false } } }), false);
  assert.equal(automaticPreConsultationIntakeEnabled({ agency: { bookingSettings: { preConsultationEmailEnabled: true, preConsultationSmsEnabled: false } } }), true);
  assert.equal(automaticPreConsultationIntakeEnabled({ agency: { bookingSettings: { preConsultationEmailEnabled: false, preConsultationSmsEnabled: true } } }), true);
});

test("the worker filters disabled workspaces and the manual path bypasses only through force", async () => {
  const [service, controller] = await Promise.all([
    source("../src/services/preConsultationIntakeService.js"),
    source("../src/controllers/preConsultationStaffController.js"),
  ]);
  assert.match(service, /bookingSettings: \{ OR: \[\{ preConsultationEmailEnabled: true \}, \{ preConsultationSmsEnabled: true \}\] \}/);
  assert.match(service, /select: \{ preConsultationEmailEnabled: true, preConsultationSmsEnabled: true \}/);
  assert.match(service, /if \(!force && !automaticPreConsultationIntakeEnabled\(\{ agency: \{ bookingSettings \} \}\)\) return null;/);
  assert.match(controller, /deliverPreConsultationIntake\(appointment, \{\s*force: true,/);
});

test("client appointment email and SMS can be disabled independently without disabling payment links", () => {
  assert.equal(bookingClientMessageEnabled({}, "booked", "email"), true);
  assert.equal(bookingClientMessageEnabled({ messageTemplates: { booked: { emailEnabled: false, smsEnabled: true } } }, "booked", "email"), false);
  assert.equal(bookingClientMessageEnabled({ messageTemplates: { booked: { emailEnabled: false, smsEnabled: true } } }, "booked", "sms"), true);
  assert.equal(bookingClientMessageEnabled({ messageTemplates: { reminder: { enabled: false } } }, "reminder", "sms"), false);
  assert.equal(bookingClientMessageEnabled({ messageTemplates: { payment_requested: { emailEnabled: false, smsEnabled: false } } }, "payment_requested", "email"), true);
  assert.equal(bookingClientMessageEnabled({ messageTemplates: { payment_requested: { emailEnabled: false, smsEnabled: false } } }, "payment_requested", "sms"), true);
});
