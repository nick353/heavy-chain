#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import crypto from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const initialEnvKeys = new Set(Object.keys(process.env));
loadEnvFile('.env.production.local', initialEnvKeys);

const now = new Date();
const authStatePath = args.authState || process.env.LIGHTCHAIN_UI_AUTH_STATE || 'output/playwright/prod-auth-dashboard-20260623/auth-state-after-tutorial.json';
const outPath = args.out || `output/playwright/runway-unapproved-denial-${dateStamp(now)}/denial.json`;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const idempotencyKey = `runway-unapproved-denial-${now.toISOString()}-${crypto.randomUUID()}`;
const promptMarker = `runway-unapproved-denial-${now.toISOString()}`;
const tempBrandName = `HC Unapproved Denial ${now.toISOString()}`;

const proof = {
  captured_at: now.toISOString(),
  checker: 'verify-runway-unapproved-denial',
  mode: 'safe-negative-proof-temp-brand-cleanup',
  auth_state_path: authStatePath,
  idempotency_key: idempotencyKey,
  prompt_marker: promptMarker,
  temp_brand_name: tempBrandName,
  temp_brand_id: null,
  checks: [],
  blockers: [],
};

let tempBrandId = null;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  addBlocker('supabase_env_missing', 'Supabase URL, anon key, and service role key are required.', 'Load production Supabase env locally without printing values.');
  finish(false);
}

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const userClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

try {
  const session = await restoreUserSession(userClient, authStatePath);
  addCheck('production auth state restored', Boolean(session?.access_token), { user_id: session?.user?.id || null });
  if (!session?.access_token) {
    addBlocker('production_auth_state_unavailable', 'Saved production auth state could not be restored.', 'Log in again and refresh the saved production auth state.');
    finish(false);
  }

  const brandResult = await userClient.rpc('create_brand', {
    p_name: tempBrandName,
    p_tone_description: 'Temporary unapproved Runway denial proof brand',
    p_target_audience: 'Verification only',
  });
  if (brandResult.error || !brandResult.data?.id) {
    addBlocker('temp_brand_create_failed', brandResult.error?.message || 'create_brand returned no brand id', 'Inspect create_brand RPC before rerunning the proof.');
    finish(false);
  }

  tempBrandId = brandResult.data.id;
  proof.temp_brand_id = tempBrandId;
  addCheck('temporary brand created', true, { brand_id: tempBrandId });

  const approvalBefore = await selectRows(
    'runway_mcp_connection_approvals',
    'id, brand_id, status, approved_at',
    (query) => query.eq('brand_id', tempBrandId),
  );
  addCheck('temporary brand has no Runway approval', approvalBefore.data.length === 0, {
    count: approvalBefore.data.length,
    error: approvalBefore.error?.message || null,
  });

  const before = await collectSideEffects(tempBrandId);
  const invokeStartedAt = new Date();
  const invokeResult = await userClient.functions.invoke('generate-image', {
    body: {
      brandId: tempBrandId,
      prompt: `No generation should start for unapproved brand. ${promptMarker}`,
      width: 1024,
      height: 1024,
      featureType: 'text-to-image',
      sourceReadback: {
        sourceWorkspace: 'runway-unapproved-denial',
        workflowVersion: 'runway-unapproved-denial-v1',
        promptMarker,
      },
      lightchainCompat: {
        lightchainFeatureId: 'runway-unapproved-denial',
        lightchainFeatureTitle: 'Runway Unapproved Brand Denial Proof',
        lightchainTaskCodes: ['PatternToVector'],
      },
    },
    headers: {
      'idempotency-key': idempotencyKey,
    },
  });
  const invokeFinishedAt = new Date();
  const normalizedInvoke = await normalizeInvokeResult(invokeResult);
  proof.invoke = {
    started_at: invokeStartedAt.toISOString(),
    finished_at: invokeFinishedAt.toISOString(),
    ...normalizedInvoke,
  };

  const expectedDenial = /runway_mcp_connection_not_approved/i.test(
    `${normalizedInvoke.error_message || ''} ${normalizedInvoke.response_text || ''} ${JSON.stringify(normalizedInvoke.response_json || {})}`,
  );
  addCheck('Edge Function denied unapproved brand before generation', expectedDenial, {
    error_message: normalizedInvoke.error_message,
    response_error: normalizedInvoke.response_json?.error || null,
    status: normalizedInvoke.status || null,
  });

  const after = await collectSideEffects(tempBrandId);
  proof.side_effect_readback = { before, after };
  const noSideEffects = after.usageByIdempotencyKey.length === 0
    && after.jobsByPromptMarker.length === 0
    && after.imagesByPromptMarker.length === 0;
  addCheck('no usage/job/image side effects for unapproved marker', noSideEffects, {
    usageByIdempotencyKey: after.usageByIdempotencyKey.length,
    jobsByPromptMarker: after.jobsByPromptMarker.length,
    imagesByPromptMarker: after.imagesByPromptMarker.length,
  });

  if (!expectedDenial) {
    addBlocker('unapproved_denial_message_unexpected', 'Edge Function did not return runway_mcp_connection_not_approved.', 'Inspect invoke proof and Edge Function logs before rerunning generation.');
  }
  if (!noSideEffects) {
    addBlocker('unapproved_denial_side_effect_detected', 'The unapproved denial proof created usage, job, or image rows for the marker.', 'Inspect side_effect_readback and cleanup state before continuing.');
  }
} finally {
  if (tempBrandId) {
    proof.cleanup = await cleanupTempBrand(tempBrandId);
  }
}

const cleanupPassed = Boolean(proof.cleanup?.passed);
addCheck('temporary brand cleanup completed', cleanupPassed, proof.cleanup || { skipped: true });
if (!cleanupPassed) {
  addBlocker('temp_brand_cleanup_failed', 'Temporary brand cleanup did not prove zero residual rows.', 'Inspect cleanup readback before continuing.');
}

finish(proof.blockers.length === 0);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--auth-state' && next) {
      parsed.authState = next;
      index += 1;
    } else if (arg === '--out' && next) {
      parsed.out = next;
      index += 1;
    }
  }
  return parsed;
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
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
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

async function selectRows(table, columns, apply) {
  let query = serviceClient.from(table).select(columns);
  query = apply(query);
  const { data, error } = await query;
  return { data: Array.isArray(data) ? data : [], error };
}

async function collectSideEffects(brandId) {
  const usage = await selectRows(
    'usage_events',
    'id, function_name, status, idempotency_key, request_id, reserved_at, completed_at, created_at',
    (query) => query.eq('brand_id', brandId).eq('idempotency_key', idempotencyKey),
  );
  const jobs = await selectRows(
    'generation_jobs',
    'id, status, feature_type, input_params, created_at',
    (query) => query.eq('brand_id', brandId).gte('created_at', now.toISOString()).order('created_at', { ascending: false }).limit(20),
  );
  const images = await selectRows(
    'generated_images',
    'id, job_id, prompt, storage_path, image_url, metadata, created_at',
    (query) => query.eq('brand_id', brandId).gte('created_at', now.toISOString()).order('created_at', { ascending: false }).limit(20),
  );

  return redactObject({
    usageByIdempotencyKey: usage.data,
    usageError: usage.error?.message || null,
    jobsByPromptMarker: jobs.data.filter((row) => JSON.stringify(row).includes(promptMarker)).map(projectJob),
    jobsError: jobs.error?.message || null,
    imagesByPromptMarker: images.data.filter((row) => JSON.stringify(row).includes(promptMarker)).map(projectImage),
    imagesError: images.error?.message || null,
  });
}

async function cleanupTempBrand(brandId) {
  const deleteResult = await serviceClient.from('brands').delete().eq('id', brandId);
  const residual = {};
  for (const [table, column] of [
    ['brands', 'id'],
    ['brand_members', 'brand_id'],
    ['brand_subscriptions', 'brand_id'],
    ['runway_mcp_connection_approvals', 'brand_id'],
    ['generation_jobs', 'brand_id'],
    ['generated_images', 'brand_id'],
    ['usage_events', 'brand_id'],
  ]) {
    const result = await selectRows(table, column, (query) => query.eq(column, brandId));
    residual[table] = {
      count: result.data.length,
      error: result.error?.message || null,
    };
  }
  return redactObject({
    deleteError: deleteResult.error?.message || null,
    residual,
    passed: !deleteResult.error && Object.values(residual).every((entry) => entry.count === 0 && !entry.error),
  });
}

async function normalizeInvokeResult(result) {
  const responseText = result.error?.context ? await result.error.context.clone().text().catch(() => '') : '';
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

function projectJob(row) {
  return { id: row.id, status: row.status, feature_type: row.feature_type, created_at: row.created_at };
}

function projectImage(row) {
  return { id: row.id, job_id: row.job_id, storage_path: row.storage_path, has_image_url: Boolean(row.image_url), created_at: row.created_at };
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
    console.error(`Runway unapproved brand denial proof failed. Proof: ${outPath}`);
    for (const blocker of proof.blockers) console.error(`- ${blocker.code}: ${blocker.message}`);
    process.exit(1);
  }
  console.log(`Runway unapproved brand denial proof passed. Proof: ${outPath}`);
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
