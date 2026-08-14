import { useState, useEffect, useRef, useCallback, Component } from "react";
import {
  Menu, X, Search, Heart, User, ShoppingBag,
  ArrowUpRight, Star, Lock, RotateCcw, Minus, Plus,
  Trash2, Eye, EyeOff, ChevronDown, ChevronRight,
  MapPin, Phone, Mail, Instagram, AlertCircle, Check,
  Package, ClipboardCheck, Truck, XCircle, Play, Film,
} from "lucide-react";

// ============================================================================
// DESIGN TOKENS — the entire visual identity flows from these two blocks
// (T and FONTS below). Every color, font, and print/motion rule in the app
// references these rather than hardcoding values inline — change a brand
// color ONCE here and it updates everywhere.
// ============================================================================
// Color palette. Cream background + dark teal text (deliberately INVERTED
// from the original Odoo version — do not revert without asking, this was
// a confirmed design decision). Gold is the accent for eyebrows, links,
// hover states, and focus rings.
const T = {
  cream: "#FBF4E7", card: "#FFFFFF",
  teal: "#243E41", tealDk: "#1A2E30",
  gold: "#B8935A", goldLight: "#C9A96E",
  error: "#C0392B", success: "#27AE60",
};
// Global CSS injected once via <style>{FONTS}</style> in AkaraApp's root
// render. Bundles: (1) Google Fonts import — Fraunces = display serif,
// Space Grotesk = body/UI, (2) print stylesheet — hides header/footer/nav
// (.no-print) so only the invoice itself prints when a customer downloads
// it, (3) accessibility — visible gold focus-visible outline sitewide,
// backing up the Accessibility Statement page's promises, (4) prefers-
// reduced-motion support + the page-transition fade-in class used on
// <main> in AkaraApp (keyed by view, so it replays on every navigation).
const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Space+Grotesk:wght@300;400;500;600&display=swap');
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

// ============================================================================
// SECURITY & VALIDATION UTILITIES — used across every form, and anywhere
// user-supplied or localStorage-supplied data gets rendered or stored.
// ============================================================================
// Strips HTML tags and caps length. Applied to every text input's value
// before it's stored/displayed — defense in depth even though React
// already escapes JSX text content by default. Used in: Checkout, Signup,
// Login, Contact, Bulk Orders, Return Request, and the URL-sourced search
// query in parsePath().
const sanitize = (str = "") => String(str).replace(/<[^>]*>/g, "").slice(0, 500);
// Password strength checker (Signup, Reset Password). Requires 8+ chars,
// one uppercase, one number, one special character. Returns {ok, msg} —
// drives both the inline error and the live strength-bar segments.
const pwStrength = (pw = "") => {
  if (pw.length < 8) return { ok: false, msg: "At least 8 characters" };
  if (!/[A-Z]/.test(pw)) return { ok: false, msg: "At least one uppercase letter" };
  if (!/[0-9]/.test(pw)) return { ok: false, msg: "At least one number" };
  if (!/[^A-Za-z0-9]/.test(pw)) return { ok: false, msg: "At least one special character" };
  return { ok: true, msg: "Strong" };
};
// Basic email shape check, not exhaustive RFC validation — real
// validation belongs server-side once a backend exists. Used on every
// email field sitewide.
const validEmail = (e = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Login attempt limiter — 5 attempts then exponential backoff (30s ->
// 60s -> 120s -> ... capped at 1800s/30min). Persisted to localStorage
// (see _load/_save) specifically so a page refresh can't reset it — an
// earlier version was pure in-memory and trivially bypassable that way.
// Still fundamentally a client-side speed bump, not real protection
// (clearing browser storage resets it) — see the SECURITY NOTE right
// below this class for what MUST happen before real launch.
class RateLimiter {
  constructor(key="akara_login_limiter", maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    this.key=key; this.max = maxAttempts; this.window = windowMs;
    const stored=this._load();
    this.attempts = stored.attempts||0; this.lockedUntil = stored.lockedUntil||0;
  }
  _load(){
    try{ const raw=localStorage.getItem(this.key); return raw?JSON.parse(raw):{}; }catch{ return {}; }
  }
  _save(){
    try{ localStorage.setItem(this.key,JSON.stringify({attempts:this.attempts,lockedUntil:this.lockedUntil})); }catch{ /* private browsing or storage disabled */ }
  }
  check() {
    if (Date.now() < this.lockedUntil) { return { allowed: false, wait: Math.ceil((this.lockedUntil - Date.now()) / 1000) }; }
    return { allowed: true, wait: 0 };
  }
  record() {
    this.attempts++;
    if (this.attempts >= this.max) { const b = Math.min(Math.pow(2, this.attempts - this.max) * 30, 1800); this.lockedUntil = Date.now() + b * 1000; }
    this._save();
  }
  reset() { this.attempts = 0; this.lockedUntil = 0; this._save(); }
}
const loginLimiter = new RateLimiter();
// SECURITY NOTE: this rate limiter (and the hardcoded demo login below) are client-side
// only, for pre-backend demo purposes. A client-side limiter can always be bypassed by
// clearing browser storage — it raises the bar against casual retry-spam, nothing more.
// Both MUST be replaced with real server-side authentication + rate limiting before
// this site handles real customer accounts. Do not ship the hardcoded credential check
// below to a live production login.

// ============================================================================
// PRODUCT CATALOG — single source of truth for all 31 products.
// ============================================================================
// Raw data: id (also the URL slug), name, category, price (INR, GST-
// exclusive), dims (+ weight where known), hsn (GST tax code: 3924 =
// planters/vases, 9405 = lighting). Components never use this array
// directly — see PRODUCTS below, which derives the real per-product object
// (SEO copy, media gallery, category icon, stock status) from this data.
// To add a new product: add one entry here + a matching entry in
// SEO_COPY (same id) — routing, cart, wishlist, related products, and the
// sitemap all pick it up automatically, no other code changes needed.
const CATALOG = [
  { id:"vayu-round-planter", name:"Vayu Round Planter", cat:"Planters", price:491, dims:"10cm × 10cm × 10cm · 0.29kg", hsn:"3924" },
  { id:"sonar-round-planter-black", name:"Sonar Round Planter", cat:"Planters", price:436, dims:"9cm × 6cm × 8cm · 0.15kg", hsn:"3924" },
  { id:"sonar-round-planter-beige", name:"Sonar Round Planter (Beige)", cat:"Planters", price:491, dims:"13cm × 13cm × 10cm · 0.16kg", hsn:"3924" },
  { id:"axiom-sculptural-planter", name:"Axiom Sculptural Planter", cat:"Planters", price:1500, dims:"15cm × 15cm × 15cm · 0.5kg", hsn:"3924" },
  { id:"kinetic-round-planter", name:"Kinetic Round Planter", cat:"Planters", price:411, dims:"13cm × 13cm × 10cm · 0.2kg", hsn:"3924" },
  { id:"echo-round-planter", name:"Echo Round Planter", cat:"Planters", price:436, dims:"11.4cm × 11.4cm × 10cm · 0.2kg", hsn:"3924" },
  { id:"eclipse-sculptural-planter", name:"Eclipse Sculptural Planter", cat:"Planters", price:411, dims:"12cm × 12cm × 10cm · 0.25kg", hsn:"3924" },
  { id:"terra-sculptural-planter", name:"Terra Sculptural Planter", cat:"Planters", price:436, dims:"13cm × 13cm × 10cm · 0.2kg", hsn:"3924" },
  { id:"orbita-sculptural-planter", name:"Orbita Sculptural Planter", cat:"Planters", price:491, dims:"10cm × 10cm × 10cm · 0.2kg", hsn:"3924" },
  { id:"zenith-bonsai-planter", name:"Zenith Bonsai Planter", cat:"Planters", price:763, dims:"15cm × 10cm × 8cm · 0.25kg", hsn:"3924" },
  { id:"vetra-oval-planter", name:"Vetra Oval Planter", cat:"Planters", price:656, dims:"10cm × 10cm × 10cm · 0.3kg", hsn:"3924" },
  { id:"plant-container-set", name:"Plant Container Set", cat:"Planters", price:395, dims:"13cm × 13cm × 10cm · 0.2kg", hsn:"3924" },
  { id:"orbita-stone-ring-planter", name:"Orbita Stone Ring Planter", cat:"Planters", price:258, dims:"10cm × 10cm × 10cm · 0.2kg", hsn:"3924" },
  { id:"helion-vase-white", name:"Helion Vase (White)", cat:"Vases", price:370, dims:"10cm × 10cm × 20cm · 0.15kg", hsn:"3924" },
  { id:"helion-vase-bronze", name:"Helion Vase (Bronze)", cat:"Vases", price:370, dims:"6cm × 6cm × 25cm · 0.15kg", hsn:"3924" },
  { id:"helion-vase-black", name:"Helion Vase (Black)", cat:"Vases", price:300, dims:"9cm × 9cm × 10cm · 0.13kg", hsn:"3924" },
  { id:"aira-decorative-vase", name:"Aira Decorative Vase", cat:"Vases", price:565, dims:"14.3cm × 14.3cm × 25cm · 0.25kg", hsn:"3924" },
  { id:"vera-fluted-vase", name:"Vera Fluted Sculptural Vase", cat:"Vases", price:746, dims:"10cm × 10cm × 20cm · 0.3kg", hsn:"3924" },
  { id:"reva-lattice-vase", name:"Reva Designer Flower Vase", cat:"Vases", price:621, dims:"10cm × 10cm × 20cm · 0.3kg", hsn:"3924" },
  { id:"vermillion-lamp-red", name:"Vermillion Pendant Lamp (Red)", cat:"Ceiling Lighting", price:2068, dims:"12cm × 10cm × 15cm · 0.4kg", hsn:"9405" },
  { id:"vermillion-lamp-black", name:"Vermillion Pendant Lamp (Black)", cat:"Ceiling Lighting", price:2066, dims:"12cm × 10cm × 20cm · 0.4kg", hsn:"9405" },
  { id:"aether-pendant-lamp", name:"Aether Pendant Lamp", cat:"Ceiling Lighting", price:1699, dims:"10cm × 10cm × 15cm · 0.4kg", hsn:"9405" },
  { id:"lumair-pendant-light", name:"Lumair Pendant Light", cat:"Ceiling Lighting", price:1494, dims:"10cm × 10cm × 15cm · 0.3kg", hsn:"9405" },
  { id:"aurelia-pendant-light", name:"Aurelia Pendant Light", cat:"Ceiling Lighting", price:2602, dims:"38cm × 38cm × 28cm · 0.5kg", hsn:"9405" },
  { id:"zephyra-table-lamp", name:"Zephyra Sculptural Table Lamp", cat:"Table Lamps", price:1728, dims:"10cm × 10cm × 20cm · 0.3kg", hsn:"9405" },
  { id:"orbis-table-lamp", name:"Orbis Table Lamp", cat:"Table Lamps", price:1182, dims:"25cm × 25cm × 25cm · 0.4kg", hsn:"9405" },
  { id:"lumen-table-lamp", name:"Lumen Cylindrical Table Lamp", cat:"Table Lamps", price:1728, dims:"10cm × 10cm × 20cm · 0.4kg", hsn:"9405" },
  { id:"noctis-table-lamp", name:"Noctis Sculptural Table Lamp", cat:"Table Lamps", price:1355, dims:"20cm × 20cm × 20cm · 0.4kg", hsn:"9405" },
  { id:"toru-table-lantern", name:"Toru Table Lantern", cat:"Lanterns", price:1412, dims:"8cm × 8cm × 9cm · 0.2kg", hsn:"9405" },
  { id:"kaito-lantern", name:"Kaito Lantern", cat:"Lanterns", price:1412, dims:"10cm × 10cm × 20cm · 0.2kg", hsn:"9405" },
  { id:"tripod-floor-lamp", name:"Tripod Floor Lamp", cat:"Floor Lamps", price:3437, dims:"20cm × 20cm × 20cm · 2kg", hsn:"9405" },
];
// The 6 product categories. Shop filters, the Drawer nav, the Footer
// "Collections" column, and the homepage "Shop by Category" grid all read
// from this array — add a category here (+ a CAT_SLUG entry + a CAT_ART
// icon below) and it appears everywhere automatically.
const CATEGORIES = ["Planters","Vases","Ceiling Lighting","Table Lamps","Lanterns","Floor Lamps"];
const CAT_SLUG = {"Planters":"planters","Vases":"vases","Ceiling Lighting":"ceiling-lighting","Table Lamps":"table-lamps","Lanterns":"lanterns","Floor Lamps":"floor-lamps"};
const SLUG_CAT = Object.fromEntries(Object.entries(CAT_SLUG).map(([k,v])=>[v,k]));
const STATIC_VIEW_PATH = {home:"/",shop:"/shop",cart:"/cart",checkout:"/checkout","order-confirmed":"/order-confirmed","order-status":"/order-status","invoice":"/invoice","payment-failed":"/payment-failed",about:"/about",craft:"/craft",contact:"/contact",faq:"/faq","bulk-orders":"/bulk-orders","return-request":"/return-request","care-guide":"/care-guide","email-preferences":"/email-preferences",accessibility:"/accessibility",account:"/account",login:"/login",signup:"/signup","forgot-password":"/forgot-password","reset-password":"/reset-password",privacy:"/privacy",refund:"/refund",shipping:"/shipping",terms:"/terms",cookies:"/cookies"};
const PATH_STATIC_VIEW = Object.fromEntries(Object.entries(STATIC_VIEW_PATH).map(([k,v])=>[v,k]));

// ============================================================================
// CLIENT-SIDE ROUTING — gives every page a real, shareable browser URL
// (e.g. /product/vayu-round-planter) using the History API, no router
// library. Three dynamic cases (product, shop+category, search query),
// everything else falls back to the static map (STATIC_VIEW_PATH) above.
// ============================================================================
// view+id -> URL path. Called from navigate() in AkaraApp on every
// navigation so the address bar always matches what's on screen.
// PRODUCTION NOTE: once deployed, the server must serve index.html for
// ALL of these paths (a standard "SPA fallback" rule) or a direct link
// like /product/vayu-round-planter will 404 on refresh.
function buildPath(view,id){
  if(view==="product"&&id) return "/product/"+id;
  if(view==="shop"&&id&&CATEGORIES.includes(id)) return "/shop/"+CAT_SLUG[id];
  if(view==="search") return "/search"+(id?("?q="+encodeURIComponent(id)):"");
  return STATIC_VIEW_PATH[view]||"/";
}
// URL path (+ query string) -> {view, ...params}. Inverse of buildPath().
// Called on first page load (supports direct links / refresh) and on
// browser back/forward (popstate, see AkaraApp). Returns
// {view:"__notfound__"} for anything unrecognized -> renders the 404 page.
function parsePath(pathname,search=""){
  const parts=pathname.split("/").filter(Boolean);
  if(parts.length===0) return {view:"home"};
  if(parts[0]==="product"&&parts[1]) return PRODUCTS.some(p=>p.id===parts[1])?{view:"product",productId:parts[1]}:{view:"__notfound__"};
  if(parts[0]==="shop"&&parts[1]&&SLUG_CAT[parts[1]]) return {view:"shop",shopCategory:SLUG_CAT[parts[1]]};
  if(parts[0]==="search") return {view:"search",searchQuery:sanitize(new URLSearchParams(search).get("q")||"").slice(0,100)};
  const staticView=PATH_STATIC_VIEW["/"+parts.join("/")];
  return {view:staticView||"__notfound__"};
}

// ============================================================================
// CATEGORY LINE-ART ICONS — hand-drawn SVG illustrations, one per category.
// These are PLACEHOLDER product imagery: every product shows its
// category's icon (via product.Art) until real photos/videos exist. See
// ProductGallery + defaultMedia() below for how the swap to real media
// happens once photos are supplied, with no further code changes needed.
// ============================================================================
function PlanterArt({ className, style }) {
  return <svg viewBox="0 0 200 200" fill="none" className={className} style={style}>
    <path d="M60 70 L140 70 L128 165 L72 165 Z" stroke="currentColor" strokeWidth="0.8"/>
    <line x1="60" y1="70" x2="140" y2="70" stroke="currentColor" strokeWidth="0.8"/>
    <path d="M85 70 C85 45 100 30 100 30 C100 30 115 45 115 70" stroke="currentColor" strokeWidth="0.8"/>
  </svg>;
}
function VaseArt({ className, style }) {
  return <svg viewBox="0 0 200 200" fill="none" className={className} style={style}>
    <path d="M85 40 L115 40 L122 75 C140 100 140 140 118 165 L82 165 C60 140 60 100 78 75 Z" stroke="currentColor" strokeWidth="1"/>
    <line x1="85" y1="40" x2="115" y2="40" stroke="currentColor" strokeWidth="1"/>
  </svg>;
}
function CeilingLampArt({ className, style }) {
  return <svg viewBox="0 0 200 200" fill="none" className={className} style={style}>
    <line x1="100" y1="15" x2="100" y2="55" stroke="currentColor" strokeWidth="1"/>
    <path d="M55 55 L145 55 L160 120 C160 120 135 135 100 135 C65 135 40 120 40 120 Z" stroke="currentColor" strokeWidth="1"/>
  </svg>;
}
function TableLampArt({ className, style }) {
  return <svg viewBox="0 0 200 200" fill="none" className={className} style={style}>
    <line x1="100" y1="20" x2="100" y2="60" stroke="currentColor" strokeWidth="1"/>
    <path d="M60 60 L140 60 L152 110 L48 110 Z" stroke="currentColor" strokeWidth="1"/>
    <line x1="100" y1="110" x2="100" y2="175" stroke="currentColor" strokeWidth="1"/>
    <line x1="75" y1="175" x2="125" y2="175" stroke="currentColor" strokeWidth="1"/>
  </svg>;
}
function LanternArt({ className, style }) {
  return <svg viewBox="0 0 200 200" fill="none" className={className} style={style}>
    <line x1="100" y1="15" x2="100" y2="35" stroke="currentColor" strokeWidth="1"/>
    <path d="M75 35 L125 35 L125 150 L75 150 Z" stroke="currentColor" strokeWidth="1"/>
    <line x1="75" y1="60" x2="125" y2="60" stroke="currentColor" strokeWidth="1"/>
    <line x1="75" y1="125" x2="125" y2="125" stroke="currentColor" strokeWidth="1"/>
  </svg>;
}
function FloorLampArt({ className, style }) {
  return <svg viewBox="0 0 200 200" fill="none" className={className} style={style}>
    <path d="M60 50 L140 50 L150 90 L50 90 Z" stroke="currentColor" strokeWidth="1"/>
    <line x1="100" y1="90" x2="100" y2="185" stroke="currentColor" strokeWidth="1"/>
    <line x1="65" y1="185" x2="135" y2="185" stroke="currentColor" strokeWidth="1.5"/>
  </svg>;
}

// Maps each category to its icon component. PRODUCTS (below) uses this
// to attach the right icon to every product based on its category.
const CAT_ART = { "Planters":PlanterArt, "Vases":VaseArt, "Ceiling Lighting":CeilingLampArt, "Table Lamps":TableLampArt, "Lanterns":LanternArt, "Floor Lamps":FloorLampArt };
// ============================================================================
// PER-PRODUCT SEO & WEBSITE COPY — the real, unique description / meta
// title / meta description for every one of the 31 products, keyed by
// product id. Written to replace repeated boilerplate the original
// Flipkart-derived copy had (identical phrasing appeared verbatim across
// 6+ different products). Merged onto each matching CATALOG product in
// PRODUCTS below. A product with no entry here falls back to
// "Description coming soon." rather than breaking — see tabContent in
// ProductDetailView.
// ============================================================================
const SEO_COPY = {
  "vayu-round-planter": { description: `Movement, held in place. Vayu's angled lattice sits above a grounded matte base, so the piece reads differently as you move around it — light catching the open weave one moment, settling into solid shadow the next. It's a planter built for a plant, but interesting enough to hold its own empty on a shelf. Comes with a base tray for clean, everyday styling.`, metaTitle: `Vayu Round Planter | Dual-Tone Lattice Planter — ĀKĀRA`, metaDesc: `Vayu is a dual-tone lattice planter with an angled, dynamic silhouette. 3D-printed in India, with drainage tray. Shop luxury planters at ĀKĀRA.` },
  "sonar-round-planter-black": { description: `A planter built on restraint. Sonar's woven lattice softens into a rounded form, so the structure never feels rigid — it's there in the detail, not the outline. Foliage sits through the openwork rather than in front of it, which means the planter keeps contributing to the look even once it's full. A quiet, considered choice for a desk or console.`, metaTitle: `Sonar Round Planter | Woven Lattice Planter, Black — ĀKĀRA`, metaDesc: `Sonar is a compact woven-lattice planter in black, with a rounded silhouette and drainage tray. Handcrafted in Mumbai. Shop ĀKĀRA planters.` },
  "sonar-round-planter-beige": { description: `The same woven geometry as Sonar's original, scaled up and warmed up. The beige finish softens the lattice further, so it reads more textile than structure from a distance — closer to a woven basket than a printed object. A larger footprint makes this the version for a proper floor plant rather than a desk succulent.`, metaTitle: `Sonar Round Planter Beige | Woven Lattice Planter — ĀKĀRA`, metaDesc: `Sonar in beige — a larger woven-lattice planter with a warm, neutral finish and drainage tray. Handcrafted in Mumbai. Shop ĀKĀRA planters.` },
  "axiom-sculptural-planter": { description: `Two forms, deliberately layered. A fluted inner planter sits held within a sculptural outer frame, so Axiom reads as one continuous piece from a distance and two distinct gestures up close. It's the largest and most architectural planter in the range — built for a space that can give it room to be looked at, not just filled.`, metaTitle: `Axiom Sculptural Planter | Fluted Planter with Outer Frame — ĀKĀRA`, metaDesc: `Axiom pairs a fluted inner planter with a sculptural outer frame for a layered, architectural silhouette. Drainage tray included. Shop ĀKĀRA.` },
  "kinetic-round-planter": { description: `Pattern, considered. Kinetic's lattice is cut tighter and more geometric than the rest of the range — less woven, more engineered. It's a planter that photographs as well empty as it does styled, which is why it tends to end up doing double duty: plant stand on weekdays, sculptural object when the plant's being repotted.`, metaTitle: `Kinetic Round Planter | Geometric Lattice Planter — ĀKĀRA`, metaDesc: `Kinetic is a geometric lattice planter with a matte finish and drainage tray, designed for modern indoor spaces. Shop ĀKĀRA planters online.` },
  "echo-round-planter": { description: `Echo works through repetition. Its surface is built from a single contour, stepped and repeated until it reads as rhythm rather than pattern — the kind of detail you notice on the second look, not the first. Because the depth comes from form rather than colour, it holds up in low light as well as bright, which flat ceramic pots rarely manage.`, metaTitle: `Echo Round Planter | Layered Geometric Planter — ĀKĀRA`, metaDesc: `Echo's repeating contour pattern shifts with light and angle, adding depth to a modern indoor planter. Drainage tray included. Shop ĀKĀRA.` },
  "eclipse-sculptural-planter": { description: `A floating sphere, without the ring. Eclipse shares its core geometry with Orbita — the same suspended spherical form and ribbed surface — but drops the stone-inspired outer ring entirely, so the sphere itself becomes the whole story. In this colourway, the effect sits quieter and more contained than Orbita's.`, metaTitle: `Eclipse Sculptural Planter | Floating Sphere Planter — ĀKĀRA`, metaDesc: `Eclipse is a floating spherical planter with a ribbed surface, sharing its core design with Orbita — without the outer stone ring. Shop ĀKĀRA planters.` },
  "terra-sculptural-planter": { description: `Structure, wrapped in structure. Terra's woven lattice body sits on a textured sculptural base, so the piece has two distinct surfaces working at once — one open, one solid. The name suits it: there's a groundedness to the base that the upper lattice plays against. Works equally on a bookshelf or an office desk.`, metaTitle: `Terra Sculptural Planter | Woven Lattice Planter — ĀKĀRA`, metaDesc: `Terra pairs a woven lattice body with a textured sculptural base for a grounded, tactile planter. Drainage tray included. Shop ĀKĀRA planters.` },
  "orbita-sculptural-planter": { description: `The Orbita sphere, unadorned. This is the same floating spherical planter and ribbed surface found on Eclipse, cast here in Orbita's own colourway — and, unlike its sibling Orbita Stone Ring, without the textured ring wrapped around it. Geometry alone carries the design.`, metaTitle: `Orbita Sculptural Planter | Floating Sphere Planter — ĀKĀRA`, metaDesc: `Orbita's floating spherical planter, ribbed and unadorned — no outer ring. Shares its design with Eclipse in a different colourway. Shop ĀKĀRA.` },
  "zenith-bonsai-planter": { description: `Bonsai, elevated — literally. Zenith's stand lifts the planter just enough to create a floating impression, while the wide, low profile keeps it faithful to traditional bonsai proportions. The ribbed exterior adds shadow detail without competing with what's planted in it, which is the real test for any bonsai container.`, metaTitle: `Zenith Bonsai Planter | Elevated Bonsai Pot — ĀKĀRA`, metaDesc: `Zenith is an elevated bonsai planter with a ribbed texture and wide, traditional proportions, adapted for modern interiors. Shop ĀKĀRA.` },
  "vetra-oval-planter": { description: `Low, linear, and deliberate. Vetra trades height for width, giving it a grounded, architectural presence that suits a cluster of small plants better than a single statement one. The ribbing is subtle — texture you feel more than see — and the wide opening keeps the arrangement even rather than lopsided.`, metaTitle: `Vetra Oval Planter | Low-Profile Ribbed Planter — ĀKĀRA`, metaDesc: `Vetra is a low, elongated planter with subtle ribbed texture, built for compact and clustered plant arrangements. Drainage tray included.` },
  "plant-container-set": { description: `Kinetic's lattice geometry, recoloured. This is the same round, geometric lattice planter as Kinetic — same pattern, same drainage tray — just recast in a red pot on a contrasting black stand for a sharper, more graphic look. Where Kinetic reads quiet and matte, this version is built to stand out.`, metaTitle: `Plant Container Set | Red & Black Kinetic Planter — ĀKĀRA`, metaDesc: `The Kinetic lattice planter in a bold red-and-black colourway, with drainage tray. Shop ĀKĀRA's geometric indoor planters online.` },
  "orbita-stone-ring-planter": { description: `A sphere, held by stone. Orbita's planter appears to float within a textured ring that reads closer to carved stone than printed polymer — the contrast is the whole point. The ribbed sphere itself adds a second layer of texture, so the piece keeps giving even once you've taken in the main shape.`, metaTitle: `Orbita Stone Ring Planter | Sculptural Sphere Planter — ĀKĀRA`, metaDesc: `Orbita's floating spherical form sits within a textured stone-inspired ring, with a ribbed surface and drainage system. Shop ĀKĀRA.` },
  "helion-vase-white": { description: `A single unbroken spiral, cast in white. Helion's continuous curve catches light differently depending on where you stand — a soft shadow here, a hard edge there — which keeps it interesting even unstyled. In white, the geometry is the whole story; there's nothing else pulling focus.`, metaTitle: `Helion Vase White | Spiral Sculptural Vase — ĀKĀRA`, metaDesc: `Helion in white — a spiral-form sculptural vase that plays with light and shadow. Matte finish, indoor use. Shop ĀKĀRA decorative vases.` },
  "helion-vase-bronze": { description: `The same spiral, stretched and warmed. Helion's bronze edition trades width for height — taller and slimmer than the original — which changes how the spiral reads, more column than curve. The warm matte tone suits it; bronze has a way of making geometry feel less severe.`, metaTitle: `Helion Vase Bronze | Tall Spiral Sculptural Vase — ĀKĀRA`, metaDesc: `Helion in bronze — a taller, slimmer take on the spiral vase, in a warm matte finish. Shop ĀKĀRA's sculptural decorative vases online.` },
  "helion-vase-black": { description: `Helion's smallest form — the spiral geometry condensed rather than simplified. At this scale it reads more object than vase, which is why it tends to end up on a desk as often as a dining table. Black keeps the focus entirely on form.`, metaTitle: `Helion Vase Black | Compact Spiral Sculptural Vase — ĀKĀRA`, metaDesc: `Helion's smallest form, in black — a compact spiral vase for desks and small shelves. Matte finish, indoor use. Shop ĀKĀRA vases.` },
  "aira-decorative-vase": { description: `Ribbed contours that catch the light differently every hour of the day. Aira's flowing silhouette has a quiet sense of movement to it — nothing sharp or angular, just a steady rhythm of ridges that read as calm rather than busy. Holds its own with dried botanicals or entirely empty.`, metaTitle: `Aira Decorative Vase | Ribbed Sculptural Vase — ĀKĀRA`, metaDesc: `Aira is a ribbed, flowing sculptural vase with a refined matte finish, suited to modern and Japandi interiors. Shop ĀKĀRA vases online.` },
  "vera-fluted-vase": { description: `Fluted lines, drawn with restraint. Vera doesn't chase drama the way some of the range does — its fluting is even and continuous, closer to a classical column than a sculptural gesture. That restraint is what makes it work in more traditional settings as easily as minimalist ones.`, metaTitle: `Vera Fluted Vase | Sculptural Table Vase — ĀKĀRA`, metaDesc: `Vera's fluted contours bring timeless elegance to a modern vase, in a premium matte finish. Suited to luxury and Scandinavian interiors.` },
  "reva-lattice-vase": { description: `A vase that stays interesting after the flowers do. Most vases disappear once arranged — Reva doesn't. Its diagonal lattice keeps revealing itself through the gaps between stems, adding a second layer to the composition rather than just holding it up. Worth choosing even for someone who mostly buys vases for what goes in them.`, metaTitle: `Reva Designer Vase | Lattice Pattern Flower Vase — ĀKĀRA`, metaDesc: `Reva's diagonal lattice pattern keeps working even after it's styled with flowers, adding depth behind every stem. Shop ĀKĀRA vases.` },
  "vermillion-lamp-red": { description: `Rib by rib, a pendant that reads as sculpture first, light source second. Vermillion's open geometric frame lets warm light spill out through the gaps rather than straight down, softening the whole room rather than just the table beneath it. In red, it's the most visually assertive lamp in the range — built for a space that wants a focal point.`, metaTitle: `Vermillion Pendant Lamp Red | Sculptural Ceiling Light — ĀKĀRA`, metaDesc: `Vermillion's ribbed geometric structure diffuses warm light through an open frame — a bold pendant lamp in red. Shop ĀKĀRA lighting.` },
  "vermillion-lamp-black": { description: `Same architecture, cast in black — and stretched a little taller. The extra height changes the proportions just enough to make this the more graphic of the two Vermillion editions; the ribs read as vertical lines rather than a rounded frame. Suits a more restrained interior than the red does.`, metaTitle: `Vermillion Pendant Lamp Black | Sculptural Ceiling Light — ĀKĀRA`, metaDesc: `Same architecture as Vermillion Red, cast in black and stretched taller — a graphic sculptural pendant lamp. Shop ĀKĀRA lighting.` },
  "aether-pendant-lamp": { description: `Parametric ribs, warm light, quiet drama. Aether's flowing, computationally-derived form isn't trying to look like anything else — it's pure structure, and the shadow it casts is as much a part of the design as the lamp itself. Suspend it over a dining table or kitchen island and let the ceiling do some of the decorating.`, metaTitle: `Aether Pendant Lamp | Parametric Ceiling Light — ĀKĀRA`, metaDesc: `Aether's ribbed, parametric form creates a striking interplay of light and shadow. E27-compatible pendant lamp. Shop ĀKĀRA lighting.` },
  "lumair-pendant-light": { description: `Light in motion. Lumair's organic geometry has none of the hard angles found elsewhere in the range — it curves and flows, and the light follows the same logic, diffusing evenly rather than spilling from one point. An everyday lamp built to shape the mood of a room rather than announce itself.`, metaTitle: `Lumair Pendant Light | Organic Sculptural Ceiling Lamp — ĀKĀRA`, metaDesc: `Lumair's organic, flowing geometry diffuses soft ambient light for a calm, considered space. Shop ĀKĀRA's sculptural ceiling lighting.` },
  "aurelia-pendant-light": { description: `Layered light, evenly diffused. Aurelia is the largest pendant in the range, and it's built to earn that scale — multiple layers break up the light so it spreads warmly across a room instead of glaring down from one point. Above a dining table, it becomes less a light fixture and more the reason people look up.`, metaTitle: `Aurelia Pendant Light | Layered Statement Ceiling Lamp — ĀKĀRA`, metaDesc: `Aurelia's multi-layered structure diffuses light evenly for a warm, glare-free glow. The largest pendant in the ĀKĀRA range. Shop now.` },
  "zephyra-table-lamp": { description: `A spiral shade, caught mid-swirl. Zephyra's lampshade is styled after moving air — a soft, organic spiral rather than a static cone — sitting on a fluted, minimalist base that keeps the whole piece from tipping into whimsy. The diffused glow is as much the point as the sculpture itself.`, metaTitle: `Zephyra Table Lamp | Spiral Sculptural Bedside Lamp — ĀKĀRA`, metaDesc: `Zephyra's spiral shade sits on a fluted cylindrical base for a soft, sculptural bedside glow. Shop ĀKĀRA's decorative table lamps.` },
  "orbis-table-lamp": { description: `A sphere and a cylinder, in conversation. Orbis keeps its two forms distinct rather than blending them — a solid textured base beneath a ribbed shade — so the contrast does the design work instead of ornament. It's built to complement a room, not dominate it, which is rarer than it sounds in decorative lighting.`, metaTitle: `Orbis Table Lamp | Minimal Sphere & Cylinder Lamp — ĀKĀRA`, metaDesc: `Orbis pairs a spherical base with a ribbed cylindrical shade for a calm, structured bedside or desk lamp. Shop ĀKĀRA lighting online.` },
  "lumen-table-lamp": { description: `Warmth, filtered through a lattice shade. Lumen's cylindrical form is deliberately plain — the interest comes entirely from how the light escapes through the openwork shade, casting a soft dappled glow across the surface it sits on. A calm, minimalist lamp that does exactly one thing well.`, metaTitle: `Lumen Table Lamp | Cylindrical Lattice Bedside Lamp — ĀKĀRA`, metaDesc: `Lumen's cylindrical lattice shade filters a soft, warm glow — a minimalist bedside lamp with E27 compatibility. Shop ĀKĀRA lighting.` },
  "noctis-table-lamp": { description: `Dark base, pleated white shade — a study in contrast. Noctis is the most classically-styled lamp in the range, closer to vintage than sculptural, but the intricately textured base keeps it from feeling dated. Designed for an Edison-style bulb, visible rather than hidden, with a braided cord that's part of the look rather than an afterthought.`, metaTitle: `Noctis Table Lamp | Textured Base, Pleated Shade — ĀKĀRA`, metaDesc: `Noctis pairs an intricately textured dark base with a classic white pleated shade for vintage-modern bedside lighting. Shop ĀKĀRA.` },
  "toru-table-lantern": { description: `A lantern with architectural memory. Toru's structured silhouette borrows from traditional lantern forms without copying them outright — the geometry is cleaner, more contemporary, but the sense of calm it creates is the same. Small enough for a console or bedside table, and dim enough not to fight with the room around it.`, metaTitle: `Toru Table Lantern | Japandi Bedside Lamp — ĀKĀRA`, metaDesc: `Toru is a compact Japandi-inspired table lantern with a matte textured finish and soft, diffused glow. Shop ĀKĀRA decorative lighting.` },
  "kaito-lantern": { description: `Paneled light, borrowed from lantern tradition. Kaito's frame is built from repeated panels rather than a single shade, so the light spreads more evenly than a typical table lamp — no hot spot, just a steady, calm glow. The layered top adds just enough visual weight to keep it from disappearing into the background.`, metaTitle: `Kaito Lantern | Panelled Japandi Table Lamp — ĀKĀRA`, metaDesc: `Kaito's panelled form spreads soft, even light — a modern lantern lamp rooted in Japandi design. Shop ĀKĀRA's decorative lighting range.` },
  "tripod-floor-lamp": { description: `The Aurelia shade, brought down to the floor. Tripod carries the same multi-layered structure that diffuses Aurelia's light evenly overhead — reduced glare, warm ambient spread — but rests it on a considered three-legged stand instead of hanging it from the ceiling. At 2kg, it's the most substantial piece in the collection, built to anchor a reading corner or fill an empty space beside a sofa without needing anything on the ceiling to support it.`, metaTitle: `Tripod Floor Lamp | Aurelia Shade on a Standing Base — ĀKĀRA`, metaDesc: `The Aurelia silhouette, brought to the floor — a multi-layered sculptural shade on a premium tripod stand. Shop ĀKĀRA's statement lighting.` },
};
const MIN_IMAGES=5, MIN_VIDEOS=2;
// Generates a product's placeholder media gallery: 5 image slots + 2
// video slots, all src:null (ProductGallery renders these as the category
// icon / a "video coming soon" state). To add real media later: set that
// CATALOG entry's `media` field to an array of {type,src} objects with
// real URLs — minimum 5 images + 2 videos — overriding this default.
function defaultMedia(){
  return [
    ...Array.from({length:MIN_IMAGES},()=>({type:"image",src:null})),
    ...Array.from({length:MIN_VIDEOS},()=>({type:"video",src:null})),
  ];
}
// To add real photos/videos for a product later: set that CATALOG entry's `media` field to
// an array like [{type:"image",src:"/media/vayu-1.jpg"},...,{type:"video",src:"/media/vayu-1.mp4"}]
// — minimum 5 images + 2 videos per product. Anything left as src:null falls back to the
// placeholder icon/video-pending state until real files are supplied.
// THE derived product list every component actually uses (never CATALOG
// directly). Merges in: default stock status ("in-stock" — flip
// individual products to "low-stock"/"sold-out" in CATALOG once real
// inventory numbers exist), SEO_COPY fields, a media gallery (real if set
// on the CATALOG entry, placeholder otherwise), and the category icon.
const PRODUCTS = CATALOG.map(p => ({ stock:"in-stock", ...p, ...(SEO_COPY[p.id]||{}), media:p.media||defaultMedia(), Art: CAT_ART[p.cat] || PlanterArt }));

// ============================================================================
// SHARED UI PRIMITIVES — small reusable pieces used across dozens of pages.
// ============================================================================
// The brand's signature typographic detail: draws the macron (the line
// above the "A") in ĀKĀRA via a CSS-positioned <span>, not the Unicode
// character (renders inconsistently across fonts/browsers). Usage:
// <Mac>A</Mac> — used in the Header logo, Footer logo, and the Invoice.
function Mac({ children }) {
  return <span className="relative inline-block leading-none">
    <span className="absolute left-[5%] right-[5%] bg-current" style={{ height:"1.5px", top:"-2px" }}/>
    {children}
  </span>;
}

// The standard button used sitewide: outline with a teal fill-sweep on
// hover, or `filled` for solid-teal primary actions. Nearly every CTA in
// the app is one of these — button styling only needs to change here.
function SweepButton({ children, filled=false, onClick, className="", disabled=false, type="button" }) {
  return <button type={type} onClick={onClick} disabled={disabled}
    className={`group relative isolate overflow-hidden px-8 py-4 text-[11px] tracking-[0.18em] uppercase font-medium transition-colors duration-300 disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
    style={filled ? { backgroundColor:T.teal, color:"white" } : { color:T.teal, border:"1px solid rgba(36,62,65,0.22)" }}>
    {!filled && !disabled && <span className="absolute inset-0 -z-10 origin-left scale-x-0 transition-transform duration-500 ease-out group-hover:scale-x-100" style={{ backgroundColor:T.teal }}/>}
    <span className={`relative z-10 transition-colors duration-300 ${!filled?"group-hover:text-white":""}`}>{children}</span>
  </button>;
}

// The standard text input used on every form (Checkout, Login, Signup,
// Contact, Bulk Orders, Return Request, Addresses, etc.) — label,
// underline-style input, and inline error message, styled once here.
function InputField({ label, type="text", value, onChange, error, placeholder, maxLength=200, required }) {
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

// ============================================================================
// APP SHELL — persistent chrome rendered around every page in AkaraApp:
// Header, Drawer (mobile nav), SearchPanel (overlay quick-search),
// CartDrawer (slide-in mini cart), Footer.
// ============================================================================
// Sticky top nav: hamburger (opens Drawer), logo (-> home), search icon
// (opens SearchPanel), account icon, wishlist, cart icon with live count.
// className="no-print" (passed from AkaraApp) hides this on the printed
// invoice.
function Header({ navigate, onOpenDrawer, onOpenSearch, onOpenCart, cartCount, wishCount, user, className="" }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { const fn=()=>setScrolled(window.scrollY>40); window.addEventListener("scroll",fn); return ()=>window.removeEventListener("scroll",fn); }, []);
  return <header className={"sticky top-0 z-40 grid items-center h-[68px] px-6 md:px-12 "+className} style={{ gridTemplateColumns:"auto 1fr auto", gap:"16px", backgroundColor:scrolled?"rgba(251,244,231,0.97)":"rgba(251,244,231,0.88)", backdropFilter:"blur(20px)", borderBottom:"1px solid rgba(36,62,65,0.09)" }}>
    <button aria-label="Open menu" onClick={onOpenDrawer} className="justify-self-start p-2 -ml-2" style={{ color:T.teal }}><Menu size={20} strokeWidth={1.5}/></button>
    <button onClick={()=>navigate("home")} className="justify-self-center flex items-center uppercase" style={{ fontFamily:"'Fraunces',serif", fontWeight:500, fontSize:"16px", color:T.teal, letterSpacing:"0.26em" }}>
      <Mac>A</Mac><span>K</span><Mac>A</Mac><span>RA</span>
    </button>
    <div className="justify-self-end flex items-center gap-0.5">
      <button aria-label="Search" onClick={onOpenSearch} className="p-2.5" style={{ color:T.teal }}><Search size={17} strokeWidth={1.5}/></button>
      <button aria-label={user?"My Account":"Sign In"} onClick={()=>navigate(user?"account":"login")} className="p-2.5 hidden sm:block" style={{ color:T.teal }}><User size={17} strokeWidth={1.5}/></button>
      <button aria-label="Wishlist" className="relative p-2.5" style={{ color:T.teal }}>
        <Heart size={17} strokeWidth={1.5}/>
        {wishCount>0 && <span className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-medium text-white" style={{ backgroundColor:T.gold }}>{wishCount}</span>}
      </button>
      <button aria-label="Cart" onClick={onOpenCart} className="relative p-2.5" style={{ color:T.teal }}>
        <ShoppingBag size={17} strokeWidth={1.5}/>
        {cartCount>0 && <span className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-medium text-white" style={{ backgroundColor:T.gold }}>{cartCount}</span>}
      </button>
    </div>
  </header>;
}

function NavItem({ label, onClick }) {
  return <button onClick={onClick} className="w-full text-left px-8 py-4 text-[17px] italic hover:bg-black/5 transition-colors" style={{ fontFamily:"Fraunces,serif", color:T.teal, borderBottom:"1px solid rgba(36,62,65,0.06)" }}>{label}</button>;
}

// Mobile-style slide-in nav menu (opened via the Header hamburger).
// Lists all categories (from CATEGORIES — never needs manual updates)
// plus account/login and legal links.
function Drawer({ open, onClose, navigate, user, logout }) {
  const [shopOpen, setShopOpen] = useState(false);
  const go = (v, id) => { navigate(v, id); onClose(); };
  return <>
    <div onClick={onClose} className="fixed inset-0 z-[60] transition-opacity duration-300" style={{ backgroundColor:"rgba(36,62,65,0.45)", opacity:open?1:0, pointerEvents:open?"all":"none" }}/>
    <nav aria-label="Site navigation" aria-modal={open} role="dialog" className="fixed top-0 left-0 bottom-0 z-[70] flex flex-col transition-transform duration-500 overflow-hidden" style={{ width:"min(85vw,340px)", backgroundColor:T.cream, transform:open?"translateX(0)":"translateX(-100%)", boxShadow:"24px 0 60px -20px rgba(36,62,65,0.28)" }}>
      <div className="flex items-center justify-between px-8 h-[68px]" style={{ borderBottom:"1px solid rgba(36,62,65,0.1)" }}>
        <span className="text-[13px] tracking-[0.14em] uppercase" style={{ color:"rgba(36,62,65,0.5)" }}>Menu</span>
        <button onClick={onClose} aria-label="Close" className="p-2 -mr-2" style={{ color:T.teal }}><X size={20}/></button>
      </div>
      <div className="flex-1 overflow-y-auto py-4">
        <NavItem label="Home" onClick={()=>go("home")}/>
        <div>
          <button onClick={()=>setShopOpen(o=>!o)} className="w-full flex items-center justify-between px-8 py-4 text-left hover:bg-black/5" style={{ color:T.teal }}>
            <span className="text-[17px] italic" style={{ fontFamily:"Fraunces,serif" }}>Shop</span>
            <ChevronDown size={16} style={{ transform:shopOpen?"rotate(180deg)":"none", transition:"transform 0.3s" }}/>
          </button>
          {shopOpen && <div className="px-8 pb-2" style={{ backgroundColor:"rgba(36,62,65,0.03)" }}>
            <button onClick={()=>go("shop")} className="w-full text-left py-2.5 text-[13px] flex items-center gap-2" style={{ color:T.gold, borderBottom:"1px solid rgba(36,62,65,0.08)" }}>
              <ArrowUpRight size={13}/> All Products
            </button>
            {CATEGORIES.map(cat=><button key={cat} onClick={()=>go("shop",cat)} className="w-full text-left py-2.5 text-[13px] flex items-center gap-2" style={{ color:T.teal, borderBottom:"1px solid rgba(36,62,65,0.06)" }}>
              <ChevronRight size={12} style={{ color:"rgba(36,62,65,0.3)" }}/>{cat}
            </button>)}
          </div>}
        </div>
        <NavItem label="About" onClick={()=>go("about")}/>
        <NavItem label="Contact" onClick={()=>go("contact")}/>
        <NavItem label="FAQ" onClick={()=>go("faq")}/>
      </div>
      <div className="px-8 py-6" style={{ borderTop:"1px solid rgba(36,62,65,0.1)" }}>
        {user ? <>
          <p className="text-[11px] tracking-[0.08em] uppercase mb-3" style={{ color:"rgba(36,62,65,0.5)" }}>Signed in as {user.name}</p>
          <button onClick={()=>go("account")} className="block text-[13px] mb-2" style={{ color:T.teal }}>My Account</button>
          <button onClick={()=>{ logout(); onClose(); }} className="block text-[12px]" style={{ color:"rgba(36,62,65,0.45)" }}>Sign Out</button>
        </> : <div className="flex gap-3">
          <SweepButton filled onClick={()=>go("login")} className="flex-1 !px-4 !py-3">Sign In</SweepButton>
          <SweepButton onClick={()=>go("signup")} className="flex-1 !px-4 !py-3">Register</SweepButton>
        </div>}
      </div>
    </nav>
  </>;
}

// Quick-search overlay dropping from the header. Shows up to 6 live-
// filtered PRODUCTS matches as you type; Enter or "See all N results"
// navigates to the full SearchResultsView page (/search?q=...) for
// anything beyond the quick preview.
function SearchPanel({ open, onClose, navigate }) {
  const [q, setQ] = useState("");
  const inputRef = useRef(null);
  useEffect(()=>{ if(open) setTimeout(()=>inputRef.current?.focus(),300); },[open]);
  const trimmed=q.trim();
  const allMatches = trimmed.length>1 ? PRODUCTS.filter(p=>p.name.toLowerCase().includes(q.toLowerCase())||p.cat.toLowerCase().includes(q.toLowerCase())) : [];
  const matches = allMatches.slice(0,6);
  const goToResults=()=>{ if(trimmed.length>1){ navigate("search",trimmed); onClose(); setQ(""); } };
  return <div role="search" aria-label="Search products" aria-hidden={!open} className="fixed top-[68px] left-0 right-0 z-30 overflow-hidden transition-all duration-300"
    style={{ display:"grid", gridTemplateRows:open?"1fr":"0fr", backgroundColor:T.cream, borderBottom:open?"1px solid rgba(36,62,65,0.1)":"none" }}>
    <div className="overflow-hidden">
      <form onSubmit={e=>{e.preventDefault();goToResults();}} className="max-w-[600px] mx-auto px-6 py-4 flex items-center gap-3">
        <Search size={15} style={{ color:"rgba(36,62,65,0.4)",flexShrink:0 }}/>
        <input ref={inputRef} value={q} onChange={e=>setQ(sanitize(e.target.value))} placeholder="Search planters, vases, lighting…" maxLength={100}
          className="flex-1 bg-transparent outline-none text-[15px]" style={{ color:T.teal }}/>
        <button type="button" onClick={()=>{ onClose(); setQ(""); }} style={{ color:"rgba(36,62,65,0.4)" }}><X size={15}/></button>
      </form>
      {matches.length>0 && <div className="max-w-[600px] mx-auto px-6 pb-4">
        {matches.map(m=><button key={m.id} onClick={()=>{ navigate("product",m.id); onClose(); setQ(""); }}
          className="flex justify-between w-full py-2.5 text-[13px] text-left" style={{ color:T.teal, borderTop:"1px solid rgba(36,62,65,0.07)" }}>
          <span>{m.name}</span><span style={{ color:T.gold }}>₹{m.price}</span>
        </button>)}
        <button onClick={goToResults} className="w-full py-2.5 text-[12px] uppercase tracking-[0.08em] text-left" style={{ color:T.gold, borderTop:"1px solid rgba(36,62,65,0.07)" }}>
          See all {allMatches.length} result{allMatches.length>1?"s":""} for "{trimmed}" →
        </button>
      </div>}
      {trimmed.length>1&&allMatches.length===0&&<div className="max-w-[600px] mx-auto px-6 pb-4">
        <p className="text-[12.5px] py-2.5" style={{color:"rgba(36,62,65,0.45)",borderTop:"1px solid rgba(36,62,65,0.07)"}}>No quick matches — press Enter to search the full collection.</p>
      </div>}
    </div>
  </div>;
}

// Slide-in mini-cart (opened via the Header cart icon) for a quick view/
// remove without leaving the current page. "View Full Cart" and
// "Checkout" navigate to the full CartView/CheckoutView pages.
function CartDrawer({ open, onClose, cart, setCart, navigate }) {
  const total = cart.reduce((s,i)=>s+i.price*i.qty,0);
  return <>
    <div onClick={onClose} className="fixed inset-0 z-[60] transition-opacity duration-300" style={{ backgroundColor:"rgba(36,62,65,0.4)",opacity:open?1:0,pointerEvents:open?"all":"none" }}/>
    <aside aria-label="Shopping cart" aria-modal={open} role="dialog" className="fixed top-0 right-0 bottom-0 z-[70] flex flex-col transition-transform duration-500"
      style={{ width:"min(92vw,400px)", backgroundColor:T.cream, transform:open?"translateX(0)":"translateX(100%)", boxShadow:"-20px 0 60px -20px rgba(36,62,65,0.3)" }}>
      <div className="flex items-center justify-between p-6" style={{ borderBottom:"1px solid rgba(36,62,65,0.1)" }}>
        <h2 className="italic text-[20px]" style={{ fontFamily:"Fraunces,serif",color:T.teal }}>Cart ({cart.reduce((s,i)=>s+i.qty,0)})</h2>
        <button onClick={onClose} style={{ color:T.teal }}><X size={20}/></button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {cart.length===0 ? <p className="text-[14px] text-center mt-12" style={{ color:"rgba(36,62,65,0.5)" }}>Your cart is empty.</p>
        : cart.map(item=><div key={item.id+item.size} className="flex gap-4 mb-5">
          <div className="w-20 h-20 flex items-center justify-center shrink-0" style={{ backgroundColor:T.card,boxShadow:"0 0 0 1px rgba(36,62,65,0.08)" }}>
            <item.Art className="w-3/5 h-3/5" style={{ color:T.gold,opacity:0.8 }}/>
          </div>
          <div className="flex-1">
            <h3 className="text-[13px] italic mb-0.5" style={{ fontFamily:"Fraunces,serif",color:T.teal }}>{item.name}</h3>
            {item.size&&<p className="text-[11px] mb-1" style={{ color:"rgba(36,62,65,0.45)" }}>Size: {item.size}</p>}
            <p className="text-[13px] mb-2" style={{ color:T.gold }}>₹{item.price} × {item.qty}</p>
            <button onClick={()=>setCart(c=>c.filter(i=>!(i.id===item.id&&i.size===item.size)))} className="flex items-center gap-1 text-[11px] uppercase tracking-wide" style={{ color:"rgba(36,62,65,0.4)" }}><Trash2 size={11}/> Remove</button>
          </div>
        </div>)}
      </div>
      {cart.length>0&&<div className="p-6" style={{ borderTop:"1px solid rgba(36,62,65,0.1)" }}>
        <div className="flex justify-between mb-4">
          <span className="text-[13px]" style={{ color:"rgba(36,62,65,0.6)" }}>Subtotal</span>
          <span className="text-[17px]" style={{ fontFamily:"Fraunces,serif",color:T.teal }}>₹{total.toLocaleString("en-IN")}</span>
        </div>
        <button onClick={()=>{ onClose(); navigate("checkout"); }} className="w-full py-4 text-[12px] tracking-[0.14em] uppercase font-medium text-white" style={{ backgroundColor:T.teal }}>Checkout</button>
        <button onClick={()=>{ onClose(); navigate("cart"); }} className="w-full py-3 text-[11px] tracking-[0.08em] uppercase mt-2" style={{ color:"rgba(36,62,65,0.5)" }}>View Full Cart</button>
      </div>}
    </aside>
  </>;
}

// Email capture form used in the Footer. NOTE: UI only — no real email
// service (ESP) is wired up yet. See EmailPreferencesView for the fuller
// subscription-management page, same caveat applies there.
function NewsletterForm() {
  const [email,setEmail]=useState(""); const [done,setDone]=useState(false);
  if(done) return <p className="text-[13px]" style={{color:T.goldLight}}>Joined ✓</p>;
  return <form onSubmit={e=>{e.preventDefault();if(validEmail(email))setDone(true);}} className="flex" style={{border:"1px solid rgba(255,255,255,0.15)"}}>
    <input value={email} onChange={e=>setEmail(sanitize(e.target.value))} placeholder="your@email.com" type="email" maxLength={100}
      className="flex-1 bg-transparent text-[13px] outline-none px-3" style={{color:"white",minWidth:0}}/>
    <button type="submit" className="px-4 py-3 text-[11px] tracking-[0.1em] uppercase shrink-0" style={{backgroundColor:"rgba(255,255,255,0.1)",color:T.goldLight}}>Join</button>
  </form>;
}

// Sitewide footer: brand blurb + contact info, Collections (from
// CATEGORIES), Company links, Newsletter signup, and the bottom legal bar
// (Privacy/Refunds/Shipping/Terms/Cookies/Accessibility/Email Preferences/
// GSTIN). className="no-print" — hidden on the printed invoice.
function Footer({ navigate }) {
  return <footer className="no-print" style={{backgroundColor:T.teal}}>
    <div className="px-8 md:px-14 pt-14 pb-10 max-w-[1280px] mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-10">
        <div className="sm:col-span-2 md:col-span-1">
          <div className="flex items-center uppercase mb-5" style={{fontFamily:"'Fraunces',serif",fontWeight:500,fontSize:"16px",color:"white",letterSpacing:"0.26em"}}>
            <Mac>A</Mac><span>K</span><Mac>A</Mac><span>RA</span>
          </div>
          <p className="text-[13.5px] leading-[1.85] mb-6 max-w-[220px]" style={{color:"rgba(255,255,255,0.55)"}}>
            Precision geometric home décor, 3D-printed to order in our Mumbai studio using plant-based materials.
          </p>
          <div className="flex flex-col gap-2.5">
            {[[Mail,"support@akaraonline.co.in","mailto:support@akaraonline.co.in"],
              [Phone,"+91 82780 85572","tel:+918278085572"],
              [Instagram,"@atelier.akara","https://instagram.com/atelier.akara"],
              [MapPin,"Thane, Maharashtra",null]
            ].map(([Icon,label,href])=><div key={label} className="flex items-center gap-2.5">
              <Icon size={13} style={{color:T.goldLight,flexShrink:0}}/>
              {href?<a href={href} className="text-[12.5px] hover:text-white transition-colors" style={{color:"rgba(255,255,255,0.55)"}}>{label}</a>
                :<span className="text-[12.5px]" style={{color:"rgba(255,255,255,0.55)"}}>{label}</span>}
            </div>)}
          </div>
        </div>
        <div>
          <p className="text-[10.5px] tracking-[0.14em] uppercase mb-5" style={{color:T.goldLight}}>Collections</p>
          {["All Products",...CATEGORIES].map((c,i)=><button key={c} onClick={()=>navigate("shop",i===0?null:c)}
            className="block text-[13px] mb-3 text-left hover:text-white transition-colors" style={{color:"rgba(255,255,255,0.55)"}}>{c}</button>)}
        </div>
        <div>
          <p className="text-[10.5px] tracking-[0.14em] uppercase mb-5" style={{color:T.goldLight}}>Company</p>
          {[["About","about"],["The Craft","craft"],["Contact","contact"],["FAQ","faq"],["Care Guide","care-guide"],["Bulk & Corporate Orders","bulk-orders"],["My Account","account"]].map(([l,v])=><button key={v} onClick={()=>navigate(v)}
            className="block text-[13px] mb-3 text-left hover:text-white transition-colors" style={{color:"rgba(255,255,255,0.55)"}}>{l}</button>)}
        </div>
        <div>
          <p className="text-[10.5px] tracking-[0.14em] uppercase mb-5" style={{color:T.goldLight}}>Stay in the Loop</p>
          <p className="text-[13px] leading-[1.7] mb-4" style={{color:"rgba(255,255,255,0.5)"}}>New pieces, restocks — nothing more often than that.</p>
          <NewsletterForm/>
        </div>
      </div>
    </div>
    <div style={{borderTop:"1px solid rgba(255,255,255,0.1)"}}>
      <div className="px-8 md:px-14 py-6 max-w-[1280px] mx-auto flex flex-col sm:flex-row justify-between gap-3">
        <p className="text-[11.5px]" style={{color:"rgba(255,255,255,0.4)"}}>© 2024–2026 Precision Forge Labs. All rights reserved.</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {[["Privacy","privacy"],["Refunds","refund"],["Shipping","shipping"],["Terms","terms"],["Cookies","cookies"],["Accessibility","accessibility"],["Email Preferences","email-preferences"]].map(([l,v])=><button key={v} onClick={()=>navigate(v)}
            className="text-[11.5px] hover:text-white transition-colors" style={{color:"rgba(255,255,255,0.4)"}}>{l}</button>)}
        </div>
        <p className="text-[11.5px]" style={{color:"rgba(255,255,255,0.3)"}}>GSTIN 27GZCPS9353H1ZQ</p>
      </div>
    </div>
  </footer>;
}

// ============================================================================
// PRODUCT DISPLAY COMPONENTS
// ============================================================================
// A single product tile used in every grid sitewide (Shop, Search
// results, Home featured/related products). Hover-lift, quick add-to-cart,
// and wishlist-toggle all live here so grid behavior stays identical
// everywhere it's used.
function ProductCard({ product, navigate, cart, setCart, wishlist, setWishlist }) {
  const {id,name,cat,price,Art}=product;
  const [hover,setHover]=useState(false);
  const isWished=wishlist.includes(id);
  const toggleWish=e=>{ e.stopPropagation(); setWishlist(w=>w.includes(id)?w.filter(x=>x!==id):[...w,id]); };
  const addToCart=e=>{ e.stopPropagation(); setCart(c=>{ const ex=c.find(i=>i.id===id&&!i.size); if(ex) return c.map(i=>i.id===id&&!i.size?{...i,qty:i.qty+1}:i); return [...c,{...product,qty:1}]; }); };
  return <div className="group relative flex flex-col cursor-pointer transition-transform duration-500 ease-out"
    style={{transform:hover?"translateY(-5px)":"translateY(0)"}}
    onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} onClick={()=>navigate("product",id)}>
    <div className="relative aspect-square flex items-center justify-center overflow-hidden transition-shadow duration-500"
      style={{backgroundColor:T.card,boxShadow:hover?"0 24px 50px -20px rgba(36,62,65,0.26),0 0 0 1px rgba(184,147,90,0.28)":"0 6px 22px -12px rgba(36,62,65,0.12),0 0 0 1px rgba(36,62,65,0.06)"}}>
      <div className="w-2/5 h-2/5 transition-transform duration-700 ease-out" style={{color:T.gold,opacity:0.82,transform:hover?"scale(1.1)":"scale(1)"}}>
        <Art/>
      </div>
      <button onClick={toggleWish} aria-label="Toggle wishlist"
        className="absolute top-3.5 right-3.5 w-8 h-8 flex items-center justify-center border"
        style={{borderColor:"rgba(36,62,65,0.1)",backgroundColor:"rgba(255,255,255,0.75)"}}>
        <Heart size={14} style={{color:isWished?T.gold:T.teal,fill:isWished?T.gold:"none"}}/>
      </button>
      <button onClick={addToCart}
        className="absolute inset-x-0 bottom-0 flex items-center justify-center py-3 transition-transform duration-300 ease-out"
        style={{backgroundColor:T.teal,transform:hover?"translateY(0)":"translateY(100%)"}}>
        <span className="text-[11px] tracking-[0.14em] uppercase font-medium text-white">Add to Cart</span>
      </button>
    </div>
    <div className="pt-4 flex items-start justify-between gap-2">
      <div>
        <p className="text-[10px] tracking-[0.12em] uppercase mb-1" style={{color:"rgba(36,62,65,0.4)"}}>{cat}</p>
        <h3 className="text-[15px] italic" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{name}</h3>
      </div>
      <p className="text-[14px] shrink-0 pt-0.5" style={{fontFamily:"'Fraunces',serif",color:T.gold}}>₹{price}</p>
    </div>
  </div>;
}

// The homepage hero's signature visual: a soft gold glow + line-drawn
// lamp illustration that drifts slightly with mouse position (mx/my come
// from HomeView's onMouseMove handler). Mouse-only — mobile visitors see
// a static (but still fine) version since there's no touch equivalent.
function LightWash({mx=0,my=0}) {
  return <div className="pointer-events-none absolute inset-0 overflow-hidden"
    style={{transform:`translate(${mx*6}px,${my*4}px)`,transition:"transform 0.5s cubic-bezier(0.22,1,0.36,1)"}}>
    <div className="absolute w-[400px] h-[400px] rounded-full left-1/2 -translate-x-1/2"
      style={{top:"0",background:"radial-gradient(circle,rgba(184,147,90,0.13) 0%,rgba(184,147,90,0.04) 50%,transparent 72%)"}}/>
    <svg viewBox="0 0 240 340" className="absolute w-[120px] md:w-[160px] left-1/2 -translate-x-1/2" style={{opacity:0.82,top:"2vh",maxHeight:"20vh"}}>
      <line x1="120" y1="0" x2="120" y2="72" stroke={T.gold} strokeWidth="1.25" opacity="0.45"/>
      <path d="M56 72 L184 72 L204 158 C204 158 172 178 120 178 C68 178 36 158 36 158 Z" fill="none" stroke={T.gold} strokeWidth="1.2"/>
      <ellipse cx="120" cy="72" rx="64" ry="9" fill="none" stroke={T.gold} strokeWidth="1" opacity="0.4"/>
    </svg>
  </div>;
}

// ============================================================================
// PAGE VIEWS — from here down, one component per route/page. Each is
// rendered from the big view===... switch near the bottom of AkaraApp,
// and receives navigate() as its way of moving to any other page.
// ============================================================================
// Homepage. Structure, top to bottom: (1) Hero — the page's one visual
// "thesis" moment (mouse-parallax lamp + headline), (2) trust strip —
// rating/returns/security/location, quick reassurance for a first-time
// visitor, (3) Shop by Category — real browsing entry point using
// CATEGORIES + CAT_ART, (4) New this season — 3 featured products
// (currently just PRODUCTS.slice(0,3), i.e. NOT really curated — this is
// exactly what the planned admin panel's "homepage featured picks"
// feature is meant to fix), (5) stats band (60-90 units/month etc,
// distinctive brand positioning), (6) "Explore further" — teaser cards
// pointing to About/Care Guide/Bulk Orders so Home doesn't dead-end.
function HomeView({ navigate, cart, setCart, wishlist, setWishlist }) {
  const [reveal,setReveal]=useState(false);
  const [mouse,setMouse]=useState({x:0,y:0});
  const heroRef=useRef(null);
  useEffect(()=>{ const t=setTimeout(()=>setReveal(true),120); return ()=>clearTimeout(t); },[]);
  const onMove=e=>{ const r=heroRef.current.getBoundingClientRect(); setMouse({x:(e.clientX-r.left)/r.width-0.5,y:(e.clientY-r.top)/r.height-0.5}); };
  const featured=PRODUCTS.slice(0,3);
  return <div>
    <section ref={heroRef} onMouseMove={onMove} className="relative flex flex-col items-center justify-end text-center px-6 overflow-hidden"
      style={{minHeight:"85vh",paddingBottom:"5vh"}}>
      <LightWash mx={mouse.x} my={mouse.y}/>
      <p className={`relative z-10 text-[12px] tracking-[0.32em] uppercase mb-7 transition-all duration-700 ${reveal?"opacity-100 translate-y-0":"opacity-0 translate-y-2"}`} style={{color:T.gold}}>Est. Mumbai · Made to Order</p>
      <h1 className={`relative z-10 italic leading-[0.96] transition-all duration-700 delay-100 ${reveal?"opacity-100 translate-y-0":"opacity-0 translate-y-3"}`}
        style={{fontFamily:"'Fraunces',serif",fontWeight:400,fontSize:"clamp(50px,10vw,124px)",color:T.teal}}>
        Let there<br/>be <span style={{color:T.gold}}>form.</span>
      </h1>
      <p className={`relative z-10 mt-8 max-w-[460px] text-[16px] leading-[1.8] transition-all duration-700 delay-200 ${reveal?"opacity-100 translate-y-0":"opacity-0 translate-y-3"}`} style={{color:"rgba(36,62,65,0.65)"}}>
        Precision geometric planters, vases and lighting — 3D-printed to order in our Mumbai studio, never pulled from a shelf.
      </p>
      <div className={`relative z-10 mt-11 flex gap-4 flex-wrap justify-center transition-all duration-700 delay-300 ${reveal?"opacity-100 translate-y-0":"opacity-0 translate-y-3"}`}>
        <SweepButton filled onClick={()=>navigate("shop")}>Explore the Collection</SweepButton>
        <SweepButton onClick={()=>navigate("about")}>Our Story</SweepButton>
      </div>
    </section>
    <section className="px-6 py-7" style={{borderTop:"1px solid rgba(36,62,65,0.08)",borderBottom:"1px solid rgba(36,62,65,0.08)"}}>
      <div className="max-w-[1000px] mx-auto flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
        {[[Star,"4.6★ from verified customers"],[RotateCcw,"7-day returns · 30-day warranty"],[Lock,"Secure checkout via Razorpay"],[MapPin,"Handcrafted to order in Mumbai"]]
          .map(([Icon,label])=><div key={label} className="flex items-center gap-2" style={{color:"rgba(36,62,65,0.55)"}}>
            <Icon size={13} style={{color:T.gold,flexShrink:0}}/><span className="text-[12px]">{label}</span>
          </div>)}
      </div>
    </section>
    <section className="px-6 md:px-14 py-14 md:py-20 max-w-[1280px] mx-auto">
      <div className="text-center mb-12">
        <p className="text-[12px] tracking-[0.3em] uppercase mb-4" style={{color:T.gold}}>Shop by Category</p>
        <h2 className="italic text-[28px] md:text-[36px]" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>Find your form.</h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {CATEGORIES.map(c=>{ const Art=CAT_ART[c]; return <button key={c} onClick={()=>navigate("shop",c)}
          className="group flex flex-col items-center justify-center gap-3 py-8 px-3 text-center transition-shadow duration-300"
          style={{backgroundColor:T.card,boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
          <div className="w-9 h-9 transition-transform duration-500 group-hover:scale-110" style={{color:T.gold,opacity:0.85}}><Art/></div>
          <span className="text-[12px]" style={{color:T.teal}}>{c}</span>
        </button>;})}
      </div>
    </section>
    <section className="px-6 md:px-14 py-14 md:py-20 max-w-[1280px] mx-auto">
      <div className="flex items-end justify-between mb-12 flex-wrap gap-6">
        <div>
          <p className="text-[12px] tracking-[0.3em] uppercase mb-4" style={{color:T.gold}}>The Collection</p>
          <h2 className="italic text-[32px] md:text-[42px]" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>New this season.</h2>
        </div>
        <button onClick={()=>navigate("shop")} className="group flex items-center gap-2 text-[12px] tracking-[0.1em] uppercase pb-1 border-b" style={{borderColor:"rgba(36,62,65,0.2)",color:T.teal}}>
          View All <ArrowUpRight size={14} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"/>
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-10 md:gap-8">
        {featured.map(p=><ProductCard key={p.id} product={p} navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} setWishlist={setWishlist}/>)}
      </div>
    </section>
    <section className="relative px-6 py-16 md:py-20 text-center overflow-hidden" style={{backgroundColor:T.teal}}>
      <div className="pointer-events-none absolute w-[600px] h-[600px] rounded-full -left-48 -top-48" style={{background:"radial-gradient(circle,rgba(184,147,90,0.12),transparent 70%)"}}/>
      <p className="relative text-[12px] tracking-[0.3em] uppercase mb-5" style={{color:T.goldLight}}>Made in Mumbai</p>
      <h2 className="relative italic mx-auto max-w-xl leading-[1.3] text-white" style={{fontFamily:"'Fraunces',serif",fontWeight:400,fontSize:"clamp(26px,4vw,40px)"}}>
        Made to order.<br/>Made for <span style={{color:T.goldLight}}>you.</span>
      </h2>
      <div className="relative mt-12 mx-auto max-w-[520px] grid grid-cols-3 border" style={{borderColor:"rgba(255,255,255,0.15)"}}>
        {[["60–90","Units / month"],["2–3","Weeks to door"],["0","In a warehouse"]].map(([n,l],i)=><div key={l} className="py-7 px-4" style={{borderRight:i<2?"1px solid rgba(255,255,255,0.15)":"none"}}>
          <p className="text-[26px] mb-1.5 text-white" style={{fontFamily:"'Fraunces',serif"}}>{n}</p>
          <p className="text-[10px] tracking-[0.08em] uppercase" style={{color:"rgba(255,255,255,0.45)"}}>{l}</p>
        </div>)}
      </div>
    </section>
    <section className="px-6 md:px-14 py-14 md:py-20 max-w-[1280px] mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {[["The Craft","How every piece is designed, printed, and finished — materials and process.","craft"],
          ["Care Guide","How to keep your piece looking the way it did on day one.","care-guide"],
          ["Bulk & Corporate Orders","Ordering for a hotel, café, or gifting programme? Let's talk.","bulk-orders"]]
          .map(([title,desc,view])=><button key={view} onClick={()=>navigate(view)} className="group text-left p-7"
            style={{backgroundColor:T.card,boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
            <p className="italic text-[18px] mb-2.5" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{title}</p>
            <p className="text-[12.5px] leading-[1.7] mb-4" style={{color:"rgba(36,62,65,0.55)"}}>{desc}</p>
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em]" style={{color:T.gold}}>
              Learn More <ArrowUpRight size={12} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"/>
            </span>
          </button>)}
      </div>
    </section>
  </div>;
}

// Real, distinct intro copy + meta description per category (NOT a
// filtered-grid-with-no-content — each category page has its own SEO
// content). Read by ShopView (the intro paragraph) and by AkaraApp's
// meta-description effect when on a /shop/<category> URL.
const CATEGORY_CONTENT = {
  Planters:{
    intro:"Geometry, grown into. Every planter here is built around a repeating structural idea — lattice, contour, or ribbing — designed to hold a plant without disappearing behind it. Each comes with a drainage tray as standard, so styling and plant care don't have to be a trade-off.",
    metaDesc:"Sculptural 3D-printed planters with drainage trays, in matte and woven-lattice finishes. Made to order in Mumbai. Shop ĀKĀRA's planter collection online.",
  },
  Vases:{
    intro:"Vessels built to hold their own, flowers or not. Spiral, fluted, and lattice geometries designed to keep working after the arrangement wilts — the kind of piece that earns a permanent spot on a console rather than coming out only for occasions.",
    metaDesc:"Sculptural decorative vases — spiral, fluted, and lattice designs in a refined matte finish. Made to order in Mumbai. Shop ĀKĀRA's vase collection online.",
  },
  "Ceiling Lighting":{
    intro:"Pendant lighting built to be looked at, not just under. Open, ribbed, and layered structures that let light spill through the gaps rather than straight down — softening a room instead of just illuminating it.",
    metaDesc:"Sculptural pendant lamps with open ribbed and layered structures for warm, diffused light. Made to order in Mumbai. Shop ĀKĀRA's ceiling lighting collection.",
  },
  "Table Lamps":{
    intro:"Considered lighting for a desk or bedside table — sculptural enough to hold attention switched off, calm enough not to fight the room when it's on.",
    metaDesc:"Sculptural table lamps for bedside and desk styling, in matte finishes with soft ambient glow. Made to order in Mumbai. Shop ĀKĀRA's table lamp collection.",
  },
  Lanterns:{
    intro:"Structured, architectural lighting drawing from traditional lantern forms, reinterpreted for a modern interior — calm, panelled light suited to consoles and bedside tables.",
    metaDesc:"Japandi-inspired decorative lanterns with structured panelled forms and warm diffused light. Made to order in Mumbai. Shop ĀKĀRA's lantern collection online.",
  },
  "Floor Lamps":{
    intro:"Standing lighting built to anchor a room, not just fill a corner. The most substantial pieces in the collection — enough presence to work as the room's focal point.",
    metaDesc:"Sculptural standing floor lamps built as statement lighting for living rooms and reading corners. Made to order in Mumbai. Shop ĀKĀRA's floor lamp collection.",
  },
};

// Full search results page (/search?q=...) — was a real gap for a while
// (quick-search overlay only showed 6 results with no dedicated,
// shareable, indexable page). initQuery comes from the URL via
// AkaraApp's searchQuery state / parsePath. Includes a proper "no
// results" state pointing to Shop and Bulk Orders rather than a dead end.
// Deliberately NOT in sitemap.xml — query-dependent URLs shouldn't be
// indexed as their own pages, that's standard SEO practice.
function SearchResultsView({ navigate, cart, setCart, wishlist, setWishlist, initQuery }){
  const [q,setQ]=useState(initQuery||"");
  useEffect(()=>{ setQ(initQuery||""); },[initQuery]);
  const trimmed=q.trim().toLowerCase();
  const results=trimmed.length>1?PRODUCTS.filter(p=>p.name.toLowerCase().includes(trimmed)||p.cat.toLowerCase().includes(trimmed)||(p.description||"").toLowerCase().includes(trimmed)):[];
  const submit=e=>{ e.preventDefault(); navigate("search",q); };
  return <div>
    <section className="px-6 md:px-14 pt-14 pb-8 max-w-[700px] mx-auto text-center">
      <p className="text-[12px] tracking-[0.3em] uppercase mb-3" style={{color:T.gold}}>Search</p>
      <h1 className="italic text-[32px] md:text-[44px] mb-5" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>{trimmed.length>1?`Results for "${q}"`:"Search the Collection"}</h1>
      <form onSubmit={submit} className="flex items-center gap-3 mb-3" style={{borderBottom:`1px solid ${T.teal}`}}>
        <Search size={16} style={{color:"rgba(36,62,65,0.4)",flexShrink:0}}/>
        <input value={q} onChange={e=>setQ(sanitize(e.target.value))} placeholder="Search planters, vases, lighting…" maxLength={100}
          className="flex-1 bg-transparent outline-none text-[16px] py-3" style={{color:T.teal,fontFamily:"'Space Grotesk',sans-serif"}}/>
        <button type="submit" className="text-[11px] uppercase tracking-[0.1em] pb-3" style={{color:T.gold}}>Search</button>
      </form>
    </section>
    {trimmed.length<=1
      ?<div className="px-6 py-16 text-center">
        <p className="text-[14px]" style={{color:"rgba(36,62,65,0.5)"}}>Type at least two characters to search the collection.</p>
      </div>
      :results.length===0
      ?<div className="px-6 py-16 text-center max-w-[480px] mx-auto">
        <p className="text-[16px] mb-3" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>No results for "{q}"</p>
        <p className="text-[13.5px] leading-[1.8] mb-8" style={{color:"rgba(36,62,65,0.55)"}}>We couldn't find a match — try a different term, or browse the full collection. Looking for something in bulk, or a custom piece? We can help with that too.</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <SweepButton filled onClick={()=>navigate("shop")}>Explore the Collection</SweepButton>
          <SweepButton onClick={()=>navigate("bulk-orders")}>Bulk & Corporate Orders</SweepButton>
        </div>
      </div>
      :<section className="px-6 md:px-14 pb-24 max-w-[1280px] mx-auto">
        <p className="pb-8 text-[11.5px] tracking-[0.06em] uppercase text-center" style={{color:"rgba(36,62,65,0.4)"}}>{results.length} result{results.length>1?"s":""} for "{q}"</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-10">
          {results.map(p=><ProductCard key={p.id} product={p} navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} setWishlist={setWishlist}/>)}
        </div>
      </section>}
  </div>;
}

// Main catalog browsing page (/shop, /shop/<category>). initCategory
// comes from the URL (set by AkaraApp's shopCategory state). Shows the
// CATEGORY_CONTENT intro paragraph when a specific category is active.
function ShopView({ navigate, cart, setCart, wishlist, setWishlist, initCategory }) {
  const [activeCat,setActiveCat]=useState(initCategory||"All");
  useEffect(()=>{ if(initCategory) setActiveCat(initCategory); else setActiveCat("All"); },[initCategory]);
  const filtered=activeCat==="All"?PRODUCTS:PRODUCTS.filter(p=>p.cat===activeCat);
  const catInfo=CATEGORY_CONTENT[activeCat];
  return <div>
    <section className="px-6 md:px-14 pt-14 pb-8 text-center">
      <p className="text-[12px] tracking-[0.3em] uppercase mb-3" style={{color:T.gold}}>Shop</p>
      <h1 className="italic text-[32px] md:text-[44px] mb-5" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>{activeCat==="All"?"All Products":activeCat}</h1>
      {catInfo&&<p className="max-w-[560px] mx-auto text-[14px] leading-[1.8]" style={{color:"rgba(36,62,65,0.6)"}}>{catInfo.intro}</p>}
    </section>
    <section className="px-6 md:px-14 max-w-[1280px] mx-auto">
      <div className="flex flex-wrap gap-2.5 pb-7" style={{borderBottom:"1px solid rgba(36,62,65,0.1)"}}>
        {["All",...CATEGORIES].map(c=><button key={c} onClick={()=>setActiveCat(c)}
          className="px-5 py-2.5 text-[12.5px] transition-all duration-200"
          style={activeCat===c?{backgroundColor:T.teal,color:"white"}:{border:"1px solid rgba(36,62,65,0.18)",color:T.teal}}>{c}</button>)}
      </div>
      <p className="pt-5 pb-8 text-[11.5px] tracking-[0.06em] uppercase" style={{color:"rgba(36,62,65,0.4)"}}>{filtered.length} {filtered.length===1?"piece":"pieces"}</p>
    </section>
    <section className="px-6 md:px-14 pb-24 max-w-[1280px] mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-10">
        {filtered.map(p=><ProductCard key={p.id} product={p} navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} setWishlist={setWishlist}/>)}
      </div>
    </section>
  </div>;
}

// Shared (non-per-product) tab content for Product Detail's Care Guide
// and Reviews tabs. Description is NOT here — that comes from each
// product's own SEO_COPY entry instead (see tabContent in
// ProductDetailView below).
const TABS_CONTENT = {
  "Care Guide": "Wipe clean with a dry or lightly damp cloth. Avoid prolonged direct sunlight to preserve colour. Not dishwasher safe.",
  Reviews: "4.6 out of 5 · 89 reviews. Full review system coming with the backend.",
};

// Product Detail's media gallery: main viewer + thumbnail strip,
// supporting a mix of real images/videos and placeholders in the same
// product's media array. `Art` is that product's category icon, used as
// the placeholder for any image slot with src:null; video slots with
// src:null show a "Video coming soon" state instead.
function ProductGallery({ media, Art, name, soldOut }){
  const [active,setActive]=useState(0);
  const item=media[active]||media[0];
  return <div>
    <div className="relative flex items-center justify-center" style={{backgroundColor:T.card,boxShadow:"0 8px 24px -14px rgba(36,62,65,0.14),0 0 0 1px rgba(36,62,65,0.06)",aspectRatio:"1/1",maxHeight:"520px",width:"100%",overflow:"hidden"}}>
      {item.type==="video"
        ? (item.src
            ? <video src={item.src} controls className="w-full h-full object-cover" style={{opacity:soldOut?0.5:1}}/>
            : <div className="flex flex-col items-center gap-3" style={{color:"rgba(36,62,65,0.35)"}}>
                <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{border:`1px solid rgba(36,62,65,0.2)`}}><Play size={22}/></div>
                <p className="text-[11.5px] uppercase tracking-[0.08em]">Video coming soon</p>
              </div>)
        : (item.src
            ? <img src={item.src} alt={`${name} — photo ${active+1}`} className="w-full h-full object-cover" style={{opacity:soldOut?0.5:1}}/>
            : <Art className="w-1/3 h-1/3" style={{color:T.gold,opacity:soldOut?0.35:1}}/>)}
      {soldOut&&<div className="absolute top-4 left-4 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.08em]" style={{backgroundColor:T.teal,color:"white"}}>Sold Out</div>}
    </div>
    <div className="flex gap-2.5 mt-3 overflow-x-auto pb-1">
      {media.map((m,i)=><button key={i} onClick={()=>setActive(i)} aria-label={m.type==="video"?`Video ${i+1}`:`Photo ${i+1}`}
        className="shrink-0 w-16 h-16 flex items-center justify-center relative"
        style={{backgroundColor:T.card,boxShadow:i===active?`0 0 0 2px ${T.gold}`:"0 0 0 1px rgba(36,62,65,0.1)"}}>
        {m.type==="video"
          ? (m.src?<video src={m.src} className="w-full h-full object-cover"/>:<Film size={16} style={{color:"rgba(36,62,65,0.35)"}}/>)
          : (m.src?<img src={m.src} alt="" className="w-full h-full object-cover"/>:<Art className="w-6 h-6" style={{color:"rgba(184,147,90,0.6)"}}/>)}
        {m.type==="video"&&<div className="absolute bottom-1 right-1"><Play size={9} style={{color:m.src?"white":"rgba(36,62,65,0.4)"}}/></div>}
      </button>)}
    </div>
  </div>;
}

// The individual product page (/product/<slug>) — one component serves
// all 31 products, driven entirely by the `product` object looked up from
// PRODUCTS via productId. Includes the sticky mobile add-to-cart bar,
// stock-state handling (in-stock/low-stock/sold-out — see the `stock`
// field on PRODUCTS), and the size/qty selectors (NOTE: size options are
// currently placeholder Small/Medium/Large buttons, not yet wired to real
// per-product size data — pending real size list from the business).
function ProductDetailView({ productId, navigate, cart, setCart, wishlist, setWishlist }) {
  // The AkaraApp render gate (productExists) already ensures this component
  // never mounts with an invalid productId, so this fallback is a pure
  // safety net, not the primary guard — see the routing fix in parsePath().
  const product=PRODUCTS.find(p=>p.id===productId)||PRODUCTS[0];
  const [size,setSize]=useState("Medium");
  const [qty,setQty]=useState(1);
  const [tab,setTab]=useState("Description");
  const [toast,setToast]=useState(false);
  const isWished=wishlist.includes(product.id);
  const related=PRODUCTS.filter(p=>p.cat===product.cat&&p.id!==product.id).slice(0,3);
  const soldOut=product.stock==="sold-out";
  const lowStock=product.stock==="low-stock";
  const addToCart=()=>{ if(soldOut) return; setCart(c=>{ const ex=c.find(i=>i.id===product.id&&i.size===size); if(ex) return c.map(i=>i.id===product.id&&i.size===size?{...i,qty:i.qty+qty}:i); return [...c,{...product,size,qty}]; }); setToast(true); setTimeout(()=>setToast(false),2200); };
  const tabContent=tab==="Dimensions"?product.dims:tab==="Description"?(product.description||"Description coming soon."):TABS_CONTENT[tab];
  return <div>
    <div className="px-6 md:px-14 pt-5 max-w-[1280px] mx-auto">
      <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.45)"}}>
        <button onClick={()=>navigate("home")} className="hover:underline">Home</button>
        <span style={{color:T.gold}}> / </span>
        <button onClick={()=>navigate("shop",product.cat)} className="hover:underline">{product.cat}</button>
        <span style={{color:T.gold}}> / </span>
        <span style={{color:T.teal}}>{product.name}</span>
      </p>
    </div>
    <section className="px-6 md:px-14 pt-8 pb-16 max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-14">
      <ProductGallery media={product.media} Art={product.Art} name={product.name} soldOut={soldOut}/>
      <div>
        <p className="text-[12px] tracking-[0.14em] uppercase mb-2.5" style={{color:soldOut?"rgba(36,62,65,0.4)":T.gold}}>{product.cat} · {soldOut?"Sold Out":lowStock?"Low Stock":"In Stock"}</p>
        <h1 className="italic text-[34px] md:text-[40px] leading-tight mb-3" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>{product.name}</h1>
        <div className="flex items-center gap-1.5 mb-5">
          {[0,1,2,3].map(i=><Star key={i} size={14} fill={T.gold} stroke={T.gold}/>)}
          <Star size={14} stroke={T.gold} fill="none"/>
          <span className="text-[12.5px] ml-1" style={{color:"rgba(36,62,65,0.5)"}}>4.6 (89)</span>
        </div>
        <p className="text-[28px] mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{product.price}</p>
        <p className="text-[11.5px] mb-6" style={{color:"rgba(36,62,65,0.45)"}}>Excl. GST · added at checkout</p>
        {soldOut?<div className="flex items-center gap-2.5 px-4 py-3 mb-7 text-[12.5px]" style={{backgroundColor:"rgba(192,57,43,0.07)",color:T.error}}>
          <AlertCircle size={14}/> Currently sold out — check back soon, or explore similar pieces below
        </div>:lowStock?<div className="flex items-center gap-2.5 px-4 py-3 mb-7 text-[12.5px]" style={{backgroundColor:"rgba(192,57,43,0.07)",color:T.error}}>
          <AlertCircle size={14}/> Only a few left — order soon
        </div>:<div className="flex items-center gap-2.5 px-4 py-3 mb-7 text-[12.5px]" style={{backgroundColor:"rgba(184,147,90,0.08)",color:T.teal}}>
          <span style={{color:T.gold}}>●</span> Handcrafted for you — ships in 2–3 weeks
        </div>}
        <div className="mb-5">
          <p className="text-[11px] tracking-[0.1em] uppercase mb-2.5" style={{color:"rgba(36,62,65,0.5)"}}>Size</p>
          <div className="flex gap-2.5">
            {["Small","Medium","Large"].map(s=><button key={s} onClick={()=>setSize(s)} disabled={soldOut} className="px-4 py-2.5 text-[13px] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              style={size===s?{backgroundColor:T.teal,color:"white"}:{border:"1px solid rgba(36,62,65,0.2)",color:T.teal}}>{s}</button>)}
          </div>
        </div>
        <div className="mb-7">
          <p className="text-[11px] tracking-[0.1em] uppercase mb-2.5" style={{color:"rgba(36,62,65,0.5)"}}>Quantity</p>
          <div className="inline-flex items-center" style={{border:"1px solid rgba(36,62,65,0.2)",opacity:soldOut?0.4:1}}>
            <button onClick={()=>setQty(q=>Math.max(1,q-1))} disabled={soldOut} className="w-10 h-10 flex items-center justify-center disabled:cursor-not-allowed" style={{color:T.teal}} aria-label="Decrease"><Minus size={13}/></button>
            <span className="w-10 text-center text-[15px]" style={{fontFamily:"'Fraunces',serif"}}>{qty}</span>
            <button onClick={()=>setQty(q=>q+1)} disabled={soldOut} className="w-10 h-10 flex items-center justify-center disabled:cursor-not-allowed" style={{color:T.teal}} aria-label="Increase"><Plus size={13}/></button>
          </div>
        </div>
        <div className="hidden lg:flex gap-3 mb-5">
          <button onClick={addToCart} disabled={soldOut} className="flex-1 py-4 text-[12px] tracking-[0.14em] uppercase font-medium hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            style={{border:`1px solid ${T.teal}`,color:T.teal}}>{soldOut?"Sold Out":"Add to Cart"}</button>
          <button disabled={soldOut} className="flex-1 py-4 text-[12px] tracking-[0.14em] uppercase font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            style={{backgroundColor:T.teal}}>Buy Now</button>
          <button onClick={()=>setWishlist(w=>w.includes(product.id)?w.filter(x=>x!==product.id):[...w,product.id])}
            aria-label="Wishlist" className="w-14 flex items-center justify-center" style={{border:"1px solid rgba(36,62,65,0.2)"}}>
            <Heart size={16} style={{color:isWished?T.gold:T.teal,fill:isWished?T.gold:"none"}}/>
          </button>
        </div>
        <div className="flex flex-col gap-2 text-[12.5px]" style={{color:"rgba(36,62,65,0.55)"}}>
          <div className="flex items-center gap-2"><Lock size={13}/> Secure checkout via Razorpay</div>
          <div className="flex items-center gap-2"><RotateCcw size={13}/> 7-day returns · 30-day warranty</div>
        </div>
      </div>
    </section>
    <section className="px-6 md:px-14 max-w-[1280px] mx-auto pb-20">
      <div className="flex gap-8 flex-wrap mb-7" style={{borderBottom:"1px solid rgba(36,62,65,0.12)"}}>
        {["Description","Dimensions","Care Guide","Reviews"].map(t=><button key={t} onClick={()=>setTab(t)} className="pb-4 text-[13px] transition-colors"
          style={{color:tab===t?T.teal:"rgba(36,62,65,0.45)",borderBottom:tab===t?`2px solid ${T.gold}`:"2px solid transparent",marginBottom:"-1px"}}>{t}</button>)}
      </div>
      <p className="max-w-2xl text-[14.5px] leading-[1.85]" style={{color:"rgba(36,62,65,0.65)"}}>{tabContent}</p>
      {tab==="Care Guide"&&<button onClick={()=>navigate("care-guide")} className="text-[12px] uppercase tracking-[0.08em] underline mt-4 inline-block" style={{color:T.gold}}>Full Care Guide →</button>}
    </section>
    {related.length>0&&<section className="px-6 md:px-14 pb-24 max-w-[1280px] mx-auto">
      <p className="text-[12px] tracking-[0.2em] uppercase mb-8" style={{color:T.gold}}>You May Also Like</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
        {related.map(p=><ProductCard key={p.id} product={p} navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} setWishlist={setWishlist}/>)}
      </div>
    </section>}
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center gap-3 px-4 py-3" style={{backgroundColor:T.card,boxShadow:"0 -8px 24px -14px rgba(36,62,65,0.2)",borderTop:"1px solid rgba(36,62,65,0.1)"}}>
      <div className="shrink-0">
        <p className="text-[10px] uppercase tracking-[0.05em]" style={{color:"rgba(36,62,65,0.5)"}}>Price</p>
        <p className="text-[16px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{product.price}</p>
      </div>
      <button onClick={addToCart} disabled={soldOut} className="flex-1 py-3.5 text-[11.5px] tracking-[0.12em] uppercase font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed" style={{backgroundColor:T.teal}}>{soldOut?"Sold Out":"Add to Cart"}</button>
      <button onClick={()=>setWishlist(w=>w.includes(product.id)?w.filter(x=>x!==product.id):[...w,product.id])} aria-label="Wishlist" className="w-11 h-11 flex items-center justify-center shrink-0" style={{border:"1px solid rgba(36,62,65,0.2)"}}>
        <Heart size={15} style={{color:isWished?T.gold:T.teal,fill:isWished?T.gold:"none"}}/>
      </button>
    </div>
    <div className="lg:hidden" style={{height:"76px"}}/>
    <div className="fixed bottom-24 lg:bottom-8 left-1/2 -translate-x-1/2 px-6 py-3.5 text-[13px] flex items-center gap-2 z-50 pointer-events-none transition-all duration-300"
      style={{backgroundColor:T.teal,color:"white",boxShadow:"0 20px 40px -14px rgba(36,62,65,0.4)",opacity:toast?1:0,transform:toast?"translate(-50%,0)":"translate(-50%,12px)"}}>
      <Check size={14} style={{color:T.goldLight}}/> Added to cart
    </div>
  </div>;
}

// Full cart page (/cart). Includes the coupon field (only real code:
// AKARA10, 10% off — hardcoded client-side, no backend to manage codes
// yet) and the GST math (18% flat, matching the business's stated rate
// for both HSN 3924 and 9405). KNOWN LIMITATION: the coupon discount
// lives only in this component's local state — it does NOT carry through
// to CheckoutView's total, which recalculates from cart price alone. That
// needs the coupon state lifted to AkaraApp (or a real backend) to fix
// properly.
function CartView({ navigate, cart, setCart }) {
  const [coupon,setCoupon]=useState(""); const [applied,setApplied]=useState(null); const [couponErr,setCouponErr]=useState("");
  const updateQty=(id,size,d)=>setCart(c=>c.map(i=>i.id===id&&i.size===size?{...i,qty:Math.min(99,Math.max(1,i.qty+d))}:i));
  const removeItem=(id,size)=>setCart(c=>c.filter(i=>!(i.id===id&&i.size===size)));
  const subtotal=cart.reduce((s,i)=>s+i.price*i.qty,0);
  const discount=applied==="AKARA10"?Math.round(subtotal*0.1):0;
  const afterDiscount=subtotal-discount;
  const shipping=afterDiscount===0||afterDiscount>=2500?0:150;
  const gst=Math.round((afterDiscount+shipping)*0.18);
  const total=afterDiscount+shipping+gst;
  const applyCoupon=()=>{
    const code=sanitize(coupon).trim().toUpperCase();
    if(code==="AKARA10"){setApplied(code);setCouponErr("");}
    else{setApplied(null);setCouponErr("Invalid or expired code");}
  };
  if(cart.length===0) return <div className="px-6 py-32 text-center">
    <ShoppingBag size={40} strokeWidth={1} style={{color:"rgba(36,62,65,0.2)",margin:"0 auto 20px"}}/>
    <h1 className="italic text-[26px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Your cart is empty.</h1>
    <p className="text-[14px] mb-8" style={{color:"rgba(36,62,65,0.5)"}}>Let's fix that.</p>
    <SweepButton filled onClick={()=>navigate("shop")}>Explore the Collection</SweepButton>
  </div>;
  return <div className="px-6 md:px-14 py-16 max-w-[1100px] mx-auto">
    <h1 className="italic text-[32px] md:text-[40px] mb-10" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Your Cart</h1>
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-14">
      <div>
        {cart.map(item=><div key={item.id+item.size} className="flex gap-5 py-6" style={{borderBottom:"1px solid rgba(36,62,65,0.1)"}}>
          <div className="w-24 h-24 flex items-center justify-center shrink-0" style={{backgroundColor:T.card,boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
            <item.Art className="w-1/2 h-1/2" style={{color:T.gold,opacity:0.8}}/>
          </div>
          <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-[10px] tracking-[0.1em] uppercase mb-1" style={{color:"rgba(36,62,65,0.4)"}}>{item.cat}</p>
              <h3 className="text-[16px] italic mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{item.name}</h3>
              {item.size&&<p className="text-[11.5px] mb-2" style={{color:"rgba(36,62,65,0.45)"}}>Size: {item.size}</p>}
              <button onClick={()=>removeItem(item.id,item.size)} className="flex items-center gap-1 text-[11px] uppercase tracking-wide" style={{color:"rgba(36,62,65,0.4)"}}><Trash2 size={11}/> Remove</button>
            </div>
            <div className="flex items-center gap-5">
              <div className="inline-flex items-center" style={{border:"1px solid rgba(36,62,65,0.2)"}}>
                <button onClick={()=>updateQty(item.id,item.size,-1)} className="w-9 h-9 flex items-center justify-center" style={{color:T.teal}} aria-label="Decrease"><Minus size={13}/></button>
                <span className="w-8 text-center text-[14px]" style={{fontFamily:"'Fraunces',serif"}}>{item.qty}</span>
                <button onClick={()=>updateQty(item.id,item.size,1)} className="w-9 h-9 flex items-center justify-center" style={{color:T.teal}} aria-label="Increase"><Plus size={13}/></button>
              </div>
              <p className="text-[15px]" style={{fontFamily:"'Fraunces',serif",color:T.gold}}>₹{item.price*item.qty}</p>
            </div>
          </div>
        </div>)}
      </div>
      <div className="h-fit p-7" style={{backgroundColor:T.card,boxShadow:"0 8px 24px -14px rgba(36,62,65,0.14),0 0 0 1px rgba(36,62,65,0.06)"}}>
        <h2 className="text-[12px] tracking-[0.1em] uppercase mb-5" style={{color:T.teal}}>Order Summary</h2>
        <div className="mb-5">
          <div className="flex gap-2">
            <input value={coupon} onChange={e=>{setCoupon(e.target.value);setCouponErr("");}} placeholder="Coupon code" maxLength={20}
              className="flex-1 bg-transparent outline-none text-[13px]" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"10px 12px",color:T.teal,fontFamily:"'Space Grotesk',sans-serif"}}/>
            <button onClick={applyCoupon} className="px-4 text-[11px] tracking-[0.1em] uppercase" style={{border:`1px solid ${T.teal}`,color:T.teal}}>Apply</button>
          </div>
          {couponErr&&<p className="text-[11.5px] mt-2 flex items-center gap-1" style={{color:T.error}}><AlertCircle size={11}/>{couponErr}</p>}
          {applied&&<p className="text-[11.5px] mt-2 flex items-center gap-1" style={{color:T.success}}><Check size={11}/>Code {applied} applied — 10% off</p>}
        </div>
        {[["Subtotal",`₹${subtotal.toLocaleString("en-IN")}`],...(discount>0?[["Discount",`−₹${discount.toLocaleString("en-IN")}`]]:[]),["Shipping",shipping===0?"Free":`₹${shipping}`],["GST (18%)",`₹${gst.toLocaleString("en-IN")}`]].map(([l,v])=><div key={l} className="flex justify-between mb-3 text-[13.5px]" style={{color:l==="Discount"?T.success:"rgba(36,62,65,0.7)"}}><span>{l}</span><span>{v}</span></div>)}
        <div className="flex justify-between items-baseline pt-4 mb-6" style={{borderTop:"1px solid rgba(36,62,65,0.12)"}}>
          <span className="text-[13px]" style={{color:T.teal}}>Total</span>
          <span className="text-[22px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{total.toLocaleString("en-IN")}</span>
        </div>
        <button onClick={()=>navigate("checkout")} className="w-full py-4 text-[12px] tracking-[0.14em] uppercase font-medium text-white" style={{backgroundColor:T.teal}}>Proceed to Checkout</button>
        {afterDiscount<2500&&afterDiscount>0&&<p className="text-[11.5px] mt-4 text-center" style={{color:"rgba(36,62,65,0.5)"}}>Add ₹{2500-afterDiscount} more for free shipping</p>}
        <div className="flex flex-col gap-2.5 mt-6 pt-6" style={{borderTop:"1px solid rgba(36,62,65,0.1)"}}>
          <div className="flex items-center gap-2 text-[11.5px]" style={{color:"rgba(36,62,65,0.55)"}}><RotateCcw size={13} style={{color:T.gold}}/>Free shipping on orders above ₹2,500</div>
          <div className="flex items-center gap-2 text-[11.5px]" style={{color:"rgba(36,62,65,0.55)"}}><Lock size={13} style={{color:T.gold}}/>Secure payment via Razorpay</div>
          <div className="flex items-center gap-2 text-[11.5px]" style={{color:"rgba(36,62,65,0.55)"}}><Check size={13} style={{color:T.gold}}/>7-day returns on damaged or defective pieces</div>
        </div>
      </div>
    </div>
  </div>;
}

// Checkout page (/checkout). The 3-step visual (Cart -> Shipping
// Details -> Payment) is VISUAL ONLY — there's no multi-step form logic,
// it's one flat form; "Payment" as a step is aspirational until Razorpay
// is actually integrated (currently placeOrder() just fabricates an
// order immediately on submit, no real payment gateway involved).
function CheckoutView({ navigate, cart, placeOrder }) {
  const [form,setForm]=useState({name:"",email:"",phone:"",address:"",city:"",state:"",pin:""});
  const [errors,setErrors]=useState({});
  const upd=k=>v=>setForm(f=>({...f,[k]:v}));
  const subtotal=cart.reduce((s,i)=>s+i.price*i.qty,0);
  const shipping=subtotal>=2500?0:150;
  const gst=Math.round((subtotal+shipping)*0.18);
  const total=subtotal+shipping+gst;
  const validate=()=>{
    const e={};
    if(!sanitize(form.name).trim()) e.name="Required";
    if(!validEmail(form.email)) e.email="Valid email required";
    if(!sanitize(form.address).trim()) e.address="Required";
    if(!sanitize(form.city).trim()) e.city="Required";
    if(!/^\d{6}$/.test(form.pin)) e.pin="Valid 6-digit PIN required";
    setErrors(e); return Object.keys(e).length===0;
  };
  return <div className="px-6 md:px-14 py-16 max-w-[1100px] mx-auto">
    <h1 className="italic text-[32px] md:text-[40px] mb-8" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Checkout</h1>
    <div className="flex items-center gap-3 mb-12 flex-wrap">
      {[{n:1,label:"Cart",done:true},{n:2,label:"Shipping Details",done:false,current:true},{n:3,label:"Payment",done:false}].map((s,i,arr)=><div key={s.n} className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] shrink-0" style={s.done?{backgroundColor:T.gold,color:"white"}:s.current?{backgroundColor:T.teal,color:"white"}:{border:"1px solid rgba(36,62,65,0.25)",color:"rgba(36,62,65,0.4)"}}>
            {s.done?<Check size={13}/>:s.n}
          </div>
          <span className="text-[12.5px] whitespace-nowrap" style={{color:s.current?T.teal:s.done?T.teal:"rgba(36,62,65,0.4)"}}>{s.label}</span>
        </div>
        {i<arr.length-1&&<div className="w-8 sm:w-16 h-px" style={{backgroundColor:s.done?T.gold:"rgba(36,62,65,0.2)"}}/>}
      </div>)}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-14">
      <form onSubmit={e=>{e.preventDefault();if(validate())placeOrder(form);}} noValidate>
        <h2 className="text-[12px] tracking-[0.1em] uppercase mb-5" style={{color:T.teal}}>Contact</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <InputField label="Full Name" value={form.name} onChange={upd("name")} error={errors.name} required/>
          <InputField label="Email" type="email" value={form.email} onChange={upd("email")} error={errors.email} required/>
          <div className="sm:col-span-2"><InputField label="Phone" type="tel" value={form.phone} onChange={upd("phone")}/></div>
        </div>
        <h2 className="text-[12px] tracking-[0.1em] uppercase mb-5" style={{color:T.teal}}>Shipping Address</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <div className="sm:col-span-2"><InputField label="Address" value={form.address} onChange={upd("address")} error={errors.address} required/></div>
          <InputField label="City" value={form.city} onChange={upd("city")} error={errors.city} required/>
          <InputField label="State" value={form.state} onChange={upd("state")}/>
          <InputField label="PIN Code" value={form.pin} onChange={upd("pin")} error={errors.pin} maxLength={6} required/>
        </div>
        <button type="submit" className="w-full py-4 text-[12px] tracking-[0.14em] uppercase font-medium text-white" style={{backgroundColor:T.teal}}>
          Place Order — ₹{total.toLocaleString("en-IN")}
        </button>
        <p className="text-[11.5px] mt-4 flex items-center gap-2" style={{color:"rgba(36,62,65,0.5)"}}><Lock size={11}/> Secure checkout via Razorpay</p>
      </form>
      <div className="h-fit p-7" style={{backgroundColor:T.card,boxShadow:"0 8px 24px -14px rgba(36,62,65,0.14),0 0 0 1px rgba(36,62,65,0.06)"}}>
        <h2 className="text-[12px] tracking-[0.1em] uppercase mb-5" style={{color:T.teal}}>Summary</h2>
        {cart.map(i=><div key={i.id+i.size} className="flex justify-between text-[13px] mb-2.5" style={{color:"rgba(36,62,65,0.7)"}}><span>{i.name} × {i.qty}</span><span>₹{i.price*i.qty}</span></div>)}
        <div className="pt-4 mt-3 flex flex-col gap-2.5 text-[13.5px]" style={{borderTop:"1px solid rgba(36,62,65,0.12)",color:"rgba(36,62,65,0.7)"}}>
          {[["Subtotal",`₹${subtotal.toLocaleString("en-IN")}`],["Shipping",shipping===0?"Free":`₹${shipping}`],["GST (18%)",`₹${gst.toLocaleString("en-IN")}`]].map(([l,v])=><div key={l} className="flex justify-between"><span>{l}</span><span>{v}</span></div>)}
        </div>
        <div className="flex justify-between items-baseline pt-4 mt-3" style={{borderTop:"1px solid rgba(36,62,65,0.12)"}}>
          <span className="text-[13px]" style={{color:T.teal}}>Total</span>
          <span className="text-[20px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{total.toLocaleString("en-IN")}</span>
        </div>
      </div>
    </div>
  </div>;
}

// Order confirmation page, shown immediately after placeOrder() in
// AkaraApp. `order` is the single most-recent order — there's no order
// history/database, so this and every other post-purchase page can only
// ever show the last order placed in this browser session.
function OrderConfirmedView({ navigate, order }) {
  if(!order) return <div className="px-6 py-32 text-center"><SweepButton filled onClick={()=>navigate("shop")}>Back to Shop</SweepButton></div>;
  return <div className="px-6 py-20 max-w-[600px] mx-auto text-center">
    <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-7" style={{backgroundColor:"rgba(184,147,90,0.12)"}}>
      <Check size={22} style={{color:T.gold}}/>
    </div>
    <p className="text-[12px] tracking-[0.2em] uppercase mb-4" style={{color:T.gold}}>Order Confirmed</p>
    <h1 className="italic text-[28px] md:text-[34px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Thank you, {sanitize(order.name).split(" ")[0]}.</h1>
    <p className="text-[14.5px] leading-[1.8] mb-10" style={{color:"rgba(36,62,65,0.6)"}}>
      Your order <strong style={{color:T.teal}}>#{order.orderNumber}</strong> is confirmed. We'll email {sanitize(order.email)} once it ships — typically 2–3 weeks.
    </p>
    <div className="text-left p-7 mb-8" style={{backgroundColor:T.card,boxShadow:"0 8px 24px -14px rgba(36,62,65,0.14),0 0 0 1px rgba(36,62,65,0.06)"}}>
      {order.items.map(i=><div key={i.id+i.size} className="flex justify-between text-[13.5px] mb-3" style={{color:"rgba(36,62,65,0.7)"}}><span>{i.name} × {i.qty}</span><span>₹{i.price*i.qty}</span></div>)}
      <div className="flex justify-between items-baseline pt-4 mt-3" style={{borderTop:"1px solid rgba(36,62,65,0.12)"}}>
        <span className="text-[13px]" style={{color:T.teal}}>Total Paid</span>
        <span className="text-[19px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{order.total.toLocaleString("en-IN")}</span>
      </div>
    </div>
    <p className="text-[13px] mb-8" style={{color:"rgba(36,62,65,0.5)"}}>Shipping to: {sanitize(order.address)}, {sanitize(order.city)}</p>
    <div className="flex flex-col sm:flex-row gap-4 justify-center mb-4">
      <SweepButton filled onClick={()=>navigate("shop")}>Continue Shopping</SweepButton>
      <SweepButton onClick={()=>navigate("order-status")}>View Order Status</SweepButton>
    </div>
    <button onClick={()=>navigate("invoice")} className="text-[12.5px] underline mx-auto block" style={{color:T.gold}}>Download Invoice</button>
  </div>;
}

const ORDER_STAGES=[
  {key:"confirmed",label:"Confirmed",icon:Check,desc:"We've received your order and payment."},
  {key:"production",label:"Production",icon:Package,desc:"Your piece is being 3D-printed to order."},
  {key:"qc",label:"QC & Packaging",icon:ClipboardCheck,desc:"Quality-checked and carefully packed."},
  {key:"dispatch",label:"Dispatched",icon:Truck,desc:"Handed to our courier partner."},
  {key:"delivered",label:"Delivered",icon:MapPin,desc:"Arrived at your address."},
];
// Fakes a production-status stage (0-4: Confirmed/Production/QC/
// Dispatched/Delivered) based on elapsed time since order.placedAt, since
// there's no real backend/courier integration to report actual status.
// Used by OrderStatusView and the My Account order card's status badge.
// Replace with a real status field once a backend exists.
function stageIndexFromOrder(order){
  if(!order) return 0;
  const daysSince=(Date.now()-(order.placedAt||Date.now()))/86400000;
  if(daysSince>=18) return 4;
  if(daysSince>=16) return 3;
  if(daysSince>=14) return 2;
  return 0;
}
// Downloadable/printable GST tax invoice (/invoice) — "Download Invoice"
// on Order Confirmed, Order Status, and My Account all route here. Uses
// window.print() (browser's native Print-to-PDF) rather than a PDF
// library, since there's no build tooling/package.json yet to add one.
// CGST+SGST are split from order.total (NOT recalculated independently)
// specifically to avoid a rounding mismatch between what was actually
// charged and what the invoice displays. Assumes intra-state
// (Maharashtra) shipping — no IGST logic for out-of-state orders, since
// there's no backend yet to detect customer state and branch the tax
// calculation.
function InvoiceView({ navigate, order }){
  if(!order) return <div className="px-6 py-32 text-center">
    <ClipboardCheck size={40} strokeWidth={1} style={{color:"rgba(36,62,65,0.2)",margin:"0 auto 20px"}}/>
    <h1 className="italic text-[26px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>No invoice to show yet.</h1>
    <SweepButton filled onClick={()=>navigate("shop")}>Explore the Collection</SweepButton>
  </div>;
  const subtotal=order.items.reduce((s,i)=>s+i.price*i.qty,0);
  const shipCost=subtotal>=2500?0:150;
  const totalTax=order.total-subtotal-shipCost;
  const cgst=Math.round(totalTax/2);
  const sgst=totalTax-cgst;
  const grandTotal=order.total;
  const invoiceDate=order.placedAt?new Date(order.placedAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}):"";
  return <div className="px-6 md:px-14 py-10 max-w-[860px] mx-auto">
    <div className="no-print flex justify-between items-center mb-8">
      <button onClick={()=>navigate("account")} className="text-[12.5px] flex items-center gap-1" style={{color:T.teal}}><ChevronRight size={14} style={{transform:"rotate(180deg)"}}/> Back</button>
      <SweepButton filled onClick={()=>window.print()}>Print / Save as PDF</SweepButton>
    </div>
    <div className="invoice-print-area p-8 md:p-12" style={{backgroundColor:"white",boxShadow:"0 0 0 1px rgba(36,62,65,0.1)"}}>
      <div className="flex justify-between items-start mb-10 pb-8 flex-wrap gap-6" style={{borderBottom:`2px solid ${T.teal}`}}>
        <div>
          <p className="text-[22px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}><Mac>A</Mac>K<Mac>A</Mac>RA</p>
          <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.6)"}}>Precision Forge Labs</p>
          <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.6)"}}>Thane, Maharashtra 400601</p>
          <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.6)"}}>GSTIN: 27GZCPS9353H1ZQ</p>
          <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.6)"}}>support@akaraonline.co.in · +91 82780 85572</p>
        </div>
        <div className="text-right">
          <p className="text-[12px] uppercase tracking-[0.1em] mb-2" style={{color:T.gold}}>Tax Invoice</p>
          <p className="text-[13px]" style={{color:T.teal}}>Invoice #: {order.orderNumber}</p>
          <p className="text-[13px]" style={{color:T.teal}}>Date: {invoiceDate}</p>
        </div>
      </div>
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.1em] mb-2" style={{color:"rgba(36,62,65,0.5)"}}>Billed & Shipped To</p>
        <p className="text-[14px]" style={{color:T.teal}}>{sanitize(order.name)}</p>
        <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.6)"}}>{sanitize(order.address)}, {sanitize(order.city)}{order.state?`, ${sanitize(order.state)}`:""}{order.pin?` — ${sanitize(order.pin)}`:""}</p>
        {order.phone&&<p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.6)"}}>{sanitize(order.phone)}</p>}
        {order.email&&<p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.6)"}}>{sanitize(order.email)}</p>}
      </div>
      <table className="w-full text-[12.5px] mb-8" style={{borderCollapse:"collapse"}}>
        <thead>
          <tr style={{backgroundColor:T.teal}}>
            {["Item","HSN","Qty","Rate","Amount"].map((h,i)=><th key={h} className="py-2.5 px-2 text-left" style={{color:"white",fontWeight:500,textAlign:i>=2?"right":"left"}}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {order.items.map(i=><tr key={i.id+i.size} style={{borderBottom:"1px solid rgba(36,62,65,0.1)"}}>
            <td className="py-2.5 px-2">{i.name}{i.size?` (${i.size})`:""}</td>
            <td className="py-2.5 px-2">{i.hsn}</td>
            <td className="py-2.5 px-2 text-right">{i.qty}</td>
            <td className="py-2.5 px-2 text-right">₹{i.price.toLocaleString("en-IN")}</td>
            <td className="py-2.5 px-2 text-right">₹{(i.price*i.qty).toLocaleString("en-IN")}</td>
          </tr>)}
        </tbody>
      </table>
      <div className="flex justify-end mb-10">
        <div className="w-full sm:w-[280px]">
          {[["Subtotal",subtotal],["Shipping",shipCost],["CGST (9%)",cgst],["SGST (9%)",sgst]].map(([l,v])=><div key={l} className="flex justify-between text-[12.5px] mb-2" style={{color:"rgba(36,62,65,0.65)"}}><span>{l}</span><span>{v===0?"Free":`₹${v.toLocaleString("en-IN")}`}</span></div>)}
          <div className="flex justify-between pt-3 mt-2" style={{borderTop:`1px solid ${T.teal}`}}>
            <span className="text-[13px]" style={{color:T.teal}}>Total Paid</span>
            <span className="text-[16px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{grandTotal.toLocaleString("en-IN")}</span>
          </div>
        </div>
      </div>
      <p className="text-[10.5px] leading-[1.7]" style={{color:"rgba(36,62,65,0.45)",borderTop:"1px solid rgba(36,62,65,0.1)",paddingTop:"16px"}}>
        This invoice assumes an intra-state (Maharashtra) shipment and shows tax as CGST + SGST accordingly. Every ĀKĀRA piece is made to order — production begins after order confirmation. This is a system-generated invoice and does not require a signature.
      </p>
    </div>
  </div>;
}

// Order tracking page (/order-status) — the 5-stage visual stepper,
// courier-link placeholder, and a WhatsApp deep-link pre-filled with the
// order number. Status comes from the same simulated stageIndexFromOrder()
// used elsewhere, not real courier data.
function OrderStatusView({ navigate, order }) {
  if(!order) return <div className="px-6 py-32 text-center">
    <Truck size={40} strokeWidth={1} style={{color:"rgba(36,62,65,0.2)",margin:"0 auto 20px"}}/>
    <h1 className="italic text-[26px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>No order to track yet.</h1>
    <SweepButton filled onClick={()=>navigate("shop")}>Explore the Collection</SweepButton>
  </div>;
  const currentIdx=stageIndexFromOrder(order);
  const waPhone="918278085572";
  return <div className="px-6 md:px-14 py-16 max-w-[820px] mx-auto">
    <p className="text-[11.5px] tracking-[0.15em] uppercase mb-2" style={{color:T.gold}}>Order #{order.orderNumber}</p>
    <h1 className="italic text-[28px] md:text-[34px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Track Your Order</h1>
    <p className="text-[13.5px] mb-12" style={{color:"rgba(36,62,65,0.55)"}}>Made-to-order pieces take 2–3 weeks in production before they ship.</p>

    <div className="flex flex-col sm:flex-row gap-0 mb-12">
      {ORDER_STAGES.map((s,i)=>{
        const done=i<=currentIdx; const StageIcon=s.icon;
        return <div key={s.key} className="flex sm:flex-col items-start sm:items-center flex-1 gap-3 sm:gap-0 relative">
          <div className="flex sm:flex-col items-center gap-3 sm:gap-3 relative z-10">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{backgroundColor:done?T.teal:T.card,boxShadow:done?"none":"0 0 0 1px rgba(36,62,65,0.15)"}}>
              <StageIcon size={16} style={{color:done?"white":"rgba(36,62,65,0.35)"}}/>
            </div>
          </div>
          <div className="sm:text-center sm:mt-3 pb-6 sm:pb-0">
            <p className="text-[12.5px] sm:text-[12px] uppercase tracking-[0.05em]" style={{color:done?T.teal:"rgba(36,62,65,0.4)"}}>{s.label}</p>
            <p className="hidden sm:block text-[11px] mt-1 max-w-[120px] mx-auto" style={{color:"rgba(36,62,65,0.45)"}}>{s.desc}</p>
          </div>
          {i<ORDER_STAGES.length-1&&<div className="hidden sm:block absolute top-5 left-1/2 w-full h-px" style={{backgroundColor:i<currentIdx?T.teal:"rgba(36,62,65,0.15)"}}/>}
        </div>;
      })}
    </div>

    {currentIdx>=3?<div className="flex items-center justify-between p-5 mb-8" style={{backgroundColor:T.card,boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
      <div className="flex items-center gap-3"><Truck size={16} style={{color:T.gold}}/><p className="text-[13px]" style={{color:T.teal}}>Your order is on its way</p></div>
      <a href="#" onClick={e=>e.preventDefault()} className="text-[11.5px] uppercase tracking-[0.08em]" style={{color:T.gold}}>Track with Courier →</a>
    </div>:<p className="text-[12.5px] mb-8" style={{color:"rgba(36,62,65,0.45)"}}>A courier tracking link will appear here once your order is dispatched.</p>}

    <div className="text-left p-7 mb-8" style={{backgroundColor:T.card,boxShadow:"0 8px 24px -14px rgba(36,62,65,0.14),0 0 0 1px rgba(36,62,65,0.06)"}}>
      {order.items.map(i=><div key={i.id+i.size} className="flex justify-between text-[13.5px] mb-3" style={{color:"rgba(36,62,65,0.7)"}}><span>{i.name} × {i.qty}</span><span>₹{i.price*i.qty}</span></div>)}
      <div className="flex justify-between items-baseline pt-4 mt-3" style={{borderTop:"1px solid rgba(36,62,65,0.12)"}}>
        <span className="text-[13px]" style={{color:T.teal}}>Total Paid</span>
        <span className="text-[19px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{order.total.toLocaleString("en-IN")}</span>
      </div>
    </div>

    <div className="flex flex-col sm:flex-row gap-4 mb-4">
      <a href={`https://wa.me/${waPhone}?text=${encodeURIComponent("Hi, I'd like an update on order #"+order.orderNumber)}`} target="_blank" rel="noopener noreferrer" className="flex-1">
        <SweepButton className="w-full">Ask on WhatsApp</SweepButton>
      </a>
      <SweepButton filled className="flex-1" onClick={()=>navigate("shop")}>Continue Shopping</SweepButton>
    </div>
    <button onClick={()=>navigate("invoice")} className="text-[12.5px] underline mx-auto block" style={{color:T.gold}}>Download Invoice</button>
  </div>;
}

// Payment failure page (/payment-failed). Built and reachable by
// URL/state, but nothing currently routes into it on a real failure —
// there's no real payment gateway wired up yet to actually fail against.
function PaymentFailedView({ navigate }) {
  return <div className="px-6 py-20 max-w-[560px] mx-auto text-center">
    <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-7" style={{backgroundColor:"rgba(192,57,43,0.08)"}}>
      <XCircle size={22} style={{color:T.error}}/>
    </div>
    <p className="text-[12px] tracking-[0.2em] uppercase mb-4" style={{color:T.error}}>Payment Failed</p>
    <h1 className="italic text-[28px] md:text-[34px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>We couldn't process your payment.</h1>
    <p className="text-[14.5px] leading-[1.8] mb-10" style={{color:"rgba(36,62,65,0.6)"}}>
      Your card or bank may have declined the transaction, or the payment window timed out. No amount has been deducted — if you do see a debit, it will be auto-reversed by your bank within 5–7 business days.
    </p>
    <div className="text-left p-6 mb-10" style={{backgroundColor:T.card,boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
      <p className="text-[12px] uppercase tracking-[0.08em] mb-3" style={{color:T.teal}}>What you can do</p>
      <ul className="flex flex-col gap-2">
        {["Try again with the same or a different payment method","Check your bank balance and card limits","Contact your bank if the issue persists"].map(t=><li key={t} className="flex items-start gap-2 text-[13px]" style={{color:"rgba(36,62,65,0.65)"}}><Check size={13} style={{color:T.gold,marginTop:3,flexShrink:0}}/>{t}</li>)}
      </ul>
    </div>
    <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
      <SweepButton filled onClick={()=>navigate("checkout")}>Retry Payment</SweepButton>
      <SweepButton onClick={()=>navigate("cart")}>Back to Cart</SweepButton>
    </div>
    <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.5)"}}>Still stuck? Email <a href="mailto:support@akaraonline.co.in" style={{color:T.gold}}>support@akaraonline.co.in</a></p>
  </div>;
}

// ============================================================================
// AUTH PAGES — Login, Signup, Forgot/Reset Password. All client-side only:
// there is exactly ONE working "account" (test@example.com /
// Password1!, hardcoded below), and it is NOT real authentication. See the
// SECURITY NOTE above the RateLimiter class — this entire flow must be
// replaced with real server-side auth before any real customer accounts
// are involved.
// ============================================================================
function LoginView({ navigate, onLogin }) {
  const [email,setEmail]=useState(""); const [pw,setPw]=useState(""); const [err,setErr]=useState(""); const [locked,setLocked]=useState(0);
  useEffect(()=>{ if(locked<=0) return; const t=setInterval(()=>setLocked(s=>{ if(s<=1){clearInterval(t);return 0;} return s-1; }),1000); return ()=>clearInterval(t); },[locked]);
  const submit=e=>{
    e.preventDefault();
    const check=loginLimiter.check();
    if(!check.allowed){setLocked(check.wait);setErr(`Too many attempts. Wait ${check.wait}s.`);return;}
    if(!validEmail(sanitize(email))){setErr("Valid email required");return;}
    if(!pw){setErr("Password required");return;}
    loginLimiter.record();
    if(email==="test@example.com"&&pw==="Password1!"){loginLimiter.reset();onLogin({name:"Test User",email:sanitize(email)});navigate("account");}
    else setErr("Incorrect email or password.");
  };
  return <div className="px-6 py-20 max-w-[440px] mx-auto">
    <h1 className="italic text-[32px] mb-3 text-center" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Sign In</h1>
    <p className="text-[13.5px] text-center mb-10" style={{color:"rgba(36,62,65,0.55)"}}>Don't have an account? <button onClick={()=>navigate("signup")} className="underline" style={{color:T.gold}}>Register</button></p>
    {err&&<div className="flex items-center gap-2 px-4 py-3 mb-5 text-[13px]" style={{backgroundColor:"rgba(192,57,43,0.07)",color:T.error}}><AlertCircle size={14}/>{err}</div>}
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <InputField label="Email" type="email" value={email} onChange={v=>{setEmail(v);setErr("");}} required/>
      <InputField label="Password" type="password" value={pw} onChange={v=>{setPw(v);setErr("");}} required/>
      <div className="flex justify-end"><button type="button" onClick={()=>navigate("forgot-password")} className="text-[12.5px] hover:underline" style={{color:T.gold}}>Forgot password?</button></div>
      <SweepButton filled type="submit" disabled={locked>0} className="w-full">{locked>0?`Try again in ${locked}s`:"Sign In"}</SweepButton>
    </form>
  </div>;
}

// Creates a fake in-memory "session" (no real account is persisted
// anywhere) — exists so the rest of the app (My Account, Orders, etc.)
// has something to demo against before a real backend exists.
function SignupView({ navigate, onLogin }) {
  const [form,setForm]=useState({name:"",email:"",phone:"",pw:"",confirm:""}); const [errors,setErrors]=useState({});
  const upd=k=>v=>setForm(f=>({...f,[k]:v}));
  const strength=pwStrength(form.pw);
  const submit=e=>{
    e.preventDefault();
    const errs={};
    if(!sanitize(form.name).trim()) errs.name="Required";
    if(!validEmail(form.email)) errs.email="Valid email required";
    if(!/^[6-9][0-9]{9}$/.test(form.phone.replace(/[\s+\-]/g,""))) errs.phone="Valid 10-digit Indian mobile number required";
    if(!strength.ok) errs.pw=strength.msg;
    if(form.pw!==form.confirm) errs.confirm="Passwords don't match";
    setErrors(errs); if(Object.keys(errs).length) return;
    onLogin({name:sanitize(form.name),email:sanitize(form.email)}); navigate("account");
  };
  return <div className="px-6 py-20 max-w-[440px] mx-auto">
    <h1 className="italic text-[32px] mb-3 text-center" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Create Account</h1>
    <p className="text-[13.5px] text-center mb-10" style={{color:"rgba(36,62,65,0.55)"}}>Already have one? <button onClick={()=>navigate("login")} className="underline" style={{color:T.gold}}>Sign in</button></p>
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <InputField label="Full Name" value={form.name} onChange={upd("name")} error={errors.name} required/>
      <InputField label="Email" type="email" value={form.email} onChange={upd("email")} error={errors.email} required/>
      <InputField label="Mobile Number" type="tel" value={form.phone} onChange={upd("phone")} error={errors.phone} placeholder="+91 XXXXX XXXXX" required/>
      <div>
        <InputField label="Password" type="password" value={form.pw} onChange={upd("pw")} error={errors.pw} required/>
        {form.pw&&<div className="mt-2 flex items-center gap-2">
          <div className="flex gap-1">
            {[form.pw.length>=8,/[A-Z]/.test(form.pw),/[0-9]/.test(form.pw),/[^A-Za-z0-9]/.test(form.pw)].map((met,i)=><div key={i} className="w-6 h-1" style={{backgroundColor:met?T.gold:"rgba(36,62,65,0.15)"}}/>)}
          </div>
          <span className="text-[11px]" style={{color:strength.ok?T.success:"rgba(36,62,65,0.5)"}}>{strength.msg}</span>
        </div>}
      </div>
      <InputField label="Confirm Password" type="password" value={form.confirm} onChange={upd("confirm")} error={errors.confirm} required/>
      <SweepButton filled type="submit" className="w-full">Create Account</SweepButton>
    </form>
  </div>;
}

// Simulates the "email sent" flow with a 60s resend cooldown — no real
// email is ever sent, since there's no backend/email service yet.
function ForgotPasswordView({ navigate }) {
  const [email,setEmail]=useState(""); const [error,setError]=useState(""); const [sent,setSent]=useState(false); const [cooldown,setCooldown]=useState(0);
  useEffect(()=>{ if(cooldown<=0) return; const t=setInterval(()=>setCooldown(s=>{if(s<=1){clearInterval(t);return 0;}return s-1;}),1000); return ()=>clearInterval(t); },[cooldown]);
  const submit=e=>{ e.preventDefault(); if(!validEmail(sanitize(email))){setError("Valid email required");return;} setSent(true); setCooldown(60); };
  if(sent) return <div className="px-6 py-24 max-w-[420px] mx-auto text-center">
    <Check size={40} style={{color:T.gold,margin:"0 auto 20px"}}/>
    <h1 className="italic text-[28px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Check your email</h1>
    <p className="text-[14px] leading-[1.75] mb-8" style={{color:"rgba(36,62,65,0.6)"}}>If <strong>{sanitize(email)}</strong> has an account with us, you'll receive a reset link shortly.</p>
    {cooldown>0?<p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.4)"}}>Resend in {cooldown}s</p>
    :<button onClick={()=>setSent(false)} className="text-[13px] underline" style={{color:T.gold}}>Try a different email</button>}
    <div className="mt-8"><button onClick={()=>navigate("login")} className="text-[13px] underline" style={{color:"rgba(36,62,65,0.5)"}}>Back to Sign In</button></div>
  </div>;
  return <div className="px-6 py-24 max-w-[420px] mx-auto">
    <h1 className="italic text-[32px] mb-3" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Reset Password</h1>
    <p className="text-[14px] leading-[1.75] mb-10" style={{color:"rgba(36,62,65,0.6)"}}>Enter your email and we'll send a reset link if your account exists.</p>
    {error&&<div className="flex items-center gap-2 px-4 py-3 mb-5 text-[13px]" style={{backgroundColor:"rgba(192,57,43,0.07)",color:T.error}}><AlertCircle size={14}/>{error}</div>}
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <InputField label="Email" type="email" value={email} onChange={v=>{setEmail(v);setError("");}} required/>
      <SweepButton filled type="submit" className="w-full">Send Reset Link</SweepButton>
    </form>
    <div className="mt-6 text-center"><button onClick={()=>navigate("login")} className="text-[13px] underline" style={{color:"rgba(36,62,65,0.5)"}}>Back to Sign In</button></div>
  </div>;
}

// Simulates setting a new password (with the live strength-bar UI) —
// nothing is actually persisted; this is UI/UX scaffolding for the real
// flow once a backend exists.
function ResetPasswordView({ navigate }) {
  const [pw,setPw]=useState(""); const [confirm,setConfirm]=useState(""); const [errors,setErrors]=useState({}); const [done,setDone]=useState(false);
  const strength=pwStrength(pw);
  const submit=e=>{ e.preventDefault(); const errs={}; if(!strength.ok) errs.pw=strength.msg; if(pw!==confirm) errs.confirm="Passwords don't match"; setErrors(errs); if(!Object.keys(errs).length) setDone(true); };
  if(done) return <div className="px-6 py-24 max-w-[420px] mx-auto text-center">
    <Check size={40} style={{color:T.gold,margin:"0 auto 20px"}}/>
    <h1 className="italic text-[28px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Password Updated</h1>
    <p className="text-[14px] mb-8" style={{color:"rgba(36,62,65,0.6)"}}>Your password has been changed. You can now sign in.</p>
    <SweepButton filled onClick={()=>navigate("login")}>Sign In</SweepButton>
  </div>;
  return <div className="px-6 py-24 max-w-[420px] mx-auto">
    <h1 className="italic text-[32px] mb-3" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>New Password</h1>
    <p className="text-[14px] mb-10" style={{color:"rgba(36,62,65,0.6)"}}>Choose a strong password for your account.</p>
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div>
        <InputField label="New Password" type="password" value={pw} onChange={v=>{setPw(v);setErrors({});}} error={errors.pw} required/>
        {pw&&<div className="mt-2 flex items-center gap-2">
          <div className="flex gap-1">
            {[pw.length>=8,/[A-Z]/.test(pw),/[0-9]/.test(pw),/[^A-Za-z0-9]/.test(pw)].map((met,i)=><div key={i} className="w-6 h-1" style={{backgroundColor:met?T.gold:"rgba(36,62,65,0.15)"}}/>)}
          </div>
          <span className="text-[11px]" style={{color:strength.ok?T.success:"rgba(36,62,65,0.5)"}}>{strength.msg}</span>
        </div>}
      </div>
      <InputField label="Confirm Password" type="password" value={confirm} onChange={v=>{setConfirm(v);setErrors({});}} error={errors.confirm} required/>
      <SweepButton filled type="submit" className="w-full">Update Password</SweepButton>
    </form>
  </div>;
}

// Brand story page (/about) — studio, materials, "why made to order"
// positioning. Real, final copy (not placeholder).
function AboutView({ navigate }) {
  const steps=[["01","Design","Every form is modelled and function-tested before it's offered."],["02","Order","Nothing is produced speculatively. Your order starts the queue."],["03","Print","Precision 3D-printed in our Mumbai studio, layer by layer."],["04","Finish","Hand-finished and quality-checked before leaving the studio."],["05","Ship","Tracked delivery, typically 2–3 weeks from order to door."]];
  return <div>
    <section className="px-6 py-24 md:py-28 text-center max-w-[800px] mx-auto">
      <p className="text-[12px] tracking-[0.3em] uppercase mb-7" style={{color:T.gold}}>About <Mac>A</Mac>K<Mac>A</Mac>RA</p>
      <h1 className="italic text-[32px] md:text-[50px] leading-[1.2] mb-7" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>
        Ākāra is Sanskrit for <span style={{color:T.gold}}>form</span> — the idea that shape itself carries meaning.
      </h1>
      <p className="text-[16px] leading-[1.8] max-w-[540px] mx-auto" style={{color:"rgba(36,62,65,0.65)"}}>We make geometric home décor the way we think it should be made — nothing shaped by what's cheap to mould in bulk, only what actually works, and only once you've asked for it.</p>
    </section>
    <section className="px-6 max-w-[760px] mx-auto pb-24">
      <p className="text-[19px] italic leading-[1.5] mb-7" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Most home décor is designed to be produced, not to be lived with.</p>
      <p className="text-[16px] leading-[1.85] mb-6" style={{color:"rgba(36,62,65,0.65)"}}>Shapes get chosen because they're cheap to injection-mould at scale, not because they hold a plant well or earn a real place on a shelf. We build the other way.</p>
      <p className="text-[16px] leading-[1.85]" style={{color:"rgba(36,62,65,0.65)"}}>Every piece starts as a precise geometric idea, tested for drainage, balance, and light diffusion before it's ever offered. And nothing is printed until you order it.</p>
    </section>
    <section className="py-24 md:py-28" style={{backgroundColor:T.teal}}>
      <div className="max-w-[1100px] mx-auto px-6">
        <p className="text-[12px] tracking-[0.3em] uppercase mb-5 text-center" style={{color:T.goldLight}}>How a piece is made</p>
        <h2 className="italic text-[28px] md:text-[36px] text-center mb-14 text-white" style={{fontFamily:"'Fraunces',serif",fontWeight:400}}>From idea to your door.</h2>
        <div className="grid grid-cols-2 md:grid-cols-5" style={{borderTop:"1px solid rgba(255,255,255,0.15)",borderBottom:"1px solid rgba(255,255,255,0.15)"}}>
          {steps.map(([n,t,d],i)=><div key={n} className="py-8 px-4 text-center" style={{borderRight:i<4?"1px solid rgba(255,255,255,0.15)":"none"}}>
            <p className="italic text-[24px] mb-3" style={{fontFamily:"'Fraunces',serif",color:T.goldLight}}>{n}</p>
            <p className="text-[12px] tracking-[0.06em] uppercase mb-2 text-white">{t}</p>
            <p className="text-[11.5px] leading-[1.6]" style={{color:"rgba(255,255,255,0.5)"}}>{d}</p>
          </div>)}
        </div>
      </div>
    </section>
    <section className="px-6 py-24 text-center">
      <p style={{fontSize:"56px",color:T.gold,lineHeight:1,fontFamily:"'Fraunces',serif"}}>"</p>
      <p className="italic text-[20px] leading-[1.7] max-w-[540px] mx-auto mb-6" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>We'd rather make sixty pieces a month that were actually asked for than six hundred that might sell eventually.</p>
      <p className="text-[11px] tracking-[0.1em] uppercase" style={{color:"rgba(36,62,65,0.4)"}}>— The <Mac>A</Mac>K<Mac>A</Mac>RA Studio</p>
    </section>
    <section className="px-6 pb-24 text-center">
      <h2 className="italic text-[26px] md:text-[32px] mb-8" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Ready to bring form into your space?</h2>
      <div className="flex gap-4 justify-center flex-wrap">
        <SweepButton filled onClick={()=>navigate("shop")}>Explore the Collection</SweepButton>
        <SweepButton onClick={()=>navigate("contact")}>Get in Touch</SweepButton>
      </div>
    </section>
  </div>;
}

// The Craft page (/craft) — a deeper, more technical companion to About:
// where About is brand philosophy/story, this page goes into materials
// and the actual production process. Built with real confirmed facts
// (Bambu Lab A1 COMBO, plant-based PLA, Thane studio) rather than generic
// filler — but flagged honestly where more real detail/imagery could be
// added later (see the note near the process section below).
function CraftView({ navigate }){
  return <div>
    <section className="px-6 py-24 md:py-28 text-center max-w-[760px] mx-auto">
      <p className="text-[12px] tracking-[0.3em] uppercase mb-7" style={{color:T.gold}}>The Craft</p>
      <h1 className="italic text-[32px] md:text-[46px] leading-[1.2] mb-7" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>
        Precision, not mass production.
      </h1>
      <p className="text-[16px] leading-[1.8] max-w-[540px] mx-auto" style={{color:"rgba(36,62,65,0.65)"}}>
        "3D-printed" can sound like a shortcut. In our studio it's the opposite — every piece is built layer by layer, to order, with the same attention a small workshop gives a handmade object.
      </p>
    </section>

    <section className="px-6 max-w-[1100px] mx-auto pb-20 grid grid-cols-1 md:grid-cols-3 gap-8">
      {[
        ["Design","Every form starts as a precise geometric model — tested digitally for balance, drainage, and how light moves across it — before it's ever offered for sale. Nothing goes into production until the shape earns its place."],
        ["Material","We print in plant-based PLA, a biodegradable material derived from renewable sources like corn starch, rather than petroleum-based plastic. It's chosen for finish quality and environmental footprint, not just cost."],
        ["Machine","Production runs on Bambu Lab A1 COMBO printers — precision FDM machines capable of the fine layer resolution our geometric designs depend on. Each piece is printed individually, start to finish, for your specific order."],
      ].map(([title,desc])=><div key={title} className="p-8" style={{backgroundColor:T.card,boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
        <p className="italic text-[20px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{title}</p>
        <p className="text-[13.5px] leading-[1.8]" style={{color:"rgba(36,62,65,0.6)"}}>{desc}</p>
      </div>)}
    </section>

    <section className="relative px-6 py-20 md:py-24 text-center overflow-hidden" style={{backgroundColor:T.teal}}>
      <div className="pointer-events-none absolute w-[500px] h-[500px] rounded-full -right-40 -bottom-40" style={{background:"radial-gradient(circle,rgba(184,147,90,0.12),transparent 70%)"}}/>
      <p className="relative text-[12px] tracking-[0.3em] uppercase mb-5" style={{color:T.goldLight}}>The Studio</p>
      <h2 className="relative italic mx-auto max-w-xl leading-[1.3] text-white mb-6" style={{fontFamily:"'Fraunces',serif",fontWeight:400,fontSize:"clamp(24px,3.6vw,36px)"}}>
        Based in Thane, Maharashtra — producing roughly 60 to 90 pieces a month.
      </h2>
      <p className="relative text-[14px] leading-[1.8] max-w-[520px] mx-auto" style={{color:"rgba(255,255,255,0.55)"}}>
        That's a deliberate ceiling, not a limitation we're working around — small enough that every piece gets checked by hand before it ships, large enough to keep queue times honest.
      </p>
    </section>

    <section className="px-6 py-20 max-w-[700px] mx-auto text-center">
      <p className="text-[12.5px] leading-[1.8]" style={{color:"rgba(36,62,65,0.45)"}}>
        This page will grow to include real photos and short video of pieces actually being printed and finished in the studio — planned alongside the site's product photography (see the media gallery on every product page, currently placeholder-ready for exactly this).
      </p>
    </section>

    <section className="px-6 pb-24 text-center">
      <div className="flex gap-4 justify-center flex-wrap">
        <SweepButton filled onClick={()=>navigate("shop")}>Explore the Collection</SweepButton>
        <SweepButton onClick={()=>navigate("care-guide")}>Care Guide</SweepButton>
      </div>
    </section>
  </div>;
}

// Contact page (/contact) — two-path split (General Enquiries vs
// Custom & Bespoke) plus a direct message form. The form's "Thanks —
// your message is in" confirmation is LOCAL STATE ONLY — nothing is
// actually sent anywhere; no backend to receive it yet.
function ContactView() {
  const [form,setForm]=useState({name:"",email:"",message:""}); const [sent,setSent]=useState(false);
  const submit=e=>{ e.preventDefault(); if(!sanitize(form.name).trim()||!validEmail(form.email)||!sanitize(form.message).trim()) return; setSent(true); };
  return <div>
    <section className="px-6 pt-20 pb-16 text-center max-w-[580px] mx-auto">
      <p className="text-[12px] tracking-[0.3em] uppercase mb-6" style={{color:T.gold}}>Contact</p>
      <h1 className="italic text-[32px] md:text-[44px] mb-5" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Let's talk.</h1>
      <p className="text-[15px] leading-[1.75]" style={{color:"rgba(36,62,65,0.6)"}}>Order questions, custom requests, or just curious about a piece — we read every message ourselves.</p>
    </section>
    <section className="px-6 max-w-[900px] mx-auto pb-14 grid grid-cols-1 sm:grid-cols-2" style={{boxShadow:"0 0 0 1px rgba(36,62,65,0.1)"}}>
      {[["General Enquiries","Orders, shipping, returns.","Already ordered, or have a question? Fastest way to reach us for anything order-related.","support@akaraonline.co.in","mailto:support@akaraonline.co.in"],
        ["Custom & Bespoke","Something specific in mind?","Custom sizing, colours outside the standard range, or a wholesale enquiry — tell us what you're picturing.","info@akaraonline.co.in","mailto:info@akaraonline.co.in"]
      ].map(([label,title,desc,email,href])=><div key={label} className="p-9" style={{backgroundColor:T.teal,borderRight:"1px solid rgba(255,255,255,0.08)"}}>
        <p className="text-[11px] tracking-[0.1em] uppercase mb-4" style={{color:T.goldLight}}>{label}</p>
        <h2 className="italic text-[21px] mb-4 text-white" style={{fontFamily:"'Fraunces',serif"}}>{title}</h2>
        <p className="text-[13.5px] leading-[1.7] mb-5" style={{color:"rgba(255,255,255,0.6)"}}>{desc}</p>
        <a href={href} className="text-[12.5px] hover:opacity-70 transition-opacity" style={{color:T.goldLight}}>{email}</a>
      </div>)}
    </section>
    <section className="px-6 max-w-[580px] mx-auto pb-24">
      <h2 className="italic text-[22px] text-center mb-9" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Or send it straight to us.</h2>
      {sent?<p className="text-center text-[14px] py-8" style={{color:T.gold}}>Thanks — your message is in. We reply within 72 hours.</p>
      :<form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField label="Name" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} required/>
          <InputField label="Email" type="email" value={form.email} onChange={v=>setForm(f=>({...f,email:v}))} required/>
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Message *</label>
          <textarea required rows={5} value={form.message} onChange={e=>setForm(f=>({...f,message:sanitize(e.target.value)}))} maxLength={2000}
            className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"13px 14px",color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
        </div>
        <SweepButton filled type="submit" className="w-full">Send Message</SweepButton>
      </form>}
    </section>
  </div>;
}

// All FAQ content, grouped by category (General / Orders & Payment /
// Shipping / Returns / Product Care). FAQView (below) renders whichever
// category is selected.
const FAQ_DATA={
  General:[["What is your production lead time?","Every piece is made to order. Production takes 2–3 weeks, then it ships."],["Do you offer custom sizes?","We offer the sizes and finishes listed on each product page. For custom or bulk requests, reach out via Contact."],["Where are your pieces made?","Designed and 3D-printed in our Mumbai studio using plant-based PLA."]],
  "Orders & Payment":[["What payment methods do you accept?","Cards, UPI, and net banking via Razorpay."],["Can I change my order?","Since production starts quickly, reach out within a few hours of ordering."]],
  Shipping:[["How much does shipping cost?","Free above ₹2,500, otherwise ₹150 standard or ₹199 express."],["How long does delivery take?","2–3 weeks production, then 3–7 business days for delivery."]],
  Returns:[["What's your return policy?","7-day return window for damaged or defective pieces, 30-day warranty on all items."],["How do I request a return?","Use the Request a Return page with your order number and reason — it opens a pre-filled email to our team with everything we need."]],
  "Product Care":[["How do I clean my ĀKĀRA piece?","Wipe gently with a soft, dry microfibre cloth. For planters and vases, a lightly damp cloth is fine — avoid soaking, as this is 3D-printed PLA, not ceramic."],["Can I use these outdoors?","Plant-based PLA is not UV or heavily weather-resistant. We recommend indoor or covered, shaded outdoor use only — prolonged direct sun or rain can warp the material over time."],["Is it safe near water or soil moisture?","Yes for everyday planting and styling use. Avoid prolonged submersion. Line planters with a nursery pot if watering directly."],["How do I care for lamps and lighting pieces?","Dust with a dry cloth only. Never submerge the base or fitting. Use the specified bulb wattage to avoid heat buildup near the printed shade."],["Will the finish fade over time?","With normal indoor use, colour is stable for years. Direct, sustained sunlight will fade any pigment gradually — reposition occasionally if placed near a window."]],
};

// FAQ page (/faq) — accordion per category, reading from FAQ_DATA
// above. Includes the "Still have questions?" contact card, shown in the
// sidebar on desktop and below the list on mobile.
function FAQView() {
  const [cat,setCat]=useState("General"); const [openIdx,setOpenIdx]=useState(0);
  return <div className="px-6 md:px-14 py-16 max-w-[1100px] mx-auto">
    <h1 className="italic text-[32px] md:text-[44px] text-center mb-12" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Frequently Asked Questions</h1>
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-12">
      <div className="flex md:flex-col gap-2 overflow-x-auto">
        {Object.keys(FAQ_DATA).map(c=><button key={c} onClick={()=>{setCat(c);setOpenIdx(0);}}
          className="text-left px-4 py-3 text-[13.5px] shrink-0 transition-colors whitespace-nowrap"
          style={cat===c?{backgroundColor:T.teal,color:"white"}:{color:T.teal}}>{c}</button>)}
        <div className="hidden md:block mt-6 p-5" style={{border:`1px solid ${T.gold}`}}>
          <p className="text-[13px] italic mb-2" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Still have questions?</p>
          <p className="text-[12px] leading-[1.6] mb-4" style={{color:"rgba(36,62,65,0.6)"}}>We're happy to help with anything not covered here.</p>
          <a href="mailto:support@akaraonline.co.in" className="text-[11.5px] uppercase tracking-[0.08em]" style={{color:T.gold}}>Contact Us →</a>
        </div>
      </div>
      <div>
        {FAQ_DATA[cat].map(([q,a],i)=><div key={q} style={{borderBottom:"1px solid rgba(36,62,65,0.12)"}}>
          <button onClick={()=>setOpenIdx(openIdx===i?-1:i)} className="w-full flex justify-between items-center py-5 text-left">
            <span className="text-[15px]" style={{color:T.teal}}>{q}</span>
            <Plus size={16} style={{color:T.gold,transform:openIdx===i?"rotate(45deg)":"none",transition:"transform 0.2s",flexShrink:0}}/>
          </button>
          <div className="overflow-hidden transition-[grid-template-rows] duration-300" style={{display:"grid",gridTemplateRows:openIdx===i?"1fr":"0fr"}}>
            <div className="overflow-hidden"><p className="text-[13.5px] leading-[1.8] pb-5" style={{color:"rgba(36,62,65,0.62)"}}>{a}</p></div>
          </div>
        </div>)}
        <div className="md:hidden mt-8 p-5" style={{border:`1px solid ${T.gold}`}}>
          <p className="text-[13px] italic mb-2" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Still have questions?</p>
          <p className="text-[12px] leading-[1.6] mb-4" style={{color:"rgba(36,62,65,0.6)"}}>We're happy to help with anything not covered here.</p>
          <a href="mailto:support@akaraonline.co.in" className="text-[11.5px] uppercase tracking-[0.08em]" style={{color:T.gold}}>Contact Us →</a>
        </div>
      </div>
    </div>
  </div>;
}

// Account dashboard (/account) — Orders / Wishlist / Addresses /
// Payment Methods / Profile tabs. Since there's no backend, the Orders
// tab can only ever show the single most-recent `order` from this
// session (see OrderConfirmedView's note on this same limitation), and
// Addresses saved here exist only in this component's local state — they
// vanish on refresh, unlike cart/wishlist which persist to localStorage.
function MyAccountView({ navigate, wishlist, setWishlist, user, order }) {
  const [tab,setTab]=useState("Orders");
  const [addresses,setAddresses]=useState([]);
  const [addrForm,setAddrForm]=useState({name:"",line:"",city:"",state:"",pin:"",phone:""});
  const [showAddrForm,setShowAddrForm]=useState(false);
  const wishedProducts=PRODUCTS.filter(p=>wishlist.includes(p.id));
  const addrUpd=k=>v=>setAddrForm(f=>({...f,[k]:v}));
  const saveAddress=()=>{
    if(!sanitize(addrForm.name).trim()||!sanitize(addrForm.line).trim()||!/^\d{6}$/.test(addrForm.pin)) return;
    setAddresses(a=>[...a,{...addrForm,id:Date.now()}]);
    setAddrForm({name:"",line:"",city:"",state:"",pin:"",phone:""});
    setShowAddrForm(false);
  };
  const removeAddress=id=>setAddresses(a=>a.filter(x=>x.id!==id));
  return <div className="px-6 md:px-14 py-16 max-w-[1000px] mx-auto">
    <div className="flex items-end justify-between mb-10 flex-wrap gap-4">
      <h1 className="italic text-[30px] md:text-[38px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>My Account</h1>
      {user&&<p className="text-[13.5px]" style={{color:"rgba(36,62,65,0.55)"}}>Signed in as <strong style={{color:T.teal}}>{user.email}</strong></p>}
    </div>
    <div className="flex gap-8 mb-10 overflow-x-auto" style={{borderBottom:"1px solid rgba(36,62,65,0.12)"}}>
      {["Orders","Wishlist","Addresses","Payment Methods","Profile"].map(t=><button key={t} onClick={()=>setTab(t)} className="pb-4 text-[13px] transition-colors whitespace-nowrap"
        style={{color:tab===t?T.teal:"rgba(36,62,65,0.45)",borderBottom:tab===t?`2px solid ${T.gold}`:"2px solid transparent",marginBottom:"-1px"}}>{t}</button>)}
    </div>
    {tab==="Orders"&&(order
      ?<div className="p-6" style={{backgroundColor:T.card,boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
        <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
          <div>
            <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>#{order.orderNumber}</p>
            <p className="text-[12px]" style={{color:"rgba(36,62,65,0.5)"}}>{order.items.length} item{order.items.length>1?"s":""} · ₹{order.total.toLocaleString("en-IN")}</p>
          </div>
          <span className="text-[10.5px] uppercase tracking-[0.08em] px-3 py-1.5" style={{backgroundColor:"rgba(184,147,90,0.14)",color:T.gold}}>{stageIndexFromOrder(order)>=4?"Delivered":stageIndexFromOrder(order)>=3?"In Transit":"Processing"}</span>
        </div>
        <div className="flex gap-3 flex-wrap">
          <SweepButton onClick={()=>navigate("order-status")}>Track Order</SweepButton>
          <SweepButton onClick={()=>navigate("invoice")}>View Invoice</SweepButton>
          <SweepButton onClick={()=>navigate("return-request")}>Request a Return</SweepButton>
        </div>
      </div>
      :<div className="text-center py-16"><p className="text-[14px] mb-6" style={{color:"rgba(36,62,65,0.5)"}}>No orders yet.</p><SweepButton filled onClick={()=>navigate("shop")}>Explore the Collection</SweepButton></div>
    )}
    {tab==="Addresses"&&<div className="max-w-[560px]">
      {addresses.length===0&&!showAddrForm&&<p className="text-[14px] mb-6" style={{color:"rgba(36,62,65,0.5)"}}>No saved addresses yet.</p>}
      {addresses.map(a=><div key={a.id} className="flex items-start gap-4 p-5 mb-4" style={{backgroundColor:T.card,boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
        <MapPin size={16} style={{color:T.gold,flexShrink:0,marginTop:2}}/>
        <div className="flex-1">
          <p className="text-[14px] mb-1" style={{color:T.teal,fontFamily:"'Fraunces',serif"}}>{a.name}</p>
          <p className="text-[12.5px] leading-[1.6]" style={{color:"rgba(36,62,65,0.6)"}}>{a.line}, {a.city}, {a.state} — {a.pin}</p>
          {a.phone&&<p className="text-[12.5px] mt-1" style={{color:"rgba(36,62,65,0.5)"}}>{a.phone}</p>}
        </div>
        <button onClick={()=>removeAddress(a.id)} style={{color:"rgba(36,62,65,0.4)"}}><Trash2 size={14}/></button>
      </div>)}
      {showAddrForm?<div className="p-6" style={{backgroundColor:T.card,boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <InputField label="Full Name" value={addrForm.name} onChange={addrUpd("name")} required/>
          <InputField label="Phone" type="tel" value={addrForm.phone} onChange={addrUpd("phone")}/>
          <div className="sm:col-span-2"><InputField label="Address Line" value={addrForm.line} onChange={addrUpd("line")} required/></div>
          <InputField label="City" value={addrForm.city} onChange={addrUpd("city")} required/>
          <InputField label="State" value={addrForm.state} onChange={addrUpd("state")}/>
          <InputField label="PIN Code" value={addrForm.pin} onChange={addrUpd("pin")} maxLength={6} required/>
        </div>
        <div className="flex gap-3">
          <SweepButton filled onClick={saveAddress}>Save Address</SweepButton>
          <SweepButton onClick={()=>setShowAddrForm(false)}>Cancel</SweepButton>
        </div>
      </div>:<SweepButton onClick={()=>setShowAddrForm(true)}>+ Add New Address</SweepButton>}
    </div>}
    {tab==="Payment Methods"&&<div className="max-w-[560px]">
      <div className="flex items-start gap-4 p-6 mb-6" style={{backgroundColor:T.card,boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
        <Lock size={18} style={{color:T.gold,flexShrink:0,marginTop:2}}/>
        <div>
          <p className="text-[14px] mb-2" style={{color:T.teal,fontFamily:"'Fraunces',serif"}}>Secured by Razorpay</p>
          <p className="text-[12.5px] leading-[1.7]" style={{color:"rgba(36,62,65,0.6)"}}>We don't store your card, UPI, or bank details. Every payment is processed directly by Razorpay's PCI-DSS compliant checkout at the time of order — cards, UPI, net banking, and wallets are all supported there.</p>
        </div>
      </div>
      <p className="text-[13px] text-center" style={{color:"rgba(36,62,65,0.5)"}}>No saved payment methods to manage — you'll choose how to pay at checkout each time.</p>
    </div>}
    {tab==="Wishlist"&&(wishedProducts.length===0
      ?<p className="text-center py-16 text-[14px]" style={{color:"rgba(36,62,65,0.5)"}}>Nothing saved yet — tap the heart on any product to save it here.</p>
      :<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
        {wishedProducts.map(p=><div key={p.id} onClick={()=>navigate("product",p.id)} className="cursor-pointer group">
          <div className="aspect-square flex items-center justify-center mb-3" style={{backgroundColor:T.card,boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
            <p.Art className="w-1/3 h-1/3 transition-transform group-hover:scale-110 duration-500" style={{color:T.gold,opacity:0.85}}/>
          </div>
          <h3 className="text-[13.5px] italic" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{p.name}</h3>
          <p className="text-[13px]" style={{color:T.gold}}>₹{p.price}</p>
        </div>)}
      </div>
    )}
    {tab==="Profile"&&<div className="max-w-[420px]">
      <div className="flex flex-col gap-5 mb-8">
        <InputField label="Full Name" value={user?.name||""} onChange={()=>{}}/>
        <InputField label="Email" type="email" value={user?.email||""} onChange={()=>{}}/>
      </div>
      <div className="pt-8" style={{borderTop:"1px solid rgba(36,62,65,0.1)"}}>
        <p className="text-[13px] mb-4" style={{color:"rgba(36,62,65,0.55)"}}>Change Password</p>
        <SweepButton onClick={()=>navigate("forgot-password")}>Reset Password</SweepButton>
      </div>
    </div>}
  </div>;
}

// ============================================================================
// NEWER FUNNEL PAGES — built to give specific, currently-underserved
// visitor intents (corporate buyers, someone needing to return an item,
// care questions, email preferences, accessibility) their own real page
// instead of being funneled through the generic Contact form.
// ============================================================================
// Corporate/wholesale enquiry page (/bulk-orders). The form composes a
// pre-filled mailto: link to info@akaraonline.co.in rather than actually
// submitting anywhere — there's no backend to receive/store enquiries
// yet. Still a real upgrade over "just email us": structured fields are
// harder to leave out important details from than a blank message box.
function BulkOrdersView({ navigate }){
  const [form,setForm]=useState({company:"",name:"",email:"",phone:"",quantity:"",interest:"",message:""});
  const [sent,setSent]=useState(false);
  const upd=k=>v=>setForm(f=>({...f,[k]:v}));
  const submit=e=>{
    e.preventDefault();
    if(!sanitize(form.name).trim()||!validEmail(form.email)||!sanitize(form.quantity).trim()) return;
    const body=[
      `Company: ${sanitize(form.company)||"—"}`,`Contact Name: ${sanitize(form.name)}`,`Email: ${sanitize(form.email)}`,
      `Phone: ${sanitize(form.phone)||"—"}`,`Estimated Quantity: ${sanitize(form.quantity)}`,`Product Interest: ${sanitize(form.interest)||"—"}`,
      "",sanitize(form.message),
    ].join("\n");
    window.location.href=`mailto:info@akaraonline.co.in?subject=${encodeURIComponent("Bulk / Corporate Order Enquiry — "+sanitize(form.company||form.name))}&body=${encodeURIComponent(body)}`;
    setSent(true);
  };
  return <div>
    <section className="px-6 pt-20 pb-14 text-center max-w-[640px] mx-auto">
      <p className="text-[12px] tracking-[0.3em] uppercase mb-6" style={{color:T.gold}}>Bulk & Corporate Orders</p>
      <h1 className="italic text-[32px] md:text-[44px] mb-5" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>For hotels, cafés, and corporate gifting.</h1>
      <p className="text-[15px] leading-[1.75]" style={{color:"rgba(36,62,65,0.6)"}}>Ordering more than a handful of pieces — for a property, an office, or a gifting programme? Tell us what you're picturing and we'll put together a custom quote and production timeline, separate from our standard checkout.</p>
    </section>
    <section className="px-6 max-w-[900px] mx-auto pb-16 grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
      {[["Custom Quantities","No minimum stated upfront — tell us your volume and we'll confirm what's realistic within our production capacity."],
        ["Dedicated Timeline","Bulk orders get their own production schedule, communicated clearly rather than the standard 2–3 week estimate."],
        ["Direct Contact","One point of contact for the whole order — no need to place 50 separate carts."]]
        .map(([t,d])=><div key={t} className="p-6" style={{backgroundColor:T.card,boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
          <p className="text-[13.5px] mb-2" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{t}</p>
          <p className="text-[12px] leading-[1.7]" style={{color:"rgba(36,62,65,0.55)"}}>{d}</p>
        </div>)}
    </section>
    <section className="px-6 max-w-[580px] mx-auto pb-24">
      <h2 className="italic text-[22px] text-center mb-9" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Tell us about your order.</h2>
      {sent?<div className="text-center py-8">
        <p className="text-[14px] mb-2" style={{color:T.gold}}>Your email client should have opened with the details filled in.</p>
        <p className="text-[13px]" style={{color:"rgba(36,62,65,0.55)"}}>If it didn't, write to us directly at <a href="mailto:info@akaraonline.co.in" style={{color:T.gold}}>info@akaraonline.co.in</a>.</p>
      </div>
      :<form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField label="Company / Organisation" value={form.company} onChange={upd("company")}/>
          <InputField label="Contact Name" value={form.name} onChange={upd("name")} required/>
          <InputField label="Email" type="email" value={form.email} onChange={upd("email")} required/>
          <InputField label="Phone" type="tel" value={form.phone} onChange={upd("phone")}/>
          <InputField label="Estimated Quantity" value={form.quantity} onChange={upd("quantity")} required/>
          <InputField label="Product(s) of Interest" value={form.interest} onChange={upd("interest")}/>
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Tell us more</label>
          <textarea rows={4} value={form.message} onChange={e=>setForm(f=>({...f,message:sanitize(e.target.value)}))} maxLength={1500}
            className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"13px 14px",color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
        </div>
        <SweepButton filled type="submit" className="w-full">Send Enquiry</SweepButton>
      </form>}
    </section>
  </div>;
}

// Dropdown options for ReturnRequestView below.
const RETURN_REASONS=["Damaged in transit","Defective / manufacturing issue","Wrong item received","Significantly different than described","Changed my mind","Other"];
// Self-service return request page (/return-request). Same mailto:
// pattern as Bulk Orders (composes a pre-filled email to support, no real
// backend submission). If the entered order number matches the current
// session's actual `order`, it confirms "Order found" as a small real-data
// touch — but this only works within the same browser session, since
// there's no order database to look up historical orders against.
function ReturnRequestView({ navigate, order }){
  const [orderNumber,setOrderNumber]=useState(order?.orderNumber||"");
  const [itemName,setItemName]=useState("");
  const [reason,setReason]=useState(RETURN_REASONS[0]);
  const [description,setDescription]=useState("");
  const [contactEmail,setContactEmail]=useState(order?.email||"");
  const [sent,setSent]=useState(false);
  const matchedOrder=order&&order.orderNumber===sanitize(orderNumber).trim()?order:null;
  const submit=e=>{
    e.preventDefault();
    if(!sanitize(orderNumber).trim()||!sanitize(itemName).trim()||!validEmail(contactEmail)) return;
    const body=[
      `Order Number: ${sanitize(orderNumber)}`,`Item: ${sanitize(itemName)}`,`Reason: ${reason}`,
      `Contact Email: ${sanitize(contactEmail)}`,"",sanitize(description),
      "",matchedOrder?"(Order matched in this session — please also attach photos of the item and packaging to this email before sending.)":"(Please also attach photos of the item and packaging to this email before sending.)",
    ].join("\n");
    window.location.href=`mailto:support@akaraonline.co.in?subject=${encodeURIComponent("Return Request — Order "+sanitize(orderNumber))}&body=${encodeURIComponent(body)}`;
    setSent(true);
  };
  return <div className="px-6 md:px-14 py-16 max-w-[600px] mx-auto">
    <p className="text-[12px] tracking-[0.3em] uppercase mb-4 text-center" style={{color:T.gold}}>Returns</p>
    <h1 className="italic text-[30px] md:text-[38px] mb-4 text-center" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Request a Return</h1>
    <p className="text-[13.5px] leading-[1.8] mb-10 text-center" style={{color:"rgba(36,62,65,0.55)"}}>7-day return window for damaged, defective, or significantly-different-than-described pieces. Fill this in and we'll open your email client with everything pre-filled — attach a couple of photos before sending and we'll take it from there.</p>
    {sent?<div className="text-center py-10" style={{backgroundColor:T.card,boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
      <p className="text-[14px] mb-2" style={{color:T.gold}}>Your email client should have opened with the details filled in.</p>
      <p className="text-[13px] px-6" style={{color:"rgba(36,62,65,0.55)"}}>Don't forget to attach photos of the item and packaging before sending — it speeds up the review.</p>
    </div>
    :<form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <InputField label="Order Number" value={orderNumber} onChange={setOrderNumber} placeholder="e.g. AK12345" required/>
      {matchedOrder&&<p className="text-[11.5px] -mt-2" style={{color:T.gold}}>Order found — {matchedOrder.items.length} item{matchedOrder.items.length>1?"s":""} on file.</p>}
      <InputField label="Item Name" value={itemName} onChange={setItemName} required/>
      <div>
        <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Reason</label>
        <select value={reason} onChange={e=>setReason(e.target.value)} className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"13px 14px",color:T.teal,fontFamily:"'Space Grotesk',sans-serif"}}>
          {RETURN_REASONS.map(r=><option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <InputField label="Contact Email" type="email" value={contactEmail} onChange={setContactEmail} required/>
      <div>
        <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Describe what happened</label>
        <textarea rows={4} value={description} onChange={e=>setDescription(sanitize(e.target.value))} maxLength={1500}
          className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"13px 14px",color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
      </div>
      <SweepButton filled type="submit" className="w-full">Submit Return Request</SweepButton>
    </form>}
  </div>;
}

// Content for the standalone Care Guide page below — general care +
// per-category (planters/vases, lighting) + long-term care sections.
const CARE_SECTIONS=[
  {title:"General Care — All Pieces",points:[
    "Wipe gently with a soft, dry microfibre cloth for everyday dusting.",
    "For a deeper clean, a lightly damp cloth is fine — avoid soaking or submerging any piece.",
    "Not dishwasher safe, and not microwave or oven safe.",
    "Avoid prolonged direct sunlight — it won't damage the piece, but pigment will fade gradually over months of constant exposure.",
  ]},
  {title:"Planters & Vases",points:[
    "If watering directly, check the drainage tray regularly to prevent water pooling underneath.",
    "For planters without visible drainage, line with a nursery pot rather than watering directly into the piece.",
    "Fine dust in lattice or ribbed detailing can be lifted with a soft dry brush (an old, clean makeup brush works well).",
    "Avoid prolonged outdoor exposure to rain — plant-based PLA is not fully weatherproof; covered, shaded outdoor spots are fine.",
  ]},
  {title:"Lighting — Pendants, Table & Floor Lamps",points:[
    "Always switch off and allow the fixture to cool before cleaning.",
    "Dust with a dry cloth only — never use a damp cloth near the fitting or wiring.",
    "Use the bulb wattage specified for your piece; overpowered bulbs can cause heat buildup near the printed shade.",
    "If a piece is rated for indoor use only, keep it away from bathrooms or other high-humidity areas.",
  ]},
  {title:"Long-Term Care",points:[
    "Reposition pieces occasionally if they sit near a window, to keep fading even over time.",
    "Small variations in texture or matte finish between pieces are part of the 3D-printing process, not a defect.",
    "If a piece is ever damaged in a way that concerns you, photograph it and reach out — see our Return Request page.",
  ]},
];
// Standalone care instructions page (/care-guide) — real, sectioned
// content (not the old thin shared "Care Guide" tab text). Linked from
// the Footer and from the Care Guide tab on every product page.
function CareGuideView({ navigate }){
  return <div className="px-6 md:px-14 py-16 max-w-[820px] mx-auto">
    <p className="text-[12px] tracking-[0.3em] uppercase mb-4 text-center" style={{color:T.gold}}>Care Guide</p>
    <h1 className="italic text-[32px] md:text-[44px] mb-5 text-center" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Caring for your ĀKĀRA piece</h1>
    <p className="text-[14.5px] leading-[1.85] mb-14 text-center" style={{color:"rgba(36,62,65,0.6)"}}>Every piece is 3D-printed in plant-based PLA — closer in care needs to a fine ceramic than to plastic homeware. A little care keeps the finish and colour looking the way it did on day one.</p>
    {CARE_SECTIONS.map(s=><div key={s.title} className="mb-10">
      <h2 className="text-[17px] italic mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{s.title}</h2>
      <ul className="flex flex-col gap-2.5">
        {s.points.map(p=><li key={p} className="flex items-start gap-2.5 text-[13.5px] leading-[1.7]" style={{color:"rgba(36,62,65,0.65)"}}><Check size={13} style={{color:T.gold,marginTop:4,flexShrink:0}}/>{p}</li>)}
      </ul>
    </div>)}
    <div className="mt-14 p-6 text-center" style={{border:`1px solid ${T.gold}`}}>
      <p className="text-[13px] mb-3" style={{color:"rgba(36,62,65,0.6)"}}>Still unsure about a specific piece?</p>
      <button onClick={()=>navigate("contact")} className="text-[12px] uppercase tracking-[0.1em]" style={{color:T.gold}}>Ask Us Directly →</button>
    </div>
  </div>;
}

// Email subscription management page (/email-preferences) — toggle
// New Arrivals / Promotions / Atelier Notes, or unsubscribe from all.
// UI ONLY: there's no real email service (ESP) integrated yet, so
// nothing here is actually wired to a mailing list — this is the
// interface ready for when one exists.
function EmailPreferencesView({ navigate }){
  const [email,setEmail]=useState("");
  const [prefs,setPrefs]=useState({newArrivals:true,promotions:true,journal:false});
  const [saved,setSaved]=useState(false);
  const [unsubscribed,setUnsubscribed]=useState(false);
  const togglePref=k=>setPrefs(p=>({...p,[k]:!p[k]}));
  const save=e=>{ e.preventDefault(); if(!validEmail(email)) return; setSaved(true); setUnsubscribed(false); };
  const unsubscribeAll=()=>{ if(!validEmail(email)) return; setPrefs({newArrivals:false,promotions:false,journal:false}); setUnsubscribed(true); setSaved(true); };
  return <div className="px-6 md:px-14 py-16 max-w-[520px] mx-auto">
    <p className="text-[12px] tracking-[0.3em] uppercase mb-4 text-center" style={{color:T.gold}}>Email Preferences</p>
    <h1 className="italic text-[30px] md:text-[38px] mb-5 text-center" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Manage what we send you</h1>
    <p className="text-[13.5px] leading-[1.8] mb-10 text-center" style={{color:"rgba(36,62,65,0.55)"}}>Order confirmations, shipping updates, and other transactional emails aren't optional — you'll always get those for an order you place. Everything below is up to you.</p>
    <form onSubmit={save} noValidate className="flex flex-col gap-5">
      <InputField label="Email Address" type="email" value={email} onChange={setEmail} required/>
      <div className="flex flex-col gap-3.5">
        {[["newArrivals","New Arrivals","Be first to know when a new piece or collection drops."],
          ["promotions","Promotions & Offers","Occasional discount codes and sale announcements."],
          ["journal","Atelier Notes","Studio process, styling guides, and behind-the-scenes updates."]]
          .map(([key,label,desc])=><label key={key} className="flex items-start gap-3 cursor-pointer p-4" style={{backgroundColor:T.card,boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
            <input type="checkbox" checked={prefs[key]} onChange={()=>togglePref(key)} className="mt-1" style={{accentColor:T.teal}}/>
            <span>
              <span className="block text-[13.5px]" style={{color:T.teal}}>{label}</span>
              <span className="block text-[12px] mt-0.5" style={{color:"rgba(36,62,65,0.5)"}}>{desc}</span>
            </span>
          </label>)}
      </div>
      <SweepButton filled type="submit" className="w-full">Save Preferences</SweepButton>
      <button type="button" onClick={unsubscribeAll} className="text-[12px] underline mx-auto" style={{color:"rgba(36,62,65,0.5)"}}>Unsubscribe from all marketing emails</button>
      {saved&&<p className="text-[13px] text-center" style={{color:T.gold}}>{unsubscribed?"You've been unsubscribed from all marketing emails.":"Preferences saved."}</p>}
    </form>
  </div>;
}

// Accessibility commitment page (/accessibility). Note: the sitewide
// focus-visible outline and prefers-reduced-motion support (see FONTS
// above) exist specifically to back up what this page promises — don't
// let this page's claims drift out of sync with what's actually built.
function AccessibilityView(){return <LegalShell title="Accessibility Statement" updated="August 2026">
  <Lp c="Precision Forge Labs is committed to making akaraonline.co.in usable by as many people as possible, including people with visual, motor, auditory, or cognitive disabilities."/>
  <Lh c="What We Aim For"/>
  <Lp c="We aim to follow the Web Content Accessibility Guidelines (WCAG) 2.1 at a Level AA standard where practical — covering things like readable colour contrast, keyboard navigability, descriptive alt text on meaningful images, and clear, consistent navigation."/>
  <Lh c="Ongoing Work"/>
  <Lp c="Accessibility is an ongoing effort, not a one-time fix. As the site grows — new products, new pages, new features — we review and improve accessibility alongside that work rather than treating it as separate."/>
  <Lh c="Feedback"/>
  <Lp c={<>If you encounter any part of this site that's difficult to use with a screen reader, keyboard-only navigation, or any other assistive technology, please let us know at <a href="mailto:support@akaraonline.co.in" style={{color:T.gold}}>support@akaraonline.co.in</a> — we take this feedback seriously and will do our best to address it.</>}/>
</LegalShell>;}

// ============================================================================
// LEGAL PAGES — Privacy, Refund, Shipping, Terms, Cookies (+ Accessibility
// above uses this shell too). LegalShell/Lh/Lp/LegalTable are the shared
// building blocks so every legal page has identical heading size, spacing,
// and "Last updated" formatting without repeating markup 6 times.
// ============================================================================
// Wrapper: title + "Last updated" date + whatever <Lh>/<Lp> content is
// passed as children.
function LegalShell({title,updated,children}){return <div className="px-6 md:px-14 py-16 max-w-[780px] mx-auto"><h1 className="italic text-[30px] md:text-[38px] mb-3" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{title}</h1><p className="text-[12px] mb-12" style={{color:"rgba(36,62,65,0.4)"}}>Last updated: {updated}</p>{children}</div>;}
// Legal-page paragraph — `c` can be a plain string or JSX (for inline
// links, e.g. Lp with a <button> or <a> inside it).
function Lp({c}){return <p className="text-[14.5px] leading-[1.85] mb-4" style={{color:"rgba(36,62,65,0.68)"}}>{c}</p>;}
// Legal-page section subheading.
function Lh({c}){return <h2 className="text-[17px] italic mt-10 mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{c}</h2>;}

// Simple data table for legal pages (used by Privacy Policy's Data
// Retention and DPDP Act Rights tables). First row is treated as the
// header. Rows are arrays of plain strings, each ` · `-joined string in a
// non-header cell renders as its own line/bullet.
function LegalTable({rows}){
  return <div className="mb-4 overflow-x-auto">
    <table className="w-full text-[13px]" style={{borderCollapse:"collapse"}}>
      <tbody>
        {rows.map((r,i)=><tr key={i} style={{borderBottom:"1px solid rgba(36,62,65,0.12)"}}>
          {r.map((cell,j)=><td key={j} className="py-3 pr-6 align-top" style={{color:i===0?T.teal:"rgba(36,62,65,0.68)",fontWeight:i===0?600:400,whiteSpace:"nowrap"}}>{cell}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>;
}
// /privacy — 12 sections including the DPDP Act 2023 rights table and
// named Grievance Officer, per the real business details on file.
function PrivacyPolicyView({navigate}){return <LegalShell title="Privacy Policy" updated="August 2026">
  <Lp c="Precision Forge Labs ('we', 'us', 'our') operates ĀKĀRA at akaraonline.co.in. This policy explains what personal data we collect, why, how it's protected, and the rights you have over it under India's Digital Personal Data Protection Act, 2023 (DPDP Act)."/>

  <Lh c="1. Scope"/>
  <Lp c="This policy applies to anyone who visits akaraonline.co.in, creates an account, or places an order with us. By using the site, you consent to the practices described here."/>

  <Lh c="2. What We Collect"/>
  <Lp c="Order information: name, email, phone number, shipping and billing address. Account information: email and any profile details you add. Payment information: processed entirely by Razorpay — we never see or store your card, UPI, or bank details. Browsing data: your cart and wishlist are stored locally in your browser, not on our servers, unless you're signed in."/>

  <Lh c="3. How We Use It"/>
  <Lp c="To process and deliver your order, send order and shipping updates, respond to enquiries, and improve the site. We do not sell your personal data to third parties, and we don't use it for purposes beyond what's described here without asking you first."/>

  <Lh c="4. Legal Basis for Processing"/>
  <Lp c="We process your data on the basis of your consent (given when you place an order or create an account), to fulfil our contractual obligation to deliver what you've purchased, and to comply with tax and legal record-keeping requirements under Indian law."/>

  <Lh c="5. Who We Share Data With"/>
  <Lp c="We share only what's necessary, with: Razorpay (payment processing), our courier partners — Delhivery, BlueDart (DHL), Shiprocket, and India Post (name, address, phone for delivery), and tax authorities where legally required for GST compliance. None of these parties are permitted to use your data for their own marketing."/>

  <Lh c="6. Cookies & Local Storage"/>
  <Lp c={<>We use essential local storage to keep your cart and wishlist between visits, and Razorpay sets its own cookies during checkout. Full detail is in our <button onClick={()=>navigate("cookies")} className="underline" style={{color:T.gold}}>Cookie Policy</button>.</>}/>

  <Lh c="7. Data Retention"/>
  <LegalTable rows={[
    ["Data Type","Retention Period"],
    ["Order & transaction records","8 years (statutory requirement under Indian tax law)"],
    ["Account information","Until you request deletion or close your account"],
    ["Customer support correspondence","3 years from the date of last contact"],
    ["Cart & wishlist (local storage)","Until cleared by you or your browser"],
  ]}/>

  <Lh c="8. Data Security"/>
  <Lp c="We limit access to personal data to what's needed to fulfil your order, use Razorpay's PCI-DSS compliant infrastructure for all payments, and never store card, UPI, or bank details ourselves. While no system is 100% immune to risk, we take reasonable technical and organisational measures to protect your information."/>

  <Lh c="9. Your Rights Under the DPDP Act, 2023"/>
  <LegalTable rows={[
    ["Right","What It Means"],
    ["Right to Access","Request a copy of the personal data we hold about you"],
    ["Right to Correction","Ask us to correct inaccurate or incomplete data"],
    ["Right to Erasure","Request deletion of your data, subject to statutory retention requirements"],
    ["Right to Grievance Redressal","Raise a complaint with our Grievance Officer, listed below"],
    ["Right to Nominate","Nominate another individual to exercise these rights on your behalf in the event of death or incapacity"],
  ]}/>
  <Lp c={<>To exercise any of these rights, write to <a href="mailto:dpo@akaraonline.co.in" style={{color:T.gold}}>dpo@akaraonline.co.in</a>. We aim to respond within 30 days.</>}/>

  <Lh c="10. Grievance Officer"/>
  <Lp c={<>In accordance with applicable Indian data protection law, our Grievance Officer is <strong style={{color:T.teal}}>Vishal Singh</strong>, reachable at <a href="mailto:dpo@akaraonline.co.in" style={{color:T.gold}}>dpo@akaraonline.co.in</a> for any concerns regarding how your personal data is handled.</>}/>

  <Lh c="11. Children's Privacy"/>
  <Lp c="Our site is intended for users who are 18 years or older, or minors with the involvement of a parent or guardian. We do not knowingly collect personal data from children without such involvement."/>

  <Lh c="12. Changes to This Policy"/>
  <Lp c="We may update this policy from time to time as our practices or the law evolve. Material changes will be reflected here with an updated 'Last updated' date."/>
</LegalShell>;}
// /refund — cross-links to the real ReturnRequestView page rather than
// just listing an email address.
function RefundPolicyView({navigate}){return <LegalShell title="Refund & Return Policy" updated="August 2026"><Lp c="Every ĀKĀRA piece is made to order. Please check size, colour, and photos carefully before ordering."/><Lh c="7-Day Return Window"/><Lp c="Returns accepted within 7 days of delivery if the piece arrives damaged, defective, or significantly different from what was described. We cannot accept returns for a change of mind."/><Lh c="30-Day Warranty"/><Lp c="Every piece is covered against manufacturing defects for 30 days from delivery."/><Lh c="How to Request"/><Lp c={<>Use our <button onClick={()=>navigate("return-request")} className="underline" style={{color:T.gold}}>Request a Return</button> page with your order number, the item, and a couple of photos — or email <a href="mailto:support@akaraonline.co.in" style={{color:T.gold}}>support@akaraonline.co.in</a> directly. We respond within 72 hours.</>}/></LegalShell>;}
// /shipping — 10 sections: production time, cost, delivery time,
// courier partners (Delhivery/BlueDart/Shiprocket/India Post), dispatch,
// packaging, serviceable areas, tracking, failed delivery, damaged/
// missing in transit.
function ShippingPolicyView(){return <LegalShell title="Shipping Policy" updated="August 2026">
  <Lp c="This policy explains how ĀKĀRA pieces are produced, packed, and delivered across India. Every product is 3D-printed to order in our Thane studio, so shipping timelines differ from off-the-shelf retail."/>

  <Lh c="1. Production Time"/>
  <Lp c="Nothing on akaraonline.co.in is stocked in advance. Once an order is placed, it enters our production queue and is 3D-printed to order — this takes 2–3 weeks depending on the piece and current order volume. We'll only dispatch once your piece has cleared quality control."/>

  <Lh c="2. Shipping Cost"/>
  <Lp c="Shipping is free on orders of ₹2,500 and above. Below that, standard shipping is ₹150 and express shipping is ₹199. Shipping cost is calculated at checkout and shown before you pay, along with applicable GST."/>

  <Lh c="3. Delivery Time"/>
  <Lp c="Once dispatched, delivery typically takes 3–7 business days depending on your location, on top of the 2–3 week production window. Metro cities are usually on the faster end of this range; remote or non-metro pin codes may take slightly longer."/>

  <Lh c="4. Courier Partners"/>
  <Lp c="We ship via Delhivery, BlueDart (DHL), Shiprocket, and India Post, chosen per order based on your location and the safest handling option for the piece. You'll receive the tracking details for whichever courier is assigned to your shipment."/>

  <Lh c="5. Order Processing & Dispatch"/>
  <Lp c="Once your piece is printed, quality-checked, and packed, it's handed to our courier partner and you'll receive a dispatch confirmation by email with your tracking number. You can also check live status any time from My Account → Orders → Track Order."/>

  <Lh c="6. Packaging"/>
  <Lp c="Every piece is individually wrapped and cushioned before being boxed — planters and vases are packed upright with internal bracing to prevent shifting in transit, and lighting pieces ship with the fitting and shade protected separately where applicable. Packaging materials are chosen to protect the piece, not for unnecessary bulk."/>

  <Lh c="7. Serviceable Areas"/>
  <Lp c={<>We currently ship across India, to all pin codes serviceable by our courier partners. For international orders, please write to <a href="mailto:info@akaraonline.co.in" style={{color:T.gold}}>info@akaraonline.co.in</a> before ordering — we'll confirm feasibility and cost on a case-by-case basis.</>}/>

  <Lh c="8. Order Tracking"/>
  <Lp c="Once dispatched, your order status moves through five stages — Confirmed, Production, QC & Packaging, Dispatched, and Delivered — visible from My Account → Orders → Track Order, along with the courier's own tracking link once available."/>

  <Lh c="9. Failed Delivery Attempts"/>
  <Lp c="Our courier partners typically attempt delivery 2–3 times before returning a shipment to us. Please ensure the address and phone number provided at checkout are accurate and reachable. If a shipment is returned due to repeated failed delivery, we'll get in touch to arrange reshipment — additional shipping charges may apply."/>

  <Lh c="10. Damaged or Missing in Transit"/>
  <Lp c={<>Every piece is quality-checked and carefully packed before it leaves our studio, but if your order arrives damaged, or an item is missing from the package, please email <a href="mailto:support@akaraonline.co.in" style={{color:T.gold}}>support@akaraonline.co.in</a> within 7 days of delivery with your order number and photos of the item and packaging. We'll arrange a replacement or refund as covered under our Refund Policy — please don't discard the packaging until this is resolved, as our courier partner may need it for a claim.</>}/>
</LegalShell>;}
// /terms — 15 sections including the ±2-3mm 3D-printing tolerance
// disclosure, 24-hour cancellation window, and CGST/SGST tax explanation.
function TermsOfServiceView({navigate}){return <LegalShell title="Terms of Service" updated="August 2026">
  <Lp c="These Terms of Service ('Terms') govern your use of akaraonline.co.in ('the Site'), operated by Precision Forge Labs under the brand ĀKĀRA. By browsing the Site, creating an account, or placing an order, you agree to be bound by these Terms."/>

  <Lh c="1. Definitions"/>
  <Lp c={<>"We", "us", "our" refers to Precision Forge Labs (GSTIN 27GZCPS9353H1ZQ). "You", "customer" refers to anyone browsing or ordering from the Site. "Piece" or "product" refers to any item listed for sale on the Site. "Order" refers to a confirmed purchase placed through checkout.</>}/>

  <Lh c="2. Acceptance of Terms"/>
  <Lp c="Placing an order, creating an account, or continuing to use the Site after changes to these Terms are posted constitutes acceptance of the current version. If you do not agree, please discontinue use of the Site."/>

  <Lh c="3. Eligibility"/>
  <Lp c="You must be at least 18 years old, or place orders with the involvement of a parent or guardian if a minor, and capable of entering into a legally binding contract under Indian law to use this Site."/>

  <Lh c="4. Nature of Products — Made to Order"/>
  <Lp c="Every ĀKĀRA piece is 3D-printed to order in our Thane studio using plant-based PLA — nothing is pre-stocked. Production takes 2–3 weeks from order confirmation before a piece is dispatched. Because each item is produced individually rather than pulled from a warehouse, minor natural variation between pieces is expected and is not considered a defect."/>

  <Lh c="5. 3D Printing Tolerances"/>
  <Lp c="Due to the nature of the 3D printing process, dimensions listed on product pages carry a manufacturing tolerance of ±2–3mm. Colour may also appear very slightly different across production batches, and across different screens. These are inherent to made-to-order 3D-printed pieces and do not qualify as manufacturing defects under our Refund Policy."/>

  <Lh c="6. Pricing & Taxes"/>
  <Lp c="All prices on the Site are listed in Indian Rupees (INR) and are exclusive of GST, which is calculated and added at checkout at the applicable rate of 18% — split as CGST + SGST for intra-state (Maharashtra) orders, or IGST for orders shipped to other states, per Indian tax law. Relevant HSN codes are 3924 for planters and vases, and 9405 for lighting products. We reserve the right to correct any pricing errors on the Site, including after an order is placed, and will refund any payment taken for an order we're unable to honour at the listed price."/>

  <Lh c="7. Order Placement & Acceptance"/>
  <Lp c="Adding items to your cart does not guarantee availability or reserve stock. An order is only confirmed once payment is successfully processed and you receive an order confirmation with an order number. We reserve the right to refuse or cancel any order at our discretion — for example in cases of suspected fraud, pricing errors, or an inability to produce the piece as specified — with a full refund of any payment taken."/>

  <Lh c="8. Payment"/>
  <Lp c="Payments are processed securely via Razorpay, supporting cards, UPI, net banking, and wallets. We do not receive or store your card, UPI, or bank account details at any point — this is handled entirely within Razorpay's PCI-DSS compliant infrastructure."/>

  <Lh c="9. Cancellation Policy"/>
  <Lp c="Because production begins shortly after an order is confirmed, cancellation requests must be made within 24 hours of placing the order. Email support@akaraonline.co.in with your order number as soon as possible — once a piece has entered production, we may not be able to cancel or modify it."/>

  <Lh c="10. Shipping & Delivery"/>
  <Lp c={<>Shipping timelines, costs, and courier partners are detailed in our <button onClick={()=>navigate("shipping")} className="underline" style={{color:T.gold}}>Shipping Policy</button>. Delivery estimates are provided in good faith and are not guaranteed, as they depend in part on our courier partners.</>}/>

  <Lh c="11. Returns, Refunds & Warranty"/>
  <Lp c={<>Our return window, warranty coverage, and refund process are detailed in our <button onClick={()=>navigate("refund")} className="underline" style={{color:T.gold}}>Refund & Return Policy</button>. In summary: a 7-day return window for damaged, defective, or significantly-different-than-described pieces, and a 30-day warranty against manufacturing defects.</>}/>

  <Lh c="12. Intellectual Property"/>
  <Lp c="All designs, product names, photography, and content on this Site are the property of Precision Forge Labs and protected under applicable Indian intellectual property law. Nothing on this Site may be reproduced, copied, or used commercially without our written permission."/>

  <Lh c="13. Prohibited Use"/>
  <Lp c="You agree not to use the Site for any unlawful purpose, to attempt to gain unauthorised access to our systems or another user's account, to submit false or fraudulent order information, or to reproduce, resell, or reverse-engineer our product designs without authorisation."/>

  <Lh c="14. Limitation of Liability"/>
  <Lp c="To the extent permitted by law, Precision Forge Labs shall not be liable for indirect, incidental, or consequential damages arising from the use of this Site or our products, beyond the value of the order in question. Nothing in these Terms limits any right you have that cannot be excluded under Indian consumer protection law."/>

  <Lh c="15. Governing Law & Jurisdiction"/>
  <Lp c="These Terms are governed by the laws of India. Any disputes arising from these Terms or your use of the Site shall be subject to the exclusive jurisdiction of the courts in Mumbai, Maharashtra."/>
</LegalShell>;}
// /cookies — NOTE this page's "keeps your cart and wishlist saved
// between visits" claim is now actually TRUE (see loadStoredCart /
// safeStorageSet below) — it wasn't when this page was first written, so
// this was a real bug that got fixed to match the promise.
function CookiePolicyView(){return <LegalShell title="Cookie Policy" updated="January 2026"><Lp c="This page explains the cookies and local storage akaraonline.co.in uses."/><Lh c="What We Use"/><Lp c="Essential: keeps your cart and wishlist saved between visits. Payment: Razorpay sets its own cookies during checkout. Analytics (optional): aggregate, anonymous data to help us improve the site."/><Lh c="What We Don't Do"/><Lp c="We don't use cookies to track you across other websites or build advertising profiles."/><Lh c="Managing Cookies"/><Lp c="You can block or delete cookies in your browser settings. Blocking essential cookies means your cart won't persist between visits."/></LegalShell>;}

// Catch-all 404 page — rendered whenever the current view isn't in
// ALL_VIEWS, or parsePath() couldn't resolve the URL at all.
function NotFoundView({ navigate }) {
  return <div className="px-6 py-32 text-center">
    <p className="italic text-[80px] mb-4 leading-none" style={{fontFamily:"'Fraunces',serif",color:T.gold,opacity:0.4}}>404</p>
    <h1 className="italic text-[26px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>This page doesn't exist.</h1>
    <p className="text-[14px] mb-8" style={{color:"rgba(36,62,65,0.5)"}}>The piece you're looking for may have moved.</p>
    <SweepButton filled onClick={()=>navigate("home")}>Back to Home</SweepButton>
  </div>;
}

// Every valid page name. Anything rendered where view isn't in this list
// falls through to NotFoundView. Keep in sync with STATIC_VIEW_PATH above
// and the view===... switch in AkaraApp's render below whenever a page is
// added or removed.
const ALL_VIEWS=["home","shop","product","search","cart","checkout","order-confirmed","order-status","invoice","payment-failed","about","craft","contact","faq","bulk-orders","return-request","care-guide","email-preferences","accessibility","account","login","signup","forgot-password","reset-password","privacy","refund","shipping","terms","cookies"];

// Reduced-motion-aware scroll-to-top, used by navigate() and the
// popstate handler in AkaraApp on every page change. Checks
// prefers-reduced-motion directly because CSS's scroll-behavior override
// doesn't reliably catch JS-triggered smooth scrolls in all browsers.
function scrollToTop(){
  try{
    const reduced=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({top:0,behavior:reduced?"auto":"smooth"});
  }catch{ window.scrollTo(0,0); }
}
// ============================================================================
// PERSISTENCE — cart and wishlist survive a refresh via localStorage
// (added specifically because the Privacy/Cookie policies promised this
// and the app didn't actually do it — a real bug, now fixed). Order data
// deliberately does NOT persist here — it only lives in AkaraApp's
// in-memory `order` state, which is why Order Confirmed/Status/Invoice/My
// Account can only ever show the most recent order from the current
// session.
// ============================================================================
// try/catch wrapped since localStorage can throw (private browsing, quota
// exceeded, disabled by user) — fails silently rather than crashing the
// app.
function safeStorageGet(key){
  try{ const raw=localStorage.getItem(key); return raw?JSON.parse(raw):null; }catch{ return null; }
}
// See safeStorageGet above — same try/catch-and-fail-silently approach.
function safeStorageSet(key,value){
  try{ localStorage.setItem(key,JSON.stringify(value)); }catch{ /* private browsing or storage disabled — fail silently */ }
}
// Whitelist used by loadStoredCart below to validate a stored cart
// entry's `size` before trusting it — anything outside this list falls
// back to "Medium" rather than being rendered as-is.
const VALID_SIZES=["Small","Medium","Large"];
// Reads the persisted cart from localStorage on app startup. SECURITY:
// validates every field before trusting it — qty is clamped to a real
// positive integer (1-99) and size is checked against VALID_SIZES, since
// this data could be tampered with directly in browser devtools (or by a
// future bug elsewhere) and would otherwise flow straight into price math
// (price * qty) on the Cart/Checkout/Invoice pages unchecked. Only stores
// {id, size, qty} — always re-merges against the live PRODUCTS list for
// name/price/etc, so a stored cart never carries a stale price.
function loadStoredCart(){
  const stored=safeStorageGet("akara_cart");
  if(!Array.isArray(stored)) return [];
  return stored
    .map(entry=>{
      if(!entry||typeof entry.id!=="string") return null;
      const product=PRODUCTS.find(p=>p.id===entry.id);
      if(!product) return null;
      const qty=Number.isInteger(entry.qty)&&entry.qty>0&&entry.qty<=99?entry.qty:1;
      const size=VALID_SIZES.includes(entry.size)?entry.size:"Medium";
      return {...product,size,qty};
    })
    .filter(Boolean);
}
// Reads the persisted wishlist from localStorage — filters out any id
// that no longer matches a real product (e.g. a product was removed from
// the catalog after being wishlisted).
function loadStoredWishlist(){
  const stored=safeStorageGet("akara_wishlist");
  return Array.isArray(stored)?stored.filter(id=>PRODUCTS.some(p=>p.id===id)):[];
}

// ============================================================================
// ROOT APP COMPONENT — owns all top-level state (view/routing, cart,
// wishlist, user, order) and renders the app shell + whichever page
// matches the current `view`. This is the one component that ties
// EVERY other piece in this file together.
// ============================================================================
// State ownership at a glance:
//  - view/productId/shopCategory/searchQuery/notFound: current route,
//    synced to the real URL via buildPath/parsePath (see navigate() and
//    the popstate effect below)
//  - cart/wishlist: initialized from localStorage (loadStoredCart/
//    loadStoredWishlist), re-persisted on every change (the two useEffects
//    right below the state declarations)
//  - user: fake in-memory session from the demo login only — see the
//    SECURITY NOTE above RateLimiter
//  - order: the single most-recent order, in-memory only, gone on refresh
//    (this is why every post-purchase page has the same "only shows the
//    last order" limitation noted above)
// The big effect below (title/meta description) is what makes every page
// have its own real <title> and meta description — necessary for SEO now
// that every page has its own real URL.
// Root component was renamed from AkaraApp to AkaraAppRoot below — the
// actual default export (AkaraApp, at the very end of this file) wraps it
// in an ErrorBoundary. See that class for why.
function AkaraAppRoot() {
  const initial=typeof window!=="undefined"?parsePath(window.location.pathname,window.location.search):{view:"home"};
  const [view,setView]=useState(initial.view==="__notfound__"?"home":initial.view);
  const [productId,setProductId]=useState(initial.productId||PRODUCTS[0].id);
  const [shopCategory,setShopCategory]=useState(initial.shopCategory||null);
  const [searchQuery,setSearchQuery]=useState(initial.searchQuery||"");
  const [notFound,setNotFound]=useState(initial.view==="__notfound__");
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [searchOpen,setSearchOpen]=useState(false);
  const [cartOpen,setCartOpen]=useState(false);
  const [cart,setCart]=useState(loadStoredCart);
  const [wishlist,setWishlist]=useState(loadStoredWishlist);
  const [user,setUser]=useState(null);
  const [order,setOrder]=useState(null);

  useEffect(()=>{ safeStorageSet("akara_cart",cart.map(i=>({id:i.id,size:i.size,qty:i.qty}))); },[cart]);
  useEffect(()=>{ safeStorageSet("akara_wishlist",wishlist); },[wishlist]);

  const navigate=useCallback((v,id=null)=>{
    setNotFound(false);
    setView(v);
    if(v==="product"&&id) setProductId(id);
    if(v==="shop") setShopCategory(typeof id==="string"&&CATEGORIES.includes(id)?id:null);
    if(v==="search") setSearchQuery(typeof id==="string"?id:"");
    const path=buildPath(v,id);
    if(typeof window!=="undefined"&&window.location.pathname+window.location.search!==path) window.history.pushState({},"",path);
    scrollToTop();
    setDrawerOpen(false); setSearchOpen(false);
  },[]);

  useEffect(()=>{
    const onPop=()=>{
      const parsed=parsePath(window.location.pathname,window.location.search);
      if(parsed.view==="__notfound__"){ setNotFound(true); return; }
      setNotFound(false);
      setView(parsed.view);
      if(parsed.productId) setProductId(parsed.productId);
      setShopCategory(parsed.shopCategory||null);
      setSearchQuery(parsed.searchQuery||"");
      scrollToTop();
    };
    window.addEventListener("popstate",onPop);
    return ()=>window.removeEventListener("popstate",onPop);
  },[]);

  useEffect(()=>{
    const product=view==="product"?PRODUCTS.find(p=>p.id===productId):null;
    const title=notFound?"Page Not Found — ĀKĀRA"
      :product?product.metaTitle
      :view==="home"?"ĀKĀRA — Artifacts for the Modern Spaces"
      :view==="shop"?(shopCategory?`${shopCategory} — Shop — ĀKĀRA`:"Shop — ĀKĀRA")
      :view==="search"?(searchQuery?`Search: ${searchQuery} — ĀKĀRA`:"Search — ĀKĀRA")
      :`${view.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase())} — ĀKĀRA`;
    document.title=title;
    const desc=product?product.metaDesc:(view==="shop"&&shopCategory&&CATEGORY_CONTENT[shopCategory]?CATEGORY_CONTENT[shopCategory].metaDesc:"Luxury 3D-printed home décor — planters, vases, and lighting, handcrafted to order in Mumbai by Atelier ĀKĀRA.");
    const setMeta=(attr,key,content)=>{
      let tag=document.querySelector(`meta[${attr}="${key}"]`);
      if(!tag){ tag=document.createElement("meta"); tag.setAttribute(attr,key); document.head.appendChild(tag); }
      tag.setAttribute("content",content);
    };
    setMeta("name","description",desc);
    // Open Graph + Twitter Card — controls the preview card when a page is
    // shared on WhatsApp/Instagram/Facebook/Twitter (high-relevance sharing
    // channels for this brand). og:image is deliberately NOT set — there's
    // no hosted product photography yet (see the media gallery placeholder
    // notes). Add a real og:image URL here once photos exist and are
    // hosted somewhere with a stable URL — until then, shares correctly
    // fall back to no preview image rather than a broken/placeholder one.
    const url=typeof window!=="undefined"?window.location.href:"https://akaraonline.co.in"+buildPath(view,productId||shopCategory);
    setMeta("property","og:title",title);
    setMeta("property","og:description",desc);
    setMeta("property","og:type",product?"product":"website");
    setMeta("property","og:url",url);
    setMeta("property","og:site_name","ĀKĀRA");
    setMeta("name","twitter:card","summary");
    setMeta("name","twitter:title",title);
    setMeta("name","twitter:description",desc);

    // JSON-LD structured data — Product schema on product pages enables
    // Google rich results (price, availability shown directly in search).
    // availability maps from product.stock, which is real (if currently
    // defaulted) data, not fabricated. Deliberately NOT including
    // aggregateRating/reviewCount here even though the UI shows a "4.6 ·
    // 89 reviews" placeholder elsewhere — that number isn't real yet, and
    // Google's structured data guidelines treat fabricated review data as
    // a policy violation that can get a site penalized. Add it back only
    // once a real review system exists.
    let ld=document.getElementById("ld-json");
    if(!ld){ ld=document.createElement("script"); ld.id="ld-json"; ld.type="application/ld+json"; document.head.appendChild(ld); }
    ld.textContent=JSON.stringify(product?{
      "@context":"https://schema.org",
      "@type":"Product",
      name:product.name,
      description:product.description||desc,
      sku:product.id,
      category:product.cat,
      brand:{"@type":"Brand",name:"ĀKĀRA"},
      offers:{
        "@type":"Offer",
        url,
        priceCurrency:"INR",
        price:product.price,
        availability:product.stock==="sold-out"?"https://schema.org/OutOfStock":product.stock==="low-stock"?"https://schema.org/LimitedAvailability":"https://schema.org/InStock",
      },
    }:{
      "@context":"https://schema.org",
      "@type":"Organization",
      name:"Precision Forge Labs",
      alternateName:"ĀKĀRA",
      url:"https://akaraonline.co.in",
      contactPoint:{"@type":"ContactPoint",email:"support@akaraonline.co.in",contactType:"customer service"},
    });
  },[view,productId,shopCategory,searchQuery,notFound]);

  const placeOrder=useCallback((form)=>{
    const sub=cart.reduce((s,i)=>s+i.price*i.qty,0);
    const ship=sub>=2500?0:150;
    const gst=Math.round((sub+ship)*0.18);
    setOrder({...form,items:cart,total:sub+ship+gst,orderNumber:"AK"+Math.floor(10000+Math.random()*89999),placedAt:Date.now()});
    setCart([]); navigate("order-confirmed");
  },[cart,navigate]);

  const logout=useCallback(()=>{ setUser(null); navigate("home"); },[navigate]);
  const cartCount=cart.reduce((s,i)=>s+i.qty,0);
  // Defense-in-depth: even though parsePath() already rejects unknown product
  // slugs from a typed/shared URL, this also catches the case of navigate()
  // being called directly with a bad id (e.g. a stale reference to a removed
  // product) — either path now correctly falls through to the 404 page
  // instead of silently showing the wrong product.
  const productExists=view!=="product"||PRODUCTS.some(p=>p.id===productId);

  return <div className="min-h-screen w-full" style={{backgroundColor:T.cream,fontFamily:"'Space Grotesk',system-ui,sans-serif",color:T.teal}}>
    <style>{FONTS}</style>
    <a href="#main-content" className="skip-link">Skip to content</a>
    <Header navigate={navigate} onOpenDrawer={()=>setDrawerOpen(true)} onOpenSearch={()=>setSearchOpen(o=>!o)} onOpenCart={()=>setCartOpen(true)} cartCount={cartCount} wishCount={wishlist.length} user={user} className="no-print"/>
    <SearchPanel open={searchOpen} onClose={()=>setSearchOpen(false)} navigate={navigate}/>
    <Drawer open={drawerOpen} onClose={()=>setDrawerOpen(false)} navigate={navigate} user={user} logout={logout}/>
    <CartDrawer open={cartOpen} onClose={()=>setCartOpen(false)} cart={cart} setCart={setCart} navigate={navigate}/>
    <main id="main-content" key={`${view}-${productId}-${shopCategory}-${searchQuery}`} className="akara-page-enter">
      {!notFound&&view==="home"&&<HomeView navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} setWishlist={setWishlist}/>}
      {!notFound&&view==="shop"&&<ShopView navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} setWishlist={setWishlist} initCategory={shopCategory}/>}
      {!notFound&&view==="search"&&<SearchResultsView navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} setWishlist={setWishlist} initQuery={searchQuery}/>}
      {!notFound&&productExists&&view==="product"&&<ProductDetailView productId={productId} navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} setWishlist={setWishlist}/>}
      {!notFound&&view==="cart"&&<CartView navigate={navigate} cart={cart} setCart={setCart}/>}
      {!notFound&&view==="checkout"&&<CheckoutView navigate={navigate} cart={cart} placeOrder={placeOrder}/>}
      {!notFound&&view==="order-confirmed"&&<OrderConfirmedView navigate={navigate} order={order}/>}
      {!notFound&&view==="order-status"&&<OrderStatusView navigate={navigate} order={order}/>}
      {!notFound&&view==="invoice"&&<InvoiceView navigate={navigate} order={order}/>}
      {!notFound&&view==="payment-failed"&&<PaymentFailedView navigate={navigate}/>}
      {!notFound&&view==="about"&&<AboutView navigate={navigate}/>}
      {!notFound&&view==="craft"&&<CraftView navigate={navigate}/>}
      {!notFound&&view==="contact"&&<ContactView/>}
      {!notFound&&view==="faq"&&<FAQView/>}
      {!notFound&&view==="bulk-orders"&&<BulkOrdersView navigate={navigate}/>}
      {!notFound&&view==="return-request"&&<ReturnRequestView navigate={navigate} order={order}/>}
      {!notFound&&view==="care-guide"&&<CareGuideView navigate={navigate}/>}
      {!notFound&&view==="email-preferences"&&<EmailPreferencesView navigate={navigate}/>}
      {!notFound&&view==="accessibility"&&<AccessibilityView/>}
      {!notFound&&view==="account"&&<MyAccountView navigate={navigate} wishlist={wishlist} setWishlist={setWishlist} user={user} order={order}/>}
      {!notFound&&view==="login"&&<LoginView navigate={navigate} onLogin={setUser}/>}
      {!notFound&&view==="signup"&&<SignupView navigate={navigate} onLogin={setUser}/>}
      {!notFound&&view==="forgot-password"&&<ForgotPasswordView navigate={navigate}/>}
      {!notFound&&view==="reset-password"&&<ResetPasswordView navigate={navigate}/>}
      {!notFound&&view==="privacy"&&<PrivacyPolicyView navigate={navigate}/>}
      {!notFound&&view==="refund"&&<RefundPolicyView navigate={navigate}/>}
      {!notFound&&view==="shipping"&&<ShippingPolicyView/>}
      {!notFound&&view==="terms"&&<TermsOfServiceView navigate={navigate}/>}
      {!notFound&&view==="cookies"&&<CookiePolicyView/>}
      {(notFound||!productExists||!ALL_VIEWS.includes(view))&&<NotFoundView navigate={navigate}/>}
    </main>
    <Footer navigate={navigate}/>
  </div>;
}

// ============================================================================
// ERROR BOUNDARY — catches any unexpected runtime error anywhere in the
// component tree and shows a real recovery screen instead of a blank white
// page. This did not exist before and was a genuine production-readiness
// gap: without it, any uncaught error (a bad prop, an unexpected null,
// anything) would crash the entire app silently for the customer. This is
// intentionally the ONLY class component in the file — React error
// boundaries currently require a class (no hook equivalent exists).
// ============================================================================
class ErrorBoundary extends Component {
  constructor(props){ super(props); this.state={hasError:false}; }
  static getDerivedStateFromError(){ return {hasError:true}; }
  componentDidCatch(error,info){
    // No error-reporting service wired up yet (Sentry etc. is a backend/
    // infra decision) — logged to console for now so it's not silently lost
    // during development. Swap this for real error reporting once decided.
    console.error("ĀKĀRA app error:",error,info);
  }
  render(){
    if(!this.state.hasError) return this.props.children;
    return <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px",textAlign:"center",backgroundColor:"#FBF4E7",fontFamily:"'Space Grotesk',system-ui,sans-serif"}}>
      <p style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",fontSize:"28px",color:"#243E41",marginBottom:"12px"}}>Something went wrong.</p>
      <p style={{fontSize:"14px",color:"rgba(36,62,65,0.6)",maxWidth:"420px",marginBottom:"28px",lineHeight:1.7}}>
        This page hit an unexpected error. Refreshing usually fixes it — if it keeps happening, please let us know at support@akaraonline.co.in.
      </p>
      <button onClick={()=>window.location.reload()} style={{padding:"14px 28px",fontSize:"12px",letterSpacing:"0.14em",textTransform:"uppercase",backgroundColor:"#243E41",color:"white",border:"none",cursor:"pointer"}}>Reload Page</button>
    </div>;
  }
}

export default function AkaraApp(){
  return <ErrorBoundary><AkaraAppRoot/></ErrorBoundary>;
}
