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

// HTML-escapes a value before it's interpolated into an email template.
// A genuinely different job from sanitize() (server/validate.js), which
// only strips literal <tag> patterns at INPUT time for storage — it
// doesn't escape &, ", or ' at all, so a contact-form message containing
// something like `" onmouseover="...` would pass through sanitize()
// completely unchanged. This escapes at the OUTPUT boundary instead,
// right where user-supplied text is about to become raw HTML — the
// right layer for this specific protection, independent of whatever
// sanitize() already did to the same value earlier in its life.
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

const emailWrapper = (bodyHtml, { preheader = "" } = {}) => `
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EEE6;margin:0;padding:24px 12px;font-family:Georgia,'Times New Roman',serif;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#E3DAC9;border:1px solid rgba(24,54,48,0.1);">
        <tr><td style="padding:28px 28px 12px;text-align:center;border-bottom:1px solid rgba(24,54,48,0.1);">
          <p style="margin:0;font-size:22px;letter-spacing:0.28em;color:#183630;font-weight:500;">ĀKĀRA</p>
          <p style="margin:8px 0 0;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#E5C690;font-family:Arial,sans-serif;">Artifacts for modern spaces</p>
        </td></tr>
        <tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif;color:#183630;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:20px 28px 28px;border-top:1px solid rgba(24,54,48,0.1);font-family:Arial,sans-serif;">
          <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:rgba(24,54,48,0.7);">Questions? Write to <a href="mailto:support@akaraonline.co.in" style="color:#183630;">support@akaraonline.co.in</a></p>
          <p style="margin:0;font-size:11px;line-height:1.5;color:rgba(24,54,48,0.5);">Precision Forge Labs · Thane, Maharashtra · <a href="https://www.akaraonline.co.in" style="color:rgba(24,54,48,0.6);">akaraonline.co.in</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>`;

// Real, defensive Array.isArray guard — every current real caller
// already passes a guaranteed-safe array (see toFrontendOrder/
// toAdminOrder/scheduler.js, all fixed as part of the same audit), but
// this is transactional email code; a malformed value reaching here
// should degrade to an empty item list, not crash the whole send.
const itemRows = (items) => (Array.isArray(items) ? items : []).map(i => {
  const variantSuffix = [i.colorLabel, i.size].filter(Boolean).map(escapeHtml).join(", ");
  return `<tr><td style="padding:8px 0;color:#183630;">${escapeHtml(i.name)}${variantSuffix ? " (" + variantSuffix + ")" : ""} × ${Number(i.qty)}</td>
   <td style="padding:8px 0;text-align:right;color:#183630;">₹${(i.price * i.qty).toLocaleString("en-IN")}</td></tr>`;
}).join("");

export async function sendOrderConfirmationEmail(order) {
  const pay = order.paymentStatus || order.payment_status || "";
  const payNote = String(pay).toLowerCase() === "cod"
    ? "Payment: Cash on delivery. Please keep the order total ready at delivery."
    : "Payment received. GST-inclusive totals appear on your invoice once available.";
  const html = emailWrapper(`
    <h1 style="font-size:24px;color:#183630;margin:0 0 10px;font-weight:normal;font-family:Georgia,serif;">Order confirmed</h1>
    <p style="font-size:14px;line-height:1.7;color:rgba(24,54,48,0.78);margin:0 0 8px;">Thank you — <strong style="color:#183630;">#${order.orderNumber}</strong> is with the studio.</p>
    <p style="font-size:13px;line-height:1.6;color:rgba(24,54,48,0.7);margin:0 0 20px;">Made-to-order pieces typically take <strong>2–3 weeks</strong> before dispatch. We’ll email you at each clear step.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">${itemRows(order.items)}</table>
    <p style="text-align:right;font-size:17px;color:#183630;margin:16px 0 8px;"><strong>Total: ₹${Number(order.total).toLocaleString("en-IN")}</strong></p>
    <p style="font-size:12px;color:rgba(24,54,48,0.65);margin:0 0 8px;">${payNote}</p>
    <p style="margin:24px 0 8px;text-align:center;"><a href="https://www.akaraonline.co.in/order-status" style="display:inline-block;background:#183630;color:#E3DAC9;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;padding:14px 28px;">Track your order</a></p>
  `, { preheader: `Order #${order.orderNumber} confirmed — ĀKĀRA` });
  return sendEmail({ to: order.email, subject: `Order confirmed — #${order.orderNumber} · ĀKĀRA`, html });
}

export async function sendOrderStatusEmail(order, newStatus) {
  const STATUS_COPY = {
    production: { title: "In production", body: "Your piece has entered production at the studio. We’ll write again when it reaches QC & packaging." },
    qc: { title: "QC & packaging", body: "Quality check is complete — your order is being packed for dispatch." },
    dispatched: { title: "On its way", body: "Your order has been handed to our delivery partner. Track progress anytime from your account." },
    delivered: { title: "Delivered", body: "Your order is marked delivered. We hope the piece finds its place — keep the care note that arrived with it." },
  };
  const copy = STATUS_COPY[newStatus];
  if (!copy) return { skipped: true };
  const html = emailWrapper(`
    <h1 style="font-size:24px;color:#183630;margin:0 0 10px;font-weight:normal;font-family:Georgia,serif;">${copy.title}</h1>
    <p style="font-size:14px;line-height:1.7;color:rgba(24,54,48,0.78);margin:0 0 12px;">${copy.body}</p>
    <p style="font-size:13px;color:rgba(24,54,48,0.6);margin:0 0 20px;">Order <strong style="color:#183630;">#${order.orderNumber}</strong></p>
    <p style="margin:8px 0;text-align:center;"><a href="https://www.akaraonline.co.in/order-status" style="display:inline-block;background:#183630;color:#E3DAC9;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;padding:14px 28px;">View order status</a></p>
  `, { preheader: `${copy.title} — #${order.orderNumber}` });
  return sendEmail({ to: order.email, subject: `${copy.title} · #${order.orderNumber} · ĀKĀRA`, html });
}

export async function sendOrderCancelledEmail(order, refundInfo = null) {
  const refundMessage = refundInfo?.success
    ? `Your payment of ₹${order.total.toLocaleString("en-IN")} has been refunded to your original payment method — it typically takes 5-7 business days to reflect.`
    : refundInfo?.attempted && !refundInfo.success
      ? "We're processing your refund manually and will confirm once it's complete."
      : "";
  const html = emailWrapper(`
    <h1 style="font-size:22px;color:#183630;margin:0 0 8px;">Order Cancelled</h1>
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
    <h1 style="font-size:22px;color:#183630;margin:0 0 8px;">${isSoldOut ? "Product Sold Out" : "Low Stock Alert"}</h1>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>${escapeHtml(product.name)}</strong> is now marked ${isSoldOut ? "sold out" : "low stock"} in the admin panel.</p>
  `);
  return sendEmail({ to, subject: `${isSoldOut ? "Sold Out" : "Low Stock"}: ${product.name}`, html });
}

// A gentle nudge for someone who reached checkout (a real order row
// exists, payment_status='pending') but never actually paid. Deliberately
// soft — no pressure tactics, no fake urgency — just a plain reminder
// with a direct way back in.
export async function sendAbandonedCheckoutEmail(order) {
  const html = emailWrapper(`
    <h1 style="font-size:24px;color:#183630;margin:0 0 10px;font-weight:normal;font-family:Georgia,serif;">Still in the atelier</h1>
    <p style="font-size:14px;line-height:1.7;color:rgba(24,54,48,0.78);margin:0 0 12px;">You started order <strong>#${order.orderNumber}</strong> but didn’t finish payment. Nothing has been charged.</p>
    <p style="font-size:13px;line-height:1.6;color:rgba(24,54,48,0.7);margin:0 0 20px;">Your selection is held only for a short while. Complete checkout when you’re ready — or ignore this note if you’ve changed your mind.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">${itemRows(order.items)}</table>
    <p style="text-align:right;font-size:17px;color:#183630;margin:16px 0 8px;"><strong>Total: ₹${Number(order.total).toLocaleString("en-IN")}</strong></p>
    <p style="margin:24px 0 8px;text-align:center;"><a href="https://www.akaraonline.co.in/checkout" style="display:inline-block;background:#183630;color:#E3DAC9;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;padding:14px 28px;">Return to checkout</a></p>
    <p style="font-size:12px;color:rgba(24,54,48,0.55);text-align:center;margin:0;">Prefer the full collection? <a href="https://www.akaraonline.co.in/shop" style="color:#183630;">Browse ĀKĀRA</a></p>
  `, { preheader: `Your ĀKĀRA selection is still waiting — nothing charged` });
  return sendEmail({ to: order.email, subject: `Your selection is waiting · ĀKĀRA`, html });
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
    <h1 style="font-size:22px;color:#183630;margin:0 0 8px;">New Contact Form Message</h1>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Phone:</strong> ${escapeHtml(phone)}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);margin-top:12px;"><strong>Message:</strong></p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);white-space:pre-wrap;">${escapeHtml(message)}</p>
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
    <h1 style="font-size:22px;color:#183630;margin:0 0 8px;">New Bulk / Corporate Order Enquiry</h1>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Company:</strong> ${company ? escapeHtml(company) : "—"}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Contact Name:</strong> ${escapeHtml(name)}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Phone:</strong> ${escapeHtml(phone)}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Estimated Quantity:</strong> ${escapeHtml(quantity)}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);"><strong>Product Interest:</strong> ${interest ? escapeHtml(interest) : "—"}</p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);margin-top:12px;"><strong>Message:</strong></p>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);white-space:pre-wrap;">${escapeHtml(message)}</p>
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
    <h1 style="font-size:24px;color:#183630;margin:0 0 10px;font-weight:normal;font-family:Georgia,serif;">Reset your password</h1>
    <p style="font-size:14px;line-height:1.7;color:rgba(24,54,48,0.78);margin:0 0 12px;">We received a request to reset the password for this ĀKĀRA account.</p>
    <p style="font-size:13px;line-height:1.6;color:rgba(24,54,48,0.7);margin:0 0 8px;">This link expires in <strong>1 hour</strong> and can be used once.</p>
    <p style="margin:28px 0 12px;text-align:center;"><a href="${resetLink}" style="display:inline-block;background:#183630;color:#E3DAC9;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;padding:14px 28px;">Choose a new password</a></p>
    <p style="font-size:12px;line-height:1.6;color:rgba(24,54,48,0.55);margin:0;">If you didn’t ask for this, ignore the email — your password stays the same.</p>
  `, { preheader: "Password reset link — expires in 1 hour" });
  return sendEmail({ to: email, subject: "Reset your ĀKĀRA password", html });
}

// Phone-change verification code, sent to the account's EXISTING email
// on file — not the new phone number being added (there's nothing to
// prove about the new phone via email; this delivers the code to a
// channel already tied to a genuinely logged-in customer). Switched
// from WhatsApp/Gupshup to email: the pre-approved Gupshup template
// turned out to require account-level authentication-messaging
// permissions this WABA doesn't currently have (a Gupshup/Meta account
// tier restriction, not something fixable in code) — email needed no
// new approval process at all since Resend was already fully working.
export async function sendPhoneChangeOTPEmail(email, otp) {
  const html = emailWrapper(`
    <h1 style="font-size:22px;color:#183630;margin:0 0 8px;">Verify your new phone number</h1>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);">Use this code to confirm the phone number change on your ĀKĀRA account. This code expires in 10 minutes.</p>
    <p style="margin:28px 0;font-size:32px;letter-spacing:0.15em;font-weight:700;color:#183630;">${otp}</p>
    <p style="font-size:12.5px;color:rgba(36,62,65,0.5);">If you didn't request this, you can safely ignore this email — your phone number won't be changed.</p>
  `);
  return sendEmail({ to: email, subject: `${otp} is your ĀKĀRA verification code`, html });
}

// Email-change verification — genuinely the opposite delivery pattern
// from phone-change above: THIS code goes to the NEW email address, not
// the account's existing one, since proving ownership of the new
// address is exactly the point (there's no separate channel like
// WhatsApp/SMS to lean on the way phone-change borrowed the existing
// email for). If someone else's real inbox receives this code, they
// simply have no reason to hand it back to a stranger — the code
// itself never proves anything until it's actually entered back into
// the logged-in customer's own session.
export async function sendEmailChangeOTPEmail(newEmail, otp) {
  const html = emailWrapper(`
    <h1 style="font-size:22px;color:#183630;margin:0 0 8px;">Verify your new email address</h1>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);">Use this code to confirm this email address should be used for your ĀKĀRA account. This code expires in 10 minutes.</p>
    <p style="margin:28px 0;font-size:32px;letter-spacing:0.15em;font-weight:700;color:#183630;">${otp}</p>
    <p style="font-size:12.5px;color:rgba(36,62,65,0.5);">If you didn't request this, you can safely ignore this email — no change will be made without this code.</p>
  `);
  return sendEmail({ to: newEmail, subject: `${otp} is your ĀKĀRA verification code`, html });
}

// Signup verification — sent to the email the customer just typed,
// BEFORE any account exists. This is the entire point of the feature:
// if they mistyped it, no code ever arrives and they simply can't get
// past the verification screen — they find out immediately, rather
// than a passive "click this link whenever" that a wrong address would
// just silently never receive at all.
export async function sendSignupOTPEmail(email, otp) {
  const html = emailWrapper(`
    <h1 style="font-size:22px;color:#183630;margin:0 0 8px;">Verify your email to finish creating your account</h1>
    <p style="font-size:14px;color:rgba(36,62,65,0.7);">Use this code to confirm your email address. This code expires in 10 minutes.</p>
    <p style="margin:28px 0;font-size:32px;letter-spacing:0.15em;font-weight:700;color:#183630;">${otp}</p>
    <p style="font-size:12.5px;color:rgba(36,62,65,0.5);">If you didn't try to create an ĀKĀRA account, you can safely ignore this email — nothing will be created without this code.</p>
  `);
  return sendEmail({ to: email, subject: `${otp} is your ĀKĀRA verification code`, html });
}

// Welcome email — fires once, right after the real customer row is
// actually created (i.e. after their OTP is confirmed correct), not at
// the moment they submit the signup form. This was a genuinely missing
// email before now — every other account/order milestone already sent
// one; signup itself never did.
export async function sendWelcomeEmail(email, name) {
  const first = escapeHtml((name || "there").split(" ")[0]);
  const html = emailWrapper(`
    <h1 style="font-size:24px;color:#183630;margin:0 0 10px;font-weight:normal;font-family:Georgia,serif;">Welcome, ${first}</h1>
    <p style="font-size:14px;line-height:1.7;color:rgba(24,54,48,0.78);margin:0 0 12px;">Your ĀKĀRA account is ready. Track orders, save addresses, and check out with less friction next time.</p>
    <p style="margin:24px 0 8px;text-align:center;"><a href="https://www.akaraonline.co.in/shop" style="display:inline-block;background:#183630;color:#E3DAC9;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;padding:14px 28px;">Explore the collection</a></p>
  `, { preheader: "Your ĀKĀRA account is ready" });
  return sendEmail({ to: email, subject: "Welcome to ĀKĀRA", html });
}
