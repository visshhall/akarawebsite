import { useState, useEffect, useRef, useCallback, useContext, createContext, Component, lazy, Suspense } from "react";
import {
  Menu, X, Search, Heart, User, ShoppingBag,
  ArrowUpRight, Star, Lock, RotateCcw, Minus, Plus,
  Trash2, Eye, EyeOff, ChevronDown, ChevronRight,
  MapPin, Phone, Mail, Instagram, AlertCircle, Check,
  Package, ClipboardCheck, Truck, XCircle, Play, Film, Leaf,
  Shield, FileText, Cookie, Accessibility, LogOut,
} from "lucide-react";
import { T, FONTS, sanitize, apiFetch, getCsrfToken, Mac, SweepButton, InputField, ToastProvider, useToast, Skeleton, Modal, ELEVATION, RADIUS, ICON } from "./shared.jsx";
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
  // NOTE: this used to validate the product id against PRODUCTS here, but
  // products are now fetched asynchronously (see ProductsContext in
  // AkaraAppRoot) and won't be available yet when this runs on first page
  // load. Existence is now validated once products finish loading — see
  // the `productExists` check in AkaraAppRoot — so a bad product slug
  // still correctly ends up on the 404 page, just slightly later.
  if(parts[0]==="product"&&parts[1]) return {view:"product",productId:parts[1]};
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

// Maps each category to its icon component. enrichProduct() (below) uses
// this to attach the right icon to every product based on its category.
const CAT_ART = { "Planters":PlanterArt, "Vases":VaseArt, "Ceiling Lighting":CeilingLampArt, "Table Lamps":TableLampArt, "Lanterns":LanternArt, "Floor Lamps":FloorLampArt };
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
function enrichProduct(p) {
  return {
    ...p,
    media: p.media && p.media.length > 0 ? p.media : defaultMedia(),
    Art: CAT_ART[p.cat] || PlanterArt,
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
function Header({ navigate, onOpenDrawer, onOpenCart, cartCount, wishCount, user, className="" }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { const fn=()=>setScrolled(window.scrollY>40); window.addEventListener("scroll",fn); return ()=>window.removeEventListener("scroll",fn); }, []);
  // Search now lives directly inside the header's own layout — found
  // genuinely necessary after the earlier redesign still read as "a box
  // appearing below the icon" even once it was compact and rounded: any
  // position:fixed panel anchored near the header still visually reads
  // as a separate floating element, not part of the header itself. The
  // only way to guarantee it's genuinely IN the header is for the header
  // to render it directly, replacing its own normal content while
  // active — not a sibling overlay positioned nearby.
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const { products } = useProducts();
  const inputRef = useRef(null);
  useEffect(()=>{ if(searchOpen) setTimeout(()=>inputRef.current?.focus(),50); },[searchOpen]);
  const trimmed=q.trim();
  const allMatches = trimmed.length>1 ? products.filter(p=>p.name.toLowerCase().includes(q.toLowerCase())||p.cat.toLowerCase().includes(q.toLowerCase())) : [];
  const matches = allMatches.slice(0,6);
  const closeSearch=()=>{ setSearchOpen(false); setQ(""); };
  const goToResults=()=>{ if(trimmed.length>1){ navigate("search",trimmed); closeSearch(); } };

  return <header className={"sticky top-0 z-40 grid items-center h-[68px] px-6 md:px-12 relative "+className} style={{ gridTemplateColumns:"auto 1fr auto", gap:"16px", backgroundColor:scrolled?"rgba(255,242,223,0.97)":"rgba(255,242,223,0.88)", backdropFilter:"blur(20px)", borderBottom:"1px solid rgba(36,62,65,0.09)" }}>
    {searchOpen ? <>
      <button aria-label="Close search" onClick={closeSearch} className="justify-self-start p-2 -ml-2" style={{ color:T.teal }}><X size={20} strokeWidth={1.5}/></button>
      <form onSubmit={e=>{e.preventDefault();goToResults();}} role="search" aria-label="Search products" className="flex items-center gap-2.5 px-4" style={{ backgroundColor:"rgba(36,62,65,0.06)", borderRadius:RADIUS.lg, height:"42px" }}>
        <Search size={15} style={{ color:"rgba(36,62,65,0.4)", flexShrink:0 }}/>
        <input ref={inputRef} value={q} onChange={e=>setQ(sanitize(e.target.value))} placeholder="Search products…" maxLength={100}
          className="flex-1 bg-transparent outline-none text-[14px]" style={{ color:T.teal }}/>
      </form>
      <button aria-label="Search" onClick={goToResults} className="justify-self-end p-2.5" style={{ color:T.teal }}><Search size={17} strokeWidth={1.5}/></button>
      {(matches.length>0 || (trimmed.length>1 && allMatches.length===0)) &&
        <div className="absolute left-4 right-4 md:left-12 md:right-12 top-full mt-2 overflow-hidden" style={{ backgroundColor:T.cream, borderRadius:RADIUS.md, boxShadow:"0 24px 60px -16px rgba(36,62,65,0.35)" }}>
          {matches.length>0 ? <div className="px-5 py-2 overflow-y-auto" style={{maxHeight:"50vh"}}>
            {matches.map(m=><button key={m.id} onClick={()=>{ navigate("product",m.id); closeSearch(); }}
              className="flex justify-between w-full py-2.5 text-[13px] text-left" style={{ color:T.teal, borderTop:"1px solid rgba(36,62,65,0.07)" }}>
              <span>{m.name}</span><span style={{ color:T.teal }}>₹{m.price}</span>
            </button>)}
            <button onClick={goToResults} className="w-full py-2.5 text-[12px] uppercase tracking-[0.08em] text-left" style={{ color:T.teal, borderTop:"1px solid rgba(36,62,65,0.07)" }}>
              See all {allMatches.length} result{allMatches.length>1?"s":""} for "{trimmed}" →
            </button>
          </div> : <p className="px-5 py-4 text-[12.5px]" style={{color:"rgba(36,62,65,0.45)"}}>No quick matches — press Enter to search the full collection.</p>}
        </div>}
    </> : <>
      <button aria-label="Open menu" onClick={onOpenDrawer} className="justify-self-start p-2 -ml-2" style={{ color:T.teal }}><Menu size={20} strokeWidth={1.5}/></button>
      <button onClick={()=>navigate("home")} className="justify-self-center flex items-center uppercase" style={{ fontFamily:"'Fraunces',serif", fontWeight:500, fontSize:"19px", color:T.teal, letterSpacing:"0.24em" }}>
        <Mac>A</Mac><span>K</span><Mac>A</Mac><span>RA</span>
      </button>
      <div className="justify-self-end flex items-center gap-0.5">
        <button aria-label="Search" onClick={()=>setSearchOpen(true)} className="p-2.5" style={{ color:T.teal }}><Search size={17} strokeWidth={1.5}/></button>
        <button aria-label={user?"My Account":"Sign In"} onClick={()=>navigate(user?"account":"login")} className="p-2.5" style={{ color:T.teal }}><User size={17} strokeWidth={1.5}/></button>
        <button aria-label="View Wishlist" onClick={()=>navigate("account","Wishlist")} className="relative p-2.5" style={{ color:T.teal }}>
          <Heart size={17} strokeWidth={1.5}/>
          {wishCount>0 && <span className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-medium text-white" style={{ backgroundColor:T.gold }}>{wishCount}</span>}
        </button>
        <button aria-label="Cart" onClick={onOpenCart} className="relative p-2.5" style={{ color:T.teal }}>
          <ShoppingBag size={17} strokeWidth={1.5}/>
          {cartCount>0 && <span className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-medium text-white" style={{ backgroundColor:T.gold }}>{cartCount}</span>}
        </button>
      </div>
    </>}
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
            <button onClick={()=>go("shop")} className="w-full text-left py-2.5 text-[13px] flex items-center gap-2" style={{ color:T.teal, borderBottom:"1px solid rgba(36,62,65,0.08)" }}>
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
          <p className="text-[11px] tracking-[0.08em] uppercase mb-4" style={{ color:"rgba(36,62,65,0.5)" }}>Signed in as {user.name}</p>
          <button onClick={()=>go("account")} className="w-full flex items-center gap-3 px-4 py-3 mb-2.5 text-[13.5px]" style={{ color:T.teal, backgroundColor:"rgba(36,62,65,0.05)", borderRadius:RADIUS.sm }}>
            <User size={15} style={{color:T.gold}}/> My Account
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
  const updateQty=(id,size,d)=>setCart(c=>c.map(i=>i.id===id&&i.size===size?{...i,qty:Math.min(99,Math.max(1,i.qty+d))}:i));
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
        : cart.map(item=>{ const ItemArt=item.Art||PlanterArt; return <div key={item.id+item.size} className="flex gap-4 mb-5">
          <div className="w-20 h-20 flex items-center justify-center shrink-0" style={{ backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md }}>
            <ItemArt className="w-3/5 h-3/5" style={{ color:T.gold,opacity:0.8 }}/>
          </div>
          <div className="flex-1">
            <h3 className="text-[13px] italic mb-0.5" style={{ fontFamily:"Fraunces,serif",color:T.teal }}>{item.name}</h3>
            {item.size&&<p className="text-[11px] mb-1" style={{ color:"rgba(36,62,65,0.45)" }}>Size: {item.size}</p>}
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="inline-flex items-center" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs}}>
                <button onClick={()=>updateQty(item.id,item.size,-1)} className="w-7 h-7 flex items-center justify-center" style={{color:T.teal}} aria-label={`Decrease quantity of ${item.name}`}><Minus size={11}/></button>
                <span className="w-6 text-center text-[12.5px]" style={{fontFamily:"'Fraunces',serif"}}>{item.qty}</span>
                <button onClick={()=>updateQty(item.id,item.size,1)} className="w-7 h-7 flex items-center justify-center" style={{color:T.teal}} aria-label={`Increase quantity of ${item.name}`}><Plus size={11}/></button>
              </div>
              <p className="text-[13px]" style={{ color:T.teal }}>₹{item.price*item.qty}</p>
            </div>
            <button onClick={()=>setCart(c=>c.filter(i=>!(i.id===item.id&&i.size===item.size)))} className="flex items-center gap-1 text-[11px] uppercase tracking-wide" style={{ color:"rgba(36,62,65,0.4)" }}><Trash2 size={11}/> Remove</button>
          </div>
        </div>;})}
      </div>
      {cart.length>0&&<div className="p-6" style={{ borderTop:"1px solid rgba(36,62,65,0.1)" }}>
        <div className="flex justify-between mb-4">
          <span className="text-[13px]" style={{ color:"rgba(36,62,65,0.6)" }}>Subtotal</span>
          <span className="text-[17px]" style={{ fontFamily:"Fraunces,serif",color:T.teal }}>₹{total.toLocaleString("en-IN")}</span>
        </div>
        <SweepButton filled onClick={()=>{ onClose(); navigate("checkout"); }} className="w-full">Checkout</SweepButton>
        <button onClick={()=>{ onClose(); navigate("cart"); }} className="w-full py-3 text-[11px] tracking-[0.08em] uppercase mt-2" style={{ color:"rgba(36,62,65,0.5)" }}>View Full Cart</button>
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
  return <footer className="no-print" style={{backgroundColor:T.teal}}>
    <div className="px-8 md:px-14 pt-14 pb-10 max-w-[1600px] mx-auto">
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
              [MapPin,"India",null]
            ].map(([Icon,label,href])=><div key={label} className="flex items-start gap-2.5">
              <Icon size={13} style={{color:T.cream,flexShrink:0,marginTop:"2px"}}/>
              {href?<a href={href} className="text-[12.5px] hover:text-white transition-colors break-words min-w-0" style={{color:"rgba(255,255,255,0.55)"}}>{label}</a>
                :<span className="text-[12.5px] break-words min-w-0" style={{color:"rgba(255,255,255,0.55)"}}>{label}</span>}
            </div>)}
          </div>
        </div>
        <div>
          <p className="text-[10.5px] tracking-[0.14em] uppercase mb-5" style={{color:T.cream}}>Collections</p>
          {["All Products",...CATEGORIES].map((c,i)=><button key={c} onClick={()=>navigate("shop",i===0?null:c)}
            className="block text-[13px] mb-3 text-left hover:text-white transition-colors" style={{color:"rgba(255,255,255,0.55)"}}>{c}</button>)}
        </div>
        <div>
          <p className="text-[10.5px] tracking-[0.14em] uppercase mb-5" style={{color:T.cream}}>Company</p>
          {[["About","about"],["The Craft","craft"],["Contact","contact"],["FAQ","faq"],["Care Guide","care-guide"],["Bulk & Corporate Orders","bulk-orders"],["My Account","account"]].map(([l,v])=><button key={v} onClick={()=>navigate(v)}
            className="block text-[13px] mb-3 text-left hover:text-white transition-colors" style={{color:"rgba(255,255,255,0.55)"}}>{l}</button>)}
        </div>
        <div>
          <p className="text-[10.5px] tracking-[0.14em] uppercase mb-5" style={{color:T.cream}}>Stay in the Loop</p>
          <p className="text-[13px] leading-[1.7] mb-4" style={{color:"rgba(255,255,255,0.5)"}}>New pieces, restocks — nothing more often than that.</p>
          <NewsletterForm/>
        </div>
      </div>
    </div>
    <div style={{borderTop:"1px solid rgba(255,255,255,0.1)"}}>
      <div className="px-8 md:px-14 py-6 max-w-[1600px] mx-auto flex flex-col sm:flex-row justify-between gap-3">
        <p className="text-[11.5px]" style={{color:"rgba(255,255,255,0.4)"}}>© 2025–2026 Precision Forge Labs. All rights reserved.</p>
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
function ProductCard({ product, navigate, cart, setCart, wishlist, toggleWishlist }) {
  const {id,name,cat,price,Art}=product;
  const [hover,setHover]=useState(false);
  const isWished=wishlist.includes(id);
  const toggleWish=e=>{ e.stopPropagation(); toggleWishlist(id); };
  const addToCart=e=>{
    e.stopPropagation();
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
  const cartQty=cart.find(i=>i.id===id&&!i.size)?.qty||0;
  const updateQty=(e,d)=>{ e.stopPropagation(); setCart(c=>c.map(i=>i.id===id&&!i.size?{...i,qty:Math.min(99,Math.max(0,i.qty+d))}:i).filter(i=>!(i.id===id&&!i.size&&i.qty<=0))); };
  return <div className="group relative flex flex-col cursor-pointer transition-transform duration-500 ease-out"
    style={{transform:hover?"translateY(-5px)":"translateY(0)"}}
    onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} onClick={()=>navigate("product",id)}>
    <div className="relative aspect-square flex items-center justify-center overflow-hidden transition-shadow duration-500"
      style={{backgroundColor:T.card,boxShadow:hover?"0 24px 50px -20px rgba(36,62,65,0.26),0 0 0 1px rgba(184,147,90,0.28)":"0 6px 22px -12px rgba(36,62,65,0.12),0 0 0 1px rgba(36,62,65,0.06)",borderRadius:RADIUS.md}}>
      <div className="w-2/5 h-2/5 transition-transform duration-700 ease-out" style={{color:T.gold,opacity:0.82,transform:hover?"scale(1.1)":"scale(1)"}}>
        <Art/>
      </div>
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
      {cartQty===0
        ?<button onClick={addToCart} aria-label={`Add ${name} to cart`} className="absolute bottom-3.5 right-3.5 w-9 h-9 flex items-center justify-center" style={{backgroundColor:T.teal,borderRadius:RADIUS.sm}}>
          <ShoppingBag size={15} style={{color:"white"}}/>
        </button>
        :<div onClick={e=>e.stopPropagation()} className="absolute bottom-3.5 right-3.5 flex items-center" style={{backgroundColor:T.teal,borderRadius:RADIUS.sm}}>
          <button onClick={e=>updateQty(e,-1)} aria-label={`Decrease quantity of ${name}`} className="w-8 h-9 flex items-center justify-center"><Minus size={12} style={{color:"white"}}/></button>
          <span className="text-[12.5px] text-white px-0.5 min-w-[16px] text-center">{cartQty}</span>
          <button onClick={e=>updateQty(e,1)} aria-label={`Increase quantity of ${name}`} className="w-8 h-9 flex items-center justify-center"><Plus size={12} style={{color:"white"}}/></button>
        </div>}
    </div>
    <div className="pt-4 flex items-start justify-between gap-2">
      <div>
        <p className="text-[10px] tracking-[0.12em] uppercase mb-1" style={{color:"rgba(36,62,65,0.4)"}}>{cat}</p>
        <h3 className="text-[15px] italic" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{name}</h3>
      </div>
      <p className="text-[14px] shrink-0 pt-0.5" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{price}</p>
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
  return <div className="fixed inset-0 z-[200] flex items-center justify-center px-4" style={{backgroundColor:"rgba(36,62,65,0.55)"}} onClick={dismiss}>
    <div onClick={e=>e.stopPropagation()} className="w-full max-w-[440px] p-8 text-center relative" style={{backgroundColor:T.cream,borderRadius:RADIUS.md,boxShadow:ELEVATION.modal}}>
      <button onClick={dismiss} aria-label="Close maintenance notice" className="absolute top-4 right-4 p-1" style={{color:"rgba(36,62,65,0.4)"}}><X size={18}/></button>
      <p className="text-[40px] mb-4" aria-hidden="true">🚧</p>
      <p className="italic text-[22px] mb-3" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>We're still building this.</p>
      <p className="text-[14px] leading-[1.7] mb-7" style={{color:"rgba(36,62,65,0.65)"}}>{message}</p>
      <SweepButton filled onClick={dismiss}>Got It</SweepButton>
    </div>
  </div>;
}
function HomeView({ navigate, cart, setCart, wishlist, toggleWishlist }) {
  const { products } = useProducts();
  const [reveal,setReveal]=useState(false);
  const [mouse,setMouse]=useState({x:0,y:0});
  const heroRef=useRef(null);
  useEffect(()=>{ const t=setTimeout(()=>setReveal(true),120); return ()=>clearTimeout(t); },[]);
  const onMove=e=>{ const r=heroRef.current.getBoundingClientRect(); setMouse({x:(e.clientX-r.left)/r.width-0.5,y:(e.clientY-r.top)/r.height-0.5}); };
  const featured=products.slice(0,3);
  // Category quick-filter for the homepage's featured section — previously
  // this always showed the same fixed 3 products with no way to browse
  // further without leaving for the full Shop page.
  const [homeCategory,setHomeCategory]=useState("All");
  const homeFiltered=(homeCategory==="All"?products:products.filter(p=>p.cat===homeCategory)).slice(0,6);
  return <div>
    <MaintenanceNotice/>
    <section ref={heroRef} onMouseMove={onMove} className="relative flex flex-col items-center justify-end text-center px-6 overflow-hidden"
      style={{minHeight:"85vh",paddingBottom:"5vh"}}>
      <LightWash mx={mouse.x} my={mouse.y}/>
      <p className={`relative z-10 text-[12px] tracking-[0.32em] uppercase mb-7 transition-all duration-700 ${reveal?"opacity-100 translate-y-0":"opacity-0 translate-y-2"}`} style={{color:T.teal}}>Est. Mumbai · Made to Order</p>
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
        {[[Leaf,"3D-printed with plant-based PLA"],[RotateCcw,"7-day returns · 30-day warranty"],[Lock,"Secure checkout via Razorpay"],[MapPin,"Handcrafted to order in Mumbai"]]
          .map(([Icon,label])=><div key={label} className="flex items-center gap-2" style={{color:"rgba(36,62,65,0.55)"}}>
            <Icon size={13} style={{color:T.gold,flexShrink:0}}/><span className="text-[12px]">{label}</span>
          </div>)}
      </div>
    </section>
    <section className="px-6 md:px-14 py-14 md:py-20 max-w-[1600px] mx-auto">
      <div className="text-center mb-12">
        <p className="text-[12px] tracking-[0.3em] uppercase mb-4" style={{color:T.teal}}>Shop by Category</p>
        <h2 className="italic text-[28px] md:text-[36px]" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>Find your form.</h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {CATEGORIES.map(c=>{ const Art=CAT_ART[c]; return <button key={c} onClick={()=>navigate("shop",c)}
          className="group flex flex-col items-center justify-center gap-3 py-8 px-3 text-center transition-shadow duration-300"
          style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
          <div className="w-14 h-14 flex items-center justify-center transition-transform duration-500 group-hover:scale-110" style={{backgroundColor:"rgba(184,147,90,0.12)",borderRadius:RADIUS.sm}}>
            <div className="w-7 h-7" style={{color:T.gold}}><Art/></div>
          </div>
          <span className="text-[12px]" style={{color:T.teal}}>{c}</span>
        </button>;})}
      </div>
    </section>
    <section className="px-6 md:px-14 py-14 md:py-20 max-w-[1600px] mx-auto">
      <div className="text-center mb-12">
        <p className="text-[12px] tracking-[0.3em] uppercase mb-4" style={{color:T.teal}}>Why ĀKĀRA</p>
        <h2 className="italic text-[28px] md:text-[36px]" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>Built differently, on purpose.</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          [Package,"Made to Order","Every piece is printed specifically for you — nothing sits pre-made on a shelf."],
          [Leaf,"Plant-Based Material","Printed in PLA, a plant-derived material — a more conscious choice than standard plastics."],
          [MapPin,"Designed in Mumbai","Every form is designed, printed, and finished in our own studio, start to finish."],
          [RotateCcw,"7-Day Returns","Damaged, defective, or not as described — a real 7-day window, no fine print."],
        ].map(([Icon,title,desc])=><div key={title} className="p-7 text-center" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
          <div className="w-11 h-11 flex items-center justify-center mb-5 mx-auto" style={{backgroundColor:"rgba(184,147,90,0.12)",borderRadius:RADIUS.sm}}>
            <Icon size={ICON.md} style={{color:T.gold}}/>
          </div>
          <h3 className="text-[15px] mb-2" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>{title}</h3>
          <p className="text-[13px] leading-[1.6]" style={{color:"rgba(36,62,65,0.6)"}}>{desc}</p>
        </div>)}
      </div>
    </section>
    <section className="px-6 md:px-14 py-14 md:py-20 max-w-[1600px] mx-auto">
      <div className="flex items-end justify-between mb-12 flex-wrap gap-6">
        <div>
          <p className="text-[12px] tracking-[0.3em] uppercase mb-4" style={{color:T.teal}}>The Collection</p>
          <h2 className="italic text-[32px] md:text-[42px]" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>New this season.</h2>
        </div>
        <button onClick={()=>navigate("shop")} className="group flex items-center gap-2 text-[12px] tracking-[0.1em] uppercase pb-1 border-b" style={{borderColor:"rgba(36,62,65,0.2)",color:T.teal}}>
          View All <ArrowUpRight size={14} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"/>
        </button>
      </div>
      <div className="flex gap-2 mb-8 overflow-x-auto pb-1">
        {["All",...CATEGORIES].map(c=><button key={c} onClick={()=>setHomeCategory(c)}
          className="shrink-0 px-4 py-2 text-[11.5px] tracking-[0.06em] uppercase transition-colors"
          style={{backgroundColor:homeCategory===c?T.teal:"transparent",color:homeCategory===c?"white":T.teal,border:`1px solid ${homeCategory===c?T.teal:"rgba(36,62,65,0.2)"}`,borderRadius:RADIUS.xs}}>
          {c}
        </button>)}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-10 md:gap-8">
        {homeFiltered.map(p=><ProductCard key={p.id} product={p} navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} toggleWishlist={toggleWishlist}/>)}
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
          <p className="text-[10px] tracking-[0.08em] uppercase" style={{color:"rgba(255,255,255,0.45)"}}>{l}</p>
        </div>)}
      </div>
    </section>
    <section className="px-6 md:px-14 py-14 md:py-20 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {[["The Craft","How every piece is designed, printed, and finished — materials and process.","craft"],
          ["Care Guide","How to keep your piece looking the way it did on day one.","care-guide"],
          ["Bulk & Corporate Orders","Ordering for a hotel, café, or gifting programme? Let's talk.","bulk-orders"]]
          .map(([title,desc,view])=><button key={view} onClick={()=>navigate(view)} className="group text-left p-7"
            style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
            <p className="italic text-[18px] mb-2.5" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{title}</p>
            <p className="text-[12.5px] leading-[1.7] mb-4" style={{color:"rgba(36,62,65,0.55)"}}>{desc}</p>
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
  const { products } = useProducts();
  const [q,setQ]=useState(initQuery||"");
  useEffect(()=>{ setQ(initQuery||""); },[initQuery]);
  const trimmed=q.trim().toLowerCase();
  const results=trimmed.length>1?products.filter(p=>p.name.toLowerCase().includes(trimmed)||p.cat.toLowerCase().includes(trimmed)||(p.description||"").toLowerCase().includes(trimmed)):[];
  const submit=e=>{ e.preventDefault(); navigate("search",q); };
  return <div>
    <section className="px-6 md:px-14 pt-14 pb-8 max-w-[700px] mx-auto text-center">
      <p className="text-[12px] tracking-[0.3em] uppercase mb-3" style={{color:T.teal}}>Search</p>
      <h1 className="italic text-[32px] md:text-[44px] mb-5" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>{trimmed.length>1?`Results for "${q}"`:"Search the Collection"}</h1>
      <form onSubmit={submit} className="flex items-center gap-3 mb-3">
        <div className="flex-1 flex items-center gap-3 px-4" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,height:"48px"}}>
          <Search size={16} style={{color:"rgba(36,62,65,0.4)",flexShrink:0}}/>
          <input value={q} onChange={e=>setQ(sanitize(e.target.value))} placeholder="Search products…" maxLength={100}
            className="flex-1 bg-transparent outline-none text-[16px]" style={{color:T.teal,fontFamily:"'Space Grotesk',sans-serif"}}/>
        </div>
        <SweepButton filled type="submit" className="!px-6 !py-0 h-12 shrink-0 !flex items-center justify-center">Search</SweepButton>
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
      :<section className="px-6 md:px-14 pb-24 max-w-[1600px] mx-auto">
        <p className="pb-8 text-[11.5px] tracking-[0.06em] uppercase text-center" style={{color:"rgba(36,62,65,0.4)"}}>{results.length} result{results.length>1?"s":""} for "{q}"</p>
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
  const { products } = useProducts();
  const [activeCat,setActiveCat]=useState(initCategory||"All");
  useEffect(()=>{ if(initCategory) setActiveCat(initCategory); else setActiveCat("All"); },[initCategory]);
  const filtered=activeCat==="All"?products:products.filter(p=>p.cat===activeCat);
  const catInfo=CATEGORY_CONTENT[activeCat];
  return <div>
    <section className="px-6 md:px-14 pt-14 pb-8 text-center">
      <p className="text-[12px] tracking-[0.3em] uppercase mb-3" style={{color:T.teal}}>Shop</p>
      <h1 className="italic text-[32px] md:text-[44px] mb-5" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>{activeCat==="All"?"All Products":activeCat}</h1>
      {catInfo&&<p className="max-w-[560px] mx-auto text-[14px] leading-[1.8]" style={{color:"rgba(36,62,65,0.6)"}}>{catInfo.intro}</p>}
    </section>
    <section className="px-6 md:px-14 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap gap-2.5 pb-7" style={{borderBottom:"1px solid rgba(36,62,65,0.1)"}}>
        {["All",...CATEGORIES].map(c=><button key={c} onClick={()=>setActiveCat(c)}
          className="px-5 py-2.5 text-[12.5px] transition-all duration-200"
          style={activeCat===c?{backgroundColor:T.teal,color:"white"}:{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}>{c}</button>)}
      </div>
      <p className="pt-5 pb-8 text-[11.5px] tracking-[0.06em] uppercase" style={{color:"rgba(36,62,65,0.4)"}}>{filtered.length} {filtered.length===1?"piece":"pieces"}</p>
    </section>
    <section className="px-6 md:px-14 pb-24 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-10">
        {filtered.map(p=><ProductCard key={p.id} product={p} navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} toggleWishlist={toggleWishlist}/>)}
      </div>
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
  const item=media[active]||media[0];
  return <div>
    <div className="relative flex items-center justify-center" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.lg,aspectRatio:"1/1",maxHeight:"520px",width:"100%",overflow:"hidden"}}>
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
        style={{backgroundColor:T.card,boxShadow:i===active?`0 0 0 2px ${T.gold}`:"0 0 0 1px rgba(36,62,65,0.1)",borderRadius:RADIUS.xs}}>
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
function ProductDetailView({ productId, navigate, cart, setCart, wishlist, toggleWishlist }) {
  const { products } = useProducts();
  // The AkaraApp render gate (productExists) already ensures this component
  // never mounts with an invalid productId, so this fallback is a pure
  // safety net, not the primary guard — see the routing fix in parsePath().
  const product=products.find(p=>p.id===productId)||products[0];
  const [size,setSize]=useState("Medium");
  const [tab,setTab]=useState("Description");
  const [toast,setToast]=useState(false);
  const isWished=wishlist.includes(product.id);
  const related=products.filter(p=>p.cat===product.cat&&p.id!==product.id).slice(0,3);
  const soldOut=product.status==="sold-out";
  const lowStock=product.status==="low-stock";
  const preOrder=product.status==="pre-order";
  // How many of THIS product, in the currently-selected size, are already
  // sitting in the cart — recalculates whenever size changes, since a
  // different size is a different cart line item. This is what was
  // missing before: a customer could add something, come back to the
  // product page, and see no indication it was already in their cart.
  const cartQtyForSize=cart.find(i=>i.id===product.id&&i.size===size)?.qty||0;
  // Adds exactly 1 at a time now — matches the same pattern already used
  // on product cards elsewhere (icon while empty, a real stepper once
  // something's actually in the cart). This used to add whatever a
  // separate, always-visible "Quantity" selector was set to — meaning
  // the page showed a quantity stepper and a multiplied price before
  // anything was ever added, which read as if 1 unit were already sitting
  // in the cart by default. Adjusting quantity now only ever happens
  // through the stepper below, which itself only appears once the item
  // is genuinely in the cart.
  const addToCart=()=>{ if(soldOut) return; setCart(c=>{ const ex=c.find(i=>i.id===product.id&&i.size===size); if(ex) return c.map(i=>i.id===product.id&&i.size===size?{...i,qty:i.qty+1}:i); return [...c,{...product,size,qty:1}]; }); setToast(true); setTimeout(()=>setToast(false),2200); };
  // Found genuinely non-functional — no onClick at all — while doing an
  // unrelated animation pass. Same cart-adding logic as Add to Cart, then
  // straight to checkout — no toast needed here since the page is about
  // to navigate away anyway. Safe to send straight there regardless of
  // login state: CheckoutView already has its own real sign-in gate (see
  // "Sign in to check out." above), so there's no need to duplicate that
  // check here.
  const buyNow=()=>{ if(soldOut) return; setCart(c=>{ const ex=c.find(i=>i.id===product.id&&i.size===size); if(ex) return c.map(i=>i.id===product.id&&i.size===size?{...i,qty:i.qty+1}:i); return [...c,{...product,size,qty:1}]; }); navigate("checkout"); };
  const adjustCartQty=d=>setCart(c=>c.map(i=>i.id===product.id&&i.size===size?{...i,qty:Math.min(99,Math.max(0,i.qty+d))}:i).filter(i=>!(i.id===product.id&&i.size===size&&i.qty<=0)));
  // Real reviews, replacing the old hardcoded "4.6 (89) — coming with the
  // backend" placeholder that lived here and in the Reviews tab below.
  // Fetched fresh per product since ProductDetailView already remounts on
  // navigating between products (see the `key` on <main> in the app root).
  const [reviewData,setReviewData]=useState(null);
  useEffect(()=>{
    fetch(`/api/reviews/${product.id}`).then(r=>r.ok?r.json():null).then(setReviewData).catch(()=>{});
  },[product.id]);
  const tabContent=tab==="Dimensions"?product.dims:tab==="Description"?(product.description||"Description coming soon."):TABS_CONTENT[tab];
  return <div>
    <div className="px-6 md:px-14 pt-5 max-w-[1600px] mx-auto">
      <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.45)"}}>
        <button onClick={()=>navigate("home")} className="hover:underline">Home</button>
        <span style={{color:T.teal}}> / </span>
        <button onClick={()=>navigate("shop",product.cat)} className="hover:underline">{product.cat}</button>
        <span style={{color:T.teal}}> / </span>
        <span style={{color:T.teal}}>{product.name}</span>
      </p>
    </div>
    <section className="px-6 md:px-14 pt-8 pb-16 max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-14">
      <ProductGallery media={product.media} Art={product.Art} name={product.name} soldOut={soldOut}/>
      <div>
        <p className="text-[12px] tracking-[0.14em] uppercase mb-2.5" style={{color:soldOut?"rgba(36,62,65,0.4)":T.teal}}>{product.cat} · {soldOut?"Sold Out":lowStock?"Low Stock":preOrder?"Pre-Order":"In Stock"}</p>
        <h1 className="italic text-[34px] md:text-[40px] leading-tight mb-3" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>{product.name}</h1>
        {reviewData&&reviewData.count>0?<div className="flex items-center gap-1.5 mb-5">
          {[0,1,2,3,4].map(i=><Star key={i} size={14} fill={i<Math.round(reviewData.average)?T.gold:"none"} stroke={T.gold}/>)}
          <span className="text-[12.5px] ml-1" style={{color:"rgba(36,62,65,0.5)"}}>{reviewData.average.toFixed(1)} ({reviewData.count})</span>
        </div>:null}
        <p className="text-[28px] mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{product.price.toLocaleString("en-IN")}</p>
        <p className="text-[11.5px] mb-6" style={{color:"rgba(36,62,65,0.45)"}}>Excl. GST · added at checkout</p>
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
        </div>:<div className="flex items-center gap-2.5 px-4 py-3 mb-7 text-[12.5px]" style={{backgroundColor:"rgba(184,147,90,0.08)",color:T.teal}}>
          <span style={{color:T.gold}}>●</span> Handcrafted for you — ships in 2–3 weeks
        </div>}
        <div className="mb-5">
          <p className="text-[11px] tracking-[0.1em] uppercase mb-2.5" style={{color:"rgba(36,62,65,0.5)"}}>Size</p>
          <div className="flex gap-2.5">
            {["Small","Medium","Large"].map(s=><button key={s} onClick={()=>setSize(s)} disabled={soldOut} className="px-4 py-2.5 text-[13px] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              style={size===s?{backgroundColor:T.teal,color:"white"}:{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs,color:T.teal}}>{s}</button>)}
          </div>
        </div>
        <div className="hidden lg:flex gap-3 mb-5">
          <SweepButton onClick={addToCart} disabled={soldOut} className="flex-1">{soldOut?"Sold Out":preOrder?"Pre-Order":"Add to Cart"}</SweepButton>
          <SweepButton filled onClick={buyNow} disabled={soldOut} className="flex-1">Buy Now</SweepButton>
          <button onClick={()=>toggleWishlist(product.id)}
            aria-label={isWished?`Remove ${product.name} from wishlist`:`Add ${product.name} to wishlist`} className="w-14 flex items-center justify-center" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs}}>
            <Heart size={16} style={{color:isWished?T.gold:T.teal,fill:isWished?T.gold:"none"}}/>
          </button>
        </div>
        <div className="flex flex-col gap-2 text-[12.5px]" style={{color:"rgba(36,62,65,0.55)"}}>
          <div className="flex items-center gap-2"><Lock size={13}/> Secure checkout via Razorpay</div>
          <div className="flex items-center gap-2"><RotateCcw size={13}/> 7-day returns · 30-day warranty</div>
        </div>
      </div>
    </section>
    <section className="px-6 md:px-14 max-w-[1600px] mx-auto pb-20">
      <div className="flex gap-8 flex-wrap mb-7" style={{borderBottom:"1px solid rgba(36,62,65,0.12)"}}>
        {["Description","Dimensions","Care Guide","Reviews"].map(t=><button key={t} onClick={()=>setTab(t)} className="pb-4 text-[13px] transition-colors"
          style={{color:tab===t?T.teal:"rgba(36,62,65,0.45)",borderBottom:tab===t?`2px solid ${T.gold}`:"2px solid transparent",marginBottom:"-1px"}}>{t}</button>)}
      </div>
      {tab==="Reviews"?<div className="max-w-2xl">
        {!reviewData||reviewData.count===0?
          <p className="text-[14.5px] leading-[1.85]" style={{color:"rgba(36,62,65,0.65)"}}>No reviews yet — be the first to share your experience with a real purchase.</p>
        :<div className="flex flex-col gap-6">
          {reviewData.reviews.map(r=><div key={r.id} className="pb-6" style={{borderBottom:"1px solid rgba(36,62,65,0.08)"}}>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="flex">{[0,1,2,3,4].map(i=><Star key={i} size={12} fill={i<r.rating?T.gold:"none"} stroke={T.gold}/>)}</div>
              <span className="text-[12.5px]" style={{color:T.teal}}>{r.reviewerName}</span>
              <span className="text-[10.5px] uppercase tracking-[0.06em] px-2 py-0.5" style={{backgroundColor:"rgba(59,110,82,0.1)",color:T.success}}>Verified Buyer</span>
            </div>
            {r.comment&&<p className="text-[14px] leading-[1.7]" style={{color:"rgba(36,62,65,0.65)"}}>{r.comment}</p>}
          </div>)}
        </div>}
      </div>
      :<p className="max-w-2xl text-[14.5px] leading-[1.85]" style={{color:"rgba(36,62,65,0.65)"}}>{tabContent}</p>}
      {tab==="Care Guide"&&<button onClick={()=>navigate("care-guide")} className="text-[12px] uppercase tracking-[0.08em] underline mt-4 inline-block" style={{color:T.teal}}>Full Care Guide →</button>}
    </section>
    {related.length>0&&<section className="px-6 md:px-14 pb-24 max-w-[1600px] mx-auto">
      <p className="text-[12px] tracking-[0.2em] uppercase mb-8" style={{color:T.teal}}>You May Also Like</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
        {related.map(p=><ProductCard key={p.id} product={p} navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} toggleWishlist={toggleWishlist}/>)}
      </div>
    </section>}
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center gap-3 px-4 py-3" style={{backgroundColor:T.card,boxShadow:"0 -8px 24px -14px rgba(36,62,65,0.2)",borderTop:"1px solid rgba(36,62,65,0.1)"}}>
      <div className="shrink-0">
        <p className="text-[10px] uppercase tracking-[0.05em]" style={{color:"rgba(36,62,65,0.5)"}}>Price</p>
        <p className="text-[16px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{product.price.toLocaleString("en-IN")}</p>
      </div>
      <SweepButton filled onClick={addToCart} disabled={soldOut} className="flex-1">{soldOut?"Sold Out":preOrder?"Pre-Order":"Add to Cart"}</SweepButton>
      <button onClick={()=>toggleWishlist(product.id)} aria-label={isWished?`Remove ${product.name} from wishlist`:`Add ${product.name} to wishlist`} className="w-11 h-11 flex items-center justify-center shrink-0" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs}}>
        <Heart size={15} style={{color:isWished?T.gold:T.teal,fill:isWished?T.gold:"none"}}/>
      </button>
    </div>
    <div className="lg:hidden" style={{height:"76px"}}/>
    <div className="fixed bottom-24 lg:bottom-8 left-1/2 -translate-x-1/2 px-6 py-3.5 text-[13px] flex items-center gap-2 z-50 pointer-events-none transition-all duration-300"
      style={{backgroundColor:T.teal,color:"white",boxShadow:"0 20px 40px -14px rgba(36,62,65,0.4)",opacity:toast?1:0,transform:toast?"translate(-50%,0)":"translate(-50%,12px)",borderRadius:RADIUS.sm}}>
      <Check size={14} style={{color:T.cream}}/> Added to cart
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
  const updateQty=(id,size,d)=>setCart(c=>c.map(i=>i.id===id&&i.size===size?{...i,qty:Math.min(99,Math.max(1,i.qty+d))}:i));
  const removeItem=(id,size)=>setCart(c=>c.filter(i=>!(i.id===id&&i.size===size)));
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
    <ShoppingBag size={40} strokeWidth={1} style={{color:"rgba(36,62,65,0.2)",margin:"0 auto 20px"}}/>
    <h1 className="italic text-[26px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Your cart is empty.</h1>
    <p className="text-[14px] mb-8" style={{color:"rgba(36,62,65,0.5)"}}>Let's fix that.</p>
    <SweepButton filled onClick={()=>navigate("shop")}>Explore the Collection</SweepButton>
  </div>;
  return <div className="px-6 md:px-14 py-16 max-w-[1100px] mx-auto">
    <h1 className="italic text-[32px] md:text-[40px] mb-10" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Your Cart</h1>
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-14">
      <div>
        {cart.map(item=>{ const ItemArt=item.Art||PlanterArt; return <div key={item.id+item.size} className="flex gap-5 py-6" style={{borderBottom:"1px solid rgba(36,62,65,0.1)"}}>
          <div className="w-24 h-24 flex items-center justify-center shrink-0" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
            <ItemArt className="w-1/2 h-1/2" style={{color:T.gold,opacity:0.8}}/>
          </div>
          <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-[10px] tracking-[0.1em] uppercase mb-1" style={{color:"rgba(36,62,65,0.4)"}}>{item.cat}</p>
              <h3 className="text-[16px] italic mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{item.name}</h3>
              {item.size&&<p className="text-[11.5px] mb-2" style={{color:"rgba(36,62,65,0.45)"}}>Size: {item.size}</p>}
              <button onClick={()=>removeItem(item.id,item.size)} className="flex items-center gap-1 text-[11px] uppercase tracking-wide" style={{color:"rgba(36,62,65,0.4)"}}><Trash2 size={11}/> Remove</button>
            </div>
            <div className="flex items-center gap-5">
              <div className="inline-flex items-center" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs}}>
                <button onClick={()=>updateQty(item.id,item.size,-1)} className="w-9 h-9 flex items-center justify-center" style={{color:T.teal}} aria-label={`Decrease quantity of ${item.name}`}><Minus size={13}/></button>
                <span className="w-8 text-center text-[14px]" style={{fontFamily:"'Fraunces',serif"}}>{item.qty}</span>
                <button onClick={()=>updateQty(item.id,item.size,1)} className="w-9 h-9 flex items-center justify-center" style={{color:T.teal}} aria-label={`Increase quantity of ${item.name}`}><Plus size={13}/></button>
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
        {afterDiscount<shipSettings.freeShippingThreshold&&afterDiscount>0&&<p className="text-[11.5px] mt-4 text-center" style={{color:"rgba(36,62,65,0.5)"}}>Add ₹{shipSettings.freeShippingThreshold-afterDiscount} more for free shipping</p>}
        <div className="flex flex-col gap-2.5 mt-6 pt-6" style={{borderTop:"1px solid rgba(36,62,65,0.1)"}}>
          <div className="flex items-center gap-2 text-[11.5px]" style={{color:"rgba(36,62,65,0.55)"}}><RotateCcw size={13} style={{color:T.gold}}/>Free shipping on orders above ₹{shipSettings.freeShippingThreshold.toLocaleString("en-IN")}</div>
          <div className="flex items-center gap-2 text-[11.5px]" style={{color:"rgba(36,62,65,0.55)"}}><Lock size={13} style={{color:T.gold}}/>Secure payment via Razorpay</div>
          <div className="flex items-center gap-2 text-[11.5px]" style={{color:"rgba(36,62,65,0.55)"}}><Check size={13} style={{color:T.gold}}/>7-day returns on damaged or defective pieces</div>
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
  const [form,setForm]=useState({name:"",email:"",phone:"",address:"",landmark:"",city:"",state:"",pin:""});
  const [errors,setErrors]=useState({});
  const [stage,setStage]=useState("form"); // form -> processing -> (redirects away on success/failure)
  const upd=k=>v=>setForm(f=>({...f,[k]:v}));
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
  // server (POST /api/orders/checkout requires auth; see
  // server/routes/orders.js), this is just the matching frontend
  // experience so a signed-out visitor gets a clear prompt here instead
  // of a confusing failure after filling out the whole form.
  if(!user) return <div className="px-6 py-24 max-w-[440px] mx-auto text-center">
    <Lock size={32} strokeWidth={1.2} style={{color:"rgba(36,62,65,0.3)",margin:"0 auto 20px"}}/>
    <h1 className="italic text-[26px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Sign in to check out.</h1>
    <p className="text-[14px] leading-[1.8] mb-9" style={{color:"rgba(36,62,65,0.55)"}}>
      An account keeps your order history, invoices, and tracking all in one place — sign in or create one to continue.
    </p>
    <div className="flex flex-col sm:flex-row gap-4 justify-center">
      <SweepButton filled onClick={()=>{setPostLoginRedirect("checkout");navigate("login");}}>Sign In</SweepButton>
      <SweepButton onClick={()=>{setPostLoginRedirect("checkout");navigate("signup");}}>Create Account</SweepButton>
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
          items: cart.map(i=>({id:i.id, size:i.size, qty:i.qty})), // deliberately NOT sending price — the server prices everything itself
          address:{ name:sanitize(form.name), line:sanitize(form.address), landmark:sanitize(form.landmark), city:sanitize(form.city), state:sanitize(form.state), pin:form.pin },
          email:sanitize(form.email), phone:sanitize(form.phone),
          couponCode: appliedCoupon?.code || undefined, // only the CODE is sent — the server computes the actual discount itself, never trusts a client-sent amount
          paymentMethod,
        }),
      });
      const data=await res.json();
      if(!res.ok){ setErrors({form:data.error||"Something went wrong. Please try again."}); setStage("form"); return; }

      // COD order — fully confirmed the moment the server accepted it,
      // no Razorpay widget involved at all. The server independently
      // re-checks COD is actually enabled before ever reaching this
      // point, so isCOD in the response can be trusted here.
      if(data.isCOD){
        setOrder(data.order);
        setCart([]);
        setAppliedCoupon(null);
        navigate("order-confirmed");
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
        theme: { color: "#243E41" },
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
            navigate("order-confirmed");
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
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] shrink-0" style={s.done?{backgroundColor:T.gold,color:"white"}:s.current?{backgroundColor:T.teal,color:"white"}:{border:"1px solid rgba(36,62,65,0.25)",color:"rgba(36,62,65,0.4)"}}>
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
          <InputField label="City" value={form.city} onChange={upd("city")} error={errors.city} required/>
          <InputField label="State" value={form.state} onChange={upd("state")}/>
          <InputField label="PIN Code" value={form.pin} onChange={v=>{ upd("pin")(v); lookupPincode(v,({city,state})=>setForm(f=>({...f,city,state}))); }} error={errors.pin} maxLength={6} required/>
        </div>
        {shipSettings.codEnabled&&<div className="mb-2">
          <p className="text-[11px] tracking-[0.08em] uppercase mb-2.5" style={{color:"rgba(36,62,65,0.55)"}}>Payment Method</p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={()=>setPaymentMethod("razorpay")} className="px-4 py-3 text-left text-[13px]"
              style={paymentMethod==="razorpay"?{border:`1px solid ${T.teal}`,backgroundColor:"rgba(36,62,65,0.05)",borderRadius:RADIUS.xs,color:T.teal}:{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs,color:"rgba(36,62,65,0.6)"}}>
              Pay Online
            </button>
            <button type="button" onClick={()=>setPaymentMethod("cod")} className="px-4 py-3 text-left text-[13px]"
              style={paymentMethod==="cod"?{border:`1px solid ${T.teal}`,backgroundColor:"rgba(36,62,65,0.05)",borderRadius:RADIUS.xs,color:T.teal}:{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs,color:"rgba(36,62,65,0.6)"}}>
              Cash on Delivery
            </button>
          </div>
        </div>}
        <SweepButton filled type="submit" disabled={stage==="processing"} className="w-full">
          {stage==="processing"?"Opening secure payment…":paymentMethod==="cod"?`Place Order — Pay ₹${total.toLocaleString("en-IN")} on Delivery`:`Place Order — ₹${total.toLocaleString("en-IN")}`}
        </SweepButton>
        <p className="text-[11.5px] mt-4 flex items-center gap-2" style={{color:"rgba(36,62,65,0.5)"}}><Lock size={11}/> {paymentMethod==="cod"?"Pay in cash when your order arrives":"Secure checkout via Razorpay"}</p>
      </form>
      <div className="h-fit p-7" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.lg}}>
        <h2 className="text-[12px] tracking-[0.1em] uppercase mb-5" style={{color:T.teal}}>Summary</h2>
        {cart.map(i=><div key={i.id+i.size} className="flex justify-between text-[13px] mb-2.5" style={{color:"rgba(36,62,65,0.7)"}}><span>{i.name} × {i.qty}</span><span>₹{i.price*i.qty}</span></div>)}
        <div className="pt-4 mt-3 flex flex-col gap-2.5 text-[13.5px]" style={{borderTop:"1px solid rgba(36,62,65,0.12)",color:"rgba(36,62,65,0.7)"}}>
          <div className="flex justify-between"><span>Subtotal</span><span>₹{subtotal.toLocaleString("en-IN")}</span></div>
          {discount>0&&<div className="flex justify-between" style={{color:T.teal}}><span>Discount ({appliedCoupon?.code})</span><span>−₹{discount.toLocaleString("en-IN")}</span></div>}
          {[["Shipping",shipping===0?"Free":`₹${shipping}`],...(codFee>0?[["COD Handling Fee",`₹${codFee}`]]:[]),["GST (18%)",`₹${gst.toLocaleString("en-IN")}`]].map(([l,v])=><div key={l} className="flex justify-between"><span>{l}</span><span>{v}</span></div>)}
        </div>
        <div className="flex justify-between items-baseline pt-4 mt-3" style={{borderTop:"1px solid rgba(36,62,65,0.12)"}}>
          <span className="text-[13px]" style={{color:T.teal}}>Total</span>
          <span className="text-[20px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{total.toLocaleString("en-IN")}</span>
        </div>
        <p className="text-[11px] mt-4" style={{color:"rgba(36,62,65,0.4)"}}>This total is a preview — the amount you're actually charged is calculated by the server at checkout, from current prices, not from this page.</p>
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
function OrderConfirmedView({ navigate, order }) {
  const [verified,setVerified]=useState(null); // null = checking, true = confirmed paid, false = not actually paid
  useEffect(()=>{
    if(!order?.orderNumber){ setVerified(false); return; }
    fetch(`/api/orders/${order.orderNumber}`,{credentials:"include"})
      .then(r=>r.ok?r.json():null)
      .then(data=>setVerified(data?.order?.paymentStatus==="paid"||data?.order?.paymentStatus==="cod"))
      .catch(()=>setVerified(false));
  },[order?.orderNumber]);

  if(!order) return <div className="px-6 py-32 text-center"><SweepButton filled onClick={()=>navigate("shop")}>Back to Shop</SweepButton></div>;
  if(verified===null) return <div className="px-6 py-32 text-center"><p className="text-[13px]" style={{color:"rgba(36,62,65,0.5)"}}>Confirming your order…</p></div>;
  if(verified===false) return <div className="px-6 py-32 text-center max-w-[440px] mx-auto">
    <AlertCircle size={40} strokeWidth={1} style={{color:"rgba(168,59,50,0.4)",margin:"0 auto 20px"}}/>
    <h1 className="italic text-[24px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>We couldn't confirm this payment.</h1>
    <p className="text-[13.5px] mb-8" style={{color:"rgba(36,62,65,0.55)"}}>Order #{order.orderNumber} hasn't been marked as paid yet. If you completed a payment, please contact us — otherwise it may have been cancelled or is still processing.</p>
    <SweepButton filled onClick={()=>navigate("account")}>View My Orders</SweepButton>
  </div>;
  return <div className="px-6 py-20 max-w-[600px] mx-auto text-center">
    <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-7" style={{backgroundColor:"rgba(184,147,90,0.12)"}}>
      <Check size={22} style={{color:T.gold}}/>
    </div>
    <p className="text-[12px] tracking-[0.2em] uppercase mb-4" style={{color:T.teal}}>Order Confirmed</p>
    <h1 className="italic text-[28px] md:text-[34px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Thank you, {sanitize(order.name).split(" ")[0]}.</h1>
    <p className="text-[14.5px] leading-[1.8] mb-10" style={{color:"rgba(36,62,65,0.6)"}}>
      Your order <strong style={{color:T.teal}}>#{order.orderNumber}</strong> is confirmed. We'll email {sanitize(order.email)} once it ships — typically 2–3 weeks.
    </p>
    <div className="text-left p-7 mb-8" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.lg}}>
      {order.items.map(i=><div key={i.id+i.size} className="flex justify-between text-[13.5px] mb-3" style={{color:"rgba(36,62,65,0.7)"}}><span>{i.name} × {i.qty}</span><span>₹{i.price*i.qty}</span></div>)}
      <div className="flex justify-between items-baseline pt-4 mt-3" style={{borderTop:"1px solid rgba(36,62,65,0.12)"}}>
        <span className="text-[13px]" style={{color:T.teal}}>{order.paymentMethod==="cod"?"Amount Due on Delivery":"Total Paid"}</span>
        <span className="text-[19px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{order.total.toLocaleString("en-IN")}</span>
      </div>
    </div>
    <p className="text-[13px] mb-8" style={{color:"rgba(36,62,65,0.5)"}}>Shipping to: {sanitize(order.address)}{order.landmark?`, near ${sanitize(order.landmark)}`:""}, {sanitize(order.city)}</p>
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
  const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableModule.default;
  const doc=new jsPDF();
  const { subtotal=0, discount=0, shippingCost:shipCost=0, codFee=0, cgst=0, sgst=0, total:grandTotal=0 } = order;
  const invoiceDate=order.placedAt?new Date(order.placedAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}):"";

  doc.setFont("helvetica","bold"); doc.setFontSize(18);
  doc.text("AKARA",14,20);
  doc.setFont("helvetica","normal"); doc.setFontSize(9);
  doc.text("Precision Forge Labs",14,27);
  doc.text("Thane, Maharashtra 400601",14,32);
  doc.text("GSTIN: 27GZCPS9353H1ZQ",14,37);
  doc.text("support@akaraonline.co.in | +91 82780 85572",14,42);

  doc.setFont("helvetica","bold"); doc.setFontSize(11);
  doc.text("TAX INVOICE",196,20,{align:"right"});
  doc.setFont("helvetica","normal"); doc.setFontSize(9);
  doc.text(`Invoice #: ${order.orderNumber}`,196,27,{align:"right"});
  doc.text(`Date: ${invoiceDate}`,196,32,{align:"right"});

  doc.setDrawColor(36,62,65); doc.setLineWidth(0.5); doc.line(14,47,196,47);

  doc.setFont("helvetica","bold"); doc.setFontSize(9);
  doc.text("Billed & Shipped To",14,55);
  doc.setFont("helvetica","normal");
  doc.text(sanitize(order.name||""),14,61);
  const addrLine=`${sanitize(order.address||"")}, ${sanitize(order.city||"")}${order.state?", "+sanitize(order.state):""}${order.pin?" - "+sanitize(order.pin):""}`;
  doc.text(addrLine,14,66,{maxWidth:120});
  if(order.phone) doc.text(sanitize(order.phone),14,76);
  if(order.email) doc.text(sanitize(order.email),14,81);

  autoTable(doc,{
    startY:88,
    head:[["Item","HSN","Qty","Rate","Amount"]],
    body:order.items.map(i=>[`${i.name}${i.size?" ("+i.size+")":""}`,i.hsn,String(i.qty),`Rs ${i.price.toLocaleString("en-IN")}`,`Rs ${(i.price*i.qty).toLocaleString("en-IN")}`]),
    headStyles:{fillColor:[36,62,65],textColor:255},
    styles:{fontSize:9},
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
  summaryRows.forEach(([label,val])=>{ doc.text(label,140,y); doc.text(val,196,y,{align:"right"}); y+=6; });
  doc.setDrawColor(36,62,65); doc.line(140,y,196,y); y+=6;
  doc.setFont("helvetica","bold"); doc.setFontSize(11);
  doc.text(order.paymentMethod==="cod"?"Amount Due on Delivery":"Total Paid",140,y); doc.text(`Rs ${grandTotal.toLocaleString("en-IN")}`,196,y,{align:"right"});

  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(120);
  doc.text("This is a computer-generated invoice and does not require a signature.",14,285);

  doc.save(`AKARA-Invoice-${order.orderNumber}.pdf`);
}

function InvoiceView({ navigate, order }){
  if(!order) return <div className="px-6 py-32 text-center">
    <ClipboardCheck size={40} strokeWidth={1} style={{color:"rgba(36,62,65,0.2)",margin:"0 auto 20px"}}/>
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
  const showToast=useToast();
  const [downloading,setDownloading]=useState(false);
  const handleDownload=async()=>{
    setDownloading(true);
    try{ await downloadInvoicePDF(order); }
    catch{ showToast("Couldn't generate the PDF — please try again.","error"); }
    finally{ setDownloading(false); }
  };
  return <div className="px-6 md:px-14 py-10 max-w-[860px] mx-auto">
    <div className="no-print flex justify-between items-center mb-8 flex-wrap gap-3">
      <button onClick={()=>navigate("account")} className="text-[12.5px] flex items-center gap-1" style={{color:T.teal}}><ChevronRight size={14} style={{transform:"rotate(180deg)"}}/> Back</button>
      <div className="flex gap-3">
        <SweepButton onClick={()=>window.print()}>Print</SweepButton>
        <SweepButton filled onClick={handleDownload} disabled={downloading}>{downloading?"Generating…":"Download PDF"}</SweepButton>
      </div>
    </div>
    <div className="invoice-print-area p-8 md:p-12" style={{backgroundColor:"white",boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
      <div className="flex justify-between items-start mb-10 pb-8 flex-wrap gap-6" style={{borderBottom:`2px solid ${T.teal}`}}>
        <div>
          <p className="text-[22px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}><Mac>A</Mac>K<Mac>A</Mac>RA</p>
          <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.6)"}}>Precision Forge Labs</p>
          <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.6)"}}>Thane, Maharashtra 400601</p>
          <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.6)"}}>GSTIN: 27GZCPS9353H1ZQ</p>
          <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.6)"}}>support@akaraonline.co.in · +91 82780 85572</p>
        </div>
        <div className="text-right">
          <p className="text-[12px] uppercase tracking-[0.1em] mb-2" style={{color:T.teal}}>Tax Invoice</p>
          <p className="text-[13px]" style={{color:T.teal}}>Invoice #: {order.orderNumber}</p>
          <p className="text-[13px]" style={{color:T.teal}}>Date: {invoiceDate}</p>
        </div>
      </div>
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.1em] mb-2" style={{color:"rgba(36,62,65,0.5)"}}>Billed & Shipped To</p>
        <p className="text-[14px]" style={{color:T.teal}}>{sanitize(order.name)}</p>
        <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.6)"}}>{sanitize(order.address)}{order.landmark?`, near ${sanitize(order.landmark)}`:""}, {sanitize(order.city)}{order.state?`, ${sanitize(order.state)}`:""}{order.pin?` — ${sanitize(order.pin)}`:""}</p>
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
          <div className="flex justify-between text-[12.5px] mb-2" style={{color:"rgba(36,62,65,0.65)"}}><span>Subtotal</span><span>₹{subtotal.toLocaleString("en-IN")}</span></div>
          {discount>0&&<div className="flex justify-between text-[12.5px] mb-2" style={{color:T.teal}}><span>Discount{order.couponCode?` (${order.couponCode})`:""}</span><span>−₹{discount.toLocaleString("en-IN")}</span></div>}
          {[["Shipping",shipCost],...(codFee>0?[["COD Handling Fee",codFee]]:[]),["CGST (9%)",cgst],["SGST (9%)",sgst]].map(([l,v])=><div key={l} className="flex justify-between text-[12.5px] mb-2" style={{color:"rgba(36,62,65,0.65)"}}><span>{l}</span><span>{v===0?"Free":`₹${v.toLocaleString("en-IN")}`}</span></div>)}
          <div className="flex justify-between pt-3 mt-2" style={{borderTop:`1px solid ${T.teal}`}}>
            <span className="text-[13px]" style={{color:T.teal}}>{order.paymentMethod==="cod"?"Amount Due on Delivery":"Total Paid"}</span>
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
// used elsewhere — real courier/production-stage tracking is still a
// future admin-panel feature, not wired to real courier data yet.
const CUSTOMER_CANCEL_WINDOW_MS = 30 * 60 * 1000;
function OrderStatusView({ navigate, order, setOrder }) {
  const showToast=useToast();
  const [confirmCancelOpen,setConfirmCancelOpen]=useState(false);
  const [cancelReason,setCancelReason]=useState("");
  const [cancelDetail,setCancelDetail]=useState("");
  const [cancelling,setCancelling]=useState(false);
  // Real bug found and fixed: this page used to purely trust whatever
  // `order` object was last cached client-side (from checkout, or from
  // whichever order was last opened in My Account) — meaning an admin
  // cancelling an order elsewhere wouldn't be reflected here until the
  // customer happened to reload in a way that re-fetched it. Now
  // re-fetches the real, current order from the server every time this
  // page is opened, so a status change made anywhere else shows up
  // immediately rather than showing stale cached data.
  useEffect(()=>{
    if(!order?.orderNumber) return;
    fetch(`/api/orders/${order.orderNumber}`,{credentials:"include"})
      .then(r=>r.ok?r.json():null)
      .then(data=>{ if(data?.order) setOrder(data.order); })
      .catch(()=>{});
  },[order?.orderNumber]);
  // A live countdown, not just a one-time check — re-evaluates every
  // second so the button/message correctly disappears the moment the
  // window closes, without needing a page refresh. The REAL enforcement
  // is server-side (see PATCH /api/orders/:orderNumber/cancel in
  // server/routes/orders.js) — this is purely the matching UI, and could
  // never be trusted on its own even if this client-side check were
  // somehow bypassed.
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{ const t=setInterval(()=>setNow(Date.now()),1000); return ()=>clearInterval(t); },[]);

  if(!order) return <div className="px-6 py-32 text-center">
    <Truck size={40} strokeWidth={1} style={{color:"rgba(36,62,65,0.2)",margin:"0 auto 20px"}}/>
    <h1 className="italic text-[26px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>No order to track yet.</h1>
    <SweepButton filled onClick={()=>navigate("shop")}>Explore the Collection</SweepButton>
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
      <p className="text-[13.5px] mb-8" style={{color:"rgba(36,62,65,0.55)"}}>Made-to-order pieces take 2–3 weeks in production before they ship.</p>

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
              <p className="hidden sm:block text-[11px] mt-1 max-w-[120px] mx-auto" style={{color:"rgba(36,62,65,0.45)"}}>{s.desc}</p>
            </div>
            {i<ORDER_STAGES.length-1&&<div className="hidden sm:block absolute top-5 left-1/2 w-full h-px" style={{backgroundColor:i<currentIdx?T.teal:"rgba(36,62,65,0.15)"}}/>}
          </div>;
        })}
      </div>

      {currentIdx>=3?<div className="flex items-center justify-between p-5 mb-6" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
        <div className="flex items-center gap-3"><Truck size={16} style={{color:T.gold}}/><p className="text-[13px]" style={{color:T.teal}}>Your order is on its way</p></div>
        {order.courierTrackingUrl
          ?<a href={order.courierTrackingUrl} target="_blank" rel="noopener noreferrer" className="text-[11.5px] uppercase tracking-[0.08em]" style={{color:T.teal}}>Track with Courier →</a>
          :<span className="text-[11.5px]" style={{color:"rgba(36,62,65,0.4)"}}>Tracking link coming soon</span>}
      </div>:<p className="text-[12.5px] mb-6" style={{color:"rgba(36,62,65,0.45)"}}>A courier tracking link will appear here once your order is dispatched.</p>}

      {canCancel&&<div className="flex items-center justify-between p-4 mb-8 flex-wrap gap-3" style={{backgroundColor:"rgba(181,101,29,0.07)"}}>
        <p className="text-[12.5px]" style={{color:T.warning}}>You can cancel this order for the next {minutesRemaining} minute{minutesRemaining!==1?"s":""}.</p>
        <button onClick={()=>setConfirmCancelOpen(true)} className="text-[12px] uppercase tracking-[0.06em] underline" style={{color:T.error}}>Cancel Order</button>
      </div>}
    </>}

    <div className="text-left p-7 mb-8" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.lg}}>
      {order.items.map(i=><div key={i.id+i.size} className="flex justify-between text-[13.5px] mb-3" style={{color:"rgba(36,62,65,0.7)"}}><span>{i.name} × {i.qty}</span><span>₹{i.price*i.qty}</span></div>)}
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
      <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Why are you cancelling? *</label>
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
    <p className="text-[14.5px] leading-[1.8] mb-10" style={{color:"rgba(36,62,65,0.6)"}}>
      Your card or bank may have declined the transaction, or the payment window timed out. No amount has been deducted — if you do see a debit, it will be auto-reversed by your bank within 5–7 business days.
    </p>
    <div className="text-left p-6 mb-10" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
      <p className="text-[12px] uppercase tracking-[0.08em] mb-3" style={{color:T.teal}}>What you can do</p>
      <ul className="flex flex-col gap-2">
        {["Try again with the same or a different payment method","Check your bank balance and card limits","Contact your bank if the issue persists"].map(t=><li key={t} className="flex items-start gap-2 text-[13px]" style={{color:"rgba(36,62,65,0.65)"}}><Check size={13} style={{color:T.gold,marginTop:3,flexShrink:0}}/>{t}</li>)}
      </ul>
    </div>
    <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
      <SweepButton filled onClick={()=>navigate("checkout")}>Retry Payment</SweepButton>
      <SweepButton onClick={()=>navigate("cart")}>Back to Cart</SweepButton>
    </div>
    <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.5)"}}>Still stuck? Email <a href="mailto:support@akaraonline.co.in" style={{color:T.teal}}>support@akaraonline.co.in</a></p>
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
function AuthLayout({ eyebrow, title, subtitle, children }){
  return <div className="min-h-[80vh] flex items-center justify-center px-4 py-10 md:px-8">
    <div className="w-full max-w-[860px] grid grid-cols-1 md:grid-cols-[1fr_1.15fr]" style={{borderRadius:RADIUS.lg,overflow:"hidden",boxShadow:ELEVATION.modal}}>
      <div className="hidden md:flex flex-col items-center justify-center p-10 relative overflow-hidden text-center" style={{backgroundColor:T.teal}}>
        <div className="relative z-10">
          <p className="text-[36px] italic mb-6" style={{fontFamily:"'Fraunces',serif",color:T.gold}}><Mac>A</Mac>K<Mac>A</Mac>RA</p>
          <div className="w-11 h-px mb-5 mx-auto" style={{backgroundColor:T.gold}}/>
          <p className="italic text-[19px] leading-[1.5]" style={{fontFamily:"'Fraunces',serif",color:T.cream}}>Ākāra means form —<br/>made only once you ask.</p>
        </div>
        <svg className="absolute -right-10 -bottom-10 opacity-[0.08]" width="220" height="220" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" stroke={T.gold} strokeWidth="1" fill="none"/><circle cx="50" cy="50" r="30" stroke={T.gold} strokeWidth="1" fill="none"/></svg>
      </div>
      <div className="p-8 md:p-11 flex flex-col justify-center" style={{backgroundColor:T.cream}}>
        <p className="text-[19px] italic mb-6 md:hidden" style={{fontFamily:"'Fraunces',serif",color:T.teal}}><Mac>A</Mac>K<Mac>A</Mac>RA</p>
        {eyebrow&&<p className="text-[11px] tracking-[0.2em] uppercase mb-2" style={{color:T.teal}}>{eyebrow}</p>}
        <h1 className="italic text-[26px] md:text-[28px] mb-2" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{title}</h1>
        {subtitle&&<p className="text-[13.5px] mb-7" style={{color:"rgba(36,62,65,0.55)"}}>{subtitle}</p>}
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
    <p className="text-[13px] text-center mt-6" style={{color:"rgba(36,62,65,0.55)"}}>Don't have an account? <button onClick={()=>navigate("signup")} className="underline" style={{color:T.teal}}>Register</button></p>
  </AuthLayout>;
}

// Real signup — creates an actual account in the database (see
// POST /api/auth/signup).
function SignupView({ navigate, onLogin, postLoginRedirect, setPostLoginRedirect }) {
  const [form,setForm]=useState({name:"",email:"",phone:"",pw:"",confirm:""}); const [errors,setErrors]=useState({});
  const [submitting,setSubmitting]=useState(false);
  const upd=k=>v=>setForm(f=>({...f,[k]:v}));
  const strength=pwStrength(form.pw);
  const submit=async e=>{
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
      const res=await apiFetch("/api/auth/signup",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({name:sanitize(form.name),email:sanitize(form.email),phone:normalizePhone(form.phone),password:form.pw}),
      });
      const data=await res.json();
      if(!res.ok){
        // 409 = email already registered — the one case worth mapping to
        // its specific field rather than a generic banner, since the
        // fix ("sign in instead") is different from every other error here.
        setErrors(res.status===409?{email:data.error}:{form:data.error||"Something went wrong. Please try again."});
      } else {
        onLogin(data.customer);
        navigate(postLoginRedirect||"account");
        setPostLoginRedirect(null);
      }
    }catch{
      setErrors({form:"Couldn't reach the server. Please check your connection and try again."});
    }finally{
      setSubmitting(false);
    }
  };
  return <AuthLayout eyebrow="Join Us" title="Create Account" subtitle="Track orders, save addresses, and check out faster.">
    {errors.form&&<div className="flex items-center gap-2 px-4 py-3 mb-5 text-[13px]" style={{backgroundColor:"rgba(168,59,50,0.08)",color:T.error,borderRadius:RADIUS.sm}}><AlertCircle size={14}/>{errors.form}</div>}
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <InputField label="Full Name" value={form.name} onChange={upd("name")} error={errors.name} required/>
      <InputField label="Email" type="email" value={form.email} onChange={upd("email")} error={errors.email} required/>
      <InputField label="Mobile Number" type="tel" value={form.phone} onChange={upd("phone")} error={errors.phone} placeholder="+91 XXXXX XXXXX" required/>
      <div>
        <InputField label="Password" type="password" value={form.pw} onChange={upd("pw")} error={errors.pw} required/>
        {form.pw&&<div className="mt-2 flex items-center gap-2">
          <div className="flex gap-1">
            {[form.pw.length>=8,/[A-Z]/.test(form.pw),/[0-9]/.test(form.pw),/[^A-Za-z0-9]/.test(form.pw)].map((met,i)=><div key={i} className="w-6 h-1" style={{backgroundColor:met?T.gold:"rgba(36,62,65,0.15)",borderRadius:RADIUS.xs}}/>)}
          </div>
          <span className="text-[11px]" style={{color:strength.ok?T.success:"rgba(36,62,65,0.5)"}}>{strength.msg}</span>
        </div>}
      </div>
      <InputField label="Confirm Password" type="password" value={form.confirm} onChange={upd("confirm")} error={errors.confirm} required/>
      <SweepButton filled type="submit" disabled={submitting} className="w-full">{submitting?"Creating account…":"Create Account"}</SweepButton>
    </form>
    <p className="text-[13px] text-center mt-6" style={{color:"rgba(36,62,65,0.55)"}}>Already have one? <button onClick={()=>navigate("login")} className="underline" style={{color:T.teal}}>Sign in</button></p>
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
    <p className="text-[13.5px] leading-[1.75] mb-8" style={{color:"rgba(36,62,65,0.6)"}}>If <strong style={{color:T.teal}}>{sanitize(email)}</strong> has an account with us, you'll receive a reset link shortly.</p>
    {cooldown>0?<p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.4)"}}>Resend in {cooldown}s</p>
    :<button onClick={()=>setSent(false)} className="text-[13px] underline" style={{color:T.teal}}>Try a different email</button>}
    <div className="mt-8"><button onClick={()=>navigate("login")} className="text-[13px] underline" style={{color:"rgba(36,62,65,0.5)"}}>Back to Sign In</button></div>
  </AuthLayout>;
  return <AuthLayout eyebrow="Reset" title="Reset Password" subtitle="Enter your email and we'll send a reset link if your account exists.">
    {error&&<div className="flex items-center gap-2 px-4 py-3 mb-5 text-[13px]" style={{backgroundColor:"rgba(168,59,50,0.08)",color:T.error,borderRadius:RADIUS.sm}}><AlertCircle size={14}/>{error}</div>}
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <InputField label="Email" type="email" value={email} onChange={v=>{setEmail(v);setError("");}} required/>
      <SweepButton filled type="submit" className="w-full" disabled={submitting}>{submitting?"Sending…":"Send Reset Link"}</SweepButton>
    </form>
    <div className="mt-6 text-center"><button onClick={()=>navigate("login")} className="text-[13px] underline" style={{color:"rgba(36,62,65,0.5)"}}>Back to Sign In</button></div>
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
    <p className="text-[13.5px] mb-8" style={{color:"rgba(36,62,65,0.6)"}}>This password reset link is missing or malformed. Please request a new one.</p>
    <SweepButton filled onClick={()=>navigate("forgot-password")}>Request New Link</SweepButton>
  </AuthLayout>;
  if(done) return <AuthLayout eyebrow="Done" title="Password Updated">
    <p className="text-[13.5px] mb-8" style={{color:"rgba(36,62,65,0.6)"}}>Your password has been changed. You can now sign in.</p>
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
          <span className="text-[11px]" style={{color:strength.ok?T.success:"rgba(36,62,65,0.5)"}}>{strength.msg}</span>
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
  const steps=[["01","Design","Every form is modelled and function-tested before it's offered."],["02","Order","Nothing is produced speculatively. Your order starts the queue."],["03","Print","Precision 3D-printed in our Mumbai studio, layer by layer."],["04","Finish","Hand-finished and quality-checked before leaving the studio."],["05","Ship","Tracked delivery, typically 2–3 weeks from order to door."]];
  return <div>
    <section className="px-6 py-24 md:py-28 text-center max-w-[800px] mx-auto">
      <p className="text-[12px] tracking-[0.3em] uppercase mb-7" style={{color:T.teal}}>About <Mac>A</Mac>K<Mac>A</Mac>RA</p>
      <h1 className="italic text-[32px] md:text-[50px] leading-[1.2] mb-7" style={{fontFamily:"'Fraunces',serif",fontWeight:400,color:T.teal}}>
        We didn't want a name already sitting on a shelf somewhere. <span style={{color:T.gold}}>Ākāra</span> — Sanskrit for form — was the only one that felt honest.
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
        <p className="text-[12px] tracking-[0.3em] uppercase mb-5 text-center" style={{color:T.cream}}>How a piece is made</p>
        <h2 className="italic text-[28px] md:text-[36px] text-center mb-14 text-white" style={{fontFamily:"'Fraunces',serif",fontWeight:400}}>From idea to your door.</h2>
        <div className="grid grid-cols-2 md:grid-cols-5" style={{borderTop:"1px solid rgba(255,255,255,0.15)",borderBottom:"1px solid rgba(255,255,255,0.15)"}}>
          {steps.map(([n,t,d],i)=><div key={n} className="py-8 px-4 text-center" style={{borderRight:i<4?"1px solid rgba(255,255,255,0.15)":"none"}}>
            <p className="italic text-[24px] mb-3" style={{fontFamily:"'Fraunces',serif",color:T.gold}}>{n}</p>
            <p className="text-[12px] tracking-[0.06em] uppercase mb-2 text-white">{t}</p>
            <p className="text-[11.5px] leading-[1.6]" style={{color:"rgba(255,255,255,0.5)"}}>{d}</p>
          </div>)}
        </div>
      </div>
    </section>
    <section className="px-6 py-24 text-center">
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
      <p className="text-[12px] tracking-[0.3em] uppercase mb-7" style={{color:T.teal}}>The Craft</p>
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
      ].map(([title,desc])=><div key={title} className="p-8" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
        <p className="italic text-[20px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{title}</p>
        <p className="text-[13.5px] leading-[1.8]" style={{color:"rgba(36,62,65,0.6)"}}>{desc}</p>
      </div>)}
    </section>

    <section className="relative px-6 py-20 md:py-24 text-center overflow-hidden" style={{backgroundColor:T.teal}}>
      <div className="pointer-events-none absolute w-[500px] h-[500px] rounded-full -right-40 -bottom-40" style={{background:"radial-gradient(circle,rgba(184,147,90,0.12),transparent 70%)"}}/>
      <p className="relative text-[12px] tracking-[0.3em] uppercase mb-5" style={{color:T.cream}}>The Studio</p>
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
      <p className="text-[15px] leading-[1.75]" style={{color:"rgba(36,62,65,0.6)"}}>Order questions, custom requests, or just curious about a piece — we read every message ourselves.</p>
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
      {sent?<p className="text-center text-[14px] py-8" style={{color:T.gold}}>Thanks — your message is in. We reply within 72 hours.</p>
      :<form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField label="Name" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} error={errors.name} required/>
          <InputField label="Email" type="email" value={form.email} onChange={v=>setForm(f=>({...f,email:v}))} error={errors.email} required/>
        </div>
        <InputField label="Phone" type="tel" value={form.phone} onChange={v=>setForm(f=>({...f,phone:v}))} error={errors.phone} required/>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Message *</label>
          <textarea required rows={5} value={form.message} onChange={e=>setForm(f=>({...f,message:sanitize(e.target.value)}))} maxLength={2000}
            className="w-full bg-transparent outline-none text-[14px]" style={{border:`1px solid ${errors.message?T.error:"rgba(36,62,65,0.22)"}`,borderRadius:RADIUS.xs,padding:"13px 14px",color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
          {errors.message&&<p className="text-[11.5px] mt-1.5 flex items-center gap-1" style={{color:T.error}}><AlertCircle size={12}/>{errors.message}</p>}
        </div>
        <SweepButton filled type="submit" className="w-full" disabled={submitting}>{submitting?"Sending…":"Send Message"}</SweepButton>
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
          style={cat===c?{backgroundColor:T.teal,color:"white",borderRadius:RADIUS.xs}:{color:T.teal,borderRadius:RADIUS.xs}}>{c}</button>)}
        <div className="hidden md:block mt-6 p-5" style={{border:`1px solid ${T.gold}`,borderRadius:RADIUS.xs}}>
          <p className="text-[13px] italic mb-2" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Still have questions?</p>
          <p className="text-[12px] leading-[1.6] mb-4" style={{color:"rgba(36,62,65,0.6)"}}>We're happy to help with anything not covered here.</p>
          <a href="mailto:support@akaraonline.co.in" className="text-[11.5px] uppercase tracking-[0.08em]" style={{color:T.teal}}>Contact Us →</a>
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
        <div className="md:hidden mt-8 p-5" style={{border:`1px solid ${T.gold}`,borderRadius:RADIUS.xs}}>
          <p className="text-[13px] italic mb-2" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Still have questions?</p>
          <p className="text-[12px] leading-[1.6] mb-4" style={{color:"rgba(36,62,65,0.6)"}}>We're happy to help with anything not covered here.</p>
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
  const openOrder=(o,view)=>{ setOrder(o); navigate(view); }; // sets this specific order as the app's "active" order before navigating — see the note above OrderStatusView/InvoiceView about this being a per-app-instance limitation, not per-order-history yet
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
    <p className="text-[14px] mb-7" style={{color:"rgba(36,62,65,0.55)"}}>Sign in to see your orders, wishlist, and account details.</p>
    <SweepButton filled onClick={()=>navigate("login")}>Sign In</SweepButton>
  </div>;
  return <div className="px-6 md:px-14 py-16 max-w-[1000px] mx-auto">
    <div className="flex items-end justify-between mb-10 flex-wrap gap-4">
      <h1 className="italic text-[30px] md:text-[38px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>My Account</h1>
      <p className="text-[13.5px]" style={{color:"rgba(36,62,65,0.55)"}}>Signed in as <strong style={{color:T.teal}}>{user.email}</strong></p>
    </div>
    <div className="flex gap-8 mb-10 overflow-x-auto akara-no-scrollbar" style={{borderBottom:"1px solid rgba(36,62,65,0.12)"}}>
      {["Orders","Wishlist","Addresses","Payment Methods","Profile"].map(t=><button key={t} onClick={()=>setTab(t)} className="pb-4 text-[13px] transition-colors whitespace-nowrap"
        style={{color:tab===t?T.teal:"rgba(36,62,65,0.45)",borderBottom:tab===t?`2px solid ${T.gold}`:"2px solid transparent",marginBottom:"-1px"}}>{t}</button>)}
    </div>
    {tab==="Orders"&&(ordersLoading
      ?<div className="text-center py-16"><p className="text-[13px]" style={{color:"rgba(36,62,65,0.4)"}}>Loading your orders…</p></div>
      :orders.length===0
      ?<div className="text-center py-16"><p className="text-[14px] mb-6" style={{color:"rgba(36,62,65,0.5)"}}>No orders yet.</p><SweepButton filled onClick={()=>navigate("shop")}>Explore the Collection</SweepButton></div>
      :<div className="flex flex-col gap-4">
        {orders.map(o=><div key={o.orderNumber} className="p-6" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
          <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
            <div>
              <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>#{o.orderNumber}</p>
              <p className="text-[12px]" style={{color:"rgba(36,62,65,0.5)"}}>{o.items.length} item{o.items.length>1?"s":""} · ₹{o.total.toLocaleString("en-IN")} · {new Date(o.placedAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</p>
            </div>
            <span className="text-[10.5px] uppercase tracking-[0.08em] px-3 py-1.5" style={o.status==="cancelled"?{backgroundColor:"rgba(192,57,43,0.08)",color:T.error}:(o.paymentStatus==="paid"||o.paymentStatus==="cod")?{backgroundColor:"rgba(184,147,90,0.14)",color:T.gold}:o.paymentStatus==="refunded"?{backgroundColor:"rgba(36,62,65,0.07)",color:T.teal}:{backgroundColor:"rgba(192,57,43,0.08)",color:T.error}}>
              {o.status==="cancelled"?"Cancelled":(o.paymentStatus==="paid"||o.paymentStatus==="cod")?(stageIndexFromOrder(o)>=4?"Delivered":stageIndexFromOrder(o)>=3?"In Transit":"Processing"):o.paymentStatus==="refunded"?"Refunded":o.paymentStatus==="failed"?"Payment Failed":"Payment Pending"}
            </span>
          </div>
          <div className="flex gap-3 flex-wrap mb-4">
            <SweepButton onClick={()=>openOrder(o,"order-status")}>Track Order</SweepButton>
            <SweepButton onClick={()=>openOrder(o,"invoice")}>View Invoice</SweepButton>
            <SweepButton onClick={()=>openOrder(o,"return-request")}>Request a Return</SweepButton>
          </div>
          {o.paymentStatus==="paid"&&o.status!=="cancelled"&&<div className="flex flex-col gap-2 pt-4" style={{borderTop:"1px solid rgba(36,62,65,0.08)"}}>
            {o.items.map(i=><div key={i.id+(i.size||"")} className="flex items-center justify-between gap-3">
              <span className="text-[12.5px]" style={{color:"rgba(36,62,65,0.6)"}}>{i.name}</span>
              <button onClick={()=>setReviewTarget({orderNumber:o.orderNumber,productId:i.id,productName:i.name})} className="text-[11.5px] uppercase tracking-[0.05em] underline shrink-0" style={{color:T.teal}}>Write a Review</button>
            </div>)}
          </div>}
        </div>)}
      </div>
    )}
    {tab==="Addresses"&&<div className="max-w-[560px]">
      {addressesLoading?<div className="flex flex-col gap-3 mb-6">{[0,1].map(i=><Skeleton key={i} height={70}/>)}</div>:<>
      {addresses.length===0&&!showAddrForm&&<p className="text-[14px] mb-6" style={{color:"rgba(36,62,65,0.5)"}}>No saved addresses yet.</p>}
      {addresses.map(a=><div key={a.id} className="flex items-start gap-4 p-5 mb-4" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
        <MapPin size={16} style={{color:T.gold,flexShrink:0,marginTop:2}}/>
        <div className="flex-1">
          <p className="text-[14px] mb-1" style={{color:T.teal,fontFamily:"'Fraunces',serif"}}>{a.name}</p>
          <p className="text-[12.5px] leading-[1.6]" style={{color:"rgba(36,62,65,0.6)"}}>{a.line}{a.landmark?`, near ${a.landmark}`:""}, {a.city}, {a.state} — {a.pin}</p>
          <p className="text-[12.5px] mt-1" style={{color:"rgba(36,62,65,0.5)"}}>{a.phone}</p>
        </div>
        <button onClick={()=>removeAddress(a.id)} style={{color:"rgba(36,62,65,0.4)"}}><Trash2 size={14}/></button>
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
          <div className="aspect-square flex items-center justify-center mb-3" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
            <p.Art className="w-1/3 h-1/3 transition-transform group-hover:scale-110 duration-500" style={{color:T.gold,opacity:0.85}}/>
          </div>
          <h3 className="text-[13.5px] italic" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{p.name}</h3>
          <p className="text-[13px]" style={{color:T.teal}}>₹{p.price}</p>
        </div>)}
      </div>
    )}
    {tab==="Profile"&&<div className="max-w-[420px]">
      <form onSubmit={saveProfile} className="flex flex-col gap-5 mb-8">
        <InputField label="Full Name" value={profileName} onChange={setProfileName} required/>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Email</label>
          <input value={user?.email||""} disabled className="w-full bg-transparent outline-none text-[14px] cursor-not-allowed" style={{border:"1px solid rgba(36,62,65,0.14)",borderRadius:RADIUS.xs,padding:"13px 14px",color:"rgba(36,62,65,0.5)"}}/>
          <p className="text-[11px] mt-1.5" style={{color:"rgba(36,62,65,0.4)"}}>Contact us to change the email on your account.</p>
        </div>
        <SweepButton filled type="submit" disabled={profileSaving}>{profileSaving?"Saving…":"Save Changes"}</SweepButton>
      </form>
      <div className="pt-8" style={{borderTop:"1px solid rgba(36,62,65,0.1)"}}>
        <p className="text-[13px] mb-4" style={{color:"rgba(36,62,65,0.55)"}}>Password</p>
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
    </div>}
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
      <p className="text-[15px] leading-[1.75]" style={{color:"rgba(36,62,65,0.6)"}}>Ordering more than a handful of pieces — for a property, an office, or a gifting programme? Tell us what you're picturing and we'll put together a custom quote and production timeline, separate from our standard checkout.</p>
    </section>
    <section className="px-6 max-w-[900px] mx-auto pb-16 grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
      {[["Custom Quantities","No minimum stated upfront — tell us your volume and we'll confirm what's realistic within our production capacity."],
        ["Dedicated Timeline","Bulk orders get their own production schedule, communicated clearly rather than the standard 2–3 week estimate."],
        ["Direct Contact","One point of contact for the whole order — no need to place 50 separate carts."]]
        .map(([t,d])=><div key={t} className="p-6" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
          <p className="text-[13.5px] mb-2" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{t}</p>
          <p className="text-[12px] leading-[1.7]" style={{color:"rgba(36,62,65,0.55)"}}>{d}</p>
        </div>)}
    </section>
    <section className="px-6 max-w-[580px] mx-auto pb-24">
      <h2 className="italic text-[22px] text-center mb-9" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Tell us about your order.</h2>
      {sent?<div className="text-center py-8">
        <p className="text-[14px] mb-2" style={{color:T.teal}}>Thanks — we've received your enquiry.</p>
        <p className="text-[13px]" style={{color:"rgba(36,62,65,0.55)"}}>We'll get back to you at {sanitize(form.email)} within 2 business days. For anything urgent, write to us directly at <a href="mailto:info@akaraonline.co.in" style={{color:T.teal}}>info@akaraonline.co.in</a>.</p>
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
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Tell us more *</label>
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
const RETURN_REASONS=["Damaged in transit","Defective / manufacturing issue","Wrong item received","Significantly different than described","Other"];
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
    <Lock size={32} strokeWidth={1.2} style={{color:"rgba(36,62,65,0.3)",margin:"0 auto 20px"}}/>
    <h1 className="italic text-[24px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Sign in to request a return.</h1>
    <p className="text-[13.5px] mb-8" style={{color:"rgba(36,62,65,0.55)"}}>We need to verify the order belongs to your account first.</p>
    <SweepButton filled onClick={()=>navigate("login")}>Sign In</SweepButton>
  </div>;

  return <div className="px-6 md:px-14 py-16 max-w-[600px] mx-auto">
    <p className="text-[12px] tracking-[0.3em] uppercase mb-4 text-center" style={{color:T.teal}}>Returns</p>
    <h1 className="italic text-[30px] md:text-[38px] mb-4 text-center" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Request a Return</h1>
    <p className="text-[13.5px] leading-[1.8] mb-10 text-center" style={{color:"rgba(36,62,65,0.55)"}}>7-day return window for damaged, defective, or significantly-different-than-described pieces. A photo of the issue helps us review your request faster.</p>
    {sent?<div className="text-center py-10 px-6" style={{backgroundColor:T.card,boxShadow:ELEVATION.raised,borderRadius:RADIUS.md}}>
      <Check size={28} style={{color:T.success,margin:"0 auto 16px"}}/>
      <p className="text-[14px] mb-2" style={{color:T.teal}}>Your return request has been submitted.</p>
      <p className="text-[13px]" style={{color:"rgba(36,62,65,0.55)"}}>We'll review it and get back to you at {sanitize(contactEmail)}.</p>
    </div>
    :<form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <InputField label="Order Number" value={orderNumber} onChange={setOrderNumber} placeholder="e.g. AK12345" error={errors.orderNumber} required/>
      {matchedOrder&&<p className="text-[11.5px] -mt-2" style={{color:T.teal}}>Order found — {matchedOrder.items.length} item{matchedOrder.items.length>1?"s":""} on file.</p>}
      <InputField label="Item Name" value={itemName} onChange={setItemName} error={errors.itemName} required/>
      <div>
        <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Reason *</label>
        <select value={reason} onChange={e=>setReason(e.target.value)} className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,padding:"13px 14px",color:T.teal,fontFamily:"'Space Grotesk',sans-serif"}}>
          {RETURN_REASONS.map(r=><option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <InputField label="Contact Email" type="email" value={contactEmail} onChange={setContactEmail} error={errors.contactEmail} required/>
      <InputField label="Contact Phone" type="tel" value={contactPhone} onChange={setContactPhone} error={errors.contactPhone} required/>
      <div>
        <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Describe what happened *</label>
        <textarea rows={4} value={description} onChange={e=>setDescription(sanitize(e.target.value))} maxLength={1500}
          className="w-full bg-transparent outline-none text-[14px]" style={{border:`1px solid ${errors.description?T.error:"rgba(36,62,65,0.22)"}`,borderRadius:RADIUS.xs,padding:"13px 14px",color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
        {errors.description&&<p className="text-[11.5px] mt-1.5 flex items-center gap-1" style={{color:T.error}}><AlertCircle size={12}/>{errors.description}</p>}
      </div>
      <div>
        <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Photo of the Issue (optional, recommended)</label>
        {photoUrl?<div className="flex items-center gap-3 p-3" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs}}>
          <img src={photoUrl} alt="Uploaded" className="w-14 h-14 object-cover"/>
          <p className="text-[12.5px] flex-1" style={{color:T.success}}>Photo uploaded</p>
          <button type="button" onClick={()=>setPhotoUrl(null)} style={{color:"rgba(36,62,65,0.4)"}}><X size={16}/></button>
        </div>
        :<label className="flex items-center justify-center gap-2 px-4 py-6 cursor-pointer text-[12.5px]" style={{border:"1px dashed rgba(36,62,65,0.3)",color:"rgba(36,62,65,0.5)"}}>
          {photoUploading?"Uploading…":"Click to upload a photo"}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoSelect} disabled={photoUploading} className="hidden"/>
        </label>}
        {photoError&&<p className="text-[11.5px] mt-1.5 flex items-center gap-1" style={{color:T.error}}><AlertCircle size={12}/>{photoError}</p>}
      </div>
      <SweepButton filled type="submit" disabled={submitting} className="w-full">{submitting?"Submitting…":"Submit Return Request"}</SweepButton>
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
    <p className="text-[12px] tracking-[0.3em] uppercase mb-4 text-center" style={{color:T.teal}}>Care Guide</p>
    <h1 className="italic text-[32px] md:text-[44px] mb-5 text-center" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Caring for your ĀKĀRA piece</h1>
    <p className="text-[14.5px] leading-[1.85] mb-14 text-center" style={{color:"rgba(36,62,65,0.6)"}}>Every piece is 3D-printed in plant-based PLA — closer in care needs to a fine ceramic than to plastic homeware. A little care keeps the finish and colour looking the way it did on day one.</p>
    {CARE_SECTIONS.map(s=><div key={s.title} className="mb-10">
      <h2 className="text-[17px] italic mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{s.title}</h2>
      <ul className="flex flex-col gap-2.5">
        {s.points.map(p=><li key={p} className="flex items-start gap-2.5 text-[13.5px] leading-[1.7]" style={{color:"rgba(36,62,65,0.65)"}}><Check size={13} style={{color:T.gold,marginTop:4,flexShrink:0}}/>{p}</li>)}
      </ul>
    </div>)}
    <div className="mt-14 p-6 text-center" style={{border:`1px solid ${T.gold}`,borderRadius:RADIUS.xs}}>
      <p className="text-[13px] mb-3" style={{color:"rgba(36,62,65,0.6)"}}>Still unsure about a specific piece?</p>
      <button onClick={()=>navigate("contact")} className="text-[12px] uppercase tracking-[0.1em]" style={{color:T.teal}}>Ask Us Directly →</button>
    </div>
  </div>;
}

// Email subscription management page (/email-preferences) — toggle
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
    <p className="text-[13.5px] leading-[1.8] mb-10 text-center" style={{color:"rgba(36,62,65,0.55)"}}>Order confirmations, shipping updates, and other transactional emails aren't optional — you'll always get those for an order you place. Everything below is up to you.</p>
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
              <span className="block text-[12px] mt-0.5" style={{color:"rgba(36,62,65,0.5)"}}>{desc}</span>
            </span>
          </label>)}
      </div>
      <SweepButton filled type="submit" className="w-full" disabled={saving}>{saving?"Saving…":"Save Preferences"}</SweepButton>
      <button type="button" onClick={unsubscribeAll} disabled={saving} className="text-[12px] underline mx-auto" style={{color:"rgba(36,62,65,0.5)"}}>Unsubscribe from all marketing emails</button>
      {saved&&<p className="text-[13px] text-center" style={{color:T.teal}}>{unsubscribed?"You've been unsubscribed from all marketing emails.":"Preferences saved."}</p>}
    </form>
  </div>;
}

// Accessibility commitment page (/accessibility). Note: the sitewide
// focus-visible outline and prefers-reduced-motion support (see FONTS
// above) exist specifically to back up what this page promises — don't
// let this page's claims drift out of sync with what's actually built.
function AccessibilityView(){return <LegalShell title="Accessibility Statement" updated="August 2026" icon={Accessibility}>
  <Lp c="Precision Forge Labs is committed to making akaraonline.co.in usable by as many people as possible, including people with visual, motor, auditory, or cognitive disabilities."/>
  <Lh c="What We Aim For"/>
  <Lp c="We aim to follow the Web Content Accessibility Guidelines (WCAG) 2.1 at a Level AA standard where practical — covering things like readable colour contrast, keyboard navigability, descriptive alt text on meaningful images, and clear, consistent navigation."/>
  <Lh c="Ongoing Work"/>
  <Lp c="Accessibility is an ongoing effort, not a one-time fix. As the site grows — new products, new pages, new features — we review and improve accessibility alongside that work rather than treating it as separate."/>
  <Lh c="Feedback"/>
  <Lp c={<>If you encounter any part of this site that's difficult to use with a screen reader, keyboard-only navigation, or any other assistive technology, please let us know at <a href="mailto:support@akaraonline.co.in" style={{color:T.teal}}>support@akaraonline.co.in</a> — we take this feedback seriously and will do our best to address it.</>}/>
</LegalShell>;}

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
      {Icon&&<div className="w-11 h-11 flex items-center justify-center shrink-0" style={{backgroundColor:"rgba(184,147,90,0.12)",borderRadius:RADIUS.sm}}><Icon size={19} style={{color:T.gold}}/></div>}
      <h1 className="italic text-[28px] md:text-[36px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{title}</h1>
    </div>
    <p className="text-[12px] mb-10 md:mb-14" style={{color:"rgba(36,62,65,0.4)"}}>Last updated: {updated}</p>
    <div className="flex flex-col md:flex-row gap-10 md:gap-16">
      {sections.length>0&&<nav aria-label="Sections on this page" className="md:w-[230px] shrink-0 md:sticky md:top-24 md:self-start order-2 md:order-1">
        <p className="text-[11px] tracking-[0.12em] uppercase mb-3" style={{color:"rgba(36,62,65,0.4)"}}>On This Page</p>
        <div className="flex flex-col gap-2.5 md:max-h-[65vh] md:overflow-y-auto md:pr-2">
          {sections.map(s=><a key={s.id} href={`#${s.id}`} className="text-[12.5px] leading-snug hover:underline" style={{color:"rgba(36,62,65,0.6)"}}>{s.text}</a>)}
        </div>
      </nav>}
      <div ref={contentRef} className="flex-1 max-w-[720px] order-1 md:order-2">{children}</div>
    </div>
  </div>;
}
// Legal-page paragraph — `c` can be a plain string or JSX (for inline
// links, e.g. Lp with a <button> or <a> inside it).
function Lp({c}){return <p className="text-[14.5px] leading-[1.85] mb-4" style={{color:"rgba(36,62,65,0.68)"}}>{c}</p>;}
// Legal-page section subheading — id is auto-slugified from its own text
// so LegalShell's table of contents can link straight to it; scroll-mt
// keeps the sticky header from covering the heading when jumped to.
function Lh({c}){
  const id=typeof c==="string"?c.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,""):undefined;
  return <h2 id={id} className="text-[17px] italic mt-10 mb-4 scroll-mt-24" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{c}</h2>;
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
function PrivacyPolicyView({navigate}){return <LegalShell title="Privacy Policy" updated="August 2026" icon={Shield}>
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
  <Lp c={<>We use essential local storage to keep your cart and wishlist between visits, and Razorpay sets its own cookies during checkout. Full detail is in our <button onClick={()=>navigate("cookies")} className="underline" style={{color:T.teal}}>Cookie Policy</button>.</>}/>

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
  <Lp c={<>To exercise any of these rights, write to <a href="mailto:dpo@akaraonline.co.in" style={{color:T.teal}}>dpo@akaraonline.co.in</a>. We aim to respond within 30 days.</>}/>

  <Lh c="10. Grievance Officer"/>
  <Lp c={<>In accordance with applicable Indian data protection law, our Grievance Officer is <strong style={{color:T.teal}}>Vishal Singh</strong>, reachable at <a href="mailto:dpo@akaraonline.co.in" style={{color:T.teal}}>dpo@akaraonline.co.in</a> for any concerns regarding how your personal data is handled.</>}/>

  <Lh c="11. Children's Privacy"/>
  <Lp c="Our site is intended for users who are 18 years or older, or minors with the involvement of a parent or guardian. We do not knowingly collect personal data from children without such involvement."/>

  <Lh c="12. Changes to This Policy"/>
  <Lp c="We may update this policy from time to time as our practices or the law evolve. Material changes will be reflected here with an updated 'Last updated' date."/>
</LegalShell>;}
// /refund — cross-links to the real ReturnRequestView page rather than
// just listing an email address.
function RefundPolicyView({navigate}){return <LegalShell title="Refund & Return Policy" updated="August 2026" icon={RotateCcw}><Lp c="Every ĀKĀRA piece is made to order. Please check size, colour, and photos carefully before ordering."/><Lh c="7-Day Return Window"/><Lp c="Returns accepted within 7 days of delivery if the piece arrives damaged, defective, or significantly different from what was described. We cannot accept returns for a change of mind."/><Lh c="30-Day Warranty"/><Lp c="Every piece is covered against manufacturing defects for 30 days from delivery."/><Lh c="How to Request"/><Lp c={<>Use our <button onClick={()=>navigate("return-request")} className="underline" style={{color:T.teal}}>Request a Return</button> page with your order number, the item, and a couple of photos — or email <a href="mailto:support@akaraonline.co.in" style={{color:T.teal}}>support@akaraonline.co.in</a> directly. We respond within 72 hours.</>}/></LegalShell>;}
// /shipping — 10 sections: production time, cost, delivery time,
// courier partners (Delhivery/BlueDart/Shiprocket/India Post), dispatch,
// packaging, serviceable areas, tracking, failed delivery, damaged/
// missing in transit.
function ShippingPolicyView(){return <LegalShell title="Shipping Policy" updated="August 2026" icon={Truck}>
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
  <Lp c={<>We currently ship across India, to all pin codes serviceable by our courier partners. For international orders, please write to <a href="mailto:info@akaraonline.co.in" style={{color:T.teal}}>info@akaraonline.co.in</a> before ordering — we'll confirm feasibility and cost on a case-by-case basis.</>}/>

  <Lh c="8. Order Tracking"/>
  <Lp c="Once dispatched, your order status moves through five stages — Confirmed, Production, QC & Packaging, Dispatched, and Delivered — visible from My Account → Orders → Track Order, along with the courier's own tracking link once available."/>

  <Lh c="9. Failed Delivery Attempts"/>
  <Lp c="Our courier partners typically attempt delivery 2–3 times before returning a shipment to us. Please ensure the address and phone number provided at checkout are accurate and reachable. If a shipment is returned due to repeated failed delivery, we'll get in touch to arrange reshipment — additional shipping charges may apply."/>

  <Lh c="10. Damaged or Missing in Transit"/>
  <Lp c={<>Every piece is quality-checked and carefully packed before it leaves our studio, but if your order arrives damaged, or an item is missing from the package, please email <a href="mailto:support@akaraonline.co.in" style={{color:T.teal}}>support@akaraonline.co.in</a> within 7 days of delivery with your order number and photos of the item and packaging. We'll arrange a replacement or refund as covered under our Refund Policy — please don't discard the packaging until this is resolved, as our courier partner may need it for a claim.</>}/>
</LegalShell>;}
// /terms — 15 sections including the ±2-3mm 3D-printing tolerance
// disclosure, 24-hour cancellation window, and CGST/SGST tax explanation.
function TermsOfServiceView({navigate}){return <LegalShell title="Terms of Service" updated="August 2026" icon={FileText}>
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
  <Lp c={<>Shipping timelines, costs, and courier partners are detailed in our <button onClick={()=>navigate("shipping")} className="underline" style={{color:T.teal}}>Shipping Policy</button>. Delivery estimates are provided in good faith and are not guaranteed, as they depend in part on our courier partners.</>}/>

  <Lh c="11. Returns, Refunds & Warranty"/>
  <Lp c={<>Our return window, warranty coverage, and refund process are detailed in our <button onClick={()=>navigate("refund")} className="underline" style={{color:T.teal}}>Refund & Return Policy</button>. In summary: a 7-day return window for damaged, defective, or significantly-different-than-described pieces, and a 30-day warranty against manufacturing defects.</>}/>

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
function CookiePolicyView(){return <LegalShell title="Cookie Policy" updated="January 2026" icon={Cookie}><Lp c="This page explains the cookies and local storage akaraonline.co.in uses."/><Lh c="What We Use"/><Lp c="Essential: keeps your cart and wishlist saved between visits. Payment: Razorpay sets its own cookies during checkout. Analytics (optional): aggregate, anonymous data to help us improve the site."/><Lh c="What We Don't Do"/><Lp c="We don't use cookies to track you across other websites or build advertising profiles."/><Lh c="Managing Cookies"/><Lp c="You can block or delete cookies in your browser settings. Blocking essential cookies means your cart won't persist between visits."/></LegalShell>;}

// Catch-all 404 page — rendered whenever the current view isn't in
// ALL_VIEWS, or parsePath() couldn't resolve the URL at all.
function NotFoundView({ navigate }) {
  return <div className="px-6 py-32 text-center">
    <p className="italic text-[80px] mb-4 leading-none" style={{fontFamily:"'Fraunces',serif",color:T.gold,opacity:0.4}}>404</p>
    <h1 className="italic text-[26px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>This page doesn't exist.</h1>
    <p className="text-[14px] mb-8" style={{color:"rgba(36,62,65,0.5)"}}>The piece you're looking for may have moved.</p>
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
      return {...product,size,qty};
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
  const [order,setOrder]=useState(null);
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
      setCart(loadStoredCart(products));
      setWishlist(loadStoredWishlist(products));
      setHasHydrated(true);
    }
  },[productsLoading]);

  useEffect(()=>{ if(hasHydrated) safeStorageSet("akara_cart",cart.map(i=>({id:i.id,size:i.size,qty:i.qty}))); },[cart,hasHydrated]);
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

  const navigate=useCallback((v,id=null)=>{
    setNotFound(false);
    setView(v);
    if(v==="product"&&id) setProductId(id);
    if(v==="shop") setShopCategory(typeof id==="string"&&CATEGORIES.includes(id)?id:null);
    if(v==="search") setSearchQuery(typeof id==="string"?id:"");
    if(v==="account") setAccountTab(typeof id==="string"?id:null);
    const path=buildPath(v,id);
    if(typeof window!=="undefined"&&window.location.pathname+window.location.search!==path) window.history.pushState({},"",path);
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
    setMeta("name","robots",notFound?"noindex, follow":"index, follow");
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
          price:product.price,
          availability:product.status==="sold-out"?"https://schema.org/OutOfStock":product.status==="low-stock"?"https://schema.org/LimitedAvailability":product.status==="pre-order"?"https://schema.org/PreOrder":"https://schema.org/InStock",
        },
        ...(reviewSummary?{aggregateRating:{"@type":"AggregateRating",ratingValue:reviewSummary.average.toFixed(1),reviewCount:reviewSummary.count}}:{}),
      }:{
        "@context":"https://schema.org",
        "@type":"Organization",
        name:"Precision Forge Labs",
        alternateName:"ĀKĀRA",
        url:"https://akaraonline.co.in",
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
  const productExists=productsLoading||view!=="product"||products.some(p=>p.id===productId);

  // Nothing that depends on real product data renders until it's actually
  // loaded — avoids a flash of empty grids/undefined errors on first paint.
  // A failed fetch (productsError) shows a real error state with a retry
  // button rather than a silent blank page.
  if(productsLoading||productsError){
    return <div className="min-h-screen w-full flex flex-col items-center justify-center px-6 text-center" style={{backgroundColor:T.cream,fontFamily:"'Space Grotesk',system-ui,sans-serif"}}>
      <style>{FONTS}</style>
      {productsError
        ? <>
            <p className="italic text-[24px] mb-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Couldn't load the collection.</p>
            <p className="text-[13.5px] mb-6" style={{color:"rgba(36,62,65,0.55)"}}>Something went wrong reaching the server. Please check your connection and try again.</p>
            <SweepButton filled onClick={()=>window.location.reload()}>Retry</SweepButton>
          </>
        : <div className="flex flex-col items-center">
            <div className="akara-splash-line mb-7" style={{backgroundColor:T.gold}}/>
            <p className="italic" style={{fontFamily:"'Fraunces',serif",color:T.teal,fontSize:"clamp(36px,7vw,56px)"}}>
              {[{ch:"A",mac:true},{ch:"K",mac:false},{ch:"A",mac:true},{ch:"R",mac:false},{ch:"A",mac:false}].map((l,i)=>
                <span key={i} className="akara-splash-letter" style={{animationDelay:`${i*0.09}s`}}>{l.mac?<Mac>{l.ch}</Mac>:l.ch}</span>
              )}
            </p>
            <p className="akara-splash-tagline text-[11px] tracking-[0.25em] uppercase mt-5" style={{color:T.teal}}>Artifacts for Modern Spaces</p>
          </div>}
    </div>;
  }

  return <ProductsContext.Provider value={{products,loading:productsLoading,error:productsError}}>
  <div className="min-h-screen w-full flex flex-col" style={{backgroundColor:T.cream,fontFamily:"'Space Grotesk',system-ui,sans-serif",color:T.teal}}>
    <style>{FONTS}</style>
    <a href="#main-content" className="skip-link">Skip to content</a>
    <Header navigate={navigate} onOpenDrawer={()=>setDrawerOpen(true)} onOpenCart={()=>setCartOpen(true)} cartCount={cartCount} wishCount={wishlist.length} user={user} className="no-print"/>
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
      {!notFound&&productExists&&view==="product"&&<ProductDetailView productId={productId} navigate={navigate} cart={cart} setCart={setCart} wishlist={wishlist} toggleWishlist={toggleWishlist}/>}
      {!notFound&&view==="cart"&&<CartView navigate={navigate} cart={cart} setCart={setCart} appliedCoupon={appliedCoupon} setAppliedCoupon={setAppliedCoupon}/>}
      {!notFound&&view==="checkout"&&<CheckoutView navigate={navigate} cart={cart} setCart={setCart} setOrder={setOrder} appliedCoupon={appliedCoupon} setAppliedCoupon={setAppliedCoupon} user={user} setPostLoginRedirect={setPostLoginRedirect}/>}
      {!notFound&&view==="order-confirmed"&&<OrderConfirmedView navigate={navigate} order={order}/>}
      {!notFound&&view==="order-status"&&<OrderStatusView navigate={navigate} order={order} setOrder={setOrder}/>}
      {!notFound&&view==="invoice"&&<InvoiceView navigate={navigate} order={order}/>}
      {!notFound&&view==="payment-failed"&&<PaymentFailedView navigate={navigate}/>}
      {!notFound&&view==="about"&&<AboutView navigate={navigate}/>}
      {!notFound&&view==="craft"&&<CraftView navigate={navigate}/>}
      {!notFound&&view==="contact"&&<ContactView/>}
      {!notFound&&view==="faq"&&<FAQView/>}
      {!notFound&&view==="bulk-orders"&&<BulkOrdersView navigate={navigate}/>}
      {!notFound&&view==="return-request"&&<ReturnRequestView navigate={navigate} order={order} user={user}/>}
      {!notFound&&view==="care-guide"&&<CareGuideView navigate={navigate}/>}
      {!notFound&&view==="email-preferences"&&<EmailPreferencesView navigate={navigate}/>}
      {!notFound&&view==="accessibility"&&<AccessibilityView/>}
      {!notFound&&view==="account"&&<MyAccountView navigate={navigate} wishlist={wishlist} user={user} setUser={setUser} order={order} setOrder={setOrder} initTab={accountTab}/>}
      {!notFound&&view==="login"&&<LoginView navigate={navigate} onLogin={setUser} postLoginRedirect={postLoginRedirect} setPostLoginRedirect={setPostLoginRedirect}/>}
      {!notFound&&view==="signup"&&<SignupView navigate={navigate} onLogin={setUser} postLoginRedirect={postLoginRedirect} setPostLoginRedirect={setPostLoginRedirect}/>}
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
  </div>
  </ProductsContext.Provider>;
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
    return <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px",textAlign:"center",backgroundColor:"#FFF2DF",fontFamily:"'Space Grotesk',system-ui,sans-serif"}}>
      <p style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",fontSize:"28px",color:"#243E41",marginBottom:"12px"}}>Something went wrong.</p>
      <p style={{fontSize:"14px",color:"rgba(36,62,65,0.6)",maxWidth:"420px",marginBottom:"28px",lineHeight:1.7}}>
        This page hit an unexpected error. Refreshing usually fixes it — if it keeps happening, please let us know at support@akaraonline.co.in.
      </p>
      <button onClick={()=>window.location.reload()} style={{padding:"14px 28px",fontSize:"12px",letterSpacing:"0.14em",textTransform:"uppercase",backgroundColor:"#243E41",color:"white",border:"none",cursor:"pointer"}}>Reload Page</button>
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
