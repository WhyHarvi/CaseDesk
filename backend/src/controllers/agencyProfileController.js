import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";

const agencySelect = {
  id: true,
  name: true,
  legalName: true,
  email: true,
  phone: true,
  website: true,
  address: true,
  city: true,
  province: true,
  country: true,
  postalCode: true,
  timezone: true,
  defaultCurrency: true,
  businessNumber: true,
  taxNumber: true,
  createdAt: true,
};

function requiredText(value, field, max = 160) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > max) {
    throw createHttpError(400, `${field} is required and must be ${max} characters or fewer.`, "VALIDATION_ERROR");
  }
  return normalized;
}

function optionalText(value, field, max = 160) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (normalized.length > max) {
    throw createHttpError(400, `${field} must be ${max} characters or fewer.`, "VALIDATION_ERROR");
  }
  return normalized || null;
}

function requiredEmail(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw createHttpError(400, "Enter a valid public email address.", "VALIDATION_ERROR");
  }
  return normalized;
}

function validTimezone(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: normalized });
  } catch {
    throw createHttpError(400, "Enter a valid IANA timezone, for example America/Toronto.", "VALIDATION_ERROR");
  }
  return normalized;
}

function validCurrency(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return null;
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw createHttpError(400, "Currency must be a 3-letter ISO code, for example CAD.", "VALIDATION_ERROR");
  }
  return normalized;
}

async function agencyStats(agencyId) {
  const [teamMembers, clients, activeCases] = await Promise.all([
    prisma.user.count({ where: { agencyId, status: "active", role: { in: ["admin", "consultant"] } } }),
    prisma.client.count({ where: { agencyId } }),
    prisma.case.count({ where: { agencyId, status: { not: "Closed" } } }),
  ]);
  return { teamMembers, clients, activeCases };
}

function publicAgency(agency, stats = undefined) {
  return {
    id: agency.id,
    name: agency.name,
    legalName: agency.legalName,
    email: agency.email,
    phone: agency.phone,
    website: agency.website,
    address: agency.address,
    city: agency.city,
    province: agency.province,
    country: agency.country,
    postalCode: agency.postalCode,
    timezone: agency.timezone,
    defaultCurrency: agency.defaultCurrency,
    businessNumber: agency.businessNumber,
    taxNumber: agency.taxNumber,
    createdAt: agency.createdAt,
    ...(stats ? { stats } : {}),
  };
}

export async function getAgencyProfile(req, res) {
  const [agency, stats] = await Promise.all([
    prisma.agency.findUnique({ where: { id: req.auth.agencyId }, select: agencySelect }),
    agencyStats(req.auth.agencyId),
  ]);
  if (!agency) throw createHttpError(404, "Agency not found.", "NOT_FOUND");
  res.json({ success: true, data: publicAgency(agency, stats) });
}

export async function updateAgencyProfile(req, res) {
  const name = requiredText(req.body.name, "Agency name");
  const data = {
    name,
    legalName: optionalText(req.body.legalName, "Legal name", 200) || name,
    email: requiredEmail(req.body.email),
    phone: optionalText(req.body.phone, "Phone", 40),
    website: optionalText(req.body.website, "Website", 200),
    address: optionalText(req.body.address, "Address", 200),
    city: optionalText(req.body.city, "City", 100),
    province: optionalText(req.body.province, "Province or state", 100),
    country: optionalText(req.body.country, "Country", 80),
    postalCode: optionalText(req.body.postalCode, "Postal code", 24),
    timezone: validTimezone(req.body.timezone) || "America/Toronto",
    defaultCurrency: validCurrency(req.body.defaultCurrency) || "CAD",
    businessNumber: optionalText(req.body.businessNumber, "Business number", 60),
    taxNumber: optionalText(req.body.taxNumber, "Tax number", 60),
  };

  const agency = await prisma.agency.update({
    where: { id: req.auth.agencyId },
    data,
    select: agencySelect,
  });

  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "AGENCY_PROFILE_UPDATED",
    details: "Agency profile details updated",
  });

  res.json({ success: true, data: publicAgency(agency, await agencyStats(req.auth.agencyId)), message: "Agency profile updated." });
}
