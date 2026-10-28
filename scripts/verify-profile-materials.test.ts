import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { officeText } from '../src/lib/officeText.ts';

/** A minimal ZIP writer (deflate or stored entries) so the test builds real DOCX / XLSX / PPTX bytes. */
function zip(entries: Record<string, string>, store = false): Uint8Array {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const [path, text] of Object.entries(entries)) {
    const name = Buffer.from(path); const raw = Buffer.from(text); const data = store ? raw : deflateRawSync(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, data); centrals.push(central, name); offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

test('officeText reads Word paragraphs, Excel cells and PowerPoint slides in order', async () => {
  const docx = zip({ '[Content_Types].xml': '<x/>', 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>ブランド名：</w:t></w:r><w:r><w:t xml:space="preserve">試しブランド</w:t></w:r></w:p><w:p><w:r><w:t>価格帯 3000&amp;8000</w:t></w:r></w:p></w:body></w:document>' });
  assert.equal(await officeText(docx, 'docx'), 'ブランド名：試しブランド\n価格帯 3000&8000');
  const xlsx = zip({
    'xl/sharedStrings.xml': '<sst><si><t>国</t></si><si><t>日本</t></si><si><r><t>年齢</t></r><r><t>層</t></r></si></sst>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row><c r="A1"><v>2</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row><c r="A2" t="s"><v>2</v></c><c r="B2" t="inlineStr"><is><t>25〜34歳</t></is></c></row></sheetData></worksheet>',
  });
  assert.equal(await officeText(xlsx, 'xlsx'), '国,日本\n年齢層,25〜34歳\n2');
  const pptx = zip({ 'ppt/slides/slide10.xml': '<p:sld><a:p><a:r><a:t>最後</a:t></a:r></a:p></p:sld>', 'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>レディース</a:t></a:r></a:p><a:p><a:r><a:t>自社EC</a:t></a:r></a:p></p:sld>' }, true);
  assert.equal(await officeText(pptx, 'pptx'), '[スライド1]\nレディース\n自社EC\n[スライド2]\n最後');
  await assert.rejects(officeText(new Uint8Array([1, 2, 3]), 'docx'));
});

test('the profile form has Light\'s 資料ファイル card, upload dialog and スマート自動入力 progress', () => {
  const page = readFileSync('src/pages/AgentProfilesPage.tsx', 'utf8');
  for (const text of ['資料ファイル', '複数ファイルに対応。アップロード後、プロファイルに保存されます', '資料を選択', '再アップロードして解析', '資料をアップロード',
    'システムは資料に明記された情報のみ自動入力します。記載のない項目は空欄のままになります', 'ここにファイルをドラッグするか、クリックして選択', '解析を開始',
    'スマート自動入力', '資料パックをアップロードして自動入力', '商品企画、ブランド資料、販売振り返り、顧客提案などに対応', '資料パックを解析中', '商品カテゴリと価格情報を抽出', '品類、国、年齢層、チャネルを識別'])
    assert.ok(page.includes(text), text);
  const materials = readFileSync('src/lib/profileMaterials.ts', 'utf8');
  assert.match(materials, /PROFILE_MATERIAL_ACCEPT = '\.pdf,\.pptx,\.docx,\.xlsx,\.csv,\.jpg,\.jpeg,\.png'/);
  assert.match(materials, /invokeProviderAction<ExtractedProfile>\('profile-extract'/);
  const tasks = readFileSync('src/features/agent/agentTasks.ts', 'utf8');
  assert.match(tasks, /資料の要点：\$\{profile\.materialsSummary\}/);
});
