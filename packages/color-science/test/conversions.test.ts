/**
 * Conversions test suite (MASTER_PLAN §17, Step 1):
 * spectrum → XYZ, XYZ ↔ Lab, Lab ↔ LCh, against the embedded CIE tables.
 *
 * Reference values below were cross-computed with the CIE 15:2004 formulas
 * from the official CIE data files (see src/data/cie.ts) and verified
 * against the `colour-science` reference implementation.
 */
import { describe, expect, it } from "vitest";
import { CIE_2DEG_D65_TABLE } from "../src/data/cie";
import { labToLch, labToXyz, lchToLab, xyzToLab, type Lab } from "../src/lab";
import { createSpectrum, defaultWavelengths, idealBlack, idealWhite } from "../src/spectrum";
import { spectrumToXyz, XYZ_D65_WHITE, type XYZ } from "../src/xyz";

/** Reflectance spectrum that is flat at `r` across the whole shared grid. */
function flatSpectrum(r: number) {
  const wavelengths = defaultWavelengths();
  return createSpectrum(wavelengths, wavelengths.map(() => r));
}

describe("embedded CIE tables", () => {
  it("cover the shared 380–750 nm @ 10 nm grid (38 rows)", () => {
    expect(CIE_2DEG_D65_TABLE.length).toBe(38);
    const grid = defaultWavelengths();
    for (let i = 0; i < grid.length; i++) {
      expect(CIE_2DEG_D65_TABLE[i]?.wavelengthNm).toBe(grid[i]);
    }
  });

  it("match published anchor values", () => {
    const at = (nm: number) =>
      CIE_2DEG_D65_TABLE.find((row) => row.wavelengthNm === nm)!;
    // D65 is normalized to 100 at 560 nm by definition (ISO/CIE 11664-2).
    expect(at(560).d65Spd).toBe(100);
    // Spot-checks against CIE 15:2004 Tables T.1 / T.2.
    expect(at(380).d65Spd).toBe(49.9755);
    expect(at(650).d65Spd).toBe(80.0268);
    expect(at(450).zBar).toBe(1.77211);
    expect(at(600).xBar).toBe(1.0622);
    expect(at(500).yBar).toBe(0.323);
  });
});

describe("spectrumToXyz", () => {
  it("rejects spectra that are not on the shared grid", () => {
    expect(() => spectrumToXyz(createSpectrum([400, 500], [0.5, 0.5]))).toThrow();
  });

  it("maps ideal white to Y = 100", () => {
    const xyz = spectrumToXyz(idealWhite());
    expect(Math.abs(xyz.y - 100)).toBeLessThan(1e-9);
  });

  it("maps ideal black to (0, 0, 0)", () => {
    const xyz = spectrumToXyz(idealBlack());
    expect(xyz).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("produces the D65 illuminant white point from the tables", () => {
    const white = spectrumToXyz(idealWhite());
    // The white point constant must be the table-derived illuminant XYZ.
    expect(Math.abs(XYZ_D65_WHITE.x - white.x)).toBeLessThan(1e-9);
    expect(Math.abs(XYZ_D65_WHITE.y - white.y)).toBeLessThan(1e-9);
    expect(Math.abs(XYZ_D65_WHITE.z - white.z)).toBeLessThan(1e-9);

    // Comparison against the canonical CIE D65 white (95.047, 100, 108.883).
    // That reference is the 1 nm / 360–830 nm integral of the same official
    // CIE data; on the 380–750 nm @ 10 nm grid the tables yield
    // (95.0164, 100, 108.8134) — verified against the official CIE 1 nm CSVs
    // and the colour-science reference implementation. X and Y are within
    // ±0.05 of the reference; Z sits 0.070 below it, purely from grid
    // truncation, so its tolerance is widened accordingly and the exact
    // grid value is pinned for regression.
    expect(Math.abs(XYZ_D65_WHITE.x - 95.047)).toBeLessThan(0.05);
    expect(Math.abs(XYZ_D65_WHITE.y - 100)).toBeLessThan(1e-9);
    expect(Math.abs(XYZ_D65_WHITE.z - 108.883)).toBeLessThan(0.1);
    expect(XYZ_D65_WHITE.x).toBeCloseTo(95.0164090791, 8);
    expect(XYZ_D65_WHITE.z).toBeCloseTo(108.8133547169, 8);
  });

  it("reproduces the D65 chromaticity x ≈ 0.3127, y ≈ 0.3290", () => {
    const white = spectrumToXyz(idealWhite());
    const sum = white.x + white.y + white.z;
    const x = white.x / sum;
    const y = white.y / sum;
    expect(Math.abs(x - 0.3127)).toBeLessThan(0.0005);
    expect(Math.abs(y - 0.3290)).toBeLessThan(0.0005);
    // Pinned table-derived values for regression.
    expect(x).toBeCloseTo(0.3127291016, 8);
    expect(y).toBeCloseTo(0.3291316781, 8);
  });
});

describe("xyzToLab", () => {
  it("maps ideal white to Lab (100, 0, 0)", () => {
    const lab = xyzToLab(spectrumToXyz(idealWhite()));
    // Ratios to the white point are identically 1, so this is exact.
    expect(Math.abs(lab.l - 100)).toBeLessThan(1e-9);
    expect(Math.abs(lab.a)).toBeLessThan(1e-9);
    expect(Math.abs(lab.b)).toBeLessThan(1e-9);
  });

  it("maps ideal black to L* = 0", () => {
    const lab = xyzToLab(spectrumToXyz(idealBlack()));
    expect(Math.abs(lab.l)).toBeLessThan(1e-9);
    expect(Math.abs(lab.a)).toBeLessThan(1e-9);
    expect(Math.abs(lab.b)).toBeLessThan(1e-9);
  });

  it("maps a flat 50% gray spectrum to L* ≈ 76.07, neutral", () => {
    // CIELAB: L* = 116·cbrt(0.5) − 16 = 76.0693. (The often-quoted
    // "gray → L* 53.6" sanity value belongs to 21.6 % reflectance, i.e.
    // sRGB 50 % display gray after linearization — checked below.)
    const lab = xyzToLab(spectrumToXyz(flatSpectrum(0.5)));
    expect(Math.abs(lab.l - 76.0693)).toBeLessThan(0.001);
    expect(Math.abs(lab.a)).toBeLessThan(1e-9);
    expect(Math.abs(lab.b)).toBeLessThan(1e-9);
  });

  it("maps a flat 21.58% gray spectrum to L* ≈ 53.6", () => {
    const lab = xyzToLab(spectrumToXyz(flatSpectrum(0.2158)));
    expect(Math.abs(lab.l - 53.6)).toBeLessThan(0.5);
    expect(Math.abs(lab.a)).toBeLessThan(1e-9);
    expect(Math.abs(lab.b)).toBeLessThan(1e-9);
  });

  it("matches a cross-computed CIE 15:2004 reference triple", () => {
    // Reference computed independently from the official CIE tables:
    // XYZ (25, 40, 30) → Lab (69.4695, -48.0096, 17.1916).
    const lab = xyzToLab({ x: 25, y: 40, z: 30 });
    expect(lab.l).toBeCloseTo(69.4695308, 6);
    expect(lab.a).toBeCloseTo(-48.0095716, 6);
    expect(lab.b).toBeCloseTo(17.1916269, 6);
  });
});

describe("Lab ↔ XYZ roundtrip", () => {
  it("roundtrips a gamut-spanning grid of Lab colours below 1e-6", () => {
    const lValues = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95];
    const abValues = [-80, -40, 0, 40, 80];
    let tested = 0;
    let maxError = 0;
    for (const l of lValues) {
      for (const a of abValues) {
        for (const b of abValues) {
          const lab: Lab = { l, a, b };
          const roundtripped = xyzToLab(labToXyz(lab));
          const error = Math.max(
            Math.abs(roundtripped.l - lab.l),
            Math.abs(roundtripped.a - lab.a),
            Math.abs(roundtripped.b - lab.b),
          );
          maxError = Math.max(maxError, error);
          tested++;
        }
      }
    }
    expect(tested).toBeGreaterThanOrEqual(20);
    expect(maxError).toBeLessThan(1e-6);
  });

  it("roundtrips XYZ → Lab → XYZ as well", () => {
    const samples: XYZ[] = [
      { x: 95.0164090791, y: 100, z: 108.8133547169 },
      { x: 25, y: 40, z: 30 },
      { x: 0.4, y: 0.2, z: 0.9 }, // below the ε branch boundary in Y
      { x: 41.24, y: 21.26, z: 1.93 }, // sRGB red primaries-ish
    ];
    for (const xyz of samples) {
      const roundtripped = labToXyz(xyzToLab(xyz));
      expect(Math.abs(roundtripped.x - xyz.x)).toBeLessThan(1e-6);
      expect(Math.abs(roundtripped.y - xyz.y)).toBeLessThan(1e-6);
      expect(Math.abs(roundtripped.z - xyz.z)).toBeLessThan(1e-6);
    }
  });
});

describe("Lab ↔ LCh", () => {
  it("keeps hue in [0, 360)", () => {
    for (const a of [-10, 0, 10]) {
      for (const b of [-10, 0, 10]) {
        const { h } = labToLch({ l: 50, a, b });
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(360);
      }
    }
    // Quadrant anchors.
    expect(labToLch({ l: 50, a: 1, b: 0 }).h).toBeCloseTo(0, 9);
    expect(labToLch({ l: 50, a: 0, b: 1 }).h).toBeCloseTo(90, 9);
    expect(labToLch({ l: 50, a: -1, b: 0 }).h).toBeCloseTo(180, 9);
    expect(labToLch({ l: 50, a: 0, b: -1 }).h).toBeCloseTo(270, 9);
  });

  it("roundtrips Lab → LCh → Lab below 1e-9", () => {
    let maxError = 0;
    for (const l of [10, 50, 90]) {
      for (const a of [-80, -40, 0, 40, 80]) {
        for (const b of [-80, -40, 0, 40, 80]) {
          const lab: Lab = { l, a, b };
          const roundtripped = lchToLab(labToLch(lab));
          const error = Math.max(
            Math.abs(roundtripped.l - lab.l),
            Math.abs(roundtripped.a - lab.a),
            Math.abs(roundtripped.b - lab.b),
          );
          maxError = Math.max(maxError, error);
        }
      }
    }
    expect(maxError).toBeLessThan(1e-9);
  });

  it("roundtrips LCh → Lab → LCh below 1e-9, including hue wrap-around", () => {
    const hues = [0, 0.1, 45, 90, 179.9, 180, 270, 359.9];
    for (const h of hues) {
      const lch = { l: 60, c: 35, h };
      const roundtripped = labToLch(lchToLab(lch));
      expect(Math.abs(roundtripped.l - lch.l)).toBeLessThan(1e-9);
      expect(Math.abs(roundtripped.c - lch.c)).toBeLessThan(1e-9);
      expect(Math.abs(roundtripped.h - lch.h)).toBeLessThan(1e-9);
    }
    // Out-of-range hue input is normalized modulo 360.
    const wrapped = lchToLab({ l: 50, c: 20, h: -90 });
    const reference = lchToLab({ l: 50, c: 20, h: 270 });
    expect(wrapped.a).toBeCloseTo(reference.a, 12);
    expect(wrapped.b).toBeCloseTo(reference.b, 12);
  });
});
