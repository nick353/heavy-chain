import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('workspace loading fallback waits for session hydration before login recovery', () => {
  assert.match(appSource, /WORKSPACE_LOADING_STALL_TIMEOUT_MS\s*=\s*30_000/);
  assert.match(appSource, /AUTH_SERVICE_RETRY_DELAY_MS\s*=\s*1_500/);
  assert.match(appSource, /if \(!authServiceUnavailable\) return undefined;[\s\S]*void initialize\(\);/);
  assert.match(appSource, /authServiceUnavailable && !user[\s\S]*WorkspaceLoadingFallback authServiceUnavailable/);
  assert.match(appSource, /setLoadingStalled\(true\)/);
  assert.match(appSource, /data-loading-state=\{authRecovery \? 'auth-recovery' : authServiceUnavailable \? 'auth-service-unavailable' : loadingStalled \? 'stalled' : 'lazy-page'\}/);
  assert.match(appSource, /authRecovery \? \([\s\S]*href="\/login"[\s\S]*>\s*ログイン\s*</);
  assert.match(appSource, /loadingStalled\s*\? 'ログイン状態を維持したまま/);
  assert.match(appSource, /authServiceUnavailable\s*\? '認証サービスに再接続しています'/);
  assert.match(appSource, /authServiceUnavailable\s*\? \([\s\S]*再接続[\s\S]*window\.location\.reload\(\)/);
  assert.match(appSource, /window\.location\.reload\(\)/);
});
