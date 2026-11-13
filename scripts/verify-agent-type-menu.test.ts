import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 2026-11-13 production: the 新商品企画 / テーマ企画 menu over the agent composer broke 「新商品企画」 onto two lines (16px text in
// a 96px box). Light's menu (read the same day on jp.linkaigc.com/agent) keeps each item on one line, 86×32px with 14px text,
// and turns its chevron up while the menu is open. Its テーマ企画 item sits at y=274 over the composer; with one-line items Heavy's
// sat 12px higher (y=262) until the menu was moved down from -90px to -78px.

const page = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
const menu = page.slice(page.indexOf('aria-label="商品企画タイプを選択"'), page.indexOf('aria-label="商品企画タイプを選択"') + 1200);

test('the task type items stay on one line at Light\'s 14px', () => {
  assert.match(menu, /role="option"[\s\S]*?className="[^"]*\bwhitespace-nowrap\b[^"]*\btext-sm\b[^"]*"/);
  assert.ok(!/role="option"[\s\S]*?className="[^"]*\btext-base\b/.test(menu));
});

test('the chevron turns up while the menu is open', () => {
  assert.match(page, /<ChevronDown aria-hidden="true" className=\{`h-3 w-3 transition-transform \$\{agentTaskTypeOpen \? 'rotate-180' : ''\}`\} \/>/);
});

test('the menu sits where Light\'s does once its items are one line tall', () => {
  assert.match(page, /aria-label="商品企画タイプを選択" className="absolute left-\[5px\] top-\[-78px\] /);
});
