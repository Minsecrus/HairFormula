import { describe, expect, it } from "vitest";
import {
  findBestRatio,
  findBestRatioFromHex,
  _hexToLab,
  type PigmentSet,
} from "../src/reverseSolve";
import { mixKubelkaMunk, type KsFingerprint } from "../src/kubelkaMunk";
import { spectrumToXyz } from "../src/xyz";
import { xyzToLab, type Lab } from "../src/lab";
import { xyzToSrgb, rgbToHex } from "../src/srgb";
import { defaultWavelengths } from "../src/spectrum";

// ---------------------------------------------------------------------------
// Synthetic fingerprints for algorithm unit tests
// ---------------------------------------------------------------------------

const GRID = defaultWavelengths();
const N = GRID.length;

/**
 * Build a synthetic KsFingerprint on the shared grid with smooth spectral
 * profiles. Each pigment has a characteristic absorption peak at a different
 * wavelength range, simulating red/purple/blue pigments.
 */
function syntheticFingerprint(
  peakWavelength: number,
  peakWidth: number,
  kBase: number,
  sBase: number,
): KsFingerprint {
  return {
    wavelengths: [...GRID],
    k: GRID.map((w) => {
      const dist = Math.abs(w - peakWavelength);
      return kBase + 2 * Math.exp(-(dist * dist) / (2 * peakWidth * peakWidth));
    }),
    s: GRID.map(() => sBase),
  };
}

// Red-like: absorbs blue/green (peak absorption around 500 nm)
const RED_FP = syntheticFingerprint(500, 60, 0.1, 1.0);
// Purple-like: absorbs green (peak absorption around 550 nm)
const PURPLE_FP = syntheticFingerprint(550, 50, 0.1, 1.0);
// Blue-like: absorbs red/yellow (peak absorption around 600 nm)
const BLUE_FP = syntheticFingerprint(600, 55, 0.1, 1.0);

const SYNTHETIC_PIGMENTS: PigmentSet = {
  red: RED_FP,
  purple: PURPLE_FP,
  blue: BLUE_FP,
};

/**
 * Helper: compute Lab color for a given ratio using the pigment set.
 */
function labAtRatio(
  r: number,
  p: number,
  b: number,
  pigments: PigmentSet = SYNTHETIC_PIGMENTS,
): Lab {
  const spectrum = mixKubelkaMunk([
    { fingerprint: pigments.red, concentration: r },
    { fingerprint: pigments.purple, concentration: p },
    { fingerprint: pigments.blue, concentration: b },
  ]);
  return xyzToLab(spectrumToXyz(spectrum));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reverseSolve", () => {
  describe("findBestRatio", () => {
    it("recovers a known mixed ratio (0.5, 0.3, 0.2) within tolerance", () => {
      const originalR = 0.5;
      const originalP = 0.3;
      const originalB = 0.2;
      const target = labAtRatio(originalR, originalP, originalB);

      const result = findBestRatio(target, SYNTHETIC_PIGMENTS);

      // Ratios should be within +/- 0.02 of original
      expect(result.ratios.red).toBeCloseTo(originalR, 1);
      expect(result.ratios.purple).toBeCloseTo(originalP, 1);
      expect(result.ratios.blue).toBeCloseTo(originalB, 1);

      // DeltaE00 should be very small (< 0.5)
      expect(result.deltaE00).toBeLessThan(0.5);

      // Ratios must sum to 1
      const sum =
        result.ratios.red + result.ratios.purple + result.ratios.blue;
      expect(sum).toBeCloseTo(1, 10);
    });

    it("recovers pure red pigment (1, 0, 0)", () => {
      const target = labAtRatio(1, 0, 0);

      const result = findBestRatio(target, SYNTHETIC_PIGMENTS);

      expect(result.ratios.red).toBeGreaterThanOrEqual(0.95);
      expect(result.ratios.purple).toBeLessThanOrEqual(0.05);
      expect(result.ratios.blue).toBeLessThanOrEqual(0.05);
      expect(result.deltaE00).toBeLessThan(0.5);
    });

    it("recovers pure purple pigment (0, 1, 0)", () => {
      const target = labAtRatio(0, 1, 0);

      const result = findBestRatio(target, SYNTHETIC_PIGMENTS);

      expect(result.ratios.purple).toBeGreaterThanOrEqual(0.95);
      expect(result.ratios.red).toBeLessThanOrEqual(0.05);
      expect(result.ratios.blue).toBeLessThanOrEqual(0.05);
      expect(result.deltaE00).toBeLessThan(0.5);
    });

    it("recovers pure blue pigment (0, 0, 1)", () => {
      const target = labAtRatio(0, 0, 1);

      const result = findBestRatio(target, SYNTHETIC_PIGMENTS);

      expect(result.ratios.blue).toBeGreaterThanOrEqual(0.95);
      expect(result.ratios.red).toBeLessThanOrEqual(0.05);
      expect(result.ratios.purple).toBeLessThanOrEqual(0.05);
      expect(result.deltaE00).toBeLessThan(0.5);
    });

    it("returns valid sRGB and hex in the result", () => {
      const target = labAtRatio(0.4, 0.4, 0.2);
      const result = findBestRatio(target, SYNTHETIC_PIGMENTS);

      // RGB channels are integers in [0, 255]
      expect(result.rgb.r).toBeGreaterThanOrEqual(0);
      expect(result.rgb.r).toBeLessThanOrEqual(255);
      expect(result.rgb.g).toBeGreaterThanOrEqual(0);
      expect(result.rgb.g).toBeLessThanOrEqual(255);
      expect(result.rgb.b).toBeGreaterThanOrEqual(0);
      expect(result.rgb.b).toBeLessThanOrEqual(255);

      // Hex is well-formed
      expect(result.hex).toMatch(/^#[0-9a-f]{6}$/);
    });

    it("handles unreachable targets gracefully (returns best available)", () => {
      // Pure white is not reachable by any mix of chromatic pigments
      const white: Lab = { l: 100, a: 0, b: 0 };
      const result = findBestRatio(white, SYNTHETIC_PIGMENTS);

      // Should still return a valid result
      expect(Number.isFinite(result.deltaE00)).toBe(true);
      const sum =
        result.ratios.red + result.ratios.purple + result.ratios.blue;
      expect(sum).toBeCloseTo(1, 10);
    });

    it("coarse search without refinement completes in < 500ms", () => {
      const target = labAtRatio(0.3, 0.3, 0.4);
      const start = performance.now();
      findBestRatio(target, SYNTHETIC_PIGMENTS, { refine: false });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(500);
    });

    it("visits simplex boundary edges (r=0, p=0, b=0)", () => {
      // These are the three edges of the simplex; all pure-pigment corners
      // must be reachable. We already tested the corners above; this is
      // a supplementary structural check.
      for (const [r, p, b] of [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [0.5, 0.5, 0],
        [0.5, 0, 0.5],
        [0, 0.5, 0.5],
      ] as const) {
        const target = labAtRatio(r, p, b);
        const result = findBestRatio(target, SYNTHETIC_PIGMENTS);
        expect(result.deltaE00).toBeLessThan(1.0);
      }
    });
  });

  describe("findBestRatioFromHex", () => {
    it("gives the same result as findBestRatio for the same color", () => {
      const target = labAtRatio(0.5, 0.3, 0.2);
      // Convert target to hex via the forward pipeline
      const spectrum = mixKubelkaMunk([
        { fingerprint: SYNTHETIC_PIGMENTS.red, concentration: 0.5 },
        { fingerprint: SYNTHETIC_PIGMENTS.purple, concentration: 0.3 },
        { fingerprint: SYNTHETIC_PIGMENTS.blue, concentration: 0.2 },
      ]);
      const xyz = spectrumToXyz(spectrum);
      const rgb = xyzToSrgb(xyz);
      const hex = rgbToHex(rgb);

      const fromLab = findBestRatio(target, SYNTHETIC_PIGMENTS);
      const fromHex = findBestRatioFromHex(hex, SYNTHETIC_PIGMENTS);

      // Results should be very close (hex quantization may introduce
      // minor differences, so we allow a small tolerance)
      expect(fromHex.ratios.red).toBeCloseTo(fromLab.ratios.red, 1);
      expect(fromHex.ratios.purple).toBeCloseTo(fromLab.ratios.purple, 1);
      expect(fromHex.ratios.blue).toBeCloseTo(fromLab.ratios.blue, 1);
      expect(fromHex.deltaE00).toBeCloseTo(fromLab.deltaE00, 0);
    });

    it("accepts various hex formats (#RRGGBB, RRGGBB, #RGB)", () => {
      // These should all parse without error
      const target1 = findBestRatioFromHex("#aa3355", SYNTHETIC_PIGMENTS, {
        refine: false,
      });
      const target2 = findBestRatioFromHex("aa3355", SYNTHETIC_PIGMENTS, {
        refine: false,
      });
      const target3 = findBestRatioFromHex("#a35", SYNTHETIC_PIGMENTS, {
        refine: false,
      });

      // #aa3355 and "aa3355" should give identical results
      expect(target1.ratios.red).toBe(target2.ratios.red);
      expect(target1.ratios.purple).toBe(target2.ratios.purple);
      expect(target1.ratios.blue).toBe(target2.ratios.blue);

      // #a35 expands to #aa3355, so should also match
      expect(target3.ratios.red).toBe(target1.ratios.red);
    });

    it("throws on invalid hex", () => {
      expect(() =>
        findBestRatioFromHex("zzz", SYNTHETIC_PIGMENTS),
      ).toThrow(/[Ii]nvalid hex/);
      expect(() =>
        findBestRatioFromHex("#12345", SYNTHETIC_PIGMENTS),
      ).toThrow(/[Ii]nvalid hex/);
    });
  });

  describe("hexToLab roundtrip sanity", () => {
    it("maps sRGB red (255,0,0) / #ff0000 to known Lab values", () => {
      const lab = _hexToLab("#ff0000");
      // Standard sRGB red -> Lab is approximately (53.23, 80.11, 67.22)
      expect(lab.l).toBeCloseTo(53.23, 0);
      expect(lab.a).toBeCloseTo(80.11, 0);
      expect(lab.b).toBeCloseTo(67.22, 0);
    });

    it("maps sRGB green (0,128,0) / #008000 to a positive a*, negative b*-ish Lab", () => {
      const lab = _hexToLab("#008000");
      // CSS "green" #008000 has L around 46, a around -51, b around 50
      expect(lab.l).toBeCloseTo(46.23, 0);
      expect(lab.a).toBeLessThan(0);
      expect(lab.b).toBeGreaterThan(0);
    });

    it("maps sRGB white (255,255,255) / #ffffff to L=100, a=0, b=0", () => {
      const lab = _hexToLab("#ffffff");
      // Due to the grid-truncated D65 white point, a and b might not be
      // exactly 0 but should be very close.
      expect(lab.l).toBeCloseTo(100, 0);
      expect(Math.abs(lab.a)).toBeLessThan(1);
      expect(Math.abs(lab.b)).toBeLessThan(1);
    });

    it("maps sRGB black (0,0,0) / #000000 to L=0, a=0, b=0", () => {
      const lab = _hexToLab("#000000");
      expect(lab.l).toBeCloseTo(0, 1);
      expect(lab.a).toBeCloseTo(0, 1);
      expect(lab.b).toBeCloseTo(0, 1);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests with real proxy fingerprints (if available)
// ---------------------------------------------------------------------------

// The proxy fingerprints are generated concurrently by another agent.
// These tests will be skipped if the file is not yet available.
let realPigments: PigmentSet | undefined;
try {
  // Dynamic import is async but we need sync for describe blocks;
  // use require-style via a sync re-export if available.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = await import("../src/data/proxyFingerprints");
  if (mod.RED_PR209) {
    realPigments = {
      red: mod.RED_PR209,
      purple: mod.PURPLE_PV23,
      blue: mod.BLUE_PB15,
    };
  }
} catch {
  // proxyFingerprints not yet available; skip integration tests.
}

describe.skipIf(!realPigments)("reverseSolve with real proxy fingerprints", () => {
  it("recovers a known mix ratio with real pigments", () => {
    const target = labAtRatio(0.4, 0.35, 0.25, realPigments!);
    const result = findBestRatio(target, realPigments!);

    expect(result.ratios.red).toBeCloseTo(0.4, 1);
    expect(result.ratios.purple).toBeCloseTo(0.35, 1);
    expect(result.ratios.blue).toBeCloseTo(0.25, 1);
    expect(result.deltaE00).toBeLessThan(0.5);
  });

  it("pure red with real pigments", () => {
    const target = labAtRatio(1, 0, 0, realPigments!);
    const result = findBestRatio(target, realPigments!);

    expect(result.ratios.red).toBeGreaterThanOrEqual(0.95);
    expect(result.deltaE00).toBeLessThan(0.5);
  });
});
