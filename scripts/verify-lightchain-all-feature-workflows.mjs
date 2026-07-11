#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from '@playwright/test';

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'http://127.0.0.1:4183');
const authStatePath = args.authState || process.env.HEAVY_CHAIN_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const outDir = args.out || `output/playwright/lightchain-all-feature-workflows-${dateStamp()}`;
const canvasStoreKey = 'heavy-chain-canvas';
const desktopViewport = { width: 1440, height: 1050 };
const mobileViewport = { width: 390, height: 844 };
const fittingHandoffToolIds = new Set(['ai-fitting', 'ai-fitting-reference']);
const fixturePng =
  'iVBORw0KGgoAAAANSUhEUgAAASwAAACWCAIAAADrOSKFAAABfklEQVR4nO3VwQ2DMBQFQYp2/6mOBtYiHhSg2R+TR6VJ4FD3Yh8nAAAAAAAAAAAAAAAAAAAAAACwq3n7vQG8Lr3f93nP8xz7B2z67bLvG7BXn8z3/V6f8yP4nff4+v0G7NVd9j7f6wN4u9QzAAAAAAAAAAAAAAAAAADgT2EDAiwIsCDAggALAiysx8O+vV6vR3e73V6vV6vR6fP5/PL5fL1eL5fL5fL5fL5fK9Xq9Xq9Xq9Xq9Xq9Xq8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLw8Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pg8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Px8fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fAAAAAAAAAAAAAAAAAAAAAAD4O8EGAiwIsCDAggALAiysQw4oEJQ4AAAAAElFTkSuQmCC';

fs.mkdirSync(outDir, { recursive: true });
const uploadPath = path.join(outDir, 'all-feature-upload.png');
fs.writeFileSync(uploadPath, Buffer.from(fixturePng, 'base64'));

const skippedToolIds = new Set(['video-workstation', 'video-detail']);
const catalog = readLightchainCatalog();
const localPreview = isLocalPreview(baseUrl);
const evidence = {
  workflow: 'lightchain-all-feature-workflows',
  capturedAt: new Date().toISOString(),
  baseUrl,
  authState: localPreview ? 'local-proof-jwt' : authStatePath,
  outDir,
  featureCount: catalog.tools.length,
  uploadPath,
  screenshots: {},
  featureResults: [],
  assertions: [],
  consoleMessages: [],
  pageErrors: [],
  requestFailures: [],
  cleanup: {
    contextClosed: false,
    browserClosed: false,
    previewStopped: false,
  },
};

let previewProcess = null;
let browser = null;
let context = null;

try {
  if (localPreview) previewProcess = await startPreviewServer(baseUrl);
  if (!localPreview && !fs.existsSync(authStatePath)) throw new Error(`auth_state_missing:${authStatePath}`);
  addAssertion('feature_catalog_loaded', catalog.tools.length >= 30, {
    count: catalog.tools.length,
    skippedToolIds: [...skippedToolIds],
    skippedCount: skippedToolIds.size,
  });

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext(localPreview
    ? { viewport: desktopViewport }
    : {
      storageState: buildStorageStateForBaseUrl(authStatePath, baseUrl),
      viewport: desktopViewport,
    });
  if (localPreview) await installLocalProofAuth(context);

  let page = await context.newPage();
  page.setDefaultNavigationTimeout(15_000);
  page.setDefaultTimeout(15_000);
  wirePageDiagnostics(page, 'desktop');

  await page.goto(`${baseUrl}/lightchain`, { waitUntil: 'networkidle' });
  await dismissBlockingOverlays(page);
  await screenshot(page, 'desktop-index');
  await verifyGenerateEntrypointUsesFeatureDetail(page);
  await page.close();
  for (const tool of catalog.tools) {
    const routePage = await context.newPage();
    routePage.setDefaultNavigationTimeout(15_000);
    routePage.setDefaultTimeout(15_000);
    wirePageDiagnostics(routePage, `desktop:${tool.id}`);
    const result = await verifyFeatureWorkflow(routePage, tool);
    evidence.featureResults.push(result);
    await routePage.close();
  }
  await context.close();
  evidence.cleanup.contextClosed = true;
  context = null;
  await browser.close();
  evidence.cleanup.browserClosed = true;
  browser = null;

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext(localPreview
    ? { viewport: mobileViewport }
    : {
      storageState: buildStorageStateForBaseUrl(authStatePath, baseUrl),
      viewport: mobileViewport,
    });
  if (localPreview) await installLocalProofAuth(context);
  const mobilePage = await context.newPage();
  mobilePage.setDefaultNavigationTimeout(15_000);
  mobilePage.setDefaultTimeout(15_000);
  wirePageDiagnostics(mobilePage, 'mobile');
  await mobilePage.setViewportSize(mobileViewport);
  await mobilePage.goto(`${baseUrl}/lightchain`, { waitUntil: 'networkidle' });
  await screenshot(mobilePage, 'mobile-index');
  await mobilePage.close();
  for (const tool of catalog.tools) {
    const routePage = await context.newPage();
    routePage.setDefaultNavigationTimeout(15_000);
    routePage.setDefaultTimeout(15_000);
    wirePageDiagnostics(routePage, `mobile:${tool.id}`);
    await routePage.setViewportSize(mobileViewport);
    await verifyMobileFeatureScreen(routePage, tool);
    await routePage.close();
  }

  const invalidPage = await context.newPage();
  invalidPage.setDefaultNavigationTimeout(15_000);
  invalidPage.setDefaultTimeout(15_000);
  wirePageDiagnostics(invalidPage, 'mobile:invalid');
  await invalidPage.setViewportSize(mobileViewport);
  await invalidPage.goto(`${baseUrl}/lightchain/not-a-real-feature`, { waitUntil: 'networkidle' });
  await invalidPage.waitForURL(/\/lightchain$/, { timeout: 10_000 });
  addAssertion('invalid_feature_redirects_to_index', invalidPage.url().endsWith('/lightchain'), { url: invalidPage.url() });
  await invalidPage.close();
} catch (error) {
  evidence.exactBlocker = error.message;
  addAssertion('route_exception_free', false, { error: error.message });
} finally {
  if (context) {
    await withTimeout(context.close(), 10000).then(() => {
      evidence.cleanup.contextClosed = true;
    }).catch((error) => {
      evidence.cleanup.contextCloseBlocker = error.message;
    });
  }
  if (browser) {
    await withTimeout(browser.close(), 60000).then(() => {
      evidence.cleanup.browserClosed = true;
    }).catch((error) => {
      evidence.cleanup.browserCloseBlocker = error.message;
    });
  }
  if (previewProcess) {
    await stopPreviewServer(previewProcess).then(() => {
      evidence.cleanup.previewStopped = true;
    }).catch((error) => {
      evidence.cleanup.previewStopBlocker = error.message;
    });
  } else if (!localPreview) {
    evidence.cleanup.previewStopped = true;
  }
}

const diagnosticFailures = [
  ...evidence.consoleMessages.map((message) => `console_${message.type}:${message.text}`),
  ...evidence.pageErrors.map((message) => `page_error:${message}`),
  ...evidence.requestFailures.map((failure) => `request_failed:${failure.url}:${failure.failure}`),
];
if (!evidence.cleanup.contextClosed) diagnosticFailures.push(`context_cleanup:${evidence.cleanup.contextCloseBlocker ?? 'not_closed'}`);
if (!evidence.cleanup.browserClosed) diagnosticFailures.push(`browser_cleanup:${evidence.cleanup.browserCloseBlocker ?? 'not_closed'}`);
if (!evidence.cleanup.previewStopped) diagnosticFailures.push('preview_cleanup:not_stopped');
for (const failure of diagnosticFailures) addAssertion(failure, false);

evidence.ok = evidence.assertions.every((assertion) => assertion.ok);
evidence.failed = evidence.assertions.filter((assertion) => !assertion.ok).map((assertion) => assertion.id);
fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({
  ok: evidence.ok,
  failed: evidence.failed,
  featureCount: catalog.tools.length,
  summaryPath: path.join(outDir, 'SUMMARY.json'),
}, null, 2));
process.exit(evidence.ok ? 0 : 1);

async function verifyFeatureWorkflow(page, tool) {
  const result = { id: tool.id, category: tool.category, title: tool.title, assertions: [] };
  await page.goto(`${baseUrl}/lightchain/${tool.id}`, { waitUntil: 'networkidle' });
  await page.evaluate((key) => window.localStorage.removeItem(key), canvasStoreKey);
  await waitForSettledRoute(page, tool.id);
  const body = await bodyText(page);
  recordFeatureAssertion(result, 'route_loaded_without_login', !page.url().includes('/login') && !body.includes('ログイン'), {
    url: page.url(),
    bodyExcerpt: body.slice(0, 600),
  });
  recordFeatureAssertion(result, 'heavy_shell_or_lightchain_reference_visible', body.includes('HEAVY CHAIN') || body.includes('HEAVYCHAIN'), {
    bodyExcerpt: body.slice(0, 300),
  });
  recordFeatureAssertion(result, 'lightchain_screen_signature_visible', matchesLightchainSignature(tool, body), {
    expectedTitle: tool.title,
    bodyExcerpt: body.slice(0, 900),
  });
  await verifyVisibleTabInteractions(page, tool, result);
  await verifyAllVisibleTabsRespond(page, tool, result);
  await verifyToolSpecificChoiceControls(page, tool, result);
  await verifyVisibleRangeControlsRespond(page, tool, result);

  const generateButton = page.getByRole('button', { name: /AI生成|更新|保存|開始/ }).first();
  const hasSafeLocalAction = await generateButton.isVisible({ timeout: 1000 }).catch(() => false);
  recordFeatureAssertion(result, 'safe_local_action_or_workspace_visible', hasSafeLocalAction || isReadOnlyWorkspaceTool(tool.id), {
    hasSafeLocalAction,
    toolId: tool.id,
  });

  await screenshot(page, `desktop-${tool.id}`);
  return result;
}

async function verifyVisibleTabInteractions(page, tool, result) {
  const tabChecks = {
    'fashion-studio': [
      { tab: 'コーディネート', expected: 'コーディネート履歴', promptValue: 'ボトムス、靴、バッグ', helper: '服と小物、靴、バッグを合わせたコーディネート案を作ります。', example: 'ワイドデニム、シルバースニーカー', placeholder: '黒のチェーン柄フーディーに合わせるボトムス、靴、バッグ、小物の方向性を入力してください。' },
      { tab: '360度表示', expected: '360度表示履歴', promptValue: '360度表示で見せたい角度', helper: '正面、背面、横、ディテールなど多角度の見せ方を作ります。', example: '正面、左斜め、背面', placeholder: '360度表示で見せたい角度、ディテール、背景、回転順を入力してください。' },
      { tab: 'スタジオ案', expected: 'スタジオ案履歴', promptValue: 'モデル、背景、小物', helper: '商品、モデル、背景、小物を組み合わせた撮影案を作ります。', example: '平置き商品画像', placeholder: '黒のチェーン柄フーディーを、モデル、背景、小物と組み合わせてEC/SNS向けの撮影案にしてください。' },
    ],
    'design-agent': [
      { tab: 'インスピレーション', expected: 'インスピレーション履歴', promptValue: '素材感、色、シルエット', helper: 'ムード、素材、色、シルエットの参照を集めるモードです。', example: 'メタリック素材', placeholder: '参考ブランド、年代、素材感、色、シルエットを入力してください。' },
      { tab: 'AIグラフィックデザイン', expected: 'グラフィック履歴', promptValue: '柄、配置、色数', helper: '企画からプリント、柄、配置案へ展開するモードです。', example: 'チェーンモチーフ', placeholder: '服に入れたいグラフィック、柄、配置、色数を入力してください。' },
      { tab: '企画案', expected: '企画履歴', promptValue: 'LOUIS VUITTON', helper: 'ブランド情報と参考コレクションから、企画書の構成案を作ります。', example: 'ZIMMERMANN', placeholder: 'LOUIS VUITTON の 2026年春夏 コレクションからインスピレーションを得て、ショートジャケット、シャツ、ロングパンツ、ショートパンツで構成するメンズ デザイン企画書を作成する。' },
    ],
  }[tool.id] ?? [];

  for (const check of tabChecks) {
    const tabButton = page.getByRole('tab', { name: exactText(check.tab) });
    await tabButton.click();
    await page.waitForTimeout(100);
    const body = await bodyText(page);
    const textareaValue = await page.locator('textarea').first().inputValue().catch(() => '');
    const ariaSelected = await tabButton.getAttribute('aria-selected').catch(() => null);
    const placeholder = await page.locator('textarea').first().getAttribute('placeholder').catch(() => null);
    recordFeatureAssertion(result, `tab_click_updates_state:${check.tab}`, ariaSelected === 'true' && body.includes(check.expected) && body.includes(check.helper) && body.includes(check.example) && textareaValue.includes(check.promptValue) && placeholder === check.placeholder, {
      expected: check.expected,
      ariaSelected,
      helper: check.helper,
      example: check.example,
      placeholder,
      expectedPlaceholder: check.placeholder,
      promptValue: check.promptValue,
      textareaValue,
      bodyExcerpt: body.slice(0, 700),
    });
  }

  if (['ai-fitting', 'ai-fitting-reference', 'fitting-clothing-reference', 'fitting-background-reference'].includes(tool.id)) {
    const fittingChecks = [
      {
        tab: 'マルチタスク',
        expected: '複数コーディネートを同時に管理',
        headline: '複数のコーディネートのアップロードに対応',
      },
      {
        tab: 'シングルタスク',
        expected: '1つの衣服画像から最短',
        headline: '1つの衣服画像から着用画像を作成',
      },
      {
        tab: '参考画像',
        expected: '参考画像',
        placeholder: '参考画像で残したい雰囲気や衣服の条件を記入してください',
        helper: '衣服と一緒に使う参考画像の条件を指定します。',
      },
      {
        tab: 'モデルのセット写真',
        expected: 'モデルのセット写真',
        placeholder: 'モデルセット写真で合わせたいポーズ、背景、小物を記入してください',
        helper: 'モデルのセット写真に合わせた条件を指定します。',
      },
      {
        tab: '説明生成',
        expected: '説明生成',
        placeholder: '背景の説明をここに記入してください',
        helper: 'ここをクリック/ドラッグしてアイテムを追加します。',
      },
    ];
    for (const check of fittingChecks) {
      const tabButton = page.getByRole('tab', { name: exactText(check.tab) }).first();
      await tabButton.click();
      await page.waitForTimeout(100);
      const body = await bodyText(page);
      const ariaSelected = await tabButton.getAttribute('aria-selected').catch(() => null);
      const placeholder = await page.locator('textarea').first().getAttribute('placeholder').catch(() => null);
      const placeholderOk = !check.placeholder || placeholder === check.placeholder;
      const headlineOk = !check.headline || body.includes(check.headline);
      const helperOk = !check.helper || body.includes(check.helper);
      recordFeatureAssertion(result, `fitting_tab_click_updates_state:${check.tab}`, ariaSelected === 'true' && body.includes(check.expected) && placeholderOk && headlineOk && helperOk, {
        expected: check.expected,
        ariaSelected,
        placeholder,
        expectedPlaceholder: check.placeholder ?? null,
        expectedHeadline: check.headline ?? null,
        expectedHelper: check.helper ?? null,
        bodyExcerpt: body.slice(0, 700),
      });
    }
  }
}

async function verifyAllVisibleTabsRespond(page, tool, result) {
  const tabs = await page.locator('[role="tab"]').evaluateAll((nodes) => nodes.map((node, index) => ({
    index,
    tablistIndex: Array.from(document.querySelectorAll('[role="tablist"]')).findIndex((tablist) => tablist.contains(node)),
    indexInTablist: node.closest('[role="tablist"]')
      ? Array.from(node.closest('[role="tablist"]').querySelectorAll('[role="tab"]')).indexOf(node)
      : index,
    text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    selected: node.getAttribute('aria-selected'),
  })).filter((item) => item.text));
  recordFeatureAssertion(result, 'visible_tabs_have_click_targets', tabs.length > 0 || !expectsInteractiveTabs(tool.id), {
    tabCount: tabs.length,
    tabs,
  });
  for (const tab of tabs) {
    const tabButton = tab.tablistIndex >= 0
      ? page.locator('[role="tablist"]').nth(tab.tablistIndex).locator('[role="tab"]').nth(tab.indexInTablist)
      : page.locator('[role="tab"]').nth(tab.index);
    if (tab.selected === 'true' && tabs.length > 1) {
      const alternate = tabs.find((candidate) => candidate.tablistIndex === tab.tablistIndex && candidate.index !== tab.index);
      if (alternate) {
        const alternateButton = alternate.tablistIndex >= 0
          ? page.locator('[role="tablist"]').nth(alternate.tablistIndex).locator('[role="tab"]').nth(alternate.indexInTablist)
          : page.locator('[role="tab"]').nth(alternate.index);
        await alternateButton.click();
        await page.waitForTimeout(150);
      }
    }
    const before = await interactionSnapshot(page);
    await tabButton.click();
    await page.waitForTimeout(150);
    const after = await interactionSnapshot(page);
    const ariaSelected = await tabButton.getAttribute('aria-selected').catch(() => null);
    const selectedOk = ariaSelected === 'true';
    const changedOk = before.fingerprint !== after.fingerprint;
    recordFeatureAssertion(result, `visible_tab_responds:${tab.index}:${tab.text}`, selectedOk && changedOk, {
      text: tab.text,
      selectedBefore: tab.selected,
      ariaSelected,
      before,
      after,
    });
  }
}

async function verifyToolSpecificChoiceControls(page, tool, result) {
  const checksByTool = {
    'printing-image': [
      { name: 'print_mode_overall', button: '全体', expectBody: '全体', expectSelectedClass: 'bg-[#737d84]' },
      { name: 'print_mode_spot', button: 'スポット', expectBody: 'スポット', expectSelectedClass: 'bg-[#737d84]' },
    ],
    'line-to-real': [
      { name: 'line_draft_monochrome', button: 'モノクロ線画', expectBody: 'モノクロ線画', expectSelectedClass: 'bg-[#737d84]' },
      { name: 'line_draft_color', button: 'カラー線画', expectBody: 'カラー線画', expectSelectedClass: 'bg-[#737d84]' },
    ],
    'line-generation': [
      { name: 'flat_image_type_model', button: 'モデル図', expectBody: 'モデル図', expectSelectedClass: 'bg-[#737d84]' },
      { name: 'flat_image_type_flatlay', button: '平置き画像', expectBody: '平置き画像', expectSelectedClass: 'bg-[#737d84]' },
    ],
    'image-repair': [
      { name: 'repair_mask_tool', button: 'マスクツール', expectBody: 'マスクツール」を使用して手足の部分をマスクで選択してください', expectSelectedClass: 'bg-[#737d84]' },
      { name: 'repair_deformation', button: '手足の変形を修正', expectBody: '手足の変形を修正', expectSelectedClass: 'bg-[#737d84]' },
    ],
    'pattern-vector': [
      { name: 'pattern_vector_split', button: '分割', expectBody: '分割', expectSelectedClass: 'bg-[#737d84]' },
    ],
    'pattern-vector-pro': [
      { name: 'pattern_vector_pro_split', button: '分割', expectBody: '分割', expectSelectedClass: 'bg-[#737d84]' },
    ],
    'model-change': [
      { name: 'model_change_keep_size_toggle', button: 'サイズを維持する', expectBody: 'サイズを維持する', expectStateChange: true },
    ],
    'pose-change': [
      { name: 'pose_mode_custom', button: 'カスタム', expectBody: 'カスタム', expectSelectedClass: 'bg-[#747e85]' },
    ],
    'background-change': [
      { name: 'background_mode_custom', button: 'カスタム', expectBody: 'カスタム', expectSelectedClass: 'bg-[#747e85]' },
    ],
    'body-shape': [
      { name: 'body_gender_women', button: '女性', expectBody: '女性', expectSelectedClass: 'bg-[#747e85]' },
      { name: 'body_type_toggle', button: '体型', expectBody: '体型', expectStateChange: true },
      { name: 'body_custom_toggle', button: 'カスタムボディ', expectBody: 'カスタムボディ', expectStateChange: true },
    ],
    'clothing-size': [
      { name: 'garment_type_full', button: '全身', expectBody: '全身', expectSelectedClass: 'bg-[#747e85]' },
      { name: 'source_size_toggle', button: '元のサイズ', expectBody: '元のサイズ', expectStateChange: true },
      { name: 'target_size_toggle', button: '変更サイズ', expectBody: '変更サイズ', expectStateChange: true },
    ],
    'angle-change': [
      { name: 'back_view_toggle', button: '背面', expectBody: '背面', expectStateChange: true },
    ],
    'model-custom': [
      { name: 'custom_mode_custom', button: 'カスタム', expectBody: 'カスタム', expectSelectedClass: 'bg-[#747e85]' },
      { name: 'custom_gender_women', button: '女性', expectBody: '女性', expectSelectedClass: 'bg-[#747e85]' },
      { name: 'custom_age_toggle', button: '年齢', expectBody: '年齢', expectStateChange: true },
      { name: 'custom_nationality_toggle', button: '国籍', expectBody: '国籍', expectStateChange: true },
      { name: 'custom_skin_tone_toggle', button: '肌の色', expectBody: '肌の色', expectStateChange: true },
      { name: 'custom_body_type_toggle', button: '体型', expectBody: '体型', expectStateChange: true },
      { name: 'custom_half_toggle', button: 'ハーフ', expectBody: 'ハーフ', expectStateChange: true },
    ],
  };
  const checks = checksByTool[tool.id] ?? [];
  for (const check of checks) {
    const button = await buttonByText(page, check.button);
    const visible = await button.isVisible({ timeout: 1000 }).catch(() => false);
    const before = await interactionSnapshot(page);
    const classNameBefore = visible ? await button.getAttribute('class').catch(() => '') : '';
    if (visible) await button.click();
    await page.waitForTimeout(150);
    const after = await interactionSnapshot(page);
    const className = visible ? await button.getAttribute('class').catch(() => '') : '';
    const selectedOk = check.expectSelectedClass ? className?.includes(check.expectSelectedClass) : true;
    const wasAlreadySelected = check.expectSelectedClass ? classNameBefore?.includes(check.expectSelectedClass) : false;
    const changedOk = check.expectStateChange || !wasAlreadySelected ? before.fingerprint !== after.fingerprint : true;
    const bodyOk = !check.expectBody || after.body.includes(check.expectBody);
    recordFeatureAssertion(result, `choice_control_responds:${check.name}`, visible && selectedOk && changedOk && bodyOk, {
      button: check.button,
      visible,
      classNameBefore,
      className,
      expectSelectedClass: check.expectSelectedClass ?? null,
      expectStateChange: Boolean(check.expectStateChange),
      before,
      after,
    });
  }
  await verifyToolSpecificRangeControls(page, tool, result);
}

async function verifyToolSpecificRangeControls(page, tool, result) {
  const rangeChecksByTool = {
    'angle-change': [
      { name: 'angle_horizontal', label: '左視⇔右視', value: '82' },
      { name: 'angle_vertical', label: '見上げる⇔見下ろす', value: '18' },
      { name: 'angle_zoom', label: 'ズームイン⇔ズームアウト', value: '76' },
    ],
  };
  const checks = rangeChecksByTool[tool.id] ?? [];
  for (const check of checks) {
    const range = page.getByRole('slider', { name: exactText(check.label) }).first();
    const visible = await range.isVisible({ timeout: 1000 }).catch(() => false);
    const before = await interactionSnapshot(page);
    if (visible) {
      await range.fill(check.value);
      await range.dispatchEvent('change');
    }
    await page.waitForTimeout(150);
    const after = await interactionSnapshot(page);
    const value = visible ? await range.inputValue().catch(() => '') : '';
    recordFeatureAssertion(result, `range_control_responds:${check.name}`, visible && value === check.value && before.fingerprint !== after.fingerprint, {
      label: check.label,
      visible,
      expectedValue: check.value,
      value,
      before,
      after,
    });
  }
}

async function verifyVisibleRangeControlsRespond(page, tool, result) {
  const ranges = await page.locator('input[type="range"]:visible').evaluateAll((nodes) => nodes.map((node, index) => ({
    index,
    label: node.getAttribute('aria-label') || node.closest('label')?.innerText?.replace(/\s+/g, ' ').trim() || `range-${index}`,
    value: node.value,
    min: node.getAttribute('min') ?? '0',
    max: node.getAttribute('max') ?? '100',
  })));
  for (const rangeInfo of ranges) {
    const range = page.locator('input[type="range"]:visible').nth(rangeInfo.index);
    const min = Number(rangeInfo.min);
    const max = Number(rangeInfo.max);
    const current = Number(rangeInfo.value);
    const next = Number.isFinite(min) && Number.isFinite(max) && max > min
      ? String(current === max ? min : max)
      : '75';
    const before = await interactionSnapshot(page);
    await range.fill(next);
    await range.dispatchEvent('change');
    await page.waitForTimeout(150);
    const after = await interactionSnapshot(page);
    const value = await range.inputValue().catch(() => '');
    recordFeatureAssertion(result, `visible_range_control_responds:${rangeInfo.index}:${rangeInfo.label}`, value === next && before.fingerprint !== after.fingerprint, {
      label: rangeInfo.label,
      beforeValue: rangeInfo.value,
      expectedValue: next,
      value,
      before,
      after,
    });
  }
}

async function interactionSnapshot(page) {
  return page.evaluate(() => {
    const textareas = Array.from(document.querySelectorAll('textarea')).map((node) => ({
      value: node.value,
      placeholder: node.getAttribute('placeholder') ?? '',
    }));
    const inputs = Array.from(document.querySelectorAll('input')).map((node) => ({
      type: node.getAttribute('type') ?? '',
      label: node.getAttribute('aria-label') ?? '',
      value: node.value,
      checked: node.checked,
    })).filter((item) => item.type !== 'file');
    const selectedTabs = Array.from(document.querySelectorAll('[role="tab"]')).map((node) => ({
      text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      selected: node.getAttribute('aria-selected') ?? '',
      className: node.getAttribute('class') ?? '',
    }));
    const highlightedButtons = Array.from(document.querySelectorAll('button')).map((node) => ({
      text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      className: node.getAttribute('class') ?? '',
      ariaPressed: node.getAttribute('aria-pressed') ?? '',
      childClasses: Array.from(node.querySelectorAll('*')).map((child) => child.getAttribute('class') ?? '').filter(Boolean),
    })).filter((item) => item.className.includes('bg-[#737d84]') || item.className.includes('bg-[#747e85]') || item.className.includes('bg-[#65d3cf]') || item.ariaPressed === 'true');
    const body = document.body.innerText.replace(/\s+/g, ' ').trim();
    const fingerprint = JSON.stringify({
      body: body.slice(0, 10000),
      textareas,
      inputs,
      selectedTabs,
      highlightedButtons,
    });
    return {
      body: body.slice(0, 900),
      textareas,
      inputs,
      selectedTabs,
      highlightedButtons,
      fingerprint,
    };
  });
}

function expectsInteractiveTabs(toolId) {
  return [
    'fashion-studio',
    'design-agent',
    'ai-fitting',
    'ai-fitting-reference',
    'fitting-clothing-reference',
    'fitting-background-reference',
  ].includes(toolId);
}

async function buttonByText(page, text) {
  const panelButton = page
    .locator('[data-testid="lightchain-model-panel"], [data-testid="lightchain-fitting-input-flow"]')
    .getByRole('button', { name: exactText(text) })
    .or(page.locator('[data-testid="lightchain-model-panel"] button, [data-testid="lightchain-fitting-input-flow"] button').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(text)}`) }))
    .first();
  if (await panelButton.isVisible({ timeout: 300 }).catch(() => false)) return panelButton;
  return page
    .getByRole('button', { name: exactText(text) })
    .or(page.locator('button').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(text)}`) }))
    .first();
}

async function verifyGenerateEntrypointUsesFeatureDetail(page) {
  const generateCategoryIds = ['recommended', 'planning', 'fitting', 'graphics'];
  const featureLinkEntries = [];
  for (const categoryId of generateCategoryIds) {
    await page.goto(`${baseUrl}/generate?category=${categoryId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.trim().length > 0, null, { timeout: 10_000 });
    await dismissBlockingOverlays(page);
    await page.locator('[data-testid="lightchain-tool-card"]').first().waitFor({ state: 'visible', timeout: 10_000 });
    const linksForCategory = await page
      .locator('a[href]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')).filter(Boolean));
    featureLinkEntries.push(...linksForCategory.map((href) => ({ categoryId, href })));
  }
  const skippedVideoHrefs = featureLinkEntries
    .map((entry) => entry.href)
    .filter((href) => isVideoHref(href));
  const uniqueFeatureLinkEntries = [...new Map(
    featureLinkEntries
      .filter(({ href }) => isFeatureEntrypointHref(href) && !isVideoHref(href))
      .map((entry) => [entry.href, entry]),
  ).values()];
  const clickableFeatureDetailEntries = uniqueFeatureLinkEntries
    .filter((entry) => entry.href.startsWith('/lightchain/') || entry.href.startsWith('/generate?feature='))
    .slice(0, 3);
  addAssertion('generate_entrypoint_has_direct_feature_links', clickableFeatureDetailEntries.length >= 3, {
    count: clickableFeatureDetailEntries.length,
    featureLinks: clickableFeatureDetailEntries.map((entry) => entry.href),
    allEntrypointLinks: uniqueFeatureLinkEntries.map((entry) => entry.href),
    skippedVideoHrefs,
  });
  for (const { categoryId, href } of clickableFeatureDetailEntries) {
    await page.goto(`${baseUrl}/generate?category=${categoryId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.trim().length > 0, null, { timeout: 10_000 });
    await dismissBlockingOverlays(page);
    await page.locator('[data-testid="lightchain-tool-card"]').first().waitFor({ state: 'visible', timeout: 10_000 });
    const link = page.locator(`a[href="${href}"]`).first();
    const visible = await link.isVisible({ timeout: 1500 }).catch(() => false);
    if (visible) {
      await link.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await waitForDirectFeatureDestination(page, href);
    }
    const targetBody = await bodyText(page);
    addAssertion(`generate_entrypoint_click:${href}`, visible && urlMatchesHref(page.url(), href) && directFeatureDestinationLoaded(href, targetBody), {
      url: page.url(),
      bodyExcerpt: targetBody.slice(0, 500),
    });
  }
  await page.goto(`${baseUrl}/lightchain`, { waitUntil: 'networkidle' });
}

async function verifyMobileFeatureScreen(page, tool) {
  await page.goto(`${baseUrl}/lightchain/${tool.id}`, { waitUntil: 'networkidle' });
  await waitForSettledRoute(page, tool.id);
  const body = await bodyText(page);
  addAssertion(`mobile_screen:${tool.id}`, (
    !page.url().includes('/login')
    && !body.includes('ログイン')
    && matchesLightchainSignature(tool, body)
  ), {
    url: page.url(),
    bodyExcerpt: body.slice(0, 600),
  });
}

function recordFeatureAssertion(result, name, ok, details = {}) {
  const id = `${result.id}:${name}`;
  result.assertions.push({ id, ok: Boolean(ok), details });
  addAssertion(id, ok, details);
}

async function uploadMaterialAndWaitForMaskControls(page, filePath) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.locator('input[type="file"]').first().setInputFiles(filePath);
    await page.waitForTimeout(500);
    const ready = await page.getByRole('button', { name: 'AIマスク認識' }).first().isEnabled({ timeout: 3000 }).catch(() => false);
    if (ready) return;
  }
  throw new Error('material_upload_did_not_enable_mask_controls');
}

async function selectLastPlacement(page) {
  await openDetails(page, 'レイヤー詳細');
  const select = page.locator('select').first();
  if (!(await select.isVisible({ timeout: 1000 }).catch(() => false))) throw new Error('placement_select_missing_after_opening_layer_details');
  const labels = await select.locator('option').evaluateAll((options) => options.map((option) => option.textContent || '').filter(Boolean));
  if (labels.length === 0) throw new Error('placement_options_missing');
  const expectedPlacement = labels[labels.length - 1];
  await select.selectOption({ label: expectedPlacement });
  return expectedPlacement;
}

async function selectMaskCandidate(page, candidate) {
  const panel = page
    .getByText('保存したい範囲を選択してください')
    .first()
    .locator('xpath=ancestor::div[contains(@class, "rounded-lg")][1]');
  await panel.getByRole('button', { name: exactText(candidate) }).click();
}

function firstLayerLabelForCategory(category) {
  return catalog.categoryLayerLabels[category]?.[0] ?? '素材ベース';
}

function isReadOnlyWorkspaceTool(toolId) {
  return ['marketing-home', 'design-agent', 'lab', 'fashion-studio', 'print-design-project', 'wear-design-lab', 'custom-style'].includes(toolId);
}

function matchesLightchainSignature(tool, body) {
  if (tool.id === 'fashion-studio') return body.includes('ファッションスタジオ') && body.includes('スタジオ案履歴') && body.includes('360度表示');
  if (tool.id === 'marketing-home') return body.includes('マーケティングワークスペース') && body.includes('おすすめのシーン');
  if (tool.id === 'design-agent') return body.includes('Hello') && body.includes('企画案') && body.includes('AIグラフィックデザイン');
  if (tool.id === 'lab') return body.includes('Heavy Chain Lab') && body.includes('参考事例');
  if (tool.id === 'wear-design-lab') return body.includes('新規ファイル') && body.includes('参考事例');
  if (tool.id === 'wear-design-detail') return body.includes('ガイドを見る') && body.includes('ガイドを表示しない');
  if (tool.id === 'print-design-project') return body.includes('柄・グラフィック') && body.includes('新規ファイル');
  if (tool.id === 'print-design-detail') return body.includes('ガイドを見る') && body.includes('ガイドを表示しない');
  if (tool.id === 'custom-style') return body.includes('カスタムスタイル') && body.includes('ラーニング素材');
  if (tool.id === 'marketing-detail') return body.includes('マーケティングワークスペース') && body.includes('AIアシスタント');
  if (['ai-fitting', 'ai-fitting-reference', 'fitting-clothing-reference', 'fitting-background-reference'].includes(tool.id)) {
    return body.includes('AIフィッティング') && body.includes('AI生成') && body.includes('生成履歴');
  }
  if (tool.id === 'model-library') return body.includes('モデルカスタマイズ') && body.includes('ラベル') && body.includes('性別');
  if (['model-face', 'model-change', 'body-shape', 'clothing-size', 'pose-change', 'background-change', 'angle-change', 'model-custom'].includes(tool.id)) {
    return body.includes(tool.title) && body.includes('AI生成') && body.includes('生成履歴');
  }
  if (tool.id === 'pattern-vector-pro') {
    return body.includes('パターンをベクター画像に変換（プロフェッショナル版）') && body.includes('AI生成') && body.includes('生成履歴');
  }
  if (['fabric-image', 'printing-image', 'line-generation', 'line-to-real', 'pattern-vector', 'image-repair', 'svg-convert'].includes(tool.id)) {
    return body.includes(tool.title) && body.includes('AI生成') && body.includes('生成履歴');
  }
  return body.includes(tool.title);
}

function isDirectFeatureHref(href) {
  if (!href || href.startsWith('/lightchain/')) return false;
  return [
    '/generate',
    '/marketing',
    '/fitting',
    '/lab',
    '/video',
    '/models',
    '/studio',
    '/patterns',
    '/brand/settings',
    '/canvas',
    '/workflows',
  ].some((prefix) => href === prefix || href.startsWith(`${prefix}/`) || href.startsWith(`${prefix}?`));
}

function isFeatureEntrypointHref(href) {
  return href?.startsWith('/lightchain/') || isDirectFeatureHref(href);
}

function isVideoHref(href) {
  return href === '/video' || href.startsWith('/video/') || href.startsWith('/video?');
}

function urlMatchesHref(url, href) {
  const parsed = new URL(url);
  const actual = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return actual === href || actual.startsWith(href);
}

function directFeatureDestinationLoaded(href, body) {
  if (href.startsWith('/generate?feature=')) {
    const params = new URLSearchParams(href.split('?')[1] || '');
    const lcTitle = params.get('lcTitle');
    return body.includes('生成') && (!lcTitle || body.includes(lcTitle) || body.includes('制作条件'));
  }
  if (href.startsWith('/lightchain/')) {
    const toolId = href.split('/').pop();
    const tool = catalog.tools.find((item) => item.id === toolId);
    return tool ? matchesLightchainSignature(tool, body) : body.trim().length > 0 && !body.includes('ログイン');
  }
  if (href.startsWith('/generate?category=')) return body.includes('HEAVY CHAIN AI') || body.includes('おすすめ');
  if (href === '/canvas/new') return body.includes('プロパティ') || body.includes('キャンバス');
  if (href.startsWith('/workflows/')) return body.includes('ワークフロー') || body.includes('生成');
  return body.trim().length > 0 && !body.includes('ログイン');
}

async function waitForDirectFeatureDestination(page, href) {
  if (href === '/canvas/new') {
    await page.getByText('画像を置いて、機能を選ぶ').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
    return;
  }
  if (href === '/fitting' || href.startsWith('/fitting#')) {
    await page.getByText(/高精度AI(で)?切り抜き?/).first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
    return;
  }
  if (href.startsWith('/generate?feature=')) {
    await page.getByText('生成').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
  }
}

async function openDetails(page, summaryText) {
  const summary = page.locator('summary').filter({ hasText: summaryText }).first();
  if (await summary.isVisible({ timeout: 1000 }).catch(() => false)) {
    const isOpen = await summary.evaluate((node) => node.parentElement?.hasAttribute('open') ?? false);
    if (!isOpen) await summary.click();
  }
}

async function screenshot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, timeout: 30_000 });
  evidence.screenshots[name] = file;
}

function addAssertion(id, ok, details = {}) {
  evidence.assertions.push({ id, ok: Boolean(ok), details });
}

function wirePageDiagnostics(page, route) {
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      if (localPreview && /Failed to load resource: the server responded with a status of 401/.test(message.text())) return;
      if (/Failed to fetch Runway MCP (approval|subscription)/.test(message.text())) return;
      if (/Remote workspace artifact save failed; falling back to localStorage/.test(message.text())) return;
      if (/Falling back to table usage summary/.test(message.text())) return;
      evidence.consoleMessages.push({ route, type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => evidence.pageErrors.push({ route, message: error.message }));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown';
    if (failure === 'net::ERR_ABORTED') return;
    evidence.requestFailures.push({
      route,
      url: request.url(),
      failure,
    });
  });
}

async function dismissBlockingOverlays(page) {
  await page.keyboard.press('Escape').catch(() => {});
  for (const text of ['スキップ', '閉じる', 'あとで', '完了', 'OK']) {
    const button = page.getByRole('button', { name: text }).first();
    if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
      await button.click().catch(() => {});
      await page.waitForTimeout(250);
    }
  }
}

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
}

async function waitForSettledRoute(page, toolId) {
  await page.waitForFunction((currentToolId) => {
    const text = document.body.innerText.trim();
    if (currentToolId === 'fashion-studio' && text.includes('ファッションスタジオ') && text.includes('生成履歴')) return true;
    if (['ai-fitting', 'ai-fitting-reference', 'fitting-clothing-reference', 'fitting-background-reference'].includes(currentToolId)) {
      return text.includes('AIフィッティング') && text.includes('シングルタスク') && text.includes('生成履歴') && !text.includes('素材作業台を準備しています') && !text.includes('ログイン');
    }
    return text.length > 0
      && !text.includes('MATERIAL WORKBENCH')
      && !text.includes('素材作業台を準備しています');
  }, toolId, { timeout: 20_000 });
}

function readLightchainCatalog() {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/pages/LightchainWorkbenchPage.tsx'), 'utf8');
  const toolsBlock = source.match(/const tools: CompatTool\[] = \[([\s\S]+?)\];\n\nconst statusLabel/);
  const categoryBlock = source.match(/const categoryWorkbenchLabels:[\s\S]+?= \{([\s\S]+?)\n\};\n\nconst encodeSvgDataUrl/);
  const tools = [];
  if (toolsBlock) {
    for (const match of toolsBlock[1].matchAll(/\{\s*id: '([^']+)'[\s\S]+?title: '([^']+)'[\s\S]+?category: '([^']+)'/g)) {
      if (skippedToolIds.has(match[1])) continue;
      tools.push({ id: match[1], title: match[2], category: match[3] });
    }
  }
  const categoryLayers = {};
  const categoryLayerLabels = {};
  if (categoryBlock) {
    const categories = ['home', 'marketing', 'fitting', 'planning', 'graphics', 'model', 'video', 'lab'];
    for (const category of categories) {
      const block = extractObjectBlock(categoryBlock[1], category);
      const layersLine = block?.match(/layers: \[(.+)\],/)?.[1] ?? '';
      const layerPairs = [...layersLine.matchAll(/\['([^']+)', '([^']+)'\]/g)];
      categoryLayers[category] = layerPairs.map((pair) => pair[1]);
      categoryLayerLabels[category] = layerPairs.map((pair) => pair[2]);
    }
  }
  return { tools, categoryLayers, categoryLayerLabels };
}

function extractObjectBlock(source, key) {
  const start = source.indexOf(`${key}: {`);
  if (start === -1) return null;
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  return null;
}

async function startPreviewServer(targetBaseUrl) {
  const { port } = new URL(targetBaseUrl);
  const distDir = path.join(process.cwd(), 'dist');
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', targetBaseUrl);
    const pathname = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
    const candidatePath = path.resolve(distDir, pathname);
    const safePath = candidatePath.startsWith(`${distDir}${path.sep}`) || candidatePath === distDir
      ? candidatePath
      : path.join(distDir, 'index.html');
    const filePath = fs.existsSync(safePath) && fs.statSync(safePath).isFile()
      ? safePath
      : path.join(distDir, 'index.html');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', contentTypeForPath(filePath));
    fs.readFile(filePath, (error, data) => {
      if (!error) {
        response.end(data);
        return;
      }
      const fallbackPath = path.join(distDir, 'index.html');
      response.setHeader('Content-Type', contentTypeForPath(fallbackPath));
      fs.readFile(fallbackPath, (fallbackError, fallbackData) => {
        if (fallbackError) {
          response.statusCode = 500;
          response.end(`static_server_read_error:${fallbackError.code || fallbackError.message}`);
          return;
        }
        response.end(fallbackData);
      });
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(port || '4173'), '127.0.0.1', resolve);
  });
  return server;
}

async function stopPreviewServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function contentTypeForPath(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}

async function waitForUrl(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok || response.status < 500) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`preview_server_unavailable:${url}`);
}

function buildStorageStateForBaseUrl(storageStatePath, targetBaseUrl) {
  const raw = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
  const targetOrigin = new URL(targetBaseUrl).origin;
  const origins = Array.isArray(raw.origins)
    ? raw.origins.map((origin) => ({ ...origin, origin: targetOrigin }))
    : [];
  return { ...raw, origins };
}

async function installLocalProofAuth(browserContext) {
  const supabaseUrl = readEnvValue('VITE_SUPABASE_URL');
  if (!supabaseUrl) throw new Error('local_proof_supabase_url_missing');
  const projectRef = new URL(supabaseUrl).host.split('.')[0];
  const userId = '00000000-0000-4000-8000-000000000033';
  const email = 'lightchain-all-feature-local-proof@example.test';
  const token = makeLocalJwt(userId, email);
  await browserContext.addInitScript(({ userId, email, projectRef, token }) => {
    const key = `sb-${projectRef}-auth-token`;
    window.localStorage.setItem(key, JSON.stringify({
      access_token: token,
      token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
      expires_in: 60 * 60,
      refresh_token: 'local-proof-refresh',
      user: {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email,
        user_metadata: { name: 'Local Proof User' },
        app_metadata: {},
      },
    }));
  }, { userId, email, projectRef, token });
}

function readEnvValue(name) {
  if (process.env[name]) return process.env[name];
  for (const file of ['.env.local', '.env.production.local', '.env']) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const line = text.split(/\r?\n/).filter((entry) => entry.startsWith(`${name}=`)).pop();
      if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
    } catch {
      // Try the next conventional Vite env file.
    }
  }
  return null;
}

function base64url(input) {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

function makeLocalJwt(userId, email) {
  const now = Math.floor(Date.now() / 1000);
  return [
    base64url({ alg: 'none', typ: 'JWT' }),
    base64url({
      aud: 'authenticated',
      exp: now + 60 * 60,
      iat: now,
      role: 'authenticated',
      sub: userId,
      email,
      user_metadata: { name: 'Local Proof User' },
      app_metadata: {},
    }),
    'local-proof',
  ].join('.');
}

function isLocalPreview(url) {
  const parsed = new URL(url);
  return ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
}

function trimTrailingSlash(value) {
  return value.replace(/\/$/, '');
}

function dateStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
}

function exactText(value) {
  return new RegExp(`^${escapeRegExp(value)}$`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
  ]);
}
