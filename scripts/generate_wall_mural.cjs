const fs = require("fs");
const path = require("path");

const ROOT = "c:\\Projects\\dhawi-uwaid";
const TREE = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "tree.json"), "utf8"));
const TRACED = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "_traced_paths.json"), "utf8"));

const W = 5400;
const H = 6750;
const CX = 2700;
const CY = 3680;

const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
const toArabic = (v) => String(v).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const BRANCH_COLORS = {
  B01: "#1F6E58",
  B02: "#8B5E34",
  B03: "#5E6B42",
  B04: "#3A6073",
  B05: "#B37D2E",
  B06: "#8F3D3D",
  B07: "#4E4A80",
  B08: "#164A37",
};

const nodesById = TREE.nodesById;

// 1. Compute subtree weights to give dense leaf clusters proportionally wide angular arcs
const weights = new Map();
function calcWeight(id) {
  const n = nodesById[id];
  if (!n) return 1;
  if (!n.childrenIds || n.childrenIds.length === 0) {
    weights.set(id, 1);
    return 1;
  }
  let sum = 0;
  for (const cid of n.childrenIds) sum += calcWeight(cid);
  // Ensure branches/sub-nodes don't shrink below clean visual floor
  const val = n.generation === 1 ? Math.max(4.5, sum) : Math.max(1, sum);
  weights.set(id, val);
  return val;
}
for (const bid of nodesById["R00"].childrenIds) calcWeight(bid);

// 2. Assign angular sectors right-to-left around canopy:
// Start from right-lower edge (+54 deg) moving counter-clockwise through 0 (right), -90 (top 12 o'clock), -180 (left), to -234 (left-lower, i.e. 126 deg)
// Total canopy span = 288 deg; open southern trunk corridor = +54 to +126 deg (72 deg straight down)
const branchOrder = [...nodesById["R00"].childrenIds]; // B01..B08
const totalWeight = branchOrder.reduce((a, b) => a + weights.get(b), 0);
const SECTOR_GAP_DEG = 2.6;
const TOTAL_SPAN = 288 - SECTOR_GAP_DEG * (branchOrder.length - 1);

const nodeAngles = new Map(); // id -> { deg, midRad }
function assignAngles(id, aStart, aEnd) {
  const n = nodesById[id];
  const aMid = (aStart + aEnd) / 2;
  nodeAngles.set(id, { deg: aMid, rad: (aMid * Math.PI) / 180, aStart, aEnd });
  if (!n.childrenIds || n.childrenIds.length === 0) return;

  const chWeights = n.childrenIds.map((c) => weights.get(c) || 1);
  const chSum = chWeights.reduce((a, b) => a + b, 0);
  let cur = aStart;
  for (let i = 0; i < n.childrenIds.length; i++) {
    const cid = n.childrenIds[i];
    const span = ((aEnd - aStart) * chWeights[i]) / chSum;
    assignAngles(cid, cur, cur + span);
    cur += span;
  }
}

let cursorDeg = 54; // clockwise positive -> going decreasing (CCW) from +54 down to -234
for (let i = 0; i < branchOrder.length; i++) {
  const bid = branchOrder[i];
  const span = (TOTAL_SPAN * weights.get(bid)) / totalWeight;
  assignAngles(bid, cursorDeg, cursorDeg - span);
  cursorDeg = cursorDeg - span - SECTOR_GAP_DEG;
}

// 3. Assign staggered radii per generation to mathematically avoid any overlap
const GEN_RADII = {
  1: [400],
  2: [655],
  3: [925],
  4: [1195, 1325],
  5: [1480, 1605, 1730, 1855],
  6: [2010, 2145],
  7: [2300],
  8: [2445],
};

// Sort each generation globally by angle so round-robin tier assignment alternates cleanly across neighbors
const byGen = new Map();
for (const n of Object.values(nodesById)) {
  if (n.generation >= 1) {
    if (!byGen.has(n.generation)) byGen.set(n.generation, []);
    byGen.get(n.generation).push(n);
  }
}
const nodePos = new Map(); // id -> { x, y, r, deg, rad, w, h, fontSize, isBranch, isParent }
for (const [gen, list] of byGen.entries()) {
  list.sort((a, b) => nodeAngles.get(b.id).deg - nodeAngles.get(a.id).deg);
  const tiers = GEN_RADII[gen] || [2445];
  // Group by sub-tier to enforce minimum angular chord spacing >= h + 5 px
  const byTier = new Map();
  for (let idx = 0; idx < list.length; idx++) {
    const n = list[idx];
    const r = tiers[idx % tiers.length];
    const ang = nodeAngles.get(n.id);
    const isParent = n.childrenCount > 0;
    const isBranch = n.generation === 1;
    let w = 102, h = 21, fontSize = 13.5;
    if (isBranch) { w = 166; h = 48; fontSize = 26; }
    else if (gen === 2) { w = 136; h = 36; fontSize = 19; }
    else if (gen === 3) { w = 116; h = 28; fontSize = 16; }
    else if (isParent) { w = 104; h = 22; fontSize = 14; }
    else { w = 96; h = 19.5; fontSize = 13; }

    if (n.name.length >= 9 && !isBranch) w += 18;
    else if (n.name.length >= 7 && !isBranch) w += 8;

    const item = { n, r, deg: ang.deg, rad: ang.rad, w, h, fontSize, isBranch, isParent, x: 0, y: 0 };
    if (!byTier.has(r)) byTier.set(r, []);
    byTier.get(r).push(item);
    nodePos.set(n.id, item);
  }

  // Tangential separation pass within each sub-tier so arc gap never falls below pill thickness + 6px
  for (const [r, tierList] of byTier.entries()) {
    tierList.sort((a, b) => a.deg - b.deg); // -234 up to +54
    for (let iter = 0; iter < 12; iter++) {
      for (let i = 0; i < tierList.length - 1; i++) {
        const A = tierList[i], B = tierList[i + 1];
        const minDeg = ((Math.max(A.h, B.h) + 6) / r) * (180 / Math.PI);
        const diff = B.deg - A.deg;
        if (diff < minDeg) {
          const push = (minDeg - diff) * 0.52;
          A.deg = Math.max(-235, A.deg - push);
          B.deg = Math.min(55, B.deg + push);
        }
      }
    }
    for (const item of tierList) {
      item.rad = (item.deg * Math.PI) / 180;
      item.x = CX + item.r * Math.cos(item.rad);
      item.y = CY + item.r * Math.sin(item.rad);
    }
  }
}

// Root Uwaid at (CX, CY)
nodePos.set("R00", { n: nodesById["R00"], x: CX, y: CY, r: 0, deg: -90, rad: -Math.PI / 2, w: 320, h: 320, fontSize: 64, isRoot: true });

// 4. OBB collision audit across all descendant nodes
function obbOverlapCount(items) {
  function corners(p) {
    const c = Math.cos(p.rad), s = Math.sin(p.rad);
    const hw = p.w / 2 - 2, hh = p.h / 2 - 2;
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
        [Math.cos(A.p.rad), Math.sin(A.p.rad)],
        [-Math.sin(A.p.rad), Math.cos(A.p.rad)],
        [Math.cos(B.p.rad), Math.sin(B.p.rad)],
        [-Math.sin(B.p.rad), Math.cos(B.p.rad)],
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

const descItems = [...nodePos.values()].filter((p) => !p.isRoot);
const overlaps = obbOverlapCount(descItems);
console.log(`Mural layout ready: descendants=${descItems.length}, total=${Object.keys(nodesById).length}, OBB_overlaps=${overlaps}`);

// 5. Build SVG document
const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
out.push(`<defs>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&amp;family=IBM+Plex+Sans+Arabic:wght@500;600;700&amp;display=swap');
    .m-serif { font-family: 'Amiri', 'Traditional Arabic', serif; }
    .m-sans  { font-family: 'IBM Plex Sans Arabic', 'Tahoma', sans-serif; }
  </style>
  <radialGradient id="parchmentGlow" cx="50%" cy="52%" r="60%">
    <stop offset="0%" stop-color="#FFFDF8"/>
    <stop offset="65%" stop-color="#F6F1E4"/>
    <stop offset="100%" stop-color="#ECE3D0"/>
  </radialGradient>
  <radialGradient id="emeraldMedallion" cx="50%" cy="35%" r="70%">
    <stop offset="0%" stop-color="#194B3A"/>
    <stop offset="65%" stop-color="#12372A"/>
    <stop offset="100%" stop-color="#091E16"/>
  </radialGradient>
  <linearGradient id="goldSheen" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#E7CD90"/>
    <stop offset="50%" stop-color="#C9A45A"/>
    <stop offset="100%" stop-color="#9A7426"/>
  </linearGradient>
  <linearGradient id="trunkGrad" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="#4A3520"/>
    <stop offset="50%" stop-color="#6B4D2F"/>
    <stop offset="100%" stop-color="#4A3520"/>
  </linearGradient>
</defs>`);

// Background & Luxury Border Frame
out.push(`<rect width="${W}" height="${H}" fill="url(#parchmentGlow)"/>`);
out.push(`<rect x="54" y="54" width="${W - 108}" height="${H - 108}" rx="28" fill="none" stroke="#12372A" stroke-width="18"/>`);
out.push(`<rect x="82" y="82" width="${W - 164}" height="${H - 164}" rx="18" fill="none" stroke="url(#goldSheen)" stroke-width="5"/>`);
out.push(`<rect x="104" y="104" width="${W - 208}" height="${H - 208}" rx="12" fill="none" stroke="#C9A45A" stroke-width="1.6" stroke-dasharray="6 10" stroke-opacity="0.65"/>`);

// Four Heritage Corner Diamonds
for (const [cx, cy] of [[104, 104], [W - 104, 104], [104, H - 104], [W - 104, H - 104]]) {
  out.push(`<g transform="translate(${cx},${cy})">
    <circle r="28" fill="#12372A" stroke="#C9A45A" stroke-width="3"/>
    <polygon points="0,-16 16,0 0,16 -16,0" fill="#E2C88B"/>
  </g>`);
}

// Subtle Concentric Canopy Guide Rings
for (const rGuide of [420, 690, 970, 1300, 1680, 2100]) {
  out.push(`<circle cx="${CX}" cy="${CY}" r="${rGuide}" fill="none" stroke="#C9A45A" stroke-width="1.2" stroke-opacity="0.16" stroke-dasharray="8 12"/>`);
}

// Top Royal Header: Pure-path Logo #2 Wordmark + Pure-path Subtext + Verse & Hadith Cartouches
const wScale = 1480 / TRACED.wordBB.w;
const wTx = CX - TRACED.wordBB.cx * wScale;
const wTy = 375 - TRACED.wordBB.cy * wScale;
const sScale = 1120 / TRACED.subBB.w;
const sTx = CX - TRACED.subBB.cx * sScale;
const sTy = 755 - TRACED.subBB.cy * sScale;

out.push(`<g id="mural-header">
  <g transform="translate(${wTx.toFixed(1)}, ${wTy.toFixed(1)}) scale(${wScale.toFixed(4)})">
    <path d="${TRACED.wordD}" fill="#12372A" fill-rule="evenodd"/>
  </g>
  <line x1="2050" y1="648" x2="2668" y2="648" stroke="#C9A45A" stroke-width="3.5" stroke-linecap="round"/>
  <line x1="2732" y1="648" x2="3350" y2="648" stroke="#C9A45A" stroke-width="3.5" stroke-linecap="round"/>
  <polygon points="2700,632 2716,648 2700,664 2684,648" fill="#C9A45A"/>
  <g transform="translate(${sTx.toFixed(1)}, ${sTy.toFixed(1)}) scale(${sScale.toFixed(4)})">
    <path d="${TRACED.subD}" fill="#12372A" fill-rule="evenodd"/>
  </g>
</g>`);

// Top-Right Quranic Verse Cartouche & Top-Left Hadith Cartouche
function pushCartouche(x, y, w, h, title, lines, footerTxt) {
  out.push(`<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="#FFFDF8" stroke="#C9A45A" stroke-width="3"/>
    <rect x="${x + 12}" y="${y + 12}" width="${w - 24}" height="${h - 24}" rx="14" fill="none" stroke="#12372A" stroke-width="1.2" stroke-opacity="0.35"/>
    <rect x="${x + w / 2 - 190}" y="${y - 22}" width="380" height="44" rx="22" fill="#12372A" stroke="#C9A45A" stroke-width="2.5"/>
    <text x="${x + w / 2}" y="${y + 8}" text-anchor="middle" fill="#E2C88B" font-size="26" font-weight="700" class="m-sans">${esc(title)}</text>`);
  lines.forEach((ln, idx) => {
    out.push(`<text x="${x + w / 2}" y="${y + 92 + idx * 54}" text-anchor="middle" fill="#12372A" font-size="33" font-weight="700" class="m-serif">${esc(ln)}</text>`);
  });
  if (footerTxt) {
    out.push(`<text x="${x + w / 2}" y="${y + h - 34}" text-anchor="middle" fill="#8A6826" font-size="22" font-weight="700" class="m-sans">${esc(footerTxt)}</text>`);
  }
  out.push(`</g>`);
}

pushCartouche(
  3820, 210, 1340, 390,
  "الآية الكريمة",
  [
    "﴿ يَا أَيُّهَا النَّاسُ إِنَّا خَلَقْنَاكُمْ مِنْ ذَكَرٍ وَأُنْثَىٰ",
    "وَجَعَلْنَاكُمْ شُعُوبًا وَقَبَائِلَ لِتَعَارَفُوا ۚ إِنَّ أَكْرَمَكُمْ",
    "عِنْدَ اللَّهِ أَتْقَاكُمْ ۚ إِنَّ اللَّهَ عَلِيمٌ خَبِيرٌ ﴾"
  ],
  "سورة الحجرات — الآية ١٣"
);

pushCartouche(
  240, 210, 1340, 390,
  "الحديث الشريف",
  [
    "روي عن النبي ﷺ أنه قال:",
    "«تعلّموا من أنسابكم ما تصلون به أرحامكم؛",
    "فإن صلة الرحم محبّة في الأهل، مثراة في المال، منسأة في الأثر»"
  ],
  "حفظ النسب وصلة الأرحام"
);

// 6. Edges Layer (Curved Organic Radial Limbs)
out.push(`<g id="mural-edges">`);
for (const p of descItems) {
  const parentId = p.n.parentId;
  const pp = nodePos.get(parentId);
  if (!pp) continue;
  const col = BRANCH_COLORS[p.n.branchId] || "#12372A";
  const strokeW = p.n.generation === 1 ? 10 : p.n.generation === 2 ? 5.5 : p.n.generation === 3 ? 3.2 : 1.75;
  const opacity = p.n.generation <= 2 ? 0.85 : p.n.generation === 3 ? 0.72 : 0.56;

  if (pp.isRoot) {
    const rStart = 158;
    const x1 = CX + rStart * Math.cos(p.rad);
    const y1 = CY + rStart * Math.sin(p.rad);
    const rm = rStart + (p.r - rStart) * 0.52;
    const cx1 = CX + rm * Math.cos(p.rad);
    const cy1 = CY + rm * Math.sin(p.rad);
    out.push(`<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx1.toFixed(1)} ${cy1.toFixed(1)}, ${p.x.toFixed(1)} ${p.y.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${strokeW}" stroke-opacity="${opacity}" stroke-linecap="round"/>`);
  } else {
    const dr = p.r - pp.r;
    const cr1 = pp.r + dr * 0.45;
    const cr2 = p.r - dr * 0.32;
    const cx1 = CX + cr1 * Math.cos(pp.rad);
    const cy1 = CY + cr1 * Math.sin(pp.rad);
    const cx2 = CX + cr2 * Math.cos(p.rad);
    const cy2 = CY + cr2 * Math.sin(p.rad);
    out.push(`<path d="M ${pp.x.toFixed(1)} ${pp.y.toFixed(1)} C ${cx1.toFixed(1)} ${cy1.toFixed(1)}, ${cx2.toFixed(1)} ${cy2.toFixed(1)}, ${p.x.toFixed(1)} ${p.y.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${strokeW}" stroke-opacity="${opacity}" stroke-linecap="round"/>`);
  }
}
out.push(`</g>`);

// 7. Southern Ancestral Trunk Pedestal (-10 to -1 up to Uwaid R00)
const ancOrder = [];
for (let g = -10; g <= -1; g++) {
  const found = Object.values(nodesById).find((n) => n.generation === g);
  if (found) ancOrder.push(found);
}
// Bottom qahTan at y = 6360 rising to Muslih at y = 4140
const trunkTopY = 4120;
const trunkBotY = 6360;
const stepY = (trunkBotY - trunkTopY) / Math.max(1, ancOrder.length - 1);

out.push(`<g id="mural-trunk">
  <path d="M ${CX - 165} 6500 C ${CX - 110} 6200, ${CX - 76} 5000, ${CX - 48} ${CY + 140} L ${CX + 48} ${CY + 140} C ${CX + 76} 5000, ${CX + 110} 6200, ${CX + 165} 6500 Z" fill="url(#trunkGrad)" stroke="#C9A45A" stroke-width="5"/>
  <line x1="${CX}" y1="${CY + 160}" x2="${CX}" y2="${trunkBotY}" stroke="#E2C88B" stroke-width="4" stroke-opacity="0.7"/>
`);
ancOrder.forEach((anc, idx) => {
  // idx=0 is gen -10 (قحطان -> bottom trunkBotY), idx=9 is gen -1 (مصلح -> trunkTopY)
  const y = trunkBotY - idx * stepY;
  const isQahtan = idx === 0;
  const bw = isQahtan ? 320 : 230;
  const bh = isQahtan ? 76 : 58;
  out.push(`<g transform="translate(${CX}, ${y.toFixed(1)})">
    <rect x="${-bw / 2}" y="${-bh / 2}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${isQahtan ? "#12372A" : "#FFFDF8"}" stroke="#C9A45A" stroke-width="${isQahtan ? 5 : 3}"/>
    <text x="0" y="${isQahtan ? 10 : 8}" text-anchor="middle" fill="${isQahtan ? "#E2C88B" : "#12372A"}" font-size="${isQahtan ? 38 : 30}" font-weight="700" class="m-serif">${esc(anc.name)}</text>
  </g>`);
});
out.push(`</g>`);

// 8. All 749 Descendant Nodes Layer
out.push(`<g id="mural-nodes">`);
for (const p of descItems) {
  const col = BRANCH_COLORS[p.n.branchId] || "#12372A";
  // Keep text readable upright: flip 180 deg when left side (cos < 0)
  let rotDeg = p.deg;
  if (Math.cos(p.rad) < 0) rotDeg += 180;

  let fill = "#FFFDF8";
  let stroke = col;
  let sw = 1.6;
  let textFill = "#1A1A1A";
  let cls = "m-sans";

  if (p.isBranch) {
    fill = col;
    stroke = "#E2C88B";
    sw = 3.2;
    textFill = "#FFFDF8";
    cls = "m-serif";
  } else if (p.n.generation === 2) {
    fill = "#FFFDF8";
    stroke = col;
    sw = 3.0;
    textFill = col;
    cls = "m-serif";
  } else if (p.isParent) {
    fill = "#FFFBF2";
    stroke = col;
    sw = 2.1;
    textFill = "#12372A";
  } else {
    fill = "#F9F4E8";
    stroke = col;
    sw = 1.25;
    textFill = "#2A2620";
  }

  out.push(`<g transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) rotate(${rotDeg.toFixed(2)})">
    <rect x="${(-p.w / 2).toFixed(1)}" y="${(-p.h / 2).toFixed(1)}" width="${p.w}" height="${p.h}" rx="${(p.h / 2).toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
    <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="${textFill}" font-size="${p.fontSize}" font-weight="700" class="${cls}">${esc(p.n.name)}</text>
  </g>`);
}
out.push(`</g>`);

// 9. Central Grand Medallion for الجد عويض (R00)
out.push(`<g id="mural-root" transform="translate(${CX}, ${CY})">
  <circle r="176" fill="none" stroke="url(#goldSheen)" stroke-width="5" stroke-opacity="0.7"/>
  <circle r="162" fill="url(#emeraldMedallion)" stroke="url(#goldSheen)" stroke-width="8"/>
  <circle r="144" fill="none" stroke="#E2C88B" stroke-width="2" stroke-opacity="0.75"/>
  <text x="0" y="2" text-anchor="middle" fill="#FFFDF8" font-size="80" font-weight="700" class="m-serif">عويض</text>
  <text x="0" y="54" text-anchor="middle" fill="#E2C88B" font-size="21" font-weight="700" class="m-sans">جد ذوي عويض • ٧٤٩ ذرية</text>
</g>`);

// 10. Bottom Ceremonial Cartouches (Left: Footnote & Stats, Right: Seal + Branch Key)
// Bottom-Right Panel (x: 3440..5180, y: 5750..6520)
const brX = 3440, brY = 5750, brW = 1740, brH = 770;
const sealS = 310 / TRACED.sealBB.w;
const sealCx = brX + 240;
const sealCy = brY + 340;
const sealTx = sealCx - TRACED.sealBB.cx * sealS;
const sealTy = sealCy - TRACED.sealBB.cy * sealS;

out.push(`<g id="mural-legend-box">
  <rect x="${brX}" y="${brY}" width="${brW}" height="${brH}" rx="26" fill="#FFFDF8" stroke="#C9A45A" stroke-width="4"/>
  <rect x="${brX + 14}" y="${brY + 14}" width="${brW - 28}" height="${brH - 28}" rx="18" fill="none" stroke="#12372A" stroke-width="1.4" stroke-opacity="0.3"/>
  <text x="${brX + brW - 54}" y="${brY + 86}" text-anchor="end" fill="#12372A" font-size="44" font-weight="700" class="m-serif">مفتاح الفروع الثمانية لذوي عويض</text>
  <line x1="${brX + 460}" y1="${brY + 114}" x2="${brX + brW - 54}" y2="${brY + 114}" stroke="#C9A45A" stroke-width="2.5"/>
  <g transform="translate(${sealTx.toFixed(1)}, ${sealTy.toFixed(1)}) scale(${sealS.toFixed(4)})">
    <path d="${TRACED.sealD}" fill="#12372A" fill-rule="evenodd"/>
  </g>
  <text x="${sealCx}" y="${brY + 560}" text-anchor="middle" fill="#12372A" font-size="22" font-weight="700" class="m-sans">من البصصة قبيلة الشدادين بني الحارث</text>
`);

// 2 columns x 4 rows branch pills inside brX + 470 .. brX + brW - 50
TREE.branchStats.forEach((bs, idx) => {
  const colIdx = Math.floor(idx / 4); // 0 right col, 1 left col
  const rowIdx = idx % 4;
  const px = colIdx === 0 ? brX + brW - 60 : brX + brW - 640;
  const py = brY + 185 + rowIdx * 124;
  const c = BRANCH_COLORS[bs.branchId] || "#12372A";
  out.push(`<g>
    <rect x="${px - 510}" y="${py}" width="510" height="88" rx="18" fill="#F8F4EA" stroke="${c}" stroke-width="3"/>
    <circle cx="${px - 44}" cy="${py + 44}" r="18" fill="${c}"/>
    <text x="${px - 80}" y="${py + 54}" text-anchor="end" fill="#12372A" font-size="34" font-weight="700" class="m-serif">${esc(bs.name)}</text>
    <text x="${px - 486}" y="${py + 53}" text-anchor="start" fill="${c}" font-size="28" font-weight="700" class="m-sans">${toArabic(bs.totalInBranch)} اسماً</text>
  </g>`);
});
out.push(`</g>`);

// Bottom-Left Panel (x: 220..1960, y: 5750..6520)
const blX = 220, blY = 5750, blW = 1740, blH = 770;
const footnote = (TREE.meta.lineageFootnotes && TREE.meta.lineageFootnotes[0]) || "";
out.push(`<g id="mural-lineage-box">
  <rect x="${blX}" y="${blY}" width="${blW}" height="${blH}" rx="26" fill="#FFFDF8" stroke="#C9A45A" stroke-width="4"/>
  <rect x="${blX + 14}" y="${blY + 14}" width="${blW - 28}" height="${blH - 28}" rx="18" fill="none" stroke="#12372A" stroke-width="1.4" stroke-opacity="0.3"/>
  <text x="${blX + blW - 54}" y="${blY + 86}" text-anchor="end" fill="#12372A" font-size="44" font-weight="700" class="m-serif">التوثيق وعمود النسب الكامل</text>
  <line x1="${blX + 54}" y1="${blY + 114}" x2="${blX + blW - 54}" y2="${blY + 114}" stroke="#C9A45A" stroke-width="2.5"/>
  <text x="${blX + blW - 54}" y="${blY + 190}" text-anchor="end" fill="#12372A" font-size="32" font-weight="700" class="m-serif">ذوي عويض بن مصلح بن مسفر بن بصيص بن دمشق بن ملفي</text>
  <text x="${blX + blW - 54}" y="${blY + 246}" text-anchor="end" fill="#12372A" font-size="32" font-weight="700" class="m-serif">بن مفلح بن عياش بن شداد بن حارث بن قحطان</text>
  <text x="${blX + blW - 54}" y="${blY + 322}" text-anchor="end" fill="#8A6826" font-size="27" font-weight="700" class="m-sans">من البصصة قبيلة الشدادين بني الحارث</text>

  <rect x="${blX + 54}" y="${blY + 365}" width="${blW - 108}" height="186" rx="16" fill="#F8F4EA" stroke="#DED4BE" stroke-width="2"/>
  <text x="${blX + blW - 84}" y="${blY + 416}" text-anchor="end" fill="#12372A" font-size="24" font-weight="700" class="m-sans">الحاشية والتوثيق:</text>
  <text x="${blX + blW - 84}" y="${blY + 462}" text-anchor="end" fill="#46423A" font-size="22" font-weight="500" class="m-sans">ذُكر في الحاشية الشفهية عند بعض كبار السن وجود اسم (مسفر) إضافي بين عويض ومصلح،</text>
  <text x="${blX + blW - 84}" y="${blY + 502}" text-anchor="end" fill="#46423A" font-size="22" font-weight="500" class="m-sans">والمعتمد في النسخة المحرّرة التسلسل المثبت في الجذع المتّصل أعلاه إلى قحطان.</text>

  <rect x="${blX + 54}" y="${blY + 592}" width="${blW - 108}" height="114" rx="18" fill="#12372A" stroke="#C9A45A" stroke-width="2.5"/>
  <text x="${blX + blW / 2}" y="${blY + 644}" text-anchor="middle" fill="#FFFDF8" font-size="29" font-weight="700" class="m-sans">إجمالي الموثّق في الشجرة: ٧٦٠ اسماً  •  ٨ فروع رئيسية  •  ١٠ أجداد إلى قحطان</text>
  <text x="${blX + blW / 2}" y="${blY + 686}" text-anchor="middle" fill="#E2C88B" font-size="23" font-weight="600" class="m-sans">${esc(TREE.meta.editionLabel)}</text>
</g>`);

out.push(`</svg>`);

const svgPath = path.join(ROOT, "brand", "dhawi-uwaid-wall-mural.svg");
fs.writeFileSync(svgPath, out.join("\n"), "utf8");
console.log("Wrote mural SVG:", svgPath, "size=", fs.statSync(svgPath).size);
