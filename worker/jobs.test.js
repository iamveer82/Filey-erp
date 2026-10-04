import assert from "node:assert/strict";
import test from "node:test";
import { finishWorkerClaim } from "./jobs.js";

const claim = { id: "job-1", status: "processing", updated_at: "2026-10-04T01:00:00.000Z" };
function fixture(row) {
  let state = { ...row };
  const client = { from(table) {
    assert.equal(table, "tool_jobs");
    return { update(patch) {
      const filters=[];
      const query={ eq(key,value) { filters.push([key,value]); return query; }, async select() {
        if (filters.every(([key,value]) => state[key] === value)) {
          state={...state,...patch}; return { data:[{id:state.id}],error:null };
        }
        return { data:[],error:null };
      }};
      return query;
    }};
  }};
  return { client, read:()=>state };
}

test("only the current processing claim can publish completion", async () => {
  const f=fixture(claim);
  assert.equal(await finishWorkerClaim(f.client,claim,{status:"done",updated_at:"2026-10-04T01:02:00.000Z"}),true);
  assert.equal(f.read().status,"done");
  assert.equal(await finishWorkerClaim(f.client,claim,{status:"error"}),false);
  assert.equal(f.read().status,"done");
});

test("a late completion/error cannot overwrite requeue, cancellation or a newer claim", async () => {
  for (const current of [
    {...claim,status:"pending"}, {...claim,status:"cancelled"},
    {...claim,updated_at:"2026-10-04T01:16:00.000Z"},
  ]) {
    for (const status of ["done","error"]) {
      const f=fixture(current);
      assert.equal(await finishWorkerClaim(f.client,claim,{status}),false);
      assert.deepEqual(f.read(),current);
    }
  }
});

test("missing or invalid claim revisions fail before any mutation", async () => {
  const client={from(){throw new Error("must not query");}};
  for (const job of [{id:"job-1"},{...claim,updated_at:"invalid"},{...claim,id:null}])
    await assert.rejects(finishWorkerClaim(client,job,{status:"done"}),/Invalid worker claim/);
});

test("database failures remain failures rather than success receipts", async () => {
  const query={eq(){return query;},async select(){return{data:null,error:new Error("fixture unavailable")};}};
  const client={from(){return{update(){return query;}};}};
  await assert.rejects(finishWorkerClaim(client,claim,{status:"done"}),/fixture unavailable/);
});
