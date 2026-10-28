import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../src/lib/cloudflareApi.ts', import.meta.url), 'utf8');

test('saving an uploaded image allows a full upload instead of aborting after 8 seconds', () => {
  assert.match(api, /export const WORKSPACE_ARTIFACT_SAVE_TIMEOUT_MS = 60_000;/);
  assert.match(api, /body: JSON\.stringify\(\{ \.\.\.input, imageUrl \}\), signal: AbortSignal\.timeout\(WORKSPACE_ARTIFACT_SAVE_TIMEOUT_MS\)/);
  assert.match(api, /workspace-artifacts\/\$\{encodeURIComponent\(requestId\)\}`, \{\n\s+method: 'GET', signal: AbortSignal\.timeout\(20_000\)/);
});
