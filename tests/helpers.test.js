import test from "node:test";
import assert from "node:assert/strict";

// Helper functions for testing
function isAllowedFlowMediaUrl(value) {
  if (!value || typeof value !== "string") return false;
  if (value.startsWith("data:")) return true;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return (
      host === "labs.google" ||
      host === "flow-content.google" ||
      host === "storage.googleapis.com" ||
      host.endsWith(".googleusercontent.com")
    );
  } catch {
    return false;
  }
}

function sanitizeFilename(filename) {
  const safe = filename || `flowzero_${Date.now()}`;
  return safe.replace(/[\\/:*?"<>|]/g, "_");
}

function detectMediaType(url, filename) {
  const isVideo = /\.(mp4|webm)(\?.*)?$/i.test(url || "") || (typeof filename === "string" && filename.toLowerCase().endsWith(".mp4"));
  return isVideo ? "video" : "image";
}

test("URL Allowlist Validation", () => {
  assert.equal(isAllowedFlowMediaUrl("https://labs.google/fx/api/trpc/media"), true);
  assert.equal(isAllowedFlowMediaUrl("https://flow-content.google/v1/media/123"), true);
  assert.equal(isAllowedFlowMediaUrl("https://storage.googleapis.com/flow-bucket/sample.png"), true);
  assert.equal(isAllowedFlowMediaUrl("https://lh3.googleusercontent.com/abc=s2048"), true);

  // Rejections
  assert.equal(isAllowedFlowMediaUrl("http://labs.google/fx/api"), false); // HTTP rejected
  assert.equal(isAllowedFlowMediaUrl("https://evilgoogle.com/malicious"), false);
  assert.equal(isAllowedFlowMediaUrl("https://google.com.attacker.com/fake"), false);
  assert.equal(isAllowedFlowMediaUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedFlowMediaUrl("file:///C:/Windows/system32"), false);
});

test("Filename Sanitization", () => {
  assert.equal(sanitizeFilename("file:name/with*invalid?chars.png"), "file_name_with_invalid_chars.png");
  assert.equal(sanitizeFilename("normal_file.mp4"), "normal_file.mp4");
});

test("Media Type Detection", () => {
  assert.equal(detectMediaType("https://storage.googleapis.com/test.mp4", "test.mp4"), "video");
  assert.equal(detectMediaType("https://storage.googleapis.com/test.png", "test.png"), "image");
});
