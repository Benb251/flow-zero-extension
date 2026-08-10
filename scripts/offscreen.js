/*
 * FlowZero Offscreen Script — Manifest V3 Media Processor (Image & Video)
 *
 * Capabilities:
 *   - Image: Strict Deterministic Anchors + NCC Alpha Unblending (LocalGeminiWatermarkRemover V7)
 *   - Video: Hardware-accelerated WebCodecs Demux/Decode/Unblend/Encode/Mux (VideoWatermarkRemover)
 */

// Helper to convert Blob to DataURL
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Helper to convert DataURL to Blob
function dataURLToBlob(dataUrl) {
  const parts = dataUrl.split(";base64,");
  const contentType = parts[0].split(":")[1] || "application/octet-stream";
  const raw = atob(parts[1]);
  const rawLength = raw.length;
  const uInt8Array = new Uint8Array(rawLength);
  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }
  return new Blob([uInt8Array], { type: contentType });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") {
    return false;
  }

  // ── 1. Image Watermark Processing ──────────────────────────────────────────
  if (message.action === "processWatermark") {
    (async () => {
      try {
        const { dataUrl, mime = "image/png" } = message;
        if (!dataUrl) {
          sendResponse({ success: false, error: "No dataUrl provided" });
          return;
        }

        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload  = resolve;
          img.onerror = () => reject(new Error("Failed to load image into Offscreen DOM"));
          img.src     = dataUrl;
        });

        const canvas = document.createElement("canvas");
        canvas.width  = img.naturalWidth  || img.width;
        canvas.height = img.naturalHeight || img.height;

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const remover = window.LocalGeminiWatermarkRemover || self.LocalGeminiWatermarkRemover;
        if (!remover) {
          throw new Error("LocalGeminiWatermarkRemover is not defined in Offscreen context");
        }

        const result = await remover.process(imageData);
        console.log("[FlowZero Offscreen] Image Watermark process result:", result);

        if (result?.applied) {
          ctx.putImageData(imageData, 0, 0);
          sendResponse({
            success:      true,
            cleaned:      true,
            cleanDataUrl: canvas.toDataURL(mime),
            variantId:    result.variantId || "v7-strict-anchors-adaptive-denoise",
            ncc:          result.ncc,
          });
        } else {
          sendResponse({
            success:      true,
            cleaned:      false,
            reason:       result?.reason || "watermark_not_found",
            cleanDataUrl: dataUrl,
          });
        }
      } catch (err) {
        console.error("[FlowZero Offscreen Image Error]:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── 2. Video Watermark Processing (WebCodecs) ──────────────────────────────
  if (message.action === "processVideoWatermark") {
    (async () => {
      try {
        const { dataUrl, sourceUrl, taskId, originTabId } = message;
        if (!dataUrl && !sourceUrl) {
          sendResponse({ success: false, error: "No video input provided" });
          return;
        }

        const remover = window.VideoWatermarkRemover || self.VideoWatermarkRemover;
        if (!remover) {
          throw new Error("VideoWatermarkRemover is not defined in Offscreen context");
        }

        console.log("[FlowZero Offscreen] Starting video watermark removal...");

        let inputBlob = null;
        if (sourceUrl && typeof isAllowedFlowMediaUrl === "function" && isAllowedFlowMediaUrl(sourceUrl)) {
          try {
            const resp = await fetch(sourceUrl, { cache: "no-store" });
            if (resp.ok) inputBlob = await resp.blob();
          } catch (e) {
            console.warn("[FlowZero Offscreen] Direct fetch fallback to dataUrl:", e.message);
          }
        }

        if (!inputBlob && dataUrl) {
          inputBlob = dataURLToBlob(dataUrl);
        }

        if (!inputBlob) {
          throw new Error("Could not acquire valid video input Blob");
        }

        const result = await remover.process(inputBlob, {
          onProgress: (progress) => {
            // Forward progress updates with originTabId to background service worker
            chrome.runtime.sendMessage({
              target: "content",
              action: "videoProgress",
              taskId,
              originTabId,
              progress,
            }).catch(() => {});
          },
        });

        if (result?.applied && result.blob) {
          const cleanDataUrl = await blobToDataURL(result.blob);
          sendResponse({
            success: true,
            cleaned: true,
            cleanDataUrl,
            stats: result.stats,
          });
        } else {
          sendResponse({
            success: true,
            cleaned: false,
            cleanDataUrl: dataUrl,
            reason: result?.reason || "watermark_not_applied",
          });
        }
      } catch (err) {
        console.error("[FlowZero Offscreen Video Error]:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});
