/* ==========================================================================
   Admin Sync Script: Upserts all 760 Dhawi Uwaid tree nodes & metadata into
   the dedicated Supabase project using SUPABASE_URL & SUPABASE_SECRET_KEY
   read strictly from local gitignored .env (NEVER hardcoded).
   ========================================================================== */

const fs = require("fs");
const path = require("path");

const ROOT = "c:\\Projects\\dhawi-uwaid";
const ENV_PATH = path.join(ROOT, ".env");
const TREE_PATH = path.join(ROOT, "data", "tree.json");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error("Missing local .env file at " + filePath);
  }
  const env = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

async function upsertBatch(baseUrl, secretKey, table, onConflict, rows) {
  const res = await fetch(`${baseUrl}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: {
      apikey: secretKey,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upsert ${table} failed (${res.status}): ${body}`);
  }
}

async function main() {
  const env = loadEnv(ENV_PATH);
  const baseUrl = (env.SUPABASE_URL || "").replace(/\/+$/, "");
  const secretKey = env.SUPABASE_SECRET_KEY || "";
  if (!baseUrl || !secretKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SECRET_KEY missing in .env");
  }

  const tree = JSON.parse(fs.readFileSync(TREE_PATH, "utf8"));
  const nodes = Object.values(tree.nodesById);

  const sortOrderMap = new Map();
  for (const n of nodes) {
    if (n.generation < 0) {
      sortOrderMap.set(n.id, n.generation + 10);
    }
    if (n.childrenIds && n.childrenIds.length > 0) {
      n.childrenIds.forEach((cid, idx) => sortOrderMap.set(cid, idx));
    }
  }
  sortOrderMap.set("R00", 0);

  const orderedNodes = [...nodes].sort((a, b) => {
    if (a.generation !== b.generation) return a.generation - b.generation;
    return (sortOrderMap.get(a.id) || 0) - (sortOrderMap.get(b.id) || 0);
  });

  const nowIso = new Date().toISOString();

  await upsertBatch(baseUrl, secretKey, "tree_meta", "id", [
    {
      id: 1,
      title: "شجرة ذوي عويض",
      tribe_subtitle: "من البصصة قبيلة الشدادين بني الحارث",
      edition_label: tree.meta.editionLabel,
      total_nodes: tree.meta.totalNodes,
      descendant_count: tree.meta.descendantsOfUwaid,
      ancestor_count: tree.meta.ancestorsCount,
      updated_at: nowIso,
    },
  ]);

  const BATCH_SIZE = 100;
  let synced = 0;
  for (let i = 0; i < orderedNodes.length; i += BATCH_SIZE) {
    const chunk = orderedNodes.slice(i, i + BATCH_SIZE).map((n) => ({
      id: n.id,
      name: n.name,
      raw_name: n.rawName || n.name,
      parent_id: n.parentId || null,
      branch_id: n.branchId,
      branch_name: n.branchName,
      generation: n.generation,
      tier: n.tier,
      tier_label: n.tierLabel || "",
      sort_order: sortOrderMap.has(n.id) ? sortOrderMap.get(n.id) : 0,
      bio_note: n.bioNote || "",
      full_lineage: n.fullLineage || n.name,
      cx: typeof n.cx === "number" && Number.isFinite(n.cx) ? n.cx : null,
      cy: typeof n.cy === "number" && Number.isFinite(n.cy) ? n.cy : null,
      updated_at: nowIso,
    }));
    await upsertBatch(baseUrl, secretKey, "family_members", "id", chunk);
    synced += chunk.length;
  }

  console.log(`synced_meta=true synced_members=${synced}`);
}

main().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
