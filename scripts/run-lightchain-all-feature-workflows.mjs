#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const verifier = path.join(root, 'scripts/verify-lightchain-all-feature-workflows.mjs');
const forwardedArgs = process.argv.slice(2);
if (forwardedArgs.some((arg) => arg === '--dist-dir' || arg.startsWith('--dist-dir='))) {
  throw new Error('isolated_build_runner_owns_dist_dir');
}

const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'heavy-chain-lightchain-build-'));
const distDir = path.join(buildRoot, 'dist');
fs.mkdirSync(distDir);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const signal = result.signal ? `:${result.signal}` : '';
    throw new Error(`isolated_build_step_failed:${command}${signal}:${result.status}`);
  }
}

let exitCode = 1;
try {
  const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
  const vite = path.join(root, 'node_modules/vite/bin/vite.js');
  if (!fs.existsSync(tsc)) throw new Error(`typescript_binary_missing:${tsc}`);
  if (!fs.existsSync(vite)) throw new Error(`vite_binary_missing:${vite}`);

  run(process.execPath, [tsc, '-b']);
  run(process.execPath, [vite, 'build', '--outDir', distDir]);
  const verifierResult = spawnSync(process.execPath, [verifier, ...forwardedArgs, `--dist-dir=${distDir}`], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (verifierResult.error) throw verifierResult.error;
  exitCode = typeof verifierResult.status === 'number' ? verifierResult.status : 1;
} finally {
  fs.rmSync(buildRoot, { recursive: true, force: true });
}

process.exitCode = exitCode;
