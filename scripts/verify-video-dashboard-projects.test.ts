import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildRecentVideoDashboardProjects,
  buildSavedVideoDashboardProjects,
} from '../src/lib/videoDashboardProjects.ts';

const dashboardSource = readFileSync(
  fileURLToPath(new URL('../src/pages/VideoProjectDashboardPage.tsx', import.meta.url)),
  'utf8',
);

const artifact = (overrides: Record<string, unknown> = {}) => ({
  id: 'artifact-video-1',
  brandId: 'brand-1',
  scopeId: 'user-1',
  featureType: 'video-workstation',
  title: 'Untitled',
  imageUrl: 'data:image/svg+xml;base64,preview',
  prompt: null,
  createdAt: '2026-09-24T00:00:00.000Z',
  metadata: {
    videoProjectCode: 'project-alpha',
    ...overrides,
  },
});

test('saved video artifacts become reopenable dashboard projects with stable project codes', () => {
  const [project] = buildSavedVideoDashboardProjects([
    artifact(),
    { ...artifact({ videoProjectCode: 'project-beta' }), id: 'artifact-video-2', featureType: 'fashion-studio' },
  ], Date.parse('2026-09-25T00:00:00.000Z'));

  assert.equal(project.id, 'project-alpha');
  assert.equal(project.title, 'Untitled');
  assert.equal(project.imageUrl, 'data:image/svg+xml;base64,preview');
  assert.equal(project.age, '1日前');
});

test('Canvas handoff metadata retains the nested video project code', () => {
  const [project] = buildSavedVideoDashboardProjects([
    artifact({
      videoProjectCode: undefined,
      inputs: { videoProjectCode: 'project-from-handoff' },
    }),
  ]);

  assert.equal(project.id, 'project-from-handoff');
});

test('saved projects win duplicate ids and recent projects stay capped at six', () => {
  const savedProjects = [
    { id: 'untitled-3m', title: '保存済みUntitled', age: '今日' },
    { id: 'saved-project', title: '保存済みプロジェクト', age: '今日' },
  ];
  const fallbackProjects = [
    { id: 'untitled-3m', title: '本家のUntitled', age: '3ヶ月前' },
    { id: 'fallback-1', title: 'Fallback 1', age: '4ヶ月前' },
    { id: 'fallback-2', title: 'Fallback 2', age: '4ヶ月前' },
    { id: 'fallback-3', title: 'Fallback 3', age: '4ヶ月前' },
    { id: 'fallback-4', title: 'Fallback 4', age: '7ヶ月前' },
    { id: 'fallback-5', title: 'Fallback 5', age: '7ヶ月前' },
    { id: 'fallback-6', title: 'Fallback 6', age: '7ヶ月前' },
  ];

  const recentProjects = buildRecentVideoDashboardProjects(savedProjects, fallbackProjects);

  assert.deepEqual(recentProjects.map((project) => project.id), [
    'untitled-3m',
    'saved-project',
    'fallback-1',
    'fallback-2',
    'fallback-3',
    'fallback-4',
  ]);
  assert.equal(recentProjects[0]?.title, '保存済みUntitled');
  assert.equal(recentProjects.length, 6);
});

test('video dashboard mirrors the source project-card menu contract without rights UI', () => {
  assert.match(dashboardSource, /data-track-id="GenerateShortVideo:project-more"/);
  assert.match(dashboardSource, /ピン留め/);
  assert.match(dashboardSource, /アセットライブラリに保存/);
  assert.match(dashboardSource, /削除/);
  assert.doesNotMatch(dashboardSource, /権利を確認してAI生成/);
  assert.doesNotMatch(dashboardSource, /input[^>]+type="checkbox"/);
});

test('video dashboard project boards wrap at desktop widths like Light Chain', () => {
  const boardClasses = [...dashboardSource.matchAll(/className="([^"]*flex flex-wrap[^"]*)"/g)]
    .map((match) => match[1]);

  assert.equal(boardClasses.length, 2);
  assert.ok(boardClasses.every((classes) => classes.includes('gap-x-4') && classes.includes('gap-y-4')));
  assert.doesNotMatch(dashboardSource, /grid grid-cols-2 gap-4 sm:grid-cols-3/);
  assert.match(dashboardSource, /data-testid="video-project-open"\s*onClick=/);
  assert.match(dashboardSource, /h-60 w-\[220px\] cursor-pointer/);
});
