import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL(
  '../supabase/migrations/20260818074224_harden_security_definer_rpc_boundaries.sql',
  import.meta.url,
);

test('public RPC names remain stable while SECURITY DEFINER implementations move to private', async () => {
  const source = await readFile(migrationPath, 'utf8');
  const functions = [
    'create_brand',
    'get_brand_usage_summary',
    'get_billing_purchase_proof_summary',
    'update_canvas_document_snapshot',
  ];

  for (const functionName of functions) {
    assert.match(source, new RegExp(`ALTER FUNCTION public\\.${functionName}\\(`));
    assert.match(source, new RegExp(`private\\.${functionName}\\(`));
    assert.match(source, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\(`));
  }

  const publicWrapperSection = source.slice(source.indexOf('CREATE OR REPLACE FUNCTION public.create_brand'));
  assert.doesNotMatch(publicWrapperSection, /SECURITY DEFINER/);
  assert.match(publicWrapperSection, /SECURITY INVOKER/);
  assert.match(source, /REVOKE ALL ON FUNCTION private\.create_brand/);
  assert.match(source, /GRANT EXECUTE ON FUNCTION public\.update_canvas_document_snapshot[^;]+ TO authenticated;/s);
});

