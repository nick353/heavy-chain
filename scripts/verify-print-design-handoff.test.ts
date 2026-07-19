import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRINT_DESIGN_HANDOFF_STORAGE_KEY,
  PRINT_DESIGN_HANDOFF_MAX_AGE_MS,
  PRINT_DESIGN_HANDOFF_MAX_LABEL_LENGTH,
  PRINT_DESIGN_HANDOFF_MAX_PROMPT_LENGTH,
  acknowledgePrintDesignHandoff,
  createTrustedPatternsResultProvenance,
  createTrustedBlankGarmentSelection,
  isPrintDesignHandoffAlreadyImported,
  readPrintDesignHandoff,
  resolveCompletedPatternsResultProvenance,
  normalizePrintDesignHandoffDisplayText,
  writePrintDesignHandoff,
} from '../src/features/printing/selection/printDesignHandoff.ts';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const validInput = {
  brandId: 'brand-1',
  resultProvenance: {
    generationLane: 'hosted-gemini',
    originFeature: 'design-gacha',
    sourceWorkspace: 'patterns',
    workflowVersion: 'pattern-preview-local-v1',
    sourceResumePath: '/patterns/workbench',
    sourceMode: 'local-workflow-intake',
    generationStartedAt: 1_800_000_000_000,
  },
  artifactKind: 'image',
  imageUrl: 'https://assets.example.com/generated/design.png?token=signed',
  label: 'Design A',
  prompt: 'isolated chain graphic',
  resultId: 'result-1',
  jobId: 'job-1',
  imageId: 'image-1',
  storagePath: 'brand-1/design-a.png',
};

test('trusted blank garment is an explicit bundled asset, not inferred gallery metadata', () => {
  assert.deepEqual(createTrustedBlankGarmentSelection(), {
    url: '/assets/printing/blank-white-tshirt.svg',
    referenceType: 'base',
  });
});

test('a design-gacha image handoff is read non-destructively and removed only after explicit ack', () => {
  const storage = new MemoryStorage();
  const now = 1_800_000_000_000;
  assert.deepEqual(writePrintDesignHandoff(storage, validInput, now), { ok: true });
  const accepted = readPrintDesignHandoff(storage, 'brand-1', now + 1_000);
  assert.equal(accepted.status, 'accepted');
  if (accepted.status === 'accepted') {
    assert.equal(accepted.design.imageUrl, validInput.imageUrl);
    assert.equal(accepted.design.jobId, 'job-1');
    assert.ok(storage.getItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY));
    assert.deepEqual(acknowledgePrintDesignHandoff(
      storage,
      accepted.ackToken,
      'import_committed',
    ), { ok: true });
  }
  assert.deepEqual(readPrintDesignHandoff(storage, 'brand-1', now + 2_000), {
    status: 'empty',
    reason: 'missing',
  });
});

test('brand readiness and mismatch defer without removing, then the matching brand succeeds', () => {
  const storage = new MemoryStorage();
  const now = 1_800_000_000_000;
  assert.deepEqual(writePrintDesignHandoff(storage, validInput, now), { ok: true });
  assert.deepEqual(readPrintDesignHandoff(storage, null, now + 1_000), {
    status: 'deferred',
    reason: 'brand_not_ready',
  });
  assert.deepEqual(readPrintDesignHandoff(storage, 'brand-2', now + 1_000), {
    status: 'deferred',
    reason: 'brand_mismatch',
  });
  assert.ok(storage.getItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY));
  assert.equal(readPrintDesignHandoff(storage, 'brand-1', now + 1_000).status, 'accepted');
});

test('an import failure retains the accepted payload for retry', () => {
  const storage = new MemoryStorage();
  const now = 1_800_000_000_000;
  assert.deepEqual(writePrintDesignHandoff(storage, validInput, now), { ok: true });
  const accepted = readPrintDesignHandoff(storage, 'brand-1', now + 1_000);
  assert.equal(accepted.status, 'accepted');
  const simulatedImportResult = { ok: false, reason: 'design_limit_exceeded' };
  assert.equal(simulatedImportResult.ok, false);
  assert.ok(storage.getItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY));
  assert.equal(readPrintDesignHandoff(storage, 'brand-1', now + 2_000).status, 'accepted');
});

test('duplicate detection uses the accepted handoff URL and ack cannot delete a replacement payload', () => {
  const storage = new MemoryStorage();
  const now = 1_800_000_000_000;
  assert.deepEqual(writePrintDesignHandoff(storage, validInput, now), { ok: true });
  const accepted = readPrintDesignHandoff(storage, 'brand-1', now + 1_000);
  assert.equal(accepted.status, 'accepted');
  if (accepted.status !== 'accepted') return;
  assert.equal(isPrintDesignHandoffAlreadyImported([], accepted), false);
  assert.equal(isPrintDesignHandoffAlreadyImported([{ url: validInput.imageUrl }], accepted), true);

  assert.deepEqual(writePrintDesignHandoff(storage, {
    ...validInput,
    imageUrl: 'https://assets.example.com/generated/replacement.png?token=signed',
    resultId: 'result-2',
    imageId: 'image-2',
  }, now + 2_000), { ok: true });
  assert.deepEqual(acknowledgePrintDesignHandoff(storage, accepted.ackToken, 'import_committed'), {
    ok: false,
    reason: 'payload_changed',
  });
  assert.match(storage.getItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY) ?? '', /replacement\.png/);
});

test('Patterns bounds display-only text before the strict handoff validator', () => {
  const storage = new MemoryStorage();
  const now = 1_800_000_000_000;
  const longLabel = 'L'.repeat(PRINT_DESIGN_HANDOFF_MAX_LABEL_LENGTH + 40);
  const longPrompt = 'P'.repeat(PRINT_DESIGN_HANDOFF_MAX_PROMPT_LENGTH + 4_000);
  assert.deepEqual(writePrintDesignHandoff(storage, {
    ...validInput,
    label: normalizePrintDesignHandoffDisplayText(longLabel, PRINT_DESIGN_HANDOFF_MAX_LABEL_LENGTH),
    prompt: normalizePrintDesignHandoffDisplayText(longPrompt, PRINT_DESIGN_HANDOFF_MAX_PROMPT_LENGTH),
  }, now), { ok: true });
  const accepted = readPrintDesignHandoff(storage, 'brand-1', now + 1_000);
  assert.equal(accepted.status, 'accepted');
  if (accepted.status === 'accepted') {
    assert.equal(accepted.design.label.length, PRINT_DESIGN_HANDOFF_MAX_LABEL_LENGTH);
    assert.equal(accepted.design.prompt.length, PRINT_DESIGN_HANDOFF_MAX_PROMPT_LENGTH);
  }
});

test('emitter rejects non-Patterns origins, planning briefs, inline URLs, and untracked results', () => {
  const storage = new MemoryStorage();
  assert.deepEqual(writePrintDesignHandoff(storage, {
    ...validInput,
    resultProvenance: { ...validInput.resultProvenance, originFeature: 'campaign-image' },
  }), {
    ok: false,
    reason: 'origin_invalid',
  });
  assert.deepEqual(writePrintDesignHandoff(storage, {
    ...validInput,
    resultProvenance: { ...validInput.resultProvenance, workflowVersion: 'invented-v1' },
  }), {
    ok: false,
    reason: 'origin_invalid',
  });
  assert.deepEqual(writePrintDesignHandoff(storage, { ...validInput, artifactKind: 'planning_brief' }), {
    ok: false,
    reason: 'artifact_invalid',
  });
  assert.deepEqual(writePrintDesignHandoff(storage, { ...validInput, imageUrl: 'data:image/png;base64,AAAA' }), {
    ok: false,
    reason: 'image_url_invalid',
  });
  assert.deepEqual(writePrintDesignHandoff(storage, {
    ...validInput,
    imageId: undefined,
    storagePath: undefined,
  }), {
    ok: false,
    reason: 'generated_asset_identity_missing',
  });
  assert.equal(storage.getItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY), null);
});

test('a failed write removes any older valid handoff before returning', () => {
  const storage = new MemoryStorage();
  assert.deepEqual(writePrintDesignHandoff(storage, validInput), { ok: true });
  assert.ok(storage.getItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY));
  assert.deepEqual(writePrintDesignHandoff(storage, {
    ...validInput,
    resultProvenance: { ...validInput.resultProvenance, originFeature: 'campaign-image' },
  }), {
    ok: false,
    reason: 'origin_invalid',
  });
  assert.equal(storage.getItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY), null);
});

test('a delayed result loses provenance after navigation to another feature or source', () => {
  const sourceReadback = {
    sourceWorkspace: 'patterns',
    workflowVersion: 'pattern-preview-local-v1',
    sourceResumePath: '/patterns/workbench',
    sourceMode: 'local-workflow-intake',
  };
  const startedProvenance = createTrustedPatternsResultProvenance({
    featureId: 'design-gacha',
    sourceReadback,
    generationStartedAt: 1_800_000_000_000,
    generationLane: 'hosted-gemini',
  });
  assert.ok(startedProvenance);
  assert.equal(resolveCompletedPatternsResultProvenance({
    startedProvenance,
    currentFeatureId: 'campaign-image',
    currentSourceReadback: sourceReadback,
  }), undefined);
  assert.equal(resolveCompletedPatternsResultProvenance({
    startedProvenance,
    currentFeatureId: 'design-gacha',
    currentSourceReadback: { ...sourceReadback, sourceWorkspace: 'studio' },
  }), undefined);
  assert.equal(resolveCompletedPatternsResultProvenance({
    startedProvenance,
    currentFeatureId: 'design-gacha',
    currentSourceReadback: sourceReadback,
  }), startedProvenance);
});

test('only hosted Gemini and sanitized Edge lanes can create result provenance', () => {
  const sourceReadback = {
    sourceWorkspace: 'patterns',
    workflowVersion: 'pattern-preview-local-v1',
    sourceResumePath: '/patterns/workbench',
    sourceMode: 'local-workflow-intake',
  };
  for (const generationLane of ['hosted-gemini', 'edge-design-gacha'] as const) {
    assert.equal(createTrustedPatternsResultProvenance({
      featureId: 'design-gacha',
      sourceReadback,
      generationStartedAt: 1_800_000_000_000,
      generationLane,
    })?.generationLane, generationLane);
  }
  for (const generationLane of ['local-runway-worker', 'manual-import', 'planning', undefined]) {
    assert.equal(createTrustedPatternsResultProvenance({
      featureId: 'design-gacha',
      sourceReadback,
      generationStartedAt: 1_800_000_000_000,
      generationLane,
    }), undefined);
  }
});

test('navigation during signed URL materialization prevents the completed result stamp', async () => {
  const trustedSource = {
    sourceWorkspace: 'patterns',
    workflowVersion: 'pattern-preview-local-v1',
    sourceResumePath: '/patterns/workbench',
    sourceMode: 'local-workflow-intake',
  };
  const startedProvenance = createTrustedPatternsResultProvenance({
    featureId: 'design-gacha',
    sourceReadback: trustedSource,
    generationStartedAt: 1_800_000_000_000,
    generationLane: 'edge-design-gacha',
  });
  let currentContext: { featureId: string; sourceReadback: unknown } = {
    featureId: 'design-gacha',
    sourceReadback: trustedSource,
  };
  const signedUrlMaterialization = Promise.resolve().then(() => {
    currentContext = { featureId: 'campaign-image', sourceReadback: null };
    return 'https://assets.example.com/generated/materialized.png?token=signed';
  });
  assert.match(await signedUrlMaterialization, /^https:/);
  assert.equal(resolveCompletedPatternsResultProvenance({
    startedProvenance,
    currentFeatureId: currentContext.featureId,
    currentSourceReadback: currentContext.sourceReadback,
  }), undefined);
});

test('terminal rejected payloads require an explicit reason before removal', () => {
  const now = 1_800_000_000_000;
  for (const [name, mutate, expectedReason] of [
    ['stale', (value: any) => ({ ...value, createdAt: now - PRINT_DESIGN_HANDOFF_MAX_AGE_MS - 1 }), 'stale'],
    ['origin', (value: any) => ({ ...value, workflowVersion: 'invented-v1' }), 'origin_invalid'],
  ] as const) {
    const storage = new MemoryStorage();
    assert.deepEqual(writePrintDesignHandoff(storage, validInput, now), { ok: true });
    const raw = storage.getItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY);
    assert.ok(raw, name);
    storage.setItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY, JSON.stringify(mutate(JSON.parse(raw))));
    const rejected = readPrintDesignHandoff(storage, 'brand-1', now);
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.reason, expectedReason);
    assert.ok(storage.getItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY));
    if (rejected.status !== 'rejected' || !rejected.ackToken) continue;
    assert.deepEqual(acknowledgePrintDesignHandoff(storage, rejected.ackToken, ''), {
      ok: false,
      reason: 'ack_reason_missing',
    });
    assert.deepEqual(acknowledgePrintDesignHandoff(
      storage,
      rejected.ackToken,
      `rejected:${expectedReason}`,
    ), { ok: true });
    assert.equal(storage.getItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY), null);
  }

  const oversizedStorage = new MemoryStorage();
  oversizedStorage.setItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY, 'x'.repeat(20_000));
  const oversized = readPrintDesignHandoff(oversizedStorage, 'brand-1', now);
  assert.equal(oversized.status, 'rejected');
  assert.equal(oversized.reason, 'payload_oversized');
  assert.ok(oversizedStorage.getItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY));
  if (oversized.status === 'rejected' && oversized.ackToken) {
    assert.deepEqual(acknowledgePrintDesignHandoff(
      oversizedStorage,
      oversized.ackToken,
      'rejected:payload_oversized',
    ), { ok: true });
  }
  assert.equal(oversizedStorage.getItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY), null);
});
