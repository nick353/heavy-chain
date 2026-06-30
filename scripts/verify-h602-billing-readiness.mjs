import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const checks = [];

const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

const assertIncludes = (content, needle, label) => {
  const ok = content.includes(needle);
  checks.push({ label, ok });
  if (!ok) failures.push(label);
};

const assertNotIncludes = (content, needle, label) => {
  const ok = !content.includes(needle);
  checks.push({ label, ok });
  if (!ok) failures.push(label);
};

const migrationPath = 'supabase/migrations/20260630102537_enable_billing_enforcement_test_exemptions.sql';
const purchaseProofMigrationPath = 'supabase/migrations/20260630130507_h602_purchase_proof_readback.sql';
const purchaseProofHardeningMigrationPath = 'supabase/migrations/20260630132500_h602_purchase_proof_fail_closed_hardening.sql';
const purchaseProofHashOnlyMigrationPath = 'supabase/migrations/20260630134000_h602_purchase_proof_hash_only_constraints.sql';
const purchaseProofArtifactAllowlistMigrationPath = 'supabase/migrations/20260630135000_h602_purchase_proof_artifact_metadata_allowlist.sql';
const productionReadbackPath = 'output/playwright/h602-production-billing-readback-20260630/summary.json';
const migrationExists = existsSync(join(root, migrationPath));
checks.push({ label: 'h602_migration_exists', ok: migrationExists });
if (!migrationExists) failures.push('h602_migration_exists');

const purchaseProofMigrationExists = existsSync(join(root, purchaseProofMigrationPath));
checks.push({ label: 'h602_purchase_proof_migration_exists', ok: purchaseProofMigrationExists });
if (!purchaseProofMigrationExists) failures.push('h602_purchase_proof_migration_exists');

const purchaseProofHardeningMigrationExists = existsSync(join(root, purchaseProofHardeningMigrationPath));
checks.push({ label: 'h602_purchase_proof_hardening_migration_exists', ok: purchaseProofHardeningMigrationExists });
if (!purchaseProofHardeningMigrationExists) failures.push('h602_purchase_proof_hardening_migration_exists');

const purchaseProofHashOnlyMigrationExists = existsSync(join(root, purchaseProofHashOnlyMigrationPath));
checks.push({ label: 'h602_purchase_proof_hash_only_migration_exists', ok: purchaseProofHashOnlyMigrationExists });
if (!purchaseProofHashOnlyMigrationExists) failures.push('h602_purchase_proof_hash_only_migration_exists');

const purchaseProofArtifactAllowlistMigrationExists = existsSync(join(root, purchaseProofArtifactAllowlistMigrationPath));
checks.push({ label: 'h602_purchase_proof_artifact_allowlist_migration_exists', ok: purchaseProofArtifactAllowlistMigrationExists });
if (!purchaseProofArtifactAllowlistMigrationExists) failures.push('h602_purchase_proof_artifact_allowlist_migration_exists');

const productionReadbackExists = existsSync(join(root, productionReadbackPath));
checks.push({ label: 'h602_production_readback_exists', ok: productionReadbackExists });
if (!productionReadbackExists) failures.push('h602_production_readback_exists');

const migration = migrationExists ? read(migrationPath) : '';
const purchaseProofMigration = purchaseProofMigrationExists ? read(purchaseProofMigrationPath) : '';
const purchaseProofHardeningMigration = purchaseProofHardeningMigrationExists ? read(purchaseProofHardeningMigrationPath) : '';
const purchaseProofHashOnlyMigration = purchaseProofHashOnlyMigrationExists ? read(purchaseProofHashOnlyMigrationPath) : '';
const purchaseProofArtifactAllowlistMigration = purchaseProofArtifactAllowlistMigrationExists ? read(purchaseProofArtifactAllowlistMigrationPath) : '';
const productionReadback = productionReadbackExists ? JSON.parse(read(productionReadbackPath)) : null;
const usageStats = read('src/components/UsageStats.tsx');
const creditsPage = read('src/pages/CreditsPage.tsx');
const creditSummaryPanel = read('src/components/workspace/CreditSummaryPanel.tsx');
const workspaceActivity = read('src/lib/workspaceActivity.ts');
const app = read('src/App.tsx');
const brandSettings = read('src/pages/BrandSettingsPage.tsx');
const errorMessages = read('src/lib/errorMessages.ts');
const lightchainUiVerifier = read('scripts/verify-lightchain-production-ui.mjs');
const packageJson = read('package.json');

assertIncludes(migration, 'CREATE TABLE IF NOT EXISTS public.billing_settings', 'billing_settings_table_exists');
assertIncludes(migration, 'generation_quota_enforced BOOLEAN NOT NULL DEFAULT TRUE', 'quota_enforcement_defaults_true');
assertIncludes(migration, "apple_billing_mode TEXT NOT NULL DEFAULT 'operator_managed'", 'apple_billing_operator_managed');
assertIncludes(migration, 'production_checkout_enabled BOOLEAN NOT NULL DEFAULT FALSE', 'checkout_not_enabled_by_migration');
assertIncludes(migration, 'CREATE TABLE IF NOT EXISTS public.billing_test_accounts', 'billing_test_accounts_table_exists');
assertIncludes(migration, "provider TEXT NOT NULL DEFAULT 'apple_sandbox'", 'apple_sandbox_provider_default');
assertIncludes(migration, 'sandbox_testers_no_real_charge BOOLEAN NOT NULL DEFAULT TRUE', 'sandbox_testers_no_real_charge_recorded');
assertIncludes(migration, 'private.is_billing_test_account', 'test_account_helper_exists');
assertIncludes(migration, 'private.is_apple_sandbox_billing_test_account', 'apple_sandbox_helper_exists');
assertIncludes(migration, 'billing_test_account_quota_bypass', 'test_account_usage_metadata_exists');
assertIncludes(migration, 'apple_sandbox_tester_no_real_charge', 'sandbox_no_charge_usage_metadata_exists');
assertIncludes(migration, "bta.provider = 'apple_sandbox'", 'apple_no_charge_metadata_is_provider_scoped');
assertIncludes(migration, 'billing_test_account_quota_bypass BOOLEAN', 'usage_summary_exposes_test_bypass_flag');
assertIncludes(migration, 'AND NOT v_is_billing_test_account', 'quota_exempts_test_accounts');
assertIncludes(migration, "RAISE EXCEPTION 'Brand usage quota exceeded'", 'non_test_quota_hard_stop_restored');
assertIncludes(migration, 'bs.current_period_start <= NOW()', 'usage_summary_matches_current_period_start');
assertIncludes(migration, 'bs.current_period_end > NOW()', 'usage_summary_matches_current_period_end');
assertIncludes(migration, 'AND p.is_active', 'usage_summary_requires_active_plan');
assertIncludes(migration, 'private.is_current_user_admin()', 'admin_only_management_policy');
assertIncludes(migration, 'GRANT ALL ON TABLE public.billing_test_accounts TO service_role', 'service_role_can_manage_test_accounts');
assertIncludes(migration, 'apple_id_or_checkout_credentials_configured_by_migration', 'no_credential_scope_metadata');
assertNotIncludes(migration, 'OR (bta.brand_id IS NOT NULL AND bta.brand_id = p_brand_id)', 'no_brand_wide_test_account_quota_bypass');

assertIncludes(purchaseProofMigration, 'CREATE TABLE IF NOT EXISTS public.billing_purchase_proofs', 'purchase_proof_table_exists');
assertIncludes(purchaseProofMigration, 'billing_purchase_proof_status', 'purchase_proof_status_type_exists');
assertIncludes(purchaseProofMigration, 'billing_purchase_proof_source', 'purchase_proof_source_type_exists');
assertIncludes(purchaseProofMigration, "proof_source <> 'human_attestation'", 'human_attestation_not_verified_purchase_proof');
assertIncludes(purchaseProofMigration, 'no_real_charge_confirmed', 'no_real_charge_confirmation_recorded');
assertIncludes(purchaseProofMigration, 'transaction_id_hash', 'transaction_hash_supported');
assertIncludes(purchaseProofMigration, 'receipt_hash', 'receipt_hash_supported');
assertIncludes(purchaseProofMigration, 'entitlement_id', 'entitlement_readback_supported');
assertIncludes(purchaseProofMigration, 'CREATE OR REPLACE FUNCTION public.get_billing_purchase_proof_summary', 'purchase_proof_summary_rpc_exists');
assertIncludes(purchaseProofMigration, 'transaction_or_entitlement_readback BOOLEAN', 'purchase_proof_summary_exposes_readback_flag');
assertIncludes(purchaseProofMigration, "private.has_brand_role(p_brand_id, 'viewer')", 'purchase_proof_summary_brand_viewer_guard');
assertIncludes(purchaseProofMigration, 'REVOKE ALL ON TABLE public.billing_purchase_proofs FROM PUBLIC, anon, authenticated', 'purchase_proof_table_revoked_by_default');
assertIncludes(purchaseProofMigration, 'GRANT ALL ON TABLE public.billing_purchase_proofs TO service_role', 'purchase_proof_service_role_manage');
assertIncludes(purchaseProofHardeningMigration, 'billing_purchase_proofs_no_raw_receipt_like_metadata_check', 'raw_receipt_like_metadata_blocked');
assertIncludes(purchaseProofHardeningMigration, "metadata - 'raw_receipt_stored'", 'legacy_raw_receipt_stored_key_removed');
assertIncludes(purchaseProofHardeningMigration, "'sensitive_payload_stored'", 'legacy_raw_receipt_flag_renamed_to_safe_key');
assertIncludes(purchaseProofHardeningMigration, "metadata::text !~*", 'nested_raw_receipt_like_metadata_blocked');
assertIncludes(purchaseProofHardeningMigration, "proof_source IN (\n        'app_store_transaction'", 'verified_status_requires_machine_source');
assertIncludes(purchaseProofHardeningMigration, 'WHERE bpp.brand_id = p_brand_id', 'purchase_proof_summary_is_brand_scoped');
assertNotIncludes(purchaseProofHardeningMigration, 'OR bpp.user_id = (SELECT auth.uid())', 'purchase_proof_summary_no_cross_brand_user_scope');
assertNotIncludes(purchaseProofHardeningMigration, 'bpp.tester_email = lower(u.email)', 'purchase_proof_summary_no_cross_brand_email_scope');
assertIncludes(purchaseProofHashOnlyMigration, 'billing_purchase_proofs_hash_fields_sha256_hex_check', 'hash_fields_sha256_hex_only');
assertIncludes(purchaseProofHashOnlyMigration, "transaction_id_hash ~ '^[a-f0-9]{64}$'", 'transaction_hash_is_sha256_hex');
assertIncludes(purchaseProofHashOnlyMigration, "receipt_hash ~ '^[a-f0-9]{64}$'", 'receipt_hash_is_sha256_hex');
assertIncludes(purchaseProofHashOnlyMigration, 'billing_purchase_proofs_entitlement_id_short_identifier_check', 'entitlement_id_short_identifier_only');
assertIncludes(purchaseProofHashOnlyMigration, 'billing_purchase_proofs_no_raw_receipt_like_metadata_check', 'metadata_blocks_bare_receipt_payload_keys');
assertIncludes(purchaseProofHashOnlyMigration, '"(receipt|payload|raw[_-]?receipt', 'metadata_blocks_receipt_and_payload_keys');
assertIncludes(purchaseProofArtifactAllowlistMigration, 'billing_purchase_proofs_metadata_key_allowlist_check', 'metadata_keys_allowlisted');
assertIncludes(purchaseProofArtifactAllowlistMigration, 'billing_purchase_proofs_artifact_uri_safe_locator_check', 'artifact_uri_safe_locator_only');
assertIncludes(purchaseProofArtifactAllowlistMigration, "artifact_uri ~ '^(output|docs|goals)/", 'artifact_uri_must_be_relative_artifact_locator');
assertIncludes(purchaseProofArtifactAllowlistMigration, "artifact_uri !~* '(data:|base64|receipt|payload|signed|eyJ", 'artifact_uri_blocks_payload_like_values');

assertJson(
  productionReadback?.purchaseProofMigration?.applied === true,
  'production_purchase_proof_migration_applied',
);
assertJson(
  productionReadback?.purchaseProofHardeningMigration?.applied === true,
  'production_purchase_proof_hardening_migration_applied',
);
assertJson(
  productionReadback?.purchaseProofHashOnlyMigration?.applied === true,
  'production_purchase_proof_hash_only_migration_applied',
);
assertJson(
  productionReadback?.purchaseProofArtifactAllowlistMigration?.applied === true,
  'production_purchase_proof_artifact_allowlist_migration_applied',
);
assertJson(
  productionReadback?.billingSettings?.generationQuotaEnforced === true,
  'production_quota_enforcement_enabled',
);
assertJson(
  productionReadback?.billingSettings?.productionCheckoutEnabled === false,
  'production_checkout_still_disabled',
);
assertJson(
  productionReadback?.sandboxTester?.registered === true && productionReadback?.sandboxTester?.emailRedacted === true,
  'production_sandbox_tester_registered_and_redacted',
);
assertJson(
  productionReadback?.purchaseProofReadback?.humanAttestedProofRegistered === true,
  'production_human_attestation_recorded',
);
assertJson(
  productionReadback?.purchaseProofReadback?.verifiedNoRealChargeProofCount === 0 &&
    productionReadback?.purchaseProofReadback?.transactionOrEntitlementReadback === false &&
    productionReadback?.securityReadback?.purchaseProofHashFieldsSha256HexOnly === true &&
    productionReadback?.securityReadback?.purchaseProofMetadataBareReceiptPayloadBlocked === true &&
    productionReadback?.securityReadback?.purchaseProofMetadataKeysAllowlisted === true &&
    productionReadback?.securityReadback?.purchaseProofArtifactUriSafeLocatorOnly === true &&
    productionReadback?.ok === false,
  'production_h602_incomplete_is_fail_closed',
);

assertNotIncludes(migration, 'APPLE_ID', 'no_apple_id_secret_in_migration');
assertNotIncludes(purchaseProofMigration, 'APPLE_ID', 'no_apple_id_secret_in_purchase_proof_migration');
assertNotIncludes(purchaseProofHardeningMigration, 'APPLE_ID', 'no_apple_id_secret_in_purchase_proof_hardening_migration');
assertNotIncludes(purchaseProofHashOnlyMigration, 'APPLE_ID', 'no_apple_id_secret_in_purchase_proof_hash_only_migration');
assertNotIncludes(purchaseProofArtifactAllowlistMigration, 'APPLE_ID', 'no_apple_id_secret_in_purchase_proof_artifact_allowlist_migration');
assertNotIncludes(migration, 'password', 'no_password_in_migration');
assertNotIncludes(purchaseProofMigration, 'password', 'no_password_in_purchase_proof_migration');
assertNotIncludes(purchaseProofHardeningMigration, 'password', 'no_password_in_purchase_proof_hardening_migration');
assertNotIncludes(purchaseProofHashOnlyMigration, 'password', 'no_password_in_purchase_proof_hash_only_migration');
assertNotIncludes(purchaseProofArtifactAllowlistMigration, 'password', 'no_password_in_purchase_proof_artifact_allowlist_migration');
assertNotIncludes(migration, 'checkout.session', 'no_checkout_session_creation');
assertNotIncludes(purchaseProofMigration, 'checkout.session', 'no_checkout_session_creation_in_purchase_proof_migration');
assertNotIncludes(purchaseProofHardeningMigration, 'checkout.session', 'no_checkout_session_creation_in_purchase_proof_hardening_migration');
assertNotIncludes(purchaseProofHashOnlyMigration, 'checkout.session', 'no_checkout_session_creation_in_purchase_proof_hash_only_migration');
assertNotIncludes(purchaseProofArtifactAllowlistMigration, 'checkout.session', 'no_checkout_session_creation_in_purchase_proof_artifact_allowlist_migration');
assertNotIncludes(migration, 'createCharge', 'no_payment_charge_call');
assertNotIncludes(purchaseProofMigration, 'createCharge', 'no_payment_charge_call_in_purchase_proof_migration');
assertNotIncludes(purchaseProofHardeningMigration, 'createCharge', 'no_payment_charge_call_in_purchase_proof_hardening_migration');
assertNotIncludes(purchaseProofHashOnlyMigration, 'createCharge', 'no_payment_charge_call_in_purchase_proof_hash_only_migration');
assertNotIncludes(purchaseProofArtifactAllowlistMigration, 'createCharge', 'no_payment_charge_call_in_purchase_proof_artifact_allowlist_migration');
assertNotIncludes(migration, 'payment_intent', 'no_payment_intent_creation');
assertNotIncludes(purchaseProofMigration, 'payment_intent', 'no_payment_intent_creation_in_purchase_proof_migration');
assertNotIncludes(purchaseProofHardeningMigration, 'payment_intent', 'no_payment_intent_creation_in_purchase_proof_hardening_migration');
assertNotIncludes(purchaseProofHashOnlyMigration, 'payment_intent', 'no_payment_intent_creation_in_purchase_proof_hash_only_migration');
assertNotIncludes(purchaseProofArtifactAllowlistMigration, 'payment_intent', 'no_payment_intent_creation_in_purchase_proof_artifact_allowlist_migration');

assertIncludes(usageStats, '今月残り', 'usage_stats_shows_remaining_quota');
assertIncludes(usageStats, '月間上限', 'usage_stats_shows_monthly_quota');
assertIncludes(usageStats, 'appleSandboxTesterNoRealCharge', 'usage_stats_reads_sandbox_flag');
assertIncludes(usageStats, 'Apple sandbox tester', 'usage_stats_renders_sandbox_mode');
assertNotIncludes(usageStats, "value: '停止なし'", 'usage_stats_no_stopless_claim');
assertIncludes(creditsPage, '今月残り / 上限', 'credits_page_shows_remaining_and_quota');
assertIncludes(creditsPage, 'Apple sandbox tester', 'credits_page_renders_sandbox_mode');
assertNotIncludes(creditsPage, '停止なし', 'credits_page_no_stopless_claim');
assertIncludes(creditSummaryPanel, '今月残り /', 'summary_panel_shows_remaining_quota');
assertIncludes(creditSummaryPanel, 'Apple sandbox tester / 実請求なし', 'summary_panel_renders_sandbox_mode');
assertNotIncludes(creditSummaryPanel, '課金ゲートなし', 'summary_panel_no_no_billing_gate_claim');
assertIncludes(workspaceActivity, 'billingTestAccountQuotaBypass', 'workspace_activity_reads_test_bypass_flag');
assertIncludes(workspaceActivity, 'appleSandboxTesterNoRealCharge', 'workspace_activity_reads_sandbox_flag');
assertNotIncludes(app, '現在このGoal Loopでは', 'legal_copy_no_internal_goal_loop_wording');
assertIncludes(brandSettings, '月間 quota は通常アカウントの生成条件', 'brand_settings_quota_copy_updated');
assertIncludes(lightchainUiVerifier, '月間 quota は通常アカウントの生成条件', 'lightchain_verifier_quota_copy_updated');
assertIncludes(errorMessages, 'Heavy Chainのプランと月間quota', 'quota_error_points_to_heavy_chain_plan');

assertIncludes(packageJson, '"verify:h602-billing"', 'package_script_registered');

const ok = failures.length === 0;
const summary = {
  ok,
  checkedAt: new Date().toISOString(),
  checks,
  failures,
  scope: {
    performed: [
      'database quota enforcement readiness',
      'Apple sandbox tester quota bypass',
      'no-charge tester metadata',
      'redacted purchase proof readback layer',
      'fail-closed H602 production readback boundary',
      'user-facing quota display copy',
    ],
    notPerformed: [
      'Apple ID login',
      'credential entry',
      'real purchase',
      'checkout/payment confirmation',
      'production external publish',
    ],
  },
};

console.log(JSON.stringify(summary, null, 2));
if (!ok) process.exit(1);

function assertJson(ok, label) {
  checks.push({ label, ok: Boolean(ok) });
  if (!ok) failures.push(label);
}
