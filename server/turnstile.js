/**
 * Cloudflare Turnstile server verification.
 * Site key is public (browser). Secret stays on Railway as TURNSTILE_SECRET_KEY.
 * If keys are missing, verification is skipped (dev / not yet configured) so
 * local work still works — production should always set both keys.
 */
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileConfigured() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim() && process.env.TURNSTILE_SITE_KEY?.trim());
}

export function getTurnstileSiteKey() {
  return process.env.TURNSTILE_SITE_KEY?.trim() || "";
}

/**
 * @param {string|undefined} token - cf-turnstile-response from the client
 * @param {string|undefined} remoteip - optional client IP
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function verifyTurnstileToken(token, remoteip) {
  if (!turnstileConfigured()) {
    // Not configured: allow through (dev). Log once-style soft skip.
    return { ok: true, skipped: true };
  }
  if (!token || typeof token !== "string" || token.length < 10) {
    return { ok: false, error: "Please complete the security check." };
  }
  try {
    const body = new URLSearchParams();
    body.set("secret", process.env.TURNSTILE_SECRET_KEY.trim());
    body.set("response", token);
    if (remoteip) body.set("remoteip", remoteip);

    const res = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (data.success) return { ok: true };
    return { ok: false, error: "Security check failed. Please try again." };
  } catch {
    return { ok: false, error: "Security check unavailable. Please try again in a moment." };
  }
}

/** Express middleware: expects body.turnstileToken */
export function requireTurnstile(req, res, next) {
  verifyTurnstileToken(req.body?.turnstileToken, req.ip)
    .then((r) => {
      if (!r.ok) return res.status(400).json({ error: r.error || "Security check failed." });
      next();
    })
    .catch(() => res.status(400).json({ error: "Security check failed." }));
}
