/**
 * FlowZero — LocalGeminiWatermarkRemover  ·  V8 Detector + V7 Restoration
 *
 * Algorithm V8-bounded (per V8 Hybrid Integration plan):
 *  1. Strict Deterministic Anchors: Google Flow renders the watermark at exact
 *     pixel positions based on image resolution. No more NCC-based free-scan
 *     (which caused 1–7 px drift on high-contrast edges, leading to "shader" artifacts).
 *  2. Bounded Multi-Scale Detector (V8): sampled NCC + robust local refinement
 *     + bottom-right corner scan for Flow variants whose logo size/margin
 *     differs from the hard-coded table; raised thresholds (strict 0.40,
 *     robust 0.58) reduce false positives on no-watermark images.
 *  3. Exact Alpha Unblend (Gain = 1.00): Uses the embedded 48x48 alpha mask
 *     verbatim with no scaling factor — matches true watermark opacity.
 *  4. Adaptive Dark-only Bilateral Denoise: For backgrounds with luminance < 55
 *     (pitch-black, dark wood, etc.), a bilateral filter absorbs JPEG quantization
 *     noise amplified by the unblend step. Inactive on bright/mid-tone images,
 *     preserving 100% sharpness on portraits and sky backgrounds.
 *  5. NCC fallback for unknown resolutions: For non-standard dimensions, a
 *     constrained +/-8 px search around the margin-predicted position is performed.
 *
 * Restoration strategy: Conservative (V7 unblend + denoise). The V8 masked
 * inpaint from the candidate ZIP is NOT the default path — it only becomes
 * canonical repair if the fixture benchmark proves it does not degrade
 * texture/line-art quality vs the V7 baseline (plan acceptance gate).
 *
 * Supports all Google Flow aspect ratios:
 *   1:1  (1024x1024, 2048x2048)
 *   16:9 (1376x768, 2752x1536)
 *   9:16 (768x1376, 1536x2752)
 *   4:3  (1200x896, 2400x1792)
 *   3:4  (896x1200, 1792x2400)
 *
 * Zero external dependencies — embedded raw 2304-byte alpha mask (base64).
 */

(function () {
  "use strict";

  // ── Embedded raw 48x48 alpha values (2304 bytes base64) ──────────────────────
  const RAW_ALPHA_2304 = "AAABAAAAAQABAAEBAAEAAQAAAQABAAFDQwAAAQABAAEAAAAAAAABAAAAAAEAAAABAAAAAAAAAQAAAAABAAEAAAAAAAAAABNNTBQAAQAAAAAAAAAAAAAAAAEAAAEAAQAAAAAAAAAAAQABAAABAAEAAQAAAAAAACxMTCsAAAABAAEAAAAAAAABAAEAAAAAAQABAAAAAAAAAQAAAAAAAAEAAAAAAAAAAENMTEgAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAABAAAAAQABAQAAAAAAAAAAAAAAE01MTU0UAAAAAAAAAAAAAAABAAEBAAAAAAAAAAAAAAAAAAAAAQABAQAAAAAAAAAAMExMTEw6AQAAAAAAAAAAAAAAAAABAAEAAAAAAQAAAAEBAAAAAAAAAAAAAAEAAAAKTUxMTExMCgAAAAABAAAAAQEAAQAAAAAAAAAAAAAAAAABAAEAAQEAAAAAAAAAAAAwTExMTExNMAAAAQAAAAAAAAAAAQABAQAAAAAAAAAAAAAAAAABAAEAAAABAAAAAApMTExMTUxMTBQAAQAAAAAAAAAAAAEAAQAAAAEAAQAAAAABAAEAAAAAAQABAAEAAENMTUxMTExMTDoAAQABAAAAAAAAAAAAAAAAAAAAAQAAAQEAAAEAAAAAAAAAAAEAJkxMTExNTExMTEwiAAABAAABAAAAAQAAAAAAAAEAAQAAAAABAAEAAAAAAAABAAEKTExMTUxMTExMTExIDgABAAAAAAEAAAAAAAAAAAEAAQABAAABAAAAAAAAAQABAApDTExMTExMTExMTExMQwUBAAAAAAAAAAAAAQAAAAEAAAABAQAAAAAAAAAAAAAAAD5MTE1MTExMTExMTExMTDoAAAEBAQAAAAAAAAAAAAAAAAAAAAAAAAABAQEBAAEAMExMTExMTExMTExMTExMTEwwAAAAAAAAAAEBAQABAQABAAEBAAAAAQAAAAAAAAEwTUxMTUxMTExMTExMTExMTE1MMAEAAAABAAAAAAAAAQABAAABAAEAAQABAQABBTpMTExMTUxNTExMTE1MTExMTE1MTD4KAAABAAAAAAEAAQABAAAAAAAAAQAAAAAPQ0xMTExMTExMTExMTExMTUxNTExMTExDCgABAAEAAAEAAQAAAAAAAAAAAQABACJITExMTUxMTExMTE1MTExMTExMTE1MTExMTCcBAAEAAAEAAQABAAAAAAAAAAAUOkxMTExMTExMTExMTExMTExMTExMTExMTExMTExDCgAAAAAAAQAAAAAAAAAACjBMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExNTDAKAAAAAAAAAAAAABQ6TExMTExMTUxMTExMTExMTExMTExNTExMTExMTExMTExMTExMMBQAAAAAARQrSExNTExMTExMTExMTExMTExMTUxMTExMTExMTExMTExMTExMTExMTExDKxQAQ0xNTExMTExMTE1MTExMTExMTExMTExNTE1NTExMTExMTExMTExMTUxNTUxMTExDRExMTExMTE1NTExMTUxMTExMTExMTExMTExMTE1MTExMTExMTExMTExMTUxMTExEARMrRExNTExMTExMTExMTE1MTExMTExMTExMTExMTExNTExMTE1MTExMTExIKxMAAQAAARMwTExMTExMTExMTExMTExMTExNTExMTExMTExMTExMTExMTExMOhMAAAEAAQAAAAAACjBMTExMTExNTE1MTExMTExNTExMTExMTExMTExMTExMTDAKAAAAAAEAAQABAAAAAAAKRExMTExMTExMTExMTUxMTExMTExMTExMTExMTEw6EwAAAAAAAAEAAAABAQAAAAAAACZMTExMTExMTExMTExMTExMTExMTExMTExMSCEAAAAAAAAAAAAAAAAAAAAAAAABAQEKRExMTExMTExMTExMTExMTExNTExMTExEDwAAAAABAQEBAQABAAEBAAAAAQAAAAAACj9MTUxMTExMTExMTExMTExNTE1MTDoFAAABAAAAAAAAAQABAAABAAAAAQAAAAABAAEwTExMTExMTExMTExMTUxMTExMMAAAAAABAAAAAAEAAQAAAAAAAAAAAQABAAABAAEAMExMTExMTE1MTExMTUxMTEwwAAAAAAABAAEAAAEAAAAAAAAAAAAAAQABAAAAAAEAATpMTExMTE1MTExMTExMTD8AAAAAAAABAAEAAAAAAQABAAAAAAAAAQAAAAAAAAEAAAVETExMTExMTExMTExMRAoAAAAAAAABAAAAAAAAAQAAAAAAAAAAAQABAQAAAAAAAAAPSExMTE1MTExMTExMCgAAAAAAAAABAAEBAAAAAAAAAAAAAAAAAAAAAQABAAAAAAAAIkxMTExMTExMTE0nAAAAAAAAAAAAAAABAAEAAAAAAQAAAAEBAAEAAAAAAAAAAAEAADpMTExMTExMTEQAAAAAAAAAAQEAAQAAAAAAAAAAAAAAAAAAAAEAAQEAAAAAAAAAABNMTExNTE1NTAoAAAAAAAAAAAAAAQABAQAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAwTExMTUxMMAAAAQAAAAAAAAAAAAEAAQAAAAEAAQAAAAAAAAAAAAAAAQAAAAEAAAAKTExMTExMCgAAAAABAAAAAAAAAAAAAAABAAEAAAAAAQAAAAEAAAAAAAAAAAAAAAAAOkxMTEwwAAAAAQAAAAABAAAAAAAAAAAAAAEAAQAAAAAAAAEAAAAAAAABAAAAAAAAE0xMTEwUAAAAAQAAAAAAAAAAAQAAAAAAAAEAAQABAAAAAAAAAAAAAAABAAAAAQAAAEhMTEQAAAAAAQABAAAAAAAAAAAAAAAAAAEAAAABAAAAAAAAAAAAAAAAAAAAAQEAACxMTCsAAAAAAAAAAAEBAAAAAAAAAAAAAAAAAAAAAAAAAAABAQAAAQEAAQAAAAAAABNMTBQBAQABAAEAAAAAAAAAAAEBAAEBAQABAAABAAAAAAAAAAAAAAEAAQABAAAAAAFERAAAAAABAAEAAQEAAAAAAAAAAAAAAQAB";

  // ── V7 Strict Deterministic Anchors ──────────────────────────────────────────
  // Google Flow renders the watermark at a fixed margin from the bottom-right
  // corner. These margins are deterministic per (width, height) pair.
  // Key: "WxH", Value: margin in pixels (watermark top-left = W-48-m, H-48-m)
  //
  // VIDEO resolutions — confirmed with visual tuner (margin = gap after logo):
  //   720p  sz=48:  margin=96  -> X=W-144,   Y=H-144
  //   1080p sz=48:  margin=144 -> X=W-192,   Y=H-192
  //   (locate() uses mask.w=48 always, so for 1080p: 1920-48-144=1728? No:
  //    getVideoAnchor scales sz too: sz=72, margin=144 -> X=1920-72-144=1704)
  //   FLOW_ANCHORS stores MARGIN only; mask.w comes from resizeMask().
  //   For video, getVideoAnchor() overrides locate() -> no FLOW_ANCHORS needed.
  const WATERMARK_PROFILES = {
    video: {
      "1280x720":  { size: 48, marginX: 96,  marginY: 96,  k: 1.0 }, // 720p landscape
      "720x1280":  { size: 48, marginX: 96,  marginY: 96,  k: 1.0 }, // 720p portrait
      "1920x1080": { size: 72, marginX: 144, marginY: 144, k: 1.5 }, // 1080p landscape
      "1080x1920": { size: 72, marginX: 144, marginY: 144, k: 1.5 }, // 1080p portrait
    },
    image: {
      "1024x1024": { margin: 78 },
      "1024x768":  { margin: 74 },
      "768x1024":  { margin: 74 },
      "1376x768":  { margin: 73 },
      "768x1376":  { margin: 73 },
      "1024x576":  { margin: 74 },
      "576x1024":  { margin: 74 },
      "896x1200":  { margin: 76 },
      "1200x896":  { margin: 76 },
      "864x1152":  { margin: 74 },
      "1152x864":  { margin: 74 },
      "1080x1350": { margin: 89 },
      "1350x1080": { margin: 89 },
      "1536x2048": { margin: 89 },
      "2048x1536": { margin: 89 },
      "1536x864":  { margin: 89 },
      "864x1536":  { margin: 89 },
      "2048x2048": { margin: 96 },
      "2752x1536": { margin: 89 },
      "1536x2752": { margin: 89 },
      "1792x2400": { margin: 94 },
      "2400x1792": { margin: 94 },
      "2400x1350": { margin: 96 },
      "1350x2400": { margin: 96 },
      "2048x1152": { margin: 96 },
      "1152x2048": { margin: 96 },
      "4096x4096": { margin: 192 },
      "3072x4096": { margin: 178 },
      "4096x3072": { margin: 178 },
      "3840x2160": { margin: 178 },
      "2160x3840": { margin: 178 },
      "3840x2880": { margin: 178 },
      "2880x3840": { margin: 178 },
      "4800x2700": { margin: 192 },
      "2700x4800": { margin: 192 },
    },
    // Known margin candidates for fallback (when exact image resolution is unknown)
    fallbackMargins: [78, 76, 74, 73, 89, 94, 96, 80, 61]
  };

  // Tune-able constants (V7 + V8 bounded detector)
  // V8 raises the strict anchor confirmation and adds a robust multi-scale
  // threshold for unknown/weak-profile resolutions (per V8 Hybrid plan).
  const NCC_THRESHOLD         = 0.40;  // Strict anchor confirmation (V8)
  const ROBUST_NCC_THRESHOLD  = 0.58;  // Robust multi-scale confirmation (V8)
  const EXACT_PROFILE_NCC_THRESHOLD = 0.45; // Known WxH: require a safer exact-anchor hit.
  const EXACT_PROFILE_FALLBACK_THRESHOLD = 0.68; // Known WxH: bounded recovery must be strong.
  const EXACT_PROFILE_TRUST_FLOOR = 0.12; // Known Flow WxH: weak-but-plausible fixed anchor fallback.
  const UNBLEND_CLIP       = 0.97;  // Max clamped alpha (prevents div-0 singularity)
  const UNBLEND_MIN_ALPHA  = 0.002; // Skip pixels below this alpha (transparent boundary)
  const DARK_LUM_THRESH    = 55;    // Luma threshold to activate bilateral denoise
  const BILAT_RADIUS       = 2;     // Bilateral filter kernel radius
  const BILAT_SIGMA_SPACE  = 8.0;   // Bilateral spatial Gaussian sigma^2
  const BILAT_SIGMA_RANGE  = 900.0; // Bilateral range Gaussian sigma^2 (30^2)
  const BILAT_MAX_BLEND    = 0.92;  // Max denoise blend factor

  let _cachedMask = null;

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function _clamp(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function _mean(arr) {
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  function _std(arr) {
    const m = _mean(arr);
    let v = 0;
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i] - m;
      v += d * d;
    }
    return Math.sqrt(v / arr.length);
  }

  // ── Alpha Mask ────────────────────────────────────────────────────────────────
  function getAlphaMap() {
    if (_cachedMask) return _cachedMask;
    try {
      const bin = (typeof atob === "function")
        ? atob(RAW_ALPHA_2304)
        : Buffer.from(RAW_ALPHA_2304, "base64").toString("binary");
      const alpha = new Float32Array(48 * 48);
      for (let i = 0; i < bin.length; i++) {
        alpha[i] = bin.charCodeAt(i) / 255;
      }
      _cachedMask = {
        data: alpha,
        w: 48,
        h: 48,
        mean: _mean(alpha),
        std: _std(alpha),
      };
      return _cachedMask;
    } catch (e) {
      console.error("[FlowZero] Failed to decode raw alpha mask:", e);
      return null;
    }
  }

  function resizeMask(mask, outW, outH) {
    const w = Math.max(1, Math.round(outW)), h = Math.max(1, Math.round(outH));
    if (w === mask.w && h === mask.h) return mask;
    const { data: a, w: mw, h: mh } = mask;
    const out = new Float32Array(w * h);
    const rx = mw / w, ry = mh / h;
    for (let j = 0; j < h; j++) {
      const sy = Math.min(mh - 1, Math.max(0, (j + 0.5) * ry - 0.5));
      const y0 = Math.floor(sy), fy = sy - y0, y1 = Math.min(mh - 1, y0 + 1);
      for (let i = 0; i < w; i++) {
        const sx = Math.min(mw - 1, Math.max(0, (i + 0.5) * rx - 0.5));
        const x0 = Math.floor(sx), fx = sx - x0, x1 = Math.min(mw - 1, x0 + 1);
        out[j * w + i] =
          a[y0 * mw + x0] * (1 - fx) * (1 - fy) +
          a[y0 * mw + x1] * fx       * (1 - fy) +
          a[y1 * mw + x0] * (1 - fx) * fy       +
          a[y1 * mw + x1] * fx       * fy;
      }
    }
    return { data: out, w, h, mean: _mean(out), std: _std(out) };
  }

  // ── Luma Extraction ───────────────────────────────────────────────────────────
  function getLuma(imageData) {
    const { data, width: W, height: H } = imageData;
    const lum = new Float32Array(W * H);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
      lum[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }
    return lum;
  }

  // ── NCC at a given position ───────────────────────────────────────────────────
  function nccAt(lum, W, mask, x, y) {
    const { data: a, w: mw, h: mh, mean: aMean, std: aStd } = mask;
    if (aStd < 1e-9) return -1;

    let s = 0, s2 = 0;
    for (let j = 0; j < mh; j++) {
      const row = (y + j) * W + x;
      for (let i = 0; i < mw; i++) {
        const v = lum[row + i];
        s  += v;
        s2 += v * v;
      }
    }
    const n = mw * mh, mean = s / n;
    const std = Math.sqrt(Math.max(1e-9, s2 / n - mean * mean));

    let cov = 0;
    for (let j = 0; j < mh; j++) {
      const row = (y + j) * W + x, mrow = j * mw;
      for (let i = 0; i < mw; i++) {
        cov += (lum[row + i] - mean) * (a[mrow + i] - aMean);
      }
    }
    return cov / (n * std * aStd);
  }

  // ── V8 Bounded Multi-Scale Detector ──────────────────────────────────────────
  // Ported from the V8 candidate (FlowZero - Xoá Logo Gemini Nam, manifest 1.3.2,
  // SHA-256 4d5cd7386c...) per the V8 Hybrid Integration plan. Adds a bounded
  // multi-scale bottom-right scan + robust local refinement for Flow variants
  // whose exported logo size or margin differs from the hard-coded table, while
  // keeping the deterministic V7 anchors as the fast path.

  // Faster NCC used only for the broad fallback scan. The best result is
  // always verified again with the full-resolution nccAt() function.
  function sampledNccAt(lum, W, H, mask, x, y, stride = 2) {
    const { data: a, w: mw, h: mh } = mask;
    if (x < 0 || y < 0 || x + mw > W || y + mh > H) return -2;

    let n = 0, sL = 0, sL2 = 0, sA = 0, sA2 = 0, sLA = 0;
    for (let j = 0; j < mh; j += stride) {
      const row = (y + j) * W + x;
      const mrow = j * mw;
      for (let i = 0; i < mw; i += stride) {
        const lv = lum[row + i];
        const av = a[mrow + i];
        n++;
        sL += lv; sL2 += lv * lv;
        sA += av; sA2 += av * av;
        sLA += lv * av;
      }
    }
    if (n < 16) return -2;
    const varL = sL2 / n - (sL / n) ** 2;
    const varA = sA2 / n - (sA / n) ** 2;
    if (varL <= 1e-9 || varA <= 1e-9) return -2;
    return (sLA / n - (sL / n) * (sA / n)) / Math.sqrt(varL * varA);
  }

  function uniqueInts(values, min, max) {
    return [...new Set(values.map(v => Math.round(v)).filter(v => v >= min && v <= max))]
      .sort((a, b) => a - b);
  }

  function candidateMaskSizes(W, H) {
    const shortSide = Math.min(W, H);
    const proportional = 48 * shortSide / 768;
    const maxSize = Math.min(224, Math.max(48, shortSide * 0.12));
    // Dense small ladder (floor 14): flow.google.com serves small exports
    // (e.g. 512x382) where the sparkle renders at ~20px with NCC 0.87 — a
    // sparse ladder jumps 17.9→24 and the 24px mask mis-covers the star,
    // leaving a ghost after unblend. Step 2 below 48 keeps the coarse sweep
    // cheap on small images (broad scan only runs on weak hits anyway).
    return uniqueInts([
      14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 44, 48,
      56, 64, 72, 80, 96, 112, 128, 144, 160, 192,
      proportional * 0.6,
      proportional * 0.75,
      proportional,
      proportional * 1.25,
    ], 14, maxSize);
  }

  function refineCandidate(lum, W, H, mask, startX, startY, radius, step) {
    let coarse = { ncc: -2, x: startX, y: startY };
    const sampleStride = mask.w >= 128 ? 4 : mask.w >= 72 ? 3 : 2;
    for (let dy = -radius; dy <= radius; dy += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        const x = startX + dx, y = startY + dy;
        const score = sampledNccAt(lum, W, H, mask, x, y, sampleStride);
        if (score > coarse.ncc) coarse = { ncc: score, x, y };
      }
    }

    // Never compare sampled and full NCC values directly. Fully verify both
    // the coarse winner and the original predicted anchor.
    let best = { ncc: -2, x: startX, y: startY };
    for (const center of [coarse, { x: startX, y: startY }]) {
      for (let dy = -Math.max(2, step); dy <= Math.max(2, step); dy++) {
        for (let dx = -Math.max(2, step); dx <= Math.max(2, step); dx++) {
          const x = center.x + dx, y = center.y + dy;
          if (x < 0 || y < 0 || x + mask.w > W || y + mask.h > H) continue;
          const score = nccAt(lum, W, mask, x, y);
          if (score > best.ncc) best = { ncc: score, x, y };
        }
      }
    }
    return best;
  }

  // Multi-scale fallback for Flow variants whose exported logo size or margin
  // differs from the hard-coded resolution table.
  function locateRobust(imageData, baseMask) {
    const W = imageData.width, H = imageData.height;
    const shortSide = Math.min(W, H);
    const lum = imageData._lumaCache || (imageData._lumaCache = getLuma(imageData));
    const profile = WATERMARK_PROFILES.image[`${W}x${H}`];
    const sizes = candidateMaskSizes(W, H);
    const margins = uniqueInts([
      profile?.margin,
      ...WATERMARK_PROFILES.fallbackMargins,
      shortSide * 0.035,
      shortSide * 0.05,
      shortSide * 0.07,
      shortSide * 0.09,
      shortSide * 0.12,
      shortSide * 0.15,
    ].filter(Number.isFinite), 8, Math.round(shortSide * 0.20));

    let best = { ncc: -2, x: 0, y: 0, mask: baseMask, mode: "robust" };
    const candidates = [];
    for (const size of sizes) {
      const mask = resizeMask(baseMask, size, size);
      const radius = Math.max(5, Math.round(size * 0.18));
      const step = size >= 96 ? 3 : 2;
      for (const margin of margins) {
        const bx = W - size - margin;
        const by = H - size - margin;
        const hit = refineCandidate(lum, W, H, mask, bx, by, radius, step);
        const candidate = { ...hit, mask, mode: "robust" };
        candidates.push(candidate);
        if (candidate.ncc > best.ncc) best = candidate;
      }
    }

    // If diagonal-margin candidates were weak, search the complete bottom-right
    // corner with independent X/Y margins, then refine the best coarse hit.
    if (best.ncc < 0.80) {
      const minMargin = Math.max(8, Math.round(shortSide * 0.02));
      const maxMargin = Math.round(shortSide * 0.18);
      const gridStep = Math.max(5, Math.round(shortSide / 180));

      for (const size of sizes) {
        const mask = resizeMask(baseMask, size, size);
        const sampleStride = size >= 128 ? 5 : size >= 72 ? 3 : 2;
        let coarse = { ncc: -2, x: 0, y: 0 };
        for (let my = minMargin; my <= maxMargin; my += gridStep) {
          const y = H - size - my;
          for (let mx = minMargin; mx <= maxMargin; mx += gridStep) {
            const x = W - size - mx;
            const score = sampledNccAt(lum, W, H, mask, x, y, sampleStride);
            if (score > coarse.ncc) coarse = { ncc: score, x, y };
          }
        }
        const hit = refineCandidate(lum, W, H, mask, coarse.x, coarse.y, gridStep + 2, 2);
        const candidate = { ...hit, mask, mode: "broad" };
        candidates.push(candidate);
        if (candidate.ncc > best.ncc) best = candidate;
      }
    }

    // Nearby smaller masks can score a little higher by matching only the
    // bright center. Among candidates within 0.02 of the true peak, prefer the
    // larger mask so all four points are removed, without allowing a chain of
    // progressively worse oversized masks to win.
    const nearPeak = candidates
      .filter(candidate => candidate.ncc >= best.ncc - 0.02)
      .sort((a, b) => b.mask.w - a.mask.w || b.ncc - a.ncc);
    return nearPeak[0] || best;
  }

  // Known Flow export sizes have a deterministic bottom-right anchor. If that
  // exact hit is weak, recover only in a small neighborhood around the known
  // anchor and with a narrow size ladder. Never search the whole lower-right
  // image for exact profiles: natural textures such as grass and flowers can
  // correlate with the sparkle mask strongly enough to create false repairs.
  function locateExactProfileBounded(imageData, baseMask, profile) {
    const W = imageData.width, H = imageData.height;
    const shortSide = Math.min(W, H);
    const lum = imageData._lumaCache || (imageData._lumaCache = getLuma(imageData));
    const scale = shortSide >= 5000 ? 4.0 : shortSide >= 2500 ? 2.0 : 1.0;
    const nominalSize = 48 * scale;
    const sizes = uniqueInts([
      nominalSize * 0.80,
      nominalSize * 0.90,
      nominalSize,
      nominalSize * 1.10,
      nominalSize * 1.20,
    ], Math.max(14, Math.round(nominalSize * 0.75)), Math.round(nominalSize * 1.25));
    const radius = Math.max(6, Math.min(32, Math.round(shortSide * 0.012)));
    const candidates = [];
    let best = { ncc: -2, x: 0, y: 0, mask: baseMask, mode: "exact-bounded" };

    for (const size of sizes) {
      const mask = resizeMask(baseMask, size, size);
      const bx = W - size - profile.margin;
      const by = H - size - profile.margin;
      const hit = refineCandidate(lum, W, H, mask, bx, by, radius, 2);
      const candidate = { ...hit, mask, mode: "exact-bounded" };
      candidates.push(candidate);
      if (candidate.ncc > best.ncc) best = candidate;
    }

    const nearPeak = candidates
      .filter(candidate => candidate.ncc >= best.ncc - 0.02)
      .sort((a, b) => b.mask.w - a.mask.w || b.ncc - a.ncc);
    return nearPeak[0] || best;
  }

  function boxesOverlap(a, b) {
    const ax2 = a.x + a.mask.w, ay2 = a.y + a.mask.h;
    const bx2 = b.x + b.mask.w, by2 = b.y + b.mask.h;
    const iw = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
    const ih = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
    const intersection = iw * ih;
    const smaller = Math.min(a.mask.w * a.mask.h, b.mask.w * b.mask.h);
    return smaller > 0 && intersection / smaller > 0.28;
  }

  // Scan the whole lower-right region and return multiple non-overlapping
  // sparkle matches. Agent outputs may contain one large star plus a smaller
  // satellite, while normal generations contain one small star near the edge.
  function locateAllCornerStars(imageData, baseMask, seed = null) {
    const W = imageData.width, H = imageData.height;
    const lum = imageData._lumaCache || (imageData._lumaCache = getLuma(imageData));
    const shortSide = Math.min(W, H);
    const sizes = uniqueInts([
      14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 44, 48,
      56, 64, 72, 80, 96, 112, 128, 144, 160, 192,
      48 * shortSide / 768,
      48 * shortSide / 768 * 0.75,
      48 * shortSide / 768 * 0.6,
    ], 14, Math.min(224, Math.max(48, shortSide * 0.12)));
    const x0 = Math.round(W * 0.72);
    const y0 = Math.round(H * 0.64);
    const all = [];

    // A confident strict/robust hit short-circuits the scan.
    if (seed?.mode === "strict" && seed.ncc >= 0.62) return [seed];
    // Re-gate the seed with its own accepted threshold (strict: NCC_THRESHOLD,
    // robust/broad: ROBUST_NCC_THRESHOLD) — never a higher hardcoded value.
    if (seed && seed.ncc >= (seed.threshold ?? ROBUST_NCC_THRESHOLD)) all.push(seed);

    for (const size of sizes) {
      const mask = resizeMask(baseMask, size, size);
      const step = Math.max(5, Math.round(size / 9));
      const stride = size >= 112 ? 5 : size >= 72 ? 4 : 3;
      const coarse = [];

      for (let y = y0; y <= H - size - 4; y += step) {
        for (let x = x0; x <= W - size - 4; x += step) {
          const score = sampledNccAt(lum, W, H, mask, x, y, stride);
          if (score < 0.34) continue;
          coarse.push({ ncc: score, x, y });
          coarse.sort((a, b) => b.ncc - a.ncc);
          if (coarse.length > 10) coarse.length = 10;
        }
      }

      for (const hit of coarse) {
        const refined = refineCandidate(lum, W, H, mask, hit.x, hit.y, step + 3, 2);
        if (refined.ncc >= 0.58) all.push({ ...refined, mask, mode: "region-scan" });
      }
    }

    all.sort((a, b) => b.ncc - a.ncc || b.mask.w - a.mask.w);
    if (globalThis.__FLOWZERO_DEBUG) {
      console.log("[FlowZero debug candidates]", all.slice(0, 24).map(c => ({
        x: c.x, y: c.y, size: c.mask.w, ncc: Number(c.ncc.toFixed(3)), mode: c.mode,
      })));
    }
    if (!all.length) return [];
    const peak = all[0];
    const sameStar = all
      .filter(candidate => boxesOverlap(peak, candidate) && candidate.ncc >= peak.ncc - 0.035)
      .sort((a, b) => b.mask.w - a.mask.w || b.ncc - a.ncc);
    // Each export contains one visible sparkle. Prefer the largest near-peak
    // box in that cluster so the four tips are included, then stop; this avoids
    // treating bright decorations elsewhere in the corner as watermarks.
    return [sameStar[0] || peak];
  }

  // ── V7 Anchor Locate ──────────────────────────────────────────────────────────
  // Priority 1: Exact anchor lookup by "WxH"
  // Priority 2: Fallback candidate search with +/-8 px slack
  function locate(imageData, mask, hintX, hintY) {
    const W = imageData.width, H = imageData.height;
    if (mask.w > W || mask.h > H) return null;

    const lum = imageData._lumaCache || (imageData._lumaCache = getLuma(imageData));
    
    if (hintX !== undefined && hintY !== undefined) {
      let best = { ncc: -2, x: hintX, y: hintY, margin: 0 };
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = hintX + dx, y = hintY + dy;
          if (x < 0 || y < 0 || x + mask.w > W || y + mask.h > H) continue;
          const ncc = nccAt(lum, W, mask, x, y);
          if (ncc > best.ncc) best = { ncc, x, y, margin: 0 };
        }
      }
      return best;
    }

    const key = `${W}x${H}`;
    const profile = WATERMARK_PROFILES.image[key];
    const exactMargin = profile ? profile.margin : undefined;

    if (exactMargin !== undefined) {
      // Exact anchor: confirm with micro-scan +/-2 px
      const bx = W - mask.w - exactMargin;
      const by = H - mask.h - exactMargin;
      let best = { ncc: -2, x: bx, y: by, margin: exactMargin };

      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = bx + dx, y = by + dy;
          if (x < 0 || y < 0 || x + mask.w > W || y + mask.h > H) continue;
          const ncc = nccAt(lum, W, mask, x, y);
          if (ncc > best.ncc) best = { ncc, x, y, margin: exactMargin };
        }
      }
      console.log(
        `[FlowZero] V7 Anchor [${key}] margin=${exactMargin}px -> (${best.x}, ${best.y}), NCC=${best.ncc.toFixed(3)}`
      );
      return best;
    }

    let globalBest = { ncc: -2, x: 0, y: 0, margin: 0 };
    for (const m of WATERMARK_PROFILES.fallbackMargins) {
      const bx = W - mask.w - m;
      const by = H - mask.h - m;
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const x = bx + dx, y = by + dy;
          if (x < 0 || y < 0 || x + mask.w > W || y + mask.h > H) continue;
          const ncc = nccAt(lum, W, mask, x, y);
          if (ncc > globalBest.ncc) globalBest = { ncc, x, y, margin: m };
        }
      }
      if (globalBest.ncc >= 0.85) break; 
    }

    console.log(
      `[FlowZero] V7 Fallback [${key}] margin=${globalBest.margin}px -> (${globalBest.x}, ${globalBest.y}), NCC=${globalBest.ncc.toFixed(3)}`
    );
    return globalBest.ncc > -2 ? globalBest : null;
  }

  // ── V7 Step 1: Exact Alpha Unblend ──────────────────────────────────────────
  // ── Small-star masked inpaint ──────────────────────────────────────────────
  // Scaled-down exports (flow.google.com 512px previews) render the sparkle at
  // ~20px. The 48px alpha asset downsized to 20px no longer matches the real
  // renderer coverage, so exact-alpha unblend over-corrects the thin wing tips
  // into dark speckles (observed luma drops below alpha*255 -> clamps to 0).
  // Diffusion inpaint from the surrounding clean ring is mask-shape-robust and
  // cannot leave speckles; it only runs for small stars where unblend is
  // unreliable, keeping the V7 unblend path untouched for >=28px stars.
  function applySmallStarInpaint(imageData, mask, pos) {
    const { data, width: W, height: H } = imageData;
    const { data: alpha, w: mw, h: mh } = mask;
    const pad = Math.max(3, Math.round(Math.min(mw, mh) * 0.12));
    const x0 = Math.max(0, pos.x - pad), y0 = Math.max(0, pos.y - pad);
    const x1 = Math.min(W, pos.x + mw + pad), y1 = Math.min(H, pos.y + mh + pad);
    const rw = x1 - x0, rh = y1 - y0;
    const fillMask = new Uint8Array(rw * rh);
    const coreMask = new Float32Array(rw * rh);

    let maxAlpha = 0;
    for (const value of alpha) if (value > maxAlpha) maxAlpha = value;
    if (maxAlpha <= 0) return 0;

    for (let j = 0; j < mh; j++) {
      for (let i = 0; i < mw; i++) {
        const value = alpha[j * mw + i] / maxAlpha;
        if (value < 0.08) continue;
        const rx = pos.x + i - x0, ry = pos.y + j - y0;
        if (rx < 0 || ry < 0 || rx >= rw || ry >= rh) continue;
        coreMask[ry * rw + rx] = value;
        fillMask[ry * rw + rx] = 1;
      }
    }

    // 2px dilation catches antialiased edges of the rendered star.
    let dilated = new Uint8Array(fillMask);
    for (let round = 0; round < 2; round++) {
      const next = new Uint8Array(dilated);
      for (let y = 1; y < rh - 1; y++) {
        for (let x = 1; x < rw - 1; x++) {
          if (!dilated[y * rw + x]) continue;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) next[(y + dy) * rw + x + dx] = 1;
          }
        }
      }
      dilated = next;
    }

    const work = new Float32Array(rw * rh * 3);
    const known = new Uint8Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const ri = y * rw + x;
        const p = ((y0 + y) * W + x0 + x) * 4;
        work[ri * 3] = data[p]; work[ri * 3 + 1] = data[p + 1]; work[ri * 3 + 2] = data[p + 2];
        known[ri] = dilated[ri] ? 0 : 1;
      }
    }

    // Iterative dilation fill: average of >=2 known neighbours per pass.
    for (let pass = 0; pass < rw + rh; pass++) {
      const updates = [];
      for (let y = 1; y < rh - 1; y++) {
        for (let x = 1; x < rw - 1; x++) {
          const ri = y * rw + x;
          if (known[ri]) continue;
          let count = 0, r = 0, g = 0, b = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const ni = (y + dy) * rw + x + dx;
              if (!known[ni]) continue;
              r += work[ni * 3]; g += work[ni * 3 + 1]; b += work[ni * 3 + 2]; count++;
            }
          }
          if (count >= 2) updates.push([ri, r / count, g / count, b / count]);
        }
      }
      if (!updates.length) break;
      for (const [ri, r, g, b] of updates) {
        work[ri * 3] = r; work[ri * 3 + 1] = g; work[ri * 3 + 2] = b; known[ri] = 1;
      }
    }

    let changed = 0;
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const ri = y * rw + x;
        if (!dilated[ri]) continue;
        const core = coreMask[ri];
        const blend = core > 0 ? 1.0 : 0.82;
        const p = ((y0 + y) * W + x0 + x) * 4;
        for (let c = 0; c < 3; c++) {
          data[p + c] = _clamp(Math.round(data[p + c] * (1 - blend) + work[ri * 3 + c] * blend));
        }
        changed++;
      }
    }
    return changed;
  }

  function applyUnblend(imageData, mask, pos, gain = 1.0) {
    const { data, width: W } = imageData;
    const { data: a, w: mw, h: mh } = mask;
    let touched = 0;

    for (let j = 0; j < mh; j++) {
      const row = (pos.y + j) * W + pos.x;
      for (let i = 0; i < mw; i++) {
        const rawAlpha = a[j * mw + i] * gain;
        const al = Math.min(UNBLEND_CLIP, rawAlpha);
        if (al <= UNBLEND_MIN_ALPHA) continue;
        const p = (row + i) * 4;
        const inv = 1 - al;
        const off = al * 255;
        data[p]     = _clamp(Math.round((data[p]     - off) / inv));
        data[p + 1] = _clamp(Math.round((data[p + 1] - off) / inv));
        data[p + 2] = _clamp(Math.round((data[p + 2] - off) / inv));
        touched++;
      }
    }
    return touched;
  }

  // Estimate the real watermark opacity from surrounding pixels. Flow uses
  // different strengths for normal generations and Agent outputs, so a fixed
  // gain can over-correct the star into a dark mark. V8 reports this as
  // telemetry; the V7 exact-alpha unblend keeps gain = 1.0 by default.
  function estimateUnblendGain(imageData, mask, pos) {
    const { data, width: W } = imageData;
    const { data: alpha, w: mw, h: mh } = mask;
    const scoreAt = (gain) => {
      let n = 0, sL = 0, sL2 = 0, sA = 0, sA2 = 0, sLA = 0;
      for (let j = 0; j < mh; j++) {
        const row = (pos.y + j) * W + pos.x;
        for (let i = 0; i < mw; i++) {
          const a = Math.min(UNBLEND_CLIP, alpha[j * mw + i] * gain);
          const p = (row + i) * 4;
          const observed = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
          const corrected = a <= UNBLEND_MIN_ALPHA ? observed : (observed - a * 255) / (1 - a);
          const av = alpha[j * mw + i];
          n++;
          sL += corrected; sL2 += corrected * corrected;
          sA += av; sA2 += av * av; sLA += corrected * av;
        }
      }
      const varL = sL2 / n - (sL / n) ** 2;
      const varA = sA2 / n - (sA / n) ** 2;
      if (varL <= 1e-9 || varA <= 1e-9) return Infinity;
      return Math.abs((sLA / n - (sL / n) * (sA / n)) / Math.sqrt(varL * varA));
    };

    let bestGain = 1.0, bestScore = Infinity;
    for (let gain = 0.10; gain <= 1.15; gain += 0.025) {
      const score = scoreAt(gain);
      if (score < bestScore) { bestScore = score; bestGain = gain; }
    }
    const coarse = bestGain;
    for (let gain = Math.max(0.08, coarse - 0.035); gain <= Math.min(1.18, coarse + 0.035); gain += 0.005) {
      const score = scoreAt(gain);
      if (score < bestScore) { bestScore = score; bestGain = gain; }
    }
    return bestGain;
  }

  // ── V7 Step 2: Adaptive Bilateral Denoise (dark backgrounds only) ─────────────
  function applyAdaptiveDenoise(imageData, mask, pos) {
    const { data, width: W, height: H } = imageData;
    const { data: a, w: mw, h: mh } = mask;

    let bgLum = 0, bgCount = 0;
    for (let j = 0; j < mh; j++) {
      for (let i = 0; i < mw; i++) {
        if (a[j * mw + i] < 0.05) {
          const p = ((pos.y + j) * W + (pos.x + i)) * 4;
          bgLum += 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
          bgCount++;
        }
      }
    }
    const bgMeanLum = bgCount > 0 ? bgLum / bgCount : 128;

    if (bgMeanLum >= DARK_LUM_THRESH) return;

    const denoiseStrength = 0.90 * (1.0 - bgMeanLum / DARK_LUM_THRESH);
    const r = BILAT_RADIUS;
    const roiX0 = Math.max(0, pos.x - r);
    const roiY0 = Math.max(0, pos.y - r);
    const roiX1 = Math.min(W, pos.x + mw + r);
    const roiY1 = Math.min(H, pos.y + mh + r);
    const roiW = roiX1 - roiX0, roiH = roiY1 - roiY0;

    const roiR = new Float32Array(roiW * roiH);
    const roiG = new Float32Array(roiW * roiH);
    const roiB = new Float32Array(roiW * roiH);

    for (let j = 0; j < roiH; j++) {
      for (let i = 0; i < roiW; i++) {
        const p = ((roiY0 + j) * W + (roiX0 + i)) * 4;
        roiR[j * roiW + i] = data[p];
        roiG[j * roiW + i] = data[p + 1];
        roiB[j * roiW + i] = data[p + 2];
      }
    }

    const kSize = 2 * r + 1;
    const spatialW = new Float32Array(kSize * kSize);
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        spatialW[(dj + r) * kSize + (di + r)] =
          Math.exp(-(di * di + dj * dj) / BILAT_SIGMA_SPACE);
      }
    }

    const filtR = new Float32Array(roiW * roiH);
    const filtG = new Float32Array(roiW * roiH);
    const filtB = new Float32Array(roiW * roiH);

    for (let j = r; j < roiH - r; j++) {
      for (let i = r; i < roiW - r; i++) {
        const ci = j * roiW + i;
        const cR = roiR[ci], cG = roiG[ci], cB = roiB[ci];

        let wR = 0, wG = 0, wB = 0, sumR = 0, sumG = 0, sumB = 0;
        for (let dj = -r; dj <= r; dj++) {
          for (let di = -r; di <= r; di++) {
            const ni = (j + dj) * roiW + (i + di);
            const sw = spatialW[(dj + r) * kSize + (di + r)];

            const nR = roiR[ni], nG = roiG[ni], nB = roiB[ni];
            const rangeWR = Math.exp(-((nR - cR) * (nR - cR)) / BILAT_SIGMA_RANGE);
            const rangeWG = Math.exp(-((nG - cG) * (nG - cG)) / BILAT_SIGMA_RANGE);
            const rangeWB = Math.exp(-((nB - cB) * (nB - cB)) / BILAT_SIGMA_RANGE);

            const fR = sw * rangeWR, fG = sw * rangeWG, fB = sw * rangeWB;
            sumR += nR * fR; sumG += nG * fG; sumB += nB * fB;
            wR   += fR;      wG   += fG;      wB   += fB;
          }
        }
        filtR[ci] = wR > 1e-9 ? sumR / wR : cR;
        filtG[ci] = wG > 1e-9 ? sumG / wG : cG;
        filtB[ci] = wB > 1e-9 ? sumB / wB : cB;
      }
    }

    for (let j = 0; j < mh; j++) {
      for (let i = 0; i < mw; i++) {
        const al = a[j * mw + i];
        if (al <= 0.03) continue;

        const gy = pos.y + j, gx = pos.x + i;
        const ry = gy - roiY0, rx = gx - roiX0;
        if (ry < r || ry >= roiH - r || rx < r || rx >= roiW - r) continue;

        const ri = ry * roiW + rx;
        const blend = Math.min(BILAT_MAX_BLEND, Math.pow(al, 0.8) * denoiseStrength);
        const p = (gy * W + gx) * 4;
        const t = 1 - blend;

        data[p]     = _clamp(Math.round(data[p]     * t + filtR[ri] * blend));
        data[p + 1] = _clamp(Math.round(data[p + 1] * t + filtG[ri] * blend));
        data[p + 2] = _clamp(Math.round(data[p + 2] * t + filtB[ri] * blend));
      }
    }
  }

  // ── Main Class ────────────────────────────────────────────────────────────────
  class LocalGeminiWatermarkRemover {
    static async process(imageData) {
      const { width: W, height: H, data } = imageData || {};
      if (!W || !H || !data) return { applied: false, reason: "invalid_image" };

      const shortSide = Math.min(W, H);

      const baseMask = getAlphaMap();
      if (!baseMask) return { applied: false, reason: "mask_load_failed" };

      let mask = baseMask;

      if (shortSide >= 2500) {
        const k = shortSide >= 5000 ? 4.0 : 2.0;
        mask = resizeMask(mask, mask.w * k, mask.h * k);
      }

      // V8 detection pipeline: start with deterministic anchor fast path.
      let pos = locate(imageData, mask);
      let detectionMode = "strict";
      let requiredThreshold = NCC_THRESHOLD;
      const exactProfile = WATERMARK_PROFILES.image[`${W}x${H}`];
      const hasExactProfile = Boolean(exactProfile);
      let detections = [];

      if (hasExactProfile) {
        // Exact dimensions are safety-critical: accept the deterministic anchor
        // only when it clears the safer exact-profile threshold. Otherwise use
        // a tightly bounded recovery around that anchor. This prevents detailed
        // backgrounds from winning a free scan elsewhere in the corner.
        requiredThreshold = EXACT_PROFILE_NCC_THRESHOLD;
        const expectedX = W - mask.w - exactProfile.margin;
        const expectedY = H - mask.h - exactProfile.margin;
        // locate() only scans +/-2 px. If its winner sits on that scan boundary,
        // the true peak may lie farther away; refine locally before restoring so
        // the alpha mask is not applied several pixels off the real watermark.
        const strictAtMicroScanEdge = Boolean(pos) && (
          Math.abs(pos.x - expectedX) >= 2 || Math.abs(pos.y - expectedY) >= 2
        );
        if (pos && pos.ncc >= requiredThreshold && !strictAtMicroScanEdge) {
          detections = [{ ...pos, mask, mode: "strict", threshold: requiredThreshold }];
        } else {
          const bounded = locateExactProfileBounded(imageData, baseMask, exactProfile);
          requiredThreshold = EXACT_PROFILE_FALLBACK_THRESHOLD;
          detectionMode = "exact-bounded";
          if (bounded && bounded.ncc >= requiredThreshold) {
            pos = bounded;
            mask = bounded.mask;
            detections = [{ ...bounded, threshold: requiredThreshold }];
          } else if (pos && pos.ncc >= EXACT_PROFILE_TRUST_FLOOR) {
            // Flow's known export dimensions have a deterministic watermark
            // anchor. On busy/low-contrast backgrounds the normalized score can
            // be weak even though the watermark is present. Do not roam across
            // the image (that caused false repairs on grass/flowers), and do not
            // fail the whole download solely because the confidence is modest.
            // Restore only the fixed profile anchor with the canonical mask.
            requiredThreshold = EXACT_PROFILE_TRUST_FLOOR;
            detectionMode = "exact-anchor-trusted";
            pos = {
              x: expectedX,
              y: expectedY,
              ncc: pos.ncc,
            };
            detections = [{ ...pos, mask, mode: detectionMode, threshold: requiredThreshold }];
          }
        }
      } else {
        // Unknown dimensions retain the robust corner search because there is
        // no trusted deterministic anchor for them.
        const robust = locateRobust(imageData, baseMask);
        requiredThreshold = ROBUST_NCC_THRESHOLD;
        if (robust && robust.mask && (!pos || robust.ncc > pos.ncc)) {
          pos = robust;
          mask = robust.mask;
          detectionMode = robust.mode;
        } else {
          detectionMode = "strict-low-confidence";
        }

        const seed = pos && pos.ncc >= requiredThreshold
          ? { ...pos, mask, mode: detectionMode, threshold: requiredThreshold }
          : null;
        detections = locateAllCornerStars(imageData, baseMask, seed);
      }
      delete imageData._lumaCache;

      if (!detections.length) {
        return {
          applied: false,
          reason:  "watermark_not_found",
          ncc:     pos?.ncc ?? -1,
          mode:    detectionMode,
          threshold: requiredThreshold,
        };
      }

      // V7 restoration (Conservative path per V8 plan): exact alpha unblend +
      // adaptive dark-only bilateral denoise per detected star. The V8 masked
      // inpaint stays out of the default path until the fixture benchmark
      // validates it (plan: no inpaint-only default before benchmark).
      // Exception: small stars (<=26px, scaled-down exports) use the masked
      // diffusion inpaint — measured on a real 512px flow.google.com export
      // the 48px->20px downsized mask misfits the renderer coverage and
      // unblend leaves dark wing-tip speckles (visible faint star).
      let touched = 0;
      const appliedDetections = [];
      for (const detection of detections) {
        const gain = estimateUnblendGain(imageData, detection.mask, detection);
        // V7 exact-alpha unblend (gain = 1.0). estimateUnblendGain is telemetry
        // only per V8 plan DISCREPANCY #2 — it does not modify pixels.
        if (detection.mask.w <= 26) {
          touched += applySmallStarInpaint(imageData, detection.mask, detection);
        } else {
          touched += applyUnblend(imageData, detection.mask, detection);
          applyAdaptiveDenoise(imageData, detection.mask, detection);
        }
        appliedDetections.push({
          x: detection.x, y: detection.y,
          w: detection.mask.w, h: detection.mask.h,
          ncc: detection.ncc, gain,
        });
      }

      const primary = appliedDetections[0];

      return {
        applied:   true,
        clean:     true,
        variantId: "v8-detector-v7-restore",
        touched,
        ncc:       primary.ncc,
        mode:      detections.length > 1 ? "multi-region-scan" : detections[0].mode,
        threshold: requiredThreshold,
        gain:      primary.gain,
        pos: { x: primary.x, y: primary.y, w: primary.w, h: primary.h },
        detections: appliedDetections,
      };
    }

    static getVideoMask(targetW, targetH) {
      const baseMask = getAlphaMap();
      if (!baseMask) return null;
      return resizeMask(baseMask, targetW, targetH);
    }

    static locate(imageData, mask, hintX, hintY) {
      return locate(imageData, mask, hintX, hintY);
    }

    static getVideoAnchor(W, H, customOffsets = null) {
      const key = `${W}x${H}`;
      const profile = WATERMARK_PROFILES.video[key];

      let size, marginX, marginY;

      if (profile) {
        size = profile.size;
        marginX = profile.marginX;
        marginY = profile.marginY;
      } else {
        const shortSide = Math.min(W, H);
        const k = shortSide / 720;
        size = Math.max(24, Math.round(48 * k));
        marginX = Math.round(96 * k);
        marginY = Math.round(96 * k);
      }

      let x = W - size - marginX;
      let y = H - size - marginY;

      if (customOffsets) {
        if (customOffsets.offsetX) x += customOffsets.offsetX;
        if (customOffsets.offsetY) y += customOffsets.offsetY;
      }

      return {
        x,
        y,
        w: size,
        h: size,
        marginX,
        marginY,
      };
    }

    /**
     * Dynamically searches and auto-aligns watermark position on a video frame
     * using ultra-fast luminance cross-correlation in a local neighborhood.
     * Takes ~0.5ms on modern browser Web APIs.
     */
    static autoAlignVideoAnchor(frameImageData, baseAnchor, mask) {
      if (!frameImageData || !baseAnchor || !mask) return baseAnchor;
      const { data, width: W, height: H } = frameImageData;
      const { data: alpha, w: mw, h: mh } = mask;
      const { x: bx, y: by } = baseAnchor;

      let bestScore = -Infinity;
      let bestDx = 0;
      let bestDy = 0;
      const searchRadius = 12;

      for (let dy = -searchRadius; dy <= searchRadius; dy += 2) {
        for (let dx = -searchRadius; dx <= searchRadius; dx += 2) {
          let score = 0;
          const cx = bx + dx;
          const cy = by + dy;
          if (cx < 0 || cx + mw >= W || cy < 0 || cy + mh >= H) continue;

          for (let j = 4; j < mh - 4; j += 2) {
            for (let i = 4; i < mw - 4; i += 2) {
              const al = alpha[j * mw + i];
              if (al < 0.15) continue;
              const pIdx = ((cy + j) * W + (cx + i)) * 4;
              const lum = 0.299 * data[pIdx] + 0.587 * data[pIdx + 1] + 0.114 * data[pIdx + 2];
              score += lum * al;
            }
          }

          if (score > bestScore) {
            bestScore = score;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }

      return {
        ...baseAnchor,
        x: bx + bestDx,
        y: by + bestDy,
        autoAligned: true,
        dx: bestDx,
        dy: bestDy,
      };
    }

    static applyUnblend(imageData, mask, pos, gain = 1.0) {
      return applyUnblend(imageData, mask, pos, gain);
    }

    /**
     * Post-unblend edge de-ringing & core texture recovery for video frames.
     * Eliminates H.264 compression ringing and central embossed artifacts.
     */
    static applyVideoEdgeDerange(imageData, mask, pos) {
      const { data, width: W, height: H } = imageData;
      const { data: alpha, w: mw, h: mh } = mask;
      const { x: x0, y: y0 } = pos;

      for (let j = 1; j < mh - 1; j++) {
        for (let i = 1; i < mw - 1; i++) {
          const idx = j * mw + i;
          const al = alpha[idx];
          if (al < 0.04) continue;

          const px = x0 + i;
          const py = y0 + j;
          if (px <= 0 || px >= W - 1 || py <= 0 || py >= H - 1) continue;

          // 1. Edge gradient detection
          const grad = Math.abs(alpha[idx + 1] - alpha[idx - 1]) + Math.abs(alpha[(j + 1) * mw + i] - alpha[(j - 1) * mw + i]);
          
          // 2. Core weight calculation (where alpha is highest, preventing noise amplification)
          const coreWeight = al > 0.45 ? Math.min(0.55, (al - 0.45) / 0.40 * 0.55) : 0;
          const edgeWeight = grad >= 0.08 ? Math.min(0.45, grad * 4.5 * 0.45) : 0;

          const totalBlend = Math.max(edgeWeight, coreWeight);
          if (totalBlend <= 0.01) continue;

          const p = (py * W + px) * 4;
          const t = 1.0 - totalBlend;

          // 3x3 local cross-smooth
          const pL = (py * W + (px - 1)) * 4;
          const pR = (py * W + (px + 1)) * 4;
          const pU = ((py - 1) * W + px) * 4;
          const pD = ((py + 1) * W + px) * 4;

          for (let c = 0; c < 3; c++) {
            const avg = (data[pL + c] + data[pR + c] + data[pU + c] + data[pD + c]) * 0.25;
            data[p + c] = Math.round(data[p + c] * t + avg * totalBlend);
          }
        }
      }
    }

    static applyAdaptiveDenoise(imageData, mask, pos) {
      return applyAdaptiveDenoise(imageData, mask, pos);
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = LocalGeminiWatermarkRemover;
  } else {
    (globalThis || self).LocalGeminiWatermarkRemover = LocalGeminiWatermarkRemover;
  }
})();
