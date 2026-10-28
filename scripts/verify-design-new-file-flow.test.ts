import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/features/designDetail/DesignEntryDetailPage.tsx', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../src/features/designDetail/useDialogueReferences.ts', import.meta.url), 'utf8');

test('a new file turns its first uploaded image into the project, placed on the canvas (Light, measured 2026-10-29)', () => {
  assert.match(page, /if \(isNewFile && images\.length === 1\) \{ void openUploadedImageProject\(images\[0\]\); return; \}/);
  // Saved directly, not through the chat references, so a closed assistant panel cannot hold it up.
  assert.match(page, /cloudflareDataPlane\.saveWorkspaceArtifact\(\{ requestId: crypto\.randomUUID\(\), brandId, featureType: 'design-dialogue-reference'/);
  assert.match(page, /openImageProject\(\{ scope: \{ userId, brandId \}, imageId: saved\.remote\.imageId/);
  assert.match(page, /data-testid="design-new-file-saving"/);
});

test('a new file starts without images left by an earlier unfinished new file', () => {
  assert.match(page, /startEmpty: isNewFile/);
  assert.match(hook, /if \(startEmpty\) for \(const reference of activated\) leftovers\.add\(reference\.id\);/);
  assert.match(hook, /dropLeftovers\(\);\n\s+void controller\.restore\(\)/);
});

test('an image dropped before the brand is ready waits and is saved once it is', () => {
  assert.match(page, /if \(cloudflareDataPlane && !brandReady\) \{ setWaitingFile\(file\); setNewFileSaving\(true\); return; \}/);
  assert.match(page, /if \(brandReady && waitingFile\) void openUploadedImageProject\(waitingFile\);/);
});

test('sending shows the message at once, 考え中...... over the input, and 生成中... boxes like Light (measured 2026-10-29)', () => {
  assert.match(page, /setSentPrompt\(\{ text, count: visible\?\.dialogue\?\.attempts\.length \?\? 0 \}\)/);
  assert.match(page, /data-testid="design-user-bubble-sending"/);
  assert.match(page, /data-testid="design-thinking"[\s\S]{0,400}考え中\.\.\.\.\.\./);
  // Same grid slot that designCanvasAdapter.adoptOutputs uses for the result.
  assert.match(page, /left: 80 \+ \(\(placeholderBase \+ index\) % 3\) \* 480, top: 80 \+ Math\.floor\(\(placeholderBase \+ index\) \/ 3\) \* 480/);
  assert.match(page, /data-testid="design-canvas-generating"[\s\S]{0,400}生成中\.\.\./);
  assert.match(page, /data-testid="design-image-generating"/);
  // Stuck (unknown) requests do not keep a 生成中... box forever.
  assert.match(page, /attempt\.imageResult === 'in-flight' \|\| \(attempt\.imageResult === undefined && visible\.busy\)/);
});

test('a stuck request can be made again, and opening a project does not re-read settled ones (input stays free)', () => {
  assert.match(page, /data-testid="design-attempt-retry"[\s\S]{0,200}active\.send\(attempt\.input\.prompt, attempt\.input\.references\)/);
  assert.match(page, /attempt\.imageAttempted && \(attempt\.imageResult === undefined \|\| attempt\.imageResult === 'in-flight'\)\)\)\?\.input\.requestId/);
});

test('while it works, 送信 becomes a stop square like Light; stopping frees the input and places nothing', () => {
  const controller = readFileSync(new URL('../src/features/designDetail/designDialogueController.ts', import.meta.url), 'utf8');
  assert.match(page, /data-testid="design-followup-stop"[\s\S]{0,500}void active\.stop\(\)/);
  assert.match(controller, /const assertRunning = \(\) => \{ assertContext\(\); if \(stopped\.has\(requestId\)\) throw new Error\('design_request_stopped'\); \};/);
  assert.match(controller, /if \(stopped\.has\(current\.input\.requestId\) \|\| current\.assistant\.state !== 'completed'\) return;/);
});

test('a text-only new file shows the bubble, 考え中...... and a 生成中... square at once, like Light (measured 2026-10-29)', () => {
  assert.match(page, /isNewFile && entrySending && <div role="status" data-testid="design-new-file-generating"/);
  assert.match(page, /isNewFile && entrySending && <div data-testid="design-new-file-sending">/);
  assert.match(page, /\(\(visible\?\.busy && visible\.dialogue\) \|\| \(isNewFile && entrySending\)\) && <p role="status" data-testid="design-thinking"/);
});

test('a new file whose create never reached the server recreates the SAME ID once instead of failing with 404 forever', () => {
  const coordinator = readFileSync(new URL('../src/features/designDetail/designEntryCoordinator.ts', import.meta.url), 'utf8');
  assert.match(coordinator, /error\.message === 'cloudflare_api_404_not_found'\)\) throw error;\n\s+try \{ await createSnapshot\(\); \}/);
  assert.match(coordinator, /const createSnapshot = \(\) => client\.createDocument\(\{ documentId: draft\.projectId/);
});

test('images are drawn from the request plus the assistant\'s design direction, like Light\'s rewritten brief', async () => {
  const { imagePrompt } = await import('../src/features/designDetail/imagePrompt.ts');
  const input = { prompt: 'トレンチコートを作って' } as never;
  const prompt = imagePrompt({ input, assistant: { state: 'completed', content: 'ベルトと肩章のあるダブルのトレンチ。\n→ 色違いを作る' } } as never);
  assert.match(prompt, /^トレンチコートを作って\n\nDesign direction:\nベルトと肩章のあるダブルのトレンチ。$/);
  assert.equal(imagePrompt({ input, assistant: { state: 'failed' } } as never), 'トレンチコートを作って');
  assert.ok(imagePrompt({ input, assistant: { state: 'completed', content: 'x'.repeat(9000) } } as never).length <= 4000);
});
