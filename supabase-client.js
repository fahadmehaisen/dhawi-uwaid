/* ==========================================================================
   Dhawi Uwaid Dedicated Supabase Client (Pure Static ES6, Zero HijamaCare refs)
   Project: https://nmsmbcfnlqvnzfprexbh.supabase.co
   ========================================================================== */

(function () {
  "use strict";

  const SUPABASE_URL = "https://nmsmbcfnlqvnzfprexbh.supabase.co";
  const SUPABASE_KEY = "sb_publishable_nM7K9SCmR-MkwEkE0o-Azg_aqwxB8G9";

  const BRANCH_ORDER = ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08"];

  function buildPayloadFromRows(rows, metaRow) {
    if (!Array.isArray(rows) || rows.length < 700) return null;

    const baselineMeta = (window.DHAWI_UWAID_TREE && window.DHAWI_UWAID_TREE.meta) || {};
    const sortedRows = [...rows].sort((a, b) => {
      if (a.generation !== b.generation) return a.generation - b.generation;
      return (a.sort_order || 0) - (b.sort_order || 0);
    });

    const nodesById = {};
    for (const r of sortedRows) {
      nodesById[r.id] = {
        id: r.id,
        name: r.name,
        rawName: r.raw_name || r.name,
        tier: r.tier,
        tierLabel: r.tier_label || "",
        parentId: r.parent_id || null,
        cx: r.cx,
        cy: r.cy,
        bioNote: r.bio_note || "",
        descendantCount: 0,
        generation: r.generation,
        childrenIds: [],
        childrenCount: 0,
        branchId: r.branch_id,
        branchName: r.branch_name,
        fullLineage: r.full_lineage || r.name,
      };
    }

    for (const r of sortedRows) {
      if (r.parent_id && nodesById[r.parent_id]) {
        nodesById[r.parent_id].childrenIds.push(r.id);
      }
    }

    const memoDesc = new Map();
    function countDesc(id) {
      if (memoDesc.has(id)) return memoDesc.get(id);
      const n = nodesById[id];
      if (!n) return 0;
      let total = n.childrenIds.length;
      for (const cid of n.childrenIds) {
        total += countDesc(cid);
      }
      n.childrenCount = n.childrenIds.length;
      n.descendantCount = total;
      memoDesc.set(id, total);
      return total;
    }
    for (const id of Object.keys(nodesById)) countDesc(id);

    const branchMap = new Map();
    for (const bid of BRANCH_ORDER) {
      const bNode = nodesById[bid];
      if (!bNode) continue;
      branchMap.set(bid, {
        branchId: bid,
        name: bNode.name,
        directSonsCount: bNode.childrenIds.length,
        totalDescendants: bNode.descendantCount,
        totalInBranch: bNode.descendantCount + 1,
        maxGeneration: bNode.generation,
      });
    }

    for (const n of Object.values(nodesById)) {
      const st = branchMap.get(n.branchId);
      if (st && n.generation > st.maxGeneration) {
        st.maxGeneration = n.generation;
      }
    }

    const descendantsOfUwaid = sortedRows.filter((r) => r.generation >= 1).length;
    const ancestorsCount = sortedRows.filter((r) => r.generation < 0).length;

    return {
      meta: {
        title: metaRow
          ? `${metaRow.title} — ${metaRow.tribe_subtitle}`
          : baselineMeta.title || "شجرة ذوي عويض — من البصصة قبيلة الشدادين بني الحارث",
        sourceEditionDate: baselineMeta.sourceEditionDate || "2025-11-03",
        editionLabel: (metaRow && metaRow.edition_label) || baselineMeta.editionLabel || "",
        totalNodes: (metaRow && metaRow.total_nodes) || sortedRows.length,
        ancestorsCount: (metaRow && metaRow.ancestor_count) || ancestorsCount,
        descendantsOfUwaid: (metaRow && metaRow.descendant_count) || descendantsOfUwaid,
        branchesCount: branchMap.size || 8,
        lineageFootnotes: baselineMeta.lineageFootnotes || [],
      },
      branchStats: [...branchMap.values()],
      nodesById,
    };
  }

  async function fetchLiveTreePayload() {
    try {
      const membersUrl = `${SUPABASE_URL}/rest/v1/family_members?select=id,name,raw_name,parent_id,branch_id,branch_name,generation,tier,tier_label,sort_order,bio_note,full_lineage,cx,cy&order=generation.asc,sort_order.asc&limit=2000`;
      const metaUrl = `${SUPABASE_URL}/rest/v1/tree_meta?select=*&limit=1`;

      const [mRes, metaRes] = await Promise.all([
        fetch(membersUrl, {
          method: "GET",
          headers: {
            apikey: SUPABASE_KEY,
            Range: "0-1999",
          },
        }),
        fetch(metaUrl, {
          method: "GET",
          headers: {
            apikey: SUPABASE_KEY,
          },
        }),
      ]);

      if (!mRes.ok) return null;
      const rows = await mRes.json();
      let metaRow = null;
      if (metaRes.ok) {
        const mArr = await metaRes.json();
        if (Array.isArray(mArr) && mArr.length > 0) metaRow = mArr[0];
      }
      return buildPayloadFromRows(rows, metaRow);
    } catch (_) {
      return null;
    }
  }

  async function submitUpdateRequest(entry) {
    try {
      const payload = {
        request_type: String(entry.type || "").trim(),
        branch_name: String(entry.branch || "").trim(),
        target_person: String(entry.target || "").trim(),
        target_node_id: entry.targetNodeId ? String(entry.targetNodeId).trim() : null,
        new_name: String(entry.newName || "").trim(),
        submitter_name: String(entry.submitter || "").trim(),
        notes: String(entry.notes || "").trim(),
        status: "pending",
      };

      const res = await fetch(`${SUPABASE_URL}/rest/v1/update_requests`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        return { ok: true, synced: true, status: res.status };
      }
      return { ok: false, synced: false, status: res.status };
    } catch (_) {
      return { ok: false, synced: false, status: 0 };
    }
  }

  window.DHAWI_UWAID_DB = {
    url: SUPABASE_URL,
    fetchLiveTreePayload,
    submitUpdateRequest,
  };
})();
