import { describe, expect, it } from "vitest";
import { resampleLinear } from "../src/resample";
import { createSpectrum, defaultWavelengths } from "../src/spectrum";

const GRID = defaultWavelengths(); // 380–750 nm @ 10 nm, 38 points

describe("resampleLinear", () => {
  it("defaults to the shared 380–750 nm @ 10 nm grid", () => {
    // Source covering the shared grid at finer resolution.
    const srcW = GRID.flatMap((w) => [w, w + 5]).filter((w) => w <= 750);
    srcW.unshift(375);
    const src = createSpectrum(srcW, srcW.map((w) => w / 1000));
    const out = resampleLinear(src);
    expect(out.wavelengths).toEqual(GRID);
    expect(out.values).toHaveLength(38);
  });

  it("is the identity when the target equals the source grid", () => {
    const values = GRID.map((_, i) => 0.1 + 0.02 * i);
    const out = resampleLinear(createSpectrum([...GRID], values));
    expect(out.wavelengths).toEqual(GRID);
    expect(out.values).toEqual(values);
  });

  it("extracts exact values when the target is a subset of the source grid (LBNL 5 nm → 10 nm case)", () => {
    // LBNL publishes 300–2500 nm @ 5 nm; the shared grid's nodes coincide
    // exactly with every second source node, so no interpolation occurs.
    const srcW: number[] = [];
    for (let w = 300; w <= 2500; w += 5) srcW.push(w);
    const srcV = srcW.map((w) => Math.min(1, Math.max(0, Math.sin(w / 60) ** 2)));
    const out = resampleLinear(createSpectrum(srcW, srcV));
    expect(out.wavelengths).toEqual(GRID);
    for (let i = 0; i < GRID.length; i++) {
      expect(out.values[i]).toBe(srcV[srcW.indexOf(GRID[i]!)]);
    }
  });

  it("interpolates linearly between source nodes", () => {
    const src = createSpectrum([400, 410, 420], [0.2, 0.6, 0.4]);
    const out = resampleLinear(src, [405, 412, 420]);
    expect(out.values[0]).toBeCloseTo(0.4, 15); // midpoint of 0.2 / 0.6
    expect(out.values[1]).toBeCloseTo(0.56, 15); // 0.6 + 0.2·(0.4 − 0.6)
    expect(out.values[2]).toBeCloseTo(0.4, 15); // exact node hit at the top end
  });

  it("reproduces an exactly linear function at every target on a finer grid", () => {
    const src = createSpectrum([380, 500, 750], [0.1, 0.34, 0.6]);
    // Slope changes at 500, so only check segments where linearity holds.
    const out = resampleLinear(src, [390, 400, 490, 510, 600, 740]);
    const f = (w: number): number =>
      w <= 500 ? 0.1 + ((0.34 - 0.1) / 120) * (w - 380) : 0.34 + ((0.6 - 0.34) / 250) * (w - 500);
    out.wavelengths.forEach((w, i) => {
      expect(out.values[i]).toBeCloseTo(f(w), 12);
    });
  });

  it("handles a non-uniform source grid", () => {
    const src = createSpectrum([380, 381, 400, 750], [0, 1, 1, 0.5]);
    const out = resampleLinear(src, [380.5, 390, 749]);
    expect(out.values[0]).toBeCloseTo(0.5, 12); // halfway across the 1 nm step
    expect(out.values[1]).toBeCloseTo(1, 12); // inside the flat 381–400 segment
    // 749 lies in segment 400–750: 1 + (0.5 − 1)·(749 − 400)/(750 − 400)
    expect(out.values[2]).toBeCloseTo(1 + (0.5 - 1) * ((749 - 400) / 350), 12);
  });

  it("includes the source endpoints exactly", () => {
    const src = createSpectrum([400, 700], [0.25, 0.75]);
    const out = resampleLinear(src, [400, 700]);
    expect(out.values).toEqual([0.25, 0.75]);
  });

  it("rejects target wavelengths outside the source range (no extrapolation)", () => {
    const src = createSpectrum([380, 750], [0.2, 0.8]);
    expect(() => resampleLinear(src, [379])).toThrow(RangeError);
    expect(() => resampleLinear(src, [751])).toThrow(RangeError);
    expect(() => resampleLinear(src, [300])).toThrow(/outside source range/);
  });

  it("rejects a source spectrum that does not cover the default grid", () => {
    // 400–700 nm source cannot serve the 380–750 nm default grid.
    const srcW: number[] = [];
    for (let w = 400; w <= 700; w += 10) srcW.push(w);
    const src = createSpectrum(srcW, srcW.map(() => 0.5));
    expect(() => resampleLinear(src)).toThrow(RangeError);
  });

  it("rejects malformed source spectra", () => {
    // Length mismatch.
    expect(() =>
      resampleLinear(createSpectrumSafe([380, 750], [0.5]), [500]),
    ).toThrow(/wavelengths vs/);
    // Fewer than 2 points.
    expect(() => resampleLinear(createSpectrum([500], [0.5]), [500])).toThrow(
      /at least 2/,
    );
    // Non-ascending and duplicated wavelengths.
    expect(() => resampleLinear(createSpectrum([500, 400], [0.1, 0.2]), [450])).toThrow(
      RangeError,
    );
    expect(() => resampleLinear(createSpectrum([400, 400, 500], [0.1, 0.2, 0.3]), [450])).toThrow(
      RangeError,
    );
    // Non-finite wavelengths / values.
    expect(() =>
      resampleLinear(createSpectrum([400, Number.NaN], [0.1, 0.2]), [450]),
    ).toThrow(RangeError);
    expect(() =>
      resampleLinear(createSpectrum([400, 500], [0.1, Number.POSITIVE_INFINITY]), [450]),
    ).toThrow(RangeError);
  });

  it("rejects malformed target grids", () => {
    const src = createSpectrum([380, 750], [0.2, 0.8]);
    expect(() => resampleLinear(src, [])).toThrow(/at least 1/);
    expect(() => resampleLinear(src, [500, 400])).toThrow(RangeError);
    expect(() => resampleLinear(src, [Number.NaN])).toThrow(RangeError);
  });

  it("does not alias the caller's target array", () => {
    const src = createSpectrum([380, 750], [0.2, 0.8]);
    const target = [500];
    const out = resampleLinear(src, target);
    target[0] = 999;
    expect(out.wavelengths).toEqual([500]);
  });
});

/** Bypass createSpectrum's own length check to test resampleLinear's. */
function createSpectrumSafe(wavelengths: number[], values: number[]) {
  return { wavelengths, values };
}
