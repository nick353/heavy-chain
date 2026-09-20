import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

process.env.VITE_CLOUDFLARE_API_ENABLED = 'true';
process.env.VITE_CLOUDFLARE_API_BASE_URL = 'https://heavy-api.example.test';
process.env.VITE_CLOUDFLARE_AUTH_ENABLED = 'true';
globalThis.window = { location: { origin: 'https://heavy-web.example.test' } };
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { auth } = await vite.ssrLoadModule('/src/lib/auth.ts');
auth.getSession = async () => ({ data: { session: { access_token: 'local-test-token' } }, error: null });
const { cloudflareDataPlane: client } = await vite.ssrLoadModule('/src/lib/cloudflareApi.ts');
assert(client);
const originalFetch = globalThis.fetch;
after(async () => { globalThis.fetch = originalFetch; auth.dispose(); delete globalThis.window; await vite.close(); });

test('actual browser client uses Cloudflare bearer endpoints, current server admin flag and private blob fetch', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = new URL(url); assert.equal(target.origin, 'https://heavy-api.example.test');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer local-test-token');
    assert.equal(target.search, ''); calls.push({ path: target.pathname, method: init.method ?? 'GET', body: init.body });
    if (target.pathname.endsWith('/screenshot')) return new Response('png fixture', { headers: { 'content-type': 'image/png' } });
    if (target.pathname === '/v1/profile') return Response.json({ id: 'admin', email: 'admin@example.test', is_admin: true });
    return Response.json([]);
  };
  assert.equal((await client.getProfile()).is_admin, true);
  await client.submitFeedback({ request_id: 'test-id' });
  await client.getAdminStats(); await client.listAdminUsers(); await client.listAdminFeedback();
  await client.updateAdminFeedback('feedback-id', { revision: 3, status: 'done' });
  const blob = await client.readFeedbackScreenshot('feedback-id'); assert.equal(blob.type, 'image/png');
  await client.listAnnouncements(); await client.publishAnnouncement({ request_id: 'announcement-id', title: 'title', content: 'body', type: 'info' });
  assert.deepEqual(calls.map(c => c.path), ['/v1/profile','/v1/feedback','/v1/admin/stats','/v1/admin/users','/v1/admin/feedback',
    '/v1/admin/feedback/feedback-id','/v1/admin/feedback/feedback-id/screenshot','/v1/announcements','/v1/admin/announcements']);
  assert.equal(JSON.parse(calls[5].body).revision, 3);
});

test('browser client never retries or falls back to Supabase on denied/missing service', async () => {
  for (const status of [401,403,409,503]) {
    let calls = 0;
    globalThis.fetch = async url => { calls++; assert.equal(new URL(url).origin, 'https://heavy-api.example.test'); return Response.json({ error: 'denied' }, { status }); };
    await assert.rejects(client.submitFeedback({ request_id: 'same-id' }), new RegExp(`_${status}_`)); assert.equal(calls, 1);
    await assert.rejects(client.readFeedbackScreenshot('id'), new RegExp(`_${status}_`)); assert.equal(calls, 2);
  }
});

test('the two UI surfaces have no direct Supabase path or fake statistics and retire screenshot object URLs', () => {
  const admin = readFileSync(new URL('../src/pages/AdminDashboard.tsx', import.meta.url), 'utf8');
  const form = readFileSync(new URL('../src/components/ui/FeedbackForm.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(admin + form, /supabase\.|from ['"].*\/supabase['"]/);
  assert.doesNotMatch(admin, /trend=\{\d+\}/);
  assert.match(admin, /URL\.revokeObjectURL\(blobURL\)/); assert.match(admin, /if \(!active\) return/);
  assert.match(form, /submitFeedback\(submission\.current\.body\)/);
  assert.match(form, /disabled=\{isSubmitting \|\| confirmingReceipt \|\| screenshot\.isCapturing\}/);
  assert.match(admin, /revision: item\.revision/);
});
