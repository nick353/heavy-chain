import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { resultExitCode, runHeavyChainKernelEntrypoint } from './heavy-chain-kernel-entrypoint.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(repoRoot, '.codex/automation-kernel/manifests/heavy-chain.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function createManifestCopy() {
  const dir = mkdtempSync(resolve(tmpdir(), 'heavy-chain-manifest-copy-'));
  const file = resolve(dir, 'custom-manifest.json');
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, file };
}

function createSpawnStub(callLog, options = {}) {
  const {
    compileStages = ['local_static_checks', 'printing_foundation'],
    failCommand = null,
    skipE2e = false,
  } = options;
  return (command, args) => {
    callLog.push({ command, args: [...args] });
    if (command === process.execPath) {
      const action = args[1];
      const runId = args[args.indexOf('--run-id') + 1];
      const response = { ok: true, action, external_action_executed: false };
      if (action === 'compile' || action === 'status') {
        return kernelResult({
          ...response,
          workflow_id: 'heavy-chain',
          run_id: runId,
          kernel_id: `heavy-chain:${runId}`,
          manifest_sha256: 'manifest',
          stage_order: compileStages,
          definition_hash: 'definition',
          snapshot: {
            status: 'pending',
            next_effect_id: compileStages[0] ?? null,
            exact_blocker: null,
            effects: compileStages.map((stageId) => ({
              effect_id: stageId,
              status: 'pending',
              payload: manifest.stages.find((stage) => stage.id === stageId) ?? {},
              claim_id: null,
              receipt_id: null,
            })),
          },
        });
      }
      if (action === 'claim') {
        const effectId = args[args.indexOf('--effect-id') + 1];
        return kernelResult({
          ...response,
          workflow_id: 'heavy-chain',
          run_id: runId,
          kernel_id: `heavy-chain:${runId}`,
          manifest_sha256: 'manifest',
          timeline_entry: { entry_hash: `claim-${effectId}` },
          snapshot: { next_effect_id: effectId, status: 'pending', exact_blocker: null, effects: [] },
          artifact_path: `/artifacts/claims/${effectId}.json`,
        });
      }
      if (action === 'record') {
        const effectId = args[args.indexOf('--effect-id') + 1];
        const outcome = args[args.indexOf('--outcome') + 1];
        return kernelResult({
          ...response,
          workflow_id: 'heavy-chain',
          run_id: runId,
          kernel_id: `heavy-chain:${runId}`,
          manifest_sha256: 'manifest',
          timeline_entry: { entry_hash: `receipt-${effectId}` },
          snapshot: {
            status: outcome === 'succeeded' ? 'complete' : 'blocked',
            exact_blocker: outcome === 'succeeded' ? null : `heavy_chain_stage_command_failed:${effectId}:typecheck`,
            next_effect_id: null,
            effects: [],
          },
          artifact_path: `/artifacts/receipts/${effectId}.json`,
        });
      }
      if (action === 'result') {
        return kernelResult({
          ...response,
          workflow_id: 'heavy-chain',
          run_id: runId,
          kernel_id: `heavy-chain:${runId}`,
          manifest_sha256: 'manifest',
          artifact_path: '/artifacts/results/result.json',
          terminal_result: {
            schema: 'automation_kernel_result.v2',
            workflow_id: 'heavy-chain',
            run_id: runId,
            terminal_status: 'succeeded',
            selected_stages: compileStages,
            stage_results: compileStages.map((stageId) => ({
              stage_id: stageId,
              status: 'succeeded',
              exact_blocker: null,
              artifact_uris: [`/artifacts/receipts/${stageId}.json`],
              cleanup_proof: null,
              claim_id: `claim-${stageId}`,
              receipt_id: `receipt-${stageId}`,
              proof_uri: `/artifacts/receipts/${stageId}.json`,
              details: { command_results: [] },
            })),
            exact_blocker: null,
            restart_stage: null,
            artifact_uris: compileStages.map((stageId) => `/artifacts/receipts/${stageId}.json`),
            cleanup_proof: 'cleanup:local_entrypoint_no_external_side_effects',
          },
        });
      }
      throw new Error(`unexpected kernel action: ${action}`);
    }

    if (command === 'npm') {
      const scriptIndex = args.indexOf('run');
      const scriptName = args[scriptIndex + 1];
      if (failCommand && failCommand === scriptName) {
        return { status: 1, stdout: '', stderr: `${scriptName} failed` };
      }
      if (skipE2e && scriptName === 'e2e') {
        return { status: 0, stdout: 'Skipping e2e run. Playwright is not installed.\n', stderr: '' };
      }
      return { status: 0, stdout: `${scriptName} ok\n`, stderr: '' };
    }

    throw new Error(`unexpected command: ${command}`);
  };
}

function kernelResult(payload) {
  return {
    status: 0,
    stdout: `${JSON.stringify(payload)}\n`,
    stderr: '',
  };
}

test('dry-run plans compile/status without side effects', () => {
  const calls = [];
  const result = runHeavyChainKernelEntrypoint(
    { manifestPath, runId: 'dry-run-plan', dryRun: true },
    { spawn: createSpawnStub(calls) },
  );

  assert.equal(result.ok, true);
  assert.equal(result.dry_run, true);
  assert.deepEqual(result.selected_stages, ['local_static_checks', 'printing_foundation']);
  assert.equal(result.stage_plan.length, 2);
  assert.deepEqual(calls.map((call) => call.args[1]), ['compile', 'status']);
});

test('live visual QA selection requires the cleanup stage', () => {
  const calls = [];
  assert.throws(
    () =>
      runHeavyChainKernelEntrypoint(
        {
          manifestPath,
          runId: 'qa-contract',
          dryRun: true,
          selectedStages: ['live_production_route_visual_qa', 'live_production_cleanup_proof'],
        },
        { spawn: createSpawnStub(calls, { compileStages: ['live_production_route_visual_qa'] }) },
      ),
    (error) => error.exact_blocker === 'heavy_chain_live_visual_qa_not_supported_in_registered_entrypoint',
  );
});

test('non-dry runs generate unique run ids and resume keeps the supplied id', () => {
  const firstCalls = [];
  const first = runHeavyChainKernelEntrypoint(
    { manifestPath, runId: 'repeatable-run' },
    { spawn: createSpawnStub(firstCalls), now: () => 1000 },
  );
  const secondCalls = [];
  const second = runHeavyChainKernelEntrypoint(
    { manifestPath, runId: 'repeatable-run' },
    { spawn: createSpawnStub(secondCalls), now: () => 2000 },
  );
  const resumedCalls = [];
  const resumed = runHeavyChainKernelEntrypoint(
    { manifestPath, runId: 'repeatable-run', resume: true },
    { spawn: createSpawnStub(resumedCalls), now: () => 3000 },
  );

  assert.notEqual(first.run_id, second.run_id);
  assert.match(first.run_id, /^repeatable-run-\d+-\d+$/);
  assert.match(second.run_id, /^repeatable-run-\d+-\d+$/);
  assert.equal(resumed.run_id, 'repeatable-run');
  assert.equal(firstCalls[0].args[firstCalls[0].args.indexOf('--run-id') + 1], first.run_id);
  assert.equal(secondCalls[0].args[secondCalls[0].args.indexOf('--run-id') + 1], second.run_id);
  assert.equal(resumedCalls[0].args[resumedCalls[0].args.indexOf('--run-id') + 1], 'repeatable-run');
});

test('non-default manifest path is forwarded to kernel actions', () => {
  const { dir, file } = createManifestCopy();
  const calls = [];

  try {
    const result = runHeavyChainKernelEntrypoint(
      { manifestPath: file, runId: 'custom-manifest-run', resume: true },
      { spawn: createSpawnStub(calls) },
    );

    assert.equal(result.ok, true);
    for (const call of calls.slice(0, 10)) {
      if (call.command === process.execPath) {
        assert.equal(call.args[call.args.indexOf('--manifest') + 1], file);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('real entrypoint wires compile claim receipt result for internal checks', () => {
  const calls = [];
  const result = runHeavyChainKernelEntrypoint(
    { manifestPath, runId: 'full-run' },
    { spawn: createSpawnStub(calls) },
  );

  assert.equal(result.ok, true);
  assert.equal(result.terminal_status, 'succeeded');
  assert.equal(result.cleanup_proof, 'cleanup_proof:local_entrypoint_no_external_side_effects');
  assert.deepEqual(result.selected_stages, ['local_static_checks', 'printing_foundation']);
  assert.deepEqual(
    calls.map((call) => [call.command, call.args[1]]),
    [
      [process.execPath, 'compile'],
      [process.execPath, 'status'],
      [process.execPath, 'claim'],
      ['npm', 'typecheck'],
      ['npm', 'build'],
      [process.execPath, 'record'],
      [process.execPath, 'claim'],
      ['npm', 'test:printing-foundation'],
      [process.execPath, 'record'],
      [process.execPath, 'result'],
    ],
  );
});

test('live visual QA selection fails closed before claim or record', () => {
  const calls = [];
  assert.throws(
    () =>
      runHeavyChainKernelEntrypoint(
        {
          manifestPath,
          runId: 'live-qa-cleanup',
          selectedStages: ['live_production_route_visual_qa', 'live_production_cleanup_proof'],
        },
        {
          spawn: createSpawnStub(calls, {
            compileStages: ['live_production_route_visual_qa', 'live_production_cleanup_proof'],
          }),
        },
      ),
    (error) => error.exact_blocker === 'heavy_chain_live_visual_qa_not_supported_in_registered_entrypoint',
  );

  assert.deepEqual(calls.map((call) => [call.command, call.args[1]]), [[process.execPath, 'compile'], [process.execPath, 'status']]);
});

test('an unimplemented selected stage fails instead of producing a success receipt', () => {
  const calls = [];
  const result = runHeavyChainKernelEntrypoint(
    {
      manifestPath,
      runId: 'unimplemented-runway',
      resume: true,
      selectedStages: ['runway_mcp_generation'],
    },
    { spawn: createSpawnStub(calls, { compileStages: ['runway_mcp_generation'] }) },
  );

  assert.equal(result.terminal_status, 'failed');
  assert.equal(result.ok, false);
  assert.equal(resultExitCode(result), 1);
  assert.equal(result.exact_blocker, 'heavy_chain_stage_not_implemented:runway_mcp_generation');
  const record = calls.find((call) => call.command === process.execPath && call.args[1] === 'record');
  assert.ok(record);
  assert.equal(record.args[record.args.indexOf('--outcome') + 1], 'failed');
  assert.equal(
    record.args[record.args.indexOf('--exact-blocker') + 1],
    'heavy_chain_stage_not_implemented:runway_mcp_generation',
  );
});

test('an e2e skip marker fails even when the command exits zero', () => {
  const calls = [];
  const result = runHeavyChainKernelEntrypoint(
    {
      manifestPath,
      runId: 'e2e-skipped',
      resume: true,
      selectedStages: ['repo_playwright_e2e'],
    },
    { spawn: createSpawnStub(calls, { compileStages: ['repo_playwright_e2e'], skipE2e: true }) },
  );

  assert.equal(result.terminal_status, 'failed');
  assert.equal(result.ok, false);
  assert.equal(resultExitCode(result), 1);
  assert.equal(result.exact_blocker, 'repo_playwright_e2e_not_executed');
  const record = calls.find((call) => call.command === process.execPath && call.args[1] === 'record');
  assert.ok(record);
  assert.equal(record.args[record.args.indexOf('--exact-blocker') + 1], 'repo_playwright_e2e_not_executed');
});

test('CLI exit mapping only returns zero for a successful terminal result', () => {
  assert.equal(resultExitCode({ ok: true, terminal_status: 'succeeded' }), 0);
  assert.equal(resultExitCode({ ok: true, terminal_status: 'failed' }), 1);
  assert.equal(resultExitCode({ ok: false, terminal_status: 'failed' }), 1);
});
