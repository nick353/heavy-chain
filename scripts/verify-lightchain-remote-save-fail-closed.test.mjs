import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = {
  fashion: await readFile(new URL('../src/pages/FashionStudioPage.tsx', import.meta.url), 'utf8'),
  library: await readFile(new URL('../src/pages/LightchainLibraryPage.tsx', import.meta.url), 'utf8'),
  parity: await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8'),
  video: await readFile(new URL('../src/pages/VideoProjectDashboardPage.tsx', import.meta.url), 'utf8'),
};

test('all library/project copy paths reject local-only success when Cloudflare is configured', () => {
  for (const [name, source] of Object.entries(files)) {
    assert.match(source, /cloudflareDataPlane\s*&&\s*!result\.remote/, `${name} must fail closed without remote receipt`);
    assert.match(source, /リモート保存の確認に失敗しました/, `${name} must expose an explicit remote readback failure`);
  }
});

test('successful Light Chain clone save messaging no longer advertises local-only persistence', () => {
  for (const [name, source] of Object.entries(files)) {
    assert.doesNotMatch(source, /result\.remote\s*\?[^\n]*ローカルライブラリー/, `${name} must not report local-only success`);
  }
});
