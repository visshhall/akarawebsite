// ============================================================================
// CATEGORY AUDIT — flags catalogue products whose assigned category
// conflicts with signals in the product name / URL id (e.g. a "lamp"
// sitting under Planters). Used by admin API + dashboard so mismatches
// are visible without manual spot-checks.
//
// Rules are intentionally conservative: only flag when inference is
// confident. Custom admin categories that are not in the core set are
// never auto-flagged solely for being custom.
// ============================================================================

export const CORE_CATEGORIES = [
  "Planters",
  "Vases",
  "Ceiling Lighting",
  "Table Lamps",
  "Lanterns",
  "Floor Lamps",
];

/**
 * Infer the most likely category from name + id. Returns null when unsure.
 */
export function inferCategoryFromText(name = "", id = "") {
  const blob = `${name} ${id}`.toLowerCase().replace(/[_-]+/g, " ");

  // Order matters — more specific patterns first
  if (/\bfloor\s*lamp\b|\bstanding\s*lamp\b|\btorchere\b/.test(blob)) return "Floor Lamps";
  if (/\bceiling\b|\bpendant\b|\bchandelier\b|\bhanging\s*(light|lamp)\b/.test(blob)) {
    return "Ceiling Lighting";
  }
  if (/\btable\s*lamp\b|\bdesk\s*lamp\b|\bbedside\s*lamp\b|\btable\s*light\b/.test(blob)) {
    return "Table Lamps";
  }
  // Generic "lamp" / "light" after table/floor/ceiling checks
  if (/\blamps?\b|\blights?\b/.test(blob) && !/\bplanter\b|\bvase\b|\bpot\b/.test(blob)) {
    return "Table Lamps";
  }
  if (/\blanterns?\b/.test(blob)) return "Lanterns";
  if (/\bvases?\b|\bvessel\b/.test(blob)) return "Vases";
  if (/\bplanters?\b|\bjardiniere\b|\bplant\s*pot\b|\bpots?\b/.test(blob)) return "Planters";

  return null;
}

function normalizeCat(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const hit = CORE_CATEGORIES.find((c) => c.toLowerCase() === s.toLowerCase());
  return hit || s;
}

/**
 * @param {Array<{id:string,name:string,category?:string,cat?:string,status?:string}>} products
 * @returns {{ issues: Array, summary: object }}
 */
export function auditProductCategories(products = []) {
  const issues = [];
  let missingCategory = 0;
  let conflict = 0;
  let ok = 0;

  for (const p of products) {
    const id = p.id || p.product_id || "";
    const name = p.name || "";
    const status = p.status || "";
    if (status === "draft" || status === "hidden") continue;

    const assigned = normalizeCat(p.category || p.cat || "");
    const inferred = inferCategoryFromText(name, id);

    if (!assigned) {
      missingCategory += 1;
      issues.push({
        id,
        name,
        status,
        assigned: null,
        suggested: inferred,
        severity: "warning",
        reason: inferred
          ? `No category set — name suggests “${inferred}”.`
          : "No category set.",
      });
      continue;
    }

    if (inferred && assigned !== inferred) {
      // Only flag when both sides are core categories (high confidence)
      if (CORE_CATEGORIES.includes(assigned) && CORE_CATEGORIES.includes(inferred)) {
        conflict += 1;
        issues.push({
          id,
          name,
          status,
          assigned,
          suggested: inferred,
          severity: "error",
          reason: `Listed under “${assigned}” but name/id suggests “${inferred}”.`,
        });
        continue;
      }
    }

    ok += 1;
  }

  issues.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return String(a.name).localeCompare(String(b.name));
  });

  return {
    issues,
    summary: {
      scanned: ok + conflict + missingCategory,
      ok,
      conflicts: conflict,
      missingCategory,
      issueCount: issues.length,
    },
  };
}
