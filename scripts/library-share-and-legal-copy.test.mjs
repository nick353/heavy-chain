import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const library = readFileSync(new URL('../src/pages/LightchainLibraryPage.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('share link falls back to a selectable dialog when the clipboard write fails', () => {
  assert.match(library, /setShareLinkFallback\(result\.shareUrl\)/);
  assert.match(library, /data-testid="library-share-link-dialog"/);
  assert.match(library, /data-testid="library-share-link-input"/);
  assert.doesNotMatch(library, /toast\.success\(`共有リンク: \$\{result\.shareUrl\}`\)/);
});

test('legal copy is written in Japanese without the English word checkout', () => {
  assert.doesNotMatch(app, /購入、checkout/);
  assert.match(app, /課金、支払い、購入手続き、外部公開/);
});
