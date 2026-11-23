/* ==========================================================================
   Dhawi Uwaid Interactive Family Tree Platform (Pure Static ES6)
   Data source: window.DHAWI_UWAID_TREE (data/tree-data.js)
   ========================================================================== */

(function () {
  "use strict";

  let DATA = window.DHAWI_UWAID_TREE;
  if (!DATA || !DATA.nodesById) {
    console.error("DHAWI_UWAID_TREE data payload not loaded.");
    return;
  }

  // -------------------- Constants & Palette --------------------

  const BRANCH_COLORS = {
    B01: "#1F6E58",
    B02: "#8B5E34",
    B03: "#5E6B42",
    B04: "#3A6073",
    B05: "#B37D2E",
    B06: "#8F3D3D",
    B07: "#4E4A80",
    B08: "#12372A",
    ANC: "#9A7426",
    ROOT: "#C59B43",
  };

  const STORAGE_THEME_KEY = "dhawi_uwaid_theme_v1";
  const STORAGE_REQ_KEY = "dhawi_uwaid_requests_v1";

  const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

  function toArabicDigits(val) {
    return String(val).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);
  }

  function normalizeArabic(text) {
    if (!text) return "";
    return String(text)
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "className") node.className = v;
        else if (k === "textContent") node.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v !== undefined && v !== null) {
          node.setAttribute(k, v);
        }
      }
    }
    if (children !== undefined) {
      const list = Array.isArray(children) ? children : [children];
      for (const item of list) {
        if (item === null || item === undefined) continue;
        node.appendChild(typeof item === "string" ? document.createTextNode(item) : item);
      }
    }
    return node;
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v !== undefined && v !== null) node.setAttribute(k, String(v));
      }
    }
    return node;
  }

  function getBranchColor(branchId) {
    return BRANCH_COLORS[branchId] || "#12372A";
  }

  function getAncestorChain(nodeId, includeBeforeUwaid) {
    const chain = [];
    let cur = DATA.nodesById[nodeId];
    while (cur) {
      if (!includeBeforeUwaid && cur.generation < 0) break;
      chain.push(cur);
      cur = cur.parentId ? DATA.nodesById[cur.parentId] : null;
    }
    return chain; // [self, father, grandfather, ..., root]
  }

  function formatLineageSentence(nodeId, includeBeforeUwaid) {
    const chain = getAncestorChain(nodeId, includeBeforeUwaid);
    return chain.map((n) => n.name).join(" بن ");
  }

  function formatShortDescriptor(node) {
    const father = node.parentId ? DATA.nodesById[node.parentId] : null;
    const base = father ? `${node.name} بن ${father.name}` : node.name;
    if (node.branchId === "ROOT") return "جد الفخذ — عويض بن مصلح";
    if (node.branchId === "ANC") return `${base} — عمود النسب`;
    return `${base} — فرع ${node.branchName}`;
  }

  // -------------------- Search Index --------------------

  let ALL_NODES = [];
  let SEARCH_INDEX = [];

  function rebuildSearchIndex() {
    ALL_NODES = Object.values(DATA.nodesById);
    SEARCH_INDEX = ALL_NODES.map((node) => {
      const father = node.parentId ? DATA.nodesById[node.parentId] : null;
      const uwaidLineage = formatLineageSentence(node.id, false);
      const fullLineage = formatLineageSentence(node.id, true);
      return {
        node,
        fatherName: father ? father.name : "",
        normName: normalizeArabic(node.name),
        normUwaid: normalizeArabic(uwaidLineage),
        normFull: normalizeArabic(fullLineage),
        shortLineage: uwaidLineage || fullLineage,
      };
    });
  }

  rebuildSearchIndex();

  function searchNodes(query, limit) {
    const q = normalizeArabic(query);
    if (!q) return [];
    const tokens = q.split(" ").filter(Boolean);
    const scored = [];
    for (const item of SEARCH_INDEX) {
      let ok = true;
      for (const tok of tokens) {
        if (!item.normFull.includes(tok)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      let score = 0;
      if (item.normName === q) score += 120;
      else if (item.normName.startsWith(tokens[0])) score += 70;
      else if (item.normName.includes(tokens[0])) score += 35;

      if (item.node.tier === "R" || item.node.tier === "B") score += 12;
      if (item.node.descendantCount > 0) score += Math.min(20, item.node.descendantCount * 0.25);
      // Prefer Uwaid descendants slightly above ancient ancestors unless matched directly
      if (item.node.generation >= 0) score += 8;

      scored.push({ item, score });
    }
    scored.sort((a, b) => b.score - a.score || a.item.node.generation - b.item.node.generation);
    return scored.slice(0, limit || 20).map((s) => s.item);
  }

  // -------------------- Toast Notification --------------------

  let toastTimer = null;
  function showToast(msg) {
    const box = document.getElementById("toast-box");
    box.textContent = msg;
    box.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.classList.add("hidden");
    }, 3200);
  }

  // -------------------- State Management --------------------

  const state = {
    activeView: "tree",
    theme: localStorage.getItem(STORAGE_THEME_KEY) || "light",
    showAncestors: false,
    expandedIds: new Set(["R00"]),
    activeBranchFilter: "ALL",
    highlightedIds: new Set(),
    highlightLabel: "",
    treeTransform: { x: 0, y: 0, k: 1 },
    layoutPositions: new Map(),
    drawerNodeId: null,
    drawerFullLineage: false,
    prefillTargetNodeId: null,
    prefillTargetLabel: "",
    authSignupMemberId: null,
    authLinkMemberId: null,
    memberEnrollFactorId: null,
    memberVerifyFactorId: null,
    memberProfile: null,
    account: null,
    authNext: null,
    authReturnToUpdateModal: false,
    authReturnTargetNodeId: null,
    sunburstRootId: "R00",
    sunburstInspectorId: "R00",
    directoryPageSize: 48,
    kinshipA: "M109",
    kinshipB: "M165",
  };

  // -------------------- Theme & Topbar Setup --------------------

  function isBiosEnabled() {
    return Boolean(DATA.meta && DATA.meta.featureBiosEnabled === true);
  }

  function syncBioFeatureUi() {
    const biosOn = isBiosEnabled();
    const dirRoleSel = document.getElementById("dir-role-select");
    if (dirRoleSel) {
      const existingNotesOpt = dirRoleSel.querySelector('option[value="notes"]');
      if (biosOn && !existingNotesOpt) {
        dirRoleSel.appendChild(el("option", { value: "notes", textContent: "ذوو ملاحظات / سير" }));
      } else if (!biosOn && existingNotesOpt) {
        if (dirRoleSel.value === "notes") dirRoleSel.value = "all";
        existingNotesOpt.remove();
      }
    }
    const reqTypeSel = document.getElementById("req-type");
    if (reqTypeSel) {
      const bioTypeVal = "إضافة سيرة / توثيق تاريخي";
      const existingBioType = [...reqTypeSel.options].find((o) => o.value === bioTypeVal);
      if (biosOn && !existingBioType) {
        const opt = el("option", { value: bioTypeVal, textContent: bioTypeVal });
        const lastOpt = reqTypeSel.querySelector('option[value="إضافة ذرية غير مدونة"]');
        if (lastOpt) reqTypeSel.insertBefore(opt, lastOpt);
        else reqTypeSel.appendChild(opt);
      } else if (!biosOn && existingBioType) {
        if (reqTypeSel.value === bioTypeVal) reqTypeSel.value = "إضافة مولود جديد";
        existingBioType.remove();
      }
    }
  }

  async function shareOrCopyLink(url, title, text, fallbackToast) {
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(fallbackToast || "تم نسخ الرابط للمشاركة.");
    } catch (_) {
      showToast(url);
    }
  }

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_THEME_KEY, theme);
    const metaTheme = document.getElementById("meta-theme-color");
    if (metaTheme) {
      metaTheme.setAttribute("content", theme === "dark" ? "#0B1A14" : "#12372A");
    }
    const icon = document.getElementById("theme-toggle-icon");
    const label = document.getElementById("theme-toggle-label");
    const mIcon = document.getElementById("mobile-menu-theme-icon");
    const mLabel = document.getElementById("mobile-menu-theme-label");
    if (theme === "dark") {
      if (icon) icon.textContent = "☀";
      if (label) label.textContent = "الرقعة التراثية";
      if (mIcon) mIcon.textContent = "☀";
      if (mLabel) mLabel.textContent = "الرقعة التراثية (النهاري)";
    } else {
      if (icon) icon.textContent = "☾";
      if (label) label.textContent = "مجلس ليلي";
      if (mIcon) mIcon.textContent = "☾";
      if (mLabel) mLabel.textContent = "المجلس الليلي";
    }
  }

  function closeMobileSearch() {
    const wrap = document.getElementById("global-search-wrap");
    if (wrap) wrap.classList.remove("mobile-search-open");
    const dd = document.getElementById("global-search-dropdown");
    if (dd) dd.classList.add("hidden");
  }

  function closeAccountPopover() {
    const pop = document.getElementById("account-popover");
    const btn = document.getElementById("open-auth-portal-btn");
    if (pop) pop.classList.add("hidden");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function closeMobileSheets() {
    const backdrop = document.getElementById("mobile-sheet-backdrop");
    const secSheet = document.getElementById("mobile-sections-sheet");
    const moreSheet = document.getElementById("mobile-more-sheet");
    const secBtn = document.getElementById("mobile-sections-trigger");
    const moreBtn = document.getElementById("mobile-more-trigger");
    if (backdrop) backdrop.classList.add("hidden");
    if (secSheet) secSheet.classList.add("hidden");
    if (moreSheet) moreSheet.classList.add("hidden");
    if (secBtn) {
      secBtn.setAttribute("aria-expanded", "false");
      secBtn.classList.remove("sheet-open");
    }
    if (moreBtn) {
      moreBtn.setAttribute("aria-expanded", "false");
      moreBtn.classList.remove("sheet-open");
    }
  }

  function toggleMobileSheet(which) {
    const targetId = which === "sections" ? "mobile-sections-sheet" : "mobile-more-sheet";
    const triggerId = which === "sections" ? "mobile-sections-trigger" : "mobile-more-trigger";
    const sheet = document.getElementById(targetId);
    const trigger = document.getElementById(triggerId);
    const backdrop = document.getElementById("mobile-sheet-backdrop");
    if (!sheet) return;
    const willOpen = sheet.classList.contains("hidden");
    closeMobileSearch();
    closeAccountPopover();
    closeMobileSheets();
    if (willOpen) {
      sheet.classList.remove("hidden");
      if (backdrop) backdrop.classList.remove("hidden");
      if (trigger) {
        trigger.setAttribute("aria-expanded", "true");
        trigger.classList.add("sheet-open");
      }
    }
  }

  function switchView(viewName) {
    if (!viewName) return;
    state.activeView = viewName;
    closeMobileSearch();
    closeMobileSheets();
    document.querySelectorAll(".tab-btn[data-view], .mobile-tab-btn[data-view], .mobile-sheet-item[data-view]").forEach((btn) => {
      const match = btn.dataset.view === viewName;
      btn.classList.toggle("active", match);
      if (btn.hasAttribute("aria-selected")) {
        btn.setAttribute("aria-selected", String(match));
      }
    });
    const sectionsBtn = document.getElementById("mobile-sections-trigger");
    if (sectionsBtn) {
      sectionsBtn.classList.toggle("active", ["sunburst", "directory", "kinship", "analytics"].includes(viewName));
    }
    document.querySelectorAll(".view-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `view-${viewName}`);
    });
    if (viewName !== "tree" && window.scrollY > 40) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (viewName === "tree") {
      renderTree();
    } else if (viewName === "sunburst") {
      renderSunburst();
    } else if (viewName === "directory") {
      renderDirectory();
    } else if (viewName === "kinship") {
      renderKinshipResult();
    } else if (viewName === "analytics") {
      renderAnalytics();
    }
  }

  // -------------------- View 1: Interactive Collapsible SVG Tree --------------------

  const NODE_W = 114;
  const NODE_H = 48;
  const ROOT_W = 148;
  const ROOT_H = 56;
  const SIBLING_GAP_X = 22;
  const LEVEL_GAP_Y = 108;
  const ANCESTOR_GAP_Y = 68;

  function computeTreeLayout() {
    const positions = new Map();
    const visibleEdges = [];
    const widths = new Map();

    // Bottom-up subtree width measurement starting at R00 (عويض)
    function measureSubtree(nodeId) {
      const node = DATA.nodesById[nodeId];
      const selfW = nodeId === "R00" ? ROOT_W : NODE_W;
      const isExpanded = state.expandedIds.has(nodeId);
      const children = isExpanded ? node.childrenIds : [];
      if (!children.length) {
        widths.set(nodeId, selfW);
        return selfW;
      }
      let total = 0;
      children.forEach((cid, idx) => {
        total += measureSubtree(cid);
        if (idx > 0) total += SIBLING_GAP_X;
      });
      const finalW = Math.max(selfW, total);
      widths.set(nodeId, finalW);
      return finalW;
    }

    // Place siblings Right-to-Left (index 0 on right, higher indices to left) for natural Arabic RTL
    function placeSubtree(nodeId, centerX, y) {
      const node = DATA.nodesById[nodeId];
      const selfW = nodeId === "R00" ? ROOT_W : NODE_W;
      const selfH = nodeId === "R00" ? ROOT_H : NODE_H;
      positions.set(nodeId, { x: centerX, y, w: selfW, h: selfH, node });

      if (!state.expandedIds.has(nodeId) || !node.childrenIds.length) return;

      const childWidths = node.childrenIds.map((cid) => widths.get(cid));
      const totalChildrenW =
        childWidths.reduce((acc, w) => acc + w, 0) + SIBLING_GAP_X * (node.childrenIds.length - 1);

      let cursorRight = centerX + totalChildrenW / 2;
      const childY = y + LEVEL_GAP_Y;

      node.childrenIds.forEach((cid, idx) => {
        const cw = childWidths[idx];
        const childCenterX = cursorRight - cw / 2;
        visibleEdges.push({ from: nodeId, to: cid });
        placeSubtree(cid, childCenterX, childY);
        cursorRight -= cw + SIBLING_GAP_X;
      });
    }

    measureSubtree("R00");
    placeSubtree("R00", 0, 0);

    // Prepend ancestor chain A01..A10 stacked cleanly above R00 if enabled
    if (state.showAncestors) {
      const ancChain = getAncestorChain("R00", true).slice(1); // A10 down to A01 (reversed order in helper)
      ancChain.forEach((anc, idx) => {
        const ancY = -(idx + 1) * ANCESTOR_GAP_Y;
        positions.set(anc.id, { x: 0, y: ancY, w: NODE_W + 6, h: 40, node: anc });
        const childId = idx === 0 ? "R00" : ancChain[idx - 1].id;
        visibleEdges.push({ from: anc.id, to: childId });
      });
    }

    return { positions, visibleEdges };
  }

  let animFrameId = null;

  function applyTreeTransform() {
    const vp = document.getElementById("tree-viewport-group");
    if (!vp) return;
    const { x, y, k } = state.treeTransform;
    vp.setAttribute("transform", `translate(${x.toFixed(2)}, ${y.toFixed(2)}) scale(${k.toFixed(4)})`);
  }

  function animateTreeTransform(targetX, targetY, targetK, durationMs) {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!durationMs || reduced) {
      state.treeTransform = { x: targetX, y: targetY, k: targetK };
      applyTreeTransform();
      return;
    }
    const start = { ...state.treeTransform };
    const t0 = performance.now();
    function step(now) {
      const t = Math.min(1, (now - t0) / durationMs);
      const ease = 1 - Math.pow(1 - t, 3);
      state.treeTransform = {
        x: start.x + (targetX - start.x) * ease,
        y: start.y + (targetY - start.y) * ease,
        k: start.k + (targetK - start.k) * ease,
      };
      applyTreeTransform();
      if (t < 1) {
        animFrameId = requestAnimationFrame(step);
      } else {
        animFrameId = null;
      }
    }
    animFrameId = requestAnimationFrame(step);
  }

  function fitTreeToViewport(focusNodeId, fitOpts) {
    const opts = fitOpts || {};
    const svg = document.getElementById("family-tree-svg");
    if (!svg || !state.layoutPositions.size) return;
    const rect = svg.getBoundingClientRect();
    const vw = rect.width || 1000;
    const vh = rect.height || 580;
    const duration = opts.animate ? 240 : 0;

    if (focusNodeId && state.layoutPositions.has(focusNodeId)) {
      const p = state.layoutPositions.get(focusNodeId);
      const minScale = vw <= 600 ? 0.72 : 1.0;
      const k = Math.max(state.treeTransform.k, minScale);
      animateTreeTransform(vw / 2 - p.x * k, vh * 0.42 - p.y * k, k, duration);
      return;
    }

    // On narrow mobile screens, frame R00 and middle branches at a readable scale by default
    const isInitialRootOnly =
      state.expandedIds.size === 1 && state.expandedIds.has("R00") && !state.showAncestors;
    if (vw <= 600 && isInitialRootOnly && !opts.forceFullFit && state.layoutPositions.has("R00")) {
      const pRoot = state.layoutPositions.get("R00");
      const k = 0.62;
      animateTreeTransform(vw / 2 - pRoot.x * k, vh * 0.25 - pRoot.y * k, k, duration);
      return;
    }

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of state.layoutPositions.values()) {
      minX = Math.min(minX, p.x - p.w / 2);
      maxX = Math.max(maxX, p.x + p.w / 2);
      minY = Math.min(minY, p.y - p.h / 2);
      maxY = Math.max(maxY, p.y + p.h / 2 + 22);
    }
    const bw = Math.max(120, maxX - minX);
    const bh = Math.max(120, maxY - minY);
    const pad = vw <= 600 ? 22 : 48;
    const k = Math.min(1.15, Math.max(0.16, Math.min((vw - pad * 2) / bw, (vh - pad * 2) / bh)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    animateTreeTransform(vw / 2 - cx * k, vh / 2 - cy * k + 14, k, duration);
  }

  function renderTree(options) {
    const opts = options || {};
    const { positions, visibleEdges } = computeTreeLayout();
    state.layoutPositions = positions;

    const edgesLayer = document.getElementById("tree-edges-layer");
    const nodesLayer = document.getElementById("tree-nodes-layer");
    edgesLayer.textContent = "";
    nodesLayer.textContent = "";

    const hasHighlight = state.highlightedIds.size > 0;

    // Render orthogonal curved step connectors
    for (const edge of visibleEdges) {
      const pFrom = positions.get(edge.from);
      const pTo = positions.get(edge.to);
      if (!pFrom || !pTo) continue;

      const x1 = pFrom.x;
      const y1 = pFrom.y + pFrom.h / 2;
      const x2 = pTo.x;
      const y2 = pTo.y - pTo.h / 2;
      const midY = (y1 + y2) / 2;
      const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;

      const isEdgeHi = hasHighlight && state.highlightedIds.has(edge.from) && state.highlightedIds.has(edge.to);
      const toNode = DATA.nodesById[edge.to];
      const edgeColor = toNode ? getBranchColor(toNode.branchId) : "#C9B38C";
      const path = svgEl("path", {
        d,
        stroke: isEdgeHi ? "#C59B43" : edgeColor,
        class: `tree-edge${isEdgeHi ? " highlighted" : hasHighlight ? " dimmed" : ""}`,
      });
      edgesLayer.appendChild(path);
    }

    // Render node cards
    for (const [id, p] of positions.entries()) {
      const node = p.node;
      const color = getBranchColor(node.branchId);
      const isHi = hasHighlight && state.highlightedIds.has(id);
      const isRoot = node.id === "R00" || node.branchId === "ROOT";
      const isAnc = node.generation < 0;
      const isBranch = node.generation === 1;

      const classes = ["tree-node"];
      if (isRoot) classes.push("is-root");
      if (isAnc) classes.push("is-ancestor");
      if (isBranch) classes.push("is-branch");
      if (node.childrenCount > 0) classes.push("has-children");
      else classes.push("is-leaf");
      if (isHi) classes.push("is-highlighted");
      else if (hasHighlight) classes.push("dimmed");

      const g = svgEl("g", {
        class: classes.join(" "),
        transform: `translate(${p.x}, ${p.y})`,
        "data-id": id,
      });

      const rect = svgEl("rect", {
        x: -p.w / 2,
        y: -p.h / 2,
        width: p.w,
        height: p.h,
        rx: isRoot ? 12 : 8,
        class: "node-box",
        stroke: isRoot ? "#E2BE6E" : color,
      });
      g.appendChild(rect);

      // Inner gold double-trim cartouche frame for ancestral root Uwaid
      if (isRoot) {
        const innerTrim = svgEl("rect", {
          x: -p.w / 2 + 4,
          y: -p.h / 2 + 4,
          width: p.w - 8,
          height: p.h - 8,
          rx: 9,
          fill: "none",
          stroke: "#E2BE6E",
          "stroke-width": 1,
          "stroke-opacity": 0.55,
          "pointer-events": "none",
        });
        g.appendChild(innerTrim);
      }

      // Branch accent top bar inside non-root nodes
      if (!isRoot && !isAnc) {
        const accent = svgEl("rect", {
          x: -p.w / 2 + 1,
          y: -p.h / 2 + 1,
          width: p.w - 2,
          height: 5,
          rx: 3,
          fill: color,
        });
        g.appendChild(accent);
      }

      // Sublabel
      let subLabel = "";
      if (isRoot) subLabel = "جد ذوي عويض • ٧٤٩ ذرية";
      else if (isBranch) subLabel = `فرع (${toArabicDigits(node.descendantCount + 1)})`;
      else if (node.bioNote) subLabel = "سيرة / ملاحظة";
      else if (node.childrenCount > 0) subLabel = `${toArabicDigits(node.descendantCount)} ذرية`;

      const nameTxt = svgEl("text", {
        x: 0,
        y: subLabel ? -5 : 1,
        class: "node-name",
      });
      nameTxt.textContent = node.name;
      g.appendChild(nameTxt);

      if (subLabel) {
        const subTxt = svgEl("text", { x: 0, y: 12, class: "node-sub" });
        subTxt.textContent = subLabel;
        g.appendChild(subTxt);
      }

      g.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openProfileDrawer(id);
      });

      // Expand / collapse pill for Uwaid & descendants that have children
      if (node.generation >= 0 && node.childrenCount > 0) {
        const isOpen = state.expandedIds.has(id);
        const btnG = svgEl("g", {
          class: "node-expand-btn",
          transform: `translate(0, ${p.h / 2 + 10})`,
        });
        // Generous invisible touch target so mobile thumbs hit + / - reliably
        const hitRect = svgEl("rect", {
          x: -22,
          y: -16,
          width: 44,
          height: 32,
          rx: 12,
          fill: "transparent",
        });
        const pillW = isOpen ? 24 : 36;
        const pill = svgEl("rect", {
          x: -pillW / 2,
          y: -10,
          width: pillW,
          height: 20,
          rx: 10,
          class: "node-expand-circle",
          stroke: color,
        });
        const lbl = svgEl("text", { x: 0, y: 0.5, class: "node-expand-label" });
        lbl.textContent = isOpen ? "−" : `+${toArabicDigits(node.childrenCount)}`;
        btnG.appendChild(hitRect);
        btnG.appendChild(pill);
        btnG.appendChild(lbl);
        btnG.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (state.expandedIds.has(id)) {
            state.expandedIds.delete(id);
          } else {
            state.expandedIds.add(id);
          }
          renderTree({ preserveView: true });
        });
        g.appendChild(btnG);
      }

      nodesLayer.appendChild(g);
    }

    // Update UI indicators
    document.getElementById("tree-visible-counter").textContent =
      `يُعرض الآن: ${toArabicDigits(positions.size)} من أصل ${toArabicDigits(DATA.meta.totalNodes)} اسماً`;

    const hlBanner = document.getElementById("tree-highlight-banner");
    if (hasHighlight) {
      hlBanner.classList.remove("hidden");
      document.getElementById("tree-highlight-text").textContent = state.highlightLabel;
    } else {
      hlBanner.classList.add("hidden");
    }

    const fnBanner = document.getElementById("ancestors-footnote-banner");
    if (state.showAncestors && DATA.meta.lineageFootnotes && DATA.meta.lineageFootnotes.length) {
      fnBanner.classList.remove("hidden");
      document.getElementById("ancestors-footnote-text").textContent = DATA.meta.lineageFootnotes[0];
    } else {
      fnBanner.classList.add("hidden");
    }

    if (opts.focusId) {
      fitTreeToViewport(opts.focusId, { animate: Boolean(opts.animate) });
    } else if (!opts.preserveView) {
      fitTreeToViewport(null, { animate: Boolean(opts.animate), forceFullFit: Boolean(opts.forceFullFit) });
    } else {
      applyTreeTransform();
    }
  }

  function renderBranchPills() {
    const container = document.getElementById("tree-branch-pills");
    container.textContent = "";

    const allBtn = el(
      "button",
      {
        type: "button",
        className: `branch-pill${state.activeBranchFilter === "ALL" ? " active" : ""}`,
        onClick: () => {
          state.activeBranchFilter = "ALL";
          state.expandedIds = new Set(["R00"]);
          renderBranchPills();
          renderTree();
        },
      },
      [el("span", { className: "pill-swatch", style: "background:#C59B43" }), el("span", { textContent: "جميع الفروع (٨)" })]
    );
    container.appendChild(allBtn);

    for (const bs of DATA.branchStats) {
      const btn = el(
        "button",
        {
          type: "button",
          className: `branch-pill${state.activeBranchFilter === bs.branchId ? " active" : ""}`,
          onClick: () => {
            focusBranchInTree(bs.branchId);
          },
        },
        [
          el("span", { className: "pill-swatch", style: `background:${getBranchColor(bs.branchId)}` }),
          el("span", { textContent: `${bs.name} (${toArabicDigits(bs.totalInBranch)})` }),
        ]
      );
      container.appendChild(btn);
    }
  }

  function focusBranchInTree(branchId) {
    state.activeBranchFilter = branchId;
    state.expandedIds = new Set(["R00", branchId]);
    const branchNode = DATA.nodesById[branchId];
    if (branchNode) {
      // Expand one extra generation inside the chosen branch for immediate clarity
      for (const cid of branchNode.childrenIds) {
        state.expandedIds.add(cid);
      }
    }
    switchView("tree");
    renderBranchPills();
    renderTree({ focusId: branchId });
  }

  function expandAllInTree() {
    state.activeBranchFilter = "ALL";
    for (const node of ALL_NODES) {
      if (node.generation >= 0 && node.childrenCount > 0) {
        state.expandedIds.add(node.id);
      }
    }
    renderBranchPills();
    renderTree();
  }

  function locateNodeInTree(nodeId, customHighlightIds, customLabel) {
    const node = DATA.nodesById[nodeId];
    if (!node) return;
    if (node.generation < 0) {
      state.showAncestors = true;
      document.getElementById("toggle-ancestors-cb").checked = true;
    }

    const chain = getAncestorChain(nodeId, true);
    for (const anc of chain) {
      if (anc.generation >= 0) state.expandedIds.add(anc.id);
    }

    if (customHighlightIds) {
      state.highlightedIds = new Set(customHighlightIds);
      state.highlightLabel = customLabel || formatShortDescriptor(node);
    } else {
      state.highlightedIds = new Set(chain.filter((n) => n.generation >= (state.showAncestors ? -10 : 0)).map((n) => n.id));
      state.highlightLabel = `عمود نسب: ${formatShortDescriptor(node)}`;
    }

    switchView("tree");
    renderTree({ focusId: nodeId });
  }

  function setupTreePanZoom() {
    const svg = document.getElementById("family-tree-svg");
    const pointers = new Map();
    let panOrigin = null;
    let pinchStart = null;
    let dragMoved = false;
    let suppressNextClick = false;
    let lastTap = { time: 0, x: 0, y: 0 };

    function pointerMidAndDist() {
      const pts = [...pointers.values()];
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      return {
        dist: Math.hypot(dx, dy),
        mx: (pts[0].x + pts[1].x) / 2,
        my: (pts[0].y + pts[1].y) / 2,
      };
    }

    // Swallow trailing click immediately after any pan or pinch gesture
    svg.addEventListener(
      "click",
      (ev) => {
        if (suppressNextClick) {
          suppressNextClick = false;
          ev.stopPropagation();
          ev.preventDefault();
        }
      },
      true
    );

    svg.addEventListener("pointerdown", (ev) => {
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      if (pointers.size === 1) {
        dragMoved = false;
        suppressNextClick = false;
        panOrigin = {
          startX: ev.clientX,
          startY: ev.clientY,
          tx: state.treeTransform.x,
          ty: state.treeTransform.y,
          downTime: performance.now(),
          onBackground: !ev.target.closest(".tree-node") && !ev.target.closest(".node-expand-btn"),
        };
        pinchStart = null;
      } else if (pointers.size === 2) {
        const rect = svg.getBoundingClientRect();
        const { dist, mx, my } = pointerMidAndDist();
        const localX = mx - rect.left;
        const localY = my - rect.top;
        dragMoved = true;
        suppressNextClick = true;
        pinchStart = {
          dist: Math.max(10, dist),
          k: state.treeTransform.k,
          worldX: (localX - state.treeTransform.x) / state.treeTransform.k,
          worldY: (localY - state.treeTransform.y) / state.treeTransform.k,
        };
      }
    });

    svg.addEventListener("pointermove", (ev) => {
      if (!pointers.has(ev.pointerId)) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      if (pointers.size === 2 && pinchStart) {
        const rect = svg.getBoundingClientRect();
        const { dist, mx, my } = pointerMidAndDist();
        const localX = mx - rect.left;
        const localY = my - rect.top;
        const nextK = Math.min(2.8, Math.max(0.18, pinchStart.k * (dist / pinchStart.dist)));
        state.treeTransform = {
          k: nextK,
          x: localX - pinchStart.worldX * nextK,
          y: localY - pinchStart.worldY * nextK,
        };
        applyTreeTransform();
        return;
      }

      if (pointers.size === 1 && panOrigin) {
        const dx = ev.clientX - panOrigin.startX;
        const dy = ev.clientY - panOrigin.startY;
        if (!dragMoved && Math.hypot(dx, dy) > 7) {
          dragMoved = true;
          suppressNextClick = true;
          try {
            svg.setPointerCapture(ev.pointerId);
          } catch (_) {}
        }
        if (dragMoved) {
          state.treeTransform.x = panOrigin.tx + dx;
          state.treeTransform.y = panOrigin.ty + dy;
          applyTreeTransform();
        }
      }
    });

    function endPointer(ev) {
      if (!pointers.has(ev.pointerId)) return;
      pointers.delete(ev.pointerId);
      try {
        if (svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
      } catch (_) {}

      if (pointers.size === 1) {
        const rem = [...pointers.values()][0];
        panOrigin = {
          startX: rem.x,
          startY: rem.y,
          tx: state.treeTransform.x,
          ty: state.treeTransform.y,
          downTime: performance.now(),
          onBackground: false,
        };
        pinchStart = null;
        return;
      }

      // Double-tap empty background smoothly zooms in or resets fit
      if (pointers.size === 0 && !dragMoved && panOrigin && panOrigin.onBackground) {
        const now = performance.now();
        const dt = now - lastTap.time;
        const dd = Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y);
        if (dt < 320 && dd < 26) {
          lastTap.time = 0;
          if (state.treeTransform.k > 1.1) {
            fitTreeToViewport(null, { animate: true, forceFullFit: true });
          } else {
            const rect = svg.getBoundingClientRect();
            const mx = ev.clientX - rect.left;
            const my = ev.clientY - rect.top;
            const nextK = Math.min(2.2, state.treeTransform.k * 1.55);
            const ratio = nextK / state.treeTransform.k;
            animateTreeTransform(
              mx - (mx - state.treeTransform.x) * ratio,
              my - (my - state.treeTransform.y) * ratio,
              nextK,
              240
            );
          }
        } else {
          lastTap = { time: now, x: ev.clientX, y: ev.clientY };
        }
      }

      panOrigin = null;
      pinchStart = null;
      if (suppressNextClick) {
        setTimeout(() => {
          suppressNextClick = false;
        }, 60);
      }
    }

    svg.addEventListener("pointerup", endPointer);
    svg.addEventListener("pointercancel", endPointer);

    svg.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        if (animFrameId) {
          cancelAnimationFrame(animFrameId);
          animFrameId = null;
        }
        const rect = svg.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        const my = ev.clientY - rect.top;
        const factor = ev.deltaY < 0 ? 1.14 : 0.88;
        const nextK = Math.min(2.8, Math.max(0.14, state.treeTransform.k * factor));
        const ratio = nextK / state.treeTransform.k;
        state.treeTransform.x = mx - (mx - state.treeTransform.x) * ratio;
        state.treeTransform.y = my - (my - state.treeTransform.y) * ratio;
        state.treeTransform.k = nextK;
        applyTreeTransform();
      },
      { passive: false }
    );

    document.getElementById("zoom-in-btn").addEventListener("click", () => {
      zoomAtCenter(1.24);
    });
    document.getElementById("zoom-out-btn").addEventListener("click", () => {
      zoomAtCenter(0.8);
    });
    document.getElementById("zoom-fit-btn").addEventListener("click", () =>
      fitTreeToViewport(null, { animate: true, forceFullFit: true })
    );
    document.getElementById("zoom-root-btn").addEventListener("click", () =>
      fitTreeToViewport("R00", { animate: true })
    );
  }

  function zoomAtCenter(factor) {
    const svg = document.getElementById("family-tree-svg");
    const rect = svg.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const nextK = Math.min(2.8, Math.max(0.14, state.treeTransform.k * factor));
    const ratio = nextK / state.treeTransform.k;
    animateTreeTransform(
      cx - (cx - state.treeTransform.x) * ratio,
      cy - (cy - state.treeTransform.y) * ratio,
      nextK,
      200
    );
  }

  // -------------------- View 2: Interactive Radial Sunburst --------------------

  function polarToCartesian(r, angle) {
    return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
  }

  function buildAnnularArcPath(rIn, rOut, a0, a1) {
    const span = a1 - a0;
    if (span >= Math.PI * 1.999) {
      // Full ring workaround using two 180-deg arcs
      return [
        buildAnnularArcPath(rIn, rOut, 0, Math.PI),
        buildAnnularArcPath(rIn, rOut, Math.PI, Math.PI * 2),
      ].join(" ");
    }
    const p1 = polarToCartesian(rOut, a0);
    const p2 = polarToCartesian(rOut, a1);
    const p3 = polarToCartesian(rIn, a1);
    const p4 = polarToCartesian(rIn, a0);
    const largeArc = span > Math.PI ? 1 : 0;
    return [
      `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
      `A ${rOut} ${rOut} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
      `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
      `A ${rIn} ${rIn} 0 ${largeArc} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
      "Z",
    ].join(" ");
  }

  function updateSunburstInspector(nodeId) {
    state.sunburstInspectorId = nodeId;
    const node = DATA.nodesById[nodeId];
    if (!node) return;
    document.getElementById("sb-insp-name").textContent = node.name;
    document.getElementById("sb-insp-lineage").textContent = formatLineageSentence(node.id, false) || node.name;
    document.getElementById("sb-insp-direct").textContent = toArabicDigits(node.childrenCount);
    document.getElementById("sb-insp-desc").textContent = toArabicDigits(node.descendantCount);
    document.getElementById("sb-insp-gen").textContent =
      node.branchId === "ROOT" ? "الأصل" : `${node.branchName} • ج${toArabicDigits(node.generation)}`;
  }

  function renderSunburst() {
    const svg = document.getElementById("sunburst-svg");
    svg.textContent = "";

    const root = DATA.nodesById[state.sunburstRootId] || DATA.nodesById["R00"];
    const maxRings = 4;
    const innerHubR = 62;
    const ringThick = 68;

    function subtreeWeight(nodeId) {
      const n = DATA.nodesById[nodeId];
      if (!n) return 1;
      return Math.max(2, n.descendantCount * 0.78 + 2.5);
    }

    function drawChildren(parentNode, depth, aStart, aEnd) {
      if (depth > maxRings || !parentNode.childrenIds.length) return;
      const weights = parentNode.childrenIds.map(subtreeWeight);
      const sumW = weights.reduce((a, b) => a + b, 0);
      const rIn = innerHubR + (depth - 1) * ringThick;
      const rOut = rIn + ringThick - 3;

      let cursor = aStart;
      parentNode.childrenIds.forEach((cid, idx) => {
        const node = DATA.nodesById[cid];
        const span = ((aEnd - aStart) * weights[idx]) / sumW;
        const cEnd = cursor + span;
        const baseColor = getBranchColor(node.branchId);
        const opacity = Math.max(0.55, 1 - (depth - 1) * 0.12);

        const wedge = svgEl("path", {
          d: buildAnnularArcPath(rIn, rOut, cursor, cEnd),
          fill: baseColor,
          "fill-opacity": opacity.toFixed(2),
          class: "sb-wedge",
        });

        wedge.addEventListener("mouseenter", () => updateSunburstInspector(cid));
        wedge.addEventListener("click", () => {
          updateSunburstInspector(cid);
          if (node.childrenCount > 0) {
            state.sunburstRootId = cid;
            renderSunburst();
          } else {
            openProfileDrawer(cid);
          }
        });
        svg.appendChild(wedge);

        // Place Arabic label cleanly inside sufficiently wide wedges
        if (span > 0.085) {
          const midA = (cursor + cEnd) / 2;
          const midR = (rIn + rOut) / 2;
          const pos = polarToCartesian(midR, midA);
          const lbl = svgEl("text", {
            x: pos.x.toFixed(2),
            y: pos.y.toFixed(2),
            class: "sb-label",
            "font-size": span > 0.24 ? "12" : "10",
          });
          lbl.textContent = node.name;
          svg.appendChild(lbl);
        }

        drawChildren(node, depth + 1, cursor, cEnd);
        cursor = cEnd;
      });
    }

    drawChildren(root, 1, -Math.PI / 2, (3 * Math.PI) / 2);

    // Center hub button (click to step up to parent)
    const hubG = svgEl("g", { style: "cursor:pointer" });
    hubG.appendChild(
      svgEl("circle", {
        cx: 0,
        cy: 0,
        r: innerHubR - 4,
        fill: "#12372A",
        stroke: "#C59B43",
        "stroke-width": 3,
      })
    );
    const hubTitle = svgEl("text", {
      x: 0,
      y: -6,
      "text-anchor": "middle",
      "dominant-baseline": "central",
      fill: "#FFFDF8",
      "font-family": "Amiri, serif",
      "font-size": "20",
      "font-weight": "700",
    });
    hubTitle.textContent = root.name;
    hubG.appendChild(hubTitle);

    const hubSub = svgEl("text", {
      x: 0,
      y: 16,
      "text-anchor": "middle",
      fill: "#E2BE6E",
      "font-size": "10.5",
      "font-weight": "600",
    });
    hubSub.textContent =
      root.id === "R00" ? `٧٤٩ من الذرية` : `رجوع ← (${toArabicDigits(root.descendantCount)})`;
    hubG.appendChild(hubSub);

    hubG.addEventListener("click", () => {
      if (root.id !== "R00" && root.parentId && DATA.nodesById[root.parentId].generation >= 0) {
        state.sunburstRootId = root.parentId;
        updateSunburstInspector(root.parentId);
        renderSunburst();
      }
    });
    svg.appendChild(hubG);

    // Render breadcrumbs
    const crumbsWrap = document.getElementById("sunburst-breadcrumbs");
    crumbsWrap.textContent = "";
    const chain = getAncestorChain(root.id, false).reverse();
    chain.forEach((n, idx) => {
      if (idx > 0) crumbsWrap.appendChild(el("span", { className: "chain-sep", textContent: "◀" }));
      crumbsWrap.appendChild(
        el("button", {
          type: "button",
          className: "sb-crumb",
          textContent: n.name,
          onClick: () => {
            state.sunburstRootId = n.id;
            updateSunburstInspector(n.id);
            renderSunburst();
          },
        })
      );
    });

    // Branch legend chips
    const legendWrap = document.getElementById("sunburst-branch-legend");
    legendWrap.textContent = "";
    for (const bs of DATA.branchStats) {
      legendWrap.appendChild(
        el(
          "button",
          {
            type: "button",
            className: "legend-chip",
            onClick: () => {
              state.sunburstRootId = bs.branchId;
              updateSunburstInspector(bs.branchId);
              renderSunburst();
            },
          },
          [
            el("span", { className: "legend-chip-left" }, [
              el("span", { className: "pill-swatch", style: `background:${getBranchColor(bs.branchId)}` }),
              el("span", { textContent: bs.name }),
            ]),
            el("span", { className: "hint-sub", textContent: toArabicDigits(bs.totalInBranch) }),
          ]
        )
      );
    }

    updateSunburstInspector(state.sunburstInspectorId || root.id);
  }

  // -------------------- View 3: Directory & Multi-Token Search --------------------

  function populateDirectorySelects() {
    const branchSel = document.getElementById("dir-branch-select");
    const prevBranch = branchSel.value || "ALL";
    branchSel.textContent = "";
    branchSel.appendChild(el("option", { value: "ALL", textContent: `جميع الفروع (${toArabicDigits(DATA.meta.totalNodes)})` }));
    branchSel.appendChild(el("option", { value: "ANC", textContent: "عمود النسب أعلى عويض (١٠)" }));
    branchSel.appendChild(el("option", { value: "ROOT", textContent: "الجد المؤسس — عويض" }));
    for (const bs of DATA.branchStats) {
      branchSel.appendChild(
        el("option", {
          value: bs.branchId,
          textContent: `فرع ${bs.name} (${toArabicDigits(bs.totalInBranch)})`,
        })
      );
    }
    if ([...branchSel.options].some((o) => o.value === prevBranch)) {
      branchSel.value = prevBranch;
    }

    const genSel = document.getElementById("dir-gen-select");
    const prevGen = genSel.value || "ALL";
    genSel.textContent = "";
    genSel.appendChild(el("option", { value: "ALL", textContent: "جميع الأجيال" }));
    genSel.appendChild(el("option", { value: "ANC", textContent: "الأجداد قبل عويض (-١٠ إلى -١)" }));
    for (let g = 0; g <= 8; g++) {
      genSel.appendChild(
        el("option", {
          value: String(g),
          textContent: g === 0 ? "الجد عويض (الجيل ٠)" : `الجيل ${toArabicDigits(g)}`,
        })
      );
    }
    if ([...genSel.options].some((o) => o.value === prevGen)) {
      genSel.value = prevGen;
    }

    // Modal branch select as well
    const reqBranchSel = document.getElementById("req-branch");
    reqBranchSel.textContent = "";
    for (const bs of DATA.branchStats) {
      reqBranchSel.appendChild(el("option", { value: bs.name, textContent: `فرع ${bs.name}` }));
    }
    reqBranchSel.appendChild(el("option", { value: "عمود النسب العام", textContent: "عمود النسب العام" }));
  }

  function renderDirectory() {
    const q = normalizeArabic(document.getElementById("dir-query-input").value);
    const branchVal = document.getElementById("dir-branch-select").value;
    const genVal = document.getElementById("dir-gen-select").value;
    const roleVal = document.getElementById("dir-role-select").value;
    const tokens = q ? q.split(" ").filter(Boolean) : [];

    const filtered = SEARCH_INDEX.filter((item) => {
      const n = item.node;
      if (branchVal !== "ALL" && n.branchId !== branchVal) return false;
      if (genVal === "ANC" && n.generation >= 0) return false;
      if (genVal !== "ALL" && genVal !== "ANC" && n.generation !== Number(genVal)) return false;

      if (roleVal === "fathers" && n.childrenCount === 0) return false;
      if (roleVal === "ancestors" && n.generation >= 0) return false;
      if (roleVal === "no-sons" && (n.childrenCount > 0 || n.generation < 0)) return false;
      if (roleVal === "notes" && (!isBiosEnabled() || !n.bioNote)) return false;

      if (tokens.length) {
        for (const tok of tokens) {
          if (!item.normFull.includes(tok)) return false;
        }
      }
      return true;
    });

    document.getElementById("dir-count-label").textContent =
      `المطابقون: ${toArabicDigits(filtered.length)} اسماً`;

    const grid = document.getElementById("directory-cards-grid");
    grid.textContent = "";

    const slice = filtered.slice(0, state.directoryPageSize);
    for (const item of slice) {
      const n = item.node;
      const bColor = getBranchColor(n.branchId);
      const card = el("article", { className: "member-card" }, [
        el("div", null, [
          el("div", { className: "mc-top" }, [
            el("h3", { className: "mc-name", textContent: n.name }),
            el("span", {
              className: "sr-branch-tag",
              style: `background:${bColor}`,
              textContent: n.branchId === "ANC" ? "عمود النسب" : n.branchId === "ROOT" ? "الجذر" : n.branchName,
            }),
          ]),
          el("p", { className: "mc-lineage", textContent: item.shortLineage }),
          isBiosEnabled() && n.bioNote ? el("div", { className: "mc-note", textContent: n.bioNote }) : null,
        ]),
        el("div", { className: "mc-footer" }, [
          el("span", {
            className: "mc-meta",
            textContent:
              n.childrenCount > 0
                ? `${toArabicDigits(n.childrenCount)} أبناء • ${toArabicDigits(n.descendantCount)} ذرية`
                : n.generation < 0
                ? "عمود النسب"
                : `الجيل ${toArabicDigits(n.generation)}`,
          }),
          el("div", { className: "mc-btns" }, [
            el("button", {
              type: "button",
              className: "btn btn-subtle btn-xs",
              textContent: "البطاقة",
              onClick: () => openProfileDrawer(n.id),
            }),
            el("button", {
              type: "button",
              className: "btn btn-emerald btn-xs",
              textContent: "في الشجرة",
              onClick: () => locateNodeInTree(n.id),
            }),
          ]),
        ]),
      ]);
      grid.appendChild(card);
    }

    const loadMoreWrap = document.getElementById("directory-load-more-wrap");
    loadMoreWrap.classList.toggle("hidden", filtered.length <= state.directoryPageSize);
  }

  // -------------------- View 4: Smart Kinship Calculator ("وش يقرب لي؟") --------------------

  function findLCA(idA, idB) {
    const chainA = getAncestorChain(idA, true); // [A, ..., A01]
    const chainB = getAncestorChain(idB, true); // [B, ..., A01]
    const setA = new Map();
    chainA.forEach((n, idx) => setA.set(n.id, idx));

    for (let j = 0; j < chainB.length; j++) {
      const bNode = chainB[j];
      if (setA.has(bNode.id)) {
        const i = setA.get(bNode.id);
        return {
          lca: bNode,
          dA: i,
          dB: j,
          pathA: chainA.slice(0, i + 1),
          pathB: chainB.slice(0, j + 1),
        };
      }
    }
    return null;
  }

  function describeSaudiKinship(nodeA, nodeB, res) {
    const { lca, dA, dB } = res;
    if (dA === 0 && dB === 0) {
      return {
        headline: "الشخص نفسه",
        detail: `${nodeA.name} هو نفس العضو المحدّد في الطرفين.`,
      };
    }
    if (dA > 0 && dB === 0) {
      if (dA === 1) return { headline: `${nodeB.name} والد ${nodeA.name}`, detail: "صلة أبوّة مباشرة (أب وابنه)." };
      if (dA === 2) return { headline: `${nodeB.name} جدّ ${nodeA.name}`, detail: "صلة جُدودة مباشرة (حفيد وجدّه)." };
      return {
        headline: `${nodeA.name} من ذرية الجد ${nodeB.name}`,
        detail: `تفصلهما ${toArabicDigits(dA)} أجيال في عمود نسب مباشر.`,
      };
    }
    if (dB > 0 && dA === 0) {
      if (dB === 1) return { headline: `${nodeA.name} والد ${nodeB.name}`, detail: "صلة أبوّة مباشرة (أب وابنه)." };
      if (dB === 2) return { headline: `${nodeA.name} جدّ ${nodeB.name}`, detail: "صلة جُدودة مباشرة (جد وحفيده)." };
      return {
        headline: `${nodeB.name} من ذرية الجد ${nodeA.name}`,
        detail: `تفصلهما ${toArabicDigits(dB)} أجيال في عمود نسب مباشر.`,
      };
    }
    if (dA === 1 && dB === 1) {
      return {
        headline: `إخوة — أبناء ${lca.name}`,
        detail: `يجتمعان مباشرة في والدهما ${lca.name}.`,
      };
    }
    if ((dA === 2 && dB === 1) || (dA === 1 && dB === 2)) {
      const uncle = dA === 1 ? nodeA : nodeB;
      const nephew = dA === 1 ? nodeB : nodeA;
      return {
        headline: `${uncle.name} عمّ ${nephew.name}`,
        detail: `صلة عمومة مباشرة — يجتمعان في الجد ${lca.name}.`,
      };
    }
    if (dA === 2 && dB === 2) {
      return {
        headline: `أبناء عمّ لَزَم`,
        detail: `أبواهما إخوة، ويجتمعان في جدّهما المباشر ${lca.name}.`,
      };
    }
    if (dA === dB) {
      return {
        headline: `أبناء عمومة من الجد رقم ${toArabicDigits(dA)}`,
        detail: `كلاهما على مسافة ${toArabicDigits(dA)} أجيال من الجد الجامع ${lca.name}.`,
      };
    }
    const elder = dA < dB ? nodeA : nodeB;
    const younger = dA < dB ? nodeB : nodeA;
    const minD = Math.min(dA, dB);
    const gap = Math.abs(dA - dB);
    return {
      headline: minD === 1 ? `${elder.name} عمّ جدّ لـ${younger.name}` : `قرابة عمومة بفارق ${toArabicDigits(gap)} ${gap === 1 ? "جيل" : "أجيال"}`,
      detail: `يجتمعان في الجد ${lca.name} (${elder.name} أقرب إليه بـ ${toArabicDigits(Math.min(dA, dB))} خطوة، و${younger.name} بـ ${toArabicDigits(Math.max(dA, dB))} خطوة).`,
    };
  }

  function renderSelectedPill(targetId, nodeId) {
    const box = document.getElementById(targetId);
    const node = DATA.nodesById[nodeId];
    box.textContent = "";
    if (!node) return;
    box.appendChild(
      el("div", null, [
        el("strong", { textContent: formatShortDescriptor(node) }),
        el("div", { className: "hint-sub", textContent: formatLineageSentence(node.id, false) }),
      ])
    );
  }

  function renderKinshipResult() {
    const nodeA = DATA.nodesById[state.kinshipA];
    const nodeB = DATA.nodesById[state.kinshipB];
    renderSelectedPill("kin-selected-a", state.kinshipA);
    renderSelectedPill("kin-selected-b", state.kinshipB);

    const card = document.getElementById("kinship-result-card");
    card.textContent = "";
    if (!nodeA || !nodeB) return;

    const res = findLCA(nodeA.id, nodeB.id);
    if (!res) return;
    const desc = describeSaudiKinship(nodeA, nodeB, res);

    const banner = el("div", { className: "kin-verdict-banner" }, [
      el("div", null, [
        el("h3", { className: "kin-verdict-title", textContent: desc.headline }),
        el("p", { className: "kin-verdict-sub", textContent: desc.detail }),
      ]),
      el("div", { className: "kin-banner-actions" }, [
        el("button", {
          type: "button",
          className: "btn btn-gold",
          textContent: "تلوين المسار على الشجرة",
          onClick: () => {
            const allPathIds = [...res.pathA, ...res.pathB].map((n) => n.id);
            [...res.pathA, ...res.pathB].forEach((n) => {
              if (n.generation >= 0) state.expandedIds.add(n.id);
            });
            locateNodeInTree(
              res.lca.id,
              allPathIds,
              `مسار القرابة: ${nodeA.name} و ${nodeB.name} (الجد الجامع: ${res.lca.name})`
            );
          },
        }),
        el("button", {
          type: "button",
          className: "btn btn-outline",
          textContent: "مشاركة النتيجة",
          onClick: () => {
            const shareUrl = `${window.location.origin}${window.location.pathname}?view=kinship&a=${encodeURIComponent(
              nodeA.id
            )}&b=${encodeURIComponent(nodeB.id)}`;
            shareOrCopyLink(
              shareUrl,
              `صلة القرابة بين ${nodeA.name} و${nodeB.name} — ذوي عويض`,
              `${desc.headline} — ${desc.detail}`,
              "تم نسخ رابط صلة القرابة للمشاركة."
            );
          },
        }),
      ]),
    ]);
    card.appendChild(banner);

    function buildLimbCol(title, chain, stepsCount) {
      const col = el("div", { className: "kin-bridge-col" }, [
        el("h4", { textContent: `${title} (${toArabicDigits(stepsCount)} خطوات صعوداً)` }),
      ]);
      const list = el("ul", { className: "kin-step-list" });
      chain.forEach((n, idx) => {
        list.appendChild(
          el(
            "li",
            {
              className: "kin-step-item",
              onClick: () => openProfileDrawer(n.id),
            },
            [
              el("span", { textContent: n.name }),
              el("span", {
                className: "hint-sub",
                textContent: idx === 0 ? "الطرف" : idx === chain.length - 1 ? "الجد الجامع" : `أب +${toArabicDigits(idx)}`,
              }),
            ]
          )
        );
      });
      col.appendChild(list);
      return col;
    }

    const lcaFather = res.lca.parentId ? DATA.nodesById[res.lca.parentId] : null;
    const lcaCol = el("div", { className: "kin-bridge-col kin-lca-col" }, [
      el("span", { className: "lca-crown", textContent: "✦ الجد الجامع ✦" }),
      el("h3", { className: "lca-name", textContent: res.lca.name }),
      el("p", {
        className: "hint-sub",
        textContent: lcaFather ? `ابن ${lcaFather.name} • فرع ${res.lca.branchName}` : "أعلى عمود النسب المدوّن",
      }),
      el("button", {
        type: "button",
        className: "btn btn-outline btn-xs",
        style: "margin-top:8px",
        textContent: "فتح بطاقة الجد الجامع",
        onClick: () => openProfileDrawer(res.lca.id),
      }),
    ]);

    card.appendChild(
      el("div", { className: "kin-bridge-grid" }, [
        buildLimbCol(`عمود نسب ${nodeA.name}`, res.pathA, res.dA),
        lcaCol,
        buildLimbCol(`عمود نسب ${nodeB.name}`, res.pathB, res.dB),
      ])
    );
  }

  function bindKinshipPicker(inputId, dropdownId, whichKey) {
    const input = document.getElementById(inputId);
    const dd = document.getElementById(dropdownId);

    function showMatches() {
      const q = input.value.trim();
      const hits = searchNodes(q || "عويض", 12);
      dd.textContent = "";
      if (!hits.length) {
        dd.appendChild(el("div", { className: "search-result-item", textContent: "لا توجد نتائج مطابقة" }));
      } else {
        for (const h of hits) {
          dd.appendChild(
            el(
              "div",
              {
                className: "search-result-item",
                onClick: () => {
                  state[whichKey] = h.node.id;
                  input.value = "";
                  dd.classList.add("hidden");
                  renderKinshipResult();
                },
              },
              [
                el("div", { className: "sr-main" }, [
                  el("div", { className: "sr-name", textContent: h.node.name }),
                  el("div", { className: "sr-lineage", textContent: h.shortLineage }),
                ]),
                el("span", {
                  className: "sr-branch-tag",
                  style: `background:${getBranchColor(h.node.branchId)}`,
                  textContent: h.node.branchName,
                }),
              ]
            )
          );
        }
      }
      dd.classList.remove("hidden");
    }

    input.addEventListener("input", showMatches);
    input.addEventListener("focus", showMatches);
    document.addEventListener("click", (ev) => {
      if (!ev.target.closest(`#${inputId}`) && !ev.target.closest(`#${dropdownId}`)) {
        dd.classList.add("hidden");
      }
    });
  }

  // -------------------- View 5: Live Census Analytics --------------------

  function renderAnalytics() {
    const maxBranchTotal = Math.max(...DATA.branchStats.map((b) => b.totalInBranch));
    const maxDescGen = Math.max(...DATA.branchStats.map((b) => b.maxGeneration));
    const deepestBranchNames = DATA.branchStats
      .filter((b) => b.maxGeneration === maxDescGen)
      .map((b) => b.name)
      .join(" و");

    const kpis = [
      {
        val: toArabicDigits(DATA.meta.totalNodes),
        label: "إجمالي الأسماء المدوّنة",
        sub: `${toArabicDigits(DATA.meta.descendantsOfUwaid)} ذرية + عويض + ${toArabicDigits(DATA.meta.ancestorsCount)} أجداد`,
      },
      {
        val: toArabicDigits(DATA.meta.branchesCount),
        label: "الفروع الرئيسية من عويض",
        sub: "قليشان • مضيان • دهران • دغيليب • سمران • ثويني • جرار • ماضي",
      },
      {
        val: toArabicDigits(maxDescGen),
        label: "أعمق امتداد للأجيال",
        sub: `يبلغ أقصاه ${toArabicDigits(maxDescGen)} أجيال متصلة في فرع ${deepestBranchNames}`,
      },
      {
        val: toArabicDigits(ALL_NODES.filter((n) => n.bioNote).length),
        label: "توثيقات وملاحظات خاصة",
        sub: "حالات موثقة بملاحظات نسبية وتاريخية",
      },
    ];

    const kpiGrid = document.getElementById("analytics-kpis");
    kpiGrid.textContent = "";
    for (const k of kpis) {
      kpiGrid.appendChild(
        el("div", { className: "kpi-card" }, [
          el("div", { className: "kpi-val", textContent: k.val }),
          el("div", { className: "kpi-label", textContent: k.label }),
          el("div", { className: "kpi-sub", textContent: k.sub }),
        ])
      );
    }

    // Sort branches largest first
    const sortedBranches = [...DATA.branchStats].sort((a, b) => b.totalInBranch - a.totalInBranch);
    const branchWrap = document.getElementById("branch-bars-container");
    branchWrap.textContent = "";
    for (const bs of sortedBranches) {
      const pct = Math.max(2.5, (bs.totalInBranch / maxBranchTotal) * 100);
      branchWrap.appendChild(
        el(
          "div",
          {
            className: "bar-row",
            title: `اضغط لفتح فرع ${bs.name} في الشجرة`,
            onClick: () => focusBranchInTree(bs.branchId),
          },
          [
            el("span", { className: "bar-label", textContent: bs.name }),
            el("div", { className: "bar-track" }, [
              el("div", {
                className: "bar-fill",
                style: `width:${pct.toFixed(1)}%;background:${getBranchColor(bs.branchId)}`,
              }),
            ]),
            el("span", { className: "bar-count", textContent: `${toArabicDigits(bs.totalInBranch)} اسماً` }),
          ]
        )
      );
    }

    // Generation counts
    const genMap = new Map();
    for (const n of ALL_NODES) {
      const key = n.generation < 0 ? "ANC" : n.generation;
      genMap.set(key, (genMap.get(key) || 0) + 1);
    }
    const genRows = [{ key: "ANC", label: "عمود النسب" }];
    for (let g = 0; g <= 8; g++) {
      genRows.push({ key: g, label: g === 0 ? "الجد عويض" : `الجيل ${toArabicDigits(g)}` });
    }
    const maxGenCnt = Math.max(...genRows.map((r) => genMap.get(r.key) || 0));

    const genWrap = document.getElementById("generation-bars-container");
    genWrap.textContent = "";
    for (const row of genRows) {
      const cnt = genMap.get(row.key) || 0;
      const pct = Math.max(2, (cnt / maxGenCnt) * 100);
      genWrap.appendChild(
        el(
          "div",
          {
            className: "bar-row",
            onClick: () => {
              document.getElementById("dir-gen-select").value = String(row.key);
              document.getElementById("dir-branch-select").value = "ALL";
              document.getElementById("dir-query-input").value = "";
              switchView("directory");
            },
          },
          [
            el("span", { className: "bar-label", textContent: row.label }),
            el("div", { className: "bar-track" }, [
              el("div", {
                className: "bar-fill",
                style: `width:${pct.toFixed(1)}%;background:linear-gradient(90deg, #12372A, #C59B43)`,
              }),
            ]),
            el("span", { className: "bar-count", textContent: `${toArabicDigits(cnt)}` }),
          ]
        )
      );
    }

    // Most common given names among Uwaid descendants
    const nameFreq = new Map();
    for (const n of ALL_NODES) {
      if (n.generation < 1) continue;
      nameFreq.set(n.name, (nameFreq.get(n.name) || 0) + 1);
    }
    const topNames = [...nameFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
    const chipsWrap = document.getElementById("top-names-chips");
    chipsWrap.textContent = "";
    for (const [name, cnt] of topNames) {
      chipsWrap.appendChild(
        el(
          "button",
          {
            type: "button",
            className: "name-freq-chip",
            onClick: () => {
              document.getElementById("dir-query-input").value = name;
              document.getElementById("dir-branch-select").value = "ALL";
              document.getElementById("dir-gen-select").value = "ALL";
              switchView("directory");
            },
          },
          [el("span", { textContent: name }), el("span", { className: "freq-num", textContent: toArabicDigits(cnt) })]
        )
      );
    }
  }

  // -------------------- Slide-Over Profile Drawer --------------------

  function openProfileDrawer(nodeId) {
    const node = DATA.nodesById[nodeId];
    if (!node) return;
    state.drawerNodeId = nodeId;
    renderProfileDrawer();
    const drawer = document.getElementById("profile-drawer");
    drawer.style.transform = "";
    drawer.style.transition = "";
    document.getElementById("drawer-backdrop").classList.remove("hidden");
    drawer.classList.remove("hidden");
  }

  function closeProfileDrawer() {
    const drawer = document.getElementById("profile-drawer");
    drawer.style.transform = "";
    drawer.style.transition = "";
    document.getElementById("drawer-backdrop").classList.add("hidden");
    drawer.classList.add("hidden");
  }

  function setupDrawerSwipeDismiss() {
    const drawer = document.getElementById("profile-drawer");
    const handles = [document.getElementById("drawer-grab-bar"), document.getElementById("drawer-drag-handle")];
    let startY = null;
    let currentDy = 0;

    function onStart(ev) {
      if (window.innerWidth > 760 || !ev.touches || !ev.touches.length) return;
      startY = ev.touches[0].clientY;
      currentDy = 0;
      drawer.style.transition = "none";
    }

    function onMove(ev) {
      if (startY === null || !ev.touches || !ev.touches.length) return;
      const dy = ev.touches[0].clientY - startY;
      if (dy > 0) {
        currentDy = dy;
        drawer.style.transform = `translateY(${dy}px)`;
      }
    }

    function onEnd() {
      if (startY === null) return;
      startY = null;
      if (currentDy > 75) {
        drawer.style.transition = "transform 0.18s ease-out";
        drawer.style.transform = "translateY(100%)";
        setTimeout(closeProfileDrawer, 170);
      } else {
        drawer.style.transition = "transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)";
        drawer.style.transform = "translateY(0)";
      }
      currentDy = 0;
    }

    for (const h of handles) {
      if (!h) continue;
      h.addEventListener("touchstart", onStart, { passive: true });
      h.addEventListener("touchmove", onMove, { passive: true });
      h.addEventListener("touchend", onEnd, { passive: true });
      h.addEventListener("touchcancel", onEnd, { passive: true });
    }
  }

  function renderProfileDrawer() {
    const node = DATA.nodesById[state.drawerNodeId];
    if (!node) return;

    const badge = document.getElementById("drawer-branch-badge");
    badge.textContent =
      node.branchId === "ANC"
        ? "عمود النسب القبلي"
        : node.branchId === "ROOT"
        ? "مؤسس الفخذ"
        : `فرع ${node.branchName}`;
    badge.style.background = getBranchColor(node.branchId);

    document.getElementById("drawer-person-name").textContent = node.name;
    const branchDesc =
      node.tier === "B"
        ? "أحد أبناء عويض الثمانية"
        : node.childrenCount > 0
        ? `فرع ممتد — ${toArabicDigits(node.descendantCount)} من الذرية`
        : `من رجالات فرع ${node.branchName}`;
    document.getElementById("drawer-tier-sub").textContent =
      node.generation < 0
        ? `الجد رقم ${toArabicDigits(Math.abs(node.generation))} قبل عويض`
        : node.generation === 0
        ? "الجد الجامع لفخذ ذوي عويض"
        : `الجيل ${toArabicDigits(node.generation)} من ذرية عويض • ${branchDesc}`;

    const bioBox = document.getElementById("drawer-bio-box");
    if (isBiosEnabled() && (node.bioNote || node.kunyah || node.isDeceased || node.birthYear || node.deathYear)) {
      const items = [];
      if (node.isDeceased) items.push(el("span", { className: "honorific-ar", textContent: "رحمه الله" }));
      if (node.kunyah) items.push(`الكنية: ${node.kunyah}`);
      if (node.birthYear) items.push(`الميلاد: ${node.birthYear}`);
      if (node.deathYear) items.push(`الوفاة: ${node.deathYear}`);
      if (node.bioNote) items.push(node.bioNote);
      bioBox.textContent = "";
      bioBox.appendChild(document.createTextNode("توثيق وملاحظة: "));
      items.forEach((it, idx) => {
        if (idx > 0) bioBox.appendChild(document.createTextNode(" • "));
        bioBox.appendChild(typeof it === "string" ? document.createTextNode(it) : it);
      });
      bioBox.classList.remove("hidden");
    } else {
      bioBox.classList.add("hidden");
    }

    const toggleLineageBtn = document.getElementById("drawer-toggle-full-lineage");
    toggleLineageBtn.textContent = state.drawerFullLineage ? "إظهار حتى عويض فقط" : "إظهار حتى قحطان";
    toggleLineageBtn.classList.toggle("hidden", node.generation < 0);

    const showFull = state.drawerFullLineage || node.generation < 0;
    const chain = getAncestorChain(node.id, showFull);
    const chipsWrap = document.getElementById("drawer-lineage-chips");
    chipsWrap.textContent = "";
    chain.forEach((item, idx) => {
      if (idx > 0) chipsWrap.appendChild(el("span", { className: "chain-sep", textContent: "←" }));
      chipsWrap.appendChild(
        el("button", {
          type: "button",
          className: `chain-chip${idx === 0 ? " is-self" : ""}`,
          textContent: item.name,
          onClick: () => openProfileDrawer(item.id),
        })
      );
    });

    document.getElementById("drawer-lineage-text").textContent = chain.map((c) => c.name).join(" بن ");

    // Immediate family (Father, Brothers, Sons)
    const famWrap = document.getElementById("drawer-family-blocks");
    famWrap.textContent = "";
    const father = node.parentId ? DATA.nodesById[node.parentId] : null;
    const brothers = father
      ? father.childrenIds.filter((cid) => cid !== node.id).map((cid) => DATA.nodesById[cid])
      : [];
    const sons = node.childrenIds.map((cid) => DATA.nodesById[cid]);

    function addFamGroup(title, members) {
      const grp = el("div", null, [el("div", { className: "fam-group-title", textContent: title })]);
      if (!members.length) {
        grp.appendChild(el("span", { className: "hint-sub", textContent: "لا يوجد مسجّل في هذه الخانة" }));
      } else {
        const wrap = el("div", { className: "fam-chips-wrap" });
        const biosOn = isBiosEnabled();
        for (const m of members) {
          const isDeceasedChip = biosOn && (m.isDeceased || (m.bioNote && m.bioNote.includes("لم يُعقب")));
          const chipChildren = isDeceasedChip
            ? [m.name + " (", el("span", { className: "honorific-ar", textContent: "رحمه الله" }), ")"]
            : [m.name];
          wrap.appendChild(
            el(
              "button",
              {
                type: "button",
                className: "fam-chip",
                onClick: () => openProfileDrawer(m.id),
              },
              chipChildren
            )
          );
        }
        grp.appendChild(wrap);
      }
      famWrap.appendChild(grp);
    }

    addFamGroup("الأب:", father ? [father] : []);
    addFamGroup(`الإخوة (${toArabicDigits(brothers.length)}):`, brothers);
    addFamGroup(`الأبناء (${toArabicDigits(sons.length)}):`, sons);
  }

  // -------------------- Pure-Canvas 1080x1350 Luxury Card & Poster Export --------------------

  const brandWordmarkImg = new Image();
  brandWordmarkImg.src = "assets/logo-wordmark-clean.svg";

  function drawCanvasBrandWordmark(ctx, cx, cy, maxW, maxH) {
    if (brandWordmarkImg.complete && brandWordmarkImg.naturalWidth > 0) {
      const ratio = Math.min(maxW / brandWordmarkImg.naturalWidth, maxH / brandWordmarkImg.naturalHeight);
      const dw = brandWordmarkImg.naturalWidth * ratio;
      const dh = brandWordmarkImg.naturalHeight * ratio;
      ctx.drawImage(brandWordmarkImg, cx - dw / 2, cy - dh / 2, dw, dh);
      return;
    }
    ctx.save();
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.fillStyle = "#C9A45A";
    ctx.font = 'bold 64px "Amiri", serif';
    ctx.fillText("ذوي عويض", cx, cy + 20);
    ctx.restore();
  }

  function wrapRtlText(ctx, text, maxWidth) {
    const words = text.split(" ");
    const lines = [];
    let current = "";
    for (const w of words) {
      const candidate = current ? `${current} ${w}` : w;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = w;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function downloadLineageCardPng(nodeId) {
    const node = DATA.nodesById[nodeId];
    if (!node) return;
    const canvas = document.getElementById("export-canvas");
    const W = 1080;
    const H = 1350;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    // Parchment background & luxury emerald border
    ctx.fillStyle = "#F8F4EC";
    ctx.fillRect(0, 0, W, H);

    // Subtle desert wave band at bottom
    ctx.fillStyle = "#E8DCC8";
    ctx.fill(new Path2D(`M 0 1110 C 300 1050 720 1160 ${W} 1090 L ${W} ${H} L 0 ${H} Z`));

    // Double royal frame
    ctx.strokeStyle = "#12372A";
    ctx.lineWidth = 18;
    ctx.strokeRect(26, 26, W - 52, H - 52);
    ctx.strokeStyle = "#C59B43";
    ctx.lineWidth = 4;
    ctx.strokeRect(46, 46, W - 92, H - 92);

    // Top emerald banner
    ctx.fillStyle = "#12372A";
    ctx.fillRect(48, 48, W - 96, 250);

    drawCanvasBrandWordmark(ctx, W / 2, 173, 440, 200);

    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.fillStyle = "#9A7426";
    ctx.font = 'bold 30px "Amiri", serif';
    ctx.fillText("بطاقة نسب موثّقة • ذوي عويض", W / 2, 360);

    ctx.fillStyle = "#5A554C";
    ctx.font = 'bold 26px "Amiri", serif';
    ctx.fillText("من البصصة قبيلة الشدادين بني الحارث", W / 2, 405);

    // Member main name
    ctx.fillStyle = "#12372A";
    ctx.font = 'bold 84px "Amiri", serif';
    ctx.fillText(node.name, W / 2, 525);

    // Branch pill
    const pillText =
      node.branchId === "ANC"
        ? "عمود النسب القبلي"
        : node.branchId === "ROOT"
        ? "الجد الجامع لذوي عويض"
        : `فرع ${node.branchName} • الجيل ${toArabicDigits(node.generation)}`;
    ctx.fillStyle = getBranchColor(node.branchId);
    ctx.beginPath();
    ctx.roundRect(W / 2 - 220, 565, 440, 54, 27);
    ctx.fill();
    ctx.fillStyle = "#FFFDF8";
    ctx.font = 'bold 26px "Tajawal", sans-serif';
    ctx.fillText(pillText, W / 2, 601);

    // Full lineage section
    ctx.fillStyle = "#9A7426";
    ctx.font = 'bold 26px "Tajawal", sans-serif';
    ctx.fillText("عمود النسب المتّصل", W / 2, 690);

    const lineageFull = formatLineageSentence(node.id, true);
    ctx.fillStyle = "#1C1B18";
    ctx.font = '700 32px "Tajawal", sans-serif';
    const lines = wrapRtlText(ctx, lineageFull, 860);
    lines.forEach((line, i) => {
      ctx.fillText(line, W / 2, 748 + i * 52);
    });

    let yCursor = 748 + lines.length * 52 + 40;
    if (node.bioNote) {
      ctx.fillStyle = "#12372A";
      ctx.font = 'bold 26px "Tajawal", sans-serif';
      const noteLines = wrapRtlText(ctx, `ملاحظة: ${node.bioNote}`, 840);
      noteLines.forEach((nl, i) => {
        ctx.fillText(nl, W / 2, yCursor + i * 40);
      });
      yCursor += noteLines.length * 40 + 25;
    }

    // Sons summary if applicable
    if (node.childrenCount > 0) {
      const sonsText = `الأبناء (${toArabicDigits(node.childrenCount)}): ${node.childrenIds
        .map((cid) => DATA.nodesById[cid].name)
        .join("، ")}`;
      ctx.fillStyle = "#5A554C";
      ctx.font = '500 25px "Tajawal", sans-serif';
      const sonLines = wrapRtlText(ctx, sonsText, 860).slice(0, 3);
      sonLines.forEach((sl, i) => {
        ctx.fillText(sl, W / 2, yCursor + i * 38);
      });
    }

    // Footer edition stamp
    ctx.fillStyle = "#12372A";
    ctx.font = 'bold 23px "Tajawal", sans-serif';
    ctx.fillText(DATA.meta.editionLabel, W / 2, H - 102);

    const filename = `بطاقة_نسب_${node.name.replace(/\s+/g, "_")}.png`;
    canvas.toBlob(async (blob) => {
      if (!blob) {
        const a = document.createElement("a");
        a.download = filename;
        a.href = canvas.toDataURL("image/png");
        a.click();
        showToast(`تم تنزيل بطاقة النسب للعضو: ${node.name}`);
        return;
      }

      const isMobile = window.matchMedia && window.matchMedia("(max-width: 760px)").matches;
      if (isMobile && navigator.share && navigator.canShare) {
        try {
          const pngFile = new File([blob], filename, { type: "image/png" });
          if (navigator.canShare({ files: [pngFile] })) {
            await navigator.share({
              files: [pngFile],
              title: `بطاقة نسب ${node.name} — ذوي عويض`,
            });
            showToast(`تمت مشاركة بطاقة النسب للعضو: ${node.name}`);
            return;
          }
        } catch (err) {
          if (err && err.name === "AbortError") return;
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.download = filename;
      a.href = url;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast(`تم تنزيل بطاقة النسب للعضو: ${node.name}`);
    }, "image/png");
  }

  function exportTreePosterPng() {
    if (!state.layoutPositions.size) return;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of state.layoutPositions.values()) {
      minX = Math.min(minX, p.x - p.w / 2);
      maxX = Math.max(maxX, p.x + p.w / 2);
      minY = Math.min(minY, p.y - p.h / 2);
      maxY = Math.max(maxY, p.y + p.h / 2 + 24);
    }

    const pad = 80;
    const headerH = 190;
    const footerH = 70;
    const treeW = Math.max(900, maxX - minX + pad * 2);
    const treeH = Math.max(500, maxY - minY + pad * 2);
    const scale = treeW > 2800 ? 1 : 1.4;
    const W = Math.round(treeW * scale);
    const H = Math.round((treeH + headerH + footerH) * scale);

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#F8F4EC";
    ctx.fillRect(0, 0, W, H);
    ctx.scale(scale, scale);

    // Header strip
    ctx.fillStyle = "#12372A";
    ctx.fillRect(0, 0, treeW, headerH);
    drawCanvasBrandWordmark(ctx, treeW - 190, 95, 290, 130);

    ctx.direction = "rtl";
    ctx.textAlign = "right";
    ctx.fillStyle = "#FFFDF8";
    ctx.font = 'bold 46px "Amiri", serif';
    ctx.fillText("شجرة ذوي عويض — من البصصة قبيلة الشدادين بني الحارث", treeW - 365, 88);
    ctx.fillStyle = "#E2BE6E";
    ctx.font = '700 22px "Tajawal", sans-serif';
    ctx.fillText(DATA.meta.editionLabel, treeW - 365, 134);

    const offX = treeW / 2 - (minX + maxX) / 2;
    const offY = headerH + pad - minY;

    // Edges
    ctx.strokeStyle = "#C9B38C";
    ctx.lineWidth = 2;
    for (const [id, p] of state.layoutPositions.entries()) {
      if (!p.node.parentId || !state.layoutPositions.has(p.node.parentId)) continue;
      const parentP = state.layoutPositions.get(p.node.parentId);
      const x1 = parentP.x + offX;
      const y1 = parentP.y + parentP.h / 2 + offY;
      const x2 = p.x + offX;
      const y2 = p.y - p.h / 2 + offY;
      const midY = (y1 + y2) / 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(x1, midY, x2, midY, x2, y2);
      ctx.stroke();
    }

    // Nodes
    ctx.textAlign = "center";
    for (const [, p] of state.layoutPositions.entries()) {
      const cx = p.x + offX;
      const cy = p.y + offY;
      const isRootNode = p.node.id === "R00" || p.node.branchId === "ROOT";
      const col = getBranchColor(p.node.branchId);
      ctx.fillStyle = isRootNode ? "#12372A" : "#FFFDF8";
      ctx.strokeStyle = isRootNode ? "#C59B43" : col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(cx - p.w / 2, cy - p.h / 2, p.w, p.h, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isRootNode ? "#FFFDF8" : "#1C1B18";
      ctx.font = isRootNode ? 'bold 17px "Amiri", serif' : 'bold 13px "Tajawal", sans-serif';
      ctx.fillText(p.node.name, cx, cy + 5);
    }

    const a = document.createElement("a");
    a.download = "شجرة_ذوي_عويض_المصدّرة.png";
    a.href = canvas.toDataURL("image/png");
    a.click();
    showToast("تم تصدير صورة الشجرة الحالية بصيغة PNG بنجاح.");
  }

  // -------------------- Community Update Requests Modal --------------------

  function loadSavedRequests() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_REQ_KEY) || "[]");
    } catch (_) {
      return [];
    }
  }

  function saveRequests(list) {
    localStorage.setItem(STORAGE_REQ_KEY, JSON.stringify(list));
  }

  function renderSavedRequests() {
    const list = loadSavedRequests();
    document.getElementById("saved-requests-count").textContent = toArabicDigits(list.length);
    const wrap = document.getElementById("saved-requests-list");
    wrap.textContent = "";
    if (!list.length) {
      wrap.appendChild(
        el("p", {
          className: "hint-sub",
          textContent: "لا توجد طلبات محفوظة حالياً. استخدم النموذج أعلاه لإضافة مولود أو ملاحظة.",
        })
      );
      return;
    }
    for (const item of list) {
      wrap.appendChild(
        el("div", { className: "saved-req-item" }, [
          el("div", null, [
            el("strong", { textContent: `${item.type} — ${item.branch}` }),
            el("span", { className: "hint-sub", textContent: ` • ${item.date}` }),
            el("span", {
              className: "hint-sub",
              textContent: item.synced ? " • تم الإرسال لقاعدة البيانات" : " • محفوظ محلياً",
            }),
          ]),
          el("div", {
            textContent: `المعني: ${item.target} | الإضافة/التعديل: ${item.newName}${item.submitter ? ` | مقدم الطلب: ${item.submitter}` : ""}`,
          }),
          item.notes ? el("div", { className: "hint-sub", textContent: `ملاحظة: ${item.notes}` }) : null,
        ])
      );
    }
  }

  function bindTreeAutocomplete(inputEl, ddEl, onPick) {
    if (!inputEl || !ddEl) return;
    function showMatches() {
      const q = inputEl.value.trim();
      if (q.length < 1) {
        ddEl.classList.add("hidden");
        return;
      }
      const hits = searchNodes(q, 14).filter((h) => h.node.generation >= 1);
      ddEl.textContent = "";
      if (!hits.length) {
        ddEl.appendChild(el("div", { className: "search-result-item", textContent: "لا توجد نتائج مطابقة" }));
      } else {
        for (const h of hits) {
          ddEl.appendChild(
            el(
              "div",
              {
                className: "search-result-item",
                onClick: () => {
                  ddEl.classList.add("hidden");
                  onPick(h.node);
                },
              },
              [
                el("div", { className: "sr-main" }, [
                  el("div", { className: "sr-name", textContent: h.node.name }),
                  el("div", { className: "sr-lineage", textContent: h.shortLineage }),
                ]),
                el("span", {
                  className: "sr-branch-tag",
                  style: `background:${getBranchColor(h.node.branchId)}`,
                  textContent: h.node.branchName,
                }),
              ]
            )
          );
        }
      }
      ddEl.classList.remove("hidden");
    }
    inputEl.addEventListener("input", showMatches);
    inputEl.addEventListener("focus", () => {
      if (inputEl.value.trim()) showMatches();
    });
  }

  function bindUpdateTargetPicker() {
    const input = document.getElementById("req-target-person");
    const dd = document.getElementById("req-target-dropdown");
    const branchSel = document.getElementById("req-branch");
    if (!input || !dd) return;

    bindTreeAutocomplete(input, dd, (node) => {
      const label = formatLineageSentence(node.id, false).split(" بن ").slice(0, 3).join(" بن ");
      state.prefillTargetNodeId = node.id;
      state.prefillTargetLabel = label;
      input.value = label;
      if (branchSel) {
        for (const opt of branchSel.options) {
          if (opt.value === node.branchName) {
            branchSel.value = opt.value;
            break;
          }
        }
      }
    });

    input.addEventListener("input", () => {
      if (state.prefillTargetLabel && input.value.trim() !== state.prefillTargetLabel) {
        state.prefillTargetNodeId = null;
        state.prefillTargetLabel = "";
      }
    });

    document.addEventListener("click", (ev) => {
      if (!ev.target.closest(".autocomplete-wrap")) {
        dd.classList.add("hidden");
        const ad1 = document.getElementById("auth-member-dropdown");
        const ad2 = document.getElementById("link-member-dropdown");
        if (ad1) ad1.classList.add("hidden");
        if (ad2) ad2.classList.add("hidden");
      }
    });
  }

  function setMemberAuthStatus(msg, isErr) {
    const box = document.getElementById("auth-portal-status");
    if (!box) return;
    if (!msg) {
      box.classList.add("hidden");
      box.classList.remove("is-error");
      box.textContent = "";
      return;
    }
    box.textContent = msg;
    box.classList.toggle("is-error", Boolean(isErr));
    box.classList.remove("hidden");
  }

  function setUpdateGateStatus(msg, isErr) {
    const box = document.getElementById("member-auth-status");
    if (!box) return;
    if (!msg) {
      box.classList.add("hidden");
      box.classList.remove("is-error");
      box.textContent = "";
      return;
    }
    box.textContent = msg;
    box.classList.toggle("is-error", Boolean(isErr));
    box.classList.remove("hidden");
  }

  const CLOUD_STATUS_AR = { pending: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };

  async function renderCloudMyRequests() {
    const section = document.getElementById("cloud-my-requests-section");
    const wrap = document.getElementById("cloud-requests-list");
    const countEl = document.getElementById("cloud-requests-count");
    if (!section || !wrap || !window.DHAWI_UWAID_DB) return;

    const rows = await window.DHAWI_UWAID_DB.fetchMyUpdateRequests();
    if (!state.memberProfile && !rows.length) {
      section.classList.add("hidden");
      return;
    }
    section.classList.remove("hidden");
    if (countEl) countEl.textContent = toArabicDigits(rows.length);
    wrap.textContent = "";
    if (!rows.length) {
      wrap.appendChild(
        el("p", {
          className: "hint-sub",
          textContent: "لم ترسل أي طلبات مسجّلة على هذا الحساب بعد.",
        })
      );
      return;
    }
    for (const r of rows) {
      const dt = r.created_at
        ? new Date(r.created_at).toLocaleDateString("ar-SA-u-ca-gregory")
        : "";
      wrap.appendChild(
        el("div", { className: "saved-req-item" }, [
          el("div", null, [
            el("strong", { textContent: `${r.request_type} — ${r.branch_name}` }),
            el("span", {
              className: `cloud-req-pill ${r.status || "pending"}`,
              textContent: CLOUD_STATUS_AR[r.status] || r.status,
            }),
            dt ? el("span", { className: "hint-sub", textContent: ` • ${dt}` }) : null,
          ]),
          el("div", {
            textContent: `المعني: ${r.target_person} | الإضافة/التعديل: ${r.new_name}`,
          }),
          r.review_note
            ? el("div", { className: "hint-sub", textContent: `ملاحظة المراجع: ${r.review_note}` })
            : null,
        ])
      );
    }
  }

  const PERM_LABELS_AR = {
    review: "مراجعة الطلبات",
    add: "إضافة أسماء",
    edit: "تعديل الأسماء والسير",
    del: "حذف أسماء",
    brand: "الهوية والورق الرسمي",
    audit: "سجل التعديلات",
    backup: "النسخة الاحتياطية",
  };

  function getShortAccountName(ctx) {
    if (!ctx || !ctx.signedIn) return "دخول / تسجيل";
    if (ctx.adminRow && ctx.adminRow.display_name) return ctx.adminRow.display_name;
    if (ctx.memberProfile && ctx.memberProfile.member_full_lineage) {
      return ctx.memberProfile.member_full_lineage.split(" بن ").slice(0, 2).join(" بن ");
    }
    const email = (ctx.user && ctx.user.email) || "";
    return email.split("@")[0] || "حسابي";
  }

  function renderAuthPortalHub(ctx) {
    const hub = document.getElementById("auth-portal-hub");
    if (!hub) return;
    const roleBadge = document.getElementById("auth-hub-role-badge");
    const nameEl = document.getElementById("auth-hub-name");
    const lineageEl = document.getElementById("auth-hub-lineage");
    const emailEl = document.getElementById("auth-hub-email");
    const permsEl = document.getElementById("auth-hub-perms");
    const adminBtn = document.getElementById("auth-hub-admin-btn");
    const locateBtn = document.getElementById("auth-hub-locate-btn");

    const isOwner = ctx.role === "owner";
    const isMod = ctx.role === "moderator";
    const isAdmin = isOwner || isMod;

    if (roleBadge) {
      roleBadge.className = "auth-role-badge " + (isOwner ? "is-owner" : isMod ? "is-moderator" : "is-member");
      roleBadge.textContent = isOwner ? "مدير النظام (حساب وحيد)" : isMod ? "منسّق ومشرف" : "عضو موثّق في الشجرة";
    }

    if (nameEl) {
      nameEl.textContent = getShortAccountName(ctx);
    }
    if (lineageEl) {
      lineageEl.textContent =
        (ctx.memberProfile && ctx.memberProfile.member_full_lineage) ||
        (isAdmin ? "مرتبط بحساب الإدارة" : "");
      lineageEl.classList.toggle("hidden", !lineageEl.textContent);
    }
    if (emailEl) {
      emailEl.textContent = (ctx.user && ctx.user.email) || "";
    }

    if (permsEl) {
      permsEl.textContent = "";
      if (isOwner) {
        permsEl.classList.remove("hidden");
        permsEl.appendChild(el("span", { className: "auth-perm-chip is-owner", textContent: "كامل صلاحيات إدارة المنصة والأعضاء" }));
      } else if (isMod) {
        permsEl.classList.remove("hidden");
        const activePerms = Object.entries(PERM_LABELS_AR)
          .filter(([k]) => Boolean(ctx.perms && ctx.perms[k]))
          .map(([, label]) => label);
        if (activePerms.length) {
          for (const lbl of activePerms) {
            permsEl.appendChild(el("span", { className: "auth-perm-chip", textContent: lbl }));
          }
        } else {
          permsEl.appendChild(
            el("span", {
              className: "auth-perm-chip is-muted",
              textContent: "لا توجد صلاحيات مفعّلة حالياً — بانتظار تفعيلها من مدير النظام",
            })
          );
        }
      } else {
        permsEl.classList.add("hidden");
      }
    }

    if (adminBtn) adminBtn.classList.toggle("hidden", !isAdmin);
    if (locateBtn) locateBtn.classList.toggle("hidden", !(ctx.memberProfile && ctx.memberProfile.member_id));

    hub.classList.remove("hidden");
  }

  function updateTopbarAccountUi(ctx) {
    const portalBtn = document.getElementById("open-auth-portal-btn");
    const portalLbl = document.getElementById("open-auth-portal-label");
    const portalRole = document.getElementById("open-auth-portal-role");
    const portalCaret = document.getElementById("open-auth-portal-caret");
    const popName = document.getElementById("account-popover-name");
    const popRole = document.getElementById("account-popover-role");
    const popAdmin = document.getElementById("account-popover-admin-link");
    const mobAdmin = document.getElementById("mobile-menu-admin-link");
    const mobAccSub = document.getElementById("mobile-menu-account-sub");

    const signedIn = Boolean(ctx && ctx.signedIn);
    const isOwner = Boolean(signedIn && ctx.role === "owner");
    const isMod = Boolean(signedIn && ctx.role === "moderator");
    const isAdmin = isOwner || isMod;

    if (!signedIn) {
      closeAccountPopover();
      if (portalLbl) portalLbl.textContent = "تسجيل الدخول";
      if (portalRole) portalRole.textContent = "";
      if (portalCaret) portalCaret.classList.add("hidden");
      if (portalBtn) {
        portalBtn.classList.remove("is-signed-in");
        portalBtn.setAttribute("aria-expanded", "false");
      }
      if (popAdmin) popAdmin.classList.add("hidden");
      if (mobAdmin) mobAdmin.classList.add("hidden");
      if (mobAccSub) mobAccSub.textContent = "تسجيل الدخول أو إنشاء حساب";
      return;
    }

    const shortName = getShortAccountName(ctx);
    const roleTag = isOwner ? "مدير النظام" : isMod ? "منسّق" : "عضو موثّق";

    if (portalLbl) portalLbl.textContent = shortName;
    if (portalRole) portalRole.textContent = isAdmin ? ` • ${roleTag}` : "";
    if (portalCaret) portalCaret.classList.remove("hidden");
    if (portalBtn) portalBtn.classList.add("is-signed-in");

    if (popName) popName.textContent = shortName;
    if (popRole) {
      popRole.className = "auth-role-badge " + (isOwner ? "is-owner" : isMod ? "is-moderator" : "is-member");
      popRole.textContent = roleTag;
    }
    if (popAdmin) popAdmin.classList.toggle("hidden", !isAdmin);
    if (mobAdmin) mobAdmin.classList.toggle("hidden", !isAdmin);
    if (mobAccSub) mobAccSub.textContent = `${shortName} (${roleTag})`;
  }

  async function renderAuthPortalState(ctx) {
    const portalModal = document.getElementById("auth-portal-modal");
    const authForms = document.getElementById("member-auth-forms");
    const linkForm = document.getElementById("member-link-form");
    const enrollBox = document.getElementById("member-mfa-enroll");
    const verifyBox = document.getElementById("member-mfa-verify");
    const hub = document.getElementById("auth-portal-hub");
    const nextNote = document.getElementById("auth-portal-next-note");
    if (!portalModal) return;

    const portalOpen = !portalModal.classList.contains("hidden");
    const hideAll = () => {
      if (authForms) authForms.classList.add("hidden");
      if (linkForm) linkForm.classList.add("hidden");
      if (enrollBox) enrollBox.classList.add("hidden");
      if (verifyBox) verifyBox.classList.add("hidden");
      if (hub) hub.classList.add("hidden");
    };

    hideAll();
    if (nextNote) nextNote.classList.toggle("hidden", state.authNext !== "admin");

    if (!ctx || !ctx.signedIn) {
      if (authForms) authForms.classList.remove("hidden");
      return;
    }

    const client = window.DHAWI_UWAID_DB && window.DHAWI_UWAID_DB.getAuthClient();
    const isAdmin = ctx.role === "owner" || ctx.role === "moderator";
    const reqMfa = DATA.meta ? DATA.meta.featureRequireMemberMfa !== false : true;

    if (!isAdmin && !ctx.memberProfile) {
      if (linkForm) linkForm.classList.remove("hidden");
      setMemberAuthStatus("الخطوة الأخيرة لإكمال تسجيلك: اختر اسمك الحقيقي من شجرة ذوي عويض وأدخل رقم جوالك لربطه بحسابك.", false);
      return;
    }

    if ((isAdmin || reqMfa) && ctx.aal !== "aal2" && client) {
      setMemberAuthStatus("", false);
      const { data: factors } = await client.auth.mfa.listFactors();
      const totp = (factors && factors.totp) || [];
      const verified = totp.find((f) => f.status === "verified");
      if (verified) {
        state.memberVerifyFactorId = verified.id;
        if (verifyBox) verifyBox.classList.remove("hidden");
      } else {
        for (const f of (factors && factors.all) || []) {
          if (f.status !== "verified") {
            await client.auth.mfa.unenroll({ factorId: f.id });
          }
        }
        const { data: enrolled, error: enrErr } = await client.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: isAdmin ? "Dhawi Uwaid Admin" : "Dhawi Uwaid Member",
        });
        if (enrErr) {
          setMemberAuthStatus("تعذّر تجهيز رمز التحقق الثنائي حالياً.", true);
          return;
        }
        state.memberEnrollFactorId = enrolled.id;
        const qrImg = document.getElementById("member-enroll-qr");
        const secEl = document.getElementById("member-enroll-secret");
        if (qrImg) qrImg.src = enrolled.totp.qr_code;
        if (secEl) secEl.textContent = enrolled.totp.secret;
        if (enrollBox) enrollBox.classList.remove("hidden");
      }
      return;
    }

    if (portalOpen && state.authNext === "admin") {
      state.authNext = null;
      if (nextNote) nextNote.classList.add("hidden");
      if (isAdmin) {
        window.location.href = "admin.html";
        return;
      }
      setMemberAuthStatus(
        "تم تسجيل دخولك كعضو في شجرة ذوي عويض. صلاحيات لوحة الإدارة تُفعَّل من قِبل مدير النظام عند اختيارك كمنسّق.",
        false
      );
      renderAuthPortalHub(ctx);
      return;
    }

    if (portalOpen && state.authReturnToUpdateModal) {
      const targetId = state.authReturnTargetNodeId || null;
      state.authReturnToUpdateModal = false;
      state.authReturnTargetNodeId = null;
      closeAuthPortal();
      openUpdateModal(targetId);
      return;
    }

    renderAuthPortalHub(ctx);
  }

  async function refreshAccountUi() {
    if (!window.DHAWI_UWAID_DB || typeof window.DHAWI_UWAID_DB.fetchMyAccountContext !== "function") {
      return null;
    }
    const client = window.DHAWI_UWAID_DB.getAuthClient();
    let ctx = await window.DHAWI_UWAID_DB.fetchMyAccountContext();

    if (ctx.signedIn && client) {
      if (!ctx.memberProfile) {
        const meta = (ctx.user && ctx.user.user_metadata) || {};
        const pendingMemberId = localStorage.getItem("dhawi_uwaid_pending_member_id") || meta.member_id || "";
        const rawPhone = localStorage.getItem("dhawi_uwaid_pending_phone") || meta.phone || "";
        const pendingPhone = String(rawPhone).replace(/[^0-9+]/g, "");
        if (pendingMemberId && DATA.nodesById[pendingMemberId] && pendingPhone.replace(/\D/g, "").length >= 8) {
          const { data: inserted, error: linkErr } = await client
            .from("member_profiles")
            .insert([{ user_id: ctx.user.id, member_id: pendingMemberId, phone: pendingPhone }])
            .select("member_id, member_full_lineage, branch_name, phone")
            .maybeSingle();
          if (!linkErr && inserted) {
            try {
              localStorage.removeItem("dhawi_uwaid_pending_member_id");
              localStorage.removeItem("dhawi_uwaid_pending_phone");
            } catch (_) {}
            ctx = await window.DHAWI_UWAID_DB.fetchMyAccountContext();
          }
        }
      }
    }

    state.account = ctx;
    state.memberProfile = ctx.memberProfile || null;
    updateTopbarAccountUi(ctx);
    await renderAuthPortalState(ctx);
    return ctx;
  }

  function openAuthPortal(options) {
    const opts = options || {};
    state.authNext = opts.next !== undefined ? opts.next : null;
    state.authReturnToUpdateModal = Boolean(opts.returnToUpdateModal);
    if (!state.authReturnToUpdateModal) {
      state.authReturnTargetNodeId = null;
    }
    if (opts.tab && typeof window.__duSwitchAuthTab === "function") {
      window.__duSwitchAuthTab(opts.tab);
    }
    setMemberAuthStatus("", false);
    const backdrop = document.getElementById("auth-portal-backdrop");
    const modal = document.getElementById("auth-portal-modal");
    if (backdrop) backdrop.classList.remove("hidden");
    if (modal) modal.classList.remove("hidden");
    refreshAccountUi();
  }

  function closeAuthPortal() {
    state.authReturnToUpdateModal = false;
    state.authReturnTargetNodeId = null;
    for (const id of ["auth-member-dropdown", "link-member-dropdown"]) {
      const dd = document.getElementById(id);
      if (dd) dd.classList.add("hidden");
    }
    const backdrop = document.getElementById("auth-portal-backdrop");
    const modal = document.getElementById("auth-portal-modal");
    if (backdrop) backdrop.classList.add("hidden");
    if (modal) modal.classList.add("hidden");
  }

  async function refreshUpdateModalAuth() {
    const gate = document.getElementById("member-auth-gate");
    const verifiedBar = document.getElementById("member-verified-bar");
    const form = document.getElementById("update-request-form");
    const ctaRow = document.getElementById("update-auth-cta-row");
    const cloudSection = document.getElementById("cloud-my-requests-section");
    if (!gate || !form) return;

    const reqAuth = DATA.meta ? DATA.meta.featureRequireMemberAuth !== false : true;
    const reqMfa = DATA.meta ? DATA.meta.featureRequireMemberMfa !== false : true;
    const schemaReady = Boolean(DATA.meta && DATA.meta.hasMemberSchema);

    if (!reqAuth) {
      gate.classList.add("hidden");
      if (verifiedBar) verifiedBar.classList.add("hidden");
      form.classList.remove("hidden");
      if (cloudSection) cloudSection.classList.add("hidden");
      setUpdateGateStatus("", false);
      return;
    }

    const client = window.DHAWI_UWAID_DB && window.DHAWI_UWAID_DB.getAuthClient();
    if (!client || !schemaReady) {
      gate.classList.remove("hidden");
      if (ctaRow) ctaRow.classList.add("hidden");
      if (verifiedBar) verifiedBar.classList.add("hidden");
      form.classList.remove("hidden");
      setUpdateGateStatus(
        "ميزة توثيق العضوية والتحقق الثنائي للطلبات بانتظار تشغيل التحديث الأمني في قاعدة البيانات من قِبل مدير النظام؛ لا يزال بإمكانك تجهيز الطلب وحفظه محلياً أو نسخه للواتساب.",
        false
      );
      return;
    }

    const ctx = await refreshAccountUi();
    if (!ctx || !ctx.signedIn) {
      gate.classList.remove("hidden");
      if (ctaRow) ctaRow.classList.remove("hidden");
      if (verifiedBar) verifiedBar.classList.add("hidden");
      form.classList.add("hidden");
      if (cloudSection) cloudSection.classList.add("hidden");
      setUpdateGateStatus("", false);
      return;
    }

    const isAdmin = ctx.role === "owner" || ctx.role === "moderator";
    const needsLink = !isAdmin && !ctx.memberProfile;
    const needsMfa = (isAdmin || reqMfa) && ctx.aal !== "aal2";

    if (needsLink || needsMfa) {
      gate.classList.remove("hidden");
      if (ctaRow) ctaRow.classList.remove("hidden");
      if (verifiedBar) verifiedBar.classList.add("hidden");
      form.classList.add("hidden");
      if (cloudSection) cloudSection.classList.add("hidden");
      setUpdateGateStatus(
        needsLink
          ? "حسابك مسجّل دخولاً — أكمل ربط اسمك في الشجرة عبر البوابة الموحّدة للمتابعة."
          : "حسابك بحاجة لإتمام التحقق الثنائي عبر البوابة الموحّدة للمتابعة.",
        false
      );
      return;
    }

    setUpdateGateStatus("", false);
    gate.classList.add("hidden");

    if (verifiedBar) {
      const displayLineage =
        (ctx.memberProfile && ctx.memberProfile.member_full_lineage) ||
        (ctx.adminRow && ctx.adminRow.display_name) ||
        "عضو موثّق";
      const roleEl = document.getElementById("member-verified-role");
      const admLink = document.getElementById("member-verified-admin-link");
      document.getElementById("member-verified-name").textContent = displayLineage;
      document.getElementById("member-verified-branch").textContent =
        ctx.memberProfile && ctx.memberProfile.branch_name ? `فرع ${ctx.memberProfile.branch_name}` : "";
      if (roleEl) {
        roleEl.className =
          "auth-role-badge " + (ctx.role === "owner" ? "is-owner" : ctx.role === "moderator" ? "is-moderator" : "is-member");
        roleEl.textContent = ctx.role === "owner" ? "مدير النظام" : ctx.role === "moderator" ? "منسّق" : "عضو موثّق";
        roleEl.classList.remove("hidden");
      }
      if (admLink) {
        admLink.classList.toggle("hidden", !isAdmin);
      }
      verifiedBar.classList.remove("hidden");
    }

    const subInput = document.getElementById("req-submitter");
    if (subInput && !subInput.value.trim()) {
      const defName =
        (ctx.memberProfile && ctx.memberProfile.member_full_lineage
          ? ctx.memberProfile.member_full_lineage.split(" بن ").slice(0, 3).join(" بن ")
          : "") ||
        (ctx.adminRow && ctx.adminRow.display_name) ||
        "";
      if (defName) subInput.value = defName;
    }

    form.classList.remove("hidden");
    await renderCloudMyRequests();
  }

  function cleanPhoneStr(raw) {
    return String(raw || "").replace(/[^0-9+]/g, "").slice(0, 24);
  }

  function countPhoneDigits(raw) {
    return String(raw || "").replace(/\D/g, "").length;
  }

  function translateAuthError(err) {
    const msg = String((err && (err.message || err.error_description)) || err || "");
    const low = msg.toLowerCase();
    if (low.includes("rate limit")) {
      return "تم بلوغ الحد المؤقت لإرسال رسائل تفعيل البريد من خادم سوبابيس (رسالتان كل ساعة في الباقة المجانية). أوقف خيار تأكيد البريد الإلكتروني في إعدادات سوبابيس أو اربط خادم بريد مخصّصاً.";
    }
    if (low.includes("already registered") || low.includes("already been registered")) {
      return "هذا البريد الإلكتروني مسجّل مسبقاً — انتقل إلى تبويب تسجيل الدخول.";
    }
    if (low.includes("invalid login credentials")) {
      return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
    }
    if (low.includes("email not confirmed")) {
      return "البريد الإلكتروني لم يُفعَّل بعد — افتح رسالة التفعيل في بريدك أو فعّل الحساب من لوحة سوبابيس.";
    }
    if (low.includes("password should be at least")) {
      return "كلمة المرور قصيرة جداً — أدخل ٦ أحرف على الأقل.";
    }
    if (low.includes("invalid email") || low.includes("unable to validate email")) {
      return "صيغة البريد الإلكتروني غير صحيحة.";
    }
    return "تعذّر إكمال العملية: " + (msg || "تأكد من البيانات المدخلة.");
  }

  function bindMemberAuthGate() {
    const tabIn = document.getElementById("auth-tab-signin");
    const tabUp = document.getElementById("auth-tab-signup");
    const fIn = document.getElementById("member-signin-form");
    const fUp = document.getElementById("member-signup-form");
    const fLink = document.getElementById("member-link-form");

    const switchAuthTab = (mode) => {
      const target = mode === "signup" ? "signup" : "signin";
      if (tabIn) {
        const on = target === "signin";
        tabIn.classList.toggle("active", on);
        tabIn.setAttribute("aria-selected", String(on));
      }
      if (tabUp) {
        const on = target === "signup";
        tabUp.classList.toggle("active", on);
        tabUp.setAttribute("aria-selected", String(on));
      }
      if (fIn) fIn.classList.toggle("hidden", target !== "signin");
      if (fUp) fUp.classList.toggle("hidden", target !== "signup");
      setMemberAuthStatus("", false);
    };
    window.__duSwitchAuthTab = switchAuthTab;

    if (tabIn) tabIn.addEventListener("click", () => switchAuthTab("signin"));
    if (tabUp) tabUp.addEventListener("click", () => switchAuthTab("signup"));

    function setupMemberIdentityPicker(inputId, ddId, pillId, stateKey) {
      const inp = document.getElementById(inputId);
      const dd = document.getElementById(ddId);
      const pill = document.getElementById(pillId);
      bindTreeAutocomplete(inp, dd, (node) => {
        state[stateKey] = node.id;
        if (inp) inp.value = "";
        if (pill) {
          pill.textContent = "";
          pill.appendChild(
            el("div", null, [
              el("strong", { textContent: formatLineageSentence(node.id, false) }),
              el("div", { className: "hint-sub", textContent: `فرع ${node.branchName} • الجيل ${toArabicDigits(node.generation)}` }),
            ])
          );
          pill.classList.remove("hidden");
        }
      });
    }

    setupMemberIdentityPicker("auth-member-search", "auth-member-dropdown", "auth-member-selected", "authSignupMemberId");
    setupMemberIdentityPicker("link-member-search", "link-member-dropdown", "link-member-selected", "authLinkMemberId");

    if (fIn) {
      fIn.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const client = window.DHAWI_UWAID_DB && window.DHAWI_UWAID_DB.getAuthClient();
        if (!client) return;
        const btn = document.getElementById("member-signin-btn");
        if (btn) btn.disabled = true;
        setMemberAuthStatus("", false);
        const { error } = await client.auth.signInWithPassword({
          email: document.getElementById("member-signin-email").value.trim(),
          password: document.getElementById("member-signin-password").value,
        });
        if (btn) btn.disabled = false;
        document.getElementById("member-signin-password").value = "";
        if (error) {
          setMemberAuthStatus(translateAuthError(error), true);
          return;
        }
        await refreshAccountUi();
      });
    }

    if (fUp) {
      fUp.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        if (!state.authSignupMemberId) {
          setMemberAuthStatus("يجب البحث عن اسمك واختياره من شجرة ذوي عويض أولاً.", true);
          return;
        }
        const rawPhone = cleanPhoneStr(document.getElementById("member-signup-phone")?.value);
        if (countPhoneDigits(rawPhone) < 8) {
          setMemberAuthStatus("رقم الجوال إجباري ويجب أن يكون صحيحاً (٨–١٦ رقماً).", true);
          return;
        }
        const client = window.DHAWI_UWAID_DB && window.DHAWI_UWAID_DB.getAuthClient();
        if (!client) return;
        const btn = document.getElementById("member-signup-btn");
        if (btn) btn.disabled = true;
        setMemberAuthStatus("", false);
        const email = document.getElementById("member-signup-email").value.trim();
        const password = document.getElementById("member-signup-password").value;
        const chosenId = state.authSignupMemberId;

        localStorage.setItem("dhawi_uwaid_pending_member_id", chosenId);
        localStorage.setItem("dhawi_uwaid_pending_phone", rawPhone);
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { data: { member_id: chosenId, phone: rawPhone } },
        });
        if (btn) btn.disabled = false;
        document.getElementById("member-signup-password").value = "";

        if (error) {
          setMemberAuthStatus(translateAuthError(error), true);
          return;
        }
        if (data && data.session && data.user) {
          await client.from("member_profiles").insert([{ user_id: data.user.id, member_id: chosenId, phone: rawPhone }]);
          localStorage.removeItem("dhawi_uwaid_pending_member_id");
          localStorage.removeItem("dhawi_uwaid_pending_phone");
          await refreshAccountUi();
          return;
        }
        switchAuthTab("signin");
        document.getElementById("member-signin-email").value = email;
        setMemberAuthStatus("تم تسجيل طلب حسابك! افتح بريدك الإلكتروني واضغط رابط التفعيل، ثم ادخل من هنا لتفعيل التحقق الثنائي.", false);
      });
    }

    if (fLink) {
      fLink.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        if (!state.authLinkMemberId) {
          setMemberAuthStatus("اختر اسمك من القائمة المنسدلة أولاً.", true);
          return;
        }
        const phone = cleanPhoneStr(document.getElementById("member-link-phone")?.value);
        if (countPhoneDigits(phone) < 8) {
          setMemberAuthStatus("أدخل رقم جوال صحيحاً (إجباري لإتمام التوثيق).", true);
          return;
        }
        const client = window.DHAWI_UWAID_DB && window.DHAWI_UWAID_DB.getAuthClient();
        if (!client) return;
        const { data: sess } = await client.auth.getSession();
        if (!sess || !sess.session) return;
        const { error } = await client
          .from("member_profiles")
          .insert([{ user_id: sess.session.user.id, member_id: state.authLinkMemberId, phone }]);
        if (error) {
          setMemberAuthStatus("تعذّر ربط الاسم المختار بالحساب، تأكد من اختيار أحد فروع ذوي عويض ومن صحة رقم الجوال.", true);
          return;
        }
        setMemberAuthStatus("", false);
        await refreshAccountUi();
      });
    }

    const enrollForm = document.getElementById("member-enroll-form");
    if (enrollForm) {
      enrollForm.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const client = window.DHAWI_UWAID_DB && window.DHAWI_UWAID_DB.getAuthClient();
        if (!client || !state.memberEnrollFactorId) return;
        const clean = document.getElementById("member-enroll-code").value.replace(/\D/g, "");
        if (clean.length !== 6) {
          setMemberAuthStatus("أدخل رمز التحقق المكوّن من ٦ أرقام.", true);
          return;
        }
        const { error } = await client.auth.mfa.challengeAndVerify({
          factorId: state.memberEnrollFactorId,
          code: clean,
        });
        document.getElementById("member-enroll-code").value = "";
        if (error) {
          setMemberAuthStatus("رمز التحقق غير صحيح — جرّب الرمز الحالي في تطبيق المصادقة.", true);
          return;
        }
        showToast("تم توثيق حسابك وتفعيل التحقق الثنائي بنجاح.");
        await refreshAccountUi();
      });
    }

    const verifyForm = document.getElementById("member-verify-form");
    if (verifyForm) {
      verifyForm.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const client = window.DHAWI_UWAID_DB && window.DHAWI_UWAID_DB.getAuthClient();
        if (!client || !state.memberVerifyFactorId) return;
        const clean = document.getElementById("member-verify-code").value.replace(/\D/g, "");
        if (clean.length !== 6) {
          setMemberAuthStatus("أدخل رمز التحقق المكوّن من ٦ أرقام.", true);
          return;
        }
        const { error } = await client.auth.mfa.challengeAndVerify({
          factorId: state.memberVerifyFactorId,
          code: clean,
        });
        document.getElementById("member-verify-code").value = "";
        if (error) {
          setMemberAuthStatus("رمز التحقق غير صحيح — تأكد من الرمز وحاول مرة أخرى.", true);
          return;
        }
        await refreshAccountUi();
      });
    }

    document.querySelectorAll(".member-logout-action").forEach((btn) => {
      btn.addEventListener("click", async () => {
        closeAccountPopover();
        closeMobileSheets();
        const client = window.DHAWI_UWAID_DB && window.DHAWI_UWAID_DB.getAuthClient();
        if (client) await client.auth.signOut();
        state.memberProfile = null;
        state.account = null;
        state.authNext = null;
        state.authReturnToUpdateModal = false;
        setMemberAuthStatus("", false);
        await refreshAccountUi();
        const updModal = document.getElementById("update-modal");
        if (updModal && !updModal.classList.contains("hidden")) {
          await refreshUpdateModalAuth();
        }
      });
    });

    const openAuthBtn = document.getElementById("open-auth-portal-btn");
    const accountPopover = document.getElementById("account-popover");
    if (openAuthBtn) {
      openAuthBtn.addEventListener("click", (ev) => {
        if (state.account && state.account.signedIn && accountPopover) {
          ev.stopPropagation();
          closeMobileSearch();
          closeMobileSheets();
          const kitPop = document.getElementById("brand-kit-popover");
          const kitBtn = document.getElementById("brand-kit-toggle");
          if (kitPop) kitPop.classList.add("hidden");
          if (kitBtn) kitBtn.setAttribute("aria-expanded", "false");
          const willOpen = accountPopover.classList.contains("hidden");
          accountPopover.classList.toggle("hidden", !willOpen);
          openAuthBtn.setAttribute("aria-expanded", String(willOpen));
        } else {
          openAuthPortal();
        }
      });
    }
    const accHubBtn = document.getElementById("account-popover-hub-btn");
    if (accHubBtn) {
      accHubBtn.addEventListener("click", () => {
        closeAccountPopover();
        openAuthPortal();
      });
    }
    document.addEventListener("click", (ev) => {
      if (!ev.target.closest("#account-menu-wrap")) {
        closeAccountPopover();
      }
    });

    const secTrigger = document.getElementById("mobile-sections-trigger");
    const moreTrigger = document.getElementById("mobile-more-trigger");
    const secClose = document.getElementById("mobile-sections-close");
    const moreClose = document.getElementById("mobile-more-close");
    const sheetBackdrop = document.getElementById("mobile-sheet-backdrop");
    if (secTrigger) secTrigger.addEventListener("click", () => toggleMobileSheet("sections"));
    if (moreTrigger) moreTrigger.addEventListener("click", () => toggleMobileSheet("more"));
    if (secClose) secClose.addEventListener("click", closeMobileSheets);
    if (moreClose) moreClose.addEventListener("click", closeMobileSheets);
    if (sheetBackdrop) sheetBackdrop.addEventListener("click", closeMobileSheets);

    document.querySelectorAll(".mobile-sheet-item[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
    const mobAddBtn = document.getElementById("mobile-add-trigger");
    if (mobAddBtn) {
      mobAddBtn.addEventListener("click", () => {
        closeMobileSearch();
        closeMobileSheets();
        openUpdateModal();
      });
    }
    const mobAccBtn = document.getElementById("mobile-menu-account-btn");
    if (mobAccBtn) {
      mobAccBtn.addEventListener("click", () => {
        closeMobileSheets();
        openAuthPortal();
      });
    }
    const mobThemeBtn = document.getElementById("mobile-menu-theme-btn");
    if (mobThemeBtn) {
      mobThemeBtn.addEventListener("click", () => {
        applyTheme(state.theme === "dark" ? "light" : "dark");
      });
    }
    const authCloseBtn = document.getElementById("auth-portal-close-btn");
    if (authCloseBtn) authCloseBtn.addEventListener("click", closeAuthPortal);
    const authBackdrop = document.getElementById("auth-portal-backdrop");
    if (authBackdrop) authBackdrop.addEventListener("click", closeAuthPortal);

    const updOpenAuthBtn = document.getElementById("update-open-auth-btn");
    if (updOpenAuthBtn) {
      updOpenAuthBtn.addEventListener("click", () => {
        state.authReturnTargetNodeId = state.prefillTargetNodeId || null;
        closeUpdateModal();
        openAuthPortal({ tab: "signin", returnToUpdateModal: true });
      });
    }

    const hubUpdateBtn = document.getElementById("auth-hub-update-btn");
    if (hubUpdateBtn) {
      hubUpdateBtn.addEventListener("click", () => {
        closeAuthPortal();
        openUpdateModal();
      });
    }

    const hubLocateBtn = document.getElementById("auth-hub-locate-btn");
    if (hubLocateBtn) {
      hubLocateBtn.addEventListener("click", () => {
        const memId = state.account && state.account.memberProfile && state.account.memberProfile.member_id;
        closeAuthPortal();
        if (memId && DATA.nodesById[memId]) {
          locateNodeInTree(memId);
          openProfileDrawer(memId);
        }
      });
    }

    const refCloudBtn = document.getElementById("refresh-cloud-requests-btn");
    if (refCloudBtn) refCloudBtn.addEventListener("click", renderCloudMyRequests);

    const authClient = window.DHAWI_UWAID_DB && window.DHAWI_UWAID_DB.getAuthClient();
    if (authClient) {
      authClient.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
          refreshAccountUi().then(() => {
            const updModal = document.getElementById("update-modal");
            if (updModal && !updModal.classList.contains("hidden")) {
              refreshUpdateModalAuth();
            }
          });
        }
      });
    }
  }

  function openUpdateModal(prefillNodeId) {
    state.prefillTargetNodeId = prefillNodeId && DATA.nodesById[prefillNodeId] ? prefillNodeId : null;
    if (state.prefillTargetNodeId) {
      const n = DATA.nodesById[state.prefillTargetNodeId];
      const lbl = formatLineageSentence(n.id, false)
        .split(" بن ")
        .slice(0, 3)
        .join(" بن ");
      state.prefillTargetLabel = lbl;
      document.getElementById("req-target-person").value = lbl;
      const bSel = document.getElementById("req-branch");
      for (const opt of bSel.options) {
        if (opt.value === n.branchName) {
          bSel.value = opt.value;
          break;
        }
      }
    } else {
      state.prefillTargetLabel = "";
    }
    syncBioFeatureUi();
    renderSavedRequests();
    refreshUpdateModalAuth();
    document.getElementById("modal-backdrop").classList.remove("hidden");
    document.getElementById("update-modal").classList.remove("hidden");
  }

  function closeUpdateModal() {
    state.prefillTargetNodeId = null;
    state.prefillTargetLabel = "";
    const dds = ["req-target-dropdown", "auth-member-dropdown", "link-member-dropdown"];
    for (const id of dds) {
      const dd = document.getElementById(id);
      if (dd) dd.classList.add("hidden");
    }
    document.getElementById("modal-backdrop").classList.add("hidden");
    document.getElementById("update-modal").classList.add("hidden");
  }

  // -------------------- Event Bindings & Init --------------------

  function bindGlobalSearch() {
    const wrap = document.getElementById("global-search-wrap");
    const input = document.getElementById("global-search-input");
    const clearBtn = document.getElementById("global-search-clear");
    const dd = document.getElementById("global-search-dropdown");
    const mobileTrigger = document.getElementById("mobile-search-trigger");
    const mobileClose = document.getElementById("mobile-search-close");

    function updateDropdown() {
      const q = input.value.trim();
      clearBtn.classList.toggle("hidden", !q);
      if (!q) {
        dd.classList.add("hidden");
        return;
      }
      const hits = searchNodes(q, 14);
      dd.textContent = "";
      if (!hits.length) {
        dd.appendChild(el("div", { className: "search-result-item", textContent: "لا توجد نتائج مطابقة لبحثك" }));
      } else {
        for (const h of hits) {
          dd.appendChild(
            el(
              "div",
              {
                className: "search-result-item",
                onClick: () => {
                  dd.classList.add("hidden");
                  closeMobileSearch();
                  locateNodeInTree(h.node.id);
                  openProfileDrawer(h.node.id);
                },
              },
              [
                el("div", { className: "sr-main" }, [
                  el("div", { className: "sr-name", textContent: h.node.name }),
                  el("div", { className: "sr-lineage", textContent: h.shortLineage }),
                ]),
                el("span", {
                  className: "sr-branch-tag",
                  style: `background:${getBranchColor(h.node.branchId)}`,
                  textContent: h.node.branchId === "ANC" ? "النسب" : h.node.branchName,
                }),
              ]
            )
          );
        }
      }
      dd.classList.remove("hidden");
    }

    input.addEventListener("input", updateDropdown);
    input.addEventListener("focus", updateDropdown);
    clearBtn.addEventListener("click", () => {
      input.value = "";
      updateDropdown();
      input.focus();
    });

    if (mobileTrigger && wrap) {
      mobileTrigger.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeMobileSheets();
        closeAccountPopover();
        const isOpen = wrap.classList.toggle("mobile-search-open");
        if (isOpen) {
          setTimeout(() => input.focus(), 40);
        } else {
          dd.classList.add("hidden");
        }
      });
    }
    if (mobileClose) {
      mobileClose.addEventListener("click", closeMobileSearch);
    }

    document.addEventListener("click", (ev) => {
      if (!ev.target.closest(".global-search-wrap") && !ev.target.closest("#mobile-search-trigger")) {
        dd.classList.add("hidden");
        closeMobileSearch();
      }
    });
  }

  function init() {
    applyTheme(state.theme);

    document.getElementById("edition-label-text").textContent = DATA.meta.editionLabel;
    document.getElementById("footer-edition-meta").textContent =
      `${toArabicDigits(DATA.meta.totalNodes)} اسماً موثقاً • ${DATA.meta.editionLabel}`;

    // Header controls
    document.getElementById("theme-toggle-btn").addEventListener("click", () => {
      applyTheme(state.theme === "dark" ? "light" : "dark");
    });

    document.getElementById("home-brand-btn").addEventListener("click", (ev) => {
      ev.preventDefault();
      state.highlightedIds.clear();
      state.activeBranchFilter = "ALL";
      state.expandedIds = new Set(["R00"]);
      renderBranchPills();
      switchView("tree");
    });

    const kitToggle = document.getElementById("brand-kit-toggle");
    const kitPopover = document.getElementById("brand-kit-popover");
    kitToggle.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const willOpen = kitPopover.classList.contains("hidden");
      kitPopover.classList.toggle("hidden", !willOpen);
      kitToggle.setAttribute("aria-expanded", String(willOpen));
    });
    document.addEventListener("click", (ev) => {
      if (!ev.target.closest("#brand-kit-menu")) {
        kitPopover.classList.add("hidden");
        kitToggle.setAttribute("aria-expanded", "false");
      }
    });

    // Main tab navigation (both desktop header tabs & mobile bottom tab bar)
    document.querySelectorAll(".tab-btn[data-view], .mobile-tab-btn[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });

    // Mobile tree secondary tools accordion toggle
    const treeToolbar = document.getElementById("tree-toolbar");
    const toolsToggle = document.getElementById("mobile-tree-tools-toggle");
    if (treeToolbar && toolsToggle) {
      toolsToggle.addEventListener("click", () => {
        const isOpen = treeToolbar.classList.toggle("mobile-tools-open");
        toolsToggle.setAttribute("aria-expanded", String(isOpen));
        toolsToggle.textContent = isOpen ? "أدوات ▴" : "أدوات ▾";
      });
    }

    // Touch swipe-down gesture for iOS bottom sheet drawer
    setupDrawerSwipeDismiss();

    // Subtle iOS Safari install prompt when browsing outside standalone Home Screen mode
    const iosBanner = document.getElementById("ios-install-banner");
    const iosDismiss = document.getElementById("ios-install-dismiss");
    if (iosBanner && iosDismiss) {
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const isStandalone =
        Boolean(window.navigator.standalone) ||
        (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
      if (isIos && !isStandalone && !localStorage.getItem("dhawi_uwaid_ios_tip_dismissed")) {
        iosBanner.classList.remove("hidden");
      }
      iosDismiss.addEventListener("click", () => {
        iosBanner.classList.add("hidden");
        localStorage.setItem("dhawi_uwaid_ios_tip_dismissed", "1");
      });
    }

    // Tree toolbar actions
    renderBranchPills();
    setupTreePanZoom();
    document.getElementById("toggle-ancestors-cb").addEventListener("change", (ev) => {
      state.showAncestors = ev.target.checked;
      renderTree();
    });
    document.getElementById("tree-expand-all-btn").addEventListener("click", expandAllInTree);
    document.getElementById("tree-reset-branches-btn").addEventListener("click", () => {
      state.activeBranchFilter = "ALL";
      state.highlightedIds.clear();
      state.expandedIds = new Set(["R00"]);
      renderBranchPills();
      renderTree();
    });
    document.getElementById("clear-highlight-btn").addEventListener("click", () => {
      state.highlightedIds.clear();
      state.highlightLabel = "";
      renderTree({ preserveView: true });
    });
    document.getElementById("tree-export-poster-btn").addEventListener("click", exportTreePosterPng);

    // Sunburst actions
    document.getElementById("sunburst-reset-btn").addEventListener("click", () => {
      state.sunburstRootId = "R00";
      state.sunburstInspectorId = "R00";
      renderSunburst();
    });
    document.getElementById("sb-open-drawer-btn").addEventListener("click", () => {
      openProfileDrawer(state.sunburstInspectorId || "R00");
    });
    document.getElementById("sb-jump-tree-btn").addEventListener("click", () => {
      locateNodeInTree(state.sunburstInspectorId || "R00");
    });

    // Directory
    populateDirectorySelects();
    ["dir-query-input", "dir-branch-select", "dir-gen-select", "dir-role-select"].forEach((id) => {
      document.getElementById(id).addEventListener("input", () => {
        state.directoryPageSize = 48;
        renderDirectory();
      });
      document.getElementById(id).addEventListener("change", () => {
        state.directoryPageSize = 48;
        renderDirectory();
      });
    });
    document.getElementById("dir-reset-filters-btn").addEventListener("click", () => {
      document.getElementById("dir-query-input").value = "";
      document.getElementById("dir-branch-select").value = "ALL";
      document.getElementById("dir-gen-select").value = "ALL";
      document.getElementById("dir-role-select").value = "all";
      state.directoryPageSize = 48;
      renderDirectory();
    });
    document.getElementById("dir-load-more-btn").addEventListener("click", () => {
      state.directoryPageSize += 48;
      renderDirectory();
    });

    // Kinship calculator
    bindKinshipPicker("kin-input-a", "kin-dropdown-a", "kinshipA");
    bindKinshipPicker("kin-input-b", "kin-dropdown-b", "kinshipB");
    document.getElementById("kin-swap-btn").addEventListener("click", () => {
      const tmp = state.kinshipA;
      state.kinshipA = state.kinshipB;
      state.kinshipB = tmp;
      renderKinshipResult();
    });
    document.querySelectorAll(".kinship-preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.kinshipA = btn.dataset.a;
        state.kinshipB = btn.dataset.b;
        renderKinshipResult();
      });
    });

    // Profile Drawer actions
    document.getElementById("drawer-close-btn").addEventListener("click", closeProfileDrawer);
    document.getElementById("drawer-backdrop").addEventListener("click", closeProfileDrawer);
    document.getElementById("drawer-toggle-full-lineage").addEventListener("click", () => {
      state.drawerFullLineage = !state.drawerFullLineage;
      renderProfileDrawer();
    });
    document.getElementById("drawer-copy-lineage-btn").addEventListener("click", async () => {
      const text = formatLineageSentence(state.drawerNodeId, true);
      try {
        await navigator.clipboard.writeText(text);
        showToast("تم نسخ سلسلة النسب كاملة.");
      } catch (_) {
        showToast(text);
      }
    });
    document.getElementById("drawer-locate-tree-btn").addEventListener("click", () => {
      const targetId = state.drawerNodeId;
      closeProfileDrawer();
      locateNodeInTree(targetId);
    });
    document.getElementById("drawer-kinship-btn").addEventListener("click", () => {
      state.kinshipA = state.drawerNodeId;
      closeProfileDrawer();
      switchView("kinship");
    });
    document.getElementById("drawer-download-card-btn").addEventListener("click", () => {
      downloadLineageCardPng(state.drawerNodeId);
    });
    const drawerShareBtn = document.getElementById("drawer-share-link-btn");
    if (drawerShareBtn) {
      drawerShareBtn.addEventListener("click", () => {
        const node = DATA.nodesById[state.drawerNodeId];
        if (!node) return;
        const shareUrl = `${window.location.origin}${window.location.pathname}?person=${encodeURIComponent(node.id)}`;
        const full = formatLineageSentence(node.id, false) || node.name;
        shareOrCopyLink(
          shareUrl,
          `${node.name} — شجرة ذوي عويض`,
          `بطاقة نسب ${full} في منصة شجرة ذوي عويض`,
          "تم نسخ رابط العضو للمشاركة."
        );
      });
    }
    document.getElementById("drawer-suggest-edit-btn").addEventListener("click", () => {
      const targetId = state.drawerNodeId;
      closeProfileDrawer();
      openUpdateModal(targetId);
    });

    bindUpdateTargetPicker();
    bindMemberAuthGate();
    syncBioFeatureUi();

    // Update Requests Modal
    document.getElementById("open-update-modal-btn").addEventListener("click", () => openUpdateModal());
    document.getElementById("modal-close-btn").addEventListener("click", closeUpdateModal);
    document.getElementById("modal-backdrop").addEventListener("click", closeUpdateModal);

    document.getElementById("update-request-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const formEl = ev.target;
      const submitBtn = formEl.querySelector('button[type="submit"]');
      const originalBtnText = submitBtn ? submitBtn.textContent : "";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "جارٍ الإرسال...";
      }

      const entry = {
        type: document.getElementById("req-type").value,
        branch: document.getElementById("req-branch").value,
        target: document.getElementById("req-target-person").value.trim(),
        targetNodeId: state.prefillTargetNodeId || null,
        newName: document.getElementById("req-new-name").value.trim(),
        submitter: document.getElementById("req-submitter").value.trim(),
        notes: document.getElementById("req-notes").value.trim(),
        date: new Date().toLocaleDateString("ar-SA"),
        synced: false,
      };

      try {
        if (window.DHAWI_UWAID_DB && typeof window.DHAWI_UWAID_DB.submitUpdateRequest === "function") {
          const res = await window.DHAWI_UWAID_DB.submitUpdateRequest(entry);
          entry.synced = Boolean(res && res.synced);
        }
      } catch (_) {
        entry.synced = false;
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalBtnText;
        }
      }

      const list = loadSavedRequests();
      list.unshift(entry);
      saveRequests(list);
      renderSavedRequests();
      if (entry.synced) renderCloudMyRequests();
      formEl.reset();
      state.prefillTargetNodeId = null;
      state.prefillTargetLabel = "";
      showToast(
        entry.synced
          ? "تم إرسال الطلب إلى قاعدة بيانات ذوي عويض وحفظ نسخة محلية للمتابعة."
          : "تم حفظ الطلب محلياً وتجهيزه للمراجعة (تعذّر الإرسال السحابي حالياً)."
      );
    });

    document.getElementById("copy-all-requests-wa-btn").addEventListener("click", async () => {
      const list = loadSavedRequests();
      if (!list.length) {
        showToast("أضف طلباً واحداً على الأقل أولاً.");
        return;
      }
      const lines = ["*طلبات تحديث شجرة ذوي عويض*"];
      list.forEach((it, idx) => {
        lines.push(
          `\n${idx + 1}. ${it.type} (${it.branch})\n- المعني: ${it.target}\n- الاسم/التعديل: ${it.newName}${
            it.submitter ? `\n- مقدم الطلب: ${it.submitter}` : ""
          }${it.notes ? `\n- ملاحظة: ${it.notes}` : ""}`
        );
      });
      const msg = lines.join("\n");
      try {
        await navigator.clipboard.writeText(msg);
        showToast("تم نسخ الطلبات بصيغة واتساب جاهزة للصق.");
      } catch (_) {
        showToast("تعذّر النسخ التلقائي — يمكنك التصدير بصيغة JSON.");
      }
    });

    document.getElementById("export-requests-json-btn").addEventListener("click", () => {
      const list = loadSavedRequests();
      const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "طلبات_تحديث_شجرة_ذوي_عويض.json";
      a.click();
    });

    document.getElementById("clear-requests-btn").addEventListener("click", () => {
      saveRequests([]);
      renderSavedRequests();
      showToast("تم مسح سجل الطلبات المحلي.");
    });

    // Keyboard Escape handler
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        closeProfileDrawer();
        closeUpdateModal();
        closeAuthPortal();
        closeMobileSheets();
        closeAccountPopover();
      }
    });

    bindGlobalSearch();

    // Deep-link URL query parameters support (?view=tree|sunburst|directory|kinship|analytics&person=ID)
    const params = new URLSearchParams(window.location.search);
    const qView = params.get("view");
    const qPerson = params.get("person");
    const qA = params.get("a");
    const qB = params.get("b");
    if (qA && DATA.nodesById[qA]) state.kinshipA = qA;
    if (qB && DATA.nodesById[qB]) state.kinshipB = qB;

    if (qView && ["tree", "sunburst", "directory", "kinship", "analytics"].includes(qView)) {
      switchView(qView);
    } else {
      renderTree();
    }
    if (qPerson && DATA.nodesById[qPerson]) {
      openProfileDrawer(qPerson);
    }

    const qAuth = params.get("auth");
    const qNext = params.get("next") === "admin" ? "admin" : null;
    if (qAuth === "login" || qAuth === "signup") {
      openAuthPortal({ tab: qAuth === "signup" ? "signup" : "signin", next: qNext });
    } else {
      refreshAccountUi();
    }

    // Non-blocking background sync with dedicated Dhawi Uwaid Supabase project
    syncLiveTreeFromSupabase();

    // Register Service Worker for instant loading & offline Home Screen support
    if ("serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:")) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(() => {});
      });
    }
  }

  async function syncLiveTreeFromSupabase() {
    if (!window.DHAWI_UWAID_DB || typeof window.DHAWI_UWAID_DB.fetchLiveTreePayload !== "function") {
      return;
    }
    const live = await window.DHAWI_UWAID_DB.fetchLiveTreePayload();
    if (!live || !live.nodesById) return;

    DATA = live;
    window.DHAWI_UWAID_TREE = live;
    rebuildSearchIndex();

    document.getElementById("edition-label-text").textContent = DATA.meta.editionLabel;
    document.getElementById("footer-edition-meta").textContent =
      `${toArabicDigits(DATA.meta.totalNodes)} اسماً موثقاً • ${DATA.meta.editionLabel} • متصل بقاعدة البيانات السحابية`;

    renderBranchPills();
    populateDirectorySelects();
    syncBioFeatureUi();

    if (state.activeView === "tree") {
      renderTree({ preserveView: true });
    } else if (state.activeView === "sunburst") {
      renderSunburst();
    } else if (state.activeView === "directory") {
      renderDirectory();
    } else if (state.activeView === "kinship") {
      renderKinshipResult();
    } else if (state.activeView === "analytics") {
      renderAnalytics();
    }

    const drawerEl = document.getElementById("profile-drawer");
    if (drawerEl && !drawerEl.classList.contains("hidden") && state.drawerNodeId && DATA.nodesById[state.drawerNodeId]) {
      renderProfileDrawer();
    }

    const portalEl = document.getElementById("auth-portal-modal");
    if (portalEl && !portalEl.classList.contains("hidden")) {
      refreshAccountUi();
    }
    const updEl = document.getElementById("update-modal");
    if (updEl && !updEl.classList.contains("hidden")) {
      refreshUpdateModalAuth();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
