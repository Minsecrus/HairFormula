/**
 * Hair Dye Strength (MASTER_PLAN §5, V0 scalar form).
 *
 * Artist-paint pigments have wildly different tinting strengths, and in
 * subtractive K-M mixing the stronger pigment overwhelms the weaker by its
 * ABSORPTION POWER: PB15 blue's K dwarfs PR209 red's across the whole
 * 550–700 nm band, so equal parts red+blue read as nearly pure blue (the
 * "抢色" phenomenon). Note that a per-pigment ΔE00-from-white parity metric
 * does NOT capture this — blue's tint ΔE is only ~1.3× red's while its
 * band-integrated absorption is many times larger; mixing dominance is
 * governed by K, not by single-tint ΔE.
 *
 * So the V0 scalar is the inverse band-integrated absorption:
 *
 *   strength_raw_i = mean_λ K_i(λ)          (380–750 nm, shared grid)
 *   s_i = (1 / strength_raw_i), normalized to mean 1 across the set
 *   effective_i = amount_i × s_i
 *
 * The weakest pigment is boosted, the strongest damped, and equal amounts
 * contribute comparably to K_mix(λ). This is the documented V0 single-scalar
 * approximation; the spectral/concentration/substrate-dependent upgrade
 * path (s_i(λ, c, b, p)) comes with real dye data.
 */
import { type KsFingerprint } from "./kubelkaMunk";

export interface StrengthSet {
  red: number;
  purple: number;
  blue: number;
}

/**
 * Calibrate strength scalars from the fingerprints: inverse band-integrated
 * absorption, normalized to mean 1.
 */
export function computeDyeStrengths(
  white: KsFingerprint,
  pigments: { red: KsFingerprint; purple: KsFingerprint; blue: KsFingerprint },
): StrengthSet {
  void white; // kept in the signature for the documented calibration contract

  const entries = (
    [
      ["red", pigments.red],
      ["purple", pigments.purple],
      ["blue", pigments.blue],
    ] as const
  ).map(([key, fp]) => {
    let sum = 0;
    for (let i = 0; i < fp.k.length; i++) sum += fp.k[i]!;
    return { key, meanK: sum / fp.k.length };
  });

  const inv = entries.map((e) => ({ key: e.key, s: 1 / e.meanK }));
  const mean = inv.reduce((a, e) => a + e.s, 0) / inv.length;
  const out = { red: 1, purple: 1, blue: 1 };
  for (const e of inv) {
    out[e.key] = e.s / mean;
  }
  return out;
}
