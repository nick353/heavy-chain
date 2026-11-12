import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STUDIO_IMAGE_SEARCH_CATEGORIES, STUDIO_IMAGE_SEARCH_MAX_CONVERSATIONS, STUDIO_IMAGE_SEARCH_NOTE_MAX, STUDIO_IMAGE_SEARCH_ROUND_SIZE, STUDIO_IMAGE_SEARCH_SIZE,
  STUDIO_IMAGE_SEARCH_TEXT, STUDIO_IMAGE_SEARCH_TILE, interleaveStudioSearchResults, loadStudioSearchConversations, nextStudioSearchQueries,
  removeStudioSearchConversation, saveStudioSearchConversations, searchStudioAccessoryRound, shownStudioSearchImages, studioImageSearchStorageKey,
  studioSearchAskText, studioSearchHistoryStamp, studioSearchMoreDisabled, studioSearchTitleNamesItem, upsertStudioSearchConversation, type StudioSearchConversation,
} from '../src/lib/studioImageSearch.ts';
import type { FoundImage } from '../src/features/designDetail/referenceImageSearch.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const panel = read('../src/components/lightchain/StudioImageSearchPanel.tsx');
const api = read('../src/lib/studioImageSearchApi.ts');

const image = (id: string, extra: Partial<FoundImage> = {}): FoundImage => ({ id, title: id, thumbUrl: `https://img.example/${id}.jpg`, imageUrl: `https://img.example/${id}-large.jpg`,
  pageUrl: `https://img.example/page/${id}`, license: 'CC BY 4.0', creator: 'someone', source: 'openverse', ...extra });
const conversation = (id: string, createdAt: number, extra: Partial<StudioSearchConversation> = {}): StudioSearchConversation => ({
  id, createdAt, updatedAt: createdAt, imageUrl: 'data:image/jpeg;base64,AAAA', queries: [], usedQueries: [], turns: [], ...extra });
const memoryStorage = (limit = Infinity) => {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, removeItem: (key: string) => { data.delete(key); },
    setItem: (key: string, value: string) => { if (value.length > limit) throw new DOMException('full', 'QuotaExceededError'); data.set(key, value); } };
};

// ---- 本家と同じ言葉と大きさ -----------------------------------------------------------------------------------
test('言葉は本家（言葉の束の日本語）のまま、カテゴリーは バッグ・靴・その他 で最初はバッグ、説明は50字まで', () => {
  assert.equal(STUDIO_IMAGE_SEARCH_TEXT.title, '画像検索');
  assert.equal(STUDIO_IMAGE_SEARCH_TEXT.welcome, '一致するアクセサリーを探すために、参考画像を1枚選択してください。');
  assert.equal(STUDIO_IMAGE_SEARCH_TEXT.upload, '画像をアップロード');
  assert.equal(STUDIO_IMAGE_SEARCH_TEXT.fromCanvas, 'キャンバスから選択');
  assert.equal(STUDIO_IMAGE_SEARCH_TEXT.analyzing, '画像を解析中…');
  assert.equal(STUDIO_IMAGE_SEARCH_TEXT.firstAsk, 'この画像に合うアクセサリーをマッチング');
  assert.equal(STUDIO_IMAGE_SEARCH_TEXT.searching, '画像を検索中です');
  assert.equal(STUDIO_IMAGE_SEARCH_TEXT.more, 'さらに検索');
  assert.equal(STUDIO_IMAGE_SEARCH_TEXT.precise, '高精度検索');
  assert.equal(STUDIO_IMAGE_SEARCH_TEXT.sendToCanvas, 'キャンバスに送信');
  assert.equal(STUDIO_IMAGE_SEARCH_TEXT.history, '画像検索履歴');
  assert.equal(STUDIO_IMAGE_SEARCH_TEXT.historyEnd, 'これ以上データがありません');
  assert.equal(STUDIO_IMAGE_SEARCH_TEXT.failed, '操作が失敗しました。しばらくしてからもう一度お試しください。');
  assert.equal(STUDIO_IMAGE_SEARCH_TEXT.notePlaceholder, '補足説明（必須）例：麦わら帽子／白いアウトドアスニーカー／赤いレザーハンドバッグ');
  assert.deepEqual(STUDIO_IMAGE_SEARCH_CATEGORIES.map((item) => item.label), ['バッグ', '靴', 'その他']);
  assert.equal(STUDIO_IMAGE_SEARCH_NOTE_MAX, 50);
  assert.deepEqual(STUDIO_IMAGE_SEARCH_SIZE, { collapsedWidth: 312, collapsedHeight: 48, expandedWidth: 408, expandedHeight: 'calc(100vh - 120px)' });
  assert.deepEqual(STUDIO_IMAGE_SEARCH_TILE, { width: 108, height: 144 });
  assert.equal(STUDIO_IMAGE_SEARCH_ROUND_SIZE, 12);
});

test('さらに検索の吹き出し: ふだんは「さらに検索」、高精度は「<カテゴリー>ディレクトリ内を検索,<説明>」（本家の台本と同じ）', () => {
  assert.equal(studioSearchAskText(null), 'さらに検索');
  assert.equal(studioSearchAskText({ category: 'bag', note: ' 麦わら帽子 ' }), 'バッグディレクトリ内を検索,麦わら帽子');
  assert.equal(studioSearchAskText({ category: 'shoes', note: '白いスニーカー' }), '靴ディレクトリ内を検索,白いスニーカー');
  assert.equal(studioSearchAskText({ category: 'bag', note: '  ' }), 'さらに検索');
});

test('さらに検索は検索中と、高精度で説明が空のときだけ押せない', () => {
  assert.equal(studioSearchMoreDisabled({ busy: false, precise: false, note: '' }), false);
  assert.equal(studioSearchMoreDisabled({ busy: true, precise: false, note: '' }), true);
  assert.equal(studioSearchMoreDisabled({ busy: false, precise: true, note: ' ' }), true);
  assert.equal(studioSearchMoreDisabled({ busy: false, precise: true, note: '麦わら帽子' }), false);
});

// ---- 検索語と結果の並べ方 ----------------------------------------------------------------------------------------
test('1回の検索は前から4つの検索語を使い、残りを次の「さらに検索」に回す', () => {
  assert.deepEqual(nextStudioSearchQueries({ queries: ['a', 'b', 'c', 'd', 'e', 'f'] }), { queries: ['a', 'b', 'c', 'd'], rest: ['e', 'f'] });
  assert.deepEqual(nextStudioSearchQueries({ queries: ['a'] }), { queries: ['a'], rest: [] });
  assert.deepEqual(nextStudioSearchQueries({ queries: [] }), { queries: [], rest: [] });
});

test('結果は検索語ごとに1枚ずつ混ぜ、前に出した画像と重なり（同じ id・同じ大きい画像）を飛ばし、12枚で止める', () => {
  const sandals = ['s1', 's2', 's3', 's4', 's5'].map((id) => image(id));
  const bags = ['b1', 'b2', 'b3'].map((id) => image(id));
  const bangles = [image('g1'), image('s2-copy', { imageUrl: 'https://img.example/s2-large.jpg' }), image('g2')];
  assert.deepEqual(interleaveStudioSearchResults([sandals, bags, bangles], [image('b1')], 12).map((item) => item.id), ['s1', 'g1', 's2', 'b2', 's3', 'b3', 'g2', 's4', 's5']);
  const many = Array.from({ length: 4 }, (_, list) => Array.from({ length: 6 }, (_, at) => image(`q${list}-${at}`)));
  const picked = interleaveStudioSearchResults(many);
  assert.equal(picked.length, 12);
  assert.deepEqual(picked.slice(0, 4).map((item) => item.id), ['q0-0', 'q1-0', 'q2-0', 'q3-0']);
});

test('1回分の検索: 検索語を並べて探し、失敗した語は残りで埋め、全部失敗したときだけ失敗にする', async () => {
  const asked: Array<{ query: string; limit?: number }> = [];
  const search = async (query: string, options: { limit?: number } = {}) => {
    asked.push({ query, limit: options.limit });
    if (query === 'broken') throw new Error('rate_limited');
    return Array.from({ length: options.limit ?? 4 }, (_, at) => image(`${query}-${at}`));
  };
  const found = await searchStudioAccessoryRound(['black sandals', 'broken', 'straw bag', 'gold bangle'], { search, shown: [image('straw bag-0')] });
  assert.equal(found.length, 12);
  assert.equal(found.some((item) => item.id === 'straw bag-0'), false);
  assert.deepEqual(found.slice(0, 3).map((item) => item.id), ['black sandals-0', 'gold bangle-0', 'black sandals-1']);
  assert.ok(asked.every((item) => (item.limit ?? 0) >= 5 && (item.limit ?? 0) <= 7));
  await assert.rejects(searchStudioAccessoryRound(['broken', 'broken'], { search }), /rate_limited/);
  assert.deepEqual(await searchStudioAccessoryRound([], { search }), []);
});

test('題名が品物を指す画像だけを並べ、6枚に届かないときだけ合わない画像で埋める（色だけ合う道路や建物の写真を出さない）', async () => {
  const titles: Record<string, string[]> = {
    'straw tote bag': ['Straw stack near Llandeilo', 'Straw tote bag on a chair', 'Church in Kent', 'Woven straw basket bag'],
    'black leather sandals': ['Blackheath road', 'Black leather sandals', 'Sandal_on_sand', 'A shop front'],
  };
  const search = async (query: string) => (titles[query] ?? []).map((title, at) => image(`${query}-${at}`, { title }));
  const found = await searchStudioAccessoryRound(['straw tote bag', 'black leather sandals'], { search });
  // 品物（bag・sandals）を指す4枚 → 6枚に2枚足りないので、合わない画像を2枚だけ足す（色や素材だけ合う写真は後ろ）。
  assert.deepEqual(found.map((item) => item.title), ['Straw tote bag on a chair', 'Black leather sandals', 'Woven straw basket bag', 'Sandal_on_sand', 'Straw stack near Llandeilo', 'Blackheath road']);
  const plenty = async (query: string) => Array.from({ length: 7 }, (_, at) => image(`${query}-${at}`, { title: at % 2 ? `${query} photo ${at}` : `Unrelated scene ${at}` }));
  const many = await searchStudioAccessoryRound(['leather belt', 'silk scarf', 'pearl necklace'], { search: plenty });
  assert.equal(many.length, 9);
  assert.ok(many.every((item) => !item.title.startsWith('Unrelated')));
  assert.equal(studioSearchTitleNamesItem('Silver-hoop-earring.jpg', 'silver hoop earrings'), true);
  assert.equal(studioSearchTitleNamesItem('Silverton station', 'silver hoop earrings'), false);
  assert.equal(studioSearchTitleNamesItem('Panama hat, straw', 'straw hat'), true);
  assert.equal(studioSearchTitleNamesItem('Chatham dockyard', 'straw hat'), false);
});

test('会話で出した画像は結果の吹き出しから集める（次の検索で飛ばすため）', () => {
  const item = conversation('c', 1, { turns: [{ id: 'a', kind: 'ask', text: 'x' }, { id: 'r1', kind: 'results', images: [image('1'), image('2')] }, { id: 'r2', kind: 'results', images: [image('3')] }] });
  assert.deepEqual(shownStudioSearchImages(item).map((found) => found.id), ['1', '2', '3']);
});

// ---- この端末に残す会話（画像検索履歴） --------------------------------------------------------------------------
test('会話はプロジェクトごとに残り、新しい順に読み戻せる。壊れた行と https でない画像は捨てる', () => {
  const storage = memoryStorage();
  const older = conversation('old', 100, { turns: [{ id: 'a', kind: 'ask', text: 'この画像に合うアクセサリーをマッチング', imageUrl: 'data:image/jpeg;base64,AAAA' },
    { id: 'r', kind: 'results', images: [image('ok'), image('bad', { thumbUrl: 'javascript:alert(1)' })] }] });
  const newer = conversation('new', 200, { queries: ['straw bag'], usedQueries: ['black sandals'] });
  saveStudioSearchConversations(storage, 'project-1', [older, newer]);
  assert.ok(storage.data.has(studioImageSearchStorageKey('project-1')));
  const loaded = loadStudioSearchConversations(storage, 'project-1');
  assert.deepEqual(loaded.map((item) => item.id), ['new', 'old']);
  assert.deepEqual(loaded[0].queries, ['straw bag']);
  assert.deepEqual(loaded[0].usedQueries, ['black sandals']);
  const results = loaded[1].turns[1];
  assert.equal(results.kind, 'results');
  assert.deepEqual(results.kind === 'results' ? results.images.map((item) => item.id) : [], ['ok']);
  assert.deepEqual(loadStudioSearchConversations(storage, 'project-2'), []);
  storage.data.set(studioImageSearchStorageKey('broken'), '{not json');
  assert.deepEqual(loadStudioSearchConversations(storage, 'broken'), []);
  storage.data.set(studioImageSearchStorageKey('mixed'), JSON.stringify([{ id: 1 }, null, conversation('fine', 5)]));
  assert.deepEqual(loadStudioSearchConversations(storage, 'mixed').map((item) => item.id), ['fine']);
  assert.deepEqual(loadStudioSearchConversations({ getItem: () => { throw new Error('blocked'); } }, 'x'), []);
  assert.deepEqual(loadStudioSearchConversations(null, 'x'), []);
});

test('入りきらないときは古い会話から捨てて入れ直す。上限は20件で、全部消えたら置き場も消す', () => {
  const list = Array.from({ length: 5 }, (_, at) => conversation(`c${at}`, at, { imageUrl: `data:image/jpeg;base64,${'A'.repeat(400)}` }));
  const limit = JSON.stringify(list.slice(2)).length + 1;
  const storage = memoryStorage(limit);
  const kept = saveStudioSearchConversations(storage, 'p', list);
  assert.deepEqual(kept.map((item) => item.id), ['c4', 'c3', 'c2']);
  assert.deepEqual(loadStudioSearchConversations(storage, 'p').map((item) => item.id), ['c4', 'c3', 'c2']);
  const many = Array.from({ length: 25 }, (_, at) => conversation(`m${at}`, at));
  assert.equal(saveStudioSearchConversations(memoryStorage(), 'p', many).length, STUDIO_IMAGE_SEARCH_MAX_CONVERSATIONS);
  saveStudioSearchConversations(storage, 'p', []);
  assert.equal(storage.data.has(studioImageSearchStorageKey('p')), false);
});

test('会話の入れ替え・削除と、一覧の月日・時刻（MM/DD・HH:mm）', () => {
  const a = conversation('a', 1); const b = conversation('b', 2);
  assert.deepEqual(upsertStudioSearchConversation([a], b).map((item) => item.id), ['b', 'a']);
  const changed = { ...a, queries: ['x'] };
  const replaced = upsertStudioSearchConversation([b, a], changed);
  assert.deepEqual(replaced.map((item) => item.id), ['b', 'a']);
  assert.deepEqual(replaced[1].queries, ['x']);
  assert.deepEqual(removeStudioSearchConversation([b, a], 'b').map((item) => item.id), ['a']);
  const stamp = studioSearchHistoryStamp(new Date(2026, 10, 12, 18, 30).getTime());
  assert.deepEqual(stamp, { date: '11/12', time: '18:30' });
  assert.deepEqual(studioSearchHistoryStamp(new Date(2026, 0, 5, 7, 4).getTime()), { date: '01/05', time: '07:04' });
  assert.deepEqual(studioSearchHistoryStamp(Number.NaN), { date: '--', time: '--' });
});

// ---- 部品の約束 ----------------------------------------------------------------------------------------------
test('部品の出口: props の形と、帯の画像検索（新しい id のときだけ・解析中は受けない）', () => {
  assert.match(panel, /export type StudioImageSearchRequest = \{ id: string; imageUrl: string \};/);
  assert.match(panel, /projectId: string;\s*brandId: string;/);
  assert.match(panel, /request: StudioImageSearchRequest \| null;/);
  assert.match(panel, /onSendToCanvas\(file: File, image: FoundImage\): void \| Promise<void>;/);
  assert.match(panel, /expanded\?: boolean;\s*onExpandedChange\?\(open: boolean\): void;/);
  assert.match(panel, /onSelectFromCanvas\?\(\): Promise<string \| null \| undefined>;/);
  assert.match(panel, /if \(!request \|\| handledRequest\.current === request\.id\) return;/);
  assert.match(panel, /if \(stepRef\.current === 'analysis'\) return;/);
  // 本家と同じ: 解析は最低2秒見せ、失敗したら最初の画面へ戻してお知らせ。
  assert.match(panel, /Promise\.all\(\[planStudioAccessories\(brandId, large\), wait\(STUDIO_IMAGE_SEARCH_MIN_ANALYSIS_MS\)\]\)/);
  assert.match(panel, /toast\.error\(T\.failed\);\s*goStep\('upload'\);/);
});

test('結果のタイル: 108×144、押すと foundImageFile で取り込んで onSendToCanvas、拡大は送らない、作者とライセンスを出す', () => {
  assert.match(panel, /h-\[144px\] w-\[108px\]/);
  assert.match(panel, /onSendToCanvas\(await foundImageFile\(image\), image\)/);
  assert.match(panel, /toast\.success\(T\.sent\)/);
  assert.match(panel, /event\.stopPropagation\(\); setPreview\(image\);/);
  assert.match(panel, /<FoundImageCredit image=\{image\} \/>/);
  assert.match(panel, /\{FOUND_IMAGE_SOURCES_NOTE\}/);
  assert.match(panel, /bg-black\/40/);
  assert.match(panel, /bottom-2\.5 left-2\.5/);
});

test('高精度検索: カテゴリーと50字の説明、送ったら閉じ、切ったら説明を消す。押せるかは共通の判定で決める', () => {
  assert.match(panel, /maxLength=\{STUDIO_IMAGE_SEARCH_NOTE_MAX\}/);
  assert.match(panel, /\{note\.length\}\/\{STUDIO_IMAGE_SEARCH_NOTE_MAX\}/);
  assert.match(panel, /if \(precise\) setPrecise\(false\);/);
  assert.match(panel, /useEffect\(\(\) => \{ if \(!precise\) setNote\(''\); \}, \[precise\]\);/);
  assert.match(panel, /disabled=\{studioSearchMoreDisabled\(\{ busy, precise, note \}\)\}/);
  assert.match(panel, /!event\.nativeEvent\.isComposing/);
});

test('検索語はサーバーの Claude（profile-extract の accessory-search）。鍵は画面に持たない', () => {
  assert.match(api, /invokeProviderAction<\{ queries\?: unknown \}>\('profile-extract', \{\s*brandId, purpose: 'accessory-search'/);
  assert.match(api, /kind: 'image', mediaType: 'image\/jpeg'/);
  assert.doesNotMatch(api, /anthropic|api\.openverse|x-api-key/i);
  const wrangler = read('../cloudflare/heavy-api/wrangler.production.jsonc');
  assert.match(wrangler, /AI_IMAGE_ALLOWED_ACTIONS[^\n]*profile-extract/);
  const server = read('../cloudflare/heavy-api/src/claude-text.ts');
  assert.match(server, /if \(body\.purpose === 'accessory-search'\) return planAccessorySearch\(env, body, fetchImpl\);/);
});

test('明るい表示の色は Tailwind が拾える形（文字列の組み立てにしない）', () => {
  assert.doesNotMatch(panel, /\$\{LIGHT\}/);
  assert.match(panel, /\[\[data-studio-theme=light\]_&\]:bg-white/);
});
