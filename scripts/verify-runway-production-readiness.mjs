#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  dateStamp,
  dbReadbackBlocker,
  isEligibleRunwaySubscription,
  projectBrand,
  projectRemoteSecretInspection,
  projectSubscription,
  redactObject,
  requiredSecretPresence,
} from './verify-runway-production-readiness.lib.mjs';

const args = parseArgs(process.argv.slice(2));
const initialEnvKeys = new Set(Object.keys(process.env));
loadEnvFile('.env.production.local', initialEnvKeys);

const now = new Date();
const brandId = args.brandId || process.env.RUNWAY_READINESS_BRAND_ID || 'e5571b0b-7af7-4265-9d47-7d90ae4767d3';
const outPath = args.out || `output/playwright/runway-production-readiness-${dateStamp(now)}/readiness.json`;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const projectRef = firstRealValue(
  process.env.SUPABASE_PROJECT_REF,
  readTextIfExists('supabase/.temp/project-ref'),
  projectRefFromUrl(supabaseUrl),
);

const proof = {
  captured_at: now.toISOString(),
  checker: 'verify-runway-production-readiness',
  mode: 'read-only-no-generation-no-payment',
  brand_id: brandId,
  supabase_project_ref: projectRef || null,
  checks: [],
  blockers: [],
  next_actions: [],
};

if (!supabaseUrl || !serviceRoleKey) {
  addBlocker(
    'supabase_service_role_env_missing',
    'SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SERVICE_ROLE_KEY are required for read-only DB readiness.',
    'Load production Supabase env locally without printing secret values.',
  );
  finish();
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const localEnvPresence = {
  RUNWAY_MCP_BRIDGE_URL: Boolean(process.env.RUNWAY_MCP_BRIDGE_URL),
  RUNWAY_MCP_BRIDGE_TOKEN: Boolean(process.env.RUNWAY_MCP_BRIDGE_TOKEN),
};
addCheck('local bridge env names', Object.values(localEnvPresence).every(Boolean), localEnvPresence);

const remoteSecretInspection = listRemoteSecretNames();
addCheck('remote Supabase secret name inspection', remoteSecretInspection.ok, remoteSecretInspection.check);
if (remoteSecretInspection.blocker) {
  addBlockerObject(remoteSecretInspection.blocker);
}

const remoteSecretPresence = requiredSecretPresence(remoteSecretInspection.names, [
  'RUNWAY_MCP_BRIDGE_URL',
  'RUNWAY_MCP_BRIDGE_TOKEN',
]);
if (remoteSecretInspection.ok) {
  addCheck('remote Supabase bridge secret names', Object.values(remoteSecretPresence).every(Boolean), {
    inspected: true,
    present: remoteSecretPresence,
  });
}

if (
  remoteSecretInspection.ok
  && (!remoteSecretPresence.RUNWAY_MCP_BRIDGE_URL || !remoteSecretPresence.RUNWAY_MCP_BRIDGE_TOKEN)
) {
  addBlocker(
    'production_runway_mcp_bridge_pending',
    'Supabase production secrets do not contain both RUNWAY_MCP_BRIDGE_URL and RUNWAY_MCP_BRIDGE_TOKEN.',
    'Set both secrets to a bridge connected to official Runway MCP, then rerun npm run verify:runway-readiness.',
  );
}

const brand = await selectSingle('brands', 'id, name, owner_id, created_at, updated_at', (query) => query.eq('id', brandId));
addCheck('target brand exists', !brand.error && Boolean(brand.data), brand.error ? { error: brand.error.message } : { brand: projectBrand(brand.data) });
const brandReadbackBlocker = dbReadbackBlocker('brands', brand.error);
if (brandReadbackBlocker) {
  addBlockerObject(brandReadbackBlocker);
} else if (!brand.data) {
  addBlocker('target_brand_missing', `Brand ${brandId} was not found.`, 'Use --brand-id with the target production brand.');
  finish();
}

const approval = await selectSingle(
  'runway_mcp_connection_approvals',
  'brand_id, status, requested_by, approved_by, requested_at, approved_at, rejected_at, revoked_at, updated_at',
  (query) => query.eq('brand_id', brandId),
);
addCheck(
  'Runway MCP site approval',
  !approval.error && approval.data?.status === 'approved',
  approval.error ? { error: approval.error.message } : { approval: approval.data || null },
);
const approvalReadbackBlocker = dbReadbackBlocker('runway_mcp_connection_approvals', approval.error);
if (approvalReadbackBlocker) {
  addBlockerObject(approvalReadbackBlocker);
} else if (approval.data?.status !== 'approved') {
  addBlocker(
    'production_runway_mcp_site_approval_pending',
    `Runway MCP approval status is ${approval.data?.status || 'missing'}, not approved.`,
    'Request connection from /brand/settings and approve it from /admin?tab=runway.',
  );
}

const oauthConnection = await selectSingle(
  'runway_mcp_oauth_connections',
  'brand_id, status, connected_by, expires_at, last_verified_at, last_error, updated_at',
  (query) => query.eq('brand_id', brandId),
);
addCheck(
  'Runway MCP OAuth connection',
  !oauthConnection.error && oauthConnection.data?.status === 'connected',
  oauthConnection.error ? { error: oauthConnection.error.message } : { connection: oauthConnection.data || null },
);
const oauthReadbackBlocker = dbReadbackBlocker('runway_mcp_oauth_connections', oauthConnection.error);
if (oauthReadbackBlocker) {
  addBlockerObject(oauthReadbackBlocker);
} else if (oauthConnection.data?.status !== 'connected') {
  addBlocker(
    'production_runway_mcp_oauth_connection_pending',
    `Runway MCP OAuth connection status is ${oauthConnection.data?.status || 'missing'}, not connected.`,
    'Open /brand/settings, click Runwayに接続, complete Runway login, then rerun npm run verify:runway-readiness.',
  );
}

const subscription = await selectSingle(
  'brand_subscriptions',
  'brand_id, status, current_period_start, current_period_end, quota_override, plan_id, plans(id, code, name, monthly_quota, features, is_active)',
  (query) => query.eq('brand_id', brandId),
);
const subscriptionProjection = projectSubscription(subscription.data);
const subscriptionEligible = isEligibleRunwaySubscription(subscriptionProjection, now);
addCheck(
  'Heavy Chain eligible paid subscription',
  !subscription.error && subscriptionEligible,
  subscription.error ? { error: subscription.error.message } : { subscription: subscriptionProjection },
);
const subscriptionReadbackBlocker = dbReadbackBlocker('brand_subscriptions', subscription.error);
if (subscriptionReadbackBlocker) {
  addBlockerObject(subscriptionReadbackBlocker);
} else if (!subscriptionEligible) {
  addBlocker(
    'heavy_chain_paid_subscription_pending',
    'The target brand does not currently have an active/trialing paid plan with runway_mcp_generation enabled.',
    'Complete the billing/subscription decision without bypassing payment rules, then rerun npm run verify:runway-readiness.',
  );
}

const recentUsage = await selectRows(
  'usage_events',
  'id, function_name, status, units, request_id, reserved_at, completed_at, created_at',
  (query) => query.eq('brand_id', brandId).order('created_at', { ascending: false }).limit(10),
);
addCheck('recent usage readable', !recentUsage.error, recentUsage.error ? { error: recentUsage.error.message } : {
  count: recentUsage.data.length,
  rows: recentUsage.data.map((row) => ({
    id: row.id,
    function_name: row.function_name,
    status: row.status,
    units: row.units,
    reserved_at: row.reserved_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
  })),
});
const usageReadbackBlocker = dbReadbackBlocker('usage_events', recentUsage.error);
if (usageReadbackBlocker) {
  addBlockerObject(usageReadbackBlocker);
}

if (proof.blockers.length === 0) {
  proof.next_actions.push('Readiness passed. Run the approved-brand production generation proof, then DB/Storage/UI readback and cleanup.');
} else {
  proof.next_actions.push('Do not run production Runway generation yet. Resolve blockers listed above first.');
}

finish();

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--brand-id' && next) {
      parsed.brandId = next;
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

function readTextIfExists(filePath) {
  if (!existsSync(filePath)) return '';
  return readFileSync(filePath, 'utf8').trim();
}

function projectRefFromUrl(value) {
  if (!value) return '';
  return /^https:\/\/([^.]+)\.supabase\.co/.exec(value)?.[1] || '';
}

function firstRealValue(...values) {
  return values.find((value) => value && !isPlaceholder(value)) || '';
}

function isPlaceholder(value) {
  return !value || /\b(PROJECT_REF|YOUR_|REPLACE_ME|example\.com)\b/i.test(String(value));
}

function listRemoteSecretNames() {
  const result = projectRef
    ? spawnSync('supabase', ['secrets', 'list', '--project-ref', projectRef, '--output-format', 'json'], {
      encoding: 'utf8',
      shell: false,
      env: cliEnv(),
    })
    : { status: null, stdout: '', stderr: '' };

  return projectRemoteSecretInspection({
    projectRef,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

function cliEnv() {
  const env = { ...process.env };
  if (env.SUPABASE_ACCESS_TOKEN && !env.SUPABASE_ACCESS_TOKEN.startsWith('sbp_')) {
    delete env.SUPABASE_ACCESS_TOKEN;
  }
  return env;
}

async function selectSingle(table, columns, apply) {
  let query = supabase.from(table).select(columns);
  query = apply(query);
  const { data, error } = await query.maybeSingle();
  return { data, error };
}

async function selectRows(table, columns, apply) {
  let query = supabase.from(table).select(columns);
  query = apply(query);
  const { data, error } = await query;
  return { data: Array.isArray(data) ? data : [], error };
}

function addCheck(name, passed, details = {}) {
  proof.checks.push({
    name,
    passed: Boolean(passed),
    details: redactObject(details),
  });
}

function addBlocker(code, message, nextAction) {
  proof.blockers.push({ code, message, next_action: nextAction });
}

function addBlockerObject(blocker) {
  proof.blockers.push(blocker);
}

function finish() {
  proof.ready = proof.blockers.length === 0;
  const raw = `${JSON.stringify(redactObject(proof), null, 2)}\n`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, raw);

  if (!proof.ready) {
    console.error(`Runway production readiness blocked. Proof: ${outPath}`);
    for (const blocker of proof.blockers) {
      console.error(`- ${blocker.code}: ${blocker.message}`);
    }
    process.exit(1);
  }

  console.log(`Runway production readiness passed. Proof: ${outPath}`);
}
