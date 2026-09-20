import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { CanvasDocument } from '../src/types/database';
import type { CanvasProject } from '../src/stores/canvasStore';
import {
  buildDashboardCanvasProjectHref,
  mergeDashboardCanvasProjects,
} from '../src/lib/dashboardCanvasProjects.ts';

const document = (id: string, title: string): CanvasDocument => ({
  id,
  owner_id: 'owner-1',
  brand_id: 'brand-1',
  title,
  snapshot: { version: 1, objects: [] },
  snapshot_version: 1,
  revision: 2,
  created_at: '2026-09-09T00:00:00.000Z',
  updated_at: '2026-09-09T01:00:00.000Z',
});

const localProject = (id: string, name: string): CanvasProject => ({
  id,
  name,
  objects: [],
  createdAt: '2026-09-08T00:00:00.000Z',
  updatedAt: '2026-09-08T01:00:00.000Z',
});

test('remote documents are discoverable and deduplicated ahead of local index entries', () => {
  const merged = mergeDashboardCanvasProjects(
    [localProject('local-only', 'ローカル'), localProject('same-id', '古いローカル名')],
    [document('same-id', '保存済み'), document('remote-only', 'リモート')],
  );

  assert.deepEqual(merged.map((project) => project.id), ['same-id', 'remote-only', 'local-only']);
  assert.equal(merged[0].name, '保存済み');
  assert.equal(merged[0].source, 'remote');
  assert.equal(merged.filter((project) => project.id === 'same-id').length, 1);
  assert.equal(merged.find((project) => project.id === 'local-only')?.source, 'local');
});

test('project links use the exact remote document ID', () => {
  assert.equal(
    buildDashboardCanvasProjectHref('74cdb392-6a85-48e2-af5c-6d06f1ff875d'),
    '/canvas/74cdb392-6a85-48e2-af5c-6d06f1ff875d',
  );
});

test('Dashboard uses the authenticated list and exposes a failure retry', () => {
  const dashboard = readFileSync(new URL('../src/pages/DashboardPage.tsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../src/lib/cloudflareApi.ts', import.meta.url), 'utf8');

  assert.match(api, /async listCanvasDocuments\(brandId: string\): Promise<CloudflareCanvasDocument\[\]>[\s\S]*\/v1\/canvas-documents\?brand_id=/);
  assert.match(dashboard, /fetchCanvasProjects\(resolvedBrand\)/);
  assert.match(dashboard, /onClick=\{\(\) => void fetchCanvasProjects\(\)\}/);
  assert.match(dashboard, /一覧取得に失敗したため、保存済みプロジェクトがないとは判定していません/);
});

test('Fashion Studio uses the same authenticated project-grid source and Light-compatible detail route', () => {
  const studio = readFileSync(new URL('../src/pages/FashionStudioPage.tsx', import.meta.url), 'utf8');

  assert.match(studio, /cloudflareDataPlane\.listCanvasDocuments\(brandId\)/);
  assert.match(studio, /lg:grid-cols-7/);
  assert.doesNotMatch(studio, /to="\/credits"/);
  assert.match(studio, /className="w-full"/);
  assert.match(studio, /projectPageCount/);
  assert.match(studio, /buildFashionStudioProjectHref\(project\)/);
  assert.match(studio, /extractCanvasPreviewSource\(document\.snapshot\)/);
  assert.match(studio, /resolveGeneratedImageUrlWithStatus\(source\)/);
  assert.match(studio, /PROJECT/);
});
