/*
 * FlowZero Background Service Worker (Manifest V3 Module)
 * Handles Image & Video Watermark Removal Orchestration
 */

import {
  isAllowedFlowMediaUrl,
  isAllowedFlowDownloadReferrer,
  sanitizeFilename,
  detectMediaType,
  selectMediaSource
} from "../lib/flowzero-utils.js";

const OFFSCREEN_DOCUMENT_PATH = "scripts/offscreen.html";
let creatingOffscreenDocument = null;

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
            const resp = await fetch(targetRemoteUrl, { cache: "no-store" });
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
          offscreenResult = await chrome.runtime.sendMessage({
            target: "offscreen",
            action: "processVideoWatermark",
            sourceUrl: targetRemoteUrl,
            fallbackDataUrl: selection.fallbackDataUrl,
            dataUrl: inputDataUrl,
            taskId,
            originTabId
          });
        } else {
          offscreenResult = await chrome.runtime.sendMessage({
            target: "offscreen",
            action: "processWatermark",
            dataUrl: inputDataUrl,
            mime,
            originTabId
          });
        }

        if (!offscreenResult || !offscreenResult.success) {
          throw new Error(offscreenResult?.error || "Offscreen processing failed");
        }

        const finalMediaUrl = offscreenResult.cleanDataUrl || offscreenResult.passthroughUrl || inputDataUrl;
        if (!finalMediaUrl || typeof finalMediaUrl !== "string") {
          throw new Error("No valid media URL available for download");
        }

        if (message.action === "cleanWatermark") {
          sendResponse({
            success: true,
            cleaned: offscreenResult.cleaned,
            dataUrl: finalMediaUrl,
            stats: offscreenResult.stats
          });
          return;
        }

        // Trigger Chrome Download
        const defaultExt = isVideoAction ? ".mp4" : ".png";
        const sanitizedFilename = sanitizeFilename(filename, defaultExt);

        const downloadId = await chrome.downloads.download({
          url: finalMediaUrl,
          filename: sanitizedFilename,
          saveAs: false
        });

        sendResponse({
          success: true,
          cleaned: offscreenResult.cleaned,
          downloadId,
          filename: sanitizedFilename,
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

  if (item.url.startsWith("data:") || item.url.startsWith("blob:") || item.url.startsWith("chrome-extension:")) return;

  if (!isAllowedFlowDownloadReferrer(item.referrer)) return;

  const targetUrl = item.finalUrl || item.url;
  if (!isAllowedFlowMediaUrl(targetUrl)) return;

  console.log("[FlowZero Background] Intercepted native download:", targetUrl);
  
  // Cancel the native watermarked download immediately
  chrome.downloads.cancel(item.id);

  // Process the video/image internally
  (async () => {
    try {
      await ensureOffscreenDocument();
      const isVideo = detectMediaType(targetUrl, item.filename, item.mime) === "video";

      console.log("[FlowZero Background] Forwarding intercepted native download to Offscreen:", item.filename, "Video:", isVideo);

      let offscreenResult = null;

      if (isVideo) {
        // Direct HTTP(S) video branch: pass sourceUrl directly to Offscreen without pre-fetching or Base64 encoding!
        offscreenResult = await chrome.runtime.sendMessage({
          target: "offscreen",
          action: "processVideoWatermark",
          sourceUrl: targetUrl,
          taskId: "background_intercept_" + Date.now()
        });
      } else {
        // Image branch: fetch and convert to DataURL for canvas processing
        const res = await fetch(targetUrl);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);

        offscreenResult = await chrome.runtime.sendMessage({
          target: "offscreen",
          action: "processWatermark",
          dataUrl: dataUrl,
          sourceUrl: targetUrl,
          mime: blob.type,
          taskId: "background_intercept_" + Date.now()
        });
      }

      if (offscreenResult && offscreenResult.success) {
        const finalMediaUrl = offscreenResult.cleanDataUrl || offscreenResult.passthroughUrl || targetUrl;
        if (finalMediaUrl && typeof finalMediaUrl === "string") {
          const defaultExt = isVideo ? ".mp4" : ".png";
          const safeFilename = sanitizeFilename(item.filename, defaultExt);
          
          chrome.downloads.download({
            url: finalMediaUrl,
            filename: safeFilename.replace(/\.[^/.]+$/, "") + "_flowzero" + defaultExt,
            saveAs: false
          });
        }
      }
    } catch (err) {
      console.error("[FlowZero Background] Native download intercept failed:", err);
    }
  })();
});

// Extension installation setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ flowzero_enabled: true });
  const ver = chrome.runtime.getManifest().version;
  console.log(`[FlowZero] Extension v${ver} installed and ready.`);
});

