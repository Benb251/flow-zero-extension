import test from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedFlowMediaUrl,
  isAllowedFlowDownloadReferrer,
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

test("Download Referrer Validation - Accepted Flow Origins", () => {
  assert.equal(isAllowedFlowDownloadReferrer("https://labs.google/flow"), true);
  assert.equal(isAllowedFlowDownloadReferrer("https://labs.google/fx/editor/project123"), true);
  assert.equal(isAllowedFlowDownloadReferrer("https://LABS.GOOGLE/flow"), true);
});

test("Download Referrer Validation - Rejected Non-Flow & Malformed Referrers", () => {
  assert.equal(isAllowedFlowDownloadReferrer("http://labs.google/flow"), false); // HTTP rejected
  assert.equal(isAllowedFlowDownloadReferrer(""), false); // empty string
  assert.equal(isAllowedFlowDownloadReferrer(null), false); // null
  assert.equal(isAllowedFlowDownloadReferrer(undefined), false); // undefined
  assert.equal(isAllowedFlowDownloadReferrer("not-a-url"), false); // malformed
  assert.equal(isAllowedFlowDownloadReferrer("https://labs.google.attacker.example/"), false); // subdomain spoof
  assert.equal(isAllowedFlowDownloadReferrer("https://evil-labs.google/"), false); // domain prefix spoof
  assert.equal(isAllowedFlowDownloadReferrer("https://google.com/"), false); // other google domain
  assert.equal(isAllowedFlowDownloadReferrer("https://otherwebsite.com/gallery"), false); // third party
});

test("Download Interception Decision - Non-Flow Referrer with Google CDN Media", () => {
  const itemFromThirdParty = {
    referrer: "https://otherwebsite.com/blog",
    url: "https://storage.googleapis.com/some-bucket/photo.jpg"
  };
  const shouldInterceptThirdParty = isAllowedFlowDownloadReferrer(itemFromThirdParty.referrer) && isAllowedFlowMediaUrl(itemFromThirdParty.url);
  assert.equal(shouldInterceptThirdParty, false);

  const itemFromFlow = {
    referrer: "https://labs.google/flow",
    url: "https://storage.googleapis.com/flow-bucket/photo.jpg"
  };
  const shouldInterceptFlow = isAllowedFlowDownloadReferrer(itemFromFlow.referrer) && isAllowedFlowMediaUrl(itemFromFlow.url);
  assert.equal(shouldInterceptFlow, true);
});

test("Select Media Source - blob: Fallback Regression", () => {
  const mediaUrl = "blob:https://labs.google/12345";
  const videoUrl = "data:video/mp4;base64,AAAAFftypmp42";
  
  const result = selectMediaSource(mediaUrl, videoUrl, null);
  assert.equal(result.isValid, true);
  assert.equal(result.remoteUrl, null);
  assert.equal(result.fallbackDataUrl, videoUrl);
});

test("Select Media Source - Trusted HTTP Preference & Fallback Preservation", () => {
  const mediaUrl = "https://flow-content.google/v1/media/12345";
  const videoUrl = "data:video/mp4;base64,AAAAFftypmp42";

  const result = selectMediaSource(mediaUrl, videoUrl, null);
  assert.equal(result.isValid, true);
  assert.equal(result.remoteUrl, mediaUrl);
  assert.equal(result.fallbackDataUrl, videoUrl);
});

test("Direct HTTP Video Passthrough Resolution (applied=false)", () => {
  const offscreenResult = {
    success: true,
    cleaned: false,
    cleanDataUrl: null,
    passthroughUrl: "https://flow-content.google/v1/media/12345",
    reason: "watermark_not_applied"
  };

  const finalMediaUrl = offscreenResult.cleanDataUrl || offscreenResult.passthroughUrl || "fallback";
  assert.equal(finalMediaUrl, "https://flow-content.google/v1/media/12345");
});

test("Self-download Guard (byExtensionId)", () => {
  const runtimeId = "extension_id_12345";
  const itemFromExtension = { byExtensionId: "extension_id_12345", url: "https://flow-content.google/v1/media/123" };
  const itemFromUser = { byExtensionId: undefined, url: "https://flow-content.google/v1/media/123" };

  const isSelfDownload = (item) => item.byExtensionId === runtimeId;

  assert.equal(isSelfDownload(itemFromExtension), true);
  assert.equal(isSelfDownload(itemFromUser), false);
});

test("Filename Sanitization", () => {
  assert.equal(sanitizeFilename("file:name/with*invalid?chars.png"), "file_name_with_invalid_chars.png");
  assert.equal(sanitizeFilename("normal_file.mp4"), "normal_file.mp4");
});

test("Media Type Detection - Suffix and MIME Metadata", () => {
  assert.equal(detectMediaType("https://storage.googleapis.com/test.mp4", "test.mp4"), "video");
  assert.equal(detectMediaType("https://storage.googleapis.com/test.png", "test.png"), "image");
  
  // Extensionless media URL with MIME metadata
  assert.equal(detectMediaType("https://flow-content.google/v1/media/stream_991823", "download", "video/mp4"), "video");
  assert.equal(detectMediaType("https://flow-content.google/v1/media/stream_991823", "download", "image/png"), "image");
});
