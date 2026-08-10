#!/usr/bin/env python3
"""Build the immersive hair-scene assets from a real hair photo.

Input:  model/datasets/raw/photo/blonde-woman-original.jpg
        ("Blonde-haired Woman" by Todayle, CC BY-SA 4.0 — see docs/CREDITS.md)

Output: apps/web/public/hair/scene.webp
          Transparent-background cutout: the subject's hair (tone-mapped to a
          bleached level-10 warm near-white, real strand texture preserved)
          plus the dark lace shoulders for grounding. No environment.
        apps/web/public/hair/hair-mask.png
          Soft alpha of the hair region only — used at runtime as the CSS
          mask for the multiply dye overlay.
        scripts/hair-mask-debug.jpg — cutout over a light gray backdrop,
          for visual verification only.

hair mask  = coarse polygon ∧ HSV hair rules ∧ local-texture rule − hands
body mask  = lace-top polygon ∧ dark rule
subject    = hair ∪ body, slightly eroded + feathered to avoid bright fringes

Requires: Pillow, numpy. Run from the repo root:
    python scripts/prepare-hair-image.py
"""
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import numpy as np
import os

HERE = os.path.dirname(__file__)
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "model", "datasets", "raw", "photo", "blonde-woman-original.jpg")
OUT_DIR = os.path.join(ROOT, "apps", "web", "public", "hair")
TARGET_W = 2048          # working resolution
EXPORT_W = 1440          # delivered resolution

# Coarse hair polygon on the 1280-wide preview, hugging the hair.
POLY_1280 = [
    (585, 68), (650, 58), (710, 72), (765, 100), (805, 135),
    (840, 180), (868, 235), (890, 295), (905, 355), (920, 420),
    (925, 480), (930, 545), (928, 610), (915, 665), (890, 715),
    (850, 755), (800, 780), (740, 795), (680, 802), (620, 800),
    (560, 790), (505, 770), (455, 745), (415, 710), (385, 665),
    (370, 610), (368, 550), (378, 490), (390, 425), (395, 360),
    (400, 290), (415, 220), (440, 160), (480, 112), (530, 82),
]

EXCLUDE_ELLIPSES_1280 = [
    (830, 240, 130, 170),  # raised right hand + fingers
    (320, 520, 85, 240),   # left forearm + hand
    (455, 560, 60, 120),   # backlit lace mesh showing through, left edge
    (893, 440, 42, 75),    # lace mesh / forearm, right edge
]

img = Image.open(SRC).convert("RGB")
scale = TARGET_W / img.width
img = img.resize((TARGET_W, round(img.height * scale)), Image.LANCZOS)
W, H = img.size
print(f"working size: {W}x{H}")

sx, sy = W / 1280, H / 854

def draw_poly(points):
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).polygon(
        [(round(x * sx), round(y * sy)) for x, y in points], fill=255)
    return m

hair_poly = draw_poly(POLY_1280)

excl = Image.new("L", (W, H), 0)
de = ImageDraw.Draw(excl)
for cx, cy, rx, ry in EXCLUDE_ELLIPSES_1280:
    cx, cy, rx, ry = round(cx * sx), round(cy * sy), round(rx * sx), round(ry * sy)
    de.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
excl = excl.filter(ImageFilter.GaussianBlur(10))
hair_poly = ImageChops.subtract(hair_poly, excl)

# --- vectorized color rules -------------------------------------------------
arr = np.asarray(img).astype(np.float32) / 255.0
r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
mx = arr.max(axis=2)
mn = arr.min(axis=2)
diff = mx - mn

v = mx
s = np.where(mx > 0, diff / np.maximum(mx, 1e-6), 0)
h = np.zeros_like(mx)
safe = diff > 1e-6
idx = safe & (mx == r)
h[idx] = ((g - b)[idx] / diff[idx]) % 6
idx = safe & (mx == g)
h[idx] = (b - r)[idx] / diff[idx] + 2
idx = safe & (mx == b)
h[idx] = (r - g)[idx] / diff[idx] + 4
h = h * 60.0

ys = np.arange(H, dtype=np.float32)[:, None]
green = (h >= 60) & (h <= 165)
dark_thr = np.where(ys >= 0.55 * H, 0.12, 0.22)
dark = v < dark_thr
warm = (h <= 50) | (h >= 340)
# near-neutral dark pixels (lace threads, haze) have meaningless hue; demand
# clearly warm saturation when dark. Bright pixels keep a low sat floor.
sat_thr = np.where(v < 0.35, 0.20, 0.10)
sat_ok = s >= sat_thr
highlight = (v > 0.84) & (s >= 0.10) & (s <= 0.45) & warm
color_ok = (warm & sat_ok & ~green & ~dark) | highlight

# --- texture rule: local luminance stddev -----------------------------------
lum = 0.299 * r + 0.587 * g + 0.114 * b
lum_img = Image.fromarray((lum * 255).astype(np.uint8))
m1 = np.asarray(lum_img.filter(ImageFilter.GaussianBlur(8))).astype(np.float32) / 255.0
lum2_img = Image.fromarray(((lum ** 2) * 255).astype(np.uint8))
m2 = np.asarray(lum2_img.filter(ImageFilter.GaussianBlur(8))).astype(np.float32) / 255.0
std = np.sqrt(np.maximum(m2 - m1 ** 2, 0))
thr = np.where(ys < 0.62 * H, 0.030, 0.014)
strong_warm = warm & (s > 0.20) & (v > 0.12) & (ys >= 0.55 * H)
textured = (std > thr) | strong_warm

# Hair regions are locally MIXED (bright strands interleaved with shadow);
# lace showing through thin hair is locally near-black. Reject pixels whose
# neighbourhood mean luminance is too low.
bright_env = m1 > 0.11

# --- masks -------------------------------------------------------------------
hair_np = (np.asarray(hair_poly) > 0) & color_ok & textured & bright_env
hair = Image.fromarray((hair_np * 255).astype(np.uint8))
hair = hair.filter(ImageFilter.MedianFilter(7))
hair = hair.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))

# Keep only the largest connected component (the hair mass); floating scraps
# (lace bits, finger remnants) are disconnected islands and get dropped.
def largest_component(mask_img: Image.Image) -> Image.Image:
    small = mask_img.resize((512, round(512 * H / W)), Image.BILINEAR)
    grid = np.asarray(small) > 96
    hh, ww = grid.shape
    label = np.zeros((hh, ww), dtype=np.int32)
    sizes: dict[int, int] = {}
    cur = 0
    from collections import deque
    for yy in range(hh):
        for xx in range(ww):
            if grid[yy, xx] and label[yy, xx] == 0:
                cur += 1
                q = deque([(yy, xx)])
                label[yy, xx] = cur
                area = 0
                while q:
                    cy, cx = q.popleft()
                    area += 1
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < hh and 0 <= nx < ww and grid[ny, nx] and label[ny, nx] == 0:
                            label[ny, nx] = cur
                            q.append((ny, nx))
                sizes[cur] = area
    if not sizes:
        return mask_img
    best = max(sizes, key=sizes.get)  # type: ignore[arg-type]
    keep = (label == best)
    gate = Image.fromarray((keep * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)
    return ImageChops.darker(mask_img, gate.point(lambda p: 255 if p > 96 else 0))

hair = largest_component(hair)
hair = hair.filter(ImageFilter.GaussianBlur(4))

# subject = hair only. A clean floating head of hair — no environment, no
# clothing, no arms. The wavy bottom tips form the natural lower edge.
# Slight erosion before feathering avoids bright-sky fringes on the edges.
subject = hair.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(3))

# --- bleach the hair region ---------------------------------------------------
hm = np.asarray(hair).astype(np.float32) / 255.0
t = np.clip((lum - 0.12) / 0.88, 0, 1) ** 0.8
bleached = np.stack([0.957 * t, 0.914 * t, 0.839 * t], axis=2)  # 244,233,214
rgb = arr * (1 - hm[..., None]) + bleached * hm[..., None]

# --- cut out + crop to subject bbox -------------------------------------------
sub_np = np.asarray(subject).astype(np.float32) / 255.0
rgba = np.concatenate([rgb, sub_np[..., None]], axis=2)

cols = np.where(sub_np.max(axis=0) > 0.02)[0]
rows = np.where(sub_np.max(axis=1) > 0.02)[0]
x0, x1 = cols[0], cols[-1]
y0, y1 = rows[0], rows[-1]
pad_x = round((x1 - x0) * 0.06)
pad_y = round((y1 - y0) * 0.05)
x0, x1 = max(0, x0 - pad_x), min(W, x1 + pad_x)
y0, y1 = max(0, y0 - pad_y), min(H, y1 + pad_y)
print(f"crop: x {x0}-{x1}, y {y0}-{y1}  ({x1-x0}x{y1-y0})")

rgba_img = Image.fromarray((rgba * 255).astype(np.uint8)).crop((x0, y0, x1, y1))
hair_img = hair.crop((x0, y0, x1, y1))

ew = EXPORT_W
eh = round(rgba_img.height * EXPORT_W / rgba_img.width)
rgba_img = rgba_img.resize((ew, eh), Image.LANCZOS)
hair_img = hair_img.resize((ew, eh), Image.LANCZOS)

os.makedirs(OUT_DIR, exist_ok=True)
rgba_img.save(os.path.join(OUT_DIR, "scene.webp"), quality=90, method=6)
hair_img.save(os.path.join(OUT_DIR, "hair-mask.png"), optimize=True)
print(f"wrote scene.webp ({ew}x{eh}) and hair-mask.png")

# --- debug: composite over light studio gray ----------------------------------
dbg_bg = Image.new("RGB", (ew, eh), (232, 226, 216))
dbg_bg.paste(rgba_img, (0, 0), rgba_img)
dbg_bg.save(os.path.join(HERE, "hair-mask-debug.jpg"), quality=88)
print("debug composite: scripts/hair-mask-debug.jpg")
