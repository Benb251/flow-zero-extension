/**
 * FlowZero — LocalGeminiWatermarkRemover  ·  V7 Final
 *
 * Algorithm V7 — Key improvements over V6:
 *  1. Strict Deterministic Anchors: Google Flow renders the watermark at exact
 *     pixel positions based on image resolution. No more NCC-based free-scan
 *     (which caused 1–7 px drift on high-contrast edges, leading to "shader" artifacts).
 *  2. Exact Alpha Unblend (Gain = 1.00): Uses the embedded 48x48 alpha mask
 *     verbatim with no scaling factor — matches true watermark opacity.
 *  3. Adaptive Dark-only Bilateral Denoise: For backgrounds with luminance < 55
 *     (pitch-black, dark wood, etc.), a bilateral filter absorbs JPEG quantization
 *     noise amplified by the unblend step. Inactive on bright/mid-tone images,
 *     preserving 100% sharpness on portraits and sky backgrounds.
 *  4. NCC fallback for unknown resolutions: For non-standard dimensions, a
 *     constrained +/-8 px search around the margin-predicted position is performed.
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
  const FLOW_ANCHORS = {
    "1024x1024": 78,   // -> (898, 898)
    "1024x768":  74,   // -> (902, 646)
    "768x1024":  74,   // -> (646, 902)
    "1376x768":  73,   // -> (1255, 647)
    "768x1376":  73,   // -> (647, 1255)
    "1024x576":  74,   // -> (902, 454)
    "576x1024":  74,   // -> (454, 902)
    "896x1200":  76,   // -> (772, 1076)
    "1200x896":  76,   // -> (1076, 772)
    "864x1152":  74,   // -> (742, 1030)
    "1152x864":  74,   // -> (1030, 742)
    "1280x720":  96,   // VIDEO 720p landscape  -> X=1136, Y=576   (confirmed)
    "720x1280":  96,   // VIDEO 720p portrait   -> X=576,  Y=1136  (confirmed)
    "1080x1920": 144,  // VIDEO 1080p portrait  -> X=864,  Y=1704  (confirmed)
    "1920x1080": 144,  // VIDEO 1080p landscape -> X=1704, Y=864   (confirmed)
    "1080x1350": 89,   // -> (943, 1213)
    "1350x1080": 89,   // -> (1213, 943)
    "1536x2048": 89,   // -> (1399, 1911)
    "2048x1536": 89,   // -> (1911, 1399)
    "1536x864":  89,   // -> (1399, 727)
    "864x1536":  89,   // -> (727, 1399)
    "2048x2048": 96,   // -> (1904, 1904)
    "2752x1536": 89,   // -> (2615, 1399)
    "1536x2752": 89,   // -> (1399, 2615)
    "1792x2400": 94,   // -> (1650, 2258)
    "2400x1792": 94,   // -> (2258, 1650)
    "2400x1350": 96,   // -> (2256, 1206)
    "1350x2400": 96,   // -> (1206, 2256)
    "2048x1152": 96,   // -> (1904, 1008)
    "1152x2048": 96,   // -> (1008, 1904)
    "4096x4096": 192,  // -> (3856, 3856)
    "3072x4096": 178,  // -> (2846, 3870)
    "4096x3072": 178,  // -> (3870, 2846)
    "3840x2160": 178,  // -> (3614, 1934)
    "2160x3840": 178,  // -> (1934, 3614)
    "3840x2880": 178,  // -> (3614, 2654)
    "2880x3840": 178,  // -> (2654, 3614)
    "4800x2700": 192,  // -> (4560, 2460)
    "2700x4800": 192,  // -> (2460, 4560)
  };

  // Known margin candidates for fallback (when exact resolution is unknown)
  const FALLBACK_MARGINS = [78, 76, 74, 73, 89, 94, 96, 80, 61];

  // Tune-able constants (all finalised for V7)
  const NCC_THRESHOLD      = 0.20;  // Minimum NCC for watermark confirmation
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
    const exactMargin = FLOW_ANCHORS[key];

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

    // Fallback: candidate margins, +/-8 px slack
    let best = { ncc: -2, x: 0, y: 0, margin: 0 };
    for (const m of FALLBACK_MARGINS) {
      const bx = W - mask.w - m;
      const by = H - mask.h - m;
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const x = bx + dx, y = by + dy;
          if (x < 0 || y < 0 || x + mask.w > W || y + mask.h > H) continue;
          const ncc = nccAt(lum, W, mask, x, y);
          if (ncc > best.ncc) best = { ncc, x, y, margin: m };
        }
      }
      if (best.ncc >= 0.85) break; // confident match
    }

    console.log(
      `[FlowZero] V7 Fallback [${key}] margin=${best.margin}px -> (${best.x}, ${best.y}), NCC=${best.ncc.toFixed(3)}`
    );
    return best.ncc > -2 ? best : null;
  }

  // ── V7 Step 1: Exact Alpha Unblend ──────────────────────────────────────────
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

  // ── V7 Step 2: Adaptive Bilateral Denoise (dark backgrounds only) ─────────────
  // Rationale: On very dark backgrounds (luma < 55), JPEG quantization noise is
  // massively amplified by the div(1-alpha) division in the unblend step.
  // A bilateral filter (edge-preserving) cleans this amplified noise
  // while keeping the texture of the real image intact.
  // On bright/medium backgrounds, luminance >= 55 -> this step is fully skipped.
  function applyAdaptiveDenoise(imageData, mask, pos) {
    const { data, width: W, height: H } = imageData;
    const { data: a, w: mw, h: mh } = mask;

    // 1. Compute background luminance inside the watermark zone (corner pixels)
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

    // 2. Skip if background is not dark
    if (bgMeanLum >= DARK_LUM_THRESH) return;

    // 3. Compute denoise strength proportional to darkness
    const denoiseStrength = 0.90 * (1.0 - bgMeanLum / DARK_LUM_THRESH);

    // 4. Extract ROI (watermark zone + padding)
    const r = BILAT_RADIUS;
    const roiX0 = Math.max(0, pos.x - r);
    const roiY0 = Math.max(0, pos.y - r);
    const roiX1 = Math.min(W, pos.x + mw + r);
    const roiY1 = Math.min(H, pos.y + mh + r);
    const roiW = roiX1 - roiX0, roiH = roiY1 - roiY0;

    // 5. Build ROI float arrays (per channel)
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

    // 6. Pre-compute spatial Gaussian weights (2r+1 x 2r+1 kernel)
    const kSize = 2 * r + 1;
    const spatialW = new Float32Array(kSize * kSize);
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        spatialW[(dj + r) * kSize + (di + r)] =
          Math.exp(-(di * di + dj * dj) / BILAT_SIGMA_SPACE);
      }
    }

    // 7. Bilateral filter on ROI
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

    // 8. Blend filtered result back, weighted by alpha (active pixels only)
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

    console.log(
      `[FlowZero] V7 DarkDenoise: bgLum=${bgMeanLum.toFixed(1)}, strength=${denoiseStrength.toFixed(2)}`
    );
  }

  // ── Main Class ────────────────────────────────────────────────────────────────
  class LocalGeminiWatermarkRemover {
    /**
     * Removes the Google Flow (Gemini) watermark from an ImageData object.
     * @param {ImageData} imageData  - mutable ImageData (RGBA, 8-bit per channel)
     * @returns {Promise<Object>}    - result object with applied, ncc, pos, etc.
     */
    static async process(imageData) {
      const { width: W, height: H, data } = imageData || {};
      if (!W || !H || !data) return { applied: false, reason: "invalid_image" };

      const shortSide = Math.min(W, H);

      let mask = getAlphaMap();
      if (!mask) return { applied: false, reason: "mask_load_failed" };

      // Scale the mask for 4K images (shortSide >= 2500)
      if (shortSide >= 2500) {
        const k = shortSide >= 5000 ? 4.0 : 2.0;
        mask = resizeMask(mask, mask.w * k, mask.h * k);
      }

      // V7: Locate using strict deterministic anchors (with NCC confirmation)
      const pos = locate(imageData, mask);
      delete imageData._lumaCache;

      if (!pos || pos.ncc < NCC_THRESHOLD) {
        console.warn(`[FlowZero] V7 Watermark not detected (ncc=${pos ? pos.ncc.toFixed(3) : "N/A"})`);
        return {
          applied: false,
          reason:  "watermark_not_found",
          ncc:     pos ? pos.ncc : -1,
        };
      }

      console.log(`[FlowZero] V7 Processing (${W}x${H}) -> wm@(${pos.x},${pos.y}), NCC=${pos.ncc.toFixed(3)}`);

      // Step 1: Exact alpha unblend (Gain = 1.00, no artificial amplification)
      const touched = applyUnblend(imageData, mask, pos);

      // Step 2: Adaptive bilateral denoise (dark backgrounds only, luma < 55)
      applyAdaptiveDenoise(imageData, mask, pos);

      return {
        applied:   true,
        clean:     true,
        variantId: "v7-strict-anchors-adaptive-denoise",
        touched,
        ncc:       pos.ncc,
        gain:      1.0,
        pos: { x: pos.x, y: pos.y, w: mask.w, h: mask.h },
      };
    }

    /**
     * Resizes the embedded alpha mask to target dimensions for video frames.
     */
    static getVideoMask(targetW, targetH) {
      const baseMask = getAlphaMap();
      if (!baseMask) return null;
      return resizeMask(baseMask, targetW, targetH);
    }

    /**
     * Calculates calibrated video watermark anchor and size based on dimensions.
     * Manually verified with visual tuner on all 4 video profiles:
     *   720p  (portrait & landscape): Size 48px, Margin Right 96px, Margin Bottom 96px
     *   1080p (portrait & landscape): Size 72px, Margin Right 144px, Margin Bottom 144px
     * Formula: k = shortSide / 720 → size = 48k, margin = 96k (symmetric)
     */
    static locate(imageData, mask, hintX, hintY) {
      return locate(imageData, mask, hintX, hintY);
    }

    static getVideoAnchor(W, H, customOffsets = null) {
      const shortSide = Math.min(W, H);
      const k = shortSide / 720;
      const size = Math.max(24, Math.round(48 * k));
      const marginX = Math.round(96 * k);
      const marginY = Math.round(96 * k);

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
        scale: k,
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
