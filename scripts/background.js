/*
 * FlowZero Background Service Worker (Manifest V3)
 * Handles Image & Video Watermark Removal Orchestration
 */

const OFFSCREEN_DOCUMENT_PATH = "scripts/offscreen.html";
let creatingOffscreenDocument = null;

// Validate media URLs against explicit trusted Google Flow domains
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

// Selects the appropriate media source representation (remote URL or preloaded DataURL fallback)
function selectMediaSource(mediaUrl, videoUrl, imageUrl) {
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

        let inputDataUrl = selection.selectedSource;
        const targetRemoteUrl = selection.selectedRemoteUrl;

        // If a trusted remote HTTP(S) URL is available, fetch it in background
        if (targetRemoteUrl) {
          try {
            const resp = await fetch(targetRemoteUrl, { cache: "no-store" });
            if (resp.ok) {
              const blob = await resp.blob();
              let isMp4 = false;
              if (blob.type.startsWith("video/") || blob.type === "application/mp4") {
                isMp4 = true;
              } else if (blob.size > 12) {
                const slice = blob.slice(0, 12);
                const buf = await slice.arrayBuffer();
                const bytes = new Uint8Array(buf);
                if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
                  isMp4 = true;
                }
              }
              if (isMp4) {
                isVideoAction = true;
              }
              inputDataUrl = await blobToDataUrl(blob);
            }
          } catch (e) {
            console.warn("[FlowZero Background] Fetch fallback warning:", e.message);
          }
        } else if (inputDataUrl) {
          const match = inputDataUrl.match(/^data:([^;]+);/);
          if (match && (match[1].startsWith("video/") || match[1] === "application/mp4")) {
            isVideoAction = true;
          } else {
            const b64Data = inputDataUrl.split(",")[1];
            if (b64Data) {
              const b64Prefix = b64Data.substring(0, 30);
              const binaryStr = atob(b64Prefix);
              if (binaryStr.length >= 12) {
                if (binaryStr.charCodeAt(4) === 0x66 && binaryStr.charCodeAt(5) === 0x74 && 
                    binaryStr.charCodeAt(6) === 0x79 && binaryStr.charCodeAt(7) === 0x70) {
                  isVideoAction = true;
                }
              }
            }
          }
        }

        // Ensure Offscreen document is ready
        await ensureOffscreenDocument();

        let offscreenResult = null;

        if (isVideoAction) {
          offscreenResult = await chrome.runtime.sendMessage({
            target: "offscreen",
            action: "processVideoWatermark",
            dataUrl: inputDataUrl,
            sourceUrl: targetRemoteUrl,
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

        const finalDataUrl = offscreenResult.cleanDataUrl || inputDataUrl;

        if (message.action === "cleanWatermark") {
          sendResponse({
            success: true,
            cleaned: offscreenResult.cleaned,
            dataUrl: finalDataUrl,
            stats: offscreenResult.stats
          });
          return;
        }

        // Trigger Chrome Download
        const defaultExt = isVideoAction ? ".mp4" : ".png";
        let safeFilename = filename || `flowzero_${Date.now()}${defaultExt}`;
        const sanitizedFilename = safeFilename.replace(/[\\/:*?"<>|]/g, "_");

        const downloadId = await chrome.downloads.download({
          url: finalDataUrl,
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
  const state = await chrome.storage.local.get(["flowzero_enabled"]);
  if (state.flowzero_enabled === false) return; // Truly passive when disabled

  if (item.url.startsWith("data:") || item.url.startsWith("blob:") || item.url.startsWith("chrome-extension:")) return;

  if (isAllowedFlowMediaUrl(item.url)) {
    console.log("[FlowZero Background] Intercepted native download:", item.url);
    
    // Cancel the native watermarked download immediately
    chrome.downloads.cancel(item.id);

    // Process the video/image internally
    (async () => {
      try {
        await ensureOffscreenDocument();
        const res = await fetch(item.url);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);
        
        let isVideo = (item.filename && item.filename.toLowerCase().endsWith(".mp4")) || blob.type.startsWith("video/");

        console.log("[FlowZero Background] Forwarding intercepted download to Offscreen:", item.filename, "Video:", isVideo);

        const offscreenResult = await chrome.runtime.sendMessage({
          target: "offscreen",
          action: isVideo ? "processVideoWatermark" : "processWatermark",
          dataUrl: dataUrl,
          sourceUrl: item.url,
          mime: blob.type,
          taskId: "background_intercept_" + Date.now()
        });

        if (offscreenResult && offscreenResult.success && offscreenResult.cleanDataUrl) {
          const defaultExt = isVideo ? ".mp4" : ".png";
          let safeFilename = item.filename || `flowzero_intercepted${defaultExt}`;
          
          chrome.downloads.download({
            url: offscreenResult.cleanDataUrl,
            filename: safeFilename.replace(/\.[^/.]+$/, "") + "_flowzero" + defaultExt,
            saveAs: false
          });
        }
      } catch (err) {
        console.error("[FlowZero Background] Native download intercept failed:", err);
      }
    })();
  }
});

// Extension installation setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ flowzero_enabled: true });
  const ver = chrome.runtime.getManifest().version;
  console.log(`[FlowZero] Extension v${ver} installed and ready.`);
});

