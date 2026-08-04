/*
 * FlowZero Background Service Worker (Manifest V3)
 */

const OFFSCREEN_DOCUMENT_PATH = "scripts/offscreen.html";

// Ensure Offscreen Document is active for canvas operations
async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) {
    return;
  }
  const reason = (chrome.offscreen && chrome.offscreen.Reason && chrome.offscreen.Reason.BLOBS) || "BLOBS";
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [reason],
    justification: "FlowZero watermark removal processing via Offscreen Canvas"
  });
}

// Convert fetched image response/blob into DataURL safely inside Service Worker
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
  return `data:${blob.type || "image/png"};base64,${base64}`;
}

// Main message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "removeWatermarkAndDownload" || message.action === "cleanWatermark") {
    (async () => {
      try {
        const { imageUrl, filename = "flowzero_clean.png", mime = "image/png" } = message;
        if (!imageUrl) {
          sendResponse({ success: false, error: "Missing imageUrl" });
          return;
        }

        let inputDataUrl = imageUrl;

        // If URL is an external link and not base64 DataURL, fetch it in background
        if (!imageUrl.startsWith("data:")) {
          try {
            const resp = await fetch(imageUrl, { cache: "no-store" });
            if (resp.ok) {
              const blob = await resp.blob();
              inputDataUrl = await blobToDataUrl(blob);
            }
          } catch (e) {
            console.warn("[FlowZero Background] Fetch fallback error:", e.message);
          }
        }

        // Ensure Offscreen document is ready
        await ensureOffscreenDocument();

        // Send processing task to Offscreen document
        const offscreenResult = await chrome.runtime.sendMessage({
          target: "offscreen",
          action: "processWatermark",
          dataUrl: inputDataUrl,
          mime
        });

        if (!offscreenResult || !offscreenResult.success) {
          throw new Error(offscreenResult?.error || "Offscreen processing failed");
        }

        const finalDataUrl = offscreenResult.cleanDataUrl || inputDataUrl;

        if (message.action === "cleanWatermark") {
          sendResponse({
            success: true,
            cleaned: offscreenResult.cleaned,
            dataUrl: finalDataUrl
          });
          return;
        }

        // Trigger Chrome Download for removeWatermarkAndDownload
        const sanitizedFilename = filename.replace(/[\\/:*?"<>|]/g, "_");
        const downloadId = await chrome.downloads.download({
          url: finalDataUrl,
          filename: sanitizedFilename,
          saveAs: false
        });

        sendResponse({
          success: true,
          cleaned: offscreenResult.cleaned,
          downloadId,
          filename: sanitizedFilename
        });

      } catch (err) {
        console.error("[FlowZero Background Error]:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true; // Keep channel open for async response
  }
});

// Extension installation setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ flowzero_enabled: true });
  console.log("[FlowZero] Extension installed and ready.");
});
