// ============================================================================
// COURIER — via Shiprocket, chosen because it aggregates most major
// Indian couriers under one account rather than needing separate
// relationships with each. Same "optional infrastructure" pattern as
// email/SMS: without credentials, this quietly no-ops rather than
// breaking the admin action that triggered it.
//
// HONEST CAVEAT — unlike Razorpay/Resend, this integration shape is
// built from Shiprocket's publicly documented API structure, not
// verified against a real account (none exists yet for this project).
// One thing will very likely need adjustment once real credentials
// exist: package weight/dimensions are currently rough placeholders per
// order, not per-product, since actual product weights aren't tracked
// anywhere in this system yet — easy to fix once there's a real account
// to test error responses against.
//
// SETUP NEEDED: a Shiprocket account with business KYC completed, at
// least one pickup location configured in their dashboard AND saved here
// via the admin Settings screen (see server/routes/admin/settings.js —
// GET/POST/DELETE /api/admin/settings/pickup-locations), and
// SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD set in Railway (Shiprocket's
// API authenticates with account credentials, not a static API key).
// ============================================================================

const SHIPROCKET_API_BASE = process.env.SHIPROCKET_API_BASE || "https://apiv2.shiprocket.in/v1/external";

// Shiprocket's token is short-lived; cached in memory and re-fetched once
// expired rather than logging in again on every request.
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAuthToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const res = await fetch(`${SHIPROCKET_API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.SHIPROCKET_EMAIL, password: process.env.SHIPROCKET_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Shiprocket login failed (${res.status})`);
  const data = await res.json();
  cachedToken = data.token;
  tokenExpiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000; // Shiprocket tokens last ~10 days; refreshed a day early to be safe
  return cachedToken;
}

// Creates a real shipment for a dispatched order and returns the AWB
// (tracking number) + a tracking URL. Called from the admin dispatch
// action (see server/routes/admin/orders.js) — nothing calls this
// automatically before then, since there's nothing to ship until an
// admin has actually decided the order is ready. pickupLocationName is
// now REQUIRED and chosen at dispatch time (not a fixed default) — the
// business has more than one real pickup address, and which one applies
// depends on which is actually staffed that day, not something fixed in
// advance.
export async function createShipment(order, pickupLocationName) {
  if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) {
    console.warn(`[courier] Shiprocket credentials not set — skipped shipment creation for order #${order.orderNumber}`);
    return { skipped: true };
  }
  if (!pickupLocationName) {
    console.error(`[courier] No pickup location provided — skipped shipment creation for order #${order.orderNumber}`);
    return { ok: false, error: "No pickup location specified." };
  }
  try {
    const token = await getAuthToken();
    const res = await fetch(`${SHIPROCKET_API_BASE}/orders/create/adhoc`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: order.orderNumber,
        order_date: new Date().toISOString().slice(0, 10),
        pickup_location: pickupLocationName,
        billing_customer_name: order.name || "Customer",
        billing_address: order.address,
        billing_city: order.city,
        billing_state: order.state,
        billing_pincode: order.pin,
        billing_country: "India",
        billing_phone: order.phone,
        billing_email: order.email,
        shipping_is_billing: true,
        order_items: order.items.map(i => ({ name: i.name, sku: i.id, units: i.qty, selling_price: i.price, hsn: i.hsn })),
        payment_method: "Prepaid", // all orders here are paid via Razorpay before dispatch is ever possible — never COD
        sub_total: order.total,
        // Placeholder weight/dimensions — see the file-level note above.
        // Needs real per-product weights once available; a wrong weight
        // here risks an under-charged shipment getting a courier-side
        // weight discrepancy fee, so this should be revisited before
        // high volume, not left as a permanent placeholder.
        weight: 0.5,
        length: 20, breadth: 20, height: 15,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[courier] Shiprocket shipment creation failed (${res.status}) for order #${order.orderNumber}: ${body}`);
      return { ok: false, error: body };
    }
    const data = await res.json();
    const awb = data.awb_code || null;
    return {
      ok: true,
      trackingId: awb || String(data.shipment_id || ""),
      trackingUrl: awb ? `https://shiprocket.co/tracking/${awb}` : null,
    };
  } catch (err) {
    console.error(`[courier] Failed to create shipment for order #${order.orderNumber}:`, err.message);
    return { ok: false, error: err.message };
  }
}

// Fetches the REAL current status from Shiprocket for an already-created
// shipment, by its AWB (the tracking ID stored on the order). This is
// what makes "Delivered" a real, courier-confirmed fact instead of a
// manual guess — Shiprocket already knows the courier's actual status;
// this just asks for it. Maps Shiprocket's own status wording to this
// app's internal status values — only mapped to 'delivered' for now,
// since that's the one status genuinely worth auto-updating; every
// earlier stage (production, QC) is set by the admin because Shiprocket
// has no idea about work happening before a shipment exists.
export async function fetchTrackingStatus(awb) {
  if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) {
    return { skipped: true };
  }
  if (!awb) return { skipped: true };
  try {
    const token = await getAuthToken();
    const res = await fetch(`${SHIPROCKET_API_BASE}/courier/track/awb/${awb}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[courier] Tracking fetch failed (${res.status}) for AWB ${awb}: ${body}`);
      return { ok: false };
    }
    const data = await res.json();
    // Shiprocket's response shape nests the current status under
    // tracking_data.shipment_track[0].current_status — this is based on
    // their documented shape, not verified against a real account yet
    // (same honest caveat as the rest of this file).
    const currentStatus = data?.tracking_data?.shipment_track?.[0]?.current_status || "";
    const isDelivered = /delivered/i.test(currentStatus) && !/rto/i.test(currentStatus);
    return { ok: true, rawStatus: currentStatus, isDelivered };
  } catch (err) {
    console.error(`[courier] Failed to fetch tracking for AWB ${awb}:`, err.message);
    return { ok: false };
  }
}
