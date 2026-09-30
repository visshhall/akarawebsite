/**
 * Meta (Facebook) Conversions API — server-side only.
 *
 * WHY: Browser Pixel alone is blocked by iOS / ad blockers; CAPI improves
 * purchase attribution for Instagram/Facebook ads without trusting the client
 * with the access token.
 *
 * SECURITY:
 * - META_CAPI_ACCESS_TOKEN never leaves the server
 * - PII (email/phone) is SHA-256 hashed (lowercase, trimmed) before send
 * - No-ops cleanly when Pixel ID or token is unset (ads optional)
 * - Fire-and-forget from order handlers — never blocks checkout
 */
import crypto from "crypto";

const PIXEL_ID = () => (process.env.META_PIXEL_ID || process.env.FACEBOOK_PIXEL_ID || "").trim();
const ACCESS_TOKEN = () => (process.env.META_CAPI_ACCESS_TOKEN || process.env.FACEBOOK_CAPI_TOKEN || "").trim();
const TEST_CODE = () => (process.env.META_TEST_EVENT_CODE || "").trim();
const API_VERSION = "v21.0";

export function metaPixelConfigured() {
  return Boolean(PIXEL_ID());
}

export function metaCapiConfigured() {
  return Boolean(PIXEL_ID() && ACCESS_TOKEN());
}

/** Normalize + SHA-256 hash for Meta advanced matching (email / phone). */
export function hashMetaPii(value) {
  if (value == null || value === "") return undefined;
  let s = String(value).trim().toLowerCase();
  // Phone: keep digits only; ensure country code if 10-digit IN mobile
  if (/^[\d\s+()-]+$/.test(s) || /^\+?\d{10,15}$/.test(s.replace(/\D/g, ""))) {
    let digits = s.replace(/\D/g, "");
    if (digits.length === 10) digits = "91" + digits;
    s = digits;
  }
  if (!s) return undefined;
  return crypto.createHash("sha256").update(s).digest("hex");
}

/**
 * Send one or more CAPI events.
 * @param {Array<object>} events - Meta event payloads (event_name, event_time, user_data, custom_data, ...)
 */
export async function sendMetaCapiEvents(events) {
  if (!metaCapiConfigured() || !Array.isArray(events) || events.length === 0) {
    return { skipped: true, reason: metaCapiConfigured() ? "no_events" : "not_configured" };
  }

  const body = {
    data: events,
    partner_agent: "akara-server",
  };
  const testCode = TEST_CODE();
  if (testCode) body.test_event_code = testCode;

  const url = `https://graph.facebook.com/${API_VERSION}/${encodeURIComponent(PIXEL_ID())}/events?access_token=${encodeURIComponent(ACCESS_TOKEN())}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn("[meta-capi] HTTP", res.status, JSON.stringify(json).slice(0, 300));
      return { ok: false, status: res.status, json };
    }
    return { ok: true, json };
  } catch (err) {
    console.warn("[meta-capi] network", err?.message || err);
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * Build Purchase event from a confirmed order (COD or paid).
 * event_id = orderNumber for dedupe with browser Pixel Purchase.
 */
export function buildPurchaseEvent(order, req = null) {
  const orderNumber = order?.orderNumber || order?.order_number;
  if (!orderNumber) return null;

  const email = order.email || order.customer_email;
  const phone = order.phone || order.customer_phone || order.shippingAddress?.phone;

  const user_data = {
    em: hashMetaPii(email) ? [hashMetaPii(email)] : undefined,
    ph: hashMetaPii(phone) ? [hashMetaPii(phone)] : undefined,
    client_ip_address: req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || req?.ip || undefined,
    client_user_agent: req?.headers?.["user-agent"] || undefined,
    fbp: req?.headers?.["x-fb-fbp"] || undefined,
    fbc: req?.headers?.["x-fb-fbc"] || undefined,
  };
  // Drop undefined keys
  Object.keys(user_data).forEach((k) => user_data[k] === undefined && delete user_data[k]);

  const contents = [];
  const items = Array.isArray(order.items) ? order.items : [];
  for (const it of items) {
    contents.push({
      id: String(it.id || it.productId || it.product_id || ""),
      quantity: Number(it.qty || it.quantity || 1) || 1,
      item_price: Number(it.price || it.unitPrice || 0) || undefined,
    });
  }

  return {
    event_name: "Purchase",
    event_time: Math.floor(Date.now() / 1000),
    event_id: String(orderNumber),
    event_source_url: process.env.SITE_URL
      ? `${process.env.SITE_URL.replace(/\/$/, "")}/order-confirmed?order=${encodeURIComponent(orderNumber)}`
      : undefined,
    action_source: "website",
    user_data,
    custom_data: {
      currency: "INR",
      value: Number(order.total) || 0,
      content_type: "product",
      contents,
      order_id: String(orderNumber),
    },
  };
}

/** Fire-and-forget purchase attribution */
export function trackMetaPurchase(order, req = null) {
  const ev = buildPurchaseEvent(order, req);
  if (!ev) return;
  sendMetaCapiEvents([ev]).catch(() => {});
}

/**
 * Generic browser-mirrored event (ViewContent, AddToCart, etc.) for CAPI.
 * event_id should match the browser event_id for deduplication.
 */
export function buildStandardEvent({
  eventName,
  eventId,
  sourceUrl,
  email,
  phone,
  value,
  contentIds,
  contentName,
  contentType = "product",
  req,
}) {
  const user_data = {
    em: hashMetaPii(email) ? [hashMetaPii(email)] : undefined,
    ph: hashMetaPii(phone) ? [hashMetaPii(phone)] : undefined,
    client_ip_address: req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || req?.ip || undefined,
    client_user_agent: req?.headers?.["user-agent"] || undefined,
    fbp: req?.headers?.["x-fb-fbp"] || undefined,
    fbc: req?.headers?.["x-fb-fbc"] || undefined,
  };
  Object.keys(user_data).forEach((k) => user_data[k] === undefined && delete user_data[k]);

  const custom_data = {
    currency: "INR",
    content_type: contentType,
  };
  if (value != null && !Number.isNaN(Number(value))) custom_data.value = Number(value);
  if (Array.isArray(contentIds) && contentIds.length) custom_data.content_ids = contentIds.map(String);
  if (contentName) custom_data.content_name = String(contentName).slice(0, 200);

  return {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId || crypto.randomUUID(),
    event_source_url: sourceUrl || undefined,
    action_source: "website",
    user_data,
    custom_data,
  };
}
