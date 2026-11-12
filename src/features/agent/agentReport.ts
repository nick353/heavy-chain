/**
 * Light's research report (「オンラインで表示」 / 「ダウンロード」, read 2026-11-12 from its 新商品企画 5ce6e3ac… and 顧客提案
 * 02b36ab0… reports) is written by its AI every time: 1600x900 slides stacked one above the other, each with a header, a
 * body and a footer band (「2027SS レディースコレクション提案 — 調査・方向性レポート 11」), evidence cards (product, price,
 * 「ソースを見る」), one page per direction, a comparison table and, on the last page, the source table (新商品企画:
 * 「ソース索引」 # / ソース / 種別 / 収集・公開時期 / 用途; 顧客提案: 「ソース一覧 SOURCE INDEX」 ID / ソース / 内容 / 区分).
 *
 * Heavy asks the server's Claude for the slides once the directions are ready (`agent-report`). The AI writes a <style>
 * with its palette and the <main class="report"> slides; this module keeps only safe markup (no script, no event
 * attribute, no external load, links only to the research's own pages), wraps it in Light's base stylesheet and a
 * Content-Security-Policy, and falls back to the fixed report when the reply is missing or not slides. Pure: no runtime
 * imports, so tests read it directly.
 */
import {
  AGENT_PROMPT_BUDGET, agentReportSourceList, agentScopeSummary, agentSourceKind, agentSourceLabel, agentSourceSite, cleanAgentQuote,
  effectiveAgentRequirements, parseAgentDirection, parseAgentResearch, type AgentAssistantStep, type AgentTask,
} from './agentFlow.ts';
import { agentDirectionCode, agentSeriesName } from './agentMerch.ts';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const cut = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** The report belongs to one set of directions: a revised round asks for a new report. */
export type AgentReportState = { round: string; step: AgentAssistantStep };
export function readAgentReport(task: AgentTask): AgentReportState | null {
  const value: unknown = task.report;
  return record(value) && typeof value.round === 'string' && record(value.step) && typeof value.step.requestId === 'string' ? value as AgentReportState : null;
}

/**
 * The directions round the slides are written for: Light writes its report with the directions in it (新商品企画 and
 * 顧客提案, after the research). テーマ企画 has no report (only 参考資料), nor do the chat scenes.
 */
export function agentReportRound(task: AgentTask): string | null {
  if (task.flow !== 'conversation' || task.research?.state !== 'completed' || !task.research.content) return null;
  const round = [...task.rounds].reverse().find(entry => entry.step.state !== 'failed' && entry.step.state !== 'unknown');
  return round && round.step.state === 'completed' && round.themes.length ? round.step.requestId : null;
}
const localDate = (value?: string) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
/** The sources the slides may cite and link: the research's cited pages, numbered S01… in the research's order. */
export function agentReportSources(task: AgentTask) {
  const research = task.research?.state === 'completed' && task.research.content ? parseAgentResearch(task.research.content) : null;
  return agentReportSourceList((research?.sources ?? []).filter(source => /^https?:\/\//i.test(source.url))).map((source, index) => ({
    id: `S${String(index + 1).padStart(2, '0')}`, url: source.url, site: agentSourceSite(source.url), label: agentSourceLabel(source.url), kind: agentSourceKind(source.url),
    title: source.title !== source.url ? source.title : '',
    text: source.quote ? cleanAgentQuote(source.quote).replace(/\*\*/g, '').replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, '$1') : '',
  }));
}
/** The footer band and the cover title, as Light writes them (「2027SS レディースコレクション提案 — 調査・方向性レポート」). */
function reportName(task: AgentTask): string {
  const series = agentSeriesName(task);
  return series ? `${series}${task.subtype === '顧客提案' ? '提案' : ''}` : cut(task.prompt.replace(/\s+/g, ' ').trim(), 30);
}

/** The request for the slides: every fact they may use, each part bounded (the server takes at most 16,000 characters). */
export function agentReportPrompt(task: AgentTask): string {
  const research = task.research?.state === 'completed' && task.research.content ? parseAgentResearch(task.research.content) : null;
  const round = [...task.rounds].reverse().find(entry => entry.step.state === 'completed' && entry.themes.length);
  const requirements = effectiveAgentRequirements(task);
  const sources = agentReportSources(task);
  const collected = localDate(task.research?.at ?? task.scope?.at);
  const client = task.subtype === '顧客提案';
  const directions = (round?.themes ?? []).map((theme, index) => {
    const direction = parseAgentDirection(theme);
    return `${agentDirectionCode(task, index)} ${cut(direction.name, 60)}｜${cut(direction.description, 220)}｜${cut(direction.recommendation, 160)}`;
  });
  const parts = [
    `業務シーン: ${task.scene}（${task.subtype}）`,
    `依頼: ${cut(task.prompt, 1200)}`,
    requirements ? `確認済みの要件:\n${cut(requirements.replace(/\[補足が必要\][\s\S]*$/, '').trim(), 1600)}` : '',
    task.scope ? `調査範囲: ${agentScopeSummary(task.scope)}${collected ? `（収集日 ${collected}）` : ''}` : '',
    research ? `ウェブ調査の結果（このレポートの事実の元。ここに無い数字・価格・商品・ブランドは書かない）:\n${cut(research.report, 4200)}` : '',
    research && research.search !== 'ok' ? '注意: ウェブ検索を使えなかったため、上の調査結果はAIモデルの知識に基づく整理です。その旨をレポートの中で開示する。' : '',
    sources.length
      ? `調査の出典（ID | サイト | 区分 | ページの題名 | ページの文 | URL。リンクはこのURLだけ、書かれたとおりに使う。価格はページの文に書かれているときだけ書く）:\n${sources.map(source =>
        `${source.id} | ${source.site} | ${source.kind} | ${cut(source.title, 70) || '—'} | ${cut(source.text, 150) || '—'} | ${source.url}`).join('\n')}`
      : '調査の出典: なし（出典のない事実は書かない。ソースの表には「参照した資料はありません」と書く）',
    directions.length ? `提示した方向性（名前｜特徴｜採用をすすめる理由）:\n${directions.join('\n')}` : '',
    `帯の文: 「${reportName(task)} — 調査・方向性レポート」（各ページの footer の左。右はページ番号の2桁）`,
    `表紙の題: ${client ? '顧客要件調査・ビジュアル方向性レポート' : '市場調査・ビジュアル方向レポート'}`,
    client
      ? '最後のページ: 題「ソース一覧」・kicker「Source Index」、表の列は ID / ソース / 内容 / 区分。ソースは「サイト(ページの道)」、内容は「その出典の要点 — どの方向・所見の根拠か（例: D02価格帯の根拠）」、区分は EC実商品・SNS・ウェブ記事など、先頭の行の区分に「(収集 日付)」。表の下に「※ 収集日はウェブ検索でページを集めた日であり、各ページの公開日ではありません。」'
      : '最後のページ: 題「リスク・限界の開示とソース索引」、調査の限界のカードと、<h3>ソース索引</h3> の表（列は # / ソース / 種別 / 収集・公開時期 / 用途）。同じサイトの出典はまとめて1行にしてよい（例: 「rakuten.co.jp の商品ページ（… ほか3件）」）。用途は、その出典をレポートのどの所見・方向の根拠に使ったか。',
  ].filter(Boolean);
  let prompt = parts.join('\n\n');
  if (prompt.length > AGENT_PROMPT_BUDGET) prompt = prompt.slice(0, AGENT_PROMPT_BUDGET);
  return prompt;
}

// ---------------------------------------------------------------------------
// Keeping only safe markup. The frame that shows the report has no scripts (sandbox) and an opaque origin, but the
// downloaded file opens as a page of its own, so the markup itself must be inert.
const ALLOWED_TAGS = new Set(['main', 'section', 'header', 'footer', 'article', 'aside', 'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'dl', 'dt', 'dd', 'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'figure', 'figcaption', 'a', 'strong', 'b', 'em', 'i', 'u',
  's', 'small', 'mark', 'sup', 'sub', 'br', 'hr', 'blockquote', 'q', 'cite', 'abbr', 'time', 'code', 'pre']);
const VOID_TAGS = new Set(['br', 'hr', 'col', 'img', 'input', 'meta', 'link', 'base', 'source', 'track', 'wbr', 'area', 'embed', 'param', 'keygen']);
/** Dropped with everything inside them. Raw-text ones end at their own closing tag only. */
const RAW_DROP = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
const NESTED_DROP = new Set(['svg', 'math', 'template', 'object', 'select', 'video', 'audio', 'canvas', 'picture', 'form', 'button', 'frameset', 'map', 'applet', 'portal', 'dialog']);
/** The document's own wrappers: the tag goes, its content stays. */
const TRANSPARENT = new Set(['html', 'head', 'body']);
const GLOBAL_ATTRS = new Set(['class', 'style', 'title', 'lang', 'dir', 'aria-label', 'aria-hidden', 'role']);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel']), td: new Set(['colspan', 'rowspan']), th: new Set(['colspan', 'rowspan', 'scope']), col: new Set(['span']),
  colgroup: new Set(['span']), ol: new Set(['start', 'type']), time: new Set(['datetime']),
};
const decodeEntities = (value: string) => value
  .replace(/&#(\d+);?/g, (_, code) => String.fromCodePoint(Math.min(Number(code), 0x10ffff)))
  .replace(/&#x([0-9a-f]+);?/gi, (_, code) => String.fromCodePoint(Math.min(parseInt(code, 16), 0x10ffff)))
  .replace(/&(colon|tab|newline|amp|quot|apos|lt|gt|nbsp);?/gi, (_, name: string) => ({ colon: ':', tab: '\t', newline: '\n', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[name.toLowerCase()]!);
/** A declaration that can load something, run something or hide an escape is dropped whole. */
const UNSAFE_CSS = /url\s*\(|image-set\s*\(|(?:^|[^-\w])image\s*\(|cross-fade\s*\(|element\s*\(|expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@import|\\/i;
export function sanitizeAgentCss(value: string): string {
  const css = value.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '').replace(/<\/?[a-z!]/gi, '').replace(/</g, '')
    .replace(/@(?:import|charset|namespace)[^;{}]*;?/gi, '').replace(/@font-face\s*\{[^}]*\}?/gi, '');
  // Declarations sit between ; { and }: drop the unsafe ones, keep the rule structure.
  return css.replace(/[^;{}]+/g, (part) => (UNSAFE_CSS.test(part) ? '' : part)).trim();
}
const safeStyleAttr = (value: string) => decodeEntities(value).split(';').map(part => part.trim()).filter(part => part && !UNSAFE_CSS.test(part) && /^[-a-z]+\s*:/i.test(part)).join('; ');
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<[!?][^>]*>?|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

export type SanitizedAgentReport = { style: string; body: string };
/**
 * Rebuilds the AI's HTML from an allow-list: known layout tags only, `class`/`style`/`aria-*`/`data-*` and table spans,
 * links only to `allowedUrls` (opened in a new tab with rel="noopener noreferrer"), CSS without url(), @import or
 * escapes. Everything else (script, style elements in the body, img, iframe, svg, forms, event attributes, base, meta)
 * is dropped. The <style> elements' CSS is returned apart.
 */
export function sanitizeAgentReportHtml(html: string, allowedUrls: Iterable<string>): SanitizedAgentReport {
  const allowed = new Set([...allowedUrls].map(url => url.trim()));
  const styles: string[] = [];
  let out = '';
  let skip: { tag: string; depth: number } | null = null;
  const open: string[] = [];
  TOKEN.lastIndex = 0;
  let at = 0;
  const text = (value: string) => { if (!skip) out += value.replace(/</g, '&lt;'); };
  for (let match = TOKEN.exec(html); match; match = TOKEN.exec(html)) {
    text(html.slice(at, match.index));
    at = TOKEN.lastIndex;
    const name = match[2]?.toLowerCase();
    if (!name) continue; // comment, doctype, CDATA, processing instruction
    const closing = match[1] === '/';
    if (skip) {
      if (name === skip.tag) skip.depth += closing ? -1 : (match[3].trim().endsWith('/') ? 0 : 1);
      if (skip.depth <= 0) skip = null;
      continue;
    }
    if (!closing && (RAW_DROP.has(name) || name === 'plaintext')) {
      if (name === 'plaintext') { at = html.length; break; }
      const end = new RegExp(`</${name}\\s*>`, 'i');
      const rest = html.slice(at);
      const found = end.exec(rest);
      if (name === 'style') styles.push(found ? rest.slice(0, found.index) : rest);
      at = found ? at + found.index + found[0].length : html.length;
      TOKEN.lastIndex = at;
      continue;
    }
    if (NESTED_DROP.has(name)) {
      if (!closing && !match[3].trim().endsWith('/')) skip = { tag: name, depth: 1 };
      continue;
    }
    if (TRANSPARENT.has(name) || !ALLOWED_TAGS.has(name)) continue;
    if (closing) {
      const index = open.lastIndexOf(name);
      if (index < 0) continue;
      // Close what was left open inside it, so the markup stays balanced.
      while (open.length > index) out += `</${open.pop()}>`;
      continue;
    }
    const attrs: string[] = [];
    let href = '';
    ATTR.lastIndex = 0;
    for (let attr = ATTR.exec(match[3]); attr; attr = ATTR.exec(match[3])) {
      const key = attr[1].toLowerCase();
      const raw = attr[2] ?? attr[3] ?? attr[4] ?? '';
      if (key === 'href' && name === 'a') { const url = decodeEntities(raw).trim(); if (allowed.has(url) && /^https?:\/\//i.test(url)) href = url; continue; }
      // A kept link always opens in a new tab without the opener or the referrer (as the fixed report's links do).
      if (key === 'target' || key === 'rel') continue;
      if (key === 'style') { const style = safeStyleAttr(raw); if (style) attrs.push(`style="${escapeHtml(style)}"`); continue; }
      if (key === 'class') { const value = decodeEntities(raw).replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ').trim(); if (value) attrs.push(`class="${value}"`); continue; }
      const dataAttr = /^data-[a-z0-9-]{1,40}$/.test(key);
      if (!dataAttr && !GLOBAL_ATTRS.has(key) && !/^aria-[a-z]{1,20}$/.test(key) && !TAG_ATTRS[name]?.has(key)) continue;
      const value = decodeEntities(raw);
      if (/^(?:colspan|rowspan|span|start)$/.test(key) && !/^\d{1,3}$/.test(value.trim())) continue;
      attrs.push(`${key}="${escapeHtml(value.slice(0, 300))}"`);
    }
    if (name === 'a' && href) attrs.unshift(`href="${escapeHtml(href)}"`, 'target="_blank"', 'rel="noopener noreferrer"');
    out += `<${name}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
    if (!VOID_TAGS.has(name)) open.push(name);
  }
  text(html.slice(at));
  while (open.length) out += `</${open.pop()}>`;
  return { style: sanitizeAgentCss(styles.join('\n')), body: out.trim() };
}

/** Light's slide classes (the two reports' stylesheets): the AI sets the palette and may add a few rules after these. */
export const AGENT_REPORT_BASE_CSS = `:root{--page-width:1600px;--page-height:900px;--page-bg:#EAE3D8;--color-base:#F6F0E7;--color-surface:#FFFDF9;--color-ink:#2B251F;--color-muted:#6F655B;--color-line:#DDD3C6;--color-accent:#8A6045;--color-on-accent:#FFFFFF;--radius-sm:4px;--radius-lg:14px;--font-body:"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic",Meiryo,"Noto Sans JP",sans-serif;--font-display:"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","Times New Roman",serif;--font-mono:"SF Mono","Courier New",monospace}
*,*::before,*::after{box-sizing:border-box}html,body{margin:0;padding:0;background:var(--page-bg);font-family:var(--font-body);color:var(--color-ink)}
.report{display:grid;justify-items:center;gap:24px;padding:32px 0}
.report-page{position:relative;flex:none;width:var(--page-width);height:var(--page-height);padding:48px 64px;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:16px;background:var(--color-base);box-shadow:0 2px 12px rgba(43,37,31,.08);overflow:hidden}
.report-page.surface{background:var(--color-surface)}
.page-header,.page-body,.page-footer{min-width:0;min-height:0}.page-header>*,.page-footer>*{margin:0}
.page-header{display:flex;align-items:baseline;justify-content:space-between;gap:16px;border-bottom:2px solid var(--color-accent);padding-bottom:12px}
.page-header h2{flex:1}.page-header .kicker,.chapter-label{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--color-accent);font-weight:700}
.page-footer{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--color-muted);border-top:1px solid var(--color-line);padding-top:10px}
h1{font-family:var(--font-display);font-size:44px;line-height:1.3;font-weight:600;margin:0}h2{font-family:var(--font-display);font-size:28px;line-height:1.3;font-weight:600;margin:0;letter-spacing:.03em}
h3{font-family:var(--font-display);font-size:19px;font-weight:700;margin:0 0 8px;color:var(--color-accent)}
p{margin:0 0 10px;font-size:14px;line-height:1.75}ul,ol{margin:0;padding-left:18px;font-size:14px;line-height:1.75}li{margin-bottom:6px}
.lead{font-size:16px;line-height:1.9}.muted{color:var(--color-muted)}.small{font-size:12.5px;line-height:1.6;color:var(--color-muted)}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:32px;min-height:0}.three-col{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.card{background:var(--color-surface);border:1px solid var(--color-line);border-radius:var(--radius-lg);padding:20px 24px}
.kicker-pill{display:inline-block;background:var(--color-accent);color:var(--color-on-accent);font-size:11px;letter-spacing:.14em;padding:4px 12px;border-radius:999px;font-weight:700;margin-bottom:14px}
.stat,.big-num{font-family:var(--font-display);font-size:48px;line-height:1.1;color:var(--color-accent);font-weight:700}.stat-sub{font-size:12.5px;color:var(--color-muted);margin-top:4px}
.quote{border-left:3px solid var(--color-accent);padding:8px 0 8px 20px;font-family:var(--font-display);font-size:20px;line-height:1.7}
.tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--color-on-accent);background:var(--color-accent);border-radius:var(--radius-sm);padding:2px 8px;margin:0 6px 6px 0}
.tag.outline{background:transparent;color:var(--color-accent);border:1px solid var(--color-accent)}
table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:13px}th,td{border:1px solid var(--color-line);padding:8px 10px;text-align:left;vertical-align:top;line-height:1.6;overflow-wrap:anywhere}
th{background:var(--color-accent);color:var(--color-on-accent);font-weight:600;font-size:12.5px}td{background:var(--color-surface)}
.media-grid{display:grid;width:100%;height:100%;min-width:0;min-height:0;grid-template-columns:repeat(var(--columns,4),minmax(0,1fr));grid-template-rows:repeat(var(--rows,1),minmax(0,1fr));gap:16px}
.media-item{margin:0;min-width:0;min-height:0;display:grid;grid-template-rows:minmax(0,1fr) auto;gap:8px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:var(--radius-lg);padding:12px}
.media-frame{position:relative;display:flex;align-items:center;justify-content:center;min-width:0;min-height:120px;background:var(--color-base);border:1px solid var(--color-line);border-radius:var(--radius-sm);overflow:hidden}
.media-frame>img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:contain}
.media-empty{font-family:var(--font-display);font-size:18px;color:var(--color-muted);text-align:center;padding:12px;overflow-wrap:anywhere}
.media-link{color:inherit;text-decoration:none}.media-link:focus-visible{outline:2px solid var(--color-accent);outline-offset:4px}
.media-item>figcaption{margin:0;overflow-wrap:anywhere;font-size:11.5px;line-height:1.55;color:var(--color-ink)}.media-item>figcaption b,.media-item>figcaption strong{color:var(--color-ink)}
.src{font-family:var(--font-mono);font-size:10.5px;color:var(--color-muted)}.source-link{font-size:11px;color:var(--color-accent)}
.dir-grid,.dir-hero{display:grid;grid-template-columns:1.1fr .9fr;gap:32px;height:100%;min-height:0}.dir-text{overflow-wrap:anywhere}
.dir-media{display:grid;grid-template-rows:minmax(0,1fr) minmax(0,1fr);gap:12px;min-height:0}
.dir-head{display:flex;align-items:baseline;gap:14px;margin-bottom:10px}
.dir-id,.dir-badge{display:inline-block;font-family:var(--font-mono);font-size:14px;font-weight:700;background:var(--color-accent);color:var(--color-on-accent);padding:3px 12px;border-radius:var(--radius-sm);letter-spacing:.08em}
.note,.note-box{background:var(--color-surface);border-left:4px solid var(--color-accent);border-radius:0 var(--radius-sm) var(--radius-sm) 0;padding:12px 16px;font-size:13px;line-height:1.7}
.cover{background:linear-gradient(160deg,color-mix(in srgb,var(--color-accent) 30%,#1d1716) 0%,var(--color-accent) 100%);color:var(--color-on-accent);padding:72px 88px;grid-template-rows:auto 1fr auto}
.cover h1{font-size:52px;line-height:1.35}.cover .sub{font-size:17px;line-height:1.9;margin-top:20px;opacity:.9}.cover .meta{font-size:13px;line-height:2;opacity:.85}.cover .rule{width:72px;height:3px;background:currentColor;opacity:.6;margin:28px 0}`;
export const AGENT_REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; base-uri 'none'; form-action 'none'";

/** The slides read as a report only with several pages and the source table at the end. */
export function agentReportLooksRight(body: string): boolean {
  const pages = body.match(/<section[^>]*class="[^"]*\breport-page\b/g)?.length ?? 0;
  return pages >= 4 && /<table/.test(body) && /ソース(?:一覧|索引)/.test(body) && body.length >= 2500;
}
/** The reply without a code fence around it (```html … ```). */
const unfenced = (value: string) => value.replace(/^\s*```(?:html)?\s*\n?/i, '').replace(/\n?```\s*$/, '');

/** The AI's slides as a whole document, or null to show the fixed report (no reply yet, a failure, or not slides). */
export function buildAgentAiReportHtml(task: AgentTask, title: string): string | null {
  const report = readAgentReport(task);
  if (!report || report.round !== agentReportRound(task) || report.step.state !== 'completed' || !report.step.content) return null;
  const { style, body } = sanitizeAgentReportHtml(unfenced(report.step.content), agentReportSources(task).map(source => source.url));
  if (!agentReportLooksRight(body)) return null;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${AGENT_REPORT_CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">`
    + `<title>${escapeHtml(title)}</title><style>${AGENT_REPORT_BASE_CSS}</style>${style ? `<style>${style}</style>` : ''}</head><body>${body}</body></html>`;
}
