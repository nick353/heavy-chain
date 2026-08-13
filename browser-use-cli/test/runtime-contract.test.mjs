import test from "node:test";
import assert from "node:assert/strict";

import {
  BROWSER_USE_HOME,
  buildBrowserUseCliCleanupProof,
  createBrowserUseCliFlowContract,
  diagnoseCodexAppRunNowCapability,
  requireCodexAppRunNowCapability,
  validateBrowserUseCliFlowBinding,
  validateCodexAppRunNowResult,
} from "../lib/stage-adapter.mjs";

test("scheduled adapter keeps persistent owner binding separate from temporary lifecycle", () => {
  const now = Date.now();
  const contract = createBrowserUseCliFlowContract({
    automationId: "automation-1",
    runId: "run-1",
    stageId: "stage-1",
    session: "session-1",
    mode: "authorized",
    lifecycle: "scheduled",
    authorityPath: "/tmp/authority.json",
    allowedOrigins: ["https://example.com"],
    contract: {
      authoritySha256: "a".repeat(64),
      runtimeHomeId: BROWSER_USE_HOME,
      notBefore: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    },
  });
  assert.equal(contract.authorized_scheduled_flow, true);
  assert.equal(contract.lifecycle, "scheduled");
  assert.equal(validateBrowserUseCliFlowBinding({ ...contract, descriptor_state: "active", lease_state: "held" }).flow_id, contract.flow_id);
  assert.throws(
    () => createBrowserUseCliFlowContract({
      automationId: "automation-1",
      runId: "run-1",
      stageId: "stage-1",
      session: "session-1",
      mode: "authorized",
      lifecycle: "temporary",
      authorityPath: "/tmp/authority.json",
      allowedOrigins: ["https://example.com"],
      contract: {
        authoritySha256: "a".repeat(64),
        runtimeHomeId: BROWSER_USE_HOME,
        notBefore: new Date(now - 1000).toISOString(),
        expiresAt: new Date(now + 60_000).toISOString(),
      },
    }),
    (error) => error.exact_blocker === "browser_use_cli_lifecycle_invalid",
  );
});

test("automation view is diagnostic-only when the official Run now handler is absent", () => {
  const diagnostic = diagnoseCodexAppRunNowCapability({
    handlerSnapshot: { codex_app__automation_update: true },
  });
  assert.equal(diagnostic.status, "blocked");
  assert.equal(diagnostic.view_handler_is_not_run_now, true);
  assert.equal(diagnostic.exact_blocker, "codex_app_automation_run_now_api_unavailable");
  assert.throws(
    () => requireCodexAppRunNowCapability({ handlerSnapshot: { codex_app__automation_update: true } }),
    (error) => error.exact_blocker === "codex_app_automation_run_now_api_unavailable",
  );
});

test("cleanup proof keeps helper/session evidence separate from OS evidence", () => {
  const proof = buildBrowserUseCliCleanupProof({
    finalized: true,
    cleanup: {
      sessions_closed: true,
      daemon_closed: true,
      socket_absent: true,
      profile_lock_released: true,
      pid_verified: true,
      loopback_listener_closed: true,
      port_ownership_released: true,
      lock_cleanup: true,
      unknown_processes: [],
    },
  }, { descriptorPath: "/tmp/descriptor.json", receiptPath: "/tmp/receipt.json" });
  assert.equal(proof.schema, "browser_use_cli_cleanup_proof.v1");
  assert.equal(proof.status, "verified");
  assert.equal(proof.helper_session.daemon_closed, true);
  assert.equal(proof.os.expected_pid_start_identity, true);
  assert.equal(proof.os.unknown_processes_untouched, true);

  const incomplete = buildBrowserUseCliCleanupProof({ finalized: true, cleanup: { sessions_closed: true, unknown_processes: [] } });
  assert.equal(incomplete.status, "incomplete");
  assert.equal(incomplete.helper_session.daemon_closed, false);
  assert.deepEqual(incomplete.os.unknown_processes, []);
});

test("official Run now receipt must be fresh, bound, and single-use", () => {
  const now = new Date();
  const officialResult = {
    handler_name: "codex_app__automation_run_now",
    invocation_id: "invocation-1",
    thread_id: "thread-1",
    turn_id: "turn-1",
    session_id: "session-1",
    run_id: "run-1",
    receipt: {
      schema: "codex_app_registered_root_receipt.v1",
      issuer: "codex_app__automation_run_now",
      audience: "codex_app_registered_automation",
      automation_id: "identity",
      registered_prompt_sha256: "a".repeat(64),
      prompt_version: "v1",
      invocation_id: "invocation-1",
      thread_id: "thread-1",
      turn_id: "turn-1",
      session_id: "session-1",
      run_id: "run-1",
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 300000).toISOString(),
      nonce: "b".repeat(32),
    },
  };
  const consumed = new Set();
  const receipt = validateCodexAppRunNowResult({
    handlerSnapshot: { codex_app__automation_run_now: true },
    officialResult,
    expectedBinding: { automation_id: "identity", registered_prompt_sha256: "a".repeat(64), prompt_version: "v1" },
    consumedNonces: consumed,
  });
  assert.equal(receipt.run_id, "run-1");
  assert.throws(
    () => validateCodexAppRunNowResult({ handlerSnapshot: { codex_app__automation_run_now: true }, officialResult, consumedNonces: consumed }),
    (error) => error.exact_blocker === "codex_app_registered_root_receipt_replay",
  );
});
