/**
 * Local contract fixture for a single durable claim per request candidate.
 *
 * The store deliberately depends on a tiny SQLite-like interface rather than
 * importing a runtime-specific SQLite implementation. It is therefore safe to
 * exercise locally without wiring this contract into a Worker handler.
 *
 * `recordDispatch` is the durable pre-provider-send intent fence. Callers must
 * generate `providerDispatchId` before sending to the provider, record it here,
 * and only the first `recorded` result may perform that one send. A later call,
 * or a caller recovering a lost response, gets `dispatch_recorded` and must
 * reconcile; that result is not a provider receipt.
 */

export interface SqliteStatement {
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes?: number | bigint };
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

export interface DurableJobClaimInput {
  requestId: string;
  candidateIndex: number;
  executionId: string;
  ownerId: string;
  leaseToken: string;
  leaseDurationMs: number;
}

export interface DurableJobClaimKey {
  requestId: string;
  candidateIndex: number;
  executionId: string;
  ownerId: string;
  leaseToken: string;
  claimGeneration: number;
}

export type ClaimResult =
  | (DurableJobClaimKey & { status: "claimed"; takeover: boolean })
  | { status: "lease_active"; currentGeneration: number; leaseExpiresAt: number }
  | { status: "execution_id_conflict"; existingExecutionId: string }
  | { status: "dispatch_recorded"; reconciliationNeeded: true; providerDispatchId: string | null; claimGeneration: number }
  | { status: "invalid"; message: string };

export type FencedResult =
  | { status: "dispatch_recorded"; reconciliationNeeded: true; providerDispatchId: string; claimGeneration: number }
  | { status: "recorded"; providerDispatchId: string; claimGeneration: number }
  | { status: "stale_fence"; currentGeneration: number }
  | { status: "lease_expired" }
  | { status: "execution_id_conflict"; existingExecutionId: string }
  | { status: "not_found" }
  | { status: "invalid"; message: string };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS durable_job_claims (
  request_id TEXT NOT NULL,
  candidate_index INTEGER NOT NULL,
  execution_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  lease_expires_at INTEGER NOT NULL,
  claim_generation INTEGER NOT NULL,
  dispatch_recorded INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_recorded IN (0, 1)),
  provider_dispatch_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (request_id, candidate_index)
);
CREATE INDEX IF NOT EXISTS durable_job_claims_execution_idx
  ON durable_job_claims (execution_id);
`;

type Row = {
  request_id: string;
  candidate_index: number;
  execution_id: string;
  owner_id: string;
  lease_token: string;
  lease_expires_at: number;
  claim_generation: number;
  dispatch_recorded: number;
  provider_dispatch_id: string | null;
};

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string`);
  return value;
}

function index(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error("candidateIndex must be a non-negative integer");
  return value as number;
}

function now(value?: number): number {
  const result = value ?? Date.now();
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("nowMs must be a non-negative safe integer");
  return result;
}

function validClaimInput(input: DurableJobClaimInput): string | undefined {
  try {
    text(input.requestId, "requestId"); text(input.executionId, "executionId");
    text(input.ownerId, "ownerId"); text(input.leaseToken, "leaseToken"); index(input.candidateIndex);
    if (!Number.isSafeInteger(input.leaseDurationMs) || input.leaseDurationMs <= 0) throw new Error("leaseDurationMs must be a positive safe integer");
  } catch (error) { return error instanceof Error ? error.message : String(error); }
  return undefined;
}

function keyFromInput(input: DurableJobClaimInput, generation: number): DurableJobClaimKey {
  return { requestId: input.requestId, candidateIndex: input.candidateIndex, executionId: input.executionId, ownerId: input.ownerId, leaseToken: input.leaseToken, claimGeneration: generation };
}

export class DurableJobClaimStore {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) { this.db = db; db.exec(SCHEMA); }

  claim(input: DurableJobClaimInput, nowMs?: number): ClaimResult {
    const invalid = validClaimInput(input); if (invalid) return { status: "invalid", message: invalid };
    let current: number;
    try { current = now(nowMs); } catch (error) { return { status: "invalid", message: error instanceof Error ? error.message : String(error) }; }
    const expires = current + input.leaseDurationMs;
    if (!Number.isSafeInteger(expires)) return { status: "invalid", message: "nowMs + leaseDurationMs must be a safe integer" };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT * FROM durable_job_claims WHERE request_id = ? AND candidate_index = ?").get(input.requestId, input.candidateIndex) as Row | undefined;
      if (!row) {
        this.db.prepare(`INSERT INTO durable_job_claims (request_id,candidate_index,execution_id,owner_id,lease_token,lease_expires_at,claim_generation,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)`)
          .run(input.requestId, input.candidateIndex, input.executionId, input.ownerId, input.leaseToken, expires, current, current);
        this.db.exec("COMMIT"); return { status: "claimed", ...keyFromInput(input, 1), takeover: false };
      }
      if (row.execution_id !== input.executionId) { this.db.exec("COMMIT"); return { status: "execution_id_conflict", existingExecutionId: row.execution_id }; }
      if (row.dispatch_recorded) { this.db.exec("COMMIT"); return { status: "dispatch_recorded", reconciliationNeeded: true, providerDispatchId: row.provider_dispatch_id, claimGeneration: row.claim_generation }; }
      if (row.lease_expires_at > current) { this.db.exec("COMMIT"); return { status: "lease_active", currentGeneration: row.claim_generation, leaseExpiresAt: row.lease_expires_at }; }
      const generation = row.claim_generation + 1;
      this.db.prepare("UPDATE durable_job_claims SET owner_id=?, lease_token=?, lease_expires_at=?, claim_generation=?, updated_at=? WHERE request_id=? AND candidate_index=? AND claim_generation=? AND dispatch_recorded=0")
        .run(input.ownerId, input.leaseToken, expires, generation, current, input.requestId, input.candidateIndex, row.claim_generation);
      this.db.exec("COMMIT"); return { status: "claimed", ...keyFromInput(input, generation), takeover: true };
    } catch (error) { try { this.db.exec("ROLLBACK"); } catch {} throw error; }
  }

  /**
   * Durably records the provider-send intent before the provider call. The
   * returned `recorded` state authorizes exactly one send; it is not a provider
   * receipt. Replays and lost responses return reconciliation-needed state.
   */
  recordDispatch(key: DurableJobClaimKey, providerDispatchId: string, nowMs?: number): FencedResult {
    let current: number;
    try { text(providerDispatchId, "providerDispatchId"); text(key.requestId, "requestId"); text(key.executionId, "executionId"); text(key.ownerId, "ownerId"); text(key.leaseToken, "leaseToken"); index(key.candidateIndex); if (!Number.isSafeInteger(key.claimGeneration) || key.claimGeneration < 1) throw new Error("claimGeneration must be a positive safe integer"); current = now(nowMs); }
    catch (error) { return { status: "invalid", message: error instanceof Error ? error.message : String(error) }; }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT * FROM durable_job_claims WHERE request_id=? AND candidate_index=?").get(key.requestId, key.candidateIndex) as Row | undefined;
      if (!row) { this.db.exec("COMMIT"); return { status: "not_found" }; }
      if (row.execution_id !== key.executionId) { this.db.exec("COMMIT"); return { status: "execution_id_conflict", existingExecutionId: row.execution_id }; }
      if (row.dispatch_recorded) { this.db.exec("COMMIT"); return { status: "dispatch_recorded", reconciliationNeeded: true, providerDispatchId: row.provider_dispatch_id ?? providerDispatchId, claimGeneration: row.claim_generation }; }
      if (row.claim_generation !== key.claimGeneration || row.owner_id !== key.ownerId || row.lease_token !== key.leaseToken) { this.db.exec("COMMIT"); return { status: "stale_fence", currentGeneration: row.claim_generation }; }
      if (row.lease_expires_at <= current) { this.db.exec("COMMIT"); return { status: "lease_expired" }; }
      this.db.prepare("UPDATE durable_job_claims SET dispatch_recorded=1, provider_dispatch_id=?, updated_at=? WHERE request_id=? AND candidate_index=? AND claim_generation=? AND owner_id=? AND lease_token=? AND dispatch_recorded=0")
        .run(providerDispatchId, current, key.requestId, key.candidateIndex, key.claimGeneration, key.ownerId, key.leaseToken);
      this.db.exec("COMMIT"); return { status: "recorded", providerDispatchId, claimGeneration: key.claimGeneration };
    } catch (error) { try { this.db.exec("ROLLBACK"); } catch {} throw error; }
  }
}

export function createDurableJobClaimStore(db: SqliteDatabase): DurableJobClaimStore { return new DurableJobClaimStore(db); }
