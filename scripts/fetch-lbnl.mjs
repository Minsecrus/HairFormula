#!/usr/bin/env node
/**
 * fetch-lbnl.mjs — Reproducible acquisition + digitization of LBNL Pigment Database
 * spectral data (MASTER_PLAN Step 3, §3.2 "LBNL Pigment Database").
 *
 * Data source: Lawrence Berkeley National Laboratory Pigment Database
 *   https://coolcolors.lbl.gov/LBNL-Pigment-Database/database.html
 *   (Levinson, Berdahl & Akbari, Heat Island Group, LBNL)
 *
 * WHY THIS SCRIPT EXISTS / DATA-ACCESS SITUATION (verified 2026-08-09):
 *   The canonical spectral datafiles (*.zip, one tab-delimited .txt each) are
 *   stored with WinZip AES-128 encryption; per "spectral-datafile-guide.pdf"
 *   the decryption key is only issued to Cool Colors project members.
 *   The per-paint *spectral chart PDFs* are public and are vector plots drawn
 *   directly from those datafiles (one polyline vertex per measured
 *   wavelength, 300–2500 nm @ 5 nm, 441 points). This script therefore:
 *     1. `fetch`    — downloads every relevant raw artifact VERBATIM
 *                     (encrypted zips, chart PDFs, paint pages, guide PDF)
 *                     into model/datasets/raw/lbnl/ with a sha256 manifest.
 *     2. `digitize` — recovers the plotted spectra from the chart PDF vector
 *                     content (axis calibration from tick marks; identity from
 *                     stroke color/dash) and writes the unified dataset
 *                     model/datasets/processed/pigments.json.
 *   No resampling is performed; wavelengths are the native 300–2500 nm @ 5 nm
 *   grid of the source. Resampling to the project grid (380–750 @ 10 nm,
 *   packages/color-science/src/spectrum.ts) happens at validation time.
 *
 * Usage:
 *   node scripts/fetch-lbnl.mjs fetch      # download raw artifacts only
 *   node scripts/fetch-lbnl.mjs digitize   # chart PDFs -> pigments.json only
 *   node scripts/fetch-lbnl.mjs all        # fetch + digitize (default)
 *   node scripts/fetch-lbnl.mjs fetch --force   # re-download existing files
 *
 * Zero dependencies (Node >= 20). Chart PDF parsing relies on the LBNL/R
 * PDF-device output format: uncompressed content streams, `RG`/`d` graphics
 * state, `m`/`l`/`S` polylines, `Tm`/`Tj` text.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(REPO_ROOT, 'model', 'datasets', 'raw', 'lbnl');
const PROCESSED_DIR = path.join(REPO_ROOT, 'model', 'datasets', 'processed');
const OUT_JSON = path.join(PROCESSED_DIR, 'pigments.json');
const RETRIEVED = '2026-08-09';

const BASE = 'https://coolcolors.lbl.gov/LBNL-Pigment-Database';
const PAGE_URL = (code) => `${BASE}/paints/${code}.html`;
const ZIP_URL = (name) => `${BASE}/assets/spectral-data/${name}-spectral-data.zip`;
const CHART_URL = (name) => `${BASE}/assets/spectral-charts/pdf/${name}-spectral-chart.pdf`;

/* ------------------------------------------------------------------------ */
/* Scope definition (MASTER_PLAN §3.1 proxies + §3.2 validation partners).  */
/* ------------------------------------------------------------------------ */

/**
 * Paints in scope. `role` documents the MASTER_PLAN §3.1 proxy mapping.
 * NOTE: PR254 (Pyrrole Red) and PR122 (Quinacridone Magenta) do NOT exist in
 * the LBNL database; R07 (PR209 quinacridone red, full tint ladder) and R08
 * (PV19 quinacridone scarlet, masstone only) are the closest available
 * quinacridone proxies. PB15 and PW6 exist exactly (U12, W03).
 */
const PAINTS = {
  // — primary proxies (the "four proxy pigments + white") —
  R07: { ci: 'PR209', name: 'Acra Red', role: 'proxy_red', proxy_for: 'PR254 Pyrrole Red (not in LBNL DB; closest red with full tint ladder)' },
  R08: { ci: 'PV19', name: 'Monastral Red', role: 'proxy_magenta', proxy_for: 'PR122 Quinacridone Magenta (not in LBNL DB; only quinacridone violet/rose available)' },
  U14: { ci: 'PV23', name: 'Dioxazine Purple', role: 'proxy_purple', proxy_for: 'PV23 Dioxazine Purple (exact match)' },
  U12: { ci: 'PB15', name: 'Phthalo Blue (i)', role: 'proxy_blue', proxy_for: 'PB15 Phthalo Blue (exact match)' },
  W03: { ci: 'PW6', name: 'Titanium White (i)', role: 'white', proxy_for: 'PW6 Titanium White (exact match)' },
  // — auxiliary paints (extra validation data; named alternatives in §3.1) —
  R09: { ci: 'PR9', name: 'Naphthol Red Light', role: 'auxiliary', proxy_for: null },
  U11: { ci: 'PB29', name: 'French Ultramarine Blue', role: 'auxiliary', proxy_for: 'PB29 Ultramarine (§3.1 alternative blue)' },
  R06: { ci: 'PR206', name: 'Acra Burnt Orange', role: 'auxiliary', proxy_for: null },
  U13: { ci: 'PB15', name: 'Phthalo Blue (ii)', role: 'auxiliary', proxy_for: null },
  W04: { ci: 'PW6', name: 'Titanium White (ii)', role: 'auxiliary', proxy_for: null },
  // — 1:1 mixture partners (MASTER_PLAN §3.2 validation set) —
  B13: { ci: 'PBr7', name: 'Burnt Sienna', role: 'mixture_partner', proxy_for: null },
  // LBNL page + chart label both read "Shepherd Brown 156 (PBk 12)" — the CI
  // id is PBk 12, not PBr 29 (both are iron-titanate spinels; distinct ids).
  B16: { ci: 'PBk12', name: 'Iron Titanium Brown Spinel (i)', role: 'mixture_partner', proxy_for: null },
  Y01: { ci: 'PY42', name: 'Yellow Oxide', role: 'mixture_partner', proxy_for: null },
  U03: { ci: 'PB28', name: 'Cobalt Aluminate Blue Spinel (iii)', role: 'mixture_partner', proxy_for: null },
  R03: { ci: 'PR101', name: 'Red Iron Oxide (iii)', role: 'mixture_partner', proxy_for: null },
  // LBNL states NO CI id for G03 (page/chart label: "Ferro Camouflage Green
  // V-12650" only); ci stays null so pigment_id falls back to the paint code,
  // same convention as P05. Do not guess PG 17 — a "modified/camouflage"
  // chromium green-black is typically a blend.
  G03: { ci: null, name: 'Chromium Green-Black Modified', role: 'mixture_partner', proxy_for: null },
  Y13: { ci: 'PY74', name: 'Yellow Medium Azo', role: 'mixture_partner', proxy_for: null },
  P05: { ci: null, name: 'Interference Green (pearlescent)', role: 'mixture_partner', proxy_for: null },
};

/** Paints whose pages list only a masstone (no tints characterized). */
const MASSTONE_ONLY = new Set(['R08', 'U13', 'W03', 'W04']);

/**
 * 1:1 non-white mixtures linked from the target pigment pages
 * (MASTER_PLAN §3.2: fit on masstone/tints, predict these, compare).
 * `attachTo` = pigment entry that owns the mixture sample in pigments.json.
 */
const MIXTURES = [
  { file: 'B13+U14', a: 'B13', b: 'U14', attachTo: 'U14' },
  { file: 'U14+B16', a: 'U14', b: 'B16', attachTo: 'U14' },
  { file: 'U14+Y01', a: 'U14', b: 'Y01', attachTo: 'U14' },
  { file: 'U03+U12', a: 'U03', b: 'U12', attachTo: 'U12' },
  { file: 'U12+R03', a: 'U12', b: 'R03', attachTo: 'U12' },
  { file: 'U12+G03', a: 'U12', b: 'G03', attachTo: 'U12' },
  { file: 'Y13+U12', a: 'Y13', b: 'U12', attachTo: 'U12' },
  { file: 'P05+U12', a: 'P05', b: 'U12', attachTo: 'U12' },
  { file: 'U11+U03', a: 'U11', b: 'U03', attachTo: 'U11' },
  { file: 'U11+G03', a: 'U11', b: 'G03', attachTo: 'U11' },
  { file: 'U11+Y01', a: 'U11', b: 'Y01', attachTo: 'U11' },
  { file: 'G03+R09', a: 'G03', b: 'R09', attachTo: 'R09' },
  { file: 'R09+U03', a: 'R09', b: 'U03', attachTo: 'R09' },
  { file: 'R09+R03', a: 'R09', b: 'R03', attachTo: 'R09' },
  { file: 'R09+P05', a: 'R09', b: 'P05', attachTo: 'R09' },
];

/* ------------------------------------------------------------------------ */
/* Fetch stage                                                               */
/* ------------------------------------------------------------------------ */

/** Build the download manifest: every artifact we archive verbatim. */
function buildFetchList() {
  const items = [];
  const add = (url, rel, required) => items.push({ url, rel, required });

  // Index + paint pages (provenance snapshots).
  add(`${BASE}/database.html`, 'pages/database.html', true);
  for (const code of Object.keys(PAINTS)) add(PAGE_URL(code), `pages/paints/${code}.html`, true);

  // Guide to reading spectral datafiles (documents zip encryption + columns).
  add(`${BASE}/assets/misc/spectral-datafile-guide.pdf`, 'misc/spectral-datafile-guide.pdf', true);

  // Canonical spectral data zips (AES-128 encrypted — archived verbatim;
  // content is recovered from the chart PDFs instead, see header comment).
  for (const code of Object.keys(PAINTS)) {
    add(ZIP_URL(`${code}-masstone`), `zips/${code}-masstone-spectral-data.zip`, true);
    if (!MASSTONE_ONLY.has(code)) {
      add(ZIP_URL(`${code}-tint-1-to-4`), `zips/${code}-tint-1-to-4-spectral-data.zip`, true);
      add(ZIP_URL(`${code}-tint-1-to-9`), `zips/${code}-tint-1-to-9-spectral-data.zip`, true);
    }
  }
  for (const mx of MIXTURES) {
    add(ZIP_URL(`${mx.file}-mixture-1-to-1`), `zips/${mx.file}-mixture-1-to-1-spectral-data.zip`, true);
  }

  // Spectral chart PDFs (the digitization source).
  for (const code of Object.keys(PAINTS)) {
    if (MASSTONE_ONLY.has(code)) {
      add(CHART_URL(`${code}-masstone`), `charts/${code}-masstone-spectral-chart.pdf`, true);
    } else {
      add(CHART_URL(`${code}-tint-ladder`), `charts/${code}-tint-ladder-spectral-chart.pdf`, true);
    }
  }
  for (const mx of MIXTURES) {
    add(CHART_URL(`${mx.file}-mixture-1-to-1`), `charts/${mx.file}-mixture-1-to-1-spectral-chart.pdf`, true);
  }
  return items;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOne(item, force) {
  const dest = path.join(RAW_DIR, item.rel);
  if (existsSync(dest) && !force) {
    return { ...item, status: 'cached', bytes: readFileSync(dest).length, sha256: sha256File(dest) };
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(item.url, {
        headers: { 'User-Agent': 'HairFormula research dataset fetcher (LBNL public pigment data; contact: local dev)' },
        signal: AbortSignal.timeout(45000),
      });
      if (res.status === 404) return { ...item, status: '404' };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(dest, buf);
      return { ...item, status: 'ok', bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
    } catch (err) {
      lastErr = err;
      await sleep(600 * 2 ** attempt); // 0.6s, 1.2s, 2.4s backoff
    }
  }
  return { ...item, status: 'error', error: String(lastErr) };
}

function sha256File(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

async function runFetch(force) {
  const items = buildFetchList();
  const results = [];
  console.log(`[fetch] ${items.length} artifacts -> ${RAW_DIR}`);
  for (const item of items) {
    const r = await fetchOne(item, force);
    results.push({ ...r, retrieved: RETRIEVED });
    const tag = r.status === 'ok' ? `${r.bytes}B` : r.status;
    console.log(`  ${r.status.padEnd(6)} ${item.rel} ${tag}`);
    if (r.status === 'ok') await sleep(120); // politeness delay between live hits
  }
  const missing = results.filter((r) => r.required && r.status !== 'ok' && r.status !== 'cached');
  const manifest = {
    source: 'LBNL Pigment Database',
    base: BASE,
    retrieved: RETRIEVED,
    note: 'Spectral data zips are WinZip AES-128 encrypted (key restricted to Cool Colors members per spectral-datafile-guide.pdf). They are archived verbatim; usable spectra are digitized from the public chart PDFs by the `digitize` stage of scripts/fetch-lbnl.mjs.',
    files: results,
  };
  writeFileSync(path.join(RAW_DIR, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
  console.log(`[fetch] done. ${results.filter((r) => r.status === 'ok').length} downloaded, ` +
    `${results.filter((r) => r.status === 'cached').length} cached, ${missing.length} missing(required).`);
  if (missing.length) {
    console.error('[fetch] MISSING REQUIRED:\n' + missing.map((m) => '  ' + m.url).join('\n'));
    process.exitCode = 1;
  }
}

/* ------------------------------------------------------------------------ */
/* PDF vector-content parsing (LBNL charts are R PDF-device output).         */
/* ------------------------------------------------------------------------ */

/** Extract and inflate the page content stream(s) of a chart PDF. */
function pdfContentStreams(buf) {
  const s = buf.toString('latin1');
  const streams = [];
  let idx = 0;
  for (;;) {
    const m = /(?<!end)stream\r?\n/.exec(s.slice(idx));
    if (!m) break;
    const start = idx + m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    const raw = Buffer.from(s.slice(start, end), 'latin1');
    const dictHead = s.slice(Math.max(0, idx + m.index - 400), idx + m.index);
    if (/\/FlateDecode/.test(dictHead)) {
      try { streams.push(zlib.inflateSync(raw).toString('latin1')); }
      catch { streams.push(raw.toString('latin1')); }
    } else {
      streams.push(raw.toString('latin1'));
    }
    idx = end + 9;
  }
  return streams;
}

/**
 * Tokenize PDF content: numbers, names, operators, and paren-strings
 * (strings may contain spaces; `\(` `\)` `\\` escapes are resolved).
 */
function tokenize(s) {
  const toks = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') {
      let j = i + 1, depth = 1, str = '';
      while (j < n && depth > 0) {
        const ch = s[j];
        if (ch === '\\') { str += s[j + 1] ?? ''; j += 2; continue; }
        if (ch === '(') depth++;
        if (ch === ')') { depth--; if (depth === 0) { j++; break; } }
        str += ch; j++;
      }
      toks.push({ str });
      i = j;
    } else {
      let j = i;
      while (j < n && !/[\s()]/.test(s[j])) j++;
      toks.push(s.slice(i, j));
      i = j;
    }
  }
  return toks;
}

/**
 * Walk the content stream and collect:
 *  - paths: stroked polylines with stroke color + dash state
 *  - texts: text blocks with origin (Tm) and joined Tj content
 */
function parseContent(stream) {
  const toks = tokenize(stream);
  const paths = [];
  const stack = [];
  let color = [0, 0, 0];
  let dashSolid = true;
  let cur = null;
  const num = (v) => (typeof v === 'number' ? v : NaN);
  for (const t of toks) {
    if (typeof t === 'object') { stack.push(t); continue; }            // string
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) { stack.push(parseFloat(t)); continue; }
    // token is an operator or bracket
    if (t === '[]') { dashSolid = true; continue; }
    if (t.startsWith('[')) { dashSolid = false; continue; }            // e.g. '[3.00' of dash array
    switch (t) {
      case 'RG': color = [num(stack.at(-3)), num(stack.at(-2)), num(stack.at(-1))]; break;
      case 'm': cur = [[num(stack.at(-2)), num(stack.at(-1))]]; break;
      case 'l': if (cur) cur.push([num(stack.at(-2)), num(stack.at(-1))]); break;
      case 'S': case 's':
        if (cur && cur.length) paths.push({ color: [...color], solid: dashSolid, pts: cur });
        cur = null; break;
      case 'n': case 'f': case 'F': case 'f*': cur = null; break;
      default: break;
    }
    stack.length = 0; // operands are consumed by each operator in these files
  }
  return { paths, texts: collectTexts(stream) };
}

/** Second, simpler pass dedicated to text blocks (BT..ET with Tm + Tj). */
function collectTexts(stream) {
  const blocks = [];
  const re = /BT(.*?)ET/gs;
  let m;
  while ((m = re.exec(stream))) {
    const body = m[1];
    const tmM = /([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+Tm/.exec(body);
    if (!tmM) continue;
    const parts = [];
    const tjRe = /\((?:\\.|[^\\()])*\)\s*Tj/gs;
    let tj;
    while ((tj = tjRe.exec(body))) {
      parts.push(unescapePdfString(tj[0].slice(0, tj[0].lastIndexOf(')')).slice(1)));
    }
    if (parts.length) {
      blocks.push({ x: parseFloat(tmM[5]), y: parseFloat(tmM[6]), text: parts.join(' ') });
    }
  }
  return blocks;
}

function unescapePdfString(s) {
  return s.replace(/\\(.)/g, '$1');
}

/* ------------------------------------------------------------------------ */
/* Chart geometry: calibration from axis tick marks.                         */
/* ------------------------------------------------------------------------ */

const FRAME_W = 133.2;          // pt, wavelength axis: 300..2500 nm
const LAMBDA_MIN = 300, LAMBDA_MAX = 2500, LAMBDA_STEP = 5;
const N_WAVELENGTHS = (LAMBDA_MAX - LAMBDA_MIN) / LAMBDA_STEP + 1; // 441

/**
 * Recover per-column x calibration (pt -> nm) and per-panel-row y calibration
 * from the chart's own tick marks:
 *   x majors (longer vertical ticks under the lowest panel) sit at
 *   500/1000/1500/2000/2500 nm; frame left edge is exactly 300 nm.
 *   y majors for linear panels: 0,0.2,...,1.0; for the K-M panel (log):
 *   10^-1..10^3 (minor ticks between majors confirm log spacing).
 */
function calibrate(paths) {
  // 2-point axis-aligned black strokes are tick candidates.
  const ticks = [];
  for (const p of paths) {
    if (p.pts.length !== 2) continue;
    if (Math.max(...p.color) > 0.05) continue; // black only
    const [[x1, y1], [x2, y2]] = p.pts;
    if (Math.abs(x1 - x2) < 0.02 && Math.abs(y2 - y1) > 0.5) {
      ticks.push({ axis: 'x', at: x1, len: Math.abs(y2 - y1), yMin: Math.min(y1, y2), yMax: Math.max(y1, y2) });
    } else if (Math.abs(y1 - y2) < 0.02 && Math.abs(x2 - x1) > 0.5) {
      ticks.push({ axis: 'y', at: y1, len: Math.abs(x2 - x1), xMin: Math.min(x1, x2), xMax: Math.max(x1, x2) });
    }
  }
  // X major ticks: vertical, length > 3.5pt, located just below the lowest panel row.
  const xTickYMax = Math.min(...ticks.filter((t) => t.axis === 'x').map((t) => t.yMax));
  const xMajors = ticks.filter((t) => t.axis === 'x' && t.len > 3.5 && Math.abs(t.yMax - xTickYMax) < 2);
  // Columns: majors are evenly ~30.2pt spaced chart-wide (500-nm spacing), so
  // gap-clustering cannot separate columns; each column owns 5 CONSECUTIVE
  // majors (500..2500 nm). Chunk the sorted majors into groups of 5.
  const xs = [...new Set(xMajors.map((t) => round2(t.at)))].sort((a, b) => a - b);
  if (xs.length % 5 !== 0) throw new Error(`x majors total ${xs.length} not a multiple of 5`);
  const columns = [];
  for (let i = 0; i < xs.length; i += 5) columns.push({ ticks: xs.slice(i, i + 5) });
  for (const col of columns) {
    const span = col.ticks[4] - col.ticks[0]; // 500->2500 nm = 2000 nm
    if (Math.abs(span - 121.09) > 2) throw new Error(`x-tick group spans ${span.toFixed(2)}pt (expected ~121.09pt)`);
    // Least-squares fit lambda = a + b*x over {500,1000,1500,2000,2500}.
    const lambdas = [500, 1000, 1500, 2000, 2500];
    const n = 5, sx = col.ticks.reduce((a, b) => a + b, 0), sl = lambdas.reduce((a, b) => a + b, 0);
    const sxl = col.ticks.reduce((acc, x, i) => acc + x * lambdas[i], 0);
    const sxx = col.ticks.reduce((acc, x) => acc + x * x, 0);
    const b = (n * sxl - sx * sl) / (n * sxx - sx * sx);
    const a = (sl - b * sx) / n;
    col.xToLambda = (x) => a + b * x;
    col.left = (500 - a) / b - 200 / b; // pt coordinate of 300 nm (frame left edge)
    col.center = col.left + FRAME_W / 2;
  }
  // Y major ticks: horizontal, length > 3.5pt, at left edge of any column.
  const colLefts = columns.map((c) => c.left);
  const yMajors = ticks.filter((t) => t.axis === 'y' && t.len > 3.5 &&
    colLefts.some((L) => t.xMax > L - 6.5 && t.xMax <= L + 0.5));
  // Cluster tick y-positions into 3 panel rows (gaps > 40 pt).
  const ys = [...new Set(yMajors.map((t) => round2(t.at)))].sort((a, b) => a - b);
  const rows = [];
  for (const y of ys) {
    const last = rows[rows.length - 1];
    if (last && y - last.ticks[last.ticks.length - 1] < 40) last.ticks.push(y);
    else rows.push({ ticks: [y] });
  }
  if (rows.length !== 3) throw new Error(`expected 3 panel rows, found ${rows.length}`);
  // rows are ascending in y: bottom = panel III (linear), middle = panel II
  // (log K-M), top = panel I (linear). Canonical panel index: I=0, II=1, III=2.
  rows.forEach((row, i) => { row.panel = rows.length - 1 - i; });
  for (const row of rows) {
    if (row.ticks.length === 6) {
      // linear panel: ticks at 0, 0.2, ..., 1.0
      const vals = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
      const n = 6, sy = row.ticks.reduce((a, b) => a + b, 0), sv = vals.reduce((a, b) => a + b, 0);
      const syv = row.ticks.reduce((acc, y, i) => acc + y * vals[i], 0);
      const syy = row.ticks.reduce((acc, y) => acc + y * y, 0);
      const b = (n * syv - sy * sv) / (n * syy - sy * sy);
      const a = (sv - b * sy) / n;
      row.kind = 'linear';
      row.yToVal = (y) => a + b * y;
    } else if (row.ticks.length === 5) {
      // log panel (K-M coefficients): ticks at 10^-1 .. 10^3
      const exps = [-1, 0, 1, 2, 3];
      const n = 5, sy = row.ticks.reduce((a, b) => a + b, 0), sv = exps.reduce((a, b) => a + b, 0);
      const syv = row.ticks.reduce((acc, y, i) => acc + y * exps[i], 0);
      const syy = row.ticks.reduce((acc, y) => acc + y * y, 0);
      const b = (n * syv - sy * sv) / (n * syy - sy * sy);
      const a = (sv - b * sy) / n;
      row.kind = 'log';
      row.yToVal = (y) => 10 ** (a + b * y);
    } else {
      throw new Error(`panel row has ${row.ticks.length} y majors (expected 5 or 6)`);
    }
    row.yMin = Math.min(...row.ticks);
    row.yMax = Math.max(...row.ticks);
  }
  return { columns, rows };
}

const round2 = (v) => Math.round(v * 100) / 100;

/** Known stroke-color semantics of the LBNL chart panels. */
const CURVE_SEMANTICS = [
  { panel: 0, color: [0, 1, 0], key: 'reflectance' },              // I: film R over void (measured)
  { panel: 0, color: [0, 0, 1], key: 'transmittance' },            // I: film T over void (measured)
  { panel: 0, color: [1, 0, 0], key: 'absorptance' },              // I: film A over void (1 - R - T)
  { panel: 1, color: [0.627, 0.125, 0.941], key: 'km_K_per_mm' },  // II: K-M absorption K
  { panel: 1, color: [1, 0.843, 0], key: 'km_S_per_mm' },          // II: K-M backscattering S
  { panel: 2, color: [1, 0.647, 0], key: 'reflectance_over_white' }, // III: measured
  { panel: 2, color: [0, 0, 0], key: 'reflectance_over_black' },   // III: measured
];

const colorDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Extract per-column spectral curves from a chart.
 * Returns: columns: [ { curves: {key: {lambda: value}}, label, thickness..., s } ].
 */
function extractColumns(paths, texts, calib) {
  const { columns, rows } = calib;
  // Panel row y-bands (midpoints between adjacent rows as boundaries).
  const rowBounds = rows.map((r, i) => {
    const lo = i === 0 ? -Infinity : (rows[i - 1].yMax + r.yMin) / 2;
    const hi = i === rows.length - 1 ? Infinity : (r.yMax + rows[i + 1].yMin) / 2;
    return { lo, hi };
  });
  const result = columns.map(() => ({ raw: {} }));
  for (const p of paths) {
    if (p.pts.length < 100) continue;              // drop ticks, frames, legend swatches
    const mx = p.pts.reduce((a, q) => a + q[0], 0) / p.pts.length;
    const my = p.pts.reduce((a, q) => a + q[1], 0) / p.pts.length;
    const colIdx = columns.findIndex((c) => Math.abs(mx - c.center) < FRAME_W / 2 + 5);
    if (colIdx < 0) continue;
    const rowIdx = rows.findIndex((r, i) => my > rowBounds[i].lo && my <= rowBounds[i].hi);
    if (rowIdx < 0) continue;
    const sem = CURVE_SEMANTICS.find((s2) => s2.panel === rows[rowIdx].panel && colorDist(s2.color, p.color) < 0.05);
    if (!sem) continue;
    if (!p.solid) continue;                        // skip dashed "calculated" overlays
    if (result[colIdx].raw[sem.key]) continue;     // first solid curve wins (no duplicates expected)
    const col = columns[colIdx];
    const row = rows[rowIdx];
    const samples = [];
    for (const [x, y] of p.pts) {
      const lambda = col.xToLambda(x);
      const value = row.yToVal(y);
      samples.push([lambda, value]);
    }
    result[colIdx].raw[sem.key] = samples;
  }
  // Attach text metadata per column: film label (bottom), thicknesses, s ratio.
  for (const [ci, col] of columns.entries()) {
    const inCol = (t) => t.x >= col.left - 5 && t.x <= col.left + FRAME_W + 5;
    const bottom = texts.filter((t) => t.y < 55 && inCol(t)).sort((a, b) => a.y - b.y);
    result[ci].label = bottom.map((t) => t.text).join(' | ');
    const all = texts.filter((t) => inCol(t)).map((t) => t.text).join(' ');
    const voidM = /(\d+)\s+m m m\/\s*void/.exec(all);
    const whiteM = /(\d+)\s+m m m\/\s*white/.exec(all);
    const blackM = /(\d+)\s+m m m\/\s*black/.exec(all);
    const sM = /s\s*s\s*=\s*=\s*([\d.]+)/.exec(all);
    result[ci].thickness_um_void = voidM ? parseInt(voidM[1], 10) : null;
    result[ci].thickness_um_white = whiteM ? parseInt(whiteM[1], 10) : null;
    result[ci].thickness_um_black = blackM ? parseInt(blackM[1], 10) : null;
    result[ci].forward_scattering_ratio = sM ? parseFloat(sM[1]) : null;
  }
  return result;
}

/** Assemble the 441-point wavelength grid + curve arrays (null where clipped).
 *  `rawValues` skips rounding/clamping (used by the internal R+T+A QC so the
 *  metric measures pure digitization coherence, not clamping artifacts). */
function assembleSpectra(rawCurves, rawValues = false) {
  const wavelengths = [];
  for (let l = LAMBDA_MIN; l <= LAMBDA_MAX; l += LAMBDA_STEP) wavelengths.push(l);
  const out = { wavelengths_nm: wavelengths };
  const coverage = {};
  for (const key of ['reflectance', 'transmittance', 'absorptance', 'reflectance_over_white', 'reflectance_over_black', 'km_K_per_mm', 'km_S_per_mm']) {
    const arr = new Array(N_WAVELENGTHS).fill(null);
    const pts = rawCurves[key];
    if (pts) {
      let placed = 0;
      for (const [lambda, value] of pts) {
        const lr = Math.round(lambda);
        if (Math.abs(lambda - lr) > 0.5) continue;          // off-grid vertex (should not happen)
        const idx = (lr - LAMBDA_MIN) / LAMBDA_STEP;
        if (!Number.isInteger(idx) || idx < 0 || idx >= N_WAVELENGTHS) continue;
        if (arr[idx] === null) { arr[idx] = rawValues ? value : roundVal(key, value); placed++; }
      }
      coverage[key] = placed;
    } else {
      coverage[key] = 0;
    }
    out[key] = arr;
  }
  return { spectra: out, coverage };
}

const roundVal = (key, v) => {
  // Linear-panel quantities (R/T/A over any background) are physically bounded
  // to [0,1]; clamp sub-quantization jitter (|v| < 0.0003 observed at true
  // zeros) and guard against real excursions (would indicate miscalibration).
  if (!key.startsWith('km_')) {
    const clamped = Math.min(1, Math.max(0, v));
    if (Math.abs(clamped - v) > 0.005) {
      throw new Error(`calibration guard: ${key} value ${v} far outside [0,1]`);
    }
    v = clamped;
  }
  const r = key.startsWith('km_') ? 4 : 5;
  const f = 10 ** r;
  return Math.round(v * f) / f;
};

/** Kubelka-Munk opaque-layer reflectance R_inf from K and S (MASTER_PLAN §1.4). */
function rInfFromKS(K, S) {
  return K.map((k, i) => {
    const s = S[i];
    if (k === null || s === null || s <= 0) return null;
    const q = k / s;
    const r = 1 + q - Math.sqrt(q * q + 2 * q);
    return Math.round(Math.max(0, Math.min(1, r)) * 1e5) / 1e5;
  });
}

/* ------------------------------------------------------------------------ */
/* Chart drivers: ladder / masstone / mixture.                               */
/* ------------------------------------------------------------------------ */

function loadChart(rel) {
  const p = path.join(RAW_DIR, rel);
  const buf = readFileSync(p);
  const streams = pdfContentStreams(buf);
  if (!streams.length) throw new Error(`no content streams in ${rel}`);
  const { paths, texts } = parseContent(streams.join('\n'));
  const calib = calibrate(paths);
  return { columns: extractColumns(paths, texts, calib), calib, rel };
}

const SAMPLE_PROVENANCE = (rel, url) => ({
  chart_pdf: `model/datasets/raw/lbnl/${rel}`,
  chart_url: url,
  method: 'vector digitization of published spectral chart PDF (native 300-2500 nm @ 5 nm grid; axis calibration from tick marks)',
});

function baseSample(sampleId, kind, mixPartners, colInfo, chartRel, chartUrl) {
  const { spectra, coverage } = assembleSpectra(colInfo.raw);
  return {
    sample_id: sampleId,
    kind,
    mix_partners: mixPartners,
    film: {
      label: colInfo.label ?? null,
      thickness_um_void: colInfo.thickness_um_void ?? null,
      thickness_um_white: colInfo.thickness_um_white ?? null,
      thickness_um_black: colInfo.thickness_um_black ?? null,
      forward_scattering_ratio: colInfo.forward_scattering_ratio ?? null,
    },
    wavelengths_nm: spectra.wavelengths_nm,
    reflectance: spectra.reflectance,                            // film over void, measured (panel I)
    transmittance: spectra.transmittance,                        // film over void, measured (panel I)
    reflectance_over_white: spectra.reflectance_over_white,      // measured (panel III)
    reflectance_over_black: spectra.reflectance_over_black,      // measured (panel III)
    km_K_per_mm: spectra.km_K_per_mm,                            // K-M absorption (panel II)
    km_S_per_mm: spectra.km_S_per_mm,                            // K-M backscattering (panel II)
    r_inf_km: rInfFromKS(spectra.km_K_per_mm, spectra.km_S_per_mm), // derived (opaque-layer)
    qc: { points_digitized: coverage },
    provenance: SAMPLE_PROVENANCE(chartRel, chartUrl),
  };
}

/** Internal QC: R+T+A must equal 1 at every wavelength (panel I physics). */
function qcRTA(colInfo) {
  const { spectra } = assembleSpectra(colInfo.raw, true);
  let maxDev = 0, n = 0;
  for (let i = 0; i < N_WAVELENGTHS; i++) {
    const R = spectra.reflectance[i], T = spectra.transmittance[i], A = spectra.absorptance[i];
    if (R === null || T === null || A === null) continue;
    maxDev = Math.max(maxDev, Math.abs(R + T + A - 1));
    n++;
  }
  return { maxDev: Math.round(maxDev * 1e5) / 1e5, n };
}

function runDigitize() {
  const pigments = [];
  const qcReport = [];
  const pigmentEntry = (code) => ({
    pigment_id: PAINTS[code].ci ?? code,
    ci_name: PAINTS[code].ci,
    name: PAINTS[code].name,
    role: PAINTS[code].role,
    proxy_for: PAINTS[code].proxy_for,
    lbnl_paint_code: code,
    lbnl_page: PAGE_URL(code),
    samples: [],
  });

  // 1) Own charts: tint ladders (masstone + 1:4 + 1:9) and masstone charts.
  for (const code of Object.keys(PAINTS)) {
    const entry = pigmentEntry(code);
    if (MASSTONE_ONLY.has(code)) {
      const rel = `charts/${code}-masstone-spectral-chart.pdf`;
      const chart = loadChart(rel);
      if (chart.columns.length !== 1) throw new Error(`${rel}: expected 1 column, got ${chart.columns.length}`);
      const col = chart.columns[0];
      entry.samples.push(baseSample(`${code}-masstone`, 'masstone', [], col, rel, CHART_URL(`${code}-masstone`)));
      qcReport.push({ chart: rel, cols: 1, qc: [qcRTA(col)] });
    } else {
      const rel = `charts/${code}-tint-ladder-spectral-chart.pdf`;
      const chart = loadChart(rel);
      if (chart.columns.length !== 4) throw new Error(`${rel}: expected 4 columns, got ${chart.columns.length}`);
      const kinds = ['masstone', 'tint_1_4', 'tint_1_9'];
      for (let i = 0; i < 3; i++) {
        const col = chart.columns[i];
        entry.samples.push(baseSample(
          i === 0 ? `${code}-masstone` : `${code}-tint-1-to-${i === 1 ? 4 : 9}`,
          kinds[i], i === 0 ? [] : ['PW6'], col, rel, CHART_URL(`${code}-tint-ladder`)));
      }
      // Column 4 is the W03 titanium white film used for the tints. The
      // canonical W03 sample comes from W03's own masstone chart; here we only
      // cross-check digitization reproducibility (see QC report).
      const w03col = chart.columns[3];
      const { spectra } = assembleSpectra(w03col.raw);
      entry._w03_crosscheck = spectra.reflectance;
      qcReport.push({ chart: rel, cols: 4, qc: chart.columns.map(qcRTA) });
    }
    pigments.push(entry);
  }

  // 2) Mixture charts: middle column = 1:1 mixture film; outer columns are the
  //    partner masstones (already covered by each partner's own ladder chart,
  //    used here only to verify column assignment via bottom labels).
  const byCode = Object.fromEntries(pigments.map((p) => [p.lbnl_paint_code, p]));
  for (const mx of MIXTURES) {
    const rel = `charts/${mx.file}-mixture-1-to-1-spectral-chart.pdf`;
    const chart = loadChart(rel);
    if (chart.columns.length !== 3) throw new Error(`${rel}: expected 3 columns, got ${chart.columns.length}`);
    const mixCol = chart.columns[1];
    const partner = mx.attachTo === mx.a ? mx.b : mx.a;
    const partnerCi = PAINTS[partner].ci ?? partner;
    const sample = baseSample(`${mx.file}-mixture-1-to-1`, 'mix_1_1', [partnerCi], mixCol, rel, CHART_URL(`${mx.file}-mixture-1-to-1`));
    sample.mix_recipe = `volume ${mx.a}:volume ${mx.b} = 1:1 (wet paint)`;
    byCode[mx.attachTo].samples.push(sample);
    qcReport.push({ chart: rel, cols: 3, qc: chart.columns.map(qcRTA), labels: chart.columns.map((c) => (c.label ?? '').slice(0, 60)) });
  }

  // 3) QC summary.
  let worstRTA = 0;
  for (const q of qcReport) for (const c of q.qc) worstRTA = Math.max(worstRTA, c.maxDev);
  console.log(`[digitize] charts parsed: ${qcReport.length}; worst |R+T+A-1| over all columns: ${worstRTA}`);
  // W03 reproducibility: U14 ladder col4 vs W03 masstone chart.
  const u14 = byCode.U14; const w03 = byCode.W03;
  if (u14?._w03_crosscheck && w03?.samples.length) {
    const a = u14._w03_crosscheck, b = w03.samples[0].reflectance;
    let se = 0, n = 0;
    for (let i = 0; i < N_WAVELENGTHS; i++) {
      if (a[i] === null || b[i] === null) continue;
      se += (a[i] - b[i]) ** 2; n++;
    }
    const rmse = Math.sqrt(se / n);
    console.log(`[digitize] W03 cross-chart RMSE (U14 ladder col4 vs W03 masstone chart, R over void): ${rmse.toFixed(5)} over ${n} pts`);
  }
  for (const p of pigments) delete p._w03_crosscheck;

  const totalSamples = pigments.reduce((acc, p) => acc + p.samples.length, 0);
  const dataset = {
    version: 1,
    source: 'LBNL Pigment Database',
    source_url: `${BASE}/database.html`,
    retrieved: RETRIEVED,
    license: 'Public data published by LBNL Heat Island Group (no explicit license stated); cite Levinson, Berdahl & Akbari 2005 (Solar Energy Materials & Solar Cells, Parts I-II) and the database URL. See docs/DATA_SOURCES.md.',
    method: 'Digitized from published vector spectral chart PDFs; canonical tab-delimited datafiles exist as AES-128 encrypted zips (archived verbatim under model/datasets/raw/lbnl/zips/). Wavelengths are the native 300-2500 nm @ 5 nm measurement grid (441 points); null = value outside plotted range (clipped). No resampling performed.',
    grid: { wavelength_min_nm: LAMBDA_MIN, wavelength_max_nm: LAMBDA_MAX, wavelength_step_nm: LAMBDA_STEP, points: N_WAVELENGTHS },
    pigments,
  };
  mkdirSync(PROCESSED_DIR, { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(dataset));
  console.log(`[digitize] wrote ${OUT_JSON}: ${pigments.length} pigments, ${totalSamples} samples`);
}

/* ------------------------------------------------------------------------ */

async function main() {
  const cmd = process.argv[2] ?? 'all';
  const force = process.argv.includes('--force');
  if (cmd === 'fetch' || cmd === 'all') await runFetch(force);
  if (cmd === 'digitize' || cmd === 'all') runDigitize();
  if (!['fetch', 'digitize', 'all'].includes(cmd)) {
    console.error('usage: node scripts/fetch-lbnl.mjs [fetch|digitize|all] [--force]');
    process.exitCode = 2;
  }
}

await main();
