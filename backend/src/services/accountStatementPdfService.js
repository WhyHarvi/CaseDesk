import PDFDocument from "pdfkit";

const PAGE = { left: 42, right: 570, bottom: 742 };

function currencyFormatter(statement) {
  return new Intl.NumberFormat(statement.agency.locale || "en-CA", { style: "currency", currency: statement.currency });
}

function dateFormatter(statement) {
  return new Intl.DateTimeFormat(statement.agency.locale || "en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: statement.agency.timezone || "America/Toronto" });
}

function optionalLines(values) {
  return values.filter(Boolean).join("\n");
}

function drawRule(doc, y, colour = "#dce3ea") {
  doc.strokeColor(colour).lineWidth(0.7).moveTo(PAGE.left, y).lineTo(PAGE.right, y).stroke();
}

function addTableHeader(doc, y) {
  doc.fillColor("#f1f5f9").rect(PAGE.left, y, PAGE.right - PAGE.left, 24).fill();
  doc.fillColor("#475569").font("Helvetica-Bold").fontSize(7.2);
  const headers = [
    ["DATE", 46, 50], ["REFERENCE", 98, 56], ["TYPE / DESCRIPTION", 156, 132],
    ["FILE", 292, 70], ["CHARGE", 366, 48], ["PAYMENT", 416, 48], ["REFUND", 466, 48], ["BALANCE", 518, 48],
  ];
  headers.forEach(([label, x, width]) => doc.text(label, x, y + 8, { width, align: x >= 366 ? "right" : "left" }));
  return y + 30;
}

function addPageHeader(doc, statement) {
  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(10).text(statement.agency.legalName || statement.agency.name, PAGE.left, 34);
  doc.fillColor("#64748b").font("Helvetica").fontSize(8).text(`Statement of Account · ${statement.statementNumber}`, 300, 35, { width: 270, align: "right" });
  drawRule(doc, 54);
  return addTableHeader(doc, 66);
}

export function generateAccountStatementPdf(statement) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margins: { top: 40, bottom: 42, left: PAGE.left, right: 42 }, bufferPages: true, info: { Title: `Statement of Account ${statement.statementNumber}`, Author: statement.agency.legalName || statement.agency.name, Subject: "Statement of Account" } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const money = currencyFormatter(statement);
    const dates = dateFormatter(statement);
    const agencyName = statement.agency.legalName || statement.agency.name;
    const agencyDetails = optionalLines([statement.agency.address, statement.agency.phone, statement.agency.email, statement.agency.website]);
    const registrationDetails = optionalLines([
      statement.agency.consultantLicenseNumber ? `Consultant licence: ${statement.agency.consultantLicenseNumber}` : null,
      statement.agency.businessNumber ? `Business no.: ${statement.agency.businessNumber}` : null,
      statement.agency.taxNumber ? `Tax no.: ${statement.agency.taxNumber}` : null,
    ]);

    if (statement.agency.logoUrl?.startsWith("data:image/")) {
      try {
        const encoded = statement.agency.logoUrl.split(",")[1];
        if (encoded) doc.image(Buffer.from(encoded, "base64"), PAGE.left, 38, { fit: [64, 52] });
      } catch {
        // A malformed optional logo must not prevent statement generation.
      }
    }
    const agencyTextX = statement.agency.logoUrl?.startsWith("data:image/") ? 116 : PAGE.left;
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(15).text(agencyName, agencyTextX, 42, { width: 260 });
    if (agencyDetails) doc.fillColor("#64748b").font("Helvetica").fontSize(8.5).text(agencyDetails, agencyTextX, 64, { width: 270, lineGap: 2 });
    if (registrationDetails) doc.fillColor("#64748b").fontSize(8).text(registrationDetails, 365, 42, { width: 205, align: "right", lineGap: 2 });

    drawRule(doc, 124);
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(25).text("Statement of Account", PAGE.left, 145);
    doc.fillColor("#64748b").font("Helvetica").fontSize(9).text("A summary of transactions recorded on the client account.", PAGE.left, 177);

    const period = statement.period.from || statement.period.to
      ? `${statement.period.from ? dates.format(new Date(statement.period.from)) : "Beginning"} – ${statement.period.to ? dates.format(new Date(statement.period.to)) : "Present"}`
      : "All transactions";
    const details = [
      ["STATEMENT NUMBER", statement.statementNumber], ["GENERATED", dates.format(new Date(statement.generatedAt))],
      ["BILLING PERIOD", period], ["CURRENCY", statement.currency],
    ];
    details.forEach(([label, value], index) => {
      const x = 332 + (index % 2) * 120;
      const y = 145 + Math.floor(index / 2) * 38;
      doc.fillColor("#94a3b8").font("Helvetica-Bold").fontSize(6.8).text(label, x, y);
      doc.fillColor("#1e293b").font("Helvetica").fontSize(9).text(value, x, y + 12, { width: 112 });
    });

    doc.fillColor("#94a3b8").font("Helvetica-Bold").fontSize(7).text("BILL TO", PAGE.left, 225);
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(11).text(statement.client.fullName, PAGE.left, 240);
    const clientDetails = optionalLines([statement.client.address, statement.client.email, statement.client.phone, `Client ID: ${statement.client.id}`]);
    doc.fillColor("#64748b").font("Helvetica").fontSize(8.5).text(clientDetails, PAGE.left, 257, { width: 245, lineGap: 2 });
    doc.fillColor("#94a3b8").font("Helvetica-Bold").fontSize(7).text("BILLING SOURCE", 332, 225);
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(10).text(statement.case?.caseType || "All billing, including appointments", 332, 240, { width: 238 });
    if (statement.case?.stage) doc.fillColor("#64748b").font("Helvetica").fontSize(8.5).text(`Current stage: ${statement.case.stage}`, 332, 257);

    const summaryY = 316;
    const summaryItems = [
      ["Opening", statement.summary.openingBalance], ["Charges", statement.summary.totalCharges],
      ["Payments", -statement.summary.totalPayments], ["Credits", -statement.summary.totalCredits], ["Refunds", statement.summary.totalRefunds],
      ["Adjustments", statement.summary.totalAdjustments], ["Closing", statement.summary.closingBalance],
    ];
    summaryItems.forEach(([label, value], index) => {
      const width = (PAGE.right - PAGE.left) / summaryItems.length;
      const x = PAGE.left + index * width;
      const isClosing = index === summaryItems.length - 1;
      doc.fillColor(isClosing ? "#0f172a" : "#f8fafc").roundedRect(x, summaryY, width - 4, 54, 5).fill();
      doc.fillColor(isClosing ? "#cbd5e1" : "#64748b").font("Helvetica-Bold").fontSize(6.7).text(label.toUpperCase(), x + 9, summaryY + 10, { width: width - 22 });
      doc.fillColor(isClosing ? "#ffffff" : "#0f172a").font("Helvetica-Bold").fontSize(9).text(money.format(value), x + 7, summaryY + 29, { width: width - 18, align: "right" });
    });

    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(11).text("Transactions", PAGE.left, 395);
    let y = addTableHeader(doc, 416);
    if (!statement.transactions.length) {
      doc.fillColor("#64748b").font("Helvetica").fontSize(9).text("No transactions were recorded for the selected period.", PAGE.left, y + 12, { width: PAGE.right - PAGE.left, align: "center" });
      y += 48;
    } else {
      for (const transaction of statement.transactions) {
        const descriptionHeight = doc.heightOfString(transaction.description, { width: 150, fontSize: 7.6 });
        const rowHeight = Math.max(34, descriptionHeight + 15);
        if (y + rowHeight > PAGE.bottom) {
          doc.addPage();
          y = addPageHeader(doc, statement);
        }
        doc.fillColor("#334155").font("Helvetica").fontSize(7.6);
        doc.text(dates.format(new Date(transaction.date)), 46, y + 6, { width: 50 });
        doc.text(transaction.reference, 98, y + 6, { width: 56 });
        doc.font("Helvetica-Bold").text(transaction.type, 156, y + 5, { width: 132 });
        doc.font("Helvetica").fillColor("#64748b").text(transaction.description, 156, y + 16, { width: 128 });
        doc.fillColor("#334155").text(transaction.caseReference || "", 292, y + 6, { width: 70 });
        doc.text(transaction.charge ? money.format(transaction.charge) : "", 366, y + 6, { width: 48, align: "right" });
        doc.text(transaction.paymentOrCredit ? money.format(transaction.paymentOrCredit) : "", 416, y + 6, { width: 48, align: "right" });
        doc.text(transaction.refund ? money.format(transaction.refund) : "", 466, y + 6, { width: 48, align: "right" });
        doc.font("Helvetica-Bold").text(money.format(transaction.runningBalance), 518, y + 6, { width: 48, align: "right" });
        drawRule(doc, y + rowHeight - 2, "#edf1f5");
        y += rowHeight;
      }
    }

    if (y + 145 > PAGE.bottom) { doc.addPage(); y = 82; }
    const balanceLabel = statement.summary.closingBalance < 0 ? "Credit Balance" : "Account Balance";
    doc.fillColor("#f1f5f9").roundedRect(330, y + 14, 240, 54, 6).fill();
    doc.fillColor("#64748b").font("Helvetica-Bold").fontSize(7).text(balanceLabel.toUpperCase(), 346, y + 27);
    doc.fillColor("#0f172a").fontSize(15).text(money.format(Math.abs(statement.summary.closingBalance)), 438, y + 24, { width: 116, align: "right" });
    if (statement.summary.closingBalance === 0) doc.fillColor("#64748b").font("Helvetica").fontSize(8.5).text("This account currently has no outstanding balance.", PAGE.left, y + 27, { width: 250 });
    if (statement.summary.closingBalance > 0 && statement.agency.paymentInstructions) {
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(8).text("Payment instructions", PAGE.left, y + 82);
      doc.fillColor("#64748b").font("Helvetica").fontSize(8.5).text(statement.agency.paymentInstructions, PAGE.left, y + 96, { width: 528, lineGap: 2 });
    }
    const footerY = Math.min(y + (statement.agency.paymentInstructions ? 140 : 92), 704);
    doc.fillColor("#64748b").font("Helvetica").fontSize(7.8).text("This statement summarizes the transactions recorded on your account for the period shown above. Please contact our office if you have questions or believe any information is incorrect.", PAGE.left, footerY, { width: 528, align: "center", lineGap: 2 });

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      doc.fillColor("#94a3b8").font("Helvetica").fontSize(7).text(`${statement.statementNumber}  ·  Page ${index + 1} of ${range.count}`, PAGE.left, 756, { width: PAGE.right - PAGE.left, align: "center", lineBreak: false });
    }
    doc.end();
  });
}
