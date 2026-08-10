# MODEL CARD — V0 Pigment-Proxy Spectral Mixing Engine

> **Model version:** V0 (pigment proxy, pre-hair)
> **Date:** 2026-08-09
> **Status:** VALIDATED against LBNL held-out mixtures — MASTER_PLAN §17 Step 4 gate PASSED (median ΔE00 = 3.44 < 5)
> **References:** MASTER_PLAN §1.4, §3.2, §4.1, §8, §9, §17 Steps 1–4, §24

---

## 1. Model domain and scope

**What this model is.** A Kubelka–Munk (K-M) two-constant spectral mixing
engine for **artist paint pigments**, calibrated from the LBNL Pigment
Database. It predicts the reflectance spectrum (and derived XYZ / CIELAB /
LCh / sRGB) of a physical pigment mixture from the per-pigment
K(λ), S(λ) fingerprints fitted to white-dilution tint ladders.

**What this model is NOT (MASTER_PLAN §4.1, forbidden claims).**

- This is a **pigment proxy** for pipeline validation. It is **not** a hair
  model and its output must never be presented as "the colour you will get
  on hair". The approved wording is: *"spectral mixing model preview — not
  yet calibrated to a hair substrate"*.
- Accuracy numbers below describe **paint films measured by LBNL**, not
  hair. They must not be inherited by any hair-dye claim (§20, error 2).
- No RGB-weighted averaging is used anywhere in the physical model; sRGB is
  display-only, the last pipeline step (§1.1).

## 2. Pipeline

```text
LBNL spectrum (300–2500 nm @ 5 nm)
  → resampleLinear            (linear interpolation onto 380–750 nm @ 10 nm, 38 pts)
  → fitTwoConstantFromTintLadder
      (per-λ least squares over masstone + 1:4 + 1:9 tint rungs;
       white scale fixed from PW6 masstone: S_w = 1, K_w = (1−R_w)²/2R_w;
       coarse grid + Nelder–Mead in (ln K, ln S); dependency-free)
  → K(λ), S(λ) fingerprint per pigment
  → mixKubelkaMunk            (K_mix = Σ cᵢKᵢ, S_mix = Σ cᵢSᵢ, R∞ = 1+q−√(q²+2q))
  → spectrumToXyz → xyzToLab  (D65, CIE 1931 2°, embedded CIE tables)
  → deltaE2000                (CIEDE2000, kL = kC = kH = 1)
  → sRGB/HEX                  (display only)
```

Implementation: `packages/color-science/src/` (`resample.ts`, `tintFit.ts`,
`kubelkaMunk.ts`, `xyz.ts`, `lab.ts`, `deltaE2000.ts`, `srgb.ts`).

## 3. Data provenance

| Item | Value |
|---|---|
| Source | LBNL Pigment Database (Lawrence Berkeley National Laboratory, Heat Island Group), https://coolcolors.lbl.gov/LBNL-Pigment-Database/database.html |
| Dataset artifact | `model/datasets/processed/pigments.json` (retrieved 2026-08-09, version 1) |
| Acquisition | Digitized from published vector spectral chart PDFs (native 300–2500 nm @ 5 nm; axis calibration from tick marks); null = outside plotted range |
| License | Public data, no explicit license stated; cite Levinson, Berdahl & Akbari 2005 (Solar Energy Materials & Solar Cells, Parts I–II) + database URL (see `docs/DATA_SOURCES.md`) |
| White reference | PW6 Titanium White (i), sample `W03-masstone` (fixes the K/S scale for every fit) |
| Tint convention | 1:4 tint = pigment fraction 0.2; 1:9 tint = pigment fraction 0.1 (volume ratios, per LBNL film labels) |
| Contents | 18 pigment entries: 4 color proxies (PR209 red, PV19 magenta*, PV23 purple, PB15 blue), PW6 white, auxiliary paints, and 8 mixture partners with full tint ladders; 15 real 1:1 non-white mixture spectra |

\* PV19 (proxy_magenta) has a masstone only — no tint ladder, not usable for
two-constant fitting, and it appears in no 1:1 mixture. Duplicated CI ids
(PB15 i/ii, PW6 i/ii) are resolved to the entry with a full ladder.

## 4. Validation method (MASTER_PLAN §17 Step 4)

**Held-out ground truth.** LBNL provides both the white-dilution tint
ladders (fitting data) and real measured 1:1 non-white mixtures (test
data). The protocol never mixes the two:

1. Fit each pigment's two-constant fingerprint from **its own ladder only**
   (masstone + 1:4 + 1:9). Mixture samples are never used during fitting.
2. Predict every available 1:1 mixture spectrum with the two-constant
   engine at c = 0.5/0.5.
3. Score against the measured mixture spectrum: spectral RMSE/MAE over the
   38-point grid, and ΔE00 via D65/2° XYZ → Lab → CIEDE2000.
4. Comparison baseline: single-constant engine (`mixKoverS` on masstone
   K/S ratios) scored identically.

**Acceptance bar (§17 Step 4 / §9 V1-style):** median two-constant ΔE00
< 5. Per the plan, missing this bar blocks all hair-substrate work until
the spectral engine is fixed.

Ladder fit quality (RMS reflectance residual across each pigment's own
masstone + tints, all 38 wavelengths):

| Pigment | Name | Ladder RMSE |
|---|---|---|
| PV23 | Dioxazine Purple | 0.006088 |
| PBr7 | Burnt Sienna | 0.007194 |
| PBk12 | Iron Titanium Brown Spinel (i) | 0.003312 |
| PY42 | Yellow Oxide | 0.004099 |
| PB15 | Phthalo Blue (i) | 0.005421 |
| PB28 | Cobalt Aluminate Blue Spinel (iii) | 0.005090 |
| PR101 | Red Iron Oxide (iii) | 0.004587 |
| G03 | Chromium Green-Black Modified | 0.003089 |
| PY74 | Yellow Medium Azo | 0.008983 |
| P05 | Interference Green (pearlescent) | 0.009526 |
| PR9 | Naphthol Red Light | 0.007024 |
| PB29 | French Ultramarine Blue | 0.004225 |

## 5. Results (2026-08-09 run, 15 held-out mixtures)

Machine-readable artifact: `model/validation/lbnl-report.json` (regenerated
by the validation test on every run).

| Mixture (LBNL codes) | Pigments | ΔE00 (two-constant) | RMSE | MAE | ΔE00 (single-constant) |
|---|---|---|---|---|---|
| B13+U14 | PV23 + PBr7 | 2.2485 | 0.005119 | 0.004045 | 4.5834 |
| U14+B16 | PV23 + PBk12 | 1.7838 | 0.037523 | 0.020347 | 8.9641 |
| U14+Y01 | PV23 + PY42 | 3.8456 | 0.039486 | 0.022713 | 7.7706 |
| U03+U12 | PB15 + PB28 | 0.9158 | 0.008700 | 0.007246 | 3.5354 |
| U12+R03 | PB15 + PR101 | 1.4764 | 0.003773 | 0.003175 | 10.7527 |
| U12+G03 | PB15 + G03 | 1.3131 | 0.004914 | 0.004269 | 4.2322 |
| Y13+U12 | PB15 + PY74 | 5.8769 | 0.008672 | 0.006814 | 12.3707 |
| P05+U12 | PB15 + P05 | **22.4589** | 0.072425 | 0.047020 | 20.1838 |
| G03+R09 | PR9 + G03 | 7.3681 | 0.074456 | 0.048818 | 11.5610 |
| R09+U03 | PR9 + PB28 | 6.2145 | 0.043792 | 0.029085 | 13.2522 |
| R09+R03 | PR9 + PR101 | 2.2990 | 0.038525 | 0.025379 | 1.4313 |
| R09+P05 | PR9 + P05 | 3.3469 | 0.057228 | 0.044037 | 3.8501 |
| U11+U03 | PB29 + PB28 | 3.4359 | 0.024089 | 0.014165 | 1.2545 |
| U11+G03 | PB29 + G03 | 5.2847 | 0.008002 | 0.007221 | 5.8911 |
| U11+Y01 | PB29 + PY42 | 5.8934 | 0.033715 | 0.022229 | 21.4590 |

**Summary**

| Metric | Two-constant (production) | Single-constant (baseline) |
|---|---|---|
| **Median ΔE00** | **3.4359** | 7.7706 |
| Median spectral RMSE | 0.033715 | 0.034953 |
| Median spectral MAE | 0.020347 | 0.022869 |
| Max ΔE00 | 22.4589 (P05+U12) | 21.4590 (U11+Y01) |
| **Acceptance: median ΔE00 < 5** | **PASS** | (would fail) |

**Interpretation.**

- The two-constant engine passes the §17 Step 4 gate with margin
  (3.44 < 5) and clearly outperforms the single-constant variant
  (3.44 vs 7.77 median ΔE00), confirming that separating K from S via the
  tint ladder — not just tracking the K/S ratio — is load-bearing.
- 12 of 15 mixtures land at ΔE00 ≤ 6.2; best cases are ≈ 0.9–1.5.
- The dominant outlier, P05+U12 (ΔE00 = 22.5), involves **P05
  "Interference Green", a pearlescent flake pigment**. Its colour comes
  from directional thin-film interference, not diffuse absorption/
  scattering, so it sits outside K-M's assumptions by construction; the
  failure is expected and physically explained, not an engine bug.
- The PR9 mixtures with G03/PB28 (ΔE00 = 7.4 / 6.2) are the weakest
  K-M-consistent cases; PR9's ladder residual (0.0070) is unremarkable, so
  the residual error is likely genuine two-constant model mismatch
  (finite-thickness films, pigment-specific interactions).

## 6. Known limitations

1. **Pigment proxy, not hair.** Paint films on opaque charts ≠ dye on
   keratin fibre. No hair claim is licensed by these numbers (§4.1, §20).
2. **Infinite-thickness approximation.** The engine models R∞ of an opaque
   layer; LBNL films are ~10–37 µm (median ~23 µm) and measured with a background. The
   tint-ladder fit absorbs part of this systematic error, but not all.
3. **Effect pigments out of scope.** Interference/pearlescent pigments
   (P05) violate diffuse K-M assumptions; predictions involving them carry
   large errors (see P05+U12). Metallic/gonioapparent colorants need a
   different model.
4. **Digitization noise.** Spectra were digitized from published charts;
   ladder residuals (0.003–0.010 RMSE) bound the achievable mixture error.
5. **Per-wavelength independent fits.** No spectral smoothness is imposed
   on K(λ), S(λ); at wavelengths where a pigment is nearly white-like the
   (K, S) pair is weakly identified (flat loss valley) — harmless for
   prediction, but individual coefficients there should not be
   over-interpreted.
6. **Single white scale.** All fingerprints are commensurate only because
   they share the W03 white anchor (S_w = 1). Mixing fingerprints fitted
   against a different white without rescaling is invalid.
7. **Fixed 1:1 ratio evidence.** Held-out validation covers 1:1 mixtures
   only; other ratios are interpolations/extrapolations of the same engine
   and unvalidated here.
8. **D65 / 2° only.** Metrics are computed for one illuminant/observer;
   metamerism under other illuminants is untested.

## 7. Next steps (toward V0.5, MASTER_PLAN §4.2 / §17 Steps 5–6)

1. Web V0 four-slider UI on this validated engine, labelled "pigment proxy
   spectral model" (§17 Step 5).
2. Build the hair base-reflectance library (levels 8/9/10 first) — real
   R_base(λ), never a single HEX per level.
3. First real hair-swatch experiment batch (one brand, one line, fixed
   protocol per §6.3), then fit the substrate/adsorption layer; keep the
   empirical-layer + physical-layer hybrid (§4.2) and the physics +
   learned-residual structure (§15).
4. Extend validation to non-1:1 pigment ratios if LBNL-style data is
   acquired; treat effect pigments as a separate model domain.
5. Wire the confidence tiers (measured / interpolated / extrapolated, §10)
   into every prediction response.

## 8. Reproducibility

```bash
# full unit + validation suite (writes model/validation/lbnl-report.json)
pnpm --filter @hair/color-science test

# only the external validation gate
pnpm --filter @hair/color-science exec vitest run test/lbnl.validation.test.ts

# typecheck
pnpm --filter @hair/color-science typecheck
```

The validation test **skips with a printed TODO** when
`model/datasets/processed/pigments.json` is absent (pre-acquisition state),
**throws at collection time** when the file exists but is corrupt or holds no
`mix_1_1` samples (failed acquisition must not silently pass the gate), and
**fails loudly** when the median two-constant ΔE00 ≥ 5 — per
§17 Step 4, either condition blocks hair-substrate modelling.
