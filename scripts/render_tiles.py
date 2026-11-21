from pathlib import Path
import json
import pymupdf
from PIL import Image, ImageDraw, ImageFont

PDF_PATH = Path(r"C:\Users\fahad\Desktop\فخذ ذوي عويض.pdf")
PROJECT_DIR = Path(r"c:\Projects\dhawi-uwaid")
NODES_PATH = PROJECT_DIR / "data" / "nodes_raw.json"
TILES_DIR = PROJECT_DIR / "audit" / "tiles"
TILES_DIR.mkdir(parents=True, exist_ok=True)

X_COLS = [(140, 620), (520, 1020), (920, 1420), (1320, 1860)]
Y_ROWS = [(380, 920), (820, 1380), (1280, 1840), (1740, 2280)]

TIER_BADGE_BG = {
    "ancestor": (90, 45, 10, 225),
    "root": (120, 20, 20, 235),
    "tier1_son": (140, 50, 0, 230),
    "tier2_yellow": (160, 100, 0, 230),
    "tier3_mint": (0, 105, 95, 215),
    "tier4_leaf": (175, 20, 45, 210),
}


def get_font(size: int):
    for fp in [
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\calibrib.ttf",
        r"C:\Windows\Fonts\segoeuib.ttf",
    ]:
        if Path(fp).exists():
            return ImageFont.truetype(fp, size)
    return ImageFont.load_default()


def annotate_clip(page, nodes, clip: pymupdf.Rect, zoom: float, out_path: Path, font_size: int = 14) -> list[dict]:
    mat = pymupdf.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, clip=clip, alpha=False)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples).convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = get_font(font_size)

    included = []
    for n in nodes:
        cx, cy = n["cx"], n["cy"]
        if not (clip.x0 - 10 <= cx <= clip.x1 + 10 and clip.y0 - 10 <= cy <= clip.y1 + 10):
            continue
        included.append(n)
        x0, y0, x1, y1 = n["bbox"]
        px = (cx - clip.x0) * zoom
        py_top = (y0 - clip.y0) * zoom
        py_bot = (y1 - clip.y0) * zoom

        label = n["id"]
        tb = draw.textbbox((0, 0), label, font=font)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        pad_x, pad_y = 4, 2
        bx = max(2, min(img.width - tw - 2 * pad_x - 2, px - tw / 2 - pad_x))
        # Place pill slightly above text box if room, else slightly below
        by = py_top - th - 2 * pad_y - 2
        if by < 2:
            by = min(img.height - th - 2 * pad_y - 2, py_bot + 2)

        bg = TIER_BADGE_BG.get(n["tier"], (170, 20, 20, 210))
        draw.rounded_rectangle(
            [bx, by, bx + tw + 2 * pad_x, by + th + 2 * pad_y],
            radius=4,
            fill=bg,
        )
        draw.text((bx + pad_x, by + pad_y - 1), label, font=font, fill=(255, 255, 255, 255))

    combined = Image.alpha_composite(img, overlay).convert("RGB")
    combined.save(out_path)
    return included


def main() -> None:
    nodes = json.loads(NODES_PATH.read_text(encoding="utf-8"))
    doc = pymupdf.open(PDF_PATH)
    page = doc[0]

    # 1. Macro overview map (trunk + tier1 + tier2 yellow circles + whole canopy at 1.4x)
    macro_nodes = [n for n in nodes if n["tier"] in ("ancestor", "root", "tier1_son", "tier2_yellow")]
    macro_clip = pymupdf.Rect(140, 380, 1860, 2770)
    annotate_clip(page, macro_nodes, macro_clip, zoom=1.35, out_path=TILES_DIR / "overview_annotated.png", font_size=18)
    print("Saved overview_annotated.png")

    # 2. 16 high-res overlapping canopy tiles at 3.5x zoom
    manifest = {}
    for r_idx, (y0, y1) in enumerate(Y_ROWS, 1):
        for c_idx, (x0, x1) in enumerate(X_COLS, 1):
            name = f"tile_r{r_idx}_c{c_idx}"
            clip = pymupdf.Rect(x0, y0, x1, y1)
            out_png = TILES_DIR / f"{name}.png"
            inc = annotate_clip(page, nodes, clip, zoom=3.5, out_path=out_png, font_size=14)
            manifest[name] = {
                "clip": [x0, y0, x1, y1],
                "count": len(inc),
                "ids": [n["id"] for n in inc],
            }
            print(f"Saved {name}.png ({len(inc)} nodes)")

    (TILES_DIR / "tiles_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
