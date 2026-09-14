import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMigrationManifest,
  canonicalJson,
  classifySourceRecord,
  createMigrationJournal,
  decideMigrationRerun,
  hashCanonicalJson,
  hashMigrationJournal,
  type MigrationCheckpoint,
  type MigrationManifestEntry,
  type SourceMigrationRecord,
} from "../src/migration.ts";

const HASH = "a".repeat(64);
const CHANGED_HASH = "b".repeat(64);

function record(
  sourceKey: string,
  environmentEvidence: SourceMigrationRecord["environmentEvidence"],
): SourceMigrationRecord {
  return {
    sourceKey,
    bucket: "generated-images",
    objectPath: `${sourceKey}.png`,
    version: 1,
    contentType: "image/png",
    sizeBytes: 42,
    sha256: HASH,
    environmentEvidence,
  };
}

function entry(
  sourceKey: string,
  decision: "include" | "exclude" | "hold",
  recordHash = HASH,
): MigrationManifestEntry {
  const source = record(sourceKey, []);
  const classification = classifySourceRecord(source);
  return {
    sourceKey,
    record: source,
    recordHash,
    classification:
      decision === "include"
        ? {
            decision,
            reason: "affirmative_production_evidence",
            evidence: [{ environment: "production", source: "fixture" }],
          }
        : decision === "exclude"
          ? {
              decision,
              reason: "affirmative_test_evidence",
              evidence: [{ environment: "test", source: "fixture" }],
            }
          : classification,
  };
}

function checkpoint(
  sourceKey: string,
  state: MigrationCheckpoint["state"],
  recordHash = HASH,
): MigrationCheckpoint {
  return state === "failed"
    ? { sourceKey, recordHash, state, error: "fixture failure" }
    : { sourceKey, recordHash, state };
}

test("classifier includes only affirmative production evidence", () => {
  assert.equal(
    classifySourceRecord(record("prod", [{ environment: "production", source: "inventory" }]))
      .decision,
    "include",
  );
  assert.equal(
    classifySourceRecord(record("test", [{ environment: "test", source: "fixture" }])).decision,
    "exclude",
  );
});

test("missing, conflicting, and heuristic-only evidence are held", () => {
  assert.equal(classifySourceRecord(record("missing", [])).decision, "hold");
  assert.equal(
    classifySourceRecord(
      record("conflict", [
        { environment: "production", source: "inventory" },
        { environment: "test", source: "fixture" },
      ]),
    ).decision,
    "hold",
  );
  assert.equal(
    classifySourceRecord(record("test/path", [])).decision,
    "hold",
    "a test-looking path is not affirmative test evidence",
  );
});

test("canonical JSON sorts nested object keys, preserves arrays, and rejects unsafe values", async () => {
  assert.equal(
    canonicalJson({ z: 1, a: { d: 2, c: 3 }, list: [{ b: 2, a: 1 }, 0] }),
    '{"a":{"c":3,"d":2},"list":[{"a":1,"b":2},0],"z":1}',
  );
  assert.throws(() => canonicalJson({ value: undefined }));
  assert.throws(() => canonicalJson({ value: BigInt(1) }));
  assert.throws(() => canonicalJson({ value: Number.POSITIVE_INFINITY }));
  const sparse: number[] = [];
  sparse.length = 1;
  assert.throws(() => canonicalJson(sparse));

  const first = await hashCanonicalJson({ b: 2, a: 1 });
  const reordered = await hashCanonicalJson({ a: 1, b: 2 });
  const arrayReordered = await hashCanonicalJson({ a: [2, 1] });
  const arrayChanged = await hashCanonicalJson({ a: [1, 2] });
  assert.equal(first, reordered);
  assert.notEqual(arrayReordered, arrayChanged);
});

test("manifest sorting and hashing do not depend on input order", async () => {
  const first = await buildMigrationManifest([
    record("z", [{ environment: "production", source: "inventory" }]),
    record("a", [{ environment: "test", source: "fixture" }]),
  ]);
  const second = await buildMigrationManifest([
    record("a", [{ environment: "test", source: "fixture" }]),
    record("z", [{ environment: "production", source: "inventory" }]),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.manifest.status, "ready");
  assert.deepEqual(
    first.manifest.entries.map((item) => item.sourceKey),
    ["a", "z"],
  );
  assert.equal(first.manifest.hash, second.manifest.hash);
  assert.equal(first.manifest.entries[0]?.classification.decision, "exclude");
  assert.equal(first.manifest.excludeCount, 1);
  assert.equal(first.manifest.includeCount, 1);

  const changed = await buildMigrationManifest([
    { ...record("z", [{ environment: "production", source: "inventory" }]), sizeBytes: 43 },
    record("a", [{ environment: "test", source: "fixture" }]),
  ]);
  assert.equal(changed.ok, true);
  if (changed.ok) assert.notEqual(changed.manifest.hash, first.manifest.hash);
});

test("ambiguous records block the manifest while remaining auditable", async () => {
  const result = await buildMigrationManifest([
    record("prod", [{ environment: "production", source: "inventory" }]),
    record("unknown", []),
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.manifest.status, "blocked");
  assert.equal(result.manifest.holdCount, 1);
  assert.equal(result.manifest.issues[0]?.code, "ambiguous_source");
  assert.equal(result.manifest.entries.length, 2);
});

test("duplicate identity and invalid record hashes stop manifest construction", async () => {
  const duplicate = await buildMigrationManifest([
    record("same", [{ environment: "production", source: "one" }]),
    record("same", [{ environment: "production", source: "two" }]),
  ]);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.issues[0]?.code, "duplicate_source_key");

  const invalid = await buildMigrationManifest([
    { ...record("bad", [{ environment: "production", source: "inventory" }]), sha256: "bad" },
  ]);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.issues[0]?.code, "invalid_record");
});

test("journal is sorted, hash-stable, and preserves all four checkpoint states", async () => {
  const checkpoints = [
    checkpoint("z", "failed"),
    checkpoint("a", "pending"),
    checkpoint("y", "skipped"),
    checkpoint("b", "ready"),
  ];
  const journal = createMigrationJournal(checkpoints);
  const reorderedJournal = createMigrationJournal([...checkpoints].reverse());
  assert.deepEqual(
    journal.checkpoints.map((item) => item.sourceKey),
    ["a", "b", "y", "z"],
  );
  assert.deepEqual(
    new Set(journal.checkpoints.map((item) => item.state)),
    new Set(["pending", "ready", "skipped", "failed"]),
  );
  assert.equal(await hashMigrationJournal(journal), await hashMigrationJournal(reorderedJournal));
});

test("rerun decisions are conservative across checkpoint states and hash changes", () => {
  const included = entry("included", "include");
  assert.deepEqual(decideMigrationRerun(included), { action: "run", reason: "first_run" });
  assert.deepEqual(decideMigrationRerun(included, checkpoint("included", "ready")), {
    action: "skip",
    reason: "checkpoint_ready",
  });
  assert.deepEqual(decideMigrationRerun(included, checkpoint("included", "skipped")), {
    action: "skip",
    reason: "checkpoint_skipped",
  });
  assert.deepEqual(decideMigrationRerun(included, checkpoint("included", "failed")), {
    action: "run",
    reason: "previous_failed",
  });
  assert.deepEqual(decideMigrationRerun(included, checkpoint("included", "pending")), {
    action: "hold",
    reason: "pending_checkpoint",
  });

  const changed = entry("included", "include", CHANGED_HASH);
  assert.deepEqual(decideMigrationRerun(changed, checkpoint("included", "ready")), {
    action: "run",
    reason: "record_changed",
  });
  assert.deepEqual(decideMigrationRerun(changed, checkpoint("included", "pending")), {
    action: "hold",
    reason: "changed_record_pending",
  });
  assert.deepEqual(decideMigrationRerun(entry("test", "exclude"), checkpoint("test", "pending")), {
    action: "skip",
    reason: "affirmative_test_evidence",
  });
  assert.deepEqual(decideMigrationRerun(entry("unknown", "hold"), checkpoint("unknown", "ready")), {
    action: "hold",
    reason: "ambiguous_source",
  });
});
