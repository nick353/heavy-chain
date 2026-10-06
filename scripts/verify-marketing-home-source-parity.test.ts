import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
const marketing = source.slice(source.indexOf('export function LightchainMarketingHomePage'), source.indexOf('/** Read-only conversation cards'));

test('marketing home keeps the source-shaped prompt and project surface', () => {
  assert.match(source, /export function LightchainMarketingHomePage/);
  assert.match(marketing, /aria-label="残りクレジット"/);
  assert.match(marketing, /\/lightchain-assets\/marketing\/upload-placeholder\.png/);
  assert.match(marketing, /\/lightchain-assets\/static\/project_default_cover\.png/);
  assert.match(marketing, />PROJECT<\/span>/);
  assert.match(marketing, /\/lightchain-assets\/static\/searchEmpty\.png/);
  assert.match(marketing, /data-testid="lightchain-marketing-projects"/);
  assert.match(marketing, /data-testid="lightchain-marketing-reference-cases"/);
  assert.match(marketing, /aria-label=\{`\$\{entry\.title\}のメニュー`\}/);
  assert.match(marketing, /data-tour="marketing-input"/);
  assert.match(marketing, /data-tour="marketing-send"/);
  assert.match(marketing, /data-tour="marketing-scenes"/);
});

test('marketing home starts and lists real marketing projects only', () => {
  // The prompt creates a canvas project + conversation through the marketing workspace coordinator.
  assert.match(marketing, /createDesignEntryCoordinator\(\{ scope: \{ userId, brandId \}, workspace: DIALOGUE_WORKSPACES\.marketing/);
  assert.match(marketing, /useDesignConversationProjects\(undefined, 'marketing'\)/);
  assert.match(marketing, /references\.manifest\(\)/);
  // No fabricated or brand-wide image cards: the old generated-image listing is gone.
  assert.doesNotMatch(marketing, /listGeneratedImages/);
  assert.doesNotMatch(marketing, /listWorkspaceArtifacts/);
});

test('marketing home has no hotlinks to the Light origin', () => {
  assert.doesNotMatch(marketing, /jp\.linkaigc\.com|aliyuncs\.com|static-cn\.linkaigc\.com/);
});
