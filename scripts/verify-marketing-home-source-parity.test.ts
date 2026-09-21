import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');

test('marketing home keeps the source-shaped prompt and project surface', () => {
  assert.match(source, /export function LightchainMarketingHomePage/);
  assert.match(source, /aria-label="残りクレジット"/);
  assert.match(source, /marketing\/upload-placeholder\.png/);
  assert.match(source, /static\/project_default_cover\.png/);
  assert.match(source, /static\/searchEmpty\.png/);
  assert.match(source, /items-start gap-4/);
  assert.match(source, /bg-\[#202829\]\/95/);
  assert.match(source, /className="mt-9" data-testid="lightchain-marketing-projects"/);
  assert.doesNotMatch(source, /<span className="text-sm text-neutral-400">\{projects\.length\}件<\/span>/);
  assert.match(source, /heavy-marketing-pins:/);
  assert.match(source, /saveMarketingArtifactToLibrary/);
  assert.match(source, /deleteMarketingArtifact/);
  assert.match(source, /aria-label=\{`\$\{project\.title\}のメニュー`\}/);
  assert.match(source, /data-testid="lightchain-marketing-reference-cases"/);
});
