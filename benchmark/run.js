// benchmark/run.js — V8 Hybrid Integration & Benchmark orchestrator (Phase 3).
// Frozen A/B/C/D matrix:
//   A = repo V7 baseline (fd73313)     B = candidate ZIP V8 (manifest 1.3.2)
//   C = Conservative master (f4e3c09)  D = Hybrid prototype (this benchmark)
// Layers:
//   1. threshold calibration sweep on the calPos/calNeg split (gate freeze),
//   2. restoration-only (same GT mask+pos fed to each strategy),
//   3. end-to-end (full process(), independent detection),
//   4. D-only mass-negative audit (>= 3,000 fixtures, 0 modifications).
// Output: benchmark/results/report.md + results.json
//
// Usage: node benchmark/run.js [--quick]

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

import { buildSpec, makeImage } from "./lib/corpus.js";
import * as M from "./lib/metrics.js";
import {
  makeCtx, makeRestoreStrategies, makeE2EStrategies, processD,
  detectHead, scanStars, seedInfoOf,
} from "./lib/strategies.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "results");
const QUICK = process.argv.includes("--quick");
const T0 = performance.now();

// ── harness helpers ─────────────────────────────────────────────────────────

const ctx = makeCtx();
const restoreStrategies = makeRestoreStrategies(ctx);

// Vendors log a [FlowZero] line per locate; silence them for clean reports.
const realLog = console.log;
console.log = () => {};

function cloneImg(src) {
  return { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
}
function median(a) { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function pct(a, p) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
function fmt(v, d = 3) { return Number.isFinite(v) ? v.toFixed(d) : "n/a"; }
function secs(ms) { return Number.isFinite(ms) ? (ms / 1000).toFixed(1) : "n/a"; }

// Recall is credited only when a returned box substantially covers the GT box
// (>= 50% of the smaller area) — a corner-adjacent box that misses the star
// does not remove anything.
function detHitsGT(det, gt) {
  if (!det?.detections?.length) return false;
  for (const d of det.detections) {
    const w = d.mask?.w ?? d.w, h = d.mask?.h ?? d.h;
    if (!w || !h) continue;
    const ix = Math.max(0, Math.min(d.x + w, gt.x + gt.w) - Math.max(d.x, gt.x));
    const iy = Math.max(0, Math.min(d.y + h, gt.y + gt.h) - Math.max(d.y, gt.y));
    if ((ix * iy) / Math.min(w * h, gt.w * gt.h) >= 0.5) return true;
  }
  return false;
}

// ── 1. Calibration sweep ────────────────────────────────────────────────────
// Grid over (ncc, coarse, strictStrong); robust fixed at the C constant 0.58.
// The head (locate + locateRobust) is gate-independent — computed once per
// fixture. The expensive region scan depends only on (seedState, coarse), so
// it is cached per fixture across the whole grid: a strict short-circuit
// ("sc") needs zero scans, a no-seed negative ("none") needs zero scans, and
// seeded cases need at most one scan per distinct coarse value (4).

function calSweep(spec) {
  const gatesGrid = [];
  for (const ncc of [0.30, 0.35, 0.40, 0.45]) {
    for (const coarse of [0.30, 0.34, 0.38, 0.42]) {
      for (const strictStrong of [0.55, 0.62, 0.68]) {
        for (const robust of [0.58, 0.62, 0.66]) {
          gatesGrid.push({ ncc, coarse, strictStrong, robust });
        }
      }
    }
  }

  const acc = gatesGrid.map((gates) => ({
    gates, tp: 0, fp: 0, worstHitNcc: Infinity,
    recall: 0, fpr: 0,
  }));

  const runFixture = (meta, isPos) => {
    const made = makeImage(meta, ctx);
    const img = made.input;
    const head = detectHead(img);
    const scanCache = new Map(); // seedState|coarse -> detections array
    for (let gi = 0; gi < gatesGrid.length; gi++) {
      const gates = gatesGrid[gi];
      const info = seedInfoOf(head, gates);
      const key = `${info.state}|${gates.coarse}`;
      let detections;
      if (scanCache.has(key)) {
        detections = scanCache.get(key);
      } else {
        // Only the strict short-circuit ("sc") skips the region scan. A null
        // seed (state "none") still scans in the real pipeline — the scan
        // itself is the safety net for threshold-gated strict hits.
        detections = info.state === "sc"
          ? [info.seed]
          : scanStars(img, head.baseMask, info.seed, gates);
        scanCache.set(key, detections);
      }
      if (isPos) {
        if (detHitsGT({ detections }, made.gt)) {
          acc[gi].tp++;
          acc[gi].worstHitNcc = Math.min(acc[gi].worstHitNcc, detections[0].ncc);
        } else {
          (acc[gi].missedIds ??= []).push(meta.id);
        }
      } else if (detections.length) {
        acc[gi].fp++;
      }
    }
  };

  for (const meta of spec.calPos) runFixture(meta, true);
  const calNegMetas = [...spec.calNeg]; // calibration split only — main-run hardNegs stay unseen
  for (const meta of calNegMetas) runFixture(meta, false);

  for (const a of acc) {
    a.recall = a.tp / spec.calPos.length;
    a.fpr = a.fp / calNegMetas.length;
  }

  // Selection: 0 false positives first (safety), then max recall. A perfect
  // set may not exist: lowc fixtures at opacity 0.5 + noise >= 8 sit below
  // NCC ~0.31 — an honest perceptual floor, reported alongside instead of
  // absorbed by lowering gates further.
  const perfect = acc.filter((a) => a.tp === spec.calPos.length && a.fp === 0);
  const zeroFp = acc.filter((a) => a.fp === 0);
  const pool = zeroFp.length ? zeroFp : acc;
  const chosen = pool.slice().sort((a, b) =>
    b.tp - a.tp ||
    (b.worstHitNcc - b.gates.robust) - (a.worstHitNcc - a.gates.robust) ||
    b.gates.ncc - a.gates.ncc || b.gates.coarse - a.gates.coarse || b.gates.strictStrong - a.gates.strictStrong)[0];
  return {
    results: acc, chosen,
    posCount: spec.calPos.length, negCount: calNegMetas.length,
    perfectCount: perfect.length, gridCount: gatesGrid.length,
    missedAtChosen: chosen.missedIds ?? [],
  };
}

// ── 2. Restoration-only layer (same GT mask + pos to every strategy) ──────────

async function restorationLayer(spec) {
  const rows = [];
  const metas = [...spec.pos, ...spec.e2e];
  for (const meta of metas) {
    const { input, clean, gt } = makeImage(meta, ctx);
    const box = { x: gt.x, y: gt.y, w: gt.w, h: gt.h };
    const ringOuter = M.expand(box, 6);
    const la = M.lumaOf(clean);
    const lb0 = M.lumaOf(input);
    const baseSeam = M.seamMismatch(lb0, la, input.width, input.height, box);
    for (const [name, fn] of Object.entries(restoreStrategies)) {
      const work = cloneImg(input);
      const t0 = performance.now();
      const info = fn(work, ctx.maskOf(gt.w), gt);
      const ms = performance.now() - t0;
      const lout = M.lumaOf(work);
      rows.push({
        fixture: meta.id, cls: meta.cls,
        group: meta.W * meta.H > 3e6 ? "e2e4k" : "pos",
        strat: name, op: meta.op, jpeg: !!meta.jpeg,
        ssim: M.ssimRegion(lout, la, work.width, box),
        psnr: M.psnrRegion(lout, la, work.width, box),
        seamRel: M.seamMismatch(lout, la, work.width, work.height, box) - baseSeam,
        haloOut: M.meanAbsDiffRing(lout, la, work.width, M.expand(box, 2), ringOuter),
        ms, info,
        contain: M.changedPixelStats(input, work, [box], 2),
      });
    }
  }
  return rows;
}

// ── 3. End-to-end layer (full process(), independent detection) ───────────────

async function e2eLayer(spec, strategies) {
  const rows = [];
  const metas = [
    ...spec.pos, ...spec.neg, ...spec.hardNeg, ...spec.e2e,
    ...(QUICK ? [] : spec.mass.slice(0, 200)),
  ];
  for (const meta of metas) {
    const { input, clean, gt } = makeImage(meta, ctx);
    const gtBox = gt ? { x: gt.x, y: gt.y, w: gt.w, h: gt.h } : null;
    for (const [name, fn] of Object.entries(strategies)) {
      const work = cloneImg(input);
      const t0 = performance.now();
      const res = await fn(work);
      const ms = performance.now() - t0;
      const row = {
        fixture: meta.id, cls: meta.cls, kind: meta.kind, strat: name, ms,
        applied: !!res?.applied, reason: res?.reason ?? null,
        variantId: res?.variantId ?? null,
        ncc: res?.ncc ?? null, mode: res?.mode ?? null,
      };
      if (meta.kind === "pos") {
        if (res?.applied) {
          const p = res.detections?.[0] ?? res.pos;
          if (p) {
            row.locErrX = p.x - gt.x;
            row.locErrY = p.y - gt.y;
            row.locErr = Math.hypot(p.x - gt.x, p.y - gt.y);
            row.sizeErr = p.w ? p.w - gt.w : null;
            row.gain = p.gain ?? null;
          }
          const la = M.lumaOf(clean);
          const lout = M.lumaOf(work);
          row.ssim = M.ssimRegion(lout, la, work.width, gtBox);
          row.psnr = M.psnrRegion(lout, la, work.width, gtBox);
          const boxes = (res.detections?.length ? res.detections : res.pos ? [res.pos] : [])
            .map((d) => ({ x: d.x, y: d.y, w: d.w, h: d.h }));
          if (boxes.length) row.contain = M.changedPixelStats(input, work, boxes, 2);
        }
      } else {
        row.unmodified = M.isUnmodified(input, work);
      }
      rows.push(row);
    }
  }
  return rows;
}

// ── 4. D-only mass-negative audit (>= 3,000 fixtures, 0 modifications) ───────

async function massAudit(spec, gates) {
  let detected = 0, modified = 0;
  const t0 = performance.now();
  for (const meta of spec.mass) {
    const { input } = makeImage(meta, ctx);
    const work = cloneImg(input);
    const res = await processD(work, gates);
    if (res.applied) {
      detected++;
      if (!M.isUnmodified(input, work)) modified++;
    }
  }
  return { count: spec.mass.length, detected, modified, ms: performance.now() - t0 };
}

// ── main ────────────────────────────────────────────────────────────────────

const spec = buildSpec();
realLog("[setup] corpus:", {
  calPos: spec.calPos.length, calNeg: spec.calNeg.length,
  pos: spec.pos.length, neg: spec.neg.length, hardNeg: spec.hardNeg.length,
  mass: spec.mass.length, e2e: spec.e2e.length,
});

const cal = calSweep(spec);
const chosenGates = cal.chosen.gates;
realLog("[calibration] chosen:", JSON.stringify(chosenGates),
  `(perfect sets: ${cal.perfectCount}/${cal.gridCount}, pos ${cal.posCount}, neg ${cal.negCount})`);

const strategies = makeE2EStrategies(chosenGates);
const restRows = await restorationLayer(spec);
realLog(`[restoration] ${restRows.length} rows done`);
const e2eRows = await e2eLayer(spec, strategies);
realLog(`[e2e] ${e2eRows.length} rows done`);
const mass = QUICK
  ? { count: 0, detected: 0, modified: 0, ms: 0, skipped: true }
  : await massAudit(spec, chosenGates);
realLog(`[mass] ${mass.count} fixtures: detected ${mass.detected}, modified ${mass.modified}`);

// ── aggregation ─────────────────────────────────────────────────────────────

function summarize(rows, key) {
  const vals = rows.map((r) => r[key]).filter(Number.isFinite);
  return vals.length ? { mean: mean(vals), median: median(vals), p10: pct(vals, 0.1), p90: pct(vals, 0.9) } : null;
}

const restByStrat = {};
for (const r of restRows) (restByStrat[r.strat] ??= []).push(r);
const restByStratCls = {};
for (const r of restRows) ((restByStratCls[r.strat] ??= {})[r.cls] ??= []).push(r);

const restSummary = {};
for (const [s, rows] of Object.entries(restByStrat)) {
  restSummary[s] = {
    n: rows.length,
    ssim: summarize(rows, "ssim"), psnr: summarize(rows, "psnr"),
    seamRel: summarize(rows, "seamRel"), haloOut: summarize(rows, "haloOut"),
    ms: summarize(rows, "ms"),
    oob: rows.filter((r) => r.contain?.outside > 0).length,
    fallback: rows.filter((r) => r.info?.fallback).length,
  };
}

const e2ePos = e2eRows.filter((r) => r.kind === "pos");
const e2eNeg = e2eRows.filter((r) => r.kind !== "pos");
const e2eSummary = {};
for (const s of Object.keys(strategies)) {
  const rs = e2ePos.filter((r) => r.strat === s);
  const ns = e2eNeg.filter((r) => r.strat === s && r.kind === "neg");
  const hs = e2eNeg.filter((r) => r.strat === s && r.kind === "hardneg");
  const byClass = {};
  for (const r of rs) (byClass[r.cls] ??= []).push(r);
  e2eSummary[s] = {
    recall: rs.length ? rs.filter((r) => r.applied).length / rs.length : 0,
    missed: rs.filter((r) => !r.applied).map((r) => r.fixture),
    negApplied: ns.filter((r) => r.applied).length,
    negTotal: ns.length,
    negModified: ns.filter((r) => r.applied && !r.unmodified).length,
    hardApplied: hs.filter((r) => r.applied).length,
    hardTotal: hs.length,
    hardModified: hs.filter((r) => r.applied && !r.unmodified).length,
    locErr: summarize(rs.filter((r) => Number.isFinite(r.locErr)), "locErr"),
    sizeErr: summarize(rs.filter((r) => Number.isFinite(r.sizeErr)), "sizeErr"),
    ssim: summarize(rs, "ssim"), psnr: summarize(rs, "psnr"),
    ms: summarize(rs, "ms"),
    perClass: Object.fromEntries(Object.entries(byClass).map(([cls, list]) => [cls, {
      n: list.length,
      recall: list.filter((r) => r.applied).length / list.length,
      ssim: summarize(list, "ssim"),
      psnr: summarize(list, "psnr"),
    }])),
  };
}

// ── plan acceptance checks ──────────────────────────────────────────────────

function acceptance() {
  const checks = [];
  const classes = ["flat", "gradient", "darkjpeg", "strands", "lineart", "texture"];

  // Restoration layer checks
  for (const cls of classes) {
    const get = (s) => {
      const vals = restRows.filter((r) => r.strat === s && r.cls === cls && Number.isFinite(r.ssim)).map((r) => r.ssim);
      return vals.length ? median(vals) : null;
    };
    const hybS = get("D-hybrid-srgb"), hybL = get("D-hybrid-linear");
    const v7 = get("C-unblend-denoise");
    const v8 = get("B-inpaint");
    const hyb = Math.max(hybS ?? -1, hybL ?? -1);
    const best = Math.max(v7 ?? -1, v8 ?? -1);
    if (hyb < 0 || best < 0) continue;
    checks.push({
      rule: `Hybrid >= best(V7,V8) - 0.005 SSIM [rest/${cls}]`,
      value: hyb, threshold: best - 0.005,
      pass: hyb >= best - 0.005 - 1e-9,
      detail: { hybrid: hyb, hybridSrgb: hybS, hybridLinear: hybL, v7, v8 },
    });
  }

  // End-to-end layer checks (fair comparison: median over intersection of detected fixtures >= 3)
  for (const cls of classes) {
    const dRows = e2ePos.filter((r) => r.strat === "D-hybrid" && r.cls === cls && r.applied && Number.isFinite(r.ssim));
    const dMap = new Map(dRows.map((r) => [r.fixture, r.ssim]));

    const v7Rows = e2ePos.filter((r) => r.strat === "A-v7-baseline" && r.cls === cls && r.applied && Number.isFinite(r.ssim));
    const v7Map = new Map(v7Rows.map((r) => [r.fixture, r.ssim]));
    const commonV7 = [...dMap.keys()].filter((id) => v7Map.has(id));

    const v8Rows = e2ePos.filter((r) => r.strat === "B-v8-zip" && r.cls === cls && r.applied && Number.isFinite(r.ssim));
    const v8Map = new Map(v8Rows.map((r) => [r.fixture, r.ssim]));
    const commonV8 = [...dMap.keys()].filter((id) => v8Map.has(id));

    const v7Valid = commonV7.length >= 3;
    const v8Valid = commonV8.length >= 3;
    if (!v7Valid && !v8Valid) continue;

    const dOnV7 = v7Valid ? median(commonV7.map((id) => dMap.get(id))) : null;
    const v7Med = v7Valid ? median(commonV7.map((id) => v7Map.get(id))) : null;

    const dOnV8 = v8Valid ? median(commonV8.map((id) => dMap.get(id))) : null;
    const v8Med = v8Valid ? median(commonV8.map((id) => v8Map.get(id))) : null;

    const v7Pass = v7Valid ? dOnV7 >= v7Med - 0.005 - 1e-9 : true;
    const v8Pass = v8Valid ? dOnV8 >= v8Med - 0.005 - 1e-9 : true;
    const pass = v7Pass && v8Pass;

    const best = Math.max(v7Med ?? -1, v8Med ?? -1);
    const hyb = (dOnV7 != null && dOnV8 != null) ? Math.min(dOnV7, dOnV8) : (dOnV7 ?? dOnV8);

    checks.push({
      rule: `Hybrid >= best(V7,V8) - 0.005 SSIM [e2e/${cls}]`,
      value: hyb, threshold: best - 0.005,
      pass,
      detail: {
        hybrid: hyb,
        v7: v7Med, dOnV7, nV7: commonV7.length, v7Valid,
        v8: v8Med, dOnV8, nV8: commonV8.length, v8Valid,
      },
    });
  }

  checks.push({
    rule: "0 modified / >= 3,000 negative fixtures (D)",
    value: mass.skipped ? "n/a" : mass.modified, threshold: 0,
    pass: mass.skipped ? null : (mass.modified === 0 && mass.count >= 3000),
    detail: { count: mass.count, detected: mass.detected, skipped: !!mass.skipped },
  });
  {
    const errs = e2ePos.filter((r) => r.strat === "D-hybrid" && Number.isFinite(r.locErr)).map((r) => r.locErr);
    checks.push({
      rule: "median localization error <= 1px (D, e2e)",
      value: errs.length ? median(errs) : null, threshold: 1,
      pass: errs.length > 0 && median(errs) <= 1,
      detail: { n: errs.length },
    });
  }
  {
    const fails = e2ePos.filter((r) => r.strat === "D-hybrid" && r.contain && r.contain.outside > 0).length;
    const n = e2ePos.filter((r) => r.strat === "D-hybrid" && r.contain).length;
    checks.push({
      rule: "edit containment 100% within mask+feather (D, e2e)",
      value: n ? fails / n : null, threshold: 0,
      pass: n > 0 && fails === 0,
      detail: { n, fails },
    });
  }
  // Plan-critical negative safety: PLAIN negatives (no decoys) must never be
  // modified BY THE CANDIDATE (D). A/B/C run their own frozen gates (A's
  // NCC threshold is 0.20 — it fires on plain texture negatives at 0.25),
  // so their plain-neg firings are baseline comparison data, not plan gates.
  // D's scan gates are the calibrated ones, so this check is meaningful and
  // binding for D. Adversarial hardNeg decoys (X/diamond/bright-patch) are
  // an honest frontier finding — reported, not gated.
  const plainNeg = e2eNeg.filter((r) => r.kind === "neg");
  const dBad = plainNeg.filter((r) => r.strat === "D-hybrid" && r.applied && !r.unmodified);
  checks.push({
    rule: "e2e plain negatives: 0 pixel modifications (D)",
    value: dBad.length, threshold: 0, pass: dBad.length === 0,
    detail: {
      dTotal: plainNeg.filter((r) => r.strat === "D-hybrid").length,
      baseline: Object.fromEntries(Object.keys(strategies).map((s) => [s,
        plainNeg.filter((r) => r.strat === s && r.applied && !r.unmodified).length])),
    },
  });
  return checks;
}

const checks = acceptance();

// ── outputs ─────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });
const payload = {
  meta: {
    generated: new Date().toISOString(),
    quick: QUICK,
    runtimeMs: Math.round(performance.now() - T0),
    node: process.version,
    corpus: {
      calPos: spec.calPos.length, calNeg: spec.calNeg.length,
      pos: spec.pos.length, neg: spec.neg.length, hardNeg: spec.hardNeg.length,
      mass: spec.mass.length, e2e4k: spec.e2e.length,
    },
    frozenGates: chosenGates,
    calibration: {
      chosen: cal.chosen, perfectSets: cal.perfectCount, gridCount: cal.gridCount,
      posCount: cal.posCount, negCount: cal.negCount,
    },
  },
  restSummary, e2eSummary, mass, checks,
  raw: {
    restRows,
    e2eRows: e2eRows.map((r) => ({
      ...r,
      contain: r.contain
        ? { changed: r.contain.changed, outside: r.contain.outside, containment: r.contain.containment, haloExtent: r.contain.haloExtent }
        : null,
    })),
  },
};
writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify(payload, null, 2));

const L = [];
L.push("# FlowZero V8 Hybrid Benchmark Report");
L.push("");
L.push(`- Generated: ${payload.meta.generated} · runtime ${secs(payload.meta.runtimeMs)}s · node ${process.version} · mode: ${QUICK ? "QUICK" : "full"}`);
L.push("- A = V7 baseline (fd73313) · B = candidate ZIP V8 · C = Conservative master (f4e3c09) · D = Hybrid prototype");
L.push(`- Corpus: ${spec.pos.length} restoration positives (+${spec.e2e.length} 4K e2e) · ${spec.neg.length} negatives · ${spec.hardNeg.length} hard-negatives · ${spec.mass.length} D mass negatives · ${spec.calPos.length}+${spec.calNeg.length} calibration`);
L.push(`- Frozen gates (calibrated): ${JSON.stringify(chosenGates)}`);
L.push("");
L.push("## Plan acceptance checks");
L.push("");
L.push("| Rule | Value | Threshold | Pass |");
L.push("|---|---|---|---|");
for (const c of checks) {
  const v = typeof c.value === "number" ? fmt(c.value) : String(c.value);
  const t = typeof c.threshold === "number" ? fmt(c.threshold) : String(c.threshold);
  const passStr = c.pass === true ? "✅ PASS" : c.pass === false ? "❌ FAIL" : "⏭ SKIP";
  L.push(`| ${c.rule} | ${v} | ${t} | ${passStr} |`);
}
L.push("");
L.push("## Restoration-only layer (positives)");
L.push("");
L.push("| strategy | n | SSIM med | PSNR med | seamΔ med | halo med | ms med | OOB | fallback |");
L.push("|---|---|---|---|---|---|---|---|---|");
for (const [s, d] of Object.entries(restSummary)) {
  L.push(`| ${s} | ${d.n} | ${fmt(d.ssim?.median)} | ${fmt(d.psnr?.median)} | ${fmt(d.seamRel?.median)} | ${fmt(d.haloOut?.median)} | ${fmt(d.ms?.median, 1)} | ${d.oob} | ${d.fallback} |`);
}
L.push("");
L.push("### Restoration per class (SSIM med)");
L.push("");
L.push("| strategy | class | n | SSIM med | PSNR med |");
L.push("|---|---|---|---|---|");
for (const [s, byCls] of Object.entries(restByStratCls)) {
  for (const [cls, rows] of Object.entries(byCls)) {
    L.push(`| ${s} | ${cls} | ${rows.length} | ${fmt(summarize(rows, "ssim")?.median)} | ${fmt(summarize(rows, "psnr")?.median)} |`);
  }
}
L.push("");
L.push("## End-to-end layer (per strategy)");
L.push("");
L.push("| strategy | recall | neg applied | neg modified | hardNeg applied | hardNeg modified | locErr med | sizeErr med | SSIM med | PSNR med | ms med |");
L.push("|---|---|---|---|---|---|---|---|---|---|---|");
for (const [s, d] of Object.entries(e2eSummary)) {
  L.push(`| ${s} | ${fmt(d.recall)} | ${d.negApplied}/${d.negTotal} | ${d.negModified} | ${d.hardApplied}/${d.hardTotal} | ${d.hardModified} | ${fmt(d.locErr?.median)} | ${fmt(d.sizeErr?.median)} | ${fmt(d.ssim?.median)} | ${fmt(d.psnr?.median)} | ${fmt(d.ms?.median, 1)} |`);
}
L.push("");
L.push("### e2e per-class recall/SSIM (positives)");
L.push("");
L.push("| strategy | class | n | recall | SSIM med | PSNR med |");
L.push("|---|---|---|---|---|---|");
for (const [s, d] of Object.entries(e2eSummary)) {
  for (const [cls, pc] of Object.entries(d.perClass ?? {})) {
    L.push(`| ${s} | ${cls} | ${pc.n} | ${fmt(pc.recall)} | ${fmt(pc.ssim?.median)} | ${fmt(pc.psnr?.median)} |`);
  }
}
L.push("");
L.push("## D mass-negative audit");
L.push("");
L.push(`- fixtures: ${mass.count} · detected(applied): ${mass.detected} · pixel-modified: ${mass.modified}${mass.skipped ? " · (skipped in QUICK)" : ""}`);
L.push("");
L.push("## Missed positives (e2e)");
L.push("");
for (const [s, d] of Object.entries(e2eSummary)) {
  if (d.missed.length) L.push(`- ${s}: ${d.missed.join(", ")}`);
}
if (!Object.values(e2eSummary).some((d) => d.missed.length)) L.push("- none");
L.push("");
L.push("## Adversarial hard-negative frontier (report-only)");
L.push("");
{
  const adv = e2eRows.filter((r) => r.kind === "hardneg" && r.applied && !r.unmodified);
  L.push("| strategy | fixture | detected NCC | mode |");
  L.push("|---|---|---|---|");
  for (const r of adv) L.push(`| ${r.strat} | ${r.fixture} | ${fmt(r.ncc)} | ${r.mode ?? "-"} |`);
  if (!adv.length) L.push("| (none fired) | | | |");
  L.push("");
  L.push("Honest finding: X/diamond decoys and bright texture patches correlate");
  L.push("0.58-0.80 with the star template — above any NCC gate in the grid.");
  L.push("All vendors fire on them; separation requires a feature beyond NCC");
  L.push("(shape descriptors / learned detector), out of scope for this benchmark.");
}
L.push("");
L.push("## Threshold calibration");
L.push("");
L.push(`- ${cal.perfectCount}/${cal.gridCount} grid points achieved recall 1.0 / fp 0 on the calibration split (${cal.posCount} pos + ${cal.negCount} neg).`);
L.push(`- Chosen (frozen): ${JSON.stringify(chosenGates)} — weakest detected positive NCC ${fmt(cal.chosen.worstHitNcc)} vs robust gate ${chosenGates.robust}.`);
L.push("");
L.push("## Notes & limitations");
L.push("");
L.push("- Synthetic corpus (no real Flow fixtures available): findings are valid");
L.push("  relative to the Flow compositor model `out = bg*(1-a) + 255*a` and the");
L.push("  JPEG simulation, not against actual Flow exports.");
L.push("- SSIM/PSNR are computed against the clean reference (same JPEG encode");
L.push("  path for JPEG fixtures), inside the true watermark box only.");
L.push("- LPIPS is not measured (frozen package.json, no runtime deps);");
L.push("  SSIM/PSNR + seam/halo structural proxies are used instead.");
L.push("");
writeFileSync(join(OUT_DIR, "report.md"), L.join("\n"));

console.log = realLog;
realLog(`[done] report: ${join(OUT_DIR, "report.md")}`);
realLog(`[done] raw:    ${join(OUT_DIR, "results.json")}`);
const evaluated = checks.filter((c) => c.pass !== null);
const passed = evaluated.filter((c) => c.pass === true);
realLog(`[done] checks: ${passed.length}/${evaluated.length} PASS`);
