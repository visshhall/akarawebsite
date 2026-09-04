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
import { fileURLToPath } from "url";

export const PAGES = {
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
    { type: "paragraph", content: "This Refund & Return Policy applies to purchases from akaraonline.co.in. ĀKĀRA products are made to order. Please read this policy and each product page carefully before you buy." },
    { type: "heading", content: "1. Made to order — no change-of-mind returns" },
    { type: "paragraph", content: "We do not accept returns, exchanges, or refunds because you changed your mind, disliked the colour or texture in your space, ordered the wrong size by mistake after confirming checkout, redecorated, received as a gift you do not want, or no longer wish to keep the piece. Once production has started, convenience cancellations are not available." },
    { type: "heading", content: "2. When we will consider a claim" },
    { type: "paragraph", content: "A return, replacement, or refund is considered only if one of the following is verified by us: (a) the piece arrived damaged in transit; (b) a clear manufacturing defect affecting structure or function; (c) the wrong item was dispatched; or (d) the piece is significantly different from the written product description on our Site. Minor layer lines, small surface variation, and natural characteristics of 3D-printed PLA are normal and are not defects." },
    { type: "heading", content: "3. Strict time limits" },
    { type: "paragraph", content: "Transit damage: you must notify us within 48 hours of delivery, with clear photos of the item and the outer packaging. Manufacturing defects or wrong item: you must notify us within 7 days of delivery. Claims outside these windows will be declined, except where our limited warranty below expressly applies." },
    { type: "heading", content: "4. What you must provide" },
    { type: "paragraph", content: "Order number, item name, a detailed description of the issue, and clear photographs. We may ask for additional angles or packaging photos. Incomplete requests may be closed without action. Photo evidence is mandatory for damage and defect claims." },
    { type: "heading", content: "5. Inspection and condition" },
    { type: "paragraph", content: "If we approve a return for inspection, the piece must be unused, clean, and returned in its original packaging with all protective materials. Pieces that show use, soil, water damage from misuse, modification, or missing packaging may be rejected after inspection, with no refund." },
    { type: "heading", content: "6. Return shipping" },
    { type: "paragraph", content: "For verified transit damage or manufacturing defects, we will advise whether we arrange pickup or reimburse reasonable return shipping as directed by us. Do not ship a piece back without written approval — unapproved parcels may be refused." },
    { type: "heading", content: "7. Resolution" },
    { type: "paragraph", content: "After inspection, we may offer a replacement print or a refund to the original payment method, at our discretion. Refunds, when approved, are processed after inspection; bank or Razorpay timelines may add several business days. Partial refunds may apply if only part of an order is affected." },
    { type: "heading", content: "8. Limited warranty (30 days)" },
    { type: "paragraph", content: "Separately from transit claims, each piece is covered for 30 days from delivery against manufacturing defects that appear under normal indoor use. Misuse, outdoor exposure beyond our care guidelines, impact damage after delivery, or modification voids this warranty." },
    { type: "heading", content: "9. How to contact us" },
    { type: "paragraph", content: "Use our [Request a Return](return-request) page or email [support@akaraonline.co.in](mailto:support@akaraonline.co.in). We aim to respond within 72 hours on business days. Submitting a change-of-mind request does not create an entitlement to return." },
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
    { type: "paragraph", content: "Every piece is quality-checked and carefully packed before it leaves our studio, but if your order arrives damaged, or an item is missing from the package, please email [support@akaraonline.co.in](mailto:support@akaraonline.co.in) within 48 hours of delivery for transit damage (or within 7 days for a wrong/missing item) with your order number and photos of the item and packaging. We'll arrange a replacement or refund as covered under our Refund Policy — please don't discard the packaging until this is resolved, as our courier partner may need it for a claim." },
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
    { type: "paragraph", content: "Our return window, warranty coverage, and refund process are detailed in our [Refund & Return Policy](refund). In summary: pieces are made to order and are not returnable for change of mind; only verified transit damage (notify within 48 hours), manufacturing defects or wrong item (within 7 days), subject to photos and inspection; plus a 30-day limited warranty against manufacturing defects under normal indoor use." },
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
    { type: "qa", content: JSON.stringify({"q": "What is ĀKĀRA?", "a": "ĀKĀRA is an atelier for precision geometric home décor — planters, vases, and lighting — designed and 3D-printed to order in our Mumbai studio using plant-based PLA. Nothing is pulled pre-made from a warehouse shelf."}) },
    { type: "qa", content: JSON.stringify({"q": "Where are your pieces made?", "a": "Designed and 3D-printed in our Mumbai / Thane studio. Each order is produced after you place it, then quality-checked before dispatch."}) },
    { type: "qa", content: JSON.stringify({"q": "What material do you use?", "a": "We print in plant-based PLA chosen for form fidelity. It is intended for indoor or covered use — not prolonged direct sun, heavy weather, or high heat near open flames or hot appliances."}) },
    { type: "qa", content: JSON.stringify({"q": "What is your production lead time?", "a": "Every piece is made to order. Production typically takes 2–3 weeks after payment confirmation, then courier transit (usually a few business days within India). Exact timing can vary with order volume and the piece."}) },
    { type: "heading", content: "Orders & payment" },
    { type: "qa", content: JSON.stringify({"q": "What payment methods do you accept?", "a": "Cards, UPI, net banking, and other methods offered at checkout via Razorpay. Cash on delivery may be available on eligible orders where shown at checkout."}) },
    { type: "qa", content: JSON.stringify({"q": "Prices look exclusive of GST — is that right?", "a": "Yes. Listed prices are exclusive of GST. Applicable GST (typically 18% for these categories) is calculated and shown at checkout before you pay."}) },
    { type: "qa", content: JSON.stringify({"q": "Can I change or cancel my order?", "a": "Because production is queued quickly, changes or cancellations are only possible if we have not started printing. Contact support@akaraonline.co.in immediately with your order number. Once production has started, the order cannot be cancelled for convenience, and payment is not refunded for change of mind."}) },
    { type: "qa", content: JSON.stringify({"q": "Do you offer custom sizes or bulk orders?", "a": "Sizes and finishes on each product page are what we produce as standard. For bulk or corporate requests, use the Bulk & Corporate Orders page or Contact — custom work is quoted separately and is generally non-returnable once approved."}) },
    { type: "heading", content: "Shipping" },
    { type: "qa", content: JSON.stringify({"q": "How much does shipping cost?", "a": "Free shipping on orders of ₹2,500 and above (before GST, as calculated at checkout). Below that threshold, standard and express options and their fees are shown before you confirm payment."}) },
    { type: "qa", content: JSON.stringify({"q": "How long does delivery take?", "a": "Allow 2–3 weeks for production, then typical courier transit of a few business days within India. Tracking is shared once the parcel is handed to the courier after quality control."}) },
    { type: "qa", content: JSON.stringify({"q": "What if I miss the delivery?", "a": "Couriers usually attempt delivery more than once. Keep your phone reachable and your address accurate. If a parcel is returned to us after failed attempts, we will contact you; reshipment may incur additional shipping charges."}) },
    { type: "heading", content: "Returns & quality" },
    { type: "qa", content: JSON.stringify({"q": "Can I return a piece because I changed my mind?", "a": "No. ĀKĀRA pieces are made to order. We do not accept returns or refunds for change of mind, preference, colour opinion after delivery, interior redesign, or “I no longer want it.” Please review dimensions, finish, and photos carefully before ordering."}) },
    { type: "qa", content: JSON.stringify({"q": "When is a return or replacement considered?", "a": "Only for verified quality issues: damage in transit, a clear manufacturing defect, wrong item dispatched, or a piece that is significantly different from the product description. Cosmetic preferences and minor print-texture variation inherent to 3D printing are not defects."}) },
    { type: "qa", content: JSON.stringify({"q": "How strict is the return window?", "a": "You must notify us within 48 hours of delivery for transit damage (with photos of the item and outer packaging). Manufacturing defects must be reported within 7 days of delivery. Requests after these windows are not accepted except under the separate limited warranty where applicable."}) },
    { type: "qa", content: JSON.stringify({"q": "What do I need to request a quality return?", "a": "Order number, item name, a detailed written description, and clear photos of the issue and packaging. Incomplete requests are closed without action. Approved cases may require the piece to be returned unused, in original packing, for inspection before any replacement or refund is issued."}) },
    { type: "qa", content: JSON.stringify({"q": "How do I start a return request?", "a": "Use the Request a Return page (or email support@akaraonline.co.in). Choose only a valid quality reason. Submitting a change-of-mind request will be declined."}) },
    { type: "heading", content: "Care" },
    { type: "qa", content: JSON.stringify({"q": "How do I clean my ĀKĀRA piece?", "a": "Wipe with a soft, dry microfibre cloth. A lightly damp cloth is fine for planters and vases — do not soak, dishwasher, or use harsh solvents. This is 3D-printed PLA, not ceramic or metal."}) },
    { type: "qa", content: JSON.stringify({"q": "Can I use these outdoors?", "a": "Indoor or covered, shaded outdoor use only. Prolonged direct sun, rain, or heat can warp or fade PLA over time. Outdoor use outside these guidelines is not covered by returns or warranty."}) },
    { type: "qa", content: JSON.stringify({"q": "Are planters safe with soil and water?", "a": "Yes for normal styling and planting. Avoid prolonged full submersion. For heavy watering, a nursery liner pot is recommended. Water damage from misuse is not a manufacturing defect."}) },
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
  // Return request page (/return-request) — found during a real,
  // website-wide sweep for pages showing customer-facing content that
  // isn't actually admin-editable, following a direct report ("FAQ and
  // return-request pages aren't in sync with the admin panel"). FAQ
  // itself was already correctly CMS-connected; this page's real,
  // substantial policy text (the intro paragraph and the three-card
  // "Time limits / Evidence required / Not accepted" summary) had
  // never been, at all — editing it from the admin panel could never
  // have changed anything on the real, live page, since there was
  // structurally nowhere for that edit to go. The real, interactive
  // form itself (fields, validation, submission) is deliberately left
  // as real functional code, not CMS content — only the genuinely
  // editorial copy above the form is converted here. Content
  // transcribed exactly from the real, current hardcoded component.
  "return-request": [
    { type: "heading", content: "Quality claims only" },
    { type: "paragraph", content: "ĀKĀRA pieces are made to order. We do not accept returns because you changed your mind. This form is only for verified transit damage, manufacturing defects, or a wrong item — with evidence." },
    { type: "cardGrid", content: JSON.stringify({ cards: [
      { title: "Time limits", description: "48 hours / 7 days — Transit damage: notify within 48 hours of delivery. Defects or wrong item: within 7 days. Late claims are declined." },
      { title: "Evidence required", description: "Photos + detail — Order number, clear photos of the issue and packaging, and a full written description. Incomplete requests are closed." },
      { title: "Not accepted", description: "Change of mind — No returns for preference, colour opinion, redecorating, or \"I no longer want it.\" Matching, intact made-to-order pieces are final sale." },
    ] }) },
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

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
// Only auto-run when executed as `node server/seed-cms.js`, not when imported by update-faq-returns.js
if (isDirect) {
  main().catch(err => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
}
