import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const prefix = '.fashion-studio-overview-parity > section > div:nth-child(2)';
const exclusion = ':not([data-testid="lightchain-fashion-studio-new-file"])';
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: match[1].trim().split(',').map((selector) => selector.trim()),
  declarations: match[2].trim(),
}));
const ruleFor = (selector: string) => {
  const matches = rules.filter((rule) => rule.selectors.includes(selector));
  assert.equal(matches.length, 1, `exactly one rule for ${selector}`);
  return matches[0];
};

test('exactly the four saved-project selectors exclude the new-file card', () => {
  const expected = [
    `${prefix} > div.group${exclusion} > div:first-child img`,
    `${prefix} > div.group${exclusion} > div:last-child`,
    `${prefix} > div.group${exclusion} > div:last-child > button`,
    `${prefix} > div.group${exclusion}:hover > div:last-child > button`,
  ];
  const excluded = rules.flatMap((rule) => rule.selectors.filter((selector) => selector.includes(exclusion)));
  assert.deepEqual(excluded, expected);
  for (const selector of expected) {
    ruleFor(selector);
    assert.ok(!rules.some((rule) => rule.selectors.includes(selector.replace(exclusion, ''))),
      `unexcluded project rule removed: ${selector}`);
  }
  assert.equal(css.split(exclusion).length - 1, 4);
});

test('shared saved-card geometry remains 220 by 240 with 167/73 media and footer areas', () => {
  for (const selector of [
    `${prefix} > button`,
    `${prefix} > [data-testid="lightchain-fashion-studio-new-file"]`,
    `${prefix} > article`,
    `${prefix} > div.group`,
  ]) {
    assert.equal(ruleFor(selector).declarations,
      'width: 220px; height: 240px; flex: 0 0 220px; overflow: visible; border-radius: 16px; background: #3c4143;');
  }
  for (const selector of [
    `${prefix} > button > div:first-child`,
    `${prefix} > article > button > div:first-child`,
    `${prefix} > div.group > div:first-child`,
  ]) {
    assert.equal(ruleFor(selector).declarations, 'height: 167px; background: #3c4143;');
  }
  for (const selector of [
    `${prefix} > button > div:last-child`,
    `${prefix} > article > button > div:last-child`,
    `${prefix} > div.group > div:nth-child(2)`,
  ]) {
    assert.equal(ruleFor(selector).declarations, 'height: 73px; padding: 12px; background: #262a2b;');
  }
});

test('new-file tile is a centered single surface without media/footer splitting', () => {
  assert.equal(ruleFor(`${prefix} > .studio-new-file-card`).declarations,
    'display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; overflow: hidden; background: #3c4143;');
  assert.equal(ruleFor('.fashion-studio-overview-parity .studio-new-file-icon').declarations,
    'display: block; width: 80px; height: 80px; object-fit: contain;');
  assert.equal(ruleFor('.fashion-studio-overview-parity .studio-new-file-label').declarations,
    'margin: 0; color: #d4d4d4; font-size: 14px; line-height: 20px;');
  assert.equal(ruleFor(`${prefix} > [data-testid="lightchain-fashion-studio-new-file"]`).declarations,
    'width: 220px; height: 240px; flex: 0 0 220px; overflow: visible; border-radius: 16px; background: #3c4143;');
  assert.ok(rules.some((rule) => rule.selectors.includes(
    `${prefix} > [data-testid="lightchain-fashion-studio-new-file"]:not(.studio-new-file-card) > div:first-child`)));
  assert.ok(rules.some((rule) => rule.selectors.includes(
    `${prefix} > [data-testid="lightchain-fashion-studio-new-file"]:not(.studio-new-file-card) > div:last-child`)));
});

test('saved-project images retain full width and 167px cover for both supported card structures', () => {
  const rule = ruleFor(`${prefix} > div.group${exclusion} > div:first-child img`);
  assert.deepEqual(rule.selectors, [
    `${prefix} > article > button > div:first-child img`,
    `${prefix} > div.group${exclusion} > div:first-child img`,
  ]);
  assert.equal(rule.declarations, 'height: 167px; width: 100%; object-fit: cover;');
});

test('saved-project menu positioning, hidden buttons and hover remain unchanged', () => {
  for (const [articleSuffix, groupSuffix, declarations] of [
    [' > div', ' > div:last-child', 'top: 8px; right: 8px;'],
    [' > div > button', ' > div:last-child > button', 'border-radius: 999px; background: transparent; opacity: 0; transition: opacity .15s ease;'],
    [':hover > div > button', ':hover > div:last-child > button', 'opacity: 1;'],
  ]) {
    const rule = ruleFor(`${prefix} > div.group${exclusion}${groupSuffix}`);
    assert.deepEqual(rule.selectors, [
      `${prefix} > article${articleSuffix}`,
      `${prefix} > div.group${exclusion}${groupSuffix}`,
    ]);
    assert.equal(rule.declarations, declarations);
  }
});
