#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNTIME_PATHS = ['src', 'cloudflare/heavy-api/src', 'cloudflare/heavy-web/src'];
export const LEGACY_FUNCTION_ROOT = 'supabase/functions';
export const SCHEMA = 'heavy-chain.supabase-cloudflare-migration-audit.v1';

const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.sh', '.bash', '.zsh', '.ts', '.tsx']);
const RUNTIME_MARKERS = [
  { id: 'supabase-sdk-import', pattern: /(?:@supabase\/|(?:from|require|import)\s*\(?\s*["']supabase(?:\/|["'])|createClient\s*\([^\n]*(?:supabase|SUPABASE))/i },
  { id: 'supabase-url', pattern: /https?:\/\/[^\s"'`]*supabase\.co(?:[^\s"'`]*)?/i },
  { id: 'supabase-env', pattern: /\b(?:import\.meta\.env|process\.env|Deno\.env)\s*(?:\.|\[['"])(?:VITE_|NEXT_PUBLIC_|PUBLIC_)?SUPABASE_[A-Z0-9_]+/i },
  { id: 'supabase-rest-call', pattern: /["'`]\/rest\/v1\//i },
  { id: 'supabase-storage-call', pattern: /["'`]\/storage\/v1\//i },
  { id: 'supabase-edge-call', pattern: /["'`]\/functions\/v1\//i },
  { id: 'supabase-client-call', pattern: /\bsupabase\s*\.\s*(?:auth|from|storage|functions|rpc|channel)\s*\(/i },
  { id: 'supabase-functions-invoke', pattern: /\bsupabase\s*\.\s*functions\s*\.\s*invoke\s*\(/i },
];

const ENV_NAME_PATTERN = /\b(?:import\.meta\.env|process\.env|Deno\.env)\s*(?:\.|\[['"])((?:VITE_|NEXT_PUBLIC_|PUBLIC_)?SUPABASE_[A-Z0-9_]+)\b/gi;
const LEGACY_ENV_NAME_PATTERN = /^(?:export\s+)?((?:VITE_)?SUPABASE_[A-Z0-9_]+)\s*=/gim;
const HISTORICAL_SCRIPT_PATTERN = /(?:^|\/)verify-g701-visible-fitting-prod-e2e\.mjs$/i;
const compareStrings = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function posixPath(value) {
  return value.split('\\').join('/');
}

function relativePath(rootDir, filePath) {
  return posixPath(relative(rootDir, filePath));
}

function isDirectory(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function isFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

function walkFiles(root) {
  if (!isDirectory(root)) return [];
  const result = [];
  for (const entry of readdirSync(root).sort(compareStrings)) {
    const path = join(root, entry);
    if (isDirectory(path)) result.push(...walkFiles(path));
    else if (isFile(path)) result.push(path);
  }
  return result;
}

function walkDirectories(root) {
  if (!isDirectory(root)) return [];
  const result = [];
  for (const entry of readdirSync(root).sort(compareStrings)) {
    const path = join(root, entry);
    if (isDirectory(path)) result.push(path, ...walkDirectories(path));
  }
  return result;
}

/** Replace comments with whitespace while preserving line/column positions. */
export function maskComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (value) => value.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/gm, (value, prefix) => `${prefix}${' '.repeat(Math.max(0, value.length - prefix.length))}`)
    .replace(/^\s*#(?!\!)[^\n]*/gm, (value) => value.replace(/[^\n]/g, ' '));
}

export function classifyPath(path) {
  const normalized = posixPath(path).toLowerCase();
  if (/(?:^|\/)test(?:s)?(?:\/|\.|$)|(?:^|[./])[^/]*\.test\.[cm]?[jt]sx?$/.test(normalized)) return 'test';
  if (/(?:^|\/)(?:docs?|documentation)(?:\/|$)|\.(?:md|mdx|txt|rst)$/.test(normalized)) return 'docs';
  if (/(?:^|\/)(?:dist|build|generated|coverage|output)(?:\/|$)|\.map$/.test(normalized)) return 'generated';
  if (normalized === LEGACY_FUNCTION_ROOT || normalized.startsWith(`${LEGACY_FUNCTION_ROOT}/`)) return 'retained legacy';
  if (RUNTIME_PATHS.some((root) => normalized === root || normalized.startsWith(`${root}/`))) return 'active runtime';
  return 'unknown';
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

function readText(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

function scanRuntimeFile(rootDir, path) {
  const source = readText(path);
  if (source === null) return { path: relativePath(rootDir, path), classification: 'active runtime', unreadable: true, markers: [], envVariables: [] };
  const masked = maskComments(source);
  const rel = relativePath(rootDir, path);
  const classification = classifyPath(rel);
  if (classification === 'test' || classification !== 'active runtime') return { path: rel, classification, markers: [], envVariables: [] };

  const markers = [];
  for (const marker of RUNTIME_MARKERS) {
    marker.pattern.lastIndex = 0;
    const match = marker.pattern.exec(masked);
    if (match) markers.push({ id: marker.id, line: lineNumber(source, match.index) });
  }
  const envVariables = [...masked.matchAll(ENV_NAME_PATTERN)].map((match) => ({ name: match[1], line: lineNumber(source, match.index) }));
  return { path: rel, classification, markers, envVariables };
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function readLegacyEnvFiles(rootDir) {
  return readdirSync(rootDir).filter((entry) => entry.startsWith('.env') && isFile(join(rootDir, entry)))
    .sort(compareStrings)
    .map((entry) => {
      const source = readText(join(rootDir, entry)) ?? '';
      const names = [];
      for (const match of source.matchAll(LEGACY_ENV_NAME_PATTERN)) names.push(match[1]);
      return { path: entry, variableNames: uniqueSorted(names) };
    })
    .filter(({ variableNames }) => variableNames.length > 0);
}

export function scanHeavySupabaseCloudflareMigrationAudit(options = {}) {
  const rootDir = resolve(typeof options === 'string' ? options : options.root ?? options.rootDir ?? process.cwd());
  const runtimeFiles = RUNTIME_PATHS.flatMap((runtimeRoot) => walkFiles(join(rootDir, runtimeRoot)))
    .filter((path) => SOURCE_EXTENSIONS.has(extname(path).toLowerCase()))
    .sort((a, b) => compareStrings(relativePath(rootDir, a), relativePath(rootDir, b)));
  const scanned = runtimeFiles.map((path) => scanRuntimeFile(rootDir, path));
  const findings = scanned.flatMap((file) => file.markers.map((marker) => ({
    classification: file.classification,
    line: marker.line,
    marker: marker.id,
    path: file.path,
  })));
  const envFiles = readLegacyEnvFiles(rootDir);
  const envVariables = uniqueSorted([
    ...scanned.flatMap((file) => file.envVariables.map(({ name }) => name)),
    ...envFiles.flatMap((file) => file.variableNames),
  ]);

  const legacyRoot = join(rootDir, LEGACY_FUNCTION_ROOT);
  const legacyFunctionDirectories = walkDirectories(legacyRoot).map((path) => relativePath(rootDir, path));
  const legacyFunctionFiles = walkFiles(legacyRoot).map((path) => relativePath(rootDir, path));
  const manualScripts = walkFiles(join(rootDir, 'scripts'))
    .filter((path) => SOURCE_EXTENSIONS.has(extname(path).toLowerCase()))
    .map((path) => ({ path, relative: relativePath(rootDir, path), source: readText(path) ?? '' }))
    .filter(({ relative, source }) => classifyPath(relative) !== 'test'
      && (/(?:^|\/)(?:supabase-prod-verify|deploy-edge-functions|smoke-edge-functions)\./i.test(relative)
        || (extname(relative).toLowerCase() === '.sh'
          && /\bsupabase\s+(?:functions\s+)?(?:serve|deploy|invoke|start|stop)\b/i.test(maskComments(source)))))
    .map(({ relative }) => ({ path: relative, classification: 'retained legacy' }))
    .sort((a, b) => compareStrings(a.path, b.path));
  const historicalScripts = walkFiles(join(rootDir, 'scripts'))
    .filter((path) => HISTORICAL_SCRIPT_PATTERN.test(relativePath(rootDir, path)))
    .map((path) => ({ path: relativePath(rootDir, path), classification: 'retained legacy' }))
    .sort((a, b) => compareStrings(a.path, b.path));

  const classifications = { 'active runtime': 0, 'retained legacy': 0, test: 0, docs: 0, generated: 0, unknown: 0 };
  for (const file of scanned) classifications[file.classification] += 1;
    classifications['retained legacy'] += legacyFunctionFiles.length + manualScripts.length;
  const migrationGates = {
    activeRuntimeMarkersAbsent: { ok: findings.length === 0, detail: 'No reachable Supabase SDK, URL, env, REST, Storage, or Edge marker in runtime paths.' },
    legacyInventorySeparated: { ok: true, detail: 'Legacy function directories and manual scripts are inventoried separately.' },
    envValuesRedacted: { ok: true, detail: 'Only environment variable names are emitted.' },
    externalActionsDisabled: { ok: true, detail: 'This utility performs no network, deploy, or CLI action.' },
    copyAllowed: false,
    sourceDeleteAllowed: false,
  };

  return {
    schema: SCHEMA,
    ok: findings.length === 0,
    counts: {
      runtimeFiles: runtimeFiles.length,
      runtimeMarkers: findings.length,
      legacyFunctionDirectories: legacyFunctionDirectories.length,
      legacyFunctionFiles: legacyFunctionFiles.length,
      manualScripts: manualScripts.length,
      envVariables: envVariables.length,
      classifications,
    },
    runtimePaths: [...RUNTIME_PATHS],
    findings,
    envVariables,
    envFiles,
    legacy: { functionDirectories: legacyFunctionDirectories, functionFiles: legacyFunctionFiles, manualScripts, historicalScripts },
    cloudflareReplacementMap: {
      auth: 'cloudflare/consumer-auth',
      database: 'Cloudflare D1 via cloudflare/heavy-api',
      storage: 'private Cloudflare R2 via authenticated heavy-api gateway',
      edgeFunctions: 'Cloudflare Worker routes in cloudflare/heavy-api/src',
      publicApiOrigin: 'Cloudflare Worker deployment origin',
    },
    migrationGates,
    copyAllowed: false,
    sourceDeleteAllowed: false,
    externalActions: 'none',
  };
}

export const verifyHeavySupabaseCloudflareMigrationAudit = scanHeavySupabaseCloudflareMigrationAudit;
export default scanHeavySupabaseCloudflareMigrationAudit;

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const result = scanHeavySupabaseCloudflareMigrationAudit({ rootDir: process.cwd() });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
