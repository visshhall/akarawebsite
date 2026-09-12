# Live smoke test (ĀKĀRA)

Run on **production** after deploy. ~15–20 minutes.

## Customer path
1. Home — hero photo + “Let there be form” readable on mobile & desktop
2. Shop → open one PDP — image/video not cropped oddly; price GST-inclusive
3. Add to cart → cart drawer qty + stock block if sold out
4. Checkout guest or logged-in — address edit works
5. COD or Razorpay test — confirmation page + email OTP path if new account
6. Track order — status appears after refresh (not blank forever)
7. Account — profile, addresses edit, wishlist, **Enable order notifications**

## Admin path
1. Login admin
2. Orders — open latest test order; status change
3. Dispatch → Shiprocket (if live) — AWB sync button
4. **Refund** modal — remaining balance chips; small partial refund on test paid order only
5. Hero image page loads; Room stories loads
6. Dashboard charts readable (Category mix text contrast)

## Pass / fail
Note date, browser, and any error. Fix blockers before ads traffic.
