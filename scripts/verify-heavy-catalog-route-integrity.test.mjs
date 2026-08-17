import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSourcePath = new URL('../src/App.tsx', import.meta.url);
const routeMappingPath = new URL('../src/features/lightchain/heavyRouteMapping.ts', import.meta.url);
const workbenchSourcePath = new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url);

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
