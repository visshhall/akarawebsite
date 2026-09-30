// ============================================================================
// AdminApp — split into its own file (rather than living inline in
// AkaraApp.jsx alongside everything else) specifically so it can be
// code-split via dynamic import(). Recharts alone is ~400KB — bundling it
// into the main app would mean every single customer visit downloads the
// entire admin dashboard's charting library, even though only one person
// ever uses it. See the dynamic import in AkaraApp.jsx's root export.
// ============================================================================
import { useState, useEffect, useRef, useCallback } from "react";
import {
  X, Package, ShoppingCart, LayoutDashboard, LogOut, Pencil, Save,
  PlusCircle, Trash2, AlertCircle, AlertTriangle, Inbox, Menu, ExternalLink,
  Users, Settings, History, RotateCcw, Mail, Download,
  Image as ImageIcon, Film, ChevronLeft, ChevronRight, Star, Upload, Copy, Shield, UserPlus, FileText, GripVertical, Layers, Search, Filter, BarChart3 } from "lucide-react";
import { LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { T, ELEVATION, RADIUS, ICON, sanitize, apiFetch, Mac, SweepButton, InputField, useToast, Modal, Skeleton, EmptyState, Badge , TurnstileWidget } from "./shared.jsx";

// —— Admin visual system — atelier manuscript (not SaaS cards) ——
const ADMIN_PAGE_BG = { background: "transparent", minHeight: "100%" };
const ATELIER_PANEL = {
  backgroundColor: "rgba(247,243,235,0.72)",
  borderRadius: 12,
  boxShadow: "0 1px 0 rgba(24,54,48,0.04)",
  border: "1px solid rgba(24,54,48,0.08)",
  borderLeft: "3px solid #E5C690",
};
const ATELIER_ROW = {
  backgroundColor: "transparent",
  borderRadius: 0,
  boxShadow: "none",
  borderBottom: "1px solid rgba(24,54,48,0.1)",
};
/** Section labels: teal on cream (gold was too low-contrast) */
const ATELIER_LABEL = { color: "#183630", letterSpacing: "0.14em", textTransform: "uppercase", fontSize: 10, fontWeight: 600 };
function atelierChipStyle(active) {
  return {
    borderRadius: 999,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontSize: 11,
    fontWeight: 500,
    backgroundColor: active ? T.teal : "transparent",
    color: active ? "#F5F0E8" : T.teal,
    border: `1px solid ${active ? T.teal : "rgba(24,54,48,0.22)"}`,
  };
}
function AtelierChip({ active, onClick, children, disabled, className = "" }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={"px-3.5 py-1.5 min-h-[36px] transition-colors disabled:opacity-50 " + className}
      style={atelierChipStyle(active)}>
      {children}
    </button>
  );
}
function AtelierKpi({ label, value, sub, accent = T.gold, onClick, asButton = true }) {
  const Comp = asButton ? "button" : "div";
  return (
    <Comp type={asButton ? "button" : undefined} onClick={onClick}
      className="p-4 text-left w-full">
      <div style={{ ...ATELIER_PANEL, borderLeft: `2px solid ${accent}`, padding: "16px 18px" }}>
        <p className="text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: "rgba(36,62,65,0.55)" }}>{label}</p>
        <p className="text-[22px] leading-none mb-1" style={{ fontFamily: "'Fraunces',serif", color: T.teal, fontWeight: 400 }}>{value}</p>
        {sub ? <p className="text-[11px] mt-1.5" style={{ color: "rgba(36,62,65,0.6)" }}>{sub}</p> : null}
      </div>
    </Comp>
  );
}
function AtelierSectionLabel({ n, children }) {
  return (
    <p className="text-[10px] tracking-[0.16em] uppercase mb-2" style={{ color: T.gold }}>
      {n ? `${n} · ${children}` : children}
    </p>
  );
}
const STATUS_TONE = {
  confirmed: { bg: "rgba(24,54,48,0.08)", fg: T.teal },
  production: { bg: "rgba(229,198,144,0.35)", fg: "#6B5428" },
  qc: { bg: "rgba(59,110,82,0.15)", fg: T.success },
  dispatched: { bg: "rgba(24,54,48,0.12)", fg: T.teal },
  delivered: { bg: "rgba(59,110,82,0.22)", fg: T.success },
  cancelled: { bg: "rgba(168,59,50,0.12)", fg: T.error },
  draft: { bg: "rgba(36,62,65,0.08)", fg: T.muted },
  live: { bg: "rgba(59,110,82,0.15)", fg: T.success },
  "sold-out": { bg: "rgba(168,59,50,0.12)", fg: T.error },
  paid: { bg: "rgba(59,110,82,0.15)", fg: T.success },
  cod: { bg: "rgba(229,198,144,0.4)", fg: "#6B5428" },
  pending: { bg: "rgba(181,101,29,0.12)", fg: T.warning },
  failed: { bg: "rgba(168,59,50,0.12)", fg: T.error },
  refunded: { bg: "rgba(36,62,65,0.1)", fg: T.muted },
  partially_refunded: { bg: "rgba(181,101,29,0.12)", fg: T.warning },
};
function StatusPill({ status, children }) {
  const key = String(status || "").toLowerCase();
  const tone = STATUS_TONE[key] || { bg: "rgba(24,54,48,0.08)", fg: T.teal };
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 text-[10.5px] uppercase tracking-[0.1em]"
      style={{ backgroundColor: tone.bg, color: tone.fg, borderRadius: 999, fontWeight: 500 }}>
      {children || status}
    </span>
  );
}
/** Hover / focus / tap explainers — desktop hover + mobile tap; fixed layer so it never paints under sibling cards */
function AdminInfoTip({ text, align = "center" }) {
  const [open, setOpen] = useState(false);
  const pos = align === "left" ? "left-0 translate-x-0" : "left-1/2 -translate-x-1/2";
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const t = setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
    return () => { clearTimeout(t); document.removeEventListener("click", close); };
  }, [open]);
  return (
    <span className={"relative inline-flex group align-middle ml-1.5" + (open ? " is-open" : "")} style={{ verticalAlign: "middle", zIndex: open ? 90 : 2 }}>
      <button
        type="button"
        className="w-[18px] h-[18px] rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 cursor-help"
        style={{ background: "rgba(24,54,48,0.1)", color: T.teal, border: "1px solid rgba(24,54,48,0.22)" }}
        aria-label="About this section"
        aria-expanded={open}
        title={typeof text === "string" ? text.slice(0, 120) : undefined}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        i
      </button>
      <span
        role="tooltip"
        className={"absolute " + pos + " bottom-full mb-2 w-56 sm:w-64 max-w-[min(18rem,70vw)] p-3 text-[11.5px] leading-snug transition-opacity " + (open ? "opacity-100 visible pointer-events-auto" : "opacity-0 invisible pointer-events-none group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible")}
        style={{ background: "#1a2e2c", color: "#F7F3EB", borderRadius: 8, boxShadow: "0 12px 32px rgba(0,0,0,0.28)", border: "1px solid rgba(196,163,90,0.25)", zIndex: 100 }}
      >
        {text}
      </span>
    </span>
  );
}

function AdminPageHeader({ eyebrow = "Studio", title, subtitle, actions, info }) {
  return (
    <div className="mb-8 md:mb-10 w-full">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] tracking-[0.22em] uppercase mb-2" style={{ color: T.teal, fontWeight: 600 }}>{eyebrow}</p>
          <h1 className="italic text-[28px] md:text-[36px] leading-[1.12]" style={{ fontFamily: "'Fraunces',serif", color: T.teal, fontWeight: 400 }}>
            {title}
            {info ? <AdminInfoTip text={info} align="left" /> : null}
          </h1>
          <div className="w-12 h-px mt-3 mb-3" style={{ backgroundColor: T.gold }} aria-hidden />
          {subtitle && <p className="text-[13.5px] max-w-2xl leading-relaxed" style={{ color: "rgba(36,62,65,0.68)" }}>{subtitle}</p>}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0 sm:pt-6">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
function AdminCard({ children, className = "", style = {} }) {
  return (
    <div className={"p-5 md:p-6 " + className} style={{ ...ATELIER_PANEL, ...style }}>
      {children}
    </div>
  );
}


// ============================================================================
// ADMIN PANEL — a completely separate application tree from the customer-
// facing site, sharing only this JS bundle and a few style tokens (T,
// SweepButton, InputField). AdminApp never touches ProductsContext, cart,
// wishlist, or customer auth state — the real isolation guarantee is the
// server (every /api/admin/* route requires a valid admin session, checked
// server-side — see server/adminAuth.js), but keeping the frontend trees
// separate too means there's no code path where customer-facing state
// could accidentally leak into or render inside the admin view.
//
// Routing here is intentionally simpler than the customer site's: the
// top-level split (admin vs. customer app) IS a real URL check
// (/admin prefix, in the root render below), but which admin screen is
// showing (Dashboard/Products/Orders) is plain React state, not
// individually bookmarkable URLs — a reasonable scope line for an
// internal tool used by one person, not something built for sharing links.
// ============================================================================
function AdminLogin({ onLogin }){
  const [email,setEmail]=useState(""); const [turnstileToken,setTurnstileToken]=useState("");
  const [password,setPassword]=useState("");
  const [err,setErr]=useState(""); const [submitting,setSubmitting]=useState(false);
  // Real two-step state — set only when the server's own response says
  // this account has 2FA enabled (requiresTwoFactor:true). A normal
  // account with no 2FA never sees this at all; the whole flow below
  // stays exactly as it was before for that (overwhelmingly common,
  // right now) case.
  const [pendingToken,setPendingToken]=useState(null);
  const [code,setCode]=useState("");

  const submit=async e=>{
    e.preventDefault();
    setSubmitting(true); setErr("");
    try{
      const res=await apiFetch("/api/admin/auth/login",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({email:sanitize(email),password,turnstileToken}),
      });
      const data=await res.json();
      if(!res.ok){ setErr(data.error||"Something went wrong."); setSubmitting(false); return; }
      if(data.requiresTwoFactor){ setPendingToken(data.pendingToken); setSubmitting(false); return; }
      onLogin(data.admin);
    }catch{
      setErr("Couldn't reach the server. Please check your connection and try again.");
      setSubmitting(false);
    }
  };

  const submitTwoFactor=async e=>{
    e.preventDefault();
    setSubmitting(true); setErr("");
    try{
      const res=await apiFetch("/api/admin/auth/login/verify-2fa",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({pendingToken,code:code.trim()}),
      });
      const data=await res.json();
      if(!res.ok){ setErr(data.error||"Something went wrong."); setSubmitting(false); return; }
      onLogin(data.admin);
    }catch{
      setErr("Couldn't reach the server. Please check your connection and try again.");
      setSubmitting(false);
    }
  };

  return <div className="min-h-screen w-full flex items-center justify-center p-4 md:p-8" style={{background:"linear-gradient(145deg,#183630 0%,#0f2420 48%,#1a3d36 100%)"}}>
    {/* Page background is cream, per direct instruction. But the brand
        panel went cream too when that changed, losing the teal brand
        color entirely instead of just fixing the original contrast
        problem — a real miss, not what "fix the contrast" should have
        meant. Brand panel restored to teal here — that's real contrast
        against the now-cream page (dark card, light page, genuinely
        visible), AND the brand color is back. White text restored to
        match, since it's teal again. */}
    <div className="w-full max-w-[760px] grid grid-cols-1 md:grid-cols-[1fr_1.1fr]" style={{borderRadius:0,overflow:"hidden",boxShadow:ELEVATION.modal,border:"1px solid rgba(24,54,48,0.12)"}}>
      {/* Brand panel — hidden on small screens to keep the login form front
          and center on mobile, where screen space is precious. */}
      <div className="hidden md:flex flex-col justify-start gap-10 p-10 relative overflow-hidden" style={{backgroundColor:T.teal}}>
        <img src="/logo-wordmark-gold.png" alt="ĀKĀRA" className="h-8 w-auto relative z-10 mb-1 object-contain" />
        <div className="relative z-10">
          <div className="w-11 h-px mb-5" style={{backgroundColor:T.gold}}/>
          <p className="italic text-[19px] leading-[1.5]" style={{fontFamily:"'Fraunces',serif",color:T.cream}}>Ākāra means form —<br/>made only once you ask.</p>
        </div>
      </div>
      <div className="p-8 md:p-10 flex flex-col justify-center" style={{backgroundColor:T.cream}}>
        <img src="/logo-wordmark.png" alt="ĀKĀRA" className="h-7 w-auto mb-2 md:hidden object-contain" />
        {pendingToken?<>
          <h1 className="italic text-[24px] mb-1.5" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Verification code</h1>
          <p className="text-[13.5px] mb-7" style={{color:"rgba(36,62,65,0.75)"}}>Enter the 6-digit code from your authenticator app, or a backup code.</p>
          {err&&<div className="flex items-center gap-2 px-4 py-3 mb-5 text-[13px]" style={{backgroundColor:"rgba(168,59,50,0.08)",color:T.error,borderRadius:RADIUS.sm}}><AlertCircle size={ICON.sm}/>{err}</div>}
          <form onSubmit={submitTwoFactor} noValidate className="flex flex-col gap-4">
            <InputField label="Code" value={code} onChange={v=>setCode(v.toUpperCase())} placeholder="123456 or XXXX-XXXX" required/>
            <SweepButton filled type="submit" disabled={submitting} className="w-full">{submitting?"Verifying…":"Verify"}</SweepButton>
            <button type="button" onClick={()=>{setPendingToken(null);setCode("");setErr("");}} className="text-[12.5px] underline" style={{color:"rgba(36,62,65,0.75)"}}>Back to sign in</button>
          </form>
        </>:<>
          <p className="text-[10px] tracking-[0.22em] uppercase mb-2" style={{color:T.teal,fontWeight:600}}>Studio access</p>
          <h1 className="italic text-[28px] mb-1.5" style={{fontFamily:"'Fraunces',serif",color:T.teal,fontWeight:400}}>Sign in</h1>
          <p className="text-[13.5px] mb-7" style={{color:T.muted}}>Authorized operators only — all actions are logged.</p>
          {err&&<div className="flex items-center gap-2 px-4 py-3 mb-5 text-[13px]" style={{backgroundColor:"rgba(168,59,50,0.08)",color:T.error,borderRadius:RADIUS.sm}}><AlertCircle size={ICON.sm}/>{err}</div>}
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <InputField label="Email" type="email" value={email} onChange={setEmail} required/>
            <InputField label="Password" type="password" value={password} onChange={setPassword} required/>
            <TurnstileWidget onToken={setTurnstileToken}/>
            <SweepButton filled type="submit" disabled={submitting} className="w-full">{submitting?"Signing in…":"Sign In"}</SweepButton>
          </form>
        </>}
      </div>
    </div>
  </div>;
}

function AdminShell({ admin, view, setView, onLogout, children }){
  const [drawerOpen,setDrawerOpen]=useState(false);
  // Unread-style order badge (WhatsApp-like count). lastSeen stored per
  // browser; opening Orders marks everything current as read.
  const SEEN_KEY="akara_admin_orders_seen_ms";
  const [newOrderCount,setNewOrderCount]=useState(0);
  const seenRef=useRef(0);
  useEffect(()=>{
    let s=Number(localStorage.getItem(SEEN_KEY)||"0");
    if(!Number.isFinite(s)||s<0) s=0;
    seenRef.current=s;
    const onSeen=(e)=>{
      const v=Number(e?.detail?.seen);
      if(Number.isFinite(v)&&v>=seenRef.current){
        seenRef.current=v;
        setNewOrderCount(0);
      }
    };
    window.addEventListener("akara-admin-orders-seen",onSeen);
    return ()=>window.removeEventListener("akara-admin-orders-seen",onSeen);
  },[]);
  useEffect(()=>{
    let cancelled=false;
    const poll=()=>{
      const seen=seenRef.current||0;
      const requestSeen=seen;
      fetch(`/api/admin/orders/new-count?since=${requestSeen}`,{credentials:"include"})
        .then(r=>r.ok?r.json():null)
        .then(d=>{
          if(cancelled||!d) return;
          // Ignore stale responses after user already marked orders read
          if(requestSeen < seenRef.current) return;
          setNewOrderCount(Number(d.count)||0);
        })
        .catch(()=>{});
    };
    // Don't poll while on Orders — badge is cleared there
    if(view==="orders") return ()=>{ cancelled=true; };
    poll();
    const id=setInterval(poll,30000);
    return ()=>{ cancelled=true; clearInterval(id); };
  },[view]);
  useEffect(()=>{
    if(view!=="orders") return;
    const now=Date.now();
    seenRef.current=now;
    localStorage.setItem(SEEN_KEY,String(now));
    setNewOrderCount(0);
    fetch(`/api/admin/orders/new-count?since=${now}`,{credentials:"include"})
      .then(r=>r.ok?r.json():null)
      .then(d=>{
        if(d?.latest!=null){
          const latest=Math.max(now, Number(d.latest)||0);
          seenRef.current=latest;
          localStorage.setItem(SEEN_KEY,String(latest));
        }
        setNewOrderCount(0);
      })
      .catch(()=>{});
  },[view]);
  // Confirmed spec: staff sees Dashboard + Orders only (their whole real
  // job); admin sees everything except the account-management screen
  // below, which stays super_admin-only. This is a UX nicety layered on
  // top of the REAL security boundary (requireRole() on the server,
  // server/adminAuth.js) — hiding a link here doesn't grant or remove
  // any actual access; a staff account hitting a hidden route directly
  // still gets a genuine 403 from the server regardless of what this
  // sidebar shows.
  const allGroups=[
    { label: "Operate", items: [
      ["dashboard","Dashboard",LayoutDashboard,["staff","admin","super_admin"]],
      ["behaviour","Behaviour",BarChart3,["staff","admin","super_admin"]],
      ["orders","Orders",ShoppingCart,["staff","admin","super_admin"]],
      ["batches","Batches",Layers,["staff","admin","super_admin"]],
      ["waitlist","Waitlist",Inbox,["admin","super_admin"]],
      ["returns","Return Requests",RotateCcw,["admin","super_admin"]],
    ]},
    { label: "Catalog", items: [
      ["products","Products",Package,["admin","super_admin"]],
      ["categories","Categories",Layers,["admin","super_admin"]],
      ["media","Media Manager",ImageIcon,["admin","super_admin"]],
      ["featured","Featured Products",Star,["admin","super_admin"]],
      ["hero-background","Homepage hero",ImageIcon,["admin","super_admin"]],
      ["room-stories","Room Stories",Layers,["admin","super_admin"]],
    ]},
    { label: "People", items: [
      ["customers","Customers",Users,["admin","super_admin"]],
      ["newsletter","Newsletter",Mail,["admin","super_admin"]],
      ["enquiries","Enquiries",Inbox,["admin","super_admin"]],
    ]},
    { label: "System", items: [
      ["activity","Activity Log",History,["admin","super_admin"]],
      ["accounts","Manage Accounts",Shield,["super_admin"]],
      ["cms","Site Content",FileText,["admin","super_admin"]],
      ["settings","Settings",Settings,["admin","super_admin"]],
    ]},
  ];
  const groups=allGroups.map(g=>({
    label: g.label,
    items: g.items.filter(([,,,roles])=>roles.includes(admin?.role)).map(([k,l,i])=>[k,l,i]),
  })).filter(g=>g.items.length>0);
  const nav=<>
    <div className="px-6 py-7">
      <a href="/" target="_blank" rel="noopener noreferrer" className="block mb-2" aria-label="ĀKĀRA home">
        <img src="/logo-wordmark-cream.png" alt="ĀKĀRA" className="h-7 w-auto max-w-[140px] object-contain object-left" style={{display:"block"}} />
      </a>
      <p className="text-[10px] tracking-[0.22em] uppercase" style={{color:"rgba(229,198,144,0.7)"}}>Studio admin</p>
      {admin?.role&&<p className="text-[10px] tracking-[0.12em] uppercase mt-2 px-2 py-0.5 inline-block" style={{color:T.teal,backgroundColor:T.gold,borderRadius:RADIUS.xs}}>{admin.role.replace("_"," ")}</p>}
    </div>
    <nav className="flex-1 px-3 overflow-y-auto">
      {groups.map(g=><div key={g.label} className="mb-4">
        <p className="px-3.5 mb-1.5 text-[10px] tracking-[0.18em] uppercase" style={{color:"rgba(229,198,144,0.45)"}}>{g.label}</p>
        {g.items.map(([id,label,Icon])=><button key={id} onClick={()=>{setView(id);setDrawerOpen(false);}}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[13.5px] mb-0.5 transition-colors relative"
          style={{backgroundColor:view===id?"rgba(255,255,255,0.1)":"transparent",color:view===id?"white":"rgba(255,255,255,0.62)",borderRadius:0}}>
          {view===id&&<span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r" style={{backgroundColor:T.gold}}/>}
          <Icon size={ICON.sm}/>
          <span className="flex-1 text-left">{label}</span>
          {id==="orders"&&newOrderCount>0&&(
            <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center text-[11px] font-semibold rounded-full"
              style={{backgroundColor:"#C43C3C",color:"white"}}>
              {newOrderCount>99?"99+":newOrderCount}
            </span>
          )}
        </button>)}
      </div>)}
      <a href="/" target="_blank" rel="noopener noreferrer"
        className="w-full flex items-center gap-3 px-3.5 py-3 text-[14px] mt-3 transition-colors"
        style={{color:"rgba(255,255,255,0.5)",borderTop:"1px solid rgba(255,255,255,0.1)",borderRadius:RADIUS.sm}}>
        <ExternalLink size={ICON.sm}/>View Live Site
      </a>
    </nav>
    <div className="px-4 py-6" style={{borderTop:"1px solid rgba(255,255,255,0.1)"}}>
      <p className="text-[12px] mb-3 px-2 truncate" style={{color:"rgba(255,255,255,0.5)"}}>{admin.email}</p>
      <button onClick={onLogout}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] transition-colors"
        style={{color:"white",backgroundColor:"rgba(255,255,255,0.08)",borderRadius:RADIUS.sm}}>
        <LogOut size={ICON.sm}/> Sign Out
      </button>
    </div>
  </>;
  return <div className="h-[100dvh] w-full flex overflow-hidden admin-shell" style={{backgroundColor:T.cream}}>
    <style>{`
      .admin-shell main {
        background-color: #E8E0D2;
        background-image:
          radial-gradient(ellipse 80% 50% at 100% -20%, rgba(229,198,144,0.18), transparent 50%),
          radial-gradient(ellipse 60% 40% at 0% 100%, rgba(24,54,48,0.04), transparent 45%);
      }
      .admin-shell main table th {
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        font-weight: 500;
        color: rgba(24,54,48,0.5);
      }
      .atelier-chip {
        border-radius: 999px !important;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-size: 11px;
      }
      .cms-atelier input, .cms-atelier textarea, .admin-shell main input:focus, .admin-shell main textarea:focus, .admin-shell main select:focus {
        outline: none;
      }
      .admin-shell aside::-webkit-scrollbar { width: 8px; }
      .admin-shell aside::-webkit-scrollbar-track { background: rgba(0,0,0,0.18); }
      .admin-shell aside::-webkit-scrollbar-thumb { background: #E5C690; border-radius: 4px; }
      .admin-shell aside::-webkit-scrollbar-thumb:hover { background: #F0D9A8; }
      .admin-shell aside { scrollbar-color: #E5C690 rgba(0,0,0,0.18); scrollbar-width: thin; }
      .admin-shell main::-webkit-scrollbar { width: 10px; }
      .admin-shell main::-webkit-scrollbar-track { background: rgba(24,54,48,0.06); }
      .admin-shell main::-webkit-scrollbar-thumb { background: rgba(24,54,48,0.35); border-radius: 5px; }
      .admin-shell main { scrollbar-color: rgba(24,54,48,0.35) rgba(24,54,48,0.06); scrollbar-width: thin; }
    `}</style>
    {/* Desktop sidebar — sticky height; only main content scrolls */}
    <aside className="hidden md:flex w-[240px] shrink-0 flex-col h-full overflow-y-auto" style={{backgroundColor:T.teal}}>
      {nav}
    </aside>

    {/* Mobile top bar + hamburger-triggered drawer — the sidebar used to be
        a fixed 220px column with no mobile handling at all, meaning it ate
        most of a phone's screen width with no way to hide it. */}
    <div className="md:hidden fixed top-0 inset-x-0 z-40 flex items-center justify-between px-4 py-3.5" style={{backgroundColor:T.teal}}>
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={()=>setDrawerOpen(true)} aria-label="Open menu" className="relative shrink-0" style={{color:"white"}}>
          <Menu size={ICON.md}/>
          {newOrderCount>0&&<span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-semibold rounded-full" style={{backgroundColor:"#C43C3C",color:"white"}}>{newOrderCount>9?"9+":newOrderCount}</span>}
        </button>
        <img src="/logo-wordmark-cream.png" alt="ĀKĀRA" className="h-6 w-auto max-w-[120px] object-contain" />
      </div>
      <div style={{width:ICON.md}}/>
    </div>
    {drawerOpen&&<div className="md:hidden fixed inset-0 z-50 flex" style={{backgroundColor:"rgba(36,62,65,0.5)"}} onClick={()=>setDrawerOpen(false)}>
      <aside className="w-[260px] h-full flex flex-col" style={{backgroundColor:T.teal}} onClick={e=>e.stopPropagation()}>
        <div className="flex justify-end px-4 pt-4"><button onClick={()=>setDrawerOpen(false)} style={{color:"white"}}><X size={ICON.md}/></button></div>
        {nav}
      </aside>
    </div>}

    <main className="flex-1 min-w-0 h-full overflow-x-hidden overflow-y-auto pt-14 md:pt-0" style={ADMIN_PAGE_BG}><div className="w-full max-w-[1600px] px-4 sm:px-6 lg:px-8 py-4 md:py-6">{children}</div></main>
  </div>;
}


async function enableAdminPush(){
  try {
    if(!("serviceWorker" in navigator) || !("PushManager" in window)){
      return { ok:false, error:"Push not supported in this browser. Use Chrome/Edge on HTTPS." };
    }
    if(!window.isSecureContext){
      return { ok:false, error:"Push requires HTTPS." };
    }
    const perm=await Notification.requestPermission();
    if(perm!=="granted") return { ok:false, error:"Notification permission denied in the browser." };
    const cfgRes=await fetch("/api/push/vapid-public-key",{credentials:"include"});
    const cfg=await cfgRes.json().catch(()=>({}));
    if(!cfg.enabled||!cfg.publicKey){
      return { ok:false, error:"Push is not configured on the server. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT on Railway and restart." };
    }
    // Ensure SW is registered (admin may load without storefront SW path)
    let reg=await navigator.serviceWorker.getRegistration();
    if(!reg){
      reg=await navigator.serviceWorker.register("/sw.js",{scope:"/"});
    }
    reg=await navigator.serviceWorker.ready;
    const existing=await reg.pushManager.getSubscription();
    const sub=existing||await reg.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:urlBase64ToUint8Array(cfg.publicKey),
    });
    const res=await apiFetch("/api/push/subscribe",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ role:"admin", subscription:sub.toJSON() }),
    });
    const d=await res.json().catch(()=>({}));
    if(!res.ok) return { ok:false, error:d.error||`Subscribe failed (${res.status})` };
    return { ok:true };
  } catch (e) {
    return { ok:false, error:e?.message||"Something went wrong enabling push." };
  }
}
function urlBase64ToUint8Array(base64String){
  const padding="=".repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(base64);
  const out=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i);
  return out;
}

function AdminDashboard({ setView }){
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [err,setErr]=useState(false);
  const [range,setRange]=useState("30d");
  const [chartMode,setChartMode]=useState("revenue"); // revenue | orderCount | aov
  const [funnelStatus,setFunnelStatus]=useState(null);
  const [funnelOrders,setFunnelOrders]=useState([]);
  const [funnelLoading,setFunnelLoading]=useState(false);
  const [lastUpdated,setLastUpdated]=useState(null);
  const [refreshing,setRefreshing]=useState(false);
  const softRef = useRef(false);
  // Real, per-product cost vs. profit data — deliberately fetched
  // separately from the main dashboard load() above: it's real,
  // all-time data with no date-range filter (see the real backend
  // route's own comment for why), so it doesn't need to re-fetch every
  // time the range selector above changes, unlike everything else on
  // this page.
  const [profitData,setProfitData]=useState(null);
  const [profitLoading,setProfitLoading]=useState(true);
  const [profitSort,setProfitSort]=useState("profit"); // profit | margin | revenue
  useEffect(()=>{
    fetch("/api/admin/dashboard/profit",{credentials:"include"})
      .then(r=>r.ok?r.json():Promise.reject())
      .then(d=>setProfitData(d.items))
      .catch(()=>setProfitData([]))
      .finally(()=>setProfitLoading(false));
  },[]);

  const load=(isSoft=false)=>{
    if(isSoft){ setRefreshing(true); softRef.current=true; }
    else { setLoading(true); setErr(false); }
    fetch(`/api/admin/dashboard?range=${encodeURIComponent(range)}`,{credentials:"include"})
      .then(r=>{ if(!r.ok) throw new Error(); return r.json(); })
      .then(d=>{ setData(d); setLastUpdated(new Date()); setErr(false); })
      .catch(()=>{ if(!softRef.current) setErr(true); })
      .finally(()=>{ setLoading(false); setRefreshing(false); softRef.current=false; });
  };
  useEffect(()=>{ load(false); },[range]);
  // Auto-refresh every 60s — soft so charts don't unmount
  useEffect(()=>{
    const id=setInterval(()=>load(true), 60_000);
    return ()=>clearInterval(id);
  },[range]);

  const openFunnel=async(status)=>{
    setFunnelStatus(status); setFunnelLoading(true); setFunnelOrders([]);
    try{
      const r=await fetch(`/api/admin/dashboard/orders-by-status?status=${encodeURIComponent(status)}`,{credentials:"include"});
      if(!r.ok) throw new Error();
      const d=await r.json();
      setFunnelOrders(d.orders||[]);
    }catch{ setFunnelOrders([]); }
    finally{ setFunnelLoading(false); }
  };

  const tooltipStyle={backgroundColor:"#1a2e2c",border:"1px solid rgba(196,163,90,0.35)",borderRadius:8,fontSize:12,color:"#F5F0E8"};
  const PIE_COLORS=["#183630","#2A5A55","#C4A35A","#E5C690","#5B8A84","#8B6B3D","#3D6B66","#A8B5B0"];

  if(loading&&!data) return <div className="p-5 md:p-8">
    <Skeleton width={200} height={30} className="mb-4"/>
    <Skeleton width={280} height={14} className="mb-8"/>
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {[0,1,2,3,4,5].map(i=><div key={i} className="p-4" style={ATELIER_PANEL}>
        <Skeleton width={70} height={11} className="mb-3"/><Skeleton width={90} height={26}/>
      </div>)}
    </div>
  </div>;
  if(err||!data) return <EmptyState icon={AlertCircle} title="Couldn't load Overview" message="Something went wrong reaching the server. Please refresh and try again." actionLabel="Retry" onAction={()=>load(false)}/>;

  const chartData=(data.revenueTrend||[]).map(r=>{
    const revenue=Number(r.revenue)||0;
    const orderCount=Number(r.orderCount)||0;
    return {
      day:new Date(r.day).toLocaleDateString("en-IN",{day:"2-digit",month:"short"}),
      revenue,
      orderCount,
      aov: orderCount>0 ? Math.round(revenue/orderCount) : 0,
    };
  });
  const payPie=(data.payMethodMix||[]).filter(p=>Number(p.value)>0).map(p=>({name:p.name,value:Number(p.value)||0,orders:p.orders||0}));
  const couponBar=[
    {name:"With coupon",orders:Number(data.couponImpact?.withCoupon||0),revenue:Number(data.couponImpact?.revenueWithCoupon||0)},
    {name:"No coupon",orders:Number(data.couponImpact?.withoutCoupon||0),revenue:Number(data.couponImpact?.revenueWithoutCoupon||0)},
  ];
  const sizeBar=(data.sizeMix||[]).map(s=>({name:String(s.name||"").slice(0,14),units:Number(s.units)||0}));
  const colourBar=(data.colourMix||[]).map(s=>({name:String(s.name||"").slice(0,14),units:Number(s.units)||0}));
  const convSteps=(data.conversionFunnel?.steps||[]).map(s=>({name:s.name,value:Number(s.value)||0}));
  const marginSeries=(data.marginTrend||[]).map(r=>({
    day:r.day?new Date(r.day).toLocaleDateString("en-IN",{day:"2-digit",month:"short"}):"",
    marginPct:r.marginPct!=null?Number(r.marginPct):null,
    grossProfit:Number(r.grossProfit)||0,
    lineRevenue:Number(r.lineRevenue)||0,
  }));
  const returnsPie=[
    {name:"Pending",value:Number(data.returnsStats?.pending||0)},
    {name:"Approved",value:Number(data.returnsStats?.approved||0)},
    {name:"Rejected",value:Number(data.returnsStats?.rejected||0)},
    {name:"Completed",value:Number(data.returnsStats?.completed||0)},
  ].filter(x=>x.value>0);
  const catPie=(data.categoryMix||[]).map(c=>({name:c.category,value:c.revenue||c.unitsSold||0,units:c.unitsSold}));
  const funnelOrder=["confirmed","production","qc","dispatched","delivered"];
  const funnelData=funnelOrder.map(k=>{
    const row=(data.studioFlow||[]).find(s=>s.status===k);
    return {status:k,label:k==="qc"?"QC & Pack":k.charAt(0).toUpperCase()+k.slice(1),count:row?Number(row.count):0};
  });
  const maxFunnel=Math.max(1,...funnelData.map(f=>f.count));
  const delta=(v)=>v==null?null:`${v>0?"+":""}${v}%`;
  const deltaColor=(v)=>v==null?"rgba(36,62,65,0.45)":v>0?"#2F7D4A":v<0?"#A83B32":"rgba(36,62,65,0.45)";

  const kpis=[
    {key:"rev",label:"Confirmed revenue",val:`₹${Number(data.totalRevenue||0).toLocaleString("en-IN")}`,d:data.revenueDeltaPct,accent:"#C4A35A",bg:"linear-gradient(135deg,rgba(196,163,90,0.18),rgba(196,163,90,0.04))"},
    {key:"ord",label:"Confirmed orders",val:String(data.paidOrderCount??0),d:data.ordersDeltaPct,accent:"#2A5A55",bg:"linear-gradient(135deg,rgba(42,90,85,0.16),rgba(42,90,85,0.04))"},
    {key:"aov",label:"AOV",val:`₹${Number(data.aov||0).toLocaleString("en-IN")}`,d:null,accent:"#183630",bg:"linear-gradient(135deg,rgba(24,54,48,0.12),rgba(24,54,48,0.03))"},
    {key:"prod",label:"In production",val:String(data.inProductionCount??0),d:null,accent:"#5B8A84",bg:"linear-gradient(135deg,rgba(91,138,132,0.18),rgba(91,138,132,0.04))",go:"production"},
    {key:"cust",label:"New customers",val:String(data.newCustomers??0),d:null,accent:"#8B6B3D",bg:"linear-gradient(135deg,rgba(139,107,61,0.14),rgba(139,107,61,0.03))"},
    {key:"att",label:"Needs attention",val:String(data.attentionCount??0),d:null,accent:Number(data.attentionCount)>0?"#A83B32":"#2F7D4A",bg:Number(data.attentionCount)>0?"linear-gradient(135deg,rgba(168,59,50,0.12),rgba(168,59,50,0.03))":"linear-gradient(135deg,rgba(47,125,74,0.12),rgba(47,125,74,0.03))",tip:"Live: pending returns + low-stock products + failed/pending payments (14d). Not stuck production."},
  ];

  const insights=[];
  if(data.revenueDeltaPct!=null) insights.push(`Revenue ${delta(data.revenueDeltaPct)} vs prior period`);
  if(data.codOrderCount>0) insights.push(`COD ₹${Number(data.codRevenue||0).toLocaleString("en-IN")} · ${data.codOrderCount} order${data.codOrderCount===1?"":"s"}`);
  if(data.inProductionCount>0) insights.push(`${data.inProductionCount} in production/QC pipeline`);
  if(data.stuckProductionCount>0) insights.push(`${data.stuckProductionCount} stuck >14 days`);
  if(data.missingImageCount>0) insights.push(`${data.missingImageCount} live SKU${data.missingImageCount===1?"":"s"} missing photos`);
  if(data.attentionCount>0) insights.push(`${data.attentionCount} need attention`);
  else insights.push("No critical attention items");
  if((data.bestSellers||[])[0]) insights.push(`Top form: ${(data.bestSellers[0].productName||"").slice(0,40)}`);
  if(data.studioRisk!=null) insights.push(`Studio risk ${data.studioRisk}/100 · ${data.studioRiskLabel||""}`);

  return <div>
    <div className="mb-8 pb-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4"
      style={{borderBottom:"1px solid rgba(184,147,90,0.35)"}}>
      <div className="min-w-0">
        <p className="text-[10px] tracking-[0.22em] uppercase mb-2" style={{color:T.teal}}>
          {refreshing?"Refreshing…":lastUpdated?`Live · ${lastUpdated.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}`:"Live"}
          <span style={{color:"rgba(36,62,65,0.55)"}}> · auto 1 min</span>
        </p>
        <h1 className="italic text-[28px] md:text-[36px] leading-[1.12]" style={{fontFamily:"'Fraunces',serif",color:T.teal,fontWeight:400}}>Overview</h1>
      </div>
      <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2">
        <div className="inline-flex gap-1">
          {["7d","30d","90d","all"].map(r=>(
            <button key={r} type="button" onClick={()=>setRange(r)}
              className="px-3 py-1.5 text-[11px] uppercase tracking-[0.08em]"
              style={{borderRadius:999,backgroundColor:range===r?T.teal:"transparent",color:range===r?"#F5F0E8":T.teal,border:`1px solid ${range===r?T.teal:"rgba(24,54,48,0.2)"}`}}>{r==="all"?"All":r}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={()=>load(true)} className="px-3.5 py-2 text-[11px] uppercase tracking-[0.08em]"
            style={{borderRadius:999,backgroundColor:T.teal,color:"#F5F0E8"}}>Refresh</button>
          <button type="button" onClick={async()=>{
            const r=await enableAdminPush();
            alert(r.ok?"Order push alerts enabled on this device.":(r.error||"Could not enable push"));
          }} className="px-3.5 py-2 text-[11px] uppercase tracking-[0.08em]"
            style={{borderRadius:999,backgroundColor:"transparent",color:T.teal,border:"1px solid rgba(24,54,48,0.2)"}}>Enable push</button>
        </div>
      </div>
    </div>

    {/* Today — action strip */}
    <div className="mb-5 p-3 md:p-4 flex flex-wrap gap-2 md:gap-3 items-stretch"
      style={{backgroundColor:"rgba(24,54,48,0.04)",borderRadius:0,borderLeft:"2px solid rgba(184,147,90,0.5)",borderBottom:"1px solid rgba(24,54,48,0.08)"}}>
      <p className="w-full md:w-auto text-[10px] tracking-[0.16em] uppercase self-center px-1" style={{color:T.mutedSoft}}>Today</p>
      {[
        ["Orders today", data.todayStrip.ordersToday, "orders"],
        ["To pack / make", data.todayStrip.toPack, "orders"],
        ["Stuck production", data.todayStrip.stuckProduction, "orders"],
        ["Low stock", data.todayStrip.lowStock, "products"],
        ["Pending returns", data.todayStrip.pendingReturns, "returns"],
        ["Contact (open)", data.todayStrip.openContact, null],
      ].map(([label,val,nav])=>(
        <button key={label} type="button"
          onClick={()=>nav && setView?.(nav)}
          className="flex-1 min-w-[7.5rem] px-3 py-2.5 text-left transition-opacity hover:opacity-90"
          style={{...ATELIER_ROW, padding: "10px 12px"}}>
          <p className="text-[10px] uppercase tracking-[0.08em] mb-0.5" style={{color:T.mutedSoft}}>{label}</p>
          <p className="text-[20px] leading-none" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{val??0}</p>
        </button>
      ))}
    </div>

    {/* Path C — risk + money split */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
      <div className="p-4" style={ATELIER_PANEL}>
        <p className="text-[10.5px] uppercase tracking-[0.1em] mb-2" style={{color:T.mutedSoft}}>Studio risk <AdminInfoTip text="Live score 0–100 from your database right now — not hardcoded. Points: stuck production/QC (>14 days) ×15 (max 45) + needs-attention items ×6 (max 30) + products missing photos ×4 (max 20) + orders still in confirmed/production/QC ×1 (max 15)." /></p>
        <p className="text-[28px]" style={{fontFamily:"'Fraunces',serif",color:Number(data.studioRisk)>=60?"#A83B32":Number(data.studioRisk)>=30?"#C4A35A":"#2F7D4A"}}>{data.studioRisk??0}<span className="text-[14px]" style={{color:T.mutedSoft}}>/100</span></p>
        <p className="text-[12px] mt-1" style={{color:T.muted}}>{data.studioRiskLabel||"Calm"}</p>
        {data.studioRiskBreakdown&&(
          <ul className="mt-2 space-y-0.5 text-[11px]" style={{color:"rgba(36,62,65,0.65)"}}>
            <li>Stuck &gt;14d: {data.studioRiskBreakdown.stuckOrders??0} → {data.studioRiskBreakdown.stuckPoints??0} pts</li>
            <li>Attention: {data.studioRiskBreakdown.attentionItems??0} → {data.studioRiskBreakdown.attentionPoints??0} pts</li>
            <li>Missing images: {data.studioRiskBreakdown.missingImages??0} → {data.studioRiskBreakdown.missingImagePoints??0} pts</li>
            <li>Pipeline: {data.studioRiskBreakdown.pipelineOrders??0} → {data.studioRiskBreakdown.pipelinePoints??0} pts</li>
          </ul>
        )}
      </div>
      <div className="p-4" style={ATELIER_PANEL}>
        <p className="text-[10.5px] uppercase tracking-[0.1em] mb-2" style={{color:T.mutedSoft}}>Online paid</p>
        <p className="text-[22px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{Number(data.onlineRevenue||0).toLocaleString("en-IN")}</p>
        <p className="text-[12px] mt-1" style={{color:T.muted}}>{data.onlineOrderCount||0} orders in range</p>
      </div>
      <div className="p-4" style={ATELIER_PANEL}>
        <p className="text-[10.5px] uppercase tracking-[0.1em] mb-2" style={{color:T.mutedSoft}}>COD (included in totals)</p>
        <p className="text-[22px]" style={{fontFamily:"'Fraunces',serif",color:"#8B6B3D"}}>₹{Number(data.codRevenue||0).toLocaleString("en-IN")}</p>
        <p className="text-[12px] mt-1" style={{color:T.muted}}>{data.codOrderCount||0} orders · totals above include COD</p>
      </div>
    </div>

    {/* KPI strip */}
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
      {kpis.map(k=>(
        <button key={k.key} type="button" onClick={()=>{ if(k.go) openFunnel(k.go); else if(k.key==="att") setView?.("orders"); }}
          className="p-4 text-left transition-colors"
          style={{...ATELIER_PANEL, borderLeft:`2px solid ${k.accent||T.gold}`, background:k.bg||ATELIER_PANEL.backgroundColor}}>
          <p className="text-[10px] uppercase tracking-[0.14em] mb-2" style={{color:T.muted}}>{k.label}</p>
          <p className="text-[22px] leading-none mb-1" style={{fontFamily:"'Fraunces',serif",color:k.accent||T.teal,fontWeight:400}}>{k.val}</p>
          {k.d!=null&&<p className="text-[11px] font-medium" style={{color:deltaColor(k.d)}}>{delta(k.d)} vs prior</p>}
        </button>
      ))}
    </div>

    {/* Insights */}
    <div className="mb-5 p-4 flex flex-wrap gap-2" style={{backgroundColor:"rgba(24,54,48,0.94)",borderRadius:0,borderBottom:"2px solid #E5C690"}}>
      {insights.map((line,i)=>(
        <span key={i} className="text-[12px] px-3 py-1.5" style={{backgroundColor:"rgba(245,240,232,0.08)",color:"#E5C690",borderRadius:999,border:"1px solid rgba(196,163,90,0.25)"}}>{line}</span>
      ))}
    </div>

    {/* Main charts row */}
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-5 min-w-0">
      <div className="xl:col-span-2 p-5" style={ATELIER_PANEL}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <p className="text-[13px] uppercase tracking-[0.06em] font-medium" style={{color:T.teal}}>Revenue trajectory <AdminInfoTip text="Paid + COD order totals by day (incl. shipping/fees as charged). Empty days show ₹0 so the line is honest — not pending checkouts." /></p>
          <div className="flex gap-1">
            {[["revenue","Revenue"],["orderCount","Orders"],["aov","AOV"]].map(([m,lab])=>(
              <button key={m} type="button" onClick={()=>setChartMode(m)} className="px-2.5 py-1 text-[11px]"
                style={{borderRadius:6,backgroundColor:chartMode===m?T.teal:"transparent",color:chartMode===m?"#F5F0E8":T.teal,border:`1px solid ${chartMode===m?T.teal:"rgba(36,62,65,0.12)"}`}}>{lab}</button>
            ))}
          </div>
        </div>
        {chartData.length===0?<p className="text-[13px] py-16 text-center" style={{color:T.muted}}>No paid orders in this range yet.</p>:
        <div style={{width:"100%",height:280}}>
          <ResponsiveContainer>
            <AreaChart data={chartData} margin={{top:8,right:12,left:0,bottom:0}}>
              <defs>
                <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartMode==="revenue"?"#C4A35A":chartMode==="aov"?"#183630":"#2A5A55"} stopOpacity={0.45}/>
                  <stop offset="100%" stopColor={chartMode==="revenue"?"#C4A35A":chartMode==="aov"?"#183630":"#2A5A55"} stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(36,62,65,0.08)"/>
              <XAxis dataKey="day" tick={{fontSize:11,fill:"rgba(36,62,65,0.55)"}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:11,fill:"rgba(36,62,65,0.55)"}} axisLine={false} tickLine={false} width={48}/>
              <Tooltip contentStyle={tooltipStyle}
                formatter={(v)=>chartMode==="revenue"?[`₹${Number(v).toLocaleString("en-IN")}`,"Revenue"]:chartMode==="aov"?[`₹${Number(v).toLocaleString("en-IN")}`,"AOV"]:[v,"Orders"]}/>
              <Area type="monotone" dataKey={chartMode} stroke={chartMode==="revenue"?"#C4A35A":chartMode==="aov"?"#183630":"#2A5A55"} strokeWidth={2.5}
                fill="url(#pulseFill)" activeDot={{r:5,strokeWidth:0}}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>}
      </div>

      <div className="p-5 min-w-0 overflow-visible" style={{...ATELIER_PANEL, overflow:"visible"}}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-3 font-medium" style={{color:T.teal}}>Category mix <AdminInfoTip text="Share of product line value by category (item price × qty). Order-level coupons are not split across lines — totals may differ slightly from headline revenue." /></p>
        {catPie.length===0?<p className="text-[13px] py-16 text-center" style={{color:T.muted}}>No category sales yet.</p>:
        <div className="flex flex-col gap-4 min-w-0 w-full overflow-visible">
          <div className="w-full flex justify-center" style={{height:180, minHeight:180}}>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart margin={{top:4,right:4,bottom:4,left:4}}>
                <Pie data={catPie} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={3}
                  cursor="pointer" isAnimationActive={false}>
                  {catPie.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v,n)=>[`₹${Number(v).toLocaleString("en-IN")}`,n]}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex flex-col gap-2.5 w-full list-none m-0 p-0">
            {catPie.map((row,i)=>(
              <li key={row.name||i} className="grid gap-2 items-start text-[13px]" style={{gridTemplateColumns:"10px 1fr auto"}}>
                <span className="w-2.5 h-2.5 rounded-full mt-1.5" style={{backgroundColor:PIE_COLORS[i%PIE_COLORS.length]}}/>
                <span className="leading-snug" style={{color:"#183630",fontWeight:500,wordBreak:"break-word"}}>{row.name||"Other"}</span>
                <span className="tabular-nums whitespace-nowrap text-right" style={{color:"#183630"}}>₹{Number(row.value).toLocaleString("en-IN")}</span>
              </li>
            ))}
          </ul>
        </div>}
      </div>
    </div>

    {/* Studio funnel interactive */}
    <div className="p-5 mb-5" style={ATELIER_PANEL}>
      <p className="text-[13px] uppercase tracking-[0.06em] mb-1 font-medium" style={{color:T.teal}}>Studio flow <AdminInfoTip text="How many paid/COD orders sit in each fulfillment stage right now (confirmed → delivered)." /></p>
      <p className="text-[12px] mb-4" style={{color:T.muted}}>Click a stage to list those orders</p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {funnelData.map(f=>(
          <button key={f.status} type="button" onClick={()=>openFunnel(f.status)}
            className="p-3 text-left transition-all hover:-translate-y-0.5"
            style={{borderRadius:0,background:funnelStatus===f.status?"rgba(24,54,48,0.08)":"transparent",borderLeft:`2px solid ${funnelStatus===f.status?T.gold:"rgba(24,54,48,0.12)"}`,borderBottom:"1px solid rgba(24,54,48,0.08)",padding:"12px 14px"}}>
            <p className="text-[10.5px] uppercase tracking-[0.08em] mb-2" style={{color:T.mutedSoft}}>{f.label}</p>
            <p className="text-[24px] mb-2" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{f.count}</p>
            <div className="h-1.5 rounded-full overflow-hidden" style={{backgroundColor:"rgba(36,62,65,0.08)"}}>
              <div className="h-full rounded-full" style={{width:`${Math.round((f.count/maxFunnel)*100)}%`,backgroundColor:T.gold}}/>
            </div>
          </button>
        ))}
      </div>
      {funnelStatus&&(
        <div className="mt-4 pt-4" style={{borderTop:"1px solid rgba(36,62,65,0.08)"}}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12px] uppercase tracking-[0.06em]" style={{color:T.teal}}>Orders · {funnelStatus}</p>
            <button type="button" className="text-[11px]" style={{color:T.muted}} onClick={()=>setFunnelStatus(null)}>Close</button>
          </div>
          {funnelLoading?<p className="text-[13px]" style={{color:T.muted}}>Loading…</p>:
           funnelOrders.length===0?<p className="text-[13px]" style={{color:T.muted}}>None in this stage.</p>:
           <div className="flex flex-col gap-1">
             {funnelOrders.map(o=>(
               <button key={o.orderNumber} type="button" onClick={()=>setView?.("orders")} className="flex justify-between text-[13px] py-1.5 text-left" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}>
                 <span style={{color:T.teal}}>#{o.orderNumber}</span>
                 <span style={{color:"rgba(36,62,65,0.65)"}}>₹{Number(o.total).toLocaleString("en-IN")}</span>
               </button>
             ))}
           </div>}
        </div>
      )}
    </div>

    {/* Best sellers bar + attention columns */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
      <div className="p-5" style={ATELIER_PANEL}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-3 font-medium" style={{color:T.teal}}>Best sellers <AdminInfoTip text="Top products by units sold in the selected range from paid/COD orders." /></p>
        {(data.bestSellers||[]).length===0?<p className="text-[13px]" style={{color:T.muted}}>No sales in range.</p>:
        <div className="flex flex-col gap-4 min-w-0 overflow-visible">
          <div style={{width:"100%",height:220}}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(data.bestSellers||[]).map((b,i)=>({key:String(i),name:b.productName||"Piece",revenue:b.revenue,units:b.unitsSold}))} layout="vertical" margin={{left:4,right:16,top:4,bottom:4}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(36,62,65,0.08)" horizontal={false}/>
                <XAxis type="number" tick={{fontSize:11,fill:"rgba(36,62,65,0.55)"}} axisLine={false}/>
                <YAxis type="category" dataKey="key" width={28} tick={{fontSize:11,fill:"rgba(36,62,65,0.65)"}} axisLine={false} tickLine={false} tickFormatter={(k)=>String(Number(k)+1)}/>
                <Tooltip contentStyle={tooltipStyle}
                  labelFormatter={(_,payload)=>payload?.[0]?.payload?.name||""}
                  formatter={(v,k)=>k==="revenue"?[`₹${Number(v).toLocaleString("en-IN")}`,"Revenue"]:[v,"Units"]}/>
                <Bar dataKey="revenue" fill="#2A5A55" radius={[0,4,4,0]} cursor="pointer"/>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex flex-col gap-2 m-0 p-0 list-none">
            {(data.bestSellers||[]).map((b,i)=>(
              <li key={b.productId||b.productName||i} className="grid gap-2 items-start text-[12.5px]" style={{gridTemplateColumns:"1.5rem 1fr auto"}}>
                <span className="tabular-nums" style={{color:"rgba(36,62,65,0.45)"}}>{i+1}.</span>
                <span className="leading-snug" style={{color:"#183630",fontWeight:500,wordBreak:"break-word"}}>{b.productName||"Piece"}</span>
                <span className="tabular-nums whitespace-nowrap text-right" style={{color:"#183630"}}>₹{Number(b.revenue||0).toLocaleString("en-IN")}<span className="block text-[11px]" style={{color:"rgba(36,62,65,0.5)"}}>{b.unitsSold||0} sold</span></span>
              </li>
            ))}
          </ul>
        </div>}
      </div>
      <div className="p-5" style={ATELIER_PANEL}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-3 font-medium" style={{color:T.teal}}>Attention <AdminInfoTip text="Counts pending return requests, low-stock / sold-out products, and failed or pending payments in the last 14 days — not only order status. Use the links below." /></p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] mb-2" style={{color:T.mutedSoft}}>Low stock</p>
            {(data.lowStock||[]).length===0?<p className="text-[12.5px]" style={{color:T.muted}}>None flagged.</p>:
            <div className="flex flex-col gap-1">{(data.lowStock||[]).slice(0,5).map(p=><button type="button" key={p.id} onClick={()=>setView?.("products")} className="flex justify-between text-[12.5px] py-1 text-left w-full" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}>
              <span style={{color:T.teal}}>{p.name}</span><Badge variant="warning">{p.stock}</Badge>
            </button>)}</div>}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] mb-2" style={{color:T.mutedSoft}}>Failed / pending pay</p>
            {(data.failedPayments||[]).length===0?<p className="text-[12.5px]" style={{color:T.muted}}>None recent.</p>:
            <div className="flex flex-col gap-1">{(data.failedPayments||[]).slice(0,5).map(o=><button key={o.orderNumber} type="button" onClick={()=>setView?.("orders")} className="flex justify-between text-[12.5px] py-1 text-left" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}>
              <span style={{color:T.teal}}>#{o.orderNumber}</span><Badge variant={o.paymentStatus==="failed"?"error":"warning"}>{o.paymentStatus}</Badge>
            </button>)}</div>}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] mb-2" style={{color:T.mutedSoft}}>Pending returns</p>
            {(data.pendingReturns||[]).length===0?<p className="text-[12.5px]" style={{color:T.muted}}>None.</p>:
            <div className="flex flex-col gap-1">{(data.pendingReturns||[]).slice(0,5).map(r=><button type="button" key={r.id} onClick={()=>setView?.("returns")} className="flex justify-between text-[12.5px] py-1 text-left w-full" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}>
              <span style={{color:T.teal}}>#{r.orderNumber}</span><span style={{color:T.muted}}>{r.itemName}</span>
            </button>)}</div>}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] mb-2" style={{color:T.mutedSoft}}>Quiet forms</p>
            {(data.quietForms||[]).length===0?<p className="text-[12.5px]" style={{color:T.muted}}>All listed forms sold — or empty catalog.</p>:
            <div className="flex flex-col gap-1">{(data.quietForms||[]).slice(0,5).map(p=><div key={p.id} className="flex justify-between text-[12.5px] py-1" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}>
              <span style={{color:T.teal}}>{p.name}</span><span style={{color:T.mutedSoft}}>{p.category}</span>
            </div>)}</div>}
          </div>
        </div>
        <p className="text-[11px] mt-4 leading-relaxed" style={{color:"rgba(36,62,65,0.55)"}}>
          “Needs attention” is live: pending returns + products marked low-stock + failed/pending payments in the last 14 days.
          {data.categoryAudit?.summary?.issueCount > 0 && (
            <span className="block mt-2" style={{color:T.warning}}>
              Category audit: {data.categoryAudit.summary.issueCount} catalogue issue{data.categoryAudit.summary.issueCount!==1?"s":""}
              {data.categoryAudit.summary.conflicts ? ` (${data.categoryAudit.summary.conflicts} name↔category mismatch)` : ""}. Fix under Products.
            </span>
          )} Sold-out is listed above for awareness but is not counted in the number. It is not stuck production (that feeds Studio risk separately).
        </p>
      </div>
    </div>

    {/* Extended insights — conversion, pay mix, coupons, variants, margin, returns */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5 min-w-0">
      <div className="p-5" style={ATELIER_PANEL}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-1 font-medium" style={{color:T.teal}}>Site conversion funnel <AdminInfoTip text="First-party analytics events in this range (page_view → purchase). Empty if tracking is blocked or no traffic yet." /></p>
        <p className="text-[12px] mb-3" style={{color:"rgba(36,62,65,0.6)"}}>Visitor path from browse to paid intent</p>
        {convSteps.every(s=>!s.value)?(
          <p className="text-[13px] py-12 text-center" style={{color:T.muted}}>No behaviour events in this range yet.</p>
        ):(
          <div style={{width:"100%",height:240}}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={convSteps} margin={{top:8,right:12,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(36,62,65,0.08)"/>
                <XAxis dataKey="name" tick={{fontSize:10,fill:"#183630"}} interval={0} angle={-15} textAnchor="end" height={56}/>
                <YAxis tick={{fontSize:11,fill:"#183630"}} allowDecimals={false}/>
                <Tooltip contentStyle={tooltipStyle}/>
                <Bar dataKey="value" name="Events" fill="#2A5A55" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="p-5 min-w-0 overflow-visible" style={{...ATELIER_PANEL, overflow:"visible"}}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-1 font-medium" style={{color:T.teal}}>Pay method mix <AdminInfoTip text="Confirmed revenue split: online paid vs COD in the selected range." /></p>
        <p className="text-[12px] mb-3" style={{color:"rgba(36,62,65,0.6)"}}>Online vs cash-on-delivery</p>
        {payPie.length===0?(
          <p className="text-[13px] py-12 text-center" style={{color:T.muted}}>No paid or COD revenue in range.</p>
        ):(
          <div className="flex flex-col items-stretch gap-4 min-w-0 overflow-visible">
            <div className="mx-auto w-full" style={{maxWidth:240,height:200}}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{top:4,right:4,bottom:4,left:4}}>
                  <Pie data={payPie} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={3} stroke={T.card} strokeWidth={2}>
                    {payPie.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v)=>[`₹${Number(v).toLocaleString("en-IN")}`,"Revenue"]}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="flex flex-col gap-2 w-full text-[12.5px] m-0 p-0 list-none">
              {payPie.map((row,i)=>{
                const total=payPie.reduce((s,r)=>s+Number(r.value||0),0)||1;
                const pct=Math.round((Number(row.value)/total)*1000)/10;
                return (
                  <li key={row.name} className="grid grid-cols-[12px_1fr_auto] gap-x-2 items-center py-1.5" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}>
                    <span className="w-2.5 h-2.5 rounded-full" style={{backgroundColor:PIE_COLORS[i%PIE_COLORS.length]}}/>
                    <span style={{color:T.teal}}>{row.name} <span style={{color:"rgba(36,62,65,0.5)"}}>({pct}%)</span></span>
                    <span className="tabular-nums text-right" style={{color:"rgba(36,62,65,0.75)"}}>₹{Number(row.value).toLocaleString("en-IN")}<span className="block text-[11px]" style={{color:"rgba(36,62,65,0.5)"}}>{row.orders} orders</span></span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <div className="p-5" style={ATELIER_PANEL}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-1 font-medium" style={{color:T.teal}}>Coupon impact <AdminInfoTip text="Orders that used a coupon code vs those that did not, in this range. Discount is the order-level amount stored at checkout." /></p>
        <p className="text-[12px] mb-3" style={{color:"rgba(36,62,65,0.6)"}}>
          Avg discount ₹{Number(data.couponImpact?.avgDiscount||0).toLocaleString("en-IN")}
          {" · "}Total discounted ₹{Number(data.couponImpact?.totalDiscount||0).toLocaleString("en-IN")}
        </p>
        {(couponBar[0].orders+couponBar[1].orders)===0?(
          <p className="text-[13px] py-12 text-center" style={{color:T.muted}}>No confirmed orders in range.</p>
        ):(
          <div style={{width:"100%",height:220}}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={couponBar} margin={{top:8,right:12,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(36,62,65,0.08)"/>
                <XAxis dataKey="name" tick={{fontSize:11,fill:"#183630"}}/>
                <YAxis yAxisId="l" tick={{fontSize:11,fill:"#183630"}} allowDecimals={false}/>
                <YAxis yAxisId="r" orientation="right" tick={{fontSize:11,fill:"#183630"}}/>
                <Tooltip contentStyle={tooltipStyle}/>
                <Legend wrapperStyle={{fontSize:12}}/>
                <Bar yAxisId="l" dataKey="orders" name="Orders" fill="#2A5A55" radius={[4,4,0,0]}/>
                <Bar yAxisId="r" dataKey="revenue" name="Revenue ₹" fill="#C4A35A" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="p-5" style={ATELIER_PANEL}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-1 font-medium" style={{color:T.teal}}>Returns vs delivered <AdminInfoTip text="Return requests opened in range vs delivered orders. Rate = returns ÷ delivered (not a financial refund total)." /></p>
        <p className="text-[12px] mb-3" style={{color:"rgba(36,62,65,0.6)"}}>
          {data.returnsStats?.returnRatePct!=null?`Return rate ${data.returnsStats.returnRatePct}%`:"Return rate —"}
          {" · "}{Number(data.returnsStats?.total||0)} requests · {Number(data.returnsStats?.deliveredOrders||0)} delivered
        </p>
        {returnsPie.length===0?(
          <p className="text-[13px] py-12 text-center" style={{color:T.muted}}>No return requests in this range.</p>
        ):(
          <div className="flex flex-col gap-4 min-w-0 overflow-visible">
            <div className="w-full flex justify-center" style={{height:170}}>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart margin={{top:4,right:4,bottom:4,left:4}}>
                  <Pie data={returnsPie} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={2} isAnimationActive={false}>
                    {returnsPie.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="flex flex-col gap-2 m-0 p-0 list-none">
              {returnsPie.map((row,i)=>(
                <li key={row.name||i} className="grid gap-2 items-center text-[12.5px]" style={{gridTemplateColumns:"10px 1fr auto"}}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{backgroundColor:PIE_COLORS[i%PIE_COLORS.length]}}/>
                  <span style={{color:"#183630",fontWeight:500,wordBreak:"break-word"}}>{row.name||"Other"}</span>
                  <span className="tabular-nums" style={{color:"#183630"}}>{row.value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="p-5" style={ATELIER_PANEL}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-1 font-medium" style={{color:T.teal}}>Size mix <AdminInfoTip text="Units sold by size label on order lines (Small / Medium / Large / Unspecified)." /></p>
        {sizeBar.length===0?(
          <p className="text-[13px] py-12 text-center" style={{color:T.muted}}>No size data on sales in range.</p>
        ):(
          <div style={{width:"100%",height:220}}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sizeBar} margin={{top:8,right:12,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(36,62,65,0.08)"/>
                <XAxis dataKey="name" tick={{fontSize:11,fill:"#183630"}}/>
                <YAxis tick={{fontSize:11,fill:"#183630"}} allowDecimals={false}/>
                <Tooltip contentStyle={tooltipStyle}/>
                <Bar dataKey="units" name="Units" fill="#183630" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="p-5" style={ATELIER_PANEL}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-1 font-medium" style={{color:T.teal}}>Colour mix <AdminInfoTip text="Units sold by colour label on order lines." /></p>
        {colourBar.length===0?(
          <p className="text-[13px] py-12 text-center" style={{color:T.muted}}>No colour data on sales in range.</p>
        ):(
          <div style={{width:"100%",height:220}}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={colourBar} margin={{top:8,right:12,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(36,62,65,0.08)"/>
                <XAxis dataKey="name" tick={{fontSize:11,fill:"#183630"}}/>
                <YAxis tick={{fontSize:11,fill:"#183630"}} allowDecimals={false}/>
                <Tooltip contentStyle={tooltipStyle}/>
                <Bar dataKey="units" name="Units" fill="#8B6B3D" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>

    <div className="p-5 mt-5" style={ATELIER_PANEL}>
      <p className="text-[13px] uppercase tracking-[0.06em] mb-1 font-medium" style={{color:T.teal}}>Gross margin trend <AdminInfoTip text="Daily line revenue minus estimated unit costs (product cost breakdown × qty). Needs cost fields on products to be meaningful. Not the same as bank total after shipping." /></p>
      <p className="text-[12px] mb-3" style={{color:"rgba(36,62,65,0.6)"}}>Line profit & margin % by day (empty days = no sales)</p>
      {marginSeries.every(r=>!(r.lineRevenue>0))?(
        <p className="text-[13px] py-12 text-center" style={{color:T.muted}}>No line sales in this range to chart margin.</p>
      ):(
        <div style={{width:"100%",height:260}}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={marginSeries} margin={{top:8,right:12,left:0,bottom:0}}>
              <defs>
                <linearGradient id="akMarginFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3B6E52" stopOpacity={0.35}/>
                  <stop offset="100%" stopColor="#3B6E52" stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(36,62,65,0.08)"/>
              <XAxis dataKey="day" tick={{fontSize:10,fill:"#183630"}}/>
              <YAxis yAxisId="l" tick={{fontSize:11,fill:"#183630"}}/>
              <YAxis yAxisId="r" orientation="right" tick={{fontSize:11,fill:"#183630"}} unit="%"/>
              <Tooltip contentStyle={tooltipStyle}
                formatter={(v,n)=>n==="marginPct"?[v!=null?`${v}%`:"—","Margin"]:[`₹${Number(v).toLocaleString("en-IN")}`,n==="grossProfit"?"Gross":"Revenue"]}/>
              <Legend wrapperStyle={{fontSize:12}}/>
              <Area yAxisId="l" type="monotone" dataKey="grossProfit" name="Gross ₹" stroke="#3B6E52" fill="url(#akMarginFill)" strokeWidth={2}/>
              <Line yAxisId="r" type="monotone" dataKey="marginPct" name="Margin %" stroke="#C4A35A" strokeWidth={2} dot={false} connectNulls/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>

    {/* Recent orders */}
    <div className="p-5 mt-5 overflow-hidden relative z-0" style={{...ATELIER_PANEL, isolation:"isolate"}}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-[13px] uppercase tracking-[0.06em] font-medium" style={{color:T.teal}}>Recent orders <AdminInfoTip text="Latest orders across all statuses. Click a row to open the Orders ledger." /></p>
        <button type="button" onClick={()=>setView?.("orders")} className="text-[11px] uppercase tracking-[0.06em] shrink-0" style={{color:T.teal}}>Open orders →</button>
      </div>
      {(data.recentOrders||[]).length===0?<p className="text-[13px]" style={{color:T.muted}}>No orders yet.</p>:
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead><tr style={{color:T.mutedSoft}}>
            <th className="py-2 font-medium">Order</th><th className="py-2 font-medium">Total</th><th className="py-2 font-medium">Payment</th><th className="py-2 font-medium">Status</th>
          </tr></thead>
          <tbody>
            {data.recentOrders.map(o=>(
              <tr key={o.orderNumber} className="cursor-pointer" onClick={()=>setView?.("orders")} style={{borderTop:"1px solid rgba(36,62,65,0.06)"}}>
                <td className="py-2.5" style={{color:T.teal}}>#{o.orderNumber}</td>
                <td className="py-2.5">₹{Number(o.total).toLocaleString("en-IN")}</td>
                <td className="py-2.5"><Badge variant={o.paymentStatus==="paid"||o.paymentStatus==="cod"?"success":o.paymentStatus==="failed"?"error":"warning"}>{o.paymentStatus}</Badge></td>
                <td className="py-2.5" style={{color:"rgba(36,62,65,0.65)"}}>{o.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </div>
    {/* Real, per-product cost vs. profit — directly requested: a real
        chart showing how much was spent making each product against
        how much it's actually earned. Deliberately excludes any
        product with no real cost data entered yet (hasCostData is
        false) rather than showing it as a misleading 0-cost, 100%-
        margin bar — an admin who hasn't entered real costs for a
        product yet should see it plainly absent, not silently wrong. */}
    <div className="p-5 mt-5 overflow-hidden relative z-0" style={{...ATELIER_PANEL, isolation:"isolate"}}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] uppercase tracking-[0.06em] font-medium" style={{color:T.teal}}>Cost &amp; profit per product <AdminInfoTip text="Uses Material/Labor/… cost fields on each product × units sold. Not on the customer site." /></p>
          <p className="text-[12px] mt-1.5 max-w-xl leading-relaxed" style={{color:"rgba(36,62,65,0.65)"}}>From product cost fields + paid/COD sales. Enter Material/Labor under each product → Basics/Cost.</p>
        </div>
        {!profitLoading&&profitData&&profitData.filter(p=>p.hasCostData).length>0&&(
          <div className="flex flex-wrap gap-1.5 shrink-0">
            {[["profit","Profit"],["margin","Margin %"],["revenue","Revenue"]].map(([k,l])=>(
              <button key={k} type="button" onClick={()=>setProfitSort(k)} className="text-[10.5px] uppercase tracking-[0.05em] px-2.5 py-1"
                style={profitSort===k?{backgroundColor:T.teal,color:"white",borderRadius:999}:{color:T.muted,borderRadius:999,border:"1px solid rgba(24,54,48,0.15)"}}>{l}</button>
            ))}
          </div>
        )}
      </div>
      <p className="text-[11.5px] mb-4 leading-relaxed" style={{color:T.mutedSoft}}>All-time (not the date filter above). Chart = cost vs expected profit per unit at list price. Table “Realised profit” = revenue from paid/COD lines − (cost × units). ₹0 means no sales yet — not a bad margin.</p>
      {profitLoading?<Skeleton height={220} radius={RADIUS.md}/>:
       !profitData||profitData.filter(p=>p.hasCostData).length===0?
        <p className="text-[13px] py-10 text-center" style={{color:T.muted}}>No real cost data entered yet — open a product and fill in "What it costs to make one" to see it here.</p>:
        (()=>{
          const withCosts=profitData.filter(p=>p.hasCostData);
          // Real, deliberate mapping: the "Profit" sort button uses
          // expectedProfitPerUnit (the real, ALWAYS-available per-unit
          // margin at the current price) rather than the real, total
          // `profit` field, which is genuinely 0 for any unsold
          // product regardless of how good its actual margin is — the
          // real, correct default for "help me judge a price," not
          // "show me what's already sold well."
          const sortKey=profitSort==="margin"?"marginPercent":profitSort==="profit"?"expectedProfitPerUnit":profitSort;
          const sorted=[...withCosts].sort((a,b)=>(b[sortKey]??0)-(a[sortKey]??0));
          const top=sorted.slice(0,10);
          return <>
            <div className="min-w-0" style={{width:"100%",height:320,overflow:"visible"}}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top} margin={{top:8,right:12,left:8,bottom:72}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(36,62,65,0.08)"/>
                  <XAxis dataKey="name" tick={{fontSize:10,fill:"#183630"}} angle={-28} textAnchor="end" interval={0} height={80}/>
                  <YAxis tick={{fontSize:11,fill:"#183630"}}/>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v,n)=>[`₹${Number(v).toLocaleString("en-IN")}`,n]}/>
                  <Legend verticalAlign="top" height={28} wrapperStyle={{fontSize:12}}/>
                  <Bar dataKey="totalCostPerUnit" name="Cost / unit" fill="#B5651D" radius={[3,3,0,0]}/>
                  <Bar dataKey="expectedProfitPerUnit" name="Expected profit / unit" fill="#3B6E52" radius={[3,3,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 mb-2 p-4" style={{backgroundColor:"rgba(24,54,48,0.04)",borderRadius:RADIUS.md,border:"1px solid rgba(36,62,65,0.08)"}}>
              <p className="text-[11px] tracking-[0.12em] uppercase mb-2" style={{color:T.teal,fontWeight:600}}>Break-even</p>
              <p className="text-[12.5px] leading-relaxed mb-3" style={{color:"rgba(36,62,65,0.7)"}}>
                Cost fields are <strong style={{color:T.teal}}>per unit</strong> (material, labour, etc.). There is no separate fixed overhead in this sheet, so at list price a product breaks even on the <strong style={{color:T.teal}}>first unit sold</strong> whenever list margin is positive. Contribution = list price − cost/unit.
              </p>
              <div className="flex flex-wrap gap-3">
                {sorted.filter(p=>p.contributionPerUnit!=null&&p.contributionPerUnit>0).slice(0,6).map(p=>(
                  <div key={p.id+"be"} className="text-[12px] px-3 py-2" style={{backgroundColor:T.card,borderRadius:RADIUS.sm,border:"1px solid rgba(36,62,65,0.08)"}}>
                    <span style={{color:T.teal,fontWeight:500}}>{p.name}</span>
                    <span className="block mt-0.5" style={{color:"rgba(36,62,65,0.65)"}}>
                      +₹{Number(p.contributionPerUnit).toLocaleString("en-IN")}/unit · BE at 1 unit
                      {p.unitsToClearLoss!=null?` · need ${p.unitsToClearLoss} more at list to clear loss`:""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-left text-[12.5px]">
                <thead><tr style={{color:T.mutedSoft}}>
                  <th className="py-2 font-medium">Product</th>
                  <th className="py-2 font-medium">Cost/unit</th>
                  <th className="py-2 font-medium">List price</th>
                  <th className="py-2 font-medium">List margin</th>
                  <th className="py-2 font-medium">Units</th>
                  <th className="py-2 font-medium">Revenue</th>
                  <th className="py-2 font-medium">Break-even</th>
                  <th className="py-2 font-medium">Realised profit</th>
                </tr></thead>
                <tbody>
                  {sorted.map(p=>(
                    <tr key={p.id} style={{borderTop:"1px solid rgba(36,62,65,0.06)"}}>
                      <td className="py-2" style={{color:T.teal}}>{p.name}</td>
                      <td className="py-2">₹{p.totalCostPerUnit.toLocaleString("en-IN")}</td>
                      <td className="py-2">
                        ₹{Number(p.price||0).toLocaleString("en-IN")}
                        {p.priceSource==="variants"&&(
                          <span className="block text-[10px] mt-0.5" style={{color:"rgba(36,62,65,0.5)"}}>
                            {p.variantPriceCount===1?"from variant":`avg of ${p.variantPriceCount} variants`}
                            {p.variantPriceMin!=null&&p.variantPriceMax!=null&&p.variantPriceMin!==p.variantPriceMax
                              ? ` (₹${p.variantPriceMin}–₹${p.variantPriceMax})` : ""}
                          </span>
                        )}
                      </td>
                      <td className="py-2" style={{color:(p.marginPercent??0)>=0?T.success:T.error}}>{p.marginPercent!=null?`${p.marginPercent}%`:"—"}</td>
                      <td className="py-2">{p.unitsSold}</td>
                      <td className="py-2">₹{Number(p.revenue||0).toLocaleString("en-IN")}</td>
                      <td className="py-2" style={{color:"rgba(36,62,65,0.75)"}}>
                        {p.breakEvenUnits!=null?`${p.breakEvenUnits} unit`:(p.contributionPerUnit!=null&&p.contributionPerUnit<=0?"price ≤ cost":"—")}
                        {p.unitsToClearLoss!=null&&(
                          <span className="block text-[10px] mt-0.5" style={{color:T.error}}>+{p.unitsToClearLoss} at list to clear</span>
                        )}
                      </td>
                      <td className="py-2" style={{color:p.profit>=0?T.success:T.error}}>
                        ₹{Number(p.profit||0).toLocaleString("en-IN")}
                        {p.unitsSold>0&&p.avgSoldUnitPrice!=null&&(
                          <span className="block text-[10px] mt-0.5" style={{color:"rgba(36,62,65,0.5)"}}>
                            sold avg ₹{p.avgSoldUnitPrice}{p.realisedMarginPercent!=null?` · ${p.realisedMarginPercent}% realised`:""}
                          </span>
                        )}
                        {p.unitsSold===0&&(
                          <span className="block text-[10px] mt-0.5" style={{color:"rgba(36,62,65,0.45)"}}>no paid sales yet</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>;
        })()
      }
    </div>
  </div>;
}


function VariantEditor({ productId }){
  const showToast=useToast();
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [colors,setColors]=useState([]);
  const [variants,setVariants]=useState([]);
  const nextTempKey=useRef(0);

  // REAL, DIRECT FIX: previously the per-variant "Size" field was a
  // blank, free-text box, and "Dims override" was one long free-text
  // field — genuinely reported as confusing, and structurally risky:
  // an admin could type "small" (lowercase) or "Sml" and it would
  // never match the customer-facing page's real Size picker at all
  // (which only recognizes the exact strings "Small"/"Medium"/"Large").
  // Size is now a real, proper dropdown limited to those exact three
  // real values (plus "No size", for a product that genuinely doesn't
  // have distinct sizes) — it can no longer produce a value the
  // customer-facing page won't recognize.
  //
  // Dims is now four real, separate, actual number boxes — Length,
  // Width, Height (all cm), and an optional Weight (kg) — instead of
  // one free-text field the admin had to format correctly by hand.
  // These compose into the exact same real "{L}cm × {W}cm × {H}cm ·
  // {W}kg" string already used everywhere else on this site (confirmed
  // directly against the real, live product data) — so nothing on the
  // backend, the product page, or the database needs to change; this
  // is purely a real, better INPUT for the exact same real, existing
  // field. Composed only at save time, not on every keystroke, so
  // there's no risk of a partial/mid-edit value round-tripping oddly
  // through the parser while the admin is still typing.
  const parseDims=str=>{
    if(!str) return {length:"",width:"",height:"",weightKg:""};
    const m=String(str).match(/^([\d.]+)cm\s*×\s*([\d.]+)cm\s*×\s*([\d.]+)cm(?:\s*·\s*([\d.]+)kg)?$/);
    if(!m) return {length:"",width:"",height:"",weightKg:""};
    return {length:m[1],width:m[2],height:m[3],weightKg:m[4]||""};
  };
  const composeDims=({length,width,height,weightKg})=>{
    if(!length&&!width&&!height) return "";
    const l=length||"0",w=width||"0",h=height||"0";
    let s=`${l}cm × ${w}cm × ${h}cm`;
    if(weightKg) s+=` · ${weightKg}kg`;
    return s;
  };

  // REAL, DIRECT FIX, directly requested: each variant's price field
  // was just a plain, raw number — genuinely inconsistent with the
  // Basics tab's own real GST-inclusive round-off tool, and confusing
  // for exactly that reason. GST_RATE_ADMIN mirrors the exact same
  // real, canonical rate already used on the Basics tab and everywhere
  // else on this site (0.18) — kept as its own local constant here
  // since VariantEditor is a genuinely separate, standalone component,
  // but it must stay numerically identical to that other, real value.
  // The real, actual database column (product_variants.price) is, and
  // must remain, the real GST-EXCLUSIVE base price — exactly matching
  // products.price's own real convention, and exactly what the real,
  // live checkout math in server/routes/orders.js already expects.
  // What changes here is purely the ADMIN INPUT: the visible price
  // field is now the real, final, GST-INCLUSIVE figure — what a
  // customer actually pays for that specific size — and the real base
  // price is computed and stored behind it automatically, the exact
  // same real pattern already proven on the Basics tab.
  const GST_RATE_ADMIN=0.18;
  const toInclusive=base=>base===""||base==null||isNaN(Number(base))?"":String(Math.round(Number(base)*(1+GST_RATE_ADMIN)));
  const toBase=inclusive=>inclusive===""||inclusive==null||isNaN(Number(inclusive))?"":String(Math.round(Number(inclusive)/(1+GST_RATE_ADMIN)));

  useEffect(()=>{
    if(!productId){ setLoading(false); return; }
    setLoading(true);
    fetch(`/api/admin/products/${productId}`,{credentials:"include"})
      .then(r=>r.ok?r.json():Promise.reject())
      .then(d=>{
        const loadedColors=(d.colors||[]).map(c=>({tempKey:`db-${c.id}`,dbId:c.id,variantKey:c.variantKey,label:c.label,swatchHex:c.swatchHex||"#cccccc",media:Array.isArray(c.media)?c.media:[]}));
        setColors(loadedColors);
        setVariants((d.variants||[]).map(v=>{
          const ownerColor=loadedColors.find(c=>c.dbId===v.colorId);
          // Real, existing, stored price is genuinely the base
          // (GST-exclusive) figure — inclusivePrice is computed FROM
          // it purely for real, honest display here, so reopening an
          // existing variant correctly shows what a customer is
          // ACTUALLY paying right now, not a blank or wrong figure.
          return {tempKey:`db-${v.id}`,colorTempKey:ownerColor?.tempKey||null,size:v.size||"",price:v.price,inclusivePrice:toInclusive(v.price),status:v.status,...parseDims(v.dims)};
        }));
      })
      .catch(()=>{ setColors([]); setVariants([]); })
      .finally(()=>setLoading(false));
  },[productId]);

  const addColor=()=>{
    if(colors.length>=12){ showToast("Max 12 colors.","error"); return; }
    const tempKey=`new-${nextTempKey.current++}`;
    setColors(c=>[...c,{tempKey,dbId:null,variantKey:"",label:"",swatchHex:"#cccccc",media:[]}]);
  };
  const updateColor=(tempKey,field,value)=>setColors(c=>c.map(x=>x.tempKey===tempKey?{...x,[field]:value}:x));
  const removeColor=tempKey=>{
    setColors(c=>c.filter(x=>x.tempKey!==tempKey));
    // Removing a color removes any variant rows that referenced it too —
    // a variant with no real color left behind would be silently
    // orphaned data the admin can no longer see or edit.
    setVariants(v=>v.filter(x=>x.colorTempKey!==tempKey));
  };

  const addVariant=()=>{
    if(variants.length>=40){ showToast("Max 40 size/color combinations.","error"); return; }
    const tempKey=`newv-${nextTempKey.current++}`;
    setVariants(v=>[...v,{tempKey,colorTempKey:colors[0]?.tempKey||null,size:"",price:"",inclusivePrice:"",status:"in-stock",length:"",width:"",height:"",weightKg:""}]);
  };
  const updateVariant=(tempKey,field,value)=>setVariants(v=>v.map(x=>x.tempKey===tempKey?{...x,[field]:value}:x));
  // Real, dedicated handler for the price field specifically — the
  // admin types the real, INCLUSIVE figure (what a customer actually
  // pays), and this keeps the real, stored base price correctly in
  // sync behind it, the same real pattern as the Basics tab's own
  // round-off tool. Deliberately does NOT try to force an exact,
  // perfect round-trip — whole-rupee rounding on the base price can
  // genuinely land ±₹1 off the typed figure (confirmed, stress-tested
  // math, same as the Basics tab); the real, live preview under the
  // field discloses this honestly rather than silently hiding it.
  const updateVariantPrice=(tempKey,inclusiveValue)=>{
    const digits=inclusiveValue.replace(/\D/g,"");
    setVariants(v=>v.map(x=>x.tempKey===tempKey?{...x,inclusivePrice:digits,price:toBase(digits)}:x));
  };
  const removeVariant=tempKey=>setVariants(v=>v.filter(x=>x.tempKey!==tempKey));

  const save=async()=>{
    for(const c of colors){
      if(!c.label.trim()){ showToast("Every color needs a label.","error"); return; }
      if(!/^[a-z0-9-]+$/.test(c.variantKey)){ showToast(`"${c.label}" needs a color key using only lowercase letters, numbers, and hyphens.`,"error"); return; }
    }
    for(const v of variants){
      if(!Number.isInteger(Number(v.price))||Number(v.price)<=0){ showToast("Every variant needs a real, positive price.","error"); return; }
    }
    setSaving(true);
    try{
      // Colors and variants are both re-expressed against a plain
      // ARRAY INDEX here (clientColorIndex), matching exactly what the
      // backend's PUT /:id/variants endpoint expects — real database
      // ids get thrown away and reassigned on every save (same
      // delete-then-reinsert pattern already proven for Featured
      // Products and the CMS), so there's no stale-id mismatch risk
      // between what the UI shows and what the database ends up with.
      const colorIndexByTempKey=Object.fromEntries(colors.map((c,i)=>[c.tempKey,i]));
      const body={
        colors:colors.map(c=>({variantKey:c.variantKey,label:c.label,swatchHex:c.swatchHex,media:Array.isArray(c.media)?c.media:[]})),
        variants:variants.map(v=>({
          clientColorIndex:v.colorTempKey?colorIndexByTempKey[v.colorTempKey]:null,
          size:v.size||null, price:Number(v.price), status:v.status, dims:composeDims(v)||null,
        })),
      };
      const res=await apiFetch(`/api/admin/products/${productId}/variants`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await res.json().catch(()=>({}));
      if(res.ok){
        showToast(variants.length===0?"All variants cleared — product uses base price only":"Variants saved","success");
        // Reload from DB so the editor matches what was actually stored
        // (prevents stale rows looking like they "came back" after close/reopen).
        try{
          const r2=await fetch(`/api/admin/products/${productId}`,{credentials:"include"});
          if(r2.ok){
            const d=await r2.json();
            const loadedColors=(d.colors||[]).map(c=>({tempKey:`db-${c.id}`,dbId:c.id,variantKey:c.variantKey,label:c.label,swatchHex:c.swatchHex||"#cccccc",media:Array.isArray(c.media)?c.media:[]}));
            setColors(loadedColors);
            setVariants((d.variants||[]).map(v=>{
              const ownerColor=loadedColors.find(c=>c.dbId===v.colorId);
              return {tempKey:`db-${v.id}`,colorTempKey:ownerColor?.tempKey||null,size:v.size||"",price:v.price,inclusivePrice:toInclusive(v.price),status:v.status,...parseDims(v.dims)};
            }));
          }
        }catch{}
      }
      else showToast(data.error||(res.status===403?"Session security check failed — refresh the page and try again.":"Couldn't save variants."),"error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setSaving(false);
    }
  };

  if(loading) return <Skeleton height={120}/>;

  return <div>
    <div className="mb-5 p-3.5" style={{backgroundColor:"rgba(24,54,48,0.05)",borderRadius:RADIUS.xs}}>
      <p className="text-[13px] leading-[1.7]" style={{color:"rgba(36,62,65,0.85)"}}>
        <strong>Optional — leave empty if you only use one price.</strong> Only add a combination when this piece truly has different colours or sizes. Empty list + <strong>Save Variants</strong> = shop uses the Basics price only. Do not add Small/Medium/Large unless you sell those sizes separately.
      </p>
    </div>
    <div className="flex items-center justify-between mb-3">
      <p className="text-[11px] tracking-[0.1em] uppercase" style={{color:"rgba(36,62,65,0.75)"}}>Colors</p>
      <SweepButton onClick={addColor}>+ Add Color</SweepButton>
    </div>
    {colors.length===0
      ? <p className="text-[12.5px] mb-4" style={{color:"rgba(36,62,65,0.75)"}}>No colours — customers only see the base product (no colour pills). Add Red/Black here (not under Finish note). Optional photos per colour override the main Media gallery when that swatch is selected.</p>
      : <div className="flex flex-col gap-2 mb-5">
          {colors.map(c=><div key={c.tempKey} className="p-2.5 flex flex-col gap-2" style={{border:"1px solid rgba(36,62,65,0.14)",borderRadius:RADIUS.xs}}>
            <div className="flex items-center gap-2">
              <input type="color" value={c.swatchHex} onChange={e=>updateColor(c.tempKey,"swatchHex",e.target.value)} className="w-8 h-8 shrink-0 cursor-pointer" style={{border:"none",borderRadius:RADIUS.xs}}/>
              <input value={c.label} onChange={e=>updateColor(c.tempKey,"label",e.target.value)} placeholder="Label (e.g. Red)" className="flex-1 bg-transparent outline-none text-[13px] px-2 py-1.5" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}/>
              <input value={c.variantKey} onChange={e=>updateColor(c.tempKey,"variantKey",e.target.value.toLowerCase())} placeholder="key (e.g. red)" className="w-28 bg-transparent outline-none text-[12px] font-mono px-2 py-1.5" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}/>
              <button type="button" onClick={()=>removeColor(c.tempKey)} style={{color:T.error,flexShrink:0}}><Trash2 size={14}/></button>
            </div>
            {/* Optional photos for THIS colour only. Empty → customer sees product Media tab gallery. */}
            <div className="pl-1">
              <p className="text-[10px] tracking-[0.08em] uppercase mb-1.5" style={{color:"rgba(36,62,65,0.55)"}}>Photos for this colour (optional)</p>
              <div className="flex flex-wrap gap-1.5 items-center">
                {(Array.isArray(c.media)?c.media:[]).map((m,mi)=>(
                  <div key={mi} className="relative w-12 h-12 overflow-hidden" style={{borderRadius:RADIUS.xs,border:"1px solid rgba(36,62,65,0.15)"}}>
                    {m.type==="video"
                      ? <video src={m.src} className="w-full h-full object-cover"/>
                      : <img src={m.src} alt="" className="w-full h-full object-cover"/>}
                    <button type="button" title="Remove" onClick={()=>updateColor(c.tempKey,"media",(c.media||[]).filter((_,j)=>j!==mi))}
                      className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center text-[10px]" style={{background:"rgba(168,59,50,0.9)",color:"#fff"}}>×</button>
                  </div>
                ))}
                <label className="inline-flex items-center gap-1 px-2 py-1.5 text-[10px] tracking-[0.06em] uppercase cursor-pointer" style={{border:`1px solid ${T.teal}`,borderRadius:RADIUS.xs,color:T.teal}}>
                  <Upload size={12}/>Add
                  <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" className="hidden" onChange={async e=>{
                    const file=e.target.files?.[0]; e.target.value="";
                    if(!file) return;
                    try{
                      const body=new FormData();
                      body.append("file",file);
                      body.append("kind",file.type.startsWith("video/")?"video":"image");
                      body.append("category","");
                      body.append("productId",productId||"");
                      const res=await apiFetch("/api/admin/products/media/upload",{method:"POST",body});
                      const data=await res.json().catch(()=>({}));
                      if(res.ok) updateColor(c.tempKey,"media",[...(c.media||[]),{type:data.kind,src:data.url,photoId:data.photoId}]);
                      else showToast(data.error||"Upload failed","error");
                    }catch{ showToast("Upload failed","error"); }
                  }}/>
                </label>
              </div>
              <p className="text-[10.5px] mt-1" style={{color:"rgba(36,62,65,0.5)"}}>Leave empty to use the product’s main Media gallery for this colour.</p>
            </div>
          </div>)}
        </div>}

    <div className="flex items-center justify-between mb-2">
      <p className="text-[11px] tracking-[0.1em] uppercase" style={{color:"rgba(36,62,65,0.75)"}}>Size / Color / Price / Stock</p>
      <SweepButton onClick={addVariant}>+ Add Combination</SweepButton>
    </div>
    <p className="text-[11.5px] mb-3" style={{color:"rgba(36,62,65,0.65)"}}>One real row per colour this product actually comes in. Pick a real Size only if this specific product genuinely comes in more than one — "No size" is correct for almost every product.</p>
    {variants.length===0
      ? <p className="text-[12.5px] mb-4 leading-relaxed" style={{color:"rgba(36,62,65,0.75)"}}>
          No size/color combinations — this product uses only the <strong>base price</strong> from Basics.
          If you removed rows here, click <strong>Save Variants</strong> below so the database is cleared
          (main “Save Changes” on the product does not clear variants by itself).
        </p>
      : <div className="flex flex-col gap-3 mb-2">
          {variants.map(v=><div key={v.tempKey} className="p-3" style={{border:"1px solid rgba(36,62,65,0.14)",borderRadius:RADIUS.xs}}>
            <div className="flex items-center gap-2 flex-wrap mb-2.5">
              <select value={v.colorTempKey||""} onChange={e=>updateVariant(v.tempKey,"colorTempKey",e.target.value||null)} className="text-[12.5px] px-2 py-1.5" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}>
                <option value="">No color</option>
                {colors.map(c=><option key={c.tempKey} value={c.tempKey}>{c.label||"(unnamed)"}</option>)}
              </select>
              {/* REAL, DIRECT FIX: Size is now a proper dropdown limited
                  to the exact three real values the customer-facing
                  product page actually recognizes ("Small"/"Medium"/
                  "Large") — a free-text box could never guarantee that,
                  and a typo or wrong casing here would silently mean
                  this variant never shows up as a real, selectable size
                  option at all. */}
              <label className="flex items-center gap-1.5 text-[11px]" style={{color:T.muted}}>
                <span className="uppercase tracking-[0.06em] shrink-0">Size</span>
                <select value={v.size} onChange={e=>updateVariant(v.tempKey,"size",e.target.value)} className="text-[13px] px-2.5 py-2 font-medium" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,color:T.teal,backgroundColor:T.cream,minWidth:"7.5rem"}}>
                  <option value="">No size</option>
                  <option value="Small">Small</option>
                  <option value="Medium">Medium</option>
                  <option value="Large">Large</option>
                </select>
              </label>
              <div className="flex flex-col">
                <input value={v.inclusivePrice} onChange={e=>updateVariantPrice(v.tempKey,e.target.value)} placeholder="Price ₹ (incl. GST)" className="w-32 bg-transparent outline-none text-[12.5px] px-2 py-1.5" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}/>
                {/* REAL, DIRECT FIX: the admin now types the real,
                    final, GST-INCLUSIVE price here — exactly what a
                    customer pays for this specific size — matching the
                    Basics tab's own real round-off tool. This live note
                    shows the real, actual base price being stored
                    behind it, and honestly flags the same, real ±₹1
                    whole-rupee rounding gap the Basics tab already
                    discloses, rather than silently hiding it. */}
                {v.inclusivePrice!==""&&(()=>{
                  const forwardCheck=toInclusive(v.price);
                  return <p className="text-[10px] mt-0.5" style={{color:forwardCheck===v.inclusivePrice?"rgba(36,62,65,0.55)":T.warning}}>
                    {forwardCheck===v.inclusivePrice
                      ? `Base (excl. GST): ₹${v.price}`
                      : `Base ₹${v.price} → customer actually sees ₹${forwardCheck} (±₹1 rounding)`}
                  </p>;
                })()}
              </div>
              <select value={v.status} onChange={e=>updateVariant(v.tempKey,"status",e.target.value)} className="text-[12.5px] px-2 py-1.5" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}>
                <option value="in-stock">In Stock</option>
                <option value="low-stock">Low Stock</option>
                <option value="sold-out">Sold Out</option>
                <option value="pre-order">Pre-Order</option>
              </select>
              <button onClick={()=>removeVariant(v.tempKey)} style={{color:T.error,flexShrink:0,marginLeft:"auto"}}><Trash2 size={14}/></button>
            </div>
            {/* REAL, DIRECT FIX: four real, separate, actual number boxes
                instead of one free-text "Dims override" field the admin
                had to format correctly by hand — genuinely reported as
                unclear. These compose into the exact same real
                "{L}cm × {W}cm × {H}cm · {W}kg" text the rest of the site
                already uses, so nothing else needs to change to read it;
                this is purely a real, better way to type it in. All
                optional — leave blank to use this product's own,
                overall real dimensions instead of a per-variant one. */}
            <div className="flex items-center gap-2 flex-wrap mt-1 pt-2" style={{borderTop:"1px solid rgba(36,62,65,0.08)"}}>
              <p className="text-[11px] tracking-[0.06em] uppercase shrink-0 w-full sm:w-auto" style={{color:T.teal}}>Measurements for this size (cm)</p>
              <div className="flex items-center gap-1">
                <input value={v.length} onChange={e=>updateVariant(v.tempKey,"length",e.target.value.replace(/[^\d.]/g,""))} placeholder="L" className="w-14 bg-transparent outline-none text-[12.5px] px-2 py-1.5 text-center" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}/>
                <span className="text-[11px]" style={{color:"rgba(36,62,65,0.5)"}}>cm ×</span>
              </div>
              <div className="flex items-center gap-1">
                <input value={v.width} onChange={e=>updateVariant(v.tempKey,"width",e.target.value.replace(/[^\d.]/g,""))} placeholder="W" className="w-14 bg-transparent outline-none text-[12.5px] px-2 py-1.5 text-center" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}/>
                <span className="text-[11px]" style={{color:"rgba(36,62,65,0.5)"}}>cm ×</span>
              </div>
              <div className="flex items-center gap-1">
                <input value={v.height} onChange={e=>updateVariant(v.tempKey,"height",e.target.value.replace(/[^\d.]/g,""))} placeholder="H" className="w-14 bg-transparent outline-none text-[12.5px] px-2 py-1.5 text-center" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}/>
                <span className="text-[11px]" style={{color:"rgba(36,62,65,0.5)"}}>cm</span>
              </div>
              <div className="flex items-center gap-1 ml-2">
                <input value={v.weightKg} onChange={e=>updateVariant(v.tempKey,"weightKg",e.target.value.replace(/[^\d.]/g,""))} placeholder="Weight" className="w-16 bg-transparent outline-none text-[12.5px] px-2 py-1.5 text-center" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}/>
                <span className="text-[11px]" style={{color:"rgba(36,62,65,0.5)"}}>kg</span>
              </div>
              {(v.length||v.width||v.height)&&<span className="text-[11px] italic ml-2" style={{color:"rgba(36,62,65,0.55)",fontFamily:"'Fraunces',serif"}}>
                {composeDims(v)}
              </span>}
            </div>
          </div>)}
        </div>}
    {/* WHAT: Persist or wipe size/colour rows for this product.
          WHY: Product "Save Changes" does not touch product_variants — only this path does.
          HOW: PUT full list (or empty) to /api/admin/products/:id/variants (delete-all then insert).
          CONNECTED TO: server/routes/admin/products.js; ProductDetailView on storefront. */}
    <div className="flex flex-wrap gap-2 items-center mt-1">
      <SweepButton filled onClick={save} disabled={saving}>{saving?"Saving…":"Save Variants"}</SweepButton>
      <SweepButton type="button" disabled={saving||(variants.length===0&&colors.length===0)} onClick={async()=>{
        setVariants([]); setColors([]);
        setSaving(true);
        try{
          const res=await apiFetch(`/api/admin/products/${productId}/variants`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({colors:[],variants:[]})});
          const data=await res.json().catch(()=>({}));
          if(res.ok){ setVariants([]); setColors([]); showToast("All variants cleared in database","success"); }
          else showToast(data.error||"Could not clear variants.","error");
        }catch{ showToast("Could not reach the server.","error"); }
        finally{ setSaving(false); }
      }}>Clear all in database</SweepButton>
    </div>
  </div>;
}

// Real, dedicated image/video lightbox for the Media Manager's own
// thumbnail grid — directly requested, since the small square tile
// (now object-contain, see MediaGalleryEditor's own real fix comment)
// genuinely isn't big enough to check real photo quality or framing
// before saving. Deliberately its own real component rather than
// reusing the existing Modal (shared.jsx) — Modal is a real
// confirm/cancel dialog shape (fixed 400px width, always shows two
// buttons), which is the wrong real fit for "show me this one photo,
// as large as it can genuinely go, then let me close it" — but the
// same real Escape-to-close and click-outside-to-close conventions
// Modal already establishes are kept here too, for real consistency.
function MediaLightbox({ media, onClose }){
  useEffect(()=>{
    if(!media) return;
    const onKey=e=>{ if(e.key==="Escape") onClose(); };
    window.addEventListener("keydown",onKey);
    return ()=>window.removeEventListener("keydown",onKey);
  },[media,onClose]);
  if(!media) return null;
  return <div className="fixed inset-0 z-[300] flex items-center justify-center p-6" style={{backgroundColor:"rgba(36,62,65,0.85)"}} onClick={onClose}>
    <button onClick={onClose} aria-label="Close" className="absolute top-5 right-5 p-2" style={{color:"white"}}><X size={24}/></button>
    <div className="max-w-[92vw] max-h-[92vh]" onClick={e=>e.stopPropagation()}>
      {media.type==="video"
        ? <video src={media.src} controls autoPlay className="max-w-[92vw] max-h-[92vh]" style={{borderRadius:RADIUS.xs}}/>
        : <img src={media.src} alt="" className="max-w-[92vw] max-h-[92vh] object-contain" style={{borderRadius:RADIUS.xs}}/>}
    </div>
  </div>;
}

function MediaGalleryEditor({ productId, category, media, onChange }){
  const showToast=useToast();
  const [uploading,setUploading]=useState(false);
  const [copiedIdx,setCopiedIdx]=useState(null);
  // Real click-to-zoom — directly requested: the small square thumbnail
  // is genuinely too small to check real photo quality/framing before
  // saving, especially now that object-contain (below) can show a real
  // photo smaller than the tile if it isn't square. Holds the specific
  // real media item clicked, not just a boolean, so the lightbox knows
  // exactly what to render full-size.
  const [zoomedMedia,setZoomedMedia]=useState(null);

  const uploadFile=async(file,kind)=>{
    setUploading(true);
    try{
      const body=new FormData();
      body.append("file",file);
      body.append("kind",kind);
      body.append("category",category||"");
      body.append("productId",productId||"");
      const res=await apiFetch("/api/admin/products/media/upload",{method:"POST",body});
      const data=await res.json().catch(()=>({}));
      if(res.ok){ onChange([...media,{type:data.kind,src:data.url,photoId:data.photoId}]); }
      else showToast(data.error||"Couldn't upload that file.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setUploading(false);
    }
  };

  const handlePicked=e=>{
    const files=Array.from(e.target.files||[]);
    e.target.value=""; // lets picking the exact same file again re-trigger onChange
    files.forEach(f=>uploadFile(f,f.type.startsWith("video/")?"video":"image"));
  };

  const remove=i=>onChange(media.filter((_,idx)=>idx!==i));
  const moveLeft=i=>{ if(i===0) return; const next=[...media]; [next[i-1],next[i]]=[next[i],next[i-1]]; onChange(next); };
  const moveRight=i=>{ if(i===media.length-1) return; const next=[...media]; [next[i],next[i+1]]=[next[i+1],next[i]]; onChange(next); };
  const makeMain=i=>{ if(i===0) return; const next=[...media]; const [item]=next.splice(i,1); next.unshift(item); onChange(next); };
  const copyId=(id,i)=>{
    navigator.clipboard?.writeText(id).then(()=>{ setCopiedIdx(i); setTimeout(()=>setCopiedIdx(c=>c===i?null:c),1500); });
  };

  return <div>
    <p className="text-[11px] tracking-[0.1em] uppercase mb-3" style={{color:"rgba(36,62,65,0.75)"}}>Photos & Videos</p>
    {media.length===0
      ? <p className="text-[12.5px] mb-4" style={{color:"rgba(36,62,65,0.75)"}}>No media yet — the customer-facing gallery will show a placeholder icon until at least one photo is added.</p>
      : <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          {media.map((m,i)=><div key={i} className="relative group">
            <div className="w-full overflow-hidden relative" style={{aspectRatio:"1/1",borderRadius:RADIUS.xs,backgroundColor:"rgba(36,62,65,0.05)",boxShadow:i===0?`0 0 0 2px ${T.gold}`:"0 0 0 1px rgba(36,62,65,0.15)"}}>
              {m.type==="video"
                ? <video src={m.src} className="w-full h-full object-contain cursor-zoom-in" onClick={()=>setZoomedMedia(m)}/>
                : <img src={m.src} alt="" className="w-full h-full object-contain cursor-zoom-in" onClick={()=>setZoomedMedia(m)}/>}
              {m.type==="video"&&<div className="absolute bottom-1 right-1"><Film size={12} style={{color:"white"}}/></div>}
              {i===0&&<div className="absolute top-1 left-1 px-1.5 py-0.5 flex items-center gap-1" style={{backgroundColor:T.gold,borderRadius:RADIUS.xs}}>
                <Star size={9} fill="white" style={{color:"white"}}/><span className="text-[8.5px] uppercase text-white" style={{fontWeight:600}}>Main</span>
              </div>}
            </div>
            {/* The whole reason for building this: a stable, human-readable
                ID per photo, in the exact format requested, so a real
                problem with a specific photo can be reported by ID alone
                ("photo LAMP-AETHER-83920 is wrong") instead of vaguely
                pointing at "the second image on the lamp product" — the
                copy button exists specifically so this never has to be
                retyped by hand. */}
            {m.photoId&&<button type="button" onClick={()=>copyId(m.photoId,i)} title="Copy photo ID"
              className="w-full mt-1.5 px-1.5 py-1 text-left flex items-center gap-1" style={{border:"1px solid rgba(36,62,65,0.14)",borderRadius:RADIUS.xs,backgroundColor:copiedIdx===i?"rgba(59,110,82,0.1)":"transparent"}}>
              <span className="text-[9px] font-mono truncate flex-1" style={{color:copiedIdx===i?T.success:"rgba(36,62,65,0.55)"}}>{copiedIdx===i?"Copied!":m.photoId}</span>
              <Copy size={10} style={{color:"rgba(36,62,65,0.75)",flexShrink:0}}/>
            </button>}
            <div className="flex items-center justify-between mt-1.5 px-0.5">
              <div className="flex gap-1">
                <button type="button" onClick={()=>moveLeft(i)} disabled={i===0} title="Move earlier" style={{color:"rgba(36,62,65,0.75)",opacity:i===0?0.3:1}}><ChevronLeft size={14}/></button>
                <button type="button" onClick={()=>moveRight(i)} disabled={i===media.length-1} title="Move later" style={{color:"rgba(36,62,65,0.75)",opacity:i===media.length-1?0.3:1}}><ChevronRight size={14}/></button>
                {i!==0&&<button type="button" onClick={()=>makeMain(i)} title="Make main photo" style={{color:T.teal}}><Star size={13}/></button>}
              </div>
              <button type="button" onClick={()=>remove(i)} title="Remove" style={{color:T.error}}><Trash2 size={13}/></button>
            </div>
          </div>)}
        </div>}
    <label className="inline-flex items-center gap-2 px-4 py-2.5 text-[12px] tracking-[0.06em] uppercase cursor-pointer" style={{border:`1px solid ${T.teal}`,borderRadius:RADIUS.sm,color:T.teal,opacity:uploading?0.6:1,pointerEvents:uploading?"none":"auto"}}>
      <Upload size={14}/>{uploading?"Uploading…":"Add Photo or Video"}
      <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple onChange={handlePicked} className="hidden"/>
    </label>
    <p className="text-[12px] mt-2 leading-relaxed" style={{color:T.muted}}>
      <strong style={{color:T.teal}}>Photos:</strong> portrait <strong>4∶5</strong> (ideal 1600×2000). Uploads are auto-framed to 4∶5 on cream so the live site never crops oddly.{" "}
      <strong style={{color:T.teal}}>Videos:</strong> export as <strong>3∶4</strong> (e.g. 1080×1440) — the product page video frame is 3∶4. From CapCut/etc. pick 3∶4 (not 16∶9 or 1∶1) so there are no cream sidebars.
    </p>
    <p className="text-[11px] mt-2" style={{color:"rgba(36,62,65,0.75)"}}>The first item (marked ★ Main) is what customers see first — use the star or the arrows to reorder. JPEG/PNG/WebP up to 10MB, MP4/WebM/MOV up to 100MB.</p>
    <MediaLightbox media={zoomedMedia} onClose={()=>setZoomedMedia(null)}/>
  </div>;
}

const STATUS_OPTIONS=["draft","in-stock","low-stock","sold-out","pre-order","hidden"];

// WHAT: Shared search + sort bar for admin list pages.
// WHY: Long product/order lists are hard to scan without name search and sort.
// HOW: Client-side filter/sort only — does not change API payloads.
// CONNECTED TO: AdminProducts, AdminOrders, AdminCustomers, AdminReturns, AdminBatches.
function AdminListControls({ search, setSearch, searchPlaceholder="Search…", sort, setSort, sortOptions }) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 mb-5 items-stretch sm:items-center">
      <div className="relative flex-1 min-w-0 max-w-lg">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{color:"rgba(36,62,65,0.45)"}}/>
        <input
          value={search}
          onChange={e=>setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full pl-9 pr-3 py-2.5 text-[13px] outline-none"
          style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal,background:"rgba(255,255,255,0.5)"}}
        />
      </div>
      <label className="flex items-center gap-2 shrink-0 text-[11px] tracking-[0.06em] uppercase" style={{color:"rgba(36,62,65,0.55)"}}>
        Sort
        <select
          value={sort}
          onChange={e=>setSort(e.target.value)}
          className="text-[12.5px] normal-case tracking-normal px-3 py-2.5 min-w-[11rem] outline-none"
          style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal,background:"rgba(255,255,255,0.5)"}}
        >
          {sortOptions.map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
      </label>
    </div>
  );
}

function cmpStr(a,b){ return String(a||"").localeCompare(String(b||""), undefined, {sensitivity:"base"}); }
function cmpNum(a,b){ return (Number(a)||0)-(Number(b)||0); }


const STATUS_BADGE_VARIANT={"draft":"warning","in-stock":"success","low-stock":"warning","sold-out":"error","pre-order":"warning","hidden":"error"};

/** URL slug from product name: lowercase, hyphens, a-z0-9 only. */
function slugifyProductId(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function ProductEditorPanel({ product, onClose, onSaved }){
  const showToast=useToast();
  const isNew=!product?.id||product.isNew;
  const [form,setForm]=useState({
    id:product?.id&&!product.isNew?product.id:"", name:product?.name||"", category:product?.category||"Planters",
    price:product?.price??"", dims:product?.dims||"", hsn:product?.hsn||"3924",
    status:product?.status||"draft", description:product?.description||"",
    metaTitle:product?.meta_title||"", metaDesc:product?.meta_desc||"",
    accessoriesNote:product?.accessories_note||"",
    stockQty:product?.stock_qty!=null?String(product.stock_qty):product?.stockQty!=null?String(product.stockQty):"",
  });
  // When true, name changes no longer overwrite id (admin typed a custom slug).
  const [idManual,setIdManual]=useState(false);
  // REAL, DIRECT CORRECTION following a direct, live report: the
  // comment above (and the original version of this check) was itself
  // built on a wrong assumption — that ANY real variant, including one
  // with no real, distinct size, should mean the Basics price is
  // ignored. That's precisely NOT what was wanted: a real colour-only
  // variant (no real size) must never silently override the real price
  // an admin actually typed into Basics. The real, now-confirmed,
  // correct rule — kept in exact lockstep with the same fix on the
  // customer-facing product page and the real, authoritative
  // server-side checkout logic — only warns when a real, DISTINCT SIZE
  // (Small/Medium/Large) genuinely exists on this product; a product
  // with only real colours and no real sizes correctly keeps using its
  // Basics price everywhere, so no warning is shown for it.
  const [hasRealSizes,setHasRealSizes]=useState(false);
  useEffect(()=>{
    if(!product?.id||product.isNew) return;
    fetch(`/api/admin/products/${product.id}`,{credentials:"include"}).then(r=>r.ok?r.json():null).then(d=>{
      if(d?.variants?.some(v=>v.size!=null)) setHasRealSizes(true);
    }).catch(()=>{});
  },[product?.id]);
  const [categoryOptions,setCategoryOptions]=useState([]);
  useEffect(()=>{
    fetch("/api/admin/categories",{credentials:"include"})
      .then(r=>r.ok?r.json():null)
      .then(d=>{
        const rows=d?.categories||d?.rows||[];
        const names=rows.map(r=>r.name||r).filter(Boolean);
        setCategoryOptions(names.length?names:["Planters","Vases","Ceiling Lighting","Table Lamps","Lanterns","Floor Lamps"]);
      })
      .catch(()=>setCategoryOptions(["Planters","Vases","Ceiling Lighting","Table Lamps","Lanterns","Floor Lamps"]));
  },[]);
  // Studio sections: Basics → Media → Details → SEO (same save payload)
  const [editorSection,setEditorSection]=useState("basics");
  // Kept as its own state (not folded directly into `form`) purely
  // because MediaGalleryEditor manages it as a plain array, not a form
  // field with a text input — but it rides along in the exact same PUT
  // request as everything else the moment "Save Changes" is clicked
  // (see `body` in save() below), not a separate save action of its
  // own. Uploading a file to R2 happens immediately when it's picked
  // (there's no way to get a URL without actually uploading it first),
  // but the PRODUCT RECORD itself only gains that photo once the admin
  // actually saves — closing the panel without saving leaves an
  // uploaded-but-unused file in R2 rather than a half-finished product.
  const [media,setMedia]=useState(Array.isArray(product?.media)?product.media:[]);
  const [keyFeatures,setKeyFeatures]=useState(Array.isArray(product?.key_features)?product.key_features:[]);
  const [finishes,setFinishes]=useState(Array.isArray(product?.finishes)?product.finishes:[]);
  // Real, per-product cost breakdown — directly requested: material,
  // labor, electricity, packaging, transport, design, and a real
  // catch-all "other," entered once, editable anytime. Normalized to
  // always have every real category present (defaulting to 0) even if
  // the existing product's stored cost_breakdown is empty or only has
  // a subset — matches the exact same real normalization the backend
  // save route applies, so this form's own local state is never
  // structurally different from what the server will actually store.
  const COST_CATEGORY_LABELS={material:"Material",labor:"Labor",electricity:"Electricity",packaging:"Packaging",transport:"Transport",design:"Design",other:"Other"};
  const [costBreakdown,setCostBreakdown]=useState(()=>{
    const existing=product?.cost_breakdown&&typeof product.cost_breakdown==="object"?product.cost_breakdown:{};
    return Object.fromEntries(Object.keys(COST_CATEGORY_LABELS).map(k=>[k,existing[k]!=null?String(existing[k]):""]));
  });
  const updCost=k=>v=>setCostBreakdown(c=>({...c,[k]:v.replace(/\D/g,"")}));
  const totalCostPerUnit=Object.values(costBreakdown).reduce((sum,v)=>sum+(Number(v)||0),0);
  const [newFinishName,setNewFinishName]=useState("");
  const [newFinishHex,setNewFinishHex]=useState("#C4B49A");
  const [newFeature,setNewFeature]=useState("");
  const addFeature=()=>{
    const trimmed=newFeature.trim();
    if(!trimmed||keyFeatures.length>=12) return;
    setKeyFeatures(f=>[...f,trimmed]); setNewFeature("");
  };
  const removeFeature=i=>setKeyFeatures(f=>f.filter((_,idx)=>idx!==i));
  const [saving,setSaving]=useState(false);
  const upd=k=>v=>{
    if(k==="id"){
      setIdManual(true);
      setForm(f=>({...f,id:slugifyProductId(v) || String(v||"").toLowerCase().replace(/[^a-z0-9-]+/g,"-")}));
      return;
    }
    if(k==="name"&&isNew){
      // Auto URL slug from name until admin edits the ID field (idManual).
      setForm(f=>{
        const next={...f,name:v};
        if(!idManual) next.id=slugifyProductId(v);
        return next;
      });
      return;
    }
    setForm(f=>({...f,[k]:v}));
  };
  // Real GST-pricing helper — directly requested: (1) a live preview of
  // what a customer will actually pay (base price + 18% GST) as the
  // admin types the real base price, and (2) the reverse — type the
  // actual, real, ROUND final price you want a customer to see (₹1,699,
  // not ₹1,698.83), and the system works backward to the correct real
  // base price to store, so the stored price + GST reproduces that
  // exact round number at checkout.
  // GST_RATE_ADMIN mirrors the real, live rate used everywhere else
  // (server/routes/orders.js's own 0.18, and AkaraApp.jsx's own
  // gstInclusivePrice()) — kept as its own real, local constant here
  // rather than importing across the customer/admin bundle boundary,
  // but genuinely must stay numerically identical to those; if the
  // real GST rate ever changes, this needs updating in step with them.
  const GST_RATE_ADMIN=0.18;
  // Real, local-only input state for the round-off field — deliberately
  // NOT part of `form` (which is exactly what gets saved): this is a
  // pure calculation aid for arriving at the right base price, not a
  // second, real, stored figure. Initialized from the real, existing
  // product price (if editing) so the field shows a sensible real
  // starting point rather than blank. Deliberately does NOT stay
  // auto-synced from form.price via a real, live useEffect — an
  // earlier version of this did, and it would have silently overwritten
  // the admin's own keystrokes mid-typing with a "corrected" figure the
  // moment the reverse calculation below updated form.price, fighting
  // real, active typing. Instead, both real numbers (what you typed,
  // and what the actual resulting customer price will be) are shown
  // side by side, honestly, rather than one silently replacing the
  // other.
  const [roundedPriceInput,setRoundedPriceInput]=useState(product?.price?String(Math.round(Number(product.price)*(1+GST_RATE_ADMIN))):"");
  const handleRoundedPriceChange=v=>{
    const digits=v.replace(/\D/g,"");
    setRoundedPriceInput(digits);
    if(digits===""){ return; }
    // The real, actual reverse calculation: base = round(inclusive / 1.18).
    // Deliberately does NOT silently trust this round-trips perfectly —
    // whole-rupee rounding on the BASE price can land the real, forward-
    // calculated total ±₹1 off the admin's intended round figure roughly
    // 15% of the time (confirmed directly by testing this math against
    // hundreds of real prices before writing this code) — a real,
    // genuine rounding artifact of working with whole rupees on both
    // ends, not a bug to silently paper over. The real, correct base
    // price is stored either way (this IS the closest whole-rupee base
    // that can produce something close to the intended figure), and the
    // real, actual resulting customer price is shown back honestly via
    // realGstPreview below (compared directly against what was typed),
    // so a genuine ±₹1 gap is never hidden.
    const inclusive=Number(digits);
    const base=Math.round(inclusive/(1+GST_RATE_ADMIN));
    setForm(f=>({...f,price:String(base)}));
  };
  // Real, forward recalculation from whatever's actually in form.price
  // right now (the real, current base price, however it got there) —
  // used for BOTH real display cases: (a) the live GST preview when the
  // admin types a base price directly, and (b) honest confirmation of
  // the real, ACTUAL customer price after typing a round-off figure,
  // which may genuinely differ by ±₹1 from what was typed, per the real
  // rounding note above.
  const realGstPreview=form.price&&!isNaN(Number(form.price))?Math.round(Number(form.price)*(1+GST_RATE_ADMIN)):null;

  const save=async()=>{
    if(isNew&&(!form.id||!/^[a-z0-9-]+$/.test(form.id))){ showToast("Product ID must be lowercase letters, numbers, and hyphens only.","error"); return; }
    if(!form.name.trim()||!form.category.trim()||!form.dims.trim()||!form.hsn.trim()){ showToast("Name, category, dimensions, and HSN are all required.","error"); return; }
    const price=Number(form.price);
    if(!Number.isInteger(price)||price<=0){ showToast("Price must be a positive whole number (rupees).","error"); return; }
    setSaving(true);
    try{
      let stockQtyNum=form.stockQty===""||form.stockQty==null?null:Number(form.stockQty);
      let statusToSave=form.status;
      // Explicit sold-out / draft / hidden / pre-order always wins — never overwrite with stock qty.
      // (Bug: choosing Sold Out while capacity still showed e.g. 90 forced status back to in-stock.)
      if(["draft","hidden","pre-order","sold-out"].includes(form.status)){
        statusToSave=form.status;
        if(form.status==="sold-out") stockQtyNum=0;
      } else if(stockQtyNum!=null&&Number.isFinite(stockQtyNum)){
        if(stockQtyNum<=0) statusToSave="sold-out";
        else if(stockQtyNum<=20) statusToSave="low-stock";
        else statusToSave="in-stock";
      }
      const body={ name:form.name, category:form.category, price, dims:form.dims, hsn:form.hsn, status:statusToSave, stockQty:stockQtyNum, description:form.description, metaTitle:form.metaTitle, metaDesc:form.metaDesc, media, keyFeatures, accessoriesNote:form.accessoriesNote, finishes, costBreakdown:Object.fromEntries(Object.entries(costBreakdown).map(([k,v])=>[k,Number(v)||0])) };
      const res=isNew
        ? await apiFetch("/api/admin/products",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,id:form.id})})
        : await apiFetch(`/api/admin/products/${product.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await res.json().catch(()=>({}));
      if(res.ok){ showToast(isNew?"Product created":"Product updated","success"); onSaved(); }
      else showToast(data.error||"Couldn't save this product.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setSaving(false);
    }
  };

  // WHAT: Product editor overlay — do NOT close on backdrop click.
  // WHY: Tall form + native <select>/file/color dialogs often fire a click on the dimmed
  //      layer after the dialog closes, which wiped the panel with no error toast.
  // HOW: Close only via X, Cancel, or successful Save (onSaved). stopPropagation kept as belt-and-braces.
  // CONNECTED TO: AdminProducts editorTarget; Save / Cancel buttons below.
  return <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto py-8 px-4" style={{backgroundColor:"rgba(36,62,65,0.45)"}} role="dialog" aria-modal="true" aria-label={isNew?"New product":"Edit product"}>
    <div onClick={e=>e.stopPropagation()} onMouseDown={e=>e.stopPropagation()} className="w-full max-w-[720px]" style={{backgroundColor:"#F7F3EB",borderRadius:0,boxShadow:"0 24px 80px rgba(24,54,48,0.28)",borderTop:"3px solid #E5C690"}}>
      <div className="flex items-center justify-between px-6 py-5" style={{borderBottom:"1px solid rgba(36,62,65,0.1)"}}>
        <div>
          <p className="text-[10px] tracking-[0.16em] uppercase mb-1" style={{color:T.teal}}>Catalog</p>
          <h2 className="italic text-[22px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{isNew?"New product":"Edit product"}</h2>
          {!isNew && (form.id || product?.id) && (
            <p className="text-[12px] mt-1" style={{color:T.muted}}>{form.name || product?.name || form.id}</p>
          )}
        </div>
        <button type="button" onClick={onClose} style={{color:"rgba(36,62,65,0.75)"}} aria-label="Close"><X size={ICON.sm}/></button>
      </div>
      {!isNew && (form.id || product?.id) && (
        <div className="px-6 py-3 flex flex-wrap items-center justify-between gap-3" style={{background:"rgba(24,54,48,0.04)",borderBottom:"1px solid rgba(36,62,65,0.08)"}}>
          <p className="text-[12.5px] leading-snug" style={{color:"rgba(36,62,65,0.7)"}}>
            Open the live product page to check images, price, and copy after you save.
          </p>
          <a
            href={`/product/${encodeURIComponent(form.id || product.id)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.1em] uppercase px-3 py-2 shrink-0"
            style={{color:T.cream,backgroundColor:T.teal,borderRadius:RADIUS.xs,border:"1px solid rgba(229,198,144,0.35)"}}
          >
            View on storefront
            <ExternalLink size={13} strokeWidth={2}/>
          </a>
        </div>
      )}
      <div className="px-6 pt-4 flex flex-wrap gap-2" style={{borderBottom:"1px solid rgba(36,62,65,0.08)"}}>
        {[
          ["basics","Basics"],
          ["media","Media"],
          ["details","Details"],
          ["seo","SEO"],
        ].map(([id,label])=>(
          <button
            key={id}
            type="button"
            onClick={()=>setEditorSection(id)}
            className="px-3 py-2 text-[11px] tracking-[0.1em] uppercase mb-[-1px]"
            style={{
              color: editorSection===id ? T.teal : T.muted,
              borderBottom: editorSection===id ? `2px solid ${T.teal}` : "2px solid transparent",
              fontWeight: editorSection===id ? 600 : 400,
              background: "transparent",
            }}
          >{label}</button>
        ))}
      </div>
      <div className="p-6 flex flex-col gap-5 max-h-[70vh] overflow-y-auto">
        {editorSection==="basics" && <div>
          <p className="text-[11px] tracking-[0.1em] uppercase mb-3" style={{color:T.teal}}>Basics</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {isNew
              ? <div>
                  <InputField label="ID (URL slug)" value={form.id} onChange={upd("id")} placeholder="auto from name"/>
                  <p className="text-[11px] mt-1.5" style={{color:"rgba(36,62,65,0.55)"}}>Fills automatically as you type the product name. Edit only if you need a custom URL — after you edit it, name changes no longer overwrite the ID.</p>
                </div>
              : <div><label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>ID (URL slug)</label>
                  <p className="text-[14px] px-3 py-3" style={{color:"rgba(36,62,65,0.75)",border:"1px solid rgba(36,62,65,0.1)",borderRadius:RADIUS.xs}}>{product.id} <span className="text-[11px]">(can't be changed)</span></p>
                </div>}
            <InputField label="Name" value={form.name} onChange={upd("name")}/>
            <div>
              <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Category</label>
              <select
                value={form.category}
                onChange={e=>upd("category")(e.target.value)}
                className="w-full text-[14px] px-3 py-3 outline-none"
                style={{border:"1px solid rgba(36,62,65,0.16)",borderRadius:RADIUS.xs,color:T.teal,backgroundColor:T.cream}}
              >
                {(() => {
                  const opts = [...(categoryOptions||[])];
                  if (form.category && !opts.includes(form.category)) opts.unshift(form.category);
                  if (!opts.length) opts.push("Planters","Vases","Ceiling Lighting","Table Lamps","Lanterns","Floor Lamps");
                  return opts.map(name => <option key={name} value={name}>{name}</option>);
                })()}
              </select>
              <p className="text-[11px] mt-1" style={{color:T.mutedSoft}}>Select from Catalog → Categories. Add new ones there if needed.</p>
            </div>
            <div className="flex flex-col gap-2" style={{border:"1px solid rgba(36,62,65,0.14)",borderRadius:RADIUS.xs,padding:"14px"}}>
              {hasRealSizes&&<div className="flex items-start gap-2 p-3 mb-1" style={{backgroundColor:"rgba(181,101,29,0.1)",borderRadius:RADIUS.xs}}>
                <AlertTriangle size={15} style={{color:T.warning,flexShrink:0,marginTop:"2px"}}/>
                <p className="text-[12px] leading-[1.6]" style={{color:T.warning}}>
                  This product has real, distinct sizes set up (Details tab) — for those specific Small/Medium/Large combinations, customers are charged the price set on that exact size, never this base price below. A colour alone, with no real size, still correctly uses this base price. Change per-size prices in the Details tab's "Size / Color / Price / Stock" list instead.
                </p>
              </div>}
              <InputField label="Base Price (₹, excl. GST)" value={form.price} onChange={v=>{
                // Real, direct edit of the base price — the round-off
                // field is updated to show the real, correctly-computed
                // inclusive figure for whatever's now in the base field,
                // but ONLY here (not via a live useEffect watching
                // form.price) — so typing into the round-off field
                // itself, which also sets form.price, never gets its
                // own, real, active keystrokes overwritten by this.
                const digits=v.replace(/\D/g,"");
                setForm(f=>({...f,price:digits}));
                if(digits!==""&&!isNaN(Number(digits))) setRoundedPriceInput(String(Math.round(Number(digits)*(1+GST_RATE_ADMIN))));
              }}/>
              <p className="text-[12px]" style={{color:realGstPreview!=null?T.teal:T.mutedSoft}}>
                {realGstPreview!=null?`Customer sees: ₹${realGstPreview.toLocaleString("en-IN")} (incl. 18% GST)`:"Enter a real base price to see the GST-inclusive customer price"}
              </p>
              <div className="mt-1 pt-3" style={{borderTop:"1px solid rgba(36,62,65,0.1)"}}>
                <InputField label="Or set the round-off price customers see (₹, incl. GST)" value={roundedPriceInput} onChange={handleRoundedPriceChange}/>
                {roundedPriceInput!==""&&realGstPreview!=null&&(
                  realGstPreview===Number(roundedPriceInput)
                    ? <p className="text-[11.5px] mt-1.5" style={{color:T.success}}>✓ The base price above will produce exactly ₹{realGstPreview.toLocaleString("en-IN")} at checkout.</p>
                    // Real, honest disclosure of the genuine ±₹1 rounding
                    // gap explained above — never silently hidden. An
                    // admin who cares about hitting the exact figure can
                    // nudge the base price by ±1 themselves; one who
                    // doesn't can leave it, since a real, one-rupee gap
                    // is immaterial to almost any real, actual sale.
                    : <p className="text-[11.5px] mt-1.5" style={{color:T.warning}}>Closest real whole-rupee price: customers will actually see ₹{realGstPreview.toLocaleString("en-IN")}, not ₹{Number(roundedPriceInput).toLocaleString("en-IN")} — whole-rupee rounding can land ±₹1 off. Adjust the base price above by 1 if you need the exact figure.</p>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-3" style={{border:"1px solid rgba(36,62,65,0.14)",borderRadius:RADIUS.xs,padding:"14px"}}>
              <p className="text-[11px] tracking-[0.08em] uppercase" style={{color:"rgba(36,62,65,0.75)"}}>What it costs to make one (₹) — never shown to customers</p>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(COST_CATEGORY_LABELS).map(([key,label])=>(
                  <InputField key={key} label={label} value={costBreakdown[key]} onChange={updCost(key)}/>
                ))}
              </div>
              <div className="pt-3 flex flex-col gap-3" style={{borderTop:"1px solid rgba(36,62,65,0.1)"}}>
                <p className="text-[13px]" style={{color:T.teal}}>Real cost to make one: <strong>₹{totalCostPerUnit.toLocaleString("en-IN")}</strong></p>
                {totalCostPerUnit>0&&(()=>{
                  const cost=totalCostPerUnit;
                  // Margin on base (excl. GST): (price - cost) / price
                  const TARGET=0.30; // aim 30%
                  const MIN=0.25;    // never go below 25%
                  const priceAtTarget=Math.ceil(cost/(1-TARGET));
                  const priceAtMin=Math.ceil(cost/(1-MIN));
                  const base=Number(form.price);
                  const hasPrice=form.price!==""&&!isNaN(base)&&base>0;
                  const marginPct=hasPrice?Math.round(((base-cost)/base)*1000)/10:null;
                  const profit=hasPrice?Math.round((base-cost)*100)/100:null;
                  const status=marginPct==null?null:marginPct<MIN*100?"below":marginPct<TARGET*100?"ok":"good";
                  const statusColor=status==="below"?T.error:status==="ok"?T.warning:T.success;
                  const statusLabel=status==="below"?"Below minimum (25%) — raise price":status==="ok"?"Above minimum, below target 30%":"Meets or exceeds 30% target";
                  const incl=p=>Math.round(p*(1+GST_RATE_ADMIN));
                  return (
                    <div className="flex flex-col gap-2.5 p-3.5" style={{background:"rgba(24,54,48,0.05)",borderRadius:RADIUS.xs,border:"1px solid rgba(24,54,48,0.1)"}}>
                      <p className="text-[11px] tracking-[0.1em] uppercase" style={{color:T.teal}}>Margin guide (excl. GST base)</p>
                      <p className="text-[12.5px] leading-relaxed" style={{color:"rgba(36,62,65,0.78)"}}>
                        Target <strong>30%</strong> · minimum <strong>25%</strong> so you can recover cost and losses.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12.5px]" style={{color:T.teal}}>
                        <div className="p-2.5" style={{background:"rgba(255,255,255,0.5)",borderRadius:6}}>
                          <p className="text-[10px] uppercase tracking-wide mb-1" style={{color:"rgba(36,62,65,0.6)"}}>Min price (25%)</p>
                          <p className="font-medium">₹{priceAtMin.toLocaleString("en-IN")} base</p>
                          <p className="text-[11px]" style={{color:"rgba(36,62,65,0.65)"}}>≈ ₹{incl(priceAtMin).toLocaleString("en-IN")} incl. GST</p>
                        </div>
                        <div className="p-2.5" style={{background:"rgba(255,255,255,0.5)",borderRadius:6}}>
                          <p className="text-[10px] uppercase tracking-wide mb-1" style={{color:"rgba(36,62,65,0.6)"}}>Target price (30%)</p>
                          <p className="font-medium">₹{priceAtTarget.toLocaleString("en-IN")} base</p>
                          <p className="text-[11px]" style={{color:"rgba(36,62,65,0.65)"}}>≈ ₹{incl(priceAtTarget).toLocaleString("en-IN")} incl. GST</p>
                        </div>
                      </div>
                      {hasPrice&&(
                        <p className="text-[13px]" style={{color:statusColor}}>
                          Current margin: <strong>{marginPct}%</strong>
                          {" "}(₹{Number(profit).toLocaleString("en-IN")} profit / unit) — {statusLabel}
                        </p>
                      )}
                      {!hasPrice&&(
                        <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.7)"}}>Enter a base price above, or apply the 30% target.</p>
                      )}
                      <button
                        type="button"
                        onClick={()=>setForm(f=>({...f,price:String(priceAtTarget)}))}
                        className="self-start text-[11px] tracking-[0.08em] uppercase px-3 py-2"
                        style={{backgroundColor:T.teal,color:T.cream,borderRadius:RADIUS.xs}}
                      >
                        Apply 30% margin price (₹{priceAtTarget.toLocaleString("en-IN")})
                      </button>
                    </div>
                  );
                })()}
              </div>
            </div>
            <div>
              <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Dimensions</label>
              <textarea value={form.dims} onChange={e=>upd("dims")(e.target.value)} rows={2}
                className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,padding:"13px 14px",color:T.teal}}/>
              <p className="text-[12px] mt-1.5 leading-relaxed" style={{color:"rgba(36,62,65,0.75)"}}>
                Default measurements for this product (e.g. <code style={{fontSize:11}}>12cm × 12cm × 25cm · 0.4kg</code>).
                If you sell Small / Medium / Large, set each size’s measurements under the <strong>Variants</strong> tab — those override this for that size on the product page.
              </p>
            </div>
            <InputField label="HSN Code" value={form.hsn} onChange={upd("hsn")}/>
            <div>
              <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Status</label>
              <select
                value={form.status}
                onChange={e=>{
                  const v=e.target.value;
                  if(v==="sold-out") setForm(f=>({...f,status:v,stockQty:"0"}));
                  else upd("status")(v);
                }}
                className="w-full text-[14px] px-3 py-[13px]"
                style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,color:T.teal}}
              >
                <option value="draft">draft</option>
                <option value="in-stock">in stock</option>
                <option value="low-stock">low stock</option>
                <option value="sold-out">sold out</option>
                <option value="pre-order">pre-order</option>
                <option value="hidden">hidden</option>
              </select>
              <p className="text-[11px] mt-1.5" style={{color:"rgba(36,62,65,0.55)"}}>Sold out sets capacity to 0 so the shop matches. Capacity still auto-adjusts in-stock / low-stock when you type a unit count.</p>
            </div>
            <div>
              <InputField label="Studio capacity (units)" value={form.stockQty} onChange={v=>upd("stockQty")(v.replace(/\D/g,""))} placeholder="e.g. 90"/>
              <p className="text-[11px] mt-1.5 leading-relaxed" style={{color: form.stockQty===""||form.stockQty==null ? T.warning : "rgba(36,62,65,0.75)"}}>
                {form.stockQty===""||form.stockQty==null
                  ? "Recommended for every live SKU. Without a number, customers only see status (no “N remaining”). Set monthly capacity e.g. 60–90."
                  : ">20 in stock · 11–20 low stock · 1–10 shows “N remaining” · 0 sold out. Max order per customer is min(5, this number)."}
              </p>
            </div>
          </div>
        </div>}
        {editorSection==="media" && <div>
          <p className="text-[11px] tracking-[0.1em] uppercase mb-3" style={{color:T.teal}}>Media</p>
          <MediaGalleryEditor productId={form.id||product?.id} category={form.category} media={media} onChange={setMedia}/>
        </div>}
        {editorSection==="details" && (
        <div className="flex flex-col gap-6">
          {!isNew && (
            <section className="p-4" style={{border:"1px solid rgba(24,54,48,0.12)",borderRadius:RADIUS.xs,background:"rgba(255,255,255,0.35)"}}>
              <p className="text-[11px] tracking-[0.12em] uppercase mb-2" style={{color:T.teal,fontWeight:600}}>Size / colour variants</p>
              <p className="text-[12.5px] mb-4 leading-relaxed" style={{color:"rgba(36,62,65,0.78)"}}>
                Optional. Add sizes (Small / Medium / Large) and colours so customers can pick them on the product page.
              </p>
              <VariantEditor productId={product.id}/>
            </section>
          )}

          <section className="p-4" style={{border:"1px solid rgba(24,54,48,0.12)",borderRadius:RADIUS.xs,background:"rgba(255,255,255,0.35)"}}>
            <p className="text-[11px] tracking-[0.12em] uppercase mb-2" style={{color:T.teal,fontWeight:600}}>Key features</p>
            <p className="text-[12.5px] mb-3 leading-relaxed" style={{color:"rgba(36,62,65,0.78)"}}>
              Short bullets on the product page (e.g. Handmade in Mumbai). Shown only when at least one is added.
            </p>
            {keyFeatures.length===0
              ? <p className="text-[13px] mb-3" style={{color:"rgba(36,62,65,0.65)"}}>None yet.</p>
              : <ul className="flex flex-col gap-2 mb-3">
                  {keyFeatures.map((f,i)=>(
                    <li key={i} className="flex items-center justify-between gap-3 px-3 py-2.5" style={{border:"1px solid rgba(36,62,65,0.14)",borderRadius:RADIUS.xs,background:T.cream}}>
                      <span className="text-[14px] leading-snug" style={{color:T.teal}}>{f}</span>
                      <button type="button" onClick={()=>removeFeature(i)} style={{color:T.error,flexShrink:0}} aria-label="Remove feature"><Trash2 size={14}/></button>
                    </li>
                  ))}
                </ul>}
            {keyFeatures.length<12 && (
              <div className="flex flex-col sm:flex-row gap-2 sm:items-stretch">
                <input value={newFeature} onChange={e=>setNewFeature(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addFeature();}}} maxLength={150} placeholder="e.g. Handmade in Mumbai"
                  className="flex-1 bg-transparent outline-none text-[14px] px-3 py-2.5 min-h-[44px]" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,color:T.teal}}/>
                <button type="button" onClick={addFeature} className="px-4 py-2.5 text-[12px] tracking-[0.06em] uppercase shrink-0" style={{border:`1px solid ${T.teal}`,borderRadius:RADIUS.xs,color:T.teal,minHeight:44}}>Add</button>
              </div>
            )}
          </section>

          <section className="p-4" style={{border:"1px solid rgba(24,54,48,0.12)",borderRadius:RADIUS.xs,background:"rgba(255,255,255,0.35)"}}>
            {/* WHAT: Optional material/finish sentence under the price on the PDP.
                WHY: Finish swatches duplicated Colours (Red/Black twice). Colours belong in Details → Variants.
                HOW: Saved as finishes[0].name text only — not a second picker.
                CONNECTED TO: ProductDetailView italic note; product.finishes JSONB. */}
            <p className="text-[11px] tracking-[0.12em] uppercase mb-2" style={{color:T.teal,fontWeight:600}}>Finish note (optional)</p>
            <p className="text-[12.5px] mb-3 leading-relaxed" style={{color:"rgba(36,62,65,0.78)"}}>
              Short line only (e.g. “Matte plant-based PLA”). Do <strong>not</strong> list Red/Black here — add those under <strong>Details → Colors</strong>.
            </p>
            <InputField
              label="Finish / material note"
              value={finishes[0]?.name || ""}
              onChange={(v)=>{
                const name=String(v||"").trim();
                setFinishes(name ? [{ name: name.slice(0, 80) }] : []);
              }}
              placeholder="Matte plant-based PLA · printed to order in Mumbai"
            />
          </section>

          <section className="p-4" style={{border:"1px solid rgba(24,54,48,0.12)",borderRadius:RADIUS.xs,background:"rgba(255,255,255,0.35)"}}>
            <p className="text-[11px] tracking-[0.12em] uppercase mb-2" style={{color:T.teal,fontWeight:600}}>Accessories note</p>
            <p className="text-[12.5px] mb-3 leading-relaxed" style={{color:"rgba(36,62,65,0.78)"}}>
              Optional — e.g. bulb holder info. Only shows on the product page when filled in.
            </p>
            <textarea value={form.accessoriesNote} onChange={e=>upd("accessoriesNote")(e.target.value)} rows={3} maxLength={1000} placeholder="e.g. Includes a standard E27 bulb holder — bulb sold separately."
              className="w-full bg-transparent outline-none text-[14px] leading-relaxed" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"12px 14px",borderRadius:RADIUS.xs,color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
          </section>
        </div>
        )}
        {editorSection==="seo" && <div>
          <p className="text-[11px] tracking-[0.1em] uppercase mb-3" style={{color:T.teal}}>Description & SEO</p>
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Description</label>
              <textarea value={form.description} onChange={e=>upd("description")(e.target.value)} rows={4} maxLength={2000}
                className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"11px 13px",borderRadius:RADIUS.xs,color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
            </div>
            <InputField label="Meta Title (SEO)" value={form.metaTitle} onChange={upd("metaTitle")}/>
            <div>
              <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Meta Description (SEO)</label>
              <textarea value={form.metaDesc} onChange={e=>upd("metaDesc")(e.target.value)} rows={2} maxLength={300}
                className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"11px 13px",borderRadius:RADIUS.xs,color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
            </div>
            <p className="text-[11.5px]" style={{color:T.muted}}>Meta title and description feed search results and the server SEO injection on product pages.</p>
          </div>
        </div>}
      </div>
      <div className="flex gap-3 justify-end px-6 py-5" style={{borderTop:"1px solid rgba(36,62,65,0.1)"}}>
        {!isNew&&<button onClick={()=>window.open(`/preview/${product.id}`,"_blank","noopener,noreferrer")} className="px-5 py-2.5 text-[12px] tracking-[0.08em] uppercase mr-auto" style={{color:T.teal,border:`1px solid ${T.teal}`,borderRadius:RADIUS.sm}}>Preview as Customer</button>}
        <button onClick={onClose} className="px-5 py-2.5 text-[12px] tracking-[0.08em] uppercase" style={{color:T.teal,border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.sm}}>Cancel</button>
        <SweepButton filled onClick={save} disabled={saving}>{saving?"Saving…":isNew?"Create Product":"Save Changes"}</SweepButton>
      </div>
    </div>
  </div>;
}

// ============================================================================
// MEDIA MANAGER — a dedicated screen for exactly one job: get to the
// right product's photo gallery as fast as possible, without opening
// the full product editor (name/price/description/SEO) just to add a
// photo. Category filter narrows the list first, then the actual
// product search/select — the two-step flow asked for directly,
// since hunting through all ~30+ products in one flat list to find
// "the Vayu one" is exactly the friction this exists to remove.
// Deliberately thin: reuses MediaGalleryEditor completely unchanged
// (the same, already-proven upload/reorder/remove logic products
// already use) and saves through the exact same PUT endpoint the full
// editor does — a second, separate save path here would risk quietly
// drifting from what the real editor does over time.
// ============================================================================
// PHASE 3 — FEATURED PRODUCTS. Real, deliberate curation for the
// homepage's "Featured pieces" section — replaces what used to just be
// PRODUCTS.slice(0,3), the first 3 rows in database order, never
// actually a genuine choice. Two lists: everything currently featured
// (reorderable, removable) and everything NOT featured yet (add with
// one click). Saves the WHOLE list at once via PUT /featured — see
// that endpoint's own comment for why a bulk save is safer here than
// per-item edits for a reordering operation.


function AdminHeroBackground(){
  const showToast=useToast();
  const [imageUrl,setImageUrl]=useState("");
  const [defaultUrl,setDefaultUrl]=useState("/images/hero-home.jpg");
  const [copy,setCopy]=useState({eyebrow:"",heading:"",subtext:"",ctaLabel:"",ctaLabel2:""});
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [savingCopy,setSavingCopy]=useState(false);
  const [uploading,setUploading]=useState(false);
  const fileRef=useRef(null);
  const load=()=>{
    setLoading(true);
    Promise.all([
      fetch("/api/admin/settings/hero-background",{credentials:"include"}).then(r=>r.json()),
      fetch("/api/admin/settings/hero-copy",{credentials:"include"}).then(r=>r.json()),
    ]).then(([bg, hc])=>{
      setImageUrl(bg.imageUrl||"");
      setDefaultUrl(bg.defaultUrl||"/images/hero-home.jpg");
      if(hc?.copy) setCopy(hc.copy);
    }).catch(()=>showToast("Couldn't load homepage hero settings.","error"))
    .finally(()=>setLoading(false));
  };
  useEffect(()=>{ load(); },[]);
  const preview=imageUrl||defaultUrl;
  const saveBg=async(url)=>{
    setSaving(true);
    try{
      const res=await apiFetch("/api/admin/settings/hero-background",{
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ imageUrl: url }),
      });
      const data=await res.json().catch(()=>({}));
      if(res.ok){ setImageUrl(data.imageUrl||""); showToast(data.imageUrl?"Hero image saved":"Reset to default hero image","success"); }
      else showToast(data.error||"Couldn't save image.","error");
    }catch{ showToast("Couldn't reach the server.","error"); }
    finally{ setSaving(false); }
  };
  const saveCopy=async()=>{
    setSavingCopy(true);
    try{
      const res=await apiFetch("/api/admin/settings/hero-copy",{
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(copy),
      });
      const data=await res.json().catch(()=>({}));
      if(res.ok){ setCopy(data.copy||copy); showToast("Homepage statements saved — live immediately","success"); }
      else showToast(data.error||"Couldn't save statements.","error");
    }catch{ showToast("Couldn't reach the server.","error"); }
    finally{ setSavingCopy(false); }
  };
  const onUpload=async e=>{
    const file=e.target.files?.[0];
    if(!file) return;
    if(!file.type.startsWith("image/")){ showToast("Choose an image file.","error"); return; }
    setUploading(true);
    try{
      const fd=new FormData();
      fd.append("file",file);
      const res=await apiFetch("/api/admin/products/media/upload",{ method:"POST", body:fd });
      const data=await res.json().catch(()=>({}));
      if(!res.ok){ showToast(data.error||"Upload failed.","error"); return; }
      const url=data.url||data.src;
      if(!url){ showToast("Upload succeeded but no URL returned.","error"); return; }
      setImageUrl(url);
      await saveBg(url);
    }catch{ showToast("Upload failed.","error"); }
    finally{ setUploading(false); if(fileRef.current) fileRef.current.value=""; }
  };
  return <div className="p-5 md:p-8 max-w-[720px] mx-auto w-full">
    <AdminPageHeader
      eyebrow="Catalog"
      title="Homepage hero"
      info="Full-bleed hero image and overlay copy on the customer homepage. Edits go live after save — no redeploy."
      subtitle="Still photo and the statements over it (eyebrow, “Let there be form”, subtext, buttons). Changes go live without a redeploy."
    />
    {loading?<Skeleton height={200}/>:
    <div className="flex flex-col gap-8">
      <section>
        <p className="text-[11px] tracking-[0.12em] uppercase mb-3" style={{color:T.teal}}>Statements (editable anytime)</p>
        <p className="text-[12.5px] mb-4" style={{color:"rgba(36,62,65,0.7)"}}>Heading tips: use <code className="text-[12px]">&lt;br/&gt;</code> for a line break; wrap a word in <code className="text-[12px]">**word**</code> for gold emphasis.</p>
        <div className="flex flex-col gap-3 p-4" style={ATELIER_PANEL}>
          <InputField label="Eyebrow" value={copy.eyebrow} onChange={v=>setCopy(c=>({...c,eyebrow:v}))} placeholder="Est. Mumbai · Made to Order"/>
          <InputField label="Heading" value={copy.heading} onChange={v=>setCopy(c=>({...c,heading:v}))} placeholder="Let there<br/>be **form**."/>
          <div>
            <label className="block text-[11px] tracking-[0.08em] uppercase mb-1.5" style={{color:T.muted}}>Subtext</label>
            <textarea value={copy.subtext} onChange={e=>setCopy(c=>({...c,subtext:e.target.value}))} rows={3} className="w-full text-[14px] px-3 py-2.5" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs,color:T.teal,background:"transparent"}}/>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InputField label="Primary button" value={copy.ctaLabel} onChange={v=>setCopy(c=>({...c,ctaLabel:v}))} placeholder="Explore the Collection"/>
            <InputField label="Secondary button" value={copy.ctaLabel2} onChange={v=>setCopy(c=>({...c,ctaLabel2:v}))} placeholder="Our Story"/>
          </div>
          <SweepButton type="button" filled onClick={saveCopy} disabled={savingCopy}>{savingCopy?"Saving…":"Save statements"}</SweepButton>
        </div>
      </section>
      <section>
        <p className="text-[11px] tracking-[0.12em] uppercase mb-3" style={{color:T.teal}}>Background photo</p>
        <div className="overflow-hidden relative mb-4" style={{aspectRatio:"16/9",borderRadius:0,boxShadow:"none",backgroundColor:"rgba(247,243,235,0.8)",border:"1px solid rgba(24,54,48,0.1)"}}>
          <img src={preview} alt="Hero preview" className="w-full h-full object-cover"/>
          <div className="absolute inset-0" style={{background:"linear-gradient(to top, rgba(24,54,48,0.7) 0%, rgba(24,54,48,0.35) 100%)"}}/>
          <p className="absolute bottom-4 left-4 right-4 text-center text-[13px] italic" style={{fontFamily:"'Fraunces',serif",color:"#E3DAC9"}}>Preview with scrim</p>
        </div>
        <p className="text-[12.5px] mb-3" style={{color:"rgba(36,62,65,0.75)"}}>Recommended landscape ~2400×1400+. Default: <code className="text-[12px]">/images/hero-home.jpg</code></p>
        <div className="flex flex-wrap gap-3 mb-3">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onUpload}/>
          <SweepButton type="button" filled onClick={()=>fileRef.current?.click()} disabled={uploading||saving}>{uploading?"Uploading…":"Upload new photo"}</SweepButton>
          <SweepButton type="button" onClick={()=>saveBg("")} disabled={saving||!imageUrl}>Reset to default</SweepButton>
        </div>
        <label className="block text-[11px] tracking-[0.08em] uppercase mb-1.5" style={{color:T.muted}}>Or paste image URL</label>
        <input value={imageUrl} onChange={e=>setImageUrl(e.target.value)} placeholder={defaultUrl}
          className="w-full text-[14px] px-3 py-2.5 mb-3" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs,color:T.teal}}/>
        <SweepButton type="button" filled onClick={()=>saveBg(imageUrl)} disabled={saving}>{saving?"Saving…":"Save image URL"}</SweepButton>
      </section>
      <p className="text-[12px]" style={{color:"rgba(36,62,65,0.55)"}}>Also available under System → Site Content → <strong>Homepage Hero</strong> (same data).</p>
    </div>}
  </div>;
}

function AdminRoomStories(){
  const showToast=useToast();
  const [boards,setBoards]=useState([]);
  const [products,setProducts]=useState([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const load=()=>{
    setLoading(true);
    Promise.all([
      fetch("/api/admin/settings/room-stories",{credentials:"include"}).then(r=>r.json()),
      fetch("/api/admin/products",{credentials:"include"}).then(r=>r.json()),
    ]).then(([b,p])=>{
      setBoards(Array.isArray(b.boards)?b.boards:[]);
      setProducts((p.products||[]).filter(x=>x.status!=="draft"&&x.status!=="hidden"));
    }).catch(()=>showToast("Couldn't load room stories.","error"))
     .finally(()=>setLoading(false));
  };
  useEffect(()=>{ load(); },[]);
  const byId=id=>products.find(p=>p.id===id);
  const addBoard=()=>{
    if(boards.length>=12){ showToast("Maximum 12 boards.","error"); return; }
    setBoards(b=>[...b,{ id:"board-"+Date.now(), title:"New board", blurb:"", productIds:[], active:true }]);
  };
  const updateBoard=(id,patch)=>setBoards(b=>b.map(x=>x.id===id?{...x,...patch}:x));
  const removeBoard=id=>setBoards(b=>b.filter(x=>x.id!==id));
  const setProductSlot=(boardId,slot,productId)=>{
    setBoards(b=>b.map(x=>{
      if(x.id!==boardId) return x;
      const ids=[...(x.productIds||[])];
      while(ids.length<slot+1) ids.push("");
      ids[slot]=productId||"";
      return {...x, productIds: ids.filter((v,i)=>i<2).map(String)};
    }));
  };
  const save=async()=>{
    setSaving(true);
    try{
      const res=await apiFetch("/api/admin/settings/room-stories",{
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ boards: boards.map(b=>({
          id:b.id,
          title:b.title,
          blurb:b.blurb,
          productIds:(b.productIds||[]).filter(Boolean).slice(0,2),
          active:b.active!==false,
        })) }),
      });
      const data=await res.json().catch(()=>({}));
      if(res.ok){ setBoards(data.boards||boards); showToast("Room stories saved","success"); }
      else showToast(data.error||"Couldn't save.","error");
    }catch{ showToast("Couldn't reach the server.","error"); }
    finally{ setSaving(false); }
  };
  return <div className="p-5 md:p-8 max-w-[960px] mx-auto w-full">
    <AdminPageHeader
      eyebrow="Catalog"
      title="Room stories"
      info="Homepage room boards you curate (title, blurb, products). Not automatic — only what you assign appears."
      subtitle="Homepage boards under “Pieces that live together.” Choose title, blurb, and up to two products per board."
      actions={
        <>
          <SweepButton type="button" onClick={addBoard}>Add board</SweepButton>
          <SweepButton type="button" filled onClick={save} disabled={saving}>{saving?"Saving…":"Save all"}</SweepButton>
        </>
      }
    />
    {loading?<Skeleton height={160}/>:
    boards.length===0?<EmptyState icon={Layers} title="No room stories yet" message="Add a board, pick up to two products, then Save. Until you save at least one, the homepage section stays empty." actionLabel="Add board" onAction={addBoard}/>:
    <div className="flex flex-col gap-5">
      {boards.map((b, idx)=>(
        <div key={b.id} className="p-4 md:p-6" style={{...ATELIER_PANEL, opacity:b.active===false?0.55:1}}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3" style={{borderBottom:"1px solid rgba(24,54,48,0.08)"}}>
            <p className="text-[11px] tracking-[0.14em] uppercase" style={{color:T.muted}}>Board {idx+1}</p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" style={{color:T.teal}}>
                <input type="checkbox" checked={b.active!==false} onChange={e=>updateBoard(b.id,{active:e.target.checked})}/>
                Active on homepage
              </label>
              <button type="button" onClick={()=>removeBoard(b.id)} className="text-[12px] uppercase tracking-[0.06em] px-3 py-1.5"
                style={{color:T.error,border:"1px solid rgba(168,59,50,0.3)",borderRadius:8,background:"transparent"}}>Remove</button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[11px] tracking-[0.08em] uppercase mb-1.5" style={{color:T.muted}}>Title</label>
              <input value={b.title} onChange={e=>updateBoard(b.id,{title:e.target.value})} placeholder="Board title"
                className="w-full text-[15px] px-3 py-2.5" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs,color:T.teal,fontFamily:"'Fraunces',serif"}}/>
            </div>
            <div>
              <label className="block text-[11px] tracking-[0.08em] uppercase mb-1.5" style={{color:T.muted}}>Blurb</label>
              <input value={b.blurb||""} onChange={e=>updateBoard(b.id,{blurb:e.target.value})} placeholder="Short blurb"
                className="w-full text-[13px] px-3 py-2.5" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs,color:T.teal}}/>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[0,1].map(slot=>(
              <div key={slot}>
                <label className="block text-[11px] tracking-[0.08em] uppercase mb-1.5" style={{color:T.muted}}>Product {slot+1}</label>
                <select value={(b.productIds&&b.productIds[slot])||""} onChange={e=>setProductSlot(b.id,slot,e.target.value)}
                  className="w-full text-[13px] px-3 py-2.5 min-h-[44px]" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs,color:T.teal}}>
                  <option value="">— None —</option>
                  {products.map(pr=><option key={pr.id} value={pr.id}>{pr.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[12.5px] pt-1" style={{color:T.muted}}>Edits are draft until you press <strong style={{color:T.teal}}>Save all</strong> in the header.</p>
    </div>}
  </div>;
}

function AdminFeaturedProducts(){
  const showToast=useToast();
  const [products,setProducts]=useState([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [featuredIds,setFeaturedIds]=useState([]);

  useEffect(()=>{
    fetch("/api/admin/products",{credentials:"include"}).then(r=>r.json()).then(d=>{
      const list=d.products||[];
      setProducts(list);
      setFeaturedIds(list.filter(p=>p.featured_order!=null).sort((a,b)=>a.featured_order-b.featured_order).map(p=>p.id));
      setLoading(false);
    });
  },[]);

  const byId=id=>products.find(p=>p.id===id);
  const notFeatured=products.filter(p=>!featuredIds.includes(p.id));
  const moveUp=i=>{ if(i===0) return; const next=[...featuredIds]; [next[i-1],next[i]]=[next[i],next[i-1]]; setFeaturedIds(next); };
  const moveDown=i=>{ if(i===featuredIds.length-1) return; const next=[...featuredIds]; [next[i],next[i+1]]=[next[i+1],next[i]]; setFeaturedIds(next); };
  const addFeatured=id=>{ if(featuredIds.length>=12){ showToast("Max 12 featured products — remove one first.","error"); return; } setFeaturedIds(f=>[...f,id]); };
  const removeFeatured=id=>setFeaturedIds(f=>f.filter(x=>x!==id));

  const save=async()=>{
    setSaving(true);
    try{
      const res=await apiFetch("/api/admin/products/featured",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({productIds:featuredIds})});
      const data=await res.json().catch(()=>({}));
      if(res.ok) showToast("Featured products saved","success");
      else showToast(data.error||"Couldn't save.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setSaving(false);
    }
  };

  return <div className="p-5 md:p-8 max-w-[900px]">
    <AdminPageHeader
      eyebrow="Catalog"
      title="Featured products"
      info="Magazine spread on the homepage. Drag order, save — reflected on the storefront after refresh."
      subtitle="Pieces on the storefront magazine spread — drag order, then save."
      actions={<SweepButton filled onClick={save} disabled={saving}>{saving?"Saving…":"Save changes"}</SweepButton>}
    />
    <p className="text-[13.5px] mb-6" style={{color:"rgba(36,62,65,0.75)"}}>Shown in this order on the homepage magazine: #1 is the large hero; #2 onwards all appear in the grid below (up to 12). Save after reordering.</p>

    {loading?<Skeleton height={200}/>:<>
      <p className="text-[11px] tracking-[0.1em] uppercase mb-3" style={{color:"rgba(36,62,65,0.75)"}}>Currently Featured ({featuredIds.length})</p>
      {featuredIds.length===0
        ? <p className="text-[12.5px] mb-8" style={{color:"rgba(36,62,65,0.75)"}}>Nothing featured yet — the homepage section stays hidden until you add at least one product below.</p>
        : <div className="flex flex-col gap-2 mb-8">
            {featuredIds.map((id,i)=>{ const p=byId(id); if(!p) return null; return <div key={id} className="flex items-center gap-3 p-3" style={ATELIER_ROW}>
              <span className="text-[12px] w-5 text-center" style={{color:"rgba(36,62,65,0.75)"}}>{i+1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] truncate" style={{color:T.teal}}>{p.name}</p>
                <p className="text-[11px]" style={{color:"rgba(36,62,65,0.75)"}}>{p.category} · ₹{p.price}</p>
              </div>
              <button type="button" onClick={()=>moveUp(i)} disabled={i===0} style={{color:"rgba(36,62,65,0.75)",opacity:i===0?0.3:1}}><ChevronLeft size={16} style={{transform:"rotate(90deg)"}}/></button>
              <button type="button" onClick={()=>moveDown(i)} disabled={i===featuredIds.length-1} style={{color:"rgba(36,62,65,0.75)",opacity:i===featuredIds.length-1?0.3:1}}><ChevronRight size={16} style={{transform:"rotate(90deg)"}}/></button>
              <button type="button" onClick={()=>removeFeatured(id)} style={{color:T.error}}><Trash2 size={15}/></button>
            </div>;})}
          </div>}

      <p className="text-[11px] tracking-[0.1em] uppercase mb-3" style={{color:"rgba(36,62,65,0.75)"}}>Add a Product</p>
      <div className="flex flex-col gap-2">
        {notFeatured.length===0
          ? <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.75)"}}>Every product is already featured.</p>
          : notFeatured.map(p=><div key={p.id} className="flex items-center gap-3 p-3" style={{border:"1px solid rgba(36,62,65,0.14)",borderRadius:RADIUS.sm}}>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] truncate" style={{color:T.teal}}>{p.name}</p>
                <p className="text-[11px]" style={{color:"rgba(36,62,65,0.75)"}}>{p.category} · ₹{p.price}</p>
              </div>
              <button type="button" onClick={()=>addFeatured(p.id)} className="px-3 py-1.5 text-[11px] uppercase tracking-[0.06em]" style={{border:`1px solid ${T.teal}`,borderRadius:RADIUS.xs,color:T.teal}}>Add</button>
            </div>)}
      </div>
    </>}
  </div>;
}

function AdminMediaManager(){
  const showToast=useToast();
  const [products,setProducts]=useState([]);
  const [loading,setLoading]=useState(true);
  const [categoryFilter,setCategoryFilter]=useState("All");
  const [search,setSearch]=useState("");
  const [selectedId,setSelectedId]=useState("");
  const [media,setMedia]=useState([]);
  const [saving,setSaving]=useState(false);

  useEffect(()=>{
    fetch("/api/admin/products",{credentials:"include"}).then(r=>r.json()).then(d=>{
      setProducts(d.products||[]);
      setLoading(false);
    });
  },[]);

  const categories=["All",...new Set(products.map(p=>p.category))].filter(Boolean);
  const filtered=products.filter(p=>
    (categoryFilter==="All"||p.category===categoryFilter) &&
    (search.trim()===""||p.name.toLowerCase().includes(search.trim().toLowerCase())||p.id.includes(search.trim().toLowerCase()))
  );
  const selected=products.find(p=>p.id===selectedId);

  const selectProduct=id=>{
    setSelectedId(id);
    const p=products.find(x=>x.id===id);
    setMedia(Array.isArray(p?.media)?p.media:[]);
  };

  const save=async()=>{
    setSaving(true);
    try{
      const res=await apiFetch(`/api/admin/products/${selectedId}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({media})});
      const data=await res.json().catch(()=>({}));
      if(res.ok){
        showToast("Gallery saved","success");
        setProducts(ps=>ps.map(p=>p.id===selectedId?{...p,media}:p));
      } else showToast(data.error||"Couldn't save the gallery.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setSaving(false);
    }
  };

  return <div className="p-5 md:p-8 max-w-[900px]">
    <AdminPageHeader eyebrow="Catalog" title="Media"
      info="Upload product photos/videos. Images are auto-framed to 4∶5 on cream so grids stay consistent." subtitle="Upload and attach photos and videos to products." />
    <p className="text-[13.5px] mb-6" style={{color:"rgba(36,62,65,0.75)"}}>Pick a category, then a product, to upload photos and videos directly to it — no need to open the full product editor.</p>

    {loading?<Skeleton height={44}/>:<>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Category</label>
          <select value={categoryFilter} onChange={e=>{setCategoryFilter(e.target.value);setSelectedId("");setMedia([]);}} className="w-full bg-transparent outline-none text-[13.5px] px-3 py-2.5" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,color:T.teal}}>
            {categories.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Product</label>
          <select value={selectedId} onChange={e=>selectProduct(e.target.value)} className="w-full bg-transparent outline-none text-[13.5px] px-3 py-2.5" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,color:T.teal}}>
            <option value="">Select a product…</option>
            {filtered.map((p,pi)=><option key={p.id} value={p.id}>{p.name} ({p.media?.length||0} media)</option>)}
          </select>
        </div>
      </div>
      <div className="mb-6">
        <InputField label="Or search by name / ID" value={search} onChange={setSearch} placeholder="e.g. vayu, aether, aether-pendant-lamp"/>
      </div>

      {selected&&<div className="p-5" style={ATELIER_PANEL}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <p className="text-[15px]" style={{color:T.teal}}>{selected.name}</p>
            <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}>{selected.category} · {selected.id}</p>
          </div>
          <SweepButton filled onClick={save} disabled={saving}>{saving?"Saving…":"Save Gallery"}</SweepButton>
        </div>
        <MediaGalleryEditor productId={selected.id} category={selected.category} media={media} onChange={setMedia}/>
      </div>}
    </>}
  </div>;
}

function AdminProducts(){
  const showToast=useToast();
  const [products,setProducts]=useState([]); const [loading,setLoading]=useState(true);
  const [editorTarget,setEditorTarget]=useState(null); // null = closed, {isNew:true} = create, product object = edit
  const [deleteTarget,setDeleteTarget]=useState(null);
  // Filter by status — added because scrolling through every product to
  // find, say, all drafts becomes genuinely unworkable as the catalog
  // grows, especially now that status covers 6 different states rather
  // than just stock level.
  const [statusFilter,setStatusFilter]=useState("all");
  const [listSearch,setListSearch]=useState("");
  const [listSort,setListSort]=useState("name-asc");
  const load=()=>{ setLoading(true); fetch("/api/admin/products",{credentials:"include"}).then(r=>r.json()).then(d=>setProducts(d.products||[])).finally(()=>setLoading(false)); };
  useEffect(load,[]);
  const confirmDelete=async()=>{
    const res=await apiFetch(`/api/admin/products/${deleteTarget}`,{method:"DELETE"});
    if(res.ok){ load(); showToast("Product deleted","success"); }
    else showToast("Couldn't delete that product.","error");
  };
  const filtered=(()=>{
    let list=statusFilter==="all"?products:products.filter(p=>p.status===statusFilter);
    const q=listSearch.trim().toLowerCase();
    if(q) list=list.filter(p=>[p.name,p.category,p.id,p.status].some(x=>String(x||"").toLowerCase().includes(q)));
    list=[...list];
    if(listSort==="name-asc") list.sort((a,b)=>cmpStr(a.name,b.name));
    else if(listSort==="name-desc") list.sort((a,b)=>cmpStr(b.name,a.name));
    else if(listSort==="category") list.sort((a,b)=>cmpStr(a.category,b.category)||cmpStr(a.name,b.name));
    else if(listSort==="price-asc") list.sort((a,b)=>cmpNum(a.price,b.price));
    else if(listSort==="price-desc") list.sort((a,b)=>cmpNum(b.price,a.price));
    else if(listSort==="status") list.sort((a,b)=>cmpStr(a.status,b.status)||cmpStr(a.name,b.name));
    else if(listSort==="newest") list.sort((a,b)=>cmpStr(b.updated_at||b.created_at,a.updated_at||a.created_at));
    return list;
  })();
  // Live SKUs without studio capacity — computed outside JSX (avoids ternary+IIFE parse errors)
  const missingStockCount = filtered.filter(
    (pr) => pr.stock_qty == null && pr.stockQty == null && pr.status !== "draft" && pr.status !== "hidden"
  ).length;

  // Automated category audit (server-side heuristics: lamp under Planters, etc.)
  const [catAudit, setCatAudit] = useState(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/admin/products/category-audit")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setCatAudit(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [products]);

  return <div className="p-5 md:p-8">
    <AdminPageHeader
      eyebrow="Catalog"
      title="Products"
      info="Master catalogue: status, stock qty, cost fields, variants, and media. Stock drives low-stock and sold-out on the shop."
      subtitle="Collection ledger — form, status, stock, and media for every piece. Set studio capacity on every live SKU."
      actions={<SweepButton filled onClick={()=>setEditorTarget({isNew:true})}><span className="flex items-center gap-2"><PlusCircle size={ICON.sm}/> New product</span></SweepButton>}
    />
    {catAudit && catAudit.summary && catAudit.summary.issueCount > 0 && (
      <div className="mb-6 p-4" style={{backgroundColor:"rgba(181,101,29,0.1)",border:"1px solid rgba(181,101,29,0.28)",borderRadius:8}}>
        <p className="text-[12.5px] font-medium mb-1" style={{color:T.warning}}>
          Category audit · {catAudit.summary.issueCount} issue{catAudit.summary.issueCount!==1?"s":""}
          {catAudit.summary.conflicts ? ` · ${catAudit.summary.conflicts} mismatch${catAudit.summary.conflicts!==1?"es":""}` : ""}
          {catAudit.summary.missingCategory ? ` · ${catAudit.summary.missingCategory} missing category` : ""}
        </p>
        <p className="text-[12px] mb-3" style={{color:"rgba(36,62,65,0.7)"}}>
          Automated check: product name/id vs assigned category (e.g. a lamp listed under Planters). Open each product and set the correct category.
        </p>
        <ul className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
          {(catAudit.issues||[]).slice(0,12).map((iss) => (
            <li key={iss.id} className="text-[12.5px] flex flex-wrap gap-x-2 gap-y-0.5">
              <button type="button" className="underline text-left" style={{color:T.teal}}
                onClick={() => {
                  const p = products.find((x) => x.id === iss.id);
                  if (p) setEditorTarget(p);
                }}>{iss.name || iss.id}</button>
              <span style={{color:"rgba(36,62,65,0.55)"}}>{iss.reason}</span>
              {iss.suggested && (
                <span style={{color:T.teal}}>→ {iss.suggested}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    )}
    {!loading&&products.length>0&&<div className="flex flex-wrap gap-2 mb-6">
      {["all",...STATUS_OPTIONS].map(s=>{
        const count=s==="all"?products.length:products.filter(p=>p.status===s).length;
        const active=statusFilter===s;
        return <button key={s} type="button" onClick={()=>setStatusFilter(s)}
          className="px-3.5 py-1.5 text-[11px] tracking-[0.08em] uppercase transition-colors"
          style={atelierChipStyle(active)}>
          {s==="all"?"All":s} ({count})
        </button>;
      })}
    </div>}
    {!loading&&products.length>0&&(
      <AdminListControls
        search={listSearch} setSearch={setListSearch}
        searchPlaceholder="Search name, category, or id…"
        sort={listSort} setSort={setListSort}
        sortOptions={[
          ["name-asc","Name A–Z"],["name-desc","Name Z–A"],
          ["category","Category"],["price-asc","Price low–high"],["price-desc","Price high–low"],
          ["status","Status"],["newest","Recently updated"],
        ]}
      />
    )}
    {/* REAL BUG FIX, found directly from a real, live screenshot: on
        desktop this explicitly zeroed out the real gap between rows
        (md:gap-0) and switched to a block layout, relying only on each
        row's own 2px margin-bottom as real spacing — genuinely too
        small to read as a real, visible gap, especially with each
        row's own drop shadow blending into its neighbour's. Now uses
        the same real, consistent gap-3 spacing already used correctly
        elsewhere in this admin panel (e.g. the Orders list), on every
        real screen size, not just mobile. */}
    {loading ? (
      <div className="flex flex-col gap-3">{[0,1,2,3].map(i=><Skeleton key={i} height={52} radius={RADIUS.sm}/>)}</div>
    ) : products.length === 0 ? (
      <EmptyState icon={Package} title="No products yet" message="Create your first product to get started." actionLabel="New Product" onAction={()=>setEditorTarget({isNew:true})}/>
    ) : filtered.length === 0 ? (
      <EmptyState icon={Package} title={listSearch.trim()?`No matches for “${listSearch.trim()}”`:`No ${statusFilter} products`} message={listSearch.trim()?"Clear search or try another term.":"Try a different filter, or clear it to see everything."} actionLabel={listSearch.trim()?"Clear search":"Show All"} onAction={()=>{ setListSearch(""); setStatusFilter("all"); }}/>
    ) : (
      <div>
        {missingStockCount > 0 && (
          <p className="text-[12.5px] mb-2 px-3 py-2" style={{backgroundColor:"rgba(181,101,29,0.1)",color:T.warning,borderRadius:8}}>
            {missingStockCount} live product{missingStockCount !== 1 ? "s" : ""} without studio capacity — open each and set Stock quantity so customers see remaining units correctly.
          </p>
        )}
        <div className="flex flex-col gap-3" style={{backgroundColor:"transparent"}}>
          {filtered.map((p, pi) => (
            <div key={p.id} className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 py-4 md:py-3.5" style={ATELIER_ROW}>
              <span className="text-[10px] tracking-[0.12em] hidden md:inline shrink-0 w-8" style={{color:"rgba(24,54,48,0.45)"}}>{String(pi+1).padStart(2,"0")}</span>
              <span className="flex-1 text-[14px]" style={{color:T.teal}}>{p.name}</span>
              <div className="flex items-center justify-between md:contents">
                <span className="text-[12.5px] md:w-20" style={{color:"rgba(36,62,65,0.75)"}}>{p.category}</span>
                <span className="text-[14px] md:w-20" style={{color:T.teal}}>₹{p.price}</span>
                <span className="text-[12px] md:w-24 tabular-nums" title="Studio capacity (stock_qty)" style={{color: (p.stock_qty!=null||p.stockQty!=null) ? T.teal : T.warning}}>
                  {(p.stock_qty!=null||p.stockQty!=null) ? `Qty ${p.stock_qty??p.stockQty}` : "Qty —"}
                </span>
              </div>
              <div className="flex items-center justify-between md:contents">
                <Badge variant={STATUS_BADGE_VARIANT[p.status]||"warning"}>{p.status}</Badge>
                <div className="flex gap-3">
                  <button type="button" onClick={()=>setEditorTarget(p)} style={{color:T.teal}}><Pencil size={ICON.sm}/></button>
                  <button type="button" onClick={()=>setDeleteTarget(p.id)} style={{color:T.error}}><Trash2 size={ICON.sm}/></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}
    {editorTarget&&<ProductEditorPanel product={editorTarget} onClose={()=>setEditorTarget(null)} onSaved={()=>{ setEditorTarget(null); load(); }}/>}
    <Modal open={!!deleteTarget} onClose={()=>setDeleteTarget(null)} title="Delete this product?" danger confirmLabel="Delete" onConfirm={confirmDelete}>
      This removes "{deleteTarget}" permanently — it can't be undone, and it will disappear from the live site immediately.
    </Modal>
  </div>;
}

// Mirrors ALLOWED_TRANSITIONS in server/routes/admin/orders.js exactly —
// the backend is the real, enforced source of truth (this can't bypass
// it, only reflect it), but showing every status regardless of the
// order's current one meant an admin could pick something the backend
// would then silently reject, with no explanation of why or what the
// actual valid options were. Now the dropdown itself only ever offers
// choices that will genuinely succeed.
const FULFILLMENT_STEPS = [
  { key: "confirmed", label: "Confirmed" },
  { key: "production", label: "Production" },
  { key: "qc", label: "QC" },
  { key: "dispatched", label: "Dispatched" },
  { key: "delivered", label: "Delivered" },
];
const FULFILLMENT_RANK = { confirmed: 0, production: 1, qc: 2, dispatched: 3, delivered: 4, cancelled: -1 };

/** Visual path of an order through the atelier — for admin cards */
function OrderFulfillmentTimeline({ status, placedAt, updatedAt }) {
  if (status === "cancelled") {
    return (
      <div className="mt-3 px-3 py-2.5" style={{ backgroundColor: "rgba(168,59,50,0.08)", borderRadius: RADIUS.sm, border: "1px solid rgba(168,59,50,0.2)" }}>
        <p className="text-[11px] tracking-[0.1em] uppercase" style={{ color: T.error }}>Cancelled</p>
        {updatedAt ? <p className="text-[12px] mt-0.5" style={{ color: T.muted }}>{new Date(updatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p> : null}
      </div>
    );
  }
  const rank = FULFILLMENT_RANK[status] ?? 0;
  return (
    <div className="mt-3 pt-3" style={{ borderTop: "1px solid rgba(24,54,48,0.08)" }}>
      <div className="flex items-start justify-between gap-1">
        {FULFILLMENT_STEPS.map((step, i) => {
          const done = rank > i;
          const current = rank === i;
          return (
            <div key={step.key} className="flex-1 flex flex-col items-center min-w-0">
              <div className="flex items-center w-full">
                {i > 0 && (
                  <div className="flex-1 h-[2px]" style={{ backgroundColor: rank >= i ? T.teal : "rgba(24,54,48,0.12)" }} />
                )}
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: done || current ? T.teal : "rgba(24,54,48,0.15)",
                    boxShadow: current ? `0 0 0 3px rgba(24,54,48,0.18)` : "none",
                  }}
                />
                {i < FULFILLMENT_STEPS.length - 1 && (
                  <div className="flex-1 h-[2px]" style={{ backgroundColor: rank > i ? T.teal : "rgba(24,54,48,0.12)" }} />
                )}
              </div>
              <p
                className="text-[9px] md:text-[10px] tracking-[0.06em] uppercase mt-1.5 text-center leading-tight px-0.5"
                style={{ color: current ? T.teal : done ? T.muted : "rgba(24,54,48,0.4)", fontWeight: current ? 600 : 400 }}
              >
                {step.label}
              </p>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2">
        {placedAt ? (
          <p className="text-[11px]" style={{ color: T.muted }}>
            Placed {new Date(placedAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        ) : null}
        {updatedAt && rank > 0 ? (
          <p className="text-[11px]" style={{ color: T.muted }}>
            Updated {new Date(updatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </p>
        ) : null}
      </div>
    </div>
  );
}


const ORDER_STATUS_TRANSITIONS={
  confirmed:["production","cancelled"],
  production:["qc","cancelled"],
  qc:["production","dispatched","cancelled"],
  dispatched:["delivered","cancelled"],
  delivered:[],
  cancelled:[],
};
function AdminOrders(){
  const showToast=useToast();
  const [orders,setOrders]=useState([]); const [loading,setLoading]=useState(true);
  const [expandedOrders,setExpandedOrders]=useState({}); // orderNumber -> bool
  const toggleOrder=n=>{
    setExpandedOrders(m=>{
      const opening=!m[n];
      if(opening){
        // Mark this order as "read" for the badge — use its placed time so refresh does not revive the count.
        try{
          const o=orders.find(x=>x.orderNumber===n);
          const placedMs=o?.placedAt?new Date(o.placedAt).getTime():(o?.createdAt?new Date(o.createdAt).getTime():Date.now());
          const SEEN_KEY="akara_admin_orders_seen_ms";
          const prev=Number(localStorage.getItem(SEEN_KEY)||"0")||0;
          // Advance watermark to this order's time (and not past "now") so concurrent newer orders still badge.
          const next=Math.max(prev, Math.min(placedMs||0, Date.now()) || Date.now());
          localStorage.setItem(SEEN_KEY,String(next));
          // Notify shell if same tab (custom event)
          window.dispatchEvent(new CustomEvent("akara-admin-orders-seen",{detail:{seen:next}}));
        }catch{}
      }
      return {...m,[n]:!m[n]};
    });
  };
  const [cancelTarget,setCancelTarget]=useState(null);
  const [refundTarget,setRefundTarget]=useState(null);
  const [refundAmount,setRefundAmount]=useState("");
  const [refundReason,setRefundReason]=useState("");
  const [refunding,setRefunding]=useState(false);
  const load=()=>{ setLoading(true); fetch("/api/admin/orders",{credentials:"include"}).then(r=>r.json()).then(d=>setOrders(d.orders||[])).finally(()=>setLoading(false)); };
  useEffect(load,[]);
  const [listSearch,setListSearch]=useState("");
  const [listSort,setListSort]=useState("newest");
  const displayOrders=(()=>{
    let list=[...orders];
    const q=listSearch.trim().toLowerCase();
    if(q) list=list.filter(o=>[o.orderNumber,o.order_number,o.customerEmail,o.customer_email,o.customerName,o.status,o.paymentStatus].some(x=>String(x||"").toLowerCase().includes(q)));
    if(listSort==="newest") list.sort((a,b)=>cmpStr(b.createdAt||b.created_at,a.createdAt||a.created_at));
    else if(listSort==="oldest") list.sort((a,b)=>cmpStr(a.createdAt||a.created_at,b.createdAt||b.created_at));
    else if(listSort==="total-desc") list.sort((a,b)=>cmpNum(b.total,a.total));
    else if(listSort==="total-asc") list.sort((a,b)=>cmpNum(a.total,b.total));
    else if(listSort==="status") list.sort((a,b)=>cmpStr(a.status,b.status));
    return list;
  })();
  const [pickupLocations,setPickupLocations]=useState([]);
  useEffect(()=>{ fetch("/api/admin/settings/pickup-locations",{credentials:"include"}).then(r=>r.json()).then(d=>setPickupLocations(d.pickupLocations||[])).catch(()=>{}); },[]);
  const updateStatus=async(orderNumber,status,pickupLocation)=>{
    let res, data={};
    try {
      res=await apiFetch(`/api/admin/orders/${orderNumber}/status`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status,pickupLocation})});
      data=await res.json().catch(()=>({}));
    } catch (e) {
      showToast(e?.message || "Network error updating order status.","error");
      return;
    }
    if(!res.ok){
      const msg = data.error || data.message || data.shipment?.error || `Couldn't update status (HTTP ${res.status}).`;
      showToast(msg,"error");
      return;
    }
    load();
    if(status==="dispatched"){
      const s=data.shipment;
      if(s?.ok){
        showToast(s.awb?`Dispatched · AWB ${s.awb}`:`Dispatched · Shiprocket booking created (${s.trackingId||"ok"})`,"success");
      } else if(s?.skipped){
        showToast(s.error||"Dispatched, but Shiprocket was skipped (credentials missing on server).","error");
      } else if(s && !s.ok){
        showToast(`Dispatched in AKĀRA, but Shiprocket failed: ${s.error||"unknown error"}`,"error");
      } else {
        showToast(`Order #${orderNumber} marked dispatched`,"success");
      }
    } else if(status==="cancelled"){
      const sc=data.shiprocketCancel;
      if(sc?.ok){
        showToast(`Order #${orderNumber} cancelled · Shiprocket cancel requested`,"success");
      } else if(sc?.skipped){
        showToast(`Order cancelled. ${sc.error||"Cancel the Shiprocket shipment manually if one exists."}`,"error");
      } else if(sc && !sc.ok){
        showToast(`Order cancelled on ĀKĀRA, but Shiprocket cancel failed: ${sc.error||"check dashboard"}`,"error");
      } else {
        showToast(`Order #${orderNumber} cancelled`,"success");
      }
    } else {
      showToast(`Order #${orderNumber} marked ${status}`,"success");
    }
  };
  // Marking an order "dispatched" now needs one more piece of information
  // first — which of the business's (more than one) real pickup addresses
  // this particular shipment is actually going out from, since that isn't
  // always the same location. Every other status still updates
  // immediately, same as before; only this one pauses for a choice.
  const syncCourier=async(orderNumber)=>{
    const res=await apiFetch(`/api/admin/orders/${orderNumber}/sync-courier`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    const data=await res.json().catch(()=>({}));
    if(!res.ok){
      showToast(data.error||data.message||"Could not sync AWB from Shiprocket.","error");
      return;
    }
    load();
    const awb=data.shipment?.awb||data.shipment?.trackingId;
    showToast(awb?`Synced · AWB ${awb}`:"Synced tracking from Shiprocket","success");
  };
  const [dispatchTarget,setDispatchTarget]=useState(null);
  const [dispatchPickupLocation,setDispatchPickupLocation]=useState("");
  const handleStatusChange=(orderNumber,status)=>{
    if(status==="dispatched"&&pickupLocations.length>0){
      setDispatchTarget(orderNumber);
      setDispatchPickupLocation(pickupLocations[0].name);
    } else {
      updateStatus(orderNumber,status);
    }
  };
  const confirmDispatch=()=>{
    if(!dispatchPickupLocation){ showToast("Please choose a pickup location.","error"); return; }
    updateStatus(dispatchTarget,"dispatched",dispatchPickupLocation);
    setDispatchTarget(null);
  };
  // A dedicated, explicit Cancel action — technically reachable via the
  // generic status dropdown too (cancelled is one of its options), but
  // that's easy to miss buried among five other statuses. This makes it
  // a clear, deliberate action with its own confirmation, matching how
  // meaningful this action actually is (it can't be undone from here).
  const confirmCancel=()=>updateStatus(cancelTarget,"cancelled");
  const markPaid=async orderNumber=>{
    const res=await apiFetch(`/api/admin/orders/${orderNumber}/mark-paid`,{method:"PATCH"});
    if(res.ok){ load(); showToast(`Order #${orderNumber} marked as paid`,"success"); }
    else showToast("Couldn't mark that order as paid.","error");
  };
  const openRefund=o=>{
    const already=Number(o.amountRefunded||0);
    const remaining=Math.max(0, Math.round((Number(o.total)-already)*100)/100);
    setRefundTarget(o);
    setRefundAmount(remaining?String(remaining):"");
    setRefundReason("");
  };
  const submitPartialRefund=async()=>{
    if(!refundTarget) return;
    const amount=Number(refundAmount);
    const total=Number(refundTarget.total||0);
    const already=Number(refundTarget.amountRefunded||0);
    const remaining=Math.max(0, Math.round((total-already)*100)/100);
    if(!Number.isFinite(amount)||amount<=0){ showToast("Enter a valid refund amount.","error"); return; }
    if(amount>remaining+0.01){ showToast(`Maximum still refundable is ₹${remaining.toLocaleString("en-IN")}.`,"error"); return; }
    if(remaining<=0){ showToast("Nothing left to refund on this order.","error"); return; }
    setRefunding(true);
    try{
      const res=await apiFetch(`/api/admin/orders/${refundTarget.orderNumber}/refund`,{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ amount, reason: refundReason }),
      });
      const data=await res.json().catch(()=>({}));
      if(res.ok){
        showToast(data.fully?`Full residual refund for #${refundTarget.orderNumber}`:`Refunded ₹${amount.toLocaleString("en-IN")} on #${refundTarget.orderNumber}`,"success");
        setRefundTarget(null);
        load();
      } else showToast(data.error||"Refund failed.","error");
    }catch{ showToast("Couldn't reach the server.","error"); }
    finally{ setRefunding(false); }
  };
  const [refreshing,setRefreshing]=useState(false);
  const refreshTracking=async()=>{
    setRefreshing(true);
    try{
      const res=await apiFetch("/api/admin/orders/refresh-tracking",{method:"POST"});
      const data=await res.json();
      if(res.ok){
        load();
        if(data.checkedCount===0) showToast("No dispatched orders with tracking to check.","info");
        else showToast(`Checked ${data.checkedCount} order${data.checkedCount!==1?"s":""} — ${data.updatedCount} marked delivered`,"success");
      } else showToast("Couldn't refresh tracking.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setRefreshing(false);
    }
  };
  return <div className="p-5 md:p-8">
    <AdminPageHeader
      eyebrow="Operate"
      title="Orders"
      info="Live fulfillment ledger. Status changes can create Shiprocket shipments, emails, batches, and tracking events."
      subtitle="Fulfillment ledger — status, payment, batch, and dispatch."
      actions={<SweepButton onClick={refreshTracking} disabled={refreshing}>{refreshing?"Checking…":"Refresh tracking"}</SweepButton>}
    />
    {!loading&&orders.length>0&&(
      <AdminListControls
        search={listSearch} setSearch={setListSearch}
        searchPlaceholder="Search order #, email, status…"
        sort={listSort} setSort={setListSort}
        sortOptions={[["newest","Newest first"],["oldest","Oldest first"],["total-desc","Total high–low"],["total-asc","Total low–high"],["status","Status"]]}
      />
    )}

    {loading?<div className="flex flex-col gap-3">{[0,1,2,3].map(i=><Skeleton key={i} height={88} radius={RADIUS.md}/>)}</div>:
    orders.length===0?<EmptyState icon={ShoppingCart} title="No orders yet" message="Orders will show up here once customers start checking out."/>:
    <div className="flex flex-col gap-3">
      {displayOrders.map((o,oi)=>{
        const itemSummary=o.items.map(i=>`${i.name}${i.size?` (${i.size})`:""} × ${i.qty}${i.batchNumber?` · ${i.batchNumber}`:""}`).join(", ");
        // Confirmed = not yet moved to production — bold until status changes (needs action)
        const needsAction = o.status === "confirmed";
        return <div key={o.orderNumber} className="flex flex-col gap-4 p-4 md:p-5" style={{
          ...ATELIER_PANEL,
          ...(needsAction ? {
            borderLeft: "3px solid " + T.gold,
            boxShadow: "0 8px 28px -12px rgba(24,54,48,0.18)",
            background: "linear-gradient(135deg, rgba(196,163,90,0.08), " + (T.cream || "#F7F3EB") + " 40%)",
          } : {}),
        }}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            {/* REAL BUG FIX, found directly from a real, live screenshot:
                a real, longer order number ("AK30C64BFB22") overflowed
                past this fixed 112px width and visually overlapped the
                email text sitting right next to it — the original width
                assumed every real order number would always be short
                enough to fit, which isn't guaranteed. shrink-0 lets the
                order number size itself to its own real, actual length
                and never compress, while the parent row's existing
                md:flex-wrap (added for an earlier, similar overlap fix)
                correctly pushes the email onto its own line if a
                genuinely long order number needs the room. */}
            <span className="text-[10px] tracking-[0.12em] mr-2 hidden sm:inline" style={{color:needsAction?T.gold:"rgba(24,54,48,0.45)",fontWeight:needsAction?700:400}}>{String(oi+1).padStart(2,"0")}</span>
            <span className="text-[16px] md:shrink-0" style={{color:T.teal,fontFamily:"'Fraunces',serif",fontWeight:needsAction?700:500}}>#{o.orderNumber}</span>
            {needsAction&&<span className="text-[10px] uppercase tracking-[0.12em] px-2 py-0.5" style={{color:T.gold,border:"1px solid rgba(196,163,90,0.45)",borderRadius:999,fontWeight:600}}>Awaiting production</span>}
            <span className="text-[13px] md:flex-1 md:min-w-[140px]" style={{color:T.muted}}>{o.email}{o.phone?` · ${o.phone}`:""}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            {/* REAL BUG FIX: found directly from a real screenshot review
                — on orders with a wider real status-badge combination
                (e.g. "COD" + "DISPATCHED" + "Mark paid"), the real price
                figure was visually overlapping the badges next to it.
                Root cause: the parent row (above) never allowed
                wrapping, forcing every real order's full content onto
                one fixed line regardless of how much of it there
                genuinely was. Adding md:flex-wrap there is the real,
                robust fix — badges that don't fit now wrap to their own
                real line instead of colliding with the price, for any
                future real status/badge combination too, not just
                today's specific one. */}
            <span className="text-[15px] md:w-24 shrink-0" style={{color:T.teal}}>₹{o.total.toLocaleString("en-IN")}</span>
            <div className="flex items-center gap-2 flex-wrap">
              <StatusPill status={o.paymentStatus}>{o.paymentStatus}</StatusPill>
              <StatusPill status={o.status}>{o.status}</StatusPill>
              {o.paymentStatus==="cod"&&o.status!=="cancelled"&&<button onClick={()=>markPaid(o.orderNumber)} className="text-[11px] uppercase tracking-[0.06em] underline" style={{color:T.success}}>Mark paid</button>}
              {(o.paymentStatus==="paid"||o.paymentStatus==="partially_refunded")&&o.status!=="cancelled"&&(
                <button onClick={()=>openRefund(o)} className="text-[11px] uppercase tracking-[0.06em] px-2 py-1" style={{color:T.warning,border:"1px solid rgba(181,101,29,0.35)",borderRadius:6}}>Refund</button>
              )}
              {Number(o.amountRefunded)>0&&(
                <span className="text-[11px]" style={{color:T.muted}}>Refunded ₹{Number(o.amountRefunded).toLocaleString("en-IN")}</span>
              )}
            </div>
          </div>
          {/* Found directly from a real screenshot the owner sent: a
              cancelled order can still show payment status "paid" —
              this ISN'T a sync bug (the status dropdown correctly says
              cancelled; paymentStatus is a genuinely separate field
              tracking what actually happened to the money, not the
              order's fulfillment state). The real cause: cancelling a
              paid order attempts an actual Razorpay refund
              automatically, but a failed refund deliberately leaves
              payment_status as "paid" — the honest state, since the
              money genuinely wasn't returned — rather than inventing a
              new status. That failure WAS being recorded (the Activity
              Log), just invisible from this screen, which is exactly
              why it read as a sync bug. This warning surfaces it right
              where an admin would actually notice it. */}
          {o.status==="cancelled"&&o.paymentStatus==="paid"&&<div className="md:col-span-3 flex items-center gap-2 px-3 py-2 mt-1" style={{backgroundColor:"rgba(168,59,50,0.08)",border:`1px solid ${T.error}`,borderRadius:RADIUS.xs}}>
            <AlertCircle size={14} style={{color:T.error,flexShrink:0}}/>
            <p className="text-[12px]" style={{color:T.error}}>This order is cancelled but still shows as paid — the automatic refund likely failed. Check the Activity Log for order #{o.orderNumber}, or process this refund manually in Razorpay.</p>
          </div>}
          <select value={o.status} onChange={e=>handleStatusChange(o.orderNumber,e.target.value)} disabled={o.status==="cancelled"} className="text-[13px] px-3 py-2.5 min-h-[42px] w-full md:w-auto disabled:opacity-50" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs}}>
            {[o.status,...(ORDER_STATUS_TRANSITIONS[o.status]||[])].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          {/* REAL BUG FIX, found directly from the same, real screenshot
              that showed the order number/email overlap: the timeline's
              5 real step labels ("Confirmed," "Production," etc.) were
              also colliding — "Confirmed" running straight into
              "Production," rendering as "CONFIRMEDRODUCTION." Root
              cause: this component had no real, guaranteed width of its
              own — it was squeezed into whatever real, narrow sliver of
              horizontal space remained after the order number, price,
              badges, and status dropdown above claimed theirs on the
              same, real flex-wrap row, leaving nowhere near enough real
              room for 5 real, separate labels to render without
              overlapping. w-full forces this to always take its own,
              real, full-width row — genuinely enough space for 5 short
              real words at any real screen size, matching how it
              actually needs to be laid out to read correctly. */}
          <button type="button" onClick={()=>toggleOrder(o.orderNumber)} className="w-full flex items-center justify-between py-2 mt-1 text-left" style={{borderTop:"1px solid rgba(24,54,48,0.08)"}}>
            <span className="text-[11px] tracking-[0.1em] uppercase" style={{color:T.teal,fontWeight:600}}>{expandedOrders[o.orderNumber]?"Hide details":"Show details"}</span>
            <ChevronRight size={16} style={{color:T.teal,transform:expandedOrders[o.orderNumber]?"rotate(90deg)":"none",transition:"transform 0.15s"}}/>
          </button>
          {expandedOrders[o.orderNumber]&&<div className="w-full clear-both pt-2">
            <OrderFulfillmentTimeline status={o.status} placedAt={o.placedAt} updatedAt={o.updatedAt} />
          </div>}
          <div className="flex flex-wrap items-center gap-3 w-full mt-1">
            {o.courierTrackingUrl&&(
              <a href={o.courierTrackingUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] uppercase tracking-[0.06em] px-3 py-1.5" style={{color:T.teal,border:"1px solid rgba(24,54,48,0.2)",borderRadius:8}}>Open courier →</a>
            )}
            {(o.status==="dispatched"||o.status==="delivered")&&(
              <button type="button" onClick={()=>syncCourier(o.orderNumber)} className="text-[12px] uppercase tracking-[0.06em] px-3 py-1.5" style={{color:T.teal,border:"1px solid rgba(24,54,48,0.2)",borderRadius:8,background:"transparent"}}>
                {o.courierTrackingId?"Refresh AWB":"Sync AWB from Shiprocket"}
              </button>
            )}
            {o.status!=="cancelled"&&o.status!=="delivered"&&(
              <button type="button" onClick={()=>setCancelTarget(o.orderNumber)} className="text-[12px] uppercase tracking-[0.06em] px-3 py-1.5" style={{color:T.error,border:"1px solid rgba(168,59,50,0.25)",borderRadius:8,background:"transparent"}}>Cancel</button>
            )}
          </div>
        </div>
        {o.courierTrackingId&&!expandedOrders[o.orderNumber]&&(
          <p className="text-[12px] mt-1" style={{color:"rgba(36,62,65,0.7)"}}>AWB {o.courierTrackingId}{o.courierStatus?` · ${o.courierStatus}`:""}</p>
        )}
        {expandedOrders[o.orderNumber]&&<>
          {(o.courierTrackingId||o.courierStatus||(o.courierEvents&&o.courierEvents.length>0))&&(
            <div className="text-[12.5px] p-3 mt-2" style={{backgroundColor:"rgba(24,54,48,0.04)",borderRadius:10}}>
              {o.courierTrackingId&&<p style={{color:T.teal}}><span style={{color:"rgba(36,62,65,0.55)"}}>{String(o.courierTrackingId).startsWith("SR-")?"Shiprocket shipment (AWB pending):":"AWB / ID:"}</span> {o.courierTrackingId}</p>}
              {o.courierStatus&&<p style={{color:T.teal}}><span style={{color:"rgba(36,62,65,0.55)"}}>Courier:</span> {o.courierStatus}</p>}
              {Array.isArray(o.courierEvents)&&o.courierEvents.length>0&&(
                <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                  {[...o.courierEvents].reverse().slice(0,24).map((ev,i)=>(
                    <li key={i} style={{color:"rgba(36,62,65,0.8)"}}>
                      <span style={{color:"rgba(36,62,65,0.45)"}}>{ev.at?new Date(ev.at).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):""}</span>
                      {" · "}{ev.status||ev.activity||ev.sr_status||""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="text-[12.5px] mt-2" style={{color:"rgba(36,62,65,0.75)"}}>{itemSummary}</p>
        </>}
      </div>;})}
    </div>}
    <Modal open={!!dispatchTarget} onClose={()=>setDispatchTarget(null)} title="Which pickup location?" confirmLabel="Confirm Dispatch" onConfirm={confirmDispatch}>
      <div className="mb-2">
        <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Pickup Location</label>
        <select value={dispatchPickupLocation} onChange={e=>setDispatchPickupLocation(e.target.value)} className="w-full text-[14px] px-3 py-2.5" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs}}>
          {pickupLocations.map(p=><option key={p.id} value={p.name}>{p.name}</option>)}
        </select>
      </div>
      Order #{dispatchTarget} will be shipped from this address — make sure it's where the piece is actually ready for pickup.
    </Modal>
    <Modal open={!!cancelTarget} onClose={()=>setCancelTarget(null)} title="Cancel this order?" danger confirmLabel="Cancel Order" onConfirm={confirmCancel}>
      Order #{cancelTarget} will be marked cancelled. If the customer already paid, a real refund will be attempted automatically — you'll see it reflected here, or a failure noted in the Activity Log if it needs manual handling.
    </Modal>
    <Modal
      open={!!refundTarget}
      onClose={()=>!refunding&&setRefundTarget(null)}
      title={refundTarget?`Refund #${refundTarget.orderNumber}`:"Refund"}
      confirmLabel={refunding?"Processing…":(Number(refundAmount)>0?`Issue ₹${Number(refundAmount).toLocaleString("en-IN")}`:"Issue refund")}
      onConfirm={submitPartialRefund}
      danger
    >
      {refundTarget&&(()=>{
        const total=Number(refundTarget.total||0);
        const already=Number(refundTarget.amountRefunded||0);
        const remaining=Math.max(0, Math.round((total-already)*100)/100);
        const amt=Number(refundAmount);
        const amtOk=Number.isFinite(amt)&&amt>0&&amt<=remaining+0.001;
        const after=amtOk?Math.max(0, Math.round((remaining-amt)*100)/100):null;
        const pay=String(refundTarget.paymentMethod||refundTarget.payment_method||"").toLowerCase();
        const payStatus=String(refundTarget.paymentStatus||refundTarget.payment_status||"");
        const isOnline=pay.includes("razor")||pay.includes("online")||pay.includes("upi")||pay.includes("card")||payStatus==="paid"||payStatus==="partially_refunded";
        const isCod=pay.includes("cod")||payStatus==="cod";
        const pctChips=[25,50,75,100].map(p=>({
          p,
          v: Math.max(1, Math.min(remaining, Math.round((remaining*p)/100))),
        })).filter((x,i,arr)=>x.v>0&&arr.findIndex(y=>y.v===x.v)===i);
        return <div>
          <div className="grid grid-cols-3 gap-2 mb-3 text-center">
            <div className="p-2.5" style={{background:"rgba(24,54,48,0.05)",borderRadius:8}}>
              <p className="text-[10px] uppercase tracking-[0.08em] mb-1" style={{color:"rgba(36,62,65,0.55)"}}>Order total</p>
              <p className="text-[14px] font-medium" style={{color:T.teal}}>₹{total.toLocaleString("en-IN")}</p>
            </div>
            <div className="p-2.5" style={{background:"rgba(24,54,48,0.05)",borderRadius:8}}>
              <p className="text-[10px] uppercase tracking-[0.08em] mb-1" style={{color:"rgba(36,62,65,0.55)"}}>Already refunded</p>
              <p className="text-[14px] font-medium" style={{color:already>0?T.warning:T.teal}}>₹{already.toLocaleString("en-IN")}</p>
            </div>
            <div className="p-2.5" style={{background:"rgba(200,164,103,0.18)",borderRadius:8}}>
              <p className="text-[10px] uppercase tracking-[0.08em] mb-1" style={{color:"rgba(36,62,65,0.55)"}}>Still refundable</p>
              <p className="text-[14px] font-medium" style={{color:T.teal}}>₹{remaining.toLocaleString("en-IN")}</p>
            </div>
          </div>
          <p className="text-[12px] mb-3" style={{color:"rgba(36,62,65,0.7)"}}>
            Payment: <strong style={{color:T.teal}}>{pay||payStatus||"—"}</strong>
            {payStatus?` · status ${payStatus}`:""}
            {isCod?" · COD: settle offline — Razorpay path not used.":""}
            {!isCod&&isOnline?" · Online: Razorpay issues this amount to the original method (5–7 business days).":""}
          </p>
          {remaining<=0?(
            <p className="text-[13px] p-3 mb-2" style={{background:"rgba(168,59,50,0.08)",color:T.error,borderRadius:8}}>Nothing left to refund on this order.</p>
          ):(
            <>
              <InputField
                label="Amount to refund (₹)"
                value={refundAmount}
                onChange={v=>{
                  const digits=String(v).replace(/[^0-9.]/g,"");
                  setRefundAmount(digits);
                }}
              />
              {!amtOk&&refundAmount!==""&&(
                <p className="text-[12px] mt-1.5" style={{color:T.error}}>
                  {amt<=0?"Enter an amount greater than zero.":`Maximum still refundable is ₹${remaining.toLocaleString("en-IN")}.`}
                </p>
              )}
              {after!=null&&(
                <p className="text-[12px] mt-1.5" style={{color:"rgba(36,62,65,0.7)"}}>
                  After this refund: <strong style={{color:T.teal}}>₹{after.toLocaleString("en-IN")}</strong> still refundable
                  {after===0?" (order will show fully refunded).":"."}
                </p>
              )}
              <div className="flex flex-wrap gap-2 mt-3 mb-1">
                {pctChips.map(({p,v})=>(
                  <button key={p} type="button" onClick={()=>setRefundAmount(String(v))}
                    className="text-[11px] px-2.5 py-1.5"
                    style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:6,color:T.teal,background:Number(refundAmount)===v?"rgba(24,54,48,0.1)":"transparent"}}>
                    {p}%{p===100?" · full remaining":""}
                  </button>
                ))}
              </div>
              <div className="mt-4">
                <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Reason (activity log)</label>
                <select
                  value={["","Damaged in transit","Partial return","Goodwill / service recovery","Pricing correction","Other"].includes(refundReason)?refundReason:"Other"}
                  onChange={e=>{
                    const v=e.target.value;
                    if(v==="Other") setRefundReason(refundReason&&!["Damaged in transit","Partial return","Goodwill / service recovery","Pricing correction"].includes(refundReason)?refundReason:"");
                    else setRefundReason(v);
                  }}
                  className="w-full text-[14px] px-3 py-2.5 mb-2 outline-none"
                  style={{border:"1px solid rgba(36,62,65,0.16)",borderRadius:8,color:T.teal,background:T.cream}}
                >
                  <option value="">Select…</option>
                  <option value="Damaged in transit">Damaged in transit</option>
                  <option value="Partial return">Partial return</option>
                  <option value="Goodwill / service recovery">Goodwill / service recovery</option>
                  <option value="Pricing correction">Pricing correction</option>
                  <option value="Other">Other / custom</option>
                </select>
                <InputField label="Note (optional)" value={refundReason} onChange={setRefundReason} placeholder="Short note for the activity log"/>
              </div>
            </>
          )}
        </div>;
      })()}
    </Modal>
  </div>;
}



function AdminWaitlist(){
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const showToast=useToast();
  useEffect(()=>{
    fetch("/api/admin/waitlist",{credentials:"include"})
      .then(r=>r.ok?r.json():Promise.reject())
      .then(d=>setRows(d.entries||[]))
      .catch(()=>showToast("Could not load waitlist","error"))
      .finally(()=>setLoading(false));
  },[]);
  return <div className="p-5 md:p-8">
    <AdminPageHeader eyebrow="Catalog" title="Restock waitlist"
      info="Emails of customers who asked to be told when a sold-out piece returns. Notified once when status leaves sold-out." subtitle="Emails collected when a piece is sold out or customers request a restock notice." />
    {loading?<Skeleton height={120}/>:
    <div className="flex flex-col gap-2">
      {rows.length===0&&<p className="text-[13px]" style={{color:T.muted}}>No waitlist entries yet.</p>}
      {rows.map(r=>(
        <div key={r.id} className="p-3 flex flex-col sm:flex-row sm:justify-between gap-1" style={ATELIER_ROW}>
          <div>
            <p className="text-[14px]" style={{color:T.teal}}>{r.productName||r.productId}</p>
            <p className="text-[12.5px]" style={{color:T.muted}}>{r.email}</p>
          </div>
          <p className="text-[11px]" style={{color:"rgba(36,62,65,0.5)"}}>{r.createdAt?new Date(r.createdAt).toLocaleString("en-IN"):""}</p>
        </div>
      ))}
    </div>}
  </div>;
}

function AdminBatches(){
  const showToast=useToast();
  const [batches,setBatches]=useState([]);
  const [suggested,setSuggested]=useState("");
  const [loading,setLoading]=useState(true);
  const [notes,setNotes]=useState("");
  const [productId,setProductId]=useState("");
  const [products,setProducts]=useState([]);
  const [creating,setCreating]=useState(false);
  const [assignOrder,setAssignOrder]=useState("");
  const [assignBatch,setAssignBatch]=useState("");
  const [assigning,setAssigning]=useState(false);

  const load=()=>{
    setLoading(true);
    fetch("/api/admin/batches",{credentials:"include"})
      .then(r=>r.ok?r.json():Promise.reject())
      .then(d=>{ setBatches(d.batches||[]); setSuggested(d.suggestedNext||""); })
      .catch(()=>showToast("Could not load batches","error"))
      .finally(()=>setLoading(false));
  };
  useEffect(()=>{ load();
    fetch("/api/admin/products",{credentials:"include"}).then(r=>r.ok?r.json():null)
      .then(d=>{ if(d?.products) setProducts(d.products.filter(p=>p.status!=="hidden")); })
      .catch(()=>{});
  },[]);

  const createBatch=async e=>{
    e.preventDefault();
    setCreating(true);
    try{
      const res=await apiFetch("/api/admin/batches",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({notes,productId:productId||null})});
      const data=await res.json().catch(()=>({}));
      if(res.ok){
        showToast(`Batch ${data.batch?.batchNumber} created`,"success");
        setNotes(""); setProductId("");
        load();
      } else showToast(data.error||"Could not create batch","error");
    }catch{ showToast("Server error","error"); }
    finally{ setCreating(false); }
  };

  const setStatus=async (id,status)=>{
    const res=await apiFetch(`/api/admin/batches/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});
    if(res.ok){ load(); showToast("Batch updated","success"); }
    else showToast("Update failed","error");
  };

  const assign=async e=>{
    e.preventDefault();
    if(!assignOrder.trim()||!assignBatch.trim()){ showToast("Order number and batch required","error"); return; }
    setAssigning(true);
    try{
      const res=await apiFetch(`/api/admin/batches/assign-to-order/${encodeURIComponent(assignOrder.trim())}`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({batchNumber:assignBatch.trim().toUpperCase()}),
      });
      const data=await res.json().catch(()=>({}));
      if(res.ok){
        showToast(`Assigned ${data.batchNumber} to #${assignOrder.trim()}`,"success");
        setAssignOrder("");
      } else showToast(data.error||"Assign failed","error");
    }catch{ showToast("Server error","error"); }
    finally{ setAssigning(false); }
  };

  return <div className="p-5 md:p-8">
    <AdminPageHeader
      eyebrow="Operate"
      title="Production batches"
      info="Print runs (AK-YYYYMM-NNN). Auto-created when a paid/COD order is placed. Closed automatically if all linked orders are cancelled. Start production only when active orders remain."
      subtitle="Print runs as AK-YYYYMM-NNN — month + sequence. Assign to orders so packing and QC stay traceable."
    />
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
      <form onSubmit={createBatch} className="p-5 flex flex-col gap-3" style={ATELIER_PANEL}>
        <p className="text-[15px] italic" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Create batch</p>
        <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.7)"}}>Next number this month: <strong style={{color:T.teal}}>{suggested||"…"}</strong></p>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Product (optional)</label>
          <select value={productId} onChange={e=>setProductId(e.target.value)} className="w-full text-[14px] px-3 py-2.5" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,color:T.teal}}>
            <option value="">Mixed / any product</option>
            {products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <InputField label="Notes" value={notes} onChange={setNotes} placeholder="e.g. Axiom run — 6 units"/>
        <SweepButton filled type="submit" disabled={creating}>{creating?"Creating…":"Create batch"}</SweepButton>
      </form>
      <form onSubmit={assign} className="p-5 flex flex-col gap-3" style={ATELIER_PANEL}>
        <p className="text-[15px] italic" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Assign batch to order</p>
        <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.7)"}}>Writes batch number onto every line item of that order (stored on the order snapshot).</p>
        <InputField label="Order number" value={assignOrder} onChange={setAssignOrder} placeholder="e.g. AK30C64BFB22"/>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Batch</label>
          <select value={assignBatch} onChange={e=>setAssignBatch(e.target.value)} className="w-full text-[14px] px-3 py-2.5" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,color:T.teal}}>
            <option value="">Select batch</option>
            {batches.filter(b=>b.status!=="closed").map(b=><option key={b.id} value={b.batchNumber}>{b.batchNumber}{b.productName?` · ${b.productName}`:""}</option>)}
          </select>
        </div>
        <SweepButton filled type="submit" disabled={assigning}>{assigning?"Saving…":"Assign to order"}</SweepButton>
      </form>
    </div>
    {loading?<div className="flex flex-col gap-3">{[0,1,2].map(i=><Skeleton key={i} height={64}/>)}</div>:
    <div className="flex flex-col gap-3">
      {batches.length===0&&<p className="text-[13px]" style={{color:T.muted}}>No batches yet — create the first print run above.</p>}
      {batches.map(b=>(
        <div key={b.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={ATELIER_PANEL}>
          <div>
            <p className="text-[16px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{b.batchNumber}</p>
            <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.7)"}}>
              {b.productName||"Mixed products"} · {b.status.replace("_"," ")}
              {b.notes?` · ${b.notes}`:""}
            </p>
            <p className="text-[11px] mt-1" style={{color:"rgba(36,62,65,0.5)"}}>{b.createdAt?new Date(b.createdAt).toLocaleString("en-IN"):""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {b.status==="open"&&(b.activeOrderCount>0?
            <button type="button" onClick={()=>setStatus(b.id,"in_production")} className="text-[11px] uppercase tracking-[0.06em] px-3 py-1.5" style={{border:`1px solid rgba(24,54,48,0.2)`,borderRadius:999,color:T.teal}}>Start production</button>
            :<span className="text-[11px]" style={{color:"rgba(36,62,65,0.55)"}}>No active orders (cancelled or unlinked)</span>)}
            <span className="text-[11px]" style={{color:"rgba(36,62,65,0.5)"}}>{b.activeOrderCount||0} active · {b.linkedOrderCount||0} linked</span>
            {b.status==="in_production"&&<button type="button" onClick={()=>setStatus(b.id,"qc")} className="text-[11px] uppercase tracking-[0.06em] px-3 py-1.5" style={{border:`1px solid rgba(24,54,48,0.2)`,borderRadius:999,color:T.teal}}>To QC</button>}
            {b.status==="qc"&&<button type="button" onClick={()=>setStatus(b.id,"closed")} className="text-[11px] uppercase tracking-[0.06em] px-3 py-1.5" style={{border:`1px solid rgba(24,54,48,0.2)`,borderRadius:999,color:T.teal}}>Close batch</button>}
            {b.status!=="closed"&&b.status!=="open"&&<button type="button" onClick={()=>setStatus(b.id,"closed")} className="text-[11px] uppercase tracking-[0.06em] px-3 py-1.5" style={{border:`1px solid rgba(168,59,50,0.3)`,borderRadius:999,color:T.error}}>Close</button>}
          </div>
        </div>
      ))}
    </div>}
  </div>;
}


function AdminCustomers(){
  const [customers,setCustomers]=useState([]); const [loading,setLoading]=useState(true);
  const [listSearch,setListSearch]=useState("");
  const [listSort,setListSort]=useState("name-asc");
  const displayCustomers=(()=>{
    let list=[...customers];
    const q=listSearch.trim().toLowerCase();
    if(q) list=list.filter(c=>[c.name,c.email,c.phone].some(x=>String(x||"").toLowerCase().includes(q)));
    if(listSort==="name-asc") list.sort((a,b)=>cmpStr(a.name,b.name));
    else if(listSort==="name-desc") list.sort((a,b)=>cmpStr(b.name,a.name));
    else if(listSort==="email") list.sort((a,b)=>cmpStr(a.email,b.email));
    else if(listSort==="newest") list.sort((a,b)=>cmpStr(b.createdAt||b.created_at,a.createdAt||a.created_at));
    return list;
  })();
  useEffect(()=>{ fetch("/api/admin/customers",{credentials:"include"}).then(r=>r.json()).then(d=>setCustomers(d.customers||[])).finally(()=>setLoading(false)); },[]);
  return <div className="p-5 md:p-8">
    <AdminPageHeader eyebrow="People" title="Customers"
      info="Registered shoppers and Google-linked accounts. Not the same as admin users." subtitle="Accounts that registered or ordered with ĀKĀRA." />
    {!loading&&customers.length>0&&(
      <AdminListControls
        search={listSearch} setSearch={setListSearch}
        searchPlaceholder="Search name, email, phone…"
        sort={listSort} setSort={setListSort}
        sortOptions={[["name-asc","Name A–Z"],["name-desc","Name Z–A"],["email","Email"],["newest","Newest"]]}
      />
    )}

    {loading?<div className="flex flex-col gap-3">{[0,1,2,3].map(i=><Skeleton key={i} height={56} radius={RADIUS.sm}/>)}</div>:
    customers.length===0?<EmptyState icon={Users} title="No customers yet" message="Real accounts will show up here as people sign up."/>:
    <div className="overflow-x-auto" style={ATELIER_PANEL}>
      <div className="hidden md:grid grid-cols-[1.4fr_1fr_0.7fr_0.8fr_0.9fr] gap-3 px-5 py-3 text-[11px] uppercase tracking-[0.08em]" style={{color:"rgba(36,62,65,0.5)",borderBottom:"1px solid rgba(36,62,65,0.08)"}}>
        <span>Customer</span><span>Contact</span><span>Orders</span><span>Spent</span><span>Joined</span>
      </div>
      {displayCustomers.map(c=><div key={c.id} className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_0.7fr_0.8fr_0.9fr] gap-1 md:gap-3 px-5 py-4 items-center" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}>
        <p className="text-[14px] truncate" style={{color:T.teal}}>{c.name||"—"}</p>
        <p className="text-[12.5px] break-all" style={{color:"rgba(36,62,65,0.75)"}}>{c.email}{c.phone?` · ${c.phone}`:""}</p>
        <span className="text-[13px]" style={{color:"rgba(36,62,65,0.75)"}}>{c.orderCount} order{c.orderCount!==1?"s":""}</span>
        <span className="text-[14px]" style={{color:T.teal}}>₹{Number(c.totalSpent||0).toLocaleString("en-IN")}</span>
        <span className="text-[12px]" style={{color:"rgba(36,62,65,0.75)"}}>{new Date(c.createdAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</span>
      </div>)}
    </div>}
  </div>;
}

// ============================================================================
// ENQUIRIES — real unified view of Contact form submissions and Bulk/
// Corporate Order enquiries, the actual original ask: one screen, not
// two separate ones to check. Both tables were already being written
// to correctly by the live customer-facing forms — this is purely the
// missing admin UI to read them.
// ============================================================================
function AdminEnquiries(){
  const showToast=useToast();
  const [enquiries,setEnquiries]=useState([]);
  const [loading,setLoading]=useState(true);
  const [filter,setFilter]=useState("unhandled"); // unhandled | all
  // Bulk-selection state — real admin action, requested directly:
  // marking every one-at-a-time before this meant N separate clicks
  // for N enquiries. Keyed by "type-id" (matching the same real
  // composite identity used for the list's own React key) since a
  // selection can genuinely span both contact_submissions and
  // bulk_order_enquiries at once.
  const [selected,setSelected]=useState(new Set());
  const [bulkSubmitting,setBulkSubmitting]=useState(false);

  const load=()=>{ setLoading(true); fetch("/api/admin/enquiries",{credentials:"include"}).then(r=>r.json()).then(d=>{setEnquiries(d.enquiries||[]);setLoading(false);}); };
  useEffect(load,[]);

  const toggleHandled=async e=>{
    const res=await apiFetch(`/api/admin/enquiries/${e.type}/${e.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({handled:!e.handled})});
    if(res.ok){ load(); showToast(e.handled?"Marked as new":"Marked as handled","success"); }
    else showToast("Couldn't update that enquiry.","error");
  };

  const shown=filter==="unhandled"?enquiries.filter(e=>!e.handled):enquiries;
  const unhandledCount=enquiries.filter(e=>!e.handled).length;

  const selectionKey=e=>`${e.type}-${e.id}`;
  const toggleSelect=e=>setSelected(s=>{ const next=new Set(s); const key=selectionKey(e); if(next.has(key)) next.delete(key); else next.add(key); return next; });
  const allShownSelected=shown.length>0&&shown.every(e=>selected.has(selectionKey(e)));
  const toggleSelectAll=()=>setSelected(s=>{
    if(allShownSelected){ const next=new Set(s); shown.forEach(e=>next.delete(selectionKey(e))); return next; }
    const next=new Set(s); shown.forEach(e=>next.add(selectionKey(e))); return next;
  });
  // Real filter/tab changes clear the selection — a checkbox ticked
  // under "New" silently carrying over to "All" (where it might now
  // point at a genuinely different, unrelated-looking row) would be a
  // real, confusing way to lose track of what's actually selected.
  useEffect(()=>{ setSelected(new Set()); },[filter]);

  const bulkMarkHandled=async handled=>{
    const items=enquiries.filter(e=>selected.has(selectionKey(e))).map(e=>({type:e.type,id:e.id}));
    if(items.length===0) return;
    setBulkSubmitting(true);
    try{
      const res=await apiFetch("/api/admin/enquiries/bulk",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({items,handled})});
      const data=await res.json().catch(()=>({}));
      if(res.ok){ showToast(`Marked ${data.updatedCount} enquir${data.updatedCount!==1?"ies":"y"} as ${handled?"handled":"new"}`,"success"); setSelected(new Set()); load(); }
      else showToast(data.error||"Couldn't update the selected enquiries.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setBulkSubmitting(false);
    }
  };

  return <div className="p-5 md:p-8 max-w-[900px]">
    <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
      <AdminPageHeader eyebrow="People" title="Enquiries"
      info="Contact and bulk-order form submissions. Mark handled after you reply." subtitle="Contact form and bulk-order messages." />
      <div className="flex gap-2">
        {["unhandled","all"].map(f=><button key={f} onClick={()=>setFilter(f)} className="px-3.5 py-2 text-[12px] uppercase tracking-[0.06em]"
          style={filter===f?{backgroundColor:T.teal,color:"white",borderRadius:RADIUS.xs}:{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs,color:T.teal}}>
          {f==="unhandled"?`New (${unhandledCount})`:"All"}
        </button>)}
      </div>
    </div>
    <p className="text-[13.5px] mb-6" style={{color:"rgba(36,62,65,0.75)"}}>Contact form submissions and Bulk & Corporate Order enquiries, together, most recent first.</p>

    {!loading&&shown.length>0&&<div className="flex items-center justify-between gap-3 mb-3 px-1">
      <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" style={{color:T.teal}}>
        <input type="checkbox" checked={allShownSelected} onChange={toggleSelectAll}/>
        {selected.size>0?`${selected.size} selected`:"Select all"}
      </label>
      {selected.size>0&&<div className="flex gap-2">
        <SweepButton onClick={()=>bulkMarkHandled(true)} disabled={bulkSubmitting}>{bulkSubmitting?"Updating…":"Mark Handled"}</SweepButton>
        <SweepButton onClick={()=>bulkMarkHandled(false)} disabled={bulkSubmitting}>Mark New</SweepButton>
      </div>}
    </div>}

    {loading?<Skeleton height={200}/>:
    shown.length===0?<EmptyState icon={Inbox} title={filter==="unhandled"?"Nothing new":"No enquiries yet"} message={filter==="unhandled"?"Every enquiry has been marked as handled.":"Contact and Bulk Order submissions will show up here."}/>:
    <div className="flex flex-col gap-3">
      {shown.map(e=><div key={`${e.type}-${e.id}`} className="p-4 flex gap-3" style={{...ATELIER_ROW, opacity:e.handled?0.6:1}}>
        <input type="checkbox" checked={selected.has(selectionKey(e))} onChange={()=>toggleSelect(e)} className="mt-1 shrink-0"/>
        <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={e.type==="bulk"?"warning":"neutral"}>{e.type==="bulk"?"Bulk/Corporate":"Contact"}</Badge>
            {!e.handled&&<Badge variant="success">new</Badge>}
            <span className="text-[13.5px]" style={{color:T.teal}}>{e.name}</span>
            {e.company&&<span className="text-[12px]" style={{color:"rgba(36,62,65,0.75)"}}>· {e.company}</span>}
          </div>
          <span className="text-[11.5px] whitespace-nowrap" style={{color:"rgba(36,62,65,0.75)"}}>{new Date(e.createdAt).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[12px]" style={{color:"rgba(36,62,65,0.75)"}}>
          <a href={`mailto:${e.email}`} className="underline" style={{color:T.teal}}>{e.email}</a>
          <span>{e.phone}</span>
          {e.quantity&&<span>Qty: {e.quantity}</span>}
          {e.interest&&<span>Interested in: {e.interest}</span>}
        </div>
        <p className="text-[13.5px] leading-[1.6] mb-3" style={{color:"rgba(36,62,65,0.75)"}}>{e.message}</p>
        <div className="flex gap-3">
          <a href={`mailto:${e.email}?subject=${encodeURIComponent(`Re: Your enquiry to ĀKĀRA`)}`} className="text-[11.5px] uppercase tracking-[0.06em]" style={{color:T.teal}}>Reply by Email</a>
          <button onClick={()=>toggleHandled(e)} className="text-[11.5px] uppercase tracking-[0.06em]" style={{color:"rgba(36,62,65,0.75)"}}>{e.handled?"Mark as New":"Mark as Handled"}</button>
        </div>
        </div>
      </div>)}
    </div>}
  </div>;
}

function AdminNewsletter(){
  const [subscribers,setSubscribers]=useState([]); const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState("");
  const [removeTarget,setRemoveTarget]=useState(null);
  const showToast=useToast();
  const load=()=>{ setLoading(true); fetch("/api/admin/newsletter",{credentials:"include"}).then(r=>r.json()).then(d=>setSubscribers(d.subscribers||[])).finally(()=>setLoading(false)); };
  useEffect(load,[]);

  const filtered=search.trim()?subscribers.filter(s=>s.email.toLowerCase().includes(search.trim().toLowerCase())):subscribers;

  // Real, working CSV export — not a placeholder. Quotes every field and
  // escapes any literal quote inside it (doubling it, the standard CSV
  // convention), since an email or preference value COULD in principle
  // contain a comma without this. Downloads via a Blob + temporary link
  // click, the standard browser-native way to trigger a file save with
  // no server round-trip needed — this is already-loaded data, so there's
  // nothing for the server to do here.
  const exportCSV=()=>{
    const escape=v=>`"${String(v).replace(/"/g,'""')}"`;
    const header=["Email","New Arrivals","Promotions","Journal","Subscribed"].map(escape).join(",");
    const rows=filtered.map(s=>[s.email,s.newArrivals?"Yes":"No",s.promotions?"Yes":"No",s.journal?"Yes":"No",new Date(s.subscribedAt).toLocaleDateString("en-IN")].map(escape).join(","));
    const csv=[header,...rows].join("\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=`akara-newsletter-subscribers-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const confirmRemove=async()=>{
    const res=await apiFetch(`/api/admin/newsletter/${encodeURIComponent(removeTarget)}`,{method:"DELETE"});
    if(res.ok){ setRemoveTarget(null); load(); showToast("Subscriber removed","success"); }
    else showToast("Couldn't remove that subscriber.","error");
  };

  return <div className="p-5 md:p-8">
    <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
      <AdminPageHeader eyebrow="People" title="Newsletter"
      info="Opt-in subscribers for marketing. Respect unsubscribe / email preferences." subtitle="Email subscribers who opted in for updates." />
      {subscribers.length>0&&<SweepButton onClick={exportCSV}><Download size={14} className="inline mr-1.5" style={{verticalAlign:"-2px"}}/>Export CSV</SweepButton>}
    </div>
    <p className="text-[13.5px] mb-6" style={{color:"rgba(36,62,65,0.75)"}}>{subscribers.length} total subscriber{subscribers.length!==1?"s":""}{search.trim()&&filtered.length!==subscribers.length?` — ${filtered.length} matching "${search}"`:""}</p>
    {subscribers.length>0&&<div className="mb-6 max-w-[360px]">
      <InputField label="Search by email" value={search} onChange={setSearch} placeholder="jane@example.com"/>
    </div>}
    {loading?<div className="flex flex-col gap-3">{[0,1,2,3].map(i=><Skeleton key={i} height={56} radius={RADIUS.sm}/>)}</div>:
    subscribers.length===0?<EmptyState icon={Mail} title="No subscribers yet" message="Real signups from the footer form and Email Preferences page will show up here."/>:
    filtered.length===0?<EmptyState icon={Mail} title="No matches" message={`No subscriber email contains "${search}".`}/>:
    <div className="flex flex-col gap-2.5 md:gap-0">
      {filtered.map(s=><div key={s.email} className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 p-4 md:px-5 md:py-3" style={ATELIER_ROW}>
        <div className="flex-1">
          <p className="text-[14px]" style={{color:T.teal}}>{s.email}</p>
          <p className="text-[12px]" style={{color:"rgba(36,62,65,0.75)"}}>Subscribed {new Date(s.subscribedAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</p>
        </div>
        <div className="flex items-center justify-between md:contents">
          <div className="flex gap-1.5 flex-wrap">
            {s.newArrivals&&<Badge variant="neutral">New Arrivals</Badge>}
            {s.promotions&&<Badge variant="neutral">Promotions</Badge>}
            {s.journal&&<Badge variant="neutral">Journal</Badge>}
            {!s.newArrivals&&!s.promotions&&!s.journal&&<Badge variant="warning">Unsubscribed from all</Badge>}
          </div>
          <button onClick={()=>setRemoveTarget(s.email)} className="text-[12px] uppercase tracking-[0.06em]" style={{color:T.error}}>Remove</button>
        </div>
      </div>)}
    </div>}
    <Modal open={!!removeTarget} onClose={()=>setRemoveTarget(null)} title="Remove this subscriber?" danger confirmLabel="Remove" onConfirm={confirmRemove}>
      <p className="text-[13.5px]" style={{color:"rgba(36,62,65,0.75)"}}>{removeTarget} will be permanently removed from the newsletter list. This can't be undone from here — they'd need to sign up again.</p>
    </Modal>
  </div>;
}

function AdminActivityLog(){
  const [entries,setEntries]=useState([]); const [loading,setLoading]=useState(true);
  useEffect(()=>{ fetch("/api/admin/activity-log",{credentials:"include"}).then(r=>r.json()).then(d=>setEntries(d.entries||[])).finally(()=>setLoading(false)); },[]);
  const describe=e=>{
    if(e.action==="product.update") return `Updated product "${e.details.productId}"${e.details.diff&&Object.keys(e.details.diff).length?` (${Object.keys(e.details.diff).join(", ")})`:""}`;
    if(e.action==="product.create") return `Created product "${e.details.productId}"`;
    if(e.action==="product.delete") return `Deleted product "${e.details.productId}"`;
    if(e.action==="product.variants_updated") return `Updated variants for "${e.details.productId}" (${e.details.colorCount} color${e.details.colorCount!==1?"s":""}, ${e.details.variantCount} combination${e.details.variantCount!==1?"s":""})`;
    if(e.action==="products.featured_updated") return `Updated Featured Products (${e.details.count} product${e.details.count!==1?"s":""})`;
    if(e.action==="order.status_change") return `Order #${e.details.orderNumber}: ${e.details.from} → ${e.details.to}${e.details.source==="shiprocket_tracking_sync"?" (auto, via Shiprocket tracking)":""}`;
    if(e.action==="order.cod_marked_paid") return `Marked order #${e.details.orderNumber} as paid (Cash on Delivery)`;
    if(e.action==="return_request.status_change") return `Return request for order #${e.details.orderNumber}: marked ${e.details.to}`;
    if(e.action==="admin.password_change") return "Changed admin password";
    if(e.action==="admin.2fa_enabled") return "Enabled two-factor authentication";
    if(e.action==="admin.2fa_disabled") return "Disabled two-factor authentication";
    if(e.action==="admin.2fa_login") return "Signed in with two-factor authentication";
    if(e.action==="account.create") return `Created ${e.details.role} account for ${e.details.email}`;
    if(e.action==="account.remove") return `Removed admin account ${e.details.removedEmail}`;
    if(e.action==="page_content.save") return `Edited "${e.details.pageKey}" page content (${e.details.blockCount} block${e.details.blockCount!==1?"s":""})`;
    if(e.action==="page_content.revert") return `Reverted "${e.details.pageKey}" to an earlier version`;
    if(e.action==="enquiry.mark_handled") return `Marked a ${e.details.type==="bulk"?"Bulk Order":"Contact"} enquiry as ${e.details.handled?"handled":"new"}`;
    if(e.action==="enquiry.bulk_mark_handled") return `Marked ${e.details.count} enquir${e.details.count!==1?"ies":"y"} as ${e.details.handled?"handled":"new"}`;
    if(e.action==="newsletter.subscriber_removed") return `Removed newsletter subscriber ${e.details.email}`;
    if(e.action==="settings.update") return `Updated shipping settings (₹${e.details.shippingCost}, free above ₹${e.details.freeShippingThreshold})`;
    if(e.action==="settings.maintenance_update") return `${e.details.enabled?"Enabled":"Disabled"} maintenance mode`;
    if(e.action==="settings.cod_update") return `${e.details.enabled?"Enabled":"Disabled"} Cash on Delivery${e.details.enabled?` (fee: ₹${e.details.fee})`:""}`;
    if(e.action==="coupon.create") return `Created coupon "${e.details.code}" (${e.details.discountPercent}% off${e.details.featured?", featured publicly":""})`;
    if(e.action==="coupon.update"){
      const changed=[];
      if(e.details.from.discountPercent!==e.details.to.discountPercent) changed.push(`${e.details.from.discountPercent}% → ${e.details.to.discountPercent}%`);
      if(e.details.from.active!==e.details.to.active) changed.push(e.details.to.active?"activated":"deactivated");
      if(e.details.from.featured!==e.details.to.featured) changed.push(e.details.to.featured?"now featured publicly":"no longer featured publicly");
      return `Updated coupon "${e.details.code}"${changed.length?` (${changed.join(", ")})`:""}`;
    }
    if(e.action==="coupon.delete") return `Deleted coupon "${e.details.code}"`;
    if(e.action==="pickup_location.create") return `Added pickup location "${e.details.name}"`;
    if(e.action==="pickup_location.delete") return `Removed pickup location "${e.details.name}"`;
    if(e.action==="order.refund_succeeded") return `Refunded order #${e.details.orderNumber} — ₹${e.details.amount} (${e.details.refundId})`;
    if(e.action==="order.refund_failed") return `⚠ Refund FAILED for order #${e.details.orderNumber} — needs manual handling in Razorpay dashboard`;
    if(e.action==="order.refund_skipped_no_payment_id") return `⚠ Couldn't refund order #${e.details.orderNumber} — no payment record found`;
    // Genuine fallback for any action type not explicitly described above
    // (a future new action type someone adds later, or one this list
    // missed) — shows the raw details as real JSON rather than nothing,
    // so an admin can still tell roughly what happened even before this
    // list gets updated with a proper sentence for it.
    return `${e.action}${e.details&&Object.keys(e.details).length?` — ${JSON.stringify(e.details)}`:""}`;
  };
  return <div className="p-5 md:p-8">
    <AdminPageHeader eyebrow="System" title="Activity log"
      info="Audit trail of admin actions (product/order/settings changes) for this panel." subtitle="Every product and order change from this panel — grouped by date, newest first." />
    {loading?<div className="flex flex-col gap-3">{[0,1,2,3].map(i=><Skeleton key={i} height={44} radius={RADIUS.sm}/>)}</div>:
    entries.length===0?<EmptyState icon={History} title="No activity yet" message="Product edits and order status changes will be recorded here."/>:
    (()=>{
      // WHAT: Activity log grouped by calendar day (newest day first).
      // WHY: Flat list is hard to scan; date sections answer "what happened today/yesterday".
      // CONNECTED TO: GET /api/admin/activity-log (createdAt on each entry).
      const byDay={};
      for(const e of entries){
        const raw=e.createdAt||e.created_at;
        const d=raw?new Date(raw):null;
        const dayKey=d&&!isNaN(d.getTime())?d.toISOString().slice(0,10):"unknown";
        (byDay[dayKey]||=[]).push(e);
      }
      const dayKeys=Object.keys(byDay).sort((a,b)=>b.localeCompare(a));
      const dayLabel=(key)=>{
        if(key==="unknown") return "Unknown date";
        const today=new Date(); const ymd=(x)=>x.toISOString().slice(0,10);
        const yesterday=new Date(today); yesterday.setDate(yesterday.getDate()-1);
        if(key===ymd(today)) return "Today";
        if(key===ymd(yesterday)) return "Yesterday";
        return new Date(key+"T12:00:00").toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
      };
      return <div className="flex flex-col gap-8">
        {dayKeys.map(dayKey=>(
          <section key={dayKey}>
            <div className="flex items-center gap-3 mb-3 py-2" style={{backgroundColor:T.cream}}>
              <p className="text-[11px] tracking-[0.14em] uppercase shrink-0 font-medium" style={{color:T.teal}}>{dayLabel(dayKey)}</p>
              <div className="flex-1 h-px" style={{backgroundColor:"rgba(24,54,48,0.12)"}}/>
              <span className="text-[11px] tabular-nums" style={{color:"rgba(36,62,65,0.5)"}}>{byDay[dayKey].length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {byDay[dayKey].map(e=>{
                const isFailure=e.action.includes("failed")||e.action.includes("skipped");
                return <div key={e.id} className="flex items-center justify-between gap-4 py-4 px-1" style={{...ATELIER_ROW, borderLeft:isFailure?`2px solid ${T.error}`:"2px solid transparent", backgroundColor:isFailure?"rgba(168,59,50,0.05)":"transparent", paddingLeft:12}}>
                  <div className="min-w-0">
                    <span className="text-[13.5px]" style={{color:isFailure?T.error:T.teal}}>{describe(e)}</span>
                    <p className="text-[11.5px] mt-0.5" style={{color:"rgba(36,62,65,0.75)"}}>by {e.adminName||"Admin"}</p>
                  </div>
                  <span className="text-[12px] whitespace-nowrap" style={{color:"rgba(36,62,65,0.75)"}}>{new Date(e.createdAt||e.created_at).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</span>
                </div>;
              })}
            </div>
          </section>
        ))}
      </div>;
    })()}
  </div>;
}

const RETURN_STATUSES=["pending","approved","rejected","completed"];
function AdminReturns(){
  const showToast=useToast();
  const [requests,setRequests]=useState([]); const [loading,setLoading]=useState(true);
  const [busyId,setBusyId]=useState(null);
  const [listSearch,setListSearch]=useState("");
  const [listSort,setListSort]=useState("newest");
  const displayRequests=(()=>{
    let list=[...requests];
    const q=listSearch.trim().toLowerCase();
    if(q) list=list.filter(r=>[r.orderNumber,r.order_number,r.itemName,r.item_name,r.status,r.customerEmail].some(x=>String(x||"").toLowerCase().includes(q)));
    if(listSort==="newest") list.sort((a,b)=>cmpStr(b.createdAt||b.created_at,a.createdAt||a.created_at));
    else if(listSort==="status") list.sort((a,b)=>cmpStr(a.status,b.status));
    return list;
  })();
  const load=()=>{ setLoading(true); fetch("/api/admin/returns",{credentials:"include"}).then(r=>r.json()).then(d=>setRequests(d.returnRequests||[])).finally(()=>setLoading(false)); };
  useEffect(load,[]);
  const updateStatus=async(id,status)=>{
    setBusyId(id);
    try{
      const res=await apiFetch(`/api/admin/returns/${id}/status`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});
      const data=await res.json().catch(()=>({}));
      if(res.ok){ await load(); showToast(`Marked ${status}`,"success"); }
      else showToast(data.error||"Couldn't update that request.","error");
    }catch{ showToast("Couldn't reach the server.","error"); }
    finally{ setBusyId(null); }
  };
  const tone=(s)=>({
    pending:{bg:"rgba(184,147,90,0.16)",color:T.teal},
    approved:{bg:"rgba(45,122,90,0.12)",color:"#2d7a5a"},
    rejected:{bg:"rgba(168,59,50,0.1)",color:T.error},
    completed:{bg:"rgba(36,62,65,0.08)",color:T.teal},
  }[s]||{bg:"rgba(36,62,65,0.08)",color:T.teal});
  return <div>
    <AdminPageHeader eyebrow="Operate" title="Return requests"
      info="Customer return applications. Only delivered orders should be eligible — approve or reject here." subtitle="Review, approve, or reject customer returns." />
    {!loading&&requests.length>0&&(
      <AdminListControls search={listSearch} setSearch={setListSearch} searchPlaceholder="Search order, item, status…"
        sort={listSort} setSort={setListSort}
        sortOptions={[["newest","Newest"],["status","Status"]]}/>
    )}

    {loading?<div className="flex flex-col gap-3">{[0,1,2].map(i=><Skeleton key={i} height={110} radius={RADIUS.sm}/>)}</div>:
    requests.length===0?<EmptyState icon={Package} title="No return requests" message="Customer return requests will show up here."/>:
    <div className="flex flex-col gap-4">
      {displayRequests.map(r=>{
        const isPending=r.status==="pending";
        const t=tone(r.status);
        return <div key={r.id} className="p-5 overflow-hidden" style={ATELIER_PANEL}>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium break-words" style={{color:T.teal}}>#{r.orderNumber} — {r.itemName}</p>
              <p className="text-[12.5px] break-words mt-1" style={{color:"rgba(36,62,65,0.75)"}}>{r.reason} · {r.contactEmail} · {r.contactPhone}</p>
            </div>
            <span className="text-[10.5px] uppercase tracking-[0.1em] px-3 py-1.5 shrink-0" style={{backgroundColor:t.bg,color:t.color,borderRadius:999}}>{r.status}</span>
          </div>
          <p className="text-[13px] mb-4 break-words whitespace-pre-wrap overflow-hidden" style={{color:"rgba(36,62,65,0.8)",wordBreak:"break-word"}}>{r.description}</p>
          {r.photoUrl&&<img src={r.photoUrl} alt="Return photo" className="w-24 h-24 object-cover mb-4" style={{borderRadius:RADIUS.xs}}/>}
          {isPending ? (
            <div className="flex flex-wrap gap-2 pt-2" style={{borderTop:"1px solid rgba(36,62,65,0.08)"}}>
              <SweepButton filled disabled={busyId===r.id} onClick={()=>updateStatus(r.id,"approved")}>Approve</SweepButton>
              <SweepButton disabled={busyId===r.id} onClick={()=>updateStatus(r.id,"rejected")}>Reject</SweepButton>
            </div>
          ) : (
            <p className="text-[12px] pt-2" style={{color:"rgba(36,62,65,0.55)",borderTop:"1px solid rgba(36,62,65,0.08)"}}>
              Decision recorded — no further action on this request.
              {r.status==="approved" && (
                <button type="button" className="ml-2 underline" style={{color:T.teal}} disabled={busyId===r.id} onClick={()=>updateStatus(r.id,"completed")}>Mark completed</button>
              )}
            </p>
          )}
        </div>;
      })}
    </div>}
  </div>;
}

// ============================================================================
// MANAGE ACCOUNTS — super_admin only (this component is only ever
// reachable via a nav item filtered to super_admin, and every real
// action it triggers is separately re-checked server-side by
// requireRole("super_admin") — the actual security boundary is there,
// not this screen existing or not).
// ============================================================================
// ============================================================================
// SITE CONTENT (CMS) — super_admin only. Two screens in one component:
// a page picker (list of manageable pages with their block counts), and
// the actual block editor once a page is selected. Every block is
// edited as plain text using the SAME [text](link)/**bold** markup
// convention the public renderer parses (see PageContentBlocks in
// AkaraApp.jsx) — an admin typing that convention into a textarea and a
// customer seeing the resulting real link/bold text is the same
// contract on both ends, deliberately.
// ============================================================================
function AdminCms(){
  const showToast=useToast();
  const [pages,setPages]=useState([]);
  const [loading,setLoading]=useState(true);
  const [selectedPage,setSelectedPage]=useState(null);
  const [blocks,setBlocks]=useState([]);
  const [saving,setSaving]=useState(false);
  const [showHistory,setShowHistory]=useState(false);
  const [history,setHistory]=useState([]);
  const [historyLoading,setHistoryLoading]=useState(false);

  const loadPages=()=>{ setLoading(true); fetch("/api/admin/page-content",{credentials:"include"}).then(r=>r.json()).then(d=>{setPages(d.pages||[]);setLoading(false);}); };
  useEffect(loadPages,[]);

  const openPage=async pageKey=>{
    setSelectedPage(pageKey);
    const res=await fetch(`/api/admin/page-content/${pageKey}`,{credentials:"include"});
    const data=await res.json();
    setBlocks(data.blocks||[]);
  };

  const updateBlock=(i,content)=>setBlocks(bs=>bs.map((b,idx)=>idx===i?{...b,content}:b));
  // For qa/bulletList blocks, content is a JSON string under the hood
  // (matching exactly what the backend/renderer both expect), but the
  // admin should never have to hand-edit raw JSON — these helpers
  // parse, mutate one real field, and re-stringify, so the actual
  // editing experience is real form fields, same as every other block
  // type.
  const updateQaField=(i,field,value)=>setBlocks(bs=>bs.map((b,idx)=>{
    if(idx!==i) return b;
    let parsed={q:"",a:""}; try{ parsed=JSON.parse(b.content); }catch{}
    return {...b,content:JSON.stringify({...parsed,[field]:value})};
  }));
  const updateBulletTitle=(i,title)=>setBlocks(bs=>bs.map((b,idx)=>{
    if(idx!==i) return b;
    let parsed={title:"",points:[""]}; try{ parsed=JSON.parse(b.content); }catch{}
    return {...b,content:JSON.stringify({...parsed,title})};
  }));
  const updateBulletPoint=(i,pointIdx,value)=>setBlocks(bs=>bs.map((b,idx)=>{
    if(idx!==i) return b;
    let parsed={title:"",points:[""]}; try{ parsed=JSON.parse(b.content); }catch{}
    const points=[...parsed.points]; points[pointIdx]=value;
    return {...b,content:JSON.stringify({...parsed,points})};
  }));
  const addBulletPoint=i=>setBlocks(bs=>bs.map((b,idx)=>{
    if(idx!==i) return b;
    let parsed={title:"",points:[]}; try{ parsed=JSON.parse(b.content); }catch{}
    return {...b,content:JSON.stringify({...parsed,points:[...parsed.points,""]})};
  }));
  const removeBulletPoint=(i,pointIdx)=>setBlocks(bs=>bs.map((b,idx)=>{
    if(idx!==i) return b;
    let parsed={title:"",points:[]}; try{ parsed=JSON.parse(b.content); }catch{}
    return {...b,content:JSON.stringify({...parsed,points:parsed.points.filter((_,pi)=>pi!==pointIdx)})};
  }));
  // Generic field updater for hero/quote/darkPanel — all three are just
  // a flat {field: string} shape, so one real function covers all three
  // rather than three near-identical ones.
  const updateFlatField=(i,field,value)=>setBlocks(bs=>bs.map((b,idx)=>{
    if(idx!==i) return b;
    let parsed={}; try{ parsed=JSON.parse(b.content); }catch{}
    return {...b,content:JSON.stringify({...parsed,[field]:value})};
  }));
  // Generic array-of-objects helpers for stepGrid's steps and
  // cardGrid's cards — both are {..., items:[{...}]} shapes differing
  // only in the array's key name and each item's own fields, so these
  // take the array key as a parameter rather than duplicating the same
  // add/update/remove logic twice.
  const updateArrayItemField=(i,arrayKey,itemIdx,field,value)=>setBlocks(bs=>bs.map((b,idx)=>{
    if(idx!==i) return b;
    let parsed={}; try{ parsed=JSON.parse(b.content); }catch{}
    const items=[...(parsed[arrayKey]||[])];
    items[itemIdx]={...items[itemIdx],[field]:value};
    return {...b,content:JSON.stringify({...parsed,[arrayKey]:items})};
  }));
  const addArrayItem=(i,arrayKey,newItem)=>setBlocks(bs=>bs.map((b,idx)=>{
    if(idx!==i) return b;
    let parsed={}; try{ parsed=JSON.parse(b.content); }catch{}
    return {...b,content:JSON.stringify({...parsed,[arrayKey]:[...(parsed[arrayKey]||[]),newItem]})};
  }));
  const removeArrayItem=(i,arrayKey,itemIdx)=>setBlocks(bs=>bs.map((b,idx)=>{
    if(idx!==i) return b;
    let parsed={}; try{ parsed=JSON.parse(b.content); }catch{}
    return {...b,content:JSON.stringify({...parsed,[arrayKey]:(parsed[arrayKey]||[]).filter((_,ii)=>ii!==itemIdx)})};
  }));
  const removeBlock=i=>setBlocks(bs=>bs.filter((_,idx)=>idx!==i));
  const addBlock=type=>setBlocks(bs=>[...bs,{blockType:type,content:
    type==="table"?JSON.stringify([["Column 1","Column 2"],["",""]])
    :type==="qa"?JSON.stringify({q:"",a:""})
    :type==="bulletList"?JSON.stringify({title:"",points:[""]})
    :type==="hero"?JSON.stringify({eyebrow:"",heading:"",subtext:""})
    :type==="quote"?JSON.stringify({quote:"",attribution:""})
    :type==="darkPanel"?JSON.stringify({eyebrow:"",heading:"",body:""})
    :type==="stepGrid"?JSON.stringify({eyebrow:"",heading:"",steps:[{number:"01",title:"",description:""}]})
    :type==="cardGrid"?JSON.stringify({cards:[{title:"",description:""}]})
    :type==="heroWithCta"?JSON.stringify({eyebrow:"",heading:"",subtext:"",ctaLabel:"",ctaLabel2:""})
    :type==="footerBrand"?JSON.stringify({tagline:"",email:"",phone:"",instagram:"",location:"",newsletterBlurb:""})
    :""}]);
  const moveUp=i=>{ if(i===0) return; setBlocks(bs=>{ const next=[...bs]; [next[i-1],next[i]]=[next[i],next[i-1]]; return next; }); };
  const moveDown=i=>{ setBlocks(bs=>{ if(i===bs.length-1) return bs; const next=[...bs]; [next[i],next[i+1]]=[next[i+1],next[i]]; return next; }); };

  const save=async()=>{
    setSaving(true);
    try{
      const res=await apiFetch(`/api/admin/page-content/${selectedPage}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({blocks:blocks.map(b=>({blockType:b.blockType,content:b.content}))})});
      const data=await res.json().catch(()=>({}));
      if(res.ok){ showToast("Page saved","success"); loadPages(); }
      else showToast(data.error||"Couldn't save this page.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setSaving(false);
    }
  };

  const openHistory=async()=>{
    setShowHistory(true); setHistoryLoading(true);
    const res=await fetch(`/api/admin/page-content/${selectedPage}/history`,{credentials:"include"});
    const data=await res.json();
    setHistory(data.versions||[]); setHistoryLoading(false);
  };

  const revert=async versionId=>{
    try{
      const res=await apiFetch(`/api/admin/page-content/${selectedPage}/revert/${versionId}`,{method:"POST"});
      const data=await res.json().catch(()=>({}));
      if(res.ok){ showToast("Reverted to that version","success"); setShowHistory(false); openPage(selectedPage); }
      else showToast(data.error||"Couldn't revert.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }
  };

  if(selectedPage) return <div className="p-5 md:p-10 max-w-[880px] mx-auto cms-atelier">
    <div className="mb-8 pb-6" style={{borderBottom:"1px solid rgba(184,147,90,0.35)"}}>
      <button type="button" onClick={()=>{setSelectedPage(null);setBlocks([]);}} className="flex items-center gap-1.5 text-[11px] tracking-[0.14em] uppercase mb-5 transition-opacity hover:opacity-80" style={{color:"rgba(36,62,65,0.55)"}}>
        <ChevronLeft size={14}/> Manuscript index
      </button>
      <p className="text-[10px] tracking-[0.22em] uppercase mb-2" style={{color:T.teal,fontWeight:600}}>Atelier copy desk</p>
      <h1 className="italic text-[28px] md:text-[36px] leading-[1.15] mb-3" style={{fontFamily:"'Fraunces',serif",color:T.teal,fontWeight:400}}>{pages.find(p=>p.pageKey===selectedPage)?.title}</h1>
      <p className="text-[13px] leading-relaxed max-w-lg mb-5" style={{color:"rgba(36,62,65,0.65)"}}>
        Links: <span style={{fontFamily:"ui-monospace,monospace",fontSize:12}}>[label](page-key)</span> · Bold: <span style={{fontFamily:"ui-monospace,monospace",fontSize:12}}>**text**</span>. Each save keeps a version you can restore.
      </p>
      <div className="flex flex-wrap gap-2">
        <SweepButton onClick={openHistory}>Versions</SweepButton>
        <SweepButton filled onClick={save} disabled={saving}>{saving?"Saving…":"Publish to site"}</SweepButton>
      </div>
      {selectedPage==="home_sections"&&(
        <div className="mt-6 p-4 text-[12.5px] leading-relaxed" style={{borderLeft:"2px solid #E5C690",background:"rgba(247,243,235,0.6)",color:"rgba(36,62,65,0.75)"}}>
          <p className="text-[10px] tracking-[0.14em] uppercase mb-2" style={{color:"#E5C690"}}>Homepage keys</p>
          <p className="mb-2">Easiest: one <strong>Paragraph</strong> block whose content is JSON (all keys optional — missing keys keep the site defaults):</p>
          <pre className="text-[11px] overflow-x-auto p-3 mb-2" style={{background:"rgba(24,54,48,0.04)",color:"#183630"}}>{`{
  "trust_1_title": "Plant-based PLA",
  "trust_1_sub": "…",
  "trust_2_title": "7-Day Returns",
  "trust_2_sub": "…",
  "trust_3_title": "Secure Checkout",
  "trust_3_sub": "…",
  "trust_4_title": "Studio capacity",
  "trust_4_sub": "…",
  "category_eyebrow": "Shop by Category",
  "category_title": "Find your form.",
  "room_eyebrow": "Room stories",
  "room_title": "Where form meets room.",
  "why_eyebrow": "Why ĀKĀRA",
  "why_title": "Built differently, on purpose.",
  "why_1_title": "Made to Order",
  "why_1_body": "…",
  "why_2_title": "…", "why_2_body": "…",
  "why_3_title": "…", "why_3_body": "…",
  "why_4_title": "…", "why_4_body": "…",
  "featured_eyebrow": "This season",
  "featured_title": "A form we keep returning to.",
  "cta_explore": "Explore the Collection"
}`}</pre>
          <p>Or use Heading = key name, next Paragraph = value (same keys).</p>
          <p className="mt-2">Hero lines still edit under <strong>Homepage Hero</strong>. Photo under Catalog → Homepage hero. Products / Room stories / Featured have their own screens.</p>
        </div>
      )}
    </div>

    <div className="flex flex-col gap-8 mb-10">
      {blocks.map((b,i)=><div key={i} className="relative pl-5 md:pl-6" style={{borderLeft:`2px solid ${i%2===0?T.gold:"rgba(24,54,48,0.12)"}`}}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <span className="text-[10px] tracking-[0.16em] uppercase" style={{color:T.teal,letterSpacing:"0.12em",fontWeight:600}}>{String(i+1).padStart(2,"0")} · {b.blockType}</span>
          <div className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity">
            <button type="button" onClick={()=>moveUp(i)} disabled={i===0} style={{color:"rgba(36,62,65,0.75)",opacity:i===0?0.3:1}} aria-label="Move up"><ChevronLeft size={15} style={{transform:"rotate(90deg)"}}/></button>
            <button type="button" onClick={()=>moveDown(i)} disabled={i===blocks.length-1} style={{color:"rgba(36,62,65,0.75)",opacity:i===blocks.length-1?0.3:1}} aria-label="Move down"><ChevronRight size={15} style={{transform:"rotate(90deg)"}}/></button>
            <button type="button" onClick={()=>removeBlock(i)} style={{color:T.error}} aria-label="Remove"><Trash2 size={15}/></button>
          </div>
        </div>
        {b.blockType==="heading"
          ? <input value={b.content} onChange={e=>updateBlock(i,e.target.value)} className="w-full bg-transparent outline-none text-[22px] md:text-[26px] italic" style={{border:"none",borderBottom:"1px solid rgba(184,147,90,0.45)",borderRadius:0,padding:"6px 0 10px",color:T.teal,fontFamily:"'Fraunces',serif",fontWeight:400}}/>
          : b.blockType==="qa"
          ? (()=>{ let parsed={q:"",a:""}; try{ parsed=JSON.parse(b.content); }catch{} return <div className="flex flex-col gap-2">
              <input value={parsed.q} onChange={e=>updateQaField(i,"q",e.target.value)} placeholder="Question" className="w-full bg-transparent outline-none text-[13.5px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"9px 12px",color:T.teal}}/>
              <textarea value={parsed.a} onChange={e=>updateQaField(i,"a",e.target.value)} rows={2} placeholder="Answer" className="w-full bg-transparent outline-none text-[13.5px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"9px 12px",color:T.teal}}/>
            </div>; })()
          : b.blockType==="bulletList"
          ? (()=>{ let parsed={title:"",points:[]}; try{ parsed=JSON.parse(b.content); }catch{} return <div className="flex flex-col gap-2">
              <input value={parsed.title} onChange={e=>updateBulletTitle(i,e.target.value)} placeholder="Section title" className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"9px 12px",color:T.teal,fontFamily:"'Fraunces',serif"}}/>
              {parsed.points.map((p,pi)=><div key={pi} className="flex items-center gap-2">
                <input value={p} onChange={e=>updateBulletPoint(i,pi,e.target.value)} placeholder="Point" className="flex-1 bg-transparent outline-none text-[13px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"8px 11px",color:T.teal}}/>
                <button onClick={()=>removeBulletPoint(i,pi)} style={{color:T.error,flexShrink:0}}><Trash2 size={13}/></button>
              </div>)}
              <button onClick={()=>addBulletPoint(i)} className="text-[11.5px] uppercase tracking-[0.06em] self-start" style={{color:T.teal}}>+ Add Point</button>
            </div>; })()
          : b.blockType==="hero"
          ? (()=>{ let parsed={eyebrow:"",heading:"",subtext:""}; try{ parsed=JSON.parse(b.content); }catch{} return <div className="flex flex-col gap-2">
              <input value={parsed.eyebrow} onChange={e=>updateFlatField(i,"eyebrow",e.target.value)} placeholder="Eyebrow (small label above the heading)" className="w-full bg-transparent outline-none text-[12px] uppercase tracking-[0.06em]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"8px 11px",color:T.teal}}/>
              <textarea value={parsed.heading} onChange={e=>updateFlatField(i,"heading",e.target.value)} rows={2} placeholder="Heading — wrap a word in **bold** for gold emphasis" className="w-full bg-transparent outline-none text-[15px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"9px 12px",color:T.teal,fontFamily:"'Fraunces',serif"}}/>
              <textarea value={parsed.subtext} onChange={e=>updateFlatField(i,"subtext",e.target.value)} rows={2} placeholder="Subtext" className="w-full bg-transparent outline-none text-[13.5px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"9px 12px",color:T.teal}}/>
            </div>; })()
          : b.blockType==="quote"
          ? (()=>{ let parsed={quote:"",attribution:""}; try{ parsed=JSON.parse(b.content); }catch{} return <div className="flex flex-col gap-2">
              <textarea value={parsed.quote} onChange={e=>updateFlatField(i,"quote",e.target.value)} rows={2} placeholder="Quote" className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"9px 12px",color:T.teal,fontFamily:"'Fraunces',serif"}}/>
              <input value={parsed.attribution} onChange={e=>updateFlatField(i,"attribution",e.target.value)} placeholder="Attribution (e.g. The ĀKĀRA Studio)" className="w-full bg-transparent outline-none text-[13px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"8px 11px",color:T.teal}}/>
            </div>; })()
          : b.blockType==="darkPanel"
          ? (()=>{ let parsed={eyebrow:"",heading:"",body:""}; try{ parsed=JSON.parse(b.content); }catch{} return <div className="flex flex-col gap-2">
              <input value={parsed.eyebrow} onChange={e=>updateFlatField(i,"eyebrow",e.target.value)} placeholder="Eyebrow" className="w-full bg-transparent outline-none text-[12px] uppercase tracking-[0.06em]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"8px 11px",color:T.teal}}/>
              <textarea value={parsed.heading} onChange={e=>updateFlatField(i,"heading",e.target.value)} rows={2} placeholder="Heading" className="w-full bg-transparent outline-none text-[15px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"9px 12px",color:T.teal,fontFamily:"'Fraunces',serif"}}/>
              <textarea value={parsed.body} onChange={e=>updateFlatField(i,"body",e.target.value)} rows={2} placeholder="Body text" className="w-full bg-transparent outline-none text-[13.5px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"9px 12px",color:T.teal}}/>
            </div>; })()
          : b.blockType==="stepGrid"
          ? (()=>{ let parsed={eyebrow:"",heading:"",steps:[]}; try{ parsed=JSON.parse(b.content); }catch{} return <div className="flex flex-col gap-2">
              <input value={parsed.eyebrow} onChange={e=>updateFlatField(i,"eyebrow",e.target.value)} placeholder="Eyebrow" className="w-full bg-transparent outline-none text-[12px] uppercase tracking-[0.06em]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"8px 11px",color:T.teal}}/>
              <input value={parsed.heading} onChange={e=>updateFlatField(i,"heading",e.target.value)} placeholder="Heading" className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"9px 12px",color:T.teal,fontFamily:"'Fraunces',serif"}}/>
              {parsed.steps.map((s,si)=><div key={si} className="flex items-center gap-2 p-2" style={{border:"1px solid rgba(36,62,65,0.12)",borderRadius:RADIUS.xs}}>
                <input value={s.number} onChange={e=>updateArrayItemField(i,"steps",si,"number",e.target.value)} placeholder="01" className="w-12 bg-transparent outline-none text-[12.5px] text-center" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"7px"}}/>
                <input value={s.title} onChange={e=>updateArrayItemField(i,"steps",si,"title",e.target.value)} placeholder="Title" className="w-28 bg-transparent outline-none text-[12.5px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"7px 9px",color:T.teal}}/>
                <input value={s.description} onChange={e=>updateArrayItemField(i,"steps",si,"description",e.target.value)} placeholder="Description" className="flex-1 bg-transparent outline-none text-[12.5px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"7px 9px",color:T.teal}}/>
                <button onClick={()=>removeArrayItem(i,"steps",si)} style={{color:T.error,flexShrink:0}}><Trash2 size={13}/></button>
              </div>)}
              <button onClick={()=>addArrayItem(i,"steps",{number:String(parsed.steps.length+1).padStart(2,"0"),title:"",description:""})} className="text-[11.5px] uppercase tracking-[0.06em] self-start" style={{color:T.teal}}>+ Add Step</button>
            </div>; })()
          : b.blockType==="cardGrid"
          ? (()=>{ let parsed={cards:[]}; try{ parsed=JSON.parse(b.content); }catch{} return <div className="flex flex-col gap-2">
              {parsed.cards.map((c,ci)=><div key={ci} className="flex flex-col gap-1.5 p-2" style={{border:"1px solid rgba(36,62,65,0.12)",borderRadius:RADIUS.xs}}>
                <div className="flex items-center gap-2">
                  <input value={c.title} onChange={e=>updateArrayItemField(i,"cards",ci,"title",e.target.value)} placeholder="Card title" className="flex-1 bg-transparent outline-none text-[13px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"8px 11px",color:T.teal,fontFamily:"'Fraunces',serif"}}/>
                  <button onClick={()=>removeArrayItem(i,"cards",ci)} style={{color:T.error,flexShrink:0}}><Trash2 size={13}/></button>
                </div>
                <textarea value={c.description} onChange={e=>updateArrayItemField(i,"cards",ci,"description",e.target.value)} rows={2} placeholder="Description" className="w-full bg-transparent outline-none text-[12.5px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"8px 11px",color:T.teal}}/>
              </div>)}
              <button onClick={()=>addArrayItem(i,"cards",{title:"",description:""})} className="text-[11.5px] uppercase tracking-[0.06em] self-start" style={{color:T.teal}}>+ Add Card</button>
            </div>; })()
          : b.blockType==="heroWithCta"
          ? (()=>{ let parsed={eyebrow:"",heading:"",subtext:"",ctaLabel:"",ctaLabel2:""}; try{ parsed=JSON.parse(b.content); }catch{} return <div className="flex flex-col gap-2">
              <input value={parsed.eyebrow} onChange={e=>updateFlatField(i,"eyebrow",e.target.value)} placeholder="Eyebrow (small label above the heading)" className="w-full bg-transparent outline-none text-[12px] uppercase tracking-[0.06em]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"8px 11px",color:T.teal}}/>
              <textarea value={parsed.heading} onChange={e=>updateFlatField(i,"heading",e.target.value)} rows={2} placeholder="Heading — use <br/> for a real line break, **word** for the gold/emphasis span" className="w-full bg-transparent outline-none text-[15px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"9px 12px",color:T.teal,fontFamily:"'Fraunces',serif"}}/>
              <textarea value={parsed.subtext} onChange={e=>updateFlatField(i,"subtext",e.target.value)} rows={2} placeholder="Subtext" className="w-full bg-transparent outline-none text-[13.5px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"9px 12px",color:T.teal}}/>
              <div className="grid grid-cols-2 gap-2">
                <input value={parsed.ctaLabel} onChange={e=>updateFlatField(i,"ctaLabel",e.target.value)} placeholder="Primary button label" className="w-full bg-transparent outline-none text-[13px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"8px 11px",color:T.teal}}/>
                <input value={parsed.ctaLabel2} onChange={e=>updateFlatField(i,"ctaLabel2",e.target.value)} placeholder="Secondary button label" className="w-full bg-transparent outline-none text-[13px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"8px 11px",color:T.teal}}/>
              </div>
              <p className="text-[11px]" style={{color:T.teal}}>Button destinations aren't editable here — only the wording. Ask if a button needs to point somewhere new.</p>
            </div>; })()
          : b.blockType==="footerBrand"
          ? (()=>{ let parsed={tagline:"",email:"",phone:"",instagram:"",location:"",newsletterBlurb:""}; try{ parsed=JSON.parse(b.content); }catch{} return <div className="flex flex-col gap-2">
              <textarea value={parsed.tagline} onChange={e=>updateFlatField(i,"tagline",e.target.value)} rows={2} placeholder="Brand tagline" className="w-full bg-transparent outline-none text-[13.5px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"9px 12px",color:T.teal}}/>
              <div className="grid grid-cols-2 gap-2">
                <input value={parsed.email} onChange={e=>updateFlatField(i,"email",e.target.value)} placeholder="Email" className="w-full bg-transparent outline-none text-[13px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"8px 11px",color:T.teal}}/>
                <input value={parsed.phone} onChange={e=>updateFlatField(i,"phone",e.target.value)} placeholder="Phone (e.g. +91 82780 85572)" className="w-full bg-transparent outline-none text-[13px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"8px 11px",color:T.teal}}/>
                <input value={parsed.instagram} onChange={e=>updateFlatField(i,"instagram",e.target.value)} placeholder="Instagram handle (e.g. @atelier.akara)" className="w-full bg-transparent outline-none text-[13px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"8px 11px",color:T.teal}}/>
                <input value={parsed.location} onChange={e=>updateFlatField(i,"location",e.target.value)} placeholder="Location (e.g. India)" className="w-full bg-transparent outline-none text-[13px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"8px 11px",color:T.teal}}/>
              </div>
              <input value={parsed.newsletterBlurb} onChange={e=>updateFlatField(i,"newsletterBlurb",e.target.value)} placeholder="Newsletter blurb" className="w-full bg-transparent outline-none text-[13px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"8px 11px",color:T.teal}}/>
            </div>; })()
          : <textarea value={b.content} onChange={e=>updateBlock(i,e.target.value)} rows={b.blockType==="table"?3:5} className="w-full bg-transparent outline-none text-[15px] leading-[1.75]" style={{border:"none",borderBottom:"1px solid rgba(184,147,90,0.4)",borderRadius:0,padding:"8px 0 12px",color:T.teal,fontFamily:"'Fraunces',serif"}}/>}
      </div>)}
    </div>

    <div className="pt-6 mt-2" style={{borderTop:"1px solid rgba(184,147,90,0.3)"}}>
      <p className="text-[10px] tracking-[0.18em] uppercase mb-4" style={{color:"rgba(36,62,65,0.5)"}}>Compose</p>
      <div className="flex gap-2 flex-wrap">
      {[
        ["heading","Heading"],["paragraph","Paragraph"],["quote","Quote"],["qa","Q & A"],
        ["bulletList","Bullets"],["hero","Hero"],["heroWithCta","Hero + CTAs"],
        ["darkPanel","Dark panel"],["stepGrid","Steps"],["cardGrid","Cards"],
        ["table","Table"],["footerBrand","Footer brand"],
      ].map(([type,label])=>(
        <button key={type} type="button" onClick={()=>addBlock(type)}
          className="text-[11px] tracking-[0.08em] uppercase px-3.5 py-2 transition-colors"
          style={{color:T.teal,border:`1px solid rgba(24,54,48,0.2)`,borderRadius:999,background:"transparent"}}>
          + {label}
        </button>
      ))}
      </div>
    </div>

    <Modal open={showHistory} onClose={()=>setShowHistory(false)} title="Version History">
      {historyLoading?<Skeleton height={120}/>:
      history.length===0?<p className="text-[13.5px]" style={{color:"rgba(36,62,65,0.75)"}}>No past versions yet — history is saved starting from the next time this page is edited.</p>:
      <div className="flex flex-col gap-2">
        {history.map(v=><div key={v.id} className="flex items-center justify-between gap-3 p-3" style={{border:"1px solid rgba(36,62,65,0.14)",borderRadius:RADIUS.xs}}>
          <div>
            <p className="text-[13px]" style={{color:T.teal}}>{new Date(v.savedAt).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}</p>
            <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}>by {v.savedByName} · {v.blockCount} block{v.blockCount!==1?"s":""}</p>
          </div>
          <SweepButton onClick={()=>revert(v.id)}>Revert to This</SweepButton>
        </div>)}
      </div>}
    </Modal>
  </div>;

  return <div className="p-5 md:p-10 max-w-[960px] mx-auto cms-atelier">
    <div className="mb-10">
      <p className="text-[10px] tracking-[0.22em] uppercase mb-2" style={{color:T.teal,fontWeight:600}}>Manuscripts</p>
      <h1 className="italic text-[32px] md:text-[40px] leading-[1.1] mb-3" style={{fontFamily:"'Fraunces',serif",color:T.teal,fontWeight:400}}>Site content <AdminInfoTip text="Edit customer-facing copy (FAQ, policies, about, homepage sections). Changes publish immediately — no redeploy. Super-admin only." align="left" /></h1>
      <div className="w-12 h-px mb-4" style={{backgroundColor:T.gold}}/>
      <p className="text-[14px] leading-relaxed max-w-xl" style={{color:"rgba(36,62,65,0.68)"}}>
        Policies, About, FAQ, hero lines, footer — edited here, live on the site without a redeploy. Homepage photography lives under Catalog → Homepage hero.
      </p>
    </div>
    {loading?<Skeleton height={200}/>:
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-1">
      {pages.map((p,idx)=>(
        <button key={p.pageKey} type="button" onClick={()=>openPage(p.pageKey)}
          className="group flex items-baseline justify-between gap-4 py-5 text-left w-full transition-colors"
          style={{borderBottom:"1px solid rgba(24,54,48,0.1)",background:"transparent"}}>
          <div className="min-w-0">
            <span className="text-[10px] tracking-[0.14em] uppercase mr-3" style={{color:"rgba(184,147,90,0.9)"}}>{String(idx+1).padStart(2,"0")}</span>
            <span className="text-[17px] md:text-[18px] italic group-hover:underline decoration-1 underline-offset-4" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{p.title}</span>
            <p className="text-[11.5px] mt-1.5 pl-8" style={{color:"rgba(36,62,65,0.55)"}}>
              {p.blockCount} passage{p.blockCount!==1?"s":""}
              {p.lastUpdated?` · ${new Date(p.lastUpdated).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}`:" · not written yet"}
            </p>
          </div>
          <span className="text-[11px] tracking-[0.1em] uppercase shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{color:T.teal}}>Open</span>
        </button>
      ))}
    </div>}
  </div>;
}

function AdminManageAccounts({ admin }){
  const showToast=useToast();
  const [accounts,setAccounts]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showCreate,setShowCreate]=useState(false);
  const [form,setForm]=useState({name:"",email:"",password:"",role:"staff"});
  const [creating,setCreating]=useState(false);
  const [removeTarget,setRemoveTarget]=useState(null);

  const load=()=>{ setLoading(true); fetch("/api/admin/accounts",{credentials:"include"}).then(r=>r.json()).then(d=>{setAccounts(d.accounts||[]);setLoading(false);}); };
  useEffect(load,[]);

  const create=async e=>{
    e.preventDefault();
    setCreating(true);
    try{
      const res=await apiFetch("/api/admin/accounts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
      const data=await res.json().catch(()=>({}));
      if(res.ok){
        showToast("Account created","success");
        setShowCreate(false); setForm({name:"",email:"",password:"",role:"staff"});
        load();
      } else showToast(data.error||"Couldn't create the account.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setCreating(false);
    }
  };

  const remove=async()=>{
    try{
      const res=await apiFetch(`/api/admin/accounts/${removeTarget.id}`,{method:"DELETE"});
      const data=await res.json().catch(()=>({}));
      if(res.ok){ showToast("Account removed","success"); setRemoveTarget(null); load(); }
      else showToast(data.error||"Couldn't remove that account.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }
  };

  const roleLabel={staff:"Staff",admin:"Admin",super_admin:"Super Admin"};
  const roleBadgeVariant={staff:"neutral",admin:"warning",super_admin:"success"};

  return <div className="p-5 md:p-8 max-w-[720px]">
    <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
      <AdminPageHeader eyebrow="System" title="Accounts"
      info="Staff logins for this admin panel (roles: staff / admin / super_admin). Not storefront customers." subtitle="Admin users and roles." />
      <SweepButton filled onClick={()=>setShowCreate(true)}><UserPlus size={14} className="inline mr-1.5" style={{verticalAlign:"-2px"}}/>New Account</SweepButton>
    </div>
    <p className="text-[13.5px] mb-6" style={{color:"rgba(36,62,65,0.75)"}}>Staff can manage orders only. Admin can manage products, customers, and settings. Super Admin has full access, including this screen.</p>

    {loading?<Skeleton height={200}/>:
    <div className="flex flex-col gap-2.5">
      {accounts.map(a=><div key={a.id} className="flex items-center gap-3 p-4" style={ATELIER_ROW}>
        <div className="flex-1 min-w-0">
          <p className="text-[14px]" style={{color:T.teal}}>{a.name}{a.id===admin?.id&&<span className="text-[11px] ml-2" style={{color:"rgba(36,62,65,0.75)"}}>(you)</span>}</p>
          <p className="text-[12px]" style={{color:"rgba(36,62,65,0.75)"}}>{a.email}</p>
        </div>
        <Badge variant={roleBadgeVariant[a.role]}>{roleLabel[a.role]}</Badge>
        {a.id!==admin?.id&&<button onClick={()=>setRemoveTarget(a)} title="Remove account" style={{color:T.error}}><Trash2 size={15}/></button>}
      </div>)}
    </div>}

    <Modal open={showCreate} onClose={()=>setShowCreate(false)} title="New Account">
      <form onSubmit={create} className="flex flex-col gap-4">
        <InputField label="Full Name" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} required/>
        <InputField label="Email" type="email" value={form.email} onChange={v=>setForm(f=>({...f,email:v}))} required/>
        <InputField label="Password" type="password" value={form.password} onChange={v=>setForm(f=>({...f,password:v}))} required/>
        <p className="text-[11px]" style={{color:"rgba(36,62,65,0.75)"}}>10+ characters, an uppercase letter, a number, and a special character.</p>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Role</label>
          <select value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))} className="w-full bg-transparent outline-none text-[13.5px] px-3 py-2.5" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,color:T.teal}}>
            <option value="staff">Staff — order management only</option>
            <option value="admin">Admin — full catalog + operations access</option>
            <option value="super_admin">Super Admin — full access, including account management</option>
          </select>
        </div>
        <SweepButton filled type="submit" disabled={creating}>{creating?"Creating…":"Create Account"}</SweepButton>
      </form>
    </Modal>

    <Modal open={!!removeTarget} onClose={()=>setRemoveTarget(null)} title="Remove this account?" danger confirmLabel="Remove" onConfirm={remove}>
      <p className="text-[13.5px]" style={{color:"rgba(36,62,65,0.75)"}}>{removeTarget?.name} ({removeTarget?.email}) will lose access immediately. Their past activity log entries are kept, just no longer linked to a live account.</p>
    </Modal>
  </div>;
}

// ============================================================================
// TWO-FACTOR AUTHENTICATION — real setup/disable UI for the TOTP system
// built in server/twoFactor.js + server/routes/admin/auth.js. Four real
// states: loading, not set up, mid-setup (QR shown, awaiting the first
// real code before this is ever actually enabled), and enabled
// (disable + regenerate backup codes). The mid-setup step existing at
// all — not just generating a secret and calling it done — is the real
// point: it's what proves the admin can actually produce a valid code
// from what they just scanned, before 2FA starts being REQUIRED at
// every future login.
// ============================================================================
function AdminTwoFactorSettings({ admin }){
  const accountEmail = admin?.email || "this signed-in account";

  const showToast=useToast();
  const [status,setStatus]=useState(null); // {enabled, remainingBackupCodes}
  const [loading,setLoading]=useState(true);
  const [setupData,setSetupData]=useState(null); // {secret, qrCodeDataUrl} — only set while mid-setup
  const [verifyCode,setVerifyCode]=useState("");
  const [submitting,setSubmitting]=useState(false);
  const [newBackupCodes,setNewBackupCodes]=useState(null); // shown ONCE, right after a successful enable
  const [showDisableModal,setShowDisableModal]=useState(false);
  const [disablePassword,setDisablePassword]=useState("");

  const loadStatus=()=>{ setLoading(true); fetch("/api/admin/auth/2fa/status",{credentials:"include"}).then(r=>r.json()).then(d=>{setStatus(d);setLoading(false);}); };
  useEffect(loadStatus,[]);

  const startSetup=async()=>{
    setSubmitting(true);
    try{
      const res=await apiFetch("/api/admin/auth/2fa/setup",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      const data=await res.json();
      if(res.ok) setSetupData(data);
      else showToast(data.error||"Couldn't start setup.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setSubmitting(false);
    }
  };

  const confirmEnable=async e=>{
    e.preventDefault();
    setSubmitting(true);
    try{
      const res=await apiFetch("/api/admin/auth/2fa/enable",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({secret:setupData.secret,code:verifyCode.trim()})});
      const data=await res.json();
      if(res.ok){
        // Real backup codes, shown exactly once — there's no way to
        // ever see these again after this screen closes, since only
        // their bcrypt hashes are stored (same as a real password).
        setNewBackupCodes(data.backupCodes);
        setSetupData(null); setVerifyCode("");
        loadStatus();
        showToast("Two-factor authentication enabled","success");
      } else {
        showToast(data.error||"That code isn't correct.","error");
      }
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setSubmitting(false);
    }
  };

  const confirmDisable=async()=>{
    setSubmitting(true);
    try{
      const res=await apiFetch("/api/admin/auth/2fa/disable",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:disablePassword})});
      const data=await res.json();
      if(res.ok){ showToast("Two-factor authentication disabled","success"); setShowDisableModal(false); setDisablePassword(""); loadStatus(); }
      else showToast(data.error||"Couldn't disable 2FA.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setSubmitting(false);
    }
  };

  if(loading) return <div className="p-6" style={ATELIER_PANEL}><p className="text-[12.5px] mb-4" style={{color:T.teal}}>Setting up for <strong>{accountEmail}</strong> only — other admin accounts are not affected.</p><p className="text-[12.5px] mb-3" style={{color:T.teal}}>Account: <strong>{accountEmail}</strong></p><Skeleton height={80}/></div>;

  // Real backup-codes-shown-once screen — genuinely can't be reached
  // again after leaving it, by design.
  if(newBackupCodes) return <div className="p-6" style={ATELIER_PANEL}><p className="text-[12.5px] mb-4" style={{color:T.teal}}>Setting up for <strong>{accountEmail}</strong> only — other admin accounts are not affected.</p>
    <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Save your backup codes</p>
    <p className="text-[12.5px] mb-4" style={{color:"rgba(36,62,65,0.75)"}}>Each code works once, if you ever lose access to your authenticator app. This is the only time these will be shown — save them somewhere real, like a password manager.</p>
    <div className="grid grid-cols-2 gap-2 mb-5 p-4" style={{backgroundColor:"rgba(36,62,65,0.04)",borderRadius:RADIUS.sm}}>
      {newBackupCodes.map(c=><span key={c} className="text-[13px] font-mono" style={{color:T.teal}}>{c}</span>)}
    </div>
    <SweepButton filled onClick={()=>setNewBackupCodes(null)}>I've saved these — Done</SweepButton>
  </div>;

  // Real mid-setup: QR code + the one real verify-before-enable step.
  if(setupData) return <div className="p-6" style={ATELIER_PANEL}><p className="text-[12.5px] mb-4" style={{color:T.teal}}>Setting up for <strong>{accountEmail}</strong> only — other admin accounts are not affected.</p>
    <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Set up two-factor authentication</p>
    <p className="text-[12.5px] mb-4" style={{color:"rgba(36,62,65,0.75)"}}>Scan this with Google Authenticator, Authy, or any real TOTP app, then enter the 6-digit code it shows to confirm.</p>
    <img src={setupData.qrCodeDataUrl} alt="2FA setup QR code" className="mb-4" style={{width:180,height:180,borderRadius:RADIUS.sm}}/>
    <p className="text-[11px] mb-4" style={{color:"rgba(36,62,65,0.75)"}}>Can't scan? Enter this key manually: <span className="font-mono">{setupData.secret}</span></p>
    <form onSubmit={confirmEnable} className="flex flex-col gap-3">
      <InputField label="6-Digit Code" value={verifyCode} onChange={v=>setVerifyCode(v.replace(/\D/g,"").slice(0,6))} placeholder="123456" required/>
      <div className="flex gap-3">
        <SweepButton filled type="submit" disabled={submitting||verifyCode.length!==6}>{submitting?"Verifying…":"Verify & Enable"}</SweepButton>
        <SweepButton onClick={()=>{setSetupData(null);setVerifyCode("");}}>Cancel</SweepButton>
      </div>
    </form>
  </div>;

  return <div className="p-6" style={ATELIER_PANEL}>
    <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Two-Factor Authentication</p>
    <p className="text-[12.5px] mb-5" style={{color:"rgba(36,62,65,0.75)"}}>
      {status.enabled?`Enabled — ${status.remainingBackupCodes} backup code${status.remainingBackupCodes!==1?"s":""} remaining.`:"Adds a real second step at login, beyond your password. Recommended, especially for Super Admin accounts."}
    </p>
    {status.enabled
      ?<SweepButton onClick={()=>setShowDisableModal(true)}>Disable</SweepButton>
      :<SweepButton filled onClick={startSetup} disabled={submitting}>{submitting?"Starting…":"Set Up 2FA"}</SweepButton>}
    <Modal open={showDisableModal} onClose={()=>{setShowDisableModal(false);setDisablePassword("");}} title="Disable two-factor authentication?" danger confirmLabel={submitting?"Disabling…":"Disable"} onConfirm={confirmDisable}>
      <p className="text-[13.5px] mb-4" style={{color:"rgba(36,62,65,0.75)"}}>This removes the extra login step and your saved backup codes. Enter your password to confirm.</p>
      <InputField label="Password" type="password" value={disablePassword} onChange={setDisablePassword} required/>
    </Modal>
  </div>;
}

// Real, admin-only Android app update channel — directly requested,
// following the real, official mobile integration guide. Deliberately
// a real, TWO-STEP flow, not a single "publish" button: (1) upload the
// real, actual .apk file, which goes straight to R2 and returns its
// real, resulting URL, then (2) separately fill in the real version
// name/code/release notes and publish — matches the real, existing
// backend design (server/routes/admin/settings.js's own comment
// explains why: an admin should be able to upload a real build, then
// choose exactly when to actually make it live, e.g. after writing
// real release notes, not the instant the upload finishes).
function AdminAndroidAppSettings(){
  const showToast=useToast();
  const [current,setCurrent]=useState(null);
  const [loading,setLoading]=useState(true);
  const [uploading,setUploading]=useState(false);
  const [publishing,setPublishing]=useState(false);
  const [pendingApkUrl,setPendingApkUrl]=useState("");
  const [form,setForm]=useState({versionName:"",versionCode:"",minVersionCode:"",releaseNotes:"",forceUpdate:false});
  // REAL, DIRECT FIX: directly reported — uploaded a real, working APK
  // and saw no way to actually save/publish it. Traced the real, likely
  // cause: this panel's ONLY feedback on a genuine failure was a toast
  // that auto-dismisses after 3.2 seconds at the very BOTTOM of the
  // screen, while an admin's attention is naturally on the upload
  // control at the TOP — a real, live failure could easily be missed
  // entirely, looking exactly like "nothing happened." uploadError is a
  // real, PERSISTENT error state shown directly in this panel, right
  // where the admin is actually looking, that stays visible until they
  // genuinely dismiss it or try again — never silently disappears.
  const [uploadError,setUploadError]=useState(null);

  const loadCurrent=()=>{
    setLoading(true);
    fetch("/api/admin/settings/android-app",{credentials:"include"}).then(r=>r.json()).then(d=>{
      setCurrent(d);
      setLoading(false);
      // Real, sensible defaults for the form: pre-fill with whatever's
      // currently live, so publishing a small, real fix (like updated
      // release notes) doesn't require re-typing every other real field.
      if(d.versionName) setForm(f=>({...f,versionName:d.versionName,versionCode:String(d.versionCode||""),minVersionCode:d.minVersionCode?String(d.minVersionCode):"",releaseNotes:d.releaseNotes||"",forceUpdate:!!d.forceUpdate}));
    }).catch(()=>setLoading(false));
  };
  useEffect(loadCurrent,[]);

  const uploadApk=async(file)=>{
    setUploading(true);
    setUploadError(null);
    try{
      const body=new FormData();
      body.append("apk",file);
      const res=await apiFetch("/api/admin/settings/android-app/upload",{method:"POST",body});
      // Real, defensive parsing: if the server genuinely returned
      // something that isn't valid JSON at all (e.g. a raw, real
      // platform-level error page from a proxy/CDN sitting in front of
      // this app, rather than this app's own real JSON error response),
      // data.error will be undefined — the real fallback message below
      // still fires, but the real, raw response text is captured too
      // so a genuinely unusual failure can actually be diagnosed later,
      // not just reported as an opaque "couldn't upload."
      let data={};
      let rawText="";
      try{ rawText=await res.text(); data=JSON.parse(rawText); }catch{ /* real, non-JSON response, handled below */ }
      if(res.ok){
        setPendingApkUrl(data.apkUrl);
        showToast("APK uploaded — fill in the version details below, then publish.","success");
      } else {
        const message=data.error||`Upload failed (server responded with status ${res.status}).`;
        setUploadError({message,detail:!data.error&&rawText?rawText.slice(0,300):null,status:res.status});
        showToast(message,"error");
      }
    }catch(e){
      setUploadError({message:"Couldn't reach the server — check your internet connection and try again.",detail:e?.message||null});
      showToast("Couldn't reach the server.","error");
    }finally{
      setUploading(false);
    }
  };

  const publish=async e=>{
    e.preventDefault();
    const apkUrl=pendingApkUrl||current?.apkUrl;
    if(!apkUrl){ showToast("Upload a real APK file first.","error"); return; }
    const versionCode=Number(form.versionCode);
    if(!Number.isInteger(versionCode)||versionCode<1){ showToast("Version code must be a real, positive whole number.","error"); return; }
    setPublishing(true);
    try{
      const res=await apiFetch("/api/admin/settings/android-app",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        versionName:form.versionName.trim(),
        versionCode,
        minVersionCode:form.minVersionCode?Number(form.minVersionCode):null,
        apkUrl,
        releaseNotes:form.releaseNotes,
        forceUpdate:form.forceUpdate,
      })});
      const data=await res.json().catch(()=>({}));
      if(res.ok){
        showToast(`Published version ${form.versionName} — live at /app/android-version.json`,"success");
        setPendingApkUrl("");
        loadCurrent();
      } else {
        showToast(data.error||"Couldn't publish this version.","error");
      }
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setPublishing(false);
    }
  };

  if(loading) return <div className="p-6" style={ATELIER_PANEL}>
    <p className="text-[13.5px]" style={{color:T.muted}}>Loading…</p>
  </div>;

  return <div className="p-6" style={ATELIER_PANEL}>
    <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Android App</p>
    <p className="text-[12.5px] mb-5" style={{color:"rgba(36,62,65,0.75)"}}>
      {current?.versionName?`Live version: ${current.versionName} (code ${current.versionCode})`:"No version published yet — the app's update check will show nothing to install."}
    </p>

    <div className="mb-5 p-4" style={{backgroundColor:"rgba(24,54,48,0.04)",borderRadius:RADIUS.xs}}>
      <p className="text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>1. Upload the real .apk file</p>
      <input type="file" accept=".apk" disabled={uploading} onChange={e=>{ const f=e.target.files?.[0]; if(f) uploadApk(f); }}
        className="text-[13px]" style={{color:T.teal}}/>
      {uploading&&<p className="text-[12px] mt-2" style={{color:T.muted}}>Uploading…</p>}
      {pendingApkUrl&&<p className="text-[12px] mt-2" style={{color:T.success}}>✓ Uploaded — ready to publish below.</p>}
      {/* Real, persistent, impossible-to-miss error block — stays
          visible right here, next to the upload control, until the
          admin dismisses it or successfully uploads something else.
          Never silently disappears the way the toast alone did. */}
      {uploadError&&<div className="mt-3 p-3 flex items-start gap-2" style={{backgroundColor:"rgba(168,59,50,0.08)",borderRadius:RADIUS.xs,border:"1px solid rgba(168,59,50,0.25)"}}>
        <AlertTriangle size={15} style={{color:T.error,flexShrink:0,marginTop:"2px"}}/>
        <div className="flex-1">
          <p className="text-[12.5px]" style={{color:T.error}}>{uploadError.message}</p>
          {uploadError.status&&<p className="text-[11px] mt-1" style={{color:"rgba(36,62,65,0.6)"}}>Status code: {uploadError.status}</p>}
          {uploadError.detail&&<p className="text-[10.5px] mt-1 font-mono break-all" style={{color:"rgba(36,62,65,0.55)"}}>{uploadError.detail}</p>}
          <button onClick={()=>setUploadError(null)} className="text-[11px] underline mt-1.5" style={{color:T.error}}>Dismiss</button>
        </div>
      </div>}
    </div>

    <form onSubmit={publish} className="flex flex-col gap-4">
      <p className="text-[11px] tracking-[0.08em] uppercase" style={{color:"rgba(36,62,65,0.75)"}}>2. Publish the version details</p>
      {/* REAL, DIRECT FIX for a genuine, real point of confusion: the
          save action is labeled "Publish This Version" — deliberately,
          since that's precisely what it does (makes this version live
          to real, actual customers immediately) — but an admin looking
          specifically for a button that says "Save" could easily miss
          it. This line makes the real, actual relationship explicit. */}
      <p className="text-[11.5px] -mt-2" style={{color:"rgba(36,62,65,0.6)"}}>This is the real "Save" step — nothing above is stored as the live version until you fill this in and click Publish below.</p>
      <div className="grid grid-cols-2 gap-4">
        <InputField label="Version Name (e.g. 0.8.0)" value={form.versionName} onChange={v=>setForm(f=>({...f,versionName:v}))} required/>
        <InputField label="Version Code (whole number, increase each release)" value={form.versionCode} onChange={v=>setForm(f=>({...f,versionCode:v.replace(/\D/g,"")}))} required/>
      </div>
      <InputField label="Minimum Version Code (optional — forces older installs to update)" value={form.minVersionCode} onChange={v=>setForm(f=>({...f,minVersionCode:v.replace(/\D/g,"")}))}/>
      <div>
        <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Release Notes</label>
        <textarea value={form.releaseNotes} onChange={e=>setForm(f=>({...f,releaseNotes:e.target.value}))} rows={3}
          className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,padding:"13px 14px",color:T.teal}}/>
      </div>
      <label className="flex items-center gap-2 text-[13px]" style={{color:T.teal}}>
        <input type="checkbox" checked={form.forceUpdate} onChange={e=>setForm(f=>({...f,forceUpdate:e.target.checked}))}/>
        Force update (blocks the app until the customer updates — use only for a real, critical fix)
      </label>
      {!pendingApkUrl&&!current?.apkUrl&&<p className="text-[11.5px]" style={{color:T.warning}}>Upload a real APK file above first — this button stays disabled until you do.</p>}
      <SweepButton filled type="submit" disabled={publishing||(!pendingApkUrl&&!current?.apkUrl)}>{publishing?"Publishing…":"Publish This Version (Save)"}</SweepButton>
    </form>
  </div>;
}

function AdminSettings({ admin }){
  const showToast=useToast();
  const [salesPaused,setSalesPaused]=useState(false);
  const [lookbookForm,setLookbookForm]=useState({enabled:true,hasPassword:false,pdfUrl:"",password:""});
  const [lookbookSaving,setLookbookSaving]=useState(false);
  const [salesSaving,setSalesSaving]=useState(false);
  useEffect(()=>{
    if(admin?.role!=="super_admin") return;
    fetch("/api/admin/settings/sales-pause",{credentials:"include"}).then(r=>r.ok?r.json():null).then(d=>{ if(d) setSalesPaused(!!d.salesPaused); }).catch(()=>{});
    fetch("/api/admin/settings/lookbook",{credentials:"include"}).then(r=>r.ok?r.json():null).then(d=>{ if(d) setLookbookForm(f=>({...f,enabled:d.enabled!==false,hasPassword:!!d.hasPassword,pdfUrl:d.pdfUrl||"",password:""})); }).catch(()=>{});
  },[admin?.role]);
  
  const saveLookbook=async()=>{
    setLookbookSaving(true);
    try{
      const body={enabled:lookbookForm.enabled,pdfUrl:lookbookForm.pdfUrl};
      if(lookbookForm.password.trim()) body.password=lookbookForm.password.trim();
      const res=await apiFetch("/api/admin/settings/lookbook",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await res.json().catch(()=>({}));
      if(!res.ok){ showToast(data.error||"Could not save lookbook settings","error"); return; }
      setLookbookForm(f=>({...f,enabled:data.enabled!==false,hasPassword:!!data.hasPassword,pdfUrl:data.pdfUrl||"",password:""}));
      showToast("Lookbook settings saved","success");
    }catch{ showToast("Network error","error"); }
    finally{ setLookbookSaving(false); }
  };

  const saveSalesPause=async(next)=>{
    setSalesSaving(true);
    try{
      const res=await apiFetch("/api/admin/settings/sales-pause",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:next})});
      const data=await res.json().catch(()=>({}));
      if(res.ok){ setSalesPaused(!!data.salesPaused); showToast(data.salesPaused?"Sales paused — all pieces show as unavailable":"Sales live again","success"); }
      else showToast(data.error||"Couldn't update sales mode.","error");
    }catch{ showToast("Couldn't reach the server.","error"); }
    finally{ setSalesSaving(false); }
  };

  const [form,setForm]=useState({current:"",next:"",confirm:""});
  const [submitting,setSubmitting]=useState(false);
  const changePassword=async e=>{
    e.preventDefault();
    if(form.next!==form.confirm){ showToast("New password and confirmation don't match.","error"); return; }
    setSubmitting(true);
    try{
      const res=await apiFetch("/api/admin/auth/password",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({currentPassword:form.current,newPassword:form.next})});
      const data=await res.json();
      if(res.ok){ showToast("Password changed","success"); setForm({current:"",next:"",confirm:""}); }
      else showToast(data.error||"Couldn't change your password.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setSubmitting(false);
    }
  };

  // Shipping settings
  const [shipForm,setShipForm]=useState({shippingCost:"",freeShippingThreshold:""});
  const [shipLoading,setShipLoading]=useState(true);
  const [shipSaving,setShipSaving]=useState(false);
  // "Still under construction" homepage notice — same settings fetch as
  // shipping above, just pulling the other two fields out of the same
  // response.
  const [maintForm,setMaintForm]=useState({enabled:false,message:""});
  const [maintSaving,setMaintSaving]=useState(false);
  // Cash on Delivery toggle — same shared settings fetch, just one more
  // boolean pulled out of the same response.
  const [codEnabled,setCodEnabled]=useState(false);
  const [codFee,setCodFee]=useState("99");
  const [codSaving,setCodSaving]=useState(false);
  useEffect(()=>{
    fetch("/api/admin/settings",{credentials:"include"}).then(r=>r.json())
      .then(d=>{
        setShipForm({shippingCost:String(d.shippingCost),freeShippingThreshold:String(d.freeShippingThreshold)});
        setMaintForm({enabled:!!d.maintenanceMode,message:d.maintenanceMessage||""});
        setCodEnabled(!!d.codEnabled);
        setCodFee(String(d.codFee??99));
      })
      .finally(()=>setShipLoading(false));
  },[]);
  // toggle=true keeps the toggle switch itself simple (flip on/off,
  // don't require re-typing the fee just to turn COD on) — fee is only
  // actually sent to the server when this is called from the Save Fee
  // button below, via includeFee.
  const saveCod=async(next,includeFee=false)=>{
    setCodSaving(true);
    try{
      const body=includeFee?{enabled:next,fee:Number(codFee)}:{enabled:next};
      const res=await apiFetch("/api/admin/settings/cod",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await res.json();
      if(res.ok){ setCodEnabled(next); showToast(includeFee?"COD fee saved":next?"Cash on Delivery is now available at checkout":"Cash on Delivery turned off","success"); }
      else showToast(data.error||"Couldn't save that.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setCodSaving(false);
    }
  };
  const saveMaintenance=async(next)=>{
    setMaintSaving(true);
    try{
      const res=await apiFetch("/api/admin/settings/maintenance",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:next.enabled,message:next.message})});
      const data=await res.json();
      if(res.ok){ setMaintForm(next); showToast(next.enabled?"Maintenance notice is now live on the homepage":"Maintenance notice turned off","success"); }
      else showToast(data.error||"Couldn't save that.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setMaintSaving(false);
    }
  };
  const saveShipping=async e=>{
    e.preventDefault();
    setShipSaving(true);
    try{
      const res=await apiFetch("/api/admin/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({shippingCost:Number(shipForm.shippingCost),freeShippingThreshold:Number(shipForm.freeShippingThreshold)})});
      const data=await res.json();
      if(res.ok) showToast("Shipping settings saved — applies to every checkout from now on","success");
      else showToast(data.error||"Couldn't save shipping settings.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setShipSaving(false);
    }
  };

  // Coupons
  const [coupons,setCoupons]=useState([]); const [couponsLoading,setCouponsLoading]=useState(true);
  const [newCoupon,setNewCoupon]=useState({code:"",discountPercent:"10",expiresAt:"",maxRedemptions:"",usageMode:"once",offerKind:"percent",maxDiscountAmount:"",minOrderAmount:"",featured:false,showOnCheckout:true,label:""});
  const loadCoupons=()=>{ setCouponsLoading(true); fetch("/api/admin/settings/coupons",{credentials:"include"}).then(r=>r.json()).then(d=>setCoupons(d.coupons||[])).finally(()=>setCouponsLoading(false)); };
  useEffect(loadCoupons,[]);
  const createCoupon=async e=>{
    e.preventDefault();
    const pct=Number(newCoupon.discountPercent);
    if(!String(newCoupon.code||"").trim()){ showToast("Enter a coupon code.","error"); return; }
    if(!Number.isFinite(pct)||pct<1||pct>100){ showToast("Discount % must be between 1 and 100.","error"); return; }
    const usage=newCoupon.usageMode||"once";
    const maxDisc = newCoupon.offerKind==="upto" && newCoupon.maxDiscountAmount
      ? Number(newCoupon.maxDiscountAmount) : null;
    if(newCoupon.offerKind==="upto" && (!maxDisc || maxDisc<=0)){
      showToast("For “upto” offers, enter a max savings amount in ₹.","error"); return;
    }
    const minOrd = newCoupon.minOrderAmount ? Number(newCoupon.minOrderAmount) : null;
    if(minOrd!=null && (!Number.isFinite(minOrd)||minOrd<=0)){ showToast("Minimum order must be a positive amount.","error"); return; }
    const res=await apiFetch("/api/admin/settings/coupons",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      code:String(newCoupon.code).trim(),
      discountPercent:Math.round(pct),
      expiresAt:newCoupon.expiresAt||null,
      maxRedemptions:newCoupon.maxRedemptions?Number(newCoupon.maxRedemptions):null,
      minOrderAmount: minOrd,
      onePerCustomer:usage==="once"||usage==="first",
      firstOrderOnly:usage==="first",
      maxDiscountAmount: maxDisc,
      featured:!!newCoupon.featured,
      showOnCheckout: newCoupon.showOnCheckout !== false,
      label:newCoupon.label||null,
    })});
    const data=await res.json().catch(()=>({}));
    if(res.ok){
      setNewCoupon({code:"",discountPercent:"10",expiresAt:"",maxRedemptions:"",usageMode:"once",offerKind:"percent",maxDiscountAmount:"",minOrderAmount:"",featured:false,showOnCheckout:true,label:""});
      loadCoupons();
      showToast("Coupon created","success");
    } else showToast(data.error||"Couldn't create that coupon.","error");
  };
  const toggleCoupon=async c=>{
    const res=await apiFetch(`/api/admin/settings/coupons/${c.code}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({active:!c.active})});
    if(res.ok){ loadCoupons(); showToast(`${c.code} ${c.active?"deactivated":"activated"}`,"success"); }
    else showToast("Couldn't update that coupon.","error");
  };
  // Featured is toggled independently from active/inactive — a coupon
  // can be perfectly active and redeemable while genuinely staying
  // private (the default), or a real admin decision to advertise it
  // broadly. Requires a real label the first time a coupon is featured
  // (enforced server-side too, not just here) — customers see this
  // text, not the raw discount percentage.
  const toggleFeatured=async c=>{
    if(!c.featured&&!c.label){
      const label=window.prompt(`What should the public banner say for ${c.code}? (e.g. "10% off your first order")`);
      if(!label||!label.trim()) return;
      const res=await apiFetch(`/api/admin/settings/coupons/${c.code}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({featured:true,label:label.trim()})});
      if(res.ok){ loadCoupons(); showToast(`${c.code} is now featured publicly`,"success"); }
      else showToast("Couldn't update that coupon.","error");
      return;
    }
    const res=await apiFetch(`/api/admin/settings/coupons/${c.code}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({featured:!c.featured})});
    if(res.ok){ loadCoupons(); showToast(`${c.code} ${c.featured?"is no longer featured publicly":"is now featured publicly"}`,"success"); }
    else showToast("Couldn't update that coupon.","error");
  };
  const toggleShowCheckout=async c=>{
    const res=await apiFetch(`/api/admin/settings/coupons/${c.code}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({showOnCheckout:!(c.showOnCheckout!==false)})});
    if(res.ok){ loadCoupons(); showToast(`${c.code} ${c.showOnCheckout!==false?"hidden from":"shown at"} checkout`,"success"); }
    else showToast("Couldn't update that coupon.","error");
  };
  const [deleteCouponTarget,setDeleteCouponTarget]=useState(null);
  const confirmDeleteCoupon=async()=>{
    const res=await apiFetch(`/api/admin/settings/coupons/${deleteCouponTarget}`,{method:"DELETE"});
    if(res.ok){ loadCoupons(); showToast("Coupon deleted","success"); }
    else showToast("Couldn't delete that coupon.","error");
  };

  // Pickup Locations — each name here MUST exactly match an address
  // nickname already registered on Shiprocket's own dashboard, since
  // that's how a shipment gets told which of the business's real pickup
  // addresses to collect from.
  const [pickupLocations,setPickupLocations]=useState([]); const [pickupLocationsLoading,setPickupLocationsLoading]=useState(true);
  const [newPickupLocation,setNewPickupLocation]=useState("");
  const loadPickupLocations=()=>{ setPickupLocationsLoading(true); fetch("/api/admin/settings/pickup-locations",{credentials:"include"}).then(r=>r.json()).then(d=>setPickupLocations(d.pickupLocations||[])).finally(()=>setPickupLocationsLoading(false)); };
  useEffect(loadPickupLocations,[]);
  const createPickupLocation=async e=>{
    e.preventDefault();
    const res=await apiFetch("/api/admin/settings/pickup-locations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:newPickupLocation})});
    const data=await res.json();
    if(res.ok){ setNewPickupLocation(""); loadPickupLocations(); showToast("Pickup location added","success"); }
    else showToast(data.error||"Couldn't add that pickup location.","error");
  };
  const [deletePickupLocationTarget,setDeletePickupLocationTarget]=useState(null);
  const confirmDeletePickupLocation=async()=>{
    const res=await apiFetch(`/api/admin/settings/pickup-locations/${deletePickupLocationTarget.id}`,{method:"DELETE"});
    if(res.ok){ loadPickupLocations(); showToast("Pickup location removed","success"); }
    else showToast("Couldn't remove that pickup location.","error");
  };

  // REAL, DIRECT LAYOUT FIX: this page's own outer container had a
  // hardcoded max-w-[520px] — a fixed, narrow, real pixel width applied
  // unconditionally, regardless of real screen size. On any genuinely
  // wide, real desktop monitor, every card on this page hugged the
  // left edge, leaving the entire right half of the screen empty —
  // reported directly as looking broken/unfinished, and it genuinely
  // was: nothing about that width was a deliberate, real design
  // choice, it was simply never widened as more real cards (Coupons,
  // Pickup Locations, Android App) were added to this same page over
  // time. Fixed to a real, responsive 2-column grid on wider screens —
  // each individual card stays a real, comfortable, readable width
  // (matching what it looked like before), but two now sit side by
  // side, genuinely using the available real space instead of leaving
  // it empty. Falls back to one, real, single column on mobile, where
  // two real narrow columns would be genuinely uncomfortable to use.
  return <div className="p-5 md:p-8">
    <AdminPageHeader eyebrow="System" title="Settings"
      info="Shipping thresholds, studio capacity, sales on/off, 2FA, Android APK links, and related shop preferences." subtitle="Shipping, studio, and security preferences for the shop." />
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 items-start">

    <div className="p-6 flex flex-col h-full min-h-[280px]" style={ATELIER_PANEL}>
      <p className="text-[10px] tracking-[0.16em] uppercase mb-2" style={{color:T.teal,fontWeight:600}}>01 · Shipping</p>
      <p className="italic text-[20px] mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Rates</p>
      <p className="text-[12.5px] mb-5" style={{color:"rgba(36,62,65,0.75)"}}>Applies to every checkout immediately — no deploy needed.</p>
      {shipLoading?<Skeleton height={90}/>:
      <form onSubmit={saveShipping} className="flex flex-col gap-4">
        <InputField label="Shipping Cost (₹)" value={shipForm.shippingCost} onChange={v=>setShipForm(f=>({...f,shippingCost:v}))} required/>
        <InputField label="Free Shipping Above (₹)" value={shipForm.freeShippingThreshold} onChange={v=>setShipForm(f=>({...f,freeShippingThreshold:v}))} required/>
        <SweepButton filled type="submit" disabled={shipSaving}>{shipSaving?"Saving…":"Save Shipping Settings"}</SweepButton>
      </form>}
    </div>

    <div className="p-6 flex flex-col h-full min-h-[280px]" style={ATELIER_PANEL}>
      <p className="text-[10px] tracking-[0.16em] uppercase mb-2" style={{color:T.teal,fontWeight:600}}>02 · Presence</p>
      <p className="italic text-[20px] mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Homepage notice</p>
      <p className="text-[12.5px] mb-5" style={{color:"rgba(36,62,65,0.75)"}}>Shows a dismissible "still under construction" popup to homepage visitors. Turn this off once the site is ready — no deploy needed.</p>
      {shipLoading?<Skeleton height={90}/>:
      <div className="flex flex-col gap-4">
        <button type="button" onClick={()=>saveMaintenance({...maintForm,enabled:!maintForm.enabled})} disabled={maintSaving}
          className="w-full flex items-center justify-between px-4 py-3" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs}}>
          <span className="text-[13px]" style={{color:T.teal}}>{maintForm.enabled?"Notice is live":"Notice is off"}</span>
          <span className="w-10 h-6 flex items-center px-0.5 transition-colors" style={{backgroundColor:maintForm.enabled?T.success:"rgba(36,62,65,0.2)",borderRadius:RADIUS.lg}}>
            <span className="w-5 h-5 bg-white transition-transform" style={{borderRadius:"50%",transform:maintForm.enabled?"translateX(16px)":"translateX(0)"}}/>
          </span>
        </button>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Message shown to visitors</label>
          <textarea value={maintForm.message} onChange={e=>setMaintForm(f=>({...f,message:e.target.value}))} rows={3} maxLength={300}
            className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"11px 13px",borderRadius:RADIUS.xs,color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
        </div>
        <SweepButton filled onClick={()=>saveMaintenance(maintForm)} disabled={maintSaving}>{maintSaving?"Saving…":"Save Message"}</SweepButton>
      </div>}
    </div>

    <div className="p-6 flex flex-col h-full min-h-[280px]" style={ATELIER_PANEL}>
      <p className="text-[10px] tracking-[0.16em] uppercase mb-2" style={{color:T.teal,fontWeight:600}}>03 · Checkout</p>
      <p className="italic text-[20px] mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Cash on delivery</p>
      <p className="text-[12.5px] mb-5" style={{color:"rgba(36,62,65,0.75)"}}>Lets customers pay in cash when their order arrives, instead of paying online through Razorpay. Useful for safely testing the full order flow without real money.</p>
      {shipLoading?<Skeleton height={130}/>:
      <div className="flex flex-col gap-4">
        <button type="button" onClick={()=>saveCod(!codEnabled)} disabled={codSaving}
          className="w-full flex items-center justify-between px-4 py-3" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs}}>
          <span className="text-[13px]" style={{color:T.teal}}>{codEnabled?"Available at checkout":"Turned off"}</span>
          <span className="w-10 h-6 flex items-center px-0.5 transition-colors" style={{backgroundColor:codEnabled?T.success:"rgba(36,62,65,0.2)",borderRadius:RADIUS.lg}}>
            <span className="w-5 h-5 bg-white transition-transform" style={{borderRadius:"50%",transform:codEnabled?"translateX(16px)":"translateX(0)"}}/>
          </span>
        </button>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <InputField label="COD Handling Fee (₹)" value={codFee} onChange={setCodFee}/>
          </div>
          <SweepButton filled onClick={()=>saveCod(codEnabled,true)} disabled={codSaving} className="!py-3">{codSaving?"Saving…":"Save Fee"}</SweepButton>
        </div>
        <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}>Added to the order total only when a customer chooses Cash on Delivery — never on online payments.</p>
      </div>}
    </div>

    <div className="p-6 md:col-span-2 xl:col-span-3" style={ATELIER_PANEL}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <p className="text-[10px] tracking-[0.16em] uppercase mb-1" style={{color:T.teal,fontWeight:600}}>04 · Offers</p>
          <p className="italic text-[20px] mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Coupon codes</p>
          <p className="text-[12.5px] max-w-2xl" style={{color:"rgba(36,62,65,0.75)"}}>
            Control where each code appears: <strong>top banner</strong> (site-wide) and/or <strong>checkout &amp; cart</strong> (offer cards). One code per order — never stacked.
          </p>
        </div>
      </div>
      {couponsLoading?<Skeleton height={60}/>:
      <div className="flex flex-col gap-2 mb-5 max-h-[220px] overflow-y-auto pr-1">
        {coupons.length===0?<p className="text-[13px]" style={{color:"rgba(36,62,65,0.75)"}}>No coupons yet.</p>:
        coupons.map(c=>(
          <div key={c.code} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 px-3" style={{border:"1px solid rgba(36,62,65,0.08)",borderRadius:8,background:"rgba(255,255,255,0.35)"}}>
            <span className="text-[13.5px] font-medium min-w-[5.5rem]" style={{color:T.teal}}>{c.code}</span>
            <span className="text-[12.5px]" style={{color:"rgba(36,62,65,0.7)"}}>{c.discountPercent}% off{c.maxDiscountAmount!=null?` upto ₹${c.maxDiscountAmount}`:""}{c.minOrderAmount!=null?` · min ₹${c.minOrderAmount}`:""}</span>
            <Badge variant={c.active?"success":"neutral"}>{c.active?"active":"off"}</Badge>
            {c.featured&&<Badge variant="warning">banner</Badge>}
            {c.showOnCheckout!==false&&<Badge variant="neutral">checkout</Badge>}
            {c.onePerCustomer&&<Badge variant="neutral">1× person</Badge>}
            <div className="flex flex-wrap gap-2 ml-auto text-[11.5px]">
              <button type="button" onClick={()=>toggleFeatured(c)} className="underline" style={{color:c.featured?T.gold:T.teal}}>{c.featured?"Remove banner":"Show on banner"}</button>
              <button type="button" onClick={()=>toggleShowCheckout(c)} className="underline" style={{color:T.teal}}>{c.showOnCheckout!==false?"Hide at checkout":"Show at checkout"}</button>
              <button type="button" onClick={()=>toggleCoupon(c)} className="underline" style={{color:T.teal}}>{c.active?"Deactivate":"Activate"}</button>
              <button type="button" onClick={()=>setDeleteCouponTarget(c.code)} style={{color:T.error}}><Trash2 size={ICON.sm}/></button>
            </div>
          </div>
        ))}
      </div>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2" style={{borderTop:"1px solid rgba(36,62,65,0.08)"}}>
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] mb-3" style={{color:T.teal}}>Create code</p>
<form onSubmit={createCoupon} className="flex flex-col gap-4 mt-1">
        <p className="text-[12px] leading-relaxed p-3" style={{color:"rgba(36,62,65,0.7)",background:"rgba(36,62,65,0.04)",borderRadius:8}}>
          <strong style={{color:T.teal}}>One coupon per order</strong> — customers can apply only a single code at checkout. Codes cannot be stacked.
        </p>
        <InputField label="Coupon code" value={newCoupon.code} onChange={v=>setNewCoupon(f=>({...f,code:v.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,20)}))} placeholder="e.g. AKARA10"/>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Offer type</label>
          <select
            value={newCoupon.offerKind||"percent"}
            onChange={e=>setNewCoupon(f=>({...f,offerKind:e.target.value}))}
            className="w-full text-[14px] px-3 py-3 outline-none"
            style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs,color:T.teal,backgroundColor:T.cream}}
          >
            <option value="percent">Percent off order (e.g. 10% off)</option>
            <option value="upto">Percent off, upto a max ₹ (e.g. 20% off upto ₹500)</option>
          </select>
          <p className="text-[11px] mt-1.5 leading-relaxed" style={{color:"rgba(36,62,65,0.55)"}}>
            {newCoupon.offerKind==="upto"
              ? "Customer gets the % off, but savings never exceed the max ₹ you set."
              : "Customer gets a fixed % off the product subtotal (before shipping)."}
          </p>
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Discount %</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {[5,10,15,20,25].map(n=>(
              <button key={n} type="button" onClick={()=>setNewCoupon(f=>({...f,discountPercent:String(n)}))}
                className="text-[12px] px-2.5 py-1"
                style={{
                  borderRadius:6,
                  border:`1px solid ${String(newCoupon.discountPercent)===String(n)?T.teal:"rgba(36,62,65,0.18)"}`,
                  backgroundColor:String(newCoupon.discountPercent)===String(n)?T.teal:"transparent",
                  color:String(newCoupon.discountPercent)===String(n)?T.cream:T.teal,
                }}>{n}%</button>
            ))}
          </div>
          <input type="number" min={1} max={100} value={newCoupon.discountPercent}
            onChange={e=>setNewCoupon(f=>({...f,discountPercent:e.target.value.replace(/\D/g,"").slice(0,3)}))}
            className="w-full bg-transparent outline-none text-[14px]"
            style={{border:"1px solid rgba(36,62,65,0.22)",padding:"13px 14px",color:T.teal,borderRadius:RADIUS.xs}}
            placeholder="1–100"/>
        </div>
        {newCoupon.offerKind==="upto" && (
          <InputField
            label="Max savings (₹) — the “upto” cap"
            value={newCoupon.maxDiscountAmount}
            onChange={v=>setNewCoupon(f=>({...f,maxDiscountAmount:v.replace(/\D/g,"").slice(0,7)}))}
            placeholder="e.g. 200"
          />
        )}
        <InputField
          label="Minimum order value (₹)"
          value={newCoupon.minOrderAmount||""}
          onChange={v=>setNewCoupon(f=>({...f,minOrderAmount:v.replace(/\D/g,"").slice(0,7)}))}
          placeholder="e.g. 3000 — blank = no minimum"
        />
        <p className="text-[11px] -mt-2 leading-relaxed" style={{color:"rgba(36,62,65,0.55)"}}>
          Optional. Coupon only works when the product subtotal (before shipping) is at least this amount — e.g. “20% upto ₹200” only above ₹3,000.
        </p>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Who can use it</label>
          <select value={newCoupon.usageMode||"once"} onChange={e=>setNewCoupon(f=>({...f,usageMode:e.target.value}))}
            className="w-full text-[14px] px-3 py-3 outline-none"
            style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,color:T.teal,backgroundColor:T.cream}}>
            <option value="once">One time per customer</option>
            <option value="first">Welcome style — one time per customer</option>
            <option value="multi">Multiple times per customer</option>
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Expires (optional)</label>
            <input type="date" value={newCoupon.expiresAt?newCoupon.expiresAt.slice(0,10):""} onChange={e=>setNewCoupon(f=>({...f,expiresAt:e.target.value?new Date(e.target.value).toISOString():""}))}
              className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"13px 14px",color:T.teal,borderRadius:RADIUS.xs}}/>
          </div>
          <div>
            <InputField label="Max total uses (optional)" value={newCoupon.maxRedemptions} onChange={v=>setNewCoupon(f=>({...f,maxRedemptions:v.replace(/\D/g,"").slice(0,6)}))} placeholder="Blank = unlimited"/>
            <p className="text-[10.5px] mt-1" style={{color:"rgba(36,62,65,0.5)"}}>Site-wide limit across all customers (e.g. first 100 redemptions).</p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={{color:T.teal}}>
            <input type="checkbox" checked={newCoupon.featured} onChange={e=>setNewCoupon(f=>({...f,featured:e.target.checked}))}/>
            Show on top banner (homepage &amp; all pages)
          </label>
          <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={{color:T.teal}}>
            <input type="checkbox" checked={newCoupon.showOnCheckout!==false} onChange={e=>setNewCoupon(f=>({...f,showOnCheckout:e.target.checked}))}/>
            Show in cart &amp; checkout offer list
          </label>
        </div>
        {newCoupon.featured&&<InputField label="Banner text" value={newCoupon.label} onChange={v=>setNewCoupon(f=>({...f,label:v}))} placeholder='e.g. "10% off — use AKARA10"'/>}
        <SweepButton filled type="submit" className="w-full sm:w-auto">Save coupon</SweepButton>
      </form>
        </div>
        <div className="text-[12.5px] leading-relaxed" style={{color:"rgba(36,62,65,0.7)"}}>
          <p className="text-[11px] uppercase tracking-[0.1em] mb-3" style={{color:T.teal}}>Where codes appear</p>
          <ul className="flex flex-col gap-2 list-none p-0 m-0">
            <li><strong style={{color:T.teal}}>Top banner</strong> — teal strip under the top of every page. Only codes with “Show on top banner” + label.</li>
            <li><strong style={{color:T.teal}}>Cart &amp; checkout</strong> — “Available offers” card. Independent of the banner — turn banner off and keep checkout on.</li>
            <li><strong style={{color:T.teal}}>Manual entry</strong> — customer can still type any active code even if not listed (if signed in).</li>
          </ul>
        </div>
      </div>
    </div>

    <div className="p-6 flex flex-col h-full min-h-[280px]" style={ATELIER_PANEL}>
      <p className="text-[10px] tracking-[0.16em] uppercase mb-2" style={{color:T.teal,fontWeight:600}}>05 · Dispatch</p>
      <p className="italic text-[20px] mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Pickup locations</p>
      <p className="text-[12.5px] mb-5" style={{color:"rgba(36,62,65,0.75)"}}>Must match an address nickname already saved on your Shiprocket dashboard, exactly. You'll choose one of these each time you mark an order dispatched.</p>
      {pickupLocationsLoading?<Skeleton height={50}/>:
      <div className="flex flex-col gap-2 mb-5">
        {pickupLocations.length===0?<p className="text-[13px]" style={{color:"rgba(36,62,65,0.75)"}}>No pickup locations saved yet.</p>:
        pickupLocations.map(p=><div key={p.id} className="flex items-center justify-between gap-3 py-2" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}>
          <span className="text-[13.5px]" style={{color:T.teal}}>{p.name}</span>
          <button onClick={()=>setDeletePickupLocationTarget(p)} style={{color:T.error}}><Trash2 size={ICON.sm}/></button>
        </div>)}
      </div>}
      <form onSubmit={createPickupLocation} className="flex gap-3">
        <div className="flex-1"><InputField label="Address Nickname" value={newPickupLocation} onChange={setNewPickupLocation}/></div>
        <div className="self-end"><SweepButton filled type="submit">Add</SweepButton></div>
      </form>
    </div>

    <div className="p-6 flex flex-col h-full min-h-[280px]" style={ATELIER_PANEL}>
      <p className="text-[10px] tracking-[0.16em] uppercase mb-2" style={{color:T.teal,fontWeight:600}}>06 · Access</p>
      <p className="italic text-[20px] mb-1" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Password</p>
      <p className="text-[12.5px] mb-5" style={{color:"rgba(36,62,65,0.75)"}}>Signed in as {admin.email}</p>
      <form onSubmit={changePassword} className="flex flex-col gap-4">
        <InputField label="Current Password" type="password" value={form.current} onChange={v=>setForm(f=>({...f,current:v}))} required/>
        <InputField label="New Password" type="password" value={form.next} onChange={v=>setForm(f=>({...f,next:v}))} required/>
        <InputField label="Confirm New Password" type="password" value={form.confirm} onChange={v=>setForm(f=>({...f,confirm:v}))} required/>
        <SweepButton filled type="submit" disabled={submitting}>{submitting?"Saving…":"Change Password"}</SweepButton>
      </form>
    </div>

    <div className="md:col-span-2 xl:col-span-3">
      
      {admin?.role==="super_admin"&&(
        <div className="p-5 mb-6" style={{...ATELIER_PANEL, borderLeft: salesPaused ? "2px solid #A83B32" : ATELIER_PANEL.borderLeft}}>
          <p className="text-[10px] tracking-[0.16em] uppercase mb-2" style={{color:salesPaused?T.error:T.teal,fontWeight:600}}>07 · Sales mode</p>
          <p className="text-[13px] mb-4 leading-relaxed" style={{color:"rgba(36,62,65,0.75)"}}>Pause sales while testing. Catalogue stays visible; every piece shows as sold out / unavailable and checkout is blocked. Does not change product data — turn off to resume normal selling.</p>
          <button type="button" onClick={()=>saveSalesPause(!salesPaused)} disabled={salesSaving}
            className="flex items-center justify-between gap-4 w-full max-w-sm px-3 py-2.5 text-left" style={{border:"1px solid rgba(36,62,65,0.15)",borderRadius:RADIUS.sm,background:"rgba(24,54,48,0.03)"}}>
            <span className="text-[13px]" style={{color:salesPaused?T.error:T.teal}}>{salesPaused?"Sales paused":"Sales open"}</span>
            <span className="w-11 h-6 flex items-center px-0.5 transition-colors" style={{backgroundColor:salesPaused?T.error:T.success,borderRadius:999}}>
              <span className="w-5 h-5 bg-white transition-transform" style={{borderRadius:"50%",transform:salesPaused?"translateX(0)":"translateX(18px)",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
            </span>
          </button>
        </div>
      )}

        <div className="p-5 mb-6" style={ATELIER_PANEL}>
          <p className="text-[10px] tracking-[0.16em] uppercase mb-2" style={{color:T.teal,fontWeight:600}}>08 · Designer lookbook</p>
          <p className="text-[13px] mb-4 leading-relaxed" style={{color:"rgba(36,62,65,0.75)"}}>
            Password-gated catalogue for architects and interior studios. Share the access code privately.
            Optional PDF URL (e.g. R2) appears as a download after unlock. Live product specs always load from the catalogue.
          </p>
          <label className="flex items-center gap-2 mb-3 text-[13px]" style={{color:T.teal}}>
            <input type="checkbox" checked={!!lookbookForm.enabled} onChange={e=>setLookbookForm(f=>({...f,enabled:e.target.checked}))}/>
            Lookbook enabled
          </label>
          <p className="text-[12px] mb-2" style={{color:T.muted}}>{lookbookForm.hasPassword?"Password is set. Enter a new one only to change it.":"No password yet — set one before sharing the link."}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <InputField label="Access code (password)" type="password" value={lookbookForm.password} onChange={v=>setLookbookForm(f=>({...f,password:v}))} placeholder={lookbookForm.hasPassword?"••••••••":"Set a code"}/>
            <InputField label="Optional PDF pack URL" value={lookbookForm.pdfUrl} onChange={v=>setLookbookForm(f=>({...f,pdfUrl:v}))} placeholder="https://…"/>
          </div>
          <button type="button" onClick={saveLookbook} disabled={lookbookSaving} className="text-[12px] uppercase tracking-[0.08em] px-4 py-2" style={{backgroundColor:T.teal,color:"#F5F0E8",borderRadius:6}}>
            {lookbookSaving?"Saving…":"Save lookbook"}
          </button>
          <p className="text-[12px] mt-3" style={{color:T.muted}}>Public URL: /lookbook</p>
        </div>

      <AdminTwoFactorSettings admin={admin}/>
    </div>

    <div className="md:col-span-2 xl:col-span-3">
      <AdminAndroidAppSettings/>
    </div>

    </div>

    <Modal open={!!deleteCouponTarget} onClose={()=>setDeleteCouponTarget(null)} title="Delete this coupon?" danger confirmLabel="Delete" onConfirm={confirmDeleteCoupon}>
      This permanently removes "{deleteCouponTarget}" — consider deactivating instead if you might reuse it later.
    </Modal>
    <Modal open={!!deletePickupLocationTarget} onClose={()=>setDeletePickupLocationTarget(null)} title="Remove this pickup location?" danger confirmLabel="Remove" onConfirm={confirmDeletePickupLocation}>
      "{deletePickupLocationTarget?.name}" will no longer be selectable when dispatching orders.
    </Modal>
  </div>;
}


function AdminCategories(){
  const showToast=useToast();
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [form,setForm]=useState({name:"",slug:"",description:"",sortOrder:100,iconKey:"planters",isActive:true});
  const [editingId,setEditingId]=useState(null);

  const load=()=>{
    setLoading(true);
    fetch("/api/admin/categories",{credentials:"include"})
      .then(r=>r.ok?r.json():Promise.reject())
      .then(d=>setRows(d.categories||[]))
      .catch(()=>showToast("Could not load categories","error"))
      .finally(()=>setLoading(false));
  };
  useEffect(()=>{ load(); },[]);

  const reset=()=>{ setEditingId(null); setForm({name:"",slug:"",description:"",sortOrder:100,iconKey:"planters",isActive:true}); };

  const save=async (e)=>{
    e.preventDefault();
    if(!form.name.trim()){ showToast("Name required","error"); return; }
    const body={
      name:form.name.trim(),
      slug:form.slug.trim()||undefined,
      description:form.description.trim(),
      sortOrder:Number(form.sortOrder)||100,
      iconKey:form.iconKey||"planters",
      isActive:!!form.isActive,
    };
    try{
      const res=await apiFetch(editingId?`/api/admin/categories/${editingId}`:"/api/admin/categories",{
        method:editingId?"PUT":"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body),
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok){ showToast(data.error||"Save failed","error"); return; }
      showToast(editingId?"Category updated":"Category created","success");
      reset();
      load();
    }catch{ showToast("Network error","error"); }
  };

  const editRow=(r)=>{
    setEditingId(r.id);
    setForm({
      name:r.name, slug:r.slug, description:r.description||"",
      sortOrder:r.sortOrder, iconKey:r.iconKey||"planters", isActive:r.isActive!==false,
    });
  };

  const remove=async (r)=>{
    if(!confirm(`Delete category “${r.name}”? Only allowed if no products use it.`)) return;
    try{
      const res=await apiFetch(`/api/admin/categories/${r.id}`,{method:"DELETE"});
      const data=await res.json().catch(()=>({}));
      if(!res.ok){ showToast(data.error||"Delete failed","error"); return; }
      showToast("Deleted","success");
      if(editingId===r.id) reset();
      load();
    }catch{ showToast("Network error","error"); }
  };

  const icons=["planters","vases","ceiling-lighting","table-lamps","lanterns","floor-lamps"];

  return <div className="p-5 md:p-8 max-w-4xl">
    <AdminPageHeader
      eyebrow="Catalog"
      title="Categories"
      info="Shop categories used on homepage, filters, and navigation. Deactivate to hide without deleting."
      subtitle="Add or remove shop sections — they flow to homepage, filters, and menu without a code deploy. Deactivate to hide without deleting."
    />

    <form onSubmit={save} className="p-5 mb-8 flex flex-col gap-3" style={ATELIER_PANEL}>
      <p className="text-[13px] font-medium" style={{color:T.teal}}>{editingId?"Edit category":"New category"}</p>
      <InputField label="Name" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="e.g. Table Accessories" required/>
      <InputField label="URL slug (optional)" value={form.slug} onChange={v=>setForm(f=>({...f,slug:v}))} placeholder="auto from name if empty"/>
      <InputField label="Short description" value={form.description} onChange={v=>setForm(f=>({...f,description:v}))} placeholder="Shown on homepage / shop"/>
      <div className="grid grid-cols-2 gap-3">
        <InputField label="Sort order" type="number" value={String(form.sortOrder)} onChange={v=>setForm(f=>({...f,sortOrder:v}))}/>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:T.mutedSoft}}>Icon style</label>
          <select value={form.iconKey} onChange={e=>setForm(f=>({...f,iconKey:e.target.value}))} className="w-full bg-transparent outline-none text-[14px] px-3 py-2.5" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,color:T.teal}}>
            {icons.map(k=><option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-[13px]" style={{color:T.teal}}>
        <input type="checkbox" checked={form.isActive} onChange={e=>setForm(f=>({...f,isActive:e.target.checked}))}/> Active (visible on storefront)
      </label>
      <div className="flex gap-2">
        <SweepButton filled type="submit">{editingId?"Save changes":"Create category"}</SweepButton>
        {editingId&&<SweepButton type="button" onClick={reset}>Cancel</SweepButton>}
      </div>
    </form>

    {loading?<p style={{color:T.muted}}>Loading…</p>:
    <div className="flex flex-col gap-2">
      {rows.map(r=>(
        <div key={r.id} className="flex flex-wrap items-center gap-3 p-4" style={ATELIER_PANEL}>
          <div className="flex-1 min-w-[12rem]">
            <p className="text-[15px]" style={{color:T.teal,fontFamily:"'Fraunces',serif"}}>{r.name}</p>
            <p className="text-[12px]" style={{color:T.mutedSoft}}>/{r.slug} · order {r.sortOrder} · {r.isActive?"active":"hidden"}</p>
            {r.description&&<p className="text-[12.5px] mt-1" style={{color:T.muted}}>{r.description}</p>}
          </div>
          <button type="button" className="text-[12px] uppercase tracking-[0.08em] px-3 py-1.5" style={{border:`1px solid rgba(24,54,48,0.2)`,borderRadius:999,color:T.teal}} onClick={()=>editRow(r)}>Edit</button>
          <button type="button" className="text-[12px] uppercase tracking-[0.08em] px-3 py-1.5" style={{border:`1px solid rgba(168,59,50,0.35)`,borderRadius:999,color:T.error}} onClick={()=>remove(r)}>Delete</button>
        </div>
      ))}
      {rows.length===0&&<p style={{color:T.muted}}>No categories yet — create one above, or run database migrate to seed defaults.</p>}
    </div>}
  </div>;
}



function AdminBehaviour() {
  const showToast = useToast();
  const [range, setRange] = useState("30d");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback((quiet = false) => {
    if (!quiet) { setLoading(true); setErr(false); }
    else setRefreshing(true);
    const bust = Date.now();
    fetch(`/api/admin/dashboard/behaviour?range=${encodeURIComponent(range)}&_=${bust}`, { credentials: "include", cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setData(d); setErr(false); if (quiet) { /* quiet auto */ } })
      .catch(() => { if (!quiet) { setErr(true); setData(null); } })
      .finally(() => { if (!quiet) setLoading(false); setRefreshing(false); });
  }, [range]);
  useEffect(() => { load(false); }, [load]);
  useEffect(() => {
    const id = setInterval(() => load(true), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const tooltipStyle = { backgroundColor: "#1a2e2c", border: "1px solid rgba(196,163,90,0.35)", borderRadius: 8, fontSize: 12, color: "#F5F0E8" };

  if (loading && !data) return <div className="p-5 md:p-8"><Skeleton width={220} height={28} className="mb-6" /><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[0,1,2,3].map(i => <Skeleton key={i} height={88} />)}</div></div>;
  if (err || !data) return <EmptyState icon={AlertCircle} title="Couldn't load behaviour" message="If this is the first deploy, run analytics_events.sql / db:sync, then browse the storefront once and retry." actionLabel="Retry" onAction={load} />;

  const f = data.funnel || {};
  const chartData = (data.daily || []).map((d) => ({
    day: new Date(d.day).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    page_views: d.page_views,
    view_item: d.view_item,
    add_to_cart: d.add_to_cart,
    begin_checkout: d.begin_checkout,
    purchase: d.purchase,
  }));
  const cards = [
    ["Sessions", data.sessions, null],
    ["Page views", f.pageViews, null],
    ["Product views", f.viewItem, null],
    ["Add to cart", f.addToCart, f.viewToCart != null ? `${f.viewToCart}% of views` : null],
    ["Checkouts", f.beginCheckout, f.cartToCheckout != null ? `${f.cartToCheckout}% of carts` : null],
    ["Purchases (tracked)", f.purchase, f.checkoutToPurchase != null ? `${f.checkoutToPurchase}% of checkouts` : null],
  ];

  return (
    <div className="p-5 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-[11px] tracking-[0.2em] uppercase mb-1" style={{ color: T.muted }}>First-party + GA4 beacons</p>
          <h1 className="text-[26px] md:text-[30px]" style={{ fontFamily: "'Fraunces',serif", color: T.teal }}>Behaviour <AdminInfoTip text="Charts use first-party analytics_events (page_view, view_item, cart, checkout, purchase). Empty charts mean the table is empty or browsing was before db:sync. Open the live storefront once, then refresh." /></h1>
          <p className="text-[13px] mt-1" style={{ color: T.muted }}>Site activity from your visitors — works even when ad blockers hide Google Analytics.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {["7d", "30d", "90d"].map((r) => (
            <button key={r} type="button" onClick={() => setRange(r)} className="text-[12px] uppercase tracking-[0.08em] px-3 py-2"
              style={{ borderRadius: 8, border: `1px solid ${range === r ? T.teal : "rgba(24,54,48,0.2)"}`, background: range === r ? T.teal : "transparent", color: range === r ? T.cream : T.teal }}>{r}</button>
          ))}
          <button type="button" disabled={refreshing} onClick={() => { load(true); showToast("Behaviour data refreshed","success"); }} className="text-[12px] uppercase tracking-[0.08em] px-3 py-2 disabled:opacity-50"
            style={{ borderRadius: 8, border: "1px solid rgba(24,54,48,0.2)", color: T.teal, background: "transparent" }}>{refreshing?"Updating…":"Refresh"}</button>
        </div>
      </div>
      <p className="text-[11.5px] mb-4" style={{ color: T.muted }}>Auto-refreshes every 30 seconds · range filters first-party events in that window</p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {cards.map(([label, val, sub]) => (
          <div key={label} className="p-4" style={ATELIER_PANEL}>
            <p className="text-[11px] uppercase tracking-[0.08em] mb-2" style={{ color: T.mutedSoft }}>{label}</p>
            <p className="text-[22px]" style={{ fontFamily: "'Fraunces',serif", color: T.teal }}>{Number(val || 0).toLocaleString("en-IN")}</p>
            {sub && <p className="text-[11px] mt-1" style={{ color: T.muted }}>{sub}</p>}
          </div>
        ))}
      </div>

      <div className="p-5 mb-6 overflow-hidden" style={{...ATELIER_PANEL, isolation:"isolate"}}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-3 font-medium" style={{ color: T.teal }}>Daily activity</p>
        {chartData.every(d => !(d.page_views || d.view_item || d.add_to_cart || d.purchase)) ? (
          <p className="text-[13px] leading-relaxed p-4 rounded-lg" style={{ background: "rgba(24,54,48,0.04)", color: "rgba(36,62,65,0.75)" }}>
            No behaviour events in this range yet. Open the live storefront in a browser so <code style={{ fontSize: 11 }}>page_view</code> / product views are recorded — then hit Refresh. Also confirm <code style={{ fontSize: 11 }}>npm run db:sync</code> created <code style={{ fontSize: 11 }}>analytics_events</code>.
          </p>
        ) : (
          <div style={{ width: "100%", height: 320, overflow: "hidden" }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(24,54,48,0.08)" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#183630" }} />
                <YAxis tick={{ fontSize: 11, fill: "#183630" }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Area type="monotone" dataKey="page_views" name="Page views" stroke="#183630" fill="rgba(24,54,48,0.15)" />
                <Area type="monotone" dataKey="view_item" name="Product views" stroke="#2A5A55" fill="rgba(42,90,85,0.12)" />
                <Area type="monotone" dataKey="add_to_cart" name="Add to cart" stroke="#C4A35A" fill="rgba(196,163,90,0.15)" />
                <Area type="monotone" dataKey="purchase" name="Purchase" stroke="#E5C690" fill="rgba(229,198,144,0.2)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-3 gap-4 relative z-0">
        <div className="p-5" style={ATELIER_PANEL}>
          <p className="text-[13px] uppercase tracking-[0.06em] mb-3 font-medium" style={{ color: T.teal }}>Top pages <AdminInfoTip text="Most viewed paths from first-party page_view events in this range." /></p>
          {(data.topPages || []).length === 0 ? <p className="text-[12.5px]" style={{ color: T.muted }}>None yet.</p> :
            (data.topPages || []).map((row) => (
              <div key={row.path} className="flex justify-between gap-2 text-[12.5px] py-1.5" style={{ borderBottom: "1px solid rgba(36,62,65,0.06)" }}>
                <span className="min-w-0 break-all leading-snug" style={{ color: T.teal }}>{row.path}</span>
                <span style={{ color: T.muted }}>{row.views}</span>
              </div>
            ))}
        </div>
        <div className="p-5" style={ATELIER_PANEL}>
          <p className="text-[13px] uppercase tracking-[0.06em] mb-3 font-medium" style={{ color: T.teal }}>Top products viewed <AdminInfoTip text="Products with the most view_item events (PDP opens)." /></p>
          {(data.topProducts || []).length === 0 ? <p className="text-[12.5px]" style={{ color: T.muted }}>None yet.</p> :
            (data.topProducts || []).map((row) => (
              <div key={row.product_id} className="flex justify-between gap-2 text-[12.5px] py-1.5" style={{ borderBottom: "1px solid rgba(36,62,65,0.06)" }}>
                <span className="min-w-0 break-words leading-snug" style={{ color: T.teal }}>{row.name || row.product_id}</span>
                <span style={{ color: T.muted }}>{row.views}</span>
              </div>
            ))}
        </div>
        <div className="p-5" style={ATELIER_PANEL}>
          <p className="text-[13px] uppercase tracking-[0.06em] mb-3 font-medium" style={{ color: T.teal }}>Top searches <AdminInfoTip text="Search queries customers typed, ranked by count." /></p>
          {(data.topSearches || []).length === 0 ? <p className="text-[12.5px]" style={{ color: T.muted }}>None yet.</p> :
            (data.topSearches || []).map((row) => (
              <div key={row.query} className="flex justify-between gap-2 text-[12.5px] py-1.5" style={{ borderBottom: "1px solid rgba(36,62,65,0.06)" }}>
                <span className="min-w-0 break-words leading-snug" style={{ color: T.teal }}>{row.query}</span>
                <span style={{ color: T.muted }}>{row.count}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}


function AdminApp(){
  const [admin,setAdmin]=useState(null);
  const [authChecked,setAuthChecked]=useState(false);
  const [view,setView]=useState("dashboard");
  useEffect(()=>{
    fetch("/api/admin/auth/me",{credentials:"include"})
      .then(r=>r.ok?r.json():null)
      .then(data=>{ if(data?.admin) setAdmin(data.admin); })
      .catch(()=>{})
      .finally(()=>setAuthChecked(true));
  },[]);
  const logout=()=>{ apiFetch("/api/admin/auth/logout",{method:"POST"}).catch(()=>{}); setAdmin(null); };
  if(!authChecked) return <div className="min-h-screen w-full" style={{backgroundColor:T.cream}}/>;
  if(!admin) return <AdminLogin onLogin={setAdmin}/>;
  return <AdminShell admin={admin} view={view} setView={setView} onLogout={logout}>
    {view==="dashboard"&&<AdminDashboard setView={setView}/>}
    {view==="behaviour"&&<AdminBehaviour/>}
    {view==="products"&&<AdminProducts/>}
    {view==="categories"&&<AdminCategories/>}
    {view==="media"&&<AdminMediaManager/>}
    {view==="featured"&&<AdminFeaturedProducts/>}
    {view==="hero-background"&&<AdminHeroBackground/>}
    {view==="room-stories"&&<AdminRoomStories/>}
    {view==="orders"&&<AdminOrders/>}
    {view==="batches"&&<AdminBatches/>}
    {view==="waitlist"&&<AdminWaitlist/>}
    {view==="customers"&&<AdminCustomers/>}
    {view==="newsletter"&&<AdminNewsletter/>}
    {view==="enquiries"&&<AdminEnquiries/>}
    {view==="activity"&&<AdminActivityLog/>}
    {view==="returns"&&<AdminReturns/>}
    {view==="accounts"&&<AdminManageAccounts admin={admin}/>}
    {view==="cms"&&<AdminCms/>}
    {view==="settings"&&<AdminSettings admin={admin}/>}
  </AdminShell>;
}

export default AdminApp;
