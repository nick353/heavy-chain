#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const initialEnvKeys = new Set(Object.keys(process.env));
loadEnvFile('.env.production.local', initialEnvKeys);

const now = new Date();
const brandId = args.brandId || process.env.RUNWAY_APPROVED_GENERATION_BRAND_ID || 'e5571b0b-7af7-4265-9d47-7d90ae4767d3';
const authStatePath = args.authState || process.env.LIGHTCHAIN_UI_AUTH_STATE || 'output/playwright/prod-auth-dashboard-20260623/auth-state-after-tutorial.json';
const outPath = args.out || `output/playwright/runway-approved-generation-readback-${dateStamp(now)}/proof.json`;
const readinessOutPath = args.readinessOut || `output/playwright/runway-approved-generation-readback-${dateStamp(now)}/readiness.json`;
const allowBlocked = args.allowBlocked === true;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const idempotencyKey = `runway-approved-generation-${now.toISOString()}-${crypto.randomUUID()}`;
const promptMarker = `runway-approved-generation-readback-${now.toISOString()}`;

const proof = {
  captured_at: now.toISOString(),
  checker: 'verify-runway-approved-generation-readback',
  mode: 'gated-live-generation-readback',
  brand_id: brandId,
  auth_state_path: authStatePath,
  readiness_path: readinessOutPath,
  idempotency_key: idempotencyKey,
  prompt_marker: promptMarker,
  generation_attempted: false,
  checks: [],
  blockers: [],
  next_actions: [],
};

const readinessResult = runReadiness();
proof.readiness = readinessResult.proof;
proof.readiness_command = readinessResult.command;
addCheck('production readiness gate executed', Boolean(readinessResult.proof), {
  status: readinessResult.status,
  path: readinessOutPath,
});

if (!readinessResult.proof) {
  addBlocker(
    'readiness_proof_missing',
    'The production readiness proof was not produced, so live generation was not attempted.',
    'Fix npm run verify:runway-readiness first, then rerun this verifier.',
  );
  finish(false);
}

const readinessReady = readinessResult.proof.ready === true
  || (Array.isArray(readinessResult.proof.blockers) && readinessResult.proof.blockers.length === 0);
addCheck('production readiness passed before generation', readinessReady, {
  ready: readinessResult.proof.ready ?? null,
  blockers: readinessResult.proof.blockers || [],
});

if (!readinessReady) {
  for (const blocker of readinessResult.proof.blockers || []) {
    addBlocker(
      blocker.code || 'readiness_blocker',
      blocker.message || 'Production readiness did not pass.',
      blocker.next_action || 'Resolve readiness blocker before running approved-brand production generation.',
    );
  }
  proof.next_actions.push('Generation was not attempted because production readiness is false.');
  for (const nextAction of uniqueBlockerNextActions(readinessResult.proof.blockers || [])) {
    proof.next_actions.push(nextAction);
  }
  finish(allowBlocked);
}

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  addBlocker(
    'supabase_env_missing',
    'SUPABASE/VITE Supabase URL, anon key, and service role key are required for live generation readback.',
    'Load production Supabase env locally without printing secret values.',
  );
  finish(false);
}

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const userClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const session = await restoreUserSession(userClient, authStatePath);
addCheck('production auth state restored', Boolean(session?.access_token), { user_id: session?.user?.id || null });
if (!session?.access_token) {
  addBlocker(
    'production_auth_state_unavailable',
    'Saved production auth state could not be restored.',
    'Log in again and refresh output/playwright/prod-auth-dashboard-20260623/auth-state-after-tutorial.json.',
  );
  finish(false);
}

const before = await collectReadback();
proof.generation_attempted = true;
proof.invoke_started_at = new Date().toISOString();
const invokeResult = await userClient.functions.invoke('generate-image', {
  body: {
    brandId,
    prompt: `Approved production readback proof. ${promptMarker}`,
    width: 1024,
    height: 1024,
    featureType: 'text-to-image',
    sourceReadback: {
      sourceWorkspace: 'studio',
      workflowVersion: 'studio-selection-local-v1',
      sourceLabel: 'Fashion Studio',
      sourceResumePath: '/studio',
      sourceMode: 'local-workflow-intake',
    },
    generationIntent: {
      feature: 'approved-brand-production-readback',
      prompt: promptMarker,
      href: '/studio',
      label: 'Approved brand production readback',
      sourceWorkspace: 'studio',
      workflowVersion: 'studio-selection-local-v1',
      sourceLabel: 'Fashion Studio',
      sourceResumePath: '/studio',
      sourceMode: 'local-workflow-intake',
    },
    lightchainCompat: {
      lightchainFeatureId: 'approved-brand-production-readback',
      lightchainFeatureTitle: 'Approved Brand Production Readback',
      lightchainTaskCodes: ['FashionStudio'],
    },
  },
  headers: {
    'idempotency-key': idempotencyKey,
  },
});
proof.invoke_finished_at = new Date().toISOString();
proof.invoke = await normalizeInvokeResult(invokeResult);
const invokeSucceeded = proof.invoke.status === null && proof.invoke.has_data === true && proof.invoke.data?.success === true;
addCheck('approved-brand generate-image invocation succeeded', invokeSucceeded, {
  status: proof.invoke.status,
  error_message: proof.invoke.error_message,
  job_id: proof.invoke.data?.jobId || null,
  image_id: proof.invoke.data?.imageId || null,
  storage_path: proof.invoke.data?.storagePath || null,
});

const after = await collectReadback();
proof.readback = { before, after };
const readbackPassed = after.usageByIdempotencyKey.length >= 1
  && after.jobsByPromptMarker.length >= 1
  && after.imagesByPromptMarker.length >= 1
  && after.storageSignedUrls.every((row) => row.signedUrlOk === true);
addCheck('DB and Storage readback found generated artifact', readbackPassed, {
  usageByIdempotencyKey: after.usageByIdempotencyKey.length,
  jobsByPromptMarker: after.jobsByPromptMarker.length,
  imagesByPromptMarker: after.imagesByPromptMarker.length,
  storageSignedUrls: after.storageSignedUrls,
});

if (!invokeSucceeded) {
  addBlocker(
    'approved_generation_invoke_failed',
    'Approved-brand generation did not return success.',
    'Inspect the invoke proof, Edge Function logs, bridge authorization, and Runway subscription/credits.',
  );
}
if (!readbackPassed) {
  addBlocker(
    'approved_generation_readback_incomplete',
    'Approved-brand generation did not produce complete DB/Storage readback for the proof marker.',
    'Inspect generation_jobs, generated_images, usage_events, and generated-images storage for the marker.',
  );
}
if (proof.blockers.length === 0) {
  proof.next_actions.push('Run UI readback from logged-in production dashboard/gallery/canvas and perform marker-scoped cleanup if this was a disposable proof artifact.');
}

finish(proof.blockers.length === 0);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--brand-id' && next) {
      parsed.brandId = next;
      index += 1;
    } else if (arg === '--auth-state' && next) {
      parsed.authState = next;
      index += 1;
    } else if (arg === '--out' && next) {
      parsed.out = next;
      index += 1;
    } else if (arg === '--readiness-out' && next) {
      parsed.readinessOut = next;
      index += 1;
    } else if (arg === '--allow-blocked') {
      parsed.allowBlocked = true;
    }
  }
  return parsed;
}

function runReadiness() {
  const command = ['node', 'scripts/verify-runway-production-readiness.mjs', '--brand-id', brandId, '--out', readinessOutPath];
  const result = spawnSync(command[0], command.slice(1), {
    encoding: 'utf8',
    shell: false,
    env: process.env,
  });
  let readinessProof = null;
  if (existsSync(readinessOutPath)) {
    try {
      readinessProof = JSON.parse(readFileSync(readinessOutPath, 'utf8'));
    } catch (error) {
      readinessProof = {
        parse_error: error.message,
        stdout: redact(result.stdout).slice(0, 1000),
        stderr: redact(result.stderr).slice(0, 1000),
      };
    }
  }
  return {
    command: command.join(' '),
    status: result.status,
    proof: readinessProof,
    stdout: redact(result.stdout).slice(0, 1000),
    stderr: redact(result.stderr).slice(0, 1000),
  };
}

function uniqueBlockerNextActions(blockers) {
  const actions = blockers
    .map((blocker) => blocker.next_action)
    .filter((action) => typeof action === 'string' && action.trim().length > 0);
  return [...new Set(actions)];
}

function loadEnvFile(filePath, initialKeys) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (key === 'SUPABASE_ACCESS_TOKEN') continue;
    const value = unquote(rawValue.trim());
    if (isPlaceholder(value)) continue;
    if (initialKeys.has(key) && !isPlaceholder(process.env[key])) continue;
    process.env[key] = value;
  }
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function isPlaceholder(value) {
  return !value || /\b(PROJECT_REF|YOUR_|REPLACE_ME|example\.com)\b/i.test(String(value));
}

async function restoreUserSession(client, filePath) {
  const state = JSON.parse(readFileSync(filePath, 'utf8'));
  const origin = state.origins?.find((entry) => entry.origin === 'https://heavy-chain.zeabur.app') || state.origins?.[0];
  const authItem = origin?.localStorage?.find((entry) => entry.name.startsWith('sb-') && entry.name.endsWith('-auth-token'));
  if (!authItem?.value) return null;

  const parsed = JSON.parse(authItem.value);
  const { data, error } = await client.auth.setSession({
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token,
  });
  if (error) {
    proof.auth_error = redact(error.message);
    return null;
  }
  return data.session;
}

async function collectReadback() {
  const usage = await selectRows(
    'usage_events',
    'id, function_name, status, idempotency_key, request_id, reserved_at, completed_at, created_at',
    (query) => query.eq('brand_id', brandId).eq('idempotency_key', idempotencyKey),
  );
  const jobs = await selectRows(
    'generation_jobs',
    'id, status, feature_type, input_params, created_at, completed_at',
    (query) => query.eq('brand_id', brandId).gte('created_at', now.toISOString()).order('created_at', { ascending: false }).limit(20),
  );
  const images = await selectRows(
    'generated_images',
    'id, job_id, prompt, storage_path, image_url, metadata, created_at',
    (query) => query.eq('brand_id', brandId).gte('created_at', now.toISOString()).order('created_at', { ascending: false }).limit(20),
  );
  const steps = await selectRows(
    'lightchain_task_steps',
    'id, job_id, image_id, task_code, status, source_workspace, workflow_version, request_id, artifact_uri, created_at, completed_at',
    (query) => query.eq('brand_id', brandId).gte('created_at', now.toISOString()).order('created_at', { ascending: false }).limit(20),
  );

  const jobsByPromptMarker = jobs.data.filter((row) => JSON.stringify(row).includes(promptMarker)).map(projectJob);
  const imagesByPromptMarker = images.data.filter((row) => JSON.stringify(row).includes(promptMarker)).map(projectImage);
  const taskStepsByPromptMarker = steps.data.filter((row) => {
    const matchingJobIds = new Set(jobsByPromptMarker.map((job) => job.id));
    const matchingImageIds = new Set(imagesByPromptMarker.map((image) => image.id));
    return matchingJobIds.has(row.job_id) || matchingImageIds.has(row.image_id) || row.request_id === usage.data[0]?.request_id;
  }).map(projectTaskStep);
  const storageSignedUrls = await collectStorageSignedUrls(imagesByPromptMarker);

  return redactObject({
    usageByIdempotencyKey: usage.data.map(projectUsage),
    usageError: usage.error?.message || null,
    jobsByPromptMarker,
    jobsError: jobs.error?.message || null,
    imagesByPromptMarker,
    imagesError: images.error?.message || null,
    taskStepsByPromptMarker,
    taskStepsError: steps.error?.message || null,
    storageSignedUrls,
  });
}

async function selectRows(table, columns, apply) {
  let query = serviceClient.from(table).select(columns);
  query = apply(query);
  const { data, error } = await query;
  return { data: Array.isArray(data) ? data : [], error };
}

async function collectStorageSignedUrls(images) {
  const rows = [];
  for (const image of images) {
    if (!image.storage_path) continue;
    const { data, error } = await serviceClient.storage.from('generated-images').createSignedUrl(image.storage_path, 60);
    rows.push({
      storage_path: image.storage_path,
      signedUrlOk: Boolean(data?.signedUrl && !error),
      error: error?.message || null,
    });
  }
  return rows;
}

async function normalizeInvokeResult(result) {
  const responseText = result.error?.context
    ? await result.error.context.clone().text().catch(() => '')
    : '';
  let responseJson = null;
  if (responseText) {
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = null;
    }
  }

  return redactObject({
    has_data: Boolean(result.data),
    data: result.data || null,
    error_name: result.error?.name || null,
    error_message: result.error?.message || null,
    status: result.error?.context?.status || null,
    response_text: responseJson ? null : responseText,
    response_json: responseJson,
  });
}

function projectUsage(row) {
  return {
    id: row.id,
    function_name: row.function_name,
    status: row.status,
    idempotency_key: row.idempotency_key,
    request_id: row.request_id,
    reserved_at: row.reserved_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
  };
}

function projectJob(row) {
  return {
    id: row.id,
    status: row.status,
    feature_type: row.feature_type,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}

function projectImage(row) {
  return {
    id: row.id,
    job_id: row.job_id,
    storage_path: row.storage_path,
    has_image_url: Boolean(row.image_url),
    created_at: row.created_at,
  };
}

function projectTaskStep(row) {
  return {
    id: row.id,
    job_id: row.job_id,
    image_id: row.image_id,
    task_code: row.task_code,
    status: row.status,
    source_workspace: row.source_workspace,
    workflow_version: row.workflow_version,
    artifact_uri: row.artifact_uri,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}

function addCheck(name, passed, details = {}) {
  proof.checks.push({ name, passed: Boolean(passed), details: redactObject(details) });
}

function addBlocker(code, message, nextAction) {
  proof.blockers.push({ code, message, next_action: nextAction });
}

function finish(passed) {
  proof.passed = Boolean(passed);
  const raw = `${JSON.stringify(redactObject(proof), null, 2)}\n`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, raw);
  if (!passed) {
    console.error(`Runway approved generation readback proof failed. Proof: ${outPath}`);
    for (const blocker of proof.blockers) console.error(`- ${blocker.code}: ${blocker.message}`);
    process.exit(1);
  }
  console.log(`Runway approved generation readback proof passed. Proof: ${outPath}`);
  process.exit(0);
}

function dateStamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function redactObject(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [key, redactObject(entryValue)]));
  }
  return value;
}

function redact(value) {
  return String(value)
    .replaceAll(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[redacted-jwt]')
    .replaceAll(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [redacted]')
    .replaceAll(/access_token["=:]\s*["']?[^"',\s}]+/gi, 'access_token=[redacted]')
    .replaceAll(/refresh_token["=:]\s*["']?[^"',\s}]+/gi, 'refresh_token=[redacted]');
}
