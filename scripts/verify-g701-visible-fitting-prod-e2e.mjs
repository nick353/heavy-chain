#!/usr/bin/env node

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { chromium } from '@playwright/test';

const args = parseArgs(process.argv.slice(2));
await loadEnvFile('.env.production.local');
await loadEnvFile('.env');

const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'https://heavy-chain.zeabur.app');
const outDir = args.out || `output/playwright/g701-visible-fitting-prod-${dateStamp()}`;
const authState = args.authState || process.env.HEAVY_CHAIN_AUTH_STATE || 'output/playwright/g689-prod-temp-auth-r2/auth-state.json';
const imagePath = args.image || 'output/playwright/g684-live-fitting-operation-r1/shirt-input-from-user-screenshot.png';
const headed = args.headed !== 'false';
const submit = args.submit === true || args.submit === 'true';
const acceptVisualQuality = args.acceptVisualQuality === true || args.acceptVisualQuality === 'true';
const visualReviewer = args.visualReviewer || args.reviewer || '';
const visualReviewArtifact = args.visualReviewArtifact || args.reviewedArtifact || '';
const reviewSummary = args.reviewSummary || '';
const timeoutMs = Number(args.timeoutMs || 180000);

await fs.mkdir(outDir, { recursive: true });

const evidence = {
  schema: 'heavy-chain.g701.visible-fitting-prod-e2e.v1',
  startedAt: new Date().toISOString(),
  baseUrl,
  outDir,
  authState,
  imagePath,
  headed,
  submit,
  mode: submit ? 'submit-e2e' : 'preflight-only',
  irreversibleActions: {
    generationSubmit: submit ? 'one_user_requested_model_matrix_submit' : 'not_clicked',
    purchasePaymentCheckout: 'not_touched',
    externalPublish: 'not_touched',
    destructiveCleanup: 'not_touched',
  },
  screenshots: [],
  requests: [],
  responses: [],
  submittedResponseIndex: null,
  readback: null,
  downloadedImage: null,
  downloadedImages: [],
  preflightOk: false,
  technicalOk: false,
  visualQualityAccepted: false,
  visualQualityReview: submit ? 'required_after_download' : 'not_applicable_preflight_only',
  visualQualityAcceptanceMode: acceptVisualQuality ? 'explicit_cli_flag_after_human_review' : 'not_accepted_by_default',
  visualQualityReviewEvidence: acceptVisualQuality ? {
    reviewer: visualReviewer || null,
    reviewedArtifact: visualReviewArtifact || null,
    matchesDownloadedImage: false,
  } : null,
  preflight: {
    cutoutReady: false,
    generateButtonEnabled: false,
  },
  errors: [],
  cleanup: {
    contextClosed: false,
    browserClosed: false,
  },
};

if (reviewSummary) {
  const reviewResult = await reviewExistingSummary(reviewSummary, outDir);
  console.log(JSON.stringify(reviewResult.console, null, 2));
  if (!reviewResult.ok) process.exit(1);
  process.exit(0);
}

if (!fsSync.existsSync(authState)) fail(`auth_state_missing:${authState}`);
if (!fsSync.existsSync(imagePath)) fail(`image_missing:${imagePath}`);
if (acceptVisualQuality && (!visualReviewer || !visualReviewArtifact)) {
  fail('visual_quality_acceptance_requires_visualReviewer_and_visualReviewArtifact');
}

const browser = await chromium.launch({ headless: !headed });
let context;
let pendingReadbackJobId = null;

try {
  context = await browser.newContext({
    storageState: authState,
    viewport: { width: 1440, height: 1050 },
    recordVideo: {
      dir: path.join(outDir, 'videos'),
      size: { width: 1440, height: 1050 },
    },
  });
  const page = await context.newPage();

  page.on('request', (request) => {
    if (!request.url().includes('/functions/v1/model-matrix')) return;
    const postData = request.postData() || '';
    let body = null;
    try {
      body = JSON.parse(postData);
    } catch {
      body = null;
    }
    evidence.requests.push({
      url: request.url(),
      method: request.method(),
      imageUrlMime: typeof body?.imageUrl === 'string' ? body.imageUrl.slice(0, 32) : null,
      modelReferenceImageUrlMime: typeof body?.modelReferenceImageUrl === 'string' ? body.modelReferenceImageUrl.slice(0, 32) : null,
      hasRightsConfirmed: body?.legalSafety?.rightsConfirmed === true,
      bodyTypes: body?.bodyTypes,
      ageGroups: body?.ageGroups,
      hasBrandId: typeof body?.brandId === 'string' && body.brandId.length > 0,
      postDataBytes: Buffer.byteLength(postData),
    });
  });

  page.on('response', async (response) => {
    if (!response.url().includes('/functions/v1/model-matrix')) return;
    const text = await response.text().catch(() => '');
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = {
        nonJson: true,
        preview: sanitizeResponsePreview(text),
        originalBytes: Buffer.byteLength(text),
      };
    }
    evidence.responses.push({
      url: response.url(),
      status: response.status(),
      body: summarizeModelMatrixResponse(body),
    });
  });

  await page.goto(`${baseUrl}/fitting?qa=g701-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await screenshot(page, '01-open.png');

  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.first().setInputFiles(imagePath);
  await page.waitForTimeout(1800);
  await screenshot(page, '02-uploaded.png');

  await page.getByRole('button', { name: /高精度AIで切り抜く|高精度AI切り抜き|AIで切り抜く/ }).click({ timeout: 30000 });
  await page.getByText('高精度AI切り抜き済みです。権利確認後にAI生成できます。').waitFor({ state: 'visible', timeout: timeoutMs });
  evidence.preflight.cutoutReady = true;
  await screenshot(page, '03-cutout-ok.png');

  const rights = page.locator('label').filter({ hasText: 'アップロード素材と生成指示に必要な権利' }).locator('input[type="checkbox"]');
  await rights.check({ force: true, timeout: 30000 });
  const generateButton = page.getByRole('button', { name: /^AI生成$/ });
  evidence.preflight.generateButtonEnabled = await generateButton.isEnabled().catch(() => false);
  await screenshot(page, '04-before-generate.png');

  let submittedModelMatrixResponse = null;
  if (submit) {
    const responseCountBeforeGenerate = evidence.responses.length;
    await generateButton.click({ timeout: 30000 });
    const modelMatrixResponse = await waitForModelMatrixResponse(evidence, timeoutMs, responseCountBeforeGenerate);
    submittedModelMatrixResponse = modelMatrixResponse;
    evidence.submittedResponseIndex = modelMatrixResponse ? evidence.responses.length - 1 : null;
    if (!modelMatrixResponse) {
      evidence.errors.push('model_matrix_response_timeout_after_submit');
    }
    if (modelMatrixResponse && modelMatrixResponse.status !== 200) {
      await waitForFailureUi(page, 45000);
    }
    await page.waitForTimeout(1500);
    await screenshot(page, '05-after-generate.png');
    if (latestSuccessfulJobId(evidence)) {
      await page.goto(`${baseUrl}/gallery`, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await screenshot(page, '06-gallery-readback.png');
    }
  }

  const latestResponse = submit ? submittedModelMatrixResponse : evidence.responses.at(-1);
  const jobId = latestResponse?.body?.jobId || null;
  if (jobId) {
    pendingReadbackJobId = jobId;
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  evidence.bodySignals = {
    hasCutoutReadyText: bodyText.includes('高精度AI切り抜き済みです'),
    hasGenerationFailureText: bodyText.includes('生成に失敗しました'),
    hasJapaneseRateLimitGuidance: bodyText.includes('短時間に生成リクエストが集中しています。1分ほど待ってから再試行してください。'),
    hasGalleryText: bodyText.includes('生成履歴') || bodyText.includes('Gallery'),
  };
  evidence.finishedAt = new Date().toISOString();
} catch (error) {
  evidence.errors.push(String(error?.stack || error?.message || error));
  evidence.finishedAt = new Date().toISOString();
} finally {
  if (context) {
    await context.close().then(() => {
      evidence.cleanup.contextClosed = true;
    }).catch((error) => {
      evidence.cleanup.contextCloseError = String(error?.message || error);
    });
  }
  await browser.close().then(() => {
    evidence.cleanup.browserClosed = true;
  }).catch((error) => {
    evidence.cleanup.browserCloseError = String(error?.message || error);
  });
}

if (pendingReadbackJobId) {
  try {
    evidence.readback = await readbackJob(pendingReadbackJobId, outDir);
    evidence.downloadedImage = evidence.readback?.downloadedImage ?? null;
    evidence.downloadedImages = evidence.readback?.downloadedImages ?? [];
  } catch (error) {
    evidence.errors.push(`readback_after_browser_close_failed:${String(error?.message || error).slice(0, 240)}`);
  }
}

const lastResponse = submit && Number.isInteger(evidence.submittedResponseIndex)
  ? evidence.responses[evidence.submittedResponseIndex]
  : submit
  ? null
  : evidence.responses.at(-1);
const firstRequest = evidence.requests[0];
evidence.preflightOk = Boolean(
  evidence.errors.length === 0
  && evidence.preflight.cutoutReady
  && evidence.preflight.generateButtonEnabled
  && evidence.cleanup.contextClosed
  && evidence.cleanup.browserClosed
);
evidence.technicalOk = Boolean(
  submit
  && evidence.preflightOk
  && firstRequest?.imageUrlMime?.startsWith('data:image/jpeg')
  && firstRequest?.hasRightsConfirmed
  && lastResponse?.status === 200
  && lastResponse?.body?.success === true
  && lastResponse?.body?.matrixCount > 0
  && evidence.readback?.job?.status === 'completed'
  && evidence.readback?.job?.featureType === 'model-matrix'
  && evidence.readback?.images?.length > 0
  && evidence.readback?.images?.every((image) => image.jobId === evidence.readback.job.id)
  && evidence.readback?.images?.every((image) => image.featureType === 'model-matrix')
  && evidence.readback?.images?.length === lastResponse?.body?.matrixCount
  && evidence.downloadedImage?.bytes > 1000
  && evidence.downloadedImage?.png?.valid === true
  && evidence.downloadedImage?.png?.width >= 512
  && evidence.downloadedImage?.png?.height >= 512
  && evidence.downloadedImages?.length === evidence.readback?.images?.length
  && evidence.downloadedImages?.every((image) => (
    image.bytes > 1000
    && image.png?.valid === true
    && image.png?.width >= 512
    && image.png?.height >= 512
  ))
);
const visualReviewMatchesDownloadedImage = Boolean(
  acceptVisualQuality
  && evidence.downloadedImage
  && (
    normalizeArtifactPath(visualReviewArtifact) === normalizeArtifactPath(evidence.downloadedImage.filePath)
    || visualReviewArtifact === evidence.downloadedImage.sha256
  )
);
if (evidence.visualQualityReviewEvidence) {
  evidence.visualQualityReviewEvidence.downloadedArtifact = evidence.downloadedImage?.filePath || null;
  evidence.visualQualityReviewEvidence.downloadedSha256 = evidence.downloadedImage?.sha256 || null;
  evidence.visualQualityReviewEvidence.matchesDownloadedImage = visualReviewMatchesDownloadedImage;
}
evidence.visualQualityAccepted = Boolean(acceptVisualQuality && evidence.technicalOk && visualReviewMatchesDownloadedImage);
if (evidence.technicalOk && !evidence.visualQualityAccepted) {
  evidence.visualQualityReview = 'technical_output_downloaded_but_human_visual_quality_review_required';
}
evidence.ok = Boolean(evidence.technicalOk && evidence.visualQualityAccepted);
evidence.exactBlocker = evidence.ok
  ? null
  : classifyBlocker(evidence);

const summaryPath = path.join(outDir, 'summary.json');
await fs.writeFile(summaryPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({
  ok: evidence.ok,
  preflightOk: evidence.preflightOk,
  technicalOk: evidence.technicalOk,
  visualQualityAccepted: evidence.visualQualityAccepted,
  summaryPath,
  exactBlocker: evidence.exactBlocker,
  requestImageMime: firstRequest?.imageUrlMime || null,
  responseStatus: lastResponse?.status || null,
  jobStatus: evidence.readback?.job?.status || null,
  downloadedBytes: evidence.downloadedImage?.bytes || 0,
  exitMeaning: submit
    ? (evidence.ok ? 'submit_e2e_success' : 'submit_e2e_failed')
    : (evidence.preflightOk ? 'preflight_only_passed_generation_not_submitted' : 'preflight_failed'),
}, null, 2));
if (submit) {
  if (!evidence.ok) process.exit(1);
} else {
  process.exit(evidence.preflightOk ? 2 : 1);
}

async function screenshot(page, fileName) {
  const screenshotPath = path.join(outDir, fileName);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  evidence.screenshots.push(screenshotPath);
}

async function waitForModelMatrixResponse(targetEvidence, timeout, previousResponseCount = 0) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (targetEvidence.responses.length > previousResponseCount) return targetEvidence.responses.at(-1);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function waitForFailureUi(page, timeout) {
  return page.waitForFunction(() => {
    const text = document.body?.innerText || '';
    return text.includes('生成に失敗しました')
      || text.includes('短時間に生成リクエストが集中しています')
      || text.includes('User usage rate limit exceeded');
  }, null, { timeout }).catch(() => null);
}

async function readbackJob(jobId, out) {
  const jobResult = await supabaseRestJson(
    `/rest/v1/generation_jobs?id=eq.${encodeURIComponent(jobId)}&select=id,status,feature_type,error_message,created_at,completed_at`,
  );
  const imagesResult = await supabaseRestJson(
    `/rest/v1/generated_images?job_id=eq.${encodeURIComponent(jobId)}&select=id,job_id,storage_path,feature_type,model_used,created_at&order=created_at.desc`,
  );
  const job = Array.isArray(jobResult.data) ? jobResult.data[0] || null : null;
  const images = Array.isArray(imagesResult.data) ? imagesResult.data : [];

  const downloadedImages = [];
  for (const image of images || []) {
    if (!image?.storage_path) continue;
    const download = await supabaseStorageDownload('generated-images', image.storage_path);
    if (download.ok && download.bytes) {
      const bytes = download.bytes;
      const filePath = path.join(out, `downloaded-${image.id}.png`);
      await fs.writeFile(filePath, bytes);
      downloadedImages.push({
        id: image.id,
        filePath,
        bytes: bytes.byteLength,
        storagePathTail: tailPath(image.storage_path),
        sha256: await sha256Hex(bytes),
        png: readPngDimensions(bytes),
        visualReviewRequired: true,
      });
    } else {
      downloadedImages.push({
        id: image.id,
        error: String(download.error || 'download_failed').slice(0, 240),
        storagePathTail: tailPath(image.storage_path),
      });
    }
  }
  const downloadedImage = downloadedImages[0] || null;

  return {
    job: job ? {
      id: job.id,
      status: job.status,
      featureType: job.feature_type,
      errorMessage: typeof job.error_message === 'string' ? job.error_message.slice(0, 240) : job.error_message,
      createdAt: job.created_at,
      completedAt: job.completed_at,
    } : null,
    jobError: jobResult.error || null,
    images: (images || []).map((image) => ({
      id: image.id,
      jobId: image.job_id,
      featureType: image.feature_type,
      modelUsed: image.model_used,
      storagePathTail: tailPath(image.storage_path),
      createdAt: image.created_at,
    })),
    imagesError: imagesResult.error || null,
    downloadedImage,
    downloadedImages,
  };
}

function latestSuccessfulJobId(targetEvidence) {
  for (const response of [...targetEvidence.responses].reverse()) {
    if (response.status === 200 && response.body?.jobId) return response.body.jobId;
  }
  return null;
}

function normalizeArtifactPath(value) {
  if (!value || typeof value !== 'string') return '';
  return path.resolve(value);
}

async function reviewExistingSummary(summaryFile, out) {
  const text = await fs.readFile(summaryFile, 'utf8');
  const target = JSON.parse(text);
  const downloaded = target.downloadedImage || null;
  const artifactMatches = Boolean(
    acceptVisualQuality
    && downloaded
    && (
      normalizeArtifactPath(visualReviewArtifact) === normalizeArtifactPath(downloaded.filePath)
      || visualReviewArtifact === downloaded.sha256
    )
  );
  const review = {
    schema: 'heavy-chain.g701.visible-fitting-prod-visual-review.v1',
    reviewedAt: new Date().toISOString(),
    sourceSummary: summaryFile,
    sourceMode: target.mode || null,
    reviewer: visualReviewer || null,
    reviewedArtifact: visualReviewArtifact || null,
    downloadedArtifact: downloaded?.filePath || null,
    downloadedSha256: downloaded?.sha256 || null,
    technicalOk: target.technicalOk === true,
    sourceOk: target.ok === true,
    visualQualityAccepted: Boolean(target.technicalOk === true && artifactMatches),
    artifactMatchesDownloadedImage: artifactMatches,
    exactBlocker: null,
  };
  review.ok = Boolean(review.visualQualityAccepted);
  if (!acceptVisualQuality) {
    review.exactBlocker = 'visual_quality_acceptance_flag_missing';
  } else if (!visualReviewer || !visualReviewArtifact) {
    review.exactBlocker = 'visual_quality_acceptance_requires_visualReviewer_and_visualReviewArtifact';
  } else if (target.technicalOk !== true) {
    review.exactBlocker = 'source_summary_not_technically_ok';
  } else if (!artifactMatches) {
    review.exactBlocker = 'visual_review_artifact_does_not_match_downloaded_image';
  }

  const reviewPath = path.join(out, 'visual-review.json');
  await fs.writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
  return {
    ok: review.ok,
    console: {
      ok: review.ok,
      visualQualityAccepted: review.visualQualityAccepted,
      reviewPath,
      exactBlocker: review.exactBlocker,
      downloadedArtifact: review.downloadedArtifact,
      downloadedSha256: review.downloadedSha256,
    },
  };
}

function summarizeModelMatrixResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return typeof body === 'string' ? body.slice(0, 500) : body;
  }
  return {
    success: body.success === true,
    error: typeof body.error === 'string' ? body.error.slice(0, 500) : null,
    jobId: typeof body.jobId === 'string' ? body.jobId : null,
    matrixCount: Array.isArray(body.matrix) ? body.matrix.length : 0,
    matrixItems: Array.isArray(body.matrix)
      ? body.matrix.map((item) => ({
        bodyType: item?.bodyType ?? null,
        ageGroup: item?.ageGroup ?? null,
        imageId: item?.imageId ?? null,
        storagePathTail: tailPath(item?.storagePath),
        persistenceStatus: item?.persistenceStatus ?? null,
        hasImageUrl: typeof item?.imageUrl === 'string' && item.imageUrl.length > 0,
      }))
      : [],
    persistenceStatus: body.persistenceStatus ?? null,
    failedStage: body.failedStage ?? null,
    cleanupStatus: body.cleanupStatus ?? null,
  };
}

function getServiceConfig() {
  const supabaseUrl = pickUsableSupabaseUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('supabase_service_role_env_missing');
  return {
    supabaseUrl: trimTrailingSlash(supabaseUrl),
    serviceRoleKey,
  };
}

function pickUsableSupabaseUrl() {
  return [process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL]
    .map((value) => String(value || '').trim())
    .find((value) => (
      /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(value)
      && !/project_ref|your-|xxxxx/i.test(value)
    )) || '';
}

async function supabaseRestJson(pathname) {
  try {
    const { supabaseUrl, serviceRoleKey } = getServiceConfig();
    const response = await httpsRequest(`${supabaseUrl}${pathname}`, {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
    });
    const text = response.body.toString('utf8');
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return { data: null, error: `HTTP ${response.statusCode}: ${text.slice(0, 240)}` };
    }
    return { data: text ? JSON.parse(text) : null, error: null };
  } catch (error) {
    return { data: null, error: String(error?.message || error).slice(0, 240) };
  }
}

async function supabaseStorageDownload(bucket, objectPath) {
  try {
    const { supabaseUrl, serviceRoleKey } = getServiceConfig();
    const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
    const response = await httpsRequest(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`, {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const text = response.body.toString('utf8');
      return { ok: false, bytes: null, error: `HTTP ${response.statusCode}: ${text.slice(0, 240)}` };
    }
    return { ok: true, bytes: response.body, error: null };
  } catch (error) {
    return { ok: false, bytes: null, error: String(error?.message || error).slice(0, 240) };
  }
}

function httpsRequest(url, headers) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET',
      headers,
      timeout: 30000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode || 0,
          body: Buffer.concat(chunks),
        });
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error('https_request_timeout'));
    });
    request.on('error', reject);
    request.end();
  });
}

async function loadEnvFile(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      const value = rawValue.replace(/^['"]|['"]$/g, '').trim();
      if (!value || /REPLACE_ME|YOUR_|example\.com/i.test(value)) continue;
      if (
        Object.prototype.hasOwnProperty.call(process.env, key)
        && !isPlaceholderEnvValue(process.env[key])
      ) continue;
      process.env[key] = value;
    }
  } catch {
    // Optional in environments where vars are already loaded.
  }
}

function isPlaceholderEnvValue(value) {
  return /project_ref|your-|xxxxx|REPLACE_ME|replace-with|replace-in|example\.com/i.test(String(value || ''));
}

function classifyBlocker(targetEvidence) {
  const last = targetEvidence.submit && Number.isInteger(targetEvidence.submittedResponseIndex)
    ? targetEvidence.responses[targetEvidence.submittedResponseIndex]
    : targetEvidence.submit
    ? null
    : targetEvidence.responses.at(-1);
  const errorText = JSON.stringify(last?.body || targetEvidence.errors || '');
  if (!targetEvidence.preflight.cutoutReady) {
    return 'fitting_cutout_not_ready';
  }
  if (!targetEvidence.preflight.generateButtonEnabled) {
    return 'fitting_generate_button_not_enabled_after_cutout_and_rights';
  }
  if (targetEvidence.submit && !targetEvidence.requests[0]?.imageUrlMime?.startsWith('data:image/jpeg')) {
    return 'fitting_reference_not_normalized_to_jpeg';
  }
  if (/User usage rate limit exceeded/i.test(errorText)) {
    return 'production_ai_generation_blocked_by_usage_rate_limit';
  }
  if (targetEvidence.technicalOk && !targetEvidence.visualQualityAccepted) {
    return 'human_visual_quality_review_required_before_acceptance';
  }
  if (/invalid_image_file/i.test(errorText)) {
    return 'production_ai_generation_invalid_reference_image';
  }
  if (last && last.status !== 200) {
    return `model_matrix_non_2xx:${last.status}`;
  }
  if (targetEvidence.errors.length) {
    return `visible_fitting_e2e_error:${targetEvidence.errors[0].slice(0, 160)}`;
  }
  if (!targetEvidence.submit && targetEvidence.preflightOk) {
    return 'preflight_only_no_generation_submit';
  }
  return 'visible_fitting_e2e_not_completed';
}

function tailPath(value) {
  return String(value || '').split('/').slice(-2).join('/');
}

function sanitizeResponsePreview(value) {
  return String(value || '')
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[redacted.jwt]')
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, '[redacted.supabase_secret]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted.openai_key]')
    .replace(/AIza[0-9A-Za-z_-]+/g, '[redacted.google_key]')
    .slice(0, 500);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Buffer.from(digest).toString('hex');
}

function readPngDimensions(bytes) {
  const signature = bytes.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a' || bytes.length < 24) {
    return { valid: false };
  }
  return {
    valid: true,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function dateStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
