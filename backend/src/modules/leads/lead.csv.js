import { createHttpError } from "../../utils/http.js";

export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (quoted) throw createHttpError(400, "CSV contains an unclosed quoted value.", "INVALID_CSV");
  if (field || row.length) { row.push(field); rows.push(row); }
  const populated = rows.filter((values) => values.some((value) => value.trim()));
  if (populated.length < 2) throw createHttpError(400, "CSV must include a header and at least one data row.", "INVALID_CSV");
  const headers = populated[0].map((value) => value.trim());
  if (new Set(headers.map((item) => item.toLowerCase())).size !== headers.length) throw createHttpError(400, "CSV headers must be unique.", "INVALID_CSV");
  return { headers, rows: populated.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ""]))) };
}
