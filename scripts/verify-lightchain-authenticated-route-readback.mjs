#!/usr/bin/env node

/**
 * Validate the bounded, same-tab Light Chain authenticated readback contract.
 * This is evidence validation only: it never proves provider completion or
 * substitutes a Heavy capture for a Light source capture.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const READBACK_SCHEMA = 'lightchain_source_authenticated_route_readback.v1';
export const LIGHTCHAIN_ORIGIN = 'https://jp.linkaigc.com';
const LOGIN_PATTERN = /ログイン|サインイン|メールアドレス|パスワード|sign\s+in|log\s+in/iu;

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function addIssue(issues, issue) {
  if (!issues.includes(issue)) issues.push(issue);
}

export function validateAuthenticatedRouteReadback(value) {
  const issues = [];
  const readback = object(value);
  if (!readback) return { ok: false, issues: ['readback_must_be_object'], settledRouteCount: 0 };
  if (readback.schema !== READBACK_SCHEMA) addIssue(issues, 'schema_invalid');
  if (readback.origin !== LIGHTCHAIN_ORIGIN) addIssue(issues, 'origin_invalid');
  if (readback.taskOwned !== true) addIssue(issues, 'task_owned_required');
  if (readback.sameTab !== true) addIssue(issues, 'same_tab_required');
  if (Number(readback.waitedBeforeSettledReadbackSeconds) < 30) addIssue(issues, 'settle_wait_under_30_seconds');

  const auth = object(readback.authContinuity);
  if (!auth) {
    addIssue(issues, 'auth_continuity_missing');
  } else {
    if (auth.title !== 'Lightchain AI') addIssue(issues, 'auth_title_invalid');
    if (auth.loginTextMatches !== 0) addIssue(issues, 'login_text_present');
    if (auth.loginFormMatches !== 0) addIssue(issues, 'login_form_present');
    if (auth.originPreserved !== true) addIssue(issues, 'auth_origin_not_preserved');
    if (auth.rightsCheckboxCount !== 0) addIssue(issues, 'rights_checkbox_present');
    if (auth.cookieOrTokenRecorded !== false) addIssue(issues, 'secret_recorded');
  }

  const settledRoutes = Array.isArray(readback.settledRoutes) ? readback.settledRoutes : [];
  if (settledRoutes.length === 0) addIssue(issues, 'settled_routes_missing');
  const seenRoutes = new Set();
  for (const route of settledRoutes) {
    const routeObject = object(route);
    if (!routeObject) {
      addIssue(issues, 'settled_route_invalid');
      continue;
    }
    const routeName = typeof routeObject.route === 'string' ? routeObject.route : '';
    if (!routeName || seenRoutes.has(routeName)) addIssue(issues, 'settled_route_duplicate_or_missing');
    seenRoutes.add(routeName);
    try {
      if (new URL(routeObject.url).origin !== LIGHTCHAIN_ORIGIN) addIssue(issues, 'settled_route_origin_invalid');
    } catch {
      addIssue(issues, 'settled_route_url_invalid');
    }
    if (routeObject.title !== 'Lightchain AI') addIssue(issues, 'settled_route_title_invalid');
    if (routeObject.readyState !== 'complete') addIssue(issues, 'settled_route_not_complete');
    if (!positiveInteger(routeObject.textChars)) addIssue(issues, 'settled_route_text_missing');
    if (!positiveInteger(routeObject.controlCount)) addIssue(issues, 'settled_route_controls_missing');
    if (!positiveInteger(routeObject.screenshotBytes)) addIssue(issues, 'settled_route_screenshot_missing');
    if (routeObject.loginPhrasePresent !== false) addIssue(issues, 'settled_route_login_present');
    if (LOGIN_PATTERN.test(String(routeObject.textPrefix ?? ''))) addIssue(issues, 'settled_route_login_marker_present');
  }

  const cleanup = object(readback.cleanup);
  if (!cleanup) {
    addIssue(issues, 'cleanup_missing');
  } else {
    if (cleanup.sessionClosed !== true) addIssue(issues, 'session_not_closed');
    if (cleanup.taskTabClosed !== true) addIssue(issues, 'task_tab_not_closed');
    if (cleanup.foreignTabsMutated !== false) addIssue(issues, 'foreign_tab_mutation');
    if (cleanup.externalActionExecuted !== false) addIssue(issues, 'external_action_executed');
    if (cleanup.unknownEffect !== false) addIssue(issues, 'unknown_effect');
  }

  return { ok: issues.length === 0, issues, settledRouteCount: settledRoutes.length };
}

async function main(argv) {
  const filePath = resolve(argv[0] ?? 'work/lightchain-source-authenticated-route-readback-20260925-r1.json');
  const result = validateAuthenticatedRouteReadback(JSON.parse(await readFile(filePath, 'utf8')));
  process.stdout.write(`${JSON.stringify({ filePath, ...result })}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`authenticated route readback validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
