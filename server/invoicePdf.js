import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * Tax invoice PDF for email attachment — cut-to-cut match of the
 * Precision Forge Labs (Maroon International) tax invoice layout.
 */
export async function buildOrderInvoiceBase64(order) {
  const fontModule = await import("../src/invoiceFontData.js");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.addFileToVFS("NotoSans-Regular.ttf", fontModule.NOTO_SANS_REGULAR_BASE64);
  doc.addFileToVFS("NotoSans-Bold.ttf", fontModule.NOTO_SANS_BOLD_BASE64);
  doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");

  const TEAL = [24, 54, 48];
  const CREAM = [255, 242, 223];
  const CREAM_BAND = [245, 235, 214];
  const MUTED = [90, 95, 92];
  const LINE = [210, 200, 185];
  const WHITE = [255, 255, 255];
  const ROW_ALT = [250, 248, 242];

  const subtotal = Number(order.subtotal) || 0;
  const discount = Number(order.discount) || 0;
  const shipCost = Number(order.shippingCost ?? order.shipping ?? 0) || 0;
  const codFee = Number(order.codFee) || 0;
  const cgst = Number(order.cgst) || 0;
  const sgst = Number(order.sgst) || 0;
  const igst = Number(order.igst) || 0;
  const grandTotal = Number(order.total) || 0;
  const totalTax = cgst + sgst + igst;
  const couponCode = order.couponCode || order.coupon_code || "";
  const invoiceDate = order.placedAt || order.createdAt
    ? new Date(order.placedAt || order.createdAt)
        .toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" })
        .replace(/\//g, "-")
    : "";
  const cancelled = order.status === "cancelled";
  const payRaw = String(order.paymentMethod || order.payment_method || "").toLowerCase();
  const isCod = payRaw.includes("cod");
  const paid =
    !cancelled &&
    (order.paymentStatus === "paid" ||
      order.payment_status === "paid" ||
      (isCod && ["dispatched", "delivered"].includes(order.status)));

  let taxableBase = Math.max(0, subtotal - discount);
  if (totalTax > 0) {
    taxableBase = Math.max(0, Number(((subtotal - discount) / 1.18).toFixed(2)));
  }

  const billName = order.name || order.shippingName || order.customerName || "Customer";
  const billLines = [
    billName,
    order.address || order.shippingAddress || order.addressLine1 || "",
    [order.city, order.state, order.pin || order.pincode].filter(Boolean).join(", "),
    order.phone || order.shippingPhone ? String(order.phone || order.shippingPhone) : "",
    order.email || "",
    order.gstin || order.gstNumber ? `GSTIN: ${order.gstin || order.gstNumber}` : "GSTIN: NA",
  ].filter(Boolean);
  const shipLines = billLines.slice();
  const placeOfSupply = [order.city, order.state].filter(Boolean).join(", ") || "—";
  // Supplier = Maharashtra (Thane). Outside MH → IGST; inside → CGST+SGST.
  const stateRaw = String(order.state || "").trim().toLowerCase().replace(/\s+/g, " ");
  const isMH = !stateRaw || stateRaw === "mh" || stateRaw === "mah" || stateRaw.includes("maharashtra");
  let displayIgst = Number(igst) || 0;
  let displayCgst = Number(cgst) || 0;
  let displaySgst = Number(sgst) || 0;
  const taxSum = displayCgst + displaySgst + displayIgst;
  if (!isMH && displayIgst <= 0 && taxSum > 0) {
    // Legacy orders stored only CGST/SGST — show correctly as IGST on invoice
    displayIgst = taxSum;
    displayCgst = 0;
    displaySgst = 0;
  }
  if (isMH && displayIgst > 0 && displayCgst <= 0 && displaySgst <= 0) {
    displayCgst = Math.round(displayIgst / 2);
    displaySgst = displayIgst - displayCgst;
    displayIgst = 0;
  }
  const gstType = displayIgst > 0 ? "Inter-State (IGST)" : "Intra-State (CGST + SGST)";

  doc.setFillColor(...CREAM);
  doc.rect(0, 0, 210, 297, "F");

  // Header
  doc.setFillColor(...TEAL);
  doc.rect(0, 0, 210, 22, "F");
  doc.setTextColor(...WHITE);
  doc.setFont("NotoSans", "bold");
  doc.setFontSize(18);
  doc.text("ĀKĀRA", 105, 12, { align: "center" });
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(8);
  doc.setTextColor(220, 230, 225);
  doc.text("TAX INVOICE", 105, 18.5, { align: "center" });

  // Company band
  doc.setFillColor(...CREAM_BAND);
  doc.rect(0, 22, 210, 20, "F");
  doc.setTextColor(...TEAL);
  doc.setFont("NotoSans", "bold");
  doc.setFontSize(9);
  doc.text("by PRECISION FORGE LABS", 105, 28, { align: "center" });
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text("Thane, Maharashtra - 400605  |  Ph: +91-8278085572  |  info@akaraonline.co.in", 105, 34, { align: "center" });
  doc.setFont("NotoSans", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...TEAL);
  doc.text("GSTIN: 27GZCPS9353H1ZQ  |  PAN: GZCPS9353H  |  State: Maharashtra (27)", 105, 39, { align: "center" });

  // Meta grid
  let y = 46;
  const metaLeft = [
    ["Invoice No:", order.orderNumber || "—"],
    ["Platform:", "akaraonline.co.in"],
    ["Place of Supply:", placeOfSupply],
  ];
  const metaRight = [
    ["Date:", invoiceDate || "—"],
    ["Order / Ref ID:", order.orderNumber || "—"],
    ["GST Type:", gstType],
  ];
  metaLeft.forEach((row, i) => {
    const yy = y + i * 6;
    if (i % 2 === 0) {
      doc.setFillColor(...ROW_ALT);
      doc.rect(10, yy, 95, 6, "F");
      doc.rect(105, yy, 95, 6, "F");
    }
    doc.setFont("NotoSans", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...TEAL);
    doc.text(row[0], 12, yy + 4);
    doc.setFont("NotoSans", "normal");
    doc.setTextColor(40, 45, 42);
    doc.text(String(row[1]).slice(0, 40), 38, yy + 4);
    const r = metaRight[i];
    doc.setFont("NotoSans", "bold");
    doc.setTextColor(...TEAL);
    doc.text(r[0], 107, yy + 4);
    doc.setFont("NotoSans", "normal");
    doc.setTextColor(40, 45, 42);
    doc.text(String(r[1]).slice(0, 40), 138, yy + 4);
  });
  y += 20;

  // BILL / SHIP
  doc.setFillColor(...TEAL);
  doc.rect(10, y, 95, 6, "F");
  doc.rect(105, y, 95, 6, "F");
  doc.setTextColor(...WHITE);
  doc.setFont("NotoSans", "bold");
  doc.setFontSize(8);
  doc.text("BILL TO", 12, y + 4);
  doc.text("SHIP TO", 107, y + 4);
  y += 6;
  const boxH = Math.max(28, Math.max(billLines.length, shipLines.length) * 4 + 6);
  doc.setDrawColor(...LINE);
  doc.setFillColor(252, 249, 243);
  doc.rect(10, y, 95, boxH, "FD");
  doc.rect(105, y, 95, boxH, "FD");
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(40, 45, 42);
  billLines.forEach((line, i) => doc.text(String(line).slice(0, 52), 12, y + 5 + i * 4));
  shipLines.forEach((line, i) => doc.text(String(line).slice(0, 52), 107, y + 5 + i * 4));
  y += boxH + 5;

  const body = (Array.isArray(order.items) ? order.items : []).map((it, idx) => {
    const qty = Number(it.qty) || 1;
    const lineGross = Number(it.price) * qty;
    const unitGross = Number(it.price) || 0;
    const unitTaxable = totalTax > 0 ? Number((unitGross / 1.18).toFixed(2)) : unitGross;
    const lineTaxable = totalTax > 0 ? Number((lineGross / 1.18).toFixed(2)) : lineGross;
    const desc = `${it.name || "Piece"}${
      [it.colorLabel || it.color, it.size].filter(Boolean).length
        ? " (" + [it.colorLabel || it.color, it.size].filter(Boolean).join(", ") + ")"
        : ""
    }${it.batchNumber ? " · " + it.batchNumber : ""}`;
    return [
      String(idx + 1),
      desc,
      String(it.hsn || "9405"),
      String(qty),
      "Pcs",
      unitTaxable.toFixed(2),
      lineTaxable.toFixed(2),
    ];
  });
  if (codFee > 0) {
    body.push(["", "COD Handling Fee", "9965", "1", "LS", Number(codFee).toFixed(2), Number(codFee).toFixed(2)]);
  }
  if (shipCost > 0) {
    body.push(["", "Shipping Charges", "9965", "1", "LS", Number(shipCost).toFixed(2), Number(shipCost).toFixed(2)]);
  }

  autoTable(doc, {
    startY: y,
    margin: { left: 10, right: 10 },
    head: [["Sr.", "Description", "HSN", "Qty", "Unit", "Taxable Rate (Rs.)", "Taxable Amt (Rs.)"]],
    body,
    theme: "grid",
    styles: {
      font: "NotoSans",
      fontSize: 7.5,
      cellPadding: 1.6,
      textColor: [40, 45, 42],
      lineColor: LINE,
      lineWidth: 0.15,
    },
    headStyles: { fillColor: TEAL, textColor: WHITE, fontStyle: "bold", fontSize: 7, halign: "center" },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 62 },
      2: { cellWidth: 18, halign: "center" },
      3: { cellWidth: 12, halign: "center" },
      4: { cellWidth: 14, halign: "center" },
      5: { cellWidth: 32, halign: "right" },
      6: { cellWidth: 32, halign: "right" },
    },
  });
  y = doc.lastAutoTable.finalY + 6;

  if (cancelled) {
    doc.setFont("NotoSans", "bold");
    doc.setFontSize(28);
    doc.setTextColor(168, 59, 50);
    doc.text("CANCELLED", 105, Math.min(y + 8, 160), { align: "center", angle: 18 });
  } else if (paid) {
    doc.setFont("NotoSans", "bold");
    doc.setFontSize(26);
    doc.setTextColor(47, 125, 74);
    doc.text("PAID", 148, Math.min(y - 2, 155), { align: "center", angle: 18 });
  }

  const taxBoxTop = y;
  doc.setFillColor(...TEAL);
  doc.rect(10, taxBoxTop, 72, 5.5, "F");
  doc.setTextColor(...WHITE);
  doc.setFont("NotoSans", "bold");
  doc.setFontSize(7.5);
  doc.text("TAX CALCULATION", 12, taxBoxTop + 3.8);
  doc.setDrawColor(...LINE);
  doc.setFillColor(252, 249, 243);
  doc.rect(10, taxBoxTop + 5.5, 72, 22, "FD");
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text(displayIgst > 0 ? "Inter-State · IGST @ 18%" : "Intra-State · CGST + SGST @ 9% each", 12, taxBoxTop + 10);
  doc.setFont("NotoSans", "bold");
  doc.setTextColor(...TEAL);
  doc.setFontSize(7);
  if (displayIgst > 0) {
    doc.text("Taxable", 12, taxBoxTop + 15);
    doc.text("IGST 18%", 36, taxBoxTop + 15);
    doc.text("Total Tax", 58, taxBoxTop + 15);
    doc.setFont("NotoSans", "normal");
    doc.setTextColor(40, 45, 42);
    doc.text(`Rs.${taxableBase.toFixed(2)}`, 12, taxBoxTop + 21);
    doc.text(`Rs.${Number(displayIgst).toFixed(2)}`, 36, taxBoxTop + 21);
    doc.text(`Rs.${(displayCgst+displaySgst+displayIgst).toFixed(2)}`, 58, taxBoxTop + 21);
  } else {
    doc.text("Taxable", 12, taxBoxTop + 15);
    doc.text("CGST 9%", 34, taxBoxTop + 15);
    doc.text("SGST 9%", 54, taxBoxTop + 15);
    doc.setFont("NotoSans", "normal");
    doc.setTextColor(40, 45, 42);
    doc.text(`Rs.${taxableBase.toFixed(2)}`, 12, taxBoxTop + 21);
    doc.text(`Rs.${Number(displayCgst).toFixed(2)}`, 34, taxBoxTop + 21);
    doc.text(`Rs.${Number(displaySgst).toFixed(2)}`, 54, taxBoxTop + 21);
  }

  const totX = 100;
  const rows = [];
  rows.push(["Subtotal (Before Tax):", `Rs.${taxableBase.toFixed(2)}`]);
  if (discount > 0) rows.push([`Discount${couponCode ? ` (${couponCode})` : ""}:`, `- Rs.${Number(discount).toFixed(2)}`]);
  if (displayCgst > 0) rows.push(["CGST @ 9%:", `Rs.${Number(displayCgst).toFixed(2)}`]);
  if (displaySgst > 0) rows.push(["SGST @ 9%:", `Rs.${Number(displaySgst).toFixed(2)}`]);
  if (displayIgst > 0) rows.push(["IGST @ 18%:", `Rs.${Number(displayIgst).toFixed(2)}`]);
  if (shipCost > 0) rows.push(["Shipping:", `Rs.${Number(shipCost).toFixed(2)}`]);
  if (codFee > 0) rows.push(["COD Fee:", `Rs.${Number(codFee).toFixed(2)}`]);
  rows.push(["Round Off:", "Rs.0.00"]);

  rows.forEach((r, i) => {
    const yy = taxBoxTop + i * 5.2;
    doc.setFont("NotoSans", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(r[0], totX, yy + 4);
    doc.setTextColor(40, 45, 42);
    doc.text(r[1], 200, yy + 4, { align: "right" });
  });
  const grandY = taxBoxTop + rows.length * 5.2 + 2;
  doc.setFillColor(...TEAL);
  doc.rect(totX, grandY, 100, 9, "F");
  doc.setTextColor(...WHITE);
  doc.setFont("NotoSans", "bold");
  doc.setFontSize(9);
  doc.text("GRAND TOTAL:", totX + 3, grandY + 6);
  doc.text(
    `Rs.${Number(grandTotal).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    198,
    grandY + 6,
    { align: "right" }
  );

  let footY = Math.max(grandY + 14, taxBoxTop + 36);
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(`Total tax: Rs.${totalTax.toFixed(2)}  ·  Inclusive of GST where applicable`, 10, footY);
  footY += 6;

  doc.setFillColor(...TEAL);
  doc.rect(10, footY, 95, 5.5, "F");
  doc.rect(105, footY, 95, 5.5, "F");
  doc.setTextColor(...WHITE);
  doc.setFont("NotoSans", "bold");
  doc.setFontSize(7.5);
  doc.text("PAYMENT DETAILS", 12, footY + 3.8);
  doc.text("TERMS & CONDITIONS", 107, footY + 3.8);
  footY += 5.5;
  const payH = 28;
  doc.setDrawColor(...LINE);
  doc.setFillColor(252, 249, 243);
  doc.rect(10, footY, 95, payH, "FD");
  doc.rect(105, footY, 95, payH, "FD");
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(7);
  doc.setTextColor(40, 45, 42);
  [
    "Account: Precision Forge Labs",
    "Bank: State Bank of India",
    "Acc No: 44786137148",
    "IFSC: SBIN0002865",
    "UPI: precisionforgelabs@axl",
    isCod ? "Method: Cash on Delivery" : "Method: Online (Razorpay)",
  ].forEach((l, i) => doc.text(l, 12, footY + 4.2 + i * 3.8));
  [
    "1. Payment due as per order confirmation.",
    "2. Products handcrafted — minor variations possible.",
    "3. Returns only for shipping damage (see policy).",
    "4. Taxable values as per this tax invoice.",
    paid ? "5. Payment received." : isCod ? "5. Collect on delivery." : "5. Awaiting payment confirmation.",
  ].forEach((l, i) => doc.text(l, 107, footY + 4.2 + i * 3.8));
  footY += payH + 5;

  doc.setFillColor(...CREAM_BAND);
  doc.rect(10, footY, 190, 20, "F");
  doc.setFont("NotoSans", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...TEAL);
  doc.text("DECLARATION", 12, footY + 5);
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text(
    "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
    12,
    footY + 10
  );
  doc.text("Studio piece · Printed to order in Mumbai · Not white-labelled stock.", 12, footY + 14.5);
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...TEAL);
  doc.text("For PRECISION FORGE LABS (ĀKĀRA)", 198, footY + 6, { align: "right" });
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(0.3);
  doc.line(155, footY + 14, 198, footY + 14);
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text("Authorised Signatory", 198, footY + 17.5, { align: "right" });
  doc.text("This is a digitally generated invoice and does not require a physical signature.", 12, footY + 18.5);

  doc.setFont("NotoSans", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...TEAL);
  doc.text("Thank you for your business!", 105, 288, { align: "center" });
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text("www.akaraonline.co.in  |  support@akaraonline.co.in  |  +91-8278085572", 105, 292, { align: "center" });

  return Buffer.from(doc.output("arraybuffer")).toString("base64");
}
