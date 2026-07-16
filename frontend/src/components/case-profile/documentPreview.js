function extensionOf(documentItem) {
  const name = documentItem.originalFilename || documentItem.documentName || "";
  return name.includes(".") ? name.split(".").pop().toLowerCase() : "";
}

function parseCsv(text, rowLimit = 500, columnLimit = 80) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length && rows.length < rowLimit; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      if (row.length < columnLimit) row.push(value);
      value = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      if (row.length < columnLimit) row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if ((value || row.length) && rows.length < rowLimit) {
    if (row.length < columnLimit) row.push(value);
    rows.push(row);
  }
  return rows;
}

function columnIndex(reference) {
  const letters = String(reference || "").match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  return [...letters].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function xmlDocument(xml) {
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  if (parsed.querySelector("parsererror")) throw new Error("The Office document contains invalid XML.");
  return parsed;
}

async function renderXlsx(arrayBuffer) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(arrayBuffer);
  const workbookFile = zip.file("xl/workbook.xml");
  const relationshipsFile = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookFile || !relationshipsFile) throw new Error("This XLSX workbook is incomplete.");

  const workbook = xmlDocument(await workbookFile.async("text"));
  const relationships = xmlDocument(await relationshipsFile.async("text"));
  const relationshipTargets = new Map(
    [...relationships.querySelectorAll("Relationship")].map((relationship) => [relationship.getAttribute("Id"), relationship.getAttribute("Target")]),
  );
  const sharedStringsFile = zip.file("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsFile
    ? [...xmlDocument(await sharedStringsFile.async("text")).querySelectorAll("si")].map((item) => [...item.querySelectorAll("t")].map((text) => text.textContent || "").join(""))
    : [];
  const sheets = [];

  for (const sheet of [...workbook.querySelectorAll("sheet")].slice(0, 20)) {
    const relationshipId = sheet.getAttribute("r:id");
    const target = relationshipTargets.get(relationshipId);
    const sheetPath = target?.startsWith("/") ? target.slice(1) : `xl/${String(target || "").replace(/^\.\//, "")}`;
    const sheetFile = zip.file(sheetPath);
    if (!sheetFile) continue;
    const sheetXml = xmlDocument(await sheetFile.async("text"));
    const rows = [];

    for (const rowNode of [...sheetXml.querySelectorAll("sheetData > row")].slice(0, 500)) {
      const values = [];
      for (const cell of [...rowNode.querySelectorAll(":scope > c")].slice(0, 80)) {
        const index = Math.min(columnIndex(cell.getAttribute("r")), 79);
        while (values.length < index) values.push("");
        const type = cell.getAttribute("t");
        const raw = cell.querySelector("v")?.textContent || "";
        const inlineText = [...cell.querySelectorAll("is t")].map((item) => item.textContent || "").join("");
        const value = type === "s" ? sharedStrings[Number(raw)] || "" : type === "inlineStr" ? inlineText : type === "b" ? (raw === "1" ? "TRUE" : "FALSE") : raw;
        values[index] = value;
      }
      rows.push(values);
    }
    sheets.push({ name: sheet.getAttribute("name") || `Sheet ${sheets.length + 1}`, rows });
  }

  return { kind: "spreadsheet", sheets, warning: sheets.length ? "Cell values are shown without full Excel formatting or formula recalculation." : "No worksheet data was found." };
}

async function renderDocx(arrayBuffer) {
  const [mammothModule, domPurifyModule] = await Promise.all([import("mammoth"), import("dompurify")]);
  const mammoth = mammothModule.default || mammothModule;
  const DOMPurify = domPurifyModule.default;
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return {
    kind: "html",
    html: DOMPurify.sanitize(result.value, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
      FORBID_ATTR: ["srcset"],
    }),
    warning: result.messages.length ? "Some advanced Word formatting may not appear exactly as authored." : null,
  };
}

async function renderHeic(blob) {
  const module = await import("heic2any");
  const convert = module.default || module;
  const converted = await convert({ blob, toType: "image/jpeg", quality: 0.9 });
  const image = Array.isArray(converted) ? converted[0] : converted;
  return { kind: "image", url: URL.createObjectURL(image), generatedUrl: true };
}

export async function buildDocumentPreview(blob, documentItem) {
  const extension = extensionOf(documentItem);
  const mimeType = documentItem.mimeType || blob.type;

  if (mimeType === "application/pdf" || extension === "pdf") {
    return { kind: "frame", url: URL.createObjectURL(blob), generatedUrl: true };
  }
  if (["heic", "heif"].includes(extension) || ["image/heic", "image/heif"].includes(mimeType)) {
    return renderHeic(blob);
  }
  if (mimeType?.startsWith("image/")) {
    return { kind: "image", url: URL.createObjectURL(blob), generatedUrl: true };
  }
  if (extension === "docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return renderDocx(await blob.arrayBuffer());
  }
  if (extension === "xlsx" || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return renderXlsx(await blob.arrayBuffer());
  }
  if (extension === "csv" || mimeType === "text/csv") {
    return { kind: "spreadsheet", sheets: [{ name: "CSV", rows: parseCsv(await blob.text()) }] };
  }
  if (mimeType === "text/plain" || extension === "txt") {
    return { kind: "text", text: (await blob.text()).slice(0, 1_000_000) };
  }
  return { kind: "unsupported" };
}

export function releaseDocumentPreview(preview) {
  if (preview?.generatedUrl && preview.url) URL.revokeObjectURL(preview.url);
}
