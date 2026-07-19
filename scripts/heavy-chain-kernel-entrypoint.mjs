#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = '/Users/nichikatanaka/Documents/Codex/external-repos/heavy-chain';
const MANIFEST = '/Users/nichikatanaka/Documents/Codex/external-repos/heavy-chain/.codex/automation-kernel/manifests/heavy-chain.json';
const KERNEL_RUN = '/Users/nichikatanaka/.codex/skills/automation-kernel-run/scripts/kernel-run.mjs';
const DEFAULT_RUN_ID = 'heavy-chain-entrypoint';

const STAGE_COMMANDS = {
  local_static_checks: [
    { id: 'typecheck', command: ['npm', 'run', 'typecheck'] },
    { id: 'build', command: ['npm', 'run', 'build'] },
  ],
  printing_foundation: [
    { id: 'printing_foundation', command: ['npm', 'run', 'test:printing-foundation'] },
  ],
  repo_playwright_e2e: [
    { id: 'repo_playwright_e2e', command: ['npm', 'run', 'e2e'] },
  ],
  release_readback_gate: [
    { id: 'release_readback_gate', command: ['npm', 'run', 'verify:release-gate'] },
  ],
};

function parseArgs(argv) {
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`automation_kernel_entrypoint_argument_invalid:${arg}`);
    const separator = arg.indexOf('=');
    if (separator > 2) {
      flags.set(arg.slice(2, separator), arg.slice(separator + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.set(arg.slice(2), 'true');
      continue;
    }
    flags.set(arg.slice(2), next);
    index += 1;
  }
  return {
    manifestPath: flags.get('manifest') || MANIFEST,
    runId: flags.get('run-id') || DEFAULT_RUN_ID,
    selectedStages: String(flags.get('selected-stages') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    dryRun: flags.get('dry-run') === 'true',
    resume: flags.get('resume') === 'true',
  };
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function runKernelAction(action, args, { spawn = spawnSync } = {}) {
  const result = spawn(process.execPath, [KERNEL_RUN, action, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const stdout = String(result.stdout || '').trim();
  let payload = null;
  if (stdout) {
    try {
      payload = JSON.parse(stdout);
    } catch (error) {
      throw exactError('heavy_chain_kernel_action_response_invalid', { action, stdout: stdout.slice(-2000), message: error.message });
    }
  }
  if (result.error || result.status !== 0 || !payload || payload.ok !== true) {
    throw exactError(
      String(payload?.exact_blocker || result.error?.message || `heavy_chain_kernel_action_failed:${action}`),
      {
        action,
        status: result.status,
        stderr: String(result.stderr || '').slice(-2000),
      },
    );
  }
  return payload;
}

function runCommand(command, { spawn = spawnSync } = {}) {
  const [file, ...args] = command;
  const result = spawn(file, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    command: [file, ...args],
    status: result.status ?? 1,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    ok: !result.error && (result.status ?? 1) === 0,
  };
}

function commandReportedSkipped(stageId, result) {
  if (stageId !== 'repo_playwright_e2e') return false;
  const output = `${result.stdout}\n${result.stderr}`;
  return /\bSkipping e2e run\b|\bPlaywright[^\n]*not installed\b/iu.test(output);
}

function exactError(code, evidence = {}) {
  const error = new Error(code);
  error.exact_blocker = code;
  error.evidence = evidence;
  return error;
}

function getSelectedStageIds(manifest, compiled) {
  const explicit = compiled.stage_order && compiled.stage_order.length > 0 ? compiled.stage_order : [];
  if (explicit.length > 0) return explicit;
  const required = Array.isArray(manifest.stages) ? manifest.stages.filter((stage) => stage.required).map((stage) => stage.id) : [];
  if (required.length === 0) throw exactError('heavy_chain_kernel_required_stages_missing');
  return required;
}

function ensureLiveVisualQaSupportedOrFailClosed(selectedStages) {
  const liveStages = selectedStages.filter((stageId) =>
    stageId === 'live_production_route_visual_qa' || stageId === 'live_production_cleanup_proof');
  if (liveStages.length > 0) {
    throw exactError('heavy_chain_live_visual_qa_not_supported_in_registered_entrypoint', {
      selected_stages: liveStages,
      required_capability: 'signed_chrome_extension_profile2',
      note: 'live visual QA is fail-closed until a real signed Chrome capability is wired',
    });
  }
}

function plannedStageCommands(manifest, selectedStages) {
  const stagesById = new Map(manifest.stages.map((stage) => [stage.id, stage]));
  return selectedStages.map((stageId) => {
    const stage = stagesById.get(stageId);
    const commands = STAGE_COMMANDS[stageId] || [];
    return {
      stageId,
      required: stage?.required === true,
      needsChrome: stage?.needs_chrome === true,
      commands: commands.map((entry) => entry.command),
    };
  });
}

function hasAlwaysRunStageRemaining(manifest, selectedStages, currentIndex) {
  const stagesById = new Map(manifest.stages.map((stage) => [stage.id, stage]));
  return selectedStages.slice(currentIndex + 1).some((stageId) => stagesById.get(stageId)?.always_run === true);
}

function writeTempJson(prefix, payload) {
  const dir = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  const file = path.join(dir, 'payload.json');
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return { dir, file };
}

export function runHeavyChainKernelEntrypoint({
  manifestPath = MANIFEST,
  runId = DEFAULT_RUN_ID,
  dryRun = false,
  resume = false,
  selectedStages: explicitSelectedStages = [],
} = {}, deps = {}) {
  if (!path.isAbsolute(manifestPath)) throw exactError('heavy_chain_manifest_path_not_absolute');
  const now = typeof deps.now === 'function' ? deps.now : Date.now;
  const effectiveRunId = resume ? runId : `${runId}-${process.pid}-${now()}`;
  const manifest = readJson(manifestPath);
  const selectedStages = explicitSelectedStages.length > 0 ? explicitSelectedStages : undefined;
  const compileArgs = ['--manifest', manifestPath, '--run-id', effectiveRunId];
  if (selectedStages?.length) compileArgs.push('--selected-stages', selectedStages.join(','));
  const compile = runKernelAction('compile', compileArgs, deps);
  const status = runKernelAction('status', compileArgs, deps);
  const compiledStages = getSelectedStageIds(manifest, compile);
  ensureLiveVisualQaSupportedOrFailClosed(compiledStages);

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      workflow_id: compile.workflow_id,
      run_id: compile.run_id,
      kernel_id: compile.kernel_id,
      manifest_sha256: compile.manifest_sha256,
      selected_stages: compiledStages,
      stage_plan: plannedStageCommands(manifest, compiledStages),
      snapshot: status.snapshot,
      external_action_executed: false,
    };
  }

  const stageResults = [];
  const artifactUris = [];
  let exactBlocker = null;
  let restartStage = null;
  let cleanupProof = null;
  let ranAlwaysRunCleanupAfterFailure = false;
  const stagesById = new Map(manifest.stages.map((stage) => [stage.id, stage]));

  for (const stageId of compiledStages) {
    const stageIndex = compiledStages.indexOf(stageId);
    const stage = stagesById.get(stageId);
    if (exactBlocker && stage?.always_run !== true) break;
    const commands = STAGE_COMMANDS[stageId] || [];
    const claim = runKernelAction('claim', ['--manifest', manifestPath, '--run-id', effectiveRunId, '--effect-id', stageId], deps);
    const commandResults = [];
    let outcome = 'succeeded';
    let commandExactBlocker = null;
    let summary = `${stageId}:succeeded`;

    if (stage?.always_run === true) {
      summary = `${stageId}:cleanup_recorded`;
      cleanupProof = `cleanup_proof:${stageId}:recorded`;
      if (exactBlocker) ranAlwaysRunCleanupAfterFailure = true;
    } else {
      if (commands.length === 0) {
        outcome = 'failed';
        commandExactBlocker = `heavy_chain_stage_not_implemented:${stageId}`;
        summary = `${stageId}:not_implemented`;
        exactBlocker = exactBlocker || commandExactBlocker;
        restartStage = restartStage || stageId;
      } else {
        for (const command of commands) {
          const commandResult = runCommand(command.command, deps);
          commandResults.push(commandResult);
          const reportedSkipped = commandReportedSkipped(stageId, commandResult);
          if (!commandResult.ok || reportedSkipped) {
            outcome = 'failed';
            commandExactBlocker = reportedSkipped
              ? 'repo_playwright_e2e_not_executed'
              : `heavy_chain_stage_command_failed:${stageId}:${command.id}`;
            summary = reportedSkipped
              ? `${stageId}:not_executed`
              : `${stageId}:failed:${command.id}`;
            exactBlocker = exactBlocker || commandExactBlocker;
            restartStage = restartStage || stageId;
            break;
          }
        }
      }
      if (stage?.needs_chrome && outcome === 'succeeded') {
        outcome = 'failed';
        commandExactBlocker = `heavy_chain_stage_not_implemented:${stageId}`;
        summary = `${stageId}:not_implemented`;
        exactBlocker = exactBlocker || commandExactBlocker;
        restartStage = restartStage || stageId;
      }
    }

    const evidencePayload = {
      stage_id: stageId,
      commands: commandResults,
      selected_stages: compiledStages,
      dry_run: false,
      manifest_sha256: compile.manifest_sha256,
      ...(commandExactBlocker ? { exact_blocker: commandExactBlocker } : {}),
    };
    const evidenceArtifact = writeTempJson(`heavy-chain-${runId}-${stageId}`, evidencePayload);
    const recordArgs = [
      '--manifest', manifestPath,
      '--run-id', effectiveRunId,
      '--effect-id', stageId,
      '--outcome', outcome,
      '--external-action-executed', 'false',
      '--summary', summary.slice(0, 240),
      '--evidence-file', evidenceArtifact.file,
      '--stage-terminal', 'true',
    ];
    if (commandExactBlocker) recordArgs.push('--exact-blocker', commandExactBlocker);
    const record = runKernelAction('record', recordArgs, deps);
    artifactUris.push(record.artifact_path || evidenceArtifact.file);
    const claimEffect = Array.isArray(claim.snapshot?.effects)
      ? claim.snapshot.effects.find((effect) => effect.effect_id === stageId)
      : null;
    const receiptEffect = Array.isArray(record.snapshot?.effects)
      ? record.snapshot.effects.find((effect) => effect.effect_id === stageId)
      : null;
    stageResults.push({
      stage_id: stageId,
      status: outcome === 'succeeded' ? 'succeeded' : 'failed',
      exact_blocker: outcome === 'succeeded' ? null : commandExactBlocker,
      artifact_uris: [],
      cleanup_proof: stage?.always_run === true ? cleanupProof : null,
      claim_id: claimEffect?.claim_id || null,
      receipt_id: receiptEffect?.receipt_id || null,
      proof_uri: null,
      details: {},
    });
    rmSync(evidenceArtifact.dir, { recursive: true, force: true });
    if (outcome !== 'succeeded' && !hasAlwaysRunStageRemaining(manifest, compiledStages, stageIndex)) break;
  }

  if (!cleanupProof) {
    cleanupProof = compiledStages.includes('live_production_route_visual_qa')
      ? 'cleanup_proof:live_visual_qa_and_browser_cleanup_not_executed_in_heavy_chain_entrypoint'
      : 'cleanup_proof:local_entrypoint_no_external_side_effects';
  }

  const terminalStatus = exactBlocker
    ? (ranAlwaysRunCleanupAfterFailure ? 'blocked' : 'failed')
    : 'succeeded';
  if (terminalStatus === 'succeeded') {
    exactBlocker = null;
    restartStage = null;
  }

  const result = {
    schema: 'automation_kernel_result.v2',
    workflow_id: compile.workflow_id,
    run_id: compile.run_id,
    terminal_status: terminalStatus,
    selected_stages: stageResults.map((stage) => stage.stage_id),
    stage_results: stageResults,
    exact_blocker: exactBlocker,
    restart_stage: restartStage,
    artifact_uris: [],
    cleanup_proof: cleanupProof,
  };
  const resultArtifact = writeTempJson(`heavy-chain-${runId}-result`, result);
  const validated = runKernelAction('result', [
    '--manifest', manifestPath,
    '--run-id', effectiveRunId,
    '--result-file', resultArtifact.file,
  ], deps);
  rmSync(resultArtifact.dir, { recursive: true, force: true });
  return {
    ok: terminalStatus === 'succeeded',
    dry_run: false,
    workflow_id: validated.workflow_id,
    run_id: validated.run_id,
    kernel_id: compile.kernel_id,
    manifest_sha256: compile.manifest_sha256,
    selected_stages: result.selected_stages,
    stage_results: result.stage_results,
    terminal_status: result.terminal_status,
    exact_blocker: result.exact_blocker,
    restart_stage: result.restart_stage,
    cleanup_proof: result.cleanup_proof,
    result_artifact: validated.artifact_path || resultArtifact.file,
    external_action_executed: false,
  };
}

export function resultExitCode(result) {
  return result?.ok === true && result?.terminal_status === 'succeeded' ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    const result = runHeavyChainKernelEntrypoint(parsed);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = resultExitCode(result);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, exact_blocker: String(error?.exact_blocker || error?.message || 'heavy_chain_kernel_entrypoint_failed'), external_action_executed: false }, null, 2)}\n`);
    process.exit(1);
  }
}
