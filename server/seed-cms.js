// ============================================================================
// CMS CONTENT SEED — populates page_content with the REAL, EXISTING text
// from every static content page, extracted directly from AkaraApp.jsx's
// current hardcoded components. This is what makes switching those
// components over to reading from the database a non-event for anyone
// visiting the site — the content is identical, word for word, just
// coming from a different place afterward.
//
// Markup convention for the ~10 blocks across the site that contain a
// real embedded link (not just plain text) — confirmed necessary rather
// than flattening them, since several genuinely link to real, working
// pages (Cookie Policy, Request a Return) or a real mailto: address:
//   [visible text](internal-page-key)   -> in-app navigation
//   [visible text](mailto:address)       -> a real mailto: link
//   **bold text**                        -> bold emphasis (e.g. a named person)
// The renderer (see PageContentBlock in AkaraApp.jsx) parses this same
// convention back into real <button>/<a>/<strong> elements — nothing
// about how these links actually work changes, only where the
// surrounding text lives.
// ============================================================================
import { query, pool } from "./db.js";

const PAGES = {
  privacy: [
    { type: "paragraph", content: "Precision Forge Labs ('we', 'us', 'our') operates ĀKĀRA at akaraonline.co.in. This policy explains what personal data we collect, why, how it's protected, and the rights you have over it under India's Digital Personal Data Protection Act, 2023 (DPDP Act)." },
    { type: "heading", content: "1. Scope" },
    { type: "paragraph", content: "This policy applies to anyone who visits akaraonline.co.in, creates an account, or places an order with us. By using the site, you consent to the practices described here." },
    { type: "heading", content: "2. What We Collect" },
    { type: "paragraph", content: "Order information: name, email, phone number, shipping and billing address. Account information: email and any profile details you add. Payment information: processed entirely by Razorpay — we never see or store your card, UPI, or bank details. Browsing data: your cart and wishlist are stored locally in your browser, not on our servers, unless you're signed in." },
    { type: "heading", content: "3. How We Use It" },
    { type: "paragraph", content: "To process and deliver your order, send order and shipping updates, respond to enquiries, and improve the site. We do not sell your personal data to third parties, and we don't use it for purposes beyond what's described here without asking you first." },
    { type: "heading", content: "4. Legal Basis for Processing" },
    { type: "paragraph", content: "We process your data on the basis of your consent (given when you place an order or create an account), to fulfil our contractual obligation to deliver what you've purchased, and to comply with tax and legal record-keeping requirements under Indian law." },
    { type: "heading", content: "5. Who We Share Data With" },
    { type: "paragraph", content: "We share only what's necessary, with: Razorpay (payment processing), our courier partners — Delhivery, BlueDart (DHL), Shiprocket, and India Post (name, address, phone for delivery), Gupshup (WhatsApp order notifications, where you've provided a phone number), Resend (transactional email — order confirmations, password resets), Google Analytics (anonymous, aggregate browsing behaviour — see our Cookie Policy), Cloudflare (our security and content-delivery provider — sees traffic metadata like IP address for every request, as it does for the vast majority of websites), and tax authorities where legally required for GST compliance. None of these parties are permitted to use your data for their own marketing." },
    { type: "heading", content: "6. Cookies & Local Storage" },
    { type: "paragraph", content: "We use essential local storage to keep your cart and wishlist between visits, and Razorpay sets its own cookies during checkout. Full detail is in our [Cookie Policy](cookies)." },
    { type: "heading", content: "7. Data Retention" },
    { type: "table", content: JSON.stringify([
      ["Data Type", "Retention Period"],
      ["Order & transaction records", "8 years (statutory requirement under Indian tax law)"],
      ["Account information", "Until you request deletion or close your account"],
      ["Customer support correspondence", "3 years from the date of last contact"],
      ["Cart & wishlist (local storage)", "Until cleared by you or your browser"],
    ]) },
    { type: "heading", content: "8. Data Security" },
    { type: "paragraph", content: "We limit access to personal data to what's needed to fulfil your order, use Razorpay's PCI-DSS compliant infrastructure for all payments, and never store card, UPI, or bank details ourselves. While no system is 100% immune to risk, we take reasonable technical and organisational measures to protect your information." },
    { type: "heading", content: "9. Your Rights Under the DPDP Act, 2023" },
    { type: "table", content: JSON.stringify([
      ["Right", "What It Means"],
      ["Right to Access", "Request a copy of the personal data we hold about you"],
      ["Right to Correction", "Ask us to correct inaccurate or incomplete data"],
      ["Right to Erasure", "Request deletion of your data, subject to statutory retention requirements"],
      ["Right to Grievance Redressal", "Raise a complaint with our Grievance Officer, listed below"],
      ["Right to Nominate", "Nominate another individual to exercise these rights on your behalf in the event of death or incapacity"],
    ]) },
    { type: "paragraph", content: "To exercise any of these rights, write to [dpo@akaraonline.co.in](mailto:dpo@akaraonline.co.in). We aim to respond within 30 days." },
    { type: "heading", content: "10. Grievance Officer" },
    { type: "paragraph", content: "In accordance with applicable Indian data protection law, our Grievance Officer is **Vishal Singh**, reachable at [dpo@akaraonline.co.in](mailto:dpo@akaraonline.co.in) for any concerns regarding how your personal data is handled." },
    { type: "heading", content: "11. Children's Privacy" },
    { type: "paragraph", content: "Our site is intended for users who are 18 years or older, or minors with the involvement of a parent or guardian. We do not knowingly collect personal data from children without such involvement." },
    { type: "heading", content: "12. Changes to This Policy" },
    { type: "paragraph", content: "We may update this policy from time to time as our practices or the law evolve. Material changes will be reflected here with an updated 'Last updated' date." },
  ],
  refund: [
    { type: "paragraph", content: "Every ĀKĀRA piece is made to order. Please check size, colour, and photos carefully before ordering." },
    { type: "heading", content: "7-Day Return Window" },
    { type: "paragraph", content: "Returns accepted within 7 days of delivery if the piece arrives damaged, defective, or significantly different from what was described. We cannot accept returns for a change of mind." },
    { type: "heading", content: "30-Day Warranty" },
    { type: "paragraph", content: "Every piece is covered against manufacturing defects for 30 days from delivery." },
    { type: "heading", content: "How to Request" },
    { type: "paragraph", content: "Use our [Request a Return](return-request) page with your order number, the item, and a couple of photos — or email [support@akaraonline.co.in](mailto:support@akaraonline.co.in) directly. We respond within 72 hours." },
  ],
  shipping: [
    { type: "paragraph", content: "This policy explains how ĀKĀRA pieces are produced, packed, and delivered across India. Every product is 3D-printed to order in our Thane studio, so shipping timelines differ from off-the-shelf retail." },
    { type: "heading", content: "1. Production Time" },
    { type: "paragraph", content: "Nothing on akaraonline.co.in is stocked in advance. Once an order is placed, it enters our production queue and is 3D-printed to order — this takes 2–3 weeks depending on the piece and current order volume. We'll only dispatch once your piece has cleared quality control." },
    { type: "heading", content: "2. Shipping Cost" },
    { type: "paragraph", content: "Shipping is free on orders of ₹2,500 and above. Below that, standard shipping is ₹150 and express shipping is ₹199. Shipping cost is calculated at checkout and shown before you pay, along with applicable GST." },
    { type: "heading", content: "3. Delivery Time" },
    { type: "paragraph", content: "Once dispatched, delivery typically takes 3–7 business days depending on your location, on top of the 2–3 week production window. Metro cities are usually on the faster end of this range; remote or non-metro pin codes may take slightly longer." },
    { type: "heading", content: "4. Courier Partners" },
    { type: "paragraph", content: "We ship via Delhivery, BlueDart (DHL), Shiprocket, and India Post, chosen per order based on your location and the safest handling option for the piece. You'll receive the tracking details for whichever courier is assigned to your shipment." },
    { type: "heading", content: "5. Order Processing & Dispatch" },
    { type: "paragraph", content: "Once your piece is printed, quality-checked, and packed, it's handed to our courier partner and you'll receive a dispatch confirmation by email with your tracking number. You can also check live status any time from My Account → Orders → Track Order." },
    { type: "heading", content: "6. Packaging" },
    { type: "paragraph", content: "Every piece is individually wrapped and cushioned before being boxed — planters and vases are packed upright with internal bracing to prevent shifting in transit, and lighting pieces ship with the fitting and shade protected separately where applicable. Packaging materials are chosen to protect the piece, not for unnecessary bulk." },
    { type: "heading", content: "7. Serviceable Areas" },
    { type: "paragraph", content: "We currently ship across India, to all pin codes serviceable by our courier partners. For international orders, please write to [info@akaraonline.co.in](mailto:info@akaraonline.co.in) before ordering — we'll confirm feasibility and cost on a case-by-case basis." },
    { type: "heading", content: "8. Order Tracking" },
    { type: "paragraph", content: "Once dispatched, your order status moves through five stages — Confirmed, Production, QC & Packaging, Dispatched, and Delivered — visible from My Account → Orders → Track Order, along with the courier's own tracking link once available." },
    { type: "heading", content: "9. Failed Delivery Attempts" },
    { type: "paragraph", content: "Our courier partners typically attempt delivery 2–3 times before returning a shipment to us. Please ensure the address and phone number provided at checkout are accurate and reachable. If a shipment is returned due to repeated failed delivery, we'll get in touch to arrange reshipment — additional shipping charges may apply." },
    { type: "heading", content: "10. Damaged or Missing in Transit" },
    { type: "paragraph", content: "Every piece is quality-checked and carefully packed before it leaves our studio, but if your order arrives damaged, or an item is missing from the package, please email [support@akaraonline.co.in](mailto:support@akaraonline.co.in) within 7 days of delivery with your order number and photos of the item and packaging. We'll arrange a replacement or refund as covered under our Refund Policy — please don't discard the packaging until this is resolved, as our courier partner may need it for a claim." },
  ],
  terms: [
    { type: "paragraph", content: "These Terms of Service ('Terms') govern your use of akaraonline.co.in ('the Site'), operated by Precision Forge Labs under the brand ĀKĀRA. By browsing the Site, creating an account, or placing an order, you agree to be bound by these Terms." },
    { type: "heading", content: "1. Definitions" },
    { type: "paragraph", content: "\"We\", \"us\", \"our\" refers to Precision Forge Labs (GSTIN 27GZCPS9353H1ZQ). \"You\", \"customer\" refers to anyone browsing or ordering from the Site. \"Piece\" or \"product\" refers to any item listed for sale on the Site. \"Order\" refers to a confirmed purchase placed through checkout." },
    { type: "heading", content: "2. Acceptance of Terms" },
    { type: "paragraph", content: "Placing an order, creating an account, or continuing to use the Site after changes to these Terms are posted constitutes acceptance of the current version. If you do not agree, please discontinue use of the Site." },
    { type: "heading", content: "3. Eligibility" },
    { type: "paragraph", content: "You must be at least 18 years old, or place orders with the involvement of a parent or guardian if a minor, and capable of entering into a legally binding contract under Indian law to use this Site." },
    { type: "heading", content: "4. Nature of Products — Made to Order" },
    { type: "paragraph", content: "Every ĀKĀRA piece is 3D-printed to order in our Thane studio using plant-based PLA — nothing is pre-stocked. Production takes 2–3 weeks from order confirmation before a piece is dispatched. Because each item is produced individually rather than pulled from a warehouse, minor natural variation between pieces is expected and is not considered a defect." },
    { type: "heading", content: "5. 3D Printing Tolerances" },
    { type: "paragraph", content: "Due to the nature of the 3D printing process, dimensions listed on product pages carry a manufacturing tolerance of ±2–3mm. Colour may also appear very slightly different across production batches, and across different screens. These are inherent to made-to-order 3D-printed pieces and do not qualify as manufacturing defects under our Refund Policy." },
    { type: "heading", content: "6. Pricing & Taxes" },
    { type: "paragraph", content: "All prices on the Site are listed in Indian Rupees (INR) and are exclusive of GST, which is calculated and added at checkout at the applicable rate of 18% — split as CGST + SGST for intra-state (Maharashtra) orders, or IGST for orders shipped to other states, per Indian tax law. Relevant HSN codes are 3924 for planters and vases, and 9405 for lighting products. We reserve the right to correct any pricing errors on the Site, including after an order is placed, and will refund any payment taken for an order we're unable to honour at the listed price." },
    { type: "heading", content: "7. Order Placement & Acceptance" },
    { type: "paragraph", content: "Adding items to your cart does not guarantee availability or reserve stock. An order is only confirmed once payment is successfully processed and you receive an order confirmation with an order number. We reserve the right to refuse or cancel any order at our discretion — for example in cases of suspected fraud, pricing errors, or an inability to produce the piece as specified — with a full refund of any payment taken." },
    { type: "heading", content: "8. Payment" },
    { type: "paragraph", content: "Payments are processed securely via Razorpay, supporting cards, UPI, net banking, and wallets. We do not receive or store your card, UPI, or bank account details at any point — this is handled entirely within Razorpay's PCI-DSS compliant infrastructure." },
    { type: "heading", content: "9. Cancellation Policy" },
    { type: "paragraph", content: "Because production begins shortly after an order is confirmed, cancellation requests must be made within 24 hours of placing the order. Email support@akaraonline.co.in with your order number as soon as possible — once a piece has entered production, we may not be able to cancel or modify it." },
    { type: "heading", content: "10. Shipping & Delivery" },
    { type: "paragraph", content: "Shipping timelines, costs, and courier partners are detailed in our [Shipping Policy](shipping). Delivery estimates are provided in good faith and are not guaranteed, as they depend in part on our courier partners." },
    { type: "heading", content: "11. Returns, Refunds & Warranty" },
    { type: "paragraph", content: "Our return window, warranty coverage, and refund process are detailed in our [Refund & Return Policy](refund). In summary: a 7-day return window for damaged, defective, or significantly-different-than-described pieces, and a 30-day warranty against manufacturing defects." },
    { type: "heading", content: "12. Intellectual Property" },
    { type: "paragraph", content: "All designs, product names, photography, and content on this Site are the property of Precision Forge Labs and protected under applicable Indian intellectual property law. Nothing on this Site may be reproduced, copied, or used commercially without our written permission." },
    { type: "heading", content: "13. Prohibited Use" },
    { type: "paragraph", content: "You agree not to use the Site for any unlawful purpose, to attempt to gain unauthorised access to our systems or another user's account, to submit false or fraudulent order information, or to reproduce, resell, or reverse-engineer our product designs without authorisation." },
    { type: "heading", content: "14. Limitation of Liability" },
    { type: "paragraph", content: "To the extent permitted by law, Precision Forge Labs shall not be liable for indirect, incidental, or consequential damages arising from the use of this Site or our products, beyond the value of the order in question. Nothing in these Terms limits any right you have that cannot be excluded under Indian consumer protection law." },
    { type: "heading", content: "15. Governing Law & Jurisdiction" },
    { type: "paragraph", content: "These Terms are governed by the laws of India. Any disputes arising from these Terms or your use of the Site shall be subject to the exclusive jurisdiction of the courts in Mumbai, Maharashtra." },
  ],
  cookies: [
    { type: "paragraph", content: "This page explains the cookies and local storage akaraonline.co.in uses." },
    { type: "heading", content: "What We Use" },
    { type: "paragraph", content: "Essential: keeps your cart and wishlist saved between visits. Payment: Razorpay sets its own cookies during checkout. Analytics: Google Analytics — aggregate, anonymous data (pages visited, general location, device type) to help us understand and improve the site; no data is used to identify you personally. Security & delivery: Cloudflare, our security and content-delivery provider, may set cookies to help distinguish real visitors from automated traffic — this is standard for the vast majority of websites and isn't used for advertising." },
    { type: "heading", content: "What We Don't Do" },
    { type: "paragraph", content: "We don't use cookies to track you across other websites or build advertising profiles." },
    { type: "heading", content: "Managing Cookies" },
    { type: "paragraph", content: "You can block or delete cookies in your browser settings. Blocking essential cookies means your cart won't persist between visits." },
  ],
  accessibility: [
    { type: "paragraph", content: "Precision Forge Labs is committed to making akaraonline.co.in usable by as many people as possible, including people with visual, motor, auditory, or cognitive disabilities." },
    { type: "heading", content: "What We Aim For" },
    { type: "paragraph", content: "We aim to follow the Web Content Accessibility Guidelines (WCAG) 2.1 at a Level AA standard where practical — covering things like readable colour contrast, keyboard navigability, descriptive alt text on meaningful images, and clear, consistent navigation." },
    { type: "heading", content: "Ongoing Work" },
    { type: "paragraph", content: "Accessibility is an ongoing effort, not a one-time fix. As the site grows — new products, new pages, new features — we review and improve accessibility alongside that work rather than treating it as separate." },
    { type: "heading", content: "Feedback" },
    { type: "paragraph", content: "If you encounter any part of this site that's difficult to use with a screen reader, keyboard-only navigation, or any other assistive technology, please let us know at [support@akaraonline.co.in](mailto:support@akaraonline.co.in) — we take this feedback seriously and will do our best to address it." },
  ],
  // FAQ — real structure: a category heading, then that category's
  // real question+answer pairs, repeated per category. Extracted
  // directly from the existing FAQ_DATA constant in AkaraApp.jsx —
  // same real content, word for word, just moved to the database.
  faq: [
    { type: "heading", content: "General" },
    { type: "qa", content: JSON.stringify({ q: "What is your production lead time?", a: "Every piece is made to order. Production takes 2–3 weeks, then it ships." }) },
    { type: "qa", content: JSON.stringify({ q: "Do you offer custom sizes?", a: "We offer the sizes and finishes listed on each product page. For custom or bulk requests, reach out via Contact." }) },
    { type: "qa", content: JSON.stringify({ q: "Where are your pieces made?", a: "Designed and 3D-printed in our Mumbai studio using plant-based PLA." }) },
    { type: "heading", content: "Orders & Payment" },
    { type: "qa", content: JSON.stringify({ q: "What payment methods do you accept?", a: "Cards, UPI, and net banking via Razorpay." }) },
    { type: "qa", content: JSON.stringify({ q: "Can I change my order?", a: "Since production starts quickly, reach out within a few hours of ordering." }) },
    { type: "heading", content: "Shipping" },
    { type: "qa", content: JSON.stringify({ q: "How much does shipping cost?", a: "Free above ₹2,500, otherwise ₹150 standard or ₹199 express." }) },
    { type: "qa", content: JSON.stringify({ q: "How long does delivery take?", a: "2–3 weeks production, then 3–7 business days for delivery." }) },
    { type: "heading", content: "Returns" },
    { type: "qa", content: JSON.stringify({ q: "What's your return policy?", a: "7-day return window for damaged or defective pieces, 30-day warranty on all items." }) },
    { type: "qa", content: JSON.stringify({ q: "How do I request a return?", a: "Use the Request a Return page with your order number and reason — it opens a pre-filled email to our team with everything we need." }) },
    { type: "heading", content: "Product Care" },
    { type: "qa", content: JSON.stringify({ q: "How do I clean my ĀKĀRA piece?", a: "Wipe gently with a soft, dry microfibre cloth. For planters and vases, a lightly damp cloth is fine — avoid soaking, as this is 3D-printed PLA, not ceramic." }) },
    { type: "qa", content: JSON.stringify({ q: "Can I use these outdoors?", a: "Plant-based PLA is not UV or heavily weather-resistant. We recommend indoor or covered, shaded outdoor use only — prolonged direct sun or rain can warp the material over time." }) },
    { type: "qa", content: JSON.stringify({ q: "Is it safe near water or soil moisture?", a: "Yes for everyday planting and styling use. Avoid prolonged submersion. Line planters with a nursery pot if watering directly." }) },
    { type: "qa", content: JSON.stringify({ q: "How do I care for lamps and lighting pieces?", a: "Dust with a dry cloth only. Never submerge the base or fitting. Use the specified bulb wattage to avoid heat buildup near the printed shade." }) },
    { type: "qa", content: JSON.stringify({ q: "Will the finish fade over time?", a: "With normal indoor use, colour is stable for years. Direct, sustained sunlight will fade any pigment gradually — reposition occasionally if placed near a window." }) },
  ],
  // Care Guide — real structure: an intro paragraph, then real sections
  // each with a title and bullet points. Extracted directly from the
  // existing CARE_SECTIONS constant in AkaraApp.jsx.
  "care-guide": [
    { type: "paragraph", content: "Every piece is 3D-printed in plant-based PLA — closer in care needs to a fine ceramic than to plastic homeware. A little care keeps the finish and colour looking the way it did on day one." },
    { type: "bulletList", content: JSON.stringify({ title: "General Care — All Pieces", points: [
      "Wipe gently with a soft, dry microfibre cloth for everyday dusting.",
      "For a deeper clean, a lightly damp cloth is fine — avoid soaking or submerging any piece.",
      "Not dishwasher safe, and not microwave or oven safe.",
      "Avoid prolonged direct sunlight — it won't damage the piece, but pigment will fade gradually over months of constant exposure.",
    ]}) },
    { type: "bulletList", content: JSON.stringify({ title: "Planters & Vases", points: [
      "If watering directly, check the drainage tray regularly to prevent water pooling underneath.",
      "For planters without visible drainage, line with a nursery pot rather than watering directly into the piece.",
      "Fine dust in lattice or ribbed detailing can be lifted with a soft dry brush (an old, clean makeup brush works well).",
      "Avoid prolonged outdoor exposure to rain — plant-based PLA is not fully weatherproof; covered, shaded outdoor spots are fine.",
    ]}) },
    { type: "bulletList", content: JSON.stringify({ title: "Lighting — Pendants, Table & Floor Lamps", points: [
      "Always switch off and allow the fixture to cool before cleaning.",
      "Dust with a dry cloth only — never use a damp cloth near the fitting or wiring.",
      "Use the bulb wattage specified for your piece; overpowered bulbs can cause heat buildup near the printed shade.",
      "If a piece is rated for indoor use only, keep it away from bathrooms or other high-humidity areas.",
    ]}) },
    { type: "bulletList", content: JSON.stringify({ title: "Long-Term Care", points: [
      "Reposition pieces occasionally if they sit near a window, to keep fading even over time.",
      "Small variations in texture or matte finish between pieces are part of the 3D-printing process, not a defect.",
      "If a piece is ever damaged in a way that concerns you, photograph it and reach out — see our Return Request page.",
    ]}) },
  ],
  // About and Craft — real transcription of the exact current content
  // from AkaraApp.jsx's AboutView/CraftView, using the five new layout-
  // shape block types (hero/quote/darkPanel/stepGrid/cardGrid) rather
  // than flattening them into plain paragraphs, since the whole point
  // of this pass was to keep these two pages' actual visual design
  // intact while making the real words editable.
  about: [
    { type: "hero", content: JSON.stringify({
      eyebrow: "About ĀKĀRA",
      heading: "We didn't want a name already sitting on a shelf somewhere. **Ākāra** — Sanskrit for form — was the only one that felt honest.",
      subtext: "We make geometric home décor the way we think it should be made — nothing shaped by what's cheap to mould in bulk, only what actually works, and only once you've asked for it.",
    }) },
    { type: "paragraph", content: "Most home décor is designed to be produced, not to be lived with." },
    { type: "paragraph", content: "Shapes get chosen because they're cheap to injection-mould at scale, not because they hold a plant well or earn a real place on a shelf. We build the other way." },
    { type: "paragraph", content: "Every piece starts as a precise geometric idea, tested for drainage, balance, and light diffusion before it's ever offered. And nothing is printed until you order it." },
    { type: "stepGrid", content: JSON.stringify({
      eyebrow: "How a piece is made", heading: "From idea to your door.",
      steps: [
        { number: "01", title: "Design", description: "Every form is modelled and function-tested before it's offered." },
        { number: "02", title: "Order", description: "Nothing is produced speculatively. Your order starts the queue." },
        { number: "03", title: "Print", description: "Precision 3D-printed in our Mumbai studio, layer by layer." },
        { number: "04", title: "Finish", description: "Hand-finished and quality-checked before leaving the studio." },
        { number: "05", title: "Ship", description: "Tracked delivery, typically 2–3 weeks from order to door." },
      ],
    }) },
    { type: "quote", content: JSON.stringify({
      quote: "We'd rather make sixty pieces a month that were actually asked for than six hundred that might sell eventually.",
      attribution: "The ĀKĀRA Studio",
    }) },
  ],
  craft: [
    { type: "hero", content: JSON.stringify({
      eyebrow: "The Craft",
      heading: "Precision, not mass production.",
      subtext: "\"3D-printed\" can sound like a shortcut. In our studio it's the opposite — every piece is built layer by layer, to order, with the same attention a small workshop gives a handmade object.",
    }) },
    { type: "cardGrid", content: JSON.stringify({
      cards: [
        { title: "Design", description: "Every form starts as a precise geometric model — tested digitally for balance, drainage, and how light moves across it — before it's ever offered for sale. Nothing goes into production until the shape earns its place." },
        { title: "Material", description: "We print in plant-based PLA, a biodegradable material derived from renewable sources like corn starch, rather than petroleum-based plastic. It's chosen for finish quality and environmental footprint, not just cost." },
        { title: "Machine", description: "Production runs on Bambu Lab A1 COMBO printers — precision FDM machines capable of the fine layer resolution our geometric designs depend on. Each piece is printed individually, start to finish, for your specific order." },
      ],
    }) },
    { type: "darkPanel", content: JSON.stringify({
      eyebrow: "The Studio",
      heading: "Based in Thane, Maharashtra — producing roughly 60 to 90 pieces a month.",
      body: "That's a deliberate ceiling, not a limitation we're working around — small enough that every piece gets checked by hand before it ships, large enough to keep queue times honest.",
    }) },
    { type: "paragraph", content: "This page will grow to include real photos and short video of pieces actually being printed and finished in the studio — planned alongside the site's product photography." },
  ],
  // Homepage hero and footer — the "second CMS pass", real content
  // transcribed exactly from the current hardcoded HomeView/Footer
  // components in AkaraApp.jsx, the same real-transcription discipline
  // used for every other page converted so far.
  home: [
    { type: "heroWithCta", content: JSON.stringify({
      eyebrow: "Est. Mumbai · Made to Order",
      heading: "Let there<br/>be **form**.",
      subtext: "Precision geometric planters, vases and lighting — 3D-printed to order in our Mumbai studio, never pulled from a shelf.",
      ctaLabel: "Explore the Collection",
      ctaLabel2: "Our Story",
    }) },
  ],
  footer: [
    { type: "footerBrand", content: JSON.stringify({
      tagline: "Precision geometric home décor, 3D-printed to order in our Mumbai studio using plant-based materials.",
      email: "support@akaraonline.co.in",
      phone: "+91 82780 85572",
      instagram: "@atelier.akara",
      location: "India",
      newsletterBlurb: "New pieces, restocks — nothing more often than that.",
    }) },
  ],
};

async function main() {
  for (const [pageKey, blocks] of Object.entries(PAGES)) {
    const { rows: existing } = await query("SELECT COUNT(*) FROM page_content WHERE page_key=$1", [pageKey]);
    if (Number(existing[0].count) > 0) {
      console.log(`Skipping "${pageKey}" — already has ${existing[0].count} block(s). Delete its rows first if you want to reseed.`);
      continue;
    }
    for (let i = 0; i < blocks.length; i++) {
      await query(
        "INSERT INTO page_content (page_key, sort_order, block_type, content) VALUES ($1,$2,$3,$4)",
        [pageKey, i, blocks[i].type, blocks[i].content]
      );
    }
    console.log(`Seeded "${pageKey}" — ${blocks.length} blocks.`);
  }
  await pool.end();
}

main().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
