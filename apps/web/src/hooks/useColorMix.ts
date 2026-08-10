import { useMemo } from "react";
import {
  mixKubelkaMunk,
  spectrumToXyz,
  xyzToLab,
  labToLch,
  xyzToSrgb,
  rgbToHex,
  computeDyeStrengths,
  RED_PR209,
  PURPLE_PV23,
  BLUE_PB15,
  WHITE_PW6,
  type Lab,
  type LCh,
  type Rgb,
} from "@hair/color-science";

export interface MixResult {
  lab: Lab;
  lch: LCh;
  rgb: Rgb;
  hex: string;
}

/**
 * White base dilution: real dye products are mostly base cream/developer —
 * without it the engine mixes pure masstones and every result is near-black.
 * DILUENT_RATIO = white / total pigment (3 = 25% pigment, a vivid tint).
 */
export const DILUENT_RATIO = 3;

/**
 * Hair Dye Strength scalars (MASTER_PLAN §5 V0): calibrated from the
 * fingerprints so unit amounts of red/purple/blue have comparable visual
 * impact — without them, blue/violet dominate every mix (paint pigments are
 * far stronger than formulated hair dyes).
 */
export const DYE_STRENGTHS = computeDyeStrengths(WHITE_PW6, {
  red: RED_PR209,
  purple: PURPLE_PV23,
  blue: BLUE_PB15,
});

/** Forward: pigment amounts → display color. Memoized. */
export function useColorMix(red: number, purple: number, blue: number): MixResult | null {
  return useMemo(() => {
    if (red <= 0 && purple <= 0 && blue <= 0) return null;

    const spectrum = mixKubelkaMunk([
      { fingerprint: RED_PR209, concentration: red * DYE_STRENGTHS.red },
      { fingerprint: PURPLE_PV23, concentration: purple * DYE_STRENGTHS.purple },
      { fingerprint: BLUE_PB15, concentration: blue * DYE_STRENGTHS.blue },
      { fingerprint: WHITE_PW6, concentration: DILUENT_RATIO * (red + purple + blue) },
    ]);
    const xyz = spectrumToXyz(spectrum);
    const lab = xyzToLab(xyz);
    const lch = labToLch(lab);
    const rgb = xyzToSrgb(xyz);
    const hex = rgbToHex(rgb);
    return { lab, lch, rgb, hex };
  }, [red, purple, blue]);
}
