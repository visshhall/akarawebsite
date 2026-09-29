import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";

const router = Router();
const SITE = "https://www.akaraonline.co.in";
const GST = 1.18; // store prices are exclusive; feed must be GST-inclusive for India ads

function firstImage(media) {
  if (!Array.isArray(media)) return null;
  for (const m of media) {
    if (!m) continue;
    if (m.type === "video") continue;
    const src = typeof m === "string" ? m : m.src || m.url;
    if (src && typeof src === "string" && /^https?:\/\//i.test(src)) return src;
  }
  return null;
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function availability(status, stockQty) {
  if (status === "sold-out") return "out of stock";
  if (status === "pre-order") return "preorder";
  if (stockQty != null && Number(stockQty) <= 0) return "out of stock";
  return "in stock";
}

// Google Merchant Center product feed (RSS 2.0 + g: namespace)
router.get("/google-merchant.xml", asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, category, price, status, description, media, stock_qty
     FROM products
     WHERE status NOT IN ('draft','hidden')
     ORDER BY category, name`
  );

  const items = [];
  for (const row of rows) {
    const img = firstImage(row.media);
    if (!img) continue; // Merchant requires image
    const priceEx = Number(row.price) || 0;
    if (priceEx <= 0) continue;
    const incl = Math.round(priceEx * GST);
    const link = `${SITE}/product/${encodeURIComponent(row.id)}`;
    const desc = (row.description || row.name || "").replace(/\s+/g, " ").trim().slice(0, 5000);
    items.push(`    <item>
      <g:id>${esc(row.id)}</g:id>
      <g:title>${esc(row.name)}</g:title>
      <g:description>${esc(desc || row.name)}</g:description>
      <g:link>${esc(link)}</g:link>
      <g:image_link>${esc(img)}</g:image_link>
      <g:availability>${availability(row.status, row.stock_qty)}</g:availability>
      <g:price>${incl}.00 INR</g:price>
      <g:brand>ĀKĀRA</g:brand>
      <g:condition>new</g:condition>
      <g:product_type>${esc(row.category || "Home")}</g:product_type>
      <g:google_product_category>696</g:google_product_category>
    </item>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>ĀKĀRA Product Feed</title>
    <link>${SITE}</link>
    <description>GST-inclusive product feed for Google Merchant Center</description>
${items.join("\n")}
  </channel>
</rss>
`;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=900");
  res.send(xml);
}));

export default router;
