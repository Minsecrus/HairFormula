/**
 * CIEDE2000 color difference (ΔE00).
 *
 * Primary accuracy metric for model validation (MASTER_PLAN §8.1).
 *
 * Implements the full CIEDE2000 formula as defined in:
 *   G. Sharma, W. Wu, E. N. Dalal, "The CIEDE2000 Color-Difference Formula:
 *   Implementation Notes, Supplementary Test Data, and Mathematical
 *   Observations", Color Research & Application 30(1), 2005.
 *
 * Parametric factors are fixed at kL = kC = kH = 1 (standard viewing
 * conditions). Verified against the Sharma et al. reference test pairs.
 */
import type { Lab } from "./lab";

/** Degrees → radians. */
const toRad = (deg: number): number => (deg * Math.PI) / 180;
/** Radians → degrees, normalized into [0, 360). */
const toDeg360 = (rad: number): number => {
  const deg = (rad * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
};

/**
 * Compute the CIEDE2000 difference between two CIELAB colors.
 *
 * Notation follows Sharma et al. (2005) exactly: primed quantities are the
 * recomputed L′, C′, h′ coordinates; barred quantities are arithmetic means;
 * subscripted G/T/S/R terms are the weighting and rotation factors.
 */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const { l: l1, a: a1, b: b1 } = lab1;
  const { l: l2, a: a2, b: b2 } = lab2;

  // Step 1: recomputed chroma C′ via the G factor (compensates for the
  // low-chroma distortion of the a* axis).
  const c1Ab = Math.hypot(a1, b1);
  const c2Ab = Math.hypot(a2, b2);
  const cAbMean = (c1Ab + c2Ab) / 2;
  const cAbMean7 = Math.pow(cAbMean, 7);
  const g = 0.5 * (1 - Math.sqrt(cAbMean7 / (cAbMean7 + Math.pow(25, 7))));

  const a1P = (1 + g) * a1;
  const a2P = (1 + g) * a2;

  const c1P = Math.hypot(a1P, b1);
  const c2P = Math.hypot(a2P, b2);

  // Hue angles of the primed coordinates; undefined (treated as 0) at zero chroma.
  const h1P = c1P === 0 ? 0 : toDeg360(Math.atan2(b1, a1P));
  const h2P = c2P === 0 ? 0 : toDeg360(Math.atan2(b2, a2P));

  // Step 2: deltas in L′, C′, and h′.
  const dLp = l2 - l1;
  const dCp = c2P - c1P;
  let dhp: number;
  if (c1P * c2P === 0) {
    dhp = 0;
  } else {
    const diff = h2P - h1P;
    if (diff > 180) dhp = diff - 360;
    else if (diff < -180) dhp = diff + 360;
    else dhp = diff;
  }
  const dHp = 2 * Math.sqrt(c1P * c2P) * Math.sin(toRad(dhp / 2));

  // Step 3: mean L′, C′ and mean hue h̄′ (angle mean with the usual
  // 360° wraparound handling; undefined when either chroma is zero).
  const lPMean = (l1 + l2) / 2;
  const cPMean = (c1P + c2P) / 2;
  let hPMean: number;
  if (c1P * c2P === 0) {
    hPMean = h1P + h2P; // hue angle undefined for achromatic samples
  } else if (Math.abs(h1P - h2P) <= 180) {
    hPMean = (h1P + h2P) / 2;
  } else if (h1P + h2P < 360) {
    hPMean = (h1P + h2P + 360) / 2;
  } else {
    hPMean = (h1P + h2P - 360) / 2;
  }

  // Step 4: weighting functions SL, SC, SH and the hue-dependent term T.
  const t =
    1 -
    0.17 * Math.cos(toRad(hPMean - 30)) +
    0.24 * Math.cos(toRad(2 * hPMean)) +
    0.32 * Math.cos(toRad(3 * hPMean + 6)) -
    0.2 * Math.cos(toRad(4 * hPMean - 63));

  const lPMeanMinus50Sq = Math.pow(lPMean - 50, 2);
  const sL = 1 + (0.015 * lPMeanMinus50Sq) / Math.sqrt(20 + lPMeanMinus50Sq);
  const sC = 1 + 0.045 * cPMean;
  const sH = 1 + 0.015 * cPMean * t;

  // Step 5: chroma rotation term RC and the blue-region rotation RT.
  const cPMean7 = Math.pow(cPMean, 7);
  const rC = Math.sqrt(cPMean7 / (cPMean7 + Math.pow(25, 7)));
  const dTheta = 30 * Math.exp(-Math.pow((hPMean - 275) / 25, 2));
  const rT = -2 * rC * Math.sin(toRad(2 * dTheta));

  // Step 6: combine (kL = kC = kH = 1).
  const lTerm = dLp / sL;
  const cTerm = dCp / sC;
  const hTerm = dHp / sH;
  return Math.sqrt(
    lTerm * lTerm + cTerm * cTerm + hTerm * hTerm + rT * cTerm * hTerm,
  );
}
