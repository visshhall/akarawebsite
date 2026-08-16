// ============================================================================
// WHATSAPP — via Meta's WhatsApp Business Cloud API. Replaces SMS
// entirely per business decision — the WhatsApp Business APP (the free
// phone app) cannot send automated messages at all; this requires
// separate WhatsApp Business PLATFORM access from Meta (or a provider
// like AiSensy/Gupshup/Interakt sitting on top of the same underlying
// API), which is a different, additional setup from the app already in use.
//
// CRITICAL — same category of constraint as SMS's DLT requirement:
// WhatsApp requires every business-initiated message (i.e. anything sent
// outside a 24-hour window after the customer last messaged first) to
// use a PRE-APPROVED message template, submitted through Meta and
// approved before it can be sent. The message bodies below are
// reasonable placeholders — once real templates are approved, this file
// needs the template NAME (not the raw text) plugged into each send call,
// matching exactly what Meta approved, including variable positions.
//
// Same "optional infrastructure" pattern as email/SMS/courier: without
// credentials, every function here logs a warning and returns quietly.
// ============================================================================

const WHATSAPP_API_BASE = process.env.WHATSAPP_API_BASE || "https://graph.facebook.com/v20.0";

async function sendWhatsAppTemplate({ to, templateName, languageCode = "en", params = [] }) {
  if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    console.warn(`[whatsapp] Credentials not set — skipped "${templateName}" to ${to}`);
    return { skipped: true };
  }
  if (!templateName) {
    console.warn(`[whatsapp] No approved template name configured for this message type — skipped to ${to}. See server/whatsapp.js for what's needed.`);
    return { skipped: true };
  }
  try {
    const res = await fetch(`${WHATSAPP_API_BASE}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: `91${to}`,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          components: params.length ? [{ type: "body", parameters: params.map(p => ({ type: "text", text: String(p) })) }] : [],
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[whatsapp] API error ${res.status} sending "${templateName}" to ${to}: ${body}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[whatsapp] Failed to send to ${to}:`, err.message);
    return { ok: false };
  }
}

// Each of these needs its own approved template name once registered —
// separate env vars so they can be turned on one at a time as each
// template clears Meta's approval, rather than all-or-nothing.
export async function sendOrderConfirmationWhatsApp(order) {
  if (!order.phone) return { skipped: true };
  return sendWhatsAppTemplate({
    to: order.phone,
    templateName: process.env.WHATSAPP_TEMPLATE_CONFIRMED,
    params: [order.orderNumber, String(order.total)],
  });
}

export async function sendOrderDispatchedWhatsApp(order) {
  if (!order.phone) return { skipped: true };
  return sendWhatsAppTemplate({
    to: order.phone,
    templateName: process.env.WHATSAPP_TEMPLATE_DISPATCHED,
    params: [order.orderNumber],
  });
}

export async function sendOrderDeliveredWhatsApp(order) {
  if (!order.phone) return { skipped: true };
  return sendWhatsAppTemplate({
    to: order.phone,
    templateName: process.env.WHATSAPP_TEMPLATE_DELIVERED,
    params: [order.orderNumber],
  });
}
