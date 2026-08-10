import { describe, expect, it } from "vitest";
import { deltaE2000 } from "../src/deltaE2000";
import type { Lab } from "../src/lab";
import { rgbToHex, xyzToSrgb } from "../src/srgb";
import type { XYZ } from "../src/xyz";

describe("xyzToSrgb (display-only, MASTER_PLAN Step 1)", () => {
  it("maps D65 white (95.047, 100, 108.883) to (255, 255, 255)", () => {
    const rgb = xyzToSrgb({ x: 95.047, y: 100, z: 108.883 });
    expect(rgb.r).toBe(255);
    expect(rgb.g).toBe(255);
    expect(rgb.b).toBe(255);
    expect(rgb.outOfGamut).toBe(false);
  });

  it("maps the XYZ of sRGB red (41.2456, 21.2673, 1.9334) to ~(255, 0, 0)", () => {
    const rgb = xyzToSrgb({ x: 41.2456, y: 21.2673, z: 1.9334 });
    expect(rgb.r).toBe(255);
    expect(rgb.g).toBe(0);
    expect(rgb.b).toBe(0);
    expect(rgb.outOfGamut).toBe(false);
  });

  it("maps the XYZ of sRGB green and blue to the pure primaries", () => {
    const green = xyzToSrgb({ x: 35.7576, y: 71.5152, z: 11.9192 });
    expect([green.r, green.g, green.b]).toEqual([0, 255, 0]);
    const blue = xyzToSrgb({ x: 18.0438, y: 7.2175, z: 95.0304 });
    expect([blue.r, blue.g, blue.b]).toEqual([0, 0, 255]);
  });

  it("maps black (0, 0, 0) to (0, 0, 0)", () => {
    const rgb = xyzToSrgb({ x: 0, y: 0, z: 0 });
    expect([rgb.r, rgb.g, rgb.b]).toEqual([0, 0, 0]);
    expect(rgb.outOfGamut).toBe(false);
  });

  it("applies the EOTF linear segment below 0.0031308", () => {
    // A gray whose linear channel lands in the linear toe of the EOTF.
    // Choose linear r = 0.003 → encoded = 12.92 * 0.003 = 0.03876 → 10/255.
    // Solve via the inverse matrix: use the direct matrix on a gray.
    // Gray with Y such that linear channel = 0.003:
    // for neutral gray, linear sRGB channel = Y/100 exactly (white-normalized),
    // so Y = 0.3 gives 0.003 → encoded 0.03876 → round(9.8838) = 10.
    const rgb = xyzToSrgb({ x: 0.285141, y: 0.3, z: 0.326649 }); // 0.003 × D65
    expect(rgb.r).toBe(10);
    expect(rgb.g).toBe(10);
    expect(rgb.b).toBe(10);
    expect(rgb.outOfGamut).toBe(false);
  });

  it("applies the EOTF power segment above 0.0031308", () => {
    // Neutral gray Y = 18 (linear 0.18): encoded = 1.055*0.18^(1/2.4) - 0.055
    // ≈ 0.4614 → round(0.4614*255) = 118. (18% gray ≈ sRGB 122 with the
    // piecewise curve at mid-gray... verify via the formula directly.)
    const linear = 0.18;
    const encoded = 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
    const expected = Math.round(encoded * 255);
    const rgb = xyzToSrgb({ x: 0.95047 * linear * 100, y: 18, z: 1.08883 * linear * 100 });
    expect(rgb.r).toBe(expected);
    expect(rgb.g).toBe(expected);
    expect(rgb.b).toBe(expected);
  });

  it("clamps out-of-gamut colors and flags them", () => {
    // Spectral-like saturated red beyond sRGB gamut (negative green/blue).
    const rgb = xyzToSrgb({ x: 100, y: 10, z: 0 });
    expect(rgb.r).toBe(255);
    expect(rgb.g).toBe(0);
    expect(rgb.outOfGamut).toBe(true);
  });

  it("flags colors brighter than the white point as out of gamut", () => {
    const rgb = xyzToSrgb({ x: 190.094, y: 200, z: 217.766 }); // 2× D65 white
    expect([rgb.r, rgb.g, rgb.b]).toEqual([255, 255, 255]);
    expect(rgb.outOfGamut).toBe(true);
  });

  it("returns integer channels", () => {
    const rgb = xyzToSrgb({ x: 25, y: 40, z: 60 });
    for (const c of [rgb.r, rgb.g, rgb.b]) {
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
    }
  });
});

describe("rgbToHex", () => {
  it("formats basic colors as lowercase #RRGGBB", () => {
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe("#ffffff");
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
    expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe("#ff0000");
    expect(rgbToHex({ r: 0, g: 128, b: 255 })).toBe("#0080ff");
  });

  it("zero-pads single-digit channels", () => {
    expect(rgbToHex({ r: 1, g: 2, b: 3 })).toBe("#010203");
    expect(rgbToHex({ r: 10, g: 11, b: 12 })).toBe("#0a0b0c");
  });

  it("uses lowercase hex digits", () => {
    expect(rgbToHex({ r: 171, g: 205, b: 239 })).toBe("#abcdef");
  });

  it("round-trip: D65 white through xyzToSrgb then rgbToHex", () => {
    const rgb = xyzToSrgb({ x: 95.047, y: 100, z: 108.883 });
    expect(rgbToHex(rgb)).toBe("#ffffff");
  });
});

describe("deltaE2000 (CIEDE2000, MASTER_PLAN §8.1)", () => {
  // Authoritative reference pairs from Sharma, Wu & Dalal (2005), Table 1.
  // Expected ΔE00 values must match to ±0.0001.
  const sharmaPairs: Array<[Lab, Lab, number]> = [
    [{ l: 50, a: 2.6772, b: -79.7751 }, { l: 50, a: 0, b: -82.7485 }, 2.0425],
    [{ l: 50, a: 3.1571, b: -77.2803 }, { l: 50, a: 0, b: -82.7485 }, 2.8615],
    [{ l: 50, a: 2.8361, b: -74.02 }, { l: 50, a: 0, b: -82.7485 }, 3.4412],
    [{ l: 50, a: -1.3802, b: -84.2814 }, { l: 50, a: 0, b: -82.7485 }, 1.0],
    [{ l: 50, a: -1.1848, b: -84.8006 }, { l: 50, a: 0, b: -82.7485 }, 1.0],
    [{ l: 73, a: 25, b: -18 }, { l: 73, a: 25, b: -18 }, 0],
  ];

  it.each(sharmaPairs)(
    "matches Sharma reference pair %# (ΔE00 = %f)",
    (lab1, lab2, expected) => {
      expect(deltaE2000(lab1, lab2)).toBeCloseTo(expected, 4);
    },
  );

  it("is zero for identical colors", () => {
    const lab: Lab = { l: 60, a: -20, b: 35 };
    expect(deltaE2000(lab, lab)).toBe(0);
  });

  it("is symmetric", () => {
    const lab1: Lab = { l: 50, a: 2.6772, b: -79.7751 };
    const lab2: Lab = { l: 50, a: 0, b: -82.7485 };
    expect(deltaE2000(lab1, lab2)).toBeCloseTo(deltaE2000(lab2, lab1), 12);
  });

  it("handles achromatic colors (zero chroma, undefined hue)", () => {
    const gray1: Lab = { l: 50, a: 0, b: 0 };
    const gray2: Lab = { l: 60, a: 0, b: 0 };
    const dE = deltaE2000(gray1, gray2);
    expect(Number.isFinite(dE)).toBe(true);
    expect(dE).toBeGreaterThan(0);
  });

  it("is smaller for perceptually similar colors than for distant ones", () => {
    const reference: Lab = { l: 50, a: 20, b: 30 };
    const near: Lab = { l: 51, a: 21, b: 29 };
    const far: Lab = { l: 80, a: -40, b: -20 };
    expect(deltaE2000(reference, near)).toBeLessThan(
      deltaE2000(reference, far),
    );
  });

  it("keeps XYZ typing intact for the sRGB tests above", () => {
    // Type-level smoke test: XYZ interface shape is the one srgb.ts consumes.
    const xyz: XYZ = { x: 1, y: 2, z: 3 };
    expect(xyz.y).toBe(2);
  });
});
