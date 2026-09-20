import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeAccessibleBrands } from '../src/lib/accessibleBrands.ts';

const brand = (id: string, created_at: string) => ({ id, created_at } as any);

test('keeps owner brands when membership lookup is unavailable', () => {
  const owned = [brand('nisen', '2026-08-21T12:00:00.000Z')];
  assert.deepEqual(mergeAccessibleBrands(owned), owned);
});

test('merges owner and joined-member brands without duplicates', () => {
  const owned = [brand('nisen', '2026-08-20T12:00:00.000Z')];
  const member = [brand('team', '2026-08-21T12:00:00.000Z'), brand('nisen', '2026-08-19T12:00:00.000Z')];
  assert.deepEqual(mergeAccessibleBrands(owned, member).map((item) => item.id), ['team', 'nisen']);
});

test('does not invent access when both proven sets are empty', () => {
  assert.deepEqual(mergeAccessibleBrands(), []);
});
