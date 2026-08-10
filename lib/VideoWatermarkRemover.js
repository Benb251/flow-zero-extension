/**
 * FlowZero — VideoWatermarkRemover
 *
 * Client-side video watermark removal using WebCodecs API & Mediabunny.
 * 
 * Pipeline:
 *  1. Demux MP4 container (extract video track & raw AAC audio packets)
 *  2. Decode video frames with hardware-accelerated VideoDecoder
 *  3. Apply exact Alpha Unblend & adaptive dark denoise on each frame in OffscreenCanvas
 *  4. Re-encode video frames with VideoEncoder (matching source bitrate/fps)
 *  5. Mux video & original audio packets back into clean MP4 container
 *
 * Zero external servers. 100% private and offline on the user's browser.
 */

(function () {
  "use strict";

  const LOG = "[FlowZero VideoWM]";
  const MB = () => (globalThis || self).Mediabunny;
  const WR = () => (globalThis || self).LocalGeminiWatermarkRemover;

  class VideoWmError extends Error {
    constructor(code, message) {
      super(message || code);
      this.code = code;
    }
  }

  function _createCanvas(w, h) {
    if (typeof OffscreenCanvas !== "undefined") {
      return new OffscreenCanvas(w, h);
    }
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    }
    throw new VideoWmError("NO_CANVAS", "OffscreenCanvas is not supported in this environment");
  }

  /**
   * Main entry point to process a video Blob/File.
   * @param {Blob} blob - Source MP4 Blob
   * @param {Object} [options] - Optional settings
   * @param {Function} [options.onProgress] - Callback for progress { phase, frame, total, percent }
   * @param {Function} [options.isCancelled] - Cancellation check
   * @returns {Promise<{ blob: Blob, applied: boolean, stats: Object }>}
   */
  async function process(blob, options = {}) {
    const t0 = performance.now();
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
    const cancelled = typeof options.isCancelled === "function" ? options.isCancelled : () => false;

    if (!MB()) {
      throw new VideoWmError("NO_MEDIABUNNY", "mediabunny.js library is not loaded");
    }
    if (!WR()) {
      throw new VideoWmError("NO_REMOVER", "LocalGeminiWatermarkRemover is not loaded");
    }
    if (!blob || !(blob instanceof Blob)) {
      throw new VideoWmError("INVALID_BLOB", "Invalid input video blob");
    }

    const {
      Input,
      BlobSource,
      ALL_FORMATS,
      Output,
      Mp4OutputFormat,
      BufferTarget,
      VideoSampleSource,
      EncodedAudioPacketSource,
      EncodedPacketSink,
      VideoSampleSink,
      VideoSample,
    } = MB();

    const input = new Input({
      source: new BlobSource(blob),
      formats: ALL_FORMATS,
    });

    let output = null;

    try {
      const vTrack = await input.getPrimaryVideoTrack();
      if (!vTrack) {
        return { blob, applied: false, reason: "no_video_track" };
      }

      if (!(await vTrack.canDecode())) {
        throw new VideoWmError("CANNOT_DECODE", "Current browser cannot decode this video codec");
      }

      const W = vTrack.displayWidth ?? vTrack.codedWidth;
      const H = vTrack.displayHeight ?? vTrack.codedHeight;
      const duration = await input.computeDuration();

      console.log(`${LOG} Video source: ${W}x${H}, duration=${duration.toFixed(2)}s`);

      // 1. Calculate deterministic watermark anchor and scale
      const anchor = WR().getVideoAnchor(W, H);
      const mask = WR().getVideoMask(anchor.w, anchor.h);

      if (!mask) {
        throw new VideoWmError("MASK_ERROR", "Failed to generate video alpha mask");
      }

      console.log(
        `${LOG} Anchor: ${W}x${H} -> wm@(${anchor.x}, ${anchor.y}) size=${anchor.w}px margin=${anchor.margin}px`
      );

      // 2. Measure source bitrate to maintain visual quality
      const codec = await vTrack.getCodec();
      let srcBitrate = null;
      try {
        const stats = await vTrack.computePacketStats?.(100);
        srcBitrate = stats?.averageBitrate ?? null;
      } catch (e) {
        console.warn(`${LOG} Could not measure source bitrate:`, e?.message);
      }

      // Bitrate estimation: match source or target ~4-8 Mbps for crisp 1080p
      const bitrate = Math.max(
        1000000,
        Math.round(srcBitrate || (W * H * 4.0))
      );

      // 3. Prepare MP4 Output container
      output = new Output({
        format: new Mp4OutputFormat(),
        target: new BufferTarget(),
      });

      const vSource = new VideoSampleSource({
        codec: codec === "hevc" ? "hevc" : "avc",
        bitrate,
      });
      output.addVideoTrack(vSource);

      // 4. Pass-through original Audio track without re-encoding
      const aTrack = await input.getPrimaryAudioTrack();
      let aSource = null;
      let aPackets = null;

      if (aTrack) {
        const aCodec = await aTrack.getCodec();
        if (aCodec) {
          aSource = new EncodedAudioPacketSource(aCodec);
          output.addAudioTrack(aSource);
          aPackets = new EncodedPacketSink(aTrack);
        } else {
          console.warn(`${LOG} Audio codec unrecognized, audio will be skipped`);
        }
      }

      await output.start();

      // 5. Canvas for frame processing
      const cv = _createCanvas(W, H);
      const ctx = cv.getContext("2d", { willReadFrequently: true });

      const _firstShift = async (track) => {
        try {
          const f = await track?.getFirstTimestamp?.();
          return Number.isFinite(f) && f < 0 ? -f : 0;
        } catch (e) {
          return 0;
        }
      };

      let tsShift = await _firstShift(vTrack);
      const aShift = await _firstShift(aTrack);

      let lastPercent = 0;
      const reportProgress = (phase, frame, totalFrames, rawPct) => {
        const cap = phase === "processing" ? 95 : phase === "completed" ? 100 : 99;
        const pct = Math.max(lastPercent, Math.min(cap, Math.round(rawPct)));
        lastPercent = pct;
        onProgress({ phase, frame, total: totalFrames, percent: pct });
      };

      reportProgress("processing", 0, 0, 0);

      // 6. Decode -> Unblend -> Encode pipeline
      const runSink = new VideoSampleSink(vTrack);
      let frameCount = 0;

      for await (const s of runSink.samples()) {
        if (cancelled()) throw new VideoWmError("CANCELLED", "Processing cancelled by user");

        // Draw decoded frame into canvas
        s.draw(ctx, 0, 0, W, H);

        // Fetch pixel data
        const img = ctx.getImageData(0, 0, W, H);

        // Step 1: Alpha Unblend with standard image gain (1.0)
        WR().applyUnblend(img, mask, anchor, 1.0);

        // Step 2: Adaptive dark denoise
        WR().applyAdaptiveDenoise(img, mask, anchor);

        // Step 3: Edge-aware de-ringing
        WR().applyVideoEdgeDerange(img, mask, anchor);

        // Write cleaned pixels back to canvas
        ctx.putImageData(img, 0, 0);

        // Package frame into VideoSample and feed to VideoEncoder
        if (s.timestamp + tsShift < 0) tsShift = -s.timestamp;
        const currentTs = s.timestamp + tsShift;
        const outSample = new VideoSample(cv, {
          timestamp: currentTs,
          duration: s.duration,
        });

        await vSource.add(outSample);
        outSample.close();
        s.close();

        frameCount++;
        if (frameCount % 3 === 0) {
          const currentSec = currentTs / 1000000;
          const rawPct = duration > 0 ? (currentSec / duration) * 95 : Math.min(95, (frameCount / 120) * 95);
          const estTotal = duration > 0 ? Math.round(duration * 24) : frameCount;
          reportProgress("processing", frameCount, estTotal, rawPct);
        }
      }

      if (frameCount === 0) {
        throw new VideoWmError("NO_FRAMES", "No frames were decoded from video");
      }

      // 7. Mux Audio packets
      if (aSource && aPackets) {
        reportProgress("audio", frameCount, frameCount, 96);
        let first = true;
        for await (const p of aPackets.packets()) {
          if (cancelled()) throw new VideoWmError("CANCELLED", "Processing cancelled");
          const p2 = aShift && p.timestamp != null && p.clone
            ? p.clone({ timestamp: p.timestamp + aShift })
            : p;
          await aSource.add(p2, first ? { decoderConfig: await aTrack.getDecoderConfig() } : undefined);
          first = false;
        }
      }

      // 8. Finalize MP4 Muxer
      reportProgress("finalizing", frameCount, frameCount, 99);
      await output.finalize();

      const buf = output.target.buffer;
      if (!buf) {
        throw new VideoWmError("NO_OUTPUT", "Output MP4 buffer is empty");
      }

      const totalMs = Math.round(performance.now() - t0);
      console.log(`${LOG} Video cleaned successfully: ${frameCount} frames in ${totalMs}ms (${(frameCount / (totalMs / 1000)).toFixed(1)} fps)`);

      reportProgress("completed", frameCount, frameCount, 100);

      return {
        blob: new Blob([buf], { type: "video/mp4" }),
        applied: true,
        stats: {
          frames: frameCount,
          duration,
          width: W,
          height: H,
          totalMs,
        },
      };
    } finally {
      try {
        if (output && output.state !== "finalized") await output.cancel();
      } catch (_) {}
      try {
        await input.dispose?.();
      } catch (_) {}
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { process, VideoWmError };
  } else {
    (globalThis || self).VideoWatermarkRemover = { process, VideoWmError };
  }
})();
