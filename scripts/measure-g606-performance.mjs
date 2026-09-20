import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const OUT_DIR = path.resolve(process.env.G606_OUT_DIR || 'output/playwright/10m-product-readiness-g606');
const PORT = Number(process.env.G606_PORT || 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const IMAGE_COUNT = Number(process.env.G606_IMAGE_COUNT || 500);
const CANVAS_OBJECT_COUNT = Number(process.env.G606_CANVAS_OBJECT_COUNT || 180);
const MAX_READY_MS = Number(process.env.G606_MAX_READY_MS || 5000);
const MAX_INDEX_JS_BYTES = Number(process.env.G606_MAX_INDEX_JS_BYTES || 750000);
const MAX_CANVAS_JS_BYTES = Number(process.env.G606_MAX_CANVAS_JS_BYTES || 450000);
const MAX_HEAP_BYTES = Number(process.env.G606_MAX_HEAP_BYTES || 75000000);
const BRAND_ID = 'g606-brand';
const USER_ID = 'g606-user';

const LOCAL_CLOUDFLARE_MOCK_PREFIX = '/__g606/cloudflare';
const CLOUDFLARE_AUTH_TOKEN = 'g606-cloudflare-local-token';
const CANVAS_PROJECT_ID = 'g606-canvas-project';
const CANVAS_DOCUMENT_ID = '00000000-0000-4000-8000-000000000606';

const CLOUDFLARE_ENDPOINT_PATTERNS = Object.freeze([
  /^\/v1\/profile$/,
  /^\/v1\/brands(?:\/[^/]+)?(?:\/(?:members|invitations)(?:\/[^/]+)?)?$/,
  /^\/v1\/(?:folders|tags|style-presets)(?:\/[^/]+)?$/,
  /^\/v1\/image-folders$/,
  /^\/v1\/image-tags$/,
  /^\/v1\/generated-images(?:\/[^/]+)?$/,
  /^\/v1\/generation-jobs(?:\/[^/]+)?$/,
  /^\/v1\/workspace-execution-steps$/,
  /^\/v1\/image-ai\/usage$/,
  /^\/v1\/image-ai\/requests\/[^/]+$/,
  /^\/v1\/canvas-documents(?:\/[^/]+)?$/,
  /^\/v1\/media\/read$/,
  /^\/v1\/media\/[^/]+\/content$/,
  /^\/v1\/provider-actions\/[^/]+$/,
  /^\/v1\/workspace-artifacts$/,
]);

const isCloudflareAuthPath = (pathname) => (
  pathname === '/api/auth/get-session' || pathname === '/api/auth/ok'
);

export const isCloudflareContractPath = (pathname) => (
  CLOUDFLARE_ENDPOINT_PATTERNS.some((pattern) => pattern.test(pathname))
);

const isLocalCloudflareMockPath = (pathname) => {
  if (!pathname.startsWith(`${LOCAL_CLOUDFLARE_MOCK_PREFIX}/`)) return false;
  return isCloudflareContractPath(pathname.slice(LOCAL_CLOUDFLARE_MOCK_PREFIX.length));
};

const isLocalStaticPath = (pathname) => (
  !pathname.startsWith('/api/')
  && !pathname.startsWith('/v1/')
  && pathname !== LOCAL_CLOUDFLARE_MOCK_PREFIX
  && !pathname.startsWith(`${LOCAL_CLOUDFLARE_MOCK_PREFIX}/`)
);

const isExplicitStaticMock = (url) => (
  (
    url.hostname === 'fonts.googleapis.com'
    && url.pathname === '/css2'
  )
  || url.hostname === 'fonts.gstatic.com'
  || (
    url.hostname === 'jp.linkaigc.com'
    && url.pathname.startsWith('/routeIcons/')
  )
  || (
    url.hostname === 'jp.linkaigc.com'
    && url.pathname.startsWith('/static/')
    && /\.(?:png|jpe?g|webp|gif|svg)$/i.test(url.pathname)
  )
  || (
    url.hostname === 'ql-hangzhou-oss.oss-cn-hangzhou.aliyuncs.com'
    && url.pathname === '/AIDesign/saas-avatar-new.png'
  )
  || (
    url.hostname === 'static-cn.linkaigc.com'
    && /^\/(?:saas|workbenches)\/.*\.(?:png|jpe?g|webp|gif|mp4|webm)$/i.test(url.pathname)
  )
  || (
    url.hostname === 'lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com'
    && /^\/light-chain-platform\/home5_0_1\/.*\.(?:png|jpe?g|webp|gif|svg)$/i.test(url.pathname)
  )
  || (
    url.hostname === 'lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com'
    && /^\/light-chain-platform\/tools\/.*\.(?:mp4|webm)$/i.test(url.pathname)
  )
);

const isKnownCloudflareApiOrigin = (url) => (
  url.protocol === 'https:'
  && /^heavy-chain-api(?:\.[a-z0-9-]+)*\.workers\.dev$/i.test(url.hostname)
);

/**
 * The G606 browser may use a compiled Cloudflare Worker origin, but every
 * response is fulfilled by the local harness. This classifier is the single
 * network policy used by the route guard and focused contract tests.
 */
export const classifyG606NetworkRequest = (requestUrl, baseUrl = BASE_URL) => {
  let url;
  let localOrigin;
  try {
    url = new URL(requestUrl, baseUrl);
    localOrigin = new URL(baseUrl).origin;
  } catch {
    return { allowed: false, kind: 'blocked', reason: 'invalid_url' };
  }
  const local = url.origin === localOrigin;
  if (local && isCloudflareAuthPath(url.pathname)) {
    return { allowed: true, kind: 'cloudflare-auth-mock' };
  }
  if (local && (isLocalCloudflareMockPath(url.pathname) || isCloudflareContractPath(url.pathname))) {
    return { allowed: true, kind: 'cloudflare-data-mock' };
  }
  if (local && isLocalStaticPath(url.pathname)) {
    return { allowed: true, kind: 'local-static' };
  }
  if (isKnownCloudflareApiOrigin(url) && isCloudflareContractPath(url.pathname)) {
    return { allowed: true, kind: 'cloudflare-data-mock' };
  }
  if (isExplicitStaticMock(url)) {
    return { allowed: true, kind: 'explicit-static-mock' };
  }
  return { allowed: false, kind: 'blocked', reason: 'network_not_in_local_contract' };
};

const previewStartupError = (message, getLogs) => {
  const previewLogs = getLogs().join('').split('\n').slice(-12);
  const logTail = previewLogs.join('\n');
  const error = new Error(`${message}${logTail ? `\nPreview logs:\n${logTail}` : ''}`);
  error.previewLogs = previewLogs;
  return error;
};

const summaryPath = () => path.join(OUT_DIR, 'summary.json');

const readExistingSummary = async () => readFile(summaryPath(), 'utf8')
  .then((text) => JSON.parse(text))
  .catch(() => null);

const compactRun = (summary) => {
  if (!summary || typeof summary !== 'object') return null;
  const { runs: _runs, ...rest } = summary;
  return rest;
};

const writeSummary = async (result) => {
  const existingSummary = await readExistingSummary();
  const priorRuns = Array.isArray(existingSummary?.runs)
    ? existingSummary.runs
    : [compactRun(existingSummary)].filter(Boolean);
  const runId = result.runId ?? `g606-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const latest = { ...result, runId };
  const runs = [...priorRuns, compactRun(latest)].slice(-20);
  const summary = {
    ...latest,
    runHistory: {
      retainedRuns: runs.length,
      previousRunCount: priorRuns.length,
      maxRetainedRuns: 20,
    },
    runs,
  };
  await writeFile(summaryPath(), JSON.stringify(summary, null, 2));
  return summary;
};

const waitForServer = async (url, timeoutMs = 20000, getLogs = () => [], getPreviewExit = () => null) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const exit = getPreviewExit();
    if (exit) {
      throw previewStartupError(`Preview server exited before becoming ready: ${url} status=${exit.code ?? 'null'} signal=${exit.signal ?? 'null'}`, getLogs);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        const logText = getLogs().join('');
        if (!logText.includes('Local:') || !logText.includes(url)) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        const finalExit = getPreviewExit();
        if (finalExit) {
          throw previewStartupError(`Preview server exited while ready check was running: ${url} status=${finalExit.code ?? 'null'} signal=${finalExit.signal ?? 'null'}`, getLogs);
        }
        return;
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw previewStartupError(`Preview server did not become ready: ${url}`, getLogs);
};

const terminatePreview = async (preview, previewClosed) => {
  const proof = {
    pid: preview?.pid ?? null,
    processGroupTarget: preview?.pid ? -preview.pid : null,
    detachedProcessGroup: Boolean(preview?.spawnargs),
    sigtermSent: false,
    sigkillSent: false,
    closeObserved: false,
    groupAliveAfter: null,
    closedAfterSignal: null,
  };
  if (!preview?.pid) return { ...proof, note: 'preview_not_started' };
  const killTarget = preview.spawnargs ? -preview.pid : preview.pid;
  const isGroupAlive = () => {
    if (!preview.spawnargs) return false;
    try {
      process.kill(killTarget, 0);
      return true;
    } catch (error) {
      if (error?.code === 'ESRCH') return false;
      return true;
    }
  };
  const waitForGroupExit = async (timeoutMs) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!isGroupAlive()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return !isGroupAlive();
  };
  const waitForClose = (timeoutMs) => Promise.race([
    previewClosed.then(() => {
      proof.closeObserved = true;
      return true;
    }),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
  const killSafely = (signal) => {
    try {
      process.kill(killTarget, signal);
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        try {
          preview.kill(signal);
        } catch {
          // best effort cleanup
        }
      }
    }
  };

  proof.sigtermSent = true;
  killSafely('SIGTERM');
  if (await waitForClose(3000) && await waitForGroupExit(1000)) {
    proof.closedAfterSignal = 'SIGTERM';
    proof.groupAliveAfter = isGroupAlive();
    return proof;
  }
  proof.sigkillSent = true;
  killSafely('SIGKILL');
  if (await waitForClose(3000) && await waitForGroupExit(1000)) {
    proof.closedAfterSignal = 'SIGKILL';
    proof.groupAliveAfter = isGroupAlive();
    return proof;
  }
  proof.groupAliveAfter = isGroupAlive();
  throw new Error(`Preview process group did not close after SIGKILL: pid=${preview.pid}`);
};

const withTimeout = (promise, timeoutMs, message) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
]);

const collectBuildStats = async () => {
  const assetsDir = path.resolve('dist/assets');
  const files = await readdir(assetsDir);
  const assets = [];
  for (const file of files) {
    const fullPath = path.join(assetsDir, file);
    const info = await stat(fullPath);
    if (info.isFile()) {
      assets.push({ file, bytes: info.size });
    }
  }
  assets.sort((a, b) => b.bytes - a.bytes);
  return {
    largestAssets: assets.slice(0, 20),
    indexJs: assets.find((asset) => /^index\..*\.js$/.test(asset.file)) ?? null,
    galleryJs: assets.find((asset) => /^GalleryPage\..*\.js$/.test(asset.file)) ?? null,
    canvasJs: assets.find((asset) => /^CanvasEditorPage\..*\.js$/.test(asset.file)) ?? null,
    derivationTreeJs: assets.find((asset) => /^DerivationTree\..*\.js$/.test(asset.file)) ?? null,
  };
};

export const makeImages = () => {
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
      <rect width="240" height="240" fill="#f4f1eb"/>
      <path d="M70 48h100l18 42-24 12v90H76v-90L52 90z" fill="#806a54"/>
      <text x="120" y="216" text-anchor="middle" font-family="Arial" font-size="18" fill="#24211e">G606</text>
    </svg>
  `);
  const imageUrl = `data:image/svg+xml,${svg}`;
  return Array.from({ length: IMAGE_COUNT }, (_, index) => ({
    id: `g606-image-${index}`,
    job_id: `g606-job-${index}`,
    brand_id: BRAND_ID,
    user_id: USER_ID,
    storage_path: imageUrl,
    image_url: imageUrl,
    thumbnail_path: null,
    version: 1,
    parent_image_id: null,
    is_favorite: index % 11 === 0,
    created_at: new Date(Date.now() - index * 60000).toISOString(),
    expires_at: null,
    prompt: `G606 apparel performance sample ${index}`,
    negative_prompt: null,
    feature_type: index % 2 === 0 ? 'campaign-image' : 'product-shots',
    style_preset: index % 3 === 0 ? 'studio' : 'catalog',
    model_used: 'performance-fixture',
    generation_params: null,
    metadata: { g606: true, index, collection: index % 5 },
  }));
};

export const makeCanvasObjects = () => {
  return Array.from({ length: CANVAS_OBJECT_COUNT }, (_, index) => ({
    id: `g606-object-${index}`,
    type: index % 4 === 0 ? 'text' : 'image',
    x: 40 + (index % 8) * 220,
    y: 40 + Math.floor(index / 8) * 220,
    width: 86,
    height: 86,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    locked: false,
    visible: true,
    zIndex: index,
    // Use an absolute same-origin URL. Relative paths are intentionally not
    // accepted as generated-image references by the storage safety boundary.
    src: `${BASE_URL}/favicon.svg`,
    text: `G606 ${index}`,
    fontSize: 18,
    fontFamily: 'Inter',
    fill: '#262626',
    derivedFrom: index > 0 && index % 7 === 0 ? `g606-object-${index - 1}` : null,
    metadata: { feature: 'g606-stress', generation: index % 3, timestamp: new Date().toISOString() },
  }));
};

export const buildCanvasInitState = (canvasObjects = makeCanvasObjects(), brandId = BRAND_ID) => {
  const timestamp = new Date().toISOString();
  return {
    state: {
      currentProjectId: CANVAS_PROJECT_ID,
      currentProjectName: 'G606 Canvas Stress',
      projects: [{
        id: CANVAS_PROJECT_ID,
        name: 'G606 Canvas Stress',
        objects: canvasObjects,
        createdAt: timestamp,
        updatedAt: timestamp,
        brandId,
      }],
      objects: canvasObjects,
    },
    version: 0,
  };
};

export const createCloudflareContract = () => {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const images = makeImages();
  const canvasObjects = makeCanvasObjects();
  const user = {
    id: USER_ID,
    email: 'g606@example.invalid',
    name: 'G606 User',
    avatar_url: null,
    language: 'ja',
    is_admin: true,
    created_at: now,
    updated_at: now,
  };
  const brand = {
    id: BRAND_ID,
    owner_id: USER_ID,
    name: 'G606 Performance Brand',
    logo_url: null,
    brand_colors: null,
    tone_description: null,
    target_audience: null,
    role: 'owner',
    created_at: now,
    updated_at: now,
  };
  const authPayload = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: true,
      createdAt: user.created_at,
    },
    session: { token: CLOUDFLARE_AUTH_TOKEN, expiresAt },
  };
  const snapshot = {
    version: 1,
    localProjectId: CANVAS_PROJECT_ID,
    name: 'G606 Canvas Stress',
    objects: canvasObjects,
    view: { zoom: 1, panX: 0, panY: 0, gridVisible: true, snapToGrid: false, gridSize: 20 },
  };
  const canvasDocument = {
    id: CANVAS_DOCUMENT_ID,
    owner_id: USER_ID,
    brand_id: BRAND_ID,
    title: 'G606 Canvas Stress',
    snapshot,
    snapshot_version: 1,
    revision: 0,
    created_at: now,
    updated_at: now,
  };
  return {
    authPayload,
    user,
    profile: user,
    brand,
    images,
    canvasObjects,
    canvasDocument,
    canvasInitState: buildCanvasInitState(canvasObjects, brand.id),
  };
};

const responseBody = (body, status = 200, contentType = 'application/json') => ({
  status,
  contentType,
  body: contentType === 'application/json' ? JSON.stringify(body) : body,
});

const cloudflarePath = (pathname) => pathname.startsWith(`${LOCAL_CLOUDFLARE_MOCK_PREFIX}/`)
  ? pathname.slice(LOCAL_CLOUDFLARE_MOCK_PREFIX.length)
  : pathname;

const paginateImages = (request, images) => {
  const url = new URL(request.url());
  let result = [...images];
  if (url.searchParams.get('favorite') === 'true') result = result.filter((image) => image.is_favorite);
  if (url.searchParams.get('has_job') === 'true') result = result.filter((image) => image.job_id);
  if (url.searchParams.get('has_job') === 'false') result = result.filter((image) => !image.job_id);
  if (url.searchParams.get('order') === 'oldest') result.reverse();
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const limit = Math.min(100, Math.max(0, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 0));
  return result.slice(offset, offset + limit);
};

const handleCloudflareDataMock = async (route, contract, pathname) => {
  const request = route.request();
  const method = request.method().toUpperCase();
  const fulfill = (body, status = 200) => route.fulfill(responseBody(body, status));
  if (method === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    return;
  }
  if (request.headers().authorization !== `Bearer ${contract.authPayload.session.token}`) {
    await fulfill({ error: 'unauthorized' }, 401);
    return;
  }
  if (!['GET', 'HEAD'].includes(method)) {
    await fulfill({ error: 'g606_local_mock_write_blocked' }, 405);
    return;
  }
  if (method === 'HEAD') {
    await route.fulfill({ status: 200 });
    return;
  }
  if (pathname === '/v1/profile') {
    await fulfill(contract.profile);
    return;
  }
  if (pathname === '/v1/brands') {
    await fulfill([contract.brand]);
    return;
  }
  if (/^\/v1\/brands\/[^/]+$/.test(pathname)) {
    await fulfill(contract.brand);
    return;
  }
  if (/^\/v1\/brands\/[^/]+\/(?:members|invitations)(?:\/[^/]+)?$/.test(pathname)) {
    await fulfill([]);
    return;
  }
  if (/^\/v1\/(?:folders|image-folders|image-tags|tags|style-presets)$/.test(pathname)
    || /^\/v1\/(?:folders|tags|style-presets)\/[^/]+$/.test(pathname)) {
    await fulfill([]);
    return;
  }
  if (pathname === '/v1/generated-images') {
    await fulfill(paginateImages(request, contract.images));
    return;
  }
  if (/^\/v1\/generated-images\/[^/]+$/.test(pathname)) {
    const imageId = decodeURIComponent(pathname.split('/').pop() || '');
    await fulfill(contract.images.find((image) => image.id === imageId) || { error: 'not_found' }, contract.images.some((image) => image.id === imageId) ? 200 : 404);
    return;
  }
  if (pathname === '/v1/generation-jobs' || pathname === '/v1/workspace-execution-steps') {
    await fulfill([]);
    return;
  }
  if (pathname === '/v1/image-ai/usage') {
    await fulfill({
      planName: 'g606-local',
      monthlyQuota: 25,
      remainingUnits: 25,
      completedImages: 0,
      runningImages: 0,
      uncertainImages: 0,
      attemptedImages: 0,
      estimatedMicroUSD: 0,
      estimatedNeurons: 0,
      unknownEstimateCount: 0,
      averageInferenceMs: null,
      periodStart: new Date(0).toISOString(),
      periodEnd: new Date(Date.now() + 86400000).toISOString(),
      imageAIEnabled: false,
      billing: 'estimate_not_invoice',
      accountFreeAllocationRemaining: null,
      accountWideBudgetGuaranteed: false,
    });
    return;
  }
  if (pathname === '/v1/canvas-documents') {
    await fulfill([contract.canvasDocument]);
    return;
  }
  if (/^\/v1\/canvas-documents\/[^/]+$/.test(pathname)) {
    const id = decodeURIComponent(pathname.split('/').pop() || '');
    await fulfill({ ...contract.canvasDocument, id });
    return;
  }
  if (pathname === '/v1/media/read') {
    await fulfill({ url: contract.images[0]?.image_url ?? '' });
    return;
  }
  if (/^\/v1\/media\/[^/]+\/content$/.test(pathname)) {
    const imageUrl = contract.images[0]?.image_url || '';
    const body = imageUrl.startsWith('data:image/svg+xml,') ? decodeURIComponent(imageUrl.slice('data:image/svg+xml,'.length)) : '';
    await route.fulfill(responseBody(body, 200, 'image/svg+xml'));
    return;
  }
  if (/^\/v1\/image-ai\/requests\/[^/]+$/.test(pathname)) {
    await fulfill({ error: 'not_found' }, 404);
    return;
  }
  if (pathname === '/v1/provider-actions' || pathname.startsWith('/v1/provider-actions/')) {
    await fulfill({ error: 'g606_local_mock_write_blocked' }, 405);
    return;
  }
  if (pathname === '/v1/workspace-artifacts') {
    await fulfill({ error: 'g606_local_mock_write_blocked' }, 405);
    return;
  }
  // Keep the request policy fail-closed if the endpoint table and response
  // table ever drift apart.
  await route.abort('blockedbyclient');
};

const fulfillExplicitStaticMock = async (route, url) => {
  if (url.hostname === 'fonts.googleapis.com') {
    await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    return;
  }
  if (url.hostname === 'fonts.gstatic.com') {
    await route.fulfill({ status: 200, contentType: 'font/woff2', body: Buffer.alloc(0) });
    return;
  }
  if (url.hostname === 'jp.linkaigc.com') {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="#62d5d2"/></svg>',
    });
    return;
  }
  if (/\.(?:png|jpe?g|webp|gif|svg)$/i.test(url.pathname)) {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="#62d5d2"/></svg>',
    });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.alloc(0) });
};

const installG606NetworkGuard = async (browserContext, contract) => {
  await browserContext.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const decision = classifyG606NetworkRequest(url.toString());
    if (!decision.allowed) {
      await route.abort('blockedbyclient');
      return;
    }
    if (decision.kind === 'cloudflare-auth-mock') {
      const body = url.pathname === '/api/auth/ok' ? { ok: true } : contract.authPayload;
      await route.fulfill(responseBody(body));
      return;
    }
    if (decision.kind === 'cloudflare-data-mock') {
      await handleCloudflareDataMock(route, contract, cloudflarePath(url.pathname));
      return;
    }
    if (decision.kind === 'explicit-static-mock') {
      await fulfillExplicitStaticMock(route, url);
      return;
    }
    await route.continue();
  });
};

const setupMockedApp = async (page, browserContext) => {
  const contract = createCloudflareContract();
  await installG606NetworkGuard(browserContext, contract);
  await page.addInitScript(({ canvasInitState }) => {
    window.localStorage.setItem('heavy-chain-canvas', JSON.stringify(canvasInitState));
  }, { canvasInitState: contract.canvasInitState });
};

const measureRoute = async (page, route, readySelector) => {
  const started = Date.now();
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.locator(readySelector).first().waitFor({ state: 'visible', timeout: 15000 });
  } catch (error) {
    const debug = {
      route,
      readySelector,
      url: page.url(),
      title: await page.title().catch(() => null),
      bodyText: await page.locator('body').innerText({ timeout: 1000 }).catch(() => null),
    };
    await writeFile(
      path.join(OUT_DIR, `debug-${route.replace(/[^a-z0-9]+/gi, '-') || 'root'}.json`),
      JSON.stringify(debug, null, 2)
    );
    await page.screenshot({
      path: path.join(OUT_DIR, `debug-${route.replace(/[^a-z0-9]+/gi, '-') || 'root'}.png`),
      fullPage: true,
    }).catch(() => {});
    throw error;
  }
  const readyMs = Date.now() - started;
  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource')
      .filter((entry) => /\.(js|css)(\?|$)/.test(entry.name))
      .map((entry) => ({
        name: entry.name.split('/').pop(),
        transferSize: entry.transferSize,
        duration: Math.round(entry.duration),
      }));
    return {
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadEventMs: nav ? Math.round(nav.loadEventEnd) : null,
      resources,
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
    };
  });
  return { route, readyMs, ...metrics };
};

const inspectCanvasRender = async (page) => page.evaluate(() => {
  const canvases = Array.from(document.querySelectorAll('canvas'));
  const stats = canvases.map((canvas, index) => {
    const context = canvas.getContext('2d');
    let nonBlankSamples = 0;
    let coloredSamples = 0;
    let sampledPixels = 0;
    if (context && canvas.width > 0 && canvas.height > 0) {
      const sampleWidth = canvas.width;
      const sampleHeight = canvas.height;
      const imageData = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
      const stride = Math.max(4, Math.floor((sampleWidth * sampleHeight) / 2000) * 4);
      for (let i = 0; i < imageData.length; i += stride) {
        sampledPixels += 1;
        if (imageData[i + 3] > 0 && (imageData[i] !== 0 || imageData[i + 1] !== 0 || imageData[i + 2] !== 0)) {
          nonBlankSamples += 1;
        }
        if (
          imageData[i + 3] > 0
          && (
            Math.abs(imageData[i] - imageData[i + 1]) > 10
            || Math.abs(imageData[i + 1] - imageData[i + 2]) > 10
            || Math.abs(imageData[i] - imageData[i + 2]) > 10
          )
        ) {
          coloredSamples += 1;
        }
      }
    }
    return {
      index,
      width: canvas.width,
      height: canvas.height,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      nonBlankSamples,
      coloredSamples,
      sampledPixels,
    };
  });
  return {
    canvasCount: canvases.length,
    stats,
    nonBlankCanvasCount: stats.filter((item) => item.nonBlankSamples > 0).length,
    coloredCanvasCount: stats.filter((item) => item.coloredSamples > 0).length,
  };
});

const readPngDimensions = async (filePath) => {
  const buffer = await readFile(filePath);
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    return { width: null, height: null, validPng: false };
  }
  const edgeColorSamples = inspectPngEdgeColorSamples(buffer);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    validPng: true,
    edgeColorSamples,
  };
};

const inspectPngEdgeColorSamples = (buffer) => {
  try {
    const png = decodePngRgba(buffer);
    const sampleBand = Math.min(320, Math.floor(png.height / 4));
    const top = countColoredPixels(png, 0, sampleBand);
    const bottom = countColoredPixels(png, Math.max(0, png.height - sampleBand), png.height);
    return { top, bottom, sampleBand };
  } catch (error) {
    return { top: 0, bottom: 0, sampleBand: 0, error: error instanceof Error ? error.message : String(error) };
  }
};

const decodePngRgba = (buffer) => {
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error('invalid png signature');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(`unsupported png format:${bitDepth}:${colorType}`);
  }
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const stride = width * bytesPerPixel;
  const rgba = Buffer.alloc(width * height * 4);
  let inputOffset = 0;
  let prior = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const row = Buffer.from(inflated.subarray(inputOffset, inputOffset + stride));
    inputOffset += stride;
    applyPngFilter(row, prior, bytesPerPixel, filter);
    for (let x = 0; x < width; x += 1) {
      const source = x * bytesPerPixel;
      const target = (y * width + x) * 4;
      rgba[target] = row[source];
      rgba[target + 1] = row[source + 1];
      rgba[target + 2] = row[source + 2];
      rgba[target + 3] = colorType === 6 ? row[source + 3] : 255;
    }
    prior = row;
  }
  return { width, height, rgba };
};

const applyPngFilter = (row, prior, bytesPerPixel, filter) => {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = prior[index] || 0;
    const upLeft = index >= bytesPerPixel ? prior[index - bytesPerPixel] || 0 : 0;
    if (filter === 1) {
      row[index] = (row[index] + left) & 255;
    } else if (filter === 2) {
      row[index] = (row[index] + up) & 255;
    } else if (filter === 3) {
      row[index] = (row[index] + Math.floor((left + up) / 2)) & 255;
    } else if (filter === 4) {
      row[index] = (row[index] + paethPredictor(left, up, upLeft)) & 255;
    } else if (filter !== 0) {
      throw new Error(`unsupported png filter:${filter}`);
    }
  }
};

const paethPredictor = (left, up, upLeft) => {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
};

const countColoredPixels = ({ width, rgba }, startY, endY) => {
  let colored = 0;
  for (let y = startY; y < endY; y += 1) {
    for (let x = 0; x < width; x += 12) {
      const index = (y * width + x) * 4;
      const alpha = rgba[index + 3];
      const red = rgba[index];
      const green = rgba[index + 1];
      const blue = rgba[index + 2];
      if (
        alpha > 0 &&
        (
          Math.abs(red - green) > 10 ||
          Math.abs(green - blue) > 10 ||
          Math.abs(red - blue) > 10
        )
      ) {
        colored += 1;
      }
    }
  }
  return colored;
};

const exportCanvasPng = async (page) => {
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.getByTitle('エクスポート').first().click();
  let download;
  try {
    download = await downloadPromise;
  } catch (error) {
    const debug = await page.evaluate(() => ({
      url: location.href,
      exportState: document.body.dataset.canvasExportLastResult ?? null,
      renderState: document.body.dataset.canvasRenderState ?? null,
      persistedObjectCount: (() => {
        try {
          return JSON.parse(localStorage.getItem('heavy-chain-canvas') || '{}')?.state?.objects?.length ?? null;
        } catch {
          return null;
        }
      })(),
      buttons: Array.from(document.querySelectorAll('[title="エクスポート"]')).map((button) => ({
        disabled: button instanceof HTMLButtonElement ? button.disabled : null,
        text: button.textContent?.trim() ?? '',
      })),
      canvasCount: document.querySelectorAll('canvas').length,
    })).catch(() => null);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} canvas_export_debug=${JSON.stringify(debug)}`);
  }
  const filePath = path.join(OUT_DIR, 'canvas-stress-export.png');
  await download.saveAs(filePath);
  const dimensions = await readPngDimensions(filePath);
  const info = await stat(filePath);
  return {
    path: filePath,
    bytes: info.size,
    ...dimensions,
  };
};

const waitForCanvasObjectRender = async (page, timeoutMs = 5000) => {
  const started = Date.now();
  let latest = await inspectCanvasRender(page);
  while (Date.now() - started < timeoutMs) {
    if (latest.coloredCanvasCount > 0) return latest;
    await page.waitForTimeout(250);
    latest = await inspectCanvasRender(page);
  }
  return latest;
};

const isActionableRequestFailure = (failure) => {
  if (!failure?.url) return true;
  if (
    failure.failure === 'net::ERR_ABORTED'
    && /^(https:\/\/fonts\.gstatic\.com\/|https:\/\/images\.unsplash\.com\/)/.test(failure.url)
  ) {
    return false;
  }
  // The launcher intentionally lazy-loads its Heavy-owned card artwork. When
  // the route advances immediately after its ready selector appears, cards
  // still below the viewport can be aborted by navigation. This is not a
  // missing asset or HTTP failure; keep other local request failures strict.
  if (
    failure.failure === 'net::ERR_ABORTED'
    && failure.url.startsWith(`${BASE_URL}/assets/lightchain-cards/`)
  ) {
    return false;
  }
  // Video is explicitly outside the Heavy Chain beta scope. Lightchain's
  // launcher may begin loading a source video before the local route moves
  // on; navigation aborts that request and should not invalidate image-only
  // performance measurements.
  if (
    failure.failure === 'net::ERR_ABORTED'
    && /^https:\/\/lightchain-qlxy-prod\.oss-cn-hangzhou\.aliyuncs\.com\/light-chain-platform\/tools\/.*\.(?:mp4|webm)(?:\?.*)?$/i.test(failure.url)
  ) {
    return false;
  }
  return true;
};

const isActionableConsoleError = (message) => {
  if (!message) return false;
  if (/Failed to load resource/i.test(message) && /404|ERR_ABORTED/i.test(message)) {
    // URL/status-specific resource failures are handled by response/request hooks.
    return false;
  }
  return true;
};

const addPerformanceIssues = ({ issues, routes, buildStats, canvasRender, canvasExport, galleryTileCount }) => {
  for (const route of routes) {
    if (route.readyMs > MAX_READY_MS) {
      issues.push(`route_ready_ms_exceeded:${route.route}:${route.readyMs}`);
    }
    if (!Number.isFinite(route.heapBytes)) {
      issues.push(`route_heap_missing:${route.route}`);
    } else if (route.heapBytes > MAX_HEAP_BYTES) {
      issues.push(`route_heap_exceeded:${route.route}:${route.heapBytes}`);
    }
  }
  if (!buildStats.indexJs) {
    issues.push('index_js_missing');
  } else if (buildStats.indexJs.bytes > MAX_INDEX_JS_BYTES) {
    issues.push(`index_js_bytes_exceeded:${buildStats.indexJs.bytes}`);
  }
  if (!buildStats.galleryJs) {
    issues.push('gallery_js_missing');
  }
  if (!buildStats.canvasJs) {
    issues.push('canvas_js_missing');
  } else if (buildStats.canvasJs.bytes > MAX_CANVAS_JS_BYTES) {
    issues.push(`canvas_js_bytes_exceeded:${buildStats.canvasJs.bytes}`);
  }
  if (!buildStats.derivationTreeJs) {
    issues.push('derivation_tree_lazy_chunk_missing');
  }
  if (galleryTileCount > 60) {
    issues.push(`gallery_initial_tiles_exceeded:${galleryTileCount}`);
  }
  if (!canvasRender.canvasCount) {
    issues.push('canvas_element_missing');
  }
  if (!canvasRender.nonBlankCanvasCount) {
    issues.push('canvas_nonblank_pixel_missing');
  }
  if (!canvasRender.coloredCanvasCount) {
    issues.push('canvas_colored_object_pixel_missing');
  }
  const stableCanvas = canvasRender.stats.some((item) => item.clientWidth >= 250 && item.clientHeight >= 250);
  if (!stableCanvas) {
    issues.push('canvas_stable_dimensions_missing');
  }
  if (!canvasExport?.validPng) {
    issues.push('canvas_export_png_invalid');
  }
  if (Number(canvasExport?.width || 0) <= 3000 || Number(canvasExport?.height || 0) <= 8000) {
    issues.push(`canvas_export_bounds_too_small:${canvasExport?.width || 0}x${canvasExport?.height || 0}`);
  }
  if (Number(canvasExport?.edgeColorSamples?.top || 0) <= 20 || Number(canvasExport?.edgeColorSamples?.bottom || 0) <= 20) {
    issues.push(`canvas_export_edge_pixels_missing:${canvasExport?.edgeColorSamples?.top || 0}:${canvasExport?.edgeColorSamples?.bottom || 0}`);
  }
};

const run = async () => {
  await mkdir(OUT_DIR, { recursive: true });
  for (const file of await readdir(OUT_DIR).catch(() => [])) {
    if (file.startsWith('debug-')) {
      await rm(path.join(OUT_DIR, file), { force: true });
    }
  }

  const preview = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  });
  const logs = [];
  let previewExit = null;
  const previewClosed = new Promise((resolve) => {
    preview.on('close', (code, signal) => resolve({ code, signal }));
  });
  preview.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  preview.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  preview.on('exit', (code, signal) => {
    previewExit = { code, signal };
  });

  let browser;
  let context;
  let runError = null;
  let currentResult = {
    ok: false,
    measuredAt: new Date().toISOString(),
    phase: 'preview-started',
    fixture: { imageCount: IMAGE_COUNT, canvasObjectCount: CANVAS_OBJECT_COUNT },
    thresholds: {
      maxReadyMs: MAX_READY_MS,
      maxIndexJsBytes: MAX_INDEX_JS_BYTES,
      maxCanvasJsBytes: MAX_CANVAS_JS_BYTES,
      maxHeapBytes: MAX_HEAP_BYTES,
    },
    issues: ['verification_incomplete'],
    previewLogs: [],
  };
  const browserEvents = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    responseErrors: [],
  };
  try {
    currentResult.phase = 'waiting-for-preview';
    await waitForServer(BASE_URL, 20000, () => logs, () => previewExit);
    currentResult.phase = 'launching-browser';
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') {
        browserEvents.consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      browserEvents.pageErrors.push(error.message);
    });
    page.on('requestfailed', (request) => {
      browserEvents.requestFailures.push({
        url: request.url(),
        method: request.method(),
        failure: request.failure()?.errorText ?? null,
      });
    });
    page.on('response', (response) => {
      const status = response.status();
      if (status < 400) return;
      browserEvents.responseErrors.push({
        url: response.url(),
        status,
        statusText: response.statusText(),
      });
    });
    await setupMockedApp(page, context);

    currentResult.phase = 'measuring-routes';
    const routes = [];
    // The unified Heavy workbench intentionally opens on the Lightchain parity
    // surface. Keep the performance fixture aligned with the current product
    // route instead of waiting for the retired Heavy Chain landing copy.
    routes.push(await measureRoute(page, '/', '[data-testid="design-production-page"]'));
    routes.push(await measureRoute(page, '/tools/fabric', '[data-testid="lightchain-material-workbench"]'));
    // `/tools/printing` is the current parity page, not the fabric workbench.
    // Wait on its active visible tab so the performance fixture follows the
    // current route contract instead of a retired workbench test id.
    routes.push(await measureRoute(page, '/tools/printing', '[role="tab"][aria-selected="true"]'));
    routes.push(await measureRoute(page, '/model', '[data-testid="fitting-action-panel"]'));
    routes.push(await measureRoute(page, '/gallery', 'text=ギャラリー'));
    await page.waitForFunction(
      () => document.querySelectorAll('[data-g606-gallery-tile], .group.relative.aspect-square').length >= 60,
      null,
      { timeout: 5000 },
    ).catch(() => {});
    const galleryTileCount = await page.locator('[data-g606-gallery-tile], .group.relative.aspect-square').count();
    await page.screenshot({ path: path.join(OUT_DIR, 'gallery-stress.png'), fullPage: true });

    routes.push(await measureRoute(page, '/canvas/g606-canvas-project', 'text=G606 Canvas Stress'));
    const canvasObjectCount = await page.evaluate(() => JSON.parse(localStorage.getItem('heavy-chain-canvas') || '{}')?.state?.objects?.length ?? null);
    const canvasRender = await waitForCanvasObjectRender(page);
    await page.screenshot({ path: path.join(OUT_DIR, 'canvas-stress.png'), fullPage: true });
    const canvasExport = await exportCanvasPng(page);

    const buildStats = await collectBuildStats();
    const issues = [];
    if (previewExit) {
      issues.push(`preview_process_exited:${previewExit.code ?? 'null'}:${previewExit.signal ?? 'null'}`);
    }
    if (canvasObjectCount !== CANVAS_OBJECT_COUNT) {
      issues.push(`canvas_object_count_mismatch:${canvasObjectCount}`);
    }
    addPerformanceIssues({ issues, routes, buildStats, canvasRender, canvasExport, galleryTileCount });
    const actionableConsoleErrors = browserEvents.consoleErrors.filter(isActionableConsoleError);
    const actionableRequestFailures = browserEvents.requestFailures.filter(isActionableRequestFailure);
    const actionableResponseErrors = browserEvents.responseErrors.filter((response) => {
      try {
        return new URL(response.url).origin === BASE_URL;
      } catch {
        return true;
      }
    });
    browserEvents.actionableConsoleErrors = actionableConsoleErrors;
    browserEvents.actionableRequestFailures = actionableRequestFailures;
    browserEvents.actionableResponseErrors = actionableResponseErrors;
    if (actionableConsoleErrors.length) {
      issues.push(`console_errors:${actionableConsoleErrors.length}`);
    }
    if (browserEvents.pageErrors.length) {
      issues.push(`page_errors:${browserEvents.pageErrors.length}`);
    }
    if (actionableRequestFailures.length) {
      issues.push(`request_failures:${actionableRequestFailures.length}`);
    }
    if (actionableResponseErrors.length) {
      issues.push(`response_errors:${actionableResponseErrors.length}`);
    }
    const ok = issues.length === 0;

    currentResult = {
      ok,
      measuredAt: new Date().toISOString(),
      phase: 'measured',
      fixture: { imageCount: IMAGE_COUNT, canvasObjectCount: CANVAS_OBJECT_COUNT },
      thresholds: {
        maxReadyMs: MAX_READY_MS,
        maxIndexJsBytes: MAX_INDEX_JS_BYTES,
        maxCanvasJsBytes: MAX_CANVAS_JS_BYTES,
        maxHeapBytes: MAX_HEAP_BYTES,
      },
      buildStats,
      routeMetrics: routes,
      galleryStress: {
        totalImages: IMAGE_COUNT,
        renderedTilesInitial: galleryTileCount,
        expectedInitialCap: 60,
      },
      canvasStress: {
        persistedObjects: canvasObjectCount,
        render: canvasRender,
        export: canvasExport,
      },
      browserEvents,
      issues,
      previewLogs: logs.join('').split('\n').slice(-20),
    };
    if (!ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    runError = error;
    currentResult = {
      ...currentResult,
      ok: false,
      measuredAt: currentResult.measuredAt ?? new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      issues: [
        ...new Set([
          ...(currentResult.issues ?? []),
          `verification_failed:${currentResult.phase ?? 'unknown'}`,
        ]),
      ],
      previewLogs: Array.isArray(error?.previewLogs) && error.previewLogs.length
        ? error.previewLogs
        : logs.join('').split('\n').slice(-20),
    };
    process.exitCode = 1;
    throw error;
  } finally {
    const cleanupErrors = [];
    const cleanupProof = {
      browserClose: { attempted: Boolean(browser), ok: true, error: null },
      previewProcessCleanup: null,
    };
    if (browser) {
      if (context) {
        try {
          await withTimeout(context.close(), 10000, 'browser.context.close timed out');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          cleanupErrors.push(`browser_context_close_failed:${message}`);
        }
      }
      try {
        await withTimeout(browser.close(), 10000, 'browser.close timed out');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        cleanupProof.browserClose = { attempted: true, ok: false, error: message };
        cleanupErrors.push(`browser_close_failed:${message}`);
      }
    }
    try {
      cleanupProof.previewProcessCleanup = await terminatePreview(preview, previewClosed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cleanupProof.previewProcessCleanup = {
        pid: preview?.pid ?? null,
        ok: false,
        error: message,
      };
      cleanupErrors.push(`preview_cleanup_failed:${message}`);
    }
    currentResult.cleanup = cleanupProof;
    currentResult.previewLogs = currentResult.previewLogs?.length
      ? currentResult.previewLogs
      : logs.join('').split('\n').slice(-20);
    if (cleanupErrors.length) {
      currentResult.ok = false;
      currentResult.issues = [...(currentResult.issues ?? []), ...cleanupErrors];
      process.exitCode = 1;
    }
    const persisted = await writeSummary(currentResult);
    console.log(JSON.stringify(persisted, null, 2));
    if (runError && typeof runError === 'object') {
      runError.summaryWritten = true;
    }
    if (cleanupErrors.length) {
      const cleanupError = new Error(`G606 cleanup failed: ${cleanupErrors.join('; ')}`);
      cleanupError.summaryWritten = true;
      throw cleanupError;
    }
  }
};

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) run().catch(async (error) => {
  if (error?.summaryWritten) {
    console.error(error);
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });
  const previewLogs = Array.isArray(error?.previewLogs) ? error.previewLogs : [];
  const result = {
    ok: false,
    measuredAt: new Date().toISOString(),
    phase: 'pre-summary-failure',
    error: error instanceof Error ? error.message : String(error),
    previewLogs,
    issues: ['pre_summary_failure'],
    cleanup: null,
    note: 'Verifier failed before normal summary assembly. No previous success fields were merged into this run.',
  };
  await writeSummary(result);
  console.error(error);
  process.exit(1);
});
