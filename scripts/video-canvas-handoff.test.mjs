import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages/VideoWorkstationPage.tsx', import.meta.url), 'utf8');

test('Canvasへ opens the saved source image, not the placeholder handoff project', () => {
  const handoff = source.slice(source.indexOf('const handoffVideoEditorToCanvas'), source.indexOf("toast.error(error instanceof Error ? error.message : 'Canvas保存に失敗しました')"));
  assert.match(handoff, /designImageProjectHref\(remoteImageId\)/);
  assert.match(handoff, /\/canvas\/new\?sourceArtifactId=/);
  assert.doesNotMatch(handoff, /navigate\(`\/canvas\/\$\{projectId\}`\)/);
});
