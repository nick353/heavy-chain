import type { Brand, CanvasDocument, Folder, GeneratedImage, Json, User } from '../types/database';
import type { GeneratedImageListRow } from './generatedImageQuery';
import type { WorkspaceExecutionStep } from './workspaceExecution';
import { auth, refreshAuthSession } from './auth';
import { CLOUDFLARE_IMAGE_ACTIONS, invokeDurableImageAction, prepareCloudflareImageInput,acknowledgeDurableImageAction,canonicalCloudflareImageBody,type ImageReceipt } from './cloudflareImageAI';
import { COMPOSITE_PROVIDER_ACTIONS, runCompositeProviderAction } from './providerActionAdapters';
import { readAIModelPreference, withAIModelPreference } from './aiModelPreference';
import { prepareProtectedCloudflareEdit,finalizeProtectedCloudflareEdit } from './cloudflareProtectedImageEdit';
import { persistProtectedImageInput,listProtectedImageInputs,loadProtectedImageInput,deleteProtectedImageInput } from './cloudflareImageInputCache';
import { attachHeavyGenerationPreflight, validateHeavyGenerationPreflight, type HeavyGenerationInput, type HeavyGenerationPreflight } from './heavyGenerationPreflight';
import { WORKSPACE_UPLOAD_MAX_BYTES } from './workspaceUploadLimits';
import type { DesignDialogueManifestReference } from './designDialogueReferences';

export type CloudflareAIModels = {
  success: true;
  image: { provider: string; models: Array<{ id: string; label: string; generate: boolean; edit: boolean }>; defaults: { generate: string; edit: string } };
  text: { provider: string; models: Array<{ id: string; label: string }>; default: string | null };
};

export type CloudflareDesignAssistantRequestInput = {
  requestId: string;
  brandId: string;
  /** The canonical Canvas document ID. */
  projectId: string;
  conversationId: string;
  prompt: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  references: DesignDialogueManifestReference[];
};
export type CloudflareDesignAssistantReceipt = {
  requestId: string;
  state: 'running' | 'completed' | 'failed' | 'unknown';
  content?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  errorCode?: string;
  /** Claude (anthropic) answers in production; Workers AI Llama is the API's fallback. */
  provider: 'anthropic' | 'workers-ai';
  model: string;
};

export interface CloudflareImageUsage {
  planName: string; monthlyQuota: number; remainingUnits: number;
  completedImages: number | null; runningImages: number | null; uncertainImages: number | null; attemptedImages: number | null;
  estimatedMicroUSD: number | null; estimatedNeurons: number | null; unknownEstimateCount: number | null;
  averageInferenceMs: number | null; periodStart: string; periodEnd: string; imageAIEnabled: boolean;
  billing: 'estimate_not_invoice'; accountFreeAllocationRemaining: null; accountWideBudgetGuaranteed: false;
}

/** Read-only Heavy server entitlement status. A status read never authorizes a request by itself. */
export interface CloudflareHeavyEntitlement {
  allowed: boolean;
  reason: string | null;
  termsVersion: string | null;
  termsDocumentVersion?: string | null;
  termsDocumentDigest?: string | null;
  rightsVersion: string | null;
  rightsDocumentVersion?: string | null;
  rightsDocumentDigest?: string | null;
  termsAcceptanceId: string | null;
  rightsAttestationId: string | null;
  requestBinding: string | null;
  requestScopedAttestationRequired: boolean;
}

export type CloudflareHeavyGenerationPreparation = HeavyGenerationPreflight;

export type CloudflareHeavyAcceptanceReceipt = {
  success: true;
  acceptanceId: string;
  acceptedAt: string;
  termsVersion: string | null;
  documentVersion: string | null;
  documentDigest: string | null;
};

export type CloudflareHeavyAttestationReceipt = {
  success: true;
  requestId: string;
  inputDigest: string;
  termsAcceptanceId: string;
  rightsAttestationId: string | null;
  termsVersion: string | null;
  documentVersion: string | null;
  documentDigest: string | null;
  rightsVersion: string | null;
  rightsDocumentVersion: string | null;
  rightsDocumentDigest: string | null;
  requestScopedAttestationRequired: false;
};

export type HeavyGenerationConsent = {
  termsAccepted: boolean;
  rightsAttested: boolean;
};

export interface CloudflareAdminStats {
  totalUsers: number; activeUsers: number; totalImages: number;
  totalCost: number | null; totalUsageUnits: number | null; edgeRunCount: number | null; averageDurationMs: number | null;
  meteringStatus: string; activeUsersBasis: string;
  estimatedImageCostUSD?: number | null; inferenceAttempts?: number; unmeasuredInferenceAttempts?: number; averageImageInferenceMs?: number | null;
}
export interface CloudflareAdminUser {
  id: string; email: string; name: string | null; created_at: string; is_admin: boolean;
}
export interface CloudflareFeedback {
  id: string; user_id: string; brand_id: string | null;
  type: 'lost' | 'cutout' | 'result' | 'save' | 'speed' | 'other';
  message: string; email: string; page_url: string; pathname: string;
  viewport: { width?: number; height?: number; devicePixelRatio?: number }; user_agent: string | null;
  screenshot_path: string | null;
  audio_path?: string | null; audio_type?: string | null;
  screenshot_capture_status: 'captured' | 'screenshot_capture_failed' | 'screenshot_upload_failed';
  submission_state: 'pending' | 'accepted';
  status: 'new' | 'in_progress' | 'done'; admin_note: string | null; revision: number;
  created_at: string; updated_at: string; resolved_at: string | null;
  user: { email: string | null; name: string | null } | null;
  brand: { name: string | null } | null;
}
export interface CloudflareAnnouncement {
  id: string; title: string; content: string; type: 'info' | 'warning' | 'maintenance'; created_at: string;
}

interface CloudflareProfile {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  language: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

interface CloudflareBrand {
  id: string;
  owner_id: string;
  name: string;
  logo_url: string | null;
  brand_colors: Brand['brand_colors'];
  tone_description: string | null;
  target_audience: string | null;
  role: string;
  created_at: string;
  updated_at: string;
}

export type CloudflareCanvasDocument = CanvasDocument;
type CloudflareGenerationJob = import('../types/database').GenerationJob;
type CloudflareGeneratedImage = import('../types/database').GeneratedImage;
type CloudflareImageFolder = { image_id: string; folder_id: string };
type CloudflareTag = { id: string; brand_id: string; name: string; created_at: string };
type CloudflareStylePreset = {
  id: string;
  brand_id: string;
  name: string;
  prompt_template: string;
  settings: { style?: string; aspectRatio?: string; negativePrompt?: string };
  created_at: string;
  updated_at: string;
};
type CloudflareBrandMember = {
  user_id: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  joined_at: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  };
};
type CloudflareInvitation = {
  id: string;
  brand_id: string;
  email: string | null;
  code: string;
  role: 'admin' | 'editor' | 'viewer';
  expires_at: string;
  used_at: string | null;
  created_at: string;
};
export type CloudflareSharedImagePayload = {
  success: boolean;
  image?: {
    id: string;
    imageUrl: string;
    prompt: string | null;
    negativePrompt: string | null;
    featureType: string | null;
    stylePreset: string | null;
    modelUsed: string | null;
    generationParams: Json | null;
    metadata: Json | null;
    createdAt: string;
  };
  share?: {
    token: string;
    expiresAt: string;
    createdAt: string;
  };
  error?: string;
};
type CloudflareMediaAllocation = {
  id: string;
  state: 'pending' | 'ready' | 'failed';
  contentType: string;
  declaredSizeBytes: number;
};

type WorkspaceArtifactRemote = {
  jobId: string;
  imageId: string;
  storagePath: string;
};

type WorkspaceArtifactRemoteResponse = {
  success: boolean;
  remote: WorkspaceArtifactRemote;
  metadata?: Record<string, unknown>;
};

type CheckedCloudflareRequest = (path: string, init?: RequestInit) => Promise<unknown>;

/** Opaque operation-scoped persistence capability. Never exposes credentials. */
export interface ArtifactPersistenceContext {
  assertCurrent(): Promise<void>;
}

export class ArtifactPersistenceContextError extends Error {
  constructor(cause: unknown) {
    super('artifact_persistence_context_changed', { cause });
    this.name = 'ArtifactPersistenceContextError';
  }
}

const artifactPersistenceContexts = new WeakMap<ArtifactPersistenceContext, {
  owner: CloudflareDataPlaneClient;
  call: CheckedCloudflareRequest;
  assertCurrent: () => Promise<void>;
}>();

const WORKSPACE_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const WORKSPACE_STORAGE_PATH = /^generated-images\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

/**
 * Validate a workspace response before allowing it to satisfy a save.
 *
 * A readback is keyed by the exact request ID and authenticated on the server,
 * but the response still needs an identity check at this boundary. Otherwise a
 * malformed or misrouted response could be treated as proof for a different
 * artifact and a caller could retry an already committed write.
 */
const asWorkspaceArtifactRemoteResponse = (
  value: unknown,
  requestId: string,
  expectedSourceStoragePath?: string | null,
): WorkspaceArtifactRemoteResponse => {
  if (!isRecord(value) || value.success !== true || !isRecord(value.remote)) {
    throw new Error('cloudflare_workspace_save_readback_invalid');
  }
  const { jobId, imageId, storagePath } = value.remote;
  if (typeof jobId !== 'string' || !WORKSPACE_ID.test(jobId) ||
      typeof imageId !== 'string' || !WORKSPACE_ID.test(imageId) ||
      typeof storagePath !== 'string' || !WORKSPACE_STORAGE_PATH.test(storagePath)) {
    throw new Error('cloudflare_workspace_save_readback_identity_invalid');
  }
  if (expectedSourceStoragePath !== undefined && expectedSourceStoragePath !== null) {
    if (storagePath !== expectedSourceStoragePath) throw new Error('cloudflare_workspace_save_readback_source_mismatch');
  } else {
    const expectedId = `wa-${requestId.toLowerCase()}`;
    if (jobId !== expectedId || imageId !== expectedId || storagePath !== `generated-images/${expectedId}`) {
      throw new Error('cloudflare_workspace_save_readback_request_mismatch');
    }
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    throw new Error('cloudflare_workspace_save_readback_metadata_invalid');
  }
  return {
    success: true,
    remote: { jobId, imageId, storagePath },
    ...(value.metadata === undefined ? {} : { metadata: value.metadata }),
  };
};

const MEDIA_OBJECT_PATH = /^media\/v1\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Convert the full Worker result to the list shape shared by Gallery/Dashboard. */
export const asGeneratedImageListRow = (image: Pick<GeneratedImage, keyof GeneratedImageListRow>): GeneratedImageListRow => ({
  id: image.id,
  job_id: image.job_id,
  brand_id: image.brand_id,
  user_id: image.user_id,
  storage_path: image.storage_path,
  image_url: image.image_url,
  is_favorite: image.is_favorite,
  created_at: image.created_at,
  prompt: image.prompt,
  feature_type: image.feature_type,
  style_preset: image.style_preset,
  model_used: image.model_used,
  metadata: image.metadata,
});

const isEnabled = (value: unknown): boolean => (
  typeof value === 'string' && ['1', 'true', 'yes'].includes(value.trim().toLowerCase())
);

const rawBaseURL = import.meta.env.VITE_CLOUDFLARE_API_BASE_URL;
let baseURL: string | null = null;
try {
  const candidate = typeof rawBaseURL === 'string' ? new URL(rawBaseURL) : null;
  if (candidate?.protocol === 'https:' && candidate.username === '' && candidate.password === '' &&
      candidate.search === '' && candidate.hash === '') {
    baseURL = candidate.toString().replace(/\/$/, '');
  }
} catch {
  baseURL = null;
}

const getBearerToken = async (): Promise<string> => {
  const read = await auth.getSession();
  if (read.error) throw read.error;
  const token = read.data.session?.access_token;
  if (token) return token;

  // A protected page may already be admitted from the host-only cookie while
  // this request observes an empty/expired in-memory auth cache. Refresh that
  // same browser session once before failing closed; never turn a transient
  // read gap into a per-screen login prompt or invent a new credential flow.
  const recovered = await refreshAuthSession();
  const recoveredToken = recovered?.access_token;
  if (recoveredToken) return recoveredToken;
  throw new Error('cloudflare_session_missing');
};

const asUser = (profile: CloudflareProfile): User => ({
  id: profile.id,
  email: profile.email,
  name: profile.name,
  avatar_url: profile.avatar_url,
  language: profile.language,
  is_admin: profile.is_admin === true,
  created_at: profile.created_at,
  updated_at: profile.updated_at,
});

const asBrand = (brand: CloudflareBrand): Brand => ({
  id: brand.id,
  owner_id: brand.owner_id,
  name: brand.name,
  logo_url: brand.logo_url,
  brand_colors: brand.brand_colors,
  tone_description: brand.tone_description,
  target_audience: brand.target_audience,
  created_at: brand.created_at,
  updated_at: brand.updated_at,
});

class CloudflareDataPlaneClient {
  readonly origin: string;

  constructor(origin: string) {
    this.origin = origin;
  }

  async submitFeedback(input: Record<string, unknown>): Promise<{ ok: true; feedback: { id: string; submission_state: 'accepted'; screenshot_capture_status: string } }> {
    return this.request('/v1/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  }

  async getAdminStats(): Promise<CloudflareAdminStats> { return this.request('/v1/admin/stats'); }
  async listAdminUsers(): Promise<CloudflareAdminUser[]> { return this.request('/v1/admin/users'); }
  async listAdminFeedback(): Promise<CloudflareFeedback[]> { return this.request('/v1/admin/feedback'); }
  async updateAdminFeedback(id: string, input: { revision: number; status?: CloudflareFeedback['status']; admin_note?: string | null }): Promise<CloudflareFeedback> {
    return this.request(`/v1/admin/feedback/${encodeURIComponent(id)}`, { method: 'PATCH',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  }
  async readFeedbackScreenshot(id: string): Promise<Blob> {
    const response = await this.fetchRaw(`/v1/admin/feedback/${encodeURIComponent(id)}/screenshot`);
    if (response.headers.get('content-type') !== 'image/png') throw new Error('cloudflare_invalid_screenshot');
    return response.blob();
  }
  async readFeedbackAudio(id: string): Promise<Blob> {
    const response = await this.fetchRaw(`/v1/admin/feedback/${encodeURIComponent(id)}/audio`);
    if (!response.headers.get('content-type')?.startsWith('audio/')) throw new Error('cloudflare_invalid_audio');
    return response.blob();
  }
  async listAnnouncements(): Promise<CloudflareAnnouncement[]> { return this.request('/v1/announcements'); }
  async publishAnnouncement(input: { request_id: string; title: string; content: string; type: CloudflareAnnouncement['type'] }): Promise<CloudflareAnnouncement> {
    return this.request('/v1/admin/announcements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  }

  async getProfile(): Promise<User> {
    return asUser(await this.request<CloudflareProfile>('/v1/profile'));
  }

  async updateProfile(updates: Pick<User, 'name' | 'avatar_url' | 'language'>): Promise<User> {
    return asUser(await this.request<CloudflareProfile>('/v1/profile', {
      method: 'PATCH',
      body: JSON.stringify(updates),
      headers: { 'content-type': 'application/json' },
    }));
  }

  async listBrands(): Promise<Brand[]> {
    const brands = await this.request<CloudflareBrand[]>('/v1/brands');
    return brands.map(asBrand);
  }

  async createBrand(input: {
    name: string;
    logo_url?: string | null;
    brand_colors?: Brand['brand_colors'];
    tone_description?: string | null;
    target_audience?: string | null;
  }): Promise<Brand> {
    return asBrand(await this.request<CloudflareBrand>('/v1/brands', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
    }));
  }

  async updateBrand(brandId: string, input: {
    name?: string;
    logo_url?: string | null;
    brand_colors?: Brand['brand_colors'];
    tone_description?: string | null;
    target_audience?: string | null;
  }): Promise<Brand> {
    return asBrand(await this.request<CloudflareBrand>(`/v1/brands/${encodeURIComponent(brandId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
    }));
  }

  /** Store a brand logo in the private Worker-backed R2 media bucket. */
  async uploadBrandLogo(brandId: string, file: File): Promise<string> {
    const contentType = file.type.trim().toLowerCase();
    if (!contentType.startsWith('image/')) throw new Error('cloudflare_logo_content_type_invalid');
    if (file.size <= 0) throw new Error('cloudflare_logo_empty');
    const allocation = await this.request<CloudflareMediaAllocation>('/v1/media', {
      method: 'POST',
      body: JSON.stringify({
        clientRequestId: `brand-logo:${brandId}:${crypto.randomUUID()}`,
        contentType,
        declaredSizeBytes: file.size,
      }),
      headers: { 'content-type': 'application/json' },
    });
    await this.request<{ id: string; state: string }>(`/v1/media/${encodeURIComponent(allocation.id)}/content`, {
      method: 'PUT',
      body: file,
      headers: { 'content-type': contentType },
    });
    return `media/v1/${allocation.id}`;
  }

  /** Store a workspace input image privately so resume works without this browser's local copy. */
  async uploadWorkspaceSourceImage(file: Blob, purpose: string): Promise<string> {
    const contentType = file.type.trim().toLowerCase();
    if (!contentType.startsWith('image/')) throw new Error('cloudflare_source_content_type_invalid');
    if (file.size <= 0) throw new Error('cloudflare_source_empty');
    const allocation = await this.request<CloudflareMediaAllocation>('/v1/media', {
      method: 'POST',
      body: JSON.stringify({ clientRequestId: `workspace-source:${purpose}:${crypto.randomUUID()}`, contentType, declaredSizeBytes: file.size }),
      headers: { 'content-type': 'application/json' },
    });
    await this.request<{ id: string; state: string }>(`/v1/media/${encodeURIComponent(allocation.id)}/content`, {
      method: 'PUT',
      body: file,
      headers: { 'content-type': contentType },
    });
    return `media/v1/${allocation.id}`;
  }

  /** Fetch a private R2 media object with the current bearer and expose it to an image element. */
  async readMediaObjectUrl(objectPath: string): Promise<string> {
    if (!MEDIA_OBJECT_PATH.test(objectPath)) throw new Error('cloudflare_media_path_invalid');
    const response = await this.fetchRaw(`/v1/media/${objectPath.slice('media/v1/'.length)}/content`);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  async listFolders(brandId: string): Promise<Folder[]> {
    return this.request<Folder[]>(`/v1/folders?brand_id=${encodeURIComponent(brandId)}`);
  }

  async createFolder(input: {
    id?: string;
    brand_id: string;
    name: string;
    parent_folder_id?: string | null;
  }): Promise<Folder> {
    return this.request<Folder>('/v1/folders', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
    });
  }

  async updateFolder(folderId: string, input: { name?: string; parent_folder_id?: string | null }): Promise<Folder> {
    return this.request<Folder>(`/v1/folders/${encodeURIComponent(folderId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
    });
  }

  async deleteFolder(folderId: string): Promise<void> {
    await this.request<unknown>(`/v1/folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' });
  }

  async listImageFolderMemberships(brandId: string): Promise<CloudflareImageFolder[]> {
    return this.request<CloudflareImageFolder[]>(`/v1/image-folders?brand_id=${encodeURIComponent(brandId)}`);
  }

  async listTags(brandId: string): Promise<CloudflareTag[]> {
    return this.request<CloudflareTag[]>(`/v1/tags?brand_id=${encodeURIComponent(brandId)}`);
  }

  async createTag(input: { id?: string; brand_id: string; name: string }): Promise<CloudflareTag> {
    return this.request<CloudflareTag>('/v1/tags', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
    });
  }

  async deleteTag(tagId: string): Promise<void> {
    await this.request<unknown>(`/v1/tags/${encodeURIComponent(tagId)}`, { method: 'DELETE' });
  }

  async listImageTags(imageId: string): Promise<string[]> {
    return this.request<string[]>(`/v1/image-tags?image_id=${encodeURIComponent(imageId)}`);
  }

  async addImageTag(imageId: string, tagId: string): Promise<void> {
    await this.request<unknown>('/v1/image-tags', {
      method: 'POST',
      body: JSON.stringify({ image_id: imageId, tag_id: tagId }),
      headers: { 'content-type': 'application/json' },
    });
  }

  async deleteImageTag(imageId: string, tagId: string): Promise<void> {
    await this.request<unknown>(`/v1/image-tags?image_id=${encodeURIComponent(imageId)}&tag_id=${encodeURIComponent(tagId)}`, {
      method: 'DELETE',
    });
  }

  async listStylePresets(brandId: string): Promise<CloudflareStylePreset[]> {
    return this.request<CloudflareStylePreset[]>(`/v1/style-presets?brand_id=${encodeURIComponent(brandId)}`);
  }

  async createStylePreset(input: {
    id?: string;
    brand_id: string;
    name: string;
    prompt_template?: string;
    settings?: CloudflareStylePreset['settings'];
  }): Promise<CloudflareStylePreset> {
    return this.request<CloudflareStylePreset>('/v1/style-presets', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
    });
  }

  async updateStylePreset(presetId: string, input: {
    name?: string;
    prompt_template?: string;
    settings?: CloudflareStylePreset['settings'];
  }): Promise<CloudflareStylePreset> {
    return this.request<CloudflareStylePreset>(`/v1/style-presets/${encodeURIComponent(presetId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
    });
  }

  async deleteStylePreset(presetId: string): Promise<void> {
    await this.request<unknown>(`/v1/style-presets/${encodeURIComponent(presetId)}`, { method: 'DELETE' });
  }

  async listBrandMembers(brandId: string): Promise<CloudflareBrandMember[]> {
    const members = await this.request<CloudflareBrandMember[]>(`/v1/brands/${encodeURIComponent(brandId)}/members`);
    return members.map((member) => ({
      ...member,
      user: { ...member.user, name: member.user.name ?? '' },
    }));
  }

  async listInvitations(brandId: string): Promise<CloudflareInvitation[]> {
    return this.request<CloudflareInvitation[]>(`/v1/brands/${encodeURIComponent(brandId)}/invitations`);
  }

  async createInvitation(input: {
    id?: string;
    brand_id: string;
    email?: string | null;
    role?: CloudflareInvitation['role'];
  }): Promise<CloudflareInvitation> {
    return this.request<CloudflareInvitation>(`/v1/brands/${encodeURIComponent(input.brand_id)}/invitations`, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
    });
  }

  async revokeInvitation(invitationId: string): Promise<void> {
    await this.request<unknown>(`/v1/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE' });
  }

  async updateBrandMemberRole(brandId: string, userId: string, role: Exclude<CloudflareBrandMember['role'], 'owner'>): Promise<void> {
    await this.request<unknown>(`/v1/brands/${encodeURIComponent(brandId)}/members/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
      headers: { 'content-type': 'application/json' },
    });
  }

  async removeBrandMember(brandId: string, userId: string): Promise<void> {
    await this.request<unknown>(`/v1/brands/${encodeURIComponent(brandId)}/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
  }

  async acceptInvitation(code: string): Promise<{ brand_id: string; role: Exclude<CloudflareBrandMember['role'], 'owner'> }> {
    return this.request<{ brand_id: string; role: Exclude<CloudflareBrandMember['role'], 'owner'> }>(
      `/v1/invitations/${encodeURIComponent(code)}/accept`,
      { method: 'POST' },
    );
  }

  async createShareLink(imageId: string, expiresInDays?: number): Promise<{
    success: boolean;
    shareUrl?: string;
    token?: string;
    expiresAt?: string;
    expiresInDays?: number;
    error?: string;
  }> {
    return this.request('/v1/share-links', {
      method: 'POST',
      body: JSON.stringify({ imageId, expiresInDays }),
      headers: { 'content-type': 'application/json' },
    });
  }

  async getSharedImage(token: string): Promise<CloudflareSharedImagePayload> {
    if (!/^[A-Za-z0-9]{32,128}$/.test(token)) throw new Error('cloudflare_share_token_invalid');
    return this.requestPublic<CloudflareSharedImagePayload>(`/v1/shared-images?token=${encodeURIComponent(token)}`);
  }

  private async captureRequestContext(assertContext?:()=>void | Promise<void>, contextError?: (cause: unknown) => Error) {
      await assertContext?.();
      const { data,error } = await auth.getSession(); if (error) throw error;
      const session = data.session;
      if (!session?.user?.id || !session.access_token) throw new Error('cloudflare_session_missing');
      const userId = session.user.id, accessToken = session.access_token;
      const assertCurrent = async () => {
        try {
          await assertContext?.();
          const current = await auth.getSession();
          if (current.error || current.data.session?.user?.id !== userId || current.data.session?.access_token !== accessToken) throw new Error('cloudflare_session_changed');
          await assertContext?.();
        } catch (cause) {
          throw contextError ? contextError(cause) : cause;
        }
      };
      await assertCurrent();
      const call = async (path: string,init: RequestInit = {}): Promise<unknown> => {
          await assertCurrent(); const headers = new Headers(init.headers); headers.set('authorization',`Bearer ${accessToken}`);
          try {
            const response = await fetch(this.origin + path,{ ...init,headers });
            const payload = await response.json().catch(() => null) as { error?: string } | null;
            if (!response.ok) throw new Error(`cloudflare_api_${response.status}_${payload?.error ?? 'request_failed'}`);
            return payload;
          } finally {
            await assertCurrent();
          }
        };
      return {userId,assertCurrent,call};
  }

  async captureArtifactPersistenceContext(options: { assertContext?: () => void | Promise<void> } = {}): Promise<ArtifactPersistenceContext> {
    const assertScope = async () => {
      try { await options.assertContext?.(); }
      catch (cause) { throw new ArtifactPersistenceContextError(cause); }
    };
    let captured: Awaited<ReturnType<CloudflareDataPlaneClient['captureRequestContext']>>;
    try { captured = await this.captureRequestContext(assertScope, cause => cause instanceof ArtifactPersistenceContextError ? cause : new ArtifactPersistenceContextError(cause)); }
    catch (cause) {
      if (cause instanceof ArtifactPersistenceContextError) throw cause;
      throw new ArtifactPersistenceContextError(cause);
    }
    const assertCurrent = async () => {
      try { await captured.assertCurrent(); }
      catch (cause) {
        if (cause instanceof ArtifactPersistenceContextError) throw cause;
        throw new ArtifactPersistenceContextError(cause);
      }
    };
    const context = Object.freeze({ assertCurrent });
    artifactPersistenceContexts.set(context, { owner: this, call: captured.call, assertCurrent });
    return context;
  }

  private async artifactPersistenceRequest(context: ArtifactPersistenceContext, checkedRequest?: CheckedCloudflareRequest): Promise<CheckedCloudflareRequest> {
    const captured = artifactPersistenceContexts.get(context);
    if (!captured || captured.owner !== this) throw new ArtifactPersistenceContextError(new Error('artifact_persistence_context_unrecognized'));
    await captured.assertCurrent();
    return async (path, init) => {
      await captured.assertCurrent();
      try { return await (checkedRequest ?? captured.call)(path, init); }
      finally { await captured.assertCurrent(); }
    };
  }

  async invokeProviderAction<T>(action: string, requestBody: Record<string, unknown>, options: { idempotencyKey?: string; assertContext?: ()=>void | Promise<void>; retainUntilAcknowledged?: boolean; heavyPreparation?: HeavyGenerationPreflight; heavyConsent?: HeavyGenerationConsent } = {}): Promise<T> {
    // The settings-screen model choice travels with every image and Claude text request.
    const body = withAIModelPreference(action, requestBody);
    await options.assertContext?.();
    if (COMPOSITE_PROVIDER_ACTIONS.has(action)) {
      // Multi-image features: Claude plans prompts, existing durable image actions render them.
      const nested = { assertContext: options.assertContext };
      return await runCompositeProviderAction(action, body, {
        image: (imageAction, imageBody) => this.invokeProviderAction(imageAction, imageBody, nested),
        plan: planBody => this.invokeProviderAction('image-plan', planBody, nested),
        toDataUrl: async imageUrl => {
          const prepared = await prepareCloudflareImageInput('edit-image', { imageUrl });
          return Array.isArray(prepared.imageUrls) && typeof prepared.imageUrls[0] === 'string' ? prepared.imageUrls[0] : null;
        },
        cutout: async imageUrl => {
          const { buildHighPrecisionMaterialCutoutDataUrl } = await import('./workspaceMaterialReferences');
          return (await buildHighPrecisionMaterialCutoutDataUrl({ imageUrl, modelName: 'isnet-general-use', preserveSourceFrame: true,
            maxDataUrlBytes: 12 * 1024 * 1024 })).dataUrl;
        },
        upscale: async (imageUrl, upscaleOptions) => (await import('./clientImageOps')).upscaleImage(imageUrl, upscaleOptions),
      }) as T;
    }
    if (CLOUDFLARE_IMAGE_ACTIONS.has(action)) {
      const {userId,assertCurrent,call} = await this.captureRequestContext(options.assertContext);
      const protectedEdit = action === 'edit-image' && body.maskDataUrl ? await prepareProtectedCloudflareEdit(body) : null;
      // Heavy preflight, attestation, and provider admission each normalize
      // the input independently. Pin one candidate seed before the first
      // normalization so a missing caller seed cannot produce three different
      // server digests for one explicit request.
      const heavyInput = options.heavyConsent && (protectedEdit?.body ?? body).seed === undefined
        ? { ...(protectedEdit?.body ?? body), seed: crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647 }
        : (protectedEdit?.body ?? body);
      const proofBody = options.heavyPreparation ? attachHeavyGenerationPreflight(heavyInput, options.heavyPreparation) : heavyInput;
      const prepared = canonicalCloudflareImageBody(await prepareCloudflareImageInput(action,proofBody)); await assertCurrent();
      let requestId = options.idempotencyKey;
      let heavyPreparation = options.heavyPreparation;
      if (options.heavyConsent) {
        const consentRequestId = options.idempotencyKey ?? crypto.randomUUID();
        requestId = consentRequestId;
        heavyPreparation = heavyPreparation ?? await this.prepareHeavyGeneration({
          brandId: String(prepared.brandId ?? prepared.brand_id), action, requestId: consentRequestId, input: prepared,
        });
        if (options.heavyConsent.termsAccepted !== true || options.heavyConsent.rightsAttested !== true) {
          throw new Error('heavy_explicit_consent_required');
        }
        const status = await this.getHeavyEntitlement(String(prepared.brandId ?? prepared.brand_id), action).catch(() => null);
        if (!status?.termsAcceptanceId) {
          if (!heavyPreparation.termsDocumentVersion || !heavyPreparation.termsDocumentDigest) throw new Error('heavy_terms_document_unavailable');
          await this.recordHeavyTermsAcceptance({
            brandId: String(prepared.brandId ?? prepared.brand_id), action, requestId: consentRequestId, preflight: heavyPreparation,
            termsAccepted: true, documentVersion: heavyPreparation.termsDocumentVersion,
            documentDigest: heavyPreparation.termsDocumentDigest, source: 'heavy-ui-v1',
          });
        }
        if (!heavyPreparation.termsDocumentVersion || !heavyPreparation.termsDocumentDigest ||
            !heavyPreparation.rightsVersion || !heavyPreparation.rightsDocumentVersion || !heavyPreparation.rightsDocumentDigest) {
          throw new Error('heavy_entitlement_policy_unavailable');
        }
        await this.recordHeavyRequestAttestation({
          brandId: String(prepared.brandId ?? prepared.brand_id), action, requestId: consentRequestId, preflight: heavyPreparation,
          providerInput: prepared, termsAccepted: true, rightsAttested: true,
          termsDocumentVersion: heavyPreparation.termsDocumentVersion, termsDocumentDigest: heavyPreparation.termsDocumentDigest,
          rightsVersion: heavyPreparation.rightsVersion, rightsDocumentVersion: heavyPreparation.rightsDocumentVersion,
          rightsDocumentDigest: heavyPreparation.rightsDocumentDigest,
        });
      }
      const finalBody = heavyPreparation ? attachHeavyGenerationPreflight(prepared, heavyPreparation) : prepared;
      const scope = {origin:this.origin,userId,brandId:String(finalBody.brandId ?? finalBody.brand_id)};
      const snapshot = protectedEdit ? {...protectedEdit,body:finalBody} : null;
      return invokeDurableImageAction<T>({ origin: this.origin,userId,action,body: finalBody,idempotencyKey:options.heavyConsent ? requestId : options.idempotencyKey,assertCurrent,call,
        retainUntilAcknowledged:!!protectedEdit || options.retainUntilAcknowledged === true,
        beforeSubmit:snapshot ? (id,key)=>persistProtectedImageInput(scope,snapshot,id,key) : undefined,
        onTerminal:snapshot ? (id,key)=>deleteProtectedImageInput(scope,id,key) : undefined,
        finalize:protectedEdit ? receipt=>finalizeProtectedCloudflareEdit({ prepared:protectedEdit,receipt,assertCurrent,call,
          save:input=>this.saveWorkspaceArtifact(input,call) }) : undefined });
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    const proofBody = options.heavyPreparation ? attachHeavyGenerationPreflight(body, options.heavyPreparation) : body;
    return this.request<T>(`/v1/provider-actions/${encodeURIComponent(action)}`, {
      method: 'POST',
      body: JSON.stringify(proofBody),
      headers,
    });
  }

  async listPendingProtectedImageEdits(brandId:string) {
    const {userId,assertCurrent} = await this.captureRequestContext();
    const entries = await listProtectedImageInputs({origin:this.origin,userId,brandId});
    await assertCurrent(); return entries;
  }

  /** Explicit recovery uses the original prepared bytes/settings and UUID.
   * Only a definite absent receipt permits submission of that same UUID. */
  async resumeProtectedImageEdit(brandId:string,requestId:string,assertContext?:()=>void,expectedSourceImageUrl?:string):Promise<ImageReceipt> {
    const {userId,assertCurrent,call} = await this.captureRequestContext(assertContext);
    const scope = {origin:this.origin,userId,brandId};
    const entry = await loadProtectedImageInput(scope,requestId); await assertCurrent();
    if (expectedSourceImageUrl) {
      const currentSource = await prepareProtectedCloudflareEdit({...entry.prepared.body,imageUrls:[expectedSourceImageUrl],maskDataUrl:entry.prepared.maskDataUrl});
      if (currentSource.plan.sourceSha256 !== entry.prepared.plan.sourceSha256) throw new Error('image_recovery_source_changed');
      await assertCurrent();
    }
    return invokeDurableImageAction<ImageReceipt>({origin:this.origin,userId,action:'edit-image',body:entry.prepared.body,idempotencyKey:requestId,
      assertCurrent,call,retainUntilAcknowledged:true,
      beforeSubmit:(id,key)=>persistProtectedImageInput(scope,entry.prepared,id,key),
      onTerminal:(id,key)=>deleteProtectedImageInput(scope,id,key),
      finalize:receipt=>finalizeProtectedCloudflareEdit({prepared:entry.prepared,receipt,assertCurrent,call,save:input=>this.saveWorkspaceArtifact(input,call)})});
  }

  /** Image and text models whose provider key is registered on the API. */
  async getAIModels(): Promise<CloudflareAIModels> {
    return this.request('/v1/ai/models');
  }

  async getImageUsage(brandId: string): Promise<CloudflareImageUsage> {
    return this.request(`/v1/image-ai/usage?brand_id=${encodeURIComponent(brandId)}`);
  }

  async getHeavyEntitlement(brandId: string, action = 'generate-image'): Promise<CloudflareHeavyEntitlement> {
    return this.request(`/v1/heavy/entitlement?brand_id=${encodeURIComponent(brandId)}&action=${encodeURIComponent(action)}`);
  }

  /** Prepare one exact Heavy input; this does not accept terms or attest rights. */
  async prepareHeavyGeneration(input: {
    brandId: string;
    action: string;
    requestId: string;
    input: HeavyGenerationInput;
  }): Promise<CloudflareHeavyGenerationPreparation> {
    const response = await this.request<CloudflareHeavyGenerationPreparation & { success: true }>('/v1/heavy/entitlement/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': input.requestId },
      body: JSON.stringify({ brandId: input.brandId, action: input.action, requestId: input.requestId, input: input.input }),
    });
    return validateHeavyGenerationPreflight(response);
  }

  /** Record explicit Heavy terms acceptance; this never auto-checks the box. */
  async recordHeavyTermsAcceptance(input: {
    brandId: string;
    action: string;
    requestId: string;
    preflight: HeavyGenerationPreflight;
    termsAccepted: boolean;
    documentVersion: string;
    documentDigest: string;
    source?: string;
  }): Promise<CloudflareHeavyAcceptanceReceipt> {
    const proof = validateHeavyGenerationPreflight(input.preflight);
    return this.request<CloudflareHeavyAcceptanceReceipt>('/v1/heavy/entitlement/acceptance', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': input.requestId },
      body: JSON.stringify({
        brandId: input.brandId,
        action: input.action,
        requestId: input.requestId,
        preparationId: proof.preparationId,
        inputDigest: proof.inputDigest,
        termsAccepted: input.termsAccepted,
        documentVersion: input.documentVersion,
        documentDigest: input.documentDigest,
        source: input.source,
      }),
    });
  }

  /** Record explicit, request-scoped rights attestation without inferring consent. */
  async recordHeavyRequestAttestation(input: {
    brandId: string;
    action: string;
    requestId: string;
    preflight: HeavyGenerationPreflight;
    providerInput: HeavyGenerationInput;
    termsAccepted: boolean;
    rightsAttested: boolean;
    termsDocumentVersion: string;
    termsDocumentDigest: string;
    rightsVersion: string;
    rightsDocumentVersion: string;
    rightsDocumentDigest: string;
  }): Promise<CloudflareHeavyAttestationReceipt> {
    const proof = validateHeavyGenerationPreflight(input.preflight);
    return this.request<CloudflareHeavyAttestationReceipt>('/v1/heavy/entitlement/attestation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': input.requestId },
      body: JSON.stringify({
        brandId: input.brandId,
        action: input.action,
        requestId: input.requestId,
        preparationId: proof.preparationId,
        inputDigest: proof.inputDigest,
        termsAccepted: input.termsAccepted,
        rightsAttested: input.rightsAttested,
        termsDocumentVersion: input.termsDocumentVersion,
        termsDocumentDigest: input.termsDocumentDigest,
        rightsVersion: input.rightsVersion,
        rightsDocumentVersion: input.rightsDocumentVersion,
        rightsDocumentDigest: input.rightsDocumentDigest,
        input: input.providerInput,
      }),
    });
  }

  async listWorkspaceExecutionSteps(brandId: string, jobIds: string[]): Promise<WorkspaceExecutionStep[]> {
    if (!jobIds.length) return [];
    if (jobIds.length > 100) throw new Error('workspace_execution_scope_too_large');
    const query = new URLSearchParams({ brand_id: brandId });
    for (const id of new Set(jobIds)) query.append('job_id', id);
    return this.request(`/v1/workspace-execution-steps?${query.toString()}`);
  }

  async readImageAIRequest(requestId: string): Promise<Record<string,unknown>> {
    return this.request(`/v1/image-ai/requests/${encodeURIComponent(requestId)}`);
  }

  async acknowledgeImageAction(receipt: { requestId?: unknown; clientRecoveryKey?: unknown }): Promise<void> {
    const { data,error } = await auth.getSession(); if (error) throw error;
    const session = data.session; if (!session?.user?.id || !session.access_token) throw new Error('cloudflare_session_missing');
    const prefix = `heavy:image-ai:v1:${this.origin}:${session.user.id}:`;
    const suffix = typeof receipt.clientRecoveryKey === 'string' && receipt.clientRecoveryKey.startsWith(prefix) ? receipt.clientRecoveryKey.slice(prefix.length) : '';
    const brandId = suffix.slice(0,suffix.lastIndexOf(':'));
    await acknowledgeDurableImageAction({ origin:this.origin,userId:session.user.id,receipt,
      cleanup:()=>deleteProtectedImageInput({origin:this.origin,userId:session.user.id,brandId},String(receipt.requestId),String(receipt.clientRecoveryKey)),assertCurrent:async()=>{
      const current = await auth.getSession();
      if (current.error || current.data.session?.user?.id !== session.user.id || current.data.session?.access_token !== session.access_token) throw new Error('cloudflare_session_changed');
    } });
  }

  async saveWorkspaceArtifact(input: {
    requestId: string;
    brandId: string;
    featureType: string;
    title: string;
    imageUrl: string;
    prompt: string | null;
    metadata: Record<string, Json | undefined>;
    canvasProjectId?: string | null;
    sourceJobId?: string | null;
    sourceStoragePath: string | null;
    imageAI?: { requestId: string; candidateIndex: number };
  },checkedRequest?: CheckedCloudflareRequest, persistenceContext?: ArtifactPersistenceContext): Promise<WorkspaceArtifactRemoteResponse> {
    const send = persistenceContext
      ? await this.artifactPersistenceRequest(persistenceContext, checkedRequest)
      : checkedRequest ?? this.request.bind(this);
    let imageUrl = input.imageUrl;
    if (!input.sourceStoragePath && imageUrl.startsWith('blob:')) {
      // Browser-owned blobs must be materialized here; a Worker must never try
      // to fetch blob URLs, external URLs, or embedded credentials.
      await persistenceContext?.assertCurrent();
      const response = await fetch(imageUrl).finally(() => persistenceContext?.assertCurrent());
      if (!response.ok) throw new Error('workspace_blob_unavailable');
      const blob = await response.blob();
      if (blob.size > WORKSPACE_UPLOAD_MAX_BYTES) throw new Error('workspace_image_too_large');
      imageUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('workspace_blob_invalid'));
        reader.onerror = () => reject(reader.error ?? new Error('workspace_blob_invalid'));
        reader.readAsDataURL(blob);
      });
      await persistenceContext?.assertCurrent();
    }
    if (!WORKSPACE_REQUEST_ID.test(input.requestId)) throw new Error('cloudflare_workspace_request_id_invalid');
    try {
      const result = await send('/v1/workspace-artifacts', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, imageUrl }), signal: AbortSignal.timeout(8000),
      });
      return asWorkspaceArtifactRemoteResponse(result, input.requestId, input.sourceStoragePath);
    } catch (error) {
      if (error instanceof ArtifactPersistenceContextError) throw error;
      await persistenceContext?.assertCurrent();
      // The POST may have committed before its response was lost. Reconcile the
      // exact request ID before surfacing the error; never invent a new ID or
      // silently retry a write whose effect is unknown. A 404/pending/mismatch
      // readback keeps the original POST error so the caller can retain its
      // local record and resume explicitly with the same identity.
      try {
        return await this.readWorkspaceArtifact(input.requestId, checkedRequest, input.sourceStoragePath, persistenceContext);
      } catch (readError) {
        if (readError instanceof ArtifactPersistenceContextError) throw readError;
        await persistenceContext?.assertCurrent();
        throw error;
      }
    }
  }

  /** Read the exact workspace save receipt used to reconcile an uncertain POST. */
  async readWorkspaceArtifact(requestId: string, checkedRequest?: CheckedCloudflareRequest, expectedSourceStoragePath?: string | null, persistenceContext?: ArtifactPersistenceContext): Promise<WorkspaceArtifactRemoteResponse> {
    if (!WORKSPACE_REQUEST_ID.test(requestId)) throw new Error('cloudflare_workspace_request_id_invalid');
    const read = persistenceContext
      ? await this.artifactPersistenceRequest(persistenceContext, checkedRequest)
      : checkedRequest ?? this.request.bind(this);
    const result = await read(`/v1/workspace-artifacts/${encodeURIComponent(requestId)}`, {
      method: 'GET', signal: AbortSignal.timeout(8000),
    });
    return asWorkspaceArtifactRemoteResponse(result, requestId, expectedSourceStoragePath);
  }

  async listGenerationJobs(brandId: string, options: { limit?: number; offset?: number } = {}): Promise<CloudflareGenerationJob[]> {
    const query = new URLSearchParams({
      brand_id: brandId,
      limit: String(options.limit ?? 50),
      offset: String(options.offset ?? 0),
    });
    return this.request<CloudflareGenerationJob[]>(`/v1/generation-jobs?${query.toString()}`);
  }

  async createGenerationJob(input: {
    id?: string;
    brand_id: string;
    feature_type: string;
    input_params?: Json;
    optimized_prompt?: string | null;
    status?: CloudflareGenerationJob['status'];
  }): Promise<CloudflareGenerationJob> {
    return this.request<CloudflareGenerationJob>('/v1/generation-jobs', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
    });
  }

  async updateGenerationJob(jobId: string, input: {
    status: CloudflareGenerationJob['status'];
    error_message?: string | null;
  }): Promise<CloudflareGenerationJob> {
    return this.request<CloudflareGenerationJob>(`/v1/generation-jobs/${encodeURIComponent(jobId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
    });
  }

  async listGeneratedImages(brandId: string, options: { favorite?: boolean; assetPurpose?: 'print-design'; hasJob?: boolean; featureType?: string; jobId?: string; order?: 'oldest' | 'newest'; limit?: number; offset?: number } = {}): Promise<CloudflareGeneratedImage[]> {
    const query = new URLSearchParams({
      brand_id: brandId,
      limit: String(options.limit ?? 50),
      offset: String(options.offset ?? 0),
    });
    if (options.favorite !== undefined) query.set('favorite', String(options.favorite));
    if (options.assetPurpose !== undefined) query.set('asset_purpose', options.assetPurpose);
    if (options.hasJob !== undefined) query.set('has_job', String(options.hasJob));
    if (options.featureType !== undefined) query.set('feature_type', options.featureType);
    if (options.jobId !== undefined) query.set('job_id', options.jobId);
    if (options.order !== undefined) query.set('order', options.order);
    return this.request<CloudflareGeneratedImage[]>(`/v1/generated-images?${query.toString()}`);
  }

  async createGeneratedImage(input: {
    id?: string;
    job_id?: string | null;
    brand_id: string;
    storage_path: string;
    image_url?: string | null;
    thumbnail_path?: string | null;
    version?: number;
    parent_image_id?: string | null;
    is_favorite?: boolean;
    prompt?: string | null;
    negative_prompt?: string | null;
    feature_type?: string | null;
    style_preset?: string | null;
    model_used?: string | null;
    generation_params?: Json | null;
    metadata?: Json | null;
    expires_at?: string | null;
  }): Promise<CloudflareGeneratedImage> {
    return this.request<CloudflareGeneratedImage>('/v1/generated-images', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
    });
  }

  async setGeneratedImageFavorite(imageId: string, isFavorite: boolean): Promise<CloudflareGeneratedImage> {
    return this.request<CloudflareGeneratedImage>(`/v1/generated-images/${encodeURIComponent(imageId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_favorite: isFavorite }),
      headers: { 'content-type': 'application/json' },
    });
  }

  async updateGeneratedImageLibraryTitle(imageId: string, title: string, persistenceContext?: ArtifactPersistenceContext): Promise<CloudflareGeneratedImage> {
    const send = persistenceContext ? await this.artifactPersistenceRequest(persistenceContext) : this.request.bind(this);
    return await send(`/v1/generated-images/${encodeURIComponent(imageId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ library_title: title }),
      headers: { 'content-type': 'application/json' },
    }) as CloudflareGeneratedImage;
  }

  async deleteGeneratedImage(imageId: string, persistenceContext?: ArtifactPersistenceContext): Promise<void> {
    const send = persistenceContext ? await this.artifactPersistenceRequest(persistenceContext) : this.request.bind(this);
    await send(`/v1/generated-images/${encodeURIComponent(imageId)}`, { method: 'DELETE' });
  }

  async sendDesignAssistantRequest(
    input: CloudflareDesignAssistantRequestInput,
    context?: { userId: string; assertContext: () => void | Promise<void> },
  ): Promise<CloudflareDesignAssistantReceipt> {
    const { userId, call } = await this.captureRequestContext(context?.assertContext);
    if (context && context.userId !== userId) throw new Error('cloudflare_session_changed');
    const textModel = readAIModelPreference().textModel;
    return await call('/v1/design-assistant/requests', {
      method: 'POST', body: JSON.stringify(textModel ? { ...input, textModel } : input), headers: { 'content-type': 'application/json' },
    }) as CloudflareDesignAssistantReceipt;
  }

  async readDesignAssistantRequest(
    input: Pick<CloudflareDesignAssistantRequestInput, 'requestId' | 'brandId' | 'projectId' | 'conversationId'>,
    context?: { userId: string; assertContext: () => void | Promise<void> },
  ): Promise<CloudflareDesignAssistantReceipt> {
    const { userId, call } = await this.captureRequestContext(context?.assertContext);
    if (context && context.userId !== userId) throw new Error('cloudflare_session_changed');
    const params = new URLSearchParams({ brand_id: input.brandId, project_id: input.projectId, conversation_id: input.conversationId });
    return await call(`/v1/design-assistant/requests/${encodeURIComponent(input.requestId)}?${params}`) as CloudflareDesignAssistantReceipt;
  }

  private async canvasRequest<T>(path:string,init:RequestInit,context?:{userId:string;assertContext:()=>void}):Promise<T> {
    const {userId,call}=await this.captureRequestContext(context?.assertContext);
    if(context&&context.userId!==userId)throw new Error('cloudflare_session_changed');
    return await call(path,{...init,signal:AbortSignal.timeout(20_000)}) as T;
  }

  async getCanvasDocument(documentId: string,context?:{userId:string;assertContext:()=>void}): Promise<CloudflareCanvasDocument> {
    return this.canvasRequest<CloudflareCanvasDocument>(`/v1/canvas-documents/${encodeURIComponent(documentId)}`,{},context);
  }

  async listCanvasDocuments(brandId: string): Promise<CloudflareCanvasDocument[]> {
    return this.request<CloudflareCanvasDocument[]>(`/v1/canvas-documents?brand_id=${encodeURIComponent(brandId)}`);
  }

  async listCanvasDocumentsPage(
    brandId: string,
    limit = 100,
    offset = 0,
    context?: { userId: string; assertContext: () => void | Promise<void> },
  ): Promise<CloudflareCanvasDocument[]> {
    const params = new URLSearchParams({ brand_id: brandId, limit: String(limit), offset: String(offset) });
    const path = `/v1/canvas-documents?${params.toString()}`;
    return context
      ? this.canvasRequest<CloudflareCanvasDocument[]>(path, {}, context)
      : this.request<CloudflareCanvasDocument[]>(path);
  }

  async createCanvasDocument(input: { id?:string;brand_id: string; title: string; snapshot: unknown },context?:{userId:string;assertContext:()=>void}): Promise<CloudflareCanvasDocument> {
    return this.canvasRequest<CloudflareCanvasDocument>('/v1/canvas-documents', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
    },context);
  }

  async updateCanvasDocument(input: {
    documentId: string;
    expected_revision: number;
    title: string;
    snapshot: unknown;
  },context?:{userId:string;assertContext:()=>void}): Promise<CloudflareCanvasDocument> {
    return this.canvasRequest<CloudflareCanvasDocument>(`/v1/canvas-documents/${encodeURIComponent(input.documentId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        expected_revision: input.expected_revision,
        title: input.title,
        snapshot: input.snapshot as Json,
      }),
      headers: { 'content-type': 'application/json' },
    },context);
  }

  async deleteCanvasDocument(documentId: string): Promise<void> {
    await this.request<void>(`/v1/canvas-documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchRaw(path, init);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  private async requestPublic<T>(path: string): Promise<T> {
    const response = await this.fetchPublicRaw(path);
    return await response.json() as T;
  }

  private async fetchRaw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${await getBearerToken()}`);
    const response = await fetch(`${this.origin}${path}`, { ...init, headers });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(`cloudflare_api_${response.status}_${body.error ?? 'request_failed'}`);
    }
    return response;
  }

  private async fetchPublicRaw(path: string): Promise<Response> {
    const response = await fetch(`${this.origin}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(`cloudflare_api_${response.status}_${body.error ?? 'request_failed'}`);
    }
    return response;
  }
}

export const cloudflareDataPlane: CloudflareDataPlaneClient | null = (
  baseURL && isEnabled(import.meta.env.VITE_CLOUDFLARE_API_ENABLED)
) ? new CloudflareDataPlaneClient(baseURL) : null;
