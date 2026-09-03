import test from "node:test";
import assert from "node:assert/strict";

// The remover is an IIFE that publishes the class on globalThis (CJS guard
// is skipped because package.json sets "type": "module").
await import("../lib/LocalGeminiWatermarkRemover.js");
const Remover = globalThis.LocalGeminiWatermarkRemover;
assert.ok(Remover, "LocalGeminiWatermarkRemover must publish on globalThis");

// Silence the detector's per-locate debug logging (test output readability).
const origLog = console.log;
console.log = () => {};
process.on("exit", () => { console.log = origLog; });

// ── Synthetic fixture helpers ──────────────────────────────────────────────────
const W = 1024, H = 1024;
const MARGIN = 78;                     // WATERMARK_PROFILES.image["1024x1024"].margin
const ANCHOR = { x: W - 48 - MARGIN, y: H - 48 - MARGIN }; // (898, 898)
const NCC_THRESHOLD = 0.40;            // strict gate (V8)
const ROBUST_NCC_THRESHOLD = 0.58;    // robust gate (V8)

// Deterministic seeded PRNG (mulberry32).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeImage() {
  return { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
}

function fill(img, value) {
  for (let p = 0; p < img.data.length; p += 4) {
    img.data[p] = value; img.data[p + 1] = value; img.data[p + 2] = value; img.data[p + 3] = 255;
  }
}

// Compose the watermark exactly like Flow does: out = bg*(1-a) + star*a.
function stampStar(img, mask, x, y, opacity = 1.0, starLum = 255) {
  for (let j = 0; j < mask.h; j++) {
    for (let i = 0; i < mask.w; i++) {
      const a = mask.data[j * mask.w + i] * opacity;
      if (a <= 0) continue;
      const p = ((y + j) * W + (x + i)) * 4;
      for (let c = 0; c < 3; c++) {
        img.data[p + c] = img.data[p + c] * (1 - a) + starLum * a;
      }
    }
  }
}

function addNoise(img, amp, rand) {
  for (let p = 0; p < img.data.length; p += 4) {
    for (let c = 0; c < 3; c++) {
      img.data[p + c] += (rand() * 2 - 1) * amp;
    }
  }
}

const mask48 = Remover.getVideoMask(48, 48);

// ── Tests ─────────────────────────────────────────────────────────────────────

test("V8 detector — full-strength star on flat background is detected via the strict anchor", async () => {
  const img = makeImage();
  fill(img, 100);
  stampStar(img, mask48, ANCHOR.x, ANCHOR.y, 1.0);

  const result = await Remover.process(img);

  assert.equal(result.applied, true);
  assert.equal(result.clean, true);
  assert.equal(result.variantId, "v8-detector-v7-restore");
  assert.equal(result.mode, "strict");
  assert.ok(Math.abs(result.threshold - NCC_THRESHOLD) < 1e-9,
    `strict path must report the strict threshold, got ${result.threshold}`);
  assert.ok(Math.abs(result.pos.x - ANCHOR.x) <= 3, `pos.x ${result.pos.x} should be ~${ANCHOR.x}`);
  assert.ok(Math.abs(result.pos.y - ANCHOR.y) <= 3, `pos.y ${result.pos.y} should be ~${ANCHOR.y}`);
  assert.ok(result.touched > 0, "restoration must touch pixels");
});

test("V8 detector — flat background without a star is rejected (no false positive)", async () => {
  const img = makeImage();
  fill(img, 100);

  const result = await Remover.process(img);

  assert.equal(result.applied, false);
  assert.equal(result.reason, "watermark_not_found");
});

test("V8 detector — F1 regression: strict hit in the 0.45–0.58 band must be accepted (gate = NCC_THRESHOLD, not 0.58)", async () => {
  // Self-calibrate the noise amplitude (deterministic PRNG) until the strict
  // anchor NCC lands in [0.46, 0.55]: above NCC_THRESHOLD (0.40), below the
  // old hardcoded 0.58 seed gate, and at/above 0.45 so the robust branch is
  // not entered (that branch legitimately requires 0.58).
  let calibrated = null;
  for (let amp = 10; amp <= 220; amp += 2) {
    const img = makeImage();
    fill(img, 100);
    stampStar(img, mask48, ANCHOR.x, ANCHOR.y, 0.8);
    addNoise(img, amp, mulberry32(20260903));

    const hit = Remover.locate(img, mask48);
    if (hit && hit.ncc >= 0.46 && hit.ncc <= 0.55) {
      calibrated = { amp, ncc: hit.ncc, img };
      break;
    }
  }
  assert.ok(calibrated, "calibration must find a low-contrast strict case in [0.46, 0.55]");

  const result = await Remover.process(calibrated.img);

  // This fails before the F1 fix (seed re-gated at hardcoded 0.58) and must
  // pass after (seed re-gated at its own accepted threshold = 0.40).
  assert.equal(result.applied, true,
    `low-contrast strict detection (NCC=${calibrated.ncc.toFixed(3)}) must be accepted`);
  assert.ok(Math.abs(result.threshold - NCC_THRESHOLD) < 1e-9);
  assert.ok(Math.abs(result.pos.x - ANCHOR.x) <= 3);
  assert.ok(Math.abs(result.pos.y - ANCHOR.y) <= 3);
});

test("V8 detector — diagnostics contract (typed result fields)", async () => {
  const clean = makeImage();
  fill(clean, 100);
  stampStar(clean, mask48, ANCHOR.x, ANCHOR.y, 1.0);
  const applied = await Remover.process(clean);

  assert.equal(typeof applied.ncc, "number");
  assert.ok(applied.ncc >= NCC_THRESHOLD);
  assert.equal(typeof applied.threshold, "number");
  assert.equal(typeof applied.gain, "number");
  for (const key of ["x", "y", "w", "h"]) {
    assert.equal(typeof applied.pos[key], "number", `pos.${key} must be a number`);
  }
  assert.ok(Array.isArray(applied.detections) && applied.detections.length >= 1);
  for (const d of applied.detections) {
    for (const key of ["x", "y", "w", "h", "ncc"]) {
      assert.equal(typeof d[key], "number", `detection.${key} must be a number`);
    }
  }

  const blank = makeImage();
  fill(blank, 100);
  const rejected = await Remover.process(blank);

  assert.equal(rejected.applied, false);
  assert.equal(typeof rejected.reason, "string");
  assert.equal(typeof rejected.mode, "string");
  assert.equal(typeof rejected.threshold, "number");
  assert.ok(rejected.threshold === NCC_THRESHOLD || rejected.threshold === ROBUST_NCC_THRESHOLD);
});
