import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createDesignDialogueReferenceController,
  createSameOriginDesignSceneAssetLoader,
  type DesignDialogueReferenceClient,
  type DesignDialogueReferenceFile,
  type DesignDialogueReferenceScope,
  type DesignDialogueReferenceStorage,
} from '../src/lib/designDialogueReferences.ts';

const IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000006',
  '00000000-0000-4000-8000-000000000007',
  '00000000-0000-4000-8000-000000000008',
  '00000000-0000-4000-8000-000000000009',
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000013',
  '00000000-0000-4000-8000-000000000014',
  '00000000-0000-4000-8000-000000000015',
  '00000000-0000-4000-8000-000000000016',
  '00000000-0000-4000-8000-000000000017',
  '00000000-0000-4000-8000-000000000018',
];
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const JPEG_BYTES = new Uint8Array([255, 216, 255, 1]);
const AVIF_BYTES = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 97, 118, 105, 102, 0, 0, 0, 0]);
const scope = (): DesignDialogueReferenceScope => ({ userId: 'alice', brandId: 'brand-a', selectionId: 'dialogue-1', generation: 1 });
const makeFile = (bytes = JPEG_BYTES, name = 'reference.jpg', type = 'image/jpeg'): DesignDialogueReferenceFile => (
  Object.assign(new Blob([bytes], { type }), { name })
);
const receipt = (requestId: string) => ({
  success: true,
  remote: { jobId: `wa-${requestId}`, imageId: `wa-${requestId}`, storagePath: `generated-images/wa-${requestId}` },
});

class MemoryStorage implements DesignDialogueReferenceStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function setup(options: {
  ids?: string[];
  storage?: MemoryStorage;
  loadSceneAsset?: (key: string, context: { assertCurrent(): void }) => Promise<Blob>;
  materializeAvifToPng?: (blob: Blob) => Promise<Blob>;
  save?: (input: Record<string, unknown>, context: { assertCurrent(): Promise<void> }) => Promise<ReturnType<typeof receipt>>;
  read?: (requestId: string, context: { assertCurrent(): Promise<void> }) => Promise<ReturnType<typeof receipt>>;
} = {}) {
  let liveScope: DesignDialogueReferenceScope | null = scope();
  const ids = [...(options.ids ?? IDS)];
  const storage = options.storage ?? new MemoryStorage();
  const saves: Array<Record<string, unknown>> = [];
  const reads: string[] = [];
  const published: Array<unknown> = [];
  const serverReceipts = new Map<string, ReturnType<typeof receipt>>();
  const client: DesignDialogueReferenceClient = {
    async captureArtifactPersistenceContext({ assertContext } = {}) {
      const assertCurrent = async () => { await assertContext?.(); };
      await assertCurrent();
      return Object.freeze({ assertCurrent });
    },
    async saveWorkspaceArtifact(input, _checked, context) {
      await context?.assertCurrent();
      saves.push(input as unknown as Record<string, unknown>);
      if (options.save) return options.save(input as unknown as Record<string, unknown>, context!);
      const value = receipt(input.requestId);
      serverReceipts.set(input.requestId, value);
      return value;
    },
    async readWorkspaceArtifact(requestId, _checked, _expectedPath, context) {
      await context?.assertCurrent();
      reads.push(requestId);
      if (options.read) return options.read(requestId, context!);
      const value = serverReceipts.get(requestId);
      if (!value) throw new Error('cloudflare_api_404_workspace_artifact_not_found');
      return value;
    },
  };
  const controller = createDesignDialogueReferenceController({
    client,
    storage,
    getCurrentScope: () => liveScope,
    loadSceneAsset: options.loadSceneAsset,
    materializeAvifToPng: options.materializeAvifToPng,
    encodeImage: async (blob, mime) => `data:${mime};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`,
    requestId: () => ids.shift() ?? 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    publish: (state) => { published.push(state); },
  });
  return {
    controller,
    storage,
    saves,
    reads,
    published,
    serverReceipts,
    setScope(value: DesignDialogueReferenceScope | null) { liveScope = value; },
    activate() { return controller.activate(scope()); },
  };
}

test('actual controller persists only opaque pending identity, preserves order, reindexes deletion, and caps at 16', async () => {
  const fixture = setup();
  fixture.activate();
  await fixture.controller.addFile(makeFile(JPEG_BYTES, 'first.jpg'));
  await fixture.controller.addFile(makeFile(PNG_BYTES, '二番.png', 'image/png'));
  await fixture.controller.addFile(makeFile(JPEG_BYTES, 'third.jpg'));

  const before = fixture.controller.snapshot().references;
  fixture.controller.move(before[2].id, 0);
  fixture.controller.remove(before[1].id);
  const manifest = fixture.controller.prepareForSend();
  assert.deepEqual(manifest.map((item) => [item.order, item.name]), [[0, 'third.jpg'], [1, 'first.jpg']]);
  assert(manifest.every((item) => item.imageId === `wa-${item.imageId.slice(3)}`));
  assert.equal(fixture.saves.length, 3);
  const serialized = [...fixture.storage.values.values()].join('\n');
  assert.doesNotMatch(serialized, /(?:data:image\/|blob:|https?:\/\/|Bearer\s|access_token)/i);
  assert.doesNotMatch(serialized, /二番\.png/, 'deleted items are removed from the persisted selection');

  const many = setup();
  many.activate();
  for (let index = 0; index < 16; index++) await many.controller.addFile(makeFile(JPEG_BYTES, `ref-${index}.jpg`));
  assert.equal(many.controller.snapshot().references.length, 16);
  await assert.rejects(many.controller.addFile(makeFile()), /design_dialogue_reference_limit_reached/);
});

test('over-20-MiB upload input is rejected before it is persisted or sent', async () => {
  const fixture = setup();
  fixture.activate();
  const oversized = Object.assign({
    size: 20 * 1024 * 1024 + 1,
    type: 'image/png',
    slice: () => new Blob([PNG_BYTES]),
    arrayBuffer: async () => new ArrayBuffer(0),
  }, { name: 'too-large.png' }) as unknown as DesignDialogueReferenceFile;
  await assert.rejects(fixture.controller.addFile(oversized), /workspace_image_too_large/);
  assert.equal(fixture.saves.length, 0);
  assert.equal(fixture.storage.values.size, 0);
});

test('unknown POST effect recovers the exact UUID by GET and never issues a second save', async () => {
  const id = IDS[0];
  const storage = new MemoryStorage();
  const fixture = setup({ storage, save: async (input) => {
    assert([...storage.values.values()].some((serialized) => serialized.includes(String(input.requestId))), 'pending UUID must be persisted before save');
    fixture.serverReceipts.set(String(input.requestId), receipt(String(input.requestId)));
    throw new TypeError('post_response_lost');
  } });
  fixture.activate();
  await assert.rejects(fixture.controller.addFile(makeFile()), /post_response_lost/);
  const pendingId = fixture.controller.snapshot().references[0].requestId;
  assert.equal(pendingId, id);
  const recovered = await fixture.controller.retry(pendingId, makeFile());
  assert.equal(recovered.references[0].status, 'ready');
  assert.deepEqual(fixture.reads, [id]);
  assert.equal(fixture.saves.length, 1);
  assert.equal(fixture.controller.prepareForSend()[0].imageId, `wa-${id}`);

  const reloaded = setup({ storage, ids: [IDS[1]], read: async (requestId) => receipt(requestId) });
  reloaded.activate();
  await reloaded.controller.restore();
  assert.equal(reloaded.controller.snapshot().ready, true);
  assert.equal(reloaded.controller.prepareForSend()[0].imageId, `wa-${id}`);
});

test('retry keeps the same pending UUID, blocks partial send, and AVIF is materialized to PNG', async () => {
  let outage = true;
  const fixture = setup({ save: async (input) => {
    if (outage) throw new Error('write_outcome_unknown');
    return receipt(String(input.requestId));
  } });
  fixture.activate();
  await fixture.controller.addFile(makeFile()).catch(() => undefined);
  const referenceId = fixture.controller.snapshot().references[0].id;
  assert.throws(() => fixture.controller.prepareForSend(), /design_dialogue_references_incomplete/);
  const persistedId = fixture.controller.snapshot().references[0].requestId;
  outage = false;
  await fixture.controller.retry(referenceId, makeFile());
  assert.equal(fixture.controller.snapshot().references[0].requestId, persistedId);
  assert.equal(fixture.saves.length, 2);

  let encodedMime: string | undefined;
  const avifController = createDesignDialogueReferenceController({
    client: {
      async captureArtifactPersistenceContext({ assertContext } = {}) { return { assertCurrent: async () => { await assertContext?.(); } }; },
      async saveWorkspaceArtifact(input) { return receipt(input.requestId); },
      async readWorkspaceArtifact(requestId) { return receipt(requestId); },
    },
    storage: new MemoryStorage(),
    getCurrentScope: () => scope(),
    materializeAvifToPng: async () => new Blob([PNG_BYTES], { type: 'image/png' }),
    encodeImage: async (_blob, mime) => { encodedMime = mime; return `data:${mime};base64,AA==`; },
    requestId: () => IDS[5],
  });
  avifController.activate(scope());
  await avifController.addFile(makeFile(AVIF_BYTES, 'photo.avif', 'image/avif'));
  assert.equal(encodedMime, 'image/png');
  assert.equal(avifController.prepareForSend()[0].imageId, `wa-${IDS[5]}`);
  avifController.dispose();
});

test('same-origin scene loader accepts only bundled names, checks response type and byte bound, and fences awaits', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/scene-assets/manifest.json', import.meta.url), 'utf8')) as {
    assets: Array<{ name: string; contentType: string }>;
  };
  const requests: Array<{ path: string; init: RequestInit }> = [];
  let checks = 0;
  const loader = createSameOriginDesignSceneAssetLoader(async (path, init) => {
    requests.push({ path: String(path), init: init ?? {} });
    const name = String(path).split('/').at(-1)!;
    const contentType = manifest.assets.find((asset) => asset.name === name)?.contentType;
    const bytes = contentType === 'image/jpeg' ? JPEG_BYTES : PNG_BYTES;
    return new Response(bytes, { status: 200, headers: { 'content-type': contentType ?? 'image/png' } });
  });
  for (const asset of manifest.assets) {
    const blob = await loader(asset.name, { assertCurrent() { checks++; } });
    assert.equal(blob.size, asset.contentType === 'image/jpeg' ? JPEG_BYTES.byteLength : PNG_BYTES.byteLength);
    assert.equal(requests.at(-1)?.path, `/scene-assets/${encodeURIComponent(asset.name)}`);
  }
  assert.equal(requests.length, manifest.assets.length);
  assert.equal(requests[0].init.mode, 'same-origin');
  assert.equal(requests[0].init.credentials, 'omit');
  assert.equal(requests[0].init.redirect, 'error');
  assert(checks >= manifest.assets.length * 3, 'scope is checked before/after fetch and while reading the body');
  await assert.rejects(loader('../package.json', { assertCurrent() {} }), /design_dialogue_scene_asset_key_invalid/);
  await assert.rejects(loader('https://attacker.invalid/a.png', { assertCurrent() {} }), /design_dialogue_scene_asset_key_invalid/);
  assert.equal(requests.length, manifest.assets.length, 'invalid keys never reach fetch');

  const oversizedLoader = createSameOriginDesignSceneAssetLoader(async () => new Response(null, {
    status: 200,
    headers: { 'content-type': 'image/png', 'content-length': String(20 * 1024 * 1024 + 1) },
  }));
  await assert.rejects(oversizedLoader('fabric5.png', { assertCurrent() {} }), /workspace_image_too_large/);
  const streamedOversizedLoader = createSameOriginDesignSceneAssetLoader(async () => new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(new Uint8Array(20 * 1024 * 1024 + 1));
      stream.close();
    },
  }), { status: 200, headers: { 'content-type': 'image/png', 'content-length': '1' } }));
  await assert.rejects(streamedOversizedLoader('fabric5.png', { assertCurrent() {} }), /workspace_image_too_large/);
  const wrongMimeLoader = createSameOriginDesignSceneAssetLoader(async () => new Response(PNG_BYTES, {
    status: 200, headers: { 'content-type': 'text/html' },
  }));
  await assert.rejects(wrongMimeLoader('fabric5.png', { assertCurrent() {} }), /design_dialogue_scene_asset_content_type_invalid/);
});

test('scene identities dedupe across selections only inside the same user and brand scope', async () => {
  const storage = new MemoryStorage();
  const fixture = setup({
    storage,
    loadSceneAsset: async (key, context) => {
      context.assertCurrent();
      assert.equal(key, 'fabric1.jpg');
      return new Blob([JPEG_BYTES], { type: 'image/jpeg' });
    },
  });
  fixture.activate();
  await fixture.controller.addSceneAsset('fabric1.jpg', 'Fabric 1');
  const firstId = fixture.controller.prepareForSend()[0].imageId;
  await fixture.controller.addSceneAsset('fabric1.jpg', 'Fabric 1');
  assert.equal(fixture.saves.length, 1, 'duplicate in one selection is ignored');

  const nextSelection = { ...scope(), selectionId: 'dialogue-2', generation: 2 };
  fixture.setScope(nextSelection);
  fixture.controller.activate(nextSelection);
  await fixture.controller.addSceneAsset('fabric1.jpg', 'Fabric 1');
  assert.equal(fixture.controller.prepareForSend()[0].imageId, firstId);
  assert.equal(fixture.saves.length, 1, 'same scoped scene reuses its exact persisted UUID by readback');
  assert.equal(fixture.reads.at(-1), firstId.slice(3));

  const otherBrand = { ...nextSelection, brandId: 'brand-b', selectionId: 'dialogue-3', generation: 3 };
  fixture.setScope(otherBrand);
  fixture.controller.activate(otherBrand);
  await fixture.controller.addSceneAsset('fabric1.jpg', 'Fabric 1');
  assert.notEqual(fixture.controller.prepareForSend()[0].imageId, firstId);
  assert.equal(fixture.saves.length, 2, 'another brand gets an independent canonical request');
  const indexes = [...storage.values.entries()].filter(([key]) => key.includes('scene-assets:'));
  assert.equal(indexes.length, 2);
  assert(indexes.every(([, value]) => !/(?:data:|blob:|https?:\/\/)/i.test(value)));
});

test('a fifth scene-source failure prevents every partial send and retries the same request', async () => {
  let fifthUnavailable = true;
  const fixture = setup({ loadSceneAsset: async (key, context) => {
    context.assertCurrent();
    if (key === 'fabric5.png' && fifthUnavailable) throw new Error('scene_source_unavailable');
    return new Blob([key.endsWith('.jpg') ? JPEG_BYTES : PNG_BYTES], { type: key.endsWith('.jpg') ? 'image/jpeg' : 'image/png' });
  } });
  fixture.activate();
  for (const key of ['fabric1.jpg', 'fabric2.jpg', 'fabric3.jpg', 'fabric4.jpg']) {
    await fixture.controller.addSceneAsset(key, key);
  }
  await assert.rejects(fixture.controller.addSceneAsset('fabric5.png', 'fabric5.png'), /scene_source_unavailable/);
  const failedFifth = fixture.controller.snapshot().references[4];
  const requestId = failedFifth.requestId;
  assert.equal(failedFifth.status, 'failure');
  assert.throws(() => fixture.controller.prepareForSend(), /design_dialogue_references_incomplete/);
  fifthUnavailable = false;
  await fixture.controller.retry(failedFifth.id);
  const manifest = fixture.controller.prepareForSend();
  assert.equal(manifest.length, 5);
  assert.deepEqual(manifest.map((item) => item.order), [0, 1, 2, 3, 4]);
  assert.equal(manifest[4].imageId, `wa-${requestId}`);
  assert.equal(fixture.saves.length, 5);
});

test('persisted malformed manifests are surfaced, and stale scopes cannot publish a receipt', async () => {
  const fixture = setup();
  fixture.activate();
  await fixture.controller.addFile(makeFile());
  const key = [...fixture.storage.values.keys()][0];
  fixture.storage.values.set(key, JSON.stringify({ version: 1, scope: { ...scope() }, references: [], injected: 'https://bad.invalid/x' }));
  const reloaded = setup({ storage: fixture.storage });
  assert.throws(() => reloaded.activate(), /design_dialogue_reference_pending_state_unsafe/);

  let completeSave!: () => void;
  const stale = setup({ save: async () => new Promise<ReturnType<typeof receipt>>((resolve) => { completeSave = () => resolve(receipt(IDS[0])); }) });
  stale.activate();
  const add = stale.controller.addFile(makeFile()).catch((error) => error);
  await new Promise((resolve) => setImmediate(resolve));
  const publishCountBeforeScopeSwitch = stale.published.length;
  stale.setScope({ ...scope(), userId: 'bob' });
  completeSave();
  const result = await add;
  assert.match(String(result), /design_dialogue_reference_scope_stale/);
  assert.equal(stale.published.length, publishCountBeforeScopeSwitch, 'stale async completion does not publish into the changed scope');
  assert.throws(() => stale.controller.prepareForSend(), /design_dialogue_reference_scope_stale/);
});
