import test from "node:test";
import assert from "node:assert/strict";
import { isVerifiedCleanOutput, planNativeDownloadAction } from "../lib/flowzero-utils.js";

// V8 plan Phase 4 decision table: the only inputs are the offscreen result
// contract and whether the original native download was successfully paused.

test("planNativeDownloadAction — cleaned result replaces the original download", () => {
  assert.deepEqual(
    planNativeDownloadAction({
      success: true,
      cleaned: true,
      cleanDataUrl: "data:image/png;base64,AAAA",
      stats: { touched: 64 }
    }, { pausedOriginal: true }),
    { downloadReplacement: true, discardOriginal: true, resumeOriginal: false }
  );
});

test("planNativeDownloadAction — no-logo result discards the paused original", () => {
  assert.deepEqual(
    planNativeDownloadAction({ success: true, cleaned: false }, { pausedOriginal: true }),
    { downloadReplacement: false, discardOriginal: true, resumeOriginal: false }
  );
});

test("planNativeDownloadAction — no-logo result without a pause still discards the original", () => {
  assert.deepEqual(
    planNativeDownloadAction({ success: true, cleaned: false }, { pausedOriginal: false }),
    { downloadReplacement: false, discardOriginal: true, resumeOriginal: false }
  );
});

test("planNativeDownloadAction — null result discards the original (fail-closed)", () => {
  assert.deepEqual(
    planNativeDownloadAction(null, { pausedOriginal: true }),
    { downloadReplacement: false, discardOriginal: true, resumeOriginal: false }
  );
});

test("planNativeDownloadAction — cleaned undefined is blocked", () => {
  assert.deepEqual(
    planNativeDownloadAction({ success: true }, { pausedOriginal: true }),
    { downloadReplacement: false, discardOriginal: true, resumeOriginal: false }
  );
});

test("planNativeDownloadAction — failed processing discards the original", () => {
  assert.deepEqual(
    planNativeDownloadAction({ success: false, error: "boom" }, { pausedOriginal: true }),
    { downloadReplacement: false, discardOriginal: true, resumeOriginal: false }
  );
});

test("verified clean output requires a local media DataURL", () => {
  assert.equal(isVerifiedCleanOutput({
    success: true,
    cleaned: true,
    cleanDataUrl: "data:image/png;base64,AAAA",
    stats: { touched: 1 }
  }), true);

  assert.equal(isVerifiedCleanOutput({
    success: true,
    cleaned: true,
    cleanDataUrl: "data:video/mp4;base64,AAAA",
    stats: { frames: 1 }
  }), true);

  assert.equal(isVerifiedCleanOutput({
    success: true,
    cleaned: true,
    passthroughUrl: "https://flow-content.google/file.png"
  }), false);

  assert.equal(isVerifiedCleanOutput({
    success: true,
    cleaned: true,
    cleanDataUrl: "https://flow-content.google/file.png"
  }), false);

  assert.equal(isVerifiedCleanOutput({
    success: true,
    cleaned: true,
    cleanDataUrl: "data:image/png;base64,AAAA",
    stats: { touched: 0 }
  }), false);

  assert.equal(isVerifiedCleanOutput({
    success: true,
    cleaned: true,
    cleanDataUrl: "data:video/mp4;base64,AAAA",
    stats: { frames: 0 }
  }), false);
});

test("planNativeDownloadAction — cleaned flag without clean payload is blocked", () => {
  assert.deepEqual(
    planNativeDownloadAction({
      success: true,
      cleaned: true,
      passthroughUrl: "https://flow-content.google/file.png"
    }, { pausedOriginal: true }),
    { downloadReplacement: false, discardOriginal: true, resumeOriginal: false }
  );
});
