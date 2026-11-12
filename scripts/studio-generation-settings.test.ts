import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFashionStudioDetailGeneration, type FashionStudioGenerationAdapters } from '../src/lib/fashionStudioDetailGeneration.ts';
import { DEFAULT_STUDIO_SETTINGS, STUDIO_FLUX_MAX_REFERENCES, STUDIO_QUALITIES, closestStudioAspectRatio, readStudioSettings, studioEditOptions,
  studioFluxRedrawPlan } from '../src/lib/fashionStudioExamples.ts';
import { studioExampleHoldUrls, studioExamplePreviewRoles, withStudioExamplePreview } from '../src/lib/fashionStudioExamplePreview.ts';
import { emptyFashionStudioDetail } from '../src/lib/fashionStudioDetailHydration.ts';

// Light's Fashion Studio 生成設定 and loading (2026-11-12): 画質 1K / 2K / 4K, the mask brush, the example that shows at once,
// and the FLUX.2 [dev] redraw of a テキストで生成 refused by OpenAI's safety check.
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = source('../src/pages/FashionStudioDetailPage.tsx');
const scope = { userId: 'user-1', brandId: 'brand-1', documentId: 'doc-1', generation: 1 };

test('画質 lists 1K / 2K / 4K in Light\'s order with its marks, 2K by default, and is kept per project', () => {
  assert.deepEqual(STUDIO_QUALITIES.map(item => [item.value, item.label, item.mark]), [['1k', '1K', 'quick'], ['2k', '2K', 'HD'], ['4k', '4K', '4K']]);
  assert.equal(DEFAULT_STUDIO_SETTINGS.quality, '2k');
  const storage = (value: unknown) => ({ getItem: () => JSON.stringify(value) });
  assert.equal(readStudioSettings('doc-1', storage({ quality: '4k' })).quality, '4k');
  assert.equal(readStudioSettings('doc-1', storage({ quality: '8k' })).quality, '2k');
  assert.equal(readStudioSettings('doc-1', storage({})).quality, '2k');
  assert.match(page, /<select aria-label="画質" value=\{settings\.quality\}[^>]*onChange=\{event => updateSettings\(\{ quality: event\.target\.value as StudioQuality \}\)\}/);
  assert.match(page, /STUDIO_QUALITIES\.map\(item => <option key=\{item\.value\} value=\{item\.value\}>\{item\.label\}<\/option>\)/);
  // ポイント表示 stays 1: Heavy charges one point per generation whatever the 画質.
  assert.match(page, /<span className="font-normal" title="Heavy は生成1回につき1ポイントです">1<\/span>/);
});

test('the request sends 比率 and 画質 only when they differ from the server defaults (自動 / 2K); 範囲指定 sends neither', async () => {
  assert.equal(studioEditOptions({ aspectRatio: 'auto', quality: '2k' }), undefined);
  assert.deepEqual(studioEditOptions({ aspectRatio: 'auto', quality: '1k' }), { resolution: '1k' });
  assert.deepEqual(studioEditOptions({ aspectRatio: '1:1', quality: '4k' }), { aspectRatio: '1:1', resolution: '4k' });
  // A 画像編集 form on the canvas sends the options its tool chose instead.
  assert.match(page, /const editOptions = edit \? edit\.editOptions : fn === 'region' \? undefined : studioEditOptions\(settings\);/);
  assert.match(source('../src/lib/imageApi.ts'), /\.\.\.\(options\?\.resolution \? \{ resolution: options\.resolution \} : \{\}\),/);
  const seen: Record<string, unknown>[] = [];
  const notReached = () => { throw new Error('not_reached_in_this_test'); };
  const controller = createFashionStudioDetailGeneration({
    assertScope: () => undefined, requestId: () => crypto.randomUUID(),
    editImageWithPrompt: async (_url: string, _prompt: string, _brand: string, options: Record<string, unknown>) => {
      seen.push(options); return { success: false, state: 'failed', requestId: options.idempotencyKey, error: 'image_provider_moderation_blocked' };
    },
    assertCompletedImageEditResult: (result: { success: boolean; error?: string }) => { if (!result.success) throw new Error(result.error); },
    persistProviderResultArtifact: notReached, getCanvasDocument: notReached, updateCanvasDocument: notReached,
    buildUpdatedSnapshot: notReached, findOperationResult: notReached, acknowledgeImageAction: notReached,
  } as unknown as FashionStudioGenerationAdapters);
  const main = { objectId: 'main-1', imageUrl: 'https://example.test/garment.png', verified: true };
  await controller.start({ scope, logicalAttemptKey: 'a', main, prompt: 'p', editOptions: { aspectRatio: '3:4', resolution: '4k' } });
  await controller.start({ scope, logicalAttemptKey: 'b', main, prompt: 'p' });
  assert.equal(seen[0].resolution, '4k'); assert.equal(seen[0].aspectRatio, '3:4');
  assert.equal(seen[1].resolution, undefined); assert.equal(seen[1].aspectRatio, undefined);
});

test('the mask brush paints every fusion point in one colour like Light; the per-point colour dot is gone', () => {
  // Light's 定向融合 mask window has no colorDraw tool, so every point is painted with --brand-primary-hover.
  assert.match(source('../src/components/lightchain/MaskPaintDialog.tsx'), /const MASK_COLOR = 'rgba\(101, 211, 207, 0\.78\)';/);
  assert.doesNotMatch(page, /REGION_POINT_COLORS/);
  assert.match(page, /data-testid="fashion-studio-region-mask-thumb" className="absolute inset-0 h-full w-full object-cover opacity-60"/);
});

test('a chosen example shows its bundled images at once; each role switches to the saved copy only after it has loaded', () => {
  const origin = 'https://heavychain.app';
  const empty = emptyFashionStudioDetail();
  const holds = studioExampleHoldUrls('underwear', origin);
  assert.equal(holds.main, 'https://heavychain.app/lightchain-assets/flow-examples/underwear-main.webp');
  assert.equal(holds.reference, 'https://heavychain.app/lightchain-assets/flow-examples/underwear-reference.webp');
  assert.equal(studioExampleHoldUrls('text', origin).reference, undefined);
  // Nothing saved yet: both roles show the example.
  let roles = studioExamplePreviewRoles(empty, 'underwear', { main: false, reference: false });
  assert.deepEqual(roles, { main: true, reference: true });
  let view = withStudioExamplePreview(empty, 'underwear', roles, origin);
  assert.deepEqual(view.roles.main, { status: 'available', objectId: null, candidates: [holds.main] });
  assert.deepEqual(view.roles.reference.candidates, [holds.reference]);
  // The main image is saved but has not loaded yet: it keeps the example until it can draw at once.
  const saved = { ...empty, roles: { ...empty.roles, main: { status: 'available' as const, objectId: 'main-1', candidates: ['generated-images/main-1'] } } };
  roles = studioExamplePreviewRoles(saved, 'underwear', { main: false, reference: false });
  assert.equal(roles.main, true);
  roles = studioExamplePreviewRoles(saved, 'underwear', { main: true, reference: false });
  assert.deepEqual(roles, { main: false, reference: true });
  view = withStudioExamplePreview(saved, 'underwear', roles, origin);
  assert.deepEqual(view.roles.main.candidates, ['generated-images/main-1']);
  assert.deepEqual(view.roles.reference.candidates, [holds.reference]);
  // テキストで生成 has no reference, so only the main image waits.
  assert.deepEqual(studioExamplePreviewRoles(saved, 'text', { main: true, reference: false }), { main: false, reference: false });
  assert.equal(withStudioExamplePreview(saved, 'text', { main: false, reference: false }, origin), saved);
});

test('the page shows the example before saving, locks the form until the save ends, and leaves on failure', () => {
  assert.match(page, /setExamplePreview\(\{ fn, projectCode \}\);/);
  assert.match(page, /const hasProject = !embedded && \(Boolean\(projectCode\) \|\| previewActive\);/);
  assert.match(page, /const formLocked = busy \|\| previewActive;/);
  assert.match(page, /const inputsReady = !formLocked && uploadingScope !== scopeKey/);
  assert.match(page, /if \(!scope \|\| busyRef\.current \|\| !generationController \|\| previewActiveRef\.current\) return;/);
  assert.match(page, /if \(!await uploadFile\(file, 'main'\)\) stopPreview\(\);/);
  assert.match(page, /if \(exampleFn\) \{ primeExampleProject\(document\.id, exampleFn\);/);
  assert.match(page, /if \(visible\?\.status === 'failure' \|\| \(!previewRoles\.main && !previewRoles\.reference && !pendingExample\)\) setExamplePreview\(null\);/);
  // Saving and every check keep reading the saved detail; only drawing uses the example.
  assert.match(page, /committedInputsRef\.current = detail;/);
  assert.match(page, /data-testid="fashion-studio-example-preloader"/);
  assert.match(page, /holdUrl \? <img src=\{holdUrl\} alt=\{alt\} className=\{className\} data-image-status="example" \/>/);
});

test('a テキストで生成 refused by OpenAI\'s safety check is redrawn on FLUX.2 [dev] within the server\'s limits', () => {
  const refused = { status: 'failure', settled: true, error: 'cloudflare_api_400_image_provider_moderation_blocked' };
  assert.equal(STUDIO_FLUX_MAX_REFERENCES, 3);
  assert.deepEqual(studioFluxRedrawPlan('text', refused, []), { references: [], trimmed: false, needsConsent: false });
  assert.deepEqual(studioFluxRedrawPlan('text', refused, ['a', 'b']), { references: ['a', 'b'], trimmed: false, needsConsent: true });
  assert.deepEqual(studioFluxRedrawPlan('text', refused, ['a', 'b', 'c', 'd', 'e']), { references: ['a', 'b', 'c'], trimmed: true, needsConsent: true });
  // A lost or running request is held for 保存を再試行, other refusals and other functions are not redrawn.
  assert.equal(studioFluxRedrawPlan('text', { ...refused, settled: false }, []), null);
  assert.equal(studioFluxRedrawPlan('text', { ...refused, error: 'legal_safety_prompt_blocked' }, []), null);
  assert.equal(studioFluxRedrawPlan('region', refused, []), null);
  assert.equal(studioFluxRedrawPlan('text', { status: 'success' }, []), null);
  // The redraw keeps the main image's frame (that route frames like its second image when no ratio is sent).
  assert.equal(closestStudioAspectRatio(768, 1024), '3:4');
  assert.equal(closestStudioAspectRatio(1000, 1000), '1:1');
  assert.equal(closestStudioAspectRatio(1080, 1920), '9:16');
  assert.equal(closestStudioAspectRatio(1200, 800), '3:2');
  // The same click asks for the declaration only when references go, then sends the innerwear route.
  assert.match(page, /const rightsConfirmed = redraw\.needsConsent && await askFluxConsent\(redraw\.trimmed\);/);
  assert.match(page, /if \(!redraw\.needsConsent \|\| rightsConfirmed\) \{/);
  assert.match(page, /route: 'innerwear' as const, \.\.\.\(rightsConfirmed \? \{ rightsConfirmed: true \} : \{\}\) \}\);/);
  assert.match(page, /data-testid="fashion-studio-flux-consent"/);
  assert.match(page, /<button type="button" disabled=\{!fluxConsent\.checked\} onClick=\{\(\) => answerFluxConsent\(true\)\}/);
});
