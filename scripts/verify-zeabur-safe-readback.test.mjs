import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const entrypoint = fileURLToPath(new URL('./zeabur-safe-readback.mjs', import.meta.url));
const retirementMessage =
  'Zeabur safe readback is retired: this compatibility entrypoint is permanently fail-closed and performs no external reads.';

test('retired Zeabur readback entrypoint never invokes the legacy CLI', async () => {
  const source = await readFile(new URL('./zeabur-safe-readback.mjs', import.meta.url), 'utf8');
  const result = spawnSync(process.execPath, [entrypoint], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ZEABUR_CLI: '/definitely-not-invoked/zeabur',
    },
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), retirementMessage);

  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(
    source,
    /\b(?:execFileSync|child_process|fetch|https?|spawn|fork|process\.env|ZEABUR_CLI)\b/i,
  );
  assert.doesNotMatch(source, /\b(?:auth|project|service|deployment|domain)\s+(?:status|list)\b/i);
  assert.match(source, /HISTORICAL SOURCE/);
});
