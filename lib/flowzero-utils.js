/*
 * FlowZero Shared Utilities
 * Used by background, content scripts, offscreen, and unit tests.
 */

export function isAllowedFlowMediaUrl(value) {
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

export function sanitizeFilename(filename, defaultExt = ".png") {
  let safe = filename || `flowzero_${Date.now()}${defaultExt}`;
  return safe.replace(/[\\/:*?"<>|]/g, "_");
}

export function detectMediaType(url, filename, mime) {
  if (typeof mime === "string" && mime.toLowerCase().startsWith("video/")) {
    return "video";
  }
  const isVideo = /\.(mp4|webm)(\?.*)?$/i.test(url || "") || (typeof filename === "string" && filename.toLowerCase().endsWith(".mp4"));
  return isVideo ? "video" : "image";
}

export function selectMediaSource(mediaUrl, videoUrl, imageUrl) {
  const rawFallbackDataUrl = videoUrl || imageUrl;
  const remoteUrl = mediaUrl;

  const trustedRemoteUrl = remoteUrl && isAllowedFlowMediaUrl(remoteUrl) ? remoteUrl : null;
  const validDataUrl = rawFallbackDataUrl && typeof rawFallbackDataUrl === "string" && rawFallbackDataUrl.startsWith("data:") ? rawFallbackDataUrl : null;

  return {
    remoteUrl: trustedRemoteUrl,
    fallbackDataUrl: validDataUrl,
    isValid: Boolean(trustedRemoteUrl || validDataUrl)
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    isAllowedFlowMediaUrl,
    sanitizeFilename,
    detectMediaType,
    selectMediaSource
  };
}
