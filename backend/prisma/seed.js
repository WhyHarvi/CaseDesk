import { PrismaClient } from "@prisma/client";
import { createAuthUser, findAuthUserByEmail } from "../src/services/supabaseAuth.js";
import { DEFAULT_LEAD_SOURCES } from "../src/modules/leads/lead.constants.js";
import { nextClientNumber } from "../src/services/clientNumberService.js";

const prisma = new PrismaClient();
const accounts = [
  { key: "ADMIN", email: "admin@demo.casedesk", fullName: "Avery Singh", role: "admin" },
  { key: "CONSULTANT1", email: "consultant1@demo.casedesk", fullName: "Maya Thompson", role: "consultant", employeeId: "CD-1001", specializations: ["Study Permits", "Express Entry"], masteryLevel: "Senior", capacity: 20 },
  { key: "CONSULTANT2", email: "consultant2@demo.casedesk", fullName: "Omar El-Amin", role: "consultant", employeeId: "CD-1002", specializations: ["Family Sponsorship", "Work Permits"], masteryLevel: "Intermediate", capacity: 16 },
  { key: "CLIENT1", email: "client1@demo.casedesk", fullName: "Priya Nair", role: "client" },
  { key: "CLIENT2", email: "client2@demo.casedesk", fullName: "Lucas Ferreira", role: "client" },
];

async function authIdFor(account) {
  const password = process.env[`DEMO_${account.key}_PASSWORD`] || process.env.DEMO_PASSWORD;
  if (!password || password.length < 10) throw new Error(`Set DEMO_${account.key}_PASSWORD or DEMO_PASSWORD (minimum 10 characters) before seeding.`);
  const existing = await findAuthUserByEmail(account.email);
  return existing?.id || (await createAuthUser({ email: account.email, password, fullName: account.fullName })).id;
}

async function main() {
  const agency = await prisma.agency.upsert({
    where: { slug: "demo-toronto-immigration" },
    update: { name: "North Star Immigration Services", status: "active", onboardingStatus: "active", accessStatus: "active" },
    create: { name: "North Star Immigration Services", slug: "demo-toronto-immigration", status: "active", onboardingStatus: "active", accessStatus: "active", email: "hello@northstar-demo.ca", phone: "+1 416 555 0142", address: "250 University Avenue", city: "Toronto", province: "Ontario", country: "Canada", postalCode: "M5T 1S2" },
  });
  const users = {};
  const leadSources = {};
  for (const [name, type] of DEFAULT_LEAD_SOURCES) {
    leadSources[type] = await prisma.leadSource.upsert({
      where: { agencyId_name: { agencyId: agency.id, name } },
      update: { type, isActive: true },
      create: { agencyId: agency.id, name, type },
    });
  }
  for (const account of accounts) {
    const authUserId = await authIdFor(account);
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: { agencyId: agency.id, authUserId, fullName: account.fullName, role: account.role, status: "active" },
      create: { agencyId: agency.id, authUserId, email: account.email, fullName: account.fullName, role: account.role, status: "active" },
    });
    await prisma.agencyMember.upsert({
      where: { agencyId_userId: { agencyId: agency.id, userId: user.id } },
      update: { role: account.role, isActive: true, permissions: account.role === "consultant" ? { createClientPortal: true } : {} },
      create: { agencyId: agency.id, userId: user.id, role: account.role, isActive: true, permissions: account.role === "consultant" ? { createClientPortal: true } : {} },
    });
    if (account.role === "consultant") await prisma.consultantProfile.upsert({
      where: { agencyId_userId: { agencyId: agency.id, userId: user.id } },
      update: { employeeId: account.employeeId, specializations: account.specializations, masteryLevel: account.masteryLevel, maximumActiveCases: account.capacity },
      create: { agencyId: agency.id, userId: user.id, employeeId: account.employeeId, specializations: account.specializations, masteryLevel: account.masteryLevel, maximumActiveCases: account.capacity },
    });
    users[account.key] = user;
  }

  const definitions = [
    { email: "priya.nair@example.ca", fullName: "Priya Nair", consultant: users.CONSULTANT1, portal: users.CLIENT1, caseType: "Study Permit Extension", stage: "Documents Pending", nextAction: "Upload your latest bank statement" },
    { email: "lucas.ferreira@example.ca", fullName: "Lucas Ferreira", consultant: users.CONSULTANT2, portal: users.CLIENT2, caseType: "Spousal Sponsorship", stage: "Application Preparation", nextAction: "Review relationship history" },
    { email: "amina.yusuf@example.ca", fullName: "Amina Yusuf", consultant: users.CONSULTANT1, caseType: "Express Entry", stage: "Profile Review", nextAction: "Confirm language test results" },
  ];
  for (const item of definitions) {
    let client = await prisma.client.findFirst({ where: { agencyId: agency.id, email: item.email } });
    if (!client) {
      client = await prisma.$transaction(async (tx) => tx.client.create({ data: { agencyId: agency.id, clientNumber: await nextClientNumber(tx, agency.id), fullName: item.fullName, email: item.email, emailNormalized: item.email.toLowerCase(), status: "Active", assignedUserId: item.consultant.id } }));
    }
    let caseItem = await prisma.case.findFirst({ where: { agencyId: agency.id, clientId: client.id, caseType: item.caseType } });
    caseItem ||= await prisma.case.create({ data: { agencyId: agency.id, clientId: client.id, assignedUserId: item.consultant.id, caseType: item.caseType, stage: item.stage, status: "Active", nextAction: item.nextAction } });
    await prisma.caseAssignment.upsert({ where: { agencyId_caseId_consultantUserId_assignmentType: { agencyId: agency.id, caseId: caseItem.id, consultantUserId: item.consultant.id, assignmentType: "primary" } }, update: { status: "active", assignedById: users.ADMIN.id }, create: { agencyId: agency.id, caseId: caseItem.id, consultantUserId: item.consultant.id, assignmentType: "primary", status: "active", assignedById: users.ADMIN.id } });
    if (item.portal) await prisma.clientUser.upsert({ where: { agencyId_clientId_userId: { agencyId: agency.id, clientId: client.id, userId: item.portal.id } }, update: { isPrimary: true }, create: { agencyId: agency.id, clientId: client.id, userId: item.portal.id, relationship: "self", isPrimary: true } });
    if (!(await prisma.clientDocument.findFirst({ where: { agencyId: agency.id, caseId: caseItem.id } }))) await prisma.clientDocument.createMany({ data: [{ agencyId: agency.id, clientId: client.id, caseId: caseItem.id, documentName: "Passport biodata page", normalizedName: "passport biodata page", status: "Approved", visibility: "Client" }, { agencyId: agency.id, clientId: client.id, caseId: caseItem.id, documentName: "Proof of funds", normalizedName: "proof of funds", status: "Requested", visibility: "Client" }] });
  }

  const leadSeeds = [
    { leadNumber: "LD-2026-000001", firstName: "Noah", lastName: "Martin", phone: "+14165550101", email: "noah.martin@example.ca", source: "FACEBOOK", interest: "Study Permit", owner: users.CONSULTANT1, stage: "NEW", status: "OPEN", nextActionType: "CALL", nextActionDescription: "Make the first contact call", nextActionAt: new Date(Date.now() - 60 * 60_000) },
    { leadNumber: "LD-2026-000002", firstName: "Fatima", lastName: "Khan", phone: "+16475550102", email: "fatima.khan@example.ca", source: "WHATSAPP", interest: "Spousal Sponsorship", owner: users.CONSULTANT2, stage: "CONTACTING", status: "OPEN", nextActionType: "CALLBACK", nextActionDescription: "Return the requested call", nextActionAt: new Date(Date.now() + 2 * 60 * 60_000) },
    { leadNumber: "LD-2026-000003", firstName: "Daniel", lastName: "Kim", phone: "+19055550103", email: "daniel.kim@example.ca", source: "REFERRAL", interest: "Express Entry", owner: users.CONSULTANT1, stage: "CONNECTED", status: "NURTURE", nextActionType: null, nextActionDescription: null, nextActionAt: null, nurtureUntil: new Date(Date.now() + 90 * 24 * 60 * 60_000) },
    { leadNumber: "LD-2026-000004", firstName: "Sofia", lastName: "Alvarez", phone: "+14165550104", email: "sofia.alvarez@example.ca", source: "WEBSITE", interest: "Work Permit", owner: users.CONSULTANT2, stage: "CONNECTED", status: "LOST", nextActionType: null, nextActionDescription: null, nextActionAt: null, lostAt: new Date() },
  ];
  for (const item of leadSeeds) {
    const lead = await prisma.lead.upsert({
      where: { agencyId_leadNumber: { agencyId: agency.id, leadNumber: item.leadNumber } },
      update: {},
      create: {
        agencyId: agency.id, leadNumber: item.leadNumber, firstName: item.firstName, lastName: item.lastName,
        phone: item.phone, phoneNormalized: item.phone, email: item.email, emailNormalized: item.email,
        originalSourceId: leadSources[item.source].id, immigrationInterest: item.interest, ownerUserId: item.owner.id,
        status: item.status, stage: item.stage, nextActionType: item.nextActionType, nextActionDescription: item.nextActionDescription,
        nextActionAt: item.nextActionAt, nextActionOwnerId: item.nextActionAt ? item.owner.id : null,
        nurtureUntil: item.nurtureUntil, lostAt: item.lostAt,
      },
    });
    if (!(await prisma.leadActivity.findFirst({ where: { leadId: lead.id, activityType: "LEAD_CREATED" } }))) {
      await prisma.leadActivity.create({ data: { agencyId: agency.id, leadId: lead.id, activityType: "LEAD_CREATED", direction: "INTERNAL", channel: "SYSTEM", title: "Lead created", performedById: users.ADMIN.id } });
      await prisma.leadStageHistory.create({ data: { agencyId: agency.id, leadId: lead.id, newStage: item.stage, changedById: users.ADMIN.id, reason: "Demo seed" } });
      await prisma.leadAssignmentHistory.create({ data: { agencyId: agency.id, leadId: lead.id, newOwnerId: item.owner.id, assignedById: users.ADMIN.id, assignmentType: "MANUAL", reason: "Demo seed" } });
      if (item.nextActionAt) await prisma.leadFollowUp.create({ data: { agencyId: agency.id, leadId: lead.id, assignedUserId: item.owner.id, type: item.nextActionType, description: item.nextActionDescription, dueAt: item.nextActionAt } });
      if (item.status === "LOST") await prisma.leadLostDetail.create({ data: { agencyId: agency.id, leadId: lead.id, reasonCode: "PRICE_CONCERN", notes: "Demo lead chose not to proceed due to budget.", lostById: users.ADMIN.id, attemptCount: 2 } });
    }
  }
  await prisma.agencyLeadSequence.upsert({ where: { agencyId: agency.id }, update: {}, create: { agencyId: agency.id, nextValue: 5 } });
  await prisma.agencyLeadSequence.updateMany({ where: { agencyId: agency.id, nextValue: { lt: 5 } }, data: { nextValue: 5 } });
  console.log("Demo agency, users, clients, cases, and the source-agnostic lead foundation are ready.");
}

main().catch((error) => { console.error(error); process.exit(1); }).finally(() => prisma.$disconnect());
