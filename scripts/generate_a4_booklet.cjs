const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = "c:\\Projects\\dhawi-uwaid";
const TREE = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "tree.json"), "utf8"));
const MURAL_SVG = fs.readFileSync(path.join(ROOT, "brand", "dhawi-uwaid-wall-mural.svg"), "utf8");
const PDF_OUT = path.join(ROOT, "brand", "شجرة_ذوي_عويض_طباعة_A4_واضحة.pdf");

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
  B01: { stroke: "#1B6851", leafFill: "#E6F3EC", bough: "#295C4A" },
  B02: { stroke: "#8A5A2B", leafFill: "#F6EFE4", bough: "#745032" },
  B03: { stroke: "#58683C", leafFill: "#EDF2E3", bough: "#55613F" },
  B04: { stroke: "#315D73", leafFill: "#E7F0F5", bough: "#395A6D" },
  B05: { stroke: "#A8701E", leafFill: "#FAF0DA", bough: "#876128" },
  B06: { stroke: "#8A3838", leafFill: "#F7E9E9", bough: "#743B3B" },
  B07: { stroke: "#48447A", leafFill: "#ECEAF6", bough: "#49466E" },
  B08: { stroke: "#144B37", leafFill: "#E3F1EA", bough: "#204D3B" },
};

const nodesById = TREE.nodesById;

function taperedBezierPath(x1, y1, cx1, cy1, cx2, cy2, x2, y2, wStart, wEnd, steps = 14) {
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

function leafSvgPath(w, h) {
  const hw = w / 2, hh = h / 2;
  return `M ${-hw} 0 C ${(-hw * 0.62).toFixed(1)} ${(-hh * 1.15).toFixed(1)}, ${(hw * 0.62).toFixed(1)} ${(-hh * 1.15).toFixed(1)}, ${hw} 0 C ${(hw * 0.62).toFixed(1)} ${(hh * 1.15).toFixed(1)}, ${(-hw * 0.62).toFixed(1)} ${(hh * 1.15).toFixed(1)}, ${-hw} 0 Z`;
}

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

function plateChromeSvg(pageNum, totalPages, branchTitle, subtitleText, branchColor = "#12372A") {
  const PW = 2100, PH = 2970;
  const wScale = 310 / TRACED.wordBB.w;
  const wTx = 1880 - TRACED.wordBB.cx * wScale;
  const wTy = 128 - TRACED.wordBB.cy * wScale;

  const out = [];
  out.push(`<defs>
    <radialGradient id="a4Parchment_${pageNum}" cx="50%" cy="46%" r="64%">
      <stop offset="0%" stop-color="#FFFDF8"/>
      <stop offset="58%" stop-color="#F7F0DF"/>
      <stop offset="100%" stop-color="#ECE2CA"/>
    </radialGradient>
    <linearGradient id="a4Gold_${pageNum}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ECCF8B"/>
      <stop offset="50%" stop-color="#C9A45A"/>
      <stop offset="100%" stop-color="#966E21"/>
    </linearGradient>
    <linearGradient id="a4Cloud_${pageNum}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFF4CE"/>
      <stop offset="55%" stop-color="#F7DC94"/>
      <stop offset="100%" stop-color="#E7BD63"/>
    </linearGradient>
    <linearGradient id="a4Trunk_${pageNum}" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#352314"/>
      <stop offset="50%" stop-color="#745334"/>
      <stop offset="100%" stop-color="#352314"/>
    </linearGradient>
  </defs>`);
  out.push(`<rect width="${PW}" height="${PH}" fill="url(#a4Parchment_${pageNum})"/>`);
  out.push(`<rect x="26" y="26" width="${PW - 52}" height="${PH - 52}" rx="20" fill="none" stroke="#12372A" stroke-width="8"/>`);
  out.push(`<rect x="40" y="40" width="${PW - 80}" height="${PH - 80}" rx="15" fill="none" stroke="url(#a4Gold_${pageNum})" stroke-width="2.8"/>`);
  out.push(`<rect x="52" y="52" width="${PW - 104}" height="${PH - 104}" rx="10" fill="none" stroke="#C9A45A" stroke-width="1" stroke-dasharray="5 7" stroke-opacity="0.65"/>`);

  // Header strip inside A4 plate
  out.push(`<g transform="translate(${wTx.toFixed(1)}, ${wTy.toFixed(1)}) scale(${wScale.toFixed(4)})">
    <path d="${TRACED.wordD}" fill="#12372A" fill-rule="evenodd"/>
  </g>`);
  out.push(`<text x="1690" y="130" text-anchor="start" fill="${branchColor}" font-size="54" font-weight="700" class="m-serif">${rtl(branchTitle)}</text>`);
  out.push(`<text x="1690" y="182" text-anchor="start" fill="#5A554B" font-size="25" font-weight="700" class="m-sans">${rtl(subtitleText)}</text>`);
  out.push(`<rect x="92" y="90" width="210" height="58" rx="29" fill="#12372A" stroke="#C9A45A" stroke-width="2.2"/>`);
  out.push(`<text x="197" y="128" text-anchor="middle" fill="#E7CD90" font-size="26" font-weight="700" class="m-sans">${rtl(`صفحة ${toArabic(pageNum)} من ${toArabic(totalPages)}`)}</text>`);
  out.push(`<line x1="88" y1="222" x2="${PW - 88}" y2="222" stroke="#C9A45A" stroke-width="2.2"/>`);

  // Discreet bottom border footer
  out.push(`<text x="${PW / 2}" y="${PH - 72}" text-anchor="middle" fill="#6E6556" font-size="22" font-weight="700" class="m-sans">${rtl("ذوي عويض — من البصصة قبيلة الشدادين بني الحارث • نسخة الطباعة الواضحة (A4)")}</text>`);
  return out;
}

// Build single enlarged artistic palm-bough plate for a branch (Pages 2..6)
function buildBranchPlate(branchId, pageNum, totalPages) {
  const PW = 2100, PH = 2970;
  const pal = BRANCH_PALETTE[branchId] || BRANCH_PALETTE.B08;
  const branchNode = nodesById[branchId];
  const stats = TREE.branchStats.find((b) => b.branchId === branchId);
  const count = stats ? stats.totalInBranch : 1;

  // Gather subtree nodes
  const subIds = [];
  function collect(id) {
    subIds.push(id);
    const n = nodesById[id];
    if (n && n.childrenIds) n.childrenIds.forEach(collect);
  }
  collect(branchId);

  const countSub = new Map();
  const maxDMap = new Map();
  function analyze(id) {
    const n = nodesById[id];
    if (!n.childrenIds || n.childrenIds.length === 0) {
      countSub.set(id, 1);
      maxDMap.set(id, 0);
      return { t: 1, d: 0 };
    }
    let t = 1, d = 0;
    for (const c of n.childrenIds) {
      const r = analyze(c);
      t += r.t;
      if (r.d + 1 > d) d = r.d + 1;
    }
    countSub.set(id, t);
    maxDMap.set(id, d);
    return { t, d };
  }
  analyze(branchId);

  // Palm-bough base anchor at bottom-center
  const OX = 1050;
  const OY = 2660;
  const START_A = 6;
  const END_A = -186;

  const angMap = new Map();
  function assignAng(id, a0, a1) {
    const n = nodesById[id];
    const mid = (a0 + a1) / 2;
    angMap.set(id, { deg: mid, rad: (mid * Math.PI) / 180 });
    if (!n.childrenIds || n.childrenIds.length === 0) return;
    const ws = n.childrenIds.map((c) => (countSub.get(c) || 1) + 0.4);
    const sum = ws.reduce((a, b) => a + b, 0);
    let cur = a0;
    for (let i = 0; i < n.childrenIds.length; i++) {
      const span = ((a1 - a0) * ws[i]) / sum;
      assignAng(n.childrenIds[i], cur, cur + span);
      cur += span;
    }
  }
  assignAng(branchId, START_A, END_A);

  // Adaptive spacious typography for count (from 60 in Qulaishan up to 226 in Madi)
  const sizeBoost = count <= 70 ? 1.26 : count <= 110 ? 1.15 : count <= 160 ? 1.07 : 1.0;

  // Boundary max distance along elliptical A4 plate ray
  function a4MaxR(deg) {
    const rad = (deg * Math.PI) / 180;
    const ux = Math.cos(rad), uy = Math.sin(rad);
    let lo = 120, hi = 2600;
    for (let s = 0; s < 20; s++) {
      const mid = (lo + hi) / 2;
      const x = OX + mid * ux;
      const y = OY + mid * uy * 1.48;
      if (x >= 115 && x <= PW - 115 && y >= 275 && y <= 2740) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  const sibMap = new Map();
  for (const id of subIds) {
    const n = nodesById[id];
    if (n.childrenIds) n.childrenIds.forEach((c, idx) => sibMap.set(c, idx));
  }

  function runBranchLayout(sc) {
    const items = [];
    const byId = new Map();
    for (const id of subIds) {
      const n = nodesById[id];
      const ang = angMap.get(id);
      const isBranch = n.generation === 1;
      const isParent = n.childrenCount > 0;
      const sibIdx = sibMap.get(id) || 0;

      let w, h, fontSize, rotDeg = 0;
      if (isBranch) {
        w = 270; h = 84; fontSize = 48; rotDeg = 0;
      } else if (n.generation === 2) {
        w = 200 * Math.min(1.15, sizeBoost); h = 62 * Math.min(1.12, sizeBoost); fontSize = 35 * Math.min(1.15, sizeBoost); rotDeg = 0;
      } else if (isParent) {
        w = Math.min(200, Math.max(134, 96 + n.name.length * 11)) * Math.min(1.15, sizeBoost);
        h = 48 * Math.min(1.12, sizeBoost);
        fontSize = 29 * Math.min(1.15, sizeBoost);
        rotDeg = 0;
      } else {
        w = Math.min(186, Math.max(120, 88 + n.name.length * 10.2)) * sizeBoost;
        h = 43 * Math.min(1.18, sizeBoost);
        fontSize = 27 * sizeBoost;
        rotDeg = Math.max(-10, Math.min(10, Math.cos(ang.rad) * -8));
      }

      w = Math.round(w * sc * 10) / 10;
      h = Math.round(h * sc * 10) / 10;
      fontSize = Math.round(fontSize * sc * 10) / 10;
      const rotRad = (rotDeg * Math.PI) / 180;
      const cosR = Math.abs(Math.cos(rotRad)), sinR = Math.abs(Math.sin(rotRad));
      const envHW = (w * cosR + h * sinR) / 2;
      const envHH = (w * sinR + h * cosR) / 2;

      const rMax = a4MaxR(ang.deg);
      let x, y;
      if (isBranch) {
        x = OX; y = OY;
      } else {
        const effD = Math.min(6, Math.max(4, n.generation + (maxDMap.get(n.id) || 0)));
        const t = n.generation === 2
          ? 0.19 + (sibIdx % 2) * 0.05
          : isParent
            ? Math.min(0.75, (n.generation - 1.4) / Math.max(2.3, effD - 1.1))
            : 0.48 + ((n.generation - 3) * 0.14) + ((sibIdx % 4) / 3) * 0.3;
        const r = Math.max(185, Math.min(rMax - 30, 170 + Math.min(0.98, Math.max(0.16, t)) * (rMax - 195)));
        x = OX + r * Math.cos(ang.rad);
        y = OY + r * Math.sin(ang.rad) * 1.48;
      }

      const item = { n, ang, x, y, anchorX: x, anchorY: y, w, h, fontSize, rotDeg, rotRad, envHW, envHH, isBranch, isParent };
      items.push(item);
      byId.set(id, item);
    }

    function clampP(p) {
      if (p.isBranch) { p.x = OX; p.y = OY; return; }
      const hw = p.envHW + 10, hh = p.envHH + 10;
      p.x = Math.max(92 + hw, Math.min(PW - 92 - hw, p.x));
      p.y = Math.max(255 + hh, Math.min(2820 - hh, p.y));
      // Keep clear of branch root medallion
      const dx = p.x - OX, dy = p.y - OY;
      const dist = Math.hypot(dx, dy);
      if (dist < 175 && dist > 0.01) {
        p.x = OX + (dx / dist) * 175;
        p.y = OY + (dy / dist) * 175;
      }
    }

    const PAD = 7;
    for (let iter = 0; iter < 1400; iter++) {
      const phaseA = iter < 200;
      if (phaseA) {
        const sp = 0.05 * (1 - iter / 200);
        for (const p of items) {
          if (p.isBranch) continue;
          p.x += (p.anchorX - p.x) * sp;
          p.y += (p.anchorY - p.y) * sp;
        }
      }
      items.sort((a, b) => a.x - b.x);
      let ov = 0;
      const gain = phaseA ? 0.68 : 0.92;
      for (let i = 0; i < items.length; i++) {
        const A = items[i];
        for (let j = i + 1; j < items.length; j++) {
          const B = items[j];
          const dx = B.x - A.x;
          if (dx > 340) break;
          const sumW = A.envHW + B.envHW + PAD * 2;
          const ox = sumW - dx;
          if (ox <= 0) continue;
          const dy = B.y - A.y;
          const sumH = A.envHH + B.envHH + PAD * 2;
          const oy = sumH - Math.abs(dy);
          if (oy <= 0) continue;
          ov++;
          const wA = A.isBranch ? 0 : 0.5;
          const wB = B.isBranch ? 0 : 0.5;
          const wSum = wA + wB || 1;
          if ((ox / sumW) < (oy / sumH)) {
            const sx = ox * gain + 0.8;
            A.x -= sx * (wA / wSum);
            B.x += sx * (wB / wSum);
          } else {
            const sy = oy * gain + 0.8;
            if (dy >= 0) { A.y -= sy * (wA / wSum); B.y += sy * (wB / wSum); }
            else { A.y += sy * (wA / wSum); B.y -= sy * (wB / wSum); }
          }
        }
      }
      for (const p of items) clampP(p);
      if (!phaseA && ov === 0) break;
    }

    // Count remaining overlaps cleanly
    let remOv = 0;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const A = items[i], B = items[j];
        if (Math.abs(A.x - B.x) < (A.envHW + B.envHW + 1) && Math.abs(A.y - B.y) < (A.envHH + B.envHH + 1)) remOv++;
      }
    }
    return { items, byId, remOv };
  }

  let best = null;
  for (const sc of [1.0, 0.94, 0.88, 0.82]) {
    const r = runBranchLayout(sc);
    best = r;
    if (r.remOv === 0) break;
  }
  console.log(`A4 Page ${pageNum} (${branchNode.name}, n=${best.items.length}): overlaps=${best.remOv}, leafFont=${best.items.find((x) => !x.isParent && !x.isBranch)?.fontSize || "-"}px`);

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" lang="ar" xml:lang="ar" direction="rtl" viewBox="0 0 ${PW} ${PH}">`);
  out.push(...plateChromeSvg(pageNum, totalPages, `فرع ${branchNode.name}`, `عدد أفراد الفرع: ${toArabic(count)} اسماً — مرتب حسب الأجيال والأفخاذ`, pal.stroke));

  // Decorative trunk stub beneath branch medallion
  out.push(`<path d="M ${OX - 76} 2810 C ${OX - 55} 2740, ${OX - 44} 2700, ${OX - 38} ${OY} L ${OX + 38} ${OY} C ${OX + 44} 2700, ${OX + 55} 2740, ${OX + 76} 2810 Z" fill="url(#a4Trunk_${pageNum})" stroke="#C9A45A" stroke-width="3"/>`);

  // Tapered organic boughs
  out.push(`<g>`);
  for (const p of best.items) {
    if (p.isBranch) continue;
    const par = best.byId.get(p.n.parentId);
    if (!par) continue;
    const isLeaf = !p.isParent;
    const wS = par.isBranch ? 16 : par.n.generation === 2 ? 9.5 : 5.5;
    const wE = isLeaf ? 2.0 : 4.2;
    const vx = p.x - par.x, vy = p.y - par.y;
    const cx1 = par.x + vx * 0.25;
    const cy1 = par.y + vy * 0.45 - 24;
    const cx2 = p.x - vx * 0.22;
    const cy2 = p.y - vy * 0.35;
    out.push(`<path d="${taperedBezierPath(par.x, par.y, cx1, cy1, cx2, cy2, p.x, p.y, wS, wE, isLeaf ? 10 : 14)}" fill="${pal.bough}" fill-opacity="${isLeaf ? 0.72 : 0.85}"/>`);
  }
  out.push(`</g>`);

  // Nodes (leaves -> fathers -> Gen 2 -> Branch head)
  const ordered = [...best.items].sort((a, b) => b.n.generation - a.n.generation);
  for (const p of ordered) {
    out.push(`<g transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) rotate(${p.rotDeg.toFixed(2)})">`);
    if (p.isBranch) {
      out.push(`<rect x="${-p.w / 2}" y="${-p.h / 2}" width="${p.w}" height="${p.h}" rx="${p.h / 2}" fill="${pal.stroke}" stroke="#E7CD90" stroke-width="4.5"/>
        <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="#FFFDF8" font-size="${p.fontSize}" font-weight="700" class="m-serif">${rtl(p.n.name)}</text>`);
    } else if (p.n.generation === 2) {
      out.push(`<path d="${heritageCloudPath(p.w, p.h)}" fill="url(#a4Cloud_${pageNum})" stroke="#9B6E1F" stroke-width="3"/>
        <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="#0B241B" font-size="${p.fontSize}" font-weight="700" class="m-serif">${rtl(p.n.name)}</text>`);
    } else if (p.isParent) {
      out.push(`<rect x="${(-p.w / 2).toFixed(1)}" y="${(-p.h / 2).toFixed(1)}" width="${p.w}" height="${p.h}" rx="${(p.h / 2).toFixed(1)}" fill="#FFFDF6" stroke="${pal.stroke}" stroke-width="2.6"/>
        <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="#0B241B" font-size="${p.fontSize}" font-weight="800" class="m-sans">${rtl(p.n.name)}</text>`);
    } else {
      out.push(`<path d="${leafSvgPath(p.w, p.h)}" fill="${pal.leafFill}" stroke="${pal.stroke}" stroke-width="2.2"/>
        <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="#0A2118" font-size="${p.fontSize}" font-weight="800" class="m-sans">${rtl(p.n.name)}</text>`);
    }
    out.push(`</g>`);
  }

  out.push(`</svg>`);
  return out.join("\n");
}

// Page 7: Small Branches (Dughaylib 13, Dahran 1, Mudyan 1) + Full Sculpted Trunk to Qahtan + Notes + Seal
function buildPage7Plate(totalPages) {
  const PW = 2100, PH = 2970;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" lang="ar" xml:lang="ar" direction="rtl" viewBox="0 0 ${PW} ${PH}">`);
  out.push(...plateChromeSvg(7, totalPages, "فروع دغيليب ودهران ومضيان وجذع النسب", "الأجداد المتّصلون إلى قحطان وفروع الأبناء الأصغر عدداً", "#12372A"));

  // Left Half: Sculpted Palm Trunk from عويض down to قحطان
  const trunkX = 540;
  const ancOrder = [];
  for (let g = -10; g <= -1; g++) {
    const f = Object.values(nodesById).find((n) => n.generation === g);
    if (f) ancOrder.push(f);
  }
  out.push(`<rect x="115" y="275" width="850" height="2480" rx="28" fill="#FFFDF8" stroke="#C9A45A" stroke-width="3.2"/>`);
  out.push(`<text x="${trunkX}" y="355" text-anchor="middle" fill="#12372A" font-size="46" font-weight="700" class="m-serif">${rtl("جذع النسب إلى قحطان")}</text>`);
  out.push(`<line x1="220" y1="388" x2="860" y2="388" stroke="#C9A45A" stroke-width="2.2"/>`);

  // Root عويض at top of trunk
  out.push(`<path d="M ${trunkX - 115} 2645 L ${trunkX - 42} 540 L ${trunkX + 42} 540 L ${trunkX + 115} 2645 Z" fill="url(#a4Trunk_7)" stroke="#C9A45A" stroke-width="3.5"/>`);
  out.push(`<ellipse cx="${trunkX}" cy="2655" rx="230" ry="42" fill="#1E4B35" fill-opacity="0.22"/>`);

  out.push(`<g transform="translate(${trunkX}, 520)">
    <rect x="-155" y="-52" width="310" height="104" rx="52" fill="#12372A" stroke="#C9A45A" stroke-width="4.5"/>
    <text x="0" y="15" text-anchor="middle" fill="#FFFDF8" font-size="50" font-weight="700" class="m-serif">${rtl("عويض")}</text>
  </g>`);

  const yTop = 740, yBot = 2560;
  const stepY = (yBot - yTop) / Math.max(1, ancOrder.length - 1);
  ancOrder.forEach((anc, idx) => {
    // ancOrder[0] = Qahtan at bottom, ancOrder[9] = Muslih just under Uwaid
    const y = yBot - idx * stepY;
    const isQ = idx === 0;
    const bw = isQ ? 320 : 250;
    const bh = isQ ? 84 : 68;
    out.push(`<g transform="translate(${trunkX}, ${y.toFixed(1)})">
      <rect x="${-bw / 2}" y="${-bh / 2}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${isQ ? "#12372A" : "#FFFDF8"}" stroke="#C9A45A" stroke-width="${isQ ? 4.5 : 3}"/>
      <text x="0" y="${isQ ? 14 : 11}" text-anchor="middle" fill="${isQ ? "#E7CD90" : "#12372A"}" font-size="${isQ ? 46 : 36}" font-weight="700" class="m-serif">${rtl(anc.name)}</text>
    </g>`);
  });

  // Right Top Card: فرع دغيليب (13) drawn clearly as an expanded readable mini-tree
  out.push(`<rect x="1030" y="275" width="955" height="1190" rx="28" fill="#FFFDF8" stroke="#C9A45A" stroke-width="3.2"/>`);
  out.push(`<text x="1930" y="355" text-anchor="start" fill="#315D73" font-size="46" font-weight="700" class="m-serif">${rtl("فرع دغيليب — ١٣ اسماً")}</text>`);
  out.push(`<line x1="1080" y1="388" x2="1930" y2="388" stroke="#C9A45A" stroke-width="2.2"/>`);

  // Lay out دغيليب (G1) -> عبدالله (G2) -> [عمر, فهد] -> ... cleanly by depth columns (right to left)
  const b04Pos = new Map();
  function placeSubtreeRows(id, gen, rowCursorRef) {
    const n = nodesById[id];
    const ch = n.childrenIds || [];
    if (ch.length === 0) {
      const y = rowCursorRef.y;
      rowCursorRef.y += 92;
      b04Pos.set(id, { n, x: 1850 - (gen - 1) * 215, y });
      return y;
    }
    const ys = ch.map((cid) => placeSubtreeRows(cid, gen + 1, rowCursorRef));
    const yMid = (ys[0] + ys[ys.length - 1]) / 2;
    b04Pos.set(id, { n, x: 1850 - (gen - 1) * 215, y: yMid });
    return yMid;
  }
  placeSubtreeRows("B04", 1, { y: 495 });

  for (const [id, p] of b04Pos.entries()) {
    if (id === "B04") continue;
    const par = b04Pos.get(p.n.parentId);
    if (!par) continue;
    const mx = (par.x + p.x) / 2;
    out.push(`<path d="M ${par.x} ${par.y} C ${mx} ${par.y}, ${mx} ${p.y}, ${p.x} ${p.y}" fill="none" stroke="#395A6D" stroke-width="4.5" stroke-opacity="0.78"/>`);
  }
  for (const [, p] of b04Pos.entries()) {
    const isB = p.n.generation === 1;
    const isG2 = p.n.generation === 2;
    const isP = p.n.childrenCount > 0;
    const pw = isB ? 170 : isG2 ? 164 : 152;
    const ph = isB ? 64 : 52;
    out.push(`<g transform="translate(${p.x}, ${p.y})">
      <rect x="${-pw / 2}" y="${-ph / 2}" width="${pw}" height="${ph}" rx="${ph / 2}" fill="${isB ? "#315D73" : isG2 ? "#F7DC94" : isP ? "#FFFDF8" : "#E7F0F5"}" stroke="${isB ? "#E7CD90" : "#315D73"}" stroke-width="3"/>
      <text x="0" y="10" text-anchor="middle" fill="${isB ? "#FFFDF8" : "#0B241B"}" font-size="${isB ? 34 : 28}" font-weight="700" class="${isB || isG2 ? "m-serif" : "m-sans"}">${rtl(p.n.name)}</text>
    </g>`);
  }

  // Right Middle Card: فرعا دهران ومضيان
  out.push(`<rect x="1030" y="1510" width="955" height="390" rx="28" fill="#FFFDF8" stroke="#C9A45A" stroke-width="3.2"/>`);
  out.push(`<text x="1930" y="1588" text-anchor="start" fill="#12372A" font-size="42" font-weight="700" class="m-serif">${rtl("فرعا دهران ومضيان")}</text>`);
  out.push(`<line x1="1080" y1="1620" x2="1930" y2="1620" stroke="#C9A45A" stroke-width="2.2"/>`);

  out.push(`<g transform="translate(1700, 1745)">
    <rect x="-155" y="-56" width="310" height="112" rx="56" fill="#58683C" stroke="#E7CD90" stroke-width="4"/>
    <text x="0" y="14" text-anchor="middle" fill="#FFFDF8" font-size="44" font-weight="700" class="m-serif">${rtl("دهران (١)")}</text>
  </g>`);
  out.push(`<g transform="translate(1315, 1745)">
    <rect x="-155" y="-56" width="310" height="112" rx="56" fill="#8A5A2B" stroke="#E7CD90" stroke-width="4"/>
    <text x="0" y="14" text-anchor="middle" fill="#FFFDF8" font-size="44" font-weight="700" class="m-serif">${rtl("مضيان (١)")}</text>
  </g>`);

  // Right Bottom Card: Documentation + Seal
  out.push(`<rect x="1030" y="1945" width="955" height="810" rx="28" fill="#FFFDF8" stroke="#C9A45A" stroke-width="3.2"/>`);
  out.push(`<text x="1930" y="2025" text-anchor="start" fill="#12372A" font-size="42" font-weight="700" class="m-serif">${rtl("الحاشية والتوثيق المعتمد")}</text>`);
  out.push(`<line x1="1080" y1="2056" x2="1930" y2="2056" stroke="#C9A45A" stroke-width="2.2"/>`);
  out.push(`<text x="1930" y="2130" text-anchor="start" fill="#12372A" font-size="31" font-weight="700" class="m-serif">${rtl("ذوي عويض بن مصلح بن مسفر بن بصيص بن دمشق بن ملفي")}</text>`);
  out.push(`<text x="1930" y="2184" text-anchor="start" fill="#12372A" font-size="31" font-weight="700" class="m-serif">${rtl("بن مفلح بن عياش بن شداد بن حارث بن قحطان")}</text>`);
  out.push(`<text x="1930" y="2262" text-anchor="start" fill="#3D3932" font-size="25" font-weight="500" class="m-sans">${rtl("ذُكر في الحاشية الشفهية عند بعض كبار السن وجود اسم (مسفر) إضافي")}</text>`);
  out.push(`<text x="1930" y="2306" text-anchor="start" fill="#3D3932" font-size="25" font-weight="500" class="m-sans">${rtl("بين عويض ومصلح، والمعتمد التسلسل المثبت في الجذع المتصل أعلاه.")}</text>`);

  const sealS = 240 / TRACED.sealBB.w;
  const sealCx = 1508, sealCy = 2500;
  out.push(`<g transform="translate(${(sealCx - TRACED.sealBB.cx * sealS).toFixed(1)}, ${(sealCy - TRACED.sealBB.cy * sealS).toFixed(1)}) scale(${sealS.toFixed(4)})">
    <path d="${TRACED.sealD}" fill="#12372A" fill-rule="evenodd"/>
  </g>`);
  out.push(`<text x="${sealCx}" y="2675" text-anchor="middle" fill="#12372A" font-size="26" font-weight="700" class="m-serif">${rtl("من البصصة قبيلة الشدادين بني الحارث")}</text>`);

  out.push(`</svg>`);
  return out.join("\n");
}

async function main() {
  const TOTAL = 7;
  const pages = [];

  // Page 1: Full Mural scaled cleanly onto exact A4 (1:sqrt(2))
  pages.push(`<section class="a4-page">${MURAL_SVG.replace("<svg ", '<svg class="full-mural" ')}</section>`);

  // Pages 2..6: Dedicated High-Clarity A4 Branch Plates
  const branchOrder = ["B08", "B06", "B07", "B05", "B01"];
  branchOrder.forEach((bid, idx) => {
    pages.push(`<section class="a4-page">${buildBranchPlate(bid, idx + 2, TOTAL)}</section>`);
  });

  // Page 7: Smaller Branches + Ancestor Trunk + Notes
  pages.push(`<section class="a4-page">${buildPage7Plate(TOTAL)}</section>`);

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Tajawal:wght@500;700;800&display=swap" rel="stylesheet">
<style>
  @page { size: A4 portrait; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { background: #FFFDF8; font-family: 'Tajawal', sans-serif; }
  .a4-page { width: 210mm; height: 297mm; page-break-after: always; overflow: hidden; background: #F7F0DF; }
  .a4-page:last-child { page-break-after: auto; }
  .a4-page > svg { width: 100%; height: 100%; display: block; }
  text { direction: rtl; unicode-bidi: isolate; }
  .m-serif { font-family: 'Amiri', serif; }
  .m-sans  { font-family: 'Tajawal', sans-serif; }
</style>
</head>
<body>${pages.join("\n")}</body>
</html>`;

  // Also save preview single-page routes for verification screenshots of P1, P2, P7
  const server = http.createServer((req, res) => {
    if (req.url === "/booklet") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } else if (req.url && req.url.startsWith("/page/")) {
      const n = Number(req.url.replace("/page/", "")) - 1;
      const single = html.replace(/<body>[\s\S]*<\/body>/, `<body>${pages[n] || ""}</body>`);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(single);
    } else {
      res.writeHead(404); res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "edge-a4book-"));
  const edge = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`, "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const wsUrl = await new Promise((resolve, reject) => {
    let stderr = "";
    const t = setTimeout(() => reject(new Error("Edge timeout")), 15000);
    edge.stderr.on("data", (c) => {
      stderr += c.toString();
      const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
  });

  const browserPort = new URL(wsUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${browserPort}/json/list`)).json();
  const ws = new WebSocket((targets.find((t) => t.type === "page") || targets[0]).webSocketDebuggerUrl);
  await new Promise((r, rej) => { ws.addEventListener("open", r); ws.addEventListener("error", rej); });

  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
    }
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Page.navigate", { url: `http://127.0.0.1:${port}/booklet` });
  await new Promise((r) => setTimeout(r, 2000));
  await cdp("Runtime.evaluate", { awaitPromise: true, expression: "document.fonts.ready" });
  await new Promise((r) => setTimeout(r, 400));

  const pdf = await cdp("Page.printToPDF", {
    printBackground: true, preferCSSPageSize: true,
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0
  });
  fs.writeFileSync(PDF_OUT, Buffer.from(pdf.data, "base64"));
  console.log("Wrote 7-Page Clear A4 Print Booklet PDF:", PDF_OUT, "size=", fs.statSync(PDF_OUT).size);

  // Capture verification screenshots for P1, P2 (densest branch Madi), P7
  await cdp("Emulation.setDeviceMetricsOverride", { width: 794, height: 1123, deviceScaleFactor: 2, mobile: false });
  for (const [pg, fname] of [[1, "_a4_p1.png"], [2, "_a4_p2_madi.png"], [7, "_a4_p7_ancestors.png"]]) {
    await cdp("Page.navigate", { url: `http://127.0.0.1:${port}/page/${pg}` });
    await new Promise((r) => setTimeout(r, 900));
    await cdp("Runtime.evaluate", { awaitPromise: true, expression: "document.fonts.ready" });
    const shot = await cdp("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(ROOT, "scripts", fname), Buffer.from(shot.data, "base64"));
  }

  ws.close();
  await new Promise((r) => { edge.once("exit", r); edge.kill(); setTimeout(r, 1200); });
  server.closeAllConnections?.();
  server.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
