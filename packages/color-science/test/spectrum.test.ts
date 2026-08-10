import { describe, expect, it } from "vitest";
import { createSpectrum, defaultWavelengths, idealBlack, idealWhite } from "../src/spectrum";

describe("spectrum grid", () => {
  it("builds the default 380–750 nm @ 10 nm grid", () => {
    const wl = defaultWavelengths();
    expect(wl[0]).toBe(380);
    expect(wl[wl.length - 1]).toBe(750);
    expect(wl.length).toBe(38);
  });

  it("rejects mismatched wavelength/value lengths", () => {
    expect(() => createSpectrum([400, 500], [0.5])).toThrow();
  });

  it("ideal white is R=1 everywhere, ideal black is R=0", () => {
    expect(idealWhite().values.every((v) => v === 1)).toBe(true);
    expect(idealBlack().values.every((v) => v === 0)).toBe(true);
  });
});
