import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildSourceMetadata, sanitizeSourceReadback, sourceTelemetryMetadata } from '../supabase/functions/_shared/sourceReadback.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const validSource = {
  sourceWorkspace: 'patterns',
  workflowVersion: 'pattern-preview-local-v1',
  sourceLabel: '柄・グラフィック',
  sourceResumePath: '/patterns/workbench',
  sourceMode: 'local-workflow-intake',
};

test('source readback sanitizer accepts only known workspace contracts', () => {
  assert.deepEqual(sanitizeSourceReadback(validSource), validSource);
  assert.deepEqual(sanitizeSourceReadback({ ...validSource, sourceResumePath: '/patterns' }), {
    ...validSource,
    sourceResumePath: '/patterns',
  });
  assert.equal(sanitizeSourceReadback({ ...validSource, sourceLabel: 'spoofed' }), null);
  assert.equal(sanitizeSourceReadback({ ...validSource, workflowVersion: 'invented-v1' }), null);
  assert.equal(sanitizeSourceReadback({ ...validSource, sourceWorkspace: 'unknown' }), null);
});

test('Lightchain marketing and fitting source contracts survive shared Edge metadata sanitization', () => {
  const lightchainSources = [
    {
      sourceWorkspace: 'marketing',
      workflowVersion: 'marketing-brief-local-v1',
      sourceLabel: 'マーケティングワークスペース',
      sourceResumePath: '/marketing',
      sourceMode: 'local-workflow-intake',
    },
    {
      sourceWorkspace: 'fitting',
      workflowVersion: 'fitting-brief-local-v1',
      sourceLabel: 'AIフィッティング',
      sourceResumePath: '/fitting',
      sourceMode: 'local-workflow-intake',
    },
  ] as const;

  for (const source of lightchainSources) {
    assert.deepEqual(sanitizeSourceReadback(source), source);
    assert.deepEqual(buildSourceMetadata(source), source);
  }
});

test('generation intent is persisted only when it matches the sanitized source', () => {
  const intent = {
    feature: 'design-gacha',
    prompt: 'safe prompt',
    href: '/generate?feature=design-gacha',
    label: '柄・グラフィックで生成',
    ...validSource,
    aspectRatio: '1:1',
  };
  const result = buildSourceMetadata(validSource, intent);
  assert.equal(result?.sourceWorkspace, 'patterns');
  assert.deepEqual(result?.generationIntent, intent);
  assert.deepEqual(sourceTelemetryMetadata(result), {
    sourceWorkspace: 'patterns',
    workflowVersion: 'pattern-preview-local-v1',
  });
  const mismatched = buildSourceMetadata(validSource, { ...intent, sourceWorkspace: 'studio' });
  assert.equal(mismatched?.generationIntent, undefined);
  assert.deepEqual(sourceTelemetryMetadata({ sourceWorkspace: 'spoofed', workflowVersion: 'unknown' }), {});
});

test('Canvas handoff and derived actions carry source readback into Edge Functions', () => {
  const generatePage = read('src/pages/GeneratePage.tsx');
  const canvasPage = read('src/pages/CanvasEditorPage.tsx');
  assert.match(generatePage, /sourceReadback,\n\s+sourceWorkspace:/);
  assert.match(canvasPage, /const sourceReadback = image\.sourceReadback/);
  assert.match(canvasPage, /\.\.\.\(sourceReadback \? \{ sourceReadback/);
  assert.match(canvasPage, /\.\.\.\(sourceReadback \? \{ sourceReadback \} : \{\}\)/);
  assert.match(canvasPage, /\.\.\.\(generationIntent \? \{ generationIntent \} : \{\}\)/);
});

test('all Canvas-derived generation Edge Functions persist source metadata and durable step attribution', () => {
  const functionPaths = [
    'edit-image',
    'remove-background',
    'colorize',
    'upscale',
    'generate-variations',
  ];
  for (const functionName of functionPaths) {
    const source = read(`supabase/functions/${functionName}/index.ts`);
    assert.match(source, /_shared\/sourceReadback\.ts/);
    assert.match(source, /buildSourceMetadata\(sourceReadback, generationIntent\)/);
    assert.match(source, /\.\.\.\(sourceMetadata \?\? \{\}\)/);
    assert.match(source, /sourceMetadata[,)]/);
  }
});

test('Lightchain generation lanes accept the marketing and fitting source contracts', () => {
  const generateImage = read('supabase/functions/generate-image/index.ts');
  const modelMatrix = read('supabase/functions/model-matrix/index.ts');
  const collector = read('scripts/collect-workspace-live-readback.mjs');
  const verifier = read('scripts/verify-workspace-generation-readback.mjs');

  for (const source of ['marketing-brief-local-v1', 'fitting-brief-local-v1']) {
    assert.match(generateImage, new RegExp(source));
    assert.match(verifier, new RegExp(source));
  }
  assert.match(modelMatrix, /fitting-brief-local-v1/);
  assert.match(collector, /'models', 'marketing', 'fitting'/);
  for (const source of ['edit-image', 'generate-variations', 'remove-background', 'upscale', 'colorize']) {
    assert.match(read(`supabase/functions/${source}/index.ts`), /sourceTelemetryMetadata/);
  }
  assert.match(generateImage, /sourceTelemetryMetadata\(sourceMetadata\)/);
  assert.match(modelMatrix, /sourceTelemetryMetadata\(requestSourceMetadata\)/);
  assert.match(read('supabase/functions/design-gacha/index.ts'), /sourceTelemetryMetadata/);
});
