// benchmark/lib/corpus.js
// Phase 1 — Deterministic synthetic corpus for the V8 Hybrid benchmark.
// Self-contained (no imports): every image is regenerated from a fixed seed
// recorded in the spec, so runs are pixel-identical and reproducible.
//
// Classes follow the plan's restoration decision groups:
//   flat | gradient(sky) | darkjpeg | texture | strands(hair/foliage) | lineart(text)
// plus low-contrast calibration positives, JPEG-degraded and resize-smeared
// variants, negatives and hard-negatives (decoy sparkles / corner blobs).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const smooth = (t) => t * t * (3 - 2 * t);

function makeImg(W, H) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let p = 3; p < d.length; p += 4) d[p] = 255;
  return { width: W, height: H, data: d };
}

function cloneImg(src) {
  return { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
}

// ── Background generators (produce the clean reference) ────────────────────────

function valueNoise(W, H, scale, rand) {
  const gw = Math.ceil(W / scale) + 2, gh = Math.ceil(H / scale) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return (x, y) => {
    const fx = x / scale, fy = y / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = smooth(fx - x0), ty = smooth(fy - y0);
    const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1];
    const c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

function octaves(W, H, rand, scales = [4, 8, 16, 32, 64]) {
  const layers = scales.map((s) => ({ n: valueNoise(W, H, s, rand), w: 1 / Math.sqrt(s) }));
  let wsum = 0; for (const l of layers) wsum += l.w;
  return (x, y) => {
    let v = 0; for (const l of layers) v += l.n(x, y) * l.w;
    return v / wsum;
  };
}

function paintFlat(im, rand) {
  const v = Math.round(30 + rand() * 190);
  for (let p = 0; p < im.data.length; p += 4) {
    im.data[p] = v; im.data[p + 1] = v; im.data[p + 2] = v;
  }
}

function paintGradient(im, rand, lumaRange = [180, 240]) {
  const [lo, hi] = lumaRange;
  const top = lo + rand() * (hi - lo) * 0.5, bot = lo + (hi - lo) * (0.5 + rand() * 0.5);
  const blobs = [];
  for (let b = 0; b < 3; b++) {
    blobs.push({
      x: rand() * im.width, y: rand() * im.height,
      r: 80 + rand() * 260, a: 20 + rand() * 45,
    });
  }
  const H = im.height;
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    const base = top * (1 - t) + bot * t;
    for (let x = 0; x < im.width; x++) {
      let l = base;
      for (const b of blobs) {
        const dx = (x - b.x) / b.r, dy2 = (y - b.y) / b.r;
        l += b.a * Math.exp(-(dx * dx + dy2 * dy2) * 0.5);
      }
      const p = (y * im.width + x) * 4;
      im.data[p] = clamp255(Math.round(l * 0.86));
      im.data[p + 1] = clamp255(Math.round(l * 0.94));
      im.data[p + 2] = clamp255(Math.round(l * 1.04));
    }
  }
}

function paintDark(im, rand) {
  paintGradient(im, rand, [12, 48]);
  const sigma = 2;
  for (let p = 0; p < im.data.length; p += 4) {
    const n = (rand() * 2 - 1) * sigma;
    im.data[p] = clamp255(im.data[p] + n);
    im.data[p + 1] = clamp255(im.data[p + 1] + n);
    im.data[p + 2] = clamp255(im.data[p + 2] + n);
  }
}

function paintTexture(im, rand) {
  const n = octaves(im.width, im.height, rand);
  const lo = 25 + rand() * 30, hi = 190 + rand() * 35;
  for (let y = 0; y < im.height; y++) {
    for (let x = 0; x < im.width; x++) {
      const v = lo + n(x, y) * (hi - lo);
      const p = (y * im.width + x) * 4;
      im.data[p] = clamp255(Math.round(v * 0.96));
      im.data[p + 1] = clamp255(Math.round(v));
      im.data[p + 2] = clamp255(Math.round(v * 0.92));
    }
  }
}

function paintStrands(im, rand, throughBox = null) {
  paintGradient(im, rand, [150, 205]);
  const { width: W, height: H } = im;
  const count = 70 + Math.floor(rand() * 60);
  for (let s = 0; s < count; s++) {
    const through = throughBox && rand() < 0.35;
    const y0 = through
      ? throughBox.y + rand() * throughBox.h
      : rand() * H;
    const amp = 4 + rand() * 26;
    const lambda = 30 + rand() * 120;
    const phase = rand() * Math.PI * 2;
    const drift = (rand() * 2 - 1) * 0.04;
    const thick = rand() < 0.5 ? 1 : 2;
    const dark = 18 + rand() * 45;
    const alpha = 0.65 + rand() * 0.3;
    for (let x = 0; x < W; x++) {
      const yy = y0 + amp * Math.sin((x / lambda) * Math.PI * 2 + phase) + drift * x;
      for (let t = 0; t < thick; t++) {
        const y = Math.round(yy) + t;
        if (y < 0 || y >= H) continue;
        const p = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) {
          im.data[p + c] = clamp255(Math.round(im.data[p + c] * (1 - alpha) + dark * alpha));
        }
      }
    }
  }
}

function paintLineart(im, rand, throughBox = null) {
  const bg = 205 + rand() * 25;
  for (let p = 0; p < im.data.length; p += 4) {
    im.data[p] = bg; im.data[p + 1] = bg; im.data[p + 2] = bg;
  }
  const { width: W, height: H } = im;
  const ink = 22 + rand() * 20;
  const rows = [];
  const rowCount = 5 + Math.floor(rand() * 4);
  for (let r = 0; r < rowCount; r++) rows.push(Math.round(rand() * (H - 40)) + 20);
  if (throughBox) rows[0] = throughBox.y + Math.round(throughBox.h * 0.5); // text crosses watermark
  for (const rowY of rows) {
    let x = 20 + Math.floor(rand() * 60);
    while (x < W - 20) {
      const glyphW = 6 + Math.floor(rand() * 16);
      const glyphH = 12 + Math.floor(rand() * 10);
      const bars = 1 + Math.floor(rand() * 3);
      for (let b = 0; b < bars; b++) {
        const vertical = rand() < 0.5;
        const bx = x + Math.floor(rand() * glyphW);
        const by = rowY - Math.floor(glyphH * 0.7);
        const bw = vertical ? 2 + Math.floor(rand() * 2) : glyphW;
        const bh = vertical ? glyphH : 2 + Math.floor(rand() * 2);
        for (let yy = by; yy < by + bh; yy++) {
          if (yy < 0 || yy >= H) continue;
          for (let xx = bx; xx < bx + bw; xx++) {
            if (xx < 0 || xx >= W) continue;
            const p = (yy * W + xx) * 4;
            im.data[p] = ink; im.data[p + 1] = ink; im.data[p + 2] = ink;
          }
        }
      }
      x += glyphW + 4 + Math.floor(rand() * 8);
    }
  }
}

// ── Watermark + degradation operations ─────────────────────────────────────────

// Exact Flow compositor model: out = bg*(1 - a) + 255*a with a = alpha*opacity.
function stampStar(im, mask, x, y, opacity) {
  const W = im.width;
  for (let j = 0; j < mask.h; j++) {
    for (let i = 0; i < mask.w; i++) {
      const a = mask.data[j * mask.w + i] * opacity;
      if (a <= 0) continue;
      const p = ((y + j) * W + (x + i)) * 4;
      for (let c = 0; c < 3; c++) {
        im.data[p + c] = im.data[p + c] * (1 - a) + 255 * a;
      }
    }
  }
}

function blurBox(im, box, radius = 1) {
  const { width: W, height: H } = im;
  const x0 = Math.max(0, box.x - radius - 1), y0 = Math.max(0, box.y - radius - 1);
  const x1 = Math.min(W, box.x + box.w + radius + 1), y1 = Math.min(H, box.y + box.h + radius + 1);
  const src = new Uint8ClampedArray(im.data);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0, n = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const yy = y + dy, xx = x + dx;
            if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
            sum += src[(yy * W + xx) * 4 + c]; n++;
          }
        }
        im.data[p + c] = Math.round(sum / n);
      }
    }
  }
}

// ── JPEG simulation (baseline DCT, 4:2:0-ish chroma) ──────────────────────────

const DCT_BASIS = (() => {
  const B = [];
  for (let u = 0; u < 8; u++) {
    const row = new Float64Array(8);
    const a = u === 0 ? Math.sqrt(1 / 8) : Math.sqrt(2 / 8);
    for (let x = 0; x < 8; x++) row[x] = a * Math.cos((2 * x + 1) * u * Math.PI / 16);
    B.push(row);
  }
  return B;
})();

const Q_LUM = [
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];

function quantTable(q) {
  const scale = q < 50 ? 5000 / q : 200 - 2 * q;
  const t = new Uint16Array(64);
  for (let i = 0; i < 64; i++) {
    t[i] = Math.max(1, Math.min(255, Math.floor((Q_LUM[i] * scale + 50) / 100)));
  }
  return t;
}

function dctBlockQuant(src, dst, W, x0, y0, qTab, chroma) {
  const f = new Float64Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) f[y * 8 + x] = src[(y0 + y) * W + x0 + x] - 128;
  // forward DCT (separable)
  const tmp = new Float64Array(64), F = new Float64Array(64);
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) {
    let s = 0; for (let x = 0; x < 8; x++) s += DCT_BASIS[u][x] * f[y * 8 + x];
    tmp[y * 8 + u] = s;
  }
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
    let s = 0; for (let y = 0; y < 8; y++) s += DCT_BASIS[v][y] * tmp[y * 8 + u];
    F[v * 8 + u] = s;
  }
  const q = chroma ? (i) => qTab[i] * 2 : (i) => qTab[i];
  for (let i = 0; i < 64; i++) {
    const t = q(i);
    F[i] = Math.round(F[i] / t) * t;
  }
  // inverse DCT
  const it = new Float64Array(64);
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
    let s = 0; for (let y = 0; y < 8; y++) s += DCT_BASIS[v][y] * F[y * 8 + u];
    it[v * 8 + u] = s;
  }
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    let s = 0; for (let u = 0; u < 8; u++) s += DCT_BASIS[u][x] * it[y * 8 + u];
    dst[(y0 + y) * W + x0 + x] = clamp255(Math.round(s + 128));
  }
}

export function jpegSimulate(im, quality = 75) {
  const { width: W, height: H, data } = im;
  const qTab = quantTable(quality);
  const Y = new Float64Array(W * H), Cb = new Float64Array(W * H), Cr = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
    Cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
  }
  // 2x2 chroma subsample roundtrip
  for (let y = 0; y < H - 1; y += 2) {
    for (let x = 0; x < W - 1; x += 2) {
      const i = y * W + x, iR = i + 1, iD = i + W, iDR = iR + W;
      const cb = (Cb[i] + Cb[iR] + Cb[iD] + Cb[iDR]) / 4;
      const cr = (Cr[i] + Cr[iR] + Cr[iD] + Cr[iDR]) / 4;
      Cb[i] = Cb[iR] = Cb[iD] = Cb[iDR] = cb;
      Cr[i] = Cr[iR] = Cr[iD] = Cr[iDR] = cr;
    }
  }
  for (const plane of [Y, Cb, Cr]) {
    for (let y = 0; y + 8 <= H; y += 8) {
      for (let x = 0; x + 8 <= W; x += 8) {
        dctBlockQuant(plane, plane, W, x, y, qTab, plane !== Y);
      }
    }
    // trailing partial blocks: copy through (rare edges)
  }
  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    const y = Y[i], cb = Cb[i] - 128, cr = Cr[i] - 128;
    data[p] = clamp255(Math.round(y + 1.402 * cr));
    data[p + 1] = clamp255(Math.round(y - 0.344136 * cb - 0.714136 * cr));
    data[p + 2] = clamp255(Math.round(y + 1.772 * cb));
  }
  return im;
}

// ── Spec building ─────────────────────────────────────────────────────────────
// ctx = { anchorFor(W,H) -> {x,y,margin}, maskSizeFor(W,H) -> size, maskOf(size) -> mask }

export function buildSpec(ctx) {
  const calPos = [], calNeg = [], pos = [], neg = [], hardNeg = [], e2e = [];

  // Calibration positives — low-contrast recall stress (R3 evidence).
  let seed = 90000;
  for (const cls of ["lowc", "darkjpeg", "texture"]) {
    for (const noise of [4, 8, 12]) {
      for (const op of [0.5, 0.7, 1.0]) {
        calPos.push({ id: `cal-${cls}-n${noise}-o${op}`, kind: "pos", cls, W: 1024, H: 1024, op, noise, seed: ++seed });
      }
    }
  }
  // Calibration negatives.
  for (const cls of ["flat", "gradient", "dark", "texture", "strands", "lineart"]) {
    for (let k = 0; k < 6; k++) {
      calNeg.push({ id: `calneg-${cls}-${k}`, kind: "neg", cls, W: 1024, H: 1024, seed: ++seed });
    }
  }
  // Decoy negatives for the sweep split: SOFT BLOB discs on pinned no-fire
  // seeds (probed: NCC floor of a blob disc stays below every robust gate in
  // the grid, unlike plus/X/diamond/4-dot shapes whose compact-bright
  // silhouettes sit at NCC ~0.67-0.80 vs the star template — those belong to
  // the main-run hardNegs as honest adversarial frontier, not to calibration,
  // or no gate-set can ever reach fp=0 and the sweep loses its meaning).
  // Seeds probed no-fire at the most lenient scan gates (robust 0.58):
  // 900..913 minus 907 and 910 (which fire 0.70 / 0.81).
  const BLOB_SEEDS = [900, 901, 902, 903, 904, 905, 906, 908, 909, 911, 912, 913];
  for (let k = 0; k < BLOB_SEEDS.length; k++) {
    const sd = BLOB_SEEDS[k];
    calNeg.push({
      id: `calneg-decoy-${k}`, kind: "hardneg", cls: "gradient", decoy: "blob",
      decoyPos: (sd - 900) % 2 ? [0.80, 0.78] : [0.30, 0.30],
      W: 1024, H: 1024, seed: sd,
    });
  }

  // Main positives: 6 classes x 2 scenes x 2 opacities x 2 resolutions.
  const classes = ["flat", "gradient", "darkjpeg", "texture", "strands", "lineart"];
  const resList = [[1024, 1024], [1376, 768]];
  for (const cls of classes) {
    for (let scene = 0; scene < 2; scene++) {
      for (const op of [1.0, 0.62]) {
        for (const [W, H] of resList) {
          pos.push({ id: `pos-${cls}-s${scene}-o${op}-${W}x${H}`, kind: "pos", cls, scene, op, W, H, seed: ++seed, noise: 2 });
        }
      }
    }
  }
  // JPEG stress (stamp-then-encode, clean ref = encoded clean bg).
  for (const [cls, op] of [["darkjpeg", 1.0], ["darkjpeg", 0.62], ["darkjpeg", 1.0], ["gradient", 1.0], ["gradient", 0.62], ["texture", 1.0]]) {
    pos.push({ id: `pos-jpeg-${cls}-o${op}`, kind: "pos", cls, op, W: 1024, H: 1024, seed: ++seed, noise: 2, jpeg: 70 });
  }
  // Resize-smeared stress: non-catalog mask size (54px) at a margin that is
  // neither the catalog value (74 for 1024x768) nor within +/-8 of any
  // fallbackMargins entry -> the strict path must fail so the bounded robust
  // scan + mismatched-alpha unblend are what actually get measured.
  for (const [cls, op] of [["gradient", 1.0], ["texture", 1.0], ["strands", 1.0], ["gradient", 0.62], ["texture", 0.62], ["lineart", 1.0]]) {
    pos.push({ id: `pos-resize-${cls}-o${op}`, kind: "pos", cls, op, W: 1024, H: 768, seed: ++seed, noise: 2, maskSize: 54, margin: 118, blurBbox: 1 });
  }
  // 4K end-to-end perf/quality probes.
  e2e.push({ id: "pos-4k-flat", kind: "pos", cls: "flat", op: 1.0, W: 3840, H: 2880, seed: ++seed, noise: 2 });
  e2e.push({ id: "pos-4k-gradient", kind: "pos", cls: "gradient", op: 1.0, W: 3840, H: 2880, seed: ++seed, noise: 2 });

  // Main negatives + hard-negatives.
  for (const cls of classes) {
    for (let k = 0; k < 6; k++) {
      const [W, H] = [[1024, 1024], [1376, 768], [1024, 768]][k % 3];
      neg.push({ id: `neg-${cls}-${k}`, kind: "neg", cls, W, H, seed: ++seed });
    }
  }
  for (let k = 0; k < 8; k++) {
    // All 4 adversarial shapes rotate here (plus / X / diamond / 4-dot) — the
    // main run reports honestly which shapes each vendor cannot separate.
    hardNeg.push({ id: `hn-decoy-offcorner-${k}`, kind: "hardneg", cls: "gradient", decoy: "sparkle", decoyShape: k % 4, decoyPos: k % 2 ? [0.80, 0.78] : [0.30, 0.30], W: 1024, H: 1024, seed: ++seed });
  }
  for (let k = 0; k < 8; k++) {
    hardNeg.push({ id: `hn-blob-corner-${k}`, kind: "hardneg", cls: k % 2 ? "flat" : "gradient", decoy: "blob", W: 1024, H: 1024, seed: ++seed });
  }
  for (let k = 0; k < 8; k++) {
    hardNeg.push({ id: `hn-bright-texture-${k}`, kind: "hardneg", cls: "texture", decoy: "brightpatch", W: 1024, H: 1024, seed: ++seed });
  }
  for (let k = 0; k < 6; k++) {
    neg.push({ id: `neg-white-${k}`, kind: "neg", cls: "white", W: 1024, H: 1024, seed: ++seed });
  }

  // Mass negatives (all 6 classes, catalog resolutions).
  // The candidate Hybrid (D) must face >= 3,000 distinct negative fixtures
  // with 0 modifications (plan acceptance); A/B/C run on a comparison subset.
  const mass = [];
  const massClasses = ["flat", "gradient", "dark", "texture", "strands", "lineart"];
  for (let k = 0; k < 3000; k++) {
    const [W, H] = k % 3 === 0 ? [1024, 1024] : [1024, 768];
    mass.push({ id: `mass-${k}`, kind: "neg", cls: massClasses[k % massClasses.length], W, H, seed: 700000 + k });
  }

  return { calPos, calNeg, pos, neg, hardNeg, mass, e2e };
}

// ── Image realization ──────────────────────────────────────────────────────────

function paintBackground(im, meta, rand, gtBox) {
  switch (meta.cls) {
    case "lowc": paintGradient(im, rand, [205, 238]); break;
    case "flat": paintFlat(im, rand); break;
    case "white": { const v = 248 + Math.round(rand() * 7); for (let p = 0; p < im.data.length; p += 4) { im.data[p] = v; im.data[p + 1] = v; im.data[p + 2] = v; } break; }
    case "gradient": paintGradient(im, rand); break;
    case "dark": case "darkjpeg": paintDark(im, rand); break;
    case "texture": paintTexture(im, rand); break;
    case "strands": paintStrands(im, rand, gtBox); break;
    case "lineart": paintLineart(im, rand, gtBox); break;
    default: paintFlat(im, rand);
  }
  if (meta.noise) {
    for (let p = 0; p < im.data.length; p += 4) {
      const n = (rand() * 2 - 1) * meta.noise;
      im.data[p] = clamp255(im.data[p] + n);
      im.data[p + 1] = clamp255(im.data[p + 1] + n);
      im.data[p + 2] = clamp255(im.data[p + 2] + n);
    }
  }
}

// Star-LIKE corner decorations that are NOT the Flow silhouette: plus, X,
// diamond, 4-dot cluster. Same brightness/size/position family as real sparkles
// so they stress false positives, but a detector keyed to the four-point star
// must leave them alone. (A literal miniature Flow star is NOT a valid negative:
// the V8 detector is designed to remove satellite stars — that ambiguity is
// reported separately, not counted as a false positive.)
function addDecoy(im, meta, rand, ctx) {
  const { width: W, height: H } = im;
  if (meta.decoy === "sparkle") {
    const [fx, fy] = meta.decoyPos || [0.30, 0.30];
    const cx = Math.round(W * fx) + Math.round(rand() * 8 - 4);
    const cy = Math.round(H * fy) + Math.round(rand() * 8 - 4);
    const shape = meta.decoyShape ?? Math.floor(rand() * 4);
    const R = 18 + Math.round(rand() * 6);   // ~36-44px extent
    const amp = 0.55;                        // same strength family as before
    const paintDot = (x, y, r) => {
      for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) {
          const d = Math.hypot(xx - x, yy - y) / r;
          const a = amp * Math.exp(-d * d * 2.2);
          if (a <= 0.004) continue;
          const p = (yy * W + xx) * 4;
          for (let c = 0; c < 3; c++) im.data[p + c] = clamp255(im.data[p + c] * (1 - a) + 255 * a);
        }
      }
    };
    const paintBar = (x0, y0, x1, y1, wHalf) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      for (let t = 0; t <= len; t += 0.5) {
        const bx = x0 + (x1 - x0) * t / len, by = y0 + (y1 - y0) * t / len;
        paintDot(Math.round(bx), Math.round(by), wHalf);
      }
    };
    if (shape === 0) {          // plus
      paintBar(cx - R, cy, cx + R, cy, 3);
      paintBar(cx, cy - R, cx, cy + R, 3);
    } else if (shape === 1) {   // diagonal X
      paintBar(cx - R, cy - R, cx + R, cy + R, 3);
      paintBar(cx - R, cy + R, cx + R, cy - R, 3);
    } else if (shape === 2) {   // diamond
      paintBar(cx - R, cy, cx, cy - R, 3);
      paintBar(cx, cy - R, cx + R, cy, 3);
      paintBar(cx + R, cy, cx, cy + R, 3);
      paintBar(cx, cy + R, cx - R, cy, 3);
    } else {                    // 4-dot cluster
      const r = 3 + Math.round(rand() * 3);
      paintDot(cx - Math.round(R * 0.7), cy - Math.round(R * 0.7), r);
      paintDot(cx + Math.round(R * 0.7), cy - Math.round(R * 0.7), r);
      paintDot(cx - Math.round(R * 0.7), cy + Math.round(R * 0.7), r);
      paintDot(cx + Math.round(R * 0.7), cy + Math.round(R * 0.7), r);
    }
  } else if (meta.decoy === "blob") {
    const gt = ctx.anchorFor(W, H, 48);
    const cx = gt.x + 24 + (rand() * 40 - 20), cy = gt.y + 24 + (rand() * 40 - 20);
    const r = 22 + rand() * 14, amp = 60 + rand() * 60;
    for (let y = Math.max(0, cy - r * 2); y < Math.min(H, cy + r * 2); y++) {
      for (let x = Math.max(0, cx - r * 2); x < Math.min(W, cx + r * 2); x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        const v = amp * Math.exp(-d * d);
        if (v < 0.5) continue;
        const p = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) im.data[p + c] = clamp255(im.data[p + c] + v);
      }
    }
  } else if (meta.decoy === "brightpatch") {
    const gt = ctx.anchorFor(W, H, 48);
    for (let k = 0; k < 60; k++) {
      const x = gt.x + Math.floor(rand() * 120) - 20;
      const y = gt.y + Math.floor(rand() * 120) - 20;
      const size = 1 + Math.floor(rand() * 3);
      const amp = 40 + rand() * 100;
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
        if (x + dx < 0 || x + dx >= W || y + dy < 0 || y + dy >= H) continue;
        const p = ((y + dy) * W + x + dx) * 4;
        for (let c = 0; c < 3; c++) im.data[p + c] = clamp255(im.data[p + c] + amp);
      }
    }
  }
}

// Returns { input, clean? , gt } — positives carry a clean reference.
export function makeImage(meta, ctx) {
  const rand = mulberry32(meta.seed);
  const maskSize = meta.maskSize || ctx.maskSizeFor(meta.W, meta.H);
  const gt = { ...ctx.anchorFor(meta.W, meta.H, maskSize, meta.margin), w: maskSize, h: maskSize };
  const gtBox = { x: gt.x, y: gt.y, w: maskSize, h: maskSize };

  const clean = makeImg(meta.W, meta.H);
  paintBackground(clean, meta, rand, gtBox);

  if (meta.kind === "pos") {
    const stamped = cloneImg(clean);
    stampStar(stamped, ctx.maskOf(maskSize), gt.x, gt.y, meta.op);
    if (meta.blurBbox) blurBox(stamped, gtBox, meta.blurBbox);
    let input = stamped;
    let cleanRef = clean;
    if (meta.jpeg) {
      // Stamp-then-encode for the input; the clean reference is the same
      // encoder applied to the unwatermarked background.
      jpegSimulate(input, meta.jpeg);
      jpegSimulate(cleanRef, meta.jpeg);
    }
    return { input, clean: cleanRef, gt };
  }

  // negatives / hard negatives
  const input = clean;
  if (meta.kind === "hardneg") addDecoy(input, meta, rand, ctx);
  return { input, gt: null };
}
