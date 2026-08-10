import test from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedFlowMediaUrl,
  sanitizeFilename,
  detectMediaType,
  selectMediaSource
} from "../lib/flowzero-utils.js";

test("URL Allowlist Validation - Trusted Domain", () => {
  assert.equal(isAllowedFlowMediaUrl("https://labs.google/fx/api/trpc/media"), true);
  assert.equal(isAllowedFlowMediaUrl("https://flow-content.google/v1/media/123"), true);
  assert.equal(isAllowedFlowMediaUrl("https://storage.googleapis.com/flow-bucket/sample.png"), true);
  assert.equal(isAllowedFlowMediaUrl("https://lh3.googleusercontent.com/abc=s2048"), true);
});

test("URL Allowlist Validation - Rejected URLs", () => {
  assert.equal(isAllowedFlowMediaUrl("http://labs.google/fx/api"), false);
  assert.equal(isAllowedFlowMediaUrl("https://evilgoogle.com/malicious"), false);
  assert.equal(isAllowedFlowMediaUrl("https://google.com.attacker.com/fake"), false);
  assert.equal(isAllowedFlowMediaUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedFlowMediaUrl("file:///C:/Windows/system32"), false);
  assert.equal(isAllowedFlowMediaUrl("blob:https://labs.google/12345"), false);
});

test("Select Media Source - blob: Fallback Regression", () => {
  const mediaUrl = "blob:https://labs.google/12345";
  const videoUrl = "data:video/mp4;base64,AAAAFftypmp42";
  
  const result = selectMediaSource(mediaUrl, videoUrl, null);
  assert.equal(result.isValid, true);
  assert.equal(result.selectedRemoteUrl, null);
  assert.equal(result.selectedSource, videoUrl);
});

test("Select Media Source - Trusted HTTP Preference", () => {
  const mediaUrl = "https://flow-content.google/v1/media/12345";
  const videoUrl = "data:video/mp4;base64,AAAAFftypmp42";

  const result = selectMediaSource(mediaUrl, videoUrl, null);
  assert.equal(result.isValid, true);
  assert.equal(result.selectedRemoteUrl, mediaUrl);
  assert.equal(result.selectedSource, null);
});

test("Filename Sanitization", () => {
  assert.equal(sanitizeFilename("file:name/with*invalid?chars.png"), "file_name_with_invalid_chars.png");
  assert.equal(sanitizeFilename("normal_file.mp4"), "normal_file.mp4");
});

test("Media Type Detection", () => {
  assert.equal(detectMediaType("https://storage.googleapis.com/test.mp4", "test.mp4"), "video");
  assert.equal(detectMediaType("https://storage.googleapis.com/test.png", "test.png"), "image");
});
