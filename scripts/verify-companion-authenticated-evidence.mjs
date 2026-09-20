#!/usr/bin/env node

import fs from 'node:fs';

const args = parseArgs(process.argv.slice(2));
const evidencePath = args.evidence || 'work/heavy-chain-companion-authenticated-evidence-20260912.json';
const expectedOrigin = 'https://heavy-chain-web.nichika2000823.workers.dev';
const expectedRoutes = ['/model', '/gallery', '/history', '/jobs', '/canvas/new'];
const failures = [];

let evidence = null;
try {
  evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
} catch (error) {
  failures.push(`evidence_unreadable:${error instanceof Error ? error.message : String(error)}`);
}

if (evidence) {
  requireEqual('schema', evidence.schema, 'heavy-chain.companion-authenticated-production-evidence.v1');
  requireEqual('source', evidence.source, 'aos_chrome_companion_profile_instance');
  requireNonEmpty('taskId', evidence.taskId);
  requireNonEmpty('sessionId', evidence.sessionId);
  requireInteger('tabId', evidence.tabId);
  requireNonEmpty('generation', evidence.generation);
  requireEqual('origin', evidence.origin, expectedOrigin);
  requireEqual('authSecretExported', evidence.authSecretExported, false);
  if (!Array.isArray(evidence.routes)) failures.push('routes_not_array');
  else {
    const actualRoutes = evidence.routes.map((route) => route?.path);
    requireEqual('route_count', actualRoutes.length, expectedRoutes.length);
    for (const route of expectedRoutes) {
      if (!evidence.routes.some((item) => item?.path === route)) failures.push(`route_missing:${route}`);
    }
    for (const route of evidence.routes) {
      requireEqual(`route.${route?.path}.semanticReadback`, route?.semanticReadback, 'verified');
      requireEqual(`route.${route?.path}.visualReadback`, route?.visualReadback, 'verified');
      requireEqual(`route.${route?.path}.readyState`, route?.readyState, 'complete');
      if (!['avatar', 'canvas-save'].includes(route?.authMarker)) failures.push(`route.${route?.path}.auth_marker_missing`);
      if (!Array.isArray(route?.routeMarkers) || route.routeMarkers.length === 0) failures.push(`route_markers_missing:${route?.path}`);
    }
  }
  requireEqual('providerReceipt', evidence.businessCompletion?.providerReceipt, 'unverified');
  requireEqual('sourceSync', evidence.businessCompletion?.sourceSync, 'unverified');
  requireEqual('reconciliation', evidence.businessCompletion?.reconciliation, 'unverified');
  if (containsSensitiveMaterial(evidence)) failures.push('sensitive_material_detected');
}

const result = {
  ok: failures.length === 0,
  schema: 'heavy-chain.companion-authenticated-evidence-verification.v1',
  evidencePath,
  authStateRequired: false,
  productionOrigin: expectedOrigin,
  failures,
  businessCompletion: 'separate_provider_source_reconciliation_cleanup_gate',
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg.startsWith('--') && next && !next.startsWith('--')) {
      parsed[arg.slice(2)] = next;
      index += 1;
    }
  }
  return parsed;
}

function requireEqual(name, actual, expected) {
  if (actual !== expected) failures.push(`${name}_mismatch`);
}

function requireNonEmpty(name, value) {
  if (typeof value !== 'string' || value.trim() === '') failures.push(`${name}_missing`);
}

function requireInteger(name, value) {
  if (!Number.isInteger(value)) failures.push(`${name}_invalid`);
}

function containsSensitiveMaterial(value, key = '') {
  const sensitiveKey = /cookie|token|authorization|password|secret|otp|captcha|formValue|access[_-]?token|refresh[_-]?token/i.test(key);
  if (sensitiveKey && value !== false && value !== 'unverified') return true;
  if (typeof value === 'string') {
    return /Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => containsSensitiveMaterial(item, key));
  if (value && typeof value === 'object') return Object.entries(value).some(([childKey, child]) => containsSensitiveMaterial(child, childKey));
  return false;
}
