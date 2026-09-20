import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
globalThis.window = { location: { origin: 'https://heavy-web.example.test' }, localStorage: { getItem: () => null } };
const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent',
  esbuild: { jsx: 'automatic' }, server: { middlewareMode: true }, define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': '"true"',
    'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': '"https://heavy-api.example.test"',
    'import.meta.env.VITE_MEDIA_PROVIDER_ORDER': '"cloudflare_r2"',
    'import.meta.env.VITE_MEDIA_GATEWAY_URL': '"https://heavy-api.example.test"',
  } });
const { auth } = await vite.ssrLoadModule('/src/lib/auth.ts');
const session = { user: { id: 'alice' }, access_token: 'fixture-only' };
auth.getSession = async () => ({ data: { session }, error: null });
const { fetchWorkspaceActivity, emptyWorkspaceActivity } = await vite.ssrLoadModule('/src/lib/workspaceActivity.ts');
after(async () => { auth.dispose(); globalThis.fetch = originalFetch; globalThis.window = originalWindow; await vite.close(); });

const usage = { planName: '内部Free枠', monthlyQuota: 200, remainingUnits: 183,
  completedImages: 8, runningImages: 3, uncertainImages: 2 };
const job = { id: 'job-1', brand_id: 'brand-1', user_id: 'alice', feature_type: 'generate-image',
  status: 'completed', input_params: { lightchainCompat: { lightchainTaskCodes: ['declared'], lightchainTaskSteps: [{ taskCode: 'declared', status: 'completed' }] } }, error_message: null, created_at: '2026-09-06T00:00:00Z', completed_at: '2026-09-06T00:00:01Z' };
function fixture(reply = () => Response.json(usage), executionReply = () => Response.json([])) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(url.origin, 'https://heavy-api.example.test');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-only');
    assert.equal(url.searchParams.get('brand_id'), 'brand-1');
    if (url.pathname === '/v1/image-ai/usage') return reply();
    if (url.pathname === '/v1/workspace-execution-steps') {
      assert.deepEqual(url.searchParams.getAll('job_id'), ['job-1']);
      return executionReply();
    }
    assert.equal(url.searchParams.get('limit'), '50');
    assert.equal(url.searchParams.get('offset'), '0');
    if (url.pathname === '/v1/generation-jobs') return Response.json([job]);
    if (url.pathname === '/v1/generated-images') return Response.json([]);
    throw new Error(`unexpected request ${url.pathname}`);
  };
  return calls;
}

test('workspace maps actual CF usage without inventing a Free25 quota or billable count', async () => {
  const calls = fixture();
  const activity = await fetchWorkspaceActivity('brand-1', 'alice');
  assert.deepEqual(activity.creditSummary, { available: true, planName: '内部Free枠', monthlyQuota: 200,
    remainingUnits: 183, usedUnits: 8, reservedUnits: 3, uncertainUnits: 2,
    billingTestAccountQuotaBypass: false, appleSandboxTesterNoRealCharge: false });
  assert.equal(activity.completedJobs[0].id, job.id);
  assert.equal(calls.length, 4);
});

test('quota failure stays unknown while completed Jobs remain visible', async () => {
  fixture(() => Response.json({ error: 'unavailable' }, { status: 503 }));
  const activity = await fetchWorkspaceActivity('brand-1', 'alice');
  assert.deepEqual(activity.creditSummary, emptyWorkspaceActivity.creditSummary);
  assert.equal(activity.creditSummary.remainingUnits, null);
  assert.equal(activity.completedJobs[0].id, job.id);
});

test('malformed quota responses cannot become a usable allowance', async () => {
  for (const invalid of [{ monthlyQuota: null }, { remainingUnits: 201 }, { remainingUnits: '183' },
    { completedImages: -1 }, { runningImages: undefined }, { planName: '' }]) {
    fixture(() => Response.json({ ...usage, ...invalid }));
    assert.equal((await fetchWorkspaceActivity('brand-1', 'alice')).creditSummary.available, false);
  }
});

test('empty-month SQL sums normalize to zero only with a valid returned quota', async () => {
  fixture(() => Response.json({ ...usage, remainingUnits: 200, completedImages: null, runningImages: null, uncertainImages: null }));
  const { creditSummary } = await fetchWorkspaceActivity('brand-1', 'alice');
  assert.equal(creditSummary.available, true);
  assert.equal(creditSummary.usedUnits, 0);
  assert.equal(creditSummary.reservedUnits, 0);
  assert.equal(creditSummary.uncertainUnits, 0);
  assert.equal(creditSummary.remainingUnits, 200);
});

test('quota 401 gets one bounded session refresh and read retry', async () => {
  let reads = 0, refreshes = 0;
  auth.refreshSession = async () => { refreshes++; return { data: { session }, error: null }; };
  fixture(() => ++reads === 1 ? Response.json({ error: 'unauthorized' }, { status: 401 }) : Response.json(usage));
  assert.equal((await fetchWorkspaceActivity('brand-1', 'alice')).creditSummary.available, true);
  assert.equal(reads, 2); assert.equal(refreshes, 1);
});

test('execution ledger is distinct from client-declared workflow and aggregate completion', async () => {
  fixture(undefined, () => Response.json([{ id: 'request-1:0:0', job_id: 'job-1', image_id: 'image-1', task_code: '候補1・AI処理', step_index: 0, status: 'unknown', basis: 'cloudflare_execution_ledger' }]));
  const { completedJobs } = await fetchWorkspaceActivity('brand-1', 'alice');
  assert(completedJobs[0].sourceSummaryRows.some(row => row.label === '入力工程（申告）'));
  assert.deepEqual(completedJobs[0].sourceSummaryRows.find(row => row.label === '実行記録'), { label: '実行記録', value: '候補1・AI処理=未確定' });
  fixture(undefined, () => Response.json({ error: 'unavailable' }, { status: 503 }));
  const failed = await fetchWorkspaceActivity('brand-1', 'alice');
  assert.equal(failed.completedJobs[0].id, 'job-1');
  assert.equal(failed.completedJobs[0].sourceSummaryRows.find(row => row.label === '実行記録').value, '工程別の実行記録は未取得です');
});

test('rendered quota panel distinguishes unavailable values and consumed quota from completed images', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { MemoryRouter } = await import('react-router-dom');
  const { CreditSummaryPanel } = await vite.ssrLoadModule('/src/components/workspace/CreditSummaryPanel.tsx');
  const render = summary => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CreditSummaryPanel, { summary })));
  const unknown = render(emptyWorkspaceActivity.creditSummary);
  assert.match(unknown, /未取得/); assert.match(unknown, /取得できていません/);
  assert.doesNotMatch(unknown, /今月残り|width:/);
  fixture(); const known = render((await fetchWorkspaceActivity('brand-1', 'alice')).creditSummary);
  assert.match(known, /183/); assert.match(known, /内部Free枠/);
  assert.match(known, /未確定/); assert.match(known, /width:8.5%/);
  assert.match(known, /請求額ではありません/);
});
