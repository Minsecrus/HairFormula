import { describe, expect, it } from "vitest";
import {
  koverSToReflectance,
  mixKoverS,
  mixKubelkaMunk,
  reflectanceToKoverS,
  type KsFingerprint,
} from "../src/kubelkaMunk";
import { defaultWavelengths } from "../src/spectrum";

const GRID = defaultWavelengths();
const N = GRID.length; // 38 points, 380–750 nm @ 10 nm

/** Build a fingerprint on the shared grid from per-index coefficient functions. */
function fingerprint(k: (i: number) => number, s: (i: number) => number): KsFingerprint {
  return {
    wavelengths: [...GRID],
    k: GRID.map((_, i) => k(i)),
    s: GRID.map((_, i) => s(i)),
  };
}

describe("reflectanceToKoverS ↔ koverSToReflectance", () => {
  it("roundtrips the full range R ∈ {0.001 … 0.999}", () => {
    const values = Array.from({ length: 999 }, (_, i) => (i + 1) / 1000);
    // The transform is element-wise; wavelengths only satisfy the Spectrum shape.
    const spectrum = { wavelengths: values.map((_, i) => i), values };
    const roundtrip = koverSToReflectance(reflectanceToKoverS(spectrum));
    for (let i = 0; i < values.length; i++) {
      expect(roundtrip[i]).toBeCloseTo(values[i]!, 12);
    }
  });

  it("matches the definition at a known point: R = 0.5 → q = 0.25", () => {
    const q = reflectanceToKoverS({ wavelengths: [500], values: [0.5] });
    expect(q[0]).toBeCloseTo(0.25, 15);
  });

  it("clamps R → 0 to a finite q (q → ∞ is not representable)", () => {
    const q = reflectanceToKoverS({ wavelengths: [500], values: [0] });
    expect(Number.isFinite(q[0])).toBe(true);
    // R clamped to 1e-6: q = (1 − 1e-6)² / 2e-6 ≈ 5e5.
    expect(q[0]!).toBeGreaterThan(1e5);
    expect(q[0]!).toBeLessThan(1e6);
    // Inverting the clamped value lands near the clamp, not at 0.
    expect(koverSToReflectance(q)[0]).toBeCloseTo(1e-6, 9);
  });

  it("maps q = 0 to R = 1 exactly (ideal white)", () => {
    expect(koverSToReflectance([0])).toEqual([1]);
  });

  it("rejects negative or NaN q", () => {
    expect(() => koverSToReflectance([-0.1])).toThrow(RangeError);
    expect(() => koverSToReflectance([Number.NaN])).toThrow(RangeError);
  });
});

describe("mixKubelkaMunk (two-constant)", () => {
  it("mixing a pigment with itself returns its own spectrum at any split", () => {
    const pigment = fingerprint(
      (i) => 0.3 + 0.02 * i,
      (i) => 1.2 - 0.01 * i,
    );
    const alone = mixKubelkaMunk([{ fingerprint: pigment, concentration: 1 }]);

    // Dyadic split is bit-exact: 0.5·K + 0.5·K === K in IEEE-754.
    const half = mixKubelkaMunk([
      { fingerprint: pigment, concentration: 0.5 },
      { fingerprint: pigment, concentration: 0.5 },
    ]);
    expect(half.values).toEqual(alone.values);

    // Arbitrary splits agree to within floating-point accumulation error.
    for (const c of [0.1, 0.37, 0.9]) {
      const mixed = mixKubelkaMunk([
        { fingerprint: pigment, concentration: c },
        { fingerprint: pigment, concentration: 1 - c },
      ]);
      for (let i = 0; i < N; i++) {
        expect(mixed.values[i]).toBeCloseTo(alone.values[i]!, 12);
      }
    }
  });

  it("diluting a dark pigment with ideal white strictly raises R at every wavelength", () => {
    const dark = fingerprint(
      (i) => 3 + 0.05 * i,
      (i) => 0.8 + 0.005 * i,
    );
    const white = fingerprint(
      () => 0, // ideal white: K = 0, S > 0
      () => 1,
    );
    const darkAlone = mixKubelkaMunk([{ fingerprint: dark, concentration: 1 }]);
    for (const cWhite of [0.25, 0.5, 0.9]) {
      const diluted = mixKubelkaMunk([
        { fingerprint: dark, concentration: 1 - cWhite },
        { fingerprint: white, concentration: cWhite },
      ]);
      for (let i = 0; i < N; i++) {
        expect(diluted.values[i]!).toBeGreaterThan(darkAlone.values[i]!);
        expect(diluted.values[i]!).toBeLessThanOrEqual(1);
      }
    }
  });

  it("normalizes concentrations internally (2:6 ≡ 0.25:0.75, bit-exact)", () => {
    const a = fingerprint(
      (i) => 0.5 + 0.03 * i,
      () => 1,
    );
    const b = fingerprint(
      () => 0.2,
      (i) => 0.5 + 0.02 * i,
    );
    const raw = mixKubelkaMunk([
      { fingerprint: a, concentration: 2 },
      { fingerprint: b, concentration: 6 },
    ]);
    const normalized = mixKubelkaMunk([
      { fingerprint: a, concentration: 0.25 },
      { fingerprint: b, concentration: 0.75 },
    ]);
    expect(raw.values).toEqual(normalized.values);
  });

  it("throws on wavelength-grid mismatch", () => {
    const good = fingerprint(
      () => 1,
      () => 1,
    );
    const shifted: KsFingerprint = {
      wavelengths: GRID.map((w) => w + 10), // 390–760 nm
      k: GRID.map(() => 1),
      s: GRID.map(() => 1),
    };
    expect(() =>
      mixKubelkaMunk([
        { fingerprint: good, concentration: 1 },
        { fingerprint: shifted, concentration: 1 },
      ]),
    ).toThrow(/grid/);

    const short: KsFingerprint = {
      wavelengths: GRID.slice(0, 20),
      k: GRID.slice(0, 20).map(() => 1),
      s: GRID.slice(0, 20).map(() => 1),
    };
    expect(() => mixKubelkaMunk([{ fingerprint: short, concentration: 1 }])).toThrow(/grid/);
  });

  it("throws on k/s length mismatch and negative coefficients", () => {
    const badLength: KsFingerprint = {
      wavelengths: [...GRID],
      k: GRID.slice(0, 10).map(() => 1),
      s: GRID.map(() => 1),
    };
    expect(() => mixKubelkaMunk([{ fingerprint: badLength, concentration: 1 }])).toThrow();

    const negative = fingerprint(
      (i) => (i === 5 ? -1 : 1),
      () => 1,
    );
    expect(() => mixKubelkaMunk([{ fingerprint: negative, concentration: 1 }])).toThrow(
      RangeError,
    );
  });

  it("validates concentrations", () => {
    const p = fingerprint(
      () => 1,
      () => 1,
    );
    expect(() => mixKubelkaMunk([])).toThrow();
    expect(() => mixKubelkaMunk([{ fingerprint: p, concentration: -0.5 }])).toThrow(
      RangeError,
    );
    expect(() =>
      mixKubelkaMunk([
        { fingerprint: p, concentration: 0 },
        { fingerprint: p, concentration: 0 },
      ]),
    ).toThrow(RangeError);
  });

  it("keeps R in [0, 1] for extreme but valid inputs", () => {
    const cases: KsFingerprint[] = [
      fingerprint(
        () => 1e6,
        () => 1e-3,
      ), // near-black
      fingerprint(
        () => 0,
        () => 1e6,
      ), // pure scatterer
      fingerprint(
        () => 1e-9,
        () => 1e-9,
      ), // near-transparent
    ];
    for (const fp of cases) {
      const r = mixKubelkaMunk([{ fingerprint: fp, concentration: 1 }]);
      for (const v of r.values) {
        expect(Number.isNaN(v)).toBe(false);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("treats K = S = 0 as white and K > 0, S = 0 as black", () => {
    const empty = fingerprint(
      () => 0,
      () => 0,
    );
    const white = mixKubelkaMunk([{ fingerprint: empty, concentration: 1 }]);
    expect(white.values.every((v) => v === 1)).toBe(true);

    const noScatter = fingerprint(
      () => 1,
      () => 0,
    );
    const black = mixKubelkaMunk([{ fingerprint: noScatter, concentration: 1 }]);
    expect(black.values.every((v) => v === 0)).toBe(true);
  });

  it("returns spectra on the shared default wavelength grid", () => {
    const p = fingerprint(
      () => 1,
      () => 1,
    );
    const r = mixKubelkaMunk([{ fingerprint: p, concentration: 1 }]);
    expect(r.wavelengths).toEqual(GRID);
    expect(r.values).toHaveLength(N);
  });
});

describe("mixKoverS (single-constant variant)", () => {
  it("weights K/S directly: q_mix = Σ cᵢ qᵢ", () => {
    const r = mixKoverS([
      { kOverS: GRID.map(() => 1), concentration: 1 },
      { kOverS: GRID.map(() => 3), concentration: 1 },
    ]);
    // (1 + 3) / 2 = 2 exactly; compare against the scalar inverse transform.
    const expected = koverSToReflectance([2])[0]!;
    for (const v of r.values) {
      expect(v).toBeCloseTo(expected, 15);
    }
  });

  it("mixing a pigment with itself returns its own spectrum", () => {
    const q = GRID.map((_, i) => 0.2 + 0.05 * i);
    const alone = mixKoverS([{ kOverS: q, concentration: 1 }]);
    const half = mixKoverS([
      { kOverS: q, concentration: 0.5 },
      { kOverS: q, concentration: 0.5 },
    ]);
    expect(half.values).toEqual(alone.values);

    const uneven = mixKoverS([
      { kOverS: q, concentration: 1 },
      { kOverS: q, concentration: 2 },
    ]);
    for (let i = 0; i < N; i++) {
      expect(uneven.values[i]).toBeCloseTo(alone.values[i]!, 12);
    }
  });

  it("diluting with white (q = 0) strictly raises R at every wavelength", () => {
    const q = GRID.map((_, i) => 0.5 + 0.02 * i);
    const alone = mixKoverS([{ kOverS: q, concentration: 1 }]);
    const diluted = mixKoverS([
      { kOverS: q, concentration: 1 },
      { kOverS: GRID.map(() => 0), concentration: 3 },
    ]);
    for (let i = 0; i < N; i++) {
      expect(diluted.values[i]!).toBeGreaterThan(alone.values[i]!);
      expect(diluted.values[i]!).toBeLessThanOrEqual(1);
    }
  });

  it("keeps R in [0, 1] for extreme inputs", () => {
    const r = mixKoverS([
      { kOverS: GRID.map(() => 1e12), concentration: 1 },
      { kOverS: GRID.map(() => 0), concentration: 1 },
    ]);
    for (const v of r.values) {
      expect(Number.isNaN(v)).toBe(false);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("validates input", () => {
    const q = GRID.map(() => 1);
    expect(() => mixKoverS([{ kOverS: q.slice(0, 10), concentration: 1 }])).toThrow();
    expect(() => mixKoverS([{ kOverS: q.map(() => -1), concentration: 1 }])).toThrow(
      RangeError,
    );
    expect(() => mixKoverS([{ kOverS: q, concentration: 0 }])).toThrow(RangeError);
    expect(() => mixKoverS([])).toThrow();
  });
});
