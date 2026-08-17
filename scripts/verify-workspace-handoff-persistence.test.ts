import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Workspace-to-Canvas handoff fails closed before Canvas promotion when artifact persistence is unverified', async () => {
  const source = await readFile(new URL('../src/lib/workspaceHandoff.ts', import.meta.url), 'utf8');
  assert.match(source, /saveWorkspaceArtifactPersisted/);
  assert.match(source, /deleteWorkspaceArtifactsPersisted\(input\.brandId, \[artifactId\], input\.scopeId\)/);
  assert.match(source, /canvasStore\.deleteProject\(projectId\)/);
  assert.doesNotMatch(source, /saveWorkspaceArtifact\(/);

  const saveCall = source.indexOf('const persisted = saveWorkspaceArtifactPersisted');
  const failureGate = source.indexOf('if (!persisted.ok)');
  const artifactPromotion = source.indexOf('const artifact = persisted.artifact');
  assert.ok(saveCall >= 0);
  assert.ok(failureGate > saveCall);
  assert.ok(artifactPromotion > failureGate);
});

test('Workspace-to-Canvas callers surface persistence failures without navigating or claiming success', async () => {
  const pagePaths = [
    '../src/pages/LabPage.tsx',
    '../src/pages/FashionStudioPage.tsx',
    '../src/pages/VideoWorkstationPage.tsx',
    '../src/pages/PatternWorkspacePage.tsx',
    '../src/pages/ModelLibraryPage.tsx',
  ];
  const sources = await Promise.all(pagePaths.map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const source of sources) {
    const handoff = source.indexOf('handoffWorkspaceToCanvas({');
    const success = source.indexOf('toast.success', handoff);
    const navigation = source.indexOf('navigate(`/canvas/${projectId}`)', handoff);
    const catchBlock = source.indexOf('} catch (error)', handoff);
    assert.ok(handoff >= 0);
    assert.ok(catchBlock > handoff);
    assert.ok(success > handoff);
    assert.ok(navigation > success);
    assert.ok(source.indexOf('toast.error(message)', catchBlock) > catchBlock);
  }
});
