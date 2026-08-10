/**
 * Spectral representation.
 *
 * All spectra in this project share one fixed wavelength grid so that
 * arrays can be combined element-wise without re-sampling.
 */

/** Default grid: 380–750 nm @ 10 nm (matches the RIT database). */
export const DEFAULT_WAVELENGTH_RANGE = { start: 380, end: 750, step: 10 } as const;

export interface Spectrum {
  /** Wavelengths in nm, ascending, uniform step. */
  wavelengths: number[];
  /** Reflectance values in [0, 1], same length as `wavelengths`. */
  values: number[];
}

/** Build the default wavelength grid. */
export function defaultWavelengths(): number[] {
  const { start, end, step } = DEFAULT_WAVELENGTH_RANGE;
  const n = Math.round((end - start) / step) + 1;
  return Array.from({ length: n }, (_, i) => start + i * step);
}

export function createSpectrum(wavelengths: number[], values: number[]): Spectrum {
  if (wavelengths.length !== values.length) {
    throw new Error(
      `Spectrum length mismatch: ${wavelengths.length} wavelengths vs ${values.length} values`,
    );
  }
  return { wavelengths, values };
}

/** Reflectance of an ideal white diffuser (R = 1 everywhere). */
export function idealWhite(wavelengths: number[] = defaultWavelengths()): Spectrum {
  return createSpectrum(wavelengths, wavelengths.map(() => 1));
}

/** Perfect absorber (R = 0 everywhere). */
export function idealBlack(wavelengths: number[] = defaultWavelengths()): Spectrum {
  return createSpectrum(wavelengths, wavelengths.map(() => 0));
}
