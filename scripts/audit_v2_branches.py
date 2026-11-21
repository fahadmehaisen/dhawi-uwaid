from pathlib import Path
import json
import math
import pymupdf
from PIL import Image, ImageDraw, ImageFont

PROJECT_DIR = Path(r"c:\Projects\dhawi-uwaid")
PDF2_PATH = Path(r"C:\Users\fahad\Desktop\120x191.pdf")
TREE_PATH = PROJECT_DIR / "data" / "tree.json"
AUDIT_DIR = PROJECT_DIR / "audit"

BRANCH_COLORS = {
    "B01": (214, 40, 40),
    "B02": (130, 80, 40),
    "B03": (100, 100, 100),
    "B04": (235, 110, 0),
    "B05": (114, 9, 183),
    "B06": (0, 119, 182),
    "B07": (14, 145, 130),
    "B08": (20, 130, 50),
    "ROOT": (160, 120, 20),
    "ANC": (90, 55, 25),
}

CROPS = [
    ("v2_audit_maadi_center.png", (1200, 800, 2050, 1950), 1.45),
    ("v2_audit_maadi_right.png", (1600, 880, 3150, 1980), 1.15),
    ("v2_audit_maadi_left.png", (200, 900, 1600, 2220), 1.15),
    ("v2_audit_jarrar.png", (200, 1950, 1780, 3600), 1.1),
    ("v2_audit_thuwaini.png", (1650, 1900, 3250, 3550), 1.1),
    ("v2_audit_samran.png", (200, 3150, 1780, 4320), 1.15),
    ("v2_audit_qulaishan_dughailib.png", (1650, 3320, 3250, 4320), 1.15),
]


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
    head_len = min(13.0, length * 0.35)
    px, py = -uy, ux
    p_left = (ex - ux * head_len + px * (head_len * 0.45), ey - uy * head_len + py * (head_len * 0.45))
    p_right = (ex - ux * head_len - px * (head_len * 0.45), ey - uy * head_len - py * (head_len * 0.45))
    draw.polygon([(ex, ey), p_left, p_right], fill=color)


def main() -> None:
    tree = json.loads(TREE_PATH.read_text(encoding="utf-8"))
    nodes = tree["nodesById"]
    doc = pymupdf.open(PDF2_PATH)
    page = doc[0]
    font = get_font(12)

    for fname, (x0, y0, x1, y1), zoom in CROPS:
        clip = pymupdf.Rect(x0, y0, x1, y1)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip, alpha=False)
        base = Image.frombytes("RGB", [pix.width, pix.height], pix.samples).convert("RGBA")
        # Light wash keeps the crisp black wood from 120x191.pdf clearly visible
        dim = Image.alpha_composite(base, Image.new("RGBA", base.size, (255, 252, 245, 95)))
        ov = Image.new("RGBA", base.size, (0, 0, 0, 0))
        d_ov = ImageDraw.Draw(ov)

        for nid, n in nodes.items():
            pid = n["parentId"]
            if not pid:
                continue
            p = nodes[pid]
            if clip.contains(pymupdf.Point(n["cx"], n["cy"])) or clip.contains(pymupdf.Point(p["cx"], p["cy"])):
                col = BRANCH_COLORS.get(n["branchId"], (60, 60, 60)) + (215,)
                draw_arrow(
                    d_ov,
                    (n["cx"] - clip.x0) * zoom,
                    (n["cy"] - clip.y0) * zoom,
                    (p["cx"] - clip.x0) * zoom,
                    (p["cy"] - clip.y0) * zoom,
                    col,
                    width=3,
                )

        for nid, n in nodes.items():
            if clip.contains(pymupdf.Point(n["cx"], n["cy"])):
                px = (n["cx"] - clip.x0) * zoom
                py = (n["cy"] - clip.y0) * zoom
                fill_tag = (165, 28, 28, 225) if (n["tier"] in ("tier2_yellow", "tier3_mint") and n["childrenCount"] == 0) else (18, 24, 28, 215)
                d_ov.rounded_rectangle([px - 20, py - 24, px + 20, py - 9], radius=3, fill=fill_tag)
                d_ov.text((px - 17, py - 23), nid, fill=(255, 255, 255, 255), font=font)

        out_path = AUDIT_DIR / fname
        Image.alpha_composite(dim, ov).convert("RGB").save(out_path)
        print(f"Saved {out_path}")


if __name__ == "__main__":
    main()
