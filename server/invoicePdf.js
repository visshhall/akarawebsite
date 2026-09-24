import { jsPDF } from "jspdf";

/**
 * Tax invoice PDF for email attachment — layout matches on-screen InvoiceView
 * (company left, TAX INVOICE right, line table, CGST/SGST, footer note).
 */
export async function buildOrderInvoiceBase64(order) {
  const fontModule = await import("../src/invoiceFontData.js");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.addFileToVFS("NotoSans-Regular.ttf", fontModule.NOTO_SANS_REGULAR_BASE64);
  doc.addFileToVFS("NotoSans-Bold.ttf", fontModule.NOTO_SANS_BOLD_BASE64);
  doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");

  const TEAL = [24, 54, 48];
  const MUTED = [100, 110, 105];
  const LINE = [220, 210, 195];
  const CREAM = [245, 240, 232];
  const WHITE = [255, 255, 255];

  const subtotal = Number(order.subtotal) || 0;
  const discount = Number(order.discount) || 0;
  const shipping = Number(order.shippingCost ?? order.shipping ?? 0) || 0;
  const codFee = Number(order.codFee) || 0;
  const cgst = Number(order.cgst) || 0;
  const sgst = Number(order.sgst) || 0;
  const grandTotal = Number(order.total) || 0;
  const couponCode = order.couponCode || order.coupon_code || "";
  const invoiceDate = order.placedAt || order.createdAt
    ? new Date(order.placedAt || order.createdAt).toLocaleDateString("en-IN", {
        day: "numeric", month: "short", year: "numeric",
      })
    : "";
  const pay = String(order.paymentMethod || order.payment_method || "").toLowerCase();
  const isCod = pay.includes("cod");

  // Page cream
  doc.setFillColor(...CREAM);
  doc.rect(0, 0, 210, 297, "F");
  // White card
  doc.setFillColor(...WHITE);
  doc.roundedRect(12, 14, 186, 270, 2, 2, "F");

  // Top brand centered
  doc.setFont("NotoSans", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...TEAL);
  doc.text("AKARA", 105, 26, { align: "center" });

  // Company left / meta right
  let y = 38;
  doc.setFont("NotoSans", "bold");
  doc.setFontSize(11);
  doc.text("AKARA", 22, y);
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  y += 5;
  doc.text("Precision Forge Labs", 22, y); y += 4;
  doc.text("Thane, Maharashtra 400601", 22, y); y += 4;
  doc.text("GSTIN: 27GZCPS9353H1ZQ", 22, y); y += 4;
  doc.text("support@akaraonline.co.in · +91 82780 85572", 22, y);

  doc.setTextColor(...TEAL);
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(9);
  doc.text("TAX INVOICE", 188, 40, { align: "right" });
  doc.setFontSize(8.5);
  doc.text(`Invoice #: ${order.orderNumber || "—"}`, 188, 46, { align: "right" });
  doc.text(`Date: ${invoiceDate || "—"}`, 188, 52, { align: "right" });

  y = 62;
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(0.35);
  doc.line(22, y, 188, y);
  y += 10;

  // Bill to
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text("BILLED & SHIPPED TO", 22, y);
  y += 6;
  doc.setFont("NotoSans", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...TEAL);
  const billName = order.name || order.shippingName || order.customerName || "Customer";
  doc.text(String(billName).slice(0, 60), 22, y);
  y += 5;
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  const addrParts = [
    order.address || order.shippingAddress || order.addressLine1,
    order.landmark ? `near ${order.landmark}` : null,
    [order.city, order.state].filter(Boolean).join(", "),
    order.pin || order.pincode,
  ].filter(Boolean);
  const addrLine = addrParts.join(", ");
  for (const line of doc.splitTextToSize(addrLine, 160)) {
    doc.text(line, 22, y);
    y += 4.5;
  }
  if (order.phone || order.shippingPhone) {
    doc.text(String(order.phone || order.shippingPhone), 22, y);
    y += 4.5;
  }
  if (order.email) {
    doc.text(String(order.email), 22, y);
    y += 4.5;
  }
  y += 6;

  // Table header
  const col = { item: 24, hsn: 118, qty: 138, rate: 155, amt: 186 };
  doc.setFillColor(...TEAL);
  doc.rect(22, y - 4, 166, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("NotoSans", "bold");
  doc.setFontSize(7.5);
  doc.text("Item", col.item, y);
  doc.text("HSN", col.hsn, y);
  doc.text("Qty", col.qty, y);
  doc.text("Rate", col.rate, y);
  doc.text("Amount", col.amt, y, { align: "right" });
  y += 8;

  doc.setFont("NotoSans", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...TEAL);
  const items = Array.isArray(order.items) ? order.items : [];
  for (const it of items.slice(0, 18)) {
    const variant = [it.colorLabel || it.color, it.size].filter(Boolean).join(", ");
    const name = `${it.name || "Piece"}${variant ? ` (${variant})` : ""}`;
    const hsn = it.hsn || "9405";
    const qty = Number(it.qty) || 1;
    const rate = Number(it.price) || 0;
    const amount = rate * qty;
    const nameLines = doc.splitTextToSize(name, 88);
    doc.text(nameLines[0], col.item, y);
    doc.text(String(hsn), col.hsn, y);
    doc.text(String(qty), col.qty, y);
    doc.text(`Rs.${rate.toLocaleString("en-IN")}`, col.rate, y);
    doc.text(`Rs.${amount.toLocaleString("en-IN")}`, col.amt, y, { align: "right" });
    y += 5;
    if (nameLines[1]) {
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(nameLines[1], col.item, y);
      doc.setFontSize(8.5);
      doc.setTextColor(...TEAL);
      y += 4.5;
    }
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.15);
    doc.line(22, y - 2, 188, y - 2);
  }

  y += 6;
  const fmt = (n) => `Rs.${Number(n).toLocaleString("en-IN")}`;
  const right = [];
  right.push(["Subtotal", fmt(subtotal)]);
  if (discount > 0) right.push([`Discount${couponCode ? ` (${couponCode})` : ""}`, `-${fmt(discount)}`]);
  right.push(["Shipping", shipping <= 0 ? "Free" : fmt(shipping)]);
  if (codFee > 0) right.push(["COD Handling Fee", fmt(codFee)]);
  if (cgst > 0) right.push(["CGST (9%)", fmt(cgst)]);
  if (sgst > 0) right.push(["SGST (9%)", fmt(sgst)]);
  right.push([isCod ? "Amount Due on Delivery" : "Amount Paid", fmt(grandTotal)]);

  for (let i = 0; i < right.length; i++) {
    const [lab, val] = right[i];
    const isLast = i === right.length - 1;
    doc.setFont("NotoSans", isLast ? "bold" : "normal");
    doc.setFontSize(isLast ? 10 : 8.5);
    doc.setTextColor(...TEAL);
    doc.text(lab, 118, y);
    doc.text(val, 188, y, { align: "right" });
    y += 6;
  }

  y = Math.max(y + 14, 252);
  doc.setDrawColor(...LINE);
  doc.line(22, y, 188, y);
  y += 6;
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  const note =
    "This invoice assumes an intra-state (Maharashtra) shipment and shows tax as CGST + SGST accordingly. Every AKARA piece is made to order — production begins after order confirmation. This is a system-generated invoice and does not require a signature.";
  doc.text(doc.splitTextToSize(note, 166), 22, y);

  return Buffer.from(doc.output("arraybuffer")).toString("base64");
}
