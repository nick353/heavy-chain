import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildSourceMetadata, sanitizeSourceReadback } from '../supabase/functions/_shared/sourceReadback.ts';

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
  const mismatched = buildSourceMetadata(validSource, { ...intent, sourceWorkspace: 'studio' });
  assert.equal(mismatched?.generationIntent, undefined);
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
