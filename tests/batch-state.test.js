import test from "node:test";
import assert from "node:assert/strict";
import {makeBatch, transition, interruptOnRecovery, nextQueued, countDone} from "../lib/batch-state.js";
const item=(id)=>({id,kind:"image",quality:"2k"});
test("batch enforces deduplication and limit",()=>{
  assert.throws(()=>makeBatch("b","p",[item("x"),item("x")]),/Duplicate/);
  assert.throws(()=>makeBatch("b","p",Array.from({length:21},(_,i)=>item(String(i)))),/Invalid batch/);
});
test("completion requires ordered confirmed download",()=>{
  let b=makeBatch("b","p",[item("x")],1);
  assert.throws(()=>transition(b,"x","completed"),/Invalid transition/);
  for(const s of ["resolving","native_triggered","intercepted","processing","download_started","completed"]) b=transition(b,"x",s);
  assert.equal(countDone(b),1);
  assert.equal(nextQueued(b),null);
});
test("reload never silently retries an uncertain attempt",()=>{
  let b=makeBatch("b","p",[item("x"),item("y")],1);
  b=transition(b,"x","resolving");b=transition(b,"x","native_triggered");
  b=interruptOnRecovery(b);
  assert.equal(b.items[0].status,"needs_review");
  assert.equal(b.items[1].status,"queued");
  assert.equal(nextQueued(b),null);
  assert.throws(()=>transition(b,"x","queued"));
});
test("confirmed failure may be retried only explicitly",()=>{
  let b=makeBatch("b","p",[item("x")],1);
  b=transition(b,"x","resolving");b=transition(b,"x","failed");
  b=transition(b,"x","queued",{attempt:null,error:null});
  assert.equal(nextQueued(b).id,"x");
});
