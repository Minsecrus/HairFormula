/**
 * Embedded CIE standard tables (MASTER_PLAN §17, Step 1).
 *
 * CIE 1931 2° standard observer colour-matching functions (x̄, ȳ, z̄) and
 * CIE standard illuminant D65 relative spectral power distribution, sampled
 * (not interpolated) on the shared project grid 380–750 nm @ 10 nm
 * (38 points, see src/spectrum.ts).
 *
 * Authoritative sources (downloaded and cross-checked 2026-08-09):
 *
 * - CMFs: official CIE data file `CIE_xyz_1931_2deg.csv` (1 nm steps),
 *   https://files.cie.co.at/CIE_xyz_1931_2deg.csv
 *   Listed at https://cie.co.at/datatable/cie-1931-colour-matching-functions-2-degree-observer
 *   (DOI 10.25039/CIE.DS.xvudnb9b; original source CIE 018:2019, Table 6 /
 *   ISO/CIE 11664-1:2019). File integrity verified against the md5 checksum
 *   published by CIE: 17cca777db64b17170f06f67ce9d3ab7. Values are
 *   numerically identical to CIE 15:2004, Table T.1 at these wavelengths.
 *
 * - D65 SPD: official CIE data file `CIE_std_illum_D65.csv` (1 nm steps),
 *   https://files.cie.co.at/CIE_std_illum_D65.csv
 *   Listed at https://cie.co.at/datatable/cie-standard-illuminant-d65
 *   (original source ISO/CIE 11664-2, Table B.1 / CIE 15:2004). The SPD is
 *   normalized to 100.0 at 560 nm by definition.
 */

/** One row of the standard table: observer CMFs and illuminant SPD at one wavelength. */
export interface CieStandardTableRow {
  /** Wavelength in nm. */
  readonly wavelengthNm: number;
  /** CIE 1931 2° colour-matching function x̄(λ). */
  readonly xBar: number;
  /** CIE 1931 2° colour-matching function ȳ(λ). */
  readonly yBar: number;
  /** CIE 1931 2° colour-matching function z̄(λ). */
  readonly zBar: number;
  /** CIE standard illuminant D65 relative spectral power S(λ). */
  readonly d65Spd: number;
}

/**
 * CIE 1931 2° observer CMFs + D65 SPD, 380–750 nm @ 10 nm (38 rows).
 * Digits are reproduced exactly as published in the official CIE CSVs.
 */
export const CIE_2DEG_D65_TABLE: readonly CieStandardTableRow[] = [
  { wavelengthNm: 380, xBar: 0.001368, yBar: 0.000039, zBar: 0.006450001, d65Spd: 49.9755 },
  { wavelengthNm: 390, xBar: 0.004243, yBar: 0.00012, zBar: 0.02005001, d65Spd: 54.6482 },
  { wavelengthNm: 400, xBar: 0.01431, yBar: 0.000396, zBar: 0.06785001, d65Spd: 82.7549 },
  { wavelengthNm: 410, xBar: 0.04351, yBar: 0.00121, zBar: 0.2074, d65Spd: 91.486 },
  { wavelengthNm: 420, xBar: 0.13438, yBar: 0.004, zBar: 0.6456, d65Spd: 93.4318 },
  { wavelengthNm: 430, xBar: 0.2839, yBar: 0.0116, zBar: 1.3856, d65Spd: 86.6823 },
  { wavelengthNm: 440, xBar: 0.34828, yBar: 0.023, zBar: 1.74706, d65Spd: 104.865 },
  { wavelengthNm: 450, xBar: 0.3362, yBar: 0.038, zBar: 1.77211, d65Spd: 117.008 },
  { wavelengthNm: 460, xBar: 0.2908, yBar: 0.06, zBar: 1.6692, d65Spd: 117.812 },
  { wavelengthNm: 470, xBar: 0.19536, yBar: 0.09098, zBar: 1.28764, d65Spd: 114.861 },
  { wavelengthNm: 480, xBar: 0.09564, yBar: 0.13902, zBar: 0.8129501, d65Spd: 115.923 },
  { wavelengthNm: 490, xBar: 0.03201, yBar: 0.20802, zBar: 0.46518, d65Spd: 108.811 },
  { wavelengthNm: 500, xBar: 0.0049, yBar: 0.323, zBar: 0.272, d65Spd: 109.354 },
  { wavelengthNm: 510, xBar: 0.0093, yBar: 0.503, zBar: 0.1582, d65Spd: 107.802 },
  { wavelengthNm: 520, xBar: 0.06327, yBar: 0.71, zBar: 0.07824999, d65Spd: 104.79 },
  { wavelengthNm: 530, xBar: 0.1655, yBar: 0.862, zBar: 0.04216, d65Spd: 107.689 },
  { wavelengthNm: 540, xBar: 0.2904, yBar: 0.954, zBar: 0.0203, d65Spd: 104.405 },
  { wavelengthNm: 550, xBar: 0.4334499, yBar: 0.9949501, zBar: 0.008749999, d65Spd: 104.046 },
  { wavelengthNm: 560, xBar: 0.5945, yBar: 0.995, zBar: 0.0039, d65Spd: 100 },
  { wavelengthNm: 570, xBar: 0.7621, yBar: 0.952, zBar: 0.0021, d65Spd: 96.3342 },
  { wavelengthNm: 580, xBar: 0.9163, yBar: 0.87, zBar: 0.001650001, d65Spd: 95.788 },
  { wavelengthNm: 590, xBar: 1.0263, yBar: 0.757, zBar: 0.0011, d65Spd: 88.6856 },
  { wavelengthNm: 600, xBar: 1.0622, yBar: 0.631, zBar: 0.0008, d65Spd: 90.0062 },
  { wavelengthNm: 610, xBar: 1.0026, yBar: 0.503, zBar: 0.00034, d65Spd: 89.5991 },
  { wavelengthNm: 620, xBar: 0.8544499, yBar: 0.381, zBar: 0.00019, d65Spd: 87.6987 },
  { wavelengthNm: 630, xBar: 0.6424, yBar: 0.265, zBar: 0.00004999999, d65Spd: 83.2886 },
  { wavelengthNm: 640, xBar: 0.4479, yBar: 0.175, zBar: 0.00002, d65Spd: 83.6992 },
  { wavelengthNm: 650, xBar: 0.2835, yBar: 0.107, zBar: 0, d65Spd: 80.0268 },
  { wavelengthNm: 660, xBar: 0.1649, yBar: 0.061, zBar: 0, d65Spd: 80.2146 },
  { wavelengthNm: 670, xBar: 0.0874, yBar: 0.032, zBar: 0, d65Spd: 82.2778 },
  { wavelengthNm: 680, xBar: 0.04677, yBar: 0.017, zBar: 0, d65Spd: 78.2842 },
  { wavelengthNm: 690, xBar: 0.0227, yBar: 0.00821, zBar: 0, d65Spd: 69.7213 },
  { wavelengthNm: 700, xBar: 0.01135916, yBar: 0.004102, zBar: 0, d65Spd: 71.6091 },
  { wavelengthNm: 710, xBar: 0.005790346, yBar: 0.002091, zBar: 0, d65Spd: 74.349 },
  { wavelengthNm: 720, xBar: 0.002899327, yBar: 0.001047, zBar: 0, d65Spd: 61.604 },
  { wavelengthNm: 730, xBar: 0.001439971, yBar: 0.00052, zBar: 0, d65Spd: 69.8856 },
  { wavelengthNm: 740, xBar: 0.0006900786, yBar: 0.0002492, zBar: 0, d65Spd: 75.087 },
  { wavelengthNm: 750, xBar: 0.0003323011, yBar: 0.00012, zBar: 0, d65Spd: 63.5927 },
];
