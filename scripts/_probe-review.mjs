// Verification probe for review issues 3, 6, 8, 9 (read-only).
import { readFileSync } from 'node:fs';

const d = JSON.parse(readFileSync('model/datasets/processed/pigments.json', 'utf8'));

// Issue 6: role counts + mixture participation
const roleCounts = {};
for (const p of d.pigments) roleCounts[p.role] = (roleCounts[p.role] ?? 0) + 1;
console.log('role counts:', roleCounts);
const partners = new Set();
for (const p of d.pigments)
  for (const s of p.samples)
    if (s.kind === 'mix_1_1') for (const m of s.mix_partners) partners.add(m);
console.log('distinct mix_partners:', [...partners], 'count:', partners.size);
const owners = new Set();
for (const p of d.pigments)
  for (const s of p.samples) if (s.kind === 'mix_1_1') owners.add(p.pigment_id);
console.log('mixture owners:', [...owners], 'count:', owners.size);

// Issue 8: thickness range over all samples
const thick = [];
for (const p of d.pigments)
  for (const s of p.samples)
    for (const k of ['thickness_um_void', 'thickness_um_white', 'thickness_um_black'])
      if (typeof s.film?.[k] === 'number') thick.push({ id: s.sample_id, k, v: s.film[k] });
thick.sort((a, b) => a.v - b.v);
console.log('thickness n:', thick.length, 'min:', thick[0], 'max:', thick.at(-1));
const vals = thick.map((t) => t.v).sort((a, b) => a - b);
const med = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
console.log('thickness mean:', (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2), 'median:', med);
console.log('below 20:', vals.filter((v) => v < 20).length, 'above 30:', vals.filter((v) => v > 30));

// Issue 3: nulls inside 380-750 in reflectance, and gap structure after dropping nulls
const inWindow = [];
for (const p of d.pigments)
  for (const s of p.samples) {
    const wl = s.wavelengths_nm, r = s.reflectance;
    for (let i = 0; i < wl.length; i++) {
      if (r[i] === null && wl[i] >= 380 && wl[i] <= 750) inWindow.push(`${s.sample_id}@${wl[i]}`);
    }
  }
console.log('reflectance nulls inside 380-750:', inWindow.length ? inWindow : 'none');
// max gap between kept points within 380..750 window edges
let worstGap = 0, worstGapId = null;
let minKept = Infinity, maxKept = -Infinity;
for (const p of d.pigments)
  for (const s of p.samples) {
    const kept = [];
    for (let i = 0; i < s.wavelengths_nm.length; i++) if (s.reflectance[i] !== null) kept.push(s.wavelengths_nm[i]);
    minKept = Math.min(minKept, kept[0]);
    maxKept = Math.max(maxKept, kept.at(-1));
    for (let i = 1; i < kept.length; i++) {
      const g = kept[i] - kept[i - 1];
      if (g > worstGap) { worstGap = g; worstGapId = s.sample_id; }
    }
  }
console.log('kept range across samples: [', minKept, ',', maxKept, '] worst consecutive gap:', worstGap, 'at', worstGapId);

// Issue 9: tint ordering visible vs full-range (median)
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
for (const p of d.pigments) {
  const get = (kind) => p.samples.find((s) => s.kind === kind);
  const m = get('masstone'), t4 = get('tint_1_4'), t9 = get('tint_1_9');
  if (!m || !t4 || !t9) continue;
  const bandMed = (s, lo, hi) => {
    const xs = [];
    for (let i = 0; i < s.wavelengths_nm.length; i++) {
      const w = s.wavelengths_nm[i];
      if (w >= lo && w <= hi && s.reflectance[i] !== null) xs.push(s.reflectance[i]);
    }
    return median(xs);
  };
  const vis = [bandMed(m, 380, 750), bandMed(t4, 380, 750), bandMed(t9, 380, 750)];
  const full = [bandMed(m, 300, 2500), bandMed(t4, 300, 2500), bandMed(t9, 300, 2500)];
  const okVis = vis[0] < vis[1] && vis[1] < vis[2];
  const okFull = full[0] < full[1] && full[1] < full[2];
  if (!okVis || !okFull)
    console.log(`ladder ${p.pigment_id} (${p.lbnl_paint_code}): visible [${vis.map((v) => v.toFixed(4))}] ok=${okVis} | full [${full.map((v) => v.toFixed(4))}] ok=${okFull}`);
}
console.log('probe done');
