# Datasets

Spectral datasets for the pigment-proxy mixing engine (MASTER_PLAN Step 3, §3.1–§3.2).
All physics/math consuming these files lives in `packages/color-science`; this
directory only stores data.

## Layout

```
model/datasets/
├── raw/
│   └── lbnl/                     # LBNL Pigment Database, fetched verbatim
│       ├── MANIFEST.json         # every downloaded file: url, sha256, bytes, status
│       ├── pages/                # database.html + paint page HTML snapshots
│       ├── zips/                 # canonical spectral datafiles (AES-128 encrypted, see below)
│       ├── charts/               # spectral chart PDFs (vector; the digitization source)
│       └── misc/                 # spectral-datafile-guide.pdf (column definitions)
└── processed/
    └── pigments.json             # unified dataset consumed by the color engine
```

Regenerate everything (idempotent; cached files are kept unless `--force`):

```bash
node scripts/fetch-lbnl.mjs all        # fetch + digitize
node scripts/fetch-lbnl.mjs fetch      # raw artifacts only
node scripts/fetch-lbnl.mjs digitize   # raw/lbnl/charts -> processed/pigments.json
```

## Important: how the LBNL spectra were obtained

The canonical LBNL spectral datafiles (`raw/lbnl/zips/*.zip`, one tab-delimited
text file per film) are stored by LBNL as **WinZip AES-128 encrypted archives**
— see the note in `raw/lbnl/misc/spectral-datafile-guide.pdf`: the decryption
key is only issued to Cool Colors project members. We archive these files
verbatim (they remain the canonical raw artifacts and can be decrypted later
if the key is obtained), but we **cannot read them**.

The same measurements are published as **vector spectral chart PDFs** (one
polyline vertex per measured wavelength). `scripts/fetch-lbnl.mjs digitize`
recovers the spectra from those charts:

- native grid **300–2500 nm @ 5 nm (441 points)** — recorded per sample,
  **not resampled** (resampling to the shared 380–750 nm @ 10 nm grid of
  `packages/color-science/src/spectrum.ts` happens at validation time);
- axis calibration is recovered per chart from the vector tick marks
  (x majors at 500/1000/1500/2000/2500 nm; linear y panels 0–1; K–M panel
  log10 10^-1–10^3 mm^-1, verified uniform across all 33 charts);
- curves are identified by stroke color; dashed "calculated" overlays are
  excluded (only measured curves are digitized).

### Digitization QC (all must hold; re-checked on every `digitize` run)

1. `R + T + A = 1` at every wavelength for every film (three independently
   drawn curves) — worst deviation observed: **1.5e-4** (plot quantization).
2. W03 titanium white digitized from two different charts agrees to
   **RMSE = 0** (441/441 points).
3. Tint ladder ordering `masstone < 1:4 < 1:9` in mean visible reflectance
   (380–750 nm) holds for all 14 ladders. Outside the visible band (NIR/UV),
   inversions occur and are physical (e.g. TiO2 NIR absorption, P05
   thin-film interference).
4. Spectra converted with the project's own engine (D65 → Lab) give the
   expected hues (PV23 tint h≈305, PB15 tint h≈245, white L*≈94, C*≈2).

Estimated digitization error is ≲0.001 absolute in reflectance (PDF
coordinates are written with 0.01 pt precision over a ~93 pt 0–1 axis).

## `processed/pigments.json` format

```jsonc
{
  "version": 1,
  "source": "LBNL Pigment Database",
  "retrieved": "2026-08-09",
  "grid": { "wavelength_min_nm": 300, "wavelength_max_nm": 2500, "wavelength_step_nm": 5, "points": 441 },
  "pigments": [
    {
      "pigment_id": "PV23",            // Color Index id (paint code used if no CI id)
      "name": "Dioxazine Purple",       // LBNL paint name
      "role": "proxy_purple",           // proxy_red|proxy_magenta|proxy_purple|proxy_blue|white|auxiliary|mixture_partner
      "proxy_for": "...",               // MASTER_PLAN §3.1 target this stands in for
      "lbnl_paint_code": "U14",
      "lbnl_page": "https://...",
      "samples": [
        {
          "sample_id": "U14-masstone",
          "kind": "masstone",           // masstone | tint_1_4 | tint_1_9 | mix_1_1
          "mix_partners": [],           // CI ids of other components (["PW6"] for tints)
          "mix_recipe": "...",          // mix_1_1 only: volume ratio string
          "film": {
            "label": "[U14] Dioxazine Purple Carbazole Dioxazine (PV 23 RS) 13.0% PVC ...",
            "thickness_um_void": 10,     // film thickness per measurement configuration
            "thickness_um_white": 11,
            "thickness_um_black": 12,
            "forward_scattering_ratio": 0.37
          },
          "wavelengths_nm": [300, 305, "..." , 2500],   // 441 values
          "reflectance": ["..."],        // MEASURED film reflectance over void background, [0,1]
          "transmittance": ["..."],      // MEASURED film transmittance over void, [0,1]
          "reflectance_over_white": ["..."], // MEASURED over opaque white background
          "reflectance_over_black": ["..."], // MEASURED over opaque black background
          "km_K_per_mm": ["..."],        // Kubelka–Munk absorption K(λ), mm^-1 (from panel II)
          "km_S_per_mm": ["..."],        // Kubelka–Munk backscattering S(λ), mm^-1
          "r_inf_km": ["..."],           // DERIVED opaque-layer reflectance 1+K/S-sqrt((K/S)^2+2K/S)
          "qc": { "points_digitized": { "...": 441 } },
          "provenance": { "chart_pdf": "...", "chart_url": "...", "method": "..." }
        }
      ]
    }
  ]
}
```

### Field semantics and caveats

- **All measured arrays are complete (0% null).** `km_K_per_mm` / `km_S_per_mm`
  are `null` where the published curve leaves the plotted window
  (10^-1–10^3 mm^-1): ~8% / ~11% of points, typically K of white/tints in
  weakly absorbing bands and S of dark masstones inside the absorption band.
  `r_inf_km` is `null` wherever K or S is `null` (~13%). Downstream K–M
  fitting must handle `null` (treat clipped K as ≤ 0.1 mm^-1, never as 0
  exactly, when an estimate is needed).
- `reflectance` is the **film over void** measurement: the film is thin
  (≈10–37 µm, see `film.thickness_um_*`), so it is NOT an opaque-layer
  reflectance. For masstones of strong colorants it is close to R∞ in the
  absorption band; for tints/white it is strongly influenced by film
  thickness. Use `km_K_per_mm` / `km_S_per_mm` (intrinsic, thickness-free)
  for K–M work; `r_inf_km` derives the opaque-layer reflectance from them.
- Tints are **wet-paint volume ratios** with W03 titanium white
  (`1:4` = 1 volume colored paint : 4 volumes W03).
- `mix_1_1` samples are real measured 1:1 (by wet volume) non-white mixtures —
  the MASTER_PLAN §3.2 ground truth for validating the K–M engine: fit on
  masstone/tints, predict these, compare.
- PR254 and PR122 do not exist in the LBNL database; the red/magenta roles
  are filled by the closest quinacridones (see `proxy_for` fields and
  `docs/DATA_SOURCES.md`).

## Pigment inventory (MASTER_PLAN §3.1 mapping)

| Role | Paint | CI | MASTER_PLAN target | Samples |
|---|---|---|---|---|
| proxy_red | R07 Acra Red | PR209 (quinacridone red γ) | PR254 Pyrrole Red (absent from LBNL) | masstone, 1:4, 1:9 |
| proxy_magenta | R08 Monastral Red | PV19 (quinacridone scarlet) | PR122 Quinacridone Magenta (absent) | masstone only |
| proxy_purple | U14 Dioxazine Purple | PV23 | exact match | masstone, 1:4, 1:9, 3× mix 1:1 |
| proxy_blue | U12 Phthalo Blue (i) | PB15 | exact match | masstone, 1:4, 1:9, 5× mix 1:1 |
| white | W03 Titanium White (i) | PW6 | exact match | masstone |
| auxiliary | R09 Naphthol Red Light | PR9 | alt red, 4× mix 1:1 | full ladder + mixes |
| auxiliary | U11 French Ultramarine | PB29 | §3.1 alternative blue | full ladder + 3× mix 1:1 |
| auxiliary | R06 Acra Burnt Orange | PR206 | quinacridone | full ladder |
| auxiliary | U13 Phthalo Blue (ii) | PB15 | second PB15 paint | masstone |
| auxiliary | W04 Titanium White (ii) | PW6 | second PW6 paint | masstone |
| mixture_partner | B13, B16, Y01, U03, R03, G03, Y13, P05 | various | 1:1 mix partners | full ladders |

Mixture samples (kind `mix_1_1`) are attached to the target pigment's entry
(U14: +B13/+B16/+Y01; U12: +U03/+R03/+G03/+Y13/+P05; U11: +U03/+G03/+Y01;
R09: +G03/+U03/+R03/+P05). Both partners' own ladder data are present in the
file, so every 1:1 mixture is predictable from in-file data.

## License / attribution

See `docs/DATA_SOURCES.md`. In short: public data from the LBNL Heat Island
Group; cite Levinson, Berdahl & Akbari (2005), *Solar Energy Materials &
Solar Cells* Parts I–II, and the database URL.
