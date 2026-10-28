import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const image = readFileSync(new URL('../src/lib/cloudflareImageAI.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/lib/cloudflareApi.ts', import.meta.url), 'utf8');

test('OpenAI edits get 1536px references (Light kept buttons and seams; 343x512 lost them, 2026-10-29)', () => {
  assert.match(image, /export const OPENAI_REFERENCE_SIDE = 1536;/);
  assert.match(image, /const scale = Math\.min\(1,side \/ sourceWidth,side \/ sourceHeight\);/);
  assert.match(api, /const referenceSide = await this\.imageProvider\(\) === 'openai' \? OPENAI_REFERENCE_SIDE : 512;/);
  assert.match(api, /prepareCloudflareImageInput\(action,proofBody,\{ referenceSide \}\)/);
});
