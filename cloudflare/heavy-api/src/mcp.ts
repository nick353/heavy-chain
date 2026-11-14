/**
 * MCP（Model Context Protocol）の入口。ChatGPT・Claude・Cursor など、どの MCP クライアントからでも
 * Heavy Chain の機能を呼べるようにする。
 *
 * 作りの決め事（2026-11-14、オーナーの依頼「MCP化して、ChatGPTからも使えるようにしたい」「全て汎用的に使えるように」）:
 * - 通信は streamable HTTP の「単一 JSON レスポンス」だけ。MCP 仕様 2025-11-25 の transports が
 *   `Content-Type: application/json` を明示的に許しているので、SSE も MCP-Session-Id も使わない。
 *   状態を持たないので Durable Objects も要らない。
 * - ツールの中身は、この Worker 自身の /v1/... を内部で呼ぶ。認証・ブランドの役割・月や日の上限・
 *   冪等の仕組みが全部そのまま効くので、画面から使ったときと必ず同じ結果になる。
 * - 既存の経路は何も変えない。/mcp を足すだけ。
 * - 読み取りのツールには readOnlyHint を付ける。これが無いツールは ChatGPT 側で「書き込み」として
 *   毎回の確認が出る（ChatGPT の custom MCP server の仕様）。生成（create_design）は、わざと
 *   readOnlyHint を付けない。生成の枠を使うので、クライアント側の毎回の確認を残すのが正しい。
 */
import type { Env } from './index.ts';
import { grantCoversResource, looksLikeMcpAccessToken, MCP_SCOPE, resolveMcpAccessToken, resourceMetadataUrl } from './mcp-oauth.ts';

/** この Worker 自身の /v1/... を内部で呼ぶ。index.ts が handleRequest を包んで渡す。 */
export type ApiCall = (request: Request) => Promise<Response>;

const MCP_PATH = '/mcp';
/** 対応する MCP の版。クライアントが送ってきた版がこの中にあればそれを返す（仕様の作法）。 */
const SUPPORTED_PROTOCOLS = new Set(['2025-11-25', '2025-06-18', '2025-03-26']);
/** クライアントが知らない版を送ってきたときに返す既定。 */
const DEFAULT_PROTOCOL = '2025-06-18';
const SERVER_NAME = 'heavy-chain';
const SERVER_TITLE = 'Heavy Chain';
const SERVER_VERSION = '1.0.0';
/** JSON-RPC 1件の上限。画像は URL で返すので本文は小さい。 */
const MAX_BODY_BYTES = 262_144;
/** ツールの返りの上限。クライアントの文脈を食いつぶさないために切る。 */
const MAX_RESULT_CHARS = 60_000;
/** 署名つき画像 URL の有効時間。/v1/media/read の上限に合わせる。 */
const IMAGE_URL_TTL_SECONDS = 3600;
/** 1回の list_designs で作る署名つき URL の本数。 */
const MAX_IMAGE_URLS = 5;

/** 複数枚の構成を考えるときの種類（src/claude-text.ts の IMAGE_PLAN_TASKS と同じ）。 */
const PLAN_TASKS = ['banner', 'design-gacha', 'product-shots', 'variations', 'scene', 'colorize', 'background'];
/** 着せ替えで選べる体型と年代（src/image-ai-contracts.ts の BODY_TYPES・AGES と同じ）。 */
const BODY_TYPES = ['slim', 'regular', 'plus'];
const AGE_GROUPS = ['20s', '30s', '40s', '50s'];
/** 参考画像の上限。本番の OpenAI 経路は 1536px・3MB まで受ける（OPENAI_REFERENCE_SIDE）。 */
const MAX_REFERENCE_BYTES = 3 * 1024 * 1024;
/** 画面と同じアスペクト比の一覧（src/image-ai-contracts.ts の ratios と同じ並び）。 */
const ASPECT_RATIOS = ['1:1', '3:4', '4:3', '4:5', '5:4', '16:9', '9:16', '2:3', '3:2'];
/** 画質の一覧（2k が既定）。 */
const RESOLUTIONS = ['1k', '2k', '4k'];

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const INSTRUCTIONS = [
  'Heavy Chain はアパレル（服・雑貨）向けの AI デザインアプリです。',
  'どのツールも、まず list_brands でブランドの id を取り brand_id に渡します。',
  '絵を描くのは create_design（新しく）・edit_design（あるものを直す）・create_model_shots（人が着ている絵）の3つで、どれも生成の枠を使います。呼ぶ前に内容をユーザーに読み上げて了解を取り、始めたら get_design_request で仕上がりを取ってください。',
  'edit_design と create_model_shots には list_designs で取ったデザインの id が必要です。',
  'improve_prompt と plan_design_set は文章を考えるだけで、絵は描きません。',
  'search_products には list_projects で取った project_id も必要です。',
  'list_designs の with_image_urls: true は1時間だけ有効な画像 URL を返します。保存せず取り直してください。',
].join('');

type JsonRpcId = string | number | null;

interface RpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

interface ToolResult {
  text: string;
  isError?: boolean;
}

interface ToolContext {
  api: ApiCall;
  /** 内部 Request の組み立てに使う、この Worker 自身の origin。 */
  origin: string;
  /** クライアントが送ってきた Authorization をそのまま内部呼び出しに渡す。 */
  authorization: string;
  /** 参考画像のバイトを R2 から読むためだけに使う。権限は必ず先に /v1/... で確かめる。 */
  env: Env;
}

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  /** 外のサービス（Openverse・Yahoo!ショッピング）を見に行くツールかどうか。 */
  openWorld?: boolean;
  run(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

function jsonResponse(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(body), { status, headers });
}

function rpcError(id: JsonRpcId, code: number, message: string, status = 200): Response {
  return jsonResponse({ jsonrpc: '2.0', id, error: { code, message } }, status);
}

function rpcResult(id: JsonRpcId, result: unknown): Response {
  return jsonResponse({ jsonrpc: '2.0', id, result });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, max = 256): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function wholeNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return null;
  return value;
}

/** ツールの返りを読みやすい text にする。長すぎるものは切り、切ったことを書く。 */
function describe(data: unknown): string {
  const body = JSON.stringify(data, null, 2) ?? 'null';
  if (body.length <= MAX_RESULT_CHARS) return body;
  return `${body.slice(0, MAX_RESULT_CHARS)}\n\n（長いのでここで切りました。件数を絞って呼び直してください）`;
}

interface ApiReply {
  ok: boolean;
  status: number;
  data: unknown;
}

/**
 * この Worker 自身の /v1/... を内部で呼ぶ。Authorization をそのまま渡すので、
 * 画面から呼んだときと同じ認証・権限・上限を通る。
 */
async function callApi(
  context: ToolContext,
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiReply> {
  const headers = new Headers({ authorization: context.authorization });
  for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const response = await context.api(new Request(new URL(path, context.origin), {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  }));
  const raw = await response.text();
  let data: unknown = raw;
  if (raw.length > 0) {
    try { data = JSON.parse(raw); } catch { /* JSON でない返りはそのまま文字列で渡す。 */ }
  }
  return { ok: response.ok, status: response.status, data };
}

/** API の失敗を、モデルが次の手を選べる形の text にする。 */
function apiFailure(name: string, reply: ApiReply): ToolResult {
  const code = isRecord(reply.data) && typeof reply.data.error === 'string' ? reply.data.error : null;
  const hint = reply.status === 401
    ? 'Heavy Chain にサインインし直してください。'
    : reply.status === 404
      ? 'id が違うか、そのブランド・プロジェクトを見る権限がありません。list_brands と list_projects で確かめてください。'
      : reply.status === 403
        ? 'そのブランドでの権限が足りません。list_brands で使えるブランドを確かめてください。'
        : reply.status === 429
          ? '呼び出しが多すぎます。少し待ってから試してください。'
          : 'しばらく待ってから試すか、heavychain.app の画面で確かめてください。';
  return {
    isError: true,
    text: `${name} は失敗しました（HTTP ${reply.status}${code ? ` / ${code}` : ''}）。${hint}`,
  };
}

/**
 * 自分のデザインを、生成の参考に渡せる base64 にする。
 * 所有の確認は必ず /v1/generated-images/{id}（所有者だけ 200）で先に通し、
 * R2 は確認が通ったあとの storage_path だけを読む。
 */
async function designAsBase64(context: ToolContext, imageId: string): Promise<{ data: string; contentType: string } | { error: string }> {
  const reply = await callApi(context, 'GET', `/v1/generated-images/${encodeURIComponent(imageId)}`);
  if (!reply.ok || !isRecord(reply.data)) {
    return { error: `デザイン ${imageId} が見つかりません。list_designs で id を確かめてください（他の人のデザインは使えません）。` };
  }
  const path = typeof reply.data.storage_path === 'string' ? reply.data.storage_path : null;
  if (!path) return { error: `デザイン ${imageId} には画像の実体がまだありません。` };
  const object = await context.env.PRIVATE_MEDIA.get(path);
  if (!object) return { error: `デザイン ${imageId} の画像が保管庫にありません。生成が終わっているか get_design_request で確かめてください。` };
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength === 0) return { error: `デザイン ${imageId} の画像が空です。` };
  if (bytes.byteLength > MAX_REFERENCE_BYTES) return { error: `デザイン ${imageId} の画像が大きすぎます（参考に渡せるのは 3MB までです）。` };
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  // 型は保管庫の記録を使い、無ければバイトの先頭で見る（decodeImage も imageBlock も型の一致を見る）。
  const stored = typeof object.httpMetadata?.contentType === 'string' ? object.httpMetadata.contentType : '';
  const sniffed = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/png';
  const contentType = stored === 'image/png' || stored === 'image/jpeg' ? stored : sniffed;
  return { data: btoa(binary), contentType };
}

/** /v1/media/read で1時間だけ有効な画像 URL を作る。失敗しても一覧そのものは返す。 */
async function signedImageUrl(context: ToolContext, storagePath: string): Promise<string | null> {
  const path = `/v1/media/read?bucket=generated-images&path=${encodeURIComponent(storagePath)}&expiresIn=${IMAGE_URL_TTL_SECONDS}`;
  const reply = await callApi(context, 'GET', path);
  if (!reply.ok || !isRecord(reply.data) || typeof reply.data.url !== 'string') return null;
  return reply.data.url;
}

/** 生成のツールが共通で受ける設定。count を使わない着せ替えでは、その行だけ外して使う。 */
const IMAGE_OPTIONS_SCHEMA = {
  aspect_ratio: { type: 'string', enum: ASPECT_RATIOS, description: 'The shape of the image.' },
  count: { type: 'integer', minimum: 1, maximum: 4, description: 'How many variations to draw. Each one spends quota. Default 1.' },
  resolution: { type: 'string', enum: RESOLUTIONS, description: 'Image size. Default 2k.' },
  negative_prompt: { type: 'string', description: 'What to keep out of the picture.' },
  style: { type: 'string', description: 'A style note, for example "flat vector" or "watercolour".' },
} as const;
const { count: _countSchema, ...IMAGE_OPTIONS_WITHOUT_COUNT } = IMAGE_OPTIONS_SCHEMA;

/** 生成の共通の設定（形・枚数・画質・避けたいもの・画風）を読んで body に足す。 */
function applyImageOptions(input: Record<string, unknown>, body: Record<string, unknown>): string | null {
  if (input.aspect_ratio !== undefined) {
    const ratio = text(input.aspect_ratio, 8);
    if (!ratio || !ASPECT_RATIOS.includes(ratio)) return `aspect_ratio は ${ASPECT_RATIOS.join('・')} のどれかです。`;
    body.aspectRatio = ratio;
  }
  if (input.count !== undefined) {
    const count = wholeNumber(input.count, 1, 4);
    if (count === null) return 'count は 1 から 4 までの整数です。';
    body.count = count;
  }
  if (input.resolution !== undefined) {
    const resolution = text(input.resolution, 4);
    if (!resolution || !RESOLUTIONS.includes(resolution)) return `resolution は ${RESOLUTIONS.join('・')} のどれかです。`;
    body.resolution = resolution;
  }
  for (const [key, field, max] of [['negative_prompt', 'negativePrompt', 2_000], ['style', 'style', 500]] as const) {
    if (input[key] === undefined) continue;
    const value = text(input[key], max);
    if (!value) return `${key} は 1〜${max} 字の文字です。`;
    body[field] = value;
  }
  return null;
}

/** 生成を始める。返りは追跡用の request_id つきの text。 */
async function startGeneration(
  context: ToolContext,
  name: string,
  action: 'generate-image' | 'edit-image' | 'model-matrix',
  body: Record<string, unknown>,
): Promise<ToolResult> {
  const requestId = crypto.randomUUID();
  const reply = await callApi(context, 'POST', `/v1/provider-actions/${action}`, {
    body,
    headers: { 'idempotency-key': requestId },
  });
  if (!reply.ok) {
    const code = isRecord(reply.data) && typeof reply.data.error === 'string' ? reply.data.error : '';
    if (code.startsWith('legal_safety_prompt_blocked')) {
      return { isError: true, text: 'その文章では描けません。他社のロゴやブランドを真似る指示、実在の人物に似せる指示が入っていると断られます。文章を変えて呼び直してください。' };
    }
    if (code.startsWith('image_reference') || code === 'invalid_image_bytes') {
      return { isError: true, text: `参考にした画像が使えませんでした（${code}）。別のデザインを選ぶか、list_designs で新しいものを探してください。` };
    }
    if (code.startsWith('heavy_') && reply.status === 403) {
      return { isError: true, text: `生成が許されませんでした（${code}）。get_usage で枠の残りを確かめ、ブランドの権限が editor 以上かも見てください。` };
    }
    return apiFailure(name, reply);
  }
  return { text: `生成を始めました。request_id: ${requestId}\n\n${describe(reply.data)}\n\n仕上がりは get_design_request にこの request_id を渡すと分かります。` };
}

const TOOLS: Tool[] = [
  {
    name: 'list_brands',
    title: 'ブランドの一覧',
    description: 'Use this first, whenever another tool needs a brand_id. Returns the Heavy Chain brands this account can use, with their ids and names.',
    readOnly: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(_input, context) {
      const reply = await callApi(context, 'GET', '/v1/brands');
      if (!reply.ok) return apiFailure('list_brands', reply);
      return { text: describe(reply.data) };
    },
  },
  {
    name: 'list_projects',
    title: 'プロジェクトの一覧',
    description: 'Use this when a tool needs a project_id, or when the user asks what they are working on. Returns the design projects (canvas documents) of one brand.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', description: 'The brand id from list_brands.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many to return. Default 20.' },
      },
      required: ['brand_id'],
      additionalProperties: false,
    },
    async run(input, context) {
      const brand = text(input.brand_id, 128);
      if (!brand || !ID_PATTERN.test(brand)) return { isError: true, text: 'brand_id が正しくありません。list_brands で取った id を渡してください。' };
      const limit = input.limit === undefined ? 20 : wholeNumber(input.limit, 1, 50);
      if (limit === null) return { isError: true, text: 'limit は 1 から 50 までの整数です。' };
      const reply = await callApi(context, 'GET', `/v1/canvas-documents?brand_id=${encodeURIComponent(brand)}&limit=${limit}`);
      if (!reply.ok) return apiFailure('list_projects', reply);
      return { text: describe(reply.data) };
    },
  },
  {
    name: 'list_designs',
    title: '作ったデザインの一覧',
    description: 'Use this when the user asks what designs they have made, or wants to see or reuse an earlier design. Returns generated images of one brand, newest first. Set with_image_urls to true to also get links that show the pictures.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', description: 'The brand id from list_brands.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many to return. Default 10.' },
        order: { type: 'string', enum: ['newest', 'oldest'], description: 'Default newest.' },
        favorite: { type: 'boolean', description: 'Only the designs the user marked as favorite.' },
        with_image_urls: { type: 'boolean', description: `Add a one-hour link for up to ${MAX_IMAGE_URLS} of the returned designs. Default false.` },
      },
      required: ['brand_id'],
      additionalProperties: false,
    },
    async run(input, context) {
      const brand = text(input.brand_id, 128);
      if (!brand || !ID_PATTERN.test(brand)) return { isError: true, text: 'brand_id が正しくありません。list_brands で取った id を渡してください。' };
      const limit = input.limit === undefined ? 10 : wholeNumber(input.limit, 1, 50);
      if (limit === null) return { isError: true, text: 'limit は 1 から 50 までの整数です。' };
      const order = input.order === undefined ? 'newest' : text(input.order, 16);
      if (order !== 'newest' && order !== 'oldest') return { isError: true, text: "order は 'newest' か 'oldest' です。" };
      if (input.favorite !== undefined && typeof input.favorite !== 'boolean') return { isError: true, text: 'favorite は true か false です。' };
      if (input.with_image_urls !== undefined && typeof input.with_image_urls !== 'boolean') {
        return { isError: true, text: 'with_image_urls は true か false です。' };
      }
      const query = new URLSearchParams({ brand_id: brand, limit: String(limit), order });
      if (typeof input.favorite === 'boolean') query.set('favorite', String(input.favorite));
      const reply = await callApi(context, 'GET', `/v1/generated-images?${query}`);
      if (!reply.ok) return apiFailure('list_designs', reply);
      if (input.with_image_urls !== true || !Array.isArray(reply.data)) return { text: describe(reply.data) };

      const rows = reply.data as Array<Record<string, unknown>>;
      const withUrls: unknown[] = [];
      let made = 0;
      for (const row of rows) {
        const storagePath = typeof row.storage_path === 'string' ? row.storage_path : null;
        if (!storagePath || made >= MAX_IMAGE_URLS) { withUrls.push(row); continue; }
        made += 1;
        const url = await signedImageUrl(context, storagePath);
        withUrls.push(url ? { ...row, image_url_signed: url } : row);
      }
      return { text: describe(withUrls) };
    },
  },
  {
    name: 'get_design_request',
    title: 'デザイン生成の進み具合',
    description: 'Use this to check a design generation started earlier, with the request id it returned. While it is still running the state is "running"; when it finishes the result carries the image links.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { request_id: { type: 'string', description: 'The UUID returned when the generation was requested.' } },
      required: ['request_id'],
      additionalProperties: false,
    },
    async run(input, context) {
      const id = text(input.request_id, 64);
      if (!id || !UUID_PATTERN.test(id)) return { isError: true, text: 'request_id は UUID です。' };
      const reply = await callApi(context, 'GET', `/v1/image-ai/requests/${encodeURIComponent(id)}`);
      if (!reply.ok) return apiFailure('get_design_request', reply);
      return { text: describe(reply.data) };
    },
  },
  {
    name: 'get_usage',
    title: '生成の使用量と残り',
    description: 'Use this before asking for a new generation, or when the user asks how much they have used. Returns this brand\'s image generation usage against its monthly and daily limits.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { brand_id: { type: 'string', description: 'The brand id from list_brands.' } },
      required: ['brand_id'],
      additionalProperties: false,
    },
    async run(input, context) {
      const brand = text(input.brand_id, 128);
      if (!brand || !ID_PATTERN.test(brand)) return { isError: true, text: 'brand_id が正しくありません。list_brands で取った id を渡してください。' };
      const reply = await callApi(context, 'GET', `/v1/image-ai/usage?brand_id=${encodeURIComponent(brand)}`);
      if (!reply.ok) return apiFailure('get_usage', reply);
      return { text: describe(reply.data) };
    },
  },
  {
    name: 'search_reference_images',
    title: '参考画像を探す',
    description: 'Use this when the user wants reference pictures or visual inspiration for a design. Searches Openverse, which only holds openly licensed images. Returns the pictures with their licence and source.',
    readOnly: true,
    openWorld: true,
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'What to look for, in English (Openverse indexes English text).' },
        page_size: { type: 'integer', minimum: 1, maximum: 20, description: 'How many to return. Default 10.' },
      },
      required: ['q'],
      additionalProperties: false,
    },
    async run(input, context) {
      const query = text(input.q, 200);
      if (!query) return { isError: true, text: 'q に探したい言葉を入れてください。' };
      const size = input.page_size === undefined ? 10 : wholeNumber(input.page_size, 1, 20);
      if (size === null) return { isError: true, text: 'page_size は 1 から 20 までの整数です。' };
      const search = new URLSearchParams({ q: query, page_size: String(size) });
      const reply = await callApi(context, 'GET', `/v1/openverse/images?${search}`);
      if (!reply.ok) return apiFailure('search_reference_images', reply);
      return { text: describe(reply.data) };
    },
  },
  {
    name: 'search_products',
    title: '実在の商品を探す',
    description: 'Use this when the user wants real products on sale for a planning task, for example to compare prices or see what competitors sell. Searches Yahoo!ショッピング and returns real items with their price, shop and link. Japanese keywords work best.',
    readOnly: true,
    openWorld: true,
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', description: 'The brand id from list_brands.' },
        project_id: { type: 'string', description: 'The project id from list_projects.' },
        queries: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 4,
          description: 'One to four search phrases, in Japanese. Each one should cover a different angle.',
        },
      },
      required: ['brand_id', 'project_id', 'queries'],
      additionalProperties: false,
    },
    async run(input, context) {
      const brand = text(input.brand_id, 128);
      const project = text(input.project_id, 128);
      if (!brand || !ID_PATTERN.test(brand)) return { isError: true, text: 'brand_id が正しくありません。list_brands で取った id を渡してください。' };
      if (!project || !ID_PATTERN.test(project)) return { isError: true, text: 'project_id が正しくありません。list_projects で取った id を渡してください。' };
      const queries = Array.isArray(input.queries) ? input.queries : null;
      if (!queries || queries.length < 1 || queries.length > 4) return { isError: true, text: 'queries は1〜4個の言葉の配列です。' };
      const searches: Array<{ query: string }> = [];
      for (const entry of queries) {
        const query = text(entry, 100);
        if (!query) return { isError: true, text: 'queries の中に空の言葉があります。' };
        searches.push({ query });
      }
      const reply = await callApi(context, 'POST', '/v1/design-assistant/products', {
        body: { brandId: brand, projectId: project, searches },
      });
      if (!reply.ok) return apiFailure('search_products', reply);
      return { text: describe(reply.data) };
    },
  },
  {
    name: 'create_design',
    title: 'デザインを生成する',
    description: 'Use this to generate a new apparel design image from a written description. It spends the brand\'s generation quota, so read the prompt back to the user and get their go-ahead before calling it. The drawing runs in the background: this returns a request_id straight away, and get_design_request then reports the progress and the finished image links.',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', description: 'The brand id from list_brands.' },
        prompt: { type: 'string', description: 'What to draw, in English or Japanese. Describe the garment, the artwork and the mood. Do not ask for another company\'s logo or brand, or for a real person\'s likeness: the server refuses those.' },
        ...IMAGE_OPTIONS_SCHEMA,
      },
      required: ['brand_id', 'prompt'],
      additionalProperties: false,
    },
    async run(input, context) {
      const brand = text(input.brand_id, 128);
      if (!brand || !ID_PATTERN.test(brand)) return { isError: true, text: 'brand_id が正しくありません。list_brands で取った id を渡してください。' };
      const prompt = text(input.prompt, 12_000);
      if (!prompt) return { isError: true, text: 'prompt に描きたいものを書いてください（12000字まで）。' };
      const body: Record<string, unknown> = { brandId: brand, prompt };
      const problem = applyImageOptions(input, body);
      if (problem) return { isError: true, text: problem };
      return startGeneration(context, 'create_design', 'generate-image', body);
    },
  },
  {
    name: 'edit_design',
    title: 'デザインを直す',
    description: 'Use this to change a design that already exists: recolour it, swap the artwork, change the garment, extend it. Name the design with source_design_id (from list_designs or a finished create_design) and say what to change in prompt. It spends the brand\'s generation quota, so get the user\'s go-ahead first. Returns a request_id; get_design_request then reports the result.',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', description: 'The brand id from list_brands.' },
        source_design_id: { type: 'string', description: 'The design to change, from list_designs. It must be one of this account\'s own designs.' },
        prompt: { type: 'string', description: 'What to change, in English or Japanese. Describe the change, not the whole picture again.' },
        ...IMAGE_OPTIONS_SCHEMA,
      },
      required: ['brand_id', 'source_design_id', 'prompt'],
      additionalProperties: false,
    },
    async run(input, context) {
      const brand = text(input.brand_id, 128);
      if (!brand || !ID_PATTERN.test(brand)) return { isError: true, text: 'brand_id が正しくありません。list_brands で取った id を渡してください。' };
      const source = text(input.source_design_id, 128);
      if (!source || !ID_PATTERN.test(source)) return { isError: true, text: 'source_design_id が正しくありません。list_designs で取った id を渡してください。' };
      const prompt = text(input.prompt, 12_000);
      if (!prompt) return { isError: true, text: 'prompt にどう直したいかを書いてください（12000字まで）。' };
      const reference = await designAsBase64(context, source);
      if ('error' in reference) return { isError: true, text: reference.error };
      const body: Record<string, unknown> = { brandId: brand, prompt, imageUrls: [reference.data] };
      const problem = applyImageOptions(input, body);
      if (problem) return { isError: true, text: problem };
      return startGeneration(context, 'edit_design', 'edit-image', body);
    },
  },
  {
    name: 'create_model_shots',
    title: '人が着ている絵を作る',
    description: 'Use this to show a design worn by a person: pick the garment with garment_design_id and the server draws it on a model. One call draws up to three combinations of body type and age group, and each one spends quota, so get the user\'s go-ahead first. Returns a request_id; get_design_request then reports the result.',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', description: 'The brand id from list_brands.' },
        garment_design_id: { type: 'string', description: 'The garment to put on the model, from list_designs. One of this account\'s own designs.' },
        description: { type: 'string', description: 'What the garment is, in English or Japanese. Leave it out to keep the garment exactly as drawn.' },
        model_design_id: { type: 'string', description: 'Optional. Another of this account\'s designs to use as the model reference.' },
        body_types: { type: 'array', items: { type: 'string', enum: BODY_TYPES }, minItems: 1, maxItems: 3, description: 'Body types to draw. Default ["regular"]. body_types x age_groups must be 3 or fewer.' },
        age_groups: { type: 'array', items: { type: 'string', enum: AGE_GROUPS }, minItems: 1, maxItems: 3, description: 'Age groups to draw. Default ["20s"].' },
        gender: { type: 'string', enum: ['male', 'female', 'auto'], description: 'Default female.' },
        skin_tone: { type: 'string', enum: ['light', 'medium', 'dark'] },
        hair_style: { type: 'string', enum: ['short', 'medium', 'long'] },
        ...IMAGE_OPTIONS_WITHOUT_COUNT,
      },
      required: ['brand_id', 'garment_design_id'],
      additionalProperties: false,
    },
    async run(input, context) {
      const brand = text(input.brand_id, 128);
      if (!brand || !ID_PATTERN.test(brand)) return { isError: true, text: 'brand_id が正しくありません。list_brands で取った id を渡してください。' };
      const garment = text(input.garment_design_id, 128);
      if (!garment || !ID_PATTERN.test(garment)) return { isError: true, text: 'garment_design_id が正しくありません。list_designs で取った id を渡してください。' };
      const body: Record<string, unknown> = { brandId: brand };
      const garmentImage = await designAsBase64(context, garment);
      if ('error' in garmentImage) return { isError: true, text: garmentImage.error };
      body.imageUrl = garmentImage.data;
      if (input.model_design_id !== undefined) {
        const model = text(input.model_design_id, 128);
        if (!model || !ID_PATTERN.test(model)) return { isError: true, text: 'model_design_id が正しくありません。list_designs で取った id を渡してください。' };
        const modelImage = await designAsBase64(context, model);
        if ('error' in modelImage) return { isError: true, text: modelImage.error };
        body.modelReferenceImageUrl = modelImage.data;
      }
      if (input.description !== undefined) {
        const description = text(input.description, 12_000);
        if (!description) return { isError: true, text: 'description は 1〜12000 字の文字です。' };
        body.productDescription = description;
      }
      // 体型 x 年代は掛け算で3通りまで（サーバーの invalid_fitting_options と同じ上限）。
      for (const [key, field, allowed] of [['body_types', 'bodyTypes', BODY_TYPES], ['age_groups', 'ageGroups', AGE_GROUPS]] as const) {
        if (input[key] === undefined) continue;
        const values = Array.isArray(input[key]) ? input[key] as unknown[] : null;
        if (!values || values.length < 1 || values.length > 3) return { isError: true, text: `${key} は1〜3個の配列です。` };
        const picked: string[] = [];
        for (const entry of values) {
          const value = text(entry, 8);
          if (!value || !allowed.includes(value)) return { isError: true, text: `${key} に使えるのは ${allowed.join('・')} です。` };
          if (picked.includes(value)) return { isError: true, text: `${key} に同じものが2回入っています。` };
          picked.push(value);
        }
        body[field] = picked;
      }
      const combinations = (Array.isArray(body.bodyTypes) ? body.bodyTypes.length : 1) * (Array.isArray(body.ageGroups) ? body.ageGroups.length : 1);
      if (combinations > 3) return { isError: true, text: `body_types と age_groups の組み合わせは3通りまでです（今は ${combinations} 通り）。` };
      const singles: Array<[string, string, readonly string[]]> = [
        ['gender', 'gender', ['male', 'female', 'auto']],
        ['skin_tone', 'skinTone', ['light', 'medium', 'dark']],
        ['hair_style', 'hairStyle', ['short', 'medium', 'long']],
      ];
      for (const [key, field, allowed] of singles) {
        if (input[key] === undefined) continue;
        const value = text(input[key], 8);
        if (!value || !allowed.includes(value)) return { isError: true, text: `${key} に使えるのは ${allowed.join('・')} です。` };
        body[field] = value;
      }
      const problem = applyImageOptions(input, body);
      if (problem) return { isError: true, text: problem };
      return startGeneration(context, 'create_model_shots', 'model-matrix', body);
    },
  },
  {
    name: 'improve_prompt',
    title: '生成の文章を整える',
    description: 'Use this to turn a rough idea into a prompt that suits Heavy Chain\'s image model, before calling create_design. It returns the rewritten prompt and does not draw anything or spend image quota. It does call a text model, so use it when the wording matters, not on every request.',
    readOnly: true,
    openWorld: true,
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', description: 'The brand id from list_brands.' },
        prompt: { type: 'string', description: 'The rough idea, in English or Japanese.' },
        style: { type: 'string', description: 'The look to aim for. Default "professional fashion photography".' },
        target_platform: { type: 'string', description: 'Where the image will be used, for example "Instagram" or "Etsy listing".' },
      },
      required: ['brand_id', 'prompt'],
      additionalProperties: false,
    },
    async run(input, context) {
      const brand = text(input.brand_id, 128);
      if (!brand || !ID_PATTERN.test(brand)) return { isError: true, text: 'brand_id が正しくありません。list_brands で取った id を渡してください。' };
      const prompt = text(input.prompt, 4_000);
      if (!prompt) return { isError: true, text: 'prompt に整えたい文章を書いてください（4000字まで）。' };
      const body: Record<string, unknown> = { brandId: brand, prompt };
      for (const [key, field] of [['style', 'style'], ['target_platform', 'targetPlatform']] as const) {
        if (input[key] === undefined) continue;
        const value = text(input[key], 200);
        if (!value) return { isError: true, text: `${key} は 1〜200 字の文字です。` };
        body[field] = value;
      }
      const reply = await callApi(context, 'POST', '/v1/provider-actions/optimize-prompt', { body });
      if (!reply.ok) return apiFailure('improve_prompt', reply);
      return { text: describe(reply.data) };
    },
  },
  {
    name: 'plan_design_set',
    title: '複数枚の構成を考える',
    description: 'Use this when the user wants a set of images rather than one: a banner, a batch of design ideas, product shots, variations of one design, a scene, a colourway or a background. It writes one prompt per image and draws nothing, so nothing is spent on image quota; pass each returned prompt to create_design or edit_design to actually draw it.',
    readOnly: true,
    openWorld: true,
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', description: 'The brand id from list_brands.' },
        task: { type: 'string', enum: PLAN_TASKS, description: 'What kind of set to plan. "variations" and "background" always plan one item.' },
        brief: { type: 'string', description: 'What the set is for, in English or Japanese (4000 characters).' },
        count: { type: 'integer', minimum: 1, maximum: 8, description: 'How many images to plan. Default 1.' },
        headline: { type: 'string', description: 'For a banner: the main line of text.' },
        subheadline: { type: 'string', description: 'For a banner: the second line.' },
        background: { type: 'string', description: 'The background to aim for.' },
        pattern: { type: 'string', description: 'The pattern or motif to aim for.' },
        reference_design_id: { type: 'string', description: 'Optional. One of this account\'s designs to look at while planning, from list_designs.' },
      },
      required: ['brand_id', 'task'],
      additionalProperties: false,
    },
    async run(input, context) {
      const brand = text(input.brand_id, 128);
      if (!brand || !ID_PATTERN.test(brand)) return { isError: true, text: 'brand_id が正しくありません。list_brands で取った id を渡してください。' };
      const task = text(input.task, 32);
      if (!task || !PLAN_TASKS.includes(task)) return { isError: true, text: `task に使えるのは ${PLAN_TASKS.join('・')} です。` };
      const body: Record<string, unknown> = { brandId: brand, task };
      if (input.count !== undefined) {
        const count = wholeNumber(input.count, 1, 8);
        if (count === null) return { isError: true, text: 'count は 1 から 8 までの整数です。' };
        body.count = count;
      }
      for (const [key, field, max] of [['brief', 'brief', 4_000], ['headline', 'headline', 500], ['subheadline', 'subheadline', 500], ['background', 'background', 500], ['pattern', 'pattern', 500]] as const) {
        if (input[key] === undefined) continue;
        const value = text(input[key], max);
        if (!value) return { isError: true, text: `${key} は 1〜${max} 字の文字です。` };
        body[field] = value;
      }
      if (input.reference_design_id !== undefined) {
        const reference = text(input.reference_design_id, 128);
        if (!reference || !ID_PATTERN.test(reference)) return { isError: true, text: 'reference_design_id が正しくありません。list_designs で取った id を渡してください。' };
        const image = await designAsBase64(context, reference);
        if ('error' in image) return { isError: true, text: image.error };
        // ここは imageBlock が読むので、型のプレフィックスが必ず要る。
        body.imageDataUrl = `data:${image.contentType};base64,${image.data}`;
      }
      const reply = await callApi(context, 'POST', '/v1/provider-actions/image-plan', { body });
      if (!reply.ok) return apiFailure('plan_design_set', reply);
      return { text: describe(reply.data) };
    },
  },
  {
    name: 'plan_from_message',
    title: '一言から、作るか直すかを決める',
    description: 'Use this when a message about a design is ambiguous and you need Heavy Chain\'s own reading of it: it answers whether the next step is a new drawing or an edit of the current one, and writes the instruction for it. It draws nothing. Skip it when the user has already said clearly which they want.',
    readOnly: true,
    openWorld: true,
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string', description: 'The brand id from list_brands.' },
        message: { type: 'string', description: 'The user\'s latest message about the design.' },
        has_current_image: { type: 'boolean', description: 'True when there is a design on the table to edit. An edit is never planned without one.' },
        history: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['user', 'assistant'] },
              content: { type: 'string' },
            },
            required: ['role', 'content'],
            additionalProperties: false,
          },
          description: 'Earlier turns of the conversation, oldest first.',
        },
      },
      required: ['brand_id', 'message'],
      additionalProperties: false,
    },
    async run(input, context) {
      const brand = text(input.brand_id, 128);
      if (!brand || !ID_PATTERN.test(brand)) return { isError: true, text: 'brand_id が正しくありません。list_brands で取った id を渡してください。' };
      const message = text(input.message, 4_000);
      if (!message) return { isError: true, text: 'message にユーザーの一言を入れてください（4000字まで）。' };
      const body: Record<string, unknown> = { brandId: brand, message };
      if (input.has_current_image !== undefined) {
        if (typeof input.has_current_image !== 'boolean') return { isError: true, text: 'has_current_image は true か false です。' };
        body.hasCurrentImage = input.has_current_image;
      }
      if (input.history !== undefined) {
        const turns = Array.isArray(input.history) ? input.history : null;
        if (!turns || turns.length > 20) return { isError: true, text: 'history は20件までの配列です。' };
        const history: Array<{ role: string; content: string }> = [];
        for (const turn of turns) {
          if (!isRecord(turn)) return { isError: true, text: 'history の各件は role と content を持つ object です。' };
          const role = text(turn.role, 16);
          const content = text(turn.content, 4_000);
          if (role !== 'user' && role !== 'assistant') return { isError: true, text: 'history の role は user か assistant です。' };
          if (!content) return { isError: true, text: 'history の content が空です。' };
          history.push({ role, content });
        }
        body.history = history;
      }
      const reply = await callApi(context, 'POST', '/v1/provider-actions/chat-plan', { body });
      if (!reply.ok) return apiFailure('plan_from_message', reply);
      return { text: describe(reply.data) };
    },
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

function toolDescriptor(tool: Tool): Record<string, unknown> {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      title: tool.title,
      readOnlyHint: tool.readOnly,
      destructiveHint: false,
      idempotentHint: tool.readOnly,
      openWorldHint: tool.openWorld === true,
    },
  };
}

/** ブラウザからの呼び出し（DNS rebinding 対策。MCP 仕様では Origin の検証が MUST）。 */
function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get('origin')?.trim();
  // MCP クライアント（ChatGPT・Claude・Cursor）はサーバー間で呼ぶので Origin を送らない。
  if (!origin) return true;
  const configured = (env.FRONTEND_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  return configured.includes(origin);
}

function bearer(request: Request): string | null {
  const value = request.headers.get('authorization');
  return value?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
}

function protocolFor(params: unknown): string {
  const asked = isRecord(params) ? params.protocolVersion : null;
  return typeof asked === 'string' && SUPPORTED_PROTOCOLS.has(asked) ? asked : DEFAULT_PROTOCOL;
}

async function runTool(params: unknown, context: ToolContext): Promise<unknown> {
  if (!isRecord(params)) throw new RpcFault(-32602, 'params must be an object');
  const name = typeof params.name === 'string' ? params.name : null;
  if (!name) throw new RpcFault(-32602, 'params.name is required');
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) throw new RpcFault(-32602, `unknown tool: ${name}`);
  const input = params.arguments === undefined ? {} : params.arguments;
  if (!isRecord(input)) throw new RpcFault(-32602, 'params.arguments must be an object');

  let result: ToolResult;
  try {
    result = await tool.run(input, context);
  } catch {
    // ツールの中の失敗は JSON-RPC のエラーではなく、モデルが読める結果として返す（MCP 仕様）。
    result = { isError: true, text: `${name} の実行中に問題が起きました。少し待ってから試してください。` };
  }
  return {
    content: [{ type: 'text', text: result.text }],
    ...(result.isError ? { isError: true } : {}),
  };
}

class RpcFault extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * /mcp 以外なら null を返し、ふだんの経路に渡す。
 * ctx は使わないが、将来ツールから長い処理を投げるときのために受け取る形にしておく。
 */
export async function handleMcpRequest(request: Request, env: Env, api: ApiCall): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== MCP_PATH) return null;

  if (!originAllowed(request, env)) return jsonResponse({ error: 'origin_not_allowed' }, 403);

  // SSE の受信ストリームは使わない作りなので、仕様どおり 405 で「無い」と答える。
  if (request.method === 'GET' || request.method === 'DELETE') {
    return jsonResponse({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, { allow: 'POST' });

  // 認証の入口（サインインの在りか）と、求める scope を必ず知らせる。クライアントはこれを見て OAuth を始める。
  // scope を載せるのは MCP 仕様 2025-11-25 の SHOULD。Claude Code・Cursor・Gemini CLI はどれも
  // 401 を見てサインインを始めるので、ここが全クライアント共通の入口になる。
  const unauthorized = (description: string): Response => jsonResponse(
    { error: 'unauthorized', error_description: description },
    401,
    {
      'www-authenticate':
        `Bearer realm="Heavy Chain MCP", resource_metadata="${resourceMetadataUrl(url.origin)}", scope="${MCP_SCOPE}"`,
    },
  );

  const presented = bearer(request);
  if (!presented) return unauthorized('アクセストークンが必要です。');

  // MCP の OAuth で出したトークンなら、封じてあるセッションに解いて、今までと同じ認証を通す。
  // それ以外は Heavy Chain のセッションそのものとして扱う（手元の道具から直につなぐとき）。
  let authorization = `Bearer ${presented}`;
  if (looksLikeMcpAccessToken(presented)) {
    const grant = await resolveMcpAccessToken(env, presented);
    if (!grant) return unauthorized('トークンが切れています。サインインし直してください。');
    // 別の相手を名指しして出された札は受けない（RFC 8707。札の使い回しへの備え）。
    if (!grantCoversResource(grant, url.origin)) return unauthorized('このトークンはこのサーバー向けではありません。');
    authorization = `Bearer ${grant.sessionToken}`;
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return rpcError(null, -32600, 'request too large', 413);

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return rpcError(null, -32700, 'parse error', 400); }
  // バッチ（配列）は MCP 2025-06-18 で廃止された。
  if (Array.isArray(payload)) return rpcError(null, -32600, 'batched requests are not supported', 400);
  if (!isRecord(payload)) return rpcError(null, -32600, 'invalid request', 400);

  const message = payload as RpcRequest;
  const id: JsonRpcId = typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null;
  const method = typeof message.method === 'string' ? message.method : null;
  if (message.jsonrpc !== '2.0' || !method) return rpcError(id, -32600, 'invalid request', 400);

  // 通知（id なし）には本文を返さない。
  const isNotification = message.id === undefined || message.id === null;
  if (isNotification) {
    return method.startsWith('notifications/')
      ? new Response(null, { status: 202 })
      : rpcError(null, -32600, 'a request must carry an id', 400);
  }

  const context: ToolContext = { api, origin: url.origin, authorization, env };

  try {
    switch (method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: protocolFor(message.params),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION },
          instructions: INSTRUCTIONS,
        });
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, { tools: TOOLS.map(toolDescriptor) });
      case 'tools/call':
        return rpcResult(id, await runTool(message.params, context));
      default:
        return rpcError(id, -32601, `method not found: ${method}`);
    }
  } catch (error) {
    if (error instanceof RpcFault) return rpcError(id, error.code, error.message);
    return rpcError(id, -32603, 'internal error');
  }
}

/** 試験と、将来の道具づくりのために出す。 */
export const MCP_TOOL_NAMES = TOOLS.map((tool) => tool.name);
