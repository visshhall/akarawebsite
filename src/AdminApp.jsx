// ============================================================================
// AdminApp — split into its own file (rather than living inline in
// AkaraApp.jsx alongside everything else) specifically so it can be
// code-split via dynamic import(). Recharts alone is ~400KB — bundling it
// into the main app would mean every single customer visit downloads the
// entire admin dashboard's charting library, even though only one person
// ever uses it. See the dynamic import in AkaraApp.jsx's root export.
// ============================================================================
import { useState, useEffect } from "react";
import {
  X, Package, ShoppingCart, LayoutDashboard, LogOut, Pencil, Save,
  PlusCircle, Trash2, AlertCircle, Inbox, Menu, ExternalLink,
  Users, Settings, History, RotateCcw,
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
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
      onLogin(data.admin);
    }catch{
      setErr("Couldn't reach the server. Please check your connection and try again.");
      setSubmitting(false);
    }
  };
  return <div className="min-h-screen w-full flex items-center justify-center p-4 md:p-8" style={{backgroundColor:T.teal}}>
    <div className="w-full max-w-[760px] grid grid-cols-1 md:grid-cols-[1fr_1.1fr]" style={{borderRadius:RADIUS.lg,overflow:"hidden",boxShadow:ELEVATION.modal}}>
      {/* Brand panel — hidden on small screens to keep the login form front
          and center on mobile, where screen space is precious. */}
      <div className="hidden md:flex flex-col justify-between p-10 relative overflow-hidden" style={{backgroundColor:T.teal}}>
        <p className="text-[22px] italic text-white relative z-10" style={{fontFamily:"'Fraunces',serif"}}><Mac>A</Mac>K<Mac>A</Mac>RA</p>
        <div className="relative z-10">
          <div className="w-11 h-px mb-5" style={{backgroundColor:T.gold}}/>
          <p className="italic text-[19px] leading-[1.5]" style={{fontFamily:"'Fraunces',serif",color:T.cream}}>Precision geometric<br/>pieces, made to order.</p>
        </div>
        <p className="text-[12px] relative z-10" style={{color:"rgba(255,255,255,0.4)"}}>Admin — Mumbai studio</p>
      </div>
      <div className="p-8 md:p-10 flex flex-col justify-center" style={{backgroundColor:T.cream}}>
        <p className="text-[20px] italic mb-1 md:hidden" style={{fontFamily:"'Fraunces',serif",color:T.teal}}><Mac>A</Mac>K<Mac>A</Mac>RA</p>
        <h1 className="italic text-[24px] mb-1.5" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Admin sign in</h1>
        <p className="text-[13.5px] mb-7" style={{color:"rgba(36,62,65,0.55)"}}>Authorized access only.</p>
        {err&&<div className="flex items-center gap-2 px-4 py-3 mb-5 text-[13px]" style={{backgroundColor:"rgba(168,59,50,0.08)",color:T.error,borderRadius:RADIUS.sm}}><AlertCircle size={ICON.sm}/>{err}</div>}
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <InputField label="Email" type="email" value={email} onChange={setEmail} required/>
          <InputField label="Password" type="password" value={password} onChange={setPassword} required/>
          <SweepButton filled type="submit" disabled={submitting} className="w-full">{submitting?"Signing in…":"Sign In"}</SweepButton>
        </form>
      </div>
    </div>
  </div>;
}

function AdminShell({ admin, view, setView, onLogout, children }){
  const [drawerOpen,setDrawerOpen]=useState(false);
  const items=[
    ["dashboard","Dashboard",LayoutDashboard],
    ["products","Products",Package],
    ["orders","Orders",ShoppingCart],
    ["returns","Return Requests",RotateCcw],
    ["customers","Customers",Users],
    ["activity","Activity Log",History],
    ["settings","Settings",Settings],
  ];
  const nav=<>
    <div className="px-6 py-7">
      <p className="text-[19px] italic text-white" style={{fontFamily:"'Fraunces',serif"}}><Mac>A</Mac>K<Mac>A</Mac>RA</p>
      <p className="text-[11px] tracking-[0.2em] uppercase" style={{color:T.cream}}>Admin</p>
    </div>
    <nav className="flex-1 px-3">
      {items.map(([id,label,Icon])=><button key={id} onClick={()=>{setView(id);setDrawerOpen(false);}}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-[14px] mb-1 transition-colors"
        style={{backgroundColor:view===id?"rgba(255,255,255,0.12)":"transparent",color:view===id?"white":"rgba(255,255,255,0.6)",borderRadius:RADIUS.sm}}>
        <Icon size={ICON.sm}/>{label}
      </button>)}
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
      <button onClick={()=>setDrawerOpen(true)} aria-label="Open menu" style={{color:"white"}}><Menu size={ICON.md}/></button>
      <p className="text-[16px] italic text-white" style={{fontFamily:"'Fraunces',serif"}}><Mac>A</Mac>K<Mac>A</Mac>RA</p>
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

function AdminDashboard(){
  const [data,setData]=useState(null); const [loading,setLoading]=useState(true); const [err,setErr]=useState(false);
  useEffect(()=>{
    fetch("/api/admin/dashboard",{credentials:"include"})
      .then(r=>{ if(!r.ok) throw new Error(); return r.json(); })
      .then(setData).catch(()=>setErr(true)).finally(()=>setLoading(false));
  },[]);
  if(loading) return <div className="p-5 md:p-8">
    <Skeleton width={160} height={30} className="mb-8"/>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {[0,1,2,3].map(i=><div key={i} className="p-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
        <Skeleton width={80} height={12} className="mb-3"/><Skeleton width={100} height={28}/>
      </div>)}
    </div>
  </div>;
  if(err||!data) return <EmptyState icon={AlertCircle} title="Couldn't load the dashboard" message="Something went wrong reaching the server. Please refresh and try again." actionLabel="Retry" onAction={()=>window.location.reload()}/>;
  const chartData=data.revenueTrend.map(r=>({day:new Date(r.day).toLocaleDateString("en-IN",{day:"2-digit",month:"short"}),revenue:r.revenue}));
  const statCards=[
    {label:"Total Revenue",val:`₹${data.totalRevenue.toLocaleString("en-IN")}`,icon:Package,tint:"rgba(59,110,82,0.12)",iconColor:T.success},
    {label:"Paid Orders",val:data.paidOrderCount,icon:ShoppingCart,tint:"rgba(36,62,65,0.08)",iconColor:T.teal},
    {label:"New Customers (30d)",val:data.newCustomersLast30Days,icon:Users,tint:"rgba(184,147,90,0.14)",iconColor:T.gold},
    {label:"Low Stock Items",val:data.lowStock.length,icon:AlertCircle,tint:data.lowStock.length>0?"rgba(181,101,29,0.14)":"rgba(36,62,65,0.06)",iconColor:data.lowStock.length>0?T.warning:T.teal},
  ];
  return <div className="p-5 md:p-8">
    <h1 className="italic text-[26px] md:text-[28px] mb-7 md:mb-8" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Dashboard</h1>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {statCards.map(({label,val,icon:Icon,tint,iconColor})=>
        <div key={label} className="p-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-9 h-9 flex items-center justify-center" style={{backgroundColor:tint,borderRadius:RADIUS.sm}}>
              <Icon size={ICON.sm} style={{color:iconColor}}/>
            </div>
            <p className="text-[12.5px] font-medium" style={{color:"rgba(36,62,65,0.55)"}}>{label}</p>
          </div>
          <p className="text-[26px] md:text-[28px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{val}</p>
        </div>)}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
      <div className="p-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-4 font-medium" style={{color:T.teal}}>Revenue — last 30 days</p>
        {chartData.length===0?<EmptyState icon={Package} title="No revenue yet" message="Once orders are paid, this chart fills in."/>:
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="rgba(36,62,65,0.08)"/><XAxis dataKey="day" tick={{fontSize:12}}/><YAxis tick={{fontSize:12}}/><Tooltip/><Line type="monotone" dataKey="revenue" stroke={T.gold} strokeWidth={2.5} dot={false}/></LineChart>
        </ResponsiveContainer>}
      </div>
      <div className="p-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-4 font-medium" style={{color:T.teal}}>Best Sellers</p>
        {data.bestSellers.length===0?<EmptyState icon={ShoppingCart} title="No paid orders yet" message="Your top-selling products will show up here."/>:
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data.bestSellers}><CartesianGrid strokeDasharray="3 3" stroke="rgba(36,62,65,0.08)"/><XAxis dataKey="productName" tick={{fontSize:11}} interval={0} angle={-15} textAnchor="end" height={50}/><YAxis tick={{fontSize:12}}/><Tooltip/><Bar dataKey="unitsSold" fill={T.teal} radius={[4,4,0,0]}/></BarChart>
        </ResponsiveContainer>}
      </div>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="p-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-4 font-medium" style={{color:T.teal}}>Low Stock / Sold Out</p>
        {data.lowStock.length===0?<p className="text-[13.5px]" style={{color:"rgba(36,62,65,0.4)"}}>Nothing low or out of stock.</p>:
        <div className="flex flex-col gap-2.5">{data.lowStock.map(p=><div key={p.id} className="flex justify-between items-center text-[13.5px] py-1.5" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}><span style={{color:T.teal}}>{p.name}</span><Badge variant={p.status==="sold-out"?"error":"warning"}>{p.status}</Badge></div>)}</div>}
      </div>
      <div className="p-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
        <p className="text-[13px] uppercase tracking-[0.06em] mb-4 font-medium" style={{color:T.teal}}>Recent Orders</p>
        {data.recentOrders.length===0?<p className="text-[13.5px]" style={{color:"rgba(36,62,65,0.4)"}}>No orders yet.</p>:
        <div className="flex flex-col gap-2.5">{data.recentOrders.map(o=><div key={o.orderNumber} className="flex justify-between items-center text-[13.5px] py-1.5" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}><span style={{color:T.teal}}>#{o.orderNumber}</span><span className="flex items-center gap-2" style={{color:"rgba(36,62,65,0.55)"}}>₹{o.total.toLocaleString("en-IN")}<Badge variant={o.paymentStatus==="paid"?"success":o.paymentStatus==="refunded"?"neutral":o.paymentStatus==="failed"?"error":"warning"}>{o.paymentStatus}</Badge></span></div>)}</div>}
      </div>
    </div>
  </div>;
}

const STATUS_OPTIONS=["draft","in-stock","low-stock","sold-out","pre-order","hidden"];
const STATUS_BADGE_VARIANT={"draft":"warning","in-stock":"success","low-stock":"warning","sold-out":"error","pre-order":"warning","hidden":"error"};
// Real product editor — replaces the old inline-row edit (name/price/stock
// only, no working description field despite the database always having
// had one) and the separate small "New Product" grid. One shared panel
// now handles both create and edit, covering every field Phase 1 called
// for: description, SEO fields, and the new unified status (draft /
// in-stock / low-stock / sold-out / pre-order / hidden) replacing the
// old stock-only tracking.
function ProductEditorPanel({ product, onClose, onSaved }){
  const showToast=useToast();
  const isNew=!product?.id||product.isNew;
  const [form,setForm]=useState({
    id:product?.id&&!product.isNew?product.id:"", name:product?.name||"", category:product?.category||"Planters",
    price:product?.price??"", dims:product?.dims||"", hsn:product?.hsn||"3924",
    status:product?.status||"draft", description:product?.description||"",
    metaTitle:product?.meta_title||"", metaDesc:product?.meta_desc||"",
  });
  const [saving,setSaving]=useState(false);
  const upd=k=>v=>setForm(f=>({...f,[k]:v}));

  const save=async()=>{
    if(isNew&&(!form.id||!/^[a-z0-9-]+$/.test(form.id))){ showToast("Product ID must be lowercase letters, numbers, and hyphens only.","error"); return; }
    if(!form.name.trim()||!form.category.trim()||!form.dims.trim()||!form.hsn.trim()){ showToast("Name, category, dimensions, and HSN are all required.","error"); return; }
    const price=Number(form.price);
    if(!Number.isInteger(price)||price<=0){ showToast("Price must be a positive whole number (rupees).","error"); return; }
    setSaving(true);
    try{
      const body={ name:form.name, category:form.category, price, dims:form.dims, hsn:form.hsn, status:form.status, description:form.description, metaTitle:form.metaTitle, metaDesc:form.metaDesc };
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
        <button onClick={onClose} style={{color:"rgba(36,62,65,0.4)"}}><X size={ICON.sm}/></button>
      </div>
      <div className="p-6 flex flex-col gap-5 max-h-[70vh] overflow-y-auto">
        <div>
          <p className="text-[11px] tracking-[0.1em] uppercase mb-3" style={{color:"rgba(36,62,65,0.45)"}}>Basic Info</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {isNew
              ? <InputField label="ID (URL slug)" value={form.id} onChange={upd("id")}/>
              : <div><label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>ID (URL slug)</label>
                  <p className="text-[14px] px-3 py-3" style={{color:"rgba(36,62,65,0.5)",border:"1px solid rgba(36,62,65,0.1)",borderRadius:RADIUS.xs}}>{product.id} <span className="text-[11px]">(can't be changed)</span></p>
                </div>}
            <InputField label="Name" value={form.name} onChange={upd("name")}/>
            <InputField label="Category" value={form.category} onChange={upd("category")}/>
            <InputField label="Price (₹, excl. GST)" value={form.price} onChange={upd("price")}/>
            <InputField label="Dimensions" value={form.dims} onChange={upd("dims")}/>
            <InputField label="HSN Code" value={form.hsn} onChange={upd("hsn")}/>
            <div>
              <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Status</label>
              <select value={form.status} onChange={e=>upd("status")(e.target.value)} className="w-full text-[14px] px-3 py-[13px]" style={{border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.xs,color:T.teal}}>
                {STATUS_OPTIONS.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div>
          <p className="text-[11px] tracking-[0.1em] uppercase mb-3" style={{color:"rgba(36,62,65,0.45)"}}>Description & SEO</p>
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Description</label>
              <textarea value={form.description} onChange={e=>upd("description")(e.target.value)} rows={4} maxLength={2000}
                className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"11px 13px",borderRadius:RADIUS.xs,color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
            </div>
            <InputField label="Meta Title (SEO)" value={form.metaTitle} onChange={upd("metaTitle")}/>
            <div>
              <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Meta Description (SEO)</label>
              <textarea value={form.metaDesc} onChange={e=>upd("metaDesc")(e.target.value)} rows={2} maxLength={300}
                className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"11px 13px",borderRadius:RADIUS.xs,color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
            </div>
          </div>
        </div>
      </div>
      <div className="flex gap-3 justify-end px-6 py-5" style={{borderTop:"1px solid rgba(36,62,65,0.1)"}}>
        <button onClick={onClose} className="px-5 py-2.5 text-[12px] tracking-[0.08em] uppercase" style={{color:T.teal,border:"1px solid rgba(36,62,65,0.22)",borderRadius:RADIUS.sm}}>Cancel</button>
        <SweepButton filled onClick={save} disabled={saving}>{saving?"Saving…":isNew?"Create Product":"Save Changes"}</SweepButton>
      </div>
    </div>
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
            <span className="text-[12.5px] md:w-20" style={{color:"rgba(36,62,65,0.5)"}}>{p.category}</span>
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

const ADMIN_ORDER_STATUSES=["confirmed","production","qc","dispatched","delivered","cancelled"];
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
            <span className="text-[13px] md:flex-1 md:min-w-[140px]" style={{color:"rgba(36,62,65,0.6)"}}>{o.email}{o.phone?` · ${o.phone}`:""}</span>
          </div>
          <div className="flex items-center justify-between md:contents">
            <span className="text-[14px] md:w-20" style={{color:T.teal}}>₹{o.total.toLocaleString("en-IN")}</span>
            <div className="flex items-center gap-2">
              <Badge variant={o.paymentStatus==="paid"?"success":o.paymentStatus==="refunded"?"neutral":o.paymentStatus==="failed"?"error":"warning"}>{o.paymentStatus}</Badge>
              {o.paymentStatus==="cod"&&<button onClick={()=>markPaid(o.orderNumber)} className="text-[11px] uppercase tracking-[0.06em] underline" style={{color:T.success}}>Mark Paid</button>}
            </div>
          </div>
          <select value={o.status} onChange={e=>handleStatusChange(o.orderNumber,e.target.value)} disabled={o.status==="cancelled"} className="text-[13px] px-3 py-2 w-full md:w-auto disabled:opacity-50" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs}}>
            {ADMIN_ORDER_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          {o.courierTrackingUrl&&<a href={o.courierTrackingUrl} target="_blank" rel="noopener noreferrer" className="text-[11.5px] uppercase tracking-[0.06em]" style={{color:T.gold}}>Track</a>}
          {o.status!=="cancelled"&&o.status!=="delivered"&&<button onClick={()=>setCancelTarget(o.orderNumber)} className="text-[12px] uppercase tracking-[0.06em]" style={{color:T.error}}>Cancel</button>}
        </div>
        <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.5)"}}>{itemSummary}</p>
      </div>;})}
    </div>}
    <Modal open={!!dispatchTarget} onClose={()=>setDispatchTarget(null)} title="Which pickup location?" confirmLabel="Confirm Dispatch" onConfirm={confirmDispatch}>
      <div className="mb-2">
        <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Pickup Location</label>
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
          <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.5)"}}>{c.email}{c.phone?` · ${c.phone}`:""}</p>
        </div>
        <div className="flex items-center justify-between md:contents">
          <span className="text-[13px]" style={{color:"rgba(36,62,65,0.6)"}}>{c.orderCount} order{c.orderCount!==1?"s":""}</span>
          <span className="text-[14px]" style={{color:T.teal}}>₹{c.totalSpent.toLocaleString("en-IN")}</span>
          <span className="text-[12px]" style={{color:"rgba(36,62,65,0.45)"}}>{new Date(c.createdAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</span>
        </div>
      </div>)}
    </div>}
  </div>;
}

function AdminActivityLog(){
  const [entries,setEntries]=useState([]); const [loading,setLoading]=useState(true);
  useEffect(()=>{ fetch("/api/admin/activity-log",{credentials:"include"}).then(r=>r.json()).then(d=>setEntries(d.entries||[])).finally(()=>setLoading(false)); },[]);
  const describe=e=>{
    if(e.action==="product.update") return `Updated product "${e.details.productId}"${e.details.diff&&Object.keys(e.details.diff).length?` (${Object.keys(e.details.diff).join(", ")})`:""}`;
    if(e.action==="product.create") return `Created product "${e.details.productId}"`;
    if(e.action==="product.delete") return `Deleted product "${e.details.productId}"`;
    if(e.action==="order.status_change") return `Order #${e.details.orderNumber}: ${e.details.from} → ${e.details.to}`;
    if(e.action==="admin.password_change") return "Changed admin password";
    if(e.action==="order.refund_succeeded") return `Refunded order #${e.details.orderNumber} — ₹${e.details.amount} (${e.details.refundId})`;
    if(e.action==="order.refund_failed") return `⚠ Refund FAILED for order #${e.details.orderNumber} — needs manual handling in Razorpay dashboard`;
    if(e.action==="order.refund_skipped_no_payment_id") return `⚠ Couldn't refund order #${e.details.orderNumber} — no payment record found`;
    return e.action;
  };
  return <div className="p-5 md:p-8">
    <h1 className="italic text-[26px] md:text-[28px] mb-7 md:mb-8" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Activity Log</h1>
    <p className="text-[13.5px] mb-6" style={{color:"rgba(36,62,65,0.5)"}}>Every product and order change made from this admin panel — most recent first.</p>
    {loading?<div className="flex flex-col gap-3">{[0,1,2,3].map(i=><Skeleton key={i} height={44} radius={RADIUS.sm}/>)}</div>:
    entries.length===0?<EmptyState icon={History} title="No activity yet" message="Product edits and order status changes will be recorded here."/>:
    <div className="flex flex-col gap-2">
      {entries.map(e=>{ const isFailure=e.action.includes("failed")||e.action.includes("skipped"); return <div key={e.id} className="flex items-center justify-between gap-4 p-4" style={{backgroundColor:isFailure?"rgba(168,59,50,0.06)":T.card,borderRadius:RADIUS.sm,boxShadow:ELEVATION.raised,borderLeft:isFailure?`3px solid ${T.error}`:"none"}}>
        <span className="text-[13.5px]" style={{color:isFailure?T.error:T.teal}}>{describe(e)}</span>
        <span className="text-[12px] whitespace-nowrap" style={{color:"rgba(36,62,65,0.45)"}}>{new Date(e.createdAt).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</span>
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
            <p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.5)"}}>{r.reason} · {r.contactEmail} · {r.contactPhone}</p>
          </div>
          <select value={r.status} onChange={e=>updateStatus(r.id,e.target.value)} className="text-[13px] px-3 py-2" style={{border:"1px solid rgba(36,62,65,0.2)",borderRadius:RADIUS.xs}}>
            {RETURN_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <p className="text-[13px] mb-3" style={{color:"rgba(36,62,65,0.65)"}}>{r.description}</p>
        {r.photoUrl&&<img src={r.photoUrl} alt="Return photo" className="w-24 h-24 object-cover" style={{borderRadius:RADIUS.xs}}/>}
      </div>)}
    </div>}
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
  const [newCoupon,setNewCoupon]=useState({code:"",discountPercent:"",expiresAt:"",maxRedemptions:"",onePerCustomer:false});
  const loadCoupons=()=>{ setCouponsLoading(true); fetch("/api/admin/settings/coupons",{credentials:"include"}).then(r=>r.json()).then(d=>setCoupons(d.coupons||[])).finally(()=>setCouponsLoading(false)); };
  useEffect(loadCoupons,[]);
  const createCoupon=async e=>{
    e.preventDefault();
    const res=await apiFetch("/api/admin/settings/coupons",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      code:newCoupon.code, discountPercent:Number(newCoupon.discountPercent),
      expiresAt:newCoupon.expiresAt||null,
      maxRedemptions:newCoupon.maxRedemptions?Number(newCoupon.maxRedemptions):null,
      onePerCustomer:newCoupon.onePerCustomer,
    })});
    const data=await res.json();
    if(res.ok){ setNewCoupon({code:"",discountPercent:"",expiresAt:"",maxRedemptions:"",onePerCustomer:false}); loadCoupons(); showToast("Coupon created","success"); }
    else showToast(data.error||"Couldn't create that coupon.","error");
  };
  const toggleCoupon=async c=>{
    const res=await apiFetch(`/api/admin/settings/coupons/${c.code}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({active:!c.active})});
    if(res.ok){ loadCoupons(); showToast(`${c.code} ${c.active?"deactivated":"activated"}`,"success"); }
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
      <p className="text-[12.5px] mb-5" style={{color:"rgba(36,62,65,0.5)"}}>Applies to every checkout immediately — no deploy needed.</p>
      {shipLoading?<Skeleton height={90}/>:
      <form onSubmit={saveShipping} className="flex flex-col gap-4">
        <InputField label="Shipping Cost (₹)" value={shipForm.shippingCost} onChange={v=>setShipForm(f=>({...f,shippingCost:v}))} required/>
        <InputField label="Free Shipping Above (₹)" value={shipForm.freeShippingThreshold} onChange={v=>setShipForm(f=>({...f,freeShippingThreshold:v}))} required/>
        <SweepButton filled type="submit" disabled={shipSaving}>{shipSaving?"Saving…":"Save Shipping Settings"}</SweepButton>
      </form>}
    </div>

    <div className="p-6 mb-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
      <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Homepage Maintenance Notice</p>
      <p className="text-[12.5px] mb-5" style={{color:"rgba(36,62,65,0.5)"}}>Shows a dismissible "still under construction" popup to homepage visitors. Turn this off once the site is ready — no deploy needed.</p>
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
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Message shown to visitors</label>
          <textarea value={maintForm.message} onChange={e=>setMaintForm(f=>({...f,message:e.target.value}))} rows={3} maxLength={300}
            className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"11px 13px",borderRadius:RADIUS.xs,color:T.teal,fontFamily:"'Space Grotesk',sans-serif",resize:"vertical"}}/>
        </div>
        <SweepButton filled onClick={()=>saveMaintenance(maintForm)} disabled={maintSaving}>{maintSaving?"Saving…":"Save Message"}</SweepButton>
      </div>}
    </div>

    <div className="p-6 mb-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
      <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Cash on Delivery</p>
      <p className="text-[12.5px] mb-5" style={{color:"rgba(36,62,65,0.5)"}}>Lets customers pay in cash when their order arrives, instead of paying online through Razorpay. Useful for safely testing the full order flow without real money.</p>
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
        <p className="text-[11.5px]" style={{color:"rgba(36,62,65,0.45)"}}>Added to the order total only when a customer chooses Cash on Delivery — never on online payments.</p>
      </div>}
    </div>

    <div className="p-6 mb-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
      <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Coupon Codes</p>
      <p className="text-[12.5px] mb-5" style={{color:"rgba(36,62,65,0.5)"}}>Deactivating a code retires it immediately without deleting its history.</p>
      {couponsLoading?<Skeleton height={60}/>:
      <div className="flex flex-col gap-2 mb-5">
        {coupons.length===0?<p className="text-[13px]" style={{color:"rgba(36,62,65,0.4)"}}>No coupons yet.</p>:
        coupons.map(c=><div key={c.code} className="flex items-center justify-between gap-3 py-2 flex-wrap" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13.5px]" style={{color:T.teal}}>{c.code}</span>
            <span className="text-[12.5px]" style={{color:"rgba(36,62,65,0.5)"}}>{c.discountPercent}% off</span>
            <Badge variant={c.active?"success":"neutral"}>{c.active?"active":"inactive"}</Badge>
            {c.expiresAt&&<Badge variant={c.expiresAt<Date.now()?"error":"warning"}>{c.expiresAt<Date.now()?"expired":`until ${new Date(c.expiresAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}`}</Badge>}
            {c.maxRedemptions&&<Badge variant="neutral">max {c.maxRedemptions}</Badge>}
            {c.onePerCustomer&&<Badge variant="neutral">1 per customer</Badge>}
          </div>
          <div className="flex gap-3">
            <button onClick={()=>toggleCoupon(c)} className="text-[12px]" style={{color:T.teal,textDecoration:"underline"}}>{c.active?"Deactivate":"Activate"}</button>
            <button onClick={()=>setDeleteCouponTarget(c.code)} style={{color:T.error}}><Trash2 size={ICON.sm}/></button>
          </div>
        </div>)}
      </div>}
      <form onSubmit={createCoupon} className="grid grid-cols-2 gap-3">
        <InputField label="New Code" value={newCoupon.code} onChange={v=>setNewCoupon(f=>({...f,code:v.toUpperCase()}))}/>
        <InputField label="Discount %" value={newCoupon.discountPercent} onChange={v=>setNewCoupon(f=>({...f,discountPercent:v}))}/>
        <div>
          <label className="block text-[11px] tracking-[0.08em] uppercase mb-2" style={{color:"rgba(36,62,65,0.55)"}}>Expires (optional)</label>
          <input type="date" value={newCoupon.expiresAt?newCoupon.expiresAt.slice(0,10):""} onChange={e=>setNewCoupon(f=>({...f,expiresAt:e.target.value?new Date(e.target.value).toISOString():""}))}
            className="w-full bg-transparent outline-none text-[14px]" style={{border:"1px solid rgba(36,62,65,0.22)",padding:"13px 14px",color:T.teal,fontFamily:"'Space Grotesk',sans-serif",borderRadius:RADIUS.xs}}/>
        </div>
        <InputField label="Max Uses (optional)" value={newCoupon.maxRedemptions} onChange={v=>setNewCoupon(f=>({...f,maxRedemptions:v}))} placeholder="Unlimited"/>
        <label className="col-span-2 flex items-center gap-2 text-[13px] cursor-pointer" style={{color:T.teal}}>
          <input type="checkbox" checked={newCoupon.onePerCustomer} onChange={e=>setNewCoupon(f=>({...f,onePerCustomer:e.target.checked}))}/>
          Limit to one use per customer
        </label>
        <div className="col-span-2"><SweepButton filled type="submit">Add Coupon</SweepButton></div>
      </form>
    </div>

    <div className="p-6 mb-5" style={{backgroundColor:T.card,borderRadius:RADIUS.md,boxShadow:ELEVATION.raised}}>
      <p className="text-[15px] mb-1" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}>Pickup Locations</p>
      <p className="text-[12.5px] mb-5" style={{color:"rgba(36,62,65,0.5)"}}>Must match an address nickname already saved on your Shiprocket dashboard, exactly. You'll choose one of these each time you mark an order dispatched.</p>
      {pickupLocationsLoading?<Skeleton height={50}/>:
      <div className="flex flex-col gap-2 mb-5">
        {pickupLocations.length===0?<p className="text-[13px]" style={{color:"rgba(36,62,65,0.4)"}}>No pickup locations saved yet.</p>:
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
      <p className="text-[12.5px] mb-5" style={{color:"rgba(36,62,65,0.5)"}}>Signed in as {admin.email}</p>
      <form onSubmit={changePassword} className="flex flex-col gap-4">
        <InputField label="Current Password" type="password" value={form.current} onChange={v=>setForm(f=>({...f,current:v}))} required/>
        <InputField label="New Password" type="password" value={form.next} onChange={v=>setForm(f=>({...f,next:v}))} required/>
        <InputField label="Confirm New Password" type="password" value={form.confirm} onChange={v=>setForm(f=>({...f,confirm:v}))} required/>
        <SweepButton filled type="submit" disabled={submitting}>{submitting?"Saving…":"Change Password"}</SweepButton>
      </form>
    </div>

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
    {view==="dashboard"&&<AdminDashboard/>}
    {view==="products"&&<AdminProducts/>}
    {view==="orders"&&<AdminOrders/>}
    {view==="customers"&&<AdminCustomers/>}
    {view==="activity"&&<AdminActivityLog/>}
    {view==="returns"&&<AdminReturns/>}
    {view==="settings"&&<AdminSettings admin={admin}/>}
  </AdminShell>;
}

export default AdminApp;
