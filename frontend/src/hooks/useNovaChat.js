import { useSyncExternalStore } from "react";
import api from "../services/api";

function welcomeMessage() {
  return {
    id: "nova-welcome",
    direction: "Inbound",
    bodyText: "Hi, I’m Nova — your CaseDesk guide. Tell me what you’re trying to do and I’ll point you to the right place.",
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
