import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pageSource = await readFile(new URL('../src/pages/VideoProjectDashboardPage.tsx', import.meta.url), 'utf8');

test('video dashboard keeps Light source image crop semantics', () => {
  const imageTags = [...pageSource.matchAll(/<img\s+src=\{project\.imageUrl\}[^>]+>/gu)].map((match) => match[0]);
  assert.equal(imageTags.length, 2, 'recent and reference image branches must remain explicit');
  // Project covers fill the card and are cropped by object-cover.
  for (const tag of imageTags) assert.match(tag, /className="h-full w-full object-cover"/u);
});

test('video dashboard shows saved projects, keeps the five reference templates, and has no rights checkbox', () => {
  // Recent cards come from the brand's saved projects, so the four Light sample covers are gone.
  for (const marker of ['548083b211dccf02c2b0335279d15216', 'b9e909c9d8444f93918a34724c255adb', '509cc48a248ff6fbcc0492b57f6aac68', '1e4238ea72d473c5d39be73e58e3ea05']) {
    assert.doesNotMatch(pageSource, new RegExp(marker, 'u'));
  }
  // The reference templates keep Light's template covers.
  for (const marker of ['be85465f39e4bf553c55e59f521b047a', 'b2bc805754975f48fe8aac9e9cd6d001', 'ed31223882b364815833e87870dcfc0c', '231d312fb11efd1028aff7b6cd59f1e3', '6dbc3e2e853d0fb7da9b24a0c0627a1c']) {
    assert.match(pageSource, new RegExp(`VIDEO_TEMPLATE_COVER\\('${marker}'\\)`, 'u'));
  }
  assert.doesNotMatch(pageSource, /権利確認|権利を確認|rights-checkbox|rights-attestation/iu);
});
