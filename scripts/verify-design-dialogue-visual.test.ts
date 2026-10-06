import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createServer as createTcpServer } from 'node:net';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
const dialogueStart = pageSource.indexOf('export function LightchainDialogueParityPanel');
const dialogueEnd = pageSource.indexOf('\nexport function FileCardIcon', dialogueStart);
assert.ok(dialogueStart >= 0 && dialogueEnd > dialogueStart, 'the exported dialogue component source exists');
const dialogueSource = pageSource.slice(dialogueStart, dialogueEnd);

const fixtureEntrySource = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { LightchainDialogueParityPanel } from '/src/pages/LightchainParityPages.tsx';
import { useAuthStore } from '/src/stores/authStore.ts';
import { buildGenerationIntentHref, workspaceSourceConfig } from '/src/lib/workspaceHandoff.ts';

const h = React.createElement;
useAuthStore.setState({ user: null, currentBrand: null });
window.__designDialogueProjectStart = false;
window.__designDialogueExpectedHref = (prompt) => buildGenerationIntentHref({
  feature: 'design-gacha',
  prompt,
  sourceWorkspace: 'design-production',
  workflowVersion: 'design-production-brief-local-v1',
  sourceLabel: workspaceSourceConfig['design-production'].label,
  sourceResumePath: workspaceSourceConfig['design-production'].resumePath,
  sourceMode: 'local-workflow-intake',
});

function RouteProbe() {
  const location = useLocation();
  React.useEffect(() => {
    window.__designDialogueLocation = location.pathname + location.search;
  }, [location.pathname, location.search]);
  return null;
}

function Fixture() {
  return h('div', { style: { height: '100%', boxSizing: 'border-box', paddingTop: '50px' }, 'data-testid': 'lightchain-route-header-offset' },
    h(MemoryRouter, { initialEntries: ['/designProduction'] },
      h(React.Fragment, null,
        h(RouteProbe),
        h(LightchainDialogueParityPanel, {
          remainingUnits: 123,
          onProjectStart: () => { window.__designDialogueProjectStart = true; },
        }))));
}

const fixtureRoot = document.getElementById('fixture-root');
fixtureRoot.id = 'isolated-design-dialogue-fixture';
fixtureRoot.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;overflow:hidden;z-index:99999';
createRoot(fixtureRoot).render(h(Fixture));
`;

const sceneCovers = {
  生地パターン適用: '/scene-assets/fabric.png',
  線画から実写化: '/scene-assets/draft.png',
  デザインミックス: '/scene-assets/multi.png',
  プリント修正: '/scene-assets/print.png',
};

const assertNear = (actual: number, expected: number, label: string) => {
  assert.ok(Math.abs(actual - expected) <= 1, `${label}: expected ${expected}±1, got ${actual}`);
};

const assertRect = async (locator: import('@playwright/test').Locator, expected: { x: number; y: number; width: number; height: number }, label: string) => {
  const rect = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  for (const key of ['x', 'y', 'width', 'height'] as const) assertNear(rect[key], expected[key], `${label}.${key}`);
};

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

test('Design dialogue source uses verified scene assets, a single input, and the existing generation handoff', () => {
  assert.match(dialogueSource, /data-design-dialogue-editor=""/);
  assert.match(dialogueSource, /data-design-dialogue-upload-illustration="" src="\/scene-assets\/upload-placeholder\.png"/);
  assert.match(dialogueSource, /data-design-dialogue-prompt=""[\s\S]*?maxLength=\{4000\}/);
  assert.match(dialogueSource, /data-design-dialogue-counter=""/);
  assert.match(dialogueSource, /data-design-dialogue-send=""[^>]*disabled=\{!prompt\.trim\(\) \|\| !referencesReady\}/);
  assert.match(dialogueSource, /buildGenerationIntentHref\(\{[\s\S]*feature: 'design-gacha',[\s\S]*workflowVersion: 'design-production-brief-local-v1',[\s\S]*sourceMode: 'local-workflow-intake'/);
  assert.match(dialogueSource, /sourceReferences = manifest\.map\(\(\{ imageId, storagePath, name \}\) => \(\{[\s\S]*sourceImageId: imageId,[\s\S]*sourceStoragePath: storagePath,[\s\S]*sourceFileName: name/);
  assert.doesNotMatch(dialogueSource, /selectedReferenceImages|画像1を選択|画像2を選択|aria-label="画像[1-5]"/);
  assert.match(dialogueSource, /type="file"[\s\S]*accept="image\/png,image\/jpeg,image\/webp,image\/avif"[\s\S]*multiple/);
  assert.match(dialogueSource, /remainingUnits\.toLocaleString\(\)/);
  assert.match(dialogueSource, /data-testid="design-production-page"/);
  assert.match(dialogueSource, /data-testid="design-production-recent-projects"/);
  for (const [title, url] of Object.entries(sceneCovers)) {
    assert.ok(pageSource.includes(`${title}: '${url}'`), `the ${title} card points at its verified Light asset`);
  }
  assert.match(css, /\[data-design-dialogue-editor\][^{]*\{[^}]*width:\s*960px[^}]*height:\s*216px/);
  assert.match(css, /\[data-design-dialogue-prompt\][^{]*\{[^}]*left:\s*143px[^}]*width:\s*792px[^}]*height:\s*80px/);
  assert.match(css, /\[data-design-dialogue-send\][^{]*\{[^}]*width:\s*40px[^}]*height:\s*40px[^}]*border-radius:\s*9999px/);
});

test('actual dialogue component and stylesheet preserve measured desktop layout and prompt behavior', async () => {
  const port = await reserveFreePort();
  const vite = await createServer({
    configFile: new URL('../vite.config.ts', import.meta.url).pathname,
    server: { host: '127.0.0.1', port, strictPort: true },
    optimizeDeps: { include: ['react', 'react-dom/client'] },
    plugins: [{
      name: 'design-dialogue-visual-virtual-fixture',
      resolveId(source) {
        if (source === '/__design-dialogue-visual-fixture__.tsx') return '\0__design-dialogue-visual-fixture__.tsx';
        return null;
      },
      load(id) {
        if (id === '\0__design-dialogue-visual-fixture__.tsx') return fixtureEntrySource;
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
      if (requestUrl.origin === baseUrl && requestUrl.pathname === '/__design-dialogue-visual-test__') {
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><div id="fixture-root"></div></body></html>',
        });
      }
      return requestUrl.origin === baseUrl ? route.continue() : route.abort();
    });
    await page.goto(`${baseUrl}/__design-dialogue-visual-test__`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const RefreshModule = await import('/@react-refresh');
      const RefreshRuntime = RefreshModule.default ?? RefreshModule;
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/__design-dialogue-visual-fixture__.tsx');
    });
    await page.locator('[data-testid="design-dialogue-editor"]').waitFor({ state: 'visible' });

    await assertRect(page.locator('[data-design-tablist] [role="tab"]').nth(0), { x: 532, y: 203, width: 210, height: 40 }, 'project tab');
    await assertRect(page.locator('[data-design-tablist] [role="tab"]').nth(1), { x: 742, y: 203, width: 146, height: 40 }, 'dialogue tab');
    await assertRect(page.locator('[data-testid="design-dialogue-editor"]'), { x: 230, y: 272, width: 960, height: 216 }, 'editor');
    await assertRect(page.locator('[data-testid="design-dialogue-prompt"]'), { x: 374, y: 304, width: 792, height: 80 }, 'prompt textarea');
    await assertRect(page.locator('[data-design-dialogue-upload-illustration]'), { x: 255, y: 292, width: 90, height: 104 }, 'upload illustration');
    await assertRect(page.locator('[data-testid="design-dialogue-send"]'), { x: 1132, y: 430, width: 40, height: 40 }, 'send button');
    const editorStyle = await page.locator('[data-testid="design-dialogue-editor"]').evaluate((element) => {
      const style = getComputedStyle(element);
      return { borderRadius: style.borderRadius, borderWidth: style.borderTopWidth };
    });
    assert.equal(editorStyle.borderRadius, '24px');
    assert.equal(editorStyle.borderWidth, '1px');
    const sendStyle = await page.locator('[data-testid="design-dialogue-send"]').evaluate((element) => ({
      borderRadius: getComputedStyle(element).borderRadius,
      background: getComputedStyle(element).backgroundColor,
      opacity: getComputedStyle(element).opacity,
      arrowTransform: getComputedStyle(element.querySelector('svg')!).transform,
    }));
    assert.equal(sendStyle.borderRadius, '9999px');
    assert.equal(sendStyle.background, 'rgb(11, 202, 188)');
    assert.equal(sendStyle.opacity, '0.55');
    assert.notEqual(sendStyle.arrowTransform, 'none');
    const counterPlacement = await page.evaluate(() => {
      const editor = document.querySelector('[data-testid="design-dialogue-editor"]')!.getBoundingClientRect();
      const counter = document.querySelector('[data-testid="design-dialogue-counter"]')!.getBoundingClientRect();
      const send = document.querySelector('[data-testid="design-dialogue-send"]')!.getBoundingClientRect();
      return {
        insideEditor: counter.left >= editor.left && counter.right < editor.right && counter.top >= editor.top && counter.bottom < editor.bottom,
        gapToSend: send.left - counter.right,
        centerDelta: Math.abs((send.top + send.height / 2) - (counter.top + counter.height / 2)),
      };
    });
    assert.equal(counterPlacement.insideEditor, true);
    assert.ok(counterPlacement.gapToSend > 0, 'the character count sits to the left of Send');
    assert.ok(counterPlacement.centerDelta <= 2, `counter/send vertical alignment: ${counterPlacement.centerDelta}px`);
    assert.equal(await page.getByRole('heading', { name: 'デザインワークスペースへようこそ' }).count(), 1);
    assert.equal(await page.getByText('アイデアを形にし、制作をスムーズに').count(), 1);
    assert.equal(await page.getByLabel('残りクレジット').innerText(), '123');
    assert.equal(await page.locator('[data-design-dialogue-upload-illustration]').getAttribute('src'), '/scene-assets/upload-placeholder.png');
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('[data-design-dialogue-upload-illustration], [data-design-dialogue-scene-cover]')];
      return images.length === 5 && images.every((image) => (image as HTMLImageElement).naturalWidth > 0);
    }, undefined, { timeout: 10_000 });
    const referenceInput = page.getByTestId('design-dialogue-file-input');
    assert.equal(await referenceInput.count(), 1, 'the editor exposes its real multi-file upload input');
    assert.equal(await referenceInput.getAttribute('accept'), 'image/png,image/jpeg,image/webp,image/avif');
    assert.equal(await referenceInput.getAttribute('multiple'), '');

    const tabColors = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('[data-design-tablist] [role="tab"]')];
      return tabs.map((tab) => ({ selected: tab.getAttribute('aria-selected'), color: getComputedStyle(tab).color, background: getComputedStyle(tab).backgroundColor }));
    });
    assert.equal(tabColors[0].selected, 'false');
    assert.equal(tabColors[0].color, 'rgb(227, 232, 232)');
    assert.equal(tabColors[1].selected, 'true');
    assert.equal(tabColors[1].color, 'rgb(32, 208, 196)');
    assert.equal(tabColors[1].background, 'rgba(255, 255, 255, 0.15)');
    const sendButton = page.getByRole('button', { name: '送信' });
    assert.equal(await sendButton.isDisabled(), true, 'empty prompt starts disabled');

    const sceneCards = page.locator('[data-testid="design-dialogue-scenes"] > button');
    assert.equal(await sceneCards.count(), 4);
    assert.equal(await sendButton.isDisabled(), true, 'the blank textarea keeps Send disabled');
    const sceneTitles = Object.keys(sceneCovers);
    const nativeScenePrompts = [
      '服装のデザインを変更せず、異なる生地を服装に適用してください',
      'シャツを白黒線稿の服装デザイン図に変換し、白背景にしてください',
      '画像1の色と生地を変更せず、襟型を画像2の襟型に変更してください',
      '画像1のアジサイ要素を参考に、四方連続のプリントパターンをデザインし、レイアウトとスタイルは画像2を参考にしてください',
    ];
    assert.deepEqual(nativeScenePrompts.map(value => value.length), [30, 31, 32, 59]);
    for (let index = 0; index < sceneTitles.length; index += 1) {
      const title = sceneTitles[index];
      const card = sceneCards.nth(index);
      await assertRect(card, { x: 230 + index * 242, y: 565, width: 234, height: 120 }, `${title} scene card`);
      const cover = card.locator('[data-design-dialogue-scene-cover]');
      assert.equal(await cover.getAttribute('src'), sceneCovers[title as keyof typeof sceneCovers]);
      await assertRect(cover, { x: 231 + index * 242, y: 566, width: 232, height: 118 }, `${title} scene cover`);
      assert.equal(await card.getAttribute('type'), 'button');
      assert.equal(await card.locator('text=使ってみる').evaluate((element) => getComputedStyle(element).opacity), '0');
    }
    for (let index = 0; index < nativeScenePrompts.length; index += 1) {
      await sceneCards.nth(index).click();
      assert.equal(await page.locator('[data-testid="design-dialogue-prompt"]').inputValue(), nativeScenePrompts[index]);
      assert.equal(await page.locator('[data-testid="design-dialogue-counter"]').innerText(), `${nativeScenePrompts[index].length} / 4000`);
    }
    await sceneCards.nth(0).hover();
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-testid="design-dialogue-scenes"] > button')!;
      return getComputedStyle(card.querySelector('img')!).filter.includes('blur(8px)')
        && getComputedStyle(card.querySelector('span span span')!).opacity === '1';
    }, undefined, { timeout: 5_000 });
    assert.equal(await sceneCards.nth(0).getAttribute('aria-pressed'), 'false');
    await sceneCards.nth(0).click();
    const fabricPrompt = '服装のデザインを変更せず、異なる生地を服装に適用してください';
    assert.equal(await page.locator('[data-testid="design-dialogue-prompt"]').inputValue(), fabricPrompt);
    assert.equal(fabricPrompt.length, 30, 'the evidenced Light fabric prompt length is preserved');
    assert.equal(await page.locator('[data-testid="design-dialogue-counter"]').innerText(), '30 / 4000');
    assert.equal(await sceneCards.nth(0).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.__designDialogueLocation), '/designProduction', 'a scene only fills the prompt and does not navigate');

    const prompt = '白いコットンシャツの襟元を少し整えてください';
    const promptBox = page.locator('[data-testid="design-dialogue-prompt"]');
    assert.equal(await sendButton.isDisabled(), false, 'a selected scene has a non-empty prompt');
    await promptBox.fill('x'.repeat(4001));
    assert.equal(await promptBox.inputValue().then((value) => value.length), 4000, 'maxlength prevents overflow');
    assert.equal(await page.locator('[data-testid="design-dialogue-counter"]').innerText(), '4000 / 4000');
    await promptBox.fill(prompt);
    assert.equal(await page.locator('[data-testid="design-dialogue-counter"]').innerText(), `${prompt.length} / 4000`);
    await sendButton.click();
    await page.waitForFunction(() => window.__designDialogueLocation?.startsWith('/generate?'));
    const location = await page.evaluate(() => window.__designDialogueLocation);
    const expectedHref = await page.evaluate((value) => window.__designDialogueExpectedHref(value), prompt);
    assert.equal(location, expectedHref, 'send preserves the existing generation-intent href exactly');
    const params = new URLSearchParams(location!.split('?')[1]);
    assert.equal(params.get('feature'), 'design-gacha');
    assert.equal(params.get('prompt'), prompt);
    assert.equal(params.get('workflowVersion'), 'design-production-brief-local-v1');
    assert.equal(params.get('sourceWorkspace'), 'design-production');
    assert.equal(params.get('sourceMode'), 'local-workflow-intake');
    assert.ok(params.get('sourceResumePath'));
    assert.ok(params.get('sourceLabel'));
    assert.equal(await page.evaluate(() => window.__designDialogueProjectStart), false);

    await page.setViewportSize({ width: 768, height: 632 });
    const mediumViewportPanel = await page.locator('[data-testid="design-dialogue-tabpanel"]').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, width: rect.width, viewportWidth: window.innerWidth, documentWidth: document.documentElement.scrollWidth };
    });
    assertNear(mediumViewportPanel.x, -98, '768px fixed dialogue panel x');
    assertNear(mediumViewportPanel.width, 960, '768px fixed dialogue panel width');
    assert.equal(mediumViewportPanel.documentWidth, mediumViewportPanel.viewportWidth, 'the fixed panel remains clipped rather than widening the viewport');
    await page.setViewportSize({ width: 390, height: 632 });
    const narrowViewportPanel = await page.locator('[data-testid="design-dialogue-tabpanel"]').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, width: rect.width, viewportWidth: window.innerWidth, documentWidth: document.documentElement.scrollWidth };
    });
    assertNear(narrowViewportPanel.x, -287, '390px fixed dialogue panel x');
    assertNear(narrowViewportPanel.width, 960, '390px fixed dialogue panel width');
    assert.equal(narrowViewportPanel.documentWidth, narrowViewportPanel.viewportWidth, 'the fixed panel remains clipped rather than widening the viewport');

    assert.equal(reactDependencyUrls.react.size, 1, `expected one optimized React module URL, got ${JSON.stringify([...reactDependencyUrls.react])}`);
    assert.equal(reactDependencyUrls.reactDom.size, 1, `expected one optimized ReactDOM module URL, got ${JSON.stringify([...reactDependencyUrls.reactDom])}`);
    assert.match([...reactDependencyUrls.react][0], /[?&]v=[^&]+/);
    assert.match([...reactDependencyUrls.reactDom][0], /[?&]v=[^&]+/);
    assert.equal(pageErrors.length, 0, `isolated fixture page errors: ${JSON.stringify(pageErrors)}`);
    assert.equal(consoleErrors.some((message) => /Invalid hook call/.test(message)), false, `React singleton error: ${JSON.stringify(consoleErrors)}`);
  } finally {
    await browser?.close();
    await vite.close();
  }
});
