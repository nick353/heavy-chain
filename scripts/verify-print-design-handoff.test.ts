import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRINT_DESIGN_HANDOFF_STORAGE_KEY,
  PRINT_DESIGN_HANDOFF_MAX_AGE_MS,
  PRINT_DESIGN_HANDOFF_MAX_LABEL_LENGTH,
  PRINT_DESIGN_HANDOFF_MAX_PROMPT_LENGTH,
  consumePrintDesignHandoff,
  createTrustedPatternsResultProvenance,
  createTrustedBlankGarmentSelection,
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

test('a design-gacha image handoff is brand-bound and consumed only once', () => {
  const storage = new MemoryStorage();
  const now = 1_800_000_000_000;
  assert.deepEqual(writePrintDesignHandoff(storage, validInput, now), { ok: true });
  const accepted = consumePrintDesignHandoff(storage, 'brand-1', now + 1_000);
  assert.equal(accepted.status, 'accepted');
  if (accepted.status === 'accepted') {
    assert.equal(accepted.design.imageUrl, validInput.imageUrl);
    assert.equal(accepted.design.jobId, 'job-1');
  }
  assert.deepEqual(consumePrintDesignHandoff(storage, 'brand-1', now + 2_000), {
    status: 'empty',
    reason: 'missing',
  });
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
  const accepted = consumePrintDesignHandoff(storage, 'brand-1', now + 1_000);
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

test('consumer rejects and removes brand mismatch, stale, tampered origin, and oversized payloads', () => {
  const now = 1_800_000_000_000;
  for (const [name, mutate, expectedReason] of [
    ['brand mismatch', (value: any) => value, 'brand_mismatch'],
    ['stale', (value: any) => ({ ...value, createdAt: now - PRINT_DESIGN_HANDOFF_MAX_AGE_MS - 1 }), 'stale'],
    ['origin', (value: any) => ({ ...value, workflowVersion: 'invented-v1' }), 'origin_invalid'],
  ] as const) {
    const storage = new MemoryStorage();
    assert.deepEqual(writePrintDesignHandoff(storage, validInput, now), { ok: true });
    const raw = storage.getItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY);
    assert.ok(raw, name);
    storage.setItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY, JSON.stringify(mutate(JSON.parse(raw))));
    const brand = name === 'brand mismatch' ? 'brand-2' : 'brand-1';
    assert.deepEqual(consumePrintDesignHandoff(storage, brand, now), {
      status: 'rejected',
      reason: expectedReason,
    });
    assert.equal(storage.getItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY), null);
  }

  const oversizedStorage = new MemoryStorage();
  oversizedStorage.setItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY, 'x'.repeat(20_000));
  assert.deepEqual(consumePrintDesignHandoff(oversizedStorage, 'brand-1', now), {
    status: 'rejected',
    reason: 'payload_oversized',
  });
  assert.equal(oversizedStorage.getItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY), null);
});
