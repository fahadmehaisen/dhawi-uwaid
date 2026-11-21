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

const W = 5400;
const H = 6750;
const CX = 2700;
const CY = 3455; // Lifted closer to top header so canopy fills frame like a stately date palm

const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
const toArabic = (v) => String(v).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
// Explicit Unicode RTL isolate wrapper prevents Chrome SVG from flipping colons or quotes
const rtl = (s) => `\u2067${esc(s)}\u2069`;

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

// 1. Subtree angular weights
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
  const val = n.generation === 1 ? Math.max(4.5, sum) : Math.max(1, sum);
  weights.set(id, val);
  return val;
}
for (const bid of nodesById["R00"].childrenIds) calcWeight(bid);

// 2. Angular range: 284 deg canopy sweeping from +52 deg down/over-top to -232 deg
const branchOrder = [...nodesById["R00"].childrenIds];
const totalWeight = branchOrder.reduce((a, b) => a + weights.get(b), 0);
const SECTOR_GAP_DEG = 2.4;
const TOTAL_SPAN = 284 - SECTOR_GAP_DEG * (branchOrder.length - 1);

const nodeAngles = new Map();
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

let cursorDeg = 52;
for (let i = 0; i < branchOrder.length; i++) {
  const bid = branchOrder[i];
  const span = (TOTAL_SPAN * weights.get(bid)) / totalWeight;
  assignAngles(bid, cursorDeg, cursorDeg - span);
  cursorDeg = cursorDeg - span - SECTOR_GAP_DEG;
}

// 3. Generous enlarged palm frond rings & pill sizes (~45% larger text and pills)
const GEN_RADII = {
  1: [400],
  2: [675],
  3: [955],
  4: [1205, 1378],
  5: [1550, 1720, 1890, 2060],
  6: [2225, 2385],
  7: [2505],
  8: [2568],
};

const byGen = new Map();
for (const n of Object.values(nodesById)) {
  if (n.generation >= 1) {
    if (!byGen.has(n.generation)) byGen.set(n.generation, []);
    byGen.get(n.generation).push(n);
  }
}

const nodePos = new Map();
for (const [gen, list] of byGen.entries()) {
  list.sort((a, b) => nodeAngles.get(b.id).deg - nodeAngles.get(a.id).deg);
  const tiers = GEN_RADII[gen] || [2558];
  const byTier = new Map();

  for (let idx = 0; idx < list.length; idx++) {
    const n = list[idx];
    const r = tiers[idx % tiers.length];
    const ang = nodeAngles.get(n.id);
    const isParent = n.childrenCount > 0;
    const isBranch = n.generation === 1;

    let w = 134, h = 27.5, fontSize = 18;
    if (isBranch) { w = 216; h = 62; fontSize = 36; }
    else if (gen === 2) { w = 176; h = 46; fontSize = 26; }
    else if (gen === 3) { w = 148; h = 36; fontSize = 21.5; }
    else if (isParent) { w = 136; h = 29; fontSize = 19; }
    else { w = 128; h = 26.5; fontSize = 17.5; }

    if (n.name.length >= 9 && !isBranch) w += 18;
    else if (n.name.length >= 7 && !isBranch) w += 8;

    const item = { n, r, deg: ang.deg, rad: ang.rad, w, h, fontSize, isBranch, isParent, x: 0, y: 0 };
    if (!byTier.has(r)) byTier.set(r, []);
    byTier.get(r).push(item);
    nodePos.set(n.id, item);
  }

  for (const [r, tierList] of byTier.entries()) {
    tierList.sort((a, b) => a.deg - b.deg);
    for (let iter = 0; iter < 30; iter++) {
      for (let i = 0; i < tierList.length - 1; i++) {
        const A = tierList[i], B = tierList[i + 1];
        const minDeg = ((Math.max(A.h, B.h) + 6) / r) * (180 / Math.PI);
        const diff = B.deg - A.deg;
        if (diff < minDeg) {
          const push = (minDeg - diff) * 0.55;
          A.deg = Math.max(-232.5, A.deg - push);
          B.deg = Math.min(52.5, B.deg + push);
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

nodePos.set("R00", { n: nodesById["R00"], x: CX, y: CY, r: 0, deg: -90, rad: -Math.PI / 2, w: 324, h: 324, fontSize: 82, isRoot: true });

// 4. OBB collision check
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
console.log(`Palm Wall Mural ready: descendants=${descItems.length}, total=${Object.keys(nodesById).length}, OBB_overlaps=${overlaps}`);

// 5. Build SVG document with RTL directionality on text
const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" lang="ar" xml:lang="ar" direction="rtl" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
out.push(`<defs>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&amp;family=Tajawal:wght@500;700;800&amp;display=swap');
    text { direction: rtl; unicode-bidi: isolate; }
    .m-serif { font-family: 'Amiri', serif; }
    .m-sans  { font-family: 'Tajawal', sans-serif; }
  </style>
  <radialGradient id="parchmentGlow" cx="50%" cy="50%" r="60%">
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
    <stop offset="0%" stop-color="#3F2D1B"/>
    <stop offset="50%" stop-color="#6B4D2F"/>
    <stop offset="100%" stop-color="#3F2D1B"/>
  </linearGradient>
</defs>`);

out.push(`<rect width="${W}" height="${H}" fill="url(#parchmentGlow)"/>`);
out.push(`<rect x="50" y="50" width="${W - 100}" height="${H - 100}" rx="28" fill="none" stroke="#12372A" stroke-width="18"/>`);
out.push(`<rect x="78" y="78" width="${W - 156}" height="${H - 156}" rx="18" fill="none" stroke="url(#goldSheen)" stroke-width="5"/>`);
out.push(`<rect x="100" y="100" width="${W - 200}" height="${H - 200}" rx="12" fill="none" stroke="#C9A45A" stroke-width="1.6" stroke-dasharray="6 10" stroke-opacity="0.65"/>`);

for (const [cx, cy] of [[100, 100], [W - 100, 100], [100, H - 100], [W - 100, H - 100]]) {
  out.push(`<g transform="translate(${cx},${cy})">
    <circle r="28" fill="#12372A" stroke="#C9A45A" stroke-width="3"/>
    <polygon points="0,-16 16,0 0,16 -16,0" fill="#E2C88B"/>
  </g>`);
}

for (const rGuide of [400, 675, 955, 1288, 1780, 2275]) {
  out.push(`<circle cx="${CX}" cy="${CY}" r="${rGuide}" fill="none" stroke="#C9A45A" stroke-width="1.2" stroke-opacity="0.16" stroke-dasharray="8 12"/>`);
}

// Header Centerpiece: Logo #2 Wordmark + Tribal Subtext
const wScale = 1480 / TRACED.wordBB.w;
const wTx = CX - TRACED.wordBB.cx * wScale;
const wTy = 365 - TRACED.wordBB.cy * wScale;
const sScale = 1140 / TRACED.subBB.w;
const sTx = CX - TRACED.subBB.cx * sScale;
const sTy = 720 - TRACED.subBB.cy * sScale;

out.push(`<g id="mural-header">
  <g transform="translate(${wTx.toFixed(1)}, ${wTy.toFixed(1)}) scale(${wScale.toFixed(4)})">
    <path d="${TRACED.wordD}" fill="#12372A" fill-rule="evenodd"/>
  </g>
  <line x1="2050" y1="615" x2="2668" y2="615" stroke="#C9A45A" stroke-width="3.5" stroke-linecap="round"/>
  <line x1="2732" y1="615" x2="3350" y2="615" stroke="#C9A45A" stroke-width="3.5" stroke-linecap="round"/>
  <polygon points="2700,599 2716,615 2700,631 2684,615" fill="#C9A45A"/>
  <g transform="translate(${sTx.toFixed(1)}, ${sTy.toFixed(1)}) scale(${sScale.toFixed(4)})">
    <path d="${TRACED.subD}" fill="#12372A" fill-rule="evenodd"/>
  </g>
</g>`);

// Large Executive Top Cartouches (x: 200..1720 Left, 3680..5200 Right)
function pushCartouche(x, y, w, h, title, lines, footerTxt) {
  out.push(`<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="#FFFDF8" stroke="#C9A45A" stroke-width="3.5"/>
    <rect x="${x + 14}" y="${y + 14}" width="${w - 28}" height="${h - 28}" rx="15" fill="none" stroke="#12372A" stroke-width="1.3" stroke-opacity="0.35"/>
    <rect x="${x + w / 2 - 220}" y="${y - 26}" width="440" height="52" rx="26" fill="#12372A" stroke="#C9A45A" stroke-width="2.5"/>
    <text x="${x + w / 2}" y="${y + 11}" text-anchor="middle" fill="#E2C88B" font-size="32" font-weight="700" class="m-sans">${rtl(title)}</text>`);
  lines.forEach((ln, idx) => {
    out.push(`<text x="${x + w / 2}" y="${y + 120 + idx * 78}" text-anchor="middle" fill="#12372A" font-size="45" font-weight="700" class="m-serif">${rtl(ln)}</text>`);
  });
  if (footerTxt) {
    out.push(`<text x="${x + w / 2}" y="${y + h - 42}" text-anchor="middle" fill="#8A6826" font-size="30" font-weight="700" class="m-sans">${rtl(footerTxt)}</text>`);
  }
  out.push(`</g>`);
}

pushCartouche(
  3660, 195, 1540, 440,
  "الآية الكريمة",
  [
    "﴿ يَا أَيُّهَا النَّاسُ إِنَّا خَلَقْنَاكُمْ مِنْ ذَكَرٍ وَأُنْثَىٰ",
    "وَجَعَلْنَاكُمْ شُعُوبًا وَقَبَائِلَ لِتَعَارَفُوا ۚ إِنَّ أَكْرَمَكُمْ",
    "عِنْدَ اللَّهِ أَتْقَاكُمْ ۚ إِنَّ اللَّهَ عَلِيمٌ خَبِيرٌ ﴾"
  ],
  "سورة الحجرات — الآية ١٣"
);

pushCartouche(
  200, 195, 1540, 440,
  "الحديث الشريف",
  [
    "روي عن النبي ﷺ أنه قال:",
    "«تعلّموا من أنسابكم ما تصلون به أرحامكم؛",
    "فإن صلة الرحم محبّة في الأهل، مثراة في المال، منسأة في الأثر»"
  ],
  "حفظ النسب وصلة الأرحام"
);

// 6. Flowing Palm Frond Limbs
out.push(`<g id="mural-edges">`);
for (const p of descItems) {
  const pp = nodePos.get(p.n.parentId);
  if (!pp) continue;
  const col = BRANCH_COLORS[p.n.branchId] || "#12372A";
  const strokeW = p.n.generation === 1 ? 11 : p.n.generation === 2 ? 6.0 : p.n.generation === 3 ? 3.5 : 1.9;
  const opacity = p.n.generation <= 2 ? 0.88 : p.n.generation === 3 ? 0.74 : 0.58;

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

// 7. Sculpted Palm Trunk (`جذع النخلة`) with Subtle Leaf-Scale Texture + 10 Ancestor Badges
const ancOrder = [];
for (let g = -10; g <= -1; g++) {
  const found = Object.values(nodesById).find((n) => n.generation === g);
  if (found) ancOrder.push(found);
}
const trunkTopY = 3900;
const trunkBotY = 6365;
const stepY = (trunkBotY - trunkTopY) / Math.max(1, ancOrder.length - 1);

out.push(`<g id="mural-trunk">
  <path d="M ${CX - 185} 6505 C ${CX - 125} 6150, ${CX - 82} 4950, ${CX - 54} ${CY + 140} L ${CX + 54} ${CY + 140} C ${CX + 82} 4950, ${CX + 125} 6150, ${CX + 185} 6505 Z" fill="url(#trunkGrad)" stroke="#C9A45A" stroke-width="5"/>`);

// Subtle palm-trunk chevron segments (`سعف وجذع النخلة`) between trunk medallions
for (let ty = trunkTopY - 120; ty <= trunkBotY + 40; ty += 95) {
  const tNorm = (ty - (CY + 140)) / (6505 - (CY + 140));
  const halfW = 54 + Math.pow(Math.max(0, tNorm), 1.35) * 124;
  out.push(`<path d="M ${(CX - halfW + 10).toFixed(1)} ${ty} Q ${CX} ${(ty + 38).toFixed(1)}, ${(CX + halfW - 10).toFixed(1)} ${ty}" fill="none" stroke="#C9A45A" stroke-width="2.2" stroke-opacity="0.36"/>`);
}

out.push(`<line x1="${CX}" y1="${CY + 160}" x2="${CX}" y2="${trunkBotY}" stroke="#E2C88B" stroke-width="4" stroke-opacity="0.72"/>`);

ancOrder.forEach((anc, idx) => {
  const y = trunkBotY - idx * stepY;
  const isQahtan = idx === 0;
  const bw = isQahtan ? 350 : 254;
  const bh = isQahtan ? 82 : 62;
  out.push(`<g transform="translate(${CX}, ${y.toFixed(1)})">
    <rect x="${-bw / 2}" y="${-bh / 2}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${isQahtan ? "#12372A" : "#FFFDF8"}" stroke="#C9A45A" stroke-width="${isQahtan ? 5.5 : 3.2}"/>
    <text x="0" y="${isQahtan ? 12 : 10}" text-anchor="middle" fill="${isQahtan ? "#E2C88B" : "#12372A"}" font-size="${isQahtan ? 44 : 34}" font-weight="700" class="m-serif">${rtl(anc.name)}</text>
  </g>`);
});
out.push(`</g>`);

// 8. Enlarged 749 Descendant Nodes
out.push(`<g id="mural-nodes">`);
for (const p of descItems) {
  const col = BRANCH_COLORS[p.n.branchId] || "#12372A";
  let rotDeg = p.deg;
  if (Math.cos(p.rad) < 0) rotDeg += 180;

  let fill = "#FFFDF8";
  let stroke = col;
  let sw = 1.6;
  let textFill = "#1A1A1A";
  let cls = "m-sans";

  if (p.isBranch) {
    fill = col; stroke = "#E2C88B"; sw = 3.5; textFill = "#FFFDF8"; cls = "m-serif";
  } else if (p.n.generation === 2) {
    fill = "#FFFDF8"; stroke = col; sw = 3.2; textFill = col; cls = "m-serif";
  } else if (p.isParent) {
    fill = "#FFFBF2"; stroke = col; sw = 2.3; textFill = "#12372A";
  } else {
    fill = "#F9F4E8"; stroke = col; sw = 1.4; textFill = "#1F1C18";
  }

  out.push(`<g transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) rotate(${rotDeg.toFixed(2)})">
    <rect x="${(-p.w / 2).toFixed(1)}" y="${(-p.h / 2).toFixed(1)}" width="${p.w}" height="${p.h}" rx="${(p.h / 2).toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
    <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="${textFill}" font-size="${p.fontSize}" font-weight="700" class="${cls}">${rtl(p.n.name)}</text>
  </g>`);
}
out.push(`</g>`);

// 9. Central Grand Palm Crown Medallion for عويض (R00)
out.push(`<g id="mural-root" transform="translate(${CX}, ${CY})">
  <circle r="180" fill="none" stroke="url(#goldSheen)" stroke-width="5" stroke-opacity="0.72"/>
  <circle r="165" fill="url(#emeraldMedallion)" stroke="url(#goldSheen)" stroke-width="8"/>
  <circle r="147" fill="none" stroke="#E2C88B" stroke-width="2" stroke-opacity="0.78"/>
  <text x="0" y="0" text-anchor="middle" fill="#FFFDF8" font-size="84" font-weight="700" class="m-serif">${rtl("عويض")}</text>
  <text x="0" y="58" text-anchor="middle" fill="#E2C88B" font-size="24" font-weight="700" class="m-sans">${rtl("جد ذوي عويض • ٧٤٩ ذرية")}</text>
</g>`);

// 10. Bottom Ceremonial Cartouches (Enlarged Readable Typography + Fixed RTL Brackets)
const brX = 3300, brY = 5660, brW = 1900, brH = 870;
const sealS = 350 / TRACED.sealBB.w;
const sealCx = brX + 255;
const sealCy = brY + 385;
const sealTx = sealCx - TRACED.sealBB.cx * sealS;
const sealTy = sealCy - TRACED.sealBB.cy * sealS;

out.push(`<g id="mural-legend-box">
  <rect x="${brX}" y="${brY}" width="${brW}" height="${brH}" rx="28" fill="#FFFDF8" stroke="#C9A45A" stroke-width="4"/>
  <rect x="${brX + 16}" y="${brY + 16}" width="${brW - 32}" height="${brH - 32}" rx="20" fill="none" stroke="#12372A" stroke-width="1.5" stroke-opacity="0.32"/>
  <text x="${brX + brW - 56}" y="${brY + 94}" text-anchor="start" fill="#12372A" font-size="52" font-weight="700" class="m-serif">${rtl("مفتاح الفروع الثمانية لذوي عويض")}</text>
  <line x1="${brX + 490}" y1="${brY + 124}" x2="${brX + brW - 56}" y2="${brY + 124}" stroke="#C9A45A" stroke-width="2.5"/>
  <g transform="translate(${sealTx.toFixed(1)}, ${sealTy.toFixed(1)}) scale(${sealS.toFixed(4)})">
    <path d="${TRACED.sealD}" fill="#12372A" fill-rule="evenodd"/>
  </g>
  <text x="${sealCx}" y="${brY + 640}" text-anchor="middle" fill="#12372A" font-size="27" font-weight="700" class="m-serif">${rtl("من البصصة قبيلة الشدادين بني الحارث")}</text>
`);

TREE.branchStats.forEach((bs, idx) => {
  const colIdx = Math.floor(idx / 4);
  const rowIdx = idx % 4;
  const px = colIdx === 0 ? brX + brW - 56 : brX + brW - 700;
  const py = brY + 190 + rowIdx * 148;
  const c = BRANCH_COLORS[bs.branchId] || "#12372A";
  out.push(`<g>
    <rect x="${px - 595}" y="${py}" width="595" height="106" rx="22" fill="#F8F4EA" stroke="${c}" stroke-width="3.2"/>
    <circle cx="${px - 48}" cy="${py + 53}" r="20" fill="${c}"/>
    <text x="${px - 88}" y="${py + 66}" text-anchor="start" fill="#12372A" font-size="40" font-weight="700" class="m-serif">${rtl(bs.name)}</text>
    <text x="${px - 566}" y="${py + 64}" text-anchor="end" fill="${c}" font-size="31" font-weight="700" class="m-sans">${rtl(`${toArabic(bs.totalInBranch)} اسماً`)}</text>
  </g>`);
});
out.push(`</g>`);

// Bottom-Left Panel
const blX = 200, blY = 5660, blW = 1900, blH = 870;
out.push(`<g id="mural-lineage-box">
  <rect x="${blX}" y="${blY}" width="${blW}" height="${blH}" rx="28" fill="#FFFDF8" stroke="#C9A45A" stroke-width="4"/>
  <rect x="${blX + 16}" y="${blY + 16}" width="${blW - 32}" height="${blH - 32}" rx="20" fill="none" stroke="#12372A" stroke-width="1.5" stroke-opacity="0.32"/>
  <text x="${blX + blW - 56}" y="${blY + 94}" text-anchor="start" fill="#12372A" font-size="52" font-weight="700" class="m-serif">${rtl("التوثيق وعمود النسب الكامل")}</text>
  <line x1="${blX + 56}" y1="${blY + 124}" x2="${blX + blW - 56}" y2="${blY + 124}" stroke="#C9A45A" stroke-width="2.5"/>
  <text x="${blX + blW - 56}" y="${blY + 204}" text-anchor="start" fill="#12372A" font-size="40" font-weight="700" class="m-serif">${rtl("ذوي عويض بن مصلح بن مسفر بن بصيص بن دمشق بن ملفي")}</text>
  <text x="${blX + blW - 56}" y="${blY + 266}" text-anchor="start" fill="#12372A" font-size="40" font-weight="700" class="m-serif">${rtl("بن مفلح بن عياش بن شداد بن حارث بن قحطان")}</text>
  <text x="${blX + blW - 56}" y="${blY + 346}" text-anchor="start" fill="#8A6826" font-size="34" font-weight="700" class="m-serif">${rtl("من البصصة قبيلة الشدادين بني الحارث")}</text>

  <rect x="${blX + 56}" y="${blY + 392}" width="${blW - 112}" height="216" rx="18" fill="#F8F4EA" stroke="#DED4BE" stroke-width="2.5"/>
  <text x="${blX + blW - 88}" y="${blY + 448}" text-anchor="start" fill="#12372A" font-size="30" font-weight="700" class="m-sans">${rtl("الحاشية والتوثيق:")}</text>
  <text x="${blX + blW - 88}" y="${blY + 504}" text-anchor="start" fill="#3D3932" font-size="27" font-weight="500" class="m-sans">${rtl("ذُكر في الحاشية الشفهية عند بعض كبار السن وجود اسم (مسفر) إضافي بين عويض ومصلح،")}</text>
  <text x="${blX + blW - 88}" y="${blY + 554}" text-anchor="start" fill="#3D3932" font-size="27" font-weight="500" class="m-sans">${rtl("والمعتمد في النسخة المحرّرة التسلسل المثبت في الجذع المتّصل أعلاه إلى قحطان.")}</text>

  <rect x="${blX + 56}" y="${blY + 650}" width="${blW - 112}" height="150" rx="22" fill="#12372A" stroke="#C9A45A" stroke-width="2.8"/>
  <text x="${blX + blW / 2}" y="${blY + 712}" text-anchor="middle" fill="#FFFDF8" font-size="35" font-weight="700" class="m-sans">${rtl("إجمالي الموثّق في الشجرة: ٧٦٠ اسماً  •  ٨ فروع رئيسية  •  ١٠ أجداد إلى قحطان")}</text>
  <text x="${blX + blW / 2}" y="${blY + 764}" text-anchor="middle" fill="#E2C88B" font-size="28" font-weight="700" class="m-sans">${rtl(TREE.meta.editionLabel)}</text>
</g>`);

out.push(`</svg>`);

const svgPath = path.join(ROOT, "brand", "dhawi-uwaid-wall-mural.svg");
fs.writeFileSync(svgPath, out.join("\n"), "utf8");
console.log("Wrote upgraded Palm Wall Mural SVG:", svgPath, "size=", fs.statSync(svgPath).size);
