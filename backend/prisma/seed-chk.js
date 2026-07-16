import { PrismaClient } from "@prisma/client";
import { nextClientNumber } from "../src/services/clientNumberService.js";

const prisma = new PrismaClient();
const AGENCY_NAME = "CHK IMMIGRATION";
const CONSULTANT_EMAIL = "harvicustom@gmail.com";
const MARKER = "CHK sample seed";

const addDays = (days, hour = 10) => {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(hour, 0, 0, 0);
  return value;
};

const definitions = [
  {
    fullName: "Amara Okafor",
    email: "amara.okafor@example.test",
    phone: "+14165552001",
    caseType: "Express Entry",
    stage: "Reviewing Documents",
    status: "Active",
    priority: "High",
    nextAction: "Review language test and employment records",
    documents: [
      ["Language test results", "Upload the complete IELTS or CELPIP result sheet."],
      ["Employment reference letter", "The letter must include duties, dates, hours, and salary."],
    ],
    task: ["Verify Express Entry evidence", -1, "High"],
    followUp: ["Confirm missing employment details", 0],
    appointment: ["Express Entry document review", 2],
    fee: [3500, 1500],
  },
  {
    fullName: "Ethan Chen",
    email: "ethan.chen@example.test",
    phone: "+14165552002",
    caseType: "Study Permit Extension",
    stage: "Documents Pending",
    status: "Active",
    priority: "Urgent",
    nextAction: "Collect updated proof of funds",
    documents: [
      ["Proof of funds", "Upload statements covering the most recent four months."],
      ["Current study permit", "Upload a clear scan of the front and back."],
    ],
    task: ["Check permit expiry date", 0, "Urgent"],
    followUp: ["Remind client about bank statements", 1],
    appointment: ["Study permit extension consultation", 1],
    fee: [2200, 2200],
  },
  {
    fullName: "Sofia Rahman",
    email: "sofia.rahman@example.test",
    phone: "+14165552003",
    caseType: "Spousal Sponsorship",
    stage: "Application Preparing",
    status: "Active",
    priority: "Normal",
    nextAction: "Draft relationship history summary",
    documents: [
      ["Relationship evidence", "Upload representative photos, travel records, and shared correspondence."],
      ["Marriage certificate", "Upload the certified certificate and translation if applicable."],
    ],
    task: ["Prepare sponsorship document index", 3, "Normal"],
    followUp: ["Review relationship timeline with client", 4],
    appointment: ["Sponsorship preparation meeting", 5],
    fee: [4800, 2400],
  },
  {
    fullName: "Mateo Silva",
    email: "mateo.silva@example.test",
    phone: "+14165552004",
    caseType: "Employer-Specific Work Permit",
    stage: "Submitted",
    status: "On Hold",
    priority: "Low",
    nextAction: "Monitor IRCC account for correspondence",
    documents: [
      ["Updated employment offer", "Upload a signed copy if the employer issues a revision."],
    ],
    task: ["Check submitted application status", 7, "Low"],
    followUp: ["Send monthly status update", 7],
    appointment: ["Work permit status call", 8],
    fee: [3000, 1000],
  },
];

async function findContext() {
  const consultant = await prisma.user.findUnique({
    where: { email: CONSULTANT_EMAIL },
    include: { agency: true },
  });
  if (!consultant) throw new Error(`Active CHK consultant ${CONSULTANT_EMAIL} was not found.`);
  if (consultant.role !== "consultant" || consultant.status !== "active") throw new Error(`${CONSULTANT_EMAIL} is not an active consultant.`);
  const agency = consultant.agency;
  if (agency.name !== AGENCY_NAME) throw new Error(`${CONSULTANT_EMAIL} belongs to ${agency.name}, not ${AGENCY_NAME}.`);
  return { agency, consultant };
}

async function ensureClient(agencyId, consultantId, item) {
  const existing = await prisma.client.findFirst({ where: { agencyId, emailNormalized: item.email } });
  if (existing) {
    return prisma.client.update({
      where: { id: existing.id },
      data: { fullName: item.fullName, phone: item.phone, phoneNormalized: item.phone, email: item.email, status: "Active", assignedUserId: consultantId },
    });
  }
  return prisma.$transaction(async (tx) => tx.client.create({
    data: { agencyId, clientNumber: await nextClientNumber(tx, agencyId), fullName: item.fullName, email: item.email, emailNormalized: item.email, phone: item.phone, phoneNormalized: item.phone, status: "Active", assignedUserId: consultantId },
  }));
}

async function ensureCase(agencyId, consultantId, clientId, item) {
  const existing = await prisma.case.findFirst({ where: { agencyId, clientId, caseType: item.caseType } });
  const data = { assignedUserId: consultantId, stage: item.stage, status: item.status, priority: item.priority, nextAction: item.nextAction };
  if (existing) return prisma.case.update({ where: { id: existing.id }, data });
  return prisma.case.create({ data: { agencyId, clientId, caseType: item.caseType, ...data } });
}

async function ensureRelatedRecords(agencyId, consultant, client, caseItem, item) {
  await prisma.caseAssignment.upsert({
    where: { agencyId_caseId_consultantUserId_assignmentType: { agencyId, caseId: caseItem.id, consultantUserId: consultant.id, assignmentType: "primary" } },
    update: { status: "active", assignedById: consultant.id },
    create: { agencyId, caseId: caseItem.id, consultantUserId: consultant.id, assignmentType: "primary", status: "active", assignedById: consultant.id },
  });

  for (const [documentName, clientInstructions] of item.documents) {
    const normalizedName = documentName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    await prisma.clientDocument.upsert({
      where: { caseId_normalizedName: { caseId: caseItem.id, normalizedName } },
      update: { clientInstructions, visibility: "Client" },
      create: { agencyId, clientId: client.id, caseId: caseItem.id, documentName, normalizedName, status: "Requested", visibility: "Client", clientInstructions },
    });
  }

  const [taskTitle, taskDays, taskPriority] = item.task;
  const existingTask = await prisma.caseWorkflowStep.findFirst({ where: { agencyId, caseId: caseItem.id, title: taskTitle, isStandaloneTask: true } });
  const taskData = { description: `${MARKER}: assigned consultant work item.`, sortOrder: 100, priority: taskPriority, isActive: true, status: "Pending", isStandaloneTask: true, assignedToId: consultant.id, dueAt: addDays(taskDays) };
  if (existingTask) await prisma.caseWorkflowStep.update({ where: { id: existingTask.id }, data: taskData });
  else await prisma.caseWorkflowStep.create({ data: { agencyId, caseId: caseItem.id, title: taskTitle, ...taskData } });

  const [followUpTitle, followUpDays] = item.followUp;
  const existingFollowUp = await prisma.followUp.findFirst({ where: { agencyId, caseId: caseItem.id, title: followUpTitle } });
  const followUpData = { clientId: client.id, assignedUserId: consultant.id, description: `${MARKER}: client follow-up.`, dueDate: addDays(followUpDays, 11), status: "Pending" };
  if (existingFollowUp) await prisma.followUp.update({ where: { id: existingFollowUp.id }, data: followUpData });
  else await prisma.followUp.create({ data: { agencyId, caseId: caseItem.id, title: followUpTitle, ...followUpData } });

  const [appointmentSubject, appointmentDays] = item.appointment;
  const existingAppointment = await prisma.appointment.findFirst({ where: { agencyId, caseId: caseItem.id, subject: appointmentSubject } });
  const startsAt = addDays(appointmentDays, 14);
  const appointmentData = { clientId: client.id, subject: appointmentSubject, location: "Video meeting", startsAt, endsAt: new Date(startsAt.getTime() + 45 * 60_000), assignedToId: consultant.id, createdById: consultant.id, status: "Scheduled", description: `${MARKER}: upcoming client appointment.` };
  if (existingAppointment) await prisma.appointment.update({ where: { id: existingAppointment.id }, data: appointmentData });
  else await prisma.appointment.create({ data: { agencyId, caseId: caseItem.id, ...appointmentData } });

  const existingNote = await prisma.note.findFirst({ where: { agencyId, caseId: caseItem.id, content: { startsWith: MARKER } } });
  if (!existingNote) await prisma.note.create({ data: { agencyId, clientId: client.id, caseId: caseItem.id, userId: consultant.id, content: `${MARKER}: Review completed; continue with the listed next action.`, clientVisible: false } });

  const [totalFee, paidAmount] = item.fee;
  const paymentNote = `${MARKER}: sample fee agreement.`;
  const existingPayment = await prisma.payment.findFirst({ where: { agencyId, caseId: caseItem.id, notes: paymentNote } });
  const paymentData = { clientId: client.id, totalFee, paidAmount, balance: totalFee - paidAmount, status: paidAmount === totalFee ? "Paid" : paidAmount ? "Partial" : "Unpaid", currency: "CAD", notes: paymentNote };
  if (existingPayment) await prisma.payment.update({ where: { id: existingPayment.id }, data: paymentData });
  else await prisma.payment.create({ data: { agencyId, caseId: caseItem.id, ...paymentData } });

  const existingActivity = await prisma.activityLog.findFirst({ where: { agencyId, caseId: caseItem.id, action: "sample.case_seeded" } });
  if (!existingActivity) await prisma.activityLog.create({ data: { agencyId, userId: consultant.id, clientId: client.id, caseId: caseItem.id, action: "sample.case_seeded", details: `${MARKER}: ${item.caseType} sample case created.`, entityType: "case", entityId: caseItem.id } });
}

async function main() {
  const { agency, consultant } = await findContext();
  await prisma.consultantProfile.upsert({
    where: { agencyId_userId: { agencyId: agency.id, userId: consultant.id } },
    update: { employeeId: "CHK-1001", specializations: ["Express Entry", "Study Permits", "Family Sponsorship", "Work Permits"], masteryLevel: "Senior", maximumActiveCases: 24 },
    create: { agencyId: agency.id, userId: consultant.id, employeeId: "CHK-1001", specializations: ["Express Entry", "Study Permits", "Family Sponsorship", "Work Permits"], masteryLevel: "Senior", maximumActiveCases: 24 },
  });

  for (const item of definitions) {
    const client = await ensureClient(agency.id, consultant.id, item);
    const caseItem = await ensureCase(agency.id, consultant.id, client.id, item);
    await ensureRelatedRecords(agency.id, consultant, client, caseItem, item);
  }

  const counts = await Promise.all([
    prisma.client.count({ where: { agencyId: agency.id, assignedUserId: consultant.id } }),
    prisma.case.count({ where: { agencyId: agency.id, assignedUserId: consultant.id } }),
    prisma.caseWorkflowStep.count({ where: { agencyId: agency.id, assignedToId: consultant.id, status: "Pending" } }),
    prisma.followUp.count({ where: { agencyId: agency.id, assignedUserId: consultant.id, status: "Pending" } }),
    prisma.appointment.count({ where: { agencyId: agency.id, assignedToId: consultant.id, status: "Scheduled" } }),
  ]);
  console.log(JSON.stringify({ agency: agency.name, consultant: consultant.fullName, clients: counts[0], cases: counts[1], pendingTasks: counts[2], pendingFollowUps: counts[3], scheduledAppointments: counts[4] }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
