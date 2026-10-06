import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
const thumbnailSource = await readFile(new URL('../src/components/DesignArtifactThumbnail.tsx', import.meta.url), 'utf8');
const fixtureEntrySource = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DesignArtifactThumbnail } from '/src/components/DesignArtifactThumbnail.tsx';
import { CreationCard, DesignNewFileCard } from '/src/pages/LightchainParityPages.tsx';
import { useAuthStore } from '/src/stores/authStore.ts';
import { DESIGN_PROJECT_PAGE_SIZE, paginate } from '/src/lib/designProjectArtifacts.ts';

const h = React.createElement;
useAuthStore.setState({ user: { id: 'css-test-user' }, currentBrand: { id: 'css-test-brand' } });

const TestCard = () => {
  const [imageUrl, setImageUrl] = React.useState('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="167"><rect width="220" height="167" fill="#35a0a0"/></svg>'));
  const [menuExpanded, setMenuExpanded] = React.useState(false);
  window.__breakDesignCardPreview = () => setImageUrl('data:image/png;base64,not-valid');
  const artifact = {
    id: 'local-a1d3a15d-4d27-4c93-ad1c-5fe04d438df6', brandId: 'css-test-brand',
    featureType: 'fashion-studio-detail-generated-result', title: 'Studio shirt',
    imageUrl, prompt: null, createdAt: '2026-09-30T00:00:00.000Z', metadata: {},
  };
  const card = h('article', { className: 'relative h-60 overflow-visible rounded-2xl border border-white/10 bg-white/5 text-left' },
    h(DesignArtifactThumbnail, {
      artifact, userId: 'css-test-user', brandId: 'css-test-brand',
      href: '/canvas/new?sourceArtifactId=local-a1d3a15d-4d27-4c93-ad1c-5fe04d438df6',
      onOpen: () => { window.__designCardOpened = artifact.id; },
    }),
    h('button', { type: 'button', className: 'block h-[96px] w-full cursor-pointer overflow-hidden rounded-b-2xl p-4 pr-12 text-left', 'data-design-card-title': '', 'aria-label': 'Studio shirtをCanvasで開く', onClick: () => { window.__designCardOpened = artifact.id; } },
      h('p', { className: 'truncate font-medium', 'data-design-card-name': '' }, 'Studio shirt'),
      h('p', { className: 'mt-2 truncate text-xs text-neutral-400', 'data-design-card-date': '' }, '今日 修正')),
    h('div', { className: 'absolute right-2 top-2 z-20', 'data-design-card-menu': '' },
      h('button', { type: 'button', className: 'rounded-lg bg-black/45 p-2 text-neutral-200', 'aria-label': 'Studio shirtのメニュー', 'aria-expanded': menuExpanded, onClick: () => setMenuExpanded((expanded) => !expanded) },
        h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, h('circle', { cx: 8, cy: 8, r: 1, fill: 'currentColor' }))),
      menuExpanded && h('div', { role: 'menu', className: 'absolute right-0 top-full z-30 mt-2 min-w-48 rounded-lg border border-white/10 bg-[#202627] p-1 shadow-2xl' },
        h('button', { type: 'button', role: 'menuitem', className: 'block w-full rounded px-3 py-2 text-left text-xs text-neutral-200' }, 'ピン留め'),
        h('button', { type: 'button', role: 'menuitem', className: 'block w-full rounded px-3 py-2 text-left text-xs text-neutral-200' }, 'アセットライブラリに保存'),
        h('button', { type: 'button', role: 'menuitem', className: 'block w-full rounded px-3 py-2 text-left text-xs text-red-300' }, '削除'))));
  const projectTabs = h('div', { role: 'tablist', 'data-design-tablist': '', className: 'mx-auto mt-8 flex w-fit rounded-2xl border border-white/10 bg-white/10 p-1' },
    h('button', { type: 'button', role: 'tab', 'aria-selected': 'true', 'data-testid': 'project-active-tab', className: 'h-10 w-[210px] rounded-xl px-0 py-1 text-lg font-medium shadow-sm' }, 'プロジェクトから開始'),
    h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-testid': 'project-inactive-tab', className: 'h-10 w-[146px] rounded-xl px-0 py-1 text-lg font-medium text-neutral-400 hover:text-white' }, '対話から開始'));
  const dialogueTabs = h('div', { role: 'tablist', 'data-design-tablist': '', className: 'mx-auto mt-8 flex w-fit rounded-2xl border border-white/10 bg-white/10 p-1' },
    h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-testid': 'dialogue-inactive-tab', className: 'h-10 w-[210px] rounded-xl px-0 py-1 text-lg font-medium text-neutral-400 hover:text-white' }, 'プロジェクトから開始'),
    h('button', { type: 'button', role: 'tab', 'aria-selected': 'true', 'data-testid': 'dialogue-active-tab', className: 'h-10 w-[146px] rounded-xl px-0 py-1 text-lg font-medium shadow-sm' }, '対話から開始'));
  const creationCards = h('section', {
    'data-testid': 'design-creation-measure-fixture',
    style: { position: 'absolute', left: '131.5px', top: '272px', display: 'grid', gridTemplateColumns: 'repeat(5, 228px)', columnGap: '8px' },
  },
  h(DesignNewFileCard),
  h(CreationCard, { icon: h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('circle', { cx: 12, cy: 12, r: 8, fill: 'none', stroke: 'currentColor' })), title: 'インスピレーション', actionLabel: 'デザインプロジェクトを新規作成', onClick: () => {} }),
  h(CreationCard, { icon: h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('circle', { cx: 12, cy: 12, r: 8, fill: 'none', stroke: 'currentColor' })), title: 'プリント修正', actionLabel: 'プリントプロジェクトを新規作成', onClick: () => {} }),
  h(CreationCard, { icon: h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('circle', { cx: 12, cy: 12, r: 8, fill: 'none', stroke: 'currentColor' })), title: '生地イメージ', actionLabel: '生地プロジェクトを新規作成', onClick: () => {} }),
  h(CreationCard, { icon: h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('circle', { cx: 12, cy: 12, r: 8, fill: 'none', stroke: 'currentColor' })), title: '企画提案書', actionLabel: '企画提案書を新規作成', onClick: () => {} }));
  const page = paginate(Array.from({ length: 31 }, (_, index) => index + 1), 1, DESIGN_PROJECT_PAGE_SIZE);
  const pagination = h('div', { className: 'mt-5 flex flex-wrap items-center justify-end gap-2', 'data-testid': 'design-production-pagination', 'aria-label': 'マイプロジェクトページング' },
    h('button', { type: 'button', 'aria-label': '前のページ', className: 'flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-neutral-300', disabled: page.page === 1 }, '‹'),
    ...Array.from({ length: page.pageCount }, (_, index) => h('button', {
      key: index,
      type: 'button',
      'aria-current': index + 1 === page.page ? 'page' : undefined,
      'data-testid': 'design-page-number-' + (index + 1),
      className: 'px-1.5 text-xs',
    }, index + 1)),
    h('button', { type: 'button', 'aria-label': '次のページ', className: 'flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-neutral-300', disabled: page.page === page.pageCount }, '›'));
  return h('div', { className: 'design-production-parity' },
    h('div', { 'data-testid': 'design-production-page' },
      projectTabs,
      creationCards,
      h('section', { 'data-testid': 'design-production-persisted-projects' },
        h('div', {}, h('h2', {}, '保存済みデザインプロジェクト')),
        h('div', { className: 'mt-4 grid gap-4 grid-cols-2 sm:grid-cols-5', 'data-testid': 'design-production-project-grid' }, card)),
      pagination,
      h('div', { 'data-testid': 'design-fixture-page-count', 'data-page-count': page.pageCount }, page.pageCount)),
    h('div', { className: 'design-production-parity', 'data-testid': 'dialogue-branch-fixture' }, dialogueTabs));
};

const fixtureRoot = document.getElementById('fixture-root');
fixtureRoot.id = 'isolated-design-card-cascade-fixture';
fixtureRoot.style.cssText = 'position:fixed;left:0;top:0;width:1424px;height:632px;overflow:hidden;z-index:99999';
createRoot(fixtureRoot).render(h(TestCard));
`;

test('Design card child sizing is semantic and does not retain the colliding positional rules', () => {
  const start = css.indexOf('/* Design saved-card child sizing uses semantic hooks');
  const end = css.indexOf('/* Match the canonical Lightchain library surface', start);
  assert.ok(start >= 0 && end > start, 'the bounded Design card rule block exists');
  const cardRules = css.slice(start, end);
  assert.doesNotMatch(cardRules, /nth-child|first-child|last-child|article\s*>\s*div/);
  assert.match(cardRules, /\[data-testid\^="design-artifact-thumbnail-"\]\s*\{[^}]*height:\s*167px/);
  assert.match(cardRules, /\[data-design-card-open\]\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/);
  assert.match(cardRules, /\[data-design-card-open\]\s*>\s*img\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/);
  assert.match(cardRules, /\[data-design-card-title\]\s*\{[^}]*height:\s*73px[^}]*padding:\s*12px/);
  assert.match(cardRules, /\[data-design-card-menu\]\s*>\s*button\s*\{[^}]*width:\s*32px[^}]*height:\s*32px[^}]*padding:\s*0/);
  assert.match(pageSource, /data-design-card-title=""/);
  assert.match(pageSource, /data-design-card-name=""/);
  assert.match(pageSource, /data-design-card-date=""/);
  assert.match(pageSource, /data-design-card-menu=""/);
  assert.match(thumbnailSource, /data-design-card-open=""/);
  assert.match(pageSource, /paginate\(projectGridItems, projectPage, DESIGN_PROJECT_PAGE_SIZE\)/);
  assert.match(pageSource, /data-testid="design-production-pagination"/);

  const mainPageStart = pageSource.indexOf('export function LightchainDesignProductionPage');
  const dialoguePanelStart = pageSource.indexOf('function LightchainDialogueParityPanel', mainPageStart);
  const nextPageComponent = pageSource.indexOf('\nexport function FileCardIcon', dialoguePanelStart);
  const mainPageSource = pageSource.slice(mainPageStart, dialoguePanelStart);
  const dialoguePanelSource = pageSource.slice(dialoguePanelStart, nextPageComponent);
  assert.match(mainPageSource, /data-design-tablist=""/);
  assert.match(mainPageSource, /<DesignNewFileCard \/>/);
  assert.equal((mainPageSource.match(/<CreationCard /g) ?? []).length, 4);
  assert.match(mainPageSource, /aria-hidden="true" className="design-production-hero-glow pointer-events-none absolute inset-x-0 top-0"/);
  assert.match(mainPageSource, /items-center justify-end gap-2" data-testid="design-production-pagination"/);
  assert.doesNotMatch(mainPageSource, /activeTab === tab \? 'bg-white\/15 text-white shadow-sm'/);
  assert.match(dialoguePanelSource, /ParityShell className="design-production-parity bg/);
  assert.match(dialoguePanelSource, /data-design-tablist=""/);
  const creationCardStart = pageSource.indexOf('export function DesignNewFileCard');
  const creationCardEnd = pageSource.indexOf('\nconst libraryGroups', creationCardStart);
  const creationCardSource = pageSource.slice(creationCardStart, creationCardEnd);
  assert.match(creationCardSource, /data-design-creation-card=""/);
  assert.match(creationCardSource, /data-creation-card-content=""/);
  assert.match(creationCardSource, /data-creation-card-icon=""/);
  assert.match(creationCardSource, /data-creation-card-label=""/);
  assert.match(css, /\[data-creation-card-content\][^{]*\{[^}]*height:\s*53px[^}]*gap:\s*8px/);
  assert.match(css, /\[data-creation-card-icon\][^{]*\{[^}]*width:\s*24px[^}]*height:\s*24px[^}]*color:\s*#e3e8e8/);
  assert.match(css, /\[data-creation-card-label\][^{]*\{[^}]*height:\s*21px[^}]*color:\s*#e3e8e8[^}]*font-size:\s*16px/);
  assert.doesNotMatch(dialoguePanelSource, /aria-selected className="[^"]*bg-white\/15[^"]*text-white/);
  assert.match(css, /--design-tab-selected-bg:\s*rgba\(255,255,255,\.15\)/);
  assert.match(css, /--design-tab-selected-fg:\s*#20d0c4/);
  assert.match(css, /\[data-design-tablist\] > \[role="tab"\]\[aria-selected="false"\]\s*\{[^}]*color:\s*#e3e8e8/);
  assert.match(css, /\[data-design-tablist\] > \[role="tab"\]\[aria-selected="true"\]\s*\{[^}]*background:\s*var\(--design-tab-selected-bg\);\s*color:\s*var\(--design-tab-selected-fg\)/);
  assert.match(css, /\[data-design-tablist\] > \[role="tab"\]\[aria-selected="false"\]:hover\s*\{[^}]*color:\s*#fff/);
  assert.match(css, /\[data-design-card-menu\]\s*\{[^}]*opacity:\s*0;\s*pointer-events:\s*none/);
  assert.match(css, /article:hover \[data-design-card-menu\]/);
  assert.match(css, /article:focus-within \[data-design-card-menu\]/);
  assert.match(css, /\[data-design-card-menu\]:has\(> button\[aria-expanded="true"\]\)/);
  assert.match(css, /@media \(hover: none\)[\s\S]*?\[data-design-card-menu\][^}]*opacity:\s*1;\s*pointer-events:\s*auto/);
  assert.match(css, /design-production-hero-glow \{ height: 220px; background-image: radial-gradient\([^;]+radial-gradient\(/);
  assert.match(css, /\[data-testid="design-production-pagination"\]\s*\{ justify-content: flex-end; \}/);
  assert.match(css, /\[data-testid="design-production-pagination"\] > button:not\(\[aria-label\]\) \{[^}]*width: 32px; height: 32px/);
  assert.match(css, /\[data-testid="design-production-pagination"\] > button\[aria-current="page"\] \{[^}]*color: var\(--design-tab-selected-fg\)/);
  assert.match(css, /\[data-design-tablist\] > \[role="tab"\]:focus-visible[\s\S]*?outline: 2px solid var\(--design-tab-selected-fg\)/);
  assert.match(css, /\[data-testid="design-production-pagination"\] > button:focus-visible/);
  assert.match(pageSource, /Array\.from\(\{ length: page\.pageCount \}/);
  assert.match(pageSource, /aria-current=\{index \+ 1 === page\.page \? 'page' : undefined\}/);
  assert.match(pageSource, /ピン留め/);
  assert.match(pageSource, /アセットライブラリに保存/);
  assert.ok(pageSource.includes('role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-red-300 hover:bg-white/10"'));
  assert.ok(pageSource.includes('>削除</button>'));
});

test('actual Design thumbnail component and stylesheet cascade preserve the measured card geometry', async () => {
  const vite = await createServer({
    configFile: new URL('../vite.config.ts', import.meta.url).pathname,
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    optimizeDeps: { include: ['react', 'react-dom/client'] },
    plugins: [{
      name: 'design-card-cascade-virtual-fixture',
      resolveId(source) {
        if (source === '/__design-card-cascade-fixture__.tsx') return '\0__design-card-cascade-fixture__.tsx';
        return null;
      },
      load(id) {
        if (id === '\0__design-card-cascade-fixture__.tsx') return fixtureEntrySource;
        return null;
      },
    }],
    logLevel: 'silent',
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1424, height: 632 },
      deviceScaleFactor: 2,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const reactDependencyUrls = { react: new Set<string>(), reactDom: new Set<string>() };
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/node_modules/.vite/deps/react.js')) reactDependencyUrls.react.add(request.url());
      if (requestUrl.pathname.endsWith('/node_modules/.vite/deps/react-dom_client.js')) reactDependencyUrls.reactDom.add(request.url());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.route('**/*', (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === baseUrl && requestUrl.pathname === '/__design-card-cascade-test__') {
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><div id="fixture-root"></div></body></html>',
        });
      }
      return requestUrl.origin === baseUrl ? route.continue() : route.abort();
    });
    await page.goto(`${baseUrl}/__design-card-cascade-test__`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const RefreshModule = await import('/@react-refresh');
      const RefreshRuntime = RefreshModule.default ?? RefreshModule;
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/__design-card-cascade-fixture__.tsx');
    });

    const mainGeometry = await page.waitForFunction(() => {
      const root = document.querySelector('#isolated-design-card-cascade-fixture');
      const thumbnail = root?.querySelector('[data-testid^="design-artifact-thumbnail-"]');
      const navigation = root?.querySelector('[data-design-card-open]');
      const image = navigation?.querySelector('img');
      const footer = root?.querySelector('[data-design-card-title]');
      const menu = root?.querySelector('[data-design-card-menu] > button');
      if (!root || !thumbnail || !navigation || !image || image.naturalWidth === 0 || !footer || !menu) return false;
      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return {
        card: box(root.querySelector('article')!),
        thumbnail: box(thumbnail),
        navigation: box(navigation),
        image: box(image),
        footer: box(footer),
        footerPadding: getComputedStyle(footer).padding,
        menu: box(menu),
        menuOffset: { top: getComputedStyle(menu.parentElement!).top, right: getComputedStyle(menu.parentElement!).right },
        imageLoaded: image.naturalWidth > 0,
      };
    }, undefined, { timeout: 10_000 }).then((handle) => handle.jsonValue()) as {
      card: { width: number; height: number };
      thumbnail: { width: number; height: number };
      navigation: { width: number; height: number };
      image: { width: number; height: number };
      footer: { width: number; height: number };
      footerPadding: string;
      menu: { width: number; height: number };
      menuOffset: { top: string; right: string };
      imageLoaded: boolean;
    };
    const size = ({ width, height }: { width: number; height: number }) => ({ width, height });
    assert.deepEqual(size(mainGeometry.card), { width: 220, height: 240 });
    assert.deepEqual(size(mainGeometry.thumbnail), { width: 220, height: 167 });
    assert.deepEqual(size(mainGeometry.navigation), { width: 220, height: 167 });
    assert.deepEqual(size(mainGeometry.image), { width: 220, height: 167 });
    assert.deepEqual(size(mainGeometry.footer), { width: 220, height: 73 });
    assert.equal(mainGeometry.footerPadding, '12px');
    assert.deepEqual(size(mainGeometry.menu), { width: 32, height: 32 });
    assert.equal(mainGeometry.menuOffset.top, '8px');
    assert.equal(mainGeometry.menuOffset.right, '8px');
    assert.equal(mainGeometry.imageLoaded, true);
    const creationGeometry = await page.evaluate(() => [...document.querySelectorAll('[data-testid="design-creation-measure-fixture"] > [data-design-creation-card]')].map((card) => {
      const content = card.querySelector('[data-creation-card-content]')!;
      const icon = card.querySelector('[data-creation-card-icon]')!;
      const label = card.querySelector('[data-creation-card-label]')!;
      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return {
        title: label.textContent,
        card: box(card),
        content: box(content),
        icon: box(icon),
        label: box(label),
        gap: getComputedStyle(content).rowGap,
        iconColor: getComputedStyle(icon).color,
        labelColor: getComputedStyle(label).color,
      };
    }));
    assert.equal(creationGeometry.length, 5, 'the real new-file tile and all four CreationCards render');
    for (const geometry of creationGeometry) {
      assert.deepEqual(size(geometry.card), { width: 228, height: 160 });
      assert.deepEqual(size(geometry.icon), { width: 24, height: 24 });
      assert.equal(geometry.content.height, 53);
      assert.ok(geometry.label.width > 0);
      assert.equal(geometry.label.height, 21);
      assert.equal(geometry.gap, '8px');
      assert.equal(geometry.iconColor, 'rgb(227, 232, 232)');
      assert.equal(geometry.labelColor, 'rgb(227, 232, 232)');
      assert.equal(geometry.icon.y - geometry.card.y, 53.5);
      assert.equal(geometry.label.y - geometry.card.y, 85.5);
      assert.equal(geometry.label.y - geometry.icon.y - geometry.icon.height, 8);
      assert.ok(Math.abs(geometry.icon.x + geometry.icon.width / 2 - (geometry.card.x + geometry.card.width / 2)) < 0.5);
      assert.ok(Math.abs(geometry.label.x + geometry.label.width / 2 - (geometry.card.x + geometry.card.width / 2)) < 0.5);
    }
    assert.deepEqual(creationGeometry.map((geometry) => geometry.title), ['新規ファイル', 'インスピレーション', 'プリント修正', '生地イメージ', '企画提案書']);
    const creationAction = page.getByRole('button', { name: 'デザインプロジェクトを新規作成' });
    assert.equal(await creationAction.evaluate((button) => getComputedStyle(button.parentElement!).opacity), '0');
    await page.locator('[data-design-creation-card]').nth(1).hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-design-creation-card] button')!.parentElement!).opacity === '1');
    assert.equal(await creationAction.isVisible(), true, 'CreationCard hover actions remain available');
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-design-creation-card] button')!.parentElement!).opacity === '0');
    const selectedTabStyles = await page.evaluate(() => {
      const readStyles = (selector: string) => {
        const tab = document.querySelector(selector)!;
        const scope = tab.closest('.design-production-parity')!;
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;background-color:var(--design-tab-selected-bg);color:var(--design-tab-selected-fg)';
        scope.append(probe);
        const expected = getComputedStyle(probe);
        const actual = getComputedStyle(tab);
        const result = {
          background: actual.backgroundColor,
          foreground: actual.color,
          expectedBackground: expected.backgroundColor,
          expectedForeground: expected.color,
        };
        probe.remove();
        return result;
      };
      return {
        project: readStyles('[data-testid="project-active-tab"]'),
        dialogue: readStyles('[data-testid="dialogue-active-tab"]'),
        projectInactive: getComputedStyle(document.querySelector('[data-testid="project-inactive-tab"]')!).color,
        dialogueInactive: getComputedStyle(document.querySelector('[data-testid="dialogue-inactive-tab"]')!).color,
      };
    });
    for (const branch of [selectedTabStyles.project, selectedTabStyles.dialogue]) {
      assert.equal(branch.background, branch.expectedBackground);
      assert.equal(branch.foreground, branch.expectedForeground);
    }
    assert.equal(selectedTabStyles.project.foreground, 'rgb(32, 208, 196)');
    assert.equal(selectedTabStyles.dialogue.foreground, 'rgb(32, 208, 196)');
    assert.equal(selectedTabStyles.projectInactive, 'rgb(227, 232, 232)');
    assert.equal(selectedTabStyles.dialogueInactive, 'rgb(227, 232, 232)');

    const pageUi = await page.evaluate(() => {
      const pagination = document.querySelector('[data-testid="design-production-pagination"]')!;
      const pageButtons = [...pagination.querySelectorAll('button[data-testid^="design-page-number-"]')];
      const activePage = pagination.querySelector('button[aria-current="page"]')!;
      const inactivePage = pageButtons.find((button) => button !== activePage)!;
      const activeStyle = getComputedStyle(activePage);
      const inactiveStyle = getComputedStyle(inactivePage);
      const paginationBox = pagination.getBoundingClientRect();
      const lastButtonBox = pagination.lastElementChild!.getBoundingClientRect();
      const activeBox = activePage.getBoundingClientRect();
      return {
        pageCount: Number(document.querySelector('[data-testid="design-fixture-page-count"]')?.getAttribute('data-page-count')),
        pageLabels: pageButtons.map((button) => button.textContent),
        pageSizes: pageButtons.map((button) => {
          const box = button.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
        justifyContent: getComputedStyle(pagination).justifyContent,
        rightAligned: Math.abs(paginationBox.right - lastButtonBox.right) < 1,
        active: {
          width: activeBox.width,
          height: activeBox.height,
          background: activeStyle.backgroundColor,
          foreground: activeStyle.color,
        },
        inactiveForeground: inactiveStyle.color,
      };
    });
    assert.equal(pageUi.pageCount, 2, '31 actual fixture entries at the production page size produce two pages');
    assert.deepEqual(pageUi.pageLabels, ['1', '2']);
    assert.deepEqual(pageUi.pageSizes, [{ width: 32, height: 32 }, { width: 32, height: 32 }]);
    assert.notEqual(pageUi.pageCount, 6);
    assert.equal(pageUi.justifyContent, 'flex-end');
    assert.equal(pageUi.rightAligned, true);
    assert.deepEqual({ width: pageUi.active.width, height: pageUi.active.height }, { width: 32, height: 32 });
    assert.equal(pageUi.active.background, selectedTabStyles.project.expectedBackground);
    assert.equal(pageUi.active.foreground, 'rgb(32, 208, 196)');
    assert.equal(pageUi.inactiveForeground, 'rgb(115, 115, 115)');

    const menu = page.locator('[data-design-card-menu]');
    const menuButton = menu.getByRole('button', { name: 'Studio shirtのメニュー' });
    const initialMenu = await menu.evaluate((element) => ({
      opacity: getComputedStyle(element).opacity,
      pointerEvents: getComputedStyle(element).pointerEvents,
    }));
    assert.deepEqual(initialMenu, { opacity: '0', pointerEvents: 'none' });
    await page.locator('#isolated-design-card-cascade-fixture article').hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-design-card-menu]')!).opacity === '1');
    assert.equal(await menu.evaluate((element) => getComputedStyle(element).pointerEvents), 'auto');
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-design-card-menu]')!).opacity === '0');

    await page.keyboard.press('Tab');
    const firstKeyboardFocus = await page.evaluate(() => ({
      isProjectTab: document.activeElement?.getAttribute('data-testid') === 'project-active-tab',
      outlineStyle: getComputedStyle(document.activeElement!).outlineStyle,
      outlineWidth: getComputedStyle(document.activeElement!).outlineWidth,
      outlineColor: getComputedStyle(document.activeElement!).outlineColor,
    }));
    assert.deepEqual(firstKeyboardFocus, {
      isProjectTab: true,
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'rgb(32, 208, 196)',
    });
    await page.keyboard.press('Tab'); // inactive project tab
    await page.locator('[data-design-tablist] [aria-selected="false"]').first().hover();
    assert.equal(await page.locator('[data-design-tablist] [aria-selected="false"]').first().evaluate((element) => getComputedStyle(element).color), 'rgb(255, 255, 255)');
    await page.mouse.move(0, 0);
    await page.locator('[data-design-card-open]').focus();
    await page.keyboard.press('Tab'); // card title button
    await page.keyboard.press('Tab'); // hidden menu button must remain in tab order
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-design-card-menu] > button');
      return document.activeElement === button && getComputedStyle(button!.parentElement!).opacity === '1';
    });
    const keyboardMenu = await menuButton.evaluate((element) => ({
      focused: document.activeElement === element,
      opacity: getComputedStyle(element.parentElement!).opacity,
      pointerEvents: getComputedStyle(element.parentElement!).pointerEvents,
      expanded: element.getAttribute('aria-expanded'),
    }));
    assert.deepEqual(keyboardMenu, { focused: true, opacity: '1', pointerEvents: 'auto', expanded: 'false' });
    await page.keyboard.press('Tab'); // first enabled page number; previous is disabled
    const focusedPageStyle = await page.getByTestId('design-page-number-1').evaluate((element) => ({
      focused: document.activeElement === element,
      outlineStyle: getComputedStyle(element).outlineStyle,
      outlineWidth: getComputedStyle(element).outlineWidth,
      outlineColor: getComputedStyle(element).outlineColor,
    }));
    assert.deepEqual(focusedPageStyle, {
      focused: true,
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'rgb(32, 208, 196)',
    });
    await page.keyboard.press('Shift+Tab'); // disabled previous button is skipped
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-design-card-menu] > button')?.getAttribute('aria-expanded') === 'true');
    await menuButton.evaluate((element) => (element as HTMLElement).blur());
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-design-card-menu]')!).opacity === '1');
    const openMenuBounds = await page.evaluate(() => {
      const card = document.querySelector('#isolated-design-card-cascade-fixture article')!;
      const menu = card.querySelector('[role="menu"]')!;
      const cardBox = card.getBoundingClientRect();
      const menuBox = menu.getBoundingClientRect();
      return {
        cardOverflow: getComputedStyle(card).overflow,
        menuItemCount: menu.querySelectorAll('[role="menuitem"]').length,
        withinCard: menuBox.top >= cardBox.top && menuBox.left >= cardBox.left
          && menuBox.right <= cardBox.right && menuBox.bottom <= cardBox.bottom,
      };
    });
    assert.equal(openMenuBounds.cardOverflow, 'hidden');
    assert.equal(openMenuBounds.menuItemCount, 3);
    assert.equal(openMenuBounds.withinCard, true, 'the accessible popup fits inside the clipped 240px card');
    await menuButton.evaluate((element) => (element as HTMLButtonElement).click());
    await menuButton.evaluate((element) => (element as HTMLElement).blur());
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-design-card-menu]')!).opacity === '0');

    assert.equal(reactDependencyUrls.react.size, 1, `expected one optimized React module URL, got ${JSON.stringify([...reactDependencyUrls.react])}`);
    assert.equal(reactDependencyUrls.reactDom.size, 1, `expected one optimized ReactDOM module URL, got ${JSON.stringify([...reactDependencyUrls.reactDom])}`);
    assert.match([...reactDependencyUrls.react][0], /[?&]v=[^&]+/);
    assert.match([...reactDependencyUrls.reactDom][0], /[?&]v=[^&]+/);
    assert.equal(pageErrors.length, 0, `isolated fixture page errors: ${JSON.stringify(pageErrors)}`);
    assert.equal(consoleErrors.some((message) => /Invalid hook call/.test(message)), false, `React singleton error: ${JSON.stringify(consoleErrors)}`);

    await page.evaluate(() => window.__breakDesignCardPreview());
    await page.getByRole('button', { name: 'Studio shirtのプレビューを再試行' }).waitFor({ state: 'visible' });
    const afterFailure = await page.evaluate(() => {
      const card = document.querySelector('#isolated-design-card-cascade-fixture article')!;
      const rect = (element: Element) => {
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      };
      const menu = card.querySelector('[data-design-card-menu] > button')!;
      const retry = card.querySelector('[aria-label="Studio shirtのプレビューを再試行"]')!;
      const open = card.querySelector('[data-design-card-open]')!;
      const footer = card.querySelector('[data-design-card-title]')!;
      const exact32 = [...card.querySelectorAll('*')].filter((element) => {
        const bounds = element.getBoundingClientRect();
        return Math.round(bounds.width) === 32 && Math.round(bounds.height) === 32;
      });
      const retryInsideOpen = open.contains(retry);
      return { menu: rect(menu), retry: rect(retry), open: rect(open), footer: rect(footer), exact32Count: exact32.length, exact32IsMenu: exact32[0] === menu, retryInsideOpen };
    });
    assert.deepEqual(afterFailure.menu, { width: 32, height: 32 });
    assert.notDeepEqual(afterFailure.retry, { width: 32, height: 32 });
    assert.deepEqual(afterFailure.open, { width: 220, height: 167 });
    assert.deepEqual(afterFailure.footer, { width: 220, height: 73 });
    assert.equal(afterFailure.exact32Count, 1);
    assert.equal(afterFailure.exact32IsMenu, true);
    assert.equal(afterFailure.retryInsideOpen, false);

    await page.locator('[data-design-card-open]').click();
    assert.equal(await page.evaluate(() => window.__designCardOpened), 'local-a1d3a15d-4d27-4c93-ad1c-5fe04d438df6');
    await context.close();
  } finally {
    await browser?.close();
    await vite.close();
  }
});
