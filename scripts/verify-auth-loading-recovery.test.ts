import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('workspace loading fallback exposes bounded login recovery after a stall', () => {
  assert.match(appSource, /WORKSPACE_LOADING_STALL_TIMEOUT_MS\s*=\s*10_000/);
  assert.match(appSource, /setLoadingStalled\(true\)/);
  assert.match(appSource, /data-loading-state=\{authRecovery \? 'auth-recovery' : loadingStalled \? 'stalled' : 'lazy-page'\}/);
  assert.match(appSource, /href="\/login"[\s\S]*>\s*ログイン\s*</);
  assert.match(appSource, /window\.location\.reload\(\)/);
});
