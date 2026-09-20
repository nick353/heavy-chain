import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('ProtectedRoute only shows recovery actions for an explicit auth recovery state', () => {
  assert.match(
    appSource,
    /if \(!isInitialized \|\| isLoading \|\| authRecoveryRequired\) \{\s*return <WorkspaceLoadingFallback authRecovery=\{authRecoveryRequired\} showHeader=\{false\} \/>;\s*\}/,
  );
  assert.doesNotMatch(
    appSource,
    /if \(!isInitialized \|\| isLoading \|\| authRecoveryRequired\) \{\s*return <WorkspaceLoadingFallback authRecovery showHeader=\{false\} \/>;\s*\}/,
  );
});
