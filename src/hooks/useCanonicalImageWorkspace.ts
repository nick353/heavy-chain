import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { assertAuthBrandFence, captureAuthBrandFence, isAuthBrandFenceValid } from '../lib/authBrandSelection';
import { readLightchainResumeInput, readLightchainResumeResult, serializeLightchainResumeSlots, type LightchainResumeResult } from '../lib/lightchainResume';
import { listWorkspaceArtifacts, saveWorkspaceArtifactPersisted, type WorkspaceArtifact } from '../lib/localWorkspaceArtifacts';
import { readWorkspaceArtifactImage } from '../lib/workspaceArtifactImageReadback';
import { withSignedImageUrls } from '../lib/storage';
import { buildLocalCanvasAssetReference, isLocalCanvasAssetReference, putLocalCanvasAsset, resolveLocalCanvasAsset, type LocalCanvasAssetResolution } from '../lib/canvasLocalAssets';
import { buildLocalUploadSourceMetadata, type CanvasSourceMetadata } from '../features/canvasSourceMetadata';
import { assertCompletedImageEditResult, assertCompletedModelMatrixResult, normalizeCompletedModelMatrixResult, generateModelMatrix, editImageWithPrompt, generateImage, type ImageEditResult, type ModelMatrixResult } from '../lib/imageApi';
import { cloudflareDataPlane } from '../lib/cloudflareApi';
import { persistProviderResultArtifact } from '../lib/providerResultPersistence';
import { HEAVY_IMAGE_PROVIDER } from '../lib/heavyImageProvider';
import { isHeavyOwnedFeature, resolveHeavyCapability } from '../lib/heavyCapability';
import { normalizeCloudflareGeneratedImageStoragePath, normalizeGeneratedImageStoragePath } from '../lib/storagePathSafety';
import type { Json } from '../types/database';
import { defaultModelToolSettings, isModelToolFeature, isModelDescriptionFeature, modelToolSettingsPrompt, readModelToolSettings, readLegacyModelToolSettings } from '../lib/modelToolSettings';
import { normalizeGenerationSourceReferences } from '../lib/generationSourceReferences';
import { isModelLibraryFeature, readModelLibrarySettings, readLegacyModelLibrarySettings, modelLibrarySettingsPrompt, modelLibraryBodyPreview, MODEL_LIBRARY_BODY_CATALOG_SHA256 } from '../lib/modelLibrarySettings';

type SlotKey = 'primary' | 'secondary';
type Source = { name: string; kind: string; imageUrl: string; sourceImageId?: string | null; sourceStoragePath?: string | null; sourceMediaPath?: string | null;
  sourceMetadata?: CanvasSourceMetadata; persistenceStatus?: 'persistent' | 'session-only' | 'unknown'; localAssetRef?: string };
type Status = 'empty' | 'loading' | 'ready' | 'unavailable' | 'running' | 'unknown' | 'saved' | 'error';
type LibrarySettingsKind = 'absent' | 'null' | 'invalid' | 'valid';
type LibraryInputReadback = { source: 'local' | 'remote' | 'request' | 'none'; remoteLookup: 'not-needed' | 'matched' | 'no-match' | 'unavailable'; modernSettings:LibrarySettingsKind; legacySettings:LibrarySettingsKind; requestLookup:'not-needed'|'matched'|'identity-mismatch'|'unavailable'; requestModernSettings:LibrarySettingsKind|'not-read'; requestLegacySettings:LibrarySettingsKind|'not-read' };
export type CanonicalWorkspaceFeature = 'lab' | 'print-design-project' | 'wear-design-lab' | 'wear-design-detail' | 'printing-image' | 'line-to-real' | 'line-generation' | 'svg-convert' | 'image-repair' | 'pattern-arrange' | 'pattern-print-design' | 'change-color' | 'pattern-vector' | 'pattern-vector-pro' | 'model-face' | 'model-change' | 'body-shape' | 'clothing-size' | 'pose-change' | 'background-change' | 'angle-change' | 'model-library' | 'model-custom';
export type CanonicalModelCandidate = {imageId:string;storagePath:string;jobId:string;bodyType:string;ageGroup:string;provider:string};
type WorkspaceConfig = {prepareSourceImage?:(url:string)=>Promise<string>;providerModel?:string;modelLibraryCreation?:boolean;initialInputState?:Record<string,Json>;requiredSources?:number;title?:string;promptContext?:string;identityConflict?:boolean};
const record = (value:unknown): value is Record<string,Json> => Boolean(value) && typeof value==='object' && !Array.isArray(value);
const readCandidates = (metadata: Record<string,Json | undefined>,currentJobId:string): CanonicalModelCandidate[] => {
 const raw=metadata.modelCandidates;if(!Array.isArray(raw))return [];
 const parsed=raw.filter(record).filter(item=>['imageId','jobId','bodyType','ageGroup','provider'].every(key=>typeof item[key]==='string'&&Boolean(item[key])) && item.jobId===currentJobId && Boolean(normalizeCloudflareGeneratedImageStoragePath(item.storagePath)??normalizeGeneratedImageStoragePath(item.storagePath)) && (!normalizeCloudflareGeneratedImageStoragePath(item.storagePath)||item.storagePath===`generated-images/${item.imageId}`)) as unknown as CanonicalModelCandidate[];
 return parsed.length===raw.length && new Set(parsed.map(item=>item.imageId)).size===parsed.length && new Set(parsed.map(item=>item.jobId)).size===1 ? parsed.map(({imageId,storagePath,jobId,bodyType,ageGroup,provider})=>({imageId,storagePath,jobId,bodyType,ageGroup,provider})) : [];
};
const sanitizeInputState=(value:unknown):Record<string,Json>=>{
 if(!record(value))return {};const out:Record<string,Json>={};
 for(const key of ['gender','half','age','nationality','skinColor','bodyType','bodyTypes','ageGroups','coverage','layerModes','assist','sourceType','styleNote','arrangeMode','arrangeRatio','arrangePrompt','printMode','printRatio','printResolution','printTile','printPrompt','printAdjustSource','printAdjustResult','colorTarget','colorArea','colorRatio']){
  // Prompts follow their form limits (プリントデザイン 1000 chars); other settings stay short.
  const limit=/Prompt$/.test(key)?1000:256;
  const item=value[key];const safe=(v:unknown):v is string=>typeof v==='string'&&v.length<=limit&&!/(?:https?:|data:|blob:|bearer\s)/i.test(v);
  if(typeof item==='boolean'||safe(item))out[key]=item;
  else if(Array.isArray(item)&&item.length<=16&&item.every(safe))out[key]=item;
 }
 // AIグラフィックデザイン: one 0–4 reference-strength level per uploaded reference.
 const strengths=value.referenceStrengths;
 if(Array.isArray(strengths)&&strengths.length<=2&&strengths.every(v=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=4))out.referenceStrengths=strengths;
 return out;
};
const workspaceInputState = (feature: string, value: unknown): Record<string, Json> => isModelToolFeature(feature) ? readModelToolSettings(feature, value) ?? readLegacyModelToolSettings(feature, value) ?? {} : isModelLibraryFeature(feature) ? readModelLibrarySettings(value) ?? sanitizeInputState(value) : sanitizeInputState(value);
type State = { brief: string; referenceNote: string; slots: Record<SlotKey, Source | null>; result: LightchainResumeResult | null;
  inputState: Record<string,Json>; libraryInputReadback:LibraryInputReadback|null; candidates:CanonicalModelCandidate[]; selectedCandidateId:string|null; inputsAvailable: boolean; originalInputsAvailable: boolean; status: Status; error: string | null; pendingId: string | null };
type Pending = { requestId: string; createdAt?: number; originJob: string | null; brief: string; referenceNote: string; backendAction?:unknown; requestedOutputSize?:unknown; inputState?:Record<string,Json>; materialSlots: ReturnType<typeof serializeLightchainResumeSlots> };
// A request the server has never seen may still be in flight for a moment; after this it was never sent.
const PENDING_NOT_FOUND_GRACE_MS = 60_000;
const RUNNING_RECHECK_MS = 4_000;
const emptyState = (): State => ({ brief: '', referenceNote: '', slots: { primary: null, secondary: null }, result: null,
  inputState:{},libraryInputReadback:null,candidates:[],selectedCandidateId:null, inputsAvailable: false, originalInputsAvailable: false, status: 'empty', error: null, pendingId: null });
const authSnapshot = () => { const s = useAuthStore.getState(); return captureAuthBrandFence(s.brandState, s.user?.id ?? null, s.currentBrand?.id ?? null); };
const dimensions = (url: string): Promise<{width: number; height: number}> => new Promise((resolve, reject) => {
  const image = new Image(); const timer = setTimeout(() => { image.src = ''; reject(new Error('image_source_unavailable')); }, 5000);
  image.onload = () => { clearTimeout(timer); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
  image.onerror = () => { clearTimeout(timer); reject(new Error('image_source_unavailable')); }; image.src = url;
});

/** Canonical Lab/wear orchestration. It never reads or writes the global Canvas. */
export function useCanonicalImageWorkspace(toolId: CanonicalWorkspaceFeature, config:WorkspaceConfig = {}) {
  const { user, currentBrand, brandState } = useAuthStore();
  const location = useLocation(), navigate = useNavigate();
  const jobId = new URLSearchParams(location.search).get('resumeJob');
  const libraryArtifactId = new URLSearchParams(location.search).get('libraryArtifactId');
  const librarySlot = new URLSearchParams(location.search).get('librarySlot');
  const scope = JSON.stringify([user?.id, currentBrand?.id, toolId, location.pathname, location.search, location.hash, brandState.requestGeneration, config.modelLibraryCreation===true]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const mounted = useRef(true), sequence = useRef(0), busy = useRef(false);
  const uploadSequence = useRef({primary:0,secondary:0});
  const releases = useRef<Partial<Record<SlotKey | 'result', LocalCanvasAssetResolution>>>({});
  const configRef=useRef(config);configRef.current=config;
  const backendAction=(configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId))?'generate-image':resolveHeavyCapability(toolId).action;
  const [state, setState] = useState<State>(emptyState);
  const stateRef = useRef(state); stateRef.current = state;
  const pendingKey = `heavy:canonical-image-workspace:v1:${user?.id ?? ''}:${currentBrand?.id ?? ''}:${toolId}:${jobId ?? 'fresh'}`;
  const pending = useRef<Pending | null>(null);
  // Un-generated inputs (uploads kept in the local asset store, request text, settings) survive a reload per tool page.
  // One draft per board project (`boardProjectCode`); a new file keeps the plain per-page draft.
  const boardProjectCode = new URLSearchParams(location.search).get('boardProjectCode') ?? '';
  const draftKey = `heavy:canonical-draft:v1:${user?.id ?? ''}:${currentBrand?.id ?? ''}:${toolId}:${location.pathname}${boardProjectCode ? `:${boardProjectCode}` : ''}`;
  const draftReady = useRef<string | null>(null);
  const draftEnabled = toolId !== 'printing-image'; // プリントイメージ keeps its own reviewed draft store.
  const restoredArtifact=useRef<{scope:string;artifact:WorkspaceArtifact}|null>(null);
  const releaseAll = () => { Object.values(releases.current).forEach(value => value?.release()); releases.current = {}; };
  const rememberPending = (value: Pending | null) => {
    // Reserve the exact operation ID before inference. Failure to retain it is
    // a pre-dispatch failure, rather than permission to lose/replay an attempt.
    if (value) sessionStorage.setItem(pendingKey, JSON.stringify(value)); else sessionStorage.removeItem(pendingKey);
    pending.current = value;
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; restoredArtifact.current=null; releaseAll(); }; }, []);
  const autoReconciled = useRef<string | null>(null);
  useEffect(() => {
    const token = ++sequence.current; uploadSequence.current.primary++; uploadSequence.current.secondary++;
    busy.current = false; releaseAll(); pending.current = null;restoredArtifact.current=null;
    let cancelled = false;
    const current = () => !cancelled && mounted.current && scopeRef.current === scope && sequence.current === token;
    const fence = authSnapshot();
    const acquired: LocalCanvasAssetResolution[] = [];
    setState({ ...emptyState(), status: jobId || libraryArtifactId ? 'loading' : 'empty' });
    if (configRef.current.identityConflict) {setState({...emptyState(),status:'unavailable',error:'保存ジョブとこの入口の機能が一致しません。'});return ()=>{cancelled=true;};}
    let retained: Pending | null = null;
    try {
      const raw = JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null');
      if (raw && typeof raw.requestId === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(raw.requestId) && raw.originJob === jobId
        && typeof raw.brief === 'string' && typeof raw.referenceNote === 'string' && Array.isArray(raw.materialSlots)) retained = raw;
    } catch { /* A malformed local record never permits an inference. */ }
    pending.current = retained;
    const retainedState = retained ? { pendingId: retained.requestId, status: 'unknown' as const } : {};
    const pendingBodySettings = toolId === 'body-shape' && retained ? workspaceInputState(toolId, retained.inputState) : null;
    const pendingLibrarySettings = (configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId)) && retained ? workspaceInputState(toolId, retained.inputState) : null;
    if (!fence) {
      if (!jobId && !libraryArtifactId && isModelToolFeature(toolId)) {
        setState({ ...emptyState(), inputState: retained ? workspaceInputState(toolId, retained.inputState) : defaultModelToolSettings(toolId), ...retainedState });
      } else if (jobId || libraryArtifactId) {
        setState({ ...emptyState(), status: 'unavailable', error: 'auth_brand_access_not_confirmed', ...retainedState });
      }
      return () => { cancelled = true; };
    }
    if (!jobId) {
      const initialState = { ...emptyState(), inputState: isModelToolFeature(toolId) ? (retained ? workspaceInputState(toolId, retained.inputState) : defaultModelToolSettings(toolId)) : configRef.current.initialInputState ?? {}, ...retainedState };
      setState(initialState);
      if (retained || !libraryArtifactId) return () => { cancelled = true; };
      const libraryCurrent = () => current() && isAuthBrandFenceValid(fence, authSnapshot());
      const unavailable = () => {
        if (libraryCurrent()) setState({ ...initialState, status: 'unavailable', error: 'Libraryの元画像を取得できません。' });
      };
      const destination: SlotKey | null = librarySlot === null || librarySlot === 'primary' ? 'primary'
        : toolId === 'printing-image' && librarySlot === 'printing-design' ? 'secondary' : null;
      if (!destination) { unavailable(); return () => { cancelled = true; }; }
      setState({ ...initialState, status: 'loading' });
      void (async () => {
        try {
          if (!libraryCurrent()) return;
          const artifact = listWorkspaceArtifacts(fence.brandId, fence.userId)
            .find(candidate => candidate.id === libraryArtifactId && candidate.brandId === fence.brandId && candidate.scopeId === fence.userId);
          if (!artifact) { unavailable(); return; }
          const original = structuredClone(artifact);
          const source = await readWorkspaceArtifactImage(original, { brandId: fence.brandId, userId: fence.userId });
          if (!libraryCurrent()) return;
          setState({ ...initialState, slots: { primary: null, secondary: null, [destination]: {
            name: original.title || 'Library素材', kind: original.featureType || 'Library素材', imageUrl: source.imageUrl,
            sourceImageId: original.id, sourceStoragePath: source.storagePath,
            ...(source.localAssetRef ? { localAssetRef: source.localAssetRef } : {}), persistenceStatus: 'persistent',
          } }, inputsAvailable: true, originalInputsAvailable: true, status: 'ready' });
        } catch { unavailable(); }
      })();
      return () => { cancelled = true; };
    }
    const artifacts = listWorkspaceArtifacts(fence.brandId, fence.userId);
    const exact = { brandId: fence.brandId, scopeId: fence.userId, toolId };
    let inputs = readLightchainResumeInput(artifacts, jobId, exact);
    let result = readLightchainResumeResult(artifacts, jobId, exact);
    let exactArtifact = result ? artifacts.find(artifact=>artifact.id===result!.artifactId) : undefined;
    const libraryCreation = configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId);
    const localLibrarySettings = libraryCreation ? exactArtifact?.metadata.inputState != null ? readModelLibrarySettings(exactArtifact.metadata.inputState) : readLegacyModelLibrarySettings(inputs?.modelFormState) : null;
    const refreshLibraryInputs = libraryCreation && (!localLibrarySettings || !inputs || inputs.unavailableSources || exactArtifact?.metadata.originalInputsAvailable===false);
    const localLibraryResultIdentity=refreshLibraryInputs&&result?{imageId:result.imageId,storagePath:result.storagePath}:null;
    let inputSource:LibraryInputReadback['source']=exactArtifact?'local':'none';
    let remoteLookup:LibraryInputReadback['remoteLookup']='not-needed';
    let requestLookup:LibraryInputReadback['requestLookup']='not-needed';
    let requestModernSettings:LibraryInputReadback['requestModernSettings']='not-read',requestLegacySettings:LibraryInputReadback['requestLegacySettings']='not-read';
    void (async () => {
      try {
        if ((!result || refreshLibraryInputs) && cloudflareDataPlane) {
          // Existing authenticated gallery adapter queries the exact job. A
          // prompt/preview never prove the original form. Only explicitly
          // persisted input metadata may restore it through the same helper.
          try {
            const images = await cloudflareDataPlane.listGeneratedImages(fence.brandId,{jobId,limit:20});
            if (!current()) return; assertAuthBrandFence(fence,authSnapshot(),'canonical_remote_result');
            const remote = images.find(image=>image.job_id===jobId && image.brand_id===fence.brandId && image.user_id===fence.userId
              && [toolId,`lightchain-${toolId}`,`lightchain-${toolId}-provider-result`].includes(image.feature_type ?? '')
              && (!record(image.metadata)||image.metadata.toolId===undefined||image.metadata.toolId===toolId)
              && (!result || (image.id===result.imageId && image.storage_path===result.storagePath))
              && Boolean(normalizeCloudflareGeneratedImageStoragePath(image.storage_path) ?? normalizeGeneratedImageStoragePath(image.storage_path)));
            remoteLookup=remote?'matched':'no-match';
            if (remote) {
              const rawMetadata: Record<string,Json> = record(remote.metadata) ? remote.metadata : {};
              // Server copy of the inputs: canonicalInput (settings/brief) and
              // materialReferences (same shape as materialSlots).
              const canonicalInput = record(rawMetadata.canonicalInput) ? rawMetadata.canonicalInput : null;
              const metadata: Record<string,Json> = {...rawMetadata,
                ...(canonicalInput&&rawMetadata.inputState===undefined&&record(canonicalInput.inputState)?{inputState:canonicalInput.inputState}:{}),
                ...(canonicalInput&&rawMetadata.toolId===undefined&&canonicalInput.toolId===toolId?{toolId}:{}),
                ...(canonicalInput&&rawMetadata.brief===undefined&&typeof canonicalInput.brief==='string'?{brief:canonicalInput.brief}:{}),
                ...(canonicalInput&&rawMetadata.referenceNote===undefined&&typeof canonicalInput.referenceNote==='string'?{referenceNote:canonicalInput.referenceNote}:{}),
                ...(rawMetadata.materialSlots===undefined&&Array.isArray(rawMetadata.materialReferences)?{materialSlots:rawMetadata.materialReferences}:{})};
              const artifact: WorkspaceArtifact = {id:remote.id,brandId:fence.brandId,scopeId:fence.userId,featureType:`lightchain-${toolId}-provider-result`,
                title:'保存された画像',imageUrl:'',prompt:null,createdAt:remote.created_at,sourceJobId:jobId,metadata};
              exactArtifact=artifact;
              inputSource='remote';
              if (!inputs || refreshLibraryInputs) inputs = readLightchainResumeInput([artifact],jobId,exact);
              result = {artifactId:remote.id,toolId,title:toolId==='lab'?'保存されたラボ画像':'保存されたウェア画像',summary:remote.prompt ?? '',imageUrl:'',
                storagePath:remote.storage_path,jobId,imageId:remote.id,generationMode:'provider',provider:typeof metadata.provider==='string'?metadata.provider:null,backendProvider:null,parityRuntime:null};
            }
          } catch (error) {
            if (!result) throw error;
            if (!current()) return;
            assertAuthBrandFence(fence,authSnapshot(),'canonical_remote_input_unavailable');
            remoteLookup='unavailable';
          }
        }
        const imageMetadata=exactArtifact?.metadata;
        const imageLegacy=record(imageMetadata?.lightchainWorkbenchState)?imageMetadata.lightchainWorkbenchState.modelFormState??imageMetadata.modelFormState:imageMetadata?.modelFormState;
        const originalRequest=jobId.match(/^ai-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i)?.[1];
        if(libraryCreation&&!retained&&remoteLookup==='matched'&&exactArtifact&&result&&cloudflareDataPlane&&originalRequest&&imageMetadata?.inputState==null&&imageLegacy==null
          &&result.imageId?.startsWith(`${jobId}-`)&&result.storagePath===`generated-images/${result.imageId}`){
          try {
            const receipt=await cloudflareDataPlane.readImageAIRequest(originalRequest);
            if(!current())return;assertAuthBrandFence(fence,authSnapshot(),'canonical_request_input_read');
            const metadata=record(receipt.metadata)?receipt.metadata:{};
            const workbench=record(metadata.lightchainWorkbenchState)?metadata.lightchainWorkbenchState:null;
            const sameImage=Array.isArray(receipt.images)&&receipt.images.some(image=>record(image)&&(image.imageId??image.id)===result!.imageId&&image.jobId===jobId&&image.storagePath===result!.storagePath);
            const featureMatches=receipt.featureType===undefined||[toolId,`lightchain-${toolId}`,`lightchain-${toolId}-provider-result`].includes(String(receipt.featureType));
            if(receipt.requestId!==originalRequest||receipt.jobId!==jobId||receipt.success!==true||receipt.state!=='completed'||receipt.persistenceStatus!=='completed'||!sameImage||!featureMatches
              ||(metadata.toolId!==undefined&&metadata.toolId!==toolId)||(workbench?.toolId!==undefined&&workbench.toolId!==toolId))requestLookup='identity-mismatch';
            else {
              requestLookup='matched';
              const rawModern=metadata.inputState,rawLegacy=workbench?.modelFormState??metadata.modelFormState;
              const storedInput=Object.fromEntries(['inputState','modelFormState','lightchainWorkbenchState','brief','referenceNote','materialSlots','materialSlotFiles'].filter(key=>Object.hasOwn(metadata,key)).map(key=>[key,metadata[key]]));
              const inputArtifact={...exactArtifact,metadata:{...exactArtifact.metadata,...storedInput}};
              let requestInputs=readLightchainResumeInput([inputArtifact],jobId,exact);
              const unsupportedMetadata=receipt.metadata!=null&&!record(receipt.metadata);
              requestModernSettings=unsupportedMetadata?'invalid':rawModern===undefined?'absent':rawModern===null?'null':readModelLibrarySettings(rawModern)?'valid':'invalid';
              requestLegacySettings=unsupportedMetadata?'invalid':rawLegacy===undefined?'absent':rawLegacy===null?'null':readLegacyModelLibrarySettings(requestInputs?.modelFormState)?'valid':'invalid';
              const requestSettings=rawModern!=null?readModelLibrarySettings(rawModern):readLegacyModelLibrarySettings(requestInputs?.modelFormState);
              if(!requestInputs&&requestSettings?.inputMode==='label'&&receipt.inputImageCount===0)requestInputs={artifactId:inputArtifact.id,slots:[],modelFormState:null};
              if(!unsupportedMetadata&&requestSettings&&requestInputs&&!requestInputs.unavailableSources){
                const legacy=requestInputs.modelFormState;
                const safeLegacy=legacy?Object.fromEntries(['customMode','gender','half','age','nationality','skinTone','bodyType'].filter(key=>Object.hasOwn(legacy,key)).map(key=>[key,legacy[key]])):null;
                exactArtifact={...exactArtifact,metadata:{...exactArtifact.metadata,inputState:requestSettings,
                  ...(safeLegacy?{modelFormState:safeLegacy}:{}),...(requestInputs.brief!==undefined?{brief:requestInputs.brief}:{}),
                  ...(requestInputs.referenceNote!==undefined?{referenceNote:requestInputs.referenceNote}:{}),materialSlots:serializeLightchainResumeSlots(Object.fromEntries(requestInputs.slots.map(slot=>[slot.key,slot]))) as unknown as Json}};
                inputs=requestInputs;inputSource='request';
              }
            }
          }catch{
            if(!current())return;assertAuthBrandFence(fence,authSnapshot(),'canonical_request_input_unavailable');requestLookup='unavailable';
          }
        }
        const resolve = async (url: string, path?: string | null, mediaPath?: string | null) => {
          assertAuthBrandFence(fence, authSnapshot(), 'canonical_resume_resolve');
          if (mediaPath && cloudflareDataPlane) {
            // The browser-local asset may be gone (other browser, cleared storage); the private media copy is durable.
            const local = !path && isLocalCanvasAssetReference(url) ? await resolveLocalCanvasAsset(url).catch(() => null) : null;
            if (local) { acquired.push(local); return { url: local.source, resolution: local }; }
            if (!path) { const objectUrl = await cloudflareDataPlane.readMediaObjectUrl(mediaPath);
              const value: LocalCanvasAssetResolution = { source: objectUrl, release: () => URL.revokeObjectURL(objectUrl) };
              acquired.push(value); return { url: objectUrl, resolution: value }; }
          }
          if (path) { const [image] = await withSignedImageUrls([{storage_path: path, image_url: ''}]);
            if (!image?.image_url) throw new Error('image_source_unavailable'); return { url: image.image_url, resolution: null }; }
          if (isLocalCanvasAssetReference(url)) { const value = await resolveLocalCanvasAsset(url);
            if (!value) throw new Error('image_source_unavailable'); acquired.push(value); return { url: value.source, resolution: value }; }
          if (!url) throw new Error('image_source_unavailable'); await dimensions(url); return { url, resolution: null };
        };
        const slots: State['slots'] = { primary: null, secondary: null };
        const nextReleases: typeof releases.current = {};
        const restoredSettings = isModelToolFeature(toolId) && exactArtifact?.metadata.toolId === toolId ? readModelToolSettings(toolId, exactArtifact.metadata.inputState) ?? readLegacyModelToolSettings(toolId, exactArtifact.metadata.inputState) : null;
        const missingSettings = isModelToolFeature(toolId) && !readModelToolSettings(toolId, restoredSettings);
        const librarySettings = (configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId))
          ? exactArtifact?.metadata.inputState != null ? readModelLibrarySettings(exactArtifact.metadata.inputState) : readLegacyModelLibrarySettings(inputs?.modelFormState)
          : null;
        const legacyMetadata = inputSource==='remote'||inputSource==='request' ? exactArtifact?.metadata : inputs ? artifacts.find(artifact=>artifact.id===inputs!.artifactId)?.metadata ?? exactArtifact?.metadata : exactArtifact?.metadata;
        const rawLegacy = record(legacyMetadata?.lightchainWorkbenchState) ? legacyMetadata.lightchainWorkbenchState.modelFormState ?? legacyMetadata.modelFormState : legacyMetadata?.modelFormState;
        const modern = exactArtifact?.metadata.inputState;
        const libraryInputReadback:LibraryInputReadback|null=libraryCreation?{source:inputSource,remoteLookup,requestLookup,requestModernSettings,requestLegacySettings,
          modernSettings:modern===undefined?'absent':modern===null?'null':readModelLibrarySettings(modern)?'valid':'invalid',
          legacySettings:rawLegacy===undefined?'absent':rawLegacy===null?'null':readLegacyModelLibrarySettings(inputs?.modelFormState)?'valid':'invalid'}:null;
        const missingLibrarySettings=libraryCreation&&!librarySettings;
        const libraryInputError=missingLibrarySettings?(remoteLookup==='unavailable'?'元のモデル設定を読み直せませんでした。保存画像を保持しています。'
          : remoteLookup==='no-match'?'元の保存レコードを確認できません。保存画像を保持しています。'
          : libraryInputReadback?.modernSettings==='invalid'||libraryInputReadback?.legacySettings==='invalid'?'保存されたモデル設定の形式を確認できません。新しい入力で開始してください。'
          : 'この保存画像には元のモデル設定が含まれていません。新しい入力で開始してください。'):null;
        let missingInputs = missingSettings || !inputs || Boolean(inputs.unavailableSources) || exactArtifact?.metadata.originalInputsAvailable===false
          || ((configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId)) ? !librarySettings : Boolean(configRef.current.initialInputState)&&!record(exactArtifact?.metadata.inputState));
        for (const slot of inputs?.slots ?? []) {
          try { const resolved = await resolve(slot.imageUrl, slot.sourceStoragePath, slot.sourceMediaPath);
            if (!current()) return;
            slots[slot.key] = {...slot, imageUrl: resolved.url, ...(isLocalCanvasAssetReference(slot.imageUrl) ? {localAssetRef:slot.imageUrl} : {})};
            if (resolved.resolution) nextReleases[slot.key] = resolved.resolution;
          } catch { missingInputs = true; }
        }
        const candidates = exactArtifact ? readCandidates(exactArtifact.metadata,jobId) : [];
        const selectedId=exactArtifact?.metadata.selectedCandidateId;
        const selected=candidates.find(candidate=>candidate.imageId===selectedId&&(!localLibraryResultIdentity||(candidate.imageId===localLibraryResultIdentity.imageId&&candidate.storagePath===localLibraryResultIdentity.storagePath)));
        if(selected && result) result={...result,imageId:selected.imageId,storagePath:selected.storagePath,provider:selected.provider};
        const resolvedResult = result ? await resolve(result.imageUrl, result.storagePath) : null;
        if (!current()) return; assertAuthBrandFence(fence, authSnapshot(), 'canonical_resume_commit');
        if (resolvedResult?.resolution) nextReleases.result = resolvedResult.resolution;
        releases.current = nextReleases;
        restoredArtifact.current=exactArtifact?{scope,artifact:structuredClone(exactArtifact)}:null;
        if(librarySettings?.inputMode==='custom'&&!slots.secondary)missingInputs=true;
        setState({inputState: pendingBodySettings ?? pendingLibrarySettings ?? (isModelToolFeature(toolId) ? restoredSettings ?? {} : (configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId)) ? librarySettings ?? {} : sanitizeInputState(exactArtifact?.metadata.inputState)),libraryInputReadback,candidates,selectedCandidateId:selected?.imageId ?? candidates.find(candidate=>candidate.imageId===result?.imageId)?.imageId ?? null, brief: inputs?.brief ?? '', referenceNote: inputs?.referenceNote ?? '', slots,
          result: result && resolvedResult ? {...result, imageUrl: resolvedResult.url} : null,
          inputsAvailable: !missingInputs, originalInputsAvailable: !missingInputs && !((configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId))&&retained), status: missingInputs || !result ? 'unavailable' : 'saved',
          error: missingSettings ? '元のモデル設定が保存されていないか、この機能と一致しません。新しい入力で開始してください。' : libraryInputError ?? (missingInputs ? '元の入力が保存されていないか、素材を取得できません。必要な入力を追加してください。' : null),
          pendingId: null, ...retainedState }); acquired.length = 0;
      } catch { if (current()) setState({...emptyState(), ...(pendingBodySettings ? {inputState:pendingBodySettings} : {}), status:'unavailable', error:'保存された画像を取得できません。', ...retainedState}); }
      finally { acquired.forEach(value => value.release()); }
    })();
    return () => { cancelled = true;if(restoredArtifact.current?.scope===scope)restoredArtifact.current=null; };
  }, [scope, jobId, pendingKey, brandState.status,config.identityConflict]);

  useEffect(() => {
    // Runs after the initializer above (same dependencies): restore a fresh page's un-generated draft.
    draftReady.current = null;
    if (!draftEnabled || jobId || libraryArtifactId || pending.current || configRef.current.identityConflict || !authSnapshot()) return;
    const token = sequence.current;
    let cancelled = false;
    const current = () => !cancelled && mounted.current && scopeRef.current === scope && sequence.current === token;
    void (async () => {
      let draft: Record<string, unknown> | null = null;
      try { const parsed = JSON.parse(localStorage.getItem(draftKey) ?? 'null'); draft = record(parsed) ? parsed : null; } catch { draft = null; }
      const slots: Record<SlotKey, Source | null> = { primary: null, secondary: null };
      const savedSlots = draft && record(draft.slots) ? draft.slots : {};
      for (const key of ['primary', 'secondary'] as const) {
        const saved = savedSlots[key];
        if (!record(saved) || !isLocalCanvasAssetReference(saved.localAssetRef)) continue;
        try {
          const resolved = await resolveLocalCanvasAsset(saved.localAssetRef as string);
          if (!resolved) continue;
          if (!current()) { resolved.release(); return; }
          releases.current[key]?.release(); releases.current[key] = resolved;
          slots[key] = { name: typeof saved.name === 'string' ? saved.name.slice(0, 256) : '素材', kind: key, imageUrl: resolved.source,
            localAssetRef: saved.localAssetRef as string, persistenceStatus: 'persistent',
            ...(record(saved.sourceMetadata) ? { sourceMetadata: saved.sourceMetadata as unknown as CanvasSourceMetadata } : {}) };
        } catch { /* The local copy is gone; the slot stays empty rather than inventing an input. */ }
      }
      if (!current()) return;
      if (draft) {
        const brief = typeof draft.brief === 'string' ? draft.brief.slice(0, 4000) : '';
        const referenceNote = typeof draft.referenceNote === 'string' ? draft.referenceNote.slice(0, 4000) : '';
        const restoredInput = record(draft.inputState) ? workspaceInputState(toolId, draft.inputState) : null;
        const usableInput = restoredInput && Object.keys(restoredInput).length > 0 && (!isModelToolFeature(toolId) || readModelToolSettings(toolId, restoredInput));
        const hasInputs = Boolean(slots.primary || slots.secondary || brief || referenceNote);
        setState(s => ({ ...s, brief, referenceNote, slots, inputState: usableInput ? restoredInput! : s.inputState,
          inputsAvailable: hasInputs || s.inputsAvailable, status: slots.primary || slots.secondary ? 'ready' : s.status }));
      }
      draftReady.current = scope;
    })();
    return () => { cancelled = true; };
  }, [scope, jobId, pendingKey, brandState.status, config.identityConflict, draftKey, draftEnabled]);

  useEffect(() => {
    if (jobId) { if (state.status === 'saved') { try { localStorage.removeItem(draftKey); } catch { /* storage unavailable */ } } return; }
    if (!draftEnabled || draftReady.current !== scope || state.status === 'loading' || state.status === 'running') return;
    const slotDraft = (source: Source | null) => source?.localAssetRef ? { name: source.name, localAssetRef: source.localAssetRef,
      ...(source.sourceMetadata ? { sourceMetadata: source.sourceMetadata } : {}) } : null;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ brief: state.brief, referenceNote: state.referenceNote, inputState: state.inputState,
        slots: { primary: slotDraft(state.slots.primary), secondary: slotDraft(state.slots.secondary) } }));
    } catch { /* A full or blocked storage only loses the draft convenience. */ }
  }, [draftEnabled, draftKey, jobId, scope, state.brief, state.inputState, state.referenceNote, state.slots, state.status]);
  const upload = async (key: SlotKey, file: File, isCurrent?: () => boolean, restoredIdentity?: Pick<Source,'sourceImageId'|'sourceStoragePath'>) => {
    if (isCurrent && !isCurrent()) return;
    if (busy.current || stateRef.current.pendingId || stateRef.current.status==='loading') return;
    const identity = restoredIdentity ? normalizeGenerationSourceReferences([restoredIdentity]) : null;
    if (restoredIdentity && (!isCurrent || toolId !== 'printing-image' || !identity?.ok)) throw new Error('printing_restore_source_identity_invalid');
    const origin = identity?.ok ? identity.references[0] : null;
    const uploadToken = ++uploadSequence.current[key];
    const captured = scopeRef.current, fence = authSnapshot(); if (!fence) return;
    const current = () => mounted.current && captured === scopeRef.current && uploadToken === uploadSequence.current[key]
      && !busy.current && !stateRef.current.pendingId && (!isCurrent || isCurrent());
    if (file.size > 20 * 1024 * 1024 || !file.type.startsWith('image/')) { if (current()) setState(s=>({...s,error:'20MB以下の画像を選択してください。'})); return; }
    const url = URL.createObjectURL(file);
    try {
      const size = await dimensions(url);
      if (!current()) { URL.revokeObjectURL(url); return; }
      const metadata = await buildLocalUploadSourceMetadata(file, size);
      if (!current()) { URL.revokeObjectURL(url); return; }
      let localAssetRef: string | undefined; let persistenceStatus: Source['persistenceStatus'] = 'persistent';
      try { await putLocalCanvasAsset(metadata.sourceRevision.revision,file); localAssetRef = buildLocalCanvasAssetReference(metadata.sourceRevision.revision); }
      catch { persistenceStatus = 'session-only'; }
      if (!current()) { URL.revokeObjectURL(url); return; }
      assertAuthBrandFence(fence,authSnapshot(),'canonical_upload_commit');
      releases.current[key]?.release(); releases.current[key] = {source:url, release:()=>URL.revokeObjectURL(url)};
      setState(s=>({...s,slots:{...s.slots,[key]:{name:file.name,kind:key,imageUrl:url,sourceMetadata:metadata,persistenceStatus,localAssetRef,
        ...(origin?.sourceImageId?{sourceImageId:origin.sourceImageId}:{}),...(origin?.sourceStoragePath?{sourceStoragePath:origin.sourceStoragePath}:{})}},
        inputsAvailable:true, status:s.pendingId?'unknown':'ready', error:persistenceStatus==='session-only'?'この素材は現在のセッションでのみ利用できます。':null}));
    } catch { URL.revokeObjectURL(url); if (current()) setState(s=>({...s,error:'画像を読み込めませんでした。'})); }
  };
  const selectModelReference = async (selection: { imageUrl: string; imageId: string; storagePath?: string; name?: string }) => {
    if (scope !== scopeRef.current || busy.current || stateRef.current.pendingId || stateRef.current.status === 'loading'
      || (!['model-face', 'model-change', 'pose-change', 'background-change'].includes(toolId)
        && !(configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId)))) return;
    const referenceMode = () => (configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId)) ? readModelLibrarySettings(stateRef.current.inputState)?.inputMode === 'custom' : !isModelDescriptionFeature(toolId) || readModelToolSettings(toolId, stateRef.current.inputState)?.inputMode === 'reference';
    if (!referenceMode()) return;
    const fence = authSnapshot(); if (!fence) return;
    const captured = scope, selectionToken = ++uploadSequence.current.secondary;
    const current = () => mounted.current && captured === scopeRef.current && selectionToken === uploadSequence.current.secondary
      && !busy.current && !stateRef.current.pendingId && stateRef.current.status !== 'loading' && referenceMode() && isAuthBrandFenceValid(fence, authSnapshot());
    try {
      let source: Source;
      // Product-owned assets keep their stable relative URL; they are not generated image IDs.
      if (selection.imageId.startsWith('platform-') && /^\/assets\/(?!.*(?:\.\.|[?#%\\])).+\.(?:svg|png|jpe?g|webp)$/i.test(selection.imageUrl)
        && (!selection.storagePath || selection.storagePath === selection.imageUrl)) {
        const size = await dimensions(selection.imageUrl); if (!current()) return;
        const response = await fetch(selection.imageUrl); if (!response.ok) throw new Error('model_reference_asset_unavailable');
        const blob = await response.blob(); if (!current()) return;
        if (!blob.size || blob.size > 20 * 1024 * 1024 || !blob.type.startsWith('image/')) throw new Error('model_reference_asset_invalid');
        const file = new File([blob], selection.imageUrl.split('/').at(-1)!, { type: blob.type });
        const metadata = await buildLocalUploadSourceMetadata(file, size); if (!current()) return;
        await putLocalCanvasAsset(metadata.sourceRevision.revision, file); if (!current()) return;
        source = { name: selection.name?.trim().slice(0, 256) || file.name, kind: 'secondary', imageUrl: selection.imageUrl, sourceMetadata: metadata,
          localAssetRef: buildLocalCanvasAssetReference(metadata.sourceRevision.revision), persistenceStatus: 'persistent' };
      } else {
        const normalized = normalizeGenerationSourceReferences([{ sourceImageId: selection.imageId, sourceStoragePath: selection.storagePath }]);
        if (!normalized.ok) throw new Error('model_reference_identity_unavailable');
        const path = normalized.references[0].sourceStoragePath;
        if (!path || (normalizeCloudflareGeneratedImageStoragePath(path) && path !== `generated-images/${selection.imageId}`)) throw new Error('model_reference_identity_mismatch');
        // Resolve the canonical path again; a Gallery preview URL is not durable source proof.
        const [signed] = await withSignedImageUrls([{ storage_path: path, image_url: '' }]);
        if (!current()) return;
        if (!signed?.image_url) throw new Error('model_reference_signing_failed');
        await dimensions(signed.image_url); if (!current()) return;
        source = { name: selection.name?.trim().slice(0, 256) || '参考画像', kind: 'secondary', imageUrl: signed.image_url, sourceImageId: selection.imageId, sourceStoragePath: path, persistenceStatus: 'persistent' };
      }
      assertAuthBrandFence(fence, authSnapshot(), 'canonical_model_reference_commit');
      releases.current.secondary?.release(); delete releases.current.secondary;
      setState(s => ({ ...s, slots: { ...s.slots, secondary: source }, status: s.result ? s.status : 'ready', error: null }));
    } catch { if (current()) setState(s => ({ ...s, error: '参考画像を読み込めませんでした。元の入力は保持されています。' })); }
  };
  const setText = (key: 'brief' | 'referenceNote', value: string) => { if (!busy.current && !stateRef.current.pendingId && stateRef.current.status!=='loading') setState(s=>({...s,[key]:value,inputsAvailable:true})); };
  const setInputState = (value:Record<string,Json>) => {if(!busy.current&&!stateRef.current.pendingId&&stateRef.current.status!=='loading'){const next=workspaceInputState(toolId,value);if(isModelToolFeature(toolId)&&!readModelToolSettings(toolId,next))return;setState(s=>({...s,inputState:next,inputsAvailable:isModelToolFeature(toolId)?s.inputsAvailable:true}));}};
  const clearSource=(key:SlotKey)=>{if(busy.current||stateRef.current.pendingId||stateRef.current.status==='loading')return;uploadSequence.current[key]++;releases.current[key]?.release();delete releases.current[key];setState(s=>({...s,slots:{...s.slots,[key]:null}}));};
  const run = async (action: 'generate' | 'edit-source' | 'edit-result' | 'reconcile', override?:{brief?:string;inputState?:Record<string,Json>}) => {
    if (busy.current || stateRef.current.status==='loading' || (pending.current && action !== 'reconcile')) return;
    const fence = authSnapshot(); if (!fence) { setState(s=>({...s,error:'ブランドのアクセス確認が完了していません。'})); return; }
    if(configRef.current.identityConflict)return;
    const captured = scopeRef.current, token = ++sequence.current, snapshot = {...stateRef.current,...override};
    const assertCurrent = () => { if (!mounted.current || captured !== scopeRef.current || sequence.current !== token) throw new Error('canonical_workspace_stale');
      assertAuthBrandFence(fence,authSnapshot(),'canonical_operation'); };
    if (action !== 'reconcile' && !snapshot.brief.trim()) { setState(s=>({...s,error:'依頼を入力してください。'})); return; }
    if(action!=='reconcile' && action!=='edit-result' && ((configRef.current.requiredSources??0)>[snapshot.slots.primary,snapshot.slots.secondary].filter(Boolean).length||((configRef.current.requiredSources??0)>0&&!snapshot.slots.primary))){setState(s=>({...s,error:'必要な元画像を選択してください。'}));return;}
    if (action === 'edit-source' && !snapshot.slots.primary) return;
    if (action === 'edit-result' && (!snapshot.result?.storagePath || !snapshot.result.imageId || !snapshot.result.jobId)) return;
    if(action!=='reconcile' && isModelToolFeature(toolId) && !readModelToolSettings(toolId,snapshot.inputState)){setState(s=>({...s,error:'モデル設定を確認してください。'}));return;}
    const librarySettings=(configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId))?readModelLibrarySettings(snapshot.inputState):null;
    if(action!=='reconcile'&&(configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId))&&!librarySettings){setState(s=>({...s,error:'保存された入力モードとモデル条件を確認してください。'}));return;}
    if(action!=='reconcile'&&librarySettings?.inputMode==='custom'&&!snapshot.slots.secondary){setState(s=>({...s,error:'顔の参考図を選択してください。'}));return;}
    const newAction=(configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId))?action==='generate'?'generate-image':'edit-image':backendAction;
    const creationOutputSize=configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId)&&action==='generate'&&librarySettings?.inputMode==='custom'?{width:1024,height:1536}:undefined;
    if (action !== 'reconcile' && cloudflareDataPlane) {
      // Keep a private server copy of each uploaded input so a resume in another
      // browser can show it. A failed copy never blocks the generation. busy is
      // held during the copy so a second click cannot start another request.
      busy.current = true;
      try { for (const key of ['primary','secondary'] as const) {
        const slot = snapshot.slots[key];
        if (!slot || slot.sourceStoragePath || slot.sourceMediaPath || !slot.imageUrl) continue;
        try {
          const blob = await (await fetch(slot.imageUrl)).blob();
          if (!blob.type.startsWith('image/') || blob.size > 20 * 1024 * 1024) continue;
          const mediaPath = await cloudflareDataPlane.uploadWorkspaceSourceImage(blob, toolId);
          if (!mounted.current || captured !== scopeRef.current) return;
          snapshot.slots = {...snapshot.slots, [key]: {...slot, sourceMediaPath: mediaPath}};
          setState(s => s.slots[key] === slot ? {...s, slots: {...s.slots, [key]: {...slot, sourceMediaPath: mediaPath}}} : s);
        } catch { /* local copy still works in this browser */ }
      } } finally { busy.current = false; }
    }
    const request = action === 'reconcile' ? pending.current : {requestId:crypto.randomUUID(),createdAt:Date.now(),originJob:jobId,brief:snapshot.brief,
      referenceNote:snapshot.referenceNote,backendAction:newAction,...(creationOutputSize?{requestedOutputSize:creationOutputSize}:{}),inputState:workspaceInputState(toolId,snapshot.inputState),materialSlots:serializeLightchainResumeSlots(snapshot.slots)};
    if (!request) return;
    busy.current = true;
    let invocationAttempted = false;
    try {
      // Old retained IDs keep their original action. They are read once through
      // the receipt endpoint and are never resubmitted as a creation request.
      const retainedAction=action==='reconcile'?(request.backendAction??resolveHeavyCapability(toolId).action):newAction;
      if(typeof retainedAction!=='string'||!['generate-image','edit-image','model-matrix'].includes(retainedAction))throw new Error('image_pending_action_unavailable');
      const requestAction=retainedAction as 'generate-image'|'edit-image'|'model-matrix';
      assertCurrent();
      setState(s=>({...s,status:'running',error:null}));
      let receipt: (ImageEditResult | ModelMatrixResult) & {state?:string};
      if (action === 'reconcile') {
        if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
        try { receipt = await cloudflareDataPlane.readImageAIRequest(request.requestId) as unknown as ImageEditResult; }
        catch (error) {
          // The server never admitted this ID (e.g. the page was left before it was sent): release the lock.
          if (error instanceof Error && error.message.startsWith('cloudflare_api_404_image_request_not_found')
            && Date.now() - (request.createdAt ?? 0) > PENDING_NOT_FOUND_GRACE_MS) {
            assertCurrent(); rememberPending(null);
            setState(s=>({...s,status:s.result?'saved':'empty',pendingId:null,error:'前回の依頼はサーバーに届いていませんでした。もう一度生成してください。'}));
            return;
          }
          throw error;
        }
        if (receipt.requestId !== request.requestId) throw new Error('image_request_identity_mismatch');
        if (receipt.state === 'running') {
          // Still generating on the server (it continues after the page was left); check again shortly.
          setState(s=>({...s,status:'running',error:null,pendingId:request.requestId}));
          window.setTimeout(()=>{ if (mounted.current && scopeRef.current===captured && pending.current?.requestId===request.requestId) void run('reconcile'); },RUNNING_RECHECK_MS);
          return;
        }
      } else {
        const customRequest = isModelDescriptionFeature(toolId) && readModelToolSettings(toolId, request.inputState)?.inputMode === 'custom';
        const dispatchSlots = librarySettings ? request.materialSlots.filter(slot=>slot.key===(librarySettings.inputMode==='custom'?'secondary':'primary')) : customRequest ? request.materialSlots.filter(slot => slot.key !== 'secondary') : request.materialSlots;
        const prompt = [configRef.current.title ?? (toolId === 'lab' ? '画像の実験と編集' : toolId==='wear-design-detail'?'ウェアのディテール編集':toolId),configRef.current.promptContext,request.brief,(toolId==='lab'||toolId==='wear-design-lab'||toolId==='wear-design-detail')?'刺繍・ワンポイント・ロゴを加える場合は、既存ブランドのマーク（動物・人物・紋章など）に似せず、シンプルな抽象形にしてください。':'',customRequest ? '' : request.referenceNote,...(isModelToolFeature(toolId)?[modelToolSettingsPrompt(toolId,request.inputState)]:[]),...(librarySettings?[modelLibrarySettingsPrompt(librarySettings)]:[]),...(requestAction==='model-matrix'&&!isModelToolFeature(toolId)&&!(configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId))?Object.entries(request.inputState??{}).map(([key,value])=>`${key}: ${Array.isArray(value)?value.join(','):String(value)}`):[])].filter(Boolean).join('\n');
        // Match the existing Heavy login-only compatibility flag. The
        // authenticated adapter/server still performs its actual admission;
        // this does not invent terms acceptance or a new rights attestation.
        const rightsConfirmed = isHeavyOwnedFeature(toolId) && Boolean(fence.userId && fence.brandId);
        const options = {rightsConfirmed,idempotencyKey:request.requestId,assertContext:assertCurrent,retainUntilAcknowledged:true,
          featureType:`lightchain-${toolId}`,lightchainCompat:{lightchainFeatureId:toolId,lightchainFeatureTitle:toolId,lightchainTaskCodes:[toolId]},
          ...(configRef.current.providerModel?{providerModel:configRef.current.providerModel}:{}),
          materialReferences:dispatchSlots,canonicalInput:{toolId,inputState:isModelToolFeature(toolId)?workspaceInputState(toolId,request.inputState):request.inputState??{},brief:request.brief,referenceNote:request.referenceNote}};
        if((configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId))&&action==='generate'){
          const source=librarySettings?.inputMode==='custom'?snapshot.slots.secondary:snapshot.slots.primary;
          const preview=librarySettings?.inputMode==='custom'?modelLibraryBodyPreview(librarySettings):null;
          if(librarySettings?.inputMode==='custom'&&!preview)throw new Error('model_body_preview_unavailable');
          assertCurrent();rememberPending(request);invocationAttempted=true;setState(s=>({...s,pendingId:request.requestId}));
          receipt=await generateImage(prompt,fence.brandId,{...options,...creationOutputSize,generationProvider:HEAVY_IMAGE_PROVIDER,imageUrls:[...(source?[source.imageUrl]:[]),...(preview?[preview]:[])],count:1,
            ...(preview?{sourceReadback:{faceReferenceIndex:0,bodyReferenceIndex:1,bodyPreviewUrl:preview,bodyCatalogSha256:MODEL_LIBRARY_BODY_CATALOG_SHA256}}:{})});
        } else if (requestAction==='model-matrix') {
          let target=snapshot.slots.primary?.imageUrl;
          if(action==='edit-result'){const [signed]=await withSignedImageUrls([{storage_path:snapshot.result!.storagePath!,image_url:''}]);if(!signed?.image_url)throw new Error('image_source_unavailable');target=signed.image_url;}
          assertCurrent();rememberPending(request);invocationAttempted=true;setState(s=>({...s,pendingId:request.requestId}));
          const form=request.inputState??{};
          receipt=await generateModelMatrix(prompt,fence.brandId,{...options,generationProvider:HEAVY_IMAGE_PROVIDER,imageUrl:target,...(!customRequest?{modelReferenceImageUrl:snapshot.slots.secondary?.imageUrl,
            modelReferenceFileName:snapshot.slots.secondary?.name,modelReferenceSourceImageId:snapshot.slots.secondary?.sourceImageId,modelReferenceSourceStoragePath:snapshot.slots.secondary?.sourceStoragePath}:{}),
            bodyTypes:Array.isArray(form.bodyTypes)?form.bodyTypes.filter((v):v is string=>typeof v==='string'):['regular'],
            ageGroups:Array.isArray(form.ageGroups)?form.ageGroups.filter((v):v is string=>typeof v==='string'):['20s'],gender:form.gender==='女性'||form.gender==='female'?'female':'male'});
        } else if (action === 'generate' && !snapshot.slots.primary) {
          rememberPending(request); invocationAttempted = true;
          setState(s=>({...s,pendingId:request.requestId}));
          receipt = await generateImage(prompt,fence.brandId,{...options,generationProvider:HEAVY_IMAGE_PROVIDER});
        }
        else {
          const ordered = [snapshot.slots.primary,snapshot.slots.secondary].filter((value): value is Source => Boolean(value)).filter(value=>!librarySettings||value===(librarySettings.inputMode==='custom'?snapshot.slots.secondary:snapshot.slots.primary));
          let target = ordered[0]?.imageUrl ?? '';
          let references = ordered.slice(1).map(value=>value.imageUrl);
          if (action === 'edit-result') { const [signed] = await withSignedImageUrls([{storage_path:snapshot.result!.storagePath!,image_url:''}]);
            if (!signed?.image_url) throw new Error('image_source_unavailable'); target = signed.image_url; references = ordered.map(value=>value.imageUrl); }
          else if (configRef.current.prepareSourceImage) {
            // Page-specific preprocessing of what is sent; the stored input stays the original upload.
            const prepare = configRef.current.prepareSourceImage;
            const safe = async (url: string) => { try { return await prepare(url); } catch { return url; } };
            target = await safe(target); references = await Promise.all(references.map(safe));
          }
          // Signing is definite local preprocessing. Retain the ID only once
          // that succeeds, immediately before entering the provider adapter.
          // Adapter throws may have external effects and remain uncertain.
          assertCurrent(); rememberPending(request); invocationAttempted = true;
          setState(s=>({...s,pendingId:request.requestId}));
          receipt = await editImageWithPrompt(target,prompt,fence.brandId,{...options,referenceImageUrls:references});
        }
      }
      assertCurrent();
      if (receipt.requestId !== request.requestId) throw new Error('image_request_identity_mismatch');
      if (receipt.state === 'failed') { rememberPending(null); setState(s=>({...s,status:'error',error:'画像の生成に失敗しました。保存済みの結果は保持されています。',pendingId:null})); return; }
      let candidates:CanonicalModelCandidate[]=[];
      let storagePath:string|undefined|null,imageUrl:string|undefined,imageId:string|undefined|null,providerJob:string|undefined|null;
      if(requestAction==='model-matrix'){
        const matrixReceipt=normalizeCompletedModelMatrixResult(receipt as ModelMatrixResult,{bodyTypes:Array.isArray(request.inputState?.bodyTypes)?request.inputState!.bodyTypes as string[]:undefined,ageGroups:Array.isArray(request.inputState?.ageGroups)?request.inputState!.ageGroups as string[]:undefined});
        assertCompletedModelMatrixResult(matrixReceipt,'canonical_model_receipt');
        candidates=matrixReceipt.matrix!.map(item=>({imageId:item.imageId!,storagePath:item.storagePath!,jobId:item.jobId!,bodyType:item.bodyType,ageGroup:item.ageGroup,provider:item.provider!}));
        const first=matrixReceipt.matrix![0];storagePath=first.storagePath;imageUrl=first.imageUrl;imageId=first.imageId;providerJob=matrixReceipt.jobId;
      }else{
        assertCompletedImageEditResult(receipt as ImageEditResult,'canonical_workspace_receipt');
        const image=(receipt as ImageEditResult).images?.[0];
        storagePath=(receipt as ImageEditResult).storagePath??image?.storagePath;imageUrl=(receipt as ImageEditResult).imageUrl??image?.imageUrl;
        imageId=(receipt as ImageEditResult).imageId??image?.imageId??image?.id;providerJob=receipt.jobId??image?.jobId;
      }
      if (!storagePath || !imageUrl || !imageId || !providerJob) throw new Error('image_result_identity_missing');
      if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
      const persistenceContext = await cloudflareDataPlane.captureArtifactPersistenceContext({assertContext:assertCurrent});
      assertCurrent();
      const persisted = await persistProviderResultArtifact({brandId:fence.brandId,scopeId:fence.userId,featureType:`lightchain-${toolId}-provider-result`,
        title:configRef.current.title ?? (toolId==='lab'?'ラボ画像':'ウェアデザイン画像'),imageUrl,prompt:request.brief,sourceJobId:providerJob,storagePath,requireRemote:true,
        metadata:{toolId,brief:request.brief,referenceNote:request.referenceNote,materialSlots:request.materialSlots as unknown as Json,
          inputState:isModelToolFeature(toolId)?workspaceInputState(toolId,request.inputState):request.inputState??{},backendAction:requestAction,
          ...(record(request.requestedOutputSize)&&Object.keys(request.requestedOutputSize).length===2&&request.requestedOutputSize.width===1024&&request.requestedOutputSize.height===1536?{requestedOutputSize:{width:1024,height:1536}}:{}),
          ...((configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId))&&requestAction==='generate-image'&&readModelLibrarySettings(request.inputState)?.inputMode==='custom'?{modelBodyPreview:{url:modelLibraryBodyPreview(request.inputState),catalogSha256:MODEL_LIBRARY_BODY_CATALOG_SHA256}}:{}),
          modelCandidates:candidates as unknown as Json,selectedCandidateId:candidates[0]?.imageId??null,imageId,provider:receipt.provider ?? HEAVY_IMAGE_PROVIDER,sourceResumePath:location.pathname}},
        {persistenceContext});
      assertCurrent();
      const savedJob = persisted.remote?.jobId ?? persisted.artifact.sourceJobId;
      if (!savedJob || !persisted.remote?.storagePath || !persisted.remote.imageId) throw new Error('image_result_persistence_missing');
      // Canonical model persistence reuses this owner's exact provider row;
      // a derived/new job receipt cannot become this matrix's resume identity.
      if((requestAction==='model-matrix'||(configRef.current.modelLibraryCreation===true&&isModelLibraryFeature(toolId)))&&(savedJob!==providerJob||persisted.remote.imageId!==imageId||persisted.remote.storagePath!==storagePath))throw new Error('model_result_persistence_identity_mismatch');
      rememberPending(null);
      releases.current.result?.release(); delete releases.current.result;
      setState(s=>({...s,brief:request.brief,inputState:isModelToolFeature(toolId)?workspaceInputState(toolId,request.inputState):request.inputState??s.inputState,candidates,selectedCandidateId:candidates[0]?.imageId??null,result:{artifactId:persisted.artifact.id,toolId,title:persisted.artifact.title,summary:request.brief,imageUrl,
        jobId:savedJob,imageId:persisted.remote!.imageId,storagePath:persisted.remote!.storagePath,generationMode:'provider',provider:receipt.provider ?? HEAVY_IMAGE_PROVIDER,
        backendProvider:receipt.backendProvider ?? null,parityRuntime:null},status:isModelToolFeature(toolId)&&!readModelToolSettings(toolId,request.inputState)?'unavailable':'saved',error:isModelToolFeature(toolId)&&!readModelToolSettings(toolId,request.inputState)?'元のモデル設定を取得できません。':null,pendingId:null}));
      const params = new URLSearchParams(location.search); params.set('resumeJob',savedJob);
      navigate({pathname:location.pathname,search:params.toString(),hash:location.hash},{replace:true});
      // Durable identity may remain in the existing adapter if acknowledgement
      // is unavailable; this never changes the already verified saved result.
      if (receipt.clientRecoveryKey) void cloudflareDataPlane?.acknowledgeImageAction(receipt as ImageEditResult).catch(()=>{});
    } catch { if (mounted.current && scopeRef.current===captured && sequence.current===token) {
      const uncertain = invocationAttempted || action==='reconcile';
      setState(s=>({...s,status:uncertain?'unknown':'error',pendingId:pending.current?.requestId ?? null,error:uncertain
        ?'処理結果を確認できません。同じ依頼を照合してください。保存済みの結果は保持されています。'
        :'入力画像の準備に失敗しました。画像や依頼を確認してください。保存済みの結果は保持されています。'}));
    } }
    finally { if (scopeRef.current===captured && sequence.current===token) busy.current=false; }
  };
  useEffect(() => {
    // Returning to a page with a retained request reads its receipt once (read-only, never a resend), so a job
    // that kept running after the page was left shows its result without a manual 照合.
    if (!state.pendingId || state.status !== 'unknown' || autoReconciled.current === state.pendingId || !authSnapshot()) return;
    autoReconciled.current = state.pendingId;
    void run('reconcile');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pendingId, state.status, brandState.status]);
  const selectCandidate=async(imageId:string)=>{
    if(busy.current||stateRef.current.pendingId||stateRef.current.status==='loading')return;
    const snapshot=stateRef.current,candidate=snapshot.candidates.find(item=>item.imageId===imageId),fence=authSnapshot(),captured=scopeRef.current;
    if(!candidate||!snapshot.result||!fence||candidate.jobId!==jobId)return;
    busy.current=true;const token=++sequence.current;
    const assertCurrent=()=>{if(!mounted.current||scopeRef.current!==captured||sequence.current!==token)throw new Error('canonical_workspace_stale');assertAuthBrandFence(fence,authSnapshot(),'canonical_candidate_selection');};
    try{
      const [signed]=await withSignedImageUrls([{storage_path:candidate.storagePath,image_url:''}]);assertCurrent();if(!signed?.image_url)throw new Error('image_source_unavailable');
      const existingArtifact=listWorkspaceArtifacts(fence.brandId,fence.userId).find(item=>item.id===snapshot.result!.artifactId&&item.sourceJobId===jobId&&item.metadata.toolId===toolId);
      const exactRestored=restoredArtifact.current?.scope===captured?restoredArtifact.current.artifact:null;
      const artifact=existingArtifact??exactRestored;
      if(!artifact||artifact.id!==snapshot.result.artifactId||artifact.brandId!==fence.brandId||artifact.scopeId!==fence.userId)throw new Error('canonical_candidate_artifact_missing');
      if(!jobId||artifact.sourceJobId!==jobId)throw new Error('canonical_candidate_artifact_missing');
      const saved=saveWorkspaceArtifactPersisted({...artifact,imageUrl:'',metadata:{...artifact.metadata,selectedCandidateId:imageId,imageId,storagePath:candidate.storagePath,provider:candidate.provider}});
      if(!saved.ok)throw saved.error;assertCurrent();
      setState(s=>({...s,selectedCandidateId:imageId,result:{...snapshot.result!,imageId,storagePath:candidate.storagePath,imageUrl:signed.image_url,provider:candidate.provider},status:'saved',error:null}));
    }catch{if(mounted.current&&scopeRef.current===captured&&sequence.current===token)setState(s=>({...s,error:'候補を保存できませんでした。保存済みの選択は保持されています。'}));}
    finally{if(scopeRef.current===captured&&sequence.current===token)busy.current=false;}
  };
  const wearFamily=toolId==='wear-design-lab'||toolId==='wear-design-detail';
  const continueParams=new URLSearchParams(location.search);if(wearFamily)continueParams.set('workspaceFeature',toolId);
  return {...state,jobId,toolId,backendAction,upload,clearSource,selectModelReference,sourceSelectionScope:scope,setInputState,selectCandidate,setBrief:(value:string)=>setText('brief',value),setReferenceNote:(value:string)=>setText('referenceNote',value),
    generate:(override?:{brief?:string;inputState?:Record<string,Json>})=>run('generate',override),editSource:()=>run('edit-source'),editResult:()=>run('edit-result'),reconcile:()=>run('reconcile'),
    continueHref:wearFamily?`/flow/orientedDesign/detail?${continueParams.toString()}${location.hash}`:`/flow/laboratory/detail${location.search}${location.hash}`};
}

export type CanonicalImageWorkspace = ReturnType<typeof useCanonicalImageWorkspace>;
