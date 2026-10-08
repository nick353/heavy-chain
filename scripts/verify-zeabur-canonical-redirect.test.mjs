import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { canonicalRedirect } from './serve-zeabur.mjs';

const zeabur = (path) => new URL(path, 'http://heavy-chain.zeabur.app');

test('page requests on Zeabur go to heavychain.app with the same path and query', () => {
  assert.equal(canonicalRedirect('GET', zeabur('/tools/printing?resumeJob=ai-1'), 'https://heavychain.app'), 'https://heavychain.app/tools/printing?resumeJob=ai-1');
  assert.equal(canonicalRedirect('HEAD', zeabur('/'), 'https://heavychain.app'), 'https://heavychain.app/');
  assert.equal(canonicalRedirect('GET', zeabur('/reset-password?token=x'), 'https://heavychain.app'), 'https://heavychain.app/reset-password?token=x');
});

test('health checks, the auth proxy, non-GET requests and the canonical host itself are not redirected', () => {
  assert.equal(canonicalRedirect('GET', zeabur('/_health'), 'https://heavychain.app'), null);
  assert.equal(canonicalRedirect('POST', zeabur('/api/auth/sign-in'), 'https://heavychain.app'), null);
  assert.equal(canonicalRedirect('GET', zeabur('/api/auth/session'), 'https://heavychain.app'), null);
  assert.equal(canonicalRedirect('POST', zeabur('/tools/printing'), 'https://heavychain.app'), null);
  assert.equal(canonicalRedirect('GET', new URL('https://heavychain.app/tools'), 'https://heavychain.app'), null);
  assert.equal(canonicalRedirect('GET', zeabur('/'), null), null);
});

test('the server answers 302 to heavychain.app and keeps /_health', async () => {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['scripts/serve-zeabur.mjs'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((resolve) => child.stdout.once('data', resolve));
    const page = await fetch(`http://127.0.0.1:${port}/asset-center?image=abc`, { redirect: 'manual' });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), 'https://heavychain.app/asset-center?image=abc');
    const health = await fetch(`http://127.0.0.1:${port}/_health`);
    assert.equal(health.status, 200);
  } finally {
    child.kill();
  }
});
