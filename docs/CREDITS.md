# Credits

## Current hair scene (apps/web/public/hair/scene.webp + hair-mask.png)

**Procedurally generated and rendered in-house** with Blender (Cycles), via
`scripts/render-hair.py` + `scripts/convert-hair-render.py`. No external
assets, no license obligations.

Pipeline: scalp-region guide sampling → velocity-integrated strand paths
(gravity ramp, comb flow, two-octave wave, clumping, frizz, rare flyaways) →
~5.8k tapered curve strands → Principled Hair BSDF (platinum) → 3-point
studio lighting → transparent-background PNG → webp + alpha mask.

## Archived: photo-based pipeline (superseded, kept for reference)

- **"Blonde-haired Woman"** — Todayle, 2022
- Source: [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Blonde-haired_Woman.jpg)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0)
- Original archived at `model/datasets/raw/photo/blonde-woman-original.jpg`;
  segmentation/bleaching pipeline in `scripts/prepare-hair-image.py`.
  Not used by the current app build.
