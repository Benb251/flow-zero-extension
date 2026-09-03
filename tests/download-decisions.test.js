import test from "node:test";
import assert from "node:assert/strict";
import { planNativeDownloadAction } from "../lib/flowzero-utils.js";

// V8 plan Phase 4 decision table: the only inputs are the offscreen result
// contract and whether the original native download was successfully paused.

test("planNativeDownloadAction — cleaned result replaces the original download", () => {
  assert.deepEqual(
    planNativeDownloadAction({ success: true, cleaned: true }, { pausedOriginal: true }),
    { downloadReplacement: true, cancelOriginal: true, resumeOriginal: false }
  );
});

test("planNativeDownloadAction — no-logo result resumes the paused original", () => {
  assert.deepEqual(
    planNativeDownloadAction({ success: true, cleaned: false }, { pausedOriginal: true }),
    { downloadReplacement: false, cancelOriginal: false, resumeOriginal: true }
  );
});

test("planNativeDownloadAction — no-logo result without a pause leaves everything untouched", () => {
  assert.deepEqual(
    planNativeDownloadAction({ success: true, cleaned: false }, { pausedOriginal: false }),
    { downloadReplacement: false, cancelOriginal: false, resumeOriginal: false }
  );
});

test("planNativeDownloadAction — null result resumes the paused original (fail-safe)", () => {
  assert.deepEqual(
    planNativeDownloadAction(null, { pausedOriginal: true }),
    { downloadReplacement: false, cancelOriginal: false, resumeOriginal: true }
  );
});

test("planNativeDownloadAction — cleaned undefined is treated as not cleaned", () => {
  assert.deepEqual(
    planNativeDownloadAction({ success: true }, { pausedOriginal: true }),
    { downloadReplacement: false, cancelOriginal: false, resumeOriginal: true }
  );
});

test("planNativeDownloadAction — failed processing resumes the paused original", () => {
  assert.deepEqual(
    planNativeDownloadAction({ success: false, error: "boom" }, { pausedOriginal: true }),
    { downloadReplacement: false, cancelOriginal: false, resumeOriginal: true }
  );
});
