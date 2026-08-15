// ============================================================================
// SHARED — design tokens, CSRF/fetch helpers, and UI primitives used by
// BOTH AkaraApp.jsx (customer-facing site) and AdminApp.jsx (admin panel).
// Pulled into its own module specifically so AdminApp.jsx doesn't need to
// import from AkaraApp.jsx directly (which would create a circular import,
// since AkaraApp.jsx dynamically imports AdminApp.jsx — see the root
// export in AkaraApp.jsx for why that split exists: keeping recharts and
// the whole admin panel out of the bundle every regular customer downloads).
// ============================================================================
import { useState } from "react";
import { Eye, EyeOff, AlertCircle } from "lucide-react";

export const T = {
  cream: "#FBF4E7", card: "#FFFFFF",
  teal: "#243E41", tealDk: "#1A2E30",
  gold: "#B8935A", goldLight: "#C9A96E",
  error: "#C0392B", success: "#27AE60",
};

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
  outline: 2px solid #B8935A;
  outline-offset: 2px;
}
:focus:not(:focus-visible) {
  outline: none;
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
}`;

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
  return <span className="relative inline-block leading-none">
    <span className="absolute left-[5%] right-[5%] bg-current" style={{ height:"1.5px", top:"-2px" }}/>
    {children}
  </span>;
}

// The standard button used sitewide: outline with a teal fill-sweep on
// hover, or `filled` for solid-teal primary actions.
export function SweepButton({ children, filled=false, onClick, className="", disabled=false, type="button" }) {
  return <button type={type} onClick={onClick} disabled={disabled}
    className={`group relative isolate overflow-hidden px-8 py-4 text-[11px] tracking-[0.18em] uppercase font-medium transition-colors duration-300 disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
    style={filled ? { backgroundColor:T.teal, color:"white" } : { color:T.teal, border:"1px solid rgba(36,62,65,0.22)" }}>
    {!filled && !disabled && <span className="absolute inset-0 -z-10 origin-left scale-x-0 transition-transform duration-500 ease-out group-hover:scale-x-100" style={{ backgroundColor:T.teal }}/>}
    <span className={`relative z-10 transition-colors duration-300 ${!filled?"group-hover:text-white":""}`}>{children}</span>
  </button>;
}

// The standard text input used on every form.
export function InputField({ label, type="text", value, onChange, error, placeholder, maxLength=200, required }) {
  const [show, setShow] = useState(false);
  const isPass = type === "password";
  return <div>
    <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{ color:"rgba(36,62,65,0.55)" }}>{label}{required && " *"}</label>
    <div className="relative">
      <input type={isPass?(show?"text":"password"):type} value={value}
        onChange={e => onChange(sanitize(e.target.value))} placeholder={placeholder} maxLength={maxLength}
        autoComplete={isPass?"current-password":type==="email"?"email":"off"}
        className="w-full bg-transparent outline-none text-[14px] pr-10"
        style={{ border:`1px solid ${error?T.error:"rgba(36,62,65,0.22)"}`, padding:"13px 14px", color:T.teal, fontFamily:"'Space Grotesk',sans-serif" }}/>
      {isPass && <button type="button" onClick={()=>setShow(s=>!s)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color:"rgba(36,62,65,0.4)" }}>{show?<EyeOff size={15}/>:<Eye size={15}/>}</button>}
    </div>
    {error && <p className="text-[11.5px] mt-1.5 flex items-center gap-1" style={{ color:T.error }}><AlertCircle size={12}/>{error}</p>}
  </div>;
}
