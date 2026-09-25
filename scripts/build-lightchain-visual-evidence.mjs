#!/usr/bin/env node

/**
 * Assemble source/Heavy visual evidence without upgrading a Heavy capture into
 * a Light Chain capture.  This is intentionally a metadata gate: it checks
 * exact-route identity, image readability, hashes, provenance, and viewport
 * compatibility.  Pixel comparison remains a separate operation.
 */

import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

const SCHEMA = 'lightchain-visual-evidence.v1';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SOURCE_SCHEMA = 'light_chain_source_route_baseline.v1';

function fail(message) {
  throw new Error(message);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function normalizeRoute(value) {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate, 'https://lightchain.invalid');
    const route = `${url.pathname || '/'}${url.search}`;
    return route.startsWith('/') ? route : `/${route}`;
  } catch {
    const route = candidate.split('#', 1)[0];
    return route.startsWith('/') ? route : `/${route}`;
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function readPngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { ok: false, reason: 'not_a_png' };
  }
  // PNG IHDR is the first chunk in all captures accepted by this gate.
  const chunkLength = buffer.readUInt32BE(8);
  const type = buffer.toString('ascii', 12, 16);
  if (type !== 'IHDR' || chunkLength !== 13 || buffer.length < 29) {
    return { ok: false, reason: 'png_ihdr_missing' };
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!positiveInteger(width) || !positiveInteger(height)) {
    return { ok: false, reason: 'png_dimensions_invalid' };
  }
  return { ok: true, width, height };
}

function captureCandidate(candidate, route) {
  if (typeof candidate === 'string') {
    return { route, path: candidate };
  }
  const object = asObject(candidate);
  if (!object) return null;
  const path = text(object.path ?? object.file ?? object.imagePath ?? object.screenshot);
  if (!path) return null;
  return {
    route: normalizeRoute(object.route ?? route) ?? route,
    path,
    viewport: object.viewport,
    provenance: object.provenance,
    role: object.role ?? object.screenshotRole,
    source: object.source,
  };
}

function routeCaptureEntries(manifest, kind) {
  const entries = [];
  const object = asObject(manifest);
  if (!object) return entries;

  const push = (candidate, routeHint = null) => {
    const route = normalizeRoute(candidate?.route ?? routeHint);
    const captured = captureCandidate(candidate, route);
    if (captured?.route) entries.push(captured);
  };

  const enrich = (candidate, row) => {
    if (typeof candidate !== 'string') return candidate;
    return {
      path: candidate,
      viewport: row?.viewport,
      provenance: row?.provenance,
      role: row?.role ?? row?.screenshotRole,
      source: row?.source,
    };
  };

  for (const capture of Array.isArray(object.captures) ? object.captures : []) push(capture);
  for (const capture of Array.isArray(object.visualCaptures) ? object.visualCaptures : []) push(capture);

  const routes = Array.isArray(object.routes)
    ? object.routes
    : asObject(object.routes)
      ? Object.entries(object.routes).map(([route, value]) => ({ route, ...(asObject(value) ?? {}) }))
      : [];
  for (const row of routes) {
    const route = normalizeRoute(row?.route ?? row?.path ?? row?.url);
    if (!route) continue;
    const candidate = kind === 'source'
      ? (row.sourceScreenshot ?? row.sourceCapture ?? row.capture ?? row.screenshot ?? row.image)
      : (row.heavyScreenshot ?? row.heavyCapture ?? row.capture ?? row.screenshot ?? row.image);
    if (candidate) push(enrich(candidate, row), route);
  }

  // The workflow summary stores source-parity route results in this nested
  // collection.  The route field is authoritative; screenshot aliases are not
  // used to infer a route.
  const nestedResults = asObject(object.sourceReadback)?.results;
  for (const row of Array.isArray(nestedResults) ? nestedResults : []) {
    const route = normalizeRoute(row?.route ?? row?.url);
    if (!route) continue;
    const candidate = kind === 'source'
      ? (row.sourceScreenshot ?? row.sourceCapture)
      : (row.screenshot ?? row.heavyScreenshot ?? row.heavyCapture);
    if (candidate) push(enrich(candidate, row), route);
  }

  return entries;
}

function sourceRouteRows(manifest) {
  const object = asObject(manifest);
  if (!object) return [];
  if (Array.isArray(object.rows)) {
    return object.rows.map((row) => ({
      route: normalizeRoute(row?.path ?? row?.route ?? row?.url),
      status: text(row?.status) || 'unknown',
      raw: row,
    })).filter((row) => row.route);
  }
  if (Array.isArray(object.routes)) {
    return object.routes.map((row) => ({
      route: normalizeRoute(row?.path ?? row?.route ?? row?.url),
      status: text(row?.status ?? row?.source?.status) || 'unknown',
      raw: row,
    })).filter((row) => row.route);
  }
  if (asObject(object.routes)) {
    return Object.entries(object.routes).map(([route, raw]) => ({
      route: normalizeRoute(route),
      status: text(raw?.status ?? raw?.source?.status) || 'authenticated-ready',
      raw,
    })).filter((row) => row.route);
  }
  return [];
}

function inputTimestamp(manifest) {
  const object = asObject(manifest);
  const candidates = [object?.recordedAt, object?.observedAt, object?.capturedAt, object?.generatedAt];
  const valid = candidates.filter((value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)));
  return valid.sort()[0] ?? null;
}

function provenanceValue(candidate, kind) {
  const explicit = asObject(candidate?.provenance);
  const role = text(candidate?.role ?? explicit?.role);
  const source = text(candidate?.source ?? explicit?.source);
  return {
    source: source || null,
    role: role || null,
    accepted: kind === 'source'
      ? Boolean((/light\s*chain|source/i.test(`${source} ${role}`)) && !/heavy-observed-source-contract/i.test(role))
      : Boolean(/heavy|authenticated|production|local/i.test(`${source} ${role}`)),
  };
}

function viewportValue(candidate) {
  const viewport = asObject(candidate?.viewport);
  if (!viewport || !positiveInteger(viewport.width) || !positiveInteger(viewport.height)) return null;
  return { width: viewport.width, height: viewport.height };
}

async function inspectCapture(candidate, baseDirectory, kind, route) {
  if (!candidate) return { path: null, readable: false, reason: 'capture_missing' };
  const path = isAbsolute(candidate.path) ? candidate.path : resolve(baseDirectory, candidate.path);
  const provenance = provenanceValue(candidate, kind);
  const viewport = viewportValue(candidate);
  const result = {
    path,
    readable: false,
    bytes: null,
    sha256: null,
    dimensions: null,
    viewport,
    provenance,
  };
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) {
      result.reason = 'capture_not_a_file';
      return result;
    }
    const buffer = await readFile(path);
    const png = readPngDimensions(buffer);
    if (!png.ok) {
      result.reason = png.reason;
      return result;
    }
    result.readable = true;
    result.bytes = buffer.length;
    result.sha256 = sha256(buffer);
    result.dimensions = { width: png.width, height: png.height };
    return result;
  } catch (error) {
    result.reason = error?.code === 'ENOENT' ? 'capture_missing' : 'capture_unreadable';
    result.error = error?.code ?? 'unknown';
    return result;
  }
}

function duplicateRoutes(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.route, (counts.get(entry.route) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([route]) => route).sort();
}

function reasonsForPair(sourceCapture, heavyCapture, sourceRoute) {
  const reasons = [];
  if (!sourceCapture?.readable) reasons.push(`source_${sourceCapture?.reason ?? 'capture_missing'}`);
  if (!heavyCapture?.readable) reasons.push(`heavy_${heavyCapture?.reason ?? 'capture_missing'}`);
  if (sourceCapture?.readable && !sourceCapture.provenance.accepted) reasons.push('source_provenance_unverified');
  if (heavyCapture?.readable && !heavyCapture.provenance.accepted) reasons.push('heavy_provenance_unverified');
  if (sourceCapture?.readable && !sourceCapture.viewport) reasons.push('source_viewport_missing');
  if (heavyCapture?.readable && !heavyCapture.viewport) reasons.push('heavy_viewport_missing');
  if (sourceCapture?.viewport && heavyCapture?.viewport
      && (sourceCapture.viewport.width !== heavyCapture.viewport.width
        || sourceCapture.viewport.height !== heavyCapture.viewport.height)) {
    reasons.push('viewport_incompatible');
  }
  if (sourceRoute.status !== 'ok' && sourceRoute.status !== 'authenticated-ready') {
    reasons.push('source_route_not_ready');
  }
  return reasons;
}

export async function buildVisualEvidence({ sourceManifest, heavyManifest, sourceManifestPath = null, heavyManifestPath = null }) {
  const sourceObject = asObject(sourceManifest);
  const heavyObject = asObject(heavyManifest);
  if (!sourceObject || !heavyObject) fail('source_and_heavy_manifests_must_be_objects');

  const sourceRoutes = sourceRouteRows(sourceObject);
  const sourceCandidates = routeCaptureEntries(sourceObject, 'source');
  const heavyCandidates = routeCaptureEntries(heavyObject, 'heavy');
  const validationErrors = [];
  const duplicateSourceRoutes = duplicateRoutes(sourceRoutes);
  const duplicateSourceCaptures = duplicateRoutes(sourceCandidates);
  const duplicateHeavyCaptures = duplicateRoutes(heavyCandidates);
  for (const route of duplicateSourceRoutes) validationErrors.push(`duplicate_source_route:${route}`);
  for (const route of duplicateSourceCaptures) validationErrors.push(`duplicate_source_capture:${route}`);
  for (const route of duplicateHeavyCaptures) validationErrors.push(`duplicate_heavy_capture:${route}`);

  const sourceByRoute = new Map(sourceCandidates.map((entry) => [entry.route, entry]));
  const heavyByRoute = new Map(heavyCandidates.map((entry) => [entry.route, entry]));
  const sourceBase = sourceManifestPath ? dirname(resolve(sourceManifestPath)) : process.cwd();
  const heavyBase = heavyManifestPath ? dirname(resolve(heavyManifestPath)) : process.cwd();
  const routes = [];

  for (const sourceRoute of sourceRoutes) {
    if (sourceRoute.status !== 'ok' && sourceRoute.status !== 'authenticated-ready') {
      routes.push({
        route: sourceRoute.route,
        status: 'source_404_excluded',
        sourceStatus: sourceRoute.status,
        sourceCapture: null,
        heavyCapture: null,
        comparison: { status: 'not_applicable' },
        reasons: ['source_route_not_available'],
      });
      continue;
    }

    const sourceCandidate = sourceByRoute.get(sourceRoute.route) ?? null;
    const heavyCandidate = heavyByRoute.get(sourceRoute.route) ?? null;
    const sourceCapture = await inspectCapture(sourceCandidate, sourceBase, 'source', sourceRoute.route);
    const heavyCapture = await inspectCapture(heavyCandidate, heavyBase, 'heavy', sourceRoute.route);
    const reasons = reasonsForPair(sourceCapture, heavyCapture, sourceRoute);
    const ready = reasons.length === 0;
    routes.push({
      route: sourceRoute.route,
      status: ready ? 'ready_for_comparison' : 'pending_confirmation',
      sourceStatus: sourceRoute.status,
      sourceCapture,
      heavyCapture,
      comparison: { status: ready ? 'ready' : 'not_run' },
      reasons,
    });
  }

  const readyCount = routes.filter((route) => route.status === 'ready_for_comparison').length;
  const pendingCount = routes.filter((route) => route.status === 'pending_confirmation').length;
  const excludedCount = routes.filter((route) => route.status === 'source_404_excluded').length;
  return {
    schema: SCHEMA,
    deterministic: true,
    source: {
      schema: sourceObject.schema ?? null,
      origin: sourceObject.origin ?? null,
      observedAt: inputTimestamp(sourceObject),
      manifestPath: sourceManifestPath ? resolve(sourceManifestPath) : null,
    },
    heavy: {
      schema: heavyObject.schema ?? null,
      capturedAt: inputTimestamp(heavyObject),
      manifestPath: heavyManifestPath ? resolve(heavyManifestPath) : null,
    },
    routes,
    summary: {
      total: routes.length,
      readyForComparison: readyCount,
      pendingConfirmation: pendingCount,
      source404Excluded: excludedCount,
    },
    validationErrors: [...new Set(validationErrors)].sort(),
    ok: validationErrors.length === 0,
    noFabricationGuard: {
      sourceAndHeavyCapturesMustBeIndependent: true,
      heavyObservedSourceContractIsNotSourceEvidence: true,
      missingImagesRemainPending: true,
    },
  };
}

export async function readJsonManifest(filePath) {
  const resolved = resolve(filePath);
  return { value: JSON.parse(await readFile(resolved, 'utf8')), path: resolved };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--source', '--heavy', '--out'].includes(flag)) fail(`Unknown argument: ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) fail(`Missing value for ${flag}`);
    args[flag.slice(2)] = value;
  }
  for (const key of ['source', 'heavy', 'out']) if (!args[key]) fail(`Missing required argument: --${key}`);
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  const source = await readJsonManifest(args.source);
  const heavy = await readJsonManifest(args.heavy);
  const result = await buildVisualEvidence({
    sourceManifest: source.value,
    heavyManifest: heavy.value,
    sourceManifestPath: source.path,
    heavyManifestPath: heavy.path,
  });
  await writeFile(resolve(args.out), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: result.ok, out: resolve(args.out), summary: result.summary })}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (isAbsolute(process.argv[1]) && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`lightchain visual evidence build failed: ${error.message}`);
    process.exitCode = 1;
  });
}
