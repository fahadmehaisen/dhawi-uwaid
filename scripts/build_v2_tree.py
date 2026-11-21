from pathlib import Path
import csv
import json
import math
import unicodedata
import pymupdf
from PIL import Image, ImageDraw, ImageFont

PROJECT_DIR = Path(r"c:\Projects\dhawi-uwaid")
PDF2_PATH = Path(r"C:\Users\fahad\Desktop\120x191.pdf")
NODES_V2_PATH = PROJECT_DIR / "data" / "nodes_v2_raw.json"
V1_EDGES_PATH = PROJECT_DIR / "data" / "edges.json"
DIFF_PATH = PROJECT_DIR / "audit" / "diff_v1_v2.json"

OUT_JSON = PROJECT_DIR / "data" / "tree.json"
OUT_JS = PROJECT_DIR / "data" / "tree-data.js"
OUT_CSV = PROJECT_DIR / "data" / "members.csv"
OUT_REPORT = PROJECT_DIR / "audit" / "verification-report.md"
AUDIT_DIR = PROJECT_DIR / "audit"

BRANCH_COLORS = {
    "B01": (214, 40, 40),
    "B02": (130, 80, 40),
    "B03": (100, 100, 100),
    "B04": (247, 127, 0),
    "B05": (114, 9, 183),
    "B06": (0, 119, 182),
    "B07": (42, 157, 143),
    "B08": (27, 110, 45),
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
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    if length < 2:
        return
    ux, uy = dx / length, dy / length
    ex, ey = x2 - ux * min(12.0, length * 0.25), y2 - uy * min(12.0, length * 0.25)
    draw.line([(x1, y1), (ex, ey)], fill=color, width=width)
    head_len = min(12.0, length * 0.35)
    px, py = -uy, ux
    p_left = (ex - ux * head_len + px * (head_len * 0.48), ey - uy * head_len + py * (head_len * 0.48))
    p_right = (ex - ux * head_len - px * (head_len * 0.48), ey - uy * head_len - py * (head_len * 0.48))
    draw.polygon([(ex, ey), p_left, p_right], fill=color)


def main() -> None:
    nodes_v2 = json.loads(NODES_V2_PATH.read_text(encoding="utf-8"))
    v1_edges = json.loads(V1_EDGES_PATH.read_text(encoding="utf-8"))
    diff = json.loads(DIFF_PATH.read_text(encoding="utf-8"))

    v2_to_v1 = diff["matched_v2_to_v1"]  # v2_id -> v1_id
    v1_to_v2 = {}
    for v2_id, v1_id in v2_to_v1.items():
        v1_to_v2[v1_id] = v2_id

    by_id = {n["id"]: n for n in nodes_v2}

    # Build initial parent map for v2
    edges = {}
    # 1. Ancestors A01..A10 (10 ancestors in 120x191.pdf: قحطان -> ... -> مصلح)
    edges["A01"] = None
    for i in range(2, 11):
        edges[f"A{i:02d}"] = f"A{i-1:02d}"
    edges["R00"] = "A10"
    for i in range(1, 9):
        edges[f"B{i:02d}"] = "R00"

    # 2. Transfer verified v1 parents from immutable data/edges.json
    for n in nodes_v2:
        nid = n["id"]
        if nid in edges:
            continue
        v1_id = v2_to_v1.get(nid)
        if not v1_id:
            continue
        cur_v1_parent = v1_edges.get(v1_id)
        while cur_v1_parent and cur_v1_parent not in v1_to_v2:
            cur_v1_parent = v1_edges.get(cur_v1_parent)
        if cur_v1_parent and cur_v1_parent in v1_to_v2:
            edges[nid] = v1_to_v2[cur_v1_parent]

    # 3. Apply explicit verified edges for all 9 new/updated nodes in 120x191.pdf
    #    + all 6 authoritative committee lineage chains!
    # Find exact Y19 (سفر), Y20 (عبدالله), Y23 (محمد), Y16 (زايد), Y17 (سرحان), Y15 (دغيسان), Y11 (مسعد), Y02 (معيض)
    # Using exact IDs verified from nodes_v2_raw.json & v2_thuwaini_zoom.png & v2_jarrar_samran_zoom.png:
    # Let's resolve key hubs dynamically by (tier, cleanName, near) so it's 100% immune to numbering shifts
    def find_id(tier, name, cx=None, cy=None):
        cands = [n for n in nodes_v2 if n["tier"] == tier and n["cleanName"] == name]
        if cx is not None:
            cands.sort(key=lambda n: math.hypot(n["cx"] - cx, n["cy"] - cy))
        assert cands, f"Could not find {tier} {name}"
        return cands[0]["id"]

    y_sifr = find_id("tier2_yellow", "سفر")            # Y19
    y_fahid = "Y18"                                     # فهيد
    y_sarhan = find_id("tier2_yellow", "سرحان", 2092, 2823) # Y17 (on B06 ثويني, NOT Y09 on B07 جرار)
    y_zayid = find_id("tier2_yellow", "زايد")          # Y16
    y_dughaisan = find_id("tier2_yellow", "دغيسان")    # Y15
    y_musaad = find_id("tier2_yellow", "مسعد")         # Y11
    y_abdullah_b4 = find_id("tier2_yellow", "عبدالله") # Y20 (on B04 دغيليب)
    y_mohammed_b1 = find_id("tier2_yellow", "محمد", 2200, 3830) # Y23 (on B01 قليشان)
    y_muaidh = find_id("tier2_yellow", "معيض")         # Y02 (on B08 ماضي)

    m_ghuwaizi_top = find_id("tier3_mint", "غويزي", 2400, 2860) # M150
    m_hans = find_id("tier3_mint", "حنس")                       # M164
    m_mutaib = find_id("tier3_mint", "متعب", 2275, 2973)        # M152
    m_badr_thuw = find_id("tier3_mint", "بدر", 2150, 3050)      # M161
    m_bandar_thuw = find_id("tier3_mint", "بندر", 2240, 3200)   # M165
    m_thuwaini_m122 = find_id("tier3_mint", "ثويني", 2140, 2610)# M122
    m_mohammed_jar = find_id("tier3_mint", "محمد", 1310, 3030)  # M154
    m_hamad_m35 = find_id("tier3_mint", "حمد", 1840, 1490)      # M035
    m_abdulmuhsin = find_id("tier3_mint", "عبدالمحسن")          # M024
    m_bijd_b1 = find_id("tier3_mint", "بجاد", 2249, 3930)       # M216
    m_qulaishan_b1 = find_id("tier3_mint", "قليشان")            # M229
    m_ayidh_b4 = find_id("tier3_mint", "عايض", 2891, 3513)      # M185
    m_majid_b5 = find_id("tier3_mint", "ماجد", 1153, 3654)      # M192
    m_hammad_b5 = find_id("tier3_mint", "حماد", 777, 4023)      # M224

    v2_overrides = {
        # 1. Y18 فهيد (new in 120x191) under سفر (B05 سمران), father of دغيليب L367 & حمدان L365
        y_fahid: y_sifr,
        "L367": y_fahid,
        "L365": y_fahid,

        # 2. Y17 سرحان (B06 ثويني) -> محماس M146, محسن M151, سلطان M156, حمس M155
        "M146": y_sarhan,
        "M151": y_sarhan,
        "M156": y_sarhan,

        # 3. M161 بدر & L309 محمد & L315 متعب under Y16 زايد
        m_badr_thuw: y_zayid,
        "L309": m_badr_thuw,
        "L315": m_badr_thuw,

        # 4. M157 تركي under M150 غويزي
        "M157": m_ghuwaizi_top,

        # 5. M175 مسعد (new) under M164 حنس -> مجدي L346, عارف L352, سعد L363, محمد M179, عبدالعزيز L356
        "M175": m_hans,
        "L346": "M175",
        "L352": "M175",
        "L363": "M175",
        "M179": "M175",
        "L356": "M175",

        # 6. L262 فيصل under M122 ثويني -> Y11 مسعد -> B06 ثويني (Committee Chain #5!)
        "L262": m_thuwaini_m122,

        # 7. L311 صالح & L314 فارس under M164 حنس (along M167 منصور arc)
        "L311": m_hans,
        "L314": m_hans,

        # 8. L302 بدر under M154 محمد (restored from cutoff بد in PDF1)
        "L302": m_mohammed_jar,

        # 9. Committee Chain #1: قليشان بن بجاد بن محمد بن قليشان
        y_mohammed_b1: "B01",
        m_bijd_b1: y_mohammed_b1,
        m_qulaishan_b1: m_bijd_b1,

        # 10. Committee Chain #2: حماد بن ماجد بن سفر بن سمران
        y_sifr: "B05",
        m_majid_b5: y_sifr,
        m_hammad_b5: m_majid_b5,

        # 11. Committee Chain #3: عايض بن عبدالله بن دغيليب
        y_abdullah_b4: "B04",
        m_ayidh_b4: y_abdullah_b4,

        # 12. Committee Chain #4: بندر بن متعب بن زايد بن ثويني (and متاعب M147 under زايد with no sons)
        m_mutaib: y_zayid,
        "M147": y_zayid,
        m_bandar_thuw: m_mutaib,

        # 13. Committee Chain #6: عبدالمحسن بن حمد بن معيض بن ماضي
        y_muaidh: "B08",
        m_hamad_m35: y_muaidh,
        m_abdulmuhsin: m_hamad_m35,
        # Also attach M019 مطلق, M031 سلطان, L079 عبدالله under M035 حمد / M031 سلطان
        find_id("tier3_mint", "مطلق", 2050, 1250): m_hamad_m35,
        find_id("tier3_mint", "سلطان", 1910, 1450): m_hamad_m35,
        "L079": find_id("tier3_mint", "سلطان", 1963, 1428),

        # 14. Visual topology fixes for B08 ماضي (top spine: متعب M025 -> عايض M018 -> أبناؤه السبعة)
        "M025": "B08",
        "M018": "M025",
        "M001": "M018",
        "M002": "M018",
        "M003": "M018",
        "M008": "M018",
        "M014": "M018",
        "L042": "M018",
        "L043": "M018",

        # 15. Visual topology fixes for remaining B08 ماضي branches
        "L077": "Y04",
        "M038": m_hamad_m35,
        "L094": "M043",
        "L099": "M043",
        "L101": "M043",
        "M007": "M015",
        "M004": "M009",
        "M057": "M054",
        "L124": "M070",
        "L140": "M062",

        # 16. Visual topology fixes for B07 جرار, B06 ثويني, and B05 سمران
        "M155": y_sarhan,
        "L300": "M154",
        "L312": "M153",
        "M160": "M145",
        "M168": "M145",
        "L356": "M179",
        "M202": "M188",
        "M199": "M200",
        "L416": "M200",
        "M206": "M204",
        "M225": "M204",
        "L436": "M204",
    }
    for cid, pid in v2_overrides.items():
        edges[cid] = pid

    # Check if any node is still missing a parent (other than A01)
    missing = [n["id"] for n in nodes_v2 if n["id"] not in edges]
    assert not missing, f"Missing edges in v2: {missing}"

    # Build final nodes dict
    BIO_NOTES = {
        "M147": "رحمه الله — لم يُعقب، شقيق متعب بن زايد بن ثويني.",
    }
    nodes = {}
    for n in nodes_v2:
        nid = n["id"]
        nodes[nid] = {
            "id": nid,
            "name": n["cleanName"],
            "rawName": n["normalizedText"],
            "tier": n["tier"],
            "tierLabel": TIER_LABELS_AR[n["tier"]],
            "parentId": edges[nid],
            "cx": n["cx"],
            "cy": n["cy"],
            "bbox": n["bbox"],
            "bioNote": BIO_NOTES.get(nid, ""),
        }

    # Strict graph invariants
    roots = [nid for nid, n in nodes.items() if n["parentId"] is None]
    assert roots == ["A01"], f"Expected single root A01, got {roots}"
    for nid, n in nodes.items():
        pid = n["parentId"]
        if pid is not None:
            assert pid in nodes, f"Dangling parent {pid} for {nid}"

    children_map = {nid: [] for nid in nodes}
    for nid, n in nodes.items():
        if n["parentId"] is not None:
            children_map[n["parentId"]].append(nid)

    visited = set()

    def walk(nid: str, path: list[str]):
        assert nid not in visited, f"Cycle at {nid}"
        visited.add(nid)
        cur = path + [nid]
        nodes[nid]["_path"] = cur
        for cid in children_map[nid]:
            walk(cid, cur)

    walk("A01", [])
    assert len(visited) == 760, f"Orphans: {set(nodes) - visited}"

    r00_depth = len(nodes["R00"]["_path"]) - 1  # 10 ancestors above R00
    assert r00_depth == 10
    branch_names = {f"B{i:02d}": nodes[f"B{i:02d}"]["name"] for i in range(1, 9)}

    def count_desc(nid: str) -> int:
        tot = 0
        for cid in children_map[nid]:
            tot += 1 + count_desc(cid)
        nodes[nid]["descendantCount"] = tot
        return tot

    count_desc("A01")

    for nid, n in nodes.items():
        p = n["_path"]
        n["generation"] = (len(p) - 1) - r00_depth
        n["childrenIds"] = children_map[nid]
        n["childrenCount"] = len(children_map[nid])
        b_id = next((x for x in p if x.startswith("B")), None)
        n["branchId"] = b_id if b_id else ("ROOT" if nid == "R00" else "ANC")
        n["branchName"] = branch_names[b_id] if b_id else ("عويض" if nid == "R00" else "عمود النسب")
        n["fullLineage"] = " بن ".join(nodes[x]["name"] for x in reversed(p))
        del n["_path"]

    # Verify all 6 authoritative committee lineage chains!
    assert "قليشان بن بجاد بن محمد بن قليشان" in nodes[m_qulaishan_b1]["fullLineage"], nodes[m_qulaishan_b1]["fullLineage"]
    assert "حماد بن ماجد بن سفر بن سمران" in nodes[m_hammad_b5]["fullLineage"], nodes[m_hammad_b5]["fullLineage"]
    assert "عايض بن عبدالله بن دغيليب" in nodes[m_ayidh_b4]["fullLineage"], nodes[m_ayidh_b4]["fullLineage"]
    assert "بندر بن متعب بن زايد بن ثويني" in nodes[m_bandar_thuw]["fullLineage"], nodes[m_bandar_thuw]["fullLineage"]
    assert "فيصل بن ثويني بن مسعد بن ثويني" in nodes["L262"]["fullLineage"], nodes["L262"]["fullLineage"]
    assert "عبدالمحسن بن حمد بن معيض بن ماضي" in nodes[m_abdulmuhsin]["fullLineage"], nodes[m_abdulmuhsin]["fullLineage"]
    assert nodes["M147"]["name"] == "متاعب" and nodes["M147"]["childrenCount"] == 0

    # Verify B08 ماضي & B06 ثويني visual topology fixes
    b08_child_names = [nodes[cid]["name"] for cid in nodes["B08"]["childrenIds"]]
    assert b08_child_names.count("عايض") == 1, f"Duplicate عايض directly under ماضي: {b08_child_names}"
    assert "M025" in nodes["B08"]["childrenIds"] and "M018" not in nodes["B08"]["childrenIds"]
    assert nodes["M018"]["parentId"] == "M025"
    assert {"M001", "M002", "M003", "M008", "M014", "L042", "L043"}.issubset(set(nodes["M018"]["childrenIds"]))
    assert nodes["M034"]["parentId"] == "Y04"
    for tid in ("M146", "M151", "M156"):
        assert nodes[tid]["branchId"] == "B06" and nodes[tid]["parentId"] == "Y17", f"{tid} not on B06/Y17"

    desc_of_r00 = [n for n in nodes.values() if n["generation"] >= 1]
    assert len(desc_of_r00) == 749, f"Expected 749 descendants of عويض, got {len(desc_of_r00)}"

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
            "bioNote": n["bioNote"] or None,
            "children": [build_nested(cid) for cid in children_map[nid]],
        }

    branch_stats = []
    for i in range(1, 9):
        bid = f"B{i:02d}"
        bn = nodes[bid]
        sub = [n for n in nodes.values() if n["branchId"] == bid]
        branch_stats.append({
            "branchId": bid,
            "name": bn["name"],
            "directSonsCount": bn["childrenCount"],
            "totalDescendants": bn["descendantCount"],
            "totalInBranch": len(sub),
            "maxGeneration": max(n["generation"] for n in sub),
        })

    tree_payload = {
        "meta": {
            "title": "شجرة فخذ ذوي عويض — الشدادين من بني الحارث • قيا",
            "region": "قيا — جنوب الطائف",
            "sourceEditionDate": "2025-11-03",
            "editionLabel": "النسخة المعتمدة والمحدّثة (٣ نوفمبر ٢٠٢٥ م / ١٢ جمادى الأولى ١٤٤٧ هـ)",
            "totalNodes": len(nodes),
            "ancestorsCount": 10,
            "descendantsOfUwaid": len(desc_of_r00),
            "branchesCount": 8,
            "lineageFootnotes": [
                "ذُكر في الحاشية الشفهية عند بعض كبار السن وجود اسم (مسفر) إضافي بين عويض ومصلح، والمعتمد في النسخة المحررة: عويض بن مصلح بن مسفر بن بصيص بن دمشق بن ملفي بن مفلح بن عياش بن شداد بن حارث بن قحطان.",
            ],
        },
        "branchStats": branch_stats,
        "nodesById": nodes,
        "root": build_nested("A01"),
    }

    json_str = json.dumps(tree_payload, ensure_ascii=False, indent=2)
    OUT_JSON.write_text(json_str, encoding="utf-8")
    OUT_JS.write_text("window.DHAWI_UWAID_TREE = " + json_str + ";\n", encoding="utf-8")
    print(f"Saved {OUT_JSON} and {OUT_JS} ({len(nodes)} nodes verified, 6/6 committee chains passed!)")

    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ID", "Name", "Father", "Branch", "Generation", "NodeType", "ChildrenCount", "DescendantCount", "FullLineage", "BioNote"])
        for n in nodes_v2:
            m = nodes[n["id"]]
            father_name = nodes[m["parentId"]]["name"] if m["parentId"] else ""
            w.writerow([m["id"], m["name"], father_name, m["branchName"], m["generation"], m["tierLabel"], m["childrenCount"], m["descendantCount"], m["fullLineage"], m["bioNote"]])
    print(f"Saved {OUT_CSV}")

    # Write verification-report.md
    lines = [
        "# تقرير التدقيق الهندسي والنسبي لشجرة فخذ ذوي عويض (نسخة ٣ نوفمبر ٢٠٢٥)",
        "",
        "## 1. ملخص التحقق الرقمي للنسخة الأحدث",
        f"- **إجمالي الأسماء المستخرجة والمتحقق منها:** **{len(nodes)} اسماً** (0 مفقود، 0 دوران، 0 فروع معزولة).",
        "- **عمود النسب فوق الجد الجامع:** **10 أسماء** (`عويض ← مصلح ← مسفر ← بصيص ← دمشق ← ملفي ← مفلح ← عياش ← شداد ← حارث ← قحطان`).",
        "- **ذرية عويض:** **749 اسماً** موزعين على **8 فروع رئيسية**.",
        "",
        "## 2. الفروقات بين نسخة أغسطس ٢٠٢٥ والنسخة الأحدث (نوفمبر ٢٠٢٥)",
        "- **عمود النسب:** حُذف اسم `مسفر` المكرر تحت عويض مباشرة، مع تثبيت ملاحظة الرواية الشفهية في تذييل الشجرة.",
        "- **إضافات وتحديثات الأسماء:** إضافة `فهيد` في فرع سمران مع تصحيح `دغيلب ← دغيليب` و`سطان ← سلطان` و`اثنيان ← ثنيان`، وإضافة `محماس` و`محسن` و`سلطان` و`تركي` و`مسعد` و`سعد` و`فيصل` و`صالح` في فرع ثويني، وتعديل `بد ← بدر` وتنقية تكرار تحت فرع جرار، وتعديل `نايف ← كايف` و`معتز ← معاذ` و`صالح ← فارس` و`فلاح ← محمد` و`حماد ← حمد`.",
        "- **الإبقاء على «متاعب» حرفياً:** ثُبّت اسم `متاعب` كما هو في فرع زايد بن ثويني (شقيق متعب بن زايد، رحمه الله ولم يُعقب).",
        "",
        "## 3. التحقق من سلاسل النسب الست الموثقة في متن النسخة الجديدة",
        "1. **قليشان ← بجاد ← محمد ← قليشان** (متحقق برمجياً 100%)",
        "2. **حماد ← ماجد ← سفر ← سمران** (متحقق برمجياً 100%)",
        "3. **عايض ← عبدالله ← دغيليب** (متحقق برمجياً 100%)",
        "4. **بندر ← متعب ← زايد ← ثويني** (متحقق برمجياً 100%)",
        "5. **فيصل ← ثويني ← مسعد ← ثويني** (متحقق برمجياً 100%)",
        "6. **عبدالمحسن ← حمد ← معيض ← ماضي** (متحقق برمجياً 100%)",
        "",
        "## 4. إحصائيات الفروع الثمانية (أبناء عويض)",
        "| الرقم | الفرع | الأبناء على الغصن | إجمالي الذرية | الإجمالي بالفرع | أقصى جيل |",
        "| :--- | :--- | ---: | ---: | ---: | ---: |",
    ]
    for st in branch_stats:
        lines.append(f"| `{st['branchId']}` | {st['name']} | {st['directSonsCount']} | {st['totalDescendants']} | {st['totalInBranch']} | {st['maxGeneration']} |")
    OUT_REPORT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Saved {OUT_REPORT}")

    # Render concise verification overlay crop around Thuwaini & Jarrar/Samran updates on 120x191.pdf
    doc = pymupdf.open(PDF2_PATH)
    page = doc[0]
    clip = pymupdf.Rect(1000, 2500, 2900, 3850)
    zoom = 1.15
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip, alpha=False)
    base = Image.frombytes("RGB", [pix.width, pix.height], pix.samples).convert("RGBA")
    dim = Image.alpha_composite(base, Image.new("RGBA", base.size, (255, 252, 245, 140)))
    ov = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d_ov = ImageDraw.Draw(ov)
    for nid, n in nodes.items():
        pid = n["parentId"]
        if not pid:
            continue
        p = nodes[pid]
        if clip.contains(pymupdf.Point(n["cx"], n["cy"])) or clip.contains(pymupdf.Point(p["cx"], p["cy"])):
            col = BRANCH_COLORS.get(n["branchId"], (50, 50, 50)) + (230,)
            draw_arrow(d_ov, (n["cx"] - clip.x0) * zoom, (n["cy"] - clip.y0) * zoom, (p["cx"] - clip.x0) * zoom, (p["cy"] - clip.y0) * zoom, col, width=3)
    for nid, n in nodes.items():
        if clip.contains(pymupdf.Point(n["cx"], n["cy"])):
            px, py = (n["cx"] - clip.x0) * zoom, (n["cy"] - clip.y0) * zoom
            d_ov.rounded_rectangle([px - 17, py - 18, px + 17, py - 5], radius=3, fill=(20, 20, 20, 205))
            d_ov.text((px - 14, py - 17), nid, fill=(255, 255, 255, 255))
    Image.alpha_composite(dim, ov).convert("RGB").save(AUDIT_DIR / "v2_updates_overlay.png")
    print(f"Saved {AUDIT_DIR / 'v2_updates_overlay.png'}")


if __name__ == "__main__":
    main()
