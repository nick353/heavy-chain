import assert from 'node:assert/strict';
import test from 'node:test';
import { studioProviderPrompt } from '../src/lib/studioFunctionPrompt.ts';

test('3D function asks the provider for a CGI render while keeping the user text first', () => {
  const sent = studioProviderPrompt('この服を3Dにして', '3d');
  assert.ok(sent.startsWith('この服を3Dにして\n'));
  assert.match(sent, /3D CGI product render/);
  assert.match(sent, /not a photograph/);
});

test('other functions send the user text unchanged', () => {
  for (const id of ['text', 'region', 'underwear']) assert.equal(studioProviderPrompt('そのまま', id), 'そのまま');
});

test('a text-mode request that asks for 3D also gets the 3D directive', () => {
  assert.match(studioProviderPrompt('この服を立体感のある3Dレンダリング画像に変換してください。', 'text'), /3D CGI product render/);
  assert.match(studioProviderPrompt('３Ｄ画像にして', 'text'), /3D CGI product render/);
});
