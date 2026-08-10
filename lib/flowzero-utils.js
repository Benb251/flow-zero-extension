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

export function detectMediaType(url, filename) {
  const isVideo = /\.(mp4|webm)(\?.*)?$/i.test(url || "") || (typeof filename === "string" && filename.toLowerCase().endsWith(".mp4"));
  return isVideo ? "video" : "image";
}

/**
  Selects the appropriate media source representation.
  Prefers trusted remote HTTP(S) URLs for direct streaming.
  If remoteUrl is a blob: URL or disallowed domain, falls back to preloaded DataURL.
 */
export function selectMediaSource(mediaUrl, videoUrl, imageUrl) {
  const fallbackDataUrl = videoUrl || imageUrl;
  const remoteUrl = mediaUrl;

  let selectedSource = null;
  let selectedRemoteUrl = null;

  if (remoteUrl && isAllowedFlowMediaUrl(remoteUrl)) {
    selectedRemoteUrl = remoteUrl;
  } else if (fallbackDataUrl && typeof fallbackDataUrl === "string" && fallbackDataUrl.startsWith("data:")) {
    selectedSource = fallbackDataUrl;
  }

  return {
    selectedSource,
    selectedRemoteUrl,
    isValid: Boolean(selectedSource || selectedRemoteUrl)
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
