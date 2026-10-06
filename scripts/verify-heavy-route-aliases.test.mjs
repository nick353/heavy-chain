import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('Heavy workbench normalizes human-facing route aliases to real catalog tools', async () => {
  const source = await readFile(new URL('src/lib/heavyWorkspace.ts', root), 'utf8');
  for (const [alias, target] of [
    ['marketing', 'marketing-home'],
    ['model', 'ai-fitting'],
    ['fitting', 'ai-fitting'],
    ['virtual-fitting', 'ai-fitting'],
    ['studio', 'fashion-studio'],
  ]) {
    const keyPattern = alias.includes('-') ? `'${alias}'` : alias;
    assert.match(source, new RegExp(`${keyPattern}: '${target}'`));
  }
  assert.match(source, /resolveHeavyWorkspaceToolId/);
});

test('Heavy runtime navigation never emits the legacy lightchain namespace', async () => {
  const [helper, workbench, handoff] = await Promise.all([
    readFile(new URL('src/lib/heavyWorkspace.ts', root), 'utf8'),
    readFile(new URL('src/pages/LightchainWorkbenchPage.tsx', root), 'utf8'),
    readFile(new URL('src/lib/workspaceHandoff.ts', root), 'utf8'),
  ]);
  assert.match(helper, /toHeavyWorkspacePath/);
  assert.match(workbench, /resolveWorkbenchToolHref/);
  assert.match(workbench, /toHeavyWorkspacePath\(resolveHeavyRouteForRow/);
  assert.match(handoff, /toHeavyWorkspacePath\(`\/lightchain/);
});

console.log('heavy-route-aliases: 2/2 passed');
