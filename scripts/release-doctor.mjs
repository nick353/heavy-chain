#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const checks = [
  {
    name: 'git clean',
    command: 'git',
    args: ['status', '--short'],
    stop: '作業ツリーに未コミット変更があります。',
    next: '`git status --short` を見て、必要な変更だけをコミットまたは退避してください。',
    validate: ({ stdout }) => stdout.trim().length === 0,
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
    name: 'verify:browser-use',
    command: 'npm',
    args: ['run', 'verify:browser-use', '--silent'],
    stop: 'Browser Use の画面証跡が足りないか壊れています。',
    next: 'env-injected の view-only 画面証跡を取り直し、保存先のファイルを確認してください。',
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
  [/(service_role[_-]?(?:key)?[=:]\s*)\S+/gi, '$1[redacted]'],
  [/((?:SUPABASE|OPENAI|GEMINI|PUBLIC|VITE)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|URL)?[=:]\s*)\S+/g, '$1[redacted]'],
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
console.log('');

const results = checks.map(runCheck);

for (const result of results) {
  console.log(`${result.passed ? 'OK  ' : 'STOP'} ${result.name}`);
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
console.log('Secret values were not printed.');
process.exit(1);
