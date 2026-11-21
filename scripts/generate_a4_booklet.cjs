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
  return {
    sealD,
    sealBB: getPathBBox(sealD),
    wordD: wBlock,
    wordBB: getPathBBox(wBlock),
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

  out.push(`<g transform="translate(${wTx.toFixed(1)}, ${wTy.toFixed(1)}) scale(${wScale.toFixed(4)})">
    <path d="${TRACED.wordD}" fill="#12372A" fill-rule="evenodd"/>
  </g>`);
  out.push(`<text x="1690" y="130" text-anchor="start" fill="${branchColor}" font-size="54" font-weight="700" class="m-serif">${rtl(branchTitle)}</text>`);
  out.push(`<text x="1690" y="182" text-anchor="start" fill="#5A554B" font-size="25" font-weight="700" class="m-sans">${rtl(subtitleText)}</text>`);
  out.push(`<rect x="92" y="90" width="210" height="58" rx="29" fill="#12372A" stroke="#C9A45A" stroke-width="2.2"/>`);
  out.push(`<text x="197" y="128" text-anchor="middle" fill="#E7CD90" font-size="26" font-weight="700" class="m-sans">${rtl(`صفحة ${toArabic(pageNum)} من ${toArabic(totalPages)}`)}</text>`);
  out.push(`<line x1="88" y1="222" x2="${PW - 88}" y2="222" stroke="#C9A45A" stroke-width="2.2"/>`);
  out.push(`<text x="${PW / 2}" y="${PH - 70}" text-anchor="middle" fill="#6E6556" font-size="22" font-weight="700" class="m-sans">${rtl("ذوي عويض — من البصصة قبيلة الشدادين بني الحارث • نسخة الطباعة الواضحة (A4)")}</text>`);
  return out;
}

// Planar Curved Two-Wing Pinnate Frond Engine for Pages 2..6
function buildBranchPlate(branchId, pageNum, totalPages) {
  const PW = 2100, PH = 2970;
  const pal = BRANCH_PALETTE[branchId] || BRANCH_PALETTE.B08;
  const branchNode = nodesById[branchId];
  const stats = TREE.branchStats.find((b) => b.branchId === branchId);
  const count = stats ? stats.totalInBranch : 1;
  const CX = 1050;
  const STEM_BOT_Y = 2725;
  const STEM_TOP_Y = 440;
  const Y_TOP = 265;
  const Y_BOT = 2635;

  const sizeBoost = count <= 70 ? 1.38 : count <= 110 ? 1.24 : count <= 160 ? 1.14 : 1.06;

  function a4Spec(n, sc) {
    const len = n.name.length;
    if (n.generation === 1) return { w: 280, h: 82, fontSize: 48 };
    if (n.generation === 2) {
      const m = Math.min(1.22, sizeBoost) * sc;
      return { w: Math.round((96 + len * 12) * m), h: Math.round(52 * m), fontSize: Math.round(33 * m) };
    }
    if (n.childrenCount > 0) {
      const m = Math.min(1.25, sizeBoost) * sc;
      return { w: Math.round(Math.min(185, Math.max(114, 72 + len * 11)) * m), h: Math.round(42 * m), fontSize: Math.round(28 * m) };
    }
    const m = sizeBoost * sc;
    return { w: Math.round(Math.min(176, Math.max(106, 66 + len * 10.5)) * m), h: Math.round(40 * m), fontSize: Math.round(27.5 * m) };
  }

  function chunkLeaves(leaves, sc) {
    // Wrap horizontal leaf clusters to at most 3 per sprig row (or 4 when wide space) so they never cram inside 895px half-wing width
    const maxPerRow = 3;
    const rows = [];
    for (let i = 0; i < leaves.length; i += maxPerRow) {
      rows.push(leaves.slice(i, i + maxPerRow));
    }
    return rows;
  }

  function maxWingOutW(id, sc) {
    const n = nodesById[id];
    const sp = a4Spec(n, sc);
    if (!n || !n.childrenIds || n.childrenIds.length === 0) return sp.w;
    const ch = n.childrenIds;
    const leaves = ch.filter((c) => !(nodesById[c].childrenIds && nodesById[c].childrenIds.length));
    const pars = ch.filter((c) => nodesById[c].childrenIds && nodesById[c].childrenIds.length);
    let maxChild = 0;
    if (leaves.length > 0) {
      const rows = chunkLeaves(leaves, sc);
      for (const r of rows) {
        const lw = r.reduce((s, c) => s + a4Spec(nodesById[c], sc).w + 10 * sc, 38 * sc);
        maxChild = Math.max(maxChild, lw);
      }
    }
    for (const p of pars) maxChild = Math.max(maxChild, maxWingOutW(p, sc));
    return sp.w + 26 + maxChild;
  }

  function needPx(id, sc, padV = 5) {
    const n = nodesById[id];
    const selfH = a4Spec(n, sc).h + padV;
    if (!n || !n.childrenIds || n.childrenIds.length === 0) return selfH;
    const ch = n.childrenIds;
    const leaves = ch.filter((c) => !(nodesById[c].childrenIds && nodesById[c].childrenIds.length));
    const pars = ch.filter((c) => nodesById[c].childrenIds && nodesById[c].childrenIds.length);
    let total = 0;
    if (leaves.length > 0) {
      const rows = chunkLeaves(leaves, sc);
      total += rows.length * (a4Spec(nodesById[leaves[0]], sc).h + padV + 6);
    }
    for (const p of pars) total += needPx(p, sc, padV);
    return Math.max(selfH, total);
  }

  function tryLayout(sc) {
    // Partition Gen 2 children evenly across Right Wing (+1) and Left Wing (-1)
    const g2Ids = [...(branchNode.childrenIds || [])];
    g2Ids.sort((a, b) => needPx(b, sc) - needPx(a, sc));
    const rightG2 = [], leftG2 = [];
    let rLoad = 0, lLoad = 0;
    for (const gid of g2Ids) {
      const w = needPx(gid, sc);
      if (rLoad <= lLoad) { rightG2.push(gid); rLoad += w; }
      else { leftG2.push(gid); lLoad += w; }
    }

    const placed = [];
    const edges = [];

    function runWing(dir, wingG2Ids) {
      if (!wingG2Ids.length) return;
      const xStart = CX + dir * 48;
      const xEnd = dir > 0 ? PW - 88 : 88;
      const totLoad = wingG2Ids.reduce((s, gid) => s + needPx(gid, sc), 0);
      const wingPad = 14;
      const availY = (Y_BOT - Y_TOP) - wingPad * Math.max(0, wingG2Ids.length - 1);
      // Center vertically cleanly if small branch
      const usedY = Math.min(availY, Math.max(availY * 0.88, totLoad * 1.35));
      let curY = (Y_TOP + Y_BOT) / 2 - (usedY + wingPad * Math.max(0, wingG2Ids.length - 1)) / 2;

      function placeSub(id, y0, y1, minEdgeX) {
        const n = nodesById[id];
        const sp = a4Spec(n, sc);
        const ch = n.childrenIds || [];
        const leaves = ch.filter((c) => !(nodesById[c].childrenIds && nodesById[c].childrenIds.length));
        const pars = ch.filter((c) => nodesById[c].childrenIds && nodesById[c].childrenIds.length);

        let childOutW = 0;
        if (leaves.length > 0) {
          for (const r of chunkLeaves(leaves, sc)) {
            const lw = r.reduce((s, c) => s + a4Spec(nodesById[c], sc).w + 10 * sc, 38 * sc);
            childOutW = Math.max(childOutW, lw);
          }
        }
        for (const p of pars) childOutW = Math.max(childOutW, maxWingOutW(p, sc));

        let xSelf;
        const availAfter = Math.max(24, Math.abs(xEnd - minEdgeX) - childOutW - sp.w / 2);
        const stepNice = Math.min(140, Math.max(20, availAfter * 0.45));
        xSelf = minEdgeX + dir * (sp.w / 2 + stepNice);
        const maxAllow = xEnd - dir * (childOutW + sp.w / 2 + 4);
        if (dir > 0) xSelf = Math.min(maxAllow, Math.max(minEdgeX + sp.w / 2 + 20, xSelf));
        else xSelf = Math.max(maxAllow, Math.min(minEdgeX - sp.w / 2 - 20, xSelf));
        const nextEdge = xSelf + dir * (sp.w / 2 + 10);

        const blocks = [];
        if (leaves.length > 0) {
          const rows = chunkLeaves(leaves, sc);
          blocks.push({ type: "leaves", rows, need: rows.length * (a4Spec(nodesById[leaves[0]], sc).h + 11) });
        }
        for (const pid of pars) blocks.push({ type: "parent", id: pid, need: needPx(pid, sc) });

        if (!blocks.length) {
          const rec = { n, x: xSelf, y: (y0 + y1) / 2, ...sp, isParent: false };
          placed.push(rec);
          return rec;
        }

        const bTot = blocks.reduce((a, b) => a + b.need, 0);
        let byCur = y0;
        const anchors = [];
        for (const blk of blocks) {
          const bh = ((y1 - y0) * blk.need) / bTot;
          const by0 = byCur, by1 = byCur + bh;
          byCur = by1;
          if (blk.type === "parent") {
            const cRec = placeSub(blk.id, by0, by1, nextEdge);
            anchors.push({ type: "parent", rec: cRec, yCenter: cRec.y });
          } else {
            const rowPlacedAll = [];
            blk.rows.forEach((rIds, rIdx) => {
              const rSpecs = rIds.map((lid) => ({ lid, n: nodesById[lid], sp: a4Spec(nodesById[lid], sc) }));
              const yRow = by0 + ((rIdx + 0.5) / blk.rows.length) * bh;
              const startX = nextEdge + dir * 24 * sc;
              const spanW = Math.max(10, Math.abs(xEnd - startX));
              const sumW = rSpecs.reduce((s, it) => s + it.sp.w, 0);
              const gap = rSpecs.length > 1 ? Math.max(8 * sc, Math.min(34, (spanW - sumW) / rSpecs.length)) : 0;
              let cx = startX;
              const rowPlaced = [];
              for (const it of rSpecs) {
                const lx = cx + dir * (it.sp.w / 2);
                cx += dir * (it.sp.w + gap);
                const lRec = { n: it.n, x: lx, y: yRow, ...it.sp, isParent: false };
                placed.push(lRec);
                rowPlaced.push(lRec);
              }
              rowPlacedAll.push(rowPlaced);
            });
            anchors.push({ type: "leaves", rows: rowPlacedAll, yCenter: (by0 + by1) / 2 });
          }
        }

        const ySelf = (anchors[0].yCenter + anchors[anchors.length - 1].yCenter) / 2;
        const rec = { n, x: xSelf, y: ySelf, ...sp, isParent: true };
        placed.push(rec);

        for (const a of anchors) {
          if (a.type === "parent") {
            const cr = a.rec;
            const vx = cr.x - rec.x;
            edges.push({
              x1: rec.x, y1: rec.y, cx1: rec.x + vx * 0.54, cy1: rec.y,
              cx2: rec.x + vx * 0.46, cy2: cr.y, x2: cr.x, y2: cr.y,
              wStart: rec.n.generation === 2 ? 10 : 5.5, wEnd: 4,
            });
          } else {
            for (const row of a.rows) {
              if (row.length === 1) {
                const lf = row[0], vx = lf.x - rec.x;
                edges.push({
                  x1: rec.x, y1: rec.y, cx1: rec.x + vx * 0.55, cy1: rec.y,
                  cx2: rec.x + vx * 0.45, cy2: lf.y, x2: lf.x, y2: lf.y,
                  wStart: 4.5, wEnd: 1.8,
                });
              } else {
                const spineOff = (row[0].y < rec.y ? -1 : 1) * (row[0].h * 0.54 + 2);
                const last = row[row.length - 1];
                const yEndS = last.y + spineOff * 0.65;
                const entryY = row[0].y + spineOff;
                const cx1 = rec.x + dir * Math.min(54, Math.abs(row[0].x - rec.x) * 0.35);
                const cx2 = row[0].x + (last.x - row[0].x) * 0.48;
                edges.push({
                  x1: rec.x, y1: rec.y, cx1, cy1: entryY, cx2, cy2: entryY,
                  x2: last.x, y2: yEndS, wStart: 4.5, wEnd: 1.6,
                });
                for (const lf of row) {
                  const targetX = lf.x - dir * 10;
                  let bestT = 0.5, errMin = Infinity;
                  for (let k = 0; k <= 16; k++) {
                    const tt = k / 16, mt = 1 - tt;
                    const sx = mt * mt * mt * rec.x + 3 * mt * mt * tt * cx1 + 3 * mt * tt * tt * cx2 + tt * tt * tt * last.x;
                    if (Math.abs(sx - targetX) < errMin) { errMin = Math.abs(sx - targetX); bestT = tt; }
                  }
                  const mt = 1 - bestT;
                  const sx = mt * mt * mt * rec.x + 3 * mt * mt * bestT * cx1 + 3 * mt * bestT * bestT * cx2 + bestT * bestT * bestT * last.x;
                  const sy = mt * mt * mt * rec.y + 3 * mt * mt * bestT * entryY + 3 * mt * bestT * bestT * entryY + bestT * bestT * bestT * yEndS;
                  edges.push({ x1: sx, y1: sy, cx1: sx + dir * 3, cy1: (sy + lf.y) * 0.5, cx2: lf.x - dir * 5, cy2: lf.y, x2: lf.x, y2: lf.y, wStart: 2.6, wEnd: 1.4 });
                }
              }
            }
          }
        }
        return rec;
      }

      for (const gid of wingG2Ids) {
        const gh = (usedY * needPx(gid, sc)) / totLoad;
        const gRec = placeSub(gid, curY, curY + gh, xStart);
        curY += gh + wingPad;
        // Connect gracefully from central rising branch stem up into Gen 2 cloud!
        const stemY = Math.min(STEM_BOT_Y - 75, Math.max(STEM_TOP_Y + 40, gRec.y + 130));
        edges.push({
          x1: CX, y1: stemY, cx1: CX + dir * 24, cy1: (stemY + gRec.y) * 0.5 - 24,
          cx2: CX + dir * Math.abs(gRec.x - CX) * 0.45, cy2: gRec.y,
          x2: gRec.x, y2: gRec.y, wStart: 15, wEnd: 9,
        });
      }
    }

    runWing(1, rightG2);
    runWing(-1, leftG2);

    // Check AABB overlaps (all nodes horizontal!)
    let ov = 0;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const A = placed[i], B = placed[j];
        if (Math.abs(A.x - B.x) < (A.w + B.w) / 2 - 1 && Math.abs(A.y - B.y) < (A.h + B.h) / 2 - 1) ov++;
      }
    }
    return { placed, edges, ov };
  }

  let chosen = null;
  for (const sc of [1.0, 0.94, 0.88, 0.82, 0.76]) {
    const r = tryLayout(sc);
    chosen = { ...r, sc };
    if (r.ov === 0) break;
  }
  const sampleLeaf = chosen.placed.find((p) => !p.isParent && p.n.generation >= 3);
  console.log(`A4 Page ${pageNum} (${branchNode.name}, n=${chosen.placed.length + 1}): scale=${chosen.sc}, overlaps=${chosen.ov}, leafFont=${sampleLeaf ? sampleLeaf.fontSize : "-"}px`);

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" lang="ar" xml:lang="ar" direction="rtl" viewBox="0 0 ${PW} ${PH}">`);
  out.push(...plateChromeSvg(pageNum, totalPages, `فرع ${branchNode.name}`, `عدد أفراد الفرع: ${toArabic(count)} اسماً — مرتب حسب الأجيال والأفخاذ`, pal.stroke));

  // Tapered organic boughs (behind stem & branch shield)
  out.push(`<g>`);
  for (const e of chosen.edges) {
    out.push(`<path d="${taperedBezierPath(e.x1, e.y1, e.cx1, e.cy1, e.cx2, e.cy2, e.x2, e.y2, e.wStart, e.wEnd, 14)}" fill="${pal.bough}" fill-opacity="0.82"/>`);
  }
  out.push(`</g>`);

  // Rising sculpted central palm bough stem for this branch plate
  const minNodeY = Math.min(...chosen.placed.map((p) => p.y));
  const stemTopActual = Math.max(STEM_TOP_Y, minNodeY + 30);
  out.push(`<path d="M ${CX - 54} 2815 C ${CX - 34} 2740, ${CX - 26} 2690, ${CX - 20} ${STEM_BOT_Y} L ${CX - 8} ${stemTopActual} L ${CX + 8} ${stemTopActual} L ${CX + 20} ${STEM_BOT_Y} C ${CX + 26} 2690, ${CX + 34} 2740, ${CX + 54} 2815 Z" fill="url(#a4Trunk_${pageNum})" stroke="#C9A45A" stroke-width="3"/>`);

  // Nodes (leaves -> fathers -> Gen 2)
  const ordered = [...chosen.placed].sort((a, b) => b.n.generation - a.n.generation);
  for (const p of ordered) {
    out.push(`<g transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)})">`);
    if (p.n.generation === 2) {
      out.push(`<path d="${heritageCloudPath(p.w, p.h)}" fill="url(#a4Cloud_${pageNum})" stroke="#9B6E1F" stroke-width="3"/>
        <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="#0B241B" font-size="${p.fontSize}" font-weight="700" class="m-serif">${rtl(p.n.name)}</text>`);
    } else if (p.isParent) {
      out.push(`<rect x="${(-p.w / 2).toFixed(1)}" y="${(-p.h / 2).toFixed(1)}" width="${p.w}" height="${p.h}" rx="${(p.h / 2).toFixed(1)}" fill="#FFFDF6" stroke="${pal.stroke}" stroke-width="2.6"/>
        <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="#0B241B" font-size="${p.fontSize}" font-weight="800" class="m-sans">${rtl(p.n.name)}</text>`);
    } else {
      out.push(`<path d="${leafSvgPath(p.w, p.h)}" fill="${pal.leafFill}" stroke="${pal.stroke}" stroke-width="2.1"/>
        <text x="0" y="${(p.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="#0A2118" font-size="${p.fontSize}" font-weight="800" class="m-sans">${rtl(p.n.name)}</text>`);
    }
    out.push(`</g>`);
  }

  // Grand Branch Head Medallion at Base of Stem
  const spHead = a4Spec(branchNode, 1);
  out.push(`<g transform="translate(${CX}, ${STEM_BOT_Y})">
    <rect x="${-spHead.w / 2}" y="${-spHead.h / 2}" width="${spHead.w}" height="${spHead.h}" rx="${spHead.h / 2}" fill="${pal.stroke}" stroke="#E7CD90" stroke-width="4.5"/>
    <text x="0" y="${(spHead.fontSize * 0.34).toFixed(1)}" text-anchor="middle" fill="#FFFDF8" font-size="${spHead.fontSize}" font-weight="700" class="m-serif">${rtl(branchNode.name)}</text>
  </g>`);

  out.push(`</svg>`);
  return out.join("\n");
}

function buildPage7Plate(totalPages) {
  const PW = 2100, PH = 2970;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" lang="ar" xml:lang="ar" direction="rtl" viewBox="0 0 ${PW} ${PH}">`);
  out.push(...plateChromeSvg(7, totalPages, "فروع دغيليب ودهران ومضيان وجذع النسب", "الأجداد المتّصلون إلى قحطان وفروع الأبناء الأصغر عدداً", "#12372A"));

  const trunkX = 540;
  const ancOrder = [];
  for (let g = -10; g <= -1; g++) {
    const f = Object.values(nodesById).find((n) => n.generation === g);
    if (f) ancOrder.push(f);
  }
  out.push(`<rect x="115" y="275" width="850" height="2480" rx="28" fill="#FFFDF8" stroke="#C9A45A" stroke-width="3.2"/>`);
  out.push(`<text x="${trunkX}" y="355" text-anchor="middle" fill="#12372A" font-size="46" font-weight="700" class="m-serif">${rtl("جذع النسب إلى قحطان")}</text>`);
  out.push(`<line x1="220" y1="388" x2="860" y2="388" stroke="#C9A45A" stroke-width="2.2"/>`);
  out.push(`<path d="M ${trunkX - 115} 2645 L ${trunkX - 42} 540 L ${trunkX + 42} 540 L ${trunkX + 115} 2645 Z" fill="url(#a4Trunk_7)" stroke="#C9A45A" stroke-width="3.5"/>`);
  out.push(`<ellipse cx="${trunkX}" cy="2655" rx="230" ry="42" fill="#1E4B35" fill-opacity="0.22"/>`);

  out.push(`<g transform="translate(${trunkX}, 520)">
    <rect x="-155" y="-52" width="310" height="104" rx="52" fill="#12372A" stroke="#C9A45A" stroke-width="4.5"/>
    <text x="0" y="15" text-anchor="middle" fill="#FFFDF8" font-size="50" font-weight="700" class="m-serif">${rtl("عويض")}</text>
  </g>`);

  const yTop = 740, yBot = 2560;
  const stepY = (yBot - yTop) / Math.max(1, ancOrder.length - 1);
  ancOrder.forEach((anc, idx) => {
    const y = yBot - idx * stepY;
    const isQ = idx === 0;
    const bw = isQ ? 320 : 250;
    const bh = isQ ? 84 : 68;
    out.push(`<g transform="translate(${trunkX}, ${y.toFixed(1)})">
      <rect x="${-bw / 2}" y="${-bh / 2}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${isQ ? "#12372A" : "#FFFDF8"}" stroke="#C9A45A" stroke-width="${isQ ? 4.5 : 3}"/>
      <text x="0" y="${isQ ? 14 : 11}" text-anchor="middle" fill="${isQ ? "#E7CD90" : "#12372A"}" font-size="${isQ ? 46 : 36}" font-weight="700" class="m-serif">${rtl(anc.name)}</text>
    </g>`);
  });

  out.push(`<rect x="1030" y="275" width="955" height="1190" rx="28" fill="#FFFDF8" stroke="#C9A45A" stroke-width="3.2"/>`);
  out.push(`<text x="1930" y="355" text-anchor="start" fill="#315D73" font-size="46" font-weight="700" class="m-serif">${rtl("فرع دغيليب — ١٣ اسماً")}</text>`);
  out.push(`<line x1="1080" y1="388" x2="1930" y2="388" stroke="#C9A45A" stroke-width="2.2"/>`);

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
  pages.push(`<section class="a4-page">${MURAL_SVG.replace("<svg ", '<svg class="full-mural" ')}</section>`);
  ["B08", "B06", "B07", "B05", "B01"].forEach((bid, idx) => {
    pages.push(`<section class="a4-page">${buildBranchPlate(bid, idx + 2, TOTAL)}</section>`);
  });
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

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "edge-a4book-v3-"));
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
  console.log("Wrote 7-Page Planar A4 Print Booklet PDF:", PDF_OUT, "size=", fs.statSync(PDF_OUT).size);

  await cdp("Emulation.setDeviceMetricsOverride", { width: 794, height: 1123, deviceScaleFactor: 2, mobile: false });
  for (const [pg, fname] of [[1, "_a4_v3_p1.png"], [2, "_a4_v3_p2_madi.png"]]) {
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
