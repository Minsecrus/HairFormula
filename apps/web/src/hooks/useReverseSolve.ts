import { useMemo } from "react";
import {
  findBestRatioFromHex,
  RED_PR209,
  PURPLE_PV23,
  BLUE_PB15,
  WHITE_PW6,
  type ReverseResult,
} from "@hair/color-science";
import { DILUENT_RATIO, DYE_STRENGTHS } from "./useColorMix";

const PIGMENTS = { red: RED_PR209, purple: PURPLE_PV23, blue: BLUE_PB15 };
const DILUENT = { fingerprint: WHITE_PW6, ratio: DILUENT_RATIO };

/** Reverse: target hex → best pigment ratio. Memoized. */
export function useReverseSolve(targetHex: string): ReverseResult | null {
  return useMemo(() => {
    if (!targetHex || targetHex.length < 4) return null;
    try {
      return findBestRatioFromHex(targetHex, PIGMENTS, {
        diluent: DILUENT,
        strengths: DYE_STRENGTHS,
      });
    } catch {
      return null;
    }
  }, [targetHex]);
}
