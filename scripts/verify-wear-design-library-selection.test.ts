import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');

assert.match(source, /data-testid="lightchain-wear-design-library-open"/);
assert.match(source, /onClick=\{\(\) => openMaterialModalForSlot\('primary'\)\}/);
assert.match(source, /data-testid=\{`lightchain-wear-design-library-use-\$\{activeMaterialTab\}-\$\{itemIndex\}`\}/);
assert.match(source, /このタブに使える保存済み素材はありません。プラットフォーム素材または生成履歴を選択してください/);

const wearStart = source.match(/const handleWearDesignStart = \([\s\S]*?\n\x20{2}\};/);
assert.ok(wearStart, 'wear design start handler should remain explicit');
assert.doesNotMatch(wearStart[0], /handleLightchainPreviewGenerate/);
assert.match(source, /const handleWearDesignGenerate = \(\) => \{/);
assert.match(source, /onClick=\{handleWearDesignGenerate\}/);
assert.match(source, /item\.id === 'platform-garment-blank-white-tshirt'/);
assert.match(source, /rightsAlreadyConfirmed: platformAssetRightsConfirmed/);

console.log('wear design library selection tests: 7/7 passed');
