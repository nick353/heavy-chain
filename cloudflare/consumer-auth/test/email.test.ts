import assert from 'node:assert/strict';
import test from 'node:test';
import { sendEmail } from '../src/email.ts';

const message = {
  from: 'heavy@notify.nisen.uk',
  to: 'user@example.test',
  subject: 'Heavy Chain — メールアドレスの確認',
  text: 'メールアドレスを確認してください。\n\nhttps://auth.test/verify\n\n心当たりがない場合は、このメールを破棄してください。',
};

test('native Email Service receives the documented payload and a non-empty messageId is returned', async () => {
  let received: unknown;
  const result = await sendEmail({ EMAIL: { send: async builder => {
    received = builder;
    return { messageId: 'cloudflare-message-id' };
  } } }, message);
  assert.deepEqual(received, message);
  assert.deepEqual(result, { messageId: 'cloudflare-message-id' });
});

test('native Email Service rejects an unavailable binding, rejected send and every malformed receipt', async () => {
  await assert.rejects(sendEmail({}, message), /email_not_configured/);
  await assert.rejects(sendEmail({ EMAIL: { send: async () => {
    throw new Error('native_send_rejected');
  } } }, message), /native_send_rejected/);
  for (const receipt of [undefined, null, {}, { messageId: '' }, { messageId: '   ' },
    { messageId: 42 }, 'message-id']) {
    await assert.rejects(sendEmail({ EMAIL: { send: async () => receipt as never } }, message), /email_acceptance_unconfirmed/);
  }
});
