#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const verifier = 'scripts/verify-browser-use-proof.mjs';
const historicalProofDir = 'output/release-prep/browser-use-20260617';
const expected = {
  releaseDate: '2026-06-18',
  environment: 'staging',
  gitCommit: '0000000000000000000000000000000000000000',
};

let failures = 0;

function runVerifier(args = []) {
  return spawnSync(process.execPath, [verifier, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
}

function outputFor(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function assertCase(name, condition, details = '') {
  if (condition) {
    console.log(`ok - ${name}`);
    return;
  }

  failures += 1;
  console.error(`not ok - ${name}`);
  if (details) console.error(details.trim());
}

function expectExit(name, result, code) {
  assertCase(
    `${name} exits ${code}`,
    result.status === code,
    `expected ${code}, got ${result.status}\n${outputFor(result)}`,
  );
}

function expectOutput(name, result, pattern) {
  assertCase(`${name} output matches ${pattern}`, pattern.test(outputFor(result)), outputFor(result));
}

function parseResultFile(file) {
  const raw = readFileSync(file, 'utf8');
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error(`${file} does not contain a JSON result object`);
  }
  return JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
}

function proofHashes(proofDir) {
  return Object.fromEntries(
    readdirSync(proofDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = join(proofDir, entry.name);
        const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
        return [entry.name, hash];
      })
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function hashesMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addMetadata(file, metadata) {
  const json = parseResultFile(file);
  json.metadata = metadata;
  writeFileSync(file, `result: ${JSON.stringify(json)}\n`);
}

const historicalProofPath = join(repoRoot, historicalProofDir);
const historicalHashesBefore = proofHashes(historicalProofPath);

const defaultPass = runVerifier();
expectExit('default historical proof', defaultPass, 0);
expectOutput('default historical proof', defaultPass, /Browser Use proof verification passed/);

const missingExpectValue = runVerifier(['--expect-release-date']);
expectExit('missing --expect value', missingExpectValue, 1);
expectOutput('missing --expect value', missingExpectValue, /cli: --expect-release-date requires a value/);

const chainedMissingExpectValue = runVerifier(['--expect-release-date', '--expect-environment', expected.environment]);
expectExit('chained missing --expect value', chainedMissingExpectValue, 1);
expectOutput(
  'chained missing --expect value preserves next flag',
  chainedMissingExpectValue,
  /cli: --expect-release-date requires a value/,
);
expectOutput(
  'chained missing --expect value still consumes following option',
  chainedMissingExpectValue,
  /metadata is missing/,
);

const unknownArg = runVerifier(['--unknown-browser-use-test-arg']);
expectExit('unknown -- argument', unknownArg, 1);
expectOutput('unknown -- argument', unknownArg, /cli: unknown argument --unknown-browser-use-test-arg/);

const invalidExpectationValues = runVerifier([
  '--expect-release-date',
  'banana',
  '--expect-environment',
  'mars',
  '--expect-git-commit',
  'not-a-commit',
]);
expectExit('invalid expectation values', invalidExpectationValues, 1);
expectOutput('invalid release date', invalidExpectationValues, /cli: --expect-release-date must be YYYY-MM-DD/);
expectOutput('invalid environment', invalidExpectationValues, /cli: --expect-environment is invalid/);
expectOutput('invalid git commit', invalidExpectationValues, /cli: --expect-git-commit must be a 40 character hex commit/);

const currentExpectationArgs = [
  '--dir',
  historicalProofDir,
  '--expect-release-date',
  expected.releaseDate,
  '--expect-environment',
  expected.environment,
  '--expect-git-commit',
  expected.gitCommit,
];

const historicalWithCurrentExpectations = runVerifier(currentExpectationArgs);
expectExit('historical proof with current expectations', historicalWithCurrentExpectations, 1);
expectOutput(
  'historical proof fails home metadata',
  historicalWithCurrentExpectations,
  /home-env-eval\.json: metadata is missing/,
);
expectOutput(
  'historical proof fails login metadata',
  historicalWithCurrentExpectations,
  /login-eval\.json: metadata is missing/,
);

let tempRoot = null;
try {
  tempRoot = mkdtempSync(join(tmpdir(), 'heavy-chain-browser-use-proof-'));
} catch (error) {
  failures += 1;
  console.error('not ok - temp dir creation');
  console.error(`temp dir creation failed: ${error.message}`);
}

try {
  if (tempRoot) {
    const tempProofDir = join(tempRoot, 'browser-use-proof');
    cpSync(historicalProofPath, tempProofDir, { recursive: true });

    const metadata = {
      release_date: expected.releaseDate,
      environment: expected.environment,
      git_commit: expected.gitCommit,
      captured_at: '2026-06-18T00:00:00.000Z',
    };

    addMetadata(join(tempProofDir, 'home-env-eval.json'), metadata);
    addMetadata(join(tempProofDir, 'login-eval.json'), metadata);

    const tempCopyWithMetadata = runVerifier([
      '--dir',
      tempProofDir,
      '--expect-release-date',
      expected.releaseDate,
      '--expect-environment',
      expected.environment,
      '--expect-git-commit',
      expected.gitCommit,
    ]);

    expectExit('temp copied proof with metadata', tempCopyWithMetadata, 0);
    expectOutput('temp copied proof with metadata', tempCopyWithMetadata, /Browser Use proof verification passed/);
  }
} catch (error) {
  failures += 1;
  console.error('not ok - temp copied proof with metadata');
  console.error(`temp proof workflow failed: ${error.message}`);
} finally {
  const historicalHashesAfter = proofHashes(historicalProofPath);
  assertCase('historical proof artifacts unchanged', hashesMatch(historicalHashesBefore, historicalHashesAfter));
  if (tempRoot) {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch (error) {
      failures += 1;
      console.error('not ok - temp cleanup');
      console.error(`temp cleanup failed: ${error.message}`);
    }
  }
}

if (failures > 0) {
  console.error(`${failures} regression check(s) failed.`);
  process.exit(1);
}

console.log('verify-browser-use-proof regression checks passed.');
