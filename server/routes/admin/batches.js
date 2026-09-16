import { Router } from "express";
import { query } from "../../db.js";
import { asyncHandler } from "../../asyncHandler.js";
import { requireAdmin } from "../../adminAuth.js";
import { sanitize } from "../../validate.js";

const router = Router();

function currentYearMonth(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

/** Next AK-YYYYMM-NNN for a calendar month (IST-friendly: uses server local or forced ym). */
async function nextBatchNumber(yearMonth) {
  const ym = String(yearMonth || currentYearMonth()).slice(0, 6);
  const prefix = `AK-${ym}-`;
  const { rows } = await query(
    `SELECT batch_number FROM production_batches
     WHERE year_month = $1
     ORDER BY batch_number DESC
     LIMIT 1`,
    [ym]
  );
  let seq = 1;
  if (rows[0]?.batch_number) {
    const part = String(rows[0].batch_number).split("-").pop();
    const n = parseInt(part, 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

// GET /api/admin/batches?month=202609&status=open
router.get("/", requireAdmin, asyncHandler(async (req, res) => {
  const month = typeof req.query.month === "string" && /^\d{6}$/.test(req.query.month)
    ? req.query.month
    : null;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const params = [];
  const where = [];
  if (month) {
    params.push(month);
    where.push(`b.year_month = $${params.length}`);
  }
  if (status && ["open", "in_production", "qc", "closed"].includes(status)) {
    params.push(status);
    where.push(`b.status = $${params.length}`);
  }
  const sql = `
    SELECT b.*, p.name AS product_name
    FROM production_batches b
    LEFT JOIN products p ON p.id = b.product_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY b.created_at DESC
    LIMIT 200`;
  const { rows } = await query(sql, params);
  const enriched = [];
  for (const r of rows) {
    const { rows: act } = await query(
      `SELECT COUNT(*)::int AS n FROM orders o
       WHERE o.status != 'cancelled'
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(o.items)='array' THEN o.items ELSE '[]'::jsonb END
           ) e WHERE e->>'batchNumber' = $1
         )`,
      [r.batch_number]
    );
    const { rows: allO } = await query(
      `SELECT COUNT(*)::int AS n FROM orders o
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(o.items)='array' THEN o.items ELSE '[]'::jsonb END
         ) e WHERE e->>'batchNumber' = $1
       )`,
      [r.batch_number]
    );
    enriched.push({
      id: r.id,
      batchNumber: r.batch_number,
      yearMonth: r.year_month,
      productId: r.product_id,
      productName: r.product_name,
      notes: r.notes,
      status: r.status,
      createdAt: r.created_at,
      closedAt: r.closed_at,
      activeOrderCount: act[0]?.n || 0,
      linkedOrderCount: allO[0]?.n || 0,
    });
  }
  res.json({
    batches: enriched,
    suggestedNext: await nextBatchNumber(month || currentYearMonth()),
  });
}));

// POST /api/admin/batches — create run; auto AK-YYYYMM-NNN
router.post("/", requireAdmin, asyncHandler(async (req, res) => {
  const notes = sanitize(req.body?.notes || "").slice(0, 500) || null;
  const productId = typeof req.body?.productId === "string" ? sanitize(req.body.productId).slice(0, 80) : null;
  const ym = typeof req.body?.yearMonth === "string" && /^\d{6}$/.test(req.body.yearMonth)
    ? req.body.yearMonth
    : currentYearMonth();

  if (productId) {
    const { rows: pr } = await query("SELECT id FROM products WHERE id=$1", [productId]);
    if (!pr.length) return res.status(400).json({ error: "Product not found." });
  }

  let batchNumber = await nextBatchNumber(ym);
  // rare race: retry once
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { rows } = await query(
        `INSERT INTO production_batches (batch_number, year_month, product_id, notes, status)
         VALUES ($1,$2,$3,$4,'open')
         RETURNING *`,
        [batchNumber, ym, productId, notes]
      );
      const r = rows[0];
      return res.status(201).json({
        batch: {
          id: r.id,
          batchNumber: r.batch_number,
          yearMonth: r.year_month,
          productId: r.product_id,
          notes: r.notes,
          status: r.status,
          createdAt: r.created_at,
        },
      });
    } catch (e) {
      if (e?.code === "23505") {
        batchNumber = await nextBatchNumber(ym);
        continue;
      }
      throw e;
    }
  }
  res.status(500).json({ error: "Could not allocate batch number." });
}));

// PATCH /api/admin/batches/:id — status / notes
router.patch("/:id", requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id." });
  const { rows: existing } = await query("SELECT * FROM production_batches WHERE id=$1", [id]);
  if (!existing.length) return res.status(404).json({ error: "Batch not found." });

  let status = existing[0].status;
  if (req.body?.status && ["open", "in_production", "qc", "closed"].includes(req.body.status)) {
    status = req.body.status;
  }
  const notes = req.body?.notes !== undefined
    ? (sanitize(req.body.notes || "").slice(0, 500) || null)
    : existing[0].notes;
  const closedAt = status === "closed" ? new Date() : existing[0].closed_at;

  const { rows } = await query(
    `UPDATE production_batches SET status=$1, notes=$2, closed_at=$3 WHERE id=$4 RETURNING *`,
    [status, notes, closedAt, id]
  );
  const r = rows[0];
  res.json({
    batch: {
      id: r.id,
      batchNumber: r.batch_number,
      yearMonth: r.year_month,
      productId: r.product_id,
      notes: r.notes,
      status: r.status,
      createdAt: r.created_at,
      closedAt: r.closed_at,
    },
  });
}));

// POST /api/admin/orders/:orderNumber/assign-batch
// body: { batchNumber, lineIndexes?: number[] } — if no indexes, all lines get the batch
router.post("/assign-to-order/:orderNumber", requireAdmin, asyncHandler(async (req, res) => {
  const orderNumber = sanitize(req.params.orderNumber).slice(0, 40);
  const batchNumber = sanitize(req.body?.batchNumber || "").toUpperCase().slice(0, 32);
  if (!/^AK-\d{6}-\d{3}$/.test(batchNumber)) {
    return res.status(400).json({ error: "Batch number must look like AK-202609-001." });
  }
  const { rows: br } = await query("SELECT id FROM production_batches WHERE batch_number=$1", [batchNumber]);
  if (!br.length) return res.status(404).json({ error: "Create the batch first, then assign it." });

  const { rows: orows } = await query("SELECT * FROM orders WHERE order_number=$1", [orderNumber]);
  if (!orows.length) return res.status(404).json({ error: "Order not found." });

  let items = orows[0].items;
  if (typeof items === "string") {
    try { items = JSON.parse(items); } catch { items = []; }
  }
  if (!Array.isArray(items)) items = [];

  const indexes = Array.isArray(req.body?.lineIndexes)
    ? req.body.lineIndexes.map(Number).filter((n) => Number.isInteger(n) && n >= 0)
    : null;

  const next = items.map((line, i) => {
    if (indexes && !indexes.includes(i)) return line;
    return { ...line, batchNumber };
  });

  await query(
    `UPDATE orders SET items=$1::jsonb, updated_at=now() WHERE order_number=$2`,
    [JSON.stringify(next), orderNumber]
  );

  res.json({ ok: true, orderNumber, items: next, batchNumber });
}));

export default router;
