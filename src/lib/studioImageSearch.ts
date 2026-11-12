/**
 * Fashion Studio の右上「画像検索」の欄の計算部分（画面の部品から切り離した純粋な処理）。
 * 本家 jp.linkaigc.com のスタジオ（AccessoryAgent、2026-11-12 に画面と台本で確認）に合わせている:
 * - たたんだ形は幅 312px・高さ 48px、開くと幅 408px・高さ calc(100vh - 120px)。見出しは「画像検索」、右に
 *   会話の一覧（画像検索履歴）・新しい会話を作成・区切り線・開閉の山形。
 * - 最初は「一致するアクセサリーを探すために、参考画像を1枚選択してください。」と「画像をアップロード」「キャンバスから選択」。
 * - 画像を選ぶと「画像を解析中…」→ 利用者の吹き出し（画像と「この画像に合うアクセサリーをマッチング」）→ 灰色の吹き出しに
 *   12枚の結果（108×144、3列）。指を重ねると暗くなり「キャンバスに送信」と左下の拡大の印。
 * - 下の「高精度検索」を入れると、カテゴリー（バッグ・靴・その他。最初はバッグ）と補足説明（必須・50字まで）が出る。
 *   「さらに検索」は吹き出し「さらに検索」（高精度のときは「<カテゴリー>ディレクトリ内を検索,<説明>」）と次の12枚。
 * - 会話の一覧は 64px の縮小・月日（MM/DD）・時刻（HH:mm）・ごみ箱。最後に「これ以上データがありません」。
 * 本家は自前の画像の倉庫から探す。Heavy は Claude に検索語（英語）を決めさせ、作者とライセンスの付いた公開の画像
 * （Openverse → Wikimedia Commons、referenceImageSearch.ts）から探す。会話はプロジェクトごとにこの端末に残す。
 * どの関数も DOM を使わない（試験から直接呼ぶ）。
 */
import { searchReferenceImages, type FoundImage } from '../features/designDetail/referenceImageSearch.ts';

/** 本家の言葉（言葉の束の日本語のまま）。 */
export const STUDIO_IMAGE_SEARCH_TEXT = {
  title: '画像検索',
  welcome: '一致するアクセサリーを探すために、参考画像を1枚選択してください。',
  upload: '画像をアップロード',
  fromCanvas: 'キャンバスから選択',
  analyzing: '画像を解析中…',
  firstAsk: 'この画像に合うアクセサリーをマッチング',
  searching: '画像を検索中です',
  more: 'さらに検索',
  precise: '高精度検索',
  categoryPlaceholder: 'カテゴリーを選択',
  notePlaceholder: '補足説明（必須）例：麦わら帽子／白いアウトドアスニーカー／赤いレザーハンドバッグ',
  sendToCanvas: 'キャンバスに送信',
  sent: 'キャンバスに送信しました',
  preview: '拡大',
  history: '画像検索履歴',
  historyTooltip: '生成履歴',
  historyEmpty: '履歴がありません',
  historyEnd: 'これ以上データがありません',
  newConversation: '新しい会話を作成',
  collapse: '閉じる',
  expand: '展開',
  failed: '操作が失敗しました。しばらくしてからもう一度お試しください。',
  deleteTitle: '注意',
  deleteBody: 'このファイルを削除しますか？削除後は復元できません',
  cancel: 'キャンセル',
  delete: '削除',
  deleted: '履歴を削除しました',
  notFound: '参考画像が見つかりませんでした',
  noCanvas: 'キャンバスから選べる画像がありません',
} as const;

/** 本家の「高精度検索」のカテゴリー（包包・鞋子・其他。最初は包包＝バッグ）。value はサーバーへ渡す値。 */
export const STUDIO_IMAGE_SEARCH_CATEGORIES = [
  { value: 'bag', label: 'バッグ' },
  { value: 'shoes', label: '靴' },
  { value: 'other', label: 'その他' },
] as const;
export type StudioImageSearchCategory = typeof STUDIO_IMAGE_SEARCH_CATEGORIES[number]['value'];
export const STUDIO_IMAGE_SEARCH_NOTE_MAX = 50;
/** 本家は1回に12枚（3列×4行）。 */
export const STUDIO_IMAGE_SEARCH_ROUND_SIZE = 12;
/** 1回の検索に使う検索語の数（4語×3枚）。Openverse は登録なしで毎分20回まで。 */
export const STUDIO_IMAGE_SEARCH_QUERIES_PER_ROUND = 4;
/** 題名が品物を指さない画像（例: black leather sandals で Blackheath の道路の写真）は、題名の合う画像がこれより少ないときだけ足す。 */
export const STUDIO_IMAGE_SEARCH_MIN_FILL = 6;
/** 本家の結果のタイル（w-27 h-36）。 */
export const STUDIO_IMAGE_SEARCH_TILE = { width: 108, height: 144 } as const;
/** 本家の欄の大きさ。 */
export const STUDIO_IMAGE_SEARCH_SIZE = { collapsedWidth: 312, collapsedHeight: 48, expandedWidth: 408, expandedHeight: 'calc(100vh - 120px)' } as const;
/** この端末に残す会話の数と、会話に残す参照画像の長い辺（JPEG）。 */
export const STUDIO_IMAGE_SEARCH_MAX_CONVERSATIONS = 20;
export const STUDIO_IMAGE_SEARCH_STORED_EDGE = 384;
/** 解析で Claude に送る長い辺。 */
export const STUDIO_IMAGE_SEARCH_ANALYSIS_EDGE = 1024;
/** 本家は解析を最低2秒見せる（Promise.all に2秒の待ちを入れている）。 */
export const STUDIO_IMAGE_SEARCH_MIN_ANALYSIS_MS = 2000;

export type StudioSearchTurn =
  | { id: string; kind: 'ask'; text: string; imageUrl?: string }
  | { id: string; kind: 'results'; images: FoundImage[] };

export type StudioSearchConversation = {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** 参照画像（長い辺 384px の JPEG の data URL）。一覧の縮小と、続きの検索語づくりに使う。 */
  imageUrl: string;
  /** まだ使っていない検索語（前から使う）。 */
  queries: string[];
  /** もう使った検索語（同じ語を Claude に出させない）。 */
  usedQueries: string[];
  turns: StudioSearchTurn[];
};

/** 本家の「さらに検索」の吹き出し: 高精度なら「搜索{{needType}}目录下」と説明を「,」でつなぐ。 */
export function studioSearchAskText(precise?: { category: StudioImageSearchCategory; note: string } | null): string {
  if (!precise || !precise.note.trim()) return STUDIO_IMAGE_SEARCH_TEXT.more;
  const label = STUDIO_IMAGE_SEARCH_CATEGORIES.find((item) => item.value === precise.category)?.label ?? STUDIO_IMAGE_SEARCH_CATEGORIES[0].label;
  return `${label}ディレクトリ内を検索,${precise.note.trim()}`;
}

/** 本家と同じ: 高精度検索のときは説明が空なら押せない。検索中も押せない。 */
export function studioSearchMoreDisabled(state: { busy: boolean; precise: boolean; note: string }): boolean {
  return state.busy || (state.precise && !state.note.trim());
}

/** 会話の次の検索に使う検索語（前から4つ）と、残り。 */
export function nextStudioSearchQueries(conversation: Pick<StudioSearchConversation, 'queries'>, perRound = STUDIO_IMAGE_SEARCH_QUERIES_PER_ROUND) {
  return { queries: conversation.queries.slice(0, perRound), rest: conversation.queries.slice(perRound) };
}

const sameImage = (a: FoundImage, b: FoundImage) => a.id === b.id || (!!a.imageUrl && a.imageUrl === b.imageUrl) || a.thumbUrl === b.thumbUrl;

/** 検索語ごとの結果を1枚ずつ順番に混ぜる（サンダルばかりにしない）。もう出した画像と重なりは飛ばす。 */
export function interleaveStudioSearchResults(lists: readonly FoundImage[][], shown: readonly FoundImage[] = [], total = STUDIO_IMAGE_SEARCH_ROUND_SIZE): FoundImage[] {
  const picked: FoundImage[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let at = 0; at < longest && picked.length < total; at += 1) {
    for (const list of lists) {
      const image = list[at];
      if (!image || shown.some((item) => sameImage(item, image)) || picked.some((item) => sameImage(item, image))) continue;
      picked.push(image);
      if (picked.length >= total) break;
    }
  }
  return picked;
}

/** 会話でもう出した画像（次の検索で同じ画像を出さない）。 */
export function shownStudioSearchImages(conversation: Pick<StudioSearchConversation, 'turns'>): FoundImage[] {
  return conversation.turns.flatMap((turn) => turn.kind === 'results' ? turn.images : []);
}

/**
 * 題名がその検索語の品物を指しているか。検索語は「色・素材・品物」の順（black leather sandals）なので、最後の語
 * （3文字以上）の頭5文字が題名の語の頭にあるかで見る。色だけ（Blackheath の道路の写真）や素材だけでは合わない。
 */
export function studioSearchTitleNamesItem(title: string, query: string): boolean {
  const words = query.toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 3);
  const item = words[words.length - 1];
  if (!item) return true;
  return new RegExp(`(^|[^a-z])${item.slice(0, 5)}`).test(title.toLowerCase().replace(/[_-]+/g, ' '));
}

type SearchFn = typeof searchReferenceImages;
/**
 * 1回分（12枚）を探す。検索語ごとに並べて探し（多めに取って重なりを除く）、1枚ずつ混ぜる。本家の結果は全部が
 * アクセサリーなので、題名が品物（検索語の最後の語）を指す画像だけを並べ、それが6枚に届かないときだけ残りで埋める。
 * 全部の検索語が失敗したときだけ失敗にする（一部の失敗は残りで埋める）。
 */
export async function searchStudioAccessoryRound(queries: readonly string[], options: { shown?: readonly FoundImage[]; signal?: AbortSignal; search?: SearchFn; total?: number } = {}): Promise<FoundImage[]> {
  const total = options.total ?? STUDIO_IMAGE_SEARCH_ROUND_SIZE;
  if (!queries.length) return [];
  const shown = options.shown ?? [];
  // 同じ会話で前に出した画像を飛ばしても足りるように、出した数に応じて深く取る（Openverse は1回20件まで）。
  const perQuery = Math.min(7, Math.ceil(total / queries.length) + 2 + Math.ceil(shown.length / Math.max(1, queries.length * 3)));
  const settled = await Promise.allSettled(queries.map((query) => (options.search ?? searchReferenceImages)(query, { limit: perQuery, signal: options.signal })));
  if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
  if (settled.every((result) => result.status === 'rejected')) throw (settled[0] as PromiseRejectedResult).reason;
  const lists = settled.map((result) => result.status === 'fulfilled' ? result.value : []);
  const named = lists.map((list, at) => list.filter((image) => studioSearchTitleNamesItem(image.title, queries[at])));
  const spare = lists.map((list, at) => list.filter((image) => !named[at].includes(image)));
  const picked = interleaveStudioSearchResults(named, shown, total);
  const fill = Math.min(total, STUDIO_IMAGE_SEARCH_MIN_FILL) - picked.length;
  return fill > 0 ? [...picked, ...interleaveStudioSearchResults(spare, [...shown, ...picked], fill)] : picked;
}

// ── この端末に残す会話 ─────────────────────────────────────────────────────────────────────────────────────────────
export const studioImageSearchStorageKey = (projectId: string) => `heavy:studio-image-search:v1:${projectId}`;
type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem' | 'removeItem'>;

const isText = (value: unknown): value is string => typeof value === 'string';
const validImage = (value: unknown): value is FoundImage => !!value && typeof value === 'object'
  && isText((value as FoundImage).id) && isText((value as FoundImage).thumbUrl) && /^https:\/\//.test((value as FoundImage).thumbUrl)
  && isText((value as FoundImage).title) && isText((value as FoundImage).pageUrl) && isText((value as FoundImage).license);
function validTurn(value: unknown): StudioSearchTurn | null {
  if (!value || typeof value !== 'object' || !isText((value as StudioSearchTurn).id)) return null;
  const turn = value as StudioSearchTurn;
  if (turn.kind === 'ask' && isText(turn.text)) return { id: turn.id, kind: 'ask', text: turn.text, ...(isText(turn.imageUrl) ? { imageUrl: turn.imageUrl } : {}) };
  if (turn.kind === 'results' && Array.isArray(turn.images)) return { id: turn.id, kind: 'results', images: turn.images.filter(validImage) };
  return null;
}

/** 新しい順に並べた会話。壊れた行は捨てる（読めないときは空）。 */
export function loadStudioSearchConversations(storage: ReadStorage | null | undefined, projectId: string): StudioSearchConversation[] {
  let raw: string | null = null;
  try { raw = storage?.getItem(studioImageSearchStorageKey(projectId)) ?? null; } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const list = parsed.flatMap((item): StudioSearchConversation[] => {
    if (!item || typeof item !== 'object') return [];
    const value = item as StudioSearchConversation;
    if (!isText(value.id) || !Number.isFinite(value.createdAt) || !isText(value.imageUrl) || !Array.isArray(value.turns)) return [];
    return [{ id: value.id, createdAt: value.createdAt, updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : value.createdAt, imageUrl: value.imageUrl,
      queries: Array.isArray(value.queries) ? value.queries.filter(isText) : [], usedQueries: Array.isArray(value.usedQueries) ? value.usedQueries.filter(isText) : [],
      turns: value.turns.map(validTurn).filter((turn): turn is StudioSearchTurn => !!turn) }];
  });
  return list.sort((a, b) => b.createdAt - a.createdAt).slice(0, STUDIO_IMAGE_SEARCH_MAX_CONVERSATIONS);
}

/** 残す。入りきらないとき（容量の上限）は古い会話から捨てて入れ直す。残せた会話を返す。 */
export function saveStudioSearchConversations(storage: WriteStorage | null | undefined, projectId: string, conversations: readonly StudioSearchConversation[]): StudioSearchConversation[] {
  let list = [...conversations].sort((a, b) => b.createdAt - a.createdAt).slice(0, STUDIO_IMAGE_SEARCH_MAX_CONVERSATIONS);
  if (!storage) return list;
  const key = studioImageSearchStorageKey(projectId);
  for (;;) {
    try {
      if (list.length) storage.setItem(key, JSON.stringify(list)); else storage.removeItem(key);
      return list;
    } catch {
      if (!list.length) return list;
      list = list.slice(0, -1);
    }
  }
}

/** 会話を入れ替える（無ければ先頭に足す）。新しい順・上限つき。 */
export function upsertStudioSearchConversation(list: readonly StudioSearchConversation[], conversation: StudioSearchConversation): StudioSearchConversation[] {
  return [conversation, ...list.filter((item) => item.id !== conversation.id)].sort((a, b) => b.createdAt - a.createdAt).slice(0, STUDIO_IMAGE_SEARCH_MAX_CONVERSATIONS);
}

export function removeStudioSearchConversation(list: readonly StudioSearchConversation[], id: string): StudioSearchConversation[] {
  return list.filter((item) => item.id !== id);
}

/** 一覧の「11/12」「18:30」（本家の MM/DD と HH:mm、この端末の時刻）。 */
export function studioSearchHistoryStamp(ms: number): { date: string; time: string } {
  if (!Number.isFinite(ms)) return { date: '--', time: '--' };
  const at = new Date(ms);
  const two = (value: number) => String(value).padStart(2, '0');
  return { date: `${two(at.getMonth() + 1)}/${two(at.getDate())}`, time: `${two(at.getHours())}:${two(at.getMinutes())}` };
}

/** 吹き出しや結果の一意な名札。 */
export const studioSearchId = (prefix: string, now = Date.now(), random = Math.random()) => `${prefix}-${now.toString(36)}-${Math.floor(random * 1e8).toString(36)}`;
