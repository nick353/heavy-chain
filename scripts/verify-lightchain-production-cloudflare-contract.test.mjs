import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('./verify-lightchain-production-ui.mjs', import.meta.url), 'utf8');
const navigation = readFileSync(new URL('./verify-lightchain-production-navigation.mjs', import.meta.url), 'utf8');
const legacyState = 'output/playwright/prod-auth-dashboard-20260623/auth-state-after-tutorial.json';
const cloudflareOrigin = 'https://heavy-chain-web.nichika2000823.workers.dev';

test('production Lightchain runners use explicit Cloudflare auth and fail closed before browser launch', () => {
  for (const source of [ui, navigation]) {
    assert.match(source, new RegExp(cloudflareOrigin.replaceAll('.', '\\.'), 'u'));
    assert.doesNotMatch(source, /heavy-chain\.zeabur\.app/u);
    assert.doesNotMatch(source, new RegExp(legacyState.replaceAll('.', '\\.'), 'u'));
    assert.match(source, /missing_explicit_env/u);
    assert.match(source, /explicit_auth_state_required/u);
    assert.match(source, /legacy_network_request/u);
    assert.match(source, /externalActionsStarted: false/u);
  }
  assert.ok(ui.indexOf("await import('@playwright/test')") > ui.indexOf('if (!preflight.ok)'));
  assert.ok(navigation.indexOf("await import('@playwright/test')") > navigation.indexOf('if (!preflight.ok)'));
});
