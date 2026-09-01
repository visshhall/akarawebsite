// ============================================================================
// AdminApp — split into its own file (rather than living inline in
// AkaraApp.jsx alongside everything else) specifically so it can be
// code-split via dynamic import(). Recharts alone is ~400KB — bundling it
// into the main app would mean every single customer visit downloads the
// entire admin dashboard's charting library, even though only one person
// ever uses it. See the dynamic import in AkaraApp.jsx's root export.
// ============================================================================
import { useState, useEffect, useRef } from "react";
import {
  X, Package, ShoppingCart, LayoutDashboard, LogOut, Pencil, Save,
  PlusCircle, Trash2, AlertCircle, Inbox, Menu, ExternalLink,
  Users, Settings, History, RotateCcw, Mail, Download,
  Image as ImageIcon, Film, ChevronLeft, ChevronRight, Star, Upload, Copy, Shield, UserPlus, FileText, GripVertical,
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { T, ELEVATION, RADIUS, ICON, sanitize, apiFetch, Mac, SweepButton, InputField, useToast, Modal, Skeleton, EmptyState, Badge } from "./shared.jsx";

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
  const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
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
        body:JSON.stringify({email:sanitize(email),password}),
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

  return <div className="min-h-screen w-full flex items-center justify-center p-4 md:p-8" style={{backgroundColor:T.cream}}>
    {/* Page background is cream, per direct instruction. But the brand
        panel went cream too when that changed, losing the teal brand
        color entirely instead of just fixing the original contrast
        problem — a real miss, not what "fix the contrast" should have
        meant. Brand panel restored to teal here — that's real contrast
        against the now-cream page (dark card, light page, genuinely
        visible), AND the brand color is back. White text restored to
        match, since it's teal again. */}
    <div className="w-full max-w-[760px] grid grid-cols-1 md:grid-cols-[1fr_1.1fr]" style={{borderRadius:RADIUS.lg,overflow:"hidden",boxShadow:ELEVATION.modal}}>
      {/* Brand panel — hidden on small screens to keep the login form front
          and center on mobile, where screen space is precious. */}
      <div className="hidden md:flex flex-col justify-start gap-10 p-10 relative overflow-hidden" style={{backgroundColor:T.teal}}>
        <p className="text-[22px] italic relative z-10" style={{fontFamily:"'Fraunces',serif",color:T.gold}}><Mac>A</Mac>K<Mac>A</Mac>RA</p>
        <div className="relative z-10">
          <div className="w-11 h-px mb-5" style={{backgroundColor:T.gold}}/>
          <p className="italic text-[19px] leading-[1.5]" style={{fontFamily:"'Fraunces',serif",color:T.cream}}>Ākāra means form —<br/>made only once you ask.</p>
        </div>
      </div>
      <div className="p-8 md:p-10 flex flex-col justify-center" style={{backgroundColor:T.cream}}>
        <p className="text-[20px] italic mb-1 md:hidden" style={{fontFamily:"'Fraunces',serif",color:T.teal}}><Mac>A</Mac>K<Mac>A</Mac>RA</p>
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
          <h1 className="italic text-[24px] mb-1.5" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Admin sign in</h1>
          <p className="text-[13.5px] mb-7" style={{color:"rgba(36,62,65,0.75)"}}>Authorized access only.</p>
          {err&&<div className="flex items-center gap-2 px-4 py-3 mb-5 text-[13px]" style={{backgroundColor:"rgba(168,59,50,0.08)",color:T.error,borderRadius:RADIUS.sm}}><AlertCircle size={ICON.sm}/>{err}</div>}
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <InputField label="Email" type="email" value={email} onChange={setEmail} required/>
            <InputField label="Password" type="password" value={password} onChange={setPassword} required/>
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
  useEffect(()=>{
    let cancelled=false;
    const poll=()=>{
      let seen=Number(localStorage.getItem(SEEN_KEY)||"0");
      if(!Number.isFinite(seen)||seen<0) seen=0;
      fetch(`/api/admin/orders/new-count?since=${seen}`,{credentials:"include"})
        .then(r=>r.ok?r.json():null)
        .then(d=>{
          if(cancelled||!d) return;
          setNewOrderCount(Number(d.count)||0);
        })
        .catch(()=>{});
    };
    poll();
    const id=setInterval(poll,30000);
    return ()=>{ cancelled=true; clearInterval(id); };
  },[view]);
  useEffect(()=>{
    if(view!=="orders") return;
    const now=Date.now();
    localStorage.setItem(SEEN_KEY,String(now));
    setNewOrderCount(0);
    // Refresh latest watermark from server so we don't miss clock skew
    fetch(`/api/admin/orders/new-count?since=${now}`,{credentials:"include"})
      .then(r=>r.ok?r.json():null)
      .then(d=>{ if(d?.latest) localStorage.setItem(SEEN_KEY,String(Math.max(now,Number(d.latest)||0))); })
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
      ["orders","Orders",ShoppingCart,["staff","admin","super_admin"]],
      ["returns","Return Requests",RotateCcw,["admin","super_admin"]],
    ]},
    { label: "Catalog", items: [
      ["products","Products",Package,["admin","super_admin"]],
      ["media","Media Manager",ImageIcon,["admin","super_admin"]],
      ["featured","Featured Products",Star,["admin","super_admin"]],
    ]},
    { label: "People", items: [
      ["customers","Customers",Users,["admin","super_admin"]],
      ["newsletter","Newsletter",Mail,["admin","super_admin"]],
      ["enquiries","Enquiries",Inbox,["admin","super_admin"]],
    ]},
    { label: "System", items: [
      ["activity","Activity Log",History,["admin","super_admin"]],
      ["accounts","Manage Accounts",Shield,["super_admin"]],
      ["cms","Site Content",FileText,["super_admin"]],
      ["settings","Settings",Settings,["admin","super_admin"]],
    ]},
  ];
  const groups=allGroups.map(g=>({
    label: g.label,
    items: g.items.filter(([,,,roles])=>roles.includes(admin?.role)).map(([k,l,i])=>[k,l,i]),
  })).filter(g=>g.items.length>0);
  const nav=<>
    <div className="px-6 py-7">
      <p className="text-[19px] italic" style={{fontFamily:"'Fraunces',serif",color:T.gold}}><Mac>A</Mac>K<Mac>A</Mac>RA</p>
      <p className="text-[11px] tracking-[0.2em] uppercase" style={{color:T.cream}}>Admin</p>
      {admin?.role&&<p className="text-[10px] tracking-[0.12em] uppercase mt-2 px-2 py-0.5 inline-block" style={{color:T.teal,backgroundColor:T.gold,borderRadius:RADIUS.xs}}>{admin.role.replace("_"," ")}</p>}
    </div>
    <nav className="flex-1 px-3 overflow-y-auto">
      {groups.map(g=><div key={g.label} className="mb-4">
        <p className="px-3.5 mb-1.5 text-[10px] tracking-[0.16em] uppercase" style={{color:"rgba(255,255,255,0.35)"}}>{g.label}</p>
        {g.items.map(([id,label,Icon])=><button key={id} onClick={()=>{setView(id);setDrawerOpen(false);}}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[13.5px] mb-0.5 transition-colors relative"
          style={{backgroundColor:view===id?"rgba(255,255,255,0.12)":"transparent",color:view===id?"white":"rgba(255,255,255,0.62)",borderRadius:RADIUS.sm}}>
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
  return <div className="min-h-screen w-full flex" style={{backgroundColor:T.cream}}>
    {/* Desktop sidebar — always visible at md and up */}
    <aside className="hidden md:flex w-[240px] shrink-0 flex-col" style={{backgroundColor:T.teal}}>
      {nav}
    </aside>

    {/* Mobile top bar + hamburger-triggered drawer — the sidebar used to be
        a fixed 220px column with no mobile handling at all, meaning it ate
        most of a phone's screen width with no way to hide it. */}
    <div className="md:hidden fixed top-0 inset-x-0 z-40 flex items-center justify-between px-4 py-3.5" style={{backgroundColor:T.teal}}>
      <button onClick={()=>setDrawerOpen(true)} aria-label="Open menu" className="relative" style={{color:"white"}}>
        <Menu size={ICON.md}/>
        {newOrderCount>0&&<span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-semibold rounded-full" style={{backgroundColor:"#C43C3C",color:"white"}}>{newOrderCount>9?"9+":newOrderCount}</span>}
      </button>
      <p className="text-[16px] italic" style={{fontFamily:"'Fraunces',serif",color:T.gold}}><Mac>A</Mac>K<Mac>A</Mac>RA</p>
      <div style={{width:ICON.md}}/>
    </div>
    {drawerOpen&&<div className="md:hidden fixed inset-0 z-50 flex" style={{backgroundColor:"rgba(36,62,65,0.5)"}} onClick={()=>setDrawerOpen(false)}>
      <aside className="w-[260px] h-full flex flex-col" style={{backgroundColor:T.teal}} onClick={e=>e.stopPropagation()}>
        <div className="flex justify-end px-4 pt-4"><button onClick={()=>setDrawerOpen(false)} style={{color:"white"}}><X size={ICON.md}/></button></div>
        {nav}
      </aside>
    </div>}

    <main className="flex-1 overflow-auto pt-14 md:pt-0">{children}</main>
  </div>;
}


async function enableAdminPush(){
  if(!("serviceWorker" in navigator) || !("PushManager" in window)){
    return { ok:false, error:"Push not supported in this browser." };
  }
  const perm=await Notification.requestPermission();
  if(perm!=="granted") return { ok:false, error:"Notification permission denied." };
  const cfg=await fetch("/api/push/vapid-public-key",{credentials:"include"}).then(r=>r.json());
  if(!cfg.enabled||!cfg.publicKey) return { ok:false, error:"Push is not configured on the server (VAPID keys)." };
  const reg=await navigator.serviceWorker.ready;
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
  if(!res.ok){ const d=await res.json().catch(()=>({})); return { ok:false, error:d.error||"Subscribe failed" }; }
  return { ok:true };
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
  const [chartMode,setChartMode]=useState("revenue"); // revenue | orderCount
  const [funnelStatus,setFunnelStatus]=useState(null);
  const [funnelOrders,setFunnelOrders]=useState([]);
  const [funnelLoading,setFunnelLoading]=useState(false);
  const [lastUpdated,setLastUpdated]=useState(null);
  const [refreshing,setRefreshing]=useState(false);
  const softRef = useRef(false);

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
      {[0,1,2,3,4,5].map(i=><div key={i} className="p-4" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
        <Skeleton width={70} height={11} className="mb-3"/><Skeleton width={90} height={26}/>
      </div>)}
    </div>
  </div>;
  if(err||!data) return <EmptyState icon={AlertCircle} title="Couldn't load Atelier Pulse" message="Something went wrong reaching the server. Please refresh and try again." actionLabel="Retry" onAction={()=>load(false)}/>;

  const chartData=(data.revenueTrend||[]).map(r=>({
    day:new Date(r.day).toLocaleDateString("en-IN",{day:"2-digit",month:"short"}),
    revenue:r.revenue,
    orderCount:r.orderCount,
  }));
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
    {key:"att",label:"Needs attention",val:String(data.attentionCount??0),d:null,accent:Number(data.attentionCount)>0?"#A83B32":"#2F7D4A",bg:Number(data.attentionCount)>0?"linear-gradient(135deg,rgba(168,59,50,0.12),rgba(168,59,50,0.03))":"linear-gradient(135deg,rgba(47,125,74,0.12),rgba(47,125,74,0.03))"},
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

  return <div className="p-5 md:p-8" style={{background:"linear-gradient(180deg,#F7F3EB 0%,#EFE8DC 100%)",minHeight:"100%"}}>
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <p className="text-[11px] tracking-[0.2em] uppercase mb-1" style={{color:"rgba(36,62,65,0.5)"}}>Studio intelligence</p>
        <h1 className="italic text-[26px] md:text-[30px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Atelier Pulse</h1>
        <p className="text-[12px] mt-1" style={{color:"rgba(36,62,65,0.55)"}}>
          {lastUpdated?`Updated ${lastUpdated.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}`:"—"}
          {refreshing?" · refreshing…":" · auto every 1 min"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {["7d","30d","90d","all"].map(r=>(
          <button key={r} type="button" onClick={()=>setRange(r)}
            className="px-3 py-1.5 text-[11px] uppercase tracking-[0.08em]"
            style={{borderRadius:999,backgroundColor:range===r?T.teal:"rgba(255,255,255,0.7)",color:range===r?"#F5F0E8":T.teal,border:`1px solid ${range===r?T.teal:"rgba(36,62,65,0.12)"}`}}>{r==="all"?"All":r}</button>
        ))}
        <button type="button" onClick={()=>load(true)} className="px-3 py-1.5 text-[11px] uppercase tracking-[0.08em]"
          style={{borderRadius:999,backgroundColor:"rgba(196,163,90,0.2)",color:T.teal,border:"1px solid rgba(196,163,90,0.4)"}}>Refresh</button>
        <button type="button" onClick={async()=>{
          const r=await enableAdminPush();
          alert(r.ok?"Order push alerts enabled on this device.":(r.error||"Could not enable push"));
        }} className="px-3 py-1.5 text-[11px] uppercase tracking-[0.08em]"
          style={{borderRadius:999,backgroundColor:"rgba(24,54,48,0.08)",color:T.teal,border:"1px solid rgba(36,62,65,0.12)"}}>Enable push</button>
      </div>
    </div>

    {/* Path C — risk + money split */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
      <div className="p-4" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
        <p className="text-[10.5px] uppercase tracking-[0.1em] mb-2" style={{color:"rgba(36,62,65,0.5)"}}>Studio risk</p>
        <p className="text-[28px]" style={{fontFamily:"'Fraunces',serif",color:Number(data.studioRisk)>=60?"#A83B32":Number(data.studioRisk)>=30?"#C4A35A":"#2F7D4A"}}>{data.studioRisk??0}<span className="text-[14px]" style={{color:"rgba(36,62,65,0.45)"}}>/100</span></p>
        <p className="text-[12px] mt-1" style={{color:"rgba(36,62,65,0.55)"}}>{data.studioRiskLabel||"Calm"} · stuck, attention, pipeline, missing images</p>
      </div>
      <div className="p-4" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
        <p className="text-[10.5px] uppercase tracking-[0.1em] mb-2" style={{color:"rgba(36,62,65,0.5)"}}>Online paid</p>
        <p className="text-[22px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>₹{Number(data.onlineRevenue||0).toLocaleString("en-IN")}</p>
        <p className="text-[12px] mt-1" style={{color:"rgba(36,62,65,0.55)"}}>{data.onlineOrderCount||0} orders in range</p>
      </div>
      <div className="p-4" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
        <p className="text-[10.5px] uppercase tracking-[0.1em] mb-2" style={{color:"rgba(36,62,65,0.5)"}}>COD (included in totals)</p>
        <p className="text-[22px]" style={{fontFamily:"'Fraunces',serif",color:"#8B6B3D"}}>₹{Number(data.codRevenue||0).toLocaleString("en-IN")}</p>
        <p className="text-[12px] mt-1" style={{color:"rgba(36,62,65,0.55)"}}>{data.codOrderCount||0} orders · totals above include COD</p>
      </div>
    </div>

    {/* KPI strip */}
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
      {kpis.map(k=>(
        <button key={k.key} type="button" onClick={()=>{ if(k.go) openFunnel(k.go); else if(k.key==="att") setView?.("orders"); }}
          className="p-4 text-left transition-transform hover:-translate-y-0.5"
          style={{background:k.bg,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised,border:`1px solid rgba(36,62,65,0.06)`}}>
          <p className="text-[10.5px] uppercase tracking-[0.1em] mb-2" style={{color:"rgba(36,62,65,0.55)"}}>{k.label}</p>
          <p className="text-[22px] leading-none mb-1" style={{fontFamily:"'Fraunces',serif",color:k.accent}}>{k.val}</p>
          {k.d!=null&&<p className="text-[11px] font-medium" style={{color:deltaColor(k.d)}}>{delta(k.d)} vs prior</p>}
        </button>
      ))}
    </div>

    {/* Insights */}
    <div className="mb-5 p-4 flex flex-wrap gap-2" style={{backgroundColor:"rgba(24,54,48,0.92)",borderRadius:RADIUS.md}}>
      {insights.map((line,i)=>(
        <span key={i} className="text-[12px] px-3 py-1.5" style={{backgroundColor:"rgba(245,240,232,0.08)",color:"#E5C690",borderRadius:999,border:"1px solid rgba(196,163,90,0.25)"}}>{line}</span>
      ))}
    </div>

    {/* Main charts row */}
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-5">
      <div className="xl:col-span-2 p-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <p className="text-[13px] uppercase tracking-[0.06em] font-medium" style={{color:T.teal}}>Revenue trajectory</p>
          <div className="flex gap-1">
            {[["revenue","Revenue"],["orderCount","Orders"]].map(([m,lab])=>(
              <button key={m} type="button" onClick={()=>setChartMode(m)} className="px-2.5 py-1 text-[11px]"
                style={{borderRadius:6,backgroundColor:chartMode===m?T.teal:"transparent",color:chartMode===m?"#F5F0E8":T.teal,border:`1px solid ${chartMode===m?T.teal:"rgba(36,62,65,0.12)"}`}}>{lab}</button>
            ))}
          </div>
        </div>
        {chartData.length===0?<p className="text-[13px] py-16 text-center" style={{color:"rgba(36,62,65,0.55)"}}>No paid orders in this range yet.</p>:
        <div style={{width:"100%",height:280}}>
          <ResponsiveContainer>
            <AreaChart data={chartData} margin={{top:8,right:12,left:0,bottom:0}}>
              <defs>
                <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartMode==="revenue"?"#C4A35A":"#2A5A55"} stopOpacity={0.45}/>
                  <stop offset="100%" stopColor={chartMode==="revenue"?"#C4A35A":"#2A5A55"} stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(36,62,65,0.08)"/>
              <XAxis dataKey="day" tick={{fontSize:11,fill:"rgba(36,62,65,0.55)"}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:11,fill:"rgba(36,62,65,0.55)"}} axisLine={false} tickLine={false} width={48}/>
              <Tooltip contentStyle={tooltipStyle}
                formatter={(v)=>chartMode==="revenue"?[`₹${Number(v).toLocaleString("en-IN")}`,"Revenue"]:[v,"Orders"]}/>
              <Area type="monotone" dataKey={chartMode} stroke={chartMode==="revenue"?"#C4A35A":"#2A5A55"} strokeWidth={2.5}
                fill="url(#pulseFill)" activeDot={{r:5,strokeWidth:0}}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>}
      </div>

      <div className="p-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-3 font-medium" style={{color:T.teal}}>Category mix</p>
        {catPie.length===0?<p className="text-[13px] py-16 text-center" style={{color:"rgba(36,62,65,0.55)"}}>No category sales yet.</p>:
        <div style={{width:"100%",height:280}}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={catPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={3}
                cursor="pointer">
                {catPie.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v,n)=>[`₹${Number(v).toLocaleString("en-IN")}`,n]}/>
              <Legend verticalAlign="bottom" height={36} wrapperStyle={{fontSize:11}}/>
            </PieChart>
          </ResponsiveContainer>
        </div>}
      </div>
    </div>

    {/* Studio funnel interactive */}
    <div className="p-5 mb-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
      <p className="text-[13px] uppercase tracking-[0.06em] mb-1 font-medium" style={{color:T.teal}}>Studio flow</p>
      <p className="text-[12px] mb-4" style={{color:"rgba(36,62,65,0.55)"}}>Click a stage to list those orders</p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {funnelData.map(f=>(
          <button key={f.status} type="button" onClick={()=>openFunnel(f.status)}
            className="p-3 text-left transition-all hover:-translate-y-0.5"
            style={{borderRadius:RADIUS.md,background:funnelStatus===f.status?"rgba(24,54,48,0.08)":"rgba(245,240,232,0.8)",border:`1px solid ${funnelStatus===f.status?T.teal:"rgba(36,62,65,0.08)"}`}}>
            <p className="text-[10.5px] uppercase tracking-[0.08em] mb-2" style={{color:"rgba(36,62,65,0.5)"}}>{f.label}</p>
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
            <button type="button" className="text-[11px]" style={{color:"rgba(36,62,65,0.55)"}} onClick={()=>setFunnelStatus(null)}>Close</button>
          </div>
          {funnelLoading?<p className="text-[13px]" style={{color:"rgba(36,62,65,0.55)"}}>Loading…</p>:
           funnelOrders.length===0?<p className="text-[13px]" style={{color:"rgba(36,62,65,0.55)"}}>None in this stage.</p>:
           <div className="max-h-[180px] overflow-y-auto flex flex-col gap-1">
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
      <div className="p-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-3 font-medium" style={{color:T.teal}}>Best sellers</p>
        {(data.bestSellers||[]).length===0?<p className="text-[13px]" style={{color:"rgba(36,62,65,0.55)"}}>No sales in range.</p>:
        <div style={{width:"100%",height:260}}>
          <ResponsiveContainer>
            <BarChart data={data.bestSellers.map(b=>({name:(b.productName||"").slice(0,18),revenue:b.revenue,units:b.unitsSold}))} layout="vertical" margin={{left:8,right:12}}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(36,62,65,0.08)" horizontal={false}/>
              <XAxis type="number" tick={{fontSize:11,fill:"rgba(36,62,65,0.55)"}} axisLine={false}/>
              <YAxis type="category" dataKey="name" width={100} tick={{fontSize:11,fill:"rgba(36,62,65,0.65)"}} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={tooltipStyle} formatter={(v,k)=>k==="revenue"?[`₹${Number(v).toLocaleString("en-IN")}`,"Revenue"]:[v,"Units"]}/>
              <Bar dataKey="revenue" fill="#2A5A55" radius={[0,4,4,0]} cursor="pointer"/>
            </BarChart>
          </ResponsiveContainer>
        </div>}
      </div>
      <div className="p-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-3 font-medium" style={{color:T.teal}}>Attention</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] mb-2" style={{color:"rgba(36,62,65,0.5)"}}>Low stock</p>
            {(data.lowStock||[]).length===0?<p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.55)"}}>None flagged.</p>:
            <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">{data.lowStock.map(p=><div key={p.id} className="flex justify-between text-[12.5px] py-1" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}>
              <span style={{color:T.teal}}>{p.name}</span><Badge variant="warning">{p.stock}</Badge>
            </div>)}</div>}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] mb-2" style={{color:"rgba(36,62,65,0.5)"}}>Failed / pending pay</p>
            {(data.failedPayments||[]).length===0?<p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.55)"}}>None recent.</p>:
            <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">{data.failedPayments.map(o=><button key={o.orderNumber} type="button" onClick={()=>setView?.("orders")} className="flex justify-between text-[12.5px] py-1 text-left" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}>
              <span style={{color:T.teal}}>#{o.orderNumber}</span><Badge variant={o.paymentStatus==="failed"?"error":"warning"}>{o.paymentStatus}</Badge>
            </button>)}</div>}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] mb-2" style={{color:"rgba(36,62,65,0.5)"}}>Pending returns</p>
            {(data.pendingReturns||[]).length===0?<p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.55)"}}>None.</p>:
            <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">{data.pendingReturns.map(r=><div key={r.id} className="flex justify-between text-[12.5px] py-1" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}>
              <span style={{color:T.teal}}>#{r.orderNumber}</span><span style={{color:"rgba(36,62,65,0.55)"}}>{r.itemName}</span>
            </div>)}</div>}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] mb-2" style={{color:"rgba(36,62,65,0.5)"}}>Quiet forms</p>
            {(data.quietForms||[]).length===0?<p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.55)"}}>All listed forms sold — or empty catalog.</p>:
            <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">{data.quietForms.map(p=><div key={p.id} className="flex justify-between text-[12.5px] py-1" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}>
              <span style={{color:T.teal}}>{p.name}</span><span style={{color:"rgba(36,62,65,0.45)"}}>{p.category}</span>
            </div>)}</div>}
          </div>
        </div>
      </div>
    </div>

    {/* Recent orders */}
    <div className="p-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] uppercase tracking-[0.06em] font-medium" style={{color:T.teal}}>Recent orders</p>
        <button type="button" onClick={()=>setView?.("orders")} className="text-[11px] uppercase tracking-[0.06em]" style={{color:T.gold}}>Open orders →</button>
      </div>
      {(data.recentOrders||[]).length===0?<p className="text-[13px]" style={{color:"rgba(36,62,65,0.55)"}}>No orders yet.</p>:
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead><tr style={{color:"rgba(36,62,65,0.45)"}}>
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
  </div>;
}


function VariantEditor({ productId }){
  const showToast=useToast();
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [colors,setColors]=useState([]);
  const [variants,setVariants]=useState([]);
  const nextTempKey=useRef(0);

  useEffect(()=>{
    if(!productId){ setLoading(false); return; }
    setLoading(true);
    fetch(`/api/admin/products/${productId}`,{credentials:"include"})
      .then(r=>r.ok?r.json():Promise.reject())
      .then(d=>{
        const loadedColors=(d.colors||[]).map(c=>({tempKey:`db-${c.id}`,dbId:c.id,variantKey:c.variantKey,label:c.label,swatchHex:c.swatchHex||"#cccccc"}));
        setColors(loadedColors);
        setVariants((d.variants||[]).map(v=>{
          const ownerColor=loadedColors.find(c=>c.dbId===v.colorId);
          return {tempKey:`db-${v.id}`,colorTempKey:ownerColor?.tempKey||null,size:v.size||"",price:v.price,status:v.status,dims:v.dims||""};
        }));
      })
      .catch(()=>{ setColors([]); setVariants([]); })
      .finally(()=>setLoading(false));
  },[productId]);

  const addColor=()=>{
    if(colors.length>=12){ showToast("Max 12 colors.","error"); return; }
    const tempKey=`new-${nextTempKey.current++}`;
    setColors(c=>[...c,{tempKey,dbId:null,variantKey:"",label:"",swatchHex:"#cccccc"}]);
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
    setVariants(v=>[...v,{tempKey,colorTempKey:colors[0]?.tempKey||null,size:"",price:"",status:"in-stock",dims:""}]);
  };
  const updateVariant=(tempKey,field,value)=>setVariants(v=>v.map(x=>x.tempKey===tempKey?{...x,[field]:value}:x));
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
        colors:colors.map(c=>({variantKey:c.variantKey,label:c.label,swatchHex:c.swatchHex})),
        variants:variants.map(v=>({
          clientColorIndex:v.colorTempKey?colorIndexByTempKey[v.colorTempKey]:null,
          size:v.size||null, price:Number(v.price), status:v.status, dims:v.dims||null,
        })),
      };
      const res=await apiFetch(`/api/admin/products/${productId}/variants`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await res.json().catch(()=>({}));
      if(res.ok) showToast("Variants saved","success");
      else showToast(data.error||"Couldn't save variants.","error");
    }catch{
      showToast("Couldn't reach the server.","error");
    }finally{
      setSaving(false);
    }
  };

  if(loading) return <Skeleton height={120}/>;

  return <div>
    <div className="flex items-center justify-between mb-3">
      <p className="text-[11px] tracking-[0.1em] uppercase" style={{color:"rgba(36,62,65,0.75)"}}>Colors</p>
      <SweepButton onClick={addColor}>+ Add Color</SweepButton>
    </div>
    {colors.length===0
      ? <p className="text-[12.5px] mb-4" style={{color:"rgba(36,62,65,0.75)"}}>No colors — this product shows no color picker to customers. Add one to start giving it real color/size variants.</p>
      : <div className="flex flex-col gap-2 mb-5">
          {colors.map(c=><div key={c.tempKey} className="flex items-center gap-2 p-2.5" style={{border:"1px solid rgba(36,62,65,0.14)",borderRadius:RADIUS.xs}}>
            <input type="color" value={c.swatchHex} onChange={e=>updateColor(c.tempKey,"swatchHex",e.target.value)} className="w-8 h-8 shrink-0 cursor-pointer" style={{border:"none",borderRadius:RADIUS.xs}}/>
            <input value={c.label} onChange={e=>updateColor(c.tempKey,"label",e.target.value)} placeholder="Label (e.g. Natural)" className="flex-1 bg-transparent outline-none text-[13px] px-2 py-1.5" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}/>
            <input value={c.variantKey} onChange={e=>updateColor(c.tempKey,"variantKey",e.target.value.toLowerCase())} placeholder="key (e.g. natural)" className="w-32 bg-transparent outline-none text-[12px] font-mono px-2 py-1.5" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}/>
            <button onClick={()=>removeColor(c.tempKey)} style={{color:T.error,flexShrink:0}}><Trash2 size={14}/></button>
          </div>)}
        </div>}

    <div className="flex items-center justify-between mb-3">
      <p className="text-[11px] tracking-[0.1em] uppercase" style={{color:"rgba(36,62,65,0.75)"}}>Size / Color / Price / Stock</p>
      <SweepButton onClick={addVariant}>+ Add Combination</SweepButton>
    </div>
    {variants.length===0
      ? <p className="text-[12.5px] mb-4" style={{color:"rgba(36,62,65,0.75)"}}>No size/color combinations yet.</p>
      : <div className="flex flex-col gap-2 mb-2">
          {variants.map(v=><div key={v.tempKey} className="flex items-center gap-2 p-2.5 flex-wrap" style={{border:"1px solid rgba(36,62,65,0.14)",borderRadius:RADIUS.xs}}>
            <select value={v.colorTempKey||""} onChange={e=>updateVariant(v.tempKey,"colorTempKey",e.target.value||null)} className="text-[12.5px] px-2 py-1.5" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}>
              <option value="">No color</option>
              {colors.map(c=><option key={c.tempKey} value={c.tempKey}>{c.label||"(unnamed)"}</option>)}
            </select>
            <input value={v.size} onChange={e=>updateVariant(v.tempKey,"size",e.target.value)} placeholder="Size (e.g. Medium)" className="w-32 bg-transparent outline-none text-[12.5px] px-2 py-1.5" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}/>
            <input value={v.price} onChange={e=>updateVariant(v.tempKey,"price",e.target.value.replace(/\D/g,""))} placeholder="Price ₹" className="w-24 bg-transparent outline-none text-[12.5px] px-2 py-1.5" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}/>
            <select value={v.status} onChange={e=>updateVariant(v.tempKey,"status",e.target.value)} className="text-[12.5px] px-2 py-1.5" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}>
              <option value="in-stock">In Stock</option>
              <option value="low-stock">Low Stock</option>
              <option value="sold-out">Sold Out</option>
              <option value="pre-order">Pre-Order</option>
            </select>
            <input value={v.dims} onChange={e=>updateVariant(v.tempKey,"dims",e.target.value)} placeholder="Dims override (optional)" className="flex-1 min-w-[140px] bg-transparent outline-none text-[12.5px] px-2 py-1.5" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,color:T.teal}}/>
            <button onClick={()=>removeVariant(v.tempKey)} style={{color:T.error,flexShrink:0}}><Trash2 size={14}/></button>
          </div>)}
        </div>}
    <SweepButton filled onClick={save} disabled={saving}>{saving?"Saving…":"Save Variants"}</SweepButton>
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
    <p className="text-[11px] mt-2" style={{color:"rgba(36,62,65,0.75)"}}>The first item (marked ★ Main) is what customers see first — use the star or the arrows to reorder. JPEG/PNG/WebP up to 10MB, MP4/WebM/MOV up to 100MB.</p>
    <MediaLightbox media={zoomedMedia} onClose={()=>setZoomedMedia(null)}/>
  </div>;
}

const STATUS_OPTIONS=["draft","in-stock","low-stock","sold-out","pre-order","hidden"];
const STATUS_BADGE_VARIANT={"draft":"warning","in-stock":"success","low-stock":"warning","sold-out":"error","pre-order":"warning","hidden":"error"};

function ProductEditorPanel({ product, onClose, onSaved }){
  const showToast=useToast();
  const isNew=!product?.id||product.isNew;
  const [form,setForm]=useState({
    id:product?.id&&!product.isNew?product.id:"", name:product?.name||"", category:product?.category||"Planters",
    price:product?.price??"", dims:product?.dims||"", hsn:product?.hsn||"3924",
    status:product?.status||"draft", description:product?.description||"",
    metaTitle:product?.meta_title||"", metaDesc:product?.meta_desc||"",
    accessoriesNote:product?.accessories_note||"",
  });
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
  const [newFeature,setNewFeature]=useState("");
  const addFeature=()=>{
    const trimmed=newFeature.trim();
    if(!trimmed||keyFeatures.length>=12) return;
    setKeyFeatures(f=>[...f,trimmed]); setNewFeature("");
  };
  const removeFeature=i=>setKeyFeatures(f=>f.filter((_,idx)=>idx!==i));
  const [saving,setSaving]=useState(false);
  const upd=k=>v=>setForm(f=>({...f,[k]:v}));

  const save=async()=>{
    if(isNew&&(!form.id||!/^[a-z0-9-]+$/.test(form.id))){ showToast("Product ID must be lowercase letters, numbers, and hyphens only.","error"); return; }
    if(!form.name.trim()||!form.category.trim()||!form.dims.trim()||!form.hsn.trim()){ showToast("Name, category, dimensions, and HSN are all required.","error"); return; }
    const price=Number(form.price);
    if(!Number.isInteger(price)||price<=0){ showToast("Price must be a positive whole number (rupees).","error"); return; }
    setSaving(true);
    try{
      const body={ name:form.name, category:form.category, price, dims:form.dims, hsn:form.hsn, status:form.status, description:form.description, metaTitle:form.metaTitle, metaDesc:form.metaDesc, media, keyFeatures, accessoriesNote:form.accessoriesNote };
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

  return <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto py-8 px-4" style={{backgroundColor:"rgba(36,62,65,0.45)"}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} className="w-full max-w-[720px]" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
      <div className="flex items-center justify-between px-6 py-5" style={{borderBottom:"1px solid rgba(36,62,65,0.1)"}}>
        <h2 className="italic text-[22px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{isNew?"New Product":"Edit Product"}</h2>
        <button onClick={onClose} style={{color:"rgba(36,62,65,0.75)"}}><X size={ICON.sm}/></button>
      </div>
      <div className="p-6 flex flex-col gap-5 max-h-[70vh] overflow-y-auto">
        <div>
          <p className="text-[11px] tracking-[0.1em] uppercase mb-3" style={{color:"rgba(36,62,65,0.75)"}}>Basic Info</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {isNew
              ? <InputField label="ID (URL slug)" value={form.id} onChange={upd("id")}/>
              : <div><label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>ID (URL slug)</label>
                  <p className="text-[14px] px-3 py-3" style={{color:"rgba(36,62,65,0.75)",border:"1px solid rgba(36,62,65,0.1)",borderRadius:RADIUS.xs}}>{product.id} <span className="text-[11px]">(can't be changed)</span></p>
                </div>}
            <InputField label="Name" value={form.name} onChange={upd("name")}/>
            <InputField label="Category" value={form.category} onChange={upd("category")}/>
            <InputField label="Price (₹, excl. GST)" value={form.price} onChange={upd("price")}/>
            <div>
              <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Dimensions</label>
              <textarea value={form.dims} onChange={e=>upd("dims")(e.target.value)} rows={2}
                className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,padding:"13px 14px",color:T.teal}}/>
              <p className="text-[11px] mt-1.5" style={{color:"rgba(36,62,65,0.75)"}}>One dimension per line — shows as a bulleted list on the product page once there's more than one line. Useful for a product with several colors, each with its own real measurements.</p>
            </div>
            <InputField label="HSN Code" value={form.hsn} onChange={upd("hsn")}/>
            <div>
              <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Status</label>
              <select value={form.status} onChange={e=>upd("status")(e.target.value)} className="w-full text-[14px] px-3 py-[13px]" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,color:T.teal}}>
                {STATUS_OPTIONS.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div>
          <MediaGalleryEditor productId={form.id||product?.id} category={form.category} media={media} onChange={setMedia}/>
        </div>
        {!isNew&&<div>
          <p className="text-[11px] tracking-[0.1em] uppercase mb-3" style={{color:"rgba(36,62,65,0.75)"}}>Size / Color Variants</p>
          <VariantEditor productId={product.id}/>
        </div>}
        <div>
          <p className="text-[11px] tracking-[0.1em] uppercase mb-3" style={{color:"rgba(36,62,65,0.75)"}}>Key Features</p>
          {keyFeatures.length===0
            ? <p className="text-[12.5px] mb-3" style={{color:"rgba(36,62,65,0.75)"}}>No key features yet — the tab only appears on the product page once at least one is added.</p>
            : <ul className="flex flex-col gap-2 mb-3">
                {keyFeatures.map((f,i)=><li key={i} className="flex items-center justify-between gap-3 px-3 py-2.5" style={{border:"1px solid rgba(36,62,65,0.14)",borderRadius:RADIUS.xs}}>
                  <span className="text-[13.5px]" style={{color:T.teal}}>{f}</span>
                  <button type="button" onClick={()=>removeFeature(i)} style={{color:T.error,flexShrink:0}}><Trash2 size={14}/></button>
                </li>)}
              </ul>}
          {keyFeatures.length<12&&<div className="flex gap-2">
            <input value={newFeature} onChange={e=>setNewFeature(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addFeature();}}} maxLength={150} placeholder="e.g. Handmade in Mumbai"
              className="flex-1 bg-transparent outline-none text-[13.5px] px-3 py-2.5" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,color:T.teal}}/>
            <button type="button" onClick={addFeature} className="px-4 py-2.5 text-[12px] tracking-[0.06em] uppercase" style={{border:`1px solid ${T.teal}`,borderRadius:RADIUS.xs,color:T.teal}}>Add</button>
          </div>}
        </div>
        <div>
          <p className="text-[11px] tracking-[0.1em] uppercase mb-3" style={{color:"rgba(36,62,65,0.75)"}}>Accessories Note</p>
          <textarea value={form.accessoriesNote} onChange={e=>upd("accessoriesNote")(e.target.value)} rows={3} maxLength={1000} placeholder="e.g. Includes a standard E27 bulb holder — bulb sold separately."
            className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"11px 13px",borderRadius:RADIUS.xs,color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
          <p className="text-[11px] mt-1.5" style={{color:"rgba(36,62,65,0.75)"}}>Optional — leave blank for most products. Only appears as a real tab on the customer product page when it has real content, so a lamp needing bulb/wire info won't show it for a planter.</p>
        </div>
        <div>
          <p className="text-[11px] tracking-[0.1em] uppercase mb-3" style={{color:"rgba(36,62,65,0.75)"}}>Description & SEO</p>
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
          </div>
        </div>
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
    <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
      <h1 className="italic text-[26px] md:text-[28px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Featured Products</h1>
      <SweepButton filled onClick={save} disabled={saving}>{saving?"Saving…":"Save Changes"}</SweepButton>
    </div>
    <p className="text-[13.5px] mb-6" style={{color:"rgba(36,62,65,0.75)"}}>Shown in this exact order in the homepage's "Featured pieces" section. Up to 12.</p>

    {loading?<Skeleton height={200}/>:<>
      <p className="text-[11px] tracking-[0.1em] uppercase mb-3" style={{color:"rgba(36,62,65,0.75)"}}>Currently Featured ({featuredIds.length})</p>
      {featuredIds.length===0
        ? <p className="text-[12.5px] mb-8" style={{color:"rgba(36,62,65,0.75)"}}>Nothing featured yet — the homepage section stays hidden until you add at least one product below.</p>
        : <div className="flex flex-col gap-2 mb-8">
            {featuredIds.map((id,i)=>{ const p=byId(id); if(!p) return null; return <div key={id} className="flex items-center gap-3 p-3" style={{backgroundColor:T.card,borderRadius:RADIUS.sm,boxShadow:ELEVATION.raised}}>
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
    <h1 className="italic text-[26px] md:text-[28px] mb-2" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Media Manager</h1>
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
            {filtered.map(p=><option key={p.id} value={p.id}>{p.name} ({p.media?.length||0} media)</option>)}
          </select>
        </div>
      </div>
      <div className="mb-6">
        <InputField label="Or search by name / ID" value={search} onChange={setSearch} placeholder="e.g. vayu, aether, aether-pendant-lamp"/>
      </div>

      {selected&&<div className="p-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
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
  const load=()=>{ setLoading(true); fetch("/api/admin/products",{credentials:"include"}).then(r=>r.json()).then(d=>setProducts(d.products||[])).finally(()=>setLoading(false)); };
  useEffect(load,[]);
  const confirmDelete=async()=>{
    const res=await apiFetch(`/api/admin/products/${deleteTarget}`,{method:"DELETE"});
    if(res.ok){ load(); showToast("Product deleted","success"); }
    else showToast("Couldn't delete that product.","error");
  };
  const filtered=statusFilter==="all"?products:products.filter(p=>p.status===statusFilter);
  return <div className="p-5 md:p-8">
    <div className="flex items-center justify-between mb-7 flex-wrap gap-3">
      <h1 className="italic text-[26px] md:text-[28px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Products</h1>
      <SweepButton filled onClick={()=>setEditorTarget({isNew:true})}><span className="flex items-center gap-2"><PlusCircle size={ICON.sm}/> New Product</span></SweepButton>
    </div>
    {!loading&&products.length>0&&<div className="flex flex-wrap gap-2 mb-6">
      {["all",...STATUS_OPTIONS].map(s=>{
        const count=s==="all"?products.length:products.filter(p=>p.status===s).length;
        const active=statusFilter===s;
        return <button key={s} onClick={()=>setStatusFilter(s)}
          className="px-3.5 py-1.5 text-[12px] capitalize transition-colors"
          style={active?{backgroundColor:T.teal,color:"white",borderRadius:RADIUS.sm}:{color:T.teal,border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.sm}}>
          {s==="all"?"All":s} ({count})
        </button>;
      })}
    </div>}
    {loading?<div className="flex flex-col gap-3">{[0,1,2,3].map(i=><Skeleton key={i} height={52} radius={RADIUS.sm}/>)}</div>:
    products.length===0?<EmptyState icon={Package} title="No products yet" message="Create your first product to get started." actionLabel="New Product" onAction={()=>setEditorTarget({isNew:true})}/>:
    filtered.length===0?<EmptyState icon={Package} title={`No ${statusFilter} products`} message="Try a different filter, or clear it to see everything." actionLabel="Show All" onAction={()=>setStatusFilter("all")}/>:
    <div className="flex flex-col gap-2.5 md:gap-0 md:block" style={{backgroundColor:"transparent"}}>
      {filtered.map(p=>
        <div key={p.id} className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 p-4 md:px-5 md:py-3" style={{backgroundColor:T.card,borderRadius:RADIUS.sm,boxShadow:ELEVATION.raised,marginBottom:"2px"}}>
          <span className="flex-1 text-[14px]" style={{color:T.teal}}>{p.name}</span>
          <div className="flex items-center justify-between md:contents">
            <span className="text-[12.5px] md:w-20" style={{color:"rgba(36,62,65,0.75)"}}>{p.category}</span>
            <span className="text-[14px] md:w-20" style={{color:T.teal}}>₹{p.price}</span>
          </div>
          <div className="flex items-center justify-between md:contents">
            <Badge variant={STATUS_BADGE_VARIANT[p.status]||"warning"}>{p.status}</Badge>
            <div className="flex gap-3">
              <button onClick={()=>setEditorTarget(p)} style={{color:T.teal}}><Pencil size={ICON.sm}/></button>
              <button onClick={()=>setDeleteTarget(p.id)} style={{color:T.error}}><Trash2 size={ICON.sm}/></button>
            </div>
          </div>
        </div>)}
    </div>}
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
  const [cancelTarget,setCancelTarget]=useState(null);
  const load=()=>{ setLoading(true); fetch("/api/admin/orders",{credentials:"include"}).then(r=>r.json()).then(d=>setOrders(d.orders||[])).finally(()=>setLoading(false)); };
  useEffect(load,[]);
  const [pickupLocations,setPickupLocations]=useState([]);
  useEffect(()=>{ fetch("/api/admin/settings/pickup-locations",{credentials:"include"}).then(r=>r.json()).then(d=>setPickupLocations(d.pickupLocations||[])).catch(()=>{}); },[]);
  const updateStatus=async(orderNumber,status,pickupLocation)=>{
    const res=await apiFetch(`/api/admin/orders/${orderNumber}/status`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status,pickupLocation})});
    if(res.ok){ load(); showToast(`Order #${orderNumber} marked ${status}`,"success"); }
    else showToast("Couldn't update that order's status.","error");
  };
  // Marking an order "dispatched" now needs one more piece of information
  // first — which of the business's (more than one) real pickup addresses
  // this particular shipment is actually going out from, since that isn't
  // always the same location. Every other status still updates
  // immediately, same as before; only this one pauses for a choice.
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
    <div className="flex items-center justify-between mb-7 md:mb-8 flex-wrap gap-3">
      <h1 className="italic text-[26px] md:text-[28px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Orders</h1>
      <SweepButton onClick={refreshTracking} disabled={refreshing}>{refreshing?"Checking…":"Refresh Tracking"}</SweepButton>
    </div>
    {loading?<div className="flex flex-col gap-3">{[0,1,2,3].map(i=><Skeleton key={i} height={56} radius={RADIUS.sm}/>)}</div>:
    orders.length===0?<EmptyState icon={ShoppingCart} title="No orders yet" message="Orders will show up here once customers start checking out."/>:
    <div className="flex flex-col gap-2.5 md:gap-0">
      {orders.map(o=>{
        const itemSummary=o.items.map(i=>`${i.name}${i.size?` (${i.size})`:""} × ${i.qty}`).join(", ");
        return <div key={o.orderNumber} className="flex flex-col gap-2.5 p-4 md:px-5 md:py-4" style={{backgroundColor:T.card,borderRadius:RADIUS.sm,boxShadow:ELEVATION.raised,marginBottom:"2px"}}>
        <div className="flex flex-col md:flex-row md:items-center gap-2.5 md:gap-4">
          <div className="flex items-center justify-between md:contents">
            <span className="text-[14px] md:w-24" style={{color:T.teal}}>#{o.orderNumber}</span>
            <span className="text-[13px] md:flex-1 md:min-w-[140px]" style={{color:"rgba(36,62,65,0.75)"}}>{o.email}{o.phone?` · ${o.phone}`:""}</span>
          </div>
          <div className="flex items-center justify-between md:contents">
            <span className="text-[14px] md:w-20" style={{color:T.teal}}>₹{o.total.toLocaleString("en-IN")}</span>
            <div className="flex items-center gap-2">
              <Badge variant={o.paymentStatus==="paid"?"success":o.paymentStatus==="refunded"?"neutral":o.paymentStatus==="failed"?"error":"warning"}>{o.paymentStatus}</Badge>
              {o.paymentStatus==="cod"&&o.status!=="cancelled"&&<button onClick={()=>markPaid(o.orderNumber)} className="text-[11px] uppercase tracking-[0.06em] underline" style={{color:T.success}}>Mark Paid</button>}
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
          <select value={o.status} onChange={e=>handleStatusChange(o.orderNumber,e.target.value)} disabled={o.status==="cancelled"} className="text-[13px] px-3 py-2 w-full md:w-auto disabled:opacity-50" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs}}>
            {[o.status,...(ORDER_STATUS_TRANSITIONS[o.status]||[])].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          {o.courierTrackingUrl&&<a href={o.courierTrackingUrl} target="_blank" rel="noopener noreferrer" className="text-[11.5px] uppercase tracking-[0.06em]" style={{color:T.teal}}>Track</a>}
          {o.status!=="cancelled"&&o.status!=="delivered"&&<button onClick={()=>setCancelTarget(o.orderNumber)} className="text-[12px] uppercase tracking-[0.06em]" style={{color:T.error}}>Cancel</button>}
        </div>
        <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.75)"}}>{itemSummary}</p>
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
  </div>;
}

function AdminCustomers(){
  const [customers,setCustomers]=useState([]); const [loading,setLoading]=useState(true);
  useEffect(()=>{ fetch("/api/admin/customers",{credentials:"include"}).then(r=>r.json()).then(d=>setCustomers(d.customers||[])).finally(()=>setLoading(false)); },[]);
  return <div className="p-5 md:p-8">
    <h1 className="italic text-[26px] md:text-[28px] mb-7 md:mb-8" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Customers</h1>
    {loading?<div className="flex flex-col gap-3">{[0,1,2,3].map(i=><Skeleton key={i} height={56} radius={RADIUS.sm}/>)}</div>:
    customers.length===0?<EmptyState icon={Users} title="No customers yet" message="Real accounts will show up here as people sign up."/>:
    <div className="flex flex-col gap-2.5 md:gap-0">
      {customers.map(c=><div key={c.id} className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 p-4 md:px-5 md:py-3" style={{backgroundColor:T.card,borderRadius:RADIUS.sm,boxShadow:ELEVATION.raised,marginBottom:"2px"}}>
        <div className="flex-1">
          <p className="text-[14px]" style={{color:T.teal}}>{c.name}</p>
          <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.75)"}}>{c.email}{c.phone?` · ${c.phone}`:""}</p>
        </div>
        <div className="flex items-center justify-between md:contents">
          <span className="text-[13px]" style={{color:"rgba(36,62,65,0.75)"}}>{c.orderCount} order{c.orderCount!==1?"s":""}</span>
          <span className="text-[14px]" style={{color:T.teal}}>₹{c.totalSpent.toLocaleString("en-IN")}</span>
          <span className="text-[12px]" style={{color:"rgba(36,62,65,0.75)"}}>{new Date(c.createdAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</span>
        </div>
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
      <h1 className="italic text-[26px] md:text-[28px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Enquiries</h1>
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
      {shown.map(e=><div key={`${e.type}-${e.id}`} className="p-4 flex gap-3" style={{backgroundColor:T.card,borderRadius:RADIUS.sm,boxShadow:ELEVATION.raised,opacity:e.handled?0.6:1}}>
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
      <h1 className="italic text-[26px] md:text-[28px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Newsletter Subscribers</h1>
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
      {filtered.map(s=><div key={s.email} className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 p-4 md:px-5 md:py-3" style={{backgroundColor:T.card,borderRadius:RADIUS.sm,boxShadow:ELEVATION.raised,marginBottom:"2px"}}>
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
    <h1 className="italic text-[26px] md:text-[28px] mb-7 md:mb-8" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Activity Log</h1>
    <p className="text-[13.5px] mb-6" style={{color:"rgba(36,62,65,0.75)"}}>Every product and order change made from this admin panel — most recent first.</p>
    {loading?<div className="flex flex-col gap-3">{[0,1,2,3].map(i=><Skeleton key={i} height={44} radius={RADIUS.sm}/>)}</div>:
    entries.length===0?<EmptyState icon={History} title="No activity yet" message="Product edits and order status changes will be recorded here."/>:
    <div className="flex flex-col gap-2">
      {entries.map(e=>{ const isFailure=e.action.includes("failed")||e.action.includes("skipped"); return <div key={e.id} className="flex items-center justify-between gap-4 p-4" style={{backgroundColor:isFailure?"rgba(168,59,50,0.06)":T.card,borderRadius:RADIUS.sm,boxShadow:ELEVATION.raised,borderLeft:isFailure?`3px solid ${T.error}`:"none"}}>
        <div className="min-w-0">
          <span className="text-[13.5px]" style={{color:isFailure?T.error:T.teal}}>{describe(e)}</span>
          {/* The backend has always sent adminName/adminEmail (joined
              from the real change_log.admin_id foreign key) — this was
              never displayed anywhere until now. Genuinely matters now
              that multiple real accounts exist: "who did this" was
              never a real question with one admin account, and now it
              is. */}
          <p className="text-[11.5px] mt-0.5" style={{color:"rgba(36,62,65,0.75)"}}>by {e.adminName}</p>
        </div>
        <span className="text-[12px] whitespace-nowrap" style={{color:"rgba(36,62,65,0.75)"}}>{new Date(e.createdAt).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</span>
      </div>;})}
    </div>}
  </div>;
}

const RETURN_STATUSES=["pending","approved","rejected","completed"];
function AdminReturns(){
  const showToast=useToast();
  const [requests,setRequests]=useState([]); const [loading,setLoading]=useState(true);
  const load=()=>{ setLoading(true); fetch("/api/admin/returns",{credentials:"include"}).then(r=>r.json()).then(d=>setRequests(d.returnRequests||[])).finally(()=>setLoading(false)); };
  useEffect(load,[]);
  const updateStatus=async(id,status)=>{
    const res=await apiFetch(`/api/admin/returns/${id}/status`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});
    if(res.ok){ load(); showToast("Return request updated","success"); }
    else showToast("Couldn't update that request.","error");
  };
  return <div className="p-5 md:p-8">
    <h1 className="italic text-[26px] md:text-[28px] mb-7 md:mb-8" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Return Requests</h1>
    {loading?<div className="flex flex-col gap-3">{[0,1,2].map(i=><Skeleton key={i} height={90} radius={RADIUS.sm}/>)}</div>:
    requests.length===0?<EmptyState icon={Package} title="No return requests" message="Customer return requests will show up here."/>:
    <div className="flex flex-col gap-3">
      {requests.map(r=><div key={r.id} className="p-4 md:p-5" style={{backgroundColor:T.card,borderRadius:RADIUS.sm,boxShadow:ELEVATION.raised}}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-[14px]" style={{color:T.teal}}>#{r.orderNumber} — {r.itemName}</p>
            <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.75)"}}>{r.reason} · {r.contactEmail} · {r.contactPhone}</p>
          </div>
          <select value={r.status} onChange={e=>updateStatus(r.id,e.target.value)} className="text-[13px] px-3 py-2" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs}}>
            {RETURN_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <p className="text-[13px] mb-3" style={{color:"rgba(36,62,65,0.75)"}}>{r.description}</p>
        {r.photoUrl&&<img src={r.photoUrl} alt="Return photo" className="w-24 h-24 object-cover" style={{borderRadius:RADIUS.xs}}/>}
      </div>)}
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

  if(selectedPage) return <div className="p-5 md:p-8 max-w-[820px]">
    <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
      <div className="flex items-center gap-3">
        <button onClick={()=>{setSelectedPage(null);setBlocks([]);}} style={{color:T.teal}}><ChevronLeft size={20}/></button>
        <h1 className="italic text-[24px] md:text-[26px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{pages.find(p=>p.pageKey===selectedPage)?.title}</h1>
      </div>
      <div className="flex gap-2">
        <SweepButton onClick={openHistory}>View History</SweepButton>
        <SweepButton filled onClick={save} disabled={saving}>{saving?"Saving…":"Save Changes"}</SweepButton>
      </div>
    </div>
    <p className="text-[13px] mb-6" style={{color:"rgba(36,62,65,0.75)"}}>Use [text](page-key) for an internal link, [text](mailto:address) for email, and **text** for bold. Every save keeps the previous version — see View History to revert.</p>

    <div className="flex flex-col gap-3 mb-6">
      {blocks.map((b,i)=><div key={i} className="p-4" style={{backgroundColor:T.card,borderRadius:RADIUS.sm,boxShadow:ELEVATION.raised}}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10.5px] uppercase tracking-[0.06em] px-2 py-1" style={{backgroundColor:"rgba(36,62,65,0.08)",borderRadius:RADIUS.xs,color:T.teal}}>{b.blockType}</span>
          <div className="flex items-center gap-2">
            <button onClick={()=>moveUp(i)} disabled={i===0} style={{color:"rgba(36,62,65,0.75)",opacity:i===0?0.3:1}}><ChevronLeft size={15} style={{transform:"rotate(90deg)"}}/></button>
            <button onClick={()=>moveDown(i)} disabled={i===blocks.length-1} style={{color:"rgba(36,62,65,0.75)",opacity:i===blocks.length-1?0.3:1}}><ChevronRight size={15} style={{transform:"rotate(90deg)"}}/></button>
            <button onClick={()=>removeBlock(i)} style={{color:T.error}}><Trash2 size={15}/></button>
          </div>
        </div>
        {b.blockType==="heading"
          ? <input value={b.content} onChange={e=>updateBlock(i,e.target.value)} className="w-full bg-transparent outline-none text-[15px]" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"10px 12px",color:T.teal,fontFamily:"'Fraunces',serif"}}/>
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
          : <textarea value={b.content} onChange={e=>updateBlock(i,e.target.value)} rows={b.blockType==="table"?3:4} className="w-full bg-transparent outline-none text-[13.5px] font-mono" style={{border:"1px solid rgba(36,62,65,0.18)",borderRadius:RADIUS.xs,padding:"10px 12px",color:T.teal}}/>}
      </div>)}
    </div>

    <div className="flex gap-2 flex-wrap">
      <SweepButton onClick={()=>addBlock("heading")}>+ Heading</SweepButton>
      <SweepButton onClick={()=>addBlock("paragraph")}>+ Paragraph</SweepButton>
      <SweepButton onClick={()=>addBlock("table")}>+ Table</SweepButton>
      <SweepButton onClick={()=>addBlock("qa")}>+ Question & Answer</SweepButton>
      <SweepButton onClick={()=>addBlock("bulletList")}>+ Bullet Section</SweepButton>
      <SweepButton onClick={()=>addBlock("hero")}>+ Hero</SweepButton>
      <SweepButton onClick={()=>addBlock("quote")}>+ Quote</SweepButton>
      <SweepButton onClick={()=>addBlock("darkPanel")}>+ Dark Panel</SweepButton>
      <SweepButton onClick={()=>addBlock("stepGrid")}>+ Step Grid</SweepButton>
      <SweepButton onClick={()=>addBlock("cardGrid")}>+ Card Grid</SweepButton>
      <SweepButton onClick={()=>addBlock("heroWithCta")}>+ Hero (with buttons)</SweepButton>
      <SweepButton onClick={()=>addBlock("footerBrand")}>+ Footer Brand</SweepButton>
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

  return <div className="p-5 md:p-8">
    <h1 className="italic text-[26px] md:text-[28px] mb-2" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Site Content</h1>
    <p className="text-[13.5px] mb-6" style={{color:"rgba(36,62,65,0.75)"}}>Edit any page's real content — live immediately, no code or redeploy needed.</p>
    {loading?<Skeleton height={200}/>:
    <div className="flex flex-col gap-2.5">
      {pages.map(p=><button key={p.pageKey} onClick={()=>openPage(p.pageKey)} className="flex items-center justify-between gap-3 p-4 text-left w-full" style={{backgroundColor:T.card,borderRadius:RADIUS.sm,boxShadow:ELEVATION.raised}}>
        <div>
          <p className="text-[14px]" style={{color:T.teal}}>{p.title}</p>
          <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.75)"}}>{p.blockCount} block{p.blockCount!==1?"s":""}{p.lastUpdated?` · updated ${new Date(p.lastUpdated).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}`:""}</p>
        </div>
        <ChevronRight size={16} style={{color:"rgba(36,62,65,0.75)"}}/>
      </button>)}
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
      <h1 className="italic text-[26px] md:text-[28px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Manage Accounts</h1>
      <SweepButton filled onClick={()=>setShowCreate(true)}><UserPlus size={14} className="inline mr-1.5" style={{verticalAlign:"-2px"}}/>New Account</SweepButton>
    </div>
    <p className="text-[13.5px] mb-6" style={{color:"rgba(36,62,65,0.75)"}}>Staff can manage orders only. Admin can manage products, customers, and settings. Super Admin has full access, including this screen.</p>

    {loading?<Skeleton height={200}/>:
    <div className="flex flex-col gap-2.5">
      {accounts.map(a=><div key={a.id} className="flex items-center gap-3 p-4" style={{backgroundColor:T.card,borderRadius:RADIUS.sm,boxShadow:ELEVATION.raised}}>
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
function AdminTwoFactorSettings(){
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

  if(loading) return <div className="p-6" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}><Skeleton height={80}/></div>;

  // Real backup-codes-shown-once screen — genuinely can't be reached
  // again after leaving it, by design.
  if(newBackupCodes) return <div className="p-6" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
    <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Save your backup codes</p>
    <p className="text-[12.5px] mb-4" style={{color:"rgba(36,62,65,0.75)"}}>Each code works once, if you ever lose access to your authenticator app. This is the only time these will be shown — save them somewhere real, like a password manager.</p>
    <div className="grid grid-cols-2 gap-2 mb-5 p-4" style={{backgroundColor:"rgba(36,62,65,0.04)",borderRadius:RADIUS.sm}}>
      {newBackupCodes.map(c=><span key={c} className="text-[13px] font-mono" style={{color:T.teal}}>{c}</span>)}
    </div>
    <SweepButton filled onClick={()=>setNewBackupCodes(null)}>I've saved these — Done</SweepButton>
  </div>;

  // Real mid-setup: QR code + the one real verify-before-enable step.
  if(setupData) return <div className="p-6" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
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

  return <div className="p-6" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
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

function AdminSettings({ admin }){
  const showToast=useToast();
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
  const [newCoupon,setNewCoupon]=useState({code:"",discountPercent:"",expiresAt:"",maxRedemptions:"",onePerCustomer:false,featured:false,label:""});
  const loadCoupons=()=>{ setCouponsLoading(true); fetch("/api/admin/settings/coupons",{credentials:"include"}).then(r=>r.json()).then(d=>setCoupons(d.coupons||[])).finally(()=>setCouponsLoading(false)); };
  useEffect(loadCoupons,[]);
  const createCoupon=async e=>{
    e.preventDefault();
    const res=await apiFetch("/api/admin/settings/coupons",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      code:newCoupon.code, discountPercent:Number(newCoupon.discountPercent),
      expiresAt:newCoupon.expiresAt||null,
      maxRedemptions:newCoupon.maxRedemptions?Number(newCoupon.maxRedemptions):null,
      onePerCustomer:newCoupon.onePerCustomer,
      featured:newCoupon.featured, label:newCoupon.label||null,
    })});
    const data=await res.json();
    if(res.ok){ setNewCoupon({code:"",discountPercent:"",expiresAt:"",maxRedemptions:"",onePerCustomer:false,featured:false,label:""}); loadCoupons(); showToast("Coupon created","success"); }
    else showToast(data.error||"Couldn't create that coupon.","error");
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

  return <div className="p-5 md:p-8 max-w-[520px]">
    <h1 className="italic text-[26px] md:text-[28px] mb-7 md:mb-8" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Settings</h1>

    <div className="p-6 mb-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
      <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Shipping</p>
      <p className="text-[12.5px] mb-5" style={{color:"rgba(36,62,65,0.75)"}}>Applies to every checkout immediately — no deploy needed.</p>
      {shipLoading?<Skeleton height={90}/>:
      <form onSubmit={saveShipping} className="flex flex-col gap-4">
        <InputField label="Shipping Cost (₹)" value={shipForm.shippingCost} onChange={v=>setShipForm(f=>({...f,shippingCost:v}))} required/>
        <InputField label="Free Shipping Above (₹)" value={shipForm.freeShippingThreshold} onChange={v=>setShipForm(f=>({...f,freeShippingThreshold:v}))} required/>
        <SweepButton filled type="submit" disabled={shipSaving}>{shipSaving?"Saving…":"Save Shipping Settings"}</SweepButton>
      </form>}
    </div>

    <div className="p-6 mb-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
      <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Homepage Maintenance Notice</p>
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

    <div className="p-6 mb-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
      <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Cash on Delivery</p>
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

    <div className="p-6 mb-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
      <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Coupon Codes</p>
      <p className="text-[12.5px] mb-5" style={{color:"rgba(36,62,65,0.75)"}}>Deactivating a code retires it immediately without deleting its history.</p>
      {couponsLoading?<Skeleton height={60}/>:
      <div className="flex flex-col gap-2 mb-5">
        {coupons.length===0?<p className="text-[13px]" style={{color:"rgba(36,62,65,0.75)"}}>No coupons yet.</p>:
        coupons.map(c=><div key={c.code} className="flex items-center justify-between gap-3 py-2 flex-wrap" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13.5px]" style={{color:T.teal}}>{c.code}</span>
            <span className="text-[12.5px]" style={{color:"rgba(36,62,65,0.75)"}}>{c.discountPercent}% off</span>
            <Badge variant={c.active?"success":"neutral"}>{c.active?"active":"inactive"}</Badge>
            {c.expiresAt&&<Badge variant={c.expiresAt<Date.now()?"error":"warning"}>{c.expiresAt<Date.now()?"expired":`until ${new Date(c.expiresAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}`}</Badge>}
            {c.maxRedemptions&&<Badge variant="neutral">max {c.maxRedemptions}</Badge>}
            {c.onePerCustomer&&<Badge variant="neutral">1 per customer</Badge>}
            {c.featured&&<Badge variant="warning">public: "{c.label}"</Badge>}
          </div>
          <div className="flex gap-3">
            <button onClick={()=>toggleFeatured(c)} className="text-[12px]" style={{color:c.featured?T.gold:"rgba(36,62,65,0.4)",textDecoration:"underline"}}>{c.featured?"Unfeature":"Feature Publicly"}</button>
            <button onClick={()=>toggleCoupon(c)} className="text-[12px]" style={{color:T.teal,textDecoration:"underline"}}>{c.active?"Deactivate":"Activate"}</button>
            <button onClick={()=>setDeleteCouponTarget(c.code)} style={{color:T.error}}><Trash2 size={ICON.sm}/></button>
          </div>
        </div>)}
      </div>}
      <form onSubmit={createCoupon} className="grid grid-cols-2 gap-3">
        <InputField label="New Code" value={newCoupon.code} onChange={v=>setNewCoupon(f=>({...f,code:v.toUpperCase()}))}/>
        <InputField label="Discount %" value={newCoupon.discountPercent} onChange={v=>setNewCoupon(f=>({...f,discountPercent:v}))}/>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.75)"}}>Expires (optional)</label>
          <input type="date" value={newCoupon.expiresAt?newCoupon.expiresAt.slice(0,10):""} onChange={e=>setNewCoupon(f=>({...f,expiresAt:e.target.value?new Date(e.target.value).toISOString():""}))}
            className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"13px 14px",color:T.teal,fontFamily:"'Space Grotesk',sans-serif",borderRadius:RADIUS.xs}}/>
        </div>
        <InputField label="Max Uses (optional)" value={newCoupon.maxRedemptions} onChange={v=>setNewCoupon(f=>({...f,maxRedemptions:v}))} placeholder="Unlimited"/>
        <label className="col-span-2 flex items-center gap-2 text-[13px] cursor-pointer" style={{color:T.teal}}>
          <input type="checkbox" checked={newCoupon.onePerCustomer} onChange={e=>setNewCoupon(f=>({...f,onePerCustomer:e.target.checked}))}/>
          Limit to one use per customer
        </label>
        <label className="col-span-2 flex items-center gap-2 text-[13px] cursor-pointer" style={{color:T.teal}}>
          <input type="checkbox" checked={newCoupon.featured} onChange={e=>setNewCoupon(f=>({...f,featured:e.target.checked}))}/>
          Show this publicly on the site (banner)
        </label>
        {newCoupon.featured&&<div className="col-span-2"><InputField label="Public Banner Text" value={newCoupon.label} onChange={v=>setNewCoupon(f=>({...f,label:v}))} placeholder='e.g. "10% off your first order"'/></div>}
        <div className="col-span-2"><SweepButton filled type="submit">Add Coupon</SweepButton></div>
      </form>
    </div>

    <div className="p-6 mb-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
      <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Pickup Locations</p>
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

    <div className="p-6" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
      <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Change Password</p>
      <p className="text-[12.5px] mb-5" style={{color:"rgba(36,62,65,0.75)"}}>Signed in as {admin.email}</p>
      <form onSubmit={changePassword} className="flex flex-col gap-4">
        <InputField label="Current Password" type="password" value={form.current} onChange={v=>setForm(f=>({...f,current:v}))} required/>
        <InputField label="New Password" type="password" value={form.next} onChange={v=>setForm(f=>({...f,next:v}))} required/>
        <InputField label="Confirm New Password" type="password" value={form.confirm} onChange={v=>setForm(f=>({...f,confirm:v}))} required/>
        <SweepButton filled type="submit" disabled={submitting}>{submitting?"Saving…":"Change Password"}</SweepButton>
      </form>
    </div>

    <AdminTwoFactorSettings/>

    <Modal open={!!deleteCouponTarget} onClose={()=>setDeleteCouponTarget(null)} title="Delete this coupon?" danger confirmLabel="Delete" onConfirm={confirmDeleteCoupon}>
      This permanently removes "{deleteCouponTarget}" — consider deactivating instead if you might reuse it later.
    </Modal>
    <Modal open={!!deletePickupLocationTarget} onClose={()=>setDeletePickupLocationTarget(null)} title="Remove this pickup location?" danger confirmLabel="Remove" onConfirm={confirmDeletePickupLocation}>
      "{deletePickupLocationTarget?.name}" will no longer be selectable when dispatching orders.
    </Modal>
  </div>;
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
    {view==="products"&&<AdminProducts/>}
    {view==="media"&&<AdminMediaManager/>}
    {view==="featured"&&<AdminFeaturedProducts/>}
    {view==="orders"&&<AdminOrders/>}
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
