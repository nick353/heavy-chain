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
 *   毎回の確認が出る（ChatGPT の custom MCP server の仕様）。
 */
import type { Env } from './index.ts';

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

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const INSTRUCTIONS = [
  'Heavy Chain はアパレル（服・雑貨）向けの AI デザインアプリです。',
  'どのツールも、まず list_brands でブランドの id を取り、それを brand_id に渡してください。',
  'search_products には list_projects で取った project_id も必要です。',
  'デザインの画像を見せるときは list_designs に with_image_urls: true を渡すと、1時間だけ有効な URL が返ります。',
  'その URL は期限が切れるので、保存せず必要なときに取り直してください。',
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

/** /v1/media/read で1時間だけ有効な画像 URL を作る。失敗しても一覧そのものは返す。 */
async function signedImageUrl(context: ToolContext, storagePath: string): Promise<string | null> {
  const path = `/v1/media/read?bucket=generated-images&path=${encodeURIComponent(storagePath)}&expiresIn=${IMAGE_URL_TTL_SECONDS}`;
  const reply = await callApi(context, 'GET', path);
  if (!reply.ok || !isRecord(reply.data) || typeof reply.data.url !== 'string') return null;
  return reply.data.url;
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
  return value && /^Bearer\s+\S+$/i.test(value) ? value : null;
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

  const authorization = bearer(request);
  if (!authorization) {
    // 認証の入口を知らせる。OAuth を足したら resource_metadata をここに載せる。
    return jsonResponse({ error: 'unauthorized' }, 401, {
      'www-authenticate': 'Bearer realm="Heavy Chain MCP"',
    });
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

  const context: ToolContext = { api, origin: url.origin, authorization };

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
