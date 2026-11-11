import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/pages/LightchainGraphicDesignPage.tsx', import.meta.url), 'utf8');
const gallery = readFileSync(new URL('../src/components/GallerySelector.tsx', import.meta.url), 'utf8');

test('AIグラフィックデザイン adds references through Light\'s 素材を選択 with its upload tile first', () => {
  assert.match(page, /data-testid="graphic-design-upload" onClick=\{\(\) => openLibrary\(\)\}/);
  assert.match(page, /onClick=\{\(\) => openLibrary\(\)\} disabled=\{locked\} aria-label="画像を追加"/);
  assert.match(page, /<GallerySelector isOpen=\{Boolean\(library\) && !locked\} title="素材を選択"/);
  assert.match(page, /uploadTile=\{\{ accept: 'image\/jpeg,image\/png,image\/webp'/);
  // A library image is read and added like a file from the computer.
  assert.match(page, /new File\(\[blob\], name \|\| 'library-image'/);
  assert.match(gallery, /uploadTile && activeLibraryTab === 'upload-history'/);
  assert.match(gallery, /ファイルをアップロード/);
  assert.match(gallery, /クリック\/ドラッグ&ドロップで画像をアップロードします。/);
});

test('hovering the selected reference shows Light\'s 差し替え and 削除', () => {
  assert.match(page, /data-testid="graphic-design-preview-actions"/);
  assert.match(page, /aria-label="画像を差し替え"[^>]*onClick=\{\(\) => openLibrary\(selected === 1 && workspace\.slots\.secondary \? 'secondary' : 'primary'\)\}/);
  assert.match(page, /aria-label="画像を削除"[^>]*onClick=\{\(\) => removeReference\(/);
  assert.match(page, /group-hover:opacity-100/);
  // 差し替え replaces the chosen slot with one image instead of adding.
  assert.match(page, /if \(replace\) \{ if \(files\[0\]\) void workspace\.upload\(replace, files\[0\]\); return; \}/);
});

test('the studio makes a new image every time AI生成 is pressed after a success, as Light does', () => {
  const studio = readFileSync(new URL('../src/pages/FashionStudioDetailPage.tsx', import.meta.url), 'utf8');
  assert.match(studio, /if \(outcome\.status === 'success'\) logicalAttemptRef\.current = null;/);
  // A failed or uncertain attempt keeps its key (the next press settles it instead of paying twice).
  assert.doesNotMatch(studio, /outcome\.status !== 'success'[^\n]*logicalAttemptRef\.current = null/);
});
