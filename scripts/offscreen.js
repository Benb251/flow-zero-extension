/*
 * FlowZero Offscreen Script — Manifest V3 Canvas Image Processor
 *
 * Pipeline:
 *   - Mathematical NCC Alpha Unblending for Google Flow (1:1, 9:16, 16:9, 3:4, 4:3)
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen" || message.action !== "processWatermark") {
    return false;
  }

  (async () => {
    try {
      const { dataUrl, mime = "image/png" } = message;
      if (!dataUrl) {
        sendResponse({ success: false, error: "No dataUrl provided" });
        return;
      }

      // ── Load image onto canvas ─────────────────────────────────────────
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

      // ── Primary: NCC-based engine (all ratios) ─────────────────────────
      const remover = window.LocalGeminiWatermarkRemover || self.LocalGeminiWatermarkRemover;
      if (!remover) {
        throw new Error("LocalGeminiWatermarkRemover is not defined in Offscreen context");
      }

      const result = await remover.process(imageData);
      console.log("[FlowZero Offscreen] Watermark process result:", result);

      // ── Respond ────────────────────────────────────────────────────────
      if (result?.applied) {
        ctx.putImageData(imageData, 0, 0);
        sendResponse({
          success:      true,
          cleaned:      true,
          cleanDataUrl: canvas.toDataURL(mime),
          variantId:    result.variantId || "flow-alpha-48px",
          ncc:          result.ncc,
        });
      } else {
        // Watermark not found — return original image unchanged
        sendResponse({
          success:      true,
          cleaned:      false,
          reason:       result?.reason || "watermark_not_found",
          cleanDataUrl: dataUrl,
        });
      }
    } catch (err) {
      console.error("[FlowZero Offscreen Error]:", err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Keep channel open for async response
});
