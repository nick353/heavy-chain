import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// heavy-chain.app has no MX record; the site and its Email Routing live on heavychain.app.
test('contact address uses the heavychain.app domain', () => {
  for (const file of ['src/App.tsx', 'src/pages/LightchainCustomStylePage.tsx']) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /@heavy-chain\.app/);
    assert.match(source, /contact@heavychain\.app/);
  }
});
