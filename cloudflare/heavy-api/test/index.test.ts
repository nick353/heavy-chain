import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest, type Env, type TokenIdentity } from "../src/index.ts";

interface StoredAsset {
  id: string;
  owner_issuer: string;
  owner_subject: string;
  client_request_id: string;
  object_key: string;
  content_type: string;
  declared_size_bytes: number;
  stored_size_bytes: number | null;
  checksum_sha256: string | null;
  state: "pending" | "ready" | "failed";
  created_at: string;
  updated_at: string;
}

class FakeStatement {
  private values: unknown[] = [];
  private readonly database: FakeD1;
  private readonly sql: string;

  constructor(database: FakeD1, sql: string) {
    this.database = database;
    this.sql = sql;
  }

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.database.first<T>(this.sql, this.values);
  }

  async run(): Promise<unknown> {
    return this.database.run(this.sql, this.values);
  }
}

class FakeD1 {
  readonly assets = new Map<string, StoredAsset>();
  failReadyUpdate = false;

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  first<T>(sql: string, values: unknown[]): T | null {
    const normalized = sql.toLowerCase().replace(/\s+/g, " ");
    let asset: StoredAsset | undefined;
    if (normalized.includes("client_request_id = ?")) {
      asset = [...this.assets.values()].find(
        (candidate) =>
          candidate.owner_issuer === values[0] &&
          candidate.owner_subject === values[1] &&
          candidate.client_request_id === values[2],
      );
    } else {
      asset = this.assets.get(String(values[0]));
      if (
        asset &&
        (asset.owner_issuer !== values[1] || asset.owner_subject !== values[2])
      ) {
        asset = undefined;
      }
    }
    return (asset ?? null) as T | null;
  }

  run(sql: string, values: unknown[]): unknown {
    const normalized = sql.toLowerCase().replace(/\s+/g, " ");
    if (normalized.startsWith("insert into media_assets")) {
      const [id, issuer, subject, clientRequestId, objectKey, contentType, declaredSize, createdAt, updatedAt] = values;
      const asset: StoredAsset = {
        id: String(id),
        owner_issuer: String(issuer),
        owner_subject: String(subject),
        client_request_id: String(clientRequestId),
        object_key: String(objectKey),
        content_type: String(contentType),
        declared_size_bytes: Number(declaredSize),
        stored_size_bytes: null,
        checksum_sha256: null,
        state: "pending",
        created_at: String(createdAt),
        updated_at: String(updatedAt),
      };
      this.assets.set(asset.id, asset);
      return { success: true };
    }

    const isReadyUpdate = normalized.includes("state = 'ready'");
    const isFailedUpdate = normalized.includes("state = 'failed'");
    if (isReadyUpdate && this.failReadyUpdate) throw new Error("forced metadata failure");
    if (isReadyUpdate) {
      const [storedSize, updatedAt, id, issuer, subject] = values;
      const asset = this.assets.get(String(id));
      if (asset && asset.owner_issuer === issuer && asset.owner_subject === subject) {
        asset.stored_size_bytes = Number(storedSize);
        asset.updated_at = String(updatedAt);
        asset.state = "ready";
      }
      return { success: true };
    }
    if (isFailedUpdate) {
      const [updatedAt, id, issuer, subject] = values;
      const asset = this.assets.get(String(id));
      if (asset && asset.owner_issuer === issuer && asset.owner_subject === subject) {
        asset.updated_at = String(updatedAt);
        asset.state = "failed";
      }
      return { success: true };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  }
}

class FakeR2 {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  failPut = false;

  async put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<void> {
    if (this.failPut) throw new Error("forced R2 failure");
    this.objects.set(key, {
      bytes: new Uint8Array(value),
      contentType: options?.httpMetadata?.contentType ?? "application/octet-stream",
    });
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const item = this.objects.get(key);
    if (!item) return null;
    return {
      body: new Response(item.bytes as unknown as BodyInit).body!,
      httpEtag: `"${key}"`,
    } as R2ObjectBody;
  }
}

function identityFor(request: Request): TokenIdentity | null {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (token === "alice") return { issuer: "test-issuer", subject: "alice" };
  if (token === "bob") return { issuer: "test-issuer", subject: "bob" };
  return null;
}

function makeEnv(withVerifier = true): { env: Env; db: FakeD1; r2: FakeR2 } {
  const db = new FakeD1();
  const r2 = new FakeR2();
  const env = {
    DB: db,
    PRIVATE_MEDIA: r2,
    ...(withVerifier ? { MEDIA_TOKEN_VERIFIER: identityFor } : {}),
  } as unknown as Env;
  return { env, db, r2 };
}

function request(
  method: string,
  path: string,
  options: { token?: string; body?: BodyInit; contentType?: string } = {},
): Request {
  const headers = new Headers();
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.contentType) headers.set("content-type", options.contentType);
  return new Request(`https://heavy.test${path}`, {
    method,
    headers,
    body: method === "GET" ? undefined : options.body,
  });
}

async function allocate(env: Env, token = "alice", clientRequestId = "req-1"): Promise<{ id: string; response: Response }> {
  const response = await handleRequest(
    request("POST", "/v1/media", {
      token,
      contentType: "application/json",
      body: JSON.stringify({ clientRequestId, contentType: "image/png", declaredSizeBytes: 3 }),
    }),
    env,
  );
  const payload = (await response.json()) as { id: string };
  return { id: payload.id, response };
}

test("health is public and reports the isolated service", async () => {
  const { env } = makeEnv();
  const response = await handleRequest(request("GET", "/v1/health"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "heavy-api", media: "private-r2" });
});

test("browser CORS is exact-origin and supports authenticated preflight", async () => {
  const { env } = makeEnv();
  env.FRONTEND_ORIGINS = "https://app.example,https://admin.example";
  const healthRequest = new Request("https://heavy.test/v1/health", {
    headers: { Origin: "https://app.example" },
  });
  const health = await handleRequest(healthRequest, env);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("access-control-allow-origin"), "https://app.example");
  assert.equal(health.headers.get("access-control-allow-credentials"), "true");

  const preflight = await handleRequest(new Request("https://heavy.test/v1/profile", {
    method: "OPTIONS",
    headers: {
      Origin: "https://app.example",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    },
  }), env);
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /GET/);
  assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /authorization/);

  const denied = await handleRequest(new Request("https://heavy.test/v1/health", {
    headers: { Origin: "https://evil.example" },
  }), env);
  assert.equal(denied.status, 200);
  assert.equal(denied.headers.has("access-control-allow-origin"), false);
  assert.equal((await handleRequest(new Request("https://heavy.test/v1/profile", {
    method: "OPTIONS", headers: { Origin: "https://evil.example" },
  }), env)).status, 403);
});

test("media access fails closed without credentials or a verifier", async () => {
  const missingCredentials = await handleRequest(request("POST", "/v1/media"), makeEnv().env);
  assert.equal(missingCredentials.status, 401);

  const noVerifier = makeEnv(false).env;
  const response = await handleRequest(request("POST", "/v1/media", { token: "alice" }), noVerifier);
  assert.equal(response.status, 503);
});

test("allocation validates input and is idempotent per owner request", async () => {
  const { env, db } = makeEnv();
  const invalid = await handleRequest(
    request("POST", "/v1/media", {
      token: "alice",
      contentType: "application/json",
      body: JSON.stringify({ clientRequestId: "bad", contentType: "text/plain", declaredSizeBytes: 3 }),
    }),
    env,
  );
  assert.equal(invalid.status, 400);

  const first = await allocate(env);
  const second = await allocate(env);
  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 200);
  assert.equal(first.id, second.id);
  assert.equal(db.assets.size, 1);
});

test("wrong owners cannot enumerate or read another owner's object", async () => {
  const { env } = makeEnv();
  const { id } = await allocate(env, "alice", "owner-isolation");
  const wrongOwnerPut = await handleRequest(
    request("PUT", `/v1/media/${id}/content`, { token: "bob", contentType: "image/png", body: "abc" }),
    env,
  );
  const wrongOwnerGet = await handleRequest(
    request("GET", `/v1/media/${id}/content`, { token: "bob" }),
    env,
  );
  assert.equal(wrongOwnerPut.status, 404);
  assert.equal(wrongOwnerGet.status, 404);
});

test("private R2 upload and read require the owning identity and exact declared size", async () => {
  const { env, r2 } = makeEnv();
  const { id } = await allocate(env, "alice", "content-flow");
  const mismatch = await handleRequest(
    request("PUT", `/v1/media/${id}/content`, { token: "alice", contentType: "image/jpeg", body: "abc" }),
    env,
  );
  assert.equal(mismatch.status, 415);

  const uploaded = await handleRequest(
    request("PUT", `/v1/media/${id}/content`, { token: "alice", contentType: "image/png", body: "abc" }),
    env,
  );
  assert.equal(uploaded.status, 200);
  assert.equal(r2.objects.size, 1);

  const read = await handleRequest(request("GET", `/v1/media/${id}/content`, { token: "alice" }), env);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("cache-control"), "private, no-store");
  assert.equal(read.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await read.text(), "abc");
});

test("storage failures become failed metadata and metadata failures remain pending for reconciliation", async () => {
  const storageFailure = makeEnv();
  const first = await allocate(storageFailure.env, "alice", "storage-failure");
  storageFailure.r2.failPut = true;
  const failed = await handleRequest(
    request("PUT", `/v1/media/${first.id}/content`, { token: "alice", contentType: "image/png", body: "abc" }),
    storageFailure.env,
  );
  assert.equal(failed.status, 502);
  assert.equal(storageFailure.db.assets.get(first.id)?.state, "failed");

  const metadataFailure = makeEnv();
  const second = await allocate(metadataFailure.env, "alice", "metadata-failure");
  metadataFailure.db.failReadyUpdate = true;
  const orphaned = await handleRequest(
    request("PUT", `/v1/media/${second.id}/content`, { token: "alice", contentType: "image/png", body: "abc" }),
    metadataFailure.env,
  );
  assert.equal(orphaned.status, 503);
  assert.equal(metadataFailure.db.assets.get(second.id)?.state, "pending");
  assert.equal(metadataFailure.r2.objects.size, 1);
});
