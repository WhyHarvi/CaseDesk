const sensitive = /authorization|cookie|password|secret|token|api.?key|access.?key|rawPayload|bodyHtml/i;

export function redact(value, depth = 0) {
  if (depth > 5) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitive.test(key) ? "[REDACTED]" : redact(item, depth + 1)]));
  if (typeof value === "string" && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

export function log(level, event, metadata = {}) {
  const record = { timestamp: new Date().toISOString(), level, event, ...redact(metadata) };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event, metadata) => log("info", event, metadata),
  warn: (event, metadata) => log("warn", event, metadata),
  error: (event, metadata) => log("error", event, metadata),
};

