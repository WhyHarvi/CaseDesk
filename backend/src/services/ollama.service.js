import { createHttpError } from "../utils/http.js";

const DEFAULT_MODEL = "qwen3:8b";
const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_TIMEOUT_MS = 45_000;

const NAVIGATION_CONTEXT = [
  "Dashboard: /app/dashboard - agency overview and daily priorities.",
  "Leads: /leads - inquiry pipeline and lead records.",
  "Import Review: /leads/review - imported leads awaiting cleanup.",
  "Calls: /calls - Ooma call inbox.",
  "Chats: /app/chats - client and internal conversations.",
  "Clients: /app/clients - client list and client profiles.",
  "Client profile: /app/clients/:id - client details, related cases, contact information.",
  "Cases: /app/cases - active casework list.",
  "Case profile: /app/cases/:id - case overview, documents, forms, tasks, billing, appointments, communication.",
  "New case document: /app/cases/:id/documents/new - draft a new written document for a case.",
  "Documents: /app/documents - uploads and document review across the agency.",
  "Follow-ups: /app/follow-ups - reminders and pending follow-up work.",
  "Calendar: /app/calendar - appointments and booking schedule.",
  "Payments: /app/payments - agency-wide payment history.",
  "Team Workload: /app/workload - capacity and assignments.",
  "Team Members: /app/team-members - consultants and staff, admin only.",
  "Case Easy Import: /app/case-easy-import - import and review Case Easy data.",
  "Settings: /app/settings - workspace controls and integrations.",
];

function ollamaBaseUrl() {
  return String(process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function ollamaHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (process.env.OLLAMA_AUTH_HEADER && process.env.OLLAMA_AUTH_VALUE) {
    headers[process.env.OLLAMA_AUTH_HEADER] = process.env.OLLAMA_AUTH_VALUE;
  }
  if (process.env.OLLAMA_CF_ACCESS_CLIENT_ID && process.env.OLLAMA_CF_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = process.env.OLLAMA_CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = process.env.OLLAMA_CF_ACCESS_CLIENT_SECRET;
  }
  return headers;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((item) => ["user", "assistant"].includes(item?.role))
    .map((item) => ({
      role: item.role,
      content: String(item.content || "").slice(0, 4_000),
    }))
    .filter((item) => item.content.trim())
    .slice(-12);
}

function systemPrompt({ currentPath, role }) {
  return [
    "You are CaseDesk's local navigation assistant.",
    "Your job is to help authenticated staff find where to go in the CaseDesk app when they feel stuck.",
    "Be brief, practical, and specific. Prefer one clear destination and one or two steps.",
    "Do not provide immigration, legal, medical, financial, or client-specific advice.",
    "If the user asks for work outside navigation or app usage, redirect them back to what CaseDesk screen or workflow may help.",
    "When recommending a route with :id, explain that they must open the relevant client or case first.",
    `Current user role: ${role || "unknown"}.`,
    `Current page: ${currentPath || "unknown"}.`,
    "Known CaseDesk destinations:",
    ...NAVIGATION_CONTEXT,
  ].join("\n");
}

function dependencyError(message, code = "OLLAMA_UNAVAILABLE") {
  return createHttpError(503, message, code);
}

async function parseOllamaError(response) {
  try {
    const data = await response.json();
    return data?.error || data?.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

export async function askCaseDeskAI(messages, context = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const model = process.env.OLLAMA_MODEL || DEFAULT_MODEL;

  const safeMessages = normalizeMessages(messages);
  if (!safeMessages.length) {
    throw createHttpError(400, "Message is required.", "AI_MESSAGE_REQUIRED");
  }

  let response;
  try {
    response = await fetch(`${ollamaBaseUrl()}/api/chat`, {
      method: "POST",
      headers: ollamaHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt(context) },
          ...safeMessages,
        ],
        stream: false,
        options: {
          temperature: 0.2,
        },
      }),
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw dependencyError("CaseDesk AI timed out. Check that the local Ollama tunnel is online.", "OLLAMA_TIMEOUT");
    }
    throw dependencyError("CaseDesk AI is unavailable. Check that Ollama and the tunnel are running.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await parseOllamaError(response);
    throw dependencyError(`Ollama returned ${response.status}: ${detail}`, "OLLAMA_REQUEST_FAILED");
  }

  const data = await response.json();
  const content = data?.message?.content;

  if (!content) {
    throw dependencyError("Ollama returned an empty response.", "OLLAMA_EMPTY_RESPONSE");
  }

  return {
    content,
    model: data.model || model,
  };
}

export async function checkCaseDeskAI() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${ollamaBaseUrl()}/api/tags`, {
      headers: ollamaHeaders(),
      signal: controller.signal,
    });
    if (!response.ok) return { available: false, status: response.status };
    const data = await response.json();
    return {
      available: true,
      baseUrl: ollamaBaseUrl(),
      model: process.env.OLLAMA_MODEL || DEFAULT_MODEL,
      models: Array.isArray(data.models) ? data.models.map((item) => item.name).filter(Boolean) : [],
    };
  } catch {
    return {
      available: false,
      baseUrl: ollamaBaseUrl(),
      model: process.env.OLLAMA_MODEL || DEFAULT_MODEL,
    };
  } finally {
    clearTimeout(timeout);
  }
}
