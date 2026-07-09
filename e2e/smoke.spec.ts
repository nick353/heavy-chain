import { expect, test, type Page } from '@playwright/test';
import { workflowMetadataById } from '../src/lib/workflowMetadata';

const mockUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'tester@example.com',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: { name: 'Test User' },
  created_at: '2026-06-18T00:00:00.000Z',
};

const mockBrand = {
  id: '00000000-0000-4000-8000-000000000002',
  owner_id: mockUser.id,
  name: 'Smoke Test Brand',
  logo_url: null,
  brand_colors: null,
  tone_description: null,
  target_audience: null,
  created_at: '2026-06-18T00:00:00.000Z',
  updated_at: '2026-06-18T00:00:00.000Z',
};

const authToken = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expires_at: 4102444800,
  expires_in: 3600,
  token_type: 'bearer',
  user: mockUser,
};

const mockJobs = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    brand_id: mockBrand.id,
    user_id: mockUser.id,
    feature_type: 'text-to-image',
    input_params: {
      prompt: '夏のサマーセール告知',
      lightchainCompat: {
        lightchainFeatureId: 'case-sns-video',
        lightchainFeatureTitle: '商品画像からSNS動画構成へ',
        lightchainTaskCodes: ['FashionStudio', 'Video Workstation'],
      },
    },
    optimized_prompt: 'Premium summer sale apparel campaign image',
    status: 'processing',
    error_message: null,
    created_at: '2026-06-18T02:00:00.000Z',
    completed_at: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    brand_id: mockBrand.id,
    user_id: mockUser.id,
    feature_type: 'product-shots',
    input_params: {
      prompt: '白背景の商品撮影',
      lightchainCompat: {
        lightchainFeatureId: 'remove-background',
        lightchainFeatureTitle: '背景削除・切り抜き',
        lightchainTaskCodes: ['CutOut', 'RemoveBackground'],
      },
    },
    optimized_prompt: null,
    status: 'failed',
    error_message: 'テスト用の生成失敗',
    created_at: '2026-06-18T01:00:00.000Z',
    completed_at: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    brand_id: mockBrand.id,
    user_id: mockUser.id,
    feature_type: 'text-to-image',
    input_params: {
      prompt: 'ECモデル着用画像',
      lightchainCompat: {
        lightchainFeatureId: 'virtual-fitting',
        lightchainFeatureTitle: 'AIフィッティング',
        lightchainTaskCodes: ['VirtualFittingV2', 'ChangeModel'],
      },
    },
    optimized_prompt: null,
    status: 'completed',
    error_message: null,
    created_at: '2026-06-18T00:00:00.000Z',
    completed_at: '2026-06-18T00:02:00.000Z',
  },
];

const mockGeneratedImages = [
  {
    id: '00000000-0000-4000-8000-000000000201',
    job_id: '00000000-0000-4000-8000-000000000103',
    brand_id: mockBrand.id,
    user_id: mockUser.id,
    storage_path: 'mock/generated-image.png',
    image_url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3C/svg%3E',
    thumbnail_path: null,
    version: 1,
    parent_image_id: null,
    is_favorite: false,
    created_at: '2026-06-18T00:03:00.000Z',
    expires_at: null,
    prompt: 'ECモデル着用画像',
    negative_prompt: null,
    feature_type: 'text-to-image',
    style_preset: null,
    model_used: null,
    generation_params: null,
    metadata: null,
  },
];

const mockLightchainTaskSteps = [
  {
    id: '00000000-0000-4000-8000-000000000401',
    job_id: '00000000-0000-4000-8000-000000000101',
    image_id: null,
    brand_id: mockBrand.id,
    user_id: mockUser.id,
    lightchain_feature_id: 'case-sns-video',
    lightchain_feature_title: '商品画像からSNS動画構成へ',
    task_code: 'FashionStudio',
    step_index: 0,
    status: 'processing',
    source_workspace: 'video',
    workflow_version: 'video-storyboard-local-v1',
    request_id: 'mock-request-processing',
    artifact_uri: null,
    error_message: null,
    metadata: {},
    created_at: '2026-06-18T02:00:00.000Z',
    updated_at: '2026-06-18T02:00:00.000Z',
    completed_at: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000402',
    job_id: '00000000-0000-4000-8000-000000000101',
    image_id: null,
    brand_id: mockBrand.id,
    user_id: mockUser.id,
    lightchain_feature_id: 'case-sns-video',
    lightchain_feature_title: '商品画像からSNS動画構成へ',
    task_code: 'Video Workstation',
    step_index: 1,
    status: 'processing',
    source_workspace: 'video',
    workflow_version: 'video-storyboard-local-v1',
    request_id: 'mock-request-processing',
    artifact_uri: null,
    error_message: null,
    metadata: {},
    created_at: '2026-06-18T02:00:00.000Z',
    updated_at: '2026-06-18T02:00:00.000Z',
    completed_at: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000403',
    job_id: '00000000-0000-4000-8000-000000000102',
    image_id: null,
    brand_id: mockBrand.id,
    user_id: mockUser.id,
    lightchain_feature_id: 'remove-background',
    lightchain_feature_title: '背景削除・切り抜き',
    task_code: 'CutOut',
    step_index: 0,
    status: 'retryable',
    source_workspace: 'studio',
    workflow_version: 'studio-selection-local-v1',
    request_id: 'mock-request-failed',
    artifact_uri: null,
    error_message: 'テスト用の生成失敗',
    metadata: {},
    created_at: '2026-06-18T01:00:00.000Z',
    updated_at: '2026-06-18T01:00:00.000Z',
    completed_at: '2026-06-18T01:01:00.000Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000404',
    job_id: '00000000-0000-4000-8000-000000000102',
    image_id: null,
    brand_id: mockBrand.id,
    user_id: mockUser.id,
    lightchain_feature_id: 'remove-background',
    lightchain_feature_title: '背景削除・切り抜き',
    task_code: 'RemoveBackground',
    step_index: 1,
    status: 'retryable',
    source_workspace: 'studio',
    workflow_version: 'studio-selection-local-v1',
    request_id: 'mock-request-failed',
    artifact_uri: null,
    error_message: 'テスト用の生成失敗',
    metadata: {},
    created_at: '2026-06-18T01:00:00.000Z',
    updated_at: '2026-06-18T01:00:00.000Z',
    completed_at: '2026-06-18T01:01:00.000Z',
  },
];

const configuredProjectRef = process.env.VITE_SUPABASE_URL?.match(/^https:\/\/([^.]+)\.supabase\.co/)?.[1];
const authStorageKeys = Array.from(new Set([
  'ghwjymozrwmcrpjqvbmo',
  'jprhgmxszvtomrqnolxn',
  configuredProjectRef,
].filter(Boolean).map((projectRef) => `sb-${projectRef}-auth-token`)));

async function completeOnboardingForMockUser(page: Page) {
  await page.addInitScript((userId) => {
    localStorage.setItem(`heavy_chain_onboarding_completed:${userId}`, 'true');
  }, mockUser.id);
}

type RestWriteRequest = { table: string; method: string; body: unknown };
type RestDeleteRequest = { table: string; method: string; url: string };
type RestMutationRequest = { table: string; method: string; url: string; body: unknown };

async function mockSupabase(page: Page, options: {
  optimizePromptSucceeds?: boolean;
  generationFails?: boolean;
  modelMatrixFails?: boolean;
  modelMatrixDelayMs?: number;
  modelMatrixRequests?: unknown[];
  generateImageRequests?: unknown[];
  designGachaRequests?: unknown[];
  removeBackgroundRequests?: unknown[];
  colorizeRequests?: unknown[];
  upscaleRequests?: unknown[];
  generateVariationsRequests?: unknown[];
  shareLinkRequests?: unknown[];
  sharedImageRequests?: string[];
  storageUploadFails?: boolean;
  storageRequests?: string[];
  storageRemoveRequests?: string[];
  functionRequests?: string[];
  generationJobInsertFails?: boolean;
  generatedImageInsertFails?: boolean;
  marketingArtifactFunctionFails?: boolean;
  marketingArtifactFunctionStage?: 'auth' | 'prepare' | 'storage' | 'job' | 'image';
  marketingArtifactFunctionCleanupStatus?: 'none' | 'attempted' | 'failed';
  marketingArtifactFunctionRequests?: unknown[];
  generatedImagesResponse?: Array<{ id: string; imageUrl: string; prompt: string; label?: string }>;
  restWriteRequests?: RestWriteRequest[];
  restDeleteRequests?: RestDeleteRequest[];
  restMutationRequests?: RestMutationRequest[];
} = {}) {
  const dynamicJobs = [...mockJobs];
  const dynamicGeneratedImages = [...mockGeneratedImages];

  await page.addInitScript(({ keys, token }) => {
    keys.forEach((key) => localStorage.setItem(key, JSON.stringify(token)));
  }, { keys: authStorageKeys, token: authToken });

  await page.route('**/auth/v1/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: mockUser }) });
  });

  await page.route('**/rest/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    const table = pathname.split('/rest/v1/')[1]?.split('/')[0] ?? '';
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && table && table !== 'rpc') {
      let requestBody: unknown = null;
      try {
        requestBody = route.request().postDataJSON();
      } catch {
        requestBody = route.request().postData();
      }
      options.restMutationRequests?.push({ table, method, url: route.request().url(), body: requestBody });
    }
    let body: unknown = [];

    if (pathname.endsWith('/rest/v1/rpc/get_brand_usage_summary')) {
      if (method !== 'POST') {
        await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method Not Allowed' }) });
        return;
      }

      body = {
        plan_code: 'free',
        monthly_quota: 25,
        used_units: 0,
        reserved_units: 0,
        remaining_units: 25,
      };
    } else if (pathname.endsWith('/rest/v1/users')) {
      if (method !== 'GET') {
        await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method Not Allowed' }) });
        return;
      }

      body = { ...mockUser, name: 'Test User', avatar_url: null, language: 'ja', is_admin: false };
    } else if (pathname.endsWith('/rest/v1/brands')) {
      if (method !== 'GET') {
        await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method Not Allowed' }) });
        return;
      }

      body = [mockBrand];
    } else if (pathname.endsWith('/rest/v1/generation_jobs')) {
      if (method === 'POST') {
        const requestBody = route.request().postDataJSON();
        options.restWriteRequests?.push({ table: 'generation_jobs', method, body: requestBody });
        if (options.generationJobInsertFails) {
          await route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'new row violates row-level security policy' }),
          });
          return;
        }
        body = {
          id: '00000000-0000-4000-8000-000000000301',
          ...requestBody,
          created_at: requestBody.created_at ?? '2026-06-18T03:00:00.000Z',
          completed_at: requestBody.completed_at ?? '2026-06-18T03:00:00.000Z',
        };
        dynamicJobs.unshift(body as (typeof mockJobs)[number]);
      } else if (method === 'DELETE') {
        options.restDeleteRequests?.push({ table: 'generation_jobs', method, url: route.request().url() });
        body = [];
      } else if (method !== 'GET') {
        await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method Not Allowed' }) });
        return;
      } else {
        body = dynamicJobs;
      }
    } else if (pathname.endsWith('/rest/v1/generated_images')) {
      if (method === 'POST') {
        const requestBody = route.request().postDataJSON();
        options.restWriteRequests?.push({ table: 'generated_images', method, body: requestBody });
        if (options.generatedImageInsertFails) {
          await route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'new row violates row-level security policy' }),
          });
          return;
        }
        body = {
          id: '00000000-0000-4000-8000-000000000302',
          image_url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="120"%3E%3Crect fill="%23ddd" width="160" height="120"/%3E%3Ctext x="18" y="66" font-size="18"%3ERemote%3C/text%3E%3C/svg%3E',
          thumbnail_path: null,
          version: 1,
          parent_image_id: null,
          is_favorite: false,
          expires_at: null,
          negative_prompt: null,
          style_preset: null,
          model_used: 'local-workspace-best-effort',
          generation_params: null,
          metadata: null,
          ...requestBody,
          created_at: requestBody.created_at ?? '2026-06-18T03:00:00.000Z',
        };
        dynamicGeneratedImages.unshift(body as (typeof mockGeneratedImages)[number]);
      } else if (method !== 'GET') {
        await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method Not Allowed' }) });
        return;
      } else {
        body = dynamicGeneratedImages;
      }
    } else if (pathname.endsWith('/rest/v1/lightchain_task_steps')) {
      if (method !== 'GET') {
        await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method Not Allowed' }) });
        return;
      }
      body = mockLightchainTaskSteps;
    } else {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not Found' }) });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.route('**/storage/v1/object/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();

    if (pathname.includes('/storage/v1/object/sign/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ signedUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3C/svg%3E' }),
      });
      return;
    }

    if (method === 'DELETE') {
      options.storageRemoveRequests?.push(pathname);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
      return;
    }

    if (method !== 'POST' && method !== 'PUT') {
      await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method Not Allowed' }) });
      return;
    }

    options.storageRequests?.push(pathname);

    if (options.storageUploadFails) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'new row violates row-level security policy' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Key: pathname.replace('/storage/v1/object/', '') }),
    });
  });

  await page.route('**/functions/v1/**', async (route) => {
    const { pathname, searchParams } = new URL(route.request().url());
    options.functionRequests?.push(pathname);

    if (pathname === '/functions/v1/model-matrix') {
      const requestBody = route.request().postDataJSON();
      options.modelMatrixRequests?.push(requestBody);

      if (options.modelMatrixFails) {
        if (options.modelMatrixDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, options.modelMatrixDelayMs));
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'テスト用のモデル生成失敗' }),
        });
        return;
      }

      if (options.modelMatrixDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.modelMatrixDelayMs));
      }
      const sourceReadback = requestBody.sourceReadback && typeof requestBody.sourceReadback === 'object'
        ? requestBody.sourceReadback
        : null;
      const remoteGenerationHref = sourceReadback
        ? `/generate?${new URLSearchParams({
            feature: 'model-matrix',
            prompt: requestBody.productDescription ?? '',
            sourceWorkspace: sourceReadback.sourceWorkspace,
            workflowVersion: sourceReadback.workflowVersion,
            sourceLabel: sourceReadback.sourceLabel,
            sourceResumePath: sourceReadback.sourceResumePath,
            sourceMode: sourceReadback.sourceMode,
            bodyTypes: requestBody.bodyTypes?.join(',') ?? '',
            ageGroups: requestBody.ageGroups?.join(',') ?? '',
            skinTone: requestBody.skinTone ?? '',
            hairStyle: requestBody.hairStyle ?? '',
            modelCandidateLabel: requestBody.modelCandidateLabel ?? '',
          }).toString()}`
        : '';
      const remoteSourceMetadata = sourceReadback
        ? {
            sourceWorkspace: sourceReadback.sourceWorkspace,
            workflowVersion: sourceReadback.workflowVersion,
            sourceLabel: sourceReadback.sourceLabel,
            sourceResumePath: sourceReadback.sourceResumePath,
            sourceMode: sourceReadback.sourceMode,
            bodyTypes: requestBody.bodyTypes,
            ageGroups: requestBody.ageGroups,
            skinTone: requestBody.skinTone,
            hairStyle: requestBody.hairStyle,
            modelCandidateLabel: requestBody.modelCandidateLabel,
            generationIntent: {
              feature: 'model-matrix',
              prompt: requestBody.productDescription,
              href: remoteGenerationHref,
              label: 'モデルマトリクスで生成',
              sourceWorkspace: sourceReadback.sourceWorkspace,
              workflowVersion: sourceReadback.workflowVersion,
              sourceLabel: sourceReadback.sourceLabel,
              sourceResumePath: sourceReadback.sourceResumePath,
              sourceMode: sourceReadback.sourceMode,
              bodyTypes: requestBody.bodyTypes,
              ageGroups: requestBody.ageGroups,
              skinTone: requestBody.skinTone,
              hairStyle: requestBody.hairStyle,
              modelCandidateLabel: requestBody.modelCandidateLabel,
            },
          }
        : {};
      const job = {
        id: '00000000-0000-4000-8000-000000000401',
        brand_id: requestBody.brandId,
        user_id: mockUser.id,
        feature_type: 'model-matrix',
        input_params: {
          description: requestBody.productDescription,
          productDescription: requestBody.productDescription,
          bodyTypes: requestBody.bodyTypes,
          ageGroups: requestBody.ageGroups,
          gender: requestBody.gender,
          skinTone: requestBody.skinTone,
          hairStyle: requestBody.hairStyle,
          ...remoteSourceMetadata,
        },
        optimized_prompt: requestBody.productDescription,
        status: 'completed',
        error_message: null,
        created_at: '2026-06-18T04:00:00.000Z',
        completed_at: '2026-06-18T04:01:00.000Z',
      };
      const matrix = [
        {
          bodyType: 'slim',
          bodyTypeName: 'スリム',
          ageGroup: '20s',
          ageGroupName: '20代',
          imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="400"%3E%3Crect fill="%23e9ddcf" width="320" height="400"/%3E%3Ctext x="40" y="210" font-size="28"%3ESlim 20s%3C/text%3E%3C/svg%3E',
          storagePath: `${mockUser.id}/${requestBody.brandId}/00000000-0000-4000-8000-000000000401_matrix_slim_20s.png`,
          imageId: '00000000-0000-4000-8000-000000000402',
          persistenceStatus: 'completed',
        },
        {
          bodyType: 'regular',
          bodyTypeName: '標準',
          ageGroup: '30s',
          ageGroupName: '30代',
          imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="400"%3E%3Crect fill="%23dbe7ef" width="320" height="400"/%3E%3Ctext x="34" y="210" font-size="28"%3ERegular 30s%3C/text%3E%3C/svg%3E',
          storagePath: `${mockUser.id}/${requestBody.brandId}/00000000-0000-4000-8000-000000000401_matrix_regular_30s.png`,
          imageId: '00000000-0000-4000-8000-000000000403',
          persistenceStatus: 'completed',
        },
      ];
      dynamicJobs.unshift(job as (typeof mockJobs)[number]);
      dynamicGeneratedImages.unshift(...matrix.map((item) => ({
        id: item.imageId,
        job_id: job.id,
        brand_id: requestBody.brandId,
        user_id: mockUser.id,
        storage_path: item.storagePath,
        image_url: item.imageUrl,
        thumbnail_path: null,
        version: 1,
        parent_image_id: null,
        is_favorite: false,
        expires_at: null,
        prompt: requestBody.productDescription,
        negative_prompt: null,
        feature_type: 'model-matrix',
        style_preset: null,
        model_used: 'gemini-test-model',
        generation_params: {
          bodyType: item.bodyType,
          ageGroup: item.ageGroup,
          gender: requestBody.gender,
        },
        metadata: {
          remoteSaveStatus: 'succeeded',
          source: 'model-matrix',
          ...remoteSourceMetadata,
        },
        created_at: '2026-06-18T04:01:00.000Z',
      } as (typeof mockGeneratedImages)[number])));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          jobId: job.id,
          matrix,
          persistenceStatus: 'completed',
          failedStage: null,
          cleanupStatus: 'none',
        }),
      });
      return;
    }

    if (pathname === '/functions/v1/marketing-workspace-artifact') {
      const requestBody = route.request().postDataJSON();
      options.marketingArtifactFunctionRequests?.push(requestBody);

      if (options.marketingArtifactFunctionFails) {
        await route.fulfill({
          status: options.marketingArtifactFunctionStage === 'auth' ? 401 : 400,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: 'テスト用のワークスペース保存失敗',
            remoteSaveStage: options.marketingArtifactFunctionStage ?? 'storage',
            remoteCleanupStatus: options.marketingArtifactFunctionCleanupStatus ?? 'none',
          }),
        });
        return;
      }

      const job = {
        id: '00000000-0000-4000-8000-000000000301',
        brand_id: requestBody.brandId,
        user_id: mockUser.id,
        feature_type: requestBody.featureType,
        input_params: {
          prompt: requestBody.prompt ?? null,
          title: requestBody.title,
          canvasProjectId: requestBody.canvasProjectId ?? null,
          sourceJobId: requestBody.sourceJobId ?? null,
          metadata: requestBody.metadata ?? {},
        },
        optimized_prompt: requestBody.prompt ?? null,
        status: 'completed',
        error_message: null,
        created_at: requestBody.createdAt ?? '2026-06-18T03:00:00.000Z',
        completed_at: requestBody.createdAt ?? '2026-06-18T03:00:00.000Z',
      };
      const image = {
        id: '00000000-0000-4000-8000-000000000302',
        job_id: job.id,
        brand_id: requestBody.brandId,
        user_id: mockUser.id,
        storage_path: `${mockUser.id}/${requestBody.brandId}/workspace/mock-function-upload`,
        image_url: requestBody.imageUrl,
        thumbnail_path: null,
        version: 1,
        parent_image_id: null,
        is_favorite: false,
        expires_at: null,
        prompt: requestBody.prompt ?? null,
        negative_prompt: null,
        feature_type: requestBody.featureType,
        style_preset: null,
        model_used: 'marketing-workspace-artifact',
        generation_params: {
          canvasProjectId: requestBody.canvasProjectId ?? null,
          sourceJobId: requestBody.sourceJobId ?? null,
        },
        metadata: {
          ...(requestBody.metadata ?? {}),
          title: requestBody.title,
          localWorkspaceArtifact: true,
          remoteWorkspaceArtifact: true,
          sourceJobId: requestBody.sourceJobId ?? null,
        },
        created_at: requestBody.createdAt ?? '2026-06-18T03:00:00.000Z',
      };
      dynamicJobs.unshift(job as (typeof mockJobs)[number]);
      dynamicGeneratedImages.unshift(image as (typeof mockGeneratedImages)[number]);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          remoteSaveStage: 'completed',
          remoteCleanupStatus: 'none',
          remote: {
            jobId: job.id,
            imageId: image.id,
            storagePath: image.storage_path,
          },
        }),
      });
      return;
    }

    if (pathname === '/functions/v1/generate-image') {
      const requestBody = route.request().postDataJSON();
      options.generateImageRequests?.push(requestBody);
      if (options.generationFails) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'テスト用の生成失敗' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          images: options.generatedImagesResponse ?? [{
            id: 'mock-generated-image',
            imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="400"%3E%3Crect fill="%23f2ede6" width="320" height="400"/%3E%3Ctext x="44" y="210" font-size="24"%3EGenerated%3C/text%3E%3C/svg%3E',
            prompt: requestBody.prompt,
            label: 'Generated',
          }],
        }),
      });
      return;
    }

    if (pathname === '/functions/v1/design-gacha') {
      const requestBody = route.request().postDataJSON();
      options.designGachaRequests?.push(requestBody);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          variations: options.generatedImagesResponse ?? [
            {
              storagePath: 'design-gacha-smoke-a',
              imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="400"%3E%3Crect fill="%23f2ede6" width="320" height="400"/%3E%3Ctext x="36" y="210" font-size="24"%3EPattern A%3C/text%3E%3C/svg%3E',
              prompt: requestBody.brief,
              directionName: 'Pattern Direction A',
            },
            {
              storagePath: 'design-gacha-smoke-b',
              imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="400"%3E%3Crect fill="%23e9eef6" width="320" height="400"/%3E%3Ctext x="36" y="210" font-size="24"%3EPattern B%3C/text%3E%3C/svg%3E',
              prompt: requestBody.brief,
              directionName: 'Pattern Direction B',
            },
          ],
        }),
      });
      return;
    }

    if (pathname === '/functions/v1/remove-background') {
      const requestBody = route.request().postDataJSON();
      options.removeBackgroundRequests?.push(requestBody);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          resultUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="400"%3E%3Crect fill="%23f8fafc" width="320" height="400"/%3E%3Ctext x="36" y="210" font-size="24"%3ERemoved BG%3C/text%3E%3C/svg%3E',
          imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="400"%3E%3Crect fill="%23f8fafc" width="320" height="400"/%3E%3Ctext x="36" y="210" font-size="24"%3ERemoved BG%3C/text%3E%3C/svg%3E',
          storagePath: 'mock-remove-bg.png',
        }),
      });
      return;
    }

    if (pathname === '/functions/v1/colorize') {
      const requestBody = route.request().postDataJSON();
      options.colorizeRequests?.push(requestBody);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          variations: [{ color: 'red', colorName: 'red', imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="400"%3E%3Crect fill="%23fee2e2" width="320" height="400"/%3E%3C/svg%3E', storagePath: 'mock-colorize.png' }],
        }),
      });
      return;
    }

    if (pathname === '/functions/v1/upscale') {
      const requestBody = route.request().postDataJSON();
      options.upscaleRequests?.push(requestBody);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          resultUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="640" height="800"%3E%3Crect fill="%23ecfeff" width="640" height="800"/%3E%3C/svg%3E',
          imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="640" height="800"%3E%3Crect fill="%23ecfeff" width="640" height="800"/%3E%3C/svg%3E',
          storagePath: 'mock-upscale.png',
        }),
      });
      return;
    }

    if (pathname === '/functions/v1/generate-variations') {
      const requestBody = route.request().postDataJSON();
      options.generateVariationsRequests?.push(requestBody);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          variations: [{ index: 1, imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="400"%3E%3Crect fill="%23eef2ff" width="320" height="400"/%3E%3C/svg%3E', storagePath: 'mock-variation.png' }],
        }),
      });
      return;
    }

    if (pathname === '/functions/v1/share-link') {
      if (route.request().method() === 'GET') {
        const token = searchParams.get('token') ?? '';
        options.sharedImageRequests?.push(token);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            image: {
              id: '00000000-0000-4000-8000-000000000201',
              imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="420" height="560"%3E%3Crect fill="%23111617" width="420" height="560"/%3E%3Crect x="70" y="72" width="280" height="416" rx="18" fill="%232dd4bf"/%3E%3Ctext x="210" y="292" font-size="28" text-anchor="middle" fill="%230f172a"%3EShared%3C/text%3E%3C/svg%3E',
              prompt: 'Shared ECモデル着用画像',
              negativePrompt: null,
              featureType: 'text-to-image',
              stylePreset: null,
              modelUsed: null,
              generationParams: null,
              metadata: {
                lightchainCompat: {
                  lightchainFeatureTitle: 'AIフィッティング',
                  lightchainTaskCodes: ['VirtualFittingV2', 'ChangeModel'],
                },
              },
              createdAt: '2026-06-18T00:03:00.000Z',
            },
            share: {
              token,
              expiresAt: '2026-06-25T00:00:00.000Z',
              createdAt: '2026-06-18T00:04:00.000Z',
            },
          }),
        });
        return;
      }

      const requestBody = route.request().postDataJSON();
      options.shareLinkRequests?.push(requestBody);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          shareUrl: `https://heavy-chain.example/share/mock-${requestBody.imageId}`,
          token: `mock-${requestBody.imageId}`,
          expiresAt: '2026-06-25T00:00:00.000Z',
          expiresInDays: requestBody.expiresInDays ?? 7,
        }),
      });
      return;
    }

    if (pathname === '/functions/v1/optimize-prompt') {
      if (options.optimizePromptSucceeds) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            optimized_prompt: 'Premium studio product photo of a white cotton T-shirt on a model',
            negative_prompt: 'blurry, low quality',
          }),
        });
        return;
      }

      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'テスト用の最適化失敗' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ images: [] }),
    });
  });
}

async function selectFeature(page: Page, featureId: string) {
  const featureCard = page.getByTestId(`feature-card-${featureId}`);
  await featureCard.scrollIntoViewIfNeeded();
  await featureCard.click();
}

async function runMarketingHandoff(page: Page, campaignCopy: string) {
  await page.goto('/marketing');

  await expect(page.getByRole('heading', { name: 'マーケティングワークスペース' })).toBeVisible();
  await page.getByLabel('商品画像アップロード').setInputFiles({
    name: 'marketing-product.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect fill="#ddd" width="160" height="120"/><text x="18" y="66" font-size="18">Product</text></svg>'),
  });
  await expect(page.getByAltText('アップロードした商品プレビュー')).toBeVisible();
  await expect(page.getByText('marketing-product.svg')).toBeVisible();

  await page.getByRole('button', { name: 'SNS', exact: true }).click();
  await page.getByRole('button', { name: 'Instagram投稿' }).click();
  await page.getByLabel('キャンペーンコピー').fill(campaignCopy);
  await page.getByRole('button', { name: 'ジョブ開始' }).click();
  await expect(page.getByText(/処理中 \d+%/)).toBeVisible();
}

async function readLatestLocalArtifactMetadata(page: Page) {
  return page.evaluate((brandId) => {
    const value = localStorage.getItem(`heavy-chain-workspace-artifacts:v1:${brandId}`);
    const artifacts = value ? JSON.parse(value) : [];
    return artifacts[0]?.metadata;
  }, mockBrand.id);
}

async function readLocalArtifactMetadataList(page: Page) {
  return page.evaluate((brandId) => {
    const value = localStorage.getItem(`heavy-chain-workspace-artifacts:v1:${brandId}`);
    const artifacts = value ? JSON.parse(value) : [];
    return artifacts.map((artifact: { metadata?: unknown }) => artifact.metadata);
  }, mockBrand.id);
}

async function readLatestLocalArtifact(page: Page) {
  return page.evaluate((brandId) => {
    const value = localStorage.getItem(`heavy-chain-workspace-artifacts:v1:${brandId}`);
    const artifacts = value ? JSON.parse(value) : [];
    return artifacts[0] ?? null;
  }, mockBrand.id);
}

async function readLatestCanvasProject(page: Page) {
  return page.evaluate(() => {
    const value = localStorage.getItem('heavy-chain-canvas');
    const parsed = value ? JSON.parse(value) : null;
    return parsed?.state?.projects?.[0] ?? null;
  });
}

async function runLocalWorkspaceHandoff(
  page: Page,
  path: '/studio' | '/models' | '/patterns' | '/video' | '/lab',
  choice: string,
  expectedHeading: string,
  fillInputs: () => Promise<void>,
  beforeSave?: () => Promise<void>
) {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: expectedHeading })).toBeVisible();
  await fillInputs();
  await page.getByRole('button', { name: choice, exact: true }).click();
  await expect(page.getByText(`${choice}をローカル履歴に追加`)).toBeVisible();
  await beforeSave?.();
  await page.getByRole('button', { name: '保存してCanvasへ' }).click();
}

const workflowQueryScenarios = [
  {
    id: 'ec-product-set',
    workflowTitle: 'EC商品画像セット',
    featureHeading: '商品ページ標準カット',
    relatedWorkspaceHref: '/fitting',
    prefill: {
      placeholder: '例: 白いコットンTシャツ、クルーネック、シンプルなデザイン',
      value: '上質なヘビーウェイトTシャツ、ボックスシルエット、厚みのある生地、EC商品ページ用の白背景撮影',
    },
    assertions: async (page: Page) => {
      await expect(page.getByText('4カット選択中')).toBeVisible();
      for (const shot of ['正面', '側面', '背面', 'ディテール']) {
        await expect(page.getByRole('button', { name: shot })).toHaveAttribute('aria-pressed', 'true');
      }
    },
  },
  {
    id: 'sns-campaign',
    workflowTitle: 'SNSキャンペーンセット',
    featureHeading: 'キャンペーン画像',
    relatedWorkspaceHref: '/marketing',
    prefill: {
      placeholder: '例: 夏のサマーセール告知、爽やかな海辺の雰囲気',
      value: '新作アパレルのローンチ告知。都会的でクリーン、スマートフォンで目に留まるSNSキャンペーン画像',
    },
    assertions: async (page: Page) => {
      await expect(page.getByPlaceholder('例: SUMMER SALE')).toHaveValue('NEW DROP');
      await expect(page.getByPlaceholder('例: 今すぐ見る')).toHaveValue('今すぐ見る');
      await expect(page.getByRole('button', { name: /ポートレート/ })).toHaveAttribute('aria-pressed', 'true');
    },
  },
  {
    id: 'design-exploration',
    workflowTitle: 'デザイン探索',
    featureHeading: 'デザインガチャ',
    relatedWorkspaceHref: '/patterns',
    prefill: {
      placeholder: '例: 20代女性向けのカジュアルなサマードレス',
      value: '20代から30代向けのミニマルなストリートウェア。厚手素材、控えめなロゴ、日常使いしやすい新作デザイン案',
    },
    assertions: async (page: Page) => {
      await expect(page.getByText('6つのスタイル方向')).toBeVisible();
    },
  },
  {
    id: 'global-expansion',
    workflowTitle: 'グローバル展開セット',
    featureHeading: '多言語ECバナー',
    relatedWorkspaceHref: '/studio',
    prefill: {
      placeholder: '例: SUMMER SALE',
      value: 'NEW SEASON ESSENTIALS',
    },
    assertions: async (page: Page) => {
      await expect(page.getByPlaceholder('例: 最大50%OFF')).toHaveValue('Premium heavy cotton basics for everyday style');
      for (const language of ['日本語', 'English', '中文', '한국어']) {
        await expect(page.getByRole('button', { name: language })).toHaveAttribute('aria-pressed', 'true');
      }
      await expect(page.getByRole('button', { name: /ワイド/ })).toHaveAttribute('aria-pressed', 'true');
    },
  },
];

test('landing shell renders with mocked Supabase requests', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).toContainText('アパレル専用AI画像生成プラットフォーム');
});

test.describe('workflow query prefill', () => {
  for (const scenario of workflowQueryScenarios) {
    test(`${scenario.id} selects feature and prefills editor without writes`, async ({ page }) => {
      const workflowCtaHref = workflowMetadataById[scenario.id]?.ctas.find((cta) => cta.variant === 'primary')?.href;
      if (!workflowCtaHref) {
        throw new Error(`Missing workflow CTA href for ${scenario.id}`);
      }
      const functionRequests: string[] = [];
      const storageRequests: string[] = [];
      const storageRemoveRequests: string[] = [];
      const restWriteRequests: Array<{ table: string; method: string; body: unknown }> = [];
      const restDeleteRequests: Array<{ table: string; method: string; url: string }> = [];
      await mockSupabase(page, {
        functionRequests,
        storageRequests,
        storageRemoveRequests,
        restWriteRequests,
        restDeleteRequests,
      });
      await completeOnboardingForMockUser(page);

      await page.goto(workflowCtaHref);

      await expect(page).toHaveURL(new RegExp(`feature=${workflowMetadataById[scenario.id].primaryFeature}`));
      await expect(page.getByText('読み込み中...')).toBeHidden({ timeout: 15000 });
      await expect(page.getByRole('heading', { name: scenario.featureHeading })).toBeVisible();
      await expect(page.getByRole('heading', { name: scenario.workflowTitle })).toBeVisible();
      await expect(page.getByText('業務ワークフロー')).toBeVisible();
      await expect(page.getByPlaceholder(scenario.prefill.placeholder)).toHaveValue(scenario.prefill.value);
      await scenario.assertions(page);

      expect(functionRequests).toEqual([]);
      expect(storageRequests).toEqual([]);
      expect(storageRemoveRequests).toEqual([]);
      expect(restWriteRequests).toEqual([]);
      expect(restDeleteRequests).toEqual([]);
    });
  }
});

test.describe('workflow boards', () => {
  for (const scenario of workflowQueryScenarios) {
    test(`${scenario.id} renders local board and advances to existing generator without writes`, async ({ page }) => {
      const workflowCtaHref = workflowMetadataById[scenario.id]?.ctas.find((cta) => cta.variant === 'primary')?.href;
      if (!workflowCtaHref) {
        throw new Error(`Missing workflow CTA href for ${scenario.id}`);
      }
      const functionRequests: string[] = [];
      const storageRequests: string[] = [];
      const storageRemoveRequests: string[] = [];
      const restWriteRequests: RestWriteRequest[] = [];
      const restDeleteRequests: RestDeleteRequest[] = [];
      const restMutationRequests: RestMutationRequest[] = [];
      await mockSupabase(page, {
        functionRequests,
        storageRequests,
        storageRemoveRequests,
        restWriteRequests,
        restDeleteRequests,
        restMutationRequests,
      });
      await completeOnboardingForMockUser(page);

      await page.goto(`/workflows/${scenario.id}`);

      await expect(page).toHaveURL(new RegExp(`/workflows/${scenario.id}`));
      await expect(page.getByRole('heading', { name: scenario.workflowTitle })).toBeVisible();
      await expect(page.getByText('業務ワークフロー')).toBeVisible();
      await expect(page.getByText('成果物候補')).toBeVisible();
      await expect(page.getByRole('link', { name: /生成へ進む|企画を作る/ }).first()).toHaveAttribute('href', workflowCtaHref);
      await expect(page.locator(`a[href="${scenario.relatedWorkspaceHref}"]`).first()).toBeVisible();
      await expect(page.locator('a[href="/canvas/new"]').first()).toBeVisible();

      await page.getByRole('link', { name: /生成へ進む|企画を作る/ }).first().click();

      await expect(page).toHaveURL(new RegExp(`feature=${workflowMetadataById[scenario.id].primaryFeature}`));
      await expect(page.getByRole('heading', { name: scenario.featureHeading })).toBeVisible();
      await expect(page.getByRole('heading', { name: scenario.workflowTitle })).toBeVisible();

      expect(functionRequests).toEqual([]);
      expect(storageRequests).toEqual([]);
      expect(storageRemoveRequests).toEqual([]);
      expect(restWriteRequests).toEqual([]);
      expect(restDeleteRequests).toEqual([]);
      expect(restMutationRequests).toEqual([]);
    });
  }
});

test.describe('workspace activity pages', () => {
  test('dashboard Lightchain parity hub maps tabs and feature links without remote writes', async ({ page }) => {
    const functionRequests: string[] = [];
    const storageRequests: string[] = [];
    const storageRemoveRequests: string[] = [];
    const restWriteRequests: RestWriteRequest[] = [];
    const restDeleteRequests: RestDeleteRequest[] = [];
    const restMutationRequests: RestMutationRequest[] = [];
    await mockSupabase(page, {
      functionRequests,
      storageRequests,
      storageRemoveRequests,
      restWriteRequests,
      restDeleteRequests,
      restMutationRequests,
    });
    await completeOnboardingForMockUser(page);

    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: '今日の作業状況' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: /Lightchainで慣れた入口/ })).toBeVisible();
    await expect(page.getByText('Lightchain互換ホーム')).toBeVisible();
    await expect(page.getByRole('link', { name: /マーケティングワークスペース/ })).toHaveAttribute('href', '/marketing');
    await expect(page.getByRole('link', { name: /AIフィッティング/ }).first()).toHaveAttribute('href', '/fitting');

    await page.getByRole('button', { name: /グラフィックツール/ }).click();
    await expect(page.getByRole('link', { name: /AIグラフィックデザイン/ })).toHaveAttribute('href', '/patterns');
    await expect(page.getByRole('link', { name: /デザインアレンジ/ })).toHaveAttribute('href', /\/generate\?feature=generate-variations&lcFeature=design-arrange/);
    await expect(page.getByRole('link', { name: /類似バリエーション生成/ })).toHaveAttribute('href', /\/generate\?feature=generate-variations&lcFeature=image-variations/);

    await page.getByPlaceholder('機能名で検索').fill('ベクター');
    await expect(page.getByRole('link', { name: /パターンをベクター画像に変換/ })).toBeVisible();
    await page.getByPlaceholder('機能名で検索').fill('');

    await page.getByRole('button', { name: /グラフィックツール/ }).click();
    await expect(page.getByRole('link', { name: /背景削除・切り抜き/ })).toHaveAttribute('href', /\/generate\?feature=remove-bg&lcFeature=remove-background/);
    await expect(page.getByRole('link', { name: /Canvasで編集・管理/ })).toHaveAttribute('href', '/canvas/new');

    await page.getByRole('button', { name: /企画デザインツール/ }).click();
    await expect(page.getByRole('link', { name: /部分修正・対話編集/ })).toHaveAttribute('href', /\/generate\?feature=chat-edit&lcFeature=partial-fix/);
    await page.getByRole('button', { name: /グラフィックツール/ }).click();

    await page.getByRole('link', { name: /背景削除・切り抜き/ }).click();
    await expect(page).toHaveURL(/\/generate\?feature=remove-bg&lcFeature=remove-background/);
    await expect(page.getByText('Lightchain互換')).toBeVisible();
    await expect(page.getByText('CutOut / RemoveBackground').first()).toBeVisible();

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /グラフィックツール/ }).click();

    await page.getByRole('link', { name: /パターンをベクター画像に変換/ }).click();
    await expect(page).toHaveURL(/\/patterns$/);

    expect(functionRequests).toEqual([]);
    expect(storageRequests).toEqual([]);
    expect(storageRemoveRequests).toEqual([]);
    expect(restWriteRequests).toEqual([]);
    expect(restDeleteRequests).toEqual([]);
    expect(restMutationRequests).toEqual([]);
  });

  test('generate page sends Lightchain compatibility metadata to generation function', async ({ page }) => {
    const generateImageRequests: unknown[] = [];
    await mockSupabase(page, { generateImageRequests });
    await completeOnboardingForMockUser(page);

    const params = new URLSearchParams({
      feature: 'campaign-image',
      prompt: '新作ジャケットのSNS告知',
      lcFeature: 'case-sns-video',
      lcTitle: '商品画像からSNS動画構成へ',
      lcTaskCodes: 'FashionStudio,Video Workstation',
    });
    await page.goto(`/generate?${params.toString()}`);

    await expect(page.getByRole('heading', { name: 'キャンペーン画像' })).toBeVisible();
    await expect(page.getByText('Lightchain互換')).toBeVisible();
    await expect(page.getByText('FashionStudio / Video Workstation')).toBeVisible();

    await page.getByRole('button', { name: '生成' }).click();
    await expect.poll(() => generateImageRequests.length).toBe(1);
    expect(generateImageRequests[0]).toMatchObject({
      lightchainCompat: {
        lightchainFeatureId: 'case-sns-video',
        lightchainFeatureTitle: '商品画像からSNS動画構成へ',
        lightchainTaskCodes: ['FashionStudio', 'Video Workstation'],
        lightchainTaskSteps: [
          { taskCode: 'FashionStudio', status: 'processing' },
          { taskCode: 'Video Workstation', status: 'processing' },
        ],
      },
    });
  });

  test('image editing functions receive Lightchain compatibility metadata', async ({ page }) => {
    const removeBackgroundRequests: unknown[] = [];
    await mockSupabase(page, { removeBackgroundRequests });
    await completeOnboardingForMockUser(page);

    const params = new URLSearchParams({
      feature: 'remove-bg',
      lcFeature: 'remove-background',
      lcTitle: '背景削除・切り抜き',
      lcTaskCodes: 'CutOut,RemoveBackground',
    });
    await page.goto(`/generate?${params.toString()}`);

    await expect(page.getByText('Lightchain互換')).toBeVisible();
    await expect(page.getByText('CutOut / RemoveBackground')).toBeVisible();
    await expect(page.getByRole('heading', { name: '背景削除' })).toBeVisible();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'lightchain-edit.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'),
    });
    await page.getByRole('button', { name: '生成' }).click();

    await expect.poll(() => removeBackgroundRequests.length).toBe(1);
    expect(removeBackgroundRequests[0]).toMatchObject({
      lightchainCompat: {
        lightchainFeatureId: 'remove-background',
        lightchainFeatureTitle: '背景削除・切り抜き',
        lightchainTaskCodes: ['CutOut', 'RemoveBackground'],
        lightchainTaskSteps: [
          { taskCode: 'CutOut', status: 'processing' },
          { taskCode: 'RemoveBackground', status: 'processing' },
        ],
      },
    });
  });

  test('canvas image edits preserve Lightchain stage history locally', async ({ page }) => {
    const removeBackgroundRequests: unknown[] = [];
    await mockSupabase(page, { removeBackgroundRequests });
    await completeOnboardingForMockUser(page);

    await page.goto('/canvas/new');
    await page.evaluate(async () => {
      const { useCanvasStore } = await import('/src/stores/canvasStore.ts');
      const store = useCanvasStore;
      const projectId = store.getState().createProject('Lightchain Canvas Stage Proof', '00000000-0000-4000-8000-000000000002');
      const imageId = store.getState().addObject({
        type: 'image',
        x: 100,
        y: 100,
        width: 240,
        height: 240,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        locked: false,
        visible: true,
        src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="320"%3E%3Crect fill="%23f8fafc" width="320" height="320"/%3E%3Ctext x="32" y="170" font-size="24"%3ELC Source%3C/text%3E%3C/svg%3E',
        label: 'Lightchain source',
        metadata: {
          feature: 'remove-background',
          generation: 0,
          lightchainCompat: {
            lightchainFeatureId: 'remove-background',
            lightchainFeatureTitle: '背景削除・切り抜き',
            lightchainTaskCodes: ['CutOut', 'RemoveBackground'],
            lightchainTaskSteps: [
              { taskCode: 'CutOut', status: 'processing' },
              { taskCode: 'RemoveBackground', status: 'processing' },
            ],
          },
        },
      });
      store.getState().selectObject(imageId);
      store.getState().saveCurrentProject();
      window.history.replaceState(null, '', `/canvas/${projectId}`);
    });

    await page.getByRole('button', { name: '背景削除' }).click();
    await expect.poll(() => removeBackgroundRequests.length).toBe(1);
    await expect(page.getByText('Lightchain編集履歴')).toBeVisible();
    await expect(page.getByText('背景削除・切り抜き')).toBeVisible();

    const canvasObjects = await page.evaluate(async () => {
      const { useCanvasStore } = await import('/src/stores/canvasStore.ts');
      const store = useCanvasStore;
      return store.getState().objects;
    });
    const derived = canvasObjects.find((object: any) => object.derivedFrom);
    expect(derived?.metadata).toMatchObject({
      feature: 'remove-background',
      generation: 1,
      lightchainCompat: {
        lightchainFeatureId: 'remove-background',
        lightchainTaskCodes: ['CutOut', 'RemoveBackground'],
      },
      lightchainEditStages: [
        {
          action: 'remove-background',
          label: '背景削除・切り抜き',
          status: 'completed',
          stepIndex: 0,
        },
      ],
    });
  });

  test('canvas mobile toolbar and more menu stay within the viewport', async ({ page }) => {
    await mockSupabase(page);
    await completeOnboardingForMockUser(page);

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/canvas/new');
      await expect(page.getByTestId('canvas-toolbar')).toBeVisible();
      await expect(page.getByTestId('canvas-toolbar-scroll')).toBeVisible();

      const initialMetrics = await page.evaluate(() => {
        const toolbar = document.querySelector('[data-testid="canvas-toolbar"]');
        const scroller = document.querySelector('[data-testid="canvas-toolbar-scroll"]');
        const moreButton = document.querySelector('button[title="その他のツール"]');
        const toolbarRect = toolbar?.getBoundingClientRect();
        const scrollerRect = scroller?.getBoundingClientRect();
        const moreButtonRect = moreButton?.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          toolbar: toolbarRect ? { left: toolbarRect.left, right: toolbarRect.right, width: toolbarRect.width } : null,
          moreButton: moreButtonRect
            ? { left: moreButtonRect.left, right: moreButtonRect.right, top: moreButtonRect.top, bottom: moreButtonRect.bottom }
            : null,
          scroller: scrollerRect
            ? {
                left: scrollerRect.left,
                right: scrollerRect.right,
                width: scrollerRect.width,
                scrollWidth: scroller?.scrollWidth ?? 0,
                clientWidth: scroller?.clientWidth ?? 0,
              }
            : null,
        };
      });

      expect(initialMetrics.toolbar).not.toBeNull();
      expect(initialMetrics.moreButton).not.toBeNull();
      expect(initialMetrics.scroller).not.toBeNull();
      expect(initialMetrics.documentScrollWidth).toBeLessThanOrEqual(initialMetrics.viewportWidth + 1);
      expect(initialMetrics.toolbar!.left).toBeGreaterThanOrEqual(-1);
      expect(initialMetrics.toolbar!.right).toBeLessThanOrEqual(initialMetrics.viewportWidth + 1);
      expect(initialMetrics.moreButton!.left).toBeGreaterThanOrEqual(-1);
      expect(initialMetrics.moreButton!.right).toBeLessThanOrEqual(initialMetrics.viewportWidth + 1);
      expect(initialMetrics.scroller!.left).toBeGreaterThanOrEqual(-1);
      expect(initialMetrics.scroller!.right).toBeLessThanOrEqual(initialMetrics.viewportWidth + 1);
      expect(initialMetrics.scroller!.scrollWidth).toBeGreaterThanOrEqual(initialMetrics.scroller!.clientWidth);

      await page.locator('button[title="その他のツール"]').click();
      await expect(page.getByTestId('canvas-toolbar-more-menu')).toBeVisible();

      const menuMetrics = await page.evaluate(() => {
        const menu = document.querySelector('[data-testid="canvas-toolbar-more-menu"]');
        const menuRect = menu?.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          documentScrollWidth: document.documentElement.scrollWidth,
          menu: menuRect ? { left: menuRect.left, right: menuRect.right, top: menuRect.top, bottom: menuRect.bottom } : null,
        };
      });

      expect(menuMetrics.menu).not.toBeNull();
      expect(menuMetrics.documentScrollWidth).toBeLessThanOrEqual(menuMetrics.viewportWidth + 1);
      expect(menuMetrics.menu!.left).toBeGreaterThanOrEqual(-1);
      expect(menuMetrics.menu!.right).toBeLessThanOrEqual(menuMetrics.viewportWidth + 1);
      expect(menuMetrics.menu!.top).toBeGreaterThanOrEqual(0);
      expect(menuMetrics.menu!.bottom).toBeLessThanOrEqual(menuMetrics.viewportHeight + 1);
    }
  });

  test('dashboard renders activity panels', async ({ page }) => {
    await mockSupabase(page);

    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: '今日の作業状況' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '進行中のジョブ' })).toBeVisible();
    await expect(page.getByText('失敗から再開')).toBeVisible();
    await expect(page.getByText('Lightchain task: FashionStudio / Video Workstation')).toBeVisible();
    await expect(page.getByText('Lightchain steps: FashionStudio=処理中 / Video Workstation=処理中')).toBeVisible();
  });

  test('dashboard quick workflow opens SNS campaign board and advances to generator without remote writes', async ({ page }) => {
    const functionRequests: string[] = [];
    const storageRequests: string[] = [];
    const storageRemoveRequests: string[] = [];
    const restWriteRequests: RestWriteRequest[] = [];
    const restDeleteRequests: RestDeleteRequest[] = [];
    const restMutationRequests: RestMutationRequest[] = [];
    const generateImageRequests: unknown[] = [];
    await mockSupabase(page, {
      functionRequests,
      generateImageRequests,
      storageRequests,
      storageRemoveRequests,
      restWriteRequests,
      restDeleteRequests,
      restMutationRequests,
    });
    await completeOnboardingForMockUser(page);

    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'クイックワークフロー' })).toBeVisible();
    await page.getByRole('link', { name: /SNSキャンペーンセット/ }).click();
    await expect(page).toHaveURL(/\/workflows\/sns-campaign$/);
    await expect(page.getByRole('heading', { name: 'SNSキャンペーンセット' })).toBeVisible();

    await page.getByRole('link', { name: /生成へ進む/ }).first().click();
    await expect(page).toHaveURL(/\/generate\?workflow=sns-campaign$/);
    await expect(page.getByRole('heading', { name: 'キャンペーン画像' })).toBeVisible();

    expect(functionRequests).toEqual([]);
    expect(storageRequests).toEqual([]);
    expect(storageRemoveRequests).toEqual([]);
    expect(restWriteRequests).toEqual([]);
    expect(restDeleteRequests).toEqual([]);
    expect(restMutationRequests).toEqual([]);
  });

  test('jobs page renders queue readback', async ({ page }) => {
    await mockSupabase(page);

    await page.goto('/jobs');

    await expect(page.getByRole('heading', { name: 'ジョブ' })).toBeVisible();
    await expect(page.getByText('Premium summer sale apparel campaign image')).toBeVisible();
    await expect(page.getByText('テスト用の生成失敗')).toBeVisible();
    await expect(page.getByText('Lightchain task:', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('CutOut / RemoveBackground')).toBeVisible();
    await expect(page.getByText('Lightchain状態:', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('失敗・再試行可', { exact: true }).first()).toBeVisible();
  });

  test('marketing page runs local job states and hands off to canvas', async ({ page }) => {
    const storageRequests: string[] = [];
    const functionRequests: unknown[] = [];
    const restWriteRequests: Array<{ table: string; method: string; body: unknown }> = [];
    await mockSupabase(page, {
      marketingArtifactFunctionFails: true,
      marketingArtifactFunctionStage: 'storage',
      marketingArtifactFunctionRequests: functionRequests,
      storageRequests,
      restWriteRequests,
    });

    await runMarketingHandoff(page, 'Smoke test campaign copy for SNS handoff.');
    await page.getByRole('button', { name: '停滞を表示' }).click();
    await expect(page.getByText(/停滞中 \d+%/)).toBeVisible();

    await page.getByRole('button', { name: '失敗を表示' }).click();
    await expect(page.getByText('ローカル生成ジョブで検証用の失敗を検出しました。')).toBeVisible();
    await page.getByRole('button', { name: '再試行' }).click();
    await expect(page.getByText(/処理中 \d+%/)).toBeVisible();

    await page.getByRole('button', { name: 'キャンバスへ渡す' }).click();
    await expect(page).toHaveURL(/\/canvas\/(?!new)[a-z0-9]+/);
    await expect(page.getByRole('heading', { name: 'Marketing: SNS / Instagram投稿' })).toBeVisible();
    await expect.poll(() => functionRequests.length).toBe(1);
    expect(functionRequests[0]).toMatchObject({
      brandId: mockBrand.id,
      featureType: 'marketing-workflow',
      title: 'Marketing: SNS / Instagram投稿',
      prompt: 'Smoke test campaign copy for SNS handoff.',
    });
    expect(storageRequests).toEqual([]);
    expect(restWriteRequests).toEqual([]);

    await page.goto('/gallery');
    await page.getByPlaceholder('プロンプトで検索...').fill('marketing-workflow');
    await page.locator('div.cursor-pointer').first().click();
    const marketingDetailModal = page.locator('.fixed.inset-0');
    await expect(marketingDetailModal.getByText('marketing-workflow').first()).toBeVisible();
    await expect(page.getByText('Smoke test campaign copy for SNS handoff.')).toBeVisible();

    await page.goto('/history');
    await expect(page.getByText('マーケティングワークフロー')).toBeVisible();
    await expect(page.getByText('Smoke test campaign copy for SNS handoff.')).toBeVisible();
    const localArtifactMetadata = await readLatestLocalArtifactMetadata(page);
    expect(localArtifactMetadata).toMatchObject({
      remoteSaveStatus: 'failed',
      remoteSaveStage: 'storage',
      remoteJobId: null,
      remoteImageId: null,
      remoteStoragePath: null,
      remoteCleanupStatus: 'none',
    });
  });

  test('marketing fallback consumes function cleanup status when job insert fails', async ({ page }) => {
    const storageRequests: string[] = [];
    const storageRemoveRequests: string[] = [];
    const functionRequests: unknown[] = [];
    const restWriteRequests: Array<{ table: string; method: string; body: unknown }> = [];
    await mockSupabase(page, {
      marketingArtifactFunctionFails: true,
      marketingArtifactFunctionStage: 'job',
      marketingArtifactFunctionCleanupStatus: 'attempted',
      marketingArtifactFunctionRequests: functionRequests,
      storageRequests,
      storageRemoveRequests,
      restWriteRequests,
    });

    await runMarketingHandoff(page, 'Job insert fallback copy.');
    await page.getByRole('button', { name: 'キャンバスへ渡す' }).click();
    await expect(page).toHaveURL(/\/canvas\/(?!new)[a-z0-9]+/);

    await expect.poll(() => functionRequests.length).toBe(1);
    expect(storageRequests).toEqual([]);
    expect(storageRemoveRequests).toEqual([]);
    expect(restWriteRequests).toEqual([]);
    expect(await readLatestLocalArtifactMetadata(page)).toMatchObject({
      remoteSaveStatus: 'failed',
      remoteSaveStage: 'job',
      remoteCleanupStatus: 'attempted',
    });
  });

  test('marketing fallback consumes function cleanup status when image insert fails', async ({ page }) => {
    const storageRequests: string[] = [];
    const storageRemoveRequests: string[] = [];
    const functionRequests: unknown[] = [];
    const restWriteRequests: Array<{ table: string; method: string; body: unknown }> = [];
    const restDeleteRequests: Array<{ table: string; method: string; url: string }> = [];
    await mockSupabase(page, {
      marketingArtifactFunctionFails: true,
      marketingArtifactFunctionStage: 'image',
      marketingArtifactFunctionCleanupStatus: 'attempted',
      marketingArtifactFunctionRequests: functionRequests,
      storageRequests,
      storageRemoveRequests,
      restWriteRequests,
      restDeleteRequests,
    });

    await runMarketingHandoff(page, 'Image insert fallback copy.');
    await page.getByRole('button', { name: 'キャンバスへ渡す' }).click();
    await expect(page).toHaveURL(/\/canvas\/(?!new)[a-z0-9]+/);

    await expect.poll(() => functionRequests.length).toBe(1);
    expect(storageRequests).toEqual([]);
    expect(storageRemoveRequests).toEqual([]);
    expect(restWriteRequests).toEqual([]);
    expect(restDeleteRequests).toEqual([]);
    expect(await readLatestLocalArtifactMetadata(page)).toMatchObject({
      remoteSaveStatus: 'failed',
      remoteSaveStage: 'image',
      remoteCleanupStatus: 'attempted',
    });
  });

  test('marketing remote success keeps gallery and history from duplicating local mirror', async ({ page }) => {
    const storageRequests: string[] = [];
    const storageRemoveRequests: string[] = [];
    const functionRequests: unknown[] = [];
    const restWriteRequests: Array<{ table: string; method: string; body: unknown }> = [];
    await mockSupabase(page, {
      marketingArtifactFunctionRequests: functionRequests,
      storageRequests,
      storageRemoveRequests,
      restWriteRequests,
    });

    await runMarketingHandoff(page, 'Remote success copy.');
    await page.getByRole('button', { name: '完了にする' }).click();
    await page.getByRole('button', { name: 'キャンバスへ渡す' }).click();
    await expect(page).toHaveURL(/\/canvas\/(?!new)[a-z0-9]+/);

    await expect.poll(() => functionRequests.length).toBe(1);
    expect(storageRequests).toEqual([]);
    expect(storageRemoveRequests).toEqual([]);
    expect(restWriteRequests).toEqual([]);
    expect(await readLatestLocalArtifactMetadata(page)).toMatchObject({
      remoteSaveStatus: 'succeeded',
      remoteSaveStage: 'completed',
    });

    await page.goto('/gallery');
    await page.getByPlaceholder('プロンプトで検索...').fill('Remote success copy.');
    await expect(page.locator('div.cursor-pointer')).toHaveCount(1);

    await page.goto('/history');
    await expect(page.getByText('Remote success copy.')).toHaveCount(1);
  });

  test('history page renders timeline readback', async ({ page }) => {
    await mockSupabase(page);

    await page.goto('/history');

    await expect(page.getByRole('heading', { name: '生成履歴' })).toBeVisible();
    await expect(page.getByText('Premium summer sale apparel campaign image')).toBeVisible();
  });

  test('gallery detail creates share links for saved images', async ({ page }) => {
    const shareLinkRequests: unknown[] = [];
    await mockSupabase(page, { shareLinkRequests });
    await completeOnboardingForMockUser(page);

    await page.goto('/gallery?image=00000000-0000-4000-8000-000000000201');
    await expect(page.getByRole('heading', { name: 'ギャラリー' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('div.cursor-pointer').first()).toBeVisible();

    const detailModal = page.locator('.fixed.inset-0');
    await expect(detailModal.getByText('画像の詳細')).toBeVisible({ timeout: 15_000 });
    await detailModal.getByRole('button', { name: '共有リンクを作成' }).click();

    await expect.poll(() => shareLinkRequests.length).toBe(1);
    expect(shareLinkRequests[0]).toMatchObject({
      imageId: '00000000-0000-4000-8000-000000000201',
      expiresInDays: 7,
    });
    await expect(detailModal.getByText('共有リンク', { exact: true })).toBeVisible();
    await expect(detailModal.getByText('https://heavy-chain.example/share/mock-00000000-0000-4000-8000-000000000201')).toBeVisible();
    await expect(detailModal.getByText(/有効期限:/)).toBeVisible();
  });

  test('public share page renders a shared image without onboarding', async ({ page }) => {
    const sharedImageRequests: string[] = [];
    await mockSupabase(page, { sharedImageRequests });

    await page.goto('/share/mock-public-token');

    await expect.poll(() => sharedImageRequests.length).toBe(1);
    expect(sharedImageRequests[0]).toBe('mock-public-token');
    await expect(page.getByRole('heading', { name: 'Shared ECモデル着用画像' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Shared ECモデル着用画像' })).toBeVisible();
    await expect(page.getByText('AIフィッティング')).toBeVisible();
    await expect(page.getByText('VirtualFittingV2 / ChangeModel')).toBeVisible();
    await expect(page.getByText('リンク有効期限')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Heavy Chainで生成する' })).toBeVisible();
  });

  test('credits page renders credit summary', async ({ page }) => {
    await mockSupabase(page);

    await page.goto('/credits');

    await expect(page.getByRole('heading', { name: '利用状況', level: 1 })).toBeVisible();
    await expect(page.getByText('生成利用 / 課金ゲートなし')).toBeVisible();
  });

  test('studio, models, patterns, video, and lab save local artifacts and hand off to canvas without Supabase writes', async ({ page }) => {
    const storageRequests: string[] = [];
    const storageRemoveRequests: string[] = [];
    const functionRequests: unknown[] = [];
    const restWriteRequests: Array<{ table: string; method: string; body: unknown }> = [];
    const restDeleteRequests: Array<{ table: string; method: string; url: string }> = [];
    const restMutationRequests: RestMutationRequest[] = [];
    await mockSupabase(page, {
      marketingArtifactFunctionRequests: functionRequests,
      storageRequests,
      storageRemoveRequests,
      restWriteRequests,
      restDeleteRequests,
      restMutationRequests,
    });
    await completeOnboardingForMockUser(page);
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    const scenarios = [
      {
        path: '/studio' as const,
        heading: 'Fashion Studio',
        choice: 'ライン企画',
        featureType: 'fashion-studio',
        label: 'Fashion Studio',
        projectName: 'Fashion Studio: ライン企画',
        workspaceToken: 'studio-model-library',
        primaryNeedle: 'Smoke trench line / 30代ユニセックス / 175cm / 都市的なストリートモデル',
        nextNeedle: '斜め45度の歩き姿、裾の動き、視線はカメラ外で淡いグレーのコンクリート壁、ギャラリー照明、床に柔らかい反射の生成プロンプトへ進む',
        resumePath: '/studio',
        expectedWorkflowVersion: 'studio-selection-local-v1',
        expectedGenerationIntent: {
          feature: 'model-matrix',
          prompt: [
            'Smoke trench line',
            '30代ユニセックス / 175cm / 都市的なストリートモデル',
            '斜め45度の歩き姿、裾の動き、視線はカメラ外',
            '淡いグレーのコンクリート壁、ギャラリー照明、床に柔らかい反射',
            'Smoke prop set',
            'smoke-reference.png',
          ].join('\n'),
          label: 'モデルマトリクスで生成',
          sourceWorkspace: 'studio',
          aspectRatio: undefined,
          promptFieldPlaceholder: '例: ネイビーのスリムフィットジーンズ',
        },
        expectedInputs: {
          modelProfile: '30代ユニセックス / 175cm / 都市的なストリートモデル',
          pose: '斜め45度の歩き姿、裾の動き、視線はカメラ外',
          background: '淡いグレーのコンクリート壁、ギャラリー照明、床に柔らかい反射',
          props: 'Smoke prop set',
          productLine: 'Smoke trench line',
          referenceImage: 'smoke-reference.png',
        },
        expectedPlan: {
          modelLibrary: 'studio-model-library',
        },
        expectedSelectedStudioSetup: {
          model: {
            id: 'street-neutral-30s',
            label: 'Street 30s',
            value: '30代ユニセックス / 175cm / 都市的なストリートモデル',
          },
          pose: {
            id: 'three-quarter-walk',
            label: '3/4 Walk',
            value: '斜め45度の歩き姿、裾の動き、視線はカメラ外',
          },
          background: {
            id: 'concrete-gallery',
            label: 'Concrete Gallery',
            value: '淡いグレーのコンクリート壁、ギャラリー照明、床に柔らかい反射',
          },
        },
        fillInputs: async () => {
          await page.getByLabel('モデル').fill('Smoke model profile');
          await page.getByLabel('ポーズ').fill('Smoke pose');
          await page.getByLabel('背景').fill('Smoke background');
          await page.getByLabel('小物').fill('Smoke prop set');
          await page.getByLabel('商品ライン').fill('Smoke trench line');
          await page.getByLabel('参照画像').fill('smoke-reference.png');
        },
        beforeSave: async () => {
          await expect(page.getByRole('heading', { name: '生成前スタジオ設定' })).toBeVisible();
          await expect(page.getByAltText('Studio setup preview')).toBeVisible();
          await expect(page.getByRole('button', { name: /Clean 20s/ })).toHaveAttribute('aria-pressed', 'true');
          await page.getByRole('button', { name: /Street 30s/ }).click();
          await page.getByRole('button', { name: /3\/4 Walk/ }).click();
          await page.getByRole('button', { name: /Concrete Gallery/ }).click();
          await expect(page.getByRole('button', { name: /Street 30s/ })).toHaveAttribute('aria-pressed', 'true');
          await expect(page.getByRole('button', { name: /3\/4 Walk/ })).toHaveAttribute('aria-pressed', 'true');
          await expect(page.getByRole('button', { name: /Concrete Gallery/ })).toHaveAttribute('aria-pressed', 'true');
          await expect(page.getByLabel('モデル')).toHaveValue('30代ユニセックス / 175cm / 都市的なストリートモデル');
          await expect(page.getByLabel('ポーズ')).toHaveValue('斜め45度の歩き姿、裾の動き、視線はカメラ外');
          await expect(page.getByLabel('背景')).toHaveValue('淡いグレーのコンクリート壁、ギャラリー照明、床に柔らかい反射');
        },
      },
      {
        path: '/models' as const,
        heading: 'モデルライブラリ',
        choice: 'LOOK確認',
        featureType: 'model-library-workspace',
        label: 'モデルライブラリ',
        projectName: 'モデルライブラリ: LOOK確認',
        workspaceToken: 'model-library-workspace',
        primaryNeedle: 'シャープな輪郭、落ち着いた表情、センターパートのダークヘア / 斜め45度の歩き姿、片手をポケット、裾の動きを見せる / やや高身長のユニセックス体型 / 175cm / M-Lサイズの落ち感 / ニュートラルミディアム / 30代 / LOOK確認 / Heavy Chain ロングトレンチ、都市的なストリートLOOK、SNS転用しやすい着用画像',
        nextNeedle: 'LOOK確認向けモデル候補 Street LOOK 30s をmodel-library-workspaceとしてモデルマトリクスへ渡す',
        resumePath: '/models',
        expectedWorkflowVersion: 'model-library-local-v1',
        expectedGenerationIntent: {
          feature: 'model-matrix',
          prompt: [
            'Face: シャープな輪郭、落ち着いた表情、センターパートのダークヘア',
            'Pose: 斜め45度の歩き姿、片手をポケット、裾の動きを見せる',
            'Body type: やや高身長のユニセックス体型 / 175cm / M-Lサイズの落ち感',
            'Skin tone: ニュートラルミディアム',
            'Age group: 30代',
            'Usage: LOOK確認',
            'Product description: Heavy Chain ロングトレンチ、都市的なストリートLOOK、SNS転用しやすい着用画像',
          ].join('\n'),
          label: 'モデルマトリクスで生成',
          sourceWorkspace: 'models',
          aspectRatio: undefined,
          promptFieldPlaceholder: '例: ネイビーのスリムフィットジーンズ',
          bodyTypes: ['regular'],
          ageGroups: ['30s'],
          skinTone: 'medium',
          hairStyle: 'medium',
        },
        expectedInputs: {
          face: 'シャープな輪郭、落ち着いた表情、センターパートのダークヘア',
          pose: '斜め45度の歩き姿、片手をポケット、裾の動きを見せる',
          bodyType: 'やや高身長のユニセックス体型 / 175cm / M-Lサイズの落ち感',
          skinTone: 'ニュートラルミディアム',
          ageGroup: '30代',
          usage: 'LOOK確認',
          productDescription: 'Heavy Chain ロングトレンチ、都市的なストリートLOOK、SNS転用しやすい着用画像',
          modelMatrixBodyTypes: ['regular'],
          modelMatrixAgeGroups: ['30s'],
          modelMatrixSkinTone: 'medium',
          modelMatrixHairStyle: 'medium',
        },
        expectedPlan: {
          modelLibrary: 'model-library-workspace',
        },
        expectedSelectedModelCandidate: {
          id: 'street-look-30s-neutral',
          label: 'Street LOOK 30s',
          face: 'シャープな輪郭、落ち着いた表情、センターパートのダークヘア',
          pose: '斜め45度の歩き姿、片手をポケット、裾の動きを見せる',
          bodyType: 'やや高身長のユニセックス体型 / 175cm / M-Lサイズの落ち感',
          skinTone: 'ニュートラルミディアム',
          ageGroup: '30代',
          usage: 'LOOK確認',
          productDescription: 'Heavy Chain ロングトレンチ、都市的なストリートLOOK、SNS転用しやすい着用画像',
          modelMatrixBodyTypes: ['regular'],
          modelMatrixAgeGroups: ['30s'],
          modelMatrixSkinTone: 'medium',
          modelMatrixHairStyle: 'medium',
        },
        fillInputs: async () => {
          await page.getByLabel('顔').fill('Smoke face');
          await page.getByLabel('ポーズ').fill('Smoke pose');
          await page.getByLabel('体型').fill('Smoke body');
          await page.getByLabel('肌色').fill('Smoke skin');
          await page.getByLabel('年齢層').fill('Smoke age');
          await page.getByLabel('利用目的').fill('EC標準');
          await page.getByLabel('商品説明').fill('Smoke product description');
        },
        beforeSave: async () => {
          await expect(page.getByRole('heading', { name: '固定モデル候補' })).toBeVisible();
          await expect(page.getByAltText('Model library candidate preview')).toBeVisible();
          await expect(page.getByRole('button', { name: /Clean EC 20s/ })).toHaveAttribute('aria-pressed', 'true');
          await expect(page.getByRole('button', { name: /Street LOOK 30s/ })).toHaveAttribute('aria-pressed', 'false');
          await page.getByRole('button', { name: /Street LOOK 30s/ }).click();
          await expect(page.getByRole('button', { name: /Street LOOK 30s/ })).toHaveAttribute('aria-pressed', 'true');
          await expect(page.getByLabel('顔')).toHaveValue('シャープな輪郭、落ち着いた表情、センターパートのダークヘア');
          await expect(page.getByLabel('ポーズ')).toHaveValue('斜め45度の歩き姿、片手をポケット、裾の動きを見せる');
          await expect(page.getByLabel('体型')).toHaveValue('やや高身長のユニセックス体型 / 175cm / M-Lサイズの落ち感');
          await expect(page.getByLabel('肌色')).toHaveValue('ニュートラルミディアム');
          await expect(page.getByLabel('年齢層')).toHaveValue('30代');
          await expect(page.getByLabel('利用目的')).toHaveValue('LOOK確認');
          await expect(page.getByLabel('商品説明')).toHaveValue('Heavy Chain ロングトレンチ、都市的なストリートLOOK、SNS転用しやすい着用画像');
        },
      },
      {
        path: '/patterns' as const,
        heading: '柄・グラフィック',
        choice: '総柄',
        featureType: 'graphic-pattern-workspace',
        label: '柄・グラフィック',
        projectName: '柄・グラフィック: 総柄',
        workspaceToken: 'pattern-design-brief',
        primaryNeedle: 'Smoke chain motif / Smoke hoodie body',
        nextNeedle: 'Smoke half-drop repeatをpattern-design-briefとして、Smoke vector cleanupへ進める',
        resumePath: '/patterns',
        expectedWorkflowVersion: 'pattern-preview-local-v1',
        expectedGenerationIntent: {
          feature: 'design-gacha',
          prompt: [
            'Smoke chain motif',
            'Repeat style: Smoke half-drop repeat',
            'Garment target: Smoke hoodie body',
            'Palette: Smoke black, ivory, red',
            'Vector intent: Smoke vector cleanup',
            'Reference assets: smoke-chain.svg, smoke-repeat.png',
          ].join('\n'),
          label: 'デザインガチャで生成',
          sourceWorkspace: 'patterns',
          aspectRatio: undefined,
          promptFieldPlaceholder: '例: 20代女性向けのカジュアルなサマードレス',
        },
        expectedInputs: {
          motifPrompt: 'Smoke chain motif',
          repeatStyle: 'Smoke half-drop repeat',
          garmentTarget: 'Smoke hoodie body',
          paletteNotes: 'Smoke black, ivory, red',
          vectorIntent: 'Smoke vector cleanup',
          referenceAssets: 'smoke-chain.svg, smoke-repeat.png',
        },
        expectedPlan: {
          patternBrief: 'pattern-design-brief',
        },
        expectedSelectedPatternPreview: {
          id: 'bandana-grid',
          label: 'Bandana Grid',
          mode: '総柄',
          repeatSignature: 'half-drop-bandana-grid',
          vectorSignature: 'repeat-tile-vector-cleanup',
          paletteSignature: 'black-ivory-blue-grid',
        },
        fillInputs: async () => {
          await page.getByLabel('モチーフ').fill('Smoke chain motif');
          await page.getByLabel('リピート').fill('Smoke half-drop repeat');
          await page.getByLabel('対象アイテム').fill('Smoke hoodie body');
          await page.getByLabel('パレット').fill('Smoke black, ivory, red');
          await page.getByLabel('ベクター化').fill('Smoke vector cleanup');
          await page.getByLabel('参照素材').fill('smoke-chain.svg, smoke-repeat.png');
        },
        beforeSave: async () => {
          await expect(page.getByRole('heading', { name: 'プレビュー候補' })).toBeVisible();
          await expect(page.getByAltText('Emblem Lockup preview')).toBeVisible();
          await expect(page.getByAltText('Bandana Grid preview')).toBeVisible();
          await expect(page.getByAltText('Vector Path Caps preview')).toBeVisible();
          await page.getByRole('button', { name: /Bandana Grid/ }).click();
          await expect(page.getByRole('button', { name: /Bandana Grid/ })).toHaveAttribute('aria-pressed', 'true');
        },
      },
      {
        path: '/video' as const,
        heading: 'Video Workstation',
        choice: '構成',
        featureType: 'video-workstation',
        label: 'Video Workstation',
        projectName: 'Video Workstation: 構成',
        workspaceToken: 'video-shot-plan',
        primaryNeedle: '12秒 / 4:5 / 1. Sleeve macro / 2. Stitch pan / 3. Fabric pull / 4. Logo tag CTA',
        nextNeedle: '1. Sleeve macro / 2. Stitch pan / 3. Fabric pull / 4. Logo tag CTAをvideo-shot-planとしてレンダー指示へ進める',
        resumePath: '/video',
        expectedWorkflowVersion: 'video-storyboard-local-v1',
        expectedGenerationIntent: {
          feature: 'campaign-image',
          prompt: [
            'Storyboard: Texture Close-up',
            'Shot order: 1. Sleeve macro / 2. Stitch pan / 3. Fabric pull / 4. Logo tag CTA',
            'Motion: slow push-in, lateral macro pan, tactile fabric pull',
            'Framing: macro crop, shallow focus, detail-first CTA',
            'CTA: Feel the heavyweight texture',
            'Materials: texture_macro.png, stitch_ref.mov, woven_label.svg',
            'Format: 4:5',
          ].join('\n'),
          label: 'キャンペーン画像で生成',
          sourceWorkspace: 'video',
          aspectRatio: '4:5',
          promptFieldPlaceholder: '例: 夏のサマーセール告知、爽やかな海辺の雰囲気',
        },
        expectedInputs: {
          duration: '12秒',
          aspectRatio: '4:5',
          shotPlan: '1. Sleeve macro / 2. Stitch pan / 3. Fabric pull / 4. Logo tag CTA',
          subtitleCta: 'Feel the heavyweight texture',
          materials: 'texture_macro.png, stitch_ref.mov, woven_label.svg',
        },
        expectedPlan: {
          videoShotPlan: 'video-shot-plan',
        },
        expectedSelectedVideoStoryboard: {
          id: 'texture-close-up',
          label: 'Texture Close-up',
          shotOrder: '1. Sleeve macro / 2. Stitch pan / 3. Fabric pull / 4. Logo tag CTA',
          motion: 'slow push-in, lateral macro pan, tactile fabric pull',
          framing: 'macro crop, shallow focus, detail-first CTA',
          cta: 'Feel the heavyweight texture',
          materials: 'texture_macro.png, stitch_ref.mov, woven_label.svg',
          format: '4:5',
          duration: '12秒',
          motionSignature: 'slow-push-lateral-macro-pull',
          framingSignature: 'macro-shallow-focus-detail-cta',
          workflowMode: 'material-detail',
        },
        fillInputs: async () => {
          await page.getByLabel('尺').fill('22秒');
          await page.getByLabel('比率').fill('4:5');
          await page.getByLabel('ショット構成').fill('Smoke opening, Smoke close-up, Smoke CTA');
          await page.getByLabel('字幕CTA').fill('Smoke CTA copy');
          await page.getByLabel('素材').fill('smoke-product.png, smoke-logo.svg');
        },
        beforeSave: async () => {
          await expect(page.getByRole('heading', { name: 'Storyboard候補' })).toBeVisible();
          await expect(page.getByAltText('Launch Reel storyboard preview')).toBeVisible();
          await expect(page.getByRole('button', { name: /Launch Reel/ })).toHaveAttribute('aria-pressed', 'true');
          await expect(page.getByRole('button', { name: /Texture Close-up/ })).toHaveAttribute('aria-pressed', 'false');
          await expect(page.getByRole('button', { name: /Fit Check CTA/ })).toHaveAttribute('aria-pressed', 'false');
          await page.getByRole('button', { name: /Texture Close-up/ }).click();
          await expect(page.getByRole('button', { name: /Texture Close-up/ })).toHaveAttribute('aria-pressed', 'true');
          await expect(page.getByAltText('Texture Close-up storyboard preview')).toBeVisible();
          await expect(page.getByLabel('尺')).toHaveValue('12秒');
          await expect(page.getByLabel('比率')).toHaveValue('4:5');
          await expect(page.getByLabel('ショット構成')).toHaveValue('1. Sleeve macro / 2. Stitch pan / 3. Fabric pull / 4. Logo tag CTA');
          await expect(page.getByLabel('字幕CTA')).toHaveValue('Feel the heavyweight texture');
          await expect(page.getByLabel('素材')).toHaveValue('texture_macro.png, stitch_ref.mov, woven_label.svg');
        },
      },
      {
        path: '/lab' as const,
        heading: 'Lab',
        choice: 'プロンプト実験',
        featureType: 'lab-workflow',
        label: 'Lab ワークフロー',
        projectName: 'Lab: プロンプト実験',
        workspaceToken: 'lab-evaluation',
        primaryNeedle: 'Smoke retail shelf test: gray background keeps garment edges readable / Heavy Chain retail display, sheer jacket, neutral gray studio shelf, crisp edge light',
        nextNeedle: 'edge clarity / material sheen / campaign reuse / buyer confidenceでlab-evaluationを採点し、Candidate B: gray retail shelf with crisp edge lightを比較する',
        resumePath: '/lab',
        expectedWorkflowVersion: 'lab-evaluation-local-v1',
        expectedGenerationIntent: {
          feature: 'campaign-image',
          prompt: [
            'Heavy Chain retail display, sheer jacket, neutral gray studio shelf, crisp edge light',
            'Hypothesis: Smoke retail shelf test: gray background keeps garment edges readable',
            'Evaluation axis: edge clarity / material sheen / campaign reuse / buyer confidence',
            'Candidate direction: Candidate B: gray retail shelf with crisp edge light',
            'Experiment: Retail Readiness',
            'Deterministic score: 88',
            'Decision: Use the gray retail setup for the next EC detail generation',
          ].join('\n'),
          label: 'キャンペーン画像で生成',
          sourceWorkspace: 'lab',
          aspectRatio: undefined,
          promptFieldPlaceholder: '例: 夏のサマーセール告知、爽やかな海辺の雰囲気',
        },
        expectedInputs: {
          hypothesis: 'Smoke retail shelf test: gray background keeps garment edges readable',
          promptDraft: 'Heavy Chain retail display, sheer jacket, neutral gray studio shelf, crisp edge light',
          evaluationAxis: 'edge clarity / material sheen / campaign reuse / buyer confidence',
          candidate: 'Candidate B: gray retail shelf with crisp edge light',
        },
        expectedPlan: {
          labEvaluation: 'lab-evaluation',
        },
        expectedSelectedLabExperiment: {
          id: 'retail-readiness',
          label: 'Retail Readiness',
          hypothesis: 'Smoke retail shelf test: gray background keeps garment edges readable',
          promptDraft: 'Heavy Chain retail display, sheer jacket, neutral gray studio shelf, crisp edge light',
          evaluationAxis: 'edge clarity / material sheen / campaign reuse / buyer confidence',
          candidate: 'Candidate B: gray retail shelf with crisp edge light',
          deterministicScore: 88,
          scoreSignature: 'quality-88-retail-readiness',
          experimentMode: 'store-simulation',
          decision: 'Use the gray retail setup for the next EC detail generation',
          risk: 'Background props can compete with the garment tag',
        },
        fillInputs: async () => {
          await page.getByLabel('仮説').fill('Smoke hypothesis');
          await page.getByLabel('プロンプト案').fill('Smoke prompt draft');
          await page.getByLabel('評価軸').fill('Smoke axis');
          await page.getByLabel('採用候補').fill('Smoke candidate');
        },
        beforeSave: async () => {
          await expect(page.getByRole('heading', { name: '評価候補' })).toBeVisible();
          await expect(page.getByAltText('Material Lighting lab experiment preview')).toBeVisible();
          await expect(page.getByRole('button', { name: /Material Lighting/ })).toHaveAttribute('aria-pressed', 'true');
          await expect(page.getByRole('button', { name: /Retail Readiness/ })).toHaveAttribute('aria-pressed', 'false');
          await expect(page.getByRole('button', { name: /Campaign Transfer/ })).toHaveAttribute('aria-pressed', 'false');
          await page.getByRole('button', { name: /Retail Readiness/ }).click();
          await expect(page.getByRole('button', { name: /Retail Readiness/ })).toHaveAttribute('aria-pressed', 'true');
          await expect(page.getByAltText('Retail Readiness lab experiment preview')).toBeVisible();
          await expect(page.getByText('決定的スコア 88')).toBeVisible();
          await expect(page.getByText('quality-88-retail-readiness')).toBeVisible();
          await expect(page.getByLabel('仮説')).toHaveValue('Smoke retail shelf test: gray background keeps garment edges readable');
          await expect(page.getByLabel('プロンプト案')).toHaveValue('Heavy Chain retail display, sheer jacket, neutral gray studio shelf, crisp edge light');
          await expect(page.getByLabel('評価軸')).toHaveValue('edge clarity / material sheen / campaign reuse / buyer confidence');
          await expect(page.getByLabel('採用候補')).toHaveValue('Candidate B: gray retail shelf with crisp edge light');
        },
      },
    ];

    for (const scenario of scenarios) {
      const expectedSourceLabel = {
        '/studio': 'Fashion Studio',
        '/models': 'モデルライブラリ',
        '/patterns': '柄・グラフィック',
        '/video': 'Video Workstation',
        '/lab': 'Lab',
      }[scenario.path];
      await runLocalWorkspaceHandoff(page, scenario.path, scenario.choice, scenario.heading, scenario.fillInputs, scenario.beforeSave);
      await expect(page).toHaveURL(/\/canvas\/(?!new)[a-z0-9]+/);
      await expect(page.getByRole('heading', { name: scenario.projectName })).toBeVisible();

      const artifact = await readLatestLocalArtifact(page);
      expect(artifact).toMatchObject({
        brandId: mockBrand.id,
        featureType: scenario.featureType,
        title: scenario.projectName,
        canvasProjectId: expect.any(String),
        metadata: {
          feature: scenario.featureType,
          activeChoice: scenario.choice,
          workspace: scenario.path.slice(1),
          workflowVersion: scenario.expectedWorkflowVersion,
          inputs: scenario.expectedInputs,
          plan: expect.objectContaining(scenario.expectedPlan),
          status: 'planned',
          resumePath: scenario.resumePath,
          handoffKind: 'local-workflow-intake',
          primaryInput: scenario.primaryNeedle,
          nextStep: scenario.nextNeedle,
          generationIntent: expect.objectContaining({
            feature: scenario.expectedGenerationIntent.feature,
            prompt: scenario.expectedGenerationIntent.prompt,
            label: scenario.expectedGenerationIntent.label,
            sourceWorkspace: scenario.expectedGenerationIntent.sourceWorkspace,
            workflowVersion: scenario.expectedWorkflowVersion,
            sourceLabel: expectedSourceLabel,
            sourceResumePath: scenario.resumePath,
            sourceMode: 'local-workflow-intake',
          }),
        },
      });
      const generationIntent = artifact.metadata.generationIntent as {
        feature: string;
        prompt: string;
        href: string;
        label: string;
        sourceWorkspace: string;
        workflowVersion: string;
        sourceLabel: string;
        sourceResumePath: string;
        sourceMode: string;
        aspectRatio?: string;
        selectedPatternPreview?: unknown;
        motifPrompt?: string;
        repeatStyle?: string;
        garmentTarget?: string;
        paletteNotes?: string;
        vectorIntent?: string;
        referenceAssets?: string;
      };
      expect(generationIntent.href).toContain(`/generate?`);
      expect(generationIntent).toMatchObject({
        workflowVersion: scenario.expectedWorkflowVersion,
        sourceLabel: expectedSourceLabel,
        sourceResumePath: scenario.resumePath,
        sourceMode: 'local-workflow-intake',
      });
      const generationIntentUrl = new URL(`http://localhost${generationIntent.href}`);
      expect(generationIntentUrl.searchParams.get('feature')).toBe(scenario.expectedGenerationIntent.feature);
      expect(generationIntentUrl.searchParams.get('prompt')).toBe(scenario.expectedGenerationIntent.prompt);
      expect(generationIntentUrl.searchParams.get('ratio')).toBe(scenario.expectedGenerationIntent.aspectRatio ?? null);
      expect(generationIntentUrl.searchParams.get('sourceWorkspace')).toBe(scenario.expectedGenerationIntent.sourceWorkspace);
      expect(generationIntentUrl.searchParams.get('workflowVersion')).toBe(scenario.expectedWorkflowVersion);
      expect(generationIntentUrl.searchParams.get('sourceLabel')).toBe(expectedSourceLabel);
      expect(generationIntentUrl.searchParams.get('sourceResumePath')).toBe(scenario.resumePath);
      expect(generationIntentUrl.searchParams.get('sourceMode')).toBe('local-workflow-intake');
      if ('bodyTypes' in scenario.expectedGenerationIntent && scenario.expectedGenerationIntent.bodyTypes) {
        expect(generationIntentUrl.searchParams.get('bodyTypes')).toBe(scenario.expectedGenerationIntent.bodyTypes.join(','));
      }
      if ('ageGroups' in scenario.expectedGenerationIntent && scenario.expectedGenerationIntent.ageGroups) {
        expect(generationIntentUrl.searchParams.get('ageGroups')).toBe(scenario.expectedGenerationIntent.ageGroups.join(','));
      }
      if ('skinTone' in scenario.expectedGenerationIntent && scenario.expectedGenerationIntent.skinTone) {
        expect(generationIntentUrl.searchParams.get('skinTone')).toBe(scenario.expectedGenerationIntent.skinTone);
      }
      if ('hairStyle' in scenario.expectedGenerationIntent && scenario.expectedGenerationIntent.hairStyle) {
        expect(generationIntentUrl.searchParams.get('hairStyle')).toBe(scenario.expectedGenerationIntent.hairStyle);
      }
      if (scenario.expectedGenerationIntent.aspectRatio) {
        expect(generationIntent).toMatchObject({ aspectRatio: scenario.expectedGenerationIntent.aspectRatio });
      }
      expect(artifact.imageUrl).toContain('data:image/svg+xml');
      const previewSvg = decodeURIComponent(artifact.imageUrl.replace('data:image/svg+xml;utf8,', ''));
      expect(previewSvg).toContain('Primary input');
      expect(previewSvg).toContain(scenario.primaryNeedle);
      expect(previewSvg).toContain('Next step');
      expect(previewSvg).toContain(scenario.nextNeedle);
      expect(JSON.stringify(artifact.metadata)).toContain(scenario.workspaceToken);
      if ('expectedSelectedPatternPreview' in scenario && scenario.expectedSelectedPatternPreview) {
        expect(artifact.metadata).toMatchObject({
          selectedPatternPreview: scenario.expectedSelectedPatternPreview,
          preview: expect.objectContaining({
            selectedPatternPreview: scenario.expectedSelectedPatternPreview,
            previewKind: 'deterministic-svg',
            imageUrl: expect.stringContaining('data:image/svg+xml'),
          }),
        });
        expect(artifact.metadata.plan).toMatchObject({
          selectedPatternPreview: scenario.expectedSelectedPatternPreview,
        });
        expect(generationIntent).toMatchObject({
          selectedPatternPreview: scenario.expectedSelectedPatternPreview,
          motifPrompt: scenario.expectedInputs.motifPrompt,
          repeatStyle: scenario.expectedInputs.repeatStyle,
          garmentTarget: scenario.expectedInputs.garmentTarget,
          paletteNotes: scenario.expectedInputs.paletteNotes,
          vectorIntent: scenario.expectedInputs.vectorIntent,
          referenceAssets: scenario.expectedInputs.referenceAssets,
        });
        expect(generationIntentUrl.searchParams.get('patternPreviewId')).toBe(scenario.expectedSelectedPatternPreview.id);
        expect(generationIntentUrl.searchParams.get('patternPreviewLabel')).toBe(scenario.expectedSelectedPatternPreview.label);
        expect(generationIntentUrl.searchParams.get('patternPreviewMode')).toBe(scenario.expectedSelectedPatternPreview.mode);
        expect(generationIntentUrl.searchParams.get('repeatSignature')).toBe(scenario.expectedSelectedPatternPreview.repeatSignature);
        expect(generationIntentUrl.searchParams.get('vectorSignature')).toBe(scenario.expectedSelectedPatternPreview.vectorSignature);
        expect(generationIntentUrl.searchParams.get('paletteSignature')).toBe(scenario.expectedSelectedPatternPreview.paletteSignature);
        expect(generationIntentUrl.searchParams.get('motifPrompt')).toBe(scenario.expectedInputs.motifPrompt);
        expect(generationIntentUrl.searchParams.get('repeatStyle')).toBe(scenario.expectedInputs.repeatStyle);
        expect(generationIntentUrl.searchParams.get('garmentTarget')).toBe(scenario.expectedInputs.garmentTarget);
        expect(generationIntentUrl.searchParams.get('paletteNotes')).toBe(scenario.expectedInputs.paletteNotes);
        expect(generationIntentUrl.searchParams.get('vectorIntent')).toBe(scenario.expectedInputs.vectorIntent);
        expect(generationIntentUrl.searchParams.get('referenceAssets')).toBe(scenario.expectedInputs.referenceAssets);
        expect(previewSvg).toContain(`selected-pattern-preview:${scenario.expectedSelectedPatternPreview.id}`);
        expect(previewSvg).toContain(scenario.expectedSelectedPatternPreview.label);
        expect(previewSvg).toContain(scenario.expectedSelectedPatternPreview.repeatSignature);
        expect(previewSvg).toContain('Smoke half-drop repeat');
      }
      if ('expectedSelectedStudioSetup' in scenario && scenario.expectedSelectedStudioSetup) {
        expect(artifact.metadata).toMatchObject({
          selectedStudioSetup: scenario.expectedSelectedStudioSetup,
          preview: expect.objectContaining({
            selectedStudioSetup: scenario.expectedSelectedStudioSetup,
            previewKind: 'deterministic-svg',
            marker: 'selected-studio-setup',
            imageUrl: expect.stringContaining('data:image/svg+xml'),
          }),
        });
        expect(artifact.metadata.inputs).toMatchObject({
          selectedStudioSetup: scenario.expectedSelectedStudioSetup,
        });
        expect(artifact.metadata.plan).toMatchObject({
          selectedStudioSetup: scenario.expectedSelectedStudioSetup,
          preview: expect.objectContaining({
            marker: 'selected-studio-setup',
          }),
        });
        expect(previewSvg).toContain('data-studio-preview="studio-selection-local-v1"');
        expect(previewSvg).toContain('workflowVersion="studio-selection-local-v1"');
        expect(previewSvg).toContain(`nextStep="${scenario.nextNeedle}"`);
        expect(previewSvg).toContain('selectedStudioSetup="street-neutral-30s/three-quarter-walk/concrete-gallery"');
        expect(previewSvg).toContain('selected-studio-setup:street-neutral-30s/three-quarter-walk/concrete-gallery');
        expect(previewSvg).toContain('Studio setup');
      }
      if ('expectedSelectedModelCandidate' in scenario && scenario.expectedSelectedModelCandidate) {
        expect(artifact.metadata).toMatchObject({
          selectedModelCandidate: scenario.expectedSelectedModelCandidate,
          preview: expect.objectContaining({
            selectedModelCandidate: scenario.expectedSelectedModelCandidate,
            previewKind: 'deterministic-svg',
            marker: 'selected-model-candidate',
            imageUrl: expect.stringContaining('data:image/svg+xml'),
          }),
        });
        expect(artifact.metadata.inputs).toMatchObject({
          selectedModelCandidate: scenario.expectedSelectedModelCandidate,
        });
        expect(artifact.metadata.plan).toMatchObject({
          selectedModelCandidate: scenario.expectedSelectedModelCandidate,
          preview: expect.objectContaining({
            marker: 'selected-model-candidate',
          }),
        });
        expect(previewSvg).toContain('data-model-library="model-library-local-v1"');
        expect(previewSvg).toContain('workflowVersion="model-library-local-v1"');
        expect(previewSvg).toContain(`selectedModelCandidate="${scenario.expectedSelectedModelCandidate.id}"`);
        expect(previewSvg).toContain(`selected-model-candidate:${scenario.expectedSelectedModelCandidate.id}`);
        expect(previewSvg).toContain('Street LOOK 30s');
      }
      if ('expectedSelectedVideoStoryboard' in scenario && scenario.expectedSelectedVideoStoryboard) {
        expect(artifact.metadata).toMatchObject({
          selectedVideoStoryboard: scenario.expectedSelectedVideoStoryboard,
          preview: expect.objectContaining({
            selectedVideoStoryboard: scenario.expectedSelectedVideoStoryboard,
            previewKind: 'deterministic-svg',
            marker: 'selected-video-storyboard',
            imageUrl: expect.stringContaining('data:image/svg+xml'),
          }),
        });
        expect(artifact.metadata.inputs).toMatchObject({
          selectedVideoStoryboard: scenario.expectedSelectedVideoStoryboard,
        });
        expect(artifact.metadata.plan).toMatchObject({
          selectedVideoStoryboard: scenario.expectedSelectedVideoStoryboard,
          preview: expect.objectContaining({
            marker: 'selected-video-storyboard',
          }),
        });
        expect(previewSvg).toContain('data-video-storyboard="video-storyboard-local-v1"');
        expect(previewSvg).toContain('workflowVersion="video-storyboard-local-v1"');
        expect(previewSvg).toContain(`selectedVideoStoryboard="${scenario.expectedSelectedVideoStoryboard.id}"`);
        expect(previewSvg).toContain(`selected-video-storyboard:${scenario.expectedSelectedVideoStoryboard.id}`);
        expect(previewSvg).toContain(`motionSignature:${scenario.expectedSelectedVideoStoryboard.motionSignature}`);
        expect(previewSvg).toContain(`framingSignature:${scenario.expectedSelectedVideoStoryboard.framingSignature}`);
      }
      if ('expectedSelectedLabExperiment' in scenario && scenario.expectedSelectedLabExperiment) {
        expect(artifact.metadata).toMatchObject({
          selectedLabExperiment: scenario.expectedSelectedLabExperiment,
          preview: expect.objectContaining({
            selectedLabExperiment: scenario.expectedSelectedLabExperiment,
            previewKind: 'deterministic-svg',
            marker: 'selected-lab-experiment',
            imageUrl: expect.stringContaining('data:image/svg+xml'),
          }),
        });
        expect(artifact.metadata.inputs).toMatchObject({
          selectedLabExperiment: scenario.expectedSelectedLabExperiment,
        });
        expect(artifact.metadata.plan).toMatchObject({
          selectedLabExperiment: scenario.expectedSelectedLabExperiment,
          deterministicScore: scenario.expectedSelectedLabExperiment.deterministicScore,
          preview: expect.objectContaining({
            marker: 'selected-lab-experiment',
          }),
        });
        expect(previewSvg).toContain('data-lab-experiment="lab-evaluation-local-v1"');
        expect(previewSvg).toContain('workflowVersion="lab-evaluation-local-v1"');
        expect(previewSvg).toContain(`selectedLabExperiment="${scenario.expectedSelectedLabExperiment.id}"`);
        expect(previewSvg).toContain(`deterministic-score:${scenario.expectedSelectedLabExperiment.deterministicScore}`);
        expect(previewSvg).toContain(`scoreSignature:${scenario.expectedSelectedLabExperiment.scoreSignature}`);
        expect(previewSvg).toContain(`selected-lab-experiment:${scenario.expectedSelectedLabExperiment.id}`);
      }

      const canvasProject = await readLatestCanvasProject(page);
      expect(canvasProject).toMatchObject({
        name: scenario.projectName,
        brandId: mockBrand.id,
      });
      expect(canvasProject.objects).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'image',
          src: expect.stringContaining('data:image/svg+xml'),
          metadata: expect.objectContaining({
            feature: scenario.featureType,
            parameters: expect.objectContaining({
              handoffKind: 'local-workflow-intake',
              resumePath: scenario.resumePath,
              generationIntent: expect.objectContaining({
                href: generationIntent.href,
                prompt: scenario.expectedGenerationIntent.prompt,
              }),
            }),
          }),
        }),
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining(scenario.primaryNeedle),
          metadata: expect.objectContaining({
            parameters: expect.objectContaining({
              primaryInput: scenario.primaryNeedle,
              nextStep: scenario.nextNeedle,
              status: 'planned',
              generationIntent: expect.objectContaining({
                href: generationIntent.href,
                prompt: scenario.expectedGenerationIntent.prompt,
              }),
            }),
          }),
        }),
      ]));
      if ('expectedSelectedStudioSetup' in scenario && scenario.expectedSelectedStudioSetup) {
        const canvasImage = canvasProject.objects.find((object: { type: string }) => object.type === 'image');
        expect(canvasImage).toMatchObject({
          metadata: {
            parameters: expect.objectContaining({
              selectedStudioSetup: scenario.expectedSelectedStudioSetup,
              preview: expect.objectContaining({
                selectedStudioSetup: scenario.expectedSelectedStudioSetup,
                marker: 'selected-studio-setup',
              }),
            }),
          },
        });
      }
      if ('expectedSelectedModelCandidate' in scenario && scenario.expectedSelectedModelCandidate) {
        const canvasImage = canvasProject.objects.find((object: { type: string }) => object.type === 'image');
        expect(canvasImage).toMatchObject({
          metadata: {
            parameters: expect.objectContaining({
              selectedModelCandidate: scenario.expectedSelectedModelCandidate,
              preview: expect.objectContaining({
                selectedModelCandidate: scenario.expectedSelectedModelCandidate,
                marker: 'selected-model-candidate',
              }),
            }),
          },
        });
      }
      if ('expectedSelectedVideoStoryboard' in scenario && scenario.expectedSelectedVideoStoryboard) {
        const canvasImage = canvasProject.objects.find((object: { type: string }) => object.type === 'image');
        expect(canvasImage).toMatchObject({
          metadata: {
            parameters: expect.objectContaining({
              selectedVideoStoryboard: scenario.expectedSelectedVideoStoryboard,
              preview: expect.objectContaining({
                selectedVideoStoryboard: scenario.expectedSelectedVideoStoryboard,
                marker: 'selected-video-storyboard',
              }),
            }),
          },
        });
      }
      if ('expectedSelectedLabExperiment' in scenario && scenario.expectedSelectedLabExperiment) {
        const canvasImage = canvasProject.objects.find((object: { type: string }) => object.type === 'image');
        expect(canvasImage).toMatchObject({
          metadata: {
            parameters: expect.objectContaining({
              selectedLabExperiment: scenario.expectedSelectedLabExperiment,
              preview: expect.objectContaining({
                selectedLabExperiment: scenario.expectedSelectedLabExperiment,
                marker: 'selected-lab-experiment',
              }),
            }),
          },
        });
      }
      const canvasText = canvasProject.objects.find((object: { type: string }) => object.type === 'text')?.text;
      expect(canvasText).toContain(scenario.nextNeedle);

      await page.goto('/gallery');
      await page.getByPlaceholder('プロンプトで検索...').fill(scenario.workspaceToken);
      await expect(page.locator('div.cursor-pointer')).toHaveCount(1);
      await page.locator('div.cursor-pointer').first().click();
      const detailModal = page.locator('.fixed.inset-0');
      await expect(detailModal.getByText(scenario.featureType).first()).toBeVisible();
      await expect(detailModal.getByText(scenario.primaryNeedle).first()).toBeVisible();
      await expect(detailModal.getByText(scenario.nextNeedle).first()).toBeVisible();
      await detailModal.getByRole('link', { name: 'この内容で生成' }).click();
      await expect(page).toHaveURL(/\/generate\?/);
      await expect(page).toHaveURL(new RegExp(`feature=${scenario.expectedGenerationIntent.feature}`));
      await expect(page.getByText('ワークスペース再開')).toBeVisible();
      await expect(page.getByText(`${expectedSourceLabel} から受け取った内容で生成します`)).toBeVisible();
      await expect(page.getByRole('link', { name: `${expectedSourceLabel}へ戻る` })).toHaveAttribute('href', scenario.resumePath);
      await expect(page.getByPlaceholder(scenario.expectedGenerationIntent.promptFieldPlaceholder)).toHaveValue(scenario.expectedGenerationIntent.prompt);
      if (scenario.expectedGenerationIntent.aspectRatio) {
        await expect(page.getByRole('button', { name: /ポートレート/ })).toHaveAttribute('aria-pressed', 'true');
      }

      await page.goto('/history');
      await expect(page.getByText(scenario.label).first()).toBeVisible();
      await expect(page.getByText(scenario.primaryNeedle).first()).toBeVisible();
      await expect(page.getByText(scenario.nextNeedle).first()).toBeVisible();
      await page.getByRole('link', { name: '生成へ進む' }).first().click();
      await expect(page).toHaveURL(/\/generate\?/);
      await expect(page).toHaveURL(new RegExp(`feature=${scenario.expectedGenerationIntent.feature}`));
      await expect(page.getByText('ワークスペース再開')).toBeVisible();
      await expect(page.getByText(`${expectedSourceLabel} から受け取った内容で生成します`)).toBeVisible();
      await expect(page.getByRole('link', { name: `${expectedSourceLabel}へ戻る` })).toHaveAttribute('href', scenario.resumePath);
      await expect(page.getByPlaceholder(scenario.expectedGenerationIntent.promptFieldPlaceholder)).toHaveValue(scenario.expectedGenerationIntent.prompt);
      if (scenario.expectedGenerationIntent.aspectRatio) {
        await expect(page.getByRole('button', { name: /ポートレート/ })).toHaveAttribute('aria-pressed', 'true');
      }
    }

    expect(consoleErrors.filter((error) => error.includes('Encountered two children with the same key'))).toEqual([]);
    expect(functionRequests).toEqual([]);
    expect(storageRequests).toEqual([]);
    expect(storageRemoveRequests).toEqual([]);
    expect(restWriteRequests).toEqual([]);
    expect(restDeleteRequests).toEqual([]);
    expect(restMutationRequests).toEqual([]);
  });

  test('video generation intent saves generated local artifact provenance for gallery and history', async ({ page }) => {
    const storageRequests: string[] = [];
    const storageRemoveRequests: string[] = [];
    const functionRequests: string[] = [];
    const generateImageRequests: unknown[] = [];
    const restWriteRequests: RestWriteRequest[] = [];
    const restDeleteRequests: RestDeleteRequest[] = [];
    const restMutationRequests: RestMutationRequest[] = [];
    await mockSupabase(page, {
      functionRequests,
      generateImageRequests,
      storageRequests,
      storageRemoveRequests,
      restWriteRequests,
      restDeleteRequests,
      restMutationRequests,
      generatedImagesResponse: [{
        id: 'video-source-generated-001',
        imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="400"%3E%3Crect fill="%23f2ede6" width="320" height="400"/%3E%3Ctext x="34" y="210" font-size="22"%3EVideo Source%3C/text%3E%3C/svg%3E',
        prompt: 'Generated from video source readback',
        label: 'Video Source Output',
      }],
    });
    await completeOnboardingForMockUser(page);

    await runLocalWorkspaceHandoff(
      page,
      '/video',
      '構成',
      'Video Workstation',
      async () => {
        await page.getByLabel('尺').fill('22秒');
        await page.getByLabel('比率').fill('4:5');
        await page.getByLabel('ショット構成').fill('Smoke opening, Smoke close-up, Smoke CTA');
        await page.getByLabel('字幕CTA').fill('Smoke CTA copy');
        await page.getByLabel('素材').fill('smoke-product.png, smoke-logo.svg');
      },
      async () => {
        await page.getByRole('button', { name: /Texture Close-up/ }).click();
        await expect(page.getByRole('button', { name: /Texture Close-up/ })).toHaveAttribute('aria-pressed', 'true');
      }
    );
    await expect(page).toHaveURL(/\/canvas\/(?!new)[a-z0-9]+/);

    const handoffArtifact = await readLatestLocalArtifact(page);
    const generationIntent = handoffArtifact.metadata.generationIntent as { href: string };
    await page.goto(generationIntent.href);
    await expect(page.getByText('ワークスペース再開')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Video Workstationへ戻る' })).toHaveAttribute('href', '/video');
    await page.getByRole('button', { name: '生成', exact: true }).click();
    await expect(page.getByText('Video Source Output')).toBeVisible();

    const generatedMetadata = await readLatestLocalArtifactMetadata(page);
    expect(generatedMetadata).toMatchObject({
      sourceWorkspace: 'video',
      workflowVersion: 'video-storyboard-local-v1',
      sourceLabel: 'Video Workstation',
      sourceResumePath: '/video',
      sourceMode: 'local-workflow-intake',
      generatedResultId: 'video-source-generated-001',
      generatedResultLabel: 'Video Source Output',
      generationIntent: expect.objectContaining({
        feature: 'campaign-image',
        prompt: 'Generated from video source readback',
        sourceWorkspace: 'video',
        workflowVersion: 'video-storyboard-local-v1',
        sourceLabel: 'Video Workstation',
        sourceResumePath: '/video',
        sourceMode: 'local-workflow-intake',
        href: expect.stringContaining('sourceWorkspace=video'),
      }),
    });

    await page.goto('/gallery');
    await page.getByPlaceholder('プロンプトで検索...').fill('Generated from video source readback');
    await expect(page.locator('div.cursor-pointer')).toHaveCount(1);
    await page.locator('div.cursor-pointer').first().click();
    const detailModal = page.locator('.fixed.inset-0');
    await expect(detailModal.getByText('Generated from video source readback')).toBeVisible();
    await expect(detailModal.getByRole('link', { name: /元ワークスペースへ戻る: Video Workstation/ })).toHaveAttribute('href', '/video');

    await page.goto('/history');
    await expect(page.getByText('Generated from video source readback')).toBeVisible();
    await expect(page.getByRole('link', { name: /元ワークスペースへ戻る: Video Workstation/ }).first()).toHaveAttribute('href', '/video');

    expect(functionRequests).toEqual(['/functions/v1/generate-image']);
    expect(storageRequests).toEqual([]);
    expect(storageRemoveRequests).toEqual([]);
    expect(restWriteRequests).toEqual([]);
    expect(restDeleteRequests).toEqual([]);
    expect(restMutationRequests).toEqual([]);
  });

  test('all workspace source contexts save generated local artifact provenance', async ({ page }) => {
    const storageRequests: string[] = [];
    const storageRemoveRequests: string[] = [];
    const functionRequests: string[] = [];
    const generateImageRequests: unknown[] = [];
    const restWriteRequests: RestWriteRequest[] = [];
    const restDeleteRequests: RestDeleteRequest[] = [];
    const restMutationRequests: RestMutationRequest[] = [];
    await mockSupabase(page, {
      functionRequests,
      generateImageRequests,
      storageRequests,
      storageRemoveRequests,
      restWriteRequests,
      restDeleteRequests,
      restMutationRequests,
    });
    await completeOnboardingForMockUser(page);

    const sourceScenarios = [
      {
        sourceWorkspace: 'studio',
        workflowVersion: 'studio-selection-local-v1',
        sourceLabel: 'Fashion Studio',
        sourceResumePath: '/studio',
      },
      {
        sourceWorkspace: 'models',
        workflowVersion: 'model-library-local-v1',
        sourceLabel: 'モデルライブラリ',
        sourceResumePath: '/models',
      },
      {
        sourceWorkspace: 'patterns',
        workflowVersion: 'pattern-preview-local-v1',
        sourceLabel: '柄・グラフィック',
        sourceResumePath: '/patterns',
      },
      {
        sourceWorkspace: 'video',
        workflowVersion: 'video-storyboard-local-v1',
        sourceLabel: 'Video Workstation',
        sourceResumePath: '/video',
      },
      {
        sourceWorkspace: 'lab',
        workflowVersion: 'lab-evaluation-local-v1',
        sourceLabel: 'Lab',
        sourceResumePath: '/lab',
      },
    ] as const;

    for (const [index, scenario] of sourceScenarios.entries()) {
      const prompt = `Generated provenance smoke ${scenario.sourceWorkspace}`;
      const params = new URLSearchParams({
        feature: 'campaign-image',
        prompt,
        ratio: '4:5',
        sourceWorkspace: scenario.sourceWorkspace,
        workflowVersion: scenario.workflowVersion,
        sourceLabel: scenario.sourceLabel,
        sourceResumePath: scenario.sourceResumePath,
        sourceMode: 'local-workflow-intake',
        lcFeature: 'case-sns-video',
        lcTitle: '商品画像からSNS動画構成へ',
        lcTaskCodes: 'FashionStudio,Video Workstation',
      });

      await page.goto(`/generate?${params.toString()}`);
      await expect(page.getByText('ワークスペース再開')).toBeVisible();
      await expect(page.getByText('Lightchain互換')).toBeVisible();
      await expect(page.getByRole('link', { name: `${scenario.sourceLabel}へ戻る` })).toHaveAttribute('href', scenario.sourceResumePath);
      await page.getByRole('button', { name: '生成', exact: true }).click();
      await expect(page.getByText('Generated').first()).toBeVisible();
      await expect.poll(() => functionRequests.length).toBe(index + 1);
      await expect.poll(() => generateImageRequests.length).toBe(index + 1);
      expect(generateImageRequests[index]).toMatchObject({
        featureType: 'campaign-image',
        sourceReadback: {
          sourceWorkspace: scenario.sourceWorkspace,
          workflowVersion: scenario.workflowVersion,
          sourceLabel: scenario.sourceLabel,
          sourceResumePath: scenario.sourceResumePath,
          sourceMode: 'local-workflow-intake',
        },
        generationIntent: expect.objectContaining({
          feature: 'campaign-image',
          sourceWorkspace: scenario.sourceWorkspace,
          sourceResumePath: scenario.sourceResumePath,
          href: expect.stringContaining(`sourceWorkspace=${scenario.sourceWorkspace}`),
        }),
        lightchainCompat: {
          lightchainFeatureId: 'case-sns-video',
          lightchainFeatureTitle: '商品画像からSNS動画構成へ',
          lightchainTaskCodes: ['FashionStudio', 'Video Workstation'],
          lightchainTaskSteps: [
            { taskCode: 'FashionStudio', status: 'processing' },
            { taskCode: 'Video Workstation', status: 'processing' },
          ],
        },
      });
      await expect.poll(async () => {
        const metadata = await readLatestLocalArtifactMetadata(page);
        return metadata?.sourceWorkspace;
      }).toBe(scenario.sourceWorkspace);

      const generatedMetadata = await readLatestLocalArtifactMetadata(page);
      expect(generatedMetadata).toMatchObject({
        sourceWorkspace: scenario.sourceWorkspace,
        workflowVersion: scenario.workflowVersion,
        sourceLabel: scenario.sourceLabel,
        sourceResumePath: scenario.sourceResumePath,
        sourceMode: 'local-workflow-intake',
        generatedResultId: 'mock-generated-image',
        generatedResultLabel: 'Generated',
        lightchainCompat: {
          lightchainFeatureId: 'case-sns-video',
          lightchainFeatureTitle: '商品画像からSNS動画構成へ',
          lightchainTaskCodes: ['FashionStudio', 'Video Workstation'],
          lightchainTaskSteps: [
            { taskCode: 'FashionStudio', status: 'processing' },
            { taskCode: 'Video Workstation', status: 'processing' },
          ],
        },
        generationIntent: expect.objectContaining({
          feature: 'campaign-image',
          prompt: expect.stringContaining(prompt),
          sourceWorkspace: scenario.sourceWorkspace,
          workflowVersion: scenario.workflowVersion,
          sourceLabel: scenario.sourceLabel,
          sourceResumePath: scenario.sourceResumePath,
          sourceMode: 'local-workflow-intake',
          href: expect.stringContaining(`sourceWorkspace=${scenario.sourceWorkspace}`),
        }),
      });
    }

    await page.goto('/gallery');
    await page.getByPlaceholder('プロンプトで検索...').fill('Generated provenance smoke lab');
    await expect(page.locator('div.cursor-pointer')).toHaveCount(1);
    await page.locator('div.cursor-pointer').first().click();
    const detailModal = page.locator('.fixed.inset-0');
    await expect(detailModal.getByText('Lightchain機能:')).toBeVisible();
    await expect(detailModal.getByText('商品画像からSNS動画構成へ')).toBeVisible();
    await expect(detailModal.getByText('Lightchain task:')).toBeVisible();
    await expect(detailModal.getByText('FashionStudio / Video Workstation')).toBeVisible();

    expect(functionRequests).toEqual(sourceScenarios.map(() => '/functions/v1/generate-image'));
    expect(storageRequests).toEqual([]);
    expect(storageRemoveRequests).toEqual([]);
    expect(restWriteRequests).toEqual([]);
    expect(restDeleteRequests).toEqual([]);
    expect(restMutationRequests).toEqual([]);
  });

  test('model library source context invokes model-matrix and saves generated provenance', async ({ page }) => {
    const storageRequests: string[] = [];
    const storageRemoveRequests: string[] = [];
    const functionRequests: string[] = [];
    const restWriteRequests: RestWriteRequest[] = [];
    const restDeleteRequests: RestDeleteRequest[] = [];
    const restMutationRequests: RestMutationRequest[] = [];
    const modelMatrixRequests: unknown[] = [];
    await mockSupabase(page, {
      functionRequests,
      modelMatrixRequests,
      storageRequests,
      storageRemoveRequests,
      restWriteRequests,
      restDeleteRequests,
      restMutationRequests,
    });
    await completeOnboardingForMockUser(page);

    await runLocalWorkspaceHandoff(
      page,
      '/models',
      'LOOK確認',
      'モデルライブラリ',
      async () => {},
      async () => {
        await page.getByRole('button', { name: /Street LOOK 30s/ }).click();
        await expect(page.getByRole('button', { name: /Street LOOK 30s/ })).toHaveAttribute('aria-pressed', 'true');
      }
    );
    await expect(page).toHaveURL(/\/canvas\/(?!new)[a-z0-9]+/);
    const handoffArtifact = await readLatestLocalArtifact(page);
    const generationIntent = handoffArtifact.metadata.generationIntent as { href: string; prompt: string };
    const prompt = generationIntent.prompt;
    const generationIntentUrl = new URL(`http://localhost${generationIntent.href}`);
    expect(generationIntentUrl.searchParams.get('bodyTypes')).toBe('regular');
    expect(generationIntentUrl.searchParams.get('ageGroups')).toBe('30s');
    expect(generationIntentUrl.searchParams.get('skinTone')).toBe('medium');
    expect(generationIntentUrl.searchParams.get('hairStyle')).toBe('medium');
    expect(generationIntentUrl.searchParams.get('modelCandidateLabel')).toBe('Street LOOK 30s');

    await page.goto(generationIntent.href);
    await expect(page.getByText('ワークスペース再開')).toBeVisible();
    await expect(page.getByText('モデルライブラリ から受け取った内容で生成します')).toBeVisible();
    await expect(page.getByRole('link', { name: 'モデルライブラリへ戻る' })).toHaveAttribute('href', '/models');
    await expect(page.getByPlaceholder('例: ネイビーのスリムフィットジーンズ')).toHaveValue(prompt);
    await expect(page.getByText('⚠️ 1パターンを生成します')).toBeVisible();

    await page.getByRole('button', { name: '生成', exact: true }).click();
    await expect(page.getByText('スリム × 20代')).toBeVisible();
    await expect(page.getByText('標準 × 30代')).toBeVisible();
    await expect.poll(() => modelMatrixRequests.length).toBe(1);
    expect(modelMatrixRequests[0]).toMatchObject({
      productDescription: prompt,
      bodyTypes: ['regular'],
      ageGroups: ['30s'],
      skinTone: 'medium',
      hairStyle: 'medium',
      modelCandidateLabel: 'Street LOOK 30s',
      sourceReadback: {
        sourceWorkspace: 'models',
        workflowVersion: 'model-library-local-v1',
        sourceLabel: 'モデルライブラリ',
        sourceResumePath: '/models',
        sourceMode: 'local-workflow-intake',
      },
    });

    await expect.poll(async () => {
      const metadataList = await readLocalArtifactMetadataList(page);
      return metadataList.filter((metadata: any) => metadata?.sourceWorkspace === 'models').length;
    }).toBe(2);

    const metadataList = await readLocalArtifactMetadataList(page);
    const generatedMetadata = metadataList.filter((metadata: any) => metadata?.sourceWorkspace === 'models');
    for (const metadata of generatedMetadata) {
      const generatedIntent = metadata.generationIntent as {
        href: string;
        bodyTypes?: string[];
        ageGroups?: string[];
        skinTone?: string;
        hairStyle?: string;
        modelCandidateLabel?: string;
      };
      const generatedIntentUrl = new URL(`http://localhost${generatedIntent.href}`);
      expect(generatedIntentUrl.searchParams.get('bodyTypes')).toBe('regular');
      expect(generatedIntentUrl.searchParams.get('ageGroups')).toBe('30s');
      expect(generatedIntentUrl.searchParams.get('skinTone')).toBe('medium');
      expect(generatedIntentUrl.searchParams.get('hairStyle')).toBe('medium');
      expect(generatedIntentUrl.searchParams.get('modelCandidateLabel')).toBe('Street LOOK 30s');
      expect(generatedIntent).toMatchObject({
        bodyTypes: ['regular'],
        ageGroups: ['30s'],
        skinTone: 'medium',
        hairStyle: 'medium',
        modelCandidateLabel: 'Street LOOK 30s',
      });
    }
    expect(generatedMetadata).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceWorkspace: 'models',
        workflowVersion: 'model-library-local-v1',
        sourceLabel: 'モデルライブラリ',
        sourceResumePath: '/models',
        sourceMode: 'local-workflow-intake',
        generatedResultLabel: 'スリム × 20代',
        generationIntent: expect.objectContaining({
          feature: 'model-matrix',
          prompt,
          sourceWorkspace: 'models',
          workflowVersion: 'model-library-local-v1',
          sourceLabel: 'モデルライブラリ',
          sourceResumePath: '/models',
          sourceMode: 'local-workflow-intake',
          href: expect.stringContaining('sourceWorkspace=models'),
          bodyTypes: ['regular'],
          ageGroups: ['30s'],
          skinTone: 'medium',
          hairStyle: 'medium',
          modelCandidateLabel: 'Street LOOK 30s',
        }),
      }),
      expect.objectContaining({
        sourceWorkspace: 'models',
        workflowVersion: 'model-library-local-v1',
        generatedResultLabel: '標準 × 30代',
        generationIntent: expect.objectContaining({
          feature: 'model-matrix',
          prompt,
          href: expect.stringContaining('workflowVersion=model-library-local-v1'),
          bodyTypes: ['regular'],
          ageGroups: ['30s'],
          skinTone: 'medium',
          hairStyle: 'medium',
          modelCandidateLabel: 'Street LOOK 30s',
        }),
      }),
    ]));

    await page.goto('/gallery');
    await page.getByPlaceholder('プロンプトで検索...').fill('Street LOOK 30s');
    await page.locator('div.cursor-pointer').first().click();
    const modelDetailModal = page.locator('.fixed.inset-0');
    await expect(modelDetailModal.getByText('生成条件')).toBeVisible();
    await expect(modelDetailModal.getByText('Street LOOK 30s')).toBeVisible();
    await expect(modelDetailModal.getByText('regular / 30s / medium / medium')).toBeVisible();
    await page.goto('/gallery?image=00000000-0000-4000-8000-000000000403');
    const remoteModelDetailModal = page.locator('.fixed.inset-0');
    await expect(remoteModelDetailModal.getByText('生成条件')).toBeVisible();
    await expect(remoteModelDetailModal.getByText('Street LOOK 30s')).toBeVisible();
    await expect(remoteModelDetailModal.getByText('regular / 30s / medium / medium')).toBeVisible();

    await page.goto('/history');
    await expect(page.getByRole('heading', { name: '生成履歴' })).toBeVisible();
    await expect(page.getByText('Street LOOK 30s').first()).toBeVisible();
    await expect(page.getByText('regular / 30s / medium / medium').first()).toBeVisible();
    const remoteModelJob = page.locator('article').filter({ hasText: 'モデルマトリクス' }).filter({ hasText: '2 outputs' }).first();
    await remoteModelJob.getByRole('button').click();
    await expect(remoteModelJob.getByText('Street LOOK 30s')).toBeVisible();
    await expect(remoteModelJob.getByText('regular / 30s / medium / medium')).toBeVisible();

    expect(functionRequests).toEqual(['/functions/v1/model-matrix']);
    expect(storageRequests).toEqual([]);
    expect(storageRemoveRequests).toEqual([]);
    expect(restWriteRequests).toEqual([]);
    expect(restDeleteRequests).toEqual([]);
    expect(restMutationRequests).toEqual([]);
  });

  test('studio source context invokes model-matrix and saves generated provenance', async ({ page }) => {
    const storageRequests: string[] = [];
    const storageRemoveRequests: string[] = [];
    const functionRequests: string[] = [];
    const restWriteRequests: RestWriteRequest[] = [];
    const restDeleteRequests: RestDeleteRequest[] = [];
    const restMutationRequests: RestMutationRequest[] = [];
    const modelMatrixRequests: unknown[] = [];
    await mockSupabase(page, {
      functionRequests,
      modelMatrixRequests,
      storageRequests,
      storageRemoveRequests,
      restWriteRequests,
      restDeleteRequests,
      restMutationRequests,
    });
    await completeOnboardingForMockUser(page);

    await runLocalWorkspaceHandoff(
      page,
      '/studio',
      'ライン企画',
      'Fashion Studio',
      async () => {
        await page.getByLabel('商品ライン').fill('Smoke trench line');
        await page.getByLabel('小物').fill('Smoke prop set');
        await page.getByLabel('参照画像').fill('smoke-reference.png');
      },
      async () => {
        await page.getByRole('button', { name: /Street 30s/ }).click();
        await page.getByRole('button', { name: /3\/4 Walk/ }).click();
        await page.getByRole('button', { name: /Concrete Gallery/ }).click();
        await expect(page.getByRole('button', { name: /Street 30s/ })).toHaveAttribute('aria-pressed', 'true');
      }
    );

    await expect(page).toHaveURL(/\/canvas\/(?!new)[a-z0-9]+/);
    const handoffArtifact = await readLatestLocalArtifact(page);
    const generationIntent = handoffArtifact.metadata.generationIntent as { href: string; prompt: string };
    expect(generationIntent.href).toContain('feature=model-matrix');
    expect(generationIntent.href).toContain('sourceWorkspace=studio');

    await page.goto(generationIntent.href);
    await expect(page.getByText('ワークスペース再開')).toBeVisible();
    await expect(page.getByText('Fashion Studio から受け取った内容で生成します')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Fashion Studioへ戻る' })).toHaveAttribute('href', '/studio');
    await expect(page.getByPlaceholder('例: ネイビーのスリムフィットジーンズ')).toHaveValue(generationIntent.prompt);

    await page.getByRole('button', { name: '生成', exact: true }).click();
    await expect(page.getByText('スリム × 20代')).toBeVisible();
    await expect(page.getByText('標準 × 30代')).toBeVisible();
    await expect.poll(() => modelMatrixRequests.length).toBe(1);
    expect(modelMatrixRequests[0]).toMatchObject({
      productDescription: generationIntent.prompt,
      sourceReadback: {
        sourceWorkspace: 'studio',
        workflowVersion: 'studio-selection-local-v1',
        sourceLabel: 'Fashion Studio',
        sourceResumePath: '/studio',
        sourceMode: 'local-workflow-intake',
      },
    });

    await expect.poll(async () => {
      const metadataList = await readLocalArtifactMetadataList(page);
      return metadataList.filter((metadata: any) => metadata?.sourceWorkspace === 'studio').length;
    }).toBe(2);

    const generatedMetadata = (await readLocalArtifactMetadataList(page))
      .filter((metadata: any) => metadata?.sourceWorkspace === 'studio');
    expect(generatedMetadata).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceWorkspace: 'studio',
        workflowVersion: 'studio-selection-local-v1',
        sourceLabel: 'Fashion Studio',
        sourceResumePath: '/studio',
        sourceMode: 'local-workflow-intake',
        generationIntent: expect.objectContaining({
          feature: 'model-matrix',
          prompt: generationIntent.prompt,
          sourceWorkspace: 'studio',
          workflowVersion: 'studio-selection-local-v1',
          href: expect.stringContaining('sourceWorkspace=studio'),
        }),
      }),
    ]));

    expect(functionRequests).toEqual(['/functions/v1/model-matrix']);
    expect(storageRequests).toEqual([]);
    expect(storageRemoveRequests).toEqual([]);
    expect(restWriteRequests).toEqual([]);
    expect(restDeleteRequests).toEqual([]);
    expect(restMutationRequests).toEqual([]);
  });

  test('patterns source context hydrates design-gacha and saves generated provenance', async ({ page }) => {
    const storageRequests: string[] = [];
    const storageRemoveRequests: string[] = [];
    const functionRequests: string[] = [];
    const restWriteRequests: RestWriteRequest[] = [];
    const restDeleteRequests: RestDeleteRequest[] = [];
    const restMutationRequests: RestMutationRequest[] = [];
    const designGachaRequests: unknown[] = [];
    await mockSupabase(page, {
      functionRequests,
      designGachaRequests,
      storageRequests,
      storageRemoveRequests,
      restWriteRequests,
      restDeleteRequests,
      restMutationRequests,
    });
    await completeOnboardingForMockUser(page);

    const expectedSelectedPatternPreview = {
      id: 'bandana-grid',
      label: 'Bandana Grid',
      mode: '総柄',
      repeatSignature: 'half-drop-bandana-grid',
      vectorSignature: 'repeat-tile-vector-cleanup',
      paletteSignature: 'black-ivory-blue-grid',
    };
    const expectedPatternInputs = {
      motifPrompt: 'Smoke chain motif',
      repeatStyle: 'Smoke half-drop repeat',
      garmentTarget: 'Smoke hoodie body',
      paletteNotes: 'Smoke black, ivory, red',
      vectorIntent: 'Smoke vector cleanup',
      referenceAssets: '',
    };

    await runLocalWorkspaceHandoff(
      page,
      '/patterns',
      '総柄',
      '柄・グラフィック',
      async () => {
        await page.getByLabel('モチーフ').fill(expectedPatternInputs.motifPrompt);
        await page.getByLabel('リピート').fill(expectedPatternInputs.repeatStyle);
        await page.getByLabel('対象アイテム').fill(expectedPatternInputs.garmentTarget);
        await page.getByLabel('パレット').fill(expectedPatternInputs.paletteNotes);
        await page.getByLabel('ベクター化').fill(expectedPatternInputs.vectorIntent);
        await page.getByLabel('参照素材').fill(expectedPatternInputs.referenceAssets);
      },
      async () => {
        await page.getByRole('button', { name: /Bandana Grid/ }).click();
        await expect(page.getByRole('button', { name: /Bandana Grid/ })).toHaveAttribute('aria-pressed', 'true');
      }
    );
    await expect(page).toHaveURL(/\/canvas\/(?!new)[a-z0-9]+/);
    const handoffArtifact = await readLatestLocalArtifact(page);
    const generationIntent = handoffArtifact.metadata.generationIntent as {
      href: string;
      prompt: string;
      selectedPatternPreview: unknown;
    };
    expect(generationIntent).toMatchObject({
      feature: 'design-gacha',
      sourceWorkspace: 'patterns',
      workflowVersion: 'pattern-preview-local-v1',
      sourceLabel: '柄・グラフィック',
      sourceResumePath: '/patterns',
      sourceMode: 'local-workflow-intake',
      selectedPatternPreview: expectedSelectedPatternPreview,
      ...expectedPatternInputs,
    });
    const generationIntentUrl = new URL(`http://localhost${generationIntent.href}`);
    expect(generationIntentUrl.searchParams.get('patternPreviewId')).toBe(expectedSelectedPatternPreview.id);
    expect(generationIntentUrl.searchParams.get('patternPreviewLabel')).toBe(expectedSelectedPatternPreview.label);
    expect(generationIntentUrl.searchParams.get('patternPreviewMode')).toBe(expectedSelectedPatternPreview.mode);
    expect(generationIntentUrl.searchParams.get('repeatSignature')).toBe(expectedSelectedPatternPreview.repeatSignature);
    expect(generationIntentUrl.searchParams.get('vectorSignature')).toBe(expectedSelectedPatternPreview.vectorSignature);
    expect(generationIntentUrl.searchParams.get('paletteSignature')).toBe(expectedSelectedPatternPreview.paletteSignature);
    expect(generationIntentUrl.searchParams.get('motifPrompt')).toBe(expectedPatternInputs.motifPrompt);
    expect(generationIntentUrl.searchParams.get('repeatStyle')).toBe(expectedPatternInputs.repeatStyle);
    expect(generationIntentUrl.searchParams.get('garmentTarget')).toBe(expectedPatternInputs.garmentTarget);
    expect(generationIntentUrl.searchParams.get('paletteNotes')).toBe(expectedPatternInputs.paletteNotes);
    expect(generationIntentUrl.searchParams.get('vectorIntent')).toBe(expectedPatternInputs.vectorIntent);
    expect(generationIntentUrl.searchParams.get('referenceAssets')).toBe(expectedPatternInputs.referenceAssets);

    await page.goto(generationIntent.href);
    await expect(page.getByText('ワークスペース再開')).toBeVisible();
    await expect(page.getByText('柄・グラフィック から受け取った内容で生成します')).toBeVisible();
    await expect(page.getByRole('link', { name: '柄・グラフィックへ戻る' })).toHaveAttribute('href', '/patterns');
    await expect(page.getByPlaceholder('例: 20代女性向けのカジュアルなサマードレス')).toHaveValue(generationIntent.prompt);

    await page.getByRole('button', { name: '生成', exact: true }).click();
    await expect(page.getByText('Pattern Direction A')).toBeVisible();
    await expect.poll(() => designGachaRequests.length).toBe(1);
    expect(designGachaRequests[0]).toMatchObject({
      brief: generationIntent.prompt,
      directions: 4,
      sourceReadback: {
        sourceWorkspace: 'patterns',
        workflowVersion: 'pattern-preview-local-v1',
        sourceLabel: '柄・グラフィック',
        sourceResumePath: '/patterns',
        sourceMode: 'local-workflow-intake',
      },
      patternContext: {
        selectedPatternPreview: expectedSelectedPatternPreview,
        ...expectedPatternInputs,
      },
    });

    await expect.poll(async () => {
      const metadataList = await readLocalArtifactMetadataList(page);
      return metadataList.filter((metadata: any) => metadata?.sourceWorkspace === 'patterns' && metadata?.generatedResultId === 'design-gacha-smoke-a').length;
    }).toBe(1);

    const metadataList = await readLocalArtifactMetadataList(page);
    const generatedMetadata = metadataList.filter((metadata: any) => metadata?.sourceWorkspace === 'patterns' && metadata?.feature !== 'graphic-pattern-workspace');
    expect(generatedMetadata).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceWorkspace: 'patterns',
        workflowVersion: 'pattern-preview-local-v1',
        sourceLabel: '柄・グラフィック',
        sourceResumePath: '/patterns',
        sourceMode: 'local-workflow-intake',
        selectedPatternPreview: expectedSelectedPatternPreview,
        ...expectedPatternInputs,
        generatedResultId: 'design-gacha-smoke-a',
        generatedResultLabel: 'Pattern Direction A',
        generationIntent: expect.objectContaining({
          feature: 'design-gacha',
          sourceWorkspace: 'patterns',
          workflowVersion: 'pattern-preview-local-v1',
          sourceLabel: '柄・グラフィック',
          sourceResumePath: '/patterns',
          sourceMode: 'local-workflow-intake',
          selectedPatternPreview: expectedSelectedPatternPreview,
          href: expect.stringContaining('patternPreviewId=bandana-grid'),
          ...expectedPatternInputs,
        }),
      }),
    ]));
    for (const metadata of generatedMetadata) {
      const generatedIntent = metadata.generationIntent as { href: string };
      const generatedIntentUrl = new URL(`http://localhost${generatedIntent.href}`);
      expect(generatedIntentUrl.searchParams.get('patternPreviewId')).toBe(expectedSelectedPatternPreview.id);
      expect(generatedIntentUrl.searchParams.get('motifPrompt')).toBe(expectedPatternInputs.motifPrompt);
      expect(generatedIntentUrl.searchParams.get('referenceAssets')).toBe(expectedPatternInputs.referenceAssets);
    }

    await page.goto('/gallery');
    await page.getByPlaceholder('プロンプトで検索...').fill('design-gacha-smoke-a');
    await page.locator('div.cursor-pointer').first().click();
    const patternDetailModal = page.locator('.fixed.inset-0');
    const patternGenerationConditions = patternDetailModal.locator('dl');
    await expect(patternDetailModal.getByText('生成条件')).toBeVisible();
    await expect(patternDetailModal.getByText('Bandana Grid')).toBeVisible();
    await expect(
      patternGenerationConditions.locator('dt', { hasText: /^モチーフ:$/ }).locator('xpath=following-sibling::dd')
    ).toHaveText('Smoke chain motif');
    await expect(patternDetailModal.getByText(/参照素材:\s*なし/)).toBeVisible();

    await page.goto('/history');
    await expect(page.getByRole('heading', { name: '生成履歴' })).toBeVisible();
    await expect(page.getByText('Bandana Grid').first()).toBeVisible();
    await expect(page.getByText('Smoke chain motif').first()).toBeVisible();
    await expect(page.getByText(/参照素材:\s*なし/).first()).toBeVisible();

    expect(functionRequests).toEqual(['/functions/v1/design-gacha']);
    expect(storageRequests).toEqual([]);
    expect(storageRemoveRequests).toEqual([]);
    expect(restWriteRequests).toEqual([]);
    expect(restDeleteRequests).toEqual([]);
    expect(restMutationRequests).toEqual([]);
  });
});

test.describe('static legal pages', () => {
  test('terms page renders', async ({ page }) => {
    await mockSupabase(page);

    await page.goto('/terms');

    await expect(page.getByRole('heading', { name: '利用規約' })).toBeVisible();
    await expect(page.getByText('サービスの利用')).toBeVisible();
    await expect(page.getByText('生成物と責任')).toBeVisible();
  });

  test('privacy page renders', async ({ page }) => {
    await mockSupabase(page);

    await page.goto('/privacy');

    await expect(page.getByRole('heading', { name: 'プライバシーポリシー' })).toBeVisible();
    await expect(page.getByText('取得する情報')).toBeVisible();
    await expect(page.getByText('秘密情報の扱い')).toBeVisible();
  });

  test('legal page renders', async ({ page }) => {
    await mockSupabase(page);

    await page.goto('/legal');

    await expect(page.getByRole('heading', { name: '特商法表記' })).toBeVisible();
    await expect(page.getByText('提供サービス')).toBeVisible();
    await expect(page.getByRole('heading', { name: '問い合わせ' })).toBeVisible();
  });
});

test('optimize-prompt success renders the result panel', async ({ page }) => {
  await mockSupabase(page, { optimizePromptSucceeds: true });

  await page.goto('/generate');
  await selectFeature(page, 'optimize-prompt');
  await page.getByPlaceholder('例: 白いTシャツを着たモデル、スタジオ撮影').fill('白いTシャツを着たモデル、スタジオ撮影');
  await page.getByRole('button', { name: '最適化' }).click();

  await expect(page.getByRole('heading', { name: 'プロンプトを最適化しました' })).toBeVisible();
  const resultPanel = page.locator('.glass-panel').filter({
    has: page.getByRole('heading', { name: 'プロンプトを最適化しました' }),
  });
  await expect(resultPanel.locator('p.whitespace-pre-wrap').filter({
    hasText: 'Premium studio product photo of a white cotton T-shirt on a model',
  })).toBeVisible();
  await expect(page.getByText('避ける要素')).toBeVisible();
  await expect(page.getByText('blurry, low quality')).toBeVisible();
});

test('generation failure renders the error card', async ({ page }) => {
  await mockSupabase(page, { generationFails: true });

  await page.goto('/generate');
  await selectFeature(page, 'campaign-image');
  await page.getByPlaceholder('例: 夏のサマーセール告知、爽やかな海辺の雰囲気').fill('夏のサマーセール告知');
  await page.getByRole('button', { name: '生成' }).click();

  await expect(page.getByRole('heading', { name: '生成に失敗しました' })).toBeVisible();
  await expect(page.getByText('入力内容を確認し、少し待ってからもう一度試してください。')).toBeVisible();
});

test.describe('AI fitting model matrix', () => {
  test('success renders preview and adds local history', async ({ page }) => {
    const requests: unknown[] = [];
    const storageRequests: string[] = [];
    const storageRemoveRequests: string[] = [];
    const restWriteRequests: Array<{ table: string; method: string; body: unknown }> = [];
    const restDeleteRequests: Array<{ table: string; method: string; url: string }> = [];
    await mockSupabase(page, {
      modelMatrixDelayMs: 150,
      modelMatrixRequests: requests,
      storageRequests,
      storageRemoveRequests,
      restWriteRequests,
      restDeleteRequests,
    });

    await page.goto('/fitting');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'garment.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"><rect fill="#ddd" width="80" height="100"/></svg>'),
    });
    await expect(page.getByText('garment.svg')).toBeVisible();
    await page.getByLabel('商品説明').fill('テスト用ワンピース。軽い素材感でECモデル着用画像にしたい。');
    await page.getByRole('button', { name: 'プラス' }).click();
    await page.getByRole('button', { name: '40代' }).click();
    await page.getByRole('button', { name: '男性' }).click();
    await page.getByRole('button', { name: 'AI生成' }).click();

    await expect(page.getByText('モデルセット写真を生成中')).toBeVisible();
    await expect(page.getByRole('heading', { name: '生成結果プレビュー' })).toBeVisible();
    await expect(page.getByText('スリム × 20代')).toBeVisible();
    await expect(page.getByText('標準 × 30代')).toBeVisible();
    await expect(page.locator('aside').getByText(/テスト用ワンピース.*2枚/)).toBeVisible();

    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toMatchObject({
      productDescription: 'テスト用ワンピース。軽い素材感でECモデル着用画像にしたい。',
      brandId: mockBrand.id,
      bodyTypes: ['slim', 'regular', 'plus'],
      ageGroups: ['20s', '30s', '40s'],
      gender: 'male',
    });
    expect((requests[0] as { imageUrl?: string }).imageUrl).toContain('data:image/svg+xml');
    expect(storageRequests).toEqual([]);
    expect(storageRemoveRequests).toEqual([]);
    expect(restWriteRequests).toEqual([]);
    expect(restDeleteRequests).toEqual([]);

    const localArtifactMetadata = await readLocalArtifactMetadataList(page);
    expect(localArtifactMetadata).toEqual(expect.arrayContaining([
      expect.objectContaining({
        remoteSaveStatus: 'succeeded',
        remoteJobId: '00000000-0000-4000-8000-000000000401',
        remoteImageId: '00000000-0000-4000-8000-000000000402',
        remoteStoragePath: `${mockUser.id}/${mockBrand.id}/00000000-0000-4000-8000-000000000401_matrix_slim_20s.png`,
      }),
    ]));

    await page.goto('/gallery');
    await page.getByPlaceholder('プロンプトで検索...').fill('model-matrix');
    await expect(page.locator('div.cursor-pointer')).toHaveCount(2);
    await page.locator('div.cursor-pointer').first().click();
    const fittingDetailModal = page.locator('.fixed.inset-0');
    await expect(fittingDetailModal.getByText('model-matrix').first()).toBeVisible();
    await expect(page.getByText('テスト用ワンピース。軽い素材感でECモデル着用画像にしたい。')).toBeVisible();

    await page.goto('/history');
    await expect(page.getByText('モデルマトリクス').first()).toBeVisible();
    await expect(page.getByText('テスト用ワンピース。軽い素材感でECモデル着用画像にしたい。').first()).toBeVisible();

    await page.goto('/fitting');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'garment.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"><rect fill="#ddd" width="80" height="100"/></svg>'),
    });
    await page.getByLabel('商品説明').fill('キャンバス編集確認用のジャケット');
    await page.getByRole('button', { name: 'AI生成' }).click();
    await expect(page.locator('aside').getByText(/キャンバス編集確認用.*2枚/)).toBeVisible();
    await page.locator('aside').getByRole('button', { name: '編集' }).first().click();
    await expect(page).toHaveURL(/\/canvas\/(?!new)[a-z0-9]+/);
    await expect(page.getByRole('heading', { name: /Fitting: キャンバス編集確認用/ })).toBeVisible();
  });

  test('failure shows retry and reuses the last request', async ({ page }) => {
    const requests: unknown[] = [];
    await mockSupabase(page, { modelMatrixFails: true, modelMatrixRequests: requests });

    await page.goto('/fitting');
    await page.getByLabel('商品説明').fill('失敗確認用のシャツ');
    await page.getByRole('button', { name: 'AI生成' }).click();

    await expect(page.getByRole('heading', { name: '生成に失敗しました' })).toBeVisible();
    await expect(page.getByText('テスト用のモデル生成失敗')).toBeVisible();
    await page.getByRole('button', { name: '再試行' }).click();

    await expect(page.getByText('テスト用のモデル生成失敗')).toBeVisible();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1]).toMatchObject(requests[0] as Record<string, unknown>);
  });
});
