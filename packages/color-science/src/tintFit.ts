/**
 * Two-constant Kubelka–Munk K(λ), S(λ) fit from a white-dilution tint ladder
 * (MASTER_PLAN §1.4 and §17 Step 4 — external ground-truth validation).
 *
 * A single reflectance measurement only determines the ratio K/S (see
 * kubelkaMunk.ts). Separating K from S requires watching the pigment dilute
 * against a known scatterer: the masstone plus its white tints (LBNL
 * publishes 1:4 and 1:9) give three reflectance equations per wavelength for
 * the two unknowns K_p(λ), S_p(λ). This is the standard tint-ladder
 * fingerprinting approach publicly described by Trycolors.
 *
 * Method (each wavelength fitted independently):
 *   1. Fix the white scale from the white masstone: S_w ≡ 1 and
 *      K_w(λ) = q_w(λ) = (1 − R_w)² / (2R_w). Only ratios K/S are
 *      observable, so one scale must be fixed by convention; anchoring the
 *      white makes every fitted fingerprint commensurate, which is what
 *      later makes cross-pigment mixing meaningful.
 *   2. For a rung with pigment fraction c the two-constant model predicts
 *        q(c)  = (c·K_p + (1−c)·K_w) / (c·S_p + (1−c)·S_w),
 *        R_pred = 1 + q − √(q² + 2q)   (cancellation-free form).
 *   3. Minimize Σ_rungs (R_pred − R_meas)² over (K_p, S_p) ≥ 0 by a coarse
 *      grid search followed by Nelder–Mead refinement in (ln K_p, ln S_p).
 *      Log space enforces positivity and linearizes the multiplicative
 *      structure of the model; the problem is 2-D, smooth, and cheap, so no
 *      optimizer dependency is warranted.
 *
 * Identifiability note: at wavelengths where the pigment barely differs
 * from the white (tints ≈ white masstone) the loss is insensitive along a
 * valley of (K_p, S_p) with the right dilution behaviour; any point on the
 * valley predicts the ladder almost equally well, so this is harmless for
 * mixture prediction but individual coefficients there should not be
 * over-interpreted.
 */
import {
  reflectanceToKoverS,
  type KsFingerprint,
} from "./kubelkaMunk";
import {
  createSpectrum,
  defaultWavelengths,
  type Spectrum,
} from "./spectrum";

/** One rung of a white-dilution ladder. */
export interface TintLadderRung {
  /**
   * Pigment fraction c ∈ (0, 1] of the rung mixture: 1 = masstone,
   * 0.2 = 1:4 pigment:white tint, 0.1 = 1:9 tint (LBNL conventions).
   */
  pigmentFraction: number;
  /** Measured reflectance of the rung, on the shared grid. */
  reflectance: Spectrum;
}

/** Result of a per-wavelength two-constant fit over a full ladder. */
export interface TintFitResult {
  /**
   * Fitted fingerprint on the shared grid, on the white scale (S_w = 1).
   * Directly usable as a component fingerprint in mixKubelkaMunk together
   * with other fingerprints fitted against the same white.
   */
  fingerprint: KsFingerprint;
  /**
   * The white reference actually used: k = q_w(λ) from the white masstone,
   * s ≡ 1 by scale convention.
   */
  white: KsFingerprint;
  /** RMS reflectance residual across rungs, per wavelength (38 values). */
  perWavelengthRmse: number[];
  /** RMS reflectance residual across the whole ladder (all λ, all rungs). */
  ladderRmse: number;
}

/** Bounds of the (ln K, ln S) search space; K, S ∈ [e⁻³⁰, e³⁰] is far wider
 * than any real pigment relative to the S_w = 1 white scale. */
const LOG_PARAM_LIMIT = 30;

/** Coarse multi-start grid: ln K ∈ [−9, 5], ln S ∈ [−8, 3], step 1. */
const GRID_LOG_K_MIN = -9;
const GRID_LOG_K_MAX = 5;
const GRID_LOG_S_MIN = -8;
const GRID_LOG_S_MAX = 3;
const GRID_STEP = 1;

/** Nelder–Mead controls. Tight tolerances: the loss is analytic and the
 * synthetic recovery test asserts parameter recovery to < 1e-3 relative. */
const NM_MAX_ITERATIONS = 400;
const NM_INITIAL_STEP = 0.5;
const NM_X_TOL = 1e-10;
const NM_F_TOL = 1e-16;
/** Number of best coarse-grid vertices refined by Nelder–Mead. */
const MULTI_START_COUNT = 3;

/** Cancellation-free K/S → R∞ point transform, mirroring kubelkaMunk.ts. */
function koverSPointToReflectance(q: number): number {
  return 1 / (1 + q + Math.sqrt(q * q + 2 * q));
}

/** Validate that a spectrum sits exactly on the shared default grid. */
function assertOnSharedGrid(spectrum: Spectrum, context: string): void {
  const grid = defaultWavelengths();
  const onGrid =
    spectrum.wavelengths.length === grid.length &&
    spectrum.values.length === grid.length &&
    spectrum.wavelengths.every((w, i) => w === grid[i]);
  if (!onGrid) {
    throw new Error(
      `${context}: spectrum must be sampled on the shared ` +
        `${grid[0]}–${grid[grid.length - 1]} nm grid (${grid.length} points); ` +
        `resample first (see resample.ts)`,
    );
  }
}

/**
 * Build the per-wavelength least-squares loss in log-parameter space.
 * Returns Infinity outside the search box so the optimizer can never wander
 * into overflow/underflow territory (and NaN can never enter the simplex).
 */
function makeWavelengthLoss(
  fractions: number[],
  measured: number[],
  qWhite: number,
): (u: number, v: number) => number {
  return (u, v) => {
    if (
      u < -LOG_PARAM_LIMIT ||
      u > LOG_PARAM_LIMIT ||
      v < -LOG_PARAM_LIMIT ||
      v > LOG_PARAM_LIMIT
    ) {
      return Number.POSITIVE_INFINITY;
    }
    const kp = Math.exp(u);
    const sp = Math.exp(v);
    let acc = 0;
    for (let r = 0; r < fractions.length; r++) {
      const c = fractions[r]!;
      const q = (c * kp + (1 - c) * qWhite) / (c * sp + (1 - c));
      const rPred = koverSPointToReflectance(q);
      const d = rPred - measured[r]!;
      acc += d * d;
    }
    return acc;
  };
}

/** Squared Euclidean distance between two 2-D points. */
function dist2(a: readonly number[], b: readonly number[]): number {
  const du = a[0]! - b[0]!;
  const dv = a[1]! - b[1]!;
  return du * du + dv * dv;
}

/**
 * Hand-rolled Nelder–Mead for a 2-D objective (standard coefficients:
 * reflection 1, expansion 2, contraction 0.5, shrink 0.5). Deterministic:
 * the initial simplex is axis-aligned around `start`.
 */
function nelderMead2(
  f: (u: number, v: number) => number,
  start: readonly [number, number],
): { point: [number, number]; value: number } {
  // Simplex vertices with their objective values: [u, v, f].
  let simplex: [number, number, number][] = [
    [start[0], start[1], f(start[0], start[1])],
    [start[0] + NM_INITIAL_STEP, start[1], f(start[0] + NM_INITIAL_STEP, start[1])],
    [start[0], start[1] + NM_INITIAL_STEP, f(start[0], start[1] + NM_INITIAL_STEP)],
  ];

  for (let iter = 0; iter < NM_MAX_ITERATIONS; iter++) {
    // Order best → worst.
    simplex.sort((a, b) => a[2] - b[2]);
    const [best, mid, worst] = simplex as [
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ];

    // Convergence: flat objective AND small simplex.
    const fSpread = worst[2] - best[2];
    const diameter = Math.sqrt(Math.max(dist2(best, mid), dist2(best, worst), dist2(mid, worst)));
    if (fSpread < NM_F_TOL && diameter < NM_X_TOL) {
      break;
    }

    // Centroid of the best two vertices.
    const cu = (best[0] + mid[0]) / 2;
    const cv = (best[1] + mid[1]) / 2;

    // Reflection (α = 1).
    const ru = cu + (cu - worst[0]);
    const rv = cv + (cv - worst[1]);
    const fr = f(ru, rv);

    if (fr < best[2]) {
      // Expansion (γ = 2).
      const eu = cu + 2 * (ru - cu);
      const ev = cv + 2 * (rv - cv);
      const fe = f(eu, ev);
      simplex[2] = fe < fr ? [eu, ev, fe] : [ru, rv, fr];
    } else if (fr < mid[2]) {
      simplex[2] = [ru, rv, fr];
    } else {
      // Contraction (ρ = 0.5): outside if the reflection beat the worst,
      // inside otherwise.
      let ku: number;
      let kv: number;
      if (fr < worst[2]) {
        ku = cu + 0.5 * (ru - cu);
        kv = cv + 0.5 * (rv - cv);
      } else {
        ku = cu + 0.5 * (worst[0] - cu);
        kv = cv + 0.5 * (worst[1] - cv);
      }
      const fk = f(ku, kv);
      const acceptValue = fr < worst[2] ? fr : worst[2];
      if (fk < acceptValue) {
        simplex[2] = [ku, kv, fk];
      } else {
        // Shrink (σ = 0.5) toward the best vertex.
        simplex[1] = [
          best[0] + 0.5 * (mid[0] - best[0]),
          best[1] + 0.5 * (mid[1] - best[1]),
          0,
        ];
        simplex[2] = [
          best[0] + 0.5 * (worst[0] - best[0]),
          best[1] + 0.5 * (worst[1] - best[1]),
          0,
        ];
        simplex[1]![2] = f(simplex[1]![0], simplex[1]![1]);
        simplex[2]![2] = f(simplex[2]![0], simplex[2]![1]);
      }
    }
  }

  simplex.sort((a, b) => a[2] - b[2]);
  const winner = simplex[0]!;
  return { point: [winner[0], winner[1]], value: winner[2] };
}

/** Coarse grid search + Nelder–Mead polish from the best few grid cells. */
function minimizeWavelengthLoss(loss: (u: number, v: number) => number): {
  point: [number, number];
  value: number;
} {
  // Evaluate the coarse grid, keeping the best MULTI_START_COUNT vertices.
  const starters: [number, number, number][] = [];
  for (let u = GRID_LOG_K_MIN; u <= GRID_LOG_K_MAX; u += GRID_STEP) {
    for (let v = GRID_LOG_S_MIN; v <= GRID_LOG_S_MAX; v += GRID_STEP) {
      starters.push([u, v, loss(u, v)]);
    }
  }
  starters.sort((a, b) => a[2] - b[2]);

  let best: { point: [number, number]; value: number } = {
    point: [starters[0]![0], starters[0]![1]],
    value: starters[0]![2],
  };
  for (let i = 0; i < Math.min(MULTI_START_COUNT, starters.length); i++) {
    const s = starters[i]!;
    if (!Number.isFinite(s[2])) continue;
    const refined = nelderMead2(loss, [s[0], s[1]]);
    if (refined.value < best.value) {
      best = refined;
    }
  }
  return best;
}

/**
 * Fit a pigment's two-constant K(λ), S(λ) fingerprint from its white
 * dilution ladder (masstone + tints) and the white's own masstone.
 *
 * @param rungs Ladder rungs on the shared grid. Typically three: masstone
 *              (c = 1), 1:4 tint (c = 0.2), 1:9 tint (c = 0.1). Replicates
 *              at the same fraction are allowed and simply add equations.
 *              Measured reflectances are clamped into [0, 1] (digitization
 *              noise), mirroring the engine's own clamping philosophy.
 * @param white Measured reflectance of the white diluent's masstone, on the
 *              shared grid. Fixes the K/S scale: S_w ≡ 1, K_w = q_w(λ).
 * @returns Fitted fingerprint plus residual diagnostics.
 */
export function fitTwoConstantFromTintLadder(
  rungs: TintLadderRung[],
  white: Spectrum,
): TintFitResult {
  if (rungs.length === 0) {
    throw new Error("fitTwoConstantFromTintLadder: at least one rung is required");
  }
  assertOnSharedGrid(white, "fitTwoConstantFromTintLadder (white)");

  const grid = defaultWavelengths();
  const n = grid.length;

  // Validate and normalize rungs once: fractions in (0, 1], spectra on the
  // shared grid, values finite, clamped into [0, 1].
  const fractions: number[] = [];
  const measuredByRung: number[][] = [];
  for (const rung of rungs) {
    const c = rung.pigmentFraction;
    if (!Number.isFinite(c) || c <= 0 || c > 1) {
      throw new RangeError(
        `fitTwoConstantFromTintLadder: pigmentFraction must be in (0, 1], got ${c}`,
      );
    }
    assertOnSharedGrid(rung.reflectance, "fitTwoConstantFromTintLadder (rung)");
    const clamped = rung.reflectance.values.map((r) => {
      if (!Number.isFinite(r)) {
        throw new RangeError(
          "fitTwoConstantFromTintLadder: rung reflectance contains non-finite values",
        );
      }
      return Math.min(1, Math.max(0, r));
    });
    fractions.push(c);
    measuredByRung.push(clamped);
  }

  // White scale: S_w ≡ 1, K_w = q_w(λ) from the white masstone (clamped
  // inside reflectanceToKoverS exactly as elsewhere in the engine).
  const qWhite = reflectanceToKoverS(white);
  const whiteFingerprint: KsFingerprint = {
    wavelengths: [...grid],
    k: [...qWhite],
    s: new Array<number>(n).fill(1),
  };

  // Independent 2-D fit per wavelength.
  const k = new Array<number>(n);
  const s = new Array<number>(n);
  const perWavelengthRmse = new Array<number>(n);
  let sumSqAll = 0;
  for (let i = 0; i < n; i++) {
    const measured = measuredByRung.map((rungValues) => rungValues[i]!);
    const loss = makeWavelengthLoss(fractions, measured, qWhite[i]!);
    const best = minimizeWavelengthLoss(loss);
    k[i] = Math.exp(best.point[0]);
    s[i] = Math.exp(best.point[1]);
    perWavelengthRmse[i] = Math.sqrt(best.value / rungs.length);
    sumSqAll += best.value;
  }

  return {
    fingerprint: { wavelengths: [...grid], k, s },
    white: whiteFingerprint,
    perWavelengthRmse,
    ladderRmse: Math.sqrt(sumSqAll / (n * rungs.length)),
  };
}

/**
 * Convenience: predict a rung's reflectance from a fitted fingerprint and
 * its white, on the white scale. Exposed for diagnostics/tests; equivalent
 * to mixKubelkaMunk([{fingerprint, c}, {white, 1 − c}]) but allocation-free.
 */
export function predictTintReflectance(
  fingerprint: KsFingerprint,
  white: KsFingerprint,
  pigmentFraction: number,
): Spectrum {
  const grid = defaultWavelengths();
  const c = pigmentFraction;
  if (!Number.isFinite(c) || c < 0 || c > 1) {
    throw new RangeError(`predictTintReflectance: fraction must be in [0, 1], got ${c}`);
  }
  const values = grid.map((_, i) => {
    const q =
      (c * fingerprint.k[i]! + (1 - c) * white.k[i]!) /
      (c * fingerprint.s[i]! + (1 - c) * white.s[i]!);
    return koverSPointToReflectance(q);
  });
  return createSpectrum([...grid], values);
}
