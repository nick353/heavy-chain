import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(repoRoot, '.codex/automation-kernel/manifests/heavy-chain.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const expectedResultFields = new Set([
  'schema',
  'workflow_id',
  'run_id',
  'terminal_status',
  'selected_stages',
  'stage_results',
  'exact_blocker',
  'restart_stage',
  'artifact_uris',
  'cleanup_proof',
]);

const resolveAuthority = (value) => (isAbsolute(value) ? value : resolve(repoRoot, value));

test('manifest binds the active Heavy Chain repository and current entrypoints', () => {
  assert.equal(manifest.schema, 'automation_kernel_manifest.v1');
  assert.equal(manifest.id, 'heavy-chain');
  assert.equal(manifest.kind, 'product_workflow');
  assert.equal(manifest.root, repoRoot);
  assert.deepEqual(manifest.registered_entrypoint, {
    path: resolve(repoRoot, 'scripts/heavy-chain-kernel-entrypoint.mjs'),
    cwd: repoRoot,
    command: 'node scripts/heavy-chain-kernel-entrypoint.mjs',
  });
  assert.equal(statSync(manifest.registered_entrypoint.path).isFile(), true);
  assert.ok(manifest.authority_paths.length > 0);
  for (const authority of manifest.authority_paths) {
    assert.equal(statSync(resolveAuthority(authority)).isFile(), true, authority);
  }

  const entrypoints = Object.fromEntries(manifest.entrypoints.map((entrypoint) => [entrypoint.id, entrypoint]));
  assert.match(packageJson.scripts['automation-kernel:validate'], /automation-kernel-run\/scripts\/kernel-run\.mjs validate/);
  assert.match(packageJson.scripts['automation-kernel:validate'], /heavy-chain\.json/);
  assert.equal(packageJson.scripts.typecheck, 'tsc --noEmit');
  assert.equal(packageJson.scripts.build, 'tsc -b && vite build');
  assert.equal(packageJson.scripts.e2e, 'node scripts/run-e2e.mjs');
  assert.equal(packageJson.scripts['verify:release-gate'], 'node scripts/verify-release-gate-unified.mjs');
  assert.match(packageJson.scripts['automation-kernel:run'], /heavy-chain-kernel-entrypoint\.mjs/);
  assert.match(packageJson.scripts['automation-kernel:dry-run'], /heavy-chain-kernel-entrypoint\.mjs/);
  assert.deepEqual(entrypoints.repo_playwright_e2e, {
    id: 'repo_playwright_e2e',
    command: 'npm run e2e',
    runner: 'scripts/run-e2e.mjs',
  });
});

test('result-v2 and JIT lease contracts are strict', () => {
  assert.equal(manifest.result_contract.schema, 'automation_kernel_result.v2');
  assert.deepEqual(new Set(manifest.result_contract.terminal_statuses), new Set(['succeeded', 'blocked', 'failed']));
  assert.deepEqual(new Set(manifest.result_contract.required_fields), expectedResultFields);
  assert.deepEqual(
    new Set(manifest.result_contract.blocked_requires),
    new Set(['exact_blocker', 'restart_stage', 'cleanup_proof']),
  );
    assert.deepEqual(
      new Set(manifest.result_contract.success_requires),
      new Set([
        'all_selected_stages_terminal',
        'repo_playwright_e2e_executed_when_selected',
        'marker_scoped_cleanup_for_generation_probes',
        'no_human_only_gate_crossed',
      ]),
    );
  assert.deepEqual(manifest.chrome_lease_contract, {
    schema: 'automation_kernel_chrome_stage_lease.v1',
    mode: 'jit_exclusive',
    scope: 'stage',
    receipt_ttl_seconds: 300,
    receipt_scope: 'current_session_turn_nonce',
    fresh_preflight: 'required_before_each_stage_invocation',
    prior_receipt_reuse: 'forbidden',
    acquire: 'immediately_before_stage',
    release: 'finally_after_terminal_receipt',
    no_cross_stage_hold: true,
    surface: 'signed_chrome_extension_profile2',
    fallback: 'forbidden',
  });

  const stageIds = manifest.stages.map((stage) => stage.id);
  assert.equal(new Set(stageIds).size, stageIds.length);
  for (const stage of manifest.stages) {
    assert.ok(['internal_idempotent', 'external_non_idempotent'].includes(stage.effect_class));
    if (stage.needs_chrome) {
      assert.equal(stage.lane, 'signed_chrome_extension_profile2');
      assert.equal(stage.chrome_lease.mode, 'jit_exclusive');
      assert.equal(stage.chrome_lease.scope, 'stage');
      assert.ok(stage.chrome_lease.max_wall_seconds > 0 && stage.chrome_lease.max_wall_seconds <= 300);
      assert.ok(stage.fan_out.unit);
      assert.equal(stage.fan_out.max_units_per_invocation, 1);
      assert.equal(stage.continuation.mode, 'fresh_preflight_per_invocation');
      assert.ok(stage.continuation.until);
      assert.ok(stage.continuation.next);
      assert.equal(stage.continuation.fresh_preflight_required, true);
      assert.equal(stage.continuation.reuse_prior_receipt, false);
    } else {
      assert.notEqual(stage.lane, 'signed_chrome_extension_profile2');
      assert.equal(stage.chrome_lease, null);
    }
  }
});

test('Playwright stays repo-owned and only live production visual QA leases Chrome', () => {
  const stages = Object.fromEntries(manifest.stages.map((stage) => [stage.id, stage]));
  assert.deepEqual(
    manifest.stages.filter((stage) => stage.needs_chrome).map((stage) => stage.id),
    ['live_production_route_visual_qa', 'live_production_cleanup_proof'],
  );
  assert.equal(
    stages.live_production_route_visual_qa.fan_out.unit,
    'production_route_with_url_dom_or_readback_and_screenshot',
  );
  assert.equal(stages.live_production_cleanup_proof.replay, 'run_owned_resources_only');
  assert.equal(stages.repo_playwright_e2e.lane, 'repo_owned_playwright');
  assert.equal(stages.repo_playwright_e2e.chrome_lease, null);
  assert.equal(stages.runway_mcp_generation.lane, 'runway_mcp');
  assert.equal(stages.runway_mcp_generation.effect_class, 'external_non_idempotent');
  assert.equal(stages.runway_mcp_generation.chrome_lease, null);
  assert.equal(stages.deploy.approval_required, true);
  assert.equal(stages.deploy.effect_class, 'external_non_idempotent');
  assert.equal(stages.live_production_cleanup_proof.always_run, true);

  const gates = new Map(manifest.domain_gates.map((gate) => [gate.id, gate]));
  for (const gateId of [
    'repo_owned_playwright',
    'playwright_execution_proof',
    'live_visual_surface',
    'release_acceptance',
    'generation_architecture',
    'human_only',
  ]) {
    assert.ok(gates.has(gateId), gateId);
    assert.ok(gates.get(gateId).rule);
    assert.ok(gates.get(gateId).on_violation);
  }
  assert.equal(gates.get('playwright_execution_proof').on_violation, 'repo_playwright_e2e_not_executed');
  assert.equal(gates.get('release_acceptance').on_violation, 'allow_dirty_not_release_acceptance');
});
