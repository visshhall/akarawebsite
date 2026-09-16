// ============================================================================
// COURIER — via Shiprocket (optional infrastructure).
// Without SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD, createShipment returns
// { skipped: true } and does not throw — but the admin API now surfaces that.
// ============================================================================

const SHIPROCKET_API_BASE = process.env.SHIPROCKET_API_BASE || "https://apiv2.shiprocket.in/v1/external";

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAuthToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const email = (process.env.SHIPROCKET_EMAIL || "").trim();
  const password = process.env.SHIPROCKET_PASSWORD || "";
  if (!email || !password) {
    throw new Error("Shiprocket credentials not set (SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD)");
  }
  const res = await fetch(`${SHIPROCKET_API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Shiprocket login failed (${res.status}): ${bodyText.slice(0, 300)}`);
  }
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new Error(`Shiprocket login returned non-JSON: ${bodyText.slice(0, 200)}`);
  }
  if (!data.token) {
    throw new Error(`Shiprocket login succeeded but no token in response: ${bodyText.slice(0, 200)}`);
  }
  cachedToken = data.token;
  tokenExpiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000;
  return cachedToken;
}

/**
 * Create a Shiprocket order for a dispatched AKARA order.
 * @param {object} order - flat fields: orderNumber, name, address, city, state, pin, phone, email, items, total, paymentMethod
 * @param {string} pickupLocationName - must match Shiprocket dashboard pickup nickname exactly
 */

function extractAwb(data) {
  if (!data || typeof data !== "object") return null;
  const candidates = [
    data.awb_code,
    data.awb,
    data?.response?.data?.awb_code,
    data?.response?.data?.awb,
    data?.response?.awb_code,
    data?.payload?.awb_code,
    data?.data?.awb_code,
    data?.data?.awb,
    data?.data?.response?.data?.awb_code,
    Array.isArray(data?.shipments) && data.shipments[0] && (data.shipments[0].awb || data.shipments[0].awb_code),
    data?.awb_data?.awb,
    data?.awb_data?.awb_code,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim() && !String(c).startsWith("SR-")) return String(c).trim();
  }
  return null;
}

function extractShipmentId(data) {
  if (!data || typeof data !== "object") return null;
  return (
    data.shipment_id ||
    data.shipmentId ||
    data?.response?.data?.shipment_id ||
    data?.data?.shipment_id ||
    data?.payload?.shipment_id ||
    null
  );
}

/**
 * Look up an existing Shiprocket order by our channel order id (order_number).
 * Used when create returns "already exists" or when admin clicks Sync AWB.
 */

/** Try every known shape of Shiprocket AWB assign until we get an awb_code. */
async function assignAwbForShipment(token, shipmentId) {
  const sid = Number(shipmentId) || shipmentId;
  const bodies = [
    { shipment_id: sid },
    { shipment_id: String(sid) },
    { shipment_id: [sid] },
    { shipment_id: [String(sid)] },
  ];
  for (const body of bodies) {
    try {
      const awbRes = await fetch(`${SHIPROCKET_API_BASE}/courier/assign/awb`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const awbText = await awbRes.text().catch(() => "");
      let awbData = {};
      try { awbData = awbText ? JSON.parse(awbText) : {}; } catch { awbData = {}; }
      const awb = extractAwb(awbData);
      if (awb) {
        console.log(`[courier] AWB assigned for shipment ${sid}: ${awb}`);
        return String(awb);
      }
      console.warn(`[courier] assign/awb attempt failed (${awbRes.status}): ${awbText.slice(0, 240)}`);
    } catch (e) {
      console.warn(`[courier] assign/awb error:`, e.message);
    }
  }

  // Fallback: fetch shipment details — AWB may already exist on SR side
  try {
    const detRes = await fetch(`${SHIPROCKET_API_BASE}/shipments/${sid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const detText = await detRes.text().catch(() => "");
    let det = {};
    try { det = detText ? JSON.parse(detText) : {}; } catch { det = {}; }
    const fromDetails =
      extractAwb(det) ||
      extractAwb(det.data) ||
      extractAwb(det.shipment) ||
      null;
    if (fromDetails) {
      console.log(`[courier] AWB from shipment details ${sid}: ${fromDetails}`);
      return String(fromDetails);
    }
  } catch (e) {
    console.warn(`[courier] shipment details fetch failed:`, e.message);
  }
  return null;
}

async function findExistingShipment(token, orderNumber) {
  try {
    const q = encodeURIComponent(String(orderNumber));
    const res = await fetch(`${SHIPROCKET_API_BASE}/orders?search=${q}&per_page=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      console.warn(`[courier] findExistingShipment search failed (${res.status}): ${text.slice(0, 200)}`);
      return { ok: false, error: `Search failed (${res.status})` };
    }
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    const list =
      data.data ||
      data.orders ||
      data?.response?.data ||
      (Array.isArray(data) ? data : []);
    const rows = Array.isArray(list) ? list : [];
    const match =
      rows.find((o) => String(o.channel_order_id || o.order_id || o.id) === String(orderNumber)) ||
      rows.find((o) => String(o.channel_order_id || "").includes(String(orderNumber))) ||
      rows[0];
    if (!match) return { ok: false, error: "No matching Shiprocket order found for this order number." };

    let awb =
      extractAwb(match) ||
      match.awb ||
      match.awb_code ||
      (Array.isArray(match.shipments) && match.shipments[0] && (match.shipments[0].awb || match.shipments[0].awb_code)) ||
      null;
    const shipmentId =
      extractShipmentId(match) ||
      match.shipment_id ||
      match.id ||
      (Array.isArray(match.shipments) && match.shipments[0] && match.shipments[0].id) ||
      null;

    // Try assign AWB if we only have shipment id
    if (!awb && shipmentId) {
      awb = await assignAwbForShipment(token, shipmentId);
    }

    const trackingId = awb || (shipmentId ? `SR-${shipmentId}` : null);
    if (!trackingId) return { ok: false, error: "Shiprocket order found but no AWB/shipment id yet." };

    const trackingUrl = awb
      ? `https://shiprocket.co/tracking/${awb}`
      : shipmentId
        ? `https://app.shiprocket.in/seller/orders/details/${shipmentId}`
        : null;

    return {
      ok: true,
      trackingId: String(trackingId),
      trackingUrl,
      shipmentId: shipmentId ? String(shipmentId) : null,
      awb: awb ? String(awb) : null,
    };
  } catch (err) {
    console.error("[courier] findExistingShipment:", err.message);
    return { ok: false, error: err.message };
  }
}

/** Public: pull latest AWB/tracking for a channel order id (admin sync). */
export async function syncShipmentByOrderNumber(orderNumber) {
  if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) {
    return { ok: false, error: "Shiprocket credentials not set." };
  }
  try {
    const token = await getAuthToken();
    return await findExistingShipment(token, orderNumber);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}


export async function createShipment(order, pickupLocationName) {
  if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) {
    console.warn(`[courier] Shiprocket credentials not set — skipped shipment for #${order.orderNumber}`);
    return {
      skipped: true,
      ok: false,
      error: "Shiprocket credentials not set on the server (SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD). Order was marked dispatched but no courier booking was created.",
    };
  }
  if (!pickupLocationName) {
    return { ok: false, error: "No pickup location specified." };
  }

  const isCod =
    String(order.paymentMethod || order.payment_method || "").toLowerCase() === "cod" ||
    String(order.paymentStatus || order.payment_status || "").toLowerCase() === "cod";

  const items = (Array.isArray(order.items) ? order.items : []).map((i) => ({
    name: String(i.name || "Item").slice(0, 200),
    sku: String(i.id || i.sku || "item").slice(0, 50),
    units: Number(i.qty || i.quantity || 1) || 1,
    selling_price: Number(i.price || 0) || 0,
    hsn: i.hsn ? String(i.hsn) : undefined,
  }));

  if (!items.length) {
    return { ok: false, error: "Order has no line items — cannot create Shiprocket shipment." };
  }

  const phone = String(order.phone || "").replace(/\D/g, "").slice(-10);
  if (phone.length !== 10) {
    return {
      ok: false,
      error: `Customer phone must be a 10-digit Indian mobile for Shiprocket (got "${order.phone || ""}").`,
    };
  }

  const pin = String(order.pin || "").replace(/\D/g, "");
  if (pin.length !== 6) {
    return { ok: false, error: `PIN code must be 6 digits (got "${order.pin || ""}").` };
  }

  try {
    const token = await getAuthToken();
    const payload = {
      order_id: String(order.orderNumber),
      order_date: new Date().toISOString().slice(0, 10),
      pickup_location: String(pickupLocationName),
      billing_customer_name: String(order.name || "Customer").slice(0, 100),
      billing_last_name: "",
      billing_address: String(order.address || "").slice(0, 200),
      billing_address_2: order.landmark ? String(order.landmark).slice(0, 200) : "",
      billing_city: String(order.city || "").slice(0, 50),
      billing_state: String(order.state || "").slice(0, 50),
      billing_pincode: pin,
      billing_country: "India",
      billing_email: String(order.email || "orders@akaraonline.co.in"),
      billing_phone: phone,
      shipping_is_billing: true,
      order_items: items,
      payment_method: isCod ? "COD" : "Prepaid",
      sub_total: Number(order.total) || items.reduce((s, i) => s + i.selling_price * i.units, 0),
      ...(process.env.SHIPROCKET_CHANNEL_ID
        ? { channel_id: Number(process.env.SHIPROCKET_CHANNEL_ID) || process.env.SHIPROCKET_CHANNEL_ID }
        : {}),
      // Placeholders until per-product weights exist in catalog
      weight: 0.5,
      length: 20,
      breadth: 20,
      height: 15,
    };

    const res = await fetch(`${SHIPROCKET_API_BASE}/orders/create/adhoc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const bodyText = await res.text().catch(() => "");
    let data = {};
    try {
      data = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      data = { raw: bodyText };
    }

    // Shiprocket often returns HTTP 200 with status_code !== 1 on business errors
    const statusCode = data.status_code ?? data.statusCode;
    const createFailed =
      !res.ok ||
      (statusCode != null && Number(statusCode) !== 1 && !data.shipment_id && !data.order_id && !data.awb_code);

    if (createFailed) {
      const msg =
        data.message ||
        (Array.isArray(data.errors) ? JSON.stringify(data.errors) : null) ||
        bodyText.slice(0, 400) ||
        `HTTP ${res.status}`;
      console.error(`[courier] Shiprocket create failed for #${order.orderNumber}: ${msg}`);

      // If this order id already exists in Shiprocket (retry after partial success),
      // recover tracking instead of leaving the admin stuck.
      if (/already exists|duplicate/i.test(String(msg))) {
        const recovered = await findExistingShipment(token, String(order.orderNumber));
        if (recovered?.ok) return recovered;
      }

      return { ok: false, error: String(msg) };
    }

    let awb = extractAwb(data);
    const shipmentId = extractShipmentId(data);

    // Create order rarely returns AWB — must call assign/awb (and fallbacks)
    if (!awb && shipmentId) {
      awb = await assignAwbForShipment(token, shipmentId);
      if (!awb) {
        console.warn(
          `[courier] Order #${order.orderNumber} shipment ${shipmentId} created but AWB still missing after assign attempts`
        );
      }
    }
    console.log(
      `[courier] createShipment #${order.orderNumber} shipmentId=${shipmentId} awb=${awb || "none"} rawKeys=${Object.keys(data || {}).join(",")}`
    )

    const trackingId = awb || (shipmentId ? `SR-${shipmentId}` : null);
    const trackingUrl = awb
      ? `https://shiprocket.co/tracking/${awb}`
      : shipmentId
        ? `https://app.shiprocket.in/seller/orders/details/${shipmentId}`
        : null;

    if (!trackingId) {
      return {
        ok: false,
        error:
          data.message ||
          "Shiprocket accepted the request but returned no shipment/AWB id. Check pickup location name matches the Shiprocket dashboard exactly.",
      };
    }

    return {
      ok: true,
      trackingId: String(trackingId),
      trackingUrl,
      shipmentId: shipmentId ? String(shipmentId) : null,
      awb: awb ? String(awb) : null,
    };
  } catch (err) {
    console.error(`[courier] Failed to create shipment for #${order.orderNumber}:`, err.message);
    return { ok: false, error: err.message };
  }
}

export async function fetchTrackingStatus(awb) {
  if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) {
    return { skipped: true };
  }
  if (!awb) return { skipped: true };
  // Tracking by AWB — ignore internal SR-shipment ids
  if (String(awb).startsWith("SR-")) {
    return { ok: false, error: "No AWB yet — only internal Shiprocket shipment id stored" };
  }
  try {
    const token = await getAuthToken();
    const res = await fetch(`${SHIPROCKET_API_BASE}/courier/track/awb/${awb}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[courier] Tracking fetch failed (${res.status}) for AWB ${awb}: ${body}`);
      return { ok: false };
    }
    const data = await res.json();
    const currentStatus = data?.tracking_data?.shipment_track?.[0]?.current_status || "";
    const isDelivered = /delivered/i.test(currentStatus) && !/rto/i.test(currentStatus);
    return { ok: true, rawStatus: currentStatus, isDelivered };
  } catch (err) {
    console.error(`[courier] Failed to fetch tracking for AWB ${awb}:`, err.message);
    return { ok: false };
  }
}

/**
 * Cancel a Shiprocket shipment (or request cancel/RTO-side handling on their side).
 * Used when admin cancels a dispatched order mid-transit.
 * Tries AWB cancel first; falls back to Shiprocket numeric order/shipment id when we only stored SR-{id}.
 */
export async function cancelShipment({ awb, trackingId, orderNumber } = {}) {
  if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) {
    return {
      skipped: true,
      ok: false,
      error: "Shiprocket credentials not set — cancel the shipment manually in the Shiprocket dashboard.",
    };
  }

  const awbCode =
    (awb && !String(awb).startsWith("SR-") ? String(awb) : null) ||
    (trackingId && !String(trackingId).startsWith("SR-") ? String(trackingId) : null) ||
    null;

  const shipmentId =
    (trackingId && String(trackingId).startsWith("SR-")
      ? String(trackingId).replace(/^SR-/, "")
      : null) || null;

  try {
    const token = await getAuthToken();

    // 1) Preferred: cancel by AWB list
    if (awbCode) {
      const res = await fetch(`${SHIPROCKET_API_BASE}/orders/cancel/shipment/awbs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ awbs: [awbCode] }),
      });
      const bodyText = await res.text().catch(() => "");
      let data = {};
      try { data = bodyText ? JSON.parse(bodyText) : {}; } catch { data = { raw: bodyText }; }

      // Shiprocket often returns message / status even on partial success
      if (res.ok || data.status === 200 || /cancel|success|already/i.test(JSON.stringify(data))) {
        console.log(`[courier] Cancel AWB ${awbCode} for #${orderNumber}: ${bodyText.slice(0, 200)}`);
        return {
          ok: true,
          method: "awb",
          awb: awbCode,
          message: data.message || data.msg || "Cancellation requested on Shiprocket for this AWB.",
          raw: data,
        };
      }
      console.error(`[courier] AWB cancel failed for #${orderNumber}: ${bodyText.slice(0, 300)}`);
      return {
        ok: false,
        method: "awb",
        awb: awbCode,
        error: data.message || data.msg || bodyText.slice(0, 300) || `HTTP ${res.status}`,
      };
    }

    // 2) Fallback: cancel by Shiprocket ids (when we only have shipment id)
    if (shipmentId) {
      const res = await fetch(`${SHIPROCKET_API_BASE}/orders/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [Number(shipmentId) || shipmentId] }),
      });
      const bodyText = await res.text().catch(() => "");
      let data = {};
      try { data = bodyText ? JSON.parse(bodyText) : {}; } catch { data = { raw: bodyText }; }
      if (res.ok || /cancel|success|already/i.test(JSON.stringify(data))) {
        return {
          ok: true,
          method: "ids",
          shipmentId,
          message: data.message || "Cancellation requested on Shiprocket for this shipment id.",
          raw: data,
        };
      }
      return {
        ok: false,
        method: "ids",
        error: data.message || bodyText.slice(0, 300) || `HTTP ${res.status}`,
      };
    }

    return {
      ok: false,
      error: "No AWB or Shiprocket shipment id on this order — cancel manually in Shiprocket if a booking exists.",
    };
  } catch (err) {
    console.error(`[courier] cancelShipment failed for #${orderNumber}:`, err.message);
    return { ok: false, error: err.message };
  }
}
