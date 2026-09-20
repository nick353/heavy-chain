import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pageSource = await readFile(new URL('../src/pages/VideoProjectDashboardPage.tsx', import.meta.url), 'utf8');

test('video dashboard keeps Light source image crop semantics', () => {
  const imageTags = [...pageSource.matchAll(/<img\s+src=\{project\.imageUrl\}[^>]+>/gu)].map((match) => match[0]);
  assert.equal(imageTags.length, 2, 'recent and reference image branches must remain explicit');
  for (const tag of imageTags) {
    assert.match(tag, /className="object-cover"/u);
    assert.doesNotMatch(tag, /h-full|w-full/u, 'source uses natural image geometry clipped by the card shell');
  }
});

test('video dashboard retains the source fixture URLs and no visible rights checkbox', () => {
  for (const marker of [
    '548083b211dccf02c2b0335279d15216',
    'b9e909c9d8444f93918a34724c255adb',
    '509cc48a248ff6fbcc0492b57f6aac68',
    '1e4238ea72d473c5d39be73e58e3ea05',
    'be85465f39e4bf553c55e59f521b047a',
    'b2bc805754975f48fe8aac9e9cd6d001',
    'ed31223882b364815833e87870dcfc0c',
    '231d312fb11efd1028aff7b6cd59f1e3',
    '6dbc3e2e853d0fb7da9b24a0c0627a1c',
  ]) assert.match(pageSource, new RegExp(marker, 'u'));
  assert.doesNotMatch(pageSource, /権利確認|権利を確認|rights-checkbox|rights-attestation/iu);
});
