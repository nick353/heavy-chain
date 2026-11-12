import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Production 2026-11-12: the task kept the first 12,000 characters of every reply, so the AI's slides (13,467 and 16,952
// characters, tasks 7345ee51 and 69610dac) lost their last pages and the page showed the fixed report instead. The research
// (report, sources, cited sentences and the shop search's products) is near that length too, and its `[引用]` block is last.
const tasks = readFileSync(new URL('../src/features/agent/agentTasks.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');

test('the slides and the research keep their whole reply; the other replies keep 12,000 characters', async () => {
  // agentTasks.ts imports the API client, so its two small functions are read from the source and run here.
  const max = tasks.match(/export const AGENT_STEP_CONTENT_MAX = (\d+);/);
  assert.equal(max?.[1], '12000');
  const body = tasks.match(/export const agentStepContentMax = \(kind: string\) => (\(.*\));/)?.[1];
  assert.ok(body);
  const agentStepContentMax = new Function('kind', 'AGENT_STEP_CONTENT_MAX', `return ${body};`) as (kind: string, fallback: number) => number;
  assert.equal(agentStepContentMax('report', 12000), 120000);
  assert.equal(agentStepContentMax('research', 12000), 40000);
  assert.equal(agentStepContentMax('theme', 12000), 12000);
  assert.match(tasks, /content: receipt\.content\.slice\(0, maxChars\)/);
  assert.doesNotMatch(tasks, /receipt\.content\.slice\(0, 12000\)/);
});

test('the page keeps each step\'s whole reply when it sends or reads it back, and reads cut slides back once', () => {
  assert.match(page, /result = assistantStepFrom\(receipt, step\.requestId, agentStepContentMax\(kind\)\);/);
  assert.match(page, /result = await pollAssistant\(result, conversationId, agentStepContentMax\(kind\)\);/);
  assert.match(page, /return assistantStepFrom\(receipt, step\.requestId, maxChars\);/);
  assert.match(page, /current\.step\.content\?\.length === AGENT_STEP_CONTENT_MAX && !reportReread\.current\.has\(current\.step\.requestId\)/);
  assert.match(page, /void runAssistant\('report', \{ \.\.\.current\.step, state: 'running' \}, null, applyReport, 'agent-report'\);/);
});
