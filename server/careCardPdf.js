/**
 * One-page Care & Placement card PDF (base64) for order confirmation email.
 * Embeds Noto Sans (same SIL OFL font as customer invoice) so "ĀKĀRA" renders —
 * jsPDF built-in Helvetica cannot draw macron-A (became "K RA").
 * Font loaded via dynamic import so the large base64 is only pulled when a care PDF is built.
 */
import { jsPDF } from "jspdf";

/**
 * @param {{ orderNumber?: string, items?: Array<{ name?: string, size?: string, colorLabel?: string, qty?: number }> }} order
 * @returns {Promise<string>} base64 PDF (no data: prefix)
 */
export async function buildCarePlacementCardBase64(order) {
  const fontModule = await import("../src/invoiceFontData.js");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.addFileToVFS("NotoSans-Regular.ttf", fontModule.NOTO_SANS_REGULAR_BASE64);
  doc.addFileToVFS("NotoSans-Bold.ttf", fontModule.NOTO_SANS_BOLD_BASE64);
  doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");

  const teal = [24, 54, 48];
  const muted = [90, 100, 95];
  const gold = [229, 198, 144];
  const cream = [227, 218, 201];

  // Header band
  doc.setFillColor(...teal);
  doc.rect(0, 0, 210, 36, "F");
  doc.setTextColor(...cream);
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(18);
  doc.text("ĀKĀRA", 105, 16, { align: "center" });
  doc.setFontSize(9);
  doc.setTextColor(...gold);
  doc.text("CARE & PLACEMENT", 105, 24, { align: "center" });
  doc.setTextColor(200, 210, 205);
  doc.setFontSize(8);
  doc.text(`Order #${order.orderNumber || ""} · Studio piece`, 105, 31, { align: "center" });

  let y = 48;
  doc.setTextColor(...teal);
  doc.setFont("NotoSans", "bold");
  doc.setFontSize(12);
  doc.text("Your pieces", 20, y);
  y += 8;
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(10);
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0) {
    doc.setTextColor(...muted);
    doc.text("See your confirmation email for item details.", 20, y);
    y += 8;
  } else {
    for (const it of items.slice(0, 8)) {
      const variant = [it.colorLabel, it.size].filter(Boolean).join(" · ");
      const line = `${it.name || "Piece"}${variant ? ` — ${variant}` : ""}${it.qty > 1 ? ` × ${it.qty}` : ""}`;
      doc.setTextColor(...teal);
      doc.text(line.slice(0, 90), 20, y);
      y += 6;
      doc.setFontSize(8);
      doc.setTextColor(...muted);
      doc.text("Studio batch · Printed to order in Mumbai · Not white-labelled stock", 22, y);
      y += 8;
      doc.setFontSize(10);
    }
  }

  y += 4;
  doc.setDrawColor(...gold);
  doc.setLineWidth(0.4);
  doc.line(20, y, 190, y);
  y += 12;

  doc.setTextColor(...teal);
  doc.setFont("NotoSans", "bold");
  doc.setFontSize(12);
  doc.text("Care", 20, y);
  y += 8;
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(10);
  const careLines = [
    "Dust with a soft, dry cloth. Avoid wet wipes and household cleaners.",
    "Keep away from prolonged direct sun and high heat (open flame, hot vents).",
    "Plant-based PLA is stable indoors; treat like a fine ceramic object.",
  ];
  for (const line of careLines) {
    const wrapped = doc.splitTextToSize(line, 170);
    doc.text(wrapped, 20, y);
    y += wrapped.length * 5 + 3;
  }

  y += 4;
  doc.setFont("NotoSans", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...teal);
  doc.text("Placement", 20, y);
  y += 8;
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(10);
  const placeLines = [
    "Give the piece a stable, level surface. Leave a little air around lattice forms.",
    "For planters: use the drainage tray; empty standing water after watering.",
    "Lamps: use the bulb type noted on the product page; switch off when not in use.",
  ];
  for (const line of placeLines) {
    const wrapped = doc.splitTextToSize(line, 170);
    doc.text(wrapped, 20, y);
    y += wrapped.length * 5 + 3;
  }

  y = Math.max(y + 8, 260);
  doc.setDrawColor(...gold);
  doc.line(20, y, 190, y);
  y += 10;
  doc.setFontSize(8);
  doc.setTextColor(...muted);
  doc.text("akaraonline.co.in · Made to order in Mumbai · Precision Forge Labs", 105, y, { align: "center" });

  const dataUri = doc.output("datauristring");
  // data:application/pdf;base64,....
  const b64 = dataUri.split(",")[1] || "";
  return b64;
}
