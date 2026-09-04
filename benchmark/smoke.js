// benchmark/smoke.js — temporary smoke test for strategies + corpus + metrics.
// Not part of the frozen benchmark; delete after verification.
import * as m from "./lib/strategies.js";
import * as c from "./lib/corpus.js";
import * as M from "./lib/metrics.js";

const real = console.log;
console.log = () => {};
try {
  const ctx = m.makeCtx();
  const mk = (o) => ({ kind: "pos", cls: "flat", op: 1.0, noise: 2, seed: 11, ...o });
  const metas = [
    mk({ id: "resize", W: 1024, H: 768, maskSize: 54, margin: 118 }),
    mk({ id: "4k", W: 3840, H: 2880 }),
    mk({ id: "jpeg", W: 1024, H: 1024, jpeg: 70, cls: "darkjpeg" }),
    mk({ id: "neg", kind: "neg", W: 1024, H: 1024 }),
  ];
  for (const meta of metas) {
    const made = c.makeImage(meta, ctx);
    const det = m.detectPipeline(made.input);
    const d = det.detections?.[0];
    real(meta.id.padEnd(6), "gt", made.gt ? `${made.gt.x},${made.gt.y} w${made.gt.w}` : "none",
      "| det", d ? `${d.x},${d.y} w${d.mask.w} ncc ${d.ncc.toFixed(3)} ${d.mode}` : det.reason,
      "| err", d && made.gt ? Math.hypot(d.x - made.gt.x, d.y - made.gt.y).toFixed(1) : "-");
  }

  // restoration strategies on one fixture
  const meta = mk({ id: "restore", W: 1024, H: 1024 });
  const made = c.makeImage(meta, ctx);
  const strat = m.makeRestoreStrategies(ctx);
  for (const [name, fn] of Object.entries(strat)) {
    const work = { width: made.input.width, height: made.input.height, data: new Uint8ClampedArray(made.input.data) };
    const info = fn(work, ctx.maskOf(48), made.gt);
    const lout = M.lumaOf(work), la = M.lumaOf(made.clean);
    const ssim = M.ssimRegion(lout, la, 1024, { x: made.gt.x, y: made.gt.y, w: 48, h: 48 });
    real("restore", name.padEnd(20), "ssim", ssim.toFixed(4), JSON.stringify(info).slice(0, 120));
  }

  // D end-to-end + gates telemetry
  const work = { width: made.input.width, height: made.input.height, data: new Uint8ClampedArray(made.input.data) };
  const res = await m.processD(work, {});
  real("processD:", JSON.stringify(res.applied ? { pos: res.pos, ncc: +res.ncc.toFixed(3), det0: { gain: res.detections[0].gain, gateNcc: +res.detections[0].gateNcc.toFixed(3), gateSeam: +res.detections[0].gateSeam.toFixed(2), fallback: res.detections[0].fallback } } : res));
  real("SMOKE OK");
} catch (e) {
  console.error("FAIL", e);
  process.exitCode = 1;
} finally {
  console.log = real;
}
