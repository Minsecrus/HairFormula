/**
 * Spectrum → CIE XYZ tristimulus values (MASTER_PLAN §17, Step 1).
 *
 * Weighted-sum practice per CIE 15:2004 §7.1 / ASTM E308, on the shared
 * 380–750 nm @ 10 nm grid with the embedded CIE tables (src/data/cie.ts):
 *
 *   X = k · Σλ R(λ) · S(λ) · x̄(λ) · Δλ   (analogously Y with ȳ, Z with z̄)
 *   k = 100 / ( Σλ S(λ) · ȳ(λ) · Δλ )
 *
 * so the perfect reflecting diffuser (ideal white, R ≡ 1) yields Y = 100.
 *
 * Grid-truncation note: summing the embedded 10 nm tables gives the
 * illuminant white (95.0164, 100, 108.8134). The canonical D65 white
 * (95.047, 100, 108.883) follows from the same official CIE data integrated
 * at 1 nm over 360–830 nm; the residual (≤ 0.07 in Z) is pure quadrature /
 * truncation error — verified against the official CIE 1 nm CSVs and the
 * reference implementation `colour-science` (sd_to_XYZ, "Integration").
 * We deliberately keep the self-consistent grid white as XYZ_D65_WHITE so
 * that ideal white maps to exactly Lab (100, 0, 0); the chromaticity
 * (x ≈ 0.31273, y ≈ 0.32913) matches the CIE D65 chromaticity well within
 * 5e-4.
 */
import { CIE_2DEG_D65_TABLE } from "./data/cie";
import type { Spectrum } from "./spectrum";

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

/** Step of the shared spectral grid (nm); matches src/spectrum.ts. */
const DELTA_LAMBDA_NM = 10;

/**
 * Normalization constant k = 100 / Σ S(λ)·ȳ(λ)·Δλ, fixed once at module
 * load from the embedded tables.
 */
const NORMALIZATION_K =
  100 /
  (DELTA_LAMBDA_NM *
    CIE_2DEG_D65_TABLE.reduce((acc, row) => acc + row.d65Spd * row.yBar, 0));

/**
 * Tristimulus sums of the bare illuminant, Σ S(λ)·cmf(λ) for each CMF.
 * Used to derive the D65 white point from the tables.
 */
function illuminantSums(): { sx: number; sy: number; sz: number } {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const row of CIE_2DEG_D65_TABLE) {
    sx += row.d65Spd * row.xBar;
    sy += row.d65Spd * row.yBar;
    sz += row.d65Spd * row.zBar;
  }
  return { sx, sy, sz };
}

/**
 * D65 white point computed from the embedded tables on the shared grid:
 * identical to `spectrumToXyz(idealWhite())`. See the truncation note in
 * the module header for the comparison against the 1 nm reference
 * (95.047, 100, 108.883).
 */
export const XYZ_D65_WHITE: XYZ = (() => {
  const { sx, sy, sz } = illuminantSums();
  const kDeltaLambda = NORMALIZATION_K * DELTA_LAMBDA_NM;
  return { x: kDeltaLambda * sx, y: kDeltaLambda * sy, z: kDeltaLambda * sz };
})();

/** Throw unless the spectrum lives exactly on the shared 380–750 nm @ 10 nm grid. */
function assertOnSharedGrid(spectrum: Spectrum): void {
  if (
    spectrum.wavelengths.length !== CIE_2DEG_D65_TABLE.length ||
    spectrum.values.length !== CIE_2DEG_D65_TABLE.length ||
    spectrum.wavelengths.some((wl, i) => wl !== CIE_2DEG_D65_TABLE[i]?.wavelengthNm)
  ) {
    throw new Error(
      "spectrumToXyz: spectrum must be sampled on the shared 380–750 nm @ 10 nm grid " +
        "(see defaultWavelengths() in src/spectrum.ts)",
    );
  }
}

/**
 * Integrate a reflectance spectrum against D65 + CIE 1931 2° observer.
 *
 * @param spectrum Reflectance in [0, 1] on the shared grid. Values are used
 *                 as-is; physical validity of the reflectance is the
 *                 caller's responsibility.
 * @returns XYZ tristimulus values with Y = 100 for ideal white.
 */
export function spectrumToXyz(spectrum: Spectrum): XYZ {
  assertOnSharedGrid(spectrum);
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i < CIE_2DEG_D65_TABLE.length; i++) {
    // Both tables are same-length literals aligned by construction; the grid
    // check above guarantees spectrum.values has the same length.
    const row = CIE_2DEG_D65_TABLE[i]!;
    const r = spectrum.values[i]!;
    sx += r * row.d65Spd * row.xBar;
    sy += r * row.d65Spd * row.yBar;
    sz += r * row.d65Spd * row.zBar;
  }
  const kDeltaLambda = NORMALIZATION_K * DELTA_LAMBDA_NM;
  return { x: kDeltaLambda * sx, y: kDeltaLambda * sy, z: kDeltaLambda * sz };
}
