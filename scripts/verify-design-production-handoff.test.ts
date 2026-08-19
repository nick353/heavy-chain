import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildSourceContextSummaryRows } from '../src/lib/sourceContextSummary.ts';

const handoffSource = await readFile(new URL('../src/lib/workspaceHandoff.ts', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');

test('design production proposal uses the canonical generation handoff', () => {
  assert.match(handoffSource, /'design-production': \{ label: 'デザインワークスペース', resumePath: '\/designProduction' \}/);
  assert.match(handoffSource, /'design-production': \['design-production-brief-local-v1'\]/);
  assert.match(pageSource, /buildGenerationIntentHref\(\{/);
  assert.match(pageSource, /feature: 'design-gacha'/);
  assert.match(pageSource, /sourceWorkspace: 'design-production'/);
  assert.match(pageSource, /workflowVersion: 'design-production-brief-local-v1'/);
  assert.match(pageSource, /onClick=\{openProposal\}/);
  assert.match(pageSource, /disabled=\{!dialoguePrompt\.trim\(\)\}/);
});

test('design production source summaries expose the handoff brief', () => {
  const rows = buildSourceContextSummaryRows({
    sourceWorkspace: 'design-production',
    generationIntent: {
      sourceWorkspace: 'design-production',
      workflowVersion: 'design-production-brief-local-v1',
      sourceLabel: 'デザインワークスペース',
      sourceResumePath: '/designProduction',
      sourceMode: 'local-workflow-intake',
      prompt: '春夏向けの軽い印象に整える',
    },
  });
  assert.deepEqual(rows.filter((row) => row.label === '依頼'), [
    { label: '依頼', value: '春夏向けの軽い印象に整える' },
  ]);
});
