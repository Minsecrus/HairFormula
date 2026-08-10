/**
 * Lab / XYZ → display sRGB (and HEX).
 *
 * Display-only. Per MASTER_PLAN §1.1, sRGB output must never be used as a
 * physical prediction input — this module is strictly the last step of the
 * pipeline (spectrum → … → Lab → sRGB). Nothing here may feed back into the
 * physical model (no RGB-weighted averaging anywhere upstream).
 *
 * Implements MASTER_PLAN Step 1 (§13): XYZ → sRGB via the standard
 * sRGB/D65 inverse matrix, followed by the sRGB electro-optical transfer
 * function (IEC 61966-2-1) and quantization to 8-bit channels.
 */
import type { XYZ } from "./xyz";

export interface Rgb {
  /** Channels in [0, 255] (integers after quantization). */
  r: number;
  g: number;
  b: number;
  /**
   * True when the linear (pre-clamp) sRGB value fell outside [0, 1] on any
   * channel, i.e. the color lies outside the sRGB gamut and had to be
   * clamped for display. Optional so display-only call sites can ignore it.
   */
  outOfGamut?: boolean;
}

/**
 * Convert CIE XYZ (Y = 100 scale, D65 white) to display sRGB.
 *
 * Steps:
 * 1. Normalize XYZ to [0, 1] (X' = X/100, …).
 * 2. Apply the standard sRGB/D65 linear transform (7-digit coefficients as
 *    published by Bruce Lindbloom / Wikipedia; their exact inverse is the
 *    matching forward matrix 0.4124564, 0.3575761, 0.1804375 / …. IEC
 *    61966-2-1 itself prints the rounded 4-decimal form, e.g.
 *    r = 3.2406 X' − 1.5372 Y' − 0.4986 Z'):
 *      r =  3.2404542 X' − 1.5371385 Y' − 0.4985314 Z'
 *      g = −0.9692660 X' + 1.8760108 Y' + 0.0415560 Z'
 *      b =  0.0556434 X' − 0.2040259 Y' + 1.0572252 Z'
 * 3. Gamut check + clamp to [0, 1]. The check tolerates a small epsilon
 *    because both the matrix and any XYZ input are rounded (D65 white and
 *    the sRGB primaries land a few 1e-7 outside [0, 1] with exact math).
 * 4. sRGB EOTF ("gamma"): c ≤ 0.0031308 → 12.92 c, else 1.055 c^(1/2.4) − 0.055.
 * 5. Quantize to integer [0, 255].
 */
export function xyzToSrgb(xyz: XYZ): Rgb {
  // 1. Y = 100 scale → normalized tristimulus.
  const x = xyz.x / 100;
  const y = xyz.y / 100;
  const z = xyz.z / 100;

  // 2. XYZ → linear sRGB (D65), standard Lindbloom/Wikipedia coefficients.
  let r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  let g = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  let b = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

  // 3. Out-of-gamut colors must be flagged before clamping. Epsilon absorbs
  //    matrix/input rounding noise only; genuine gamut violations are orders
  //    of magnitude larger.
  const GAMUT_EPSILON = 1e-4;
  const outOfGamut =
    r < -GAMUT_EPSILON ||
    r > 1 + GAMUT_EPSILON ||
    g < -GAMUT_EPSILON ||
    g > 1 + GAMUT_EPSILON ||
    b < -GAMUT_EPSILON ||
    b > 1 + GAMUT_EPSILON;
  r = clamp01(r);
  g = clamp01(g);
  b = clamp01(b);

  // 4–5. EOTF + 8-bit quantization.
  return {
    r: Math.round(srgbTransfer(r) * 255),
    g: Math.round(srgbTransfer(g) * 255),
    b: Math.round(srgbTransfer(b) * 255),
    outOfGamut,
  };
}

/** Clamp a linear channel to [0, 1]. */
function clamp01(c: number): number {
  return Math.min(1, Math.max(0, c));
}

/**
 * sRGB electro-optical transfer function (IEC 61966-2-1 §4).
 * Input: linear channel in [0, 1]. Output: non-linear channel in [0, 1].
 */
function srgbTransfer(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * Format an sRGB triple as a lowercase `#RRGGBB` hex string.
 * Channels are rounded and clamped defensively so out-of-range input
 * cannot produce a malformed string.
 */
export function rgbToHex(rgb: Rgb): string {
  const toByte = (v: number): string =>
    Math.min(255, Math.max(0, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${toByte(rgb.r)}${toByte(rgb.g)}${toByte(rgb.b)}`;
}
