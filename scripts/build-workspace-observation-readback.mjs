#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { apiOrigin, validID } from './monitor-production-health.mjs';

const SENSITIVE_KEY = /(token|cookie|authorization|secret|api[ _-]?key|password|session|signed[ _-]?url)/i;
const SENSITIVE_VALUE = /(bearer\s|sk-[A-Za-z0-9]|https?:\/\/[^\s?]+\?[^\s]+)/i;
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const boundedText = (value, name) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\r\n]/.test(value)) throw new Error('invalid_' + name);
  if (SENSITIVE_VALUE.test(value)) throw new Error('sensitive_observation_input');
  return value.trim();
};
const optionalText = (value, name) => value == null ? null : boundedText(value, name);

function rejectSensitiveKeys(value) {
  if (Array.isArray(value)) {
    for (const item of value) rejectSensitiveKeys(item);
    return;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && SENSITIVE_VALUE.test(value)) throw new Error('sensitive_observation_input');
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) throw new Error('sensitive_observation_input');
    rejectSensitiveKeys(item);
  }
}

function normalizeObservation(value) {
  const row = record(value);
  const route = boundedText(row.route ?? row.path, 'observation_route');
  if (!route.startsWith('/')) throw new Error('invalid_observation_route');
  const observation = { route, title: optionalText(row.title, 'observation_title'),
    status: optionalText(row.status, 'observation_status'),
    generationModel: optionalText(row.generationModel ?? row.generation_model, 'generation_model'),
    entitlement: optionalText(row.entitlement, 'observation_entitlement'),
    termsAccepted: row.termsAccepted == null ? null : row.termsAccepted === true,
    rightsAttestationRequired: row.rightsAttestationRequired == null ? null : row.rightsAttestationRequired === true,
    rightsAttestationChecked: row.rightsAttestationChecked == null ? null : row.rightsAttestationChecked === true,
    generateEnabled: row.generateEnabled == null ? null : row.generateEnabled === true,
  };
  return observation;
}

/**
 * Build a credential-free operational observation artifact.
 *
 * This is deliberately not the production API monitor: it does not authenticate,
 * call Heavy API, claim provider execution, or satisfy the release gate.
 */
export function buildWorkspaceObservationReadback(input, now = Date.now()) {
  const value = record(input);
  rejectSensitiveKeys(value);
  const origin = apiOrigin(value.apiOrigin);
  if (!validID(value.brandId)) throw new Error('invalid_brand_id');
  if (value.runId != null && !validID(value.runId)) throw new Error('invalid_run_id');
  const observedAt = value.observedAt == null ? new Date(now).toISOString() : new Date(value.observedAt).toISOString();
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('invalid_observed_at');
  if (!Array.isArray(value.observations) || value.observations.length > 100) throw new Error('invalid_observations');
  const observations = value.observations.map(normalizeObservation);
  const limitations = Array.isArray(value.limitations) ? value.limitations.map((item) => boundedText(item, 'limitation')).slice(0, 32) : [];
  const blockers = Array.isArray(value.blockers) ? value.blockers.map((item) => boundedText(item, 'blocker')).slice(0, 32) : [];
  return {
    schema: 'heavy-chain.workspace-readback.v1',
    capturedAt: new Date(now).toISOString(),
    observedAt,
    mode: 'companion_authenticated_workspace_readback',
    purpose: 'operational_observation',
    releaseEligible: false,
    provenance: {
      source: 'aos_chrome_companion',
      credentialMode: 'no_api_credential',
      trustedIssuerRequired: true,
      issuerVerified: false,
    },
    scope: { apiOrigin: origin, brandId: value.brandId, runId: value.runId ?? null },
    observations,
    coverage: {
      ui: 'semantic_and_visual_readback_only',
      api: 'not_checked',
      provider: 'not_checked',
      storage: 'not_checked',
      rightsAttestation: 'not_attested',
      billing: 'not_verified',
    },
    limitations: [...new Set([
      ...limitations,
      'does_not_authenticate_to_heavy_api',
      'does_not_claim_provider_generation_or_persistence',
      'does_not_satisfy_production_monitor_or_release_gate',
      'legal_rights_attestation_remains_user_owned',
    ])],
    blockers,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    input: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Build a credential-free Heavy Companion UI observation artifact. Requires --input JSON and optional --out FILE. This never calls Heavy API and is never release-eligible.');
    return;
  }
  if (!values.input) throw new Error('observation_input_required');
  const parsed = JSON.parse(await readFile(values.input, 'utf8'));
  const report = buildWorkspaceObservationReadback(parsed);
  const out = values.out ?? 'output/heavy-workspace-observation-' + report.capturedAt.replace(/[:.]/g, '-') + '.json';
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ out, releaseEligible: report.releaseEligible, observations: report.observations.length }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main().catch(() => { console.error('workspace_observation_failed: input rejected or invalid; credentials not accepted'); process.exitCode = 1; });
}
