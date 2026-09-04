// benchmark/lib/strategies.js
// Strategy wrappers + Hybrid prototype (D) for the V8 Hybrid benchmark.
//
//   A = repo V7 baseline   (strict anchors, NCC 0.20, unblend + adaptive denoise)
//   B = candidate ZIP V8   (smart star scan + masked inpaint)
//   C = current master     (V8 bounded detector + V7 restoration)
//   D = Hybrid prototype   (C detection + reverse-alpha primary [sRGB + linear]
//                           + bounded gain fit + posterior quality gate
//                           + targeted micro-inpaint fallback)
//
// Vendor files are BENCHMARK-ONLY (headers carry origin + SHA-256); never
// import them from production code.
//
// Loading: vendors publish (globalThis||self).FlowZero{A,B,C} with __internals
// ONLY when evaluated outside CommonJS (their `module.exports` branch wins when
// `module` exists). This package is "type": "module", so a dynamic import()
// evaluates them as ESM -> `module` is undefined -> the global branch runs and
// __internals is exposed. Top-level await keeps this module self-contained.

await import("../vendor/A-v7-baseline.js");
await import("../vendor/B-v8-zip.js");
await import("../vendor/C-conservative.js");

const A = globalThis.FlowZeroA;
const B = globalThis.FlowZeroB;
const C = globalThis.FlowZeroC;
if (!A?.__internals || !B?.__inpaint || !C?.__internals) {
  throw new Error("vendor exposure failed: FlowZeroA/B/C or __internals missing (were the vendors loaded as CommonJS?)");
}
const intA = A.__internals;
const intB = B.__internals;
const intC = C.__internals;
const inpaint = B.__inpaint; // exact ZIP applyMaskedInpaint — D fallback

export const vendors = { A, B, C };
export const internals = { intA, intB, intC };

// ── Corpus context (mask/anchor math replicating vendor process()) ───────────

export function makeCtx() {
  const base = intC.getAlphaMap();
  const cache = new Map();
  return {
    maskOf(size) {
      if (!cache.has(size)) cache.set(size, intC.resizeMask(base, size, size));
      return cache.get(size);
    },
    // Mirrors A/B/C process(): upscale the 48px mask on very large sides.
    maskSizeFor(W, H) {
      const s = Math.min(W, H);
      return s >= 5000 ? 192 : s >= 2500 ? 96 : 48;
    },
    anchorFor(W, H, maskSize, marginOverride) {
      const size = maskSize ?? this.maskSizeFor(W, H);
      const m = marginOverride ?? intC.WATERMARK_PROFILES.image[`${W}x${H}`]?.margin ?? 78;
      return { x: W - size - m, y: H - size - m };
    },
  };
}

// ── Detection pipeline (faithful clone of vendor C process() detection) ──────
// Split into a gate-independent head (locate + locateRobust — the expensive
// part, cacheable across gate sets) and a gate-dependent tail, so the
// calibration sweep can evaluate many gate sets per image cheaply. Defaults
// reproduce C's frozen behavior exactly.

const NCC_DEFAULT = intC.NCC_THRESHOLD;          // 0.40
const ROBUST_DEFAULT = intC.ROBUST_NCC_THRESHOLD; // 0.58

export function normalizeGates(opts = {}) {
  return {
    ncc: opts.ncc ?? NCC_DEFAULT,
    robust: opts.robust ?? ROBUST_DEFAULT,
    coarse: opts.coarse ?? 0.34,
    strictStrong: opts.strictStrong ?? 0.62,
  };
}

// Vendor-exact uniqueInts clone (round, clamp, dedupe, sort ascending).
function uniqueInts(values, min, max) {
  return [...new Set(values.map((v) => Math.round(v)).filter((v) => v >= min && v <= max))]
    .sort((a, b) => a - b);
}

function boxesOverlap(a, b) {
  const ax2 = a.x + a.mask.w, ay2 = a.y + a.mask.h;
  const bx2 = b.x + b.mask.w, by2 = b.y + b.mask.h;
  const iw = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const ih = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const smaller = Math.min(a.mask.w * a.mask.h, b.mask.w * b.mask.h);
  return smaller > 0 && (iw * ih) / smaller > 0.28;
}

// Vendor-exact refineCandidate clone (coarse sampled scan + full-NCC verify).
function refineParam(lum, W, H, mask, startX, startY, radius, step) {
  let coarse = { ncc: -2, x: startX, y: startY };
  const sampleStride = mask.w >= 128 ? 4 : mask.w >= 72 ? 3 : 2;
  for (let dy = -radius; dy <= radius; dy += step) {
    for (let dx = -radius; dx <= radius; dx += step) {
      const x = startX + dx, y = startY + dy;
      const score = intC.sampledNccAt(lum, W, H, mask, x, y, sampleStride);
      if (score > coarse.ncc) coarse = { ncc: score, x, y };
    }
  }
  let best = { ncc: -2, x: startX, y: startY };
  for (const center of [coarse, { x: startX, y: startY }]) {
    for (let dy = -Math.max(2, step); dy <= Math.max(2, step); dy++) {
      for (let dx = -Math.max(2, step); dx <= Math.max(2, step); dx++) {
        const x = center.x + dx, y = center.y + dy;
        if (x < 0 || y < 0 || x + mask.w > W || y + mask.h > H) continue;
        const score = intC.nccAt(lum, W, mask, x, y);
        if (score > best.ncc) best = { ncc: score, x, y };
      }
    }
  }
  return best;
}

// Vendor-exact locateAllCornerStars clone with parameterized gates
// (coarse filter, refine gate, strict short-circuit). Defaults = C behavior.
export function scanStars(imageData, baseMask, seed, gates) {
  const W = imageData.width, H = imageData.height;
  const lum = imageData._lumaCache || (imageData._lumaCache = intC.getLuma(imageData));
  const shortSide = Math.min(W, H);
  const sizes = uniqueInts(
    [48, 56, 64, 72, 80, 96, 112, 128, 144, 160, 192, (48 * shortSide) / 768],
    32, Math.min(224, Math.max(48, shortSide * 0.12))
  );
  const x0 = Math.round(W * 0.72), y0 = Math.round(H * 0.64);
  const all = [];

  if (seed?.mode === "strict" && seed.ncc >= gates.strictStrong) return [seed];
  if (seed && seed.ncc >= (seed.threshold ?? gates.robust)) all.push(seed);

  for (const size of sizes) {
    const mask = intC.resizeMask(baseMask, size, size);
    const step = Math.max(5, Math.round(size / 9));
    const stride = size >= 112 ? 5 : size >= 72 ? 4 : 3;
    const coarse = [];
    for (let y = y0; y <= H - size - 4; y += step) {
      for (let x = x0; x <= W - size - 4; x += step) {
        const score = intC.sampledNccAt(lum, W, H, mask, x, y, stride);
        if (score < gates.coarse) continue;
        coarse.push({ ncc: score, x, y });
        coarse.sort((a, b) => b.ncc - a.ncc);
        if (coarse.length > 10) coarse.length = 10;
      }
    }
    for (const hit of coarse) {
      const refined = refineParam(lum, W, H, mask, hit.x, hit.y, step + 3, 2);
      if (refined.ncc >= gates.robust) all.push({ ...refined, mask, mode: "region-scan" });
    }
  }

  all.sort((a, b) => b.ncc - a.ncc || b.mask.w - a.mask.w);
  if (!all.length) return [];
  const peak = all[0];
  const sameStar = all
    .filter((c) => boxesOverlap(peak, c) && c.ncc >= peak.ncc - 0.035)
    .sort((a, b) => b.mask.w - a.mask.w || b.ncc - a.ncc);
  return [sameStar[0] || peak];
}

// Tier 1 — gate-independent locate stage. Runs the exact C.process() head:
// strict anchor (with >=2500px mask upscale) and, when weak/unknown, the
// bounded robust scan. Returns raw candidates; the tail merges them per gates.
export function detectHead(imageData) {
  const { width: W, height: H } = imageData;
  const shortSide = Math.min(W, H);
  const baseMask = intC.getAlphaMap();
  if (!baseMask) return { baseMask: null };

  let mask = baseMask;
  if (shortSide >= 2500) {
    const k = shortSide >= 5000 ? 4 : 2;
    mask = intC.resizeMask(baseMask, baseMask.w * k, baseMask.h * k);
  }
  const strictPos = intC.locate(imageData, mask);
  const hasExactProfile = Boolean(intC.WATERMARK_PROFILES.image[`${W}x${H}`]);
  let robustPos = null;
  if (!hasExactProfile || !strictPos || strictPos.ncc < 0.45) {
    robustPos = intC.locateRobust(imageData, baseMask);
  }
  delete imageData._lumaCache;
  return { baseMask, upscaledMask: mask, strictPos, hasExactProfile, robustPos, robustTriggered: robustPos !== null };
}

// Seed derivation shared by the tail and the sweep's cache keying — one source
// of truth for the gate-dependent merge, mirroring C.process() exactly.
// Returns the merged pos for telemetry (C reports pos.ncc on not-found).
export function seedInfoOf(head, gates) {
  const { strictPos, hasExactProfile, robustTriggered, robustPos, upscaledMask } = head;
  let pos = strictPos;
  let mask = upscaledMask;
  let mode = "strict";
  let requiredThreshold = gates.ncc;

  if (robustTriggered) {
    requiredThreshold = gates.robust;
    if (robustPos && robustPos.mask && (!pos || robustPos.ncc > pos.ncc)) {
      pos = robustPos; mask = robustPos.mask; mode = robustPos.mode;
    } else {
      mode = "strict-low-confidence";
    }
  }

  const seed = pos && pos.ncc >= requiredThreshold
    ? { ...pos, mask, mode, threshold: requiredThreshold }
    : null;
  // Cache bucket: which region-scan path the tail will take for these gates.
  const state = !seed
    ? "none"
    : seed.mode === "strict" && seed.ncc >= gates.strictStrong
      ? "sc"           // strict short-circuit — scan skipped entirely
      : seed.mode === "strict" ? "seed-strict" : "seed-robust";
  return { seed, pos, mask, mode, requiredThreshold, state };
}

// Cache key for the calibration sweep: for a fixed head, the tail's expensive
// part (region scan) depends only on (coarse, seed state); robust refine gate
// is held fixed across the swept grid.
export function seedStateOf(head, gates) {
  return seedInfoOf(head, gates).state;
}

// Tier 2 — gate-dependent tail: seed merge + region scan + final detections.
export function detectFromHead(imageData, head, gatesRaw) {
  const gates = normalizeGates(gatesRaw);
  if (!head.baseMask) return { detections: null, reason: "mask_load_failed" };
  const { seed, pos, mode, requiredThreshold } = seedInfoOf(head, gates);

  const detections = scanStars(imageData, head.baseMask, seed, gates);
  delete imageData._lumaCache;

  if (!detections.length) {
    return {
      detections: null, reason: "watermark_not_found",
      ncc: pos?.ncc ?? -1, mode, threshold: requiredThreshold,
    };
  }
  return { detections, mode, threshold: requiredThreshold, ncc: detections[0].ncc };
}

// Full detection pass (composition). Convenience for non-sweep callers.
export function detectPipeline(imageData, opts = {}) {
  return detectFromHead(imageData, detectHead(imageData), opts);
}

// ── Reverse-alpha primaries (D) ───────────────────────────────────────────────

function cl255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// sRGB per-channel inverse of out = bg*(1-a) + 255*a. Identical algebra to the
// vendor applyUnblend, exposed here with a fitted gain and box-local helpers.
export function reverseAlphaSRGB(imageData, mask, pos, gain = 1.0) {
  const { data, width: W } = imageData;
  const { data: a, w: mw, h: mh } = mask;
  let touched = 0;
  for (let j = 0; j < mh; j++) {
    const row = (pos.y + j) * W + pos.x;
    for (let i = 0; i < mw; i++) {
      const al = Math.min(0.97, a[j * mw + i] * gain);
      if (al <= 0.002) continue;
      const p = (row + i) * 4;
      const inv = 1 - al, off = al * 255;
      data[p]     = cl255(Math.round((data[p]     - off) / inv));
      data[p + 1] = cl255(Math.round((data[p + 1] - off) / inv));
      data[p + 2] = cl255(Math.round((data[p + 2] - off) / inv));
      touched++;
    }
  }
  return touched;
}

// Linear-light variant: unblend in linear space, re-encode to sRGB. Flow
// composites in sRGB, so on sRGB-composited fixtures this is expected to lose
// slightly — the benchmark quantifies the margin (plan axis: sRGB vs linear).
const LIN_LUT = new Float64Array(256);
for (let v = 0; v <= 255; v++) {
  const s = v / 255;
  LIN_LUT[v] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function linToSRGB255(lin) {
  const s = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
  return cl255(Math.round(s * 255));
}
export function reverseAlphaLinear(imageData, mask, pos, gain = 1.0) {
  const { data, width: W } = imageData;
  const { data: a, w: mw, h: mh } = mask;
  let touched = 0;
  for (let j = 0; j < mh; j++) {
    const row = (pos.y + j) * W + pos.x;
    for (let i = 0; i < mw; i++) {
      const al = Math.min(0.97, a[j * mw + i] * gain);
      if (al <= 0.002) continue;
      const p = (row + i) * 4;
      for (let c = 0; c < 3; c++) {
        const out = (LIN_LUT[data[p + c]] - al) / (1 - al); // lin(255) = 1
        data[p + c] = linToSRGB255(out);
      }
      touched++;
    }
  }
  return touched;
}

// ── Bounded gain fitting (D: after position/scale freeze) ─────────────────────
// Probe helper (diagnostics only): raw decorrelation |corr| at a given gain,
// without the shrinkage prior.
export function gainCorrAt(imageData, mask, pos, gain) {
  const { data, width: W } = imageData;
  const { data: alpha, w: mw, h: mh } = mask;
  let sw = 0, sL = 0, sL2 = 0, sA = 0, sA2 = 0, sLA = 0;
  for (let j = 0; j < mh; j++) {
    const row = (pos.y + j) * W + pos.x;
    for (let i = 0; i < mw; i++) {
      const av = alpha[j * mw + i];
      const a = Math.min(0.97, av * gain);
      const p = (row + i) * 4;
      const observed = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      const corrected = a <= 0.002 ? observed : (observed - a * 255) / (1 - a);
      const w = av >= 0.05 ? av * av : 0;
      if (w <= 0) continue;
      sw += w;
      sL += w * corrected; sL2 += w * corrected * corrected;
      sA += w * av; sA2 += w * av * av;
      sLA += w * corrected * av;
    }
  }
  if (sw < 32) return null;
  const mL = sL / sw, mA = sA / sw;
  const varL = sL2 / sw - mL * mL;
  const varA = sA2 / sw - mA * mA;
  if (varL <= 1e-9 || varA <= 1e-9) return null;
  return Math.abs((sLA / sw - mL * mA) / Math.sqrt(varL * varA));
}

// Decorrelation objective (minimize |corr(corrected luma, alpha)|) + shrinkage
// prior toward gain = 1.0 (full-strength watermark — the V7 default). The
// restore error is err ∝ alpha·(op−g)·(255−bg): on bright/heterogeneous
// backgrounds (lineart, text) core pixels sit near-white (no signal) and wing
// pixels mix text/blank (pure noise), so the decorrelation objective is
// DEGENERATE there — the unregularized fit chases noise to the 0.08/1.18
// bounds. λ|g−1| breaks those ties toward the conservative V7 prior.
// λ = 0.12 is derived from measured corr surfaces (benchmark/corrsurf probe):
//   - informative backgrounds show dip depths 0.09 (texture) … 0.88 (flat)
//     over Δg = 0.38, i.e. they clear λ·0.38 = 0.046 easily;
//   - degenerate backgrounds show spurious monotonic slopes of only
//     0.011–0.014 per 0.1–0.18 gain, which λ = 0.12 dominates.
// The 0.01 snap rule below additionally rejects pure-tie fits.
export function fitGainBounded(imageData, mask, pos) {
  const { data, width: W } = imageData;
  const { data: alpha, w: mw, h: mh } = mask;
  const LAMBDA = 0.12;
  const scoreAt = (gain) => {
    // weighted moments over real star pixels (w = alpha^2, clamped like unblend)
    let sw = 0, sL = 0, sL2 = 0, sA = 0, sA2 = 0, sLA = 0;
    for (let j = 0; j < mh; j++) {
      const row = (pos.y + j) * W + pos.x;
      for (let i = 0; i < mw; i++) {
        const av = alpha[j * mw + i];
        const a = Math.min(0.97, av * gain);
        const p = (row + i) * 4;
        const observed = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
        const corrected = a <= 0.002 ? observed : (observed - a * 255) / (1 - a);
        // alpha^2 weighting: star CORE pixels dominate the fit. Linear weights
        // let faint wing pixels (alpha 0.05-0.3) sitting on dark text poison
        // the moments on lineart backgrounds.
        const w = av >= 0.05 ? av * av : 0;
        if (w <= 0) continue;
        sw += w;
        sL += w * corrected; sL2 += w * corrected * corrected;
        sA += w * av; sA2 += w * av * av;
        sLA += w * corrected * av;
      }
    }
    if (sw < 32) return Infinity;
    const mL = sL / sw, mA = sA / sw;
    const varL = sL2 / sw - mL * mL;
    const varA = sA2 / sw - mA * mA;
    if (varL <= 1e-9 || varA <= 1e-9) return Infinity;
    const corr = Math.abs((sLA / sw - mL * mA) / Math.sqrt(varL * varA));
    return corr + LAMBDA * Math.abs(gain - 1);
  };

  let bestGain = 1.0, bestScore = Infinity;
  for (let g = 0.10; g <= 1.15 + 1e-9; g += 0.025) {
    const s = scoreAt(g);
    if (s < bestScore) { bestScore = s; bestGain = g; }
  }
  for (let g = Math.max(0.08, bestGain - 0.035); g <= Math.min(1.18, bestGain + 0.035) + 1e-9; g += 0.005) {
    const s = scoreAt(g);
    if (s < bestScore) { bestScore = s; bestGain = g; }
  }
  // Pure-tie guard: a fit that improves the raw decorrelation by less than
  // 0.01 over g = 1 is noise — snap to the V7 prior.
  if (bestGain !== 1.0) {
    const rawBest = gainCorrAt(imageData, mask, pos, bestGain);
    const rawOne = gainCorrAt(imageData, mask, pos, 1.0);
    if (rawBest == null || rawOne == null || rawOne - rawBest < 0.01) return 1.0;
  }
  // Upper guard: the Flow compositor never stamps above opacity 1.0, so a
  // fitted gain above ~1.05 is unphysical — texture noise chasing the corr
  // slope (measured: true-op-1.0 fixtures fitting 1.10-1.18). Snap to prior.
  if (bestGain > 1.05) return 1.0;
  return Math.round(bestGain * 1000) / 1000;
}

// ── Posterior quality gate (D) ────────────────────────────────────────────────

// Residual star correlation AFTER the repair: corr(luma, alpha) over the box.
// A clean removal leaves the repaired luma uncorrelated with the star alpha.
export function residualNCC(imageData, mask, pos) {
  const { data, width: W } = imageData;
  const { data: alpha, w: mw, h: mh } = mask;
  let n = 0, sL = 0, sL2 = 0, sA = 0, sA2 = 0, sLA = 0;
  for (let j = 0; j < mh; j++) {
    const row = (pos.y + j) * W + pos.x;
    for (let i = 0; i < mw; i++) {
      const p = (row + i) * 4;
      const l = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      const a = alpha[j * mw + i];
      n++; sL += l; sL2 += l * l; sA += a; sA2 += a * a; sLA += l * a;
    }
  }
  const varL = sL2 / n - (sL / n) ** 2;
  const varA = sA2 / n - (sA / n) ** 2;
  if (varL <= 1e-9 || varA <= 1e-9) return 0;
  return Math.abs((sLA / n - (sL / n) * (sA / n)) / Math.sqrt(varL * varA));
}

// Seam self-check: mean |jump| across the box border divided by the mean local
// gradient just outside it. Self-supervised (no clean reference available in
// production); a repair that dents or halos the region spikes this ratio.
export function seamSelfCheck(imageData, mask, pos) {
  const { data, width: W, height: H } = imageData;
  const { w: mw, h: mh } = mask;
  const luma = (x, y) => {
    const p = (y * W + x) * 4;
    return 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  };
  let jump = 0, jn = 0;
  const x0 = pos.x, y0 = pos.y, x1 = pos.x + mw - 1, y1 = pos.y + mh - 1;
  if (y0 - 1 >= 0) for (let i = 0; i < mw; i++) { jump += Math.abs(luma(x0 + i, y0) - luma(x0 + i, y0 - 1)); jn++; }
  if (y1 + 1 < H) for (let i = 0; i < mw; i++) { jump += Math.abs(luma(x0 + i, y1) - luma(x0 + i, y1 + 1)); jn++; }
  if (x0 - 1 >= 0) for (let j = 0; j < mh; j++) { jump += Math.abs(luma(x0, y0 + j) - luma(x0 - 1, y0 + j)); jn++; }
  if (x1 + 1 < W) for (let j = 0; j < mh; j++) { jump += Math.abs(luma(x1, y0 + j) - luma(x1 + 1, y0 + j)); jn++; }
  if (!jn) return 0;
  jump /= jn;

  // Local scale: mean |horizontal+vertical delta| in the 2px ring outside.
  let grad = 0, gn = 0;
  const ra = (x, y) => {
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
    grad += Math.abs(luma(x + 1, y) - luma(x - 1, y));
    grad += Math.abs(luma(x, y + 1) - luma(x, y - 1));
    gn++;
  };
  for (let d = 1; d <= 2; d++) {
    for (let i = -d; i < mw + d; i++) { ra(x0 + i, y0 - d); ra(x0 + i, y1 + d); }
    for (let j = -d; j < mh + d; j++) { ra(x0 - d, y0 + j); ra(x1 + d, y0 + j); }
  }
  const scale = gn ? grad / (gn * 2) : 0;
  return jump / (scale + 0.5);
}

// Tight residual mask for the targeted micro-inpaint fallback: keep only the
// star core (alpha >= coreAlpha); B's inpaint then dilates 2px + 0.08 cutoff.
function tightMask(mask, coreAlpha) {
  const out = new Float32Array(mask.data.length);
  for (let i = 0; i < mask.data.length; i++) out[i] = mask.data[i] >= coreAlpha ? mask.data[i] : 0;
  return { data: out, w: mask.w, h: mask.h };
}

// ── Hybrid assembly (D) ───────────────────────────────────────────────────────
// 1. fit bounded gain (position/scale frozen from the detection),
// 2. reverse-alpha primary (sRGB or linear-light),
// 3. posterior quality gate (residual NCC + seam self-check),
// 4. targeted micro-inpaint fallback on the tight core mask when gated.
export function applyHybrid(imageData, mask, pos, opts = {}) {
  const o = {
    space: "srgb",
    fitGain: true,
    gateNcc: 0.35,
    gateSeam: 3.0,
    coreAlpha: 0.30,
    ...opts,
  };
  const gain = o.fitGain ? fitGainBounded(imageData, mask, pos) : 1.0;
  const touched = o.space === "linear"
    ? reverseAlphaLinear(imageData, mask, pos, gain)
    : reverseAlphaSRGB(imageData, mask, pos, gain);
  const gateNcc = residualNCC(imageData, mask, pos);
  const gateSeam = seamSelfCheck(imageData, mask, pos);
  let fallback = false, inpainted = 0;
  if (gateNcc > o.gateNcc || gateSeam > o.gateSeam) {
    fallback = true;
    inpainted = inpaint(imageData, tightMask(mask, o.coreAlpha), pos);
  }
  return { space: o.space, gain, touched, gateNcc, gateSeam, fallback, inpainted };
}

// ── Restoration-only strategies (identical GT mask + pos fed to each) ─────────
// Each strategy uses its OWN embedded watermark alpha (assets could differ
// between builds); only D is built on C's detector, so D uses C's mask.

function ownMask(ints, size) {
  return ints.resizeMask(ints.getAlphaMap(), size, size);
}

export function makeRestoreStrategies(ctx) {
  return {
    "A-unblend-denoise": (img, mask, pos) => {
      const own = ownMask(intA, mask.w);
      intA.applyUnblend(img, own, pos, 1.0);
      intA.applyAdaptiveDenoise(img, own, pos);
      return { variant: "v7-restore" };
    },
    "B-inpaint": (img, mask, pos) => {
      const own = ownMask(intB, mask.w);
      const changed = inpaint(img, own, pos);
      return { variant: "v8-inpaint", changed };
    },
    "C-unblend-denoise": (img, mask, pos) => {
      intC.applyUnblend(img, mask, pos, 1.0);
      intC.applyAdaptiveDenoise(img, mask, pos);
      return { variant: "v7-restore" };
    },
    "D-hybrid-srgb": (img, mask, pos) => applyHybrid(img, mask, pos, { space: "srgb" }),
    "D-hybrid-linear": (img, mask, pos) => applyHybrid(img, mask, pos, { space: "linear" }),
  };
}

// ── End-to-end strategies ─────────────────────────────────────────────────────
// A/B/C use their real process(); D = detectHead/detectFromHead + applyHybrid
// per detection. detectOpts accepts either a plain opts object or a precomputed
// head (internal caching for the calibration sweep).

export async function processD(imageData, detectOpts = {}, restoreOpts = {}) {
  const det = detectPipeline(imageData, detectOpts);
  if (!det.detections) {
    return { applied: false, reason: det.reason, ncc: det.ncc, mode: det.mode, threshold: det.threshold };
  }
  let touched = 0;
  const detections = [];
  for (const d of det.detections) {
    const r = applyHybrid(imageData, d.mask, d, restoreOpts);
    touched += r.touched + r.inpainted;
    detections.push({ x: d.x, y: d.y, w: d.mask.w, h: d.mask.h, ncc: d.ncc, mode: d.mode, ...r });
  }
  const primary = detections[0];
  return {
    applied: true, clean: true, variantId: `hybrid-d-${restoreOpts.space ?? "srgb"}`,
    touched, ncc: primary.ncc, mode: det.mode, threshold: det.threshold,
    pos: { x: primary.x, y: primary.y, w: primary.w, h: primary.h },
    detections,
  };
}

export function makeE2EStrategies(detectOpts = {}, restoreOpts = {}) {
  return {
    "A-v7-baseline": async (img) => A.process(img),
    "B-v8-zip": async (img) => B.process(img),
    "C-conservative": async (img) => C.process(img),
    "D-hybrid": async (img) => processD(img, detectOpts, restoreOpts),
  };
}
