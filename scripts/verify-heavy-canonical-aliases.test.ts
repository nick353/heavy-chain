import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveHeavyCanonicalLocation, resolveHeavyWorkspaceToolId } from '../src/lib/heavyWorkspace.ts';

const canonicalAliases = [
  ['wear-design-lab', '/flow/orientedDesign'],
  ['wear-design-detail', '/flow/orientedDesign/detail'],
  ['model-library', '/model-library/model-custom-form'],
  ['model-custom', '/model-library/model-custom-form'],
  ['fashion-studio', '/flow/integration'],
  ['studio', '/flow/integration'],
  ['lab', '/flow/laboratory'],
  ['pattern-vector', '/tools/pattern-to-vector'],
  ['pattern-vector-pro', '/tools/vector-special'],
  ['printing-image', '/tools/printing'],
  ['model-face', '/model-library/head-form'],
  ['model-change', '/model-library/model-change-form'],
  ['body-shape', '/model-library/body-form'],
  ['clothing-size', '/model-library/size-form'],
  ['pose-change', '/model-library/pose-form'],
  ['background-change', '/model-library/background-form'],
  ['angle-change', '/model-library/perspective-form'],
] as const;

for (const [toolId, pathname] of canonicalAliases) {
  test(`${toolId} redirects to its canonical presentation with unchanged URL context`, () => {
    for (const [search, hash] of [
      ['', ''],
      ['?lcFeature=model-face&resume=a%2Fb%3Fc%3D1&value=%252F+%E7%8C%AB', '#asset%2Fone'],
      ['?duplicate=1&duplicate=2&empty=', '#%E7%8C%AB%2520'],
    ]) {
      assert.deepEqual(resolveHeavyCanonicalLocation(toolId, search, hash), { pathname, search, hash });
    }
    assert.ok(!pathname.startsWith('/heavy/'), 'destination cannot loop into the alias envelope');
  });
}

test('missing, unknown, legacy-only and inherited keys retain the workbench fallback', () => {
  for (const toolId of [undefined, '', 'unknown', 'model', 'fitting', 'virtual-fitting', 'marketing',
    'constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf', 'Studio', 'lab/']) {
    assert.equal(resolveHeavyCanonicalLocation(toolId, '?resume=%2F', '#x'), null);
  }
  assert.equal(resolveHeavyWorkspaceToolId('studio'), 'fashion-studio');
  assert.equal(resolveHeavyWorkspaceToolId('marketing'), 'marketing-home');
  assert.equal(resolveHeavyWorkspaceToolId('model'), 'ai-fitting');
});

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const routeBlock = (path: string): string => {
  const start = app.indexOf(`path="${path}"`);
  assert.ok(start >= 0, `route ${path} exists`);
  const end = app.indexOf('\n        <Route', start);
  return app.slice(start, end < 0 ? undefined : end);
};

test('alias boundary uses router params and location, replace navigation and lazy fallback', () => {
  const start = app.indexOf('function HeavyCanonicalRouteBoundary(');
  assert.ok(start >= 0);
  const boundary = app.slice(start, app.indexOf('\nfunction LazyLayout', start));
  assert.match(boundary, /const \{ toolId \} = useParams\(\)/);
  assert.match(boundary, /const location = useLocation\(\)/);
  assert.match(boundary, /resolveHeavyCanonicalLocation\(\s*explicitToolId \?\? toolId,\s*location\.search,\s*location\.hash,/);
  assert.match(boundary, /<Navigate to=\{canonicalLocation\} replace \/>/);
  assert.match(boundary, /return lazyPage\(<LightchainWorkbenchPage \/>\)/);
});

test('only the three specified Heavy routes wire the boundary inside existing protection and shell', () => {
  for (const [path, boundary] of [
    ['/heavy/:toolId', '<HeavyCanonicalRouteBoundary />'],
    ['/heavy/lab', '<HeavyCanonicalRouteBoundary toolId="lab" />'],
    ['/heavy/printing-image', '<HeavyCanonicalRouteBoundary toolId="printing-image" />'],
  ]) {
    const route = routeBlock(path);
    assert.ok(route.includes(boundary));
    assert.match(route, /<ProtectedRoute>[\s\S]*<ErrorBoundary>[\s\S]*<LightchainUnifiedWorkspaceShell>[\s\S]*<HeavyCanonicalRouteBoundary/);
    assert.match(route, /<\/LightchainUnifiedWorkspaceShell>[\s\S]*<\/ErrorBoundary>[\s\S]*<\/ProtectedRoute>/);
  }
  assert.equal((app.match(/<HeavyCanonicalRouteBoundary/g) ?? []).length, 3);
  for (const [path, page] of [
    ['/heavy/marketing', 'LightchainMarketingHomePage'],
    ['/heavy/marketing-home', 'LightchainMarketingHomePage'],
    ['/heavy/design-production', 'LightchainDesignProductionPage'],
    ['/heavy/fabric-image', 'LightchainMaterialWorkbenchPage'],
    ['/lightchain/:toolId', 'LightchainWorkbenchPage'],
  ]) {
    const route = routeBlock(path);
    assert.ok(route.includes(`<${page} />`));
    assert.match(route, /<ProtectedRoute>/);
    assert.doesNotMatch(route, /HeavyCanonicalRouteBoundary/);
  }
});

test('canonical destinations remain registered behind authentication', () => {
  for (const pathname of new Set(canonicalAliases.map(([, path]) => path))) {
    const registeredPath = pathname.startsWith('/model-library/') && pathname !== '/model-library/model-custom-form'
      ? '/model-library/:modelTool'
      : pathname;
    assert.match(routeBlock(registeredPath), /<ProtectedRoute>/);
  }
});
