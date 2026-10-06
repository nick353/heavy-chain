import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const source = fileURLToPath(new URL('../src/lib/workspaceActivity.ts', import.meta.url));
const originalJobId = 'ai-09f45686-5466-48c4-87c3-358465b0df7f';
const originalImageId = `${originalJobId}-0`;
const originalGalleryHref = `/gallery?image=${encodeURIComponent(`storage:generated-images/${originalImageId}`)}`;
const brandId = 'activity-fixture-brand';
const userId = 'activity-fixture-user';

// Execute the production loader and its identity/routing helpers. Only the
// authenticated read adapters and local storage are replaced with fixtures.
const adapters = {
  auth: 'export const withAuthSessionRecovery = operation => operation();',
  heavyWorkspace: 'export const isHeavyWorkspaceRuntime = () => true;',
  storage: 'export const withSignedImageUrls = async rows => rows;',
  localWorkspaceArtifacts: `
    export const listWorkspaceArtifacts = () => [];
    export const listWorkspaceArtifactsForActivity = () => [];
    export const listWorkspaceGeneratedImagesForActivity = () => [];
  `,
  cloudflareApi: `
    export const asGeneratedImageListRow = row => row;
    export const cloudflareDataPlane = {
      getImageUsage: async brand => ({ planName:'Beta', monthlyQuota:100,
        completedImages:1, runningImages:0, uncertainImages:0, remainingUnits:99 }),
      listGenerationJobs: async (brand, options) => {
        globalThis.fixture.calls.push({method:'jobs',brand,options});
        return structuredClone(globalThis.fixture.jobs);
      },
      listGeneratedImages: async (brand, options) => {
        globalThis.fixture.calls.push({method:'images',brand,options});
        return structuredClone(globalThis.fixture.images);
      },
      listWorkspaceExecutionSteps: async () => [],
    };
  `,
};

const compiled = await build({
  entryPoints: [source], bundle: true, write: false, platform: 'node',
  format: 'cjs', target: 'node22', define: { 'import.meta.env': '{"DEV":false}' },
  plugins: [{ name: 'activity-read-fixtures', setup(builder) {
    builder.onResolve({ filter: /^\.\/(auth|heavyWorkspace|storage|localWorkspaceArtifacts|cloudflareApi)$/ }, args => {
      if (args.importer !== source) return undefined;
      return { path: args.path.slice(2), namespace: 'activity-fixture' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'activity-fixture' }, args => ({ contents: adapters[args.path], loader: 'js' }));
  } }],
});

const job = (id, index, status = 'completed') => ({
  id, brand_id: brandId, user_id: userId, feature_type: 'lightchain-lab',
  prompt: `Saved job ${id}`, parameters: {}, status, requested_count: 1,
  error_message: status === 'failed' ? 'image_outcome_unknown' : null,
  created_at: new Date(Date.UTC(2026, 9, 2, 12, 0, -index)).toISOString(),
  completed_at: status === 'completed' ? new Date(Date.UTC(2026, 9, 2, 12, 0, -index)).toISOString() : null,
});

const originalImage = () => ({
  id: originalImageId, job_id: originalJobId, brand_id: brandId, user_id: userId,
  storage_path: `generated-images/${originalImageId}`, image_url: '',
  thumbnail_path: null, version: 1, parent_image_id: null,
  prompt: 'Original saved model-custom result', feature_type: 'lightchain-model-custom',
  model_used: 'gpt-image-2', generation_params: {}, metadata: { providerRequestId: originalJobId.slice(3) },
  is_favorite: false, created_at: '2026-09-29T08:54:37.000Z',
});

const loader = (jobs, images = []) => {
  const fixture = { jobs, images, calls: [] };
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, fixture,
    structuredClone, URL, URLSearchParams, console, setTimeout, clearTimeout });
  new vm.Script(compiled.outputFiles[0].text, { filename: source }).runInContext(context);
  return { load: options => module.exports.fetchWorkspaceActivity(brandId, userId, options), fixture };
};

test('older image-backed model-custom remains reachable after the first20 jobs', async () => {
  const { load, fixture } = loader(Array.from({ length: 25 }, (_, index) => job(`recent-${index}`, index)), [originalImage()]);
  const summary = await load();
  assert.equal(summary.completedJobs.length, 20);
  assert.equal(summary.timelineItems.length, 20);
  assert.equal(summary.completedJobs.some(item => item.id === originalJobId), false);

  const history = await load({ includeAllLoadedJobs: true });
  assert.equal(history.completedJobs.length, 26);
  assert.equal(history.timelineItems.length, 26);
  const restored = history.completedJobs.find(item => item.id === originalJobId);
  assert.ok(restored);
  assert.equal(restored.outputCount, 1);
  assert.equal(restored.outputHref, originalGalleryHref);
  assert.equal(history.timelineItems.at(-1).id, `job-${originalJobId}`);
  assert.equal(history.timelineItems.at(-1).href, restored.outputHref);
  assert.deepEqual(fixture.images[0].metadata, { providerRequestId: originalJobId.slice(3) });
  assert.ok(fixture.calls.every(call => call.brand === brandId && call.options.limit === 50 && call.options.offset === 0));
});

test('an older explicit job and its saved image keep one canonical history entry', async () => {
  const original = { ...job(originalJobId, 30), feature_type: 'lightchain-model-custom', created_at: '2026-09-29T08:54:37.000Z' };
  const { load } = loader([...Array.from({ length: 25 }, (_, index) => job(`recent-${index}`, index)), original], [originalImage()]);
  const activity = await load({ includeAllLoadedJobs: true });
  assert.equal(activity.completedJobs.length, 26);
  assert.equal(activity.timelineItems.filter(item => item.id === `job-${originalJobId}`).length, 1);
  assert.equal(activity.completedJobs.find(item => item.id === originalJobId).outputHref, originalGalleryHref);
  assert.ok(activity.timelineItems.every((item, index, list) => !index || list[index - 1].createdAt >= item.createdAt));
});

test('older pending and failed jobs retain their status while summary callers keep their bounds', async () => {
  const jobs = [
    ...Array.from({ length: 21 }, (_, index) => job(`pending-${index}`, index, 'pending')),
    ...Array.from({ length: 22 }, (_, index) => job(`failed-${index}`, 21 + index, 'failed')),
    job('completed', 43),
  ];
  const { load } = loader(jobs);
  const complete = await load({ includeAllLoadedJobs: true });
  assert.equal(complete.activeJobs.length, 21);
  assert.equal(complete.failedJobs.length, 22);
  assert.equal(complete.completedJobs.length, 1);
  assert.equal(complete.timelineItems.length, 44);
  assert.ok(complete.activeJobs.every(item => item.status === 'pending'));
  assert.ok(complete.failedJobs.every(item => item.status === 'failed'));
  const summary = await load({ includeAllLoadedJobs: false });
  assert.equal(summary.activeJobs.length, 20);
  assert.equal(summary.failedJobs.length, 20);
  assert.equal(summary.timelineItems.length, 20);
});
