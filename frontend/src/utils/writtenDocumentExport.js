import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const headingMap = { H1: HeadingLevel.HEADING_1, H2: HeadingLevel.HEADING_2, H3: HeadingLevel.HEADING_3 };
const alignmentMap = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };

function inlineChildren(node, marks = {}) {
  const nextMarks = {
    ...marks,
    bold: marks.bold || node.nodeName === "STRONG" || node.nodeName === "B",
    italics: marks.italics || node.nodeName === "EM" || node.nodeName === "I",
    underline: marks.underline || node.nodeName === "U",
  };
  if (node.nodeType === Node.TEXT_NODE) return [new TextRun({ text: node.textContent || "", ...marks })];
  if (node.nodeName === "BR") return [new TextRun({ break: 1 })];
  if (node.nodeName === "A") {
    const children = [...node.childNodes].flatMap((child) => inlineChildren(child, { ...nextMarks, color: "2563EB", underline: {} }));
    return [new ExternalHyperlink({ link: node.getAttribute("href") || "", children })];
  }
  return [...node.childNodes].flatMap((child) => inlineChildren(child, nextMarks));
}

function paragraphFrom(node, options = {}) {
  const style = node.getAttribute?.("style") || "";
  const textAlign = style.match(/text-align:\s*(left|center|right|justify)/i)?.[1]?.toLowerCase();
  return new Paragraph({
    children: inlineChildren(node),
    heading: headingMap[node.nodeName],
    alignment: alignmentMap[textAlign],
    spacing: { after: options.compact ? 80 : 160, line: 276 },
    indent: options.indent ? { left: options.indent } : undefined,
    bullet: options.bullet ? { level: options.level || 0 } : undefined,
    numbering: options.numbering ? { reference: "case-document-numbering", level: options.level || 0 } : undefined,
    border: node.nodeName === "BLOCKQUOTE" ? { left: { color: "CBD5E1", size: 16, style: BorderStyle.SINGLE, space: 12 } } : undefined,
  });
}

function tableFrom(node) {
  const rows = [...node.querySelectorAll(":scope > tbody > tr, :scope > thead > tr, :scope > tr")].map((row) => new TableRow({
    children: [...row.children].map((cell) => new TableCell({
      children: [paragraphFrom(cell, { compact: true })],
      shading: cell.nodeName === "TH" ? { fill: "F1F5F9" } : undefined,
    })),
  }));
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

function documentChildren(html) {
  const parsed = new DOMParser().parseFromString(`<body>${html || ""}</body>`, "text/html");
  const children = [];
  for (const node of [...parsed.body.children]) {
    if (["P", "H1", "H2", "H3", "BLOCKQUOTE"].includes(node.nodeName)) children.push(paragraphFrom(node));
    else if (node.nodeName === "TABLE") children.push(tableFrom(node));
    else if (node.nodeName === "UL" || node.nodeName === "OL") {
      [...node.children].forEach((item) => children.push(paragraphFrom(item, { bullet: node.nodeName === "UL", numbering: node.nodeName === "OL" })));
    } else children.push(paragraphFrom(node));
  }
  return children.length ? children : [new Paragraph("")];
}

export async function createDocxFile({ title, html, headerText, footerText, showPageNumbers }) {
  const footerChildren = [];
  if (footerText) footerChildren.push(new TextRun(footerText));
  if (showPageNumbers) {
    if (footerChildren.length) footerChildren.push(new TextRun("  ·  "));
    footerChildren.push(new TextRun("Page "), new TextRun({ children: [PageNumber.CURRENT] }));
  }
  const documentFile = new Document({
    numbering: { config: [{ reference: "case-document-numbering", levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
    sections: [{
      properties: { page: { margin: { top: 1152, right: 1152, bottom: 1152, left: 1152 } } },
      headers: headerText ? { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: headerText, size: 18, color: "64748B" })], alignment: AlignmentType.CENTER })] }) } : undefined,
      footers: footerChildren.length ? { default: new Footer({ children: [new Paragraph({ children: footerChildren, alignment: AlignmentType.CENTER })] }) } : undefined,
      children: documentChildren(html),
    }],
  });
  const blob = await Packer.toBlob(documentFile);
  const safeName = String(title || "document").replace(/[^a-z0-9 _-]/gi, "").trim() || "document";
  return new File([blob], `${safeName}.docx`, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
