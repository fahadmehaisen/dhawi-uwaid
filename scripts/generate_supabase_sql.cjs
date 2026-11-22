const fs = require("fs");
const path = require("path");

const ROOT = "c:\\Projects\\dhawi-uwaid";
const TREE = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "tree.json"), "utf8"));
const OUT_DIR = path.join(ROOT, "supabase");
const MIGRATIONS_DIR = path.join(OUT_DIR, "migrations");
const OUT_SQL = path.join(OUT_DIR, "setup_dhawi_uwaid.sql");
const OUT_MIGRATION = path.join(MIGRATIONS_DIR, "20261122000001_init_dhawi_uwaid.sql");

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync(MIGRATIONS_DIR)) fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });

const sqlStr = (s) => `'${String(s == null ? "" : s).replace(/'/g, "''")}'`;
const sqlNum = (n) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "NULL");

// Compute stable sort_order preserving exact sibling order from tree.json
const sortOrderMap = new Map();
const nodes = Object.values(TREE.nodesById);
for (const n of nodes) {
  if (n.generation < 0) {
    sortOrderMap.set(n.id, n.generation + 10); // -10 -> 0 ... -1 -> 9
  }
  if (n.childrenIds && n.childrenIds.length > 0) {
    n.childrenIds.forEach((cid, idx) => sortOrderMap.set(cid, idx));
  }
}
sortOrderMap.set("R00", 0);

// Order topologically by ascending generation (-10 .. 0 .. 8) so FK parent_id always exists before child inserts
const orderedNodes = [...nodes].sort((a, b) => {
  if (a.generation !== b.generation) return a.generation - b.generation;
  return (sortOrderMap.get(a.id) || 0) - (sortOrderMap.get(b.id) || 0);
});

const out = [];
out.push(`-- ============================================================================`);
out.push(`-- Dhawi Uwaid Family Tree — Dedicated Supabase Setup & 760-Member Seed Script`);
out.push(`-- Target Project: https://nmsmbcfnlqvnzfprexbh.supabase.co`);
out.push(`-- Tribe: ذوي عويض — من البصصة قبيلة الشدادين بني الحارث`);
out.push(`-- Idempotent: Safe to run cleanly on a fresh database or re-run later.`);
out.push(`-- ============================================================================`);
out.push(``);
out.push(`-- 1. Tables & Schema`);
out.push(`CREATE TABLE IF NOT EXISTS public.tree_meta (`);
out.push(`  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),`);
out.push(`  title text NOT NULL,`);
out.push(`  tribe_subtitle text NOT NULL,`);
out.push(`  edition_label text NOT NULL,`);
out.push(`  total_nodes integer NOT NULL,`);
out.push(`  descendant_count integer NOT NULL,`);
out.push(`  ancestor_count integer NOT NULL,`);
out.push(`  updated_at timestamptz NOT NULL DEFAULT now()`);
out.push(`);`);
out.push(``);
out.push(`CREATE TABLE IF NOT EXISTS public.family_members (`);
out.push(`  id text PRIMARY KEY,`);
out.push(`  name text NOT NULL,`);
out.push(`  raw_name text NOT NULL,`);
out.push(`  parent_id text REFERENCES public.family_members(id) ON DELETE SET NULL,`);
out.push(`  branch_id text NOT NULL,`);
out.push(`  branch_name text NOT NULL,`);
out.push(`  generation integer NOT NULL,`);
out.push(`  tier text NOT NULL,`);
out.push(`  tier_label text NOT NULL,`);
out.push(`  sort_order integer NOT NULL DEFAULT 0,`);
out.push(`  bio_note text NOT NULL DEFAULT '',`);
out.push(`  full_lineage text NOT NULL DEFAULT '',`);
out.push(`  cx double precision,`);
out.push(`  cy double precision,`);
out.push(`  created_at timestamptz NOT NULL DEFAULT now(),`);
out.push(`  updated_at timestamptz NOT NULL DEFAULT now()`);
out.push(`);`);
out.push(``);
out.push(`CREATE INDEX IF NOT EXISTS idx_family_members_parent_id ON public.family_members(parent_id);`);
out.push(`CREATE INDEX IF NOT EXISTS idx_family_members_branch_id ON public.family_members(branch_id);`);
out.push(`CREATE INDEX IF NOT EXISTS idx_family_members_generation ON public.family_members(generation);`);
out.push(``);
out.push(`CREATE TABLE IF NOT EXISTS public.update_requests (`);
out.push(`  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),`);
out.push(`  request_type text NOT NULL,`);
out.push(`  branch_name text NOT NULL,`);
out.push(`  target_person text NOT NULL,`);
out.push(`  target_node_id text REFERENCES public.family_members(id) ON DELETE SET NULL,`);
out.push(`  new_name text NOT NULL,`);
out.push(`  submitter_name text NOT NULL DEFAULT '',`);
out.push(`  notes text NOT NULL DEFAULT '',`);
out.push(`  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),`);
out.push(`  created_at timestamptz NOT NULL DEFAULT now(),`);
out.push(`  reviewed_at timestamptz`);
out.push(`);`);
out.push(``);
out.push(`CREATE INDEX IF NOT EXISTS idx_update_requests_status_created ON public.update_requests(status, created_at DESC);`);
out.push(``);
out.push(`-- 2. Strict Row-Level Security (RLS) & API Grants`);
out.push(`ALTER TABLE public.tree_meta ENABLE ROW LEVEL SECURITY;`);
out.push(`ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;`);
out.push(`ALTER TABLE public.update_requests ENABLE ROW LEVEL SECURITY;`);
out.push(``);
out.push(`DROP POLICY IF EXISTS tree_meta_public_read ON public.tree_meta;`);
out.push(`CREATE POLICY tree_meta_public_read ON public.tree_meta`);
out.push(`  FOR SELECT TO anon, authenticated USING (true);`);
out.push(``);
out.push(`DROP POLICY IF EXISTS family_members_public_read ON public.family_members;`);
out.push(`CREATE POLICY family_members_public_read ON public.family_members`);
out.push(`  FOR SELECT TO anon, authenticated USING (true);`);
out.push(``);
out.push(`DROP POLICY IF EXISTS update_requests_public_insert ON public.update_requests;`);
out.push(`CREATE POLICY update_requests_public_insert ON public.update_requests`);
out.push(`  FOR INSERT TO anon, authenticated`);
out.push(`  WITH CHECK (`);
out.push(`    status = 'pending'`);
out.push(`    AND char_length(trim(request_type)) >= 2`);
out.push(`    AND char_length(trim(branch_name)) >= 1`);
out.push(`    AND char_length(trim(target_person)) >= 2`);
out.push(`    AND char_length(trim(new_name)) >= 1`);
out.push(`    AND char_length(request_type) <= 80`);
out.push(`    AND char_length(branch_name) <= 80`);
out.push(`    AND char_length(target_person) <= 200`);
out.push(`    AND char_length(new_name) <= 200`);
out.push(`    AND char_length(submitter_name) <= 150`);
out.push(`    AND char_length(notes) <= 1000`);
out.push(`  );`);
out.push(``);
out.push(`GRANT USAGE ON SCHEMA public TO anon, authenticated;`);
out.push(`GRANT SELECT ON public.tree_meta, public.family_members TO anon, authenticated;`);
out.push(`GRANT INSERT ON public.update_requests TO anon, authenticated;`);
out.push(``);
out.push(`-- 3. Upsert Tree Metadata`);
out.push(`INSERT INTO public.tree_meta (id, title, tribe_subtitle, edition_label, total_nodes, descendant_count, ancestor_count)`);
out.push(`VALUES (1, 'شجرة ذوي عويض', 'من البصصة قبيلة الشدادين بني الحارث', ${sqlStr(TREE.meta.editionLabel)}, ${TREE.meta.totalNodes}, ${TREE.meta.descendantsOfUwaid}, ${TREE.meta.ancestorsCount})`);
out.push(`ON CONFLICT (id) DO UPDATE SET`);
out.push(`  title = EXCLUDED.title,`);
out.push(`  tribe_subtitle = EXCLUDED.tribe_subtitle,`);
out.push(`  edition_label = EXCLUDED.edition_label,`);
out.push(`  total_nodes = EXCLUDED.total_nodes,`);
out.push(`  descendant_count = EXCLUDED.descendant_count,`);
out.push(`  ancestor_count = EXCLUDED.ancestor_count,`);
out.push(`  updated_at = now();`);
out.push(``);
out.push(`-- 4. Upsert All 760 Family Members in Topological Generation Order (-10 .. 8)`);

const BATCH_SIZE = 100;
for (let i = 0; i < orderedNodes.length; i += BATCH_SIZE) {
  const chunk = orderedNodes.slice(i, i + BATCH_SIZE);
  out.push(`INSERT INTO public.family_members (id, name, raw_name, parent_id, branch_id, branch_name, generation, tier, tier_label, sort_order, bio_note, full_lineage, cx, cy)`);
  out.push(`VALUES`);
  const rowsSql = chunk.map((n) => {
    const sortOrd = sortOrderMap.has(n.id) ? sortOrderMap.get(n.id) : 0;
    return `  (${sqlStr(n.id)}, ${sqlStr(n.name)}, ${sqlStr(n.rawName || n.name)}, ${n.parentId ? sqlStr(n.parentId) : "NULL"}, ${sqlStr(n.branchId)}, ${sqlStr(n.branchName)}, ${n.generation}, ${sqlStr(n.tier)}, ${sqlStr(n.tierLabel || "")}, ${sortOrd}, ${sqlStr(n.bioNote || "")}, ${sqlStr(n.fullLineage || n.name)}, ${sqlNum(n.cx)}, ${sqlNum(n.cy)})`;
  });
  out.push(rowsSql.join(",\n"));
  out.push(`ON CONFLICT (id) DO UPDATE SET`);
  out.push(`  name = EXCLUDED.name,`);
  out.push(`  raw_name = EXCLUDED.raw_name,`);
  out.push(`  parent_id = EXCLUDED.parent_id,`);
  out.push(`  branch_id = EXCLUDED.branch_id,`);
  out.push(`  branch_name = EXCLUDED.branch_name,`);
  out.push(`  generation = EXCLUDED.generation,`);
  out.push(`  tier = EXCLUDED.tier,`);
  out.push(`  tier_label = EXCLUDED.tier_label,`);
  out.push(`  sort_order = EXCLUDED.sort_order,`);
  out.push(`  bio_note = EXCLUDED.bio_note,`);
  out.push(`  full_lineage = EXCLUDED.full_lineage,`);
  out.push(`  cx = EXCLUDED.cx,`);
  out.push(`  cy = EXCLUDED.cy,`);
  out.push(`  updated_at = now();`);
  out.push(``);
}

out.push(`-- 5. Refresh PostgREST Schema Cache`);
out.push(`NOTIFY pgrst, 'reload schema';`);
out.push(``);

const sqlContent = out.join("\n");
fs.writeFileSync(OUT_SQL, sqlContent, "utf8");
fs.writeFileSync(OUT_MIGRATION, sqlContent, "utf8");
console.log(
  "Generated SQL:",
  OUT_SQL,
  "and migration:",
  OUT_MIGRATION,
  "rows=",
  orderedNodes.length,
  "size=",
  fs.statSync(OUT_SQL).size
);
