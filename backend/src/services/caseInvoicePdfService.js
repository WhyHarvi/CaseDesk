import PDFDocument from "pdfkit";

function textLines(values) {
  return values.filter(Boolean).join("\n");
}

function money(invoice, value) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: invoice.currency || "CAD" }).format(Number(value || 0));
}

function date(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function rule(doc, y) {
  doc.strokeColor("#dbe4ee").lineWidth(0.7).moveTo(42, y).lineTo(570, y).stroke();
}

export function generateCaseInvoicePdf(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margins: { top: 42, left: 42, right: 42, bottom: 48 }, info: { Title: `Invoice ${invoice.invoiceNumber}`, Subject: "Invoice" } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const agency = invoice.agencySnapshot || {};
    const client = invoice.clientSnapshot || {};
    const logo = agency.logoUrl;
    if (typeof logo === "string" && logo.startsWith("data:image/")) {
      try {
        const encoded = logo.split(",")[1];
        if (encoded) doc.image(Buffer.from(encoded, "base64"), 42, 42, { fit: [64, 52] });
      } catch {
        // Optional branding must never prevent access to the legal invoice.
      }
    }
    const agencyX = typeof logo === "string" && logo.startsWith("data:image/") ? 118 : 42;
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(16).text(agency.name || agency.tradingName || "CaseDesk agency", agencyX, 44, { width: 275 });
    doc.fillColor("#64748b").font("Helvetica").fontSize(8.5).text(textLines([
      agency.address,
      [agency.city, agency.province, agency.postalCode].filter(Boolean).join(", "),
      agency.phone,
      agency.email,
      agency.taxNumber ? `Tax no.: ${agency.taxNumber}` : null,
    ]), agencyX, 68, { width: 285, lineGap: 2 });

    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(28).text("INVOICE", 378, 44, { width: 192, align: "right" });
    doc.fillColor("#475569").font("Helvetica").fontSize(9).text(invoice.invoiceNumber, 378, 78, { width: 192, align: "right" });
    doc.text(`${invoice.accountingProvider === "CaseDeskCash" ? "CaseDesk Cash" : "QuickBooks"} ledger`, 378, 94, { width: 192, align: "right" });
    rule(doc, 132);

    doc.fillColor("#94a3b8").font("Helvetica-Bold").fontSize(7).text("BILL TO", 42, 154);
    doc.fillColor("#0f172a").fontSize(11).text(client.fullName || "Client", 42, 170);
    doc.fillColor("#64748b").font("Helvetica").fontSize(8.5).text(textLines([client.clientNumber, client.address, client.email, client.phone]), 42, 189, { width: 255, lineGap: 2 });

    const details = [["ISSUED", date(invoice.issuedAt || invoice.createdAt)], ["DUE", date(invoice.dueDate)], ["CURRENCY", invoice.currency || "CAD"], ["STATUS", invoice.status || "Open"]];
    details.forEach(([label, value], index) => {
      const x = 338 + (index % 2) * 116;
      const y = 154 + Math.floor(index / 2) * 42;
      doc.fillColor("#94a3b8").font("Helvetica-Bold").fontSize(7).text(label, x, y);
      doc.fillColor("#0f172a").font("Helvetica").fontSize(9).text(value, x, y + 13, { width: 108 });
    });

    let y = 262;
    doc.fillColor("#f1f5f9").rect(42, y, 528, 28).fill();
    doc.fillColor("#475569").font("Helvetica-Bold").fontSize(7);
    doc.text("DESCRIPTION", 54, y + 10, { width: 270 });
    doc.text("QTY", 342, y + 10, { width: 40, align: "right" });
    doc.text("RATE", 394, y + 10, { width: 72, align: "right" });
    doc.text("TOTAL", 478, y + 10, { width: 80, align: "right" });
    y += 36;

    const lines = invoice.lines?.length ? invoice.lines : [{ description: invoice.description, quantity: 1, unitAmount: invoice.subtotalAmount || invoice.amount, lineTotal: invoice.amount }];
    for (const line of lines) {
      const rowHeight = Math.max(42, doc.heightOfString(line.description, { width: 270 }) + 22);
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(9).text(line.description, 54, y + 4, { width: 270 });
      const detailsText = [line.feeCategory, line.taxable ? `${Number(line.taxRate || 0)}% tax` : "Non-taxable", Number(line.discount || 0) > 0 ? `${money(invoice, line.discount)} discount` : null].filter(Boolean).join(" · ");
      doc.fillColor("#64748b").font("Helvetica").fontSize(7.5).text(detailsText, 54, y + 19, { width: 270 });
      doc.fillColor("#334155").fontSize(8.5).text(Number(line.quantity || 1).toFixed(0), 342, y + 7, { width: 40, align: "right" });
      doc.text(money(invoice, line.unitAmount), 394, y + 7, { width: 72, align: "right" });
      doc.font("Helvetica-Bold").text(money(invoice, line.lineTotal), 478, y + 7, { width: 80, align: "right" });
      rule(doc, y + rowHeight - 4);
      y += rowHeight;
    }

    y += 14;
    const totals = [
      ["Subtotal", invoice.subtotalAmount],
      ...(Number(invoice.discountAmount || 0) > 0 ? [["Discount", -Number(invoice.discountAmount)]] : []),
      [`Tax (${Number(invoice.taxRatePercent || 0)}%)`, invoice.taxAmount],
      ["Invoice total", invoice.amount],
      ["Balance due", invoice.balance],
    ];
    totals.forEach(([label, value], index) => {
      const final = index === totals.length - 1;
      if (final) doc.fillColor("#0f172a").roundedRect(352, y - 6, 218, 34, 6).fill();
      doc.fillColor(final ? "#ffffff" : "#64748b").font(final ? "Helvetica-Bold" : "Helvetica").fontSize(final ? 10 : 9).text(label, 366, y + 3, { width: 100 });
      doc.text(money(invoice, value), 470, y + 3, { width: 86, align: "right" });
      y += final ? 42 : 25;
    });

    doc.fillColor("#64748b").font("Helvetica").fontSize(8).text("Thank you. Please retain this invoice for your records.", 42, Math.min(y + 18, 710), { width: 528, align: "center" });
    doc.end();
  });
}
