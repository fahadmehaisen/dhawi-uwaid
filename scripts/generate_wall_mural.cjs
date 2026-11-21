const fs = require("fs");
const path = require("path");

const ROOT = "c:\\Projects\\dhawi-uwaid";
const TREE = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "tree.json"), "utf8"));

function getPathBBox(d) {
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < nums.length - 1; i += 2) {
    const x = nums[i], y = nums[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function loadBrandPaths() {
  const sealSvg = fs.readFileSync(path.join(ROOT, "assets", "logo-seal-clean.svg"), "utf8");
  const sealD = sealSvg.match(/<path[^>]*\sd="([^"]+)"/)[1];
  const fullWordSvg = fs.readFileSync(path.join(ROOT, "brand", "final", "logo-wordmark-full-emerald.svg"), "utf8");
  const wBlock = fullWordSvg.match(/<g id="wordmark-calligraphy"[^>]*>[\s\S]*?<path[^>]*\sd="([^"]+)"/)[1];
  const sBlock = fullWordSvg.match(/<g id="tribal-subtext"[^>]*>[\s\S]*?<path[^>]*\sd="([^"]+)"/)[1];
  return {
    sealD,
    sealBB: getPathBBox(sealD),
    wordD: wBlock,
    wordBB: getPathBBox(wBlock),
    subD: sBlock,
    subBB: getPathBBox(sBlock),
  };
}

const TRACED = loadBrandPaths();

// ISO A-Series Ratio (1 : sqrt(2)) -> 4200 x 5940
const W = 4200;
const H = 5940;
const CX = 2100;
const ROOT_Y = 4250; // Grand Root Medallion atop sculpted date-palm trunk

const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
const toArabic = (v) => String(v).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const rtl = (s) => `\u2067${esc(s)}\u2069`;

const BRANCH_PALETTE = {
  B01: { stroke: "#1B6851", leafFill: "#E6F3EC", bough: "#295C4A" }, // قليشان
  B02: { stroke: "#8A5A2B", leafFill: "#F6EFE4", bough: "#745032" }, // مضيان
  B03: { stroke: "#58683C", leafFill: "#EDF2E3", bough: "#55613F" }, // دهران
  B04: { stroke: "#315D73", leafFill: "#E7F0F5", bough: "#395A6D" }, // دغيليب
  B05: { stroke: "#A8701E", leafFill: "#FAF0DA", bough: "#876128" }, // سمران
  B06: { stroke: "#8A3838", leafFill: "#F7E9E9", bough: "#743B3B" }, // ثويني
  B07: { stroke: "#48447A", leafFill: "#ECEAF6", bough: "#49466E" }, // جرار
  B08: { stroke: "#144B37", leafFill: "#E3F1EA", bough: "#204D3B" }, // ماضي
};

const nodesById = TREE.nodesById;

// Tapered organic Bézier bough polygon
function taperedBezierPath(x1, y1, cx1, cy1, cx2, cy2, x2, y2, wStart, wEnd, steps = 16) {
  const left = [];
  const right = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * mt * x1 + 3 * mt * mt * t * cx1 + 3 * mt * t * t * cx2 + t * t * t * x2;
    const y = mt * mt * mt * y1 + 3 * mt * mt * t * cy1 + 3 * mt * t * t * cy2 + t * t * t * y2;
    const dx = 3 * mt * mt * (cx1 - x1) + 6 * mt * t * (cx2 - cx1) + 3 * t * t * (x2 - cx2);
    const dy = 3 * mt * mt * (cy1 - y1) + 6 * mt * t * (cy2 - cy1) + 3 * t * t * (y2 - cy2);
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const hw = (wStart * (1 - t) + wEnd * t) * 0.5;
    left.push(`${(x + nx * hw).toFixed(1)} ${(y + ny * hw).toFixed(1)}`);
    right.push(`${(x - nx * hw).toFixed(1)} ${(y - ny * hw).toFixed(1)}`);
  }
  right.reverse();
  return `M ${left.join(" L ")} L ${right.join(" L ")} Z`;
}

// Pointed botanical palm leaflet SVG path
function leafSvgPath(w, h) {
  const hw = w / 2, hh = h / 2;
  return `M ${-hw} 0 C ${(-hw * 0.62).toFixed(1)} ${(-hh * 1.15).toFixed(1)}, ${(hw * 0.62).toFixed(1)} ${(-hh * 1.15).toFixed(1)}, ${hw} 0 C ${(hw * 0.62).toFixed(1)} ${(hh * 1.15).toFixed(1)}, ${(-hw * 0.62).toFixed(1)} ${(hh * 1.15).toFixed(1)}, ${-hw} 0 Z`;
}

// Ornate Scalloped Golden Heritage Cloud (for Gen 2 fathers)
function heritageCloudPath(w, h) {
  const hw = w / 2, hh = h / 2;
  return [
    `M ${-hw + 14} ${-hh * 0.45}`,
    `Q ${-hw * 0.55} ${-hh * 1.16}, 0 ${-hh * 0.96}`,
    `Q ${hw * 0.55} ${-hh * 1.16}, ${hw - 14} ${-hh * 0.45}`,
    `Q ${hw + 6} 0, ${hw - 14} ${hh * 0.45}`,
    `Q ${hw * 0.55} ${hh * 1.16}, 0 ${hh * 0.96}`,
    `Q ${-hw * 0.55} ${hh * 1.16}, ${-hw + 14} ${hh * 0.45}`,
    `Q ${-hw - 6} 0, ${-hw + 14} ${-hh * 0.45} Z`,
  ].join(" ");
}

// =========================================================================
// PLANAR CURVED PINNATE PALM FROND LAYOUT ENGINE
// - Strictly disjoint vertical bands per subtree -> ZERO crossing branches!
// - Bilateral/Inline Pinnate Sprig clusters -> ZERO empty center holes!
// - Graceful S-boughs + arching sprig spines -> Zero straight stiff lines!
// =========================================================================

function nodeSizeSpec(n, sc) {
  const isBranch = n.generation === 1;
  const isParent = n.childrenCount > 0;
  const len = n.name.length;
  let w, h, fontSize;
  if (isBranch) {
    w = 216; h = 68; fontSize = 42;
  } else if (n.generation === 2) {
    w = Math.max(148, 86 + len * 11.4); h = 46; fontSize = 31;
  } else if (isParent) {
    w = Math.min(176, Math.max(106, 68 + len * 10.8)); h = 35; fontSize = 26.5;
  } else {
    w = Math.min(158, Math.max(96, 62 + len * 10.0)); h = 34; fontSize = 26.0;
  }
  return {
    w: Math.round(w * sc * 10) / 10,
    h: Math.round(h * sc * 10) / 10,
    fontSize: Math.round(fontSize * sc * 10) / 10,
  };
}

function subtreeMaxLevels(id) {
  const n = nodesById[id];
  if (!n || !n.childrenIds || n.childrenIds.length === 0) return 0;
  let m = 0;
  for (const c of n.childrenIds) m = Math.max(m, subtreeMaxLevels(c));
  return 1 + m;
}

// Compute outer horizontal width needed by any subtree's deepest leaf sprig (guarantees zero horizontal wrap/back-push!)
function maxOutwardWidthPx(id, sc) {
  const n = nodesById[id];
  const sp = nodeSizeSpec(n, sc);
  if (!n || !n.childrenIds || n.childrenIds.length === 0) return sp.w;
  const ch = n.childrenIds;
  const leaves = ch.filter((c) => !(nodesById[c].childrenIds && nodesById[c].childrenIds.length));
  const pars = ch.filter((c) => nodesById[c].childrenIds && nodesById[c].childrenIds.length);
  let need = sp.w + 40;
  let maxChild = 0;
  if (leaves.length > 0) {
    const firstRow = leaves.length >= 6 ? leaves.slice(0, Math.ceil(leaves.length / 2)) : leaves;
    const lw = firstRow.reduce((s, cid) => s + nodeSizeSpec(nodesById[cid], sc).w + 12 * sc, 45 * sc);
    maxChild = Math.max(maxChild, lw);
  }
  for (const pid of pars) {
    maxChild = Math.max(maxChild, maxOutwardWidthPx(pid, sc));
  }
  return need + maxChild;
}

// Exact minimum vertical height in pixels needed so NO node or leaf row ever touches vertically!
function subtreeNeedPx(id, sc, padV = 4.2) {
  const n = nodesById[id];
  const selfNeed = nodeSizeSpec(n, sc).h + padV;
  if (!n || !n.childrenIds || n.childrenIds.length === 0) return selfNeed;
  const ch = n.childrenIds;
  const leaves = ch.filter((c) => !(nodesById[c].childrenIds && nodesById[c].childrenIds.length));
  const pars = ch.filter((c) => nodesById[c].childrenIds && nodesById[c].childrenIds.length);
  let total = 0;
  const leafH = 34 * sc + padV;
  if (leaves.length > 0) {
    total += leaves.length <= 5 ? leafH + 6 : 2 * leafH + 10;
  }
  for (const pid of pars) {
    total += subtreeNeedPx(pid, sc, padV);
  }
  return Math.max(selfNeed, total);
}

// Compute organic vertical palm-arch warp strictly monotonic across Y so adjacent subtrees never cross!
function curveY(yLinear, u, yTop, yBot, archCfg) {
  const { archAmp = 0, droopAmp = 0 } = archCfg || {};
  const span = Math.max(1, yBot - yTop);
  const rel = (yLinear - yTop) / span;
  const wallFade = Math.sin(rel * Math.PI);
  const wave = (-archAmp * Math.sin(u * Math.PI * 0.9) + droopAmp * Math.pow(u, 1.5)) * (0.25 + 0.75 * wallFade);
  return Math.max(yTop + 18, Math.min(yBot - 18, yLinear + wave));
}

function layoutTerritory(branchId, cfg, scale = 1.0) {
  const { dir, xStart, xEnd, yTop, yBot, stemAnchorY, archAmp = 0, droopAmp = 0 } = cfg;
  const placedNodes = [];
  const nodeMap = new Map();
  const curvedEdges = [];

  const spanX = Math.abs(xEnd - xStart);
  const uOfX = (x) => Math.max(0, Math.min(1, Math.abs(x - xStart) / spanX));

  function assignSubtree(id, y0, y1, minXEdge) {
    const n = nodesById[id];
    const spec = nodeSizeSpec(n, scale);
    const ch = n.childrenIds || [];
    const leaves = ch.filter((c) => !(nodesById[c].childrenIds && nodesById[c].childrenIds.length));
    const pars = ch.filter((c) => nodesById[c].childrenIds && nodesById[c].childrenIds.length);

    let childNeedOutW = 0;
    if (leaves.length > 0) {
      const firstRow = leaves.length >= 6 ? leaves.slice(0, Math.ceil(leaves.length / 2)) : leaves;
      const lw = firstRow.reduce((s, cid) => s + nodeSizeSpec(nodesById[cid], scale).w + 11 * scale, 48 * scale);
      childNeedOutW = Math.max(childNeedOutW, lw);
    }
    for (const pid of pars) {
      childNeedOutW = Math.max(childNeedOutW, maxOutwardWidthPx(pid, scale));
    }

    let xSelf;
    if (n.generation === 1) {
      xSelf = xStart + dir * (spec.w / 2 + 10);
    } else {
      const availAfter = Math.max(40, Math.abs(xEnd - minXEdge) - childNeedOutW - spec.w / 2);
      const stepNice = Math.min(200, Math.max(24, availAfter * 0.42));
      xSelf = minXEdge + dir * (spec.w / 2 + stepNice);
      const maxAllowX = xEnd - dir * (childNeedOutW + spec.w / 2 + 6);
      if (dir > 0) xSelf = Math.min(maxAllowX, Math.max(minXEdge + spec.w / 2 + 28, xSelf));
      else xSelf = Math.max(maxAllowX, Math.min(minXEdge - spec.w / 2 - 28, xSelf));
    }
    const nextMinEdge = xSelf + dir * (spec.w / 2 + 12);

    const blocks = [];
    if (leaves.length > 0) {
      const lNeed = leaves.length <= 5 ? (34 * scale + 4.2 + 6) : (2 * (34 * scale + 4.2) + 10);
      blocks.push({ type: "leaves", leaves, needPx: lNeed });
    }
    for (const pid of pars) {
      blocks.push({ type: "parent", id: pid, needPx: subtreeNeedPx(pid, scale, 4.2) });
    }

    if (blocks.length === 0) {
      const yLin = (y0 + y1) / 2;
      const yCur = curveY(yLin, uOfX(xSelf), yTop, yBot, { archAmp, droopAmp });
      const rec = { n, x: xSelf, y: yCur, yLin, ...spec, rotDeg: 0, isBranch: n.generation === 1, isParent: false };
      placedNodes.push(rec);
      nodeMap.set(id, rec);
      return rec;
    }

    const totNeed = blocks.reduce((a, b) => a + b.needPx, 0);
    const usableH = Math.max(10, y1 - y0);
    let curY = y0;
    const childAnchors = [];

    for (const blk of blocks) {
      const blkH = (usableH * blk.needPx) / totNeed;
      const by0 = curY;
      const by1 = curY + blkH;
      curY = by1;

      if (blk.type === "parent") {
        const childRec = assignSubtree(blk.id, by0, by1, nextMinEdge);
        childAnchors.push({ type: "parent", rec: childRec, yCenter: childRec.yLin });
      } else {
        const lSpecs = blk.leaves.map((lid) => ({ lid, n: nodesById[lid], spec: nodeSizeSpec(nodesById[lid], scale) }));
        const splitTwoRows = blk.leaves.length >= 6;
        const rowsArr = splitTwoRows
          ? [lSpecs.slice(0, Math.ceil(lSpecs.length / 2)), lSpecs.slice(Math.ceil(lSpecs.length / 2))]
          : [lSpecs];

        const sprigFirstEdgeTargets = [];
        rowsArr.forEach((rowItems, rowIdx) => {
          const yRowLin = splitTwoRows
            ? (rowIdx === 0 ? by0 + blkH * 0.27 : by0 + blkH * 0.73)
            : (by0 + by1) / 2;

          const leafGapStart = nextMinEdge + dir * 32 * scale;
          const spanAvail = Math.max(10, Math.abs(xEnd - leafGapStart));
          const totalLeafW = rowItems.reduce((s, it) => s + it.spec.w, 0);
          const minGap = 11 * scale;
          const actualGap = rowItems.length > 1
            ? Math.max(minGap, Math.min(48, (spanAvail - totalLeafW) / rowItems.length))
            : 0;

          let curX = leafGapStart;
          const rowPlaced = [];
          rowItems.forEach((it) => {
            const lx = curX + dir * (it.spec.w / 2);
            curX += dir * (it.spec.w + actualGap);
            const yLeafCur = curveY(yRowLin, uOfX(lx), yTop, yBot, { archAmp, droopAmp });
            const lRec = {
              n: it.n, x: lx, y: yLeafCur, yLin: yRowLin,
              ...it.spec, rotDeg: 0, isBranch: false, isParent: false,
            };
            placedNodes.push(lRec);
            nodeMap.set(it.lid, lRec);
            rowPlaced.push(lRec);
          });

          sprigFirstEdgeTargets.push({ rowPlaced, yRowLin });
        });

        childAnchors.push({ type: "leaves", targets: sprigFirstEdgeTargets, yCenter: (by0 + by1) / 2 });
      }
    }

    const ySelfLin = (childAnchors[0].yCenter + childAnchors[childAnchors.length - 1].yCenter) / 2;
    const ySelfCur = curveY(ySelfLin, uOfX(xSelf), yTop, yBot, { archAmp, droopAmp });
    const rec = {
      n, x: xSelf, y: ySelfCur, yLin: ySelfLin, ...spec,
      rotDeg: 0, isBranch: n.generation === 1, isParent: true,
    };
    placedNodes.push(rec);
    nodeMap.set(id, rec);

    const pal = BRANCH_PALETTE[branchId] || BRANCH_PALETTE.B08;
    for (const anch of childAnchors) {
      if (anch.type === "parent") {
        const chRec = anch.rec;
        const vx = chRec.x - rec.x;
        const wS = rec.isBranch ? 15 : rec.n.generation === 2 ? 9 : 5.5;
        const wE = chRec.n.generation === 2 ? 9 : 4.2;
        curvedEdges.push({
          fromId: rec.n.id,
          toId: chRec.n.id,
          x1: rec.x, y1: rec.y,
          cx1: rec.x + vx * 0.54, cy1: rec.y,
          cx2: rec.x + vx * 0.46, cy2: chRec.y,
          x2: chRec.x, y2: chRec.y,
          wStart: wS, wEnd: wE,
          color: pal.bough, opacity: 0.84,
        });
      } else {
        for (let rIdx = 0; rIdx < anch.targets.length; rIdx++) {
          const row = anch.targets[rIdx].rowPlaced;
          if (!row.length) continue;

          if (row.length === 1) {
            const lf = row[0];
            const vx = lf.x - rec.x;
            curvedEdges.push({
              fromId: rec.n.id,
              toId: lf.n.id,
              x1: rec.x, y1: rec.y,
              cx1: rec.x + vx * 0.55, cy1: rec.y,
              cx2: rec.x + vx * 0.45, cy2: lf.y,
              x2: lf.x, y2: lf.y,
              wStart: rec.isBranch ? 9 : 4.2, wEnd: 1.8,
              color: pal.bough, opacity: 0.78,
            });
          } else {
            const spineSide = anch.targets.length === 2
              ? (rIdx === 0 ? 1 : -1)
              : (row[0].y < rec.y ? -1 : 1);
            const spineOff = spineSide * (row[0].h * 0.54 + 2);
            const lastLf = row[row.length - 1];
            const xEndSpine = lastLf.x;
            const yEndSpine = lastLf.y + spineOff * 0.65;
            const entryY = row[0].y + spineOff;
            // Climb smoothly out of parent in the stem-side clearance gap BEFORE traversing across child columns -> ZERO crossings!
            const cx1 = rec.x + dir * Math.min(72, Math.abs(row[0].x - rec.x) * 0.35);
            const cy1 = entryY;
            const cx2 = row[0].x + (xEndSpine - row[0].x) * 0.48;
            const cy2 = entryY;

            curvedEdges.push({
              fromId: rec.n.id,
              toId: lastLf.n.id,
              x1: rec.x, y1: rec.y,
              cx1, cy1, cx2, cy2,
              x2: xEndSpine, y2: yEndSpine,
              wStart: rec.isBranch ? 9 : 4.4, wEnd: 1.6,
              color: pal.bough, opacity: 0.78,
            });

            for (const lf of row) {
              const targetX = lf.x - dir * 12;
              let bestT = 0.5, bestErr = Infinity;
              for (let k = 0; k <= 20; k++) {
                const tt = k / 20, mt = 1 - tt;
                const sx = mt * mt * mt * rec.x + 3 * mt * mt * tt * cx1 + 3 * mt * tt * tt * cx2 + tt * tt * tt * xEndSpine;
                const err = Math.abs(sx - targetX);
                if (err < bestErr) { bestErr = err; bestT = tt; }
              }
              const mt = 1 - bestT;
              const sx = mt * mt * mt * rec.x + 3 * mt * mt * bestT * cx1 + 3 * mt * bestT * bestT * cx2 + bestT * bestT * bestT * xEndSpine;
              const sy = mt * mt * mt * rec.y + 3 * mt * mt * bestT * cy1 + 3 * mt * bestT * bestT * cy2 + bestT * bestT * bestT * yEndSpine;
              curvedEdges.push({
                fromId: rec.n.id,
                toId: lf.n.id,
                x1: sx, y1: sy,
                cx1: sx + dir * 4, cy1: (sy + lf.y) * 0.5,
                cx2: lf.x - dir * 6, cy2: lf.y,
                x2: lf.x, y2: lf.y,
                wStart: 2.6, wEnd: 1.4,
                color: pal.bough, opacity: 0.74,
              });
            }
          }
        }
      }
    }

    return rec;
  }

  const branchHeadRec = assignSubtree(branchId, yTop, yBot, xStart);

  const pal = BRANCH_PALETTE[branchId] || BRANCH_PALETTE.B08;
  curvedEdges.push({
    fromId: "R00",
    toId: branchId,
    x1: CX, y1: stemAnchorY,
    cx1: CX + dir * (stemAnchorY > ROOT_Y - 120 ? 190 : 18), cy1: (stemAnchorY + branchHeadRec.y) * 0.5 - (stemAnchorY > ROOT_Y - 120 ? 15 : 65),
    cx2: CX + dir * Math.abs(branchHeadRec.x - CX) * 0.45, cy2: branchHeadRec.y,
    x2: branchHeadRec.x, y2: branchHeadRec.y,
    wStart: 30, wEnd: 16,
    color: pal.bough, opacity: 0.9,
  });

  return { placedNodes, curvedEdges, branchHeadRec };
}

// Check exact OBB overlap count
function countObbOverlaps(items) {
  function corners(p) {
    const rad = (p.rotDeg * Math.PI) / 180;
    const c = Math.cos(rad), s = Math.sin(rad);
    const hw = p.w / 2 - 1, hh = p.h / 2 - 1;
    return [
      { x: p.x + hw * c - hh * s, y: p.y + hw * s + hh * c },
      { x: p.x - hw * c - hh * s, y: p.y - hw * s + hh * c },
      { x: p.x - hw * c + hh * s, y: p.y - hw * s - hh * c },
      { x: p.x + hw * c + hh * s, y: p.y + hw * s - hh * c },
    ];
  }
  function sep(aPts, bPts, ax, ay) {
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const q of aPts) { const pr = q.x * ax + q.y * ay; minA = Math.min(minA, pr); maxA = Math.max(maxA, pr); }
    for (const q of bPts) { const pr = q.x * ax + q.y * ay; minB = Math.min(minB, pr); maxB = Math.max(maxB, pr); }
    return maxA <= minB || maxB <= minA;
  }
  let overlaps = 0;
  const polys = items.map((p) => ({ p, pts: corners(p), rRad: (p.rotDeg * Math.PI) / 180 }));
  for (let i = 0; i < polys.length; i++) {
    const A = polys[i];
    for (let j = i + 1; j < polys.length; j++) {
      const B = polys[j];
      if (Math.hypot(A.p.x - B.p.x, A.p.y - B.p.y) > (A.p.w + B.p.w)) continue;
      const axes = [
        [Math.cos(A.rRad), Math.sin(A.rRad)],
        [-Math.sin(A.rRad), Math.cos(A.rRad)],
        [Math.cos(B.rRad), Math.sin(B.rRad)],
        [-Math.sin(B.rRad), Math.cos(B.rRad)],
      ];
      let separated = false;
      for (const [ax, ay] of axes) {
        if (sep(A.pts, B.pts, ax, ay)) { separated = true; break; }
      }
      if (!separated) overlaps++;
    }
  }
  return overlaps;
}

// Territory Definitions across [500..5010] height (114 rows Left, 114 rows Right = Identical Symmetry!)
// Right half: xStart = 2195 -> xEnd = 4075 (span 1880px)
// Left half:  xStart = 2005 -> xEnd = 125  (span 1880px)
const TERRITORIES = [
  // RIGHT HALF (Total 372 nodes, 114 rows)
  { bid: "B06", dir: 1, xStart: 2155, xEnd: 4075, yTop: 500,  yBot: 2810, stemAnchorY: 1760, archAmp: 38, droopAmp: 40 },
  { bid: "B05", dir: 1, xStart: 2195, xEnd: 4075, yTop: 2835, yBot: 4075, stemAnchorY: 3440, archAmp: 12, droopAmp: 25 },
  { bid: "B01", dir: 1, xStart: 2195, xEnd: 4075, yTop: 4095, yBot: 4795, stemAnchorY: 4160, archAmp: 0,  droopAmp: 20 },
  { bid: "B04", dir: 1, xStart: 2225, xEnd: 4075, yTop: 4815, yBot: 5005, stemAnchorY: 4250, archAmp: 0,  droopAmp: 0 },
  // LEFT HALF (Total 377 nodes, 114 rows)
  { bid: "B07", dir: -1, xStart: 2045, xEnd: 125, yTop: 500,  yBot: 2245, stemAnchorY: 1620, archAmp: 38, droopAmp: 35 },
  { bid: "B08", dir: -1, xStart: 2005, xEnd: 125, yTop: 2270, yBot: 5005, stemAnchorY: 3650, archAmp: 15, droopAmp: 28 },
];

// Find cleanest scale per territory so EVERY branch hits ZERO overlaps at maximum font size!
let allPlaced = [];
let allEdges = [];

for (const tCfg of TERRITORIES) {
  let bestT = null;
  for (const sc of [1.0, 0.96, 0.92, 0.88, 0.84]) {
    const res = layoutTerritory(tCfg.bid, tCfg, sc);
    const ov = countObbOverlaps(res.placedNodes);
    bestT = { ...res, ov, sc };
    if (ov === 0) break;
  }
  const lf = bestT.placedNodes.find((x) => !x.isParent && !x.isBranch);
  console.log(`Territory ${tCfg.bid} (${nodesById[tCfg.bid].name}, n=${bestT.placedNodes.length}): scale=${bestT.sc}, overlaps=${bestT.ov}, leafFont=${lf ? lf.fontSize : "-"}px`);
  allPlaced.push(...bestT.placedNodes);
  allEdges.push(...bestT.curvedEdges);
}

// Add B03 (دهران, 1) & B02 (مضيان, 1) cleanly on the lower-right collar beside root/stem
const collarSpecs = [
  { bid: "B03", x: 2430, y: 4520, stemY: 4270 },
  { bid: "B02", x: 2430, y: 4635, stemY: 4305 },
];
for (const cs of collarSpecs) {
  const n = nodesById[cs.bid];
  const sp = nodeSizeSpec(n, 0.96);
  const pal = BRANCH_PALETTE[cs.bid];
  allPlaced.push({ n, x: cs.x, y: cs.y, ...sp, rotDeg: 0, isBranch: true, isParent: false });
  allEdges.push({
    fromId: "R00", toId: cs.bid,
    x1: CX, y1: cs.stemY,
    cx1: CX + 130, cy1: cs.stemY + 30,
    cx2: cs.x - 140, cy2: cs.y,
    x2: cs.x, y2: cs.y,
    wStart: 22, wEnd: 12,
    color: pal.bough, opacity: 0.9,
  });
}

const totalObbOverlaps = countObbOverlaps(allPlaced);

// Segment-polyline crossing count across non-sibling edges (geometry check)
function sampleBezier(e, nPts = 8) {
  const pts = [];
  for (let i = 0; i <= nPts; i++) {
    const t = i / nPts, mt = 1 - t;
    pts.push({
      x: mt * mt * mt * e.x1 + 3 * mt * mt * t * e.cx1 + 3 * mt * t * t * e.cx2 + t * t * t * e.x2,
      y: mt * mt * mt * e.y1 + 3 * mt * mt * t * e.cy1 + 3 * mt * t * t * e.cy2 + t * t * t * e.y2,
    });
  }
  return pts;
}
function segCross(a, b, c, d) {
  const ccw = (p, q, r) => (r.y - p.y) * (q.x - p.x) > (q.y - p.y) * (r.x - p.x);
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}
const sampled = allEdges.map((e) => ({ e, pts: sampleBezier(e, 6) }));
let edgeCrossings = 0;
for (let i = 0; i < sampled.length; i++) {
  for (let j = i + 1; j < sampled.length; j++) {
    const A = sampled[i], B = sampled[j];
    if (A.e.fromId === B.e.fromId || A.e.toId === B.e.fromId || A.e.fromId === B.e.toId || A.e.toId === B.e.toId) continue;
    let crossed = false;
    for (let p = 0; p < A.pts.length - 1 && !crossed; p++) {
      for (let q = 0; q < B.pts.length - 1 && !crossed; q++) {
        if (segCross(A.pts[p], A.pts[p + 1], B.pts[q], B.pts[q + 1])) crossed = true;
      }
    }
    if (crossed) edgeCrossings++;
  }
}
const leafFonts = allPlaced.filter((x) => !x.isParent && !x.isBranch).map((x) => x.fontSize);
const minLeaf = Math.min(...leafFonts);
console.log(`FINAL PLANAR METRICS: totalPlaced=${allPlaced.length}, OBB_overlaps=${totalObbOverlaps}, edge_crossings=${edgeCrossings}, minLeafFont=${minLeaf}px`);

// Build SVG document
const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" lang="ar" xml:lang="ar" direction="rtl" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
out.push(`<defs>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&amp;family=Tajawal:wght@500;700;800&amp;display=swap');
    text { direction: rtl; unicode-bidi: isolate; }
    .m-serif { font-family: 'Amiri', serif; }
    .m-sans  { font-family: 'Tajawal', sans-serif; }
  </style>
  <radialGradient id="parchmentGlow" cx="50%" cy="46%" r="64%">
    <stop offset="0%" stop-color="#FFFDF7"/>
    <stop offset="55%" stop-color="#F7F0DF"/>
    <stop offset="100%" stop-color="#EAE0C8"/>
  </radialGradient>
  <radialGradient id="sunHalo" cx="50%" cy="46%" r="50%">
    <stop offset="0%" stop-color="#E8CF92" stop-opacity="0.22"/>
    <stop offset="65%" stop-color="#C9A45A" stop-opacity="0.06"/>
    <stop offset="100%" stop-color="#C9A45A" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="emeraldMedallion" cx="48%" cy="34%" r="72%">
    <stop offset="0%" stop-color="#1E5B45"/>
    <stop offset="62%" stop-color="#12372A"/>
    <stop offset="100%" stop-color="#081C15"/>
  </radialGradient>
  <linearGradient id="goldCloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#FFF4CE"/>
    <stop offset="55%" stop-color="#F7DC94"/>
    <stop offset="100%" stop-color="#E7BD63"/>
  </linearGradient>
  <linearGradient id="goldSheen" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#ECCF8B"/>
    <stop offset="50%" stop-color="#C9A45A"/>
    <stop offset="100%" stop-color="#966E21"/>
  </linearGradient>
  <linearGradient id="trunkGrad" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="#352314"/>
    <stop offset="28%" stop-color="#5A3F25"/>
    <stop offset="50%" stop-color="#745334"/>
    <stop offset="72%" stop-color="#5A3F25"/>
    <stop offset="100%" stop-color="#352314"/>
  </linearGradient>
  <radialGradient id="meadowGrad" cx="50%" cy="40%" r="55%">
    <stop offset="0%" stop-color="#356D4E" stop-opacity="0.34"/>
    <stop offset="60%" stop-color="#1E4B35" stop-opacity="0.24"/>
    <stop offset="100%" stop-color="#12372A" stop-opacity="0"/>
  </radialGradient>
</defs>`);

// Background Parchment & Canopy Sunlit Halo
out.push(`<rect width="${W}" height="${H}" fill="url(#parchmentGlow)"/>`);
out.push(`<ellipse cx="${CX}" cy="2750" rx="1900" ry="2200" fill="url(#sunHalo)"/>`);

// Decorative Translucent Palm-Frond Silhouette Watermarks in Backdrop
out.push(`<g id="mural-palm-aura" fill="none" stroke="#1E523D" stroke-opacity="0.04" stroke-linecap="round">`);
for (let yArm = 900; yArm <= 4300; yArm += 520) {
  out.push(`<path d="M ${CX} ${yArm + 320} Q ${CX + 900} ${yArm - 180}, ${CX + 1850} ${yArm + 60}" stroke-width="44"/>`);
  out.push(`<path d="M ${CX} ${yArm + 320} Q ${CX - 900} ${yArm - 180}, ${CX - 1850} ${yArm + 60}" stroke-width="44"/>`);
}
out.push(`</g>`);

// Museum Double Frame & Arabesque Corners
out.push(`<rect x="34" y="34" width="${W - 68}" height="${H - 68}" rx="28" fill="none" stroke="#12372A" stroke-width="14"/>`);
out.push(`<rect x="56" y="56" width="${W - 112}" height="${H - 112}" rx="20" fill="none" stroke="url(#goldSheen)" stroke-width="4.5"/>`);
out.push(`<rect x="74" y="74" width="${W - 148}" height="${H - 148}" rx="14" fill="none" stroke="#C9A45A" stroke-width="1.5" stroke-dasharray="7 9" stroke-opacity="0.65"/>`);

for (const [kx, ky, sx, sy] of [
  [74, 74, 1, 1],
  [W - 74, 74, -1, 1],
  [74, H - 74, 1, -1],
  [W - 74, H - 74, -1, -1],
]) {
  out.push(`<g transform="translate(${kx},${ky}) scale(${sx},${sy})">
    <path d="M 0 0 L 138 0 Q 90 24, 76 76 Q 24 90, 0 138 Z" fill="#12372A" stroke="#C9A45A" stroke-width="3"/>
    <path d="M 10 10 L 98 10 Q 60 30, 52 52 Q 30 60, 10 98 Z" fill="none" stroke="#E7CD90" stroke-width="2"/>
    <circle cx="30" cy="30" r="13" fill="#C9A45A"/>
    <polygon points="30,19 41,30 30,41 19,30" fill="#12372A"/>
  </g>`);
}

// Compact Header Centerpiece (Wordmark Logo #2 + Subtext)
const wScale = 860 / TRACED.wordBB.w;
const wTx = CX - TRACED.wordBB.cx * wScale;
const wTy = 230 - TRACED.wordBB.cy * wScale;
const sScale = 740 / TRACED.subBB.w;
const sTx = CX - TRACED.subBB.cx * sScale;
const sTy = 445 - TRACED.subBB.cy * sScale;

out.push(`<g id="mural-header">
  <g transform="translate(${wTx.toFixed(1)}, ${wTy.toFixed(1)}) scale(${wScale.toFixed(4)})">
    <path d="${TRACED.wordD}" fill="#12372A" fill-rule="evenodd"/>
  </g>
  <line x1="1660" y1="378" x2="2074" y2="378" stroke="#C9A45A" stroke-width="3" stroke-linecap="round"/>
  <line x1="2126" y1="378" x2="2540" y2="378" stroke="#C9A45A" stroke-width="3" stroke-linecap="round"/>
  <polygon points="2100,364 2114,378 2100,392 2086,378" fill="#C9A45A"/>
  <g transform="translate(${sTx.toFixed(1)}, ${sTy.toFixed(1)}) scale(${sScale.toFixed(4)})">
    <path d="${TRACED.subD}" fill="#12372A" fill-rule="evenodd"/>
  </g>
</g>`);

function pushTopCartouche(x, y, w, h, title, lines, footerTxt) {
  out.push(`<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="#FFFDF8" stroke="#C9A45A" stroke-width="3"/>
    <rect x="${x + 11}" y="${y + 11}" width="${w - 22}" height="${h - 22}" rx="14" fill="none" stroke="#12372A" stroke-width="1.2" stroke-opacity="0.3"/>
    <rect x="${x + w / 2 - 175}" y="${y - 22}" width="350" height="42" rx="21" fill="#12372A" stroke="#C9A45A" stroke-width="2.2"/>
    <text x="${x + w / 2}" y="${y + 9}" text-anchor="middle" fill="#E7CD90" font-size="26" font-weight="700" class="m-sans">${rtl(title)}</text>`);
  lines.forEach((ln, idx) => {
    out.push(`<text x="${x + w / 2}" y="${y + 102 + idx * 66}" text-anchor="middle" fill="#12372A" font-size="35" font-weight="700" class="m-serif">${rtl(ln)}</text>`);
  });
  if (footerTxt) {
    out.push(`<text x="${x + w / 2}" y="${y + h - 32}" text-anchor="middle" fill="#8A6826" font-size="24" font-weight="700" class="m-sans">${rtl(footerTxt)}</text>`);
  }
  out.push(`</g>`);
}

pushTopCartouche(
  2840, 108, 1245, 360,
  "الآية الكريمة",
  [
    "﴿ يَا أَيُّهَا النَّاسُ إِنَّا خَلَقْنَاكُمْ مِنْ ذَكَرٍ وَأُنْثَىٰ",
    "وَجَعَلْنَاكُمْ شُعُوبًا وَقَبَائِلَ لِتَعَارَفُوا ۚ إِنَّ أَكْرَمَكُمْ",
    "عِنْدَ اللَّهِ أَتْقَاكُمْ ۚ إِنَّ اللَّهَ عَلِيمٌ خَبِيرٌ ﴾"
  ],
  "سورة الحجرات — الآية ١٣"
);

pushTopCartouche(
  115, 108, 1245, 360,
  "الحديث الشريف",
  [
    "روي عن النبي ﷺ أنه قال:",
    "«تعلّموا من أنسابكم ما تصلون به أرحامكم؛",
    "فإن صلة الرحم محبّة في الأهل، مثراة في المال، منسأة في الأثر»"
  ],
  "حفظ النسب وصلة الأرحام"
);

// Tapered Curved Organic S-Boughs (drawn before trunk so branch roots tuck cleanly behind trunk & root medallion)
out.push(`<g id="mural-edges">`);
for (const e of allEdges) {
  const d = taperedBezierPath(e.x1, e.y1, e.cx1, e.cy1, e.cx2, e.cy2, e.x2, e.y2, e.wStart, e.wEnd, 14);
  out.push(`<path d="${d}" fill="${e.color}" fill-opacity="${e.opacity}"/>`);
}
out.push(`</g>`);

// Sculpted Rising Palm Crown Stem + Tapered Woody Trunk with كرب النخلة
const ancOrder = [];
for (let g = -10; g <= -1; g++) {
  const found = Object.values(nodesById).find((n) => n.generation === g);
  if (found) ancOrder.push(found);
}
const stemTopY = 1280;
const trunkBotY = 5810;

out.push(`<g id="mural-trunk">
  <ellipse cx="${CX}" cy="5818" rx="480" ry="82" fill="url(#meadowGrad)"/>
  <path d="M ${CX - 188} ${trunkBotY} C ${CX - 122} 5460, ${CX - 82} 4880, ${CX - 54} ${ROOT_Y} L ${CX - 38} 3200 L ${CX - 18} ${stemTopY} L ${CX + 18} ${stemTopY} L ${CX + 38} 3200 L ${CX + 54} ${ROOT_Y} C ${CX + 82} 4880, ${CX + 122} 5460, ${CX + 188} ${trunkBotY} Z" fill="url(#trunkGrad)" stroke="#C9A45A" stroke-width="4.5"/>`);

// Palm-bark scales from top stem down to meadow base
for (let ty = stemTopY + 80; ty <= 5765; ty += 72) {
  const halfW = ty >= ROOT_Y
    ? 54 + Math.pow((ty - ROOT_Y) / (trunkBotY - ROOT_Y), 1.35) * 132
    : 18 + ((ty - stemTopY) / (ROOT_Y - stemTopY)) * 36;
  out.push(`<path d="M ${(CX - halfW + 7).toFixed(1)} ${ty} Q ${CX} ${(ty + 36).toFixed(1)}, ${(CX + halfW - 7).toFixed(1)} ${ty}" fill="none" stroke="#E2C88B" stroke-width="2" stroke-opacity="0.45"/>`);
}

// 10 Ancestor Oval Medallions on Lower Trunk (قحطان at y=5725 up to مصلح at y=4505)
const ancTopY = 4505;
const ancBotY = 5725;
const stepAncY = (ancBotY - ancTopY) / Math.max(1, ancOrder.length - 1);
ancOrder.forEach((anc, idx) => {
  const y = ancBotY - idx * stepAncY;
  const isQahtan = idx === 0;
  const bw = isQahtan ? 320 : 228;
  const bh = isQahtan ? 72 : 54;
  out.push(`<g class="mural-node" data-node-id="${anc.id}" data-branch-id="${anc.branchId}" data-name="${esc(anc.name)}" data-lineage="${esc(anc.fullLineage || anc.lineage || anc.name)}" transform="translate(${CX}, ${y.toFixed(1)})">
    <rect x="${-bw / 2}" y="${-bh / 2}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${isQahtan ? "#12372A" : "#FFFDF8"}" stroke="#C9A45A" stroke-width="${isQahtan ? 4.8 : 3}"/>
    <text x="0" y="${isQahtan ? 12 : 9}" text-anchor="middle" fill="${isQahtan ? "#E7CD90" : "#12372A"}" font-size="${isQahtan ? 40 : 31}" font-weight="700" class="m-serif">${rtl(anc.name)}</text>
  </g>`);
});
out.push(`</g>`);

// All 749 Planar Nodes Ordered Leaves -> Fathers -> Gen 2 -> Gen 1
const sortedDraw = [...allPlaced].sort((a, b) => b.n.generation - a.n.generation);
out.push(`<g id="mural-nodes">`);
for (const p of sortedDraw) {
  const pal = BRANCH_PALETTE[p.n.branchId] || BRANCH_PALETTE.B08;
  const lin = p.n.fullLineage || p.n.lineage || p.n.name;
  out.push(`<g class="mural-node" data-node-id="${p.n.id}" data-branch-id="${p.n.branchId}" data-name="${esc(p.n.name)}" data-lineage="${esc(lin)}" transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) rotate(${p.rotDeg.toFixed(2)})">`);

  if (p.isBranch) {
    out.push(`<rect x="${-p.w / 2}" y="${-p.h / 2}" width="${p.w}" height="${p.h}" rx="${p.h / 2}" fill="${pal.stroke}" stroke="#E7CD90" stroke-width="4.2"/>
      <rect x="${-p.w / 2 + 5}" y="${-p.h / 2 + 5}" width="${p.w - 10}" height="${p.h - 10}" rx="${(p.h - 10) / 2}" fill="none" stroke="#FFFDF8" stroke-width="1.2" stroke-opacity="0.5"/>
      <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="#FFFDF8" font-size="${p.fontSize}" font-weight="700" class="m-serif">${rtl(p.n.name)}</text>`);
  } else if (p.n.generation === 2) {
    const dCloud = heritageCloudPath(p.w, p.h);
    out.push(`<path d="${dCloud}" fill="url(#goldCloudGrad)" stroke="#9B6E1F" stroke-width="3"/>
      <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="#0B241B" font-size="${p.fontSize}" font-weight="700" class="m-serif">${rtl(p.n.name)}</text>`);
  } else if (p.isParent) {
    out.push(`<rect x="${(-p.w / 2).toFixed(1)}" y="${(-p.h / 2).toFixed(1)}" width="${p.w}" height="${p.h}" rx="${(p.h / 2).toFixed(1)}" fill="#FFFDF6" stroke="${pal.stroke}" stroke-width="2.5"/>
      <rect x="${(-p.w / 2 + 3.5).toFixed(1)}" y="${(-p.h / 2 + 3.5).toFixed(1)}" width="${(p.w - 7).toFixed(1)}" height="${(p.h - 7).toFixed(1)}" rx="${((p.h - 7) / 2).toFixed(1)}" fill="none" stroke="#C9A45A" stroke-width="1" stroke-opacity="0.45"/>
      <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="#0B241B" font-size="${p.fontSize}" font-weight="800" class="m-sans">${rtl(p.n.name)}</text>`);
  } else {
    const dLeaf = leafSvgPath(p.w, p.h);
    out.push(`<path d="${dLeaf}" fill="${pal.leafFill}" stroke="${pal.stroke}" stroke-width="2"/>
      <circle cx="${(-p.w / 2 + 5.5).toFixed(1)}" cy="0" r="2.1" fill="${pal.stroke}" fill-opacity="0.65"/>
      <circle cx="${(p.w / 2 - 5.5).toFixed(1)}" cy="0" r="2.1" fill="${pal.stroke}" fill-opacity="0.65"/>
      <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="#0A2118" font-size="${p.fontSize}" font-weight="800" class="m-sans">${rtl(p.n.name)}</text>`);
  }
  out.push(`</g>`);
}
out.push(`</g>`);

// Grand Crown Medallion for عويض (R00) atop lower trunk
out.push(`<g class="mural-node" data-node-id="R00" data-branch-id="ROOT" data-name="${esc("عويض")}" data-lineage="${esc(nodesById["R00"].fullLineage || "عويض")}" transform="translate(${CX}, ${ROOT_Y})">`);
for (let k = 0; k < 24; k++) {
  out.push(`<polygon points="0,-160 9,-142 -9,-142" fill="#C9A45A" fill-opacity="0.7" transform="rotate(${k * 15})"/>`);
}
out.push(`<circle r="148" fill="none" stroke="url(#goldSheen)" stroke-width="4.5"/>
  <circle r="136" fill="url(#emeraldMedallion)" stroke="url(#goldSheen)" stroke-width="6.5"/>
  <circle r="121" fill="none" stroke="#E7CD90" stroke-width="1.8" stroke-opacity="0.78"/>
  <text x="0" y="2" text-anchor="middle" fill="#FFFDF8" font-size="74" font-weight="700" class="m-serif">${rtl("عويض")}</text>
  <text x="0" y="52" text-anchor="middle" fill="#E7CD90" font-size="21" font-weight="700" class="m-sans">${rtl("جد ذوي عويض • ٧٤٩ ذرية")}</text>
</g>`);

// Bottom Cartouches (y: 5045..5835)
const brX = 2350, brY = 5045, brW = 1735, brH = 790;
const sealS = 290 / TRACED.sealBB.w;
const sealCx = brX + 225;
const sealCy = brY + 355;
out.push(`<g id="mural-legend-box">
  <rect x="${brX}" y="${brY}" width="${brW}" height="${brH}" rx="24" fill="#FFFDF8" stroke="#C9A45A" stroke-width="3.4"/>
  <rect x="${brX + 13}" y="${brY + 13}" width="${brW - 26}" height="${brH - 26}" rx="18" fill="none" stroke="#12372A" stroke-width="1.2" stroke-opacity="0.32"/>
  <text x="${brX + brW - 46}" y="${brY + 80}" text-anchor="start" fill="#12372A" font-size="44" font-weight="700" class="m-serif">${rtl("مفتاح الفروع الثمانية لذوي عويض")}</text>
  <line x1="${brX + 430}" y1="${brY + 106}" x2="${brX + brW - 46}" y2="${brY + 106}" stroke="#C9A45A" stroke-width="2.2"/>
  <g transform="translate(${(sealCx - TRACED.sealBB.cx * sealS).toFixed(1)}, ${(sealCy - TRACED.sealBB.cy * sealS).toFixed(1)}) scale(${sealS.toFixed(4)})">
    <path d="${TRACED.sealD}" fill="#12372A" fill-rule="evenodd"/>
  </g>
  <text x="${sealCx}" y="${brY + 575}" text-anchor="middle" fill="#12372A" font-size="23" font-weight="700" class="m-serif">${rtl("من البصصة قبيلة الشدادين بني الحارث")}</text>
`);
TREE.branchStats.forEach((bs, idx) => {
  const colIdx = Math.floor(idx / 4);
  const rowIdx = idx % 4;
  const px = colIdx === 0 ? brX + brW - 46 : brX + brW - 640;
  const py = brY + 162 + rowIdx * 142;
  const c = (BRANCH_PALETTE[bs.branchId] || BRANCH_PALETTE.B08).stroke;
  out.push(`<g>
    <rect x="${px - 550}" y="${py}" width="550" height="98" rx="18" fill="#F8F4EA" stroke="${c}" stroke-width="3"/>
    <circle cx="${px - 42}" cy="${py + 49}" r="17" fill="${c}"/>
    <text x="${px - 76}" y="${py + 61}" text-anchor="start" fill="#12372A" font-size="37" font-weight="700" class="m-serif">${rtl(bs.name)}</text>
    <text x="${px - 522}" y="${py + 59}" text-anchor="end" fill="${c}" font-size="28" font-weight="700" class="m-sans">${rtl(`${toArabic(bs.totalInBranch)} اسماً`)}</text>
  </g>`);
});
out.push(`</g>`);

const blX = 115, blY = 5045, blW = 1735, blH = 790;
out.push(`<g id="mural-lineage-box">
  <rect x="${blX}" y="${blY}" width="${blW}" height="${blH}" rx="24" fill="#FFFDF8" stroke="#C9A45A" stroke-width="3.4"/>
  <rect x="${blX + 13}" y="${blY + 13}" width="${blW - 26}" height="${blH - 26}" rx="18" fill="none" stroke="#12372A" stroke-width="1.2" stroke-opacity="0.32"/>
  <text x="${blX + blW - 46}" y="${blY + 80}" text-anchor="start" fill="#12372A" font-size="44" font-weight="700" class="m-serif">${rtl("التوثيق وعمود النسب الكامل")}</text>
  <line x1="${blX + 46}" y1="${blY + 106}" x2="${blX + blW - 46}" y2="${blY + 106}" stroke="#C9A45A" stroke-width="2.2"/>
  <text x="${blX + blW - 46}" y="${blY + 178}" text-anchor="start" fill="#12372A" font-size="36" font-weight="700" class="m-serif">${rtl("ذوي عويض بن مصلح بن مسفر بن بصيص بن دمشق بن ملفي")}</text>
  <text x="${blX + blW - 46}" y="${blY + 234}" text-anchor="start" fill="#12372A" font-size="36" font-weight="700" class="m-serif">${rtl("بن مفلح بن عياش بن شداد بن حارث بن قحطان")}</text>
  <text x="${blX + blW - 46}" y="${blY + 305}" text-anchor="start" fill="#8A6826" font-size="30" font-weight="700" class="m-serif">${rtl("من البصصة قبيلة الشدادين بني الحارث")}</text>

  <rect x="${blX + 46}" y="${blY + 348}" width="${blW - 92}" height="202" rx="16" fill="#F8F4EA" stroke="#DED4BE" stroke-width="2.2"/>
  <text x="${blX + blW - 72}" y="${blY + 400}" text-anchor="start" fill="#12372A" font-size="27" font-weight="700" class="m-sans">${rtl("الحاشية والتوثيق:")}</text>
  <text x="${blX + blW - 72}" y="${blY + 452}" text-anchor="start" fill="#3D3932" font-size="24.5" font-weight="500" class="m-sans">${rtl("ذُكر في الحاشية الشفهية عند بعض كبار السن وجود اسم (مسفر) إضافي بين عويض ومصلح،")}</text>
  <text x="${blX + blW - 72}" y="${blY + 500}" text-anchor="start" fill="#3D3932" font-size="24.5" font-weight="500" class="m-sans">${rtl("والمعتمد في النسخة المحرّرة التسلسل المثبت في الجذع المتّصل أعلاه إلى قحطان.")}</text>

  <rect x="${blX + 46}" y="${blY + 585}" width="${blW - 92}" height="150" rx="18" fill="#12372A" stroke="#C9A45A" stroke-width="2.8"/>
  <text x="${blX + blW / 2}" y="${blY + 648}" text-anchor="middle" fill="#FFFDF8" font-size="31" font-weight="700" class="m-sans">${rtl("إجمالي الموثّق في الشجرة: ٧٦٠ اسماً  •  ٨ فروع رئيسية  •  ١٠ أجداد إلى قحطان")}</text>
  <text x="${blX + blW / 2}" y="${blY + 700}" text-anchor="middle" fill="#E7CD90" font-size="25" font-weight="700" class="m-sans">${rtl(TREE.meta.editionLabel)}</text>
</g>`);

out.push(`</svg>`);

const svgPath = path.join(ROOT, "brand", "dhawi-uwaid-wall-mural.svg");
fs.writeFileSync(svgPath, out.join("\n"), "utf8");
console.log("Wrote Planar Curved Pinnate Mural SVG:", svgPath, "size=", fs.statSync(svgPath).size);
