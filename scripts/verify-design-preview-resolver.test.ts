import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDesignPreviewController,
  designPreviewScopeKey,
  resolveDesignPreview,
  type DesignPreviewRequest,
  type DesignPreviewState,
} from '../src/lib/designPreviewResolver.ts';

const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const request = (overrides: Partial<DesignPreviewRequest> = {}): DesignPreviewRequest => ({
  artifactId: 'local-a1d3a15d-4d27-4c93-ad1c-5fe04d438df6',
  userId: 'user-a',
  brandId: 'brand-a',
  imageUrl: '',
  canonicalStoragePath: 'generated-images/design-shirt',
  ...overrides,
});
const harness = (resolve: Parameters<typeof createDesignPreviewController>[0]) => {
  const states: DesignPreviewState[] = [];
  let liveScope = { userId: 'user-a', brandId: 'brand-a' };
  const controller = createDesignPreviewController(resolve, () => liveScope, (state) => states.push(state));
  return { controller, states, latest: () => states.at(-1)!, setLiveScope: (next: typeof liveScope) => { liveScope = next; } };
};

test('existing image URLs bypass signing, and stripped URLs resolve once from canonical storage', async () => {
  let calls = 0;
  const resolver = async (source: string) => { calls += 1; return { ok: true, url: `https://signed.example/${source}` }; };

  assert.deepEqual(await resolveDesignPreview({ imageUrl: '  https://already.example/image.png  ', canonicalStoragePath: 'ignored/path' }, resolver), {
    status: 'ready', url: 'https://already.example/image.png',
  });
  assert.equal(calls, 0);
  assert.deepEqual(await resolveDesignPreview({ imageUrl: '', canonicalStoragePath: 'canonical/design.png' }, resolver), {
    status: 'ready', url: 'https://signed.example/canonical/design.png',
  });
  assert.equal(calls, 1);
  assert.deepEqual(await resolveDesignPreview({ imageUrl: '', canonicalStoragePath: null }, resolver), { status: 'none' });
  assert.equal(calls, 1);
});

test('failed and rejected preview signing fail closed without a fake or stale URL', async () => {
  assert.deepEqual(await resolveDesignPreview({ imageUrl: '', canonicalStoragePath: 'canonical/path' }, async () => ({ ok: false })), { status: 'failed' });
  assert.deepEqual(await resolveDesignPreview({ imageUrl: '', canonicalStoragePath: 'canonical/path' }, async () => { throw new Error('signing unavailable'); }), { status: 'failed' });
});

test('live logout, user switch, and brand switch during the actual resolver await discard stale completion', async () => {
  for (const nextScope of [
    { userId: null, brandId: 'brand-a' },
    { userId: 'user-b', brandId: 'brand-a' },
    { userId: 'user-a', brandId: 'brand-b' },
  ]) {
    const enteredResolver = deferred<void>();
    const pendingSignature = deferred<{ ok: true; url: string }>();
    const view = harness(async () => {
      enteredResolver.resolve();
      return pendingSignature.promise;
    });
    const completion = view.controller.reset(request());
    await enteredResolver.promise;
    assert.equal(view.latest().status, 'loading', 'test invalidates while signing is still pending');
    view.setLiveScope(nextScope);
    pendingSignature.resolve({ ok: true, url: 'https://signed.example/stale.png' });
    await completion;
    assert.equal(view.latest().status, 'loading');
    assert.equal(view.latest().url, null);
    view.controller.dispose();
  }
});

test('a scope already stale before resolver start does not request a signed URL', async () => {
  let calls = 0;
  const view = harness(async () => { calls += 1; return { ok: true, url: 'https://signed.example/stale.png' }; });
  view.setLiveScope({ userId: null, brandId: 'brand-b' });
  await view.controller.reset(request());
  assert.equal(calls, 0);
  assert.equal(view.latest().status, 'loading', 'stale scope has no ready URL and is immediately hidden by the component scope key');
  assert.equal(view.latest().url, null);
  view.controller.dispose();
});

test('retry is read-only, resolves again, and an older retry cannot overwrite the newest result', async () => {
  const firstEntered = deferred<void>();
  const secondEntered = deferred<void>();
  const firstSignature = deferred<{ ok: true; url: string }>();
  const secondSignature = deferred<{ ok: true; url: string }>();
  let calls = 0;
  const view = harness(async () => {
    calls += 1;
    if (calls === 1) { firstEntered.resolve(); return firstSignature.promise; }
    secondEntered.resolve(); return secondSignature.promise;
  });

  const firstAttempt = view.controller.reset(request());
  await firstEntered.promise;
  const retryAttempt = view.controller.retry();
  await secondEntered.promise;
  secondSignature.resolve({ ok: true, url: 'https://signed.example/current.png' });
  await retryAttempt;
  const current = view.latest();
  firstSignature.resolve({ ok: true, url: 'https://signed.example/old.png' });
  await firstAttempt;

  assert.equal(calls, 2);
  assert.equal(view.latest(), current);
  assert.equal(view.latest().status, 'ready');
  assert.equal(view.latest().url, 'https://signed.example/current.png');
  assert.equal(view.states.some((state) => state.url === 'https://signed.example/old.png'), false);
  view.controller.dispose();
});

test('a broken img URL becomes preview-only failure and retry resolves a fresh URL', async () => {
  let calls = 0;
  const view = harness(async () => {
    calls += 1;
    return { ok: true, url: `https://signed.example/attempt-${calls}.png` };
  });
  await view.controller.reset(request());
  const signed = view.latest();
  assert.equal(signed.status, 'ready');
  assert.equal(view.controller.onImageError(signed.requestToken), true);
  assert.equal(view.latest().status, 'failed');
  assert.equal(view.latest().url, null);
  assert.equal(view.controller.onImageError(signed.requestToken), false, 'stale image events cannot alter failure/retry state');
  await view.controller.retry();
  assert.equal(calls, 2);
  assert.equal(view.latest().status, 'ready');
  assert.equal(view.latest().url, 'https://signed.example/attempt-2.png');
  view.controller.dispose();
});

test('unmount and missing scope/path cannot publish a late URL or call the resolver', async () => {
  const enteredResolver = deferred<void>();
  const pending = deferred<{ ok: true; url: string }>();
  const view = harness(async () => { enteredResolver.resolve(); return pending.promise; });
  const completion = view.controller.reset(request());
  await enteredResolver.promise;
  const published = view.states.length;
  view.controller.dispose();
  pending.resolve({ ok: true, url: 'https://signed.example/late.png' });
  await completion;
  assert.equal(view.states.length, published);

  let calls = 0;
  const noScope = harness(async () => { calls += 1; return { ok: true, url: 'https://should-not-sign' }; });
  noScope.setLiveScope({ userId: null, brandId: 'brand-a' });
  await noScope.controller.reset(request({ userId: null }));
  assert.equal(noScope.latest().status, 'none');
  assert.equal(calls, 0);
  const noPath = harness(async () => { calls += 1; return { ok: true, url: 'https://should-not-sign' }; });
  await noPath.controller.reset(request({ canonicalStoragePath: null }));
  assert.equal(noPath.latest().status, 'none');
  assert.equal(calls, 0);
  noScope.controller.dispose();
  noPath.controller.dispose();
});

test('scope keys include artifact content so rendering immediately hides a prior preview', () => {
  const first = designPreviewScopeKey(request());
  assert.notEqual(first, designPreviewScopeKey(request({ brandId: 'brand-b' })));
  assert.notEqual(first, designPreviewScopeKey(request({ userId: null })));
  assert.notEqual(first, designPreviewScopeKey(request({ canonicalStoragePath: 'other/path' })));
  assert.notEqual(first, designPreviewScopeKey(request({ artifactId: 'other-artifact' })));
});
