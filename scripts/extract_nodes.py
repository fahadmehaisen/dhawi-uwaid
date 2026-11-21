from pathlib import Path
import json
import unicodedata
import pymupdf
from PIL import Image, ImageDraw, ImageFont

PDF_PATH = Path(r"C:\Users\fahad\Desktop\فخذ ذوي عويض.pdf")
PROJECT_DIR = Path(r"c:\Projects\dhawi-uwaid")
DATA_DIR = PROJECT_DIR / "data"
AUDIT_DIR = PROJECT_DIR / "audit"
DATA_DIR.mkdir(parents=True, exist_ok=True)
AUDIT_DIR.mkdir(parents=True, exist_ok=True)


def normalize_raw_arabic(raw: str) -> str:
    """Clean standard NFKC and Allah ligature while preserving literal printed spellings."""
    # Note: \ufdf2 in HacenNewspaper is often preceded by ا making 'االله' instead of 'الله'
    s = unicodedata.normalize("NFKC", raw)
    # Collapse double alef before Allah if produced by NFKC of \ufdf2
    s = s.replace("االله", "الله")
    return " ".join(s.split())


def is_special_audit_node(raw: str, norm: str) -> bool:
    """Return True if this node has unusual ligatures, short length, or potential PDF typos."""
    has_pfa = any(0xFB50 <= ord(c) <= 0xFDFF and ord(c) != 0xFDF2 for c in raw)
    suspicious_words = {
        "أمري", "الرباء", "بد", "سطان", "متاعب", "سراحان", "دغيلب",
        "اثنيان", "هباس", "عبد المجيد", "حمس", "حنس", "متلع", "وهف",
        "كايف", "ضفيدع", "قنيفذ", "فليفل", "غويزي", "خشمان", "بنيه",
        "دغيسان", "جربوع", "بجاد", "مقبل", "مقبول", "عساف", "عقاب",
    }
    if has_pfa or len(norm) <= 2 or norm in suspicious_words:
        return True
    if "ـ" in raw or "\u0651" in raw or "\u064e" in raw:
        return True
    return False


def main() -> None:
    doc = pymupdf.open(PDF_PATH)
    page = doc[0]

    # Collect vector shapes for tier classification
    yellow_rects = []
    mint_rects = []
    for d in page.get_drawings():
        fill = tuple(round(x, 2) for x in d["fill"]) if d.get("fill") else None
        r = d["rect"]
        if not fill or r.width >= 400 or r.height >= 400:
            continue
        if fill in ((0.85, 0.83, 0.44), (0.81, 0.83, 0.49)):
            yellow_rects.append(r)
        elif fill == (0.41, 0.74, 0.54):
            mint_rects.append(r)

    raw_nodes = []
    text_dict = page.get_text("dict")
    for block in text_dict["blocks"]:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            raw = "".join(span["text"] for span in line["spans"]).strip()
            r = pymupdf.Rect(line["bbox"])
            if not (390 <= r.y0 <= 2760):
                continue
            # Exclude top-left Hadith and top-right Quran boxes
            if r.y0 < 520 and (r.x1 < 420 or r.x0 > 1580):
                continue
            # Exclude bottom left/right metadata boxes
            if r.y0 > 2300 and (r.x1 < 750 or r.x0 > 1250):
                continue

            cx = round((r.x0 + r.x1) / 2.0, 2)
            cy = round((r.y0 + r.y1) / 2.0, 2)
            sz = round(line["spans"][0]["size"], 1)
            norm = normalize_raw_arabic(raw)
            pt = pymupdf.Point(cx, cy)

            if sz >= 24:
                if cy > 2180:
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
                "bbox": [round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2)],
                "fontSize": sz,
                "font": line["spans"][0]["font"],
                "tier": tier,
            })

    assert len(raw_nodes) == 759, f"Expected 759 nodes, got {len(raw_nodes)}"

    # Deterministic ID assignment by tier
    ancestors = sorted([n for n in raw_nodes if n["tier"] == "ancestor"], key=lambda n: -n["cy"])
    roots = [n for n in raw_nodes if n["tier"] == "root"]
    tier1 = sorted([n for n in raw_nodes if n["tier"] == "tier1_son"], key=lambda n: (-n["cy"], -n["cx"]))
    tier2 = sorted([n for n in raw_nodes if n["tier"] == "tier2_yellow"], key=lambda n: (n["cy"], n["cx"]))
    tier3 = sorted([n for n in raw_nodes if n["tier"] == "tier3_mint"], key=lambda n: (n["cy"], n["cx"]))
    tier4 = sorted([n for n in raw_nodes if n["tier"] == "tier4_leaf"], key=lambda n: (n["cy"], n["cx"]))

    assert len(ancestors) == 11, len(ancestors)
    assert len(roots) == 1, len(roots)
    assert len(tier1) == 8, len(tier1)
    assert len(tier2) == 24, len(tier2)
    assert len(tier3) == 236, len(tier3)
    assert len(tier4) == 479, len(tier4)

    ordered = []
    for i, n in enumerate(ancestors, 1):
        n["id"] = f"A{i:02d}"
        ordered.append(n)
    roots[0]["id"] = "R00"
    ordered.append(roots[0])
    for i, n in enumerate(tier1, 1):
        n["id"] = f"B{i:02d}"
        ordered.append(n)
    for i, n in enumerate(tier2, 1):
        n["id"] = f"Y{i:02d}"
        ordered.append(n)
    for i, n in enumerate(tier3, 1):
        n["id"] = f"M{i:03d}"
        ordered.append(n)
    for i, n in enumerate(tier4, 1):
        n["id"] = f"L{i:03d}"
        ordered.append(n)

    out_path = DATA_DIR / "nodes_raw.json"
    out_path.write_text(json.dumps(ordered, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {len(ordered)} nodes to {out_path}")

    # Render glyph_check.png at 4x zoom for all special/ligature/potential-typo nodes
    audit_nodes = [n for n in ordered if is_special_audit_node(n["rawText"], n["normalizedText"])]
    print(f"Special audit nodes for glyph_check.png: {len(audit_nodes)}")

    cols = 4
    cell_w, cell_h = 380, 320
    rows = (len(audit_nodes) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)

    mat = pymupdf.Matrix(4.0, 4.0)
    for idx, n in enumerate(audit_nodes):
        r_idx, c_idx = divmod(idx, cols)
        x_off, y_off = c_idx * cell_w, r_idx * cell_h
        x0, y0, x1, y1 = n["bbox"]
        clip = pymupdf.Rect(x0 - 22, y0 - 22, x1 + 22, y1 + 22)
        pix = page.get_pixmap(matrix=mat, clip=clip, alpha=False)
        crop_img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        crop_img.thumbnail((cell_w - 20, cell_h - 60), Image.Resampling.LANCZOS)
        sheet.paste(crop_img, (x_off + (cell_w - crop_img.width) // 2, y_off + 45))
        draw.rectangle([x_off, y_off, x_off + cell_w - 1, y_off + cell_h - 1], outline=(200, 200, 200))
        label = f"{n['id']} | norm: {n['normalizedText']} | ({int(n['cx'])},{int(n['cy'])})"
        draw.text((x_off + 8, y_off + 8), label, fill=(20, 20, 20))

    glyph_path = AUDIT_DIR / "glyph_check.png"
    sheet.save(glyph_path)
    print(f"Saved {glyph_path}")


if __name__ == "__main__":
    main()
