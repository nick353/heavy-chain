import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest, type Env, type TokenIdentity } from "../src/index.ts";

type Row = Record<string, unknown>;

class Statement {
  private values: unknown[] = [];
  private readonly db: CoreDb;
  private readonly sql: string;
  constructor(db: CoreDb, sql: string) {
    this.db = db;
    this.sql = sql;
  }
  bind(...values: unknown[]): this { this.values = values; return this; }
  first<T>(): Promise<T | null> { return Promise.resolve(this.db.first<T>(this.sql, this.values)); }
  all<T>(): Promise<{ results: T[] }> { return Promise.resolve({ results: this.db.all<T>(this.sql, this.values) }); }
  run(): Promise<{ meta: { changes: number } }> { return Promise.resolve(this.db.run(this.sql, this.values)); }
}

class CoreDb {
  identities = new Map<string, string>();
  brands = new Map<string, Row>();
  members: Row[] = [];
  jobs = new Map<string, Row>();
  images = new Map<string, Row>();
  canvas = new Map<string, Row>();
  folders = new Map<string, Row>();
  imageFolders: Row[] = [];
  tags = new Map<string, Row>();
  imageTags: Row[] = [];
  stylePresets = new Map<string, Row>();
  users = new Map<string, Row>();
  invitations = new Map<string, Row>();
  shareLinks = new Map<string, Row>();

  prepare(sql: string): Statement { return new Statement(this, sql); }

  first<T>(sql: string, values: unknown[]): T | null {
    const normalized = sql.toLowerCase().replace(/\s+/g, " ");
    if (normalized.includes('from heavy_ai_requests')) return null;
    if (normalized.includes("from user_identities")) {
      const principal = this.identities.get(`${values[0]}:${values[1]}`);
      return (principal ? { principal_id: principal } : null) as T | null;
    }
    if (normalized.includes("from invitations")) {
      const key = String(values[0]);
      const row = [...this.invitations.values()].find((candidate) =>
        (normalized.includes("code = ?") ? candidate.code === key : candidate.id === key));
      return (row ?? null) as T | null;
    }
    if (normalized.includes("from share_links")) {
      const row = [...this.shareLinks.values()].find((candidate) => candidate.token === String(values[0]));
      return (row ?? null) as T | null;
    }
    if (normalized.includes("from users")) {
      return (this.users.get(String(values[0])) ?? null) as T | null;
    }
    if (normalized.includes("from brand_members")) {
      const row = this.members.find((member) => member.brand_id === String(values[0]) && member.user_id === String(values[1]) && member.joined_at !== null);
      return row ? { user_id: row.user_id } as T : null;
    }
    if (normalized.includes("from brands b join users")) {
      const brand = this.brands.get(String(values[0]));
      const user = brand ? this.users.get(String(brand.owner_id)) : null;
      return brand && user ? {
        user_id: brand.owner_id,
        role: "owner",
        joined_at: brand.created_at ?? "2026-01-01T00:00:00.000Z",
        profile_id: user.id,
        name: user.name,
        email: user.email,
        avatar_url: user.avatar_url,
      } as T : null;
    }
    if (normalized.includes("from brands")) {
      const userID = String(values[0]);
      const brandID = String(values[2]);
      const brand = this.brands.get(brandID);
      if (!brand || (brand.owner_id !== userID && !this.members.some((member) =>
        member.brand_id === brandID && member.user_id === userID && member.joined_at !== null))) return null;
      return { role: brand.owner_id === userID ? "owner" : this.members.find((member) =>
        member.brand_id === brandID && member.user_id === userID)?.role ?? "viewer" } as T;
    }
    if (normalized.includes("from generation_jobs")) {
      const row = this.jobs.get(String(values[0]));
      if (!row) return null;
      if (normalized.includes("and brand_id = ?")) {
        return row.brand_id === String(values[1]) && row.user_id === String(values[2]) ? row as T : null;
      }
      return !normalized.includes("and user_id = ?") || row.user_id === String(values[1]) ? row as T : null;
    }
    if (normalized.includes("from generated_images")) {
      const row = this.images.get(String(values[0]));
      if (!row) return null;
      if (normalized.includes("and brand_id = ?")) {
        return row.brand_id === String(values[1]) && row.user_id === String(values[2]) ? row as T : null;
      }
      return !normalized.includes("and user_id = ?") || row.user_id === String(values[1]) ? row as T : null;
    }
    if (normalized.includes("from folders")) {
      return (this.folders.get(String(values[0])) ?? null) as T | null;
    }
    if (normalized.includes("from tags")) {
      return (this.tags.get(String(values[0])) ?? null) as T | null;
    }
    if (normalized.includes("from style_presets")) {
      return (this.stylePresets.get(String(values[0])) ?? null) as T | null;
    }
    if (normalized.includes("select brand_id from canvas_documents")) {
      const row = this.canvas.get(String(values[0]));
      return row ? { brand_id: row.brand_id } as T : null;
    }
    if (normalized.includes("from canvas_documents")) return (this.canvas.get(String(values[0])) ?? null) as T | null;
    throw new Error(`unexpected first SQL: ${sql}`);
  }

  all<T>(sql: string, values: unknown[]): T[] {
    const normalized = sql.toLowerCase().replace(/\s+/g, " ");
    if (normalized.includes("from brands b join users")) {
      const brand = this.brands.get(String(values[0]));
      const user = brand ? this.users.get(String(brand.owner_id)) : null;
      return brand && user ? [{
        user_id: brand.owner_id,
        role: "owner",
        joined_at: brand.created_at ?? "2026-01-01T00:00:00.000Z",
        profile_id: user.id,
        name: user.name,
        email: user.email,
        avatar_url: user.avatar_url,
      }] as T[] : [];
    }
    if (normalized.includes("from brand_members bm join users")) {
      return this.members
        .filter((member) => member.brand_id === String(values[0]) && member.joined_at !== null)
        .map((member) => {
          const user = this.users.get(String(member.user_id));
          return {
            user_id: member.user_id,
            role: member.role,
            joined_at: member.joined_at,
            profile_id: user?.id ?? member.user_id,
            name: user?.name ?? null,
            email: user?.email ?? "",
            avatar_url: user?.avatar_url ?? null,
          };
        }) as T[];
    }
    if (normalized.includes("from invitations")) {
      const now = String(values[1]);
      return [...this.invitations.values()]
        .filter((invitation) => invitation.brand_id === String(values[0]) && invitation.used_at === null && String(invitation.expires_at) > now)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) as T[];
    }
    if (normalized.includes("from generation_jobs")) {
      return [...this.jobs.values()].filter((row) => row.brand_id === String(values[0]) && row.user_id === String(values[1])) as T[];
    }
    if (normalized.includes("from generated_images")) {
      const favorite = normalized.includes("is_favorite = ?") ? Number(values[2]) : null;
      return [...this.images.values()].filter((row) => row.brand_id === String(values[0]) && row.user_id === String(values[1]) &&
        (favorite === null || row.is_favorite === favorite)) as T[];
    }
    if (normalized.includes("from image_folders")) {
      const brandID = String(values[0]);
      const folderIDs = new Set([...this.folders.values()]
        .filter((folder) => folder.brand_id === brandID)
        .map((folder) => String(folder.id)));
      return this.imageFolders.filter((row) => folderIDs.has(String(row.folder_id))) as T[];
    }
    if (normalized.includes("from image_tags")) {
      return this.imageTags.filter((row) => row.image_id === String(values[0])) as T[];
    }
    if (normalized.includes("from tags")) {
      return [...this.tags.values()].filter((row) => row.brand_id === String(values[0])) as T[];
    }
    if (normalized.includes("from style_presets")) {
      return [...this.stylePresets.values()].filter((row) => row.brand_id === String(values[0])) as T[];
    }
    if (normalized.includes("from folders")) {
      return [...this.folders.values()].filter((row) => row.brand_id === String(values[0])) as T[];
    }
    if (normalized.includes("from canvas_documents")) {
      return [...this.canvas.values()].filter((row) => row.brand_id === String(values[0])) as T[];
    }
    throw new Error(`unexpected all SQL: ${sql}`);
  }

  run(sql: string, values: unknown[]): { meta: { changes: number } } {
    const normalized = sql.toLowerCase().replace(/\s+/g, " ");
    if (normalized.startsWith("insert into generation_jobs")) {
      const [id, brandID, userID, featureType, inputParams, prompt, status, createdAt] = values;
      this.jobs.set(String(id), {
        id, brand_id: brandID, user_id: userID, feature_type: featureType, input_params: inputParams,
        optimized_prompt: prompt, status, error_message: null, created_at: createdAt, completed_at: null,
      });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("insert into invitations")) {
      const [id, brandID, creatorID, email, code, role, expiresAt, createdAt] = values;
      if (this.invitations.has(String(id)) || [...this.invitations.values()].some((invitation) => invitation.code === code)) {
        throw new Error("unique invitation");
      }
      this.invitations.set(String(id), {
        id, brand_id: brandID, creator_id: creatorID, email, code, role,
        expires_at: expiresAt, used_at: null, created_at: createdAt,
      });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("insert into share_links")) {
      const [id, imageID, createdBy, token, expiresAt, createdAt] = values;
      if (this.shareLinks.has(String(id)) || [...this.shareLinks.values()].some((share) => share.token === token)) {
        throw new Error("unique share link");
      }
      this.shareLinks.set(String(id), {
        id, image_id: imageID, created_by: createdBy, token, expires_at: expiresAt, created_at: createdAt,
      });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("delete from invitations")) {
      const [id, brandID] = values;
      const invitation = this.invitations.get(String(id));
      if (!invitation || invitation.brand_id !== String(brandID)) return { meta: { changes: 0 } };
      this.invitations.delete(String(id));
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("update invitations")) {
      const [usedAt, id] = values;
      const invitation = this.invitations.get(String(id));
      if (!invitation || invitation.used_at !== null) return { meta: { changes: 0 } };
      invitation.used_at = usedAt;
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("insert into brand_members")) {
      const [id, brandID, userID, role, invitedAt, joinedAt] = values;
      if (this.members.some((member) => member.brand_id === String(brandID) && member.user_id === String(userID))) {
        throw new Error("unique member");
      }
      this.members.push({ id, brand_id: brandID, user_id: userID, role, invited_at: invitedAt, joined_at: joinedAt });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("update brand_members")) {
      const [role, brandID, userID] = values;
      const member = this.members.find((candidate) => candidate.brand_id === String(brandID) && candidate.user_id === String(userID) && candidate.joined_at !== null);
      if (!member) return { meta: { changes: 0 } };
      member.role = role;
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("delete from brand_members")) {
      const [brandID, userID] = values;
      const before = this.members.length;
      this.members = this.members.filter((member) => !(member.brand_id === String(brandID) && member.user_id === String(userID)));
      return { meta: { changes: before === this.members.length ? 0 : 1 } };
    }
    if (normalized.startsWith("update generation_jobs")) {
      const [status, errorMessage, completedAt, id, userID] = values;
      const row = this.jobs.get(String(id));
      if (!row || row.user_id !== String(userID)) return { meta: { changes: 0 } };
      Object.assign(row, { status, error_message: errorMessage, completed_at: completedAt });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("insert into generated_images")) {
      const [id, jobID, brandID, userID, storagePath, thumbnailPath, version, parentID, favorite,
        prompt, negativePrompt, featureType, stylePreset, modelUsed, generationParams, metadata, imageURL, createdAt, expiresAt] = values;
      this.images.set(String(id), {
        id, job_id: jobID, brand_id: brandID, user_id: userID, storage_path: storagePath,
        thumbnail_path: thumbnailPath, version, parent_image_id: parentID, is_favorite: favorite,
        prompt, negative_prompt: negativePrompt, feature_type: featureType, style_preset: stylePreset,
        model_used: modelUsed, generation_params: generationParams, metadata, image_url: imageURL,
        created_at: createdAt, expires_at: expiresAt,
      });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("update generated_images")) {
      if (normalized.includes("metadata = ?")) {
        const [metadata, id, userID] = values;
        const row = this.images.get(String(id));
        if (!row || row.user_id !== String(userID)) return { meta: { changes: 0 } };
        row.metadata = metadata;
        return { meta: { changes: 1 } };
      }
      const [favorite, id, userID] = values;
      const row = this.images.get(String(id));
      if (!row || row.user_id !== String(userID)) return { meta: { changes: 0 } };
      row.is_favorite = favorite;
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("delete from generated_images")) {
      const row = this.images.get(String(values[0]));
      if (!row || row.user_id !== String(values[1])) return { meta: { changes: 0 } };
      this.images.delete(String(values[0]));
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("insert into folders")) {
      const [id, brandID, parentID, name, createdAt] = values;
      this.folders.set(String(id), { id, brand_id: brandID, parent_folder_id: parentID, name, created_at: createdAt });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("update folders")) {
      const [name, parentID, id, brandID] = values;
      const row = this.folders.get(String(id));
      if (!row || row.brand_id !== String(brandID)) return { meta: { changes: 0 } };
      Object.assign(row, { name, parent_folder_id: parentID });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("delete from folders")) {
      const id = String(values[0]);
      const brandID = String(values[1]);
      const row = this.folders.get(id);
      if (!row || row.brand_id !== brandID) return { meta: { changes: 0 } };
      const deleted = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const folder of this.folders.values()) {
          if (folder.parent_folder_id && deleted.has(String(folder.parent_folder_id)) && !deleted.has(String(folder.id))) {
            deleted.add(String(folder.id));
            changed = true;
          }
        }
      }
      deleted.forEach((folderID) => this.folders.delete(folderID));
      this.imageFolders = this.imageFolders.filter((membership) => !deleted.has(String(membership.folder_id)));
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("insert into tags")) {
      const [id, brandID, name, createdAt] = values;
      if ([...this.tags.values()].some((tag) => tag.brand_id === String(brandID) && tag.name === String(name))) {
        throw new Error("unique tag");
      }
      this.tags.set(String(id), { id, brand_id: brandID, name, created_at: createdAt });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("delete from tags")) {
      const [id, brandID] = values;
      const tag = this.tags.get(String(id));
      if (!tag || tag.brand_id !== String(brandID)) return { meta: { changes: 0 } };
      this.tags.delete(String(id));
      this.imageTags = this.imageTags.filter((row) => row.tag_id !== String(id));
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("insert into image_tags")) {
      const [imageID, tagID] = values;
      if (this.imageTags.some((row) => row.image_id === String(imageID) && row.tag_id === String(tagID))) {
        throw new Error("unique image tag");
      }
      this.imageTags.push({ image_id: imageID, tag_id: tagID });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("delete from image_tags")) {
      const [imageID, tagID] = values;
      const before = this.imageTags.length;
      this.imageTags = this.imageTags.filter((row) => !(row.image_id === String(imageID) && row.tag_id === String(tagID)));
      return { meta: { changes: before === this.imageTags.length ? 0 : 1 } };
    }
    if (normalized.startsWith("insert into style_presets")) {
      const [id, brandID, name, promptTemplate, settings, createdAt, updatedAt] = values;
      if (this.stylePresets.has(String(id))) throw new Error("unique style preset");
      this.stylePresets.set(String(id), {
        id, brand_id: brandID, name, prompt_template: promptTemplate, settings,
        created_at: createdAt, updated_at: updatedAt,
      });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("update style_presets")) {
      const [name, promptTemplate, settings, updatedAt, id, brandID] = values;
      const row = this.stylePresets.get(String(id));
      if (!row || row.brand_id !== String(brandID)) return { meta: { changes: 0 } };
      Object.assign(row, { name, prompt_template: promptTemplate, settings, updated_at: updatedAt });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("delete from style_presets")) {
      const [id, brandID] = values;
      const row = this.stylePresets.get(String(id));
      if (!row || row.brand_id !== String(brandID)) return { meta: { changes: 0 } };
      this.stylePresets.delete(String(id));
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("insert into canvas_documents")) {
      const [id, ownerID, brandID, title, snapshot, createdAt, updatedAt] = values;
      this.canvas.set(String(id), {
        id, owner_id: ownerID, brand_id: brandID, title, snapshot,
        snapshot_version: 1, revision: 0, created_at: createdAt, updated_at: updatedAt,
      });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("update canvas_documents")) {
      const [title, snapshot, updatedAt, id, brandID, expectedRevision] = values;
      const row = this.canvas.get(String(id));
      if (!row || row.brand_id !== String(brandID) || row.revision !== expectedRevision) return { meta: { changes: 0 } };
      Object.assign(row, { title, snapshot, revision: Number(row.revision) + 1, updated_at: updatedAt });
      return { meta: { changes: 1 } };
    }
    if (normalized.startsWith("delete from canvas_documents")) {
      const row = this.canvas.get(String(values[0]));
      if (!row || row.owner_id !== String(values[1])) return { meta: { changes: 0 } };
      this.canvas.delete(String(values[0]));
      return { meta: { changes: 1 } };
    }
    throw new Error(`unexpected run SQL: ${sql}`);
  }
}

class CoreR2 {
  private readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(key: string, body: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<void> {
    this.objects.set(key, {
      bytes: new Uint8Array(body),
      contentType: options?.httpMetadata?.contentType ?? "application/octet-stream",
    });
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: new Response(object.bytes.buffer as ArrayBuffer).body!,
      httpEtag: '"core-test-etag"',
      httpMetadata: { contentType: object.contentType },
    } as R2ObjectBody;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }
}

function identityFor(request: Request): TokenIdentity | null {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return token ? { issuer: "test-issuer", subject: token } : null;
}

function env(db: CoreDb, r2 = new CoreR2()): Env {
  return {
    DB: db as unknown as D1Database,
    PRIVATE_MEDIA: r2 as unknown as R2Bucket,
    MEDIA_TOKEN_VERIFIER: identityFor,
    MEDIA_READ_SECRET: "local-heavy-media-read-secret-32-bytes-min",
  };
}

function request(method: string, path: string, token: string, body?: unknown): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`https://heavy.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T>(response: Response): Promise<T> { return await response.json() as T; }

function seed(db: CoreDb, userID: string): void {
  db.identities.set(`test-issuer:${userID}`, userID);
  db.users.set(userID, {
    id: userID,
    email: `${userID}@example.com`,
    name: userID === "alice" ? "Alice" : "Bob",
    avatar_url: null,
  });
  db.brands.set("brand-1", { id: "brand-1", owner_id: "alice" });
}

test("generation jobs and images remain owner-scoped", async () => {
  const db = new CoreDb();
  seed(db, "alice");
  seed(db, "bob");
  const environment = env(db);
  const job = await handleRequest(request("POST", "/v1/generation-jobs", "alice", {
    id: "job-1", brand_id: "brand-1", feature_type: "ai-fitting", input_params: { prompt: "shirt" },
  }), environment);
  assert.equal(job.status, 200);
  assert.equal((await json<{ id: string }>(job)).id, "job-1");
  assert.equal((await handleRequest(request("GET", "/v1/generation-jobs?brand_id=brand-1", "bob"), environment)).status, 403);

  const image = await handleRequest(request("POST", "/v1/generated-images", "alice", {
    id: "image-1", brand_id: "brand-1", job_id: "job-1", storage_path: "generated-images/image-1.png",
    metadata: { source: "test" },
  }), environment);
  assert.equal(image.status, 200);
  db.jobs.set("job-foreign", { id: "job-foreign", brand_id: "brand-1", user_id: "bob" });
  assert.equal((await handleRequest(request("POST", "/v1/generated-images", "alice", {
    id: "image-foreign-job", brand_id: "brand-1", job_id: "job-foreign", storage_path: "generated-images/foreign.png",
  }), environment)).status, 400);
  db.images.set("image-foreign", { id: "image-foreign", brand_id: "brand-1", user_id: "bob" });
  assert.equal((await handleRequest(request("POST", "/v1/generated-images", "alice", {
    id: "image-foreign-parent", brand_id: "brand-1", parent_image_id: "image-foreign", storage_path: "generated-images/foreign-parent.png",
  }), environment)).status, 400);
  assert.equal((await handleRequest(request("PATCH", "/v1/generated-images/image-1", "alice", { is_favorite: true }), environment)).status, 200);
  assert.equal((await handleRequest(request("GET", "/v1/generated-images/image-1", "bob"), environment)).status, 404);
});

test("generated image library titles persist in metadata and remain owner-scoped", async () => {
  const db = new CoreDb();
  seed(db, "alice");
  seed(db, "bob");
  const environment = env(db);
  const created = await handleRequest(request("POST", "/v1/generated-images", "alice", {
    id: "image-title", brand_id: "brand-1", storage_path: "generated-images/image-title", metadata: { source: "test" },
  }), environment);
  assert.equal(created.status, 200);
  const updated = await handleRequest(request("PATCH", "/v1/generated-images/image-title", "alice", { library_title: "保存した名称" }), environment);
  assert.equal(updated.status, 200);
  assert.equal((await json<{ metadata: { libraryTitle: string } }>(updated)).metadata.libraryTitle, "保存した名称");
  assert.equal((await handleRequest(request("PATCH", "/v1/generated-images/image-title", "bob", { library_title: "他人の名称" }), environment)).status, 404);
});

test("folders and image memberships remain brand-scoped and reject cycles", async () => {
  const db = new CoreDb();
  seed(db, "alice");
  seed(db, "bob");
  db.images.set("image-1", { id: "image-1", brand_id: "brand-1", user_id: "alice" });
  const environment = env(db);

  const root = await handleRequest(request("POST", "/v1/folders", "alice", {
    id: "folder-root", brand_id: "brand-1", name: "Root",
  }), environment);
  assert.equal(root.status, 201);
  const child = await handleRequest(request("POST", "/v1/folders", "alice", {
    id: "folder-child", brand_id: "brand-1", parent_folder_id: "folder-root", name: "Child",
  }), environment);
  assert.equal(child.status, 201);
  db.imageFolders.push({ image_id: "image-1", folder_id: "folder-child" });

  const listed = await handleRequest(request("GET", "/v1/folders?brand_id=brand-1", "alice"), environment);
  assert.equal(listed.status, 200);
  assert.equal((await json<unknown[]>(listed)).length, 2);
  const memberships = await handleRequest(request("GET", "/v1/image-folders?brand_id=brand-1", "alice"), environment);
  assert.deepEqual(await json<unknown[]>(memberships), [{ image_id: "image-1", folder_id: "folder-child" }]);
  assert.equal((await handleRequest(request("GET", "/v1/folders?brand_id=brand-1", "bob"), environment)).status, 403);
  assert.equal((await handleRequest(request("PATCH", "/v1/folders/folder-child", "alice", {
    name: "Renamed",
  }), environment)).status, 200);
  assert.equal((await handleRequest(request("PATCH", "/v1/folders/folder-root", "alice", {
    parent_folder_id: "folder-child",
  }), environment)).status, 400);
  assert.equal((await handleRequest(request("DELETE", "/v1/folders/folder-root", "alice"), environment)).status, 204);
  assert.equal(db.folders.size, 0);
  assert.equal(db.imageFolders.length, 0);
});

test("tags and image tags remain brand-scoped and owner-scoped", async () => {
  const db = new CoreDb();
  seed(db, "alice");
  seed(db, "bob");
  db.images.set("image-tagged", { id: "image-tagged", brand_id: "brand-1", user_id: "alice" });
  const environment = env(db);

  const created = await handleRequest(request("POST", "/v1/tags", "alice", {
    id: "tag-1", brand_id: "brand-1", name: "Campaign",
  }), environment);
  assert.equal(created.status, 201);
  const createdPayload = await json<{ id: string; created_at: string }>(created);
  assert.equal(createdPayload.id, "tag-1");

  const listed = await handleRequest(request("GET", "/v1/tags?brand_id=brand-1", "alice"), environment);
  assert.deepEqual(await json<Array<{ id: string; brand_id: string; name: string; created_at: string }>>(listed), [{ id: "tag-1", brand_id: "brand-1", name: "Campaign", created_at: createdPayload.created_at }]);
  assert.equal((await handleRequest(request("GET", "/v1/tags?brand_id=brand-1", "bob"), environment)).status, 403);

  const attached = await handleRequest(request("POST", "/v1/image-tags", "alice", {
    image_id: "image-tagged", tag_id: "tag-1",
  }), environment);
  assert.equal(attached.status, 201);
  const imageTags = await handleRequest(request("GET", "/v1/image-tags?image_id=image-tagged", "alice"), environment);
  assert.deepEqual(await json<string[]>(imageTags), ["tag-1"]);
  assert.equal((await handleRequest(request("GET", "/v1/image-tags?image_id=image-tagged", "bob"), environment)).status, 404);

  const detached = await handleRequest(new Request("https://heavy.test/v1/image-tags?image_id=image-tagged&tag_id=tag-1", {
    method: "DELETE", headers: { authorization: "Bearer alice" },
  }), environment);
  assert.equal(detached.status, 204);
  assert.equal((await handleRequest(request("DELETE", "/v1/tags/tag-1", "alice"), environment)).status, 204);
  assert.equal(db.tags.size, 0);
});

test("style presets remain brand-scoped and editor-managed", async () => {
  const db = new CoreDb();
  seed(db, "alice");
  seed(db, "bob");
  const environment = env(db);

  const created = await handleRequest(request("POST", "/v1/style-presets", "alice", {
    id: "preset-1", brand_id: "brand-1", name: "Campaign", prompt_template: "{prompt}, studio light",
    settings: { style: "editorial", aspectRatio: "4:5" },
  }), environment);
  assert.equal(created.status, 201);
  const createdPayload = await json<{ id: string; settings: { style: string } }>(created);
  assert.equal(createdPayload.id, "preset-1");
  assert.equal(createdPayload.settings.style, "editorial");

  const listed = await handleRequest(request("GET", "/v1/style-presets?brand_id=brand-1", "alice"), environment);
  assert.equal((await json<Array<{ id: string }>>(listed))[0].id, "preset-1");
  assert.equal((await handleRequest(request("GET", "/v1/style-presets?brand_id=brand-1", "bob"), environment)).status, 403);

  const updated = await handleRequest(request("PATCH", "/v1/style-presets/preset-1", "alice", {
    name: "Updated", settings: { style: "minimal" },
  }), environment);
  assert.equal(updated.status, 200);
  assert.equal((await json<{ name: string; settings: { style: string } }>(updated)).name, "Updated");
  assert.equal((await handleRequest(request("DELETE", "/v1/style-presets/preset-1", "bob"), environment)).status, 403);
  assert.equal((await handleRequest(request("DELETE", "/v1/style-presets/preset-1", "alice"), environment)).status, 204);
  assert.equal(db.stylePresets.size, 0);
});

test("team management keeps owner and invitation operations manager-scoped", async () => {
  const db = new CoreDb();
  seed(db, "alice");
  seed(db, "bob");
  seed(db, "charlie");
  db.members.push({
    id: "member-bob", brand_id: "brand-1", user_id: "bob", role: "editor",
    invited_at: "2026-01-01T00:00:00.000Z", joined_at: "2026-01-01T00:00:00.000Z",
  });
  const environment = env(db);

  const listedMembers = await handleRequest(request("GET", "/v1/brands/brand-1/members", "alice"), environment);
  assert.equal(listedMembers.status, 200);
  const memberPayloads = await json<Array<{ user_id: string; role: string; user: { email: string } }>>(listedMembers);
  assert.deepEqual(memberPayloads.map((member) => [member.user_id, member.role]), [
    ["alice", "owner"], ["bob", "editor"],
  ]);
  assert.equal(memberPayloads[1]?.user.email, "bob@example.com");
  assert.equal((await handleRequest(request("GET", "/v1/brands/brand-1/invitations", "bob"), environment)).status, 403);

  const created = await handleRequest(request("POST", "/v1/brands/brand-1/invitations", "alice", {
    id: "invite-charlie", brand_id: "brand-1", email: "charlie@example.com", role: "viewer",
  }), environment);
  assert.equal(created.status, 201);
  const invite = await json<{ code: string; expires_at: string }>(created);
  assert.match(invite.code, /^[A-Z0-9]{20}$/);
  assert.ok(new Date(invite.expires_at).getTime() > Date.now());

  const pending = await handleRequest(request("GET", "/v1/brands/brand-1/invitations", "alice"), environment);
  assert.equal((await json<Array<{ id: string }>>(pending))[0]?.id, "invite-charlie");
  assert.equal((await handleRequest(request("PATCH", "/v1/brands/brand-1/members/bob", "alice", { role: "admin" }), environment)).status, 200);
  assert.equal(db.members.find((member) => member.user_id === "bob")?.role, "admin");
  assert.equal((await handleRequest(request("DELETE", "/v1/brands/brand-1/members/bob", "alice"), environment)).status, 204);
  assert.equal((await handleRequest(request("PATCH", "/v1/brands/brand-1/members/alice", "alice", { role: "viewer" }), environment)).status, 404);

  const accepted = await handleRequest(request("POST", `/v1/invitations/${invite.code}/accept`, "charlie"), environment);
  assert.equal(accepted.status, 201);
  assert.equal((await json<{ role: string }>(accepted)).role, "viewer");
  assert.equal(db.members.find((member) => member.user_id === "charlie")?.role, "viewer");
  assert.equal((await handleRequest(request("GET", "/v1/brands/brand-1/invitations", "alice"), environment)).status, 200);
  assert.deepEqual(await json<unknown[]>(await handleRequest(request("GET", "/v1/brands/brand-1/invitations", "alice"), environment)), []);

  const revocable = await handleRequest(request("POST", "/v1/brands/brand-1/invitations", "alice", {
    id: "invite-revocable", brand_id: "brand-1", role: "editor",
  }), environment);
  assert.equal(revocable.status, 201);
  assert.equal((await handleRequest(request("DELETE", "/v1/invitations/invite-revocable", "alice"), environment)).status, 204);
  assert.equal((await handleRequest(request("GET", "/v1/brands/brand-1/members", "bob"), environment)).status, 403);
});

test("retired arbitrary provider proxy cannot forward user credentials", async () => {
  const db = new CoreDb();
  seed(db, "alice");
  seed(db, "bob");
  const environment = env(db);
  const unavailable = await handleRequest(request("POST", "/v1/provider-actions/generate-image", "alice", {
    brandId: "brand-1", prompt: "shirt", legalSafety: { rightsConfirmed: true },
  }), environment);
  assert.equal(unavailable.status, 400);
  assert.equal((await json<{ error: string }>(unavailable)).error, "image_request_id_required");
  assert.equal((await handleRequest(request("POST", "/v1/provider-actions/generate-image", "bob", {
    brandId: "brand-1", prompt: "shirt", legalSafety: { rightsConfirmed: true },
  }), environment)).status, 403);

  const forwarded: { url: string; authorization: string | null } = { url: "", authorization: null };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    forwarded.url = String(input);
    forwarded.authorization = new Headers(init?.headers).get("authorization");
    return new Response(JSON.stringify({ success: true, jobId: "job-provider" }), { status: 200 });
  }) as typeof fetch;
  try {
    const input = request("POST", "/v1/provider-actions/generate-image", "alice", {
      brandId: "brand-1", prompt: "shirt", legalSafety: { rightsConfirmed: true },
    });
    input.headers.set('Idempotency-Key',crypto.randomUUID());
    const configured = await handleRequest(input,environment);
    assert.equal(configured.status,503);
    assert.equal((await json<{error:string}>(configured)).error,'image_ai_not_enabled');
    assert.equal(forwarded.url, '');
    assert.equal(forwarded.authorization, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("share links are opt-in, editor-created, expiry-bound, and serve private R2 bytes", async () => {
  const db = new CoreDb();
  seed(db, "alice");
  seed(db, "bob");
  const r2 = new CoreR2();
  const environment = {
    ...env(db, r2),
    PUBLIC_SHARE_ENABLED: "true",
    PUBLIC_APP_ORIGIN: "https://app.example/",
  };
  db.images.set("image-share", {
    id: "image-share", brand_id: "brand-1", user_id: "alice", storage_path: "generated-images/legacy.png",
    prompt: "studio shirt", negative_prompt: null, feature_type: "generate-image", style_preset: null,
    model_used: "provider", generation_params: JSON.stringify({ aspectRatio: "4:5" }),
    metadata: JSON.stringify({ source: "share-test" }), created_at: "2026-09-04T00:00:00.000Z",
  });
  const bytes = new Uint8Array([137, 80, 78, 71]);
  await r2.put("generated-images/image-share", bytes.buffer as ArrayBuffer, { httpMetadata: { contentType: "image/png" } });

  const created = await handleRequest(request("POST", "/v1/share-links", "alice", {
    imageId: "image-share", expiresInDays: 2,
  }), environment);
  assert.equal(created.status, 201);
  const createdPayload = await json<{ success: boolean; shareUrl: string; token: string; expiresAt: string }>(created);
  assert.equal(createdPayload.success, true);
  assert.match(createdPayload.shareUrl, /^https:\/\/app\.example\/share\/[A-Za-z0-9]{32}$/);
  assert.ok(new Date(createdPayload.expiresAt).getTime() > Date.now());

  const publicRead = await handleRequest(request("GET", `/v1/shared-images?token=${createdPayload.token}`, ""), environment);
  assert.equal(publicRead.status, 200);
  const publicPayload = await json<{
    success: boolean;
    image: { imageUrl: string; prompt: string; metadata: { source: string } };
    share: { token: string };
  }>(publicRead);
  assert.equal(publicPayload.image.prompt, "studio shirt");
  assert.equal(publicPayload.image.metadata.source, "share-test");
  assert.equal(publicPayload.share.token, createdPayload.token);

  const content = await handleRequest(new Request(publicPayload.image.imageUrl), environment);
  assert.equal(content.status, 200);
  assert.equal(content.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await content.arrayBuffer()), bytes);
  assert.equal((await handleRequest(request("POST", "/v1/share-links", "bob", { imageId: "image-share" }), environment)).status, 403);

  [...db.shareLinks.values()].find((share) => share.token === createdPayload.token)!.expires_at = "2020-01-01T00:00:00.000Z";
  assert.equal((await handleRequest(request("GET", `/v1/shared-images?token=${createdPayload.token}`, ""), environment)).status, 410);
  assert.equal((await handleRequest(request("GET", `/v1/shared-images/${createdPayload.token}/content`, ""), environment)).status, 410);
  assert.equal((await handleRequest(request("POST", "/v1/share-links", "alice", { imageId: "image-share" }), env(db, r2))).status, 403);
});

test("generated image content is private R2 and owner-scoped", async () => {
  const db = new CoreDb();
  seed(db, "alice");
  seed(db, "bob");
  const r2 = new CoreR2();
  const environment = env(db, r2);
  const image = await handleRequest(request("POST", "/v1/generated-images", "alice", {
    id: "image-content", brand_id: "brand-1", storage_path: "alice/image-content.png",
  }), environment);
  assert.equal(image.status, 200);

  const content = new Uint8Array([137, 80, 78, 71]);
  const upload = await handleRequest(new Request("https://heavy.test/v1/generated-images/image-content/content", {
    method: "PUT",
    headers: { authorization: "Bearer alice", "content-type": "image/png" },
    body: content.buffer as ArrayBuffer,
  }), environment);
  assert.equal(upload.status, 200);
  assert.deepEqual(await (await json<{ storedSizeBytes: number }>(upload)).storedSizeBytes, content.byteLength);

  const denied = await handleRequest(request("GET", "/v1/generated-images/image-content/content", "bob"), environment);
  assert.equal(denied.status, 404);
  const read = await handleRequest(request("GET", "/v1/generated-images/image-content/content", "alice"), environment);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await read.arrayBuffer()), content);

  const gateway = await handleRequest(new Request(
    "https://heavy.test/v1/media/read?bucket=generated-images&path=generated-images/image-content&expiresIn=300",
    { headers: { authorization: "Bearer alice" } },
  ), environment);
  assert.equal(gateway.status, 200);
  const gatewayPayload = await json<{ provider: string; bucket: string; objectPath: string; url: string }>(gateway);
  assert.deepEqual(
    { provider: gatewayPayload.provider, bucket: gatewayPayload.bucket, objectPath: gatewayPayload.objectPath },
    { provider: "cloudflare_r2", bucket: "generated-images", objectPath: "generated-images/image-content" },
  );
  const browserRead = await handleRequest(new Request(gatewayPayload.url), environment);
  assert.equal(browserRead.status, 200);
  assert.deepEqual(new Uint8Array(await browserRead.arrayBuffer()), content);
  const tampered = new URL(gatewayPayload.url);
  tampered.searchParams.set("token", `${tampered.searchParams.get("token")!.slice(0, -1)}x`);
  assert.equal((await handleRequest(new Request(tampered), environment)).status, 401);

  const deleted = await handleRequest(request("DELETE", "/v1/generated-images/image-content", "alice"), environment);
  assert.equal(deleted.status, 204);
  assert.equal(r2.has("generated-images/image-content"), false);
  assert.equal((await handleRequest(request("GET", "/v1/generated-images/image-content/content", "alice"), environment)).status, 404);
});

test("canvas updates use an atomic revision and editor access", async () => {
  const db = new CoreDb();
  seed(db, "alice");
  seed(db, "bob");
  const environment = env(db);
  const created = await handleRequest(request("POST", "/v1/canvas-documents", "alice", {
    id: "canvas-1", brand_id: "brand-1", title: "Board", snapshot: { objects: [] },
  }), environment);
  assert.equal(created.status, 200);
  const updated = await handleRequest(request("PATCH", "/v1/canvas-documents/canvas-1", "alice", {
    expected_revision: 0, title: "Board v2", snapshot: { objects: [{ id: "a" }] },
  }), environment);
  assert.equal(updated.status, 200);
  assert.equal((await json<{ revision: number }>(updated)).revision, 1);
  const conflict = await handleRequest(request("PATCH", "/v1/canvas-documents/canvas-1", "alice", {
    expected_revision: 0, title: "stale", snapshot: { objects: [] },
  }), environment);
  assert.equal(conflict.status, 409);
  assert.equal((await handleRequest(request("GET", "/v1/canvas-documents/canvas-1", "bob"), environment)).status, 404);
});
