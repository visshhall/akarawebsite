// ============================================================================
// EMAIL — order confirmation, status update, and cancellation emails, sent
// via Resend (resend.com). Unlike Razorpay, this is treated as OPTIONAL
// infrastructure: if RESEND_API_KEY isn't set, every send function here
// logs a warning and returns quietly instead of throwing — orders,
// payments, and everything else must keep working even before email is
// configured. This matters because email is being added well after the
// core checkout flow already works in production; it should never become
// a new way for checkout to break.
//
// SETUP NEEDED (not done yet — see README): a Resend account, the sending
// domain (akaraonline.co.in) verified there via DNS records (SPF/DKIM,
// same kind of DNS work as the domain's own setup), and RESEND_API_KEY
// set in Railway. Until then, sends are silently skipped.
// ============================================================================

const RESEND_API_BASE = process.env.RESEND_API_BASE || "https://api.resend.com";
// Found during a live-site sweep: this defaulted to orders@akaraonline.co.in,
// which wasn't a real mailbox at the time — since fixed to a genuinely
// working one, now confirmed set up in Zoho. Still overridable via
// EMAIL_FROM in Railway without needing a code change.
const FROM_ADDRESS = process.env.EMAIL_FROM || "ĀKĀRA <order@akaraonline.co.in>";

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY not set — skipped "${subject}" to ${to}`);
    return { skipped: true };
  }
  try {
    const res = await fetch(`${RESEND_API_BASE}/emails`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] Resend API error ${res.status} sending "${subject}" to ${to}: ${body}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    // A failed email must never break the order flow that triggered it —
    // every caller of these functions treats this as fire-and-forget.
    console.error(`[email] Failed to send "${subject}" to ${to}:`, err.message);
    return { ok: false };
  }
}

const emailWrapper = (bodyHtml) => `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#FFF2DF;">
    <p style="font-size:20px;font-style:italic;color:#243E41;margin:0 0 24px;">ĀKĀRA</p>
    ${bodyHtml}
    <p style="font-size:12px;color:rgba(36,62,65,0.5);margin-top:32px;border-top:1px solid rgba(36,62,65,0.15);padding-top:16px;">
      Precision Forge Labs · Thane, Maharashtra · support@akaraonline.co.in
    </p>
  </div>`;

const itemRows = (items) => items.map(i =>
  `<tr><td style="padding:8px 0;color:#243E41;">${i.name}${i.size ? " (" + i.size + ")" : ""} × ${i.qty}</td>
   <td style="padding:8px 0;text-align:right;color:#243E41;">₹${(i.price * i.qty).toLocaleString("en-IN")}</td></tr>`
).join("");

export async function sendOrderConfirmationEmail(order) {
  const html = emailWrapper(`
    <h1 style="font-size:22px;color:#243E41;margin:0 0 8px;">Order Confirmed</h1>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);margin:0 0 24px;">Thank you — order #${order.orderNumber} is confirmed and now in production.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">${itemRows(order.items)}</table>
    <p style="text-align:right;font-size:16px;color:#243E41;margin-top:16px;"><strong>Total: ₹${order.total.toLocaleString("en-IN")}</strong></p>
    <p style="font-size:13px;color:rgba(36,62,65,0.6);margin-top:24px;">Made-to-order pieces typically take 2–3 weeks. We'll email you again once it ships.</p>
  `);
  return sendEmail({ to: order.email, subject: `Order Confirmed — #${order.orderNumber}`, html });
}

export async function sendOrderStatusEmail(order, newStatus) {
  const STATUS_COPY = {
    production: "Your order has entered production.",
    qc: "Your order has passed quality check and is being prepared for dispatch.",
    dispatched: "Your order has been dispatched and is on its way.",
    delivered: "Your order has been delivered — we hope you love it.",
  };
  const message = STATUS_COPY[newStatus];
  if (!message) return { skipped: true }; // no email for internal-only statuses like 'confirmed'
  const html = emailWrapper(`
    <h1 style="font-size:22px;color:#243E41;margin:0 0 8px;">Order Update</h1>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);">${message}</p>
    <p style="font-size:13px;color:rgba(36,62,65,0.5);margin-top:16px;">Order #${order.orderNumber}</p>
  `);
  return sendEmail({ to: order.email, subject: `Order #${order.orderNumber} — ${newStatus[0].toUpperCase() + newStatus.slice(1)}`, html });
}

export async function sendOrderCancelledEmail(order, refundInfo = null) {
  const refundMessage = refundInfo?.success
    ? `Your payment of ₹${order.total.toLocaleString("en-IN")} has been refunded to your original payment method — it typically takes 5-7 business days to reflect.`
    : refundInfo?.attempted && !refundInfo.success
      ? "We're processing your refund manually and will confirm once it's complete."
      : "";
  const html = emailWrapper(`
    <h1 style="font-size:22px;color:#243E41;margin:0 0 8px;">Order Cancelled</h1>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);">Order #${order.orderNumber} has been cancelled.${refundMessage ? " " + refundMessage : ""}</p>
  `);
  return sendEmail({ to: order.email, subject: `Order #${order.orderNumber} — Cancelled`, html });
}

// Alerts the business owner (not a customer) the moment a product
// actually TRANSITIONS into low-stock or sold-out — never repeated on
// every subsequent save while it stays in that state, which would just
// become noise. Sent to ALERT_EMAIL if set, falling back to the
// business's own support address so this works with zero extra setup.
export async function sendLowStockAlertEmail(product) {
  const to = process.env.ALERT_EMAIL || "support@akaraonline.co.in";
  const isSoldOut = product.status === "sold-out";
  const html = emailWrapper(`
    <h1 style="font-size:22px;color:#243E41;margin:0 0 8px;">${isSoldOut ? "Product Sold Out" : "Low Stock Alert"}</h1>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>${product.name}</strong> is now marked ${isSoldOut ? "sold out" : "low stock"} in the admin panel.</p>
  `);
  return sendEmail({ to, subject: `${isSoldOut ? "Sold Out" : "Low Stock"}: ${product.name}`, html });
}

// A gentle nudge for someone who reached checkout (a real order row
// exists, payment_status='pending') but never actually paid. Deliberately
// soft — no pressure tactics, no fake urgency — just a plain reminder
// with a direct way back in.
export async function sendAbandonedCheckoutEmail(order) {
  const html = emailWrapper(`
    <h1 style="font-size:22px;color:#243E41;margin:0 0 8px;">You left something behind</h1>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);margin:0 0 20px;">Your order #${order.orderNumber} is still waiting — nothing's been charged yet.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">${itemRows(order.items)}</table>
    <p style="text-align:right;font-size:16px;color:#243E41;margin-top:16px;"><strong>Total: ₹${order.total.toLocaleString("en-IN")}</strong></p>
    <p style="margin-top:24px;"><a href="https://www.akaraonline.co.in/checkout" style="display:inline-block;background:#243E41;color:#FFF2DF;padding:12px 24px;text-decoration:none;font-size:13px;">Complete Your Order</a></p>
  `);
  return sendEmail({ to: order.email, subject: "Still interested? Your ĀKĀRA order is waiting", html });
}

// Notifies the business the moment a Contact form message actually comes
// in — found and fixed alongside the Contact page's missing phone field:
// the form previously had no backend at all, so a message being
// submitted was never actually seen by anyone. Sent to the business
// itself, not the customer — this is an internal alert, not a customer
// confirmation (the customer's confirmation is the "message sent" state
// shown directly on the page after a successful submit).
export async function sendContactNotificationEmail({ name, email, phone, message }) {
  const html = emailWrapper(`
    <h1 style="font-size:22px;color:#243E41;margin:0 0 8px;">New Contact Form Message</h1>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Name:</strong> ${name}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Email:</strong> ${email}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Phone:</strong> ${phone}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);margin-top:12px;"><strong>Message:</strong></p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);white-space:pre-wrap;">${message}</p>
  `);
  return sendEmail({ to: "support@akaraonline.co.in", subject: `New contact form message from ${name}`, html });
}

// Found this form was still using a raw mailto: link — same broken
// pattern the Contact form had before it was fixed, and worse on a
// phone with no email client configured, where clicking Submit did
// nothing visible at all. Sent to info@, not support@ — matching what
// the original mailto link already correctly used, since this is a
// business/wholesale enquiry, not a general support message.
export async function sendBulkOrderNotificationEmail({ company, name, email, phone, quantity, interest, message }) {
  const html = emailWrapper(`
    <h1 style="font-size:22px;color:#243E41;margin:0 0 8px;">New Bulk / Corporate Order Enquiry</h1>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Company:</strong> ${company || "—"}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Contact Name:</strong> ${name}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Email:</strong> ${email}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Phone:</strong> ${phone}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Estimated Quantity:</strong> ${quantity}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Product Interest:</strong> ${interest || "—"}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);margin-top:12px;"><strong>Message:</strong></p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);white-space:pre-wrap;">${message}</p>
  `);
  return sendEmail({ to: "info@akaraonline.co.in", subject: `Bulk / Corporate Order Enquiry — ${company || name}`, html });
}

// Found the entire forgot/reset-password flow was completely fake end to
// end — this is the missing piece that actually sends something. The
// link embeds the real, single-use token in cleartext (this is the one
// and only place it's ever transmitted unhashed) — the database only
// ever stores a hash of it, matching how password_hash itself works.
export async function sendPasswordResetEmail(email, resetLink) {
  const html = emailWrapper(`
    <h1 style="font-size:22px;color:#243E41;margin:0 0 8px;">Reset your password</h1>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);">We received a request to reset the password for this account. This link expires in 1 hour and can only be used once.</p>
    <p style="margin:28px 0;"><a href="${resetLink}" style="display:inline-block;background:#243E41;color:#FFF2DF;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;padding:14px 28px;text-decoration:none;">Reset Password</a></p>
    <p style="font-size:12.5px;color:rgba(36,62,65,0.5);">If you didn't request this, you can safely ignore this email — your password won't be changed.</p>
  `);
  return sendEmail({ to: email, subject: "Reset your ĀKĀRA password", html });
}
