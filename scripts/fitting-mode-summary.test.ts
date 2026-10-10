import assert from 'node:assert/strict';
import test from 'node:test';
import { fittingModeSummary, UNDERWEAR_FITTING_INSTRUCTION } from '../src/lib/fittingBatch.ts';
import { createFittingBatchExecution } from '../src/lib/fittingBatchExecution.ts';

test('underwear mode adds the underwear instruction; regular mode leaves the summary alone', () => {
  assert.equal(fittingModeSummary('AIフィッティング / bra.png', 'regular'), 'AIフィッティング / bra.png');
  assert.equal(fittingModeSummary('AIフィッティング / bra.png', 'underwear'), `AIフィッティング / bra.png / ${UNDERWEAR_FITTING_INSTRUCTION}`);
});

test('a multi-task underwear task sends the underwear instruction to the provider', async () => {
  let body: Record<string, unknown> = {};
  const client = {
    origin: 'https://heavychain.app',
    async invokeProviderAction<T>(_action: string, sent: Record<string, unknown>) { body = sent; return {} as T; },
    async readImageAIRequest() { return {}; },
    async acknowledgeImageAction() {},
  };
  const execution = createFittingBatchExecution(client, { userId: 'u', brandId: 'b', featureId: 'ai-fitting' }, async () => {}, () => {});
  await execution.submit({ id: 't', requestId: 'r', status: 'ready', input: {
    garment: 'data:image/png;base64,AA==', garmentName: 'bra.png', model: null, mode: 'underwear',
    prompt: '', aspect: '自動', resolution: '1K', references: {},
  } });
  assert.match(String(body.productDescription), /^bra\.png \/ 下着モード/);
});
