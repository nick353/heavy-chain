import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import '../../src/index.css';
import { LightchainMaterialWorkbenchPage } from '../../src/pages/LightchainMaterialWorkbenchPage';
import { LightchainUnifiedWorkspaceShell } from '../../src/components/workspace/LightchainUnifiedWorkspaceShell';
import { useAuthStore } from '../../src/stores/authStore';
import { auth } from '../../src/lib/auth';
import { cloudflareDataPlane } from '../../src/lib/cloudflareApi';
import { persistPrintInputState, restorePrintInputState, releaseRestoredPrintInput, type PrintInputEditorState, type RestoredPrintInputState } from '../../src/lib/printInputPersistence';
import { restorePrintResultHistory, releaseRestoredPrintResult } from '../../src/lib/printResultHistoryPersistence';
import { listProtectedImageInputs, loadProtectedImageInput } from '../../src/lib/cloudflareImageInputCache';
import { buildPrintRequestSnapshot, renderPrintRequestComposition, buildEncodedManualPrintableSurface, type MaterialCutoutResult } from '../../src/lib/workspaceMaterialReferences';
import { renderPrintProviderInput } from '../../src/lib/printProviderInput';
import { prepareProtectedCloudflareEdit } from '../../src/lib/cloudflareProtectedImageEdit';
import { prepareCloudflareImageInput } from '../../src/lib/cloudflareImageAI';
import { protectedImageDigest } from '../../src/lib/protectedImageEditContract';

const output = document.querySelector<HTMLElement>('#probe-result')!;
const nativeButton = document.querySelector<HTMLButtonElement>('#native');
let workbenchReady = false;
let initializationError: string | null = null;
const errorMessage = (error: unknown) => error instanceof Error ? `${error.name}: ${error.message}` : String(error);
const setProbeStatus = (status: string) => { if (output) output.textContent = status; };
const captureInitializationError = (source: string, error: unknown) => {
  if (workbenchReady || initializationError) return;
  initializationError = `${source}: ${errorMessage(error)}`;
  nativeButton?.setAttribute('disabled', '');
  setProbeStatus(JSON.stringify({ phase: 'initialization', status: 'fail', error: initializationError }, null, 2));
};
window.addEventListener('error', (event) => {
  // Ignore resource-load events (the local probe deliberately blocks external
  // model/font requests), but expose actual script/React errors before ready.
  if (event instanceof ErrorEvent || event.error || event.message) captureInitializationError('Browser initialization error', event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => captureInitializationError('Unhandled initialization rejection', event.reason));

class ProbeErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    captureInitializationError('React initialization error', error);
  }

  render() {
    if (this.state.error) return <div role="alert" data-testid="print-input-probe-initialization-error">React initialization error: {errorMessage(this.state.error)}</div>;
    return this.props.children;
  }
}

const api = cloudflareDataPlane!; if (!api) throw new Error('probe_cloudflare_client_missing');
const key = 'heavy-print-input-probe:v1';
const resumeRunId = new URL(location.href).searchParams.get('resumeRun');
if (resumeRunId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(resumeRunId)) throw new Error('probe_resume_identity_invalid');
const runId = resumeRunId || sessionStorage.getItem(key) || crypto.randomUUID();
sessionStorage.setItem(key, runId);
const prefix = '/__print-input-api/' + runId;
const nativeFetch = fetch, finalMedia = new Map<string, string>();
const call = async (path: string, init: RequestInit = {}) => {
  const response = await nativeFetch(prefix + path, init), payload = await response.json();
  if (!response.ok) throw new Error(`cloudflare_api_${response.status}_${payload.error}`);
  if (path.startsWith('/v1/media/read?')) finalMedia.set(payload.url, payload.imageUrl);
  return payload;
};
const post = (path: string, body: unknown) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const raster = (width: number, height: number, draw: (context: CanvasRenderingContext2D) => void) => {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d')!); return canvas.toDataURL('image/png');
};
const decode = async (url: string) => {
  const image = new Image(); image.src = url; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(image, 0, 0);
  return { image, canvas, width: canvas.width, height: canvas.height, rgba: context.getImageData(0, 0, canvas.width, canvas.height).data };
};
const show = (label: string, url: string) => {
  const figure = document.createElement('figure'), image = document.createElement('img'), caption = document.createElement('figcaption');
  image.src = url; image.alt = label; caption.textContent = label; figure.append(image, caption); document.querySelector('#pictures')!.append(figure);
};
const checks: Record<string, boolean> = {};
const check = (condition: unknown, label: string) => { checks[label] = Boolean(condition); if (!condition) throw new Error(label); };
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

let remote: any;
try { remote = await call('/bootstrap'); }
catch (error) {
  // An explicit resume must never manufacture another run, re-seed input
  // storage, or repeat generation after the original server state is lost.
  if (resumeRunId) throw error;
  if (!String(error).includes('404_probe_run_not_found')) throw error;
  const garment = raster(200, 250, ctx => {
    ctx.beginPath(); ctx.moveTo(42, 0); ctx.lineTo(75, 0); ctx.quadraticCurveTo(100, 28, 125, 0); ctx.lineTo(158, 0);
    ctx.lineTo(200, 55); ctx.lineTo(174, 85); ctx.lineTo(158, 63); ctx.lineTo(158, 250); ctx.lineTo(42, 250);
    ctx.lineTo(42, 63); ctx.lineTo(26, 85); ctx.lineTo(0, 55); ctx.closePath(); ctx.clip();
    const shade = ctx.createLinearGradient(0, 0, 200, 100); shade.addColorStop(0, '#c6c8c9'); shade.addColorStop(.5, '#faf9f6'); shade.addColorStop(1, '#b8bcc3');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, 200, 250); ctx.fillStyle = '#93989d55'; ctx.fillRect(70, 40, 7, 210);
  });
  const garmentImage = (await decode(garment)).image;
  const sourceUrl = raster(400, 500, ctx => {
    ctx.fillStyle = '#7595a0'; ctx.fillRect(0, 0, 400, 500); ctx.fillStyle = '#d7c099'; ctx.fillRect(0, 380, 400, 120);
    ctx.fillStyle = '#e4bca4'; ctx.beginPath(); ctx.arc(200, 89, 40, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#233c50'; ctx.fillRect(151, 390, 38, 110); ctx.fillRect(213, 390, 38, 110);
    ctx.drawImage(garmentImage, 100, 150); ctx.clearRect(0, 0, 12, 12);
  });
  const colors = ['#f43f5e', '#06b6d4', '#a855f7', '#f59e0b', '#22c55e', '#2563eb'];
  const designs = colors.map((color, index) => ({ referenceType: 'pattern', url: raster(80, 80, ctx => {
    ctx.fillStyle = color; ctx.fillRect(7, 7, 24, 66); ctx.fillRect(7, 46, 66, 27);
    ctx.beginPath(); ctx.moveTo(40, 8); ctx.lineTo(74, 28); ctx.lineTo(40, 38); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 25px sans-serif'; ctx.fillText(String(index + 1), 38, 68);
  }) }));
  const positions = [[37, 29], [53, 34], [66, 43], [37, 53], [51, 64], [65, 72]];
  const editorState: PrintInputEditorState = { version: 1, coverageMode: 'spot', outputScale: 2, placementConfirmed: true, printableSurfaceEnabled: true,
    manualPrintableSurface: await buildEncodedManualPrintableSurface({ garmentUrl: garment, editedMaskUrl: garment, manualRevision: 2 }),
    layers: [0, 2, 1, 4, 5, 3].map(designIndex => ({ designIndex, layerId: `print-design-${designIndex + 1}`,
      transform: { x: positions[designIndex][0], y: positions[designIndex][1], scale: .65 + designIndex * .055, rotation: [-18, 25, -37, 16, 40, -12][designIndex],
        opacity: designIndex === 3 ? .55 : 1, flipX: designIndex === 1 || designIndex === 5, flipY: designIndex === 2 } })) };
  const cutout: MaterialCutoutResult = { dataUrl: garment, bounds: { x: 100, y: 150, width: 200, height: 250 },
    sourceSize: { width: 400, height: 500 }, sourceFrameSize: { width: 400, height: 500 }, outputSize: { width: 200, height: 250 },
    dataUrlBytes: garment.length, storagePolicy: 'bounded-local-canvas-data-url-v1', engine: 'browser-canvas-geometric-mask-v1', hasTransparentPixels: true };
  const designResults = designs.map(design => ({ ...cutout, dataUrl: design.url, dataUrlBytes: design.url.length,
    sourceSize: { width: 80, height: 80 }, sourceFrameSize: { width: 80, height: 80 }, outputSize: { width: 80, height: 80 }, bounds: { x: 0, y: 0, width: 80, height: 80 } }));
  remote = await post('/bootstrap', { userId: 'print-probe-owner', brandId: 'print-probe-' + runId, brandName: '6件プリント検証', sourceUrl, cutout, designs, designResults, editorState,
    providerImage: raster(720, 900, ctx => { ctx.fillStyle = '#ec4899'; ctx.fillRect(0, 0, 720, 900); ctx.fillStyle = '#a855f7'; ctx.fillRect(0, 500, 720, 400); }) });
}
const { userId, brandId, brandName, sourceUrl, cutout, designs, designResults, editorState } = remote.fixture;
if (brandId !== 'print-probe-' + runId || userId !== 'print-probe-owner') throw new Error('probe_resume_scope_mismatch');
const entryKey = key + ':' + runId + ':entry';
let entry = JSON.parse(sessionStorage.getItem(entryKey) || 'null');
if (!entry) {
  entry = { kind: resumeRunId ? 'new-task-tab-restored' : 'original-task-tab', mount: remote.mounts, explicitReloads: 0 };
  sessionStorage.setItem(entryKey, JSON.stringify(entry));
}
const scope = { origin: api.origin, userId }, inputScope = { ...scope, brandId }, now = new Date().toISOString();
if (remote.mounts === 1) await persistPrintInputState(brandId, { url: sourceUrl, referenceType: 'base' }, designs,
  { garment: { processedUrl: cutout.dataUrl, processedResult: cutout, selectedMaskCandidateId: 'auto', maskRevision: 3, maskExplicitlyConfirmed: true,
    maskCandidates: [{ candidateId: 'auto', label: '自作テスト用切り抜き', description: '実AI分割ではない合成検査図', result: cutout }] },
    designs: designResults.map((result: MaterialCutoutResult) => ({ processedUrl: result.dataUrl, processedResult: result, maskRevision: 7 })) }, { scope, editorState });
const brand = { id: brandId, owner_id: userId, name: brandName, brand_colors: [], logo_url: null, tone_description: null, target_audience: null, created_at: now, updated_at: now };
useAuthStore.setState({ user: { id: userId, email: 'local@example.test', name: 'Synthetic fixture' }, currentBrand: brand, brands: [brand], isInitialized: true, isLoading: false,
  brandState: { status: 'success_nonempty', userId, requestGeneration: 1, confirmedBrandIds: [brandId], error: null } } as any);
auth.getSession = async () => ({ data: { session: { user: { id: useAuthStore.getState().user?.id }, access_token: 'local-fixture-not-a-credential' } }, error: null }) as any;
// Replace only authentication/HTTP delivery. The real provider preparation,
// durable UUID, IndexedDB snapshot, final compositor/save/readback/ack execute.
Object.assign(api, { request: call, captureRequestContext: async (assertContext?: () => void) => {
  const assertCurrent = async () => { assertContext?.(); if (useAuthStore.getState().user?.id !== userId) throw new Error('fixture_session_changed'); };
  await assertCurrent(); return { userId, assertCurrent, call: async (path: string, init?: RequestInit) => { await assertCurrent(); const value = await call(path, init); await assertCurrent(); return value; } };
} });
const actualInvoke = api.invokeProviderAction.bind(api);
api.invokeProviderAction = async (...args: Parameters<typeof actualInvoke>) => {
  const receipt: any = await actualInvoke(...args);
  // The fixture has no publicly hosted HTTPS media. Deliver the exact saved
  // PNG bytes to the real result UI, keeping all canonical identities intact.
  return { ...receipt, imageUrl: finalMedia.get(receipt.imageUrl) ?? receipt.imageUrl,
    images: receipt.images?.map((image: any) => ({ ...image, imageUrl: finalMedia.get(image.imageUrl) ?? image.imageUrl })) } as any;
};
history.replaceState(null, '', '/lightchain/printing-image' + (resumeRunId ? '?resumeRun=' + encodeURIComponent(resumeRunId) : ''));
const snapshotFor = async (state: RestoredPrintInputState, outputScale = state.editorState!.outputScale) => buildPrintRequestSnapshot({ revision: 1, brandId, brandName,
  garmentUrl: state.garment!.processedUrl!, garmentReferenceType: state.garment!.referenceType, garmentMaskCandidateId: 'auto', garmentMaskRevision: state.garment!.maskRevision!,
  coverageMode: state.editorState!.coverageMode, stageSize: { width: 720 * outputScale, height: 900 * outputScale },
  ...(state.editorState!.printableSurfaceEnabled ? { printableSurface: state.editorState!.manualPrintableSurface } : {}),
  designs: state.editorState!.layers.map(layer => ({ id: layer.layerId, sourceUrl: state.designs[layer.designIndex].processedUrl!,
    maskRevision: state.designs[layer.designIndex].maskRevision!, transform: layer.transform })) });
const readState = () => restorePrintInputState(brandId, { scope });
const waitForWorkbenchReady = async () => {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (initializationError) throw new Error(initializationError);
    const workbench = document.querySelector('[data-testid="lightchain-print-parity-view"]');
    if (workbench && workbench.textContent?.includes('6 / 6件')) {
      const state = await readState();
      const ready = Boolean(state.garment?.processedUrl)
        && state.designs.length === 6
        && state.designs.every((image) => Boolean(image.processedUrl))
        && state.editorState?.layers.length === 6;
      releaseRestoredPrintInput(state.garment);
      state.designs.forEach(releaseRestoredPrintInput);
      if (ready) return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  throw new Error('probe_workbench_readiness_timeout');
};
const rootElement = document.querySelector('#root');
if (!rootElement) throw new Error('probe_root_missing');
try {
  createRoot(rootElement).render(<ProbeErrorBoundary><BrowserRouter><LightchainUnifiedWorkspaceShell><LightchainMaterialWorkbenchPage /></LightchainUnifiedWorkspaceShell><Toaster /></BrowserRouter></ProbeErrorBoundary>);
} catch (error) {
  captureInitializationError('React render initialization error', error);
  throw error;
}
const report = async (phase: string, extra: Record<string, unknown> = {}) => {
  const status = Object.values(checks).every(Boolean) ? 'pass' : 'fail'; output.textContent = JSON.stringify({ phase, status, checks, ...extra }, null, 2);
  await post('/report', { phase, status, checks: { ...checks }, ...extra, browser: navigator.userAgent });
};
const guarded = (id: string, action: () => Promise<void>) => document.querySelector('#' + id)!.addEventListener('click', async () => {
  if (id === 'native' && !workbenchReady) return;
  const button = document.querySelector<HTMLButtonElement>('#' + id)!; button.disabled = true;
  try { await action(); } catch (error) { output.textContent = JSON.stringify({ status: 'fail', checks, error: String(error) }, null, 2); button.disabled = false; }
});

guarded('native', async () => {
  check(!remote.reports.native, 'native_baseline_must_not_be_overwritten');
  const state = await readState(), snapshot = await snapshotFor(state);
  check(state.designs.length === 6 && state.editorState?.layers.length === 6, 'six_inputs_and_ordered_layers');
  const input = await renderPrintProviderInput({ snapshot, sourceImageUrl: state.garment!.url, garmentCutout: state.garment!.processedResult! });
  const photo = await decode(input.referenceImageUrls[0]), composite = await decode(input.imageUrl), mask = await decode(input.providerMask.dataUrl);
  let protectedMismatch = 0, protectedCount = 0;
  for (let at = 0; at < mask.rgba.length; at += 4) if (mask.rgba[at + 3] === 255) {
    protectedCount++; if ([0, 1, 2, 3].some(channel => photo.rgba[at + channel] !== composite.rgba[at + channel])) protectedMismatch++;
  }
  check(protectedMismatch === 0 && protectedCount > photo.width * photo.height * .8, 'precomposition_preserves_whole_photo_outside_print');
  const contributions = [];
  for (const layer of snapshot.designs) {
    const reduced = await renderPrintProviderInput({ snapshot: { ...snapshot, designs: snapshot.designs.filter(item => item.id !== layer.id) }, sourceImageUrl: sourceUrl, garmentCutout: cutout });
    const pixels = (await decode(reduced.imageUrl)).rgba; let changed = 0;
    for (let at = 0; at < pixels.length; at += 4) if ([0, 1, 2, 3].some(channel => pixels[at + channel] !== composite.rgba[at + channel])) changed++;
    contributions.push({ layerId: layer.id, visibleChangedPixels: changed }); check(changed > 50, `visible_contribution_${layer.id}`);
  }
  const smaller = await renderPrintProviderInput({ snapshot: await snapshotFor(state, 1), sourceImageUrl: sourceUrl, garmentCutout: cutout });
  check(input.metadata.artworkPlacement.width === smaller.metadata.artworkPlacement.width * 2 && composite.width === 1440 && composite.height === 1800, 'same_layout_at_720_and_1440');
  const exact = await renderPrintRequestComposition(snapshot, 'exact'), fabric = await renderPrintRequestComposition(snapshot, 'fabric');
  check(exact !== fabric && (await decode(exact)).width === 1440, 'existing_exact_and_fabric_renderers_native_png');
  const protectedInput = await prepareProtectedCloudflareEdit({ brandId, prompt: 'Native layout fixture', imageUrls: [input.imageUrl, ...input.referenceImageUrls], maskDataUrl: input.providerMask.dataUrl });
  const prepared = await prepareCloudflareImageInput('edit-image', protectedInput.body);
  const references = await Promise.all((prepared.imageUrls as string[]).map(decode));
  check(references.length === 3 && references.every(reference => Math.max(reference.width, reference.height) <= 512), 'three_bounded_references_for_six_artworks');
  check((await restorePrintInputState(brandId, { scope: { ...scope, userId: 'foreign' } })).designs.length === 0, 'foreign_user_inputs_absent');
  show('元の写真', input.referenceImageUrls[0]); show('全6件のAI入力（合成、未生成）', input.imageUrl); show('既存のexactプレビュー', exact); show('既存のfabricプレビュー', fabric);
  await report('native', { editorState: state.editorState, metadata: input.metadata, contributions,
    referenceSizes: references.map(reference => [reference.width, reference.height]), protectedMismatch });
});

guarded('initial', async () => {
  remote = await call('/state'); const pending = await listProtectedImageInputs(inputScope), state = await readState();
  check(remote.providerPosts === 1 && remote.inferences === 1 && remote.finalSavePosts === 1, 'one_inference_then_final_save_outage');
  check(pending.length === 1 && Object.keys(remote.saves).length === 0, 'failed_save_keeps_original_pending_uuid_and_bytes');
  const entry = await loadProtectedImageInput(inputScope, pending[0].requestId), request: any = Object.values(remote.requests)[0];
  check(request.body.imageUrls.length === 3 && request.body.compositionPreview.printProviderInput.designCount === 6, 'actual_page_sent_all_six_in_three_refs');
  check(request.body.compositionPreview.printProviderInput.compositionSha256 === remote.reports.native.metadata.compositionSha256, 'actual_page_sent_the_checked_precomposition');
  check(entry.prepared.body.compositionPreview.printProviderInput.designCount === 6 && stableJson(state.editorState) === stableJson(remote.reports.native.editorState), 'pending_and_editor_layout_preserved');
  check(remote.reports.initial == null, 'initial_report_not_previously_dispatched');
  await report('initial', { requestId: pending[0].requestId, inputDigest: await protectedImageDigest(entry.prepared.sourceImageUrl),
    resumedEntry: JSON.parse(sessionStorage.getItem(entryKey)!) });
  const progress = JSON.parse(sessionStorage.getItem(entryKey)!); progress.explicitReloads++; sessionStorage.setItem(entryKey, JSON.stringify(progress)); location.reload();
});
guarded('reload', async () => {
  remote = await call('/state'); check(remote.finalSavePosts === 2 && remote.reusePosts === 1, 'canonical_final_artifact_saved_and_reused');
  check((await listProtectedImageInputs(inputScope)).length === 0, 'ack_after_history_save');
  const progress = JSON.parse(sessionStorage.getItem(entryKey)!); progress.explicitReloads++; sessionStorage.setItem(entryKey, JSON.stringify(progress)); location.reload();
});
guarded('final', async () => {
  remote = await call('/state'); const state = await readState(), request: any = Object.values(remote.requests)[0], saved: any = Object.values(remote.saves)[0];
  const baselineMount = remote.reports.initial.server.mounts;
  const progress = JSON.parse(sessionStorage.getItem(entryKey)!);
  check(progress.explicitReloads === 2 && remote.mounts === baselineMount + 2 && remote.providerPosts === 1 && remote.inferences === 1 && remote.finalSavePosts === 2 && remote.reusePosts === 1, 'two_explicit_reloads_one_inference_two_save_attempts_one_canonical_reuse');
  check(JSON.stringify(remote.mountCounts) === JSON.stringify([[0, 0, 0], [1, 1, 0], [1, 2, 1]]), 'no_automatic_generation_on_reload');
  check(stableJson(state.editorState) === stableJson(remote.reports.native.editorState), 'six_layer_order_transforms_manual_plane_and_scale_survive_reload');
  check((await listProtectedImageInputs(inputScope)).length === 0, 'acknowledged_pending_snapshot_removed');
  const input = await renderPrintProviderInput({ snapshot: await snapshotFor(state), sourceImageUrl: state.garment!.url, garmentCutout: state.garment!.processedResult! });
  const original = await decode(input.referenceImageUrls[0]), final = await decode(saved.imageUrl), mask = await decode(input.providerMask.dataUrl);
  let mismatches = 0, edited = 0;
  for (let at = 0; at < mask.rgba.length; at += 4) {
    if (mask.rgba[at + 3] === 255 && [0, 1, 2, 3].some(channel => original.rgba[at + channel] !== final.rgba[at + channel])) mismatches++;
    if (mask.rgba[at + 3] === 0 && original.rgba[at] !== final.rgba[at]) edited++;
  }
  check(final.width === 1440 && final.height === 1800 && mismatches === 0 && edited > 1000, 'saved_final_png_keeps_every_outside_footprint_rgba_pixel');
  const history = await restorePrintResultHistory(brandId, scope);
  try {
    check(history.length === 1 && history[0].inputLineage?.length === 7 && (await decode(history[0].imageUrl)).width === 1440, 'real_history_restores_final_png_and_seven_source_roles');
    check(document.querySelectorAll('[data-testid="lightchain-print-parity-view"] [data-testid="print-result-run"]').length === 1, 'real_page_displays_one_restored_result');
  } finally { history.forEach(releaseRestoredPrintResult); }
  show('保存・再読み込み後の最終PNG（fixture AI）', saved.imageUrl);
  await report('final', { requestId: request.receipt.requestId, finalImageId: saved.remote.imageId, finalSize: [final.width, final.height], protectedPixelMismatches: mismatches, editablePixelsChanged: edited,
    entry: progress, originalNativeMount: remote.reports.native.server.mounts, preReloadMount: baselineMount });
});
setProbeStatus(`実画面を初期化しています。現在のマウント: ${remote.mounts}。6件の保存済み入力と実ワークベンチを確認します。`);
void waitForWorkbenchReady().then(() => {
  workbenchReady = true;
  if (nativeButton) nativeButton.disabled = false;
  setProbeStatus(`実画面の準備ができました。現在のマウント: ${remote.mounts}。初回は「配置と画素の検証」、次に下の実画面で権利確認とAI生成を行います。`);
}).catch((error) => captureInitializationError('Workbench initialization failed', error));
