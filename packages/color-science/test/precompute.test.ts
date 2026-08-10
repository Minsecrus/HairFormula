/**
 * Precompute proxy-pigment K/S fingerprints from LBNL data.
 *
 * This test fits the three fittable proxy pigments (PR209 red, PV23 purple,
 * PB15 blue) plus the white reference (PW6) using the same two-constant
 * tint-ladder method as lbnl.validation.test.ts, then writes the fitted
 * coefficients to src/data/proxyFingerprints.ts so the web UI can import
 * them directly without loading pigments.json or running tintFit at runtime.
 *
 * The generated file is deterministic (same LBNL data + same fitter = same
 * output) and is checked in as a production artifact.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resampleLinear } from "../src/resample";
import {
  createSpectrum,
  DEFAULT_WAVELENGTH_RANGE,
  type Spectrum,
} from "../src/spectrum";
import { fitTwoConstantFromTintLadder } from "../src/tintFit";
import type { KsFingerprint } from "../src/kubelkaMunk";

// Node type shims: ./lbnl-node-shims.d.ts (shared with lbnl.validation.test.ts)

// --- Dataset schema (subset) -------------------------------------------------
interface LbnlSample {
  sample_id: string;
  kind: string;
  mix_partners: string[];
  wavelengths_nm: number[];
  reflectance: (number | null)[];
}
interface LbnlPigment {
  pigment_id: string;
  name: string;
  role: string;
  lbnl_paint_code?: string;
  samples: LbnlSample[];
}
interface LbnlDataset {
  version: number;
  source: string;
  retrieved: string;
  pigments: LbnlPigment[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = resolve(HERE, "../../../model/datasets/processed/pigments.json");
const REPORT_PATH = resolve(HERE, "../../../model/validation/lbnl-report.json");
const OUTPUT_PATH = resolve(HERE, "../src/data/proxyFingerprints.ts");

// --- Helpers (same logic as lbnl.validation.test.ts) -------------------------

const NATIVE_STEP_NM = 5;

function sampleToSpectrum(sample: LbnlSample): Spectrum {
  const wavelengths: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < sample.wavelengths_nm.length; i++) {
    const r = sample.reflectance[i];
    if (r === null || r === undefined) continue;
    wavelengths.push(sample.wavelengths_nm[i]!);
    values.push(r);
  }
  const first = wavelengths[0];
  const last = wavelengths[wavelengths.length - 1];
  const { start, end } = DEFAULT_WAVELENGTH_RANGE;
  if (first === undefined || last === undefined || first > start || last < end) {
    throw new Error(
      `${sample.sample_id}: after dropping clipped points the measured range ` +
        `${first ?? "—"}–${last ?? "—"} nm no longer covers the shared ` +
        `${start}–${end} nm grid; refusing to extrapolate`,
    );
  }
  for (let i = 1; i < wavelengths.length; i++) {
    const gap = wavelengths[i]! - wavelengths[i - 1]!;
    if (gap > NATIVE_STEP_NM) {
      throw new Error(
        `${sample.sample_id}: ${gap} nm gap between kept points at ` +
          `${wavelengths[i - 1]}–${wavelengths[i]} nm; interpolating across ` +
          `it would fabricate data`,
      );
    }
  }
  return resampleLinear(createSpectrum(wavelengths, values));
}

function sampleOfKind(pigment: LbnlPigment, kind: string): LbnlSample | undefined {
  return pigment.samples.find((s) => s.kind === kind);
}

// --- Proxy pigment definitions -----------------------------------------------

interface ProxyDef {
  /** Export name in the generated module. */
  exportName: string;
  /** CI pigment id to match in the dataset. */
  pigmentId: string;
  /** Role to match (disambiguates duplicates like PB15 i vs ii). */
  role: string;
}

const PROXY_PIGMENTS: ProxyDef[] = [
  { exportName: "RED_PR209", pigmentId: "PR209", role: "proxy_red" },
  { exportName: "PURPLE_PV23", pigmentId: "PV23", role: "proxy_purple" },
  { exportName: "BLUE_PB15", pigmentId: "PB15", role: "proxy_blue" },
];

// --- Load --------------------------------------------------------------------

function loadDataset(): LbnlDataset | null {
  if (!existsSync(DATASET_PATH)) return null;
  return JSON.parse(readFileSync(DATASET_PATH, "utf8")) as LbnlDataset;
}

interface LbnlReport {
  pigment_fits: { pigment_id: string; name: string; ladder_rmse: number }[];
}

function loadReport(): LbnlReport | null {
  if (!existsSync(REPORT_PATH)) return null;
  return JSON.parse(readFileSync(REPORT_PATH, "utf8")) as LbnlReport;
}

const dataset = loadDataset();
if (dataset === null) {
  console.warn(
    "TODO(data): model/datasets/processed/pigments.json is missing — " +
      "proxy fingerprint precomputation SKIPPED.",
  );
}

// --- Code generation ---------------------------------------------------------

function formatArray(arr: number[]): string {
  return "[" + arr.join(", ") + "]";
}

function generateModule(
  fingerprints: { exportName: string; fp: KsFingerprint }[],
  whiteFp: KsFingerprint,
): string {
  const lines: string[] = [
    'import type { KsFingerprint } from "../kubelkaMunk";',
    "// Auto-generated by test/precompute.test.ts from LBNL data. Do not edit.",
    "",
  ];
  for (const { exportName, fp } of fingerprints) {
    lines.push(
      `export const ${exportName}: KsFingerprint = {`,
      `  wavelengths: ${formatArray(fp.wavelengths)},`,
      `  k: ${formatArray(fp.k)},`,
      `  s: ${formatArray(fp.s)},`,
      `};`,
      "",
    );
  }
  lines.push(
    `export const WHITE_PW6: KsFingerprint = {`,
    `  wavelengths: ${formatArray(whiteFp.wavelengths)},`,
    `  k: ${formatArray(whiteFp.k)},`,
    `  s: ${formatArray(whiteFp.s)},`,
    `};`,
    "",
  );
  return lines.join("\n");
}

// --- Tests -------------------------------------------------------------------

describe.skipIf(dataset === null)("precompute proxy fingerprints", () => {
  /** Shared computation cache: fit all three proxies once. */
  let fitted: {
    results: { exportName: string; fp: KsFingerprint; ladderRmse: number }[];
    whiteFp: KsFingerprint;
  } | null = null;

  function runFits(data: LbnlDataset) {
    if (fitted) return fitted;

    // White reference: role "white" (PW6, W03).
    const whitePigment = data.pigments.find((p) => p.role === "white");
    if (!whitePigment) throw new Error("dataset has no pigment with role 'white'");
    const whiteSample = sampleOfKind(whitePigment, "masstone");
    if (!whiteSample) throw new Error("white pigment has no masstone sample");
    const whiteSpectrum = sampleToSpectrum(whiteSample);

    const results: { exportName: string; fp: KsFingerprint; ladderRmse: number }[] = [];
    for (const def of PROXY_PIGMENTS) {
      const pigment = data.pigments.find(
        (p) => p.pigment_id === def.pigmentId && p.role === def.role,
      );
      if (!pigment) {
        throw new Error(
          `pigment ${def.pigmentId} with role ${def.role} not found in dataset`,
        );
      }
      const masstone = sampleOfKind(pigment, "masstone");
      const tint14 = sampleOfKind(pigment, "tint_1_4");
      const tint19 = sampleOfKind(pigment, "tint_1_9");
      if (!masstone || !tint14 || !tint19) {
        throw new Error(
          `pigment ${def.pigmentId} is missing one or more tint ladder rungs`,
        );
      }
      const fit = fitTwoConstantFromTintLadder(
        [
          { pigmentFraction: 1, reflectance: sampleToSpectrum(masstone) },
          { pigmentFraction: 0.2, reflectance: sampleToSpectrum(tint14) },
          { pigmentFraction: 0.1, reflectance: sampleToSpectrum(tint19) },
        ],
        whiteSpectrum,
      );
      results.push({
        exportName: def.exportName,
        fp: fit.fingerprint,
        ladderRmse: fit.ladderRmse,
      });
    }

    fitted = { results, whiteFp: results[0]!.fp.wavelengths.length > 0
      ? {
          wavelengths: [...whiteSpectrum.wavelengths],
          // White K/S: K_w = q_w (from reflectanceToKoverS), S_w = 1.
          // Use the same convention as fitTwoConstantFromTintLadder.
          k: whiteSpectrum.values.map((r) => {
            const rc = Math.min(Math.max(r, 1e-6), 1);
            const oneMinusR = 1 - rc;
            return (oneMinusR * oneMinusR) / (2 * rc);
          }),
          s: new Array<number>(whiteSpectrum.wavelengths.length).fill(1),
        }
      : { wavelengths: [], k: [], s: [] },
    };
    return fitted;
  }

  it("fits all three proxy pigments and writes src/data/proxyFingerprints.ts", () => {
    const { results, whiteFp } = runFits(dataset!);

    // Generate and write the module.
    const source = generateModule(
      results.map((r) => ({ exportName: r.exportName, fp: r.fp })),
      whiteFp,
    );
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, source);

    expect(existsSync(OUTPUT_PATH)).toBe(true);
    console.log(`Wrote ${OUTPUT_PATH}`);
  }, 120_000);

  it("each fingerprint has 38 points with all K/S finite and non-negative", () => {
    const { results, whiteFp } = runFits(dataset!);
    const all = [...results.map((r) => r.fp), whiteFp];
    for (const fp of all) {
      expect(fp.wavelengths.length).toBe(38);
      expect(fp.k.length).toBe(38);
      expect(fp.s.length).toBe(38);
      for (let i = 0; i < 38; i++) {
        expect(Number.isFinite(fp.k[i])).toBe(true);
        expect(Number.isFinite(fp.s[i])).toBe(true);
        expect(fp.k[i]!).toBeGreaterThanOrEqual(0);
        expect(fp.s[i]!).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("ladder RMSE matches lbnl-report.json within 1e-6 for PV23 and PB15", () => {
    const { results } = runFits(dataset!);
    const report = loadReport();
    expect(report).not.toBeNull();

    for (const r of results) {
      // PR209 has no mix_1_1 samples so it is not included in the validation
      // report's pigment_fits. Only cross-check PV23 and PB15.
      const pigmentId =
        PROXY_PIGMENTS.find((d) => d.exportName === r.exportName)?.pigmentId;
      const reportEntry = report!.pigment_fits.find(
        (f) => f.pigment_id === pigmentId,
      );
      if (!reportEntry) {
        // PR209 is not in the report — skip.
        console.log(
          `  ${r.exportName} (${pigmentId}): not in lbnl-report.json, skipping cross-check`,
        );
        continue;
      }
      const diff = Math.abs(r.ladderRmse - reportEntry.ladder_rmse);
      console.log(
        `  ${r.exportName} (${pigmentId}): ladderRmse=${r.ladderRmse.toFixed(6)} ` +
          `vs report=${reportEntry.ladder_rmse} (diff=${diff.toExponential(2)})`,
      );
      expect(diff).toBeLessThan(1e-6);
    }
  });
});
