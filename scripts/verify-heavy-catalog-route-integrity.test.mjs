import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSourcePath = new URL('../src/App.tsx', import.meta.url);
const routeMappingPath = new URL('../src/features/lightchain/heavyRouteMapping.ts', import.meta.url);
const workbenchSourcePath = new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url);

// Historical full source-route snapshot from the public app chunk observed at
// https://jp.linkaigc.com/ on 2026-09-21. That exact chunk returned 404 on
// 2026-09-23; the known paths are retained as compatibility coverage, not as a
// current complete route inventory. Fresh anonymous login-bundle references
// are tracked separately below.
const OFFICIAL_LIGHTCHAIN_SOURCE_ROUTE_SNAPSHOT = Object.freeze([
  '/',
  '/creator',
  '/tools/fabric',
  '/tools/line',
  '/tools/line-draft-to-tile',
  '/agent',
  '/model-base/style',
  '/tools/printing',
  '/tools/svg-convert',
  '/printing',
  '/editor/pattern',
  '/tools/pattern-to-vector',
  '/tools/vector-special',
  '/model',
  '/model/clothing',
  '/model/model-reference',
  '/model/pose-reference',
  '/model/background-reference',
  '/tools/reactor',
  '/flow/orientedDesign',
  '/flow/integration',
  '/flow/laboratory',
  '/editor/patternDesign',
  '/editor/changeColor',
  '/model-library/model-custom-form',
  '/model-library/head-form',
  '/model-library/model-change-form',
  '/model-library/body-form',
  '/model-library/size-form',
  '/model-library/pose-form',
  '/model-library/background-form',
  '/model-library/perspective-form',
  '/flow/GenerateShortVideo',
  '/marketing',
  '/designProduction',
]);

const OFFICIAL_LIGHTCHAIN_SOURCE_DETAIL_ROUTE_SNAPSHOT = Object.freeze([
  '/editor/pattern/detail',
  '/flow/orientedDesign/detail',
  '/flow/integration/detail',
  '/flow/laboratory/detail',
  '/editor/patternDesign/detail',
  '/editor/changeColor/detail',
  '/flow/GenerateShortVideo/detail',
  '/marketing/detail',
  '/designProduction/detail',
]);

// Route-shaped UI references extracted from all 35 public script chunks loaded
// by the fresh unauthenticated Lightchain login page on 2026-09-23. This is a
// partial public reference set: protected route state and lazy authenticated
// bundles are not observable from the login page.
const CURRENT_PUBLIC_LOGIN_BUNDLE_ROUTE_REFERENCES = Object.freeze([
  '/agent',
  '/creator',
  '/designProduction',
  '/designProduction/detail',
  '/editor/changeColor',
  '/editor/changeColor/detail',
  '/editor/pattern',
  '/editor/pattern/detail',
  '/editor/patternDesign',
  '/editor/patternDesign/detail',
  '/flow/GenerateShortVideo',
  '/flow/GenerateShortVideo/detail',
  '/flow/integration',
  '/flow/integration/detail',
  '/flow/laboratory',
  '/flow/laboratory/detail',
  '/flow/orientedDesign',
  '/flow/orientedDesign/detail',
  '/forget-password',
  '/login',
  '/login-m',
  '/marketing',
  '/marketing/detail',
  '/model',
  '/model-base/style',
  '/model-library/background-form',
  '/model-library/body-form',
  '/model-library/head-form',
  '/model-library/model-change-form',
  '/model-library/model-custom-form',
  '/model-library/perspective-form',
  '/model-library/pose-form',
  '/model-library/size-form',
  '/printing',
  '/tools/fabric',
  '/tools/line',
  '/tools/line-draft-to-tile',
  '/tools/pattern-to-vector',
  '/tools/printing',
  '/tools/reactor',
  '/tools/svg-convert',
  '/tools/vector-special',
]);

function parseRoutePaths(source) {
  return [...source.matchAll(/path="([^"]+)"/gu)].map((match) => match[1]);
}

function routeMatches(pattern, candidate) {
  const patternSegments = pattern.split('/').filter(Boolean);
  const candidateSegments = candidate.split('/').filter(Boolean);
  if (candidateSegments.length < patternSegments.filter((segment) => !segment.endsWith('?')).length) return false;
  if (candidateSegments.length > patternSegments.length) return false;
  return patternSegments.every((segment, index) => {
    const candidateSegment = candidateSegments[index];
    if (segment.startsWith(':')) return Boolean(candidateSegment);
    return segment === candidateSegment;
  });
}

function parseRouteMapping(source) {
  const start = source.indexOf('HEAVY_PRODUCT_ROUTE_BY_FEATURE_ID');
  const end = source.indexOf('\n});', start);
  assert.ok(start >= 0 && end > start, 'Heavy route mapping object is required');
  return [...source.slice(start, end).matchAll(/^  '([^']+)': '([^']+)',$/gmu)]
    .map((match) => ({ id: match[1], route: match[2] }));
}

function parseWorkbenchRoutes(source) {
  const start = source.indexOf('const tools: CompatTool[] = [');
  const end = source.indexOf('\n];', start);
  assert.ok(start >= 0 && end > start, 'Lightchain workbench catalog is required');
  return [...source.slice(start, end).matchAll(/\n  \{\n([\s\S]*?)\n  \},/gu)].map((match) => ({
    id: match[1].match(/^    id: '([^']+)',/mu)?.[1],
    route: match[1].match(/^    heavyChainHref: '([^']+)',/mu)?.[1],
  }));
}

test('every Heavy product catalog route resolves through the current App router', async () => {
  const [appSource, routeMappingSource] = await Promise.all([
    readFile(appSourcePath, 'utf8'),
    readFile(routeMappingPath, 'utf8'),
  ]);
  const appRoutes = parseRoutePaths(appSource);
  const mapping = parseRouteMapping(routeMappingSource);
  assert.equal(mapping.length, 30);
  const missing = mapping.filter(({ route }) => {
    const pathname = route.split('?')[0];
    return !appRoutes.some((pattern) => routeMatches(pattern, pathname));
  });
  assert.deepEqual(missing, []);
});

test('every Light source row uses a current Heavy route or its explicit pending fallback', async () => {
  const [appSource, workbenchSource] = await Promise.all([
    readFile(appSourcePath, 'utf8'),
    readFile(workbenchSourcePath, 'utf8'),
  ]);
  const appRoutes = parseRoutePaths(appSource);
  const rows = parseWorkbenchRoutes(workbenchSource);
  assert.equal(rows.length, 33);
  const missing = rows.filter(({ id, route }) => {
    if (!id || !route) return true;
    const pathname = route.split('?')[0];
    return !appRoutes.some((pattern) => routeMatches(pattern, pathname));
  });
  assert.deepEqual(missing, []);
});

test('keeps every previously observed primary and detail source route addressable in Heavy', async () => {
  const appSource = await readFile(appSourcePath, 'utf8');
  const appRoutes = parseRoutePaths(appSource);
  const officialRoutes = [
    ...OFFICIAL_LIGHTCHAIN_SOURCE_ROUTE_SNAPSHOT,
    ...OFFICIAL_LIGHTCHAIN_SOURCE_DETAIL_ROUTE_SNAPSHOT,
  ];
  assert.equal(new Set(OFFICIAL_LIGHTCHAIN_SOURCE_ROUTE_SNAPSHOT).size, 35);
  assert.equal(new Set(OFFICIAL_LIGHTCHAIN_SOURCE_DETAIL_ROUTE_SNAPSHOT).size, 9);
  assert.equal(new Set(officialRoutes).size, 44);
  const missing = officialRoutes.filter(
    (pathname) => !appRoutes.some((pattern) => routeMatches(pattern, pathname)),
  );
  assert.deepEqual(missing, []);
});

test('covers the fresh public Lightchain login-bundle route references', async () => {
  const appSource = await readFile(appSourcePath, 'utf8');
  const appRoutes = parseRoutePaths(appSource);
  const knownHistoricalPaths = [
    ...OFFICIAL_LIGHTCHAIN_SOURCE_ROUTE_SNAPSHOT,
    ...OFFICIAL_LIGHTCHAIN_SOURCE_DETAIL_ROUTE_SNAPSHOT,
  ];
  assert.equal(new Set([...knownHistoricalPaths, ...CURRENT_PUBLIC_LOGIN_BUNDLE_ROUTE_REFERENCES]).size, 47);
  assert.equal(CURRENT_PUBLIC_LOGIN_BUNDLE_ROUTE_REFERENCES.length, 42);
  assert.equal(new Set(CURRENT_PUBLIC_LOGIN_BUNDLE_ROUTE_REFERENCES).size, 42);
  const missing = CURRENT_PUBLIC_LOGIN_BUNDLE_ROUTE_REFERENCES.filter(
    (pathname) => !appRoutes.some((pattern) => routeMatches(pattern, pathname)),
  );
  assert.deepEqual(missing, []);
});
