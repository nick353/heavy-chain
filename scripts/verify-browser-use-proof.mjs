#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
let proofDir = 'output/release-prep/browser-use-20260617';
const expectations = {
  releaseDate: null,
  environment: null,
  gitCommit: null,
};
const parseFailures = [];

function requireValue(arg, next) {
  if (!next || next.startsWith('--')) {
    parseFailures.push(`${arg} requires a value`);
    return null;
  }
  return next;
}

function validReleaseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validReleaseEnvironment(value) {
  return /^(staging|prod|production|preview|development|local)$/.test(value);
}

function validGitCommit(value) {
  return /^[0-9a-fA-F]{40}$/.test(value);
}

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  const next = args[index + 1];
  if (arg === '--dir') {
    const value = requireValue(arg, next);
    if (value) {
      proofDir = value;
      index += 1;
    }
  } else if (arg === '--expect-release-date') {
    const value = requireValue(arg, next);
    if (value) {
      expectations.releaseDate = value;
      index += 1;
    }
  } else if (arg === '--expect-environment') {
    const value = requireValue(arg, next);
    if (value) {
      expectations.environment = value;
      index += 1;
    }
  } else if (arg === '--expect-git-commit') {
    const value = requireValue(arg, next);
    if (value) {
      expectations.gitCommit = value;
      index += 1;
    }
  } else if (arg.startsWith('--')) {
    parseFailures.push(`unknown argument ${arg}`);
  }
}

if (expectations.releaseDate && !validReleaseDate(expectations.releaseDate)) {
  parseFailures.push('--expect-release-date must be YYYY-MM-DD');
}
if (expectations.environment && !validReleaseEnvironment(expectations.environment)) {
  parseFailures.push('--expect-environment is invalid');
}
if (expectations.gitCommit && !validGitCommit(expectations.gitCommit)) {
  parseFailures.push('--expect-git-commit must be a 40 character hex commit');
}

const files = {
  homeEval: join(proofDir, 'home-env-eval.json'),
  homeState: join(proofDir, 'home-env-state.txt'),
  homePng: join(proofDir, 'home-env-full.png'),
  loginEval: join(proofDir, 'login-eval.json'),
  loginState: join(proofDir, 'login-state.txt'),
  loginPng: join(proofDir, 'login-full.png'),
};

const failures = [];

function addFailure(file, message) {
  failures.push(`${file}: ${message}`);
}

for (const failure of parseFailures) addFailure('cli', failure);

function readText(file) {
  if (!existsSync(file)) {
    addFailure(file, 'missing proof file');
    return '';
  }
  return readFileSync(file, 'utf8');
}

function parseBrowserUseJson(file) {
  const raw = readText(file);
  if (!raw) return null;
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    addFailure(file, 'does not contain a JSON result object');
    return null;
  }

  try {
    return JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
  } catch {
    addFailure(file, 'invalid JSON result object');
    return null;
  }
}

function fileExistsNonEmpty(file) {
  if (!existsSync(file)) {
    addFailure(file, 'missing proof file');
    return false;
  }
  const size = readFileSync(file).byteLength;
  if (size === 0) {
    addFailure(file, 'proof file is empty');
    return false;
  }
  return true;
}

function byteEntropy(bytes) {
  if (bytes.length === 0) return 0;

  const counts = new Map();
  for (const byte of bytes) counts.set(byte, (counts.get(byte) || 0) + 1);

  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / bytes.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function verifyPng(file) {
  if (!fileExistsNonEmpty(file)) return;

  const buffer = readFileSync(file);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) {
    addFailure(file, 'invalid PNG signature');
    return;
  }

  const ihdrLength = buffer.readUInt32BE(8);
  const ihdrType = buffer.subarray(12, 16).toString('ascii');
  if (ihdrLength !== 13 || ihdrType !== 'IHDR') {
    addFailure(file, 'missing PNG IHDR header');
    return;
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 100 || height < 100) {
    addFailure(file, `PNG dimensions are too small (${width}x${height})`);
  }

  const idatChunks = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const nextOffset = dataEnd + 4;
    if (dataEnd > buffer.length || nextOffset > buffer.length) {
      addFailure(file, 'PNG chunk length is invalid');
      return;
    }
    if (type === 'IDAT') idatChunks.push(buffer.subarray(dataStart, dataEnd));
    offset = nextOffset;
    if (type === 'IEND') break;
  }

  const imageData = Buffer.concat(idatChunks);
  const uniqueBytes = new Set(imageData).size;
  if (imageData.length < 128 || uniqueBytes < 16 || byteEntropy(imageData) < 2) {
    addFailure(file, 'PNG image data entropy is too low');
  }
}

function hasText(values, pattern) {
  return (values || []).some((value) => pattern.test(String(value)));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function expectsMetadata() {
  return Boolean(expectations.releaseDate || expectations.environment || expectations.gitCommit);
}

function hasValidCapturedAt(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function validateMetadata(file, json) {
  if (!expectsMetadata() || !json) return;

  const metadata = json.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    addFailure(file, 'metadata is missing');
    return;
  }

  if (!isNonEmptyString(metadata.release_date)) addFailure(file, 'metadata.release_date is missing');
  if (!isNonEmptyString(metadata.environment)) addFailure(file, 'metadata.environment is missing');
  if (!isNonEmptyString(metadata.git_commit)) addFailure(file, 'metadata.git_commit is missing');
  if (expectations.releaseDate && metadata.release_date !== expectations.releaseDate) {
    addFailure(file, `metadata.release_date does not match ${expectations.releaseDate}`);
  }
  if (expectations.environment && metadata.environment !== expectations.environment) {
    addFailure(file, `metadata.environment does not match ${expectations.environment}`);
  }
  if (expectations.gitCommit && metadata.git_commit !== expectations.gitCommit) {
    addFailure(file, `metadata.git_commit does not match ${expectations.gitCommit}`);
  }
  if (!hasValidCapturedAt(metadata.captured_at)) {
    addFailure(file, 'metadata.captured_at is missing or invalid');
  }
}

const homeEval = parseBrowserUseJson(files.homeEval);
const loginEval = parseBrowserUseJson(files.loginEval);
const homeState = readText(files.homeState);
const loginState = readText(files.loginState);
verifyPng(files.homePng);
verifyPng(files.loginPng);
validateMetadata(files.homeEval, homeEval);
validateMetadata(files.loginEval, loginEval);

if (homeEval) {
  if (homeEval.rootNonEmpty !== true) addFailure(files.homeEval, 'rootNonEmpty is not true');
  if (!/^https?:\/\/127\.0\.0\.1:\d+\/?$/.test(homeEval.url || '')) {
    addFailure(files.homeEval, 'home proof is not a local env-injected root URL');
  }
  if (!hasText(homeEval.buttons, /ログイン|無料|始める|作成/)) {
    addFailure(files.homeEval, 'home proof has no visible login/signup path');
  }
  const links = homeEval.links || [];
  const hasLoginLink = links.some((link) => /ログイン/.test(link.text || '') && /\/login$/.test(link.href || ''));
  const hasSignupLink = links.some((link) => /無料|新規|作成|始める/.test(link.text || '') && /\/signup$/.test(link.href || ''));
  if (!hasLoginLink) addFailure(files.homeEval, 'home proof has no /login route');
  if (!hasSignupLink) addFailure(files.homeEval, 'home proof has no /signup route');
}

if (loginEval) {
  if (!/\/login$/.test(loginEval.url || '')) addFailure(files.loginEval, 'login proof is not on /login');
  if (!hasText(loginEval.buttons, /Googleでログイン/)) addFailure(files.loginEval, 'Google login path is missing');
  if (!hasText(loginEval.buttons, /Appleでログイン/)) addFailure(files.loginEval, 'Apple login path is missing');
  if (!hasText(loginEval.buttons, /^ログイン$/)) addFailure(files.loginEval, 'email login submit path is missing');

  const inputs = loginEval.inputs || [];
  if (!inputs.some((input) => input.type === 'email' || input.autocomplete === 'email')) {
    addFailure(files.loginEval, 'email input is missing');
  }
  if (!inputs.some((input) => input.type === 'password' || input.autocomplete === 'current-password')) {
    addFailure(files.loginEval, 'password input is missing');
  }
}

if (!/AIで自動生成|アパレル画像/.test(homeState)) {
  addFailure(files.homeState, 'home state does not show rendered product copy');
}

if (!/Googleでログイン/.test(loginState) || !/Appleでログイン/.test(loginState)) {
  addFailure(files.loginState, 'login state does not show external auth paths');
}

if (!/placeholder=your@email\.com/.test(loginState) || !/type=password/.test(loginState)) {
  addFailure(files.loginState, 'login state does not show email and password fields');
}

if (/value=|@example\.com|signed in|dashboard|ログアウト|生成する/.test(loginState)) {
  addFailure(files.loginState, 'login proof is not view-only; it appears to include entered or authenticated state');
}

if (failures.length > 0) {
  console.error('Browser Use proof verification failed. Secret values were not printed.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Browser Use proof verification passed. Secret values were not printed.');
