/**
 * One-page Care & Placement card PDF (base64) for order confirmation email.
 * Uses jspdf already in dependencies — no new packages.
 */
import { jsPDF } from "jspdf";

/**
 * @param {{ orderNumber?: string, items?: Array<{ name?: string, size?: string, colorLabel?: string, qty?: number }> }} order
 * @returns {string} base64 PDF (no data: prefix)
 */
export function buildCarePlacementCardBase64(order) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const teal = [24, 54, 48];
  const muted = [90, 100, 95];
  const gold = [229, 198, 144];

  // Header band
  doc.setFillColor(...teal);
  doc.rect(0, 0, 210, 36, "F");
  doc.setTextColor(227, 218, 201);
  doc.setFont("helvetica", "normal");
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
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Your pieces", 20, y);
  y += 8;
  doc.setFont("helvetica", "normal");
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
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Care", 20, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const care = [
    "Dust with a soft, dry cloth. Avoid wet wipes and household cleaners.",
    "Keep away from prolonged direct sun and high heat (open flame, hot vents).",
    "Plant-based PLA is stable indoors; it is not intended for outdoor weather exposure.",
    "If a surface mark appears, a gentle dry buff is enough — never abrasive pads.",
  ];
  for (const c of care) {
    const lines = doc.splitTextToSize(`•  ${c}`, 170);
    doc.text(lines, 20, y);
    y += lines.length * 5.5 + 2;
  }

  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...teal);
  doc.text("Placement", 20, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const place = [
    "Give the form a little space from busy edges so the geometry reads clearly.",
    "Pair with quiet surfaces — stone, timber, linen — rather than competing patterns.",
    "Lighting pieces: use the fittings noted on the product page; do not exceed rated load.",
    "Planters: use the drainage approach described for that form; empty trays after watering.",
  ];
  for (const c of place) {
    const lines = doc.splitTextToSize(`•  ${c}`, 170);
    doc.text(lines, 20, y);
    y += lines.length * 5.5 + 2;
  }

  y = Math.max(y + 10, 250);
  doc.setDrawColor(...gold);
  doc.line(20, y, 190, y);
  y += 10;
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text("Full care guide: www.akaraonline.co.in/care-guide", 105, y, { align: "center" });
  y += 6;
  doc.text("Questions · support@akaraonline.co.in", 105, y, { align: "center" });

  const dataUri = doc.output("datauristring");
  // data:application/pdf;filename=generated.pdf;base64,....
  const i = dataUri.indexOf("base64,");
  return i >= 0 ? dataUri.slice(i + 7) : dataUri;
}
