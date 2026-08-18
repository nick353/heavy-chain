import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL(
  '../supabase/migrations/20260818080857_add_missing_foreign_key_indexes.sql',
  import.meta.url,
);

test('all linked advisor foreign-key index findings have additive local coverage', async () => {
  const source = await readFile(migrationPath, 'utf8');
  const indexes = [
    ['admin_audit_logs', 'actor_user_id'],
    ['admin_audit_logs', 'brand_id'],
    ['api_usage_logs', 'brand_id'],
    ['api_usage_logs', 'user_id'],
    ['brand_subscriptions', 'plan_id'],
    ['canvas_documents', 'owner_id'],
    ['edge_function_runs', 'usage_event_id'],
    ['edge_function_runs', 'user_id'],
    ['feedback_submissions', 'brand_id'],
    ['folders', 'parent_folder_id'],
    ['generated_images', 'parent_image_id'],
    ['image_folders', 'folder_id'],
    ['image_tags', 'tag_id'],
    ['lightchain_task_steps', 'user_id'],
    ['share_links', 'created_by'],
    ['style_presets', 'brand_id'],
  ];

  for (const [table, column] of indexes) {
    assert.match(source, new RegExp(`CREATE INDEX IF NOT EXISTS idx_${table}_${column}`));
    assert.match(source, new RegExp(`ON public\\.${table}\\(${column}\\)`));
  }

  assert.match(source, /additive/);
  assert.doesNotMatch(source, /DROP INDEX|DROP POLICY|ALTER POLICY|REVOKE/);
});
