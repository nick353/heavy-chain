#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const AUTH_HYDRATION_SCHEMA = 'heavy_chain_auth_hydration_no_login_form_readback.v1';
const HEAVY_ORIGIN = 'https://heavy-chain.zeabur.app';

const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const addIssue = (issues, issue) => { if (!issues.includes(issue)) issues.push(issue); };

export function validateHeavyAuthHydrationReadback(value) {
  const issues = [];
  const readback = asObject(value);
  if (!readback) return { ok: false, issues: ['readback_must_be_object'], routeCount: 0 };
  if (readback.schema !== AUTH_HYDRATION_SCHEMA) addIssue(issues, 'schema_invalid');
  if (readback.surface !== 'aos_chrome_companion_profile_instance') addIssue(issues, 'surface_invalid');
  if (readback.sameTaskOwnedSession !== true) addIssue(issues, 'same_session_required');
  if (readback.sameTab !== true) addIssue(issues, 'same_tab_required');
  if (Number(readback.settleWaitSecondsPerRoute) < 30) addIssue(issues, 'settle_wait_under_30_seconds');

  const deployment = asObject(readback.deployment);
  if (!deployment || deployment.statusAtCapture !== 'RUNNING' || deployment.healthAtCapture !== 200) addIssue(issues, 'deployment_not_healthy');

  const routes = Array.isArray(readback.routes) ? readback.routes : [];
  if (routes.length === 0) addIssue(issues, 'routes_missing');
  const seen = new Set();
  for (const route of routes) {
    const item = asObject(route);
    if (!item) { addIssue(issues, 'route_invalid'); continue; }
    if (typeof item.route !== 'string' || seen.has(item.route)) addIssue(issues, 'route_duplicate_or_missing');
    seen.add(item.route);
    try {
      if (new URL(String(item.url)).origin !== HEAVY_ORIGIN) addIssue(issues, 'route_origin_invalid');
    } catch { addIssue(issues, 'route_url_invalid'); }
    if (item.title !== 'Lightchain AI') addIssue(issues, 'route_title_invalid');
    if (item.readyState !== 'complete') addIssue(issues, 'route_not_complete');
    if (!(Number(item.textChars) > 0) || !(Number(item.controlCount) > 0) || !(Number(item.screenshotBytes) > 0)) addIssue(issues, 'route_readback_incomplete');
    if (item.loginMarkerCount !== 0 || item.loginFormCount !== 0) addIssue(issues, 'login_ui_present');
    if (item.rightsMarkerCount !== 0) addIssue(issues, 'rights_ui_present');
  }

  const transition = asObject(readback.transition);
  if (!transition || transition.browserNavigationVerified !== true || transition.externalActionExecuted !== false || transition.unknownEffect !== false) addIssue(issues, 'transition_not_verified');
  const cleanup = asObject(readback.cleanup);
  if (!cleanup || cleanup.sessionClosed !== true || cleanup.taskTabClosed !== true || cleanup.foreignTabsMutated !== false || cleanup.externalActionExecuted !== false || cleanup.unknownEffect !== false) addIssue(issues, 'cleanup_incomplete');
  if (readback.secretRecorded !== false) addIssue(issues, 'secret_recorded');
  return { ok: issues.length === 0, issues, routeCount: routes.length };
}

async function main(argv) {
  const filePath = resolve(argv[0] ?? 'work/heavy-chain-auth-hydration-no-login-form-readback-20250925-r1.json');
  const result = validateHeavyAuthHydrationReadback(JSON.parse(await readFile(filePath, 'utf8')));
  process.stdout.write(`${JSON.stringify({ filePath, ...result })}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`heavy auth hydration readback validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
