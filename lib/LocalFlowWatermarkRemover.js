/*
 * Fallback synthesizer for fixed 4-point sparkle Flow watermark in 9:16 portrait images.
 */
(() => {
  class LocalFlowWatermarkRemover {
    static supports(imageData) {
      const ratio = imageData?.height / imageData?.width;
      return Number.isFinite(ratio) && ratio > 1.7 && ratio < 1.9;
    }

    static process(imageData) {
      if (!this.supports(imageData)) return { applied: false, reason: "unsupported_aspect_ratio" };
      const { data, width, height } = imageData;
      const shortSide = Math.min(width, height);
      const cx = Math.round(width * 0.893);
      const cy = Math.round(height * 0.936);
      
      const outer = Math.max(32, Math.round(shortSide * 0.052));
      const safetyRim = Math.max(6, Math.round(shortSide * 0.012));
      const mask = new Uint8Array(width * height);
      let touched = 0;

      const extent = outer + safetyRim;
      for (let y = Math.max(0, cy - extent); y <= Math.min(height - 1, cy + extent); y++) {
        for (let x = Math.max(0, cx - extent); x <= Math.min(width - 1, cx + extent); x++) {
          const dx = x - cx;
          const dy = y - cy;
          const angle = Math.atan2(dy, dx);
          const radius = Math.hypot(dx, dy);
          const boundary = outer * (0.43 + 0.57 * Math.pow(Math.abs(Math.cos(2 * angle)), 1.7)) + safetyRim;
          if (radius <= boundary) {
            mask[y * width + x] = 1;
            touched++;
          }
        }
      }
      if (!touched) return { applied: false, reason: "empty_mask" };

      const scratch = new Uint8ClampedArray(data);
      for (let pass = 0; pass < outer; pass++) {
        let changed = 0;
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const index = y * width + x;
            if (!mask[index]) continue;
            const neighbours = [index - width, index + width, index - 1, index + 1];
            let count = 0, r = 0, g = 0, b = 0;
            for (const neighbour of neighbours) {
              if (mask[neighbour]) continue;
              const p = neighbour * 4;
              r += data[p]; g += data[p + 1]; b += data[p + 2]; count++;
            }
            if (!count) continue;
            const p = index * 4;
            scratch[p] = Math.round(r / count);
            scratch[p + 1] = Math.round(g / count);
            scratch[p + 2] = Math.round(b / count);
            scratch[p + 3] = data[p + 3];
            mask[index] = 2;
            changed++;
          }
        }
        if (!changed) break;
        for (let i = 0; i < mask.length; i++) if (mask[i] === 2) mask[i] = 0;
        data.set(scratch);
      }
      return {
        applied: true,
        clean: true,
        variantId: "local-flow-sparkle-9x16",
        touched,
        pos: { x: cx - extent, y: cy - extent, w: extent * 2, h: extent * 2 }
      };
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = LocalFlowWatermarkRemover;
  } else {
    (globalThis || self).LocalFlowWatermarkRemover = LocalFlowWatermarkRemover;
  }
})();
