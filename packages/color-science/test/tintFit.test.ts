import { describe, expect, it } from "vitest";
import {
  mixKubelkaMunk,
  reflectanceToKoverS,
  type KsFingerprint,
} from "../src/kubelkaMunk";
import { createSpectrum, defaultWavelengths, idealWhite, type Spectrum } from "../src/spectrum";
import {
  fitTwoConstantFromTintLadder,
  predictTintReflectance,
  type TintLadderRung,
} from "../src/tintFit";

const GRID = defaultWavelengths(); // 380–750 nm @ 10 nm, 38 points
const N = GRID.length;

/**
 * Synthetic ground truth: a pigment with one smooth absorption band and one
 * smooth scattering feature, on the white scale S_w = 1. Chosen so every
 * wavelength is well conditioned (pigment absorption clearly above the
 * white's, scattering clearly distinguishable through the dilution series).
 */
function syntheticPigment(): KsFingerprint {
  return {
    wavelengths: [...GRID],
    k: GRID.map((w) => 0.25 + 2.5 * Math.exp(-(((w - 580) / 45) ** 2))),
    s: GRID.map((w) => 0.55 + 0.35 * Math.exp(-(((w - 460) / 70) ** 2))),
  };
}

/** White with flat R = 0.85: q_w = (1 − 0.85)² / (2·0.85) ≈ 0.0132. */
function syntheticWhiteReflectance(): Spectrum {
  return createSpectrum([...GRID], GRID.map(() => 0.85));
}

function syntheticWhiteFingerprint(): KsFingerprint {
  return {
    wavelengths: [...GRID],
    k: GRID.map(() => (0.15 * 0.15) / (2 * 0.85)),
    s: GRID.map(() => 1),
  };
}

/**
 * Synthesize a ladder rung with the production engine, i.e. exactly the
 * forward model the fit inverts: c·pigment + (1−c)·white.
 */
function synthesizeRung(
  pigment: KsFingerprint,
  white: KsFingerprint,
  pigmentFraction: number,
): Spectrum {
  return mixKubelkaMunk([
    { fingerprint: pigment, concentration: pigmentFraction },
    { fingerprint: white, concentration: 1 - pigmentFraction },
  ]);
}

/** LBNL-style ladder: masstone + 1:4 tint (c = 0.2) + 1:9 tint (c = 0.1). */
function synthesizeLadder(
  pigment: KsFingerprint,
  white: KsFingerprint,
): TintLadderRung[] {
  return [1, 0.2, 0.1].map((c) => ({
    pigmentFraction: c,
    reflectance: synthesizeRung(pigment, white, c),
  }));
}

function maxRelativeError(actual: number[], expected: number[]): number {
  let worst = 0;
  for (let i = 0; i < actual.length; i++) {
    worst = Math.max(worst, Math.abs(actual[i]! - expected[i]!) / expected[i]!);
  }
  return worst;
}

describe("fitTwoConstantFromTintLadder — synthetic recovery", () => {
  it("recovers known K(λ), S(λ) from an exact ladder (masstone + 1:4 + 1:9)", () => {
    const truth = syntheticPigment();
    const whiteR = syntheticWhiteReflectance();
    const ladder = synthesizeLadder(truth, syntheticWhiteFingerprint());

    const fit = fitTwoConstantFromTintLadder(ladder, whiteR);

    // Exact data → the fit should reproduce the parameters to optimizer
    // precision; 1e-3 relative is a generous bound on that.
    expect(maxRelativeError(fit.fingerprint.k, truth.k)).toBeLessThan(1e-3);
    expect(maxRelativeError(fit.fingerprint.s, truth.s)).toBeLessThan(1e-3);
    expect(fit.ladderRmse).toBeLessThan(1e-8);
    expect(fit.perWavelengthRmse).toHaveLength(N);
    for (const r of fit.perWavelengthRmse) {
      expect(r).toBeLessThan(1e-8);
    }
  });

  it("fixes the white scale as S_w = 1, K_w = q_w from the white masstone", () => {
    const truth = syntheticPigment();
    const whiteR = syntheticWhiteReflectance();
    const fit = fitTwoConstantFromTintLadder(
      synthesizeLadder(truth, syntheticWhiteFingerprint()),
      whiteR,
    );

    expect(fit.white.s).toEqual(GRID.map(() => 1));
    const qWhite = reflectanceToKoverS(whiteR);
    for (let i = 0; i < N; i++) {
      expect(fit.white.k[i]).toBeCloseTo(qWhite[i]!, 15);
    }
  });

  it("recovers a pigment against ideal white (q_w = 0)", () => {
    const truth = syntheticPigment();
    const ideal: KsFingerprint = {
      wavelengths: [...GRID],
      k: GRID.map(() => 0),
      s: GRID.map(() => 1),
    };
    const fit = fitTwoConstantFromTintLadder(
      synthesizeLadder(truth, ideal),
      idealWhite(),
    );
    expect(maxRelativeError(fit.fingerprint.k, truth.k)).toBeLessThan(1e-3);
    expect(maxRelativeError(fit.fingerprint.s, truth.s)).toBeLessThan(1e-3);
    expect(fit.ladderRmse).toBeLessThan(1e-8);
  });

  it("still recovers the masstone K/S ratio under ±0.2% reflectance noise", () => {
    const truth = syntheticPigment();
    const whiteFp = syntheticWhiteFingerprint();
    // Deterministic pseudo-noise, amplitude 2e-3, zero-mean-ish.
    const noise = (i: number, rung: number): number =>
      2e-3 * Math.sin(i * 12.9898 + rung * 78.233);
    const ladder = synthesizeLadder(truth, whiteFp).map((rung, rungIdx) => ({
      pigmentFraction: rung.pigmentFraction,
      reflectance: createSpectrum(
        [...GRID],
        rung.reflectance.values.map((r, i) =>
          Math.min(1, Math.max(1e-4, r + noise(i, rungIdx))),
        ),
      ),
    }));

    const fit = fitTwoConstantFromTintLadder(ladder, syntheticWhiteReflectance());

    // The residual should be at the noise level, not above it.
    expect(fit.ladderRmse).toBeLessThan(4e-3);
    // K/S at masstone concentration is the physically meaningful quantity;
    // 2e-3 reflectance noise should not move it by more than a few percent.
    for (let i = 0; i < N; i++) {
      const qFit = fit.fingerprint.k[i]! / fit.fingerprint.s[i]!;
      const qTrue = truth.k[i]! / truth.s[i]!;
      expect(Math.abs(qFit - qTrue) / qTrue).toBeLessThan(0.05);
    }
  });

  it("predictTintReflectance reproduces rungs synthesized by the engine", () => {
    const truth = syntheticPigment();
    const whiteFp = syntheticWhiteFingerprint();
    const fit = fitTwoConstantFromTintLadder(
      synthesizeLadder(truth, whiteFp),
      syntheticWhiteReflectance(),
    );
    for (const c of [1, 0.5, 0.2, 0.1, 0.02]) {
      const expected = synthesizeRung(truth, whiteFp, c);
      const predicted = predictTintReflectance(fit.fingerprint, fit.white, c);
      for (let i = 0; i < N; i++) {
        expect(predicted.values[i]).toBeCloseTo(expected.values[i]!, 6);
      }
    }
  });

  it("replicates at the same fraction are accepted and improve the equation count", () => {
    const truth = syntheticPigment();
    const whiteFp = syntheticWhiteFingerprint();
    const ladder = synthesizeLadder(truth, whiteFp);
    const withReplicates = [...ladder, ...synthesizeLadder(truth, whiteFp)];
    const fit = fitTwoConstantFromTintLadder(withReplicates, syntheticWhiteReflectance());
    expect(fit.ladderRmse).toBeLessThan(1e-8);
    expect(maxRelativeError(fit.fingerprint.k, truth.k)).toBeLessThan(1e-3);
  });

  it("validates its inputs", () => {
    const whiteR = syntheticWhiteReflectance();
    const rung: TintLadderRung = {
      pigmentFraction: 1,
      reflectance: synthesizeRung(syntheticPigment(), syntheticWhiteFingerprint(), 1),
    };

    // Empty ladder.
    expect(() => fitTwoConstantFromTintLadder([], whiteR)).toThrow(/at least one rung/);
    // Fraction outside (0, 1].
    expect(() =>
      fitTwoConstantFromTintLadder([{ ...rung, pigmentFraction: 0 }], whiteR),
    ).toThrow(RangeError);
    expect(() =>
      fitTwoConstantFromTintLadder([{ ...rung, pigmentFraction: 1.5 }], whiteR),
    ).toThrow(RangeError);
    // White off the shared grid.
    expect(() =>
      fitTwoConstantFromTintLadder(
        [rung],
        createSpectrum(GRID.map((w) => w + 5), GRID.map(() => 0.85)),
      ),
    ).toThrow(/shared/);
    // Rung off the shared grid.
    expect(() =>
      fitTwoConstantFromTintLadder(
        [
          {
            pigmentFraction: 1,
            reflectance: createSpectrum(GRID.slice(0, 20), GRID.slice(0, 20).map(() => 0.5)),
          },
        ],
        whiteR,
      ),
    ).toThrow(/shared/);
    // Non-finite rung values.
    expect(() =>
      fitTwoConstantFromTintLadder(
        [
          {
            pigmentFraction: 1,
            reflectance: createSpectrum([...GRID], GRID.map(() => Number.NaN)),
          },
        ],
        whiteR,
      ),
    ).toThrow(RangeError);
  });

  it("predictTintReflectance validates the fraction", () => {
    const fit = fitTwoConstantFromTintLadder(
      synthesizeLadder(syntheticPigment(), syntheticWhiteFingerprint()),
      syntheticWhiteReflectance(),
    );
    expect(() => predictTintReflectance(fit.fingerprint, fit.white, -0.1)).toThrow(
      RangeError,
    );
    expect(() => predictTintReflectance(fit.fingerprint, fit.white, 1.1)).toThrow(
      RangeError,
    );
  });
});
