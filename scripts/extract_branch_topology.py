from pathlib import Path
import json
import heapq
import colorsys
import pymupdf
from shapely.geometry import Polygon, Point, box
from shapely.ops import unary_union
from PIL import Image, ImageDraw, ImageFont

PDF_PATH = Path(r"C:\Users\fahad\Desktop\فخذ ذوي عويض.pdf")
NODES_PATH = Path(r"c:\Projects\dhawi-uwaid\data\nodes_raw.json")
OUT_JSON = Path(r"c:\Projects\dhawi-uwaid\data\branch_topology.json")
OUT_PNG = Path(r"c:\Projects\dhawi-uwaid\audit\branches_colored.png")


def drawing_to_geom(d: dict):
    """Convert a PyMuPDF drawing dict into a valid Shapely geometry (even-odd compound handling)."""
    subpaths = []
    cur = []
    prev_end = None

    def close_cur():
        nonlocal cur
        if len(cur) >= 3:
            subpaths.append(cur)
        cur = []

    for item in d["items"]:
        op = item[0]
        if op == "l":
            p0, p1 = item[1], item[2]
            if prev_end is None or abs(p0.x - prev_end.x) + abs(p0.y - prev_end.y) > 0.6:
                close_cur()
                cur.append((p0.x, p0.y))
            cur.append((p1.x, p1.y))
            prev_end = p1
        elif op == "c":
            p0, p1, p2, p3 = item[1], item[2], item[3], item[4]
            if prev_end is None or abs(p0.x - prev_end.x) + abs(p0.y - prev_end.y) > 0.6:
                close_cur()
                cur.append((p0.x, p0.y))
            for i in range(1, 9):
                t = i / 8.0
                x = (1 - t) ** 3 * p0.x + 3 * (1 - t) ** 2 * t * p1.x + 3 * (1 - t) * t ** 2 * p2.x + t ** 3 * p3.x
                y = (1 - t) ** 3 * p0.y + 3 * (1 - t) ** 2 * t * p1.y + 3 * (1 - t) * t ** 2 * p2.y + t ** 3 * p3.y
                cur.append((x, y))
            prev_end = p3
        elif op == "re":
            close_cur()
            r = item[1]
            subpaths.append([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)])
            prev_end = None
    close_cur()

    polys = []
    for sp in subpaths:
        if len(sp) >= 3:
            p = Polygon(sp).buffer(0)
            if not p.is_empty and p.area > 0.5:
                polys.append(p)
    if not polys:
        return None
    geom = polys[0]
    for p in polys[1:]:
        # Adobe Illustrator compound paths often use even-odd holes
        if geom.contains(p):
            geom = geom.difference(p)
        elif p.contains(geom):
            geom = p.difference(geom)
        else:
            geom = geom.union(p)
    return geom.buffer(0)


def get_font(size: int):
    for fp in [r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\calibrib.ttf"]:
        if Path(fp).exists():
            return ImageFont.truetype(fp, size)
    return ImageFont.load_default()


def main() -> None:
    nodes = json.loads(NODES_PATH.read_text(encoding="utf-8"))
    doc = pymupdf.open(PDF_PATH)
    page = doc[0]

    # Collect leaf image bounding boxes
    leaf_imgs = []
    for im in page.get_image_info(xrefs=True):
        r = pymupdf.Rect(im["bbox"])
        if 30 <= r.width <= 130 and 30 <= r.height <= 130:
            leaf_imgs.append(r)

    # Extract all 221 branch drawings
    branches = []
    for idx, d in enumerate(page.get_drawings()):
        fill = tuple(round(x, 2) for x in d["fill"]) if d.get("fill") else None
        if fill != (0.0, 0.0, 0.0):
            continue
        r = d["rect"]
        if r.y0 < 380 or r.y1 > 2770:
            continue
        # Exclude scalloped node outline rings (~35..68pt squares)
        if 35 <= r.width <= 68 and 35 <= r.height <= 68 and abs(r.width - r.height) < 12:
            continue
        geom = drawing_to_geom(d)
        if geom is None or geom.is_empty or geom.area < 20:
            continue
        branches.append({
            "pdf_idx": idx,
            "rect": [round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2)],
            "area": round(geom.area, 2),
            "geom": geom,
        })

    # Sort deterministically: trunk first (largest area/height), then top-to-bottom, left-to-right
    branches.sort(key=lambda b: (-b["area"] if b["rect"][3] - b["rect"][1] > 1000 else 0, b["rect"][1], b["rect"][0]))
    for i, b in enumerate(branches):
        b["id"] = "BR_TRUNK" if (b["rect"][3] - b["rect"][1] > 1400) else f"BR_{i:03d}"

    trunk = [b for b in branches if b["id"] == "BR_TRUNK"]
    assert len(trunk) == 1, f"Expected 1 BR_TRUNK, found {len(trunk)}"
    print(f"Extracted {len(branches)} discrete branch polygons (trunk: {trunk[0]['rect']})")

    # Build adjacency graph with contact centroid & local thickness
    n_br = len(branches)
    adj = {b["id"]: [] for b in branches}
    for i in range(n_br):
        bi = branches[i]
        gi = bi["geom"]
        ri = bi["rect"]
        for j in range(i + 1, n_br):
            bj = branches[j]
            rj = bj["rect"]
            if ri[2] + 6 < rj[0] or rj[2] + 6 < ri[0] or ri[3] + 6 < rj[1] or rj[3] + 6 < ri[1]:
                continue
            dist = gi.distance(bj["geom"])
            if dist <= 4.0:
                inter = gi.buffer(2.5).intersection(bj["geom"].buffer(2.5))
                if inter.is_empty:
                    continue
                cpt = inter.representative_point()
                disk = cpt.buffer(18.0)
                thick_i = gi.intersection(disk).area
                thick_j = bj["geom"].intersection(disk).area
                adj[bi["id"]].append({
                    "nbr": bj["id"],
                    "dist": round(dist, 2),
                    "contact": [round(cpt.x, 2), round(cpt.y, 2)],
                    "self_thick": round(thick_i, 1),
                    "nbr_thick": round(thick_j, 1),
                    "overlap_area": round(inter.area, 1),
                })
                adj[bj["id"]].append({
                    "nbr": bi["id"],
                    "dist": round(dist, 2),
                    "contact": [round(cpt.x, 2), round(cpt.y, 2)],
                    "self_thick": round(thick_j, 1),
                    "nbr_thick": round(thick_i, 1),
                    "overlap_area": round(inter.area, 1),
                })

    # Prim/Dijkstra spanning tree from BR_TRUNK maximizing parent thickness & minimizing distance
    parent_map = {"BR_TRUNK": None}
    base_point_map = {"BR_TRUNK": [1019.6, 2131.8]}
    contact_meta = {"BR_TRUNK": {}}

    # Priority queue: (dist_bucket, -parent_thick, -overlap_area, child_id, parent_id, contact_pt)
    pq = []
    for edge in adj["BR_TRUNK"]:
        heapq.heappush(pq, (0 if edge["dist"] <= 0.5 else 1, -edge["self_thick"], -edge["overlap_area"], edge["nbr"], "BR_TRUNK", edge["contact"], edge))

    while pq:
        db, neg_pt, neg_ov, cid, pid, cpt, edge = heapq.heappop(pq)
        if cid in parent_map:
            continue
        parent_map[cid] = pid
        base_point_map[cid] = cpt
        contact_meta[cid] = {
            "dist": edge["dist"],
            "parent_thick": round(-neg_pt, 1),
            "child_thick": edge["nbr_thick"],
        }
        for nxt in adj[cid]:
            if nxt["nbr"] not in parent_map:
                # Prefer contacts where cid (parent) is thicker than or equal to nxt (child)
                # and close contacts
                ratio_penalty = 0 if nxt["self_thick"] >= nxt["nbr_thick"] * 0.75 else 1
                db2 = (0 if nxt["dist"] <= 0.5 else 1) + ratio_penalty * 2
                heapq.heappush(pq, (db2, -nxt["self_thick"], -nxt["overlap_area"], nxt["nbr"], cid, nxt["contact"], nxt))

    unconnected = [b["id"] for b in branches if b["id"] not in parent_map]
    print(f"Connected branches: {len(parent_map)}/{len(branches)} | Unconnected: {unconnected}")

    # Assign non-ancestor nodes to branches
    by_id = {b["id"]: b for b in branches}
    node_assignments = {}
    for n in nodes:
        if n["tier"] == "ancestor":
            continue
        pt = Point(n["cx"], n["cy"])
        # Find leaf image bbox if leaf
        img_box = None
        if n["tier"] == "tier4_leaf":
            hits = [r for r in leaf_imgs if r.contains(pymupdf.Point(n["cx"], n["cy"]))]
            if hits:
                hits.sort(key=lambda r: r.get_area())
                r = hits[0]
                img_box = box(r.x0, r.y0, r.x1, r.y1)

        cands = []
        for b in branches:
            d_pt = b["geom"].distance(pt)
            d_img = b["geom"].distance(img_box) if img_box is not None else d_pt
            # Local contact area near center
            a_pt = b["geom"].intersection(pt.buffer(18.0)).area
            a_img = b["geom"].intersection(img_box).area if img_box is not None else a_pt
            if d_pt <= 28.0 or d_img <= 8.0:
                cands.append((b["id"], round(d_pt, 2), round(d_img, 2), round(a_pt, 1), round(a_img, 1)))

        if not cands:
            # fallback nearest branch
            best = min(branches, key=lambda b: b["geom"].distance(pt))
            cands = [(best["id"], round(best["geom"].distance(pt), 2), round(best["geom"].distance(img_box) if img_box else best["geom"].distance(pt), 2), 0.0, 0.0)]

        # Sort candidates: for B/Y/M prefer highest a_pt (on branch), for L prefer smallest d_img then d_pt
        if n["tier"] in ("root", "tier1_son", "tier2_yellow", "tier3_mint"):
            cands.sort(key=lambda c: (c[1] > 1.0, -c[3], c[1]))
        else:
            cands.sort(key=lambda c: (c[2] > 1.0, c[1], -c[4]))

        primary = cands[0][0]
        bp = base_point_map[primary]
        dist_from_base = round(((n["cx"] - bp[0]) ** 2 + (n["cy"] - bp[1]) ** 2) ** 0.5, 2)
        node_assignments[n["id"]] = {
            "primary_branch": primary,
            "dist_from_base": dist_from_base,
            "candidates": cands[:4],
        }

    # Save JSON
    out_data = {
        "branches": [
            {
                "id": b["id"],
                "parent_branch": parent_map.get(b["id"]),
                "base_point": base_point_map.get(b["id"]),
                "rect": b["rect"],
                "area": b["area"],
                "contact_meta": contact_meta.get(b["id"], {}),
                "all_adjacent": adj[b["id"]],
            }
            for b in branches
        ],
        "unconnected": unconnected,
        "node_assignments": node_assignments,
    }
    OUT_JSON.write_text(json.dumps(out_data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {OUT_JSON}")

    # Render color-coded branches map (zoom 1.5x)
    clip = pymupdf.Rect(140, 380, 1860, 2320)
    zoom = 1.6
    W, H = int(clip.width * zoom), int(clip.height * zoom)
    img = Image.new("RGB", (W, H), (250, 247, 240))
    draw = ImageDraw.Draw(img)
    font = get_font(12)

    for idx, b in enumerate(branches):
        if b["id"] == "BR_TRUNK":
            col = (35, 35, 35)
        else:
            h = ((idx * 37) % 360) / 360.0
            s = 0.72 + ((idx % 3) * 0.08)
            v = 0.55 + ((idx % 4) * 0.1)
            r_c, g_c, b_c = colorsys.hsv_to_rgb(h, s, v)
            col = (int(r_c * 255), int(g_c * 255), int(b_c * 255))

        geom = b["geom"]
        geoms = list(geom.geoms) if hasattr(geom, "geoms") else [geom]
        for g in geoms:
            if g.is_empty:
                continue
            pts = [((x - clip.x0) * zoom, (y - clip.y0) * zoom) for x, y in g.exterior.coords]
            if len(pts) >= 3:
                draw.polygon(pts, fill=col)

    # Label branch base points & IDs
    for b in branches:
        if b["id"] == "BR_TRUNK":
            continue
        cpt = base_point_map.get(b["id"])
        if cpt and clip.contains(pymupdf.Point(cpt[0], cpt[1])):
            px, py = (cpt[0] - clip.x0) * zoom, (cpt[1] - clip.y0) * zoom
            draw.ellipse([px - 4, py - 4, px + 4, py + 4], fill=(255, 255, 255), outline=(0, 0, 0), width=1)
        rp = b["geom"].representative_point()
        if clip.contains(pymupdf.Point(rp.x, rp.y)):
            rx, ry = (rp.x - clip.x0) * zoom, (rp.y - clip.y0) * zoom
            lbl = b["id"].replace("BR_", "B")
            draw.rectangle([rx - 14, ry - 7, rx + 14, ry + 7], fill=(255, 255, 255))
            draw.text((rx - 12, ry - 6), lbl, font=font, fill=(0, 0, 0))

    img.save(OUT_PNG)
    print(f"Saved {OUT_PNG}")


if __name__ == "__main__":
    main()
