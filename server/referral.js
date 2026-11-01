/**
 * Referral programme — invite a friend for 5% off their first order;
 * referrer receives a one-time 5% thank-you coupon after that order is placed.
 */
import crypto from "crypto";
import { query } from "./db.js";

export const REFERRAL_DISCOUNT_PERCENT = 5;

export function generateReferralCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let body = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) body += alphabet[bytes[i] % alphabet.length];
  return `AKR${body}`;
}

/** Ensure customer has a unique referral_code; returns it. */
export async function ensureReferralCode(customerId) {
  const { rows } = await query(
    `SELECT referral_code FROM customers WHERE id=$1`,
    [customerId]
  );
  if (!rows.length) return null;
  if (rows[0].referral_code) return rows[0].referral_code;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateReferralCode();
    try {
      const upd = await query(
        `UPDATE customers SET referral_code=$1 WHERE id=$2 AND referral_code IS NULL RETURNING referral_code`,
        [code, customerId]
      );
      if (upd.rows[0]?.referral_code) return upd.rows[0].referral_code;
    } catch (err) {
      if (err?.code === "23505") continue;
      throw err;
    }
  }
  const fallback = `AKR${String(customerId).padStart(6, "0")}`.slice(0, 12);
  await query(`UPDATE customers SET referral_code=$1 WHERE id=$2 AND referral_code IS NULL`, [fallback, customerId]);
  const again = await query(`SELECT referral_code FROM customers WHERE id=$1`, [customerId]);
  return again.rows[0]?.referral_code || null;
}

/**
 * Resolve a typed code as a friend-referral (not a marketing coupon).
 * Returns same shape as lookupCoupon extras, or null.
 */
export async function lookupReferralAsCoupon(rawCode, customerId, identity = {}) {
  if (!customerId || !rawCode) return null;
  const code = String(rawCode).trim().toUpperCase();
  if (!code || code.length < 4) return null;

  const { rows: owners } = await query(
    `SELECT id, name, referral_code FROM customers WHERE upper(referral_code)=$1 LIMIT 1`,
    [code]
  );
  if (!owners.length) return null;
  const referrer = owners[0];
  if (Number(referrer.id) === Number(customerId)) return null; // self

  // Referee already used a referral
  const { rows: prior } = await query(
    `SELECT id FROM referral_redemptions WHERE referee_id=$1 LIMIT 1`,
    [customerId]
  );
  if (prior.length) return null;

  // First completed/paid-ish order only — same spirit as first_order_only
  const { rows: orderCount } = await query(
    `SELECT COUNT(*)::int AS n FROM orders
     WHERE customer_id=$1
       AND coalesce(lower(status),'') NOT IN ('cancelled','canceled')`,
    [customerId]
  );
  if (Number(orderCount[0]?.n || 0) > 0) return null;

  // Archive / re-register abuse: email or phone already ordered under another account
  const email = String(identity.email || "").trim().toLowerCase();
  const phone = String(identity.phone || "").replace(/\D/g, "");
  if (email) {
    const { rows: arch } = await query(
      `SELECT 1 FROM deleted_customer_archives WHERE lower(email)=$1 LIMIT 1`,
      [email]
    ).catch(() => ({ rows: [] }));
    if (arch?.length) return null;
  }

  return {
    code: referrer.referral_code,
    discountPercent: REFERRAL_DISCOUNT_PERCENT,
    maxDiscountAmount: null,
    minOrderAmount: null,
    firstOrderOnly: true,
    onePerCustomer: true,
    isReferral: true,
    referrerId: referrer.id,
  };
}

/** After order is created with a referral coupon — record + issue referrer reward code. */
export async function completeReferralOnOrder({
  refereeId,
  referrerId,
  orderId,
  orderNumber,
  refereeDiscount = 0,
}) {
  if (!refereeId || !referrerId || Number(refereeId) === Number(referrerId)) return null;

  const rewardCode = `THANK${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  try {
    await query(
      `INSERT INTO coupons (code, discount_percent, active, one_per_customer, first_order_only, max_redemptions, label)
       VALUES ($1, $2, true, true, false, 1, $3)
       ON CONFLICT (code) DO NOTHING`,
      [rewardCode, REFERRAL_DISCOUNT_PERCENT, "Referral thank-you — 5% off one order"]
    );
  } catch (err) {
    console.warn("[referral] reward coupon insert", err?.message || err);
  }

  try {
    await query(
      `INSERT INTO referral_redemptions (referrer_id, referee_id, order_id, order_number, referee_discount, referrer_reward_code)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (referee_id) DO NOTHING`,
      [referrerId, refereeId, orderId || null, orderNumber || null, refereeDiscount || 0, rewardCode]
    );
  } catch (err) {
    console.warn("[referral] redemption insert", err?.message || err);
    return null;
  }

  await query(
    `UPDATE customers SET referred_by_customer_id=$1 WHERE id=$2 AND referred_by_customer_id IS NULL`,
    [referrerId, refereeId]
  ).catch(() => {});

  return rewardCode;
}

export async function getReferralSummary(customerId) {
  const code = await ensureReferralCode(customerId);
  const { rows: redeemed } = await query(
    `SELECT order_number, referrer_reward_code, created_at, referee_discount
     FROM referral_redemptions WHERE referrer_id=$1 ORDER BY created_at DESC LIMIT 20`,
    [customerId]
  );
  // Rewards issued to this customer as referrer that they can still use
  const rewardCodes = redeemed.map((r) => r.referrer_reward_code).filter(Boolean);
  let availableRewards = [];
  if (rewardCodes.length) {
    const { rows: coupons } = await query(
      `SELECT code, discount_percent, max_redemptions,
              (SELECT COUNT(*)::int FROM orders WHERE upper(coupon_code)=upper(c.code) AND coalesce(lower(status),'') NOT IN ('cancelled','canceled')) AS uses
       FROM coupons c WHERE upper(code) = ANY($1::text[]) AND active=true`,
      [rewardCodes.map((c) => c.toUpperCase())]
    ).catch(() => ({ rows: [] }));
    availableRewards = (coupons || []).filter((c) => {
      const max = c.max_redemptions != null ? Number(c.max_redemptions) : null;
      if (max != null && Number(c.uses || 0) >= max) return false;
      return true;
    }).map((c) => ({ code: c.code, discountPercent: c.discount_percent }));
  }
  return {
    code,
    discountPercent: REFERRAL_DISCOUNT_PERCENT,
    sharePath: code ? `/?ref=${encodeURIComponent(code)}` : null,
    friendsReferred: redeemed.length,
    history: redeemed.map((r) => ({
      orderNumber: r.order_number,
      rewardCode: r.referrer_reward_code,
      at: r.created_at,
    })),
    availableRewards,
  };
}
