#!/usr/bin/env python3
"""Convert Blender hair renders into the app's runtime assets (all styles).

Input:  scripts/render/hair-<style>.png (RGBA, transparent background)
Output: apps/web/public/hair/scene-<style>.webp
        apps/web/public/hair/mask-<style>.png  (RGBA: RGB=A=hair alpha)

Run from repo root:  python scripts/convert-hair-render.py
"""
from PIL import Image, ImageFilter
import os
import glob

HERE = os.path.dirname(__file__)
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "apps", "web", "public", "hair")

os.makedirs(OUT_DIR, exist_ok=True)

for src in sorted(glob.glob(os.path.join(HERE, "render", "hair-*.png"))):
    style = os.path.basename(src)[len("hair-"):-len(".png")]
    img = Image.open(src).convert("RGBA")
    alpha = img.getchannel("A")

    # Dye mask: alpha, slightly eroded + blurred; RGB=A=mask so both
    # mask-mode: luminance and match-source read it correctly.
    mask = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(3))
    mask = mask.resize((img.width // 2, img.height // 2), Image.LANCZOS)
    mask_rgba = Image.merge("RGBA", (mask, mask, mask, mask))

    img.save(os.path.join(OUT_DIR, f"scene-{style}.webp"), quality=92, method=6)
    mask_rgba.save(os.path.join(OUT_DIR, f"mask-{style}.png"), optimize=True)
    print(f"{style}: scene {img.size}, mask {mask.size}")
