import assert from 'node:assert/strict';
import test from 'node:test';
import { callClaudeMessages, claudeModel, CLAUDE_TEXT_MODELS } from '../src/claude-text.ts';
import { openAIModelForEndpoint } from '../src/openai-image.ts';
import { availableAIModels } from '../src/image-ai.ts';
import type { Env } from '../src/index.ts';

type Json = Record<string, any>;

test('Claude model: a listed choice is used, anything else falls back to the server default (Sonnet 5.5)', () => {
  const env = { ANTHROPIC_API_KEY: 'k' } as Env;
  assert.equal(claudeModel(env), 'claude-sonnet-5-5');
  assert.equal(claudeModel(env, 'claude-haiku-4-5-20251001'), 'claude-haiku-4-5-20251001');
  assert.equal(claudeModel(env, 'claude-opus-5-5'), 'claude-opus-5-5');
  assert.equal(claudeModel(env, 'gpt-5'), 'claude-sonnet-5-5');
  assert.equal(claudeModel({ ANTHROPIC_TEXT_MODEL: 'claude-opus-5-5' } as Env, 'unknown'), 'claude-opus-5-5');
});

test('free-text Claude call starts with a user turn, merges repeated roles and reports token usage', async () => {
  let body: Json = {};
  const result = await callClaudeMessages({ ANTHROPIC_API_KEY: 'k' } as Env, {
    system: 'sys', model: 'claude-haiku-4-5-20251001',
    messages: [{ role: 'assistant', content: 'stray' }, { role: 'user', content: 'a' }, { role: 'user', content: [{ type: 'text', text: 'b' }] }],
  }, async (_url, init) => { body = JSON.parse(String(init?.body)); return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: '答え' }], usage: { input_tokens: 10, output_tokens: 4 } }); });
  assert.equal(body.model, 'claude-haiku-4-5-20251001');
  assert.deepEqual(body.messages, [{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }]);
  assert.deepEqual(result, { text: '答え', usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }, model: 'claude-haiku-4-5-20251001' });
});

test('OpenAI model: the chosen model is used when the endpoint supports it, otherwise the default', () => {
  const env = {} as Env;
  assert.equal(openAIModelForEndpoint(env, false, 'gpt-image-1.5'), 'gpt-image-1.5');
  assert.equal(openAIModelForEndpoint(env, false, null), 'gpt-image-2');
  assert.equal(openAIModelForEndpoint(env, true, 'gpt-image-1'), 'gpt-image-1');
  // gpt-image-2 is not an edit model here, so edits keep the default edit model.
  assert.equal(openAIModelForEndpoint(env, true, 'gpt-image-2'), 'gpt-image-1-mini');
  assert.equal(openAIModelForEndpoint(env, false, 'made-up'), 'gpt-image-2');
});

test('the settings list shows only models whose key is registered', () => {
  const none = availableAIModels({ AI_IMAGE_PROVIDER: 'openai' } as Env) as Json;
  assert.deepEqual(none.image.models, []);
  assert.deepEqual(none.text.models, []);
  const both = availableAIModels({ AI_IMAGE_PROVIDER: 'openai', OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' } as Env) as Json;
  assert.deepEqual(both.image.models.map((m: Json) => m.id), ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini']);
  assert.equal(both.image.models.find((m: Json) => m.id === 'gpt-image-2').edit, false);
  assert.deepEqual(both.image.defaults, { generate: 'gpt-image-2', edit: 'gpt-image-1-mini' });
  assert.deepEqual(both.text.models, CLAUDE_TEXT_MODELS);
  assert.equal(both.text.default, 'claude-sonnet-5-5');
});
