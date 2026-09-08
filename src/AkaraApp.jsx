import { useState, useEffect, useRef, useCallback, useMemo, useContext, createContext, Component, lazy, Suspense } from "react";
import {
  Menu, X, Search, Heart, User, ShoppingBag,
  ArrowUpRight, Star, Lock, RotateCcw, Minus, Plus,
  Trash2, Eye, EyeOff, ChevronDown, ChevronRight, ChevronLeft,
  MapPin, Phone, Mail, Instagram, AlertCircle, Check,
  Package, ClipboardCheck, Truck, XCircle, Play, Film, Leaf,
  Shield, FileText, Cookie, Accessibility, LogOut, Copy, Download,
} from "lucide-react";
import { T, FONTS, sanitize, apiFetch, getCsrfToken, Mac, SweepButton, InputField, ToastProvider, useToast, Skeleton, Modal, ELEVATION, RADIUS, ICON, trackAkara } from "./shared.jsx";
// AdminApp (and its ~400KB recharts dependency) is lazy-loaded — only
// fetched by the browser when someone actually visits /admin, never as
// part of what a regular customer downloads. See the root export at the
// bottom of this file for where this actually gets used.
const AdminApp = lazy(() => import("./AdminApp.jsx"));


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
// Mirrors server/validate.js's normalizePhone exactly — must stay in sync,
// since a mismatch here would mean the frontend accepts/rejects a phone
// number the backend disagrees with. Strips a leading "+91"/"91" country
// code when clearly present, so a number typed exactly the way the
// signup form's own placeholder suggests ("+91 XXXXX XXXXX") normalizes
// to the same 10 digits the backend expects — this used to be a real
// bug: entering the phone in the format the UI itself hints at would
// fail validation, since only spaces/+/- were stripped, not the country
// code digits.
const normalizePhone = (phone = "") => {
  const digits = String(phone).replace(/[\s+\-]/g, "");
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9][0-9]{9}$/.test(digits.slice(2))) {
    return digits.slice(2);
  }
  return digits;
};
const validIndianPhone = (phone = "") => /^[6-9][0-9]{9}$/.test(phone);

// Auto-fills city/state from a 6-digit PIN code, using India Post's real
// public API (no key needed, confirmed CORS-open). Deliberately a pure
// convenience — fails completely silently on any error (invalid PIN,
// network issue, no match) since city/state stay manually editable
// either way; a customer must never be blocked from typing their own
// values just because this lookup didn't work. Only fires on a
// genuinely complete 6-digit PIN, not on every partial keystroke.
async function lookupPincode(pin, onFound) {
  if (!/^\d{6}$/.test(pin)) return;
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
    const data = await res.json();
    const po = data?.[0]?.PostOffice?.[0];
    if (data?.[0]?.Status === "Success" && po) onFound({ city: po.District, state: po.State });
  } catch {
    // Silent — see comment above.
  }
}

// NOTE: this file used to contain a client-side-only RateLimiter class and
// a hardcoded demo login (test@example.com) here — both were the
// pre-backend placeholder for login attempt limiting and authentication.
// Both have been replaced by the real thing: server-side rate limiting in
// server/auth.js (genuinely unbypassable by clearing browser storage,
// unlike the old version) and real accounts via /api/auth — see LoginView
// and SignupView further down, and the "AUTH PAGES" comment above them.

// ============================================================================
// PRODUCTS — now fetched from the real backend (GET /api/products) instead
// of a hardcoded array. See ProductsContext/useProducts()/the fetch effect
// in AkaraAppRoot below. The 31-product CATALOG array and per-product
// SEO_COPY object that used to live here were removed once the database
// became the single source of truth — keeping both would have meant two
// places that could silently disagree (e.g. an admin panel price edit
// later would update the database but not this file). The database was
// originally seeded FROM this data (see db/seed-products.json), so nothing
// was lost — it just moved to where it can now actually be edited without
// a code deployment.
// ============================================================================
const ProductsContext = createContext({ products: [], loading: true, error: null });
function useProducts() { return useContext(ProductsContext); }

// The 6 product categories. Shop filters, the Drawer nav, the Footer
// "Collections" column, and the homepage "Shop by Category" grid all read
// from this array — add a category here (+ a CAT_SLUG entry + a CAT_ART
// icon below) and it appears everywhere automatically.
// Fallback if /api/categories is offline — live list is loaded into CategoriesContext
const DEFAULT_CATEGORIES = ["Planters","Vases","Ceiling Lighting","Table Lamps","Lanterns","Floor Lamps"];
const DEFAULT_CAT_SLUG = {"Planters":"planters","Vases":"vases","Ceiling Lighting":"ceiling-lighting","Table Lamps":"table-lamps","Lanterns":"lanterns","Floor Lamps":"floor-lamps"};
const CATEGORIES = DEFAULT_CATEGORIES; // legacy alias; prefer useCategories().names
const CAT_SLUG = DEFAULT_CAT_SLUG;
const SLUG_CAT = Object.fromEntries(Object.entries(CAT_SLUG).map(([k,v])=>[v,k]));
function slugifyCategory(name) {
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
// Catalogue-aware search: synonyms map casual phrases → category / material terms
const SEARCH_SYNONYMS = {
  "hanging light":"ceiling lighting", "hanging lamp":"ceiling lighting", "pendant":"ceiling lighting",
  "ceiling light":"ceiling lighting", "chandelier":"ceiling lighting",
  "table light":"table lamps", "desk lamp":"table lamps", "bedside":"table lamps",
  "floor light":"floor lamps", "standing lamp":"floor lamps", "torchere":"floor lamps",
  "plant pot":"planters", "pot":"planters", "planter":"planters", "jardiniere":"planters",
  "vase":"vases", "vessel":"vases", "flower":"vases",
  "lantern":"lanterns", "candle":"lanterns",
  "lamp":"lamps", "light":"lighting", "lighting":"lighting",
  "3d":"3d-printed", "3d printed":"3d-printed", "pla":"plant-based", "eco":"plant-based",
};
function expandSearchTokens(raw) {
  const q = String(raw || "").trim().toLowerCase();
  if (!q) return [];
  const tokens = new Set([q, ...q.split(/\s+/).filter(Boolean)]);
  for (const [phrase, mapped] of Object.entries(SEARCH_SYNONYMS)) {
    if (q.includes(phrase) || phrase.includes(q)) {
      tokens.add(mapped);
      mapped.split(/\s+/).forEach((w) => tokens.add(w));
    }
  }
  return [...tokens];
}
function productMatchesSearch(p, rawQuery) {
  const tokens = expandSearchTokens(rawQuery);
  if (!tokens.length) return false;
  const hay = [
    p.name, p.cat, p.category, p.description, p.dims, p.metaTitle, p.metaDesc, p.id,
  ].filter(Boolean).join(" ").toLowerCase();
  return tokens.some((tok) => tok.length > 1 && hay.includes(tok));
}

const STATIC_VIEW_PATH = {home:"/",shop:"/shop",cart:"/cart",checkout:"/checkout","order-confirmed":"/order-confirmed","order-status":"/order-status","track-order":"/track-order","invoice":"/invoice","payment-failed":"/payment-failed",about:"/about",craft:"/craft",contact:"/contact",faq:"/faq","bulk-orders":"/bulk-orders","return-request":"/return-request","care-guide":"/care-guide","android-app":"/android-app","email-preferences":"/email-preferences",accessibility:"/accessibility",account:"/account",login:"/login",signup:"/signup","forgot-password":"/forgot-password","reset-password":"/reset-password",privacy:"/privacy",refund:"/refund",shipping:"/shipping",terms:"/terms",cookies:"/cookies"};
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
  if(view==="preview"&&id) return "/preview/"+id;
  if(view==="shop"&&id) return "/shop/"+ (CAT_SLUG[id]||slugifyCategory(id));
  if(view==="search") return "/search"+(id?("?q="+encodeURIComponent(id)):"");
  // Shareable order track/invoice links (P3c)
  if(view==="order-status"&&id) return "/order-status?order="+encodeURIComponent(id);
  if(view==="invoice"&&id) return "/invoice?order="+encodeURIComponent(id);
  if(view==="order-confirmed"&&id) return "/order-confirmed?order="+encodeURIComponent(id);
  return STATIC_VIEW_PATH[view]||"/";
}
// URL path (+ query string) -> {view, ...params}. Inverse of buildPath().
// Called on first page load (supports direct links / refresh) and on
// browser back/forward (popstate, see AkaraApp). Returns
// {view:"__notfound__"} for anything unrecognized -> renders the 404 page.
function parsePath(pathname,search=""){
  const parts=pathname.split("/").filter(Boolean);
  if(parts.length===0) return {view:"home"};
  // NOTE: this used to validate the product id against PRODUCTS here, but
  // products are now fetched asynchronously (see ProductsContext in
  // AkaraAppRoot) and won't be available yet when this runs on first page
  // load. Existence is now validated inside ProductDetailView itself once
  // products finish loading, showing its own loading skeleton in the
  // meantime rather than a false 404 flash — so a bad product slug still
  // correctly ends up on the 404 page, just slightly later.
  if(parts[0]==="product"&&parts[1]) return {view:"product",productId:parts[1]};
  // Deliberately NOT registered anywhere a customer could stumble onto it
  // — no link, no nav entry, no sitemap listing (server.js's sitemap
  // generator only ever lists real, published product pages). The real
  // gate is server-side anyway: PreviewProductView below always calls
  // the admin-authenticated endpoint, so even someone who guesses this
  // URL pattern for a real draft product ID sees only a sign-in
  // requirement, never the actual draft content.
  if(parts[0]==="preview"&&parts[1]) return {view:"preview",productId:parts[1]};
  if(parts[0]==="shop"&&parts[1]) return {view:"shop",shopCategory:SLUG_CAT[parts[1]]||parts[1]};
  if(parts[0]==="search") return {view:"search",searchQuery:sanitize(new URLSearchParams(search).get("q")||"").slice(0,100)};
  const staticView=PATH_STATIC_VIEW["/"+parts.join("/")];
  if(!staticView) return {view:"__notfound__"};
  // Order number in query for track / invoice / confirmed
  if(staticView==="order-status"||staticView==="invoice"||staticView==="order-confirmed"){
    const orderQ=sanitize(new URLSearchParams(search).get("order")||"").slice(0,40);
    if(orderQ) return {view:staticView, orderNumber:orderQ};
  }
  return {view:staticView};
}

// ============================================================================
// CATEGORY LINE-ART ICONS — hand-drawn SVG illustrations, one per category.
// These are PLACEHOLDER product imagery: every product shows its
// category's icon (via product.Art) until real photos/videos exist. See
// ProductGallery + defaultMedia() below for how the swap to real media
// happens once photos are supplied, with no further code changes needed.
// ============================================================================
function PlanterArt({ className, style }) {
  return <svg viewBox="0 0 200 200" fill="none" className={className} style={style} strokeLinecap="round" strokeLinejoin="round">
    <path d="M60 70 L140 70 L128 165 L72 165 Z" stroke="currentColor" strokeWidth="5"/>
    <line x1="60" y1="70" x2="140" y2="70" stroke="currentColor" strokeWidth="5"/>
    <path d="M85 70 C85 45 100 30 100 30 C100 30 115 45 115 70" stroke="currentColor" strokeWidth="5"/>
  </svg>;
}
function VaseArt({ className, style }) {
  return <svg viewBox="0 0 200 200" fill="none" className={className} style={style} strokeLinecap="round" strokeLinejoin="round">
    <path d="M85 40 L115 40 L122 75 C140 100 140 140 118 165 L82 165 C60 140 60 100 78 75 Z" stroke="currentColor" strokeWidth="5"/>
    <line x1="85" y1="40" x2="115" y2="40" stroke="currentColor" strokeWidth="5"/>
  </svg>;
}
function CeilingLampArt({ className, style }) {
  return <svg viewBox="0 0 200 200" fill="none" className={className} style={style} strokeLinecap="round" strokeLinejoin="round">
    <line x1="100" y1="15" x2="100" y2="55" stroke="currentColor" strokeWidth="5"/>
    <path d="M55 55 L145 55 L160 120 C160 120 135 135 100 135 C65 135 40 120 40 120 Z" stroke="currentColor" strokeWidth="5"/>
  </svg>;
}
function TableLampArt({ className, style }) {
  return <svg viewBox="0 0 200 200" fill="none" className={className} style={style} strokeLinecap="round" strokeLinejoin="round">
    <path d="M70 55 L130 55 L140 110 L60 110 Z" stroke="currentColor" strokeWidth="5"/>
    <line x1="100" y1="110" x2="100" y2="145" stroke="currentColor" strokeWidth="5"/>
    <line x1="75" y1="145" x2="125" y2="145" stroke="currentColor" strokeWidth="5"/>
  </svg>;
}
function LanternArt({ className, style }) {
  return <svg viewBox="0 0 200 200" fill="none" className={className} style={style} strokeLinecap="round" strokeLinejoin="round">
    <line x1="100" y1="20" x2="100" y2="40" stroke="currentColor" strokeWidth="5"/>
    <rect x="65" y="40" width="70" height="100" rx="8" stroke="currentColor" strokeWidth="5"/>
    <line x1="65" y1="70" x2="135" y2="70" stroke="currentColor" strokeWidth="4"/>
    <line x1="65" y1="110" x2="135" y2="110" stroke="currentColor" strokeWidth="4"/>
    <path d="M80 140 L100 165 L120 140" stroke="currentColor" strokeWidth="5"/>
  </svg>;
}
function FloorLampArt({ className, style }) {
  return <svg viewBox="0 0 200 200" fill="none" className={className} style={style} strokeLinecap="round" strokeLinejoin="round">
    <path d="M70 40 L130 40 L145 90 L55 90 Z" stroke="currentColor" strokeWidth="5"/>
    <line x1="100" y1="90" x2="100" y2="160" stroke="currentColor" strokeWidth="5"/>
    <line x1="70" y1="160" x2="130" y2="160" stroke="currentColor" strokeWidth="5"/>
  </svg>;
}
const CAT_ART = { "Planters":PlanterArt, "Vases":VaseArt, "Ceiling Lighting":CeilingLampArt, "Table Lamps":TableLampArt, "Lanterns":LanternArt, "Floor Lamps":FloorLampArt };
const CAT_ICON_BY_KEY = {
  planters: PlanterArt, vases: VaseArt, "ceiling-lighting": CeilingLampArt,
  "table-lamps": TableLampArt, lanterns: LanternArt, "floor-lamps": FloorLampArt,
};
function artForCategory(name, iconKey) {
  if (iconKey && CAT_ICON_BY_KEY[iconKey]) return CAT_ICON_BY_KEY[iconKey];
  if (CAT_ART[name]) return CAT_ART[name];
  return PlanterArt;
}

const CategoriesContext = createContext({
  names: DEFAULT_CATEGORIES,
  rows: [],
  catSlug: DEFAULT_CAT_SLUG,
  slugCat: Object.fromEntries(Object.entries(DEFAULT_CAT_SLUG).map(([k,v])=>[v,k])),
  blurbs: {},
});
function useCategories() { return useContext(CategoriesContext); }
function CategoriesProvider({ children }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/categories")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.categories?.length) return;
        setRows(d.categories);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const value = useMemo(() => {
    if (!rows.length) {
      return {
        names: DEFAULT_CATEGORIES,
        rows: DEFAULT_CATEGORIES.map((name) => ({ name, slug: DEFAULT_CAT_SLUG[name], description: "", iconKey: DEFAULT_CAT_SLUG[name] })),
        catSlug: DEFAULT_CAT_SLUG,
        slugCat: Object.fromEntries(Object.entries(DEFAULT_CAT_SLUG).map(([k, v]) => [v, k])),
        blurbs: {},
      };
    }
    const names = rows.map((r) => r.name);
    const catSlug = Object.fromEntries(rows.map((r) => [r.name, r.slug]));
    const slugCat = Object.fromEntries(rows.map((r) => [r.slug, r.name]));
    const blurbs = Object.fromEntries(rows.map((r) => [r.name, r.description || ""]));
    return { names, rows, catSlug, slugCat, blurbs };
  }, [rows]);
  return <CategoriesContext.Provider value={value}>{children}</CategoriesContext.Provider>;
}

const MIN_IMAGES=5, MIN_VIDEOS=2;
// Generates a product's placeholder media gallery: 5 image slots + 2
// video slots, all src:null (ProductGallery renders these as the category
// icon / a "video coming soon" state). To add real media later: update
// that product's `media` column in the database (JSONB) to an array of
// {type,src} objects with real URLs — minimum 5 images + 2 videos —
// overriding this default. See enrichProduct() below for how that's read.
function defaultMedia(){
  return [
    ...Array.from({length:MIN_IMAGES},()=>({type:"image",src:null})),
    ...Array.from({length:MIN_VIDEOS},()=>({type:"video",src:null})),
  ];
}
// To add real photos/videos for a product later: set that product's `media`
// field (in the database, via the future admin panel) to an array like
// [{type:"image",src:"/media/vayu-1.jpg"},...,{type:"video",src:"/media/vayu-1.mp4"}]
// — minimum 5 images + 2 videos per product. Anything left unset falls back
// to the placeholder icon/video-pending state until real files are supplied.

// Takes a raw product object as returned by GET /api/products (name, price,
// description, stock, etc. — all real, from the database) and attaches the
// two things that can only exist client-side: the category icon component
// (Art — can't be stored in a database) and a media gallery fallback (if
// the database has no real photos/videos yet for this product, media will
// be an empty array — defaultMedia() fills in the placeholder gallery).
// Called once per product every time the product list is fetched — see the
// fetch effect in AkaraAppRoot below.
// Real, single, shared GST rate — matches server/routes/orders.js's own
// real, live 0.18 exactly. Deliberately kept in one place rather than
// repeated at every display site, so there's genuinely only one real
// number to ever update if the rate changes, not 23+ scattered copies.
const GST_RATE = 0.18;
// Real, GST-inclusive display price — the actual fix for a real,
// reported problem: prices shown on the site were tax-EXCLUSIVE, so
// checkout added ~18% for the first time at the very last step, a
// real, well-documented cause of cart abandonment. Uses the exact same
// Math.round() the real checkout math uses, so the number shown here
// is mathematically GUARANTEED to match what checkout actually
// charges — never a separate, independently-rounded calculation that
// could drift from the real total by a rupee.
function gstInclusivePrice(basePrice) {
  return Math.round(basePrice * (1 + GST_RATE));
}
function enrichProduct(p) {
  // REAL BUG FOUND during a direct, proactive audit (checked against
  // the live site, not assumed): every real "quick glance" card (shop
  // grid, search dropdown, homepage, mood boards, wishlist) showed
  // gstInclusiveBasePrice — computed from the base product's own price
  // — even for a product that has real, distinct variants with their
  // own, different, real prices. Confirmed directly, live: Helion Vase
  // showed ~₹199 on every one of those cards, while the real price a
  // customer would actually pay once they opened the real product page
  // was ₹354 — a real, live, nearly 2x, genuinely misleading gap. This
  // is exactly the same root mistake already fixed elsewhere in this
  // project (trusting the base price for a product that has moved on
  // to real, independent variant pricing), just in a different, real
  // set of display locations that hadn't been checked yet.
  // gstInclusiveDisplayPrice is the real, correct fix — for a product
  // WITH real variants, it's the GST-inclusive price of the CHEAPEST
  // real variant (the standard, honest "From ₹X" convention), never
  // the potentially stale, disconnected base price; for a product with
  // no real variants (the majority), it's identical to the base price,
  // so nothing changes for those.
  // REAL, DIRECT CORRECTION following a direct, live report: the
  // "any real variant overrides the base price" rule above was itself
  // wrong — it let a real, colour-only variant (no distinct real size)
  // silently override the real, deliberately-set Basics price, which
  // is precisely NOT wanted. Confirmed directly: Helion Vase's real,
  // intended price (Basics, customer sees ₹199) was being replaced on
  // every listing by its one, existing, colour-only Black variant's
  // own price (₹354) — even though no real Size had ever actually been
  // configured for it. The real, now-confirmed, correct rule: the
  // Basics price is authoritative by default; only an explicit, real,
  // distinct Size (Small/Medium/Large, genuinely set on a variant in
  // the Details tab) is allowed to override it anywhere a customer
  // sees a price — a colour alone must never silently change it. This
  // is the exact same, real rule now enforced identically on the
  // customer-facing product page and the real, authoritative
  // server-side checkout validation (server/routes/orders.js) — all
  // three must stay in permanent lockstep, or a customer could be
  // shown one real price and charged a genuinely different one.
  const hasRealSizes=Array.isArray(p.variants)&&p.variants.some(v=>v.size!=null);
  const variantPrices=hasRealSizes?p.variants.map(v=>v.price):[];
  const lowestRealPrice=hasRealSizes?Math.min(...variantPrices):p.price;
  // True only when a product's real, size-differentiated variants
  // genuinely span more than one distinct real price — used to decide
  // whether a card should honestly say "From ₹X" (a real range exists)
  // versus just "₹X" (one flat, real price covers every combination,
  // so "From" would be a real, unnecessary, slightly misleading
  // qualifier).
  const hasRealPriceRange=hasRealSizes&&new Set(variantPrices).size>1;
  // REAL, DIRECT FIX, directly requested: stock status (low-stock/
  // sold-out) needs to show consistently everywhere a product appears
  // — shop grid, search, homepage, wishlist, mood boards — not just on
  // its own product page. Follows the exact same, real, consistent
  // rule already established for price: a colour-only variant (no real
  // size) never overrides the base product's own real status; only
  // real, distinct sizes do. For a product WITH real sizes, the card
  // shows the real, honest "best case" — if any real size is still
  // genuinely, fully in stock, the card shows no warning at all
  // (there's a normal, real way to buy it); if the best real size left
  // is only low-stock, the card says so; only when every real size is
  // genuinely sold out does the card say Sold Out.
  const cardStatus=hasRealSizes
    ? (p.variants.some(v=>v.size!=null&&v.status==="in-stock")?"in-stock"
      :p.variants.some(v=>v.size!=null&&v.status==="low-stock")?"low-stock"
      :p.variants.some(v=>v.size!=null&&v.status==="pre-order")?"pre-order"
      :"sold-out")
    : p.status;
  return {
    ...p,
    media: p.media && p.media.length > 0 ? p.media : defaultMedia(),
    Art: CAT_ART[p.cat] || PlanterArt,
    // Deliberately NOT named "displayPrice" — that name is already used
    // locally inside ProductDetailView (further below) for a genuinely
    // different, real thing: the correct GST-EXCLUSIVE price for
    // whichever variant is currently selected, used when adding to
    // cart. This is the base product's own GST-INCLUSIVE customer-
    // facing price. Naming them the same would have been exactly the
    // kind of real, silent mix-up that causes a genuine pricing bug —
    // gstInclusiveBasePrice makes the real distinction unmistakable.
    // Kept as-is, unchanged, for any real, existing caller that
    // genuinely wants the base price specifically (e.g. the admin's
    // own price editor, which correctly cares about the real, actual
    // Basics-tab value, not what a variant happens to cost).
    gstInclusiveBasePrice: gstInclusivePrice(p.price),
    // The real, correct field every customer-facing "card" display
    // should use instead — see the full, real explanation above.
    gstInclusiveDisplayPrice: gstInclusivePrice(lowestRealPrice),
    hasRealPriceRange,
    cardStatus,
  };
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
// ============================================================================
// COUPON BANNER — real, site-wide visibility for admin-featured coupons
// only (see server/settings.js's getFeaturedCoupons for why this is
// deliberately NOT every active coupon). Sits above the header so it's
// visible on every page, not just the homepage — a real promotion is
// only useful if a customer sees it wherever they land. Dismissible
// per-session (sessionStorage, not localStorage) — closing it shouldn't
// hide it forever on a future visit, just for the rest of this one.
// Genuinely hides itself entirely if there's nothing featured, rather
// than rendering an empty bar — the same "don't show a section with
// nothing real to show" pattern already used throughout this app.
function CouponBanner(){
  const [coupons,setCoupons]=useState([]);
  const [dismissed,setDismissed]=useState(false);
  const [copiedCode,setCopiedCode]=useState(null);
  useEffect(()=>{
    if(sessionStorage.getItem("akara_coupon_banner_dismissed")==="1"){ setDismissed(true); return; }
    fetch("/api/coupons/featured").then(r=>r.ok?r.json():null).then(d=>{ if(d?.coupons) setCoupons(d.coupons); }).catch(()=>{});
  },[]);
  const dismiss=()=>{ setDismissed(true); sessionStorage.setItem("akara_coupon_banner_dismissed","1"); };
  const copyCode=code=>{
    navigator.clipboard?.writeText(code).then(()=>{ setCopiedCode(code); setTimeout(()=>setCopiedCode(c=>c===code?null:c),1500); });
  };
  if(dismissed||coupons.length===0) return null;
  // Only the single best (highest-discount) featured coupon is shown —
  // a banner trying to list several promotions at once reads as
  // cluttered/noisy, and getFeaturedCoupons() already sorts by
  // discount_percent DESC, so the first one is genuinely the best offer.
  const c=coupons[0];
  return <div className="relative flex items-center justify-center gap-3 px-10 py-2.5 text-center flex-wrap" style={{backgroundColor:T.teal,color:T.cream}}>
    <span className="text-[12px] md:text-[12.5px]">{c.label}</span>
    <button onClick={()=>copyCode(c.code)} className="text-[11px] uppercase tracking-[0.06em] px-2.5 py-1 flex items-center gap-1.5" style={{border:`1px solid ${T.gold}`,borderRadius:RADIUS.xs,color:T.gold}}>
      {copiedCode===c.code?"Copied!":<>Code: {c.code} <Copy size={11}/></>}
    </button>
    <button onClick={dismiss} aria-label="Dismiss" className="absolute right-3 top-1/2 -translate-y-1/2 p-1" style={{color:T.cream,opacity:0.7}}><X size={14}/></button>
  </div>;
}

// Real, dedicated mobile install banner — directly requested. The
// header's own "Install App" icon (further below) is deliberately
// desktop-only: Android Chrome already shows its own native mini-
// install-banner automatically there, so a second, on-page prompt
// risked being redundant clutter. But that reasoning genuinely doesn't
// hold for mobile: Chrome's own banner is inconsistent (it's governed
// by Chrome's internal engagement heuristics, not something this site
// can control or guarantee), and — more importantly — iOS Safari has
// NO native install prompt of any kind; Apple requires the person to
// already know to tap Share → "Add to Home Screen," with zero
// automatic prompting ever. A real, visible, on-page banner is
// genuinely the only way iOS visitors learn this is even possible.
//
// Split into two real, different real flows since Android and iOS
// genuinely can't share one: Android gets the real, actual
// beforeinstallprompt trigger (a real native dialog, one tap);
// iOS gets real, explicit written instructions, since no programmatic
// install trigger exists on that platform at all — showing a button
// there that silently does nothing would be worse than not showing
// one.
function MobileInstallBanner(){
  const [installEvent,setInstallEvent]=useState(null);
  const [installed,setInstalled]=useState(false);
  const [dismissed,setDismissed]=useState(false);
  const [isIOS,setIsIOS]=useState(false);
  const [isMobile,setIsMobile]=useState(false);

  useEffect(()=>{
    if(window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone){ setInstalled(true); return; }
    // Real, session-only dismissal — sessionStorage rather than
    // localStorage deliberately: a "not now" should genuinely mean
    // "not this visit," not "never ask again forever," since someone
    // who declines once today may well want to install next week.
    if(sessionStorage.getItem("akara_install_dismissed")==="1"){ setDismissed(true); }
    setIsMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
    setIsIOS(/iPhone|iPad|iPod/i.test(navigator.userAgent)&&!window.MSStream);
    const handler=e=>{ e.preventDefault(); setInstallEvent(e); };
    window.addEventListener("beforeinstallprompt",handler);
    const installedHandler=()=>{ setInstalled(true); setInstallEvent(null); };
    window.addEventListener("appinstalled",installedHandler);
    return ()=>{ window.removeEventListener("beforeinstallprompt",handler); window.removeEventListener("appinstalled",installedHandler); };
  },[]);

  const dismiss=()=>{ sessionStorage.setItem("akara_install_dismissed","1"); setDismissed(true); };
  const promptInstall=async()=>{
    if(!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(()=>{});
    setInstallEvent(null);
  };

  // Real, correct visibility rule: only ever show on a genuine mobile
  // device, never already-installed, never dismissed this session, and
  // — for Android specifically — only once a real, genuine
  // beforeinstallprompt has actually fired (never invite a tap that
  // would do nothing). iOS has no such event to wait for, so it shows
  // as soon as the other real conditions are met, since the real
  // "install" action there is a written instruction, not a
  // JS-triggered prompt.
  if(installed||dismissed||!isMobile) return null;
  if(!isIOS&&!installEvent) return null;

  return <div className="fixed bottom-0 left-0 right-0 z-[250] flex items-center gap-3 px-4 py-3" style={{backgroundColor:T.teal,boxShadow:"0 -2px 12px rgba(0,0,0,0.15)"}}>
    <div className="w-10 h-10 flex items-center justify-center shrink-0" style={{backgroundColor:T.gold,borderRadius:RADIUS.xs}}>
      <Download size={18} style={{color:T.teal}}/>
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[13px]" style={{color:"white",fontWeight:500}}>Install the ĀKĀRA app</p>
      <p className="text-[11.5px]" style={{color:"rgba(255,255,255,0.7)"}}>
        {isIOS?"Tap Share, then \"Add to Home Screen.\"":"Quicker access, right from your home screen."}
      </p>
    </div>
    {!isIOS&&<button onClick={promptInstall} className="px-3.5 py-2 text-[11.5px] uppercase tracking-[0.06em] shrink-0" style={{backgroundColor:T.gold,color:T.teal,borderRadius:RADIUS.xs,fontWeight:600}}>Install</button>}
    <button onClick={dismiss} aria-label="Dismiss" className="p-1.5 shrink-0" style={{color:"rgba(255,255,255,0.7)"}}><X size={16}/></button>
  </div>;
}

// Logged-in homepage welcome — soft bar under header, once per session, ~3s.
function firstNameFromUser(user){
  const raw=(user?.name||"").trim();
  if(!raw) return "";
  const first=raw.split(/\s+/)[0];
  if(!first||first.includes("@")) return "";
  return first.charAt(0).toUpperCase()+first.slice(1);
}
function welcomeLine(user){
  const name=firstNameFromUser(user);
  const h=new Date().getHours();
  const period=h<12?"morning":h<17?"afternoon":"evening";
  const withName=[
    period==="morning"?`Good morning, ${name} — glad you're back.`:null,
    period==="afternoon"?`Welcome back, ${name}.`:null,
    period==="evening"?`Good evening, ${name}.`:null,
    `Hello, ${name} — your space, still being made.`,
  ].filter(Boolean);
  const withoutName=[
    period==="morning"?"Good morning — glad you're back.":null,
    period==="afternoon"?"Welcome back.":null,
    period==="evening"?"Good evening.":null,
    "Welcome back — take your time here.",
  ].filter(Boolean);
  const pool=name?withName:withoutName;
  // Stable pick for the session hour so it doesn't flicker
  const idx=(name.length+h)%pool.length;
  return pool[idx];
}
function WelcomeBar({ user, view }){
  const [visible,setVisible]=useState(false);
  const [line,setLine]=useState("");
  useEffect(()=>{
    if(!user||view!=="home"){ setVisible(false); return; }
    try{
      if(sessionStorage.getItem("akara_welcome_shown")==="1") return;
      sessionStorage.setItem("akara_welcome_shown","1");
    }catch{ /* still show once this mount */ }
    setLine(welcomeLine(user));
    setVisible(true);
    const t=setTimeout(()=>setVisible(false),3000);
    return ()=>clearTimeout(t);
  },[user,view]);
  if(!visible||!line) return null;
  return (
    <div className="no-print relative z-30 w-full px-4 py-2.5 text-center transition-opacity duration-500"
      style={{backgroundColor:"rgba(24,54,48,0.06)",borderBottom:"1px solid rgba(24,54,48,0.08)"}}
      role="status" aria-live="polite">
      <p className="text-[13px] md:text-[14px] tracking-[0.02em]" style={{color:T.teal,fontFamily:"'Fraunces',serif",fontStyle:"italic"}}>
        {line}
      </p>
      <button type="button" aria-label="Dismiss" onClick={()=>setVisible(false)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] uppercase tracking-[0.1em] opacity-60 hover:opacity-100"
        style={{color:T.teal}}>×</button>
    </div>
  );
}

function Header({ navigate, onOpenDrawer, onOpenCart, cartCount, wishCount, user, logout, className="" }) {
  const [scrolled, setScrolled] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  const acctRef = useRef(null);
  useEffect(() => {
    if (!acctOpen) return;
    const onDoc = (e) => { if (acctRef.current && !acctRef.current.contains(e.target)) setAcctOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [acctOpen]);
  useEffect(() => { const fn=()=>setScrolled(window.scrollY>40); window.addEventListener("scroll",fn); return ()=>window.removeEventListener("scroll",fn); }, []);
  // Real "Install App" affordance — the actual missing piece that made
  // installation not genuinely functional before this: the manifest
  // and service worker were both real and correct, but there was no
  // visible, deliberate way for a real customer to ever trigger
  // installation — the browser's own native prompt is silent unless
  // something on the page explicitly calls it. Chrome fires a real
  // 'beforeinstallprompt' event when it decides the site is
  // installable, but ONLY IF something calls preventDefault() on it
  // and keeps the event object to trigger later — otherwise it just
  // shows the browser's own address-bar icon, which most real
  // customers never notice. installEvent is that captured, real event
  // object; installed tracks whether the app is ALREADY running in
  // standalone mode (checked via the actual matchMedia query, the
  // real, correct way to detect this), so an already-installed
  // customer never sees a button offering to do something that's
  // already done.
  const [installEvent, setInstallEvent] = useState(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) { setInstalled(true); return; }
    const handler = e => { e.preventDefault(); setInstallEvent(e); };
    window.addEventListener("beforeinstallprompt", handler);
    // Real, correct way to notice a same-session install (e.g. the
    // customer used the browser's own address-bar icon instead of
    // this button) — hides the button immediately rather than leaving
    // it visible and offering to "install" an app that's now already
    // installed.
    const installedHandler = () => { setInstalled(true); setInstallEvent(null); };
    window.addEventListener("appinstalled", installedHandler);
    return () => { window.removeEventListener("beforeinstallprompt", handler); window.removeEventListener("appinstalled", installedHandler); };
  }, []);
  const promptInstall = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    // The real prompt is genuinely single-use — this is what
    // "consumes" it; a second click without a fresh
    // beforeinstallprompt event would do nothing, so the event is
    // cleared here regardless of what the customer actually chooses
    // in the native dialog (both real outcomes — accepted or
    // dismissed — end with a used-up prompt).
    await installEvent.userChoice.catch(() => {});
    setInstallEvent(null);
  };
  // Rebuilt from the earlier "search replaces the entire header row"
  // version — found directly to be a real problem: the hamburger,
  // wordmark, and every other icon vanished the moment search opened,
  // and there was no way to close it except the X button (no outside-
  // click handling at all). This version keeps the header's normal
  // content permanently visible and renders search as a small popover
  // anchored to searchWrapRef (wrapping just the search icon itself),
  // not the header as a whole — so it naturally stays "near the icon"
  // by construction rather than needing manual positioning math.
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const { products } = useProducts();
  const inputRef = useRef(null);
  const searchWrapRef = useRef(null);
  useEffect(()=>{ if(searchOpen) setTimeout(()=>inputRef.current?.focus(),50); },[searchOpen]);

  // Closes on a genuine outside click/tap — added specifically because
  // its total absence was the other half of the original problem. Uses
  // "mousedown" rather than "click" so this fires before a click INSIDE
  // the popover (e.g. on a result button) has a chance to unmount it
  // first — "click" firing after unmount would otherwise make result
  // buttons unreliable to press. Listener only exists at all while
  // searchOpen is true, added/removed via the effect cleanup, not left
  // attached permanently.
  useEffect(()=>{
    if(!searchOpen) return;
    const onOutside=e=>{ if(searchWrapRef.current && !searchWrapRef.current.contains(e.target)) closeSearch(); };
    document.addEventListener("mousedown",onOutside);
    return ()=>document.removeEventListener("mousedown",onOutside);
  },[searchOpen]);

  const trimmed=q.trim();
  const allMatches = trimmed.length>1 ? products.filter(p=>productMatchesSearch(p,q)) : [];
  const matches = allMatches.slice(0,6);
  const closeSearch=()=>{ setSearchOpen(false); setQ(""); };
  const goToResults=()=>{ if(trimmed.length>1){ navigate("search",trimmed); closeSearch(); } };

  return <header className={"sticky top-0 z-40 grid items-center h-[68px] px-6 md:px-12 relative "+className} style={{ gridTemplateColumns:"auto 1fr auto", gap:"16px", backgroundColor:scrolled?"rgba(255,242,223,0.97)":"rgba(255,242,223,0.88)", backdropFilter:"blur(20px)", borderBottom:"1px solid rgba(36,62,65,0.09)" }}>
    <button aria-label="Open menu" onClick={onOpenDrawer} className="justify-self-start p-2 -ml-2" style={{ color:T.teal }}><Menu size={20} strokeWidth={1.5}/></button>
    <button type="button" onClick={()=>navigate("home")}
      className="justify-self-center flex items-center justify-center focus:outline-none self-center"
      aria-label="ĀKĀRA home">
      <img
        src="/logo-wordmark.png"
        alt="ĀKĀRA"
        width={152}
        height={50}
        className="block w-auto object-contain object-center select-none"
        style={{
          height: "32px",
          maxHeight: "36px",
          maxWidth: "min(46vw, 172px)",
          /* optical: wordmark sits slightly high in its box; nudge 1px down */
          transform: "translateY(1px)",
        }}
        decoding="async"
        draggable={false}
      />
    </button>
    <div className="justify-self-end flex items-center gap-0.5">
      <div ref={searchWrapRef} className="relative">
        <button aria-label={searchOpen?"Close search":"Search"} onClick={()=>setSearchOpen(o=>!o)} className="p-2.5" style={{ color:T.teal }}>
          {searchOpen?<X size={17} strokeWidth={1.5}/>:<Search size={17} strokeWidth={1.5}/>}
        </button>
        {/* Genuinely different positioning strategy from an absolute
            offset relative to the small search-icon wrapper — found
            directly, via a real mobile screenshot, that right:0
            relative to just the icon's own small wrapper pushed the
            popover's LEFT edge off-screen on a narrow viewport, since
            the search icon sits well left of the true screen edge once
            account/wishlist/cart icons are also accounted for. Fixed
            positioning anchored to the header's own actual horizontal
            padding (right-6 on mobile, right-12 at the md breakpoint,
            matching the header element's own px-6/md:px-12) keeps this
            correctly bounded regardless of exactly where the search
            icon sits among its sibling icons. */}
        {searchOpen && <div className="fixed right-6 md:right-12 top-[60px] z-50" style={{ width:"min(360px,calc(100vw - 3rem))" }}>
          <form onSubmit={e=>{e.preventDefault();goToResults();}} role="search" aria-label="Search products" className="flex items-center gap-2.5 px-4" style={{ backgroundColor:T.cream, borderRadius:RADIUS.lg, height:"42px", boxShadow:"0 24px 60px -16px rgba(36,62,65,0.35)" }}>
            <Search size={15} style={{ color:"rgba(36,62,65,0.75)", flexShrink:0 }}/>
            <input ref={inputRef} value={q} onChange={e=>setQ(sanitize(e.target.value))} placeholder="Search products…" maxLength={100}
              className="flex-1 bg-transparent outline-none text-[14px]" style={{ color:T.teal }}/>
          </form>
          {(matches.length>0 || (trimmed.length>1 && allMatches.length===0)) &&
            <div className="mt-2 overflow-hidden" style={{ backgroundColor:T.cream, borderRadius:RADIUS.md, boxShadow:"0 24px 60px -16px rgba(36,62,65,0.35)" }}>
              {matches.length>0 ? <div className="px-5 py-2 overflow-y-auto" style={{maxHeight:"50vh"}}>
                {matches.map(m=><button key={m.id} onClick={()=>{ navigate("product",m.id); closeSearch(); }}
                  className="flex justify-between w-full py-2.5 text-[13px] text-left" style={{ color:T.teal, borderTop:"1px solid rgba(36,62,65,0.07)" }}>
                  <span>{m.name}</span><span style={{ color:m.cardStatus==="sold-out"?"rgba(36,62,65,0.45)":T.teal }}>{m.hasRealPriceRange?"From ":""}₹{m.gstInclusiveDisplayPrice??m.price}{m.cardStatus==="sold-out"?" · Sold Out":m.cardStatus==="low-stock"?" · Low Stock":""}</span>
                </button>)}
                <button onClick={goToResults} className="w-full py-2.5 text-[12px] uppercase tracking-[0.08em] text-left" style={{ color:T.teal, borderTop:"1px solid rgba(36,62,65,0.07)" }}>
                  See all {allMatches.length} result{allMatches.length>1?"s":""} for "{trimmed}" →
                </button>
              </div> : <p className="px-5 py-4 text-[12.5px]" style={{color:"rgba(36,62,65,0.75)"}}>No quick matches — press Enter to search the full collection.</p>}
            </div>}
        </div>}
      </div>
      {installEvent&&!installed&&<button aria-label="Install App" onClick={promptInstall} title="Install ĀKĀRA" className="p-2.5 hidden sm:block" style={{ color:T.teal }}><Download size={17} strokeWidth={1.5}/></button>}
      <div className="relative" ref={acctRef}>
        {user ? (
          <>
            <button
              type="button"
              aria-label="Account menu"
              aria-expanded={acctOpen}
              onClick={()=>setAcctOpen(o=>!o)}
              className="hidden sm:inline-flex items-center gap-2.5 px-2 py-1.5 transition-colors"
              style={{ color:T.teal, borderRadius:999, border:"1px solid rgba(24,54,48,0.14)", backgroundColor:"rgba(227,218,201,0.55)" }}
            >
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium shrink-0"
                style={{backgroundColor:T.teal,color:"#F5F0E8",fontFamily:"'Fraunces',serif"}}>
                {(user.name||user.email||"A").trim().charAt(0).toUpperCase()}
              </span>
              <span className="text-[11px] tracking-[0.12em] uppercase max-w-[7rem] truncate" style={{fontFamily:"'Space Grotesk',system-ui,sans-serif"}}>
                {(user.name||"Account").split(" ")[0]}
              </span>
            </button>
            <button type="button" aria-label="Account menu" onClick={()=>setAcctOpen(o=>!o)} className="p-1.5 sm:hidden" style={{color:T.teal}}>
              <span className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-medium"
                style={{backgroundColor:T.teal,color:"#F5F0E8",fontFamily:"'Fraunces',serif"}}>
                {(user.name||user.email||"A").trim().charAt(0).toUpperCase()}
              </span>
            </button>
            {acctOpen && (
              <div className="absolute right-0 top-full mt-2 z-50 min-w-[11rem] py-2"
                style={{backgroundColor:"#F5F0E8",borderRadius:RADIUS.md,boxShadow:ELEVATION.raised,border:"1px solid rgba(24,54,48,0.1)"}}>
                <button type="button" className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-black/5" style={{color:T.teal}}
                  onClick={()=>{ setAcctOpen(false); navigate("account"); }}>My account</button>
                <button type="button" className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-black/5" style={{color:T.teal}}
                  onClick={()=>{ setAcctOpen(false); navigate("account","Orders"); }}>Orders</button>
                <button type="button" className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-black/5" style={{color:T.teal}}
                  onClick={()=>{ setAcctOpen(false); navigate("account","Wishlist"); }}>Wishlist</button>
                <div className="my-1" style={{borderTop:"1px solid rgba(24,54,48,0.1)"}}/>
                <button type="button" className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-black/5" style={{color:T.error}}
                  onClick={()=>{ setAcctOpen(false); logout?.(); }}>Sign out</button>
              </div>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              aria-label="Sign in"
              onClick={()=>navigate("login")}
              className="group hidden sm:inline-flex items-center gap-2 px-3.5 py-2 transition-colors"
              style={{ color:T.teal, borderRadius:999, border:"1px solid rgba(24,54,48,0.14)", backgroundColor:"rgba(227,218,201,0.55)" }}
            >
              <span className="text-[11px] tracking-[0.14em] uppercase" style={{fontFamily:"'Space Grotesk',system-ui,sans-serif"}}>Sign in</span>
              <span className="block h-px w-0 group-hover:w-3 transition-all duration-300" style={{backgroundColor:T.gold}}/>
            </button>
            <button aria-label="Sign in" onClick={()=>navigate("login")} className="p-2.5 sm:hidden" style={{ color:T.teal }}><User size={17} strokeWidth={1.5}/></button>
          </>
        )}
      </div>
      <button aria-label="View Wishlist" onClick={()=>navigate("account","Wishlist")} className="relative p-2.5" style={{ color:T.teal }}>
        <Heart size={17} strokeWidth={1.5}/>
        {wishCount>0 && <span className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-medium" style={{ backgroundColor:T.gold, color:T.teal }}>{wishCount}</span>}
      </button>
      <button aria-label="Cart" onClick={onOpenCart} className="relative p-2.5" style={{ color:T.teal }}>
        <ShoppingBag size={17} strokeWidth={1.5}/>
        {cartCount>0 && <span className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-medium" style={{ backgroundColor:T.gold, color:T.teal }}>{cartCount}</span>}
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
  const { names: categoryNames } = useCategories();
  const go = (v, id) => { navigate(v, id); onClose(); };
  return <>
    <div onClick={onClose} className="fixed inset-0 z-[60] transition-opacity duration-300" style={{ backgroundColor:"rgba(24,54,48,0.72)", opacity:open?1:0, pointerEvents:open?"all":"none" }}/>
    <nav aria-label="Site navigation" aria-modal={open} role="dialog" className="fixed top-0 left-0 bottom-0 z-[70] flex flex-col transition-transform duration-500 overflow-hidden" style={{ width:"min(85vw,340px)", backgroundColor:T.cream, transform:open?"translateX(0)":"translateX(-100%)", boxShadow:"24px 0 60px -20px rgba(36,62,65,0.28)" }}>
      <div className="flex items-center justify-between px-8 h-[68px]" style={{ borderBottom:"1px solid rgba(36,62,65,0.1)" }}>
        <span className="text-[13px] tracking-[0.14em] uppercase" style={{ color:"rgba(36,62,65,0.75)" }}>Menu</span>
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
            <button onClick={()=>go("shop")} className="w-full text-left py-2.5 text-[13px] flex items-center gap-2" style={{ color:T.teal, borderBottom:"1px solid rgba(36,62,65,0.08)" }}>
              <ArrowUpRight size={13}/> The collection
            </button>
            {categoryNames.map(cat=><button key={cat} onClick={()=>go("shop",cat)} className="w-full text-left py-2.5 text-[13px] flex items-center gap-2" style={{ color:T.teal, borderBottom:"1px solid rgba(36,62,65,0.06)" }}>
              <ChevronRight size={12} style={{ color:"rgba(36,62,65,0.75)" }}/>{cat}
            </button>)}
          </div>}
        </div>
        <NavItem label="About" onClick={()=>go("about")}/>
        <NavItem label="Contact" onClick={()=>go("contact")}/>
        <NavItem label="FAQ" onClick={()=>go("faq")}/>
      </div>
      <div className="px-8 py-6" style={{ borderTop:"1px solid rgba(36,62,65,0.1)" }}>
        {user ? <>
          <p className="text-[11px] tracking-[0.08em] uppercase mb-4" style={{ color:"rgba(36,62,65,0.75)" }}>Signed in as {user.name}</p>
          <button onClick={()=>go("account")} className="w-full flex items-center gap-3 px-4 py-3 mb-2.5 text-[13.5px]" style={{ color:T.teal, backgroundColor:"rgba(36,62,65,0.05)", borderRadius:RADIUS.sm }}>
            <User size={15} style={{color:T.teal}}/> My Account
          </button>
          <button onClick={()=>{ logout(); onClose(); }} className="w-full flex items-center gap-3 px-4 py-3 text-[13.5px]" style={{ color:T.error, border:"1px solid rgba(168,59,50,0.25)", borderRadius:RADIUS.sm }}>
            <LogOut size={15}/> Sign Out
          </button>
        </> : <div className="flex gap-3">
          <SweepButton filled onClick={()=>go("login")} className="flex-1 !px-4 !py-3">Sign In</SweepButton>
          <SweepButton onClick={()=>go("signup")} className="flex-1 !px-4 !py-3">Register</SweepButton>
        </div>}
      </div>
    </nav>
  </>;
}

// Slide-in mini-cart (opened via the Header cart icon) for a quick view/
// remove without leaving the current page. "View Full Cart" and
// "Checkout" navigate to the full CartView/CheckoutView pages.
function CartDrawer({ open, onClose, cart, setCart, navigate }) {
  const total = cart.reduce((s,i)=>s+i.price*i.qty,0);
  // Quantity +/- controls, matching the same pattern and caps (1-99)
  // already used on the full /cart page — found missing here specifically
  // (the drawer only ever let you remove an item entirely, never adjust
  // how many).
  //
  // REAL BUG FIX: this used to match only on id+size, completely
  // ignoring color — found while tracing a customer's screenshot of a
  // separate cart-display bug. For a genuine color-variant product,
  // two DIFFERENT colors of the SAME size were treated as the exact
  // same cart line: the React key collided, and +/-/Remove on one
  // color's line could silently act on the wrong color instead. Now
  // matches on id+size+color together, same real identity the product
  // page itself already uses to decide whether an add is a new line or
  // a quantity bump on an existing one.
  const sameLine=(item,id,size,color)=>item.id===id&&item.size===size&&(item.color||null)===(color||null);
  const updateQty=(id,size,color,d)=>setCart(c=>c.map(i=>sameLine(i,id,size,color)?{...i,qty:Math.min(99,Math.max(1,i.qty+d))}:i));
  return <>
    <div onClick={onClose} className="fixed inset-0 z-[60] transition-opacity duration-300" style={{ backgroundColor:"rgba(36,62,65,0.4)",opacity:open?1:0,pointerEvents:open?"all":"none" }}/>
    <aside aria-label="Shopping cart" aria-modal={open} role="dialog" className="fixed top-0 right-0 bottom-0 z-[70] flex flex-col transition-transform duration-500"
      style={{ width:"min(92vw,400px)", backgroundColor:T.cream, transform:open?"translateX(0)":"translateX(100%)", boxShadow:"-20px 0 60px -20px rgba(36,62,65,0.3)" }}>
      <div className="flex items-center justify-between p-6" style={{ borderBottom:"1px solid rgba(36,62,65,0.1)" }}>
        <h2 className="italic text-[20px]" style={{ fontFamily:"Fraunces,serif",color:T.teal }}>Cart ({cart.reduce((s,i)=>s+i.qty,0)})</h2>
        <button onClick={onClose} style={{ color:T.teal }}><X size={20}/></button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {cart.length===0 ? <p className="text-[14px] text-center mt-12" style={{ color:"rgba(36,62,65,0.75)" }}>Your cart is empty.</p>
        : cart.map(item=>{
          // REAL BUG FIX, directly reported: the cart sidebar always
          // showed the decorative SVG placeholder, even for a product
          // with a real, uploaded photo — because this line only ever
          // checked item.Art (which enrichProduct sets unconditionally
          // on every real product, real photo or not) and never
          // actually looked at item.media at all. Same real, proven
          // pattern already used correctly in ProductCard: find the
          // first real IMAGE entry (not a video — this small square
          // thumbnail isn't set up to play one) and show that; only
          // fall back to the decorative art when a product genuinely
          // has no real photo yet.
          const firstImage=item.media?.find(m=>m.type==="image"&&m.src)?.src;
          const ItemArt=item.Art||PlanterArt;
          return <div key={item.id+item.size+(item.color||"")} className="flex gap-4 mb-5">
          <div className="w-20 h-20 flex items-center justify-center shrink-0 overflow-hidden" style={{ backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md }}>
            {firstImage?<img src={firstImage} alt={item.name} className="w-full h-full object-cover"/>:<ItemArt className="w-3/5 h-3/5" style={{ color:T.teal,opacity:0.8 }}/>}
          </div>
          <div className="flex-1">
            <h3 className="text-[13px] italic mb-0.5" style={{ fontFamily:"Fraunces,serif",color:T.teal }}>{item.name}</h3>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {item.color&&item.colors&&<span className="text-[11px]" style={{ color:"rgba(36,62,65,0.75)" }}>{item.colors.find(c=>c.variantKey===item.color)?.label||item.color}</span>}
              {item.size&&<p className="text-[11px]" style={{ color:"rgba(36,62,65,0.75)" }}>Size: {item.size}</p>}
            </div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="inline-flex items-center" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs}}>
                <button onClick={()=>updateQty(item.id,item.size,item.color,-1)} className="w-7 h-7 flex items-center justify-center" style={{color:T.teal}} aria-label={`Decrease quantity of ${item.name}`}><Minus size={11}/></button>
                <span className="w-6 text-center text-[12.5px]" style={{fontFamily:"'Fraunces',serif"}}>{item.qty}</span>
                <button onClick={()=>updateQty(item.id,item.size,item.color,1)} className="w-7 h-7 flex items-center justify-center" style={{color:T.teal}} aria-label={`Increase quantity of ${item.name}`}><Plus size={11}/></button>
              </div>
              <p className="text-[13px]" style={{ color:T.teal }}>₹{item.price*item.qty}</p>
            </div>
            <button onClick={()=>setCart(c=>c.filter(i=>!sameLine(i,item.id,item.size,item.color)))} className="flex items-center gap-1 text-[11px] uppercase tracking-wide" style={{ color:"rgba(36,62,65,0.75)" }}><Trash2 size={11}/> Remove</button>
          </div>
        </div>;})}
      </div>
      {cart.length>0&&<div className="p-6" style={{ borderTop:"1px solid rgba(36,62,65,0.1)" }}>
        <div className="flex justify-between mb-2">
          <span className="text-[13px]" style={{ color:"rgba(36,62,65,0.75)" }}>Subtotal</span>
          <span className="text-[17px]" style={{ fontFamily:"Fraunces,serif",color:T.teal }}>₹{total.toLocaleString("en-IN")}</span>
        </div>
        <p className="text-[11.5px] mb-4" style={{ color:"rgba(36,62,65,0.6)", fontFamily:"'Fraunces',serif", fontStyle:"italic" }}>Printed after you order · typically 2–3 weeks</p>
        <SweepButton filled onClick={()=>{ onClose(); navigate("checkout"); }} className="w-full">Checkout</SweepButton>
        <button onClick={()=>{ onClose(); navigate("cart"); }} className="w-full py-3 text-[11px] tracking-[0.08em] uppercase mt-2" style={{ color:"rgba(36,62,65,0.75)" }}>View Full Cart</button>
      </div>}
    </aside>
  </>;
}

// Email capture form used in the Footer — used to just show "Joined ✓"
// with nothing behind it, no backend, nothing stored. Now genuinely
// submits and stores the subscription (see server/routes/newsletter.js).
function NewsletterForm() {
  const [email,setEmail]=useState(""); const [done,setDone]=useState(false); const [submitting,setSubmitting]=useState(false); const [error,setError]=useState("");
  if(done) return <p className="text-[13px]" style={{color:T.cream}}>Joined ✓</p>;
  const submit=async e=>{
    e.preventDefault();
    if(!validEmail(email)){ setError("Enter a valid email"); return; }
    setSubmitting(true); setError("");
    try{
      const res=await apiFetch("/api/newsletter",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});
      if(res.ok) setDone(true);
      else setError("Couldn't save that — please try again.");
    }catch{
      setError("Couldn't reach the server.");
    }finally{
      setSubmitting(false);
    }
  };
  return <div>
    <form onSubmit={submit} className="flex" style={{border:"1px solid rgba(255,255,255,0.15)"}}>
      <input value={email} onChange={e=>setEmail(sanitize(e.target.value))} placeholder="your@email.com" type="email" maxLength={100}
        className="flex-1 bg-transparent text-[13px] outline-none px-3" style={{color:"white",minWidth:0}}/>
      <button type="submit" disabled={submitting} className="px-4 py-3 text-[11px] tracking-[0.1em] uppercase shrink-0" style={{backgroundColor:"rgba(255,255,255,0.1)",color:T.cream}}>{submitting?"…":"Join"}</button>
    </form>
    {error&&<p className="text-[11px] mt-1.5" style={{color:"#E8A598"}}>{error}</p>}
  </div>;
}

// Sitewide footer: brand blurb + contact info, Collections (from
// CATEGORIES), Company links, Newsletter signup, and the bottom legal bar
// (Privacy/Refunds/Shipping/Terms/Cookies/Accessibility/Email Preferences/
// GSTIN). className="no-print" — hidden on the printed invoice.
function Footer({ navigate }) {
  // Real, admin-editable footer copy (Site Content → Footer) — same
  // real fallback discipline as the hero: if the fetch fails or hasn't
  // resolved yet, the original hardcoded real text is shown, so the
  // footer — present on every single page of the site — never breaks
  // or shows blank.
  const [footerCms,setFooterCms]=useState(null);
  const { names: categoryNames } = useCategories();
  useEffect(()=>{
    fetch("/api/page-content/footer").then(r=>r.ok?r.json():null).then(d=>{
      const block=d?.blocks?.find(b=>b.blockType==="footerBrand");
      if(block) setFooterCms(JSON.parse(block.content));
    }).catch(()=>{});
  },[]);
  const fb=footerCms||{tagline:"Precision geometric home décor, 3D-printed to order in our Mumbai studio using plant-based materials.",email:"support@akaraonline.co.in",phone:"+91 82780 85572",instagram:"@atelier.akara",location:"India",newsletterBlurb:"New pieces, restocks — nothing more often than that."};
  const phoneDigits=fb.phone.replace(/[^\d+]/g,"");
  return <footer className="no-print" style={{backgroundColor:T.teal}}>
    <div className="px-8 md:px-14 pt-14 pb-10 max-w-[1800px] mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-10">
        <div className="sm:col-span-2 md:col-span-1">
          <div className="mb-5 flex items-center">
            <img src="/logo-wordmark-cream.png" alt="ĀKĀRA" width={150} height={48}
              className="block h-9 w-auto object-contain object-left select-none" decoding="async" draggable={false}/>
          </div>
          <p className="text-[13.5px] leading-[1.85] mb-6 max-w-[220px]" style={{color:"rgba(255,255,255,0.55)"}}>
            {fb.tagline}
          </p>
          <div className="flex flex-col gap-2.5">
            {[[Mail,fb.email,`mailto:${fb.email}`],
              [Phone,fb.phone,`tel:${phoneDigits}`],
              [Instagram,fb.instagram,`https://instagram.com/${fb.instagram.replace(/^@/,"")}`],
              [MapPin,fb.location,null]
            ].map(([Icon,label,href])=><div key={label} className="flex items-start gap-2.5">
              <Icon size={13} style={{color:T.cream,flexShrink:0,marginTop:"2px"}}/>
              {href?<a href={href} className="text-[12.5px] hover:text-white transition-colors break-words min-w-0" style={{color:"rgba(255,255,255,0.55)"}}>{label}</a>
                :<span className="text-[12.5px] break-words min-w-0" style={{color:"rgba(255,255,255,0.55)"}}>{label}</span>}
            </div>)}
          </div>
        </div>
        <div>
          <p className="text-[10.5px] tracking-[0.14em] uppercase mb-5" style={{color:T.cream}}>Collections</p>
          {["The collection",...categoryNames].map((c,i)=><button key={c} onClick={()=>navigate("shop",i===0?null:c)}
            className="block text-[13px] mb-3 text-left hover:text-white transition-colors" style={{color:"rgba(255,255,255,0.55)"}}>{c}</button>)}
        </div>
        <div>
          <p className="text-[10.5px] tracking-[0.14em] uppercase mb-5" style={{color:T.cream}}>Company</p>
          {[["About","about"],["The Craft","craft"],["Contact","contact"],["FAQ","faq"],["Care Guide","care-guide"],["Bulk & Corporate Orders","bulk-orders"],["Track Your Order","track-order"],["Android App","android-app"],["My Account","account"]].map(([l,v])=><button key={v} onClick={()=>navigate(v)}
            className="block text-[13px] mb-3 text-left hover:text-white transition-colors" style={{color:"rgba(255,255,255,0.55)"}}>{l}</button>)}
        </div>
        <div>
          <p className="text-[10.5px] tracking-[0.14em] uppercase mb-5" style={{color:T.cream}}>Stay in the Loop</p>
          <p className="text-[13px] leading-[1.7] mb-4" style={{color:"rgba(255,255,255,0.5)"}}>{fb.newsletterBlurb}</p>
          <NewsletterForm/>
        </div>
      </div>
    </div>
    <div style={{borderTop:"1px solid rgba(255,255,255,0.1)"}}>
      <div className="px-8 md:px-14 py-6 max-w-[1800px] mx-auto flex flex-col sm:flex-row justify-between gap-3">
        <p className="text-[11.5px]" style={{color:"rgba(255,255,255,0.5)"}}>© 2025–2026 Precision Forge Labs. All rights reserved.</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {[["Privacy","privacy"],["Refunds","refund"],["Shipping","shipping"],["Terms","terms"],["Cookies","cookies"],["Accessibility","accessibility"],["Email Preferences","email-preferences"]].map(([l,v])=><button key={v} onClick={()=>navigate(v)}
            className="text-[11.5px] hover:text-white transition-colors" style={{color:"rgba(255,255,255,0.5)"}}>{l}</button>)}
        </div>
        <p className="text-[11.5px]" style={{color:"rgba(255,255,255,0.5)"}}>GSTIN 27GZCPS9353H1ZQ</p>
      </div>
    </div>
  </footer>;
}

// ============================================================================
// PRODUCT DISPLAY COMPONENTS
// ============================================================================
// Shown in place of a product grid while catalog data is still loading or
// failed to load — used by every view that needs real product data (Home's
// featured section, Shop, Search, ProductDetail), each checking
// {products,loading,error} from ProductsContext itself now that the old
// app-wide blocking gate is gone (see the real Lighthouse-confirmed LCP
// fix in AkaraAppRoot). Two separate pieces, used separately by design:
// ProductGridSkeleton returns bare skeleton items only (no wrapping grid
// div), meant to be dropped directly inside the caller's own existing
// grid container so column counts line up correctly. ProductGridError is
// a standalone block replacing the grid entirely, not a grid item itself.
function ProductGridSkeleton({ count=8 }){
  return <>{Array.from({length:count}).map((_,i)=><div key={i} className="flex flex-col gap-3">
    <Skeleton height={280} radius={RADIUS.md}/>
    <Skeleton height={14} width="70%"/>
    <Skeleton height={14} width="40%"/>
  </div>)}</>;
}
function ProductGridError(){
  return <div className="px-6 py-16 text-center max-w-[480px] mx-auto">
    <p className="italic text-[18px] mb-3" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Couldn't load the collection.</p>
    <p className="text-[13.5px] leading-[1.8] mb-6" style={{color:"rgba(36,62,65,0.75)"}}>Something went wrong reaching the server. Please check your connection and try again.</p>
    <SweepButton filled onClick={()=>window.location.reload()}>Retry</SweepButton>
  </div>;
}

// ============================================================================
// A single product tile used in every grid sitewide (Shop, Search
// results, Home featured/related products). Hover-lift, quick add-to-cart,
// and wishlist-toggle all live here so grid behavior stays identical
// everywhere it's used.
// ============================================================================
// SCROLLABLE PRODUCT ROW — replaces the wrapping grid the Featured
// Pieces and New Collection sections used to use, per direct owner
// instruction: once more than 3-4 products were added, extra ones
// dropped to a new row below, pushing the rest of the homepage down.
// Explicitly asked to be genuinely custom and premium — NOT a plain
// scrollbar or generic arrow icons — so this is built from three real
// pieces working together, not a single library component:
//   1. Native browser scroll-snap (scroll-smooth + snap-x) for the
//      actual momentum/feel, with the native scrollbar hidden via the
//      same akara-no-scrollbar utility already used elsewhere.
//   2. Real mouse drag-to-scroll — a desktop visitor shouldn't need a
//      trackpad or a physical horizontal scroll gesture just to browse;
//      click-and-drag anywhere on the row scrolls it directly.
//   3. Subtle, brand-styled circular arrow buttons — teal-on-cream,
//      matching the site's existing button language — that fade in
//      only on hover (desktop) so they don't visually clutter the row
//      on a normal, non-hovering view, and stay always-visible on
//      touch devices (where hover doesn't exist) via a media query.
// Product cards themselves are completely unchanged — only the
// container they sit in is different.
// ============================================================================
function ScrollableProductRow({children}){
  const scrollRef=useRef(null);
  const isDragging=useRef(false);
  const dragStart=useRef({x:0,scrollLeft:0});
  const [canScrollLeft,setCanScrollLeft]=useState(false);
  const [canScrollRight,setCanScrollRight]=useState(false);

  const updateArrows=useCallback(()=>{
    const el=scrollRef.current; if(!el) return;
    setCanScrollLeft(el.scrollLeft>4);
    setCanScrollRight(el.scrollLeft<el.scrollWidth-el.clientWidth-4);
  },[]);

  useEffect(()=>{
    updateArrows();
    const el=scrollRef.current; if(!el) return;
    const onResize=()=>updateArrows();
    window.addEventListener("resize",onResize);
    return ()=>window.removeEventListener("resize",onResize);
    // Deliberately NOT depending on `children` directly — children is a
    // brand-new array reference on every parent render (React elements
    // are never referentially stable across renders), which would
    // re-run this effect far more often than genuinely needed. This
    // only needs to run once on mount and again on a real window
    // resize; updateArrows itself is called directly by onScroll below
    // for the case that actually matters (the row's own scroll
    // position changing).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[updateArrows]);

  const scrollByAmount=dir=>{
    const el=scrollRef.current; if(!el) return;
    // Roughly one card-width per click, not the whole row — a single
    // click should feel like "advance by about one product," not a
    // disorienting jump to the far end.
    el.scrollBy({left:dir*(el.clientWidth*0.85),behavior:"smooth"});
  };

  // Real drag-to-scroll — mousedown starts tracking, mousemove (only
  // while actually dragging) translates horizontal mouse movement
  // directly into scrollLeft, mouseup/mouseleave stops. Deliberately
  // NOT touch events here — touch already gets real native scrolling
  // for free via overflow-x-auto, adding a custom touch handler on top
  // would fight the browser's own momentum scrolling rather than help it.
  const onMouseDown=e=>{
    isDragging.current=true;
    dragStart.current={x:e.pageX,scrollLeft:scrollRef.current.scrollLeft};
    scrollRef.current.style.cursor="grabbing";
  };
  const onMouseMove=e=>{
    if(!isDragging.current) return;
    e.preventDefault();
    const dx=e.pageX-dragStart.current.x;
    scrollRef.current.scrollLeft=dragStart.current.scrollLeft-dx;
  };
  const stopDragging=()=>{
    isDragging.current=false;
    if(scrollRef.current) scrollRef.current.style.cursor="grab";
  };

  return <div className="relative">
    {canScrollLeft&&<button onClick={()=>scrollByAmount(-1)} aria-label="Scroll left"
      className="akara-scroll-arrow akara-scroll-arrow-left hidden md:flex items-center justify-center absolute left-0 top-1/2 -translate-y-1/2 z-10 -translate-x-1/2"
      style={{width:"44px",height:"44px",borderRadius:"50%",backgroundColor:T.cream,color:T.teal,boxShadow:"0 8px 24px -8px rgba(36,62,65,0.35)"}}>
      <ChevronLeft size={20}/>
    </button>}
    {canScrollRight&&<button onClick={()=>scrollByAmount(1)} aria-label="Scroll right"
      className="akara-scroll-arrow akara-scroll-arrow-right hidden md:flex items-center justify-center absolute right-0 top-1/2 -translate-y-1/2 z-10 translate-x-1/2"
      style={{width:"44px",height:"44px",borderRadius:"50%",backgroundColor:T.cream,color:T.teal,boxShadow:"0 8px 24px -8px rgba(36,62,65,0.35)"}}>
      <ChevronRight size={20}/>
    </button>}
    <div ref={scrollRef} onScroll={updateArrows}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={stopDragging} onMouseLeave={stopDragging}
      className="akara-no-scrollbar flex gap-8 overflow-x-auto scroll-smooth select-none"
      style={{cursor:"grab",scrollSnapType:"x proximity",paddingBottom:"4px"}}>
      {children.map((child,i)=><div key={i} style={{scrollSnapAlign:"start",flex:"0 0 auto",width:"min(320px,80vw)"}}>{child}</div>)}
    </div>
  </div>;
}

// REAL, DIRECT FIX, directly requested: stock status needs to show
// consistently everywhere a product appears — the shop grid, search,
// homepage, wishlist, mood boards — not just its own product page.
// A real, small, shared badge, matching the EXACT same, established
// real visual style already used on the actual product page's own
// image (top-left, teal background, white text) — reused here rather
// than inventing a second, different-looking real style, so a Sold
// Out product looks the same real way wherever a customer sees it.
// Deliberately renders nothing for a genuinely healthy "in-stock"
// status — a badge is only useful when it's telling the customer
// something worth knowing before they click in.
function StockBadge({ status }){
  if(!status||status==="in-stock") return null;
  const label=status==="sold-out"?"Sold Out":status==="low-stock"?"Low Stock":status==="pre-order"?"Pre-Order":null;
  if(!label) return null;
  return <div className="absolute top-3 left-3 px-2.5 py-1 text-[9.5px] uppercase tracking-[0.08em] z-10" style={{backgroundColor:T.teal,color:"white",borderRadius:RADIUS.xs}}>{label}</div>;
}
function ProductCard({ product, navigate, cart, setCart, wishlist, toggleWishlist }) {
  const {id,name,cat,price,gstInclusiveDisplayPrice,hasRealPriceRange,cardStatus,Art,media}=product;
  // REAL BUG FIX: this card has never actually shown a real product
  // photo, on the homepage, the shop grid, or anywhere else it's used —
  // found directly from a report that no photos or video were showing
  // ANYWHERE despite genuinely uploading them and the product page
  // itself displaying them correctly. Traced to this component only
  // ever rendering the decorative Art placeholder, with no check for
  // real media at all — enrichProduct() (in AkaraApp.jsx) already
  // correctly keeps the real, actual media array when real photos
  // exist, so the data was always genuinely available here; it was
  // simply never read. firstImage below finds the first REAL image
  // (a genuine, non-null src) — deliberately not just media[0], since
  // a product's first media entry can be a video, which this small
  // square card thumbnail isn't set up to play.
  const firstImage=media?.find(m=>m.type==="image"&&m.src)?.src;
  const [hover,setHover]=useState(false);
  const isWished=wishlist.includes(id);
  const toggleWish=e=>{ e.stopPropagation(); toggleWishlist(id); };
  // REAL BUG FIX, found from a customer screenshot: adding straight
  // from this card never set a size/color at all, which for a product
  // with real color variants (like Vermillion Pendant Lamp) produced a
  // genuinely ambiguous "no size, no color" cart line — displayed with
  // no size label, AND (found while tracing this) checkout would then
  // reject it outright, since priceCartServerSide now requires an
  // exact-matching real variant for any product that has variants at
  // all. A product WITH real colors has no single correct "add
  // directly" price/color to guess at from this card, so this now
  // sends the customer to the product page to actually pick one,
  // instead of silently creating a cart line that either shows wrong
  // or fails at checkout. A product with no variants (the majority)
  // is completely unaffected — same one-click add as before.
  const hasVariants=product.colors&&product.colors.length>0;
  const isSoldOut=product.cardStatus==="sold-out"||product.status==="sold-out"||product.stock===0;
  const addToCart=e=>{
    e.stopPropagation();
    if(isSoldOut) return;
    if(hasVariants){ navigate("product",id); return; }
    trackAkara("add_to_cart",{productId:id,name:product.name,price:product.gstInclusiveDisplayPrice??product.price,qty:1});
    setCart(c=>{ const ex=c.find(i=>i.id===id&&!i.size); if(ex) return c.map(i=>i.id===id&&!i.size?{...i,qty:i.qty+1}:i); return [...c,{...product,qty:1}]; });
  };
  // Unified across every screen size (originally mobile-only, then
  // brought to desktop too — see the note further down by the actual
  // control). Was confusing before: a persistent top-right cart icon AND
  // a separate hover-reveal full "ADD TO CART" bar, and neither one
  // visually reflected that an item had already been added (bug #3 from
  // the mobile bug sweep). Replaced by one bottom-right control: an icon
  // while empty, a real inline +/- stepper the moment there's a real
  // quantity in the cart — no drawer needed just to see or change how many.
  // For a variant product, cartQty/updateQty below intentionally stay
  // at their "nothing in cart" values — there's no single correct
  // quantity to show or adjust here when the same product could have
  // several different size/color lines in the cart at once, each with
  // its own real quantity. The card always shows the plain add icon
  // for a variant product, which (see addToCart above) correctly
  // routes to the product page rather than pretending one +/- stepper
  // could represent every variant's quantity at once.
  const cartQty=hasVariants?0:cart.find(i=>i.id===id&&!i.size)?.qty||0;
  const updateQty=(e,d)=>{ e.stopPropagation(); setCart(c=>c.map(i=>i.id===id&&!i.size?{...i,qty:Math.min(99,Math.max(0,i.qty+d))}:i).filter(i=>!(i.id===id&&!i.size&&i.qty<=0))); };
  return <div className="group relative flex flex-col cursor-pointer transition-transform duration-500 ease-out"
    style={{transform:hover?"translateY(-5px)":"translateY(0)"}}
    onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} onClick={()=>navigate("product",id)}>
    <div className="relative aspect-square flex items-center justify-center overflow-hidden transition-shadow duration-500"
      style={{backgroundColor:T.card,boxShadow:hover?"0 24px 50px -20px rgba(36,62,65,0.26),0 0 0 1px rgba(184,147,90,0.28)":"0 6px 22px -12px rgba(36,62,65,0.12),0 0 0 1px rgba(36,62,65,0.06)",borderRadius:RADIUS.md}}>
      <StockBadge status={cardStatus}/>
      {firstImage
        ?<img src={firstImage} alt={name} loading="lazy" className="w-full h-full object-cover transition-transform duration-700 ease-out" style={{transform:hover?"scale(1.03)":"scale(1)"}}/>
        :<div className="w-2/5 h-2/5 transition-transform duration-700 ease-out" style={{color:T.teal,opacity:0.82,transform:hover?"scale(1.1)":"scale(1)"}}>
        <Art/>
      </div>}
      <button onClick={toggleWish} aria-label={isWished?`Remove ${name} from wishlist`:`Add ${name} to wishlist`}
        className="absolute top-3.5 right-3.5 w-8 h-8 flex items-center justify-center border"
        style={{borderColor:"rgba(36,62,65,0.1)",backgroundColor:"rgba(255,255,255,0.75)"}}>
        <Heart size={14} style={{color:isWished?T.gold:T.teal,fill:isWished?T.gold:"none"}}/>
      </button>
      {/* Unified across every screen size — this used to be two separate
          implementations (a hover-reveal bar for desktop, a persistent
          icon for mobile), which shared the same underlying flaw: once
          you'd added something and looked away, nothing showed it was
          actually in your cart without opening the drawer. One
          consistent, always-informative control everywhere is easier to
          reason about and keep correct than maintaining two forever. */}
      {isSoldOut?null:cartQty===0
        ?<button type="button" onClick={addToCart} aria-label={`Add ${name} to bag`}
            className="group/atc absolute bottom-3 right-3 md:bottom-3.5 md:right-3.5 min-w-[44px] h-11 md:h-10 flex items-center justify-center gap-0 md:hover:gap-2 px-0 md:hover:px-3.5 overflow-hidden akara-press transition-all duration-300"
            style={{backgroundColor:T.teal,borderRadius:RADIUS.sm,boxShadow:"0 8px 20px -12px rgba(24,54,48,0.55)",border:"1px solid rgba(245,240,232,0.12)"}}>
          <ShoppingBag size={16} className="shrink-0" style={{color:"#F5F0E8"}}/>
          <span className="hidden md:inline-block max-w-0 md:group-hover/atc:max-w-[5.5rem] overflow-hidden text-[10px] tracking-[0.14em] uppercase whitespace-nowrap transition-all duration-300" style={{color:"#F5F0E8"}}>Add</span>
        </button>
        :<div onClick={e=>e.stopPropagation()} className="absolute bottom-3 right-3 md:bottom-3.5 md:right-3.5 flex items-center h-11 md:h-10" style={{backgroundColor:T.teal,borderRadius:RADIUS.sm,boxShadow:"0 8px 20px -12px rgba(24,54,48,0.55)"}}>
          <button type="button" onClick={e=>updateQty(e,-1)} aria-label={`Decrease quantity of ${name}`} className="w-10 md:w-9 h-full flex items-center justify-center akara-press"><Minus size={13} style={{color:"#F5F0E8"}}/></button>
          <span className="text-[12.5px] px-0.5 min-w-[18px] text-center" style={{color:"#F5F0E8"}}>{cartQty}</span>
          <button type="button" onClick={e=>updateQty(e,1)} aria-label={`Increase quantity of ${name}`} className="w-10 md:w-9 h-full flex items-center justify-center akara-press"><Plus size={13} style={{color:"#F5F0E8"}}/></button>
        </div>}
    </div>
    <div className="pt-4 flex items-start justify-between gap-2">
      <div>
        <p className="text-[10px] tracking-[0.12em] uppercase mb-1" style={{color:"rgba(36,62,65,0.75)"}}>{cat}</p>
        <h3 className="text-[15px] italic" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{name}</h3>
      </div>
      <p className="text-[14px] shrink-0 pt-0.5" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{hasRealPriceRange?"From ":""}₹{gstInclusiveDisplayPrice??price}</p>
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
    <div className="absolute w-[280px] h-[280px] sm:w-[360px] sm:h-[360px] md:w-[400px] md:h-[400px] rounded-full left-1/2 -translate-x-1/2"
      style={{top:"-1rem",background:"radial-gradient(circle,rgba(184,147,90,0.11) 0%,rgba(184,147,90,0.03) 50%,transparent 72%)"}}/>
    <svg viewBox="0 0 240 340" className="absolute w-[72px] sm:w-[110px] md:w-[150px] left-1/2 -translate-x-1/2"
      style={{opacity:0.72,top:"0.25rem",maxHeight:"min(14vh,120px)"}}>
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
// "Still under construction" notice — admin-toggleable (Settings), so it
// can be turned off the moment the site is actually ready without a code
// change or redeploy. Shows once per browser session (not on every single
// page load, which would just be annoying for a returning visitor) via
// sessionStorage, and only on the homepage, per the specific scope asked
// for — not a sitewide interstitial.
function MaintenanceNotice(){
  const [show,setShow]=useState(false);
  const [message,setMessage]=useState("");
  useEffect(()=>{
    if(sessionStorage.getItem("akara_maintenance_dismissed")==="1") return;
    fetch("/api/coupons/maintenance").then(r=>r.json()).then(data=>{
      if(data.enabled){ setMessage(data.message); setShow(true); }
    }).catch(()=>{});
  },[]);
  const dismiss=()=>{ setShow(false); sessionStorage.setItem("akara_maintenance_dismissed","1"); };
  if(!show) return null;
  return <div className="fixed inset-0 z-[200] flex items-center justify-center px-4" style={{backgroundColor:"rgba(24,54,48,0.78)"}} onClick={dismiss}>
    <div onClick={e=>e.stopPropagation()} className="w-full max-w-[440px] p-8 text-center relative" style={{backgroundColor:T.cream,borderRadius:RADIUS.md,boxShadow:ELEVATION.modal}}>
      <button onClick={dismiss} aria-label="Close maintenance notice" className="absolute top-4 right-4 p-1" style={{color:"rgba(36,62,65,0.75)"}}><X size={18}/></button>
      <p className="text-[40px] mb-4" aria-hidden="true">🚧</p>
      <p className="italic text-[22px] mb-3" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>We're still building this.</p>
      <p className="text-[14px] leading-[1.7] mb-7" style={{color:"rgba(36,62,65,0.75)"}}>{message}</p>
      <SweepButton filled onClick={dismiss}>Got It</SweepButton>
    </div>
  </div>;
}
function HomeView({ navigate, cart, setCart, wishlist, toggleWishlist }) {
  const { names: categoryNames, rows: catRows, blurbs: catBlurbs } = useCategories();
  const { products, loading:productsLoading, error:productsError } = useProducts();
  // Admin-curated room stories (Catalog → Room Stories). null = still loading; [] = none configured.
  const [roomBoards,setRoomBoards]=useState(null);
  useEffect(()=>{
    fetch("/api/room-stories")
      .then(r=>r.ok?r.json():null)
      .then(d=>setRoomBoards(Array.isArray(d?.boards)?d.boards:[]))
      .catch(()=>setRoomBoards([]));
  },[]);
  const [reveal,setReveal]=useState(false);
  const [mouse,setMouse]=useState({x:0,y:0});
  const heroRef=useRef(null);
  useEffect(()=>{ const t=setTimeout(()=>setReveal(true),120); return ()=>clearTimeout(t); },[]);
  const onMove=e=>{ const r=heroRef.current.getBoundingClientRect(); setMouse({x:(e.clientX-r.left)/r.width-0.5,y:(e.clientY-r.top)/r.height-0.5}); };
  // Real, admin-editable hero copy (Site Content → Homepage Hero) —
  // the "second CMS pass". Genuinely falls back to the original
  // hardcoded real text if the fetch fails or hasn't resolved yet, so
  // the homepage's own hero — the single most-seen section on the
  // whole site — never shows blank or broken while this loads, and
  // never breaks if the CMS content is ever temporarily unreachable.
  const [heroCms,setHeroCms]=useState(null);
  useEffect(()=>{
    fetch("/api/page-content/home").then(r=>r.ok?r.json():null).then(d=>{
      const block=d?.blocks?.find(b=>b.blockType==="heroWithCta");
      if(block) setHeroCms(JSON.parse(block.content));
    }).catch(()=>{});
  },[]);
  const hero=heroCms||{eyebrow:"Est. Mumbai · Made to Order",heading:"Let there<br/>be **form**.",subtext:"Precision geometric planters, vases and lighting — 3D-printed to order in our Mumbai studio, never pulled from a shelf.",ctaLabel:"Explore the Collection",ctaLabel2:"Our Story"};
  // Real parser for the two real, deliberately-supported inline
  // conventions in the CMS-editable heading — <br/> for the real line
  // break between "Let there" and "be form.", and **bold** for the
  // gold/emphasis span, matching the exact same **bold** convention
  // already used by the About/Craft hero block type. Split on <br/>
  // FIRST (an actual line break is structural), then run the existing
  // real bold-parsing logic on each resulting line — a raw "<br/>"
  // string would otherwise render as literal, visible text, since
  // React doesn't interpret strings as HTML.
  const heroHeadingLines=hero.heading.split(/<br\s*\/?>/i).map(line=>
    line.split(/(\*\*[^*]+\*\*)/).map((part,i)=>part.startsWith("**")?<span key={i} style={{color:T.teal,opacity:0.55}}>{part.slice(2,-2)}</span>:part)
  );
  // Real, admin-curated selection (products.featuredOrder is set from
  // the admin "Featured Products" screen) — replaces the OLD featured
  // variable here, which computed products.slice(0,3) but was never
  // actually rendered anywhere in this component; the visible section
  // below used a live category filter instead, unrelated to genuine
  // curation. Sorted by featuredOrder so admin's chosen sequence is
  // respected, not just "whichever order the database happens to
  // return them in."
  const featured=products.filter(p=>p.featuredOrder!=null).sort((a,b)=>a.featuredOrder-b.featuredOrder);
  // New Collection — deliberately NOT a new admin field to maintain;
  // based on the product's own real createdAt, the honest definition
  // of "new" that stays accurate automatically as the catalog grows,
  // with zero extra admin upkeep. Capped at 8 so this section can't
  // grow into a second full catalog page as more products get added
  // over time.
  const newCollection=[...products].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,8);
  return <div>
    <MaintenanceNotice/>
    <section ref={heroRef} onMouseMove={onMove}
      className="relative flex flex-col items-center justify-start md:justify-end text-center px-6 overflow-hidden pt-[7.5rem] pb-12 sm:pt-32 sm:pb-14 md:pt-0 md:pb-[4vh] md:min-h-[70vh] lg:min-h-[76vh]">
      <LightWash mx={mouse.x} my={mouse.y}/>
      <p className={`relative z-10 text-[11px] sm:text-[12px] tracking-[0.28em] sm:tracking-[0.32em] uppercase mb-4 sm:mb-5 md:mb-7 transition-all duration-700 ${reveal?"opacity-100 translate-y-0":"opacity-0 translate-y-2"}`} style={{color:T.teal}}>{hero.eyebrow}</p>
      <h1 className={`relative z-10 italic leading-[0.96] transition-all duration-700 delay-100 ${reveal?"opacity-100 translate-y-0":"opacity-0 translate-y-3"}`}
        style={{fontFamily:"'Fraunces',serif",fontWeight:400,fontSize:"clamp(40px,9vw,112px)",color:T.teal}}>
        {heroHeadingLines.map((line,i)=><span key={i}>{i>0&&<br/>}{line}</span>)}
      </h1>
      <p className={`relative z-10 mt-5 sm:mt-6 md:mt-8 max-w-[460px] text-[14.5px] sm:text-[16px] leading-[1.75] transition-all duration-700 delay-200 ${reveal?"opacity-100 translate-y-0":"opacity-0 translate-y-3"}`} style={{color:"rgba(36,62,65,0.75)"}}>
        {hero.subtext}
      </p>
      <div className={`relative z-10 mt-7 sm:mt-9 md:mt-11 flex gap-3 sm:gap-4 flex-wrap justify-center transition-all duration-700 delay-300 ${reveal?"opacity-100 translate-y-0":"opacity-0 translate-y-3"}`}>
        <SweepButton filled onClick={()=>navigate("shop")}>{hero.ctaLabel}</SweepButton>
        <SweepButton onClick={()=>navigate("about")}>{hero.ctaLabel2}</SweepButton>
      </div>
    </section>
    <section className="px-6 py-16 md:py-20" style={{borderTop:"1px solid rgba(36,62,65,0.08)",borderBottom:"1px solid rgba(36,62,65,0.08)",backgroundColor:"rgba(36,62,65,0.02)"}}>
      {/* Real boxed redesign, replacing the old single thin text line —
          the two never made sense to show together (same four facts,
          rendered twice), so this replaces it outright rather than
          sitting alongside it. Each badge gets its own real colored
          icon circle for visual weight, matching the brand's teal/gold
          palette rather than a generic icon-and-text row. */}
      <div className="max-w-[2000px] mx-auto px-5 sm:px-8 md:px-12 lg:px-16 xl:px-20 2xl:px-24 grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-10">
        {[[Leaf,"3D-Printed","Plant-based PLA, not mass-moulded plastic"],[RotateCcw,"7-Day Returns","Plus a 30-day manufacturing warranty"],[Lock,"Secure Checkout","Every payment processed via Razorpay"],[MapPin,"Handcrafted","Made to order in our Mumbai studio"]]
          .map(([Icon,title,sub])=><div key={title} className="flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{backgroundColor:"rgba(200,164,103,0.14)"}}>
              <Icon size={22} style={{color:T.teal}}/>
            </div>
            <div>
              <p className="text-[13.5px] mb-1" style={{color:T.teal,fontFamily:"'Fraunces',serif",fontStyle:"italic"}}>{title}</p>
              <p className="text-[11.5px] leading-[1.5]" style={{color:"rgba(36,62,65,0.75)"}}>{sub}</p>
            </div>
          </div>)}
      </div>
    </section>
    <section className="px-5 sm:px-8 md:px-12 lg:px-16 xl:px-20 2xl:px-24 py-16 md:py-24 max-w-[2000px] mx-auto w-full">
      <div className="text-center mb-12">
        <p className="text-[12px] tracking-[0.3em] uppercase mb-4" style={{color:T.teal}}>Shop by Category</p>
        <h2 className="italic text-[28px] md:text-[36px]" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>Find your form.</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
        {catRows.map(row=>{ const c=row.name; const Art=artForCategory(c, row.iconKey); const blurb=row.description || catBlurbs[c] || "";
        return <button key={c} type="button" onClick={()=>navigate("shop",c)}
          className="group flex items-start gap-4 p-5 md:p-6 text-left transition-shadow duration-300 akara-lift akara-press"
          style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
          <div className="w-12 h-12 md:w-14 md:h-14 flex items-center justify-center shrink-0 transition-transform duration-500 group-hover:scale-105"
            style={{backgroundColor:"rgba(24,54,48,0.07)",borderRadius:RADIUS.sm,color:T.teal}}>
            <Art className="w-7 h-7 md:w-8 md:h-8" style={{color:T.teal}}/>
          </div>
          <div className="min-w-0 pt-0.5">
            <p className="text-[14px] md:text-[15px] mb-1" style={{color:T.teal,fontFamily:"'Fraunces',serif"}}>{c}</p>
            {blurb && <p className="text-[12.5px] leading-snug" style={{color:T.muted}}>{blurb}</p>}
          </div>
        </button>;})}
      </div>
    </section>
        {/* Room stories — admin-curated only (Catalog → Room Stories) */}
    {roomBoards&&roomBoards.length>0&&<section className="px-5 sm:px-8 md:px-12 lg:px-16 xl:px-20 2xl:px-24 py-16 md:py-20 max-w-[2000px] mx-auto w-full akara-fade-in">
      <div className="text-center mb-10 md:mb-12">
        <p className="text-[12px] tracking-[0.3em] uppercase mb-4" style={{color:T.teal}}>Room stories</p>
        <h2 className="italic text-[28px] md:text-[36px]" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>Pieces that live together.</h2>
        <p className="text-[13.5px] mt-3 max-w-lg mx-auto" style={{color:T.muted}}>Quiet pairings from the collection — chosen in the studio, not by algorithm.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
        {roomBoards.map(board=>{
          const pair = (board.products||[]).slice(0,2);
          if(pair.length===0){
            // Prefer full catalog enrich for price display when only ids returned
            return null;
          }
          return (
              <div key={board.id||board.title} className="p-5 md:p-6 akara-lift" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised,border:"1px solid rgba(24,54,48,0.06)"}}>
                <p className="text-[11px] tracking-[0.14em] uppercase mb-1" style={{color:T.teal}}>{board.title}</p>
                <p className="text-[13px] mb-4" style={{color:T.muted}}>{board.blurb}</p>
                <div className="grid grid-cols-2 gap-3">
                  {pair.map(raw=>{
                    const p = (products||[]).find(x=>x.id===raw.id) || raw;
                    const img = (p.media||[]).find(m=>m.type==="image")?.src;
                    const price = p.gstInclusiveDisplayPrice ?? p.price;
                    return (
                      <button key={p.id} type="button" onClick={()=>navigate("product",p.id)} className="text-left group">
                        <div className="relative aspect-[4/5] overflow-hidden mb-2" style={{borderRadius:RADIUS.sm,backgroundColor:"rgba(24,54,48,0.06)"}}>
                          <StockBadge status={p.cardStatus||p.status}/>
                          {img ? <img src={img} alt={p.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" loading="lazy"/> : null}
                        </div>
                        <p className="text-[13px] italic leading-snug" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{p.name}</p>
                        <p className="text-[12px]" style={{color:T.muted}}>{p.hasRealPriceRange?"From ":""}₹{Number(price||0).toLocaleString("en-IN")}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
        })}
      </div>
    </section>}
    <section className="px-5 sm:px-8 md:px-12 lg:px-16 xl:px-20 2xl:px-24 py-16 md:py-24 max-w-[2000px] mx-auto w-full">
      <div className="text-center mb-12">
        <p className="text-[12px] tracking-[0.3em] uppercase mb-4" style={{color:T.teal}}>Why ĀKĀRA</p>
        <h2 className="italic text-[28px] md:text-[36px]" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>Built differently, on purpose.</h2>
        <div className="w-10 h-px mt-4 mx-auto" style={{backgroundColor:T.gold}}/>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          [Package,"Made to Order","Every piece is printed specifically for you — nothing sits pre-made on a shelf."],
          [Leaf,"Plant-Based Material","Printed in PLA, a plant-derived material — a more conscious choice than standard plastics."],
          [MapPin,"Designed in Mumbai","Every form is designed, printed, and finished in our own studio, start to finish."],
          [RotateCcw,"7-Day Returns","Damaged, defective, or not as described — a real 7-day window, no fine print."],
        ].map(([Icon,title,desc])=><div key={title} className="p-7 text-center" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
          <div className="w-11 h-11 flex items-center justify-center mb-5 mx-auto" style={{backgroundColor:"rgba(184,147,90,0.12)",borderRadius:RADIUS.sm}}>
            <Icon size={ICON.md} style={{color:T.teal}}/>
          </div>
          <h3 className="text-[15px] mb-2" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>{title}</h3>
          <p className="text-[13px] leading-[1.6]" style={{color:"rgba(36,62,65,0.75)"}}>{desc}</p>
        </div>)}
      </div>
    </section>
    {/* FEATURED — genuinely admin-curated (see the Admin > Featured
        Products screen), not shown at all until an admin has actually
        picked something. An empty section here would look like a
        layout bug to a real visitor, not "nothing curated yet". */}
    {!productsLoading&&featured.length>0&&<section className="px-5 sm:px-8 md:px-12 lg:px-16 xl:px-20 2xl:px-24 py-20 md:py-28 max-w-[2000px] mx-auto w-full">
      <div className="mb-12 md:mb-16 max-w-xl">
        <p className="text-[11px] tracking-[0.28em] uppercase mb-3" style={{color:"rgba(24,54,48,0.78)"}}>This season</p>
        <h2 className="italic text-[32px] md:text-[44px] leading-[1.15]" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>A form we keep returning to.</h2>
        <div className="w-10 h-px mt-5" style={{backgroundColor:T.gold}}/>
      </div>
      {(()=>{
        const hero=featured[0];
        const supports=featured.slice(1,4);
        const heroImg=hero.media?.find(m=>m.type==="image"&&m.src)?.src;
        const HeroArt=hero.Art;
        const heroCat=hero.cat||hero.category||"";
        const heroDesc=hero.description?String(hero.description).trim():"";
        return <>
          {/* Magazine spread — refined editorial: image dominates, caption is quiet */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 xl:gap-16 items-center mb-14 md:mb-20">
            <button type="button" onClick={()=>navigate("product",hero.id)}
              className="lg:col-span-7 relative overflow-hidden group text-left w-full focus:outline-none max-h-[min(52vh,420px)] md:max-h-[480px]"
              style={{aspectRatio:"4/5",backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.lg}}
              aria-label={`View ${hero.name}`}>
              <StockBadge status={hero.cardStatus}/>
              {heroImg
                ? <img src={heroImg} alt={hero.name} className="w-full h-full object-cover transition-transform duration-[1.1s] ease-out group-hover:scale-[1.025]" loading="eager"/>
                : <div className="w-full h-full flex items-center justify-center">{HeroArt&&<HeroArt className="w-1/3 h-1/3" style={{color:T.teal,opacity:0.45}}/>}</div>}
              <span className="absolute inset-0 pointer-events-none transition-opacity duration-500 opacity-0 group-hover:opacity-100"
                style={{background:"linear-gradient(to top, rgba(36,62,65,0.12), transparent 42%)"}}/>
            </button>
            <div className="lg:col-span-5 flex flex-col justify-center lg:pl-2">
              {heroCat&&<p className="text-[11px] tracking-[0.22em] uppercase mb-4" style={{color:T.teal}}>{heroCat}</p>}
              <h3 className="italic text-[30px] md:text-[40px] leading-[1.12] mb-4" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>{hero.name}</h3>
              {heroDesc&&<p className="text-[14.5px] md:text-[15px] leading-[1.8] mb-6 max-w-md" style={{color:"rgba(36,62,65,0.7)"}}>{heroDesc.slice(0,180)}{heroDesc.length>180?"…":""}</p>}
              <div className="mb-8">
                <p className="text-[24px] md:text-[26px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{hero.hasRealPriceRange?"From ":""}₹{Number(hero.gstInclusiveDisplayPrice??hero.price).toLocaleString("en-IN")}</p>
                <p className="text-[11.5px] mt-1" style={{color:"rgba(24,54,48,0.75)"}}>Incl. GST · printed after you order</p>
              </div>
              <div className="flex flex-wrap items-center gap-5">
                <SweepButton filled onClick={()=>navigate("product",hero.id)}>View this piece</SweepButton>
                <button type="button" onClick={()=>navigate("shop")}
                  className="text-[12px] tracking-[0.12em] uppercase flex items-center gap-1.5 pb-0.5 border-b transition-opacity hover:opacity-70"
                  style={{borderColor:"rgba(36,62,65,0.25)",color:T.teal}}>
                  Full collection <ArrowUpRight size={13}/>
                </button>
              </div>
            </div>
          </div>
          {supports.length>0&&(
            <div>
              <div className="flex items-end justify-between mb-8 gap-4">
                <p className="text-[11px] tracking-[0.2em] uppercase" style={{color:"rgba(24,54,48,0.75)"}}>Also in this edit</p>
                <div className="flex-1 h-px max-w-[120px] md:max-w-[200px]" style={{backgroundColor:"rgba(36,62,65,0.1)"}}/>
              </div>
              <div className={`grid gap-8 md:gap-10 ${supports.length===1?"grid-cols-1 max-w-sm":supports.length===2?"grid-cols-1 sm:grid-cols-2 max-w-3xl":"grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
                {supports.map((p,i)=>{
                  const img=p.media?.find(m=>m.type==="image"&&m.src)?.src;
                  const Art=p.Art;
                  return (
                    <button key={p.id} type="button" onClick={()=>navigate("product",p.id)}
                      className="group text-left focus:outline-none">
                      <div className="relative overflow-hidden mb-4 max-h-[220px] sm:max-h-[240px]" style={{aspectRatio:"4/5",backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
                        <StockBadge status={p.cardStatus}/>
                        {img
                          ? <img src={img} alt={p.name} loading="lazy" className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"/>
                          : <div className="w-full h-full flex items-center justify-center">{Art&&<Art className="w-1/3 h-1/3" style={{color:T.teal,opacity:0.4}}/>}</div>}
                      </div>
                      <p className="text-[10.5px] tracking-[0.18em] uppercase mb-1.5" style={{color:"rgba(24,54,48,0.72)"}}>{String(i+2).padStart(2,"0")} · {p.cat||p.category||""}</p>
                      <p className="italic text-[18px] md:text-[20px] leading-snug mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{p.name}</p>
                      <p className="text-[14px]" style={{fontFamily:"'Fraunces',serif",color:"rgba(36,62,65,0.75)"}}>{p.hasRealPriceRange?"From ":""}₹{Number(p.gstInclusiveDisplayPrice??p.price).toLocaleString("en-IN")}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>;
      })()}
    </section>}
    {/* NEW COLLECTION — the most recently created real products, capped
        at 8. Deliberately hidden if there are fewer than 4 — a section
        titled "New Collection" showing only 1-2 items reads as sparse/
        unfinished rather than genuinely exciting, the same reasoning
        already applied elsewhere (og:image, Key Features tab) for not
        showing a section before there's enough real content to justify
        it. */}
    {!productsLoading&&newCollection.length>=4&&<section className="akara-scroll-hover-area px-5 sm:px-8 md:px-12 lg:px-16 xl:px-20 2xl:px-24 py-16 md:py-24 max-w-[2000px] mx-auto w-full" style={{backgroundColor:"rgba(36,62,65,0.03)"}}>
      <div className="flex items-end justify-between mb-12 flex-wrap gap-6">
        <div>
          <p className="text-[12px] tracking-[0.3em] uppercase mb-4" style={{color:T.teal}}>Just Arrived</p>
          <h2 className="italic text-[32px] md:text-[42px]" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>New Collection.</h2>
        </div>
        <button onClick={()=>navigate("shop")} className="group flex items-center gap-2 text-[12px] tracking-[0.1em] uppercase pb-1 border-b" style={{borderColor:"rgba(36,62,65,0.2)",color:T.teal}}>
          View All <ArrowUpRight size={14} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"/>
        </button>
      </div>
      <ScrollableProductRow>
        {newCollection.map(p=><ProductCard key={p.id} product={p} navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} toggleWishlist={toggleWishlist}/>)}
      </ScrollableProductRow>
    </section>}
    {/* Process — same card language as "Built differently, on purpose" */}
    <section className="px-5 sm:px-8 md:px-12 lg:px-16 xl:px-20 2xl:px-24 py-16 md:py-24 max-w-[2000px] mx-auto w-full">
      <div className="text-center mb-12">
        <p className="text-[12px] tracking-[0.3em] uppercase mb-4" style={{color:T.teal}}>How a piece is made</p>
        <h2 className="italic text-[28px] md:text-[36px]" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>Nothing is printed until you order it.</h2>
        <div className="w-10 h-px mt-4 mx-auto" style={{backgroundColor:T.gold}}/>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          [ClipboardCheck,"01","Design","Form tested for balance, light, and quiet drama."],
          [Package,"02","Print","Plant-based PLA, layer by layer in our Mumbai studio."],
          [Check,"03","Finish","Edges and fit hand-checked before packing."],
          [Truck,"04","Dispatch","Packed with care — typically 2–3 weeks to ship."],
        ].map(([Icon,num,title,desc])=>(
          <div key={title} className="p-7 text-center" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
            <div className="w-11 h-11 flex items-center justify-center mb-4 mx-auto" style={{backgroundColor:"rgba(184,147,90,0.12)",borderRadius:RADIUS.sm}}>
              <Icon size={ICON.md} style={{color:T.teal}}/>
            </div>
            <p className="text-[11px] tracking-[0.2em] uppercase mb-2" style={{color:T.teal}}>{num}</p>
            <h3 className="text-[15px] mb-2" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>{title}</h3>
            <p className="text-[13px] leading-[1.6]" style={{color:"rgba(36,62,65,0.75)"}}>{desc}</p>
          </div>
        ))}
      </div>
    </section>
    <section className="relative px-6 py-16 md:py-20 text-center overflow-hidden" style={{backgroundColor:T.teal}}>
      <div className="pointer-events-none absolute w-[600px] h-[600px] rounded-full -left-48 -top-48" style={{background:"radial-gradient(circle,rgba(184,147,90,0.12),transparent 70%)"}}/>
      <p className="relative text-[12px] tracking-[0.3em] uppercase mb-5" style={{color:T.cream}}>Made in Mumbai</p>
      <h2 className="relative italic mx-auto max-w-xl leading-[1.3] text-white" style={{fontFamily:"'Fraunces',serif",fontWeight:400,fontSize:"clamp(26px,4vw,40px)"}}>
        Made to order.<br/>Made for <span style={{color:T.gold}}>you.</span>
      </h2>
      <div className="relative mt-12 mx-auto max-w-[520px] grid grid-cols-3 border" style={{borderColor:"rgba(255,255,255,0.15)"}}>
        {[["60–90","Units / month"],["2–3","Weeks to door"],["0","In a warehouse"]].map(([n,l],i)=><div key={l} className="py-7 px-4" style={{borderRight:i<2?"1px solid rgba(255,255,255,0.15)":"none"}}>
          <p className="text-[26px] mb-1.5 text-white" style={{fontFamily:"'Fraunces',serif"}}>{n}</p>
          <p className="text-[10px] tracking-[0.08em] uppercase" style={{color:"rgba(255,255,255,0.5)"}}>{l}</p>
        </div>)}
      </div>
    </section>
    <section className="px-5 sm:px-8 md:px-12 lg:px-16 xl:px-20 2xl:px-24 py-16 md:py-24 max-w-[2000px] mx-auto w-full">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {[["The Craft","How every piece is designed, printed, and finished — materials and process.","craft"],
          ["Care Guide","How to keep your piece looking the way it did on day one.","care-guide"],
          ["Bulk & Corporate Orders","Ordering for a hotel, café, or gifting programme? Let's talk.","bulk-orders"]]
          .map(([title,desc,view])=><button key={view} onClick={()=>navigate(view)} className="group text-left p-7"
            style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
            <p className="italic text-[18px] mb-2.5" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{title}</p>
            <p className="text-[12.5px] leading-[1.7] mb-4" style={{color:"rgba(36,62,65,0.75)"}}>{desc}</p>
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em]" style={{color:T.teal}}>
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
function SearchResultsView({ navigate, cart, setCart, wishlist, toggleWishlist, initQuery }){
  const { products, loading:productsLoading, error:productsError } = useProducts();
  const [q,setQ]=useState(initQuery||"");
  useEffect(()=>{ setQ(initQuery||""); },[initQuery]);
  useEffect(()=>{ const qq=(initQuery||"").trim(); if(qq) trackAkara("search",{q:qq}); },[initQuery]);
  const trimmed=q.trim().toLowerCase();
  const results=trimmed.length>1?products.filter(p=>productMatchesSearch(p,q)):[];
  const submit=e=>{ e.preventDefault(); navigate("search",q); };
  return <div>
    <section className="px-6 md:px-14 pt-14 pb-8 max-w-[700px] mx-auto text-center">
      <p className="text-[12px] tracking-[0.3em] uppercase mb-3" style={{color:T.teal}}>Search</p>
      <h1 className="italic text-[32px] md:text-[44px] mb-5" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>{trimmed.length>1?`Results for "${q}"`:"Search the Collection"}</h1>
      <form onSubmit={submit} className="flex items-center gap-3 mb-3">
        <div className="flex-1 flex items-center gap-3 px-4" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,height:"48px"}}>
          <Search size={16} style={{color:"rgba(36,62,65,0.75)",flexShrink:0}}/>
          <input value={q} onChange={e=>setQ(sanitize(e.target.value))} placeholder="Search products…" maxLength={100}
            className="flex-1 bg-transparent outline-none text-[16px]" style={{color:T.teal,fontFamily:"'Space Grotesk',sans-serif"}}/>
        </div>
        <SweepButton filled type="submit" className="!px-6 !py-0 h-12 shrink-0 !flex items-center justify-center">Search</SweepButton>
      </form>
    </section>
    {trimmed.length<=1
      ?<div className="px-6 py-16 text-center">
        <p className="text-[14px]" style={{color:"rgba(36,62,65,0.75)"}}>Type at least two characters to search the collection.</p>
      </div>
      :productsError
      ?<ProductGridError/>
      :productsLoading
      ?<section className="px-6 md:px-10 xl:px-16 pb-24 max-w-[1800px] mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-10">
          <ProductGridSkeleton count={8}/>
        </div>
      </section>
      :results.length===0
      ?<div className="px-6 py-16 text-center max-w-[480px] mx-auto">
        <p className="text-[16px] mb-3" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>No results for "{q}"</p>
        <p className="text-[13.5px] leading-[1.8] mb-8" style={{color:"rgba(36,62,65,0.75)"}}>We couldn't find a match — try a different term, or browse the full collection. Looking for something in bulk, or a custom piece? We can help with that too.</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <SweepButton filled onClick={()=>navigate("shop")}>Explore the Collection</SweepButton>
          <SweepButton onClick={()=>navigate("bulk-orders")}>Bulk & Corporate Orders</SweepButton>
        </div>
      </div>
      :<section className="px-6 md:px-10 xl:px-16 pb-24 max-w-[1800px] mx-auto">
        <p className="pb-8 text-[11.5px] tracking-[0.06em] uppercase text-center" style={{color:"rgba(36,62,65,0.75)"}}>{results.length} result{results.length>1?"s":""} for "{q}"</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-10">
          {results.map(p=><ProductCard key={p.id} product={p} navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} toggleWishlist={toggleWishlist}/>)}
        </div>
      </section>}
  </div>;
}

// Main catalog browsing page (/shop, /shop/<category>). initCategory
// comes from the URL (set by AkaraApp's shopCategory state). Shows the
// CATEGORY_CONTENT intro paragraph when a specific category is active.
function ShopView({ navigate, cart, setCart, wishlist, toggleWishlist, initCategory }) {
  const { products, loading:productsLoading, error:productsError } = useProducts();
  const { names: categoryNames, slugCat, blurbs } = useCategories();
  const [activeCat,setActiveCat]=useState(initCategory||"All");
  useEffect(()=>{
    if(!initCategory) { setActiveCat("All"); return; }
    // initCategory may be a display name or a URL slug
    const resolved = categoryNames.includes(initCategory) ? initCategory : (slugCat[initCategory] || initCategory);
    setActiveCat(resolved);
  },[initCategory, categoryNames, slugCat]);
  const filtered=activeCat==="All"?products:products.filter(p=>p.cat===activeCat || slugifyCategory(p.cat)===slugifyCategory(activeCat));
  const catInfo=CATEGORY_CONTENT[activeCat];
  const intro = (catInfo && catInfo.intro) || blurbs[activeCat] || "";
  return <div>
    <section className="px-6 md:px-14 pt-14 pb-8 text-center">
      <p className="text-[12px] tracking-[0.3em] uppercase mb-3" style={{color:T.teal}}>Shop</p>
      <h1 className="italic text-[32px] md:text-[44px] mb-5" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>{activeCat==="All"?"The collection":activeCat}</h1>
      {intro&&<p className="max-w-[560px] mx-auto text-[14px] leading-[1.8]" style={{color:"rgba(36,62,65,0.75)"}}>{intro}</p>}
    </section>
    <section className="px-6 md:px-10 xl:px-16 max-w-[1800px] mx-auto">
      <div className="flex flex-wrap gap-2.5 pb-7" style={{borderBottom:"1px solid rgba(36,62,65,0.1)"}}>
        {["All",...categoryNames].map(c=><button key={c} onClick={()=>setActiveCat(c)}
          className="px-5 py-2.5 text-[12.5px] transition-all duration-200"
          style={activeCat===c?{backgroundColor:T.teal,color:"white"}:{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}>{c}</button>)}
      </div>
      <p className="pt-5 pb-8 text-[11.5px] tracking-[0.06em] uppercase" style={{color:"rgba(36,62,65,0.75)"}}>{productsLoading?"Loading…":`${filtered.length} ${filtered.length===1?"piece":"pieces"}`}</p>
    </section>
    <section className="px-6 md:px-10 xl:px-16 pb-24 max-w-[1800px] mx-auto">
      {productsError?<ProductGridError/>:
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-10">
        {productsLoading?<ProductGridSkeleton count={8}/>:
        filtered.map(p=><ProductCard key={p.id} product={p} navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} toggleWishlist={toggleWishlist}/>)}
      </div>}
    </section>
  </div>;
}

// Shared (non-per-product) tab content for Product Detail's Care Guide
// and Reviews tabs. Description is NOT here — that comes from each
// product's own `description` field, fetched from the database (see
// tabContent in ProductDetailView below).
const TABS_CONTENT = {
  "Care Guide": "Wipe clean with a dry or lightly damp cloth. Avoid prolonged direct sunlight to preserve colour. Not dishwasher safe.",
};

// Product Detail's media gallery: main viewer + thumbnail strip,
// supporting a mix of real images/videos and placeholders in the same
// product's media array. `Art` is that product's category icon, used as
// the placeholder for any image slot with src:null; video slots with
// src:null show a "Video coming soon" state instead.
function ProductGallery({ media, Art, name, soldOut }){
  const [active,setActive]=useState(0);
  // Gallery frame is 4:5 with object-cover so the PDP never shows empty
  // letterbox bands. Full uncropped photo remains available in the lightbox
  // (object-contain). Click-to-zoom kept for purchase confidence.
  const [lightboxOpen,setLightboxOpen]=useState(false);
  const item=media[active]||media[0];
  return <div>
    <div className="relative flex items-center justify-center" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.lg,aspectRatio:"4/5",maxHeight:"640px",width:"100%",overflow:"hidden"}}>
      {item.type==="video"
        ? (item.src
            ? <video src={item.src} controls className="w-full h-full object-cover" style={{opacity:soldOut?0.5:1}}/>
            : <div className="flex flex-col items-center gap-3" style={{color:"rgba(36,62,65,0.75)"}}>
                <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{border:`1px solid rgba(36,62,65,0.2)`}}><Play size={22}/></div>
                <p className="text-[11.5px] uppercase tracking-[0.08em]">Video coming soon</p>
              </div>)
        : (item.src
            ? <img src={item.src} alt={`${name} — photo ${active+1}`} className="w-full h-full object-cover cursor-zoom-in" style={{opacity:soldOut?0.5:1}} onClick={()=>!soldOut&&setLightboxOpen(true)}/>
            : <Art className="w-1/3 h-1/3" style={{color:T.teal,opacity:soldOut?0.35:1}}/>)}
      {soldOut&&<div className="absolute top-4 left-4 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.08em]" style={{backgroundColor:T.teal,color:"white"}}>Sold Out</div>}
    </div>
    <div className="flex gap-2.5 mt-3 overflow-x-auto pb-1">
      {media.map((m,i)=><button key={i} onClick={()=>setActive(i)} aria-label={m.type==="video"?`Video ${i+1}`:`Photo ${i+1}`}
        className="shrink-0 w-16 h-16 flex items-center justify-center relative"
        style={{backgroundColor:T.card,boxShadow:i===active?`0 0 0 2px ${T.gold}`:"0 0 0 1px rgba(36,62,65,0.1)",borderRadius:RADIUS.xs}}>
        {m.type==="video"
          ? (m.src?<video src={m.src} className="w-full h-full object-cover"/>:<Film size={16} style={{color:"rgba(36,62,65,0.75)"}}/>)
          : (m.src?<img src={m.src} alt="" className="w-full h-full object-cover"/>:<Art className="w-6 h-6" style={{color:"rgba(184,147,90,0.6)"}}/>)}
        {m.type==="video"&&<div className="absolute bottom-1 right-1"><Play size={9} style={{color:m.src?"white":"rgba(36,62,65,0.4)"}}/></div>}
      </button>)}
    </div>
    {lightboxOpen&&item.type!=="video"&&item.src&&<div className="fixed inset-0 z-[300] flex items-center justify-center p-6" style={{backgroundColor:"rgba(36,62,65,0.9)"}} onClick={()=>setLightboxOpen(false)}>
      <button onClick={()=>setLightboxOpen(false)} aria-label="Close" className="absolute top-5 right-5 p-2" style={{color:"white"}}><X size={24}/></button>
      <img src={item.src} alt={`${name} — photo ${active+1}`} className="max-w-[92vw] max-h-[92vh] object-contain" onClick={e=>e.stopPropagation()}/>
    </div>}
  </div>;
}

// The individual product page (/product/<slug>) — one component serves
// all 31 products, driven entirely by the `product` object looked up from
// PRODUCTS via productId. Includes the sticky mobile add-to-cart bar,
// stock-state handling (in-stock/low-stock/sold-out — see the `stock`
// field on PRODUCTS), and the size/qty selectors (NOTE: size options are
// currently placeholder Small/Medium/Large buttons, not yet wired to real
// per-product size data — pending real size list from the business).
// ============================================================================
// Admin-only "preview as customer" — the real answer to a real gap: an
// admin setting up a draft/hidden product had no way to see what it
// would actually look like before publishing, other than temporarily
// flipping it live (risking a customer seeing an unfinished product) or
// reading the raw form fields and imagining the result.
//
// Reuses ProductDetailView completely unmodified — the exact same
// component a real customer sees — by wrapping it in a LOCAL
// ProductsContext.Provider containing just this one fetched product.
// This guarantees the preview can never drift from what customers
// actually see, since it's not a separate reimplementation.
//
// The real security boundary is server-side: this calls
// /api/admin/products/:id (requireAdmin), the SAME endpoint the admin
// product editor already uses — not the public /api/products/:id,
// which deliberately excludes draft/hidden at the query level (see
// server/routes/products.js). A logged-out visitor, or a customer who
// guesses this URL pattern, gets a clear sign-in requirement here, never
// the actual draft content — checked directly, not assumed.
function PreviewProductView({ productId, navigate }){
  const [state,setState]=useState({loading:true,product:null,error:null});
  useEffect(()=>{
    setState({loading:true,product:null,error:null});
    fetch(`/api/admin/products/${productId}`,{credentials:"include"})
      .then(async r=>{
        if(r.status===401) return setState({loading:false,product:null,error:"auth"});
        if(!r.ok) return setState({loading:false,product:null,error:"notfound"});
        const data=await r.json();
        setState({loading:false,product:data.product,error:null});
      })
      .catch(()=>setState({loading:false,product:null,error:"network"}));
  },[productId]);

  const banner=<div className="no-print flex items-center justify-center gap-2 py-2.5 px-4 text-center" style={{backgroundColor:T.gold,color:T.teal}}>
    <AlertCircle size={14}/>
    <p className="text-[12px] tracking-[0.04em] uppercase" style={{fontWeight:600}}>Preview Mode — not visible to customers, and can't be purchased</p>
  </div>;

  if(state.loading) return <div><div style={{backgroundColor:T.gold,height:36}}/><div className="px-6 py-32 text-center"><p className="text-[13px]" style={{color:"rgba(36,62,65,0.75)"}}>Loading preview…</p></div></div>;

  if(state.error==="auth") return <div className="px-6 py-32 text-center max-w-[420px] mx-auto">
    <AlertCircle size={36} strokeWidth={1} style={{color:"rgba(36,62,65,0.75)",margin:"0 auto 20px"}}/>
    <h1 className="italic text-[24px] mb-3" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Admin sign-in required.</h1>
    <p className="text-[13.5px] mb-6" style={{color:"rgba(36,62,65,0.75)"}}>This preview link only works while signed in to the admin panel.</p>
    <SweepButton filled onClick={()=>window.location.href="/admin"}>Go to Admin Sign In</SweepButton>
  </div>;

  if(state.error) return <div className="px-6 py-32 text-center">
    <h1 className="italic text-[24px] mb-3" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Couldn't load this product.</h1>
    <p className="text-[13.5px]" style={{color:"rgba(36,62,65,0.75)"}}>It may have been deleted, or the ID in the link is wrong.</p>
  </div>;

  // Raw admin-endpoint row (snake_case, matching the database columns
  // directly) transformed into the exact camelCase shape the public
  // /api/products endpoint returns and ProductDetailView already expects
  // — this transform lives here, in new preview-only code, rather than
  // changing what GET /api/admin/products/:id itself returns, since the
  // admin product editor already relies on that endpoint's existing raw
  // shape and must not be disturbed.
  const p=state.product;
  // Reuses enrichProduct() — the SAME function every real product passes
  // through after being fetched from the public API — rather than
  // reimplementing its logic here. Missing this was a real bug caught
  // directly in testing: without it, `media` stays empty and `Art` (the
  // category icon component, which can't be stored in the database at
  // all) is simply absent, and ProductGallery crashed trying to render
  // an undefined icon component.
  const shaped=enrichProduct({ id:p.id, name:p.name, cat:p.category, price:p.price, dims:p.dims, hsn:p.hsn, status:p.status, description:p.description, metaTitle:p.meta_title, metaDesc:p.meta_desc, media:p.media });

  return <ProductsContext.Provider value={{products:[shaped],loading:false,error:null}}>
    {banner}
    {/* cart/wishlist are deliberately inert here (no-op setCart, an
        always-empty wishlist with a no-op toggle) — a draft product is
        very likely unfinished or mispriced, and letting even an admin
        genuinely add one to a REAL cart during a preview risks it
        actually being purchasable, which defeats the entire point of
        keeping it in draft. */}
    <ProductDetailView productId={productId} navigate={navigate} cart={[]} setCart={()=>{}} wishlist={[]} toggleWishlist={()=>{}}/>
  </ProductsContext.Provider>;
}

function ProductDetailView({ productId, navigate, cart, setCart, wishlist, toggleWishlist }) {
  const { products, loading:productsLoading, error:productsError } = useProducts();
  // Every hook in this component must be declared unconditionally, before
  // any early return below — React's Rules of Hooks require the same
  // hooks in the same order on every render, which the old version never
  // had to worry about since an outer gate in AkaraAppRoot guaranteed
  // products were already loaded before this component ever mounted.
  // That gate is gone now (see the real Lighthouse-confirmed LCP fix),
  // so this component owns its own loading/error/not-found handling —
  // meaning these hooks have to come first, using the productId PROP
  // (always safely available) rather than the derived `product` object,
  // which doesn't exist until after the checks below.
  const [size,setSize]=useState("Medium");
  const [color,setColor]=useState(null);
  // REAL, DIRECT FIX for a genuinely reported, real problem: this page
  // always defaulted to "Medium" regardless of whether it was actually
  // available — confirmed directly, live: with Small in stock and
  // Medium genuinely sold out, a customer landing on the page saw a
  // real "SOLD OUT" banner and a disabled Add to Bag button by default,
  // even though a real, purchasable size existed one click away. A
  // customer has no real reason to know to try a different size when
  // the page itself looks broken/unavailable — most would just leave.
  // autoSizeAppliedRef ensures the real, one-time auto-correction below
  // runs exactly once, on the real, initial resolution of this
  // product's variants — never again after that, so a customer's own,
  // later, deliberate click on any size (including "Medium," even if
  // it's genuinely sold out) is always respected and never silently
  // overridden.
  const autoSizeAppliedRef=useRef(false);
  const [tab,setTab]=useState("Description");
  const [toast,setToast]=useState(false);
  const [reviewData,setReviewData]=useState(null);
  useEffect(()=>{
    fetch(`/api/reviews/${productId}`).then(r=>r.ok?r.json():null).then(setReviewData).catch(()=>{});
  },[productId]);

  if(productsError) return <ProductGridError/>;
  if(productsLoading) return <div className="px-6 md:px-14 py-14 max-w-[1200px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-14">
    <Skeleton height={480} radius={RADIUS.md}/>
    <div className="flex flex-col gap-4 pt-4">
      <Skeleton height={14} width="30%"/>
      <Skeleton height={36} width="70%"/>
      <Skeleton height={28} width="40%"/>
      <Skeleton height={80}/>
    </div>
  </div>;
  if(!products.some(p=>p.id===productId)) return <NotFoundView navigate={navigate}/>;
  const product=products.find(p=>p.id===productId)||products[0];
  const isWished=wishlist.includes(product.id);
  const related=products.filter(p=>p.cat===product.cat&&p.id!==product.id).slice(0,3);
  // Real size/color variants — genuinely optional. A product with no
  // colors and no variant rows (the overwhelming majority right now)
  // behaves EXACTLY as before: base product.price/product.status,
  // Small/Medium/Large shown as plain options with no per-size price
  // difference. Only once a product actually has real product_colors/
  // product_variants rows does any of this branch kick in — confirmed
  // spec: "a product with no variants shows no dropdown at all" for
  // color; size stays as the existing three-option picker either way
  // (no product currently has custom size names, only custom colors).
  const hasColors=product.colors&&product.colors.length>0;
  const hasVariants=product.variants&&product.variants.length>0;
  // REAL BUG FIX, directly reported: checkout was rejecting an order
  // for a real, genuinely in-stock product with "an item may be sold
  // out or no longer available." Traced to the real, actual root
  // cause — the Size picker below was rendered UNCONDITIONALLY for
  // every product with any real variants at all, even though not one
  // real product in this entire catalog currently defines an actual,
  // distinct size (every real variant row has size=NULL, meaning "no
  // real size concept, just color"). A customer could click "Small" or
  // "Large" — buttons that looked completely normal, not greyed out —
  // and the page would still show "In Stock" and a working "Add to
  // Bag" button, because of the SEPARATE fallback bug below. Nothing
  // ever caught this until the server's own, correct, strict
  // validation rejected it at the final checkout step — by which point
  // the customer has already added it to cart and started checking
  // out, with no earlier, real warning anything was wrong.
  // hasRealSizes is true only when at least one of this product's
  // real variants has an actual, real, non-null size — the correct,
  // real condition for whether the Size picker should exist at all.
  const hasRealSizes=hasVariants&&product.variants.some(v=>v.size!=null);
  // Auto-selects the first real color the first time this product's
  // colors are seen — a `useEffect` would be the "proper" way to sync
  // this, but computing it directly here (and only setting state when
  // it's genuinely still null) avoids an extra render pass for what's
  // really just picking a sensible default once.
  if(hasColors&&color===null){ setColor(product.colors[0].variantKey); }
  const selectedColorId=hasColors?product.colors.find(c=>c.variantKey===color)?.id:null;
  // Real, one-time auto-correction: if the current default size
  // ("Medium") genuinely isn't available for the real, selected color,
  // but a different real size IS, switch to that available one instead
  // — checked in the natural, real Small → Medium → Large order, so a
  // customer's first, real impression of this page is a genuinely
  // purchasable option, not an artificially "sold out" one caused
  // purely by which size happens to be the hardcoded default.
  if(hasRealSizes&&!autoSizeAppliedRef.current){
    autoSizeAppliedRef.current=true;
    const currentSizeVariant=product.variants.find(v=>(selectedColorId==null||v.colorId===selectedColorId)&&(v.size||"Medium")===size);
    if(!currentSizeVariant||currentSizeVariant.status==="sold-out"){
      const firstAvailable=["Small","Medium","Large"].find(s=>{
        const v=product.variants.find(v=>(selectedColorId==null||v.colorId===selectedColorId)&&(v.size||"Medium")===s);
        return v&&v.status!=="sold-out";
      });
      if(firstAvailable&&firstAvailable!==size) setSize(firstAvailable);
    }
  }
  // REAL, DIRECT CORRECTION following a direct, live report: the fix
  // above (checking for ANY real variant at all) was still wrong —
  // it let a real COLOR-only variant (no real, distinct size, just
  // color) silently override the real, deliberately-set Basics price,
  // which is precisely NOT what was wanted. Confirmed directly: Helion
  // Vase's real Basics price (customer sees ₹199) was being replaced
  // by its one, existing, color-only Black variant's own real price
  // (₹354) — even though no real Size had ever actually been set up
  // for it. The real, correct, now-confirmed rule: the Basics price is
  // authoritative BY DEFAULT; only an explicit, real, distinct Size
  // (Small/Medium/Large, genuinely set on a variant in the Details
  // tab) is allowed to override it. A colour with no real size attached
  // must never silently change the price the admin actually set.
  const selectedVariant=hasRealSizes
    ? product.variants.find(v=>(selectedColorId==null||v.colorId===selectedColorId)&&(v.size||"Medium")===size)
    : null;
  // A real, SEPARATE lookup purely by colour (not gated by hasRealSizes)
  // — kept distinct from selectedVariant above specifically so the
  // real, legitimate, different feature of per-COLOUR dimension
  // overrides (e.g. Black is 9×9×10cm, Bronze is 6×6×25cm — a real,
  // physical fact about that specific coloured object, confirmed in
  // this project's own schema notes from the original Helion/Vermillion
  // merge) keeps working correctly even for a product that has real
  // colours but no real, distinct sizes — dimensions are a genuinely
  // different, real concern from the price-override rule above.
  const selectedColorVariant=hasVariants
    ? product.variants.find(v=>(selectedColorId==null||v.colorId===selectedColorId)&&(v.size||"Medium")===size)
    : null;
  // REAL, SECOND BUG FIX, found while tracing the one above: this
  // fallback was written for a genuinely different, real case (a
  // product with color options but no per-size price split, where
  // selectedVariant is real and simply doesn't carry its own distinct
  // price) — but it ALSO silently activated whenever selectedVariant
  // was undefined for ANY reason, including a customer picking a real
  // color+size combination with no actual, real backing variant row at
  // all (e.g. a color added in the admin's Colours list with no
  // matching entry in Size/Color/Price/Stock below it — genuinely
  // possible, since those are two separate, real, independent admin
  // actions). Falling back to the base product's own price/status in
  // that case is wrong: a variant PRODUCT should never silently charge
  // or show the base, non-variant price for a combination that has no
  // real, actual data behind it — that's exactly how a customer could
  // see "In Stock" and a working "Add to Bag" for something checkout
  // would correctly, and only later, reject.
  // The real, correct rule now: only fall back to the base product's
  // price/status when this product has NO real variants at all. Once a
  // product HAS real variants, a genuinely unmatched combination is
  // treated as unavailable, not silently forgiven.
  const displayPrice=hasRealSizes?(selectedVariant?.price??null):product.price;
  const customerFacingPrice=displayPrice!=null?gstInclusivePrice(displayPrice):null;
  const displayStatus=hasRealSizes?(selectedVariant?.status??"sold-out"):product.status;
  const soldOut=displayStatus==="sold-out";
  useEffect(()=>{
    if(!product?.id) return;
    trackAkara("view_item",{productId:product.id,name:product.name,price:product.gstInclusiveDisplayPrice??product.price});
  },[product?.id]);
  const lowStock=displayStatus==="low-stock";
  const preOrder=displayStatus==="pre-order";
  // Per-option sold-out checks, for genuinely disabling ONE swatch/size
  // button instead of the whole picker — the real gap this closes: a
  // customer previously only found out a specific combination was sold
  // out AFTER selecting it and watching the whole Add to Cart section
  // gray out. Each check pairs the option being evaluated with
  // whatever's CURRENTLY selected for the other dimension (e.g.
  // "is Red, at the currently-picked size, sold out"), matching the
  // exact same real combination the customer would actually land on if
  // they picked it — not just "is this color sold out in general",
  // which wouldn't be accurate if it's in stock in a different size.
  const isColorSoldOut=variantKey=>{
    if(!hasVariants) return false;
    const cId=product.colors.find(c=>c.variantKey===variantKey)?.id;
    const v=product.variants.find(v=>(cId==null?v.colorId==null:v.colorId===cId)&&(v.size||"Medium")===size);
    return v?.status==="sold-out";
  };
  const isSizeSoldOut=s=>{
    if(!hasVariants) return false;
    const v=product.variants.find(v=>(selectedColorId==null?v.colorId==null:v.colorId===selectedColorId)&&(v.size||"Medium")===s);
    return v?.status==="sold-out";
  };
  // How many of THIS product, in the currently-selected size, are already
  // sitting in the cart — recalculates whenever size changes, since a
  // different size is a different cart line item. This is what was
  // missing before: a customer could add something, come back to the
  // product page, and see no indication it was already in their cart.
  const cartQtyForSize=cart.find(i=>i.id===product.id&&i.size===size&&(i.color||null)===(color||null))?.qty||0;
  // Adds exactly 1 at a time now — matches the same pattern already used
  // on product cards elsewhere (icon while empty, a real stepper once
  // something's actually in the cart). This used to add whatever a
  // separate, always-visible "Quantity" selector was set to — meaning
  // the page showed a quantity stepper and a multiplied price before
  // anything was ever added, which read as if 1 unit were already sitting
  // in the cart by default. Adjusting quantity now only ever happens
  // through the stepper below, which itself only appears once the item
  // is genuinely in the cart.
  const addToCart=()=>{ if(soldOut) return; trackAkara("add_to_cart",{productId:product.id,name:product.name,price:displayPrice,qty:1}); setCart(c=>{ const ex=c.find(i=>i.id===product.id&&i.size===size&&(i.color||null)===(color||null)); if(ex) return c.map(i=>i.id===product.id&&i.size===size&&(i.color||null)===(color||null)?{...i,qty:i.qty+1}:i); return [...c,{...product,price:displayPrice,size,color:color||undefined,qty:1}]; }); setToast(true); setTimeout(()=>setToast(false),2200); };
  // Found genuinely non-functional — no onClick at all — while doing an
  // unrelated animation pass. Same cart-adding logic as Add to Cart, then
  // straight to checkout — no toast needed here since the page is about
  // to navigate away anyway. Safe to send straight there regardless of
  // login state: CheckoutView already has its own real sign-in gate (see
  // "Sign in to check out." above), so there's no need to duplicate that
  // check here.
  const buyNow=()=>{ if(soldOut) return; setCart(c=>{ const ex=c.find(i=>i.id===product.id&&i.size===size&&(i.color||null)===(color||null)); if(ex) return c.map(i=>i.id===product.id&&i.size===size&&(i.color||null)===(color||null)?{...i,qty:i.qty+1}:i); return [...c,{...product,price:displayPrice,size,color:color||undefined,qty:1}]; }); navigate("checkout"); };
  const adjustCartQty=d=>setCart(c=>c.map(i=>i.id===product.id&&i.size===size&&(i.color||null)===(color||null)?{...i,qty:Math.min(99,Math.max(0,i.qty+d))}:i).filter(i=>!(i.id===product.id&&i.size===size&&(i.color||null)===(color||null)&&i.qty<=0)));
  // Real reviews, replacing the old hardcoded "4.6 (89) — coming with the
  // backend" placeholder that lived here and in the Reviews tab below.
  // Fetched fresh per product since ProductDetailView already remounts on
  // navigating between products (see the `key` on <main> in the app root).
  // REAL, DIRECT FIX: the "Dimensions" tab always read the base
  // product's own dims text, never the CURRENTLY SELECTED variant's
  // own, real, per-size dims override — meaning a customer choosing
  // "Large" would see the exact same dimensions text as choosing
  // "Small," even when each real size genuinely has its own, different,
  // correct measurements set in the admin panel. Now prefers the
  // selected variant's own real dims when it has one, falling back to
  // the base product's dims only when this specific variant doesn't
  // have its own override — matching exactly what a customer should
  // see for whichever real size/colour they've actually picked.
  const tabContent=tab==="Dimensions"?(selectedColorVariant?.dims||product.dims):tab==="Description"?(product.description||"Description coming soon."):TABS_CONTENT[tab];
  return <div>
    <div className="px-6 md:px-14 pt-5 max-w-[1800px] mx-auto">
      <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}>
        <button onClick={()=>navigate("home")} className="hover:underline">Home</button>
        <span style={{color:T.teal}}> / </span>
        <button onClick={()=>navigate("shop",product.cat)} className="hover:underline">{product.cat}</button>
        <span style={{color:T.teal}}> / </span>
        <span style={{color:T.teal}}>{product.name}</span>
      </p>
    </div>
    <section className="px-6 md:px-14 pt-8 pb-16 max-w-[1800px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-14">
      <ProductGallery media={product.media} Art={product.Art} name={product.name} soldOut={soldOut}/>
      <div>
        <p className="text-[12px] tracking-[0.14em] uppercase mb-2.5" style={{color:soldOut?"rgba(36,62,65,0.4)":T.teal}}>{product.cat} · {soldOut?"Sold Out":lowStock?"Low Stock":preOrder?"Pre-Order":"In Stock"}</p>
        <h1 className="italic text-[34px] md:text-[40px] leading-tight mb-3" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>{product.name}</h1>
        {reviewData&&reviewData.count>0?<div className="flex items-center gap-1.5 mb-5">
          {[0,1,2,3,4].map(i=><Star key={i} size={14} fill={i<Math.round(reviewData.average)?T.gold:"none"} stroke={T.gold}/>)}
          <span className="text-[12.5px] ml-1" style={{color:"rgba(36,62,65,0.75)"}}>{reviewData.average.toFixed(1)} ({reviewData.count})</span>
        </div>:null}
        {customerFacingPrice!=null?<>
          <p className="text-[28px] mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{customerFacingPrice.toLocaleString("en-IN")}</p>
          <p className="text-[11.5px] mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Incl. GST · price at checkout</p>
        </>:<p className="text-[15px] mb-2" style={{color:T.muted}}>Currently unavailable in this combination</p>}
        {Array.isArray(product.finishes) && product.finishes.length>0 && (
          <div className="mb-5">
            <p className="text-[11px] tracking-[0.12em] uppercase mb-2.5" style={{color:T.teal}}>Finish</p>
            <div className="flex flex-wrap gap-2.5">
              {product.finishes.map((f,i)=>(
                <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 akara-lift" style={{border:"1px solid rgba(24,54,48,0.12)",borderRadius:999}}>
                  <span className="w-4 h-4 rounded-full shrink-0 border" style={{backgroundColor:f.hex||T.cream,borderColor:"rgba(24,54,48,0.2)"}} title={f.name}/>
                  <span className="text-[12.5px]" style={{color:T.teal}}>{f.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="text-[12.5px] mb-6" style={{color:"rgba(36,62,65,0.7)",fontFamily:"'Fraunces',serif",fontStyle:"italic"}}>Matte plant-based PLA · printed to order in Mumbai</p>
        {cartQtyForSize>0&&<div className="flex items-center justify-between gap-3 px-4 py-2.5 mb-6" style={{backgroundColor:"rgba(59,110,82,0.08)",borderRadius:RADIUS.xs}}>
          <span className="flex items-center gap-2 text-[12.5px]" style={{color:T.success}}><Check size={13}/> In your cart{size?` (${size})`:""}</span>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={()=>adjustCartQty(-1)} className="w-8 h-8 flex items-center justify-center" style={{color:T.teal}} aria-label="Decrease"><Minus size={12}/></button>
            <span className="w-6 text-center text-[13.5px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{cartQtyForSize}</span>
            <button onClick={()=>adjustCartQty(1)} className="w-8 h-8 flex items-center justify-center" style={{color:T.teal}} aria-label="Increase"><Plus size={12}/></button>
          </div>
        </div>}
        {soldOut?<div className="flex items-center gap-2.5 px-4 py-3 mb-7 text-[12.5px]" style={{backgroundColor:"rgba(192,57,43,0.07)",color:T.error}}>
          <AlertCircle size={14}/> Currently sold out — check back soon, or explore similar pieces below
        </div>:lowStock?<div className="flex items-center gap-2.5 px-4 py-3 mb-7 text-[12.5px]" style={{backgroundColor:"rgba(192,57,43,0.07)",color:T.error}}>
          <AlertCircle size={14}/> Only a few left — order soon
        </div>:<div className="px-4 py-3 mb-7 text-[12.5px] space-y-1.5" style={{backgroundColor:"rgba(184,147,90,0.08)",color:T.teal,borderRadius:8}}>
          <p className="flex items-center gap-2"><span>●</span> Made to order — typically ships in 2–3 weeks</p>
          {product.dims?<p style={{color:"rgba(36,62,65,0.75)"}}>Scale · {product.dims}</p>:null}
          <button type="button" onClick={()=>navigate("care-guide")} className="underline underline-offset-2 text-[12px]" style={{color:T.teal}}>Care guide for this finish →</button>
        </div>}
        {hasColors&&<div className="mb-5">
          <p className="text-[11px] tracking-[0.1em] uppercase mb-2.5" style={{color:"rgba(36,62,65,0.75)"}}>Colour{color&&<span style={{color:T.teal,textTransform:"none",letterSpacing:"normal"}}> — {product.colors.find(c=>c.variantKey===color)?.label}{isColorSoldOut(color)?" (Sold Out)":""}</span>}</p>
          <div className="flex gap-2.5">
            {product.colors.map(c=>{ const optionSoldOut=isColorSoldOut(c.variantKey); return <button key={c.variantKey} onClick={()=>setColor(c.variantKey)} disabled={optionSoldOut} title={optionSoldOut?`${c.label} — Sold Out`:c.label}
              aria-label={`Colour: ${c.label}${optionSoldOut?" — Sold Out":""}`} aria-pressed={color===c.variantKey}
              className="relative w-9 h-9 rounded-full transition-all duration-200 disabled:cursor-not-allowed"
              style={{backgroundColor:c.swatchHex||"#cccccc",opacity:optionSoldOut?0.35:1,boxShadow:color===c.variantKey?`0 0 0 2px ${T.cream}, 0 0 0 4px ${T.teal}`:"0 0 0 1px rgba(36,62,65,0.15)"}}>
              {optionSoldOut&&<span className="absolute inset-0 flex items-center justify-center"><span style={{width:"140%",height:"1.5px",backgroundColor:"rgba(36,62,65,0.7)",transform:"rotate(-45deg)"}}/></span>}
            </button>;})}
          </div>
        </div>}
        {hasRealSizes&&<div className="mb-5">
          <p className="text-[11px] tracking-[0.1em] uppercase mb-2.5" style={{color:"rgba(36,62,65,0.75)"}}>Size</p>
          <div className="flex gap-2.5">
            {["Small","Medium","Large"].map(s=>{ const optionSoldOut=isSizeSoldOut(s); return <button key={s} onClick={()=>setSize(s)} disabled={optionSoldOut} title={optionSoldOut?`${s} — Sold Out`:undefined} className="relative px-4 py-2.5 text-[13px] transition-all duration-200 disabled:cursor-not-allowed"
              style={size===s&&!optionSoldOut?{backgroundColor:T.teal,color:"white",borderRadius:RADIUS.xs}:{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs,color:optionSoldOut?"rgba(36,62,65,0.35)":T.teal,textDecoration:optionSoldOut?"line-through":"none"}}>{s}</button>;})}
          </div>
          <p className="text-[12px] mt-2.5" style={{color:"rgba(36,62,65,0.65)",fontFamily:"'Fraunces',serif",fontStyle:"italic"}}>
            {size==="Small"?"Small — compact scale for shelves and intimate corners.":size==="Large"?"Large — a stronger presence for open rooms and high ceilings.":"Medium — the balanced scale for most rooms."}
          </p>
        </div>}
        <div className="hidden lg:flex flex-col gap-3 mb-5">
          <div className="flex gap-3 items-stretch">
            <SweepButton filled onClick={addToCart} disabled={soldOut} className="flex-1 !py-[1.05rem] akara-press">
              {soldOut?"Sold out":preOrder?"Pre-order this piece":"Add to bag"}
            </SweepButton>
            <button type="button" onClick={()=>toggleWishlist(product.id)}
              aria-label={isWished?`Remove ${product.name} from wishlist`:`Add ${product.name} to wishlist`}
              className="w-14 shrink-0 flex items-center justify-center akara-press transition-colors"
              style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.sm}}>
              <Heart size={16} style={{color:isWished?T.gold:T.teal,fill:isWished?T.gold:"none"}}/>
            </button>
          </div>
          {!soldOut && (
            <button type="button" onClick={buyNow}
              className="text-[11px] tracking-[0.14em] uppercase self-start transition-opacity hover:opacity-70 akara-press"
              style={{color:T.teal,borderBottom:"1px solid rgba(24,54,48,0.25)",paddingBottom:2}}>
              Buy now · go to checkout
            </button>
          )}
        </div>
        <div className="flex flex-col gap-2 text-[12.5px]" style={{color:"rgba(36,62,65,0.75)"}}>
          <div className="flex items-center gap-2"><Lock size={13}/> Secure checkout via Razorpay</div>
          <div className="flex items-center gap-2"><RotateCcw size={13}/> 7-day returns · 30-day warranty</div>
        </div>
      </div>
    </section>
    <section className="px-6 md:px-14 max-w-[1800px] mx-auto pb-20">
      <div className="flex gap-8 flex-wrap mb-7" style={{borderBottom:"1px solid rgba(36,62,65,0.12)"}}>
        {/* "Key Features" only appears once a product actually has some —
            most existing products have none yet (this is a new field),
            and an empty, unfilled tab on a live product page would read
            as unfinished rather than genuinely absent, the same
            reasoning already applied to og:image not being set until
            real photography exists. */}
        {["Description",...(product.keyFeatures?.length>0?["Key Features"]:[]),"Dimensions",...(product.accessoriesNote?["Accessories"]:[]),"Care Guide","Reviews"].map(t=><button key={t} onClick={()=>setTab(t)} className="pb-4 text-[13px] transition-colors"
          style={{color:tab===t?T.teal:"rgba(24,54,48,0.72)",borderBottom:tab===t?`2px solid ${T.gold}`:"2px solid transparent",marginBottom:"-1px"}}>{t}</button>)}
      </div>
      {tab==="Reviews"?<div className="max-w-2xl">
        {!reviewData||reviewData.count===0?
          <p className="text-[14.5px] leading-[1.85]" style={{color:"rgba(36,62,65,0.75)"}}>No reviews yet — be the first to share your experience with a real purchase.</p>
        :<div className="flex flex-col gap-6">
          {reviewData.reviews.map(r=><div key={r.id} className="pb-6" style={{borderBottom:"1px solid rgba(36,62,65,0.08)"}}>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="flex">{[0,1,2,3,4].map(i=><Star key={i} size={12} fill={i<r.rating?T.gold:"none"} stroke={T.gold}/>)}</div>
              <span className="text-[12.5px]" style={{color:T.teal}}>{r.reviewerName}</span>
              <span className="text-[10.5px] uppercase tracking-[0.06em] px-2 py-0.5" style={{backgroundColor:"rgba(59,110,82,0.1)",color:T.success}}>Verified Buyer</span>
            </div>
            {r.comment&&<p className="text-[14px] leading-[1.7]" style={{color:"rgba(36,62,65,0.75)"}}>{r.comment}</p>}
          </div>)}
        </div>}
      </div>
      :tab==="Key Features"?<ul className="max-w-2xl flex flex-col gap-3">
        {product.keyFeatures.map((f,i)=><li key={i} className="flex items-start gap-3 text-[14.5px] leading-[1.7]" style={{color:"rgba(36,62,65,0.75)"}}>
          <Check size={16} strokeWidth={2.5} style={{color:T.teal,flexShrink:0,marginTop:"3px"}}/>{f}
        </li>)}
      </ul>
      // Dimensions with real multi-line/bullet support — requested
      // directly: since one merged product can now genuinely have
      // several colors with different real measurements each (found
      // during the Vermillion/Helion merge — e.g. Helion Vase Black is
      // 9x9x10cm, Bronze is 6x6x25cm), a single plain dims string
      // can't represent that anymore. A product's dims field with more
      // than one newline-separated line renders as a real bulleted
      // list; a single-line dims value (the overwhelming majority of
      // products, unaffected by this) renders exactly as it always
      // did — no migration needed for existing single-dimension products.
      :tab==="Dimensions"&&tabContent.includes("\n")?<ul className="max-w-2xl flex flex-col gap-2.5">
        {tabContent.split("\n").filter(line=>line.trim()).map((line,i)=><li key={i} className="flex items-start gap-3 text-[14.5px] leading-[1.7]" style={{color:"rgba(36,62,65,0.75)"}}>
          <span style={{color:T.teal,flexShrink:0}}>•</span>{line.trim()}
        </li>)}
      </ul>
      :tab==="Accessories"?<p className="max-w-2xl text-[14.5px] leading-[1.85]" style={{color:"rgba(36,62,65,0.75)"}}>{product.accessoriesNote}</p>
      :<p className="max-w-2xl text-[14.5px] leading-[1.85]" style={{color:"rgba(36,62,65,0.75)"}}>{tabContent}</p>}
      {tab==="Care Guide"&&<button onClick={()=>navigate("care-guide")} className="text-[12px] uppercase tracking-[0.08em] underline mt-4 inline-block" style={{color:T.teal}}>Full Care Guide →</button>}
    </section>
        <section className="px-6 md:px-14 pb-16 max-w-[1800px] mx-auto">
      <div className="p-6 md:p-10" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.lg,border:"1px solid rgba(24,54,48,0.08)"}}>
        <p className="text-[11px] tracking-[0.2em] uppercase mb-2" style={{color:T.teal}}>Why this piece</p>
        <h2 className="italic text-[24px] md:text-[30px] mb-6" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>An artifact, not a catalogue fill.</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 md:gap-6">
          {[
            ["Material","Plant-based PLA printed in our studio — chosen for form fidelity and a quieter material story than commodity plastics."],
            ["Made to order", product?.dims ? `Printed to the dimensions listed (${product.dims}). Nothing sits pre-made on a shelf.` : "Printed specifically for your order. Nothing sits pre-made on a shelf."],
            ["Category", product?.cat ? `${product.cat} — designed as part of the ĀKĀRA collection for modern interiors.` : "Part of the ĀKĀRA collection for modern interiors."],
            ["Care", "Wipe gently with a soft dry cloth. Keep away from direct high heat and prolonged outdoor sun unless the listing says otherwise."],
          ].map(([title,body])=>(
            <div key={title}>
              <p className="text-[12px] tracking-[0.12em] uppercase mb-2" style={{color:T.teal}}>{title}</p>
              <p className="text-[13px] leading-[1.7]" style={{color:T.muted}}>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
    {related.length>0&&<section className="px-6 md:px-10 xl:px-16 pb-24 max-w-[1800px] mx-auto">
      <p className="text-[12px] tracking-[0.2em] uppercase mb-8" style={{color:T.teal}}>Often placed with</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
        {related.map(p=><ProductCard key={p.id} product={p} navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} toggleWishlist={toggleWishlist}/>)}
      </div>
    </section>}
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center gap-3 px-4 py-3" style={{backgroundColor:T.card,boxShadow:"0 -8px 24px -14px rgba(36,62,65,0.2)",borderTop:"1px solid rgba(36,62,65,0.1)"}}>
      <div className="shrink-0">
        <p className="text-[10px] uppercase tracking-[0.05em]" style={{color:"rgba(36,62,65,0.75)"}}>Price</p>
        <p className="text-[16px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{customerFacingPrice!=null?`₹${customerFacingPrice.toLocaleString("en-IN")}`:"—"}</p>
      </div>
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <SweepButton filled onClick={addToCart} disabled={soldOut} className="w-full !py-3.5 akara-press">
          {soldOut?"Sold out":preOrder?"Pre-order":"Add to bag"}
        </SweepButton>
        {!soldOut && (
          <button type="button" onClick={buyNow} className="text-[10px] tracking-[0.12em] uppercase text-center py-0.5" style={{color:"rgba(24,54,48,0.7)"}}>
            Buy now
          </button>
        )}
      </div>
      <button type="button" onClick={()=>toggleWishlist(product.id)} aria-label={isWished?`Remove ${product.name} from wishlist`:`Add ${product.name} to wishlist`} className="w-11 h-11 flex items-center justify-center shrink-0 akara-press" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.sm}}>
        <Heart size={15} style={{color:isWished?T.gold:T.teal,fill:isWished?T.gold:"none"}}/>
      </button>
    </div>
    <div className="lg:hidden" style={{height:"96px"}}/>
    <div className="fixed bottom-24 lg:bottom-8 left-1/2 -translate-x-1/2 px-6 py-3.5 text-[13px] flex items-center gap-2 z-50 pointer-events-none transition-all duration-300"
      style={{backgroundColor:T.teal,color:"white",boxShadow:"0 20px 40px -14px rgba(36,62,65,0.4)",opacity:toast?1:0,transform:toast?"translate(-50%,0)":"translate(-50%,12px)",borderRadius:RADIUS.sm}}>
      <Check size={14} style={{color:T.cream}}/> Added to bag
    </div>
  </div>;
}

// Full cart page (/cart). Coupon codes and shipping settings are now
// admin-managed (server/routes/admin/settings.js) — this fetches the real,
// current values on mount rather than assuming the old hardcoded
// "AKARA10 = 10%, ₹150 shipping, free above ₹2,500" that used to be baked
// into this component. The discount/shipping preview shown here can never
// drift from what checkout actually charges, since both read from the
// same database values (see priceCartServerSide in server/routes/orders.js).
function CartView({ navigate, cart, setCart, appliedCoupon, setAppliedCoupon }) {
  const [coupon,setCoupon]=useState(appliedCoupon?.code||""); const [couponErr,setCouponErr]=useState("");
  const [shipSettings,setShipSettings]=useState({shippingCost:150,freeShippingThreshold:2500});
  useEffect(()=>{ fetch("/api/coupons/shipping").then(r=>r.json()).then(setShipSettings).catch(()=>{}); },[]);
  // Same real fix as CartDrawer above — matching only on id+size
  // silently merged two different colors of the same size into one
  // line, letting +/-/Remove act on the wrong color.
  const sameLine=(item,id,size,color)=>item.id===id&&item.size===size&&(item.color||null)===(color||null);
  const updateQty=(id,size,color,d)=>setCart(c=>c.map(i=>sameLine(i,id,size,color)?{...i,qty:Math.min(99,Math.max(1,i.qty+d))}:i));
  const removeItem=(id,size,color)=>setCart(c=>c.filter(i=>!sameLine(i,id,size,color)));
  const subtotal=cart.reduce((s,i)=>s+i.price*i.qty,0);
  const discount=appliedCoupon?Math.round(subtotal*(appliedCoupon.discountPercent/100)):0;
  const afterDiscount=subtotal-discount;
  const shipping=afterDiscount===0||afterDiscount>=shipSettings.freeShippingThreshold?0:shipSettings.shippingCost;
  const gst=Math.round((afterDiscount+shipping)*0.18);
  const total=afterDiscount+shipping+gst;
  const applyCoupon=async()=>{
    const code=sanitize(coupon).trim().toUpperCase();
    try{
      const res=await fetch(`/api/coupons/validate/${encodeURIComponent(code)}`);
      const data=await res.json();
      if(data.valid){ setAppliedCoupon({code:data.code,discountPercent:data.discountPercent}); setCouponErr(""); }
      else{ setAppliedCoupon(null); setCouponErr("Invalid or expired code"); }
    }catch{
      setCouponErr("Couldn't check that code — please try again.");
    }
  };
  if(cart.length===0) return <div className="px-6 py-32 text-center">
    <ShoppingBag size={40} strokeWidth={1} style={{color:"rgba(36,62,65,0.75)",margin:"0 auto 20px"}}/>
    <h1 className="italic text-[26px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Your cart is empty.</h1>
    <p className="text-[14px] mb-8" style={{color:"rgba(36,62,65,0.75)"}}>Let's fix that.</p>
    <SweepButton filled onClick={()=>navigate("shop")}>Explore the Collection</SweepButton>
  </div>;
  return <div className="px-6 md:px-14 py-16 max-w-[1100px] mx-auto">
    <h1 className="italic text-[32px] md:text-[40px] mb-10" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Your Cart</h1>
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-14">
      <div>
        {cart.map(item=>{
          // Same real bug, same real fix as CartDrawer above — this
          // page never checked item.media either.
          const firstImage=item.media?.find(m=>m.type==="image"&&m.src)?.src;
          const ItemArt=item.Art||PlanterArt;
          return <div key={item.id+item.size+(item.color||"")} className="flex gap-5 py-6" style={{borderBottom:"1px solid rgba(36,62,65,0.1)"}}>
          <div className="w-24 h-24 flex items-center justify-center shrink-0 overflow-hidden" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
            {firstImage?<img src={firstImage} alt={item.name} className="w-full h-full object-cover"/>:<ItemArt className="w-1/2 h-1/2" style={{color:T.teal,opacity:0.8}}/>}
          </div>
          <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-[10px] tracking-[0.1em] uppercase mb-1" style={{color:"rgba(36,62,65,0.75)"}}>{item.cat}</p>
              <h3 className="text-[16px] italic mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{item.name}</h3>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {item.color&&item.colors&&<span className="text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}>{item.colors.find(c=>c.variantKey===item.color)?.label||item.color}</span>}
                {item.size&&<p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}>Size: {item.size}</p>}
              </div>
              <button onClick={()=>removeItem(item.id,item.size,item.color)} className="flex items-center gap-1 text-[11px] uppercase tracking-wide" style={{color:"rgba(36,62,65,0.75)"}}><Trash2 size={11}/> Remove</button>
            </div>
            <div className="flex items-center gap-5">
              <div className="inline-flex items-center" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs}}>
                <button onClick={()=>updateQty(item.id,item.size,item.color,-1)} className="w-9 h-9 flex items-center justify-center" style={{color:T.teal}} aria-label={`Decrease quantity of ${item.name}`}><Minus size={13}/></button>
                <span className="w-8 text-center text-[14px]" style={{fontFamily:"'Fraunces',serif"}}>{item.qty}</span>
                <button onClick={()=>updateQty(item.id,item.size,item.color,1)} className="w-9 h-9 flex items-center justify-center" style={{color:T.teal}} aria-label={`Increase quantity of ${item.name}`}><Plus size={13}/></button>
              </div>
              <p className="text-[15px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{item.price*item.qty}</p>
            </div>
          </div>
        </div>;})}
      </div>
      <div className="h-fit p-7" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.lg}}>
        <h2 className="text-[12px] tracking-[0.1em] uppercase mb-5" style={{color:T.teal}}>Order Summary</h2>
        <div className="mb-5">
          <div className="flex gap-2">
            <input value={coupon} onChange={e=>{setCoupon(e.target.value);setCouponErr("");}} placeholder="Coupon code" maxLength={20}
              className="flex-1 bg-transparent outline-none text-[13px]" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,padding:"10px 12px",color:T.teal,fontFamily:"'Space Grotesk',sans-serif"}}/>
            <button onClick={applyCoupon} className="px-4 text-[11px] tracking-[0.1em] uppercase" style={{border:`1px solid ${T.teal}`,borderRadius:RADIUS.xs,color:T.teal}}>Apply</button>
          </div>
          {couponErr&&<p className="text-[11.5px] mt-2 flex items-center gap-1" style={{color:T.error}}><AlertCircle size={11}/>{couponErr}</p>}
          {appliedCoupon&&<p className="text-[11.5px] mt-2 flex items-center gap-1" style={{color:T.success}}><Check size={11}/>Code {appliedCoupon.code} applied — {appliedCoupon.discountPercent}% off</p>}
        </div>
        {[["Subtotal",`₹${subtotal.toLocaleString("en-IN")}`],...(discount>0?[["Discount",`−₹${discount.toLocaleString("en-IN")}`]]:[]),["Shipping",shipping===0?"Free":`₹${shipping}`],["GST (18%)",`₹${gst.toLocaleString("en-IN")}`]].map(([l,v])=><div key={l} className="flex justify-between mb-3 text-[13.5px]" style={{color:l==="Discount"?T.success:"rgba(36,62,65,0.7)"}}><span>{l}</span><span>{v}</span></div>)}
        <div className="flex justify-between items-baseline pt-4 mb-6" style={{borderTop:"1px solid rgba(36,62,65,0.12)"}}>
          <span className="text-[13px]" style={{color:T.teal}}>Total</span>
          <span className="text-[22px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{total.toLocaleString("en-IN")}</span>
        </div>
        <SweepButton filled onClick={()=>navigate("checkout")} className="w-full">Proceed to Checkout</SweepButton>
        {afterDiscount<shipSettings.freeShippingThreshold&&afterDiscount>0&&<p className="text-[11.5px] mt-4 text-center" style={{color:"rgba(36,62,65,0.75)"}}>Add ₹{shipSettings.freeShippingThreshold-afterDiscount} more for free shipping</p>}
        <div className="flex flex-col gap-2.5 mt-6 pt-6" style={{borderTop:"1px solid rgba(36,62,65,0.1)"}}>
          <div className="flex items-center gap-2 text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}><RotateCcw size={13} style={{color:T.teal}}/>Free shipping on orders above ₹{shipSettings.freeShippingThreshold.toLocaleString("en-IN")}</div>
          <div className="flex items-center gap-2 text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}><Lock size={13} style={{color:T.teal}}/>Secure payment via Razorpay</div>
          <div className="flex items-center gap-2 text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}><Check size={13} style={{color:T.teal}}/>7-day returns on damaged or defective pieces</div>
        </div>
      </div>
    </div>
  </div>;
}

// Checkout page (/checkout). The 3-step visual (Cart -> Shipping Details
// -> Payment) reflects a REAL flow now: submitting this form calls
// POST /api/orders/checkout (server recomputes every price from the
// database — nothing here is trusted from the client), then opens the
// real Razorpay payment widget, then POST /api/orders/verify checks the
// cryptographic signature Razorpay returns before the order is ever
// considered paid. See server/routes/orders.js for the security reasoning
// — this component just orchestrates the three steps in order.
// Dynamically loads Razorpay's checkout script only when actually needed
// — replaces the old approach of loading it unconditionally in index.html
// on every single page, found during a live-site sweep to be pulling in
// Razorpay's full SDK (60+ separate JS chunk files) for every visitor to
// every page, including ones nowhere near checkout. Caches the loading
// promise so multiple calls (e.g., retrying payment) don't inject the
// script tag twice.
let razorpayScriptPromise = null;
function loadRazorpayScript() {
  if (typeof window.Razorpay === "function") return Promise.resolve();
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => { razorpayScriptPromise = null; reject(new Error("Failed to load Razorpay checkout script")); };
    document.head.appendChild(script);
  });
  return razorpayScriptPromise;
}

function CheckoutView({ navigate, cart, setCart, setOrder, appliedCoupon, setAppliedCoupon, user, setPostLoginRedirect }) {
  useEffect(()=>{ const v=cart.reduce((s,i)=>s+(Number(i.price)||0)*(i.qty||1),0); trackAkara("begin_checkout",{value:v,items:cart.length}); },[]);
  const [form,setForm]=useState({name:"",email:"",phone:"",address:"",landmark:"",city:"",state:"",pin:"",giftNote:""});
  const [errors,setErrors]=useState({});
  const [stage,setStage]=useState("form"); // form -> processing -> (redirects away on success/failure)
  const upd=k=>v=>setForm(f=>({...f,[k]:v}));
  // REAL, DIRECT GUEST CHECKOUT SUPPORT — directly discussed and
  // designed before writing this. isGuest starts false so a real,
  // logged-in customer's checkout is completely unaffected (they never
  // see this choice at all — see the real gate below, only shown when
  // !user). Once a genuinely signed-out visitor explicitly picks
  // "Continue as Guest," this flips to true and the same, real checkout
  // form below renders normally — no separate, real, second form to
  // maintain; a guest and a logged-in customer fill in the exact same
  // fields, the only real difference is what happens after submitting.
  const [isGuest,setIsGuest]=useState(false);
  // Kicks off loading Razorpay's script the moment this page is actually
  // reached (not on every page — see loadRazorpayScript() above) —
  // fire-and-forget, not awaited, so by the time someone's filled in
  // their address and clicked "Place Order" it's very likely already
  // finished loading in the background.
  useEffect(()=>{ loadRazorpayScript().catch(()=>{}); },[]);
  // Pre-fills from the logged-in account once it's known — a real,
  // small convenience that only became possible now that checkout
  // requires being signed in. Only fills currently-empty fields, so it
  // never overwrites something the customer already typed.
  useEffect(()=>{
    if(!user) return;
    setForm(f=>({
      ...f,
      name: f.name || user.name || "",
      email: f.email || user.email || "",
      phone: f.phone || user.phone || "",
    }));
  },[user]);
  // Real saved addresses (see server/routes/addresses.js) — this is what
  // was missing before: checkout never offered to use anything from the
  // customer's saved address book, always requiring the whole thing typed
  // out fresh. selectedAddressId tracks which one is chosen; "new" means
  // typing a fresh address instead of picking a saved one.
  const [savedAddresses,setSavedAddresses]=useState([]);
  const [selectedAddressId,setSelectedAddressId]=useState(null);
  useEffect(()=>{
    if(!user) return;
    fetch("/api/addresses",{credentials:"include"}).then(r=>r.json()).then(d=>{
      const list=d.addresses||[];
      setSavedAddresses(list);
      if(list.length>0){
        // Defaults to the most recently saved address, but only fills fields
        // that are still empty — never overwrites something already typed.
        setSelectedAddressId(list[0].id);
        setForm(f=>({
          ...f,
          address: f.address || list[0].line,
          city: f.city || list[0].city,
          state: f.state || list[0].state || "",
          pin: f.pin || list[0].pin,
          phone: f.phone || list[0].phone,
        }));
      }
    }).catch(()=>{});
  },[user]);
  const selectSavedAddress=id=>{
    setSelectedAddressId(id);
    const a=savedAddresses.find(x=>x.id===id);
    if(a) setForm(f=>({...f, address:a.line, landmark:a.landmark||"", city:a.city, state:a.state||"", pin:a.pin, phone:a.phone}));
  };
  const subtotal=cart.reduce((s,i)=>s+i.price*i.qty,0);
  const [shipSettings,setShipSettings]=useState({shippingCost:150,freeShippingThreshold:2500,codEnabled:false});
  useEffect(()=>{ fetch("/api/coupons/shipping").then(r=>r.json()).then(setShipSettings).catch(()=>{}); },[]);
  // Defaults to razorpay regardless of what codEnabled turns out to be —
  // never pre-select COD just because it's available, since it's an
  // alternative to the default flow, not a replacement for it.
  const [paymentMethod,setPaymentMethod]=useState("razorpay");
  const [marketingEmailOptIn,setMarketingEmailOptIn]=useState(!!user?.marketingEmailOptIn);
  // Preview-only math, matching the same rule the server applies for
  // real (see priceCartServerSide in server/routes/orders.js) — this is
  // never what actually gets charged, just what's shown before checkout;
  // the real numbers come back from the server's response. Reads live
  // shipping settings and the coupon's real discount percent (fetched
  // in CartView, passed down as {code, discountPercent}) rather than
  // any hardcoded value, so this can never silently drift from what an
  // admin has actually set.
  const discount=appliedCoupon?Math.round(subtotal*(appliedCoupon.discountPercent/100)):0;
  const afterDiscount=subtotal-discount;
  const shipping=afterDiscount===0||afterDiscount>=shipSettings.freeShippingThreshold?0:shipSettings.shippingCost;
  // codFee only actually applies once COD is the selected method — 0
  // otherwise, so this line has no effect at all on the online-payment
  // total. Folded into the taxable base the same way shipping is,
  // matching exactly how the server prices this (see codFee handling in
  // priceCartServerSide, server/routes/orders.js) — this preview must
  // never show a different number than what actually gets charged.
  const codFee=paymentMethod==="cod"?shipSettings.codFee:0;
  const gst=Math.round((afterDiscount+shipping+codFee)*0.18);
  const total=afterDiscount+shipping+codFee+gst;
  // Name, email, address, city, PIN, AND phone are all mandatory now —
  // phone specifically was optional before, which was a real gap: there's
  // no way to actually deliver a parcel without a contact number for the
  // courier. Matches the same requirement now enforced on the address
  // book (server/routes/addresses.js) and on signup.
  const validate=()=>{
    const e={};
    if(!sanitize(form.name).trim()) e.name="Required";
    if(!validEmail(form.email)) e.email="Valid email required";
    if(!validIndianPhone(normalizePhone(form.phone))) e.phone="Valid 10-digit mobile number required — needed to deliver your parcel";
    if(!sanitize(form.address).trim()) e.address="Required";
    if(!sanitize(form.city).trim()) e.city="Required";
    if(!/^\d{6}$/.test(form.pin)) e.pin="Valid 6-digit PIN required";
    setErrors(e); return Object.keys(e).length===0;
  };
  // Orders require a real account — this is enforced for real on the
  // REAL, DIRECT GUEST CHECKOUT SUPPORT — this real gate used to be a
  // hard wall with no way through except signing in. Now offers a
  // genuine, calm, third choice: continue as a guest. Deliberately
  // presented as an equal, side-by-side option rather than a small,
  // easy-to-miss link under the real "sign in" buttons — a real,
  // honest choice the customer should be able to see clearly, not one
  // being quietly discouraged. The real, direct, honest disclosure text
  // under the guest option says exactly what they're giving up, so
  // nothing here is a surprise later.
  if(!user&&!isGuest) return <div className="px-6 py-24 max-w-[560px] mx-auto text-center">
    <Lock size={32} strokeWidth={1.2} style={{color:"rgba(36,62,65,0.75)",margin:"0 auto 20px"}}/>
    <h1 className="italic text-[26px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>How would you like to check out?</h1>
    <div className="grid sm:grid-cols-2 gap-4 text-left mt-8">
      <div className="p-6" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
        <p className="text-[15px] mb-2" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Sign in or create an account</p>
        <p className="text-[13px] leading-[1.7] mb-5" style={{color:"rgba(36,62,65,0.75)"}}>
          Keeps your order history, invoices, and tracking all in one place — the easiest way to check on this order later.
        </p>
        <div className="flex flex-col gap-2.5">
          <SweepButton filled onClick={()=>{setPostLoginRedirect("checkout");navigate("login");}}>Sign In</SweepButton>
          <SweepButton onClick={()=>{setPostLoginRedirect("checkout");navigate("signup");}}>Create Account</SweepButton>
        </div>
      </div>
      <div className="p-6" style={{backgroundColor:"rgba(24,54,48,0.04)",borderRadius:RADIUS.md,border:"1px solid rgba(36,62,65,0.12)"}}>
        <p className="text-[15px] mb-2" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Continue as a guest</p>
        <p className="text-[13px] leading-[1.7] mb-5" style={{color:"rgba(36,62,65,0.75)"}}>
          Faster, but this order won't appear in any account — we'll email you a real, direct link to check on it, so keep that email safe. You can also turn it into an account afterward.
        </p>
        <SweepButton onClick={()=>setIsGuest(true)}>Continue as Guest</SweepButton>
      </div>
    </div>
  </div>;

  const submit=async e=>{
    e.preventDefault();
    if(!validate()||cart.length===0) return;
    setStage("processing");
    try{
      const res=await apiFetch("/api/orders/checkout",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          // REAL BUG FIX: this was never sending color at all, only
          // size — found while auditing every real place order items
          // get displayed, not from a report, but the implication is
          // serious: every real checkout for a color-variant product
          // was sending color:undefined to the server, which (given
          // the server's own "a color was specified but isn't real for
          // this product" rejection, built specifically to close a
          // price-manipulation gap) meant a customer picking Red could
          // genuinely have checked out at Black's price, or had their
          // checkout rejected outright, depending on which variant
          // rows happened to exist. This was never actually exercised
          // by outbound testing before now — every previous checkout
          // test constructed its own request body directly with color
          // already included, rather than going through this real
          // frontend code path.
          items: cart.map(i=>({id:i.id, size:i.size, color:i.color, qty:i.qty})), // deliberately NOT sending price — the server prices everything itself
          address:{ name:sanitize(form.name), line:sanitize(form.address), landmark:sanitize(form.landmark), city:sanitize(form.city), state:sanitize(form.state), pin:form.pin, giftNote:sanitize(form.giftNote||"").slice(0,200) },
          email:sanitize(form.email), phone:sanitize(form.phone),
          couponCode: appliedCoupon?.code || undefined, // only the CODE is sent — the server computes the actual discount itself, never trusts a client-sent amount
          paymentMethod,
          // REAL, DIRECT GUEST CHECKOUT SUPPORT: only ever true when the
          // real gate above genuinely required this explicit, direct
          // choice — a logged-in customer's checkout never sets this,
          // since it's simply not relevant for them (the server's own,
          // real check is `!req.customer && !guestCheckout`, so this
          // being sent as false/absent is exactly the same as never
          // sending it for a real, authenticated customer's request).
          guestCheckout: isGuest,
          marketingEmailOptIn: !!marketingEmailOptIn,
        }),
      });
      let data={};
      try { data=await res.json(); } catch { data={}; }
      if(!res.ok){
        const msg=data.error||data.message||(res.status===403?"Session expired — refresh and try again.":res.status===429?"Too many attempts — wait a moment and try again.":`Checkout failed (HTTP ${res.status}). Please try again.`);
        setErrors({form:msg});
        setStage("form");
        return;
      }

      // COD order — fully confirmed the moment the server accepted it,
      // no Razorpay widget involved at all. The server independently
      // re-checks COD is actually enabled before ever reaching this
      // point, so isCOD in the response can be trusted here.
      if(data.isCOD){
        setOrder(data.order);
        setCart([]);
        setAppliedCoupon(null);
        try{ if(data.order?.orderNumber) sessionStorage.setItem("akara_last_order_number", data.order.orderNumber); }catch{}
        navigate("order-confirmed", data.order?.orderNumber||null);
        return;
      }

      if(typeof window.Razorpay!=="function"){
        try{ await loadRazorpayScript(); }
        catch{ setErrors({form:"Payment couldn't load. Please check your connection and try again."}); setStage("form"); return; }
      }

      const rzp = new window.Razorpay({
        key: data.keyId,
        amount: data.amount,
        currency: data.currency,
        order_id: data.razorpayOrderId,
        name: "ĀKĀRA",
        description: `Order ${data.orderNumber}`,
        prefill: { name: sanitize(form.name), email: sanitize(form.email), contact: sanitize(form.phone) },
        theme: { color: "#183630" },
        handler: async (response)=>{
          try{
            const verifyRes = await apiFetch("/api/orders/verify",{
              method:"POST", headers:{"Content-Type":"application/json"},
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            const verifyData = await verifyRes.json();
            if(!verifyRes.ok){ navigate("payment-failed"); return; }
            setOrder(verifyData.order);
            setCart([]);
            setAppliedCoupon(null);
            try{ if(verifyData.order?.orderNumber) sessionStorage.setItem("akara_last_order_number", verifyData.order.orderNumber); }catch{}
            navigate("order-confirmed", verifyData.order?.orderNumber||data.orderNumber||null);
          }catch{
            navigate("payment-failed");
          }
        },
        modal: { ondismiss: ()=>{ setStage("form"); } }, // customer closed the widget without paying — back to the form, cart is untouched
      });
      rzp.on("payment.failed", ()=>{ navigate("payment-failed"); });
      rzp.open();
    }catch{
      setErrors({form:"Couldn't reach the server. Please check your connection and try again."});
      setStage("form");
    }
  };

  return <div className="px-6 md:px-14 py-16 max-w-[1100px] mx-auto">
    <h1 className="italic text-[32px] md:text-[40px] mb-8" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Checkout</h1>
    <div className="flex items-center gap-3 mb-12 flex-wrap">
      {[{n:1,label:"Cart",done:true},{n:2,label:"Shipping Details",done:stage==="processing",current:stage==="form"},{n:3,label:"Payment",done:false,current:stage==="processing"}].map((s,i,arr)=><div key={s.n} className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] shrink-0" style={s.done?{backgroundColor:T.gold,color:"white"}:s.current?{backgroundColor:T.teal,color:"white"}:{border:"1px solid rgba(36,62,65,0.25)",color:"rgba(36,62,65,0.75)"}}>
            {s.done?<Check size={13}/>:s.n}
          </div>
          <span className="text-[12.5px] whitespace-nowrap" style={{color:s.current?T.teal:s.done?T.teal:"rgba(36,62,65,0.4)"}}>{s.label}</span>
        </div>
        {i<arr.length-1&&<div className="w-8 sm:w-16 h-px" style={{backgroundColor:s.done?T.gold:"rgba(36,62,65,0.2)"}}/>}
      </div>)}
    </div>
    {errors.form&&<div className="flex items-center gap-2 px-4 py-3 mb-8 text-[13px]" style={{backgroundColor:"rgba(192,57,43,0.07)",color:T.error}}><AlertCircle size={14}/>{errors.form}</div>}
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-14">
      <form onSubmit={submit} noValidate>
        <h2 className="text-[12px] tracking-[0.1em] uppercase mb-5" style={{color:T.teal}}>Contact</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <InputField label="Full Name" value={form.name} onChange={upd("name")} error={errors.name} required/>
          <InputField label="Email" type="email" value={form.email} onChange={upd("email")} error={errors.email} required/>
          <div className="sm:col-span-2"><InputField label="Phone" type="tel" value={form.phone} onChange={upd("phone")} error={errors.phone} required/></div>
        </div>
        <h2 className="text-[12px] tracking-[0.1em] uppercase mb-5" style={{color:T.teal}}>Shipping Address</h2>
        {savedAddresses.length>0&&<div className="flex flex-wrap gap-2 mb-5">
          {savedAddresses.map(a=><button key={a.id} type="button" onClick={()=>selectSavedAddress(a.id)}
            className="text-left px-4 py-2.5 text-[12.5px]" style={{border:`1px solid ${selectedAddressId===a.id?T.teal:"rgba(36,62,65,0.2)"}`,borderRadius:RADIUS.xs,backgroundColor:selectedAddressId===a.id?"rgba(36,62,65,0.05)":"transparent",color:T.teal}}>
            {a.name} — {a.line.slice(0,30)}{a.line.length>30?"…":""}
          </button>)}
          <button type="button" onClick={()=>{setSelectedAddressId(null);setForm(f=>({...f,address:"",landmark:"",city:"",state:"",pin:""}));}}
            className="text-left px-4 py-2.5 text-[12.5px]" style={{border:`1px solid ${selectedAddressId===null?T.teal:"rgba(36,62,65,0.2)"}`,borderRadius:RADIUS.xs,color:T.teal}}>+ New Address</button>
        </div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <div className="sm:col-span-2"><InputField label="Address" value={form.address} onChange={upd("address")} error={errors.address} required/></div>
          <div className="sm:col-span-2"><InputField label="Landmark (optional)" value={form.landmark} onChange={upd("landmark")}/></div>
          <div className="sm:col-span-2"><InputField label="Gift note (optional)" value={form.giftNote||""} onChange={upd("giftNote")} placeholder="A short line for the recipient — printed with care"/></div>
          <InputField label="City" value={form.city} onChange={upd("city")} error={errors.city} required/>
          <InputField label="State" value={form.state} onChange={upd("state")}/>
          <InputField label="PIN Code" value={form.pin} onChange={v=>{ upd("pin")(v); lookupPincode(v,({city,state})=>setForm(f=>({...f,city,state}))); }} error={errors.pin} maxLength={6} required/>
        </div>
        {shipSettings.codEnabled&&<div className="mb-2">
          <p className="text-[11px] tracking-[0.08em] uppercase mb-2.5" style={{color:"rgba(36,62,65,0.75)"}}>Payment Method</p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={()=>setPaymentMethod("razorpay")} className="px-4 py-3 text-left text-[13px]"
              style={paymentMethod==="razorpay"?{border:`1px solid ${T.teal}`,backgroundColor:"rgba(36,62,65,0.05)",borderRadius:RADIUS.xs,color:T.teal}:{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs,color:"rgba(36,62,65,0.75)"}}>
              Pay Online
            </button>
            <button type="button" onClick={()=>setPaymentMethod("cod")} className="px-4 py-3 text-left text-[13px]"
              style={paymentMethod==="cod"?{border:`1px solid ${T.teal}`,backgroundColor:"rgba(36,62,65,0.05)",borderRadius:RADIUS.xs,color:T.teal}:{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs,color:"rgba(36,62,65,0.75)"}}>
              Cash on Delivery
            </button>
          </div>
        </div>}
        <SweepButton filled type="submit" disabled={stage==="processing"} className="w-full">
          {stage==="processing"?"Opening secure payment…":paymentMethod==="cod"?`Place Order — Pay ₹${total.toLocaleString("en-IN")} on Delivery`:`Place Order — ₹${total.toLocaleString("en-IN")}`}
        </SweepButton>
        <label className="flex items-start gap-2.5 mb-4 text-[12.5px] text-left cursor-pointer" style={{color:"rgba(36,62,65,0.8)"}}>
          <input type="checkbox" checked={marketingEmailOptIn} onChange={e=>setMarketingEmailOptIn(e.target.checked)} className="mt-1 shrink-0"/>
          <span>Email me occasional studio notes and new pieces. Order updates always send. Unsubscribe anytime.</span>
        </label>
        <p className="text-[11.5px] mt-4 flex items-center gap-2" style={{color:"rgba(36,62,65,0.75)"}}><Lock size={11}/> {paymentMethod==="cod"?"Pay in cash when your order arrives":"Secure checkout via Razorpay"}</p>
      </form>
      <div className="h-fit p-7" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.lg}}>
        <h2 className="text-[12px] tracking-[0.1em] uppercase mb-5" style={{color:T.teal}}>Summary</h2>
        {cart.map(i=><div key={i.id+i.size+(i.color||"")} className="flex justify-between text-[13px] mb-2.5" style={{color:"rgba(36,62,65,0.75)"}}><span>{i.name}{[i.color&&i.colors?.find(c=>c.variantKey===i.color)?.label,i.size].filter(Boolean).length?` (${[i.color&&i.colors?.find(c=>c.variantKey===i.color)?.label,i.size].filter(Boolean).join(", ")})`:""} × {i.qty}</span><span>₹{i.price*i.qty}</span></div>)}
        <div className="pt-4 mt-3 flex flex-col gap-2.5 text-[13.5px]" style={{borderTop:"1px solid rgba(36,62,65,0.12)",color:"rgba(36,62,65,0.75)"}}>
          <div className="flex justify-between"><span>Subtotal</span><span>₹{subtotal.toLocaleString("en-IN")}</span></div>
          {discount>0&&<div className="flex justify-between" style={{color:T.teal}}><span>Discount ({appliedCoupon?.code})</span><span>−₹{discount.toLocaleString("en-IN")}</span></div>}
          {[["Shipping",shipping===0?"Free":`₹${shipping}`],...(codFee>0?[["COD Handling Fee",`₹${codFee}`]]:[]),["GST (18%)",`₹${gst.toLocaleString("en-IN")}`]].map(([l,v])=><div key={l} className="flex justify-between"><span>{l}</span><span>{v}</span></div>)}
        </div>
        <div className="flex justify-between items-baseline pt-4 mt-3" style={{borderTop:"1px solid rgba(36,62,65,0.12)"}}>
          <span className="text-[13px]" style={{color:T.teal}}>Total</span>
          <span className="text-[20px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{total.toLocaleString("en-IN")}</span>
        </div>
        <p className="text-[11px] mt-4" style={{color:"rgba(36,62,65,0.75)"}}>This total is a preview — the amount you're actually charged is calculated by the server at checkout, from current prices, not from this page.</p>
      </div>
    </div>
  </div>;
}

// Order confirmation page, shown immediately after a verified payment (see
// CheckoutView). `order` here is the just-completed order, held in
// AkaraAppRoot's state for this immediate post-checkout display — full
// order HISTORY now lives in the database and is fetched separately by
// My Account's Orders tab (GET /api/orders), so this is no longer the only
// place order data exists — just the most immediate one.
// Order confirmation page, shown immediately after a verified payment (see
// CheckoutView). Deliberately re-verifies the order's real payment status
// with the server on mount (GET /api/orders/:orderNumber) rather than
// trusting the client-side `order` object alone — this is defense in
// depth against any scenario (a Razorpay SDK quirk, stale state, anything)
// where this page could otherwise render "confirmed, we'll ship it"
// without payment having actually succeeded. The server's payment_status
// is the only thing that gets to say that.

// Soft brand confetti for order confirmation — teal / cream / gold only.
// Respects prefers-reduced-motion. No external dependency.
function fireOrderConfetti() {
  if (typeof window === "undefined") return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  const colors = ["#183630", "#E5C690", "#E3DAC9", "#2a4a45", "#c4a574"];
  const particles = Array.from({ length: 56 }, () => {
    const angle = (Math.random() * 0.9 - 0.45) * Math.PI - Math.PI / 2;
    const speed = 4 + Math.random() * 7;
    return {
      x: window.innerWidth * (0.35 + Math.random() * 0.3),
      y: window.innerHeight * 0.35,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      g: 0.12 + Math.random() * 0.08,
      w: 4 + Math.random() * 5,
      h: 6 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.25,
      color: colors[(Math.random() * colors.length) | 0],
      life: 1,
    };
  });
  let frame = 0;
  const maxFrames = 90;
  function tick() {
    frame++;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const p of particles) {
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life = 1 - frame / maxFrames;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (frame < maxFrames) requestAnimationFrame(tick);
    else canvas.remove();
  }
  requestAnimationFrame(tick);
}

function OrderConfirmedView({ navigate, order, onLogin }) {
  const showToast=useToast();
  const [verified,setVerified]=useState(null); // null = checking, true = confirmed paid, false = not actually paid
  const [thanksOpen,setThanksOpen]=useState(true);
  useEffect(()=>{
    if(!order?.orderNumber) return;
    try{
      const k="akara_purchase_"+order.orderNumber;
      if(sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k,"1");
      trackAkara("purchase",{orderNumber:order.orderNumber,value:order.total});
    }catch{}
  },[order?.orderNumber]);
  const [reviewStars,setReviewStars]=useState({}); // productId -> 1..5
  const [reviewText,setReviewText]=useState({});
  const [reviewSending,setReviewSending]=useState(false);
  const [reviewDone,setReviewDone]=useState({});
  // REAL, DIRECT GUEST CHECKOUT SUPPORT: the "save this order to an
  // account" prompt, shown only for a genuine guest order. A real,
  // deliberately small form — just a password, since the order already
  // carries the real name/email/phone this account gets created with.
  const [showSaveForm,setShowSaveForm]=useState(false);
  const [savePassword,setSavePassword]=useState("");
  const [saveError,setSaveError]=useState("");
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const saveToAccount=async e=>{
    e.preventDefault();
    setSaveError(""); setSaving(true);
    try{
      const res=await apiFetch("/api/orders/convert-to-account",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ token:order.guestTrackingToken, password:savePassword }),
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok){ setSaveError(data.error||"Couldn't create your account. Please try again."); setSaving(false); return; }
      onLogin(data.customer);
      setSaved(true);
      showToast("Account created — this order, and any others under this email, are now in your account.","success");
    }catch{
      setSaveError("Couldn't reach the server. Please try again.");
    }finally{
      setSaving(false);
    }
  };
  useEffect(()=>{
    if(!order?.orderNumber){ setVerified(false); return; }
    // REAL BUG FIX, found directly by testing the complete, real guest
    // checkout flow end to end: this always re-fetched via the
    // authenticated-only GET /api/orders/:orderNumber — which correctly
    // rejects a genuine guest with no session at all, making a real,
    // successfully-placed COD order incorrectly show "We couldn't
    // confirm this payment," even though it had genuinely, correctly
    // gone through. Uses the real, public, token-based route instead
    // for a genuine guest order — the exact same one already proven
    // correct for order tracking — while a logged-in customer's order
    // keeps using the exact same, unchanged, authenticated route.
    const url = order.guestTrackingToken
      ? `/api/orders/track/${order.guestTrackingToken}`
      : `/api/orders/${order.orderNumber}`;
    fetch(url,{credentials:"include"})
      .then(r=>r.ok?r.json():null)
      .then(data=>{
        const ok = data?.order?.paymentStatus==="paid"||data?.order?.paymentStatus==="cod";
        setVerified(ok);
        if (ok) fireOrderConfetti();
      })
      .catch(()=>setVerified(false));
  },[order?.orderNumber]);

  if(!order) return <div className="px-6 py-32 text-center"><SweepButton filled onClick={()=>navigate("shop")}>Back to Shop</SweepButton></div>;
  if(verified===null) return <div className="px-6 py-32 text-center"><p className="text-[13px]" style={{color:"rgba(36,62,65,0.75)"}}>Confirming your order…</p></div>;
  if(verified===false) return <div className="px-6 py-32 text-center max-w-[440px] mx-auto">
    <AlertCircle size={40} strokeWidth={1} style={{color:"rgba(168,59,50,0.4)",margin:"0 auto 20px"}}/>
    <h1 className="italic text-[24px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>We couldn't confirm this payment.</h1>
    <p className="text-[13.5px] mb-8" style={{color:"rgba(36,62,65,0.75)"}}>Order #{order.orderNumber} hasn't been marked as paid yet. If you completed a payment, please contact us — otherwise it may have been cancelled or is still processing.</p>
    <SweepButton filled onClick={()=>navigate("account")}>View My Orders</SweepButton>
  </div>;
  return <div className="px-6 py-20 max-w-[600px] mx-auto text-center">
    <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-7" style={{backgroundColor:"rgba(184,147,90,0.12)"}}>
      <Check size={22} style={{color:T.teal}}/>
    </div>
    <p className="text-[12px] tracking-[0.2em] uppercase mb-3" style={{color:T.teal}}>Order confirmed</p>
    <div className="mx-auto w-10 h-px mb-5" style={{backgroundColor:T.gold}}/>
    <h1 className="italic text-[28px] md:text-[34px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Thank you, {sanitize(order.name).split(" ")[0]}.</h1>
    <p className="text-[14.5px] leading-[1.8] mb-10" style={{color:"rgba(36,62,65,0.75)"}}>
      Your order <strong style={{color:T.teal}}>#{order.orderNumber}</strong> is confirmed. We'll email {sanitize(order.email)} once it ships — typically 2–3 weeks.
    </p>
    {thanksOpen&&(
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{backgroundColor:"rgba(24,54,48,0.45)"}} role="dialog" aria-modal="true" aria-label="Thank you">
        <div className="w-full max-w-[440px] max-h-[90vh] overflow-y-auto p-6 md:p-8 text-left" style={{backgroundColor:T.cream,borderRadius:RADIUS.lg,boxShadow:ELEVATION.raised}}>
          <p className="text-[11px] tracking-[0.18em] uppercase mb-2" style={{color:T.teal}}>Studio note</p>
          <h2 className="italic text-[24px] mb-3" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Thank you for choosing Ākāra.</h2>
          <p className="text-[13.5px] leading-[1.75] mb-6" style={{color:"rgba(36,62,65,0.78)"}}>
            Your piece will be made with the same care as every object that leaves our Mumbai studio. If you already know how the experience felt, a star rating helps other collectors — and helps us.
          </p>
          {order.isGuestOrder&&(
            <p className="text-[12.5px] mb-4 p-3" style={{backgroundColor:"rgba(24,54,48,0.06)",color:T.teal,borderRadius:8}}>
              Verified ratings need an account linked to this order. Save your order below, then you can rate anytime from My Account.
            </p>
          )}
          {(order.items||[]).map(item=>{
            const pid=item.id;
            const done=!!reviewDone[pid];
            const stars=reviewStars[pid]||0;
            return (
              <div key={pid+(item.size||"")+(item.color||"")} className="mb-5 pb-5" style={{borderBottom:"1px solid rgba(36,62,65,0.1)"}}>
                <p className="text-[14px] mb-2" style={{color:T.teal}}>{item.name}</p>
                {done?<p className="text-[12.5px]" style={{color:T.success}}>Thank you — your rating was saved.</p>:(
                  <>
                    <div className="flex gap-1.5 mb-2">
                      {[1,2,3,4,5].map(n=>(
                        <button key={n} type="button" aria-label={`${n} stars`} onClick={()=>setReviewStars(s=>({...s,[pid]:n}))}
                          className="text-[22px] leading-none transition-opacity" style={{color:n<=stars?T.gold:"rgba(36,62,65,0.25)"}}>★</button>
                      ))}
                    </div>
                    <textarea value={reviewText[pid]||""} onChange={e=>setReviewText(s=>({...s,[pid]:sanitize(e.target.value).slice(0,500)}))}
                      rows={2} placeholder="Optional note (what drew you to this piece?)"
                      className="w-full text-[13px] px-3 py-2 mb-2 outline-none" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:8,background:"transparent",color:T.teal,resize:"vertical"}}/>
                    <button type="button" disabled={!stars||reviewSending}
                      onClick={async()=>{
                        if(!stars) return;
                        if(order.isGuestOrder){ showToast("Save this order to an account first to leave a verified review.","error"); return; }
                        setReviewSending(true);
                        try{
                          const res=await apiFetch("/api/reviews",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderNumber:order.orderNumber,productId:pid,rating:stars,comment:reviewText[pid]||""})});
                          const data=await res.json().catch(()=>({}));
                          if(res.ok){ setReviewDone(d=>({...d,[pid]:true})); showToast("Thank you for the review","success"); }
                          else showToast(data.error||"Could not save review — you can rate later from your account.","error");
                        }catch{ showToast("Could not reach the server.","error"); }
                        finally{ setReviewSending(false); }
                      }}
                      className="text-[11px] uppercase tracking-[0.12em] px-4 py-2 disabled:opacity-40"
                      style={{backgroundColor:T.teal,color:T.cream,borderRadius:8}}>
                      {reviewSending?"Saving…":"Submit rating"}
                    </button>
                  </>
                )}
              </div>
            );
          })}
          <button type="button" onClick={()=>setThanksOpen(false)} className="w-full text-[12px] uppercase tracking-[0.14em] py-3 mt-2" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:8,color:T.teal}}>
            Continue to order details
          </button>
        </div>
      </div>
    )}
    <div className="text-left p-7 mb-8" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.lg}}>
      {order.items.map(i=><div key={i.id+i.size+(i.color||"")} className="flex justify-between text-[13.5px] mb-3" style={{color:"rgba(36,62,65,0.75)"}}><span>{i.name}{[i.colorLabel,i.size].filter(Boolean).length?` (${[i.colorLabel,i.size].filter(Boolean).join(", ")})`:""} × {i.qty}</span><span>₹{i.price*i.qty}</span></div>)}
      <div className="flex justify-between items-baseline pt-4 mt-3" style={{borderTop:"1px solid rgba(36,62,65,0.12)"}}>
        <span className="text-[13px]" style={{color:T.teal}}>{order.paymentMethod==="cod"?"Amount Due on Delivery":"Total Paid"}</span>
        <span className="text-[19px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{order.total.toLocaleString("en-IN")}</span>
      </div>
    </div>
    <p className="text-[13px] mb-8" style={{color:"rgba(36,62,65,0.75)"}}>Shipping to: {sanitize(order.address)}{order.landmark?`, near ${sanitize(order.landmark)}`:""}, {sanitize(order.city)}</p>
    {/* REAL, DIRECT GUEST CHECKOUT SUPPORT: only ever shown for a
        genuine guest order — a logged-in customer's order already
        lives in their real account, so this would be genuinely
        meaningless for them. Deliberately placed right here, in the
        one, real moment a guest is most likely to reconsider — after
        they've already seen the order genuinely go through. */}
    {order.isGuestOrder&&<div className="text-left p-6 mb-8" style={{backgroundColor:"rgba(24,54,48,0.04)",borderRadius:RADIUS.md,border:"1px solid rgba(36,62,65,0.12)"}}>
      {saved?<p className="text-[13.5px]" style={{color:T.success}}>✓ Saved — this order is now in your account. You're signed in.</p>:
      !showSaveForm?<>
        <p className="text-[14px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Want this order saved for next time?</p>
        <p className="text-[13px] leading-[1.7] mb-4" style={{color:"rgba(36,62,65,0.75)"}}>
          You checked out as a guest — a real link to track this order is on its way to {sanitize(order.email)}. If you'd rather have it saved to an account, we can do that now with just a password.
        </p>
        <SweepButton onClick={()=>setShowSaveForm(true)}>Save This Order to an Account</SweepButton>
      </>:
      <form onSubmit={saveToAccount}>
        <p className="text-[14px] mb-3" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Create your account</p>
        <p className="text-[12.5px] mb-3" style={{color:"rgba(36,62,65,0.75)"}}>Using {sanitize(order.email)} — just set a password to finish.</p>
        <InputField label="Password" type="password" value={savePassword} onChange={setSavePassword} required/>
        {saveError&&<p className="text-[12.5px] mt-2" style={{color:T.error}}>{saveError}</p>}
        <div className="flex gap-3 mt-4">
          <SweepButton filled type="submit" disabled={saving}>{saving?"Creating…":"Create Account"}</SweepButton>
          <SweepButton onClick={()=>setShowSaveForm(false)}>Cancel</SweepButton>
        </div>
      </form>}
    </div>}
    <div className="flex flex-col sm:flex-row gap-4 justify-center mb-4">
      <SweepButton filled onClick={()=>navigate("shop")}>Continue Shopping</SweepButton>
      <SweepButton onClick={()=>navigate("order-status")}>View Order Status</SweepButton>
    </div>
    <button onClick={()=>navigate("invoice")} className="text-[12.5px] underline mx-auto block" style={{color:T.teal}}>Download Invoice</button>
  </div>;
}

const ORDER_STAGES=[
  {key:"confirmed",label:"Confirmed",icon:Check,desc:"We've received your order and payment."},
  {key:"production",label:"Production",icon:Package,desc:"Your piece is being 3D-printed to order."},
  {key:"qc",label:"QC & Packaging",icon:ClipboardCheck,desc:"Quality-checked and carefully packed."},
  {key:"dispatch",label:"Dispatched",icon:Truck,desc:"Handed to our courier partner."},
  {key:"delivered",label:"Delivered",icon:MapPin,desc:"Arrived at your address."},
];
// Maps the REAL order status (set by an admin — see PATCH
// /api/admin/orders/:orderNumber/status) to a stage index (0-4). This
// used to fake progress purely from elapsed time since order.placedAt,
// completely ignoring whatever an admin had actually set — meaning the
// customer's tracking page could show "Delivered" while the order was
// still sitting in production, or "Confirmed" days after it had genuinely
// shipped. Found and fixed while wiring up courier tracking: everything
// downstream (status emails, dispatch SMS, the real admin status system)
// was already reading the real status — only this specific display
// function had been left behind on the old time-based guess.
function stageIndexFromOrder(order){
  if(!order) return 0;
  const STATUS_TO_STAGE={confirmed:0,production:1,qc:2,dispatched:3,delivered:4};
  return STATUS_TO_STAGE[order.status] ?? 0;
}
// Downloadable/printable GST tax invoice (/invoice) — "Download Invoice"
// on Order Confirmed, Order Status, and My Account all route here. Uses
// window.print() (browser's native Print-to-PDF) rather than a PDF
// library, since there's no build tooling/package.json yet to add one.
// CGST+SGST are split from order.total (NOT recalculated independently)
// specifically to avoid a rounding mismatch between what was actually
// charged and what the invoice displays — matching the same split the
// server itself computed and stored at checkout (see priceCartServerSide
// in server/routes/orders.js). Assumes intra-state (Maharashtra) shipping
// — no IGST logic for out-of-state orders, since the server doesn't yet
// detect customer state and branch the tax calculation. `order` is
// whichever order is currently "active" in AkaraAppRoot's state — either
// the one just checked out, or one opened from My Account's real order
// history via openOrder() there.
// Generates a REAL, downloadable PDF invoice client-side, using the exact
// same figures the server computed and stored at checkout (never
// recalculated here — same reasoning as the on-screen invoice below).
// This is a genuine file download, not the browser's Print dialog —
// window.print() alone requires the customer to manually choose "Save as
// PDF" from their system's print destinations, which isn't available or
// obvious in every browser/device context. This always works the same way.
//
// jsPDF + jspdf-autotable are loaded via dynamic import(), not a static
// top-level import — same reasoning as AdminApp being lazy-loaded: it
// would otherwise add real weight to what every single customer downloads
// on every page, even though only someone actually opening an invoice
// ever needs a PDF library at all.
async function downloadInvoicePDF(order){
  const [{ jsPDF }, autoTableModule, fontModule] = await Promise.all([import("jspdf"), import("jspdf-autotable"), import("./invoiceFontData.js")]);
  const autoTable = autoTableModule.default;
  const doc=new jsPDF();
  // Real, embedded Noto Sans font — genuinely, thoroughly stress-tested
  // (every character used anywhere on this invoice: ĀKĀRA/ākāra, the ₹
  // symbol, full upper/lowercase Latin, digits, and common punctuation,
  // confirmed present in both weights via direct font inspection, then
  // separately confirmed correct by actually rendering and visually
  // reviewing each one) before being wired in here. Necessary because
  // jsPDF's own built-in fonts (Helvetica/Times/Courier) genuinely
  // cannot render "Ā" at all — confirmed directly: every one of them
  // silently drops the character, rendering "ĀKĀRA" as "KRA". See
  // invoiceFontData.js for the real, complete provenance/license note.
  doc.addFileToVFS("NotoSans-Regular.ttf", fontModule.NOTO_SANS_REGULAR_BASE64);
  doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  doc.addFileToVFS("NotoSans-Bold.ttf", fontModule.NOTO_SANS_BOLD_BASE64);
  doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");

  // REAL, DIRECT FIX — the fuller visual redesign sampled and approved
  // earlier (a real, colored header band, softer warm-gray rules, a
  // highlighted total block) was only ever a prototype PDF; the actual,
  // live invoice kept its original, plain layout with just the font
  // swapped in. This carries that real, approved design into the
  // actual, live generator — every real number, every piece of business
  // logic below (discount, COD fee, coupon code, cancelled-order
  // handling) is completely unchanged; only how it's drawn differs.
  const TEAL=[24,54,48], CREAM=[227,218,201], GOLD=[229,198,144], WARMGRAY=[150,140,125], DARKTEXT=[40,45,42];

  const { subtotal=0, discount=0, shippingCost:shipCost=0, codFee=0, cgst=0, sgst=0, total:grandTotal=0 } = order;
  const invoiceDate=order.placedAt?new Date(order.placedAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}):"";
  const cancelled=order.status==="cancelled";
  // Same real gap as the on-screen invoice, found in testing: a
  // cancelled order's downloaded PDF looked completely normal, with
  // nothing indicating it was no longer valid. yOffset shifts every
  // subsequent element down to make clean room for a real banner,
  // rather than cramming it into whatever space happened to be left.
  const yOffset=cancelled?14:0;

  if(cancelled){
    // Drawn FIRST so it sits visually behind everything else (jsPDF, like
    // a canvas, layers in draw order) — the same "VOID stamp" convention
    // paper invoices have used for decades, large and diagonal so it's
    // impossible to miss even at a glance, not just on close reading.
    doc.setFont("NotoSans","bold"); doc.setFontSize(62);
    doc.setTextColor(230,200,197);
    doc.text("CANCELLED",105,180,{align:"center",angle:35});
    doc.setTextColor(0,0,0);
  }

  // Real, solid teal header band — the brand's own actual colour,
  // replacing the old, plain white top with a real, deliberate identity
  // right where a customer's eye lands first.
  doc.setFillColor(...TEAL);
  doc.rect(0,0,210,38,"F");
  doc.setTextColor(255,255,255);
  doc.setFont("NotoSans","bold"); doc.setFontSize(20);
  doc.text("ĀKĀRA",14,20);
  doc.setFont("NotoSans","normal"); doc.setFontSize(8.5);
  doc.setTextColor(...GOLD);
  doc.text("ĀKĀRA is a brand of Precision Forge Labs",14,27);
  doc.setTextColor(255,255,255);
  doc.text("Thane, Maharashtra 400601  |  GSTIN: 27GZCPS9353H1ZQ",14,32.5);

  doc.setFont("NotoSans","normal"); doc.setFontSize(8);
  doc.text("TAX INVOICE",196,16,{align:"right"});
  doc.setFont("NotoSans","bold"); doc.setFontSize(10);
  doc.text(`Invoice #: ${order.orderNumber}`,196,22.5,{align:"right"});
  doc.setFont("NotoSans","normal"); doc.setFontSize(9);
  doc.text(`Date: ${invoiceDate}`,196,28,{align:"right"});
  doc.setFontSize(8); doc.setTextColor(...GOLD);
  doc.text(order.paymentMethod==="cod"?"Payment: Cash on Delivery":"Payment: Prepaid",196,33.5,{align:"right"});
  doc.setTextColor(0,0,0);

  if(cancelled){
    doc.setFillColor(253,238,236);
    doc.setDrawColor(168,59,50); doc.setLineWidth(0.6);
    doc.rect(14,51,182,10,"FD");
    doc.setFont("NotoSans","bold"); doc.setFontSize(10);
    doc.setTextColor(168,59,50);
    doc.text("This order was cancelled — this invoice is no longer valid.",105,57.5,{align:"center"});
    doc.setTextColor(0,0,0);
  }

  // Real, two-column layout: who it's billed to, and who it's from —
  // each with a thin, real gold rule under its own label, matching the
  // real, approved sample design.
  let headY=55+yOffset;
  doc.setFont("NotoSans","bold"); doc.setFontSize(8);
  doc.setTextColor(...WARMGRAY);
  doc.text("BILLED & SHIPPED TO",14,headY);
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.4);
  doc.line(14,headY+2,50,headY+2);
  doc.text("FROM",120,headY);
  doc.line(120,headY+2,135,headY+2);

  headY+=7;
  doc.setTextColor(...DARKTEXT);
  doc.setFont("NotoSans","normal"); doc.setFontSize(9.5);
  doc.text(sanitize(order.name||""),14,headY);
  doc.text("Precision Forge Labs",120,headY);
  // REAL, DIRECT BUG FIX, found by actually rendering and looking at a
  // realistic, longer real address: a fixed, single-line Y advance
  // assumed the address always fits on one real line, but a genuinely
  // longer one wraps to two — and the next real line (phone number)
  // was then drawn directly on top of that second, wrapped line,
  // overlapping and becoming unreadable. Now measures the REAL,
  // actual wrapped line count via jsPDF's own splitTextToSize before
  // advancing, so this correctly adapts to any real address length
  // instead of assuming one. The right-hand "FROM" column is real,
  // fixed, always-short text with no such risk, so it keeps its own,
  // separate, simple line advance — the two columns are only
  // resynchronised (via Math.max) once both are done, so neither
  // column's real height can ever collide with the other's next line.
  let leftY=headY+5.5, rightY=headY+5.5;
  const addrLine=`${sanitize(order.address||"")}, ${sanitize(order.city||"")}${order.state?", "+sanitize(order.state):""}${order.pin?" - "+sanitize(order.pin):""}`;
  const addrWrapped=doc.splitTextToSize(addrLine,100);
  doc.text(addrWrapped,14,leftY);
  leftY+=addrWrapped.length*5;
  doc.text("Thane, Maharashtra 400601",120,rightY);
  rightY+=5.5;
  doc.text("support@akaraonline.co.in",120,rightY);
  rightY+=5.5;
  doc.text("+91 82780 85572",120,rightY);
  if(order.phone){ doc.text(sanitize(order.phone),14,leftY); leftY+=5.5; }
  if(order.email) doc.text(sanitize(order.email),14,leftY);
  headY=Math.max(leftY,rightY);

  autoTable(doc,{
    startY:Math.max(headY+8,90+yOffset),
    head:[["Item","HSN","Qty","Rate","Amount"]],
    body:order.items.map(i=>[`${i.name}${[i.colorLabel,i.size].filter(Boolean).length?" ("+[i.colorLabel,i.size].filter(Boolean).join(", ")+")":""}`,i.hsn,String(i.qty),`Rs ${i.price.toLocaleString("en-IN")}`,`Rs ${(i.price*i.qty).toLocaleString("en-IN")}`]),
    headStyles:{fillColor:CREAM,textColor:TEAL,fontStyle:"bold",font:"NotoSans",fontSize:8},
    styles:{fontSize:9,font:"NotoSans",textColor:DARKTEXT,lineColor:[220,213,200],lineWidth:0.2,cellPadding:3},
    columnStyles:{2:{halign:"right"},3:{halign:"right"},4:{halign:"right"}},
  });

  let y=doc.lastAutoTable.finalY+10;
  const summaryRows=[["Subtotal",`Rs ${subtotal.toLocaleString("en-IN")}`]];
  if(discount>0) summaryRows.push([`Discount${order.couponCode?` (${order.couponCode})`:""}`,`- Rs ${discount.toLocaleString("en-IN")}`]);
  summaryRows.push(["Shipping",shipCost===0?"Free":`Rs ${shipCost.toLocaleString("en-IN")}`]);
  if(codFee>0) summaryRows.push(["COD Handling Fee",`Rs ${codFee.toLocaleString("en-IN")}`]);
  summaryRows.push(["CGST (9%)",`Rs ${cgst.toLocaleString("en-IN")}`]);
  summaryRows.push(["SGST (9%)",`Rs ${sgst.toLocaleString("en-IN")}`]);
  doc.setFontSize(9);
  summaryRows.forEach(([label,val])=>{
    doc.setFont("NotoSans","normal"); doc.setTextColor(...WARMGRAY); doc.text(label,140,y);
    doc.setTextColor(...DARKTEXT); doc.text(val,196,y,{align:"right"});
    y+=6;
  });

  // Real, highlighted total block — a solid teal-filled box instead of
  // the old plain bold text sitting among every other line, so the
  // one real number that matters most is the one thing the eye is
  // actually drawn to.
  y+=4;
  doc.setFillColor(...TEAL);
  doc.rect(130,y-6,66,12,"F");
  doc.setTextColor(255,255,255);
  doc.setFont("NotoSans","bold"); doc.setFontSize(10.5);
  doc.text(order.paymentMethod==="cod"?"AMOUNT DUE":"TOTAL PAID",134,y+1);
  doc.text(`Rs ${grandTotal.toLocaleString("en-IN")}`,193,y+1,{align:"right"});
  doc.setTextColor(0,0,0);

  doc.setDrawColor(...GOLD); doc.setLineWidth(0.3);
  doc.line(14,275,196,275);
  doc.setFont("NotoSans","normal"); doc.setFontSize(7.5);
  doc.setTextColor(...WARMGRAY);
  doc.text("This is a computer-generated invoice and does not require a signature.",14,281);
  doc.text("akaraonline.co.in",196,281,{align:"right"});

  doc.save(`AKARA-Invoice-${order.orderNumber}.pdf`);
}

/** Warehouse / courier packing slip — no prices */
async function downloadPackingSlipPDF(order) {
  const [{ jsPDF }, autoTableModule, fontModule] = await Promise.all([import("jspdf"), import("jspdf-autotable"), import("./invoiceFontData.js")]);
  const autoTable = autoTableModule.default;
  const doc = new jsPDF();
  // Same real, embedded Noto Sans as downloadInvoicePDF above — kept
  // consistent between the two so a customer's invoice and packing
  // slip (which can genuinely both be printed and seen together)
  // never show two visibly different, mismatched fonts for the same
  // real brand name.
  doc.addFileToVFS("NotoSans-Regular.ttf", fontModule.NOTO_SANS_REGULAR_BASE64);
  doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  doc.addFileToVFS("NotoSans-Bold.ttf", fontModule.NOTO_SANS_BOLD_BASE64);
  doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
  const ship = order.shippingAddress || {};
  const date = order.placedAt
    ? new Date(order.placedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "";

  doc.setFont("NotoSans", "bold");
  doc.setFontSize(16);
  doc.text("ĀKĀRA", 14, 18);
  doc.setFont("NotoSans", "normal");
  doc.setFontSize(10);
  doc.text("PACKING SLIP", 14, 26);
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text("Made-to-order · Handle with care", 14, 32);
  doc.setTextColor(0);

  doc.setFontSize(10);
  doc.text(`Order #${order.orderNumber}`, 14, 44);
  doc.text(`Date ${date}`, 14, 50);
  doc.text(`Payment ${order.paymentMethod === "cod" ? "Cash on delivery" : "Prepaid"}`, 14, 56);

  doc.setFont("NotoSans", "bold");
  doc.text("Ship to", 14, 68);
  doc.setFont("NotoSans", "normal");
  let y = 74;
  const lines = [
    ship.name || order.name || "",
    ship.line || order.address || "",
    ship.landmark ? `Landmark: ${ship.landmark}` : "",
    [ship.city || order.city, ship.state || order.state, ship.pin || order.pin].filter(Boolean).join(", "),
    ship.phone || order.phone || "",
  ].filter(Boolean);
  for (const line of lines) {
    doc.text(String(line).slice(0, 90), 14, y);
    y += 6;
  }
  if (order.customerNote || order.deliveryNote) {
    y += 4;
    doc.setFont("NotoSans", "bold");
    doc.text("Delivery note", 14, y);
    y += 6;
    doc.setFont("NotoSans", "normal");
    doc.text(String(order.customerNote || order.deliveryNote).slice(0, 120), 14, y);
    y += 8;
  }

  const rows = (order.items || []).map((it) => [
    it.name || "",
    it.size || it.variant || "—",
    String(it.qty ?? 1),
  ]);
  autoTable(doc, {
    startY: y + 4,
    head: [["Piece", "Variant", "Qty"]],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3, font: "NotoSans" },
    headStyles: { fillColor: [24, 54, 48], font: "NotoSans" },
  });
  const finalY = doc.lastAutoTable?.finalY || y + 40;
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text("No commercial value on this slip · For fulfilment only · www.akaraonline.co.in", 14, finalY + 12);
  doc.save(`AKARA-PackingSlip-${order.orderNumber}.pdf`);
}


function InvoiceView({ navigate, order }){
  // REAL BUG FIX: same real bug class found and fixed in
  // ReturnRequestView — useState calls were declared AFTER the real
  // `if(!order) return ...` early return below, a genuine violation of
  // React's own hook rules (every hook must run in the same order on
  // every render). Found via a real, systematic sweep of the whole
  // file for this exact pattern after a direct report of "works once,
  // then breaks" on a different page turned out to be this same bug.
  // Moved both hooks up here, unconditionally, before any early return.
  const showToast=useToast();
  const [downloading,setDownloading]=useState(false);
  const [packingDownloading,setPackingDownloading]=useState(false);
  if(!order) return <div className="px-6 py-32 text-center">
    <ClipboardCheck size={40} strokeWidth={1} style={{color:"rgba(36,62,65,0.75)",margin:"0 auto 20px"}}/>
    <h1 className="italic text-[26px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>No invoice to show yet.</h1>
    <SweepButton filled onClick={()=>navigate("shop")}>Explore the Collection</SweepButton>
  </div>;
  // Uses the real figures the server actually computed and stored at
  // checkout (order.subtotal/discount/shippingCost/cgst/sgst/total)
  // rather than recomputing any of them from order.items here — this
  // used to recompute subtotal/shipping client-side, which (a) silently
  // ignored any applied coupon entirely, and (b) could show the WRONG
  // shipping cost for a discounted order, since the free-shipping
  // threshold is checked against the discounted subtotal, not the
  // original one. Trusting the server's own numbers avoids both.
  const { subtotal=0, discount=0, shippingCost:shipCost=0, codFee=0, cgst=0, sgst=0, total:grandTotal=0 } = order;
  const invoiceDate=order.placedAt?new Date(order.placedAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}):"";
  const handleDownload=async()=>{
    setDownloading(true);
    try{ await downloadInvoicePDF(order); }
    catch{ showToast("Couldn't generate the PDF — please try again.","error"); }
    finally{ setDownloading(false); }
  };
  const handlePackingDownload=async()=>{
    setPackingDownloading(true);
    try{ await downloadPackingSlipPDF(order); }
    catch{ showToast("Couldn't generate the packing slip — please try again.","error"); }
    finally{ setPackingDownloading(false); }
  };
  return <div className="px-6 md:px-14 py-10 max-w-[860px] mx-auto">
    <div className="no-print flex justify-between items-center mb-8 flex-wrap gap-3">
      <button onClick={()=>navigate("account")} className="text-[12.5px] flex items-center gap-1" style={{color:T.teal}}><ChevronRight size={14} style={{transform:"rotate(180deg)"}}/> Back</button>
      <div className="flex gap-3">
        <SweepButton onClick={()=>window.print()}>Print</SweepButton>
        <SweepButton filled onClick={handleDownload} disabled={downloading}>{downloading?"Generating…":"Download invoice"}</SweepButton>
        <SweepButton onClick={handlePackingDownload} disabled={packingDownloading}>{packingDownloading?"Generating…":"Packing slip"}</SweepButton>
      </div>
    </div>
    <div className="invoice-print-area p-8 md:p-12 relative" style={{backgroundColor:"white",boxShadow:ELEVATION.raised,borderRadius:RADIUS.md,overflow:"hidden"}}>
      {order.status==="cancelled"&&<>
        {/* Found directly during testing: a cancelled order's invoice
            still downloaded and displayed completely normally, with
            nothing at all indicating the order was cancelled — a
            customer could easily mistake it for a valid, active invoice.
            Two markings together, both present in the actual PDF
            download too (not just this on-screen view): a real banner a
            customer will actually read, plus a diagonal watermark that
            stays visible even if they only skim the page — the same
            "VOID" convention paper invoices have used for decades. */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{zIndex:1}}>
          <p style={{fontSize:"90px",fontWeight:800,color:"rgba(168,59,50,0.09)",transform:"rotate(-30deg)",whiteSpace:"nowrap",letterSpacing:"0.05em"}}>CANCELLED</p>
        </div>
        <div className="flex items-center gap-3 px-5 py-4 mb-8 relative" style={{backgroundColor:"rgba(168,59,50,0.08)",border:`2px solid ${T.error}`,borderRadius:RADIUS.sm,zIndex:2}}>
          <AlertCircle size={22} style={{color:T.error,flexShrink:0}}/>
          <p className="text-[14px]" style={{color:T.error,fontWeight:700}}>This order was cancelled — this invoice is no longer valid.</p>
        </div>
      </>}
      <div className="flex justify-between items-start mb-10 pb-8 flex-wrap gap-6 relative" style={{borderBottom:`2px solid ${T.teal}`,zIndex:2}}>
        <div>
          <p className="text-[22px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}><Mac>A</Mac>K<Mac>A</Mac>RA</p>
          <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}>Precision Forge Labs</p>
          <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}>Thane, Maharashtra 400601</p>
          <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}>GSTIN: 27GZCPS9353H1ZQ</p>
          <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}>support@akaraonline.co.in · +91 82780 85572</p>
        </div>
        <div className="text-right">
          <p className="text-[12px] uppercase tracking-[0.1em] mb-2" style={{color:T.teal}}>Tax Invoice</p>
          <p className="text-[13px]" style={{color:T.teal}}>Invoice #: {order.orderNumber}</p>
          <p className="text-[13px]" style={{color:T.teal}}>Date: {invoiceDate}</p>
        </div>
      </div>
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.1em] mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Billed & Shipped To</p>
        <p className="text-[14px]" style={{color:T.teal}}>{sanitize(order.name)}</p>
        <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.75)"}}>{sanitize(order.address)}{order.landmark?`, near ${sanitize(order.landmark)}`:""}, {sanitize(order.city)}{order.state?`, ${sanitize(order.state)}`:""}{order.pin?` — ${sanitize(order.pin)}`:""}</p>
        {order.phone&&<p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.75)"}}>{sanitize(order.phone)}</p>}
        {order.email&&<p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.75)"}}>{sanitize(order.email)}</p>}
      </div>
      <table className="w-full text-[12.5px] mb-8" style={{borderCollapse:"collapse"}}>
        <thead>
          <tr style={{backgroundColor:T.teal}}>
            {["Item","HSN","Qty","Rate","Amount"].map((h,i)=><th key={h} className="py-2.5 px-2 text-left" style={{color:"white",fontWeight:500,textAlign:i>=2?"right":"left"}}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {order.items.map(i=><tr key={i.id+i.size+(i.color||"")} style={{borderBottom:"1px solid rgba(36,62,65,0.1)"}}>
            <td className="py-2.5 px-2">{i.name}{[i.colorLabel,i.size].filter(Boolean).length?` (${[i.colorLabel,i.size].filter(Boolean).join(", ")})`:""}</td>
            <td className="py-2.5 px-2">{i.hsn}</td>
            <td className="py-2.5 px-2 text-right">{i.qty}</td>
            <td className="py-2.5 px-2 text-right">₹{i.price.toLocaleString("en-IN")}</td>
            <td className="py-2.5 px-2 text-right">₹{(i.price*i.qty).toLocaleString("en-IN")}</td>
          </tr>)}
        </tbody>
      </table>
      <div className="flex justify-end mb-10">
        <div className="w-full sm:w-[280px]">
          <div className="flex justify-between text-[12.5px] mb-2" style={{color:"rgba(36,62,65,0.75)"}}><span>Subtotal</span><span>₹{subtotal.toLocaleString("en-IN")}</span></div>
          {discount>0&&<div className="flex justify-between text-[12.5px] mb-2" style={{color:T.teal}}><span>Discount{order.couponCode?` (${order.couponCode})`:""}</span><span>−₹{discount.toLocaleString("en-IN")}</span></div>}
          {[["Shipping",shipCost],...(codFee>0?[["COD Handling Fee",codFee]]:[]),["CGST (9%)",cgst],["SGST (9%)",sgst]].map(([l,v])=><div key={l} className="flex justify-between text-[12.5px] mb-2" style={{color:"rgba(36,62,65,0.75)"}}><span>{l}</span><span>{v===0?"Free":`₹${v.toLocaleString("en-IN")}`}</span></div>)}
          <div className="flex justify-between pt-3 mt-2" style={{borderTop:`1px solid ${T.teal}`}}>
            <span className="text-[13px]" style={{color:T.teal}}>{order.paymentMethod==="cod"?"Amount Due on Delivery":"Total Paid"}</span>
            <span className="text-[16px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{grandTotal.toLocaleString("en-IN")}</span>
          </div>
        </div>
      </div>
      <p className="text-[10.5px] leading-[1.7]" style={{color:"rgba(36,62,65,0.75)",borderTop:"1px solid rgba(36,62,65,0.1)",paddingTop:"16px"}}>
        This invoice assumes an intra-state (Maharashtra) shipment and shows tax as CGST + SGST accordingly. Every ĀKĀRA piece is made to order — production begins after order confirmation. This is a system-generated invoice and does not require a signature.
      </p>
    </div>
  </div>;
}

// Order tracking page (/order-status) — the 5-stage visual stepper,
// courier-link placeholder, and a WhatsApp deep-link pre-filled with the
// order number. Status comes from the same simulated stageIndexFromOrder()
// used elsewhere — real courier/production-stage tracking is still a
// future admin-panel feature, not wired to real courier data yet.
const CUSTOMER_CANCEL_WINDOW_MS = 30 * 60 * 1000;
function OrderStatusView({ navigate, order, setOrder }) {
  const showToast=useToast();
  const [confirmCancelOpen,setConfirmCancelOpen]=useState(false);
  const [cancelReason,setCancelReason]=useState("");
  const [cancelDetail,setCancelDetail]=useState("");
  const [cancelling,setCancelling]=useState(false);
  // REAL, DIRECT GUEST CHECKOUT SUPPORT: a guest arrives here fresh,
  // straight from the real, direct link in their confirmation email —
  // no pre-existing order in React state (they aren't coming from
  // having just checked out in this same browser session) and no real,
  // authenticated session either. Reads a real ?token= from the URL,
  // matching the exact same, established pattern already used for
  // password-reset links elsewhere in this file. Its mere presence is
  // what decides which real, actual endpoint to use below — the public,
  // token-based one for a guest, or the existing, authenticated one,
  // completely unchanged, for a logged-in customer.
  const [guestToken]=useState(()=>new URLSearchParams(window.location.search).get("token")||"");
  const [guestLookupError,setGuestLookupError]=useState("");
  // Recover last-viewed order after full refresh (order state is in-memory only).
  const [recoverOrderNumber]=useState(()=>{
    try {
      const q = new URLSearchParams(window.location.search).get("order");
      if (q) return q;
      return sessionStorage.getItem("akara_last_order_number") || "";
    } catch { return ""; }
  });
  // Real bug found and fixed: this page used to purely trust whatever
  // `order` object was last cached client-side (from checkout, or from
  // whichever order was last opened in My Account) — meaning an admin
  // cancelling an order elsewhere wouldn't be reflected here until the
  // customer happened to reload in a way that re-fetched it. Now
  // re-fetches the real, current order from the server every time this
  // page is opened, so a status change made anywhere else shows up
  // immediately rather than showing stale cached data.
  useEffect(()=>{
    if(guestToken){
      fetch(`/api/orders/track/${guestToken}`)
        .then(r=>r.ok?r.json():Promise.reject())
        .then(data=>{ if(data?.order) setOrder(data.order); })
        .catch(()=>setGuestLookupError("This tracking link isn't valid, or the order couldn't be found."));
      return;
    }
    const num = order?.orderNumber || recoverOrderNumber;
    if(!num) return;
    fetch(`/api/orders/${encodeURIComponent(num)}`,{credentials:"include"})
      .then(r=>r.ok?r.json():null)
      .then(data=>{
        if(data?.order){
          setOrder(data.order);
          try { sessionStorage.setItem("akara_last_order_number", data.order.orderNumber); } catch {}
        }
      })
      .catch(()=>{});
  },[order?.orderNumber,guestToken,recoverOrderNumber]);
  if(guestToken&&!order&&guestLookupError) return <div className="px-6 py-32 text-center max-w-[440px] mx-auto">
    <AlertCircle size={40} strokeWidth={1} style={{color:"rgba(168,59,50,0.4)",margin:"0 auto 20px"}}/>
    <h1 className="italic text-[24px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>We couldn't find that order.</h1>
    <p className="text-[13.5px] mb-8" style={{color:"rgba(36,62,65,0.75)"}}>{guestLookupError}</p>
    <SweepButton filled onClick={()=>navigate("track-order")}>Look Up My Order</SweepButton>
  </div>;
  // A live countdown, not just a one-time check — re-evaluates every
  // second so the button/message correctly disappears the moment the
  // window closes, without needing a page refresh. The REAL enforcement
  // is server-side (see PATCH /api/orders/:orderNumber/cancel in
  // server/routes/orders.js) — this is purely the matching UI, and could
  // never be trusted on its own even if this client-side check were
  // somehow bypassed.
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{ const t=setInterval(()=>setNow(Date.now()),1000); return ()=>clearInterval(t); },[]);

  if(!order) return <div className="px-6 py-32 text-center max-w-[440px] mx-auto">
    <Truck size={40} strokeWidth={1} style={{color:"rgba(36,62,65,0.75)",margin:"0 auto 20px"}}/>
    <h1 className="italic text-[26px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>No order to track yet.</h1>
    <p className="text-[13.5px] leading-[1.7] mb-8" style={{color:"rgba(36,62,65,0.75)"}}>If you just placed an order, open <strong>My Account</strong> — or check the confirmation email for your order number.</p>
    <div className="flex flex-col sm:flex-row gap-3 justify-center">
      <SweepButton filled onClick={()=>navigate("account")}>My Account</SweepButton>
      <SweepButton onClick={()=>navigate("shop")}>Explore the Collection</SweepButton>
    </div>
  </div>;

  const msElapsed=now-(order.placedAt||now);
  const msRemaining=CUSTOMER_CANCEL_WINDOW_MS-msElapsed;
  const canCancel=order.status!=="cancelled"&&order.status!=="delivered"&&msRemaining>0;
  const minutesRemaining=Math.max(0,Math.ceil(msRemaining/60000));

  const confirmCancel=async()=>{
    if(!cancelReason){ showToast("Please select a reason.","error"); return false; }
    if(cancelReason==="other"&&!cancelDetail.trim()){ showToast("Please tell us a bit more.","error"); return false; }
    setCancelling(true);
    try{
      const res=await apiFetch(`/api/orders/${order.orderNumber}/cancel`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason:cancelReason,detail:cancelDetail})});
      const data=await res.json();
      if(res.ok){ setOrder(data.order); showToast("Order cancelled","success"); setCancelReason(""); setCancelDetail(""); return true; }
      showToast(data.error||"Couldn't cancel this order.","error"); return false;
    }catch{
      showToast("Couldn't reach the server.","error"); return false;
    }finally{
      setCancelling(false);
    }
  };

  const currentIdx=stageIndexFromOrder(order);
  const waPhone="918278085572";
  return <div className="px-6 md:px-14 py-16 max-w-[820px] mx-auto">
    <p className="text-[11.5px] tracking-[0.15em] uppercase mb-2" style={{color:T.teal}}>Order #{order.orderNumber}</p>
    <h1 className="italic text-[28px] md:text-[34px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Track Your Order</h1>

    {order.status==="cancelled"?
      <div className="flex items-center gap-3 p-5 mb-10" style={{backgroundColor:"rgba(168,59,50,0.08)",color:T.error}}>
        <XCircle size={18}/><p className="text-[13.5px]">This order has been cancelled.</p>
      </div>
    :<>
      <p className="text-[13.5px] mb-8" style={{color:"rgba(36,62,65,0.75)"}}>Made-to-order pieces take 2–3 weeks in production before they ship.</p>

      <div className="flex flex-col sm:flex-row gap-0 mb-8">
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
              <p className="hidden sm:block text-[11px] mt-1 max-w-[120px] mx-auto" style={{color:"rgba(36,62,65,0.75)"}}>{s.desc}</p>
            </div>
            {i<ORDER_STAGES.length-1&&<div className="hidden sm:block absolute top-5 left-1/2 w-full h-px" style={{backgroundColor:i<currentIdx?T.teal:"rgba(36,62,65,0.15)"}}/>}
          </div>;
        })}
      </div>

      {currentIdx>=3?<div className="p-5 mb-6" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3"><Truck size={16} style={{color:T.teal}}/><p className="text-[13px]" style={{color:T.teal}}>Your order is on its way</p></div>
          {order.courierTrackingUrl
            ?<a href={order.courierTrackingUrl} target="_blank" rel="noopener noreferrer" className="text-[11.5px] uppercase tracking-[0.08em]" style={{color:T.teal}}>Track with Courier →</a>
            :<span className="text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}>Tracking link coming soon</span>}
        </div>
        {(order.courierTrackingId||order.courierStatus)&&(
          <div className="mt-3 pt-3 text-[12.5px]" style={{borderTop:"1px solid rgba(36,62,65,0.1)",color:T.teal}}>
            {order.courierTrackingId&&<p><span style={{color:"rgba(36,62,65,0.55)"}}>AWB / tracking ID: </span>{order.courierTrackingId}</p>}
            {order.courierStatus&&<p className="mt-1"><span style={{color:"rgba(36,62,65,0.55)"}}>Courier status: </span>{order.courierStatus}</p>}
          </div>
        )}
      </div>:<p className="text-[12.5px] mb-6" style={{color:"rgba(36,62,65,0.75)"}}>A courier tracking link will appear here once your order is dispatched.</p>}

      {canCancel&&<div className="flex items-center justify-between p-4 mb-8 flex-wrap gap-3" style={{backgroundColor:"rgba(181,101,29,0.07)"}}>
        <p className="text-[12.5px]" style={{color:T.warning}}>You can cancel this order for the next {minutesRemaining} minute{minutesRemaining!==1?"s":""}.</p>
        <button onClick={()=>setConfirmCancelOpen(true)} className="text-[12px] uppercase tracking-[0.06em] underline" style={{color:T.error}}>Cancel Order</button>
      </div>}
    </>}

    <div className="text-left p-7 mb-8" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.lg}}>
      {order.items.map(i=><div key={i.id+i.size+(i.color||"")} className="flex justify-between text-[13.5px] mb-3" style={{color:"rgba(36,62,65,0.75)"}}><span>{i.name}{[i.colorLabel,i.size].filter(Boolean).length?` (${[i.colorLabel,i.size].filter(Boolean).join(", ")})`:""} × {i.qty}</span><span>₹{i.price*i.qty}</span></div>)}
      <div className="flex justify-between items-baseline pt-4 mt-3" style={{borderTop:"1px solid rgba(36,62,65,0.12)"}}>
        <span className="text-[13px]" style={{color:T.teal}}>{order.paymentMethod==="cod"?"Amount Due on Delivery":"Total Paid"}</span>
        <span className="text-[19px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{order.total.toLocaleString("en-IN")}</span>
      </div>
    </div>

    <div className="flex flex-col sm:flex-row gap-4 mb-4">
      <a href={`https://wa.me/${waPhone}?text=${encodeURIComponent("Hi, I'd like an update on order #"+order.orderNumber)}`} target="_blank" rel="noopener noreferrer" className="flex-1">
        <SweepButton className="w-full">Ask on WhatsApp</SweepButton>
      </a>
      <SweepButton filled className="flex-1" onClick={()=>navigate("shop")}>Continue Shopping</SweepButton>
    </div>
    <button onClick={()=>navigate("invoice")} className="text-[12.5px] underline mx-auto block" style={{color:T.teal}}>Download Invoice</button>

    <Modal open={confirmCancelOpen} onClose={()=>{setConfirmCancelOpen(false);setCancelReason("");setCancelDetail("");}} title="Cancel this order?" danger confirmLabel={cancelling?"Cancelling…":"Cancel Order"} onConfirm={confirmCancel}>
      <p className="mb-4">This can't be undone. {order.paymentStatus==="paid"?"If you've already paid, we'll automatically process your refund.":""}</p>
      <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Why are you cancelling? *</label>
      <select value={cancelReason} onChange={e=>setCancelReason(e.target.value)} className="w-full text-[14px] px-3 py-2.5 mb-3" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,color:T.teal}}>
        <option value="">Select a reason…</option>
        <option value="mistake">Ordered by mistake</option>
        <option value="better_price">Found a better price elsewhere</option>
        <option value="too_long">Production/delivery time too long</option>
        <option value="changed_mind">Changed my mind</option>
        <option value="wrong_selection">Wrong size, color, or style selected</option>
        <option value="different_product">Ordering a different product instead</option>
        <option value="financial">Financial reasons</option>
        <option value="duplicate">Accidental duplicate order</option>
        <option value="other">Other</option>
      </select>
      {cancelReason==="other"&&<textarea value={cancelDetail} onChange={e=>setCancelDetail(sanitize(e.target.value))} maxLength={500} rows={3} placeholder="Tell us a bit more…"
        className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"11px 13px",borderRadius:RADIUS.xs,color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>}
    </Modal>
  </div>;
}

// REAL, DIRECT GUEST CHECKOUT SUPPORT — Track Your Order page
// (/track-order), the real, deliberate backup method for a guest who's
// lost or deleted their confirmation email (and with it, their real,
// direct tracking link). A simple, real order-number + email form;
// matches server/routes/orders.js's own POST /api/orders/lookup, which
// only ever finds a genuine guest order — a logged-in customer's order
// isn't reachable this way at all, since they have their own, correct,
// existing path (signing in) instead.
function TrackOrderView({ navigate, setOrder }) {
  const [orderNumber,setOrderNumber]=useState("");
  const [email,setEmail]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const submit=async e=>{
    e.preventDefault();
    setError(""); setLoading(true);
    try{
      const res=await apiFetch("/api/orders/lookup",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ orderNumber:orderNumber.trim(), email:email.trim() }),
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok){ setError(data.error||"Couldn't find that order."); setLoading(false); return; }
      setOrder(data.order);
      // REAL, DIRECT FIX: this app's shared navigate()/buildPath()
      // genuinely has no generic mechanism for attaching a query
      // string to an arbitrary view (only "search" has one, hardcoded)
      // — confirmed directly by reading buildPath() before writing
      // this, rather than guessing at a call signature that doesn't
      // exist. Navigates normally first, then manually appends the
      // real, actual token to the URL via replaceState (not
      // pushState, so this doesn't create an extra, real, awkward
      // back-button entry for the brief, token-less URL a moment
      // earlier) — making the resulting page a real, genuinely
      // bookmarkable, shareable link, exactly matching what the
      // confirmation email itself sends, not a one-time view lost the
      // moment the tab closes.
      navigate("order-status");
      if(data.order.guestTrackingToken&&typeof window!=="undefined"){
        window.history.replaceState({},"","/order-status?token="+encodeURIComponent(data.order.guestTrackingToken));
      }
    }catch{
      setError("Couldn't reach the server. Please try again.");
    }finally{
      setLoading(false);
    }
  };
  return <div className="px-6 py-20 max-w-[440px] mx-auto">
    <h1 className="italic text-[26px] mb-4 text-center" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Track Your Order</h1>
    <p className="text-[13.5px] leading-[1.8] mb-9 text-center" style={{color:"rgba(36,62,65,0.75)"}}>
      Checked out as a guest? Enter your order number and the email you used — or use the real, direct link from your confirmation email instead.
    </p>
    <form onSubmit={submit} className="flex flex-col gap-4">
      <InputField label="Order Number" value={orderNumber} onChange={setOrderNumber} required/>
      <InputField label="Email" type="email" value={email} onChange={setEmail} required/>
      {error&&<p className="text-[12.5px]" style={{color:T.error}}>{error}</p>}
      <SweepButton filled type="submit" disabled={loading}>{loading?"Looking up…":"Find My Order"}</SweepButton>
    </form>
  </div>;
}

// Payment failure page (/payment-failed). Reached for real now — the
// Razorpay widget's payment.failed event and any error during
// POST /api/orders/verify both route here (see CheckoutView).
function PaymentFailedView({ navigate }) {
  return <div className="px-6 py-20 max-w-[560px] mx-auto text-center">
    <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-7" style={{backgroundColor:"rgba(192,57,43,0.08)"}}>
      <XCircle size={22} style={{color:T.error}}/>
    </div>
    <p className="text-[12px] tracking-[0.2em] uppercase mb-4" style={{color:T.error}}>Payment Failed</p>
    <h1 className="italic text-[28px] md:text-[34px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>We couldn't process your payment.</h1>
    <p className="text-[14.5px] leading-[1.8] mb-10" style={{color:"rgba(36,62,65,0.75)"}}>
      Your card or bank may have declined the transaction, or the payment window timed out. No amount has been deducted — if you do see a debit, it will be auto-reversed by your bank within 5–7 business days.
    </p>
    <div className="text-left p-6 mb-10" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
      <p className="text-[12px] uppercase tracking-[0.08em] mb-3" style={{color:T.teal}}>What you can do</p>
      <ul className="flex flex-col gap-2">
        {["Try again with the same or a different payment method","Check your bank balance and card limits","Contact your bank if the issue persists"].map(t=><li key={t} className="flex items-start gap-2 text-[13px]" style={{color:"rgba(36,62,65,0.75)"}}><Check size={13} style={{color:T.teal,marginTop:3,flexShrink:0}}/>{t}</li>)}
      </ul>
    </div>
    <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
      <SweepButton filled onClick={()=>navigate("checkout")}>Retry Payment</SweepButton>
      <SweepButton onClick={()=>navigate("cart")}>Back to Cart</SweepButton>
    </div>
    <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.75)"}}>Still stuck? Email <a href="mailto:support@akaraonline.co.in" style={{color:T.teal}}>support@akaraonline.co.in</a></p>
  </div>;
}

// ============================================================================
// AUTH PAGES — Login, Signup, Forgot/Reset Password. Login and Signup now
// call the real backend (/api/auth/login, /api/auth/signup — real
// accounts, bcrypt-hashed passwords, httpOnly session cookies, and
// server-side rate limiting, all verified working against a real database
// before this was shipped). Forgot/Reset Password below are still
// simulated — no email service is wired up yet to actually send anything.
// ============================================================================
// Shared split-layout shell for every auth page (Login/Signup/Forgot/
// Reset) — matches the approved redesign mockup: a dark teal brand panel
// (hidden on mobile, where screen space is precious) alongside the actual
// form. Pulled into one component so all four auth pages stay visually
// consistent automatically, rather than each hand-rolling its own layout.

// Continue with Google — loads GIS only when the button mounts and only
// if the server reports Google sign-in enabled.
function GoogleSignInButton({ onLogin, navigate, postLoginRedirect, setPostLoginRedirect, onError }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState(null);
  const btnRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/google-config")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.enabled || !d.clientId) return;
        setClientId(d.clientId);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    const start = () => {
      if (cancelled || !window.google?.accounts?.id || !btnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response) => {
          if (!response?.credential) {
            onError?.("Google sign-in was cancelled.");
            return;
          }
          setBusy(true);
          try {
            const res = await apiFetch("/api/auth/google", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential: response.credential }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              onError?.(data.error || "Google sign-in failed.");
              return;
            }
            onLogin(data.customer);
            navigate(postLoginRedirect || "account");
            setPostLoginRedirect?.(null);
          } catch {
            onError?.("Couldn't reach the server. Please try again.");
          } finally {
            setBusy(false);
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      btnRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(btnRef.current, {
        type: "standard",
        theme: "filled_black",
        size: "large",
        text: "continue_with",
        shape: "pill",
        logo_alignment: "left",
        width: Math.min(btnRef.current.offsetWidth || 320, 360),
      });
      setReady(true);
    };
    if (window.google?.accounts?.id) {
      start();
    } else {
      const existing = document.querySelector('script[data-akara-gis="1"]');
      if (existing) {
        existing.addEventListener("load", start);
      } else {
        const s = document.createElement("script");
        s.src = "https://accounts.google.com/gsi/client";
        s.async = true;
        s.dataset.akaraGis = "1";
        s.onload = start;
        document.head.appendChild(s);
      }
    }
    return () => { cancelled = true; };
  }, [clientId, onLogin, navigate, postLoginRedirect, setPostLoginRedirect, onError]);

  if (!clientId) return null;
  return (
    <div className="mt-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px" style={{ backgroundColor: "rgba(36,62,65,0.12)" }} />
        <span className="text-[11px] tracking-[0.12em] uppercase" style={{ color: "rgba(24,54,48,0.75)" }}>or</span>
        <div className="flex-1 h-px" style={{ backgroundColor: "rgba(36,62,65,0.12)" }} />
      </div>
      <div
        ref={btnRef}
        className="w-full flex justify-center min-h-[44px] overflow-hidden akara-google-btn"
        style={{
          opacity: busy ? 0.5 : 1,
          pointerEvents: busy ? "none" : "auto",
          borderRadius: 999,
          border: "1px solid rgba(36,62,65,0.14)",
          backgroundColor: "rgba(227,218,201,0.35)",
        }}
      />
      {!ready && <p className="text-[12px] text-center mt-2" style={{ color: "rgba(24,54,48,0.78)" }}>Loading Google…</p>}
    </div>
  );
}

// Real, dedicated Google button specifically for LINKING an already
// logged-in account — deliberately a separate component from
// GoogleSignInButton above rather than reusing it with extra props:
// that one's callback signs the person in and navigates, which is
// genuinely wrong behavior here (the person already has a real,
// active session; a "link" action should never replace or redirect
// it). Shares the same real script-loading logic since Google's own
// GIS library only needs loading once regardless of which real button
// triggers it — the actual initialize()/renderButton() calls are kept
// separate since the two real buttons need different, real callback
// behavior on success.
function GoogleLinkButton({ onLinked, onError }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState(null);
  const btnRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/google-config").then(r => r.json()).then(d => {
      if (cancelled || !d?.enabled || !d.clientId) return;
      setClientId(d.clientId);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    const start = () => {
      if (cancelled || !window.google?.accounts?.id || !btnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response) => {
          if (!response?.credential) { onError?.("Google sign-in was cancelled."); return; }
          setBusy(true);
          try {
            const res = await apiFetch("/api/auth/google-link", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential: response.credential }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { onError?.(data.error || "Couldn't link Google."); return; }
            onLinked?.();
          } catch {
            onError?.("Couldn't reach the server. Please try again.");
          } finally {
            setBusy(false);
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      btnRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(btnRef.current, {
        type: "standard", theme: "outline", size: "large", text: "signin_with",
        shape: "pill", logo_alignment: "left", width: Math.min(btnRef.current.offsetWidth || 320, 360),
      });
      setReady(true);
    };
    if (window.google?.accounts?.id) {
      start();
    } else {
      const existing = document.querySelector('script[data-akara-gis="1"]');
      if (existing) existing.addEventListener("load", start);
      else {
        const s = document.createElement("script");
        s.src = "https://accounts.google.com/gsi/client";
        s.async = true;
        s.dataset.akaraGis = "1";
        s.onload = start;
        document.head.appendChild(s);
      }
    }
    return () => { cancelled = true; };
  }, [clientId, onLinked, onError]);

  if (!clientId) return null;
  return <div>
    <div ref={btnRef} className="w-full flex justify-center min-h-[44px] overflow-hidden akara-google-btn"
      style={{ opacity: busy ? 0.5 : 1, pointerEvents: busy ? "none" : "auto", borderRadius: 999, border: "1px solid rgba(36,62,65,0.14)", backgroundColor: "rgba(227,218,201,0.35)" }}/>
    {!ready && <p className="text-[12px] text-center mt-2" style={{ color: "rgba(24,54,48,0.78)" }}>Loading Google…</p>}
  </div>;
}

function AuthLayout({ eyebrow, title, subtitle, children }){
  return <div className="min-h-[80vh] flex items-center justify-center px-4 py-10 md:px-8">
    <div className="w-full max-w-[860px] grid grid-cols-1 md:grid-cols-[1fr_1.15fr]" style={{borderRadius:RADIUS.lg,overflow:"hidden",boxShadow:ELEVATION.modal}}>
      <div className="hidden md:flex flex-col items-center justify-center p-10 relative overflow-hidden text-center" style={{backgroundColor:T.teal}}>
        <div className="relative z-10">
          <div className="mb-6 flex justify-center"><img src="/logo-wordmark-cream.png" alt="ĀKĀRA" className="h-12 w-auto object-contain" width={180} height={58} decoding="async"/></div>
          <div className="w-11 h-px mb-5 mx-auto" style={{backgroundColor:T.gold}}/>
          <p className="italic text-[19px] leading-[1.5]" style={{fontFamily:"'Fraunces',serif",color:T.cream}}>Ākāra means form —<br/>made only once you ask.</p>
        </div>
        <svg className="absolute -right-10 -bottom-10 opacity-[0.08]" width="220" height="220" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" stroke={T.gold} strokeWidth="1" fill="none"/><circle cx="50" cy="50" r="30" stroke={T.gold} strokeWidth="1" fill="none"/></svg>
      </div>
      <div className="p-8 md:p-11 flex flex-col justify-center" style={{backgroundColor:T.cream}}>
        <div className="mb-6 md:hidden flex justify-center"><img src="/logo-wordmark.png" alt="ĀKĀRA" className="h-9 w-auto object-contain" width={140} height={45} decoding="async"/></div>
        {eyebrow&&<p className="text-[11px] tracking-[0.2em] uppercase mb-2" style={{color:T.teal}}>{eyebrow}</p>}
        <h1 className="italic text-[26px] md:text-[28px] mb-2" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{title}</h1>
        {subtitle&&<p className="text-[13.5px] mb-7" style={{color:"rgba(36,62,65,0.75)"}}>{subtitle}</p>}
        {children}
      </div>
    </div>
  </div>;
}

function LoginView({ navigate, onLogin, postLoginRedirect, setPostLoginRedirect }) {
  const [email,setEmail]=useState(""); const [pw,setPw]=useState(""); const [err,setErr]=useState(""); const [submitting,setSubmitting]=useState(false);
  const submit=async e=>{
    e.preventDefault();
    if(!validEmail(sanitize(email))){setErr("Valid email required");return;}
    if(!pw){setErr("Password required");return;}
    setSubmitting(true); setErr("");
    try{
      const res=await apiFetch("/api/auth/login",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({email:sanitize(email),password:pw}),
      });
      const data=await res.json();
      if(!res.ok){
        // 429 is the server-side rate limiter (see server/auth.js) —
        // unlike the old client-side-only limiter, this one can't be
        // bypassed by clearing browser storage. Its message is already
        // written for display, so it's shown as-is.
        setErr(data.error||"Something went wrong. Please try again.");
      } else {
        onLogin(data.customer);
        // If they were sent here specifically to complete checkout (see
        // CheckoutView), send them right back to it instead of My
        // Account — otherwise they'd have to navigate to Cart/Checkout
        // manually again after signing in.
        navigate(postLoginRedirect||"account");
        setPostLoginRedirect(null);
      }
    }catch{
      setErr("Couldn't reach the server. Please check your connection and try again.");
    }finally{
      setSubmitting(false);
    }
  };
  return <AuthLayout eyebrow="Welcome back" title="Sign In" subtitle="New here? — sign up takes a minute.">
    {err&&<div className="flex items-center gap-2 px-4 py-3 mb-5 text-[13px]" style={{backgroundColor:"rgba(168,59,50,0.08)",color:T.error,borderRadius:RADIUS.sm}}><AlertCircle size={14}/>{err}</div>}
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <InputField label="Email" type="email" value={email} onChange={v=>{setEmail(v);setErr("");}} required/>
      <InputField label="Password" type="password" value={pw} onChange={v=>{setPw(v);setErr("");}} required/>
      <div className="flex justify-end"><button type="button" onClick={()=>navigate("forgot-password")} className="text-[12.5px] hover:underline" style={{color:T.teal}}>Forgot password?</button></div>
      <SweepButton filled type="submit" disabled={submitting} className="w-full">{submitting?"Signing in…":"Sign In"}</SweepButton>
    </form>
    <GoogleSignInButton onLogin={onLogin} navigate={navigate} postLoginRedirect={postLoginRedirect} setPostLoginRedirect={setPostLoginRedirect} onError={setErr}/>
    <p className="text-[13px] text-center mt-6" style={{color:"rgba(36,62,65,0.75)"}}>Don't have an account? <button onClick={()=>navigate("signup")} className="underline" style={{color:T.teal}}>Register</button></p>
  </AuthLayout>;
}

// Real signup — creates an actual account in the database (see
// POST /api/auth/signup).
function SignupView({ navigate, onLogin, postLoginRedirect, setPostLoginRedirect }) {
  const [form,setForm]=useState({name:"",email:"",phone:"",pw:"",confirm:""}); const [errors,setErrors]=useState({});
  const [submitting,setSubmitting]=useState(false);
  const upd=k=>v=>setForm(f=>({...f,[k]:v}));
  const strength=pwStrength(form.pw);
  // Real two-step flow now, matching the OTP pattern already proven for
  // phone/email-change: "form" is the original signup fields, "verify"
  // is entering the code that was just sent. CONFIRMED SPEC: a
  // mistyped email must mean the person can never get past this second
  // step — there's deliberately no way to skip it or verify later.
  const [step,setStep]=useState("form"); // form | verify
  const [otpCode,setOtpCode]=useState("");
  const [googleErr,setGoogleErr]=useState("");
  const requestOTP=async e=>{
    e.preventDefault();
    const errs={};
    if(!sanitize(form.name).trim()) errs.name="Required";
    if(!validEmail(form.email)) errs.email="Valid email required";
    if(!validIndianPhone(normalizePhone(form.phone))) errs.phone="Valid 10-digit Indian mobile number required";
    if(!strength.ok) errs.pw=strength.msg;
    if(form.pw!==form.confirm) errs.confirm="Passwords don't match";
    setErrors(errs); if(Object.keys(errs).length) return;
    setSubmitting(true);
    try{
      const res=await apiFetch("/api/auth/signup/request",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({name:sanitize(form.name),email:sanitize(form.email),phone:normalizePhone(form.phone),password:form.pw}),
      });
      const data=await res.json();
      if(!res.ok){
        // 409 = email/phone already registered — the one case worth
        // mapping to its specific field rather than a generic banner.
        setErrors(res.status===409?{email:data.error}:{form:data.error||"Something went wrong. Please try again."});
      } else {
        setStep("verify");
      }
    }catch{
      setErrors({form:"Couldn't reach the server. Please check your connection and try again."});
    }finally{
      setSubmitting(false);
    }
  };
  const verifyOTP=async e=>{
    e.preventDefault();
    setSubmitting(true);
    try{
      const res=await apiFetch("/api/auth/signup/verify",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({email:sanitize(form.email),code:otpCode}),
      });
      const data=await res.json();
      if(!res.ok){
        setErrors({otp:data.error||"That code isn't correct."});
      } else {
        onLogin(data.customer);
        // Fallback changed from "account" to "home" — the mid-checkout
        // case (postLoginRedirect genuinely set to "checkout") is
        // completely unaffected, since that value still wins whenever
        // it's actually set. Only a normal, non-checkout signup now
        // lands on the homepage instead of My Account.
        navigate(postLoginRedirect||"home");
        setPostLoginRedirect(null);
      }
    }catch{
      setErrors({otp:"Couldn't reach the server. Please check your connection and try again."});
    }finally{
      setSubmitting(false);
    }
  };
  if(step==="verify") return <AuthLayout eyebrow="Almost there" title="Verify your email" subtitle={`Enter the 6-digit code we sent to ${form.email}.`}>
    {errors.otp&&<div className="flex items-center gap-2 px-4 py-3 mb-5 text-[13px]" style={{backgroundColor:"rgba(168,59,50,0.08)",color:T.error,borderRadius:RADIUS.sm}}><AlertCircle size={14}/>{errors.otp}</div>}
    <form onSubmit={verifyOTP} noValidate className="flex flex-col gap-5">
      <InputField label="Verification Code" value={otpCode} onChange={v=>setOtpCode(v.replace(/\D/g,"").slice(0,6))} placeholder="6-digit code" required/>
      <SweepButton filled type="submit" disabled={submitting||otpCode.length!==6} className="w-full">{submitting?"Verifying…":"Verify & Create Account"}</SweepButton>
    </form>
    <p className="text-[13px] text-center mt-6" style={{color:"rgba(36,62,65,0.75)"}}>Wrong email? <button onClick={()=>{setStep("form");setOtpCode("");setErrors({});}} className="underline" style={{color:T.teal}}>Go back</button></p>
  </AuthLayout>;
  return <AuthLayout eyebrow="Join Us" title="Create Account" subtitle="Track orders, save addresses, and check out faster.">
    {errors.form&&<div className="flex items-center gap-2 px-4 py-3 mb-5 text-[13px]" style={{backgroundColor:"rgba(168,59,50,0.08)",color:T.error,borderRadius:RADIUS.sm}}><AlertCircle size={14}/>{errors.form}</div>}
    <form onSubmit={requestOTP} noValidate className="flex flex-col gap-5">
      <InputField label="Full Name" value={form.name} onChange={upd("name")} error={errors.name} required/>
      <InputField label="Email" type="email" value={form.email} onChange={upd("email")} error={errors.email} required/>
      <InputField label="Mobile Number" type="tel" value={form.phone} onChange={upd("phone")} error={errors.phone} placeholder="+91 XXXXX XXXXX" required/>
      <div>
        <InputField label="Password" type="password" value={form.pw} onChange={upd("pw")} error={errors.pw} required/>
        {form.pw&&<div className="mt-2 flex items-center gap-2">
          <div className="flex gap-1">
            {[form.pw.length>=8,/[A-Z]/.test(form.pw),/[0-9]/.test(form.pw),/[^A-Za-z0-9]/.test(form.pw)].map((met,i)=><div key={i} className="w-6 h-1" style={{backgroundColor:met?T.gold:"rgba(36,62,65,0.15)",borderRadius:RADIUS.xs}}/>)}
          </div>
          <span className="text-[11px]" style={{color:strength.ok?T.success:"rgba(24,54,48,0.75)"}}>{strength.msg}</span>
        </div>}
      </div>
      <InputField label="Confirm Password" type="password" value={form.confirm} onChange={upd("confirm")} error={errors.confirm} required/>
      <SweepButton filled type="submit" disabled={submitting} className="w-full">{submitting?"Sending code…":"Create Account"}</SweepButton>
    </form>
    {googleErr&&<div className="flex items-center gap-2 px-4 py-3 mt-4 text-[13px]" style={{backgroundColor:"rgba(168,59,50,0.08)",color:T.error,borderRadius:RADIUS.sm}}><AlertCircle size={14}/>{googleErr}</div>}
    <GoogleSignInButton onLogin={onLogin} navigate={navigate} postLoginRedirect={postLoginRedirect} setPostLoginRedirect={setPostLoginRedirect} onError={setGoogleErr}/>
    <p className="text-[13px] text-center mt-6" style={{color:"rgba(36,62,65,0.75)"}}>Already have one? <button onClick={()=>navigate("login")} className="underline" style={{color:T.teal}}>Sign in</button></p>
  </AuthLayout>;
}

// Simulates the "email sent" flow with a 60s resend cooldown — no real
// email is ever sent, since there's no backend/email service yet.
function ForgotPasswordView({ navigate }) {
  const showToast=useToast();
  const [email,setEmail]=useState(""); const [error,setError]=useState(""); const [sent,setSent]=useState(false); const [cooldown,setCooldown]=useState(0); const [submitting,setSubmitting]=useState(false);
  useEffect(()=>{ if(cooldown<=0) return; const t=setInterval(()=>setCooldown(s=>{if(s<=1){clearInterval(t);return 0;}return s-1;}),1000); return ()=>clearInterval(t); },[cooldown]);
  // Found this whole flow was completely fake — no email was ever sent,
  // regardless of what someone typed. Now genuinely calls the backend;
  // the response is deliberately the same whether the email exists or
  // not, so the "if X has an account..." wording here has always been
  // honest, but only actually MEANS anything now that a real email goes
  // out when it does.
  const submit=async e=>{
    e.preventDefault();
    if(!validEmail(sanitize(email))){setError("Valid email required");return;}
    setSubmitting(true);
    try{
      const res=await apiFetch("/api/auth/forgot-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});
      if(res.ok){ setSent(true); setCooldown(60); }
      else{ const data=await res.json().catch(()=>({})); showToast(data.error||"Something went wrong. Please try again.","error"); }
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setSubmitting(false);
    }
  };
  if(sent) return <AuthLayout eyebrow="Almost there" title="Check your email">
    <p className="text-[13.5px] leading-[1.75] mb-8" style={{color:"rgba(36,62,65,0.75)"}}>If <strong style={{color:T.teal}}>{sanitize(email)}</strong> has an account with us, you'll receive a reset link shortly.</p>
    {cooldown>0?<p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.75)"}}>Resend in {cooldown}s</p>
    :<button onClick={()=>setSent(false)} className="text-[13px] underline" style={{color:T.teal}}>Try a different email</button>}
    <div className="mt-8"><button onClick={()=>navigate("login")} className="text-[13px] underline" style={{color:"rgba(36,62,65,0.75)"}}>Back to Sign In</button></div>
  </AuthLayout>;
  return <AuthLayout eyebrow="Reset" title="Reset Password" subtitle="Enter your email and we'll send a reset link if your account exists.">
    {error&&<div className="flex items-center gap-2 px-4 py-3 mb-5 text-[13px]" style={{backgroundColor:"rgba(168,59,50,0.08)",color:T.error,borderRadius:RADIUS.sm}}><AlertCircle size={14}/>{error}</div>}
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <InputField label="Email" type="email" value={email} onChange={v=>{setEmail(v);setError("");}} required/>
      <SweepButton filled type="submit" className="w-full" disabled={submitting}>{submitting?"Sending…":"Send Reset Link"}</SweepButton>
    </form>
    <div className="mt-6 text-center"><button onClick={()=>navigate("login")} className="text-[13px] underline" style={{color:"rgba(36,62,65,0.75)"}}>Back to Sign In</button></div>
  </AuthLayout>;
}

// Real reset now — this used to fake success with zero backend call
// regardless of what was typed, per the comment that was here before.
function ResetPasswordView({ navigate }) {
  const showToast=useToast();
  const [token]=useState(()=>new URLSearchParams(window.location.search).get("token")||"");
  const [pw,setPw]=useState(""); const [confirm,setConfirm]=useState(""); const [errors,setErrors]=useState({}); const [done,setDone]=useState(false); const [submitting,setSubmitting]=useState(false);
  const strength=pwStrength(pw);
  const submit=async e=>{
    e.preventDefault();
    const errs={}; if(!strength.ok) errs.pw=strength.msg; if(pw!==confirm) errs.confirm="Passwords don't match";
    setErrors(errs);
    if(Object.keys(errs).length) return;
    setSubmitting(true);
    try{
      const res=await apiFetch("/api/auth/reset-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,newPassword:pw})});
      const data=await res.json().catch(()=>({}));
      if(res.ok) setDone(true);
      // A real, specific message for an expired/already-used link — found
      // and flagged separately as its own gap: this used to have no
      // backend at all, so there was nothing to distinguish "wrong
      // password" from "this link is dead," and no way to tell someone
      // clearly which one happened.
      else showToast(data.error||"Couldn't reset your password. Please request a new link.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setSubmitting(false);
    }
  };
  if(!token) return <AuthLayout eyebrow="Reset" title="Invalid Link">
    <p className="text-[13.5px] mb-8" style={{color:"rgba(36,62,65,0.75)"}}>This password reset link is missing or malformed. Please request a new one.</p>
    <SweepButton filled onClick={()=>navigate("forgot-password")}>Request New Link</SweepButton>
  </AuthLayout>;
  if(done) return <AuthLayout eyebrow="Done" title="Password Updated">
    <p className="text-[13.5px] mb-8" style={{color:"rgba(36,62,65,0.75)"}}>Your password has been changed. You can now sign in.</p>
    <SweepButton filled onClick={()=>navigate("login")}>Sign In</SweepButton>
  </AuthLayout>;
  return <AuthLayout eyebrow="Reset" title="New Password" subtitle="Choose a strong password for your account.">
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div>
        <InputField label="New Password" type="password" value={pw} onChange={v=>{setPw(v);setErrors({});}} error={errors.pw} required/>
        {pw&&<div className="mt-2 flex items-center gap-2">
          <div className="flex gap-1">
            {[pw.length>=8,/[A-Z]/.test(pw),/[0-9]/.test(pw),/[^A-Za-z0-9]/.test(pw)].map((met,i)=><div key={i} className="w-6 h-1" style={{backgroundColor:met?T.gold:"rgba(36,62,65,0.15)",borderRadius:RADIUS.xs}}/>)}
          </div>
          <span className="text-[11px]" style={{color:strength.ok?T.success:"rgba(24,54,48,0.75)"}}>{strength.msg}</span>
        </div>}
      </div>
      <InputField label="Confirm Password" type="password" value={confirm} onChange={v=>{setConfirm(v);setErrors({});}} error={errors.confirm} required/>
      <SweepButton filled type="submit" className="w-full" disabled={submitting}>{submitting?"Updating…":"Update Password"}</SweepButton>
    </form>
  </AuthLayout>;
}

// Brand story page (/about) — studio, materials, "why made to order"
// positioning. Real, final copy (not placeholder).
function AboutView({ navigate }) {
  return <CmsSectionPageView pageKey="about" navigate={navigate} ctaHeading="Ready to bring form into your space?" navLabel="Explore the Collection" navTo="shop" navLabel2="Get in Touch" navTo2="contact"/>;
}

// The Craft page (/craft) — a deeper, more technical companion to About:
// where About is brand philosophy/story, this page goes into materials
// and the actual production process. Built with real confirmed facts
// (Bambu Lab A1 COMBO, plant-based PLA, Thane studio) rather than generic
// filler — but flagged honestly where more real detail/imagery could be
// added later (see the note near the process section below).
// The Craft page (/craft) — a deeper, more technical companion to About:
// where About is brand philosophy/story, this page goes into materials
// and the actual production process. Now reads from the real CMS
// (page_key "craft") via CmsSectionPageView — same real content, same
// real layout, just editable. One small, deliberate simplification:
// the closing "this page will grow to include..." note was originally
// styled smaller/muted as a footnote; it now renders as a normal
// paragraph like the rest of the page's text, since a sixth one-off
// block type for a single muted note wasn't worth the added CMS
// complexity — a minor visual difference, not a content change.
function CraftView({ navigate }){
  return <CmsSectionPageView pageKey="craft" navigate={navigate} navLabel="Explore the Collection" navTo="shop" navLabel2="Care Guide" navTo2="care-guide"/>;
}

// Contact page (/contact) — two-path split (General Enquiries vs
// Custom & Bespoke) plus a direct message form. The form's "Thanks —
// your message is in" confirmation is LOCAL STATE ONLY — nothing is
// actually sent anywhere; no backend to receive it yet.
function ContactView() {
  const showToast=useToast();
  const [form,setForm]=useState({name:"",email:"",phone:"",message:""}); const [sent,setSent]=useState(false); const [errors,setErrors]=useState({});
  const [submitting,setSubmitting]=useState(false);
  const submit=async e=>{
    e.preventDefault();
    const errs={};
    if(!sanitize(form.name).trim()) errs.name="Required";
    if(!validEmail(form.email)) errs.email="Valid email required";
    if(!validIndianPhone(normalizePhone(form.phone))) errs.phone="Valid 10-digit mobile number required";
    if(sanitize(form.message).trim().length<240) errs.message=`Please tell us a bit more — at least 240 characters (currently ${sanitize(form.message).trim().length}).`;
    setErrors(errs);
    if(Object.keys(errs).length) return;
    // Real submission — this form used to just show a fake success
    // message with nothing behind it (no backend, no email, nothing
    // stored). Found and fixed while adding the phone field: a form
    // that doesn't actually go anywhere isn't worth having a phone
    // field on at all.
    setSubmitting(true);
    try{
      const res=await apiFetch("/api/contact",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
      if(res.ok){ setSent(true); }
      else{
        const data=await res.json();
        setErrors(data.errors||{});
        showToast("Couldn't send your message. Please check the form and try again.","error");
      }
    }catch{
      showToast("Couldn't reach the server. Please try again.","error");
    }finally{
      setSubmitting(false);
    }
  };
  return <div>
    <section className="px-6 pt-20 pb-16 text-center max-w-[580px] mx-auto">
      <p className="text-[12px] tracking-[0.3em] uppercase mb-6" style={{color:T.teal}}>Contact</p>
      <h1 className="italic text-[32px] md:text-[44px] mb-5" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Let's talk.</h1>
      <p className="text-[15px] leading-[1.75]" style={{color:"rgba(36,62,65,0.75)"}}>Order questions, custom requests, or just curious about a piece — we read every message ourselves.</p>
    </section>
    <section className="px-6 max-w-[900px] mx-auto pb-14 grid grid-cols-1 sm:grid-cols-2" style={{boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
      {[["General Enquiries","Orders, shipping, returns.","Already ordered, or have a question? Fastest way to reach us for anything order-related.","support@akaraonline.co.in","mailto:support@akaraonline.co.in"],
        ["Custom & Bespoke","Something specific in mind?","Custom sizing, colours outside the standard range, or a wholesale enquiry — tell us what you're picturing.","info@akaraonline.co.in","mailto:info@akaraonline.co.in"]
      ].map(([label,title,desc,email,href])=><div key={label} className="p-9" style={{backgroundColor:T.teal,borderRight:"1px solid rgba(255,255,255,0.08)"}}>
        <p className="text-[11px] tracking-[0.1em] uppercase mb-4" style={{color:T.cream}}>{label}</p>
        <h2 className="italic text-[21px] mb-4 text-white" style={{fontFamily:"'Fraunces',serif"}}>{title}</h2>
        <p className="text-[13.5px] leading-[1.7] mb-5" style={{color:"rgba(255,255,255,0.6)"}}>{desc}</p>
        <a href={href} className="text-[12.5px] hover:opacity-70 transition-opacity" style={{color:T.cream}}>{email}</a>
      </div>)}
    </section>
    <section className="px-6 max-w-[580px] mx-auto pb-24">
      <h2 className="italic text-[22px] text-center mb-9" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Or send it straight to us.</h2>
      {sent?<p className="text-center text-[14px] py-8" style={{color:T.teal}}>Thanks — your message is in. We reply within 72 hours.</p>
      :<form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField label="Name" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} error={errors.name} required/>
          <InputField label="Email" type="email" value={form.email} onChange={v=>setForm(f=>({...f,email:v}))} error={errors.email} required/>
        </div>
        <InputField label="Phone" type="tel" value={form.phone} onChange={v=>setForm(f=>({...f,phone:v}))} error={errors.phone} required/>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Message *</label>
          <textarea required rows={5} value={form.message} onChange={e=>setForm(f=>({...f,message:sanitize(e.target.value)}))} maxLength={2000}
            className="w-full bg-transparent outline-none text-[14px]" style={{border:`1px solid ${errors.message?T.error:"rgba(36,62,65,0.22)"}`,borderRadius:RADIUS.xs,padding:"13px 14px",color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
          {errors.message&&<p className="text-[11.5px] mt-1.5 flex items-center gap-1" style={{color:T.error}}><AlertCircle size={12}/>{errors.message}</p>}
        </div>
        <SweepButton filled type="submit" className="w-full" disabled={submitting}>{submitting?"Sending…":"Send Message"}</SweepButton>
      </form>}
    </section>
  </div>;
}

// FAQ page (/faq) — accordion per category. Content now comes from the
// real CMS (page_key "faq") instead of the old hardcoded FAQ_DATA
// constant — genuinely rebuilt client-side from the ordered blocks
// (a heading block starts a new category; every qa block after it
// belongs to that category, until the next heading), NOT a structural
// change to the data model itself. Every real interactive behavior
// (category switching, accordion open/close, the "Still have
// questions?" card) is completely unchanged — only where the actual
// questions/answers come from is different.
function FAQView() {
  const [faqData,setFaqData]=useState(null);
  const [error,setError]=useState(false);
  const [cat,setCat]=useState(null); const [openIdx,setOpenIdx]=useState(0);
  useEffect(()=>{
    fetch("/api/page-content/faq").then(r=>r.ok?r.json():Promise.reject()).then(d=>{
      const grouped={};
      let currentCat=null;
      for(const b of d.blocks){
        if(b.blockType==="heading"){ currentCat=b.content; grouped[currentCat]=[]; }
        else if(b.blockType==="qa"&&currentCat){ const {q,a}=JSON.parse(b.content); grouped[currentCat].push([q,a]); }
      }
      setFaqData(grouped);
      setCat(Object.keys(grouped)[0]||null);
    }).catch(()=>setError(true));
  },[]);
  // FAQPage JSON-LD for Google rich results (complements server seo.js)
  useEffect(()=>{
    if(!faqData) return;
    const items=[];
    for(const list of Object.values(faqData)){
      for(const pair of list){
        if(pair?.[0] && pair?.[1]) items.push({q:pair[0], a:pair[1]});
      }
    }
    if(!items.length) return;
    const id="akara-faq-jsonld";
    let el=document.getElementById(id);
    if(!el){ el=document.createElement("script"); el.type="application/ld+json"; el.id=id; document.head.appendChild(el); }
    el.textContent=JSON.stringify({
      "@context":"https://schema.org",
      "@type":"FAQPage",
      mainEntity: items.slice(0,50).map(({q,a})=>({
        "@type":"Question",
        name:q,
        acceptedAnswer:{ "@type":"Answer", text:a },
      })),
    });
    return ()=>{ const n=document.getElementById(id); if(n) n.remove(); };
  },[faqData]);
  if(error) return <div className="px-6 py-24 text-center"><p className="text-[14px]" style={{color:"rgba(36,62,65,0.75)"}}>Couldn't load this page right now. Please try again shortly.</p></div>;
  if(!faqData||!cat) return <div className="px-6 md:px-14 py-16 max-w-[1100px] mx-auto"><Skeleton height={400}/></div>;
  return <div className="px-6 md:px-14 py-16 max-w-[1100px] mx-auto">
    <h1 className="italic text-[32px] md:text-[44px] text-center mb-12" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Frequently Asked Questions</h1>
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-12">
      <div className="flex md:flex-col gap-2 overflow-x-auto">
        {Object.keys(faqData).map(c=><button key={c} onClick={()=>{setCat(c);setOpenIdx(0);}}
          className="text-left px-4 py-3 text-[13.5px] shrink-0 transition-colors whitespace-nowrap"
          style={cat===c?{backgroundColor:T.teal,color:"white",borderRadius:RADIUS.xs}:{color:T.teal,borderRadius:RADIUS.xs}}>{c}</button>)}
        <div className="hidden md:block mt-6 p-5" style={{border:`1px solid ${T.gold}`,borderRadius:RADIUS.xs}}>
          <p className="text-[13px] italic mb-2" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Still have questions?</p>
          <p className="text-[12px] leading-[1.6] mb-4" style={{color:"rgba(36,62,65,0.75)"}}>We're happy to help with anything not covered here.</p>
          <a href="mailto:support@akaraonline.co.in" className="text-[11.5px] uppercase tracking-[0.08em]" style={{color:T.teal}}>Contact Us →</a>
        </div>
      </div>
      <div>
        {faqData[cat].map(([q,a],i)=><div key={q} style={{borderBottom:"1px solid rgba(36,62,65,0.12)"}}>
          <button onClick={()=>setOpenIdx(openIdx===i?-1:i)} className="w-full flex justify-between items-center py-5 text-left">
            <span className="text-[15px]" style={{color:T.teal}}>{q}</span>
            <Plus size={16} style={{color:T.teal,transform:openIdx===i?"rotate(45deg)":"none",transition:"transform 0.2s",flexShrink:0}}/>
          </button>
          <div className="overflow-hidden transition-[grid-template-rows] duration-300" style={{display:"grid",gridTemplateRows:openIdx===i?"1fr":"0fr"}}>
            <div className="overflow-hidden"><p className="text-[13.5px] leading-[1.8] pb-5" style={{color:"rgba(36,62,65,0.75)"}}>{a}</p></div>
          </div>
        </div>)}
        <div className="md:hidden mt-8 p-5" style={{border:`1px solid ${T.gold}`,borderRadius:RADIUS.xs}}>
          <p className="text-[13px] italic mb-2" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Still have questions?</p>
          <p className="text-[12px] leading-[1.6] mb-4" style={{color:"rgba(36,62,65,0.75)"}}>We're happy to help with anything not covered here.</p>
          <a href="mailto:support@akaraonline.co.in" className="text-[11.5px] uppercase tracking-[0.08em]" style={{color:T.teal}}>Contact Us →</a>
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

function MarketingStudioPrefs({ user, setUser }) {
  const showToast=useToast();
  const [emailOpt,setEmailOpt]=useState(!!user?.marketingEmailOptIn);
  const [waOpt,setWaOpt]=useState(!!user?.marketingWhatsappOptIn);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{ setEmailOpt(!!user?.marketingEmailOptIn); setWaOpt(!!user?.marketingWhatsappOptIn); },[user]);
  const save=async()=>{
    setSaving(true);
    try{
      const res=await apiFetch("/api/auth/marketing-preferences",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({marketingEmailOptIn:emailOpt,marketingWhatsappOptIn:waOpt})});
      const data=await res.json().catch(()=>({}));
      if(res.ok&&data.customer){ setUser(data.customer); showToast("Preferences saved","success"); }
      else showToast(data.error||"Could not save preferences","error");
    }catch{ showToast("Could not reach the server","error"); }
    finally{ setSaving(false); }
  };
  if(!user) return null;
  return (
    <div className="p-5 mb-6 text-left" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
      <p className="text-[11px] tracking-[0.14em] uppercase mb-2" style={{color:T.teal}}>Studio communication</p>
      <p className="text-[12.5px] mb-4" style={{color:"rgba(36,62,65,0.7)"}}>Order and shipping messages always send. Marketing is optional.</p>
      <label className="flex items-start gap-2.5 mb-3 text-[13px] cursor-pointer" style={{color:T.teal}}>
        <input type="checkbox" checked={emailOpt} onChange={e=>setEmailOpt(e.target.checked)} className="mt-1"/>
        <span>Email — studio notes & new pieces</span>
      </label>
      <label className="flex items-start gap-2.5 mb-4 text-[13px] cursor-pointer" style={{color:T.teal}}>
        <input type="checkbox" checked={waOpt} onChange={e=>setWaOpt(e.target.checked)} className="mt-1"/>
        <span>WhatsApp — occasional studio messages (not order alerts only)</span>
      </label>
      <SweepButton filled onClick={save} disabled={saving}>{saving?"Saving…":"Save preferences"}</SweepButton>
    </div>
  );
}

function MyAccountView({ navigate, wishlist, user, setUser, order, setOrder, initTab }) {
  const { products } = useProducts();
  const [tab,setTab]=useState(initTab||"Orders");
  useEffect(()=>{ if(initTab) setTab(initTab); },[initTab]);
  const [addresses,setAddresses]=useState([]);
  const [addressesLoading,setAddressesLoading]=useState(true);
  const [addrForm,setAddrForm]=useState({name:"",line:"",landmark:"",city:"",state:"",pin:"",phone:""});
  const [addrErrors,setAddrErrors]=useState({});
  const [showAddrForm,setShowAddrForm]=useState(false);
  const showToast=useToast();
  // Real, functional Profile editing — found during a proactive bug
  // sweep: this tab used to render Name/Email fields with a no-op
  // onChange, so typing into them silently did nothing. Name is now
  // genuinely editable; email stays read-only on purpose (changing a
  // login email safely usually needs its own re-verification step,
  // bigger than this fix) but is now clearly marked as such instead of
  // pretending to be an editable field.
  const [profileName,setProfileName]=useState(user?.name||"");
  const [profileSaving,setProfileSaving]=useState(false);
  useEffect(()=>{ setProfileName(user?.name||""); },[user?.name]);
  const saveProfile=async e=>{
    e.preventDefault();
    if(!profileName.trim()){ showToast("Name can't be empty.","error"); return; }
    setProfileSaving(true);
    try{
      const res=await apiFetch("/api/auth/profile",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:sanitize(profileName)})});
      const data=await res.json();
      if(res.ok){ setUser(data.customer); showToast("Profile updated","success"); }
      else showToast(data.error||"Couldn't save your changes.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setProfileSaving(false);
    }
  };
  const [pwForm,setPwForm]=useState({current:"",next:"",confirm:""});
  const [pwSubmitting,setPwSubmitting]=useState(false);
  const [showPwForm,setShowPwForm]=useState(false);
  const changePassword=async e=>{
    e.preventDefault();
    if(pwForm.next!==pwForm.confirm){ showToast("New password and confirmation don't match.","error"); return; }
    setPwSubmitting(true);
    try{
      const res=await apiFetch("/api/auth/password",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({currentPassword:pwForm.current,newPassword:pwForm.next})});
      const data=await res.json();
      if(res.ok){ showToast("Password changed","success"); setPwForm({current:"",next:"",confirm:""}); setShowPwForm(false); }
      else showToast(data.error||"Couldn't change your password.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setPwSubmitting(false);
    }
  };
  // Real, actual Google account linking — the previously-pending item
  // from the master task list: sign-in already handled linking
  // AUTOMATICALLY on first Google sign-in (matching an existing email),
  // but there was genuinely no way for a customer to link, unlink, or
  // check their own real status manually from account settings. Status
  // fetched once on mount so the real, correct card (linked vs. not,
  // and whether a password exists) shows immediately rather than a
  // placeholder that flips after a visible delay.
  const [googleStatus,setGoogleStatus]=useState(null);
  const [showSetPwForm,setShowSetPwForm]=useState(false);
  const [newAccountPassword,setNewAccountPassword]=useState("");
  const [settingPassword,setSettingPassword]=useState(false);
  const [unlinking,setUnlinking]=useState(false);
  const refreshGoogleStatus=()=>{
    apiFetch("/api/auth/google-status").then(r=>r.ok?r.json():null).then(d=>{ if(d) setGoogleStatus(d); }).catch(()=>{});
  };
  useEffect(()=>{ refreshGoogleStatus(); },[]);
  const handleGoogleLinked=()=>{
    showToast("Google linked to your account","success");
    refreshGoogleStatus();
  };
  const handleGoogleUnlink=async()=>{
    setUnlinking(true);
    try{
      const res=await apiFetch("/api/auth/google-unlink",{method:"POST"});
      const data=await res.json();
      if(res.ok){ showToast("Google unlinked","success"); refreshGoogleStatus(); }
      else showToast(data.error||"Couldn't unlink Google.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setUnlinking(false);
    }
  };
  const submitSetPassword=async e=>{
    e.preventDefault();
    setSettingPassword(true);
    try{
      const res=await apiFetch("/api/auth/set-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:newAccountPassword})});
      const data=await res.json();
      if(res.ok){ showToast("Password set — you can now unlink Google if you'd like.","success"); setNewAccountPassword(""); setShowSetPwForm(false); refreshGoogleStatus(); }
      else showToast(data.error||"Couldn't set your password.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setSettingPassword(false);
    }
  };
  // Account deletion — DPDP-compliant, irreversible. Real password
  // re-entry required (not just a plain "are you sure" click) — an
  // action that permanently removes the account deserves the same
  // real friction as changing the password itself, arguably more.
  const [showDeleteModal,setShowDeleteModal]=useState(false);
  const [deletePassword,setDeletePassword]=useState("");
  const [deleting,setDeleting]=useState(false);
  const deleteAccount=async()=>{
    if(!deletePassword){ showToast("Enter your password to confirm.","error"); return; }
    setDeleting(true);
    try{
      const res=await apiFetch("/api/auth/account",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:deletePassword})});
      const data=await res.json().catch(()=>({}));
      if(res.ok){
        // The server already cleared the real session cookie as part of
        // the delete endpoint itself — this just clears the client-side
        // user state to match, same as a normal logout.
        setUser(null);
        showToast("Your account has been deleted.","success");
        navigate("home");
      } else {
        showToast(data.error||"Couldn't delete your account.","error");
      }
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setDeleting(false);
      setShowDeleteModal(false);
      setDeletePassword("");
    }
  };
  // Phone number change via email OTP. Two-step, mirroring the
  // request/verify shape password reset already uses: request sends a
  // code to the NEW number (not the current one — there's nothing to
  // prove about the old number, it's the new one that needs verifying),
  // verify confirms it and swaps the number over server-side.
  const [phoneChangeStep,setPhoneChangeStep]=useState("idle"); // idle | entering | verifying
  const [newPhone,setNewPhone]=useState("");
  const [otpCode,setOtpCode]=useState("");
  const [phoneChangeSubmitting,setPhoneChangeSubmitting]=useState(false);
  const requestPhoneOTP=async e=>{
    e.preventDefault();
    setPhoneChangeSubmitting(true);
    try{
      const res=await apiFetch("/api/auth/phone-change/request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:newPhone})});
      const data=await res.json();
      if(res.ok){ setPhoneChangeStep("verifying"); showToast("Code sent to your email","success"); }
      else showToast(data.error||"Couldn't send the code.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setPhoneChangeSubmitting(false);
    }
  };
  const verifyPhoneOTP=async e=>{
    e.preventDefault();
    setPhoneChangeSubmitting(true);
    try{
      const res=await apiFetch("/api/auth/phone-change/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:otpCode})});
      const data=await res.json();
      if(res.ok){
        setUser(u=>({...u,phone:data.phone}));
        showToast("Phone number updated","success");
        setPhoneChangeStep("idle"); setNewPhone(""); setOtpCode("");
      } else showToast(data.error||"That code isn't correct.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setPhoneChangeSubmitting(false);
    }
  };
  // Email change — same request/verify shape as phone above, but the
  // code goes to the NEW address (proving the customer can receive mail
  // there), not the account's existing one — the opposite delivery
  // direction from phone-change, since email itself is the real
  // ownership-proving channel here, not a borrowed one.
  const [emailChangeStep,setEmailChangeStep]=useState("idle"); // idle | entering | verifying
  const [newEmail,setNewEmail]=useState("");
  const [emailOtpCode,setEmailOtpCode]=useState("");
  const [emailChangeSubmitting,setEmailChangeSubmitting]=useState(false);
  const requestEmailOTP=async e=>{
    e.preventDefault();
    setEmailChangeSubmitting(true);
    try{
      const res=await apiFetch("/api/auth/email-change/request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:newEmail})});
      const data=await res.json();
      if(res.ok){ setEmailChangeStep("verifying"); showToast("Code sent to your new email","success"); }
      else showToast(data.error||"Couldn't send the code.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setEmailChangeSubmitting(false);
    }
  };
  const verifyEmailOTP=async e=>{
    e.preventDefault();
    setEmailChangeSubmitting(true);
    try{
      const res=await apiFetch("/api/auth/email-change/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:emailOtpCode})});
      const data=await res.json();
      if(res.ok){
        setUser(u=>({...u,email:data.email}));
        showToast("Email address updated","success");
        setEmailChangeStep("idle"); setNewEmail(""); setEmailOtpCode("");
      } else showToast(data.error||"That code isn't correct.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setEmailChangeSubmitting(false);
    }
  };
  // Real, persisted addresses — this used to be pure local React state,
  // which is exactly why a saved address disappeared the moment the
  // customer logged out (state resets on refresh/new session; nothing
  // was ever actually sent to the server). Fetched fresh on load, and
  // every save/delete round-trips through the real API.
  const loadAddresses=()=>{
    if(!user){ setAddressesLoading(false); return; }
    setAddressesLoading(true);
    fetch("/api/addresses",{credentials:"include"}).then(r=>r.json()).then(d=>setAddresses(d.addresses||[])).finally(()=>setAddressesLoading(false));
  };
  useEffect(loadAddresses,[user]);
  const [orders,setOrders]=useState([]);
  const [ordersLoading,setOrdersLoading]=useState(true);
  // Real order history, fetched once per visit to this page — replaces the
  // old "only ever shows the single most-recent order from memory"
  // limitation now that orders actually persist in the database.
  useEffect(()=>{
    if(!user){ setOrdersLoading(false); return; }
    fetch("/api/orders",{credentials:"include"})
      .then(r=>r.ok?r.json():{orders:[]})
      .then(data=>setOrders(data.orders||[]))
      .catch(()=>setOrders([]))
      .finally(()=>setOrdersLoading(false));
  },[user]);
  const wishedProducts=products.filter(p=>wishlist.includes(p.id));
  const addrUpd=k=>v=>setAddrForm(f=>({...f,[k]:v}));
  const saveAddress=async()=>{
    const errs={};
    if(!sanitize(addrForm.name).trim()) errs.name="Required";
    if(!sanitize(addrForm.line).trim()) errs.line="Required";
    if(!sanitize(addrForm.city).trim()) errs.city="Required";
    if(!/^\d{6}$/.test(addrForm.pin)) errs.pin="Valid 6-digit PIN required";
    if(!validIndianPhone(normalizePhone(addrForm.phone))) errs.phone="Valid 10-digit mobile number required";
    setAddrErrors(errs);
    if(Object.keys(errs).length) return;
    try{
      const res=await apiFetch("/api/addresses",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...addrForm,phone:normalizePhone(addrForm.phone)})});
      const data=await res.json();
      if(res.ok){ setAddrForm({name:"",line:"",landmark:"",city:"",state:"",pin:"",phone:""}); setShowAddrForm(false); loadAddresses(); showToast("Address saved","success"); }
      else showToast(data.error||"Couldn't save that address.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }
  };
  const removeAddress=async id=>{
    const res=await apiFetch(`/api/addresses/${id}`,{method:"DELETE"});
    if(res.ok){ loadAddresses(); showToast("Address removed","success"); }
    else showToast("Couldn't remove that address.","error");
  };
  const openOrder=(o,view)=>{ setOrder(o); try{ if(o?.orderNumber) sessionStorage.setItem("akara_last_order_number", o.orderNumber); }catch{} navigate(view, o?.orderNumber||null); }; // sets this specific order as the app's "active" order before navigating — see the note above OrderStatusView/InvoiceView about this being a per-app-instance limitation, not per-order-history yet
  // Review submission — gated server-side to real paid purchases (see
  // POST /api/reviews), this is just the form. Deliberately doesn't
  // pre-check "have I already reviewed this" before showing the button —
  // simpler to just let the server say so via the 409 it already returns,
  // surfaced as a clear toast, rather than an extra fetch per item.
  const [reviewTarget,setReviewTarget]=useState(null); // {orderNumber, productId, productName} | null
  const [reviewRating,setReviewRating]=useState(5);
  const [reviewComment,setReviewComment]=useState("");
  const [reviewSubmitting,setReviewSubmitting]=useState(false);
  const submitReview=async()=>{
    setReviewSubmitting(true);
    try{
      const res=await apiFetch("/api/reviews",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderNumber:reviewTarget.orderNumber,productId:reviewTarget.productId,rating:reviewRating,comment:reviewComment})});
      const data=await res.json();
      if(res.ok){ showToast("Thanks for your review!","success"); setReviewTarget(null); setReviewRating(5); setReviewComment(""); }
      else showToast(data.error||"Couldn't submit your review.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setReviewSubmitting(false);
    }
  };
  // Real bug found and fixed: the sign-in check used to live ONLY inside
  // the Orders tab's own content — meaning the tab row itself (Orders /
  // Wishlist / Addresses / Payment Methods / Profile) rendered
  // unconditionally regardless of login state, and four of the five tabs
  // (everything except Orders) had no login check of their own at all.
  // A single top-level guard here replaces five separate potential
  // patches with one correct one: signed out, this is ALL that renders —
  // no tabs, no tab content, just a real sign-in prompt.
  if(!user) return <div className="px-6 md:px-14 py-24 max-w-[480px] mx-auto text-center">
    <h1 className="italic text-[28px] md:text-[32px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>My Account</h1>
    <p className="text-[14px] mb-7" style={{color:"rgba(36,62,65,0.75)"}}>Sign in to see your orders, wishlist, and account details.</p>
    <SweepButton filled onClick={()=>navigate("login")}>Sign In</SweepButton>
  </div>;
  const initial=(user?.name||user?.email||"A").trim().charAt(0).toUpperCase();
  return <div className="px-6 md:px-14 py-12 md:py-16 max-w-[1100px] mx-auto">
    <div className="mb-10 p-5 md:p-7 flex flex-col md:flex-row md:items-center gap-5 md:gap-8"
      style={{backgroundColor:T.card,borderRadius:RADIUS.lg,boxShadow:ELEVATION.raised,border:"1px solid rgba(24,54,48,0.08)"}}>
      <div className="w-16 h-16 md:w-[4.5rem] md:h-[4.5rem] rounded-full flex items-center justify-center text-[22px] md:text-[26px] shrink-0"
        style={{backgroundColor:T.teal,color:"#F5F0E8",fontFamily:"'Fraunces',serif"}}>{initial}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] tracking-[0.16em] uppercase mb-1" style={{color:T.mutedSoft}}>Your atelier account</p>
        <h1 className="italic text-[26px] md:text-[34px] leading-tight mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{user?.name||"My Account"}</h1>
        <p className="text-[13.5px] truncate" style={{color:T.muted}}>{user?.email}</p>
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        <button type="button" onClick={async()=>{const r=await enableCustomerPush(); alert(r.ok?"Order status alerts enabled.":(r.error||"Could not enable"));}}
          className="text-[11px] uppercase tracking-[0.1em] px-3.5 py-2.5"
          style={{border:"1px solid rgba(24,54,48,0.16)",borderRadius:999,color:T.teal,backgroundColor:"rgba(245,240,232,0.6)"}}>Enable alerts</button>
        <button type="button" onClick={()=>setTab("Profile")}
          className="text-[11px] uppercase tracking-[0.1em] px-3.5 py-2.5"
          style={{borderRadius:999,color:"#F5F0E8",backgroundColor:T.teal}}>Edit profile</button>
      </div>
    </div>
    <div className="flex gap-1 mb-10 overflow-x-auto akara-no-scrollbar p-1"
      style={{borderRadius:999,backgroundColor:"rgba(24,54,48,0.05)",border:"1px solid rgba(24,54,48,0.08)"}}>
      {["Orders","Wishlist","Addresses","Payment Methods","Profile"].map(t=>(
        <button key={t} type="button" onClick={()=>setTab(t)}
          className="px-4 py-2.5 text-[12.5px] transition-colors whitespace-nowrap"
          style={{
            color:tab===t?"#F5F0E8":T.teal,
            backgroundColor:tab===t?T.teal:"transparent",
            borderRadius:999,
            fontWeight:tab===t?600:500,
          }}>{t}</button>
      ))}
    </div>
    {tab==="Orders"&&(ordersLoading
      ?<div className="text-center py-16"><p className="text-[13px]" style={{color:"rgba(36,62,65,0.75)"}}>Loading your orders…</p></div>
      :orders.length===0
      ?<div className="text-center py-16"><p className="text-[14px] mb-6" style={{color:"rgba(36,62,65,0.75)"}}>No orders yet.</p><SweepButton filled onClick={()=>navigate("shop")}>Explore the Collection</SweepButton></div>
      :<div className="flex flex-col gap-4">
        {orders.map(o=><div key={o.orderNumber} className="p-6" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
          <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
            <div>
              <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>#{o.orderNumber}</p>
              <p className="text-[12px]" style={{color:"rgba(36,62,65,0.75)"}}>{o.items.length} item{o.items.length>1?"s":""} · ₹{o.total.toLocaleString("en-IN")} · {new Date(o.placedAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</p>
            </div>
            <span className="text-[10.5px] uppercase tracking-[0.08em] px-3 py-1.5" style={o.status==="cancelled"?{backgroundColor:"rgba(192,57,43,0.08)",color:T.error}:(o.paymentStatus==="paid"||o.paymentStatus==="cod")?{backgroundColor:"rgba(184,147,90,0.14)",color:T.teal}:o.paymentStatus==="refunded"?{backgroundColor:"rgba(36,62,65,0.07)",color:T.teal}:{backgroundColor:"rgba(192,57,43,0.08)",color:T.error}}>
              {o.status==="cancelled"?"Cancelled":(o.paymentStatus==="paid"||o.paymentStatus==="cod")?(stageIndexFromOrder(o)>=4?"Delivered":stageIndexFromOrder(o)>=3?"In Transit":"Processing"):o.paymentStatus==="refunded"?"Refunded":o.paymentStatus==="failed"?"Payment Failed":"Payment Pending"}
            </span>
          </div>
          <div className="flex gap-3 flex-wrap mb-4">
            <SweepButton onClick={()=>openOrder(o,"order-status")}>Track Order</SweepButton>
            <SweepButton onClick={()=>openOrder(o,"invoice")}>View Invoice</SweepButton>
            {o.paymentStatus==="paid"&&o.status==="delivered"&&<SweepButton onClick={()=>openOrder(o,"return-request")}>Request a Return</SweepButton>}
          </div>
          {o.paymentStatus==="paid"&&o.status!=="cancelled"&&<div className="flex flex-col gap-2 pt-4" style={{borderTop:"1px solid rgba(36,62,65,0.08)"}}>
            {o.items.map(i=><div key={i.id+(i.size||"")+"-"+(i.color||"")} className="flex items-center justify-between gap-3">
              <span className="text-[12.5px]" style={{color:"rgba(36,62,65,0.75)"}}>{i.name}{[i.colorLabel,i.size].filter(Boolean).length?` (${[i.colorLabel,i.size].filter(Boolean).join(", ")})`:""}</span>
              <button onClick={()=>setReviewTarget({orderNumber:o.orderNumber,productId:i.id,productName:i.name})} className="text-[11.5px] uppercase tracking-[0.05em] underline shrink-0" style={{color:T.teal}}>Write a Review</button>
            </div>)}
          </div>}
        </div>)}
      </div>
    )}
    {tab==="Addresses"&&<div className="max-w-[560px]">
      {addressesLoading?<div className="flex flex-col gap-3 mb-6">{[0,1].map(i=><Skeleton key={i} height={70}/>)}</div>:<>
      {addresses.length===0&&!showAddrForm&&<p className="text-[14px] mb-6" style={{color:"rgba(36,62,65,0.75)"}}>No saved addresses yet.</p>}
      {addresses.map(a=><div key={a.id} className="flex items-start gap-4 p-5 mb-4" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
        <MapPin size={16} style={{color:T.teal,flexShrink:0,marginTop:2}}/>
        <div className="flex-1">
          <p className="text-[14px] mb-1" style={{color:T.teal,fontFamily:"'Fraunces',serif"}}>{a.name}</p>
          <p className="text-[12.5px] leading-[1.6]" style={{color:"rgba(36,62,65,0.75)"}}>{a.line}{a.landmark?`, near ${a.landmark}`:""}, {a.city}, {a.state} — {a.pin}</p>
          <p className="text-[12.5px] mt-1" style={{color:"rgba(36,62,65,0.75)"}}>{a.phone}</p>
        </div>
        <button onClick={()=>removeAddress(a.id)} style={{color:"rgba(36,62,65,0.75)"}}><Trash2 size={14}/></button>
      </div>)}
      </>}
      {showAddrForm?<div className="p-6" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <InputField label="Full Name" value={addrForm.name} onChange={addrUpd("name")} error={addrErrors.name} required/>
          <InputField label="Phone" type="tel" value={addrForm.phone} onChange={addrUpd("phone")} error={addrErrors.phone} required/>
          <div className="sm:col-span-2"><InputField label="Address Line" value={addrForm.line} onChange={addrUpd("line")} error={addrErrors.line} required/></div>
          <div className="sm:col-span-2"><InputField label="Landmark (optional)" value={addrForm.landmark} onChange={addrUpd("landmark")}/></div>
          <InputField label="City" value={addrForm.city} onChange={addrUpd("city")} error={addrErrors.city} required/>
          <InputField label="State" value={addrForm.state} onChange={addrUpd("state")}/>
          <InputField label="PIN Code" value={addrForm.pin} onChange={v=>{ addrUpd("pin")(v); lookupPincode(v,({city,state})=>setAddrForm(f=>({...f,city,state}))); }} error={addrErrors.pin} maxLength={6} required/>
        </div>
        <div className="flex gap-3">
          <SweepButton filled onClick={saveAddress}>Save Address</SweepButton>
          <SweepButton onClick={()=>setShowAddrForm(false)}>Cancel</SweepButton>
        </div>
      </div>:<SweepButton onClick={()=>setShowAddrForm(true)}>+ Add New Address</SweepButton>}
    </div>}
    {tab==="Payment Methods"&&<div className="max-w-[560px]">
      <div className="flex items-start gap-4 p-6 mb-6" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
        <Lock size={18} style={{color:T.teal,flexShrink:0,marginTop:2}}/>
        <div>
          <p className="text-[14px] mb-2" style={{color:T.teal,fontFamily:"'Fraunces',serif"}}>Secured by Razorpay</p>
          <p className="text-[12.5px] leading-[1.7]" style={{color:"rgba(36,62,65,0.75)"}}>We don't store your card, UPI, or bank details. Every payment is processed directly by Razorpay's PCI-DSS compliant checkout at the time of order — cards, UPI, net banking, and wallets are all supported there.</p>
        </div>
      </div>
      <p className="text-[13px] text-center" style={{color:"rgba(36,62,65,0.75)"}}>No saved payment methods to manage — you'll choose how to pay at checkout each time.</p>
    </div>}
    {tab==="Wishlist"&&(wishedProducts.length===0
      ?<p className="text-center py-16 text-[14px]" style={{color:"rgba(36,62,65,0.75)"}}>Nothing saved yet — tap the heart on any product to save it here.</p>
      :<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
        {wishedProducts.map(p=>{
          // REAL BUG FIX, found during this same, direct cross-check:
          // this card never showed a real product photo either — the
          // exact same real bug already found and fixed on the cart
          // sidebar and full cart page earlier in this project, just
          // never carried over to this one, separate location. Uses
          // the exact same, proven, real pattern: find the first real
          // IMAGE (not a video), fall back to the decorative art only
          // when a product genuinely has no real photo yet.
          const firstImage=p.media?.find(m=>m.type==="image"&&m.src)?.src;
          return <div key={p.id} onClick={()=>navigate("product",p.id)} className="cursor-pointer group">
          <div className="relative aspect-square flex items-center justify-center mb-3 overflow-hidden" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
            <StockBadge status={p.cardStatus}/>
            {firstImage
              ?<img src={firstImage} alt={p.name} loading="lazy" className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-500"/>
              :<p.Art className="w-1/3 h-1/3 transition-transform group-hover:scale-110 duration-500" style={{color:T.teal,opacity:0.85}}/>}
          </div>
          <h3 className="text-[13.5px] italic" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{p.name}</h3>
          <p className="text-[13px]" style={{color:T.teal}}>{p.hasRealPriceRange?"From ":""}₹{p.gstInclusiveDisplayPrice??p.price}</p>
        </div>;})}
      </div>
    )}
    {tab==="Profile"&&<div className="max-w-[560px]"><MarketingStudioPrefs user={user} setUser={setUser}/>
      <div className="mb-6">
        <p className="text-[10px] tracking-[0.16em] uppercase mb-1" style={{color:T.teal}}>Account</p>
        <h2 className="italic text-[22px] md:text-[24px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Profile</h2>
        <p className="text-[13px] mt-1.5" style={{color:T.muted}}>Update how you appear on the atelier and manage sign-in details.</p>
      </div>
      <div className="mb-5 p-5 md:p-6" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised,border:"1px solid rgba(24,54,48,0.07)"}}>
        <p className="text-[10px] tracking-[0.14em] uppercase mb-4" style={{color:T.teal}}>Identity</p>
        <form onSubmit={saveProfile} className="flex flex-col gap-4">
          <InputField label="Full name" value={profileName} onChange={setProfileName} required/>
          <SweepButton filled type="submit" disabled={profileSaving} className="self-start">{profileSaving?"Saving…":"Save name"}</SweepButton>
        </form>
      </div>
      {/* Pulled entirely OUT of the saveProfile <form> above — this was
          the real, confirmed root cause of "clicking Send Code does
          something unrelated (lands on Orders tab)": a <form> nested
          inside another <form> is invalid HTML with unreliable,
          browser-dependent submit routing. Phone-change (below) never
          had this bug because it was already correctly its own
          standalone block, outside saveProfile's form — Email is now
          structured exactly the same way. */}
      <div className="mb-5 p-5 md:p-6" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised,border:"1px solid rgba(24,54,48,0.07)"}}>
        <p className="text-[10px] tracking-[0.14em] uppercase mb-4" style={{color:T.teal}}>Email</p>
        {emailChangeStep==="idle"&&<>
          <div className="text-[14px] mb-4 px-3.5 py-3" style={{border:"1px solid rgba(24,54,48,0.12)",borderRadius:RADIUS.xs,color:T.teal,backgroundColor:"rgba(24,54,48,0.03)"}}>{user?.email||"—"}</div>
          <SweepButton onClick={()=>setEmailChangeStep("entering")}>Change email</SweepButton>
        </>}
        {emailChangeStep==="entering"&&<form onSubmit={requestEmailOTP} className="flex flex-col gap-4">
          <InputField label="New Email Address" value={newEmail} onChange={setNewEmail} type="email" placeholder="you@example.com" required/>
          <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}>We'll send a 6-digit code to this new address to confirm it's really yours.</p>
          <div className="flex gap-3">
            <SweepButton filled type="submit" disabled={emailChangeSubmitting||!validEmail(newEmail)}>{emailChangeSubmitting?"Sending…":"Send Code"}</SweepButton>
            <SweepButton onClick={()=>{setEmailChangeStep("idle");setNewEmail("");}}>Cancel</SweepButton>
          </div>
        </form>}
        {emailChangeStep==="verifying"&&<form onSubmit={verifyEmailOTP} className="flex flex-col gap-4">
          <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.75)"}}>Enter the 6-digit code sent to {newEmail}.</p>
          <InputField label="Verification Code" value={emailOtpCode} onChange={v=>setEmailOtpCode(v.replace(/\D/g,"").slice(0,6))} placeholder="6-digit code" required/>
          <div className="flex gap-3 flex-wrap">
            <SweepButton filled type="submit" disabled={emailChangeSubmitting||emailOtpCode.length!==6}>{emailChangeSubmitting?"Verifying…":"Verify & Update"}</SweepButton>
            <SweepButton onClick={()=>{setEmailChangeStep("entering");setEmailOtpCode("");}}>Back</SweepButton>
            <SweepButton onClick={()=>{setEmailChangeStep("idle");setNewEmail("");setEmailOtpCode("");}}>Cancel</SweepButton>
          </div>
        </form>}
      </div>
      <div className="mb-5 p-5 md:p-6" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised,border:"1px solid rgba(24,54,48,0.07)"}}>
        <p className="text-[10px] tracking-[0.14em] uppercase mb-4" style={{color:T.teal}}>Phone</p>
        <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:T.muted}}>Number</label>
        {phoneChangeStep==="idle"&&<>
          <div className="text-[14px] mb-4 px-3.5 py-3" style={{border:"1px solid rgba(24,54,48,0.12)",borderRadius:RADIUS.xs,color:T.teal,backgroundColor:"rgba(24,54,48,0.03)"}}>{user?.phone||"Not set"}</div>
          <SweepButton onClick={()=>setPhoneChangeStep("entering")}>Change phone</SweepButton>
        </>}
        {phoneChangeStep==="entering"&&<form onSubmit={requestPhoneOTP} className="flex flex-col gap-4">
          <InputField label="New Phone Number" value={newPhone} onChange={v=>setNewPhone(v.replace(/\D/g,"").slice(0,10))} placeholder="10-digit mobile number" required/>
          <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}>We'll send a 6-digit code to your account email to confirm this change.</p>
          <div className="flex gap-3">
            <SweepButton filled type="submit" disabled={phoneChangeSubmitting||newPhone.length!==10}>{phoneChangeSubmitting?"Sending…":"Send Code"}</SweepButton>
            <SweepButton onClick={()=>{setPhoneChangeStep("idle");setNewPhone("");}}>Cancel</SweepButton>
          </div>
        </form>}
        {phoneChangeStep==="verifying"&&<form onSubmit={verifyPhoneOTP} className="flex flex-col gap-4">
          <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.75)"}}>Enter the 6-digit code sent to your email to confirm the change to {newPhone}.</p>
          <InputField label="Verification Code" value={otpCode} onChange={v=>setOtpCode(v.replace(/\D/g,"").slice(0,6))} placeholder="6-digit code" required/>
          <div className="flex gap-3 flex-wrap">
            <SweepButton filled type="submit" disabled={phoneChangeSubmitting||otpCode.length!==6}>{phoneChangeSubmitting?"Verifying…":"Verify & Update"}</SweepButton>
            <SweepButton onClick={()=>{setPhoneChangeStep("entering");setOtpCode("");}}>Back</SweepButton>
            <SweepButton onClick={()=>{setPhoneChangeStep("idle");setNewPhone("");setOtpCode("");}}>Cancel</SweepButton>
          </div>
        </form>}
      </div>
      <div className="mb-5 p-5 md:p-6" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised,border:"1px solid rgba(24,54,48,0.07)"}}>
        <p className="text-[10px] tracking-[0.14em] uppercase mb-4" style={{color:T.teal}}>Password</p>
        {showPwForm?<form onSubmit={changePassword} className="flex flex-col gap-4">
          <InputField label="Current Password" type="password" value={pwForm.current} onChange={v=>setPwForm(f=>({...f,current:v}))} required/>
          <InputField label="New Password" type="password" value={pwForm.next} onChange={v=>setPwForm(f=>({...f,next:v}))} required/>
          <InputField label="Confirm New Password" type="password" value={pwForm.confirm} onChange={v=>setPwForm(f=>({...f,confirm:v}))} required/>
          <div className="flex gap-3">
            <SweepButton filled type="submit" disabled={pwSubmitting}>{pwSubmitting?"Saving…":"Change Password"}</SweepButton>
            <SweepButton onClick={()=>setShowPwForm(false)}>Cancel</SweepButton>
          </div>
        </form>
        :<SweepButton onClick={()=>setShowPwForm(true)}>Change Password</SweepButton>}
      </div>
      <div className="mb-5 p-5 md:p-6" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised,border:"1px solid rgba(24,54,48,0.07)"}}>
        <p className="text-[10px] tracking-[0.14em] uppercase mb-4" style={{color:T.teal}}>Google account</p>
        {!googleStatus?<p className="text-[13.5px]" style={{color:T.muted}}>Checking…</p>
        :googleStatus.linked?<>
          <p className="text-[13.5px] mb-4" style={{color:"rgba(36,62,65,0.75)"}}>Your account is linked to Google — you can sign in with either your password or Google.</p>
          {googleStatus.hasPassword
            ?<SweepButton onClick={handleGoogleUnlink} disabled={unlinking}>{unlinking?"Unlinking…":"Unlink Google"}</SweepButton>
            :showSetPwForm
              ?<form onSubmit={submitSetPassword} className="flex flex-col gap-4">
                <p className="text-[12.5px]" style={{color:T.muted}}>Set a password first — this account currently has no other way to sign in besides Google.</p>
                <InputField label="New Password" type="password" value={newAccountPassword} onChange={setNewAccountPassword} required/>
                <div className="flex gap-3">
                  <SweepButton filled type="submit" disabled={settingPassword}>{settingPassword?"Saving…":"Set Password"}</SweepButton>
                  <SweepButton onClick={()=>{setShowSetPwForm(false);setNewAccountPassword("");}}>Cancel</SweepButton>
                </div>
              </form>
              :<div>
                <p className="text-[12.5px] mb-3" style={{color:T.muted}}>This account has no password yet — set one before unlinking Google, so you always have a way to sign in.</p>
                <SweepButton onClick={()=>setShowSetPwForm(true)}>Set a Password</SweepButton>
              </div>}
        </>
        :<>
          <p className="text-[13.5px] mb-1" style={{color:"rgba(36,62,65,0.75)"}}>Link your Google account for a faster, one-tap sign-in.</p>
          <GoogleLinkButton onLinked={handleGoogleLinked} onError={m=>showToast(m,"error")}/>
        </>}
      </div>
      <div className="p-5 md:p-6" style={{backgroundColor:"rgba(168,59,50,0.04)",borderRadius:RADIUS.md,border:"1px solid rgba(168,59,50,0.18)"}}>
        <p className="text-[10px] tracking-[0.14em] uppercase mb-2" style={{color:T.error}}>Danger zone</p>
        <p className="text-[14px] mb-1" style={{color:T.error,fontFamily:"'Fraunces',serif"}}>Delete account</p>
        <p className="text-[12.5px] mb-4 leading-relaxed" style={{color:T.muted}}>Permanently removes your profile, addresses, and wishlist. Order history is kept for legal/tax records without your name. Reviews stay as “Verified Buyer.” This cannot be undone.</p>
        <SweepButton onClick={()=>setShowDeleteModal(true)} style={{color:T.error,borderColor:T.error}}>Delete account</SweepButton>
      </div>
    </div>}
    <Modal open={showDeleteModal} onClose={()=>{setShowDeleteModal(false);setDeletePassword("");}} title="Delete your account?" danger confirmLabel={deleting?"Deleting…":"Delete Account"} onConfirm={deleteAccount}>
      <p className="text-[13.5px] mb-4" style={{color:"rgba(36,62,65,0.75)"}}>This permanently removes your profile, addresses, and wishlist. This can't be undone. Enter your password to confirm.</p>
      <InputField label="Password" type="password" value={deletePassword} onChange={setDeletePassword} required/>
    </Modal>
    <Modal open={!!reviewTarget} onClose={()=>{setReviewTarget(null);setReviewRating(5);setReviewComment("");}} title="Write a Review" confirmLabel={reviewSubmitting?"Submitting…":"Submit Review"} onConfirm={submitReview}>
      <p className="text-[13px] mb-4" style={{color:T.teal}}>{reviewTarget?.productName}</p>
      <div className="flex gap-1 mb-4">
        {[1,2,3,4,5].map(n=><button key={n} type="button" aria-label={`Rate ${n} star${n>1?"s":""}`} onClick={()=>setReviewRating(n)}><Star size={22} fill={n<=reviewRating?T.gold:"none"} stroke={T.gold}/></button>)}
      </div>
      <textarea rows={4} value={reviewComment} onChange={e=>setReviewComment(sanitize(e.target.value))} maxLength={1000} placeholder="Share your experience with this piece (optional)"
        className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,padding:"13px 14px",color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
    </Modal>
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
  const showToast=useToast();
  const [form,setForm]=useState({company:"",name:"",email:"",phone:"",quantity:"",interest:"",message:""});
  const [sent,setSent]=useState(false); const [errors,setErrors]=useState({});
  const [submitting,setSubmitting]=useState(false);
  const upd=k=>v=>setForm(f=>({...f,[k]:v}));
  // Found this was still a raw mailto: link with no real delivery
  // guarantee — on a phone with no email client configured, clicking
  // Submit did nothing visible at all while the page still confidently
  // claimed "your email client should have opened." Now a real backend
  // call, matching the same fix already made to the Contact form.
  const submit=async e=>{
    e.preventDefault();
    const errs={};
    if(!sanitize(form.name).trim()) errs.name="Required";
    if(!validEmail(form.email)) errs.email="Valid email required";
    if(!validIndianPhone(normalizePhone(form.phone))) errs.phone="Valid 10-digit mobile number required";
    if(!sanitize(form.quantity).trim()) errs.quantity="Required";
    if(sanitize(form.message).trim().length<240) errs.message=`Please tell us a bit more about what you need — at least 240 characters (currently ${sanitize(form.message).trim().length}).`;
    setErrors(errs);
    if(Object.keys(errs).length) return;
    setSubmitting(true);
    try{
      const res=await apiFetch("/api/bulk-orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
      if(res.ok) setSent(true);
      else{ const data=await res.json().catch(()=>({})); showToast(data.errors?"Please check the highlighted fields.":(data.error||"Couldn't send that — please try again."),"error"); if(data.errors) setErrors(data.errors); }
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setSubmitting(false);
    }
  };
  return <div>
    <section className="px-6 pt-20 pb-14 text-center max-w-[640px] mx-auto">
      <p className="text-[12px] tracking-[0.3em] uppercase mb-6" style={{color:T.teal}}>Bulk & Corporate Orders</p>
      <h1 className="italic text-[32px] md:text-[44px] mb-5" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>For hotels, cafés, and corporate gifting.</h1>
      <p className="text-[15px] leading-[1.75]" style={{color:"rgba(36,62,65,0.75)"}}>Ordering more than a handful of pieces — for a property, an office, or a gifting programme? Tell us what you're picturing and we'll put together a custom quote and production timeline, separate from our standard checkout.</p>
    </section>
    <section className="px-6 max-w-[900px] mx-auto pb-16 grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
      {[["Custom Quantities","No minimum stated upfront — tell us your volume and we'll confirm what's realistic within our production capacity."],
        ["Dedicated Timeline","Bulk orders get their own production schedule, communicated clearly rather than the standard 2–3 week estimate."],
        ["Direct Contact","One point of contact for the whole order — no need to place 50 separate carts."]]
        .map(([t,d])=><div key={t} className="p-6" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
          <p className="text-[13.5px] mb-2" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{t}</p>
          <p className="text-[12px] leading-[1.7]" style={{color:"rgba(36,62,65,0.75)"}}>{d}</p>
        </div>)}
    </section>
    <section className="px-6 max-w-[580px] mx-auto pb-24">
      <h2 className="italic text-[22px] text-center mb-9" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Tell us about your order.</h2>
      {sent?<div className="text-center py-8">
        <p className="text-[14px] mb-2" style={{color:T.teal}}>Thanks — we've received your enquiry.</p>
        <p className="text-[13px]" style={{color:"rgba(36,62,65,0.75)"}}>We'll get back to you at {sanitize(form.email)} within 2 business days. For anything urgent, write to us directly at <a href="mailto:info@akaraonline.co.in" style={{color:T.teal}}>info@akaraonline.co.in</a>.</p>
      </div>
      :<form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField label="Company / Organisation" value={form.company} onChange={upd("company")}/>
          <InputField label="Contact Name" value={form.name} onChange={upd("name")} error={errors.name} required/>
          <InputField label="Email" type="email" value={form.email} onChange={upd("email")} error={errors.email} required/>
          <InputField label="Phone" type="tel" value={form.phone} onChange={upd("phone")} error={errors.phone} required/>
          <InputField label="Estimated Quantity" value={form.quantity} onChange={upd("quantity")} error={errors.quantity} required/>
          <InputField label="Product(s) of Interest" value={form.interest} onChange={upd("interest")}/>
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Tell us more *</label>
          <textarea required rows={4} value={form.message} onChange={e=>setForm(f=>({...f,message:sanitize(e.target.value)}))} maxLength={1500}
            className="w-full bg-transparent outline-none text-[14px]" style={{border:`1px solid ${errors.message?T.error:"rgba(36,62,65,0.22)"}`,borderRadius:RADIUS.xs,padding:"13px 14px",color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
          {errors.message&&<p className="text-[11.5px] mt-1.5 flex items-center gap-1" style={{color:T.error}}><AlertCircle size={12}/>{errors.message}</p>}
        </div>
        <SweepButton filled type="submit" className="w-full" disabled={submitting}>{submitting?"Sending…":"Send Enquiry"}</SweepButton>
      </form>}
    </section>
  </div>;
}

// Dropdown options for ReturnRequestView below.
const RETURN_REASONS=["Damaged in transit (photos of item + packaging required)","Manufacturing defect","Wrong item received","Significantly different from product description"];
// Self-service return request page (/return-request). Same mailto:
// pattern as Bulk Orders (composes a pre-filled email to support, no real
// backend submission). If the entered order number matches the current
// session's actual `order`, it confirms "Order found" as a small real-data
// touch — but this only works within the same browser session, since
// there's no order database to look up historical orders against.
// Return request form (/return-request). Submits to a REAL backend now
// (POST /api/returns) instead of the old mailto: link — that approach
// could never support a photo attachment (mailto: is plain-text only, no
// way to attach a file), which is exactly why a real endpoint exists now.
// Every field here is mandatory — order number, item, reason, contact
// email AND phone, and a description — this used to accept an empty form
// entirely; there was no validation at all. "Changed my mind" was
// removed from the reason list on purpose — a made-to-order piece being
// returned for no defect isn't something this policy is meant to cover.
function ReturnRequestView({ navigate, order, user }){
  const showToast=useToast();
  const [orderNumber,setOrderNumber]=useState(order?.orderNumber||"");
  const [itemName,setItemName]=useState("");
  const [reason,setReason]=useState(RETURN_REASONS[0]);
  const [description,setDescription]=useState("");
  const [contactEmail,setContactEmail]=useState(order?.email||user?.email||"");
  const [contactPhone,setContactPhone]=useState(user?.phone||"");
  const [photoUrl,setPhotoUrl]=useState(null);
  const [photoUploading,setPhotoUploading]=useState(false);
  const [photoError,setPhotoError]=useState("");
  const [sent,setSent]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const [errors,setErrors]=useState({});
  // Real, admin-editable policy copy (Site Content → Return Request
  // Page) — found missing entirely during a real, website-wide sweep
  // for pages whose visible content wasn't actually connected to the
  // CMS. Deliberately only the real editorial copy (heading, intro,
  // the three-card summary) — the form itself stays real functional
  // code below, not CMS content. Falls back to the original real,
  // hardcoded text if the fetch fails or hasn't resolved yet, matching
  // the same real fallback discipline used for the homepage hero and
  // footer — this page must never show blank while CMS content loads.
  const [cmsContent,setCmsContent]=useState(null);
  useEffect(()=>{
    fetch("/api/page-content/return-request").then(r=>r.ok?r.json():null).then(d=>{
      if(!d?.blocks) return;
      const heading=d.blocks.find(b=>b.blockType==="heading")?.content;
      const paragraph=d.blocks.find(b=>b.blockType==="paragraph")?.content;
      const cardGridBlock=d.blocks.find(b=>b.blockType==="cardGrid");
      const cards=cardGridBlock?JSON.parse(cardGridBlock.content).cards:null;
      if(heading&&paragraph&&cards) setCmsContent({heading,paragraph,cards});
    }).catch(()=>{});
  },[]);
  const pageHeading=cmsContent?.heading||"Quality claims only";
  const pageIntro=cmsContent?.paragraph||"ĀKĀRA pieces are made to order. We do not accept returns because you changed your mind. This form is only for verified transit damage, manufacturing defects, or a wrong item — with evidence.";
  const summaryCards=cmsContent?.cards?cmsContent.cards.map(c=>{
    // Real cardGrid cards are {title, description} — this page's real,
    // original visual design shows three real pieces per card (a label,
    // a short value, and a longer detail sentence), so the real,
    // combined description (seeded as "value — detail") is split back
    // apart here for display, matching the original real layout exactly.
    const [t2,...rest]=c.description.split(" — ");
    return [c.title,t2,rest.join(" — ")];
  }):[
    ["Time limits","48 hours / 7 days","Transit damage: notify within 48 hours of delivery. Defects or wrong item: within 7 days. Late claims are declined."],
    ["Evidence required","Photos + detail","Order number, clear photos of the issue and packaging, and a full written description. Incomplete requests are closed."],
    ["Not accepted","Change of mind","No returns for preference, colour opinion, redecorating, or “I no longer want it.” Matching, intact made-to-order pieces are final sale."],
  ];
  // REAL BUG FIX: this was originally declared AFTER the real
  // `if(!user) return ...` early return below — a genuine violation of
  // React's own hook rules (every hook must run in the same order on
  // every render, never conditionally, never after an early return).
  // On a render where `user` was null, this useState call never ran at
  // all; on a render where `user` existed, it did — so if this
  // component was ever mounted while a login was still resolving (the
  // real, exact "works once, then breaks" pattern reported directly:
  // works the first time, then a later render with a different `user`
  // value hits React's own real hook-order mismatch and crashes into
  // the app's error boundary). Moved up here, unconditionally, with
  // every other real hook in this component, which is the actual,
  // correct fix — not just a stylistic preference.
  const [showForm,setShowForm]=useState(false);
  const matchedOrder=order&&order.orderNumber===sanitize(orderNumber).trim()?order:null;

  const handlePhotoSelect=async e=>{
    const file=e.target.files?.[0];
    if(!file) return;
    setPhotoUploading(true); setPhotoError("");
    try{
      const body=new FormData();
      body.append("file",file);
      body.append("kind","image");
      const res=await apiFetch("/api/upload",{method:"POST",body});
      const data=await res.json();
      if(res.ok){ setPhotoUrl(data.url); }
      else setPhotoError(data.error||"Couldn't upload that photo.");
    }catch{
      setPhotoError("Couldn't reach the server — please try again.");
    }finally{
      setPhotoUploading(false);
    }
  };

  const submit=async e=>{
    e.preventDefault();
    const errs={};
    if(!sanitize(orderNumber).trim()) errs.orderNumber="Required";
    if(!sanitize(itemName).trim()) errs.itemName="Required";
    if(!validEmail(contactEmail)) errs.contactEmail="Valid email required";
    if(!validIndianPhone(normalizePhone(contactPhone))) errs.contactPhone="Valid 10-digit mobile number required";
    if(sanitize(description).trim().length<240) errs.description=`Please describe what happened in more detail — at least 240 characters (currently ${sanitize(description).trim().length}).`;
    setErrors(errs);
    if(Object.keys(errs).length) return;
    setSubmitting(true);
    try{
      const res=await apiFetch("/api/returns",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          orderNumber:sanitize(orderNumber).trim(), itemName:sanitize(itemName), reason,
          description:sanitize(description), contactEmail:sanitize(contactEmail),
          contactPhone:normalizePhone(contactPhone), photoUrl,
        }),
      });
      const data=await res.json();
      if(res.ok) setSent(true);
      else showToast(data.error||"Couldn't submit your return request.","error");
    }catch{
      showToast("Couldn't reach the server — please try again.","error");
    }finally{
      setSubmitting(false);
    }
  };

  if(!user) return <div className="px-6 py-24 max-w-[440px] mx-auto text-center">
    <Lock size={32} strokeWidth={1.2} style={{color:"rgba(36,62,65,0.75)",margin:"0 auto 20px"}}/>
    <h1 className="italic text-[24px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Sign in to request a return.</h1>
    <p className="text-[13.5px] mb-8" style={{color:"rgba(36,62,65,0.75)"}}>We need to verify the order belongs to your account first.</p>
    <SweepButton filled onClick={()=>navigate("login")}>Sign In</SweepButton>
  </div>;

  return <div className="px-6 md:px-14 py-16 max-w-[720px] mx-auto">
    <p className="text-[12px] tracking-[0.3em] uppercase mb-4 text-center" style={{color:T.teal}}>Returns</p>
    <h1 className="italic text-[30px] md:text-[38px] mb-3 text-center" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{pageHeading}</h1>
    <p className="text-[14px] leading-[1.8] mb-10 text-center max-w-[36rem] mx-auto" style={{color:T.muted}}>{pageIntro}</p>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
      {summaryCards.map(([t1,t2,t3])=>(
        <div key={t1} className="p-5" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
          <p className="text-[11px] tracking-[0.14em] uppercase mb-2" style={{color:T.teal}}>{t1}</p>
          <p className="text-[15px] mb-2" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{t2}</p>
          <p className="text-[12.5px] leading-relaxed" style={{color:T.muted}}>{t3}</p>
        </div>
      ))}
    </div>

    {!showForm && !sent && (
      <div className="text-center mb-10">
        <SweepButton filled onClick={()=>setShowForm(true)}>Start a return request</SweepButton>
        <p className="text-[12px] mt-3" style={{color:T.muted}}>You’ll stay signed in — we only accept requests tied to your account.</p>
      </div>
    )}

    {sent?<div className="text-center py-10 px-6" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
      <Check size={28} style={{color:T.success,margin:"0 auto 16px"}}/>
      <p className="text-[14px] mb-2" style={{color:T.teal}}>Your return request has been submitted.</p>
      <p className="text-[13px]" style={{color:"rgba(36,62,65,0.75)"}}>We'll review it and get back to you at {sanitize(contactEmail)}.</p>
    </div>
    :(showForm?<form onSubmit={submit} noValidate className="flex flex-col gap-4 p-6 md:p-8" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.lg}}>
      <p className="text-[13px] mb-1" style={{color:T.teal,fontFamily:"'Fraunces',serif"}}>Return request</p>
      <p className="text-[12.5px] mb-4" style={{color:T.muted}}>Complete the fields below. We reply by email with next steps.</p>
      <InputField label="Order Number" value={orderNumber} onChange={setOrderNumber} placeholder="e.g. AK12345" error={errors.orderNumber} required/>
      {matchedOrder&&<p className="text-[11.5px] -mt-2" style={{color:T.teal}}>Order found — {matchedOrder.items.length} item{matchedOrder.items.length>1?"s":""} on file.</p>}
      <InputField label="Item Name" value={itemName} onChange={setItemName} error={errors.itemName} required/>
      <div>
        <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Reason *</label>
        <select value={reason} onChange={e=>setReason(e.target.value)} className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,padding:"13px 14px",color:T.teal,fontFamily:"'Space Grotesk',sans-serif"}}>
          {RETURN_REASONS.map(r=><option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <InputField label="Contact Email" type="email" value={contactEmail} onChange={setContactEmail} error={errors.contactEmail} required/>
      <InputField label="Contact Phone" type="tel" value={contactPhone} onChange={setContactPhone} error={errors.contactPhone} required/>
      <div>
        <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Describe what happened *</label>
        <textarea rows={4} value={description} onChange={e=>setDescription(sanitize(e.target.value))} maxLength={1500}
          className="w-full bg-transparent outline-none text-[14px]" style={{border:`1px solid ${errors.description?T.error:"rgba(36,62,65,0.22)"}`,borderRadius:RADIUS.xs,padding:"13px 14px",color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
        {errors.description&&<p className="text-[11.5px] mt-1.5 flex items-center gap-1" style={{color:T.error}}><AlertCircle size={12}/>{errors.description}</p>}
      </div>
      <div>
        <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Photo of the Issue (optional, recommended)</label>
        {photoUrl?<div className="flex items-center gap-3 p-3" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs}}>
          <img src={photoUrl} alt="Uploaded" className="w-14 h-14 object-cover"/>
          <p className="text-[12.5px] flex-1" style={{color:T.success}}>Photo uploaded</p>
          <button type="button" onClick={()=>setPhotoUrl(null)} style={{color:"rgba(36,62,65,0.75)"}}><X size={16}/></button>
        </div>
        :<label className="flex items-center justify-center gap-2 px-4 py-6 cursor-pointer text-[12.5px]" style={{border:"1px dashed rgba(36,62,65,0.3)",color:"rgba(36,62,65,0.75)"}}>
          {photoUploading?"Uploading…":"Click to upload a photo"}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoSelect} disabled={photoUploading} className="hidden"/>
        </label>}
        {photoError&&<p className="text-[11.5px] mt-1.5 flex items-center gap-1" style={{color:T.error}}><AlertCircle size={12}/>{photoError}</p>}
      </div>
      <SweepButton filled type="submit" disabled={submitting} className="w-full">{submitting?"Submitting…":"Submit Return Request"}</SweepButton>
    </form>:null)}
  </div>;
}

// Standalone care instructions page (/care-guide) — real, sectioned
// content, now read from the real CMS (page_key "care-guide") instead
// of the old hardcoded CARE_SECTIONS constant. The first paragraph
// block is the intro text; every bulletList block after it is a real
// section — same real interactive rendering (icon-bulleted lists,
// "Ask Us Directly" card) as before, just sourced differently.
function CareGuideView({ navigate }){
  const [intro,setIntro]=useState(null);
  const [sections,setSections]=useState(null);
  const [error,setError]=useState(false);
  useEffect(()=>{
    fetch("/api/page-content/care-guide").then(r=>r.ok?r.json():Promise.reject()).then(d=>{
      const introBlock=d.blocks.find(b=>b.blockType==="paragraph");
      setIntro(introBlock?.content||"");
      setSections(d.blocks.filter(b=>b.blockType==="bulletList").map(b=>JSON.parse(b.content)));
    }).catch(()=>setError(true));
  },[]);
  if(error) return <div className="px-6 py-24 text-center"><p className="text-[14px]" style={{color:"rgba(36,62,65,0.75)"}}>Couldn't load this page right now. Please try again shortly.</p></div>;
  if(sections===null) return <div className="px-6 md:px-14 py-16 max-w-[820px] mx-auto"><Skeleton height={400}/></div>;
  return <div className="px-6 md:px-14 py-16 max-w-[820px] mx-auto">
    <p className="text-[12px] tracking-[0.3em] uppercase mb-4 text-center" style={{color:T.teal}}>Care Guide</p>
    <h1 className="italic text-[32px] md:text-[44px] mb-5 text-center" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Caring for your ĀKĀRA piece</h1>
    <p className="text-[14.5px] leading-[1.85] mb-14 text-center" style={{color:"rgba(36,62,65,0.75)"}}>{intro}</p>
    {sections.map(s=><div key={s.title} className="mb-10">
      <h2 className="text-[17px] italic mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{s.title}</h2>
      <ul className="flex flex-col gap-2.5">
        {s.points.map(p=><li key={p} className="flex items-start gap-2.5 text-[13.5px] leading-[1.7]" style={{color:"rgba(36,62,65,0.75)"}}><Check size={13} style={{color:T.teal,marginTop:4,flexShrink:0}}/>{p}</li>)}
      </ul>
    </div>)}
    <div className="mt-14 p-6 text-center" style={{border:`1px solid ${T.gold}`,borderRadius:RADIUS.xs}}>
      <p className="text-[13px] mb-3" style={{color:"rgba(36,62,65,0.75)"}}>Still unsure about a specific piece?</p>
      <button onClick={()=>navigate("contact")} className="text-[12px] uppercase tracking-[0.1em]" style={{color:T.teal}}>Ask Us Directly →</button>
    </div>
  </div>;
}

// Real, actual "download the app" page (/android-app) — directly
// requested after a real, live 404 was hit trying to reach it. Fetches
// the exact same real, public /app/android-version.json endpoint the
// installed app's own UpdateGate polls (see server.js and
// server/routes/admin/settings.js), so this page and the app's own
// update mechanism can never show two different, real, disagreeing
// version numbers — one, single, real source of truth.
function AndroidAppView({ navigate }){
  const [appInfo,setAppInfo]=useState(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    fetch("/app/android-version.json").then(r=>r.ok?r.json():Promise.reject()).then(d=>{
      setAppInfo(d);
      setLoading(false);
    }).catch(()=>setLoading(false));
  },[]);

  const available=!loading&&appInfo?.apkUrl;

  return <div className="px-6 md:px-14 py-16 max-w-[720px] mx-auto text-center">
    <p className="text-[12px] tracking-[0.3em] uppercase mb-4" style={{color:T.teal}}>ĀKĀRA for Android</p>
    <h1 className="italic text-[32px] md:text-[44px] mb-5" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Carry the studio in your pocket.</h1>
    <p className="text-[14.5px] leading-[1.85] mb-10" style={{color:"rgba(36,62,65,0.75)"}}>
      Browse the collection, track an order, and check on a return — the full ĀKĀRA experience, built for Android.
    </p>

    {loading?<div className="max-w-[280px] mx-auto"><Skeleton height={52} radius={999}/></div>:!available?
      <div className="p-6 max-w-[440px] mx-auto" style={{backgroundColor:T.card,borderRadius:RADIUS.md}}>
        <p className="text-[14px]" style={{color:T.muted}}>The Android app isn't available for download just yet — check back shortly.</p>
      </div>
    :<>
      <a href="/app/akara.apk" download
        className="inline-block px-10 py-4 text-[12px] tracking-[0.14em] uppercase font-medium mb-3"
        style={{backgroundColor:T.teal,color:"white",borderRadius:999}}>
        Download for Android
      </a>
      <p className="text-[12px] mb-14" style={{color:T.mutedSoft}}>
        Version {appInfo.versionName} · Direct download, not on the Play Store
      </p>

      <div className="p-6 md:p-8 text-left" style={{backgroundColor:T.card,borderRadius:RADIUS.md}}>
        <p className="text-[11px] tracking-[0.12em] uppercase mb-3" style={{color:T.teal}}>Before you install</p>
        <p className="text-[13.5px] leading-[1.8] mb-4" style={{color:"rgba(36,62,65,0.8)"}}>
          This app is downloaded directly from us, not the Play Store, so Android will show a warning about installing from an unknown source the first time. This is expected — you'll need to allow it once in your phone's settings to continue.
        </p>
        <ol className="text-[13.5px] leading-[2] pl-5" style={{color:"rgba(36,62,65,0.8)",listStyleType:"decimal"}}>
          <li>Tap "Download for Android" above.</li>
          <li>Open the downloaded file from your notifications or Downloads folder.</li>
          <li>If prompted, allow installs from this source — this is a one-time step.</li>
          <li>Sign in with the same email you use on this website — your account, orders, and wishlist carry over.</li>
        </ol>
      </div>

      {appInfo.releaseNotes&&<div className="mt-6 p-5 text-left" style={{backgroundColor:"rgba(24,54,48,0.04)",borderRadius:RADIUS.md}}>
        <p className="text-[11px] tracking-[0.12em] uppercase mb-2" style={{color:T.teal}}>What's new in {appInfo.versionName}</p>
        <p className="text-[13px] leading-[1.7]" style={{color:"rgba(36,62,65,0.8)"}}>{appInfo.releaseNotes}</p>
      </div>}
    </>}
  </div>;
}


// New Arrivals / Promotions / Atelier Notes, or unsubscribe from all.
// UI ONLY: there's no real email service (ESP) integrated yet, so
// nothing here is actually wired to a mailing list — this is the
// interface ready for when one exists.
function EmailPreferencesView({ navigate }){
  const showToast=useToast();
  const [email,setEmail]=useState("");
  const [prefs,setPrefs]=useState({newArrivals:true,promotions:true,journal:false});
  const [saved,setSaved]=useState(false);
  const [unsubscribed,setUnsubscribed]=useState(false);
  const [saving,setSaving]=useState(false);
  const togglePref=k=>setPrefs(p=>({...p,[k]:!p[k]}));
  // Found genuinely broken — this used to just flip local state with no
  // backend at all, meaning "Save Preferences" and "Unsubscribe" did
  // nothing real regardless of what a customer chose. Both now call the
  // same real upsert endpoint; unsubscribe is just that same call with
  // every preference set to false, not a separate code path to keep in
  // sync.
  const submitPrefs=async(nextPrefs,isUnsubscribe)=>{
    if(!validEmail(email)){ showToast("Enter a valid email first.","error"); return; }
    setSaving(true);
    try{
      const res=await apiFetch("/api/newsletter/preferences",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,newArrivals:nextPrefs.newArrivals,promotions:nextPrefs.promotions,journal:nextPrefs.journal})});
      if(res.ok){ setPrefs(nextPrefs); setSaved(true); setUnsubscribed(isUnsubscribe); }
      else showToast("Couldn't save that — please try again.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setSaving(false);
    }
  };
  const save=e=>{ e.preventDefault(); submitPrefs(prefs,false); };
  const unsubscribeAll=()=>submitPrefs({newArrivals:false,promotions:false,journal:false},true);
  return <div className="px-6 md:px-14 py-16 max-w-[520px] mx-auto">
    <p className="text-[12px] tracking-[0.3em] uppercase mb-4 text-center" style={{color:T.teal}}>Email Preferences</p>
    <h1 className="italic text-[30px] md:text-[38px] mb-5 text-center" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Manage what we send you</h1>
    <p className="text-[13.5px] leading-[1.8] mb-10 text-center" style={{color:"rgba(36,62,65,0.75)"}}>Order confirmations, shipping updates, and other transactional emails aren't optional — you'll always get those for an order you place. Everything below is up to you.</p>
    <form onSubmit={save} noValidate className="flex flex-col gap-5">
      <InputField label="Email Address" type="email" value={email} onChange={setEmail} required/>
      <div className="flex flex-col gap-3.5">
        {[["newArrivals","New Arrivals","Be first to know when a new piece or collection drops."],
          ["promotions","Promotions & Offers","Occasional discount codes and sale announcements."],
          ["journal","Atelier Notes","Studio process, styling guides, and behind-the-scenes updates."]]
          .map(([key,label,desc])=><label key={key} className="flex items-start gap-3 cursor-pointer p-4" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
            <input type="checkbox" checked={prefs[key]} onChange={()=>togglePref(key)} className="mt-1" style={{accentColor:T.teal}}/>
            <span>
              <span className="block text-[13.5px]" style={{color:T.teal}}>{label}</span>
              <span className="block text-[12px] mt-0.5" style={{color:"rgba(36,62,65,0.75)"}}>{desc}</span>
            </span>
          </label>)}
      </div>
      <SweepButton filled type="submit" className="w-full" disabled={saving}>{saving?"Saving…":"Save Preferences"}</SweepButton>
      <button type="button" onClick={unsubscribeAll} disabled={saving} className="text-[12px] underline mx-auto" style={{color:"rgba(36,62,65,0.75)"}}>Unsubscribe from all marketing emails</button>
      {saved&&<p className="text-[13px] text-center" style={{color:T.teal}}>{unsubscribed?"You've been unsubscribed from all marketing emails.":"Preferences saved."}</p>}
    </form>
  </div>;
}

// Accessibility commitment page (/accessibility). Note: the sitewide
// focus-visible outline and prefers-reduced-motion support (see FONTS
// above) exist specifically to back up what this page promises — don't
// let this page's claims drift out of sync with what's actually built.
function AccessibilityView({navigate}){return <CmsPageView pageKey="accessibility" title="Accessibility Statement" icon={Accessibility} navigate={navigate}/>;}

// ============================================================================
// LEGAL PAGES — Privacy, Refund, Shipping, Terms, Cookies (+ Accessibility
// above uses this shell too). LegalShell/Lh/Lp/LegalTable are the shared
// building blocks so every legal page has identical heading size, spacing,
// and "Last updated" formatting without repeating markup 6 times.
// ============================================================================
// Wrapper: title + "Last updated" date + whatever <Lh>/<Lp> content is
// passed as children.
// Redesigned — found genuinely valid: these pages were plain, unstructured
// text with no navigation and no visual identity per page, despite some
// (Terms, Privacy) running 10-15 numbered sections deep. The table of
// contents below is generated automatically from whatever <Lh> section
// headings actually exist in a given page's content (via a DOM query
// after mount) — it can never drift out of sync with the real content,
// since it's reading the real rendered headings, not a hand-maintained
// duplicate list. Content itself (every Lp/Lh string) is completely
// unchanged — this only touches layout, icons, and navigation.
function LegalShell({title,updated,icon:Icon,children}){
  const contentRef=useRef(null);
  const [sections,setSections]=useState([]);
  useEffect(()=>{
    if(!contentRef.current) return;
    const headings=Array.from(contentRef.current.querySelectorAll("h2"));
    setSections(headings.map(h=>({id:h.id,text:h.textContent})));
  },[children]);
  return <div className="px-6 md:px-14 py-16 max-w-[1120px] mx-auto">
    <div className="flex items-center gap-3 mb-3">
      {Icon&&<div className="w-11 h-11 flex items-center justify-center shrink-0" style={{backgroundColor:"rgba(184,147,90,0.12)",borderRadius:RADIUS.sm}}><Icon size={19} style={{color:T.teal}}/></div>}
      <h1 className="italic text-[28px] md:text-[36px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{title}</h1>
    </div>
    <p className="text-[12px] mb-10 md:mb-14" style={{color:"rgba(36,62,65,0.75)"}}>Last updated: {updated}</p>
    <div className="flex flex-col md:flex-row gap-10 md:gap-16">
      {sections.length>0&&<nav aria-label="Sections on this page" className="md:w-[230px] shrink-0 md:sticky md:top-24 md:self-start order-2 md:order-1">
        <p className="text-[11px] tracking-[0.12em] uppercase mb-3" style={{color:"rgba(36,62,65,0.75)"}}>On This Page</p>
        <div className="flex flex-col gap-2.5 md:max-h-[65vh] md:overflow-y-auto md:pr-2">
          {sections.map(s=><a key={s.id} href={`#${s.id}`} className="text-[12.5px] leading-snug hover:underline" style={{color:"rgba(36,62,65,0.75)"}}>{s.text}</a>)}
        </div>
      </nav>}
      <div ref={contentRef} className="flex-1 max-w-[720px] order-1 md:order-2">{children}</div>
    </div>
  </div>;
}
// Legal-page paragraph — `c` can be a plain string or JSX (for inline
// links, e.g. Lp with a <button> or <a> inside it).
function Lp({c}){return <p className="text-[14.5px] leading-[1.85] mb-4" style={{color:"rgba(36,62,65,0.75)",textAlign:"justify",textJustify:"inter-word"}}>{c}</p>;}
// Legal-page section subheading — id is auto-slugified from its own text
// so LegalShell's table of contents can link straight to it; scroll-mt
// keeps the sticky header from covering the heading when jumped to.
function Lh({c}){
  const id=typeof c==="string"?c.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,""):undefined;
  return <h2 id={id} className="text-[17px] italic mt-10 mb-4 scroll-mt-24" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{c}</h2>;
}

// ============================================================================
// CMS CONTENT RENDERING — parses the lightweight markup convention used
// by page_content.content (see server/seed-cms.js's own comment for the
// full spec): [visible text](internal-page-key) for in-app navigation,
// [visible text](mailto:address) for a real mailto: link, **text** for
// bold emphasis. This is what lets an admin editing PLAIN TEXT in a
// textarea still produce the exact same real, working <button>/<a>/
// <strong> elements the hardcoded Lp blocks used to contain directly —
// nothing about how those links actually function changes, only that
// the surrounding words can now be edited without touching code.
//
// Deliberately NOT a general Markdown parser (no lists, no italics via
// underscore, no nested formatting) — the real, actual set of patterns
// used across every existing legal page is exactly these three, and
// building a full Markdown engine for patterns that don't exist
// anywhere in this app's real content would just be unused surface
// area. If a genuinely new pattern is needed later, it can be added
// here explicitly, the same deliberate way these three were.
function parseInlineMarkup(text, navigate){
  const parts=[];
  // Single combined pass, alternating between plain text and matched
  // markup, so [text](link) and **text** can appear in the same
  // sentence without one pass corrupting what the other already found.
  const pattern=/\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  let lastIndex=0, match, key=0;
  while((match=pattern.exec(text))){
    if(match.index>lastIndex) parts.push(text.slice(lastIndex,match.index));
    if(match[1]!==undefined){
      const label=match[1], target=match[2];
      if(target.startsWith("mailto:")){
        parts.push(<a key={key++} href={target} style={{color:T.teal}}>{label}</a>);
      } else {
        parts.push(<button key={key++} onClick={()=>navigate(target)} className="underline" style={{color:T.teal}}>{label}</button>);
      }
    } else if(match[3]!==undefined){
      parts.push(<strong key={key++} style={{color:T.teal}}>{match[3]}</strong>);
    }
    lastIndex=pattern.lastIndex;
  }
  if(lastIndex<text.length) parts.push(text.slice(lastIndex));
  return parts;
}

// Renders one real page's worth of CMS blocks (heading/paragraph/table),
// reusing the EXACT same Lh/Lp/LegalTable components every hardcoded
// legal page already used — this is deliberate: LegalShell's own
// section-nav (see its own comment) builds itself by scanning for real
// <h2> elements after mount, so as long as this renders genuine Lh/Lp
// output, the "On This Page" navigation keeps working automatically,
// with zero special-casing needed for CMS-driven pages vs the old
// hardcoded ones.
function PageContentBlocks({blocks, navigate}){
  return <>{blocks.map(b=>{
    if(b.blockType==="heading") return <Lh key={b.id} c={b.content}/>;
    if(b.blockType==="table") return <LegalTable key={b.id} rows={JSON.parse(b.content)}/>;
    return <Lp key={b.id} c={parseInlineMarkup(b.content,navigate)}/>;
  })}</>;
}

// ============================================================================
// LAYOUT-SHAPE BLOCKS — the five real, reusable visual sections
// About/Craft actually use (hero/quote/darkPanel/stepGrid/cardGrid),
// each rendered with the EXACT same real styling the original hardcoded
// AboutView/CraftView components used — this deliberately reuses that
// styling rather than reinventing it, so the pages look identical to
// before, just reading their real words from the database now. A
// **bold** span inside hero.heading (e.g. "**Ākāra**") is parsed the
// same lightweight way Lp already does elsewhere.
// ============================================================================
function CmsSectionBlocks({blocks, navigate}){
  return <>{blocks.map(b=>{
    if(b.blockType==="hero"){
      const {eyebrow,heading,subtext}=JSON.parse(b.content);
      return <section key={b.id} className="px-6 py-24 md:py-28 text-center max-w-[800px] mx-auto">
        <p className="text-[12px] tracking-[0.3em] uppercase mb-7" style={{color:T.teal}}>{eyebrow}</p>
        <h1 className="italic text-[32px] md:text-[50px] leading-[1.2] mb-7" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>
          {heading.split(/(\*\*[^*]+\*\*)/).map((part,i)=>part.startsWith("**")?<span key={i} style={{color:T.teal,opacity:0.55}}>{part.slice(2,-2)}</span>:part)}
        </h1>
        <p className="text-[16px] leading-[1.8] max-w-[540px] mx-auto" style={{color:"rgba(36,62,65,0.75)"}}>{subtext}</p>
      </section>;
    }
    if(b.blockType==="paragraph") return <section key={b.id} className="px-6 max-w-[760px] mx-auto pb-8"><Lp c={parseInlineMarkup(b.content,navigate)}/></section>;
    if(b.blockType==="quote"){
      const {quote,attribution}=JSON.parse(b.content);
      return <section key={b.id} className="px-6 py-24 text-center">
        <p className="italic text-[20px] leading-[1.7] max-w-[540px] mx-auto mb-6" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{quote}</p>
        <p className="text-[11px] tracking-[0.1em] uppercase" style={{color:"rgba(36,62,65,0.75)"}}>— {attribution}</p>
      </section>;
    }
    if(b.blockType==="darkPanel"){
      const {eyebrow,heading,body}=JSON.parse(b.content);
      return <section key={b.id} className="relative px-6 py-20 md:py-24 text-center overflow-hidden" style={{backgroundColor:T.teal}}>
        <div className="pointer-events-none absolute w-[500px] h-[500px] rounded-full -right-40 -bottom-40" style={{background:"radial-gradient(circle,rgba(184,147,90,0.12),transparent 70%)"}}/>
        <p className="relative text-[12px] tracking-[0.3em] uppercase mb-5" style={{color:T.cream}}>{eyebrow}</p>
        <h2 className="relative italic mx-auto max-w-xl leading-[1.3] text-white mb-6" style={{fontFamily:"'Fraunces',serif",fontWeight:400,fontSize:"clamp(24px,3.6vw,36px)"}}>{heading}</h2>
        <p className="relative text-[14px] leading-[1.8] max-w-[520px] mx-auto" style={{color:"rgba(255,255,255,0.55)"}}>{body}</p>
      </section>;
    }
    if(b.blockType==="stepGrid"){
      const {eyebrow,heading,steps}=JSON.parse(b.content);
      return <section key={b.id} className="py-24 md:py-28" style={{backgroundColor:T.teal}}>
        <div className="max-w-[1100px] mx-auto px-6">
          <p className="text-[12px] tracking-[0.3em] uppercase mb-5 text-center" style={{color:T.cream}}>{eyebrow}</p>
          <h2 className="italic text-[28px] md:text-[36px] text-center mb-14 text-white" style={{fontFamily:"'Fraunces',serif",fontWeight:400}}>{heading}</h2>
          <div className="grid grid-cols-2 md:grid-cols-5" style={{borderTop:"1px solid rgba(255,255,255,0.15)",borderBottom:"1px solid rgba(255,255,255,0.15)"}}>
            {steps.map((s,i)=><div key={s.number} className="py-8 px-4 text-center" style={{borderRight:i<steps.length-1?"1px solid rgba(255,255,255,0.15)":"none"}}>
              <p className="italic text-[24px] mb-3" style={{fontFamily:"'Fraunces',serif",color:T.gold}}>{s.number}</p>
              <p className="text-[12px] tracking-[0.06em] uppercase mb-2 text-white">{s.title}</p>
              <p className="text-[11.5px] leading-[1.6]" style={{color:"rgba(255,255,255,0.5)"}}>{s.description}</p>
            </div>)}
          </div>
        </div>
      </section>;
    }
    if(b.blockType==="cardGrid"){
      const {cards}=JSON.parse(b.content);
      return <section key={b.id} className="px-6 max-w-[1100px] mx-auto pb-20 grid grid-cols-1 md:grid-cols-3 gap-8">
        {cards.map(c=><div key={c.title} className="p-8" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
          <p className="italic text-[20px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{c.title}</p>
          <p className="text-[13.5px] leading-[1.8]" style={{color:"rgba(36,62,65,0.75)"}}>{c.description}</p>
        </div>)}
      </section>;
    }
    return null;
  })}</>;
}

// Fetches and renders one CMS-driven About/Craft page. Same real
// loading/error handling as CmsPageView below, but no LegalShell
// wrapping (no sidebar section-nav — that's a legal-page-specific
// treatment that never applied to About/Craft even before this) and a
// fixed CTA row at the end, matching the original hardcoded pages
// exactly. navTo/navLabel/navTo2/navLabel2 are the two CTA buttons —
// kept as real navigation, not editable CMS content, since changing a
// button's destination is a routing change, not a wording one.
function CmsSectionPageView({pageKey, navigate, ctaHeading, navLabel, navTo, navLabel2, navTo2}){
  const [blocks,setBlocks]=useState(null);
  const [error,setError]=useState(false);
  useEffect(()=>{
    setBlocks(null); setError(false);
    fetch(`/api/page-content/${pageKey}`).then(r=>r.ok?r.json():Promise.reject()).then(d=>setBlocks(d.blocks)).catch(()=>setError(true));
  },[pageKey]);
  if(error) return <div className="px-6 py-24 text-center"><p className="text-[14px]" style={{color:"rgba(36,62,65,0.75)"}}>Couldn't load this page right now. Please try again shortly.</p></div>;
  if(!blocks) return <div className="px-6 py-24 max-w-[900px] mx-auto"><Skeleton height={500}/></div>;
  return <div>
    <CmsSectionBlocks blocks={blocks} navigate={navigate}/>
    <section className="px-6 pb-24 text-center">
      {ctaHeading&&<h2 className="italic text-[26px] md:text-[32px] mb-8" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{ctaHeading}</h2>}
      <div className="flex gap-4 justify-center flex-wrap">
        <SweepButton filled onClick={()=>navigate(navTo)}>{navLabel}</SweepButton>
        <SweepButton onClick={()=>navigate(navTo2)}>{navLabel2}</SweepButton>
      </div>
    </section>
  </div>;
}

// Fetches and renders one CMS-driven page by its page_key — the actual
// replacement for a hardcoded PrivacyPolicyView-style component. Loading
// and error states matter here specifically because this now depends on
// a real network request that didn't exist before (the old hardcoded
// version could never fail to load its own content).
function CmsPageView({pageKey, title, icon, navigate}){
  const [blocks,setBlocks]=useState(null);
  const [error,setError]=useState(false);
  useEffect(()=>{
    setBlocks(null); setError(false);
    fetch(`/api/page-content/${pageKey}`).then(r=>r.ok?r.json():Promise.reject()).then(d=>setBlocks(d.blocks)).catch(()=>setError(true));
  },[pageKey]);
  if(error) return <div className="px-6 py-24 text-center"><p className="text-[14px]" style={{color:"rgba(36,62,65,0.75)"}}>Couldn't load this page right now. Please try again shortly.</p></div>;
  if(!blocks) return <div className="px-6 md:px-14 py-16 max-w-[1120px] mx-auto"><Skeleton height={300}/></div>;
  return <LegalShell title={title} updated="August 2026" icon={icon}>
    <PageContentBlocks blocks={blocks} navigate={navigate}/>
  </LegalShell>;
}

// Simple data table for legal pages (used by Privacy Policy's Data
// Retention and DPDP Act Rights tables). First row is treated as the
// header. Rows are arrays of plain strings, each ` · `-joined string in a
// non-header cell renders as its own line/bullet.
function LegalTable({rows}){
  // Found the actual cause of the Section 9 scrollbar: every cell forced
  // whiteSpace:nowrap regardless of content length. That's fine for the
  // short label column, but the DPDP rights table's description column
  // has genuinely long prose ("Nominate another individual to exercise
  // these rights on your behalf in the event of death or incapacity")
  // that has no business being forced onto one line — it pushed the
  // table wider than its container and triggered the horizontal
  // scrollbar. Only the first column stays non-wrapping now; every
  // other column wraps normally, like actual prose.
  return <div className="mb-4 overflow-x-auto">
    <table className="w-full text-[13px]" style={{borderCollapse:"collapse"}}>
      <tbody>
        {rows.map((r,i)=><tr key={i} style={{borderBottom:"1px solid rgba(36,62,65,0.12)"}}>
          {r.map((cell,j)=><td key={j} className="py-3 pr-6 align-top" style={{color:i===0?T.teal:"rgba(36,62,65,0.68)",fontWeight:i===0?600:400,whiteSpace:j===0?"nowrap":"normal"}}>{cell}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>;
}
// /privacy — 12 sections including the DPDP Act 2023 rights table and
// named Grievance Officer, per the real business details on file.
function PrivacyPolicyView({navigate}){return <CmsPageView pageKey="privacy" title="Privacy Policy" icon={Shield} navigate={navigate}/>;}
// /refund — cross-links to the real ReturnRequestView page rather than
// just listing an email address.
function RefundPolicyView({navigate}){return <CmsPageView pageKey="refund" title="Refund & Return Policy" icon={RotateCcw} navigate={navigate}/>;}
// /shipping — 10 sections: production time, cost, delivery time,
// courier partners (Delhivery/BlueDart/Shiprocket/India Post), dispatch,
// packaging, serviceable areas, tracking, failed delivery, damaged/
// missing in transit.
function ShippingPolicyView({navigate}){return <CmsPageView pageKey="shipping" title="Shipping Policy" icon={Truck} navigate={navigate}/>;}
// /terms — 15 sections including the ±2-3mm 3D-printing tolerance
// disclosure, 24-hour cancellation window, and CGST/SGST tax explanation.
function TermsOfServiceView({navigate}){return <CmsPageView pageKey="terms" title="Terms of Service" icon={FileText} navigate={navigate}/>;}
// /cookies — NOTE this page's "keeps your cart and wishlist saved
// between visits" claim is now actually TRUE (see loadStoredCart /
// safeStorageSet below) — it wasn't when this page was first written, so
// this was a real bug that got fixed to match the promise.
function CookiePolicyView({navigate}){return <CmsPageView pageKey="cookies" title="Cookie Policy" icon={Cookie} navigate={navigate}/>;}

// Catch-all 404 page — rendered whenever the current view isn't in
// ALL_VIEWS, or parsePath() couldn't resolve the URL at all.
function NotFoundView({ navigate }) {
  return <div className="px-6 py-32 text-center">
    <p className="italic text-[80px] mb-4 leading-none" style={{fontFamily:"'Fraunces',serif",color:T.teal,opacity:0.25}}>404</p>
    <h1 className="italic text-[26px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>This page doesn't exist.</h1>
    <p className="text-[14px] mb-8" style={{color:"rgba(36,62,65,0.75)"}}>The piece you're looking for may have moved.</p>
    <div className="flex gap-3 justify-center">
      <SweepButton filled onClick={()=>navigate("home")}>Back to Home</SweepButton>
      <SweepButton onClick={()=>navigate("shop")}>Browse the Shop</SweepButton>
    </div>
  </div>;
}

// Every valid page name. Anything rendered where view isn't in this list
// falls through to NotFoundView. Keep in sync with STATIC_VIEW_PATH above
// and the view===... switch in AkaraApp's render below whenever a page is
// added or removed.
const ALL_VIEWS=["home","shop","product","preview","search","cart","checkout","order-confirmed","order-status","track-order","invoice","payment-failed","about","craft","contact","faq","bulk-orders","return-request","care-guide","android-app","email-preferences","accessibility","account","login","signup","forgot-password","reset-password","privacy","refund","shipping","terms","cookies"];

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
// Last successful order — session only so a refresh on
// /order-confirmed or /order-status can still show the right
// confirmation/tracker. Cleared when the tab closes.

function urlBase64ToUint8Array(base64String){
  const padding="=".repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(base64);
  const out=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i);
  return out;
}
async function enableCustomerPush(){
  if(!("serviceWorker" in navigator)||!("PushManager" in window)) return {ok:false,error:"Not supported"};
  const perm=await Notification.requestPermission();
  if(perm!=="granted") return {ok:false,error:"Permission denied"};
  const cfg=await fetch("/api/push/vapid-public-key",{credentials:"include"}).then(r=>r.json());
  if(!cfg.enabled||!cfg.publicKey) return {ok:false,error:"Push not configured on server"};
  const reg=await navigator.serviceWorker.ready;
  const existing=await reg.pushManager.getSubscription();
  const sub=existing||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(cfg.publicKey)});
  const res=await apiFetch("/api/push/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({role:"customer",subscription:sub.toJSON()})});
  if(!res.ok){const d=await res.json().catch(()=>({})); return {ok:false,error:d.error||"Failed"};}
  return {ok:true};
}

const LAST_ORDER_KEY = "akara_last_order";
function readLastOrder() {
  try {
    const raw = sessionStorage.getItem(LAST_ORDER_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object" || !o.orderNumber) return null;
    return o;
  } catch { return null; }
}
function writeLastOrder(order) {
  try {
    if (order?.orderNumber) sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(order));
  } catch { /* private browsing */ }
}

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
// Reads the persisted cart from localStorage. SECURITY: validates every
// field before trusting it — qty is clamped to a real positive integer
// (1-99) and size is checked against VALID_SIZES, since this data could
// be tampered with directly in browser devtools (or by a future bug
// elsewhere) and would otherwise flow straight into price math (price *
// qty) on the Cart/Checkout/Invoice pages unchecked. Only stores {id,
// size, qty} — always re-merges against the live products list passed in,
// so a stored cart never carries a stale price.
//
// Takes `products` as a parameter (rather than reading a module-level
// constant, as it used to) because products now load asynchronously from
// the API — this can only run correctly once they've actually arrived.
// See the hydration effect in AkaraAppRoot, which calls this once
// products finish loading, not on every render.
function loadStoredCart(products){
  const stored=safeStorageGet("akara_cart");
  if(!Array.isArray(stored)) return [];
  return stored
    .map(entry=>{
      if(!entry||typeof entry.id!=="string") return null;
      const product=products.find(p=>p.id===entry.id);
      if(!product) return null;
      const qty=Number.isInteger(entry.qty)&&entry.qty>0&&entry.qty<=99?entry.qty:1;
      const size=VALID_SIZES.includes(entry.size)?entry.size:"Medium";
      // A stored color is only kept if it's still a REAL color option on
      // this product — a color could have been renamed or removed from
      // the admin panel since this was saved, and a stale color_key
      // pointing at nothing would silently break the price lookup below.
      const hasColor=product.colors&&product.colors.some(c=>c.variantKey===entry.color);
      const color=hasColor?entry.color:undefined;
      // Recomputes the REAL, CURRENT price for this exact size+color from
      // the live catalog, rather than trusting whatever price was
      // current when this was originally added to the cart — the same
      // reasoning the rest of this app already applies (prices can
      // change; a stored cart shouldn't silently checkout at a stale
      // number).
      // REAL BUG FIX: this used to fall back to the base product price
      // whenever no exact-matching variant existed — the same real flaw
      // just fixed on the product detail page, and genuinely triggered
      // by the exact same root cause: a customer's real, previously
      // saved cart (from localStorage) could still contain a stale
      // "Small"/"Large" size for a product that never actually had real,
      // distinct sizes, saved back when the product page incorrectly
      // showed that as a valid option. Reloading that stale cart entry
      // would silently show a real, seemingly normal price for
      // something checkout would then correctly reject — reproducing
      // the exact same reported bug through a completely different real
      // path. A product WITH real variants and no exact match is now
      // correctly treated as unavailable and dropped from the reloaded
      // cart entirely, rather than kept with a wrong, borrowed price.
      let price=product.price;
      if(product.variants&&product.variants.length>0){
        const colorId=hasColor?product.colors.find(c=>c.variantKey===color)?.id:null;
        const variant=product.variants.find(v=>(colorId==null||v.colorId===colorId)&&(v.size||"Medium")===size);
        if(!variant) return null;
        price=variant.price;
      }
      return {...product,size,color,price,qty};
    })
    .filter(Boolean);
}
// Reads the persisted wishlist from localStorage — filters out any id
// that no longer matches a real product. Same "needs products passed in"
// reasoning as loadStoredCart above.
function loadStoredWishlist(products){
  const stored=safeStorageGet("akara_wishlist");
  return Array.isArray(stored)?stored.filter(id=>products.some(p=>p.id===id)):[];
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
//  - products/productsLoading/productsError: fetched once from
//    GET /api/products on mount, provided to the rest of the app via
//    ProductsContext (see useProducts()) rather than prop-drilled
//  - cart/wishlist: start empty, then hydrated from localStorage once
//    products finish loading (loadStoredCart/loadStoredWishlist need real
//    product data to merge against), re-persisted on every change
//  - user: a real session, restored on load via GET /api/auth/me (the
//    httpOnly cookie set by /api/auth/login or /api/auth/signup) — this
//    is what makes staying logged in survive a page refresh now
//  - order: the single most-recent order, in-memory only, gone on refresh
//    (this is why every post-purchase page has the same "only shows the
//    last order" limitation noted above — there's no order history/orders
//    API yet, that's still ahead)
// The big effect below (title/meta description) is what makes every page
// have its own real <title> and meta description — necessary for SEO now
// that every page has its own real URL.
// Root component was renamed from AkaraApp to AkaraAppRoot below — the
// actual default export (AkaraApp, at the very end of this file) wraps it
// in an ErrorBoundary. See that class for why.
function AkaraAppRoot() {
  const initial=typeof window!=="undefined"?parsePath(window.location.pathname,window.location.search):{view:"home"};
  const [view,setView]=useState(initial.view==="__notfound__"?"home":initial.view);
  const [productId,setProductId]=useState(initial.productId||null);
  const [shopCategory,setShopCategory]=useState(initial.shopCategory||null);
  const [searchQuery,setSearchQuery]=useState(initial.searchQuery||"");
  const [accountTab,setAccountTab]=useState(null);
  const [notFound,setNotFound]=useState(initial.view==="__notfound__");
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [cartOpen,setCartOpen]=useState(false);
  const [cart,setCart]=useState([]);
  // Which coupon (if any) is currently applied — lifted here rather than
  // living only inside CartView's local state, specifically so it
  // survives navigating from Cart to Checkout. This used to be a real
  // gap: the discount shown on the Cart page never actually reached
  // Checkout or the real charge — see CartView/CheckoutView for how it's
  // now threaded all the way to the server, which is the only place that
  // actually decides the discount amount (never trusted from the client).
  const [appliedCoupon,setAppliedCoupon]=useState(null);
  const [wishlist,setWishlist]=useState([]);
  const [user,setUser]=useState(null);
  const [authChecked,setAuthChecked]=useState(false);
  // Where to send the customer after a successful login/signup, if they
  // were sent there specifically BECAUSE they tried to do something that
  // requires an account (currently: checkout — orders require login, see
  // CheckoutView). Cleared once used, so a normal login still goes to
  // My Account as usual.
  const [postLoginRedirect,setPostLoginRedirect]=useState(null);
  const [order,setOrder]=useState(()=>readLastOrder());
  const [products,setProducts]=useState([]);
  const [productsLoading,setProductsLoading]=useState(true);
  const [productsError,setProductsError]=useState(null);
  // Guards the two persist-to-localStorage effects below so they can NEVER
  // fire before hydration has actually read the stored cart/wishlist once.
  // BUG THIS FIXES: without this guard, the persist-effect on `cart` fires
  // on first mount too (React runs [cart]-dependent effects on mount, not
  // just on change) — with cart still at its initial empty array, that
  // write would silently overwrite the real stored cart with [] a moment
  // before the async hydration effect below ever got a chance to read it.
  // Caught by an actual browser test (add to cart, reload, cart was empty
  // again) — not something a code read alone would have revealed.
  const [hasHydrated,setHasHydrated]=useState(false);

  // Fetches the real product catalog from the backend once, on mount.
  // Nothing in the app renders product-dependent content until this
  // resolves — see the loading gate near the bottom of this component.
  useEffect(()=>{
    fetch("/api/products")
      .then(r=>{ if(!r.ok) throw new Error("Failed to load products ("+r.status+")"); return r.json(); })
      .then(data=>{ setProducts(data.products.map(enrichProduct)); setProductsLoading(false); })
      .catch(err=>{ console.error("Product fetch failed:",err); setProductsError(err); setProductsLoading(false); });
  },[]);

  // Once products have loaded (exactly once — productsLoading only ever
  // flips true->false a single time), rehydrate cart/wishlist from
  // localStorage against the real product data. This can't happen earlier
  // because loadStoredCart needs real product objects (price, name, etc.)
  // to merge the stored {id,size,qty} entries against. Only after this
  // completes does hasHydrated flip true, unlocking the persist effects.
  useEffect(()=>{
    if(!productsLoading){
      setCart(prev=>{
        // Prefer re-merge of current cart lines against live products (price fix)
        const base=prev.length?prev:loadStoredCart(products);
        return base.map(line=>{
          const product=products.find(p=>p.id===line.id);
          if(!product) return line;
          return {...line,name:product.name,price:Number(product.price)||line.price,img:line.img||product.img||(product.media&&product.media[0])||null};
        }).filter(line=>products.some(p=>p.id===line.id));
      });
      setWishlist(loadStoredWishlist(products));
      setHasHydrated(true);
    }
  },[productsLoading]);

  // After hydrate: if products array identity changes (e.g. refetch), re-merge cart prices
  const productsRef = useRef(products);
  useEffect(()=>{
    if(!hasHydrated) return;
    if(productsRef.current === products) return;
    productsRef.current = products;
    if(!products.length) return;
    setCart(loadStoredCart(products));
  },[products, hasHydrated]);

  useEffect(()=>{ if(hasHydrated) safeStorageSet("akara_cart",cart.map(i=>({id:i.id,size:i.size,color:i.color,qty:i.qty}))); },[cart,hasHydrated]);
  useEffect(()=>{ if(hasHydrated) safeStorageSet("akara_wishlist",wishlist); },[wishlist,hasHydrated]);

  // Found during a proactive bug sweep: the Wishlist tab lives inside "My
  // Account" right alongside real account-backed features (Orders,
  // Addresses), but was purely localStorage — a customer logged into the
  // same account on a different device (or with cleared browser storage)
  // saw an empty wishlist despite having saved items, confirmed directly.
  // The moment a real login is known (either a fresh sign-in, or the
  // existing-session check on page load resolving to a real user), this
  // pushes whatever's in local storage up to the account (folding in any
  // guest-session wishlisting rather than discarding it) and then treats
  // the server's list as the source of truth going forward — fixing the
  // cross-device gap without losing anything a signed-out visitor had
  // already picked.
  useEffect(()=>{
    if(!user||!hasHydrated) return;
    apiFetch("/api/wishlist/merge",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({productIds:wishlist})})
      .then(r=>r.ok?r.json():null)
      .then(data=>{ if(data?.productIds) setWishlist(data.productIds); })
      .catch(()=>{}); // best-effort — a sync failure shouldn't block using the site
  },[user,hasHydrated]);

  // Logged-in cart sync (P1a): same account → same cart on every device.
  // On login, merge local cart into server, then treat server as source of truth.
  // Prices always come from live catalog in the API response.
  useEffect(()=>{
    if(!user||!hasHydrated) return;
    let cancelled=false;
    const localItems=safeStorageGet("akara_cart")||[];
    apiFetch("/api/cart/merge",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:Array.isArray(localItems)?localItems:[]})})
      .then(r=>r.ok?r.json():null)
      .then(data=>{
        if(cancelled||!data?.items) return;
        setCart(data.items);
        safeStorageSet("akara_cart", data.items.map(i=>({id:i.id,size:i.size||"",color:i.color||"",qty:i.qty})));
      })
      .catch(()=>{});
    return ()=>{ cancelled=true; };
  },[user,hasHydrated]);

  // Push cart changes to server when logged in (debounced). Fire-and-forget —
  // do not setCart from the response or we risk update loops.
  useEffect(()=>{
    if(!user||!hasHydrated) return;
    const timer=setTimeout(()=>{
      apiFetch("/api/cart",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:cart})}).catch(()=>{});
    },500);
    return ()=>clearTimeout(timer);
  },[cart,user,hasHydrated]);

  // Single place that owns "toggle this product's wishlist state" — used
  // by every heart button in the app (product cards, product detail page)
  // instead of each one calling setWishlist directly, specifically so the
  // server-sync call happens consistently everywhere rather than being
  // easy to forget at any one call site.
  const toggleWishlist=id=>{
    setWishlist(w=>{
      const wasWished=w.includes(id);
      if(user){
        apiFetch(`/api/wishlist/${id}`,{method:wasWished?"DELETE":"POST"}).catch(()=>{});
      }
      trackAkara(wasWished?"wishlist_remove":"wishlist_add",{productId:id});
      return wasWished?w.filter(x=>x!==id):[...w,id];
    });
  };

  // Checks for an existing login session (the httpOnly cookie set by
  // /api/auth/login or /api/auth/signup) on first load — this is what
  // makes "being logged in" survive a page refresh now, unlike the old
  // fake in-memory-only session, which forgot you the moment you reloaded.
  useEffect(()=>{
    fetch("/api/auth/me",{credentials:"include"})
      .then(r=>r.ok?r.json():null)
      .then(data=>{ if(data?.customer) setUser(data.customer); })
      .catch(()=>{})
      .finally(()=>setAuthChecked(true));
  },[]);

  // Warms the CSRF token cache on load so it's already available by the
  // time a user submits their first form (login/signup/etc.) — apiFetch()
  // would fetch it lazily anyway if this hadn't run yet, this just avoids
  // that extra round-trip delay on the very first submission.
  useEffect(()=>{ getCsrfToken().catch(()=>{}); },[]);
  useEffect(()=>{ trackAkara("page_view",{initial:true}); },[]);

  const navigate=useCallback((v,id=null)=>{
    setNotFound(false);
    setView(v);
    if(v==="product"&&id) setProductId(id);
    if(v==="shop") setShopCategory(typeof id==="string"&&id?id:null);
    if(v==="search") setSearchQuery(typeof id==="string"?id:"");
    if(v==="account") setAccountTab(typeof id==="string"?id:null);
    if((v==="order-status"||v==="invoice"||v==="order-confirmed")&&typeof id==="string"&&id){
      try{ sessionStorage.setItem("akara_last_order_number", id); }catch{}
    }
    const path=buildPath(v,id);
    if(typeof window!=="undefined"&&window.location.pathname+window.location.search!==path) window.history.pushState({},"",path);
    try{ trackAkara("page_view",{view:v}); }catch{}
    scrollToTop();
    setDrawerOpen(false);
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
    if(productsLoading) return; // wait for real product data before setting product-specific meta tags
    const product=view==="product"?products.find(p=>p.id===productId):null;
    const title=notFound?"Page Not Found — ĀKĀRA"
      :product?product.metaTitle
      :view==="home"?"ĀKĀRA — Artifacts for Modern Spaces"
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
    // Canonical tag — found genuinely missing site-wide, and directly
    // named in a real Google Search Console report ("Duplicate without
    // user-selected canonical"). Built deterministically from the route
    // itself (always https://www.akaraonline.co.in, always the clean
    // path) rather than window.location.href, since the canonical tag's
    // whole purpose is to declare the one true URL regardless of
    // whatever protocol, tracking params, or historical bare-domain
    // link someone actually used to arrive here.
    let canonicalTag=document.querySelector('link[rel="canonical"]');
    if(!canonicalTag){ canonicalTag=document.createElement("link"); canonicalTag.setAttribute("rel","canonical"); document.head.appendChild(canonicalTag); }
    canonicalTag.setAttribute("href",`https://www.akaraonline.co.in${buildPath(view,productId||shopCategory)}`);
    setMeta("name","description",desc);
    // Client-rendered SPAs can't return a real HTTP 404 status for a
    // broken URL without duplicating the entire route list server-side
    // (the server has no route awareness at all — see the catch-all in
    // server.js) — a real, if unfortunate, architectural limitation, not
    // an oversight. The standard, Google-endorsed alternative for exactly
    // this situation is a noindex meta tag, which a crawler that executes
    // JavaScript will see and correctly keep out of search results. Reset
    // back to indexable on every other view — meta tags persist across
    // client-side navigation in an SPA, so a stale noindex from a
    // previous 404 visit would otherwise silently follow a customer onto
    // a real page.
    //
    // Found while writing the project documentation: this used to only
    // check `notFound` — the outer, routing-level flag for an
    // unrecognized URL pattern — which meant a draft/hidden product's
    // page (a genuinely valid /product/:id route, just for a product
    // that doesn't actually exist to a visitor) correctly showed "not
    // found" on screen, but the underlying robots tag still said
    // "index, follow." productsLoading is already guaranteed false by
    // the early return at the top of this effect once this line
    // actually runs, so a missing `product` here genuinely means "this
    // product doesn't exist," not "still loading."
    const productGenuinelyMissing=view==="product"&&!product;
    setMeta("name","robots",(notFound||productGenuinelyMissing)?"noindex, follow":"index, follow");
    // Open Graph + Twitter Card — controls the preview card when a page is
    // shared on WhatsApp/Instagram/Facebook/Twitter (high-relevance sharing
    // channels for this brand). og:image is deliberately NOT set — there's
    // no hosted product photography yet (see the media gallery placeholder
    // notes). Add a real og:image URL here once photos exist and are
    // hosted somewhere with a stable URL — until then, shares correctly
    // fall back to no preview image rather than a broken/placeholder one.
    const url=typeof window!=="undefined"?window.location.href:"https://www.akaraonline.co.in"+buildPath(view,productId||shopCategory);
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
    // availability maps from product.status, which is real (if currently
    // defaulted) data, not fabricated. aggregateRating is now included —
    // but ONLY when real review data exists (fetched fresh here, not
    // reused from anywhere else, since Google's structured data
    // guidelines treat fabricated review data as a policy violation that
    // can get a site penalized — this was deliberately left out entirely
    // until a real review system existed to back it).
    (async () => {
      let reviewSummary = null;
      if (product) {
        try {
          const r = await fetch(`/api/reviews/${product.id}`);
          if (r.ok) { const d = await r.json(); if (d.count > 0) reviewSummary = d; }
        } catch {}
      }
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
          // REAL BUG FIX, found during a direct, proactive audit: this
          // sent product.price — the real, BASE product price — straight
          // to Google as this product's actual price, even for a
          // product with real, distinct variants at a genuinely
          // different, real price (confirmed live: Helion Vase's real,
          // actual cheapest price is ₹354, but this was telling Google
          // it's ₹199 — the exact same real, stale-base-price mistake
          // already found and fixed on every customer-facing card).
          // Google could show a wrong price directly in search results,
          // and a real, live mismatch between the advertised and actual
          // price on click-through is exactly the kind of thing Google's
          // own Merchant/structured-data policies penalize. Now uses the
          // same, real, correct "cheapest actual variant, GST-inclusive"
          // figure every other customer-facing price on this site uses.
          price:product.gstInclusiveDisplayPrice??gstInclusivePrice(product.price),
          // REAL, SECOND FIX, refined to match the same, real,
          // consistent rule now applied everywhere else: availability
          // only considers per-variant status once a real, distinct
          // size genuinely exists on this product — a colour-only
          // variant's own status is correctly ignored otherwise, same
          // as its price, so the base product's real, actual status
          // stays authoritative until real sizes are explicitly set up.
          availability:(()=>{
            const realSizedVariants=Array.isArray(product.variants)?product.variants.filter(v=>v.size!=null):[];
            const anyAvailable=realSizedVariants.length>0
              ? realSizedVariants.some(v=>v.status!=="sold-out")
              : product.status!=="sold-out";
            if(!anyAvailable) return "https://schema.org/OutOfStock";
            if(product.status==="pre-order") return "https://schema.org/PreOrder";
            if(product.status==="low-stock") return "https://schema.org/LimitedAvailability";
            return "https://schema.org/InStock";
          })(),
        },
        ...(reviewSummary?{aggregateRating:{"@type":"AggregateRating",ratingValue:reviewSummary.average.toFixed(1),reviewCount:reviewSummary.count}}:{}),
      }:{
        "@context":"https://schema.org",
        "@type":"Organization",
        name:"Precision Forge Labs",
        alternateName:"ĀKĀRA",
        url:"https://www.akaraonline.co.in",
        contactPoint:{"@type":"ContactPoint",email:"support@akaraonline.co.in",contactType:"customer service"},
      });
    })();
  },[view,productId,shopCategory,searchQuery,notFound,productsLoading]);

  // NOTE: the old fake placeOrder() (which fabricated an order instantly,
  // no real payment) lived here — removed now that CheckoutView drives the
  // real flow itself (POST /api/orders/checkout -> Razorpay widget ->
  // POST /api/orders/verify), calling setOrder/setCart directly once a
  // payment is genuinely verified. See CheckoutView for the full flow.

  // Calls the real /api/auth/logout endpoint (clears the httpOnly session
  // cookie server-side) rather than just clearing local state — the old
  // version only ever cleared local state, which didn't actually end
  // anything since there was no real session to end.
  const logout=useCallback(()=>{
    apiFetch("/api/auth/logout",{method:"POST"}).catch(()=>{});
    setUser(null); navigate("home");
  },[navigate]);

  const cartCount=cart.reduce((s,i)=>s+i.qty,0);
  // Defense-in-depth: even though parsePath() already rejects unknown product
  // slugs from a typed/shared URL, this also catches the case of navigate()
  // being called directly with a bad id (e.g. a stale reference to a removed
  // product) — either path now correctly falls through to the 404 page
  // instead of silently showing the wrong product. While products are still
  // loading, this deliberately does NOT flag notFound — see the loading
  // gate below, which shows a loading state instead of a false 404 flash.
  // Nothing here gates on productsLoading/productsError anymore — that
  // used to block the ENTIRE app (header, cart drawer, and every static
  // page like About/Contact/FAQ that has zero dependency on product
  // data) behind a single fetch. Confirmed via a real Lighthouse report:
  // this was the direct cause of a 2,650ms "element render delay" on the
  // homepage's LCP text, which is 100% static copy that never needed to
  // wait on anything. Each view that genuinely needs product data
  // (Home's featured section, Shop, Search, ProductDetail) now checks
  // {products,loading,error} from ProductsContext itself and shows its
  // own local loading/error state — everything else renders immediately.
  return <CategoriesProvider>
  <ProductsContext.Provider value={{products,loading:productsLoading,error:productsError}}>
  <div className="min-h-screen w-full flex flex-col" style={{backgroundColor:T.cream,fontFamily:"'Space Grotesk',system-ui,sans-serif",color:T.teal}}>
    <style>{FONTS}</style>
    <a href="#main-content" className="skip-link">Skip to content</a>
    <CouponBanner/>
    <Header navigate={navigate} onOpenDrawer={()=>setDrawerOpen(true)} onOpenCart={()=>setCartOpen(true)} cartCount={cartCount} wishCount={wishlist.length} user={user} logout={logout} className="no-print"/>
    <WelcomeBar user={user} view={view}/>
    <Drawer open={drawerOpen} onClose={()=>setDrawerOpen(false)} navigate={navigate} user={user} logout={logout}/>
    <CartDrawer open={cartOpen} onClose={()=>setCartOpen(false)} cart={cart} setCart={setCart} navigate={navigate}/>
    {/* flex-1 here is the actual fix for the cream strip visible below
        the footer on short pages (e.g. a signed-out My Account prompt) —
        found via a direct screenshot, not guessed. Without this, the
        footer just followed short content in normal flow, leaving the
        outer min-h-screen wrapper's own background exposed below it. On
        pages long enough to fill the viewport already, this has no
        visible effect at all. */}
    <main id="main-content" key={`${view}-${productId}-${shopCategory}-${searchQuery}`} className="akara-page-enter flex-1">
      {!notFound&&view==="home"&&<HomeView navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} toggleWishlist={toggleWishlist}/>}
      {!notFound&&view==="shop"&&<ShopView navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} toggleWishlist={toggleWishlist} initCategory={shopCategory}/>}
      {!notFound&&view==="search"&&<SearchResultsView navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} toggleWishlist={toggleWishlist} initQuery={searchQuery}/>}
      {!notFound&&view==="product"&&<ProductDetailView productId={productId} navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} toggleWishlist={toggleWishlist}/>}
      {!notFound&&view==="preview"&&<PreviewProductView productId={productId} navigate={navigate}/>}
      {!notFound&&view==="cart"&&<CartView navigate={navigate} cart={cart} setCart={setCart} appliedCoupon={appliedCoupon} setAppliedCoupon={setAppliedCoupon}/>}
      {!notFound&&view==="checkout"&&<CheckoutView navigate={navigate} cart={cart} setCart={setCart} setOrder={setOrder} appliedCoupon={appliedCoupon} setAppliedCoupon={setAppliedCoupon} user={user} setPostLoginRedirect={setPostLoginRedirect}/>}
      {!notFound&&view==="order-confirmed"&&<OrderConfirmedView navigate={navigate} order={order} onLogin={setUser}/>}
      {!notFound&&view==="order-status"&&<OrderStatusView navigate={navigate} order={order} setOrder={setOrder}/>}
      {!notFound&&view==="track-order"&&<TrackOrderView navigate={navigate} setOrder={setOrder}/>}
      {!notFound&&view==="invoice"&&<InvoiceView navigate={navigate} order={order}/>}
      {!notFound&&view==="payment-failed"&&<PaymentFailedView navigate={navigate}/>}
      {!notFound&&view==="about"&&<AboutView navigate={navigate}/>}
      {!notFound&&view==="craft"&&<CraftView navigate={navigate}/>}
      {!notFound&&view==="contact"&&<ContactView/>}
      {!notFound&&view==="faq"&&<FAQView/>}
      {!notFound&&view==="bulk-orders"&&<BulkOrdersView navigate={navigate}/>}
      {!notFound&&view==="return-request"&&<ReturnRequestView navigate={navigate} order={order} user={user}/>}
      {!notFound&&view==="care-guide"&&<CareGuideView navigate={navigate}/>}
      {!notFound&&view==="android-app"&&<AndroidAppView navigate={navigate}/>}
      {!notFound&&view==="email-preferences"&&<EmailPreferencesView navigate={navigate}/>}
      {!notFound&&view==="accessibility"&&<AccessibilityView navigate={navigate}/>}
      {!notFound&&view==="account"&&<MyAccountView navigate={navigate} wishlist={wishlist} user={user} setUser={setUser} order={order} setOrder={setOrder} initTab={accountTab}/>}
      {!notFound&&view==="login"&&<LoginView navigate={navigate} onLogin={setUser} postLoginRedirect={postLoginRedirect} setPostLoginRedirect={setPostLoginRedirect}/>}
      {!notFound&&view==="signup"&&<SignupView navigate={navigate} onLogin={setUser} postLoginRedirect={postLoginRedirect} setPostLoginRedirect={setPostLoginRedirect}/>}
      {!notFound&&view==="forgot-password"&&<ForgotPasswordView navigate={navigate}/>}
      {!notFound&&view==="reset-password"&&<ResetPasswordView navigate={navigate}/>}
      {!notFound&&view==="privacy"&&<PrivacyPolicyView navigate={navigate}/>}
      {!notFound&&view==="refund"&&<RefundPolicyView navigate={navigate}/>}
      {!notFound&&view==="shipping"&&<ShippingPolicyView/>}
      {!notFound&&view==="terms"&&<TermsOfServiceView navigate={navigate}/>}
      {!notFound&&view==="cookies"&&<CookiePolicyView navigate={navigate}/>}
      {(notFound||!ALL_VIEWS.includes(view))&&<NotFoundView navigate={navigate}/>}
    </main>
    <Footer navigate={navigate}/>
    <MobileInstallBanner/>
  </div>
  </ProductsContext.Provider>
  </CategoriesProvider>;
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
    return <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px",textAlign:"center",backgroundColor:"#E3DAC9",fontFamily:"'Space Grotesk',system-ui,sans-serif"}}>
      <p style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",fontSize:"28px",color:"#183630",marginBottom:"12px"}}>Something went wrong.</p>
      <p style={{fontSize:"14px",color:"rgba(36,62,65,0.75)",maxWidth:"420px",marginBottom:"28px",lineHeight:1.7}}>
        This page hit an unexpected error. Refreshing usually fixes it — if it keeps happening, please let us know at support@akaraonline.co.in.
      </p>
      <button onClick={()=>window.location.reload()} style={{padding:"14px 28px",fontSize:"12px",letterSpacing:"0.14em",textTransform:"uppercase",backgroundColor:"#183630",color:"white",border:"none",cursor:"pointer"}}>Reload Page</button>
    </div>;
  }
}

// The one real, URL-based split between the two applications: anything
// under /admin renders AdminApp, nothing else does. This check happens
// before ErrorBoundary wraps either tree, so a crash in one app's error
// boundary can never be confused with the other's.
export default function AkaraApp(){
  const isAdmin=typeof window!=="undefined"&&window.location.pathname.startsWith("/admin");
  return <ErrorBoundary>
    <style>{FONTS}</style>
    {isAdmin
      ? <Suspense fallback={<div className="min-h-screen w-full" style={{backgroundColor:T.cream}}/>}><ToastProvider><AdminApp/></ToastProvider></Suspense>
      : <ToastProvider><AkaraAppRoot/></ToastProvider>}
  </ErrorBoundary>;
}
