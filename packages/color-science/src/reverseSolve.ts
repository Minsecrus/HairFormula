/**
 * Reverse color solver: given a target Lab color, find the optimal
 * red/purple/blue pigment ratio that minimizes CIEDE2000 distance.
 *
 * Algorithm: exhaustive grid search on the 2-simplex (r + p + b = 1,
 * each in [0, 1]) at a configurable step (default 0.01 = 5151 points),
 * with optional refinement pass around the winner at step/10 within
 * +/-2*step.
 *
 * MASTER_PLAN note: sRGB is display-only. The hex->Lab inverse pipeline
 * implemented here as private helpers is used solely to accept user input;
 * no sRGB value feeds back into the physical model.
 */
import { deltaE2000 } from "./deltaE2000";
import type { KsFingerprint } from "./kubelkaMunk";
import { mixKubelkaMunk } from "./kubelkaMunk";
import type { Lab } from "./lab";
import { xyzToLab } from "./lab";
import type { Rgb } from "./srgb";
import { rgbToHex, xyzToSrgb } from "./srgb";
import type { XYZ } from "./xyz";
import { spectrumToXyz } from "./xyz";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ReverseResult {
  /** Optimal ratio [0,1] for each component, summing to 1. */
  ratios: { red: number; purple: number; blue: number };
  /** Predicted Lab at the optimal ratio. */
  lab: Lab;
  /** Predicted display sRGB. */
  rgb: Rgb;
  /** Predicted hex. */
  hex: string;
  /** DeltaE00 between the target and the predicted color. */
  deltaE00: number;
}

export interface PigmentSet {
  red: KsFingerprint;
  purple: KsFingerprint;
  blue: KsFingerprint;
}

/**
 * Optional diluent (e.g. white base cream / developer): mixed in at a fixed
 * ratio relative to the total pigment amount. Real dye products are mostly
 * base; without dilution the engine mixes pure masstones and every result is
 * near-black. ratio = diluent / totalPigment (e.g. 3 = 25% pigment).
 */
export interface Diluent {
  fingerprint: KsFingerprint;
  ratio: number;
}

export interface SolveOptions {
  coarseStep?: number;
  refine?: boolean;
  diluent?: Diluent;
  /**
   * Hair Dye Strength scalars (see strength.ts): effective concentration of
   * pigment i = ratio_i × s_i. Must match the forward path or forward and
   * reverse disagree.
   */
  strengths?: { red: number; purple: number; blue: number };
}

// ---------------------------------------------------------------------------
// Private helpers: hex -> sRGB -> linear -> XYZ -> Lab
// ---------------------------------------------------------------------------

/**
 * Parse a hex color string (#RGB, #RRGGBB, or RRGGBB) into 0-255 channels.
 */
function parseHex(hex: string): { r: number; g: number; b: number } {
  let h = hex.startsWith("#") ? hex.slice(1) : hex;
  if (h.length === 3) {
    h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  }
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`Invalid hex color: "${hex}"`);
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * Inverse sRGB electro-optical transfer function (IEC 61966-2-1):
 * non-linear sRGB channel [0, 1] -> linear channel [0, 1].
 *
 * c_linear = c / 12.92                   if c <= 0.04045
 *          = ((c + 0.055) / 1.055)^2.4   otherwise
 */
function srgbInverseTransfer(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Forward sRGB matrix (Lindbloom): linear sRGB -> XYZ (Y=1 scale).
 *
 * [[0.4124564, 0.3575761, 0.1804375],
 *  [0.2126729, 0.7151522, 0.0721750],
 *  [0.0193339, 0.1191920, 0.9503041]]
 */
function linearSrgbToXyz(rLin: number, gLin: number, bLin: number): XYZ {
  return {
    x: (0.4124564 * rLin + 0.3575761 * gLin + 0.1804375 * bLin) * 100,
    y: (0.2126729 * rLin + 0.7151522 * gLin + 0.0721750 * bLin) * 100,
    z: (0.0193339 * rLin + 0.1191920 * gLin + 0.9503041 * bLin) * 100,
  };
}

/**
 * Convert a hex color string to CIE Lab (D65).
 */
function hexToLab(hex: string): Lab {
  const { r, g, b } = parseHex(hex);
  const rLin = srgbInverseTransfer(r / 255);
  const gLin = srgbInverseTransfer(g / 255);
  const bLin = srgbInverseTransfer(b / 255);
  const xyz = linearSrgbToXyz(rLin, gLin, bLin);
  return xyzToLab(xyz);
}

// ---------------------------------------------------------------------------
// Core solver
// ---------------------------------------------------------------------------

/**
 * Evaluate a single point on the simplex: mix pigments at the given ratios,
 * convert to Lab, and compute deltaE00 vs target.
 */
function evaluatePoint(
  r: number,
  p: number,
  b: number,
  pigments: PigmentSet,
  target: Lab,
  diluent?: Diluent,
  strengths?: { red: number; purple: number; blue: number },
): { lab: Lab; de: number } {
  const sr = strengths?.red ?? 1;
  const sp = strengths?.purple ?? 1;
  const sb = strengths?.blue ?? 1;
  const components = [
    { fingerprint: pigments.red, concentration: r * sr },
    { fingerprint: pigments.purple, concentration: p * sp },
    { fingerprint: pigments.blue, concentration: b * sb },
  ];
  if (diluent) {
    // r + p + b = 1 on the solver simplex, so this is ratio × total pigment.
    components.push({ fingerprint: diluent.fingerprint, concentration: diluent.ratio });
  }
  const spectrum = mixKubelkaMunk(components);
  const xyz = spectrumToXyz(spectrum);
  const lab = xyzToLab(xyz);
  const de = deltaE2000(target, lab);
  return { lab, de };
}

/**
 * Grid search on the 2-simplex at the given step size, optionally restricted
 * to a region around a center point.
 */
function gridSearch(
  pigments: PigmentSet,
  target: Lab,
  step: number,
  center?: { r: number; p: number; b: number },
  radius?: number,
  diluent?: Diluent,
  strengths?: { red: number; purple: number; blue: number },
): { r: number; p: number; b: number; lab: Lab; de: number } {
  let bestR = 0;
  let bestP = 0;
  let bestB = 1;
  let bestLab: Lab = { l: 0, a: 0, b: 0 };
  let bestDe = Infinity;

  // Determine bounds for the search
  const rMin = center && radius != null ? Math.max(0, center.r - radius) : 0;
  const rMax = center && radius != null ? Math.min(1, center.r + radius) : 1;
  const pMin = center && radius != null ? Math.max(0, center.p - radius) : 0;
  const pMax = center && radius != null ? Math.min(1, center.p + radius) : 1;

  // Enumerate the simplex: r from rMin to rMax, p from pMin to pMax,
  // b = 1 - r - p >= 0 and within bounds if center is set.
  const bMin = center && radius != null ? Math.max(0, center.b - radius) : 0;
  const bMax = center && radius != null ? Math.min(1, center.b + radius) : 1;

  // Use integer loop to avoid floating-point drift
  const stepsR = Math.round((rMax - rMin) / step);
  const stepsP = Math.round((pMax - pMin) / step);

  for (let ri = 0; ri <= stepsR; ri++) {
    const r = rMin + ri * step;
    if (r > 1) break;
    for (let pi = 0; pi <= stepsP; pi++) {
      const p = pMin + pi * step;
      const b = 1 - r - p;
      // Enforce simplex constraint and bounds
      if (b < -1e-12 || b > 1 + 1e-12) continue;
      const bClamped = Math.max(0, Math.min(1, b));
      if (bClamped < bMin - 1e-12 || bClamped > bMax + 1e-12) continue;

      const result = evaluatePoint(r, p, bClamped, pigments, target, diluent, strengths);
      if (result.de < bestDe) {
        bestR = r;
        bestP = p;
        bestB = bClamped;
        bestLab = result.lab;
        bestDe = result.de;
      }
    }
  }

  return { r: bestR, p: bestP, b: bestB, lab: bestLab, de: bestDe };
}

/**
 * Find the red/purple/blue ratio that best matches the target Lab color.
 *
 * @param target - Target color in CIE Lab (D65).
 * @param pigments - The three pigment fingerprints (red, purple, blue).
 * @param options.coarseStep - Grid step for the coarse pass (default 0.01).
 * @param options.refine - Whether to do a refinement pass (default true).
 * @returns The best-matching ratio, predicted color, and deltaE00.
 */
export function findBestRatio(
  target: Lab,
  pigments: PigmentSet,
  options?: SolveOptions,
): ReverseResult {
  const coarseStep = options?.coarseStep ?? 0.01;
  const refine = options?.refine ?? true;
  const diluent = options?.diluent;
  const strengths = options?.strengths;

  // Coarse grid search
  let best = gridSearch(pigments, target, coarseStep, undefined, undefined, diluent, strengths);

  // Refinement pass: finer grid around the coarse winner
  if (refine) {
    const fineStep = coarseStep / 10;
    const radius = coarseStep * 2;
    const refined = gridSearch(
      pigments,
      target,
      fineStep,
      { r: best.r, p: best.p, b: best.b },
      radius,
      diluent,
      strengths,
    );
    if (refined.de < best.de) {
      best = refined;
    }
  }

  // Re-derive XYZ from the spectrum at the winning ratio for accurate sRGB.
  const sr = strengths?.red ?? 1;
  const sp = strengths?.purple ?? 1;
  const sb = strengths?.blue ?? 1;
  const winComponents = [
    { fingerprint: pigments.red, concentration: best.r * sr },
    { fingerprint: pigments.purple, concentration: best.p * sp },
    { fingerprint: pigments.blue, concentration: best.b * sb },
  ];
  if (diluent) {
    winComponents.push({ fingerprint: diluent.fingerprint, concentration: diluent.ratio });
  }
  const winSpectrum = mixKubelkaMunk(winComponents);
  const winXyz = spectrumToXyz(winSpectrum);
  const rgb = xyzToSrgb(winXyz);
  const hex = rgbToHex(rgb);

  return {
    ratios: { red: best.r, purple: best.p, blue: best.b },
    lab: best.lab,
    rgb,
    hex,
    deltaE00: best.de,
  };
}

/**
 * Convenience: hex string -> Lab -> findBestRatio.
 *
 * Implements the inverse sRGB pipeline (hex -> sRGB inverse transfer ->
 * forward sRGB matrix -> XYZ -> Lab) as private helpers within this module,
 * without modifying srgb.ts which is XYZ->sRGB only.
 */
export function findBestRatioFromHex(
  hex: string,
  pigments: PigmentSet,
  options?: SolveOptions,
): ReverseResult {
  const target = hexToLab(hex);
  return findBestRatio(target, pigments, options);
}

// Re-export hexToLab for internal testing (not part of the public interface
// documented in the module header, but useful for the roundtrip sanity test).
export { hexToLab as _hexToLab };
