import { randomBytes } from "node:crypto";
import prisma from "../services/prisma/client.js";
import { deleteAuthUser, inviteAuthUser, updateAuthenticatedUser } from "../services/supabaseAuth.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";

const invitationLifetimeMs = 24 * 60 * 60 * 1000;

function text(value, name, max = 160, required = true) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if ((required && !normalized) || normalized.length > max) {
    throw createHttpError(400, `${name} ${required ? "is required and " : ""}must be ${max} characters or fewer.`, "VALIDATION_ERROR");
  }
  return normalized || null;
}

function email(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw createHttpError(400, "Enter a valid work email.", "VALIDATION_ERROR");
  }
  return normalized;
}

function slugFor(name) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "agency";
  return `${base}-${randomBytes(4).toString("hex")}`;
}

const acceptedResponse = (res) => res.status(202).json({
  success: true,
  message: "If this email can be registered, an invitation will arrive shortly.",
});

export async function registerAgency(req, res) {
  // New workspace registration is closed. Flip ALLOW_AGENCY_REGISTRATION=1 to reopen.
  if (process.env.ALLOW_AGENCY_REGISTRATION !== "1") {
    throw createHttpError(403, "New registrations are currently closed.", "REGISTRATION_DISABLED");
  }
  const input = {
    fullName: text(req.body?.fullName, "Full name"),
    workEmail: email(req.body?.workEmail),
    agencyName: text(req.body?.agencyName, "Workspace name"),
    phone: text(req.body?.phone, "Phone", 40, false),
    country: text(req.body?.country, "Country", 80),
  };
  if (req.body?.acceptTerms !== true) throw createHttpError(400, "You must accept the terms to create an account.", "TERMS_REQUIRED");

  const duplicate = await prisma.user.findUnique({ where: { email: input.workEmail }, select: { id: true } });
  if (duplicate) return acceptedResponse(res);

  let records;
  try {
    records = await prisma.$transaction(async (tx) => {
      const agency = await tx.agency.create({
        data: {
          name: input.agencyName,
          legalName: input.agencyName,
          slug: slugFor(input.agencyName),
          status: "invited",
          onboardingStatus: "pending_setup",
          accessStatus: "active",
          email: input.workEmail,
          phone: input.phone,
          country: input.country,
        },
      });
      const user = await tx.user.create({
        data: {
          agencyId: agency.id,
          fullName: input.fullName,
          email: input.workEmail,
          phone: input.phone,
          role: "admin",
          status: "invited",
          memberships: { create: { agencyId: agency.id, role: "admin", isActive: true } },
        },
      });
      const onboarding = await tx.onboardingRequest.create({
        data: {
          email: input.workEmail,
          fullName: input.fullName,
          agencyName: input.agencyName,
          phone: input.phone,
          country: input.country,
          status: "pending",
          agencyId: agency.id,
          userId: user.id,
          termsAcceptedAt: new Date(),
        },
      });
      return { agency, user, onboarding };
    });
  } catch (error) {
    if (error.code === "P2002") return acceptedResponse(res);
    throw error;
  }

  let authUser;
  try {
    const frontendUrl = String(process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
    authUser = await inviteAuthUser({
      email: input.workEmail,
      fullName: input.fullName,
      redirectTo: `${frontendUrl}/auth/accept-invite`,
    });
    const now = new Date();
    await prisma.$transaction([
      prisma.user.update({ where: { id: records.user.id }, data: { authUserId: authUser.id } }),
      prisma.onboardingRequest.update({
        where: { id: records.onboarding.id },
        data: { authUserId: authUser.id, status: "invited", invitedAt: now, expiresAt: new Date(now.getTime() + invitationLifetimeMs) },
      }),
    ]);
  } catch (error) {
    if (authUser?.id) await deleteAuthUser(authUser.id).catch(() => {});
    // Roll back the pending application records so a transient mail/Auth
    // failure can be retried safely with the same address.
    await prisma.agency.delete({ where: { id: records.agency.id } }).catch(async () => {
      await prisma.onboardingRequest.update({ where: { id: records.onboarding.id }, data: { status: "failed", failureCode: "INVITE_DELIVERY_FAILED" } }).catch(() => {});
    });
    throw createHttpError(503, "We could not send the invitation. Please try again later.", "INVITE_DELIVERY_FAILED");
  }

  await recordActivity({ agencyId: records.agency.id, userId: records.user.id, action: "AGENCY_INVITED", details: "Workspace owner invitation sent" });
  return acceptedResponse(res);
}

export async function getOnboardingStatus(req, res) {
  const request = req.onboardingRequest;
  res.json({
    success: true,
    data: {
      email: request.email,
      fullName: request.fullName,
      agency: {
        name: request.agency.name,
        email: request.agency.email,
        phone: request.agency.phone,
        address: request.agency.address,
        city: request.agency.city,
        province: request.agency.province,
        country: request.agency.country,
        postalCode: request.agency.postalCode,
      },
    },
  });
}

export async function completeAgencyOnboarding(req, res) {
  const password = String(req.body?.password || "");
  if (password.length < 10 || password.length > 128) {
    throw createHttpError(400, "Password must be between 10 and 128 characters.", "VALIDATION_ERROR");
  }
  const request = req.onboardingRequest;
  const agency = {
    name: text(req.body?.agencyName || request.agency.name, "Workspace name"),
    email: email(req.body?.agencyEmail || request.email),
    phone: text(req.body?.phone, "Phone", 40),
    address: text(req.body?.address, "Address", 200),
    city: text(req.body?.city, "City", 100),
    province: text(req.body?.province, "Province or state", 100),
    country: text(req.body?.country, "Country", 80),
    postalCode: text(req.body?.postalCode, "Postal code", 24),
  };

  await updateAuthenticatedUser(req.accessToken, {
    password,
    data: { full_name: request.fullName },
  });

  const completedAt = new Date();
  await prisma.$transaction([
    prisma.agency.update({
      where: { id: request.agencyId },
      data: { ...agency, legalName: agency.name, status: "active", onboardingStatus: "active", accessStatus: "active" },
    }),
    prisma.user.update({ where: { id: request.userId }, data: { status: "active", mustChangePassword: false } }),
    prisma.agencyMember.update({
      where: { agencyId_userId: { agencyId: request.agencyId, userId: request.userId } },
      data: { isActive: true, mustChangePassword: false },
    }),
    prisma.onboardingRequest.update({ where: { id: request.id }, data: { status: "completed", completedAt, failureCode: null } }),
  ]);
  await recordActivity({ agencyId: request.agencyId, userId: request.userId, action: "AGENCY_ONBOARDING_COMPLETED", details: "Workspace owner activated the workspace" });
  res.json({ success: true, message: "Your CaseDesk workspace is ready." });
}

export default { registerAgency, getOnboardingStatus, completeAgencyOnboarding };
