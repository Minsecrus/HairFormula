/**
 * External ground-truth validation against the LBNL Pigment Database
 * (MASTER_PLAN §17 Step 4 and §24 acceptance; metric definitions §8).
 *
 * Protocol (held-out ground truth):
 *   1. For every pigment, fit the two-constant K(λ), S(λ) fingerprint from
 *      its OWN white-dilution ladder only (masstone + 1:4 tint + 1:9 tint;
 *      white scale fixed from the PW6 masstone). Mixture samples are never
 *      used during fitting.
 *   2. Predict each real 1:1 non-white mixture spectrum with the
 *      two-constant engine (mixKubelkaMunk, c = 0.5/0.5).
 *   3. Score against the measured mixture spectrum: spectral RMSE/MAE over
 *      the shared 38-point grid and ΔE00 (D65, CIE 1931 2°).
 *   4. Repeat with the single-constant mixKoverS engine as a comparison row.
 *
 * Acceptance (§17 Step 4; the V1-style bar of §9 applied to the pigment
 * proxy): median two-constant ΔE00 < 5. If the engine misses the bar this
 * test MUST fail loudly — per the plan, hair-substrate work is blocked
 * until the spectral engine passes this gate ("如果这一关不准，不要进入染发
 * 模型，先修光谱引擎").
 *
 * All per-mixture metrics and medians are written to
 * model/validation/lbnl-report.json (generated artifact; do not edit).
 *
 * The test SKIPS (with a printed TODO) only when the dataset file is absent
 * (pre-acquisition state). A file that exists but is unparseable, or that
 * parses yet contains no mix_1_1 samples, means a failed/truncated
 * acquisition and throws at collection time — a failed data acquisition must
 * never silently turn this gate green.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deltaE2000 } from "../src/deltaE2000";
import {
  mixKoverS,
  mixKubelkaMunk,
  reflectanceToKoverS,
  type KsFingerprint,
} from "../src/kubelkaMunk";
import { xyzToLab } from "../src/lab";
import { resampleLinear } from "../src/resample";
import {
  createSpectrum,
  DEFAULT_WAVELENGTH_RANGE,
  type Spectrum,
} from "../src/spectrum";
import { fitTwoConstantFromTintLadder } from "../src/tintFit";
import { spectrumToXyz } from "../src/xyz";

// Node type shims for the fs/path/url/console/ImportMeta surface used here
// live in ./lbnl-node-shims.d.ts (the workspace has no @types/node; ambient
// module declarations must live in a non-module .d.ts file).

// --- Dataset schema (only the fields this validation reads) ------------------
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

/** Acceptance bar: median two-constant ΔE00 across all held-out mixtures. */
const MEDIAN_DE00_THRESHOLD = 5;

/**
 * Load the dataset, returning null ONLY when the file is absent (the
 * documented pre-acquisition skip condition). When the file exists but is
 * unparseable — or parses but holds no mix_1_1 samples — the acquisition is
 * corrupt/truncated, so we throw at collection time: the §17 Step 4 gate must
 * fail loudly, never skip green on broken data.
 */
function tryLoadDataset(): LbnlDataset | null {
  if (!existsSync(DATASET_PATH)) return null;
  let parsed: LbnlDataset;
  try {
    parsed = JSON.parse(readFileSync(DATASET_PATH, "utf8")) as LbnlDataset;
  } catch (err) {
    throw new Error(
      `${DATASET_PATH} exists but is unparseable — the §17 Step 4 acceptance ` +
        `gate cannot run on a corrupt dataset; re-run \`node scripts/fetch-lbnl.mjs ` +
        `digitize\`. Cause: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const hasMixtures =
    Array.isArray(parsed.pigments) &&
    parsed.pigments.some(
      (p) => Array.isArray(p.samples) && p.samples.some((s) => s.kind === "mix_1_1"),
    );
  if (!hasMixtures) {
    throw new Error(
      `${DATASET_PATH} parses but contains no mix_1_1 samples — the §17 Step 4 ` +
        `acceptance gate has nothing to validate against; re-run \`node ` +
        `scripts/fetch-lbnl.mjs digitize\`.`,
    );
  }
  return parsed;
}

const dataset = tryLoadDataset();
if (dataset === null) {
  // Printed at collection time so the skip is loud in the test output.
  console.warn(
    "TODO(data): model/datasets/processed/pigments.json is missing — LBNL " +
      "external validation (MASTER_PLAN §17 Step 4) SKIPPED. Acquire the LBNL " +
      "data before entering the hair-substrate model.",
  );
}

// --- Helpers -----------------------------------------------------------------

/**
 * Resample a dataset sample onto the shared grid, dropping clipped (null)
 * points.
 *
 * Nulls are legitimate only OUTSIDE the shared 380–750 nm window (curves
 * clipped at the plotted range edges). A null INSIDE the window would leave a
 * gap that resampleLinear then bridges by linear interpolation — silently
 * fabricating measured data, exactly what src/resample.ts's contract forbids.
 * So before resampling we require the kept points to (a) bracket the shared
 * grid and (b) contain no gap wider than the native 5 nm measurement step;
 * a sample clipped in-range fails loudly instead of being interpolated.
 */
const NATIVE_STEP_NM = 5; // LBNL measurement grid: 300–2500 nm @ 5 nm
function sampleToSpectrum(sample: LbnlSample): Spectrum {
  const wavelengths: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < sample.wavelengths_nm.length; i++) {
    const r = sample.reflectance[i];
    if (r === null || r === undefined) continue; // clipped outside plotted range
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
          `${wavelengths[i - 1]}–${wavelengths[i]} nm (clipped inside the ` +
          `measured range?); interpolating across it would fabricate data`,
      );
    }
  }
  return resampleLinear(createSpectrum(wavelengths, values));
}

function sampleOfKind(pigment: LbnlPigment, kind: string): LbnlSample | undefined {
  return pigment.samples.find((s) => s.kind === kind);
}

/** A pigment is fittable when it has the full ladder: masstone + both tints. */
function isFittable(pigment: LbnlPigment): boolean {
  return ["masstone", "tint_1_4", "tint_1_9"].every((k) => sampleOfKind(pigment, k));
}

interface MetricSet {
  rmse: number;
  mae: number;
  deltaE00: number;
  labPredicted: [number, number, number];
  labMeasured: [number, number, number];
}

/** Spectral RMSE/MAE over the shared grid + ΔE00 via spectrum→XYZ→Lab. */
function computeMetrics(predicted: Spectrum, measured: Spectrum): MetricSet {
  const n = predicted.values.length;
  let sumSq = 0;
  let sumAbs = 0;
  for (let i = 0; i < n; i++) {
    const d = predicted.values[i]! - measured.values[i]!;
    sumSq += d * d;
    sumAbs += Math.abs(d);
  }
  const labPredicted = xyzToLab(spectrumToXyz(predicted));
  const labMeasured = xyzToLab(spectrumToXyz(measured));
  return {
    rmse: Math.sqrt(sumSq / n),
    mae: sumAbs / n,
    deltaE00: deltaE2000(labPredicted, labMeasured),
    labPredicted: [labPredicted.l, labPredicted.a, labPredicted.b],
    labMeasured: [labMeasured.l, labMeasured.a, labMeasured.b],
  };
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round = (x: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

const roundMetrics = (m: MetricSet) => ({
  rmse: round(m.rmse, 6),
  mae: round(m.mae, 6),
  deltaE00: round(m.deltaE00, 4),
  lab_predicted: m.labPredicted.map((v) => round(v, 3)),
  lab_measured: m.labMeasured.map((v) => round(v, 3)),
});

// --- Validation run ----------------------------------------------------------

interface MixtureRow {
  sample_id: string;
  pigment_a: string;
  pigment_b: string;
  two_constant: MetricSet;
  single_constant: MetricSet;
}

interface ValidationResult {
  rows: MixtureRow[];
  pigmentFits: { pigment_id: string; name: string; ladder_rmse: number }[];
  whiteSampleId: string;
}

/** Memoized so multiple `it` blocks share one fit/predict pass. */
let cachedResult: ValidationResult | null = null;

function runValidation(data: LbnlDataset): ValidationResult {
  if (cachedResult) return cachedResult;

  // White reference: the pigment with role "white" (PW6 Titanium White (i),
  // W03). Its masstone fixes the K/S scale (S_w = 1, K_w = q_w).
  const whitePigment = data.pigments.find((p) => p.role === "white");
  if (!whitePigment) throw new Error("dataset has no pigment with role 'white'");
  const whiteSample = sampleOfKind(whitePigment, "masstone");
  if (!whiteSample) throw new Error("white pigment has no masstone sample");
  const whiteSpectrum = sampleToSpectrum(whiteSample);

  // Fittable pigments by CI id. Duplicated ids exist (PB15 i/ii, PW6 i/ii);
  // the first fittable ladder wins — non-fittable duplicates are ignored.
  const fittableById = new Map<string, LbnlPigment>();
  for (const p of data.pigments) {
    if (isFittable(p) && !fittableById.has(p.pigment_id)) {
      fittableById.set(p.pigment_id, p);
    }
  }

  // Fit each pigment's fingerprint from its OWN ladder only — never from a
  // mixture sample (held-out protocol).
  const fitCache = new Map<
    string,
    { fingerprint: KsFingerprint; masstoneKoverS: number[]; ladderRmse: number }
  >();
  const fitPigment = (id: string) => {
    const cached = fitCache.get(id);
    if (cached) return cached;
    const pigment = fittableById.get(id);
    if (!pigment) {
      throw new Error(`no fittable ladder found for mixture partner '${id}'`);
    }
    const masstone = sampleToSpectrum(sampleOfKind(pigment, "masstone")!);
    const fit = fitTwoConstantFromTintLadder(
      [
        { pigmentFraction: 1, reflectance: masstone },
        { pigmentFraction: 0.2, reflectance: sampleToSpectrum(sampleOfKind(pigment, "tint_1_4")!) },
        { pigmentFraction: 0.1, reflectance: sampleToSpectrum(sampleOfKind(pigment, "tint_1_9")!) },
      ],
      whiteSpectrum,
    );
    const entry = {
      fingerprint: fit.fingerprint,
      masstoneKoverS: reflectanceToKoverS(masstone),
      ladderRmse: fit.ladderRmse,
    };
    fitCache.set(id, entry);
    return entry;
  };

  // Predict + score every available 1:1 non-white mixture.
  const rows: MixtureRow[] = [];
  for (const pigment of data.pigments) {
    for (const sample of pigment.samples) {
      if (sample.kind !== "mix_1_1") continue;
      const aId = pigment.pigment_id;
      const bId = sample.mix_partners[0];
      if (!bId) throw new Error(`mixture ${sample.sample_id} has no partner id`);
      const a = fitPigment(aId);
      const b = fitPigment(bId);
      const measured = sampleToSpectrum(sample);

      // Two-constant prediction (production engine).
      const predictedTwo = mixKubelkaMunk([
        { fingerprint: a.fingerprint, concentration: 0.5 },
        { fingerprint: b.fingerprint, concentration: 0.5 },
      ]);
      // Single-constant comparison (masstone K/S ratios only).
      const predictedOne = mixKoverS([
        { kOverS: a.masstoneKoverS, concentration: 0.5 },
        { kOverS: b.masstoneKoverS, concentration: 0.5 },
      ]);

      rows.push({
        sample_id: sample.sample_id,
        pigment_a: aId,
        pigment_b: bId,
        two_constant: computeMetrics(predictedTwo, measured),
        single_constant: computeMetrics(predictedOne, measured),
      });
    }
  }

  cachedResult = {
    rows,
    pigmentFits: [...fitCache.entries()].map(([id, e]) => ({
      pigment_id: id,
      name: fittableById.get(id)!.name,
      ladder_rmse: round(e.ladderRmse, 6),
    })),
    whiteSampleId: whiteSample.sample_id,
  };
  return cachedResult;
}

function summarize(rows: MixtureRow[], pick: (r: MixtureRow) => MetricSet) {
  const ms = rows.map(pick);
  const worst = ms.reduce((a, b) => (b.deltaE00 > a.deltaE00 ? b : a));
  return {
    median_deltaE00: median(ms.map((m) => m.deltaE00)),
    median_rmse: median(ms.map((m) => m.rmse)),
    median_mae: median(ms.map((m) => m.mae)),
    max_deltaE00: worst.deltaE00,
    max_deltaE00_sample: rows[ms.indexOf(worst)]!.sample_id,
  };
}

function writeReport(data: LbnlDataset, result: ValidationResult): void {
  const twoSummary = summarize(result.rows, (r) => r.two_constant);
  const oneSummary = summarize(result.rows, (r) => r.single_constant);
  const report = {
    report: "lbnl-external-validation",
    generated_at: new Date().toISOString(),
    master_plan_refs: ["§17 Step 4", "§24 acceptance", "§8 metrics"],
    dataset: {
      path: "model/datasets/processed/pigments.json",
      source: data.source,
      retrieved: data.retrieved,
      white_reference: result.whiteSampleId,
    },
    method: {
      grid: "380–750 nm @ 10 nm (38 points); linear resample from the LBNL 300–2500 nm @ 5 nm grid",
      fit: "two-constant K(λ), S(λ) per pigment from its own masstone + 1:4 + 1:9 white tints (white scale S_w = 1, K_w = q_w from the white masstone); per-wavelength least squares in reflectance, coarse grid + Nelder–Mead in (ln K, ln S)",
      prediction:
        "two-constant mixKubelkaMunk at 1:1 (c = 0.5/0.5); comparison: single-constant mixKoverS on masstone K/S ratios",
      metrics:
        "spectral RMSE/MAE over the 38-point grid; ΔE00 via D65 / CIE 1931 2° (spectrum → XYZ → Lab → CIEDE2000)",
      held_out:
        "mixture samples are never used during fitting; each partner's fingerprint comes from its own tint ladder only",
    },
    pigment_fits: result.pigmentFits,
    mixtures: result.rows.map((r) => ({
      sample_id: r.sample_id,
      pigment_a: r.pigment_a,
      pigment_b: r.pigment_b,
      two_constant: roundMetrics(r.two_constant),
      single_constant: roundMetrics(r.single_constant),
    })),
    summary: {
      n_mixtures: result.rows.length,
      two_constant: {
        median_deltaE00: round(twoSummary.median_deltaE00, 4),
        median_rmse: round(twoSummary.median_rmse, 6),
        median_mae: round(twoSummary.median_mae, 6),
        max_deltaE00: round(twoSummary.max_deltaE00, 4),
        max_deltaE00_sample: twoSummary.max_deltaE00_sample,
      },
      single_constant: {
        median_deltaE00: round(oneSummary.median_deltaE00, 4),
        median_rmse: round(oneSummary.median_rmse, 6),
        median_mae: round(oneSummary.median_mae, 6),
        max_deltaE00: round(oneSummary.max_deltaE00, 4),
        max_deltaE00_sample: oneSummary.max_deltaE00_sample,
      },
      acceptance: {
        metric: "median two-constant ΔE00",
        threshold: MEDIAN_DE00_THRESHOLD,
        value: round(twoSummary.median_deltaE00, 4),
        pass: twoSummary.median_deltaE00 < MEDIAN_DE00_THRESHOLD,
      },
    },
  };
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
}

function logTable(result: ValidationResult): void {
  console.log("LBNL held-out 1:1 mixture validation (two-constant vs single-constant):");
  for (const r of result.rows) {
    console.log(
      `  ${r.sample_id.padEnd(34)} ` +
        `2K ΔE00=${r.two_constant.deltaE00.toFixed(3).padStart(7)} RMSE=${r.two_constant.rmse.toFixed(4)}  |  ` +
        `1K ΔE00=${r.single_constant.deltaE00.toFixed(3).padStart(7)} RMSE=${r.single_constant.rmse.toFixed(4)}`,
    );
  }
  const two = summarize(result.rows, (r) => r.two_constant);
  const one = summarize(result.rows, (r) => r.single_constant);
  console.log(
    `  two-constant:   median ΔE00=${two.median_deltaE00.toFixed(4)}, median RMSE=${two.median_rmse.toFixed(5)}, ` +
      `median MAE=${two.median_mae.toFixed(5)}, max ΔE00=${two.max_deltaE00.toFixed(4)} (${two.max_deltaE00_sample})`,
  );
  console.log(
    `  single-constant: median ΔE00=${one.median_deltaE00.toFixed(4)}, median RMSE=${one.median_rmse.toFixed(5)}, ` +
      `median MAE=${one.median_mae.toFixed(5)}, max ΔE00=${one.max_deltaE00.toFixed(4)} (${one.max_deltaE00_sample})`,
  );
}

// --- Tests -------------------------------------------------------------------

describe.skipIf(dataset === null)("LBNL external validation (MASTER_PLAN §17 Step 4)", () => {
  it(
    "predicts every held-out 1:1 mixture and writes model/validation/lbnl-report.json",
    () => {
      const result = runValidation(dataset!);
      expect(result.rows.length).toBeGreaterThan(0);
      for (const row of result.rows) {
        for (const m of [row.two_constant, row.single_constant]) {
          expect(Number.isFinite(m.rmse)).toBe(true);
          expect(Number.isFinite(m.mae)).toBe(true);
          expect(Number.isFinite(m.deltaE00)).toBe(true);
        }
      }
      writeReport(dataset!, result);
      logTable(result);
      expect(existsSync(REPORT_PATH)).toBe(true);
    },
    120_000,
  );

  it("two-constant engine beats the single-constant baseline on median ΔE00", () => {
    const result = runValidation(dataset!);
    const two = summarize(result.rows, (r) => r.two_constant);
    const one = summarize(result.rows, (r) => r.single_constant);
    expect(two.median_deltaE00).toBeLessThan(one.median_deltaE00);
  });

  it(
    `ACCEPTANCE: median two-constant ΔE00 < ${MEDIAN_DE00_THRESHOLD} (§17 Step 4 gate — blocks hair work on failure)`,
    () => {
      const result = runValidation(dataset!);
      const two = summarize(result.rows, (r) => r.two_constant);
      expect(
        two.median_deltaE00,
        `median two-constant ΔE00 = ${two.median_deltaE00.toFixed(4)} misses the ` +
          `< ${MEDIAN_DE00_THRESHOLD} bar — per MASTER_PLAN §17 Step 4 the spectral ` +
          `engine must be fixed before any hair-substrate modelling`,
      ).toBeLessThan(MEDIAN_DE00_THRESHOLD);
    },
  );
});
