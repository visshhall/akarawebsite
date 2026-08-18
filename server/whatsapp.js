// ============================================================================
// WHATSAPP — via Gupshup (gupshup.io), a WhatsApp Business Solution
// Provider sitting on top of Meta's underlying platform. This was
// originally built against Meta's raw Cloud API directly, then rebuilt
// against Gupshup's own API once that's what the business actually set
// up — Gupshup does NOT expose Meta's Graph API directly; it has its own
// separate REST API with its own auth and payload shape, which is what
// this file now targets.
//
// HONEST CAVEAT — this is built from Gupshup's publicly documented
// WhatsApp Business API shape (their /wa/api/v1/template/msg endpoint),
// not verified against a real send yet. If the very first real attempt
// comes back with an error, the most likely culprit is a field name or
// endpoint path having shifted since — send me whatever error Gupshup's
// API actually returns and this gets corrected against real, current
// behavior rather than guessed at twice.
//
// CRITICAL — same category of constraint as SMS's DLT requirement:
// WhatsApp requires every business-initiated message (outside a 24-hour
// window after the customer last messaged first) to use a PRE-APPROVED
// message template. The message text itself isn't sent — only the
// template's ID/name and the values for its variable placeholders, which
// must exactly match what Meta approved through Gupshup's review.
//
// Same "optional infrastructure" pattern as email/courier: without
// credentials, every function here logs a warning and returns quietly —
// never breaks the order flow that triggered it.
// ============================================================================

const GUPSHUP_API_BASE = process.env.GUPSHUP_API_BASE || "https://api.gupshup.io/wa/api/v1";

async function sendWhatsAppTemplate({ to, templateId, params = [] }) {
  if (!process.env.GUPSHUP_API_KEY || !process.env.GUPSHUP_SOURCE_NUMBER) {
    console.warn(`[whatsapp] Gupshup credentials not set — skipped template ${templateId} to ${to}`);
    return { skipped: true };
  }
  if (!templateId) {
    console.warn(`[whatsapp] No approved template ID configured for this message type — skipped to ${to}. See server/whatsapp.js for what's needed.`);
    return { skipped: true };
  }
  try {
    const body = new URLSearchParams({
      channel: "whatsapp",
      source: process.env.GUPSHUP_SOURCE_NUMBER,
      destination: `91${to}`,
      "src.name": process.env.GUPSHUP_APP_NAME || "AKARAAPP",
      template: JSON.stringify({ id: templateId, params: params.map(String) }),
    });
    const res = await fetch(`${GUPSHUP_API_BASE}/template/msg`, {
      method: "POST",
      headers: {
        "apikey": process.env.GUPSHUP_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      const responseBody = await res.text().catch(() => "");
      console.error(`[whatsapp] Gupshup API error ${res.status} sending template ${templateId} to ${to}: ${responseBody}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[whatsapp] Failed to send to ${to}:`, err.message);
    return { ok: false };
  }
}

// Each of these needs its own approved template ID once registered —
// separate env vars so they can be turned on one at a time as each
// template clears Gupshup/Meta's approval, rather than all-or-nothing.
export async function sendOrderConfirmationWhatsApp(order) {
  if (!order.phone) return { skipped: true };
  return sendWhatsAppTemplate({
    to: order.phone,
    templateId: process.env.GUPSHUP_TEMPLATE_CONFIRMED,
    params: [order.orderNumber, String(order.total)],
  });
}

export async function sendOrderDispatchedWhatsApp(order) {
  if (!order.phone) return { skipped: true };
  return sendWhatsAppTemplate({
    to: order.phone,
    templateId: process.env.GUPSHUP_TEMPLATE_DISPATCHED,
    params: [order.orderNumber],
  });
}

export async function sendOrderDeliveredWhatsApp(order) {
  if (!order.phone) return { skipped: true };
  return sendWhatsAppTemplate({
    to: order.phone,
    templateId: process.env.GUPSHUP_TEMPLATE_DELIVERED,
    params: [order.orderNumber],
  });
}
