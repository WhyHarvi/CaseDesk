import prisma from "./prisma/client.js";

// System-default fee schedule templates, seeded once per agency the first
// time templates are listed (same lazy-seed pattern as
// ensureDefaultCorrespondenceTemplates in correspondenceTemplateService.js).
// Every dollar figure here is exactly what the agency specified. Government
// and biometric lines are seeded as separate "disbursement" installments so
// they stay outside HST (see taxLedger.js) — professional-fee installments
// use the "fees" payment type, which is the taxable one.
//
// Trigger conventions used throughout: the first payment is due at signing
// (Date, 0 days after signing); a second/third staged payment tied to an
// invitation (Express Entry / OINP) is seeded as a Date trigger 30 days
// after signing — a placeholder, since the real invitation date isn't known
// in advance; anything described as "on submission" uses the Stage trigger
// pointing at the "Submitted" case stage, which fires automatically once a
// case reaches that stage, alongside its government/biometric fee(s).
const D0 = { triggerType: "Date", triggerDaysAfterSigning: 0 };
const D30 = { triggerType: "Date", triggerDaysAfterSigning: 30 };
const SUBMITTED = { triggerType: "Stage", triggerStage: "Submitted" };

function fee(label, amount, trigger) {
  return { label, paymentType: "fees", amount, ...trigger };
}
function govt(label, amount, trigger) {
  return { label, paymentType: "disbursement", amount, ...trigger };
}

export const defaultBillingTemplates = [
  {
    name: "Visitor Visa / Visitor Record / Super Visa — System Default",
    caseType: "Visitor Visa / Visitor Record / Super Visa",
    caseTags: ["visitor visa", "visitor record", "super visa"],
    installments: [
      fee("Initial payment", 200, D0),
      fee("On submission", 300, SUBMITTED),
      govt("Government fee", 100, SUBMITTED),
      govt("Biometrics", 85, SUBMITTED),
    ],
  },
  {
    name: "Study Permit (Inside Canada) — System Default",
    caseType: "Study Permit (Inside Canada)",
    caseTags: ["study permit inside canada", "study permit"],
    installments: [
      fee("Initial payment", 500, D0),
      fee("On submission", 500, SUBMITTED),
      govt("Government fee", 150, SUBMITTED),
    ],
  },
  {
    name: "Study Permit (Outside Canada) — System Default",
    caseType: "Study Permit (Outside Canada)",
    caseTags: ["study permit outside canada"],
    installments: [
      fee("Initial payment", 500, D0),
      fee("On submission", 1000, SUBMITTED),
      govt("Government fee", 150, SUBMITTED),
      govt("Biometrics", 85, SUBMITTED),
    ],
  },
  {
    name: "PGWP — System Default",
    caseType: "PGWP",
    caseTags: ["pgwp", "post-graduation work permit"],
    installments: [
      fee("Initial payment", 100, D0),
      fee("On submission", 200, SUBMITTED),
    ],
  },
  {
    name: "Spousal Open Work Permit — System Default",
    caseType: "Spousal Open Work Permit",
    caseTags: ["spousal open work permit", "sowp"],
    installments: [
      fee("Initial payment", 500, D0),
      fee("On submission", 1000, SUBMITTED),
      govt("Government fee (work permit — $100 instead if open work permit)", 155, SUBMITTED),
    ],
  },
  {
    name: "SOWP Extension — System Default",
    caseType: "SOWP Extension",
    caseTags: ["sowp extension", "spousal open work permit extension"],
    installments: [
      fee("Initial payment", 250, D0),
      fee("On submission", 500, SUBMITTED),
      govt("Government fee (work permit — $100 instead if open work permit)", 155, SUBMITTED),
    ],
  },
  {
    name: "SOWP (Outside Canada) — System Default",
    caseType: "SOWP (Outside Canada)",
    caseTags: ["sowp outside canada", "spousal open work permit outside canada"],
    installments: [
      fee("Initial payment", 500, D0),
      fee("On submission", 2000, SUBMITTED),
      govt("Government fee (work permit — $100 instead if open work permit)", 155, SUBMITTED),
      govt("Biometrics", 85, SUBMITTED),
    ],
  },
  {
    name: "LMIA Based Work Permit — System Default",
    caseType: "LMIA Based Work Permit",
    caseTags: ["lmia work permit", "lmia based work permit"],
    installments: [
      fee("Initial payment", 500, D0),
      fee("On submission", 2000, SUBMITTED),
      govt("Government fee", 155, SUBMITTED),
      govt("Biometrics", 85, SUBMITTED),
    ],
  },
  {
    name: "Vulnerable OWP — System Default",
    caseType: "Vulnerable OWP",
    caseTags: ["vulnerable owp", "vulnerable open work permit"],
    installments: [
      fee("Initial payment", 500, D0),
      fee("On submission", 2000, SUBMITTED),
    ],
  },
  {
    name: "PNP Based Work Permit — System Default",
    caseType: "PNP Based Work Permit",
    caseTags: ["pnp work permit", "pnp based work permit"],
    installments: [
      fee("Initial payment", 500, D0),
      fee("On submission", 500, SUBMITTED),
      govt("Government fee", 155, SUBMITTED),
    ],
  },
  {
    name: "Refugee Work Permit — System Default",
    caseType: "Refugee Work Permit",
    caseTags: ["refugee work permit", "refugee wp"],
    installments: [
      fee("One-time payment", 300, D0),
      // No government fee line — the agency noted $155 "if applicable" only,
      // so staff add it manually per case rather than it being seeded here.
    ],
  },
  {
    name: "Temporary Resident Visa (TRV) — System Default",
    caseType: "Temporary Resident Visa (TRV)",
    caseTags: ["temporary resident visa", "trv"],
    installments: [
      fee("One-time payment", 100, D0),
      govt("Government fee", 100, D0),
    ],
  },
  {
    name: "PR — Express Entry — System Default",
    caseType: "PR — Express Entry",
    caseTags: ["express entry", "pr express entry"],
    installments: [
      fee("Initial payment", 500, D0),
      fee("Invitation", 500, D30),
      fee("On submission", 1000, SUBMITTED),
      govt("Government fee", 1590, SUBMITTED),
      govt("Biometrics", 85, SUBMITTED),
    ],
  },
  {
    name: "PR — Express Entry with Spousal — System Default",
    caseType: "PR — Express Entry with Spousal",
    caseTags: ["express entry spousal", "express entry with spouse", "pr express entry spousal"],
    installments: [
      fee("Initial payment", 750, D0),
      fee("Invitation", 1250, D30),
      fee("On submission", 1500, SUBMITTED),
      govt("Government fee", 1260, SUBMITTED),
      govt("Biometrics", 85, SUBMITTED),
    ],
  },
  {
    name: "OINP — PNP — System Default",
    caseType: "OINP — PNP",
    caseTags: ["oinp", "ontario pnp", "pr pnp", "oinp pnp"],
    installments: [
      fee("Initial payment", 500, D0),
      fee("Invitation", 1000, D30),
      fee("On submission", 1000, SUBMITTED),
    ],
  },
  {
    name: "Spousal Sponsorship — System Default",
    caseType: "Spousal Sponsorship",
    caseTags: ["spousal sponsorship", "family sponsorship"],
    installments: [
      fee("Initial payment", 1000, D0),
      fee("On submission", 1500, SUBMITTED),
    ],
  },
];

export async function ensureDefaultBillingTemplates(agencyId) {
  const existing = new Set(
    (await prisma.paymentScheduleTemplate.findMany({ where: { agencyId }, select: { name: true } })).map((item) => item.name),
  );
  for (const item of defaultBillingTemplates) {
    if (existing.has(item.name)) continue;
    try {
      await prisma.paymentScheduleTemplate.create({
        data: {
          agencyId,
          caseType: item.caseType,
          name: item.name,
          caseTags: item.caseTags,
          isSystemDefault: true,
          installments: { create: item.installments.map((installment, index) => ({ ...installment, sortOrder: index })) },
        },
      });
    } catch (error) {
      // Two case screens can seed the same new agency concurrently — no
      // unique key on name today, so fall back to a duplicate-name check
      // rather than crash the request.
      if (error.code !== "P2002") throw error;
    }
  }
}
