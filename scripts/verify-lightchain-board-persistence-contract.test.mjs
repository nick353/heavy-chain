import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createServer } from 'vite';

const source = await readFile(new URL('../src/pages/LightchainBoardPage.tsx', import.meta.url), 'utf8');
const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] } });
const board = await vite.ssrLoadModule('/src/features/board/boardDocuments.ts');
test.after(async () => { await vite.close(); });

test('design documents are server canvas documents of the signed-in user', () => {
  assert.match(source, /listCanvasDocumentsPage\(brandId, 100, 0\)/);
  assert.match(source, /row\.owner_id === userId \? readBoardDocument\(row\.snapshot\) : null/);
  // The source account's sample list and the old browser-only list are gone.
  assert.doesNotMatch(source, /fillSourceBoardDocuments|lightchain-board-seed-|seededDocuments|localStorage/);
  assert.match(source, /formatBoardDate/);
});

test('create uses one fixed id and reconciles a lost response by reading it', () => {
  assert.match(source, /const id = newBoardId\(\);\n\s+try \{\n\s+await cloudflareDataPlane\.createCanvasDocument\(\{ id, brand_id: brandId, title, snapshot: boardSnapshot\(data\) \}\);/);
  assert.match(source, /const existing = await cloudflareDataPlane\.getCanvasDocument\(id\)/);
});

test('editor saves against the revision it replaces and reads back before retrying', () => {
  assert.match(source, /updateCanvasDocument\(\{ \.\.\.input, expected_revision: revisionRef\.current \}\)/);
  assert.match(source, /A lost response may still have saved: read the stored copy before deciding/);
  assert.match(source, /setSaveState\('failed'\)/);
});

test('board snapshots keep only stored images and survive a round trip', () => {
  const data = {
    kind: board.BOARD_DOCUMENT_KIND, version: 1,
    pages: [{ id: 'p1', items: [
      { id: 't', type: 'text', x: 10, y: 20, rotation: 0, text: '2027SS', fontSize: 48, fill: '#000', width: 300 },
      { id: 'i', type: 'image', x: 0, y: 0, rotation: 0, storagePath: 'generated-images/a', width: 100, height: 80 },
      { id: 'b', type: 'image', x: 0, y: 0, rotation: 0, storagePath: 'data:image/png;base64,AAA', width: 1, height: 1 },
      { id: 'a', type: 'arrow', x: 1, y: 2, rotation: 0, width: 320, height: 40, stroke: '#111', strokeWidth: 4 },
    ] }],
  };
  const snapshot = board.boardSnapshot(data);
  assert.deepEqual(snapshot.objects, []);
  const read = board.readBoardDocument(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(read.pages[0].items.map((item) => item.id), ['t', 'i', 'a']);
  assert.equal(board.readBoardDocument({ objects: [], agentTask: {} }), null);
  assert.deepEqual(board.pageImagePaths(read.pages[0]), ['generated-images/a']);
  assert.equal(board.fitBoardZoom(1440, 850), 0.81);
  assert.equal(board.formatBoardDate('2025-11-28T18:23:00'), '2025.11.28 18:23');
});
