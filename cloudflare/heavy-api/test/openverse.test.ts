import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OPENVERSE_IMAGES_URL, OPENVERSE_TOKEN_URL, OpenverseError, forgetOpenverseToken,
  openverseConfigured, openverseImages, openverseSearchParams, openverseToken,
} from '../src/openverse.ts';

const env = { OPENVERSE_CLIENT_ID: 'client-abc', OPENVERSE_CLIENT_SECRET: 'secret-xyz' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const tokenReply = (token = 'tok-1', expires = 43_200) => reply({ access_token: token, expires_in: expires });
const imagesReply = (results: unknown[] = [{ id: 'a' }]) => reply({ results });

test('openverseConfigured: どちらか欠けていれば中継は使わない', () => {
  assert.equal(openverseConfigured(env), true);
  assert.equal(openverseConfigured({ OPENVERSE_CLIENT_ID: 'client-abc' }), false);
  assert.equal(openverseConfigured({ OPENVERSE_CLIENT_SECRET: 'secret-xyz' }), false);
  assert.equal(openverseConfigured({ OPENVERSE_CLIENT_ID: '  ', OPENVERSE_CLIENT_SECRET: 'secret-xyz' }), false);
  assert.equal(openverseConfigured({}), false);
});

test('トークンは client_credentials で取り、期限まで使い回す', async () => {
  forgetOpenverseToken();
  const calls: Array<{ url: string; body: string }> = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') });
    return tokenReply('tok-held');
  }) as unknown as typeof fetch;

  const first = await openverseToken(env, fetcher, 1_000_000);
  assert.equal(first, 'tok-held');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OPENVERSE_TOKEN_URL);
  const sent = new URLSearchParams(calls[0].body);
  assert.equal(sent.get('grant_type'), 'client_credentials');
  assert.equal(sent.get('client_id'), 'client-abc');
  assert.equal(sent.get('client_secret'), 'secret-xyz');

  // 1分後は使い回す（取り直さない）。
  assert.equal(await openverseToken(env, fetcher, 1_060_000), 'tok-held');
  assert.equal(calls.length, 1);
  // 12時間 − 5分を過ぎたら取り直す。
  assert.equal(await openverseToken(env, fetcher, 1_000_000 + 43_200_000), 'tok-held');
  assert.equal(calls.length, 2);
});

test('クライアントが変わったら、前のクライアントのトークンは使わない', async () => {
  forgetOpenverseToken();
  let minted = 0;
  const fetcher = (async () => { minted += 1; return tokenReply(`tok-${minted}`); }) as unknown as typeof fetch;
  assert.equal(await openverseToken(env, fetcher, 1_000_000), 'tok-1');
  assert.equal(await openverseToken({ ...env, OPENVERSE_CLIENT_ID: 'client-new' }, fetcher, 1_060_000), 'tok-2');
  assert.equal(minted, 2);
});

test('鍵が無ければ 503、トークンが取れなければ 502', async () => {
  forgetOpenverseToken();
  const never = (async () => { throw new Error('呼ばれてはいけない'); }) as unknown as typeof fetch;
  await assert.rejects(openverseToken({}, never), (error: unknown) =>
    error instanceof OpenverseError && error.status === 503 && error.message === 'openverse_not_configured');

  forgetOpenverseToken();
  await assert.rejects(openverseToken(env, (async () => reply({ detail: 'nope' }, 400)) as unknown as typeof fetch),
    (error: unknown) => error instanceof OpenverseError && error.status === 502 && error.message === 'openverse_token_400');

  forgetOpenverseToken();
  await assert.rejects(openverseToken(env, (async () => reply({ expires_in: 10 })) as unknown as typeof fetch),
    (error: unknown) => error instanceof OpenverseError && error.message === 'openverse_token_missing');

  forgetOpenverseToken();
  await assert.rejects(openverseToken(env, (async () => reply({ detail: 'slow down' }, 429)) as unknown as typeof fetch),
    (error: unknown) => error instanceof OpenverseError && error.status === 429);
});

test('検索の条件は固定し、page_size は 1〜20 に収める', () => {
  const params = openverseSearchParams(new URLSearchParams({ q: '  linen   shirt  ', page_size: '9' }));
  assert.equal(params.get('q'), 'linen shirt');
  assert.equal(params.get('license_type'), 'commercial,modification');
  assert.equal(params.get('mature'), 'false');
  assert.equal(params.get('page_size'), '9');
  assert.equal(openverseSearchParams(new URLSearchParams({ q: 'a', page_size: '400' })).get('page_size'), '20');
  assert.equal(openverseSearchParams(new URLSearchParams({ q: 'a', page_size: '0' })).get('page_size'), '1');
  assert.equal(openverseSearchParams(new URLSearchParams({ q: 'a' })).get('page_size'), '12');
  assert.equal(openverseSearchParams(new URLSearchParams({ q: 'a'.repeat(400) })).get('q')?.length, 200);
  // 閲覧者が足した条件は通さない（license_type を緩めて NC/ND を引き込めないこと）。
  const forced = openverseSearchParams(new URLSearchParams({ q: 'a', license_type: 'all', mature: 'true', unsafe: '1' }));
  assert.equal(forced.get('license_type'), 'commercial,modification');
  assert.equal(forced.get('mature'), 'false');
  assert.equal(forced.get('unsafe'), null);
  assert.throws(() => openverseSearchParams(new URLSearchParams({ q: '   ' })), (error: unknown) =>
    error instanceof OpenverseError && error.status === 400);
});

test('検索はトークンを付けて呼び、Openverse の答えをそのまま返す', async () => {
  forgetOpenverseToken();
  const seen: Array<{ url: string; authorization: string | null }> = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({ url: String(url), authorization: headers.get('authorization') });
    return String(url) === OPENVERSE_TOKEN_URL ? tokenReply('tok-search') : imagesReply([{ id: 'img-1' }]);
  }) as unknown as typeof fetch;

  const data = await openverseImages(env, new URLSearchParams({ q: 'denim', page_size: '4' }), fetcher, 2_000_000);
  assert.deepEqual(data, { results: [{ id: 'img-1' }] });
  assert.equal(seen.length, 2);
  assert(seen[1].url.startsWith(OPENVERSE_IMAGES_URL));
  assert.equal(seen[1].authorization, 'Bearer tok-search');
  assert(seen[1].url.includes('license_type=commercial%2Cmodification'));
  assert(seen[1].url.includes('page_size=4'));
});

test('401 のあとは持っているトークンを捨て、次の検索で取り直す', async () => {
  forgetOpenverseToken();
  let minted = 0;
  let rejectOnce = true;
  const fetcher = (async (url: string | URL) => {
    if (String(url) === OPENVERSE_TOKEN_URL) { minted += 1; return tokenReply(`tok-${minted}`); }
    if (rejectOnce) { rejectOnce = false; return reply({ detail: 'invalid token' }, 401); }
    return imagesReply();
  }) as unknown as typeof fetch;

  await assert.rejects(openverseImages(env, new URLSearchParams({ q: 'a' }), fetcher, 3_000_000),
    (error: unknown) => error instanceof OpenverseError && error.status === 502 && error.message === 'openverse_401');
  assert.equal(minted, 1);
  // 期限内でも取り直す（捨てたので）。
  await openverseImages(env, new URLSearchParams({ q: 'a' }), fetcher, 3_060_000);
  assert.equal(minted, 2);
});

test('使えない答え・つながらないときは 502、速度制限は 429 のまま返す', async () => {
  forgetOpenverseToken();
  const withImages = (make: () => Promise<Response>) => (async (url: string | URL) =>
    (String(url) === OPENVERSE_TOKEN_URL ? tokenReply() : await make())) as unknown as typeof fetch;

  await assert.rejects(openverseImages(env, new URLSearchParams({ q: 'a' }), withImages(async () => reply({ results: 'いいえ' })), 4_000_000),
    (error: unknown) => error instanceof OpenverseError && error.message === 'openverse_unusable_reply');
  await assert.rejects(openverseImages(env, new URLSearchParams({ q: 'a' }), withImages(async () => { throw new Error('network'); }), 4_000_000),
    (error: unknown) => error instanceof OpenverseError && error.message === 'openverse_unreachable');
  await assert.rejects(openverseImages(env, new URLSearchParams({ q: 'a' }), withImages(async () => reply({ detail: 'slow down' }, 429)), 4_000_000),
    (error: unknown) => error instanceof OpenverseError && error.status === 429);
});
