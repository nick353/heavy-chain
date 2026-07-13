#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import crypto from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const initialEnvKeys = new Set(Object.keys(process.env));
loadEnvFile('.env.production.local', initialEnvKeys);

const now = new Date();
const brandId = args.brandId || process.env.RUNWAY_DENIAL_BRAND_ID || 'e5571b0b-7af7-4265-9d47-7d90ae4767d3';
const authStatePath = args.authState || process.env.LIGHTCHAIN_UI_AUTH_STATE || 'output/playwright/prod-auth-dashboard-20260623/auth-state-after-tutorial.json';
const outPath = args.out || `output/playwright/runway-free-plan-denial-${dateStamp(now)}/denial.json`;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const idempotencyKey = `runway-free-denial-${now.toISOString()}-${crypto.randomUUID()}`;
const promptMarker = `runway-free-plan-denial-${now.toISOString()}`;

const proof = {
  captured_at: now.toISOString(),
  checker: 'verify-runway-free-plan-denial',
  mode: 'safe-negative-proof-no-live-generation-expected',
  brand_id: brandId,
  auth_state_path: authStatePath,
  idempotency_key: idempotencyKey,
  prompt_marker: promptMarker,
  checks: [],
  blockers: [],
};

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  addBlocker(
    'supabase_env_missing',
    'SUPABASE/VITE Supabase URL, anon key, and service role key are required.',
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

const subscription = await selectSingle(
  'brand_subscriptions',
  'brand_id, status, current_period_start, current_period_end, quota_override, plan_id, plans(id, code, name, monthly_quota, features, is_active)',
  (query) => query.eq('brand_id', brandId),
);
const subscriptionProjection = projectSubscription(subscription.data);
const eligibleSubscription = isEligibleRunwaySubscription(subscriptionProjection, now);
addCheck('subscription is not Runway-eligible', !eligibleSubscription, subscription.error ? { error: subscription.error.message } : { subscription: subscriptionProjection });
if (eligibleSubscription) {
  addBlocker(
    'unsafe_live_generation_possible',
    'Target brand is already eligible for Runway MCP generation, so this negative proof would no longer be safe.',
    'Use the approved live generation proof instead of the free-plan denial proof.',
  );
  finish(false);
}

const approval = await selectSingle(
  'runway_mcp_connection_approvals',
  'brand_id, status, approved_at, updated_at',
  (query) => query.eq('brand_id', brandId),
);
addCheck('Runway MCP site approval is approved', approval.data?.status === 'approved', approval.error ? { error: approval.error.message } : { approval: approval.data || null });
if (approval.data?.status !== 'approved') {
  addBlocker(
    'site_approval_not_ready_for_free_plan_denial',
    `Expected approved Runway MCP site approval before testing subscription denial, got ${approval.data?.status || 'missing'}.`,
    'Approve the brand first, then rerun this proof.',
  );
  finish(false);
}

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

const before = await collectSideEffects();
const invokeStartedAt = new Date();
const invokeResult = await userClient.functions.invoke('generate-image', {
  body: {
    brandId,
    prompt: `No generation should start. ${promptMarker}`,
    width: 1024,
    height: 1024,
    featureType: 'text-to-image',
    sourceReadback: {
      sourceWorkspace: 'runway-free-plan-denial',
      workflowVersion: 'runway-free-plan-denial-v1',
      promptMarker,
    },
    lightchainCompat: {
      lightchainFeatureId: 'runway-free-plan-denial',
      lightchainFeatureTitle: 'Runway Free Plan Denial Proof',
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

const expectedDenial = /Runway MCP generation requires an active eligible subscription/i.test(
  `${normalizedInvoke.error_message || ''} ${JSON.stringify(normalizedInvoke.data || {})} ${normalizedInvoke.response_text || ''} ${JSON.stringify(normalizedInvoke.response_json || {})}`,
);
addCheck('Edge Function denied Free plan before generation', expectedDenial, {
  error_message: normalizedInvoke.error_message,
  status: normalizedInvoke.status || null,
});

const after = await collectSideEffects();
proof.side_effect_readback = { before, after };
const noSideEffects = after.usageByIdempotencyKey.length === 0
  && after.jobsByPromptMarker.length === 0
  && after.imagesByPromptMarker.length === 0
  && after.storageByPromptMarker.length === 0;
addCheck('no usage/job/image/storage side effects for denial marker', noSideEffects, {
  usageByIdempotencyKey: after.usageByIdempotencyKey.length,
  jobsByPromptMarker: after.jobsByPromptMarker.length,
  imagesByPromptMarker: after.imagesByPromptMarker.length,
  storageByPromptMarker: after.storageByPromptMarker.length,
});

if (!expectedDenial) {
  addBlocker(
    'free_plan_denial_message_unexpected',
    'Edge Function did not return the expected active eligible subscription denial.',
    'Inspect the invoke proof and Edge Function logs before rerunning generation.',
  );
}
if (!noSideEffects) {
  addBlocker(
    'free_plan_denial_side_effect_detected',
    'The denial proof created usage, job, image, or storage side effects for the marker.',
    'Inspect side_effect_readback and clean up before continuing.',
  );
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

async function selectSingle(table, columns, apply) {
  let query = serviceClient.from(table).select(columns);
  query = apply(query);
  const { data, error } = await query.maybeSingle();
  return { data, error };
}

async function selectRows(table, columns, apply) {
  let query = serviceClient.from(table).select(columns);
  query = apply(query);
  const { data, error } = await query;
  return { data: Array.isArray(data) ? data : [], error };
}

async function collectSideEffects() {
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

  const jobsByPromptMarker = jobs.data.filter((row) => JSON.stringify(row).includes(promptMarker)).map(projectJob);
  const imagesByPromptMarker = images.data.filter((row) => JSON.stringify(row).includes(promptMarker)).map(projectImage);
  const storageByPromptMarker = imagesByPromptMarker.filter((row) => row.storage_path || row.image_url);

  return redactObject({
    usageByIdempotencyKey: usage.data.map((row) => ({
      id: row.id,
      function_name: row.function_name,
      status: row.status,
      idempotency_key: row.idempotency_key,
      request_id: row.request_id,
      reserved_at: row.reserved_at,
      completed_at: row.completed_at,
      created_at: row.created_at,
    })),
    usageError: usage.error?.message || null,
    jobsByPromptMarker,
    jobsError: jobs.error?.message || null,
    imagesByPromptMarker,
    imagesError: images.error?.message || null,
    storageByPromptMarker,
  });
}

function projectJob(row) {
  return {
    id: row.id,
    status: row.status,
    feature_type: row.feature_type,
    created_at: row.created_at,
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

function projectSubscription(row) {
  if (!row) return null;
  const plan = Array.isArray(row.plans) ? row.plans[0] : row.plans;
  return {
    brand_id: row.brand_id,
    status: row.status,
    current_period_start: row.current_period_start,
    current_period_end: row.current_period_end,
    quota_override: row.quota_override,
    plan: plan ? {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      monthly_quota: plan.monthly_quota,
      is_active: plan.is_active,
      runway_mcp_generation: plan.features?.runway_mcp_generation === true,
    } : null,
  };
}

function isEligibleRunwaySubscription(subscription, capturedAt) {
  if (!subscription?.plan) return false;
  const nowMs = capturedAt.getTime();
  const periodStart = Date.parse(subscription.current_period_start || '');
  const periodEnd = Date.parse(subscription.current_period_end || '');
  return ['trialing', 'active'].includes(subscription.status)
    && Number.isFinite(periodStart)
    && Number.isFinite(periodEnd)
    && periodStart <= nowMs
    && periodEnd > nowMs
    && subscription.plan.is_active === true
    && subscription.plan.runway_mcp_generation === true;
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
    console.error(`Runway Free plan denial proof failed. Proof: ${outPath}`);
    for (const blocker of proof.blockers) console.error(`- ${blocker.code}: ${blocker.message}`);
    process.exit(1);
  }
  console.log(`Runway Free plan denial proof passed. Proof: ${outPath}`);
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
