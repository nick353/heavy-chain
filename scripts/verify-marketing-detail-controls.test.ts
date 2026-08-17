import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourcePath = new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url);

test('marketing-detail navigation, project naming, asset/layer controls, and canvas controls are wired', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /data-testid="lightchain-marketing-workspace-home"/);
  assert.match(source, /data-testid="lightchain-marketing-back"/);
  assert.match(source, /onClick=\{\(\) => navigate\('\/lightchain\/marketing-home'\)\}/);
  assert.match(source, /data-testid="lightchain-marketing-project-name"/);
  assert.match(source, /setMarketingProjectNameEditing\(true\)/);
  assert.match(source, /data-testid="lightchain-marketing-project-name-input"/);
  assert.match(source, /commitMarketingProjectName/);
  assert.match(source, /marketingProjectName: selectedTool\.id === 'marketing-detail' \? marketingProjectName : null/);
  assert.match(source, /data-testid="lightchain-marketing-tutorial"/);
  assert.match(source, /data-testid="lightchain-marketing-tutorial-next"/);
  assert.match(source, /data-testid="lightchain-marketing-tutorial-skip"/);
  assert.match(source, /setMarketingTutorialStep/);
  assert.match(source, /setMarketingTutorialDismissed/);
  assert.match(source, /data-testid="lightchain-workspace-tutorial"/);
  assert.match(source, /data-testid="lightchain-workspace-tutorial-next"/);
  assert.match(source, /data-testid="lightchain-workspace-tutorial-skip"/);
  assert.match(source, /setWorkspaceTutorialStep/);
  assert.match(source, /setWorkspaceTutorialDismissed/);
  assert.match(source, /searchParams\.get\('category'\)/);
  assert.match(source, /to=\{isModelToolDetail \? `\/lightchain\/\$\{id\}` : `\/lightchain\?category=\$\{id\}`\}/);

  assert.match(source, /testId: 'lightchain-marketing-layers-nav'/);
  assert.match(source, /testId: 'lightchain-marketing-assets-nav'/);
  assert.match(source, /setMarketingDetailTab\('layers'\)/);
  assert.match(source, /openMaterialModalForSlot\('primary'\)/);
  assert.match(source, /data-testid="lightchain-marketing-canvas"/);
  assert.match(source, /data-active-tool=\{marketingCanvasTool\}/);
  assert.match(source, /data-testid=\{`lightchain-marketing-canvas-tool-\$\{tool\}`\}/);
  assert.match(source, /setMarketingCanvasTool\(tool\)/);
  assert.match(source, /data-testid="lightchain-marketing-zoom-value"/);
  assert.match(source, /setMarketingCanvasZoom/);
  assert.match(source, /data-testid=\{`lightchain-marketing-layer-\$\{layer\.id\}`\}/);
  assert.match(source, /setActiveLayer\(layer\.id\)/);

  assert.match(source, /data-testid="lightchain-design-agent-menu"/);
  assert.match(source, /to="\/lightchain"/);
  assert.match(source, /data-testid=\{`lightchain-print-design-style-\$\{item\}`\}/);
  assert.match(source, /setPrintDesignStyle\(item\)/);
  assert.match(source, /data-testid=\{`lightchain-wear-design-focus-\$\{item\}`\}/);
  assert.match(source, /setWearDesignFocus\(item\)/);
  assert.match(source, /変更箇所: \$\{wearDesignFocus\}/);
  assert.match(source, /用途: \$\{printDesignStyle\}/);
  assert.doesNotMatch(source, /onClick=\{\(\) => card\.isNew && navigate\('\/lightchain\/wear-design-detail'\)\}/);
});
