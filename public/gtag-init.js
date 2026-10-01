/**
 * GA4 bootstrap — external file so CSP can omit script unsafe-inline.
 * Measurement ID: G-TBCH7JXTE9
 * send_page_view: false — SPA fires page_view on every client navigate() via trackAkara.
 *
 * Google Ads (optional): after you create a conversion action, set in HTML or console:
 *   window.__AKARA_ADS_SEND_TO = "AW-XXXXXXXXX/YYYYY";
 * purchase events will also fire conversion with that send_to.
 */
window.dataLayer = window.dataLayer || [];
function gtag(){ dataLayer.push(arguments); }
window.gtag = gtag;
gtag("js", new Date());
gtag("config", "G-TBCH7JXTE9", {
  send_page_view: false,
  anonymize_ip: true,
  cookie_flags: "SameSite=None;Secure",
});
/* Secondary Google tags if still configured in Tag Assistant */
try {
  gtag("config", "GT-TQS95GN4", { send_page_view: false });
  gtag("config", "GT-5MXXFXXN", { send_page_view: false });
} catch (e) { /* ignore */ }
