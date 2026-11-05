/**
 * Block known disposable / temporary email domains.
 * Used after Google returns an email and on email signup — not a complete
 * global list, but stops the common “throwaway inbox” providers.
 */
const DISPOSABLE = new Set([
  "mailinator.com","guerrillamail.com","guerrillamail.de","guerrillamail.net",
  "guerrillamail.org","sharklasers.com","grr.la","guerrillamailblock.com",
  "pokemail.net","spam4.me","yopmail.com","yopmail.fr","cool.fr.nf","jetable.org",
  "trashmail.com","trashmail.me","trashmail.net","trash-mail.com","maildrop.cc",
  "discard.email","discardmail.com","throwawaymail.com","tempmail.com",
  "temp-mail.org","temp-mail.io","10minutemail.com","10minutemail.net",
  "10minemail.com","minutemail.com","getnada.com","emailondeck.com",
  "fakeinbox.com","mailnesia.com","mohmal.com","dispostable.com",
  "mailcatch.com","inboxkitten.com","mytemp.email","tmpmail.org","tmpmail.net",
  "tempail.com","tempr.email","discard.email","mailnull.com","spamgourmet.com",
  "mailforspam.com","spamex.com","bccto.me","chacuo.net","armyspy.com",
  "cuvox.de","dayrep.com","einrot.com","fleckens.hu","gustr.com","jourrapide.com",
  "rhyta.com","superrito.com","teleworm.us","getairmail.com","burnermail.io",
  "mailtemp.net","tempinbox.com","throwawayemailaddress.com","mailpoof.com",
  "spamobox.com","maildax.com","emailtmp.com","tempmailo.com","linshi-email.com",
  "1secmail.com","1secmail.org","1secmail.net","simplelogin.co","simplelogin.io",
  "anonaddy.com","anonaddy.me","relay.firefox.com",
]);

export function emailDomain(email) {
  const e = String(email || "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 0) return "";
  return e.slice(at + 1).replace(/^\.+/, "");
}

/** true if domain is a known disposable / temp mailbox provider */
export function isDisposableEmail(email) {
  const domain = emailDomain(email);
  if (!domain) return true;
  if (DISPOSABLE.has(domain)) return true;
  // Subdomains of known hosts (e.g. foo.yopmail.com)
  for (const d of DISPOSABLE) {
    if (domain.endsWith("." + d)) return true;
  }
  return false;
}

export function assertNotDisposableEmail(email) {
  if (isDisposableEmail(email)) {
    const err = new Error(
      "Please use a permanent email address (Gmail, Outlook, Yahoo, company mail, etc.). Temporary inboxes are not accepted."
    );
    err.code = "DISPOSABLE_EMAIL";
    throw err;
  }
}
