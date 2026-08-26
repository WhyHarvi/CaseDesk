import prisma from "./prisma/client.js";
import { caseAccessWhere, clientAccessWhere, relatedRecordAccessWhere } from "../middleware/authorization.js";
import { leadAccessWhere, leadSegmentWhere } from "../modules/leads/lead.permissions.js";
import { reportingBounds } from "../modules/leads/lead.metrics.js";
import { getPaymentsSummary } from "./paymentsOverviewService.js";
import { hasPortalCapability, hasPortalPageAccess, portalDataScope } from "./portalAccessService.js";

const APPOINTMENT_WORDS = /\b(appointments?|bookings?|calendar)\b/i;
const COUNT_WORDS = /\b(how many|count|number of)\b/i;
const DATE_WORDS = /\b(which|what|show|list|dates?|days?|times?|when)\b/i;
const AFFIRMATIVE = /^\s*(yes|yeah|yep|sure|please|ok(?:ay)?|show me|go ahead)\b/i;
const PERSONAL_SCOPE = /\b(my|mine|for me|assigned to me|do i|i have)\b/i;
const UPCOMING_APPOINTMENT_LIMIT = 50;
const NUMBER_QUESTION = /\b(how many|how much|count|number of|total|active|open|pending|overdue|converted|lost|nurture|collected|outstanding|refunded|transactions?|cash on hand)\b/i;
// "What does the overdue count mean?" asks for an explanation, not a live
// number — but it still contains "overdue" and "count", the exact words
// NUMBER_QUESTION looks for. Without this check it either gets swallowed
// by a domain match that has nothing to do with the actual question (e.g.
// "leads" for "what does a nurture lead mean?"), or falls through to the
// "I can't verify that live number yet" refusal — a real, reported
// exchange: a plain definitional question got refused instead of answered.
const DEFINITIONAL_QUESTION = /\bwhat\s+(?:does|do|is|are)\b[\s\S]*\bmean(?:s)?\b/i;
const OVERDUE_COUNT_DEFINITION = /\b(?:what\s+(?:does|is)|define|explain)\b[\s\S]*\boverdue(?:\s+(?:task|tasks))?\s+count\b[\s\S]*\b(?:mean|means)?\b/i;
const PERFORMANCE_WORDS = /\b(incentives?|commissions?|bonuses?|performance(?:\s+summary)?)\b/i;
const APPOINTMENT_CONFIGURATION = /\b(hours?|minutes?|notice|duration|buffer|slots?|working hours?|schedule hours?)\b/i;
const DOMAIN_PATTERNS = Object.freeze([
  ["performance", PERFORMANCE_WORDS],
  ["followUps", /\b(follow[ -]?ups?|reminders?)\b/i],
  ["appointments", APPOINTMENT_WORDS],
  ["leads", /\bleads?\b/i],
  ["clients", /\bclients?\b/i],
  // Checked before "cases": a documents question naturally mentions "case"
  // in passing ("documents outstanding on my cases"), so the narrower,
  // more specific domain must win that phrasing, not the broader container.
  ["documents", /\bdocuments?\b/i],
  ["cases", /\bcases?\b/i],
  ["payments", /\b(payments?|invoices?|collected|outstanding|balance|revenue|refund(?:ed|s)?|transactions?|cash on hand)\b/i],
]);
const DOCUMENT_OUTSTANDING_STATUSES = Object.freeze(["Requested", "Uploaded", "UnderReview", "ChangesRequested"]);
const DOCUMENT_REVIEW_STATUSES = Object.freeze(["Uploaded", "UnderReview"]);
const DOCUMENT_COMPLETE_STATUSES = Object.freeze(["Approved", "Finalized"]);
const TERMINAL_CASE_STATUSES = ["Completed", "Closed", "Cancelled", "Inactive"];
const NAMED_LEAD_ASSIGNEE = /\b(?:s?assigned|asigned|allocated|owned)\s+(?:directly\s+)?(?:to|by)\b|\bleads?(?:\s+(?:count|total|number))?\s+(?:for|under|of)\b|\bleads?\s+does\b|[\p{L}][\p{L}'’-]*['’]s\s+leads?\b/iu;
const LEAD_TEAM_ROLES = Object.freeze([
  { role: "frontdesk", label: "Front desk staff", pattern: /\bfront[\s-]?desk\b/i },
  { role: "consultant", label: "Consultants", pattern: /\bconsultants?\b/i },
  { role: "admin", label: "Administrators", pattern: /\badmins?|administrators?\b/i },
]);
const NOVA_LINKS = Object.freeze({
  calendar: "[Open Calendar](/app/calendar)",
  leads: "[Open Leads](/leads)",
  clients: "[Open Clients](/app/clients)",
  cases: "[Open Cases](/app/cases)",
  documents: "[Open Documents](/app/documents)",
  followUps: "[Open Follow-ups](/app/follow-ups)",
  payments: "[Open Payments](/app/payments)",
  workload: "[Open Workload](/app/workload)",
});

function messageText(message) {
  return String(message?.content || message?.bodyText || "").trim();
}

function latestUserMessage(messages) {
  return [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) => message?.role === "user" && messageText(message));
}

function previousAppointmentQuestion(messages, currentMessage) {
  return [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) => message !== currentMessage && message?.role === "user" && APPOINTMENT_WORDS.test(messageText(message)));
}

export function appointmentInsightIntent(messages, role) {
  const currentMessage = latestUserMessage(messages);
  const currentText = messageText(currentMessage);
  const previousQuestion = previousAppointmentQuestion(messages, currentMessage);
  const affirmativeFollowUp = AFFIRMATIVE.test(currentText) && Boolean(previousQuestion);
  const anchorText = affirmativeFollowUp ? messageText(previousQuestion) : currentText;

  if (!affirmativeFollowUp && !APPOINTMENT_WORDS.test(currentText)) return null;

  const personal = role === "consultant" || PERSONAL_SCOPE.test(anchorText);
  if (affirmativeFollowUp) {
    return { kind: "dates", personal, question: anchorText };
  }
  if (APPOINTMENT_CONFIGURATION.test(currentText)) {
    return { kind: "context", personal, question: anchorText };
  }
  if (COUNT_WORDS.test(currentText) || /\bupcoming\b/i.test(currentText)) {
    return { kind: "count", personal, question: anchorText };
  }
  if (DATE_WORDS.test(currentText)) {
    return { kind: "dates", personal, question: anchorText };
  }
  return { kind: "context", personal, question: anchorText };
}

export function crmMetricIntent(messages) {
  const message = latestUserMessage(messages);
  const question = messageText(message);
  if (DEFINITIONAL_QUESTION.test(question)) return null;
  const namedLeadCount = /\bleads?\b/i.test(question) && NAMED_LEAD_ASSIGNEE.test(question);
  if (!NUMBER_QUESTION.test(question) && !namedLeadCount && !PERFORMANCE_WORDS.test(question)) return null;
  const match = DOMAIN_PATTERNS.find(([, pattern]) => pattern.test(question));
  if (!match) return null;
  const compare = comparisonRequested(question) ? "previous_period" : "none";
  return {
    domain: match[0],
    question,
    personal: PERSONAL_SCOPE.test(question),
    subject: PERSONAL_SCOPE.test(question)
      ? { type: "self", name: null, role: null }
      : { type: "workspace", name: null, role: null },
    period: compare === "previous_period" && comparativeLastMonthRequested(question)
      ? "current_month"
      : inferredPeriod(question),
    compare,
  };
}

function pageDenied(page) {
  return {
    answer: `You don’t currently have access to the ${page}, so I can’t read those live numbers for you. Ask an administrator to enable access.`,
  };
}

function statusRequested(question, status) {
  return new RegExp(`\\b${status}\\b`, "i").test(question);
}

function inferredPeriod(question) {
  if (/\b(?:all[ -]?time|ever|lifetime)\b/i.test(question)) return "all_time";
  if (/\b(?:last|previous) month\b/i.test(question)) return "previous_month";
  if (/\b(?:this|current) week\b/i.test(question)) return "current_week";
  if (/\btoday\b/i.test(question)) return "today";
  if (/\b(?:this|current) month\b/i.test(question)) return "current_month";
  return null;
}

function comparisonRequested(question) {
  return /\b(compare|comparison|compared|versus|vs\.?|trend|change from|difference from)\b/i.test(question);
}

function comparativeLastMonthRequested(question) {
  return /\b(?:with|to|from|versus|vs\.?)\s+(?:last|previous) month\b/i.test(question);
}

function structuredMetricIntent(messages, structuredIntent) {
  if (!structuredIntent?.domain) return null;
  const question = messageText(latestUserMessage(messages));
  const recentUserQuestions = (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === "user")
    .slice(-6)
    .map(messageText)
    .filter(Boolean);
  const recentUserText = recentUserQuestions.join("\n");
  const explicitComparison = comparisonRequested(recentUserText);
  const comparativeLastMonth = explicitComparison && comparativeLastMonthRequested(recentUserText);
  const explicitPeriod = comparativeLastMonth
    ? "current_month"
    : [...recentUserQuestions].reverse().map(inferredPeriod).find(Boolean) || null;
  const supportedStatus = structuredIntent.status && statusRequested(recentUserText, structuredIntent.status)
    ? structuredIntent.status
    : null;
  return {
    domain: structuredIntent.domain,
    metric: structuredIntent.metric || "summary",
    question: [question, supportedStatus].filter(Boolean).join(" "),
    personal: structuredIntent.subject?.type === "self",
    subject: structuredIntent.subject || { type: "workspace", name: null, role: null },
    status: supportedStatus,
    period: explicitPeriod || (structuredIntent.domain === "performance" ? "current_month" : null),
    compare: structuredIntent.compare === "previous_period" && explicitComparison ? "previous_period" : "none",
  };
}

function routeLink(label, route, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  return `[${label}](${route}${query.size ? `?${query.toString()}` : ""})`;
}

function appointmentWhere(req, intent, now) {
  return {
    agencyId: req.auth.agencyId,
    status: "Scheduled",
    startsAt: { gte: now },
    ...(intent.assignedToId
      ? { assignedToId: intent.assignedToId }
      : intent.assignedToIds
        ? { assignedToId: { in: intent.assignedToIds } }
        : intent.personal
          ? { assignedToId: req.auth.userId }
          : {}),
  };
}

function timezoneDateKey(value, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateLabel(value, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(value);
}

function timeLabel(value, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function targetVerb(targetLabel) {
  return /(?:staff|consultants|administrators)$/i.test(targetLabel) ? "have" : "has";
}

function countAnswer(total, personal, targetLabel = "") {
  if (!total) {
    const answer = targetLabel
      ? `${targetLabel} ${targetVerb(targetLabel)} no upcoming appointments right now.`
      : personal
        ? "You have no upcoming appointments right now."
        : "There are no upcoming appointments on the workspace calendar right now.";
    return `${answer}\n\n${NOVA_LINKS.calendar}`;
  }
  const noun = total === 1 ? "appointment" : "appointments";
  const opening = targetLabel
    ? `${targetLabel} ${targetVerb(targetLabel)} ${total} upcoming ${noun}.`
    : personal
      ? `You have ${total} upcoming ${noun}.`
      : `There ${total === 1 ? "is" : "are"} ${total} upcoming ${noun} on the workspace calendar.`;
  return `${opening} ${total === 1 ? "Would you like to see when it is?" : "Would you like to see which days they are on?"}\n\n${NOVA_LINKS.calendar}`;
}

function datesAnswer(rows, total, personal, timezone, targetLabel = "") {
  if (!total) return countAnswer(total, personal, targetLabel);
  const groups = new Map();
  for (const appointment of rows) {
    const startsAt = new Date(appointment.startsAt);
    const key = timezoneDateKey(startsAt, timezone);
    const group = groups.get(key) || { label: dateLabel(startsAt, timezone), times: [] };
    group.times.push(timeLabel(startsAt, timezone));
    groups.set(key, group);
  }
  const scope = targetLabel ? `${targetLabel}'s` : personal ? "Your" : "The workspace's";
  const shown = rows.length < total ? ` Here are the first ${rows.length}:` : ":";
  const lines = [...groups.values()].map((group) => {
    const suffix = group.times.length === 1 ? "appointment" : "appointments";
    return `- **${group.label}** — ${group.times.join(", ")} (${group.times.length} ${suffix})`;
  });
  return `${scope} ${total} upcoming ${total === 1 ? "appointment is" : "appointments are"} scheduled on ${groups.size} ${groups.size === 1 ? "day" : "days"}${shown}\n${lines.join("\n")}\n\n${NOVA_LINKS.calendar}`;
}

function appointmentFact(appointment, timezone) {
  return {
    startsAt: new Date(appointment.startsAt).toISOString(),
    localDate: dateLabel(new Date(appointment.startsAt), timezone),
    localTime: timeLabel(new Date(appointment.startsAt), timezone),
    subject: String(appointment.subject || "Appointment").slice(0, 160),
    attendee: String(appointment.client?.fullName || appointment.guestName || "Guest").slice(0, 160),
    assignedTo: String(appointment.assignedTo?.fullName || "Unassigned").slice(0, 160),
    meetingMode: String(appointment.meetingMode || "InPerson").slice(0, 40),
  };
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function normalizedWords(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamMemberMentionScore(question, user) {
  const normalizedQuestion = ` ${normalizedWords(question)} `;
  const normalizedName = normalizedWords(user.fullName);
  const nameParts = normalizedName.split(" ").filter(Boolean);
  if (!normalizedName || !nameParts.length) return 0;
  if (normalizedQuestion.includes(` ${normalizedName} `)) return 100 + nameParts.length;

  const emailName = normalizedWords(String(user.email || "").split("@")[0]);
  if (emailName && normalizedQuestion.includes(` ${emailName} `)) return 90;

  const matchingParts = nameParts.filter((part) => part.length >= 3 && normalizedQuestion.includes(` ${part} `));
  if (!matchingParts.length) return 0;
  return (matchingParts.includes(nameParts[0]) ? 50 : 10) + matchingParts.length;
}

async function activeTeamUsers(req, db) {
  return db.user.findMany({
    where: {
      agencyId: req.auth.agencyId,
      status: "active",
      memberships: {
        some: {
          agencyId: req.auth.agencyId,
          isActive: true,
          role: { in: ["admin", "consultant", "frontdesk"] },
        },
      },
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      memberships: {
        where: { agencyId: req.auth.agencyId, isActive: true },
        select: { role: true },
      },
    },
  });
}

function mentionedTeamMember(users, question) {
  const ranked = users
    .map((user) => ({ user, score: teamMemberMentionScore(question, user) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.user.fullName.localeCompare(right.user.fullName));
  if (!ranked.length) return null;
  const best = ranked.filter((candidate) => candidate.score === ranked[0].score);
  if (best.length > 1) {
    return { error: `I found more than one matching team member (${best.map(({ user }) => user.fullName).join(", ")}). Please use the full name.` };
  }
  return { user: best[0].user };
}

async function appointmentTarget(req, intent, db) {
  const subjectType = intent.subject?.type;
  if (!subjectType || subjectType === "workspace" || subjectType === "self") return intent;
  if (req.auth.role !== "admin") {
    return { error: "Only workspace administrators can request another team member’s appointment totals." };
  }
  const users = await activeTeamUsers(req, db);
  if (subjectType === "team_member") {
    const mentioned = mentionedTeamMember(users, intent.subject.name);
    if (mentioned?.error) return mentioned;
    if (!mentioned?.user) return { error: "I couldn’t identify that person as an active team member. Try their full name." };
    return { ...intent, assignedToId: mentioned.user.id, targetLabel: mentioned.user.fullName };
  }
  const roleTarget = LEAD_TEAM_ROLES.find(({ role }) => role === intent.subject?.role);
  const userIds = roleTarget
    ? users
        .filter((user) => user.memberships?.some((membership) => membership.role === roleTarget.role))
        .map((user) => user.id)
    : [];
  if (!roleTarget || !userIds.length) return { error: "I couldn’t find active team members in that role." };
  return { ...intent, assignedToIds: userIds, targetLabel: roleTarget.label };
}

async function resolveAppointmentMetric(req, intent, db, now) {
  if (!hasPortalPageAccess(req, "calendar")) return pageDenied("Calendar");
  const normalizedIntent = {
    ...intent,
    kind: intent.kind || (intent.metric === "dates" ? "dates" : "count"),
    personal: intent.subject?.type === "self" || intent.personal,
  };
  const targetedIntent = await appointmentTarget(req, normalizedIntent, db);
  if (targetedIntent.error) return { answer: targetedIntent.error };

  const where = appointmentWhere(req, targetedIntent, now);
  const needsRows = targetedIntent.kind !== "count";
  const [total, appointments, settings] = await Promise.all([
    db.appointment.count({ where }),
    needsRows
      ? db.appointment.findMany({
          where,
          orderBy: { startsAt: "asc" },
          take: UPCOMING_APPOINTMENT_LIMIT,
          select: {
            startsAt: true,
            subject: true,
            guestName: true,
            meetingMode: true,
            client: { select: { fullName: true } },
            assignedTo: { select: { fullName: true } },
          },
        })
      : Promise.resolve([]),
    needsRows
      ? db.bookingSettings.findUnique({ where: { agencyId: req.auth.agencyId }, select: { timezone: true } })
      : Promise.resolve(null),
  ]);
  const timezone = settings?.timezone || "America/Toronto";

  if (targetedIntent.kind === "count") {
    return { answer: countAnswer(total, targetedIntent.personal, targetedIntent.targetLabel) };
  }
  if (targetedIntent.kind === "dates") {
    return { answer: datesAnswer(appointments, total, targetedIntent.personal, timezone, targetedIntent.targetLabel) };
  }
  return {
    liveContext: JSON.stringify({
      source: "CaseDesk live calendar",
      generatedAt: now.toISOString(),
      timezone,
      scope: targetedIntent.targetLabel
        ? `upcoming appointments assigned to ${targetedIntent.targetLabel}`
        : targetedIntent.personal
          ? "appointments assigned to the authenticated user"
          : "appointments visible on the workspace calendar",
      upcomingScheduledCount: total,
      upcomingAppointments: appointments.map((appointment) => appointmentFact(appointment, timezone)),
      truncated: appointments.length < total,
    }),
  };
}

async function resolveNamedLeadAssignee(req, intent, db) {
  const question = intent.question;
  const structuredTarget = ["team_member", "role"].includes(intent.subject?.type);
  if (!structuredTarget && !NAMED_LEAD_ASSIGNEE.test(question)) return null;
  if (portalDataScope(req, "leads") !== "all") {
    return {
      error: "Your Lead data access is limited to records assigned to you, so I can’t read another team member’s lead totals.",
    };
  }

  const users = await activeTeamUsers(req, db);
  const mentioned = mentionedTeamMember(users, intent.subject?.name || question);
  if (mentioned) return mentioned;

  const roleTarget = intent.subject?.type === "role"
    ? LEAD_TEAM_ROLES.find(({ role }) => role === intent.subject.role)
    : LEAD_TEAM_ROLES.find(({ pattern }) => pattern.test(question));
  if (roleTarget) {
    const userIds = users
      .filter((user) => user.memberships?.some((membership) => membership.role === roleTarget.role))
      .map((user) => user.id);
    if (!userIds.length) return { error: `There are no active ${roleTarget.label.toLowerCase()} in this workspace.` };
    return { role: { ...roleTarget, userIds } };
  }
  return { error: "I couldn’t identify that assignee as an active team member. Try their full name." };
}

function leadStatusCounts(rows) {
  const counts = Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  return {
    total: rows.reduce((sum, row) => sum + row._count._all, 0),
    open: counts.OPEN || 0,
    nurture: counts.NURTURE || 0,
    lost: counts.LOST || 0,
    converted: counts.CONVERTED || 0,
  };
}

function namedLeadAnswer(question, assignee, counts, plural = false) {
  const verb = plural ? "have" : "has";
  const requestedStatus = statusRequested(question, "converted")
    ? ["converted", counts.converted]
    : statusRequested(question, "lost")
      ? ["lost", counts.lost]
      : statusRequested(question, "nurture")
        ? ["nurture", counts.nurture]
        : statusRequested(question, "active") || statusRequested(question, "open")
          ? ["open", counts.open]
          : null;
  if (requestedStatus) {
    const [label, value] = requestedStatus;
    return `${assignee.fullName} ${verb} ${countLabel(value, `${label} Standard-pipeline lead`)} assigned.\n\n${NOVA_LINKS.leads}`;
  }
  const other = counts.total - counts.open - counts.nurture - counts.lost - counts.converted;
  const otherNote = other > 0 ? `, and ${other} in other statuses` : "";
  return `${assignee.fullName} ${verb} ${countLabel(counts.total, "Standard-pipeline lead")} assigned: ${counts.open} open, ${counts.nurture} nurture, ${counts.lost} lost, and ${counts.converted} converted${otherNote}.\n\n${NOVA_LINKS.leads}`;
}

async function resolveLeadMetric(req, intent, db) {
  if (!hasPortalPageAccess(req, "leads") && !hasPortalPageAccess(req, "leadIntake")) return pageDenied("Leads");
  const access = leadAccessWhere(req);
  const standardWhere = {
    agencyId: req.auth.agencyId,
    deletedAt: null,
    ...leadSegmentWhere("STANDARD"),
    AND: [access],
  };
  const namedAssignee = await resolveNamedLeadAssignee(req, intent, db);
  if (namedAssignee?.error) return { answer: namedAssignee.error };
  if (namedAssignee?.user || namedAssignee?.role) {
    const ownerUserId = namedAssignee.user?.id || { in: namedAssignee.role.userIds };
    const rows = await db.lead.groupBy({
      by: ["status"],
      where: { ...standardWhere, ownerUserId },
      _count: { _all: true },
    });
    const target = namedAssignee.user || { fullName: namedAssignee.role.label };
    const answer = namedLeadAnswer(intent.question, target, leadStatusCounts(rows), Boolean(namedAssignee.role));
    const link = namedAssignee.user
      ? routeLink("Open these Leads", "/leads", {
          ownerUserId: namedAssignee.user.id,
          status: intent.status ? intent.status.toUpperCase() : "ALL",
        })
      : NOVA_LINKS.leads;
    return { answer: answer.replace(NOVA_LINKS.leads, link) };
  }
  const assignedWhere = { ...standardWhere, ownerUserId: req.auth.userId };
  const [statusRows, assignedStatusRows, importReview] = await Promise.all([
    db.lead.groupBy({ by: ["status"], where: standardWhere, _count: { _all: true } }),
    db.lead.groupBy({ by: ["status"], where: assignedWhere, _count: { _all: true } }),
    db.lead.count({ where: { ...standardWhere, ...leadSegmentWhere("IMPORT_REVIEW") } }),
  ]);
  const counts = Object.fromEntries(statusRows.map((row) => [row.status, row._count._all]));
  const assignedCounts = Object.fromEntries(assignedStatusRows.map((row) => [row.status, row._count._all]));
  const total = statusRows.reduce((sum, row) => sum + row._count._all, 0);
  const assignedTotal = assignedStatusRows.reduce((sum, row) => sum + row._count._all, 0);
  const open = counts.OPEN || 0;
  const nurture = counts.NURTURE || 0;
  const lost = counts.LOST || 0;
  const converted = counts.CONVERTED || 0;
  const assignedOpen = assignedCounts.OPEN || 0;
  const assignedNurture = assignedCounts.NURTURE || 0;
  const assignedLost = assignedCounts.LOST || 0;
  const assignedConverted = assignedCounts.CONVERTED || 0;

  const question = intent.question;
  const workspaceRequested = /\b(total|workspace|agency|all)\b/i.test(question);
  const personalOnly = intent.personal && !workspaceRequested;
  const metrics = statusRequested(question, "converted")
    ? { label: "converted", visible: converted, assigned: assignedConverted }
    : statusRequested(question, "lost")
      ? { label: "lost", visible: lost, assigned: assignedLost }
      : statusRequested(question, "nurture")
        ? { label: "nurture", visible: nurture, assigned: assignedNurture }
        : statusRequested(question, "active") || statusRequested(question, "open")
          ? { label: "open", visible: open, assigned: assignedOpen }
          : null;

  if (metrics) {
    const value = personalOnly ? metrics.assigned : metrics.visible;
    const scope = personalOnly ? "assigned to you" : req.auth.role === "admin" ? "in the Standard workspace pipeline" : "visible to you";
    return { answer: `There are ${value} ${metrics.label} ${value === 1 ? "lead" : "leads"} ${scope}.\n\n${NOVA_LINKS.leads}` };
  }
  if (personalOnly) {
    return { answer: `You have ${countLabel(assignedTotal, "Standard-pipeline lead")} assigned to you; ${assignedOpen} ${assignedOpen === 1 ? "is" : "are"} open.\n\n${NOVA_LINKS.leads}` };
  }

  const scope = req.auth.role === "admin" ? "The workspace has" : "You can access";
  const assignedNote = req.auth.role === "admin" || intent.personal
    ? ` ${countLabel(assignedTotal, "lead")} ${assignedTotal === 1 ? "is" : "are"} assigned directly to you.`
    : "";
  const reviewNote = importReview ? ` Import Review contains another ${countLabel(importReview, "record")}.` : "";
  const other = total - open - nurture - lost - converted;
  const finalBreakdown = other > 0 ? `${converted} converted, and ${other} in other statuses` : `and ${converted} converted`;
  return {
    answer: `${scope} ${countLabel(total, "Standard-pipeline lead")} in total: ${open} open, ${nurture} nurture, ${lost} lost, ${finalBreakdown}.${assignedNote}${reviewNote}\n\n${NOVA_LINKS.leads}`,
  };
}

async function resolveClientMetric(req, intent, db) {
  if (!hasPortalPageAccess(req, "clients")) return pageDenied("Clients");
  const access = clientAccessWhere(req);
  const base = { agencyId: req.auth.agencyId, AND: [access] };
  const currentWhere = { ...base, archivedAt: null };
  const assignedWhere = { ...currentWhere, assignedUserId: req.auth.userId };
  const [total, active, inactive, closed, archived, assignedTotal, assignedActive] = await Promise.all([
    db.client.count({ where: currentWhere }),
    db.client.count({ where: { ...currentWhere, status: "Active" } }),
    db.client.count({ where: { ...currentWhere, status: "Inactive" } }),
    db.client.count({ where: { ...currentWhere, status: "Closed" } }),
    db.client.count({ where: { ...base, archivedAt: { not: null } } }),
    db.client.count({ where: assignedWhere }),
    db.client.count({ where: { ...assignedWhere, status: "Active" } }),
  ]);
  const personalOnly = intent.personal && !/\b(total|workspace|agency|all)\b/i.test(intent.question);
  if (statusRequested(intent.question, "active")) {
    const value = personalOnly ? assignedActive : active;
    return { answer: `${personalOnly ? "You have" : req.auth.role === "admin" ? "The workspace has" : "You can access"} ${countLabel(value, "active client")}${personalOnly ? " assigned to you" : ""}.\n\n${NOVA_LINKS.clients}` };
  }
  if (personalOnly) {
    return { answer: `You have ${countLabel(assignedTotal, "current client")} assigned to you; ${assignedActive} ${assignedActive === 1 ? "is" : "are"} active.\n\n${NOVA_LINKS.clients}` };
  }
  const assignedNote = req.auth.role === "admin" || intent.personal ? ` ${countLabel(assignedTotal, "client")} ${assignedTotal === 1 ? "is" : "are"} assigned directly to you.` : "";
  return { answer: `${req.auth.role === "admin" ? "The workspace has" : "You can access"} ${countLabel(total, "non-archived client")} in total: ${active} active, ${inactive} inactive, and ${closed} closed. There are also ${countLabel(archived, "archived client")}.${assignedNote}\n\n${NOVA_LINKS.clients}` };
}

function personalCaseWhere(req) {
  return {
    OR: [
      { assignedUserId: req.auth.userId },
      { assignments: { some: { consultantUserId: req.auth.userId, status: "active" } } },
    ],
  };
}

async function resolveCaseMetric(req, intent, db) {
  if (!hasPortalPageAccess(req, "cases")) return pageDenied("Cases");
  const access = caseAccessWhere(req);
  const base = { agencyId: req.auth.agencyId, deletedAt: null, AND: [access] };
  const current = { ...base, archivedAt: null };
  const activeWhere = { ...current, status: { notIn: TERMINAL_CASE_STATUSES } };
  const closedWhere = { ...current, status: { in: TERMINAL_CASE_STATUSES } };
  const personal = personalCaseWhere(req);
  const [total, active, closed, archived, personalTotal, personalActive] = await Promise.all([
    db.case.count({ where: base }),
    db.case.count({ where: activeWhere }),
    db.case.count({ where: closedWhere }),
    db.case.count({ where: { ...base, archivedAt: { not: null } } }),
    db.case.count({ where: { ...base, AND: [access, personal] } }),
    db.case.count({ where: { ...activeWhere, AND: [access, personal] } }),
  ]);
  const personalOnly = intent.personal && !/\b(total|workspace|agency|all)\b/i.test(intent.question);
  if (statusRequested(intent.question, "active") || statusRequested(intent.question, "open")) {
    const value = personalOnly ? personalActive : active;
    return { answer: `${personalOnly ? "You have" : req.auth.role === "admin" ? "The workspace has" : "You can access"} ${countLabel(value, "active case")}${personalOnly ? " assigned to you" : ""}.\n\n${NOVA_LINKS.cases}` };
  }
  if (personalOnly) {
    return { answer: `You have access to ${countLabel(personalTotal, "case")} through assignment or collaboration; ${personalActive} ${personalActive === 1 ? "is" : "are"} active.\n\n${NOVA_LINKS.cases}` };
  }
  const personalNote = req.auth.role === "admin" || intent.personal ? ` You are assigned to or collaborating on ${countLabel(personalTotal, "case")}.` : "";
  return { answer: `${req.auth.role === "admin" ? "The workspace has" : "You can access"} ${countLabel(total, "non-deleted case")} in total: ${active} active, ${closed} closed, and ${archived} archived.${personalNote}\n\n${NOVA_LINKS.cases}` };
}

async function resolveDocumentMetric(req, intent, db) {
  if (!hasPortalPageAccess(req, "documents")) return pageDenied("Documents");
  const access = relatedRecordAccessWhere(req);
  const base = { agencyId: req.auth.agencyId, AND: [access] };
  const [total, outstanding, notYetUploaded, awaitingReview, changesRequested, complete, notRequired] = await Promise.all([
    db.clientDocument.count({ where: base }),
    db.clientDocument.count({ where: { ...base, status: { in: DOCUMENT_OUTSTANDING_STATUSES } } }),
    db.clientDocument.count({ where: { ...base, status: "Requested" } }),
    db.clientDocument.count({ where: { ...base, status: { in: DOCUMENT_REVIEW_STATUSES } } }),
    db.clientDocument.count({ where: { ...base, status: "ChangesRequested" } }),
    db.clientDocument.count({ where: { ...base, status: { in: DOCUMENT_COMPLETE_STATUSES } } }),
    db.clientDocument.count({ where: { ...base, status: "NotRequired" } }),
  ]);
  const question = intent.question;
  if (/\b(awaiting|pending) review\b/i.test(question) || /\bunder review\b/i.test(question)) {
    return { answer: `There ${awaitingReview === 1 ? "is" : "are"} ${countLabel(awaitingReview, "document")} waiting on staff review.\n\n${NOVA_LINKS.documents}` };
  }
  if (statusRequested(question, "outstanding") || statusRequested(question, "pending")) {
    return { answer: `There ${outstanding === 1 ? "is" : "are"} ${countLabel(outstanding, "outstanding document")} across the cases you can access.\n\n${NOVA_LINKS.documents}` };
  }
  if (statusRequested(question, "completed") || /\b(approved|finalized)\b/i.test(question)) {
    return { answer: `${countLabel(complete, "document")} ${complete === 1 ? "is" : "are"} approved or finalized.\n\n${NOVA_LINKS.documents}` };
  }
  return {
    answer: `There ${total === 1 ? "is" : "are"} ${countLabel(total, "document record")} across the cases you can access: ${outstanding} outstanding (${notYetUploaded} not yet uploaded, ${awaitingReview} awaiting staff review, ${changesRequested} sent back for changes), ${complete} approved or finalized, and ${notRequired} marked not required.\n\n${NOVA_LINKS.documents}`,
  };
}

async function resolveFollowUpMetric(req, intent, db, now) {
  if (!hasPortalPageAccess(req, "followUps") && !hasPortalPageAccess(req, "cases")) return pageDenied("Follow-ups");
  const agency = await db.agency.findUnique({ where: { id: req.auth.agencyId }, select: { timezone: true } });
  const { todayStart, tomorrowStart } = reportingBounds(now, agency?.timezone || "America/Toronto");
  const personal = intent.personal || req.auth.role !== "admin";
  const assignment = personal ? { assignedUserId: req.auth.userId } : {};
  const caseBase = { agencyId: req.auth.agencyId, ...assignment };
  const leadBase = {
    agencyId: req.auth.agencyId,
    ...assignment,
    lead: { agencyId: req.auth.agencyId, deletedAt: null, ...leadSegmentWhere("STANDARD") },
  };
  const [casePending, leadPending, caseOverdue, leadOverdue, caseToday, leadToday, caseCompleted, leadCompleted] = await Promise.all([
    db.followUp.count({ where: { ...caseBase, status: "Pending" } }),
    db.leadFollowUp.count({ where: { ...leadBase, status: "PENDING" } }),
    db.followUp.count({ where: { ...caseBase, status: "Pending", dueDate: { lt: todayStart } } }),
    db.leadFollowUp.count({ where: { ...leadBase, status: "PENDING", dueAt: { lt: todayStart } } }),
    db.followUp.count({ where: { ...caseBase, status: "Pending", dueDate: { gte: todayStart, lt: tomorrowStart } } }),
    db.leadFollowUp.count({ where: { ...leadBase, status: "PENDING", dueAt: { gte: todayStart, lt: tomorrowStart } } }),
    db.followUp.count({ where: { ...caseBase, status: "Completed" } }),
    db.leadFollowUp.count({ where: { ...leadBase, status: "COMPLETED" } }),
  ]);
  const pending = casePending + leadPending;
  const overdue = caseOverdue + leadOverdue;
  const dueToday = caseToday + leadToday;
  const completed = caseCompleted + leadCompleted;
  const scope = personal ? "assigned to you" : "across the workspace";
  if (statusRequested(intent.question, "overdue")) return { answer: `There are ${countLabel(overdue, "overdue follow-up")} ${scope}.\n\n${NOVA_LINKS.followUps}` };
  if (/\b(today|due today)\b/i.test(intent.question)) return { answer: `There are ${countLabel(dueToday, "follow-up")} due today ${scope}.\n\n${NOVA_LINKS.followUps}` };
  if (statusRequested(intent.question, "completed")) return { answer: `There are ${countLabel(completed, "completed follow-up")} ${scope}.\n\n${NOVA_LINKS.followUps}` };
  return { answer: `There are ${countLabel(pending, "pending follow-up")} ${scope}: ${overdue} overdue and ${dueToday} due today.\n\n${NOVA_LINKS.followUps}` };
}

function performancePeriod(period, now, timezone) {
  const bounds = reportingBounds(now, timezone);
  const monthName = (date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    month: "long",
    year: "numeric",
  }).format(date);
  const dayName = (date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
  if (period === "all_time") {
    return { key: period, start: null, end: null, label: "All time", suffix: "all time", previous: null };
  }
  if (period === "today") {
    return {
      key: period,
      start: bounds.todayStart,
      end: bounds.tomorrowStart,
      label: `Today · ${dayName(bounds.todayStart)}`,
      suffix: "today",
      previous: {
        start: bounds.previousDayStart,
        end: bounds.todayStart,
        label: `Yesterday · ${dayName(bounds.previousDayStart)}`,
      },
    };
  }
  if (period === "current_week") {
    return {
      key: period,
      start: bounds.weekStart,
      end: bounds.tomorrowStart,
      label: "This week",
      suffix: "this week",
      previous: { start: bounds.previousWeekStart, end: bounds.weekStart, label: "Previous week" },
    };
  }
  if (period === "previous_month") {
    return {
      key: period,
      start: bounds.previousMonthStart,
      end: bounds.monthStart,
      label: monthName(bounds.previousMonthStart),
      suffix: `in ${monthName(bounds.previousMonthStart)}`,
      previous: {
        start: bounds.twoMonthsAgoStart,
        end: bounds.previousMonthStart,
        label: monthName(bounds.twoMonthsAgoStart),
      },
    };
  }
  return {
    key: "current_month",
    start: bounds.monthStart,
    end: bounds.nextMonthStart,
    label: monthName(now),
    suffix: "this month",
    previous: {
      start: bounds.previousMonthStart,
      end: bounds.monthStart,
      label: monthName(bounds.previousMonthStart),
    },
  };
}

function rangeField(field, range) {
  return range?.start && range?.end ? { [field]: { gte: range.start, lt: range.end } } : {};
}

async function performanceActivityCounts(req, userId, leadBase, leadFollowUpLead, range, db) {
  const [converted, attended, caseFollowUps, leadFollowUps] = await Promise.all([
    db.lead.count({
      where: { ...leadBase, status: "CONVERTED", ...rangeField("convertedAt", range) },
    }),
    db.appointment.count({
      where: {
        agencyId: req.auth.agencyId,
        assignedToId: userId,
        status: "Completed",
        ...rangeField("startsAt", range),
      },
    }),
    db.followUp.count({
      where: {
        agencyId: req.auth.agencyId,
        completedById: userId,
        status: "Completed",
        ...rangeField("completedAt", range),
      },
    }),
    db.leadFollowUp.count({
      where: {
        agencyId: req.auth.agencyId,
        completedById: userId,
        status: "COMPLETED",
        lead: leadFollowUpLead,
        ...rangeField("completedAt", range),
      },
    }),
  ]);
  return { converted, attended, completedFollowUps: caseFollowUps + leadFollowUps };
}

function comparisonLine(current, previous) {
  const change = current - previous;
  return `${current} vs ${previous} (${change > 0 ? "+" : ""}${change})`;
}

async function resolvePerformanceMetric(req, intent, db, now) {
  if (req.auth.role !== "admin") {
    return { answer: "Only workspace administrators can view team-member performance summaries." };
  }
  if (intent.subject?.type === "role") {
    return { answer: "Choose one active team member for a verified performance summary; role-wide incentive calculations are not configured." };
  }
  const users = await activeTeamUsers(req, db);
  const mentioned = mentionedTeamMember(users, intent.subject?.name || intent.question);
  if (mentioned?.error) return { answer: mentioned.error };
  const selfRequested = intent.subject?.type === "self" || PERSONAL_SCOPE.test(intent.question);
  const user = mentioned?.user || (selfRequested
    ? users.find((candidate) => candidate.id === req.auth.userId)
    : null);
  if (!user) {
    return { answer: "Tell me the active team member’s name so I can build a verified performance summary." };
  }

  const agency = await db.agency.findUnique({
    where: { id: req.auth.agencyId },
    select: { timezone: true },
  });
  const timezone = agency?.timezone || "America/Toronto";
  const bounds = reportingBounds(now, timezone);
  const range = performancePeriod(intent.period || "current_month", now, timezone);
  const leadBase = {
    agencyId: req.auth.agencyId,
    ownerUserId: user.id,
    deletedAt: null,
    ...leadSegmentWhere("STANDARD"),
  };
  const leadFollowUpBase = {
    agencyId: req.auth.agencyId,
    assignedUserId: user.id,
    lead: {
      agencyId: req.auth.agencyId,
      deletedAt: null,
      ...leadSegmentWhere("STANDARD"),
    },
  };
  const [snapshot, activity, previousActivity] = await Promise.all([
    Promise.all([
      db.lead.groupBy({ by: ["status"], where: leadBase, _count: { _all: true } }),
      db.case.count({
        where: {
          agencyId: req.auth.agencyId,
          assignedUserId: user.id,
          deletedAt: null,
          archivedAt: null,
          status: { notIn: TERMINAL_CASE_STATUSES },
        },
      }),
      db.followUp.count({ where: { agencyId: req.auth.agencyId, assignedUserId: user.id, status: "Pending" } }),
      db.leadFollowUp.count({ where: { ...leadFollowUpBase, status: "PENDING" } }),
      db.followUp.count({
        where: {
          agencyId: req.auth.agencyId,
          assignedUserId: user.id,
          status: "Pending",
          dueDate: { lt: bounds.todayStart },
        },
      }),
      db.leadFollowUp.count({ where: { ...leadFollowUpBase, status: "PENDING", dueAt: { lt: bounds.todayStart } } }),
    ]),
    performanceActivityCounts(req, user.id, leadBase, leadFollowUpBase.lead, range, db),
    intent.compare === "previous_period" && range.previous
      ? performanceActivityCounts(req, user.id, leadBase, leadFollowUpBase.lead, range.previous, db)
      : Promise.resolve(null),
  ]);
  const [leadRows, activeCases, caseFollowUpsPending, leadFollowUpsPending, caseFollowUpsOverdue, leadFollowUpsOverdue] = snapshot;
  const leads = leadStatusCounts(leadRows);
  const pendingFollowUps = caseFollowUpsPending + leadFollowUpsPending;
  const overdueFollowUps = caseFollowUpsOverdue + leadFollowUpsOverdue;
  const comparison = previousActivity
    ? `\n\n**Compared with ${range.previous.label}**\n- Leads converted: ${comparisonLine(activity.converted, previousActivity.converted)}\n- Appointments attended: ${comparisonLine(activity.attended, previousActivity.attended)}\n- Follow-ups completed: ${comparisonLine(activity.completedFollowUps, previousActivity.completedFollowUps)}`
    : "";
  const links = [
    routeLink("Open these Leads", "/leads", { ownerUserId: user.id, status: "ALL" }),
    NOVA_LINKS.workload,
    NOVA_LINKS.calendar,
    routeLink("Open these Follow-ups", "/app/follow-ups", { assignedUserId: user.id, view: "all" }),
  ].join(" · ");

  return {
    answer: `CaseDesk has no incentive formula configured, so this is a verified performance summary—not an incentive amount.\n\n**${user.fullName} · ${range.label}**\n- Current lead portfolio: ${countLabel(leads.total, "Standard-pipeline lead")} (${leads.open} open, ${leads.nurture} nurture, ${leads.converted} converted, ${leads.lost} lost)\n- Leads converted ${range.suffix}: ${activity.converted}\n- Appointments attended ${range.suffix}: ${activity.attended}\n- Active cases currently owned: ${activeCases}\n- Follow-ups completed ${range.suffix}: ${activity.completedFollowUps}\n- Follow-ups currently pending: ${pendingFollowUps} (${overdueFollowUps} overdue)${comparison}\n\n${links}`,
  };
}

function money(value, currency) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(Number(value || 0));
}

async function resolvePaymentMetric(req, intent, db, paymentSummary) {
  if (!hasPortalPageAccess(req, "payments") || !hasPortalCapability(req, "financialData")) return pageDenied("Payments");
  const [summary, agency] = await Promise.all([
    paymentSummary(req.auth.agencyId, { reconcile: false }),
    db.agency.findUnique({ where: { id: req.auth.agencyId }, select: { defaultCurrency: true } }),
  ]);
  const currency = agency?.defaultCurrency || "CAD";
  const question = intent.question;
  if (/\bcash on hand\b/i.test(question)) return { answer: `Current recorded cash on hand is **${money(summary.cashOnHand, currency)}**.\n\n${NOVA_LINKS.payments}` };
  if (statusRequested(question, "outstanding")) return { answer: `The current outstanding balance is **${money(summary.outstandingBalance, currency)}** across the permitted workspace payment records.\n\n${NOVA_LINKS.payments}` };
  if (/\brefund/i.test(question)) return { answer: `Total completed refunds are **${money(summary.totalRefunded, currency)}**.\n\n${NOVA_LINKS.payments}` };
  if (/\b(this month|monthly)\b/i.test(question) && /\b(collected|paid)\b/i.test(question)) return { answer: `CaseDesk records **${money(summary.paidThisMonth, currency)}** collected this month.\n\n${NOVA_LINKS.payments}` };
  if (/\b(collected|paid)\b/i.test(question)) return { answer: `Total net collected is **${money(summary.totalCollected, currency)}**. Completed refunds total **${money(summary.totalRefunded, currency)}**.\n\n${NOVA_LINKS.payments}` };
  return { answer: `There are ${countLabel(summary.totalTransactions, "payment transaction")} in the combined CaseDesk and QuickBooks ledger.\n\n${NOVA_LINKS.payments}` };
}

const METRIC_REGISTRY = Object.freeze({
  appointments: ({ req, intent, db, now }) => resolveAppointmentMetric(req, intent, db, now),
  performance: ({ req, intent, db, now }) => resolvePerformanceMetric(req, intent, db, now),
  leads: ({ req, intent, db }) => resolveLeadMetric(req, intent, db),
  clients: ({ req, intent, db }) => resolveClientMetric(req, intent, db),
  cases: ({ req, intent, db }) => resolveCaseMetric(req, intent, db),
  documents: ({ req, intent, db }) => resolveDocumentMetric(req, intent, db),
  followUps: ({ req, intent, db, now }) => resolveFollowUpMetric(req, intent, db, now),
  payments: ({ req, intent, db, paymentSummary }) => resolvePaymentMetric(req, intent, db, paymentSummary),
});

export async function resolveCaseDeskAIInsight(req, messages, {
  db = prisma,
  now = new Date(),
  paymentSummary = getPaymentsSummary,
  structuredIntent = null,
} = {}) {
  const question = messageText(latestUserMessage(messages));
  if (OVERDUE_COUNT_DEFINITION.test(question)) {
    return {
      answer: "The **Overdue Tasks** count is the number of active workflow tasks that are still marked **Pending** and were due before today. It uses your agency’s timezone and only includes records within your permitted scope.\n\nIt does not include overdue follow-ups, unpaid balances, or pending documents; those are tracked separately. Select the Overdue Tasks card to see the tasks included in the count.\n\n[Open Dashboard](/app/dashboard)",
    };
  }

  const appointmentIntent = appointmentInsightIntent(messages, req.auth?.role);
  if (appointmentIntent) {
    return resolveAppointmentMetric(req, appointmentIntent, db, now);
  }

  const metricIntent = structuredMetricIntent(messages, structuredIntent) || crmMetricIntent(messages);
  if (!metricIntent) {
    if (NUMBER_QUESTION.test(question) && !DEFINITIONAL_QUESTION.test(question)) {
      return {
        answer: "I can’t verify that live number yet, so I won’t guess. I can currently verify appointments, leads, clients, cases, documents, follow-ups, and payment totals that your permissions allow.",
      };
    }
    return null;
  }
  const resolver = METRIC_REGISTRY[metricIntent.domain];
  if (resolver) return resolver({ req, intent: metricIntent, db, now, paymentSummary });
  return {
    answer: "I can’t verify that live number yet, so I won’t guess. I can currently verify appointments, leads, clients, cases, documents, follow-ups, and payment totals that your permissions allow.",
  };
}

// Unprompted, page-specific opening line shown before the user asks anything
// — reuses the same access-scoped, verified counts as the Q&A resolvers
// above, but only surfaces a route when there's something worth mentioning.
// A quiet page (nothing overdue, nothing outstanding) returns null rather
// than a hollow "0 things" banner.
const PROACTIVE_ROUTES = Object.freeze([
  { test: (path) => /^\/app\/follow-ups/.test(path) || /^\/app\/cases/.test(path), kind: "followUpsOverdue" },
  { test: (path) => /^\/app\/documents/.test(path), kind: "documentsOutstanding" },
  { test: (path) => /^\/app\/payments/.test(path), kind: "paymentsOutstanding" },
  { test: (path) => /^\/leads(?:$|\/(?!review))/.test(path), kind: "leadsPersonalOpen" },
  { test: (path) => /^\/app\/calendar/.test(path), kind: "appointmentsToday" },
]);

async function proactiveFollowUpsOverdue(req, db, now, personal) {
  if (!hasPortalPageAccess(req, "followUps") && !hasPortalPageAccess(req, "cases")) return null;
  const agency = await db.agency.findUnique({ where: { id: req.auth.agencyId }, select: { timezone: true } });
  const { todayStart } = reportingBounds(now, agency?.timezone || "America/Toronto");
  const assignment = personal ? { assignedUserId: req.auth.userId } : {};
  const caseBase = { agencyId: req.auth.agencyId, ...assignment };
  const leadBase = {
    agencyId: req.auth.agencyId,
    ...assignment,
    lead: { agencyId: req.auth.agencyId, deletedAt: null, ...leadSegmentWhere("STANDARD") },
  };
  const [caseOverdue, leadOverdue] = await Promise.all([
    db.followUp.count({ where: { ...caseBase, status: "Pending", dueDate: { lt: todayStart } } }),
    db.leadFollowUp.count({ where: { ...leadBase, status: "PENDING", dueAt: { lt: todayStart } } }),
  ]);
  const overdue = caseOverdue + leadOverdue;
  if (!overdue) return null;
  const scope = personal ? "You have" : "The workspace has";
  return `${scope} ${countLabel(overdue, "overdue follow-up")} right now.\n\n${NOVA_LINKS.followUps}`;
}

async function proactiveDocumentsOutstanding(req, db) {
  if (!hasPortalPageAccess(req, "documents")) return null;
  const access = relatedRecordAccessWhere(req);
  const outstanding = await db.clientDocument.count({
    where: { agencyId: req.auth.agencyId, AND: [access], status: { in: DOCUMENT_OUTSTANDING_STATUSES } },
  });
  if (!outstanding) return null;
  return `There ${outstanding === 1 ? "is" : "are"} ${countLabel(outstanding, "outstanding document")} waiting across the cases you can access.\n\n${NOVA_LINKS.documents}`;
}

async function proactivePaymentsOutstanding(req, db, paymentSummary) {
  if (!hasPortalPageAccess(req, "payments") || !hasPortalCapability(req, "financialData")) return null;
  const [summary, agency] = await Promise.all([
    paymentSummary(req.auth.agencyId, { reconcile: false }),
    db.agency.findUnique({ where: { id: req.auth.agencyId }, select: { defaultCurrency: true } }),
  ]);
  if (!summary.outstandingBalance) return null;
  return `There's **${money(summary.outstandingBalance, agency?.defaultCurrency || "CAD")}** outstanding right now.\n\n${NOVA_LINKS.payments}`;
}

async function proactiveLeadsPersonalOpen(req, db, personal) {
  if (!personal) return null;
  if (!hasPortalPageAccess(req, "leads") && !hasPortalPageAccess(req, "leadIntake")) return null;
  const access = leadAccessWhere(req);
  const open = await db.lead.count({
    where: {
      agencyId: req.auth.agencyId,
      deletedAt: null,
      ...leadSegmentWhere("STANDARD"),
      AND: [access],
      ownerUserId: req.auth.userId,
      status: "OPEN",
    },
  });
  if (!open) return null;
  return `You have ${countLabel(open, "open lead")} assigned to you.\n\n${NOVA_LINKS.leads}`;
}

async function proactiveAppointmentsToday(req, db, now, personal) {
  if (!hasPortalPageAccess(req, "calendar")) return null;
  const settings = await db.bookingSettings.findUnique({ where: { agencyId: req.auth.agencyId }, select: { timezone: true } });
  const timezone = settings?.timezone || "America/Toronto";
  const { todayStart, tomorrowStart } = reportingBounds(now, timezone);
  const count = await db.appointment.count({
    where: {
      agencyId: req.auth.agencyId,
      status: "Scheduled",
      startsAt: { gte: todayStart, lt: tomorrowStart },
      ...(personal ? { assignedToId: req.auth.userId } : {}),
    },
  });
  if (!count) return null;
  return `${personal ? "You have" : "There are"} ${countLabel(count, "appointment")} today.\n\n${NOVA_LINKS.calendar}`;
}

export async function resolveProactiveNovaInsight(req, {
  currentPath = "",
  db = prisma,
  now = new Date(),
  paymentSummary = getPaymentsSummary,
} = {}) {
  if (!req.auth) return null;
  const route = PROACTIVE_ROUTES.find((entry) => entry.test(String(currentPath || "")));
  if (!route) return null;
  const personal = req.auth.role !== "admin";

  const insight = await {
    followUpsOverdue: () => proactiveFollowUpsOverdue(req, db, now, personal),
    documentsOutstanding: () => proactiveDocumentsOutstanding(req, db),
    paymentsOutstanding: () => proactivePaymentsOutstanding(req, db, paymentSummary),
    leadsPersonalOpen: () => proactiveLeadsPersonalOpen(req, db, personal),
    appointmentsToday: () => proactiveAppointmentsToday(req, db, now, personal),
  }[route.kind]();

  return insight ? { insight } : null;
}
