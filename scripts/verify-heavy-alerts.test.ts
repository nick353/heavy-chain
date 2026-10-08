import test from 'node:test';
import assert from 'node:assert/strict';
import { alertBody, mimeMessage, shouldAlert, windowBounds } from '../cloudflare/heavy-alerts/src/alerts.ts';

const base = { failedLastHour: 0, failedLastWindow: 0, newlyStuck: 0, recentErrors: [] };

test('alerts on 3+ failures in an hour only while new failures arrive, or on a newly stuck request', () => {
  assert.equal(shouldAlert(base), false);
  assert.equal(shouldAlert({ ...base, failedLastHour: 2, failedLastWindow: 2 }), false);
  assert.equal(shouldAlert({ ...base, failedLastHour: 3, failedLastWindow: 1 }), true);
  assert.equal(shouldAlert({ ...base, failedLastHour: 5, failedLastWindow: 0 }), false);
  assert.equal(shouldAlert({ ...base, newlyStuck: 1 }), true);
});

test('stuck window covers requests that crossed 20 minutes during the last 15', () => {
  const b = windowBounds(new Date('2026-10-08T06:00:00.000Z'));
  assert.equal(b.hourAgo, '2026-10-08T05:00:00.000Z');
  assert.equal(b.windowStart, '2026-10-08T05:45:00.000Z');
  assert.equal(b.stuckFrom, '2026-10-08T05:25:00.000Z');
  assert.equal(b.stuckTo, '2026-10-08T05:40:00.000Z');
});

test('builds a Japanese subject and a UTF-8 MIME message', () => {
  const now = new Date('2026-10-08T06:00:00.000Z');
  const { subject, text } = alertBody({ failedLastHour: 4, failedLastWindow: 2, newlyStuck: 0,
    recentErrors: [{ action: 'edit-image', errorCode: 'provider_429', createdAt: '2026-10-08T05:58:00.000Z' }] }, now);
  assert.match(subject, /失敗 4件\/1時間/);
  assert.match(text, /edit-image\s+provider_429/);
  const mime = mimeMessage('alerts@heavychain.app', 'nichika2000823@gmail.com', subject, text, now);
  assert.match(mime, /^From: Heavy Chain Alerts <alerts@heavychain\.app>\r\nTo: nichika2000823@gmail\.com\r\nSubject: =\?UTF-8\?B\?/);
  const body = mime.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))), text);
});
