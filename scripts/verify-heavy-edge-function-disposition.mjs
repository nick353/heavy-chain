#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MATRIX_PATH = 'work/heavy-edge-function-disposition-matrix.v1.json';
export const MATRIX_SCHEMA = 'heavy-chain-edge-function-disposition-matrix.v1';
export const FUNCTION_ENTRYPOINTS = [
  'bulk-download', 'canvas-document', 'colorize', 'design-gacha', 'edit-image', 'generate-image',
  'generate-variations', 'marketing-workspace-artifact', 'media-gateway', 'model-matrix',
  'multilingual-banner', 'optimize-prompt', 'product-shots', 'remove-background',
  'runway-mcp-bridge', 'runway-mcp-connect-callback', 'runway-mcp-connect-start',
  'runway-mcp-connection-status', 'share-link', 'submit-feedback', 'upscale',
];
const STATUSES = new Set(['represented', 'legacy_only', 'unrepresented', 'decision_required']);
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function issue(code, entrypoint, detail) { return { code, ...(entrypoint ? { entrypoint } : {}), detail }; }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonEmpty(value) { return typeof value === 'string' && value.trim().length > 0; }
function readText(path) { try { return readFileSync(path, 'utf8'); } catch { return null; } }

function routeExists(route, source) {
  if (!nonEmpty(route)) return false;
  if (source.includes(route)) return true;
  const prefix = route.replace(/:[^/]+/g, '').replace(/\/$/, '');
  if (!prefix) return false;
  const escapedSource = source.replaceAll('\\/', '/').replaceAll('\\"', '"');
  return escapedSource.includes(prefix);
}

function handlerExists(handler, source) {
  return nonEmpty(handler) && new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${handler}\\b|(?:const|let)\\s+${handler}\\s*=`).test(source);
}

export function validateHeavyEdgeFunctionDispositionMatrix(matrix, options = {}) {
  const root = resolve(options.root ?? options.rootDir ?? process.cwd());
  const structuralIssues = [];
  const targetIssues = [];
  if (!record(matrix) || matrix.schema !== MATRIX_SCHEMA) structuralIssues.push(issue('invalid_matrix_schema', undefined, MATRIX_SCHEMA));
  const entries = Array.isArray(matrix?.entries) ? matrix.entries : [];
  if (!Array.isArray(matrix?.entries)) structuralIssues.push(issue('missing_entries', undefined, 'entries must be an array'));
  const names = entries.map((entry) => entry?.name).filter(nonEmpty);
  for (const name of FUNCTION_ENTRYPOINTS) if (!names.includes(name)) structuralIssues.push(issue('missing_entrypoint', name, 'known Supabase function entrypoint is absent'));
  for (const name of [...new Set(names)].sort(compare)) if (names.filter((candidate) => candidate === name).length !== 1) structuralIssues.push(issue('duplicate_entrypoint', name, 'entrypoint must occur exactly once'));
  for (const entry of entries) {
    const name = nonEmpty(entry?.name) ? entry.name : undefined;
    if (!name) { structuralIssues.push(issue('invalid_entrypoint', undefined, 'name is required')); continue; }
    if (!STATUSES.has(entry.status)) structuralIssues.push(issue('invalid_status', name, 'invalid disposition status'));
    const evidence = entry.sourceEvidence;
    const sourcePath = record(evidence) && nonEmpty(evidence.path) ? evidence.path : null;
    const sourceKind = evidence?.kind ?? 'entrypoint_file';
    const sourceFile = sourcePath?.endsWith('.ts') ? sourcePath : sourcePath ? `${sourcePath}/index.ts` : null;
    const sourceExists = sourceKind === 'directory_only'
      ? Boolean(sourcePath && existsSync(join(root, sourcePath)))
      : Boolean(sourceFile && existsSync(join(root, sourceFile)));
    if (!record(evidence) || !nonEmpty(evidence.path) || !nonEmpty(evidence.entrypoint)
      || !['entrypoint_file', 'directory_only'].includes(sourceKind) || !sourceExists
      || (sourceKind === 'directory_only' && !nonEmpty(evidence.note))) {
      structuralIssues.push(issue('missing_source_evidence', name, sourceFile ?? evidence?.path ?? null));
    }
    if (sourceKind === 'directory_only' && entry.status === 'represented') {
      structuralIssues.push(issue('represented_requires_source_file', name, sourcePath));
    }
    if (!nonEmpty(entry.caller) || !nonEmpty(entry.authPermissions) || !Array.isArray(entry.dbStorageDeps) || !Array.isArray(entry.externalEffects) || !record(entry.asyncGuarantees)) structuralIssues.push(issue('incomplete_disposition', name, 'caller/auth/DB-storage/effects/async guarantees are required'));
    if (entry.status === 'legacy_only' && !nonEmpty(entry.currentUnusedRationale)) structuralIssues.push(issue('legacy_rationale_required', name, 'legacy_only requires explicit current-unused rationale'));
    if (entry.status === 'represented') {
      const target = entry.cloudflareTarget;
      if (!record(target) || !nonEmpty(target.route) || !nonEmpty(target.handler) || !nonEmpty(target.evidencePath)) { structuralIssues.push(issue('missing_cloudflare_target', name, 'represented requires route, handler, and evidencePath')); continue; }
      const source = readText(join(root, target.evidencePath));
      const handlerSource = readText(join(root, target.handlerEvidencePath ?? target.evidencePath));
      if (source === null) targetIssues.push(issue('missing_target_evidence', name, target.evidencePath));
      else {
        if (!routeExists(target.route, source)) targetIssues.push(issue('fictional_target_route', name, target.route));
        if (handlerSource === null || !handlerExists(target.handler, handlerSource)) targetIssues.push(issue('fictional_target_handler', name, target.handler));
      }
    }
  }
  const issues = [...structuralIssues, ...targetIssues].sort((left, right) => compare(JSON.stringify(left), JSON.stringify(right)));
  const contractValid = issues.length === 0;
  const migrationPreparationComplete = contractValid && entries.length === FUNCTION_ENTRYPOINTS.length && entries.every((entry) => entry.status === 'represented');
  const counts = { expectedEntrypoints: FUNCTION_ENTRYPOINTS.length, entries: entries.length, represented: entries.filter((entry) => entry.status === 'represented').length, legacyOnly: entries.filter((entry) => entry.status === 'legacy_only').length, unrepresented: entries.filter((entry) => entry.status === 'unrepresented').length, decisionRequired: entries.filter((entry) => entry.status === 'decision_required').length, issues: issues.length };
  return { schema: 'heavy-chain-edge-function-disposition-verifier.v1', contractValid, migrationPreparationComplete, counts, sourceEntrypoints: [...FUNCTION_ENTRYPOINTS], issues, sourceDeleteAllowed: false, externalEffects: 'none', root };
}

export default validateHeavyEdgeFunctionDispositionMatrix;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const path = join(root, MATRIX_PATH);
  const matrix = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  const result = validateHeavyEdgeFunctionDispositionMatrix(matrix, { root });
  console.log(JSON.stringify(result, null, 2));
  if (!result.contractValid) process.exitCode = 1;
}
