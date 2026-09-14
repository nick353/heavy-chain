export const MIGRATION_MANIFEST_SCHEMA = "heavy-chain-source-migration.v1" as const;
export const MIGRATION_JOURNAL_SCHEMA = "heavy-chain-source-journal.v1" as const;

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export type MigrationEnvironment = "production" | "test";

export interface SourceEnvironmentEvidence {
  readonly environment: MigrationEnvironment;
  readonly source: string;
}

export interface SourceMigrationRecord {
  readonly sourceKey: string;
  readonly bucket: string;
  readonly objectPath: string;
  readonly version: number;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly environmentEvidence: readonly SourceEnvironmentEvidence[];
}

export type SourceClassification =
  | {
      readonly decision: "include";
      readonly reason: "affirmative_production_evidence";
      readonly evidence: readonly SourceEnvironmentEvidence[];
    }
  | {
      readonly decision: "exclude";
      readonly reason: "affirmative_test_evidence";
      readonly evidence: readonly SourceEnvironmentEvidence[];
    }
  | {
      readonly decision: "hold";
      readonly reason:
        | "missing_environment_evidence"
        | "conflicting_environment_evidence"
        | "invalid_environment_evidence";
      readonly evidence: readonly SourceEnvironmentEvidence[];
    };

export interface MigrationManifestEntry {
  readonly sourceKey: string;
  readonly record: SourceMigrationRecord;
  readonly recordHash: string;
  readonly classification: SourceClassification;
}

export interface MigrationManifestIssue {
  readonly code:
    | "duplicate_source_key"
    | "invalid_record"
    | "ambiguous_source";
  readonly sourceKey?: string;
  readonly reason?: string;
}

export interface MigrationManifest {
  readonly schema: typeof MIGRATION_MANIFEST_SCHEMA;
  readonly status: "ready" | "blocked";
  readonly entries: readonly MigrationManifestEntry[];
  readonly includeCount: number;
  readonly excludeCount: number;
  readonly holdCount: number;
  readonly issues: readonly MigrationManifestIssue[];
  readonly hash: string;
}

export type MigrationManifestResult =
  | { readonly ok: true; readonly manifest: MigrationManifest }
  | {
      readonly ok: false;
      readonly status: "invalid";
      readonly issues: readonly MigrationManifestIssue[];
    };

export type MigrationCheckpoint =
  | {
      readonly sourceKey: string;
      readonly recordHash: string;
      readonly state: "pending";
    }
  | {
      readonly sourceKey: string;
      readonly recordHash: string;
      readonly state: "ready";
    }
  | {
      readonly sourceKey: string;
      readonly recordHash: string;
      readonly state: "skipped";
    }
  | {
      readonly sourceKey: string;
      readonly recordHash: string;
      readonly state: "failed";
      readonly error: string;
    };

export interface MigrationJournal {
  readonly schema: typeof MIGRATION_JOURNAL_SCHEMA;
  readonly checkpoints: readonly MigrationCheckpoint[];
}

export type MigrationRunDecision =
  | {
      readonly action: "run";
      readonly reason: "first_run" | "previous_failed" | "record_changed";
    }
  | {
      readonly action: "skip";
      readonly reason:
        | "affirmative_test_evidence"
        | "checkpoint_ready"
        | "checkpoint_skipped";
    }
  | {
      readonly action: "hold";
      readonly reason:
        | "ambiguous_source"
        | "pending_checkpoint"
        | "changed_record_pending"
        | "checkpoint_mismatch";
    };

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseEvidence(value: unknown): {
  readonly valid: boolean;
  readonly evidence: readonly SourceEnvironmentEvidence[];
} {
  if (!Array.isArray(value)) return { valid: false, evidence: [] };

  const evidence: SourceEnvironmentEvidence[] = [];
  for (const item of value) {
    if (!isObject(item)) return { valid: false, evidence };
    const environment = item.environment;
    const source = item.source;
    if (
      (environment !== "production" && environment !== "test") ||
      !isNonEmptyString(source)
    ) {
      return { valid: false, evidence };
    }
    evidence.push({ environment, source: source.trim() });
  }

  const unique = new Map<string, SourceEnvironmentEvidence>();
  for (const item of evidence) {
    unique.set(`${item.environment}\u0000${item.source}`, item);
  }
  return {
    valid: true,
    evidence: [...unique.values()].sort((left, right) =>
      compareCodeUnits(
        `${left.environment}\u0000${left.source}`,
        `${right.environment}\u0000${right.source}`,
      ),
    ),
  };
}

function normalizeSourceRecord(value: unknown):
  | { readonly ok: true; readonly record: SourceMigrationRecord }
  | { readonly ok: false; readonly sourceKey?: string } {
  if (!isObject(value)) return { ok: false };

  const sourceKey = value.sourceKey;
  const bucket = value.bucket;
  const objectPath = value.objectPath;
  const version = value.version;
  const contentType = value.contentType;
  const sizeBytes = value.sizeBytes;
  const sha256 = value.sha256;
  const parsedEvidence = parseEvidence(value.environmentEvidence);

  if (
    !isNonEmptyString(sourceKey) ||
    !isNonEmptyString(bucket) ||
    !isNonEmptyString(objectPath) ||
    !isNonNegativeSafeInteger(version) ||
    !isNonEmptyString(contentType) ||
    !isNonNegativeSafeInteger(sizeBytes) ||
    typeof sha256 !== "string" ||
    !SHA256_PATTERN.test(sha256) ||
    !parsedEvidence.valid
  ) {
    return {
      ok: false,
      sourceKey: typeof sourceKey === "string" ? sourceKey : undefined,
    };
  }

  return {
    ok: true,
    record: {
      sourceKey,
      bucket,
      objectPath,
      version,
      contentType: contentType.trim().toLowerCase(),
      sizeBytes,
      sha256: sha256.toLowerCase(),
      environmentEvidence: parsedEvidence.evidence,
    },
  };
}

export function classifySourceRecord(record: SourceMigrationRecord): SourceClassification {
  const parsed = parseEvidence(record.environmentEvidence);
  if (!parsed.valid) {
    return {
      decision: "hold",
      reason: "invalid_environment_evidence",
      evidence: [],
    };
  }

  const hasProductionEvidence = parsed.evidence.some(
    (item) => item.environment === "production",
  );
  const hasTestEvidence = parsed.evidence.some((item) => item.environment === "test");

  if (hasProductionEvidence && hasTestEvidence) {
    return {
      decision: "hold",
      reason: "conflicting_environment_evidence",
      evidence: parsed.evidence,
    };
  }
  if (hasProductionEvidence) {
    return {
      decision: "include",
      reason: "affirmative_production_evidence",
      evidence: parsed.evidence,
    };
  }
  if (hasTestEvidence) {
    return {
      decision: "exclude",
      reason: "affirmative_test_evidence",
      evidence: parsed.evidence,
    };
  }
  return {
    decision: "hold",
    reason: "missing_environment_evidence",
    evidence: parsed.evidence,
  };
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value: unknown, parents: Set<object>): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        throw new TypeError("canonical JSON does not support non-finite numbers");
      }
      const serialized = JSON.stringify(value);
      if (typeof serialized !== "string") {
        throw new TypeError("canonical JSON could not serialize number");
      }
      return serialized;
    }
    case "undefined":
      throw new TypeError("canonical JSON does not support undefined");
    case "bigint":
      throw new TypeError("canonical JSON does not support bigint");
    case "function":
    case "symbol":
      throw new TypeError("canonical JSON does not support callable or symbol values");
  }

  if (parents.has(value)) throw new TypeError("canonical JSON does not support cycles");
  parents.add(value);

  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError("canonical JSON does not support sparse arrays");
        }
        items.push(canonicalize(value[index], parents));
      }
      return `[${items.join(",")}]`;
    }
    if (!isPlainObject(value)) {
      throw new TypeError("canonical JSON accepts only arrays and plain objects");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("canonical JSON does not support symbol keys");
    }

    const fields = Object.keys(value)
      .sort(compareCodeUnits)
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key], parents)}`);
    return `{${fields.join(",")}}`;
  } finally {
    parents.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set<object>());
}

export const stableCanonicalJson = canonicalJson;

export async function hashCanonicalJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const stableHash = hashCanonicalJson;

export async function buildMigrationManifest(
  records: readonly SourceMigrationRecord[],
): Promise<MigrationManifestResult> {
  if (!Array.isArray(records)) {
    return {
      ok: false,
      status: "invalid",
      issues: [{ code: "invalid_record", reason: "records_must_be_an_array" }],
    };
  }

  const normalized: SourceMigrationRecord[] = [];
  const validationIssues: MigrationManifestIssue[] = [];
  for (const candidate of records) {
    const result = normalizeSourceRecord(candidate);
    if (!result.ok) {
      validationIssues.push({
        code: "invalid_record",
        ...(result.sourceKey ? { sourceKey: result.sourceKey } : {}),
      });
      continue;
    }
    normalized.push(result.record);
  }

  const seen = new Set<string>();
  for (const record of normalized) {
    if (seen.has(record.sourceKey)) {
      validationIssues.push({
        code: "duplicate_source_key",
        sourceKey: record.sourceKey,
      });
    }
    seen.add(record.sourceKey);
  }
  if (validationIssues.length > 0) {
    return {
      ok: false,
      status: "invalid",
      issues: validationIssues.sort((left, right) => {
        const bySourceKey = compareCodeUnits(left.sourceKey ?? "", right.sourceKey ?? "");
        if (bySourceKey !== 0) return bySourceKey;
        const byCode = compareCodeUnits(left.code, right.code);
        return byCode !== 0
          ? byCode
          : compareCodeUnits(left.reason ?? "", right.reason ?? "");
      }),
    };
  }

  const ordered = [...normalized].sort((left, right) =>
    compareCodeUnits(left.sourceKey, right.sourceKey),
  );
  const entries = await Promise.all(
    ordered.map(async (record): Promise<MigrationManifestEntry> => ({
      sourceKey: record.sourceKey,
      record,
      recordHash: await hashCanonicalJson(record),
      classification: classifySourceRecord(record),
    })),
  );

  const holdEntries = entries.filter((entry) => entry.classification.decision === "hold");
  const manifestHash = await hashCanonicalJson({
    schema: MIGRATION_MANIFEST_SCHEMA,
    entries,
  });

  return {
    ok: true,
    manifest: {
      schema: MIGRATION_MANIFEST_SCHEMA,
      status: holdEntries.length === 0 ? "ready" : "blocked",
      entries,
      includeCount: entries.filter((entry) => entry.classification.decision === "include")
        .length,
      excludeCount: entries.filter((entry) => entry.classification.decision === "exclude")
        .length,
      holdCount: holdEntries.length,
      issues: holdEntries.map((entry) => ({
        code: "ambiguous_source" as const,
        sourceKey: entry.sourceKey,
        reason: entry.classification.reason,
      })),
      hash: manifestHash,
    },
  };
}

function isCheckpointState(value: unknown): value is MigrationCheckpoint["state"] {
  return value === "pending" || value === "ready" || value === "skipped" || value === "failed";
}

function normalizeCheckpoint(checkpoint: MigrationCheckpoint): MigrationCheckpoint {
  if (
    !isNonEmptyString(checkpoint.sourceKey) ||
    !SHA256_PATTERN.test(checkpoint.recordHash) ||
    !isCheckpointState(checkpoint.state)
  ) {
    throw new TypeError("checkpoint source key and record hash are invalid");
  }
  if (checkpoint.state === "failed" && !isNonEmptyString(checkpoint.error)) {
    throw new TypeError("failed checkpoint requires an error");
  }
  return checkpoint.state === "failed"
    ? {
        sourceKey: checkpoint.sourceKey,
        recordHash: checkpoint.recordHash.toLowerCase(),
        state: checkpoint.state,
        error: checkpoint.error,
      }
    : {
        sourceKey: checkpoint.sourceKey,
        recordHash: checkpoint.recordHash.toLowerCase(),
        state: checkpoint.state,
      };
}

export function createMigrationJournal(
  checkpoints: readonly MigrationCheckpoint[],
): MigrationJournal {
  const normalized = checkpoints.map(normalizeCheckpoint);
  const seen = new Set<string>();
  for (const checkpoint of normalized) {
    if (seen.has(checkpoint.sourceKey)) {
      throw new TypeError(`duplicate checkpoint source key: ${checkpoint.sourceKey}`);
    }
    seen.add(checkpoint.sourceKey);
  }
  return {
    schema: MIGRATION_JOURNAL_SCHEMA,
    checkpoints: normalized.sort((left, right) =>
      compareCodeUnits(left.sourceKey, right.sourceKey),
    ),
  };
}

export async function hashMigrationJournal(journal: MigrationJournal): Promise<string> {
  return hashCanonicalJson(journal);
}

export function decideMigrationRerun(
  entry: Pick<MigrationManifestEntry, "sourceKey" | "recordHash" | "classification">,
  checkpoint?: MigrationCheckpoint,
): MigrationRunDecision {
  if (entry.classification.decision === "exclude") {
    return { action: "skip", reason: "affirmative_test_evidence" };
  }
  if (entry.classification.decision === "hold") {
    return { action: "hold", reason: "ambiguous_source" };
  }

  if (!SHA256_PATTERN.test(entry.recordHash)) {
    return { action: "hold", reason: "checkpoint_mismatch" };
  }
  if (!checkpoint) return { action: "run", reason: "first_run" };
  if (
    checkpoint.sourceKey !== entry.sourceKey ||
    !isNonEmptyString(checkpoint.sourceKey) ||
    !SHA256_PATTERN.test(checkpoint.recordHash) ||
    !isCheckpointState(checkpoint.state) ||
    (checkpoint.state === "failed" && !isNonEmptyString(checkpoint.error))
  ) {
    return { action: "hold", reason: "checkpoint_mismatch" };
  }

  const sameRecord = checkpoint.recordHash.toLowerCase() === entry.recordHash.toLowerCase();
  if (checkpoint.state === "pending") {
    return {
      action: "hold",
      reason: sameRecord ? "pending_checkpoint" : "changed_record_pending",
    };
  }
  if (sameRecord && checkpoint.state === "ready") {
    return { action: "skip", reason: "checkpoint_ready" };
  }
  if (sameRecord && checkpoint.state === "skipped") {
    return { action: "skip", reason: "checkpoint_skipped" };
  }
  if (sameRecord && checkpoint.state === "failed") {
    return { action: "run", reason: "previous_failed" };
  }
  return { action: "run", reason: "record_changed" };
}
