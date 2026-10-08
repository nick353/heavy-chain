import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

import { buildAssetAnchoredPreviewDataUrl } from '../src/features/lightchain/assetAnchoredPreview.ts';

const source = 'data:image/png;base64,AAAA';
const secondary = 'data:image/jpeg;base64,BBBB';
const workbenchSource = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');

function extractCustomStyleNodes(sourceText: string) {
  const ast = ts.createSourceFile('LightchainWorkbenchPage.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler: ts.Expression | undefined;
  let branch: ts.Statement | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleCustomStyleSave') {
      handler = node.initializer;
    }
    if (ts.isIfStatement(node) && node.expression.getText(ast) === "selectedTool.id === 'custom-style'") {
      branch = node.thenStatement;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(handler, 'actual handleCustomStyleSave initializer is missing');
  assert.ok(branch, 'actual custom-style JSX branch is missing');
  return { handler: handler.getText(ast), branch: branch.getText(ast) };
}

function compileCustomStyle(code: string) {
  return ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
}

type RenderedElement = React.ReactElement<{
  children?: React.ReactNode;
  onClick?: () => unknown;
  disabled?: boolean;
}>;

function renderedElements(element: React.ReactNode, out: RenderedElement[] = []): RenderedElement[] {
  if (Array.isArray(element)) {
    element.forEach((child) => renderedElements(child, out));
  } else if (React.isValidElement<RenderedElement['props']>(element)) {
    out.push(element);
    renderedElements(element.props.children, out);
  }
  return out;
}

function renderCustomStyle(nodes: ReturnType<typeof extractCustomStyleNodes>, tab: 'personal' | 'team', primary: boolean, locked: boolean) {
  const calls = { generation: 0, external: 0, result: 0, errors: [] as string[], success: [] as string[] };
  const icon = () => null;
  const context = createContext({
    React,
    selectedTool: { id: 'custom-style' },
    customStyleTab: tab,
    customStyleSearch: '',
    materialSlotFiles: { primary: primary ? { imageUrl: source, name: 'primary.png' } : null },
    specialProviderGenerationLocked: locked,
    toast: {
      error: (message: string) => calls.errors.push(message),
      success: (message: string) => calls.success.push(message),
    },
    handleLightchainPreviewGenerate: async () => { calls.generation++; },
    fetch: () => { calls.external++; },
    setLightchainResult: () => { calls.result++; },
    setUploadedAssetResult: () => { calls.result++; return false; },
    resumeReadbackAttributes: {},
    UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION: 'test',
    selectedFeatureWorkflow: { inputRoles: [], resultDestinations: [] },
    workflowLifecycle: 'test',
    workflowSourceInputMode: 'test',
    workflowRetryPolicy: 'test',
    workflowRightsGate: 'test',
    WandSparkles: icon,
    Palette: icon,
    ImagePlus: icon,
    Search: icon,
    X: icon,
    renderLightchainProviderGate: () => null,
    openMaterialModalForSlot: () => {},
    setCustomStyleTab: () => {},
    setCustomStyleSearch: () => {},
    lightchainResult: null,
    materialModalOpen: false,
    lightchainResultModal: null,
  });
  runInContext(compileCustomStyle(`var handleCustomStyleSave = ${nodes.handler};`), context);
  runInContext(compileCustomStyle(`function renderCustomStyle() ${nodes.branch}`), context);
  return {
    calls,
    handler: context.handleCustomStyleSave as () => unknown,
    tree: (context.renderCustomStyle as () => React.ReactNode)(),
  };
}

async function assertCustomStyleContactContract(sourceText: string) {
  const nodes = extractCustomStyleNodes(sourceText);
  let callbacks = 0;
  for (const tab of ['personal', 'team'] as const) {
    for (const primary of [false, true]) {
      for (const locked of [false, true]) {
        const caseLabel = `${tab}, primary=${primary}, providerLocked=${locked}`;
        const { calls, handler, tree } = renderCustomStyle(nodes, tab, primary, locked);
        const buttons = renderedElements(tree).filter((element) => (
          element.type === 'button' && element.props.children === 'カスタマイズについて連絡する'
        ));
        assert.equal(buttons.length, 2, `${caseLabel}: two actual contact buttons`);
        for (const button of buttons) {
          assert.equal(button.props.onClick, handler, `${caseLabel}: actual contact handler`);
          assert.ok(!button.props.disabled, `${caseLabel}: contact feedback remains enabled`);
          await button.props.onClick!();
          callbacks++;
        }
        assert.equal(calls.generation, 0, `${caseLabel}: contact must not generate a preview`);
        assert.equal(calls.external, 0, `${caseLabel}: contact must not send externally`);
        assert.equal(calls.result, 0, `${caseLabel}: contact must not create a result`);
        assert.equal(calls.success.length, 0, `${caseLabel}: contact must not claim success`);
        assert.equal(calls.errors.length, 2, `${caseLabel}: both clicks give unavailable feedback`);
        for (const message of calls.errors) {
          assert.match(message, /連絡先.*(?:未設定|設定されていない)|(?:問い合わせ|お問い合わせ|連絡|送信).*(?:利用できません|送信できません|利用不可)/);
          assert.match(message, /(?:送信|送付).*(?:行われていません|されていません|していません)|未送信/);
        }
      }
    }
  }
  assert.equal(callbacks, 16, 'eight cases exercise both contact callbacks');
}

test('asset preview embeds the exact source and secondary material', () => {
  const result = buildAssetAnchoredPreviewDataUrl({
    sourceImageUrl: source,
    secondaryImageUrl: secondary,
    title: 'プリントイメージ',
    summary: 'primary / secondary',
    mode: 'asset',
  });

  const decoded = decodeURIComponent(result.split(',', 2)[1]);
  assert.match(decoded, /data:image\/png;base64,AAAA/);
  assert.match(decoded, /data:image\/jpeg;base64,BBBB/);
  assert.match(decoded, /data-preview-kind="asset-anchored-v2"/);
  assert.match(decoded, /入力素材を保持/);
});

test('visual modes keep the uploaded asset while changing only the presentation filter', () => {
  const line = decodeURIComponent(buildAssetAnchoredPreviewDataUrl({
    sourceImageUrl: source,
    title: '平絵生成',
    summary: 'line-art',
    mode: 'line-art',
  }).split(',', 2)[1]);
  const vector = decodeURIComponent(buildAssetAnchoredPreviewDataUrl({
    sourceImageUrl: source,
    title: 'SVG化',
    summary: 'vector',
    mode: 'vector',
  }).split(',', 2)[1]);

  assert.match(line, /url\(#line-art\)/);
  assert.match(vector, /url\(#vector\)/);
  assert.match(line, /data:image\/png;base64,AAAA/);
  assert.match(vector, /data:image\/png;base64,AAAA/);
  assert.notEqual(line, vector);
});

test('non-image input fails closed instead of creating a fake result', () => {
  assert.throws(
    () => buildAssetAnchoredPreviewDataUrl({
      sourceImageUrl: 'https://example.invalid/image.png',
      title: 'bad',
      summary: 'bad',
      mode: 'asset',
    }),
    /asset_anchored_preview_source_image_required/,
  );
});

test('line-generation renders the real result instead of fixed pending cards', () => {
  assert.match(workbenchSource, /\{lightchainResult \? \(/);
  assert.doesNotMatch(workbenchSource, /Array\.from\(\{ length: 4 \}\)/);
});

test('generated result controls are not clipped by the empty-state aspect ratio', () => {
  assert.match(workbenchSource, /lightchainResult \? 'min-h-\[420px\] overflow-visible' : 'aspect-\[16\/9\] overflow-hidden'/);
});

test('workspace and detail handlers preserve uploaded assets before canned previews', async () => {
  assert.match(workbenchSource, /const setUploadedAssetResult =/);
  assert.match(workbenchSource, /const sourceImageUrl = materialSlotFiles\.primary\?\.imageUrl \|\| garmentImageUrl/);
  assert.match(workbenchSource, /const anchoredPreview = buildAssetAnchoredPreviewDataUrl\(\{/);
  assert.match(workbenchSource, /imageUrl: anchoredPreview/);
  assert.match(workbenchSource, /const handleWorkspaceStyleGenerate = async \(\) => \{[\s\S]*?handleLightchainPreviewGenerate\(/);
  await assertCustomStyleContactContract(workbenchSource);
  assert.match(workbenchSource, /const handleWearDesignStart = \(mode: 'guide' \| 'no-guide'\) => \{/);
  assert.match(workbenchSource, /const handleWearDesignGenerate = \(\) => \{[\s\S]*?handleLightchainPreviewGenerate\(/);
  assert.match(workbenchSource, /const handlePrintDesignStart = \(mode: 'guide' \| 'no-guide'\) => \{[\s\S]*?handleLightchainPreviewGenerate\(/);
  assert.match(workbenchSource, /const handleMarketingDetailGenerate = async \(\) => \{[\s\S]*?handleLightchainPreviewGenerate\(/);
  assert.match(workbenchSource, /const previewMode = selectedTool\.id === 'line-generation'[\s\S]*?currentModelPanel\s*\n\s*\? 'model'/);
  assert.match(workbenchSource, /const handlePrintDesignStart = \(mode: 'guide' \| 'no-guide'\) =>/);
  assert.match(workbenchSource, /const handleMarketingDetailGenerate = async \(\) =>/);
});

test('actual custom-style cards render four untrained samples without generated identities', () => {
  const nodes = extractCustomStyleNodes(workbenchSource);
  for (const tab of ['personal', 'team'] as const) {
    const { tree } = renderCustomStyle(nodes, tab, false, false);
    const cards = renderedElements(tree).filter((element) => element.type === 'article');
    assert.equal(cards.length, 4, `${tab}: four actual sample cards`);
    for (const card of cards) {
      const html = renderToStaticMarkup(card);
      assert.match(html, /サンプル（未学習）/);
      assert.doesNotMatch(html, /完了|学習済|trained|model[-_]?id|asset[-_]?id/i);
    }
  }
});
