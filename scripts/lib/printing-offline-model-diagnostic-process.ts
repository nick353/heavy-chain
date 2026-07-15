import { spawn } from 'node:child_process';
import { lstat, mkdir, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  assertOutputPathContained,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_BANNER_TEXT,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_FLAGS,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_HEIGHT,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_WIDTH,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_INPUT_NAME,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_OUTPUT_NAME,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_SHA256,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_SCHEMA_VERSION,
} from './printing-offline-model-diagnostic.ts';

const MAX_CAPTURE_BYTES = 1024 * 1024;
const PROCESS_GROUP_EXIT_WATCHDOG_MS = 2_000;

export class DiagnosticProcessCleanupNotEstablishedError extends Error {
  override readonly name = 'DiagnosticProcessCleanupNotEstablishedError';
}

export const isDiagnosticProcessCleanupNotEstablishedError = (error: unknown) => {
  if (error instanceof DiagnosticProcessCleanupNotEstablishedError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return message === 'CHILD_PROCESS_GROUP_STILL_ALIVE'
    || message === 'CHILD_PROCESS_GROUP_STILL_ALIVE_AFTER_NORMAL_EXIT'
    || message === 'CHILD_DID_NOT_EXIT_AFTER_SIGKILL';
};

export type HardTimedDiagnosticChildInput = Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  allowedRoot: string;
  stagingDirectory: string;
  outputDirectory: string;
  manifestPath: string;
  manifestDigestBefore: string;
  workerScriptPath: string;
  modelPath: string;
  caseCount: number;
  timeoutMs: number;
  killGraceMs: number;
  env?: NodeJS.ProcessEnv;
  errorReadbackContext?: Readonly<{
    schemaVersion: string;
    flags: Readonly<Record<string, boolean>>;
    bannerText: string;
  }>;
}>;

export type HardTimedDiagnosticChildResult = Readonly<{
  kind: 'exit' | 'timeout' | 'spawn-error';
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  sigtermSent: boolean;
  sigkillSent: boolean;
  processGroupGone: boolean;
  awaitedExitBeforeCleanup: boolean;
  stagingRemoved: boolean;
  stdout: string;
  stderr: string;
  outputFiles: readonly string[];
}>;

const assertPositiveTimeout = (value: number, code: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
};

const appendBounded = (current: string, chunk: Buffer) => {
  if (Buffer.byteLength(current) >= MAX_CAPTURE_BYTES) return current;
  const remaining = MAX_CAPTURE_BYTES - Buffer.byteLength(current);
  return current + chunk.subarray(0, remaining).toString('utf8');
};

const pathExists = async (candidate: string) => {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
};

const sendProcessGroupSignal = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
};

const isProcessGroupGone = (pid: number) => {
  try {
    process.kill(-pid, 0);
    return false;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return true;
    // macOS can briefly report EPERM for a dying process group after its
    // leader has been reaped. Treat it as still present and keep polling.
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') return false;
    throw error;
  }
};

const waitForProcessGroupGone = async (pid: number) => {
  const deadline = Date.now() + PROCESS_GROUP_EXIT_WATCHDOG_MS;
  while (Date.now() <= deadline) {
    if (isProcessGroupGone(pid)) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return false;
};

const publishErrorReadback = async (
  input: HardTimedDiagnosticChildInput,
  canonicalAllowedRoot: string,
  canonicalOutputDirectory: string,
  exactBlocker: string,
  errorMessage: string,
  processEvidence: Readonly<{
    exitCode: number | null;
    exitSignal: NodeJS.Signals | null;
    sigtermSent: boolean;
    sigkillSent: boolean;
    processGroupGone: boolean;
  }>,
) => {
  const outputParent = path.dirname(canonicalOutputDirectory);
  await mkdir(outputParent, { recursive: true });
  const temporaryCandidate = `${canonicalOutputDirectory}.error-${process.pid}-${Date.now()}`;
  const temporaryOutput = await assertOutputPathContained(canonicalAllowedRoot, temporaryCandidate);
  let renamed = false;
  try {
    await mkdir(temporaryOutput, { recursive: false });
    const diagnosticContext = input.errorReadbackContext ?? {
      schemaVersion: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_SCHEMA_VERSION,
      flags: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_FLAGS,
      bannerText: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_BANNER_TEXT,
    };
    const readbackBase = Object.freeze({
      schemaVersion: diagnosticContext.schemaVersion,
      status: 'error' as const,
      incomplete: true,
      generatedAt: new Date().toISOString(),
      outputDirectory: canonicalOutputDirectory,
      manifestPath: input.manifestPath,
      manifestDigestBefore: input.manifestDigestBefore,
      manifestDigestAfter: null,
      caseCount: input.caseCount,
      completedCaseCount: 0,
      finiteCaseCount: 0,
      error: errorMessage,
      exactBlocker,
      stage: 'worker' as const,
      flags: diagnosticContext.flags,
      bannerText: diagnosticContext.bannerText,
      ...diagnosticContext.flags,
      workerScriptPath: input.workerScriptPath,
      modelPath: input.modelPath,
      modelSha256: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_SHA256,
      modelInputName: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_INPUT_NAME,
      modelOutputName: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_OUTPUT_NAME,
      modelInputShape: [1, 3, PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_WIDTH, PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_HEIGHT] as const,
      modelOutputShape: [1, 1, PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_WIDTH, PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_HEIGHT] as const,
      processEvidence,
    });
    let totalOutputBytes = 0;
    let serialized = Buffer.alloc(0);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      serialized = Buffer.from(`${JSON.stringify({ ...readbackBase, totalOutputBytes }, null, 2)}\n`);
      if (serialized.length === totalOutputBytes) break;
      totalOutputBytes = serialized.length;
    }
    if (serialized.length !== totalOutputBytes) throw new Error('ERROR_READBACK_TOTAL_BYTES_DID_NOT_STABILIZE');
    await writeFile(path.join(temporaryOutput, 'readback.json'), serialized, { flag: 'wx' });
    await rename(temporaryOutput, canonicalOutputDirectory);
    renamed = true;
    return readdir(canonicalOutputDirectory);
  } finally {
    if (!renamed) await rm(temporaryOutput, { recursive: true, force: true });
  }
};

const preparePaths = async (input: HardTimedDiagnosticChildInput) => {
  if (process.platform === 'win32') throw new Error('PROCESS_GROUP_KILL_UNSUPPORTED');
  if (!path.isAbsolute(input.allowedRoot) || !path.isAbsolute(input.stagingDirectory) || !path.isAbsolute(input.outputDirectory)) {
    throw new Error('CHILD_OUTPUT_PATH_NOT_ABSOLUTE');
  }
  const stagingDirectory = await assertOutputPathContained(input.allowedRoot, input.stagingDirectory);
  const outputDirectory = await assertOutputPathContained(input.allowedRoot, input.outputDirectory);
  const allowedRoot = await realpath(input.allowedRoot);
  if (await pathExists(outputDirectory)) throw new Error('DIAGNOSTIC_OUTPUT_ALREADY_EXISTS');
  if (stagingDirectory === outputDirectory) throw new Error('DIAGNOSTIC_PATH_COLLISION');
  return { allowedRoot, stagingDirectory, outputDirectory };
};

/**
 * Runs an untrusted/non-cancellable inference child in a dedicated Unix
 * process group. The full group must be gone before cleanup and publication.
 */
export const runHardTimedDiagnosticChild = async (
  input: HardTimedDiagnosticChildInput,
): Promise<HardTimedDiagnosticChildResult> => {
  assertPositiveTimeout(input.timeoutMs, 'CHILD_TIMEOUT_INVALID');
  assertPositiveTimeout(input.killGraceMs, 'CHILD_KILL_GRACE_INVALID');
  const canonical = await preparePaths(input);

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let exited = false;
  let sigtermSent = false;
  let sigkillSent = false;
  let graceElapsed = false;
  let pendingTimedOutExit: { code: number | null; signal: NodeJS.Signals | null; spawnError: null } | null = null;
  let graceTimer: NodeJS.Timeout | undefined;
  let killWatchdog: NodeJS.Timeout | undefined;

  const child = spawn(input.command, [...input.args], {
    cwd: input.cwd,
    env: input.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    detached: true,
  });
  child.stdout.on('data', (chunk: Buffer) => {
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = appendBounded(stderr, chunk);
  });

  const exitResult = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    spawnError: Error | null;
  }>((resolve, reject) => {
    let settled = false;
    const settle = (value: { code: number | null; signal: NodeJS.Signals | null; spawnError: Error | null }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const deadlineTimer = setTimeout(() => {
      timedOut = true;
      if (!child.pid) {
        fail(new DiagnosticProcessCleanupNotEstablishedError('CHILD_PID_MISSING'));
        return;
      }
      try {
        sigtermSent = sendProcessGroupSignal(child.pid, 'SIGTERM');
      } catch (error) {
        fail(new DiagnosticProcessCleanupNotEstablishedError(`CHILD_PROCESS_GROUP_TERM_FAILED:${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      graceTimer = setTimeout(() => {
        graceElapsed = true;
        if (!child.pid) return;
        try {
          sigkillSent = sendProcessGroupSignal(child.pid, 'SIGKILL');
        } catch (error) {
          fail(new DiagnosticProcessCleanupNotEstablishedError(`CHILD_PROCESS_GROUP_KILL_FAILED:${error instanceof Error ? error.message : String(error)}`));
          return;
        }
        if (pendingTimedOutExit) {
          settle(pendingTimedOutExit);
        } else {
          killWatchdog = setTimeout(() => {
            if (!exited) fail(new DiagnosticProcessCleanupNotEstablishedError('CHILD_DID_NOT_EXIT_AFTER_SIGKILL'));
          }, PROCESS_GROUP_EXIT_WATCHDOG_MS);
        }
      }, input.killGraceMs);
    }, input.timeoutMs);

    child.once('error', (error) => {
      clearTimeout(deadlineTimer);
      if (graceTimer) clearTimeout(graceTimer);
      if (killWatchdog) clearTimeout(killWatchdog);
      settle({ code: null, signal: null, spawnError: error });
    });
    child.once('exit', (code, signal) => {
      exited = true;
      clearTimeout(deadlineTimer);
      const result = { code, signal, spawnError: null } as const;
      if (!timedOut) {
        if (graceTimer) clearTimeout(graceTimer);
        if (killWatchdog) clearTimeout(killWatchdog);
        settle(result);
        return;
      }
      pendingTimedOutExit = result;
      if (graceElapsed) {
        if (killWatchdog) clearTimeout(killWatchdog);
        settle(result);
      }
    });
  });

  if (exitResult.spawnError) {
    await rm(canonical.stagingDirectory, { recursive: true, force: true });
    const outputFiles = await publishErrorReadback(
      input,
      canonical.allowedRoot,
      canonical.outputDirectory,
      'OFFLINE_MODEL_DIAGNOSTIC_CHILD_SPAWN_FAILED',
      exitResult.spawnError.message,
      { exitCode: null, exitSignal: null, sigtermSent, sigkillSent, processGroupGone: true },
    );
    return Object.freeze({
      kind: 'spawn-error',
      exitCode: null,
      exitSignal: null,
      sigtermSent,
      sigkillSent,
      processGroupGone: true,
      awaitedExitBeforeCleanup: true,
      stagingRemoved: true,
      stdout,
      stderr,
      outputFiles: Object.freeze([...outputFiles].sort()),
    });
  }

  if (!timedOut) {
    let processGroupGone = true;
    try {
      processGroupGone = child.pid ? isProcessGroupGone(child.pid) : true;
      if (!processGroupGone && child.pid) {
        sigtermSent = sendProcessGroupSignal(child.pid, 'SIGTERM');
        await new Promise<void>((resolve) => setTimeout(resolve, input.killGraceMs));
        processGroupGone = isProcessGroupGone(child.pid);
        if (!processGroupGone) {
          sigkillSent = sendProcessGroupSignal(child.pid, 'SIGKILL');
          processGroupGone = await waitForProcessGroupGone(child.pid);
        }
        if (!processGroupGone) throw new DiagnosticProcessCleanupNotEstablishedError('CHILD_PROCESS_GROUP_STILL_ALIVE_AFTER_NORMAL_EXIT');
      }
    } catch (error) {
      if (isDiagnosticProcessCleanupNotEstablishedError(error)) throw error;
      throw new DiagnosticProcessCleanupNotEstablishedError(`CHILD_PROCESS_GROUP_CLEANUP_FAILED:${error instanceof Error ? error.message : String(error)}`);
    }
    return Object.freeze({
      kind: 'exit',
      exitCode: exitResult.code,
      exitSignal: exitResult.signal,
      sigtermSent,
      sigkillSent,
      processGroupGone,
      awaitedExitBeforeCleanup: true,
      stagingRemoved: false,
      stdout,
      stderr,
      outputFiles: Object.freeze([]),
    });
  }

  try {
    if (!child.pid || !(await waitForProcessGroupGone(child.pid))) {
      throw new DiagnosticProcessCleanupNotEstablishedError('CHILD_PROCESS_GROUP_STILL_ALIVE');
    }
  } catch (error) {
    if (isDiagnosticProcessCleanupNotEstablishedError(error)) throw error;
    throw new DiagnosticProcessCleanupNotEstablishedError(`CHILD_PROCESS_GROUP_CLEANUP_FAILED:${error instanceof Error ? error.message : String(error)}`);
  }
  await rm(canonical.stagingDirectory, { recursive: true, force: true });
  const outputFiles = await publishErrorReadback(
    input,
    canonical.allowedRoot,
    canonical.outputDirectory,
    'OFFLINE_MODEL_DIAGNOSTIC_CHILD_TIMEOUT',
    'Diagnostic child exceeded its hard deadline.',
    {
      exitCode: exitResult.code,
      exitSignal: exitResult.signal,
      sigtermSent,
      sigkillSent,
      processGroupGone: true,
    },
  );
  return Object.freeze({
    kind: 'timeout',
    exitCode: exitResult.code,
    exitSignal: exitResult.signal,
    sigtermSent,
    sigkillSent,
    processGroupGone: true,
    awaitedExitBeforeCleanup: true,
    stagingRemoved: true,
    stdout,
    stderr,
    outputFiles: Object.freeze([...outputFiles].sort()),
  });
};
