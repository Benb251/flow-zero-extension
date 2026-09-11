/*
 * FlowZero Background Service Worker (Manifest V3 Module)
 * Handles Image & Video Watermark Removal Orchestration
 */

import {
  isAllowedFlowMediaUrl,
  isAllowedFlowDownloadReferrer,
  sanitizeFilename,
  detectMediaType,
  selectMediaSource,
  isVerifiedCleanOutput,
  planNativeDownloadAction
} from "../lib/flowzero-utils.js";

const OFFSCREEN_DOCUMENT_PATH = "scripts/offscreen.html";
const IMAGE_PROCESS_TIMEOUT_MS = 60_000;
const VIDEO_PROCESS_TIMEOUT_MS = 10 * 60_000;
const MEDIA_FETCH_TIMEOUT_MS = 45_000;
let creatingOffscreenDocument = null;

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = MEDIA_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("Media fetch timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function discardNativeDownload(downloadId) {
  try { await chrome.downloads.cancel(downloadId); } catch (_) {}

  // If pause/cancel raced with a very small file that already completed,
  // remove the file from disk as the final fail-closed guard.
  try {
    await chrome.downloads.removeFile(downloadId);
    return;
  } catch (_) {}

  // Give Chrome one short turn to settle a just-cancelled download, then retry.
  await new Promise((resolve) => setTimeout(resolve, 120));
  try { await chrome.downloads.removeFile(downloadId); } catch (_) {}
}

// Ensure Offscreen Document is active for media operations (Chrome 116+ getContexts)
async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });

  if (contexts.length > 0) {
    return;
  }

  if (!creatingOffscreenDocument) {
    const reason = (chrome.offscreen && chrome.offscreen.Reason && chrome.offscreen.Reason.BLOBS) || "BLOBS";
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [reason],
      justification: "FlowZero image and video watermark removal processing"
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }

  await creatingOffscreenDocument;
}

// Convert fetched response/blob into DataURL inside Service Worker
async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk);
  }
  const base64 = btoa(binary);
  return `data:${blob.type || "application/octet-stream"};base64,${base64}`;
}

// Main message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Relay progress messages directly to originating tab using originTabId
  if (message.target === "content" && message.action === "videoProgress") {
    const originTabId = message.originTabId;
    if (originTabId) {
      chrome.tabs.sendMessage(originTabId, message).catch(() => {});
    }
    return false;
  }

  let isVideoAction = message.action === "removeVideoWatermarkAndDownload" || 
                        (message.mediaType === "video") ||
                        (typeof message.filename === "string" && message.filename.toLowerCase().endsWith(".mp4"));

  if (message.action === "removeWatermarkAndDownload" || 
      message.action === "cleanWatermark" || 
      message.action === "removeVideoWatermarkAndDownload") {
    (async () => {
      // 1. Enforce disabled state check at final background boundary
      const state = await chrome.storage.local.get(["flowzero_enabled"]);
      if (state.flowzero_enabled === false) {
        sendResponse({ success: false, error: "FlowZero is disabled" });
        return;
      }

      try {
        const { imageUrl, videoUrl, mediaUrl, filename = "flowzero_clean.png", mime = "image/png", taskId } = message;
        const originTabId = sender.tab?.id;

        const selection = selectMediaSource(mediaUrl, videoUrl, imageUrl);
        if (!selection.isValid) {
          sendResponse({ success: false, error: "Invalid or disallowed media URL" });
          return;
        }

        let inputDataUrl = selection.fallbackDataUrl;
        const targetRemoteUrl = selection.remoteUrl;

        // For images (or fallback mode), if trusted remote URL is present, fetch and build DataURL for Image pipeline
        if (!isVideoAction && targetRemoteUrl) {
          try {
            const resp = await fetchWithTimeout(targetRemoteUrl, { cache: "no-store" });
            if (resp.ok) {
              const blob = await resp.blob();
              inputDataUrl = await blobToDataUrl(blob);
            }
          } catch (e) {
            console.warn("[FlowZero Background] Image fetch warning:", e.message);
          }
        }

        // Ensure Offscreen document is ready
        await ensureOffscreenDocument();

        let offscreenResult = null;

        if (isVideoAction) {
          // Pass remote HTTP(S) URL directly to offscreen (bypassing background Base64 conversion for trusted video)
          offscreenResult = await withTimeout(chrome.runtime.sendMessage({
            target: "offscreen",
            action: "processVideoWatermark",
            sourceUrl: targetRemoteUrl,
            fallbackDataUrl: selection.fallbackDataUrl,
            dataUrl: inputDataUrl,
            taskId,
            originTabId
          }), VIDEO_PROCESS_TIMEOUT_MS, "Video watermark processing");
        } else {
          offscreenResult = await withTimeout(chrome.runtime.sendMessage({
            target: "offscreen",
            action: "processWatermark",
            dataUrl: inputDataUrl,
            mime,
            originTabId
          }), IMAGE_PROCESS_TIMEOUT_MS, "Image watermark processing");
        }

        if (!offscreenResult || !offscreenResult.success) {
          throw new Error(offscreenResult?.error || "Offscreen processing failed");
        }

        if (message.action === "cleanWatermark") {
          sendResponse({
            success: true,
            cleaned: offscreenResult.cleaned,
            dataUrl: isVerifiedCleanOutput(offscreenResult) ? offscreenResult.cleanDataUrl : null,
            reason: offscreenResult.reason,
            stats: offscreenResult.stats
          });
          return;
        }

        if (!isVerifiedCleanOutput(offscreenResult)) {
          sendResponse({
            success: false,
            cleaned: false,
            error: "Watermark removal was not verified; download blocked",
            reason: offscreenResult.reason || "clean_output_missing"
          });
          return;
        }

        const finalMediaUrl = offscreenResult.cleanDataUrl;

        // Trigger Chrome Download
        const defaultExt = isVideoAction ? ".mp4" : ".png";
        const sanitizedFilename = sanitizeFilename(filename, defaultExt);

        const outputFilename = sanitizedFilename;

        const downloadId = await chrome.downloads.download({
          url: finalMediaUrl,
          filename: outputFilename,
          saveAs: false
        });

        sendResponse({
          success: true,
          cleaned: offscreenResult.cleaned,
          downloadId,
          filename: outputFilename,
          stats: offscreenResult.stats
        });

      } catch (err) {
        console.error("[FlowZero Background Error]:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }
});

// Intercept native downloads at the browser level when extension is ENABLED
chrome.downloads.onCreated.addListener(async (item) => {
  if (item.byExtensionId === chrome.runtime.id) {
    return;
  }

  const state = await chrome.storage.local.get(["flowzero_enabled"]);
  if (state.flowzero_enabled === false) return;

  if (item.url.startsWith("chrome-extension:")) return;

  // Keep the v1.3.1 Flow-origin scope guard (exact host check, not just prefix).
  if (!isAllowedFlowDownloadReferrer(item.referrer)) return;

  const targetUrl = item.finalUrl || item.url;

  // A page-owned blob URL cannot be fetched from the MV3 service worker. If
  // one escapes the MAIN-world interceptor, fail closed rather than allowing
  // an unverified file to complete.
  if (targetUrl.startsWith("blob:")) {
    console.warn("[FlowZero Background] Blocking unprocessable Flow blob download.");
    await discardNativeDownload(item.id);
    return;
  }

  if (!isAllowedFlowMediaUrl(targetUrl)) return;

  console.log("[FlowZero Background] Intercepted native download:", targetUrl);

  // Fail-closed download lifecycle: pause the original while processing. Only
  // a verified clean output may replace it. Any failure/no-detection path
  // discards the original so a dirty file cannot leak into Downloads.
  (async () => {
    let pausedOriginal = false;
    try {
      try {
        await chrome.downloads.pause(item.id);
        pausedOriginal = true;
      } catch (_) {
        // If pausing races or is unsupported, remove/cancel the original before
        // entering a potentially long processing step. This closes the window
        // where a small dirty file could finish and survive a worker restart.
        await discardNativeDownload(item.id);
      }

      await ensureOffscreenDocument();
      const isVideo = detectMediaType(targetUrl, item.filename, item.mime) === "video";

      console.log("[FlowZero Background] Forwarding intercepted native download to Offscreen:", item.filename, "Video:", isVideo);

      let offscreenResult = null;

      if (isVideo) {
        // Direct HTTP(S) video branch: pass sourceUrl directly to Offscreen without pre-fetching or Base64 encoding!
        offscreenResult = await withTimeout(chrome.runtime.sendMessage({
          target: "offscreen",
          action: "processVideoWatermark",
          sourceUrl: targetUrl,
          taskId: "background_intercept_" + Date.now()
        }), VIDEO_PROCESS_TIMEOUT_MS, "Intercepted video watermark processing");
      } else {
        // Image branch: fetch and convert to DataURL for canvas processing
        const res = await fetchWithTimeout(targetUrl, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);

        offscreenResult = await withTimeout(chrome.runtime.sendMessage({
          target: "offscreen",
          action: "processWatermark",
          dataUrl: dataUrl,
          sourceUrl: targetUrl,
          mime: blob.type,
          taskId: "background_intercept_" + Date.now()
        }), IMAGE_PROCESS_TIMEOUT_MS, "Intercepted image watermark processing");
      }

      // Only cleaned=true + a locally produced media DataURL is accepted.
      const action = planNativeDownloadAction(offscreenResult, { pausedOriginal });
      if (action.downloadReplacement) {
        const finalMediaUrl = offscreenResult.cleanDataUrl;
        if (finalMediaUrl && typeof finalMediaUrl === "string") {
          const defaultExt = isVideo ? ".mp4" : ".png";
          const safeFilename = sanitizeFilename(item.filename, defaultExt);

          // Replacement-first ordering: only cancel the original AFTER the
          // replacement download has been accepted, so a failure while starting
          // the replacement still leaves the paused original resumable.
          await chrome.downloads.download({
            url: finalMediaUrl,
            // Preserve Google Flow's native filename exactly (after sanitizing),
            // e.g. a_dog_2K_20260911095715.png. The watermark-removal step must
            // not rewrite a correct Flow filename or append a FlowZero suffix.
            filename: safeFilename,
            saveAs: false
          });
          await discardNativeDownload(item.id);
        }
      } else if (action.discardOriginal) {
        console.warn("[FlowZero Background] Clean output not verified; blocking original download:", item.filename);
        await discardNativeDownload(item.id);
      }
    } catch (err) {
      console.error("[FlowZero Background] Native download intercept failed:", err);
      await discardNativeDownload(item.id);
    }
  })();
});

// Extension installation setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ flowzero_enabled: true });
  const ver = chrome.runtime.getManifest().version;
  console.log(`[FlowZero] Extension v${ver} installed and ready.`);
});

