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
  PlusCircle, Trash2, AlertCircle,
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { T, sanitize, apiFetch, Mac, SweepButton, InputField } from "./shared.jsx";

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
  return <div className="min-h-screen w-full flex items-center justify-center px-6" style={{backgroundColor:T.teal}}>
    <div className="w-full max-w-[380px] p-8" style={{backgroundColor:T.cream}}>
      <p className="text-[20px] mb-1 text-center" style={{fontFamily:"'Fraunces',serif",fontStyle:"italic",color:T.teal}}><Mac>A</Mac>K<Mac>A</Mac>RA</p>
      <p className="text-[11px] tracking-[0.2em] uppercase text-center mb-8" style={{color:T.gold}}>Admin</p>
      {err&&<div className="flex items-center gap-2 px-4 py-3 mb-5 text-[13px]" style={{backgroundColor:"rgba(192,57,43,0.07)",color:T.error}}><AlertCircle size={14}/>{err}</div>}
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <InputField label="Email" type="email" value={email} onChange={setEmail} required/>
        <InputField label="Password" type="password" value={password} onChange={setPassword} required/>
        <SweepButton filled type="submit" disabled={submitting} className="w-full">{submitting?"Signing in…":"Sign In"}</SweepButton>
      </form>
    </div>
  </div>;
}

function AdminShell({ admin, view, setView, onLogout, children }){
  const items=[["dashboard","Dashboard",LayoutDashboard],["products","Products",Package],["orders","Orders",ShoppingCart]];
  return <div className="min-h-screen w-full flex" style={{backgroundColor:T.cream}}>
    <aside className="w-[220px] shrink-0 flex flex-col" style={{backgroundColor:T.teal}}>
      <div className="px-6 py-7">
        <p className="text-[17px] italic text-white" style={{fontFamily:"'Fraunces',serif"}}><Mac>A</Mac>K<Mac>A</Mac>RA</p>
        <p className="text-[10px] tracking-[0.2em] uppercase" style={{color:T.goldLight}}>Admin</p>
      </div>
      <nav className="flex-1 px-3">
        {items.map(([id,label,Icon])=><button key={id} onClick={()=>setView(id)}
          className="w-full flex items-center gap-3 px-3 py-3 text-[13px] mb-1 transition-colors"
          style={{backgroundColor:view===id?"rgba(255,255,255,0.1)":"transparent",color:view===id?"white":"rgba(255,255,255,0.55)"}}>
          <Icon size={16}/>{label}
        </button>)}
      </nav>
      <div className="px-6 py-6" style={{borderTop:"1px solid rgba(255,255,255,0.1)"}}>
        <p className="text-[11.5px] mb-3" style={{color:"rgba(255,255,255,0.5)"}}>{admin.email}</p>
        <button onClick={onLogout} className="flex items-center gap-2 text-[12.5px]" style={{color:"rgba(255,255,255,0.6)"}}><LogOut size={13}/> Sign Out</button>
      </div>
    </aside>
    <main className="flex-1 overflow-auto">{children}</main>
  </div>;
}

function AdminDashboard(){
  const [data,setData]=useState(null); const [loading,setLoading]=useState(true); const [err,setErr]=useState(false);
  useEffect(()=>{
    fetch("/api/admin/dashboard",{credentials:"include"})
      .then(r=>{ if(!r.ok) throw new Error(); return r.json(); })
      .then(setData).catch(()=>setErr(true)).finally(()=>setLoading(false));
  },[]);
  if(loading) return <div className="p-10 text-[13px]" style={{color:"rgba(36,62,65,0.5)"}}>Loading dashboard…</div>;
  if(err||!data) return <div className="p-10 text-[13px]" style={{color:T.error}}>Couldn't load dashboard data.</div>;
  const chartData=data.revenueTrend.map(r=>({day:new Date(r.day).toLocaleDateString("en-IN",{day:"2-digit",month:"short"}),revenue:r.revenue}));
  return <div className="p-8">
    <h1 className="italic text-[26px] mb-8" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Dashboard</h1>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {[["Total Revenue",`₹${data.totalRevenue.toLocaleString("en-IN")}`],["Paid Orders",data.paidOrderCount],["New Customers (30d)",data.newCustomersLast30Days],["Low Stock Items",data.lowStock.length]].map(([label,val])=>
        <div key={label} className="p-5" style={{backgroundColor:"white",boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
          <p className="text-[11px] uppercase tracking-[0.06em] mb-2" style={{color:"rgba(36,62,65,0.5)"}}>{label}</p>
          <p className="text-[24px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>{val}</p>
        </div>)}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      <div className="p-5" style={{backgroundColor:"white",boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
        <p className="text-[12px] uppercase tracking-[0.06em] mb-4" style={{color:T.teal}}>Revenue — last 30 days</p>
        {chartData.length===0?<p className="text-[12.5px] py-10 text-center" style={{color:"rgba(36,62,65,0.4)"}}>No paid orders yet in this window.</p>:
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="rgba(36,62,65,0.08)"/><XAxis dataKey="day" tick={{fontSize:11}}/><YAxis tick={{fontSize:11}}/><Tooltip/><Line type="monotone" dataKey="revenue" stroke={T.gold} strokeWidth={2} dot={false}/></LineChart>
        </ResponsiveContainer>}
      </div>
      <div className="p-5" style={{backgroundColor:"white",boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
        <p className="text-[12px] uppercase tracking-[0.06em] mb-4" style={{color:T.teal}}>Best Sellers</p>
        {data.bestSellers.length===0?<p className="text-[12.5px] py-10 text-center" style={{color:"rgba(36,62,65,0.4)"}}>No paid orders yet.</p>:
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data.bestSellers}><CartesianGrid strokeDasharray="3 3" stroke="rgba(36,62,65,0.08)"/><XAxis dataKey="productName" tick={{fontSize:10}} interval={0} angle={-15} textAnchor="end" height={50}/><YAxis tick={{fontSize:11}}/><Tooltip/><Bar dataKey="unitsSold" fill={T.teal}/></BarChart>
        </ResponsiveContainer>}
      </div>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="p-5" style={{backgroundColor:"white",boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
        <p className="text-[12px] uppercase tracking-[0.06em] mb-4" style={{color:T.teal}}>Low Stock / Sold Out</p>
        {data.lowStock.length===0?<p className="text-[12.5px]" style={{color:"rgba(36,62,65,0.4)"}}>Nothing low or out of stock.</p>:
        <div className="flex flex-col gap-2">{data.lowStock.map(p=><div key={p.id} className="flex justify-between text-[12.5px] py-1.5" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}><span style={{color:T.teal}}>{p.name}</span><span style={{color:p.stock==="sold-out"?T.error:T.gold}}>{p.stock}</span></div>)}</div>}
      </div>
      <div className="p-5" style={{backgroundColor:"white",boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
        <p className="text-[12px] uppercase tracking-[0.06em] mb-4" style={{color:T.teal}}>Recent Orders</p>
        <div className="flex flex-col gap-2">{data.recentOrders.map(o=><div key={o.orderNumber} className="flex justify-between text-[12.5px] py-1.5" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}><span style={{color:T.teal}}>#{o.orderNumber}</span><span style={{color:"rgba(36,62,65,0.55)"}}>₹{o.total.toLocaleString("en-IN")} · {o.paymentStatus}</span></div>)}</div>
      </div>
    </div>
  </div>;
}

function AdminProducts(){
  const [products,setProducts]=useState([]); const [loading,setLoading]=useState(true);
  const [editing,setEditing]=useState(null); const [showNew,setShowNew]=useState(false);
  const [newForm,setNewForm]=useState({id:"",name:"",category:"Planters",price:"",dims:"",hsn:"3924"});
  const load=()=>{ setLoading(true); fetch("/api/admin/products",{credentials:"include"}).then(r=>r.json()).then(d=>setProducts(d.products||[])).finally(()=>setLoading(false)); };
  useEffect(load,[]);
  const startEdit=p=>setEditing({...p});
  const saveEdit=async()=>{
    const res=await apiFetch(`/api/admin/products/${editing.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:editing.name,price:Number(editing.price),stock:editing.stock,description:editing.description})});
    if(res.ok){ setEditing(null); load(); }
  };
  const createProduct=async()=>{
    const res=await apiFetch("/api/admin/products",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...newForm,price:Number(newForm.price)})});
    if(res.ok){ setShowNew(false); setNewForm({id:"",name:"",category:"Planters",price:"",dims:"",hsn:"3924"}); load(); }
  };
  const deleteProduct=async id=>{
    if(!window.confirm(`Delete "${id}"? This can't be undone.`)) return;
    const res=await apiFetch(`/api/admin/products/${id}`,{method:"DELETE"});
    if(res.ok) load();
  };
  return <div className="p-8">
    <div className="flex items-center justify-between mb-8">
      <h1 className="italic text-[26px]" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Products</h1>
      <SweepButton filled onClick={()=>setShowNew(s=>!s)}><span className="flex items-center gap-2"><PlusCircle size={14}/> New Product</span></SweepButton>
    </div>
    {showNew&&<div className="p-5 mb-6 grid grid-cols-2 md:grid-cols-3 gap-3" style={{backgroundColor:"white",boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
      <InputField label="ID (URL slug)" value={newForm.id} onChange={v=>setNewForm(f=>({...f,id:v}))}/>
      <InputField label="Name" value={newForm.name} onChange={v=>setNewForm(f=>({...f,name:v}))}/>
      <InputField label="Category" value={newForm.category} onChange={v=>setNewForm(f=>({...f,category:v}))}/>
      <InputField label="Price (₹)" value={newForm.price} onChange={v=>setNewForm(f=>({...f,price:v}))}/>
      <InputField label="Dimensions" value={newForm.dims} onChange={v=>setNewForm(f=>({...f,dims:v}))}/>
      <InputField label="HSN" value={newForm.hsn} onChange={v=>setNewForm(f=>({...f,hsn:v}))}/>
      <div className="col-span-full"><SweepButton filled onClick={createProduct}>Create</SweepButton></div>
    </div>}
    {loading?<p className="text-[13px]" style={{color:"rgba(36,62,65,0.5)"}}>Loading…</p>:
    <div className="flex flex-col" style={{backgroundColor:"white",boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
      {products.map(p=><div key={p.id} className="flex items-center gap-4 px-5 py-3" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}>
        {editing?.id===p.id?<>
          <input value={editing.name} onChange={e=>setEditing(v=>({...v,name:e.target.value}))} className="flex-1 text-[13px] px-2 py-1" style={{border:"1px solid rgba(36,62,65,0.2)"}}/>
          <input value={editing.price} onChange={e=>setEditing(v=>({...v,price:e.target.value}))} className="w-20 text-[13px] px-2 py-1" style={{border:"1px solid rgba(36,62,65,0.2)"}}/>
          <select value={editing.stock} onChange={e=>setEditing(v=>({...v,stock:e.target.value}))} className="text-[12px] px-2 py-1" style={{border:"1px solid rgba(36,62,65,0.2)"}}>
            <option value="in-stock">in-stock</option><option value="low-stock">low-stock</option><option value="sold-out">sold-out</option>
          </select>
          <button onClick={saveEdit} style={{color:T.gold}}><Save size={15}/></button>
          <button onClick={()=>setEditing(null)} style={{color:"rgba(36,62,65,0.4)"}}><X size={15}/></button>
        </>:<>
          <span className="flex-1 text-[13px]" style={{color:T.teal}}>{p.name}</span>
          <span className="text-[12px] w-16" style={{color:"rgba(36,62,65,0.5)"}}>{p.category}</span>
          <span className="text-[13px] w-16" style={{color:T.teal}}>₹{p.price}</span>
          <span className="text-[10.5px] uppercase w-20 px-2 py-1 text-center" style={{backgroundColor:p.stock==="in-stock"?"rgba(184,147,90,0.12)":"rgba(192,57,43,0.08)",color:p.stock==="in-stock"?T.gold:T.error}}>{p.stock}</span>
          <button onClick={()=>startEdit(p)} style={{color:T.teal}}><Pencil size={14}/></button>
          <button onClick={()=>deleteProduct(p.id)} style={{color:T.error}}><Trash2 size={14}/></button>
        </>}
      </div>)}
    </div>}
  </div>;
}

const ADMIN_ORDER_STATUSES=["confirmed","production","qc","dispatched","delivered","cancelled"];
function AdminOrders(){
  const [orders,setOrders]=useState([]); const [loading,setLoading]=useState(true);
  const load=()=>{ setLoading(true); fetch("/api/admin/orders",{credentials:"include"}).then(r=>r.json()).then(d=>setOrders(d.orders||[])).finally(()=>setLoading(false)); };
  useEffect(load,[]);
  const updateStatus=async(orderNumber,status)=>{
    const res=await apiFetch(`/api/admin/orders/${orderNumber}/status`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});
    if(res.ok) load();
  };
  return <div className="p-8">
    <h1 className="italic text-[26px] mb-8" style={{fontFamily:"'Fraunces',serif",color:T.teal}}>Orders</h1>
    {loading?<p className="text-[13px]" style={{color:"rgba(36,62,65,0.5)"}}>Loading…</p>:orders.length===0?<p className="text-[13px]" style={{color:"rgba(36,62,65,0.5)"}}>No orders yet.</p>:
    <div className="flex flex-col" style={{backgroundColor:"white",boxShadow:"0 0 0 1px rgba(36,62,65,0.08)"}}>
      {orders.map(o=><div key={o.orderNumber} className="flex items-center gap-4 px-5 py-3 flex-wrap" style={{borderBottom:"1px solid rgba(36,62,65,0.06)"}}>
        <span className="text-[13px] w-24" style={{color:T.teal}}>#{o.orderNumber}</span>
        <span className="text-[12px] flex-1 min-w-[140px]" style={{color:"rgba(36,62,65,0.6)"}}>{o.email}</span>
        <span className="text-[13px] w-20" style={{color:T.teal}}>₹{o.total.toLocaleString("en-IN")}</span>
        <span className="text-[10.5px] uppercase w-20 px-2 py-1 text-center" style={{backgroundColor:o.paymentStatus==="paid"?"rgba(184,147,90,0.12)":"rgba(192,57,43,0.08)",color:o.paymentStatus==="paid"?T.gold:T.error}}>{o.paymentStatus}</span>
        <select value={o.status} onChange={e=>updateStatus(o.orderNumber,e.target.value)} className="text-[12px] px-2 py-1.5" style={{border:"1px solid rgba(36,62,65,0.2)"}}>
          {ADMIN_ORDER_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
      </div>)}
    </div>}
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
  </AdminShell>;
}

export default AdminApp;
