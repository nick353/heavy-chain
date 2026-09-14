import assert from "node:assert/strict";
import test from "node:test";
import { HeavyMediaClient } from "../src/client.ts";

test('Heavy client sends Gallery purpose and job filters including explicit false', async () => {
  const urls: URL[] = [];
  const client = new HeavyMediaClient({
    baseUrl: 'https://heavy.example', tokenProvider: () => 'token',
    fetcher: async input => { urls.push(new URL(String(input))); return new Response('[]'); },
  });
  await client.listGeneratedImages('brand', { assetPurpose: 'print-design', hasJob: false, favorite: true, featureType: 'model-matrix', jobId: 'job-one', order: 'oldest', limit: 20, offset: 40 });
  assert.deepEqual(Object.fromEntries(urls[0].searchParams), {
    brand_id: 'brand', limit: '20', offset: '40', favorite: 'true', asset_purpose: 'print-design', has_job: 'false', feature_type: 'model-matrix', job_id: 'job-one', order: 'oldest',
  });
  await client.listGeneratedImages('brand');
  assert.equal(urls[1].searchParams.has('asset_purpose'), false);
  assert.equal(urls[1].searchParams.has('has_job'), false);
});

test("Heavy client uses the Cloudflare domain contract with bearer auth", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new HeavyMediaClient({
    baseUrl: "https://heavy.example/",
    tokenProvider: () => "token-1",
    fetcher: async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      if (String(input).endsWith("/v1/profile")) {
        return new Response(JSON.stringify({ id: "user-1", email: "u@example.test", name: null, avatar_url: null, language: "ja" }));
      }
      if (String(input).endsWith("/v1/brands") && init?.method !== "POST") {
        return new Response(JSON.stringify([{ id: "brand-1", owner_id: "user-1", name: "Brand", logo_url: null, brand_colors: {}, tone_description: null, target_audience: null, role: "owner" }]));
      }
      return new Response(JSON.stringify({ id: "brand-2", owner_id: "user-1", name: "Created", logo_url: null, brand_colors: {}, tone_description: null, target_audience: null, role: "owner" }), { status: 201 });
    },
  });

  assert.equal((await client.getProfile()).id, "user-1");
  assert.equal((await client.updateProfile({ name: "Updated" })).id, "user-1");
  assert.equal((await client.listBrands())[0].id, "brand-1");
  assert.equal((await client.createBrand({ name: "Created" })).id, "brand-2");
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((call) => call.url), [
    "https://heavy.example/v1/profile",
    "https://heavy.example/v1/profile",
    "https://heavy.example/v1/brands",
    "https://heavy.example/v1/brands",
  ]);
  for (const call of calls) assert.equal(new Headers(call.init.headers).get("authorization"), "Bearer token-1");
  assert.equal(calls[1].init.method, "PATCH");
  assert.equal(JSON.parse(String(calls[1].init.body)).name, "Updated");
  assert.equal(JSON.parse(String(calls[3].init.body)).name, "Created");
});

test("Heavy client exposes durable generation, result, and Canvas contracts", async () => {
  const calls: string[] = [];
  const client = new HeavyMediaClient({
    baseUrl: "https://heavy.example",
    tokenProvider: () => "token-2",
    fetcher: async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      const url = String(input);
      if (url.includes("generation-jobs")) {
        return new Response(JSON.stringify(url.includes("?") ? [] : {
          id: "job-1", brand_id: "brand-1", user_id: "user-1", feature_type: "ai-fitting",
          input_params: {}, optimized_prompt: null, status: "pending", error_message: null,
          created_at: "2026-09-04T00:00:00.000Z", completed_at: null,
        }));
      }
      if (url.includes("generated-images")) {
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        return new Response(JSON.stringify(url.includes("?") ? [] : {
          id: "image-1", job_id: "job-1", brand_id: "brand-1", user_id: "user-1",
          storage_path: "generated-images/image-1.png", thumbnail_path: null, version: 1,
          parent_image_id: null, is_favorite: true, prompt: null, negative_prompt: null,
          feature_type: "ai-fitting", style_preset: null, model_used: null,
          generation_params: {}, metadata: {}, image_url: null,
          created_at: "2026-09-04T00:00:00.000Z", expires_at: null,
        }));
      }
      if (url.includes("canvas-documents")) {
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        return new Response(JSON.stringify(url.includes("?") ? [] : {
          id: "canvas-1", owner_id: "user-1", brand_id: "brand-1", title: "Board",
          snapshot: { objects: [] }, snapshot_version: 1, revision: 1,
          created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z",
        }));
      }
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    },
  });

  assert.equal((await client.createGenerationJob({ brand_id: "brand-1", feature_type: "ai-fitting" })).id, "job-1");
  assert.deepEqual(await client.listGenerationJobs("brand-1"), []);
  assert.equal((await client.setGeneratedImageFavorite("image-1", true)).is_favorite, true);
  assert.deepEqual(await client.listGeneratedImages("brand-1"), []);
  assert.equal((await client.updateCanvasDocument("canvas-1", { expected_revision: 0, snapshot: { objects: [] } })).revision, 1);
  assert.deepEqual(await client.listCanvasDocuments("brand-1"), []);
  await client.deleteGeneratedImage("image-1");
  await client.deleteCanvasDocument("canvas-1");
  assert.equal(calls.every((call) => call.startsWith("GET") || call.includes("https://heavy.example")), true);
});
