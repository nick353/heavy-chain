import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const modulePath = '/src/lib/cloudflareImageAI.ts';
let image = await vite.ssrLoadModule(modulePath);
const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;
after(async () => { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; await vite.close(); });
function setup() {
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key,value) => store.set(key,value), removeItem: key => store.delete(key) };
  const calls = [];
  const options = { origin: 'https://heavy.test', userId: 'alice', action: 'generate-image',
    body: { brandId: 'brand', prompt: crypto.randomUUID(), legalSafety: { rightsConfirmed: true } },
    assertCurrent: async () => {}, call: async (path,init = {}) => {
      const id = init.method === 'POST' ? new Headers(init.headers).get('idempotency-key') : path.split('/').at(-1);
      calls.push({ path,method: init.method ?? 'GET',id }); return receipt(id);
    } };
  return { store,calls,options };
}
function receipt(id,state = 'completed') {
  return { success: state === 'completed',requestId: id,state,recovery: state === 'unknown' ? 'reconcile_only_no_reinference' : 'terminal',
    persistenceStatus: state === 'completed' ? 'completed' : 'failed',
    images: state === 'completed' ? [{ imageId: 'ai-'+id+'-0',storagePath: 'generated-images/ai-'+id+'-0',imageUrl: 'https://heavy.test/private?token=fixture' }] : [] };
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
  const s = setup(); globalThis.localStorage.setItem = () => { throw new Error('full'); };
  await assert.rejects(image.invokeDurableImageAction(s.options),/推論は開始していません/); assert.equal(s.calls.length,0);
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
    ['generate-image',{ prompt:'' }],['generate-image',{ brief:'   ' }],['edit-image',{ prompt:'edit' }],['model-matrix',{ productDescription:'try-on' }]]) {
    await assert.rejects(image.prepareCloudflareImageInput(action,body));
  }
  assert.equal(calls,0);
  for (const input of [{ brandId:'brand',prompt:'shirt' },{ brandId:'brand',brief:'shirt brief' }]) {
    assert.deepEqual(await image.prepareCloudflareImageInput('generate-image',input),{...input,referenceTransforms:[],imageUrls:[]});
  }
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
