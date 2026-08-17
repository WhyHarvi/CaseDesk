import dotenv from "dotenv";
import prisma from "../src/services/prisma/client.js";
import { createAuthUser } from "../src/services/supabaseAuth.js";

dotenv.config();

const email = String(process.env.DEVELOPER_EMAIL || "").trim().toLowerCase();
const password = String(process.env.DEVELOPER_PASSWORD || "");
if (!email || password.length < 10) throw new Error("Set DEVELOPER_EMAIL and a DEVELOPER_PASSWORD of at least 10 characters.");

async function authRequest(path, options = {}) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase administration is not configured.");
  const response = await fetch(`${url}${path}`, { ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.msg || "Supabase request failed.");
  return payload;
}

try {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, authUserId: true } });
  if (existing) await prisma.user.delete({ where: { id: existing.id } });

  const authUsers = await authRequest(`/auth/v1/admin/users?page=1&per_page=1000`);
  const matches = (authUsers.users || []).filter((user) => user.email?.toLowerCase() === email);
  for (const user of matches) await authRequest(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });

  const agency = await prisma.agency.upsert({
    where: { slug: "casedesk-developer" },
    create: { name: "CaseDesk Developer", slug: "casedesk-developer", status: "active", onboardingStatus: "active", accessStatus: "active", email },
    update: { name: "CaseDesk Developer", status: "active", onboardingStatus: "active", accessStatus: "active", email },
    select: { id: true },
  });
  const authUser = await createAuthUser({ email, password, fullName: "CaseDesk Developer", mustChangePassword: false });
  await prisma.user.create({
    data: {
      agencyId: agency.id,
      authUserId: authUser.id,
      fullName: "CaseDesk Developer",
      email,
      role: "developer",
      status: "active",
      jobTitle: "Platform Monitoring",
      memberships: { create: { agencyId: agency.id, role: "developer", isActive: true, permissions: {} } },
    },
  });
  console.log(`Developer account provisioned for ${email}.`);
} finally {
  await prisma.$disconnect();
}
