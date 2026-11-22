/* ==========================================================================
   Dhawi Uwaid Dedicated Supabase Client (Pure Static ES6, Zero HijamaCare refs)
   Project: https://nmsmbcfnlqvnzfprexbh.supabase.co
   ========================================================================== */

(function () {
  "use strict";

  const SUPABASE_URL = "https://nmsmbcfnlqvnzfprexbh.supabase.co";
  const SUPABASE_KEY = "sb_publishable_nM7K9SCmR-MkwEkE0o-Azg_aqwxB8G9";
  const MEMBER_AUTH_STORAGE_KEY = "dhawi-uwaid-member-auth";
  const BRANCH_ORDER = ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08"];

  let authClientInstance = null;

  function getAuthClient() {
    if (authClientInstance) return authClientInstance;
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      return null;
    }
    authClientInstance = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: MEMBER_AUTH_STORAGE_KEY,
      },
    });
    return authClientInstance;
  }

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
        kunyah: r.kunyah || "",
        isDeceased: Boolean(r.is_deceased),
        birthYear: r.birth_year || "",
        deathYear: r.death_year || "",
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
    const hasMemberSchema = Boolean(metaRow && typeof metaRow.feature_require_member_auth === "boolean");

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
        hasMemberSchema,
        featureBiosEnabled: Boolean(metaRow && metaRow.feature_bios_enabled === true),
        featureRequireMemberAuth:
          metaRow && typeof metaRow.feature_require_member_auth === "boolean"
            ? metaRow.feature_require_member_auth
            : true,
        featureRequireMemberMfa:
          metaRow && typeof metaRow.feature_require_member_mfa === "boolean"
            ? metaRow.feature_require_member_mfa
            : true,
      },
      branchStats: [...branchMap.values()],
      nodesById,
    };
  }

  async function fetchAllMembers(selectCols) {
    const pageSize = 1000;
    const allRows = [];
    let offset = 0;

    while (true) {
      const url = `${SUPABASE_URL}/rest/v1/family_members?select=${selectCols}&order=generation.asc,sort_order.asc&limit=${pageSize}&offset=${offset}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          apikey: SUPABASE_KEY,
          Range: `${offset}-${offset + pageSize - 1}`,
        },
      });
      if (!res.ok) return { ok: false, status: res.status, rows: [] };
      const chunk = await res.json();
      if (!Array.isArray(chunk)) return { ok: false, status: res.status, rows: [] };
      allRows.push(...chunk);
      if (chunk.length < pageSize) break;
      offset += pageSize;
    }

    return { ok: true, status: 200, rows: allRows };
  }

  async function fetchLiveTreePayload() {
    try {
      const metaRes = await fetch(`${SUPABASE_URL}/rest/v1/tree_meta?select=*&limit=1`, {
        method: "GET",
        headers: { apikey: SUPABASE_KEY },
      });

      let metaRow = null;
      if (metaRes.ok) {
        const mArr = await metaRes.json();
        if (Array.isArray(mArr) && mArr.length > 0) metaRow = mArr[0];
      }

      const baseCols =
        "id,name,raw_name,parent_id,branch_id,branch_name,generation,tier,tier_label,sort_order,bio_note,full_lineage,cx,cy";
      const extCols = `${baseCols},kunyah,is_deceased,birth_year,death_year`;

      let mResult =
        metaRow && metaRow.feature_bios_enabled === true
          ? await fetchAllMembers(extCols)
          : await fetchAllMembers(baseCols);

      if (!mResult.ok && metaRow && metaRow.feature_bios_enabled === true) {
        mResult = await fetchAllMembers(baseCols);
      }
      if (!mResult.ok) return null;

      return buildPayloadFromRows(mResult.rows, metaRow);
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

      const client = getAuthClient();
      if (client) {
        const { data: sess } = await client.auth.getSession();
        if (sess && sess.session) {
          const { error } = await client.from("update_requests").insert([payload]);
          if (!error) {
            return { ok: true, synced: true, status: 201 };
          }
          return {
            ok: false,
            synced: false,
            status: error.code ? Number(error.code) || 403 : 403,
            errorMessage: error.message || "",
          };
        }
      }

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

  async function fetchMyUpdateRequests() {
    try {
      const client = getAuthClient();
      if (!client) return [];
      const { data: sess } = await client.auth.getSession();
      if (!sess || !sess.session) return [];
      const { data, error } = await client
        .from("update_requests")
        .select(
          "id,request_type,branch_name,target_person,target_node_id,new_name,notes,status,review_note,created_at,reviewed_at,submitter_lineage"
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (error || !Array.isArray(data)) return [];
      return data;
    } catch (_) {
      return [];
    }
  }

  window.DHAWI_UWAID_DB = {
    url: SUPABASE_URL,
    publishableKey: SUPABASE_KEY,
    getAuthClient,
    fetchLiveTreePayload,
    submitUpdateRequest,
    fetchMyUpdateRequests,
  };
})();
