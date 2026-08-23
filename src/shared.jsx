// ============================================================================
// SHARED — design tokens, CSRF/fetch helpers, and UI primitives used by
// BOTH AkaraApp.jsx (customer-facing site) and AdminApp.jsx (admin panel).
// Pulled into its own module specifically so AdminApp.jsx doesn't need to
// import from AkaraApp.jsx directly (which would create a circular import,
// since AkaraApp.jsx dynamically imports AdminApp.jsx — see the root
// export in AkaraApp.jsx for why that split exists: keeping recharts and
// the whole admin panel out of the bundle every regular customer downloads).
// ============================================================================
import { useState, useEffect, useContext, createContext, useCallback } from "react";
import { Eye, EyeOff, AlertCircle, CheckCircle2, XCircle, Info, X, Inbox } from "lucide-react";

// ============================================================================
// DESIGN TOKENS — locked brand palette (confirmed): exactly 3 core colors,
// no substitutes. `card` is deliberately the SAME value as `cream` — card
// surfaces are differentiated from the page by elevation (shadow), never by
// a separate background color, per the "only 3 colors" mandate. Status
// colors (success/warning/error) are a necessary utility exception — sold
// out vs. paid vs. pending genuinely can't be told apart with only 3 colors
// — but are confined strictly to status badges/validation messages, chosen
// to sit in the same muted, earthy register as the brand palette rather
// than generic stoplight red/green/yellow.
export const T = {
  cream: "#FFF2DF", card: "#FFF2DF",
  teal: "#243E41",
  gold: "#B8935A",
  success: "#3B6E52", warning: "#B5651D", error: "#A83B32",
};

// Elevation system — 5 levels, used consistently instead of ad-hoc shadow
// values per component. "Raised" is the default card/panel treatment
// site-wide (replaces the old flat hairline-border card look).
export const ELEVATION = {
  flat: "none",
  // "raised" used to rely on background-color alone plus a very soft
  // shadow for definition — invisible in practice, since every card's
  // background is the exact same cream as the page behind it. The
  // leading "0 0 0 1px" segment is a border simulated via box-shadow
  // (lets this stay one CSS property, cascading to every card that
  // already references ELEVATION.raised — 20+ places — without needing
  // to touch each one individually), stacked with the original soft
  // shadow for depth.
  raised: "0 0 0 1px rgba(36,62,65,0.09), 0 4px 16px -8px rgba(36,62,65,0.15)",
  hover: "0 0 0 1px rgba(36,62,65,0.09), 0 12px 28px -10px rgba(36,62,65,0.22)",
  modal: "0 24px 60px -20px rgba(36,62,65,0.35)",
  popover: "0 8px 24px -8px rgba(36,62,65,0.2)",
};

// Radius scale — fixed set, mapped by use: 4=badges/tags, 8=buttons/inputs,
// 12-16=cards, 24=hero/feature blocks. Avoids picking a new radius value
// per component.
export const RADIUS = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

// Icon sizing — fixed set only (16/20/24px), replacing today's scattered
// 13-21px sizes across the app.
export const ICON = { sm: 16, md: 20, lg: 24 };

// Global CSS injected once via <style>{FONTS}</style> in AkaraApp's root
// export. Bundles: (1) Google Fonts import — Fraunces = display serif,
// Space Grotesk = body/UI, (2) print stylesheet — hides header/footer/nav
// (.no-print) so only the invoice itself prints when a customer downloads
// it, (3) accessibility — visible gold focus-visible outline sitewide,
// (4) prefers-reduced-motion support + the page-transition fade-in class
// used on <main> (keyed by view, so it replays on every navigation).
export const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Space+Grotesk:wght@300;400;500;600&display=swap');
@media print {
  .no-print { display:none !important; }
  body, .invoice-print-area { background:white !important; }
  .invoice-print-area { box-shadow:none !important; }
}
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(184,147,90,0.32);
}
:focus:not(:focus-visible) {
  outline: none;
  box-shadow: none;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
.skip-link {
  position: absolute;
  left: -9999px;
  top: 0;
  z-index: 100;
  background: #243E41;
  color: white;
  padding: 12px 20px;
  font-size: 13px;
  text-decoration: none;
}
.skip-link:focus {
  left: 12px;
  top: 12px;
}
.akara-page-enter {
  animation: akaraFadeIn 0.35s ease-out;
}
@keyframes akaraFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
/* Hides the native scrollbar UI on horizontally-scrollable rows (like the
   My Account tab strip) while keeping actual touch/drag scrolling intact
   — some browser/OS combinations render small clickable up/down arrow
   controls for a scrollable region by default, which reads as a stray,
   unexplained UI element rather than an intentional part of the design. */
.akara-no-scrollbar {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.akara-no-scrollbar::-webkit-scrollbar {
  display: none;
}
/* Splash/loading screen — the moment before real product data has
   arrived, redesigned to feel like a deliberate first impression rather
   than an accident of "something has to render here". The gold line
   draws in first (evoking precision/craft — fitting for a brand whose
   whole story is made-to-order, not pulled off a shelf), then each
   letter of the wordmark rises in with a small stagger, then the
   tagline settles in last. The existing global prefers-reduced-motion
   rule above already handles accessibility for these — no separate
   override needed here. */
@keyframes akaraSplashLine { from { width:0; opacity:0; } to { width:56px; opacity:1; } }
@keyframes akaraSplashLetter { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
@keyframes akaraSplashTagline { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
.akara-splash-line { height:1px; animation:akaraSplashLine 0.7s cubic-bezier(0.22,1,0.36,1) forwards; }
.akara-splash-letter { display:inline-block; opacity:0; animation:akaraSplashLetter 0.6s cubic-bezier(0.22,1,0.36,1) forwards; }
.akara-splash-tagline { opacity:0; animation:akaraSplashTagline 0.6s ease-out 0.85s forwards; }
`;

// Strips HTML tags and caps length. Applied to every text input's value
// before it's stored/displayed — defense in depth even though React
// already escapes JSX text content by default.
export const sanitize = (str = "") => String(str).replace(/<[^>]*>/g, "").slice(0, 500);

// ============================================================================
// CSRF TOKEN HANDLING — every POST/PUT/DELETE to the backend must include
// this token in an X-CSRF-Token header (see server/csrf.js for why). Cached
// after the first fetch so subsequent submissions don't need to re-fetch it.
// ============================================================================
let cachedCsrfToken = null;
export async function getCsrfToken(){
  if(cachedCsrfToken) return cachedCsrfToken;
  const res = await fetch("/api/csrf-token",{credentials:"include"});
  const data = await res.json();
  cachedCsrfToken = data.csrfToken;
  return cachedCsrfToken;
}
// Wraps fetch for any state-changing API call — attaches the CSRF token
// and always sends cookies. Use this instead of raw fetch() for any
// POST/PUT/PATCH/DELETE to /api/...; GET requests don't need it.
export async function apiFetch(url, options={}){
  const token = await getCsrfToken();
  return fetch(url,{
    ...options,
    credentials:"include",
    headers:{ ...(options.headers||{}), "X-CSRF-Token":token },
  });
}

// ============================================================================
// SHARED UI PRIMITIVES
// ============================================================================
// The brand's signature typographic detail: draws the macron (the line
// above the "A") in ĀKĀRA via a CSS-positioned <span>, not the Unicode
// character (renders inconsistently across fonts/browsers). Usage:
// <Mac>A</Mac>.
export function Mac({ children }) {
  // Both values are em-based (not fixed px) specifically so this scales
  // correctly across every size this gets used at — from the ~20px header
  // wordmark down to ~11-12px eyebrow text. A fixed pixel offset looks
  // right at one size and visibly too close to the letter at smaller
  // ones, since the same offset becomes a much larger proportion of a
  // smaller letter's height. Confirmed via direct visual comparison
  // between the header and an About-page eyebrow instance before fixing.
  return <span className="relative inline-block leading-none">
    <span className="absolute left-[5%] right-[5%] bg-current" style={{ height:"0.09em", top:"-0.16em" }}/>
    {children}
  </span>;
}

// The standard button used sitewide: outline with a teal fill-sweep on
// hover, or `filled` for solid-teal primary actions.
export function SweepButton({ children, filled=false, onClick, className="", disabled=false, type="button" }) {
  return <button type={type} onClick={onClick} disabled={disabled}
    className={`group relative isolate overflow-hidden px-8 py-4 text-[11px] tracking-[0.18em] uppercase font-medium transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed ${filled?"hover:brightness-110 active:brightness-95":""} ${className}`}
    style={filled ? { backgroundColor:T.teal, color:"white", borderRadius:RADIUS.sm } : { color:T.teal, border:"1px solid rgba(36,62,65,0.22)", borderRadius:RADIUS.sm }}>
    {!filled && !disabled && <span className="absolute inset-0 -z-10 origin-left scale-x-0 transition-transform duration-500 ease-out group-hover:scale-x-100" style={{ backgroundColor:T.teal }}/>}
    <span className={`relative z-10 transition-colors duration-300 ${!filled?"group-hover:text-white":""}`}>{children}</span>
  </button>;
}

// Small, dependency-free Levenshtein (edit) distance — how many
// single-character insertions/deletions/substitutions turn one string
// into another. Used below to catch near-miss email domain typos.
function editDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  }
  return dp[m][n];
}

// Common email providers — deliberately NOT an exhaustive/"allowed"
// list (that would incorrectly flag real custom domains as wrong). Only
// used to catch near-miss typos of THESE specific well-known ones, e.g.
// "gmol.com" -> suggest "gmail.com". A domain that isn't close to any of
// these is simply left alone — most real emails aren't on this list at
// all, and that's fine.
const COMMON_EMAIL_DOMAINS = ["gmail.com","yahoo.com","outlook.com","hotmail.com","icloud.com","live.com","rediffmail.com","yahoo.co.in","outlook.in","protonmail.com"];

// Suggests a likely-intended domain for a probable typo — e.g. "gmol.com"
// or "gmial.com" -> "gmail.com". Returns null when the email is
// incomplete, already matches a known domain exactly, or isn't close
// enough to any of them to be confident it's a typo rather than a real,
// different domain.
export function suggestEmailCorrection(email) {
  const at = email.lastIndexOf("@");
  if (at === -1 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).toLowerCase();
  if (COMMON_EMAIL_DOMAINS.includes(domain)) return null;
  for (const known of COMMON_EMAIL_DOMAINS) {
    const dist = editDistance(domain, known);
    // Distance 1-2 only — close enough to plausibly be a typo of this
    // specific domain, far enough that a genuinely different real domain
    // (e.g. a company's own) won't accidentally match one.
    if (dist >= 1 && dist <= 2) return email.slice(0, at + 1) + known;
  }
  return null;
}

// The standard text input used on every form.
export function InputField({ label, type="text", value, onChange, error, placeholder, maxLength=200, required }) {
  const [show, setShow] = useState(false);
  const isPass = type === "password";
  // Applies to every email field site-wide from this one place — found
  // worth adding after "gmol.com" was accepted without any hint it was
  // likely a typo of "gmail.com". Deliberately a dismissible suggestion,
  // not a hard block: shape-valid, uncommon-but-real domains must still
  // be allowed through.
  const suggestion = type === "email" ? suggestEmailCorrection(value) : null;
  return <div>
    <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{ color:"rgba(36,62,65,0.55)" }}>{label}{required && " *"}</label>
    <div className="relative">
      <input type={isPass?(show?"text":"password"):type} value={value}
        onChange={e => onChange(sanitize(e.target.value))} placeholder={placeholder} maxLength={maxLength}
        autoComplete={isPass?"current-password":type==="email"?"email":"off"}
        className="w-full bg-transparent outline-none text-[14px] pr-10"
        style={{ border:`1px solid ${error?T.error:"rgba(36,62,65,0.22)"}`, padding:"13px 14px", color:T.teal, fontFamily:"'Space Grotesk',sans-serif", borderRadius:RADIUS.xs }}/>
      {isPass && <button type="button" onClick={()=>setShow(s=>!s)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color:"rgba(36,62,65,0.4)" }}>{show?<EyeOff size={15}/>:<Eye size={15}/>}</button>}
    </div>
    {error && <p className="text-[11.5px] mt-1.5 flex items-center gap-1" style={{ color:T.error }}><AlertCircle size={12}/>{error}</p>}
    {!error && suggestion && <button type="button" onClick={()=>onChange(suggestion)} className="text-[11.5px] mt-1.5" style={{ color:T.gold }}>Did you mean <span style={{textDecoration:"underline"}}>{suggestion}</span>?</button>}
  </div>;
}

// ============================================================================
// TOAST — replaces every silent/no-feedback action across the app (admin
// saves, deletes, status changes previously gave zero acknowledgment).
// Usage: wrap a tree in <ToastProvider>, then call useToast() anywhere
// inside it to get showToast(message, type). type is "success"|"error"|
// "info" (default "success") — maps to the locked status-color palette.
// ============================================================================
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const showToast = useCallback((message, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }, []);
  const iconFor = { success: CheckCircle2, error: XCircle, info: Info };
  const colorFor = { success: T.success, error: T.error, info: T.teal };
  return <ToastContext.Provider value={showToast}>
    {children}
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map(t => {
        const Icon = iconFor[t.type] || CheckCircle2;
        return <div key={t.id} className="flex items-center gap-2.5 px-5 py-3.5 text-[13.5px]"
          style={{ backgroundColor: T.teal, color: "white", borderRadius: RADIUS.sm, boxShadow: ELEVATION.modal, borderLeft: `3px solid ${colorFor[t.type] || T.gold}` }}>
          <Icon size={ICON.sm} style={{ color: colorFor[t.type] || T.gold, flexShrink: 0 }}/>
          {t.message}
        </div>;
      })}
    </div>
  </ToastContext.Provider>;
}
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() must be called inside a <ToastProvider>");
  return ctx;
}

// ============================================================================
// MODAL — replaces the raw browser confirm() popup (admin's delete-product
// action used this). A real on-brand confirmation dialog: overlay + centered
// card, Escape/overlay-click to dismiss.
// ============================================================================
export function Modal({ open, onClose, title, children, danger=false, confirmLabel="Confirm", onConfirm, cancelLabel="Cancel" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[300] flex items-center justify-center px-6" style={{ backgroundColor: "rgba(36,62,65,0.45)" }} onClick={onClose}>
    <div className="w-full max-w-[400px] p-7" style={{ backgroundColor: T.card, borderRadius: RADIUS.md, boxShadow: ELEVATION.modal }} onClick={e => e.stopPropagation()}>
      {title && <h2 className="text-[17px] mb-3" style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", color: T.teal }}>{title}</h2>}
      <div className="text-[14px] mb-7" style={{ color: "rgba(36,62,65,0.7)", lineHeight: 1.6 }}>{children}</div>
      <div className="flex gap-3 justify-end">
        {/* onConfirm is awaited, and returning `false` from it keeps the
            modal open — found necessary while adding cancellation-reason
            validation: the previous version always closed immediately
            after calling onConfirm, regardless of whether validation
            inside it decided to block the action, silently discarding
            whatever the user had filled in. Every other existing use of
            this Modal is unaffected — they don't return false, so they
            still close exactly as before. */}
        <button onClick={onClose} className="px-5 py-2.5 text-[12px] tracking-[0.08em] uppercase" style={{ color: T.teal, border: `1px solid rgba(36,62,65,0.22)`, borderRadius: RADIUS.sm }}>{cancelLabel}</button>
        <button onClick={async () => { const result = await onConfirm?.(); if (result !== false) onClose(); }} className="px-5 py-2.5 text-[12px] tracking-[0.08em] uppercase text-white" style={{ backgroundColor: danger ? T.error : T.teal, borderRadius: RADIUS.sm }}>{confirmLabel}</button>
      </div>
    </div>
  </div>;
}

// ============================================================================
// SKELETON — replaces every plain "Loading…" text label with a soft
// pulsing placeholder shaped like the content that's about to arrive.
// ============================================================================
export function Skeleton({ width="100%", height=16, radius=RADIUS.xs, className="" }) {
  return <div className={`animate-pulse ${className}`} style={{ width, height, borderRadius: radius, backgroundColor: "rgba(36,62,65,0.08)" }}/>;
}

// ============================================================================
// EMPTY STATE — replaces plain gray "No orders yet" style text scattered
// around the app with a consistent icon + message + optional action pattern.
// ============================================================================
export function EmptyState({ icon: Icon = Inbox, title, message, actionLabel, onAction }) {
  return <div className="flex flex-col items-center text-center py-16 px-6">
    <div className="w-14 h-14 flex items-center justify-center mb-5" style={{ backgroundColor: "rgba(36,62,65,0.05)", borderRadius: RADIUS.lg }}>
      <Icon size={ICON.lg} style={{ color: "rgba(36,62,65,0.35)" }}/>
    </div>
    {title && <p className="text-[16px] mb-1.5" style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", color: T.teal }}>{title}</p>}
    {message && <p className="text-[13.5px] mb-6 max-w-[320px]" style={{ color: "rgba(36,62,65,0.5)" }}>{message}</p>}
    {actionLabel && <SweepButton filled onClick={onAction}>{actionLabel}</SweepButton>}
  </div>;
}

// ============================================================================
// BADGE — the semantic status pill used for stock status, payment status,
// order status, and anywhere else a short status label appears. Colors are
// strictly limited to the locked status palette (success/warning/error) —
// never a decorative color.
// ============================================================================
export function Badge({ children, variant="neutral" }) {
  const styles = {
    success: { backgroundColor: "rgba(59,110,82,0.12)", color: T.success },
    warning: { backgroundColor: "rgba(181,101,29,0.12)", color: T.warning },
    error:   { backgroundColor: "rgba(168,59,50,0.1)", color: T.error },
    neutral: { backgroundColor: "rgba(36,62,65,0.07)", color: T.teal },
  };
  return <span className="inline-flex items-center text-[10.5px] uppercase tracking-[0.06em] px-2.5 py-1"
    style={{ ...( styles[variant] || styles.neutral ), borderRadius: RADIUS.xs, fontWeight: 500 }}>
    {children}
  </span>;
}
