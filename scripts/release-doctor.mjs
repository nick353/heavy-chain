#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const releaseBlockersPath = 'docs/release-blockers-2026-06-18.json';
const acceptedBlockerStatuses = new Set(['resolved', 'accepted', 'waived']);

function gitCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  });

  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function latestReleaseEvidenceDate() {
  try {
    const dates = readdirSync('docs')
      .map((file) => /^release-evidence-(\d{4}-\d{2}-\d{2})\.md$/.exec(file)?.[1])
      .filter(Boolean)
      .sort();

    return dates.at(-1) || null;
  } catch {
    return null;
  }
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

function proofTargetValue(envName, fallback, validate) {
  const envValue = process.env[envName];
  const candidate = envValue || fallback;

  if (!candidate) return { value: null, display: 'unknown', valid: true };
  if (!validate(candidate)) return { value: null, display: 'invalid', valid: false };
  return { value: candidate, display: candidate, valid: true };
}

function blockerId(blocker, index) {
  return typeof blocker?.id === 'string' && blocker.id.trim() ? blocker.id.trim() : `blocker_${index + 1}`;
}

function blockerEvidence(blocker) {
  if (typeof blocker?.evidence === 'string') return blocker.evidence;
  if (Array.isArray(blocker?.evidence)) return blocker.evidence.filter((item) => typeof item === 'string').join(', ');
  return 'no evidence path';
}

function releaseBlockerGate() {
  try {
    const manifest = JSON.parse(readFileSync(releaseBlockersPath, 'utf8'));
    const blockers = Array.isArray(manifest) ? manifest : manifest.blockers;

    if (!Array.isArray(blockers)) {
      return {
        passed: false,
        status: 1,
        output: `${releaseBlockersPath}: blockers must be an array.`,
      };
    }

    const unresolved = blockers.filter((blocker) => {
      const status = typeof blocker?.status === 'string' ? blocker.status.trim().toLowerCase() : '';
      return blocker?.blocks_release === true && !acceptedBlockerStatuses.has(status);
    });

    return {
      passed: unresolved.length === 0,
      status: unresolved.length === 0 ? 0 : 1,
      output: unresolved
        .map((blocker, index) => {
          const status = typeof blocker?.status === 'string' ? blocker.status : 'unknown';
          return `${blockerId(blocker, index)} status=${status} evidence=${blockerEvidence(blocker)}`;
        })
        .join('\n'),
    };
  } catch (error) {
    return {
      passed: false,
      status: 1,
      output: `${releaseBlockersPath}: ${error.message}`,
    };
  }
}

const releaseDate = proofTargetValue('RELEASE_DATE', latestReleaseEvidenceDate(), validReleaseDate);
const releaseEnvironment = proofTargetValue('RELEASE_ENVIRONMENT', 'staging', validReleaseEnvironment);
const currentGitCommit = proofTargetValue('RELEASE_GIT_COMMIT', gitCommit(), validGitCommit);
const releaseBrowserUseProofDir = process.env.RELEASE_BROWSER_USE_PROOF_DIR || '';
const releaseBrowserUseProofDirValid = releaseBrowserUseProofDir.trim().length > 0;
const proofTargetValid =
  [releaseDate, releaseEnvironment, currentGitCommit].every((target) => target.valid) &&
  releaseBrowserUseProofDirValid;

const currentReadbackArgs = ['run', 'verify:readback', '--silent'];
if (releaseDate.value) currentReadbackArgs.push('--', '--expect-release-date', releaseDate.value);
if (releaseEnvironment.value) {
  if (!currentReadbackArgs.includes('--')) currentReadbackArgs.push('--');
  currentReadbackArgs.push('--expect-environment', releaseEnvironment.value);
}
if (currentGitCommit.value) {
  if (!currentReadbackArgs.includes('--')) currentReadbackArgs.push('--');
  currentReadbackArgs.push('--expect-git-commit', currentGitCommit.value);
}

const currentBrowserUseArgs = ['run', 'verify:browser-use', '--silent', '--', '--dir', releaseBrowserUseProofDir];
if (releaseDate.value) currentBrowserUseArgs.push('--expect-release-date', releaseDate.value);
if (releaseEnvironment.value) currentBrowserUseArgs.push('--expect-environment', releaseEnvironment.value);
if (currentGitCommit.value) currentBrowserUseArgs.push('--expect-git-commit', currentGitCommit.value);

const checks = [
  {
    name: 'release blockers',
    run: releaseBlockerGate,
    stop: '未解決の release blocker があります。',
    next: `${releaseBlockersPath} の blocks_release=true blocker を resolved / accepted / waived にできる状態になるまで release を止めてください。`,
  },
  {
    name: 'git clean',
    command: 'git',
    args: ['status', '--short'],
    stop: '作業ツリーに未コミット変更があります。',
    next: '`git status --short` を見て、必要な変更だけをコミットまたは退避してください。',
    validate: ({ stdout }) => stdout.trim().length === 0,
  },
  {
    name: 'proof target',
    command: 'node',
    args: ['-e', 'process.exit(0)'],
    stop: 'release proof target の override 値が不正です。',
    next: 'RELEASE_DATE は YYYY-MM-DD、RELEASE_ENVIRONMENT は staging/prod/production/preview/development/local、RELEASE_GIT_COMMIT は40桁 hex、RELEASE_BROWSER_USE_PROOF_DIR は今回の Browser Use 証跡ディレクトリを指定してください。',
    validate: () => proofTargetValid,
  },
  {
    name: 'env:check',
    command: 'npm',
    args: ['run', 'env:check', '--silent'],
    stop: '必要な環境変数が足りません。',
    next: '`scripts/check-env.mjs` の名前を見て、値は表示せずローカル環境に読み込んでください。',
  },
  {
    name: 'verify:readback',
    command: 'npm',
    args: ['run', 'verify:readback', '--silent'],
    stop: '保存済み readback 証跡が足りないか壊れています。',
    next: '失敗行の proof file を直すか、read-only readback 証跡を取り直してください。',
  },
  {
    name: 'verify:readback:current',
    command: 'npm',
    args: currentReadbackArgs,
    stop: 'readback 証跡が現在の release date / environment / git commit と一致していません。',
    next: 'staging の read-only readback を取り直し、各 JSON に release_date / environment / git_commit / captured_at を入れてください。',
  },
  {
    name: 'verify:browser-use',
    command: 'npm',
    args: currentBrowserUseArgs,
    stop: 'Browser Use の画面証跡が足りないか壊れています。',
    next: 'env-injected の view-only 画面証跡を取り直し、RELEASE_BROWSER_USE_PROOF_DIR に保存先ディレクトリを指定してください。',
  },
  {
    name: 'supabase:verify:static',
    command: 'npm',
    args: ['run', 'supabase:verify:static', '--silent'],
    stop: 'Supabase の静的ガードが通っていません。',
    next: '出力された migration/function の静的チェック箇所を修正してください。DB 接続は不要です。',
  },
  {
    name: 'security:audit',
    command: 'npm',
    args: ['run', 'security:audit', '--silent'],
    stop: 'セキュリティ監査で危険な文字列または保存形式が見つかりました。',
    next: '指摘されたファイルから secret らしい値や危険な image_url 永続化を取り除いてください。',
  },
  {
    name: 'verify:g606-performance',
    command: 'npm',
    args: ['run', 'verify:g606-performance', '--silent'],
    stop: 'G606 performance / scale baseline が通っていません。',
    next: '`output/playwright/10m-product-readiness-g606/summary.json` の issues、previewLogs、debug screenshot を見て、Gallery/Canvas/route/bundle の失敗原因を修正してください。',
  },
  {
    name: 'verify:generation-scorecard',
    command: 'npm',
    args: ['run', 'verify:generation-scorecard', '--silent'],
    stop: '生成品質 scorecard の証跡が足りないか、readback と成果物画像が対応していません。',
    next: 'primary/polish の visual-scorecard と readback-after-worker を取り直し、各画像が対応する job id の成果物であることを確認してください。',
  },
  {
    name: 'smoke:edge',
    command: 'npm',
    args: ['run', 'smoke:edge', '--silent'],
    stop: 'Edge Function のローカル静的 smoke が通っていません。',
    next: '不足している quota/observability guard を指摘された function に追加してください。',
  },
  {
    name: 'typecheck',
    command: 'npm',
    args: ['run', 'typecheck', '--silent'],
    stop: 'TypeScript の型チェックが通っていません。',
    next: '最初の TypeScript エラーを直してから、もう一度 doctor を実行してください。',
  },
  {
    name: 'lint',
    command: 'npm',
    args: ['run', 'lint', '--silent'],
    stop: 'Lint が通っていません。',
    next: '最初の lint エラーを直してから、もう一度 doctor を実行してください。',
  },
];

const secretReplacements = [
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[redacted]'],
  [/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]'],
  [/AIza[0-9A-Za-z_-]{12,}/g, '[redacted]'],
  [/(service_role[_-]?(?:key)?\s*[=:]\s*)\S+/gi, '$1[redacted]'],
  [/((?:SUPABASE|OPENAI|GEMINI|PUBLIC|VITE)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|URL)?\s*[=:]\s*)\S+/gi, '$1[redacted]'],
  [
    /((?:"(?:PASSWORD|TOKEN|SECRET|KEY|API_KEY|ACCESS_TOKEN|AUTH_TOKEN|DATABASE_URL|DB_URL|JWT_SECRET|[A-Z0-9_]+_(?:PASSWORD|TOKEN|SECRET|KEY))"|'(?:PASSWORD|TOKEN|SECRET|KEY|API_KEY|ACCESS_TOKEN|AUTH_TOKEN|DATABASE_URL|DB_URL|JWT_SECRET|[A-Z0-9_]+_(?:PASSWORD|TOKEN|SECRET|KEY))'|\b(?:PASSWORD|TOKEN|SECRET|KEY|API_KEY|ACCESS_TOKEN|AUTH_TOKEN|DATABASE_URL|DB_URL|JWT_SECRET|[A-Z0-9_]+_(?:PASSWORD|TOKEN|SECRET|KEY))\b)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,}\]]+)/gi,
    (_, prefix, value) => {
      const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : '';
      return `${prefix}${quote}[redacted]${quote}`;
    },
  ],
];

function redact(text) {
  return secretReplacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
}

function relevantLines(text) {
  const lines = redact(text)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  return lines.slice(-6);
}

function runCheck(check) {
  if (check.run) {
    const result = check.run();
    return {
      ...check,
      passed: result.passed === true,
      status: result.status ?? (result.passed ? 0 : 1),
      error: result.error,
      output: result.output || '',
    };
  }

  const result = spawnSync(check.command, check.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    shell: false,
  });

  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const passed =
    result.error === undefined &&
    result.status === 0 &&
    (check.validate ? check.validate({ stdout: result.stdout || '', stderr: result.stderr || '' }) : true);

  return {
    ...check,
    passed,
    status: result.status,
    error: result.error,
    output,
  };
}

console.log('Release doctor: read-only/local checks only.');
console.log('禁止: send / submit / publish / delete / auth / payment / PII / DB mutation / deploy');
console.log(
  `Current proof target: release_date=${releaseDate.display} environment=${releaseEnvironment.display} git_commit=${currentGitCommit.display} browser_use_proof_dir=${releaseBrowserUseProofDir || 'missing'}`,
);
console.log('');

const results = [];

for (const check of checks) {
  const result = runCheck(check);
  results.push(result);
  console.log(`${result.passed ? 'OK  ' : 'STOP'} ${result.name}`);
  if (!result.passed) break;
}

const firstStop = results.find((result) => !result.passed);

if (!firstStop) {
  console.log('');
  console.log('OK: release readiness の安全診断は通りました。');
  console.log('次: human owner が最終証跡を確認してください。doctor は公開承認ではありません。');
  process.exit(0);
}

console.log('');
console.log(`First STOP: ${firstStop.name}`);
console.log(`Why: ${firstStop.stop}`);
console.log(`Next action: ${firstStop.next}`);

const lines = relevantLines(firstStop.output);
if (lines.length > 0) {
  console.log('');
  console.log('Safe output tail:');
  for (const line of lines) console.log(`- ${line}`);
}

if (firstStop.error) {
  console.log('');
  console.log(`Runner error: ${redact(firstStop.error.message)}`);
}

console.log('');
console.log('Known secret patterns were redacted from the displayed output.');
process.exit(1);
