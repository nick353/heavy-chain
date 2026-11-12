import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeGraphicElements, graphicElementGroups, runClaudeTextAction, GRAPHIC_ELEMENT_MAX_TOTAL } from '../cloudflare/heavy-api/src/claude-text.ts';
import {
  assistGroups, assistOptionsFromGroups, assistPromptLines, assistReferenceKey, decodeAssistTag, selectedAssistTags, toggleAssistTag,
} from '../src/features/graphicDesign/graphicAssist.ts';

// Light's AIグラフィックデザイン with アシスト機能 on, read on 2026-11-12 (jp.linkaigc.com/printing, one small blue flower
// print as 参考画像 1): 「デザイン要素解析中…」, then 「参考テキストを選びます 選択済み 0 / 14」 with テーマ 4 / 表現形式 4 /
// 要素 2 / 色彩 4 tags. Picking フラワー柄 and フラットな塗り turned them green (選択済み 2 / 14) and listed them in the right
// panel under テーマ and 表現形式 with ×. Heavy only added one fixed line to the request and showed no tags.
const LIGHT = { theme: ['フラワー柄', 'シンプルで可愛らしい', '明るく軽やか', '穏やかで親しみやすい'], expression: ['デジタルペイント', 'フラットな塗り', 'シンプルでクリーン', '柔らかい輪郭'],
  elements: ['小さな花', '葉と茎'], colors: ['パステルカラー', 'ソフトトーン', '薄い青', '緑'] };

type Json = Record<string, any>;
const env = { ANTHROPIC_API_KEY: 'server-only-test-key' } as any;
const image = { name: 'print2.jpg', kind: 'image', mediaType: 'image/jpeg', data: 'AAAA' };

function claude(answer: Json, seen: Json[] = []) {
  return async (_url: string | URL | Request, init?: RequestInit) => {
    seen.push(JSON.parse(String(init?.body)));
    return Response.json({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(answer) }], usage: { input_tokens: 1, output_tokens: 1 } });
  };
}

test('the server reads the references and returns Light\'s four groups of tags', async () => {
  const seen: Json[] = [];
  const result = await analyzeGraphicElements(env, { brandId: 'b', purpose: 'graphic-elements', files: [image] }, claude(LIGHT, seen) as typeof fetch);
  assert.deepEqual(result.groups, [
    { label: 'テーマ', tags: LIGHT.theme }, { label: '表現形式', tags: LIGHT.expression }, { label: '要素', tags: LIGHT.elements }, { label: '色彩', tags: LIGHT.colors },
  ]);
  const body = seen[0];
  assert.deepEqual(body.output_config.format.schema.required, ['theme', 'expression', 'elements', 'colors']);
  assert.equal(body.messages[0].content.filter((block: Json) => block.type === 'image').length, 1);
  assert.match(body.system, /at most 12 characters/);
  // The route: profile-extract with purpose graphic-elements (no new action, no new allow-list entry).
  const routed = await runClaudeTextAction(env, 'profile-extract', { brandId: 'b', purpose: 'graphic-elements', files: [image, image] }, claude(LIGHT) as typeof fetch) as Json;
  assert.equal(routed.groups[0].label, 'テーマ');
});

test('the tags are short single phrases, each once, at most 5 per group and 16 in all', () => {
  const groups = graphicElementGroups({
    theme: ['「フラワー柄」', 'フラワー柄', 'とても長くて札には入らない説明の文になってしまったもの', 'シンプル', '明るい', '軽やか', '穏やか', '親しみ'],
    expression: ['フラットな塗り。', 'フラワー柄', '線画', '水彩', '版画', '点描', '切り絵'],
    elements: ['小花', '葉', '茎', '蕾', '枝', '実'], colors: ['青', '緑', '白', '紫', '黄'], extra: ['x'],
  });
  assert.deepEqual(groups[0].tags, ['フラワー柄', 'シンプル', '明るい', '軽やか', '穏やか']);
  assert.deepEqual(groups[1].tags, ['フラットな塗り', '線画', '水彩', '版画', '点描']);
  assert.equal(groups.reduce((sum, group) => sum + group.tags.length, 0), GRAPHIC_ELEMENT_MAX_TOTAL);
  assert.deepEqual(groups[3].tags, ['青']);
});

test('only one or two images are read; anything else and an empty answer are refused', async () => {
  await assert.rejects(analyzeGraphicElements(env, { files: [] }, claude(LIGHT) as typeof fetch), /graphic_references_required/);
  await assert.rejects(analyzeGraphicElements(env, { files: [image, image, image] }, claude(LIGHT) as typeof fetch), /graphic_references_required/);
  await assert.rejects(analyzeGraphicElements(env, { files: [{ name: 'a.pdf', kind: 'pdf', data: 'AAAA' }] }, claude(LIGHT) as typeof fetch), /graphic_reference_invalid/);
  await assert.rejects(analyzeGraphicElements(env, { files: [image] }, claude({ theme: [], expression: [], elements: [], colors: [] }) as typeof fetch), /graphic_elements_empty/);
});

test('the browser keeps Light\'s tags as 見出し:札, toggles them, and drops picks a new analysis no longer lists', () => {
  const options = assistOptionsFromGroups([
    { label: 'テーマ', tags: LIGHT.theme }, { label: '表現形式', tags: LIGHT.expression }, { label: '要素', tags: LIGHT.elements }, { label: '色彩', tags: LIGHT.colors },
    { label: '別の欄', tags: ['無視'] },
  ]);
  assert.equal(options.length, 14);
  assert.equal(options[0], 'テーマ:フラワー柄');
  assert.deepEqual(decodeAssistTag('表現形式:フラットな塗り'), { label: '表現形式', tag: 'フラットな塗り' });
  assert.equal(decodeAssistTag('別の欄:x'), null);
  let picked = toggleAssistTag(options, [], 'テーマ:フラワー柄');
  picked = toggleAssistTag(options, picked, '表現形式:フラットな塗り');
  picked = toggleAssistTag(options, picked, 'テーマ:載っていない札');
  assert.deepEqual(picked, ['テーマ:フラワー柄', '表現形式:フラットな塗り']);
  assert.deepEqual(assistGroups(picked), [{ label: 'テーマ', tags: ['フラワー柄'] }, { label: '表現形式', tags: ['フラットな塗り'] }]);
  assert.deepEqual(toggleAssistTag(options, picked, 'テーマ:フラワー柄'), ['表現形式:フラットな塗り']);
  assert.deepEqual(selectedAssistTags(['テーマ:花'], picked), []);
  assert.equal(assistReferenceKey([{ name: 'a|b.jpg' }, { name: 'c.png' }]), '1=a_b.jpg|2=c.png');
});

test('the request carries the picked tags by group; with none picked it keeps the plain analyse line', () => {
  assert.deepEqual(assistPromptLines(false, ['テーマ:フラワー柄']), []);
  assert.deepEqual(assistPromptLines(true, []), ['アシスト: 参考画像のデザイン要素（モチーフ・配色・構図）を解析して反映してください。']);
  assert.deepEqual(assistPromptLines(true, ['色彩:薄い青', 'テーマ:フラワー柄', '色彩:緑']), [
    'アシスト: 参考画像から選んだ次のデザイン要素を、新しいグラフィックにはっきり反映してください。',
    'テーマ: フラワー柄', '色彩: 薄い青、緑',
  ]);
});

test('the page shows Light\'s analysing bar, the tag list with its count, and the picked tags with × in the right panel', () => {
  const page = readFileSync('src/pages/LightchainGraphicDesignPage.tsx', 'utf8');
  for (const text of ['デザイン要素解析中...', '参考テキストを選びます', '選択済み {assistTags.length} / {optionCount}', 'デザイン要素を解析できませんでした', '再解析', 'を外す'])
    assert.ok(page.includes(text), text);
  assert.match(page, /graphicDesignBrief\(references\.length, strengths, assist, assistTags\)/);
  assert.match(page, /analyzeGraphicReferences\(currentBrand\.id, references\)/);
  // The tags survive a reload with the other inputs.
  const hook = readFileSync('src/hooks/useCanonicalImageWorkspace.ts', 'utf8');
  assert.match(hook, /'assistOptions','assistTags','assistFor'/);
  const api = readFileSync('src/features/graphicDesign/graphicAssistApi.ts', 'utf8');
  assert.match(api, /invokeProviderAction<\{ groups\?: unknown \}>\('profile-extract', \{ brandId, purpose: 'graphic-elements', files \}\)/);
});
