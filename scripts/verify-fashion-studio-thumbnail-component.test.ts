import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createFashionStudioThumbnailController,
  extractFashionStudioThumbnailCandidates,
  type FashionStudioThumbnailResolver,
  type FashionStudioThumbnailState,
} from '../src/lib/fashionStudioThumbnails.ts';

const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const harness = (resolver: FashionStudioThumbnailResolver) => {
  const states: FashionStudioThumbnailState[] = [];
  const controller = createFashionStudioThumbnailController(resolver, (state) => states.push(state));
  return { controller, states, latest: () => states.at(-1)! };
};

test('async controller integration advances rejected resolution and broken img to later loaded candidate', async () => {
  const calls: string[] = [];
  const view = harness(async (source) => {
    calls.push(source);
    if (source === 'canonical/rejected.png') return { ok: false };
    if (source === 'https://throws') throw new Error('resolver rejected');
    return { ok: true, url: source };
  });
  const candidates = extractFashionStudioThumbnailCandidates({ objects: [
    { type: 'image', metadata: { storagePath: 'canonical/rejected.png' }, src: 'https://throws' },
    { type: 'image', src: 'https://broken' },
    { type: 'image', src: 'https://good' },
  ] });
  view.controller.reset('A', 'project', candidates);
  await flush();
  assert.deepEqual(calls, ['canonical/rejected.png', 'https://throws', 'https://broken']);
  assert.equal(view.latest().status, 'loading', 'resolved URL is not proof that img loaded');
  const broken = view.latest();
  view.controller.onError(broken);
  await flush();
  assert.equal(view.latest().url, 'https://good');
  view.controller.onLoad(view.latest());
  assert.equal(view.latest().status, 'loaded');
  const count = view.states.length;
  view.controller.onError(broken);
  view.controller.onLoad(broken);
  view.controller.onError(view.latest());
  await flush();
  assert.equal(view.states.length, count, 'loaded success remains stable');
  assert.equal(calls.length, 4);
});

test('all-failed candidates terminate at PROJECT failure without looping or claiming recovery', async () => {
  const calls: string[] = [];
  const view = harness(async (source) => { calls.push(source); return { ok: true, url: source }; });
  view.controller.reset('A', 'p', ['https://bad1', 'https://bad2']);
  await flush();
  const first = view.latest();
  view.controller.onError(first);
  view.controller.onError(first);
  await flush();
  const second = view.latest();
  view.controller.onError(second);
  await flush();
  assert.equal(view.latest().status, 'failure');
  assert.equal(view.latest().url, null);
  view.controller.onError(second);
  view.controller.onLoad(second);
  await flush();
  assert.deepEqual(calls, ['https://bad1', 'https://bad2']);
  const empty = harness(async () => { throw new Error('must not resolve'); });
  empty.controller.reset('A', 'empty', []);
  assert.equal(empty.latest().status, 'failure');
});

test('different candidate references resolving to the same attempted URL are skipped', async () => {
  const calls: string[] = [];
  const view = harness(async (source) => {
    calls.push(source);
    return { ok: true, url: source === 'later' ? 'https://later' : 'https://duplicate' };
  });
  view.controller.reset('A', 'p', ['canonical/path', 'signed-url', 'signed-url', 'later']);
  await flush();
  view.controller.onError(view.latest());
  await flush();
  assert.equal(view.latest().url, 'https://later');
  assert.deepEqual(calls, ['canonical/path', 'signed-url', 'signed-url', 'later']);
  assert.equal(view.states.filter((state) => state.status === 'loading' && state.url === 'https://duplicate').length, 1);
});

test('brand/project/content resets ignore late asynchronous completions', async () => {
  for (const [brand, project, sources] of [
    ['B', 'p', ['new']], ['A', 'q', ['new']], ['A', 'p', ['changed']],
  ] as const) {
    const old = deferred<{ ok: true; url: string }>();
    const view = harness((source) => source === 'old' ? old.promise : Promise.resolve({ ok: true, url: `https://${source}` }));
    view.controller.reset('A', 'p', ['old']);
    view.controller.reset(brand, project, sources);
    await flush();
    const current = view.latest();
    old.resolve({ ok: true, url: 'https://old' });
    await flush();
    assert.equal(view.latest(), current);
    assert.equal(view.latest().url, `https://${sources[0]}`);
  }
});

test('late image events from another scope or attempt cannot affect the current candidate', async () => {
  const view = harness(async (source) => ({ ok: true, url: source }));
  view.controller.reset('A', 'p', ['old']);
  await flush();
  const old = view.latest();
  view.controller.reset('B', 'q', ['first', 'second']);
  await flush();
  const first = view.latest();
  for (const event of [old, { ...first, candidate: 'wrong' }, { ...first, attempt: first.attempt - 1 }, { ...first, url: 'wrong' }]) {
    view.controller.onLoad(event);
    view.controller.onError(event);
  }
  assert.equal(view.latest(), first);
  view.controller.onError(first);
  await flush();
  const second = view.latest();
  view.controller.onLoad(first);
  view.controller.onError(first);
  assert.equal(view.latest(), second);
  assert.equal(second.url, 'second');
});

test('unmount ignores pending resolution and later image events', async () => {
  const pending = deferred<{ ok: true; url: string }>();
  const view = harness(() => pending.promise);
  view.controller.reset('A', 'p', ['source']);
  const count = view.states.length;
  view.controller.dispose();
  pending.resolve({ ok: true, url: 'https://late' });
  await flush();
  view.controller.onLoad(view.latest());
  view.controller.onError(view.latest());
  view.controller.reset('B', 'q', ['other']);
  assert.equal(view.states.length, count);
});

test('an effect remount cannot accept an image event from the disposed controller with identical candidates', async () => {
  const old = harness(async (source) => ({ ok: true, url: source }));
  old.controller.reset('A', 'p', ['same']);
  await flush();
  const oldEvent = old.latest();
  old.controller.dispose();
  const current = harness(async (source) => ({ ok: true, url: source }));
  current.controller.reset('A', 'p', ['same']);
  await flush();
  assert.notEqual(current.latest().attempt, oldEvent.attempt);
  const before = current.latest();
  current.controller.onLoad(oldEvent);
  current.controller.onError(oldEvent);
  assert.equal(current.latest(), before);
  assert.equal(current.controller.onLoad(before), true);
});

test('page component connects keyed image events, content reset and disposal to the tested controller', () => {
  const page = readFileSync(new URL('../src/pages/FashionStudioPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /createFashionStudioThumbnailController\(resolveGeneratedImageUrlWithStatus, setThumbnail\)/);
  assert.match(page, /controller\.reset\(brand, project, sources\)/);
  assert.match(page, /controller\.dispose\(\)/);
  assert.match(page, /\}, \[scopeKey\]\)/);
  assert.match(page, /thumbnail\.scopeKey !== scopeKey/);
  assert.match(page, /key=\{`\$\{thumbnail\.scopeKey\}:\$\{thumbnail\.attempt\}`\}/);
  assert.match(page, /if \(controllerRef\.current\?\.onLoad\(thumbnail\)\) onLoaded\(thumbnail\.url!\)/);
  assert.match(page, /onError=\{\(\) => controllerRef\.current\?\.onError\(thumbnail\)\}/);
  assert.match(page, /extractFashionStudioThumbnailCandidates\(document\.snapshot\)/);
  assert.doesNotMatch(page, /extractCanvasPreviewSource/);
  assert.match(page, /remoteProjectScope\.brandId === currentBrand\?\.id \? remoteProjectScope\.projects : \[\]/);
});
