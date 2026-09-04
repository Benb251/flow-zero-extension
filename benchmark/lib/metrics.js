// benchmark/lib/metrics.js
// Objective comparison metrics for the V8 Hybrid benchmark (Phase 3).
// All metrics operate on plain { width, height, data } images / luma planes.
// LPIPS is intentionally absent: the repo carries no runtime deps (package.json
// is frozen), so SSIM/PSNR + structural measures are the objective proxies.

export function lumaOf(imageData) {
  const { width: W, height: H, data } = imageData;
  const n = W * H;
  const out = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return out;
}

export function expand(box, pad) {
  return {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    w: box.w + 2 * pad,
    h: box.h + 2 * pad,
  };
}

// Gaussian-window SSIM (sigma 1.5, radius 5 — Wang et al. constants).
const SSIM_KERNEL = (() => {
  const r = 5, s = 1.5, k = [];
  let sum = 0;
  for (let dy = -r; dy <= r; dy++) {
    const row = [];
    for (let dx = -r; dx <= r; dx++) {
      const w = Math.exp(-(dx * dx + dy * dy) / (2 * s * s));
      row.push(w); sum += w;
    }
    k.push(row);
  }
  for (const row of k) for (let i = 0; i < row.length; i++) row[i] /= sum;
  return k;
})();

export function ssimRegion(la, lb, W, box) {
  const r = 5;
  const x0 = box.x + r, y0 = box.y + r;
  const x1 = box.x + box.w - r, y1 = box.y + box.h - r;
  if (x1 <= x0 || y1 <= y0) return null;
  const C1 = 6.5025, C2 = 58.5225;
  let acc = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let ma = 0, mb = 0, va = 0, vb = 0, cov = 0;
      for (let dy = -r; dy <= r; dy++) {
        const rowK = SSIM_KERNEL[dy + r];
        const row = (y + dy) * W + x;
        for (let dx = -r; dx <= r; dx++) {
          const w = rowK[dx + r];
          const a = la[row + dx], b = lb[row + dx];
          ma += w * a; mb += w * b;
          va += w * a * a; vb += w * b * b; cov += w * a * b;
        }
      }
      const vva = va - ma * ma, vvb = vb - mb * mb, cv = cov - ma * mb;
      acc += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (vva + vvb + C2));
      n++;
    }
  }
  return n ? acc / n : null;
}

export function psnrRegion(la, lb, W, box) {
  let se = 0, n = 0;
  for (let y = box.y; y < box.y + box.h; y++) {
    const row = y * W;
    for (let x = box.x; x < box.x + box.w; x++) {
      const d = la[row + x] - lb[row + x];
      se += d * d; n++;
    }
  }
  if (!n) return null;
  const mse = se / n;
  return mse <= 1e-9 ? 100 : 10 * Math.log10(65025 / mse);
}

// Seam mismatch: per-boundary-pixel |(out_out - out_in) - (clean_out - clean_in)|.
// Captures artificial dents/halos the repair leaves across its box edge,
// relative to the same edge on the clean reference. inset=1 → the jump across
// the boundary line between the untouched outside row and the repaired inside
// row (top/bottom/left/right edges of the box).
export function seamMismatch(lOut, lClean, W, H, box) {
  const { x, y, w, h } = box;
  let sum = 0, n = 0;
  const px = (la, lb, ix) => Math.abs((la[ix] - la[ix - W]) - (lb[ix] - lb[ix - W])); // inside vs above
  const py = (la, lb, ix) => Math.abs((la[ix] - la[ix - 1]) - (lb[ix] - lb[ix - 1])); // inside vs left
  if (y - 1 >= 0) {
    for (let i = 0; i < w; i++) { const ix = y * W + x + i; sum += px(lOut, lClean, ix); n++; } // top: inside vs outside-above
  }
  if (y + h < H) {
    for (let i = 0; i < w; i++) { const ix = (y + h - 1) * W + x + i; sum += px(lOut, lClean, ix + W); n++; } // bottom: outside-below vs inside
  }
  if (x - 1 >= 0) {
    for (let j = 0; j < h; j++) { const ix = (y + j) * W + x; sum += py(lOut, lClean, ix); n++; } // left: inside vs outside-left
  }
  if (x + w < W) {
    for (let j = 0; j < h; j++) { const ix = (y + j) * W + x + w - 1; sum += py(lOut, lClean, ix + 1); n++; } // right: outside-right vs inside
  }
  return n ? sum / n : 0;
}

// Mean |diff| in a ring (outer minus inner) — local damage bleed outside the
// declared repair box (denoise feather, inpaint rim, halo).
export function meanAbsDiffRing(la, lb, W, inner, outer) {
  let sum = 0, n = 0;
  for (let y = outer.y; y < outer.y + outer.h; y++) {
    const row = y * W;
    for (let x = outer.x; x < outer.x + outer.w; x++) {
      if (x >= inner.x && x < inner.x + inner.w && y >= inner.y && y < inner.y + inner.h) continue;
      sum += Math.abs(la[row + x] - lb[row + x]); n++;
    }
  }
  return n ? sum / n : 0;
}

// Pixel-level edit containment: which changed pixels (output vs input, tol 1)
// fall outside the declared repair boxes + allowed feather ring. haloExtent is
// the max Chebyshev distance (px) any stray edit reaches beyond box+feather.
export function changedPixelStats(before, after, boxes, feather) {
  const W = before.width;
  let changed = 0, outside = 0, maxOutside = 0, haloExtent = 0;
  const dA = before.data, dB = after.data;
  for (let i = 0; i < dA.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 3; c++) {
      const t = Math.abs(dA[i + c] - dB[i + c]);
      if (t > d) d = t;
    }
    if (d <= 1) continue;
    changed++;
    const px = (i >> 2) % W, py = (i >> 2) / W | 0;
    let inside = false, bestDist = Infinity;
    for (const b of boxes) {
      const inX = px >= b.x - feather && px < b.x + b.w + feather;
      const inY = py >= b.y - feather && py < b.y + b.h + feather;
      if (inX && inY) { inside = true; break; }
      const dx = px < b.x ? b.x - px : px >= b.x + b.w ? px - (b.x + b.w) + 1 : 0;
      const dy = py < b.y ? b.y - py : py >= b.y + b.h ? py - (b.y + b.h) + 1 : 0;
      const dist = Math.max(dx, dy);
      if (dist < bestDist) bestDist = dist;
    }
    if (!inside) {
      outside++;
      if (d > maxOutside) maxOutside = d;
      if (bestDist > haloExtent) haloExtent = bestDist;
    }
  }
  return { changed, outside, maxOutside, haloExtent, containment: changed ? 1 - outside / changed : 1 };
}

export function isUnmodified(before, after) {
  const a = before.data, b = after.data;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
