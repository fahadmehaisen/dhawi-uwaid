from pathlib import Path
import json
import math
import unicodedata
import pymupdf
from PIL import Image, ImageDraw

PDF2_PATH = Path(r"C:\Users\fahad\Desktop\120x191.pdf")
PDF1_TREE_PATH = Path(r"c:\Projects\dhawi-uwaid\data\tree.json")
OUT_NODES_V2 = Path(r"c:\Projects\dhawi-uwaid\data\nodes_v2_raw.json")
OUT_DIFF_JSON = Path(r"c:\Projects\dhawi-uwaid\audit\diff_v1_v2.json")
OUT_DIFF_SHEET = Path(r"c:\Projects\dhawi-uwaid\audit\v2_changes_sheet.png")


def norm_text(raw: str) -> str:
    s = unicodedata.normalize("NFKC", raw).replace("االله", "الله")
    return " ".join(s.split())


def main() -> None:
    doc = pymupdf.open(PDF2_PATH)
    page = doc[0]
    W, H = page.rect.width, page.rect.height

    yellow_rects = []
    mint_rects = []
    for d in page.get_drawings():
        f = tuple(round(x, 2) for x in d["fill"]) if d.get("fill") else None
        r = d["rect"]
        if not f or r.width >= 600 or r.height >= 600:
            continue
        if f in ((0.82, 0.82, 0.47), (0.77, 0.82, 0.51)):
            yellow_rects.append(r)
        elif f == (0.38, 0.76, 0.57):
            mint_rects.append(r)

    raw_nodes = []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            raw = "".join(s["text"] for s in l["spans"]).strip()
            if not raw:
                continue
            r = pymupdf.Rect(l["bbox"])
            nx = (r.x0 + r.x1) / (2.0 * W)
            ny = (r.y0 + r.y1) / (2.0 * H)
            if ny < 0.13 or ny > 0.96:
                continue
            if ny < 0.19 and (nx < 0.22 or nx > 0.78):
                continue
            if ny > 0.78 and (nx < 0.42 or nx > 0.58):
                continue
            norm = norm_text(raw)
            if len(norm) > 25:
                continue

            cx = round((r.x0 + r.x1) / 2.0, 2)
            cy = round((r.y0 + r.y1) / 2.0, 2)
            sz = round(l["spans"][0]["size"], 1)
            pt = pymupdf.Point(cx, cy)

            if sz >= 44:
                if ny > 0.74:
                    tier = "ancestor"
                elif norm == "عويض":
                    tier = "root"
                else:
                    tier = "tier1_son"
            elif any(yr.contains(pt) for yr in yellow_rects):
                tier = "tier2_yellow"
            elif any(mr.contains(pt) for mr in mint_rects):
                tier = "tier3_mint"
            else:
                tier = "tier4_leaf"

            raw_nodes.append({
                "rawText": raw,
                "normalizedText": norm,
                "cx": cx,
                "cy": cy,
                "nx": round(nx, 5),
                "ny": round(ny, 5),
                "bbox": [round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2)],
                "fontSize": sz,
                "tier": tier,
            })

    assert len(raw_nodes) == 760, f"Expected 760 nodes in 120x191.pdf, got {len(raw_nodes)}"

    ancestors = sorted([n for n in raw_nodes if n["tier"] == "ancestor"], key=lambda n: -n["cy"])
    roots = [n for n in raw_nodes if n["tier"] == "root"]
    tier1 = sorted([n for n in raw_nodes if n["tier"] == "tier1_son"], key=lambda n: (-n["cy"], -n["cx"]))
    tier2 = sorted([n for n in raw_nodes if n["tier"] == "tier2_yellow"], key=lambda n: (n["cy"], n["cx"]))
    tier3 = sorted([n for n in raw_nodes if n["tier"] == "tier3_mint"], key=lambda n: (n["cy"], n["cx"]))
    tier4 = sorted([n for n in raw_nodes if n["tier"] == "tier4_leaf"], key=lambda n: (n["cy"], n["cx"]))

    print(f"Tiers: A={len(ancestors)}, R={len(roots)}, B={len(tier1)}, Y={len(tier2)}, M={len(tier3)}, L={len(tier4)}")
    assert len(ancestors) == 10
    assert len(roots) == 1
    assert len(tier1) == 8

    ordered = []
    for i, n in enumerate(ancestors, 1):
        n["id"] = f"A{i:02d}"; ordered.append(n)
    roots[0]["id"] = "R00"; ordered.append(roots[0])
    for i, n in enumerate(tier1, 1):
        n["id"] = f"B{i:02d}"; ordered.append(n)
    for i, n in enumerate(tier2, 1):
        n["id"] = f"Y{i:02d}"; ordered.append(n)
    for i, n in enumerate(tier3, 1):
        n["id"] = f"M{i:03d}"; ordered.append(n)
    for i, n in enumerate(tier4, 1):
        n["id"] = f"L{i:03d}"; ordered.append(n)

    # Known glyph fixes by raw/positional verification (verified identical anomalies in task-278)
    GLYPH_MAP = {
        "أمري": "أمير",
        "واـَّ": "وافي",
        "الرباء": "البراء",
        "حسني": "حسين",
        "عبداـِّحسن": "عبدالمحسن",
        "عبداـِّجيد": "عبدالمجيد",
        "عبد اـِّجيد": "عبدالمجيد",
    }
    # Confirmed owner spelling normalizations (KEEPING متاعب as متاعب!)
    CONFIRMED_SPELLING = {
        "دغيلب": "دغيليب",
        "سطان": "سلطان",
        "اثنيان": "ثنيان",
        "سراحان": "سرحان",
    }
    for n in ordered:
        t = n["normalizedText"]
        t = GLYPH_MAP.get(t, t)
        t = CONFIRMED_SPELLING.get(t, t)
        n["cleanName"] = t

    OUT_NODES_V2.write_text(json.dumps(ordered, ensure_ascii=False, indent=2), encoding="utf-8")

    # Align canopy nodes (excluding ancestors) with PDF1 tree.json via affine min..max canopy normalization
    v1_tree = json.loads(PDF1_TREE_PATH.read_text(encoding="utf-8"))
    v1_canopy = [n for n in v1_tree["nodesById"].values() if n["generation"] >= 0]
    v2_canopy = [n for n in ordered if n["tier"] != "ancestor"]

    def affine_norm(lst, get_xy):
        xs = [get_xy(n)[0] for n in lst]
        ys = [get_xy(n)[1] for n in lst]
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
        return [(n, (get_xy(n)[0] - x0) / (x1 - x0), (get_xy(n)[1] - y0) / (y1 - y0)) for n in lst]

    a1 = affine_norm(v1_canopy, lambda n: (n["cx"], n["cy"]))
    a2 = affine_norm(v2_canopy, lambda n: (n["cx"], n["cy"]))

    matched_v2_to_v1 = {}
    used_v1 = set()

    # Pass 1: exact clean name + same tier within 0.028
    for n2, rx2, ry2 in a2:
        best = None
        for idx1, (n1, rx1, ry1) in enumerate(a1):
            if idx1 in used_v1 or n1["name"] != n2["cleanName"] or n1["tier"] != n2["tier"]:
                continue
            d = math.hypot(rx1 - rx2, ry1 - ry2)
            if d < 0.032 and (best is None or d < best[0]):
                best = (d, idx1, n1)
        if best:
            used_v1.add(best[1])
            matched_v2_to_v1[n2["id"]] = (best[2]["id"], "exact", round(best[0], 4))

    # Pass 2: exact clean name (any tier) within 0.035
    for n2, rx2, ry2 in a2:
        if n2["id"] in matched_v2_to_v1:
            continue
        best = None
        for idx1, (n1, rx1, ry1) in enumerate(a1):
            if idx1 in used_v1 or n1["name"] != n2["cleanName"]:
                continue
            d = math.hypot(rx1 - rx2, ry1 - ry2)
            if d < 0.038 and (best is None or d < best[0]):
                best = (d, idx1, n1)
        if best:
            used_v1.add(best[1])
            matched_v2_to_v1[n2["id"]] = (best[2]["id"], "exact_diff_tier", round(best[0], 4))

    # Pass 3: very close position (<0.018) with different name -> likely renamed at spot
    renamed = []
    for n2, rx2, ry2 in a2:
        if n2["id"] in matched_v2_to_v1:
            continue
        best = None
        for idx1, (n1, rx1, ry1) in enumerate(a1):
            if idx1 in used_v1:
                continue
            d = math.hypot(rx1 - rx2, ry1 - ry2)
            if d < 0.022 and (best is None or d < best[0]):
                best = (d, idx1, n1)
        if best:
            used_v1.add(best[1])
            n1 = best[2]
            matched_v2_to_v1[n2["id"]] = (n1["id"], "renamed", round(best[0], 4))
            renamed.append((n2["id"], n1["id"], n1["name"], n2["cleanName"], n2["cx"], n2["cy"]))

    new_in_v2 = [n for n in v2_canopy if n["id"] not in matched_v2_to_v1]
    removed_in_v2 = [a1[i][0] for i in range(len(a1)) if i not in used_v1]

    print(f"Matched={len(matched_v2_to_v1)} (renamed={len(renamed)}) | New in v2={len(new_in_v2)} | Removed from v1={len(removed_in_v2)}")
    for r in renamed:
        print("  RENAMED:", r[:4])
    for n in new_in_v2:
        print(f"  NEW: {n['id']} {n['cleanName']} ({n['tier']}) at ({n['cx']}, {n['cy']})")
    for n in removed_in_v2:
        print(f"  REMOVED: {n['id']} {n['name']} ({n['tier']}) branch={n['branchName']} parent={n['parentId']}")

    diff_data = {
        "matched_v2_to_v1": {k: v[0] for k, v in matched_v2_to_v1.items()},
        "renamed": renamed,
        "new_in_v2": [{"id": n["id"], "name": n["cleanName"], "tier": n["tier"], "cx": n["cx"], "cy": n["cy"]} for n in new_in_v2],
        "removed_from_v1": [{"id": n["id"], "name": n["name"], "branch": n["branchName"], "parent": n["parentId"]} for n in removed_in_v2],
    }
    OUT_DIFF_JSON.write_text(json.dumps(diff_data, ensure_ascii=False, indent=2), encoding="utf-8")

    # Render visual inspection sheet for ALL new_in_v2 + renamed nodes (with wide context around each!)
    inspect_nodes = list(new_in_v2) + [n for n in v2_canopy if any(r[0] == n["id"] for r in renamed)]
    cols = 4
    cw, ch = 460, 380
    rows = max(1, (len(inspect_nodes) + cols - 1) // cols)
    sheet = Image.new("RGB", (cols * cw, rows * ch), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    by_id_v2 = {n["id"]: n for n in ordered}

    for idx, target in enumerate(inspect_nodes):
        r_idx, c_idx = divmod(idx, cols)
        x_off, y_off = c_idx * cw, r_idx * ch
        clip = pymupdf.Rect(target["cx"] - 210, target["cy"] - 175, target["cx"] + 210, target["cy"] + 175)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(1.1, 1.1), clip=clip, alpha=False)
        im = Image.frombytes("RGB", [pix.width, pix.height], pix.samples).convert("RGBA")
        ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
        d_ov = ImageDraw.Draw(ov)
        for n in v2_canopy:
            if clip.contains(pymupdf.Point(n["cx"], n["cy"])):
                px, py = (n["cx"] - clip.x0) * 1.1, (n["cy"] - clip.y0) * 1.1
                bg = (200, 20, 20, 225) if n["id"] == target["id"] else (20, 20, 20, 195)
                d_ov.rounded_rectangle([px - 18, py - 18, px + 18, py - 4], radius=3, fill=bg)
                d_ov.text((px - 15, py - 17), n["id"], fill=(255, 255, 255, 255))
        comp = Image.alpha_composite(im, ov).convert("RGB")
        comp.thumbnail((cw - 16, ch - 36), Image.Resampling.LANCZOS)
        sheet.paste(comp, (x_off + 8, y_off + 30))
        draw.rectangle([x_off, y_off, x_off + cw - 1, y_off + ch - 1], outline=(180, 180, 180))
        tag = "RENAMED" if any(r[0] == target["id"] for r in renamed) else "NEW"
        draw.text((x_off + 8, y_off + 8), f"[{tag}] {target['id']} {target['cleanName']} ({int(target['cx'])},{int(target['cy'])})", fill=(20, 20, 20))

    sheet.save(OUT_DIFF_SHEET)
    print(f"Saved {OUT_DIFF_SHEET} ({len(inspect_nodes)} inspect cells)")


if __name__ == "__main__":
    main()
