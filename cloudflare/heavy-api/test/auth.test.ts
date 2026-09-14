import assert from "node:assert/strict";
import test from "node:test";
import { configuredTokenVerifier, type OidcAuthEnv } from "../src/auth.ts";

const issuer = "https://consumer-auth.test";
const request = () => new Request("https://api.test/v1/profile", {
  headers: { authorization: "Bearer live-session-token" },
});

function identity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issuer,
    subject: crypto.randomUUID(),
    email: "alice@example.test",
    emailVerified: true,
    name: "Alice",
    ...overrides,
  };
}

function fixture() {
  let status = 200;
  let payload = identity();
  let calls = 0;
  const service = {
    async fetch(input: Request): Promise<Response> {
      calls += 1;
      assert.equal(input.url, `${issuer}/v1/identity`);
      const names: string[] = [];
      input.headers.forEach((_, name) => names.push(name));
      assert.deepEqual(names, ["authorization"]);
      return Response.json(payload, { status });
    },
  };
  const env: OidcAuthEnv = { AUTH_SERVICE: service, AUTH_ISSUER: issuer };
  return {
    env,
    service,
    request: request(),
    setStatus(value: number) { status = value; },
    setPayload(value: Record<string, unknown>) { payload = value; },
    calls: () => calls,
  };
}

test("service verifier forwards only the bearer and accepts a live verified UUID", async () => {
  const s = fixture();
  const verifier = configuredTokenVerifier(s.env);
  assert.ok(verifier);
  const result = await verifier(s.request);
  assert.equal(result?.issuer, issuer);
  assert.match(result?.subject ?? "", /^[0-9a-f-]{36}$/i);
  assert.deepEqual(result?.verifiedProfile, { email: "alice@example.test", name: "Alice" });
  assert.equal(s.calls(), 1);
});

test("wrong issuer, non-UUID identity, and unverified identity are denied", async () => {
  const s = fixture();
  const verifier = configuredTokenVerifier(s.env);
  assert.ok(verifier);
  s.setPayload(identity({ issuer: "https://other-auth.test" }));
  assert.equal(await verifier(s.request), null, "wrong issuer");
  s.setPayload(identity({ subject: "not-a-uuid" }));
  assert.equal(await verifier(s.request), null, "non-UUID subject");
  s.setPayload(identity({ emailVerified: false }));
  assert.equal(await verifier(s.request), null, "unverified identity");
});

test("expired and revoked live sessions are denied by the Auth service", async () => {
  const s = fixture();
  const verifier = configuredTokenVerifier(s.env);
  assert.ok(verifier);
  for (const state of ["expired", "revoked"]) {
    s.setStatus(401);
    assert.equal(await verifier(s.request), null, state);
  }
});

test("Auth service outage is not converted into a legacy-token admission", async () => {
  const s = fixture();
  const verifier = configuredTokenVerifier(s.env);
  assert.ok(verifier);
  s.setStatus(503);
  await assert.rejects(() => verifier(s.request), /session_verifier_unavailable/);
});

test("missing binding and invalid issuer fail closed without global fetch or JWKS fallback", async () => {
  const previousFetch = globalThis.fetch;
  let globalFetchCalls = 0;
  globalThis.fetch = (async () => {
    globalFetchCalls += 1;
    throw new Error("global fetch must not be used by API auth");
  }) as typeof fetch;
  try {
    const legacyOnly = {
      AUTH_ISSUER: issuer,
      AUTH_AUDIENCE: "heavy-chain-api",
      AUTH_JWKS_URL: "https://legacy.example.test/.well-known/jwks.json",
      AUTH_CLOCK_SKEW_SECONDS: "0",
    } as unknown as OidcAuthEnv;
    assert.equal(configuredTokenVerifier(legacyOnly), null);
    assert.equal(configuredTokenVerifier({ ...fixture().env, AUTH_ISSUER: "http://insecure.test" }), null);
    assert.equal(globalFetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
