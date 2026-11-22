/* ==========================================================================
   Reverse-Sync Script: Pulls the live approved family tree from the dedicated
   Dhawi Uwaid Supabase project, updates data/tree.json & data/tree-data.js,
   and rebuilds the wall mural, 7-page A4 booklet, and seed SQL.
   Usage:
     node scripts/pull_supabase_and_rebuild_mural.cjs --dry-run
     node scripts/pull_supabase_and_rebuild_mural.cjs
   ========================================================================== */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = "c:\\Projects\\dhawi-uwaid";
const ENV_PATH = path.join(ROOT, ".env");
const TREE_JSON_PATH = path.join(ROOT, "data", "tree.json");
const TREE_JS_PATH = path.join(ROOT, "data", "tree-data.js");
const BRANCH_ORDER = ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08"];

function loadConfig() {
  const cfg = {
    SUPABASE_URL: "https://nmsmbcfnlqvnzfprexbh.supabase.co",
    SUPABASE_KEY: "sb_publishable_nM7K9SCmR-MkwEkE0o-Azg_aqwxB8G9",
  };
  if (fs.existsSync(ENV_PATH)) {
    for (const line of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim();
      if (k === "SUPABASE_URL" && v) cfg.SUPABASE_URL = v.replace(/\/+$/, "");
      if (k === "SUPABASE_SECRET_KEY" && v) cfg.SUPABASE_KEY = v;
      else if (k === "SUPABASE_PUBLISHABLE_KEY" && v && cfg.SUPABASE_KEY.startsWith("sb_publishable")) {
        cfg.SUPABASE_KEY = v;
      }
    }
  }
  return cfg;
}

async function fetchAllMembers(cfg) {
  const pageSize = 1000;
  const rows = [];
  let offset = 0;
  while (true) {
    const res = await fetch(
      `${cfg.SUPABASE_URL}/rest/v1/family_members?select=*&order=generation.asc,sort_order.asc&limit=${pageSize}&offset=${offset}`,
      { headers: { apikey: cfg.SUPABASE_KEY, Range: `${offset}-${offset + pageSize - 1}` } }
    );
    if (!res.ok) throw new Error(`Fetch family_members failed (${res.status}): ${await res.text()}`);
    const chunk = await res.json();
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const cfg = loadConfig();
  const [rows, metaRes] = await Promise.all([
    fetchAllMembers(cfg),
    fetch(`${cfg.SUPABASE_URL}/rest/v1/tree_meta?select=*&limit=1`, { headers: { apikey: cfg.SUPABASE_KEY } }),
  ]);
  const metaRows = metaRes.ok ? await metaRes.json() : [];
  const metaRow = Array.isArray(metaRows) && metaRows[0] ? metaRows[0] : null;

  console.log(
    JSON.stringify({
      dryRun,
      fetched: rows.length,
      metaTitle: metaRow ? metaRow.title : null,
    })
  );

  if (dryRun) return;
  if (rows.length < 700) throw new Error("Refusing rebuild with fewer than 700 rows");

  const existingTree = JSON.parse(fs.readFileSync(TREE_JSON_PATH, "utf8"));
  const sorted = [...rows].sort((a, b) => {
    if (a.generation !== b.generation) return a.generation - b.generation;
    return (a.sort_order || 0) - (b.sort_order || 0);
  });

  const nodesById = {};
  for (const r of sorted) {
    const prev = existingTree.nodesById[r.id] || {};
    nodesById[r.id] = {
      id: r.id,
      name: r.name,
      rawName: r.raw_name || r.name,
      tier: r.tier,
      tierLabel: r.tier_label || "",
      parentId: r.parent_id || null,
      cx: typeof r.cx === "number" ? r.cx : prev.cx ?? null,
      cy: typeof r.cy === "number" ? r.cy : prev.cy ?? null,
      ...(prev.bbox ? { bbox: prev.bbox } : {}),
      bioNote: r.bio_note || "",
      kunyah: r.kunyah || "",
      isDeceased: Boolean(r.is_deceased),
      descendantCount: 0,
      generation: r.generation,
      childrenIds: [],
      childrenCount: 0,
      branchId: r.branch_id,
      branchName: r.branch_name,
      fullLineage: r.full_lineage || r.name,
    };
  }

  for (const r of sorted) {
    if (r.parent_id && nodesById[r.parent_id]) {
      nodesById[r.parent_id].childrenIds.push(r.id);
    }
  }

  const memo = new Map();
  function countDesc(id) {
    if (memo.has(id)) return memo.get(id);
    const n = nodesById[id];
    let total = n.childrenIds.length;
    for (const cid of n.childrenIds) total += countDesc(cid);
    n.childrenCount = n.childrenIds.length;
    n.descendantCount = total;
    memo.set(id, total);
    return total;
  }
  for (const id of Object.keys(nodesById)) countDesc(id);

  const branchStats = [];
  for (const bid of BRANCH_ORDER) {
    const b = nodesById[bid];
    if (!b) continue;
    branchStats.push({
      branchId: bid,
      name: b.name,
      directSonsCount: b.childrenIds.length,
      totalDescendants: b.descendantCount,
      totalInBranch: b.descendantCount + 1,
      maxGeneration: Math.max(...sorted.filter((x) => x.branch_id === bid).map((x) => x.generation)),
    });
  }

  const nextTree = {
    meta: {
      ...existingTree.meta,
      totalNodes: sorted.length,
      ancestorsCount: sorted.filter((r) => r.generation < 0).length,
      descendantsOfUwaid: sorted.filter((r) => r.generation >= 1).length,
      branchesCount: branchStats.length,
    },
    branchStats,
    nodesById,
  };

  fs.writeFileSync(TREE_JSON_PATH, JSON.stringify(nextTree, null, 2) + "\n", "utf8");
  fs.writeFileSync(TREE_JS_PATH, "window.DHAWI_UWAID_TREE = " + JSON.stringify(nextTree) + ";\n", "utf8");

  execSync("node scripts/generate_wall_mural.cjs", { cwd: ROOT, stdio: "inherit" });
  execSync("node scripts/generate_a4_booklet.cjs", { cwd: ROOT, stdio: "inherit" });
  execSync("node scripts/generate_supabase_sql.cjs", { cwd: ROOT, stdio: "inherit" });
  console.log("Rebuilt tree.json, tree-data.js, wall mural, A4 booklet, and SQL seeds successfully.");
}

main().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
