import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest, type Env, type TokenIdentity } from "../src/index.ts";

interface User { id: string; email: string; name: string | null; avatar_url: string | null; language: string; created_at: string; updated_at: string; }
interface Brand { id: string; owner_id: string; name: string; logo_url: string | null; brand_colors_json: string; tone_description: string | null; target_audience: string | null; role: string; created_at: string; updated_at: string; }

class Statement {
  private values: unknown[] = [];
  private readonly db: DomainDb;
  private readonly sql: string;
  constructor(db: DomainDb, sql: string) { this.db = db; this.sql = sql; }
  bind(...values: unknown[]): this { this.values = values; return this; }
  first<T>(): Promise<T | null> { return Promise.resolve(this.db.first<T>(this.sql, this.values)); }
  all<T>(): Promise<{ results: T[] }> { return Promise.resolve({ results: this.db.all<T>(this.sql, this.values) }); }
  run(): Promise<{ meta: { changes: number } }> { return Promise.resolve({ meta: { changes: this.db.run(this.sql, this.values) } }); }
}

class DomainDb {
  identities = new Map<string, string>();
  users = new Map<string, User>();
  brands = new Map<string, Brand>();
  members: Array<{ brand_id: string; user_id: string; role: string; joined_at: string | null }> = [];
  prepare(sql: string): Statement { return new Statement(this, sql); }

  first<T>(sql: string, values: unknown[]): T | null {
    const normalized = sql.toLowerCase().replace(/\s+/g, " ");
    if (normalized.includes("from user_identities")) {
      const principal = this.identities.get(`${values[0]}:${values[1]}`);
      return (principal ? { principal_id: principal } : null) as T | null;
    }
    if (normalized.includes("from users")) return (this.users.get(String(values[0])) ?? null) as T | null;
    if (normalized.includes("from brands where id")) return (this.brands.get(String(values[0])) ?? null) as T | null;
    throw new Error(`unexpected first SQL: ${sql}`);
  }

  all<T>(sql: string, values: unknown[]): T[] {
    const userId = String(values[0]);
    const rows = [...this.brands.values()].filter((brand) => {
      if (brand.owner_id === userId) return true;
      return this.members.some((member) => member.brand_id === brand.id && member.user_id === userId && member.joined_at !== null);
    });
    return rows.map((brand) => ({
      ...brand,
      role: brand.owner_id === userId
        ? "owner"
        : this.members.find((member) => member.brand_id === brand.id && member.user_id === userId)?.role ?? "viewer",
    })) as T[];
  }

  run(sql: string, values: unknown[]): number {
    const normalized = sql.toLowerCase().replace(/\s+/g, " ");
    if (normalized.startsWith("update users set")) {
      const user = this.users.get(String(values[values.length - 1]));
      if (!user) return 0;
      const columns = [...sql.matchAll(/([a-z_]+) = \?/gi)].map((match) => match[1]);
      columns.slice(0, -1).forEach((column, index) => {
        (user as unknown as Record<string, unknown>)[column] = values[index];
      });
      user.updated_at = String(values[values.length - 2]);
      return 1;
    }
    if (normalized.includes("insert into brands")) {
      const [id, ownerId, name, logoUrl, colors, tone, audience, createdAt, updatedAt] = values;
      this.brands.set(String(id), {
        id: String(id), owner_id: String(ownerId), name: String(name), logo_url: logoUrl as string | null,
        brand_colors_json: String(colors), tone_description: tone as string | null,
        target_audience: audience as string | null, role: "owner", created_at: String(createdAt), updated_at: String(updatedAt),
      });
      return 1;
    }
    if (normalized.startsWith("update brands set")) {
      const brandId = String(values[values.length - 2]);
      const ownerId = String(values[values.length - 1]);
      const brand = this.brands.get(brandId);
      if (!brand || brand.owner_id !== ownerId) return 0;
      const columns = [...sql.matchAll(/([a-z_]+) = \?/gi)].map((match) => match[1]);
      columns.slice(0, -1).forEach((column, index) => {
        (brand as unknown as Record<string, unknown>)[column] = values[index];
      });
      brand.updated_at = String(values[values.length - 3]);
      return 1;
    }
    throw new Error(`unexpected run SQL: ${sql}`);
  }
}

function identityFor(request: Request): TokenIdentity | null {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return token ? { issuer: "test-issuer", subject: token } : null;
}

function env(db: DomainDb): Env {
  return { DB: db as unknown as D1Database, PRIVATE_MEDIA: {} as R2Bucket, MEDIA_TOKEN_VERIFIER: identityFor };
}

function request(method: string, path: string, token: string, body?: unknown): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`https://heavy.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

function seed(db: DomainDb, id: string): void {
  db.identities.set(`test-issuer:${id}`, id);
  db.users.set(id, {
    id, email: `${id}@example.test`, name: id, avatar_url: null, language: "ja",
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  });
}

test("profile and brand access require a mapped identity", async () => {
  const db = new DomainDb();
  seed(db, "alice");
  db.brands.set("brand-1", {
    id: "brand-1", owner_id: "alice", name: "Alice Brand", logo_url: null, brand_colors_json: "{}",
    tone_description: null, target_audience: null, role: "owner", created_at: "2026-01-01", updated_at: "2026-01-01",
  });
  const profile = await handleRequest(request("GET", "/v1/profile", "alice"), env(db));
  assert.equal(profile.status, 200);
  assert.equal((await json<{ id: string }>(profile)).id, "alice");
  const brands = await handleRequest(request("GET", "/v1/brands", "alice"), env(db));
  assert.equal(brands.status, 200);
  assert.equal((await json<Array<{ id: string }>>(brands))[0].id, "brand-1");
  const unmapped = await handleRequest(request("GET", "/v1/brands", "bob"), env(db));
  assert.equal(unmapped.status, 403);
});

test("brand creation is scoped to the mapped owner", async () => {
  const db = new DomainDb();
  seed(db, "alice");
  const response = await handleRequest(
    request("POST", "/v1/brands", "alice", { name: "New Brand", brand_colors: { primary: "#111" } }),
    env(db),
  );
  assert.equal(response.status, 201);
  assert.equal((await json<{ owner_id: string }>(response)).owner_id, "alice");
  assert.equal(db.brands.size, 1);
});

test("brand updates are owner-scoped and return the updated D1 row", async () => {
  const db = new DomainDb();
  seed(db, "alice");
  db.brands.set("brand-1", {
    id: "brand-1", owner_id: "alice", name: "Before", logo_url: null, brand_colors_json: "{}",
    tone_description: null, target_audience: null, role: "owner", created_at: "2026-01-01", updated_at: "2026-01-01",
  });

  const response = await handleRequest(
    request("PATCH", "/v1/brands/brand-1", "alice", {
      name: "After", brand_colors: { primary: "#111" }, tone_description: "Clear", target_audience: "Creators",
    }),
    env(db),
  );
  assert.equal(response.status, 200);
  const updated = await json<{ name: string; brand_colors: { primary: string }; tone_description: string }>(response);
  assert.equal(updated.name, "After");
  assert.equal(updated.brand_colors.primary, "#111");
  assert.equal(updated.tone_description, "Clear");

  const forbidden = await handleRequest(
    request("PATCH", "/v1/brands/brand-1", "bob", { name: "Nope" }),
    env(db),
  );
  assert.equal(forbidden.status, 403);

  const invalid = await handleRequest(
    request("PATCH", "/v1/brands/brand-1", "alice", { unexpected: true }),
    env(db),
  );
  assert.equal(invalid.status, 400);
});

test("profile updates are scoped to the mapped identity", async () => {
  const db = new DomainDb();
  seed(db, "alice");
  const response = await handleRequest(
    request("PATCH", "/v1/profile", "alice", { name: "Updated", language: "en" }),
    env(db),
  );
  assert.equal(response.status, 200);
  const profile = await json<{ name: string; language: string }>(response);
  assert.equal(profile.name, "Updated");
  assert.equal(profile.language, "en");
  const forbidden = await handleRequest(
    request("PATCH", "/v1/profile", "bob", { name: "Nope" }),
    env(db),
  );
  assert.equal(forbidden.status, 403);
});
