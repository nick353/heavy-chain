import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const pagePaths = [
  '../src/pages/FashionStudioPage.tsx',
  '../src/pages/VideoWorkstationPage.tsx',
  '../src/pages/LabPage.tsx',
  '../src/pages/PatternWorkspacePage.tsx',
];

test('Lightchain parity workspaces expose the same staged readiness entry', async () => {
  const sources = await Promise.all(pagePaths.map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const source of sources) {
    assert.match(source, /WorkspaceReadinessStrip/);
    assert.match(source, /data-testid="[a-z-]+-readiness-entry"/);
    assert.match(source, /nextAction=/);
    assert.match(source, /steps=\{\[/);
  }
});

test('readiness strip keeps the four-step contract and actionable handoff language', async () => {
  const source = await readFile(new URL('../src/components/workspace/WorkspaceReadinessStrip.tsx', import.meta.url), 'utf8');
  assert.match(source, /data-testid="workspace-readiness-strip"/);
  assert.match(source, /data-testid="workspace-readiness-step"/);
  assert.match(source, /ArrowRight/);
  assert.match(source, /nextAction/);
});
