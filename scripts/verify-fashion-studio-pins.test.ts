import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  changePin,
  readPins,
  writePins,
  type FashionStudioPinState,
  type PinStorageAccessor,
} from '../src/lib/fashionStudioPins.ts';

const key = (brand: string) => `heavy-fashion-studio-pins:${brand}`;
const storageFixture = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  const writes: Array<{ key: string; value: string }> = [];
  let reads = 0;
  const getStorage: PinStorageAccessor = () => ({
    getItem: (name) => { reads += 1; return data.get(name) ?? null; },
    setItem: (name, value) => { writes.push({ key: name, value }); data.set(name, value); },
  });
  return { data, writes, getStorage, readCount: () => reads };
};

// The same sequence as the page handler: commit memory first, then best-effort write.
const applyEvent = (
  state: FashionStudioPinState,
  eventBrand: string | null,
  currentBrand: string | null,
  id: string,
  pinned: boolean,
  getStorage: PinStorageAccessor,
) => {
  const change = changePin(state, eventBrand, currentBrand, id, pinned);
  const memory = change.state;
  const persisted = change.shouldPersist ? writePins(memory, getStorage) : false;
  return { memory, persisted, changed: change.changed };
};

test('normal read, user change, persistence and reload preserve the existing key and IDs', () => {
  const fixture = storageFixture({ [key('A')]: '["saved","encoded/%猫"]' });
  const initial = readPins('A', fixture.getStorage);
  assert.equal(initial.readStatus, 'success');
  assert.deepEqual([...initial.ids], ['saved', 'encoded/%猫']);
  assert.equal(fixture.writes.length, 0);
  const result = applyEvent(initial, 'A', 'A', 'new', true, fixture.getStorage);
  assert.equal(result.persisted, true);
  assert.deepEqual(fixture.writes, [{ key: key('A'), value: '["saved","encoded/%猫","new"]' }]);
  assert.deepEqual([...readPins('A', fixture.getStorage).ids], [...result.memory.ids]);
  const removed = applyEvent(result.memory, 'A', 'A', 'saved', false, fixture.getStorage);
  assert.deepEqual([...readPins('A', fixture.getStorage).ids], ['encoded/%猫', 'new']);
  assert.equal(removed.persisted, true);
});

test('missing data is a successful empty read, and absent brand does not access storage', () => {
  const fixture = storageFixture();
  const absent = readPins(null, fixture.getStorage);
  assert.equal(absent.readStatus, 'pending');
  assert.equal(fixture.readCount(), 0);
  const missing = readPins('A', fixture.getStorage);
  assert.equal(missing.readStatus, 'success');
  assert.equal(missing.ids.size, 0);
  assert.equal(fixture.writes.length, 0);
});

test('hydration, repeated reads and StrictMode-style repeated hydration write zero times', () => {
  const fixture = storageFixture({ [key('A')]: '["saved"]' });
  for (let render = 0; render < 4; render += 1) {
    const hydrated = readPins('A', fixture.getStorage);
    assert.deepEqual([...hydrated.ids], ['saved']);
  }
  assert.equal(fixture.readCount(), 4);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.data.get(key('A')), '["saved"]');
});

test('brand transition rejects old-state, stale-event and transient-empty writes', () => {
  const fixture = storageFixture({ [key('A')]: '["a"]', [key('B')]: '["b"]' });
  const a = readPins('A', fixture.getStorage);
  const beforeHydration = applyEvent(a, 'B', 'B', 'x', true, fixture.getStorage);
  assert.equal(beforeHydration.memory, a);
  const staleA = applyEvent(a, 'A', 'B', 'x', true, fixture.getStorage);
  assert.equal(staleA.memory, a);
  const b = readPins('B', fixture.getStorage);
  const staleAfterHydration = applyEvent(b, 'A', 'B', 'x', true, fixture.getStorage);
  assert.equal(staleAfterHydration.memory, b);
  const absentBrand = applyEvent(b, 'B', null, 'x', true, fixture.getStorage);
  assert.equal(absentBrand.memory, b);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.data.get(key('A')), '["a"]');
  assert.equal(fixture.data.get(key('B')), '["b"]');
  const validB = applyEvent(b, 'B', 'B', 'new-b', true, fixture.getStorage);
  assert.equal(validB.persisted, true);
  assert.deepEqual(fixture.writes, [{ key: key('B'), value: '["b","new-b"]' }]);
});

for (const name of ['QuotaExceededError', 'SecurityError']) {
  test(`${name} during a write is nonfatal and retains updated memory`, () => {
    let writes = 0;
    const getStorage: PinStorageAccessor = () => ({
      getItem: () => '["saved"]',
      setItem: () => { writes += 1; throw new DOMException('storage denied', name); },
    });
    const result = applyEvent(readPins('A', getStorage), 'A', 'A', 'new', true, getStorage);
    assert.equal(result.persisted, false);
    assert.deepEqual([...result.memory.ids], ['saved', 'new']);
    assert.equal(result.memory.readStatus, 'success');
    assert.equal(writes, 1);
  });
}

test('throwing storage getter is caught on both read and write', () => {
  const getStorage: PinStorageAccessor = () => { throw new DOMException('denied', 'SecurityError'); };
  const failed = readPins('A', getStorage);
  assert.equal(failed.readStatus, 'failure');
  const memoryOnly = applyEvent(failed, 'A', 'A', 'new', true, getStorage);
  assert.deepEqual([...memoryOnly.memory.ids], ['new']);
  assert.equal(memoryOnly.persisted, false);
  const good = readPins('A', storageFixture().getStorage);
  assert.equal(writePins(good, getStorage), false);
});

test('throwing getItem allows memory-only changes without calling setItem', () => {
  let writes = 0;
  const getStorage: PinStorageAccessor = () => ({
    getItem: () => { throw new DOMException('denied', 'SecurityError'); },
    setItem: () => { writes += 1; },
  });
  const failed = readPins('A', getStorage);
  const result = applyEvent(failed, 'A', 'A', 'new', true, getStorage);
  assert.equal(result.memory.readStatus, 'failure');
  assert.deepEqual([...result.memory.ids], ['new']);
  assert.equal(writePins(result.memory, getStorage), false);
  assert.equal(writes, 0);
});

test('malformed JSON and invalid schemas remain untouched after user changes', () => {
  for (const saved of ['', '{', 'null', '{}', '"id"', '["valid",42]', '[null]']) {
    const fixture = storageFixture({ [key('A')]: saved });
    const failed = readPins('A', fixture.getStorage);
    assert.equal(failed.readStatus, 'failure', saved);
    const result = applyEvent(failed, 'A', 'A', 'new', true, fixture.getStorage);
    assert.deepEqual([...result.memory.ids], ['new']);
    assert.equal(result.persisted, false);
    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.data.get(key('A')), saved);
  }
});

test('rapid changes use the latest memory set without losing earlier events', () => {
  const fixture = storageFixture();
  let current = readPins('A', fixture.getStorage);
  for (const [id, pinned] of [['first', true], ['second', true], ['first', false], ['third', true]] as const) {
    current = applyEvent(current, 'A', 'A', id, pinned, fixture.getStorage).memory;
  }
  assert.deepEqual([...current.ids], ['second', 'third']);
  assert.deepEqual([...readPins('A', fixture.getStorage).ids], ['second', 'third']);
  assert.equal(fixture.writes.length, 4);
});

test('unchanged events preserve state identity and write zero times', () => {
  const fixture = storageFixture({ [key('A')]: '["saved"]' });
  const current = readPins('A', fixture.getStorage);
  for (const [id, pinned] of [['saved', true], ['missing', false]] as const) {
    const result = applyEvent(current, 'A', 'A', id, pinned, fixture.getStorage);
    assert.equal(result.memory, current);
    assert.equal(result.changed, false);
  }
  assert.equal(fixture.writes.length, 0);
});

test('valid IDs are uncapped and not removed or truncated on persistence', () => {
  const ids = Array.from({ length: 10_000 }, (_, index) => `project:${index}/猫`);
  const fixture = storageFixture({ [key('A')]: JSON.stringify(ids) });
  const current = readPins('A', fixture.getStorage);
  assert.deepEqual([...current.ids], ids);
  const result = applyEvent(current, 'A', 'A', 'new', true, fixture.getStorage);
  assert.deepEqual([...readPins('A', fixture.getStorage).ids], [...ids, 'new']);
  assert.equal(result.memory.ids.size, 10_001);
});

test('page hydration only reads; event uses latest ref and commits before guarded persistence', () => {
  const page = readFileSync(new URL('../src/pages/FashionStudioPage.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /localStorage|pinsHydrated|setPinnedProjectIds/);
  assert.match(page, /pinState\.brandId === currentBrand\?\.id \? pinState\.ids/);
  const hydrateStart = page.indexOf('const hydrated = readPins(');
  assert.ok(hydrateStart > 0);
  const hydration = page.slice(page.lastIndexOf('useEffect(', hydrateStart), page.indexOf('const toggleProjectPin', hydrateStart));
  assert.match(hydration, /pinStateRef\.current = hydrated;\s*setPinState\(hydrated\)/);
  assert.doesNotMatch(hydration, /writePins/);
  const toggle = page.slice(page.indexOf('const toggleProjectPin'), page.indexOf('const findLocalStudioArtifact'));
  assert.match(toggle, /const current = pinStateRef\.current/);
  assert.match(toggle, /useAuthStore\.getState\(\)\.currentBrand\?\.id/);
  assert.match(toggle, /if \(!change\.changed\) return;\s*pinStateRef\.current = change\.state;\s*setPinState\(change\.state\);\s*if \(change\.shouldPersist\) writePins\(change\.state\)/);
  assert.equal((page.match(/writePins\(change\.state\)/g) ?? []).length, 1);
  assert.match(page, /onClick=\{\(\) => \{ toggleProjectPin\(project\.id\); setOpenProjectMenuId\(null\); \}\}/);
});
