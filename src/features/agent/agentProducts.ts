/**
 * Real products from Yahoo!ショッピング (the owner chose it on 2026-11-12; Light's evidence cards and direction pictures are real
 * products: its 顧客提案 source index starts with 「EC実商品(収集 2026-11-11)」). The server searches only with the secret
 * YAHOO_SHOPPING_APP_ID, and only for plans of the Japanese market; without it the agent works as before (generated
 * pictures, web-search sources). The terms: images stay on Yahoo!'s addresses (never stored), each links to its product page,
 * and Yahoo!'s credit HTML is shown unchanged wherever products are shown. Pure: no runtime imports.
 */
import type { AgentResearchScope, AgentTask } from './agentFlow.ts';

export type AgentProduct = { name: string; url: string; price: number | null; image: string; store: string; query?: string; at: string };

/**
 * Yahoo! JAPAN's credit, exactly as https://developer.yahoo.co.jp/attribution/ gives it (text link, Japanese; read
 * 2026-11-12). Its rules: shown at the bottom, unchanged (no CSS that recolors or shrinks it), linking to the sitemap.
 */
export const YAHOO_ATTRIBUTION_HTML = [
  '<!-- Begin Yahoo! JAPAN Web Services Attribution Snippet -->',
  '<span style="margin:15px 15px 15px 15px"><a href="https://developer.yahoo.co.jp/sitemap/">Webサービス by Yahoo! JAPAN</a></span>',
  '<!-- End Yahoo! JAPAN Web Services Attribution Snippet -->',
].join('\n');

const onHost = (value: unknown, hosts: RegExp): value is string => {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && hosts.test(url.hostname); } catch { return false; }
};
/** Product pages on Yahoo!'s shopping hosts, images on its image hosts: nothing else is shown as a product. */
export const agentProductPage = (value: unknown): value is string => onHost(value, /(^|\.)yahoo\.co\.jp$/);
export const agentProductImage = (value: unknown): value is string => onHost(value, /(^|\.)yimg\.jp$/);

/** A product as the app keeps it, or null. */
export function agentProduct(value: unknown): AgentProduct | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const text = (entry: unknown, max: number) => (typeof entry === 'string' ? entry.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const name = text(item.name, 120);
  if (!name || !agentProductPage(item.url) || !agentProductImage(item.image)) return null;
  const price = typeof item.price === 'number' && Number.isSafeInteger(item.price) && item.price > 0 ? item.price : null;
  const at = /^\d{4}-\d{2}-\d{2}$/.test(text(item.at, 10)) ? text(item.at, 10) : '';
  return { name, url: item.url, price, image: item.image, store: text(item.store, 60), ...(text(item.query, 60) ? { query: text(item.query, 60) } : {}), at };
}
/** The research's `[商品]` block: one JSON object per line (lines a `[出典]` reader never takes for a source). */
export function parseAgentProducts(content: string): AgentProduct[] {
  const at = content.search(/^\[商品\]$/m);
  if (at < 0) return [];
  const products: AgentProduct[] = [];
  for (const line of content.slice(at).split('\n').slice(1)) {
    const trimmed = line.trim();
    if (/^\[[^\]]+\]$/.test(trimmed)) break;
    if (!trimmed.startsWith('{')) continue;
    try { const product = agentProduct(JSON.parse(trimmed)); if (product && !products.some(entry => entry.url === product.url)) products.push(product); } catch { /* not a product */ }
  }
  return products;
}
export const agentYen = (price: number | null) => (price === null ? '' : `¥${price.toLocaleString('ja-JP')}`);

/** Yahoo!ショッピング sells in Japan: real products are searched for plans whose scope includes Japan (新商品企画・顧客提案). */
export const agentJapanMarket = (task: Pick<AgentTask, 'flow'> & { scope?: Pick<AgentResearchScope, 'regions'> | null }) =>
  task.flow === 'conversation' && !!task.scope?.regions.includes('日本');
/** The research request's line that lets the server add Yahoo!ショッピング's products (when it has the key). */
export const AGENT_PRODUCT_LINE = '実商品の検索: 日本';

const MATERIALS = ['リネン', '麻', 'コットン', '綿', 'シルク', 'サテン', 'ウール', 'カシミヤ', 'ニット', 'デニム', 'レザー', 'スエード', 'ナイロン', 'シフォン', 'レース', 'ツイード', 'コーデュロイ', 'ベロア', 'ジャージー', 'ポリエステル'];
/** レディース / メンズ from what the task says about its customers, or nothing. */
export function agentProductGender(text: string): string {
  const women = /レディース|ウィメンズ|女性|婦人/.test(text), men = /メンズ|男性|紳士/.test(text);
  return women && !men ? 'レディース' : men && !women ? 'メンズ' : '';
}
/**
 * One shop search per direction (「方向性の名前（主なアイテム）｜特徴…」): the customers' gender, a material the direction
 * names and its main item; without a hit, the gender and the item only. The item also travels as `needs`, so the
 * server keeps only the products that name it.
 */
export function agentDirectionSearches(task: Pick<AgentTask, 'prompt'> & { requirements?: { content?: string } | null }, directions: Array<{ name: string; description: string }>) {
  const gender = agentProductGender(`${task.prompt}\n${task.requirements?.content ?? ''}`);
  return directions.map(direction => {
    const picked = /[（(]([^）)]{1,30})[）)]/.exec(direction.name)?.[1]?.split(/[・、,／/]/)[0]?.trim() ?? '';
    const item = picked || direction.name.replace(/[（(].*$/, '').trim().slice(0, 20);
    const material = MATERIALS.find(word => direction.description.includes(word) || direction.name.includes(word)) ?? '';
    const query = [gender, material, item].filter(Boolean).join(' ');
    const fallback = [gender, item].filter(Boolean).join(' ');
    // An item written in 「（主なアイテム）」 is what the search is for, and the gender and the material only narrow it, so a
    // product that never names the item answers another question (production 2026-11-14: a direction card cited
    // 「水着 ¥2,090」) and the server drops it. A name without 「（…）」 is the direction's concept (「都市の余白」), which no
    // product name repeats: it is searched as before, with nothing to hold the answers to.
    return { query, ...(fallback !== query ? { fallback } : {}), ...(picked ? { needs: [picked] } : {}) };
  });
}
