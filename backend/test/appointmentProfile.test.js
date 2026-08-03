import assert from "node:assert/strict";
import test from "node:test";
import {
  appointmentProfileAccessWhere,
  ensureAppointmentCompletionFollowUp,
  requireAppointmentProfile,
} from "../src/services/appointmentProfileService.js";

test("appointment profile limits consultants to assigned or related appointments", () => {
  const where = appointmentProfileAccessWhere({ auth: { role: "consultant", userId: "user-1" } });
  assert.ok(Array.isArray(where.OR));
  assert.equal(where.OR[0].assignedToId, "user-1");
  assert.equal(where.OR[1].client.OR[0].assignedUserId, "user-1");
  assert.equal(where.OR[2].case.OR[0].assignedUserId, "user-1");
});

test("appointment profile preserves legacy purpose and hides staff records from front desk", async () => {
  let capturedWhere;
  const db = {
    appointment: {
      findFirst: async ({ where }) => {
        capturedWhere = where;
        return {
          id: "appointment-1",
          description: "Discuss study permit options",
          purpose: null,
          internalNotes: "Staff context",
          notes: [{ id: "note-1" }],
          events: [
            { id: "event-1", type: "NOTE_ADDED" },
            { id: "event-2", type: "BOOKED" },
          ],
          followUps: [{ id: "follow-up-1" }],
        };
      },
    },
  };
  const result = await requireAppointmentProfile(
    { auth: { role: "frontdesk", agencyId: "agency-1", userId: "user-1" } },
    "appointment-1",
    db,
  );

  assert.equal(capturedWhere.agencyId, "agency-1");
  assert.equal(result.purpose, "Discuss study permit options");
  assert.equal(result.internalNotes, null);
  assert.deepEqual(result.notes, []);
  assert.deepEqual(result.clientNotes, []);
  assert.deepEqual(result.events, [{ id: "event-2", type: "BOOKED" }]);
  assert.deepEqual(result.followUps, []);
});

test("appointment profile combines profile notes with notes from every client appointment", async () => {
  let capturedWhere;
  const notes = [
    { id: "profile-note", appointmentId: null, caseId: null },
    { id: "appointment-note", appointmentId: "appointment-1", caseId: null },
  ];
  const db = {
    appointment: {
      findFirst: async () => ({
        id: "appointment-1",
        clientId: "client-1",
        description: null,
        purpose: null,
        internalNotes: null,
        notes: [notes[1]],
        followUps: [],
      }),
    },
    note: {
      findMany: async ({ where }) => {
        capturedWhere = where;
        return notes;
      },
    },
  };

  const result = await requireAppointmentProfile(
    { auth: { role: "admin", agencyId: "agency-1", userId: "user-1" } },
    "appointment-1",
    db,
  );

  assert.equal(capturedWhere.clientId, "client-1");
  assert.equal(capturedWhere.deletedAt, null);
  assert.deepEqual(capturedWhere.OR[0].appointmentId, { not: null });
  assert.equal(capturedWhere.OR[1].appointmentId, null);
  assert.equal(capturedWhere.OR[1].caseId, null);
  assert.deepEqual(result.clientNotes, notes);
});

test("appointment profile preserves notes for a visitor who is not a client yet", async () => {
  const notes = [{ id: "guest-note", appointmentId: "appointment-1", content: "Guest context" }];
  const db = {
    appointment: {
      findFirst: async () => ({
        id: "appointment-1",
        clientId: null,
        description: null,
        purpose: null,
        internalNotes: null,
        notes,
        followUps: [],
      }),
    },
    note: {
      findMany: async () => {
        throw new Error("Guest notes should come from the appointment include");
      },
    },
  };

  const result = await requireAppointmentProfile(
    { auth: { role: "admin", agencyId: "agency-1", userId: "user-1" } },
    "appointment-1",
    db,
  );

  assert.deepEqual(result.clientNotes, notes);
});

test("completed appointments create one traceable follow-up", async () => {
  const created = [];
  const db = {
    followUp: {
      findFirst: async () => null,
      create: async ({ data }) => {
        created.push(data);
        return { id: "follow-up-1", ...data };
      },
    },
  };
  const appointment = {
    id: "appointment-1",
    agencyId: "agency-1",
    clientId: "client-1",
    caseId: "case-1",
    assignedToId: "user-1",
    subject: "Study permit consultation",
  };

  const result = await ensureAppointmentCompletionFollowUp(db, appointment);

  assert.equal(result.appointmentId, "appointment-1");
  assert.equal(result.clientId, "client-1");
  assert.equal(result.caseId, "case-1");
  assert.equal(result.assignedUserId, "user-1");
  assert.equal(created.length, 1);
});

test("completed appointments reuse an existing pending follow-up", async () => {
  let createCalled = false;
  const existing = { id: "follow-up-existing", appointmentId: "appointment-1" };
  const db = {
    followUp: {
      findFirst: async () => existing,
      create: async () => {
        createCalled = true;
      },
    },
  };

  const result = await ensureAppointmentCompletionFollowUp(db, {
    id: "appointment-1",
    agencyId: "agency-1",
    clientId: "client-1",
    assignedToId: "user-1",
  });

  assert.equal(result, existing);
  assert.equal(createCalled, false);
});
