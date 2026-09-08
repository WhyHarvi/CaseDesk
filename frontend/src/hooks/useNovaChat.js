import { useSyncExternalStore } from "react";
import api from "../services/api";
import { setNovaCatVisible } from "./useNovaCatVisibility";

export const NOVA_SLASH_COMMANDS = Object.freeze([
  { name: "/hide", description: "Hide Nova’s cat until you ask her to follow again." },
  { name: "/follow", description: "Bring Nova’s cat back and let her roam with you." },
]);

const NOVA_COMMAND_ALIASES = Object.freeze({
  "/hide": { visible: false, reply: "Nova’s cat is hidden. Type `/follow` whenever you want her back." },
  "/stop": { visible: false, reply: "Nova’s cat is hidden. Type `/follow` whenever you want her back." },
  "/follow": { visible: true, reply: "Nova’s cat will follow you around CaseDesk again." },
  "/show": { visible: true, reply: "Nova’s cat will follow you around CaseDesk again." },
});

function welcomeMessage() {
  return {
    id: "nova-welcome",
    direction: "Inbound",
    bodyText: "Hi, I’m Nova. How can I help you? I can guide you through CaseDesk, find the right place, or help draft and rewrite messages, emails, and notes.",
    occurredAt: new Date().toISOString(),
    systemOnly: true,
  };
}

let snapshot = {
  messages: [welcomeMessage()],
  sending: false,
  error: "",
};
let activeRequestId = null;
const listeners = new Set();

function publish(next) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function errorMessage(reason) {
  const code = reason?.response?.data?.code;
  if (code === "OLLAMA_TIMEOUT") return "Nova took too long to respond. Check the laptop and tunnel, then tap your question to retry.";
  if (code === "OLLAMA_UNAVAILABLE" || code === "OLLAMA_REQUEST_FAILED" || reason?.response?.status === 503) {
    return "Nova cannot reach the local AI right now. Check Ollama and the tunnel, then tap your question to retry.";
  }
  if (reason?.response?.status === 429) return "Nova is receiving too many questions. Wait a moment, then try again.";
  return "Nova could not answer that question. Tap it to retry.";
}

function historyFrom(messages) {
  return messages
    .filter((message) => !message.systemOnly && !message.failed)
    .map((message) => ({
      role: message.direction === "Outbound" ? "user" : "assistant",
      content: message.bodyText,
    }));
}

async function requestNova({ messages, questionId, currentPath }) {
  const requestId = crypto.randomUUID();
  activeRequestId = requestId;
  publish({ messages, sending: true, error: "" });

  try {
    const response = await api.post(
      "/ai/chat",
      { messages: historyFrom(messages), currentPath },
      { timeout: 60_000 },
    );
    if (activeRequestId !== requestId) return false;
    publish({
      messages: [
        ...messages.map((message) => (message.id === questionId ? { ...message, failed: false } : message)),
        {
          id: `nova-${crypto.randomUUID()}`,
          direction: "Inbound",
          bodyText: response.data.message,
          occurredAt: new Date().toISOString(),
        },
      ],
      sending: false,
      error: "",
    });
    activeRequestId = null;
    return true;
  } catch (reason) {
    if (activeRequestId !== requestId) return false;
    publish({
      messages: messages.map((message) => (message.id === questionId ? { ...message, failed: true } : message)),
      sending: false,
      error: errorMessage(reason),
    });
    activeRequestId = null;
    return false;
  }
}

export function useNovaChat() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export async function sendNovaMessage(bodyText, currentPath) {
  const content = String(bodyText || "").trim();
  if (!content || snapshot.sending) return false;
  const command = NOVA_COMMAND_ALIASES[content.toLowerCase()];
  if (command) {
    const occurredAt = new Date().toISOString();
    setNovaCatVisible(command.visible);
    publish({
      messages: [
        ...snapshot.messages,
        {
          id: `nova-command-${crypto.randomUUID()}`,
          direction: "Outbound",
          bodyText: content,
          occurredAt,
          systemOnly: true,
        },
        {
          id: `nova-command-reply-${crypto.randomUUID()}`,
          direction: "Inbound",
          bodyText: command.reply,
          occurredAt,
          systemOnly: true,
        },
      ],
      sending: false,
      error: "",
    });
    return true;
  }
  const question = {
    id: `nova-question-${crypto.randomUUID()}`,
    direction: "Outbound",
    bodyText: content,
    occurredAt: new Date().toISOString(),
  };
  const messages = [...snapshot.messages, question];
  return requestNova({ messages, questionId: question.id, currentPath });
}

export async function retryNovaMessage(messageId, currentPath) {
  if (snapshot.sending) return false;
  const questionIndex = snapshot.messages.findIndex((message) => message.id === messageId && message.failed);
  if (questionIndex < 0) return false;
  const messages = snapshot.messages
    .slice(0, questionIndex + 1)
    .map((message) => (message.id === messageId ? { ...message, failed: false } : message));
  return requestNova({ messages, questionId: messageId, currentPath });
}

export function resetNovaChat() {
  activeRequestId = null;
  publish({ messages: [welcomeMessage()], sending: false, error: "" });
}
