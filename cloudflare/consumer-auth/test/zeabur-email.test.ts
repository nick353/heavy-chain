import assert from 'node:assert/strict';
import test from 'node:test';
import { sendZeaburEmail } from '../src/zeabur-email.ts';

const message = { from: 'heavy@notify.nisen.uk', to: 'user@example.test', subject: 'Subject', text: 'Body' };

test('historical Zeabur transport is fail-closed and cannot send', async () => {
  await assert.rejects(sendZeaburEmail({}, message), /legacy_email_transport_retired/);
});
