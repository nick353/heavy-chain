import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
globalThis.window = { location: { origin: 'https://heavy-web.example.test' } };
const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent',
  server: { middlewareMode: true }, define: {
    'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': '"true"',
    'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': '"https://heavy-api.example.test"',
  } });
const { auth } = await vite.ssrLoadModule('/src/lib/auth.ts');
auth.getSession = async () => ({ data: { session: { user: { id: 'alice' }, access_token: 'fixture-only' } }, error: null });
const { cloudflareDataPlane: client } = await vite.ssrLoadModule('/src/lib/cloudflareApi.ts');
assert(client);
after(async () => { auth.dispose(); globalThis.fetch = originalFetch; globalThis.window = originalWindow; await vite.close(); });

test('management components have no old DB/storage execution and brand actions use user identity', async () => {
  for (const path of ['components/FolderManager.tsx', 'components/TagManager.tsx', 'components/StylePresets.tsx',
    'components/TeamManagement.tsx', 'pages/BrandSettingsPage.tsx']) {
    const source = await readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /supabase|\.from\(/, path);
    assert.match(source, /cloudflareDataPlane/);
  }
  const page = await readFile(new URL('../src/pages/BrandSettingsPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /handleRoleChange\(member\.user_id, e\.target\.value\)/);
  assert.match(page, /handleRemoveMember\(member\.user_id\)/);
  assert.match(page, /setInviteCode\(invitation\.code\)/);
  assert.doesNotMatch(page, /Math\.random|member\.id/);
});

test('management client preserves scoped paths, IDs, bodies and server readback', async () => {
  const calls = [];
  let response;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://heavy-api.example.test');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-only');
    calls.push({ path: url.pathname + url.search, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    return Response.json(response ?? { ok: true });
  };
  const cases = [
    [() => client.listFolders('brand-1'), '/v1/folders?brand_id=brand-1', 'GET', undefined, []],
    [() => client.createFolder({ brand_id: 'brand-1', name: 'Folder' }), '/v1/folders', 'POST', { brand_id: 'brand-1', name: 'Folder' }, { id: 'f-1', name: 'Folder' }],
    [() => client.updateFolder('f-1', { name: 'Renamed' }), '/v1/folders/f-1', 'PATCH', { name: 'Renamed' }, { id: 'f-1', name: 'Renamed' }],
    [() => client.deleteFolder('f-1'), '/v1/folders/f-1', 'DELETE'],
    [() => client.listTags('brand-1'), '/v1/tags?brand_id=brand-1', 'GET', undefined, []],
    [() => client.createTag({ brand_id: 'brand-1', name: 'Tag' }), '/v1/tags', 'POST', { brand_id: 'brand-1', name: 'Tag' }, { id: 't-1', name: 'Tag' }],
    [() => client.addImageTag('i-1', 't-1'), '/v1/image-tags', 'POST', { image_id: 'i-1', tag_id: 't-1' }],
    [() => client.deleteImageTag('i-1', 't-1'), '/v1/image-tags?image_id=i-1&tag_id=t-1', 'DELETE'],
    [() => client.deleteTag('t-1'), '/v1/tags/t-1', 'DELETE'],
    [() => client.listStylePresets('brand-1'), '/v1/style-presets?brand_id=brand-1', 'GET', undefined, []],
    [() => client.createStylePreset({ brand_id: 'brand-1', name: 'Preset', settings: { aspectRatio: '1:1' } }), '/v1/style-presets', 'POST', { brand_id: 'brand-1', name: 'Preset', settings: { aspectRatio: '1:1' } }, { id: 'p-1', name: 'Preset' }],
    [() => client.updateStylePreset('p-1', { name: 'Edited' }), '/v1/style-presets/p-1', 'PATCH', { name: 'Edited' }, { id: 'p-1', name: 'Edited' }],
    [() => client.deleteStylePreset('p-1'), '/v1/style-presets/p-1', 'DELETE'],
    [() => client.listBrandMembers('brand-1'), '/v1/brands/brand-1/members', 'GET', undefined, [{ user_id: 'member-1', user: { name: 'Member' } }]],
    [() => client.listInvitations('brand-1'), '/v1/brands/brand-1/invitations', 'GET', undefined, []],
    [() => client.createInvitation({ brand_id: 'brand-1', email: 'member@example.test', role: 'editor' }), '/v1/brands/brand-1/invitations', 'POST', { brand_id: 'brand-1', email: 'member@example.test', role: 'editor' }, { id: 'inv-1', code: 'SERVER-CODE' }],
    [() => client.revokeInvitation('inv-1'), '/v1/invitations/inv-1', 'DELETE'],
    [() => client.updateBrandMemberRole('brand-1', 'member-1', 'viewer'), '/v1/brands/brand-1/members/member-1', 'PATCH', { role: 'viewer' }],
    [() => client.removeBrandMember('brand-1', 'member-1'), '/v1/brands/brand-1/members/member-1', 'DELETE'],
  ];
  for (const [call, path, method, body, reply] of cases) {
    response = reply;
    const actual = await call();
    assert.deepEqual(calls.at(-1), { path, method, body });
    if (reply !== undefined) assert.deepEqual(actual, reply);
  }
  assert.equal(calls.length, cases.length);
});

test('permission-denied management writes propagate without retry or fallback', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: 'forbidden' }, { status: 403 }); };
  for (const call of [() => client.createTag({ brand_id: 'foreign', name: 'Tag' }),
    () => client.createStylePreset({ brand_id: 'foreign', name: 'Preset' }),
    () => client.createInvitation({ brand_id: 'foreign', role: 'admin' }),
    () => client.updateBrandMemberRole('foreign', 'owner', 'viewer'),
    () => client.removeBrandMember('foreign', 'owner')]) {
    await assert.rejects(call, /forbidden/);
  }
  assert.equal(calls, 5);
});
