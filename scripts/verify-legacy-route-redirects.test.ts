import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLegacyLocation, resolveLegacyToolLocation } from '../src/lib/heavyWorkspace.ts';

test('old /lightchain and /heavy tool URLs land on the Light-shaped page', () => {
  const cases: Array<[string, string]> = [
    ['fabric-image', '/tools/fabric'],
    ['printing-image', '/tools/printing'],
    ['line-to-real', '/tools/line-draft-to-tile'],
    ['line-generation', '/tools/line'],
    ['marketing', '/marketing'],
    ['marketing-detail', '/marketing/detail'],
    ['model', '/model'],
    ['studio', '/flow/integration'],
    ['lab', '/flow/laboratory'],
    ['design-agent', '/agent'],
    ['print-design-detail', '/editor/patternDesign/detail'],
    ['image-repair', '/tools/reactor'],
    ['no-such-tool', '/dashboard'],
  ];
  for (const [toolId, pathname] of cases) {
    assert.equal(resolveLegacyToolLocation(toolId, '', '').pathname, pathname, toolId);
  }
});

test('redirects keep the incoming query and hash', () => {
  assert.deepEqual(resolveLegacyToolLocation('printing-image', '?handoff=patterns', '#x'), {
    pathname: '/tools/printing', search: '?handoff=patterns', hash: '#x',
  });
  const reference = resolveLegacyToolLocation('ai-fitting-reference', '?a=1', '');
  assert.equal(reference.pathname, '/model');
  assert.equal(new URLSearchParams(reference.search).get('tab'), '参考図');
  assert.equal(new URLSearchParams(reference.search).get('a'), '1');
  assert.equal(new URLSearchParams(resolveLegacyToolLocation('model-library', '', '').search).get('workspaceFeature'), 'model-library');
  assert.deepEqual(mergeLegacyLocation('/designProduction', '?feature=chat-edit', ''), {
    pathname: '/designProduction', search: '?feature=chat-edit', hash: '',
  });
});

test('heavychain.app counts as the Heavy runtime, so every signed-in screen gets the Light frame', async () => {
  const { isHeavyWorkspaceRuntime } = await import('../src/lib/heavyWorkspace.ts');
  const original = (globalThis as { window?: unknown }).window;
  try {
    for (const [hostname, expected] of [['heavychain.app', true], ['www.heavychain.app', true], ['heavy-chain-zeabur.zeabur.app', true], ['example.com', false]] as const) {
      (globalThis as { window?: unknown }).window = { location: { hostname, pathname: '/brand/settings' } };
      assert.equal(isHeavyWorkspaceRuntime(), expected, hostname);
    }
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
});
