import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createServer as createTcpServer } from 'node:net';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const componentSource = await readFile(new URL('../src/components/design/DesignCreationCard.tsx', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');

const cards = [
  {
    title: 'インスピレーション',
    actionLabel: 'デザインプロジェクトを新規作成',
    posters: ['/design-card-assets/clothing2.png', '/design-card-assets/clothing1.png'],
    buttonWidth: 228,
  },
  {
    title: 'プリント修正',
    actionLabel: 'プリントプロジェクトを新規作成',
    posters: ['/design-card-assets/print2.png', '/design-card-assets/print1.png'],
    buttonWidth: 228,
  },
  {
    title: '生地イメージ',
    actionLabel: '生地プロジェクトを新規作成',
    posters: ['/design-card-assets/fabric2.png', '/design-card-assets/fabric1.png'],
    buttonWidth: 204,
  },
  {
    title: '企画提案書',
    actionLabel: '企画提案書を新規作成',
    posters: ['/design-card-assets/techpack2.png', '/design-card-assets/techpack1.png'],
    buttonWidth: 168,
  },
] as const;

const fixtureEntrySource = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DesignCreationCard } from '/src/components/design/DesignCreationCard.tsx';

const h = React.createElement;
const cardData = [
  { title: 'インスピレーション', actionLabel: 'デザインプロジェクトを新規作成' },
  { title: 'プリント修正', actionLabel: 'プリントプロジェクトを新規作成' },
  { title: '生地イメージ', actionLabel: '生地プロジェクトを新規作成' },
  { title: '企画提案書', actionLabel: '企画提案書を新規作成' },
];
const fixtureRoot = document.getElementById('fixture-root');
fixtureRoot.id = 'isolated-design-creation-hover-fixture';
fixtureRoot.style.cssText = 'position:fixed;left:0;top:0;width:1424px;height:632px;overflow:hidden;z-index:99999';
fixtureRoot.dataset.clickCount = '0';
const icon = h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('circle', { cx: 12, cy: 12, r: 8, fill: 'none', stroke: 'currentColor' }));
const fixture = h('div', {
  className: 'design-production-parity',
  'data-testid': 'design-hover-fixture',
  style: { position: 'absolute', left: '131px', top: '120px', display: 'grid', gridTemplateColumns: 'repeat(4, 225px)', columnGap: '8px', width: '924px' },
}, ...cardData.map(({ title, actionLabel }) => h(DesignCreationCard, {
  key: actionLabel,
  icon,
  title,
  actionLabel,
  onClick: () => { fixtureRoot.dataset.clickCount = String(Number(fixtureRoot.dataset.clickCount || '0') + 1); },
})));
createRoot(fixtureRoot).render(fixture);
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

const readMatrix = (value: string, label: string) => {
  const match = value.match(/^matrix\(([^)]+)\)$/);
  assert.ok(match, `${label}: expected a computed 2D transform matrix, got ${value}`);
  return match[1].split(',').map((entry) => Number(entry.trim()));
};

const assertNear = (actual: number, expected: number, label: string) => {
  assert.ok(Math.abs(actual - expected) < 0.02, `${label}: expected ${expected}±0.02, got ${actual}`);
};

test('DesignCreationCard keeps the source poster pairs, scoped content geometry, and exact hover class endpoints', () => {
  assert.ok(componentSource.includes("'/design-card-assets/clothing2.png', '/design-card-assets/clothing1.png'"));
  assert.ok(componentSource.includes("'/design-card-assets/print2.png', '/design-card-assets/print1.png'"));
  assert.ok(componentSource.includes("'/design-card-assets/fabric2.png', '/design-card-assets/fabric1.png'"));
  assert.ok(componentSource.includes("'/design-card-assets/techpack2.png', '/design-card-assets/techpack1.png'"));
  assert.ok(componentSource.includes('absolute top-[72px] left-[60px] w-[100px] h-[128px]'));
  assert.ok(componentSource.includes('group-hover:translate-x-[39px] group-hover:-translate-y-[48px] group-hover:rotate-[5deg]'));
  assert.ok(componentSource.includes('absolute top-[80px] left-[60px] w-[100px] h-[128px]'));
  assert.ok(componentSource.includes('group-hover:-translate-x-[33px] group-hover:-translate-y-[48px] group-hover:-rotate-[10deg]'));
  assert.ok(componentSource.includes('duration-[301ms] ease-[cubic-bezier(0.5,0,0.5,1)]'));
  assert.ok(componentSource.includes('duration-200 group-hover:opacity-0'));
  assert.ok(componentSource.includes('absolute bottom-4 left-1/2 -translate-x-1/2 translate-y-4 opacity-0 transition-all duration-200 ease-in-out group-hover:translate-y-0 group-hover:opacity-100'));
  for (const width of ['w-[228px]', 'w-[204px]', 'w-[168px]']) assert.ok(componentSource.includes(width));

  assert.match(cssSource, /\[data-creation-card-content\]\s*\{[^}]*height:\s*53px[^}]*gap:\s*8px/);
  assert.match(cssSource, /\[data-creation-card-icon\]\s*\{[^}]*width:\s*24px[^}]*height:\s*24px/);
  assert.match(cssSource, /\[data-creation-card-label\]\s*\{[^}]*height:\s*21px[^}]*font-size:\s*16px/);
});

test('actual component and current CSS render all four poster pairs and measured hover endpoints in isolated Vite/Playwright', async () => {
  const port = await reserveFreePort();
  const vite = await createServer({
    configFile: new URL('../vite.config.ts', import.meta.url).pathname,
    server: { host: '127.0.0.1', port, strictPort: true },
    optimizeDeps: { include: ['react', 'react-dom/client'] },
    plugins: [{
      name: 'design-creation-hover-virtual-fixture',
      resolveId(source) {
        if (source === '/__design-creation-hover-fixture__.tsx') return '\0__design-creation-hover-fixture__.tsx';
        return null;
      },
      load(id) {
        if (id === '\0__design-creation-hover-fixture__.tsx') return fixtureEntrySource;
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
    await page.route('**/*', (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === baseUrl && requestUrl.pathname === '/__design-creation-hover-test__') {
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body style="margin:0;background:#171b1c"><div id="fixture-root"></div></body></html>',
        });
      }
      return requestUrl.origin === baseUrl ? route.continue() : route.abort();
    });
    await page.goto(`${baseUrl}/__design-creation-hover-test__`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const RefreshModule = await import('/@react-refresh');
      const RefreshRuntime = RefreshModule.default ?? RefreshModule;
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/__design-creation-hover-fixture__.tsx');
    });

    const cardLocators = page.locator('[data-design-creation-card]');
    await cardLocators.first().waitFor({ state: 'visible' });
    assert.equal(await cardLocators.count(), 4);
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('[data-creation-card-poster]')] as HTMLImageElement[];
      return images.length === 8 && images.every((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
    }, undefined, { timeout: 10_000 });

    const resting = await cardLocators.evaluateAll((elements) => elements.map((card) => {
      const cardRect = card.getBoundingClientRect();
      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      const posters = [...card.querySelectorAll('[data-creation-card-poster]')].map((poster) => {
        const image = poster as HTMLImageElement;
        const style = getComputedStyle(image);
        const rect = box(image);
        return {
          src: image.getAttribute('src'),
          complete: image.complete,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          opacity: style.opacity,
          transitionDuration: style.transitionDuration,
          transitionTimingFunction: style.transitionTimingFunction,
          leftFromCard: rect.x - cardRect.x,
          topFromCard: rect.y - cardRect.y,
          width: rect.width,
          height: rect.height,
        };
      });
      const content = card.querySelector('[data-creation-card-content]')!;
      const icon = card.querySelector('[data-creation-card-icon]')!;
      const label = card.querySelector('[data-creation-card-label]')!;
      const action = card.querySelector('button')!;
      const actionWrapper = action.parentElement!;
      return {
        title: label.textContent,
        card: box(card),
        content: box(content),
        contentOpacity: getComputedStyle(content).opacity,
        contentTransitionDuration: getComputedStyle(content).transitionDuration,
        contentGap: getComputedStyle(content).rowGap,
        icon: box(icon),
        label: box(label),
        posters,
        actionLabel: action.getAttribute('aria-label'),
        actionWidth: action.getBoundingClientRect().width,
        actionOpacity: getComputedStyle(actionWrapper).opacity,
        actionTransform: getComputedStyle(actionWrapper).transform,
        actionTransitionDuration: getComputedStyle(actionWrapper).transitionDuration,
        actionPlusIconCount: action.querySelectorAll('svg[aria-hidden="true"]').length,
      };
    }));

    assert.deepEqual(resting.map(({ title }) => title), cards.map(({ title }) => title));
    for (const [index, measurement] of resting.entries()) {
      const expected = cards[index];
      assert.deepEqual(measurement.card.width, 225, `card ${index + 1} matches the fresh r933/r938 native 225px card`);
      assert.deepEqual(measurement.card.height, 160, `card ${index + 1} keeps the current 160px minimum height`);
      assert.equal(measurement.content.height, 53);
      assert.equal(measurement.contentOpacity, '1');
      assert.equal(measurement.contentTransitionDuration, '0.2s');
      assert.equal(measurement.contentGap, '8px');
      assert.deepEqual(measurement.icon.width, 24);
      assert.deepEqual(measurement.icon.height, 24);
      assert.deepEqual(measurement.label.height, 21);
      assert.equal(measurement.actionLabel, expected.actionLabel);
      assert.equal(measurement.actionWidth, expected.buttonWidth);
      assert.equal(measurement.actionOpacity, '0');
      assert.equal(measurement.actionTransitionDuration, '0.2s');
      assert.equal(measurement.actionPlusIconCount, 1, 'the hidden action includes the added Plus icon');
      assert.equal(measurement.posters.length, 2);
      assert.deepEqual(measurement.posters.map(({ src }) => src), expected.posters);
      assert.ok(measurement.posters.every((poster) => poster.complete && poster.naturalWidth > 0 && poster.naturalHeight > 0));
      assert.ok(measurement.posters.every((poster) => poster.opacity === '0'));
      assert.ok(measurement.posters.every((poster) => poster.transitionDuration === '0.301s'));
      assert.ok(measurement.posters.every((poster) => poster.transitionTimingFunction === 'cubic-bezier(0.5, 0, 0.5, 1)'));
      assert.deepEqual(measurement.posters.map(({ width, height }) => ({ width, height })), [
        { width: 100, height: 128 },
        { width: 100, height: 128 },
      ]);
      assert.deepEqual(measurement.posters.map(({ leftFromCard, topFromCard }) => ({ leftFromCard, topFromCard })), [
        { leftFromCard: 61, topFromCard: 73 },
        { leftFromCard: 61, topFromCard: 81 },
      ]);
      const actionMatrix = readMatrix(measurement.actionTransform, `card ${index + 1} resting CTA`);
      assertNear(actionMatrix[5], 16, `card ${index + 1} resting CTA translateY`);
    }

    for (const [index, expected] of cards.entries()) {
      await cardLocators.nth(index).hover();
      await page.waitForFunction((cardIndex) => {
        const card = document.querySelectorAll('[data-design-creation-card]')[cardIndex];
        const posters = card?.querySelectorAll('[data-creation-card-poster]');
        const action = card?.querySelector('button');
        const content = card?.querySelector('[data-creation-card-content]');
        return !!card && posters?.length === 2
          && [...posters].every((poster) => getComputedStyle(poster).opacity === '1')
          && !!content && getComputedStyle(content).opacity === '0'
          && !!action && getComputedStyle(action.parentElement!).opacity === '1';
      }, index, { timeout: 2_000 });

      const card = cardLocators.nth(index);
      const hoverState = await card.evaluate((element) => {
        const posters = [...element.querySelectorAll('[data-creation-card-poster]')];
        const transform = (poster: Element) => getComputedStyle(poster).transform;
        const action = element.querySelector('button')!;
        return {
          posterOpacity: posters.map((poster) => getComputedStyle(poster).opacity),
          posterTransforms: posters.map(transform),
          posterTransitionDurations: posters.map((poster) => getComputedStyle(poster).transitionDuration),
          contentOpacity: getComputedStyle(element.querySelector('[data-creation-card-content]')!).opacity,
          actionOpacity: getComputedStyle(action.parentElement!).opacity,
          actionTransform: getComputedStyle(action.parentElement!).transform,
          actionVisible: getComputedStyle(action).visibility,
          plusIconCount: action.querySelectorAll('svg[aria-hidden="true"]').length,
        };
      });
      assert.deepEqual(hoverState.posterOpacity, ['1', '1']);
      assert.deepEqual(hoverState.posterTransitionDurations, ['0.301s', '0.301s']);
      assert.equal(hoverState.contentOpacity, '0');
      assert.equal(hoverState.actionOpacity, '1');
      assert.equal(hoverState.actionVisible, 'visible');
      assert.equal(hoverState.plusIconCount, 1);
      const firstTransform = readMatrix(hoverState.posterTransforms[0], `${expected.title} first poster`);
      const secondTransform = readMatrix(hoverState.posterTransforms[1], `${expected.title} second poster`);
      assertNear(firstTransform[0], Math.cos(5 * Math.PI / 180), `${expected.title} first rotate cosine`);
      assertNear(firstTransform[1], Math.sin(5 * Math.PI / 180), `${expected.title} first rotate sine`);
      assertNear(firstTransform[4], 39, `${expected.title} first translateX`);
      assertNear(firstTransform[5], -48, `${expected.title} first translateY`);
      assertNear(secondTransform[0], Math.cos(-10 * Math.PI / 180), `${expected.title} second rotate cosine`);
      assertNear(secondTransform[1], Math.sin(-10 * Math.PI / 180), `${expected.title} second rotate sine`);
      assertNear(secondTransform[4], -33, `${expected.title} second translateX`);
      assertNear(secondTransform[5], -48, `${expected.title} second translateY`);
      const actionMatrix = readMatrix(hoverState.actionTransform, `${expected.title} hovered CTA`);
      assertNear(actionMatrix[5], 0, `${expected.title} hovered CTA translateY`);
    }

    await cardLocators.first().hover();
    await page.waitForFunction(() => {
      const action = document.querySelector('[data-design-creation-card] button');
      return !!action && getComputedStyle(action.parentElement!).opacity === '1';
    }, undefined, { timeout: 2_000 });
    await page.getByRole('button', { name: cards[0].actionLabel }).click();
    assert.equal(await page.locator('#isolated-design-creation-hover-fixture').getAttribute('data-click-count'), '1', 'one CTA click invokes its callback exactly once');
  } finally {
    await browser?.close();
    await vite.close();
  }
});
