import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  settleComposition,
  waitForDisplayableImage,
} from '../src/features/printing/history/progressivePrintGeneration.ts';

const page = readFileSync(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url), 'utf8');

test('printing generation is shown inline ahead of retained history without a blocking modal', () => {
  const pendingRun = page.indexOf('data-testid="progressive-print-run"');
  const retainedRuns = page.indexOf('printResultRuns.map((run, runIndex)');
  assert.ok(pendingRun >= 0);
  assert.ok(retainedRuns > pendingRun);
  assert.match(page, /data-testid=\{`progressive-print-\$\{label\}-card`\}/);
  assert.match(page, /visibleGeneratedResults\.length > 0 \|\| \(isPrinting && progressivePrintRun\)/);
  assert.doesNotMatch(page, /PrintGenerationProgressDialog/);
});

test('exact and fabric start together but exact becomes visible before fabric is awaited', () => {
  const exactStart = page.indexOf('const exactCompositionPromise = settleComposition');
  const fabricStart = page.indexOf('const fabricCompositionPromise = settleComposition');
  const exactAwait = page.indexOf('const exactComposition = await exactCompositionPromise');
  const exactDecode = page.indexOf('await waitForDisplayableImage(exactComposition.imageUrl)', exactAwait);
  const exactReady = page.indexOf("exact: { status: 'ready', result: exactResult", exactDecode);
  const paint = page.indexOf('await waitForCommittedPaint()', exactReady);
  const fabricAwait = page.indexOf('const fabricComposition = await fabricCompositionPromise', paint);
  assert.ok(exactStart >= 0 && fabricStart > exactStart && exactAwait > fabricStart);
  assert.ok(exactDecode > exactAwait && exactReady > exactDecode && paint > exactReady && fabricAwait > paint);
});

test('composition rejection is converted to an observed result', async () => {
  const failure = new Error('fabric_failed');
  const settled = await settleComposition(Promise.reject(failure));
  assert.deepEqual(settled, { ok: false, error: failure });
});

test('a generated image is not display-ready until decode completes', async () => {
  let resolveDecode!: () => void;
  let finished = false;
  const fakeImage = {
    src: '',
    complete: false,
    naturalWidth: 0,
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
    decode: () => new Promise<void>((resolve) => { resolveDecode = resolve; }),
  };
  const ready = waitForDisplayableImage('data:image/png;base64,AA==', {
    timeoutMs: 100,
    createImage: () => fakeImage,
  }).then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  fakeImage.naturalWidth = 720;
  resolveDecode();
  await ready;
  assert.equal(finished, true);
});

test('display readiness fails with an exact bounded timeout', async () => {
  const fakeImage = {
    src: '',
    complete: false,
    naturalWidth: 0,
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
    decode: () => new Promise<void>(() => undefined),
  };
  await assert.rejects(
    waitForDisplayableImage('data:image/png;base64,AA==', {
      timeoutMs: 5,
      createImage: () => fakeImage,
    }),
    /generated_image_decode_timeout/,
  );
});

test('only a complete exact-fabric pair enters bounded history', () => {
  const fabricSuccess = page.indexOf('const fabricResult: WorkbenchResult');
  const merge = page.indexOf('setGeneratedResults((previous) => mergePrintResultHistory', fabricSuccess);
  const clearPending = page.indexOf('setProgressivePrintRun(null)', merge);
  assert.ok(fabricSuccess >= 0 && merge > fabricSuccess && clearPending > merge);
  assert.match(page, /fabric: \{ status: 'error', result: null, error: fabricComposition\.error\.message \}/);
  assert.match(page, /exact: \{ status: 'error', result: null, error: exactComposition\.error\.message \}/);
  assert.match(
    page,
    /exact: \{ status: 'error', result: null, error: exactComposition\.error\.message \},\s*fabric: \{\s*status: 'error',[\s\S]*?このペアは確定されませんでした。/,
  );
  assert.match(
    page,
    /await waitForDisplayableImage\(exactComposition\.imageUrl\);\s*\} catch \(decodeError\) \{\s*if \(!isCurrentRequest\(\)\) return;[\s\S]*?exact: \{ status: 'error', result: null, error: error\.message \},[\s\S]*?このペアは確定されませんでした。/,
  );
  assert.match(
    page,
    /await waitForDisplayableImage\(fabricComposition\.imageUrl\);\s*\} catch \(decodeError\) \{\s*if \(!isCurrentRequest\(\)\) return;[\s\S]*?fabric: \{ status: 'error', result: null, error: error\.message \}/,
  );
});

test('input invalidation clears only the in-flight row and retains prior results', () => {
  assert.match(
    page,
    /generationInputEffectSignatureRef\.current = generationInputSignature;[\s\S]*?setPendingSurfaceJob\(null\);\s*setProgressivePrintRun\(null\);\s*const activeRequest = generationRequestRef\.current;\s*if \(activeRequest === null/,
  );
  assert.doesNotMatch(page, /setGeneratedResults\(\[\]\).*setProgressivePrintRun\(null\)/s);
});
