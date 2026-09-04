// tests/real-image.test.js — regression test on a REAL flow.google.com export.
//
// Fixture: real-flow-512x382.rgba — raw RGBA pixels (512x382) decoded from a
// genuine flow.google.com webp download (Picasa EXIF + "Made with Google AI"
// XMP verified). The sparkle renders scaled-down at ~20px, NCC 0.869 at
// (459,329) — the case that motivated the dense small-size ladder (floor 14)
// and the <=26px masked-inpaint restore path in LocalGeminiWatermarkRemover.
//
// This test locks today's verified behavior in place:
//   1. Detection fires (no watermark_not_found passthrough).
//   2. The detected star is the small ~20px one at the measured position
//      (not a wrong larger/lower-NCC candidate).
//   3. The restore leaves no star correlation at that spot.
//   4. No pixel outside the star box (+ small inpaint pad) is touched.
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
await import(url.pathToFileURL(path.join(__dirname, "..", "lib", "LocalGeminiWatermarkRemover.js")).href);
const Remover = globalThis.LocalGeminiWatermarkRemover;
assert.ok(Remover, "LocalGeminiWatermarkRemover must be defined (IIFE sets globalThis)");

const W = 512, H = 382;
const STAR = { x: 459, y: 329, size: 20 };

function loadFixture() {
  const raw = fs.readFileSync(path.join(__dirname, "fixtures", "real-flow-512x382.rgba"));
  assert.equal(raw.length, W * H * 4, "fixture must be 512x382x4 bytes");
  const data = new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length);
  return { data, width: W, height: H };
}

test("Real flow.google.com 512x382 export — small star is detected and removed cleanly", async () => {
  const imageData = loadFixture();
  const before = Uint8ClampedArray.from(imageData.data);

  const result = await Remover.process(imageData);
  assert.equal(result.applied, true, "detection must fire on the real export");
  assert.ok(!result.reason, `unexpected reason: ${result.reason}`);

  // 1. The chosen detection must be the small star at the measured position.
  assert.ok(result.pos, "result.pos must be set");
  const cx = result.pos.x + result.pos.w / 2;
  const cy = result.pos.y + result.pos.h / 2;
  const starCx = STAR.x + STAR.size / 2;
  const starCy = STAR.y + STAR.size / 2;
  const dist = Math.hypot(cx - starCx, cy - starCy);
  assert.ok(dist <= 6, `detection center (${cx},${cy}) too far from the real star (${starCx},${starCy})`);
  assert.ok(result.pos.w >= 16 && result.pos.w <= 26, `unexpected mask size ${result.pos.w}px`);
  assert.ok(result.ncc >= 0.80, `detection NCC ${result.ncc} below the measured 0.869 band`);

  // 2. Star removal check on the CHANGED pixel set: before restore the star
  // core peaked at luma ~90 over a ~20 background; after restore no changed
  // pixel may stay that bright (artwork pixels are untouched by definition,
  // so a bright survivor here means the star itself survived).
  const lumaAt = (img, x, y) => {
    const p = (y * W + x) * 4;
    return 0.299 * img[p] + 0.587 * img[p + 1] + 0.114 * img[p + 2];
  };
  let changed = 0, changedMaxAfter = 0, starPeakBefore = 0;
  for (let y = STAR.y; y < STAR.y + STAR.size; y++) {
    for (let x = STAR.x; x < STAR.x + STAR.size; x++) {
      const after = lumaAt(imageData.data, x, y);
      const before2 = lumaAt(before, x, y);
      if (Math.abs(after - before2) > 10) {
        changed++;
        if (after > changedMaxAfter) changedMaxAfter = after;
        if (before2 > starPeakBefore) starPeakBefore = before2;
      }
    }
  }
  assert.ok(changed >= 150, `restore touched only ${changed} px in the star box — star not processed`);
  assert.ok(starPeakBefore >= 80, `expected the real star core (luma>=80) inside the box, saw ${starPeakBefore}`);
  assert.ok(changedMaxAfter <= 70, `star residue: changed pixel still at luma ${changedMaxAfter}`);

  // 3. Containment: no pixel outside the star box + inpaint pad changed.
  const pad = 6;
  let outside = 0;
  for (let p = 0; p < before.length; p += 4) {
    if (imageData.data[p] !== before[p] || imageData.data[p + 1] !== before[p + 1] || imageData.data[p + 2] !== before[p + 2]) {
      const idx = p / 4;
      const x = idx % W, y = Math.floor(idx / W);
      if (x < STAR.x - pad || x >= STAR.x + STAR.size + pad || y < STAR.y - pad || y >= STAR.y + STAR.size + pad) outside++;
    }
  }
  assert.equal(outside, 0, "restore touched pixels outside the star box");
});
