/**
 * Server-side HTML enrichment for SEO.
 * Not full React SSR — injects correct title/meta/canonical/JSON-LD and
 * crawlable body text into dist/index.html so Google sees real content
 * on first response. React still hydrates #root on the client.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { query } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = "https://www.akaraonline.co.in";
const DEFAULT_TITLE = "ĀKĀRA — Artifacts for Modern Spaces";
const DEFAULT_DESC =
  "Luxury 3D-printed home décor — planters, vases, and lighting, handcrafted to order in Mumbai.";

const STATIC_META = {
  "/": {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESC,
    body:
      "ĀKĀRA (akaraonline.co.in) is an online store and design atelier for luxury 3D-printed home décor. " +
      "Visitors can browse planters, vases, ceiling lights, table lamps, lanterns, and floor lamps, read product details and pricing, and place made-to-order purchases without signing in first. " +
      "Optional Google or email sign-in is only for saving addresses, tracking orders, and wishlists. " +
      "The purpose of this application is to sell and fulfil handcrafted décor printed to order in Mumbai, India.",
  },
  "/shop": {
    title: "Shop the collection — ĀKĀRA",
    description: "Browse planters, vases, ceiling lights, table lamps, lanterns, and floor lamps — printed to order.",
    body: "Explore the ĀKĀRA collection of luxury 3D-printed home décor.",
  },
  "/about": {
    title: "About ĀKĀRA",
    description: "The story of ĀKĀRA — form, material, and made-to-order craft from Mumbai.",
    body: "About ĀKĀRA and how each piece is designed and printed to order.",
  },
  "/craft": {
    title: "The Craft — ĀKĀRA",
    description: "How an ĀKĀRA piece is made — from digital form to finished object.",
    body: "How ĀKĀRA designs and 3D-prints each piece to order.",
  },
  "/contact": {
    title: "Contact — ĀKĀRA",
    description: "Contact ĀKĀRA for orders, bulk enquiries, and studio questions.",
    body: "Get in touch with the ĀKĀRA studio.",
  },
  "/faq": {
    title: "FAQ — ĀKĀRA",
    description: "Lead times, materials, shipping, and care — answers from ĀKĀRA.",
    body: "Frequently asked questions about ĀKĀRA orders and products.",
  },
  "/bulk-orders": {
    title: "Bulk & corporate orders — ĀKĀRA",
    description: "Bulk and corporate enquiries for ĀKĀRA made-to-order décor.",
    body: "Request bulk or corporate orders from ĀKĀRA.",
  },
  "/care-guide": {
    title: "Care guide — ĀKĀRA",
    description: "How to care for your ĀKĀRA 3D-printed pieces.",
    body: "Care guidance for ĀKĀRA products.",
  },
  "/shipping": {
    title: "Shipping — ĀKĀRA",
    description: "Made-to-order lead times, dispatch windows, and delivery for ĀKĀRA across India.",
    body:
      "ĀKĀRA pieces are made to order in Mumbai / Thane. Typical production is 2–3 weeks before dispatch. " +
      "Delivery within India is arranged after QC; exact courier ETAs depend on pin code and are shared when the order ships. " +
      "Prices on product pages are exclusive of GST; 18% GST is calculated at checkout. Online payments are processed by Razorpay; COD is available where offered. " +
      "See the full shipping policy on this page for returns of damaged goods and contact support@akaraonline.co.in for regional questions.",
  },
  "/privacy": {
    title: "Privacy Policy — ĀKĀRA",
    description: "How ĀKĀRA collects, uses, stores, and protects personal data for akaraonline.co.in, including Google Sign-In.",
    body:
      "Privacy Policy for ĀKĀRA (www.akaraonline.co.in). " +
      "Data we may collect: name, email address, phone number, shipping address, order history, payment status (payment card data is handled by Razorpay — we do not store full card numbers), account password hash if you register with email, Google account ID and basic profile if you use Google Sign-In, device/browser type, and basic analytics. " +
      "How we use data: to create and manage your account, process and fulfil orders, send order confirmations and shipping updates, respond to support requests, improve the website, and comply with law. " +
      "Google Sign-In: if you choose Continue with Google we receive your Google user ID, name, and email from Google to create or log into your ĀKĀRA customer account. We do not post to Google on your behalf. " +
      "Legal basis and retention: we keep account and order data as needed for orders, tax, and support, and as required under applicable Indian law including the Digital Personal Data Protection Act, 2023. " +
      "Sharing: logistics partners (e.g. Shiprocket) for delivery, Razorpay for payments, and hosting infrastructure. We do not sell personal data. " +
      "Your rights: access, correction, deletion, and grievance redressal via contact on this site. Contact: admin@akaraonline.co.in. Full interactive policy sections are also available on this page in the website.",
  },
  "/terms": { title: "Terms — ĀKĀRA", description: "ĀKĀRA terms of use.", body: "Terms of use." },
  "/refund": { title: "Refunds — ĀKĀRA", description: "ĀKĀRA refund policy.", body: "Refund policy." },
  "/cookies": { title: "Cookies — ĀKĀRA", description: "ĀKĀRA cookie policy.", body: "Cookie policy." },
  "/accessibility": {
    title: "Accessibility — ĀKĀRA",
    description: "Accessibility at ĀKĀRA.",
    body: "Accessibility information.",
  },
};

const CAT_SLUG_TO_NAME = {
  planters: "Planters",
  vases: "Vases",
  "ceiling-lighting": "Ceiling Lighting",
  "table-lamps": "Table Lamps",
  lanterns: "Lanterns",
  "floor-lamps": "Floor Lamps",
};

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Only allow http(s) absolute or site-relative image URLs in meta tags. */
function safeHttpUrl(u) {
  if (u == null || u === "") return null;
  const str = String(u).trim();
  try {
    const parsed = new URL(str, SITE);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function firstImage(media) {
  try {
    const arr = typeof media === "string" ? JSON.parse(media) : media;
    if (!Array.isArray(arr)) return null;
    for (const m of arr) {
      if (m && m.type === "image" && m.src) {
        const safe = safeHttpUrl(m.src);
        if (safe) return safe;
      }
    }
    return null;
  } catch {
    return null;
  }
}

let cachedTemplate = null;
let cachedAt = 0;

function loadTemplate() {
  const now = Date.now();
  if (cachedTemplate && now - cachedAt < 10_000) return cachedTemplate;
  const file = path.join(__dirname, "..", "dist", "index.html");
  if (!fs.existsSync(file)) {
    // Dev without build — fall back to source index (Vite will still own HMR in dev)
    const src = path.join(__dirname, "..", "index.html");
    cachedTemplate = fs.existsSync(src) ? fs.readFileSync(src, "utf8") : null;
  } else {
    cachedTemplate = fs.readFileSync(file, "utf8");
  }
  cachedAt = now;
  return cachedTemplate;
}

export async function resolveSeo(pathname) {
  const pathOnly = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";

  // Product: /product/:id
  const productMatch = pathOnly.match(/^\/product\/([^/]+)$/);
  if (productMatch) {
    const id = decodeURIComponent(productMatch[1]);
    const { rows } = await query(
      `SELECT id, name, category, price, description, meta_title, meta_desc, media, status
       FROM products WHERE id = $1 AND status NOT IN ('draft','hidden') LIMIT 1`,
      [id]
    );
    if (rows.length) {
      const p = rows[0];
      const title = p.meta_title || `${p.name} — ĀKĀRA`;
      const description =
        p.meta_desc ||
        (p.description ? String(p.description).slice(0, 160) : `${p.name} · ${p.category} · made to order at ĀKĀRA.`);
      const image = firstImage(p.media);
      const body = `${p.name}. ${p.category}. ₹${Number(p.price).toLocaleString("en-IN")}. ${String(p.description || "").slice(0, 400)}`;
      return {
        title,
        description,
        canonical: `${SITE}/product/${p.id}`,
        image: safeHttpUrl(image) || `${SITE}/icon-512.png`,
        type: "product",
        body,
        product: {
          id: p.id,
          name: p.name,
          description: p.description || description,
          price: Number(p.price),
          category: p.category,
          image,
        },
      };
    }
  }

  // Shop category: /shop/:slug
  const shopCat = pathOnly.match(/^\/shop\/([^/]+)$/);
  if (shopCat && CAT_SLUG_TO_NAME[shopCat[1]]) {
    const name = CAT_SLUG_TO_NAME[shopCat[1]];
    return {
      title: `${name} — ĀKĀRA`,
      description: `Shop ${name.toLowerCase()} from ĀKĀRA — made-to-order 3D-printed home décor from Mumbai.`,
      canonical: `${SITE}/shop/${shopCat[1]}`,
      image: `${SITE}/icon-512.png`,
      type: "website",
      body: `ĀKĀRA ${name} collection — printed to order.`,
    };
  }

  const staticMeta = STATIC_META[pathOnly];
  if (staticMeta) {
    const base = {
      title: staticMeta.title,
      description: staticMeta.description,
      canonical: `${SITE}${pathOnly === "/" ? "" : pathOnly}`,
      image: `${SITE}/icon-512.png`,
      type: "website",
      body: staticMeta.body,
    };
    if (pathOnly === "/faq") {
      try {
        const { rows } = await query(
          `SELECT block_type, content FROM page_content
           WHERE page_key = 'faq' ORDER BY sort_order ASC NULLS LAST, id ASC`
        );
        const items = [];
        for (const b of rows) {
          if (b.block_type === "qa") {
            try {
              const { q, a } = JSON.parse(b.content);
              if (q && a) items.push([String(q).slice(0, 300), String(a).slice(0, 2000)]);
            } catch { /* skip */ }
          }
        }
        if (items.length) base.faqItems = items.slice(0, 50);
      } catch (e) {
        console.error("FAQ SEO load failed:", e?.message || e);
      }
    }
    return base;
  }

  return {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESC,
    canonical: `${SITE}${pathOnly}`,
    image: `${SITE}/icon-512.png`,
    type: "website",
    body: DEFAULT_DESC,
  };
}

function jsonLd(seo) {
  if (seo.product) {
    const p = seo.product;
    return {
      "@context": "https://schema.org",
      "@type": "Product",
      name: p.name,
      description: p.description,
      sku: p.id,
      category: p.category,
      image: p.image ? [p.image] : undefined,
      brand: { "@type": "Brand", name: "ĀKĀRA" },
      offers: {
        "@type": "Offer",
        priceCurrency: "INR",
        price: p.price,
        availability: "https://schema.org/PreOrder",
        url: seo.canonical,
      },
    };
  }
  if (seo.faqItems && seo.faqItems.length) {
    return {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: seo.faqItems.map(([q, a]) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    };
  }
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "ĀKĀRA",
    url: SITE,
    description: DEFAULT_DESC,
    logo: `${SITE}/icon-512.png`,
  };
}

export async function renderSeoHtml(pathname) {
  const template = loadTemplate();
  if (!template) return null;
  const seo = await resolveSeo(pathname);
  const ld = JSON.stringify(jsonLd(seo)).replace(/</g, "\u003c").replace(/>/g, "\u003e");

  let html = template;

  // Title
  if (/<title>[^<]*<\/title>/i.test(html)) {
    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(seo.title)}</title>`);
  } else {
    html = html.replace(/<\/head>/i, `<title>${escapeHtml(seo.title)}</title></head>`);
  }

  // Strip existing conflicting tags we re-inject
  html = html.replace(/<meta\s+name=["']description["'][^>]*>/gi, "");
  html = html.replace(/<link\s+rel=["']canonical["'][^>]*>/gi, "");
  html = html.replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, "");
  html = html.replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, "");
  html = html.replace(/<script type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, "");

  const headInject = `
    <meta name="description" content="${escapeHtml(seo.description)}" />
    <link rel="canonical" href="${escapeHtml(seo.canonical)}" />
    <meta property="og:type" content="${seo.type === "product" ? "product" : "website"}" />
    <meta property="og:site_name" content="ĀKĀRA" />
    <meta property="og:title" content="${escapeHtml(seo.title)}" />
    <meta property="og:description" content="${escapeHtml(seo.description)}" />
    <meta property="og:url" content="${escapeHtml(seo.canonical)}" />
    <meta property="og:image" content="${escapeHtml(seo.image)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(seo.title)}" />
    <meta name="twitter:description" content="${escapeHtml(seo.description)}" />
    <meta name="twitter:image" content="${escapeHtml(seo.image)}" />
    <script type="application/ld+json">${ld}</script>
  `;
  html = html.replace(/<\/head>/i, `${headInject}</head>`);

  // Crawlable content inside #root — React will replace on hydrate
  const paragraphs = String(seo.body || "")
    .split(/(?<=\.)\s+/)
    .filter(Boolean)
    .map((para) => `<p>${escapeHtml(para)}</p>`)
    .join("");
  // Crawlable copy stays in the DOM for bots, but is visually hidden so
  // users never see a cream "SSR card" flash before React hydrates.
  const ssrBlock = `<div id="root"><main data-ssr="1" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0"><h1>${escapeHtml(seo.title)}</h1>${paragraphs}<p><a href="${escapeHtml(seo.canonical)}">${escapeHtml(seo.canonical)}</a></p><p>ĀKĀRA — public storefront. Browsing does not require login.</p></main></div>`;
  if (/<div id="root"><\/div>/.test(html)) {
    html = html.replace(/<div id="root"><\/div>/, ssrBlock);
  } else if (/<div id="root">[\s\S]*?<\/div>/.test(html)) {
    html = html.replace(/<div id="root">[\s\S]*?<\/div>/, ssrBlock);
  }

  return html;
}
