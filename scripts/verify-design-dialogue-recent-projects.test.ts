import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createServer as createTcpServer } from 'node:net';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer } from 'vite';

const pageSource = readFileSync(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const dialogueStart = pageSource.indexOf('export function LightchainDialogueParityPanel(');
const dialogueEnd = pageSource.indexOf('export function FileCardIcon(', dialogueStart);
const dialogueSource = pageSource.slice(dialogueStart, dialogueEnd);
const designPageStart = pageSource.indexOf('export function LightchainDesignProductionPage(');
const designPageEnd = pageSource.indexOf('export function LightchainDialogueParityPanel(', designPageStart);
const designPageSource = pageSource.slice(designPageStart, designPageEnd);

const fixtureEntrySource = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import {
  DesignRecentProjectEntryCard,
  LightchainDialogueParityPanel,
} from '/src/pages/LightchainParityPages.tsx';
import { createDesignArtifactScopeKey, designEntryHref, toDesignEntries } from '/src/lib/designProjectArtifacts.ts';
import { useAuthStore } from '/src/stores/authStore.ts';

const scopeA = createDesignArtifactScopeKey('recent-user-a', 'recent-brand-a');
const date = (day) => '2026-09-' + String(day).padStart(2, '0') + 'T12:00:00.000Z';
const artifact = (id, title, day, remoteImageId) => ({
  id,
  brandId: 'recent-brand-a',
  featureType: 'generate-image',
  title,
  imageUrl: '',
  prompt: '',
  createdAt: date(day),
  metadata: remoteImageId ? { remoteImageId } : {},
});
const localArtifacts = [
  artifact('local-newest', 'Local newest', 30, 'shared-canonical-id'),
  artifact('local-middle', 'Local middle', 27),
];
const remoteArtifacts = [
  artifact('remote-duplicate', 'Remote duplicate', 30, 'shared-canonical-id'),
  artifact('remote-latest', 'Remote latest', 29, 'remote-image-1'),
  artifact('remote-fourth', 'Remote fourth', 26, 'remote-image-4'),
  artifact('remote-fifth', 'Remote fifth', 25, 'remote-image-5'),
  artifact('remote-sixth', 'Remote sixth', 24, 'remote-image-6'),
  artifact('remote-seventh', 'Remote seventh', 23, 'remote-image-7'),
];
const manyEntries = toDesignEntries(localArtifacts, remoteArtifacts);
const localEntry = manyEntries.find((entry) => entry.origin === 'local' && entry.artifact.id === 'local-newest');
const remoteEntry = manyEntries.find((entry) => entry.origin === 'remote' && entry.artifact.id === 'remote-latest');
const initialRecentState = {
  scopeKey: scopeA,
  entries: manyEntries,
  loadState: { status: 'ready', entries: manyEntries },
};

const mockReferenceClient = {
  async captureArtifactPersistenceContext({ assertContext } = {}) {
    await assertContext?.();
    return Object.freeze({ assertCurrent: async () => { await assertContext?.(); } });
  },
  async saveWorkspaceArtifact() { throw new Error('not_used_by_recent_projects_test'); },
  async readWorkspaceArtifact() { throw new Error('cloudflare_api_404_workspace_artifact_not_found'); },
};
useAuthStore.setState({ user: { id: 'recent-user-a' }, currentBrand: { id: 'recent-brand-a' } });
window.__designRecentSetAuth = (userId, brandId) => useAuthStore.setState({
  user: userId ? { id: userId } : null,
  currentBrand: brandId ? { id: brandId } : null,
});

const h = React.createElement;
function RouteProbe() {
  const location = useLocation();
  React.useEffect(() => { window.__designRecentLocation = location.pathname + location.search; }, [location.pathname, location.search]);
  return null;
}

function RecentEntry({ entry, openId, setOpenId, setCounts }) {
  const navigate = useNavigate();
  const { currentBrand, user } = useAuthStore();
  const href = designEntryHref(entry);
  return h(DesignRecentProjectEntryCard, {
    entry,
    userId: user?.id,
    brandId: currentBrand?.id,
    heavyRuntime: true,
    pinned: false,
    menuOpen: openId === entry.artifact.id,
    onOpen: () => { if (href) navigate(href); },
    onToggleMenu: () => setOpenId((current) => current === entry.artifact.id ? null : entry.artifact.id),
    onTogglePin: () => { setCounts((current) => ({ ...current, pin: current.pin + 1 })); setOpenId(null); },
    onSaveToLibrary: () => { setCounts((current) => ({ ...current, library: current.library + 1 })); setOpenId(null); },
    onDelete: () => { setCounts((current) => ({ ...current, delete: current.delete + 1 })); setOpenId(null); },
  });
}

function FixtureApp() {
  const [recentState, setRecentState] = React.useState(initialRecentState);
  const [openId, setOpenId] = React.useState(null);
  const [counts, setCounts] = React.useState({ retry: 0, all: 0, pin: 0, library: 0, delete: 0 });
  window.__designRecentCounts = counts;
  window.__designRecentSetState = setRecentState;
  const renderRecentProjectEntry = (entry) => h(RecentEntry, { key: entry.artifact.id, entry, openId, setOpenId, setCounts });
  const retryRecentProjects = () => {
    setCounts((current) => ({ ...current, retry: current.retry + 1 }));
    setRecentState((current) => ({ ...current, entries: [], loadState: { status: 'loading' } }));
  };
  return h(MemoryRouter, { initialEntries: ['/designProduction'] },
    h(React.Fragment, null,
      h(RouteProbe),
      h(LightchainDialogueParityPanel, {
        remainingUnits: 0,
        onProjectStart: () => setCounts((current) => ({ ...current, all: current.all + 1 })),
        referenceClient: mockReferenceClient,
        recentProjectScopeKey: recentState.scopeKey,
        recentProjectEntries: recentState.entries,
        recentProjectLoadState: recentState.loadState,
        onRetryRecentProjects: retryRecentProjects,
        renderRecentProjectEntry,
      })));
}

let root = null;
const mount = () => {
  root = createRoot(document.getElementById('fixture-root'));
  root.render(h(FixtureApp));
};
mount();
window.__designRecentUnmount = () => root?.render(null);
window.__designRecentScopeA = scopeA;
window.__designRecentEntries = { localEntry, remoteEntry, manyEntries };
`;

const reserveFreePort = () => new Promise<number>((resolve, reject) => {
  const server = createTcpServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      reject(new Error('temporary Vite port could not be read'));
      return;
    }
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});

const installFixtureInPage = (page: Page) => page.evaluate(async () => {
  const RefreshModule = await import('/@react-refresh');
  const RefreshRuntime = RefreshModule.default ?? RefreshModule;
  RefreshRuntime.injectIntoGlobalHook(window);
  window.$RefreshReg$ = () => {};
  window.$RefreshSig$ = () => (type) => type;
  window.__vite_plugin_react_preamble_installed__ = true;
  await import('/__design-dialogue-recent-fixture__.tsx');
});

const createFixture = async (): Promise<{ browser: Browser; page: Page; close: () => Promise<void> }> => {
  const port = await reserveFreePort();
  const vite = await createServer({
    configFile: new URL('../vite.config.ts', import.meta.url).pathname,
    server: { host: '127.0.0.1', port, strictPort: true },
    optimizeDeps: { include: ['react', 'react-dom/client'] },
    plugins: [{
      name: 'design-dialogue-recent-virtual-fixture',
      resolveId(source) {
        if (source === '/__design-dialogue-recent-fixture__.tsx') return '\0__design-dialogue-recent-fixture__.tsx';
        return null;
      },
      load(id) {
        if (id === '\0__design-dialogue-recent-fixture__.tsx') return fixtureEntrySource;
        return null;
      },
    }],
    logLevel: 'silent',
  });
  let browser: Browser | null = null;
  try {
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1424, height: 632 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === baseUrl && requestUrl.pathname === '/__design-dialogue-recent-test__') {
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><div id="fixture-root"></div></body></html>',
        });
      }
      return requestUrl.origin === baseUrl ? route.continue() : route.abort();
    });
    await page.goto(`${baseUrl}/__design-dialogue-recent-test__`, { waitUntil: 'domcontentloaded' });
    await installFixtureInPage(page);
    await page.getByTestId('design-production-recent-projects').waitFor({ state: 'visible' });
    await page.getByText('Local newest', { exact: true }).waitFor({ state: 'visible' });
    return {
      browser,
      page,
      close: async () => { await browser?.close(); await vite.close(); },
    };
  } catch (error) {
    await browser?.close();
    await vite.close();
    throw error;
  }
};

test('production wiring consumes only canonical scoped parent entries and shared card callbacks', () => {
  assert.ok(dialogueStart >= 0 && dialogueEnd > dialogueStart);
  assert.ok(designPageStart >= 0 && designPageEnd > designPageStart);
  assert.doesNotMatch(dialogueSource, /listWorkspaceArtifacts\s*\(/, 'dialogue has no independent local-only artifact read');
  assert.match(designPageSource, /readLocalArtifacts:\s*\(\)\s*=>\s*listWorkspaceArtifacts\(brandId, userId\)[\s\S]*?readRemoteArtifacts:\s*async\s*\(\)[\s\S]*?listGeneratedImages/);
  assert.match(designPageSource, /recentProjectScopeKey=\{designScopeKey\}[\s\S]*?recentProjectEntries=\{displayDesignEntries\.slice\(0, 5\)\}[\s\S]*?recentProjectLoadState=\{displayedDesignLoadState\}[\s\S]*?onRetryRecentProjects=\{\(\) => \{ startDesignArtifactLoad\(designScopeKey, designUserId, designBrandId\); \}\}[\s\S]*?renderRecentProjectEntry=\{renderDesignProjectEntry\}/);
  assert.match(designPageSource, /const renderDesignProjectEntry = \(entry: DesignProjectEntry\) => \{[\s\S]*?<DesignRecentProjectEntryCard/);
  assert.match(pageSource, /const href = designEntryHref\(entry\)/);
  assert.match(pageSource, /heavy-design-production-pins:v2:[\s\S]*JSON\.stringify\(\[userId, brandId\]\)/);
  assert.doesNotMatch(pageSource, /heavy-design-production-pins:\$\{brandId\}/, 'brand-only legacy pin data is neither read nor migrated');
  assert.match(dialogueSource, /visibleRecentProjectEntries = recentScopeIsCurrent \? recentProjectEntries\.slice\(0, 5\) : \[\]/);
  assert.match(dialogueSource, /visibleRecentProjectLoadState\.status === 'error'[\s\S]*?onClick=\{onRetryRecentProjects\}/);
  assert.match(cssSource, /\[data-testid="design-production-recent-projects"\][^{]*\{[^}]*width:\s*calc\(100vw\s*-\s*59px\)/);
  assert.match(cssSource, /\[data-testid="design-dialogue-recent-project-grid"\][^{]*\{[^}]*column-gap:\s*8px/);
});

test('rendered recent projects show canonical max-five cards, correct remote/local hrefs, and each menu action once', async () => {
  const fixture = await createFixture();
  try {
    const { page } = fixture;
    const cardOrigins = await page.locator('[data-design-project-origin]').evaluateAll((cards) => cards.map((card) => ({
      origin: card.getAttribute('data-design-project-origin'),
      title: card.querySelector('[data-design-card-name]')?.textContent?.trim() ?? '',
    })));
    assert.equal(cardOrigins.length, 5, 'the canonical ordered list is capped at five visible projects');
    assert.deepEqual(cardOrigins, [
      { origin: 'local', title: 'Local newest' },
      { origin: 'remote', title: 'Remote latest' },
      { origin: 'local', title: 'Local middle' },
      { origin: 'remote', title: 'Remote fourth' },
      { origin: 'remote', title: 'Remote fifth' },
    ], 'duplicate canonical identity is represented by the local artifact, with the helper date/id order retained');
    assert.equal(await page.getByText('Remote duplicate', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Remote sixth', { exact: true }).count(), 0);

    await page.locator('[data-testid="design-artifact-thumbnail-remote-latest"] [data-design-card-open]').click();
    await page.waitForFunction(() => (window.__designRecentLocation ?? '').includes('galleryImageId='));
    assert.equal(await page.evaluate(() => window.__designRecentLocation), '/canvas/new?galleryImageId=remote-image-1');
    await page.locator('[data-testid="design-artifact-thumbnail-local-newest"] [data-design-card-open]').click();
    await page.waitForFunction(() => (window.__designRecentLocation ?? '').includes('sourceArtifactId='));
    assert.equal(await page.evaluate(() => window.__designRecentLocation), '/canvas/new?sourceArtifactId=local-newest');

    const localCard = page.locator('[data-design-project-origin="local"]').filter({ hasText: 'Local newest' });
    const menuButton = localCard.getByRole('button', { name: 'Local newestのメニュー' });
    for (const [label, counter] of [['ピン留め', 'pin'], ['アセットライブラリに保存', 'library'], ['削除', 'delete']] as const) {
      await menuButton.click();
      await page.getByRole('menu').getByRole('menuitem', { name: label }).click();
      await page.waitForFunction((key) => window.__designRecentCounts?.[key] > 0, counter);
      assert.equal(await page.evaluate((key) => window.__designRecentCounts?.[key], counter), 1, `${label} callback fires exactly once`);
    }
    await page.getByTestId('design-dialogue-recent-projects-all').click();
    assert.equal(await page.evaluate(() => window.__designRecentCounts?.all), 1, 'All display delegates exactly once');

    const geometry = await page.evaluate(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? { x: rect.x, width: rect.width } : null;
      };
      const cards = [...document.querySelectorAll('[data-design-project-origin]')];
      const first = cards[0]?.getBoundingClientRect();
      const second = cards[1]?.getBoundingClientRect();
      const section = box('[data-testid="design-production-recent-projects"]');
      const editor = box('[data-design-dialogue-editor]');
      return { section, editor, cardPitch: first && second ? second.x - first.x : null };
    });
    assert.ok(geometry.section && geometry.editor);
    assert.ok(Math.abs(geometry.section.x - 27.5) <= 1, `recent starts at ${geometry.section.x}, expected 27.5`);
    assert.ok(Math.abs(geometry.section.width - 1365) <= 1, `recent width ${geometry.section.width}, expected 1365`);
    assert.ok(Math.abs(geometry.editor.width - 960) <= 1, 'the dialogue editor remains its measured fixed 960px width');
    assert.ok(geometry.cardPitch !== null && Math.abs(geometry.cardPitch - 228) <= 1, `card pitch ${geometry.cardPitch}, expected 228`);
  } finally {
    await fixture.close();
  }
});

test('recent-project read failure stays distinct from empty, retries read-only, and clears on logout or scope change', async () => {
  const fixture = await createFixture();
  try {
    const { page } = fixture;
    const localOnly = await page.locator('[data-design-project-origin="local"]').filter({ hasText: 'Local newest' }).evaluate((card) => card.getAttribute('data-design-project-origin'));
    assert.equal(localOnly, 'local');
    await page.evaluate(() => window.__designRecentSetState({
      scopeKey: window.__designRecentScopeA,
      entries: [window.__designRecentEntries.localEntry],
      loadState: { status: 'error', remoteError: 'remote_list_failed', localEntries: [window.__designRecentEntries.localEntry] },
    }));
    await page.getByTestId('design-dialogue-recent-projects-error').waitFor({ state: 'visible' });
    await page.getByText('Local newest', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('design-dialogue-recent-projects-empty').count(), 0, 'remote failure is not rendered as genuine empty');
    await page.getByTestId('design-dialogue-recent-projects-retry').click();
    await page.getByTestId('design-dialogue-recent-projects-loading').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window.__designRecentCounts?.retry), 1, 'retry calls the parent read callback once');
    assert.equal(await page.getByText('Local newest', { exact: true }).count(), 0, 'stale cards clear while the retry is loading');

    await page.evaluate(() => window.__designRecentSetState({ scopeKey: window.__designRecentScopeA, entries: [], loadState: { status: 'empty' } }));
    await page.getByTestId('design-dialogue-recent-projects-empty').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('design-dialogue-recent-projects-error').count(), 0, 'true empty is distinct from a failed read');

    await page.evaluate(() => window.__designRecentSetAuth('recent-user-b', 'recent-brand-b'));
    await page.getByTestId('design-dialogue-recent-projects-loading').waitFor({ state: 'visible' });
    assert.equal(await page.getByText('Local newest', { exact: true }).count(), 0, 'old brand results are hidden immediately');
    await page.evaluate(() => window.__designRecentSetState({
      scopeKey: 'recent-user-b:recent-brand-b',
      entries: [{ origin: 'local', artifact: { id: 'local-brand-b', brandId: 'recent-brand-b', featureType: 'generate-image', title: 'Brand B only', imageUrl: '', prompt: '', createdAt: '2026-09-30T12:00:00.000Z', metadata: {} } }],
      loadState: { status: 'ready', entries: [] },
    }));
    await page.getByText('Brand B only', { exact: true }).waitFor({ state: 'visible' });

    await page.evaluate(() => window.__designRecentSetAuth(null, null));
    await page.getByTestId('design-dialogue-recent-projects-empty').waitFor({ state: 'visible' });
    assert.equal(await page.getByText('Brand B only', { exact: true }).count(), 0, 'logout hides the prior scope before another read is supplied');
  } finally {
    await fixture.close();
  }
});
