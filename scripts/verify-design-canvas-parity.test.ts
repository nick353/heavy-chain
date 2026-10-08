import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { designEntryHref } from '../src/lib/designProjectArtifacts.ts';
import { canvasImageReference, imageProjectId, openImageProject } from '../src/features/designDetail/imageProject.ts';
import { createDesignCanvasObject, DESIGN_SHAPES } from '../src/features/designDetail/designCanvasShapes.ts';

const artifact = (metadata: Record<string, unknown>) => ({ id: 'a-1', title: 't', featureType: 'text-to-image', createdAt: '2026-10-01T00:00:00Z', metadata }) as never;

test('project cards open the image as its own Canvas project, like Light', () => {
  assert.equal(designEntryHref({ origin: 'remote', artifact: artifact({ remoteImageId: 'ai-1' }) }), '/designProduction/detail?openImageId=ai-1');
  assert.equal(designEntryHref({ origin: 'local', artifact: artifact({ imageId: 'ai-2' }) }), '/designProduction/detail?openImageId=ai-2');
  assert.equal(designEntryHref({ origin: 'local', artifact: artifact({}) }), '/canvas/new?sourceArtifactId=a-1');
  assert.equal(designEntryHref({ origin: 'remote', artifact: artifact({}) }), null);
});

test('one deterministic project per user, brand and image; created once with the image placed', async () => {
  const scope = { userId: 'u', brandId: 'b' };
  const id = await imageProjectId(scope, 'ai-1');
  assert.match(id, /^imgp-[0-9a-f]{40}$/);
  assert.equal(id, await imageProjectId(scope, 'ai-1'));
  assert.notEqual(id, await imageProjectId({ userId: 'u2', brandId: 'b' }, 'ai-1'));
  const docs = new Map<string, Record<string, unknown>>();
  let creates = 0;
  const client = {
    async getDocument(documentId: string) { const doc = docs.get(documentId); if (!doc) throw new Error('not_found'); return doc as never; },
    async createDocument(input: { documentId?: string; title: string; snapshot: unknown }) {
      creates += 1;
      docs.set(input.documentId!, { id: input.documentId, ownerId: 'u', brandId: 'b', title: input.title, snapshot: input.snapshot, snapshotVersion: 1, revision: 0 });
      return docs.get(input.documentId!) as never;
    },
  };
  const first = await openImageProject({ scope, imageId: 'ai-1', assertContext: () => {}, client, measure: async () => ({ width: 880, height: 1100 }) });
  const objects = (first.snapshot as { objects: Record<string, unknown>[] }).objects;
  assert.equal(objects.length, 1);
  assert.equal(objects[0].src, 'generated-images/ai-1');
  assert.equal(objects[0].width, 352);
  await openImageProject({ scope, imageId: 'ai-1', assertContext: () => {}, client, measure: async () => { throw new Error('should not measure'); } });
  assert.equal(creates, 1);
});

test('a saved canvas image can be selected as the edit reference', () => {
  assert.deepEqual(canvasImageReference({ src: 'generated-images/ai-9', label: 'デザイン 1' }),
    { order: 0, kind: 'upload', imageId: 'ai-9', storagePath: 'generated-images/ai-9', name: 'デザイン 1' });
  assert.equal(canvasImageReference({ src: 'https://example.com/x.png' }), null);
});

test('shapes, panels and text are created in the canvas like Light', () => {
  assert.deepEqual(DESIGN_SHAPES.map((shape) => shape.label), ['矩形', '円形', '三角形', '線', '矢印']);
  const rect = createDesignCanvasObject('rect', 1000, 1000, 3, () => 'x');
  assert.deepEqual([rect.type, rect.shapeType, rect.x, rect.y, rect.zIndex], ['shape', 'rect', 700, 700, 3]);
  assert.equal(createDesignCanvasObject('text', 0, 0, 1, () => 'x').type, 'text');
  assert.equal(createDesignCanvasObject('frame', 0, 0, 1, () => 'x').type, 'frame');
  const detail = fs.readFileSync('src/features/designDetail/DesignEntryDetailPage.tsx', 'utf8');
  assert.match(detail, /data-testid="design-shape-menu"/);
  assert.match(detail, /onClick=\{\(\) => addObject\('frame'\)\}/);
  assert.match(detail, /onClick=\{\(\) => addObject\('text'\)\}/);
  assert.doesNotMatch(detail, /\/canvas\/\$\{encodeURIComponent\(projectId\)\}/);
  assert.match(detail, /今日は何をデザインしますか？/);
  assert.match(detail, /data-testid="design-layer-delete"/);
});

test('inspiration card, zoom group and collapsed assistant follow Light', () => {
  const detail = fs.readFileSync('src/features/designDetail/DesignEntryDetailPage.tsx', 'utf8');
  assert.match(detail, /params\.get\('projectSubType'\) === 'clothingDesign'/);
  assert.match(detail, /Hello！デザインはここから始まります/);
  assert.match(detail, /data-testid="design-zoom-group"/);
  assert.match(detail, /aria-label=\{label\}[\s\S]*?使い方ガイド|使い方ガイド[\s\S]*?ショートカット/);
  assert.match(detail, /setPanelOpen\(!\(panelDefaultKey\.endsWith\(':inspiration'\) \|\| panelDefaultKey\.endsWith\(':canvas'\)\)\)/);
  assert.ok(fs.existsSync('public/lightchain-assets/mirror/lightchain-qlxy-prod/persistence/font-end/design-empty-placeholder.png'));
  const pages = fs.readFileSync('src/pages/LightchainParityPages.tsx', 'utf8');
  assert.match(pages, /title="インスピレーション"[^\n]*navigate\('\/designProduction\/detail\?projectSubType=clothingDesign'\)/);
});
