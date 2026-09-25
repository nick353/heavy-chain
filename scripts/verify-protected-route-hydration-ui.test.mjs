import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('ProtectedRoute preserves the source login redirect after explicit auth recovery', () => {
  assert.match(
    appSource,
    /const returnTo = `\$\{location\.pathname\}\$\{location\.search\}\$\{location\.hash\}`;[\s\S]*?if \(authRecoveryRequired && !user\) \{[\s\S]*?Navigate to=\{`\/login\?redirect=\$\{encodeURIComponent\(returnTo\)\}`\}/,
  );
  assert.doesNotMatch(
    appSource,
    /if \(!isInitialized \|\| isLoading \|\| authRecoveryRequired\) \{\s*return <Navigate/,
  );
});
