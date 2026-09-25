import assert from 'node:assert/strict';
import test from 'node:test';
import { compareRouteReadback, compareRouteReadbackFiles } from './compare-lightchain-route-readbacks.mjs';

const equalReadback = {
  schema: 'fixture.v1',
  route: '/fixture',
  waitSeconds: 30,
  source: {
    title: 'Lightchain AI',
    readyState: 'complete',
    semanticText: 'same',
    semanticTextChars: 4,
    controlCount: 5,
    rightsCheckboxCount: 0,
    loginPromptCount: 0,
    authCallbackCount: 0,
  },
  heavy: {
    title: 'Lightchain AI',
    readyState: 'complete',
    semanticText: 'same',
    semanticTextChars: 4,
    controlCount: 5,
    rightsCheckboxCount: 0,
    loginPromptCount: 0,
    authCallbackCount: 0,
  },
  comparison: { pixelDiff: 'not_run' },
};

test('keeps exact semantic interaction parity separate from pixel and business gates', () => {
  const result = compareRouteReadback(equalReadback, '/tmp/equal.json');
  assert.equal(result.interactionStatus, 'equal');
  assert.equal(result.pixelStatus, 'not_computed');
  assert.equal(result.businessCompletion, 'unverified');
  assert.equal(result.safety.rightsUiAbsent, true);
  assert.equal(result.safety.loginUiAbsent, true);
});

test('reports authenticated control differences instead of hiding them', () => {
  const result = compareRouteReadback({
    ...equalReadback,
    source: { ...equalReadback.source, authenticated: true, avatarCount: 1 },
    heavy: { ...equalReadback.heavy, authenticated: true, controlCount: 6, avatarCount: 1 },
  });
  assert.equal(result.interactionStatus, 'different');
  assert.deepEqual(result.differences, [{ key: 'controlCount', source: 5, heavy: 6 }]);
});

test('holds one-sided authenticated captures for confirmation instead of calling them parity differences', () => {
  const result = compareRouteReadback({
    ...equalReadback,
    heavy: { ...equalReadback.heavy, authenticated: true, avatarCount: 1, controlCount: 6 },
  });
  assert.equal(result.interactionStatus, 'pending_confirmation');
  assert.equal(result.accountState.status, 'pending_confirmation');
  assert.match(result.accountState.reason ?? '', /same session/);
});

test('does not promote authenticated and anonymous captures to interaction parity', () => {
  const result = compareRouteReadback({
    ...equalReadback,
    source: { ...equalReadback.source, sourceAuthenticated: false, avatarCount: 0 },
    heavy: { ...equalReadback.heavy, authenticated: true, avatarCount: 1 },
  });
  assert.equal(result.interactionStatus, 'pending_confirmation');
  assert.equal(result.accountState.status, 'mismatch');
});

test('uses sourceBaseline aliases and leaves missing comparable data pending', () => {
  const result = compareRouteReadback({
    route: '/baseline',
    sourceBaseline: { title: 'Lightchain AI' },
    heavy: { title: 'Lightchain AI' },
  });
  assert.equal(result.interactionStatus, 'pending_confirmation');
  assert.equal(result.source.readyState, null);
  assert.equal(result.safety.rightsUiAbsent, null);
  assert.equal(result.safety.loginUiAbsent, null);
});

test('accepts the recorded heavyReadback alias used by video detail evidence', () => {
  const result = compareRouteReadback({
    route: '/flow/GenerateShortVideo/detail',
    sourceBaseline: { title: 'Lightchain AI', readyState: 'complete', semanticTextChars: 10 },
    heavyReadback: { title: 'Lightchain AI', readyState: 'complete', textChars: 10 },
  });
  assert.equal(result.interactionStatus, 'equal');
  assert.equal(result.heavy.title, 'Lightchain AI');
  assert.equal(result.heavy.textChars, 10);
});

test('file comparison is deterministic and deduplicates paths', async () => {
  const files = [
    'work/heavy-chain-source-heavy-laboratory-30s-20250925-r2.json',
    'work/heavy-chain-source-heavy-laboratory-30s-20250925-r2.json',
    'work/heavy-chain-source-heavy-pattern-design-30s-20250925-r2.json',
  ];
  const result = await compareRouteReadbackFiles(files);
  assert.equal(result.ok, true);
  assert.equal(result.deterministic, true);
  assert.equal(result.summary.total, 2);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.routes.map((route) => route.route), ['/flow/laboratory', '/editor/patternDesign']);
});

test('rejects multiple independent readbacks for the same route', async () => {
  const result = await compareRouteReadbackFiles([
    'work/heavy-chain-source-heavy-laboratory-30s-20250925-r2.json',
    'work/heavy-chain-source-heavy-laboratory-30s-20250925-r1.json',
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.duplicateRoutes, ['/flow/laboratory']);
  assert.match(result.errors.at(-1)?.error ?? '', /^duplicate_route:/);
});
