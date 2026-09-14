import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { DurableJobClaimStore, type DurableJobClaimInput } from "../src/durable-job-claim.ts";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "heavy-job-claim-"));
  const path = join(directory, "claims.sqlite");
  return { path, directory, open: () => new DatabaseSync(path), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
const base: DurableJobClaimInput = { requestId: "req-1", candidateIndex: 0, executionId: "exec-1", ownerId: "worker-a", leaseToken: "token-a", leaseDurationMs: 100 };

test("independent SQLite connections produce one winner and reject an active competitor", () => {
  const f = fixture(); const dbA = f.open(); const dbB = f.open();
  try {
    const winner = new DurableJobClaimStore(dbA as never).claim(base, 1);
    assert.equal(winner.status, "claimed");
    const competitor = new DurableJobClaimStore(dbB as never).claim({ ...base, ownerId: "worker-b", leaseToken: "token-b" }, 2);
    assert.equal(competitor.status, "lease_active");
  } finally { dbA.close(); dbB.close(); f.cleanup(); }
});

test("expired claim can be taken over after close/reopen, retaining execution id and fencing stale owner", () => {
  const f = fixture(); const dbA = f.open();
  let first;
  try { first = new DurableJobClaimStore(dbA as never).claim(base, 1); } finally { dbA.close(); }
  const dbB = f.open();
  try {
    const takeover = new DurableJobClaimStore(dbB as never).claim({ ...base, ownerId: "worker-b", leaseToken: "token-b" }, 101);
    assert.equal(first.status, "claimed"); assert.equal(takeover.status, "claimed");
    assert.equal(takeover.takeover, true); assert.equal(takeover.executionId, "exec-1"); assert.equal(takeover.claimGeneration, 2);
    if (first.status === "claimed") assert.equal(new DurableJobClaimStore(dbB as never).recordDispatch(first, "provider-old", 102).status, "stale_fence");
  } finally { dbB.close(); f.cleanup(); }
});

test("crash after claim recovers with the same fixed execution id", () => {
  const f = fixture(); const dbA = f.open();
  try { assert.equal(new DurableJobClaimStore(dbA as never).claim(base, 1).status, "claimed"); } finally { dbA.close(); }
  const dbB = f.open();
  try {
    const recovered = new DurableJobClaimStore(dbB as never).claim({ ...base, ownerId: "worker-b", leaseToken: "token-b" }, 102);
    assert.equal(recovered.status, "claimed"); assert.equal(recovered.executionId, base.executionId);
  } finally { dbB.close(); f.cleanup(); }
});

test("execution id is immutable per request candidate", () => {
  const f = fixture(); const db = f.open();
  try { const store = new DurableJobClaimStore(db as never); store.claim(base, 1); const conflict = store.claim({ ...base, executionId: "exec-other" }, 200); assert.deepEqual(conflict, { status: "execution_id_conflict", existingExecutionId: "exec-1" }); }
  finally { db.close(); f.cleanup(); }
});

test("dispatch fence survives restart and forbids takeover or re-dispatch", () => {
  const f = fixture(); const dbA = f.open(); let claimed;
  try { claimed = new DurableJobClaimStore(dbA as never).claim(base, 1); assert.equal(claimed.status, "claimed"); if (claimed.status === "claimed") assert.deepEqual(new DurableJobClaimStore(dbA as never).recordDispatch(claimed, "provider-1", 50), { status: "recorded", providerDispatchId: "provider-1", claimGeneration: 1 }); }
  finally { dbA.close(); }
  const dbB = f.open();
  try {
    assert.equal(claimed.status, "claimed");
    if (claimed.status === "claimed") assert.deepEqual(new DurableJobClaimStore(dbB as never).recordDispatch(claimed, "provider-2", 51), { status: "dispatch_recorded", reconciliationNeeded: true, providerDispatchId: "provider-1", claimGeneration: 1 });
    const noTakeover = new DurableJobClaimStore(dbB as never).claim({ ...base, ownerId: "worker-b", leaseToken: "token-b" }, 1000);
    assert.deepEqual(noTakeover, { status: "dispatch_recorded", reconciliationNeeded: true, providerDispatchId: "provider-1", claimGeneration: 1 });
  } finally { dbB.close(); f.cleanup(); }
});

test("dispatch is rejected at exact expiry and a pre-dispatch owner/token mismatch is fenced", () => {
  const f = fixture(); const db = f.open();
  try {
    const store = new DurableJobClaimStore(db as never); const claimed = store.claim(base, 1); assert.equal(claimed.status, "claimed");
    if (claimed.status !== "claimed") return;
    assert.equal(store.recordDispatch(claimed, "provider-expired", 101).status, "lease_expired");
    assert.equal(store.recordDispatch({ ...claimed, ownerId: "other", leaseToken: "other-token" }, "provider-mismatch", 50).status, "stale_fence");
  } finally { db.close(); f.cleanup(); }
});

test("claim input validation rejects malformed identifiers and lease", () => {
  const f = fixture(); const db = f.open();
  try {
    const store = new DurableJobClaimStore(db as never);
    assert.equal(store.claim({ ...base, requestId: "" }, 1).status, "invalid");
    assert.equal(store.claim({ ...base, candidateIndex: -1 }, 1).status, "invalid");
    assert.equal(store.claim({ ...base, leaseDurationMs: 0 }, 1).status, "invalid");
    assert.equal(store.claim({ ...base, leaseDurationMs: 10 }, Number.MAX_SAFE_INTEGER - 1).status, "invalid");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM durable_job_claims").get() as { count: number }).count, 0);
  } finally { db.close(); f.cleanup(); }
});
