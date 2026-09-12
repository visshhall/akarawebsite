/* ĀKĀRA analytics bootstrap — external file so CSP can omit script unsafe-inline.
 * send_page_view: false — SPA fires page_view on every client navigate() via trackAkara.
 */
window.dataLayer = window.dataLayer || [];
function gtag(){ dataLayer.push(arguments); }
gtag("js", new Date());
gtag("config", "G-TBCH7JXTE9", { send_page_view: false, anonymize_ip: true });
/* Optional Google tags from Tag Manager / Ads — keep config only if still used */
gtag("config", "GT-TQS95GN4", { send_page_view: false });
gtag("config", "GT-5MXXFXXN", { send_page_view: false });
