// Batch Download V1: pure, environment-agnostic queue state.
export const BATCH_LIMIT = 20;
export const TERMINAL = new Set(["completed", "failed", "skipped", "needs_review"]);
export const IN_FLIGHT = new Set(["resolving", "native_triggered", "intercepted", "processing", "download_started"]);
export const BATCH_VERSION = 1;
export function makeBatch(id, project, items, now = Date.now()) {
  if (!id || !project || !Array.isArray(items) || items.length < 1 || items.length > BATCH_LIMIT) throw new Error("Invalid batch");
  if (new Set(items.map(x => x.id)).size !== items.length) throw new Error("Duplicate item");
  return { version:BATCH_VERSION, id, project, createdAt:now, paused:false, items:items.map((x)=>({
    id:x.id, kind:x.kind, quality:x.quality, status:"queued", attempt:null, downloadId:null,
    error:null, filename:null, updatedAt:now
  })) };
}
export function transition(batch, itemId, next, patch = {}, now = Date.now()) {
  const item = batch.items.find(x=>x.id===itemId);
  if (!item) throw new Error("Item not found");
  const valid = {
    queued:["resolving", "skipped", "needs_review"],
    resolving:["native_triggered","failed","skipped","needs_review"],
    native_triggered:["intercepted","failed","needs_review"],
    intercepted:["processing","download_started","failed","needs_review"],
    processing:["download_started","failed","needs_review"],
    download_started:["completed","failed","needs_review"],
    failed:["queued"], skipped:[], completed:[], needs_review:[]
  };
  if (!valid[item.status]?.includes(next)) throw new Error(`Invalid transition ${item.status} -> ${next}`);
  return {...batch,items:batch.items.map(x=>x.id===itemId?{...x,...patch,status:next,updatedAt:now}:x)};
}
export function interruptOnRecovery(batch, now=Date.now()) {
  return {...batch,paused:true,items:batch.items.map(item=>IN_FLIGHT.has(item.status)
    ? {...item,status:"needs_review",error:"Batch interrupted; verify Downloads before retrying",updatedAt:now}
    : item)};
}
export function nextQueued(batch) { return batch.paused ? null : batch.items.find(x=>x.status==="queued") || null; }
export function countDone(batch) { return batch.items.filter(x=>x.status==="completed").length; }
