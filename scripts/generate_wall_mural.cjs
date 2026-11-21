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

// ISO A-Series Aspect Ratio (1 : sqrt(2)) -> 4200 x 5940
const W = 4200;
const H = 5940;
const CX = 2100;
const CY = 3680;

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

// 1. Symmetric Crown Ordering:
//    Right & Upper-Right (372): B02(1), B03(1), B04(13), B01(60), B05(101), B06(196)
//    Left  & Upper-Left  (377): B07(151), B08(226)
const BRANCH_ORDER = ["B02", "B03", "B04", "B01", "B05", "B06", "B07", "B08"];

const leafWeights = new Map();
const totalCounts = new Map();
const maxDepthBelow = new Map();

function analyzeSubtree(id) {
  const n = nodesById[id];
  if (!n) return { leaves: 1, total: 1, maxDepth: 0 };
  if (!n.childrenIds || n.childrenIds.length === 0) {
    leafWeights.set(id, 1);
    totalCounts.set(id, 1);
    maxDepthBelow.set(id, 0);
    return { leaves: 1, total: 1, maxDepth: 0 };
  }
  let leaves = 0, total = 1, maxD = 0;
  for (const cid of n.childrenIds) {
    const r = analyzeSubtree(cid);
    leaves += r.leaves;
    total += r.total;
    if (r.maxDepth + 1 > maxD) maxD = r.maxDepth + 1;
  }
  leafWeights.set(id, leaves);
  totalCounts.set(id, total);
  maxDepthBelow.set(id, maxD);
  return { leaves, total, maxDepth: maxD };
}
for (const bid of BRANCH_ORDER) analyzeSubtree(bid);

// Minimum sector floor so single/small branches remain balanced and graceful
const branchSectorWeight = new Map();
for (const bid of BRANCH_ORDER) {
  branchSectorWeight.set(bid, Math.max(9, totalCounts.get(bid)));
}
const sumBranchWeight = BRANCH_ORDER.reduce((a, b) => a + branchSectorWeight.get(b), 0);

// Canopy sweep: from +46 deg (lower right wing) clockwise up over -90 deg (apex) to -226 deg (lower left wing) = 272 deg span
const START_DEG = 46;
const END_DEG = -226;
const SECTOR_GAP_DEG = 2.0;
const USABLE_SPAN = (START_DEG - END_DEG) - SECTOR_GAP_DEG * (BRANCH_ORDER.length - 1);

const nodeAngles = new Map();
function assignAngles(id, aStart, aEnd) {
  const n = nodesById[id];
  const aMid = (aStart + aEnd) / 2;
  nodeAngles.set(id, { deg: aMid, rad: (aMid * Math.PI) / 180, aStart, aEnd });
  if (!n.childrenIds || n.childrenIds.length === 0) return;
  const weights = n.childrenIds.map((c) => (totalCounts.get(c) || 1) + 0.35);
  const wSum = weights.reduce((a, b) => a + b, 0);
  let cur = aStart;
  for (let i = 0; i < n.childrenIds.length; i++) {
    const cid = n.childrenIds[i];
    const span = ((aEnd - aStart) * weights[i]) / wSum;
    assignAngles(cid, cur, cur + span);
    cur += span;
  }
}

let curDeg = START_DEG;
for (const bid of BRANCH_ORDER) {
  const span = (USABLE_SPAN * branchSectorWeight.get(bid)) / sumBranchWeight;
  assignAngles(bid, curDeg, curDeg - span);
  curDeg = curDeg - span - SECTOR_GAP_DEG;
}

// 2. Space-filling elliptical canopy max radius R_max(theta)
function canopyBoundary(deg) {
  const rad = (deg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);

  const topYBase = 605;
  const headerDip = 125;
  const minRTop = (x) => topYBase + headerDip * Math.exp(-Math.pow((x - CX) / 560, 2));

  let lo = 350, hi = 3850;
  for (let s = 0; s < 22; s++) {
    const mid = (lo + hi) / 2;
    const x = CX + mid * ux;
    const y = CY + mid * uy;
    const okX = x >= 145 && x <= W - 145;
    const okTop = y >= minRTop(x);
    const okBot = y <= 4815;
    const okTrunk = y <= 3760 || Math.abs(x - CX) >= 265;
    const cornerNorm = Math.pow(Math.abs(x - CX) / 1960, 4.4) + Math.pow(Math.max(0, CY - y) / 3060, 4.4);
    const okDome = uy >= 0 || cornerNorm <= 1.72;
    if (okX && okTop && okBot && okTrunk && okDome) lo = mid;
    else hi = mid;
  }
  return lo;
}

// 3. Initial Botanical Positioning & Sizing + Fast 2-Phase Zero-Overlap Solver
function buildLayout(nodeScale = 1.0) {
  const items = [];
  const byId = new Map();

  const allDesc = Object.values(nodesById).filter((n) => n.generation >= 1);
  const sibIndexMap = new Map();
  for (const n of Object.values(nodesById)) {
    if (n.childrenIds) {
      n.childrenIds.forEach((cid, idx) => sibIndexMap.set(cid, { idx, len: n.childrenIds.length }));
    }
  }

  for (const n of allDesc) {
    const ang = nodeAngles.get(n.id);
    const deg = ang.deg;
    const rad = ang.rad;
    const rMax = canopyBoundary(deg);
    const isBranch = n.generation === 1;
    const isParent = n.childrenCount > 0;
    const sib = sibIndexMap.get(n.id) || { idx: 0, len: 1 };

    let w, h, fontSize, rotDeg = 0;
    if (isBranch) {
      w = 216; h = 72; fontSize = 40; rotDeg = 0;
    } else if (n.generation === 2) {
      w = 164; h = 56; fontSize = 31; rotDeg = 0;
    } else if (isParent) {
      w = Math.min(176, Math.max(118, 86 + n.name.length * 10.5));
      h = 44; fontSize = 26; rotDeg = 0;
    } else {
      w = Math.min(164, Math.max(108, 80 + n.name.length * 9.8));
      h = 40; fontSize = 24.5;
      const sideSign = Math.cos(rad);
      rotDeg = Math.max(-20, Math.min(20, sideSign * -17));
    }

    w = Math.round(w * nodeScale * 10) / 10;
    h = Math.round(h * nodeScale * 10) / 10;
    fontSize = Math.round(fontSize * nodeScale * 10) / 10;

    const rotRad = (rotDeg * Math.PI) / 180;
    const cosR = Math.abs(Math.cos(rotRad));
    const sinR = Math.abs(Math.sin(rotRad));
    const envHW = (w * cosR + h * sinR) / 2;
    const envHH = (w * sinR + h * cosR) / 2;

    const branchMaxD = Math.max(3, maxDepthBelow.get(n.branchId) + 1);
    // Compute depth of this node's own lineage tip so Gen 5 leaves aren't squeezed inside by a rare Gen 8 twig
    const effectiveDepth = Math.min(6, Math.max(4, n.generation + (maxDepthBelow.get(n.id) || 0)));
    let rTarget;
    if (isBranch) {
      rTarget = 340;
    } else if (n.generation === 2) {
      rTarget = 605 + (sib.idx % 2) * 105;
    } else if (n.branchId === "B02" || n.branchId === "B03") {
      rTarget = 660;
    } else if (n.branchId === "B04") {
      rTarget = 600 + ((n.generation - 2) / 3) * (rMax - 650);
    } else {
      const tLocal = isParent
        ? Math.min(0.76, (n.generation - 1.4) / Math.max(2.5, effectiveDepth - 1.0))
        : 0.56 + ((n.generation - 3) * 0.11) + ((sib.idx % 4) / 3) * 0.24;
      rTarget = 790 + Math.min(0.98, Math.max(0.14, tLocal)) * (rMax - 820);
    }
    rTarget = Math.max(320, Math.min(rMax - 30, rTarget));

    const item = {
      n, deg, rad, rAnchor: rTarget, rMax,
      x: CX + rTarget * Math.cos(rad),
      y: CY + rTarget * Math.sin(rad),
      w, h, fontSize, rotDeg, rotRad, envHW, envHH,
      isBranch, isParent,
    };
    items.push(item);
    byId.set(n.id, item);
  }

  function clampItem(p) {
    const hw = p.envHW + 10;
    const hh = p.envHH + 10;
    p.x = Math.max(130 + hw, Math.min(W - 130 - hw, p.x));
    const minTop = 595 + 125 * Math.exp(-Math.pow((p.x - CX) / 560, 2)) + hh;
    p.y = Math.max(minTop, Math.min(4845 - hh, p.y));

    const dx = p.x - CX;
    const dy = p.y - CY;
    const dist = Math.hypot(dx, dy);
    const minRootR = p.isBranch ? 255 : 225 + hw;
    if (dist < minRootR && dist > 0.01) {
      p.x = CX + (dx / dist) * minRootR;
      p.y = CY + (dy / dist) * minRootR;
    }
    if (p.y > CY + 125) {
      const trunkHalfClear = 152 + hw;
      if (Math.abs(p.x - CX) < trunkHalfClear) {
        p.x = p.x >= CX ? CX + trunkHalfClear : CX - trunkHalfClear;
      }
    }
  }

  const PAD = 7.0;
  const MAX_W_ENV = 260;

  for (let iter = 0; iter < 1800; iter++) {
    const phaseA = iter < 220;
    const springStrength = phaseA ? (0.055 * (1 - iter / 220)) : 0;

    if (phaseA) {
      for (const p of items) {
        if (p.isBranch) {
          const tx = CX + p.rAnchor * Math.cos(p.rad);
          const ty = CY + p.rAnchor * Math.sin(p.rad);
          p.x += (tx - p.x) * 0.16;
          p.y += (ty - p.y) * 0.16;
        } else {
          const par = byId.get(p.n.parentId);
          if (par) {
            const ax = CX + p.rAnchor * Math.cos(p.rad);
            const ay = CY + p.rAnchor * Math.sin(p.rad);
            p.x += (ax - p.x) * springStrength;
            p.y += (ay - p.y) * springStrength;

            const dPar = Math.hypot(p.x - par.x, p.y - par.y);
            const maxChord = p.n.generation === 2 ? 480 : 920;
            if (dPar > maxChord) {
              const pull = ((dPar - maxChord) / dPar) * (springStrength * 1.15);
              p.x += (par.x - p.x) * pull;
              p.y += (par.y - p.y) * pull;
            }
          }
        }
      }
    }

    // Spatial sweep-and-prune by X coordinate
    items.sort((a, b) => a.x - b.x);
    let overlapCountIter = 0;
    const gain = phaseA ? 0.68 : 0.92;

    for (let i = 0; i < items.length; i++) {
      const A = items[i];
      const ahw = A.envHW + PAD;
      const ahh = A.envHH + PAD;

      for (let j = i + 1; j < items.length; j++) {
        const B = items[j];
        const dx = B.x - A.x;
        if (dx > MAX_W_ENV) break;

        const sumW = ahw + B.envHW + PAD;
        const ox = sumW - dx;
        if (ox <= 0) continue;

        const dy = B.y - A.y;
        const sumH = ahh + B.envHH + PAD;
        const oy = sumH - Math.abs(dy);
        if (oy <= 0) continue;

        overlapCountIter++;
        const wA = phaseA ? (A.isBranch ? 0.2 : A.n.generation === 2 ? 0.35 : 0.5) : 0.5;
        const wB = phaseA ? (B.isBranch ? 0.2 : B.n.generation === 2 ? 0.35 : 0.5) : 0.5;
        const wSum = wA + wB || 1;

        // Aspect-normalized MTV: compare normalized penetration ox/sumW vs oy/sumH
        // so boxes spread radially in BOTH X and Y instead of jamming in vertical columns
        const pushX = (ox / sumW) < (oy / sumH);
        if (pushX) {
          const sx = ox * gain + 0.8;
          if (dx < 0.01) { A.x -= sx * 0.5; B.x += sx * 0.5; }
          else { A.x -= sx * (wA / wSum); B.x += sx * (wB / wSum); }
        } else {
          const sy = oy * gain + 0.8;
          if (dy >= 0) {
            A.y -= sy * (wA / wSum);
            B.y += sy * (wB / wSum);
          } else {
            A.y += sy * (wA / wSum);
            B.y -= sy * (wB / wSum);
          }
        }
      }
    }

    for (const p of items) clampItem(p);
    if (!phaseA && overlapCountIter === 0) break;
  }

  return { items, byId };
}

function countObbOverlaps(items) {
  function corners(p) {
    const c = Math.cos(p.rotRad), s = Math.sin(p.rotRad);
    const hw = p.w / 2 - 1.5, hh = p.h / 2 - 1.5;
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
  const polys = items.map((p) => ({ p, pts: corners(p) }));
  for (let i = 0; i < polys.length; i++) {
    const A = polys[i];
    for (let j = i + 1; j < polys.length; j++) {
      const B = polys[j];
      if (Math.hypot(A.p.x - B.p.x, A.p.y - B.p.y) > (A.p.w + B.p.w)) continue;
      const axes = [
        [Math.cos(A.p.rotRad), Math.sin(A.p.rotRad)],
        [-Math.sin(A.p.rotRad), Math.cos(A.p.rotRad)],
        [Math.cos(B.p.rotRad), Math.sin(B.p.rotRad)],
        [-Math.sin(B.p.rotRad), Math.cos(B.p.rotRad)],
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

// Run with progressive gentle refinement until ZERO overlaps!
let chosen = null;
for (const scaleTry of [1.0, 0.96, 0.92, 0.88]) {
  const res = buildLayout(scaleTry);
  const ov = countObbOverlaps(res.items);
  chosen = { ...res, scaleTry, ov };
  console.log(`Layout pass scale=${scaleTry}: OBB_overlaps=${ov}, leafFont=${(24.5 * scaleTry).toFixed(1)}px`);
  if (ov === 0) break;
}

const descItems = chosen.items;
const nodePos = chosen.byId;
nodePos.set("R00", { n: nodesById["R00"], x: CX, y: CY, rAnchor: 0, w: 296, h: 296, fontSize: 74, isRoot: true });

// Helper: Tapered organic Bézier bough polygon
function taperedBezierPath(x1, y1, cx1, cy1, cx2, cy2, x2, y2, wStart, wEnd, steps = 18) {
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

// Helper: Botanical pointed leaf path centered at (0,0)
function leafSvgPath(w, h) {
  const hw = w / 2;
  const hh = h / 2;
  return `M ${-hw} 0 C ${(-hw * 0.62).toFixed(1)} ${(-hh * 1.15).toFixed(1)}, ${(hw * 0.62).toFixed(1)} ${(-hh * 1.15).toFixed(1)}, ${hw} 0 C ${(hw * 0.62).toFixed(1)} ${(hh * 1.15).toFixed(1)}, ${(-hw * 0.62).toFixed(1)} ${(hh * 1.15).toFixed(1)}, ${-hw} 0 Z`;
}

// Helper: Ornate Arabesque Scalloped Heritage Cloud (for Gen 2 fathers)
function heritageCloudPath(w, h) {
  const hw = w / 2;
  const hh = h / 2;
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
  <radialGradient id="sunHalo" cx="50%" cy="44%" r="48%">
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
out.push(`<ellipse cx="${CX}" cy="2650" rx="1850" ry="2000" fill="url(#sunHalo)"/>`);

// Decorative Translucent Palm-Frond Silhouette Watermarks in Canopy Backdrop
out.push(`<g id="mural-palm-aura" fill="none" stroke="#1E523D" stroke-opacity="0.045" stroke-linecap="round">`);
for (let a = -205; a <= 25; a += 23) {
  const rad = (a * Math.PI) / 180;
  const x2 = CX + 1950 * Math.cos(rad);
  const y2 = CY + 2350 * Math.sin(rad);
  const c1x = CX + 900 * Math.cos(rad + 0.08);
  const c1y = CY + 900 * Math.sin(rad + 0.08);
  out.push(`<path d="M ${CX} ${CY} Q ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke-width="46"/>`);
}
out.push(`</g>`);

// 4. Museum Double Architectural Frame & Illuminated Arabesque Corner Medallions
out.push(`<rect x="36" y="36" width="${W - 72}" height="${H - 72}" rx="28" fill="none" stroke="#12372A" stroke-width="14"/>`);
out.push(`<rect x="58" y="58" width="${W - 116}" height="${H - 116}" rx="20" fill="none" stroke="url(#goldSheen)" stroke-width="4.5"/>`);
out.push(`<rect x="76" y="76" width="${W - 152}" height="${H - 152}" rx="14" fill="none" stroke="#C9A45A" stroke-width="1.5" stroke-dasharray="7 9" stroke-opacity="0.65"/>`);

for (const [kx, ky, sx, sy] of [
  [76, 76, 1, 1],
  [W - 76, 76, -1, 1],
  [76, H - 76, 1, -1],
  [W - 76, H - 76, -1, -1],
]) {
  out.push(`<g transform="translate(${kx},${ky}) scale(${sx},${sy})">
    <path d="M 0 0 L 145 0 Q 95 25, 80 80 Q 25 95, 0 145 Z" fill="#12372A" stroke="#C9A45A" stroke-width="3"/>
    <path d="M 10 10 L 105 10 Q 65 32, 55 55 Q 32 65, 10 105 Z" fill="none" stroke="#E7CD90" stroke-width="2"/>
    <circle cx="32" cy="32" r="14" fill="#C9A45A"/>
    <polygon points="32,20 44,32 32,44 20,32" fill="#12372A"/>
  </g>`);
}

// 5. Compact Header Centerpiece (Wordmark Logo #2 + Subtext)
const wScale = 920 / TRACED.wordBB.w;
const wTx = CX - TRACED.wordBB.cx * wScale;
const wTy = 265 - TRACED.wordBB.cy * wScale;
const sScale = 790 / TRACED.subBB.w;
const sTx = CX - TRACED.subBB.cx * sScale;
const sTy = 515 - TRACED.subBB.cy * sScale;

out.push(`<g id="mural-header">
  <g transform="translate(${wTx.toFixed(1)}, ${wTy.toFixed(1)}) scale(${wScale.toFixed(4)})">
    <path d="${TRACED.wordD}" fill="#12372A" fill-rule="evenodd"/>
  </g>
  <line x1="1640" y1="435" x2="2074" y2="435" stroke="#C9A45A" stroke-width="3" stroke-linecap="round"/>
  <line x1="2126" y1="435" x2="2560" y2="435" stroke="#C9A45A" stroke-width="3" stroke-linecap="round"/>
  <polygon points="2100,421 2114,435 2100,449 2086,435" fill="#C9A45A"/>
  <g transform="translate(${sTx.toFixed(1)}, ${sTy.toFixed(1)}) scale(${sScale.toFixed(4)})">
    <path d="${TRACED.subD}" fill="#12372A" fill-rule="evenodd"/>
  </g>
</g>`);

// Compact Illuminated Top Cartouches (Quranic Verse & Hadith)
function pushTopCartouche(x, y, w, h, title, lines, footerTxt) {
  out.push(`<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="#FFFDF8" stroke="#C9A45A" stroke-width="3.2"/>
    <rect x="${x + 12}" y="${y + 12}" width="${w - 24}" height="${h - 24}" rx="14" fill="none" stroke="#12372A" stroke-width="1.2" stroke-opacity="0.32"/>
    <rect x="${x + w / 2 - 190}" y="${y - 24}" width="380" height="46" rx="23" fill="#12372A" stroke="#C9A45A" stroke-width="2.4"/>
    <text x="${x + w / 2}" y="${y + 10}" text-anchor="middle" fill="#E7CD90" font-size="28" font-weight="700" class="m-sans">${rtl(title)}</text>`);
  lines.forEach((ln, idx) => {
    out.push(`<text x="${x + w / 2}" y="${y + 115 + idx * 72}" text-anchor="middle" fill="#12372A" font-size="37" font-weight="700" class="m-serif">${rtl(ln)}</text>`);
  });
  if (footerTxt) {
    out.push(`<text x="${x + w / 2}" y="${y + h - 38}" text-anchor="middle" fill="#8A6826" font-size="26" font-weight="700" class="m-sans">${rtl(footerTxt)}</text>`);
  }
  out.push(`</g>`);
}

pushTopCartouche(
  2820, 125, 1245, 405,
  "الآية الكريمة",
  [
    "﴿ يَا أَيُّهَا النَّاسُ إِنَّا خَلَقْنَاكُمْ مِنْ ذَكَرٍ وَأُنْثَىٰ",
    "وَجَعَلْنَاكُمْ شُعُوبًا وَقَبَائِلَ لِتَعَارَفُوا ۚ إِنَّ أَكْرَمَكُمْ",
    "عِنْدَ اللَّهِ أَتْقَاكُمْ ۚ إِنَّ اللَّهَ عَلِيمٌ خَبِيرٌ ﴾"
  ],
  "سورة الحجرات — الآية ١٣"
);

pushTopCartouche(
  135, 125, 1245, 405,
  "الحديث الشريف",
  [
    "روي عن النبي ﷺ أنه قال:",
    "«تعلّموا من أنسابكم ما تصلون به أرحامكم؛",
    "فإن صلة الرحم محبّة في الأهل، مثراة في المال، منسأة في الأثر»"
  ],
  "حفظ النسب وصلة الأرحام"
);

// 6. Sculpted Botanical Tapered Organic Boughs (أغصان متدرجة السماكة)
out.push(`<g id="mural-edges">`);
for (const p of descItems) {
  const pal = BRANCH_PALETTE[p.n.branchId] || BRANCH_PALETTE.B08;
  const par = nodePos.get(p.n.parentId);
  if (!par) continue;

  const isLeaf = !p.isBranch && !p.isParent;
  let wStart, wEnd, opacity;
  if (p.isBranch) {
    wStart = 28; wEnd = 13; opacity = 0.88;
  } else if (p.n.generation === 2) {
    wStart = 14; wEnd = 7.5; opacity = 0.85;
  } else if (p.isParent) {
    wStart = 7.2; wEnd = 3.8; opacity = 0.78;
  } else {
    wStart = 3.8; wEnd = 1.6; opacity = 0.7;
  }

  // Organic botanical curvature relative to center of palm crown
  const vx = p.x - par.x;
  const vy = p.y - par.y;
  const angP = Math.atan2(par.y - CY, par.x - CX);
  const sideBend = (Math.cos(angP) >= 0 ? -1 : 1) * Math.min(48, Math.hypot(vx, vy) * 0.14);
  const cx1 = par.x + vx * 0.36 + Math.cos(angP) * 28;
  const cy1 = par.y + vy * 0.36 + Math.sin(angP) * 28;
  const cx2 = p.x - vx * 0.28 + sideBend * 0.2;
  const cy2 = p.y - vy * 0.28 - Math.abs(sideBend) * 0.45;

  const pathD = taperedBezierPath(par.x, par.y, cx1, cy1, cx2, cy2, p.x, p.y, wStart, wEnd, isLeaf ? 10 : 16);
  out.push(`<path d="${pathD}" fill="${pal.bough}" fill-opacity="${opacity}"/>`);
}
out.push(`</g>`);

// 7. Meadow Base & Sculpted Palm Trunk with Bark Scales (كرب النخلة) + 10 Ancestor Medallions
const ancOrder = [];
for (let g = -10; g <= -1; g++) {
  const found = Object.values(nodesById).find((n) => n.generation === g);
  if (found) ancOrder.push(found);
}
const trunkTopY = 3940;
const trunkBotY = 5690;
const stepY = (trunkBotY - trunkTopY) / Math.max(1, ancOrder.length - 1);

out.push(`<g id="mural-trunk">
  <ellipse cx="${CX}" cy="5790" rx="520" ry="95" fill="url(#meadowGrad)"/>
  <path d="M ${CX - 210} 5790 C ${CX - 140} 5400, ${CX - 94} 4650, ${CX - 64} ${CY + 105} L ${CX + 64} ${CY + 105} C ${CX + 94} 4650, ${CX + 140} 5400, ${CX + 210} 5790 Z" fill="url(#trunkGrad)" stroke="#C9A45A" stroke-width="5"/>`);

// Sculpted interlocking palm-bark diamond scales (كرب جذع النخلة)
for (let ty = CY + 160; ty <= 5730; ty += 76) {
  const tNorm = (ty - (CY + 105)) / (5790 - (CY + 105));
  const halfW = 64 + Math.pow(Math.max(0, tNorm), 1.38) * 144;
  out.push(`<path d="M ${(CX - halfW + 10).toFixed(1)} ${ty} Q ${CX} ${(ty + 44).toFixed(1)}, ${(CX + halfW - 10).toFixed(1)} ${ty}" fill="none" stroke="#E2C88B" stroke-width="2.4" stroke-opacity="0.45"/>`);
  out.push(`<path d="M ${(CX - halfW * 0.58).toFixed(1)} ${(ty + 34).toFixed(1)} L ${CX} ${(ty + 70).toFixed(1)} L ${(CX + halfW * 0.58).toFixed(1)} ${(ty + 34).toFixed(1)}" fill="none" stroke="#C9A45A" stroke-width="1.4" stroke-opacity="0.28"/>`);
}

out.push(`<line x1="${CX}" y1="${CY + 135}" x2="${CX}" y2="${trunkBotY}" stroke="#E7CD90" stroke-width="4" stroke-opacity="0.72"/>`);

ancOrder.forEach((anc, idx) => {
  const y = trunkBotY - idx * stepY;
  const isQahtan = idx === 0;
  const bw = isQahtan ? 330 : 238;
  const bh = isQahtan ? 76 : 58;
  out.push(`<g class="mural-node" data-node-id="${anc.id}" data-branch-id="${anc.branchId}" data-name="${esc(anc.name)}" data-lineage="${esc(anc.fullLineage || anc.lineage || anc.name)}" transform="translate(${CX}, ${y.toFixed(1)})">
    <rect x="${-bw / 2}" y="${-bh / 2}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${isQahtan ? "#12372A" : "#FFFDF8"}" stroke="#C9A45A" stroke-width="${isQahtan ? 5 : 3.2}"/>
    <text x="0" y="${isQahtan ? 12 : 10}" text-anchor="middle" fill="${isQahtan ? "#E7CD90" : "#12372A"}" font-size="${isQahtan ? 42 : 33}" font-weight="700" class="m-serif">${rtl(anc.name)}</text>
  </g>`);
});
out.push(`</g>`);

// 8. All 749 Botanical Descendant Nodes (Ordered Back-to-Front: Leaves -> Parents -> Gen 2 -> Gen 1)
const sortedForDraw = [...descItems].sort((a, b) => b.n.generation - a.n.generation);
out.push(`<g id="mural-nodes">`);
for (const p of sortedForDraw) {
  const pal = BRANCH_PALETTE[p.n.branchId] || BRANCH_PALETTE.B08;
  const lin = p.n.fullLineage || p.n.lineage || p.n.name;
  out.push(`<g class="mural-node" data-node-id="${p.n.id}" data-branch-id="${p.n.branchId}" data-name="${esc(p.n.name)}" data-lineage="${esc(lin)}" transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) rotate(${p.rotDeg.toFixed(2)})">`);

  if (p.isBranch) {
    // Gen 1 Royal Emerald Shield Medallion
    out.push(`<rect x="${-p.w / 2}" y="${-p.h / 2}" width="${p.w}" height="${p.h}" rx="${p.h / 2}" fill="${pal.stroke}" stroke="#E7CD90" stroke-width="4.2"/>
      <rect x="${-p.w / 2 + 5}" y="${-p.h / 2 + 5}" width="${p.w - 10}" height="${p.h - 10}" rx="${(p.h - 10) / 2}" fill="none" stroke="#FFFDF8" stroke-width="1.2" stroke-opacity="0.5"/>
      <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="#FFFDF8" font-size="${p.fontSize}" font-weight="700" class="m-serif">${rtl(p.n.name)}</text>`);
  } else if (p.n.generation === 2) {
    // Gen 2 Scalloped Golden Heritage Cloud
    const dCloud = heritageCloudPath(p.w, p.h);
    out.push(`<path d="${dCloud}" fill="url(#goldCloudGrad)" stroke="#9B6E1F" stroke-width="3"/>
      <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="#0B241B" font-size="${p.fontSize}" font-weight="700" class="m-serif">${rtl(p.n.name)}</text>`);
  } else if (p.isParent) {
    // Gen 3-6 Luminous Ivory-Cream Heritage Cloud
    out.push(`<rect x="${(-p.w / 2).toFixed(1)}" y="${(-p.h / 2).toFixed(1)}" width="${p.w}" height="${p.h}" rx="${(p.h / 2).toFixed(1)}" fill="#FFFDF6" stroke="${pal.stroke}" stroke-width="2.6"/>
      <rect x="${(-p.w / 2 + 3.5).toFixed(1)}" y="${(-p.h / 2 + 3.5).toFixed(1)}" width="${(p.w - 7).toFixed(1)}" height="${(p.h - 7).toFixed(1)}" rx="${((p.h - 7) / 2).toFixed(1)}" fill="none" stroke="#C9A45A" stroke-width="1" stroke-opacity="0.5"/>
      <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="#0B241B" font-size="${p.fontSize}" font-weight="800" class="m-sans">${rtl(p.n.name)}</text>`);
  } else {
    // Pointed Botanical Palm Leaflet
    const dLeaf = leafSvgPath(p.w, p.h);
    out.push(`<path d="${dLeaf}" fill="${pal.leafFill}" stroke="${pal.stroke}" stroke-width="2.1"/>
      <circle cx="${(-p.w / 2 + 6).toFixed(1)}" cy="0" r="2.2" fill="${pal.stroke}" fill-opacity="0.65"/>
      <circle cx="${(p.w / 2 - 6).toFixed(1)}" cy="0" r="2.2" fill="${pal.stroke}" fill-opacity="0.65"/>
      <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="#0A2118" font-size="${p.fontSize}" font-weight="800" class="m-sans">${rtl(p.n.name)}</text>`);
  }
  out.push(`</g>`);
}
out.push(`</g>`);

// 9. Central Grand Crown Medallion for عويض (R00) with Floral Gold Collar
out.push(`<g class="mural-node" data-node-id="R00" data-branch-id="ROOT" data-name="${esc("عويض")}" data-lineage="${esc(nodesById["R00"].fullLineage || nodesById["R00"].lineage || "عويض")}" transform="translate(${CX}, ${CY})">`);
for (let k = 0; k < 24; k++) {
  const rot = k * 15;
  out.push(`<polygon points="0,-168 10,-148 -10,-148" fill="#C9A45A" fill-opacity="0.7" transform="rotate(${rot})"/>`);
}
out.push(`<circle r="154" fill="none" stroke="url(#goldSheen)" stroke-width="4.5"/>
  <circle r="142" fill="url(#emeraldMedallion)" stroke="url(#goldSheen)" stroke-width="7"/>
  <circle r="127" fill="none" stroke="#E7CD90" stroke-width="1.8" stroke-opacity="0.78"/>
  <text x="0" y="2" text-anchor="middle" fill="#FFFDF8" font-size="76" font-weight="700" class="m-serif">${rtl("عويض")}</text>
  <text x="0" y="54" text-anchor="middle" fill="#E7CD90" font-size="22" font-weight="700" class="m-sans">${rtl("جد ذوي عويض • ٧٤٩ ذرية")}</text>
</g>`);

// 10. Compact Bottom Cartouches (y: 4920..5800) with Proper RTL Text Anchors
const brX = 2365, brY = 4920, brW = 1715, brH = 880;
const sealS = 310 / TRACED.sealBB.w;
const sealCx = brX + 230;
const sealCy = brY + 390;
const sealTx = sealCx - TRACED.sealBB.cx * sealS;
const sealTy = sealCy - TRACED.sealBB.cy * sealS;

out.push(`<g id="mural-legend-box">
  <rect x="${brX}" y="${brY}" width="${brW}" height="${brH}" rx="24" fill="#FFFDF8" stroke="#C9A45A" stroke-width="3.6"/>
  <rect x="${brX + 14}" y="${brY + 14}" width="${brW - 28}" height="${brH - 28}" rx="18" fill="none" stroke="#12372A" stroke-width="1.3" stroke-opacity="0.32"/>
  <text x="${brX + brW - 48}" y="${brY + 86}" text-anchor="start" fill="#12372A" font-size="46" font-weight="700" class="m-serif">${rtl("مفتاح الفروع الثمانية لذوي عويض")}</text>
  <line x1="${brX + 440}" y1="${brY + 114}" x2="${brX + brW - 48}" y2="${brY + 114}" stroke="#C9A45A" stroke-width="2.4"/>
  <g transform="translate(${sealTx.toFixed(1)}, ${sealTy.toFixed(1)}) scale(${sealS.toFixed(4)})">
    <path d="${TRACED.sealD}" fill="#12372A" fill-rule="evenodd"/>
  </g>
  <text x="${sealCx}" y="${brY + 620}" text-anchor="middle" fill="#12372A" font-size="24" font-weight="700" class="m-serif">${rtl("من البصصة قبيلة الشدادين بني الحارث")}</text>
`);

TREE.branchStats.forEach((bs, idx) => {
  const colIdx = Math.floor(idx / 4);
  const rowIdx = idx % 4;
  const px = colIdx === 0 ? brX + brW - 48 : brX + brW - 635;
  const py = brY + 178 + rowIdx * 156;
  const c = (BRANCH_PALETTE[bs.branchId] || BRANCH_PALETTE.B08).stroke;
  out.push(`<g>
    <rect x="${px - 545}" y="${py}" width="545" height="106" rx="20" fill="#F8F4EA" stroke="${c}" stroke-width="3"/>
    <circle cx="${px - 44}" cy="${py + 53}" r="18" fill="${c}"/>
    <text x="${px - 80}" y="${py + 65}" text-anchor="start" fill="#12372A" font-size="38" font-weight="700" class="m-serif">${rtl(bs.name)}</text>
    <text x="${px - 518}" y="${py + 63}" text-anchor="end" fill="${c}" font-size="29" font-weight="700" class="m-sans">${rtl(`${toArabic(bs.totalInBranch)} اسماً`)}</text>
  </g>`);
});
out.push(`</g>`);

// Bottom-Left Documentation & Full Lineage Panel
const blX = 120, blY = 4920, blW = 1715, blH = 880;
out.push(`<g id="mural-lineage-box">
  <rect x="${blX}" y="${blY}" width="${blW}" height="${blH}" rx="24" fill="#FFFDF8" stroke="#C9A45A" stroke-width="3.6"/>
  <rect x="${blX + 14}" y="${blY + 14}" width="${blW - 28}" height="${blH - 28}" rx="18" fill="none" stroke="#12372A" stroke-width="1.3" stroke-opacity="0.32"/>
  <text x="${blX + blW - 48}" y="${blY + 86}" text-anchor="start" fill="#12372A" font-size="46" font-weight="700" class="m-serif">${rtl("التوثيق وعمود النسب الكامل")}</text>
  <line x1="${blX + 48}" y1="${blY + 114}" x2="${blX + blW - 48}" y2="${blY + 114}" stroke="#C9A45A" stroke-width="2.4"/>
  <text x="${blX + blW - 48}" y="${blY + 195}" text-anchor="start" fill="#12372A" font-size="37" font-weight="700" class="m-serif">${rtl("ذوي عويض بن مصلح بن مسفر بن بصيص بن دمشق بن ملفي")}</text>
  <text x="${blX + blW - 48}" y="${blY + 255}" text-anchor="start" fill="#12372A" font-size="37" font-weight="700" class="m-serif">${rtl("بن مفلح بن عياش بن شداد بن حارث بن قحطان")}</text>
  <text x="${blX + blW - 48}" y="${blY + 332}" text-anchor="start" fill="#8A6826" font-size="31" font-weight="700" class="m-serif">${rtl("من البصصة قبيلة الشدادين بني الحارث")}</text>

  <rect x="${blX + 48}" y="${blY + 382}" width="${blW - 96}" height="218" rx="16" fill="#F8F4EA" stroke="#DED4BE" stroke-width="2.2"/>
  <text x="${blX + blW - 76}" y="${blY + 436}" text-anchor="start" fill="#12372A" font-size="28" font-weight="700" class="m-sans">${rtl("الحاشية والتوثيق:")}</text>
  <text x="${blX + blW - 76}" y="${blY + 492}" text-anchor="start" fill="#3D3932" font-size="25" font-weight="500" class="m-sans">${rtl("ذُكر في الحاشية الشفهية عند بعض كبار السن وجود اسم (مسفر) إضافي بين عويض ومصلح،")}</text>
  <text x="${blX + blW - 76}" y="${blY + 542}" text-anchor="start" fill="#3D3932" font-size="25" font-weight="500" class="m-sans">${rtl("والمعتمد في النسخة المحرّرة التسلسل المثبت في الجذع المتّصل أعلاه إلى قحطان.")}</text>

  <rect x="${blX + 48}" y="${blY + 648}" width="${blW - 96}" height="158" rx="20" fill="#12372A" stroke="#C9A45A" stroke-width="2.8"/>
  <text x="${blX + blW / 2}" y="${blY + 712}" text-anchor="middle" fill="#FFFDF8" font-size="32" font-weight="700" class="m-sans">${rtl("إجمالي الموثّق في الشجرة: ٧٦٠ اسماً  •  ٨ فروع رئيسية  •  ١٠ أجداد إلى قحطان")}</text>
  <text x="${blX + blW / 2}" y="${blY + 766}" text-anchor="middle" fill="#E7CD90" font-size="26" font-weight="700" class="m-sans">${rtl(TREE.meta.editionLabel)}</text>
</g>`);

out.push(`</svg>`);

const svgPath = path.join(ROOT, "brand", "dhawi-uwaid-wall-mural.svg");
fs.writeFileSync(svgPath, out.join("\n"), "utf8");
console.log("Wrote Botanical Palm Wall Mural SVG:", svgPath, "size=", fs.statSync(svgPath).size, "final_overlaps=", chosen.ov);
