import { describe, expect, it } from "vitest";
import { computeDyeStrengths } from "../src/strength";
import { mixKubelkaMunk, type KsFingerprint } from "../src/kubelkaMunk";
import { defaultWavelengths } from "../src/spectrum";
import {
  RED_PR209,
  PURPLE_PV23,
  BLUE_PB15,
  WHITE_PW6,
} from "../src/data/proxyFingerprints";

const GRID = defaultWavelengths();

/** Synthetic fingerprint with constant K/S per wavelength. */
function fp(k: number, s: number): KsFingerprint {
  return {
    wavelengths: GRID,
    k: GRID.map(() => k),
    s: GRID.map(() => s),
  };
}

describe("computeDyeStrengths", () => {
  it("normalizes to mean 1", () => {
    const s = computeDyeStrengths(WHITE_PW6, {
      red: RED_PR209,
      purple: PURPLE_PV23,
      blue: BLUE_PB15,
    });
    const mean = (s.red + s.purple + s.blue) / 3;
    expect(mean).toBeCloseTo(1, 10);
  });

  it("inverse-absorption ordering on synthetic fingerprints", () => {
    const s = computeDyeStrengths(fp(0, 1), {
      red: fp(1, 1),    // weak absorber
      purple: fp(4, 1),
      blue: fp(16, 1),  // strong absorber
    });
    expect(s.red).toBeGreaterThan(s.purple);
    expect(s.purple).toBeGreaterThan(s.blue);
    // s scales as 1/K: red should be ~4x purple, purple ~4x blue
    expect(s.red / s.purple).toBeCloseTo(4, 5);
    expect(s.purple / s.blue).toBeCloseTo(4, 5);
  });

  it("LBNL proxies: blue is damped, red is boosted (paint-strength rebalance)", () => {
    const s = computeDyeStrengths(WHITE_PW6, {
      red: RED_PR209,
      purple: PURPLE_PV23,
      blue: BLUE_PB15,
    });
    expect(s.red).toBeGreaterThan(1);
    expect(s.blue).toBeLessThan(1);
  });

  it("calibrated equal-parts mixes differ clearly by hue (regression: red10blue10 vs red0blue10)", () => {
    // The pigments must mix visibly differently after calibration; the
    // uncalibrated engine rendered both as nearly the same blue.
    const s = computeDyeStrengths(WHITE_PW6, {
      red: RED_PR209,
      purple: PURPLE_PV23,
      blue: BLUE_PB15,
    });
    const mix = (r: number, b: number) =>
      mixKubelkaMunk([
        { fingerprint: RED_PR209, concentration: r * s.red },
        { fingerprint: BLUE_PB15, concentration: b * s.blue },
        { fingerprint: WHITE_PW6, concentration: 3 * (r + b) },
      ]);
    const withRed = mix(10, 10);
    const blueOnly = mix(0, 10);
    // red shifts reflectance up in the 600–750 nm band vs blue-only
    const bandMean = (vals: number[]) =>
      vals.slice(23).reduce((a, v) => a + v, 0) / (vals.length - 23); // 610–750 nm
    expect(bandMean(withRed.values)).toBeGreaterThan(bandMean(blueOnly.values));
  });
});
