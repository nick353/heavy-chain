#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { verifyCloudflareReleaseReadback } from './verify-cloudflare-release-readback.mjs';

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
const releaseChromePluginEvidence = process.env.RELEASE_CHROME_PLUGIN_EVIDENCE || '';
const releaseCompanionEvidence = process.env.RELEASE_COMPANION_EVIDENCE || '';
const releaseBrowserUseProofDirValid = releaseBrowserUseProofDir.trim().length > 0;
const releaseChromePluginEvidenceValid = releaseChromePluginEvidence.trim().length > 0;
const releaseCompanionEvidenceValid = releaseCompanionEvidence.trim().length > 0;
const releaseProofSurfaceCount =
  Number(releaseBrowserUseProofDirValid) +
  Number(releaseChromePluginEvidenceValid) +
  Number(releaseCompanionEvidenceValid);
const proofTargetValid =
  [releaseDate, releaseEnvironment, currentGitCommit].every((target) => target.valid) &&
  releaseProofSurfaceCount === 1;

const currentBrowserUseArgs = ['run', 'verify:browser-use', '--silent', '--', '--dir', releaseBrowserUseProofDir];
if (releaseDate.value) currentBrowserUseArgs.push('--expect-release-date', releaseDate.value);
if (releaseEnvironment.value) currentBrowserUseArgs.push('--expect-environment', releaseEnvironment.value);
if (currentGitCommit.value) currentBrowserUseArgs.push('--expect-git-commit', currentGitCommit.value);

const currentChromePluginArgs = ['run', 'verify:chrome-plugin-proof', '--silent', '--', '--evidence', releaseChromePluginEvidence];
if (releaseDate.value) currentChromePluginArgs.push('--expect-release-date', releaseDate.value);
if (releaseEnvironment.value) currentChromePluginArgs.push('--expect-environment', releaseEnvironment.value);
if (currentGitCommit.value) currentChromePluginArgs.push('--expect-git-commit', currentGitCommit.value);

const currentCompanionArgs = ['run', 'verify:companion-auth', '--silent', '--', '--evidence', releaseCompanionEvidence];

const releaseProofCheck = releaseChromePluginEvidenceValid
  ? {
      name: 'verify:chrome-plugin-proof',
      command: 'npm',
      args: currentChromePluginArgs,
      stop: 'Chrome Pluginのdated proof verifierは退役済みです（historical_chrome_plugin_proof_retired）。historical-onlyのためrelease proofとして受理できません。',
      next: 'このproof branchには自動の次アクションはありません。歴史的証跡はそのまま保持してください。',
    }
  : releaseCompanionEvidenceValid
    ? {
      name: 'verify:companion-auth',
      command: 'npm',
      args: currentCompanionArgs,
      stop: 'Companionの認証済みview-only UI証跡が足りないか壊れています。',
      next: '同一task-owned Companion tabでview-onlyの現行UI証跡を取り直し、RELEASE_COMPANION_EVIDENCEにサニタイズ済みJSONを指定してください。provider receipt/source sync/reconciliationは別ゲートです。',
    }
  : {
      name: 'verify:browser-use',
      command: 'npm',
      args: currentBrowserUseArgs,
      stop: 'Browser Useの画面証跡が足りないか壊れています。',
      next: 'env-injectedのview-only画面証跡を取り直し、RELEASE_BROWSER_USE_PROOF_DIRに保存先ディレクトリを指定してください。',
    };

const cloudflareReleaseReadbackContractPath =
  process.env.RELEASE_CLOUDFLARE_READBACK_CONTRACT || process.env.CLOUDFLARE_RELEASE_READBACK_CONTRACT || '';

const cloudflareReleaseReadbackContractCheck = () => {
  const missing = {
    name: 'cloudflare_release_readback_contract_missing',
    passed: false,
    status: 1,
    output: 'cloudflare_release_readback_contract_missing',
    stop: '現行Cloudflare release readback contractがありません（cloudflare_release_readback_contract_missing）。',
    next: '現行Cloudflare release readback contractと同一runのprovider receipt/readbackが正式に定義・検証可能になるまでreleaseを止めてください。Cloudflare runtime/H602の別チェックはこのblockerの代替ではありません。',
  };

  if (!cloudflareReleaseReadbackContractPath.trim()) return missing;

  let report;
  try {
    report = verifyCloudflareReleaseReadback({
      manifestPath: cloudflareReleaseReadbackContractPath,
      root: process.cwd(),
    });
  } catch {
    return missing;
  }
  if (report.contractValid === true) {
    return {
      name: 'cloudflare_release_readback_production_not_verified',
      passed: false,
      status: 1,
      output: 'cloudflare_release_readback_production_not_verified',
      stop: 'Cloudflare release readback contractはlocal-onlyで有効ですが、認証済みproduction readbackは未検証です（cloudflare_release_readback_production_not_verified）。',
      next: '認証済みproductionのprovider receiptとreadbackに正式なschema／validatorが実装され、同一runで検証可能になるまでreleaseを止めてください。',
    };
  }

  return {
    ...missing,
    output: `cloudflare_release_readback_contract_missing ${report.failures.join(' ')}`.trim(),
  };
};

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
    next: 'RELEASE_DATE は YYYY-MM-DD、RELEASE_ENVIRONMENT は staging/prod/production/preview/development/local、RELEASE_GIT_COMMIT は40桁 hex、RELEASE_BROWSER_USE_PROOF_DIR / RELEASE_CHROME_PLUGIN_EVIDENCE / RELEASE_COMPANION_EVIDENCE のいずれか一つだけを今回の証跡として指定してください。',
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
    name: 'cloudflare_release_readback_contract_missing',
    run: cloudflareReleaseReadbackContractCheck,
    stop: '現行Cloudflare release readback contractがありません（cloudflare_release_readback_contract_missing）。',
    next: '現行Cloudflare release readback contractと同一runのprovider receipt/readbackが正式に定義・検証可能になるまでreleaseを止めてください。Cloudflare runtime/H602の別チェックはこのblockerの代替ではありません。',
  },
  releaseProofCheck,
  {
    name: 'verify:cloudflare-runtime',
    command: 'npm',
    args: ['run', 'verify:cloudflare-runtime', '--silent'],
    stop: 'Cloudflare runtime contract が通っていません。',
    next: '現行Web/API/Auth sourceとCloudflare env contractの最初の失敗を修正してください。',
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
      ...result,
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
const selectedProofSurface = releaseChromePluginEvidenceValid
  ? 'chrome-plugin'
  : releaseCompanionEvidenceValid
    ? 'companion'
  : releaseBrowserUseProofDirValid
    ? 'browser-use'
    : releaseProofSurfaceCount > 1
      ? 'multiple'
      : 'missing';
console.log(
  `Current proof target: release_date=${releaseDate.display} environment=${releaseEnvironment.display} git_commit=${currentGitCommit.display} proof_surface=${selectedProofSurface}`,
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
