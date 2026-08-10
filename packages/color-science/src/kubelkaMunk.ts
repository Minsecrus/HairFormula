/**
 * Kubelka–Munk spectral mixing engine (Step 2).
 *
 * Per MASTER_PLAN §1.4:
 *   K/S = (1 - R)² / 2R          (single reflectance → K/S ratio)
 *   K_mix(λ) = Σ cᵢ Kᵢ(λ)
 *   S_mix(λ) = Σ cᵢ Sᵢ(λ)
 *   R∞(λ)  = 1 + q − √(q² + 2q),  q = K_mix/S_mix
 *
 * NOTE: single-reflectance measurement only determines K/S, not K and S
 * separately; separating them requires a tint ladder fit (see Trycolors'
 * public description). This module is the pigment-layer engine only —
 * the hair substrate layer is a separate model (V0.5).
 */
import { createSpectrum, defaultWavelengths, type Spectrum } from "./spectrum";

/** Absorption/scattering coefficients per wavelength. */
export interface KsFingerprint {
  wavelengths: number[];
  k: number[];
  s: number[];
}

/**
 * Lower clamp applied to reflectance before the K/S transform.
 *
 * q = (1−R)²/2R diverges like 1/(2R) as R → 0, and an infinite q is not
 * representable downstream (it would poison every mix containing the
 * wavelength). Perfect absorbers are therefore treated as R = 1e-6,
 * i.e. q ≈ 5e5 — far beyond any real pigment, so the approximation is
 * physically invisible but numerically finite.
 */
const MIN_REFLECTANCE = 1e-6;

/**
 * Reflectance spectrum R(λ) → K/S ratio q(λ) = (1−R)²/(2R) (MASTER_PLAN §1.4).
 *
 * Element-wise transform; the wavelength grid is irrelevant but the returned
 * array follows the input order. R is clamped into [MIN_REFLECTANCE, 1]:
 * R ≤ 0 would yield an infinite/negative q (see above), and R > 1
 * (measurement noise, fluorescence) would yield a negative, non-physical q.
 */
export function reflectanceToKoverS(spectrum: Spectrum): number[] {
  if (spectrum.wavelengths.length !== spectrum.values.length) {
    throw new Error(
      `reflectanceToKoverS: ${spectrum.wavelengths.length} wavelengths vs ` +
        `${spectrum.values.length} values`,
    );
  }
  return spectrum.values.map((r) => {
    const rc = Math.min(Math.max(r, MIN_REFLECTANCE), 1);
    const oneMinusR = 1 - rc;
    return (oneMinusR * oneMinusR) / (2 * rc);
  });
}

/**
 * Scalar K/S → R∞ transform, shared by the two- and single-constant engines.
 *
 * The plan's formula R∞ = 1 + q − √(q² + 2q) is implemented in the
 * algebraically identical, cancellation-free form
 *   R∞ = 1 / (1 + q + √(q² + 2q))
 * (valid because (1+q)² − (q²+2q) = 1). The direct form loses precision for
 * small q: 1 + q and √(q² + 2q) agree to leading order, so their difference
 * is mostly rounding error.
 *
 * q = 0 → R = 1 (ideal white); q → ∞ → R → 0 (perfect absorber). This is the
 * exact inverse of the q = (1−R)²/(2R) mapping used in reflectanceToKoverS.
 */
function koverSPointToReflectance(q: number): number {
  // `!(q >= 0)` rejects NaN as well as negatives; +∞ is allowed and yields 0.
  if (!(q >= 0)) {
    throw new RangeError(`K/S must be a non-negative number, got ${q}`);
  }
  return 1 / (1 + q + Math.sqrt(q * q + 2 * q));
}

/**
 * K/S ratios q(λ) → infinite-thickness reflectance R∞(λ) (MASTER_PLAN §1.4).
 * Exact element-wise inverse of {@link reflectanceToKoverS} for q ≥ 0.
 */
export function koverSToReflectance(kOverS: number[]): number[] {
  return kOverS.map(koverSPointToReflectance);
}

/**
 * Throw unless `wavelengths` is exactly the shared default grid
 * (380–750 nm @ 10 nm). All engine math is element-wise, so silently mixing
 * fingerprints sampled on different grids would be a category error — the
 * caller must re-sample explicitly before mixing (MASTER_PLAN §1.4 note on
 * the fixed shared grid).
 */
function assertDefaultGrid(wavelengths: number[], context: string): void {
  const grid = defaultWavelengths();
  const matches =
    wavelengths.length === grid.length &&
    wavelengths.every((w, i) => w === grid[i]);
  if (!matches) {
    throw new Error(
      `${context}: fingerprint grid must equal the shared ` +
        `${grid[0]}–${grid[grid.length - 1]} nm @ ${grid[1]! - grid[0]!} nm ` +
        `grid (${grid.length} points)`,
    );
  }
}

/**
 * Validate concentrations (finite, non-negative, positive sum) and return
 * them normalized to Σ cᵢ = 1, so callers may pass raw recipe amounts
 * (drops, grams, …) without pre-normalizing.
 */
function normalizeConcentrations(concentrations: number[]): number[] {
  if (concentrations.length === 0) {
    throw new Error("at least one component is required");
  }
  let sum = 0;
  for (const c of concentrations) {
    if (!Number.isFinite(c) || c < 0) {
      throw new RangeError(
        `concentrations must be finite and non-negative, got ${c}`,
      );
    }
    sum += c;
  }
  if (sum <= 0) {
    throw new RangeError("concentrations must sum to a positive value");
  }
  return concentrations.map((c) => c / sum);
}

/**
 * Two-constant Kubelka–Munk mixing (MASTER_PLAN §1.4):
 *   K_mix(λ) = Σ cᵢ Kᵢ(λ),  S_mix(λ) = Σ cᵢ Sᵢ(λ),  R∞ from q = K_mix/S_mix.
 *
 * Concentrations are normalized internally (Σ cᵢ = 1). Degenerate cases are
 * resolved by their physical limits rather than by epsilon clamps:
 *   K_mix = 0           → R = 1 (nothing absorbs; ideal white — this also
 *                         covers the 0/0 "empty layer" case),
 *   K_mix > 0, S_mix = 0 → R = 0 (q → ∞; absorption with no scattering).
 */
export function mixKubelkaMunk(
  components: { fingerprint: KsFingerprint; concentration: number }[],
): Spectrum {
  const grid = defaultWavelengths();
  const n = grid.length;
  const weights = normalizeConcentrations(components.map((c) => c.concentration));

  // Validate every fingerprint up front: same shared grid, matching array
  // lengths, non-negative finite coefficients (K, S are physical quantities).
  for (const { fingerprint } of components) {
    assertDefaultGrid(fingerprint.wavelengths, "mixKubelkaMunk");
    if (fingerprint.k.length !== n || fingerprint.s.length !== n) {
      throw new Error(
        `mixKubelkaMunk: k/s arrays must have ${n} entries to match the ` +
          `wavelength grid, got k=${fingerprint.k.length}, s=${fingerprint.s.length}`,
      );
    }
    for (let i = 0; i < n; i++) {
      const ki = fingerprint.k[i]!;
      const si = fingerprint.s[i]!;
      if (!Number.isFinite(ki) || ki < 0 || !Number.isFinite(si) || si < 0) {
        throw new RangeError(
          `mixKubelkaMunk: K and S must be finite and non-negative, ` +
            `got K=${ki}, S=${si} at index ${i}`,
        );
      }
    }
  }

  const values = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    // K and S are intensive per-component properties; both add linearly
    // under concentration weighting (two-constant theory).
    let kMix = 0;
    let sMix = 0;
    for (let j = 0; j < components.length; j++) {
      const w = weights[j]!;
      const fp = components[j]!.fingerprint;
      kMix += w * fp.k[i]!;
      sMix += w * fp.s[i]!;
    }
    if (kMix <= 0) {
      values[i] = 1; // no absorption (incl. K = S = 0): white
    } else if (sMix <= 0) {
      values[i] = 0; // q = K/S → ∞: black
    } else {
      values[i] = koverSPointToReflectance(kMix / sMix);
    }
  }
  return createSpectrum(grid, values);
}

/**
 * Single-constant variant for engine comparison experiments (MASTER_PLAN
 * §1.4/§8): weights the K/S ratio directly,
 *   q_mix(λ) = Σ cᵢ qᵢ(λ),  R∞ from q_mix.
 *
 * Less physical than two-constant mixing — it implies K and S scale together
 * under dilution, which is only true for self-mixes — so {@link mixKubelkaMunk}
 * remains the production engine; this exists so both variants can be scored
 * against measured tint ladders. `kOverS` arrays must follow the shared
 * default grid (38 points).
 */
export function mixKoverS(
  entries: { kOverS: number[]; concentration: number }[],
): Spectrum {
  const grid = defaultWavelengths();
  const n = grid.length;
  const weights = normalizeConcentrations(entries.map((e) => e.concentration));

  for (const { kOverS } of entries) {
    if (kOverS.length !== n) {
      throw new Error(
        `mixKoverS: kOverS arrays must have ${n} entries to match the ` +
          `shared wavelength grid, got ${kOverS.length}`,
      );
    }
    for (const q of kOverS) {
      if (!Number.isFinite(q) || q < 0) {
        throw new RangeError(
          `mixKoverS: K/S values must be finite and non-negative, got ${q}`,
        );
      }
    }
  }

  const qMix = new Array<number>(n).fill(0);
  for (let j = 0; j < entries.length; j++) {
    const w = weights[j]!;
    const q = entries[j]!.kOverS;
    for (let i = 0; i < n; i++) {
      qMix[i] = qMix[i]! + w * q[i]!;
    }
  }
  return createSpectrum(grid, koverSToReflectance(qMix));
}
