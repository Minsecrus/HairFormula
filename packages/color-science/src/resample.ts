/**
 * Spectrum resampling by piecewise-linear interpolation (MASTER_PLAN §17
 * Step 3 — data import).
 *
 * All engine math is element-wise on the shared 380–750 nm @ 10 nm grid
 * (src/spectrum.ts), but external databases ship their own grids — e.g. the
 * LBNL Pigment Database publishes 300–2500 nm @ 5 nm. Imported spectra must
 * therefore be resampled explicitly before entering the pipeline.
 *
 * Linear interpolation is the least-assumption choice: it introduces no
 * smoothing, no ringing, and reduces to exact node extraction when the
 * target grid is a subset of the source grid (the LBNL 5 nm → 10 nm case).
 * Out-of-range targets are rejected rather than extrapolated — inventing
 * reflectance beyond the measured range would silently corrupt every
 * downstream metric (MASTER_PLAN §20, error 6).
 */
import { createSpectrum, defaultWavelengths, type Spectrum } from "./spectrum";

/**
 * Relative tolerance when testing whether a target wavelength lies inside
 * the source range. Absorbs floating-point grid-construction noise only
 * (e.g. `300 + 16 * 5` vs `380`); any genuinely out-of-range request is
 * orders of magnitude larger.
 */
const RANGE_EPSILON = 1e-9;

/** Validate the source spectrum: matching lengths, ≥ 2 points, strictly
 * ascending finite wavelengths, finite values. */
function assertValidSource(spectrum: Spectrum): void {
  const { wavelengths, values } = spectrum;
  if (wavelengths.length !== values.length) {
    throw new Error(
      `resampleLinear: ${wavelengths.length} wavelengths vs ${values.length} values`,
    );
  }
  if (wavelengths.length < 2) {
    throw new Error(
      `resampleLinear: need at least 2 source points, got ${wavelengths.length}`,
    );
  }
  for (let i = 0; i < wavelengths.length; i++) {
    const w = wavelengths[i]!;
    if (!Number.isFinite(w)) {
      throw new RangeError(`resampleLinear: non-finite wavelength at index ${i}`);
    }
    if (i > 0 && w <= wavelengths[i - 1]!) {
      throw new RangeError(
        `resampleLinear: source wavelengths must be strictly ascending, ` +
          `got ${wavelengths[i - 1]} then ${w} at index ${i}`,
      );
    }
    const v = values[i]!;
    if (!Number.isFinite(v)) {
      throw new RangeError(`resampleLinear: non-finite value at index ${i}`);
    }
  }
}

/** Validate the target grid: ≥ 1 point, strictly ascending finite wavelengths. */
function assertValidTarget(targetWavelengths: number[]): void {
  if (targetWavelengths.length < 1) {
    throw new Error("resampleLinear: target grid must contain at least 1 point");
  }
  for (let i = 0; i < targetWavelengths.length; i++) {
    const w = targetWavelengths[i]!;
    if (!Number.isFinite(w)) {
      throw new RangeError(
        `resampleLinear: non-finite target wavelength at index ${i}`,
      );
    }
    if (i > 0 && w <= targetWavelengths[i - 1]!) {
      throw new RangeError(
        `resampleLinear: target wavelengths must be strictly ascending, ` +
          `got ${targetWavelengths[i - 1]} then ${w} at index ${i}`,
      );
    }
  }
}

/**
 * Interpolate `spectrum` piecewise-linearly onto `targetWavelengths`
 * (default: the shared 380–750 nm @ 10 nm grid).
 *
 * The source grid must be strictly ascending and cover every target
 * wavelength; targets outside the measured range throw a RangeError instead
 * of being extrapolated or clamped. Values are interpolated as-is — physical
 * validation of the reflectance is the caller's responsibility (consistent
 * with {@link createSpectrum}).
 *
 * Runs in O(n + m) via a two-pointer march over the two ascending grids.
 */
export function resampleLinear(
  spectrum: Spectrum,
  targetWavelengths: number[] = defaultWavelengths(),
): Spectrum {
  assertValidSource(spectrum);
  assertValidTarget(targetWavelengths);

  const { wavelengths: srcW, values: srcV } = spectrum;
  const lo = srcW[0]!;
  const hi = srcW[srcW.length - 1]!;
  const span = hi - lo;
  // Absolute tolerance on the same order as grid-construction float noise.
  const eps = RANGE_EPSILON * Math.max(1, Math.abs(span));

  const out = new Array<number>(targetWavelengths.length);
  let i = 0; // source segment index: srcW[i] ≤ t ≤ srcW[i + 1]
  for (let j = 0; j < targetWavelengths.length; j++) {
    const t = targetWavelengths[j]!;
    if (t < lo - eps || t > hi + eps) {
      throw new RangeError(
        `resampleLinear: target ${t} nm outside source range ${lo}–${hi} nm; ` +
          `extrapolation is not supported`,
      );
    }
    // Advance the segment pointer. The clamped endpoints (t ≈ lo / t ≈ hi)
    // are handled naturally: i never moves past the final segment.
    while (i < srcW.length - 2 && srcW[i + 1]! < t) {
      i++;
    }
    const a = srcW[i]!;
    const b = srcW[i + 1]!;
    const fa = srcV[i]!;
    const fb = srcV[i + 1]!;
    if (t <= a) {
      out[j] = fa; // exact node hit (or the clamped lower endpoint)
    } else if (t >= b) {
      out[j] = fb; // exact node hit (or the clamped upper endpoint)
    } else {
      const u = (t - a) / (b - a);
      out[j] = fa + u * (fb - fa);
    }
  }
  return createSpectrum([...targetWavelengths], out);
}
