import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { Brand } from '../src/types/database';
import { selectCurrentBrand } from '../src/lib/authBrandSelection.ts';

const brand = (id: string, name = id): Brand => ({
  id,
  owner_id: 'owner-1',
  name,
  logo_url: null,
  brand_colors: null,
  tone_description: null,
  target_audience: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

test('keeps the selected brand across a transient empty refresh', () => {
  const selected = brand('brand-1', 'NiSEN');
  assert.equal(selectCurrentBrand(selected, []), selected);
});

test('keeps the selected brand when it remains accessible', () => {
  const selected = brand('brand-1', 'NiSEN');
  assert.equal(selectCurrentBrand(selected, [brand('brand-2'), selected]), selected);
});

test('moves to the first accessible brand after a non-empty membership refresh', () => {
  const selected = brand('brand-1', 'Old');
  const next = brand('brand-2', 'New');
  assert.equal(selectCurrentBrand(selected, [next]), next);
});

test('returns null when no brand has ever been selected and none is accessible', () => {
  assert.equal(selectCurrentBrand(null, []), null);
});

test('BrandSwitcher uses the shared resilient selection boundary', async () => {
  const source = await readFile(new URL('../src/components/BrandSwitcher.tsx', import.meta.url), 'utf8');
  assert.match(source, /selectCurrentBrand\(latestCurrentBrand, brandsData\)/);
});
