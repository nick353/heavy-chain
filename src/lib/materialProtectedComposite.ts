import {validateProtectedOpenAIProjection,type ProtectedOpenAIProjectionProof} from './protectedOpenAIProjection';
import { validateNativePrintFinalFrame,NATIVE_PRINT_FRAME_TOLERANCE,type NativePrintFinalFrame } from './nativePrintFinalFrame';
import { buildProviderMaskGuide, composeProviderProtectedResult } from '../features/lightchain/providerMask';
import { protectedImageDigest, protectedImageSaveRequestId } from './protectedImageEditContract';
import { findWorkspaceArtifactPersisted, saveWorkspaceArtifactPersisted, type WorkspaceArtifact,
  type WorkspaceArtifactInput } from './localWorkspaceArtifacts';
import { protectedEditCandidateSaveInput } from './cloudflareProtectedImageEdit';
import type { ProtectedEditSaveInput, ProtectedEditLifecycle, ProtectedEditLifecycleContext, PreparedProtectedCloudflareEdit, ProtectedMaterialRecoveryBinding } from './cloudflareProtectedImageEdit';
import type { Json } from '../types/database';

export const MATERIAL_COMPOSITION_MODE = 'source-protected-native-frame-v1' as const;
export const MATERIAL_DIGEST_SCHEME = 'sha256-data-url-utf8-v1' as const;
type DurableOriginal = { dataUrl: string; digest: string; width: number; height: number };
export type NativePrintFrameBinding = { version: 1; original: DurableOriginal; providerPrimaryDigest: string; stageMaskDigest: string;
  stageWidth: number; stageHeight: number; frame: { x: number; y: number; width: number; height: number };
  printingSnapshot: { compositionSha256: string; maskSha256: string; originalFrameSha256: string } };
export type ProtectedMaterialComposite = {
  version: 1;
  requestId: string;
  candidateIndex: 0 | 1 | 2 | 3;
  stage: 'prepared' | 'candidate-ready' | 'composed' | 'saved';
  original: { dataUrl: string; digest: string; width: number; height: number };
  mask: { dataUrl: string; digest: string; width: number; height: number };
  candidate?: { dataUrl: string; digest: string };
  nativePrintFrame?: NativePrintFrameBinding;
  openAIProjection?:ProtectedOpenAIProjectionProof;
  providerLineage?: { provider: string; jobId?: string; imageId?: string; storagePath?: string; requestId?: string };
  /** Exact original finalizer core, retained locally for fingerprint-identical save-only recovery. */
  saveInput?: Omit<ProtectedEditSaveInput, 'imageUrl'>;
  final?: { artifactId: string; saveRequestId: string; digest: string; width: number; height: number;
    compositionMode: typeof MATERIAL_COMPOSITION_MODE };
};
const png = (value: unknown): value is string => typeof value === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const size = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 4096;
function fail(stage: string): never { throw new Error(`material_protected_${stage}`); }
export const materialCompositeMetadata = (state: ProtectedMaterialComposite): Json => JSON.parse(JSON.stringify(state)) as Json;

/** The digest covers the UTF-8 data URL string, never claimed to be PNG binary bytes. */
export async function validateMaterialCompositeState(value: unknown): Promise<ProtectedMaterialComposite> {
  if (!record(value) || value.version !== 1 || typeof value.requestId !== 'string'
    || !['prepared', 'candidate-ready', 'composed', 'saved'].includes(String(value.stage))) fail('state_invalid');
  await protectedImageSaveRequestId(value.requestId as string, Number(value.candidateIndex));
  if (!Number.isSafeInteger(value.candidateIndex)) fail('candidate_index_invalid');
  for (const key of ['original', 'mask']) {
    const input = value[key];
    if (!record(input) || !png(input.dataUrl) || !size(input.width) || !size(input.height)
      || input.digest !== await protectedImageDigest(input.dataUrl)) fail(`${key}_identity_invalid`);
  }
  const state = value as unknown as ProtectedMaterialComposite;
  if (state.openAIProjection) validateProtectedOpenAIProjection(state.openAIProjection,{sourceWidth:state.nativePrintFrame?.stageWidth ?? state.original.width,sourceHeight:state.nativePrintFrame?.stageHeight ?? state.original.height,sourceSha256:state.nativePrintFrame?.providerPrimaryDigest ?? state.original.digest,maskSha256:state.mask.digest});
  if (state.nativePrintFrame) {
    await validateNativePrintFrameBinding(state.nativePrintFrame);
    if (state.nativePrintFrame.original.digest !== state.original.digest || state.nativePrintFrame.original.dataUrl !== state.original.dataUrl
      || state.nativePrintFrame.original.width !== state.original.width || state.nativePrintFrame.original.height !== state.original.height
      || state.nativePrintFrame.stageWidth !== state.mask.width || state.nativePrintFrame.stageHeight !== state.mask.height
      || state.nativePrintFrame.stageMaskDigest !== state.mask.digest) fail('native_print_identity_mismatch');
  } else if (state.original.width !== state.mask.width || state.original.height !== state.mask.height) fail('mask_dimensions_mismatch');
  if (state.stage !== 'prepared') {
    if (!record(state.candidate) || !png(state.candidate.dataUrl)
      || state.candidate.digest !== await protectedImageDigest(state.candidate.dataUrl)
      || !record(state.providerLineage) || typeof state.providerLineage.provider !== 'string' || !state.providerLineage.provider) fail('candidate_identity_invalid');
  }
  if (state.stage === 'composed' || state.stage === 'saved') {
    const final = state.final;
    const saveRequestId = await protectedImageSaveRequestId(state.requestId, state.candidateIndex);
    if (!record(final) || final.saveRequestId !== saveRequestId || final.artifactId !== `wa-${saveRequestId}`
      || final.compositionMode !== MATERIAL_COMPOSITION_MODE || final.width !== state.original.width
      || final.height !== state.original.height || !/^[0-9a-f]{64}$/.test(String(final.digest))) fail('final_identity_invalid');
  }
  return state;
}

/** Keep an existing PNG string byte-for-byte; rasterize other durable inputs once. */
export async function materializeMaterialPng(url: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const decoded = new Image();
    if (/^https?:/i.test(url)) decoded.crossOrigin = 'anonymous';
    decoded.onload = () => resolve(decoded);
    decoded.onerror = () => reject(new Error('material_protected_image_decode_failed'));
    decoded.src = url;
  });
  const width = image.naturalWidth || image.width; const height = image.naturalHeight || image.height;
  if (!size(width) || !size(height)) fail('source_exceeds_4096px');
  if (png(url)) return { dataUrl: url, width, height };
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); if (!context) fail('canvas_unavailable');
  context.drawImage(image, 0, 0);
  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}

export async function persistMaterialCompositeLocal(input: WorkspaceArtifactInput, state: ProtectedMaterialComposite): Promise<WorkspaceArtifact> {
  await validateMaterialCompositeState(state);
  const saved = saveWorkspaceArtifactPersisted({ ...input, metadata: { ...input.metadata,
    protectedMaterialComposite: materialCompositeMetadata(state), protectedMaterialDigestScheme: MATERIAL_DIGEST_SCHEME } });
  if (!saved.ok) throw saved.error;
  const readback = findWorkspaceArtifactPersisted(input.brandId, saved.artifact.id, input.scopeId);
  if (!readback.ok) throw readback.error;
  if (!readback.artifact || readback.artifact.imageUrl !== input.imageUrl
    || JSON.stringify(readback.artifact.metadata.protectedMaterialComposite) !== JSON.stringify(materialCompositeMetadata(state))) fail('local_readback_failed');
  return readback.artifact;
}

export async function prepareMaterialComposite(input: Omit<WorkspaceArtifactInput, 'imageUrl' | 'id'>,
  sourceImageUrl: string, maskDataUrl: string, requestId = crypto.randomUUID(),
  nativePrint?: { providerPrimaryDataUrl: string; frame: NativePrintFrameBinding['frame']; printingSnapshot: NativePrintFrameBinding['printingSnapshot'] }): Promise<WorkspaceArtifact> {
  const [original, mask] = await Promise.all([materializeMaterialPng(sourceImageUrl), materializeMaterialPng(maskDataUrl)]);
  if (!nativePrint) {
    const guide = await buildProviderMaskGuide({ sourceImageUrl: original.dataUrl, maskDataUrl: mask.dataUrl });
    original.dataUrl = guide.sourceDataUrl;
  }
  const state: ProtectedMaterialComposite = { version: 1, requestId, candidateIndex: 0, stage: 'prepared',
    original: { ...original, digest: await protectedImageDigest(original.dataUrl) },
    mask: { ...mask, digest: await protectedImageDigest(mask.dataUrl) } };
  if (nativePrint) {
    const primary = await materializeMaterialPng(nativePrint.providerPrimaryDataUrl);
    if (primary.width !== mask.width || primary.height !== mask.height) fail('native_print_stage_dimensions_mismatch');
    state.nativePrintFrame = { version: 1, original: state.original, providerPrimaryDigest: await protectedImageDigest(primary.dataUrl),
      stageMaskDigest: state.mask.digest, stageWidth: mask.width, stageHeight: mask.height, frame: { ...nativePrint.frame }, printingSnapshot: { ...nativePrint.printingSnapshot } };
  }
  return persistMaterialCompositeLocal({ ...input, id: `material-stage-${requestId}`, imageUrl: original.dataUrl }, state);
}

export async function retainMaterialCandidate(staging: WorkspaceArtifact, imageUrl: string,
  providerLineage: NonNullable<ProtectedMaterialComposite['providerLineage']>, candidateIndex: 0 | 1 | 2 | 3 = 0): Promise<WorkspaceArtifact> {
  const state = await validateMaterialCompositeState(staging.metadata.protectedMaterialComposite);
  const candidate = await materializeMaterialPng(imageUrl);
  const next: ProtectedMaterialComposite = { ...state, candidateIndex, stage: 'candidate-ready', final: undefined,
    candidate: { dataUrl: candidate.dataUrl, digest: await protectedImageDigest(candidate.dataUrl) }, providerLineage };
  return persistMaterialCompositeLocal({ ...staging, sourceJobId: providerLineage.jobId, imageUrl: state.original.dataUrl }, next);
}

/** Validate the canonical local bytes before either retention or a save-only retry. */
export async function validateMaterialCompositeArtifact(artifact: WorkspaceArtifact): Promise<ProtectedMaterialComposite> {
  const state = await validateMaterialCompositeState(artifact.metadata.protectedMaterialComposite);
  if (!state.final || !['composed', 'saved'].includes(state.stage) || !png(artifact.imageUrl)
    || artifact.id !== state.final.artifactId || artifact.metadata.cloudflareWorkspaceRequestId !== state.final.saveRequestId
    || state.final.digest !== await protectedImageDigest(artifact.imageUrl)) fail('artifact_identity_invalid');
  return state;
}

export async function retainMaterialComposite(staging: WorkspaceArtifact,
  composite: { dataUrl: string; width: number; height: number; mode: string }): Promise<WorkspaceArtifact> {
  const state = await validateMaterialCompositeState(staging.metadata.protectedMaterialComposite);
  if (!state.candidate || composite.mode !== MATERIAL_COMPOSITION_MODE
    || composite.width !== state.original.width || composite.height !== state.original.height || !png(composite.dataUrl)) fail('composition_identity_invalid');
  const saveRequestId = await protectedImageSaveRequestId(state.requestId, state.candidateIndex);
  const final: NonNullable<ProtectedMaterialComposite['final']> = { artifactId: `wa-${saveRequestId}`, saveRequestId,
    digest: await protectedImageDigest(composite.dataUrl), width: composite.width, height: composite.height,
    compositionMode: MATERIAL_COMPOSITION_MODE };
  const artifact = await persistMaterialCompositeLocal({ ...staging, id: final.artifactId, imageUrl: composite.dataUrl,
    metadata: { ...staging.metadata, cloudflareWorkspaceRequestId: saveRequestId, storagePath: null,
      providerStoragePath: state.providerLineage?.storagePath ?? null, outputSize: { width: final.width, height: final.height },
      protectedRegionComposited: true, persistenceStatus: 'pending' } }, { ...state, stage: 'composed', final });
  await validateMaterialCompositeArtifact(artifact);
  return artifact;
}

export async function composeMaterialCandidate(staging: WorkspaceArtifact): Promise<WorkspaceArtifact> {
  const state = await validateMaterialCompositeState(staging.metadata.protectedMaterialComposite);
  if (!state.candidate) fail('candidate_required');
  const composite = state.openAIProjection ? await composeMappedOpenAICandidate(state,state.candidate.dataUrl) : state.nativePrintFrame ? await composeNativePrintCandidate(state.nativePrintFrame, state.candidate.dataUrl, state.mask.dataUrl)
    : await composeProviderProtectedResult({ sourceImageUrl: state.original.dataUrl, providerImageUrl: state.candidate.dataUrl, maskDataUrl: state.mask.dataUrl, preserveSourceDimensions: true });
  return retainMaterialComposite(staging, composite);
}

/** A compact remote proof contains identities only; recovery PNGs stay local. */
export function materialRemoteProjection(state: ProtectedMaterialComposite): Json {
  return materialCompositeMetadata({ version: state.version, requestId: state.requestId, candidateIndex: state.candidateIndex,
    stage: 'composed', original: { digest: state.original.digest, width: state.original.width, height: state.original.height },
    mask: { digest: state.mask.digest, width: state.mask.width, height: state.mask.height },
    candidate: { digest: state.candidate?.digest }, providerLineage: state.providerLineage, final: state.final,
    ...(state.openAIProjection ? {openAIProjection:state.openAIProjection} : {}),
    ...(state.nativePrintFrame ? { nativePrintFrame: { ...state.nativePrintFrame, original: { digest: state.original.digest, width: state.original.width, height: state.original.height } } } : {}),
    proofSchema: 'protected-material-identity-v1', digestScheme: MATERIAL_DIGEST_SCHEME } as unknown as ProtectedMaterialComposite);
}
const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  record(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export async function assertMaterialRemoteIdentity(artifact: WorkspaceArtifact, remote: { jobId: string; imageId: string; storagePath: string }, metadata: unknown) {
  const state = await validateMaterialCompositeArtifact(artifact);
  const actual = record(metadata) ? metadata.protectedMaterialComposite : null;
  if (!record(actual) || !['composed', 'saved'].includes(String(actual.stage)) || remote.imageId !== artifact.id || remote.jobId !== artifact.id
    || remote.storagePath !== `generated-images/${artifact.id}`
    || canonicalJson({ ...actual, stage: 'composed' }) !== canonicalJson(materialRemoteProjection(state))) fail('remote_readback_mismatch');
}

/** Fetch the actual saved PNG. Compare raw binary bytes, not a data-URL digest
 * or caller metadata. Equality also proves the saved raster is the canonical one. */
export async function verifyMaterialSavedPng(artifact: WorkspaceArtifact, imageUrl: string, assertCurrent: () => void | Promise<void>) {
  const state = await validateMaterialCompositeArtifact(artifact);
  await assertCurrent();
  const response = await fetch(imageUrl, { credentials: 'omit', cache: 'no-store' });
  if (!response.ok) fail('saved_png_read_failed');
  const actual = new Uint8Array(await response.arrayBuffer());
  await assertCurrent();
  const expected = Uint8Array.from(atob(artifact.imageUrl.split(',')[1]), character => character.charCodeAt(0));
  const signature = [137,80,78,71,13,10,26,10];
  if (actual.length < 24 || signature.some((byte,index) => actual[index] !== byte)
    || String.fromCharCode(...actual.slice(12,16)) !== 'IHDR') fail('saved_png_invalid');
  const view = new DataView(actual.buffer, actual.byteOffset, actual.byteLength);
  if (view.getUint32(16) !== state.final!.width || view.getUint32(20) !== state.final!.height
    || actual.length !== expected.length || actual.some((byte,index) => byte !== expected[index])) fail('saved_png_bytes_mismatch');
  await assertCurrent();
}

function sameMaterialInputs(a: ProtectedMaterialComposite, b: ProtectedMaterialComposite) {
  return a.requestId === b.requestId && a.candidateIndex === b.candidateIndex
    && a.original.digest === b.original.digest && a.mask.digest === b.mask.digest
    && a.original.width === b.original.width && a.original.height === b.original.height
    && a.candidate?.digest === b.candidate?.digest
    && canonicalJson(a.providerLineage) === canonicalJson(b.providerLineage)
    && canonicalJson(a.nativePrintFrame) === canonicalJson(b.nativePrintFrame)
    && canonicalJson(a.openAIProjection) === canonicalJson(b.openAIProjection);
}

/** GET the existing UUID before a save retry. Pending, unknown and mismatched
 * readbacks never turn into a write. There is deliberately no provider callback. */
export async function retryMaterialCompositeSave(artifact: WorkspaceArtifact, options: {
  assertCurrent(): void | Promise<void>;
  readRemote(requestId: string): Promise<{ remote: { jobId: string; imageId: string; storagePath: string }; metadata?: unknown }>;
  save(artifact: WorkspaceArtifact): Promise<unknown>;
  readSavedImage(storagePath: string): Promise<string>;
}): Promise<WorkspaceArtifact> {
  const state = await validateMaterialCompositeArtifact(artifact);
  await options.assertCurrent();
  let found: Awaited<ReturnType<typeof options.readRemote>> | undefined;
  try { found = await options.readRemote(state.final!.saveRequestId); }
  catch (error) {
    await options.assertCurrent();
    if (!(error instanceof Error && /_404_workspace_artifact_not_found$/.test(error.message))) throw error;
  }
  await options.assertCurrent();
  if (!found) {
    await options.save(artifact);
    await options.assertCurrent();
    found = await options.readRemote(state.final!.saveRequestId);
    await options.assertCurrent();
  }
  await assertMaterialRemoteIdentity(artifact, found.remote, found.metadata);
  const imageUrl = await options.readSavedImage(found.remote.storagePath);
  await options.assertCurrent();
  await verifyMaterialSavedPng(artifact,imageUrl,options.assertCurrent);
  const saved = await persistMaterialCompositeLocal({ ...artifact, sourceJobId: found.remote.jobId,
    metadata: { ...artifact.metadata, ...(record(found.metadata) ? found.metadata as Record<string, Json> : {}), remoteSaveStatus: 'succeeded', remoteJobId: found.remote.jobId,
      remoteImageId: found.remote.imageId, remoteStoragePath: found.remote.storagePath,
      storagePath: found.remote.storagePath, imageId: found.remote.imageId, persistenceStatus: 'completed' } }, { ...state, stage: 'saved' });
  await options.assertCurrent();
  await validateMaterialCompositeArtifact(saved);
  return saved;
}

/** Reconstructed from the serializable pending snapshot on every invocation. */
export async function createMaterialProtectedLifecycle(binding: ProtectedMaterialRecoveryBinding,
  prepared: PreparedProtectedCloudflareEdit, scope: { brandId: string; userId: string },
  assertCurrent: () => Promise<void>): Promise<ProtectedEditLifecycle> {
  if (binding.version !== 1 || binding.brandId !== scope.brandId || binding.scopeId !== scope.userId
    || binding.stateArtifactId !== `material-stage-${binding.requestId}`
    || String(prepared.body.brandId ?? prepared.body.brand_id) !== binding.brandId
    || !binding.generationInputSignature) fail('recovery_binding_invalid');
  const readStage = async () => {
    await assertCurrent();
    const readback = findWorkspaceArtifactPersisted(binding.brandId, binding.stateArtifactId, binding.scopeId);
    if (!readback.ok) throw readback.error;
    let staging = readback.artifact;
    if (!staging || staging.brandId !== binding.brandId || staging.scopeId !== binding.scopeId
      || staging.metadata.generationInputSignature !== binding.generationInputSignature) fail('recovery_scope_changed');
    let state = await validateMaterialCompositeState(staging.metadata.protectedMaterialComposite);
    const initialMapping = prepared.body.protectedOpenAIProjection ? validateProtectedOpenAIProjection(prepared.body.protectedOpenAIProjection,prepared.plan) : undefined;
    if (initialMapping && !state.openAIProjection && state.stage === 'prepared') {
      state={...state,openAIProjection:initialMapping};staging=await persistMaterialCompositeLocal(staging,state);await assertCurrent();
    }
    if (canonicalJson(state.openAIProjection)!==canonicalJson(initialMapping)) fail('openai_recovery_mapping_changed');
    if(initialMapping){const native=validateNativePrintFinalFrame(prepared.body.nativePrintFinalFrame,prepared.plan);
      if(native.original.digest!==state.original.digest||native.original.width!==state.original.width||native.original.height!==state.original.height||canonicalJson(native.frame)!==canonicalJson(state.nativePrintFrame?.frame ?? {x:0,y:0,width:state.original.width,height:state.original.height})||canonicalJson(native.mapping)!==canonicalJson(initialMapping)
        ||(state.nativePrintFrame && native.printingSnapshotDigest!==(await nativePrintFinalFrameFor(state.nativePrintFrame)).printingSnapshotDigest))fail('openai_native_binding_changed');}
    if (state.nativePrintFrame && canonicalJson(state.nativePrintFrame) !== canonicalJson(prepared.nativePrintFrameBinding)) fail('native_print_recovery_binding_changed');
    if (state.nativePrintFrame && !state.openAIProjection && canonicalJson(await nativePrintFinalFrameFor(state.nativePrintFrame)) !== canonicalJson(prepared.body.nativePrintFinalFrame)) fail('native_print_stored_binding_changed');
    const primaryDigest = state.nativePrintFrame?.providerPrimaryDigest ?? state.original.digest;
    const primaryWidth = state.nativePrintFrame?.stageWidth ?? state.original.width;
    const primaryHeight = state.nativePrintFrame?.stageHeight ?? state.original.height;
    if (state.requestId !== binding.requestId || primaryDigest !== prepared.plan.sourceSha256
      || state.mask.digest !== prepared.plan.maskSha256 || primaryWidth !== prepared.plan.sourceWidth
      || primaryHeight !== prepared.plan.sourceHeight
      || await protectedImageDigest(prepared.sourceImageUrl) !== primaryDigest
      || await protectedImageDigest(prepared.maskDataUrl) !== state.mask.digest) fail('recovery_inputs_changed');
    await assertCurrent();
    return { staging, state };
  };
  await readStage();
  const checkContext = async (context: ProtectedEditLifecycleContext) => {
    if (context.receipt.requestId !== binding.requestId
      || context.saveRequestId !== await protectedImageSaveRequestId(binding.requestId, context.candidateIndex)) fail('recovery_request_changed');
    return readStage();
  };
  const getFinal = async (context: ProtectedEditLifecycleContext) => {
    const { state } = await checkContext(context);
    const readback = findWorkspaceArtifactPersisted(binding.brandId, `wa-${context.saveRequestId}`, binding.scopeId);
    if (!readback.ok) throw readback.error;
    if (!readback.artifact) return undefined;
    const finalState = await validateMaterialCompositeArtifact(readback.artifact);
    if (!sameMaterialInputs(state, finalState) || finalState.candidateIndex !== context.candidateIndex
      || readback.artifact.scopeId !== binding.scopeId || readback.artifact.brandId !== binding.brandId
      || readback.artifact.metadata.generationInputSignature !== binding.generationInputSignature) fail('recovery_final_changed');
    await assertCurrent();
    return readback.artifact;
  };
  return {
    async onCandidate(context) {
      const { staging, state } = await checkContext(context);
      const lineage = { provider: String(context.receipt.provider), requestId: binding.requestId,
        jobId: String(context.candidate.jobId), imageId: String(context.candidate.imageId), storagePath: String(context.candidate.storagePath) };
      let retained = staging;
      if (state.candidate) {
        if (state.candidateIndex !== context.candidateIndex || JSON.stringify(state.providerLineage) !== JSON.stringify(lineage)) fail('recovery_candidate_changed');
      } else {
        retained = await retainMaterialCandidate(staging, String(context.candidate.imageUrl), lineage, context.candidateIndex);
        const candidateState = await validateMaterialCompositeState(retained.metadata.protectedMaterialComposite);
        const { imageUrl: _imageUrl, ...saveInput } = protectedEditCandidateSaveInput(context, { dataUrl: candidateState.original.dataUrl, width: candidateState.original.width, height: candidateState.original.height });
        retained = await persistMaterialCompositeLocal(retained, { ...candidateState, saveInput });
      }
      await assertCurrent();
      const retainedState = await validateMaterialCompositeState(retained.metadata.protectedMaterialComposite);
      return { dataUrl: retainedState.candidate!.dataUrl };
    },
    async getPersistedComposite(context) {
      const artifact = await getFinal(context); if (!artifact) return undefined;
      const state = await validateMaterialCompositeArtifact(artifact);
      return { dataUrl: artifact.imageUrl, width: state.final!.width, height: state.final!.height,
        mode: MATERIAL_COMPOSITION_MODE, sourceFramePlacement: { x: 0, y: 0, width: state.final!.width, height: state.final!.height } };
    },
    async onComposed(context, composite, input) {
      const { staging } = await checkContext(context);
      const previous = await getFinal(context);
      let artifact = previous ?? await retainMaterialComposite(staging, composite);
      if (artifact.imageUrl !== composite.dataUrl) fail('recovery_composite_changed');
      await assertCurrent();
      const finalState = await validateMaterialCompositeArtifact(artifact);
      const proofMetadata = { protectedMaterialComposite: materialRemoteProjection(finalState), protectedMaterialDigestScheme: MATERIAL_DIGEST_SCHEME };
      const { imageUrl: _imageUrl, ...saveInput } = { ...input, metadata: { ...proofMetadata, ...input.metadata } };
      if (previous && canonicalJson(finalState.saveInput) !== canonicalJson(saveInput)) fail('recovery_save_core_changed');
      artifact = await persistMaterialCompositeLocal({ ...artifact, featureType: input.featureType, title: input.title, prompt: input.prompt }, { ...finalState, saveInput });
      await assertCurrent();
      return proofMetadata;
    },
    async onSavedCandidate(context, saved, imageUrl) {
      const artifact = await getFinal(context); if (!artifact) fail('local_final_missing');
      await assertMaterialRemoteIdentity(artifact, saved.remote, saved.metadata);
      const state = await validateMaterialCompositeArtifact(artifact);
      await verifyMaterialSavedPng(artifact,imageUrl,assertCurrent);
      await assertCurrent();
      await persistMaterialCompositeLocal({ ...artifact, sourceJobId: saved.remote.jobId,
        metadata: { ...artifact.metadata, ...saved.metadata as Record<string, Json>, remoteSaveStatus: 'succeeded', remoteJobId: saved.remote.jobId,
          remoteImageId: saved.remote.imageId, remoteStoragePath: saved.remote.storagePath, storagePath: saved.remote.storagePath,
          imageId: saved.remote.imageId, persistenceStatus: 'completed' } }, { ...state, stage: 'saved' });
      const { staging } = await checkContext(context);
      await persistMaterialCompositeLocal(staging, { ...state, stage: 'saved' });
      await assertCurrent();
    },
  };
}

export async function materialCompositeSaveInput(artifact: WorkspaceArtifact): Promise<ProtectedEditSaveInput> {
  const state = await validateMaterialCompositeArtifact(artifact);
  const core = state.saveInput;
  if (!core || core.requestId !== state.final!.saveRequestId || core.brandId !== artifact.brandId
    || core.sourceStoragePath !== null || core.sourceJobId !== state.providerLineage?.jobId
    || core.imageAI?.requestId !== state.requestId || core.imageAI.candidateIndex !== state.candidateIndex
    || core.featureType !== artifact.featureType || core.prompt !== artifact.prompt || core.title !== artifact.title
    || canonicalJson(core.metadata.protectedMaterialComposite) !== canonicalJson(materialRemoteProjection(state))) fail('recovery_save_core_changed');
  return { ...core, imageUrl: artifact.imageUrl };
}

export async function recoverBoundMaterialComposite(binding: ProtectedMaterialRecoveryBinding,
  prepared: PreparedProtectedCloudflareEdit, scope: { brandId: string; userId: string }, options: {
    assertCurrent(): Promise<void>;
    readRemote(requestId: string): Promise<{ remote: { jobId: string; imageId: string; storagePath: string }; metadata?: unknown }>;
    save(input: ProtectedEditSaveInput): Promise<unknown>;
    readSavedImage(storagePath: string): Promise<string>;
  }): Promise<WorkspaceArtifact> {
  await createMaterialProtectedLifecycle(binding, prepared, scope, options.assertCurrent);
  const readback = findWorkspaceArtifactPersisted(binding.brandId, binding.stateArtifactId, binding.scopeId);
  if (!readback.ok) throw readback.error;
  if (!readback.artifact) fail('recovery_stage_missing');
  const staging = readback.artifact;
  const state = await validateMaterialCompositeState(staging.metadata.protectedMaterialComposite);
  if (state.stage === 'prepared') fail('provider_effect_unresolved');
  const saveId = await protectedImageSaveRequestId(state.requestId, state.candidateIndex);
  const finalReadback = findWorkspaceArtifactPersisted(binding.brandId, `wa-${saveId}`, binding.scopeId);
  if (!finalReadback.ok) throw finalReadback.error;
  let artifact = finalReadback.artifact;
  if (!artifact) {
    if (state.stage !== 'candidate-ready' || !state.saveInput) fail('recovery_final_missing');
    await options.assertCurrent();
    artifact = await composeMaterialCandidate(staging);
    const composed = await validateMaterialCompositeArtifact(artifact);
    const core = { ...state.saveInput, metadata: { protectedMaterialComposite: materialRemoteProjection(composed),
      protectedMaterialDigestScheme: MATERIAL_DIGEST_SCHEME, ...state.saveInput.metadata } };
    artifact = await persistMaterialCompositeLocal({ ...artifact, featureType: core.featureType, title: core.title, prompt: core.prompt }, { ...composed, saveInput: core });
    await options.assertCurrent();
  }
  const finalState = await validateMaterialCompositeArtifact(artifact);
  if (!sameMaterialInputs(state, finalState) || artifact.scopeId !== binding.scopeId || artifact.brandId !== binding.brandId
    || artifact.metadata.generationInputSignature !== binding.generationInputSignature) fail('recovery_final_changed');
  const saved = await retryMaterialCompositeSave(artifact, { ...options,
    save: async local => options.save(await materialCompositeSaveInput(local)) });
  await options.assertCurrent();
  const savedState = await validateMaterialCompositeArtifact(saved);
  await persistMaterialCompositeLocal(staging, savedState);
  await options.assertCurrent();
  return saved;
}

export async function validateNativePrintFrameBinding(binding: NativePrintFrameBinding,
  plan?: { sourceWidth: number; sourceHeight: number; sourceSha256: string; maskSha256: string }) {
  if (!binding || binding.version !== 1 || !png(binding.original?.dataUrl) || !size(binding.original.width) || !size(binding.original.height)
    || binding.original.digest !== await protectedImageDigest(binding.original.dataUrl)
    || !size(binding.stageWidth) || !size(binding.stageHeight) || !/^[0-9a-f]{64}$/.test(binding.providerPrimaryDigest)
    || !/^[0-9a-f]{64}$/.test(binding.stageMaskDigest)
    || binding.printingSnapshot?.compositionSha256 !== binding.providerPrimaryDigest
    || binding.printingSnapshot?.maskSha256 !== binding.stageMaskDigest
    || !/^[0-9a-f]{64}$/.test(binding.printingSnapshot?.originalFrameSha256 ?? '')) fail('native_print_binding_invalid');
  if (!record(binding.frame)) fail('native_print_frame_mismatch');
  const { x, y, width, height } = binding.frame;
  const scale = Math.min(binding.stageWidth / binding.original.width, binding.stageHeight / binding.original.height);
  const expected = { x: (binding.stageWidth - binding.original.width * scale) / 2,
    y: (binding.stageHeight - binding.original.height * scale) / 2, width: binding.original.width * scale, height: binding.original.height * scale };
  if (![x, y, width, height].every(Number.isFinite) || Object.entries(expected).some(([key, value]) => Math.abs(binding.frame[key as keyof typeof expected] - value) > NATIVE_PRINT_FRAME_TOLERANCE)) fail('native_print_frame_mismatch');
  if (plan && (plan.sourceWidth !== binding.stageWidth || plan.sourceHeight !== binding.stageHeight
    || plan.sourceSha256 !== binding.providerPrimaryDigest || plan.maskSha256 !== binding.stageMaskDigest)) fail('native_print_plan_mismatch');
}

/** Pixel-center nearest-neighbor selection preserves the binary footprint. */
export function remapNativePrintMask(binding: NativePrintFrameBinding, pixels: Uint8ClampedArray): Uint8ClampedArray {
  if (pixels.length !== binding.stageWidth * binding.stageHeight * 4) fail('native_print_mask_dimensions_mismatch');
  for (let at = 3; at < pixels.length; at += 4) if (pixels[at] !== 0 && pixels[at] !== 255) fail('native_print_mask_not_binary');
  const { width: w, height: h } = binding.original; const f = binding.frame;
  const native = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.floor(f.x + (x + 0.5) * f.width / w); const sy = Math.floor(f.y + (y + 0.5) * f.height / h);
    const from = (sy * binding.stageWidth + sx) * 4; const at = (y * w + x) * 4;
    native[at] = native[at + 1] = native[at + 2] = 255; native[at + 3] = pixels[from + 3];
  }
  return native;
}

export async function composeNativePrintCandidate(binding: NativePrintFrameBinding, candidateUrl: string, maskUrl: string) {
  await validateNativePrintFrameBinding(binding);
  const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); if (/^https?:/i.test(url)) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image); image.onerror = () => reject(new Error('material_protected_native_print_decode_failed')); image.src = url;
  });
  const [candidate, mask] = await Promise.all([load(candidateUrl), load(maskUrl)]);
  const width = candidate.naturalWidth || candidate.width; const height = candidate.naturalHeight || candidate.height;
  if (width !== binding.stageWidth || height !== binding.stageHeight) {
    throw new Error(`material_protected_native_print_candidate_geometry_unmapped:${width}x${height}:expected_${binding.stageWidth}x${binding.stageHeight}`);
  }
  if ((mask.naturalWidth || mask.width) !== binding.stageWidth || (mask.naturalHeight || mask.height) !== binding.stageHeight
    || await protectedImageDigest(maskUrl) !== binding.stageMaskDigest) fail('native_print_mask_identity_mismatch');
  const nativeCanvas = document.createElement('canvas'); nativeCanvas.width = binding.original.width; nativeCanvas.height = binding.original.height;
  const nativeContext = nativeCanvas.getContext('2d', { willReadFrequently: true }); if (!nativeContext) fail('native_print_canvas_unavailable');
  nativeContext.imageSmoothingEnabled = true; nativeContext.imageSmoothingQuality = 'high';
  const frame = binding.frame;
  nativeContext.drawImage(candidate, frame.x, frame.y, frame.width, frame.height, 0, 0, nativeCanvas.width, nativeCanvas.height);
  const candidatePng = nativeCanvas.toDataURL('image/png');
  const stageCanvas = document.createElement('canvas'); stageCanvas.width = binding.stageWidth; stageCanvas.height = binding.stageHeight;
  const stageContext = stageCanvas.getContext('2d', { willReadFrequently: true }); if (!stageContext) fail('native_print_canvas_unavailable');
  stageContext.drawImage(mask, 0, 0);
  const mappedMask = remapNativePrintMask(binding, stageContext.getImageData(0, 0, stageCanvas.width, stageCanvas.height).data);
  nativeContext.putImageData(new ImageData(new Uint8ClampedArray(mappedMask), nativeCanvas.width, nativeCanvas.height), 0, 0);
  return composeProviderProtectedResult({ sourceImageUrl: binding.original.dataUrl, providerImageUrl: candidatePng,
    maskDataUrl: nativeCanvas.toDataURL('image/png'), preserveSourceDimensions: true });
}

/** Snapshot scheme: SHA-256 of UTF-8 JSON array in composition/mask/frame order. */
export async function nativePrintFinalFrameFor(binding: NativePrintFrameBinding): Promise<NativePrintFinalFrame> {
  await validateNativePrintFrameBinding(binding);
  return validateNativePrintFinalFrame({version:'native-print-contain-v1',
    original:{width:binding.original.width,height:binding.original.height,digest:binding.original.digest,digestScheme:MATERIAL_DIGEST_SCHEME},
    stage:{width:binding.stageWidth,height:binding.stageHeight,primaryDigest:binding.providerPrimaryDigest,maskDigest:binding.stageMaskDigest},
    frame:binding.frame,printingSnapshotDigest:await protectedImageDigest(JSON.stringify([
      binding.printingSnapshot.compositionSha256,binding.printingSnapshot.maskSha256,binding.printingSnapshot.originalFrameSha256])),
    candidateGeometry:{version:'stage-frame-v1',width:binding.stageWidth,height:binding.stageHeight}});
}

/** Native sampling through original→stage→recorded preparation→OpenAI contain.
 * Only the retained mask decides protected pixels; the composite is blended once. */
export async function composeMappedOpenAICandidate(state:ProtectedMaterialComposite,candidateUrl:string) {
 const map=validateProtectedOpenAIProjection(state.openAIProjection);
 const candidate=await materializeMaterialPng(candidateUrl);
 if(candidate.width!==map.candidate.width||candidate.height!==map.candidate.height)fail('openai_candidate_geometry_mismatch');
 const load=(url:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('material_protected_openai_decode_failed'));im.src=url;});
 const image=await load(candidate.dataUrl);const f=state.nativePrintFrame?.frame ?? {x:0,y:0,width:state.original.width,height:state.original.height};
 const canvas=document.createElement('canvas');canvas.width=state.original.width;canvas.height=state.original.height;const context=canvas.getContext('2d');if(!context)fail('openai_canvas_unavailable');
 const t=map.prepared.transform,o=map.contain;
 context.drawImage(image,o.x+f.x*t.scaleX*o.scale,o.y+f.y*t.scaleY*o.scale,f.width*t.scaleX*o.scale,f.height*t.scaleY*o.scale,0,0,canvas.width,canvas.height);
 let maskUrl=state.mask.dataUrl;
 if(state.nativePrintFrame){const mask=await load(maskUrl),stage=document.createElement('canvas');stage.width=state.mask.width;stage.height=state.mask.height;const ctx=stage.getContext('2d');if(!ctx)fail('openai_canvas_unavailable');ctx.drawImage(mask,0,0);
  const native=remapNativePrintMask(state.nativePrintFrame,ctx.getImageData(0,0,stage.width,stage.height).data);const maskCanvas=document.createElement('canvas');maskCanvas.width=canvas.width;maskCanvas.height=canvas.height;const mc=maskCanvas.getContext('2d');if(!mc)fail('openai_canvas_unavailable');mc.putImageData(new ImageData(new Uint8ClampedArray(native),canvas.width,canvas.height),0,0);maskUrl=maskCanvas.toDataURL('image/png');}
 return composeProviderProtectedResult({sourceImageUrl:state.original.dataUrl,providerImageUrl:canvas.toDataURL('image/png'),maskDataUrl:maskUrl,preserveSourceDimensions:true});
}
