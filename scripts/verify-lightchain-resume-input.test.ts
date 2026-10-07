import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readLightchainResumeInput, readLightchainResumeResult, serializeLightchainResumeSlots } from '../src/lib/lightchainResume.ts';
import { buildLocalCanvasAssetReference } from '../src/lib/canvasLocalAssets.ts';
import { buildLocalUploadSourceMetadata } from '../src/features/canvasSourceMetadata.ts';

const artifact = (overrides: Record<string, unknown> = {}) => ({
  id: 'artifact-1',
  brandId: 'brand-1',
  featureType: 'lightchain-model-change',
  title: 'Model change',
  imageUrl: '',
  prompt: null,
  createdAt: '2026-08-14T00:00:00.000Z',
  metadata: {},
  sourceJobId: 'job-1',
  ...overrides,
});

test('resume input restores only same-job local source slots and model settings', () => {
  const result = readLightchainResumeInput([
    artifact({
      metadata: {
        lightchainWorkbenchState: {
          materialSlots: [
            { key: 'primary', fileName: 'garment.png', materialKind: 'シャツ', imageUrl: 'data:image/png;base64,AAAA' },
            { key: 'secondary', fileName: 'reference.png', materialKind: '参考', imageUrl: 'blob:https://example.test/reference' },
          ],
          modelFormState: { bodyType: 'regular', angleZoom: 2 },
        },
      },
    }),
  ], 'job-1');

  assert.deepEqual(result, {
    artifactId: 'artifact-1',
    slots: [
      { key: 'primary', name: 'garment.png', kind: 'シャツ', imageUrl: 'data:image/png;base64,AAAA' },
      { key: 'secondary', name: 'reference.png', kind: '参考', imageUrl: 'blob:https://example.test/reference' },
    ],
    modelFormState: { bodyType: 'regular', angleZoom: 2 },
  });
});

test('resume input rejects remote signed URLs and unrelated jobs', () => {
  const result = readLightchainResumeInput([
    artifact({
      sourceJobId: 'other-job',
      metadata: {
        materialSlots: [
          { key: 'primary', fileName: 'remote.png', materialKind: '素材', imageUrl: 'https://example.test/signed.png?token=stale' },
        ],
      },
    }),
    artifact({
      metadata: {
        materialSlots: [
          { key: 'primary', fileName: 'remote.png', materialKind: '素材', imageUrl: 'https://example.test/signed.png?token=stale' },
        ],
      },
    }),
  ], 'job-1');

  assert.deepEqual(result?.slots, []);
  assert.equal(result?.unavailableSources, true);
});

test('resume input restores local slots from provider result materialSlotFiles', () => {
  const result = readLightchainResumeInput([
    artifact({
      featureType: 'lightchain-printing-image-provider-result',
      metadata: {
        providerResultArtifact: true,
        materialSlotFiles: {
          primary: {
            name: 'garment.png',
            kind: 'フーディー',
            imageUrl: 'data:image/png;base64,AAAA',
          },
          secondary: {
            name: 'print.png',
            kind: 'プリント',
            imageUrl: 'blob:https://example.test/print',
          },
        },
      },
    }),
  ], 'job-1');

  assert.deepEqual(result?.slots, [
    { key: 'primary', name: 'garment.png', kind: 'フーディー', imageUrl: 'data:image/png;base64,AAAA' },
    { key: 'secondary', name: 'print.png', kind: 'プリント', imageUrl: 'blob:https://example.test/print' },
  ]);
});

test('resume result keeps canonical storage identity and never reuses a stale bearer URL', () => {
  const result = readLightchainResumeResult([
    artifact({
      imageUrl: 'https://example.test/signed.png?token=stale',
      featureType: 'lightchain-ai-fitting-provider-result',
      metadata: {
        providerResultArtifact: true,
        toolId: 'ai-fitting',
        generationSummary: '衣服 / モデル / 無地背景',
        provider: 'openai',
        backendProvider: 'supabase-edge-function',
        imageId: 'image-1',
        storagePath: 'brand-1/job-1.png',
      },
    }),
  ], 'job-1');

  assert.deepEqual(result, {
    artifactId: 'artifact-1',
    toolId: 'ai-fitting',
    title: 'Model change',
    summary: '衣服 / モデル / 無地背景',
    imageUrl: '',
    storagePath: 'brand-1/job-1.png',
    generationMode: 'provider',
    provider: 'openai',
    backendProvider: 'supabase-edge-function',
    jobId: 'job-1',
    imageId: 'image-1',
    parityRuntime: undefined,
  });
});

test('resume result accepts a local persisted image and rejects URL-only remote history', () => {
  const local = readLightchainResumeResult([
    artifact({
      imageUrl: 'data:image/png;base64,AAAA',
      featureType: 'lightchain-model-change-provider-result',
      metadata: { providerResultArtifact: true, toolId: 'model-change' },
    }),
  ], 'job-1');
  assert.equal(local?.imageUrl, 'data:image/png;base64,AAAA');
  assert.equal(local?.storagePath, null);

  const staleRemote = readLightchainResumeResult([
    artifact({
      imageUrl: 'https://example.test/signed.png?token=stale',
      featureType: 'lightchain-model-change-provider-result',
      metadata: { providerResultArtifact: true, toolId: 'model-change' },
    }),
  ], 'job-1');
  assert.equal(staleRemote, null);
});

test('resume hydration is declared after the tool reset effect', async () => {
  const source = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  const resetIndex = source.indexOf("setMaterialSlotFiles({ primary: null, secondary: null });");
  const restoredIndex = source.indexOf("setResumeInputReadback('restored');");

  assert.ok(resetIndex >= 0, 'tool reset effect must clear material slots');
  assert.ok(restoredIndex > resetIndex, 'resume hydration must run after tool reset so restored slots are not cleared');
});

test('exact job, owner, brand and tool constrain input and result; text-only and empty values survive', () => {
  const scope = {brandId:'brand-1',scopeId:'owner',toolId:'lab'};
  const base = artifact({scopeId:'owner',featureType:'lightchain-lab-provider-result',metadata:{toolId:'lab',brief:'',referenceNote:''}});
  const wrong = [artifact({...base,id:'wrong-brand',brandId:'brand-2'}),artifact({...base,id:'wrong-owner',scopeId:'other'}),
    artifact({...base,id:'wrong-tool',metadata:{toolId:'other',brief:'WRONG'}}),artifact({...base,id:'wrong-job',sourceJobId:'job-other'})];
  assert.deepEqual(readLightchainResumeInput([...wrong,base],'job-1',scope),{artifactId:'artifact-1',slots:[],modelFormState:null,brief:'',referenceNote:''});
  assert.equal(readLightchainResumeInput(wrong,'job-1',scope),null);
  const textOnly = artifact({...base,metadata:{toolId:'lab',brief:'  exact brief  ',referenceNote:'参考'}});
  assert.equal(readLightchainResumeInput([textOnly],'job-1',scope)?.brief,'  exact brief  ');
  assert.equal(readLightchainResumeInput([artifact({...base,metadata:{toolId:'lab',referenceNote:''}})],'job-1',scope)?.brief,undefined);
  assert.equal(readLightchainResumeResult(wrong,'job-1',scope),null);
});

test('canonical slots and local IndexedDB identities survive without stale bearer URLs; result never adopts an input path', () => {
  const localRef = buildLocalCanvasAssetReference('sha256:'+ 'a'.repeat(64));
  const saved = artifact({metadata:{toolId:'lab',brief:'test',materialSlots:[
    {key:'primary',fileName:'source.png',materialKind:'model',imageUrl:'https://heavy.test/v1/media/read?token=stale',sourceImageId:'source-1',sourceStoragePath:'generated-images/source-1',persistenceStatus:'persistent'},
    {key:'secondary',fileName:'background.png',materialKind:'background',imageUrl:localRef,persistenceStatus:'persistent'},
  ],providerResultArtifact:true,storagePath:'generated-images/result-1'}});
  const input = readLightchainResumeInput([saved],'job-1');
  assert.equal(input?.slots[0].sourceImageId,'source-1'); assert.equal(input?.slots[0].sourceStoragePath,'generated-images/source-1');
  assert.equal(input?.slots[0].imageUrl,''); assert.equal(input?.slots[1].imageUrl,localRef);
  assert.equal(readLightchainResumeResult([saved],'job-1')?.storagePath,'generated-images/result-1');
  assert.equal(readLightchainResumeResult([artifact({...saved,metadata:{...saved.metadata,storagePath:undefined}})],'job-1'),null);
});

test('new slot persistence stores canonical/local references and sanitized metadata, never bytes/blob/bearer URLs', async () => {
  const metadata = await buildLocalUploadSourceMetadata(new Blob(['fixture'],{type:'image/png'}),{width:8,height:8});
  const localRef = buildLocalCanvasAssetReference(metadata.sourceRevision.revision);
  const slots = serializeLightchainResumeSlots({
    primary:{name:'local.png',kind:'upload',imageUrl:'data:image/png;base64,SECRETB YTES',localAssetRef:localRef,persistenceStatus:'persistent',
      sourceMetadata:{...metadata,raw:'data:image/png;base64,SECRET',url:'https://heavy.test?token=BEARER'} as any},
    secondary:{name:'canonical.png',kind:'library',imageUrl:'https://heavy.test/read?token=BEARER',sourceImageId:'owned-image',sourceStoragePath:'generated-images/owned-image'},
  });
  assert.equal(slots[0].imageUrl,localRef); assert.equal(slots[1].imageUrl,''); assert.equal(slots[1].sourceStoragePath,'generated-images/owned-image');
  assert(!JSON.stringify(slots).includes('SECRET')); assert(!JSON.stringify(slots).includes('BEARER'));
  const unavailable = serializeLightchainResumeSlots({primary:{name:'ephemeral',kind:'upload',imageUrl:'blob:https://heavy.test/temp'}});
  assert.equal(unavailable[0].persistenceStatus,'session-only'); assert.equal(unavailable[0].imageUrl,'');
  assert.equal(readLightchainResumeInput([artifact({metadata:{materialSlots:unavailable}})],'job-1')?.unavailableSources,true);
  const rejected = readLightchainResumeInput([artifact({metadata:{materialSlots:[{key:'primary',fileName:'bad',imageUrl:'/v1/media/read?token=BEARER'}]}})],'job-1');
  assert.equal(rejected?.slots.length,0); assert.equal(rejected?.unavailableSources,true);
});

test('resume input restores AI fitting reference picks from durable refs only', () => {
  const localRef = buildLocalCanvasAssetReference(`sha256:${'a'.repeat(64)}`);
  const result = readLightchainResumeInput([
    artifact({
      featureType: 'lightchain-fitting-background-reference',
      metadata: {
        materialSlots: [{ key: 'primary', fileName: 'garment.png', materialKind: 'シャツ', imageUrl: localRef }],
        fittingReferenceSlots: [
          { key: 'model', name: 'group-26-1', imageUrl: '/lightchain-assets/models/group-26-1.webp' },
          { key: 'background', name: 'bg.jpg', imageUrl: localRef },
          { key: 'pose', name: 'pose.png', imageUrl: 'blob:https://example.test/pose' },
          { key: 'face', name: 'x', imageUrl: '/x.png' },
          { key: 'model', name: 'signed', imageUrl: 'https://cdn.example.test/a.png?token=1' },
        ],
      },
    }),
  ], 'job-1');
  assert.deepEqual(result?.fittingReferences, [
    { key: 'model', name: 'group-26-1', imageUrl: '/lightchain-assets/models/group-26-1.webp' },
    { key: 'background', name: 'bg.jpg', imageUrl: localRef },
  ]);
});

test('a private media copy keeps a source slot resumable and survives serialization', () => {
  const mediaPath = 'media/v1/0b1f7a2e-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
  const serialized = serializeLightchainResumeSlots({ primary: { name: 'tee.png', kind: 'primary', imageUrl: 'blob:https://example.test/x', sourceMediaPath: mediaPath }, secondary: null });
  assert.equal(serialized[0].sourceMediaPath, mediaPath);
  assert.equal(serialized[0].persistenceStatus, 'persistent');
  const input = readLightchainResumeInput([artifact({ metadata: { materialSlots: serialized, brief: 'b' } })], 'job-1');
  assert.equal(input?.slots[0].sourceMediaPath, mediaPath);
  const rejected = serializeLightchainResumeSlots({ primary: { name: 'x.png', kind: 'primary', imageUrl: 'blob:https://example.test/x', sourceMediaPath: 'https://evil.test/x' }, secondary: null });
  assert.equal(rejected[0].sourceMediaPath, undefined);
});
