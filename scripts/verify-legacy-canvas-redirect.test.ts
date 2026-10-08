import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { designDetailHrefForLegacyCanvas } from '../src/lib/legacyCanvasRoute.ts';

test('old Canvas links open the Light design detail', () => {
  assert.equal(designDetailHrefForLegacyCanvas(undefined, ''), '/designProduction/detail');
  assert.equal(designDetailHrefForLegacyCanvas('new', ''), '/designProduction/detail');
  assert.equal(designDetailHrefForLegacyCanvas('new', '?galleryImageId=img_1'), '/designProduction/detail?openImageId=img_1');
  assert.equal(designDetailHrefForLegacyCanvas('new', '?sourceArtifactId=id%3Aa-1'), '/designProduction/detail?attachArtifactId=id%3Aa-1');
  assert.equal(designDetailHrefForLegacyCanvas('doc-1', '?galleryImageId=img_1'), '/designProduction/detail?projectId=doc-1');
});

test('App routes /canvas links to the detail and keeps the full editor under /edit', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /<Route path="\/canvas" element=\{<LegacyCanvasRedirect \/>\} \/>/);
  assert.match(app, /<Route path="\/canvas\/:projectId" element=\{<LegacyCanvasRedirect \/>\} \/>/);
  assert.match(app, /path="\/canvas\/:projectId\/edit"[\s\S]*?<CanvasEditorPage \/>/);
  const detail = fs.readFileSync('src/features/designDetail/DesignEntryDetailPage.tsx', 'utf8');
  assert.match(detail, /const isDocumentOnly = Boolean\(projectId\) && !conversationId/);
  assert.match(detail, /coordinator\.prepare\(text\.trim\(\), withSelectedReference\(manifest\), isDocumentOnly \? projectId : undefined\)/);
  assert.match(detail, /resolveDesignAttachment\(/);
  assert.doesNotMatch(detail, /to=\{`\/canvas\/\$\{encodeURIComponent\(projectId\)\}(?:\?|`)/);
  const editor = fs.readFileSync('src/pages/CanvasEditorPage.tsx', 'utf8');
  assert.doesNotMatch(editor, /navigate\(`\/canvas\/\$\{\w+(?:\.id)?\}`/);
  assert.match(editor, /\/designProduction\/detail\?projectId=/);
});

test('reopening the same handoff link does not attach the image twice', () => {
  const detail = fs.readFileSync('src/features/designDetail/DesignEntryDetailPage.tsx', 'utf8');
  assert.match(detail, /designAttachmentName\(\{ galleryImageId: attachImageId, artifactId: attachArtifactId \}\)/);
  assert.match(detail, /pendingReferences\.current\.some\(/);
  const handoff = fs.readFileSync('src/features/designDetail/canvasHandoff.ts', 'utf8');
  assert.match(handoff, /fileFromSource\(`generated-images\/\$\{options\.galleryImageId\}`, designAttachmentName\(options\)\)/);
});
