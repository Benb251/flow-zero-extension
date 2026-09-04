# FlowZero V8 Hybrid Benchmark Report

- Generated: 2026-09-04T07:01:42.487Z · runtime 491.1s · node v22.22.3 · mode: QUICK
- A = V7 baseline (fd73313) · B = candidate ZIP V8 · C = Conservative master (f4e3c09) · D = Hybrid prototype
- Corpus: 60 restoration positives (+2 4K e2e) · 42 negatives · 24 hard-negatives · 3000 D mass negatives · 27+48 calibration
- Frozen gates (calibrated): {"ncc":0.45,"coarse":0.42,"strictStrong":0.68,"robust":0.58}

## Plan acceptance checks

| Rule | Value | Threshold | Pass |
|---|---|---|---|
| Hybrid >= best(V7,V8) - 0.005 SSIM [rest/flat] | 0.998 | 0.993 | ✅ PASS |
| Hybrid >= best(V7,V8) - 0.005 SSIM [rest/gradient] | 0.999 | 0.987 | ✅ PASS |
| Hybrid >= best(V7,V8) - 0.005 SSIM [rest/darkjpeg] | 0.999 | 0.958 | ✅ PASS |
| Hybrid >= best(V7,V8) - 0.005 SSIM [rest/strands] | 0.991 | 0.986 | ✅ PASS |
| Hybrid >= best(V7,V8) - 0.005 SSIM [rest/lineart] | 0.987 | 0.982 | ✅ PASS |
| Hybrid >= best(V7,V8) - 0.005 SSIM [rest/texture] | 0.966 | 0.922 | ✅ PASS |
| Hybrid >= best(V7,V8) - 0.005 SSIM [e2e/flat] | 0.998 | 0.993 | ✅ PASS |
| Hybrid >= best(V7,V8) - 0.005 SSIM [e2e/gradient] | 0.999 | 0.994 | ✅ PASS |
| Hybrid >= best(V7,V8) - 0.005 SSIM [e2e/darkjpeg] | 0.999 | 0.959 | ✅ PASS |
| Hybrid >= best(V7,V8) - 0.005 SSIM [e2e/texture] | 0.970 | 0.904 | ✅ PASS |
| 0 modified / >= 3,000 negative fixtures (D) | n/a | 0.000 | ⏭ SKIP |
| median localization error <= 1px (D, e2e) | 0.000 | 1.000 | ✅ PASS |
| edit containment 100% within mask+feather (D, e2e) | 0.000 | 0.000 | ✅ PASS |
| e2e plain negatives: 0 pixel modifications (D) | 2.000 | 0.000 | ❌ FAIL |

## Restoration-only layer (positives)

| strategy | n | SSIM med | PSNR med | seamΔ med | halo med | ms med | OOB | fallback |
|---|---|---|---|---|---|---|---|---|
| A-unblend-denoise | 62 | 0.988 | 36.923 | -0.188 | 0.000 | 0.1 | 0 | 0 |
| B-inpaint | 62 | 0.665 | 27.472 | -0.232 | 0.000 | 5.1 | 0 | 0 |
| C-unblend-denoise | 62 | 0.988 | 36.923 | -0.188 | 0.000 | 0.1 | 0 | 0 |
| D-hybrid-srgb | 62 | 0.998 | 54.509 | -0.532 | 0.000 | 6.7 | 0 | 1 |
| D-hybrid-linear | 62 | 0.869 | 21.969 | -0.106 | 0.000 | 6.7 | 0 | 37 |

### Restoration per class (SSIM med)

| strategy | class | n | SSIM med | PSNR med |
|---|---|---|---|---|
| A-unblend-denoise | flat | 9 | 0.998 | 57.192 |
| A-unblend-denoise | gradient | 13 | 0.992 | 43.657 |
| A-unblend-denoise | darkjpeg | 11 | 0.771 | 25.559 |
| A-unblend-denoise | texture | 11 | 0.927 | 27.018 |
| A-unblend-denoise | strands | 9 | 0.991 | 27.733 |
| A-unblend-denoise | lineart | 9 | 0.987 | 31.084 |
| B-inpaint | flat | 9 | 0.982 | 48.494 |
| B-inpaint | gradient | 13 | 0.982 | 48.483 |
| B-inpaint | darkjpeg | 11 | 0.963 | 44.742 |
| B-inpaint | texture | 11 | 0.628 | 26.865 |
| B-inpaint | strands | 9 | 0.374 | 14.587 |
| B-inpaint | lineart | 9 | 0.631 | 15.490 |
| C-unblend-denoise | flat | 9 | 0.998 | 57.192 |
| C-unblend-denoise | gradient | 13 | 0.992 | 43.657 |
| C-unblend-denoise | darkjpeg | 11 | 0.771 | 25.559 |
| C-unblend-denoise | texture | 11 | 0.927 | 27.018 |
| C-unblend-denoise | strands | 9 | 0.991 | 27.733 |
| C-unblend-denoise | lineart | 9 | 0.987 | 31.084 |
| D-hybrid-srgb | flat | 9 | 0.998 | 58.968 |
| D-hybrid-srgb | gradient | 13 | 0.999 | 55.556 |
| D-hybrid-srgb | darkjpeg | 11 | 0.999 | 56.132 |
| D-hybrid-srgb | texture | 11 | 0.966 | 37.231 |
| D-hybrid-srgb | strands | 9 | 0.991 | 27.733 |
| D-hybrid-srgb | lineart | 9 | 0.987 | 31.084 |
| D-hybrid-linear | flat | 9 | 0.698 | 22.802 |
| D-hybrid-linear | gradient | 13 | 0.987 | 45.753 |
| D-hybrid-linear | darkjpeg | 11 | 0.409 | 19.507 |
| D-hybrid-linear | texture | 11 | 0.738 | 21.384 |
| D-hybrid-linear | strands | 9 | 0.927 | 19.694 |
| D-hybrid-linear | lineart | 9 | 0.983 | 30.145 |

## End-to-end layer (per strategy)

| strategy | recall | neg applied | neg modified | hardNeg applied | hardNeg modified | locErr med | sizeErr med | SSIM med | PSNR med | ms med |
|---|---|---|---|---|---|---|---|---|---|---|
| A-v7-baseline | 0.726 | 1/42 | 1 | 0/24 | 0 | 0.000 | 0.000 | 0.991 | 36.615 | 16.2 |
| B-v8-zip | 0.645 | 5/42 | 5 | 6/24 | 6 | 0.000 | 0.000 | 0.971 | 46.013 | 80.1 |
| C-conservative | 0.661 | 2/42 | 2 | 1/24 | 1 | 0.000 | 0.000 | 0.990 | 43.303 | 70.5 |
| D-hybrid | 0.661 | 2/42 | 2 | 1/24 | 1 | 0.000 | 0.000 | 0.998 | 56.132 | 73.8 |

### e2e per-class recall/SSIM (positives)

| strategy | class | n | recall | SSIM med | PSNR med |
|---|---|---|---|---|---|
| A-v7-baseline | flat | 9 | 1.000 | 0.998 | 57.192 |
| A-v7-baseline | gradient | 13 | 0.692 | 0.999 | 61.124 |
| A-v7-baseline | darkjpeg | 11 | 1.000 | 0.773 | 25.627 |
| A-v7-baseline | texture | 11 | 0.818 | 0.909 | 26.547 |
| A-v7-baseline | strands | 9 | 0.778 | 0.990 | 27.733 |
| A-v7-baseline | lineart | 9 | 0.000 | n/a | n/a |
| B-v8-zip | flat | 9 | 1.000 | 0.982 | 48.494 |
| B-v8-zip | gradient | 13 | 0.846 | 0.982 | 48.525 |
| B-v8-zip | darkjpeg | 11 | 0.909 | 0.964 | 44.915 |
| B-v8-zip | texture | 11 | 0.909 | 0.630 | 26.926 |
| B-v8-zip | strands | 9 | 0.000 | n/a | n/a |
| B-v8-zip | lineart | 9 | 0.000 | n/a | n/a |
| C-conservative | flat | 9 | 1.000 | 0.998 | 57.192 |
| C-conservative | gradient | 13 | 0.846 | 0.993 | 43.657 |
| C-conservative | darkjpeg | 11 | 1.000 | 0.773 | 25.627 |
| C-conservative | texture | 11 | 0.909 | 0.908 | 29.503 |
| C-conservative | strands | 9 | 0.000 | n/a | n/a |
| C-conservative | lineart | 9 | 0.000 | n/a | n/a |
| D-hybrid | flat | 9 | 1.000 | 0.998 | 58.968 |
| D-hybrid | gradient | 13 | 0.846 | 0.999 | 58.925 |
| D-hybrid | darkjpeg | 11 | 1.000 | 0.999 | 56.132 |
| D-hybrid | texture | 11 | 0.909 | 0.970 | 33.220 |
| D-hybrid | strands | 9 | 0.000 | n/a | n/a |
| D-hybrid | lineart | 9 | 0.000 | n/a | n/a |

## D mass-negative audit

- fixtures: 0 · detected(applied): 0 · pixel-modified: 0 · (skipped in QUICK)

## Missed positives (e2e)

- A-v7-baseline: pos-strands-s1-o1-1376x768, pos-lineart-s0-o1-1024x1024, pos-lineart-s0-o1-1376x768, pos-lineart-s0-o0.62-1024x1024, pos-lineart-s0-o0.62-1376x768, pos-lineart-s1-o1-1024x1024, pos-lineart-s1-o1-1376x768, pos-lineart-s1-o0.62-1024x1024, pos-lineart-s1-o0.62-1376x768, pos-jpeg-gradient-o1, pos-jpeg-gradient-o0.62, pos-resize-gradient-o1, pos-resize-texture-o1, pos-resize-strands-o1, pos-resize-gradient-o0.62, pos-resize-texture-o0.62, pos-resize-lineart-o1
- B-v8-zip: pos-strands-s0-o1-1024x1024, pos-strands-s0-o1-1376x768, pos-strands-s0-o0.62-1024x1024, pos-strands-s0-o0.62-1376x768, pos-strands-s1-o1-1024x1024, pos-strands-s1-o1-1376x768, pos-strands-s1-o0.62-1024x1024, pos-strands-s1-o0.62-1376x768, pos-lineart-s0-o1-1024x1024, pos-lineart-s0-o1-1376x768, pos-lineart-s0-o0.62-1024x1024, pos-lineart-s0-o0.62-1376x768, pos-lineart-s1-o1-1024x1024, pos-lineart-s1-o1-1376x768, pos-lineart-s1-o0.62-1024x1024, pos-lineart-s1-o0.62-1376x768, pos-jpeg-darkjpeg-o0.62, pos-jpeg-gradient-o1, pos-jpeg-gradient-o0.62, pos-resize-strands-o1, pos-resize-texture-o0.62, pos-resize-lineart-o1
- C-conservative: pos-strands-s0-o1-1024x1024, pos-strands-s0-o1-1376x768, pos-strands-s0-o0.62-1024x1024, pos-strands-s0-o0.62-1376x768, pos-strands-s1-o1-1024x1024, pos-strands-s1-o1-1376x768, pos-strands-s1-o0.62-1024x1024, pos-strands-s1-o0.62-1376x768, pos-lineart-s0-o1-1024x1024, pos-lineart-s0-o1-1376x768, pos-lineart-s0-o0.62-1024x1024, pos-lineart-s0-o0.62-1376x768, pos-lineart-s1-o1-1024x1024, pos-lineart-s1-o1-1376x768, pos-lineart-s1-o0.62-1024x1024, pos-lineart-s1-o0.62-1376x768, pos-jpeg-gradient-o1, pos-jpeg-gradient-o0.62, pos-resize-strands-o1, pos-resize-texture-o0.62, pos-resize-lineart-o1
- D-hybrid: pos-strands-s0-o1-1024x1024, pos-strands-s0-o1-1376x768, pos-strands-s0-o0.62-1024x1024, pos-strands-s0-o0.62-1376x768, pos-strands-s1-o1-1024x1024, pos-strands-s1-o1-1376x768, pos-strands-s1-o0.62-1024x1024, pos-strands-s1-o0.62-1376x768, pos-lineart-s0-o1-1024x1024, pos-lineart-s0-o1-1376x768, pos-lineart-s0-o0.62-1024x1024, pos-lineart-s0-o0.62-1376x768, pos-lineart-s1-o1-1024x1024, pos-lineart-s1-o1-1376x768, pos-lineart-s1-o0.62-1024x1024, pos-lineart-s1-o0.62-1376x768, pos-jpeg-gradient-o1, pos-jpeg-gradient-o0.62, pos-resize-strands-o1, pos-resize-texture-o0.62, pos-resize-lineart-o1

## Adversarial hard-negative frontier (report-only)

| strategy | fixture | detected NCC | mode |
|---|---|---|---|
| B-v8-zip | hn-blob-corner-6 | 0.796 | region-scan |
| C-conservative | hn-blob-corner-6 | 0.694 | region-scan |
| D-hybrid | hn-blob-corner-6 | 0.694 | broad |
| B-v8-zip | hn-bright-texture-0 | 0.633 | region-scan |
| B-v8-zip | hn-bright-texture-1 | 0.694 | region-scan |
| B-v8-zip | hn-bright-texture-2 | 0.644 | region-scan |
| B-v8-zip | hn-bright-texture-4 | 0.614 | region-scan |
| B-v8-zip | hn-bright-texture-7 | 0.617 | region-scan |

Honest finding: X/diamond decoys and bright texture patches correlate
0.58-0.80 with the star template — above any NCC gate in the grid.
All vendors fire on them; separation requires a feature beyond NCC
(shape descriptors / learned detector), out of scope for this benchmark.

## Threshold calibration

- 0/144 grid points achieved recall 1.0 / fp 0 on the calibration split (27 pos + 48 neg).
- Chosen (frozen): {"ncc":0.45,"coarse":0.42,"strictStrong":0.68,"robust":0.58} — weakest detected positive NCC 0.489 vs robust gate 0.58.

## Notes & limitations

- Synthetic corpus (no real Flow fixtures available): findings are valid
  relative to the Flow compositor model `out = bg*(1-a) + 255*a` and the
  JPEG simulation, not against actual Flow exports.
- SSIM/PSNR are computed against the clean reference (same JPEG encode
  path for JPEG fixtures), inside the true watermark box only.
- LPIPS is not measured (frozen package.json, no runtime deps);
  SSIM/PSNR + seam/halo structural proxies are used instead.
