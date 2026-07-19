import assert from 'node:assert/strict';
import test from 'node:test';
import { createClothModelWarmupController } from '../src/features/printing/selection/clothModelWarmup.ts';

test('concurrent warmup calls create and initialize one shared session', async () => {
  let created = 0;
  let initialized = 0;
  let releaseInitialization!: () => void;
  const initializationGate = new Promise<void>((resolve) => {
    releaseInitialization = resolve;
  });
  const session = { id: 'cloth' };
  const controller = createClothModelWarmupController({
    createSession: async () => {
      created += 1;
      return session;
    },
    initializeSession: async (value) => {
      initialized += 1;
      assert.equal(value, session);
      await initializationGate;
    },
  });
  const first = controller.warmup();
  const second = controller.warmup();
  assert.ok(controller.getInitializationPromise());
  releaseInitialization();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(created, 1);
  assert.equal(initialized, 1);
  assert.deepEqual(firstResult, { status: 'ready', reused: false });
  assert.deepEqual(secondResult, { status: 'ready', reused: true });
  assert.equal(controller.isReady(), true);
  assert.equal(await controller.getSession(), session);
});

test('failed initialization can be retried with a fresh session', async () => {
  let attempts = 0;
  let created = 0;
  const controller = createClothModelWarmupController({
    createSession: async () => ({ id: `cloth-${++created}` }),
    initializeSession: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('initialization_failed');
    },
  });
  await assert.rejects(() => controller.warmup(), /initialization_failed/);
  assert.equal(controller.isReady(), false);
  assert.equal(controller.getInitializationPromise(), null);
  const result = await controller.warmup();
  assert.deepEqual(result, { status: 'ready', reused: false });
  assert.equal(attempts, 2);
  assert.equal(created, 2);
  assert.equal(controller.isReady(), true);
});

test('a ready controller does not initialize again', async () => {
  let initialized = 0;
  const controller = createClothModelWarmupController({
    createSession: async () => ({ id: 'cloth' }),
    initializeSession: async () => {
      initialized += 1;
    },
  });
  await controller.warmup();
  const second = await controller.warmup();
  assert.deepEqual(second, { status: 'ready', reused: true });
  assert.equal(initialized, 1);
});

test('hung initialization times out once and later callers fail immediately while it is still owned', async () => {
  const controller = createClothModelWarmupController({
    createSession: async () => ({ id: 'cloth' }),
    initializeSession: async () => new Promise<void>(() => undefined),
    initializationTimeoutMilliseconds: 15,
  });
  await assert.rejects(() => controller.warmup(), /rembg_timeout:initialize_cloth_model_warmup/);
  assert.equal(controller.getStatus(), 'timed-out');
  const startedAt = Date.now();
  await assert.rejects(() => controller.warmup(), /rembg_timeout:initialize_cloth_model_warmup/);
  assert.ok(Date.now() - startedAt < 50);
});

test('concurrent subscribers receive shared progress and a later subscriber gets the latest value', async () => {
  let publishProgress!: (progress: { step: string; progress: number; message: string }) => void;
  let releaseInitialization!: () => void;
  const initializationGate = new Promise<void>((resolve) => {
    releaseInitialization = resolve;
  });
  const controller = createClothModelWarmupController({
    createSession: async (onProgress) => {
      publishProgress = onProgress!;
      return { id: 'cloth' };
    },
    initializeSession: async () => initializationGate,
  });
  const firstProgress: number[] = [];
  const secondProgress: number[] = [];
  const first = controller.warmup((progress) => firstProgress.push(progress.progress));
  await new Promise((resolve) => setTimeout(resolve, 0));
  publishProgress({ step: 'download', progress: 50, message: 'half' });
  const second = controller.warmup((progress) => secondProgress.push(progress.progress));
  publishProgress({ step: 'download', progress: 75, message: 'more' });
  releaseInitialization();
  await Promise.all([first, second]);
  assert.deepEqual(firstProgress, [50, 75]);
  assert.deepEqual(secondProgress, [50, 75]);
});
