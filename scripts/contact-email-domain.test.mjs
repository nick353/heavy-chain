import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// heavy-chain.app has no MX record; on heavychain.app Email Routing only forwards hello@ (catch-all drops),
// so the published contact address must be hello@heavychain.app.
test('contact address uses the heavychain.app domain', () => {
  for (const file of ['src/App.tsx', 'src/pages/LightchainCustomStylePage.tsx']) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /@heavy-chain\.app/);
    assert.match(source, /hello@heavychain\.app/);
    assert.doesNotMatch(source, /contact@heavychain\.app/);
  }
});
