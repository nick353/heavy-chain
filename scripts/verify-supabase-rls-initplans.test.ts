import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL(
  '../supabase/migrations/20260818080001_optimize_rls_auth_initplans.sql',
  import.meta.url,
);

test('RLS auth predicates use statement-stable auth.uid() wrappers', async () => {
  const source = await readFile(migrationPath, 'utf8');

  for (const policyName of [
    'Brand viewers can view Lightchain task steps',
    'Brand editors can create Lightchain task steps',
    'Brand editors can update Lightchain task steps',
    'Users can view own beta feedback',
  ]) {
    assert.match(source, new RegExp('DROP POLICY IF EXISTS "' + policyName + '"'));
    assert.match(source, new RegExp('CREATE POLICY "' + policyName + '"'));
  }

  assert.match(source, /SELECT auth\.uid\(\)/);
  assert.doesNotMatch(source, /(?:=|WHERE user_id|owner_id)\s+auth\.uid\(\)/);
  assert.match(source, /private\.is_current_user_admin\(\)/);
  assert.match(source, /BEGIN;[\s\S]*COMMIT;/);
});
