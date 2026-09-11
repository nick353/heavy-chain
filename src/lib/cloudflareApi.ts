import type { Brand, CanvasDocument, Folder, GeneratedImage, Json, User } from '../types/database';
import type { GeneratedImageListRow } from './generatedImageQuery';
import type { WorkspaceExecutionStep } from './workspaceExecution';
import { auth } from './auth';
import { CLOUDFLARE_IMAGE_ACTIONS, invokeDurableImageAction, prepareCloudflareImageInput,acknowledgeDurableImageAction,canonicalCloudflareImageBody,type ImageReceipt } from './cloudflareImageAI';
import { prepareProtectedCloudflareEdit,finalizeProtectedCloudflareEdit } from './cloudflareProtectedImageEdit';
import { persistProtectedImageInput,listProtectedImageInputs,loadProtectedImageInput,deleteProtectedImageInput } from './cloudflareImageInputCache';

export interface CloudflareImageUsage {
  planName: string; monthlyQuota: number; remainingUnits: number;
  completedImages: number | null; runningImages: number | null; uncertainImages: number | null; attemptedImages: number | null;
  estimatedMicroUSD: number | null; estimatedNeurons: number | null; unknownEstimateCount: number | null;
  averageInferenceMs: number | null; periodStart: string; periodEnd: string; imageAIEnabled: boolean;
  billing: 'estimate_not_invoice'; accountFreeAllocationRemaining: null; accountWideBudgetGuaranteed: false;
}

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
  const { data, error } = await auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error('cloudflare_session_missing');
  return token;
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

  private async captureRequestContext(assertContext?:()=>void) {
      assertContext?.();
      const { data,error } = await auth.getSession(); if (error) throw error;
      const session = data.session;
      if (!session?.user?.id || !session.access_token) throw new Error('cloudflare_session_missing');
      const assertCurrent = async () => {
        assertContext?.();
        const current = await auth.getSession();
        if (current.error || current.data.session?.user?.id !== session.user.id || current.data.session?.access_token !== session.access_token) throw new Error('cloudflare_session_changed');
        assertContext?.();
      };
      await assertCurrent();
      const call = async (path: string,init: RequestInit = {}): Promise<unknown> => {
          await assertCurrent(); const headers = new Headers(init.headers); headers.set('authorization',`Bearer ${session.access_token}`);
          const response = await fetch(this.origin + path,{ ...init,headers });
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          if (!response.ok) throw new Error(`cloudflare_api_${response.status}_${payload?.error ?? 'request_failed'}`);
          await assertCurrent(); return payload;
        };
      return {userId:session.user.id,assertCurrent,call};
  }

  async invokeProviderAction<T>(action: string, body: Record<string, unknown>, options: { idempotencyKey?: string; assertContext?: ()=>void } = {}): Promise<T> {
    options.assertContext?.();
    if (CLOUDFLARE_IMAGE_ACTIONS.has(action)) {
      const {userId,assertCurrent,call} = await this.captureRequestContext(options.assertContext);
      const protectedEdit = action === 'edit-image' && body.maskDataUrl ? await prepareProtectedCloudflareEdit(body) : null;
      const prepared = canonicalCloudflareImageBody(await prepareCloudflareImageInput(action,protectedEdit?.body ?? body)); await assertCurrent();
      const scope = {origin:this.origin,userId,brandId:String(prepared.brandId ?? prepared.brand_id)};
      const snapshot = protectedEdit ? {...protectedEdit,body:prepared} : null;
      return invokeDurableImageAction<T>({ origin: this.origin,userId,action,body: prepared,...options,assertCurrent,call,
        retainUntilAcknowledged:!!protectedEdit,
        beforeSubmit:snapshot ? (id,key)=>persistProtectedImageInput(scope,snapshot,id,key) : undefined,
        onTerminal:snapshot ? (id,key)=>deleteProtectedImageInput(scope,id,key) : undefined,
        finalize:protectedEdit ? receipt=>finalizeProtectedCloudflareEdit({ prepared:protectedEdit,receipt,assertCurrent,call,
          save:input=>this.saveWorkspaceArtifact(input,call) }) : undefined });
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    return this.request<T>(`/v1/provider-actions/${encodeURIComponent(action)}`, {
      method: 'POST',
      body: JSON.stringify(body),
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

  async getImageUsage(brandId: string): Promise<CloudflareImageUsage> {
    return this.request(`/v1/image-ai/usage?brand_id=${encodeURIComponent(brandId)}`);
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
  },checkedRequest?: (path: string,init?: RequestInit)=>Promise<unknown>): Promise<{ success: boolean; remote: { jobId: string; imageId: string; storagePath: string }; metadata?: Record<string,unknown> }> {
    let imageUrl = input.imageUrl;
    if (!input.sourceStoragePath && imageUrl.startsWith('blob:')) {
      // Browser-owned blobs must be materialized here; a Worker must never try
      // to fetch blob URLs, external URLs, or embedded credentials.
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error('workspace_blob_unavailable');
      const blob = await response.blob();
      if (blob.size > 10 * 1024 * 1024) throw new Error('workspace_image_too_large');
      imageUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('workspace_blob_invalid'));
        reader.onerror = () => reject(reader.error ?? new Error('workspace_blob_invalid'));
        reader.readAsDataURL(blob);
      });
    }
    const send = checkedRequest ?? this.request.bind(this);
    return await send('/v1/workspace-artifacts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, imageUrl }), signal: AbortSignal.timeout(8000),
    }) as { success: boolean; remote: { jobId: string; imageId: string; storagePath: string }; metadata?: Record<string,unknown> };
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

  async deleteGeneratedImage(imageId: string): Promise<void> {
    await this.request<unknown>(`/v1/generated-images/${encodeURIComponent(imageId)}`, { method: 'DELETE' });
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
