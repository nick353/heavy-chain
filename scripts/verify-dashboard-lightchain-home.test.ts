import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/components/layout/Layout.tsx', import.meta.url), 'utf8');
const routeSource = (path: string, nextPath: string) => {
  const start = app.indexOf(`path="${path}"`);
  const end = app.indexOf(`path="${nextPath}"`, start + 1);
  return start >= 0 && end > start ? app.slice(start, end) : '';
};

test('authenticated dashboard uses the current Lightchain homepage entry', () => {
  const dashboardRoute = routeSource('/dashboard', '/workspace');
  assert.match(dashboardRoute, /<LightchainUnifiedWorkspaceShell>/);
  assert.match(dashboardRoute, /<GenerateLightchainEntry \/>/);
  assert.doesNotMatch(dashboardRoute, /<DashboardPage \/>/);
});

test('legacy Heavy dashboard remains available only behind the explicit workspace route', () => {
  const workspaceRoute = routeSource('/workspace', '/generate');
  assert.match(workspaceRoute, /<DashboardPage \/>/);
});

test('dashboard receives the Lightchain header and frame', () => {
  assert.match(layout, /const isLightchainRoute = location\.pathname === '\/dashboard'/);
});

console.log('dashboard Lightchain home tests: 3/3 passed');
