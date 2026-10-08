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
