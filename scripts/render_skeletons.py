from pathlib import Path
import json
import pymupdf
from PIL import Image, ImageDraw, ImageFont

PDF_PATH = Path(r"C:\Users\fahad\Desktop\فخذ ذوي عويض.pdf")
NODES_PATH = Path(r"c:\Projects\dhawi-uwaid\data\nodes_raw.json")
OUT_DIR = Path(r"c:\Projects\dhawi-uwaid\audit\skeletons")
OUT_DIR.mkdir(parents=True, exist_ok=True)


def get_font(size: int):
    for fp in [r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\calibrib.ttf"]:
        if Path(fp).exists():
            return ImageFont.truetype(fp, size)
    return ImageFont.load_default()


def render_skeleton(page, drawings, nodes, clip: pymupdf.Rect, zoom: float, out_path: Path):
    W, H = int(clip.width * zoom), int(clip.height * zoom)
    img = Image.new("RGB", (W, H), (252, 249, 242))
    draw = ImageDraw.Draw(img)

    # 1. Draw yellow & mint fills first, then black branches
    for d in drawings:
        fill = tuple(round(x, 2) for x in d["fill"]) if d.get("fill") else None
        if fill not in ((0.0, 0.0, 0.0), (0.85, 0.83, 0.44), (0.81, 0.83, 0.49), (0.41, 0.74, 0.54)):
            continue
        if not d["rect"].intersects(clip):
            continue
        pts = []
        for item in d["items"]:
            op = item[0]
            if op == "l":
                pts.append(((item[1].x - clip.x0) * zoom, (item[1].y - clip.y0) * zoom))
                pts.append(((item[2].x - clip.x0) * zoom, (item[2].y - clip.y0) * zoom))
            elif op == "c":
                p0, p1, p2, p3 = item[1], item[2], item[3], item[4]
                for i in range(9):
                    t = i / 8.0
                    x = (1 - t) ** 3 * p0.x + 3 * (1 - t) ** 2 * t * p1.x + 3 * (1 - t) * t ** 2 * p2.x + t ** 3 * p3.x
                    y = (1 - t) ** 3 * p0.y + 3 * (1 - t) ** 2 * t * p1.y + 3 * (1 - t) * t ** 2 * p2.y + t ** 3 * p3.y
                    pts.append(((x - clip.x0) * zoom, (y - clip.y0) * zoom))
            elif op == "re":
                r = item[1]
                col = tuple(int(c * 255) for c in fill) if fill != (0.0, 0.0, 0.0) else (25, 25, 25)
                draw.rectangle([(r.x0 - clip.x0) * zoom, (r.y0 - clip.y0) * zoom, (r.x1 - clip.x0) * zoom, (r.y1 - clip.y0) * zoom], fill=col)
        if len(pts) >= 3:
            if fill == (0.0, 0.0, 0.0):
                col = (25, 25, 25)
            else:
                col = tuple(int(c * 255) for c in fill)
            draw.polygon(pts, fill=col)

    # 2. Draw crisp compact node pills
    font = get_font(15)
    tier_col = {
        "ancestor": (95, 50, 15),
        "root": (140, 20, 20),
        "tier1_son": (165, 70, 0),
        "tier2_yellow": (175, 115, 0),
        "tier3_mint": (0, 115, 95),
        "tier4_leaf": (35, 130, 45),
    }
    for n in nodes:
        cx, cy = n["cx"], n["cy"]
        if not (clip.x0 - 5 <= cx <= clip.x1 + 5 and clip.y0 - 5 <= cy <= clip.y1 + 5):
            continue
        px, py = (cx - clip.x0) * zoom, (cy - clip.y0) * zoom
        lbl = n["id"]
        tb = draw.textbbox((0, 0), lbl, font=font)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        col = tier_col.get(n["tier"], (40, 40, 40))
        if n["tier"] == "tier4_leaf":
            # draw faint leaf box first so leaf orientation/position is clear
            x0, y0, x1, y1 = n["bbox"]
            draw.rounded_rectangle(
                [(x0 - clip.x0) * zoom - 4, (y0 - clip.y0) * zoom - 4, (x1 - clip.x0) * zoom + 4, (y1 - clip.y0) * zoom + 4],
                radius=8,
                outline=(60, 160, 70),
                width=2,
            )
        draw.rounded_rectangle(
            [px - tw / 2 - 5, py - th / 2 - 3, px + tw / 2 + 5, py + th / 2 + 3],
            radius=5,
            fill=col,
            outline=(255, 255, 255),
            width=1,
        )
        draw.text((px - tw / 2, py - th / 2 - 1), lbl, font=font, fill=(255, 255, 255))

    img.save(out_path)
    print("Saved", out_path)


def main():
    nodes = json.loads(NODES_PATH.read_text(encoding="utf-8"))
    doc = pymupdf.open(PDF_PATH)
    page = doc[0]
    drawings = page.get_drawings()

    regions = {
        "skel_q1_tl.png": (140, 380, 1050, 1380),
        "skel_q2_tr.png": (950, 380, 1860, 1380),
        "skel_q3_bl.png": (140, 1260, 1050, 2280),
        "skel_q4_br.png": (950, 1260, 1860, 2280),
        "skel_center.png": (680, 650, 1320, 1950),
    }
    for fname, rect in regions.items():
        render_skeleton(page, drawings, nodes, pymupdf.Rect(*rect), zoom=2.4, out_path=OUT_DIR / fname)


if __name__ == "__main__":
    main()
