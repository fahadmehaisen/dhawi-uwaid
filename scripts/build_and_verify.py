from pathlib import Path
import csv
import json
import math
import pymupdf
from PIL import Image, ImageDraw, ImageFont

PROJECT_DIR = Path(r"c:\Projects\dhawi-uwaid")
PDF_PATH = Path(r"C:\Users\fahad\Desktop\فخذ ذوي عويض.pdf")
NODES_PATH = PROJECT_DIR / "data" / "nodes_raw.json"
EDGES_PATH = PROJECT_DIR / "data" / "edges.json"
OUT_JSON = PROJECT_DIR / "data" / "tree.json"
OUT_JS = PROJECT_DIR / "data" / "tree-data.js"
OUT_CSV = PROJECT_DIR / "data" / "members.csv"
AUDIT_DIR = PROJECT_DIR / "audit"

# Visually verified font/encoding fixes from glyph_check.png & glyph_check_2.png
GLYPH_FIXES = {
    "L010": "أمير",
    "L065": "وافي",
    "L131": "البراء",
    "L237": "حسين",
    "L033": "عبدالمحسن",
    "L263": "عبدالمحسن",
    "L293": "عبدالمحسن",
    "L075": "عبدالمجيد",
    "L095": "عبدالمجيد",
}

# Owner-confirmed spelling corrections replacing source typos
USER_CONFIRMED_FIXES = {
    "L306": "بدر",
    "L368": "دغيليب",
    "L440": "سلطان",
    "L466": "ثنيان",
    "M148": "متعب",
    "Y17": "سرحان",
}

PDF_NOTES = {}

BRANCH_COLORS = {
    "B01": (214, 40, 40),    # قليشان - crimson
    "B02": (130, 80, 40),    # مضيان
    "B03": (100, 100, 100),  # دهران
    "B04": (247, 127, 0),    # دغيليب - orange
    "B05": (114, 9, 183),    # سمران - purple
    "B06": (0, 119, 182),    # ثويني - blue
    "B07": (42, 157, 143),   # جرار - teal
    "B08": (27, 110, 45),    # ماضي - forest green
    "ROOT": (160, 120, 20),
    "ANC": (90, 55, 25),
}

TIER_LABELS_AR = {
    "ancestor": "سلف (عمود النسب)",
    "root": "الجد الجامع (عويض)",
    "tier1_son": "فرع رئيسي (أبناء عويض)",
    "tier2_yellow": "دائرة صفراء (طبقة الأجداد الأوائل)",
    "tier3_mint": "بيضاوي أخضر فاتح (عقدة فرعية)",
    "tier4_leaf": "ورقة خضراء",
}


def get_font(size: int):
    for fp in [r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\calibrib.ttf"]:
        if Path(fp).exists():
            return ImageFont.truetype(fp, size)
    return ImageFont.load_default()


def draw_arrow(draw: ImageDraw.ImageDraw, x1: float, y1: float, x2: float, y2: float, color: tuple, width: int = 3):
    """Draw a directed arrow from child (x1,y1) toward parent (x2,y2)."""
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    if length < 2:
        return
    ux, uy = dx / length, dy / length
    # Pull back slightly from parent center so arrowhead is clear
    ex, ey = x2 - ux * min(10.0, length * 0.25), y2 - uy * min(10.0, length * 0.25)
    draw.line([(x1, y1), (ex, ey)], fill=color, width=width)
    # Arrowhead at (ex, ey) pointing along (ux, uy)
    head_len = min(10.0, length * 0.35)
    px, py = -uy, ux
    p_left = (ex - ux * head_len + px * (head_len * 0.48), ey - uy * head_len + py * (head_len * 0.48))
    p_right = (ex - ux * head_len - px * (head_len * 0.48), ey - uy * head_len - py * (head_len * 0.48))
    draw.polygon([(ex, ey), p_left, p_right], fill=color)


def main() -> None:
    raw_nodes = json.loads(NODES_PATH.read_text(encoding="utf-8"))
    edges = json.loads(EDGES_PATH.read_text(encoding="utf-8"))

    assert len(raw_nodes) == 759, f"Expected 759 nodes, got {len(raw_nodes)}"
    nodes = {}
    for n in raw_nodes:
        nid = n["id"]
        name = USER_CONFIRMED_FIXES.get(nid, GLYPH_FIXES.get(nid, n["normalizedText"]))
        nodes[nid] = {
            "id": nid,
            "name": name,
            "rawName": n["normalizedText"],
            "tier": n["tier"],
            "tierLabel": TIER_LABELS_AR[n["tier"]],
            "parentId": edges.get(nid),
            "cx": n["cx"],
            "cy": n["cy"],
            "bbox": n["bbox"],
            "pdfNote": PDF_NOTES.get(nid, ""),
        }

    # Graph invariant checks
    roots = [nid for nid, n in nodes.items() if n["parentId"] is None]
    assert roots == ["A01"], f"Expected single root A01, got {roots}"
    for nid, n in nodes.items():
        pid = n["parentId"]
        if pid is not None:
            assert pid in nodes, f"Dangling parent {pid} for {nid}"

    # Cycle detection & lineage path computation
    children_map = {nid: [] for nid in nodes}
    for nid, n in nodes.items():
        if n["parentId"] is not None:
            children_map[n["parentId"]].append(nid)

    visited = set()

    def walk_lineage(nid: str, path: list[str]):
        assert nid not in visited, f"Cycle or duplicate visit at {nid}"
        visited.add(nid)
        cur_path = path + [nid]
        nodes[nid]["_path"] = cur_path
        for cid in children_map[nid]:
            walk_lineage(cid, cur_path)

    walk_lineage("A01", [])
    assert len(visited) == 759, f"Unreachable/orphan nodes: {set(nodes) - visited}"

    # Compute generation (عويض = 0), branch, fullLineage, descendantCount
    r00_depth = len(nodes["R00"]["_path"]) - 1  # 11
    branch_names = {f"B{i:02d}": nodes[f"B{i:02d}"]["name"] for i in range(1, 9)}

    def count_desc(nid: str) -> int:
        total = 0
        for cid in children_map[nid]:
            total += 1 + count_desc(cid)
        nodes[nid]["descendantCount"] = total
        return total

    count_desc("A01")

    for nid, n in nodes.items():
        p = n["_path"]
        depth = len(p) - 1
        n["generation"] = depth - r00_depth
        n["childrenIds"] = children_map[nid]
        n["childrenCount"] = len(children_map[nid])

        # Determine main branch B01..B08
        b_id = next((x for x in p if x.startswith("B")), None)
        n["branchId"] = b_id if b_id else ("ROOT" if nid == "R00" else "ANC")
        n["branchName"] = branch_names[b_id] if b_id else ("عويض" if nid == "R00" else "عمود النسب")

        # Full lineage string: Name بن Father بن ... بن قحطان
        lineage_names = [nodes[x]["name"] for x in reversed(p)]
        n["fullLineage"] = " بن ".join(lineage_names)
        del n["_path"]

    # Verify all 747 descendants of R00 belong to B01..B08
    desc_of_r00 = [n for n in nodes.values() if n["generation"] >= 1]
    assert len(desc_of_r00) == 747, f"Expected 747 descendants of عويض, got {len(desc_of_r00)}"
    assert all(n["branchId"].startswith("B") for n in desc_of_r00)
    assert nodes["B02"]["descendantCount"] == 0, "Expected B02 مضيان to have 0 descendants"
    assert nodes["B03"]["descendantCount"] == 0, "Expected B03 دهران to have 0 descendants"

    # Build clean nested tree from A01
    def build_nested(nid: str) -> dict:
        n = nodes[nid]
        return {
            "id": n["id"],
            "name": n["name"],
            "tier": n["tier"],
            "generation": n["generation"],
            "branchId": n["branchId"],
            "branchName": n["branchName"],
            "childrenCount": n["childrenCount"],
            "descendantCount": n["descendantCount"],
            "pdfNote": n["pdfNote"] or None,
            "children": [build_nested(cid) for cid in children_map[nid]],
        }

    # Branch summary stats
    branch_stats = []
    for i in range(1, 9):
        bid = f"B{i:02d}"
        bn = nodes[bid]
        sub_nodes = [n for n in nodes.values() if n["branchId"] == bid]
        max_gen = max(n["generation"] for n in sub_nodes)
        branch_stats.append({
            "branchId": bid,
            "name": bn["name"],
            "directSonsCount": bn["childrenCount"],
            "totalDescendants": bn["descendantCount"],
            "totalInBranch": len(sub_nodes),
            "maxGeneration": max_gen,
        })

    tree_payload = {
        "meta": {
            "title": "شجرة فخذ ذوي عويض — الشدادين من بني الحارث • قيا",
            "region": "قيا — جنوب الطائف",
            "sourceEditionDate": "2025-08-30",
            "totalNodes": len(nodes),
            "ancestorsCount": 11,
            "descendantsOfUwaid": 747,
            "branchesCount": 8,
            "glyphFixesApplied": len(GLYPH_FIXES),
            "ownerConfirmedFixesApplied": len(USER_CONFIRMED_FIXES),
            "pdfSpellingNotesCount": len(PDF_NOTES),
        },
        "branchStats": branch_stats,
        "nodesById": nodes,
        "root": build_nested("A01"),
    }

    json_str = json.dumps(tree_payload, ensure_ascii=False, indent=2)
    OUT_JSON.write_text(json_str, encoding="utf-8")
    OUT_JS.write_text("window.DHAWI_UWAID_TREE = " + json_str + ";\n", encoding="utf-8")
    print(f"Saved {OUT_JSON} and {OUT_JS} ({len(nodes)} nodes verified)")

    # Write members.csv (UTF-8 with BOM for Excel Arabic)
    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ID", "Name", "Father", "Branch", "Generation", "NodeType", "ChildrenCount", "DescendantCount", "FullLineage", "PdfNote"])
        for n in raw_nodes:
            m = nodes[n["id"]]
            father_name = nodes[m["parentId"]]["name"] if m["parentId"] else ""
            w.writerow([
                m["id"],
                m["name"],
                father_name,
                m["branchName"],
                m["generation"],
                m["tierLabel"],
                m["childrenCount"],
                m["descendantCount"],
                m["fullLineage"],
                m["pdfNote"],
            ])
    print(f"Saved {OUT_CSV}")

    # Write verification-report.md first
    lines = [
        "# تقرير التدقيق الهندسي والنسبي لشجرة فخذ ذوي عويض",
        "",
        "## 1. ملخص التحقق الرقمي",
        f"- **إجمالي الأسماء المستخرجة والمتحقق منها:** **{len(nodes)} اسماً** (0 مفقود، 0 دوران، 0 فروع معزولة).",
        "- **عمود النسب فوق الجد الجامع:** **11 اسماً** (`قحطان ← حارث ← شداد ← عياش ← مفلح ← ملفي ← دمشق ← بصيص ← مسفر ← مصلح ← مسفر ← عويض`).",
        "- **ذرية عويض:** **747 اسماً** موزعين على **8 فروع رئيسية**.",
        "",
        "## 2. فك شيفرة أنماط الأشكال في الشجرة الأصلية",
        "| الشكل واللون في اللوحة | الرمز في البيانات | الدلالة النسبية | العدد |",
        "| :--- | :--- | :--- | ---: |",
        "| شرائح الجذع البنية | `ancestor` | عمود النسب من قحطان إلى مسفر | 11 |",
        "| الدائرة الذهبية الكبرى | `root` | الجد الجامع: عويض | 1 |",
        "| الأغصان الخشبية الثمانية | `tier1_son` | أبناء عويض المباشرون (الفروع الثمانية) | 8 |",
        "| الدوائر الصفراء المسننة | `tier2_yellow` | رؤساء الأفخاذ الفرعية والأجداد الأوائل | 24 |",
        "| الأشكال البيضاوية الخضراء الفاتحة | `tier3_mint` | العقد الوسطى والآباء الفرعيون | 236 |",
        "| الأوراق الخضراء | `tier4_leaf` | الأبناء والأحفاد على الأطراف والغصينات | 479 |",
        "",
        "## 3. إحصائيات الفروع الثمانية (أبناء عويض)",
        "| الرقم | الفرع | الأبناء المباشرون على الغصن | إجمالي الذرية | الإجمالي بالفرع | أقصى جيل |",
        "| :--- | :--- | ---: | ---: | ---: | ---: |",
    ]
    for st in branch_stats:
        lines.append(f"| `{st['branchId']}` | {st['name']} | {st['directSonsCount']} | {st['totalDescendants']} | {st['totalInBranch']} | {st['maxGeneration']} |")

    lines.extend([
        "",
        "## 4. تصحيحات ترميز الخط العربي (تم التحقق منها بصرياً بنسبة 100%)",
        "| المعرّف | النص الخام المستخرج | الاسم الصحيح المثبت بصرياً |",
        "| :--- | :--- | :--- |",
    ])
    for nid, fixed in sorted(GLYPH_FIXES.items()):
        lines.append(f"| `{nid}` | `{nodes[nid]['rawName']}` | **{fixed}** |")

    lines.extend([
        "",
        "## 5. التصحيحات المعتمدة من المالك",
        "| المعرّف | الاسم قبل الاعتماد | الاسم المعتمد | الفرع |",
        "| :--- | :--- | :--- | :--- |",
    ])
    for nid, fixed in sorted(USER_CONFIRMED_FIXES.items()):
        lines.append(f"| `{nid}` | `{nodes[nid]['rawName']}` | **{fixed}** | {nodes[nid]['branchName']} |")

    report_path = AUDIT_DIR / "verification-report.md"
    report_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Saved {report_path}")

    import sys
    if "--skip-overlay" in sys.argv:
        return

    # Render Visual Verification Overlay (full + 4 quadrants)
    doc = pymupdf.open(PDF_PATH)
    page = doc[0]
    zoom = 1.8
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    base = Image.frombytes("RGB", [pix.width, pix.height], pix.samples).convert("RGBA")
    # Dim background to 40% brightness against warm paper so arrows pop
    paper = Image.new("RGBA", base.size, (255, 252, 245, 155))
    dimmed = Image.alpha_composite(base, paper)
    ov = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(ov)
    font = get_font(12)

    for nid, n in nodes.items():
        pid = n["parentId"]
        if pid is None:
            continue
        p = nodes[pid]
        col = BRANCH_COLORS.get(n["branchId"], (60, 60, 60)) + (230,)
        x1, y1 = n["cx"] * zoom, n["cy"] * zoom
        x2, y2 = p["cx"] * zoom, p["cy"] * zoom
        draw_arrow(draw, x1, y1, x2, y2, col, width=3)

    for nid, n in nodes.items():
        px, py = n["cx"] * zoom, n["cy"] * zoom
        col = BRANCH_COLORS.get(n["branchId"], (50, 50, 50))
        draw.ellipse([px - 4, py - 4, px + 4, py + 4], fill=col + (255,), outline=(255, 255, 255, 255), width=1)
        # Compact ID pill slightly above node center
        lbl = nid
        tb = draw.textbbox((0, 0), lbl, font=font)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        draw.rounded_rectangle([px - tw / 2 - 2, py - th - 6, px + tw / 2 + 2, py - 4], radius=3, fill=(20, 20, 20, 195))
        draw.text((px - tw / 2, py - th - 5), lbl, font=font, fill=(255, 255, 255, 255))

    full_img = Image.alpha_composite(dimmed, ov).convert("RGB")
    full_path = AUDIT_DIR / "verification_overlay.png"
    full_img.save(full_path)
    print(f"Saved {full_path}")

    # Save 4 overlapping quadrant crops of the canopy at zoom 1.8 (approx 1750x1850px each)
    W, H = full_img.size
    quads = {
        "overlay_q1_tl.png": (int(130 * zoom), int(380 * zoom), int(1050 * zoom), int(1380 * zoom)),
        "overlay_q2_tr.png": (int(930 * zoom), int(380 * zoom), int(1860 * zoom), int(1380 * zoom)),
        "overlay_q3_bl.png": (int(130 * zoom), int(1260 * zoom), int(1050 * zoom), int(2280 * zoom)),
        "overlay_q4_br.png": (int(930 * zoom), int(1260 * zoom), int(1860 * zoom), int(2280 * zoom)),
    }
    for qname, box_px in quads.items():
        crop = full_img.crop(box_px)
        crop.save(AUDIT_DIR / qname)
        print(f"Saved {AUDIT_DIR / qname}")


if __name__ == "__main__":
    main()
