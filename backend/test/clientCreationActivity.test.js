import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("appointment conversions and historical profiles always expose client creation activity", async () => {
  const bookingController = await source("../src/controllers/bookingController.js");
  const clientController = await source("../src/controllers/clientController.js");
  const profile = await source("../../frontend/src/pages/ClientProfile.jsx");

  const conversion = bookingController.slice(
    bookingController.indexOf("export async function convertAppointmentToClient"),
    bookingController.indexOf("export async function applyAppointmentStatusChange"),
  );

  assert.match(conversion, /action: result\.existing \? "appointment\.client_linked" : "client\.created"/);
  assert.match(conversion, /entityType: "appointment"/);
  assert.match(clientController, /activityLogs\.some\(\(item\) => item\.action === "client\.created"\)/);
  assert.match(clientController, /id: `client-created-\$\{client\.id\}`/);
  assert.match(clientController, /createdAt: client\.createdAt/);
  assert.match(clientController, /id: `appointment-booked-\$\{appointment\.id\}`/);
  assert.match(clientController, /details: `\$\{appointment\.source === "Public" \? "Public booking" : "Staff booking"\}: \$\{appointment\.subject\}`/);
  assert.match(clientController, /client profile created from \$\{conversionAppointment\.source === "Public" \? "public" : "staff-booked"\} consultation/);
  assert.match(profile, /"appointment\.client_linked": "linked appointment to client"/);
});
