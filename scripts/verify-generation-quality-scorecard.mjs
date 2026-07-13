#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REQUIRED_AXES = [
  'promptAdherence',
  'apparelFidelity',
  'artifactSafety',
  'composition',
  'commercialUsefulness',
];

const FEATURE_REQUIREMENTS = {
  'campaign-image': ['product hero', 'chain'],
  'product-shots': ['ecommerce', 'product'],
  'model-matrix': ['model', 'garment'],
  'design-gacha': ['design'],
  'scene-coordinate': ['lookbook', 'scene'],
  'multilingual-banner': ['headline', 'text'],
  'remove-bg': ['cutout'],
  colorize: ['recolor'],
  upscale: ['detail'],
  variations: ['variation'],
};

const DEFAULT_SCORECARDS = [
  {
    name: 'primary',
    scorecard: 'output/playwright/hc-10m-real-generation-qa-20260626/visual-scorecard.json',
    readback: 'output/playwright/hc-10m-real-generation-qa-20260626/readback-after-worker.json',
    expectedFeatures: Object.keys(FEATURE_REQUIREMENTS),
  },
  {
    name: 'polish',
    scorecard: 'output/playwright/hc-generation-polish-20260626/visual-scorecard.json',
    readback: 'output/playwright/hc-generation-polish-20260626/readback-after-worker.json',
    expectedFeatures: ['variations', 'scene-coordinate', 'remove-bg', 'design-gacha'],
  },
  {
    name: 'g677-openai-mini-split-polish',
    scorecard: 'output/playwright/g677-openai-mini-low-cost-proof/visual-scorecard.json',
    readback: 'output/playwright/g677-openai-mini-low-cost-proof/readback-merged-before-cleanup.json',
    expectedFeatures: Object.keys(FEATURE_REQUIREMENTS),
  },
];

const DECISION_VALUES = new Set(['Pass', 'Needs polish', 'Fail']);
const args = parseArgs(process.argv.slice(2));
const scorecardPath = args.scorecard || args.path;
const readbackPath = args.readback || null;
const allowMissingReadback = Boolean(args['allow-missing-readback']);
const expectedFeatures = parseExpectedFeatures(args['expected-features']);

if (!scorecardPath) {
  runDefaultScorecards();
  process.exit(0);
}

const absolutePath = path.resolve(process.cwd(), String(scorecardPath));
const scorecard = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
const rows = normalizeRows(scorecard);
const issues = [];
const readback = readbackPath ? JSON.parse(await fs.readFile(path.resolve(process.cwd(), String(readbackPath)), 'utf8')) : null;

if (!rows.length) {
  issues.push('scorecard_rows_missing');
}
validateExpectedFeatures(rows, expectedFeatures, issues);
if (!readback && !allowMissingReadback) {
  issues.push('readback_evidence_missing');
}
if (readback) {
  validateReadback(readback, rows, issues);
  validateScorecardReadbackPairing(readback, rows, issues);
}

for (const row of rows) {
  await validateRow(row, issues);
}

const summary = summarize(rows);
const result = {
  schema: 'heavy-chain.generation-quality-scorecard-verification.v1',
  verifiedAt: new Date().toISOString(),
  scorecardPath: path.relative(process.cwd(), absolutePath),
  readbackPath: readbackPath ? path.relative(process.cwd(), path.resolve(process.cwd(), String(readbackPath))) : null,
  rows: rows.length,
  summary,
  passed: issues.length === 0,
  issues,
};

console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exit(1);

function normalizeRows(value) {
  const rawRows = Array.isArray(value?.rows)
    ? value.rows
    : Array.isArray(value?.features)
      ? value.features
      : [];
  return rawRows.map((row) => {
    const scores = row.scores && typeof row.scores === 'object' ? row.scores : row;
    return {
      feature: String(row.feature || ''),
      imagePath: row.imagePath || row.image || row.imageUrl || null,
      jobId: row.jobId || row.job_id || row.readbackJobId || row.readback_job_id || null,
      decision: normalizeDecision(row.decision),
      notes: String(row.notes || ''),
      scores: Object.fromEntries(REQUIRED_AXES.map((axis) => [axis, Number(scores[axis])])),
      average: Number(row.average ?? average(REQUIRED_AXES.map((axis) => Number(scores[axis])))),
    };
  });
}

async function validateRow(row, issues) {
  const prefix = row.feature || 'unknown_feature';
  if (!row.feature) issues.push(`${prefix}:feature_missing`);
  if (!row.imagePath) issues.push(`${prefix}:image_path_missing`);
  if (row.imagePath) {
    await validateImagePath(row, issues);
  }
  if (!DECISION_VALUES.has(row.decision)) issues.push(`${prefix}:decision_invalid:${row.decision || 'missing'}`);
  if (!row.notes || row.notes.length < 12) issues.push(`${prefix}:notes_too_thin`);

  for (const axis of REQUIRED_AXES) {
    const score = row.scores[axis];
    if (!Number.isFinite(score) || score < 1 || score > 5) {
      issues.push(`${prefix}:${axis}_score_invalid`);
    }
  }

  const computedAverage = average(Object.values(row.scores));
  if (Number.isFinite(row.average) && Math.abs(row.average - computedAverage) > 0.06) {
    issues.push(`${prefix}:average_mismatch:${row.average}_expected_${computedAverage}`);
  }

  const minScore = Math.min(...Object.values(row.scores));
  if (minScore <= 2 && row.decision !== 'Fail') {
    issues.push(`${prefix}:axis_score_requires_fail`);
  }
  if (row.decision === 'Pass' && (computedAverage < 4.2 || minScore < 4)) {
    issues.push(`${prefix}:pass_threshold_not_met`);
  }
  if (row.decision === 'Needs polish' && computedAverage < 3.6) {
    issues.push(`${prefix}:needs_polish_threshold_not_met`);
  }
  if (row.decision === 'Fail' && computedAverage >= 4.2 && minScore >= 4) {
    issues.push(`${prefix}:fail_requires_specific_blocker_note`);
  }

  const notes = row.notes.toLowerCase();
  const featureTerms = FEATURE_REQUIREMENTS[row.feature] || [];
  if (featureTerms.length && !featureTerms.some((term) => notes.includes(term))) {
    issues.push(`${prefix}:notes_missing_feature_specific_evidence`);
  }
}

async function validateImagePath(row, issues) {
  const imagePath = String(row.imagePath || '');
  if (/^https?:\/\//i.test(imagePath)) {
    issues.push(`${row.feature}:remote_image_path_not_allowed`);
    return;
  }
  const absoluteImagePath = path.isAbsolute(imagePath)
    ? imagePath
    : path.resolve(process.cwd(), imagePath);
  try {
    const stat = await fs.stat(absoluteImagePath);
    if (!stat.isFile() || stat.size <= 0) {
      issues.push(`${row.feature}:image_file_invalid`);
    }
  } catch {
    issues.push(`${row.feature}:image_file_missing`);
  }
}

function validateReadback(readback, rows, issues) {
  const counts = readback?.counts && typeof readback.counts === 'object' ? readback.counts : {};
  if (Number(counts.failedJobs || 0) > 0) issues.push('readback_failed_jobs_present');
  if (Number(counts.completedJobs || 0) < rows.length) issues.push('readback_completed_jobs_less_than_scorecard_rows');
  if (Number(counts.images || 0) < rows.length) issues.push('readback_images_less_than_scorecard_rows');
  if (Number(counts.storage || 0) < rows.length) issues.push('readback_storage_less_than_scorecard_rows');
  if (Number(counts.signedUrlOk || 0) < rows.length) issues.push('readback_signed_url_less_than_scorecard_rows');

  const readbackFeatures = new Set([
    ...arrayFrom(readback.jobs).map((row) => row.feature || row.feature_type).filter(Boolean),
    ...arrayFrom(readback.images).map((row) => row.feature || row.feature_type).filter(Boolean),
    ...arrayFrom(readback.storage).map((row) => row.feature || row.feature_type).filter(Boolean),
  ]);
  if (!readbackFeatures.size && rows.length) {
    issues.push('readback_feature_evidence_missing');
  }
  for (const row of rows) {
    if (!readbackFeatures.has(row.feature)) {
      issues.push(`${row.feature}:readback_feature_missing`);
    }
  }
}

function validateScorecardReadbackPairing(readback, rows, issues) {
  const jobIdsByFeature = new Map();
  for (const item of [...arrayFrom(readback.jobs), ...arrayFrom(readback.images), ...arrayFrom(readback.storage)]) {
    const feature = item.feature || item.feature_type;
    const jobId = item.jobId || item.job_id || item.id;
    if (!feature || !jobId) continue;
    const list = jobIdsByFeature.get(feature) ?? [];
    list.push(String(jobId));
    jobIdsByFeature.set(feature, list);
  }

  for (const row of rows) {
    const imagePath = String(row.imagePath || '');
    if (!imagePath) continue;
    const jobIds = jobIdsByFeature.get(row.feature) ?? [];
    if (!jobIds.length) continue;
    const explicitJobId = row.jobId ? String(row.jobId) : '';
    const paired = jobIds.some((jobId) => imagePath.includes(jobId) || explicitJobId === jobId);
    if (!paired) {
      issues.push(`${row.feature}:scorecard_image_not_paired_to_readback_job`);
    }
  }
}

function validateExpectedFeatures(rows, expected, issues) {
  if (!expected.length) return;
  const seen = new Set(rows.map((row) => row.feature).filter(Boolean));
  for (const feature of expected) {
    if (!seen.has(feature)) issues.push(`${feature}:expected_feature_missing`);
  }
  for (const feature of seen) {
    if (!expected.includes(feature)) issues.push(`${feature}:unexpected_feature`);
  }
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}

function summarize(rows) {
  return rows.reduce(
    (acc, row) => {
      if (row.decision === 'Pass') acc.pass += 1;
      if (row.decision === 'Needs polish') acc.needsPolish += 1;
      if (row.decision === 'Fail') acc.fail += 1;
      return acc;
    },
    { pass: 0, needsPolish: 0, fail: 0 },
  );
}

function normalizeDecision(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'pass' || text === 'passed') return 'Pass';
  if (text === 'needs polish' || text === 'needspolish' || text === 'needs-polish') return 'Needs polish';
  if (text === 'fail' || text === 'failed') return 'Fail';
  return String(value || '');
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return NaN;
  return Math.round((finite.reduce((sum, value) => sum + value, 0) / finite.length) * 100) / 100;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function parseExpectedFeatures(value) {
  if (!value || value === true) return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function runDefaultScorecards() {
  const results = [];
  for (const item of DEFAULT_SCORECARDS) {
    const result = spawnSync(process.execPath, [
      fileURLToPath(import.meta.url),
      '--scorecard',
      item.scorecard,
      '--readback',
      item.readback,
      '--expected-features',
      item.expectedFeatures.join(','),
    ], { cwd: process.cwd(), encoding: 'utf8' });
    const stdout = result.stdout.trim();
    const stderr = result.stderr.trim();
    if (stdout) {
      try {
        results.push({ name: item.name, ...JSON.parse(stdout) });
      } catch {
        results.push({ name: item.name, raw: stdout });
      }
    }
    if (stderr) console.error(stderr);
    if (result.status !== 0) {
      console.log(JSON.stringify({
        schema: 'heavy-chain.generation-quality-scorecard-defaults.v1',
        verifiedAt: new Date().toISOString(),
        passed: false,
        failedDefault: item.name,
        results,
      }, null, 2));
      process.exit(result.status ?? 1);
    }
  }
  console.log(JSON.stringify({
    schema: 'heavy-chain.generation-quality-scorecard-defaults.v1',
    verifiedAt: new Date().toISOString(),
    passed: true,
    results,
  }, null, 2));
}
