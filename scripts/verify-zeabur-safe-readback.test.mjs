import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Zeabur readback helper never calls or prints variable secrets', async () => {
  const source = await readFile(new URL('./zeabur-safe-readback.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /runJson\(\s*\[\s*['"]variable['"]/i);
  assert.doesNotMatch(source, /secret(Readback|Value|Key)\s*[:=]\s*[^'"\n]+/i);
  assert.match(source, /variableReadbackCalled:\s*false/);
  assert.match(source, /secretValuesPrinted:\s*false/);
  assert.match(source, /sourceMetadataPresent/);
});
