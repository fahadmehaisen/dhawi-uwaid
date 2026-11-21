from pathlib import Path
import json
import pymupdf
from PIL import Image, ImageDraw, ImageFont

PDF2_PATH = Path(r"C:\Users\fahad\Desktop\120x191.pdf")
TREE_PATH = Path(r"c:\Projects\dhawi-uwaid\data\tree.json")
OUT_DIR = Path(r"c:\Projects\dhawi-uwaid\audit\zooms")
OUT_DIR.mkdir(parents=True, exist_ok=True)

JUNCTIONS = [
    ("j_maadi_top_spine.png", (1340, 860, 1960, 1520), 2.1),
    ("j_maadi_y02_upper.png", (1620, 920, 2600, 1650), 1.75),
    ("j_maadi_y06_y07.png", (1600, 1180, 3060, 2020), 1.45),
    ("j_maadi_y04_upper.png", (700, 940, 1620, 1780), 1.65),
    ("j_maadi_y05_y08.png", (240, 1420, 1620, 2240), 1.55),
    ("j_jarrar_hub.png", (550, 2280, 1680, 3360), 1.6),
    ("j_thuwaini_lower.png", (1680, 2120, 3160, 3460), 1.4),
    ("j_samran_hub.png", (760, 3320, 1680, 4240), 1.8),
    ("j_qulaishan_hub.png", (1840, 3450, 3180, 4260), 1.75),
]


def get_font(size: int):
    for fp in [r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\calibrib.ttf"]:
        if Path(fp).exists():
            return ImageFont.truetype(fp, size)
    return ImageFont.load_default()


def main() -> None:
    tree = json.loads(TREE_PATH.read_text(encoding="utf-8"))
    nodes = tree["nodesById"]
    doc = pymupdf.open(PDF2_PATH)
    page = doc[0]
    font = get_font(13)

    for fname, (x0, y0, x1, y1), zoom in JUNCTIONS:
        clip = pymupdf.Rect(x0, y0, x1, y1)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip, alpha=False)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples).convert("RGBA")
        draw = ImageDraw.Draw(img)

        # Draw small corner ID pill at the top-center of each node without covering black stems
        for nid, n in nodes.items():
            if clip.contains(pymupdf.Point(n["cx"], n["cy"])):
                px = (n["cx"] - clip.x0) * zoom
                py = (n["cy"] - clip.y0) * zoom - 22
                draw.rounded_rectangle([px - 19, py - 8, px + 19, py + 7], radius=3, fill=(15, 25, 20, 210))
                draw.text((px - 16, py - 7), nid, fill=(255, 240, 160, 255), font=font)

        img.convert("RGB").save(OUT_DIR / fname)
        print(f"Saved {OUT_DIR / fname}")


if __name__ == "__main__":
    main()
