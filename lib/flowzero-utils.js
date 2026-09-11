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
      host === "flow.google.com" ||
      host === "flow-content.google" ||
      host === "storage.googleapis.com" ||
      host.endsWith(".googleusercontent.com")
    );
  } catch {
    return false;
  }
}

export function isAllowedFlowDownloadReferrer(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "labs.google" || host === "flow.google.com";
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

export function isVerifiedCleanOutput(offscreenResult) {
  if (!offscreenResult || offscreenResult.success !== true || offscreenResult.cleaned !== true) {
    return false;
  }

  const value = offscreenResult.cleanDataUrl;
  if (typeof value !== "string") return false;

  // A cleaned result must be a locally produced media DataURL. Never accept a
  // passthrough/source URL as proof that watermark removal actually completed.
  const mediaMatch = value.match(/^data:(image|video)\/[a-z0-9.+-]+;base64,/i);
  if (!mediaMatch) return false;

  if (mediaMatch[1].toLowerCase() === "image") {
    return Number.isFinite(offscreenResult.stats?.touched) && offscreenResult.stats.touched > 0;
  }

  return Number.isFinite(offscreenResult.stats?.frames) && offscreenResult.stats.frames > 0;
}

// V8 plan Phase 4: decision table for intercepted native downloads.
// Native Flow downloads are fail-closed: only a verified cleaned payload may
// replace the original. Any other result must discard the original so an
// interrupted/failed watermark pass cannot leak a dirty file to Downloads.
export function planNativeDownloadAction(offscreenResult, { pausedOriginal = false } = {}) {
  const shouldReplace = isVerifiedCleanOutput(offscreenResult);
  if (shouldReplace) {
    return { downloadReplacement: true, discardOriginal: true, resumeOriginal: false };
  }
  return { downloadReplacement: false, discardOriginal: true, resumeOriginal: false };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    isAllowedFlowMediaUrl,
    isAllowedFlowDownloadReferrer,
    sanitizeFilename,
    detectMediaType,
    selectMediaSource,
    isVerifiedCleanOutput,
    planNativeDownloadAction
  };
}
