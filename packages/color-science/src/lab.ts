/**
 * CIE XYZ ↔ CIELAB / CIELCh conversions, D65 white point (MASTER_PLAN §17,
 * Step 1).
 *
 * CIELAB per CIE 15:2004 §8.2.1 with the standard rational constants
 *   ε = 216/24389 = (6/29)³,   κ = 24389/27 = (29/3)³
 * and the piecewise linear/cube-root response
 *   f(t) = t^(1/3)            if t > ε
 *        = (κ·t + 16) / 116   otherwise.
 *
 *   L* = 116·f(Y/Yn) − 16
 *   a* = 500·(f(X/Xn) − f(Y/Yn))
 *   b* = 200·(f(Y/Yn) − f(Z/Zn))
 *
 * The reference white (Xn, Yn, Zn) defaults to XYZ_D65_WHITE, computed from
 * the embedded CIE D65 tables on the shared grid (see src/xyz.ts), so ideal
 * white maps to exactly (100, 0, 0).
 */
import { XYZ_D65_WHITE, type XYZ } from "./xyz";

export interface Lab {
  l: number;
  a: number;
  b: number;
}

export interface LCh {
  l: number;
  c: number;
  /** Hue angle in degrees, [0, 360). */
  h: number;
}

/** CIE 15:2004 §8.2.1 constants. */
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

const DEG_PER_RAD = 180 / Math.PI;

/** Piecewise CIELAB response f(t) — cube root above ε, linear below. */
function f(t: number): number {
  return t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
}

/**
 * Inverse of f, expressed in terms of the response value ft = f(t).
 * f is continuous at ε (both branches equal 6/29 there), so the branch
 * condition t > ε can be tested on ft³.
 */
function fInverse(ft: number): number {
  const t = ft * ft * ft;
  return t > EPSILON ? t : (116 * ft - 16) / KAPPA;
}

/** XYZ → CIELAB. `white` defaults to the D65 white point from the CIE tables. */
export function xyzToLab(xyz: XYZ, white: XYZ = XYZ_D65_WHITE): Lab {
  const fx = f(xyz.x / white.x);
  const fy = f(xyz.y / white.y);
  const fz = f(xyz.z / white.z);
  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** CIELAB → XYZ. `white` must be the same white point used for xyzToLab. */
export function labToXyz(lab: Lab, white: XYZ = XYZ_D65_WHITE): XYZ {
  const fy = (lab.l + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;
  return {
    x: white.x * fInverse(fx),
    y: white.y * fInverse(fy),
    z: white.z * fInverse(fz),
  };
}

/**
 * CIELAB → CIELCh (cylindrical form). Hue is atan2(b, a) in degrees,
 * normalized to [0, 360); neutral colours (C = 0) get h = 0 by convention.
 */
export function labToLch(lab: Lab): LCh {
  const c = Math.hypot(lab.a, lab.b);
  const hDeg = Math.atan2(lab.b, lab.a) * DEG_PER_RAD;
  // Map (-180, 180] to [0, 360); the +360 shift also turns -0 into +0.
  const h = (hDeg + 360) % 360;
  return { l: lab.l, c, h };
}

/**
 * CIELCh → CIELAB. The input hue is taken modulo 360 so out-of-range
 * angles (e.g. −10° or 370°) are accepted gracefully.
 */
export function lchToLab(lch: LCh): Lab {
  const hDeg = ((lch.h % 360) + 360) % 360;
  const hRad = hDeg / DEG_PER_RAD;
  return {
    l: lch.l,
    a: lch.c * Math.cos(hRad),
    b: lch.c * Math.sin(hRad),
  };
}
