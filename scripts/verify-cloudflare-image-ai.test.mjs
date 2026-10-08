import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { createPendingIndexedDbHarness,createPendingLegacyStorage } from './verify-cloudflare-image-pending-store.test.mjs';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const modulePath = '/src/lib/cloudflareImageAI.ts';
let image = await vite.ssrLoadModule(modulePath);
const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;
const originalIndexed = globalThis.indexedDB;
after(async () => { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; globalThis.indexedDB = originalIndexed; await vite.close(); });
function setup() {
  const store = new Map();
  const indexed = createPendingIndexedDbHarness(); globalThis.indexedDB = indexed;
  globalThis.localStorage = createPendingLegacyStorage(store);
  const calls = [];
  const options = { origin: 'https://heavy.test', userId: 'alice', action: 'generate-image',
    body: { brandId: 'brand', prompt: crypto.randomUUID(), legalSafety: { rightsConfirmed: true } },
    assertCurrent: async () => {}, call: async (path,init = {}) => {
      const id = init.method === 'POST' ? new Headers(init.headers).get('idempotency-key') : path.split('/').at(-1);
      calls.push({ path,method: init.method ?? 'GET',id }); return receipt(id);
    } };
  return { store,indexed,calls,options };
}
function receipt(id,state = 'completed') {
  return { success: state === 'completed',requestId: id,state,recovery: state === 'unknown' ? 'reconcile_only_no_reinference' : 'terminal',
    persistenceStatus: state === 'completed' ? 'completed' : 'failed',
    images: state === 'completed' ? [{ imageId: 'ai-'+id+'-0',storagePath: 'generated-images/ai-'+id+'-0',imageUrl: 'https://heavy.test/private?token=fixture' }] : [] };
}

async function withImagePlatform({ dimensions = [],failFetchAt = -1 } = {},run) {
  const globalDescriptors = new Map(['fetch','Image','document','FileReader'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const urlDescriptors = new Map(['createObjectURL','revokeObjectURL'].map(key => [key,Object.getOwnPropertyDescriptor(URL,key)]));
  const blobMetadata = new WeakMap(); const objectURLs = new Map();
  const fetches = []; const fetchOptions = []; const created = []; const revoked = []; const draws = [];
  const restore = (target,key,descriptor) => {
    if (descriptor) Object.defineProperty(target,key,descriptor); else delete target[key];
  };
  try {
    globalThis.fetch = async (source,init = {}) => {
      const index = fetches.length; fetches.push(source); fetchOptions.push(init);
      if (index === failFetchAt) return { ok:false,status:503,headers:new Headers(),blob:async()=>new Blob() };
      const blob = new Blob([`source:${index}`],{ type:'image/jpeg' });
      blobMetadata.set(blob,{ index,source });
      return { ok:true,status:200,headers:new Headers({ 'content-length':String(blob.size) }),blob:async()=>blob };
    };
    URL.createObjectURL = blob => {
      const metadata = blobMetadata.get(blob); assert.ok(metadata,'object URL must come from the fetched reference');
      const url = `blob:reference-${metadata.index}`; objectURLs.set(url,metadata); created.push(url); return url;
    };
    URL.revokeObjectURL = url => { revoked.push(url); objectURLs.delete(url); };
    globalThis.Image = class MockImage {
      naturalWidth = 0; naturalHeight = 0; onload = null; onerror = null; sourceIndex = -1;
      set src(url) {
        const metadata = objectURLs.get(url);
        if (!metadata) { queueMicrotask(() => this.onerror?.(new Error('unknown_object_url'))); return; }
        this.sourceIndex = metadata.index;
        [this.naturalWidth,this.naturalHeight] = dimensions[metadata.index] ?? [1024,768];
        queueMicrotask(() => this.onload?.());
      }
    };
    globalThis.document = { createElement(name) {
      assert.equal(name,'canvas'); let sourceIndex = -1;
      return {
        width:0,height:0,
        getContext(kind) {
          assert.equal(kind,'2d');
          return { drawImage(image,_x,_y,width,height) { sourceIndex = image.sourceIndex; draws.push({ sourceIndex,width,height }); } };
        },
        toBlob(callback,mime) { callback(new Blob([`processed:${sourceIndex}:${this.width}x${this.height}`],{ type:mime })); },
      };
    } };
    globalThis.FileReader = class MockFileReader {
      result = null; onload = null; onerror = null;
      readAsDataURL(blob) {
        blob.text().then(text => {
          this.result = `data:${blob.type};base64,${Buffer.from(text).toString('base64')}`;
          this.onload?.();
        }).catch(error => this.onerror?.(error));
      }
    };
    return await run({ fetches,fetchOptions,created,revoked,draws });
  } finally {
    for (const [key,descriptor] of globalDescriptors) restore(globalThis,key,descriptor);
    for (const [key,descriptor] of urlDescriptors) restore(URL,key,descriptor);
  }
}

test('parallel same-input calls share one real client submission and retain no reference or token in pending storage',async () => {
  const s = setup(); let release; const wait = new Promise(resolve => { release = resolve; });
  const base = s.options.call; s.options.call = async (...args) => { await wait; return base(...args); };
  const first = image.invokeDurableImageAction(s.options); const second = image.invokeDurableImageAction(s.options);
  release(); const [one,two] = await Promise.all([first,second]);
  assert.deepEqual(one,two); assert.equal(s.calls.length,1); assert.equal(s.calls[0].method,'POST'); assert.equal(s.store.size,0);
});

test('a lost response reads the same saved request, without a second POST',async () => {
  const s = setup(); const calls = [];
  s.options.call = async (path,init = {}) => {
    calls.push({ path,method: init.method ?? 'GET' });
    assert.equal(s.store.size,1);
    if (init.method === 'POST') throw new TypeError('response lost');
    return receipt(path.split('/').at(-1));
  };
  const result = await image.invokeDurableImageAction(s.options);
  assert.equal(result.success,true); assert.deepEqual(calls.map(c => c.method),['POST','GET']);
});

test('unknown outcome survives a module restart; later action reconciles only the same receipt',async () => {
  const s = setup(); let id;
  s.options.body.materialReferences = [{sourceStoragePath:'generated-images/source',imageUrl:'https://heavy.test/private?token=old'}];
  s.options.body.compositionPreview = { parityRuntime:JSON.stringify({fixtureId:'https://heavy.test/private?token=old',sourceImageId:'source',authorization:'old-bearer'}) };
  s.options.call = async (path,init = {}) => {
    assert.equal(init.method,'POST'); id = new Headers(init.headers).get('idempotency-key'); return receipt(id,'unknown');
  };
  assert.equal((await image.invokeDurableImageAction(s.options)).state,'unknown');
  assert.equal(s.store.size,1); const [key,value] = [...s.store][0]; assert.equal(value,id);
  assert(!key.includes(s.options.body.prompt)); assert(!value.includes('token'));
  vite.moduleGraph.invalidateAll(); image = await vite.ssrLoadModule(modulePath);
  s.options.body.materialReferences[0].imageUrl = 'https://heavy.test/private?token=refreshed';
  s.options.body.compositionPreview.parityRuntime = JSON.stringify({fixtureId:'https://heavy.test/private?token=refreshed',sourceImageId:'source',authorization:'new-bearer'});
  s.options.call = async (path,init = {}) => { assert.equal(init.method,undefined); assert.equal(path,'/v1/image-ai/requests/'+id); return receipt(id); };
  assert.equal((await image.invokeDurableImageAction(s.options)).requestId,id); assert.equal(s.store.size,0);
});

test('when no receipt exists after a lost POST, only a later explicit invocation resubmits the same ID',async () => {
  const s = setup(); let firstID; let phase = 0; const methods = [];
  s.options.call = async (path,init = {}) => {
    methods.push(init.method ?? 'GET');
    if (init.method === 'POST') {
      const id = new Headers(init.headers).get('idempotency-key');
      if (!phase) { firstID = id; throw new TypeError('network lost before admission'); }
      assert.equal(id,firstID); return receipt(id);
    }
    throw new Error('cloudflare_api_404_image_request_not_found');
  };
  await assert.rejects(image.invokeDurableImageAction(s.options),/同じ依頼/);
  assert.deepEqual(methods,['POST','GET']); phase = 1;
  assert.equal((await image.invokeDurableImageAction(s.options)).success,true);
  assert.deepEqual(methods,['POST','GET','GET','POST']);
});

test('a 403 after inference retains its ID, while a definite rights rejection is not submitted again automatically',async () => {
  const s = setup(); let id;
  s.options.call = async (path,init = {}) => { if (init.method === 'POST') id = new Headers(init.headers).get('idempotency-key'); throw new Error('cloudflare_api_403_forbidden'); };
  await assert.rejects(image.invokeDurableImageAction(s.options),/保持/); assert.equal([...s.store.values()][0],id);
  s.options.call = async (path,init = {}) => { assert.equal(init.method,undefined); return receipt(id); };
  await image.invokeDurableImageAction(s.options);
  const rights = setup(); let count = 0;
  rights.options.call = async () => { count++; throw new Error('cloudflare_api_403_rights_confirmation_required'); };
  await assert.rejects(image.invokeDurableImageAction(rights.options),/rights_confirmation_required/);
  assert.equal(count,1); assert.equal(rights.store.size,0);
});

test('storage failure or session change stops inference/late delivery and retains pending identity',async () => {
  const s = setup(); globalThis.localStorage.setItem = () => { throw new Error('full'); }; s.indexed.failWrite = true;
  await assert.rejects(image.invokeDurableImageAction(s.options),/put_failure/); assert.equal(s.calls.length,0);
  const changed = setup(); let current = true;
  changed.options.assertCurrent = async () => { if (!current) throw new Error('session_changed'); };
  const base = changed.options.call; changed.options.call = async (...args) => { const result = await base(...args); current = false; return result; };
  await assert.rejects(image.invokeDurableImageAction(changed.options),/session_changed/);
  assert.equal(changed.calls.length,1); assert.equal(changed.store.size,1);
});

test('receipt identity, result state and canonical R2 save must agree before success is accepted',async () => {
  for (const corrupt of [r => ({...r,requestId:crypto.randomUUID()}),r => ({...r,success:false}),r => ({...r,images:[]}),r => ({...r,persistenceStatus:'pending'})]) {
    const s = setup(); let id;
    s.options.call = async (path,init = {}) => {
      id ??= new Headers(init.headers).get('idempotency-key'); return corrupt(receipt(id));
    };
    await assert.rejects(image.invokeDurableImageAction(s.options)); assert.equal(s.store.size,1);
  }
});

test('image preparation refuses unsupported/extra inputs before fetching and preserves garment/person roles',async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('must not fetch'); };
  for (const [action,body] of [['edit-image',{ maskApplied:true }],['generate-image',{ outputBackground:'transparent' }],
    ['edit-image',{ imageUrls:Array(5).fill('https://image.test') }],['generate-image',{ prompt:'brief', imageUrls:[null] }],
    ['model-matrix',{ modelReferenceImageUrl:'https://person.test' }],
    ['generate-image',{ prompt:'' }],['generate-image',{ brief:'   ' }],['edit-image',{ prompt:'edit' }],
    ['model-matrix',{ productDescription:'try-on' }],['model-matrix',{ generationProvider:'workers_ai',productDescription:'try-on' }]]) {
    await assert.rejects(image.prepareCloudflareImageInput(action,body));
  }
  assert.equal(calls,0);
  const promptOnly = await image.prepareCloudflareImageInput('model-matrix',{
    generationProvider:'openai',productDescription:'try-on',brandId:'brand',
  });
  assert.deepEqual(promptOnly,{ generationProvider:'openai',productDescription:'try-on',brandId:'brand',referenceTransforms:[],imageUrl:undefined,modelReferenceImageUrl:undefined });
  for (const input of [{ brandId:'brand',prompt:'shirt' },{ brandId:'brand',brief:'shirt brief' }]) {
    assert.deepEqual(await image.prepareCloudflareImageInput('generate-image',input),{...input,referenceTransforms:[],imageUrls:[]});
  }
});

test('OpenAI provider prepares five distinct references in input order with bounded PNG transforms and URL cleanup',async () => {
  const urls = Array.from({ length:5 },(_,index)=>`https://image.test/reference-${index+1}`);
  const dimensions = [[1024,768],[600,1200],[256,256],[500,500],[4096,1024]];
  const prepared = await withImagePlatform({ dimensions },async platform => {
    const value = await image.prepareCloudflareImageInput('edit-image',{ generationProvider:'openai',imageUrls:urls,brandId:'brand' });
    assert.deepEqual(platform.fetches,urls);
    assert.ok(platform.fetchOptions.every(options => options.credentials === 'omit'));
    assert.deepEqual(platform.draws.map(({sourceIndex})=>sourceIndex),[0,1,2,3,4]);
    assert.deepEqual(platform.created,platform.revoked);
    assert.equal(platform.created.length,5);
    return value;
  });
  assert.equal(prepared.imageUrls.length,5);
  assert.deepEqual(prepared.imageUrls.map(value=>Buffer.from(value.split(',')[1],'base64').toString()),[
    'processed:0:512x384','processed:1:256x512','processed:2:256x256','processed:3:500x500','processed:4:512x128',
  ]);
  assert.deepEqual(prepared.referenceTransforms,[
    { index:0,sourceWidth:1024,sourceHeight:768,width:512,height:384,resized:true },
    { index:1,sourceWidth:600,sourceHeight:1200,width:256,height:512,resized:true },
    { index:2,sourceWidth:256,sourceHeight:256,width:256,height:256,resized:false },
    { index:3,sourceWidth:500,sourceHeight:500,width:500,height:500,resized:false },
    { index:4,sourceWidth:4096,sourceHeight:1024,width:512,height:128,resized:true },
  ]);
});

test('model-matrix keeps the garment and person references in its two dedicated fields',async () => {
  const garment = 'https://image.test/garment'; const person = 'https://image.test/person';
  const prepared = await withImagePlatform({},async platform => {
    const value = await image.prepareCloudflareImageInput('model-matrix',{
      generationProvider:'openai',imageUrl:garment,modelReferenceImageUrl:person,
    });
    assert.deepEqual(platform.fetches,[garment,person]);
    assert.deepEqual(platform.draws.map(({sourceIndex})=>sourceIndex),[0,1]);
    assert.deepEqual(platform.created,platform.revoked);
    return value;
  });
  assert.equal(prepared.imageUrl.startsWith('data:image/png;base64,'),true);
  assert.equal(prepared.modelReferenceImageUrl.startsWith('data:image/png;base64,'),true);
  assert.equal(prepared.imageUrls,undefined);
  assert.deepEqual(prepared.referenceTransforms.map(({index})=>index),[0,1]);
});

test('OpenAI accepts sixteen processed references while seventeen, Workers AI five, and unknown-provider five reject before fetching',async () => {
  const sixteen = Array.from({ length:16 },(_,index)=>`https://image.test/openai-${index+1}`);
  await withImagePlatform({},async platform => {
    const prepared = await image.prepareCloudflareImageInput('edit-image',{ generationProvider:'openai',imageUrls:sixteen });
    assert.equal(prepared.imageUrls.length,16);
    assert.equal(prepared.referenceTransforms.length,16);
    assert.deepEqual(platform.fetches,sixteen);
    assert.deepEqual(platform.created,platform.revoked);
  });

  let fetchCount = 0;
  globalThis.fetch = async () => { fetchCount++; throw new Error('must reject before fetching'); };
  const seventeen = Array.from({ length:17 },(_,index)=>`https://image.test/openai-${index+1}`);
  const five = Array.from({ length:5 },(_,index)=>`https://image.test/reference-${index+1}`);
  await assert.rejects(image.prepareCloudflareImageInput('edit-image',{ generationProvider:'openai',imageUrls:seventeen }),/最大16枚/);
  await assert.rejects(image.prepareCloudflareImageInput('edit-image',{ generationProvider:'workers_ai',imageUrls:five }),/最大4枚/);
  await assert.rejects(image.prepareCloudflareImageInput('edit-image',{ generationProvider:'unrecognized-provider',imageUrls:five }),/最大4枚/);
  assert.equal(fetchCount,0);
});

test('failure on the fifth reference rejects the whole prepared body and revokes earlier object URLs',async () => {
  const urls = Array.from({ length:5 },(_,index)=>`https://image.test/reference-${index+1}`);
  let prepared;
  await withImagePlatform({ failFetchAt:4 },async platform => {
    await assert.rejects((async()=>{ prepared = await image.prepareCloudflareImageInput('edit-image',{ generationProvider:'openai',imageUrls:urls }); })(),/image_reference_fetch_failed:4:503/);
    assert.deepEqual(platform.fetches,urls);
    assert.equal(platform.created.length,4);
    assert.deepEqual(platform.revoked,platform.created);
  });
  assert.equal(prepared,undefined,'no partial prepared body is returned when any reference fails');
});

test('final save failure and module restart retain completed inference; only final caller acknowledgement clears it',async () => {
  const s = setup(); let failSave = true; let id; const saves = [];
  s.options.retainUntilAcknowledged = true;
  s.options.finalize = async value => {
    id = value.requestId; saves.push(id);
    if (failSave) throw new Error('final_save_response_lost');
    return { ...value,protectedRegionComposited:true };
  };
  await assert.rejects(image.invokeDurableImageAction(s.options),/final_save_response_lost/);
  assert.equal(s.store.size,1); assert.deepEqual(s.calls.map(c=>c.method),['POST']);
  vite.moduleGraph.invalidateAll(); image = await vite.ssrLoadModule(modulePath); failSave = false;
  const result = await image.invokeDurableImageAction(s.options);
  assert.equal(result.requestId,id); assert.equal(result.protectedRegionComposited,true);
  assert.deepEqual(s.calls.map(c=>c.method),['POST','GET']); assert.deepEqual(saves,[id,id]);
  assert.equal(s.store.size,1,'successful final R2 save is not yet the Canvas/history handoff');
  await assert.rejects(image.acknowledgeDurableImageAction({ ...s.options,userId:'bob',receipt:result }),/scope_invalid/);
  assert.equal(s.store.size,1);
  await image.acknowledgeDurableImageAction({ ...s.options,receipt:result });
  assert.equal(s.store.size,0);
});

test('session change during finalization prevents acknowledgement and retains the original request',async () => {
  const s = setup(); let current = true;
  s.options.assertCurrent = async () => { if (!current) throw new Error('session_changed'); };
  s.options.finalize = async value => { current = false; return value; };
  await assert.rejects(image.invokeDurableImageAction(s.options),/session_changed/);
  assert.equal(s.calls.length,1); assert.equal(s.store.size,1);
});

test('full input readback must finish before any model submission and failed cache writes retain the same UUID',async()=>{
  const s=setup();let failed=true,firstId;
  s.options.beforeSubmit=async(id,key)=>{firstId??=id;assert.equal(id,firstId);assert.equal(s.store.get(key),id);if(failed)throw new Error('snapshot_disk_full');};
  await assert.rejects(image.invokeDurableImageAction(s.options),/snapshot_disk_full/);assert.equal(s.calls.length,0);
  failed=false;s.options.call=async(path,init={})=>{s.calls.push(init.method??'GET');if(!init.method)throw new Error('cloudflare_api_404_image_request_not_found');assert.equal(new Headers(init.headers).get('idempotency-key'),firstId);return receipt(firstId);};
  await image.invokeDurableImageAction(s.options);assert.deepEqual(s.calls,['GET','POST']);
});

test('failed exact cache cleanup retains acknowledgement key, and session changes during input persistence prevent inference',async()=>{
  const s=setup();s.options.retainUntilAcknowledged=true;const result=await image.invokeDurableImageAction(s.options);
  await assert.rejects(image.acknowledgeDurableImageAction({...s.options,receipt:result,cleanup:async()=>{throw new Error('cache_delete_failed');}}),/cache_delete_failed/);
  assert.equal(s.store.size,1);
  const changed=setup();let current=true;changed.options.assertCurrent=async()=>{if(!current)throw new Error('session_changed');};
  changed.options.beforeSubmit=async()=>{current=false;};
  await assert.rejects(image.invokeDurableImageAction(changed.options),/session_changed/);assert.equal(changed.calls.length,0);
});
