# Deploy verify (after uploading this zip)

## On Railway
1. Upload/extract **full** project (replace old files).
2. Ensure start command still runs `npm run build` then `node server.js` (or your usual).
3. Env vars: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `GUPSHUP_*`, `GUPSHUP_TEMPLATE_SIGNUP_OTP`.

## After deploy — must pass

```bash
curl -s https://www.akaraonline.co.in/sw.js | head -5
# → SW_VERSION = "2026-09-10-final"

curl -s https://www.akaraonline.co.in/api/auth/turnstile-config
# → {"enabled":true,"siteKey":"..."}  (not "Not found")

curl -sI https://www.akaraonline.co.in/ | grep -i content-security
# → includes challenges.cloudflare.com
```

HTML script tag should show a **new** `/assets/index-XXXX.js` hash (not only `index-xwZgRV6K.js` from the old build).

Then hard-refresh browser / clear site data for old service worker.
