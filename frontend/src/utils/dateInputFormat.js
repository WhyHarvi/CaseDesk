// Masks free-typed digits into YYYY-MM-DD as the user types, auto-inserting
// the dashes and capping length so a nonsense value (a 5+ digit year, a
// 3-digit day, etc.) can never actually be typed into the field. Pair with a
// text input (not type="date" — native date inputs don't route through
// onChange with raw partial text the same way) and a calendar-validity check
// on blur/submit, since this only prevents malformed length/shape, not an
// impossible date like 2026-02-30.
export function formatDateInput(value, inputType = "") {
  const raw = String(value || "");
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (inputType.startsWith("delete") && (raw.length === 4 || raw.length === 7)) return raw;
  if (digits.length < 4) return digits;
  if (digits.length === 4) return `${digits}-`;
  if (digits.length < 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  if (digits.length === 6) return `${digits.slice(0, 4)}-${digits.slice(4)}-`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

// Real-calendar-date check (catches e.g. 2026-02-30, which Date silently
// rolls over to March 2 instead of rejecting). Returns an error string, or
// "" when value is blank or a real date.
export function calendarDateError(value, label = "date") {
  const input = String(value || "").trim();
  if (!input) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return `Use YYYY-MM-DD, for example 2026-06-15.`;
  const [year, month, day] = input.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return `Enter a real calendar ${label}.`;
  }
  return "";
}
