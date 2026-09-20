import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const previousWindow = globalThis.window;
globalThis.window = { location: { origin: 'https://auth-store.test' } };
const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, define: {
  'import.meta.env.VITE_CLOUDFLARE_AUTH_ENABLED': '"false"', // stale flag must not restore the retired SDK
  'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': '"true"',
  'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': '"https://api-store.test"',
} });
const authModule = await vite.ssrLoadModule('/src/lib/auth.ts');
const { auth, cloudflareAuthEnabled } = authModule;
const { cloudflareDataPlane: api } = await vite.ssrLoadModule('/src/lib/cloudflareApi.ts');
const { useAuthStore: store, ensureUserProfile, fetchAccessibleBrandsForCurrentUser } = await vite.ssrLoadModule('/src/stores/authStore.ts');
after(async () => { auth.dispose(); globalThis.window = previousWindow; await vite.close(); });
const user = id => ({ id, email: id + '@example.test', user_metadata: {} });
const profile = id => ({ id, email: id + '@example.test', name: id, avatar_url: null, language: 'ja' });

test('retired auth engine cannot be selected by stale flags and source has no runtime SDK import', () => {
  assert.equal(cloudflareAuthEnabled, true);
  assert.equal('supabase' in authModule, false, 'retired data proxy must not remain exported');
const source = readFileSync(new URL('../src/lib/auth.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /createClient|VITE_SUPABASE|supabase\.auth|new Proxy/);
  for (const path of ['src/lib/auth.ts', 'src/lib/cloudflareBrowserAuth.ts', 'src/stores/authStore.ts', 'src/lib/browserAuthTypes.ts']) {
    assert.doesNotMatch(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), /@supabase\//, path);
  }
  const storeSource = readFileSync(new URL('../src/stores/authStore.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(storeSource, /supabase\s*\.\s*(from|storage)|VITE_SUPABASE|sb-\$\{/);
});

test('initial session errors require auth recovery instead of becoming signed out', async () => {
  const sessionError = new Error('auth_service_unavailable');
  auth.getSession = async () => ({ data: { session: null }, error: sessionError });
  await store.getState().initialize();
  assert.equal(store.getState().user, null);
  assert.equal(store.getState().authRecoveryRequired, true);
  assert.equal(store.getState().isInitialized, true);
  auth.getSession = async () => ({ data: { session: { user: user('alice') } }, error: null });
});

test('profile and accessible brands use the isolated API and reject foreign identity', async () => {
  auth.getSession = async () => ({ data: { session: { user: user('alice') } }, error: null });
  api.getProfile = async () => profile('alice');
  api.listBrands = async () => [{ id: 'owned' }, { id: 'member' }];
  assert.equal((await ensureUserProfile(user('alice'))).id, 'alice');
  assert.deepEqual((await fetchAccessibleBrandsForCurrentUser('alice')).map(x => x.id), ['owned', 'member']);
  await assert.rejects(fetchAccessibleBrandsForCurrentUser('bob'), /identity_mismatch/);
  api.getProfile = async () => profile('bob');
  await assert.rejects(ensureUserProfile(user('alice')), /identity_mismatch/);
});

test('signup has no legacy profile write or implicit session admission', async () => {
  store.getState().adoptAuthenticatedSession(user('alice'), profile('alice'));
  let calls = 0;
  auth.signUp = async () => { calls++; return { data: { user: user('new'), session: null }, error: null }; };
  await store.getState().signUpWithEmail('new@example.test', 'synthetic-password', 'New');
  assert.equal(calls, 1); assert.equal(store.getState().user.id, 'alice');
});

test('late profile mutation cannot overwrite a different user or a new session of the same user', async () => {
  for (const nextUser of ['bob', 'alice']) {
    store.getState().adoptAuthenticatedSession(user('alice'), profile('alice'));
    let finish;
    api.updateProfile = () => new Promise(resolve => { finish = resolve; });
    const pending = store.getState().updateProfile({ name: 'late edit' });
    store.getState().adoptAuthenticatedSession(user(nextUser), profile(nextUser));
    finish({ ...profile('alice'), name: 'late edit' });
    await assert.rejects(pending, /profile_context_changed/);
    assert.equal(store.getState().profile.name, nextUser);
  }
  api.updateProfile = async input => ({ ...profile('alice'), ...input });
  await store.getState().updateProfile({ name: 'current edit' });
  assert.equal(store.getState().profile.name, 'current edit');
  await assert.rejects(store.getState().updateProfile({ id: 'bob' }), /field_unsupported/);
});

test('initial profile hydration cannot overwrite a newer admission of the same user', async () => {
  let finish, started;
  const reading = new Promise(resolve => { started = resolve; });
  api.getProfile = () => { started(); return new Promise(resolve => { finish = resolve; }); };
  auth.getSession = async () => ({ data: { session: { user: user('alice') } }, error: null });
  await store.getState().initialize();
  await reading;
  store.getState().adoptAuthenticatedSession(user('alice'), { ...profile('alice'), name: 'new session' });
  finish({ ...profile('alice'), name: 'old session hydration' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(store.getState().profile.name, 'new session');
});
