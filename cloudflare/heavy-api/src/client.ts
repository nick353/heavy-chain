export interface MediaAllocation {
  id: string;
  state: "pending" | "ready" | "failed";
  contentType: string;
  declaredSizeBytes: number;
}

export interface HeavyProfile {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  language: string;
}

export interface HeavyBrand {
  id: string;
  owner_id: string;
  name: string;
  logo_url: string | null;
  brand_colors: Record<string, unknown>;
  tone_description: string | null;
  target_audience: string | null;
  role: string;
}

export interface HeavyGenerationJob {
  id: string;
  brand_id: string;
  user_id: string;
  feature_type: string;
  input_params: Record<string, unknown>;
  optimized_prompt: string | null;
  status: "pending" | "processing" | "completed" | "failed";
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface HeavyGeneratedImage {
  id: string;
  job_id: string | null;
  brand_id: string;
  user_id: string;
  storage_path: string;
  thumbnail_path: string | null;
  version: number;
  parent_image_id: string | null;
  is_favorite: boolean;
  prompt: string | null;
  negative_prompt: string | null;
  feature_type: string | null;
  style_preset: string | null;
  model_used: string | null;
  generation_params: Record<string, unknown>;
  metadata: Record<string, unknown>;
  image_url: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface HeavyCanvasDocument {
  id: string;
  owner_id: string;
  brand_id: string;
  title: string;
  snapshot: Record<string, unknown>;
  snapshot_version: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface HeavyMediaClientOptions {
  baseUrl: string;
  tokenProvider: () => string | Promise<string>;
  fetcher?: typeof fetch;
}

export class HeavyMediaClient {
  private readonly baseUrl: string;
  private readonly tokenProvider: HeavyMediaClientOptions["tokenProvider"];
  private readonly fetcher: typeof fetch;

  constructor(options: HeavyMediaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.tokenProvider = options.tokenProvider;
    this.fetcher = options.fetcher ?? fetch;
  }

  async allocate(input: {
    clientRequestId: string;
    contentType: string;
    declaredSizeBytes: number;
  }): Promise<MediaAllocation> {
    const response = await this.fetcher(`${this.baseUrl}/v1/media`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.tokenProvider()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    return this.readJson<MediaAllocation>(response);
  }

  async upload(id: string, body: BodyInit, contentType: string): Promise<MediaAllocation> {
    const response = await this.fetcher(`${this.baseUrl}/v1/media/${encodeURIComponent(id)}/content`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${await this.tokenProvider()}`,
        "content-type": contentType,
      },
      body,
    });
    return this.readJson<MediaAllocation>(response);
  }

  async read(id: string): Promise<Response> {
    const response = await this.fetcher(`${this.baseUrl}/v1/media/${encodeURIComponent(id)}/content`, {
      method: "GET",
      headers: { authorization: `Bearer ${await this.tokenProvider()}` },
    });
    if (!response.ok) {
      throw new Error(`Heavy media read failed with status ${response.status}`);
    }
    return response;
  }

  async getProfile(): Promise<HeavyProfile> {
    return this.readJson<HeavyProfile>(await this.authenticatedRequest("/v1/profile"));
  }

  async updateProfile(input: {
    name?: string | null;
    avatar_url?: string | null;
    language?: string;
  }): Promise<HeavyProfile> {
    return this.readJson<HeavyProfile>(await this.authenticatedRequest("/v1/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }));
  }

  async listBrands(): Promise<HeavyBrand[]> {
    return this.readJson<HeavyBrand[]>(await this.authenticatedRequest("/v1/brands"));
  }

  async createBrand(input: {
    name: string;
    logo_url?: string | null;
    brand_colors?: Record<string, unknown>;
    tone_description?: string | null;
    target_audience?: string | null;
  }): Promise<HeavyBrand> {
    return this.readJson<HeavyBrand>(await this.authenticatedRequest("/v1/brands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }));
  }

  async listGenerationJobs(brandId: string, limit = 50, offset = 0): Promise<HeavyGenerationJob[]> {
    return this.readJson<HeavyGenerationJob[]>(await this.authenticatedRequest(
      `/v1/generation-jobs?brand_id=${encodeURIComponent(brandId)}&limit=${limit}&offset=${offset}`,
    ));
  }

  async createGenerationJob(input: {
    id?: string;
    brand_id: string;
    feature_type: string;
    input_params?: Record<string, unknown>;
    optimized_prompt?: string | null;
  }): Promise<HeavyGenerationJob> {
    return this.readJson<HeavyGenerationJob>(await this.authenticatedRequest('/v1/generation-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }));
  }

  async listGeneratedImages(brandId: string, options: { favorite?: boolean; assetPurpose?: 'print-design'; hasJob?: boolean; featureType?: string; jobId?: string; order?: 'oldest' | 'newest'; limit?: number; offset?: number } = {}): Promise<HeavyGeneratedImage[]> {
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
    return this.readJson<HeavyGeneratedImage[]>(await this.authenticatedRequest(`/v1/generated-images?${query.toString()}`));
  }

  async createGeneratedImage(input: Omit<HeavyGeneratedImage, 'is_favorite' | 'created_at' | 'expires_at' | 'version'> & Partial<Pick<HeavyGeneratedImage, 'is_favorite' | 'version' | 'expires_at'>>): Promise<HeavyGeneratedImage> {
    return this.readJson<HeavyGeneratedImage>(await this.authenticatedRequest('/v1/generated-images', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }));
  }

  async setGeneratedImageFavorite(imageId: string, isFavorite: boolean): Promise<HeavyGeneratedImage> {
    return this.readJson<HeavyGeneratedImage>(await this.authenticatedRequest(`/v1/generated-images/${encodeURIComponent(imageId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_favorite: isFavorite }),
    }));
  }

  async deleteGeneratedImage(imageId: string): Promise<void> {
    await this.authenticatedRequest(`/v1/generated-images/${encodeURIComponent(imageId)}`, { method: 'DELETE' });
  }

  async uploadGeneratedImageContent(imageId: string, body: BodyInit, contentType: string): Promise<{ id: string; state: string; storedSizeBytes: number }> {
    return this.readJson<{ id: string; state: string; storedSizeBytes: number }>(await this.authenticatedRequest(
      `/v1/generated-images/${encodeURIComponent(imageId)}/content`,
      { method: 'PUT', headers: { 'content-type': contentType }, body },
    ));
  }

  async readGeneratedImageContent(imageId: string): Promise<Response> {
    const response = await this.authenticatedRequest(`/v1/generated-images/${encodeURIComponent(imageId)}/content`);
    if (!response.ok) throw new Error(`Heavy generated image read failed with status ${response.status}`);
    return response;
  }

  async listCanvasDocuments(brandId: string): Promise<HeavyCanvasDocument[]> {
    return this.readJson<HeavyCanvasDocument[]>(await this.authenticatedRequest(
      `/v1/canvas-documents?brand_id=${encodeURIComponent(brandId)}`,
    ));
  }

  async createCanvasDocument(input: { id?: string; brand_id: string; title?: string; snapshot?: Record<string, unknown> }): Promise<HeavyCanvasDocument> {
    return this.readJson<HeavyCanvasDocument>(await this.authenticatedRequest('/v1/canvas-documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }));
  }

  async updateCanvasDocument(documentId: string, input: { expected_revision: number; title?: string; snapshot: Record<string, unknown> }): Promise<HeavyCanvasDocument> {
    return this.readJson<HeavyCanvasDocument>(await this.authenticatedRequest(`/v1/canvas-documents/${encodeURIComponent(documentId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }));
  }

  async deleteCanvasDocument(documentId: string): Promise<void> {
    await this.authenticatedRequest(`/v1/canvas-documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
  }

  private async authenticatedRequest(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${await this.tokenProvider()}`);
    return this.fetcher(`${this.baseUrl}${path}`, { ...init, headers });
  }

  private async readJson<T>(response: Response): Promise<T> {
    if (!response.ok) {
      throw new Error(`Heavy media request failed with status ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
