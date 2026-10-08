#!/usr/bin/env node

/**
 * Compare settled Light Chain/Heavy route readback ledgers.
 *
 * This is an interaction/semantic comparator. It deliberately does not
 * promote screenshots, health responses, or UI success into provider,
 * persistence, billing, or business completion. Native pixel equality remains
 * a separate gate because the Companion payloads are visual evidence, not
 * PNG files with a stable source/Heavy pair.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export const SCHEMA = 'lightchain-heavy-route-readback-comparator.v1';

function fail(message) {
  throw new Error(message);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value) {
  return Number.isFinite(value) ? value : null;
}

function first(objectValue, keys) {
  const source = object(objectValue);
  if (!source) return null;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return null;
}

function routeFrom(readback) {
  return text(readback?.route) || text(readback?.path) || null;
}

function sourceSide(readback) {
  return object(readback?.source) || object(readback?.sourceBaseline) || object(readback?.light) || null;
}

function metric(side) {
  const semanticText = text(first(side, ['semanticText', 'text']));
  const controlCount = number(first(side, ['controlCount', 'controls']));
  const textChars = number(first(side, ['semanticTextChars', 'textChars']));
  const title = text(first(side, ['title']));
  const readyState = text(first(side, ['readyState']));
  const rightsCheckboxCount = number(first(side, ['rightsCheckboxCount', 'checkboxCount']));
  const loginPromptCount = number(first(side, ['loginPromptCount', 'loginMarkerCount']))
    ?? (side?.loginPrompt === false ? 0 : null);
  const authCallbackCount = number(first(side, ['authCallbackCount', 'authMarkerCount']))
    ?? (side?.authCallback === false ? 0 : null);
  const avatarCount = number(first(side, ['avatarCount', 'avatarControlCount']))
    ?? (side?.authenticatedAvatarPresent === true ? 1 : null);
  const projectCardCount = number(first(side, ['projectCardCount', 'sourceProjectCardCount', 'heavyProjectCardCount', 'documentCardCount']));
  const screenshotBytes = number(first(side, ['screenshotBytes']));
  return {
    title,
    readyState,
    semanticText,
    textChars,
    controlCount,
    rightsCheckboxCount,
    loginPromptCount,
    authCallbackCount,
    avatarCount,
    projectCardCount,
    screenshotBytes,
  };
}

function compareMetric(source, heavy, key, differences) {
  const left = source[key];
  const right = heavy[key];
  if (left === null || right === null) return;
  if (left !== right) differences.push({ key, source: left, heavy: right });
}

function pixelStatus(readback) {
  const comparison = object(readback?.comparison);
  const value = comparison?.pixelDiff ?? comparison?.pixelEquality ?? comparison?.pixelStatus;
  if (typeof value === 'string' && /equal|identical|pass/i.test(value)) return 'equal';
  if (typeof value === 'string' && /different|mismatch|fail/i.test(value)) return 'different';
  return 'not_computed';
}

function accountState(side, sideMetric) {
  const explicit = first(side, ['authenticated', 'sourceAuthenticated', 'isAuthenticated']);
  if (explicit === true || sideMetric.avatarCount > 0) return 'authenticated';
  if (explicit === false || sideMetric.avatarCount === 0) return 'anonymous_or_no_avatar';
  return 'unknown';
}

function readbackProvenance(readback, filePath) {
  return {
    file: filePath,
    schema: text(readback?.schema),
    recordedAt: text(readback?.recordedAt ?? readback?.observedAt ?? readback?.capturedAt),
    waitSeconds: number(readback?.waitSeconds)
      ?? number(readback?.waitAfterReloadSeconds)
      ?? (number(readback?.requestedWaitMs) !== null ? number(readback.requestedWaitMs) / 1000 : null),
  };
}

export function compareRouteReadback(readback, filePath = null) {
  const route = routeFrom(readback);
  if (!route) fail('route_readback_route_required');
  const source = sourceSide(readback);
  // Route evidence has used both `heavy` and the more explicit
  // `heavyReadback` field over time.  Accept the recorded alias without
  // inferring a missing side or fabricating parity; the comparison below
  // remains fail-closed when neither side is present.
  const heavy = object(readback?.heavy) || object(readback?.heavyReadback) || object(readback?.heavyCapture);
  if (!source || !heavy) fail(`route_readback_sides_required:${route}`);

  const sourceMetric = metric(source);
  const heavyMetric = metric(heavy);
  const sourceAccountState = accountState(source, sourceMetric);
  const heavyAccountState = accountState(heavy, heavyMetric);
  const accountStateMismatch = sourceAccountState !== 'unknown'
    && heavyAccountState !== 'unknown'
    && sourceAccountState !== heavyAccountState;
  const accountStateUnresolved = accountStateMismatch
    || (sourceAccountState === 'unknown' && heavyAccountState !== 'unknown')
    || (sourceAccountState !== 'unknown' && heavyAccountState === 'unknown');
  const differences = [];
  for (const key of [
    'title',
    'readyState',
    'semanticText',
    'textChars',
    'controlCount',
    'projectCardCount',
  ]) compareMetric(sourceMetric, heavyMetric, key, differences);

  const safety = {
    sourceRightsCheckboxCount: sourceMetric.rightsCheckboxCount,
    heavyRightsCheckboxCount: heavyMetric.rightsCheckboxCount,
    sourceLoginPromptCount: sourceMetric.loginPromptCount,
    heavyLoginPromptCount: heavyMetric.loginPromptCount,
    sourceAuthCallbackCount: sourceMetric.authCallbackCount,
    heavyAuthCallbackCount: heavyMetric.authCallbackCount,
    rightsUiAbsent: (() => {
      const values = [sourceMetric.rightsCheckboxCount, heavyMetric.rightsCheckboxCount].filter((value) => value !== null);
      return values.length === 0 ? null : values.every((value) => value === 0);
    })(),
    loginUiAbsent: (() => {
      const values = [sourceMetric.loginPromptCount, heavyMetric.loginPromptCount].filter((value) => value !== null);
      return values.length === 0 ? null : values.every((value) => value === 0);
    })(),
  };

  // A title-only baseline is not enough to claim interaction parity. Require
  // at least two semantic/core observations on each side; marker-only data
  // remains visible in `safety` but cannot promote a route to equal.
  const coreKeys = ['title', 'readyState', 'semanticText', 'textChars', 'controlCount', 'projectCardCount'];
  const sourceComparableCount = coreKeys.filter((key) => sourceMetric[key] !== null).length;
  const heavyComparableCount = coreKeys.filter((key) => heavyMetric[key] !== null).length;
  const complete = sourceComparableCount >= 2 && heavyComparableCount >= 2;
  const interactionStatus = !complete
    ? 'pending_confirmation'
    : accountStateUnresolved
      ? 'pending_confirmation'
    : differences.length === 0
      ? 'equal'
      : 'different';

  return {
    route,
    interactionStatus,
    differences,
    source: sourceMetric,
    heavy: heavyMetric,
    accountState: {
      source: sourceAccountState,
      heavy: heavyAccountState,
      status: accountStateMismatch ? 'mismatch' : accountStateUnresolved ? 'pending_confirmation' : 'comparable_or_unknown',
      reason: accountStateMismatch
        ? 'Authenticated and non-authenticated captures must not be promoted to the same full interaction baseline.'
        : accountStateUnresolved
          ? 'One side does not record authentication state; capture both sides under the same session before promoting interaction parity.'
        : null,
    },
    safety,
    pixelStatus: pixelStatus(readback),
    businessCompletion: 'unverified',
    provenance: readbackProvenance(readback, filePath),
  };
}

export async function compareRouteReadbackFiles(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) fail('route_readback_files_required');
  const sortedPaths = [...new Set(filePaths)].sort();
  const routes = [];
  const errors = [];
  for (const inputPath of sortedPaths) {
    const absolutePath = isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath);
    try {
      const parsed = JSON.parse(await readFile(absolutePath, 'utf8'));
      routes.push(compareRouteReadback(parsed, absolutePath));
    } catch (error) {
      errors.push({ file: absolutePath, error: error?.message || 'invalid_readback' });
    }
  }
  const routeCounts = new Map();
  for (const route of routes) routeCounts.set(route.route, (routeCounts.get(route.route) ?? 0) + 1);
  const duplicateRoutes = [...routeCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([route]) => route)
    .sort();
  for (const route of duplicateRoutes) errors.push({ file: null, error: `duplicate_route:${route}` });
  const counts = {
    total: routes.length,
    equal: routes.filter((route) => route.interactionStatus === 'equal').length,
    different: routes.filter((route) => route.interactionStatus === 'different').length,
    pendingConfirmation: routes.filter((route) => route.interactionStatus === 'pending_confirmation').length,
  };
  return {
    schema: SCHEMA,
    deterministic: true,
    routes,
    errors,
    summary: counts,
    duplicateRoutes,
    ok: errors.length === 0,
    noFabricationGuard: {
      sourceAndHeavyReadbacksMustBeIndependent: true,
      pixelEqualityRequiresNativePngComparison: true,
      authenticatedStateDifferencesRemainVisible: true,
      providerPersistenceBillingAndBusinessCompletionStayUnverified: true,
    },
  };
}

function parseArgs(argv) {
  const readbacks = [];
  let out = null;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--readback') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) fail('missing_value_for_readback');
      readbacks.push(value);
    } else if (flag === '--out') {
      out = argv[++index];
      if (!out || out.startsWith('--')) fail('missing_value_for_out');
    } else {
      fail(`unknown_argument:${flag}`);
    }
  }
  if (!readbacks.length) fail('route_readback_files_required');
  if (!out) fail('route_readback_output_required');
  return { readbacks, out };
}

async function main(argv = process.argv.slice(2)) {
  const { readbacks, out } = parseArgs(argv);
  const result = await compareRouteReadbackFiles(readbacks);
  const outputPath = isAbsolute(out) ? out : resolve(process.cwd(), out);
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: result.ok, summary: result.summary, outputPath }));
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && isAbsolute(process.argv[1]) && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(`route_readback_comparator_failed:${error.message}`);
    process.exitCode = 1;
  });
}
